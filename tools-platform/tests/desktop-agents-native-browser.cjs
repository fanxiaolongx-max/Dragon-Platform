// Exercise the actual CDP adapter against an isolated Electron desktop fixture.
// No real desktop client, conversation or model is used by this test.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict'), express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-native-ui-'));
app.setPath('userData', temp);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('remote-debugging-port', '0');
process.env.TOOLS_DESKTOP_AGENT_HOME = temp;
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
let win, server;
setTimeout(() => { console.error('Native desktop fixture timed out'); app.exit(1); }, 45000).unref();
app.whenReady().then(async () => {
    const web = express();
    web.get('/c/:id', (_req, res) => res.type('html').send(`<!doctype html><body>
      <div data-testid="conversation-row-sidebar" data-cascade-id="${id}"><a href="/c/${id}" aria-label="Original desktop title"></a><span>Original desktop title</span><small>4h</small></div>
      <div data-testid="conversation-row-sidebar" data-cascade-id="${other}"><a href="/c/${other}" aria-label="Other running conversation"></a><button aria-label="Stop execution"></button></div>
      <div id="timeline"></div><div data-testid="agent-input-box"><div role="combobox" contenteditable="true"></div><button data-testid="send-button">Send</button></div>
      <script>window.deliver=true;document.querySelector('[data-testid=send-button]').onclick=()=>{const input=document.querySelector('[contenteditable]');if(!window.deliver)return;const bubble=document.createElement('div');bubble.dataset.testid='user-message-bubble';const text=document.createElement('div');text.dataset.quotable='true';text.textContent=input.innerText;bubble.append(text);const stamp=document.createElement('span');stamp.textContent='16:24';bubble.append(stamp);document.getElementById('timeline').append(bubble);input.innerText='';};</script>`));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadURL('http://127.0.0.1:' + server.address().port + '/c/' + id);
    const active = path.join(temp, 'Library/Application Support/Antigravity');
    fs.mkdirSync(active, { recursive: true });
    for (let i = 0; i < 100 && !fs.existsSync(path.join(temp, 'DevToolsActivePort')); i++)
        await new Promise(r => setTimeout(r, 30));
    fs.copyFileSync(path.join(temp, 'DevToolsActivePort'), path.join(active, 'DevToolsActivePort'));
    const native = require('../backend/models/desktop-agents/antigravity-cdp');
    const rows = await native.list(10);
    assert.equal(rows[0].title, 'Original desktop title', 'timestamps are not part of titles');
    assert.deepEqual(await native.send(id, 'A native follow-up'), { accepted: true }, 'another running conversation does not block this one');
    assert.deepEqual(await native.send(id, 'A native follow-up'), { accepted: true }, 'receipt requires a newly added user bubble');
    const messages = await native.messages(id);
    assert.deepEqual(messages.items.map(m => m.content), ['A native follow-up', 'A native follow-up'], 'timestamps and controls are excluded');
    await win.webContents.executeJavaScript(`document.querySelector('[data-cascade-id="${id}"]').insertAdjacentHTML('beforeend','<button aria-label="Stop execution"></button>')`);
    await assert.rejects(native.send(id, 'Do not send'), e => e.code === 'DESKTOP_BUSY');
    await win.webContents.executeJavaScript(`document.querySelector('[data-cascade-id="${id}"] button').remove();document.querySelector('[contenteditable]').innerText='Unsent native draft'`);
    await assert.rejects(native.send(id, 'Do not replace'), e => e.code === 'DESKTOP_DRAFT');
    await assert.rejects(native.messages(other), e => e.code === 'DESKTOP_DRAFT');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('[contenteditable]').innerText"), 'Unsent native draft');
    await win.webContents.executeJavaScript("document.querySelector('[contenteditable]').innerText='';window.deliver=false");
    await assert.rejects(native.send(id, 'Unconfirmed delivery'), e => e.code === 'DELIVERY_UNKNOWN');
    assert.equal((await native.messages(id)).items.length, 2, 'uncertain delivery is not automatically retried');
    console.log('PASS: native CDP titles, exact session sends, duplicate-text receipts, timestamp removal, busy sessions, draft preservation and uncertain delivery');
    win.destroy();
    server.close();
    app.exit(0);
}).catch(e => { console.error(e); win?.destroy(); server?.close(); app.exit(1); });
