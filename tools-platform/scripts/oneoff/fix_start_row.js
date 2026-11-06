const fs = require('fs');

const routeFile = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/routes/sla.js';
let content = fs.readFileSync(routeFile, 'utf8');

const oldStr = `const r = 9 + idx; // 9 to 36`;
const newStr = `const r = 3 + idx; // 3 to 36`;

if (content.includes(oldStr)) {
    content = content.replace(oldStr, newStr);
    fs.writeFileSync(routeFile, content);
    console.log('Fixed start row to 3');
} else {
    console.log('Could not find start row string');
}
