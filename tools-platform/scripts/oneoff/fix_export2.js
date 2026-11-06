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

        const setCell = (rowObj, col, val, isScore = false, isMissing = false) => {
            const cell = rowObj.getCell(col);
            
            if (val === '--' || val === '' || val === null || val === undefined) {
                val = '/';
            }
            if (isMissing && isScore && val === 0) {
                val = '/'; // If the cell is missing, score is /
            }

            if (typeof val === 'string' && val.endsWith('%')) {
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
                    let tgt = m.target;
                    if (isPercent && tgt !== null && tgt !== undefined && tgt !== '' && !String(tgt).includes('%')) {
                        tgt = String(tgt) + '%';
                    }
                    setCell(row, 10, tgt);

                    ['TE', 'ORG', 'ET', 'VDF'].forEach((cat, cIdx) => {
                        const achvCol = 11 + cIdx;
                        const scoreCol = 15 + cIdx;
                        if (m[cat]) {
                            const isMissing = (m[cat].achv === '' || m[cat].achv === '--' || m[cat].achv === null);
                            setCell(row, achvCol, m[cat].achv);
                            setCell(row, scoreCol, m[cat].score, true, isMissing);
                        } else {
                            setCell(row, achvCol, '/');
                            setCell(row, scoreCol, '/');
                        }
                    });
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
                    // Adjustments Target is 0
                    setCell(row, 10, 0);

                    ['TE', 'ORG', 'ET', 'VDF'].forEach((cat, cIdx) => {
                        const scoreCol = 15 + cIdx;
                        const score = a[cat] !== undefined ? a[cat] : 0;
                        if (score === 0) {
                            setCell(row, scoreCol, '/');
                        } else {
                            setCell(row, scoreCol, score);
                        }
                    });
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
console.log('Fixed export logic part 2');
