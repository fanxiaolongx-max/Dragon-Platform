// node_modules/.bin/electron tests/chat-files-browser.cjs
// CHAT_FILES_UI=v2 node_modules/.bin/electron tests/chat-files-browser.cjs
// Isolated browser fixtures; no runtime business data is read or changed.
const { app, BrowserWindow } = require('electron');
const express = require('../backend/node_modules/express');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const v2 = process.env.CHAT_FILES_UI === 'v2';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-file-preview-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
let win, server, popups = 0;
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(code) {
    for (let i = 0; i < 100; i++) {
        if (await evaluate(code)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Timed out: ' + code);
}
app.whenReady().then(async () => {
    const web = express();
    web.get('/', (_req, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
        if (v2) html = html.replace('<html ', '<html data-ui="v2" data-theme="light" ');
        res.send(html.replace('</body>', '<script src="/js/home/workspace-panel.js"></script><script src="/js/shared/chat-files.js"></script></body>'));
    });
    web.get('/api/agent-workspace/capability', (_req, res) => res.json({ enabled: false }));
    web.get('/api/agent-files/stat', (req, res) => res.json(req.query.path.includes('missing') ? { error: 'Missing fixture' } : { size: req.query.path.includes('large') ? 6000000 : 100 }));
    web.get('/api/agent-files/raw', (req, res) => res.type('text').send(req.query.path.endsWith('.html') ? '<script>window.previewExecuted=true</script>' : '# Preview content\n中文换行'));
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 950, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.setWindowOpenHandler(() => { popups++; return { action: 'deny' }; });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until('!!window.ChatFiles && !!document.querySelector(".wsp-card--external")');
    await evaluate(`document.body.classList.add('home-mode-chat');
        const p=document.createElement('p'); p.id='fixture'; p.innerHTML='before'+ChatFiles.chipHtml('/tmp/a.md')+'after'+ChatFiles.chipHtml('/tmp/b.json');document.body.append(p);`);
    assert.equal(await evaluate(`(()=>{const p=fixture, c=p.querySelector('.ai-file-chip');const before=document.createRange();before.setStart(p.firstChild,0);before.setEnd(p.firstChild,6);const after=document.createRange();after.selectNodeContents(p.childNodes[2]);return c.getBoundingClientRect().top>=before.getBoundingClientRect().bottom && after.getBoundingClientRect().top>=c.getBoundingClientRect().bottom})()`), true, 'file occupies its own line between text');
    await evaluate(`fixture.querySelector('.ai-file-chip-name').click()`);
    await until(`document.querySelector('.ai-file-preview pre')?.textContent.includes('中文')`);
    assert.equal(await evaluate(`Math.abs(dcWorkspacePanel.getBoundingClientRect().bottom-(innerHeight-${v2 ? 0 : 18}))<3`), true, 'preview fills visible height below navbar');
    const originalWidth = await evaluate(`dcWorkspacePanel.getBoundingClientRect().width`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const handle = await evaluate(`(()=>{const r=document.querySelector('.ai-file-preview-resize').getBoundingClientRect();return {x:Math.round(r.left+4),y:Math.round(r.top+80)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...handle});
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...handle});
    await until(`document.body.classList.contains('ai-preview-resizing')`);
    win.webContents.sendInputEvent({type:'mouseMove',modifiers:['leftButtonDown'],x:handle.x-140,y:handle.y});
    await until(`dcWorkspacePanel.getBoundingClientRect().width>${originalWidth+80}`);
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:handle.x-140,y:handle.y});
    await until(`dcWorkspacePanel.getBoundingClientRect().width>${originalWidth+80}`);
    await until(`!document.body.classList.contains('ai-preview-resizing')`);
    assert.equal(await evaluate(`document.body.classList.contains('ai-preview-resizing')`), false, 'drag ends cleanly');
    assert.equal(popups, 0);
    assert.equal(await evaluate(`dcWorkspacePanel.hidden`), false);
    assert.equal(await evaluate(`localStorage.getItem('dragon_claw_workspace_open')`), null, 'temporary opening does not persist');
    await evaluate(`ChatFiles.closePreview()`);
    assert.equal(await evaluate(`dcWorkspacePanel.hidden`), true, 'originally closed panel returns closed');
    assert.equal(await evaluate(`document.body.style.getPropertyValue('--ai-preview-width')`), '', 'original width restored on close');
    await evaluate(`window.original=DragonClawWorkspace.showExternal({title:'Agent session',open:true});original.innerHTML='<input value="keep me">';window.originalInput=original.firstChild;fixture.querySelector('.ai-file-chip-name').click()`);
    await until(`!!document.querySelector('.ai-file-preview pre')`);
    assert.equal(await evaluate(`getComputedStyle(original.closest('section')).display`), 'none', 'preview replaces agent card');
    assert.equal(await evaluate(`dcWorkspacePanel.getBoundingClientRect().width>${originalWidth+80}`), true, 'last preview width reused');
    if (v2) {
        await evaluate(`document.body.classList.add('v2-side-collapsed','home-sidebar-collapsed')`);
        const before = await evaluate(`dcWorkspacePanel.getBoundingClientRect().width`);
        await evaluate(`document.querySelector('.ai-file-preview-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`);
        assert.ok(await evaluate(`dcWorkspacePanel.getBoundingClientRect().width>=${before+39}`), 'collapsed v2 sidebar respects preview width');
        await evaluate(`document.documentElement.dataset.theme='dark';document.querySelector('.ai-file-preview-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
        assert.ok(await evaluate(`Math.abs(dcWorkspacePanel.getBoundingClientRect().width-${before})<2`), 'dark theme supports shrinking preview');
        await evaluate(`document.body.classList.remove('v2-side-collapsed','home-sidebar-collapsed');document.documentElement.dataset.theme='light'`);
    }
    await evaluate(`ChatFiles.openPreview('/tmp/code.html')`);
    await until(`document.querySelector('.ai-file-preview pre')?.textContent.includes('<script>')`);
    assert.equal(await evaluate(`!!window.previewExecuted`), false, 'HTML is inert text');
    await evaluate(`ChatFiles.openPreview('/tmp/missing.md')`);
    await until(`document.querySelector('.ai-file-preview-body')?.textContent==='Missing fixture'`);
    await evaluate(`ChatFiles.openPreview('/tmp/large.txt')`);
    await until(`document.querySelector('.ai-file-preview-body')?.textContent.includes('5 MB')`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await evaluate(`dcWorkspacePanel.hidden`), false, 'open agent workspace is restored after switching files');
    assert.equal(await evaluate(`original.firstChild===originalInput && originalInput.value==='keep me'`), true, 'workspace DOM is preserved');
    await evaluate(`ChatFiles.openPreview('/tmp/a.md')`);
    await until(`!!document.querySelector('.ai-file-preview pre')`);
    await evaluate(`dcWorkspaceClose.click()`);
    assert.equal(await evaluate(`!document.querySelector('.ai-file-preview') && !dcWorkspacePanel.hidden`), true, 'panel close restores original content');
    win.setSize(600, 900);
    await until(`innerWidth<=600`);
    await evaluate(`ChatFiles.openPreview('/tmp/b.json')`);
    await until(`!!document.querySelector('.ai-file-preview pre')`);
    assert.equal(await evaluate(`document.querySelector('.ai-file-preview').getBoundingClientRect().right<=innerWidth`), true, 'narrow preview stays within viewport');
    assert.equal(await evaluate(`Math.abs(dcWorkspacePanel.getBoundingClientRect().bottom-innerHeight)<3`), true, 'narrow preview fills remaining viewport');
    const narrowWidth = await evaluate(`dcWorkspacePanel.getBoundingClientRect().width`);
    await evaluate(`document.querySelector('.ai-file-preview-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
    assert.ok(await evaluate(`dcWorkspacePanel.getBoundingClientRect().width<${narrowWidth-20}`), 'narrow preview can shrink');
    assert.ok(await evaluate(`dcWorkspacePanel.getBoundingClientRect().left>=0`), 'narrow preview stays within left edge');
    await evaluate(`ChatFiles.closePreview();dcWorkspacePanel.remove();DragonClawWorkspace=null;ChatFiles.openPreview('/tmp/a.md')`);
    await until(`!!document.querySelector('.ai-file-preview--floating pre')`);
    assert.equal(await evaluate(`Math.abs(document.querySelector('.ai-file-preview').getBoundingClientRect().bottom-(innerHeight-18))<3`), true, 'floating preview fills remaining viewport');
    await evaluate(`ChatFiles.closePreview()`);
    assert.equal(await evaluate(`!!document.querySelector('.ai-file-preview')`), false);
    console.log('PASS: own-line files, inline preview, safe text, full viewport height, drag resizing, width restoration, narrow layout and fallback');
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); }).finally(() => { server?.close(); fs.rmSync(temp, {recursive:true,force:true}); });
