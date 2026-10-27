// Uses the running desktop application's own Chromium connection, never a CLI
// task or a separate model. Every action is bound to its exact conversation ID.
const fs = require('node:fs/promises'), path = require('node:path');
const WebSocket = require('ws');
const { home, safe, antigravityTimestamps } = require('./catalog');
const fail = (code, message) => Object.assign(new Error(message), { code });
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
    const md = (node) => {
        if (node.nodeType === 3)
            return node.textContent.trim() ? node.textContent : ' ';
        if (node.nodeType !== 1 || /^(STYLE|SCRIPT|svg)$/i.test(node.tagName))
            return '';
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
            out.push({ role: 'user', content: (e.querySelector('[data-quotable="true"]') || e).innerText.trim() });
            continue;
        }
        if (e.closest('[data-testid="user-message-bubble"]') || e.parentElement?.closest('[data-quotable="true"]'))
            continue;
        const folded = Array.from(e.querySelectorAll('[data-testid$="collapsible"],[data-testid$="collapsible-trigger"]')).map(b => b.parentElement);
        const blocks = Array.from(e.querySelectorAll('[data-testid="planner-response-text"],.leading-relaxed.select-text')).filter(b => !folded.some(f => f !== e && f.contains(b)) && !b.parentElement.closest('[data-testid="planner-response-text"],.leading-relaxed.select-text'));
        const text = blocks.map(b => md(b).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+(?=\n)/g, '\n').replace(/\n{3,}/g, '\n\n').trim()).filter(Boolean).join('\n\n');
        if (text)
            out.push({ role: 'assistant', content: text });
    }
    return out.slice(-200).map((r, i) => ({ id: String(i), ...r }));
}
// passive：网页轮询只读当前已打开的会话，不切换桌面；桌面在别的会话时只从侧栏读运行状态。
async function messages(id, { passive = false } = {}) { return using(async (c) => { if (passive && !await c.evaluate(`location.pathname==='/c/'+${JSON.stringify(id)}`)) {
    const busy = await c.evaluate(`!!Array.from(document.querySelectorAll('[data-cascade-id]')).find(e=>e.dataset.cascadeId===${JSON.stringify(id)})?.querySelector('button[aria-label="Stop execution"]')`);
    return { available: true, stale: true, busy, items: null };
} if (!passive)
    await select(c, id); const rows = await c.evaluate(`location.pathname==='/c/'+${JSON.stringify(id)}?(${readTimeline.toString()})():null`); if (!rows)
    throw fail('DESKTOP_TARGET_UNCONFIRMED', '桌面会话已切换，请重新打开记录'); const busy=await c.evaluate(`location.pathname!=='/c/'+${JSON.stringify(id)}||!!document.querySelector('[data-testid="agent-input-box"] button[aria-label="Stop execution"]')||!!Array.from(document.querySelectorAll('[data-cascade-id]')).find(e=>e.dataset.cascadeId===${JSON.stringify(id)})?.querySelector('button[aria-label="Stop execution"]')`); return { available: true, busy, items: rows.map(r => ({ ...r, content: safe(r.content, 40000), createdAt: null })) }; }); }
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
        if(location.pathname!==${JSON.stringify(route)}||input!==document.activeElement||input.innerText.trim()!==${JSON.stringify(text.trim())})return null;
        const selection=window.getSelection();
        if(!selection?.isCollapsed||!input.contains(selection.anchorNode))return null;
        const range=document.createRange();range.selectNodeContents(input);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
        return input.innerText;
    })()`);
    if(before===null)return;
    await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});
    await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    const unchanged=await c.evaluate(`(() => {const input=document.querySelector('[role=combobox][contenteditable=true]');return location.pathname===${JSON.stringify(route)}&&input===document.activeElement&&(input.innerText===${JSON.stringify(before+' ')}||input.innerText===${JSON.stringify(before+String.fromCharCode(160))});})()`);
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
            if (inputs.length !== 1 || input.innerText.trim() !== ${JSON.stringify(text.trim())}) return 'changed';
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
async function send(id, text) {
    return using(async (c) => {
        await select(c, id);
        const ready = await c.evaluate(`(()=>{if(location.pathname!=='/c/'+${JSON.stringify(id)})return 'missing';const input=document.querySelector('[role=combobox][contenteditable=true]'),send=document.querySelector('[data-testid="send-button"]');if(!input||!send)return 'missing';if(document.querySelector('[data-testid="agent-input-box"] button[aria-label="Stop execution"]')||Array.from(document.querySelectorAll('[data-cascade-id]')).find(e=>e.dataset.cascadeId===${JSON.stringify(id)})?.querySelector('button[aria-label="Stop execution"]'))return 'busy';if(input.innerText.trim()&&input.innerText.trim()!==${JSON.stringify(text.trim())})return 'draft';input.focus();return input.innerText.trim()?'prepared':'ready';})()`);
        if (!['ready', 'prepared'].includes(ready))
            throw fail(ready === 'busy' ? 'DESKTOP_BUSY' : 'DESKTOP_DRAFT', ready === 'busy' ? '原会话正在运行，请等待当前回复结束' : '桌面输入框未就绪或有未发送内容');
        const beforeCount = await c.evaluate(`Array.from(document.querySelectorAll('[data-testid="user-message-bubble"]')).filter(e=>(e.querySelector('[data-quotable="true"]')||e).innerText.trim()===${JSON.stringify(text.trim())}).length`);
        if (ready === 'ready') await typeText(c, text);
        await submitPrepared(c, '/c/' + id, text);
        // A button click is not a delivery receipt. Wait for the user message in the
        // timeline, bound to this conversation, without attempting a second send.
        for (let n = 0; n < 40; n++) {
            if (await c.evaluate(`location.pathname==='/c/'+${JSON.stringify(id)}&&Array.from(document.querySelectorAll('[data-testid="user-message-bubble"]')).filter(e=>(e.querySelector('[data-quotable="true"]')||e).innerText.trim()===${JSON.stringify(text.trim())}).length>${beforeCount}`))
                return { accepted: true };
            await new Promise(r => setTimeout(r, 100));
        }
        throw fail('DELIVERY_UNKNOWN', '已提交到桌面但未收到确认，请核对原会话后再决定是否重发');
    });
}
async function createAndSend(text) {
    return using(async c=>{
        const before=await c.evaluate(`Array.from(document.querySelectorAll('[data-cascade-id]')).map(e=>e.dataset.cascadeId)`);
        const ready=await c.evaluate(`(()=>{const input=document.querySelector('[role=combobox][contenteditable=true]');if(input?.innerText.trim()){if(location.pathname==='/'&&input.innerText.trim()===${JSON.stringify(text.trim())}){input.focus();return 'prepared';}return 'draft';}const button=document.querySelector('[data-testid="new-conversation-button"]');if(!button)return 'missing';button.click();return 'opening';})()`);
        if(!['opening','prepared'].includes(ready))throw fail('DESKTOP_DRAFT',ready==='draft'?'Antigravity 输入框有未发草稿，未覆盖':'没有找到 Antigravity 新建对话按钮');
        let opened=ready==='prepared';
        for(let n=0;!opened&&n<30;n++){
            if(await c.evaluate(`location.pathname==='/'&&document.querySelectorAll('[role=combobox][contenteditable=true]').length===1&&!document.querySelector('[role=combobox][contenteditable=true]').innerText.trim()`)){opened=true;break;}
            await new Promise(r=>setTimeout(r,100));
        }
        if(!opened)throw fail('DESKTOP_TARGET_UNCONFIRMED','Antigravity 没有打开空白新会话，未发送');
        await c.evaluate(`document.querySelector('[role=combobox][contenteditable=true]').focus()`);
        if(ready!=='prepared')await typeText(c,text);
        await submitPrepared(c,'/',text);
        for(let n=0;n<60;n++){
            const id=await c.evaluate(`(()=>{const parts=location.pathname.split('/');const id=parts.length===3&&parts[1]==='c'&&/^[a-f0-9-]{36}$/i.test(parts[2])?parts[2]:null;return id&&!${JSON.stringify(before)}.includes(id)&&Array.from(document.querySelectorAll('[data-testid="user-message-bubble"]')).some(e=>(e.querySelector('[data-quotable="true"]')||e).innerText.trim()===${JSON.stringify(text.trim())})?id:null;})()`);
            if(id)return {id,status:'accepted'};
            await new Promise(r=>setTimeout(r,150));
        }
        throw fail('DELIVERY_UNKNOWN','Antigravity 已提交新建，但未确认新会话回执，请核对桌面，不会重复发送');
    });
}
module.exports = { connect, list, messages, send, createAndSend, sidebarTime };
