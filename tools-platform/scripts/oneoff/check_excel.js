const ExcelJS = require('exceljs');
const path = require('path');
async function run() {
    const templatePath = path.join(__dirname, 'templates/每月赛马-分网络.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.worksheets[0];

    for (let r = 1; r <= 60; r++) {
        const row = sheet.getRow(r);
        const colC = row.getCell(3).value; // English metric name
        const colO = row.getCell(15).value; // Sub-total, etc.
        if (colC) console.log(`Row ${r}: ColC = ${JSON.stringify(colC)}`);
        if (colO === 'Sub-total' || typeof colO === 'string' && colO.includes('Sub-total')) console.log(`Row ${r}: Sub-total = ${colO}`);
    }
}
run();
