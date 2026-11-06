const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/routes/sla.js';
let content = fs.readFileSync(file, 'utf8');

// Fix Column C alignment
const badColC = `                // Force left alignment properly
                cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };`;
const goodColC = `                // Force left alignment properly (clone style to avoid mutating workbook default)
                cell.style = Object.assign({}, cell.style);
                cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };`;
if (content.includes(badColC)) {
    content = content.replace(badColC, goodColC);
}

// Fix setCell
const badSetCell = `            if (typeof val === 'string' && val.endsWith('%')) {
                cell.value = val;
            } else {
                cell.value = val;
            }
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (isProblematic) {
                cell.font = { color: { argb: 'FFFF0000' }, bold: true };
            }`;
const goodSetCell = `            if (typeof val === 'string' && val.endsWith('%')) {
                cell.value = val;
            } else {
                cell.value = val;
            }
            // Clone style to avoid mutating workbook default
            cell.style = Object.assign({}, cell.style);
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (isProblematic) {
                cell.font = Object.assign({}, cell.font, { color: { argb: 'FFFF0000' }, bold: true });
            }`;
if (content.includes(badSetCell)) {
    content = content.replace(badSetCell, goodSetCell);
}

fs.writeFileSync(file, content);
console.log("Fixed exceljs style mutation");
