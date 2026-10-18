'use strict';
const db = require('./app-db');
const ready = new WeakMap();
const DAY = 86400000;
const PROVIDERS = ['codex', 'claudecode', 'antigravity'];
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value);

async function ensureReady() {
    const connection = db.getDatabase();
    if (!ready.has(connection)) ready.set(connection, (async () => {
        await db.run(`CREATE TABLE IF NOT EXISTS desktop_pet_quota_samples (
            owner TEXT NOT NULL, device TEXT NOT NULL, provider TEXT NOT NULL,
            group_id TEXT NOT NULL, group_label TEXT NOT NULL, window_id TEXT NOT NULL,
            window_label TEXT NOT NULL, sampled_at INTEGER NOT NULL,
            remaining REAL NOT NULL, resets_at TEXT NOT NULL DEFAULT '',
            duration_minutes INTEGER,
            PRIMARY KEY (owner,device,provider,group_id,window_id,sampled_at)
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS pet_quota_history_time
            ON desktop_pet_quota_samples(owner,device,provider,sampled_at)`);
    })().catch(error => { ready.delete(connection); throw error; }));
    return ready.get(connection);
}

function scope(owner, device) {
    if (owner == null || !identifier(device)) throw new Error('INVALID_QUOTA_SCOPE');
    return [String(owner), device];
}
function samples(quotas, now = Date.now()) {
    const result = [];
    for (const provider of PROVIDERS) {
        const data = quotas?.[provider];
        // A cached read is not a new measurement. Never invent points during outages.
        if (data?.status !== 'live' || !Number.isSafeInteger(data.updatedAt) ||
            data.updatedAt < now - 15 * 60000 || data.updatedAt > now + 60000) continue;
        for (const group of (Array.isArray(data.groups) ? data.groups : []).slice(0,20)) {
            if (!identifier(group.id)) continue;
            for (const w of (Array.isArray(group.windows) ? group.windows : []).slice(0,10)) {
                if (!identifier(w.id) || typeof w.remainingPercent !== 'number' || !Number.isFinite(w.remainingPercent) || w.remainingPercent < 0 || w.remainingPercent > 100) continue;
                const reset = w.resetsAt && Number.isFinite(Date.parse(w.resetsAt)) ? new Date(w.resetsAt).toISOString() : '';
                result.push([provider, group.id, String(group.label || group.id).slice(0,80), w.id,
                    String(w.label || '').slice(0,80), data.updatedAt, w.remainingPercent, reset,
                    Number.isInteger(w.durationMinutes) && w.durationMinutes > 0 ? w.durationMinutes : null]);
            }
        }
    }
    return result;
}
async function record(owner, device, quotas, now = Date.now()) {
    const keys = scope(owner, device), rows = samples(quotas, now);
    await ensureReady();
    for (const row of rows) await db.run(`INSERT OR IGNORE INTO desktop_pet_quota_samples
        (owner,device,provider,group_id,group_label,window_id,window_label,sampled_at,remaining,resets_at,duration_minutes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [...keys, ...row]);
    // Retention is limited to this caller's installation, inside its current tenant.
    await db.run('DELETE FROM desktop_pet_quota_samples WHERE owner=? AND device=? AND sampled_at<?', [...keys, now - 90 * DAY]);
    return rows.length;
}
async function history(owner, device, provider, days = 1, now = Date.now()) {
    const keys = scope(owner, device);
    if (!PROVIDERS.includes(provider) || !Number.isFinite(days) || days < 1 || days > 90) throw new Error('INVALID_QUOTA_QUERY');
    await ensureReady();
    const from = now - days * DAY;
    const coverage = await db.get(`SELECT MIN(sampled_at) AS firstSampleAt, MAX(sampled_at) AS lastSampleAt
        FROM desktop_pet_quota_samples WHERE owner=? AND device=? AND provider=?`, [...keys, provider]);
    // Keep the last sample in each time bucket, separately for each reset period.
    // At most ~720 points per series; resets survive downsampling.
    const step = Math.max(60000, Math.ceil(days * DAY / 720));
    const rows = await db.all(`SELECT * FROM (
        SELECT group_id,group_label,window_id,window_label,sampled_at,remaining,resets_at,duration_minutes,
        ROW_NUMBER() OVER (PARTITION BY group_id,window_id,resets_at,CAST((sampled_at-?)/? AS INTEGER)
            ORDER BY sampled_at DESC) AS rank
        FROM desktop_pet_quota_samples
        WHERE owner=? AND device=? AND provider=? AND sampled_at>=? AND sampled_at<=?
    ) WHERE rank=1 ORDER BY sampled_at`, [from, step, ...keys, provider, from, now]);
    const groups = new Map();
    for (const row of rows) {
        const key = row.group_id + ':' + row.window_id;
        if (!groups.has(key)) groups.set(key, {groupId:row.group_id, groupLabel:row.group_label,
            windowId:row.window_id, windowLabel:row.window_label, durationMinutes:row.duration_minutes, points:[]});
        groups.get(key).points.push({at:row.sampled_at, remaining:row.remaining, resetsAt:row.resets_at || null});
    }
    return {provider, from, to:now, days, step, ...coverage, series:[...groups.values()]};
}
module.exports = {ensureReady, record, history, samples, identifier};
