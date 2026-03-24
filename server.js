const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/build')));

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

// In-memory JS database: { tableName: { columns: [{name, type}], rows: [{}] } }
let jsDb = {};

const DATA_DIR = path.join(__dirname, 'data');
const LAST_SQL = path.join(DATA_DIR, 'last.sql');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Parser helpers ──────────────────────────────────────────────────────────

function parseScalarValue(s) {
  const t = s.trim();
  if (t === 'NULL' || t === 'null') return null;
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/''/g, "'").replace(/""/g, '"');
  }
  // Pure integer: keep as string if it exceeds JS safe integer range (e.g. Discord IDs)
  if (/^-?\d+$/.test(t)) {
    const n = BigInt(t);
    const safe = BigInt(Number.MAX_SAFE_INTEGER);
    if (n > safe || n < -safe) return t; // store as string to preserve precision
    return Number(t);
  }
  const n = Number(t);
  if (!isNaN(n) && t !== '') return n;
  return t;
}

function parseRowGroup(groupStr) {
  const values = [];
  let current = '';
  let inStr = false;
  let strChar = '';
  for (let i = 0; i < groupStr.length; i++) {
    const c = groupStr[i];
    const next = groupStr[i + 1];
    if (!inStr && (c === "'" || c === '"')) {
      inStr = true; strChar = c; current += c;
    } else if (inStr && c === strChar && next === strChar) {
      current += c + next; i++;
    } else if (inStr && c === strChar) {
      inStr = false; current += c;
    } else if (!inStr && c === ',') {
      values.push(parseScalarValue(current.trim())); current = '';
    } else {
      current += c;
    }
  }
  if (current.trim().length > 0) values.push(parseScalarValue(current.trim()));
  return values;
}

function extractValueGroups(valuesSection) {
  const groups = [];
  let depth = 0, start = -1, inStr = false, strChar = '';
  for (let i = 0; i < valuesSection.length; i++) {
    const c = valuesSection[i];
    const next = valuesSection[i + 1];
    if (!inStr && (c === "'" || c === '"')) {
      inStr = true; strChar = c;
    } else if (inStr && c === strChar && next === strChar) {
      i++;
    } else if (inStr && c === strChar) {
      inStr = false;
    } else if (!inStr && c === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (!inStr && c === ')') {
      depth--;
      if (depth === 0 && start !== -1) {
        groups.push(valuesSection.slice(start + 1, i));
        start = -1;
      }
    }
  }
  return groups;
}

function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inStr = false;
  let strChar = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];
    if (!inStr && (c === "'" || c === '"' || c === '`')) {
      inStr = true; strChar = c; current += c;
    } else if (inStr && c === strChar && next === strChar) {
      current += c + next; i++;
    } else if (inStr && c === '\\') {
      current += c + (next || ''); i++;
    } else if (inStr && c === strChar) {
      inStr = false; current += c;
    } else if (!inStr && c === ';') {
      const t = current.trim();
      if (t.length > 0) statements.push(t);
      current = '';
    } else {
      current += c;
    }
  }
  const t = current.trim();
  if (t.length > 0) statements.push(t);
  return statements;
}

function preprocess(sql) {
  let s = sql;
  // Remove MySQL conditional comments like /*!40101 ... */
  s = s.replace(/\/\*!\d*[\s\S]*?\*\//g, '');
  // Remove standard block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // Only remove lines that START with -- (safe: avoids removing -- inside string values)
  s = s.replace(/^[ \t]*--[^\n]*/gm, '');
  // Convert MySQL backslash-escaped quotes to SQLite style
  s = s.replace(/\\'/g, "''");
  s = s.replace(/\\\\/g, '\\');
  return s;
}

// ─── Main parser ─────────────────────────────────────────────────────────────

function parseDump(content) {
  const db = {};
  const processed = preprocess(content);
  const statements = splitStatements(processed);

  for (const stmt of statements) {
    const upper = stmt.trimStart().toUpperCase();

    // ── CREATE TABLE ──
    if (upper.startsWith('CREATE TABLE')) {
      const nameMatch = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/i);
      if (!nameMatch) continue;
      const tableName = nameMatch[1];
      const openParen = stmt.indexOf('(');
      if (openParen === -1) continue;

      // Extract body between first ( and matching )
      let depth = 0, bodyStart = openParen, bodyEnd = openParen;
      for (let i = openParen; i < stmt.length; i++) {
        if (stmt[i] === '(') depth++;
        else if (stmt[i] === ')') { depth--; if (depth === 0) { bodyEnd = i; break; } }
      }
      const body = stmt.slice(bodyStart + 1, bodyEnd);
      const columns = [];

      for (const line of body.split('\n')) {
        const t = line.trim().replace(/,\s*$/, '');
        if (!t) continue;
        const skip = /^(PRIMARY|KEY|INDEX|UNIQUE|CONSTRAINT|CHECK|FOREIGN|\))/i.test(t);
        if (skip) continue;
        const colMatch = t.match(/^[`"]?(\w+)[`"]?\s+([A-Za-z]+)/);
        if (colMatch) {
          columns.push({ name: colMatch[1], type: colMatch[2].toUpperCase() });
        }
      }
      db[tableName] = { columns, rows: [] };
    }

    // ── INSERT INTO ──
    else if (upper.startsWith('INSERT INTO') || upper.startsWith('INSERT IGNORE INTO')) {
      const nameMatch = stmt.match(/INSERT\s+(?:IGNORE\s+)?INTO\s+[`"]?(\w+)[`"]?/i);
      if (!nameMatch) continue;
      const tableName = nameMatch[1];
      if (!db[tableName]) db[tableName] = { columns: [], rows: [] };

      // Optional explicit column list
      let cols = db[tableName].columns.map(c => c.name);
      const colListMatch = stmt.match(/INSERT\s+(?:IGNORE\s+)?INTO\s+[`"]?\w+[`"]?\s*\(([^)]+)\)\s*VALUES/i);
      if (colListMatch) {
        cols = colListMatch[1].split(',').map(c => c.trim().replace(/`/g, '').replace(/"/g, ''));
        if (db[tableName].columns.length === 0) {
          db[tableName].columns = cols.map(c => ({ name: c, type: 'TEXT' }));
        }
      }

      const valIdx = stmt.search(/\bVALUES\b/i);
      if (valIdx === -1) continue;
      const valSection = stmt.slice(valIdx + 6);
      const groups = extractValueGroups(valSection);

      for (const group of groups) {
        const values = parseRowGroup(group);
        const row = {};
        cols.forEach((col, i) => { row[col] = values[i] !== undefined ? values[i] : null; });
        db[tableName].rows.push(row);
      }
    }
  }

  return db;
}

// Auto-load last SQL dump on startup
if (fs.existsSync(LAST_SQL)) {
  try {
    const content = fs.readFileSync(LAST_SQL, 'utf8');
    jsDb = parseDump(content);
    const names = Object.keys(jsDb);
    const total = names.reduce((s, t) => s + jsDb[t].rows.length, 0);
    console.log(`Auto-loaded last.sql: ${names.length} tablo, ${total} satır`);
  } catch (e) { console.error('Auto-load failed:', e.message); }
}

// ─── IntelX OSINT search ─────────────────────────────────────────────────────

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = { hostname, path, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = require('https').request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: 'API yanıt hatası', raw: d.slice(0, 200) }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'GET', headers };
    const req = require('https').request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: 'API yanıt hatası', raw: d.slice(0, 200) }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── crt.sh certificate transparency search (free, no key) ──────────────────

const crtCache = {};

app.get('/api/osint/crtsh', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  if (crtCache[email]) return res.json(crtCache[email]);

  const domain = email.includes('@') ? email.split('@')[1] : email;
  try {
    const data = await httpsGet('crt.sh', `/?q=${encodeURIComponent('%.' + domain)}&output=json`, {});
    const records = Array.isArray(data) ? data.slice(0, 50).map(r => ({
      issuer: r.issuer_name,
      cn: r.common_name,
      notBefore: r.not_before,
      notAfter: r.not_after,
      serial: r.serial_number
    })) : [];
    const out = { domain, total: Array.isArray(data) ? data.length : 0, records };
    crtCache[email] = out;
    res.json(out);
  } catch (err) { res.json({ domain, total: 0, records: [], error: err.message }); }
});

// ─── Breach lookup via breachdirectory (free, no key) ────────────────────────

const breachCache = {};

app.get('/api/osint/breach', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  if (breachCache[email]) return res.json(breachCache[email]);

  // Use XposedOrNot free API (no key required)
  const options = {
    hostname: 'api.xposedornot.com',
    path: `/api/email/breaches/${encodeURIComponent(email)}`,
    method: 'GET',
    headers: { 'User-Agent': 'OSINT-Tool/1.0', 'Accept': 'application/json' }
  };
  require('https').request(options, (response) => {
    let data = '';
    response.on('data', c => data += c);
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.Error) {
          const out = { breaches: [], found: false };
          breachCache[email] = out;
          return res.json(out);
        }
        const breaches = parsed.ExposedBreaches?.breaches_details || [];
        const out = {
          found: true,
          total: breaches.length,
          breaches: breaches.slice(0, 30).map(b => ({
            name: b.breach || b.name || '?',
            domain: b.domain || '—',
            date: b.xposed_date || b.added_date || '—',
            records: b.xposed_records || b.records || 0,
            dataTypes: b.xposed_data || b.data || '—',
            logo: b.logo || null
          }))
        };
        breachCache[email] = out;
        res.json(out);
      } catch { res.json({ breaches: [], found: false, error: 'Parse hatası' }); }
    });
  }).on('error', err => res.json({ breaches: [], found: false, error: err.message })).end();
});

// ─── Discord ID lookup (snowflake decode + public API) ───────────────────────

const discordCache = {};

app.get('/api/osint/discord', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  if (discordCache[id]) return res.json(discordCache[id]);

  // Decode snowflake timestamp
  const DISCORD_EPOCH = 1420070400000;
  let createdAt = null;
  try {
    const snowflake = BigInt(id);
    const timestamp = Number(snowflake >> 22n) + DISCORD_EPOCH;
    createdAt = new Date(timestamp).toISOString();
  } catch {}

  // Try public Discord lookup API
  try {
    const data = await httpsGet('japi.rest', `/discord/v1/user/${id}`, { 'User-Agent': 'OSINT-Tool/1.0' });
    const user = data.data || data;
    const out = {
      id,
      createdAt,
      username: user.username || user.tag || null,
      globalName: user.global_name || user.globalName || null,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128` : null,
      banner: user.banner_color || user.banner || null,
      bot: user.bot || false,
      flags: user.public_flags || 0,
      found: !!(user.username || user.tag)
    };
    discordCache[id] = out;
    return res.json(out);
  } catch {}

  // Fallback: just return snowflake data
  const out = { id, createdAt, username: null, avatar: null, found: false };
  discordCache[id] = out;
  res.json(out);
});

// ─── Disify email validation (free, no key) ──────────────────────────────────

const disifyCache = {};

app.get('/api/osint/disify', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  if (disifyCache[email]) return res.json(disifyCache[email]);

  const options = {
    hostname: 'disify.com',
    path: `/api/email/${encodeURIComponent(email)}`,
    method: 'GET',
    headers: { 'User-Agent': 'OSINT-Tool/1.0' }
  };
  require('https').request(options, (response) => {
    let data = '';
    response.on('data', c => data += c);
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        disifyCache[email] = parsed;
        res.json(parsed);
      } catch { res.json({ error: 'Parse hatası' }); }
    });
  }).on('error', err => res.json({ error: err.message })).end();
});

// ─── OSINT Email lookup (emailrep.io) ────────────────────────────────────────

const https = require('https');
const osintCache = {};

app.get('/api/osint/email', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  if (osintCache[email]) return res.json(osintCache[email]);

  const options = {
    hostname: 'emailrep.io',
    path: `/${encodeURIComponent(email)}`,
    method: 'GET',
    headers: { 'User-Agent': 'SQLManager-OSINT/1.0' }
  };

  const request = https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        osintCache[email] = parsed;
        res.json(parsed);
      } catch { res.status(500).json({ error: 'Parse error' }); }
    });
  });
  request.on('error', err => res.status(500).json({ error: err.message }));
  request.end();
});

// ─── IP Geolocation ───────────────────────────────────────────────────────────

const ipGeoCache = {};

app.get('/api/iplookup', (req, res) => {
  const { ip } = req.query;
  if (!ip) return res.status(400).json({ error: 'Missing ip' });
  if (ipGeoCache[ip]) return res.json(ipGeoCache[ip]);

  const encoded = encodeURIComponent(ip);
  const url = `http://ip-api.com/json/${encoded}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,query`;
  http.get(url, (response) => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        ipGeoCache[ip] = parsed;
        res.json(parsed);
      } catch { res.status(500).json({ error: 'Parse error' }); }
    });
  }).on('error', err => res.status(500).json({ error: err.message }));
});

// ─── Debug endpoint ───────────────────────────────────────────────────────────

app.get('/api/debug', (req, res) => {
  const info = {};
  Object.keys(jsDb).forEach(t => {
    info[t] = {
      columns: jsDb[t].columns.map(c => c.name),
      rowCount: jsDb[t].rows.length,
      sampleRow: jsDb[t].rows[0] || null
    };
  });
  res.json(info);
});

// ─── Upload endpoint ──────────────────────────────────────────────────────────

app.post('/api/upload-sql', upload.single('sqlFile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const content = fs.readFileSync(req.file.path, 'utf8');
    // Save for auto-load on restart
    try { fs.writeFileSync(LAST_SQL, content, 'utf8'); } catch {}
    fs.unlinkSync(req.file.path);

    jsDb = parseDump(content);

    const tableNames = Object.keys(jsDb);
    const rowCounts = {};
    tableNames.forEach(t => { rowCounts[t] = jsDb[t].rows.length; });

    const summary = tableNames.map(t => `${t}(${jsDb[t].rows.length} satır)`).join(', ');
    console.log('Loaded:', summary);

    const totalRows = tableNames.reduce((s, t) => s + jsDb[t].rows.length, 0);

    res.json({
      success: true,
      message: `${tableNames.length} tablo, ${totalRows} toplam satır yüklendi.`,
      tables: tableNames,
      rowCounts
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── DB status (for frontend auto-detect) ────────────────────────────────────

app.get('/api/status', (req, res) => {
  const tableNames = Object.keys(jsDb);
  if (tableNames.length === 0) return res.json({ loaded: false });
  const rowCounts = {};
  tableNames.forEach(t => { rowCounts[t] = jsDb[t].rows.length; });
  res.json({ loaded: true, tables: tableNames, rowCounts });
});

// ─── Tables list ──────────────────────────────────────────────────────────────

app.get('/api/tables', (req, res) => {
  if (!jsDb) return res.status(400).json({ error: 'No database loaded' });
  res.json({ tables: Object.keys(jsDb) });
});

// ─── Global search across ALL tables ─────────────────────────────────────────

app.get('/api/search-everywhere', (req, res) => {
  try {
    const { value } = req.query;
    if (!value) return res.status(400).json({ error: 'Missing value' });

    const lowerVal = value.toLowerCase();
    // Also search for base64-encoded version of the value (for encoded emails/IPs)
    const b64Val = Buffer.from(value).toString('base64');
    const b64ValNoPad = b64Val.replace(/=+$/, '');
    const results = [];

    for (const tableName of Object.keys(jsDb)) {
      const table = jsDb[tableName];
      if (!table.rows.length) continue;

      const colNames = table.columns.map(c => c.name);
      const matched = [];

      for (const row of table.rows) {
        const matchedCols = colNames.filter(col => {
          const v = row[col];
          if (v === null || v === undefined) return false;
          const sv = String(v);
          return sv.toLowerCase().includes(lowerVal) ||
                 sv.includes(b64Val) ||
                 (b64ValNoPad.length > 4 && sv.includes(b64ValNoPad));
        });
        if (matchedCols.length > 0) {
          matched.push({ row, matchedCols });
        }
      }

      if (matched.length > 0) {
        results.push({
          table: tableName,
          columns: table.columns,
          matches: matched.slice(0, 200),
          total: matched.length
        });
      }
    }

    results.sort((a, b) => b.total - a.total);

    const totalMatches = results.reduce((s, r) => s + r.total, 0);

    // When 0 results: send sample rows so user can inspect actual data
    let sampleData = null;
    if (totalMatches === 0) {
      sampleData = {};
      for (const tableName of Object.keys(jsDb)) {
        const tbl = jsDb[tableName];
        if (!tbl.rows.length) continue;
        sampleData[tableName] = {
          columns: tbl.columns.map(c => c.name),
          sample: tbl.rows.slice(0, 3)
        };
      }
    }

    res.json({
      value,
      tableCount: results.length,
      totalMatches,
      results,
      sampleData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Search all columns (ID Sorgu) ───────────────────────────────────────────

app.get('/api/table/:tableName/search-all', (req, res) => {
  try {
    const { tableName } = req.params;
    const { value, columns } = req.query;
    if (!jsDb[tableName]) return res.status(404).json({ error: 'Table not found' });
    if (!value) return res.status(400).json({ error: 'Missing value' });

    const colList = columns ? columns.split(',').map(c => c.trim()).filter(Boolean) : [];
    const searchCols = colList.length > 0 ? colList : jsDb[tableName].columns.map(c => c.name);
    const lowerVal = value.toLowerCase();

    const matched = jsDb[tableName].rows.filter(row =>
      searchCols.some(col => {
        const v = row[col];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(lowerVal);
      })
    );

    res.json({
      data: matched.slice(0, 500),
      columns: jsDb[tableName].columns,
      total: matched.length,
      searchedColumns: searchCols
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Table data ───────────────────────────────────────────────────────────────

app.get('/api/table/:tableName', (req, res) => {
  try {
    const { tableName } = req.params;
    if (!jsDb[tableName]) return res.status(404).json({ error: 'Table not found' });

    const { search, column, limit = 100, offset = 0 } = req.query;
    let rows = jsDb[tableName].rows;

    if (search && column) {
      const lowerSearch = search.toLowerCase();
      rows = rows.filter(row => {
        const v = row[column];
        return v !== null && v !== undefined && String(v).toLowerCase().includes(lowerSearch);
      });
    }

    const total = rows.length;
    const pageRows = rows.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      columns: jsDb[tableName].columns,
      data: pageRows,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Custom query ─────────────────────────────────────────────────────────────

app.post('/api/query', (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'No query provided' });

    const selectMatch = query.trim().match(/SELECT\s+\*\s+FROM\s+[`"]?(\w+)[`"]?(?:\s+WHERE\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);
    if (!selectMatch) return res.status(400).json({ error: 'Only simple SELECT * FROM table [WHERE col = val] [LIMIT n] queries supported' });

    const tableName = selectMatch[1];
    if (!jsDb[tableName]) return res.status(404).json({ error: `Table '${tableName}' not found` });

    let rows = jsDb[tableName].rows;

    if (selectMatch[2]) {
      const whereClause = selectMatch[2].trim();
      const condMatch = whereClause.match(/[`"]?(\w+)[`"]?\s*(=|LIKE|>|<|>=|<=|!=)\s*'?([^']*)'?/i);
      if (condMatch) {
        const [, col, op, val] = condMatch;
        const lv = val.toLowerCase();
        rows = rows.filter(row => {
          const v = row[col];
          if (v === null || v === undefined) return false;
          const sv = String(v);
          if (op === '=') return sv === val || sv.toLowerCase() === lv;
          if (op === 'LIKE') return sv.toLowerCase().includes(lv.replace(/%/g, ''));
          if (op === '>') return Number(v) > Number(val);
          if (op === '<') return Number(v) < Number(val);
          if (op === '>=') return Number(v) >= Number(val);
          if (op === '<=') return Number(v) <= Number(val);
          if (op === '!=') return sv !== val;
          return false;
        });
      }
    }

    const limitN = selectMatch[3] ? parseInt(selectMatch[3]) : 500;
    const data = rows.slice(0, limitN);

    res.json({
      data,
      columns: jsDb[tableName].columns,
      rowCount: data.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Serve frontend ───────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  const buildPath = path.join(__dirname, 'client/build', 'index.html');
  if (fs.existsSync(buildPath)) {
    res.sendFile(buildPath);
  } else {
    res.json({ message: 'API running. Frontend at http://localhost:3000' });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
