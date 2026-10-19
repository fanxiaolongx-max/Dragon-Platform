const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const modelsDir = path.join(root, 'backend/models');

// 用桩替换三个脚本仓库，只验证首页「插件与脚本」目录的汇总规则
const stubs = {
    f12: { listPresets: async () => [] },
    python: { listScripts: async () => [] },
    uiv: { listScripts: async () => ({ items: [] }) }
};
function stubModule(file, exports) {
    const resolved = require.resolve(path.join(modelsDir, file));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stubModule('f12-script-presets-repository.js', { listPresets: (...args) => stubs.f12.listPresets(...args) });
stubModule('python-script-repository.js', { listScripts: (...args) => stubs.python.listScripts(...args) });
stubModule('uiv-scripts-repository.js', { listScripts: (...args) => stubs.uiv.listScripts(...args) });
stubModule('bundled-scripts.js', { ensureSeeded: async () => {}, bundledIds: () => new Set() });

const { listCapabilities } = require('../backend/models/home-capabilities');
const builtinCatalog = require('../backend/builtin-tools/f12-to-extension/builtin-catalog.js');

test('F12 built-in plugins are always listed and deep-link into the packer', async () => {
    const { groups } = await listCapabilities();
    const f12 = groups.find(group => group.kind === 'f12');
    assert.ok(f12, 'f12 group exists');
    assert.equal(f12.count, Object.keys(builtinCatalog).length);
    const first = Object.keys(builtinCatalog)[0];
    const item = f12.items.find(entry => entry.id === `f12:builtin:${first}`);
    assert.equal(item.href, `/tools/f12-to-extension?script=${first}`);
    assert.equal(item.kind, 'f12');
    assert.ok(f12.where && f12.href);
});

test('server F12 presets are admin-only and skip names that duplicate built-ins', async () => {
    const builtinName = Object.values(builtinCatalog)[0].name;
    stubs.f12.listPresets = async () => [
        { id: 'abc', name: '自定义抓取', description: '', updatedAt: '2026-10-01T00:00:00Z' },
        { id: 'dup', name: builtinName, description: 'duplicate' }
    ];
    const asUser = await listCapabilities({ isAdmin: false });
    assert.equal(asUser.groups.find(group => group.kind === 'f12').items.some(item => item.id.startsWith('f12:server:')), false);

    const asAdmin = await listCapabilities({ isAdmin: true });
    const server = asAdmin.groups.find(group => group.kind === 'f12').items.filter(item => item.id.startsWith('f12:server:'));
    assert.deepEqual(server.map(item => item.id), ['f12:server:abc']);
    assert.equal(server[0].href, '/tools/f12-to-extension?script=server%3Aabc');
    assert.ok(server[0].description, 'empty descriptions get a fallback');
    stubs.f12.listPresets = async () => [];
});

test('Python scripts and floating-script sites grow automatically from their repositories', async () => {
    stubs.python.listScripts = async () => [{ id: 'pr-audit', name: 'PR 抽查', description: '抽查', current_version: '1.2.0', updated_at: '2026-10-02 08:00:00' }];
    stubs.uiv.listScripts = async () => ({
        items: [
            { name: '风险详单', url: 'https://netcare.huawei.com/api/a' },
            { name: '整改工单', code: '// URL: https://netcare.huawei.com/api/b' },
            { name: '演练报表', url: 'https://datafab-pro.gtsdata.huawei.com/x', updatedAt: '2026-10-03T00:00:00Z' },
            { name: '无地址脚本' }
        ]
    });
    const { groups } = await listCapabilities();
    const python = groups.find(group => group.kind === 'python');
    assert.equal(python.items[0].href, '/tools/python-updater?script=pr-audit');
    assert.equal(python.items[0].badge, 'v1.2.0');
    assert.equal(python.items[0].updatedAt, '2026-10-02T08:00:00.000Z');

    const float = groups.find(group => group.kind === 'float');
    assert.deepEqual(float.items.map(item => item.name).sort(), ['DataFab 浮窗', 'NetCare 中国 浮窗'].sort());
    const netcare = float.items.find(item => item.name === 'NetCare 中国 浮窗');
    assert.equal(netcare.badge, '2');
    assert.equal(netcare.href, '/uivf12?siteScripts=1');
    stubs.python.listScripts = async () => [];
    stubs.uiv.listScripts = async () => ({ items: [] });
});

test('a failing provider only empties its own group', async () => {
    stubs.python.listScripts = async () => { throw new Error('db down'); };
    const warn = console.warn;
    console.warn = () => {};
    try {
        const { groups } = await listCapabilities();
        assert.equal(groups.some(group => group.kind === 'python'), false);
        assert.ok(groups.some(group => group.kind === 'f12'));
    } finally {
        console.warn = warn;
        stubs.python.listScripts = async () => [];
    }
});

test('home page and tool pages wire the capability catalog and deep links', () => {
    const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
    const index = read('frontend/index.html');
    assert.match(index, /id="homeCapsNav"/);
    assert.match(index, /id="homeCaps"/);
    assert.match(index, /id="homeCapsEntry"/);
    assert.match(index, /\/js\/home\/capabilities\.js/);
    assert.match(read('backend/server.js'), /\/api\/home\/capabilities/);
    assert.match(read('frontend/pages/custom-tool.html'), /new URLSearchParams\(location\.search\)\.forEach/);
    assert.match(read('backend/builtin-tools/f12-to-extension/index.html'), /quickRequest\.get\('script'\)/);
    assert.match(read('backend/builtin-tools/python-updater/index.html'), /get\('script'\)/);
    assert.match(read('frontend/js/uivf12/copy.js'), /get\('siteScripts'\) === '1'/);
});
