// WeLink 桥接服务：按租户管理 Bridge Runtime 的连接生命周期、连通性测试、扫码授权与主动推送。
// 配置与 AI 配置一样按租户隔离，每个启用的租户各自维护一条网关连接。
const os = require('os');
const { runWithTenant, getTenantId } = require('../tenant-context');
const sdkLoader = require('./welink-sdk-loader');
const configRepo = require('./welink-config-repository');
const targetsRepo = require('./channel-targets-repository');
const access = require('./welink-access');
const { WeLinkProvider, CHANNEL } = require('./welink-provider');

const LOG_KEEP = 200;
const MAX_PUSH_TARGETS = 200;
const MAX_PUSH_CHARS = 8000;
const instances = new Map();

function serviceError(code, message, statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function redactWith(secrets) {
    return value => {
        let text = String(value ?? '');
        secrets.filter(Boolean).forEach(secret => { text = text.split(secret).join('****'); });
        return text;
    };
}

function safeMeta(meta, redact) {
    if (!meta || typeof meta !== 'object') return undefined;
    try {
        return JSON.parse(redact(JSON.stringify(meta, (key, value) => (/^(sk|ak|secret|token|password|authorization|credentials)$/i.test(key) ? '****' : value))).slice(0, 2000));
    } catch {
        return undefined;
    }
}

/** SDK 版本签名：导入/替换 SDK 后与当前连接使用的版本不同即提示重启。 */
function sdkSignature(info) {
    return info && info.available ? `${info.entry}|${info.version}|${info.importedAt || ''}` : '';
}

function getInstance(tenantId) {
    if (!instances.has(tenantId)) {
        instances.set(tenantId, { tenantId, runtime: null, provider: null, fingerprint: '', startedAt: null, lastError: null, logs: [], busy: null });
    }
    return instances.get(tenantId);
}

function appendLog(instance, entry, redact = value => value) {
    instance.logs.push({ at: new Date().toISOString(), level: entry.level || 'info', message: redact(entry.message || '').slice(0, 500), ...(entry.meta ? { meta: entry.meta } : {}) });
    if (instance.logs.length > LOG_KEEP) instance.logs.splice(0, instance.logs.length - LOG_KEEP);
}

function createLogger(instance, redact) {
    const write = level => (message, meta) => appendLog(instance, { level, message, meta: safeMeta(meta, redact) }, redact);
    const logger = { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
    logger.child = () => logger;
    return logger;
}

/** 用于扫码授权的本机 MAC：取第一块非内部、非全零的网卡。 */
function localMac() {
    const interfaces = os.networkInterfaces();
    for (const list of Object.values(interfaces)) {
        for (const item of list || []) {
            if (!item.internal && item.mac && item.mac !== '00:00:00:00:00:00') return item.mac;
        }
    }
    return '00:00:00:00:00:00';
}

function runtimeState(instance) {
    if (!instance.runtime) return { state: 'idle', failureReason: instance.lastError ? instance.lastError.message : null };
    try {
        const status = instance.runtime.getStatus();
        return { state: status.state, failureReason: status.failureReason || (status.error ? status.error.message : null), errorCode: status.error?.code || null };
    } catch (error) {
        return { state: 'failed', failureReason: error.message };
    }
}

function validateConnectionConfig(config) {
    const missing = [];
    if (!config.channel) missing.push('Channel');
    if (!config.ak) missing.push('AK');
    if (!config.sk) missing.push('SK');
    if (missing.length) throw serviceError('WELINK_CONFIG_INCOMPLETE', `缺少连接配置：${missing.join('、')}。可扫码授权自动获取 AK/SK。`);
}

async function withLock(instance, task) {
    while (instance.busy) await instance.busy.catch(() => {});
    const pending = task();
    instance.busy = pending;
    try {
        return await pending;
    } finally {
        if (instance.busy === pending) instance.busy = null;
    }
}

async function stopInstance(instance, reason = 'stop') {
    const { runtime, provider } = instance;
    instance.runtime = null;
    instance.provider = null;
    instance.fingerprint = '';
    instance.startedAt = null;
    if (runtime) {
        try {
            await runtime.stop();
        } catch (error) {
            appendLog(instance, { level: 'warn', message: `停止连接时出错：${error.message}` });
        }
    }
    if (provider) await provider.dispose().catch(() => {});
    if (runtime) appendLog(instance, { level: 'info', message: `连接已关闭（${reason}）` });
}

async function startInstance(instance, config) {
    validateConnectionConfig(config);
    const sdk = await sdkLoader.load({ sdkPath: config.sdkPath });
    const redact = redactWith([config.sk, config.ak]);
    const provider = new WeLinkProvider({
        tenantId: instance.tenantId,
        getRuntimeStatus: () => runtimeState(instance),
        log: entry => appendLog(instance, { level: entry.level, message: entry.message }, redact)
    });
    const runtime = await sdk.createBridgeRuntime({
        provider,
        gatewayHost: {
            ...(config.gatewayUrl ? { url: config.gatewayUrl } : {}),
            auth: { ak: config.ak, sk: config.sk },
            register: { channel: config.channel, toolVersion: config.toolVersion, pluginVersion: process.env.npm_package_version || undefined }
        },
        requestRunPolicy: { activeRunChatPolicy: 'reject' },
        logger: createLogger(instance, redact)
    });
    instance.runtime = runtime;
    instance.provider = provider;
    try {
        await runtime.start();
        const status = runtimeState(instance);
        if (status.state === 'failed') {
            throw serviceError(status.errorCode || 'WELINK_START_FAILED', status.failureReason || '网关连接失败');
        }
    } catch (error) {
        instance.lastError = { code: error.code || 'WELINK_START_FAILED', message: redact(error.message), at: new Date().toISOString() };
        appendLog(instance, { level: 'error', message: `连接失败：${error.code ? `[${error.code}] ` : ''}${error.message}` }, redact);
        await stopInstance(instance, 'start-failed');
        throw serviceError(error.code || 'WELINK_START_FAILED', `连接 WeLink 网关失败：${redact(error.message)}`, 502);
    }
    instance.fingerprint = configRepo.connectionFingerprint(config);
    instance.sdkSignature = sdkSignature(await sdkLoader.detect({ sdkPath: config.sdkPath }));
    instance.startedAt = new Date().toISOString();
    instance.lastError = null;
    appendLog(instance, { level: 'info', message: `已连接 WeLink 网关（channel=${config.channel}，环境=${config.environment}）` });
}

/** 连接（已连接且配置未变化时直接返回）。 */
async function connect(tenantId = getTenantId()) {
    const instance = getInstance(tenantId);
    return withLock(instance, () => runWithTenant(tenantId, async () => {
        const config = await configRepo.getConfig();
        if (instance.runtime && instance.fingerprint === configRepo.connectionFingerprint(config) && runtimeState(instance).state !== 'failed') return getStatus(tenantId);
        if (instance.runtime) await stopInstance(instance, 'reconnect');
        await startInstance(instance, config);
        return getStatus(tenantId);
    }));
}

async function disconnect(tenantId = getTenantId()) {
    const instance = getInstance(tenantId);
    return withLock(instance, async () => {
        await stopInstance(instance, 'manual');
        return getStatus(tenantId);
    });
}

async function restart(tenantId = getTenantId()) {
    const instance = getInstance(tenantId);
    return withLock(instance, () => runWithTenant(tenantId, async () => {
        await stopInstance(instance, 'restart');
        await startInstance(instance, await configRepo.getConfig());
        return getStatus(tenantId);
    }));
}

/** 配置保存后调用：启用则按需（重）连，停用则断开。连接失败不抛出，状态里可见。 */
async function applyConfig(tenantId = getTenantId()) {
    const config = await runWithTenant(tenantId, () => configRepo.getConfig());
    const instance = getInstance(tenantId);
    if (!config.enabled) {
        if (instance.runtime) await disconnect(tenantId);
        return getStatus(tenantId);
    }
    try {
        await connect(tenantId);
    } catch (error) {
        instance.lastError = { code: error.code || 'WELINK_START_FAILED', message: error.message, at: new Date().toISOString() };
    }
    return getStatus(tenantId);
}

async function getStatus(tenantId = getTenantId()) {
    return runWithTenant(tenantId, async () => {
        const config = await configRepo.getConfig();
        const instance = getInstance(tenantId);
        const sdk = await sdkLoader.detect({ sdkPath: config.sdkPath });
        const runtime = runtimeState(instance);
        const staleReason = !instance.runtime ? null
            : (instance.fingerprint !== configRepo.connectionFingerprint(config) ? 'config'
                : (instance.sdkSignature && instance.sdkSignature !== sdkSignature(sdk) ? 'sdk' : null));
        let summary = null;
        try { summary = await targetsRepo.countSummary(CHANNEL); } catch { summary = null; }
        return {
            channel: CHANNEL,
            tenantId,
            enabled: config.enabled,
            configured: Boolean(config.channel && config.ak && config.sk),
            sdk,
            runtime,
            connected: runtime.state === 'ready',
            startedAt: instance.startedAt,
            lastError: instance.lastError,
            stale: Boolean(staleReason),
            staleReason,
            provider: instance.provider ? { ...instance.provider.stats, activeRuns: instance.provider.activeRuns.size } : null,
            summary,
            assistantInfo: config.assistantInfo
        };
    });
}

async function getDiagnostics(tenantId = getTenantId()) {
    const instance = getInstance(tenantId);
    let runtimeDiagnostics = null;
    if (instance.runtime) {
        try { runtimeDiagnostics = instance.runtime.getDiagnostics(); } catch (error) { runtimeDiagnostics = { error: error.message }; }
    }
    const config = await runWithTenant(tenantId, () => configRepo.getConfig());
    const redact = redactWith([config.sk, config.ak]);
    return {
        status: await getStatus(tenantId),
        runtime: runtimeDiagnostics ? JSON.parse(redact(JSON.stringify(runtimeDiagnostics))) : null,
        logs: instance.logs.slice(-LOG_KEEP).reverse()
    };
}

/**
 * 连通性测试：逐项检查 SDK、配置、网关握手和 Provider 健康。
 * 当前未连接时临时建立连接，测试结束后恢复原状态（未启用则断开）。
 */
async function testConnection(tenantId = getTenantId()) {
    const steps = [];
    const push = (key, label, ok, detail) => steps.push({ key, label, ok, detail: detail || '' });
    const config = await runWithTenant(tenantId, () => configRepo.getConfig());
    const instance = getInstance(tenantId);
    const sdk = await sdkLoader.detect({ sdkPath: config.sdkPath });
    push('sdk', 'SDK 安装', sdk.available, sdk.available ? `${sdk.packageName}@${sdk.version}（${sdk.source}）` : sdk.hint);
    if (!sdk.available) return { ok: false, steps };
    try {
        await sdkLoader.load({ sdkPath: config.sdkPath });
        push('sdk-load', 'SDK 加载', true, 'createBridgeRuntime 可用');
    } catch (error) {
        push('sdk-load', 'SDK 加载', false, error.message);
        return { ok: false, steps };
    }
    try {
        validateConnectionConfig(config);
        push('config', '连接配置', true, `channel=${config.channel}，环境=${config.environment}${config.gatewayUrl ? `，网关=${config.gatewayUrl}` : ''}`);
    } catch (error) {
        push('config', '连接配置', false, error.message);
        return { ok: false, steps };
    }
    const wasConnected = Boolean(instance.runtime) && runtimeState(instance).state === 'ready';
    const started = Date.now();
    try {
        await connect(tenantId);
        const status = runtimeState(instance);
        if (status.state !== 'ready') {
            const redact = redactWith([config.ak, config.sk]);
            throw serviceError('WELINK_NOT_READY', redact(status.failureReason || `网关尚未就绪（${status.state}）`));
        }
        push('gateway', '网关握手', true, `${status.state}，耗时 ${Date.now() - started}ms`);
    } catch (error) {
        push('gateway', '网关握手', false, error.message);
        if (!config.enabled && !wasConnected) await disconnect(tenantId);
        return { ok: false, steps };
    }
    try {
        const health = await instance.provider.health({ traceId: `test-${Date.now()}` });
        push('provider', 'Provider 健康', health.online === true, health.online ? 'online' : 'offline');
    } catch (error) {
        push('provider', 'Provider 健康', false, error.message);
    }
    if (!config.enabled && !wasConnected) {
        await disconnect(tenantId);
        push('cleanup', '恢复状态', true, '频道未启用，测试连接已断开');
    }
    return { ok: steps.every(step => step.ok), steps };
}

/**
 * 扫码授权：生成二维码 → 用户 WeLink 扫码确认 → 自动保存 AK/SK 与助理信息。
 * onSnapshot 收到的快照已去除凭据。
 */
async function runQrAuth(tenantId, { environment, channel } = {}, onSnapshot = () => {}) {
    const config = await runWithTenant(tenantId, () => configRepo.getConfig());
    const sdk = await sdkLoader.load({ sdkPath: config.sdkPath });
    if (!sdk.qrcodeAuth || typeof sdk.qrcodeAuth.run !== 'function') throw serviceError('WELINK_SDK_INCOMPATIBLE', '当前 SDK 不支持扫码授权，请通过 welink-cli 升级');
    const finalChannel = String(channel || config.channel || '').trim();
    if (!finalChannel) throw serviceError('WELINK_CONFIG_INCOMPLETE', '扫码授权前请先填写 Channel');
    const finalEnvironment = environment === 'uat' ? 'uat' : (environment === 'prod' ? 'prod' : config.environment);
    let saved = false;
    await sdk.qrcodeAuth.run({
        environment: finalEnvironment,
        channel: finalChannel,
        mac: localMac(),
        policy: { refreshOnExpired: true, maxRefreshCount: 3 },
        onSnapshot: snapshot => {
            if (snapshot?.type === 'confirmed') {
                const credentials = snapshot.credentials || {};
                saved = runWithTenant(tenantId, () => configRepo.saveConfig({
                    ak: credentials.ak,
                    sk: credentials.sk,
                    channel: finalChannel,
                    environment: finalEnvironment,
                    assistantInfo: snapshot.assistantInfo || null
                })).then(() => true);
                onSnapshot({ type: 'confirmed', qrcode: snapshot.qrcode, assistantInfo: snapshot.assistantInfo || null });
                return;
            }
            onSnapshot(snapshot);
        }
    });
    if (saved) {
        await saved;
        appendLog(getInstance(tenantId), { level: 'info', message: '扫码授权成功，已保存 AK/SK' });
        return { saved: true, status: await applyConfig(tenantId) };
    }
    return { saved: false };
}

function normalizePushTargets(targets) {
    return configRepo.normalizeTargets(targets).slice(0, MAX_PUSH_TARGETS);
}

/**
 * 主动推送：平台公共能力。
 * @param {string} tenantId
 * @param {object} options
 * @param {string} options.text Markdown 文本
 * @param {Array<{kind:'user'|'group', id:string}>} [options.targets] 不传则使用配置的默认推送范围
 * @param {string} [options.trigger] scheduled | webhook | system
 * @param {string} [options.source] 调用方标识（页面/模块），写入日志
 * @returns {Promise<{ok:boolean, sent:number, failed:number, results:Array}>}
 */
async function push(tenantId = getTenantId(), { text, targets, trigger = 'system', source = '' } = {}) {
    const content = String(text || '').trim();
    if (!content) throw serviceError('WELINK_PUSH_EMPTY', '推送内容不能为空');
    if (content.length > MAX_PUSH_CHARS) throw serviceError('WELINK_PUSH_TOO_LONG', `推送内容不能超过 ${MAX_PUSH_CHARS} 字`);
    return runWithTenant(tenantId, async () => {
        const config = await configRepo.getConfig();
        const finalTargets = normalizePushTargets(Array.isArray(targets) && targets.length ? targets : config.push.defaultTargets);
        if (!finalTargets.length) throw serviceError('WELINK_PUSH_NO_TARGET', '没有推送目标：请传入 targets，或在「频道对接」配置默认推送范围');
        const instance = getInstance(tenantId);
        const outbound = instance.provider?.outbound;
        if (!instance.runtime || runtimeState(instance).state !== 'ready' || !outbound) {
            throw serviceError('WELINK_NOT_CONNECTED', 'WeLink 助理未连接，请在「全局设置 › 频道对接」启用并连接', 503);
        }
        const results = [];
        for (const target of finalTargets) {
            const verdict = access.checkTarget(config.access, target);
            const stored = await targetsRepo.getTarget(CHANNEL, target.kind, target.id);
            const base = { kind: target.kind, id: target.id, name: stored?.name || target.id };
            const refuse = async (status, error) => {
                results.push({ ...base, ok: false, error });
                await targetsRepo.logMessage(CHANNEL, { direction: 'out', kind: target.kind, targetId: target.id, text: content, status, trigger, source, error });
            };
            if (!verdict.allowed) {
                await refuse('denied', access.describeDenial(verdict));
                continue;
            }
            if (!stored?.toolSessionId) {
                await refuse('error', target.kind === 'group' ? '该群尚未使用过助理，暂无可推送的会话' : '该人员尚未与助理单聊，暂无可推送的会话');
                continue;
            }
            const messageId = `push_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            try {
                await outbound.emitOutboundRun({
                    toolSessionId: stored.toolSessionId,
                    runId: `${messageId}_run`,
                    trigger,
                    facts: (async function* facts() {
                        yield { type: 'message.start', messageId };
                        yield { type: 'text.done', messageId, partId: `${messageId}_text`, content };
                        yield { type: 'message.done', messageId };
                    })()
                });
                results.push({ ...base, ok: true });
                await targetsRepo.logMessage(CHANNEL, { direction: 'out', toolSessionId: stored.toolSessionId, kind: target.kind, targetId: target.id, text: content, status: 'ok', trigger, source });
            } catch (error) {
                results.push({ ...base, ok: false, error: error.message });
                await targetsRepo.logMessage(CHANNEL, { direction: 'out', toolSessionId: stored.toolSessionId, kind: target.kind, targetId: target.id, text: content, status: 'error', trigger, source, error: error.message });
            }
        }
        const sent = results.filter(item => item.ok).length;
        return { ok: sent === results.length, sent, failed: results.length - sent, results };
    });
}

/** 启动时自动连接：遍历默认租户与已注册租户，已启用的建立连接。 */
async function autoStartAll(listTenantIds) {
    const ids = new Set(['default']);
    try {
        (await listTenantIds()).forEach(id => id && ids.add(id));
    } catch (error) {
        console.warn('[WeLink] 读取租户列表失败，仅检查默认租户：', error.message);
    }
    for (const tenantId of ids) {
        try {
            const config = await runWithTenant(tenantId, () => configRepo.getConfig());
            if (!config.enabled) continue;
            await connect(tenantId);
            console.log(`[WeLink] 租户 ${tenantId} 已连接网关`);
        } catch (error) {
            getInstance(tenantId).lastError = { code: error.code || 'WELINK_START_FAILED', message: error.message, at: new Date().toISOString() };
            console.warn(`[WeLink] 租户 ${tenantId} 自动连接失败：${error.message}`);
        }
    }
}

async function stopAll() {
    await Promise.allSettled([...instances.values()].map(instance => stopInstance(instance, 'shutdown')));
}

/** 测试专用。 */
function resetForTests() {
    instances.clear();
}

module.exports = {
    connect,
    disconnect,
    restart,
    applyConfig,
    getStatus,
    getDiagnostics,
    testConnection,
    runQrAuth,
    push,
    autoStartAll,
    stopAll,
    resetForTests
};
