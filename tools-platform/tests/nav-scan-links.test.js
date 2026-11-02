const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 首页左下角“扫码使用”的微信 / WeLink 链接存在导航设置 scanLinks 里
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-scan-links-test-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const repo = require('../backend/models/nav-settings-repository');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('scan links accept only plain http(s) URLs', () => {
    const { scanLinks } = repo.normalizeSettings({
        scanLinks: { weixin: ' https://example.com/bot?x=1 ', welink: 'javascript:alert(1)', extra: 'https://ignored.example' }
    });
    assert.deepEqual(scanLinks, { weixin: 'https://example.com/bot?x=1', welink: '' });
    assert.deepEqual(repo.normalizeSettings({ scanLinks: { welink: 'https://user:pass@example.com' } }).scanLinks, { weixin: '', welink: '' });
    assert.deepEqual(repo.normalizeSettings({}).scanLinks, { weixin: '', welink: '' });
});

test('saving navigation without scanLinks keeps the configured links', async () => {
    await runWithTenant('default', async () => {
        const current = await repo.getSettings();
        await repo.saveSettings({ ...current, scanLinks: { weixin: 'https://example.com/wx', welink: 'https://example.com/wl' } });
        const { scanLinks, ...olderClient } = await repo.getSettings();
        assert.equal(scanLinks.weixin, 'https://example.com/wx');
        await repo.saveSettings(olderClient);
        assert.deepEqual((await repo.getSettings()).scanLinks, { weixin: 'https://example.com/wx', welink: 'https://example.com/wl' });
    });
});
