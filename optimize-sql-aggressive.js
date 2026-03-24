const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const LAST_SQL = path.join(DATA_DIR, 'last.sql');
const OPTIMIZED_SQL = path.join(DATA_DIR, 'optimized.sql');

console.log('Aggressive SQL optimization...');

const content = fs.readFileSync(LAST_SQL, 'utf8');
const lines = content.split('\n');
const optimized = [];

// Config: which tables to keep and row limits
const tableConfig = {
  'users': { keep: true, limit: null },           // Keep all (172 rows)
  'users_detail': { keep: true, limit: 50 },     // Limit to 50 rows only - aggressive
  'raven_api_logs': { keep: true, limit: null },   // Keep all (8 rows)
  'admin_logs': { keep: false },
  'api_stats': { keep: false },
  'page_visits': { keep: false },
  'query_logs': { keep: false },
  'rate_limits': { keep: false },
  'user_analytics': { keep: false },
  'user_consents': { keep: false },
  'user_sessions': { keep: false }
};

let currentTable = null;
let rowCount = 0;
let inInsertStatement = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  
  // Detect CREATE TABLE
  if (trimmed.toUpperCase().match(/^CREATE\s+TABLE/)) {
    const match = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i);
    if (match) {
      currentTable = match[1];
      rowCount = 0;
      inInsertStatement = false;
      
      const config = tableConfig[currentTable];
      if (!config || !config.keep) {
        console.log(`❌ Removing table: ${currentTable}`);
      } else {
        console.log(`✅ Keeping table: ${currentTable}${config.limit ? ` (max ${config.limit} rows)` : ''}`);
      }
    }
  }
  
  // Detect INSERT INTO
  if (trimmed.toUpperCase().match(/^INSERT\s+(?:IGNORE\s+)?INTO/)) {
    const match = trimmed.match(/INSERT\s+(?:IGNORE\s+)?INTO\s+[`"']?(\w+)[`"']?/i);
    if (match) {
      currentTable = match[1];
      inInsertStatement = true;
      rowCount = 0;
    }
  }
  
  // Check if we should include this line
  const config = tableConfig[currentTable];
  
  if (!config || !config.keep) {
    // Skip this table entirely
    continue;
  }
  
  // If table has row limit
  if (config.limit && inInsertStatement) {
    // Count rows in VALUES clause
    if (trimmed.includes('),(') || trimmed.startsWith('(')) {
      rowCount++;
      if (rowCount > config.limit) {
        continue; // Skip extra rows
      }
    }
  }
  
  optimized.push(line);
}

const optimizedContent = optimized.join('\n');
fs.writeFileSync(OPTIMIZED_SQL, optimizedContent, 'utf8');

const originalSize = fs.statSync(LAST_SQL).size;
const optimizedSize = fs.statSync(OPTIMIZED_SQL).size;

console.log('\n📊 Results:');
console.log(`Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB (${originalSize.toLocaleString()} bytes)`);
console.log(`Optimized: ${(optimizedSize / 1024 / 1024).toFixed(2)} MB (${optimizedSize.toLocaleString()} bytes)`);
console.log(`Saved: ${((originalSize - optimizedSize) / 1024 / 1024).toFixed(2)} MB (${(100 - (optimizedSize/originalSize)*100).toFixed(1)}%)`);

// Replace last.sql with optimized version for deployment
if (optimizedSize < 50 * 1024 * 1024) {
  console.log('\n✅ File under 50MB limit! Ready for free deployment.');
  fs.copyFileSync(OPTIMIZED_SQL, LAST_SQL);
  console.log('Updated last.sql with optimized version.');
} else {
  console.log('\n⚠️ File still over 50MB. Need more aggressive trimming.');
}
