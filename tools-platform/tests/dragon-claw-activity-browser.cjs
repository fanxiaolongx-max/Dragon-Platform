// Run: node_modules/.bin/electron tests/dragon-claw-activity-browser.cjs
// Uses the production activity/renderer/send functions in an isolated Chromium page, with a scripted AI transport.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-activity-ui-'));
app.setPath('userData', path.join(temp, 'profile'));
const source = fs.readFileSync(path.join(root, 'frontend/js/home/dragon-claw.js'), 'utf8');
const body = acorn.parse(source, { ecmaVersion: 'latest' }).body[0].expression.callee.body.body;
const names = new Set(['lang', 'tx', 'escapeHtml', 'addMessage', 'showThinking', 'createRenderer', 'send']);
const actual = body.filter(node => (node.type === 'FunctionDeclaration' && names.has(node.id.name))
    || (node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === 'TEXT'))).map(node => source.slice(node.start, node.end)).join('\n');
const panelSource = fs.readFileSync(path.join(root, 'frontend/js/home/workspace-panel.js'), 'utf8');
const panelBody = acorn.parse(panelSource, { ecmaVersion: 'latest' }).body[0].expression.callee.body.body;
const panelActual = panelBody.filter(node => node.type === 'FunctionDeclaration' && ['finishMessage', 'settleCard'].includes(node.id.name)).map(node => panelSource.slice(node.start, node.end)).join('\n');
const css = ['dragon-claw.css', 'workspace-panel.css'].map(file => fs.readFileSync(path.join(root, 'frontend/css', file), 'utf8')).join('\n');
let win;
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);
app.whenReady().then(async () => {
    win = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>${css}body{margin:0;background:#0b1426;font-family:system-ui}.dc{margin:24px;min-height:0;padding:24px;align-items:stretch}.dc-thread{display:block;min-height:250px}#dcInput{display:none}</style><section class="dc"><div class="dc-thread" id="thread"></div><textarea id="dcInput"></textarea></section>`)}`);
    await win.webContents.executeJavaScript(`
        let locale = 'zh-CN';
        window.ToolsI18n = { getLanguage: () => locale };
        const el = { thread: document.getElementById('thread'), input: document.getElementById('dcInput') };
        const state = { messages: [], controller: null, sessionId: null };
        const AVATAR = 'data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="15" fill="#2d6861"/></svg>').toString('base64')}';
        const scrollThread = () => {};
        const renderMarkdown = text => text ? '<p>' + escapeHtml(text) + '</p>' : '';
        const setChatting = () => {}, autoResize = () => {}, updateSendButton = () => {}, rememberLastChat = () => {}, addMessageTools = () => {};
        const runSlashCommand = () => false, currentModel = () => null, buildContext = () => '';
        const collectClientToolData = async () => [];
        const waitForAssistant = async () => window.mockApi;
        const workspace = () => ({ getWorkspacePayload: () => null, applyDone() {}, finishMessage, handleEvent(message, event) {
            if (event.type !== 'tool_start') return;
            let log = message.querySelector('.dc-tool-log');
            if (!log) { log = document.createElement('div'); log.className = 'dc-tool-log'; message.querySelector('.dc-msg-main').prepend(log); }
            const row = document.createElement('div'); row.className = 'dc-tool-row is-running'; row.innerHTML = '<span>⌘</span><span>执行命令</span><span>git status</span><span class="dc-tool-state"><i class="dc-tool-spin"></i></span>';  log.append(row);
        } });
        ${actual}
        ${panelActual}
        window.fixture = { send, state, el, create: () => { const message = addMessage('ai'); const activity = showThinking(message); return { message, activity, renderer: createRenderer(message, activity) }; }, language: value => { locale = value; } };
        void 0;
    `);
    const initial = await evaluate(() => {
        window.sample = fixture.create();
        const row = sample.message.querySelector('.dc-activity');
        return { label: row.textContent, dots: row.querySelectorAll('i').length, animation: getComputedStyle(row.querySelector('.dc-activity-orbit')).animationName, bottom: row === sample.message.querySelector('.dc-msg-main').lastElementChild };
    });
    assert.match(initial.label, /正在思考…/);
    assert.equal(initial.dots, 3);
    assert.equal(initial.animation, 'dc-orbit');
    assert.equal(initial.bottom, true);
    await evaluate(() => sample.activity.event({ type: 'tool_start', callId: 'a', tool: 'run_command' }));
    assert.match(await evaluate(() => sample.message.querySelector('.dc-activity').textContent), /正在执行命令…/);
    await evaluate(() => sample.activity.event({ type: 'approval', callId: 'a' }));
    assert.equal(await evaluate(() => getComputedStyle(sample.message.querySelector('.dc-activity-orbit')).animationPlayState), 'paused');
    await evaluate(() => { sample.activity.event({ type: 'approval_result', callId: 'a' }); sample.activity.event({ type: 'tool_result', callId: 'a' }); });
    assert.match(await evaluate(() => sample.message.querySelector('.dc-activity').textContent), /正在整理结果…/);
    await evaluate(() => sample.renderer.append('A partial answer'));
    assert.equal(await evaluate(() => sample.message.querySelector('.dc-activity').hidden), true);
    await evaluate(() => new Promise(resolve => setTimeout(resolve, 1100)));
    assert.match(await evaluate(() => sample.message.querySelector('.dc-activity').textContent), /正在生成回复…/);
    await evaluate(() => sample.renderer.finish('Completed answer'));
    assert.equal(await evaluate(() => !!sample.message.querySelector('.dc-activity') || sample.message.hasAttribute('aria-busy')), false);

    // Actual send lifecycle: successful multi-step turn, cancellation with and without tools, failure, unavailable assistant.
    const lifecycle = await evaluate(async () => {
        const results = [];
        for (const mode of ['success', 'abort-empty', 'abort-tools', 'error', 'unavailable']) {
            fixture.el.thread.innerHTML = ''; fixture.state.messages = [];
            window.mockApi = mode === 'unavailable' ? null : { async requestStreamingChat(_payload, callbacks) {
                if (mode !== 'abort-empty') callbacks.onEvent({ type: 'tool_start', callId: 'one', tool: 'run_command' });
                if (mode.startsWith('abort')) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
                if (mode === 'error') throw new Error('Synthetic gateway error');
                callbacks.onEvent({ type: 'tool_result', callId: 'one' });
                callbacks.onStatus({ stage: 'compressing' });
                callbacks.onDelta('Final answer');
                return { reply: 'Final answer' };
            } };
            await fixture.send('fixture question');
            results.push({ mode, activity: document.querySelectorAll('.dc-activity').length, busy: document.querySelectorAll('[aria-busy]').length,
                controller: fixture.state.controller, ai: document.querySelectorAll('.dc-msg--ai').length,
                tools: document.querySelectorAll('.dc-tool-row').length, text: fixture.el.thread.textContent,
                running: document.querySelectorAll('.dc-tool-row.is-running, .dc-tool-spin').length,
                historyHasStatus: fixture.state.messages.some(message => /正在思考|正在整理/.test(message.content)) });
        }
        return results;
    });
    for (const result of lifecycle) {
        assert.equal(result.activity, 0, result.mode);
        assert.equal(result.busy, 0, result.mode);
        assert.equal(result.controller, null, result.mode);
        assert.equal(result.running, 0, result.mode);
        assert.equal(result.historyHasStatus, false, result.mode);
    }
    assert.equal(lifecycle.find(item => item.mode === 'abort-empty').ai, 0);
    assert.equal(lifecycle.find(item => item.mode === 'abort-tools').tools, 1);
    assert.match(lifecycle.find(item => item.mode === 'abort-tools').text, /已停止生成/);
    assert.match(lifecycle.find(item => item.mode === 'error').text, /Synthetic gateway error/);

    await evaluate(() => { fixture.el.thread.innerHTML = ''; fixture.language('en-US'); window.sample = fixture.create(); });
    assert.match(await evaluate(() => sample.message.textContent), /Thinking…/);
    win.setSize(430, 650);
    await evaluate(() => { document.documentElement.dataset.theme = 'light'; document.body.style.background = '#f4f7f9'; });
    const narrow = await evaluate(() => { const row = document.querySelector('.dc-activity'); const rect = row.getBoundingClientRect(); return { right: rect.right, width: innerWidth, color: getComputedStyle(row).color }; });
    assert.ok(narrow.right <= narrow.width);
    assert.equal(narrow.color, 'rgb(148, 191, 183)', 'the chat surface stays dark in the light page theme, so status text keeps sufficient contrast');
    await evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
    fs.writeFileSync(path.join(temp, 'activity-light-narrow.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(1000, 760);
    await evaluate(() => {
        document.documentElement.dataset.theme = 'dark'; document.body.style.background = '#0b1426'; fixture.language('zh-CN');
        sample.message.querySelector('.dc-msg-body').innerHTML = '<p>已完成目录检查，正在汇总结果。</p>';
        sample.message.querySelector('.dc-msg-main').insertAdjacentHTML('afterbegin', '<div class="dc-tool-log"><div class="dc-tool-row is-ok"><span>⌘</span><span>执行命令</span><span>git status --short</span><span class="dc-tool-state">✓ 退出码 0</span></div></div>');
        sample.activity.event({ type: 'tool_start', callId: 'visual', tool: 'run_command' });
        sample.activity.event({ type: 'tool_result', callId: 'visual' });
    });
    await evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
    fs.writeFileSync(path.join(temp, 'activity-dark.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.dc-activity-orbit')).animationName), 'none');
    await evaluate(() => { sample.activity.finish(); sample.activity.event({ type: 'tool_start', callId: 'late', tool: 'read_file' }); });
    await evaluate(() => new Promise(resolve => setTimeout(resolve, 1100)));
    assert.equal(await evaluate(() => document.querySelectorAll('.dc-activity').length), 0, 'late events and timers cannot recreate a completed indicator');
    console.log('PASS: activity stages, streaming gaps, approval pause, success/abort/error cleanup, history isolation, English, narrow/light, reduced motion. Screenshots:', temp);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { win?.destroy(); app.exit(process.exitCode || 0); });
