const fs = require('fs');

const routeFile = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/routes/sla.js';
let content = fs.readFileSync(routeFile, 'utf8');

const exportEndpointStart = content.indexOf("router.post('/export-yuxiang'");
const exportEndpointEnd = content.indexOf("module.exports = router;");

const newEndpoint = `router.post('/export-yuxiang', async (req, res) => {
    try {
        const { metrics, adjustments, totals } = req.body;
        const ExcelJS = require('exceljs');
        const path = require('path');
        const fs = require('fs');

        const templatePath = path.join(__dirname, '../templates/每月赛马-分网络.xlsx');
        if (!fs.existsSync(templatePath)) {
            return res.status(404).send('Template file not found');
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        const sheet = workbook.worksheets[0];

        const setCell = (rowObj, col, val) => {
            const cell = rowObj.getCell(col);
            if (val === '--') val = '/';
            // Determine if string looks like number
            if (typeof val === 'string' && val.endsWith('%')) {
                // Keep as string to avoid 4000% issue
                cell.value = val;
            } else {
                cell.value = val;
            }
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        };

        if (Array.isArray(metrics)) {
            metrics.forEach((m, idx) => {
                const r = 9 + idx; // 9 to 36
                if (r <= 36) {
                    const row = sheet.getRow(r);
                    const isPercent = ['TE', 'ORG', 'ET', 'VDF'].some(cat => m[cat] && String(m[cat].achv).includes('%'));
                    let tgt = m.target !== undefined ? m.target : null;
                    if (isPercent && tgt !== null && tgt !== '' && !String(tgt).includes('%')) {
                        tgt = String(tgt) + '%';
                    }
                    setCell(row, 10, tgt);
                    if (m.TE) { setCell(row, 11, m.TE.achv); setCell(row, 15, m.TE.score); }
                    if (m.ORG) { setCell(row, 12, m.ORG.achv); setCell(row, 16, m.ORG.score); }
                    if (m.ET) { setCell(row, 13, m.ET.achv); setCell(row, 17, m.ET.score); }
                    if (m.VDF) { setCell(row, 14, m.VDF.achv); setCell(row, 18, m.VDF.score); }
                }
            });
        }

        if (Array.isArray(adjustments)) {
            adjustments.forEach((a, idx) => {
                let r;
                if (idx < 14) r = 38 + idx; // 38 to 51
                else r = 52 + (idx - 14);   // 52 to 53

                if (r <= 53) {
                    const row = sheet.getRow(r);
                    setCell(row, 15, a.TE !== undefined ? a.TE : 0);
                    setCell(row, 16, a.ORG !== undefined ? a.ORG : 0);
                    setCell(row, 17, a.ET !== undefined ? a.ET : 0);
                    setCell(row, 18, a.VDF !== undefined ? a.VDF : 0);
                }
            });
        }

        const fillRow = (rIndex, targetCol, sourceObj, fields = ['TE', 'ORG', 'ET', 'VDF']) => {
            if (!sourceObj) return;
            const row = sheet.getRow(rIndex);
            fields.forEach((cat, idx) => {
                const cIndex = targetCol + idx;
                setCell(row, cIndex, sourceObj[cat]);
            });
        };

        if (totals) {
            fillRow(37, 15, totals.subTotal);
            fillRow(54, 15, totals.adjustTotal);
            fillRow(55, 15, totals.weightInMonth);
            fillRow(56, 15, totals.finalResult);
        }

        // Fix column widths
        for (let c = 10; c <= 18; c++) {
            sheet.getColumn(c).width = 12;
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="export.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error('Export Yuxiang failed:', e);
        res.status(500).send(e.message);
    }
});

`;

const newContent = content.substring(0, exportEndpointStart) + newEndpoint + content.substring(exportEndpointEnd);
fs.writeFileSync(routeFile, newContent);
console.log('Fixed export logic');
