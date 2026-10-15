const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'welink-channel-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

// 替换 Dragon Claw 对话入口，避免测试依赖真实模型
const aiRoutePath = require.resolve('../backend/routes/ai');
const aiCalls = [];
require.cache[aiRoutePath] = {
    id: aiRoutePath, filename: aiRoutePath, loaded: true,
    exports: {
        handleChatRequest: async (req, res) => {
            aiCalls.push({ user: req.user, body: req.body });
            res.status(200);
            res.setHeader('Content-Type', 'application/x-ndjson');
            res.flushHeaders();
            res.write(`${JSON.stringify({ type: 'start', sessionId: 'ai-session-1' })}\n`);
            res.write(`${JSON.stringify({ type: 'delta', delta: '你好，' })}\n${JSON.stringify({ type: 'delta', delta: '我是 Dragon Claw' })}\n`);
            res.write(`${JSON.stringify({ type: 'done', reply: '你好，我是 Dragon Claw', tokens: 12, cost: 0.1, usage: { inputTokens: 8, outputTokens: 4 } })}\n`);
            res.end();
        }
    }
};

const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const sdkLoader = require('../backend/models/channels/welink-sdk-loader');
const configRepo = require('../backend/models/channels/welink-config-repository');
const targetsRepo = require('../backend/models/channels/channel-targets-repository');
const access = require('../backend/models/channels/welink-access');
const service = require('../backend/models/channels/welink-bridge-service');
const channels = require('../backend/models/channels');
const { FactQueue } = require('../backend/models/channels/welink-provider');

function createFakeSdk() {
    const sdk = {
        runtimes: [],
        outbound: [],
        qrSnapshots: [
            { type: 'qrcode_generated', qrcode: 'qr-1', display: { qrcode: 'qr-1', weUrl: 'https://welink.example/qr-1', pcUrl: 'welink://qr-1' }, expiresAt: '2030-01-01T00:00:00Z' },
            { type: 'scanned', qrcode: 'qr-1' },
            { type: 'confirmed', qrcode: 'qr-1', credentials: { ak: 'ak-from-qr', sk: 'sk-from-qr-secret-value' }, assistantInfo: { name: '平台助理', nameEn: 'Bot', desc: 'd', descEn: 'd' } }
        ],
        async createBridgeRuntime(options) {
            let state = 'idle';
            const runtime = {
                options,
                async start() {
                    if (options.gatewayHost.auth.ak === 'bad-ak') {
                        state = 'failed';
                        const error = new Error(`auth rejected for ${options.gatewayHost.auth.sk}`);
                        error.code = 'gateway_auth_rejected';
                        throw error;
                    }
                    await options.provider.initialize({
                        outbound: {
                            emitOutboundRun: async input => {
                                const facts = [];
                                for await (const fact of input.facts) facts.push(fact);
                                sdk.outbound.push({ ...input, facts });
                                return { applied: true };
                            }
                        }
                    });
                    state = 'ready';
                },
                async stop() { state = 'idle'; },
                getStatus: () => ({ state, failureReason: null }),
                getDiagnostics: () => ({ gatewayState: state, lastReadyAt: Date.now(), lastInboundAt: null, lastOutboundAt: null, lastHeartbeatAt: null, providerCalls: [], facts: [], uplinks: [], terminals: [], interactions: [], derivedEvents: [], failures: [], note: options.gatewayHost.auth.sk })
            };
            sdk.runtimes.push(runtime);
            return runtime;
        },
        qrcodeAuth: {
            async run(input) {
                sdk.qrInput = input;
                sdk.qrSnapshots.forEach(snapshot => input.onSnapshot(snapshot));
            }
        }
    };
    return sdk;
}

async function collect(run) {
    const facts = [];
    for await (const fact of run.facts) facts.push(fact);
    return { facts, result: await run.result() };
}

function groupInput(extra = {}) {
    return {
        extParameters: { platformExtParam: { businessSessionDomain: 'im', businessSessionType: 'group', businessSessionId: 'group-001' } },
        ...extra
    };
}

test.after(async () => {
    await service.stopAll();
    sdkLoader.setOverride(null);
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('SDK 未安装时提示通过 welink-cli 获取', async () => {
    sdkLoader.setOverride(null);
    sdkLoader.setBuiltinDir(path.join(sandbox, 'no-builtin'));
    const info = await sdkLoader.detect({ sdkPath: path.join(sandbox, 'missing-sdk') });
    assert.equal(info.available, false);
    assert.equal(info.customPathInvalid, true);
    assert.match(info.hint, /welink-cli/);
    await assert.rejects(sdkLoader.load({ sdkPath: path.join(sandbox, 'missing-sdk') }), error => error.code === 'WELINK_SDK_MISSING');
});

test('自定义 SDK 路径可识别 ESM 包入口并加载', async () => {
    const pkgDir = path.join(sandbox, 'sdk-home', 'node_modules', '@wecode', 'bridge-runtime-sdk');
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@wecode/bridge-runtime-sdk', version: '1.0.7', type: 'module', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }));
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.js'), 'export async function createBridgeRuntime() { return {}; }\nexport const qrcodeAuth = { run: async () => {} };\n');
    const info = await sdkLoader.detect({ sdkPath: path.join(sandbox, 'sdk-home') });
    assert.equal(info.available, true);
    assert.equal(info.version, '1.0.7');
    assert.equal(info.source, 'custom');
    const sdk = await sdkLoader.load({ sdkPath: pkgDir });
    assert.equal(typeof sdk.createBridgeRuntime, 'function');
});

test('平台内置 SDK 优先于全局安装被识别', async () => {
    const builtinDir = path.join(sandbox, 'vendor', '@wecode', 'bridge-runtime-sdk');
    fs.mkdirSync(path.join(builtinDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(builtinDir, 'package.json'), JSON.stringify({ name: '@wecode/bridge-runtime-sdk', version: '1.0.7', type: 'module', main: './dist/index.js' }));
    fs.writeFileSync(path.join(builtinDir, 'dist', 'index.js'), 'export async function createBridgeRuntime() { return { builtin: true }; }\n');
    sdkLoader.setBuiltinDir(builtinDir);
    sdkLoader.reset();
    try {
        const info = await sdkLoader.detect();
        assert.equal(info.source, 'builtin');
        assert.equal(info.version, '1.0.7');
        assert.deepEqual(await (await sdkLoader.load()).createBridgeRuntime(), { builtin: true });
        assert.equal((await sdkLoader.detect({ sdkPath: path.join(sandbox, 'sdk-home') })).source, 'custom', '显式配置的路径优先');
    } finally {
        sdkLoader.setBuiltinDir(path.join(sandbox, 'no-builtin'));
        sdkLoader.reset();
    }
});

test('页面导入 SDK：校验后替换、重新导入立即生效、可移除，且优先于内置', async () => {
    sdkLoader.setOverride(null);
    const builtinDir = path.join(sandbox, 'vendor2', '@wecode', 'bridge-runtime-sdk');
    fs.mkdirSync(path.join(builtinDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(builtinDir, 'package.json'), JSON.stringify({ name: '@wecode/bridge-runtime-sdk', version: '1.0.0', type: 'module', main: './dist/index.js' }));
    fs.writeFileSync(path.join(builtinDir, 'dist', 'index.js'), 'export async function createBridgeRuntime() { return "builtin"; }\n');
    sdkLoader.setBuiltinDir(builtinDir);
    sdkLoader.reset();
    const pkg = JSON.stringify({ name: '@wecode/bridge-runtime-sdk', version: '1.0.7', type: 'module' });
    try {
        const first = await sdkLoader.importSdk({ entry: 'export async function createBridgeRuntime() { return "v1"; }\nexport const qrcodeAuth = { run: async () => {} };\n', types: 'export {};', packageJson: pkg, fileName: 'bridge-runtime-sdk/dist/index.js' });
        assert.equal(first.source, 'imported');
        assert.equal(first.version, '1.0.7');
        assert.deepEqual(first.capabilities, { createBridgeRuntime: true, qrcodeAuth: true, packageVersion: null });
        assert.ok(first.importedAt);
        assert.ok(first.packageDir.startsWith(process.env.TOOLS_DATA_DIR), '存放在本机数据目录');
        assert.equal(await (await sdkLoader.load()).createBridgeRuntime(), 'v1');

        await assert.rejects(sdkLoader.importSdk({ entry: 'export const x = 1;', packageJson: pkg }), error => error.code === 'WELINK_SDK_IMPORT_INVALID' && /createBridgeRuntime/.test(error.message));
        await assert.rejects(sdkLoader.importSdk({ entry: 'export const x = 1;', packageJson: JSON.stringify({ name: 'other' }) }), error => error.code === 'WELINK_SDK_IMPORT_MISMATCH');
        await assert.rejects(sdkLoader.importSdk({ entry: 'var a=1;\n<truncated 286437 bytes>\n' }), error => error.code === 'WELINK_SDK_IMPORT_TRUNCATED');
        await assert.rejects(sdkLoader.importSdk({ entry: 'export async function createBridgeRuntime( {' }), error => error.code === 'WELINK_SDK_IMPORT_INVALID');
        assert.equal(await (await sdkLoader.load()).createBridgeRuntime(), 'v1', '校验失败不影响已导入的版本');
        assert.deepEqual(fs.readdirSync(path.dirname(path.dirname(sdkLoader.IMPORTED_DIR))).filter(name => name.startsWith('.staging-')), [], '临时目录已清理');

        await new Promise(resolve => setTimeout(resolve, 20));
        const second = await sdkLoader.importSdk({ entry: 'export async function createBridgeRuntime() { return "v2"; }\nexport function resolvePackageVersion() { return "1.0.8"; }\n' });
        assert.equal(second.version, '1.0.8', '只有 index.js 时使用 SDK 自报版本');
        assert.equal(second.capabilities.qrcodeAuth, false);
        assert.equal(await (await sdkLoader.load()).createBridgeRuntime(), 'v2', '重新导入后无需重启平台即生效');

        assert.equal(sdkLoader.removeImportedSdk(), true);
        assert.equal((await sdkLoader.detect()).source, 'builtin');
        assert.equal(await (await sdkLoader.load()).createBridgeRuntime(), 'builtin');
    } finally {
        sdkLoader.removeImportedSdk();
        sdkLoader.setBuiltinDir(path.join(sandbox, 'no-builtin'));
        sdkLoader.reset();
    }
});

test('配置对外只返回 SK 掩码，回传掩码不会覆盖原值，且按租户隔离', async () => {
    await runWithTenant('default', async () => {
        const saved = await configRepo.saveConfig({ channel: 'GDEClaw', ak: 'ak-123', sk: 'super-secret-sk-value' });
        const pub = configRepo.toPublic(saved);
        assert.equal(pub.sk, undefined);
        assert.equal(pub.hasSk, true);
        assert.equal(pub.maskedSk, 'supe****alue');
        await configRepo.saveConfig({ sk: pub.maskedSk, toolVersion: '2.0.0' });
        assert.equal((await configRepo.getConfig()).sk, 'super-secret-sk-value');
        assert.deepEqual(await configRepo.getSecrets(), ['super-secret-sk-value']);
    });
    await runWithTenant('acme', async () => {
        assert.equal((await configRepo.getConfig()).ak, '');
    });
});

test('人员与群组黑白名单规则', () => {
    const rules = {
        users: { mode: 'blacklist', whitelist: [], blacklist: ['bad-user'] },
        groups: { mode: 'whitelist', whitelist: ['group-ok'], blacklist: [] }
    };
    assert.equal(access.checkInbound(rules, { kind: 'user', senderAccount: 'alice' }).allowed, true);
    assert.deepEqual(access.checkInbound(rules, { kind: 'user', senderAccount: 'bad-user' }), { allowed: false, scope: 'user', reason: 'blacklisted' });
    assert.deepEqual(access.checkInbound(rules, { kind: 'group', senderAccount: 'alice', groupId: 'group-x' }), { allowed: false, scope: 'group', reason: 'not_whitelisted' });
    assert.equal(access.checkInbound(rules, { kind: 'group', senderAccount: 'alice', groupId: 'group-ok' }).allowed, true);
    assert.equal(access.checkInbound(rules, { kind: 'group', senderAccount: 'bad-user', groupId: 'group-ok' }).allowed, false);
    assert.equal(access.checkTarget(rules, { kind: 'group', id: 'group-x' }).allowed, false);
    assert.equal(access.resolveConversation(groupInput({ context: { sendUserAccount: 'alice' } })).kind, 'group');
    assert.equal(access.resolveConversation({ context: { sendUserAccount: 'alice' } }).kind, 'user');
});

test('FactQueue 先写后读与结束', async () => {
    const queue = new FactQueue();
    queue.push(1);
    setTimeout(() => { queue.push(2); queue.end(); }, 5);
    const items = [];
    for await (const item of queue) items.push(item);
    assert.deepEqual(items, [1, 2]);
});

test('连接、规则回复、黑名单拒绝、目标记录与主动推送', async () => {
    const sdk = createFakeSdk();
    sdkLoader.setOverride(sdk);
    service.resetForTests();
    await runWithTenant('default', () => configRepo.saveConfig({ enabled: true, channel: 'GDEClaw', ak: 'ak-123', sk: 'super-secret-sk-value', replyEngine: 'rule',
        access: { users: { mode: 'blacklist', whitelist: [], blacklist: ['bad-user'] }, groups: { mode: 'all', whitelist: [], blacklist: [] } } }));
    const status = await service.connect('default');
    assert.equal(status.connected, true);
    const runtime = sdk.runtimes.at(-1);
    assert.equal(runtime.options.gatewayHost.register.channel, 'GDEClaw');
    const provider = runtime.options.provider;

    const single = await provider.createSession({ traceId: 't1', title: 'alice chat' });
    const reply = await collect(await provider.runMessage({ traceId: 't2', runId: 'r1', toolSessionId: single.toolSessionId, text: '你好', context: { sendUserAccount: 'alice' } }));
    assert.equal(reply.result.outcome, 'completed');
    assert.equal(reply.facts[0].type, 'message.start');
    assert.match(reply.facts.find(fact => fact.type === 'text.done').content, /alice/);
    assert.equal(reply.facts.at(-1).type, 'message.done');

    const whoami = await collect(await provider.runMessage({ traceId: 't3', runId: 'r2', toolSessionId: single.toolSessionId, text: '/whoami', context: { sendUserAccount: 'alice' } }));
    assert.match(whoami.facts.find(fact => fact.type === 'text.done').content, /单聊/);

    const groupSession = await provider.createSession(groupInput({ traceId: 't4', title: '运维群' }));
    await collect(await provider.runMessage(groupInput({ traceId: 't5', runId: 'r3', toolSessionId: groupSession.toolSessionId, text: 'hi', context: { sendUserAccount: 'bob' } })));

    const denied = await collect(await provider.runMessage({ traceId: 't6', runId: 'r4', toolSessionId: (await provider.createSession({ traceId: 't7' })).toolSessionId, text: 'hi', context: { sendUserAccount: 'bad-user' } }));
    assert.match(denied.facts.find(fact => fact.type === 'text.done').content, /暂无权限/);

    const targets = await runWithTenant('default', () => channels.listTargets({ channel: 'welink' }));
    const byKey = Object.fromEntries(targets.map(item => [`${item.kind}:${item.id}`, item]));
    assert.equal(byKey['user:alice'].canPush, true);
    assert.equal(byKey['group:group-001'].canPush, true);
    assert.equal(byKey['group:group-001'].name, '运维群');
    assert.equal(byKey['user:bob'].canPush, false, '只在群里发言的人员没有单聊会话');
    assert.equal(targets[0].id, 'bad-user', '按最近活跃由近及远排序');

    const pushed = await runWithTenant('default', () => channels.push({ text: '月报已发布', targets: [{ kind: 'user', id: 'alice' }, { kind: 'group', id: 'group-001' }, { kind: 'user', id: 'bob' }, { kind: 'user', id: 'bad-user' }] }));
    assert.equal(pushed.sent, 2);
    assert.equal(pushed.failed, 2);
    assert.match(pushed.results.find(item => item.id === 'bob').error, /单聊/);
    assert.match(pushed.results.find(item => item.id === 'bad-user').error, /黑名单/);
    assert.deepEqual(sdk.outbound.map(item => item.toolSessionId), [single.toolSessionId, groupSession.toolSessionId]);
    assert.equal(sdk.outbound[0].facts.find(fact => fact.type === 'text.done').content, '月报已发布');

    await runWithTenant('default', () => configRepo.saveConfig({ push: { defaultTargets: [{ kind: 'group', id: 'group-001' }] } }));
    const byDefault = await runWithTenant('default', () => channels.push({ text: '默认范围' }));
    assert.equal(byDefault.sent, 1);

    const messages = await runWithTenant('default', () => targetsRepo.listMessages('welink', { limit: 50 }));
    assert.ok(messages.some(item => item.status === 'denied' && item.sender === 'bad-user'));

    await provider.closeSession({ traceId: 't8', toolSessionId: single.toolSessionId });
    const afterClose = await runWithTenant('default', () => channels.push({ text: 'x', targets: [{ kind: 'user', id: 'alice' }] }));
    assert.equal(afterClose.sent, 0);
});

test('Dragon Claw 回复：流式 delta 映射为 text.delta，并绑定平台对话会话', async () => {
    const sdk = createFakeSdk();
    sdkLoader.setOverride(sdk);
    service.resetForTests();
    await runWithTenant('default', () => configRepo.saveConfig({ enabled: true, replyEngine: 'dragon-claw', modelId: 'aragon', access: { users: { mode: 'all' }, groups: { mode: 'all' } } }));
    await service.connect('default');
    const provider = sdk.runtimes.at(-1).options.provider;
    const session = await provider.createSession({ traceId: 'd1' });
    const { facts, result } = await collect(await provider.runMessage({ traceId: 'd2', runId: 'dr1', toolSessionId: session.toolSessionId, text: '介绍一下平台', context: { sendUserAccount: 'carol' } }));
    assert.equal(result.outcome, 'completed');
    assert.deepEqual(facts.filter(fact => fact.type === 'text.delta').map(fact => fact.content), ['你好，', '我是 Dragon Claw']);
    assert.equal(facts.find(fact => fact.type === 'text.done').content, '你好，我是 Dragon Claw');
    const call = aiCalls.at(-1);
    assert.equal(call.user.username, 'welink:carol');
    assert.equal(call.user.role, 'user');
    assert.equal(call.body.modelId, 'aragon');
    assert.equal(call.body.workspace, undefined, '频道对话不开启工作区');
    const stored = await runWithTenant('default', () => targetsRepo.getSession('welink', session.toolSessionId));
    assert.equal(stored.aiSessionId, 'ai-session-1');
    await collect(await provider.runMessage({ traceId: 'd3', runId: 'dr2', toolSessionId: session.toolSessionId, text: '继续', context: { sendUserAccount: 'carol' } }));
    assert.equal(aiCalls.at(-1).body.sessionId, 'ai-session-1');
});

test('连接失败时错误信息不泄露 SK；诊断与日志同样脱敏', async () => {
    const sdk = createFakeSdk();
    sdkLoader.setOverride(sdk);
    service.resetForTests();
    await runWithTenant('default', () => configRepo.saveConfig({ ak: 'bad-ak', sk: 'leaky-secret-value' }));
    await assert.rejects(service.connect('default'), error => !error.message.includes('leaky-secret-value') && /\*\*\*\*/.test(error.message));
    const diagnostics = await service.getDiagnostics('default');
    assert.ok(!JSON.stringify(diagnostics).includes('leaky-secret-value'));
    assert.equal(diagnostics.status.connected, false);
});

test('连通性测试：未启用时临时连接并恢复断开', async () => {
    const sdk = createFakeSdk();
    sdkLoader.setOverride(sdk);
    service.resetForTests();
    await runWithTenant('default', () => configRepo.saveConfig({ enabled: false, ak: 'ak-123', sk: 'super-secret-sk-value', channel: 'GDEClaw' }));
    const result = await service.testConnection('default');
    assert.equal(result.ok, true, JSON.stringify(result.steps));
    assert.deepEqual(result.steps.map(step => step.key), ['sdk', 'sdk-load', 'config', 'gateway', 'provider', 'cleanup']);
    assert.equal((await service.getStatus('default')).connected, false);
});

test('扫码授权：快照不含凭据，确认后保存 AK/SK 与助理信息', async () => {
    const sdk = createFakeSdk();
    sdkLoader.setOverride(sdk);
    service.resetForTests();
    await runWithTenant('acme', () => configRepo.saveConfig({ channel: 'AcmeClaw', environment: 'uat' }));
    const snapshots = [];
    const result = await service.runQrAuth('acme', {}, snapshot => snapshots.push(snapshot));
    assert.equal(result.saved, true);
    assert.equal(sdk.qrInput.channel, 'AcmeClaw');
    assert.equal(sdk.qrInput.environment, 'uat');
    assert.match(sdk.qrInput.mac, /^[0-9a-f:]+$/i);
    assert.deepEqual(snapshots.map(item => item.type), ['qrcode_generated', 'scanned', 'confirmed']);
    assert.ok(!JSON.stringify(snapshots).includes('sk-from-qr-secret-value'));
    const config = await runWithTenant('acme', () => configRepo.getConfig());
    assert.equal(config.ak, 'ak-from-qr');
    assert.equal(config.sk, 'sk-from-qr-secret-value');
    assert.equal(config.assistantInfo.name, '平台助理');
    assert.notEqual((await runWithTenant('default', () => configRepo.getConfig())).ak, 'ak-from-qr', '其他租户不受影响');
});

test('推送 API：普通用户仅在开放后可推送到默认范围', async () => {
    const sdk = createFakeSdk();
    sdkLoader.setOverride(sdk);
    service.resetForTests();
    await runWithTenant('default', () => configRepo.saveConfig({ enabled: true, ak: 'ak-123', sk: 'super-secret-sk-value', channel: 'GDEClaw', replyEngine: 'rule',
        push: { defaultTargets: [{ kind: 'group', id: 'group-001' }], allowUserPush: false } }));
    await service.connect('default');
    const provider = sdk.runtimes.at(-1).options.provider;
    const groupSession = await provider.createSession(groupInput({ traceId: 'p1' }));
    await collect(await provider.runMessage(groupInput({ traceId: 'p2', runId: 'pr1', toolSessionId: groupSession.toolSessionId, text: 'hi', context: { sendUserAccount: 'dave' } })));

    const express = require('../backend/node_modules/express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { username: req.get('x-user'), role: req.get('x-role') };
        runWithTenant('default', next);
    });
    app.use('/api/channels', require('../backend/routes/channels'));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/channels/welink`;
    const call = (role, method, url, body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', 'x-user': role, 'x-role': role }, body: body ? JSON.stringify(body) : undefined });
    try {
        assert.equal((await call('user', 'POST', '/push', { text: 'hi' })).status, 403);
        assert.equal((await call('user', 'GET', '/config')).status, 403);
        const adminConfig = await (await call('admin', 'GET', '/config')).json();
        assert.equal(adminConfig.sk, undefined);
        assert.equal(adminConfig.hasSk, true);
        await runWithTenant('default', () => configRepo.saveConfig({ push: { defaultTargets: [{ kind: 'group', id: 'group-001' }], allowUserPush: true } }));
        assert.equal((await call('user', 'POST', '/push', { text: 'hi', targets: [{ kind: 'user', id: 'dave' }] })).status, 403);
        const ok = await (await call('user', 'POST', '/push', { text: '默认范围推送' })).json();
        assert.equal(ok.sent, 1);
        const visible = await (await call('user', 'GET', '/targets')).json();
        assert.deepEqual(visible.items.map(item => `${item.kind}:${item.id}`), ['group:group-001']);
        const all = await (await call('admin', 'GET', '/targets?kind=user')).json();
        assert.ok(all.items.some(item => item.id === 'dave'));
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
