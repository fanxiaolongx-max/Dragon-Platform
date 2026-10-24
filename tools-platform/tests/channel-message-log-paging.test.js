// 全局设置 › 频道对接 › 消息日志：按 id 游标分页，最新在前，翻页不漏不重，租户隔离。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'channel-log-paging-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const repo = require('../backend/models/channels/channel-targets-repository');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await appDb.closeDatabase?.();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('message log pages walk from newest to oldest without gaps or duplicates', () => runWithTenant('default', async () => {
    for (let index = 0; index < 65; index += 1) {
        await repo.logMessage('welink', { direction: index % 2 ? 'out' : 'in', kind: 'user', targetId: `u${index}`, text: `msg-${index}`, status: 'ok' });
    }
    await repo.logMessage('other-channel', { direction: 'in', kind: 'user', targetId: 'x', text: 'not welink' });

    const first = await repo.listMessagesPage('welink', { limit: 30 });
    assert.deepEqual([first.items.length, first.hasMore, first.total], [30, true, 65]);
    assert.equal(first.items[0].text, 'msg-64', 'newest first');
    const second = await repo.listMessagesPage('welink', { limit: 30, before: first.items.at(-1).id });
    const third = await repo.listMessagesPage('welink', { limit: 30, before: second.items.at(-1).id });
    assert.deepEqual([second.items.length, third.items.length, third.hasMore], [30, 5, false]);
    const texts = [...first.items, ...second.items, ...third.items].map(item => item.text);
    assert.equal(new Set(texts).size, 65);
    assert.equal(texts.at(-1), 'msg-0');
    assert.ok(!texts.includes('not welink'), 'other channels never leak into the page');

    // 非法参数退回默认值，不会一次性取出全部
    const fallback = await repo.listMessagesPage('welink', { limit: 'abc', before: 'not-a-number' });
    assert.deepEqual([fallback.items.length, fallback.items[0].text], [30, 'msg-64']);
    assert.equal((await repo.listMessagesPage('welink', { limit: 100000 })).items.length, 65, 'page size is capped at 200');
}));

test('message log pages are isolated per tenant', () => runWithTenant('acme', async () => {
    fs.mkdirSync(path.join(sandbox, 'data', 'tenants', 'acme'), { recursive: true });
    const page = await repo.listMessagesPage('welink', { limit: 30 });
    assert.deepEqual([page.items.length, page.total, page.hasMore], [0, 0, false]);
}));

test('settings page loads the log lazily, page by page, without re-rendering the diagnostics panel', () => {
    const js = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/channel-settings.js'), 'utf8');
    assert.doesNotMatch(js, /Promise\.all\(\[loadTargets\(\), loadMessages\(\)\]\)/, 'opening the tab no longer fetches the log');
    assert.match(js, /const MESSAGE_PAGE_SIZE = 30;/);
    assert.match(js, /\/messages\?limit=\$\{MESSAGE_PAGE_SIZE\}\$\{before \? `&before=\$\{before\}` : ''\}/);
    assert.match(js, /new IntersectionObserver\(/);
    assert.match(js, /data-role="messages-log-area"/, 'only the table area re-renders, so an open diagnostics panel stays open');
    assert.match(js, /rerenderMessageLog\(\{ toTop: reset \}\)/, 'refresh returns to the newest page at the top');
    assert.match(js, /data-action="message-expand"/);
});
