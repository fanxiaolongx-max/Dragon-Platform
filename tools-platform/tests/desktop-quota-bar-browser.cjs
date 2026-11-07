// Run with: ./tools-platform/node_modules/.bin/electron tools-platform/tests/desktop-quota-bar-browser.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), express = require('express');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-quota-bar-test-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

setTimeout(() => { console.error('Desktop quota bar browser test timed out'); app.exit(1); }, 30000).unref();

let win, server;
const evaluate = code => win.webContents.executeJavaScript(/^(let |const )/.test(code) ? `(()=>{${code}})()` : code, true);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(code) {
    for (let n = 0; n < 160; n++) {
        if (await evaluate(`Boolean(${code})`)) return;
        await wait(30);
    }
    throw Error('Timed out waiting for: ' + code);
}

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());
    web.use('/css', express.static(path.join(root, 'frontend/css')));
    web.use('/js', express.static(path.join(root, 'frontend/js')));
    web.use('/assets', express.static(path.join(root, 'frontend/assets')));

    const mockSettings = { enabled: true, providers: { codex: true, claudecode: true, antigravity: true } };
    const mockQuotas = {
        codex: { status: 'live', updatedAt: Date.now(), membership: { label: 'Plus' }, groups: [{ id: 'codex', windows: [{ id: '5h', remainingPercent: 80 }, { id: 'weekly', remainingPercent: 65 }] }] },
        claudecode: { extraUsage: { enabled: true, used: 24.88, limit: 120, currency: 'USD', percent: 21 }, status: 'live', updatedAt: Date.now(), membership: { label: 'Max' }, groups: [{ id: 'claudecode', windows: [{ id: '5h', remainingPercent: 50 }, { id: 'weekly', remainingPercent: 40 }] }] },
        antigravity: { status: 'live', updatedAt: Date.now(), membership: { label: 'Ultra' }, groups: [{ id: 'gemini', windows: [{ id: '5h', remainingPercent: 90 }, { id: 'weekly', remainingPercent: 70 }] }] }
    };

    web.get('/api/desktop-agents/settings', (_req, res) => res.json({ owned: true, settings: mockSettings }));
    web.get('/api/desktop-agents/quota', (_req, res) => res.json({ providers: ['codex', 'claudecode', 'antigravity'], quotas: mockQuotas }));

    web.get('/', (_req, res) => {
        res.type('html').send(`<!doctype html>
<html>
<head>
    <link rel="stylesheet" href="/css/desktop-quota-bar.css">
    <script>
        localStorage.setItem('tools_token', 'test-token');
        localStorage.setItem('tools_lang', 'zh-CN');
    </script>
</head>
<body style="margin:0;min-height:100vh;background:#fff;">
    <script src="/js/shared/desktop-quota-bar.js"></script>
</body>
</html>`);
    });

    server = await new Promise(r => { const s = web.listen(0, '127.0.0.1', () => r(s)); });
    const port = server.address().port;

    win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await win.loadURL(`http://127.0.0.1:${port}/`);
    await until('document.querySelector(".dqb") && !document.querySelector(".dqb").hidden');

    // 1. Initially autoHide is false; quota bar is NOT tucked
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'), false, 'initially not tucked');

    // 2. Open menu
    await evaluate('document.querySelector("[data-dqb-menu]").click()');
    await until('!document.querySelector(".dqb-menu").hidden');

    // 3. Find and click "收起到顶边 · 悬停展开" to enable autoHide
    const autoHideIndex = await evaluate(`Array.from(document.querySelectorAll(".dqb-menu button")).findIndex(b => b.textContent.includes("收起到顶边"))`);
    assert.ok(autoHideIndex >= 0, 'found autoHide menu item');
    assert.equal(await evaluate(`document.querySelectorAll(".dqb-menu button")[${autoHideIndex}].getAttribute("aria-checked")`), 'false', 'initially unchecked');

    await evaluate(`document.querySelectorAll(".dqb-menu button")[${autoHideIndex}].click()`);
    await wait(100);

    // Should now be tucked and prefs saved
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'), true, 'tucked after enabling');
    let prefs = await evaluate('JSON.parse(localStorage.getItem("tools_desktop_quota_bar_v2") || "{}")');
    assert.equal(prefs.autoHide, true, 'prefs saved autoHide true');

    // 4. Hover sensor to reveal
    await evaluate('document.querySelector(".dqb-sensor").dispatchEvent(new PointerEvent("pointerenter"))');
    await wait(50);
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'), false, 'revealed on sensor hover');

    // 5. Open menu again to UNCHECK autoHide
    await evaluate('document.querySelector("[data-dqb-menu]").click()');
    await until('!document.querySelector(".dqb-menu").hidden');

    const autoHideIndex2 = await evaluate(`Array.from(document.querySelectorAll(".dqb-menu button")).findIndex(b => b.textContent.includes("收起到顶边"))`);
    assert.equal(await evaluate(`document.querySelectorAll(".dqb-menu button")[${autoHideIndex2}].getAttribute("aria-checked")`), 'true', 'checked before toggling off');

    // Click to uncheck
    await evaluate(`document.querySelectorAll(".dqb-menu button")[${autoHideIndex2}].click()`);
    await wait(50);

    // Immediately after clicking, it must NOT be tucked
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'), false, 'immediately not tucked after unchecking');
    prefs = await evaluate('JSON.parse(localStorage.getItem("tools_desktop_quota_bar_v2") || "{}")');
    assert.equal(prefs.autoHide, false, 'prefs saved autoHide false');

    // Wait 1.8s (TUCK_MS is 1400ms) to ensure it does NOT tuck automatically
    await wait(1800);
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'), false, 'still NOT tucked after 1.8s timeout');

    // 6. Simulate mouse leaving the panel
    await evaluate('document.querySelector(".dqb-panel").dispatchEvent(new PointerEvent("pointerleave"))');
    await wait(1800);
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'), false, 'still NOT tucked after pointerleave');

    // 7. Verify Escape does not tuck when autoHide is false
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    await wait(50);
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'), false, 'not tucked on Escape when autoHide is false');

    // 8. Verify the close button [data-dqb-hide] has been removed in compact and detailed mode
    assert.equal(await evaluate('Boolean(document.querySelector("[data-dqb-hide]"))'), false, 'no [data-dqb-hide] button in DOM');
    await evaluate('document.querySelector("[data-dqb-menu]").click()');
    await until('!document.querySelector(".dqb-menu").hidden');
    const detailedIndex = await evaluate(`Array.from(document.querySelectorAll(".dqb-menu button")).findIndex(b => b.textContent.includes("详细额度面板"))`);
    await evaluate(`document.querySelectorAll(".dqb-menu button")[${detailedIndex}].click()`);
    await wait(50);
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("expanded")'), true, 'switched to detailed mode');
    assert.equal(await evaluate('Boolean(document.querySelector("[data-dqb-hide]"))'), false, 'no close button in detailed mode');

    const extraSelector = '.dqb-row[data-provider="claudecode"] .dqb-row-extra';
    assert.equal(await evaluate(`document.querySelector('${extraSelector}').hidden`), false);
    assert.match(await evaluate(`document.querySelector('${extraSelector}').textContent`), /24\.88.*120\.00/);
    assert.match(await evaluate(`document.querySelector('${extraSelector} i').style.transform`), /0\.21/);
    for (const [width, theme, language] of [[1200, 'light', 'zh-CN'], [390, 'dark', 'en-US']]) {
        win.setContentSize(width, 800);
        await evaluate(`document.documentElement.dataset.theme='${theme}';localStorage.setItem('tools_lang','${language}');window.dispatchEvent(new Event('tools:languagechange'))`);
        await wait(100);
        const geometry = await evaluate(`(()=>{const r=document.querySelector('.dqb-panel').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()`);
        assert.ok(geometry.left >= 0 && geometry.right <= geometry.width, JSON.stringify(geometry));
    }
    mockQuotas.claudecode.extraUsage.percent = null;
    mockQuotas.claudecode.extraUsage.limit = null;
    mockQuotas.claudecode.extraUsage.currency = '<img src=x onerror=bad>';
    await evaluate(`document.querySelector('[data-dqb-menu]').click();[...document.querySelectorAll('.dqb-menu button')].find(b=>b.textContent.includes('Refresh quotas')).click()`);
    await until(`document.querySelector('${extraSelector}').textContent.includes('<img')`);
    assert.equal(await evaluate(`document.querySelector('${extraSelector} img') === null`), true, 'currency is displayed as text');
    assert.equal(await evaluate(`document.querySelector('${extraSelector} .dqb-extra-track') === null`), true, 'missing percentages do not imply zero usage');
    const storedBeforeReading = await evaluate('localStorage.getItem("tools_desktop_quota_bar_v2")');
    await evaluate('window.dispatchEvent(new CustomEvent("dragon-claw:browser-reading",{detail:{active:true}}))');
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'),true,'browser reading mode tucks quota bar immediately');
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("expanded")'),false,'reading mode temporarily compacts a detailed quota panel');
    assert.equal(await evaluate('localStorage.getItem("tools_desktop_quota_bar_v2")'),storedBeforeReading,'reading mode does not persist over the user preferences');
    await evaluate('document.querySelector(".dqb-sensor").dispatchEvent(new PointerEvent("pointerenter"))');
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'),false,'quota remains available on hover');
    await evaluate('document.querySelector(".dqb-panel").dispatchEvent(new PointerEvent("pointerleave"))');
    await wait(1600);
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'),true,'leaving auto-tucks during browser reading');
    await evaluate('window.dispatchEvent(new CustomEvent("dragon-claw:browser-reading",{detail:{active:false}}))');
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("expanded")'),true,'closing browser restores detailed quota view');
    assert.equal(await evaluate('document.querySelector(".dqb").classList.contains("tucked")'),false,'closing restores always-visible preference');
    assert.equal(await evaluate('localStorage.getItem("tools_desktop_quota_bar_v2")'),storedBeforeReading);
    console.log('PASS: quota bar auto-hide, extra usage amounts, safe currency text, unknown limits, and light/dark narrow layout');
    server.close();
    win.destroy();
    app.exit(0);
}).catch(error => { console.error(error); win?.destroy(); server?.close(); app.exit(1); });
