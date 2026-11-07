const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../backend/models/desktop-agents/repository');
const wb = require('../backend/models/desktop-agents/workbuddy');
const service = require('../backend/models/desktop-agents/service');

// 首次点击与后台轮询都只读记录，不发送会触发客户端窗口切换的深链。
test('opening and polling a WorkBuddy conversation read history without opening the native app', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const row = { id, provider: 'workbuddy', title: 'Local history' };
    const items = [{ id: 'reply', role: 'assistant', content: 'Saved reply' }];
    test.mock.method(repo, 'access', async () => ({ syncSeconds: 20, recentLimit: 20, allowSend: true, providers: { workbuddy: true } }));
    test.mock.method(wb, 'list', async () => [row]);
    test.mock.method(wb, 'status', async () => ({ connected: true, canSend: true }));
    const reads = test.mock.method(wb, 'transcript', async session => {
        assert.equal(session.id, id);
        return { available: true, items };
    });
    let opens = 0;
    // 保留旧入口的探针：若消息读取重新调用 wb.open，测试必须失败。
    wb.open = () => { opens++; };
    try {
        for (const options of [undefined, { passive: false }, { passive: true }]) {
            const result = await service.messages('workbuddy-passive-fixture', 'workbuddy', id, options);
            assert.deepEqual(result.items, items);
            assert.equal(result.available, true);
            assert.equal(result.canSend, true);
        }
        assert.equal(reads.mock.callCount(), 3);
        assert.equal(opens, 0, 'history reads must not launch native deep links');
    } finally {
        delete wb.open;
        test.mock.restoreAll();
    }
});
