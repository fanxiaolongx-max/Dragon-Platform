'use strict';
// Copy already collected quota samples to the Kindle; never query providers here.
const { spawn, execFile } = require('child_process');
const sqlite3 = require('sqlite3');
const { getDbPath } = require('../models/app-db');
const { normalizeTenantId } = require('../models/tenant-context');

const PROVIDERS = ['codex', 'claudecode', 'antigravity'];
const MAX_AGE = 15 * 60 * 1000;
const FALLBACK_AGE = 5 * 60 * 1000;
const FALLBACK_INTERVAL = 10 * 60 * 1000;

function createFallbackCollector({ collect, now = Date.now }) {
    let lastAttempt = 0;
    return async (rows, tenant, owner) => {
        const time = now();
        if (rows.some(row => row.sampled_at <= time + 60000 && time - row.sampled_at < FALLBACK_AGE) ||
            (lastAttempt && time - lastAttempt < FALLBACK_INTERVAL)) return false;
        lastAttempt = time;
        await collect(tenant, owner);
        return true;
    };
}

const collectFallback = createFallbackCollector({ collect: (tenant, owner) => {
    const { runWithTenant } = require('../models/tenant-context');
    return runWithTenant(tenant, () => require('../models/desktop-agents/quota').read(owner));
} });

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

function pm2Payload(processes, now = Date.now()) {
    if (!Array.isArray(processes)) throw new Error('Invalid PM2 process list');
    const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    return { timestamp: now, processes: processes.map(p => ({
        name: String(p.name || '').slice(0, 100), id: number(p.pm_id), pid: number(p.pid),
        status: String(p.pm2_env?.status || 'unknown').slice(0, 40),
        startedAt: number(p.pm2_env?.pm_uptime), restarts: number(p.pm2_env?.restart_time),
        cpuPercent: number(p.monit?.cpu), memoryBytes: number(p.monit?.memory)
    })) };
}

function readPm2() {
    return new Promise((resolve, reject) => {
        execFile(process.env.KINDLE_PM2_COMMAND || 'pm2', ['jlist'], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
            if (error) return reject(new Error('Could not read PM2 process list'));
            try { resolve(pm2Payload(JSON.parse(stdout))); }
            catch (_) { reject(new Error('Invalid PM2 process list')); }
        });
    });
}

function readDebianPm2() {
    return new Promise(resolve => {
        const command = "if ! command -v pm2 >/dev/null 2>&1; then exit 127; fi; if ! ps -eo comm | grep -q '^PM2'; then exit 3; fi; pm2 jlist";
        execFile('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'NewAPI', command], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
            if (error) return resolve({ timestamp: Date.now(), host: 'NewAPI', status: 'unavailable', reason: error.code === 127 ? 'pm2_not_found' : error.code === 3 ? 'pm2_not_running' : 'ssh_or_pm2_failed', processes: [] });
            try { resolve({ ...pm2Payload(JSON.parse(stdout)), host: 'NewAPI', status: 'ok' }); }
            catch (_) { resolve({ timestamp: Date.now(), host: 'NewAPI', status: 'unavailable', reason: 'invalid_pm2_output', processes: [] }); }
        });
    });
}

function send(payload, file) {
    return new Promise((resolve, reject) => {
        if (!['agent-quotas.json', 'pm2-status.json', 'debian-pm2-status.json'].includes(file)) return reject(new Error('Invalid sync destination'));
        const target = `/mnt/us/extensions/dragonapi-dashboard/${file}`;
        const child = spawn('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'kindle', `umask 077; cat > ${target}.tmp && mv ${target}.tmp ${target}`], { stdio: ['pipe', 'ignore', 'ignore'] });
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
    const results = await Promise.allSettled([
        (async () => {
            let rows = await readSamples(getDbPath(tenant), owner);
            try {
                if (await collectFallback(rows, tenant, owner)) rows = await readSamples(getDbPath(tenant), owner);
            } catch (error) { console.error('Kindle quota fallback:', error.message); }
            const payload = buildPayload(rows);
            await send(payload, 'agent-quotas.json');
            console.log(`Kindle quota sync completed; ${Object.values(payload.quotas).filter(q => q.status === 'cached').length} providers have recent samples`);
        })(),
        (async () => {
            const payload = await readPm2();
            await send(payload, 'pm2-status.json');
            console.log(`Kindle PM2 sync completed; ${payload.processes.length} processes`);
        })(),
        (async () => {
            const payload = await readDebianPm2();
            await send(payload, 'debian-pm2-status.json');
            console.log(`Kindle Debian PM2 sync completed; ${payload.status === 'ok' ? `${payload.processes.length} processes` : payload.reason}`);
        })()
    ]);
    for (const result of results) if (result.status === 'rejected') console.error('Kindle sync:', result.reason.message);
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
module.exports = { buildPayload, readSamples, pm2Payload, createFallbackCollector };
