const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getDataDir } = require('../models/tenant-context');
const { getDbPath } = require('../models/app-db');
const repo = require('../models/department-reward-penalty-repository');
const { buildSnapshot } = require('../models/department-reward-penalty-snapshot');
const snapshotPublish = require('../models/snapshot-publish-service');
const JSZip = require('jszip');
const router = express.Router();
const evidenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const clean = (value, limit = 500) => String(value ?? '').trim().slice(0, limit);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const id = () => crypto.randomUUID();
const roleTokens = value => String(value || '').split(/[,+/]/).map(part => part.trim().toLowerCase()).filter(Boolean);
const ruleRoles = rule => Array.isArray(rule.roles) ? rule.roles : String(rule.roles || '').split(/[,+/]/).map(part => part.trim()).filter(Boolean);
const personRoles = person => Array.isArray(person.roles) ? person.roles : [clean(person.role, 80)].filter(Boolean);
const personGroups = person => Array.isArray(person.customerGroupIds) ? person.customerGroupIds : [clean(person.customerGroupId, 100)].filter(Boolean);
const personBusinessUnits = person => Array.isArray(person.businessUnitIds) ? person.businessUnitIds : [];
const canonicalRole = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s()_-]/g, '');
const matching = (person, rule) => {
    const actual = new Set(personRoles(person)
        .flatMap(role => [role, ...roleTokens(String(role).replace(/[()]/g, '/'))])
        .map(canonicalRole)
        .filter(Boolean));
    return roleTokens(rule.roles).some(part => {
        const allowed = canonicalRole(part);
        return allowed === 'all' || actual.has(allowed);
    });
};
const EVIDENCE_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.txt', '.zip', '.rar', '.7z', '.tar', '.gz', '.eml', '.msg']);
const EVIDENCE_PATH_REGEX = /^\/api\/department-reward-penalty\/evidence\/[a-f0-9-]{36}\.(?:pdf|png|jpg|txt|zip|rar|7z|tar|gz|eml|msg)$/i;
const EVIDENCE_FILENAME_REGEX = /^[a-f0-9-]{36}\.(?:pdf|png|jpg|txt|zip|rar|7z|tar|gz|eml|msg)$/i;

const parseAttachments = (body) => {
    let list = [];
    if (Array.isArray(body?.attachments)) {
        list = body.attachments;
    } else if (body?.attachment) {
        list = String(body.attachment).split(';').map(s => s.trim()).filter(Boolean);
    }
    const valid = [];
    for (const item of list) {
        const p = clean(item, 200);
        if (!p) continue;
        if (!EVIDENCE_PATH_REGEX.test(p)) fail('附件路径无效');
        valid.push(p);
    }
    return valid;
};
const respond = handler => (req, res) => Promise.resolve(handler(req, res)).catch(error => res.status(error.status || 500).json({ error: error.message || '操作失败' }));
const pinFailures = new Map();
async function requireForceEditPin(req, pin) {
    const key = `${getDbPath()}:${req.user.username}`;
    const attempt = pinFailures.get(key);
    if (attempt && attempt.until > Date.now()) fail('口令尝试次数过多，请稍后重试', 429);
    if (await repo.verifyForceEditPin(pin)) { pinFailures.delete(key); return; }
    const count = (attempt?.until && attempt.until <= Date.now() ? 0 : attempt?.count || 0) + 1;
    pinFailures.set(key, { count, until: count >= 5 ? Date.now() + 15 * 60_000 : 0 });
    fail('修改口令不正确', 403);
}

router.get('/', respond(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ...await repo.list(), canEdit: req.user?.role === 'admin', username: req.user?.username || '' }); }));
router.get('/snapshot-mappings', respond(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await repo.getSnapshotMappings());
}));
router.put('/snapshot-mappings', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可修改快照映射配置', 403);
    const saved = await repo.saveSnapshotMappings(req.body, req.user?.username || 'admin');
    res.json({ success: true, mappings: saved });
}));
router.get('/audit', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可查看操作审计', 403);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await repo.listAudit(req.query));
}));
router.get('/security', respond(async (req, res) => { if (req.user?.role !== 'admin') fail('仅管理员可查看口令设置', 403); res.setHeader('Cache-Control', 'no-store'); res.json({ hasCustomPin: await repo.hasCustomForceEditPin() }); }));
router.put('/security/pin', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可修改口令', 403);
    const currentPin = String(req.body?.currentPin ?? ''), newPin = String(req.body?.newPin ?? '');
    if (!/^\d{4,12}$/.test(newPin)) fail('新口令须为 4–12 位数字');
    await requireForceEditPin(req, currentPin);
    await repo.changeForceEditPin(currentPin, newPin, req.user.username);
    res.json({ success: true });
}));

const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

router.get('/snapshot/html', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可导出包含人员及证据的独立页面', 403);
    const html = await buildSnapshot(req.user?.tenantId || 'default');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="department-reward-penalty-readonly.html"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
}));

const snapshotAdmin = req => { if (req.user?.role !== 'admin') fail('仅管理员可配置或发布静态页面', 403); };
router.get('/snapshot/download/:slug', respond(async (req, res) => {
    snapshotAdmin(req);
    const slug = String(req.params.slug || '');
    const provider = snapshotPublish.providers.get(slug);
    if (!provider) fail('该工具尚未接入静态页面发布', 404);
    const format = String(req.query.format || 'single');
    if (format !== 'single' && format !== 'pages') fail('下载格式无效');
    const options = { encryption: { enabled: false } };
    const tenantId = req.user?.tenantId || 'default';
    res.setHeader('Cache-Control', 'no-store');
    if (format === 'single') {
        const html = await provider.buildSnapshot(tenantId, options);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${slug}-readonly.html"`);
        return res.send(html);
    }
    const output = await provider.buildPagesSnapshot(tenantId, options);
    const zip = new JSZip();
    zip.file('index.html', output.html);
    for (const [filename, contents] of output.files) zip.file(filename, contents);
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-readonly-pages.zip"`);
    res.send(archive);
}));
router.get('/snapshot/settings', respond(async (req, res) => { snapshotAdmin(req); res.setHeader('Cache-Control', 'no-store'); res.json(await snapshotPublish.getSettings()); }));
router.get('/snapshot/estimate/:slug', respond(async (req, res) => {
    snapshotAdmin(req);
    res.setHeader('Cache-Control', 'no-store');
    const tenantId = req.user?.tenantId || 'default';
    const mode = String(req.query.mode || 'pages');
    res.json(await snapshotPublish.estimateToolSnapshot(tenantId, req.params.slug, mode, req.query.refresh === '1'));
}));
router.get('/snapshot/prerequisites', respond(async (req, res) => { snapshotAdmin(req); res.setHeader('Cache-Control', 'no-store'); res.json(await snapshotPublish.getPrerequisites()); }));
router.put('/snapshot/settings', respond(async (req, res) => { snapshotAdmin(req); res.json(await snapshotPublish.saveSettings(req.body || {})); }));
router.get('/snapshot/jobs', respond(async (req, res) => { snapshotAdmin(req); res.setHeader('Cache-Control', 'no-store'); res.json(await snapshotPublish.listJobs()); }));
router.get('/snapshot/jobs/:id', respond(async (req, res) => {
    snapshotAdmin(req);
    res.setHeader('Cache-Control', 'no-store');
    const job = await snapshotPublish.getJob(req.params.id);
    if (!job) fail('推送任务不存在', 404);
    res.json(job);
}));
router.post('/snapshot/publish', respond(async (req, res) => {
    snapshotAdmin(req);
    res.status(202).json(await snapshotPublish.startJob(req.user?.tenantId || 'default', req.body || {}));
}));

router.get('/backup/export', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可导出数据备份包', 403);
    const includeEvidence = req.query.includeEvidence !== 'false' && req.query.includeEvidence !== '0';
    const result = await repo.exportBackupPackage({ includeEvidence, actor: req.user.username, tenantId: req.user?.tenantId });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.zipBuffer);
}));

router.get('/backup/export-json', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可导出数据备份包', 403);
    const result = await repo.exportBackupPackage({ includeEvidence: false, actor: req.user.username, tenantId: req.user?.tenantId });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="department-reward-penalty-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.jsonString);
}));

router.post('/backup/inspect', backupUpload.single('file'), respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可解析备份包', 403);
    let payload = req.file?.buffer;
    if (!payload && req.body && typeof req.body === 'object') {
        payload = req.body;
    }
    if (!payload) fail('请选择要解析的备份数据包文件（.zip 或 .json）');
    const mode = clean(req.body?.mode, 20) || 'merge';
    if (!['merge', 'replace'].includes(mode)) fail('无效的恢复模式');
    const inspection = await repo.inspectBackupPackage(payload, { mode });
    res.json(inspection);
}));

router.post('/backup/restore', backupUpload.single('file'), respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可恢复数据备份包', 403);
    let payload = req.file?.buffer;
    const body = req.body || {};
    if (!payload && body.data) {
        payload = body.data;
    }
    if (!payload) fail('请选择要恢复的备份数据包文件（.zip 或 .json）');
    const mode = clean(body.mode, 20) || 'merge';
    const pin = String(body.pin ?? '');
    const result = await repo.restoreBackupPackage(payload, {
        mode,
        pin,
        actor: req.user.username,
        tenantId: req.user?.tenantId
    });
    res.json(result);
}));
const CONFIG_KINDS = new Set(['roles', 'deductions', 'deductionCategories', 'customerGroups', 'businessUnits']);
const configKind = req => { if (!CONFIG_KINDS.has(req.params.kind)) fail('配置类型无效'); return req.params.kind; };
const requireConfigAdmin = req => { if (req.user?.role !== 'admin') fail('仅管理员可维护配置', 403); };
router.post('/config/:kind', respond(async (req, res) => {
    requireConfigAdmin(req);
    const kind = configKind(req), value = clean(req.body?.value, 100);
    if (!value) fail('配置名称不能为空');
    const state = await repo.list();
    if (state[kind].some(item => item.value.toLowerCase() === value.toLowerCase())) fail('配置名称已存在', 409);
    const categoryId = kind === 'deductions' ? clean(req.body?.categoryId, 100) : '';
    if (kind === 'deductions' && !state.deductionCategories.some(item => item.id === categoryId)) fail('请选择有效的扣罚分类');
    const itemId = id();
    res.json(await repo.put(kind, itemId, { value, ...(categoryId ? { categoryId } : {}), archived: false }, req.user.username, '新增配置'));
}));
router.put('/config/:kind/:id', respond(async (req, res) => {
    requireConfigAdmin(req);
    const kind = configKind(req), state = await repo.list(), old = state[kind].find(item => item.id === req.params.id);
    if (!old) fail('配置不存在', 404);
    const value = clean(req.body?.value, 100);
    if (!value) fail('配置名称不能为空');
    if (state[kind].some(item => item.id !== old.id && item.value.toLowerCase() === value.toLowerCase())) fail('配置名称已存在', 409);
    const categoryId = kind === 'deductions' ? clean(req.body?.categoryId || old.categoryId, 100) : '';
    if (kind === 'deductions' && !state.deductionCategories.some(item => item.id === categoryId)) fail('请选择有效的扣罚分类');
    const changes = [{ kind, id: old.id, payload: { ...old, value, ...(categoryId ? { categoryId } : {}), archived: false } }];
    if (kind === 'roles') {
        for (const person of state.personnel.filter(item => personRoles(item).includes(old.value))) changes.push({ kind: 'personnel', id: person.id, payload: { ...person, roles: personRoles(person).map(role => role === old.value ? value : role), role: person.role === old.value ? value : person.role } });
        for (const rule of state.rules.filter(item => ruleRoles(item).includes(old.value))) changes.push({ kind: 'rules', id: rule.id, payload: { ...rule, roles: ruleRoles(rule).map(role => role === old.value ? value : role) } });
    }
    if (kind === 'deductionCategories') {
        // Deduction standards refer to a stable category ID; renaming needs no cascade.
    }
    if (kind === 'deductions') {
        for (const rule of state.rules.filter(item => item.deduct === old.value)) changes.push({ kind: 'rules', id: rule.id, payload: { ...rule, deduct: value } });
        for (const record of state.records.filter(item => item.status === 'draft' && item.deduct === old.value)) changes.push({ kind: 'records', id: record.id, payload: { ...record, deduct: value, ruleSnapshot: { ...record.ruleSnapshot, deduct: value } } });
    }
    await repo.putMany(changes, req.user.username, '修改配置', old.value + ' → ' + value);
    res.json({ ...old, value, ...(categoryId ? { categoryId } : {}), updatedReferences: changes.length - 1 });
}));
router.delete('/config/:kind/:id', respond(async (req, res) => {
    requireConfigAdmin(req);
    const kind = configKind(req), state = await repo.list(), old = state[kind].find(item => item.id === req.params.id);
    if (!old) fail('配置不存在', 404);
    const used = kind === 'roles'
        ? state.personnel.some(item => !item.archived && personRoles(item).includes(old.value)) || state.rules.some(item => !item.archived && ruleRoles(item).includes(old.value))
        : kind === 'deductions'
            ? state.rules.some(item => !item.archived && item.deduct === old.value) || state.records.some(item => item.status === 'draft' && item.deduct === old.value)
            : kind === 'deductionCategories'
                ? state.deductions.some(item => item.categoryId === old.id)
                : kind === 'businessUnits'
                    ? state.personnel.some(item => !item.archived && personBusinessUnits(item).includes(old.id))
                    : state.personnel.some(item => !item.archived && personGroups(item).includes(old.id));
    if (used) fail('该配置仍被当前人员、规则或草稿引用，请先调整引用', 409);
    res.json(await repo.put(kind, old.id, { ...old, archived: true }, req.user.username, '删除配置'));
}));
router.post('/legacy-import', respond(async (req, res) => {
    if (req.user.role !== 'admin') fail('仅管理员可导入旧版数据', 403);
    const source = req.body || {}, people = source.personnel, rules = source.rules, records = source.records;
    if (!Array.isArray(people) || !Array.isArray(rules) || !Array.isArray(records) || people.length > 5000 || rules.length > 2000 || records.length > 20000) fail('旧版数据格式或数量无效');
    const current = await repo.list();
    if (current.personnel.length || current.records.length) fail('当前租户已有人员或记录，不能重复导入', 409);
    const personIds = new Set(), ruleIds = new Set(current.rules.map(rule => rule.id));
    for (const person of people) {
        const personId = clean(person.id, 100), name = clean(person.name, 120), role = clean(person.role, 80);
        if (!personId || !name || !role || personIds.has(personId)) fail('旧版人员数据无效或工号重复');
        personIds.add(personId);
    }
    for (const rule of rules) {
        const ruleId = clean(rule.id, 100);
        if (!ruleId || !clean(rule.svcModule, 100) || !clean(rule.subModule, 100) || !clean(rule.desc, 1000)) fail('旧版规则数据无效');
        ruleIds.add(ruleId);
    }
    for (const record of records) {
        if (!clean(record.id, 100) || !personIds.has(clean(record.staffId, 100)) || !ruleIds.has(clean(record.ruleId, 100))) fail('旧版记录存在缺失的人员或规则引用');
    }
    for (const person of people) {
        const role = clean(person.role, 80);
        if (!current.roles.some(item => item.value === role)) await repo.put('roles', role, { value: role }, req.user.username, '迁移角色');
        await repo.put('personnel', clean(person.id, 100), { name: clean(person.name, 120), role, archived: false }, req.user.username, '迁移人员');
    }
    for (const rule of rules) {
        const roles = String(rule.roles || '').split(/[,+/]/).map(value => clean(value, 80)).filter(Boolean);
        const deduct = clean(rule.deduct, 100);
        for (const role of roles) if (!current.roles.some(item => item.value.toLowerCase() === role.toLowerCase())) await repo.put('roles', role, { value: role }, req.user.username, '迁移角色');
        if (deduct && !current.deductions.some(item => item.value === deduct)) await repo.put('deductions', deduct, { value: deduct }, req.user.username, '迁移扣罚标准');
        const weight = /^\d+%$/.test(String(rule.weight)) ? Number.parseInt(rule.weight, 10) : null;
        await repo.put('rules', clean(rule.id, 100), { svcModule: clean(rule.svcModule, 100), subModule: clean(rule.subModule, 100), desc: clean(rule.desc, 1000), roles, deduct, weight, archived: false }, req.user.username, '迁移规则');
    }
    const importedState = await repo.list();
    for (const record of records) {
        const staffId = clean(record.staffId, 100), ruleId = clean(record.ruleId, 100);
        const person = importedState.personnel.find(item => item.id === staffId), rule = importedState.rules.find(item => item.id === ruleId);
        const status = record.status === '已发布' ? 'published' : 'draft';
        await repo.put('records', clean(record.id, 100), { date: clean(record.date, 10), staffId, ruleId, deduct: clean(record.deduct, 100), tt: clean(record.tt, 100), remark: clean(record.remark, 2000), evidence: '', attachment: '', status, createdBy: 'legacy-import', ruleSnapshot: { svcModule: rule.svcModule, subModule: rule.subModule, desc: rule.desc, roles: rule.roles, deduct: rule.deduct }, personSnapshot: { name: person.name, role: person.role }, migrationWarning: !matching(person, rule), ...(status === 'published' ? { publishReason: '旧版浏览器数据迁移' } : {}) }, req.user.username, '迁移历史记录', '旧版浏览器数据迁移');
    }
    res.json({ imported: { personnel: people.length, rules: rules.length, records: records.length } });
}));
const getEvidenceDir = req => path.join(getDataDir(req?.user?.tenantId || 'default'), 'department-reward-penalty-evidence');
const getEvidencePath = (filename, req) => path.join(getEvidenceDir(req), filename);

router.post('/evidence', evidenceUpload.single('file'), respond(async (req, res) => {
    if (!req.file) fail('请选择证据文件');
    const originalExt = path.extname(req.file.originalname || '').toLowerCase();
    const mimeToExt = new Map([
        ['application/pdf', '.pdf'],
        ['image/png', '.png'],
        ['image/jpeg', '.jpg'],
        ['text/plain', '.txt'],
        ['application/zip', '.zip'],
        ['application/x-zip-compressed', '.zip'],
        ['application/vnd.rar', '.rar'],
        ['application/x-rar-compressed', '.rar'],
        ['application/x-7z-compressed', '.7z'],
        ['application/x-tar', '.tar'],
        ['application/gzip', '.gz'],
        ['application/x-gzip', '.gz'],
        ['message/rfc822', '.eml'],
        ['application/vnd.ms-outlook', '.msg'],
        ['application/x-msg', '.msg']
    ]);
    let extension = mimeToExt.get(req.file.mimetype);
    if (!extension && EVIDENCE_EXTENSIONS.has(originalExt)) {
        extension = originalExt === '.jpeg' ? '.jpg' : originalExt;
    }
    if (!extension || !EVIDENCE_EXTENSIONS.has(extension)) {
        fail('仅支持 PDF、PNG、JPG、TXT、压缩包(ZIP/RAR/7Z/TAR/GZ) 及邮件(EML/MSG) 格式');
    }
    const filename = crypto.randomUUID() + extension;
    const directory = getEvidenceDir(req);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), req.file.buffer, { flag: 'wx' });
    await repo.ensureReady();
    await repo.audit(req.user.username, '上传证据', 'evidence', filename, null, { filename, size: req.file.size }, '');
    res.json({ path: '/api/department-reward-penalty/evidence/' + filename, filename: req.file.originalname, size: req.file.size });
}));
router.get('/evidence/:filename', respond(async (req, res) => {
    const filename = req.params.filename;
    if (!EVIDENCE_FILENAME_REGEX.test(filename)) fail('文件名无效');
    const filepath = getEvidencePath(filename, req);
    if (!fs.existsSync(filepath)) fail('文件不存在', 404);
    res.setHeader('Cache-Control', 'private, no-store');
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.txt': 'text/plain; charset=utf-8',
        '.zip': 'application/zip',
        '.rar': 'application/vnd.rar',
        '.7z': 'application/x-7z-compressed',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
        '.eml': 'message/rfc822',
        '.msg': 'application/vnd.ms-outlook'
    };
    if (mimeTypes[ext]) res.setHeader('Content-Type', mimeTypes[ext]);
    const inlineExts = new Set(['.pdf', '.png', '.jpg', '.txt']);
    const isInline = req.query.download !== '1' && inlineExts.has(ext);
    const disposition = isInline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="evidence${ext}"`);
    res.sendFile(filepath);
}));
router.delete('/records/:id', respond(async (req, res) => {
    const recordId = clean(req.params.id, 100);
    const old = await repo.item('records', recordId);
    if (!old) fail('违规记录不存在', 404);
    if (old.status !== 'draft') fail('只能删除待发布草稿');
    if (req.user?.role !== 'admin' && old.createdBy !== req.user?.username) fail('只能删除本人草稿', 403);
    res.json(await repo.remove('records', recordId, req.user?.username || 'user', '删除草稿', '删除待发布违规草稿'));
}));
router.post('/records/:id/force-edit', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可强制修改已发布记录', 403);
    const recordId = clean(req.params.id, 100), body = req.body || {}, old = await repo.item('records', recordId);
    if (!old || old.status !== 'published') fail('只能强制修改已发布记录');
    const reason = clean(body.reason, 1000);
    if (!reason) fail('强制修改理由必填');
    await requireForceEditPin(req, body.pin);
    const date = clean(body.date, 10);
    if (!validDate(date)) fail('日期无效');
    const attachments = parseAttachments(body);
    const attachment = attachments[0] || '';
    const staffId = clean(body.staffId, 100), ruleId = clean(body.ruleId, 100), customerGroupId = clean(body.customerGroupId, 100);
    const changedReference = staffId !== old.staffId || ruleId !== old.ruleId || customerGroupId !== clean(old.customerGroupId, 100);
    let ruleSnapshot = old.ruleSnapshot, personSnapshot = old.personSnapshot, deduct = old.deduct;
    if (changedReference) {
        const state = await repo.list();
        const person = state.personnel.find(item => item.id === staffId && !item.archived);
        const rule = state.rules.find(item => item.id === ruleId && !item.archived);
        const group = state.customerGroups.find(item => item.id === customerGroupId);
        if (!person || !rule || !group || !personGroups(person).includes(group.id)) fail('请为新责任主体选择有效的客户群和规则');
        if (!matching(person, rule)) fail(`责任主体角色 ${personRoles(person).join('、')} 不匹配；本规则适用角色：${ruleRoles(rule).join('、')}`);
        deduct = rule.deduct;
        ruleSnapshot = { svcModule: rule.svcModule, subModule: rule.subModule, desc: rule.desc, roles: rule.roles, deduct };
        personSnapshot = { name: person.name, role: person.role, roles: personRoles(person), customerGroupId: group.id, customerGroupName: group.value, businessUnitId: personBusinessUnits(person)[0] || '', buName: state.businessUnits.find(b => b.id === personBusinessUnits(person)[0])?.value || '' };
    }
    if (body.deduct && clean(body.deduct, 100) !== deduct) fail('扣罚必须与原记录或新规则的标准一致');
    const curPerson = (await repo.list()).personnel.find(p => p.id === staffId) || personSnapshot;
    const curRule = (await repo.list()).rules.find(r => r.id === ruleId) || ruleSnapshot;
    const businessUnitId = staffId !== old.staffId
        ? personBusinessUnits(curPerson)[0] || ''
        : old?.businessUnitId || personBusinessUnits(curPerson)[0] || '';
    const value = { ...old, date, staffId, ruleId, customerGroupId, businessUnitId, deduct, ruleSnapshot, personSnapshot, tt: clean(body.tt, 100), remark: clean(body.remark, 2000), evidence: clean(body.evidence, 500), attachment, attachments, forcedEditAt: new Date().toISOString(), forcedEditBy: req.user.username, forcedEditReason: reason, migrationWarning: !matching(curPerson, curRule) };
    res.json(await repo.putPublishedWithPin(recordId, value, body.pin, req.user.username, reason));
}));
router.post('/records/:id/correct-historical-role', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可更正历史角色', 403);
    const id = clean(req.params.id, 100), body = req.body || {};
    const old = await repo.item('records', id);
    if (!old || old.status !== 'published' || old.createdBy !== 'legacy-import' || !old.migrationWarning) fail('仅可更正待复核的已发布迁移记录', 409);
    const requestedRole = clean(body.role, 80), reason = clean(body.reason, 1000);
    if (!requestedRole || !reason || !clean(body.expectedRole, 80)) fail('须填写历史角色、更正理由及原角色');
    if (body.expectedRole !== old.personSnapshot?.role) fail('记录已变更，请刷新后重试', 409);
    const role = ruleRoles(old.ruleSnapshot || {}).find(allowed => canonicalRole(allowed) === canonicalRole(requestedRole));
    if (!role || !matching({ role }, old.ruleSnapshot || {})) fail(`历史角色 ${requestedRole} 不在记录保存的规则适用范围内`);
    if (matching(old.personSnapshot || {}, old.ruleSnapshot || {})) fail('历史角色已匹配，无需更正', 409);
    await requireForceEditPin(req, body.pin);
    res.json(await repo.correctHistoricalRoleWithPin(id, {
        expectedRole: old.personSnapshot.role, expectedRuleId: old.ruleId, expectedRuleSnapshot: old.ruleSnapshot,
        role, pin: body.pin, actor: req.user.username, reason
    }));
}));
router.post('/records/:id/revoke', respond(async (req, res) => {
    if (req.user.role !== 'admin') fail('仅管理员可发布或撤销', 403);
    const recordId = clean(req.params.id, 100);
    const old = await repo.item('records', recordId);
    if (!old || old.status !== 'published') fail('只能撤销已发布记录', 409);
    const reason = clean(req.body?.reason, 1000);
    if (!reason) fail('撤销理由必填');
    await requireForceEditPin(req, req.body?.pin);
    const revokeAttachment = clean(req.body?.revokeAttachment, 200);
    if (revokeAttachment && !EVIDENCE_PATH_REGEX.test(revokeAttachment)) fail('撤销证明附件路径无效');
    const value = { ...old, status: 'revoked', revokedAt: new Date().toISOString(), revokeReason: reason, revokedBy: req.user.username, revokeAttachment: revokeAttachment || '' };
    res.json(await repo.put('records', recordId, value, req.user.username, '撤销已发布违规', reason));
}));
router.post('/records/:id/archive', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可归档记录', 403);
    const recordId = clean(req.params.id, 100);
    const old = await repo.item('records', recordId);
    if (!old) fail('违规记录不存在', 404);
    if (old.status === 'archived' || old.archived) fail('该记录已处于归档状态', 409);
    if (!['published', 'revoked'].includes(old.status)) fail('只能归档已发布或已撤销记录', 409);
    const reason = clean(req.body?.reason, 1000) || '历史违规记录归档';
    const previousStatus = old.status || 'published';
    const value = { ...old, status: 'archived', archived: true, previousStatus, archivedAt: new Date().toISOString(), archivedBy: req.user.username, archiveReason: reason };
    res.json(await repo.put('records', recordId, value, req.user.username, '归档违规记录', reason));
}));
router.post('/records/:id/unarchive', respond(async (req, res) => {
    if (req.user?.role !== 'admin') fail('仅管理员可恢复归档记录', 403);
    const recordId = clean(req.params.id, 100);
    const old = await repo.item('records', recordId);
    if (!old || (old.status !== 'archived' && !old.archived)) fail('只能恢复已归档记录', 409);
    const restoreStatus = old.previousStatus === 'revoked' ? 'revoked' : 'published';
    const value = { ...old, status: restoreStatus, archived: false, unarchivedAt: new Date().toISOString(), unarchivedBy: req.user.username };
    res.json(await repo.put('records', recordId, value, req.user.username, '恢复已归档违规', '从已归档恢复为' + (restoreStatus === 'published' ? '已发布' : restoreStatus)));
}));
router.post('/personnel/batch', respond(async (req, res) => {
    if (req.user.role !== 'admin') fail('仅管理员可维护配置', 403);
    const body = req.body || {}, actor = req.user.username;
    const personIds = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(id => clean(id, 100)).filter(Boolean))];
    if (!personIds.length) fail('请选择要批量编辑的人员');
    const state = await repo.list();
    const existing = state.personnel.filter(p => !p.archived && personIds.includes(p.id));
    if (!existing.length) fail('未找到有效的人员记录');

    const groupOp = body.groups || { mode: 'keep' };
    const buOp = body.bus || { mode: 'keep' };
    const roleOp = body.roles || { mode: 'keep' };

    const validGroupIds = new Set(state.customerGroups.filter(g => !g.archived).map(g => g.id));
    const validBuIds = new Set(state.businessUnits.filter(b => !b.archived).map(b => b.id));
    const validRoles = new Set(state.roles.filter(r => !r.archived).map(r => r.value));

    const targetGroupIds = (Array.isArray(groupOp.values) ? groupOp.values : []).map(v => clean(v, 100)).filter(id => validGroupIds.has(id));
    const targetBuIds = (Array.isArray(buOp.values) ? buOp.values : []).map(v => clean(v, 100)).filter(id => validBuIds.has(id));
    const targetRoles = (Array.isArray(roleOp.values) ? roleOp.values : []).map(v => clean(v, 80)).filter(r => validRoles.has(r));

    if (groupOp.mode === 'replace' && !targetGroupIds.length) fail('替换模式下必须至少选择一个有效客户群');
    if (roleOp.mode === 'replace' && !targetRoles.length) fail('替换模式下必须至少选择一个有效角色');

    const changes = [];
    for (const person of existing) {
        let currentGroups = personGroups(person);
        let currentBus = personBusinessUnits(person);
        let currentRoles = personRoles(person);

        if (groupOp.mode === 'replace') {
            currentGroups = [...targetGroupIds];
        } else if (groupOp.mode === 'add') {
            currentGroups = [...new Set([...currentGroups, ...targetGroupIds])];
        } else if (groupOp.mode === 'remove') {
            currentGroups = currentGroups.filter(g => !targetGroupIds.includes(g));
        }

        if (buOp.mode === 'replace') {
            currentBus = [...targetBuIds];
        } else if (buOp.mode === 'add') {
            currentBus = [...new Set([...currentBus, ...targetBuIds])];
        } else if (buOp.mode === 'remove') {
            currentBus = currentBus.filter(b => !targetBuIds.includes(b));
        }

        if (roleOp.mode === 'replace') {
            currentRoles = [...targetRoles];
        } else if (roleOp.mode === 'add') {
            currentRoles = [...new Set([...currentRoles, ...targetRoles])];
        } else if (roleOp.mode === 'remove') {
            currentRoles = currentRoles.filter(r => !targetRoles.includes(r));
        }

        if (!currentGroups.length) fail(`人员「${person.name} (${person.id})」调整后客户群为空，每位人员必须至少属于一个客户群`);
        if (!currentRoles.length) fail(`人员「${person.name} (${person.id})」调整后角色为空，每位人员必须至少具有一个角色`);

        const updated = {
            ...person,
            roles: currentRoles,
            role: currentRoles[0],
            customerGroupIds: currentGroups,
            customerGroupId: currentGroups[0] || '',
            businessUnitIds: currentBus,
            archived: false
        };
        changes.push({ kind: 'personnel', id: person.id, payload: updated });
    }

    await repo.putMany(changes, actor, '批量编辑人员', `批量更新 ${changes.length} 位人员属性`);
    res.json({ updatedCount: changes.length });
}));
router.post('/:kind', respond(async (req, res) => {
    const kind = req.params.kind, body = req.body || {}, actor = req.user.username;
    if (!['personnel', 'rules', 'records'].includes(kind)) fail('无效的数据类型');
    if (kind !== 'records' && req.user.role !== 'admin') fail('仅管理员可维护配置', 403);
    const state = await repo.list();
    let value, itemId = clean(body.id, 100) || id();
    if (kind === 'personnel') {
        const name = clean(body.name, 120);
        const roles = [...new Set((Array.isArray(body.roles) ? body.roles : [body.role]).map(value => clean(value, 80)).filter(Boolean))];
        const customerGroupIds = [...new Set((Array.isArray(body.customerGroupIds) ? body.customerGroupIds : [body.customerGroupId]).map(value => clean(value, 100)).filter(Boolean))];
        const businessUnitIds = [...new Set((Array.isArray(body.businessUnitIds) ? body.businessUnitIds : []).map(value => clean(value, 100)).filter(Boolean))];
        if (!name || !roles.length || !roles.every(role => state.roles.some(item => item.value === role))) fail('姓名和有效角色必填');
        if (!body.archived && (!customerGroupIds.length || !customerGroupIds.every(groupId => state.customerGroups.some(item => item.id === groupId)))) fail('请至少为人员配置一个有效客户群');
        if (!businessUnitIds.every(unitId => state.businessUnits.some(item => item.id === unitId))) fail('BU 配置无效');
        value = { id: itemId, name, roles, role: roles[0], customerGroupIds, customerGroupId: customerGroupIds[0] || '', businessUnitIds, archived: Boolean(body.archived) };
    } else if (kind === 'rules') {
        const svcModule = clean(body.svcModule, 100), subModule = clean(body.subModule, 100), desc = clean(body.desc, 1000), roles = Array.isArray(body.roles) ? body.roles.map(value => clean(value, 80)) : roleTokens(body.roles), deduct = clean(body.deduct, 100);
        if (!svcModule || !subModule || !desc || !roles.length || !deduct) fail('规则字段不完整');
        if (!roles.every(role => role.toUpperCase() === 'ALL' || state.roles.some(item => item.value === role)) || !state.deductions.some(item => item.value === deduct)) fail('角色或扣罚标准无效');
        const weight = body.weight === null ? null : Number(body.weight);
        if (weight !== null && (!Number.isInteger(weight) || weight < 0 || weight > 100)) fail('权重需为 0–100 或不适用');
        value = { id: itemId, svcModule, subModule, desc, roles, deduct, weight, archived: Boolean(body.archived) };
    } else if (kind === 'records') {
        const old = await repo.item('records', itemId);
        if (req.user.role !== 'admin' && (body.action === 'publish' || body.action === 'revoke')) fail('仅管理员可发布或撤销', 403);
        if (req.user.role !== 'admin' && old && old.createdBy !== actor) fail('只能编辑本人草稿', 403);
        if (old && old.status !== 'draft' && body.action !== 'revoke') fail('已发布记录不能编辑');
        const staffId = clean(body.staffId, 100), ruleId = clean(body.ruleId, 100), customerGroupId = clean(body.customerGroupId, 100), person = state.personnel.find(item => item.id === staffId && !item.archived), rule = state.rules.find(item => item.id === ruleId && !item.archived);
        if (body.action === 'revoke') {
            if (!old || old.status !== 'published') fail('只能撤销已发布记录');
            const reason = clean(body.reason, 1000); if (!reason) fail('撤销理由必填');
            await requireForceEditPin(req, body.pin);
            const revokeAttachment = clean(body.revokeAttachment, 200);
            if (revokeAttachment && !EVIDENCE_PATH_REGEX.test(revokeAttachment)) fail('撤销证明附件路径无效');
            value = { ...old, status: 'revoked', revokedAt: new Date().toISOString(), revokeReason: reason, revokedBy: actor, revokeAttachment: revokeAttachment || '' };
            return res.json(await repo.put(kind, itemId, value, actor, '撤销已发布违规', reason));
        }
        if (!person || !rule) fail('请选择有效的责任主体和规则');
        const group = state.customerGroups.find(item => item.id === customerGroupId);
        if (!group || !personGroups(person).includes(group.id)) fail('请先选择客户群，再选择该客户群下的责任主体');
        if (!matching(person, rule)) fail(`责任主体角色 ${personRoles(person).join('、')} 不匹配；本规则适用角色：${ruleRoles(rule).join('、')}`);
        const deduct = rule.deduct;
        if (body.deduct && clean(body.deduct, 100) !== deduct) fail('实际扣罚必须与所选规则的扣罚基准一致');
        const date = clean(body.date, 10); if (!validDate(date)) fail('日期无效');
        const action = clean(body.action, 20), reason = clean(body.reason, 1000);
        if (action === 'publish' && !reason) fail('发布理由必填');
        const attachments = parseAttachments(body);
        const attachment = attachments[0] || '';
        const businessUnitId = staffId !== old?.staffId ? personBusinessUnits(person)[0] || '' : old?.businessUnitId || personBusinessUnits(person)[0] || '';
        value = { ...(old || {}), id: itemId, createdBy: old?.createdBy || actor, date, staffId, customerGroupId, businessUnitId, ruleId, deduct, tt: clean(body.tt, 100), remark: clean(body.remark, 2000), evidence: clean(body.evidence, 500), attachment, attachments, status: action === 'publish' ? 'published' : 'draft', ruleSnapshot: { svcModule: rule.svcModule, subModule: rule.subModule, desc: rule.desc, roles: rule.roles, deduct: rule.deduct }, personSnapshot: { name: person.name, role: person.role, roles: personRoles(person), customerGroupId: group.id, customerGroupName: group.value, businessUnitId: personBusinessUnits(person)[0] || '', buName: state.businessUnits.find(b => b.id === personBusinessUnits(person)[0])?.value || '' }, ...(action === 'publish' ? { publishedAt: new Date().toISOString(), publishedBy: actor, publishReason: reason } : {}), migrationWarning: !matching(person, rule) };
    }
    res.json(await repo.put(kind, itemId, value, actor, body.action === 'publish' ? '发布' : '保存', clean(body.reason, 1000)));
}));

module.exports = router;
