const crypto = require('crypto');
const { run, get, all } = require('./platform-db');
const authority = require('./desktop-license-authority');
const registry = require('./desktop-license-registry');
const { decodeMachineCode } = require('./desktop-machine-code');

// 桌面版「一键申请 License」：桌面端在线提交机器码 → 管理员在签发后台一键审批 → 桌面端轮询取回并自动激活。
// 申请记录属于控制面数据，存平台库（platform-db）。轮询凭据只存 SHA-256 摘要；签出的 License 绑定该设备，
// 即使被他人取走也无法在其他电脑使用。
const MAX_PENDING = 300;
const DEFAULT_DAYS = 30;
const STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);

let initPromise = null;
function ensureReady() {
    if (!initPromise) {
        initPromise = run(`
            CREATE TABLE IF NOT EXISTS desktop_license_requests (
                request_id TEXT PRIMARY KEY,
                secret_digest TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                machine_json TEXT NOT NULL,
                applicant_name TEXT NOT NULL DEFAULT '',
                applicant_note TEXT NOT NULL DEFAULT '',
                client_version TEXT NOT NULL DEFAULT '',
                client_ip TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                license_id TEXT,
                token TEXT,
                expires_at INTEGER,
                decided_by TEXT NOT NULL DEFAULT '',
                reject_reason TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                decided_at INTEGER
            )
        `).then(() => run('CREATE INDEX IF NOT EXISTS idx_desktop_license_requests_status ON desktop_license_requests (status, created_at)'))
            .then(() => run('CREATE INDEX IF NOT EXISTS idx_desktop_license_requests_machine ON desktop_license_requests (machine_id, status)'))
            .catch(error => { initPromise = null; throw error; });
    }
    return initPromise;
}

const digest = value => crypto.createHash('sha256').update(String(value || '')).digest('base64url');
const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);

function toAdminRecord(row) {
    if (!row) return null;
    const machine = JSON.parse(row.machine_json || '{}');
    const existing = registry.listRecords().find(item => item.machine && item.machine.machineId === row.machine_id && item.status !== 'archived') || null;
    return {
        requestId: row.request_id,
        status: row.status,
        applicantName: row.applicant_name,
        applicantNote: row.applicant_note,
        clientVersion: row.client_version,
        clientIp: row.client_ip,
        machine,
        licenseId: row.license_id || null,
        expiresAt: row.expires_at || null,
        decidedBy: row.decided_by,
        rejectReason: row.reject_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        decidedAt: row.decided_at || null,
        existingLicense: existing ? { licenseId: existing.licenseId, label: existing.label, status: existing.status, expiresAt: existing.expiresAt } : null
    };
}

function toClientStatus(row) {
    return {
        requestId: row.request_id,
        status: row.status,
        createdAt: row.created_at,
        decidedAt: row.decided_at || null,
        rejectReason: row.status === 'rejected' ? row.reject_reason : '',
        token: row.status === 'approved' ? row.token : null,
        expiresAt: row.status === 'approved' ? row.expires_at : null
    };
}

// 同一设备已有待审批申请时复用该条（更新申请人信息并轮换轮询凭据），避免重复提交堆积
async function submitRequest({ machineCode, applicantName, applicantNote, clientVersion, clientIp }) {
    await ensureReady();
    const machine = decodeMachineCode(machineCode);
    if (!machine.valid) throw Object.assign(new Error('机器码无效'), { code: machine.reasonCode });
    const name = clean(applicantName, 40);
    if (!name) throw Object.assign(new Error('请填写申请人'), { code: 'APPLICANT_REQUIRED' });
    const note = clean(applicantNote, 200);
    const now = Date.now();
    const secret = crypto.randomBytes(24).toString('base64url');
    const machineJson = JSON.stringify({
        machineId: machine.machineId, machineCode: machine.code, host: machine.host,
        platform: machine.platform, arch: machine.arch, source: machine.source
    });
    const pending = await get(`SELECT request_id FROM desktop_license_requests WHERE machine_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [machine.machineId]);
    if (pending) {
        await run(`UPDATE desktop_license_requests SET secret_digest = ?, machine_json = ?, applicant_name = ?, applicant_note = ?, client_version = ?, client_ip = ?, updated_at = ? WHERE request_id = ?`,
            [digest(secret), machineJson, name, note, clean(clientVersion, 32), clean(clientIp, 64), now, pending.request_id]);
        const row = await get('SELECT * FROM desktop_license_requests WHERE request_id = ?', [pending.request_id]);
        return { ...toClientStatus(row), secret, reused: true };
    }
    const count = await get(`SELECT COUNT(1) AS count FROM desktop_license_requests WHERE status = 'pending'`);
    if (count && count.count >= MAX_PENDING) throw Object.assign(new Error('待审批申请过多，请联系管理员'), { code: 'TOO_MANY_PENDING' });
    const requestId = crypto.randomUUID();
    await run(`INSERT INTO desktop_license_requests (request_id, secret_digest, machine_id, machine_json, applicant_name, applicant_note, client_version, client_ip, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [requestId, digest(secret), machine.machineId, machineJson, name, note, clean(clientVersion, 32), clean(clientIp, 64), now, now]);
    const row = await get('SELECT * FROM desktop_license_requests WHERE request_id = ?', [requestId]);
    return { ...toClientStatus(row), secret, reused: false };
}

// 桌面端轮询：申请编号 + 轮询凭据 + 本机指纹三者匹配才返回状态（审批通过时附带绑定本机的 License）
async function getClientStatus({ requestId, secret, machineId }) {
    await ensureReady();
    const row = await get('SELECT * FROM desktop_license_requests WHERE request_id = ?', [String(requestId || '')]);
    if (!row || row.secret_digest !== digest(secret) || row.machine_id !== String(machineId || '')) {
        throw Object.assign(new Error('申请不存在或凭据不匹配'), { code: 'REQUEST_NOT_FOUND' });
    }
    return toClientStatus(row);
}

async function cancelRequest({ requestId, secret, machineId }) {
    const status = await getClientStatus({ requestId, secret, machineId });
    if (status.status === 'pending') {
        await run(`UPDATE desktop_license_requests SET status = 'cancelled', updated_at = ?, decided_at = ? WHERE request_id = ?`, [Date.now(), Date.now(), status.requestId]);
    }
    return getClientStatus({ requestId, secret, machineId });
}

async function listRequests({ status = 'pending', limit = 100 } = {}) {
    await ensureReady();
    const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 100));
    const rows = status && STATUSES.has(status)
        ? await all('SELECT * FROM desktop_license_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, safeLimit])
        : await all('SELECT * FROM desktop_license_requests ORDER BY created_at DESC LIMIT ?', [safeLimit]);
    return rows.map(toAdminRecord);
}

async function getPendingRow(requestId) {
    await ensureReady();
    const row = await get('SELECT * FROM desktop_license_requests WHERE request_id = ?', [String(requestId || '')]);
    if (!row) throw new Error('未找到该申请');
    if (row.status !== 'pending') throw new Error(`该申请已处理（${row.status}）`);
    return row;
}

// 一键审批：该设备已有 License（未归档）时续期原记录，否则新签发；有效期默认 30 天，可改天数或指定到期时间
async function approveRequest(requestId, { days, expiresAt, label, decidedBy } = {}) {
    const row = await getPendingRow(requestId);
    const machine = JSON.parse(row.machine_json);
    const existing = registry.listRecords().find(item => item.machine && item.machine.machineId === row.machine_id && item.status !== 'archived');
    const validity = Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0
        ? { expiresAt: Number(expiresAt) }
        : { days: Math.max(1, Math.min(3650, Number.parseInt(days, 10) || DEFAULT_DAYS)) };
    const result = existing
        ? authority.renew(existing.licenseId, validity)
        : authority.issue({
            label: clean(label, 120) || [row.applicant_name, machine.host].filter(Boolean).join('-'),
            machineCode: machine.machineCode,
            ...validity
        });
    const now = Date.now();
    await run(`UPDATE desktop_license_requests SET status = 'approved', license_id = ?, token = ?, expires_at = ?, decided_by = ?, updated_at = ?, decided_at = ? WHERE request_id = ? AND status = 'pending'`,
        [result.record.licenseId, result.token, result.record.expiresAt, clean(decidedBy, 60), now, now, row.request_id]);
    return { request: toAdminRecord(await get('SELECT * FROM desktop_license_requests WHERE request_id = ?', [row.request_id])), renewed: Boolean(existing), record: result.record };
}

async function rejectRequest(requestId, { reason, decidedBy } = {}) {
    const row = await getPendingRow(requestId);
    const now = Date.now();
    await run(`UPDATE desktop_license_requests SET status = 'rejected', reject_reason = ?, decided_by = ?, updated_at = ?, decided_at = ? WHERE request_id = ?`,
        [clean(reason, 200), clean(decidedBy, 60), now, now, row.request_id]);
    return toAdminRecord(await get('SELECT * FROM desktop_license_requests WHERE request_id = ?', [row.request_id]));
}

module.exports = { DEFAULT_DAYS, approveRequest, cancelRequest, getClientStatus, listRequests, rejectRequest, submitRequest };
