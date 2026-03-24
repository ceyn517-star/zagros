const fs = require('fs');
const path = require('path');

// Load current database
const DATA_DIR = path.join(__dirname, 'data');
const LAST_SQL = path.join(DATA_DIR, 'last.sql');
const OPTIMIZED_SQL = path.join(DATA_DIR, 'optimized.sql');

// Read original SQL
const content = fs.readFileSync(LAST_SQL, 'utf8');

// Tables to KEEP (only essential for ID search)
const keepTables = ['users', 'users_detail', 'raven_api_logs'];

// Tables to REMOVE (logs and analytics that take up space)
const removeTables = ['admin_logs', 'api_stats', 'page_visits', 'query_logs', 'rate_limits', 'user_analytics'];

console.log('Optimizing SQL file...');
console.log('Keeping tables:', keepTables);
console.log('Removing tables:', removeTables);

// Parse and filter
const lines = content.split('\n');
const optimized = [];
let skipTable = false;
let currentTable = null;

for (const line of lines) {
  const trimmed = line.trim();
  
  // Check for CREATE TABLE
  if (trimmed.toUpperCase().startsWith('CREATE TABLE')) {
    const match = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i);
    if (match) {
      currentTable = match[1];
      skipTable = removeTables.includes(currentTable);
      if (skipTable) {
        console.log(`Skipping table: ${currentTable}`);
      } else {
        console.log(`Keeping table: ${currentTable}`);
      }
    }
  }
  
  // Check for INSERT INTO
  if (trimmed.toUpperCase().startsWith('INSERT INTO') || trimmed.toUpperCase().startsWith('INSERT IGNORE INTO')) {
    const match = trimmed.match(/INSERT\s+(?:IGNORE\s+)?INTO\s+[`"']?(\w+)[`"']?/i);
    if (match) {
      currentTable = match[1];
      skipTable = removeTables.includes(currentTable);
    }
  }
  
  // Add line if not skipping
  if (!skipTable) {
    optimized.push(line);
  }
  
  // Reset skip at end of statement
  if (trimmed.endsWith(';')) {
    // Keep skip active for next INSERT of same table
  }
}

const optimizedContent = optimized.join('\n');
fs.writeFileSync(OPTIMIZED_SQL, optimizedContent, 'utf8');

const originalSize = (fs.statSync(LAST_SQL).size / 1024 / 1024).toFixed(2);
const optimizedSize = (fs.statSync(OPTIMIZED_SQL).size / 1024 / 1024).toFixed(2);

console.log('\n✅ Optimization complete!');
console.log(`Original: ${originalSize} MB`);
console.log(`Optimized: ${optimizedSize} MB`);
console.log(`Saved: ${(originalSize - optimizedSize).toFixed(2)} MB`);
console.log(`\nNew file: ${OPTIMIZED_SQL}`);
