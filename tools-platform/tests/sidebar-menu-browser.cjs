// Full homepage with isolated APIs/profile. Exercises real pointer dragging and saved server state.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict'), express = require('express');
const root = path.join(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidebar-menu-ui-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
let win, server, failSave = false, saves = 0;
let layout = { primary: ['channels', 'skillHub', 'schedule', 'library', 'opsDrafts'], more: ['links', 'requirements', 'promotions'] };
const run = code => win.webContents.executeJavaScript(code, true);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) { for (let i = 0; i < 200; i++) { if (await run(`Boolean(${code})`)) return; await wait(25); } throw Error('Timed out: ' + code); }
const primary = () => run(`Array.from(document.querySelectorAll('#homeSidebar .v2-nav > [data-v2-action]'),b=>b.dataset.v2Action)`);
async function open() {
    await run(`document.querySelector('[data-v2-flyout="more"]').click();document.querySelector('[data-v2-do="customizeMenu"]').click()`);
    await until(`!!document.querySelector('[data-menu-save]:not(:disabled)')`);
}
async function drag(id, targetSelector, after = false) {
    const points = await run(`(()=>{const a=document.querySelector('[data-menu-id="${id}"] [data-menu-handle]').getBoundingClientRect(),b=document.querySelector(${JSON.stringify(targetSelector)}).getBoundingClientRect();return {x:a.x+a.width/2,y:a.y+a.height/2,tx:b.x+b.width/2,ty:b.y+b.height*${after ? '.8' : '.2'}}})()`);
    const point = (x, y) => ({ x: Math.round(x), y: Math.round(y) });
    const initial = await run(`document.querySelector('[data-menu-id="${id}"]').getBoundingClientRect().toJSON()`);
    let animated = false;
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point(points.x, points.y) });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point(points.x, points.y) });
    for (let i = 1; i <= 8; i++) {
        win.webContents.sendInputEvent({ type: 'mouseMove', ...point(points.x + (points.tx - points.x) * i / 8, points.y + (points.ty - points.y) * i / 8) });
        await until(`(()=>{const r=document.querySelector('.v2-menu-drag-preview')?.getBoundingClientRect();return r && Math.abs(r.left-${initial.left + Math.round(points.x + (points.tx - points.x) * i / 8) - Math.round(points.x)})<2 && Math.abs(r.top-${initial.top + Math.round(points.y + (points.ty - points.y) * i / 8) - Math.round(points.y)})<2})()`);
        const floating = await run(`(()=>{const ghost=document.querySelector('.v2-menu-drag-preview'),r=ghost?.getBoundingClientRect();return {left:r?.left,top:r?.top,animated:[...document.querySelectorAll('[data-menu-id]')].some(row=>row.getAnimations().length>0)}})()`);
        assert.ok(Math.abs(floating.left - initial.left - (Math.round(points.x + (points.tx - points.x) * i / 8) - Math.round(points.x))) < 2, 'drag card follows pointer horizontally: '+JSON.stringify({i,points,initial,floating}));
        assert.ok(Math.abs(floating.top - initial.top - (Math.round(points.y + (points.ty - points.y) * i / 8) - Math.round(points.y))) < 2, 'drag card follows pointer vertically');
        animated ||= floating.animated;
        if (i === 4 && id === 'schedule') fs.writeFileSync(path.join(temp, 'drag-in-progress.png'), (await win.webContents.capturePage()).toPNG());
    }
    assert.ok(animated, 'surrounding rows animate into their new positions');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point(points.tx, points.ty) });
    await until('!document.querySelector(".v2-menu-drag-preview")');
    await wait(30);
}
setTimeout(() => app.exit(1), 45000).unref();
app.whenReady().then(async () => {
    const web = express(); web.use(express.json());
    web.get('/', (_, res) => res.type('html').send(fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8').replace('<head>', `<head><script>
        localStorage.setItem('tools_user','fixture');localStorage.setItem('tools_role','readonly');localStorage.setItem('tools_tenant_id','default');localStorage.setItem('tools_token','fixture-only');localStorage.setItem('tools_lang','zh-CN');
        window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));
        </script>`)));
    web.get('/api/sidebar-menu', (_, res) => res.json(layout));
    web.put('/api/sidebar-menu', (req, res) => {
        if (failSave) return res.status(503).json({ error: 'Fixture save failure' });
        saves++; layout = req.body; res.json(layout);
    });
    web.get('/api/auth/me', (_, res) => res.json({ username: 'fixture', role: 'readonly', tenantId: 'default' }));
    web.get('/api/app-version', (_, res) => res.json({ version: 'fixture' }));
    web.get('/api/custom-tools', (_, res) => res.json([]));
    web.get('/api/ai/models', (_, res) => res.json({ models: [] }));
    web.get('/api/ai/sessions', (_, res) => res.json({ items: [] }));
    web.get('/api/platform-promotions', (_, res) => res.json({ videos: [], links: [], desktopStack: false }));
    web.get('/api/friend-links', (_, res) => res.json([]));
    web.get('/api/channels/available', (_, res) => res.json({ items: [] }));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    win = new BrowserWindow({ show: false, width: 1200, height: 950, webPreferences: { backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until('!!window.HomeSidebarMenu && !!window.HomeV2');
    await open();
    assert.equal(await run('document.querySelectorAll("[data-menu-id]").length'), 8);
    const initial = await primary();
    const beforeCancel = await run(`Array.from(document.querySelectorAll('[data-menu-id]'),row=>row.dataset.menuId)`);
    const cancelPoint = await run(`(()=>{const r=document.querySelector('[data-menu-id="schedule"] [data-menu-handle]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...cancelPoint});
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...cancelPoint});
    win.webContents.sendInputEvent({type:'mouseMove',x:cancelPoint.x,y:cancelPoint.y-100});
    await until(`!!document.querySelector('.v2-menu-drag-preview')`);
    await run(`document.querySelector('.v2-menu-overlay').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:cancelPoint.x,y:cancelPoint.y-100});
    await until(`!document.querySelector('.v2-menu-drag-preview')`);
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('[data-menu-id]'),row=>row.dataset.menuId)`), beforeCancel, 'Escape restores the order before dragging');
    assert.ok(await run(`!!document.querySelector('.v2-menu-overlay')`), 'Escape cancels the drag and keeps the editor open');
    await drag('schedule', '[data-menu-id="channels"]');
    assert.equal(await run(`document.querySelector('[data-menu-list="primary"]').firstElementChild.dataset.menuId`), 'schedule');
    await drag('library', '[data-menu-list="more"] [data-menu-id="requirements"]', true);
    assert.equal(await run(`!!document.querySelector('[data-menu-list="more"] [data-menu-id="library"]')`), true);
    await run(`document.querySelector('[data-menu-id="links"] [data-menu-move="group"]').click()`);
    await run(`document.querySelector('[data-menu-id="opsDrafts"] [data-menu-handle]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
    assert.deepEqual(await primary(), initial, 'draft changes are applied only after saving');
    failSave = true;
    await run('document.querySelector("[data-menu-save]").click()');
    await until('!!document.querySelector("[data-menu-status].is-error")');
    assert.deepEqual(await primary(), initial);
    assert.equal(saves, 0);
    failSave = false;
    await run('document.querySelector("[data-menu-save]").click()');
    await until('!document.querySelector(".v2-menu-overlay")');
    const expected = ['newChat', ...layout.primary];
    assert.deepEqual(await primary(), expected);
    assert.equal(expected[1], 'schedule');
    assert.ok(expected.includes('links') && !expected.includes('library'));
    await run(`document.querySelector('#homeSidebar [data-v2-action="links"]').click()`);
    assert.equal(await run('!!document.querySelector(".v2-links-submenu.is-open")'), true, 'links work when promoted to the main menu');
    await run('HomeV2.closePop()');
    await win.reload();
    await until(`document.querySelector('#homeSidebar .v2-nav > [data-v2-action="schedule"]')===document.querySelector('#homeSidebar .v2-nav > [data-v2-action="newChat"]').nextElementSibling`);
    assert.deepEqual(await primary(), expected, 'reload reads the layout from the server');
    await run(`document.querySelector('[data-v2-flyout="more"]').click()`);
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('.v2-sidebar-more-items > button'),b=>b.dataset.v2Action)`), layout.more);
    assert.ok(await run('!!document.getElementById("v2OpsCount")'), 'moving a menu retains the live badge');
    await run('HomeV2.closePop()');
    for (const [width, theme, language] of [[1200, 'light', 'zh-CN'], [390, 'dark', 'en-US']]) {
        win.setContentSize(width, 850);
        await until(`innerWidth===${width}`);
        await run(`document.documentElement.dataset.theme='${theme}';ToolsI18n.setLanguage('${language}')`);
        await open();
        const bounds = await run(`(()=>{const r=document.querySelector('.v2-menu-dialog').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})()`);
        assert.ok(bounds.left >= 0 && bounds.right <= bounds.w && bounds.top >= 0 && bounds.bottom <= bounds.h, JSON.stringify(bounds));
        await run('document.querySelector("[data-menu-reset]").click()');
        await wait(150);
        fs.writeFileSync(path.join(temp, `menu-${theme}.png`), (await win.webContents.capturePage()).toPNG());
        await run(`document.querySelector('[data-menu-close]').click()`);
        assert.deepEqual(await primary(), expected, 'cancel discards the unsaved reset');
    }
    assert.deepEqual(await run('fixtureErrors'), []);
    console.log('PASS: pointer-following preview, yielding animations, Escape cancellation, real drag reorder and cross-group moves, keyboard moves, save failure/retry, server reload, live menu actions/badges, cancel, light/dark and 390px. Previews: ' + temp);
    win.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); win?.destroy(); server?.close(); app.exit(1); });
