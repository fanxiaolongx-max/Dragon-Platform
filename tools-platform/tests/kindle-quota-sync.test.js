'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('../backend/node_modules/sqlite3');
const { buildPayload, readSamples, pm2Payload } = require('../backend/scripts/kindle-quota-sync');

test('PM2 export includes status metrics only and omits environment, paths and arguments', () => {
    const data = pm2Payload([{name:'app',pm_id:2,pid:123,pm2_env:{status:'online',pm_uptime:1000,restart_time:3,secret:'do-not-export',pm_exec_path:'/private'},monit:{cpu:2.5,memory:4096},args:['secret']}], 2000);
    assert.deepEqual(data, {timestamp:2000,processes:[{name:'app',id:2,pid:123,status:'online',startedAt:1000,restarts:3,cpuPercent:2.5,memoryBytes:4096}]});
    assert.doesNotMatch(JSON.stringify(data), /secret|private/);
    assert.throws(() => pm2Payload({}), /Invalid PM2/);
});

test('uses only the latest fresh provider sample and invalidates expired windows', () => {
    const now = Date.now();
    const row = { provider:'claudecode', device:'one', group_id:'main', group_label:'Main', window_id:'5h', remaining:80, resets_at:'', sampled_at:now - 1000, credits_balance:0, extra_enabled:1, extra_used:24.88, extra_limit:120, extra_currency:'USD' };
    const payload = buildPayload([row, {...row, sampled_at:now - 2000, remaining:5}, {...row, provider:'codex', sampled_at:now - 16*60000}], now);
    assert.equal(payload.quotas.claudecode.groups[0].windows[0].remainingPercent, 80);
    assert.equal(payload.quotas.codex.status, 'unavailable');
    assert.equal(payload.timestamp, row.sampled_at);
    assert.equal(payload.quotas.claudecode.creditsBalance, 0);
    assert.deepEqual(payload.quotas.claudecode.extraUsage, {enabled:true, used:24.88, limit:120, currency:'USD'});
    assert.equal(buildPayload([{...row, extra_enabled:null}], now).quotas.claudecode.extraUsage, null);
    assert.equal(buildPayload([{...row, resets_at:new Date(now - 1).toISOString()}], now).quotas.claudecode.groups[0].windows[0].remainingPercent, null);
});

test('reads only the configured owner from SQLite', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-quota-'));
    const file = path.join(dir, 'test.db');
    const db = new sqlite3.Database(file);
    const now = Date.now();
    await new Promise((resolve, reject) => db.exec(`CREATE TABLE desktop_pet_quota_samples (owner TEXT, device TEXT, provider TEXT, group_id TEXT, group_label TEXT, window_id TEXT, sampled_at INTEGER, remaining REAL, resets_at TEXT);
        CREATE TABLE desktop_pet_quota_details (owner TEXT, device TEXT, provider TEXT, sampled_at INTEGER, credits_balance REAL, extra_enabled INTEGER, extra_used REAL, extra_limit REAL, extra_currency TEXT);
        INSERT INTO desktop_pet_quota_samples VALUES ('alice','one','codex','main','Main','5h',${now},80,'');
        INSERT INTO desktop_pet_quota_samples VALUES ('bob','one','codex','main','Main','5h',${now},10,'');
        INSERT INTO desktop_pet_quota_details VALUES ('alice','one','codex',${now},100,1,20,50,'USD');
        INSERT INTO desktop_pet_quota_details VALUES ('bob','one','codex',${now},999,1,99,99,'USD');`, e => e ? reject(e) : resolve()));
    await new Promise(resolve => db.close(resolve));
    try { const rows = await readSamples(file, 'alice'); assert.equal(rows.length, 1); assert.equal(rows[0].remaining, 80); assert.equal(rows[0].credits_balance,100); }
    finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
