// 保险箱 × 浏览器（真实 Chrome）：登录时自动保存、再次访问自动填充并登录、AI 用 browser_login 登录且拿不到密码。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-browser-vault-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const browser = require('../backend/models/agent-browser');
const { vault } = require('../backend/models/password-vault');
const { maskSecrets, vaultOwnerOf } = require('../backend/models/agent-browser-vault');

const PASSWORD = 'Tr0ub4dor&3-vault';
const ALICE = 'default::alice', BOB = 'default::bob', CAROL = 'default::carol';
let server, base, posted = [];
const skip = !browser.findChrome() && '本机没有 Chrome';

const page = body => `<!doctype html><meta charset="utf-8"><title>Demo</title><body>${body}</body>`;
const loginForm = page(`<form method="post" action="/login"><input name="username" autocomplete="username"><input name="password" type="password"><button type="submit">登录</button></form>`);

test.before(async () => {
    server = http.createServer((req, res) => {
        const cookie = req.headers.cookie || '';
        if (req.method === 'POST' && req.url === '/login') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                const form = new URLSearchParams(body);
                posted.push({ username: form.get('username'), password: form.get('password') });
                const ok = form.get('password') === PASSWORD;
                res.writeHead(302, { Location: ok ? '/home' : '/login?failed=1', ...(ok ? { 'Set-Cookie': `user=${encodeURIComponent(form.get('username'))}; Path=/` } : {}) });
                res.end();
            });
            return;
        }
        res.setHeader('content-type', 'text/html; charset=utf-8');
        if (req.url === '/logout') { res.writeHead(302, { Location: '/login', 'Set-Cookie': 'user=; Path=/; Max-Age=0' }); return res.end(); }
        if (req.url.startsWith('/home')) return res.end(/user=([^;]+)/.test(cookie) ? page(`<h1>欢迎 ${decodeURIComponent(RegExp.$1)}</h1>`) : loginForm);
        res.end(loginForm);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    await browser.shutdownAll();
    await vault().close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
        fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 15, retryDelay: 300 });
    } catch (_) {}
});

const run = (owner, name, args = {}) => browser.execute({ owner }, name, args);
const activePage = owner => { const state = browser._internal.owners.get(owner); return state.tabs.get(state.active); };
const until = async (check, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
        try {
            if (await check()) return true;
        } catch (_) {}
        if (Date.now() > end) return false;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
};
/** 像用户一样输入并回车（CDP 的输入事件是可信事件） */
async function typeLogin(owner, username, password) {
    const tab = activePage(owner);
    await tab.evaluate(`document.querySelector('[name=username]').focus()`);
    await tab.cdp('Input.insertText', { text: username });
    await tab.evaluate(`document.querySelector('[name=password]').focus()`);
    await tab.cdp('Input.insertText', { text: password });
    for (const type of ['keyDown', 'keyUp']) await tab.cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
}

test('typing a login into the page saves it to that account\'s vault only', { skip }, async () => {
    assert.match((await run(ALICE, 'browser_navigate', { url: `${base}/login` })).content, /已打开/);
    assert.ok(await until(() => activePage(ALICE).evaluate('true')));
    await new Promise(resolve => setTimeout(resolve, 600)); // 页面内脚本完成探测
    await typeLogin(ALICE, 'alice@example.com', PASSWORD);
    assert.ok(await until(async () => (await vault().find('alice', base)).length === 1), 'saved on submit');
    assert.equal(await vault().reveal('alice', (await vault().find('alice', base))[0].id), PASSWORD);
    assert.deepEqual(await vault().find('bob', base), []);
    assert.deepEqual(await vault().find('default::alice', base), [], 'keyed by account, not by tenant::account');
    assert.ok(await until(async () => /欢迎/.test(await activePage(ALICE).evaluate('(document.body?.innerText) || ""'))));
    const seen = await browser.view(ALICE);
    assert.deepEqual([seen.vault?.kind, seen.vault?.username], ['saved', 'al***@example.com']);
    assert.equal(JSON.stringify({ ...seen, image: '' }).includes(PASSWORD), false);
});

test('right after signing in by hand the form is only filled; browser_login signs in on request without returning the password', { skip }, async () => {
    posted = [];
    await run(ALICE, 'browser_navigate', { url: `${base}/logout` });
    assert.ok(await until(async () => (await activePage(ALICE).evaluate(`document.querySelector('[name=password]')?.value.length || 0`)) === PASSWORD.length), 'filled');
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.deepEqual(posted, [], 'no automatic submit inside the cooldown that starts with a manual sign-in');

    // 密码还在输入框里时，模型不能用页面脚本把它换个形式读走
    const blocked = await run(ALICE, 'browser_evaluate', { expression: `[...document.querySelector('[name=password]').value].map(c => c.charCodeAt(0))` });
    assert.equal(blocked.isError, true);
    assert.match(blocked.content, /不能执行页面脚本/);

    const result = await run(ALICE, 'browser_login', {});
    assert.equal(result.isError, undefined);
    assert.match(result.content, /已用保险箱账号 al\*\*\*@example\.com 填写并提交（密码未向你提供）/);
    assert.match(result.content, /已提交登录/);
    assert.equal(JSON.stringify(result).includes(PASSWORD), false);
    assert.deepEqual(posted, [{ username: 'alice@example.com', password: PASSWORD }]);
    assert.ok(await until(async () => /欢迎 alice@example.com/.test(await activePage(ALICE).evaluate('(document.body?.innerText) || ""'))));
    const preview = await browser.preview({ owner: ALICE }, 'browser_login', {});
    assert.equal(JSON.stringify(preview).includes(PASSWORD), false);
    assert.match(JSON.stringify(preview), /al\*\*\*@example\.com/);
});

test('nothing a browser tool returns to the model contains the password', { skip }, async () => {
    // 登录请求体里有密码：给模型的任何浏览器工具结果都要抹掉
    const list = await run(ALICE, 'browser_network', { filter: '/login' });
    const requestId = /\[([^\]]+)\]\s+POST/.exec(list.content)?.[1] || /(\S+)\s+POST/.exec(list.content)?.[1];
    const snapshot = await run(ALICE, 'browser_snapshot');
    assert.equal(snapshot.content.includes(PASSWORD), false);
    if (requestId) {
        const body = await run(ALICE, 'browser_network_body', { requestId });
        assert.equal(body.content.includes(PASSWORD) || body.content.includes(encodeURIComponent(PASSWORD)), false, 'request body is masked');
        assert.match(body.content, /保险箱密码/);
    }
    const leaked = await run(ALICE, 'browser_evaluate', { expression: JSON.stringify(PASSWORD) });
    assert.equal(leaked.content.includes(PASSWORD), false);
    const encoded = await run(ALICE, 'browser_evaluate', { expression: JSON.stringify(encodeURIComponent(PASSWORD)) });
    assert.equal(encoded.content.includes(encodeURIComponent(PASSWORD)), false);
});

test('a saved login is filled and signed in automatically when the sign-in page opens, once per cooldown', { skip }, async () => {
    posted = [];
    await vault().save('carol', { url: `${base}/anything`, username: 'carol', password: PASSWORD });
    await run(CAROL, 'browser_navigate', { url: `${base}/login` });
    assert.ok(await until(async () => /欢迎 carol/.test(await activePage(CAROL).evaluate('(document.body?.innerText) || ""'))), 'auto filled and submitted');
    assert.deepEqual(posted, [{ username: 'carol', password: PASSWORD }]);
    assert.equal((await browser.view(CAROL)).vault?.kind, 'filled');

    await run(CAROL, 'browser_navigate', { url: `${base}/logout` });
    assert.ok(await until(async () => (await activePage(CAROL).evaluate(`document.querySelector('[name=password]')?.value.length || 0`)) === PASSWORD.length));
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(posted.length, 1, 'signing out does not sign straight back in');

    // 条目关掉「自动填写」后什么都不做
    const entry = (await vault().find('carol', base))[0];
    await vault().update('carol', entry.id, { autoFill: false });
    await run(CAROL, 'browser_navigate', { url: `${base}/login` });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(await activePage(CAROL).evaluate(`document.querySelector('[name=password]').value`), '');
});

test('another account gets nothing from someone else\'s vault', { skip }, async () => {
    posted = [];
    await run(BOB, 'browser_navigate', { url: `${base}/login` });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(await activePage(BOB).evaluate(`document.querySelector('[name=password]').value`), '');
    const result = await run(BOB, 'browser_login', {});
    assert.equal(result.isError, true);
    assert.match(result.content, /保险箱里没有 .* 的账号/);
    assert.deepEqual(posted, []);
});

test('never-save sites are not captured; several accounts need a choice', { skip }, async () => {
    await vault().setNeverSave('bob', base, true);
    await run(BOB, 'browser_navigate', { url: `${base}/login` });
    await new Promise(resolve => setTimeout(resolve, 600));
    await typeLogin(BOB, 'bob', PASSWORD);
    assert.ok(await until(async () => /欢迎 bob/.test(await activePage(BOB).evaluate('(document.body?.innerText) || ""'))));
    assert.deepEqual(await vault().find('bob', base), []);

    await vault().save('alice', { url: base, username: 'ops', password: 'another-secret-pw' });
    await run(ALICE, 'browser_navigate', { url: `${base}/logout` });
    const choose = await run(ALICE, 'browser_login', {});
    assert.equal(choose.isError, true);
    assert.match(choose.content, /多个账号：.*al\*\*\*@example\.com/);
    const picked = await run(ALICE, 'browser_login', { username: 'al***@example.com' });
    assert.match(picked.content, /已用保险箱账号 al\*\*\*@example\.com/);
});

test('helpers', () => {
    assert.equal(vaultOwnerOf('team-x::alice'), 'alice');
    assert.equal(vaultOwnerOf(''), null);
    assert.equal(maskSecrets(`a=p%40ss%2Fword&b="p@ss/word"`, new Set(['p@ss/word'])), 'a=[保险箱密码]&b="[保险箱密码]"');
});
