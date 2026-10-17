const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./store');

const REGISTRY_FILE = process.env.DESKTOP_LICENSE_REGISTRY_FILE
    || path.join(DATA_DIR, 'desktop-license-registry.json');
const VERSION = 1;
const PRODUCT_ID = 'tools-platform-desktop';
const VALID_STATUSES = new Set(['active', 'revoked', 'archived']);

function emptyState() {
    return { version: VERSION, licenses: [] };
}

function readState() {
    if (!fs.existsSync(REGISTRY_FILE)) return emptyState();
    try {
        const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
        return parsed && parsed.version === VERSION && Array.isArray(parsed.licenses)
            ? parsed
            : emptyState();
    } catch (error) {
        throw new Error(`EXE License 台账读取失败：${error.message}`);
    }
}

function writeState(state) {
    fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
    const temp = `${REGISTRY_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, REGISTRY_FILE);
    try { fs.chmodSync(REGISTRY_FILE, 0o600); } catch (_) {}
}

function normalizeLabel(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function getRecord(licenseId) {
    return readState().licenses.find(item => item.licenseId === String(licenseId || '')) || null;
}

function listRecords({ includeArchived = true } = {}) {
    return readState().licenses.filter(item => includeArchived || item.status !== 'archived');
}

function createRecord({ licenseId, label, token, notBefore, expiresAt, machine = null }) {
    const state = readState();
    if (state.licenses.some(item => item.licenseId === licenseId)) throw new Error('License ID 已存在');
    const now = new Date().toISOString();
    const record = {
        licenseId,
        productId: PRODUCT_ID,
        label: normalizeLabel(label),
        token: String(token || ''),
        tokenDigest: crypto.createHash('sha256').update(String(token || '')).digest('base64url'),
        status: 'active',
        machine: machine ? { ...machine, boundAt: now } : null,
        notBefore: Number(notBefore),
        expiresAt: Number(expiresAt),
        issuedAt: now,
        updatedAt: now,
        revokedAt: null,
        revokeReason: '',
        archivedAt: null,
        renewalHistory: [],
        previousTokens: [],
        bindingHistory: []
    };
    state.licenses.unshift(record);
    writeState(state);
    return record;
}

function updateRecord(licenseId, updater) {
    const state = readState();
    const index = state.licenses.findIndex(item => item.licenseId === String(licenseId || ''));
    if (index < 0) throw new Error('未找到 License 记录');
    const current = state.licenses[index];
    const next = updater({
        ...current,
        renewalHistory: [...(current.renewalHistory || [])],
        previousTokens: [...(current.previousTokens || [])]
    });
    if (!next || next.licenseId !== current.licenseId) throw new Error('License 更新结果无效');
    next.updatedAt = new Date().toISOString();
    state.licenses[index] = next;
    writeState(state);
    return next;
}

function setStatus(licenseId, status, reason = '') {
    if (!VALID_STATUSES.has(status)) throw new Error('License 状态无效');
    return updateRecord(licenseId, record => {
        record.status = status;
        if (status === 'revoked') {
            record.revokedAt = new Date().toISOString();
            record.revokeReason = String(reason || '').trim().slice(0, 240);
        } else if (status === 'archived') {
            record.archivedAt = new Date().toISOString();
        } else {
            record.revokedAt = null;
            record.revokeReason = '';
            record.archivedAt = null;
        }
        return record;
    });
}

function calculateRenewedExpiry(record, { days, expiresAt } = {}) {
    const previousExpiresAt = Number(record && record.expiresAt);
    let nextExpiresAt = Number(expiresAt);
    if (!Number.isFinite(nextExpiresAt)) {
        const safeDays = Math.max(1, Math.min(3650, Number.parseInt(days, 10) || 30));
        nextExpiresAt = Math.max(Date.now(), previousExpiresAt) + safeDays * 86400000;
    }
    if (!Number.isFinite(nextExpiresAt) || nextExpiresAt <= Date.now()) {
        throw new Error('新到期时间必须晚于当前时间');
    }
    return nextExpiresAt;
}

function replaceTokenForRenewal(licenseId, { token, notBefore, expiresAt, machine = null, rebind = false }) {
    return updateRecord(licenseId, record => {
        const previousExpiresAt = Number(record.expiresAt);
        if (rebind) {
            // 换绑设备：旧设备上的所有历史密钥立即作废（不再保留续期前密钥的宽限）
            record.bindingHistory = [...(record.bindingHistory || []), {
                reboundAt: new Date().toISOString(),
                previousMachine: record.machine || null,
                machine
            }];
            record.retiredTokens = [...(record.retiredTokens || []),
                ...(record.previousTokens || []).map(item => ({ ...item, retiredAt: new Date().toISOString(), reason: 'rebind' })),
                ...(record.tokenDigest ? [{ tokenDigest: record.tokenDigest, expiresAt: previousExpiresAt, retiredAt: new Date().toISOString(), reason: 'rebind' }] : [])];
            record.previousTokens = [];
            record.machine = machine ? { ...machine, boundAt: new Date().toISOString() } : null;
        } else if (record.tokenDigest) {
            record.previousTokens.push({
                tokenDigest: record.tokenDigest,
                notBefore: Number(record.notBefore),
                expiresAt: previousExpiresAt,
                replacedAt: new Date().toISOString()
            });
        }
        record.token = String(token || '');
        record.tokenDigest = crypto.createHash('sha256').update(record.token).digest('base64url');
        record.notBefore = Number(notBefore);
        record.expiresAt = Number(expiresAt);
        record.status = 'active';
        record.revokedAt = null;
        record.revokeReason = '';
        record.archivedAt = null;
        record.renewalHistory.push({
            renewedAt: new Date().toISOString(),
            previousExpiresAt,
            expiresAt: Number(expiresAt),
            replacementTokenIssued: true
        });
        return record;
    });
}

function checkPayload(payload, now = Date.now(), token = '', reportedMachineId = '') {
    if (!payload || payload.productId !== PRODUCT_ID || !payload.licenseId) {
        return { valid: false, reasonCode: 'PRODUCT_MISMATCH' };
    }
    const record = getRecord(payload.licenseId);
    if (!record) return { valid: false, reasonCode: 'LICENSE_NOT_FOUND' };
    // 设备绑定：台账、密钥载荷、客户端现场采集的指纹三者必须一致
    const boundMachineId = record.machine && record.machine.machineId;
    if (!boundMachineId) return { valid: false, reasonCode: 'LEGACY_LICENSE', record };
    if (payload.machineId !== boundMachineId || String(reportedMachineId || '') !== boundMachineId) {
        return { valid: false, reasonCode: 'MACHINE_MISMATCH', record };
    }
    const digest = crypto.createHash('sha256').update(String(token || '')).digest('base64url');
    const previousToken = (record.previousTokens || []).find(item => item.tokenDigest === digest) || null;
    if (record.productId !== payload.productId || (record.tokenDigest !== digest && !previousToken)) {
        return { valid: false, reasonCode: 'REGISTRY_MISMATCH', record };
    }
    if (record.status === 'revoked') return { valid: false, reasonCode: 'REVOKED', record };
    if (record.status === 'archived') return { valid: false, reasonCode: 'ARCHIVED', record };
    const tokenNotBefore = Number.isFinite(payload.notBefore)
        ? Number(payload.notBefore)
        : Number(previousToken ? previousToken.notBefore : record.notBefore);
    const tokenExpiresAt = Number.isFinite(payload.expiresAt)
        ? Number(payload.expiresAt)
        : Number(previousToken ? previousToken.expiresAt : record.expiresAt);
    if (Number(now) < tokenNotBefore) return { valid: false, reasonCode: 'NOT_YET_VALID', record, tokenExpiresAt };
    if (Number(now) >= tokenExpiresAt) return { valid: false, reasonCode: 'EXPIRED', record, tokenExpiresAt };
    return { valid: true, record, tokenExpiresAt };
}

module.exports = {
    PRODUCT_ID,
    REGISTRY_FILE,
    calculateRenewedExpiry,
    checkPayload,
    createRecord,
    getRecord,
    listRecords,
    normalizeLabel,
    replaceTokenForRenewal,
    setStatus
};
