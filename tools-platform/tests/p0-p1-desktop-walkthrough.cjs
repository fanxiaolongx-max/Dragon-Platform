// Desktop client interactive click-through walkthrough for P0 + P1 + Desktop Pet cleanup.
// Uses isolated temp userData, temp git repo, and real Electron BrowserWindow + BrowserView.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const express = require('express');

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p0-p1-walkthrough-')));
app.setPath('userData', path.join(temp, 'profile'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const repo = path.join(temp, 'demo-repo');
fs.mkdirSync(repo);
const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${os.devNull}`, ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
}).trim();
git('init', '-b', 'main');
fs.writeFileSync(path.join(repo, 'index.html'), '<button id="hero-cta">Start</button>\n');
git('add', 'index.html');
git('-c', 'user.name=Tester', '-c', 'user.email=tester@example.test', 'commit', '--no-gpg-sign', '-m', 'Initial commit');

const rootDir = path.join(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
let win, server, targetServer, stack;

const evaluate = js => win.webContents.executeJavaScript(js, true);
async function until(expr, msg) {
    for (let i = 0; i < 200; i++) {
        if (await evaluate(`Boolean(${expr})`)) return;
        await wait(35);
    }
    throw new Error(`Timeout waiting for: ${msg || expr}`);
}
async function untilHost(fn, msg) {
    for (let i = 0; i < 200; i++) {
        if (await fn()) return;
        await wait(35);
    }
    throw new Error(`Timeout waiting for: ${msg || 'condition'}`);
}

setTimeout(() => {
    console.error('Walkthrough global timeout');
    app.exit(1);
}, 60000).unref();

app.whenReady().then(async () => {
    // 1. Verify desktop pet cleanup defaults
    const petManager = require('../desktop-pet/pet-manager');
    assert.equal(petManager.isPetAvailable(), false, 'desktop pet must be disabled by default');
    assert.equal(petManager.isPetEnabled(), false, 'desktop pet enabled flag must default to false');

    // 2. Start local target page for Design Mode element picking
    targetServer = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html><body style="margin:0;padding:24px;font-family:sans-serif"><h1 id="title">Demo App</h1><button id="hero-cta" class="primary-btn" style="padding:12px 20px;border-radius:10px;background:#2563eb;color:#fff;border:0;font-size:15px">Upgrade Now</button></body></html>');
    });
    await new Promise(resolve => targetServer.listen(0, '127.0.0.1', resolve));
    const targetUrl = `http://127.0.0.1:${targetServer.address().port}/`;

    // 3. Boot isolated Express app with real agent-workspace router & controlled desktop-agent endpoints
    const { runWithTenant } = require('../backend/models/tenant-context');
    const workspaceRouter = require('../backend/routes/agent-workspace');
    const web = express();
    web.use(express.json());

    const inboxItems = [
        { id: 'apr-1', code: '1234', toolName: 'run_command', summary: 'npm test', chatSessionId: 'chat_1' }
    ];
    const desktopSessions = [
        { provider: 'codex', providerName: 'Codex', id: 'cx-1', title: 'Refactor auth', busy: true }
    ];
    const discussionRequests = [];
    const jobs = new Map();
    const ALL = ['codex', 'claudecode', 'antigravity', 'workbuddy'];
    const NAMES = { codex: 'Codex', claudecode: 'Claude Code', antigravity: 'Antigravity', workbuddy: 'WorkBuddy' };

    web.get('/', (_req, res) => {
        const raw = fs.readFileSync(path.join(rootDir, 'frontend/index.html'), 'utf8');
        const html = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
        const scripts = [
            '/js/shared/i18n.js',
            '/js/shared/app-dialog.js',
            '/js/shared/sidebar-resize.js',
            '/js/home/home-mode.js',
            '/js/home/workspace.js',
            '/js/home/workspace-panel.js',
            '/js/home/browser-sidebar.js',
            '/js/home/terminal-sidebar.js',
            '/js/home/dragon-claw.js',
            '/js/home/agent-discussion.js',
            '/js/home/approval-inbox.js',
            '/js/home/agent-radar.js'
        ].map(src => `<script src="${src}"></script>`).join('');
        const boot = `<script>localStorage.setItem('tools_user','alice');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_super','1');localStorage.setItem('tools_tenant_id','default');localStorage.setItem('tools_token','fixture');</script>`;
        res.type('html').send(html.replace('</body>', `${boot}${scripts}</body>`));
    });

    web.use('/api/agent-workspace', (req, _res, next) => {
        req.user = { username: 'alice', role: 'admin', isSuper: true };
        runWithTenant('default', next);
    });
    // Override inbox for radar test before mounting workspaceRouter
    web.get('/api/agent-workspace/inbox', (_req, res) => res.json({ items: inboxItems, canApprove: true }));
    web.get('/api/agent-workspace/inbox/settings', (_req, res) => res.json({ settings: { enabled: false, targets: [] }, channels: [], delays: [60], canConfigure: true }));
    web.use('/api/agent-workspace', workspaceRouter);

    web.post('/api/ai/uploads', (_req, res) => {
        res.json({ files: [{ path: '/tmp/picked-element.png', name: 'picked-element.png', size: 1024 }] });
    });
    web.get('/api/ai/models', (_req, res) => res.json({ models: [{ id: 'gemini-test', name: 'Gemini Test' }] }));
    web.get('/api/ai/sessions', (_req, res) => res.json({ items: [] }));
    web.get('/api/asset-version', (_req, res) => res.json({ version: 'walkthrough' }));
    web.get('/api/channels/available', (_req, res) => res.json({ items: [] }));
    web.get('/api/desktop-agents/settings', (_req, res) => res.json({
        owned: true,
        settings: { enabled: true, allowSend: true, claudeAutomation: true, providers: Object.fromEntries(ALL.map(k => [k, true])) }
    }));
    web.get('/api/desktop-agents/sessions', (_req, res) => res.json({
        providers: ALL.map(id => ({ id, enabled: true, connected: true, canSend: true })),
        items: desktopSessions
    }));
    web.get('/api/desktop-agents/discussions/:id', (_req, res) => res.json({ settings: null, activeRun: null }));
    web.post('/api/desktop-agents/discussion-runs', (req, res) => {
        discussionRequests.push(req.body);
        const wt1 = path.join(temp, 'wt-codex');
        const wt2 = path.join(temp, 'wt-workbuddy');
        const job = {
            id: req.body.requestId,
            sessionId: req.body.sessionId || 'race-chat-1',
            status: 'done',
            strategy: req.body.strategy || 'sequential',
            parallelWorktrees: Boolean(req.body.parallelWorktrees),
            reports: (req.body.providers || []).map((p, idx) => ({
                provider: p,
                agent: NAMES[p] || p,
                round: 1,
                status: 'done',
                text: `${NAMES[p] || p} parallel solution ready.`,
                worktreeRoot: idx === 0 ? wt1 : wt2,
                worktreeBranch: `codex/workspace-race-${idx + 1}`,
                diffSummary: { files: 2, added: 18 + idx * 5, removed: 3 }
            }))
        };
        jobs.set(job.id, job);
        res.status(202).json(job);
    });
    web.get('/api/desktop-agents/discussion-runs/:id', (req, res) => res.json(jobs.get(req.params.id)));
    web.use(express.static(path.join(rootDir, 'frontend')));

    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 4. Mount real Electron BrowserWindow + preload + desktop-browser-sidebar + promo-stack
    const extensions = path.join(temp, 'extensions.json');
    fs.writeFileSync(extensions, JSON.stringify({ imported: [], disabled: ['auto:icpm', 'bundled:chrome-capture-pro', 'bundled:overseas-salary-calculator'] }));
    stack = require('../desktop-promo/promo-stack').createPromoStack({ statePath: path.join(temp, 'stack.json'), extensionsStatePath: extensions });
    require('../desktop-browser-sidebar').registerBrowserSidebar({
        ipcMain,
        getWindow: () => win,
        getBaseUrl: () => baseUrl,
        browser: stack
    });

    win = new BrowserWindow({
        show: true,
        width: 1440,
        height: 920,
        webPreferences: {
            preload: path.join(rootDir, 'electron-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        }
    });
    await win.loadURL(baseUrl);
    await until('window.DragonClaw && window.DragonClawWorkspace && window.DragonAgentRadar && window.DragonBrowserSidebar && window.HomeAgentDiscussion', 'core modules');

    // 5. Walk through P1-2: Global Agent Status Radar
    await until('document.querySelector(".dc-radar-pill")?.textContent.includes("待你确认") || document.querySelector(".dc-radar-pill")?.textContent.includes("needs input")', 'radar blocked pill');
    await evaluate('document.querySelector(".dc-radar-pill").click()');
    await until('!document.querySelector(".dc-radar-popover").hidden && document.querySelectorAll(".dc-radar-item").length >= 1', 'radar popover opened');
    assert.ok(await evaluate('document.querySelector(".dc-radar-popover").textContent.includes("run_command")'), 'radar shows approval item');
    await wait(80);
    fs.writeFileSync(path.join(temp, 'walkthrough-1-radar.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector(".dc-radar-pill").click()');
    await until('document.querySelector(".dc-radar-popover").hidden', 'radar popover closed');

    // 6. Walk through P0-1 & P0-2: Workspace -> New Worktree -> File edit -> Diff view -> Line annotation -> Insert -> Merge back!
    await evaluate(`window.DragonClawWorkspace.selectDirectory(${JSON.stringify(repo)})`);
    await until('document.querySelector(".dc-branch-picker") && document.querySelector(".dc-worktree-picker")', 'git chips rendered');
    await evaluate('document.querySelector(".dc-worktree-picker summary").click(); document.querySelector("[data-wsp-action=new-worktree]").click()');
    await until('document.querySelector(".wsp-worktree-bar")', 'worktree lifecycle bar appeared');
    const wtRoot = await evaluate('window.DragonClawWorkspace.getRoot()');
    assert.ok(wtRoot && wtRoot !== repo && wtRoot.includes('.dragonclaw-worktrees'), 'switched into isolated worktree');

    // Modify file inside worktree and open workspace panel
    fs.writeFileSync(path.join(wtRoot, 'index.html'), '<button id="hero-cta" class="btn">Start</button>\n<p>Added line</p>\n');
    await evaluate('window.DragonClawWorkspace.open(); window.DragonClawWorkspace.selectDirectory(window.DragonClawWorkspace.getRoot())');
    await until('document.querySelector("[data-wsp-diff]")', 'change row appeared');
    await evaluate('document.querySelector("[data-wsp-diff]").click()');
    await until('document.querySelectorAll("[data-wsp-diff-annotate]").length > 0', 'diff lines with annotate button appeared');

    // Click '+' on an added line, type review note, save it, insert into composer
    await evaluate('document.querySelector(".wsp-diff-add [data-wsp-diff-annotate]").click()');
    await until('document.querySelector("[data-wsp-diff-input]")', 'inline diff note editor opened');
    await evaluate('const ta=document.querySelector("[data-wsp-diff-input]"); ta.value="请把这个按钮改成主要渐变样式"; document.querySelector("[data-wsp-diff-save]").click()');
    await until('document.querySelector(".wsp-diff-note") && document.querySelector(".wsp-review-bar")', 'saved diff note and review bar');
    fs.writeFileSync(path.join(temp, 'walkthrough-2-diff-notes-worktree.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("[data-wsp-notes-send=insert]").click()');
    await until('dcInput.value.includes("请把这个按钮改成主要渐变样式") && dcInput.value.includes("index.html:L")', 'review note inserted into composer');

    // Click "Merge -> main" in the Worktree bar, fill commit prompt & confirm modal via real AppDialog clicks!
    await evaluate('dcInput.value=""; dcInput.dispatchEvent(new Event("input",{bubbles:true})); document.querySelector("[data-wsp-action=merge-worktree]").click()');
    await until('document.querySelector(".app-dialog.open .app-dialog-input")', 'commit message prompt opened');
    await evaluate('document.querySelector(".app-dialog-input").value="feat: update hero button"; document.querySelector(".app-dialog-btn.primary").click()');
    await until('document.querySelector(".app-dialog.open") && !document.querySelector(".app-dialog-input")', 'merge confirm modal opened');
    await evaluate('document.querySelector(".app-dialog-btn.primary").click()');
    await until('!document.querySelector(".wsp-worktree-bar") && window.DragonClawWorkspace.getRoot() === ' + JSON.stringify(repo), 'merged back to main and cleaned up worktree');
    assert.ok(fs.readFileSync(path.join(repo, 'index.html'), 'utf8').includes('Added line'), 'main repo received merged worktree changes');
    assert.equal(fs.existsSync(wtRoot), false, 'worktree directory cleaned up');

    // 7. Walk through P1-3: DragonTAC Parallel Race + Worktree UI
    await evaluate('window.DragonClawWorkspace.close(); document.querySelector("[data-tac-start]").click()');
    await until('document.querySelector("[data-connector=codex]") && !document.querySelector("[data-connector=codex]").disabled', 'connectors ready');
    await evaluate('document.querySelector("[data-connector=codex]").click(); document.querySelector("[data-connector=workbuddy]").click()');
    await until('!document.querySelector("[data-tac-strategy]").hidden', 'strategy panel visible');
    await evaluate('document.querySelector("[data-tac-strat=parallel]").click()');
    await until('!document.querySelector("[data-tac-wt-row]").hidden', 'parallel worktree checkbox visible');
    await evaluate('document.querySelector("[data-tac-wt-toggle]").click(); document.querySelector("[data-tac-start]").click()');
    await evaluate('dcInput.value="Implement hero CTA improvements"; dcInput.dispatchEvent(new Event("input",{bubbles:true})); dcComposer.requestSubmit()');
    await until('document.querySelectorAll(".dc-tac-wt-bar").length === 2', 'parallel worktree race comparison cards rendered');
    assert.equal(discussionRequests[0].strategy, 'parallel');
    assert.equal(discussionRequests[0].parallelWorktrees, true);
    assert.equal(discussionRequests[0].workspaceRoot, repo);
    fs.writeFileSync(path.join(temp, 'walkthrough-3-parallel-race.png'), (await win.webContents.capturePage()).toPNG());

    // 8. Walk through P1-1: Electron Native Dragon Browser Sidebar Design Mode (real BrowserView click!)
    await evaluate('document.getElementById("dcBrowserToggle").click()');
    await until('!document.getElementById("dcBrowserPanel").hidden', 'browser sidebar visible');
    await untilHost(() => win.getBrowserViews().length >= 1, 'native BrowserView attached');
    const bv = win.getBrowserViews()[0];
    await evaluate(`const urlInput=document.querySelector(".dc-browser-address input"); urlInput.value=${JSON.stringify(targetUrl)}; urlInput.closest("form").requestSubmit();`);
    for (let i = 0; i < 150; i++) {
        const u = bv.webContents.getURL();
        if (u.startsWith('http://127.0.0.1:') && !bv.webContents.isLoading()) break;
        await wait(40);
    }
    await evaluate('dcInput.value=""; dcInput.dispatchEvent(new Event("input",{bubbles:true})); document.querySelector("[data-browser=pick-element]").click()');
    await until('document.querySelector("[data-browser=pick-element]").classList.contains("is-picking")', 'pick mode active');
    await wait(120);
    const btnPos = await bv.webContents.executeJavaScript('(()=>{const r=document.getElementById("hero-cta").getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
    bv.webContents.sendInputEvent({ type: 'mouseMove', x: btnPos.x, y: btnPos.y });
    await wait(60);
    bv.webContents.sendInputEvent({ type: 'mouseDown', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1 });
    bv.webContents.sendInputEvent({ type: 'mouseUp', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1 });
    await until('dcInput.value.includes("#hero-cta") && dcInput.value.includes("Upgrade Now")', 'picked element injected into composer');
    assert.ok(await evaluate('!document.querySelector("[data-browser=pick-element]").classList.contains("is-picking")'), 'pick mode exits after click');
    fs.writeFileSync(path.join(temp, 'walkthrough-4-design-mode.png'), (await win.webContents.capturePage()).toPNG());

    console.log('PASS_WALKTHROUGH', temp);
    stack?.destroy?.();
    win?.destroy?.();
    server?.close?.();
    targetServer?.close?.();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    await require('../backend/models/app-db').closeDatabase();
    app.exit(0);
}).catch(err => {
    console.error('WALKTHROUGH_FAILED:', err);
    try { stack?.destroy?.(); win?.destroy?.(); server?.close?.(); targetServer?.close?.(); } catch {}
    app.exit(1);
});
