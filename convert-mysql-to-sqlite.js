const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || path.join(__dirname, 'data', 'last.sql');
const outputFile = process.argv[3] || path.join(__dirname, 'data', 'last_clean.sql');

console.log(`Converting ${inputFile} to SQLite format...`);

let content = fs.readFileSync(inputFile, 'utf8');

// Remove MySQL-specific statements
content = content
  // Remove comments
  .replace(/^--.*$/gm, '')
  .replace(/\/\*\!\d+\s+SET\s+\@OLD_[^*]+\*\//g, '')
  .replace(/\/\*[^*]*\*\//g, '')
  // Remove CREATE DATABASE and USE statements
  .replace(/CREATE\s+DATABASE\s+[^;]+;/gi, '')
  .replace(/USE\s+`?[^`]+`?;/gi, '')
  // Convert backticks to double quotes
  .replace(/`/g, '"')
  // Remove MySQL engine and charset clauses
  .replace(/ENGINE\s*=\s*InnoDB[^;]*/gi, '')
  .replace(/DEFAULT\s+CHARSET\s*=\s*utf8mb4[^;]*/gi, '')
  .replace(/COLLATE\s*=\s*utf8mb4_[^\s,)]+/gi, '')
  .replace(/AUTO_INCREMENT\s*=\s*\d+/gi, '')
  .replace(/AUTO_INCREMENT/gi, '')
  // Remove MySQL index statements
  .replace(/,\s*UNIQUE\s+KEY\s+"[^"]+"\s*\([^)]+\)/gi, '')
  .replace(/,\s*KEY\s+"[^"]+"\s*\([^)]+\)/gi, '')
  // Convert MySQL data types to SQLite - ORDER MATTERS!
  .replace(/tinyint\(\d+\)/gi, 'INTEGER')
  .replace(/smallint\(\d+\)/gi, 'INTEGER')
  .replace(/mediumint\(\d+\)/gi, 'INTEGER')
  .replace(/bigint\(\d+\)/gi, 'INTEGER')
  .replace(/int\(\d+\)/gi, 'INTEGER')
  .replace(/varchar\(\d+\)/gi, 'TEXT')
  .replace(/char\(\d+\)/gi, 'TEXT')
  .replace(/longtext/gi, 'TEXT')
  .replace(/mediumtext/gi, 'TEXT')
  .replace(/tinytext/gi, 'TEXT')
  .replace(/text\s+CHARACTER\s+SET\s+utf8mb4[^,)]*/gi, 'TEXT')
  .replace(/longblob/gi, 'BLOB')
  .replace(/mediumblob/gi, 'BLOB')
  .replace(/tinyblob/gi, 'BLOB')
  .replace(/blob/gi, 'BLOB')
  .replace(/datetime/gi, 'TEXT')
  .replace(/timestamp/gi, 'TEXT')
  .replace(/date\s+NOT\s+NULL/gi, 'TEXT NOT NULL')
  .replace(/date\s+DEFAULT/gi, 'TEXT DEFAULT')
  .replace(/date,/gi, 'TEXT,')
  // Remove CHECK constraints that MySQL uses
  .replace(/CHECK\s*\([^)]+\)/gi, '')
  // Fix multiple spaces and empty lines
  .replace(/\n\s*\n/g, '\n')
  .replace(/  +/g, ' ');

// Remove DELIMITER, stored procedures, and events entirely
content = content.replace(/DELIMITER\s+[^\n]+/gi, '');
content = content.replace(/CREATE\s+PROCEDURE\s+[\s\S]*?END\/\//gi, '');
content = content.replace(/CREATE\s+EVENT\s+[\s\S]*?DELIMITER;/gi, '');
content = content.replace(/END\/\//gi, '');
content = content.replace(/\/\//g, '');

// Split into statements and clean up
const statements = content.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.match(/^\s*$/));

const cleanStatements = statements.map(stmt => {
  // Skip empty or whitespace-only statements
  if (!stmt || stmt.match(/^\s*$/)) return null;
  
  // Clean up the statement
  stmt = stmt.trim();
  
  // Skip comment-only statements
  if (stmt.match(/^\s*--/)) return null;
  if (stmt.match(/^\s*\/\*/)) return null;
  
  // Skip DELIMITER, PROCEDURE, and EVENT statements
  if (stmt.match(/^\s*DELIMITER/i)) return null;
  if (stmt.match(/^\s*CREATE\s+PROCEDURE/i)) return null;
  if (stmt.match(/^\s*CREATE\s+EVENT/i)) return null;
  if (stmt.match(/^\s*CALL/i)) return null;
  
  // Clean up individual statements
  stmt = stmt
    .replace(/\n\s*/g, ' ')
    .replace(/  +/g, ' ')
    .trim();
    
  // Remove trailing commas before closing parenthesis
  stmt = stmt.replace(/,\s*\)/g, ')');
  
  return stmt;
}).filter(s => s && s.length > 0);

// Rebuild SQL content
let output = cleanStatements.join(';\n\n') + ';';

// Additional cleanup
output = output
  .replace(/\n\s*\n\s*\n/g, '\n\n')
  .replace(/\(\s+/g, '(')
  .replace(/\s+\)/g, ')')
  // Fix double closing parentheses
  .replace(/\)\)/g, ')')
  // Fix any remaining MySQL-specific syntax
  .replace(/current_timestamp\(\)/gi, 'CURRENT_TIMESTAMP')
  .replace(/current_TEXT\(\)/gi, 'CURRENT_TIMESTAMP')
  .replace(/now\(\)/gi, 'datetime(\'now\')')
  // Fix any remaining tiny/small/medium/big int without parentheses
  .replace(/\btinyint\b/gi, 'INTEGER')
  .replace(/\bsmallint\b/gi, 'INTEGER')
  .replace(/\bmediumint\b/gi, 'INTEGER')
  .replace(/\bbigint\b/gi, 'INTEGER')
  .replace(/\bbigINTEGER\b/gi, 'INTEGER')
  // Remove trailing commas before closing parenthesis in CREATE TABLE
  .replace(/,\s*\)/g, ')');

fs.writeFileSync(outputFile, output);

console.log(`Conversion complete!`);
console.log(`Input: ${inputFile} (${(fs.statSync(inputFile).size / 1024 / 1024).toFixed(1)}MB)`);
console.log(`Output: ${outputFile} (${(fs.statSync(outputFile).size / 1024 / 1024).toFixed(1)}MB)`);
console.log(`Statements: ${cleanStatements.length}`);
