// 平台自检（服务状态面板的「平台自检」页，仅管理员）：对应基座 Web 版的调试面板，按主线版自己的运行环境取舍——
// 没有基座、Redis 这些概念，检查的是本机数据库、模型配置、磁盘、进程和出站网络。每一项独立执行，失败不影响其他项。
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
const { get, run, getDbPath } = require('./app-db');
const { readKV, writeKV, deleteKV } = require('./kv-store');
const { getDataDir } = require('./tenant-context');

const PROBE_TIMEOUT_MS = 6000;

async function step(id, label, fn) {
    const startedAt = Date.now();
    try {
        const result = await fn();
        return { id, label, ok: result.ok !== false, durationMs: Date.now() - startedAt, summary: result.summary || '', detail: result.detail || null };
    } catch (error) {
        return { id, label, ok: false, durationMs: Date.now() - startedAt, summary: String(error.message || error).slice(0, 300) };
    }
}

const gb = bytes => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
const mb = bytes => `${Math.round(bytes / 1024 / 1024)} MB`;

async function runDiagnostics() {
    const checks = [];
    checks.push(await step('database', '应用数据库', async () => {
        const row = await get('PRAGMA quick_check');
        const result = String(Object.values(row || {})[0] || '');
        return { ok: result === 'ok', summary: result === 'ok' ? `完整性检查通过（${require('path').basename(getDbPath())}）` : `完整性检查发现问题：${result.slice(0, 200)}` };
    }));
    checks.push(await step('database-write', '数据库读写', async () => {
        const key = `diag_${crypto.randomBytes(4).toString('hex')}`;
        const value = { at: Date.now() };
        await writeKV('sys', key, value);
        const back = await readKV('sys', key, null);
        await deleteKV('sys', key).catch(() => {});
        return { ok: back?.at === value.at, summary: back?.at === value.at ? '写入后能读回' : '写入后读回的内容不一致' };
    }));
    checks.push(await step('models', '模型配置', async () => {
        const settings = await require('./ai-settings-repository').getRuntimeSettings();
        const breakers = require('./ai-provider-client').modelBreakerStatus();
        const fallbacks = Array.isArray(settings.fallbackProfiles) ? settings.fallbackProfiles.length : 0;
        const skipped = breakers.filter(item => item.open).map(item => item.key);
        if (!settings.hasApiKey) return { ok: false, summary: '当前模型没有配置密钥' };
        return {
            ok: !skipped.length,
            summary: `当前 ${settings.provider}/${settings.model}；自动切换${settings.autoSwitchEnabled ? `已开启（备用 ${fallbacks} 个）` : '未开启'}${skipped.length ? `；熔断中：${skipped.join('、')}` : ''}`,
            detail: { breakers }
        };
    }));
    checks.push(await step('disk', '数据目录磁盘', async () => {
        const dir = getDataDir();
        if (typeof fs.promises.statfs !== 'function') return { summary: `数据目录：${dir}` };
        const stat = await fs.promises.statfs(dir);
        const free = stat.bavail * stat.bsize;
        const total = stat.blocks * stat.bsize;
        return { ok: free > 1024 * 1024 * 1024, summary: `剩余 ${gb(free)} / 共 ${gb(total)}${free <= 1024 * 1024 * 1024 ? '（不足 1 GB，请清理）' : ''}` };
    }));
    checks.push(await step('process', '服务进程', async () => {
        const memory = process.memoryUsage();
        return { summary: `已运行 ${Math.round(process.uptime() / 60)} 分钟；内存 ${mb(memory.rss)}（堆 ${mb(memory.heapUsed)}）；Node ${process.version} · ${process.platform}` };
    }));
    return { at: new Date().toISOString(), ok: checks.every(item => item.ok), checks };
}

/** 出站探针：从平台服务器访问一个地址，看 DNS、连接和状态码（排查模型网关、内网站点连不上时用） */
async function probeUrl(rawUrl) {
    let url;
    try { url = new URL(String(rawUrl || '').trim()); } catch (_) { throw Object.assign(new Error('地址无效'), { status: 400 }); }
    if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('只支持 HTTP / HTTPS 地址'), { status: 400 });
    if (url.username || url.password) throw Object.assign(new Error('地址里不能带账号密码'), { status: 400 });
    const startedAt = Date.now();
    const result = { url: `${url.origin}${url.pathname}`, addresses: [], status: null, ok: false, durationMs: 0, message: '' };
    try {
        result.addresses = (await dns.lookup(url.hostname, { all: true })).map(item => item.address).slice(0, 4);
    } catch (error) {
        return { ...result, durationMs: Date.now() - startedAt, message: `域名解析失败：${error.code || error.message}` };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Dragon-Claw-Diagnostics/1.0' } });
        await response.body?.cancel().catch(() => {});
        return { ...result, status: response.status, ok: response.status < 500, durationMs: Date.now() - startedAt, message: `HTTP ${response.status}` };
    } catch (error) {
        const reason = error.name === 'AbortError' ? `连接超时（${PROBE_TIMEOUT_MS / 1000} 秒）` : String(error.cause?.code || error.message || error);
        return { ...result, durationMs: Date.now() - startedAt, message: reason.slice(0, 200) };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { runDiagnostics, probeUrl };
