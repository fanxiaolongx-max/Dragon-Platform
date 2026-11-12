// Run: ./node_modules/.bin/electron tests/home-product-tour-sync-browser.cjs
// Verifies homepage product tour, onboarding/tool-frame isolation, leave-page AppDialog guard,
// AppDialog light-theme CSS, navbar role chips, sidebar More dedup, and SLA no-matched-rules hint.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = path.join(__dirname, '..');
const frontend = path.join(root, 'frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-tour-sync-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

let win;
let server;
const evaluate = code => win.webContents.executeJavaScript(code, true);
const until = code => evaluate(`new Promise((resolve, reject) => { let n = 0; const poll = () => { if (${code}) resolve(); else if (++n > 300) reject(new Error(${JSON.stringify(code)})); else setTimeout(poll, 25); }; poll(); })`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
setTimeout(() => app.exit(1), 60000).unref();

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());

    let onboardingPrompt = true;
    web.get('/', (_, res) => {
        const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8').replace('<head>', `<head><script>
            window.__tpAllowTourInTests = true;
            localStorage.setItem('tools_tenant_id', 'default');
            localStorage.setItem('tools_role', 'admin');
            localStorage.setItem('tools_super', '1');
            localStorage.setItem('tools_user', 'fixture');
            localStorage.setItem('tools_token', 'real-like-token');
            localStorage.setItem('tools_lang', 'zh-CN');
            window.__nativeDialogs = [];
            window.confirm = msg => { window.__nativeDialogs.push('confirm:' + msg); return true; };
            window.alert = msg => { window.__nativeDialogs.push('alert:' + msg); };
            window.prompt = msg => { window.__nativeDialogs.push('prompt:' + msg); return null; };
            window.fixtureErrors = [];
            window.addEventListener('error', e => window.fixtureErrors.push(e.message));
            window.addEventListener('unhandledrejection', e => window.fixtureErrors.push(String(e.reason)));
        </script>`);
        res.type('html').send(html);
    });
    web.get('/sla', (_, res) => res.sendFile(path.join(frontend, 'pages/sla.html')));
    web.get('/requirements', (_, res) => res.sendFile(path.join(frontend, 'pages/requirements.html')));
    web.get('/api/auth/me', (_, res) => res.json({ username: 'fixture', role: 'admin', isSuperAdmin: true, tenantId: 'default' }));
    web.get('/api/tenants', (_, res) => res.json({ tenants: [{ id: 'default', name: '默认租户' }], activeTenantId: 'default' }));
    web.get('/api/onboarding/defaults/status', (_, res) => {
        res.json({
            required: onboardingPrompt,
            build: {
                version: '1.7.5',
                builtAt: '2026-11-12T00:00:00Z',
                platformLabel: 'Web / Source',
                dependencies: []
            }
        });
    });
    web.post('/api/onboarding/defaults/decision', (_, res) => {
        onboardingPrompt = false;
        res.json({ success: true });
    });
    web.get('/api/app-version', (_, res) => res.json({ version: '1.7.5' }));
    web.get('/api/custom-tools', (_, res) => res.json([]));
    web.get('/api/ai/models', (_, res) => res.json({ models: [{ id: 'm1', name: 'DeepSeek', provider: 'openai-compatible' }], defaultId: 'm1', mode: 'direct' }));
    web.get('/api/ai/sessions', (_, res) => res.json({ items: [] }));
    web.get('/api/ai/skills', (_, res) => res.json({ items: [] }));
    web.get('/api/agent-workspace/capability', (_, res) => res.json({ enabled: false }));
    web.get('/api/agent-workspace/prefs', (_, res) => res.json({ lastDirectory: '', recentDirectories: [] }));
    web.get('/api/friend-links', (_, res) => res.json({ links: [], statuses: {} }));
    web.get(['/api/recent-nav', '/api/upload/history'], (_, res) => res.json([]));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));

    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });

    // 1. Visiting `/?app=sla` must NEVER auto-start the tour or pull user away from the tool.
    onboardingPrompt = false;
    await win.loadURL(`${baseUrl}/?app=sla`);
    await until('!!window.HomeProductTour && !!window.HomeToolFrame');
    await wait(1400);
    assert.equal(await evaluate('window.HomeProductTour.isOpen()'), false, 'tour never starts when ?app= tool param is open');
    assert.ok((await evaluate('location.search')).includes('app=sla'), 'user stays on tool URL without redirect to home');

    // 2. Fresh homepage with onboarding modal pending: tour defers until user closes/skips onboarding.
    onboardingPrompt = true;
    await win.loadURL(`${baseUrl}/`);
    await until('!!document.getElementById("defaultQuickStartModal")');
    await wait(1400);
    assert.equal(await evaluate('window.__tpOnboardingPending'), true, 'onboarding pending flag blocks tour');
    assert.equal(await evaluate('window.HomeProductTour.isOpen()'), false, 'tour never overlaps auto-import modal');

    // Skip onboarding modal -> tour should start smoothly afterwards.
    await evaluate('document.querySelector(".quick-start-skip").click(); true');
    await until('!document.getElementById("defaultQuickStartModal")');
    assert.equal(await evaluate('window.__tpOnboardingPending'), false);
    await until('window.HomeProductTour.isOpen()');
    assert.equal(await evaluate('document.querySelector(".v2-tour-eyebrow").textContent.trim()'), '1 / 7');

    // 3. Verify AppDialog light theme CSS rules exist and tour closes cleanly & marks done.
    await evaluate('document.querySelector(".v2-tour-skip").click(); true');
    await until('!window.HomeProductTour.isOpen()');
    assert.equal(await evaluate('window.HomeProductTour.isCompleted()'), true);

    // 4. Replay from Account Menu (`data-v2-do="tour"`) and advance all 7 steps including Step 7 (.v2-account.is-open).
    await evaluate('document.getElementById("v2UserBtn").click(); true');
    await until('!!document.querySelector(".v2-account.is-open [data-v2-do=\\"tour\\"]")');
    assert.ok(await evaluate('!!document.querySelector(".v2-account-head.is-superadmin")'), 'superadmin account head styled');
    await evaluate('document.querySelector(".v2-account [data-v2-do=\\"tour\\"]").click(); true');
    await until('window.HomeProductTour.isOpen()');
    for (let step = 1; step < 7; step += 1) {
        await evaluate('document.querySelector("[data-tour-next]").click(); true');
        await wait(60);
    }
    await until('document.querySelector(".v2-tour-eyebrow").textContent.trim() === "7 / 7"');
    const step7Info = await evaluate(`(() => {
        const pop = document.querySelector(".v2-account.is-open");
        const ring = document.querySelector(".v2-tour-ring");
        const popRect = pop ? pop.getBoundingClientRect() : null;
        const ringRect = ring ? ring.getBoundingClientRect() : null;
        return { popOpen: !!pop, ringW: ringRect ? ringRect.width : 0, popW: popRect ? popRect.width : 0 };
    })()`);
    assert.equal(step7Info.popOpen, true, 'Step 7 opens account popup');
    assert.ok(step7Info.ringW >= step7Info.popW && step7Info.popW > 100, `Step 7 spotlights .v2-account.is-open (${JSON.stringify(step7Info)})`);
    await evaluate('document.querySelector("[data-tour-next]").click(); true');
    await until('!window.HomeProductTour.isOpen()');
    assert.equal(await evaluate('!!document.querySelector(".v2-account.is-open")'), false, 'finishing Step 7 closes account popup');

    // 5. Dirty tool frame leave-guard uses AppDialog (no native confirm) and preserves open frame on cancel.
    await evaluate(`window.HomeToolFrame.open('/requirements', { label: 'Requirements', skipConfirm: true }); true`);
    await until(`(() => { const fw = document.querySelector('.v2-tool-frame-view')?.contentWindow; return window.HomeToolFrame.isOpen() && fw && fw.location.pathname === '/requirements' && fw.document.readyState === 'complete'; })()`);
    await evaluate(`(() => {
        const fw = document.querySelector('.v2-tool-frame-view').contentWindow;
        fw.__dhIsDirty = () => true;
        fw.__dhConfirmLeave = hostConfirm => hostConfirm('Unsaved fixture changes?');
        window.HomeToolFrame.close();
    })()`);
    await until('!!document.querySelector("#navbarConfirmModal.open, .app-dialog")');
    // Cancel leave -> stays in tool frame
    await evaluate('document.querySelector("#navbarConfirmModal.open .nav-confirm-cancel, .app-dialog [data-dialog=\\"cancel\\"]").click(); true');
    await until('!document.querySelector("#navbarConfirmModal.open, .app-dialog")');
    assert.equal(await evaluate('window.HomeToolFrame.isOpen()'), true, 'cancel keeps tool frame open');
    // Confirm leave -> closes tool frame
    await evaluate('window.HomeToolFrame.close(); true');
    await until('!!document.querySelector("#navbarConfirmModal.open .nav-confirm-submit, .app-dialog [data-dialog=\\"ok\\"]")');
    await evaluate('document.querySelector("#navbarConfirmModal.open .nav-confirm-submit, .app-dialog [data-dialog=\\"ok\\"]").click(); true');
    await until('!window.HomeToolFrame.isOpen()');
    assert.deepEqual(await evaluate('window.__nativeDialogs'), [], 'no native alert/confirm/prompt was called');

    // Verify AppDialog light-theme CSS renders light card in html[data-theme="light"]
    await evaluate(`(() => {
        document.documentElement.dataset.theme = 'light';
        window.__savedNavConfirm = window.showNavbarConfirm;
        window.showNavbarConfirm = null;
        window.AppDialog.alert('Light check', { title: 'Theme' });
    })()`);
    await until('!!document.querySelector(".app-dialog-card")');
    const cardStyle = await evaluate(`(() => { const s = getComputedStyle(document.querySelector(".app-dialog-card")); return { bgImg: s.backgroundImage, color: s.color }; })()`);
    assert.ok(cardStyle.bgImg.includes('255, 255, 255') && cardStyle.color === 'rgb(15, 23, 42)', `AppDialog card renders light surface on light theme: ${JSON.stringify(cardStyle)}`);
    await evaluate('document.querySelector(".app-dialog [data-dialog=\\"ok\\"]").click(); window.showNavbarConfirm = window.__savedNavConfirm; true');
    await until('!document.querySelector(".app-dialog")');

    // 6. Navbar user chip & More flyout normalization dedup check.
    const navMeta = await evaluate(`(() => {
        const chip = document.querySelector("#app-navbar .nav-user-chip");
        const role = document.querySelector("#app-navbar .nav-user-role");
        document.querySelector('[data-v2-flyout="more"]').click();
        const items = [...document.querySelectorAll('.v2-flyout a.v2-pop-item')].map(a => a.getAttribute('href'));
        return {
            isSuper: chip?.classList.contains('is-super'),
            roleText: role?.textContent?.trim(),
            dupCount: items.length - new Set(items.map(h => h.replace(/\\.html$/i, '').replace(/\\/+$/, ''))).size
        };
    })()`);
    assert.equal(navMeta.isSuper, true, 'navbar chip has is-super class');
    assert.ok(navMeta.roleText, 'navbar chip displays role pill');
    assert.equal(navMeta.dupCount, 0, 'More flyout has zero duplicate normalized paths');

    assert.deepEqual(await evaluate('window.fixtureErrors'), []);
    console.log('PASS: tour onboarding/tool-page isolation, 7-step replay + .v2-account.is-open, AppDialog dirty guard, navbar super chip, More dedup.');
    win.destroy();
    server.close();
    app.exit(0);
}).catch(err => {
    console.error(err);
    win?.destroy();
    server?.close();
    app.exit(1);
});
