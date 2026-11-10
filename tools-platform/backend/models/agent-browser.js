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
const {AsyncLocalStorage}=require('async_hooks');
const commandContext=new AsyncLocalStorage(),activeCommands=new Map(),takeoverPending=new Set();
const AUTO_HANDOFF_MS=5000;
function interrupted(){return browserError('BROWSER_INTERRUPTED','用户已停止浏览器操作并接管。不要重试刚才的动作；交还后先读取页面再继续。');}
function commandSignal(){return commandContext.getStore()?.signal;}
function cancellable(promise,signal=commandSignal()){
    if(!signal)return promise;
    if(signal.aborted){Promise.resolve(promise).catch(()=>{});return Promise.reject(interrupted());}
    return new Promise((resolve,reject)=>{const abort=()=>reject(interrupted());signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
function pause(ms){const signal=commandSignal();if(signal?.aborted)return Promise.reject(interrupted());return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(interrupted());};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});}
const WebSocket = require('ws');
const pageLayoutScript=require('./browser-page-layout').script;
const { createDownloads } = require('./agent-browser-downloads');
const browserVault = require('./agent-browser-vault');

const SECRET_HEADER_RE = /^(cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token|x-api-key|x-auth-token)$/i;
const ZOOM_LEVELS = [.5,.67,.75,.8,.9,1,1.1,1.25,1.5,1.75,2,2.5,3];
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
    const privateInput = el => /^(INPUT|TEXTAREA)$/.test(el.tagName) && (el.type === 'password' || /password|passwd|secret|token|api[ _-]?key|authorization|cookie|密码|密钥|私钥/i.test([el.name,el.id,el.getAttribute('aria-label'),el.placeholder,el.autocomplete].filter(Boolean).join(' ')));
    const label = el => (el.getAttribute('aria-label') || (!privateInput(el) && (el.innerText || el.value)) || el.placeholder || el.title || el.alt || '').replace(/\s+/g, ' ').trim().slice(0, 120);
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
            const extra = tag === 'A' ? ` → ${node.href}` : kind === 'textbox' && node.value && !privateInput(node) ? ` 值="${String(node.value).slice(0, 80)}"` : (kind === 'checkbox' || kind === 'radio') ? (node.checked ? ' [已选]' : ' [未选]') : '';
            push(`[${id}] ${kind} "${label(node)}"${extra}`);
            return;
        }
        node.childNodes.forEach(walk);
    };
    walk(document.body || document.documentElement);
    return { text: out.join('\n'), truncated: size >= maxChars, refs: ref };
};

function createPage({ id, send:transport, close, label = '', notify, setZoom, vault = false }) {
    const send=(method,params)=>{if(commandSignal()?.aborted)return Promise.reject(interrupted());return cancellable(transport(method,params));};
    const network = new Map();
    const consoleLog = [];
    const waiters = new Set();
    let manualRecordingOff = false;
    let chooser = null, dragData = null, pointer = null, pointerTimer = null, manualPrepared = false, vaultHook = null;
    const page = {
        id, label, documentId:crypto.randomUUID(), url: '', title: '', lastUsed: Date.now(),
        publishOperator(value){notify?.(value);},
        async stopAI(terminate=false){await transport('Page.stopLoading',{}).catch(()=>{});if(terminate)await transport('Runtime.terminateExecution',{}).catch(()=>{});},
        async showAICursor(x,y){
            const viewport=await page.evaluate('({width:innerWidth,height:innerHeight})');
            if(viewport?.width){page.aiCursor={x:x/viewport.width,y:y/viewport.height,at:Date.now()};const owner=commandContext.getStore()?.owner;if(owner)publishOperator(owner);}
            await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await pause(120);
        },
        async init() {
            await Promise.all(['Page.enable', 'Network.enable', 'Runtime.enable', 'Log.enable'].map(method => send(method, method === 'Network.enable' ? { maxTotalBufferSize: 50 * 1024 * 1024, maxResourceBufferSize: 10 * 1024 * 1024 } : {})));
            // 保险箱：登录页自动填充、提交时自动保存。失败不影响浏览器本身可用。
            if (vault) vaultHook = await browserVault.install(transport, () => vaultContext(page)).catch(() => null);
        },
        cdp: (method, params = {}) => transport(method, params),
        setManualControl(active) { if(manualRecordingOff&&!active){chooser=null;manualPrepared=false;send('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});}manualRecordingOff = active; network.clear(); consoleLog.length = 0; },
        onEvent(method, params = {}) {
            if (method === 'Runtime.bindingCalled') { vaultHook?.(params); return; }
            if (method === 'Page.fileChooserOpened') chooser = {...params, id:crypto.randomUUID()};
            if (method === 'Page.frameNavigated' && !params.frame?.parentId) {chooser = null;page.documentId=params.frame?.loaderId||crypto.randomUUID();}
            if (method === 'Input.dragIntercepted') dragData = params.data;
            if (manualRecordingOff && /^(Network\.|Runtime\.console|Log\.)/.test(method)) return;
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
            return cancellable(new Promise(resolve => {
                const signal=commandSignal(),abort=()=>done(false);
                const done = value => { clearTimeout(timer);signal?.removeEventListener('abort',abort);waiters.delete(check); resolve(value); };
                const check = (method, params) => { if (predicate(method, params)) done(true); };
                const timer = setTimeout(() => done(false), timeoutMs);
                waiters.add(check);signal?.addEventListener('abort',abort,{once:true});
            }));
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
                if(commandSignal()?.aborted)throw interrupted();
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
            await page.showAICursor(box.x,box.y);
            for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
            await page.waitFor(method => method === 'Page.loadEventFired', 1500);
            await page.settle(400, 4000);
            return box;
        },
        async type(ref, text, submit) {
            const box = await page.locate(ref);
            await page.showAICursor(box.x,box.y);
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
        async historyState() {
            const history=await send('Page.getNavigationHistory');
            return {canBack:history.currentIndex>0,canForward:history.currentIndex<history.entries.length-1};
        },
        async historyAction(action) {
            if(action==='reload')await send('Page.reload');
            else {
                const history=await send('Page.getNavigationHistory'),offset=action==='back'?-1:1;
                const entry=history.entries[history.currentIndex+offset];
                if(entry)await send('Page.navigateToHistoryEntry',{entryId:entry.id});
            }
            await new Promise(resolve=>setTimeout(resolve,300));
        },
        async prepareManual() {
            if(!manualPrepared){await send('Page.setInterceptFileChooserDialog', {enabled:true});manualPrepared=true;}
        },
        pendingUpload() { return chooser ? {id:chooser.id,multiple:chooser.mode==='selectMultiple'} : null; },
        async uploadFiles(files, chooserId) {
            if (!chooser || chooser.id!==chooserId) throw browserError('BROWSER_VIEW_STALE','请先点击网页的上传按钮，再选择文件');
            if (files.length>1 && chooser.mode!=='selectMultiple') throw browserError('BROWSER_CONTROL_INVALID','这个上传控件只允许一个文件');
            const target=chooser;
            await send('DOM.setFileInputFiles',{files,backendNodeId:target.backendNodeId});
            chooser=null;
        },
        async pointerInput(phase, point) {
            clearTimeout(pointerTimer);
            if(phase==='down'){
                if(pointer)await page.pointerInput('cancel');
                dragData=null;pointer={...point,entered:false};
                await send('Input.setInterceptDrags',{enabled:true});
                await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
                await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
            }else if(pointer){
                Object.assign(pointer,point||{});
                if(phase==='move'){
                    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer.x,y:pointer.y,button:'left',buttons:1});
                    await new Promise(resolve=>setTimeout(resolve,16));
                    if(pointer&&dragData){
                        if(!pointer.entered){await send('Input.dispatchDragEvent',{type:'dragEnter',x:pointer.x,y:pointer.y,data:dragData});pointer.entered=true;}
                        await send('Input.dispatchDragEvent',{type:'dragOver',x:pointer.x,y:pointer.y,data:dragData});
                    }
                }else{
                    clearTimeout(pointerTimer);const last=pointer;pointer=null;
                    try{if(phase==='up'&&dragData)await send('Input.dispatchDragEvent',{type:'drop',x:last.x,y:last.y,data:dragData});}
                    finally{
                        await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:last.x,y:last.y,button:'left',buttons:0,clickCount:1}).catch(()=>{});
                        await send('Input.cancelDragging').catch(()=>{});
                        await send('Input.setInterceptDrags',{enabled:false}).catch(()=>{});dragData=null;
                    }
                }
            }
            clearTimeout(pointerTimer);
            if(pointer){pointerTimer=setTimeout(()=>page.pointerInput('cancel').catch(()=>{}),10000);pointerTimer.unref?.();}
        },
        async manualInput(action, args) {
            if (action === 'click') {
                for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', {type,x:args.x,y:args.y,button:'left',clickCount:1});
            } else if (action === 'file-drop') {
                const data={items:[],files:args.files,dragOperationsMask:1};
                for(const type of ['dragEnter','dragOver','drop'])await send('Input.dispatchDragEvent',{type,x:args.x,y:args.y,data});
            } else if (action === 'scroll') {
                await send('Input.dispatchMouseEvent', {type:'mouseWheel',x:args.x,y:args.y,deltaX:0,deltaY:args.deltaY});
            } else if (action === 'type') {
                if (args.replace) await page.evaluate(`(()=>{const el=document.activeElement;if(el&&('value' in el)){el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
                await send('Input.insertText', {text:args.text});
            } else if (action === 'key') {
                const codes={Enter:13,Tab:9,Backspace:8,Delete:46,Escape:27,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35};
                for(const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key:args.key,code:args.key,windowsVirtualKeyCode:codes[args.key],text:type==='keyDown'&&args.key==='Enter'?'\r':undefined});
            }
            if(!['type','key'].includes(action))await new Promise(resolve=>setTimeout(resolve,180));
        },
        async setReadingWidth(width) {
            page.readingWidth=width||null;
            await page.applyMetrics();
        },
        // 真正的页面缩放（与 Chrome 缩放一致）：布局视口按 1/zoom 变化、像素比按 zoom 变化，输出画面尺寸不变。
        async setZoom(level) {
            page.zoom=ZOOM_LEVELS.includes(level)?level:1;
            if(setZoom)return setZoom(page.zoom);
            await page.applyMetrics();
        },
        async applyMetrics() {
            const zoom=page.zoom||1,width=page.readingWidth||0;
            if(zoom===1&&!width)return send('Emulation.clearDeviceMetricsOverride');
            if(!width&&!page.naturalViewport){
                await send('Emulation.clearDeviceMetricsOverride');
                page.naturalViewport=await page.evaluate('({width:innerWidth,height:innerHeight})').catch(()=>null);
            }
            const baseWidth=width||page.naturalViewport?.width||1366,baseHeight=width?900:page.naturalViewport?.height||900;
            await send('Emulation.setDeviceMetricsOverride',{width:Math.round(baseWidth/zoom),height:Math.round(baseHeight/zoom),deviceScaleFactor:zoom,mobile:false});
        },
        async screenshot(fullPage, live = false) {
            const params = live ? {format:'jpeg',quality:65} : { format: 'png' };
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

/**
 * 团队账号（owner 为 团队::账号，团队不是超级管理员空间）的浏览器：
 * - 进程放进团队命令沙箱，读不到服务器上的其他文件，配置目录在团队自己的 home 里；
 * - 只能经平台的出口代理上网，访问不了服务器本机和内网地址（models/team-browser-proxy.js）。
 * 沙箱不可用（如 Windows 服务器）时不启动，而不是退回到不受限的浏览器。
 */
function teamOf(owner) {
    const key = String(owner || '');
    if (!key.includes('::')) return '';
    const tenant = require('./tenant-context');
    const id = tenant.normalizeTenantId(key.slice(0, key.indexOf('::')));
    return id === tenant.DEFAULT_TENANT_ID ? '' : id;
}

function teamProfileDir(team, owner) {
    return path.join(require('./tenant-context').getHomeDir(team), '.agent-browser', crypto.createHash('sha256').update(String(owner)).digest('hex').slice(0, 24));
}

async function teamLaunch(team, exe, args, downloadDirectory) {
    const sandbox = require('./tenant-sandbox');
    const info = sandbox.status();
    if (!info.available) throw browserError('BROWSER_UNAVAILABLE', `团队账号的浏览器需要命令沙箱：${info.reason}`);
    const proxy = await require('./team-browser-proxy').ensure();
    const tenant = require('./tenant-context');
    tenant.ensureUserSpaceDirs(team);
    // Chrome 在临时目录里建 Unix 套接字，路径有长度上限（约 100 字节），团队目录通常太深：
    // macOS 用 /private/tmp 下按团队分开的短目录，Linux 沙箱里的 /tmp 本来就是私有的
    let shortTmp = '/tmp';
    if (info.kind === 'seatbelt') {
        const base = `/private/tmp/dragon-claw-browser-${process.getuid()}`;
        fs.mkdirSync(base, { recursive: true, mode: 0o700 });
        shortTmp = path.join(base, crypto.createHash('sha256').update(`${tenant.BASE_DATA_DIR}\n${team}`).digest('hex').slice(0, 16));
        fs.mkdirSync(shortTmp, { recursive: true, mode: 0o700 });
    }
    const launch = sandbox.wrap({
        tenantId: team, cwd: tenant.getHomeDir(team), file: exe, env: process.env,
        writable: [downloadDirectory, ...(info.kind === 'seatbelt' ? [shortTmp] : [])],
        // 程序本体所在目录只读放行（Linux 上 /usr/bin/google-chrome 多是指向 /opt 的软链接）
        readOnly: [path.dirname(fs.realpathSync(exe)), ...(process.platform === 'darwin' ? [exe.slice(0, exe.indexOf('.app/') + 4)] : [])],
        args: [...args.slice(0, -1),
            `--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>', // 回环地址也必须走代理（由代理拒绝）
            '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
            // 已经在团队沙箱里：Chrome 自带的进程沙箱无法再嵌套一层（macOS 会直接初始化失败），关掉它，由外层沙箱兜底
            '--no-sandbox', '--disable-gpu', ...(info.kind === 'bwrap' ? ['--disable-setuid-sandbox', '--disable-dev-shm-usage'] : []),
            // 不用服务账号的系统钥匙串 / 密钥环（沙箱里读不到，Chrome 会一直等）：Cookie 等只存在团队自己的配置目录里
            info.kind === 'seatbelt' ? '--use-mock-keychain' : '--password-store=basic',
            args[args.length - 1]]
    });
    // CFFIXED_USER_HOME：macOS 的系统框架按它找用户目录，否则会去读服务账号的真实家目录；
    // MAC_CHROMIUM_TMPDIR：macOS 的 Chrome 不看 TMPDIR，要用它指定临时目录
    launch.env = { ...launch.env, TMPDIR: shortTmp, ...(info.kind === 'seatbelt' ? { CFFIXED_USER_HOME: tenant.getHomeDir(team), MAC_CHROMIUM_TMPDIR: shortTmp } : {}) };
    return launch;
}

function createServerBrowser(owner) {
    const team = teamOf(owner);
    let child = null;
    let socket = null;
    let seq = 0;
    const calls = new Map();
    const pages = new Map(); // sessionId → page
    const byTarget = new Map(); // targetId → page
    let starting = null;
    let downloads = null;

    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return reject(browserError('BROWSER_CLOSED', '浏览器已关闭'));
        const id = ++seq;
        calls.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

    async function attachTarget(targetId, manual=false) {
        if(byTarget.has(targetId))return byTarget.get(targetId);
        const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
        const page=createPage({id:targetId.slice(0,8).toLowerCase(),send:(method,params)=>send(method,params,sessionId),close:()=>send('Target.closeTarget',{targetId}).catch(()=>{}),vault:true});
        page.targetId=targetId;page.setManualControl(manual);pages.set(sessionId,page);byTarget.set(targetId,page);await page.init();return page;
    }
    function popup(info) {
        if(info?.type!=='page'||!info.openerId||!byTarget.has(info.openerId))return;
        serialized(owner,async()=>{
            const state=owners.get(owner);if(!state)return;
            if(state.tabs.size>=LIMITS.tabs){await send('Target.closeTarget',{targetId:info.targetId});return;}
            const manual=manualSession(state),page=await attachTarget(info.targetId,Boolean(manual));
            state.tabs.set(page.id,page);state.active=page.id;if(manual)manual.tabId=page.id;state.frames?.clear();
        }).catch(()=>{});
    }

    async function start() {
        const exe = findChrome();
        if (!exe) throw browserError('BROWSER_UNAVAILABLE', '本机没有找到 Chrome / Edge；可用环境变量 TOOLS_AGENT_BROWSER_PATH 指定浏览器程序路径');
        const dir = team ? teamProfileDir(team, owner) : profileDir(owner);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        clearStaleProfile(dir);
        hookExitSignals();
        const isLinux = process.platform === 'linux';
        const args = [
            `--user-data-dir=${dir}`,
            '--remote-debugging-port=0',
            '--remote-debugging-address=127.0.0.1',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-sync',
            '--disable-background-networking',
            '--disable-default-apps',
            '--window-size=1366,900',
            ...(process.env.TOOLS_AGENT_BROWSER_HEADFUL === '1' ? [] : ['--headless=new']),
            ...(isLinux || process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : []),
            'about:blank'
        ];
        const store = createDownloads();
        downloads = store;
        if (team) {
            const launch = await teamLaunch(team, exe, args, store.directory);
            child = spawn(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        } else {
            child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        }
        const startTimeoutMs = process.env.CI ? 60000 : 30000;
        const wsUrl = await new Promise((resolve, reject) => {
            let buffer = '';
            const timer = setTimeout(() => reject(browserError('BROWSER_START', '浏览器启动超时')), startTimeoutMs);
            child.stderr.on('data', chunk => {
                buffer += chunk;
                const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
                if (match) { clearTimeout(timer); resolve(match[1]); }
                if (buffer.length > 65536) buffer = buffer.slice(-4096);
            });
            child.once('exit', code => { clearTimeout(timer); if (!/DevTools listening on ws:/.test(buffer)) console.warn(`[agent-browser] 浏览器启动失败（退出码 ${code}）：${buffer.trim().split('\n').slice(-3).join(' | ').slice(0, 600)}`); reject(browserError('BROWSER_START', `浏览器启动失败（退出码 ${code}）`)); });
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
                if (message.method === 'Browser.downloadWillBegin' || message.method === 'Browser.downloadProgress') {
                    store.event(message.method, message.params, guid => send('Browser.cancelDownload', { guid }).catch(() => {}));
                }
                if(message.method==='Target.targetCreated')popup(message.params?.targetInfo);
                if (message.method === 'Target.detachedFromTarget') {
                    const page = pages.get(message.params.sessionId);
                    if (page) { pages.delete(message.params.sessionId); byTarget.delete(page.targetId); }
                }
                pages.get(message.sessionId)?.onEvent(message.method, message.params);
            }
        });
        socket.on('close', () => { calls.forEach(call => call.reject(browserError('BROWSER_CLOSED', '浏览器已关闭'))); calls.clear(); pages.clear(); byTarget.clear(); socket = null; });
        child.once('exit', () => {
            store.dispose();
            if (downloads === store) { downloads = null; child = null; socket?.terminate(); }
        });
        await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: store.directory, eventsEnabled: true });
        await send('Target.setDiscoverTargets',{discover:true});
    }

    const api = {
        kind: 'server',
        downloads: () => downloads?.list() || [],
        openDownload: id => downloads?.open(id),
        // 上传给网页的文件：团队的浏览器在沙箱里，只读得到团队目录，先复制到团队临时目录
        localFile(source) {
            if (!team) return source;
            const dir = path.join(require('./tenant-context').getTmpDir(team), 'browser-uploads');
            fs.mkdirSync(dir, { recursive: true });
            const target = path.join(dir, `${crypto.randomBytes(6).toString('hex')}-${path.basename(source)}`);
            fs.copyFileSync(source, target);
            return target;
        },
        async ensure() {
            if (socket && socket.readyState === WebSocket.OPEN) return;
            starting = starting || start().catch(error => { api.shutdown(); throw error; }).finally(() => { starting = null; });
            await starting;
        },
        async newPage() {
            await api.ensure();
            const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
            return attachTarget(targetId);
        },
        pages: () => [...byTarget.values()],
        alive: () => Boolean(child),
        shutdown() {
            try { socket?.close(); } catch (_error) { /* noop */ }
            if (child) { try { child.kill(); } catch (_error) { /* noop */ } }
            downloads?.dispose();
            downloads = null;
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
        const page = createPage({ id: String(handle.id).replace(/^dragon-tab-/, 't'), send: (method, params = {}) => dbg.sendCommand(method, params), close: () => handle.close?.(),notify:value=>handle.setOperatorState?.(value),setZoom:level=>wc.setZoomFactor(level) });
        dbg.on('message', (_event, method, params) => page.onEvent(method, params));
        wc.once('destroyed', () => pages.delete(page.id));
        let nativeToken='';
        handle.setOperatorHandler?.(async action=>{
            const entry=[...owners].find(([,state])=>state.tabs.get(page.id)===page);if(!entry)return;
            const [owner,state]=entry,manual=manualSession(state);
            if(manual&&manual.token!==nativeToken)return;
            if(action==='activity'&&activeCommands.has(owner)&&!manual)return;
            try{const result=await control(owner,{action:action==='takeover'||!manual?'takeover':'activity',token:nativeToken});if(result.token)nativeToken=result.token;}catch(_error){}
        });
        wc.on('dom-ready',()=>{for(const[owner,state]of owners)if(state.tabs.get(page.id)===page)publishOperator(owner);});
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

// 页面当前归属的账号：保险箱按它取 / 存凭据；填过的密码记在浏览器状态上，用来从工具结果里抹掉。
function vaultContext(page) {
    const entry = [...owners].find(([, state]) => state.tabs.get(page.id) === page);
    if (!entry) return null;
    const [owner, state] = entry;
    state.vaultSecrets ||= new Set();
    return { owner, secrets: state.vaultSecrets, notify: notice => { state.vaultNotice = { ...notice, tabId: page.id, at: Date.now() }; } };
}
function maskVaultSecrets(owner, result) {
    const secrets = owners.get(owner)?.vaultSecrets;
    if (!secrets?.size || !result || typeof result !== 'object') return result;
    const masked = { ...result };
    for (const key of ['content', 'summary']) if (typeof masked[key] === 'string') masked[key] = browserVault.maskSecrets(masked[key], secrets);
    return masked;
}

function available() {
    if (String(process.env.TOOLS_AGENT_BROWSER || '').toLowerCase() === 'off') return null; // 管理员可用环境变量关闭浏览器工具
    if (desktopController) return { kind: 'desktop', label: 'Dragon 浏览器' };
    const exe = findChrome();
    return exe ? { kind: 'server', label: path.basename(exe).replace(/\.exe$/i, '') } : null;
}

function stateFor(owner) {
    if(commandSignal()?.aborted)throw interrupted();
    let state = owners.get(owner);
    if (!state) {
        // 桌面端的 Dragon 浏览器是全机共用的一个窗口，不能给团队账号
        if (desktopController && teamOf(owner)) throw browserError('BROWSER_UNAVAILABLE', '桌面版的浏览器只给本机用户使用，团队账号不可用');
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
    if(commandSignal()?.aborted)throw interrupted();
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
    state.active = page.id;publishOperator(owner);
    const result = await page.navigate(url);
    await page.refreshInfo();
    return { page, loaded: result.ok };
}

function shutdownAll() {
    owners.forEach(state => { clearTimeout(state.timer);clearTimeout(state.manual?.timer); state.browser.shutdown(); });
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
    { name: 'browser_login', kind: 'write', description: '用用户保险箱里保存的账号密码登录当前页面：页面要求登录时先调用它，不要向用户索要密码，也不要自己猜或输入密码。密码由浏览器直接填进网页，不会返回给你。保险箱里没有这个站点的账号时，请用户在浏览器面板里手动登录一次（登录后自动存入保险箱），或到 全局设置 › 保险箱 添加。',
        parameters: { type: 'object', properties: { username: { type: 'string', description: '该站点保存了多个账号时，指定用哪一个（用返回的账号名）' }, submit: { type: 'boolean', description: '填好后是否点击登录，默认 true' }, ...TAB_PROP } } },
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
        parameters: { type: 'object', properties: { expression: { type: 'string' }, ...TAB_PROP }, required: ['expression'] } },
    { name: 'browser_scrape', kind: 'read', description: '智能提取网页数据（优先使用 Scrapling 隐身引擎抗反爬，并支持复用当前 Dragon 浏览器标签页提取已登录页面的真实 DOM）。支持按 CSS 选择器、XPath 提取特定数据或正文表格。',
        parameters: { type: 'object', properties: { url: { type: 'string', description: '要抓取的网页地址。不传或 fromCurrentTab=true 时，直接复用当前 Dragon 浏览器标签页已加载的内容（保留登录态与 Cookie）。' }, css: { type: 'string', description: 'CSS 选择器，例如 "article h2", "table tr", ".content" 等' }, xpath: { type: 'string', description: 'XPath 表达式' }, fromCurrentTab: { type: 'boolean', description: '是否从当前 Dragon 浏览器标签页提取（抓取需要登录的内部系统时使用）' }, mode: { type: 'string', enum: ['markdown', 'text', 'json'], description: '输出格式，默认 markdown' }, maxChars: { type: 'integer', description: '最多返回字数，默认 40000' }, ...TAB_PROP } } }
];
const KIND = new Map(DEFINITIONS.map(item => [item.name, item.kind]));

function formatSize(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

const browserLocks = new Map();
function serialized(owner, job) {
    const previous = browserLocks.get(owner) || Promise.resolve();
    const running = previous.catch(()=>{}).then(job);
    browserLocks.set(owner, running);
    return running.finally(()=>{if(browserLocks.get(owner)===running)browserLocks.delete(owner);});
}
const MANUAL_IDLE_MS = 5 * 60 * 1000;
function operatorState(owner,page){
    const state=owners.get(owner),manual=state?.manual;
    return {active:activeCommands.has(owner),manual:Boolean(manual),handoff:Boolean(manual?.handoff),expiresAt:manual?.autoIdleMs?manual.touched+manual.autoIdleMs:null,cursor:page?.aiCursor||null};
}
function publishOperator(owner){const state=owners.get(owner);if(state)for(const page of state.tabs.values())page.publishOperator?.(operatorState(owner,page));}
function manualSession(state) {
    if(state?.manual&&Date.now()-state.manual.touched>(state.manual.autoIdleMs||MANUAL_IDLE_MS)){
        clearTimeout(state.manual.timer);
        for(const page of state.tabs.values()){page.pointerInput?.('cancel').catch(()=>{});page.setManualControl?.(false);}
        state.pointer=null;state.manual=null;
        for(const[owner,item]of owners)if(item===state)publishOperator(owner);
    }
    return state?.manual||null;
}
function armHandoff(owner,state){
    const manual=state.manual;if(!manual?.autoIdleMs)return;
    clearTimeout(manual.timer);manual.timer=setTimeout(()=>manualSession(state),Math.max(1,manual.touched+manual.autoIdleMs-Date.now()+5));manual.timer.unref?.();publishOperator(owner);
}
async function execute(ctx,name,args={}){
    // 自动交接期间的工具等待控制权；已发出的动作被停止后不自动重放。
    let waited=false;
    while(manualSession(owners.get(ctx.owner))?.autoIdleMs){
        waited=true;
        if(ctx.signal?.aborted)return {content:'任务已停止',summary:'已停止',isError:true};
        await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(waited&&(KIND.get(name)!=='read'||name==='browser_tabs'&&args.action&&args.action!=='list'))return {content:'人工操作已结束，页面可能变化。请先 browser_snapshot，再决定下一步，不要重放旧动作。',summary:'请重新读取页面',isError:true};
    return serialized(ctx.owner,async()=>{
        if(takeoverPending.has(ctx.owner)||manualSession(owners.get(ctx.owner)))return {content:'用户正在操作浏览器。交还后先 browser_snapshot 读取当前页面再继续。',summary:'用户操作中',isError:true};
        const controller=new AbortController();controller.toolName=name;activeCommands.set(ctx.owner,controller);publishOperator(ctx.owner);
        const abort=()=>controller.abort();ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)controller.abort();
        try{return maskVaultSecrets(ctx.owner,await commandContext.run({owner:ctx.owner,signal:controller.signal},()=>cancellable(executeUnlocked(ctx,name,args))));}
        catch(error){return {content:`错误（${error.code||'BROWSER_FAILED'}）：${error.message}`,summary:'浏览器操作已停止',isError:true};}
        finally{ctx.signal?.removeEventListener('abort',abort);if(activeCommands.get(ctx.owner)===controller)activeCommands.delete(ctx.owner);publishOperator(ctx.owner);}
    });
}

async function executeUnlocked(ctx, name, args = {}) {
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
        if (name === 'browser_scrape') {
            const scrapling = require('./scrapling-service');
            const targetUrl = args.url ? webUrl(args.url) : null;
            const useCurrentTab = args.fromCurrentTab === true || !targetUrl || Boolean(args.tabId);

            if (useCurrentTab) {
                const active = await activePage(owner, args.tabId);
                const html = await active.evaluate('document.documentElement.outerHTML');
                await active.refreshInfo();
                if (scrapling.available()) {
                    const parsed = await scrapling.parseHtml({
                        html,
                        css: args.css,
                        xpath: args.xpath,
                        mode: args.mode,
                        maxChars: args.maxChars
                    });
                    return {
                        content: `[Dragon 浏览器复用提取] 当前页面：${active.title || '（无标题）'}\n网址：${active.url}\n${parsed.count ? `匹配数量：${parsed.count}\n` : ''}\n${parsed.text}`,
                        summary: `从当前标签页抓取 ${parsed.count ? `${parsed.count} 项` : active.title}`.slice(0, 120)
                    };
                }
                const snap = await active.snapshot(args.maxChars);
                return {
                    content: `[Dragon 浏览器快照提取] 页面：${active.title}\n网址：${active.url}\n\n${snap.text}`,
                    summary: `标签页提取：${active.title}`.slice(0, 120)
                };
            }

            if (scrapling.available()) {
                try {
                    const res = await scrapling.fetchUrl({
                        url: targetUrl,
                        css: args.css,
                        xpath: args.xpath,
                        mode: args.mode,
                        maxChars: args.maxChars
                    });
                    return {
                        content: `[Scrapling 快速隐身抓取] 状态：${res.status} · ${res.title || targetUrl}\n网址：${res.url}\n${res.count ? `匹配项数：${res.count}\n` : ''}\n${res.text}`,
                        summary: `隐身抓取：${res.title || res.url}`.slice(0, 120)
                    };
                } catch (fetchErr) {
                    // 快速抓取失败，后续回退浏览器
                }
            }

            // 当 Scrapling 未安装或快速抓取失败时，尝试内置 fetch 快速抓取静态内容
            try {
                const fetchRes = await fetch(targetUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
                    signal: AbortSignal.timeout(8000)
                });
                if (fetchRes.ok) {
                    const html = await fetchRes.text();
                    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                    const title = titleMatch ? titleMatch[1].trim() : '';
                    let matchedText = '';
                    if (args.css) {
                        const tagMatch = args.css.match(/^([a-z0-9_-]+)/i);
                        if (tagMatch) {
                            const re = new RegExp(`<${tagMatch[1]}[^>]*>([\\s\\S]*?)<\\/${tagMatch[1]}>`, 'gi');
                            const matches = [];
                            let m;
                            while ((m = re.exec(html)) !== null) {
                                const clean = m[1].replace(/<[^>]+>/g, '').trim();
                                if (clean) matches.push(clean);
                            }
                            matchedText = matches.join('\n');
                        }
                    }
                    if (!matchedText) {
                        matchedText = html
                            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                    }
                    if (matchedText) {
                        return {
                            content: `[快速网页抓取] 状态：${fetchRes.status} · ${title || targetUrl}\n网址：${targetUrl}\n\n${matchedText.slice(0, args.maxChars || 40000)}`,
                            summary: `抓取：${title || targetUrl}`.slice(0, 120)
                        };
                    }
                }
            } catch (_) {}

            // 若需使用 Dragon 浏览器打开，开新标签页并保留原激活标签页
            const state = stateFor(owner);
            const prevActive = state.active;
            const { page: directPage } = await openPage(owner, targetUrl, true);
            const snap = await directPage.snapshot(args.maxChars);
            if (prevActive) state.active = prevActive;
            return {
                content: `[Dragon 浏览器打开提取] 页面：${directPage.title}\n网址：${directPage.url}\n\n${snap.text}`,
                summary: `打开并提取：${directPage.title}`.slice(0, 120)
            };
        }
        const page = await activePage(owner, args.tabId);
        if (name === 'browser_snapshot') {
            const snap = await page.snapshot(args.maxChars);
            await page.refreshInfo();
            return { content: `${snap.text}${snap.truncated ? '\n…（内容过长已截断：可调大 maxChars，或用 browser_network 直接取接口数据）' : ''}`, summary: `${page.title || page.url} · ${snap.refs} 个可操作元素`.slice(0, 120) };
        }
        if (name === 'browser_click') {
            const browser = owners.get(owner)?.browser;
            const previous = browser?.downloads?.()[0]?.id;
            const box = await page.click(args.ref);
            await page.refreshInfo();
            const download = browser?.downloads?.()[0];
            const result = download && download.id !== previous
                ? download.state === 'completed' ? '\n浏览器已收到文件，可在侧栏「下载」中保存到本机。'
                    : '\n浏览器收到下载请求，可在侧栏「下载」中查看状态。'
                : '';
            return { content: `已点击 ${args.ref}「${box.text}」，当前页面：${page.title}\n${page.url}\n页面可能已变化，继续操作前用 browser_snapshot 重新读取。${result}`, summary: `点击「${box.text}」`.slice(0, 120) };
        }
        if (name === 'browser_type') {
            const box = await page.type(args.ref, args.text, args.submit === true);
            await page.refreshInfo();
            return { content: `已在 ${args.ref}「${box.text}」输入${args.submit ? '并提交' : ''}，当前页面：${page.title}\n${page.url}`, summary: `输入${args.submit ? '并提交' : ''}` };
        }
        if (name === 'browser_login') {
            await page.refreshInfo();
            const state = owners.get(owner);
            if (state) state.vaultSecrets ||= new Set();
            const navigated = page.waitFor(method => method === 'Page.frameNavigated' || method === 'Page.loadEventFired', 8000).catch(() => false);
            const outcome = await browserVault.login({ cdp: page.cdp, url: page.url, owner, username: args.username ? String(args.username) : '', submit: args.submit !== false, secrets: state?.vaultSecrets });
            if (outcome.status === 'no-credentials') return { content: `保险箱里没有 ${outcome.origin} 的账号。请让用户在浏览器面板里手动登录一次（登录后会自动存入保险箱），或到「全局设置 › 保险箱」添加；不要向用户索要密码。`, summary: '保险箱没有该站点账号', isError: true };
            if (outcome.status === 'choose-account') return { content: `保险箱里 ${outcome.origin} 有多个账号：${outcome.accounts.join('、')}。请用 username 参数指定一个（不确定时先问用户）。`, summary: '需要选择账号', isError: true };
            if (outcome.status === 'no-form') return { content: `当前页面没有找到登录表单（${page.url}）。先打开登录页，或用 browser_snapshot 确认页面状态。`, summary: '未找到登录表单', isError: true };
            if (outcome.status === 'submitted') { await navigated; await page.settle?.().catch(() => {}); }
            await page.refreshInfo();
            const stillLogin = outcome.status === 'submitted' ? await page.evaluate(`[...document.querySelectorAll('input[type="password"]')].some(el=>el.getClientRects().length>0)`).catch(() => false) : false;
            const tail = outcome.status === 'needs-verification' ? '页面还需要验证码或其他验证，账号密码已填好但没有提交：请用户在浏览器面板里完成验证后登录。'
                : outcome.status === 'filled' ? '账号密码已填好，未提交。'
                : stillLogin ? '已提交，但页面仍显示登录表单：可能密码已失效或需要额外验证，请让用户在浏览器面板里处理，不要反复重试。'
                : '已提交登录。';
            return { content: `已用保险箱账号 ${outcome.username} 填写${outcome.status === 'submitted' ? '并提交' : ''}（密码未向你提供）。${tail}\n当前页面：${page.title}\n${page.url}`, summary: `保险箱登录 ${outcome.username}` };
        }
        if (name === 'browser_scroll') {
            await page.scroll(args.direction);
            return { content: '已滚动，用 browser_snapshot 读取新内容。', summary: args.direction === 'up' ? '向上滚动' : '向下滚动' };
        }
        if (name === 'browser_wait') {
            const timeout = Math.min(30000, Math.max(100, Number(args.timeoutMs) || 10000));
            if (!args.text) { await pause(timeout); return { content: `已等待 ${timeout}ms`, summary: `等待 ${timeout}ms` }; }
            const until = Date.now() + timeout;
            const needle = JSON.stringify(String(args.text));
            while (Date.now() < until) {
                if(commandSignal()?.aborted)throw interrupted();
                if (await page.evaluate(`document.body && document.body.innerText.includes(${needle})`).catch(() => false)) return { content: `页面已出现「${args.text}」`, summary: '已出现' };
                await pause(300);
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
            // 保险箱填入的密码还留在页面输入框里时不执行脚本：脚本可以把密码换个形式读出来，抹字符串挡不住
            const secrets = owners.get(owner)?.vaultSecrets;
            if (secrets?.size) {
                const typed = await page.evaluate(`[...document.querySelectorAll('input[type="password"]')].map(el=>el.value).filter(Boolean)`).catch(() => []);
                if (Array.isArray(typed) && typed.some(value => secrets.has(value))) {
                    return { content: '页面的密码框里还有保险箱填入的密码，这时不能执行页面脚本。先完成登录（browser_login），或请用户在浏览器面板里处理后再试。', summary: '密码未提交，脚本未执行', isError: true };
                }
            }
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
    if(manualSession(owners.get(ctx.owner)))return {title:'等待用户交还浏览器',fields:[{label:'状态',value:'用户正在操作页面，交还后先重新读取页面'}]};
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
    if (name === 'browser_login') {
        const page = await activePage(ctx.owner, args.tabId);
        await page.refreshInfo();
        const accounts = await require('./password-vault').vault().find(browserVault.vaultOwnerOf(ctx.owner), page.url).catch(() => []);
        return { title: '用保险箱账号登录', impact: '密码由浏览器直接填入网页，不会发给模型', fields: [{ label: '页面', value: `${page.title}\n${page.url}` },
            { label: '账号', value: accounts.length ? accounts.map(item => require('./password-vault').maskUsername(item.username)).join('、') : '保险箱里没有该站点的账号' }] };
    }
    if (name === 'browser_evaluate') {
        const page = await activePage(ctx.owner, args.tabId);
        await page.refreshInfo();
        return { title: '在网页执行脚本', fields: [{ label: '页面', value: `${page.title}\n${page.url}` }], command: String(args.expression || '') };
    }
    if (name === 'browser_scrape') {
        const fields = [];
        if (args.url && !args.fromCurrentTab) fields.push({ label: '目标网址', value: String(args.url) });
        else fields.push({ label: '提取来源', value: '复用 Dragon 浏览器当前标签页' });
        if (args.css) fields.push({ label: 'CSS 选择器', value: String(args.css) });
        if (args.xpath) fields.push({ label: 'XPath', value: String(args.xpath) });
        return { title: '智能抓取网页数据', fields };
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

// 一个账号一套浏览器标签：人工与 AI 共用，画面读取本身不启动浏览器。
async function viewUnlocked(owner, live = false) {
    const state=owners.get(owner);
    if(!state)return {available:false,tabs:[],manual:{active:false}};
    const pages=liveTabs(state),manual=manualSession(state);
    await Promise.all([...pages.values()].map(page=>page.refreshInfo()));
    const page=pages.get(state.active);
    const vaultNotice=state.vaultNotice&&Date.now()-state.vaultNotice.at<15000?state.vaultNotice:null;
    const result={available:Boolean(page),activeId:page?.id||null,kind:state.browser.kind,...(vaultNotice?{vault:vaultNotice}:{}),
        tabs:[...pages.values()].map(item=>({id:item.id,title:item.title,url:item.url})),
        operator:operatorState(owner,page),manual:manual?{active:true,tabId:manual.tabId,expiresAt:manual.touched+(manual.autoIdleMs||MANUAL_IDLE_MS)}:{active:false}};
    if (state.browser.downloads) result.downloads = state.browser.downloads();
    if(!page)return result;
    if(state.browser.kind==='server'&&page.readingUrl!==page.url){
        if(page.readingWidth)await page.setReadingWidth?.(null);
        page.readingWidth=null;page.layoutMeasuredAt=0;page.readingUrl=page.url;
    }
    if(!activeCommands.has(owner)&&!state.pointer&&(!page.layoutMeasuredAt||Date.now()-page.layoutMeasuredAt>2000)){
        page.layout=await page.evaluate?.(pageLayoutScript).catch(()=>null);page.layoutMeasuredAt=Date.now();
        if(state.browser.kind==='server'&&!page.readingWidth&&page.layout?.preferredWidth){
            await page.setReadingWidth?.(page.layout.preferredWidth);
        }
    }
    const viewport=await page.evaluate?.('({width:innerWidth,height:innerHeight})')||{width:1280,height:900};
    const layout=page.readingWidth?{...page.layout,preferredWidth:page.readingWidth}:page.layout;
    const documentId=page.documentId,capturedUrl=page.url;
    const png=await page.screenshot(false,live);
    if(png.length>8*1024*1024)throw browserError('BROWSER_VIEW_TOO_LARGE','页面画面过大，请缩小浏览器视口后重试');
    const frameId=crypto.randomUUID();state.frames||=new Map();
    state.frames.set(frameId,{tabId:page.id,url:capturedUrl,documentId,viewport,at:Date.now()});
    while(state.frames.size>80)state.frames.delete(state.frames.keys().next().value);
    return {...result,tabId:page.id,title:page.title,url:page.url,upload:page.pendingUpload?.()||null,image:`data:image/${live?'jpeg':'png'};base64,${png.toString('base64')}`,
        capturedAt:new Date().toISOString(),documentId,frameId,viewport,zoom:page.zoom||1,layout:layout||null,...await page.historyState?.()};
}
function view(owner,live=false){return commandContext.exit(()=>activeCommands.has(owner)?viewUnlocked(owner,live):serialized(owner,()=>viewUnlocked(owner,live)));}
function controlRequest(owner,args={}){
    const interruptedAI=args.action==='takeover'&&activeCommands.has(owner);
    let stopping=Promise.resolve();
    if(args.action==='takeover'){
        const manual=manualSession(owners.get(owner));
        if(manual&&manual.token!==args.token)return Promise.reject(browserError('BROWSER_CONTROL_BUSY','另一端正在操作浏览器'));
        takeoverPending.add(owner);const running=activeCommands.get(owner);running?.abort();
        stopping=Promise.all([...owners.get(owner)?.tabs.values()||[]].map(page=>page.stopAI?.(running?.toolName==='browser_evaluate').catch(()=>{})));
    }
    return serialized(owner,async()=>{
        let createdManual=null,state;
        try {
        await stopping;
        if(typeof owner!=='string'||!owner)throw browserError('BROWSER_OWNER','无法确定账号');
        const action=args.action;
        if(!['acquire','takeover','activity','release','heartbeat','open','new-tab','select-tab','close-tab','move-tab','back','forward','reload','click','scroll','type','key','upload','file-drop','pointer','zoom'].includes(action))throw browserError('BROWSER_CONTROL_INVALID','无效的浏览器操作');
        let url=null;
        if(action==='open'){
            url=webUrl(args.url);
            if(!url||new URL(url).username||new URL(url).password)throw browserError('BROWSER_CONTROL_INVALID','请输入 HTTP 或 HTTPS 网址');
        }
        // 仅用户明确打开网址/新标签时创建浏览器；查看画面、接管、输入都不会偷偷创建。
        state=owners.get(owner);
        if(!state&&(action==='open'||action==='new-tab'))state=stateFor(owner);
        if(!state){if(action==='release')return {mode:'ai'};throw browserError('BROWSER_NO_TAB','请先输入网址或让 AI 打开网页');}
        const pages=liveTabs(state);
        let page=pages.get(state.active),manual=manualSession(state);
        const acquiring=['acquire','takeover','open','new-tab'].includes(action);
        if(acquiring){
            if(manual&&manual.token!==args.token)throw browserError('BROWSER_CONTROL_BUSY','另一端正在手动接管');
            if(['acquire','takeover'].includes(action)&&!page)throw browserError('BROWSER_NO_TAB','请先输入网址或让 AI 打开网页');
            state.manual=manual||{token:crypto.randomUUID(),tabId:page?.id||null};if(!manual)createdManual=state.manual;manual=state.manual;
        }else if(action==='release'&&!manual)return {mode:'ai'};
        if(!manual||typeof (acquiring?manual.token:args.token)!=='string'||(!acquiring&&manual.token!==args.token))throw browserError('BROWSER_CONTROL_REQUIRED','请先手动接管，或重新接管已过期的会话');
        if(action==='release'){
            clearTimeout(manual.timer);
            for(const item of pages.values()){await item.pointerInput?.('cancel');item.setManualControl?.(false);}
            state.pointer=null;state.manual=null;state.frames?.clear();publishOperator(owner);return {mode:'ai'};
        }
        if(action==='takeover'){manual.autoIdleMs=AUTO_HANDOFF_MS;if(interruptedAI)manual.handoff=true;}
        if(action!=='heartbeat')manual.touched=Date.now();armHandoff(owner,state);stateFor(owner); // 有效人工操作延长已有浏览器的闲置期限。
        for(const item of pages.values()){item.setManualControl?.(true);if(state.browser.kind!=='desktop')await item.prepareManual?.();}
        if(state.pointer&&!['pointer','heartbeat'].includes(action)){for(const item of pages.values())await item.pointerInput?.('cancel');state.pointer=null;}
        const reply=()=>({mode:'manual',...(acquiring?{token:manual.token}:{}),tabId:manual.tabId});
        if(['heartbeat','activity','acquire','takeover'].includes(action))return reply();
        if(action==='new-tab'||(action==='open'&&!page)){
            if(pages.size>=LIMITS.tabs)throw browserError('BROWSER_CONTROL_LIMIT',`最多同时打开 ${LIMITS.tabs} 个标签，请先关闭一个`);
            page=await state.browser.newPage();pages.set(page.id,page);state.active=page.id;manual.tabId=page.id;page.setManualControl?.(true);
            if(action==='new-tab'){await page.refreshInfo();return reply();}
        }
        if(action==='move-tab'){
            const target=pages.get(String(args.tabId)),index=Number(args.index);
            if(!target||!Number.isInteger(index)||index<0||index>=pages.size)throw browserError('BROWSER_CONTROL_INVALID','无效的标签位置');
            const ordered=[...pages.values()].filter(item=>item!==target);ordered.splice(index,0,target);state.tabs=new Map(ordered.map(item=>[item.id,item]));return reply();
        }
        if(action==='select-tab'||action==='close-tab'){
            const target=pages.get(String(args.tabId));
            if(!target)throw browserError('BROWSER_VIEW_STALE','标签页已关闭，请刷新后重试');
            if(action==='select-tab')state.active=target.id;
            else {await target.close();pages.delete(target.id);if(state.active===target.id)state.active=[...pages.keys()].at(-1)||null;}
            manual.tabId=state.active;state.frames?.clear();return reply();
        }
        if(!page||page.id!==manual.tabId)throw browserError('BROWSER_VIEW_STALE','当前标签已变化，请刷新画面后重新接管');
        await page.refreshInfo();
        if(action==='open'){await page.navigate(url);state.frames?.clear();return reply();}
        if(action==='zoom'){
            const level=Number(args.level);
            if(!ZOOM_LEVELS.includes(level))throw browserError('BROWSER_CONTROL_INVALID','无效的缩放比例');
            await page.setZoom(level);state.frames?.clear();return {...reply(),zoom:page.zoom};
        }
        if(['back','forward','reload'].includes(action)){await page.historyAction(action);state.frames?.clear();return reply();}
        if(action==='pointer'&&args.phase==='cancel'){
            await page.pointerInput?.('cancel');state.pointer=null;return reply();
        }
        const continuing=action==='pointer'&&args.phase!=='down';
        const frame=continuing?state.pointer?.frame:state.frames?.get(args.frameId);
        if(!frame||frame.tabId!==page.id||frame.url!==page.url||frame.documentId!==page.documentId||(!continuing&&Date.now()-frame.at>15000)||(!['type','key'].includes(action)&&!continuing&&frame.keyboardOnly))throw browserError('BROWSER_VIEW_STALE','画面已变化或过期，请刷新后再操作');
        const currentViewport=await page.evaluate?.('({width:innerWidth,height:innerHeight})');
        if(currentViewport&&(currentViewport.width!==frame.viewport.width||currentViewport.height!==frame.viewport.height))throw browserError('BROWSER_VIEW_STALE','页面尺寸已变化，请刷新后再操作');
        if(action==='pointer'){
            if(!['down','move','up'].includes(args.phase)||typeof args.pointerId!=='string'||!args.pointerId||args.pointerId.length>80)throw browserError('BROWSER_CONTROL_INVALID','无效的拖拽动作');
            if(continuing&&(state.pointer?.id!==args.pointerId||Date.now()-state.pointer.touched>10000))throw browserError('BROWSER_VIEW_STALE','拖拽已结束，请重新拖动');
            if(!Number.isFinite(args.x)||!Number.isFinite(args.y)||args.x<0||args.x>1||args.y<0||args.y>1)throw browserError('BROWSER_CONTROL_INVALID','无效的拖拽位置');
            const point={x:Math.min(frame.viewport.width-1,Math.round(args.x*frame.viewport.width)),y:Math.min(frame.viewport.height-1,Math.round(args.y*frame.viewport.height))};
            if(args.phase==='down')state.pointer={id:args.pointerId,frame,touched:Date.now()};
            else state.pointer.touched=Date.now();
            try{if(args.phase==='up')await page.pointerInput('move',point);await page.pointerInput(args.phase,point);}catch(error){await page.pointerInput('cancel').catch(()=>{});state.pointer=null;throw error;}
            if(args.phase==='up'){state.pointer=null;for(const frame of state.frames.values())if(frame.tabId===page.id)frame.keyboardOnly=true;}
            return reply();
        }
        const input={};
        const point=value=>{
            if(!value||!Number.isFinite(value.x)||!Number.isFinite(value.y)||value.x<0||value.x>1||value.y<0||value.y>1)throw browserError('BROWSER_CONTROL_INVALID','无效的拖拽位置');
            return {x:Math.min(frame.viewport.width-1,Math.round(value.x*frame.viewport.width)),y:Math.min(frame.viewport.height-1,Math.round(value.y*frame.viewport.height))};
        };
        if(action==='upload'||action==='file-drop'){
            // 文件只来自本次请求解析后的内存对象，不接受客户端传入本机路径。
            const files=args._uploads,artifacts=require('./agent-artifacts');
            if(!Array.isArray(files)||!files.length||files.length>artifacts.UPLOAD_LIMITS.files||files.some(file=>!Buffer.isBuffer(file.buffer)||file.buffer.length>artifacts.UPLOAD_LIMITS.fileBytes))throw browserError('BROWSER_CONTROL_INVALID','没有收到文件，单个文件上限 20MB，一次最多 5 个');
            if(action==='upload'&&page.pendingUpload?.()?.id!==args.chooserId)throw browserError('BROWSER_VIEW_STALE','上传控件已变化，请重新点击网页上传按钮');
            const saved=[];
            try{
                for(const file of files)saved.push(await artifacts.saveUpload(owner,file));
                const paths=saved.map(file=>state.browser.localFile?state.browser.localFile(file.path):file.path);
                if(action==='upload')await page.uploadFiles(paths,args.chooserId);
                else await page.manualInput('file-drop',{...point(args),files:paths});
            }catch(error){await Promise.all(saved.map(file=>fs.promises.unlink(file.path).catch(()=>{})));throw error;}
            state.frames.clear();return {...reply(),files:saved.map(file=>({name:file.name,size:file.size}))};
        }
        if(action==='click'||action==='scroll'||action==='file-drop'){
            if(!Number.isFinite(args.x)||!Number.isFinite(args.y)||args.x<0||args.x>1||args.y<0||args.y>1)throw browserError('BROWSER_CONTROL_INVALID','无效的点击位置');
            input.x=Math.min(frame.viewport.width-1,Math.round(args.x*frame.viewport.width));input.y=Math.min(frame.viewport.height-1,Math.round(args.y*frame.viewport.height));
        }
        if(action==='scroll'){
            if(!Number.isFinite(args.deltaY)||Math.abs(args.deltaY)>3000)throw browserError('BROWSER_CONTROL_INVALID','无效的滚动距离');input.deltaY=args.deltaY;
        }
        if(action==='type'){
            if(typeof args.text!=='string'||args.text.length>10000)throw browserError('BROWSER_CONTROL_INVALID','输入内容过长');input.text=args.text;input.replace=args.replace===true;
        }
        if(action==='key'){
            if(!['Enter','Tab','Backspace','Delete','Escape','ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Home','End'].includes(args.key))throw browserError('BROWSER_CONTROL_INVALID','不支持的按键');input.key=args.key;
        }
        await page.manualInput(action,input);for(const frame of state.frames.values())if(frame.tabId===page.id)frame.keyboardOnly=true;return reply();
        } catch(error) {
            if(createdManual&&state?.manual===createdManual){clearTimeout(createdManual.timer);for(const item of state.tabs.values())item.setManualControl?.(false);state.manual=null;}
            throw error;
        }
    }).finally(()=>{if(args.action==='takeover')takeoverPending.delete(owner);});
}

function control(owner,args={}){return commandContext.exit(()=>controlRequest(owner,args));}
function openDownload(owner, id) {
    return owners.get(owner)?.browser.openDownload?.(id);
}

module.exports = { LIMITS, DEFINITIONS, definitions, kindOf: name => KIND.get(name) || null, execute, preview, view, control, openDownload, alwaysKey, available, findChrome, configureDesktopBrowser, webUrl, shutdownAll, _internal: { owners, SNAPSHOT_SCRIPT } };
