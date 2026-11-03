// Isolated Electron fixtures: no production data, app imports or running Python services.
// Run: node_modules/.bin/electron tests/tool-fixed-theme-browser.cjs
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const express = require('express');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-fixed-theme-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
const av = require('../backend/models/asset-versioning');
const proxy = require('../backend/models/hosted-apps/proxy');

app.whenReady().then(async () => {
    const web = express();
    const prefix = '/apps/fixture/~fixture';
    web.get(prefix + '/__platform/shim.js', (_req, res) => res.type('js').send(proxy.SHIM));
    web.get(prefix + '/__platform/storage', (_req, res) => res.json({}));
    web.post(prefix + '/__platform/storage', (_req, res) => res.sendStatus(204));
    web.get('/case/:mode', (req, res) => {
        const hosted = req.params.mode.startsWith('hosted');
        const dark = req.params.mode.endsWith('dark');
        const html = `<html><head>${dark ? '<meta name="tools-tool-theme" content="dark">' : ''}<style>
            body{background:white;color:#222}input{background:white;color:#222;color-scheme:dark}
            @media(prefers-color-scheme:dark){body{background:#111;color:white}}
            html[data-theme=dark] input{background:#111;color:white}html.dark-theme p{color:red}
            </style><script>localStorage.setItem('tools_theme','dark');localStorage.setItem('tools_home_ui','v1');
            document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark-theme');</script>
            </head><body><button id="themeToggleButton">Page theme</button><button class="theme-btn" id="slideTheme">Slide content theme</button>
            <p>Text</p><input value="test"><textarea>Area</textarea><select><option>Option</option></select></body></html>`;
        if (hosted) res.setHeader('Content-Security-Policy', proxy.SANDBOX);
        res.type('html').send(hosted ? proxy.injectAppRuntime(html, prefix, 'fixture') : av.injectPlatformTheme(html));
    });
    web.use(express.static(path.join(root, 'frontend')));
    const server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const win = new BrowserWindow({ show: false, width: 900, height: 700 });
    const run = script => win.webContents.executeJavaScript(script);
    try {
        for (const mode of ['light', 'dark', 'hosted-light', 'hosted-dark']) {
            const expected = mode.endsWith('dark') ? 'dark' : 'light';
            nativeTheme.themeSource = 'dark';
            await win.loadURL('http://127.0.0.1:' + server.address().port + '/case/' + mode);
            const snapshot = () => run(`({platform:document.documentElement.dataset.platformTheme,
                root:document.documentElement.dataset.theme,body:document.body.dataset.theme,
                scheme:getComputedStyle(document.documentElement).colorScheme,
                controls:[...document.querySelectorAll('input,select,textarea')].map(el=>[getComputedStyle(el).backgroundColor,getComputedStyle(el).colorScheme]),
                background:getComputedStyle(document.body).backgroundColor,media:matchMedia('(prefers-color-scheme:dark)').matches})`);
            const before = await snapshot();
            assert.equal(before.platform, expected, mode);
            assert.equal(before.root, expected);
            assert.equal(before.body, expected);
            assert.equal(before.scheme, expected);
            assert.equal(before.media, expected === 'dark');
            assert.ok(before.controls.every(control => control[1] === expected));
            assert.equal(await run(`getComputedStyle(document.querySelector('#themeToggleButton')).display`), 'none');
            assert.notEqual(await run(`getComputedStyle(document.querySelector('#slideTheme')).display`), 'none');
            await run(`window.changes=0;matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>changes++);
                localStorage.setItem('tools_theme','light');dispatchEvent(new StorageEvent('storage',{key:'tools_theme',newValue:'light'}));
                document.documentElement.dataset.theme='${expected === 'light' ? 'dark' : 'light'}';
                document.body.classList.add('${expected === 'light' ? 'dark' : 'light'}-theme');void 0`);
            nativeTheme.themeSource = 'light';
            assert.deepEqual(await snapshot(), before, mode + ': platform and OS changes do not recolor tool');
            assert.equal(await run('changes'), 0);
            await run(`window.dynamicStyle=document.createElement('style');dynamicStyle.textContent='@media(prefers-color-scheme:dark){textarea{border-width:7px}}';document.head.append(dynamicStyle);void 0`);
            assert.equal(await run(`getComputedStyle(document.querySelector('textarea')).borderTopWidth`), expected === 'dark' ? '7px' : '1px');
            await run(`dynamicStyle.firstChild.data='@media(prefers-color-scheme:dark){textarea{border-width:9px}}';void 0`);
            assert.equal(await run(`getComputedStyle(document.querySelector('textarea')).borderTopWidth`), expected === 'dark' ? '9px' : '1px');
            assert.equal(await run(`localStorage.getItem('tools_theme')`), 'light', 'tool does not overwrite platform preference');
            if (mode.startsWith('hosted')) assert.equal(await run('window.origin'), 'null', 'hosted sandbox retains opaque origin');
            fs.writeFileSync(path.join(temp, mode + '.png'), (await win.webContents.capturePage()).toPNG());
        }
        console.log('PASS: light/dark tools and opaque hosted apps retain fixed themes across platform/OS/storage changes, legacy preferences, native controls and dynamic media CSS. ' + temp);
    } finally {
        win.destroy();
        server.close();
        app.quit();
    }
}).catch(error => { console.error(error); app.exit(1); });
