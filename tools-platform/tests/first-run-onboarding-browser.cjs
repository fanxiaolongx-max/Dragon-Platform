// Full homepage renderer with isolated profile and mocked APIs; no runtime data writes.
// Run: node_modules/.bin/electron tests/first-run-onboarding-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-start-browser-'));
const frontend = path.join(__dirname, '../frontend');
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
let win, server, scenario, decided, requests, decisions, failures;
const evaluate = code => win.webContents.executeJavaScript(code, true);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) {
    for (let n = 0; n < 160; n++) {
        if (await evaluate(`!!(${code})`)) return;
        await wait(30);
    }
    throw new Error('Timed out: ' + code);
}
setTimeout(() => app.exit(1), 60000).unref();
app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());
    web.get('/', (_, res) => res.type('html').send(fs.readFileSync(path.join(frontend, 'index.html'), 'utf8').replace('<head>', `<head><script>
        localStorage.setItem('tools_token','fixture');localStorage.setItem('tools_user','fixture');
        localStorage.setItem('tools_tenant_id','default');localStorage.removeItem('tools_role');
        localStorage.setItem('tools_theme',${JSON.stringify(scenario.theme || 'light')});
        localStorage.setItem('tools_lang',${JSON.stringify(scenario.lang || 'zh-CN')});
        ${scenario.desktop ? "window.DragonWindow={getState:async()=>({platform:'darwin'}),onState:()=>{}};" : ''}
    </script>`)));
    web.get('/api/auth/me', (_, res) => setTimeout(() => res.json({ username: 'fixture', role: scenario.role || 'admin', tenantId: 'default' }), 1800));
    web.get('/api/onboarding/defaults/status', (_, res) => {
        requests++;
        if (failures-- > 0) return res.status(503).json({ error: 'Temporary startup failure' });
        res.json({ required: !decided && scenario.role !== 'user', build: {
            version: 'fixture', builtAt: '2026-11-04T00:00:00Z',
            platformLabel: scenario.desktop ? 'macOS Desktop' : 'Web / Source',
            dependencies: [{ name: 'express', version: 'fixture', role: 'Web service' }]
        } });
    });
    web.post('/api/onboarding/defaults/decision', (req, res) => {
        decisions.push(req.body);
        if (scenario.rejectDecision) return res.status(500).json({ error: 'Fixture write failed' });
        decided = true;
        res.json({ success: true });
    });
    web.get('/api/custom-tools', (_, res) => res.json([]));
    web.get(['/api/recent-nav', '/api/favorite-nav', '/api/friend-links'], (_, res) => res.json([]));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const url = `http://127.0.0.1:${server.address().port}/`;
    async function load(options = {}) {
        scenario = options; decided = !!options.decided; requests = 0; decisions = []; failures = options.failures || 0;
        win.setSize(options.narrow ? 390 : 1440, options.narrow ? 720 : 1000);
        await win.loadURL(url);
    }
    const modal = 'document.getElementById("defaultQuickStartModal")';
    for (const desktop of [false, true]) {
        for (const theme of ['light', 'dark']) {
            await load({ desktop, theme, narrow: theme === 'dark', lang: theme === 'dark' ? 'en-US' : 'zh-CN' });
            await until(modal);
            assert.equal(await evaluate(`document.querySelectorAll('#defaultQuickStartModal').length`), 1);
            const view = await evaluate(`(()=>{const m=${modal},c=m.querySelector('.quick-start-card'),b=m.querySelector('.quick-start-import'),r=c.getBoundingClientRect();return {background:getComputedStyle(c).backgroundColor,button:getComputedStyle(b).backgroundImage,overflow:c.scrollWidth>c.clientWidth,visible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,focus:m.contains(document.activeElement),title:m.querySelector('h2').textContent}})()`);
            assert.equal(view.background, theme === 'dark' ? 'rgb(26, 29, 35)' : 'rgb(255, 255, 255)');
            assert.equal(view.button, 'none'); assert.equal(view.overflow, false); assert.equal(view.visible, true); assert.equal(view.focus, true);
            assert.match(view.title, theme === 'dark' ? /Set up/ : /准备好/);
            fs.writeFileSync(path.join(temp, `${desktop ? 'desktop' : 'web'}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
            await evaluate(`document.querySelector('.quick-start-skip').click()`);
            await until(`!${modal}`);
            assert.deepEqual(decisions, [{ action: 'skip' }]);
            await win.reload(); await wait(900);
            assert.equal(await evaluate(`!!${modal}`), false, 'saved choice survives restart/reload');
        }
    }
    await load({ failures: 1 }); await until(modal);
    assert.ok(requests >= 2, 'temporary failure is retried');
    await load({ rejectDecision: true }); await until(modal);
    await evaluate(`document.querySelector('[data-quick-start="scripts"]').checked=false;document.querySelector('[data-quick-start="rules"]').checked=false;document.querySelector('.quick-start-import').click()`);
    assert.equal(decisions.length, 0);
    await evaluate(`document.querySelector('[data-quick-start="rules"]').checked=true;document.querySelector('.quick-start-import').click()`);
    await until(`document.querySelector('.quick-start-result.error') && !document.querySelector('.quick-start-import').disabled`);
    assert.equal(await evaluate(`!!${modal}`), true, 'failed choice stays open');
    scenario.rejectDecision = false;
    await evaluate(`document.querySelector('.quick-start-import').click()`);
    await wait(1500);
    assert.deepEqual(decisions.at(-1), { action: 'import', importScripts: false, importMetricRules: true });
    assert.equal(await evaluate(`!!${modal}`), false, 'successful import reloads without another prompt');
    for (const options of [{ decided: true }, { role: 'user' }]) {
        await load(options); await wait(1000);
        assert.equal(await evaluate(`!!${modal}`), false);
    }
    await load({});
    await win.loadURL(url + 'pages/privacy.html'); await wait(900);
    const publicRequests = requests;
    assert.equal(await evaluate(`!!${modal}`), false, 'public legal page does not open onboarding');
    await wait(600); assert.equal(requests, publicRequests, 'public legal page does not check onboarding');
    // An initialized platform has no decision, even if this browser previously chose skip/import.
    await load({ desktop: true }); await until(modal);
    console.log('PASS: fresh install/reset, web/desktop, light/dark, mobile, stale role, retry, skip/import persistence and errors. Screenshots: ' + temp);
    win.destroy(); server.close(); app.quit();
}).catch(error => { console.error(error); if (win) win.destroy(); if (server) server.close(); app.exit(1); });
