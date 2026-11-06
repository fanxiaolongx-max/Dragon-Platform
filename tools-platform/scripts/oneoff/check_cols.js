const ExcelJS = require('exceljs');
const path = require('path');
async function run() {
    const templatePath = path.join(__dirname, 'templates/每月赛马-分网络.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.worksheets[0];
    const row = sheet.getRow(3);
    for(let i=1; i<=15; i++) {
        console.log(`Col ${i}:`, row.getCell(i).value);
    }
}
run();
