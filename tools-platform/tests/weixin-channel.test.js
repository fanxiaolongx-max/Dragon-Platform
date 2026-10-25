const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-channel-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
process.env.OPENCLAW_STATE_DIR = path.join(sandbox, 'openclaw');

// 替换 Dragon Claw 对话入口，避免测试依赖真实模型
const aiRoutePath = require.resolve('../backend/routes/ai');
const aiCalls = [];
require.cache[aiRoutePath] = {
    id: aiRoutePath, filename: aiRoutePath, loaded: true,
    exports: {
        handleChatRequest: async (req, res) => {
            aiCalls.push({ user: req.user, body: req.body, channelTurn: req.channelTurn });
            res.status(200);
            res.flushHeaders();
            res.write(`${JSON.stringify({ type: 'start', sessionId: 'wx-ai-1' })}\n`);
            res.write(`${JSON.stringify({ type: 'done', reply: '**你好**，详见 [月报](/monthly) 与 [官网](https://example.com) ![图](/x.png)' })}\n`);
            res.end();
        }
    }
};

const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const ilink = require('../backend/models/channels/weixin-ilink-client');
const configRepo = require('../backend/models/channels/weixin-config-repository');
const targetsRepo = require('../backend/models/channels/channel-targets-repository');
const service = require('../backend/models/channels/weixin-bridge-service');
const channels = require('../backend/models/channels');

// 模拟 iLink：getUpdates 依次吐出排好的批次，没有时挂起到中止；sendText 记录发出的消息
const fake = { batches: [], sent: [], polls: 0, stale: false };
ilink.notifyStart = async () => ({ ret: 0 });
ilink.notifyStop = async () => ({ ret: 0 });
ilink.getConfig = async () => ({ ret: 0, typing_ticket: 't' });
ilink.sendTyping = async () => {};
ilink.sendText = async options => { fake.sent.push(options); return { messageId: String(fake.sent.length) }; };
ilink.getUpdates = async ({ signal, getUpdatesBuf }) => {
    fake.polls += 1;
    if (fake.stale) return { ret: ilink.STALE_TOKEN_ERRCODE, errcode: ilink.STALE_TOKEN_ERRCODE };
    const next = fake.batches.shift();
    if (next) return { ret: 0, msgs: next, get_updates_buf: `buf-${fake.polls}` };
    // 与真实长轮询一样：没有消息时挂起一会儿再返回空
    await new Promise(resolve => {
        const timer = setTimeout(resolve, 30);
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
};

const inTenant = fn => runWithTenant('default', fn);

async function waitFor(check, timeout = 3000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('waitFor timeout');
}

function textMessage(from, text, extra = {}) {
    return { from_user_id: from, message_type: ilink.MessageType.USER, context_token: `ctx-${from}`, item_list: [{ type: ilink.MessageItemType.TEXT, text_item: { text } }], ...extra };
}

test.after(async () => {
    await service.stopAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('消息转换：入站合并文字/语音/引用，出站去掉图片与平台内链接，长文本分段', () => {
    const text = service.inboundText({ item_list: [
        { type: 1, text_item: { text: '看下这个' }, ref_msg: { title: '上一条' } },
        { type: 3, voice_item: { text: '语音内容' } },
        { type: 2 }
    ] });
    assert.equal(text, '> 引用：上一条\n看下这个\n语音内容\n[图片]');
    assert.equal(service.toWeixinText('见 [月报](/monthly)、[官网](https://a.com) ![x](/y.png)'), '见 月报、官网（https://a.com）');
    const chunks = service.chunkText(`${'a'.repeat(3000)}\n${'b'.repeat(3000)}`, 3800);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0], 'a'.repeat(3000));
});

test('配置：token 只返回掩码，空值保留原 token，换 token 清空同步游标', async () => {
    await inTenant(async () => {
        await configRepo.saveConfig({ token: 'bot-token-1234567890', botId: 'bot-1' });
        await configRepo.saveState({ getUpdatesBuf: 'old', contextTokens: { u: 'c' } });
        const pub = await configRepo.getPublicConfig();
        assert.equal(pub.token, undefined);
        assert.equal(pub.hasToken, true);
        assert.match(pub.maskedToken, /\*\*\*\*/);
        await configRepo.saveConfig({ token: pub.maskedToken, modelId: 'm1' });
        assert.equal((await configRepo.getConfig()).token, 'bot-token-1234567890');
        assert.equal((await configRepo.getState()).getUpdatesBuf, 'old');
        await configRepo.saveConfig({ token: 'bot-token-other' });
        assert.deepEqual(await configRepo.getState(), { getUpdatesBuf: '', contextTokens: {} });
    });
});

test('从 OpenClaw 导入：带上 token、游标与联系人 context_token', async () => {
    const dir = path.join(process.env.OPENCLAW_STATE_DIR, 'openclaw-weixin', 'accounts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '..', 'accounts.json'), JSON.stringify(['oc-bot']));
    fs.writeFileSync(path.join(dir, 'oc-bot.json'), JSON.stringify({ token: 'oc-token-abcdefgh', baseUrl: 'https://ilinkai.weixin.qq.com', userId: 'owner@im.wechat' }));
    fs.writeFileSync(path.join(dir, 'oc-bot.sync.json'), JSON.stringify({ get_updates_buf: 'oc-buf' }));
    fs.writeFileSync(path.join(dir, 'oc-bot.context-tokens.json'), JSON.stringify({ 'owner@im.wechat': 'oc-ctx' }));
    fs.writeFileSync(path.join(process.env.OPENCLAW_STATE_DIR, 'openclaw.json'), JSON.stringify({ plugins: { entries: { 'openclaw-weixin': { enabled: true } } } }));
    const result = await inTenant(() => service.importFromOpenClaw('default'));
    assert.equal(result.accountId, 'oc-bot');
    assert.equal(result.status.openclaw.sameToken, true);
    assert.equal(result.status.openclaw.pluginEnabled, true);
    await inTenant(async () => {
        const config = await configRepo.getConfig();
        assert.equal(config.token, 'oc-token-abcdefgh');
        assert.equal(config.source, 'openclaw');
        assert.deepEqual(await configRepo.getState(), { getUpdatesBuf: 'oc-buf', contextTokens: { 'owner@im.wechat': 'oc-ctx' } });
    });
});

test('收消息：复用 Provider 的访问控制、斜杠命令与 Dragon Claw 回复，回复经 iLink 发回微信', async () => {
    await inTenant(() => configRepo.saveConfig({ enabled: true, access: { users: { mode: 'blacklist', whitelist: [], blacklist: ['bad@im.wechat'] } } }));
    await service.applyConfig('default');
    fake.batches.push([
        textMessage('alice@im.wechat', '你好'),
        textMessage('bad@im.wechat', '我也来'),
        { from_user_id: 'bot', message_type: ilink.MessageType.BOT, item_list: [{ type: 1, text_item: { text: '回声' } }] }
    ]);
    await waitFor(() => fake.sent.length >= 2);
    const alice = fake.sent.find(item => item.to === 'alice@im.wechat');
    assert.equal(alice.text, '**你好**，详见 月报 与 官网（https://example.com）');
    assert.equal(alice.contextToken, 'ctx-alice@im.wechat');
    assert.match(fake.sent.find(item => item.to === 'bad@im.wechat').text, /暂无权限/);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].user.username, 'weixin:alice@im.wechat');
    assert.match(aiCalls[0].body.context, /微信 单聊/);
    assert.equal(aiCalls[0].body.pageTitle, '微信 频道');

    // iLink 不给昵称：bot 绑定人自动命名，规则回复不念微信 ID
    await inTenant(() => configRepo.saveConfig({ replyEngine: 'rule' }));
    fake.batches.push([textMessage('owner@im.wechat', '你好')]);
    await waitFor(() => fake.sent.length >= 3);
    assert.equal(fake.sent[2].text, '👋 你好！我是平台助理。输入 /help 查看可用命令。');
    assert.equal((await inTenant(() => targetsRepo.getTarget('weixin', 'user', 'owner@im.wechat'))).name, '本人（Bot 绑定的微信）');
    await inTenant(() => configRepo.saveConfig({ replyEngine: 'dragon-claw' }));
    fake.sent.splice(2);

    fake.batches.push([textMessage('alice@im.wechat', '/whoami')]);
    await waitFor(() => fake.sent.length >= 3);
    assert.match(fake.sent[2].text, /alice@im.wechat/);

    const status = await service.getStatus('default');
    assert.equal(status.connected, true);
    const watchdog = require('../backend/models/channels/channel-watchdog');
    const summary = await watchdog.inspectTenantNow('default');
    const channel = summary.channels.find(item => item.id === 'weixin');
    assert.equal(status.runtime.state, 'ready');
    assert.equal(channel.state, 'operational');
    assert.equal(channel.heartbeat.healthy, true);
    assert.ok(channel.heartbeat.lastHeartbeatAt);
    assert.equal(channel.lastError, null);
    assert.equal(status.provider.inbound, 4);
    assert.equal(status.provider.denied, 1);
    await inTenant(async () => {
        const state = await configRepo.getState();
        assert.equal(state.contextTokens['alice@im.wechat'], 'ctx-alice@im.wechat');
        assert.match(state.getUpdatesBuf, /^buf-/);
        const target = await targetsRepo.getTarget('weixin', 'user', 'alice@im.wechat');
        assert.ok(target.canPush);
        // 首页对话侧栏的「微信」分类按段落列出会话
        const threads = await require('../backend/models/channels/channel-followups-repository').listThreads('weixin');
        assert.ok(threads.some(item => item.kind === 'user' && item.id === 'alice@im.wechat'));
    });
});

test('主动推送：走频道公共入口，遵守黑名单，无会话与群组给出明确原因', async () => {
    const before = fake.sent.length;
    const result = await inTenant(() => channels.push({
        channel: 'weixin',
        text: '月报已发布',
        targets: [{ kind: 'user', id: 'alice@im.wechat' }, { kind: 'user', id: 'bad@im.wechat' }, { kind: 'user', id: 'nobody' }, { kind: 'group', id: 'g1' }]
    }));
    assert.equal(result.sent, 1);
    assert.equal(fake.sent.length, before + 1);
    assert.equal(fake.sent.at(-1).to, 'alice@im.wechat');
    const errors = Object.fromEntries(result.results.map(item => [item.id, item.error || '']));
    assert.match(errors['bad@im.wechat'], /黑名单/);
    assert.match(errors.nobody, /尚未给助理发过消息/);
    assert.match(errors.g1, /不支持向群推送/);
});

test('推送写入对话记录：时间线带推送标记，联系人随后发消息接着同一段对话', async () => {
    const followups = require('../backend/models/channels/channel-followups-repository');
    await inTenant(() => channels.push({ channel: 'weixin', text: '📣 今日小技巧：一键报表', targets: [{ kind: 'user', id: 'alice@im.wechat' }], source: 'ops:每日小技巧 @admin' }));
    const page = await inTenant(() => followups.listThreadMessages('weixin', 'user', 'alice@im.wechat'));
    const pushed = page.items.find(item => item.content === '📣 今日小技巧：一键报表');
    assert.ok(pushed, '推送出现在时间线');
    assert.equal(pushed.role, 'model');
    assert.match(pushed.push.source, /^ops:每日小技巧/);
    aiCalls.length = 0;
    fake.batches.push([textMessage('alice@im.wechat', '这个技巧在哪里打开？')]);
    await waitFor(() => aiCalls.length >= 1);
    assert.equal(aiCalls[0].body.sessionId, pushed.sessionId, '回复接着推送所在的对话');
});

test('token 失效（-14）时状态显示失败原因，断开后恢复 idle', async () => {
    await service.disconnect('default');
    fake.stale = true;
    await service.connect('default');
    await waitFor(async () => (await service.getStatus('default')).runtime.state === 'failed');
    assert.match((await service.getStatus('default')).runtime.failureReason, /OpenClaw/);
    await service.disconnect('default');
    fake.stale = false;
    assert.equal((await service.getStatus('default')).runtime.state, 'idle');
});
