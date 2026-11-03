// node_modules/.bin/electron --disable-gpu tests/browser-credentials-browser.cjs
// Local HTTPS fixtures, disposable profile, fake credentials and injected encryption.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), https = require('node:https'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createBrowserCredentials, attachBrowserLogin } = require('../desktop-promo/browser-credentials');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-password-browser-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('host-resolver-rules', 'MAP netcare.huawei.com 127.0.0.1, MAP datafab-pro.gtsdata.huawei.com 127.0.0.1, MAP login.huawei.com 127.0.0.1');
app.on('window-all-closed', () => {});
let server, store; const windows = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await wait(40); } throw new Error('Fixture condition timed out'); }
const key = crypto.randomBytes(32);
const secure = {
    isEncryptionAvailable: () => true,
    encryptString: text => { const iv = crypto.randomBytes(16), cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final()]); },
    decryptString: data => { const decipher = crypto.createDecipheriv('aes-256-cbc', key, data.subarray(0, 16)); return Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]).toString(); }
};
const timeout = setTimeout(() => app.exit(1), 50000);
app.whenReady().then(async () => {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem'), '-subj', '/CN=netcare.huawei.com', '-days', '1'], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(path.join(temp, 'key.pem')), cert: fs.readFileSync(path.join(temp, 'cert.pem')) }, (req, res) => {
        if (req.url === '/redirect') { res.writeHead(302, { Location: `https://login.huawei.com:${server.address().port}/login` }); res.end(); return; }
        const verification = req.url.includes('captcha');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const form = `<form onsubmit="event.preventDefault();window.submits=(window.submits||0)+1"><input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="current-password">${verification ? '<input id="otp" name="otp" placeholder="短信验证码">' : ''}<button type="submit">登录</button></form>`;
        res.end(`<!doctype html><html><body>${req.url.includes('dynamic') ? `<script>setTimeout(()=>{document.body.innerHTML=${JSON.stringify(form)}},250)</script>` : form}</body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const origin = `https://netcare.huawei.com:${port}`;
    const browserSession = session.fromPartition('persist:password-fixture');
    browserSession.setProxy({ mode: 'direct' });
    browserSession.setCertificateVerifyProc((request, callback) => callback(['netcare.huawei.com', 'datafab-pro.gtsdata.huawei.com', 'login.huawei.com'].includes(request.hostname) ? 0 : -3));
    store = createBrowserCredentials(path.join(temp, 'passwords.db'), secure);
    async function open(url, localStore = store) {
        const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { session: browserSession, preload: path.resolve(__dirname, '../desktop-promo/page-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
        windows.push(win);
        attachBrowserLogin(win.webContents, { getStore: () => localStore });
        await win.loadURL(url); return win;
    }
    const first = await open(origin + '/login');
    await wait(300);
    await first.webContents.executeJavaScript(`document.getElementById('user').value='fixture-user';document.getElementById('pass').value='fixture-password';`);
    const rect = await first.webContents.executeJavaScript(`(()=>{const r=document.querySelector('button').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    first.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
    first.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect });
    await until(async () => !!(await store.read(origin)));
    first.destroy();
    const second = await open(origin + '/dynamic');
    await until(async () => await second.webContents.executeJavaScript('window.submits === 1'));
    assert.equal(await second.webContents.executeJavaScript(`document.getElementById('pass').value === 'fixture-password'`), true);
    second.destroy();
    const third = await open(origin + '/login');
    await wait(1000);
    assert.equal(await third.webContents.executeJavaScript('window.submits || 0'), 0, 'a failed login is not resubmitted in a fresh tab');
    assert.equal(await third.webContents.executeJavaScript(`document.getElementById('pass').value === 'fixture-password'`), true);
    const otherOrigin = `https://datafab-pro.gtsdata.huawei.com:${port}`;
    const foreign = await open(otherOrigin + '/login'); await wait(900);
    assert.equal(await foreign.webContents.executeJavaScript(`document.getElementById('pass').value`), '', 'exact origin isolation');
    // A fresh manager models a later app session; captcha still blocks submission.
    const captchaStore = createBrowserCredentials(path.join(temp, 'passwords.db'), secure);
    const captcha = await open(origin + '/captcha', captchaStore); await wait(1100);
    assert.equal(await captcha.webContents.executeJavaScript(`document.getElementById('pass').value === 'fixture-password'`), true);
    assert.equal(await captcha.webContents.executeJavaScript('window.submits || 0'), 0, 'OTP requires manual completion');
    await store.remove(origin);
    const disabled = await open(origin + '/login'); await wait(900);
    assert.equal(await disabled.webContents.executeJavaScript(`document.getElementById('pass').value`), '');
    assert.equal(await disabled.webContents.executeJavaScript(`typeof window.ipcRenderer`), 'undefined');
    // Real Dragon browser wiring: a batch starts about:blank, visits NetCare,
    // then redirects to SSO. Only the SSO origin's saved credential is filled.
    const ssoOrigin = `https://login.huawei.com:${port}`;
    await store.save(ssoOrigin, { username: 'fixture-sso', password: 'fixture-sso-password' });
    const { createDragonBrowser } = require('../desktop-promo/dragon-browser');
    const browser = createDragonBrowser({ partition: 'persist:password-fixture', whenReady: () => Promise.resolve(), getLanguage: () => 'zh-CN', getWorkArea: () => ({ x: 0, y: 0, width: 1200, height: 900 }), getCredentialStore: () => store });
    try {
        const tab = browser.open({ link: { name: 'Fixture', url: 'about:blank' } });
        await until(() => tab.page.webContents.getURL() === 'about:blank' && !tab.page.webContents.isLoading());
        await tab.page.webContents.loadURL(origin + '/redirect');
        await until(async () => await tab.page.webContents.executeJavaScript('window.submits === 1'));
        assert.equal(await tab.page.webContents.executeJavaScript(`document.getElementById('user').value`), 'fixture-sso');
    } finally { browser.destroy(); }
    windows.forEach(win => { if (!win.isDestroyed()) win.destroy(); });
    await captchaStore.close(); await store.close(); server.close(); clearTimeout(timeout);
    console.log('PASS: trusted manual login saved; dynamic form autofill/sign-in; retry throttle; exact-origin isolation; OTP manual; forget/disable; isolated preload.'); app.exit(0);
}).catch(async error => { console.error(error); clearTimeout(timeout); windows.forEach(win => { if (!win.isDestroyed()) win.destroy(); }); await store?.close().catch(() => {}); server?.close(); app.exit(1); });
