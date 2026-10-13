const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const JSZip = require('jszip');
const { Worker } = require('node:worker_threads');
const { requireAdmin } = require('../middleware/auth');
const navSettingsRepo = require('../models/nav-settings-repository');
const authSessionsRepo = require('../models/auth-sessions-repository');
const { logoStorage, resolveLogoAsset, generateAndSaveLogo, ASSET_NAMES } = require('../models/platform-logo-runtime');

function storeAssets(logo, screenshots) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, '../workers/platform-store-assets-worker.js'), {
            workerData: { logo, screenshots }, resourceLimits: { maxOldGenerationSizeMb: 256 }
        });
        let received = false;
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Store assets processing timed out')); }, 90000);
        worker.once('message', result => { received = true; clearTimeout(timer); result.error ? reject(Object.assign(new Error(result.error), { code: 'STORE_ASSETS_INVALID' })) : resolve(result.assets); });
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.once('exit', code => { clearTimeout(timer); if (!received || code !== 0) reject(new Error(`Store assets worker exited: ${code}`)); });
    });
}

function buildAssetsManifest(platformName, current, files) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const lines = [
        '========================================================================',
        `${platformName} - 平台全套运营物料与全端徽标资产包`,
        `${platformName} - Brand & Icon Assets Bundle`,
        '========================================================================',
        `打包时间 / Generated at : ${timestamp}`,
        `存储模式 / Storage Mode : ${current.runtime ? '用户持久化运行时目录 (Runtime Override)' : '源码内嵌默认目录 (Source Bundled)'}`,
        `包含文件数量 / File Count : ${files.length} 个文件`,
        '',
        '【文件清单与规格用途说明 / File Specifications】',
        '------------------------------------------------------------------------',
        '1. logo.png (1024×1024 PNG)',
        '   • 规格: 1024×1024 高清透明底 PNG，暗色边缘微光增强处理',
        '   • 用途: 平台主页 Hero 徽标、大屏可视化中心、暗色主题界面、产品宣传大图',
        '',
        '2. logo-raw.png (1024×1024 PNG)',
        '   • 规格: 1024×1024 高清透明底 PNG，原始未加发光纯色版',
        '   • 用途: 浅色背景场景、文档印刷、UI 设计稿源图、各类白底演示胶片',
        '',
        '3. icon-mac.png (1024×1024 PNG)',
        '   • 规格: 1024×1024 macOS 标准应用图标源文件',
        '   • 用途: macOS DMG / App Bundle 打包自动转换 .icns 基础图标，Apple Touch Icon',
        '',
        '4. icon-windows.ico (多尺寸标准 ICO)',
        '   • 规格: 包含 16×16, 32×32, 48×48, 64×64, 128×128, 256×256 六层分辨率的 PNG 压缩 ICO',
        '   • 用途: Windows 安装版 EXE 主程序、桌面快捷方式、控制面板与任务栏高保真显示',
        '',
        '5. icon-windows.png (256×256 PNG)',
        '   • 规格: 256×256 透明底 PNG',
        '   • 用途: Windows 开始菜单、磁贴、任务栏通知区域图标',
        '',
        '6. icon-windows-portable.ico (便携版专用 ICO)',
        '   • 规格: 内嵌绿色矢量 "P" 标识角标的多尺寸 ICO',
        '   • 用途: Windows 免安装绿色便携版 Portable EXE 专属图标，便于用户直观识别',
        '',
        '7. icon-windows-portable.png (256×256 PNG)',
        '   • 规格: 256×256 带便携版 "P" 角标透明底 PNG',
        '   • 用途: 便携版相关说明文档及便携启动器界面',
        '',
        '8. portable-splash.bmp (620×340 24位 BMP)',
        '   • 规格: 620×340 标准位图，左上角 72px 品牌区已无缝替换为当前徽标',
        '   • 用途: Windows 便携版程序解压与启动过程中的开屏等待图',
        '',
        '9. icon.ico (多尺寸 Favicon ICO)',
        '   • 规格: 标准 Web 浏览器图标',
        '   • 用途: 网页端标签页 Favicon 收藏夹图标',
        '',
        '10. icon.png (32×32 PNG)',
        '    • 规格: 32×32 现代浏览器透明小图标',
        '    • 用途: 网页快捷方式、移动端书签图标',
        '',
        '【使用建议 / Instructions】',
        'store-assets/store-icon-128x128.png: 128×128 PNG，96×96 主体与 16px 透明留白。',
        'store-assets/small-promo-440x280.png: 440×280，24 位 RGB PNG，无 alpha。',
        'store-assets/marquee-1400x560.png: 1400×560，24 位 RGB PNG，无 alpha。',
        'store-assets/screenshot-*-1280x800.png: 1–5 张真实界面截图，24 位 RGB PNG，无 alpha。',
        '截图按 16:10 居中裁切，不拉伸；请检查裁切内容及是否含需移除的个人/业务信息。',
        'Screenshots are center-cropped to 16:10. Review content before publishing.',
        '本包使用平台 Logo；若用于其他插件，请确认品牌图标和截图对应所提交的产品。',
        'Use the correct product branding and screenshots for your store submission.',
        '宣传视频需另行上传 YouTube，再填写实际视频 URL；图片包不会自动发布视频。',
        'Upload promotional videos to YouTube separately; this bundle does not publish videos.',
        '------------------------------------------------------------------------',
        '• 若用于二次开发或修改源码，可将本压缩包内的图标文件直接解压覆盖到源码工程的',
        '  frontend/assets/ 目录下，然后执行 git commit 并推送到 main 分支，',
        '  GitHub Actions CI 工作流将自动使用新图标构建 Windows EXE 与 macOS DMG 安装包。',
        '========================================================================'
    ];
    return lines.join('\n');
}

function createLogoRouter(options = {}) {
    const router = express.Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
    const storage = () => logoStorage(options);
    const screenshotUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 0 } });

    const downloadBundle = async (req, res) => {
        let user = req.user;
        if (!user && req.query.token) {
            try {
                const session = await authSessionsRepo.getSession(req.query.token);
                if (session && session.expiresAt > Date.now()) user = session.user;
            } catch (_) {}
        }
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: '权限不足，需要超级管理员账号' });
        }
        try {
            const current = storage();
            const zip = new JSZip();
            const includedFiles = [];
            for (const name of ASSET_NAMES) {
                const filepath = resolveLogoAsset(name, current);
                if (filepath && fs.existsSync(filepath)) {
                    zip.file(name, fs.readFileSync(filepath));
                    includedFiles.push(name);
                }
            }
            const petIcon = path.join(current.root, 'desktop-pet/assets/icon.png');
            if (fs.existsSync(petIcon)) {
                zip.file('desktop-pet-icon.png', fs.readFileSync(petIcon));
                includedFiles.push('desktop-pet-icon.png');
            }
            if (includedFiles.length === 0) {
                return res.status(404).json({ error: '未找到可下载的运营物料或图标资产' });
            }
            const logoPath = resolveLogoAsset('logo.png', current);
            if (logoPath && fs.existsSync(logoPath)) {
                const assets = await storeAssets(fs.readFileSync(logoPath), (req.files || []).map(file => file.buffer));
                for (const [name, bytes] of Object.entries(assets)) { zip.file(name, Buffer.from(bytes)); includedFiles.push(name); }
            }
            let platformName = 'Tools Platform';
            try {
                platformName = (await navSettingsRepo.getSettings()).platformName || 'Tools Platform';
            } catch (_) {}
            const readme = buildAssetsManifest(platformName, current, includedFiles);
            zip.file('README.txt', readme);

            const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
            const dateStr = new Date().toISOString().slice(0, 10);
            const safePlatformSlug = platformName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'tools-platform';
            const filename = `${safePlatformSlug}-brand-assets-${dateStr}.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Cache-Control', 'no-cache');
            res.send(buffer);
        } catch (error) {
            console.error('[platform-logo] Failed to build brand assets bundle:', error.message);
            res.status(error.code === 'STORE_ASSETS_INVALID' ? 400 : 500).json({ ok: false, code: error.code || 'STORE_ASSETS_FAILED', error: '生成运营物料资产包失败: ' + error.message, requestId: req.requestId });
        }
    };
    router.get('/download-bundle', downloadBundle);
    router.post('/download-bundle', requireAdmin, (req, res, next) => screenshotUpload.array('screenshots', 5)(req, res, error => {
        if (error) return res.status(400).json({ ok: false, code: 'STORE_ASSETS_INVALID', error: error.message, requestId: req.requestId });
        if (!req.files?.length) return res.status(400).json({ ok: false, code: 'STORE_SCREENSHOT_REQUIRED', error: '请提供至少一张真实界面截图 / Provide at least one screenshot', requestId: req.requestId });
        next();
    }), downloadBundle);

    router.get('/status', (req, res) => {
        const current = storage();
        const size = name => {
            const filename = resolveLogoAsset(name, current);
            return fs.existsSync(filename) ? fs.statSync(filename).size : 0;
        };
        const logo = resolveLogoAsset('logo.png', current);
        const exists = fs.existsSync(logo);
        const updatedAt = exists ? fs.statSync(logo).mtimeMs : 0;
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ok: true, hasLogo: exists, updatedAt, storageMode: current.runtime ? 'runtime' : 'source',
            logoUrl: `/assets/logo.png?t=${Math.floor(updatedAt)}`, logoRawUrl: `/assets/logo-raw.png?t=${Math.floor(updatedAt)}`,
            fileSizes: { logo: size('logo.png'), mac: size('icon-mac.png'), windows: size('icon-windows.png'), portable: size('icon-windows-portable.png') }
        });
    });

    router.post('/upload', requireAdmin, (req, res, next) => upload.single('logo')(req, res, error => {
        if (error) return res.status(400).json({ ok: false, code: 'LOGO_UPLOAD_INVALID', error: error.message, requestId: req.requestId });
        next();
    }), async (req, res) => {
        if (!req.file) return res.status(400).json({ ok: false, code: 'LOGO_REQUIRED', error: '请上传图片 / Please upload an image', requestId: req.requestId });
        try {
            const current = storage();
            const files = await generateAndSaveLogo(req.file.buffer, {
                storage: current,
                removeBg: req.body.removeBg !== 'false',
                darkEnhance: req.body.darkEnhance !== 'false',
                cropBottomText: req.body.cropBottomText !== 'false'
            });
            const updatedAt = Date.now();
            res.json({ ok: true, updatedAt, storageMode: current.runtime ? 'runtime' : 'source', assetCount: files.length,
                logoUrl: `/assets/logo.png?t=${updatedAt}`, output: files.map(file => path.basename(file)).join('\n') });
        } catch (error) {
            console.error('[platform-logo] Processing failed:', error.message);
            res.status(error.code === 'LOGO_BUSY' ? 409 : 400).json({ ok: false, code: error.code || 'LOGO_PROCESSING_FAILED',
                error: error.message, requestId: req.requestId });
        }
    });
    return router;
}

module.exports = createLogoRouter();
module.exports.createLogoRouter = createLogoRouter;
