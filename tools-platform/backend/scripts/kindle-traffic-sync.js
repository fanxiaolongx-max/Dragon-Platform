'use strict';
const { spawn } = require('child_process');
const INTERVAL = 180000;

function run(command, args, input, timeout = 25000) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
        const chunks = []; let size = 0;
        const timer = setTimeout(() => child.kill(), timeout);
        child.stdout.on('data', chunk => { size += chunk.length; if (size <= 16 * 1024 * 1024) chunks.push(chunk); else child.kill(); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error('Command failed')); });
        child.stdin.on('error', () => {}); child.stdin.end(input);
    });
}
function sample(processes, history, now = Date.now()) {
    if (!Array.isArray(processes)) throw new Error('Invalid PM2 process list');
    const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    const services = processes.map(p => {
        const metrics = p.pm2_env?.axm_monitor || {};
        const online = p.pm2_env?.status === 'online';
        const rate = online && metrics.HTTP?.unit === 'req/min' ? number(metrics.HTTP.value) : null;
        const latency = name => online && metrics[name]?.unit === 'ms' ? number(metrics[name].value) : null;
        const id = number(p.pm_id), key = `${id}:${p.name}`;
        const previous = history.get(key) || [];
        const baseline = previous.length >= 5 ? previous.reduce((a, b) => a + b, 0) / previous.length : null;
        const anomaly = rate === null || baseline === null ? null : rate >= 10 && rate >= Math.max(3 * baseline, baseline + 10);
        if (rate !== null) history.set(key, [...previous, rate].slice(-10));
        else history.delete(key);
        return { name: String(p.name || '').slice(0, 100), id, status: String(p.pm2_env?.status || 'unknown').slice(0, 40),
            pid: number(p.pid), cpuPercent: online ? number(p.monit?.cpu) : null, memoryBytes: online ? number(p.monit?.memory) : null,
            restarts: number(p.pm2_env?.restart_time), startedAt: number(p.pm2_env?.pm_uptime),
            requestsPerMinute: rate, latencyP95Ms: latency('HTTP P95 Latency'), latencyP50Ms: latency('HTTP Mean Latency'),
            baselineRequestsPerMinute: rate === null || baseline === null ? null : Math.round(baseline * 100) / 100, anomaly };
    });
    return { timestamp: now, host: 'Mac', intervalSeconds: INTERVAL / 1000, services };
}
async function sync(history) {
    const output = await run(process.env.KINDLE_PM2_COMMAND || 'pm2', ['jlist']);
    const payload = sample(JSON.parse(output), history);
    await run('/usr/bin/ssh', ['-o','BatchMode=yes','-o','ConnectTimeout=8','kindle','umask 077; cat > /mnt/us/extensions/dragonapi-dashboard/traffic-status.json.tmp && mv /mnt/us/extensions/dragonapi-dashboard/traffic-status.json.tmp /mnt/us/extensions/dragonapi-dashboard/traffic-status.json'], JSON.stringify(payload));
    console.log(`Mac PM2 metrics synchronized; ${payload.services.length} processes`);
}
if (require.main === module) {
    const history = new Map(); let busy = false;
    const tick = async () => { if (busy) return; busy = true; try { await sync(history); } catch (e) { console.error('Traffic sync:', e.message); } finally { busy = false; } };
    tick(); setInterval(tick, INTERVAL);
}
module.exports = { sample };
