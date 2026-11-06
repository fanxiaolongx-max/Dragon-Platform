const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/routes/sla.js';
let content = fs.readFileSync(file, 'utf8');
const match = content.match(/const setCell = [\s\S]*?};/);
console.log(match[0]);
