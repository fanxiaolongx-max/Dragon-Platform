// node_modules/.bin/electron tests/ai-settings-onboarding-browser.cjs
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-onboarding-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
    let store = {
        activeProfileId: 'default',
        activeImageProfileId: '',
        profiles: [
            {
                id: 'default',
                name: '默认配置',
                category: 'chat',
                provider: 'gemini',
                authMode: 'x-goog-api-key',
                apiBaseUrl: '',
                model: 'gemini-2.5-flash',
                models: ['gemini-2.5-flash'],
                hasApiKey: false,
                maskedApiKey: '',
                apiKeySource: 'none',
                keyLooksValid: false,
                isActive: true,
                verifySsl: false
            }
        ]
    };
    const recorded = [];

    const web = express();
    web.use(express.json());
    web.use('/css', express.static(path.join(root, 'frontend/css')));
    web.use('/js', express.static(path.join(root, 'frontend/js')));

    web.get('/api/ai-settings', (_req, res) => res.json(store));
    web.post('/api/ai-settings/test', (req, res) => {
        recorded.push({ path: '/api/ai-settings/test', body: req.body });
        res.json({ success: true, model: req.body.model, reply: 'OK', durationMs: 21 });
    });
    web.post('/api/ai-settings/profiles', (req, res) => {
        recorded.push({ path: '/api/ai-settings/profiles', body: req.body });
        const id = req.body.category === 'image' ? 'zeroone-img' : 'zeroone-chat';
        store.profiles.push({
            id,
            name: req.body.name,
            category: req.body.category || 'chat',
            provider: req.body.provider,
            authMode: req.body.authMode,
            apiBaseUrl: req.body.apiBaseUrl,
            model: req.body.model,
            models: req.body.models,
            hasApiKey: true,
            maskedApiKey: 'sk-b***1234',
            apiKeySource: 'stored',
            keyLooksValid: true,
            isActive: req.body.activate === true,
            verifySsl: req.body.verifySsl === true
        });
        if (req.body.activate === true) {
            store.profiles.forEach(p => {
                if (p.id !== id && (p.category || 'chat') === (req.body.category || 'chat')) p.isActive = false;
            });
            if (req.body.category === 'image') store.activeImageProfileId = id;
            else store.activeProfileId = id;
        }
        res.status(201).json({ ...store, createdProfileId: id });
    });
    web.post('/api/ai-settings/profiles/:id/activate', (req, res) => {
        const id = req.params.id;
        recorded.push({ path: `/api/ai-settings/profiles/${id}/activate` });
        const target = store.profiles.find(p => p.id === id);
        if (target) {
            store.profiles.forEach(p => {
                if ((p.category || 'chat') === (target.category || 'chat')) p.isActive = p.id === id;
            });
            if (target.category === 'image') store.activeImageProfileId = id;
            else store.activeProfileId = id;
        }
        res.json(store);
    });
    web.put('/api/ai-settings/profiles/:id', (req, res) => {
        const id = req.params.id;
        recorded.push({ path: `/api/ai-settings/profiles/${id}`, method: 'PUT', body: req.body });
        const target = store.profiles.find(p => p.id === id);
        if (target) {
            Object.assign(target, req.body);
            if (req.body.apiKey) {
                target.hasApiKey = true;
                target.keyLooksValid = true;
                target.apiKeySource = 'stored';
                target.maskedApiKey = 'sk-b***1234';
            }
        }
        res.json(store);
    });
    web.post('/api/ai-settings/profiles/:id/test', (req, res) => {
        recorded.push({ path: `/api/ai-settings/profiles/${req.params.id}/test`, body: req.body });
        if (req.body.verifySsl === false) {
            return res.status(504).json({
                success: false,
                error: '连接模型超时（30017ms，超过 30 秒未响应）',
                details: { httpStatus: 504, errorCode: '20', cause: 'This operation was aborted' }
            });
        }
        res.json({ success: true, model: req.body.model, reply: 'OK', durationMs: 36 });
    });

    web.get('/', (_req, res) => {
        res.type('html').send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/css/shared.css">
<style>body{margin:0;padding:16px;font:13px system-ui;background:#f8fafc}.wrap{max-width:760px;margin:0 auto}</style>
</head>
<body>
<div class="wrap">
  <div id="navSettingsSaveState"></div>
  <div id="navSettingsContent"></div>
</div>
<script>
window.navState = { lang: 'zh-CN', aiCategory: 'chat', aiSelectedProfileId: null, aiQuickAvailable: true, aiQuickDraftBaseUrl: 'http://models.ascend.huawei.com', aiQuickDraftToken: '' };
window.navEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.getAuthHeaderForNav = () => ({});
window.navLocaleText = (zh, en) => zh || en;
window.navT = k => ({
  'nav.ai.empty':'暂无配置','nav.ai.categoryLabel':'模型分类','nav.ai.chatIcon':'文','nav.ai.chatTitle':'文心 · 对话','nav.ai.chatSummary':'{count} 项',
  'nav.ai.imageIcon':'丹','nav.ai.imageTitle':'丹青 · 绘图','nav.ai.imageSummary':'{count} 项','nav.ai.plhKeep':'已保存：','nav.ai.plhToken':'输入 API Token',
  'nav.ai.plhTokenNone':'无需密钥','nav.ai.help':'配置全局 AI 模型','nav.ai.profileLabel':'方案','nav.ai.profileNew':'新建','nav.ai.profileClone':'克隆',
  'nav.ai.profileActive':'当前启用','nav.ai.profileActivate':'设为当前','nav.ai.profileDelete':'删除','nav.ai.inactiveStatus':'未启用',
  'nav.ai.chatStatus':'对话模型已启用','nav.ai.imageStatus':'生图模型已启用','nav.ai.sourcePrefix':'来源：','nav.ai.autoSwitchTitle':'自动切换',
  'nav.ai.autoSwitchHelp':'主模型异常时切换','nav.ai.profileNameLabel':'方案名称','nav.ai.lblProvider':'供应商协议','nav.ai.authModeLabel':'认证方式',
  'nav.ai.authBearer':'Bearer','nav.ai.authXApiKey':'x-api-key','nav.ai.authApiKey':'api-key','nav.ai.authGoogle':'x-goog-api-key',
  'nav.ai.authCustom':'自定义头','nav.ai.authNone':'无需认证','nav.ai.customAuthHeaderLabel':'自定义头名','nav.ai.customAuthHeaderPlaceholder':'X-Custom-Key',
  'nav.ai.lblApiUrl':'API URL','nav.ai.plhApiUrl':'填写基地址','nav.ai.verifySslLabel':'校验 HTTPS 证书','nav.ai.verifySslHelp':'开启后校验证书',
  'nav.ai.lblToken':'API Key','nav.ai.btnClear':'清空密钥','nav.ai.channelModelsTitle':'可用模型','nav.ai.channelModelsHelp':'可添加多个模型',
  'nav.ai.plhAddModel':'输入模型名','nav.ai.btnAddModel':'添加','nav.ai.temperature':'Temperature','nav.ai.lblMax':'Max Tokens',
  'nav.ai.lblContext':'Context Window','nav.ai.lblInputCost':'输入单价','nav.ai.lblOutputCost':'输出单价','nav.ai.lblUsdRate':'汇率',
  'nav.ai.lblPrompt':'系统提示词','nav.ai.plhPrompt':'提示词','nav.ai.advancedToggle':'高级','nav.ai.advancedHint':'可选','nav.ai.extraHeadersLabel':'Headers',
  'nav.ai.extraHeadersPlaceholder':'{}','nav.ai.extraBodyLabel':'Extra Body','nav.ai.extraBodyPlaceholder':'{}','nav.ai.btnTest':'测试连接',
  'nav.ai.testing':'测试中','nav.ai.testOk':'连接成功','nav.ai.testFail':'连接失败：','nav.ai.saved':'已保存','nav.ai.saving':'保存中','nav.ai.waitSave':'等待保存'
})[k] || k;
function isNavSuperAdmin(){return false;}
function resolveAiAuthModeForUi(s){return s?.authMode || (s?.provider==='gemini'?'x-goog-api-key':'bearer');}
function renderAiUsagePanel(){return '';}
function loadAiUsageData(){}
function showPlatformConfirm(){return Promise.resolve(true);}
</script>
<script src="/js/shared/platform-settings.js"></script>
</body>
</html>`);
    });

    const server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const run = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);

    try {
        await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
        await win.webContents.executeJavaScript(`renderAiSettings(document.getElementById('navSettingsContent'))`);
        await new Promise(r => setTimeout(r, 100));

        // 1. Onboarding card visible with expected copy, link, eye toggle & domain note
        const initialText = await run(() => document.getElementById('navAiQuickCard')?.innerText || '');
        assert.match(initialText, /01平台接入/);
        assert.match(initialText, /API TOKEN · default 分组/);
        assert.match(initialText, /平台地址填到域名即可，不用带 \/v1/);
        assert.equal(await run(() => document.querySelector('.nav-ai-quick-steps a')?.getAttribute('href')), 'http://models.ascend.huawei.com/sign-up?aff=KizX');
        assert.equal(await run(() => document.getElementById('navAiQuickToken').type), 'password');
        await run(() => document.getElementById('navAiQuickEyeBtn').click());
        assert.equal(await run(() => document.getElementById('navAiQuickToken').type), 'text');

        // 2. Paste/input token triggers auto-test and displays "连接成功 · Token 验证通过"
        await run(() => {
            const el = document.getElementById('navAiQuickToken');
            el.value = 'sk-browser-test-token-123456';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await new Promise(r => setTimeout(r, 480));
        assert.match(await run(() => document.getElementById('navAiQuickStatus').innerText), /连接成功 · Token 验证通过/);

        // 3. Click Save configures & activates qwen3.8-27b (chat) + qwen-image-2.1 (image)
        await run(() => document.getElementById('navAiQuickSaveBtn').click());
        await new Promise(r => setTimeout(r, 250));
        assert.equal(store.profiles.find(p => p.id === store.activeProfileId)?.model, 'qwen3.8-27b');
        assert.equal(store.profiles.find(p => p.id === store.activeImageProfileId)?.model, 'qwen-image-2.1');
        assert.equal(await run(() => Boolean(document.getElementById('navAiQuickOpenBtn'))), true);

        // 4. Re-open card and verify Clear resets token + status
        await run(() => document.getElementById('navAiQuickOpenBtn').click());
        await new Promise(r => setTimeout(r, 150));
        await run(() => document.getElementById('navAiQuickClearBtn').click());
        assert.equal(await run(() => document.getElementById('navAiQuickToken').value), '');
        assert.equal(await run(() => document.getElementById('navAiQuickStatus').hidden), true);

        // 5. Provider protocol change preserves models and custom URL
        await run(() => {
            navState.currentEditingModels = ['deepseek-v4.1-flash', 'qwen3.8-27b'];
            document.getElementById('navAiModel').value = 'deepseek-v4.1-flash';
            document.getElementById('navAiApiBaseUrl').value = 'http://models.ascend.huawei.com/v1';
            const sel = document.getElementById('navAiProvider');
            sel.value = 'anthropic';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal(await run(() => document.getElementById('navAiModel').value), 'deepseek-v4.1-flash');
        assert.equal(await run(() => document.getElementById('navAiApiBaseUrl').value), 'http://models.ascend.huawei.com/v1');

        // 6. Entering HTTP domain URL auto-checks verifySsl and 504 timeout auto-retries & saves
        await run(() => {
            const box = document.getElementById('navAiVerifySsl');
            box.checked = false;
            delete box.dataset.userTouched;
            const url = document.getElementById('navAiApiBaseUrl');
            url.value = 'http://models.ascend.huawei.com';
            url.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await run(() => document.getElementById('navAiVerifySsl').checked), true);

        await run(() => {
            document.getElementById('navAiVerifySsl').checked = false;
        });
        await win.webContents.executeJavaScript(`testAiSettingsNow('deepseek-v4.1-flash')`);
        await new Promise(r => setTimeout(r, 150));
        assert.equal(await run(() => document.getElementById('navAiVerifySsl').checked), true);
        assert.match(await run(() => document.getElementById('navAiTestResult').innerText), /连接成功/);

        // 7. Layout overflow check on narrow mobile width and dark theme
        nativeTheme.themeSource = 'dark';
        win.setSize(390, 844);
        await run(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await new Promise(r => setTimeout(r, 120));
        assert.equal(await run(() => document.documentElement.scrollWidth <= window.innerWidth), true);

        console.log('PASS ai-settings onboarding, provider preservation, HTTP verifySsl auto-check & auto-retry in real Electron BrowserWindow');
    } finally {
        win.destroy();
        server.close();
        fs.rmSync(temp, { recursive: true, force: true });
        app.quit();
    }
}).catch(err => {
    console.error(err);
    app.exit(1);
});
