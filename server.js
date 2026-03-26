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

// ─── Auto-load last SQL on startup ─────────────────────────────────────────────────

const os = require('os');
const DESKTOP_PATH = path.join(os.homedir(), 'Desktop');

function findDesktopSQL() {
  try {
    const files = fs.readdirSync(DESKTOP_PATH);
    const sqls = files.filter(f => f.toLowerCase().endsWith('.sql'));
    const raven = sqls.find(f => f.toLowerCase().includes('raven'));
    const chosen = raven || sqls[0];
    return chosen ? path.join(DESKTOP_PATH, chosen) : null;
  } catch { return null; }
}

let sqlLoaded = false;
let sqlLoading = false;

function loadSQL() {
  if (sqlLoaded || sqlLoading) return;
  sqlLoading = true;
  
  const desktopSQL = findDesktopSQL();
  const targetFile = desktopSQL || LAST_SQL;

  try {
    if (fs.existsSync(targetFile)) {
      const stats = fs.statSync(targetFile);
      const fileSizeMB = stats.size / (1024 * 1024);
      console.log(`Loading SQL: ${path.basename(targetFile)} (${fileSizeMB.toFixed(1)}MB)...`);
      
      if (fileSizeMB > 200) {
        console.log('File too large, skipping');
        jsDb = {};
        sqlLoading = false;
        return;
      }
      
      const content = fs.readFileSync(targetFile, 'utf8');
      jsDb = parseDump(content);
      
      if (desktopSQL && targetFile !== LAST_SQL) {
        fs.copyFileSync(desktopSQL, LAST_SQL);
      }
      
      const tableNames = Object.keys(jsDb);
      const summary = tableNames.map(t => `${t}(${jsDb[t].rows.length} satır)`).join(', ');
      console.log('SQL loaded:', summary);
      sqlLoaded = true;
    }
  } catch (error) {
    console.error('SQL load error:', error.message);
    jsDb = {};
  }
  sqlLoading = false;
}

// Quick startup - load SQL on first request
console.log('Server started. SQL will load on first request.');

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
  try {
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

        // Parse all row groups using extractValueGroups
        const rowGroups = extractValueGroups(valSection);
        for (const group of rowGroups) {
          const values = parseRowGroup(group);
          if (values.length === cols.length) {
            const row = {};
            cols.forEach((col, i) => {
              row[col] = values[i];
            });
            db[tableName].rows.push(row);
          }
        }
      }
    }
  } catch (error) {
    console.error('Parse error:', error.message);
    // Hata durumunda boş database döndür
    return {};
  }
  return db;
}

// ─── Upload endpoint - FIRST INSTANCE DISABLED ───────────────────────────

app.post('/api/upload-sql-disabled-1', (req, res) => {
  res.status(403).json({ error: 'Upload disabled. SQL auto-loaded on startup only.' });
});

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

// ─── Social OSINT - Google (Firebase), Gravatar, Duolingo, GitHub, Spotify ───

const crypto = require('crypto');
const socialCache = {};

function httpsGetWithStatus(hostname, path, headers) {
  return new Promise((resolve) => {
    const req = require('https').request({ hostname, path, method: 'GET', headers }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

function httpsHeadStatus(hostname, path, headers) {
  return new Promise((resolve) => {
    const req = require('https').request({ hostname, path, method: 'HEAD', headers }, (res) => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

app.get('/api/osint/social', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  if (socialCache[email]) return res.json(socialCache[email]);

  const sites = [];
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

  // 1. Gravatar
  const gravatarHash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  const gravatarStatus = await httpsHeadStatus('www.gravatar.com', `/avatar/${gravatarHash}?d=404`, { 'User-Agent': ua });
  if (gravatarStatus === 200) {
    sites.push({ site: 'Gravatar', username: email.split('@')[0], url: `https://gravatar.com/avatar/${gravatarHash}`, note: 'Profil mevcut' });
  }

  // 2. Auto-scan Downloads/Desktop for Epieos JSON files
  const scanDirs = [
    require('path').join(require('os').homedir(), 'Downloads'),
    require('path').join(require('os').homedir(), 'Desktop')
  ];
  for (const dir of scanDirs) {
    try {
      const files = fs.readdirSync(dir).filter(f => f.startsWith('epieos_') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = JSON.parse(fs.readFileSync(require('path').join(dir, file), 'utf8'));
          const q = content.metadata?.query || '';
          if (q.toLowerCase() === email.toLowerCase() && content.data) {
            // Parse Epieos format
            const v = content.data.visitor || {};
            if (v.google?.id) {
              sites.push({ site: 'Google', username: email, url: `https://www.google.com/maps/contrib/${v.google.id}`, note: `Google ID: ${v.google.id}` });
              if (v.google.services) {
                Object.entries(v.google.services).forEach(([svc, url]) => {
                  sites.push({ site: svc.replace(/_/g, ' '), username: email, url, note: 'Google Servisi' });
                });
              }
            }
            // Parse Holehe results if present
            const holehe = content.data.holehe || content.data.sites || [];
            holehe.forEach(h => {
              if (h.exists || h.registered) {
                sites.push({ site: h.name || h.website || h.site, username: h.username || email.split('@')[0], url: h.url || null, note: h.rateLimit ? '⚡ Rate limited' : '' });
              }
            });
          }
        } catch {}
      }
    } catch {}
  }

  // 3. GitHub email search
  try {
    const ghData = await httpsGet('api.github.com', `/search/users?q=${encodeURIComponent(email)}+in:email&per_page=5`, { 'User-Agent': 'OSINT-Tool/1.0', 'Accept': 'application/vnd.github.v3+json' });
    if (ghData && ghData.items && ghData.items.length > 0) {
      ghData.items.slice(0, 3).forEach(u => {
        sites.push({ site: 'GitHub', username: u.login, url: u.html_url, note: 'GitHub hesabı' });
      });
    }
  } catch {}

  // 4. Duolingo - two-step full profile lookup
  try {
    const duoHeaders = {
      'User-Agent': ua,
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.duolingo.com/',
      'Origin': 'https://www.duolingo.com',
      'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    };
    // Step 1: get user ID from email
    const duoStep1 = await httpsGetWithStatus('www.duolingo.com', `/2017-06-30/users?email=${encodeURIComponent(email)}&fields=id,username,name,learning_language,site_streak,total_xp,has_phone_number,email,created`, duoHeaders);
    if (duoStep1.status === 200 && duoStep1.body) {
      const duoData1 = JSON.parse(duoStep1.body);
      const users = duoData1.users || [];
      for (const u of users.slice(0, 2)) {
        const uid = u.id;
        let fullProfile = u;
        // Step 2: get full profile by user ID
        if (uid) {
          try {
            const duoStep2 = await httpsGetWithStatus('www.duolingo.com',
              `/2017-06-30/users/${uid}?fields=id,username,name,bio,location,learning_language,site_streak,longest_streak,total_xp,has_phone_number,created,courses,picture`,
              duoHeaders);
            if (duoStep2.status === 200 && duoStep2.body) {
              fullProfile = JSON.parse(duoStep2.body);
            }
          } catch {}
        }
        const courses = (fullProfile.courses || []).map(c => c.title || c.language_string || c.id).filter(Boolean).join(', ');
        const note = [
          fullProfile.name ? `Ad: ${fullProfile.name}` : null,
          fullProfile.total_xp ? `XP: ${fullProfile.total_xp}` : null,
          fullProfile.site_streak != null ? `Streak: ${fullProfile.site_streak}` : null,
          courses ? `Diller: ${courses}` : null,
          fullProfile.location ? `Konum: ${fullProfile.location}` : null,
          fullProfile.has_phone_number ? '📱 Telefon bağlı' : null
        ].filter(Boolean).join(' · ');
        sites.push({
          site: 'Duolingo',
          username: fullProfile.username || u.username,
          url: `https://www.duolingo.com/profile/${fullProfile.username || u.username}`,
          note
        });
      }
    }
  } catch {}

  // 5. Spotify check
  try {
    const spBody = `validate=1&email=${encodeURIComponent(email)}&displayname=test&password=Test1234&gender=neutral&birthday=1990-01-01`;
    const spResult = await new Promise((resolve) => {
      const spReq = require('https').request({
        hostname: 'spclient.wg.spotify.com',
        path: '/signup/public/v1/account',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': ua, 'Content-Length': Buffer.byteLength(spBody) }
      }, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      spReq.on('error', () => resolve(null));
      spReq.write(spBody);
      spReq.end();
    });
    if (spResult && spResult.errors && spResult.errors.email) {
      sites.push({ site: 'Spotify', username: email.split('@')[0], url: null, note: 'E-posta kullanımda' });
    }
  } catch {}

  // 6. Adobe check
  try {
    const adobeResult = await httpsGetWithStatus('auth.services.adobe.com', `/lookup/v3/users?id=${encodeURIComponent(email)}`, { 'User-Agent': ua, 'Accept': 'application/json', 'X-IMS-ClientId': 'adobeio-app' });
    if (adobeResult.status === 200) {
      try {
        const adobeData = JSON.parse(adobeResult.body);
        if (adobeData.type === 'adobeID' || adobeData.account) {
          sites.push({ site: 'Adobe', username: email.split('@')[0], url: null, note: 'Adobe hesabı mevcut' });
        }
      } catch {}
    }
  } catch {}

  const out = { email, sites, total: sites.length };
  socialCache[email] = out;
  res.json(out);
});

// ─── Email Database Search - Find all records with this email ───────────────

app.get('/api/osint/email-db', (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const lowerEmail = email.toLowerCase();
    const results = [];
    let totalMatches = 0;

    for (const tableName of Object.keys(jsDb)) {
      const table = jsDb[tableName];
      if (!table.rows.length) continue;

      // Find email-related columns
      const emailCols = table.columns.filter(c => 
        c.name.toLowerCase().includes('email') || 
        c.name.toLowerCase().includes('mail')
      ).map(c => c.name);

      if (emailCols.length === 0) continue;

      const matched = [];
      for (const row of table.rows) {
        const matchedCols = emailCols.filter(col => {
          const v = row[col];
          if (!v) return false;
          return String(v).toLowerCase() === lowerEmail;
        });

        if (matchedCols.length > 0) {
          matched.push({ row, matchedCols });
          totalMatches++;
        }
      }

      if (matched.length > 0) {
        results.push({
          table: tableName,
          columns: table.columns,
          matches: matched,
          total: matched.length
        });
      }
    }

    res.json({
      email,
      tableCount: results.length,
      totalMatches,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// ─── Upload endpoint - TEMPORARILY ENABLED ───────────────────────────────────────

app.post('/api/upload-sql', upload.single('sqlFile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const filePath = req.file.path;
    const sqlContent = fs.readFileSync(filePath, 'utf8');
    
    // Parse and load the SQL
    const newDb = parseDump(sqlContent);
    jsDb = newDb;
    
    // Save to last.sql for auto-load
    fs.writeFileSync(LAST_SQL, sqlContent);
    
    const tableNames = Object.keys(jsDb);
    const rowCounts = {};
    tableNames.forEach(t => { rowCounts[t] = jsDb[t].rows.length; });
    
    // Clean up temp file
    fs.unlinkSync(filePath);
    
    res.json({ 
      message: `SQL loaded successfully! ${tableNames.length} tables, ${Object.values(rowCounts).reduce((a,b)=>a+b,0)} rows`,
      tables: tableNames,
      rowCounts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DB status (for frontend auto-detect) ────────────────────────────────────

app.get('/api/status', (req, res) => {
  loadSQL(); // Lazy load
  const tableNames = Object.keys(jsDb);
  if (tableNames.length === 0) return res.json({ loaded: false, loading: sqlLoading });
  const rowCounts = {};
  tableNames.forEach(t => { rowCounts[t] = jsDb[t].rows.length; });
  res.json({ loaded: true, tables: tableNames, rowCounts });
});

// ─── Tables list ──────────────────────────────────────────────────────────────

app.get('/api/tables', (req, res) => {
  if (!jsDb) return res.status(400).json({ error: 'No database loaded' });
  res.json({ tables: Object.keys(jsDb) });
});

// ─── Discord Webhook Logger ───────────────────────────────────────────────────

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1486455638773989456/dqCWgUBOJZqrrL4stEOcnvt22sk8y3-RxWjP1huntXtHH6T0pHECgO29FRdjE-Ma2mOH';

function sendWebhookLog(embed) {
  try {
    const body = JSON.stringify({ embeds: [embed] });
    const url = new URL(DISCORD_WEBHOOK);
    const req = require('https').request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); });
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {}
}

// ─── Global search across ALL tables - FIXED for ID search ─────────────────────────────────────────

app.get('/api/search-everywhere', (req, res) => {
  try {
    loadSQL(); // Lazy load
    const { value } = req.query;
    if (!value) return res.status(400).json({ error: 'Missing value' });

    const lowerVal = value.toLowerCase();
    const results = [];
    let totalMatches = 0;

    for (const tableName of Object.keys(jsDb)) {
      if (totalMatches >= 5) break;
      
      const table = jsDb[tableName];
      if (!table.rows.length) continue;

      // Search ALL columns
      const searchCols = table.columns.map(c => c.name);
      const matched = [];

      for (const row of table.rows) {
        if (matched.length >= 5 - totalMatches) break;
        
        const matchedCols = searchCols.filter(col => {
          const v = row[col];
          if (v === null || v === undefined) return false;
          const strVal = String(v);
          // Exact match for IDs, partial for others
          if (col.toLowerCase().includes('id')) {
            return strVal === value || strVal.toLowerCase() === lowerVal;
          } else {
            return strVal.toLowerCase().includes(lowerVal);
          }
        });
        
        if (matchedCols.length > 0) {
          matched.push({ row, matchedCols });
        }
      }

      if (matched.length > 0) {
        results.push({
          table: tableName,
          columns: table.columns,
          matches: matched,
          total: matched.length
        });
        totalMatches += matched.length;
      }
    }

    const response = {
      value,
      tableCount: results.length,
      totalMatches,
      results,
      note: `Found ${totalMatches} matches (max 5)`
    };
    res.json(response);

    // ── Discord webhook log ──
    try {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
               || req.headers['x-real-ip']
               || req.socket?.remoteAddress
               || 'Bilinmiyor';

      const now = new Date();
      const ts = `<t:${Math.floor(now.getTime()/1000)}:F>`;

      const fields = [
        { name: '🔍 Aranan Değer', value: `\`${value}\``, inline: true },
        { name: '🌐 IP Adresi', value: `\`${ip}\``, inline: true },
        { name: '⏰ Zaman', value: ts, inline: true },
        { name: '📊 Sonuç', value: totalMatches > 0 ? `**${totalMatches}** eşleşme · **${results.length}** tablo` : '❌ Sonuç bulunamadı', inline: false },
      ];

      if (totalMatches > 0) {
        const detail = results.map(r => {
          const preview = r.matches.slice(0, 2).map(m => {
            const cols = Object.entries(m.row)
              .filter(([k, v]) => v !== null && v !== undefined && String(v).trim() !== '')
              .slice(0, 5)
              .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
              .join('\n');
            return cols;
          }).join('\n---\n');
          return `**${r.table}** (${r.total} kayıt)\n\`\`\`\n${preview.slice(0, 800)}\n\`\`\``;
        }).join('\n').slice(0, 2000);
        fields.push({ name: '📋 Bulunan Veriler', value: detail, inline: false });
      }

      sendWebhookLog({
        title: totalMatches > 0 ? '🔴 Sorgu Logu — Sonuç Bulundu' : '🟡 Sorgu Logu — Sonuç Yok',
        color: totalMatches > 0 ? 0xe03d3d : 0xf59e0b,
        fields,
        footer: { text: 'Zagros OSINT Platform' },
        timestamp: now.toISOString()
      });
    } catch {}

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Search all columns (ID Sorgu) - LIMITED to max 5 results ───────────────────

app.get('/api/table/:tableName/search-all', (req, res) => {
  try {
    const { tableName } = req.params;
    const { value, id } = req.query;
    const searchValue = value || id;
    if (!jsDb[tableName]) return res.status(404).json({ error: 'Table not found' });
    if (!searchValue) return res.status(400).json({ error: 'Missing id or value parameter' });

    // Security: limit search to specific ID-like columns if 'id' parameter used
    let searchCols;
    if (id) {
      // Only search columns that likely contain IDs
      const allCols = jsDb[tableName].columns.map(c => c.name);
      const idLikeCols = allCols.filter(c => 
        c.toLowerCase().includes('id') || 
        c.toLowerCase().includes('user') ||
        c.toLowerCase().includes('discord') ||
        c.toLowerCase().includes('email')
      );
      searchCols = idLikeCols.length > 0 ? idLikeCols : allCols.slice(0, 3);
    } else {
      searchCols = jsDb[tableName].columns.map(c => c.name).slice(0, 5);
    }
    
    const lowerVal = searchValue.toLowerCase();

    const matched = jsDb[tableName].rows.filter(row =>
      searchCols.some(col => {
        const v = row[col];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(lowerVal);
      })
    );

    // Security: max 5 results to prevent data harvesting
    const limitedResults = matched.slice(0, 5);

    res.json({
      found: limitedResults.length,
      data: limitedResults,
      columns: jsDb[tableName].columns,
      searchedColumns: searchCols,
      totalInDatabase: matched.length,
      note: 'Results limited to 5 max for security'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Table data - DISABLED (no full data download) ───────────────────────────────

app.get('/api/table/:tableName', (req, res) => {
  res.status(403).json({ error: 'Full table access disabled. Use /api/table/:table/search-all?id=xxx' });
});

// ─── Custom query - DISABLED (no SQL queries allowed) ─────────────────────────────

app.post('/api/query', (req, res) => {
  res.status(403).json({ error: 'Custom queries disabled. Use ID search only.' });
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
