const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/routes/sla.js';
let content = fs.readFileSync(file, 'utf8');

const bad = `            if (typeof val === 'string' && val.endsWith('%')) {
                cell.value = val;
            } else {
                cell.value = val;
                if (typeof val === 'number') {
                    cell.numFmt = 'General';
                }
            }`;

const good = `            if (typeof val === 'string' && val.endsWith('%')) {
                cell.value = val;
            } else {
                cell.value = val;
                cell.numFmt = 'General';
            }`;

if (content.includes(bad)) {
    content = content.replace(bad, good);
    fs.writeFileSync(file, content);
    console.log("Fixed numFmt to always General for non-percentages");
}
