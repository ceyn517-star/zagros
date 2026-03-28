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
  // Fix multiple spaces and empty lines
  .replace(/\n\s*\n/g, '\n')
  .replace(/  +/g, ' ');

// Split into statements and clean up
const statements = content.split(';').map(s => s.trim()).filter(s => s.length > 0);

const cleanStatements = statements.map(stmt => {
  // Skip empty or comment-only statements
  if (!stmt || stmt.match(/^\s*$/)) return null;
  if (stmt.match(/^\s*--/)) return null;
  
  // Clean up individual statements
  return stmt
    .replace(/\n\s*/g, ' ')
    .replace(/  +/g, ' ')
    .trim();
}).filter(s => s && s.length > 0);

// Rebuild SQL content
let output = cleanStatements.join(';\n\n') + ';';

// Additional cleanup
output = output
  .replace(/\n\s*\n\s*\n/g, '\n\n')
  .replace(/\(\s+/g, '(')
  .replace(/\s+\)/g, ')');

fs.writeFileSync(outputFile, output);

console.log(`Conversion complete!`);
console.log(`Input: ${inputFile} (${(fs.statSync(inputFile).size / 1024 / 1024).toFixed(1)}MB)`);
console.log(`Output: ${outputFile} (${(fs.statSync(outputFile).size / 1024 / 1024).toFixed(1)}MB)`);
console.log(`Statements: ${cleanStatements.length}`);
