const ExcelJS = require('exceljs');
const path = require('path');
async function run() {
    const templatePath = path.join(__dirname, 'templates/每月赛马-分网络.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.worksheets[0];
    const cellC3 = sheet.getRow(3).getCell(3);
    const cellD3 = sheet.getRow(3).getCell(4);
    const cellK3 = sheet.getRow(3).getCell(11);
    
    console.log("C3 font:", cellC3.font);
    console.log("D3 font:", cellD3.font);
    console.log("K3 font:", cellK3.font);
}
run();
