const express = require('express');
const router = express.Router();
const repo = require('../models/survey-repository');
const { requireAdmin } = require('../middleware/auth');
const ExcelJS = require('exceljs');

const MANAGER_STAT_COLUMNS = [
    { key: 'managerAD', label: '系统部AD Account Director', patterns: [/^AD$/i, /Account Director/i] },
    { key: 'managerDeliveryVP', label: '交付副代表 Delivery & Service Director', patterns: [/Delivery VP/i, /交付VP/i, /交付副代表/i] },
    { key: 'managerBG', label: 'BG长 BG Director', patterns: [/BG Director/i, /BG长/i, /BU Director/i, /BU长/i] },
    { key: 'managerCountry', label: '代表 Country General Manager', patterns: [/^VP$/i, /^代表 \(VP\)$/i, /Country General Manager/i] },
    { key: 'managerRegion', label: '地总 Region President', patterns: [/Region President/i, /地区部总裁/i, /地总/i] }
];

function selectedRoleTexts(template, fieldKey, answers) {
    const selected = Array.isArray(answers && answers[fieldKey]) ? answers[fieldKey].map(String) : [];
    const field = template && template.fields.find(item => item.key === fieldKey);
    const labels = new Map((field && field.options || []).map(option => [String(option.value), String(option.label)]));
    return Array.from(new Set(selected.flatMap(value => [value, labels.get(value) || '']).filter(Boolean)));
}

function managerStatValue(template, answers, column) {
    return selectedRoleTexts(template, 'managerRoles', answers)
        .some(value => column.patterns.some(pattern => pattern.test(value))) ? 1 : 0;
}

function exportAnswerValue(template, key, value) {
    if (!Array.isArray(value)) return value ?? '';
    const field = template && template.fields.find(item => item.key === key);
    const labels = new Map((field && field.options || []).map(option => [String(option.value), String(option.label)]));
    return Array.from(new Set(value.map(item => labels.get(String(item)) || String(item)))).join('/');
}

router.get('/templates', async (req, res) => {
    try {
        res.json(await repo.listTemplates());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/templates', requireAdmin, async (req, res) => {
    try {
        res.json(await repo.saveTemplate(req.body || {}));
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

router.delete('/templates/:id', requireAdmin, async (req, res) => {
    try {
        const deleted = await repo.deleteTemplate(req.params.id);
        if (!deleted) return res.status(404).json({ error: '模板不存在' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/submissions', async (req, res) => {
    try {
        const result = await repo.createSubmission(req.body || {}, req.user && req.user.username);
        res.json({ success: true, submission: result });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

router.get('/submissions', requireAdmin, async (req, res) => {
    try {
        res.json(await repo.listSubmissions({
            templateId: String(req.query.templateId || ''),
            limit: req.query.limit
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/submissions/:id', requireAdmin, async (req, res) => {
    try {
        const submission = await repo.updateSubmission(req.params.id, req.body || {}, req.user && req.user.username);
        res.json({ success: true, submission });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

router.delete('/submissions/:id', requireAdmin, async (req, res) => {
    try {
        const deleted = await repo.deleteSubmission(req.params.id);
        if (!deleted) return res.status(404).json({ error: '记录不存在' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/export.xlsx', requireAdmin, async (req, res) => {
    try {
        const [templates, submissions] = await Promise.all([
            repo.listTemplates(),
            repo.listSubmissions({ templateId: String(req.query.templateId || ''), limit: 50000 })
        ]);
        const requestedTemplateId = String(req.query.templateId || '');
        const exportTemplates = requestedTemplateId
            ? templates.filter(template => template.id === requestedTemplateId)
            : templates;
        const fieldMap = new Map();
        for (const template of exportTemplates) {
            for (const field of template.fields) {
                if (!fieldMap.has(field.key)) {
                    fieldMap.set(field.key, {
                        label: field.label,
                        exportLabel: field.exportLabel || field.label
                    });
                }
            }
        }
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Dragon Claw';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('六个一信息台账', {
            views: [{ state: 'frozen', ySplit: 1 }]
        });
        const dataColumns = Array.from(fieldMap, ([key, config]) => ({
            header: config.exportLabel || config.label,
            key: `answer_${key}`,
            width: key === 'activityDesc'
                ? 36
                : ['managerRoles', 'customerRoles'].includes(key)
                    ? 30
                : Math.min(20, Math.max(10, String(config.exportLabel || config.label).length + 3))
        }));
        const managerFieldIndex = dataColumns.findIndex(column => column.key === 'answer_managerRoles');
        const managerColumns = MANAGER_STAT_COLUMNS.map(column => ({
            header: column.label,
            key: column.key,
            width: 16
        }));
        if (managerFieldIndex >= 0) dataColumns.splice(managerFieldIndex + 1, 0, ...managerColumns);
        else dataColumns.push(...managerColumns);
        sheet.columns = dataColumns;
        submissions.forEach(item => {
            const template = templates.find(candidate => candidate.id === item.templateId);
            const row = {};
            for (const [key] of fieldMap) {
                const value = item.answers[key];
                row[`answer_${key}`] = exportAnswerValue(template, key, value);
            }
            MANAGER_STAT_COLUMNS.forEach(column => {
                row[column.key] = managerStatValue(template, item.answers, column);
            });
            sheet.addRow(row);
        });
        sheet.getRow(1).eachCell(cell => {
            cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1768AC' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });
        MANAGER_STAT_COLUMNS.forEach(column => {
            const headerCell = sheet.getCell(1, sheet.getColumn(column.key).number);
            headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD89B20' } };
            headerCell.font = { bold: true, size: 9, color: { argb: 'FF3B2B00' } };
        });
        sheet.getRow(1).height = 52;
        sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address };
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            row.height = 18;
            row.font = { size: 9 };
            row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
            if (fieldMap.has('activityDesc')) {
                row.getCell(sheet.getColumn('answer_activityDesc').number).alignment = {
                    vertical: 'middle',
                    horizontal: 'left',
                    wrapText: false
                };
            }
            if (rowNumber % 2 === 0) {
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F7FA' } };
            }
        });
        const filename = `六个一信息台账_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: err.message });
        else res.end();
    }
});

repo.ensureReady().catch(err => console.error('[surveys] init failed:', err));

module.exports = router;
