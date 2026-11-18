const { setTimeout: delay } = require('node:timers/promises');
const { getTenantId } = require('./tenant-context');
const repo = require('./gallery-repository');
const { recognizePending } = require('./gallery-service');

const jobs = new Map();
const spacingMs = 1000;
let batchLane = Promise.resolve();
let nextRequestAt = 0;
let providerRetryAt = 0;

function recognizeInTurn(id, client) {
    // Each tenant queues one version at a time. The gallery's existing AI limit
    // still applies to both this lane and interactive recognition.
    const request = batchLane.then(async () => {
        if (providerRetryAt > Date.now()) throw Object.assign(repo.fail('AI 服务限流，请稍后重试', 429), { retryAt: providerRetryAt });
        const remaining = nextRequestAt - Date.now();
        if (remaining > 0) await delay(remaining);
        try {
            return await recognizePending(id, client);
        } catch (error) {
            if (error.retryAt) providerRetryAt = error.retryAt;
            throw error;
        } finally {
            nextRequestAt = Date.now() + spacingMs;
        }
    });
    batchLane = request.then(() => {}, () => {});
    return request;
}

async function run(job) {
    const ids = await repo.pendingVersionIds();
    job.total = ids.length;
    if (!ids.length) return;
    const settings = await require('./ai-settings-repository').getRuntimeSettings();
    if (!settings.hasApiKey || !settings.keyLooksValid) {
        job.reason = 'unavailable';
        return;
    }
    const client = require('./ai-provider-client').createClient({ ...settings, autoSwitchEnabled: false });
    for (const id of ids) {
        try {
            let result;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    result = await recognizeInTurn(id, client);
                    break;
                } catch (error) {
                    if (error.status !== 429 || error.retryAt || attempt === 2) throw error;
                }
            }
            if (result.skipped) job.skipped++;
            else job.succeeded++;
        } catch (error) {
            if (error.status === 404 || error.status === 409) job.skipped++;
            else if (error.status === 429 || error.status === 503) {
                job.reason = error.retryAt ? 'rate-limited' : error.status === 429 ? 'busy' : 'unavailable';
                if (error.retryAt) job.retryAt = error.retryAt;
                return;
            } else job.failed++;
        }
    }
}

function status() {
    return jobs.get(getTenantId()) || null;
}

function start(confirmed) {
    if (!confirmed) throw repo.fail('请确认图片中不含密码、密钥等敏感信息，再发送给 AI');
    const tenant = getTenantId();
    const existing = jobs.get(tenant);
    if (existing?.running) return existing;
    if (existing?.retryAt > Date.now()) return existing;
    const job = { running: true, total: 0, succeeded: 0, failed: 0, skipped: 0, reason: '' };
    jobs.set(tenant, job);
    void run(job).catch(() => { job.reason = 'unavailable'; }).finally(() => {
        job.running = false;
        setTimeout(() => {
            if (jobs.get(tenant) === job) jobs.delete(tenant);
        }, Math.min(2147483647, Math.max(3600000, (job.retryAt || 0) - Date.now()))).unref();
    });
    return job;
}

module.exports = { start, status };
