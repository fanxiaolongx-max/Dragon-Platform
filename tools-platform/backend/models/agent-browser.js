// Dragon Claw 浏览器工具：智能体打开网页、读页面、点击输入、抓网络请求与控制台。
// 全部经 Chrome DevTools 协议（CDP）控制，两种后端，对外是同一组工具：
// - 桌面端（Electron）：用 Dragon 浏览器的标签页（webContents.debugger），页面显示在用户眼前，沿用已登录的站点；
//   electron-main 启动时用 configureDesktopBrowser() 注册控制器。
// - 服务端（PM2 等）：在本机启动独立配置目录的 Chrome / Edge（无头），按 租户/账号 各用一个配置目录和进程，互不共享 Cookie；
//   闲置 15 分钟自动关闭。只用项目已有的 ws 依赖，不开放调试端口给外部（只监听 127.0.0.1）。
// 只读工具（读页面、网络、控制台、截图）直接执行；打开网址、点击、输入、执行脚本按类别走审批。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const SECRET_HEADER_RE = /^(cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token|x-api-key|x-auth-token)$/i;
const LIMITS = { tabs: 6, network: 400, console: 200, snapshotChars: 40000, bodyChars: 2 * 1024 * 1024, navigateMs: 30000, idleMs: 15 * 60 * 1000 };

function browserError(code, message) {
    return Object.assign(new Error(message), { code });
}

function webUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch (_error) { return null; }
}

// ── 页面：CDP 命令与事件之上的一层（两种后端共用） ─────────
// 在页面里运行：给可交互元素编号（data-dragon-ref），输出标题、正文、链接、按钮、输入框
const SNAPSHOT_SCRIPT = function snapshot(maxChars) {
    const out = [];
    let size = 0;
    let ref = 0;
    const push = line => { if (size < maxChars) { out.push(line); size += line.length + 1; } };
    const visible = el => { const style = getComputedStyle(el); return style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0; };
    const label = el => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const INTERACTIVE = 'a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[contenteditable=true],[onclick]';
    document.querySelectorAll('[data-dragon-ref]').forEach(el => el.removeAttribute('data-dragon-ref'));
    push(`# ${document.title || '（无标题）'}`);
    push(`URL: ${location.href}`);
    const walk = node => {
        if (size >= maxChars) return;
        if (node.nodeType === 3) {
            const text = node.textContent.replace(/\s+/g, ' ').trim();
            if (text && !node.parentElement.closest(INTERACTIVE)) push(text);
            return;
        }
        if (node.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|HEAD)$/.test(node.tagName) || !visible(node)) return;
        const tag = node.tagName;
        if (/^H[1-6]$/.test(tag)) { push(`${'#'.repeat(Number(tag[1]) + 1)} ${node.innerText.replace(/\s+/g, ' ').trim()}`); return; }
        if (tag === 'TR') { push(`| ${[...node.children].map(cell => cell.innerText.replace(/\s+/g, ' ').trim()).join(' | ')} |`); return; }
        if (node.matches(INTERACTIVE)) {
            const id = `e${++ref}`;
            node.setAttribute('data-dragon-ref', id);
            const kind = tag === 'A' ? 'link' : tag === 'SELECT' ? 'select' : tag === 'TEXTAREA' ? 'textbox' : tag === 'INPUT' ? (['checkbox', 'radio', 'submit', 'button'].includes(node.type) ? node.type : 'textbox') : (node.getAttribute('role') || 'button');
            const extra = tag === 'A' ? ` → ${node.href}` : kind === 'textbox' && node.value ? ` 值="${String(node.value).slice(0, 80)}"` : (kind === 'checkbox' || kind === 'radio') ? (node.checked ? ' [已选]' : ' [未选]') : '';
            push(`[${id}] ${kind} "${label(node)}"${extra}`);
            return;
        }
        node.childNodes.forEach(walk);
    };
    walk(document.body || document.documentElement);
    return { text: out.join('\n'), truncated: size >= maxChars, refs: ref };
};

function createPage({ id, send, close, label = '' }) {
    const network = new Map();
    const consoleLog = [];
    const waiters = new Set();
    const page = {
        id, label, url: '', title: '', lastUsed: Date.now(),
        async init() {
            await Promise.all(['Page.enable', 'Network.enable', 'Runtime.enable', 'Log.enable'].map(method => send(method, method === 'Network.enable' ? { maxTotalBufferSize: 50 * 1024 * 1024, maxResourceBufferSize: 10 * 1024 * 1024 } : {})));
        },
        onEvent(method, params = {}) {
            if (method === 'Network.requestWillBeSent') {
                // 请求体（POST 参数）和请求头一起记下；Cookie、Authorization 等凭据头不记
                const headers = Object.fromEntries(Object.entries(params.request.headers || {}).filter(([key]) => !SECRET_HEADER_RE.test(key)));
                network.set(params.requestId, { id: params.requestId, method: params.request.method, url: params.request.url, type: params.type || '', status: 0, mimeType: '', size: 0, startedAt: Date.now(),
                    headers, postData: typeof params.request.postData === 'string' ? params.request.postData.slice(0, 64 * 1024) : '', hasPostData: Boolean(params.request.hasPostData) });
                if (network.size > LIMITS.network) network.delete(network.keys().next().value);
            } else if (method === 'Network.responseReceived') {
                const entry = network.get(params.requestId);
                if (entry) Object.assign(entry, { status: params.response.status, mimeType: params.response.mimeType, type: params.type || entry.type });
            } else if (method === 'Network.loadingFinished') {
                const entry = network.get(params.requestId);
                if (entry) Object.assign(entry, { size: params.encodedDataLength || 0, done: true });
            } else if (method === 'Network.loadingFailed') {
                const entry = network.get(params.requestId);
                if (entry) Object.assign(entry, { failed: params.errorText || 'failed', done: true });
            } else if (method === 'Runtime.consoleAPICalled') {
                consoleLog.push({ level: params.type, text: (params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 2000), at: Date.now() });
            } else if (method === 'Runtime.exceptionThrown') {
                consoleLog.push({ level: 'error', text: String(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || '').slice(0, 2000), at: Date.now() });
            } else if (method === 'Log.entryAdded') {
                consoleLog.push({ level: params.entry.level, text: `${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`.slice(0, 2000), at: Date.now() });
            }
            if (consoleLog.length > LIMITS.console) consoleLog.splice(0, consoleLog.length - LIMITS.console);
            waiters.forEach(waiter => waiter(method, params));
        },
        waitFor(predicate, timeoutMs) {
            return new Promise(resolve => {
                const done = value => { clearTimeout(timer); waiters.delete(check); resolve(value); };
                const check = (method, params) => { if (predicate(method, params)) done(true); };
                const timer = setTimeout(() => done(false), timeoutMs);
                waiters.add(check);
            });
        },
        async evaluate(expression, { awaitPromise = true } = {}) {
            const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
            if (result.exceptionDetails) throw browserError('BROWSER_SCRIPT', `页面脚本出错：${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
            return result.result?.value;
        },
        async navigate(url) {
            network.clear();
            const loaded = page.waitFor(method => method === 'Page.loadEventFired', LIMITS.navigateMs);
            const result = await send('Page.navigate', { url });
            if (result.errorText) throw browserError('BROWSER_NAVIGATE', `打开失败：${result.errorText}`);
            const ok = await loaded;
            await page.settle();
            return { ok };
        },
        // 等网络安静一会儿（单页应用加载完数据）
        async settle(quietMs = 500, maxMs = 5000) {
            const until = Date.now() + maxMs;
            while (Date.now() < until) {
                const pending = [...network.values()].filter(item => !item.done && Date.now() - item.startedAt < 15000).length;
                if (!pending) { await new Promise(resolve => setTimeout(resolve, quietMs)); if (![...network.values()].some(item => !item.done && Date.now() - item.startedAt < 15000)) return; }
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        },
        async snapshot(maxChars = LIMITS.snapshotChars) {
            return page.evaluate(`(${SNAPSHOT_SCRIPT.toString()})(${Math.min(200000, Math.max(2000, Number(maxChars) || LIMITS.snapshotChars))})`);
        },
        async locate(ref) {
            const box = await page.evaluate(`(() => { const el = document.querySelector('[data-dragon-ref="${String(ref).replace(/[^\w-]/g, '')}"]'); if (!el) return null;
                el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || el.title || '').replace(/\\s+/g, ' ').trim().slice(0, 120), tag: el.tagName }; })()`);
            if (!box) throw browserError('BROWSER_REF', `找不到元素 ${ref}：页面可能已变化，请先 browser_snapshot 重新读取`);
            return box;
        },
        async click(ref) {
            const box = await page.locate(ref);
            for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
            await page.waitFor(method => method === 'Page.loadEventFired', 1500);
            await page.settle(400, 4000);
            return box;
        },
        async type(ref, text, submit) {
            const box = await page.locate(ref);
            await page.evaluate(`(() => { const el = document.querySelector('[data-dragon-ref="${String(ref).replace(/[^\w-]/g, '')}"]'); el.focus();
                if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } else if (el.isContentEditable) el.textContent = ''; })()`);
            await send('Input.insertText', { text: String(text ?? '') });
            if (submit) {
                for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
                await page.waitFor(method => method === 'Page.loadEventFired', 2000);
                await page.settle(400, 5000);
            }
            return box;
        },
        async scroll(direction) {
            await page.evaluate(`window.scrollBy(0, ${direction === 'up' ? '-0.9' : '0.9'} * innerHeight)`);
            await page.settle(300, 3000);
        },
        async screenshot(fullPage) {
            const params = { format: 'png' };
            if (fullPage) {
                const metrics = await send('Page.getLayoutMetrics');
                const size = metrics.cssContentSize || metrics.contentSize;
                params.clip = { x: 0, y: 0, width: Math.min(size.width, 4000), height: Math.min(size.height, 16000), scale: 1 };
                params.captureBeyondViewport = true;
            }
            return Buffer.from((await send('Page.captureScreenshot', params)).data, 'base64');
        },
        networkList: () => [...network.values()],
        consoleList: () => consoleLog.slice(),
        async responseBody(requestId) {
            const entry = network.get(requestId);
            if (!entry) throw browserError('BROWSER_REQUEST', `没有请求 ${requestId}（只保留当前页面最近 ${LIMITS.network} 个）`);
            if (entry.hasPostData && !entry.postData) entry.postData = String((await send('Network.getRequestPostData', { requestId }).catch(() => ({}))).postData || '').slice(0, 64 * 1024);
            const result = await send('Network.getResponseBody', { requestId }).catch(error => ({ error }));
            if (result.error) return { entry, body: null, error: result.error.message };
            return { entry, body: result.body, base64: result.base64Encoded };
        },
        async refreshInfo() {
            const info = await page.evaluate('({ url: location.href, title: document.title })').catch(() => null);
            if (info) Object.assign(page, info);
            return page;
        },
        close
    };
    return page;
}

// ── 服务端后端：本机独立配置目录的 Chrome / Edge ─────────────
function findChrome() {
    const fromEnv = process.env.TOOLS_AGENT_BROWSER_PATH;
    const candidates = fromEnv ? [fromEnv] : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
        : process.platform === 'win32'
            ? [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(base => [
                path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe')])
            : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
    return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch (_error) { return false; } }) || null;
}

function profileDir(owner) {
    const base = path.join(process.env.TOOLS_DATA_DIR || path.join(__dirname, '../data'), 'agent-browser');
    return path.join(base, crypto.createHash('sha256').update(String(owner)).digest('hex').slice(0, 24));
}

// 上次服务被强杀 / 崩溃后残留的 Chrome 还占着配置目录时，新实例会直接退出：按锁文件里的 PID 结束它（只认用这个配置目录的进程）
function clearStaleProfile(dir) {
    if (process.platform === 'win32') return;
    let target = '';
    try { target = fs.readlinkSync(path.join(dir, 'SingletonLock')); } catch (_error) { return; }
    const pid = Number(String(target).split('-').pop());
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
    try {
        const command = require('child_process').execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
        if (command.includes(`--user-data-dir=${dir}`)) process.kill(pid, 'SIGTERM');
    } catch (_error) { /* 进程已不在 */ }
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { try { fs.unlinkSync(path.join(dir, name)); } catch (_error) { /* noop */ } }
}

// 服务收到退出信号时先关掉启动过的 Chrome，再按原信号退出（只在启动过浏览器后注册，不改变平台原有的退出方式）
let exitHooked = false;
function hookExitSignals() {
    if (exitHooked) return;
    exitHooked = true;
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.once(signal, () => {
            shutdownAll();
            if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
        });
    }
}

function createServerBrowser(owner) {
    let child = null;
    let socket = null;
    let seq = 0;
    const calls = new Map();
    const pages = new Map(); // sessionId → page
    const byTarget = new Map(); // targetId → page
    let starting = null;

    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return reject(browserError('BROWSER_CLOSED', '浏览器已关闭'));
        const id = ++seq;
        calls.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

    async function start() {
        const exe = findChrome();
        if (!exe) throw browserError('BROWSER_UNAVAILABLE', '本机没有找到 Chrome / Edge；可用环境变量 TOOLS_AGENT_BROWSER_PATH 指定浏览器程序路径');
        const dir = profileDir(owner);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        clearStaleProfile(dir);
        hookExitSignals();
        const args = [`--user-data-dir=${dir}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
            '--disable-sync', '--window-size=1366,900', ...(process.env.TOOLS_AGENT_BROWSER_HEADFUL === '1' ? [] : ['--headless=new']), 'about:blank'];
        child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        const wsUrl = await new Promise((resolve, reject) => {
            let buffer = '';
            const timer = setTimeout(() => reject(browserError('BROWSER_START', '浏览器启动超时')), 20000);
            child.stderr.on('data', chunk => {
                buffer += chunk;
                const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
                if (match) { clearTimeout(timer); resolve(match[1]); }
                if (buffer.length > 65536) buffer = buffer.slice(-4096);
            });
            child.once('exit', code => { clearTimeout(timer); reject(browserError('BROWSER_START', `浏览器启动失败（退出码 ${code}）`)); });
        });
        socket = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
        await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
        socket.on('message', raw => {
            let message;
            try { message = JSON.parse(raw); } catch (_error) { return; }
            if (message.id && calls.has(message.id)) {
                const call = calls.get(message.id);
                calls.delete(message.id);
                if (message.error) call.reject(browserError('BROWSER_CDP', message.error.message || 'CDP 错误'));
                else call.resolve(message.result || {});
            } else if (message.method) {
                if (message.method === 'Target.detachedFromTarget') {
                    const page = pages.get(message.params.sessionId);
                    if (page) { pages.delete(message.params.sessionId); byTarget.delete(page.targetId); }
                }
                pages.get(message.sessionId)?.onEvent(message.method, message.params);
            }
        });
        socket.on('close', () => { calls.forEach(call => call.reject(browserError('BROWSER_CLOSED', '浏览器已关闭'))); calls.clear(); pages.clear(); byTarget.clear(); socket = null; });
        child.once('exit', () => { child = null; socket?.terminate(); });
    }

    const api = {
        kind: 'server',
        async ensure() {
            if (socket && socket.readyState === WebSocket.OPEN) return;
            starting = starting || start().finally(() => { starting = null; });
            await starting;
        },
        async newPage() {
            await api.ensure();
            const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
            const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
            const page = createPage({
                id: targetId.slice(0, 8).toLowerCase(),
                send: (method, params) => send(method, params, sessionId),
                close: () => send('Target.closeTarget', { targetId }).catch(() => {})
            });
            page.targetId = targetId;
            pages.set(sessionId, page);
            byTarget.set(targetId, page);
            await page.init();
            return page;
        },
        pages: () => [...byTarget.values()],
        alive: () => Boolean(child),
        shutdown() {
            try { socket?.close(); } catch (_error) { /* noop */ }
            if (child) { try { child.kill(); } catch (_error) { /* noop */ } }
            child = null;
        }
    };
    return api;
}

// ── 桌面端后端：Dragon 浏览器（electron-main 注册） ─────────
let desktopController = null;
/** controller.openPage({ url, name }) → { id, webContents, close() }；controller.pages() → 同上 */
function configureDesktopBrowser(controller) { desktopController = controller || null; }

function createDesktopBrowser() {
    const pages = new Map();
    const wrap = handle => {
        const wc = handle.webContents;
        const dbg = wc.debugger;
        if (!dbg.isAttached()) dbg.attach('1.3');
        const page = createPage({ id: String(handle.id).replace(/^dragon-tab-/, 't'), send: (method, params = {}) => dbg.sendCommand(method, params), close: () => handle.close?.() });
        dbg.on('message', (_event, method, params) => page.onEvent(method, params));
        wc.once('destroyed', () => pages.delete(page.id));
        pages.set(page.id, page);
        return page;
    };
    return {
        kind: 'desktop',
        async ensure() {},
        async newPage() {
            const page = wrap(await desktopController.openPage({ url: 'about:blank', name: 'Dragon Claw' }));
            await page.init();
            return page;
        },
        pages: () => [...pages.values()],
        alive: () => true,
        shutdown() {}
    };
}

// ── 每个账号的浏览器与标签页 ─────────────────────────────
const owners = new Map(); // owner → { browser, tabs: Map(id → page), active }
let desktopShared = null;

function available() {
    if (String(process.env.TOOLS_AGENT_BROWSER || '').toLowerCase() === 'off') return null; // 管理员可用环境变量关闭浏览器工具
    if (desktopController) return { kind: 'desktop', label: 'Dragon 浏览器' };
    const exe = findChrome();
    return exe ? { kind: 'server', label: path.basename(exe).replace(/\.exe$/i, '') } : null;
}

function stateFor(owner) {
    let state = owners.get(owner);
    if (!state) {
        const browser = desktopController ? (desktopShared = desktopShared || createDesktopBrowser()) : createServerBrowser(owner);
        state = { browser, tabs: new Map(), active: null, timer: null };
        owners.set(owner, state);
    }
    clearTimeout(state.timer);
    if (state.browser.kind === 'server') {
        state.timer = setTimeout(() => { state.browser.shutdown(); owners.delete(owner); }, LIMITS.idleMs);
        state.timer.unref?.();
    }
    return state;
}

function liveTabs(state) {
    const alive = new Set(state.browser.pages());
    for (const [id, page] of state.tabs) if (!alive.has(page)) state.tabs.delete(id);
    return state.tabs;
}

async function activePage(owner, tabId) {
    const state = stateFor(owner);
    const tabs = liveTabs(state);
    const page = tabId ? tabs.get(String(tabId)) : tabs.get(state.active);
    if (!page) throw browserError('BROWSER_NO_TAB', tabId ? `没有标签页 ${tabId}` : '还没有打开网页：先用 browser_navigate 打开网址');
    page.lastUsed = Date.now();
    return page;
}

async function openPage(owner, url, newTab) {
    const state = stateFor(owner);
    const tabs = liveTabs(state);
    let page = !newTab && tabs.get(state.active);
    if (!page) {
        if (tabs.size >= LIMITS.tabs) {
            const oldest = [...tabs.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
            await oldest.close();
            tabs.delete(oldest.id);
        }
        page = await state.browser.newPage();
        tabs.set(page.id, page);
    }
    state.active = page.id;
    const result = await page.navigate(url);
    await page.refreshInfo();
    return { page, loaded: result.ok };
}

function shutdownAll() {
    owners.forEach(state => { clearTimeout(state.timer); state.browser.shutdown(); });
    owners.clear();
}
process.once('exit', shutdownAll);

// ── 工具 ─────────────────────────────────────────────────
const TAB_PROP = { tabId: { type: 'string', description: '标签页编号，默认当前标签页（见 browser_tabs）' } };
const DEFINITIONS = [
    { name: 'browser_navigate', kind: 'external', description: '在浏览器里打开网址（http/https），等页面和数据加载完，返回页面标题和地址。打开后用 browser_snapshot 读内容。newTab=true 时新开标签页。',
        parameters: { type: 'object', properties: { url: { type: 'string' }, newTab: { type: 'boolean' } }, required: ['url'] } },
    { name: 'browser_snapshot', kind: 'read', description: '读取当前页面：标题、正文文字、表格行，以及可点击 / 可输入的元素（带编号如 [e12]，供 browser_click / browser_type 使用）。页面变化后编号会重排，操作前重新读取。',
        parameters: { type: 'object', properties: { ...TAB_PROP, maxChars: { type: 'integer', description: '最多返回字数，默认 40000' } } } },
    { name: 'browser_click', kind: 'write', description: '点击页面元素（ref 来自 browser_snapshot 的编号），等页面响应后返回。',
        parameters: { type: 'object', properties: { ref: { type: 'string' }, ...TAB_PROP }, required: ['ref'] } },
    { name: 'browser_type', kind: 'write', description: '清空并在输入框里输入文字（ref 来自 browser_snapshot）；submit=true 时随后按回车提交。',
        parameters: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' }, ...TAB_PROP }, required: ['ref', 'text'] } },
    { name: 'browser_scroll', kind: 'read', description: '页面向下或向上滚动一屏（加载更多内容的页面需要），之后用 browser_snapshot 读取。',
        parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up'] }, ...TAB_PROP } } },
    { name: 'browser_wait', kind: 'read', description: '等待页面出现某段文字（单页应用异步加载时用），或单纯等待若干毫秒。',
        parameters: { type: 'object', properties: { text: { type: 'string' }, timeoutMs: { type: 'integer', description: '默认 10000，最多 30000' }, ...TAB_PROP } } },
    { name: 'browser_network', kind: 'read', description: '列出当前页面打开以来的网络请求（方法、状态码、类型、大小、地址），可按地址关键词 / 类型（xhr、fetch、document、script 等）过滤。接口数据用 browser_network_body 读取响应内容。',
        parameters: { type: 'object', properties: { filter: { type: 'string' }, type: { type: 'string' }, limit: { type: 'integer', description: '默认 80' }, ...TAB_PROP } } },
    { name: 'browser_network_body', kind: 'read', description: '读取某个网络请求的完整内容：请求地址、请求头、请求体（POST 参数）和响应（requestId 来自 browser_network）。拿接口返回的 JSON 数据、查看接口参数都用它。',
        parameters: { type: 'object', properties: { requestId: { type: 'string' }, ...TAB_PROP }, required: ['requestId'] } },
    { name: 'browser_console', kind: 'read', description: '读取页面控制台日志与脚本报错（排查页面问题时用）。',
        parameters: { type: 'object', properties: { level: { type: 'string', description: 'error / warning / 全部（默认）' }, ...TAB_PROP } } },
    { name: 'browser_screenshot', kind: 'read', description: '给当前页面截图并保存成文件（用户可在对话里查看；模型本身看不到图片内容）。',
        parameters: { type: 'object', properties: { fullPage: { type: 'boolean' }, ...TAB_PROP } } },
    { name: 'browser_tabs', kind: 'read', description: '列出智能体打开的标签页；action=select 切换当前标签页，action=close 关闭标签页。',
        parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'select', 'close'] }, ...TAB_PROP } } },
    { name: 'browser_evaluate', kind: 'external', description: '在页面里执行一段 JavaScript 表达式并返回结果（可 await）。每次都要用户审批：读页面内容（含表格、列表）先用 browser_snapshot，接口数据与参数用 browser_network / browser_network_body；不要用脚本重复抓取页面或重放接口请求，只在这些都拿不到所需数据时使用。',
        parameters: { type: 'object', properties: { expression: { type: 'string' }, ...TAB_PROP }, required: ['expression'] } }
];
const KIND = new Map(DEFINITIONS.map(item => [item.name, item.kind]));

function formatSize(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

async function execute(ctx, name, args = {}) {
    const owner = ctx.owner;
    try {
        if (!owner) throw browserError('BROWSER_OWNER', '无法确定账号');
        if (name === 'browser_navigate') {
            const url = webUrl(args.url);
            if (!url) throw browserError('BROWSER_URL', '只能打开 http / https 网址');
            const { page, loaded } = await openPage(owner, url, args.newTab === true);
            return { content: `已打开 [${page.id}] ${page.title || '（无标题）'}\n${page.url}${loaded ? '' : '\n（页面加载超时，内容可能不完整）'}\n用 browser_snapshot 读取页面内容。`, summary: `${page.title || page.url}`.slice(0, 120) };
        }
        if (name === 'browser_tabs') {
            const state = stateFor(owner);
            const tabs = liveTabs(state);
            if (args.action === 'select' || args.action === 'close') {
                const page = await activePage(owner, args.tabId);
                if (args.action === 'select') state.active = page.id;
                else { await page.close(); tabs.delete(page.id); if (state.active === page.id) state.active = [...tabs.keys()].pop() || null; }
            }
            for (const page of tabs.values()) await page.refreshInfo();
            const lines = [...tabs.values()].map(page => `${page.id === state.active ? '*' : ' '} [${page.id}] ${page.title || '（无标题）'} ${page.url}`);
            return { content: lines.length ? lines.join('\n') : '没有打开的标签页。', summary: `${lines.length} 个标签页` };
        }
        const page = await activePage(owner, args.tabId);
        if (name === 'browser_snapshot') {
            const snap = await page.snapshot(args.maxChars);
            await page.refreshInfo();
            return { content: `${snap.text}${snap.truncated ? '\n…（内容过长已截断：可调大 maxChars，或用 browser_network 直接取接口数据）' : ''}`, summary: `${page.title || page.url} · ${snap.refs} 个可操作元素`.slice(0, 120) };
        }
        if (name === 'browser_click') {
            const box = await page.click(args.ref);
            await page.refreshInfo();
            return { content: `已点击 ${args.ref}「${box.text}」，当前页面：${page.title}\n${page.url}\n页面可能已变化，继续操作前用 browser_snapshot 重新读取。`, summary: `点击「${box.text}」`.slice(0, 120) };
        }
        if (name === 'browser_type') {
            const box = await page.type(args.ref, args.text, args.submit === true);
            await page.refreshInfo();
            return { content: `已在 ${args.ref}「${box.text}」输入${args.submit ? '并提交' : ''}，当前页面：${page.title}\n${page.url}`, summary: `输入${args.submit ? '并提交' : ''}` };
        }
        if (name === 'browser_scroll') {
            await page.scroll(args.direction);
            return { content: '已滚动，用 browser_snapshot 读取新内容。', summary: args.direction === 'up' ? '向上滚动' : '向下滚动' };
        }
        if (name === 'browser_wait') {
            const timeout = Math.min(30000, Math.max(100, Number(args.timeoutMs) || 10000));
            if (!args.text) { await new Promise(resolve => setTimeout(resolve, timeout)); return { content: `已等待 ${timeout}ms`, summary: `等待 ${timeout}ms` }; }
            const until = Date.now() + timeout;
            const needle = JSON.stringify(String(args.text));
            while (Date.now() < until) {
                if (await page.evaluate(`document.body && document.body.innerText.includes(${needle})`).catch(() => false)) return { content: `页面已出现「${args.text}」`, summary: '已出现' };
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            return { content: `等待 ${timeout}ms 后页面仍未出现「${args.text}」`, summary: '未出现', isError: true };
        }
        if (name === 'browser_network') {
            const filter = String(args.filter || '').toLowerCase();
            const type = String(args.type || '').toLowerCase();
            const list = page.networkList().filter(item => (!filter || item.url.toLowerCase().includes(filter)) && (!type || item.type.toLowerCase() === type));
            const limit = Math.min(400, Math.max(1, Number(args.limit) || 80));
            const shown = list.slice(-limit);
            const lines = shown.map(item => `${item.id}\t${item.method}${item.postData || item.hasPostData ? '+body' : ''}\t${item.failed ? `失败(${item.failed})` : item.status || '…'}\t${item.type}\t${item.mimeType}\t${formatSize(item.size)}\t${item.url.slice(0, 300)}`);
            return { content: `共 ${list.length} 个请求${list.length > shown.length ? `，显示最近 ${shown.length} 个` : ''}（requestId / 方法 / 状态 / 类型 / MIME / 大小 / 地址）：\n${lines.join('\n')}`, summary: `${list.length} 个请求` };
        }
        if (name === 'browser_network_body') {
            const { entry, body, base64, error } = await page.responseBody(String(args.requestId || ''));
            // 先给出完整的请求（地址、请求头、请求体），再给响应：接口的查询参数常在 POST 请求体里
            const request = [`请求：${entry.method} ${entry.url}`,
                ...Object.entries(entry.headers || {}).filter(([key]) => /^(content-type|accept|referer|origin|x-)/i.test(key)).map(([key, value]) => `  ${key}: ${String(value).slice(0, 300)}`),
                ...(entry.postData ? [`请求体：${entry.postData}`] : [])].join('\n');
            if (body === null) return { content: `${request}\n\n取不到响应内容：${error}`, summary: '响应已不可读', isError: true };
            const textual = !base64 || /json|text|xml|javascript|html|csv/i.test(entry.mimeType);
            const content = base64 ? (textual ? Buffer.from(body, 'base64').toString('utf8') : null) : body;
            if (content === null) return { content: `${request}\n\n响应是二进制内容（${entry.mimeType}，${formatSize(Buffer.byteLength(body, 'base64'))}），不能按文本读取。`, summary: '二进制响应' };
            return { content: `${request}\n\n响应：状态 ${entry.status} · ${entry.mimeType}\n${content.slice(0, LIMITS.bodyChars)}`, summary: `${entry.status} ${entry.mimeType} ${formatSize(content.length)}` };
        }
        if (name === 'browser_console') {
            const level = String(args.level || '').toLowerCase();
            const list = page.consoleList().filter(item => !level || item.level === level || (level === 'warning' && item.level === 'warn'));
            return { content: list.length ? list.map(item => `[${item.level}] ${item.text}`).join('\n') : '没有控制台日志。', summary: `${list.length} 条日志` };
        }
        if (name === 'browser_screenshot') {
            const png = await page.screenshot(args.fullPage === true);
            const dir = path.join(require('./agent-artifacts').ownerDir(owner), 'screenshots');
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            const file = path.join(dir, `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}-${page.id}.png`);
            fs.writeFileSync(file, png, { mode: 0o600 });
            return { content: `截图已保存：${file}（${formatSize(png.length)}）。在回复里写出这个路径，用户就能直接查看图片；读页面文字请用 browser_snapshot。`, summary: `截图 ${formatSize(png.length)}`, artifactPath: file, imagePaths: [file] };
        }
        if (name === 'browser_evaluate') {
            const value = await page.evaluate(String(args.expression || ''));
            const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
            return { content: text === undefined ? '（没有返回值）' : String(text).slice(0, LIMITS.bodyChars), summary: '已执行页面脚本' };
        }
        return { content: `未知工具：${name}`, summary: '未知工具', isError: true };
    } catch (error) {
        return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
    }
}

async function preview(ctx, name, args = {}) {
    if (name === 'browser_navigate') {
        const url = webUrl(args.url);
        if (!url) throw browserError('BROWSER_URL', '只能打开 http / https 网址');
        return { title: '打开网页', impact: '会以你的身份访问该网站', fields: [{ label: '网址', value: url }, { label: '浏览器', value: available()?.label || '' }] };
    }
    if (name === 'browser_click' || name === 'browser_type') {
        const page = await activePage(ctx.owner, args.tabId);
        const box = await page.locate(args.ref).catch(() => null);
        await page.refreshInfo();
        const fields = [{ label: '页面', value: `${page.title}\n${page.url}` }, { label: '元素', value: `${args.ref}${box ? `「${box.text}」` : ''}` }];
        if (name === 'browser_type') fields.push({ label: '输入', value: String(args.text ?? '') }, { label: '提交', value: args.submit ? '输入后按回车' : '否' });
        return { title: name === 'browser_click' ? '点击网页元素' : '在网页输入', fields };
    }
    if (name === 'browser_evaluate') {
        const page = await activePage(ctx.owner, args.tabId);
        await page.refreshInfo();
        return { title: '在网页执行脚本', fields: [{ label: '页面', value: `${page.title}\n${page.url}` }], command: String(args.expression || '') };
    }
    return {};
}

/** 「总是允许」的粒度：打开网页按站点，其他按工具 */
function alwaysKey(name, args = {}) {
    if (name !== 'browser_navigate') return name;
    try { return `browser_navigate@${new URL(String(args.url)).host}`; } catch (_error) { return name; }
}

function definitions() {
    return DEFINITIONS.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

module.exports = { LIMITS, DEFINITIONS, definitions, kindOf: name => KIND.get(name) || null, execute, preview, alwaysKey, available, findChrome, configureDesktopBrowser, webUrl, shutdownAll, _internal: { owners, SNAPSHOT_SCRIPT } };
