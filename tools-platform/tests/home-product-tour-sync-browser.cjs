// Run: ./node_modules/.bin/electron tests/home-product-tour-sync-browser.cjs
// Verifies homepage product tour, onboarding/tool-frame isolation, leave-page AppDialog guard,
// AppDialog light-theme CSS, account role labels, and sidebar More dedup.
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
const until = (code, ms = 7500) => evaluate(`new Promise((resolve, reject) => { let n = 0; const poll = () => { if (${code}) resolve(); else if (++n > ${Math.ceil(ms / 25)}) reject(new Error(${JSON.stringify(code)})); else setTimeout(poll, 25); }; poll(); })`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const next = () => evaluate('document.querySelector("[data-tour-next]").click()');
const previous = () => evaluate('document.querySelector("[data-tour-prev]").click()');
const waitForFocus = (selector, inTool = false) => until(`(() => {
    const overlay = document.querySelector('.v2-tour-root');
    const spotlight = overlay.querySelector('.v2-tour-ring');
    if (overlay.classList.contains('is-tool-loading') || spotlight.style.opacity !== '1') return false;
    const frame = ${inTool} ? document.querySelector('.v2-tour-tool, #v2ToolFrame:not([hidden]) iframe') : null;
    const el = (frame?.contentDocument || document).querySelector(${JSON.stringify(selector)});
    const rect = el?.getBoundingClientRect();
    const ring = spotlight.getBoundingClientRect();
    const outer = frame?.getBoundingClientRect();
    if (!rect?.width || !rect.height || (outer && rect.right > frame.clientWidth)) return false;
    const left = rect.left + (outer?.left || 0), top = rect.top + (outer?.top || 0);
    const right = rect.right + (outer?.left || 0);
    const bottom = Math.min(rect.bottom + (outer?.top || 0), outer?.bottom ?? innerHeight);
    if (overlay.classList.contains('is-data-tool')) {
        const card = overlay.querySelector('.v2-tour-card').getBoundingClientRect();
        if (innerWidth >= 1100 ? left < card.right : bottom > card.top) return false;
    }
    return ring.left <= left + 1 && ring.top <= top + 1 && ring.right >= right - 1 && ring.bottom >= bottom - 1;
})()`);
// 演示舞台里的高亮区域：高亮框要盖住 [data-tour-focus]（裁到舞台可见范围内），且不与引导卡片重叠。
const waitForStage = (kind, selector = '[data-tour-focus]') => until(`(() => {
    const overlay = document.querySelector('.v2-tour-root.is-staged');
    const stage = overlay?.querySelector('.v2-tour-stage.is-' + ${JSON.stringify(kind)});
    const frame = stage?.querySelector('.tm-page');
    const inner = frame?.contentDocument?.querySelector('[data-tour-focus]');
    const el = frame ? inner : stage?.querySelector(${JSON.stringify(selector)});
    if (!el || !el.hasAttribute('data-tour-focus') || overlay.querySelector('.v2-tour-ring').style.opacity !== '1') return false;
    const box = stage.getBoundingClientRect();
    let rect = el.getBoundingClientRect();
    if (frame) {
        // 快照在 iframe 里按原尺寸排版后整体缩放，高亮应对准缩放后的重点元素。
        const outer = frame.parentElement.getBoundingClientRect();
        const scale = outer.width / frame.offsetWidth;
        if (outer.left < box.left - 1 || outer.right > box.right + 1 || outer.top < box.top - 1 || outer.bottom > box.bottom + 1) return false;
        const vw = frame.offsetWidth, vh = frame.offsetHeight;
        rect = { left: outer.left + Math.max(0, rect.left) * scale, right: outer.left + Math.min(vw, rect.right) * scale,
            top: outer.top + Math.max(0, rect.top) * scale, bottom: outer.top + Math.min(vh, rect.bottom) * scale };
    }
    const ring = overlay.querySelector('.v2-tour-ring').getBoundingClientRect();
    const card = overlay.querySelector('.v2-tour-card').getBoundingClientRect();
    const left = Math.max(rect.left, box.left), top = Math.max(rect.top, box.top);
    const right = Math.min(rect.right, box.right), bottom = Math.min(rect.bottom, box.bottom);
    const apart = card.right <= box.left || card.bottom <= box.top || card.top >= box.bottom || card.left >= box.right;
    return right > left && bottom > top && apart && ring.left <= left + 1 && ring.top <= top + 1 && ring.right >= right - 1 && ring.bottom >= bottom - 1;
})()`);
setTimeout(() => app.exit(1), 60000).unref();

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());
    const chatRequests = [];

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
    for (const [href, attributes] of [
        ['/uivf12', 'class="btn-batch-run-row"'], ['/report', 'id="report-content"'],
        ['/monthly', 'id="airReportPane"'], ['/bigscreen', 'class="screen-grid"']
    ]) {
        web.get(href, (_, res) => res.send(`<!doctype html><main ${attributes} style="width:75%;height:240px">Tool data</main>`));
    }
    web.get('/expedite', (_, res) => res.send(`<!doctype html>
        <div id="platformStartup">Loading</div>
        <textarea id="brief-textarea" style="position:relative;left:90px;width:200px;height:220px">Saved reminder text</textarea>`));
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
    web.get('/api/channels/ops/pending', (_, res) => res.json({ canManage: true, items: [], total: 0 }));
    web.post('/api/ai/chat', (req, res) => {
        chatRequests.push(req.body);
        res.type('application/x-ndjson');
        res.end(JSON.stringify({ type: 'done', reply: 'unexpected' }) + '\n');
    });
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

    // Skip onboarding -> the first step types into the real composer, then streams a prewritten reply in the real thread.
    await evaluate('document.querySelector(".quick-start-skip").click(); true');
    await until('!document.getElementById("defaultQuickStartModal")');
    assert.equal(await evaluate('window.__tpOnboardingPending'), false);
    await until('window.HomeProductTour.isOpen()');
    const stepCount = await evaluate('window.HomeProductTour.stepCount()');
    assert.equal(await evaluate('document.querySelector(".v2-tour-eyebrow").textContent.trim()'), `1 / ${stepCount}`);
    assert.equal(stepCount, 14);
    assert.equal(await evaluate('document.querySelector(".v2-tour-root select") === null'), true);
    const answerDone = '!!document.querySelector("#dcThread .dc-msg--ai:not(.is-streaming) .dc-msg-body table") && document.querySelector("#dcThread .dc-msg--ai .dc-msg-body").innerText.includes("运维待办")';
    await until('document.getElementById("dcInput").value.length > 10 && document.getElementById("dcInput").readOnly');
    await waitForFocus('#dcComposer');
    assert.equal(await evaluate('document.querySelector(".v2-tour-desc").textContent'), '让 AI 查本月未达标指标和临期工单。', 'the card keeps the short step description');
    // 打完字停住，等用户点「发送」。
    await until('document.querySelector("[data-tour-next]").textContent === "发送"', 10000);
    await wait(600);
    assert.equal(await evaluate('document.body.classList.contains("dc-chatting")'), false, 'the question waits for Send');
    assert.match(await evaluate('document.getElementById("dcInput").value'), /等我确认后再发送。$/);
    await next();
    await until('document.body.classList.contains("dc-chatting") && !!document.querySelector("#dcThread .dc-msg--user")');
    assert.match(await evaluate('document.querySelector("#dcThread .dc-msg--user").innerText'), /等我确认后再发送。$/);
    await waitForFocus('#dcThread');
    await until(answerDone, 15000);
    const reply = await evaluate('document.querySelector("#dcThread .dc-msg--ai .dc-msg-body").innerText');
    assert.match(reply, /RC2026\*{8}04[\s\S]*M\*{3} H\*{3}[\s\S]*y\*{3} 0087\*{2}23[\s\S]*催办草稿/, 'masked IDs and names render literally');
    assert.equal(await evaluate('[...document.querySelectorAll("#dcThread .dc-msg--ai .dc-msg-body td strong, #dcThread .dc-msg--ai .dc-msg-body blockquote strong")].length'), 0, 'masking characters are not parsed as bold');
    assert.equal(await evaluate('document.querySelectorAll("#dcThread .dc-msg--ai .dc-msg-body em").length'), 0, 'masking asterisks are not parsed as emphasis');
    assert.equal(await evaluate('/示范|示例数据|匿名/.test(document.querySelector(".v2-tour-root").innerText)'), false, 'the tour does not label content as a demo');
    assert.equal(chatRequests.length, 0, 'the demo reply is not a real chat request');
    assert.ok(await evaluate(`(() => { const card = document.querySelector('.v2-tour-card').getBoundingClientRect(); const thread = document.getElementById('dcThread').getBoundingClientRect(); return card.left >= thread.right - 1; })()`), 'the card docks beside the real thread');
    win.setContentSize(390, 660);
    await until('innerWidth <= 400');
    await until(`(() => { const thread = document.getElementById('dcThread').getBoundingClientRect(); const card = document.querySelector('.v2-tour-card').getBoundingClientRect(); return thread.height > 150 && card.top >= thread.bottom - 1 && card.bottom <= innerHeight; })()`);
    win.setContentSize(1440, 960);
    await until('innerWidth >= 1400');
    await next();
    assert.equal(await evaluate('document.querySelector(".v2-tour-eyebrow").textContent.trim()'), `2 / ${stepCount}`);
    assert.equal(await evaluate('document.body.classList.contains("dc-chatting")'), false, 'leaving the first step restores the landing page');
    assert.equal(await evaluate('document.getElementById("dcInput").value'), '');
    assert.equal(await evaluate('document.getElementById("dcThread").children.length'), 0, 'the demo messages are removed');
    await waitForFocus('.dc-landing [data-v2-modes]');
    await previous();
    await until('document.getElementById("dcInput").value.length > 3');
    await next(); // 跳过打字动画
    assert.equal(await evaluate('document.querySelector("[data-tour-next]").textContent'), '发送');
    await next(); // 发送
    await next(); // 跳过流式输出，直接显示完整回答
    await until(answerDone);
    await waitForFocus('#dcThread');
    await evaluate('document.querySelector(".v2-tour-skip").click()');
    await until('!window.HomeProductTour.isOpen()');
    assert.equal(await evaluate('window.HomeProductTour.isCompleted()'), true);
    assert.equal(await evaluate('document.body.classList.contains("dc-chatting") || document.getElementById("dcThread").children.length || document.getElementById("dcInput").readOnly'), false);
    assert.equal(chatRequests.length, 0, 'the tour never sends a real chat request');

    // A replay while a conversation is open puts that conversation back afterwards.
    await evaluate(`(() => {
        document.getElementById('dcThread').innerHTML = '<div class="dc-msg dc-msg--user" id="keptMessage"><div class="dc-msg-main"><div class="dc-msg-body">kept</div></div></div>';
        document.body.classList.add('dc-chatting');
        window.ToolsI18n.setLanguage("en-US");
        window.HomeProductTour.replay();
    })()`);
    await until('document.querySelector(".v2-tour-title")?.textContent === "Ask Dragon Claw anything" && document.getElementById("dcInput").value.startsWith("Use")');
    assert.equal(await evaluate('!!document.getElementById("keptMessage")'), false);
    await next();
    assert.equal(await evaluate('document.querySelector("[data-tour-next]").textContent'), 'Send');
    await next();
    await until('document.querySelector("#dcThread .dc-msg--ai .dc-msg-body")?.innerText.includes("Ops Drafts")');
    await evaluate('document.querySelector(".v2-tour-skip").click(); window.ToolsI18n.setLanguage("zh-CN");');
    assert.equal(await evaluate('!!document.getElementById("keptMessage") && document.body.classList.contains("dc-chatting") && document.getElementById("dcInput").value === ""'), true, 'the open conversation is restored');
    await evaluate('window.DragonClaw.newChat()');

    // 4. Replay from Account and advance through the guide in order; tools are static demos.
    await evaluate(`(() => {
        window.DragonClaw.newChat();
        const input = document.getElementById('dcInput');
        input.value = '已有草稿';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate('document.getElementById("v2UserBtn").click(); true');
    await until('!!document.querySelector(".v2-account.is-open [data-v2-do=\\"tour\\"]")');
    assert.ok(await evaluate('!!document.querySelector(".v2-account-head.is-superadmin")'), 'superadmin account head styled');
    await evaluate('document.querySelector(".v2-account [data-v2-do=\\"tour\\"]").click(); true');
    await until('document.querySelector(".v2-tour-root.is-open")');
    // 第一步：跳过打字 → 发送 → 跳过流式输出 → 下一步。
    for (let i = 0; i < 6 && !(await evaluate('document.querySelector(".v2-tour-eyebrow").textContent.startsWith("2 /")')); i++) {
        await next();
        await wait(80);
    }
    await waitForFocus('.dc-landing [data-v2-modes]');
    assert.equal(await evaluate('document.getElementById("dcInput").value'), '已有草稿', 'the user draft is back after the first step');
    await next();
    await waitForFocus('#homeSidebar [data-v2-action="newChat"]');
    await next();
    await waitForFocus('#homeSidebar [data-v2-action="skillHub"]');
    await next();
    await waitForFocus('#homeSidebar [data-v2-flyout="more"]');
    for (const [id, title] of [
        ['uivf12', '数据抓取'], ['sla', '数据导入'], ['report', '报表看板'], ['expedite', '一键催办'],
        ['monthly', '月报页面'], ['bigscreen', '大屏看板'], ['opsDrafts', '运维待办']
    ]) {
        await next();
        assert.equal(await evaluate('document.querySelector(".v2-tour-title").textContent'), title);
        await waitForStage(id);
        if (id === 'opsDrafts') assert.ok(await evaluate('!!document.querySelector(".v2-tour-stage .ops-inbox-panel .ops-card[data-tour-focus]")'), 'ops drafts render the real review panel');
        else {
            assert.equal(await evaluate('new URL(document.querySelector(".v2-tour-stage .tm-page").src).pathname'), `/assets/tour/${id}.html`, `${id} shows its anonymized page snapshot`);
            assert.equal(await evaluate('document.querySelector(".v2-tour-stage .tm-page").contentDocument.querySelectorAll("script").length'), 0, `${id} snapshot runs no scripts`);
        }
        assert.equal(await evaluate('/示范|示例数据|匿名/.test(document.querySelector(".v2-tour-root").innerText)'), false, `${id} is not labelled as a demo`);
        if (id !== 'opsDrafts') {
            // 工作流流程线标出当前步骤；页面上的 2 个重点按钮有编号标注，卡片里有对应说明。
            assert.equal(await evaluate('document.querySelector(".v2-tour-root.is-flow .v2-tour-flow li.is-current")?.dataset.flow'), id, `${id} is the current flow step`);
            await until(`(() => { const pins = [...document.querySelectorAll('.v2-tour-pin')]; return pins.length === 2 && pins.every(pin => { const r = pin.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }); })()`);
            assert.equal(await evaluate('document.querySelectorAll(".v2-tour-points li").length'), 2, `${id} lists its key buttons`);
        } else {
            assert.equal(await evaluate('document.querySelector(".v2-tour-root").classList.contains("is-flow") || document.querySelectorAll(".v2-tour-pin").length > 0'), false, 'ops drafts has no flow line or pins');
        }
        assert.equal(await evaluate('window.HomeToolFrame.isOpen() || [...document.querySelectorAll(".v2-tour-root iframe")].some(f => !new URL(f.src).pathname.startsWith("/assets/tour/") || f.getAttribute("sandbox") !== "allow-same-origin")'), false, `${id} does not load the real tool`);
        if (id === 'sla') {
            await evaluate('window.ToolsI18n.setLanguage("en-US"); document.documentElement.dataset.theme = "dark";');
            win.setContentSize(390, 660);
            await until('window.innerWidth <= 400');
            await until('document.querySelector(".v2-tour-title").textContent === "Data Import"');
            await waitForStage('sla');
            // 窄屏下内嵌页按舞台的真实比例铺满，并保持 80% 缩放。
            assert.ok(await evaluate(`(() => { const stage = document.querySelector('.v2-tour-stage').getBoundingClientRect(); const box = document.querySelector('.tm-page-box').getBoundingClientRect(); const frame = document.querySelector('.tm-page'); return Math.abs(box.width - stage.width) < 3 && Math.abs(box.height - stage.height) < 3 && Math.abs(frame.offsetWidth * 0.8 - box.width) < 3; })()`), 'narrow page snapshot fills the stage at 80% zoom');
            const narrowLayout = await evaluate(`(() => {
                const card = document.querySelector('.v2-tour-card').getBoundingClientRect();
                const next = document.querySelector('[data-tour-next]').getBoundingClientRect();
                return { card: card.toJSON(), next: next.toJSON(), width: innerWidth, height: innerHeight };
            })()`);
            const { card, next: nextButton, width, height } = narrowLayout;
            assert.ok(card.left >= 0 && card.right <= width && card.bottom <= height
                && nextButton.bottom <= card.bottom, `narrow window keeps guide and next button visible: ${JSON.stringify(narrowLayout)}`);
            win.setContentSize(1440, 960);
            await until('window.innerWidth >= 1400');
            await evaluate('window.ToolsI18n.setLanguage("zh-CN"); document.documentElement.dataset.theme = "light";');
            await until('document.querySelector(".v2-tour-title").textContent === "数据导入"');
        }
    }
    await next();
    assert.equal(await evaluate('document.querySelector(".v2-tour-root").classList.contains("is-staged")'), false);
    await waitForFocus('#v2AlertBtn');
    await next();
    await until(`document.querySelector(".v2-tour-eyebrow").textContent.trim() === "${stepCount} / ${stepCount}"`);
    // 账户菜单有展开动画，等高亮框跟上菜单的最终尺寸。
    await until('(() => { const pop = document.querySelector(".v2-account.is-open"); return pop && document.querySelector(".v2-tour-ring").getBoundingClientRect().width >= pop.getBoundingClientRect().width; })()').catch(() => {});
    const accountStep = await evaluate(`(() => {
        const pop = document.querySelector(".v2-account.is-open");
        const ring = document.querySelector(".v2-tour-ring");
        const popRect = pop ? pop.getBoundingClientRect() : null;
        const ringRect = ring ? ring.getBoundingClientRect() : null;
        return { popOpen: !!pop, ringW: ringRect ? ringRect.width : 0, popW: popRect ? popRect.width : 0 };
    })()`);
    assert.equal(accountStep.popOpen, true, 'final step opens account popup');
    assert.ok(accountStep.ringW >= accountStep.popW && accountStep.popW > 100, `final step spotlights .v2-account.is-open (${JSON.stringify(accountStep)})`);
    await evaluate('document.querySelector("[data-tour-next]").click(); true');
    await until('!window.HomeProductTour.isOpen()');
    assert.equal(await evaluate('!!document.querySelector(".v2-account.is-open")'), false, 'finishing the tour closes account popup');
    assert.equal(chatRequests.length, 0);

    // 5. Dirty tool frame leave-guard uses AppDialog (no native confirm) and preserves open frame on cancel.
    await evaluate(`window.HomeToolFrame.open('/requirements', { label: 'Requirements', skipConfirm: true }); true`);
    await until(`(() => { const fw = document.querySelector('.v2-tool-frame-view')?.contentWindow; return window.HomeToolFrame.isOpen() && fw && fw.location.pathname === '/requirements' && fw.document.readyState === 'complete'; })()`);
    await evaluate(`(() => {
        const fw = document.querySelector('.v2-tool-frame-view').contentWindow;
        fw.__dhIsDirty = () => true;
        fw.__dhConfirmLeave = hostConfirm => hostConfirm('Unsaved fixture changes?');
    })()`);
    await evaluate('window.HomeProductTour.replay()');
    for (let i = 0; i < 12 && !(await evaluate('document.querySelector(".v2-tour-eyebrow")?.textContent.startsWith("6 /")')); i++) {
        await next();
        await wait(80);
    }
    await waitForStage('uivf12');
    await evaluate('document.querySelector(".v2-tour-skip").click()');
    assert.equal(await evaluate('document.querySelector("#v2ToolFrame iframe").contentWindow.__dhIsDirty()'), true,
        'replaying the tour preserves an unfinished tool page');
    assert.equal(await evaluate('new URLSearchParams(location.search).get("app")'), '/requirements');
    await evaluate('window.HomeToolFrame.close()');
    await until('!!document.querySelector("#platformConfirmModal.open, .app-dialog")');
    // Cancel leave -> stays in tool frame
    await evaluate('document.querySelector("#platformConfirmModal.open .nav-confirm-cancel, .app-dialog [data-dialog=\\"cancel\\"]").click(); true');
    await until('!document.querySelector("#platformConfirmModal.open, .app-dialog")');
    assert.equal(await evaluate('window.HomeToolFrame.isOpen()'), true, 'cancel keeps tool frame open');
    // Confirm leave -> closes tool frame
    await evaluate('window.HomeToolFrame.close(); true');
    await until('!!document.querySelector("#platformConfirmModal.open .nav-confirm-submit, .app-dialog [data-dialog=\\"ok\\"]")');
    await evaluate('document.querySelector("#platformConfirmModal.open .nav-confirm-submit, .app-dialog [data-dialog=\\"ok\\"]").click(); true');
    await until('!window.HomeToolFrame.isOpen()');
    assert.deepEqual(await evaluate('window.__nativeDialogs'), [], 'no native alert/confirm/prompt was called');

    // Verify AppDialog light-theme CSS renders light card in html[data-theme="light"]
    await evaluate(`(() => {
        document.documentElement.dataset.theme = 'light';
        window.__savedNavConfirm = window.showPlatformConfirm;
        window.showPlatformConfirm = null;
        window.AppDialog.alert('Light check', { title: 'Theme' });
    })()`);
    await until('!!document.querySelector(".app-dialog-card")');
    const cardStyle = await evaluate(`(() => { const s = getComputedStyle(document.querySelector(".app-dialog-card")); return { bgImg: s.backgroundImage, color: s.color }; })()`);
    assert.ok(cardStyle.bgImg.includes('255, 255, 255') && cardStyle.color === 'rgb(15, 23, 42)', `AppDialog card renders light surface on light theme: ${JSON.stringify(cardStyle)}`);
    await evaluate('document.querySelector(".app-dialog [data-dialog=\\"ok\\"]").click(); window.showPlatformConfirm = window.__savedNavConfirm; true');
    await until('!document.querySelector(".app-dialog")');

    // 6. More flyout normalization dedup check.
    const duplicateLinks = await evaluate(`(() => {
        document.querySelector('[data-v2-flyout="more"]').click();
        const items = [...document.querySelectorAll('.v2-flyout a.v2-pop-item')].map(a => a.getAttribute('href'));
        return items.length - new Set(items.map(h => h.replace(/\\.html$/i, '').replace(/\\/+$/, ''))).size;
    })()`);
    assert.equal(duplicateLinks, 0, 'More flyout has zero duplicate normalized paths');

    assert.deepEqual(await evaluate('window.fixtureErrors'), []);
    console.log('PASS: tour runs in order with static chat and tool demos, never loads tools or sends chats, preserves drafts, and supports narrow layout.');
    win.destroy();
    server.close();
    app.exit(0);
}).catch(err => {
    console.error(err);
    win?.destroy();
    server?.close();
    app.exit(1);
});
