const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { run, get, all, getDbPath } = require('./app-db');
const { getDataDir, getTenantId } = require('./tenant-context');
const defaultRules = require('../builtin-tools/department-reward-penalty/default-rules.json');

const DEFAULT_ROLES = ['MTD', 'TL', 'TE', 'SPM', 'MS', 'SEC', 'Software', 'CS', 'NTD', 'FME', 'TD', 'PM', 'admin', 'Redline Resource', 'SP manager', 'SP admin', 'Virtual Account'];
const DEFAULT_DEDUCTIONS = ['1 Month/Time', '1 Month/Ticket', '1 Quarter/Time', '1 Quarter/Ticket', '0.5 Year/Time', '1 Month/Resource', '1 Month/FME', '1 Month/Account', 'Quarterly', '1 Monthly/Time', 'Custom'];
const DEFAULT_DEDUCTION_CATEGORIES = [{ id: 'monthly', value: '按月' }, { id: 'quarterly', value: '按季度' }, { id: 'half-year', value: '按半年' }, { id: 'other', value: '其他' }];
const deductionCategory = value => /quarter/i.test(value) ? 'quarterly' : /year/i.test(value) ? 'half-year' : /month/i.test(value) ? 'monthly' : 'other';
const CORE_BACKUP_KINDS = new Set(['personnel', 'rules', 'records', 'roles', 'deductions', 'deductionCategories', 'customerGroups', 'businessUnits']);
const KINDS = new Set([...CORE_BACKUP_KINDS, 'snapshotMappings']);
const DEFAULT_SNAPSHOT_MAPPINGS = {
    roles: [
        { scanned: 'Solution Developer', target: 'TD' },
        { scanned: '方案制作人', target: 'TD' },
        { scanned: 'Originator', target: 'PM' },
        { scanned: '建单人', target: 'PM' },
        { scanned: 'Creator', target: 'PM' },
        { scanned: 'Owner', target: 'TL' },
        { scanned: 'L1 Solution Reviewer', target: 'SPM' },
        { scanned: 'L1评审人', target: 'SPM' },
        { scanned: '实施人', target: 'FME' },
        { scanned: 'Operator', target: 'FME' },
        { scanned: 'STAFF', target: 'FME' },
        { scanned: '申请人', target: 'TE' }
    ],
    customerGroups: [
        { scanned: 'ORG', target: 'Orange' },
        { scanned: 'EG-Egypt Orange', target: 'Orange' },
        { scanned: 'Orange Egypt', target: 'Orange' },
        { scanned: 'Orange', target: 'Orange' },
        { scanned: 'Vodafone', target: 'VDF' },
        { scanned: 'VF', target: 'VDF' },
        { scanned: 'VDF', target: 'Vodafone' },
        { scanned: 'EG-Egypt Vodafone', target: 'Vodafone' },
        { scanned: 'ET', target: 'Etisalat' },
        { scanned: 'EG-Egypt ET', target: 'Etisalat' },
        { scanned: 'ET (Etisalat)', target: 'Etisalat' },
        { scanned: 'Etisalat', target: 'Etisalat' },
        { scanned: 'Telecom Egypt', target: 'WE' },
        { scanned: 'TE', target: 'WE' },
        { scanned: 'WE', target: 'Telecom Egypt' },
        { scanned: 'EG-Egypt Telecom', target: 'Telecom Egypt' }
    ],
    businessUnits: [
        { scanned: '软件', target: 'Software' },
        { scanned: '无线', target: 'Wireless' },
        { scanned: '核心网', target: 'Core' },
        { scanned: '数通', target: 'Datacom' },
        { scanned: '传输', target: 'Transmission' }
    ]
};
const writeQueues = new Map();
const BACKUP_EVIDENCE_FILENAME = /^[a-f0-9-]{36}\.(?:pdf|png|jpg|txt|zip|rar|7z|tar|gz|eml|msg)$/i;
const MAX_BACKUP_ENTRIES = 2000;
const MAX_BACKUP_JSON_BYTES = 5 * 1024 * 1024;
const MAX_BACKUP_EVIDENCE_BYTES = 100 * 1024 * 1024;
const MAX_BACKUP_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;

async function ensureReady() {
    await run(`CREATE TABLE IF NOT EXISTS department_reward_penalty_items (
        kind TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (kind, id)
    )`);
    await run(`CREATE TABLE IF NOT EXISTS department_reward_penalty_audit (
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
        kind TEXT NOT NULL, item_id TEXT NOT NULL, before_json TEXT,
        after_json TEXT, reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_drp_audit_created_at ON department_reward_penalty_audit(created_at)');
    await run(`CREATE TABLE IF NOT EXISTS department_reward_penalty_security (
        key TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
}

async function list() {
    await ensureReady();
    const rows = await all('SELECT kind, id, payload_json FROM department_reward_penalty_items ORDER BY rowid');
    const state = { personnel: [], rules: [], records: [], roles: [], deductions: [], deductionCategories: [], customerGroups: [], businessUnits: [], snapshotMappings: null };
    for (const row of rows) {
        if (row.kind === 'snapshotMappings' && row.id === 'config') {
            try { state.snapshotMappings = JSON.parse(row.payload_json); } catch (_) {}
        } else if (CORE_BACKUP_KINDS.has(row.kind)) {
            state[row.kind].push(JSON.parse(row.payload_json));
        }
    }
    if (!state.snapshotMappings) {
        state.snapshotMappings = JSON.parse(JSON.stringify(DEFAULT_SNAPSHOT_MAPPINGS));
    }
    const savedRules = new Map(state.rules.map(rule => [rule.id, rule]));
    state.rules = [...defaultRules.map(rule => savedRules.get(rule.id) || rule), ...state.rules.filter(rule => !defaultRules.some(seed => seed.id === rule.id))];
    for (const [kind, defaults] of [['roles', [...new Set([...DEFAULT_ROLES, ...defaultRules.flatMap(rule => rule.roles).filter(r => r.toUpperCase() !== 'ALL')])]], ['deductions', [...new Set([...DEFAULT_DEDUCTIONS, ...defaultRules.map(rule => rule.deduct)])]]]) {
        const values = new Map(defaults.map(value => [value, { id: value, value, ...(kind === 'deductions' ? { categoryId: deductionCategory(value) } : {}) }]));
        for (const saved of state[kind]) values.set(saved.id, saved);
        state[kind] = [...values.values()].filter(item => !item.archived && (kind !== 'roles' || item.value.toUpperCase() !== 'ALL')).map(item => kind === 'deductions' ? { ...item, categoryId: item.categoryId || deductionCategory(item.value) } : item);
    }
    const categories = new Map(DEFAULT_DEDUCTION_CATEGORIES.map(item => [item.id, item]));
    for (const saved of state.deductionCategories) categories.set(saved.id, saved);
    state.deductionCategories = [...categories.values()].filter(item => !item.archived);
    state.customerGroups = state.customerGroups.filter(item => !item.archived);
    state.businessUnits = state.businessUnits.filter(item => !item.archived);
    return state;
}

async function listAudit({ page = 1, pageSize = 20 } = {}) {
    await ensureReady();
    const size = Math.max(1, Math.min(200, Number.parseInt(pageSize, 10) || 20));
    const count = await get('SELECT COUNT(*) AS total FROM department_reward_penalty_audit');
    const total = count.total;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const currentPage = Math.max(1, Math.min(totalPages, Number.parseInt(page, 10) || 1));
    const rows = await all('SELECT id, actor, action, kind, item_id, before_json, after_json, reason, created_at FROM department_reward_penalty_audit ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?', [size, (currentPage - 1) * size]);
    return { rows: rows.map(row => ({ ...row, before: row.before_json ? JSON.parse(row.before_json) : null, after: row.after_json ? JSON.parse(row.after_json) : null, before_json: undefined, after_json: undefined })), total, page: currentPage, pageSize: size, totalPages };
}

async function getAuditPayloadBytes() {
    await ensureReady();
    const row = await get(`SELECT COALESCE(SUM(
        COALESCE(length(CAST(before_json AS BLOB)), 0) + COALESCE(length(CAST(after_json AS BLOB)), 0)
    ), 0) AS bytes FROM department_reward_penalty_audit`);
    return row.bytes;
}

async function item(kind, id) {
    if (!KINDS.has(kind)) throw Object.assign(new Error('无效的数据类型'), { status: 400 });
    await ensureReady();
    const row = await get('SELECT payload_json FROM department_reward_penalty_items WHERE kind = ? AND id = ?', [kind, id]);
    if (row) return JSON.parse(row.payload_json);
    return kind === 'rules' ? defaultRules.find(rule => rule.id === id) || null : null;
}

async function audit(actor, action, kind, id, before, after, reason) {
    await run('INSERT INTO department_reward_penalty_audit (id, actor, action, kind, item_id, before_json, after_json, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), actor, action, kind, id, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason || '']);
}

async function hasCustomForceEditPin() {
    await ensureReady();
    return Boolean(await get('SELECT key FROM department_reward_penalty_security WHERE key = ?', ['force-edit-pin']));
}

async function verifyForceEditPin(pin) {
    await ensureReady();
    const row = await get('SELECT salt, hash FROM department_reward_penalty_security WHERE key = ?', ['force-edit-pin']);
    const salt = row?.salt || 'department-reward-penalty-default-pin-v1';
    const expected = row ? Buffer.from(row.hash, 'hex') : crypto.scryptSync('0000', salt, 32);
    const actual = crypto.scryptSync(String(pin ?? ''), salt, 32);
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

async function changeForceEditPin(currentPin, newPin, actor) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(newPin, salt, 32).toString('hex');
    const key = getDbPath();
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        await ensureReady();
        await run('BEGIN IMMEDIATE');
        try {
            if (!await verifyForceEditPin(currentPin)) throw Object.assign(new Error('当前修改口令不正确'), { status: 403 });
            await run('INSERT INTO department_reward_penalty_security (key, salt, hash, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, updated_at = CURRENT_TIMESTAMP', ['force-edit-pin', salt, hash]);
            await audit(actor, '修改强制编辑口令', 'security', 'force-edit-pin', null, { changed: true }, '');
            await run('COMMIT');
        } catch (error) {
            await run('ROLLBACK').catch(() => {});
            throw error;
        }
    });
    writeQueues.set(key, current);
    current.then(() => { if (writeQueues.get(key) === current) writeQueues.delete(key); }, () => { if (writeQueues.get(key) === current) writeQueues.delete(key); });
    return current;
}

async function put(kind, id, payload, actor, action = '保存', reason = '') {
    const results = await putMany([{ kind, id, payload }], actor, action, reason);
    return results[0];
}

async function putMany(changes, actor, action = '保存', reason = '') {
    const key = getDbPath();
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        await ensureReady();
        await run('BEGIN IMMEDIATE');
        try {
            const results = [];
            for (const { kind, id, payload } of changes) {
                if (!KINDS.has(kind)) throw new Error('无效的数据类型');
                const before = await item(kind, id);
                const after = { ...payload, id };
                await run('INSERT INTO department_reward_penalty_items (kind, id, payload_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(kind, id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP', [kind, id, JSON.stringify(after)]);
                await audit(actor, action, kind, id, before, after, reason);
                results.push(after);
            }
            await run('COMMIT');
            return results;
        } catch (error) {
            await run('ROLLBACK').catch(() => {});
            throw error;
        }
    });
    writeQueues.set(key, current);
    current.then(() => { if (writeQueues.get(key) === current) writeQueues.delete(key); }, () => { if (writeQueues.get(key) === current) writeQueues.delete(key); });
    return current;
}

async function putPublishedWithPin(id, payload, pin, actor, reason) {
    const key = getDbPath();
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        await ensureReady();
        await run('BEGIN IMMEDIATE');
        try {
            if (!await verifyForceEditPin(pin)) throw Object.assign(new Error('修改口令不正确'), { status: 403 });
            const before = await item('records', id);
            if (!before || before.status !== 'published') throw Object.assign(new Error('只能强制修改已发布记录'), { status: 409 });
            const after = { ...payload, id };
            await run('UPDATE department_reward_penalty_items SET payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE kind = ? AND id = ?', [JSON.stringify(after), 'records', id]);
            await audit(actor, '强制修改已发布违规', 'records', id, before, after, reason);
            await run('COMMIT');
            return after;
        } catch (error) {
            await run('ROLLBACK').catch(() => {});
            throw error;
        }
    });
    writeQueues.set(key, current);
    current.then(() => { if (writeQueues.get(key) === current) writeQueues.delete(key); }, () => { if (writeQueues.get(key) === current) writeQueues.delete(key); });
    return current;
}

async function correctHistoricalRoleWithPin(id, { expectedRole, expectedRuleId, expectedRuleSnapshot, role, pin, actor, reason }) {
    const key = getDbPath();
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        await ensureReady();
        await run('BEGIN IMMEDIATE');
        try {
            if (!await verifyForceEditPin(pin)) throw Object.assign(new Error('修改口令不正确'), { status: 403 });
            const before = await item('records', id);
            if (!before || before.status !== 'published' || before.createdBy !== 'legacy-import' || !before.migrationWarning) {
                throw Object.assign(new Error('仅可更正待复核的已发布迁移记录'), { status: 409 });
            }
            if (before.ruleId !== expectedRuleId || before.personSnapshot?.role !== expectedRole || JSON.stringify(before.ruleSnapshot) !== JSON.stringify(expectedRuleSnapshot)) {
                throw Object.assign(new Error('记录已变更，请刷新后重试'), { status: 409 });
            }
            const now = new Date().toISOString();
            const after = {
                ...before,
                personSnapshot: { ...before.personSnapshot, role, roles: [role] },
                migrationWarning: false,
                historicalRoleCorrection: { from: expectedRole, to: role, correctedAt: now, correctedBy: actor, reason },
                forcedEditAt: now, forcedEditBy: actor, forcedEditReason: reason
            };
            await run('UPDATE department_reward_penalty_items SET payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE kind = ? AND id = ?', [JSON.stringify(after), 'records', id]);
            await audit(actor, '更正迁移记录历史角色', 'records', id, before, after, reason);
            await run('COMMIT');
            return after;
        } catch (error) {
            await run('ROLLBACK').catch(() => {});
            throw error;
        }
    });
    writeQueues.set(key, current);
    current.then(() => { if (writeQueues.get(key) === current) writeQueues.delete(key); }, () => { if (writeQueues.get(key) === current) writeQueues.delete(key); });
    return current;
}

async function remove(kind, id, actor, action = '删除', reason = '') {
    const key = getDbPath();
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        await ensureReady();
        await run('BEGIN IMMEDIATE');
        try {
            if (!KINDS.has(kind)) throw new Error('无效的数据类型');
            const before = await item(kind, id);
            if (!before) throw Object.assign(new Error('记录不存在'), { status: 404 });
            await run('DELETE FROM department_reward_penalty_items WHERE kind = ? AND id = ?', [kind, id]);
            await audit(actor, action, kind, id, before, null, reason);
            await run('COMMIT');
            return { success: true, id };
        } catch (error) {
            await run('ROLLBACK').catch(() => {});
            throw error;
        }
    });
    writeQueues.set(key, current);
    current.then(() => { if (writeQueues.get(key) === current) writeQueues.delete(key); }, () => { if (writeQueues.get(key) === current) writeQueues.delete(key); });
    return current;
}

async function exportBackupPackage({ includeEvidence = true, actor = 'system', tenantId } = {}) {
    await ensureReady();
    const effectiveTenantId = tenantId || getTenantId();
    const state = await list();
    const dbRows = await all('SELECT kind, id, payload_json FROM department_reward_penalty_items ORDER BY rowid');
    const dbItemsByKind = {};
    for (const k of KINDS) dbItemsByKind[k] = new Map();
    for (const row of dbRows) {
        if (KINDS.has(row.kind)) {
            try { dbItemsByKind[row.kind].set(row.id, JSON.parse(row.payload_json)); } catch (_) {}
        }
    }

    const collections = {};
    for (const kind of CORE_BACKUP_KINDS) {
        const map = new Map();
        for (const item of (state[kind] || [])) {
            if (item && (item.id || item.value)) map.set(item.id || item.value, item);
        }
        for (const [id, item] of dbItemsByKind[kind].entries()) {
            map.set(id, item);
        }
        collections[kind] = Array.from(map.values());
    }

    const evidenceDir = path.join(getDataDir(effectiveTenantId), 'department-reward-penalty-evidence');
    const evidenceFiles = new Set();
    for (const rec of collections.records || []) {
        const atts = Array.isArray(rec.attachments) ? rec.attachments : [rec.attachment].filter(Boolean);
        if (rec.revokeAttachment) atts.push(rec.revokeAttachment);
        for (const p of atts) {
            if (typeof p === 'string') {
                const fn = path.basename(p);
                if (fn && /^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(fn)) evidenceFiles.add(fn);
            }
        }
    }
    if (fs.existsSync(evidenceDir)) {
        try {
            const files = fs.readdirSync(evidenceDir);
            for (const f of files) {
                if (/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(f)) evidenceFiles.add(f);
            }
        } catch (_) {}
    }

    const exportedAt = new Date().toISOString();
    const manifest = {
        type: 'department-reward-penalty-backup',
        version: 1,
        exportedAt,
        exportedBy: actor,
        tenantId: effectiveTenantId,
        stats: {
            personnel: collections.personnel.length,
            rules: collections.rules.length,
            records: collections.records.length,
            roles: collections.roles.length,
            deductions: collections.deductions.length,
            deductionCategories: collections.deductionCategories.length,
            customerGroups: collections.customerGroups.length,
            businessUnits: collections.businessUnits.length,
            evidenceFiles: evidenceFiles.size
        }
    };

    let includedEvidenceCount = 0;
    let includedEvidenceBytes = 0;
    const evidenceContents = [];
    if (includeEvidence && fs.existsSync(evidenceDir)) {
        for (const filename of evidenceFiles) {
            const filepath = path.join(evidenceDir, filename);
            if (fs.existsSync(filepath)) {
                try {
                    const content = fs.readFileSync(filepath);
                    if (content.length > MAX_BACKUP_EVIDENCE_FILE_BYTES || includedEvidenceBytes + content.length > MAX_BACKUP_EVIDENCE_BYTES) invalidBackup('证据文件超出备份包安全限制，无法生成可恢复的完整备份');
                    evidenceContents.push([filename, content]);
                    includedEvidenceBytes += content.length;
                    includedEvidenceCount++;
                } catch (error) {
                    if (error.status) throw error;
                    throw Object.assign(new Error(`证据文件读取失败：${filename}`), { status: 500 });
                }
            }
        }
    }
    manifest.stats.evidenceFiles = includedEvidenceCount;
    if (includedEvidenceCount + 3 > MAX_BACKUP_ENTRIES) invalidBackup('证据文件数量超出备份包安全限制，无法生成可恢复的完整备份');

    const dataJson = JSON.stringify(collections, null, 2);
    if (Buffer.byteLength(dataJson, 'utf8') > MAX_BACKUP_JSON_BYTES) invalidBackup('业务数据超出备份包安全限制，无法生成可恢复的完整备份');
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('data.json', dataJson);
    if (evidenceContents.length) {
        const evidenceFolder = zip.folder('evidence');
        for (const [filename, content] of evidenceContents) evidenceFolder.file(filename, content);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    await audit(actor, '导出备份数据包', 'backup', 'export', null, { stats: manifest.stats, includeEvidence }, '导出数据备份包');

    return {
        zipBuffer,
        jsonString: JSON.stringify({ manifest, data: collections }, null, 2),
        manifest,
        filename: `department-reward-penalty-backup-${exportedAt.slice(0, 10)}.zip`
    };
}

async function parseBackupContent(bufferOrObject) {
    if (!bufferOrObject) throw Object.assign(new Error('备份数据包为空'), { status: 400 });
    if (Buffer.isBuffer(bufferOrObject)) {
        if (bufferOrObject.length >= 4 && bufferOrObject[0] === 0x50 && bufferOrObject[1] === 0x4b && bufferOrObject[2] === 0x03 && bufferOrObject[3] === 0x04) {
            const zip = await JSZip.loadAsync(bufferOrObject);
            const zipEntries = Object.values(zip.files);
            if (zipEntries.length > MAX_BACKUP_ENTRIES) throw Object.assign(new Error('备份包文件数量超过安全限制'), { status: 400 });
            const dataFile = zip.file('data.json');
            if (!dataFile) throw Object.assign(new Error('备份数据包中缺少 data.json 文件'), { status: 400 });
            const declaredDataSize = Number(dataFile._data?.uncompressedSize);
            if (Number.isFinite(declaredDataSize) && declaredDataSize > MAX_BACKUP_JSON_BYTES) throw Object.assign(new Error('备份数据内容超过安全限制'), { status: 400 });
            const dataText = await dataFile.async('string');
            if (Buffer.byteLength(dataText, 'utf8') > MAX_BACKUP_JSON_BYTES) throw Object.assign(new Error('备份数据内容超过安全限制'), { status: 400 });
            const data = JSON.parse(dataText);
            const manifestFile = zip.file('manifest.json');
            const manifest = manifestFile ? JSON.parse(await manifestFile.async('string')) : null;

            const evidenceMap = new Map();
            const files = zip.file(/^evidence\//);
            let totalEvidenceBytes = 0;
            for (const file of files) {
                if (!file.dir) {
                    const filename = path.basename(file.name);
                    if (!BACKUP_EVIDENCE_FILENAME.test(filename)) throw Object.assign(new Error('备份包中包含无效的证据文件名'), { status: 400 });
                    const declaredSize = Number(file._data?.uncompressedSize);
                    if (Number.isFinite(declaredSize) && (declaredSize > MAX_BACKUP_EVIDENCE_FILE_BYTES || totalEvidenceBytes + declaredSize > MAX_BACKUP_EVIDENCE_BYTES)) throw Object.assign(new Error('备份包证据文件超过安全限制'), { status: 400 });
                    const buffer = await file.async('nodebuffer');
                    if (buffer.length > MAX_BACKUP_EVIDENCE_FILE_BYTES || totalEvidenceBytes + buffer.length > MAX_BACKUP_EVIDENCE_BYTES) throw Object.assign(new Error('备份包证据文件超过安全限制'), { status: 400 });
                    totalEvidenceBytes += buffer.length;
                    evidenceMap.set(filename, buffer);
                }
            }
            return { data, manifest, evidenceMap };
        } else {
            const text = bufferOrObject.toString('utf8');
            const parsed = JSON.parse(text);
            if (parsed.data && typeof parsed.data === 'object') {
                return { data: parsed.data, manifest: parsed.manifest || null, evidenceMap: new Map() };
            }
            return { data: parsed, manifest: null, evidenceMap: new Map() };
        }
    } else if (typeof bufferOrObject === 'object') {
        if (bufferOrObject.data && typeof bufferOrObject.data === 'object') {
            return { data: bufferOrObject.data, manifest: bufferOrObject.manifest || null, evidenceMap: new Map() };
        }
        return { data: bufferOrObject, manifest: null, evidenceMap: new Map() };
    }
    throw Object.assign(new Error('不支持的数据包格式'), { status: 400 });
}

function invalidBackup(message) {
    throw Object.assign(new Error(message), { status: 400 });
}

function validateIncomingData(data, { mode = 'merge', currentState } = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) invalidBackup('数据包内容不是有效的对象');
    const presentKinds = [...CORE_BACKUP_KINDS].filter(kind => Object.hasOwn(data, kind));
    if (!presentKinds.length) invalidBackup('数据包不包含奖惩业务数据');
    if (mode === 'replace' && presentKinds.length !== CORE_BACKUP_KINDS.size) invalidBackup('覆盖恢复需要包含全部数据分类的完整备份包');
    if (mode === 'replace' && !presentKinds.some(kind => Array.isArray(data[kind]) && data[kind].length)) invalidBackup('覆盖恢复不能使用全空数据包');
    for (const kind of CORE_BACKUP_KINDS) {
        if (Object.hasOwn(data, kind) && !Array.isArray(data[kind])) {
            invalidBackup(`数据包中的 "${kind}" 不是有效的数组`);
        }
        const ids = new Set();
        for (const item of data[kind] || []) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) invalidBackup(`数据包中的 "${kind}" 包含无效项目`);
            const itemId = String(item.id || item.value || '').trim();
            if (!itemId || itemId.length > 100 || ids.has(itemId)) invalidBackup(`数据包中的 "${kind}" 存在缺失或重复 ID`);
            ids.add(itemId);
        }
    }
    if (!currentState) return;
    const fromCurrent = kind => mode === 'merge' ? currentState[kind] || [] : [];
    const combined = kind => new Map([...fromCurrent(kind), ...(data[kind] || [])].map(item => [item.id || item.value, item]));
    const groups = combined('customerGroups'), bus = combined('businessUnits');
    const roles = new Set([...DEFAULT_ROLES, ...defaultRules.flatMap(rule => rule.roles), ...combined('roles').values()].map(item => typeof item === 'string' ? item : item.value));
    const deductions = new Set([...DEFAULT_DEDUCTIONS, ...defaultRules.map(rule => rule.deduct), ...combined('deductions').values()].map(item => typeof item === 'string' ? item : item.value));
    const categories = new Set([...DEFAULT_DEDUCTION_CATEGORIES.map(item => item.id), ...combined('deductionCategories').keys()]);
    const personnel = combined('personnel');
    const rules = new Map([...defaultRules, ...combined('rules').values()].map(rule => [rule.id, rule]));
    for (const deduction of data.deductions || []) {
        if (!deduction.value || !categories.has(deduction.categoryId || deductionCategory(deduction.value))) invalidBackup('扣罚标准存在无效分类');
    }
    for (const person of data.personnel || []) {
        if (!String(person.name || '').trim()) invalidBackup('人员姓名不能为空');
        const personRoleValues = Array.isArray(person.roles) ? person.roles : [person.role].filter(Boolean);
        if (!personRoleValues.length || personRoleValues.some(role => !roles.has(role))) invalidBackup('人员引用了无效角色');
        const groupIds = Array.isArray(person.customerGroupIds) ? person.customerGroupIds : [person.customerGroupId].filter(Boolean);
        if (groupIds.some(id => !groups.has(id))) invalidBackup('人员引用了不存在的客户群');
        if (!person.archived && !groupIds.length && (Object.hasOwn(person, 'customerGroupIds') || Object.hasOwn(person, 'customerGroupId'))) invalidBackup('在册人员至少需要一个客户群');
        const buIds = Array.isArray(person.businessUnitIds) ? person.businessUnitIds : [];
        if (buIds.some(id => !bus.has(id))) invalidBackup('人员引用了不存在的 BU');
    }
    for (const rule of data.rules || []) {
        const ruleRoleValues = Array.isArray(rule.roles) ? rule.roles : String(rule.roles || '').split(/[,+/]/).map(value => value.trim()).filter(Boolean);
        if (!rule.svcModule || !rule.subModule || !rule.desc || !ruleRoleValues.length || ruleRoleValues.some(role => role !== 'ALL' && !roles.has(role)) || !deductions.has(rule.deduct)) invalidBackup('规则字段或角色、扣罚标准引用无效');
        if (rule.weight != null && (!Number.isInteger(Number(rule.weight)) || Number(rule.weight) < 0 || Number(rule.weight) > 100)) invalidBackup('规则权重无效');
    }
    for (const record of data.records || []) {
        if (!['draft', 'published', 'revoked', 'archived'].includes(record.status) || !/^\d{4}-\d{2}-\d{2}$/.test(String(record.date || ''))) invalidBackup('违规记录状态或日期无效');
        const historical = record.status !== 'draft';
        if (!personnel.has(record.staffId) && !(historical && record.personSnapshot?.name)) invalidBackup('违规记录引用了不存在的人员');
        if (!rules.has(record.ruleId) && !(historical && record.ruleSnapshot?.desc)) invalidBackup('违规记录引用了不存在的规则');
        if (record.customerGroupId && !groups.has(record.customerGroupId) && !(historical && record.personSnapshot?.customerGroupName)) invalidBackup('违规记录引用了不存在的客户群');
        if (record.status === 'draft' && !record.customerGroupId && record.createdBy !== 'legacy-import') invalidBackup('违规草稿缺少客户群');
    }
}

async function inspectBackupPackage(bufferOrObject, { mode = 'merge' } = {}) {
    await ensureReady();
    const { data: incoming, manifest, evidenceMap } = await parseBackupContent(bufferOrObject);
    const currentState = await list();
    validateIncomingData(incoming, { mode, currentState });
    const diff = {};
    const stats = {};

    for (const kind of CORE_BACKUP_KINDS) {
        const items = incoming[kind] || [];
        stats[kind] = items.length;
        const currentItems = currentState[kind] || [];
        const currentIdSet = new Set(currentItems.map(item => String(item.id || item.value)));
        let newCount = 0, updateCount = 0;
        for (const item of items) {
            const id = String(item.id || item.value);
            if (currentIdSet.has(id)) updateCount++;
            else newCount++;
        }
        diff[kind] = { new: newCount, update: updateCount, total: items.length, current: currentItems.length };
    }
    stats.evidenceFiles = evidenceMap ? evidenceMap.size : 0;

    return {
        valid: true,
        manifest: manifest || { type: 'department-reward-penalty-backup', version: 1, exportedAt: '未知' },
        stats,
        diff
    };
}

async function restoreBackupPackage(bufferOrObject, { mode = 'merge', pin, actor = 'admin', tenantId } = {}) {
    if (!['merge', 'replace'].includes(mode)) throw Object.assign(new Error('无效的恢复模式'), { status: 400 });
    await ensureReady();
    const effectiveTenantId = tenantId || getTenantId();
    const { data: incomingData, evidenceMap } = await parseBackupContent(bufferOrObject);
    validateIncomingData(incomingData, { mode });

    const key = getDbPath();
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        await ensureReady();
        validateIncomingData(incomingData, { mode, currentState: await list() });
        const evidenceDir = path.join(getDataDir(effectiveTenantId), 'department-reward-penalty-evidence');
        if (mode === 'replace') {
            if (!await verifyForceEditPin(pin)) throw Object.assign(new Error('操作口令不正确，覆盖恢复已被拦截'), { status: 403 });
            const safetyDir = path.join(getDataDir(effectiveTenantId), 'department-reward-penalty-backups');
            fs.mkdirSync(safetyDir, { recursive: true });
            const safety = await exportBackupPackage({ includeEvidence: true, actor: 'system-safety-backup', tenantId: effectiveTenantId });
            const safetyFile = path.join(safetyDir, `safety-before-replace-${crypto.randomUUID()}.zip`);
            fs.writeFileSync(safetyFile, safety.zipBuffer, { flag: 'wx' });
        }
        const stagingDir = fs.mkdtempSync(path.join(getDataDir(effectiveTenantId), 'department-reward-penalty-restore-'));
        const stagedEvidenceDir = path.join(stagingDir, 'incoming');
        const rollbackDir = path.join(stagingDir, 'previous');
        const archivedEvidenceDir = mode === 'replace' && fs.existsSync(evidenceDir)
            ? `${evidenceDir}.pre-replace-${crypto.randomUUID()}`
            : null;
        const promotedFiles = [];
        let evidenceSwapped = false;
        let committed = false;
        try {
            fs.mkdirSync(stagedEvidenceDir);
            fs.mkdirSync(rollbackDir);
            for (const [filename, fileBuffer] of evidenceMap.entries()) {
                fs.writeFileSync(path.join(stagedEvidenceDir, filename), fileBuffer, { flag: 'wx' });
            }
            await run('BEGIN IMMEDIATE');
            const counts = { personnel: 0, rules: 0, records: 0, roles: 0, deductions: 0, deductionCategories: 0, customerGroups: 0, businessUnits: 0, evidence: 0 };
            if (mode === 'replace') {
                for (const kind of CORE_BACKUP_KINDS) {
                    await run('DELETE FROM department_reward_penalty_items WHERE kind = ?', [kind]);
                }
                for (const kind of CORE_BACKUP_KINDS) {
                    const items = incomingData[kind] || [];
                    for (const item of items) {
                        const itemId = String(item.id || item.value || crypto.randomUUID());
                        const payload = { ...item, id: itemId };
                        await run('INSERT INTO department_reward_penalty_items (kind, id, payload_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [kind, itemId, JSON.stringify(payload)]);
                        counts[kind]++;
                    }
                }
            } else {
                for (const kind of CORE_BACKUP_KINDS) {
                    const items = incomingData[kind] || [];
                    for (const item of items) {
                        const itemId = String(item.id || item.value || crypto.randomUUID());
                        const payload = { ...item, id: itemId };
                        await run('INSERT INTO department_reward_penalty_items (kind, id, payload_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(kind, id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP', [kind, itemId, JSON.stringify(payload)]);
                        counts[kind]++;
                    }
                }
            }

            if (mode === 'replace') {
                if (archivedEvidenceDir) fs.renameSync(evidenceDir, archivedEvidenceDir);
                fs.renameSync(stagedEvidenceDir, evidenceDir);
                evidenceSwapped = true;
            } else if (evidenceMap.size > 0) {
                fs.mkdirSync(evidenceDir, { recursive: true });
                for (const filename of evidenceMap.keys()) {
                    const target = path.join(evidenceDir, filename);
                    const existed = fs.existsSync(target);
                    if (existed) fs.copyFileSync(target, path.join(rollbackDir, filename));
                    fs.renameSync(path.join(stagedEvidenceDir, filename), target);
                    promotedFiles.push({ filename, existed });
                }
            }
            counts.evidence = evidenceMap.size;

            await audit(actor, mode === 'replace' ? '覆盖恢复数据包' : '增量恢复数据包', 'backup', mode, null, { mode, counts }, `执行数据包${mode === 'replace' ? '覆盖' : '增量'}恢复`);
            await run('COMMIT');
            committed = true;
            if (archivedEvidenceDir) {
                try { fs.rmSync(archivedEvidenceDir, { recursive: true, force: true }); }
                catch (cleanupError) { console.warn('[department-reward-penalty] Replaced evidence cleanup warning:', cleanupError.message); }
            }
            return { success: true, mode, counts };
        } catch (error) {
            if (!committed) await run('ROLLBACK').catch(() => {});
            if (mode === 'replace' && !committed && (evidenceSwapped || archivedEvidenceDir && fs.existsSync(archivedEvidenceDir))) {
                if (fs.existsSync(evidenceDir)) fs.rmSync(evidenceDir, { recursive: true, force: true });
                if (archivedEvidenceDir && fs.existsSync(archivedEvidenceDir)) fs.renameSync(archivedEvidenceDir, evidenceDir);
            } else if (mode === 'merge' && !committed) {
                for (const { filename, existed } of promotedFiles.reverse()) {
                    const target = path.join(evidenceDir, filename);
                    if (existed) fs.copyFileSync(path.join(rollbackDir, filename), target);
                    else if (fs.existsSync(target)) fs.unlinkSync(target);
                }
            }
            throw error;
        } finally {
            try { fs.rmSync(stagingDir, { recursive: true, force: true }); }
            catch (cleanupError) { console.warn('[department-reward-penalty] Restore staging cleanup warning:', cleanupError.message); }
        }
    });

    writeQueues.set(key, current);
    current.then(() => { if (writeQueues.get(key) === current) writeQueues.delete(key); }, () => { if (writeQueues.get(key) === current) writeQueues.delete(key); });
    return current;
}

async function getSnapshotMappings() {
    await ensureReady();
    const row = await get('SELECT payload_json FROM department_reward_penalty_items WHERE kind = ? AND id = ?', ['snapshotMappings', 'config']);
    if (!row || !row.payload_json) {
        return JSON.parse(JSON.stringify(DEFAULT_SNAPSHOT_MAPPINGS));
    }
    try {
        const saved = JSON.parse(row.payload_json);
        const hasCustomBUs = Boolean(saved.hasCustomBusinessUnits);
        const buList = Array.isArray(saved.businessUnits) ? saved.businessUnits : null;
        let businessUnits = DEFAULT_SNAPSHOT_MAPPINGS.businessUnits;
        if (hasCustomBUs && buList) {
            businessUnits = buList;
        } else if (buList && buList.length > 0) {
            businessUnits = buList;
        }

        const savedRoles = Array.isArray(saved.roles) ? [...saved.roles] : [];
        for (const def of DEFAULT_SNAPSHOT_MAPPINGS.roles) {
            if (!savedRoles.some(m => String(m.scanned || '').trim().toLowerCase() === String(def.scanned).trim().toLowerCase())) {
                savedRoles.push(def);
            }
        }

        const savedGroups = Array.isArray(saved.customerGroups) ? [...saved.customerGroups] : [];
        for (const def of DEFAULT_SNAPSHOT_MAPPINGS.customerGroups) {
            if (!savedGroups.some(m => String(m.scanned || '').trim().toLowerCase() === String(def.scanned).trim().toLowerCase())) {
                savedGroups.push(def);
            }
        }

        return {
            roles: savedRoles,
            customerGroups: savedGroups,
            businessUnits,
            updatedAt: saved.updatedAt || ''
        };
    } catch {
        return JSON.parse(JSON.stringify(DEFAULT_SNAPSHOT_MAPPINGS));
    }
}

async function saveSnapshotMappings(mappings, actor = 'System') {
    await ensureReady();
    const existing = await getSnapshotMappings();
    const hasCustomBUs = Array.isArray(mappings?.businessUnits) || Boolean(existing?.hasCustomBusinessUnits);
    const payload = {
        id: 'config',
        roles: Array.isArray(mappings?.roles) ? mappings.roles.filter(m => m && String(m.scanned || '').trim() && String(m.target || '').trim()).map(m => ({
            scanned: String(m.scanned).trim(),
            target: String(m.target).trim()
        })) : (Array.isArray(existing?.roles) ? existing.roles : []),
        customerGroups: Array.isArray(mappings?.customerGroups) ? mappings.customerGroups.filter(m => m && String(m.scanned || '').trim() && String(m.target || '').trim()).map(m => ({
            scanned: String(m.scanned).trim(),
            target: String(m.target).trim()
        })) : (Array.isArray(existing?.customerGroups) ? existing.customerGroups : []),
        businessUnits: Array.isArray(mappings?.businessUnits) ? mappings.businessUnits.filter(m => m && String(m.scanned || '').trim() && String(m.target || '').trim()).map(m => ({
            scanned: String(m.scanned).trim(),
            target: String(m.target).trim()
        })) : (Array.isArray(existing?.businessUnits) ? existing.businessUnits : []),
        hasCustomBusinessUnits: hasCustomBUs,
        updatedAt: new Date().toISOString()
    };
    await put('snapshotMappings', 'config', payload, actor, '更新快照字段映射', '更新角色、客户群及BU映射配置');
    return payload;
}

module.exports = {
    DEFAULT_ROLES, DEFAULT_DEDUCTIONS, DEFAULT_DEDUCTION_CATEGORIES, deductionCategory,
    DEFAULT_SNAPSHOT_MAPPINGS, getSnapshotMappings, saveSnapshotMappings,
    ensureReady, list, listAudit, getAuditPayloadBytes, item, put, putMany, putPublishedWithPin, correctHistoricalRoleWithPin, remove, audit,
    hasCustomForceEditPin, verifyForceEditPin, changeForceEditPin,
    exportBackupPackage, inspectBackupPackage, restoreBackupPackage, parseBackupContent
};
