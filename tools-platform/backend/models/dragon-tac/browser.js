// 用已安装的 Chromium 浏览器读取页面，不复制浏览器实现，不使用个人浏览器的 Cookie。
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns').promises;
const net = require('net');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { isPrivateIp } = require('../friend-links-service');
function executable(name, override) {
    const candidates = [override, ...String(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, name))].filter(Boolean);
    return candidates.find(file => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } }) || '';
}
function browserBinary() {
    return executable('google-chrome', process.env.TOOLS_DRAGON_TAC_BROWSER)
        || executable('chromium') || executable('chromium-browser')
        || executable('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        || executable('msedge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
}
function normalizeUrl(value) {
    let url; try { url = new URL(value); } catch { throw new Error('请提供完整的 http/https 网页地址'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含账号密码的 http/https 网页');
    if ([...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization|cookie|signature/i.test(key))) throw new Error('网址包含凭据参数，请提供不含凭据的公开网页地址');
    url.hash = '';
    return url.href;
}
async function assertPublic(value) {
    const normalized = normalizeUrl(value);
    const url = new URL(normalized);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || /\.(?:localhost|local|internal)$/.test(hostname)) throw new Error('首个示例仅支持公开网页，不访问本机或内网地址');
    const records = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
    if (!records.length || records.some(record => isPrivateIp(record.address))) throw new Error('首个示例仅支持公开网页，不访问本机或内网地址');
    return normalized;
}
async function readPage(value, { signal } = {}) {
    if (signal?.aborted) throw new Error('读取已取消');
    const url = await assertPublic(value);
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (addresses.some(item => isPrivateIp(item.address))) throw new Error('网页域名解析发生变化，请重试');
    const binary = browserBinary();
    if (!binary) throw new Error('未找到可用的 Chrome/Chromium 浏览器，请在运行平台的机器安装或配置 TOOLS_DRAGON_TAC_BROWSER');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-tac-browser-'));
    const child = spawn(binary, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', `--host-resolver-rules=MAP ${host} ${addresses[0].address}, MAP * ~NOTFOUND, EXCLUDE localhost`, '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let socket, deadline;
    try {
        const endpoint = await new Promise((resolve, reject) => {
            let stderr = '';
            const timer = setTimeout(() => reject(new Error('浏览器启动超时')), 15000);
            const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
            child.once('error', error => finish(error)); child.once('exit', () => finish(new Error('浏览器提前退出')));
            child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr); if (match) finish(null, match[1]); });
        });
        socket = new WebSocket(endpoint);
        await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
        let sequence = 0; const pending = new Map();
        const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
            const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
        socket.on('message', data => {
            let event; try { event = JSON.parse(String(data)); } catch { return; }
            if (event.id && pending.has(event.id)) { const p = pending.get(event.id); pending.delete(event.id); event.error ? p.reject(new Error(event.error.message)) : p.resolve(event.result); }
            if (event.method === 'Fetch.requestPaused') {
                const { requestId, request } = event.params;
                Promise.resolve().then(async () => { if (request.method !== 'GET') throw new Error('仅允许读取'); await assertPublic(request.url); return call('Fetch.continueRequest', { requestId }, event.sessionId); })
                    .catch(() => call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, event.sessionId).catch(() => {}));
            }
        });
        const aborted = () => { for (const p of pending.values()) p.reject(new Error('读取已取消')); pending.clear(); socket.close(); };
        signal?.addEventListener('abort', aborted, { once: true });
        try {
            const work = async () => {
                const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
                const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
                await call('Page.enable', {}, sessionId);
                await call('Fetch.enable', { patterns: [{ urlPattern: 'http*', requestStage: 'Request' }] }, sessionId);
                const loaded = new Promise(resolve => { const listener = data => { const e = JSON.parse(String(data)); if (e.sessionId === sessionId && e.method === 'Page.loadEventFired') { socket.off('message', listener); resolve(); } }; socket.on('message', listener); });
                const navigation = await call('Page.navigate', { url }, sessionId);
                if (navigation.errorText) throw new Error(`网页未打开：${navigation.errorText}`);
                await loaded;
                await new Promise(resolve => setTimeout(resolve, 1200));
                const data = await call('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText||"").slice(0,40000)})', returnByValue: true }, sessionId);
                const page = JSON.parse(data.result.value);
                await assertPublic(page.url);
                if (page.text.trim().length < 40) throw new Error('网页没有足够可读正文，可能需要登录或尚未加载');
                return { ...page, mode: 'chromium-rendered' };
            };
            return await Promise.race([work(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('网页读取超时，请稍后重试')), 45000); })]);
        } finally { signal?.removeEventListener('abort', aborted); }
    } finally {
        clearTimeout(deadline); socket?.terminate();
        child.kill('SIGTERM');
        await new Promise(resolve => { if (child.exitCode !== null) return resolve(); const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
        fs.rmSync(profile, { recursive: true, force: true });
    }
}
module.exports = { executable, browserBinary, normalizeUrl, assertPublic, readPage };
