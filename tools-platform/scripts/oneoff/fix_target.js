const fs = require('fs');

const routeFile = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/routes/sla.js';
let content = fs.readFileSync(routeFile, 'utf8');

const oldStr = `// Adjustments Target is 0
                    setCell(row, 10, 0);`;
const newStr = `// Adjustments Target: 0 for Deduct, "Add" for Addition
                    if (r >= 52) {
                        setCell(row, 10, "Add");
                    } else {
                        setCell(row, 10, 0);
                    }`;

if (content.includes(oldStr)) {
    content = content.replace(oldStr, newStr);
    fs.writeFileSync(routeFile, content);
    console.log('Fixed target Add');
} else {
    console.log('Could not find target replacement string');
}
