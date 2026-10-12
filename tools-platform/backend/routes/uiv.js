/**
 * UIVF12 Catcher 路由
 * 管理脚本仓库（分类 + 脚本）的 CRUD，持久化存储在服务端
 */
const express = require('express');
const router = express.Router();
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const categoriesRepo = require('../models/uiv-categories-repository');
const scriptsRepo = require('../models/uiv-scripts-repository');
const { ensureDataDir, getDataDir } = require('../models/store');
const configChangeMonitor = require('../models/config-change-monitor');

const DEFAULT_CATEGORIES = categoriesRepo.DEFAULT_CATEGORIES;
const UIVISION_EXTENSION_ID = 'gcbalfbdmfieckjlnblleoemohcganoc';

function decodeCompressedTextField(field, label) {
    if (!field || typeof field !== 'object') {
        throw new Error(`${label} 压缩字段格式无效`);
    }

    const encoding = String(field.encoding || '').toLowerCase();
    const raw = Buffer.from(String(field.data || ''), 'base64');
    if (raw.length === 0 && field.data) {
        throw new Error(`${label} 压缩数据为空`);
    }

    let out;
    if (encoding === 'gzip+base64') {
        out = zlib.gunzipSync(raw);
    } else if (encoding === 'deflate+base64') {
        out = zlib.inflateSync(raw);
    } else {
        throw new Error(`${label} 压缩编码不支持: ${field.encoding || 'unknown'}`);
    }

    return out.toString('utf8');
}

function expandCompressedScriptItems(body) {
    const transportCompression = body && body.transport && body.transport.compression;
    if (!transportCompression) {
        return Array.isArray(body && body.items) ? body.items : [];
    }

    const items = Array.isArray(body && body.items) ? body.items : [];
    return items.map((item, index) => {
        const expanded = { ...item };
        const compressedFields = item && item.compressedFields;
        if (!compressedFields || typeof compressedFields !== 'object') {
            throw new Error(`第 ${index + 1} 条脚本缺少 compressedFields`);
        }

        expanded.code = decodeCompressedTextField(compressedFields.code, `第 ${index + 1} 条脚本 code`);
        expanded.consoleCode = decodeCompressedTextField(compressedFields.consoleCode, `第 ${index + 1} 条脚本 consoleCode`);
        expanded.payload = decodeCompressedTextField(compressedFields.payload, `第 ${index + 1} 条脚本 payload`);
        delete expanded.compressedFields;
        return expanded;
    });
}

function pathExists(filePath) {
    try {
        return !!filePath && fs.existsSync(filePath);
    } catch (e) {
        return false;
    }
}

function firstExisting(paths) {
    return paths.find(pathExists) || '';
}

function queryWindowsAppPath(exeName) {
    if (process.platform !== 'win32') return '';
    const keys = [
        `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
        `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`
    ];
    for (const key of keys) {
        try {
            const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const match = out.match(/REG_SZ\s+(.+\.exe)/i);
            if (match && pathExists(match[1].trim())) return match[1].trim();
        } catch (e) {}
    }
    return '';
}

function findOnPath(command) {
    const tool = process.platform === 'win32' ? 'where' : 'which';
    try {
        const out = execFileSync(tool, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return out.split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
    } catch (e) {
        return '';
    }
}

function detectBrowser() {
    const candidates = [];
    if (process.platform === 'win32') {
        const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
        const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const local = process.env.LOCALAPPDATA || '';
        candidates.push(
            { name: 'Chrome', path: firstExisting([path.join(pf, 'Google/Chrome/Application/chrome.exe'), path.join(pfx86, 'Google/Chrome/Application/chrome.exe'), local ? path.join(local, 'Google/Chrome/Application/chrome.exe') : '']) || queryWindowsAppPath('chrome.exe') || findOnPath('chrome') },
            { name: 'Edge', path: firstExisting([path.join(pfx86, 'Microsoft/Edge/Application/msedge.exe'), path.join(pf, 'Microsoft/Edge/Application/msedge.exe'), local ? path.join(local, 'Microsoft/Edge/Application/msedge.exe') : '']) || queryWindowsAppPath('msedge.exe') || findOnPath('msedge') }
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            { name: 'Chrome', path: firstExisting(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) },
            { name: 'Edge', path: firstExisting(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']) }
        );
    } else {
        candidates.push(
            { name: 'Chrome', path: findOnPath('google-chrome') || findOnPath('chrome') || findOnPath('chromium') || findOnPath('chromium-browser') },
            { name: 'Edge', path: findOnPath('microsoft-edge') || findOnPath('msedge') }
        );
    }
    return candidates.find(item => item.path && pathExists(item.path)) || null;
}

function getChromeLikeUserDataRoots(browserName) {
    const home = os.homedir();
    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
        return browserName === 'Edge'
            ? [path.join(local, 'Microsoft/Edge/User Data')]
            : [path.join(local, 'Google/Chrome/User Data')];
    }
    if (process.platform === 'darwin') {
        return browserName === 'Edge'
            ? [path.join(home, 'Library/Application Support/Microsoft Edge')]
            : [path.join(home, 'Library/Application Support/Google/Chrome')];
    }
    return browserName === 'Edge'
        ? [path.join(home, '.config/microsoft-edge')]
        : [path.join(home, '.config/google-chrome'), path.join(home, '.config/chromium')];
}

function detectUiVisionExtension(browserName) {
    const roots = getChromeLikeUserDataRoots(browserName);
    const hits = [];
    for (const root of roots) {
        if (!pathExists(root)) continue;
        let profiles = [];
        try {
            profiles = fs.readdirSync(root, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && (entry.name === 'Default' || /^Profile \d+$/.test(entry.name)))
                .map(entry => path.join(root, entry.name));
        } catch (e) {}
        for (const profile of profiles) {
            const extRoot = path.join(profile, 'Extensions', UIVISION_EXTENSION_ID);
            if (!pathExists(extRoot)) continue;
            hits.push(extRoot);
        }
    }
    return hits;
}

function makeUiVisionEmbeddedHtml(macro, allowedOrigin) {
    const macroJson = JSON.stringify(macro);
    const originLabel = String(allowedOrigin || '当前 Tools Platform 地址');
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>UIVF12 Direct Runner</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#08111f;color:#e2e8f0;margin:0;display:grid;place-items:center;min-height:100vh}
    main{width:min(760px,calc(100vw - 40px));background:rgba(15,23,42,.92);border:1px solid rgba(56,189,248,.35);border-radius:16px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:22px;margin:0 0 8px}p{color:#94a3b8;line-height:1.6}.status{margin-top:16px;color:#67e8f9;font-weight:700}
  </style>
</head>
<body>
  <main>
    <h1>UIVF12 Direct Runner</h1>
    <p>正在通过 UI.Vision embedded macro 启动批量阵列。若没有自动运行，请确认 UI.Vision 已安装，并在插件设置中允许 embedded macros，把 ${originLabel.replace(/</g, '&lt;')} 加入白名单。</p>
    <div class="status" id="status">Preparing macro...</div>
  </main>
  <script id="macro-json" type="application/json">${macroJson.replace(/</g, '\\u003c')}</script>
  <script>
    (function () {
      const status = document.getElementById('status');
      try {
        const macro = JSON.parse(document.getElementById('macro-json').textContent);
        window.addEventListener('kantuInvokeSuccess', function () {
          status.textContent = 'UI.Vision 已接收宏，正在执行...';
        });
        window.dispatchEvent(new CustomEvent('kantuSaveAndRunMacro', {
          detail: {
            json: macro,
            direct: true,
            storageMode: 'browser',
            closeRPA: false,
            loadmacrotree: '0'
          }
        }));
        status.textContent = '已发送给 UI.Vision，等待扩展接管...';
      } catch (error) {
        status.textContent = '启动失败: ' + error.message;
      }
    })();
  </script>
</body>
</html>`;
}

function launchBrowser(browser, url) {
    return new Promise((resolve, reject) => {
        const child = execFile(browser.path, [url], { windowsHide: false }, err => {
            if (err) reject(err);
        });
        child.on('spawn', () => resolve());
        child.on('error', reject);
    });
}

function getUiVisionRunDir() {
    ensureDataDir();
    const runDir = path.join(getDataDir(), 'tmp/uivision-runs');
    fs.mkdirSync(runDir, { recursive: true });
    return runDir;
}

function assertSafeRunId(runId) {
    return typeof runId === 'string' && /^[a-f0-9]{32}$/.test(runId);
}

function normalizeRunnerOrigin(rawOrigin) {
    if (!rawOrigin || typeof rawOrigin !== 'string') return '';
    try {
        const parsed = new URL(rawOrigin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.origin;
    } catch (e) {
        return '';
    }
}

function decodeMacroFromRequest(body) {
    if (body && body.macro && typeof body.macro === 'object') {
        return body.macro;
    }
    const compressed = body && body.compressedMacro;
    if (!compressed || compressed.encoding !== 'gzip-base64' || typeof compressed.data !== 'string') {
        return null;
    }
    const raw = zlib.gunzipSync(Buffer.from(compressed.data, 'base64')).toString('utf8');
    return JSON.parse(raw);
}

// ──────────────────────────────────────────────────────────
// 脚本列表相关
// ──────────────────────────────────────────────────────────

// GET /api/uiv/scripts  → 返回全部脚本 + 分类
router.get('/scripts', async (req, res) => {
    try {
        const { items: scripts, source: scriptSource } = await scriptsRepo.listScripts({
            mode: req.query.scriptsMode || req.query.mode || 'auto'
        });
        const { items: categories, source: categorySource } = await categoriesRepo.listCategories({
            mode: req.query.categoriesMode || req.query.mode || 'auto'
        });
        res.setHeader('X-Data-Source', scriptSource);
        res.setHeader('X-Data-Source-Categories', categorySource);
        console.log(`[DATA SOURCE] GET /api/uiv/scripts -> SCRIPTS:${scriptSource.toUpperCase()} CATEGORIES:${categorySource.toUpperCase()}`);
        res.json({ scripts, categories });
    } catch (err) {
        console.error('[GET /api/uiv/scripts] failed:', err);
        res.status(500).json({ error: '加载脚本仓库失败' });
    }
});

// POST /api/uiv/scripts  → 新增或覆盖脚本（支持阵列批量）
router.post('/scripts', async (req, res) => {
    let items;
    try {
        items = expandCompressedScriptItems(req.body);
    } catch (decodeErr) {
        console.error('[POST /api/uiv/scripts] compressed payload decode failed:', decodeErr);
        return res.status(400).json({ error: decodeErr.message || '压缩脚本解码失败' });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: '参数错误：items 必须为非空数组' });
    }

    try {
        if (req.body && req.body.transport && req.body.transport.compression) {
            console.log(`[UIV COMPRESS] POST /api/uiv/scripts -> transport=${req.body.transport.compression}, items=${items.length}`);
        }
        const scripts = await scriptsRepo.saveScripts(items);
        configChangeMonitor.recordConfigChangeAlert({
            req,
            scope: 'uiv',
            action: '新增/更新抓取脚本',
            before: {},
            after: { count: scripts.length, names: items.map(s => s.name || s.id) },
            objectType: 'uiv_scripts',
            message: `成功保存了 ${scripts.length} 个抓取脚本`
        });
        res.json({ success: true, count: scripts.length });
    } catch (err) {
        console.error('[POST /api/uiv/scripts] failed:', err);
        res.status(500).json({ error: '保存脚本失败' });
    }
});

router.get('/uivision-runner/:runId', (req, res) => {
    const runId = req.params.runId;
    if (!assertSafeRunId(runId)) {
        return res.status(400).send('Invalid run id');
    }
    const htmlPath = path.join(getUiVisionRunDir(), `${runId}.html`);
    if (!pathExists(htmlPath)) {
        return res.status(404).send('UI.Vision runner not found or expired');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(htmlPath);
});

router.post('/run-uivision-macro', async (req, res) => {
    let macro;
    try {
        macro = decodeMacroFromRequest(req.body);
    } catch (decodeErr) {
        return res.status(400).json({ error: `解压 UI.Vision 宏失败：${decodeErr.message}` });
    }
    if (!macro || typeof macro !== 'object' || !Array.isArray(macro.Commands)) {
        return res.status(400).json({ error: '参数错误：macro.Commands 必须为数组' });
    }

    try {
        const runDir = getUiVisionRunDir();
        const runId = crypto.randomBytes(16).toString('hex');
        const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
        const safeName = String(macro.Name || 'UIVF12_Batch_UIV').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
        const macroPath = path.join(runDir, `${safeName}_${ts}.json`);
        const htmlPath = path.join(runDir, `${runId}.html`);
        const host = req.get('host') || `localhost:${process.env.PORT || 3030}`;
        const origin = normalizeRunnerOrigin(req.body && req.body.origin) || `${req.protocol}://${host}`;
        const runnerUrl = `${origin}/api/uiv/uivision-runner/${runId}`;
        fs.writeFileSync(macroPath, JSON.stringify(macro, null, 2), 'utf8');
        fs.writeFileSync(htmlPath, makeUiVisionEmbeddedHtml(macro, origin), 'utf8');

        const browser = detectBrowser();
        const extensionCandidates = browser ? detectUiVisionExtension(browser.name) : [];
        let browserLaunched = false;
        let browserLaunchError = '';
        if (req.body && req.body.launchLocalBrowser && browser) {
            try {
                await launchBrowser(browser, runnerUrl);
                browserLaunched = true;
            } catch (launchErr) {
                browserLaunchError = launchErr.message || String(launchErr);
            }
        }

        res.json({
            success: true,
            browser,
            browserLaunched,
            browserLaunchError,
            macroPath,
            htmlPath,
            url: runnerUrl,
            uiVisionExtensionDetected: browser ? extensionCandidates.length > 0 : null,
            uiVisionExtensionCandidates: extensionCandidates,
            note: '已生成 Tools Platform 托管的 UI.Vision embedded macro 启动页。'
        });
    } catch (err) {
        console.error('[POST /api/uiv/run-uivision-macro] failed:', err);
        res.status(500).json({ error: `启动 UI.Vision 失败：${err.message}` });
    }
});

// DELETE /api/uiv/scripts/:id  → 删除指定脚本
router.delete('/scripts/:id', async (req, res) => {
    try {
        await scriptsRepo.deleteScriptById(req.params.id);
        configChangeMonitor.recordConfigChangeAlert({
            req,
            scope: 'uiv',
            action: '删除抓取脚本',
            before: { script_id: req.params.id },
            after: {},
            objectType: 'uiv_scripts',
            objectId: req.params.id,
            message: `删除了抓取脚本 ${req.params.id}`
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[DELETE /api/uiv/scripts/:id] failed:', err);
        res.status(500).json({ error: '删除脚本失败' });
    }
});

// PATCH /api/uiv/scripts/:id/category  → 移动脚本到新分类（拖拽）
router.patch('/scripts/:id/category', async (req, res) => {
    const { category } = req.body;
    try {
        const script = await scriptsRepo.moveScriptCategory(req.params.id, category);
        if (!script) return res.status(404).json({ error: '脚本不存在' });
        configChangeMonitor.recordConfigChangeAlert({
            req,
            scope: 'uiv',
            action: '移动抓取脚本',
            before: { script_id: req.params.id },
            after: { category },
            objectType: 'uiv_scripts',
            objectId: req.params.id,
            message: `将脚本 ${req.params.id} 移动到了分类 ${category}`
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[PATCH /api/uiv/scripts/:id/category] failed:', err);
        res.status(500).json({ error: '移动分类失败' });
    }
});

// PATCH /api/uiv/scripts/:id/rename  → 重命名脚本
router.patch('/scripts/:id/rename', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '脚本名称不能为空' });
    try {
        const updated = await scriptsRepo.renameScript(req.params.id, name.trim());
        if (!updated) return res.status(404).json({ error: '脚本不存在' });
        configChangeMonitor.recordConfigChangeAlert({
            req,
            scope: 'uiv',
            action: '重命名抓取脚本',
            before: { script_id: req.params.id, name: updated.oldName },
            after: { script_id: req.params.id, name: updated.name },
            objectType: 'uiv_scripts',
            objectId: req.params.id,
            message: `将脚本 ${updated.oldName || req.params.id} 重命名为 ${updated.name}`
        });
        res.json({ success: true, script: updated });
    } catch (err) {
        console.error('[PATCH /api/uiv/scripts/:id/rename] failed:', err);
        res.status(500).json({ error: '重命名脚本失败' });
    }
});

// ──────────────────────────────────────────────────────────
// 分类管理
// ──────────────────────────────────────────────────────────

// POST /api/uiv/categories  → 新建自定义分类
router.post('/categories', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '分类名不能为空' });
    try {
        const cats = await categoriesRepo.addCategory(name);
        configChangeMonitor.recordConfigChangeAlert({
            req,
            scope: 'uiv',
            action: '新增抓取分类',
            before: {},
            after: { category: name },
            objectType: 'uiv_categories',
            objectId: name,
            message: `新增了抓取脚本分类 ${name}`
        });
        res.json({ success: true, categories: cats });
    } catch (err) {
        console.error('[POST /api/uiv/categories] failed:', err);
        res.status(500).json({ error: '创建分类失败' });
    }
});

// DELETE /api/uiv/categories/:name  → 删除分类（同时清理该分类的脚本）
router.delete('/categories/:name', async (req, res) => {
    const catName = decodeURIComponent(req.params.name);
    try {
        await categoriesRepo.deleteCategory(catName);
        await scriptsRepo.deleteScriptsByCategory(catName);
        configChangeMonitor.recordConfigChangeAlert({
            req,
            scope: 'uiv',
            action: '删除抓取分类',
            before: { category: catName },
            after: {},
            objectType: 'uiv_categories',
            objectId: catName,
            message: `删除了抓取脚本分类 ${catName}`
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[DELETE /api/uiv/categories/:name] failed:', err);
        res.status(500).json({ error: '删除分类失败' });
    }
});

// ──────────────────────────────────────────────────────────
// 导入 / 导出备份
// ──────────────────────────────────────────────────────────

// GET /api/uiv/backup  → 导出全量备份 JSON
router.get('/backup', async (req, res) => {
    try {
        const { items: scripts, source: scriptSource } = await scriptsRepo.listScripts({
            mode: req.query.scriptsMode || req.query.mode || 'auto'
        });
        const { items: allCategories, source: categorySource } = await categoriesRepo.listCategories({
            mode: req.query.categoriesMode || req.query.mode || 'auto'
        });
        const categories = allCategories.filter(c => !DEFAULT_CATEGORIES.includes(c));
        res.setHeader('X-Data-Source', scriptSource);
        res.setHeader('X-Data-Source-Categories', categorySource);
        console.log(`[DATA SOURCE] GET /api/uiv/backup -> SCRIPTS:${scriptSource.toUpperCase()} CATEGORIES:${categorySource.toUpperCase()}`);
        res.json({ scripts, categories, exportDate: new Date().toISOString() });
    } catch (err) {
        console.error('[GET /api/uiv/backup] failed:', err);
        res.status(500).json({ error: '导出备份失败' });
    }
});

// POST /api/uiv/backup  → 导入备份（覆盖 or 融合）
router.post('/backup', async (req, res) => {
    const { scripts, categories, merge } = req.body;
    if (!Array.isArray(scripts)) return res.status(400).json({ error: '无效备份格式' });

    try {
        if (merge) {
            let existingScripts = (await scriptsRepo.listScripts({ mode: 'auto' })).items;
            let existingCats = (await categoriesRepo.listCategories({ mode: 'auto' })).items
                .filter(c => !DEFAULT_CATEGORIES.includes(c));
            scripts.forEach(s => {
                const idx = existingScripts.findIndex(ex => ex.name === s.name);
                if (idx >= 0) existingScripts[idx] = s;
                else {
                    existingScripts.push(s);
                }
            });
            if (categories) {
                categories.forEach(c => {
                    if (!DEFAULT_CATEGORIES.includes(c) && !existingCats.includes(c)) existingCats.push(c);
                });
            }
            await scriptsRepo.replaceAllScripts(existingScripts);
            await categoriesRepo.replaceCategories(existingCats);
        } else {
            await scriptsRepo.replaceAllScripts(scripts);
            if (categories) await categoriesRepo.replaceCategories(categories.filter(c => !DEFAULT_CATEGORIES.includes(c)));
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[POST /api/uiv/backup] failed:', err);
        res.status(500).json({ error: '导入备份失败' });
    }
});

// GET /api/uiv/extension-download → 下载 UI.Vision RPA 扩展离线安装包 (v9.6.1)
router.get('/extension-download', (req, res) => {
    const candidates = [
        path.join(__dirname, '../../frontend/downloads/uivision-extension-9.6.1.zip'),
        path.join(__dirname, '../../../uivision-extension-9.6.1.zip'),
        path.join(process.cwd(), 'frontend/downloads/uivision-extension-9.6.1.zip'),
        path.join(process.cwd(), '../uivision-extension-9.6.1.zip')
    ];
    const zipPath = candidates.find(p => {
        try { return fs.existsSync(p); } catch (e) { return false; }
    });
    if (!zipPath) {
        return res.status(404).json({ error: 'UI.Vision 扩展安装包不存在，请联系管理员' });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.download(zipPath, 'uivision-extension-9.6.1.zip', (err) => {
        if (err && !res.headersSent) {
            console.error('[GET /api/uiv/extension-download] download failed:', err);
            res.status(500).json({ error: '下载失败' });
        }
    });
});

module.exports = router;

