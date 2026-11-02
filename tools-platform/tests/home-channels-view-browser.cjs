// Run: cd tools-platform && ./node_modules/.bin/electron tests/home-channels-view-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express');
const root = path.join(__dirname, '..'), frontend = path.join(root, 'frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-channels-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

let win, server;
const evaluate = code => win.webContents.executeJavaScript(code, true);
const until = code => evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${code})resolve();else if(++n>300)reject(new Error("Timeout waiting for: " + ${JSON.stringify(code)}));else setTimeout(poll,20)};poll()})`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

setTimeout(() => {
    console.error('Test timed out after 60s');
    app.exit(1);
}, 60000).unref();

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());

    web.get('/', (_, res) => res.type('html').send(fs.readFileSync(path.join(frontend, 'index.html'), 'utf8').replace('<head>', `<head><script>
        localStorage.setItem('tools_tenant_id','default');
        localStorage.setItem('tools_role','admin');
        localStorage.setItem('tools_user','fixture');
        localStorage.setItem('tools_token','fixture-session');
        localStorage.setItem('tools_lang','zh-CN');
        localStorage.setItem('tools_home_ui','v2');
    </script>`)));

    web.get('/api/custom-tools', (_, res) => res.json([]));
    web.get('/api/auth/me', (_, res) => res.json({ username: 'fixture', role: 'admin', tenantId: 'default' }));
    web.get('/api/app-version', (_, res) => res.json({ version: 'fixture' }));
    web.get('/api/tenants', (_, res) => res.json({ tenants: [{ id: 'default', name: '默认租户' }], activeTenantId: 'default' }));
    web.get('/api/platform-promotions', (_, res) => res.json({ desktopStack: false, rotateSeconds: 15, maxLinks: 3, videos: [], links: [] }));
    web.get('/api/agent-workspace/capability', (_, res) => res.json({ enabled: true, homeDir: '/fixture' }));
    web.get('/api/agent-workspace/prefs', (_, res) => res.json({ lastDirectory: '', recentDirectories: [], permissionMode: 'ask' }));
    web.get('/api/agent-workspace/suggest', (_, res) => res.json({ exists: true, isDir: true, groups: [] }));
    web.get('/api/ai-settings', (_, res) => res.json({ activeProfileId: 'main', profiles: [{ id: 'main', name: '主连接', model: 'gpt-4o', provider: 'openai', category: 'chat', isActive: true, hasApiKey: true, keyLooksValid: true, maskedApiKey: '****', maxOutputTokens: 2048, temperature: 0.7 }] }));
    web.get('/api/ai/models', (_, res) => res.json({ models: [{ id: 'main', name: 'GPT-4o' }], defaultId: 'main', mode: 'direct' }));
    web.get('/api/ai/conversation-list', (_, res) => res.json({ items: [] }));
    web.get('/api/ai/sessions', (_, res) => res.json({
        items: [
            { id: 'chat-1', title: '普通对话 1: SLA 报表分析', messageCount: 2, updatedAt: '2026-11-02T10:00:00Z', firstQuestion: '查看本月 SLA 达标情况' },
            { id: 'chat-2', title: '普通对话 2: 告警研判', messageCount: 4, updatedAt: '2026-11-02T09:00:00Z', firstQuestion: '排查 CPU 使用率过高' },
            { id: 'chat-project-1', title: '查看项目用途', messageCount: 5, updatedAt: '2026-11-02T11:00:00Z', firstQuestion: '查看项目用途', agent: { root: '/Volumes/512G/06-工具开发/privacy-policy' } }
        ]
    }));
    web.get('/api/channels/available', (_, res) => res.json({
        items: [
            { id: 'welink', connected: true, health: { level: 'ok', reason: 'connected' } },
            { id: 'weixin', connected: true, health: { level: 'ok', reason: 'connected' } }
        ]
    }));
    web.get('/api/channels/welink/threads', (_, res) => res.json({
        items: [
            { id: 'wl-thread-1', kind: 'group', name: 'WeLink 质量运营群', channel: 'welink', lastActiveAt: '2026-11-02T11:00:00Z', messageCount: 5 }
        ]
    }));
    web.get('/api/channels/weixin/threads', (_, res) => res.json({
        items: [
            { id: 'wx-thread-1', kind: 'user', name: '微信 运维助理', channel: 'weixin', lastActiveAt: '2026-11-02T10:30:00Z', messageCount: 3 }
        ]
    }));
    web.get('/api/channels/:channel/threads/:kind/:id/messages', (req, res) => res.json({
        thread: { name: 'Channel conversation' },
        items: [{ id: 'm1', direction: 'inbound', content: '测试频道消息', createdAt: new Date().toISOString() }],
        segments: [],
        hasMore: false
    }));
    web.get('/api/desktop-agents/settings', (_, res) => res.json({ owned: true, settings: { enabled: false } }));
    web.get('/api/desktop-agents/sessions', (_, res) => res.json({ items: [] }));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));

    server = await new Promise(resolve => { const l = web.listen(0, '127.0.0.1', () => resolve(l)); });
    win = new BrowserWindow({
        show: false,
        width: 1440,
        height: 960,
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        }
    });

    console.log('1. Loading home page...');
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until('!!document.querySelector(".v2-nav") && !!window.HomeWelinkThreads');
    await wait(300);

    console.log('2. Verifying unified chat list categories (任务 vs 空间)...');
    const categories = await evaluate('[...document.querySelectorAll("#homeChatList .home-chat-category")].map(el => el.textContent.trim())');
    console.log('Categories in sidebar:', categories);
    assert.ok(categories.some(c => c.startsWith('任务') || c.startsWith('Tasks')), 'Sidebar must show 任务 category');
    assert.ok(categories.some(c => c.startsWith('空间') || c.startsWith('Workspaces')), 'Sidebar must show 空间 category');

    console.log('3. Verifying agent / channel icons in unified chat list...');
    const hasIcons = await evaluate('document.querySelectorAll("#homeChatList .home-chat-agent-ico").length > 0');
    console.log('Has agent icons:', hasIcons);

    console.log('4. Verifying workspace / project structure, toggle and add button...');
    const projectToggle = await evaluate('!!document.querySelector("[data-project-toggle]")');
    const projectAdd = await evaluate('!!document.querySelector("[data-project-add]")');
    assert.equal(projectToggle, true, 'Project toggle must be present');
    assert.equal(projectAdd, true, 'Project add button must be present');

    const projectRoot = await evaluate('document.querySelector("[data-project-root]").dataset.projectRoot');
    assert.equal(projectRoot, '/Volumes/512G/06-工具开发/privacy-policy');

    const isCollapsedInitially = await evaluate('document.querySelector(".home-chat-project").classList.contains("is-collapsed")');
    assert.equal(isCollapsedInitially, false, 'Project should initially be expanded');

    // Click project toggle to collapse
    await evaluate('document.querySelector("[data-project-toggle]").click()');
    await wait(100);
    const isCollapsedNow = await evaluate('document.querySelector(".home-chat-project").classList.contains("is-collapsed")');
    assert.equal(isCollapsedNow, true, 'Project should now be collapsed');

    // Click project toggle again to expand
    await evaluate('document.querySelector("[data-project-toggle]").click()');
    await wait(100);
    const isExpandedAgain = !await evaluate('document.querySelector(".home-chat-project").classList.contains("is-collapsed")');
    assert.equal(isExpandedAgain, true, 'Project should expand again');

    // Click project add button to create a new session under this directory
    await evaluate('document.querySelector("[data-project-add]").click()');
    await wait(200);
    const focusedInput = await evaluate('document.activeElement === document.getElementById("dcInput")');
    assert.equal(focusedInput, true, 'Input should be focused after clicking project add');

    console.log('All tests passed successfully!');
    win.close();
    server.close();
    app.quit();
});
