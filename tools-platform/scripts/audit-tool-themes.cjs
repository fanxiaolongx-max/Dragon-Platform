// Read-only CSS inventory audit; application scripts and remote assets are blocked.
// Checks production injection, OS/platform independence and every native control.
// Does not execute business workflows or write installed tool/application files.
// Run: node_modules/.bin/electron scripts/audit-tool-themes.cjs
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('../backend/node_modules/express');
const { injectPlatformTheme, toolThemeForPath } = require('../backend/models/asset-versioning');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-theme-audit-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

function htmlFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        // Downloadable extension sources are templates, not tool navigation pages.
        if (['node_modules', '.venv', 'vendor', 'chrome-capture-pro', 'overseas-salary-calculator'].includes(entry.name)) return [];
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? htmlFiles(file) : entry.name.endsWith('.html') ? [file] : [];
    });
}
const entries = [];
for (const name of fs.readdirSync(path.join(root, 'frontend/pages'))) {
    if (!name.endsWith('.html') || ['login.html', 'startup.html'].includes(name)) continue;
    entries.push({ file: path.join(root, 'frontend/pages', name), label: 'frontend/pages/' + name,
        assetRoot: path.join(root, 'frontend'), relative: 'pages/' + name, toolPath: 'pages/' + name });
}
for (const folder of ['backend/builtin-tools', 'backend/data/custom-tools']) {
    for (const slug of fs.readdirSync(path.join(root, folder))) {
        const dir = path.join(root, folder, slug);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of htmlFiles(dir)) {
            const relative = path.relative(dir, file).split(path.sep).join('/');
            entries.push({ file, label: folder.replace('backend/', '') + '/' + slug + '/' + relative,
                assetRoot: dir, relative, toolPath: 'custom-tools/' + slug + '/' + relative });
        }
    }
}
const hosted = path.join(root, 'backend/data/hosted-apps');
if (fs.existsSync(hosted)) for (const slug of fs.readdirSync(hosted)) {
    const dir = path.join(hosted, slug, 'app');
    for (const file of htmlFiles(path.join(dir, 'static'))) {
        const relative = path.relative(dir, file).split(path.sep).join('/');
        entries.push({ file, label: 'hosted-apps/' + slug + '/' + relative,
            assetRoot: dir, relative, toolPath: 'custom-tools/' + slug, hosted: true });
    }
}
const snapshot = `(() => {
    const body = getComputedStyle(document.body), root = document.documentElement;
    const controls = [...document.querySelectorAll('input:not([type=hidden]),textarea,select,button')].map(el => {
        const style = getComputedStyle(el);
        return {tag:el.tagName,type:el.type,id:el.id,bg:style.backgroundColor,ink:style.color,scheme:style.colorScheme};
    });
    return {title:document.title,policy:root.dataset.platformTheme,scheme:getComputedStyle(root).colorScheme,
        bg:body.backgroundColor,image:body.backgroundImage,ink:body.color,controls};
})()`;

app.whenReady().then(async () => {
    nativeTheme.themeSource = 'light';
    const web = express();
    entries.forEach((entry, i) => {
        const prefix = '/audit/' + i + '/';
        web.get(prefix + entry.relative, (_req, res) => {
            let html = fs.readFileSync(entry.file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
            if (entry.hosted) html = html.replace(/((?:src|href)=["'])\/static\//gi, '$1' + prefix + 'static/');
            html = injectPlatformTheme(html, { toolPath: entry.toolPath });
            // Production UIVF12 inline bootstrap adds its light appearance class.
            if (entry.relative === 'pages/uivf12.html') html = html.replace(/<body[^>]*>/i,
                '$&<script>document.body.classList.add("uiv-light-theme")</script>');
            res.type('html').send(html);
        });
        web.use(prefix, express.static(entry.assetRoot));
    });
    web.use(express.static(path.join(root, 'frontend')));
    const server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, images: false } });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({
        cancel: /^https?:/.test(details.url) && !details.url.startsWith('http://127.0.0.1:')
    }));
    const result = [];
    let failures = 0;
    try {
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            try {
                await win.loadURL('http://127.0.0.1:' + server.address().port + '/audit/' + i + '/' + entry.relative);
                const before = await win.webContents.executeJavaScript(snapshot);
                await win.webContents.executeJavaScript(`localStorage.setItem('tools_theme','dark');
                    dispatchEvent(new StorageEvent('storage',{key:'tools_theme',newValue:'dark'}));
                    document.documentElement.dataset.theme='dark';document.body.classList.add('dark-theme');void 0`);
                nativeTheme.themeSource = 'dark';
                const after = await win.webContents.executeJavaScript(snapshot);
                const stable = JSON.stringify(before) === JSON.stringify(after);
                const expected = toolThemeForPath(entry.toolPath, fs.readFileSync(entry.file, 'utf8'));
                const controlsValid = before.controls.every(control => control.scheme === expected);
                if (!stable || !controlsValid || before.policy !== expected) {
                    failures++;
                    console.log('FAIL', entry.label, JSON.stringify({ stable, controlsValid, expected, policy: before.policy }));
                }
                result.push({ label: entry.label, ...before, stable, controlsValid });
                const previews = new Map([
                    ['frontend/pages/ai-report.html', 'ai-report'],
                    ['builtin-tools/particle-effects/index.html', 'particle-effects'],
                    ['hosted-apps/aiops-risk/static/index.html', 'aiops-risk']
                ]);
                if (previews.has(entry.label)) fs.writeFileSync(path.join(temp, previews.get(entry.label) + '.png'),
                    (await win.webContents.capturePage()).toPNG());
            } catch (error) {
                failures++;
                result.push({ label: entry.label, error: String(error) });
            }
            nativeTheme.themeSource = 'light';
            if (i % 20 === 0) console.log('Audited', i + 1, '/', entries.length);
        }
        fs.writeFileSync(path.join(temp, 'audit.json'), JSON.stringify(result, null, 2));
        console.log('Failures:', failures);
        console.log('REPORT ' + path.join(temp, 'audit.json'));
    } finally {
        win.destroy();
        server.close();
    }
    app.exit(failures ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
