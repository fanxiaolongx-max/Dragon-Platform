// Uses the running desktop application's own Chromium connection, never a CLI
// task or a separate model. Every action is bound to its exact conversation ID.
const fs = require('node:fs/promises'), path = require('node:path');
const WebSocket = require('ws');
const { home, safe, antigravityTimestamps, antigravity: localList, antigravityBusyIds: localBusyIds, antigravityTranscript } = require('./catalog');
const { composerText } = require('./composer-text');
const fail = (code, message) => Object.assign(new Error(message), { code });
let probeMemo = { at: 0, ok: false };
async function canConnect() {
    if (Date.now() - probeMemo.at < 2000) return probeMemo.ok;
    try {
        const active = path.join(home(), 'Library/Application Support/Antigravity/DevToolsActivePort');
        const port = Number((await fs.readFile(active, 'utf8')).split('\n')[0]);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) return (probeMemo = { at: Date.now(), ok: false }).ok;
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1200) })).json();
        const ok = Array.isArray(targets) && targets.some(t => t.type === 'page' && /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(t.url));
        probeMemo = { at: Date.now(), ok };
        return ok;
    } catch {
        probeMemo = { at: Date.now(), ok: false };
        return false;
    }
}
async function connect() {
    const active = path.join(home(), 'Library/Application Support/Antigravity/DevToolsActivePort');
    const port = Number((await fs.readFile(active, 'utf8')).split('\n')[0]);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw fail('DESKTOP_UNAVAILABLE', 'Antigravity 桌面连接不可用');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
    const target = targets.find(t => t.type === 'page' && /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(t.url));
    if (!target)
        throw fail('DESKTOP_UNAVAILABLE', '未找到 Antigravity 桌面会话窗口');
    const address = new URL(target.webSocketDebuggerUrl);
    if (address.hostname !== '127.0.0.1' || Number(address.port) !== port)
        throw fail('DESKTOP_UNAVAILABLE', '桌面连接地址无效');
    const socket = new WebSocket(address);
    let sequence = 0;
    const pending = new Map();
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(fail('DESKTOP_TIMEOUT', '桌面连接超时')), 2500); socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = () => { clearTimeout(timer); reject(fail('DESKTOP_UNAVAILABLE', '桌面连接失败')); }; });
    socket.onmessage = event => { let data; try {
        data = JSON.parse(event.data);
    }
    catch {
        return;
    } const p = pending.get(data.id); if (p) {
        clearTimeout(p.timer);
        pending.delete(data.id);
        data.error ? p.reject(fail('DESKTOP_PROTOCOL', '桌面命令未完成')) : p.resolve(data.result);
    } };
    const call = (method, params) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(fail('DESKTOP_TIMEOUT', '桌面未确认，请先查看原会话，避免重复发送')); }, 6000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
    return { call, async evaluate(expression) { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails)
            throw fail('DESKTOP_PROTOCOL', '桌面页面结构已变化，请更新连接器'); return r.result?.value; }, close() { for (const p of pending.values()) {
            clearTimeout(p.timer);
            p.reject(fail('DESKTOP_UNAVAILABLE', '桌面连接关闭'));
        } pending.clear(); socket.close(); } };
}
let operationTail=Promise.resolve();
function using(fn){
    const operation=operationTail.then(async()=>{const client=await connect();try{return await fn(client);}finally{client.close();}});
    operationTail=operation.catch(()=>{});return operation;
}
function sidebarTime(value, now=Date.now()) {
    const text=String(value||'').trim();
    if(!text)return null;
    const relative=text.match(/^(\d+)\s*(s|m|h|d|w|mo|y)(?:\s+ago)?$/i);
    if(relative){const unit={s:1000,m:60000,h:3600000,d:86400000,w:604800000,mo:2592000000,y:31536000000};return new Date(now-Number(relative[1])*unit[relative[2].toLowerCase()]).toISOString();}
    if(/^yesterday$/i.test(text)||text==='昨天')return new Date(now-86400000).toISOString();
    if(!/^\d{4}-\d{2}-\d{2}/.test(text))return null;
    const time=Date.parse(text);return Number.isNaN(time)?null:new Date(time).toISOString();
}
async function list(limit) {
    if (typeof localList === 'function') {
        const localRows = await localList(limit);
        if (localRows.length > 0) return localRows;
    }
    return using(async (c) => {
        const rows = await c.evaluate(`Array.from(document.querySelectorAll('[data-testid="conversation-row-sidebar"]')).map((e,i)=>({id:e.getAttribute('data-cascade-id'),title:e.querySelector('a')?.getAttribute('aria-label')||e.querySelector('span.truncate')?.textContent||e.textContent,order:i,time:e.querySelector('time')?.getAttribute('datetime')||Array.from(e.querySelectorAll('span,small')).find(n=>!n.children.length&&/^(?:[0-9]+[ ]*(?:s|m|h|d|w|mo|y)(?: ago)?|Yesterday|昨天)$/.test(n.textContent.trim()))?.textContent})).filter(r=>r.id)`);
        const valid = rows.filter(r => /^[a-f0-9-]{36}$/i.test(r.id)).slice(0, limit);
        const dbTimes = typeof antigravityTimestamps === 'function' ? await antigravityTimestamps(valid.map(r => r.id)) : new Map();
        return valid.map(r => ({
            id: r.id,
            provider: 'antigravity',
            title: safe(r.title),
            updatedAt: dbTimes.get(r.id) || sidebarTime(r.time),
            observedAt: new Date().toISOString(),
            order: r.order,
            source: 'desktop-sidebar'
        }));
    });
}
// 侧栏「运行中」转圈：优先读本地 conversation_summaries.db 的运行态；无本地库时回退到 CDP 侧栏检测
let busyMemo = { at: 0, ids: new Set(), pending: null };
async function busyIds() {
    if (Date.now() - busyMemo.at < 5000) return busyMemo.ids;
    if (typeof localBusyIds === 'function') {
        const local = await localBusyIds();
        if (local) {
            busyMemo = { at: Date.now(), ids: local, pending: null };
            return local;
        }
    }
    if (busyMemo.pending) return busyMemo.pending;
    busyMemo.pending = using(c => c.evaluate(`(()=>{const ids=Array.from(document.querySelectorAll('[data-cascade-id]')).filter(e=>e.querySelector('button[aria-label="Stop execution"]')).map(e=>e.dataset.cascadeId);const m=location.pathname.match(/^\\/c\\/([a-f0-9-]{36})$/i);if(m&&document.querySelector('[data-testid="agent-input-box"] button[aria-label="Stop execution"]'))ids.push(m[1]);return ids;})()`))
        .then(ids => new Set((Array.isArray(ids) ? ids : []).filter(id => /^[a-f0-9-]{36}$/i.test(id))))
        .catch(() => new Set())
        .then(ids => { busyMemo = { at: Date.now(), ids, pending: null }; return ids; });
    return busyMemo.pending;
}
async function select(c, id) {
    const answer = await c.evaluate(`(()=>{if(location.pathname==='/c/'+${JSON.stringify(id)})return 'ready';const input=document.querySelector('[role=combobox][contenteditable=true]');if(input?.innerText.trim())return 'draft';const row=Array.from(document.querySelectorAll('[data-cascade-id]')).find(e=>e.dataset.cascadeId===${JSON.stringify(id)});if(!row)return 'missing';row.querySelector('a')?.click();return 'opening';})()`);
    if (answer === 'draft')
        throw fail('DESKTOP_DRAFT', '桌面输入框有未发送内容，请先在桌面处理');
    if (answer === 'missing')
        throw fail('DESKTOP_UNAVAILABLE', '这个会话已不在桌面侧栏，请在桌面打开后刷新');
    for (let n = 0; n < 30; n++) {
        if (await c.evaluate(`location.pathname==='/c/'+${JSON.stringify(id)}&&!!document.querySelector('[data-testid="agent-input-box"]')`))
            return;
        await new Promise(r => setTimeout(r, 100));
    }
    throw fail('DESKTOP_TIMEOUT', '桌面没有打开指定会话');
}
// Runs inside the Antigravity page. Short answers carry planner-response-text; answers after
// tool use ("Worked for …") are plain markdown blocks beside the collapsed work log, so read
// every assistant block outside those collapsibles and turn the rendered HTML back into Markdown.
function readTimeline() {
    let images = [], remainingImageBytes = 24 * 1024 * 1024;
    const image = node => {
        if (remainingImageBytes <= 0 || images.length >= 30 || !node.complete || !node.naturalWidth || !node.naturalHeight) return false;
        if (node.naturalWidth > 4096 || node.naturalHeight > 4096) return false;
        try {
            // Read already-rendered pixels, including Mermaid SVG data images. Never
            // transfer SVG/HTML or fetch image URLs using platform credentials.
            const canvas = document.createElement('canvas');
            canvas.width = node.naturalWidth; canvas.height = node.naturalHeight;
            canvas.getContext('2d').drawImage(node, 0, 0);
            const data = canvas.toDataURL('image/png').split(',')[1];
            if (!data || data.length > Math.min(8 * 1024 * 1024, remainingImageBytes)) return false;
            remainingImageBytes -= data.length;
            images.push({ type: 'base64', media_type: 'image/png', data });
            return true;
        } catch { return false; } // Cross-origin/undecoded images remain a text placeholder.
    };
    const md = (node) => {
        if (node.nodeType === 3)
            return node.textContent.trim() ? node.textContent : ' ';
        if (node.nodeType !== 1 || /^(STYLE|SCRIPT|svg)$/i.test(node.tagName))
            return '';
        if (node.tagName === 'IMG') return image(node) ? '' : '[' + (node.alt || '图片') + ']';
        if (node.tagName === 'BUTTON') // 文件、链接以按钮形式渲染：保留文字
            return node.innerText.trim() ? '`' + node.innerText.trim() + '`' : '';
        const inner = () => Array.from(node.childNodes).map(md).join('');
        const tag = node.tagName;
        if (/^H[1-6]$/.test(tag))
            return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + inner().trim() + '\n\n';
        if (tag === 'P')
            return '\n\n' + inner().trim() + '\n\n';
        if (tag === 'BR')
            return '\n';
        if (tag === 'STRONG' || tag === 'B')
            return '**' + inner() + '**';
        if (tag === 'EM' || tag === 'I')
            return '*' + inner() + '*';
        if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE')
            return '`' + node.textContent + '`';
        if (tag === 'PRE' && node.querySelector('img')) return '\n\n' + inner() + '\n\n';
        if (tag === 'PRE')
            return '\n\n```\n' + node.innerText.replace(/\n$/, '') + '\n```\n\n';
        if (tag === 'A')
            return '[' + inner() + '](' + node.getAttribute('href') + ')';
        if (tag === 'UL' || tag === 'OL')
            return '\n\n' + Array.from(node.children).map((li, i) => (tag === 'OL' ? (i + 1) + '. ' : '- ') + md(li).trim().replace(/\n+/g, '\n  ')).join('\n') + '\n\n';
        if (tag === 'TABLE') {
            const rows = Array.from(node.querySelectorAll('tr')).map(tr => '| ' + Array.from(tr.children).map(td => md(td).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')).join(' | ') + ' |');
            if (rows.length)
                rows.splice(1, 0, '|' + ' --- |'.repeat(rows[0].split(' | ').length));
            return '\n\n' + rows.join('\n') + '\n\n';
        }
        if (tag === 'BLOCKQUOTE' || node.classList.contains('markdown-alert'))
            return '\n\n' + inner().replace(/\s*\n\s*\n\s*/g, '\n\n').trim().split('\n').map(l => ('> ' + l).trimEnd()).join('\n') + '\n\n';
        return inner();
    };
    const out = [];
    for (const e of document.querySelectorAll('[data-testid="user-message-bubble"],[data-quotable="true"]')) {
        if (e.dataset.testid === 'user-message-bubble') {
            images = [];
            e.querySelectorAll('img').forEach(image);
            out.push({ role: 'user', content: (e.querySelector('[data-quotable="true"]') || e).innerText.trim(), images });
            continue;
        }
        if (e.closest('[data-testid="user-message-bubble"]') || e.parentElement?.closest('[data-quotable="true"]'))
            continue;
        const folded = Array.from(e.querySelectorAll('[data-testid$="collapsible"],[data-testid$="collapsible-trigger"]')).map(b => b.parentElement);
        const blocks = Array.from(e.querySelectorAll('[data-testid="planner-response-text"],.leading-relaxed.select-text')).filter(b => !folded.some(f => f !== e && f.contains(b)) && !b.parentElement.closest('[data-testid="planner-response-text"],.leading-relaxed.select-text'));
        images = [];
        const text = blocks.map(b => md(b).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+(?=\n)/g, '\n').replace(/\n{3,}/g, '\n\n').trim()).filter(Boolean).join('\n\n');
        if (text || images.length)
            out.push({ role: 'assistant', content: text, images });
    }
    return out.slice(-200).map((r, i) => ({ id: String(i), ...r }));
}
// 优先从本机 ~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript_full.jsonl 秒读消息与每轮模型指标；
// 若本地尚无 jsonl（如桌面 fixture 测试），回退到 CDP 窗口 DOM 读取。
const timingMemo = new Map();
async function nativeTiming(id) {
    const previous = timingMemo.get(id);
    if (previous && Date.now()-previous.at < 10000) return previous.promise;
    const promise = using(c => c.evaluate(`(async()=>{
        const rows=[];
        for(let offset=0;offset<10000;){
            const response=await fetch('/exa.language_server_pb.LanguageServerService/GetCascadeTrajectoryGeneratorMetadata',{
                method:'POST',signal:AbortSignal.timeout(3500),headers:{'Content-Type':'application/json','Connect-Protocol-Version':'1','x-codeium-csrf-token':window.__APP_CONFIG__?.csrfToken},
                body:JSON.stringify({cascadeId:${JSON.stringify(id)},generatorMetadataOffset:offset})});
            if(!response.ok)break;
            const data=await response.json(),page=data.generatorMetadata||[];
            if(!page.length)break;
            for(const item of page){const m=item.chatModel,u=m?.usage;
                if(!u)continue;
                // Whitelist in the native page: credentials, prompts, headers and model output never cross CDP.
                rows.push({steps:(item.stepIndices||[]).filter(Number.isSafeInteger),ttft:m.timeToFirstToken,stream:m.streamingDuration,input:u.inputTokens??0,output:u.outputTokens??0,thinking:u.thinkingOutputTokens??0,cache:u.cacheReadTokens??0});
            }
            offset+=page.length;
        }
        return rows;
    })()`)).catch(()=>[]);
    timingMemo.set(id,{at:Date.now(),promise});
    if(timingMemo.size>50)timingMemo.delete(timingMemo.keys().next().value);
    return promise;
}
async function messages(id, { passive = false } = {}) {
    if (typeof antigravityTranscript === 'function') {
        const local = await antigravityTranscript(id);
        if (local) {
            if (!await canConnect()) return local;
            return require('./native-timing').enrichAntigravity(local,await nativeTiming(id));
        }
    }
    return using(async (c) => { if (passive && !await c.evaluate(`location.pathname==='/c/'+${JSON.stringify(id)}`)) {
    const busy = await c.evaluate(`!!Array.from(document.querySelectorAll('[data-cascade-id]')).find(e=>e.dataset.cascadeId===${JSON.stringify(id)})?.querySelector('button[aria-label="Stop execution"]')`);
    return { available: true, stale: true, busy, items: null };
} if (!passive)
    await select(c, id); const rows = await c.evaluate(`location.pathname==='/c/'+${JSON.stringify(id)}?(${readTimeline.toString()})():null`); if (!rows)
    throw fail('DESKTOP_TARGET_UNCONFIRMED', '桌面会话已切换，请重新打开记录'); const busy=await c.evaluate(`location.pathname!=='/c/'+${JSON.stringify(id)}||!!document.querySelector('[data-testid="agent-input-box"] button[aria-label="Stop execution"]')||!!Array.from(document.querySelectorAll('[data-cascade-id]')).find(e=>e.dataset.cascadeId===${JSON.stringify(id)})?.querySelector('button[aria-label="Stop execution"]')`); return { available: true, busy, items: await Promise.all(rows.map(async ({ images, ...row }) => {
        const attachments = [];
        for (const source of images || []) {
            try { const file = await require('./inline-images').materialize(source); if (file) attachments.push({ path: file, name: `Antigravity-${attachments.length + 1}.png` }); }
            catch { /* Cache failures must not hide conversation text. */ }
        }
        return { ...row, content: safe(row.content, 40000), ...(attachments.length ? { attachments } : {}), createdAt: null };
    })) }; });
}
// Lexical needs a real keyboard input sequence. CDP insertText alone can update
// its document while the parent's isInputEmpty state stays true indefinitely.
async function typeText(c, text) {
    await c.call('Input.insertText', { text });
}
async function syncKeyboardState(c, route, text) {
    // Complete one ordinary keyboard edit at the current insertion caret. The
    // space is removed only if focus, route and the exact resulting draft match.
    const before = await c.evaluate(`(() => {
        const input=document.querySelector('[role=combobox][contenteditable=true]');
        if(location.pathname!==${JSON.stringify(route)}||input!==document.activeElement||(${composerText.toString()})(input.innerText)!==${JSON.stringify(composerText(text))})return null;
        const selection=window.getSelection();
        if(!selection?.isCollapsed||!input.contains(selection.anchorNode))return null;
        const range=document.createRange();range.selectNodeContents(input);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
        return true;
    })()`);
    if(before===null)return;
    await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});
    await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    // Lexical may move a trailing paragraph break after the typed space. Verify
    // the exact prepared content AND the space immediately before the caret,
    // rather than relying on innerText's presentation of trailing blank lines.
    const unchanged=await c.evaluate(`(() => {
        const input=document.querySelector('[role=combobox][contenteditable=true]'),selection=window.getSelection();
        if(location.pathname!==${JSON.stringify(route)}||input!==document.activeElement||(${composerText.toString()})(input.innerText)!==${JSON.stringify(composerText(text))}||!selection?.isCollapsed)return false;
        const node=selection.anchorNode,offset=selection.anchorOffset;
        if(!node||node.nodeType!==3||!input.contains(node)||offset<1||![' ',String.fromCharCode(160)].includes(node.textContent[offset-1]))return false;
        const tail=document.createRange();tail.selectNodeContents(input);tail.setStart(node,offset);
        return !tail.toString().trim();
    })()`);
    if(!unchanged)throw fail('DESKTOP_TARGET_UNCONFIRMED','Antigravity 输入内容已改变，未发送；请核对草稿');
    await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
}
// Readiness is asynchronous: never infer acceptance from visible text alone.
// Re-check the route, unique composer, exact text and native enabled state at
// the moment of the single click. A matching unsent draft can be resumed.
async function submitPrepared(c, route, text) {
    for (let n = 0; n < 40; n++) {
        const result = await c.evaluate(`(() => {
            if (location.pathname !== ${JSON.stringify(route)}) return 'changed';
            const inputs = document.querySelectorAll('[role=combobox][contenteditable=true]');
            const input = inputs[0], button = document.querySelector('[data-testid="send-button"]');
            if (inputs.length !== 1 || (${composerText.toString()})(input.innerText) !== ${JSON.stringify(composerText(text))}) return 'changed';
            if (document.querySelector('[data-testid="agent-input-box"] button[aria-label="Stop execution"]')) return 'busy';
            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return 'waiting';
            button.click(); return 'submitted';
        })()`);
        if (result === 'submitted') return;
        if (result === 'changed') throw fail('DESKTOP_TARGET_UNCONFIRMED', 'Antigravity 会话或输入内容已改变，未发送；草稿已保留');
        if (result === 'busy') throw fail('DESKTOP_BUSY', 'Antigravity 正在处理消息，未重复提交');
        if(n===2)await syncKeyboardState(c,route,text);
        await new Promise(r => setTimeout(r, 100));
    }
    throw fail('DESKTOP_INPUT_NOT_READY', 'Antigravity 尚未接受输入，发送按钮未就绪；草稿已保留，可稍后重试');
}
// Only inspect native model options; never serialize the rest of the desktop DOM.
function nativeModelName(s) {
    return String(s || '').replace(/^Select model, current:\s*/i,'').trim().replace(/\s+/g, ' ').replace(/\s+(New|Notice)$/i, '')
        .replace(/\s+\(?(Low|Medium|High|Extra High|Minimal|Default)\)?$/i,'');
}
function nativeModelOptions() {
    const clean = nativeModelName;
    return [...document.querySelectorAll('[role="menuitemradio"],[role="menuitem"],[role="option"]')]
        .filter(e => !e.matches('[aria-disabled="true"],:disabled'))
        .map(e => ({ id: clean(e.innerText), name: clean(e.innerText) }))
        .filter(m => /^(Gemini|Claude|GPT|Grok)\b/i.test(m.id));
}
async function modelMenu(c, model = '', route = null) {
    const opened = await c.evaluate(`(()=>{if(${JSON.stringify(route)}&&location.pathname!==${JSON.stringify(route)})return false;const b=document.querySelector('button[aria-label^="Select model, current:"]');if(!b)return false;b.click();return true})()`);
    if (!opened) throw fail('DESKTOP_MODEL_UNAVAILABLE', '未找到 Antigravity 模型选择器');
    try {
        let models = [];
        for (let n=0;n<10&&!models.length;n++) { models=await c.evaluate(`(()=>{const nativeModelName=${nativeModelName.toString()};return (${nativeModelOptions.toString()})()})()`); if(!models.length)await new Promise(r=>setTimeout(r,100)); }
        if (!model) return models;
        if (!models.some(m=>m.id===model)) throw fail('DESKTOP_MODEL_UNAVAILABLE','Antigravity 当前不提供这个模型，消息未发送');
        const selected=await c.evaluate(`(()=>{if(location.pathname!==${JSON.stringify(route)})return false;const clean=${nativeModelName.toString()};const options=[...document.querySelectorAll('[role="menuitemradio"],[role="menuitem"],[role="option"]')].filter(e=>clean(e.innerText)===${JSON.stringify(model)}&&!e.matches('[aria-disabled="true"],:disabled'));if(options.length!==1)return false;options[0].click();return true})()`);
        if(!selected)throw fail('DESKTOP_MODEL_UNCONFIRMED','Antigravity 模型选项已变化，消息未发送');
    } finally {
        await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    }
    for(let n=0;n<10;n++){
        if(await c.evaluate(`location.pathname===${JSON.stringify(route)}&&(${nativeModelName.toString()})(document.querySelector('button[aria-label^="Select model, current:"]')?.getAttribute('aria-label'))===${JSON.stringify(model)}`))return;
        await new Promise(r=>setTimeout(r,100));
    }
    throw fail('DESKTOP_MODEL_UNCONFIRMED','Antigravity 未确认模型切换，消息未发送');
}
const models = () => using(c=>modelMenu(c));
async function send(id, text, model = '') {
    return using(async (c) => {
        await select(c, id);
        // Empty composers may show voice controls instead of a send button.
        // Check the composer now; submitPrepared waits for the button after typing.
        const ready = await c.evaluate(`(()=>{if(location.pathname!=='/c/'+${JSON.stringify(id)})return 'missing';const inputs=document.querySelectorAll('[role=combobox][contenteditable=true]'),input=inputs[0];if(inputs.length!==1)return 'missing';if(document.querySelector('[data-testid="agent-input-box"] button[aria-label="Stop execution"]')||Array.from(document.querySelectorAll('[data-cascade-id]')).find(e=>e.dataset.cascadeId===${JSON.stringify(id)})?.querySelector('button[aria-label="Stop execution"]'))return 'busy';if(input.innerText.trim()&&(${composerText.toString()})(input.innerText)!==${JSON.stringify(composerText(text))})return 'draft';input.focus();return input.innerText.trim()?'prepared':'ready';})()`);
        if (!['ready', 'prepared'].includes(ready))
            throw fail(ready === 'busy' ? 'DESKTOP_BUSY' : ready === 'draft' ? 'DESKTOP_DRAFT' : 'DESKTOP_INPUT_NOT_READY', ready === 'busy' ? '原会话正在运行，请等待当前回复结束' : ready === 'draft' ? '桌面输入框有未发送内容，请先在桌面处理' : '未找到唯一的桌面输入框，请等待会话加载完成后重试');
        if(model)await modelMenu(c,model,'/c/'+id);
        await c.evaluate(`document.querySelector('[role=combobox][contenteditable=true]')?.focus()`);
        const beforeCount = await c.evaluate(`Array.from(document.querySelectorAll('[data-testid="user-message-bubble"]')).filter(e=>(${composerText.toString()})((e.querySelector('[data-quotable="true"]')||e).innerText)===${JSON.stringify(composerText(text))}).length`);
        if (ready === 'ready') await typeText(c, text);
        await submitPrepared(c, '/c/' + id, text);
        // A button click is not a delivery receipt. Wait for the user message in the
        // timeline, bound to this conversation, without attempting a second send.
        for (let n = 0; n < 40; n++) {
            if (await c.evaluate(`location.pathname==='/c/'+${JSON.stringify(id)}&&Array.from(document.querySelectorAll('[data-testid="user-message-bubble"]')).filter(e=>(${composerText.toString()})((e.querySelector('[data-quotable="true"]')||e).innerText)===${JSON.stringify(composerText(text))}).length>${beforeCount}`))
                return { accepted: true };
            await new Promise(r => setTimeout(r, 100));
        }
        throw fail('DELIVERY_UNKNOWN', '已提交到桌面但未收到确认，请核对原会话后再决定是否重发');
    });
}
async function createAndSend(text, { model = '' } = {}) {
    return using(async c=>{
        const before=await c.evaluate(`Array.from(document.querySelectorAll('[data-cascade-id]')).map(e=>e.dataset.cascadeId)`);
        const ready=await c.evaluate(`(()=>{const input=document.querySelector('[role=combobox][contenteditable=true]');if(input?.innerText.trim()){if(location.pathname==='/'&&(${composerText.toString()})(input.innerText)===${JSON.stringify(composerText(text))}){input.focus();return 'prepared';}return 'draft';}const button=document.querySelector('[data-testid="new-conversation-button"]');if(!button)return 'missing';button.click();return 'opening';})()`);
        if(!['opening','prepared'].includes(ready))throw fail('DESKTOP_DRAFT',ready==='draft'?'Antigravity 输入框有未发草稿，未覆盖':'没有找到 Antigravity 新建对话按钮');
        let opened=ready==='prepared';
        for(let n=0;!opened&&n<30;n++){
            if(await c.evaluate(`location.pathname==='/'&&document.querySelectorAll('[role=combobox][contenteditable=true]').length===1&&!document.querySelector('[role=combobox][contenteditable=true]').innerText.trim()`)){opened=true;break;}
            await new Promise(r=>setTimeout(r,100));
        }
        if(!opened)throw fail('DESKTOP_TARGET_UNCONFIRMED','Antigravity 没有打开空白新会话，未发送');
        if(model)await modelMenu(c,model,'/');
        await c.evaluate(`document.querySelector('[role=combobox][contenteditable=true]').focus()`);
        if(ready!=='prepared')await typeText(c,text);
        await submitPrepared(c,'/',text);
        for(let n=0;n<60;n++){
            const id=await c.evaluate(`(()=>{const parts=location.pathname.split('/');const id=parts.length===3&&parts[1]==='c'&&/^[a-f0-9-]{36}$/i.test(parts[2])?parts[2]:null;return id&&!${JSON.stringify(before)}.includes(id)&&Array.from(document.querySelectorAll('[data-testid="user-message-bubble"]')).some(e=>(${composerText.toString()})((e.querySelector('[data-quotable="true"]')||e).innerText)===${JSON.stringify(composerText(text))})?id:null;})()`);
            if(id)return {id,status:'accepted'};
            await new Promise(r=>setTimeout(r,150));
        }
        throw fail('DELIVERY_UNKNOWN','Antigravity 已提交新建，但未确认新会话回执，请核对桌面，不会重复发送');
    });
}
module.exports = { connect, canConnect, list, busyIds, messages, send, createAndSend, sidebarTime, models, modelMenu, nativeModelOptions };
