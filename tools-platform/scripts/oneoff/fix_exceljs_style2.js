const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/routes/sla.js';
let content = fs.readFileSync(file, 'utf8');

const bad = `            cell.value = finalVal;
            cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };`;
const good = `            cell.value = finalVal;
            cell.style = Object.assign({}, cell.style);
            cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };`;

if (content.includes(bad)) {
    content = content.replace(bad, good);
    fs.writeFileSync(file, content);
    console.log("Fixed template-mapping style mutation");
}
