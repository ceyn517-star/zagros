import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Database, Upload, Search, Play, Table, Download, Fingerprint, Mail, MapPin, Wifi, User, Hash } from 'lucide-react';
import './App.css';

function App() {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableData, setTableData] = useState({ columns: [], data: [], total: 0 });
  const [searchTerm, setSearchTerm] = useState('');
  const [searchColumn, setSearchColumn] = useState('');
  const [idQuery, setIdQuery] = useState('');
  const [idResult, setIdResult] = useState(null);
  const [idTable, setIdTable] = useState('');
  const [rowCounts, setRowCounts] = useState({});
  const [ipGeoCache, setIpGeoCache] = useState({});
  const [osintCache, setOsintCache] = useState({});
  const [breachCache, setBreachCache] = useState({});
  const [crtshCache, setCrtshCache] = useState({});
  const [disifyCache, setDisifyCache] = useState({});
  const [discordCache, setDiscordCache] = useState({});
  const [customQuery, setCustomQuery] = useState('');
  const [queryResult, setQueryResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [view, setView] = useState('idquery');

  const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : '/api';
  const ITEMS_PER_PAGE = 100;

  // Auto-detect already loaded DB on mount
  useEffect(() => {
    axios.get(`${API_URL}/status`).then(r => {
      if (r.data.loaded) {
        setTables(r.data.tables);
        setRowCounts(r.data.rowCounts || {});
        setMessage('✓ Veritabanı otomatik yüklendi');
        setTimeout(() => setMessage(''), 3000);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line

  const lookupIp = async (ip) => {
    if (ipGeoCache[ip] !== undefined) return;
    setIpGeoCache(prev => ({ ...prev, [ip]: 'loading' }));
    try {
      const r = await axios.get(`${API_URL}/iplookup`, { params: { ip } });
      setIpGeoCache(prev => ({ ...prev, [ip]: r.data.status === 'success' ? r.data : null }));
    } catch {
      setIpGeoCache(prev => ({ ...prev, [ip]: null }));
    }
  };

  const IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const IP6_RE = /^[0-9a-fA-F:]{6,}$/;
  const isIP = (s) => IP_RE.test(s) || IP6_RE.test(s);

  const tryDecode = (val) => {
    if (!val || typeof val !== 'string') return null;
    if (val.length < 8) return null;
    if (!/^[A-Za-z0-9+/]+=*$/.test(val)) return null;
    try {
      const decoded = atob(val);
      if (/^[\x20-\x7E]+$/.test(decoded) && decoded.length >= 4) {
        if (decoded.includes('@') || IP_RE.test(decoded) || decoded.length >= 6) return decoded;
      }
    } catch {}
    return null;
  };

  const fetchBreach = async (email) => {
    if (breachCache[email] !== undefined) return;
    setBreachCache(prev => ({ ...prev, [email]: 'loading' }));
    try {
      const r = await axios.get(`${API_URL}/osint/breach`, { params: { email }, timeout: 15000 });
      setBreachCache(prev => ({ ...prev, [email]: r.data }));
    } catch {
      setBreachCache(prev => ({ ...prev, [email]: { breaches: [], found: false } }));
    }
  };

  const fetchCrtsh = async (email) => {
    if (crtshCache[email] !== undefined) return;
    setCrtshCache(prev => ({ ...prev, [email]: 'loading' }));
    try {
      const r = await axios.get(`${API_URL}/osint/crtsh`, { params: { email }, timeout: 15000 });
      setCrtshCache(prev => ({ ...prev, [email]: r.data }));
    } catch {
      setCrtshCache(prev => ({ ...prev, [email]: { records: [], total: 0 } }));
    }
  };

  const fetchDisify = async (email) => {
    if (disifyCache[email] !== undefined) return;
    setDisifyCache(prev => ({ ...prev, [email]: 'loading' }));
    try {
      const r = await axios.get(`${API_URL}/osint/disify`, { params: { email }, timeout: 10000 });
      setDisifyCache(prev => ({ ...prev, [email]: r.data }));
    } catch {
      setDisifyCache(prev => ({ ...prev, [email]: null }));
    }
  };

  const fetchOsint = async (email) => {
    if (osintCache[email] !== undefined) return;
    setOsintCache(prev => ({ ...prev, [email]: 'loading' }));
    try {
      const r = await axios.get(`${API_URL}/osint/email`, { params: { email } });
      setOsintCache(prev => ({ ...prev, [email]: r.data }));
    } catch {
      setOsintCache(prev => ({ ...prev, [email]: null }));
    }
  };

  const fetchDiscord = async (id) => {
    if (discordCache[id] !== undefined) return;
    setDiscordCache(prev => ({ ...prev, [id]: 'loading' }));
    try {
      const r = await axios.get(`${API_URL}/osint/discord`, { params: { id }, timeout: 10000 });
      setDiscordCache(prev => ({ ...prev, [id]: r.data }));
    } catch {
      setDiscordCache(prev => ({ ...prev, [id]: null }));
    }
  };

  const DISCORD_ID_RE = /^\d{15,20}$/;

  useEffect(() => {
    if (!idResult || !idResult.results) return;
    const ips = new Set();
    const emails = new Set();
    const discordIds = new Set();
    idResult.results.forEach(tr => {
      tr.matches.forEach(m => {
        tr.columns.forEach(col => {
          const raw = String(m.row[col.name] ?? '');
          const dec = tryDecode(raw);
          const display = dec || raw;
          const colL = col.name.toLowerCase();
          if (isIP(display)) ips.add(display);
          if (display.includes('@') && display.includes('.')) emails.add(display);
          if (DISCORD_ID_RE.test(raw) || ((colL.includes('discord') || colL === 'id' || colL.includes('uid')) && DISCORD_ID_RE.test(raw))) {
            discordIds.add(raw);
          }
        });
      });
    });
    ips.forEach(ip => lookupIp(ip));
    emails.forEach(email => {
      fetchOsint(email);
      fetchBreach(email);
      fetchCrtsh(email);
      fetchDisify(email);
    });
    discordIds.forEach(id => fetchDiscord(id));
  }, [idResult]); // eslint-disable-line


  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('sqlFile', file);

    setLoading(true);
    setMessage('');

    try {
      const response = await axios.post(`${API_URL}/upload-sql`, formData);
      setTables(response.data.tables);
      setRowCounts(response.data.rowCounts || {});
      setMessage('✓ ' + response.data.message);
      setView('idquery');
    } catch (error) {
      setMessage('✗ Hata: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const loadTableData = async (tableName, page = 0) => {
    setLoading(true);
    try {
      const params = {
        limit: ITEMS_PER_PAGE,
        offset: page * ITEMS_PER_PAGE
      };

      if (searchTerm && searchColumn) {
        params.search = searchTerm;
        params.column = searchColumn;
      }

      const response = await axios.get(`${API_URL}/table/${tableName}`, { params });
      setTableData(response.data);
      setSelectedTable(tableName);
      setCurrentPage(page);
      setView('tables');
    } catch (error) {
      setMessage('✗ Hata: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const executeQuery = async () => {
    if (!customQuery.trim()) return;

    setLoading(true);
    setQueryResult(null);
    setMessage('');

    try {
      const response = await axios.post(`${API_URL}/query`, { query: customQuery });
      setQueryResult(response.data);
      setMessage(response.data.message || '✓ Sorgu başarıyla çalıştırıldı!');
    } catch (error) {
      setMessage('✗ Hata: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    if (selectedTable) {
      loadTableData(selectedTable, 0);
    }
  };

  const exportToCSV = () => {
    const data = queryResult?.data || tableData.data;
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(h => JSON.stringify(row[h] || '')).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export_${Date.now()}.csv`;
    a.click();
  };

  const totalPages = Math.ceil(tableData.total / ITEMS_PER_PAGE);

  const idKeywords = ['id', 'uid', 'user', 'discord', 'member', 'hash', 'token', 'key', 'mail', 'ip', 'pass', 'name', 'tag'];

  const getIdColumns = (tableName) => {
    const t = tables.find ? tableName : null;
    return [];
  };

  const handleIdQuery = async () => {
    if (!idQuery.trim()) return;
    setLoading(true);
    setIdResult(null);
    try {
      const response = await axios.get(`${API_URL}/search-everywhere`, {
        params: { value: idQuery.trim() }
      });
      setIdResult(response.data);
    } catch (error) {
      setMessage('\u2717 Hata: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const allIdColumns = tableData.columns.filter(col =>
    idKeywords.some(kw => col.name.toLowerCase().includes(kw))
  );
  const searchAllColumns = allIdColumns.length > 0 ? allIdColumns : tableData.columns;

  const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="inv-app">
      {/* ── Top bar ── */}
      <header className="inv-header">
        <div className="inv-header-left">
          <Fingerprint size={22} />
          <span className="inv-title">Zagros</span>
        </div>
        <div className="inv-header-right">
          {tables.length > 0 && (
            <span className="inv-db-status">
              <Database size={14}/> {tables.length} tablo · {totalRows.toLocaleString()} kayıt
            </span>
          )}
          <label className="inv-upload-btn">
            <Upload size={16} />
            <span>{tables.length > 0 ? 'Yeni SQL' : 'SQL Yükle'}</span>
            <input type="file" accept=".sql" onChange={handleFileUpload} hidden />
          </label>
        </div>
      </header>

      {message && (
        <div className={`inv-msg ${message.startsWith('✓') ? 'inv-msg-ok' : 'inv-msg-err'}`}>
          {message}
          <button onClick={() => setMessage('')} className="inv-msg-close">✕</button>
        </div>
      )}

      <main className="inv-main">
        {loading && <div className="inv-loading">Taranıyor...</div>}

        {/* ── No DB loaded ── */}
        {tables.length === 0 && !loading && (
          <div className="inv-welcome">
            <Fingerprint size={72} className="inv-welcome-icon" />
            <h2>Zagros OSINT Sorgu</h2>
            <p>Başlamak için bir SQL dump dosyası yükleyin</p>
            <label className="inv-welcome-upload">
              <Upload size={20} />
              <span>SQL Dosyası Seç</span>
              <input type="file" accept=".sql" onChange={handleFileUpload} hidden />
            </label>
          </div>
        )}

        {/* ── Main query interface ── */}
        {tables.length > 0 && (
          <div className="inv-query-area">
            {/* Search bar */}
            <div className="inv-search-box">
              <div className="inv-search-row">
                <Fingerprint size={20} className="inv-search-icon" />
                <input
                  type="text"
                  placeholder="ID, e-mail, IP, username, Discord ID, hash..."
                  value={idQuery}
                  onChange={(e) => setIdQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleIdQuery()}
                  className="inv-search-input"
                  autoFocus
                />
                <button onClick={handleIdQuery} className="inv-search-btn" disabled={loading}>
                  <Search size={18} /> Sorgula
                </button>
                {idResult && (
                  <button onClick={() => { setIdResult(null); setIdQuery(''); }} className="inv-clear-btn">✕</button>
                )}
              </div>
              <div className="inv-osint-status">
                <span className="inv-osint-tag">🎮 Discord</span>
                <span className="inv-osint-tag">🛡️ Breach</span>
                <span className="inv-osint-tag">🔍 EmailRep</span>
                <span className="inv-osint-tag">📧 Disify</span>
                <span className="inv-osint-tag">🔐 crt.sh</span>
                <span className="inv-osint-tag">🌐 IP-Geo</span>
                <span className="inv-osint-auto">Zagros · Otomatik OSINT</span>
              </div>
            </div>

            {/* ── Results ── */}
            {idResult && idResult.results && (
              <div className="inv-results">
                <div className="inv-summary">
                  <strong>{idResult.totalMatches} eşleşme</strong> — "{idResult.value}" — {idResult.tableCount} tablo
                  <button onClick={() => {
                    const rows = [];
                    idResult.results.forEach(r => r.matches.forEach(m => rows.push({ _tablo: r.table, _eslesen: m.matchedCols.join('|'), ...m.row })));
                    if (!rows.length) return;
                    const headers = Object.keys(rows[0]);
                    const csv = [headers.join(','), ...rows.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','))].join('\n');
                    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); a.download = `osint_${Date.now()}.csv`; a.click();
                  }} className="inv-csv-btn">
                    <Download size={14} /> CSV
                  </button>
                </div>

                {idResult.totalMatches === 0 && (
                  <div className="inv-empty">Sonuç bulunamadı.</div>
                )}

                {idResult.results.map(tableResult => (
                  <div key={tableResult.table} className="inv-table-group">
                    <div className="inv-table-title">
                      <Table size={14} />
                      <strong>{tableResult.table}</strong>
                      <span className="inv-match-count">{tableResult.total} kayıt</span>
                    </div>

                    {tableResult.matches.map((match, idx) => {
                      const row = match.row;
                      const cols = tableResult.columns;
                      const emailFields = [], ipFields = [], discordFields = [], nameFields = [], otherFields = [];

                      cols.forEach(col => {
                        const raw = String(row[col.name] ?? '');
                        const dec = tryDecode(raw);
                        const display = dec || raw;
                        const colL = col.name.toLowerCase();
                        const isMatched = match.matchedCols.includes(col.name);
                        const entry = { col, raw, dec, display, isMatched };
                        if (display.includes('@') || colL.includes('mail') || colL.includes('email')) emailFields.push(entry);
                        else if (isIP(display) || (colL.includes('ip') && !colL.includes('zip'))) ipFields.push(entry);
                        else if (/^\d{15,20}$/.test(raw) || colL.includes('discord') || colL.includes('uid')) discordFields.push(entry);
                        else if (colL.includes('user') || colL.includes('name') || colL.includes('nick') || colL.includes('tag') || colL.includes('login')) nameFields.push(entry);
                        else otherFields.push(entry);
                      });

                      const renderField = (e) => (
                        <span className={e.isMatched ? 'pcard-val matched' : 'pcard-val'}>
                          {e.dec
                            ? <><span className="pcard-decoded">{e.display}</span><span className="pcard-b64"> ({e.raw})</span></>
                            : e.display || <span style={{color:'#4a5568'}}>—</span>}
                        </span>
                      );

                      return (
                        <div key={idx} className="profile-card">
                          {discordFields.length > 0 && (
                            <div className="pcard-section pcard-discord">
                              <div className="pcard-section-title"><Hash size={13}/> Discord</div>
                              {discordFields.map(e => {
                                const did = DISCORD_ID_RE.test(e.raw) ? e.raw : null;
                                const dc = did ? discordCache[did] : null;
                                return (
                                  <div key={e.col.name} className="discord-block">
                                    <div className="pcard-row"><span className="pcard-label">{e.col.name}</span>{renderField(e)}</div>
                                    {dc && dc !== 'loading' && (
                                      <div className="discord-info">
                                        {dc.avatar && <img src={dc.avatar} alt="" className="discord-avatar" />}
                                        <div className="discord-details">
                                          {dc.username && <span className="discord-username">{dc.globalName || dc.username}</span>}
                                          {dc.username && dc.globalName && <span className="discord-tag">@{dc.username}</span>}
                                          {dc.createdAt && <span className="discord-created">Oluşturulma: {dc.createdAt.slice(0,10)}</span>}
                                          {dc.bot && <span className="discord-bot-badge">BOT</span>}
                                          {!dc.found && dc.createdAt && <span className="discord-created">Snowflake: {dc.createdAt.slice(0,10)}</span>}
                                        </div>
                                      </div>
                                    )}
                                    {dc === 'loading' && <div className="osint-scanning">Discord aranıyor...</div>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {nameFields.length > 0 && (
                            <div className="pcard-section pcard-name">
                              <div className="pcard-section-title"><User size={13}/> Kullanıcı</div>
                              {nameFields.map(e => (
                                <div key={e.col.name} className="pcard-row"><span className="pcard-label">{e.col.name}</span>{renderField(e)}</div>
                              ))}
                            </div>
                          )}
                          {emailFields.length > 0 && (
                            <div className="pcard-section pcard-email">
                              <div className="pcard-section-title"><Mail size={13}/> E-Mail</div>
                              {emailFields.map(e => {
                                const emailVal = e.display.includes('@') ? e.display.trim() : null;
                                const osint = emailVal ? osintCache[emailVal] : null;
                                return (
                                  <div key={e.col.name} className="pcard-email-block">
                                    <div className="pcard-row">
                                      <span className="pcard-label">{e.col.name}</span>
                                      {renderField(e)}
                                      {emailVal && !osint && (
                                        <button className="osint-run-btn" onClick={() => fetchOsint(emailVal)}>🔍 OSINT</button>
                                      )}
                                      {emailVal && osint && osint !== 'loading' && (
                                        <button className="osint-run-btn" onClick={() => {
                                          setOsintCache(prev => { const n = {...prev}; delete n[emailVal]; return n; });
                                          setTimeout(() => fetchOsint(emailVal), 50);
                                        }}>🔄</button>
                                      )}
                                    </div>
                                    {/* Disify email validation */}
                                    {emailVal && (() => {
                                      const ds = disifyCache[emailVal];
                                      return ds && ds !== 'loading' && !ds.error ? (
                                        <div className="disify-row">
                                          <span className={`osint-badge ${ds.format ? 'badge-ok' : 'badge-danger'}`}>{ds.format ? '✅ Format geçerli' : '❌ Format hatalı'}</span>
                                          <span className={`osint-badge ${ds.disposable ? 'badge-danger' : 'badge-ok'}`}>{ds.disposable ? '🔴 Tek kullanımlık' : '🟢 Gerçek email'}</span>
                                          <span className={`osint-badge ${ds.dns ? 'badge-ok' : 'badge-warn'}`}>{ds.dns ? '✅ DNS aktif' : '⚠️ DNS yok'}</span>
                                        </div>
                                      ) : ds === 'loading' ? <div className="osint-scanning">📧 Disify taranıyor...</div> : null;
                                    })()}
                                    {/* XposedOrNot Breach results */}
                                    {emailVal && (() => {
                                      const br = breachCache[emailVal];
                                      if (!br) return null;
                                      if (br === 'loading') return <div className="osint-scanning">�️ Breach taranıyor...</div>;
                                      if (!br.found) return <div className="breach-panel"><div className="breach-ok">🟢 Bilinen sızıntı bulunamadı</div></div>;
                                      return (
                                        <div className="breach-panel">
                                          <div className="breach-title">🛡️ <strong>{br.total}</strong> sızıntıda bulundu</div>
                                          <div className="breach-list">
                                            {br.breaches.map((b, i) => (
                                              <div key={i} className="breach-item">
                                                <span className="breach-name">{b.name}</span>
                                                <span className="breach-domain">{b.domain}</span>
                                                <span className="breach-date">{b.date}</span>
                                                {b.records > 0 && <span className="breach-records">{Number(b.records).toLocaleString()} kayıt</span>}
                                                <span className="breach-data">{b.dataTypes}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                    {/* crt.sh certificate transparency */}
                                    {emailVal && (() => {
                                      const ct = crtshCache[emailVal];
                                      if (!ct) return null;
                                      if (ct === 'loading') return <div className="osint-scanning">🔐 crt.sh taranıyor...</div>;
                                      return ct.total > 0 ? (
                                        <div className="crtsh-panel">
                                          <div className="crtsh-title">🔐 SSL/TLS Sertifika: <strong>{ct.total}</strong> kayıt ({ct.domain})</div>
                                          <div className="crtsh-list">
                                            {ct.records.slice(0, 10).map((r, i) => (
                                              <div key={i} className="crtsh-item">
                                                <span className="crtsh-cn">{r.cn}</span>
                                                <span className="crtsh-dates">{r.notBefore?.slice(0,10)} → {r.notAfter?.slice(0,10)}</span>
                                              </div>
                                            ))}
                                            {ct.total > 10 && <div className="crtsh-more">+{ct.total - 10} daha...</div>}
                                          </div>
                                        </div>
                                      ) : null;
                                    })()}
                                    {/* EmailRep OSINT */}
                                    {emailVal && (() => {
                                      if (osint === 'loading') return <div className="osint-scanning">🔍 emailrep.io taranıyor...</div>;
                                      return osint && osint !== 'loading' ? (
                                        <div className="osint-panel">
                                          <div className="osint-result-full">
                                            <div className="osint-row">
                                              <span className={`osint-badge ${osint.details?.credentials_leaked ? 'badge-danger' : 'badge-ok'}`}>{osint.details?.credentials_leaked ? '🔴 Sızıntı VAR' : '🟢 Sızıntı yok'}</span>
                                              <span className={`osint-badge ${osint.details?.data_breach ? 'badge-danger' : 'badge-ok'}`}>{osint.details?.data_breach ? '🔴 Breach' : '🟢 Breach yok'}</span>
                                              <span className={`osint-badge ${osint.suspicious ? 'badge-warn' : 'badge-ok'}`}>{osint.suspicious ? '⚠️ Şüpheli' : '✅ Güvenilir'}</span>
                                              {osint.references > 0 && <span className="osint-badge badge-info">📌 {osint.references} ref</span>}
                                            </div>
                                            {osint.details?.profiles?.length > 0 && (
                                              <div className="osint-profiles">
                                                <span className="osint-profiles-title">Platformlar:</span>
                                                {osint.details.profiles.map(p => <span key={p} className="osint-profile-tag">{p}</span>)}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      ) : null;
                                    })()}
                                    {/* Quick links */}
                                    {emailVal && (
                                      <div className="osint-links">
                                        {[
                                          { label: '🔍 Google', url: `https://www.google.com/search?q=%22${encodeURIComponent(emailVal)}%22` },
                                          { label: '💧 HIBP', url: `https://haveibeenpwned.com/account/${encodeURIComponent(emailVal)}` },
                                          { label: '🐙 GitHub', url: `https://github.com/search?q=${encodeURIComponent(emailVal)}&type=users` },
                                          { label: '💼 LinkedIn', url: `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(emailVal)}` },
                                          { label: '🐦 X', url: `https://x.com/search?q=${encodeURIComponent(emailVal)}` },
                                          { label: '✈️ Telegram', url: `https://t.me/${encodeURIComponent(emailVal.split('@')[0])}` },
                                        ].map(lnk => <a key={lnk.label} href={lnk.url} target="_blank" rel="noopener noreferrer" className="osint-link">{lnk.label}</a>)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {ipFields.length > 0 && (
                            <div className="pcard-section pcard-ip">
                              <div className="pcard-section-title"><Wifi size={13}/> IP</div>
                              {ipFields.map(e => {
                                const ipVal = isIP(e.display) ? e.display : null;
                                const geo = ipVal ? ipGeoCache[ipVal] : null;
                                return (
                                  <div key={e.col.name} className="pcard-ip-block">
                                    <div className="pcard-row"><span className="pcard-label">{e.col.name}</span>{renderField(e)}</div>
                                    {geo && geo !== 'loading' && (
                                      <div className="pcard-geo">
                                        <MapPin size={12}/> {[geo.city, geo.regionName, geo.country].filter(Boolean).join(', ')}
                                        {geo.isp && <span className="geo-isp"> · {geo.isp}</span>}
                                      </div>
                                    )}
                                    {geo === 'loading' && <div className="pcard-geo geo-loading">konum yükleniyor...</div>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {otherFields.length > 0 && (
                            <div className="pcard-other">
                              {otherFields.map(e => (
                                <span key={e.col.name} className={`pcard-other-item${e.isMatched ? ' matched' : ''}`}>
                                  <span className="pcard-other-key">{e.col.name}:</span> {e.display || '—'}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* ── OSINT Summary Table ── */}
            {idResult && idResult.results && (() => {
              const allEmails = new Set();
              const allIps = new Set();
              const allDiscords = new Set();
              idResult.results.forEach(tr => {
                tr.matches.forEach(m => {
                  tr.columns.forEach(col => {
                    const raw = String(m.row[col.name] ?? '');
                    const dec = tryDecode(raw);
                    const display = dec || raw;
                    if (display.includes('@') && display.includes('.')) allEmails.add(display.trim());
                    if (isIP(display)) allIps.add(display);
                    if (DISCORD_ID_RE.test(raw)) allDiscords.add(raw);
                  });
                });
              });
              if (allEmails.size === 0 && allIps.size === 0 && allDiscords.size === 0) return null;
              return (
                <div className="osint-summary-section">
                  <div className="osint-summary-title">📊 OSINT Özet Tablosu</div>

                  {/* Email OSINT Table */}
                  {allEmails.size > 0 && (
                    <div className="osint-table-block">
                      <div className="osint-table-heading">📧 E-Mail OSINT</div>
                      <div className="osint-table-wrap">
                        <table className="osint-table">
                          <thead>
                            <tr>
                              <th>Email</th>
                              <th>Doğrulama</th>
                              <th>Sızıntı</th>
                              <th>Breach Sayısı</th>
                              <th>Breach Listesi</th>
                              <th>İtibar</th>
                              <th>Platformlar</th>
                              <th>SSL Sertifika</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...allEmails].map(email => {
                              const ds = disifyCache[email];
                              const br = breachCache[email];
                              const os = osintCache[email];
                              const ct = crtshCache[email];
                              const dsOk = ds && ds !== 'loading';
                              const brOk = br && br !== 'loading';
                              const osOk = os && os !== 'loading';
                              const ctOk = ct && ct !== 'loading';
                              return (
                                <tr key={email}>
                                  <td className="osint-td-email">{email}</td>
                                  <td>
                                    {dsOk ? (
                                      <span className={ds.disposable ? 'ot-bad' : 'ot-good'}>
                                        {ds.disposable ? '⚠ Tek kullanımlık' : '✅ Gerçek'}
                                        {ds.dns === false && ' · DNS yok'}
                                      </span>
                                    ) : ds === 'loading' ? '⏳' : '—'}
                                  </td>
                                  <td>
                                    {brOk ? (
                                      <span className={br.found ? 'ot-bad' : 'ot-good'}>
                                        {br.found ? `🔴 ${br.total} sızıntı` : '🟢 Temiz'}
                                      </span>
                                    ) : br === 'loading' ? '⏳' : '—'}
                                  </td>
                                  <td>
                                    {brOk && br.found ? br.breaches.map(b => b.name).slice(0, 5).join(', ') + (br.total > 5 ? ` +${br.total - 5}` : '') : '—'}
                                  </td>
                                  <td>
                                    {brOk && br.found ? (
                                      <div className="ot-breach-list">
                                        {br.breaches.slice(0, 8).map((b, i) => (
                                          <span key={i} className="ot-breach-tag">{b.name} <small>({b.date})</small></span>
                                        ))}
                                      </div>
                                    ) : '—'}
                                  </td>
                                  <td>
                                    {osOk ? (
                                      <span className={os.suspicious ? 'ot-bad' : 'ot-good'}>
                                        {os.suspicious ? '⚠ Şüpheli' : '✅ Güvenilir'}
                                        {os.references > 0 && ` · ${os.references} ref`}
                                      </span>
                                    ) : os === 'loading' ? '⏳' : '—'}
                                  </td>
                                  <td>
                                    {osOk && os.details?.profiles?.length > 0
                                      ? os.details.profiles.map(p => <span key={p} className="ot-platform">{p}</span>)
                                      : '—'}
                                  </td>
                                  <td>
                                    {ctOk ? (ct.total > 0 ? `${ct.total} sertifika` : '—') : ct === 'loading' ? '⏳' : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* IP OSINT Table */}
                  {allIps.size > 0 && (
                    <div className="osint-table-block">
                      <div className="osint-table-heading">🌐 IP Konum</div>
                      <div className="osint-table-wrap">
                        <table className="osint-table">
                          <thead>
                            <tr>
                              <th>IP Adresi</th>
                              <th>Ülke</th>
                              <th>Bölge</th>
                              <th>Şehir</th>
                              <th>ISP</th>
                              <th>Organizasyon</th>
                              <th>Timezone</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...allIps].map(ip => {
                              const geo = ipGeoCache[ip];
                              const ok = geo && geo !== 'loading' && geo.status === 'success';
                              return (
                                <tr key={ip}>
                                  <td className="osint-td-mono">{ip}</td>
                                  <td>{ok ? `${geo.country} (${geo.countryCode})` : geo === 'loading' ? '⏳' : '—'}</td>
                                  <td>{ok ? geo.regionName || '—' : '—'}</td>
                                  <td>{ok ? geo.city || '—' : '—'}</td>
                                  <td>{ok ? geo.isp || '—' : '—'}</td>
                                  <td>{ok ? geo.org || '—' : '—'}</td>
                                  <td>{ok ? geo.timezone || '—' : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Discord OSINT Table */}
                  {allDiscords.size > 0 && (
                    <div className="osint-table-block">
                      <div className="osint-table-heading">🎮 Discord</div>
                      <div className="osint-table-wrap">
                        <table className="osint-table">
                          <thead>
                            <tr>
                              <th>Discord ID</th>
                              <th>Kullanıcı Adı</th>
                              <th>Global İsim</th>
                              <th>Hesap Oluşturma</th>
                              <th>Avatar</th>
                              <th>Bot</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...allDiscords].map(did => {
                              const dc = discordCache[did];
                              const ok = dc && dc !== 'loading';
                              return (
                                <tr key={did}>
                                  <td className="osint-td-mono">{did}</td>
                                  <td>{ok && dc.username ? `@${dc.username}` : ok ? '—' : dc === 'loading' ? '⏳' : '—'}</td>
                                  <td>{ok && dc.globalName ? dc.globalName : '—'}</td>
                                  <td>{ok && dc.createdAt ? dc.createdAt.slice(0, 10) : '—'}</td>
                                  <td>{ok && dc.avatar ? <img src={dc.avatar} alt="" style={{width:24,height:24,borderRadius:'50%'}} /> : '—'}</td>
                                  <td>{ok ? (dc.bot ? '🤖 Evet' : '👤 Hayır') : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Quick OSINT Links */}
                  {allEmails.size > 0 && (
                    <div className="osint-table-block">
                      <div className="osint-table-heading">🔗 Hızlı Bağlantılar</div>
                      <div className="osint-links-grid">
                        {[...allEmails].map(email => (
                          <div key={email} className="osint-links-row">
                            <span className="osint-links-email">{email}</span>
                            <div className="osint-links-btns">
                              {[
                                { label: 'Google', url: `https://www.google.com/search?q=%22${encodeURIComponent(email)}%22` },
                                { label: 'HIBP', url: `https://haveibeenpwned.com/account/${encodeURIComponent(email)}` },
                                { label: 'GitHub', url: `https://github.com/search?q=${encodeURIComponent(email)}&type=users` },
                                { label: 'LinkedIn', url: `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(email)}` },
                                { label: 'X', url: `https://x.com/search?q=${encodeURIComponent(email)}` },
                                { label: 'Telegram', url: `https://t.me/${encodeURIComponent(email.split('@')[0])}` },
                              ].map(lnk => <a key={lnk.label} href={lnk.url} target="_blank" rel="noopener noreferrer" className="osint-quick-link">{lnk.label}</a>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* No result hint */}
            {!idResult && !loading && (
              <div className="inv-hint">
                <Search size={44} className="inv-hint-icon" />
                <p>Bir değer girin ve Enter'a basın</p>
                <span>Tüm tablolarda otomatik aranır · Email bulunursa otomatik OSINT tarar</span>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
