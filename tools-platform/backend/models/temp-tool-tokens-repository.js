// 单个自定义工具的临时免密访问令牌（控制库 temp_tool_tokens）：
// - 仅限指定 slug 的 /custom-tools/<slug>/* 页面；
// - 可选授予 /api/terminal/* 权限，且终端会话严格隔离到独立 ownerKey，不碰超管自有终端；
// - 数据库只存 SHA-256 哈希，不存明文令牌；支持到期自动失效与超管一键吊销（联动清理活跃终端）。
const crypto = require('crypto');
const { run, get, all } = require('./control-db');
const { DEFAULT_TENANT_ID } = require('./tenant-context');

const COOKIE_NAME = 'dc_tool_temp_token';
const MIN_TTL_HOURS = 0.5;
const MAX_TTL_HOURS = 168; // 7 days hard cap
const DEFAULT_TTL_HOURS = 24;

let initPromise = null;

async function ensureReady() {
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS temp_tool_tokens (
                    id TEXT PRIMARY KEY,
                    slug TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    token_prefix TEXT NOT NULL,
                    label TEXT NOT NULL DEFAULT '',
                    allow_terminal INTEGER NOT NULL DEFAULT 1,
                    created_by TEXT NOT NULL,
                    source_tenant TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
                    expires_at INTEGER NOT NULL,
                    revoked_at INTEGER DEFAULT NULL,
                    last_used_at INTEGER DEFAULT NULL,
                    use_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                )
            `);
            await run(`CREATE INDEX IF NOT EXISTS idx_temp_tool_tokens_slug ON temp_tool_tokens(slug)`);
        })().catch(err => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}

function hashToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function normalizeSlug(slug) {
    const clean = String(slug || '').trim();
    if (!/^[\w-]{1,100}$/.test(clean)) return '';
    return clean;
}

function clampTtlHours(raw) {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return DEFAULT_TTL_HOURS;
    return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, num));
}

function ownerKeyForToken(record) {
    return `temp-tool:${record.slug}:${record.id}`;
}

function formatRecord(row, now = Date.now()) {
    if (!row) return null;
    const revoked = row.revoked_at !== null && row.revoked_at !== undefined;
    const expired = Number(row.expires_at) <= now;
    return {
        id: row.id,
        slug: row.slug,
        tokenPrefix: row.token_prefix,
        label: row.label || '',
        allowTerminal: Number(row.allow_terminal) === 1,
        createdBy: row.created_by,
        sourceTenant: row.source_tenant || DEFAULT_TENANT_ID,
        expiresAt: Number(row.expires_at),
        revokedAt: revoked ? Number(row.revoked_at) : null,
        lastUsedAt: row.last_used_at ? Number(row.last_used_at) : null,
        useCount: Number(row.use_count || 0),
        createdAt: Number(row.created_at),
        active: !revoked && !expired,
        expired,
        revoked
    };
}

function extractTempTokenFromCookie(cookieHeader) {
    const raw = String(cookieHeader || '');
    if (!raw) return '';
    for (const part of raw.split(';')) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const k = part.slice(0, idx).trim();
        if (k === COOKIE_NAME) {
            return part.slice(idx + 1).trim();
        }
    }
    return '';
}

async function createToken({ slug, label = '', ttlHours = DEFAULT_TTL_HOURS, allowTerminal = true, createdBy = 'admin', sourceTenant = DEFAULT_TENANT_ID } = {}) {
    await ensureReady();
    const cleanSlug = normalizeSlug(slug);
    if (!cleanSlug) throw Object.assign(new Error('无效的工具标识'), { status: 400 });
    const hours = clampTtlHours(ttlHours);
    const now = Date.now();
    const expiresAt = now + Math.round(hours * 3600 * 1000);
    const id = crypto.randomUUID();
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const tokenPrefix = rawToken.slice(0, 8);
    const cleanLabel = String(label || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
    const allowTermInt = allowTerminal ? 1 : 0;

    await run(
        `INSERT INTO temp_tool_tokens
            (id, slug, token_hash, token_prefix, label, allow_terminal, created_by, source_tenant, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, cleanSlug, tokenHash, tokenPrefix, cleanLabel, allowTermInt, String(createdBy || 'admin'), String(sourceTenant || DEFAULT_TENANT_ID), expiresAt, now]
    );
    const row = await get(`SELECT * FROM temp_tool_tokens WHERE id = ?`, [id]);
    return { record: formatRecord(row, now), rawToken };
}

async function verifyToken(rawToken, { expectedSlug = null, requireTerminal = false, touch = true } = {}) {
    const token = String(rawToken || '').trim();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
    await ensureReady();
    const row = await get(`SELECT * FROM temp_tool_tokens WHERE token_hash = ?`, [hashToken(token)]);
    if (!row) return null;
    const now = Date.now();
    if (row.revoked_at !== null && row.revoked_at !== undefined) return null;
    if (Number(row.expires_at) <= now) return null;
    if (expectedSlug && row.slug !== expectedSlug) return null;
    if (requireTerminal && Number(row.allow_terminal) !== 1) return null;
    if (touch) {
        run(`UPDATE temp_tool_tokens SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?`, [now, row.id]).catch(() => {});
    }
    return formatRecord(row, now);
}

async function listTokens(slug) {
    await ensureReady();
    const cleanSlug = normalizeSlug(slug);
    if (!cleanSlug) return [];
    const now = Date.now();
    const rows = await all(
        `SELECT * FROM temp_tool_tokens WHERE slug = ? ORDER BY created_at DESC LIMIT 50`,
        [cleanSlug]
    );
    return rows.map(row => formatRecord(row, now));
}

async function revokeToken(id, slug = null) {
    await ensureReady();
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    const row = slug
        ? await get(`SELECT * FROM temp_tool_tokens WHERE id = ? AND slug = ?`, [cleanId, normalizeSlug(slug)])
        : await get(`SELECT * FROM temp_tool_tokens WHERE id = ?`, [cleanId]);
    if (!row) return null;
    const now = Date.now();
    if (row.revoked_at === null || row.revoked_at === undefined) {
        await run(`UPDATE temp_tool_tokens SET revoked_at = ? WHERE id = ?`, [now, cleanId]);
        row.revoked_at = now;
    }
    return formatRecord(row, now);
}

module.exports = {
    COOKIE_NAME,
    DEFAULT_TTL_HOURS,
    MAX_TTL_HOURS,
    MIN_TTL_HOURS,
    createToken,
    ensureReady,
    extractTempTokenFromCookie,
    listTokens,
    ownerKeyForToken,
    revokeToken,
    verifyToken
};
