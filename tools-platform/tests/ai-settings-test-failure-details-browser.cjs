// Run with: ./tools-platform/node_modules/.bin/electron tools-platform/tests/ai-settings-test-failure-details-browser.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const express = require('express');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-details-ui-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

let win;
let server;
const timeout = setTimeout(() => {
    console.error('AI test failure details browser test timed out');
    app.exit(1);
}, 60000);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(code) {
    for (let i = 0; i < 180; i += 1) {
        if (await evaluate(code)) return;
        await wait(30);
    }
    throw new Error('Timeout waiting for: ' + code);
}

app.whenReady().then(async () => {
    let mode = 'fail';
    let lastTestBody = null;
    const web = express();
    web.use(express.json());
    web.get('/', (_req, res) => {
        res.type('html').send(
            fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8').replace(
                '<head>',
                `<head><script>
                localStorage.setItem('tools_token', 'fixture');
                localStorage.setItem('tools_user', 'fixture');
                localStorage.setItem('tools_role', 'admin');
                localStorage.setItem('tools_tenant_id', 'default');
                localStorage.setItem('tools_lang', 'zh-CN');
                </script>`
            )
        );
    });
    web.get('/api/auth/me', (_req, res) => res.json({ username: 'fixture', role: 'admin', tenantId: 'default' }));
    web.get('/api/tenants', (_req, res) => res.json({ tenants: [{ id: 'default', name: 'Default' }], activeTenantId: 'default' }));
    web.get('/api/app-version', (_req, res) => res.json({ version: 'fixture' }));
    web.get('/api/desktop-agents/settings', (_req, res) => res.json({ owned: true, settings: { enabled: false } }));
    web.get('/api/agent-workspace/capability', (_req, res) => res.json({ enabled: false }));
    web.get('/api/ai/models', (_req, res) => res.json({ models: [{ id: 'profile:gw', name: 'dfa_Qwen-V3_6-27B', provider: 'openai-compatible' }], defaultId: 'profile:gw', mode: 'direct' }));
    web.get('/api/ai/sessions', (_req, res) => res.json({ items: [] }));
    web.get('/api/platform-promotions', (_req, res) => res.json({ desktopStack: false, links: [], videos: [] }));
    web.get(['/api/friend-links', '/api/recent-nav', '/api/upload/history', '/api/custom-tools'], (_req, res) => res.json([]));
    web.get('/api/ai-settings', (_req, res) => res.json({
        activeProfileId: 'gw',
        profiles: [{
            id: 'gw',
            name: 'aigateway',
            category: 'chat',
            provider: 'openai-compatible',
            apiBaseUrl: 'https://aigateway.huawei.com/v1',
            model: 'dfa_Qwen-V3_6-27B',
            models: ['dfa_Qwen-V3_6-27B', 'dfa_self_deepseek_v4_flash'],
            maxOutputTokens: 2048,
            temperature: 0.7,
            hasApiKey: true,
            keyLooksValid: true,
            apiKeySource: 'stored',
            maskedApiKey: 'sk-b****eb91',
            isActive: true
        }]
    }));
    web.put('/api/ai-settings/profiles/:id', (_req, res) => res.status(200).json({ ok: true }));
    web.post('/api/ai-settings/profiles/:id/test', (req, res) => {
        lastTestBody = req.body;
        if (mode === 'fail') {
            return res.status(500).json({
                success: false,
                error: '上游返回 HTTP 500：Gateway timeout or incompatible stream parameter',
                details: {
                    provider: req.body?.provider || 'openai-compatible',
                    model: req.body?.model || 'dfa_Qwen-V3_6-27B',
                    endpoint: 'https://aigateway.huawei.com/v1/chat/completions',
                    httpStatus: 500,
                    upstreamStatus: 500,
                    upstreamStatusText: 'Internal Server Error',
                    errorCode: 'GW_INTERNAL_ERROR',
                    durationMs: 491,
                    responseHeaders: {
                        'content-type': 'application/json',
                        'x-request-id': 'req-huawei-500-abc'
                    },
                    request: {
                        protocol: 'openai-compatible',
                        model: 'dfa_Qwen-V3_6-27B',
                        stream: false,
                        maxOutputTokens: 2048,
                        temperature: 0.7
                    },
                    hint: '上游模型网关返回 5xx 错误，可展开详情对照响应原文，或在「高级 / 自定义协议」中调整请求参数。',
                    rawDetail: JSON.stringify({
                        status: 500,
                        source: 'AI-Gateway',
                        code: 'GW_INTERNAL_ERROR',
                        message: 'Model backend stream handling failed for very_long_token=' + 'x'.repeat(240)
                    }, null, 2),
                    timestamp: '2026-11-17T10:20:37.000Z'
                }
            });
        }
        return res.json({
            success: true,
            model: req.body?.model || 'dfa_Qwen-V3_6-27B',
            durationMs: 215,
            reply: 'OK'
        });
    });
    web.use('/api', (_req, res) => res.json({ items: [] }));
    web.use(express.static(path.join(root, 'frontend')));

    server = await new Promise(resolve => {
        const s = web.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    });
    win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 3) console.error('Renderer:', message);
    });
    await win.loadURL(base);
    await until('!!window.HomeShell');

    await evaluate('openNavSettingsModal(); void 0');
    await until('typeof switchNavSettingsTab === "function"');
    await evaluate('switchNavSettingsTab("ai"); void 0');
    await until('!!document.getElementById("navAiTestResult") && !!document.getElementById("navAiProfileName")');

    // 0. Check authMode (6 options), dynamic customAuthHeader field, and verifySsl checkbox
    const authControls = await evaluate(`(() => {
        const select = document.getElementById('navAiAuthMode');
        const opts = [...select.options].map(o => o.value);
        const customWrap = document.getElementById('navAiCustomAuthHeaderWrap');
        const verifySsl = document.getElementById('navAiVerifySsl');
        const initial = { opts, value: select.value, customHidden: customWrap.style.display === 'none', verifyChecked: verifySsl.checked };
        select.value = 'custom';
        handleAiAuthModeChange();
        const customShown = customWrap.style.display !== 'none';
        document.getElementById('navAiCustomAuthHeader').value = 'X-API-Key';
        verifySsl.checked = false;
        const payloadCustom = {
            mode: select.value,
            customHeader: document.getElementById('navAiCustomAuthHeader').value,
            verifyChecked: verifySsl.checked
        };
        select.value = 'bearer';
        handleAiAuthModeChange();
        const hiddenAgain = customWrap.style.display === 'none';
        select.value = 'custom';
        handleAiAuthModeChange();
        return { initial, customShown, payloadCustom, hiddenAgain };
    })()`);
    assert.deepEqual(authControls.initial.opts, ['bearer', 'x-api-key', 'api-key', 'x-goog-api-key', 'none', 'custom']);
    assert.equal(authControls.initial.customHidden, true);
    assert.equal(authControls.initial.verifyChecked, false, '配置里没写 verifySsl 时默认不校验证书（与内网自签证书兼容）');
    assert.equal(authControls.customShown, true);
    assert.equal(authControls.hiddenAgain, true);

    // Stub clipboard so copy button works reliably in headless Electron
    await evaluate(`
        window.__copiedReport = '';
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async text => { window.__copiedReport = text; } }
        });
    `);

    await evaluate('testAiSettingsNow(); void 0');
    await until('!!document.querySelector("#navAiTestResult.fail details.nav-ai-test-details")');

    // 1. Collapsed by default
    const collapsedState = await evaluate(`(() => {
        const result = document.getElementById('navAiTestResult');
        const details = result.querySelector('details.nav-ai-test-details');
        const hint = result.querySelector('.nav-ai-test-hint');
        const badges = [...result.querySelectorAll('.nav-ai-test-badge')].map(el => el.textContent);
        const bodyVisible = getComputedStyle(result.querySelector('.nav-ai-test-details-body')).display !== 'none';
        return { open: details.open, summary: result.querySelector('.nav-ai-test-summary-text')?.textContent, hint: hint?.textContent, badges, bodyVisible };
    })()`);
    assert.equal(collapsedState.open, false, 'failure details must be collapsed by default so UI stays clean');
    assert.match(collapsedState.summary, /测试失败：上游返回 HTTP 500/);
    assert.match(collapsedState.hint, /排查建议：/);
    assert.ok(collapsedState.badges.includes('Upstream 500'));
    assert.ok(collapsedState.badges.includes('491ms'));

    // 2. Manual expand via clicking <summary>
    await evaluate('document.querySelector("#navAiTestResult .nav-ai-test-details-summary").click(); void 0');
    const expandedState = await evaluate(`(() => {
        const result = document.getElementById('navAiTestResult');
        const details = result.querySelector('details.nav-ai-test-details');
        const pre = result.querySelector('.nav-ai-test-raw');
        const kv = [...result.querySelectorAll('.nav-ai-test-kv-row')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]);
        const overflow = navSettingsContent.scrollWidth - navSettingsContent.clientWidth;
        return { open: details.open, preText: pre?.textContent || '', kv, overflow };
    })()`);
    assert.equal(expandedState.open, true, 'clicking summary expands failure details');
    assert.match(expandedState.preText, /"code": "GW_INTERNAL_ERROR"/);
    assert.ok(expandedState.kv.some(([k, v]) => k === '请求地址' && v === 'https://aigateway.huawei.com/v1/chat/completions'));
    assert.ok(expandedState.kv.some(([k, v]) => k === '测试参数' && /stream=false/.test(v)));
    assert.ok(expandedState.overflow <= 2, 'desktop modal has no horizontal overflow with long detail text');

    // 3. Copy failure report button
    await evaluate('document.querySelector(".nav-ai-test-copy-btn").click(); void 0');
    await wait(50);
    const copiedState = await evaluate(`({
        btnText: document.querySelector(".nav-ai-test-copy-btn")?.textContent,
        copied: window.__copiedReport
    })`);
    assert.equal(copiedState.btnText, '已复制');
    assert.match(copiedState.copied, /https:\/\/aigateway\.huawei\.com\/v1\/chat\/completions/);
    assert.match(copiedState.copied, /GW_INTERNAL_ERROR/);

    // 4. Dark mode + narrow mobile width geometry check (no horizontal overflow, distinct contrast)
    await evaluate('document.documentElement.dataset.theme = "dark"');
    win.setContentSize(390, 844);
    await wait(120);
    const darkMobile = await evaluate(`(() => {
        const pre = document.querySelector('.nav-ai-test-raw');
        const result = document.getElementById('navAiTestResult');
        return {
            overflow: navSettingsContent.scrollWidth - navSettingsContent.clientWidth,
            bg: getComputedStyle(result).backgroundColor,
            preRect: pre.getBoundingClientRect().width,
            winW: innerWidth
        };
    })()`);
    assert.ok(darkMobile.overflow <= 2, 'mobile dark expanded details must not overflow horizontally: ' + JSON.stringify(darkMobile));
    assert.ok(darkMobile.preRect > 0 && darkMobile.preRect <= darkMobile.winW);
    assert.notEqual(darkMobile.bg, 'rgb(255, 241, 242)', 'dark mode must override light rose background');

    // 5. Passing test clears failure details cleanly
    mode = 'pass';
    await evaluate('testAiSettingsNow(); void 0');
    await until('!!document.querySelector("#navAiTestResult.ok")');
    const passState = await evaluate(`(() => {
        const result = document.getElementById('navAiTestResult');
        return {
            text: result.textContent,
            hasDetails: !!result.querySelector('.nav-ai-test-details')
        };
    })()`);
    assert.match(passState.text, /测试通过：OK \(215ms\)/);
    assert.equal(passState.hasDetails, false);
    assert.equal(lastTestBody.authMode, 'custom');
    assert.equal(lastTestBody.customAuthHeader, 'X-API-Key');
    assert.equal(lastTestBody.verifySsl, false);

    win.destroy();
    server.close();
    clearTimeout(timeout);
    console.log('PASS: manual expandable failure details render collapsed by default, expand cleanly with KV+raw JSON, copy report, fit dark mobile 390px, and clear on pass.');
    app.exit(0);
}).catch(err => {
    console.error(err);
    win?.destroy();
    server?.close();
    clearTimeout(timeout);
    app.exit(1);
});
