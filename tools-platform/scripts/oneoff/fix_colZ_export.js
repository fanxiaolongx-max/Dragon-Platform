const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/routes/sla.js';
let content = fs.readFileSync(file, 'utf8');

const badPart = `        const mappingToRow = {};
        for(let r = 3; r <= 60; r++) {
            const cell = sheet.getRow(r).getCell(3);
            if (cell.value) {
                const currentAlign = cell.alignment || {};
                cell.alignment = { ...currentAlign, horizontal: 'left' };
            }
        }
        for(let r = 1; r <= 100; r++) {
            const cellVal = sheet.getRow(r).getCell(3).value;
            if (typeof cellVal === 'string') {
                const match = cellVal.match(/\\[Map:\\s*(.+?)\\]/);
                if (match) {
                    mappingToRow[match[1]] = r;
                }
            }
        }`;

const goodPart = `        const mappingToRow = {};
        for(let r = 3; r <= 60; r++) {
            const cell = sheet.getRow(r).getCell(3);
            if (cell.value) {
                // Force left alignment properly
                cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
                
                // Strip legacy tag if it exists in C column
                if (typeof cell.value === 'string' && cell.value.includes('[Map:')) {
                    cell.value = cell.value.replace(/\\s*\\[Map:\\s*.+?\\]/g, '');
                }
            }
            
            // Read mapping from Column 26 (Z)
            const zVal = sheet.getRow(r).getCell(26).value;
            if (typeof zVal === 'string') {
                const match = zVal.match(/\\[Map:\\s*(.+?)\\]/);
                if (match) {
                    mappingToRow[match[1]] = r;
                }
            } else if (typeof cell.value === 'string') { 
                 // fallback legacy read
                 const matchC = cell.value.match(/\\[Map:\\s*(.+?)\\]/);
                 if (matchC) mappingToRow[matchC[1]] = r;
            }
        }`;

if (content.includes(badPart)) {
    content = content.replace(badPart, goodPart);
    fs.writeFileSync(file, content);
    console.log("Fixed export mapping logic");
} else {
    console.log("Could not find bad part");
}
