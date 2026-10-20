const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-promotions-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const { tenantMiddleware } = require('../backend/models/tenant-context');
const authSessions = require('../backend/models/auth-sessions-repository');
const repo = require('../backend/models/platform-promotions-repository');
const desktopBridge = require('../backend/models/platform-promotions-desktop');
const router = require('../backend/routes/platform-promotions');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');

test('defaults show every built-in video and the NetCare link with three link slots', () => {
    const config = repo.normalizeConfig({});
    assert.deepEqual(config.videos.map(video => [video.id, video.enabled]), [['rfc', true], ['incentive', true], ['eos', true], ['guide', true]]);
    assert.equal(config.links[0].id, 'netcare');
    assert.equal(config.links[0].builtin, true);
    assert.match(config.links[0].url, /^https:\/\/netcare\.huawei\.com\//);
    assert.equal(config.maxLinks, 3);
    assert.equal(config.desktopStack, true);
});

test('built-ins can only be hidden; custom links are validated and keep their order', () => {
    const config = repo.normalizeConfig({
        maxLinks: 99,
        rotateSeconds: 1,
        videos: [{ id: 'eos', enabled: false }, { id: 'unknown', enabled: false }],
        links: [
            { id: 'custom-a', name: 'A', url: 'https://a.example/', color: 'violet', badge: '新站' },
            { id: 'netcare', enabled: false, url: 'https://evil.example/', name: 'Changed' }
        ]
    });
    assert.equal(config.maxLinks, repo.MAX_LINKS_LIMIT);
    assert.equal(config.rotateSeconds, repo.MIN_ROTATE_SECONDS);
    assert.equal(config.videos.length, repo.BUILTIN_VIDEOS.length, 'built-in videos cannot be removed or added');
    assert.equal(config.videos.find(video => video.id === 'eos').enabled, false);
    assert.deepEqual(config.links.map(link => link.id), ['custom-a', 'netcare']);
    const netcare = config.links.find(link => link.id === 'netcare');
    assert.equal(netcare.enabled, false);
    assert.equal(netcare.name, 'NetCare');
    assert.match(netcare.url, /netcare\.huawei\.com/, 'built-in URL cannot be changed');
    assert.equal(config.links[0].color, 'violet');

    // 删除内置链接的请求不会生效：它会被重新补回
    assert.ok(repo.normalizeConfig({ links: [{ name: 'B', url: 'https://b.example/' }] }).links.some(link => link.id === 'netcare'));
    assert.throws(() => repo.normalizeConfig({ links: [{ name: 'X', url: 'javascript:alert(1)' }] }), /HTTP/);
    assert.throws(() => repo.normalizeConfig({ links: [{ name: 'X', url: 'https://user:pass@x.example/' }] }), /账号或密码/);
    assert.throws(() => repo.normalizeConfig({ links: [{ name: '', url: 'https://x.example/' }] }), /名称/);
});

test('config API: everyone reads, only admins write; desktop controls are local-only', async t => {
    const previousRuntime = process.env.TOOLS_DESKTOP_RUNTIME;
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    // 使用 server.js 的真实上游权限中间件，确认本机桌面接口对普通账号放行、配置写入仍需管理员
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
    const end = serverSource.indexOf('\n});', begin) + 4;
    vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
    app.use('/api/platform-promotions', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        desktopBridge.configureDesktopPromotions(null);
        if (previousRuntime === undefined) delete process.env.TOOLS_DESKTOP_RUNTIME; else process.env.TOOLS_DESKTOP_RUNTIME = previousRuntime;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await pool.closeAll();
        await appDb.closeDatabase();
        await platformDb.closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    await authSessions.saveSession('synthetic-viewer', 'viewer1', 'viewer', Date.now() + 60000, 'default');
    await authSessions.saveSession('synthetic-admin', 'admin1', 'admin', Date.now() + 60000, 'default');
    const url = `http://127.0.0.1:${server.address().port}/api/platform-promotions`;
    const as = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

    assert.equal((await fetch(url)).status, 401);
    const initial = await (await fetch(url, { headers: as('synthetic-viewer') })).json();
    assert.equal(initial.links[0].id, 'netcare');

    const body = JSON.stringify({ ...initial, maxLinks: 2, links: [...initial.links, { name: 'Wiki', url: 'https://wiki.example/' }] });
    assert.equal((await fetch(url, { method: 'PUT', headers: as('synthetic-viewer'), body })).status, 403);

    const synced = [];
    const opened = [];
    const sitePuts = [];
    // 纯服务端部署：没有桌面控制器
    assert.deepEqual(await (await fetch(`${url}/desktop`, { headers: as('synthetic-viewer') })).json(), { available: false });
    assert.equal((await fetch(`${url}/desktop/open/netcare`, { method: 'POST', headers: as('synthetic-viewer') })).status, 403);

    process.env.TOOLS_DESKTOP_RUNTIME = '1';
    desktopBridge.configureDesktopPromotions({
        sync: config => synced.push(config),
        status: () => ({ paused: false, hiddenToday: false, items: [] }),
        frame: async id => (id === 'netcare' ? Buffer.from([0xff, 0xd8, 0xff, 0xd9]) : null),
        open: link => { opened.push(link.id); return true; },
        putSiteScript: (site, options) => { sitePuts.push({ ...site, run: options.run }); return { origin: site.origin, name: site.name }; },
        listSiteScripts: () => sitePuts.map(({ code, ...meta }) => meta),
        runSiteScript: origin => sitePuts.some(site => site.origin === origin)
    });
    const saved = await (await fetch(url, { method: 'PUT', headers: as('synthetic-admin'), body })).json();
    assert.equal(saved.maxLinks, 2);
    assert.equal(saved.links.at(-1).name, 'Wiki');
    assert.equal(synced.length, 1, 'saving refreshes the local desktop card stack');

    assert.equal((await (await fetch(`${url}/desktop`, { headers: as('synthetic-viewer') })).json()).available, true);
    assert.equal((await fetch(`${url}/desktop/sync`, { method: 'POST', headers: as('synthetic-viewer') })).status, 200);
    assert.equal(synced.length, 2);
    const frame = await fetch(`${url}/desktop/frame/netcare`, { headers: as('synthetic-viewer') });
    assert.equal(frame.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(`${url}/desktop/frame/other`, { headers: as('synthetic-viewer') })).status, 404);
    assert.equal((await fetch(`${url}/desktop/open/netcare`, { method: 'POST', headers: as('synthetic-viewer') })).status, 200);
    assert.deepEqual(opened, ['netcare']);
    assert.equal((await fetch(`${url}/desktop/open/missing`, { method: 'POST', headers: as('synthetic-viewer') })).status, 404);
    // 其他站点的页面不能驱动本机桌面窗口
    const foreign = await fetch(`${url}/desktop/open/netcare`, { method: 'POST', headers: { ...as('synthetic-viewer'), Origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    assert.deepEqual(opened, ['netcare']);

    // 浮窗脚本：本机普通账号可交给桌面浏览器运行；其他站点页面不行
    const siteBody = JSON.stringify({ origin: 'https://w3.example.com', name: 'W3', url: 'https://w3.example.com/', code: 'console.log(1)', run: false });
    assert.equal((await fetch(`${url}/desktop/site-scripts`, { method: 'POST', headers: as('synthetic-viewer'), body: siteBody })).status, 200);
    assert.equal(sitePuts[0].run, false);
    assert.equal((await fetch(`${url}/desktop/site-scripts`, { method: 'POST', headers: { ...as('synthetic-viewer'), Origin: 'https://evil.example' }, body: siteBody })).status, 403);
    const listed = await (await fetch(`${url}/desktop/site-scripts`, { headers: as('synthetic-viewer') })).json();
    assert.equal(listed.items.length, 1);
    assert.equal('code' in listed.items[0], false);
    assert.equal((await fetch(`${url}/desktop/site-scripts/run`, { method: 'POST', headers: as('synthetic-viewer'), body: JSON.stringify({ origin: 'https://w3.example.com' }) })).status, 200);
    assert.equal((await fetch(`${url}/desktop/site-scripts/run`, { method: 'POST', headers: as('synthetic-viewer'), body: JSON.stringify({ origin: 'https://none.example' }) })).status, 404);

    // 点击统计：普通账号可上报，重复点击去重，统计仅管理员可看
    const click = body => fetch(`${url}/clicks`, { method: 'POST', headers: as('synthetic-viewer'), body: JSON.stringify(body) });
    assert.equal((await (await click({ kind: 'video', id: 'rfc' })).json()).counted, true);
    assert.equal((await (await click({ kind: 'video', id: 'rfc' })).json()).counted, false, 'repeat within 5 seconds counts once');
    assert.equal((await click({ kind: 'link', id: 'netcare', channel: 'desktop' })).status, 200);
    assert.equal((await click({ kind: 'link', id: 'nope' })).status, 404);
    assert.equal((await click({ kind: 'other', id: 'rfc' })).status, 400);
    assert.equal((await fetch(`${url}/stats`, { headers: as('synthetic-viewer') })).status, 403);
    const stats = await (await fetch(`${url}/stats?days=7`, { headers: as('synthetic-admin') })).json();
    assert.equal(stats.days, 7);
    assert.equal(stats.totalUsers, 1);
    const netcareStats = stats.items.find(item => item.id === 'netcare');
    assert.deepEqual(netcareStats.channels, { desktop: 1, tab: 1 }, 'client cannot choose the channel; desktop opens are recorded by the server');
    assert.equal(stats.items.find(item => item.id === 'rfc').clicks, 1);
    assert.equal(JSON.stringify(stats).includes('viewer1'), false, 'no account names in statistics');

    // 用户在桌面卡片堆里直接放大：记到最近同步卡片堆的租户与账号
    assert.equal(await desktopBridge.recordCardClick({ id: 'netcare' }), true);
    const after = await (await fetch(`${url}/stats`, { headers: as('synthetic-admin') })).json();
    assert.equal(after.items.find(item => item.id === 'netcare').channels.card, 1);
});
