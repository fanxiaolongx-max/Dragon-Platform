'use strict';
// Copy already collected quota samples to the Kindle; never query providers here.
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');
const { getDbPath } = require('../models/app-db');
const { normalizeTenantId } = require('../models/tenant-context');

const PROVIDERS = ['codex', 'claudecode', 'antigravity'];
const MAX_AGE = 15 * 60 * 1000;

function buildPayload(rows, now = Date.now()) {
    const quotas = {};
    const times = [];
    for (const provider of PROVIDERS) {
        const matches = rows.filter(row => row.provider === provider && row.sampled_at <= now + 60000);
        const latest = matches.length ? Math.max(...matches.map(row => row.sampled_at)) : 0;
        const latestRow = matches.find(row => row.sampled_at === latest);
        const current = matches.filter(row => row.sampled_at === latest && row.device === latestRow.device);
        const groups = new Map();
        for (const row of current) {
            if (!groups.has(row.group_id)) groups.set(row.group_id, { id: row.group_id, label: row.group_label, windows: [] });
            const resetAt = row.resets_at ? Date.parse(row.resets_at) : NaN;
            groups.get(row.group_id).windows.push({ id: row.window_id, remainingPercent: Number.isFinite(resetAt) && resetAt <= now ? null : row.remaining, resetsAt: row.resets_at || null });
        }
        const fresh = latest && now - latest <= MAX_AGE;
        const extraUsage = fresh && latestRow.extra_enabled !== null && latestRow.extra_enabled !== undefined ? {
            enabled: latestRow.extra_enabled === 1, used: latestRow.extra_used, limit: latestRow.extra_limit,
            currency: latestRow.extra_currency || 'USD'
        } : null;
        quotas[provider] = { status: fresh ? 'cached' : 'unavailable', groups: fresh ? [...groups.values()] : [],
            creditsBalance: fresh ? (latestRow.credits_balance ?? null) : null, extraUsage };
        if (fresh) times.push(latest);
    }
    return { timestamp: times.length ? Math.min(...times) : null, quotas };
}

function readSamples(filename, owner) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(filename, sqlite3.OPEN_READONLY, error => {
            if (error) return reject(error);
            db.get("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='desktop_pet_quota_details'", (schemaError, table) => {
                if (schemaError) { db.close(); return reject(schemaError); }
                const details = table ? `d.credits_balance, d.extra_enabled, d.extra_used, d.extra_limit, d.extra_currency` :
                    'NULL AS credits_balance, NULL AS extra_enabled, NULL AS extra_used, NULL AS extra_limit, NULL AS extra_currency';
                const join = table ? `LEFT JOIN desktop_pet_quota_details d ON d.owner=s.owner AND d.device=s.device AND d.provider=s.provider AND d.sampled_at=s.sampled_at` : '';
                db.all(`SELECT s.provider, s.device, s.group_id, s.group_label, s.window_id, s.sampled_at, s.remaining, s.resets_at, ${details}
                    FROM desktop_pet_quota_samples s ${join}
                    WHERE s.owner=? AND s.provider IN ('codex','claudecode','antigravity')
                    AND s.sampled_at >= ? ORDER BY s.sampled_at DESC`, [owner, Date.now() - MAX_AGE], (err, rows) => {
                    db.close();
                    if (err) reject(err); else resolve(rows);
                });
            });
        });
    });
}

function send(payload) {
    return new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'kindle', 'umask 077; cat > /mnt/us/extensions/dragonapi-dashboard/agent-quotas.json.tmp && mv /mnt/us/extensions/dragonapi-dashboard/agent-quotas.json.tmp /mnt/us/extensions/dragonapi-dashboard/agent-quotas.json'], { stdio: ['pipe', 'ignore', 'ignore'] });
        const timer = setTimeout(() => child.kill(), 20000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Kindle synchronization failed')); });
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify(payload));
    });
}

async function sync() {
    const tenant = process.env.KINDLE_QUOTA_TENANT || 'default';
    const owner = process.env.KINDLE_QUOTA_OWNER;
    if (!owner || tenant !== normalizeTenantId(tenant)) throw new Error('Set a valid KINDLE_QUOTA_OWNER and KINDLE_QUOTA_TENANT');
    const payload = buildPayload(await readSamples(getDbPath(tenant), owner));
    await send(payload);
    console.log(`Kindle quota sync completed; ${Object.values(payload.quotas).filter(q => q.status === 'cached').length} providers have recent samples`);
}

if (require.main === module) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try { await sync(); } catch (error) { console.error('Kindle quota sync:', error.message); }
        finally { running = false; }
    };
    tick();
    setInterval(tick, 180000);
}
module.exports = { buildPayload, readSamples };
