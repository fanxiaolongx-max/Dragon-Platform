// Uses the running desktop application's own Chromium connection, never a CLI
// task or a separate model. Every action is bound to its exact conversation ID.
const fs = require('node:fs/promises'), path = require('node:path');
const WebSocket = require('ws');
const { home, safe } = require('./catalog');
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
async function using(fn) { const client = await connect(); try {
    return await fn(client);
}
finally {
    client.close();
} }
async function list(limit) {
    return using(async (c) => {
        const rows = await c.evaluate(`Array.from(document.querySelectorAll('[data-testid="conversation-row-sidebar"]')).map((e,i)=>({id:e.getAttribute('data-cascade-id'),title:e.querySelector('a')?.getAttribute('aria-label')||e.querySelector('span.truncate')?.textContent||e.textContent,order:i})).filter(r=>r.id)`);
        return rows.filter(r => /^[a-f0-9-]{36}$/i.test(r.id)).slice(0, limit).map(r => ({ id: r.id, provider: 'antigravity', title: safe(r.title), updatedAt: null, observedAt: new Date().toISOString(), order: r.order, source: 'desktop-sidebar' }));
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
async function messages(id) { return using(async (c) => { await select(c, id); const rows = await c.evaluate(`location.pathname==='/c/'+${JSON.stringify(id)}?Array.from(document.querySelectorAll('[data-testid="user-message-bubble"],[data-testid="planner-response-text"]')).map((e,i)=>({id:String(i),role:e.dataset.testid==='user-message-bubble'?'user':'assistant',content:(e.querySelector('[data-quotable="true"]')||e).innerText})).slice(-200):null`); if (!rows)
    throw fail('DESKTOP_TARGET_UNCONFIRMED', '桌面会话已切换，请重新打开记录'); return { available: true, items: rows.map(r => ({ ...r, content: safe(r.content, 40000), createdAt: null })) }; }); }
async function send(id, text) {
    return using(async (c) => {
        await select(c, id);
        const ready = await c.evaluate(`(()=>{if(location.pathname!=='/c/'+${JSON.stringify(id)})return 'missing';const input=document.querySelector('[role=combobox][contenteditable=true]'),send=document.querySelector('[data-testid="send-button"]');if(!input||!send)return 'missing';if(document.querySelector('[data-testid="agent-input-box"] button[aria-label="Stop execution"]')||Array.from(document.querySelectorAll('[data-cascade-id]')).find(e=>e.dataset.cascadeId===${JSON.stringify(id)})?.querySelector('button[aria-label="Stop execution"]'))return 'busy';if(input.innerText.trim())return 'draft';input.focus();return 'ready';})()`);
        if (ready !== 'ready')
            throw fail(ready === 'busy' ? 'DESKTOP_BUSY' : 'DESKTOP_DRAFT', ready === 'busy' ? '原会话正在运行，请等待当前回复结束' : '桌面输入框未就绪或有未发送内容');
        const beforeCount = await c.evaluate(`Array.from(document.querySelectorAll('[data-testid="user-message-bubble"]')).filter(e=>(e.querySelector('[data-quotable="true"]')||e).innerText.trim()===${JSON.stringify(text.trim())}).length`);
        await c.call('Input.insertText', { text });
        const submitted = await c.evaluate(`(()=>{if(location.pathname!=='/c/'+${JSON.stringify(id)})return false;const input=document.querySelector('[role=combobox][contenteditable=true]'),send=document.querySelector('[data-testid="send-button"]');if(input?.innerText.trim()!==${JSON.stringify(text.trim())}||!send||send.disabled)return false;send.click();return true;})()`);
        if (!submitted)
            throw fail('DESKTOP_REJECTED', '桌面未接受消息，请在原会话核对');
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
module.exports = { connect, list, messages, send };
