// 微信桥接服务：按租户维护一条 iLink 长轮询连接，收到的消息交给与 WeLink 相同的 Provider 处理
// （访问控制、斜杠命令、规则回复、Dragon Claw 回复、联系人与消息日志都复用），回复再经 iLink 发回微信。
// 凭据来源：平台扫码登录，或直接导入本机 OpenClaw 微信插件（~/.openclaw/openclaw-weixin）已登录的 bot。
// 同一个 bot token 同时只能有一个客户端长轮询，导入 OpenClaw 凭据后需暂停 OpenClaw 的微信插件。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { runWithTenant, getTenantId } = require('../tenant-context');
const ilink = require('./weixin-ilink-client');
const configRepo = require('./weixin-config-repository');
const targetsRepo = require('./channel-targets-repository');
const access = require('./welink-access');
const { WeLinkProvider } = require('./welink-provider');

const CHANNEL = 'weixin';
const LABEL = '微信';
const OWNER_NAME = '本人（Bot 绑定的微信）';
const LOG_KEEP = 200;
const MAX_PUSH_TARGETS = 200;
const MAX_PUSH_CHARS = 8000;
const TEXT_CHUNK = 3800;
const RETRY_DELAY_MS = 2000;
const BACKOFF_DELAY_MS = 30000;
const STALE_TOKEN_PAUSE_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const QR_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_QR_REFRESH = 3;
const instances = new Map();

function serviceError(code, message, statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function getInstance(tenantId) {
    if (!instances.has(tenantId)) {
        instances.set(tenantId, {
            tenantId, controller: null, loop: null, provider: null, config: null, fingerprint: '', state: null,
            runtime: 'idle', failureReason: null, startedAt: null, lastPollAt: null, lastError: null,
            logs: [], busy: null, chains: new Map(), qr: null
        });
    }
    return instances.get(tenantId);
}

function redactWith(secrets) {
    return value => {
        let text = String(value ?? '');
        secrets.filter(Boolean).forEach(secret => { text = text.split(secret).join('****'); });
        return text;
    };
}

function appendLog(instance, level, message) {
    const redact = redactWith([instance.config?.token]);
    instance.logs.push({ at: new Date().toISOString(), level, message: redact(message).slice(0, 500) });
    if (instance.logs.length > LOG_KEEP) instance.logs.splice(0, instance.logs.length - LOG_KEEP);
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

function sleep(ms, signal) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}

function setFailure(instance, code, message) {
    instance.runtime = 'failed';
    instance.failureReason = message;
    instance.lastError = { code, message, at: new Date().toISOString() };
}

// ── 消息转换 ─────────────────────────────────────────────

/** 入站消息转成纯文本：文字、语音转写、引用内容；媒体用占位说明。 */
function inboundText(message) {
    const parts = [];
    for (const item of message.item_list || []) {
        const ref = item.ref_msg;
        if (ref) {
            const quoted = ref.message_item?.text_item?.text || ref.title || '';
            if (quoted) parts.push(`> 引用：${String(quoted).slice(0, 300)}`);
        }
        if (item.type === ilink.MessageItemType.TEXT && item.text_item?.text) parts.push(item.text_item.text);
        else if (item.type === ilink.MessageItemType.VOICE) parts.push(item.voice_item?.text ? item.voice_item.text : '[语音消息，未识别出文字]');
        else if (item.type === ilink.MessageItemType.IMAGE) parts.push('[图片]');
        else if (item.type === ilink.MessageItemType.FILE) parts.push(`[文件${item.file_item?.file_name ? `：${item.file_item.file_name}` : ''}]`);
        else if (item.type === ilink.MessageItemType.VIDEO) parts.push('[视频]');
    }
    return parts.join('\n').trim();
}

/** 微信不支持平台内相对链接与图片：图片去掉，链接保留文字（外链附上地址）。 */
function toWeixinText(markdown) {
    return String(markdown || '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1（$2）')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^#{5,6}\s+/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function chunkText(text, size = TEXT_CHUNK) {
    if (text.length <= size) return [text];
    const chunks = [];
    let rest = text;
    while (rest.length > size) {
        let cut = rest.lastIndexOf('\n', size);
        if (cut < size * 0.5) cut = size;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n/, '');
    }
    if (rest) chunks.push(rest);
    return chunks;
}

function sessionIdFor(kind, id) {
    return `wx_${kind === 'group' ? 'g' : 'u'}_${crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 16)}`;
}

// ── 收发 ─────────────────────────────────────────────────

async function persistState(instance) {
    try {
        await runWithTenant(instance.tenantId, () => configRepo.saveState(instance.state));
    } catch (error) {
        appendLog(instance, 'warn', `保存同步游标失败：${error.message}`);
    }
}

/** iLink 发送失败的常见原因：ret=-2 多为会话已超出时效（对方近期没有给助理发消息）。 */
function describeSendError(error) {
    if (error?.ret === -2) return `微信拒绝发送（${error.message}）：该联系人近期没有给助理发消息，会话已超出时效；请对方先发一条消息后再推送`;
    return error?.message || String(error);
}

async function sendToUser(instance, userId, text) {
    const config = instance.config;
    const contextToken = instance.state?.contextTokens?.[userId] || '';
    const chunks = chunkText(toWeixinText(text) || '（无回复内容）');
    for (const chunk of chunks) {
        await ilink.sendText({ baseUrl: config.baseUrl, token: config.token, to: userId, text: chunk, contextToken, botAgent: config.botAgent });
    }
    return chunks.length;
}

/** 处理一条入站消息：交给 Provider，收集每条回复的最终文本后发送。 */
async function handleMessage(instance, message) {
    const from = String(message.from_user_id || '');
    const text = inboundText(message);
    if (!from || !text) return;
    const groupId = String(message.group_id || '');
    const config = instance.config;
    const ticket = (await ilink.getConfig({ baseUrl: config.baseUrl, token: config.token, userId: from, contextToken: message.context_token, botAgent: config.botAgent })).typing_ticket;
    const typing = status => ilink.sendTyping({ baseUrl: config.baseUrl, token: config.token, userId: from, typingTicket: ticket, status, botAgent: config.botAgent });
    await typing(ilink.TypingStatus.TYPING);
    const typingTimer = setInterval(() => typing(ilink.TypingStatus.TYPING), 5000);
    try {
        const provider = instance.provider;
        const run = await provider.runMessage({
            runId: `wxrun_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
            toolSessionId: groupId ? sessionIdFor('group', groupId) : sessionIdFor('user', from),
            text,
            context: { sendUserAccount: from },
            ...(groupId ? { extParameters: { platformExtParam: { businessSessionType: 'group', businessSessionId: groupId } } } : {})
        });
        const finals = new Map();
        for await (const fact of run.facts) {
            if (fact.type === 'text.done') finals.set(fact.messageId, fact.content);
            if (fact.type === 'message.done' && finals.has(fact.messageId)) {
                const content = finals.get(fact.messageId);
                finals.delete(fact.messageId);
                try {
                    await sendToUser(instance, from, content);
                } catch (error) {
                    appendLog(instance, 'error', `回复 ${from} 失败：${error.message}`);
                    await runWithTenant(instance.tenantId, () => targetsRepo.logMessage(CHANNEL, { direction: 'out', kind: 'user', targetId: from, text: content, status: 'error', trigger: 'reply', source: 'weixin-send', error: error.message }));
                }
            }
        }
        await run.result();
    } finally {
        clearInterval(typingTimer);
        typing(ilink.TypingStatus.CANCEL);
    }
}

/** 同一联系人的消息按顺序处理，不同联系人并行；不阻塞长轮询。 */
function enqueue(instance, message) {
    const key = String(message.group_id || message.from_user_id || '');
    const previous = instance.chains.get(key) || Promise.resolve();
    const next = previous
        .then(() => handleMessage(instance, message))
        .catch(error => appendLog(instance, 'error', `处理消息失败：${error.message}`))
        .finally(() => { if (instance.chains.get(key) === next) instance.chains.delete(key); });
    instance.chains.set(key, next);
}

async function pollLoop(instance, signal) {
    const config = instance.config;
    let timeoutMs = 35000;
    let failures = 0;
    while (!signal.aborted) {
        try {
            const resp = await ilink.getUpdates({ baseUrl: config.baseUrl, token: config.token, getUpdatesBuf: instance.state.getUpdatesBuf, timeoutMs, signal, botAgent: config.botAgent });
            if (signal.aborted) break;
            if (resp.longpolling_timeout_ms > 0) timeoutMs = resp.longpolling_timeout_ms;
            const apiError = (resp.ret !== undefined && resp.ret !== 0) || (resp.errcode !== undefined && resp.errcode !== 0);
            if (apiError) {
                if (resp.ret === ilink.STALE_TOKEN_ERRCODE || resp.errcode === ilink.STALE_TOKEN_ERRCODE) {
                    setFailure(instance, 'WEIXIN_TOKEN_STALE', 'bot token 已失效：可能被其他客户端（如 OpenClaw）占用或已在微信中解绑。请暂停 OpenClaw 微信插件，或重新扫码登录。5 分钟后自动重试。');
                    appendLog(instance, 'error', `getUpdates 返回 token 失效（errcode=${resp.errcode ?? resp.ret}）`);
                    failures = 0;
                    await sleep(STALE_TOKEN_PAUSE_MS, signal);
                    continue;
                }
                throw new Error(`getUpdates ret=${resp.ret} errcode=${resp.errcode} ${resp.errmsg || ''}`.trim());
            }
            failures = 0;
            instance.runtime = 'ready';
            instance.failureReason = null;
            instance.lastPollAt = new Date().toISOString();
            let dirty = false;
            if (resp.get_updates_buf && resp.get_updates_buf !== instance.state.getUpdatesBuf) {
                instance.state.getUpdatesBuf = resp.get_updates_buf;
                dirty = true;
            }
            for (const message of resp.msgs || []) {
                if (message.message_type === ilink.MessageType.BOT) continue;
                const from = String(message.from_user_id || '');
                if (from && message.context_token && instance.state.contextTokens[from] !== message.context_token) {
                    instance.state.contextTokens[from] = message.context_token;
                    dirty = true;
                }
                appendLog(instance, 'info', `收到消息：from=${from} types=${(message.item_list || []).map(item => item.type).join(',') || 'none'}`);
                enqueue(instance, message);
            }
            if (dirty) await persistState(instance);
        } catch (error) {
            if (signal.aborted) break;
            failures += 1;
            instance.runtime = 'reconnecting';
            instance.failureReason = error.message;
            appendLog(instance, 'warn', `长轮询出错（${failures}/${MAX_CONSECUTIVE_FAILURES}）：${error.message}`);
            if (failures >= MAX_CONSECUTIVE_FAILURES) {
                failures = 0;
                await sleep(BACKOFF_DELAY_MS, signal);
            } else {
                await sleep(RETRY_DELAY_MS, signal);
            }
        }
    }
}

// ── 生命周期 ─────────────────────────────────────────────

async function stopInstance(instance, reason = 'stop') {
    const { controller, loop, provider, config } = instance;
    instance.controller = null;
    instance.loop = null;
    instance.provider = null;
    instance.fingerprint = '';
    instance.startedAt = null;
    instance.runtime = 'idle';
    if (controller) {
        controller.abort();
        await loop?.catch(() => {});
        if (config?.token) await ilink.notifyStop({ baseUrl: config.baseUrl, token: config.token, botAgent: config.botAgent });
        appendLog(instance, 'info', `连接已关闭（${reason}）`);
    }
    if (provider) await provider.dispose().catch(() => {});
}

async function startInstance(instance, config) {
    if (!config.token) throw serviceError('WEIXIN_CONFIG_INCOMPLETE', '缺少 bot token：请扫码登录，或从本机 OpenClaw 导入微信凭据。');
    instance.config = config;
    instance.state = await configRepo.getState();
    instance.provider = new WeLinkProvider({
        tenantId: instance.tenantId,
        channel: CHANNEL,
        label: LABEL,
        configRepo,
        // iLink 不提供昵称：bot 绑定的微信（扫码人本人）给个可读的名字，其他人请在「联系人」里设备注
        accountIsReadable: false,
        defaultUserName: account => (account && account === instance.config?.ownerUserId ? OWNER_NAME : null),
        getRuntimeStatus: () => ({ state: instance.runtime }),
        log: entry => appendLog(instance, entry.level || 'info', entry.message || '')
    });
    instance.runtime = 'starting';
    instance.failureReason = null;
    const started = await ilink.notifyStart({ baseUrl: config.baseUrl, token: config.token, botAgent: config.botAgent });
    if (started.ret === ilink.STALE_TOKEN_ERRCODE || started.errcode === ilink.STALE_TOKEN_ERRCODE) {
        setFailure(instance, 'WEIXIN_TOKEN_STALE', 'bot token 已失效，请重新扫码登录或重新从 OpenClaw 导入。');
        instance.provider = null;
        throw serviceError('WEIXIN_TOKEN_STALE', instance.failureReason, 502);
    }
    const controller = new AbortController();
    instance.controller = controller;
    instance.fingerprint = configRepo.connectionFingerprint(config);
    instance.startedAt = new Date().toISOString();
    instance.lastError = null;
    instance.loop = pollLoop(instance, controller.signal).catch(error => setFailure(instance, 'WEIXIN_LOOP_FAILED', error.message));
    appendLog(instance, 'info', `已启动微信长轮询（bot=${config.botId || '未知'}）`);
}

async function connect(tenantId = getTenantId()) {
    const instance = getInstance(tenantId);
    return withLock(instance, () => runWithTenant(tenantId, async () => {
        const config = await configRepo.getConfig();
        if (instance.controller && instance.fingerprint === configRepo.connectionFingerprint(config)) {
            instance.config = config; // 行为类配置直接生效
            return getStatus(tenantId);
        }
        if (instance.controller) await stopInstance(instance, 'reconnect');
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

async function applyConfig(tenantId = getTenantId()) {
    const config = await runWithTenant(tenantId, () => configRepo.getConfig());
    const instance = getInstance(tenantId);
    if (!config.enabled) {
        if (instance.controller) await disconnect(tenantId);
        return getStatus(tenantId);
    }
    try {
        await connect(tenantId);
    } catch (error) {
        instance.lastError = { code: error.code || 'WEIXIN_START_FAILED', message: error.message, at: new Date().toISOString() };
    }
    return getStatus(tenantId);
}

// ── OpenClaw 凭据 ────────────────────────────────────────

function openclawDir() {
    return process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), '.openclaw');
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

/** 读取本机 OpenClaw 微信插件最近登录的账号（含 token，仅后端使用）。 */
function readOpenClawAccount() {
    const dir = path.join(openclawDir(), 'openclaw-weixin');
    const ids = readJson(path.join(dir, 'accounts.json'));
    if (!Array.isArray(ids) || !ids.length) return null;
    for (let i = ids.length - 1; i >= 0; i -= 1) {
        const id = String(ids[i]);
        const account = readJson(path.join(dir, 'accounts', `${id}.json`));
        if (!account?.token) continue;
        return {
            accountId: id,
            token: String(account.token),
            baseUrl: String(account.baseUrl || ilink.DEFAULT_BASE_URL),
            userId: String(account.userId || ''),
            savedAt: account.savedAt || null,
            getUpdatesBuf: String(readJson(path.join(dir, 'accounts', `${id}.sync.json`))?.get_updates_buf || ''),
            contextTokens: readJson(path.join(dir, 'accounts', `${id}.context-tokens.json`)) || {}
        };
    }
    return null;
}

function openclawPluginEnabled() {
    const config = readJson(path.join(openclawDir(), 'openclaw.json'));
    if (!config) return null;
    return config.plugins?.entries?.['openclaw-weixin']?.enabled !== false;
}

async function detectOpenClaw(config) {
    const account = readOpenClawAccount();
    return {
        available: Boolean(account),
        accountId: account?.accountId || '',
        userId: account?.userId || '',
        savedAt: account?.savedAt || null,
        sameToken: Boolean(account && config?.token && account.token === config.token),
        pluginEnabled: openclawPluginEnabled()
    };
}

/** 导入 OpenClaw 已登录的微信 bot：token、同步游标与各联系人 context_token 一并带过来。 */
async function importFromOpenClaw(tenantId = getTenantId()) {
    const account = readOpenClawAccount();
    if (!account) throw serviceError('OPENCLAW_WEIXIN_NOT_FOUND', `未在 ${path.join(openclawDir(), 'openclaw-weixin')} 找到已登录的微信账号`, 404);
    await runWithTenant(tenantId, async () => {
        await configRepo.saveConfig({ token: account.token, baseUrl: account.baseUrl, botId: account.accountId, ownerUserId: account.userId, source: 'openclaw' });
        await configRepo.saveState({ getUpdatesBuf: account.getUpdatesBuf, contextTokens: account.contextTokens });
    });
    appendLog(getInstance(tenantId), 'info', `已导入 OpenClaw 微信凭据（bot=${account.accountId}）`);
    return { imported: true, accountId: account.accountId, status: await applyConfig(tenantId) };
}

function openclawBin() {
    const candidates = [process.env.OPENCLAW_BIN, '/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw'].filter(Boolean);
    return candidates.find(file => fs.existsSync(file)) || 'openclaw';
}

function runOpenClaw(args) {
    return new Promise((resolve, reject) => {
        execFile(openclawBin(), args, { timeout: 90000, env: { ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` } }, (error, stdout, stderr) => {
            if (error) reject(new Error(`openclaw ${args.join(' ')} 失败：${String(stderr || error.message).trim().slice(0, 300)}`));
            else resolve(String(stdout || '').trim());
        });
    });
}

/** 暂停 / 恢复 OpenClaw 的微信插件（同一 bot 只能有一个客户端收消息），改完重启 OpenClaw 网关。 */
async function setOpenClawWeixin(enabled, tenantId = getTenantId()) {
    await runOpenClaw(['plugins', enabled ? 'enable' : 'disable', 'openclaw-weixin']);
    let restartNote = '';
    try {
        await runOpenClaw(['gateway', 'restart']);
    } catch (error) {
        restartNote = error.message;
    }
    appendLog(getInstance(tenantId), restartNote ? 'warn' : 'info', `OpenClaw 微信插件已${enabled ? '恢复' : '暂停'}${restartNote ? `；网关重启失败：${restartNote}` : '，网关已重启'}`);
    return { ok: true, enabled, restartNote, status: await getStatus(tenantId) };
}

// ── 扫码登录 ─────────────────────────────────────────────

/**
 * 平台扫码登录：生成二维码 → 手机微信扫码确认 → 保存 bot token。
 * 快照类型与 WeLink 扫码一致（qrcode_generated / scanned / expired / confirmed / failed），
 * 额外有 need_verifycode：手机上会显示数字，需在页面输入后通过 submitQrVerifyCode 提交。
 */
async function runQrAuth(tenantId, onSnapshot = () => {}) {
    const instance = getInstance(tenantId);
    if (instance.qr) instance.qr.cancel();
    const config = await runWithTenant(tenantId, () => configRepo.getConfig());
    const controller = new AbortController();
    const session = { verifyCode: '', waiter: null, cancel: () => controller.abort() };
    instance.qr = session;
    const deadline = Date.now() + QR_TIMEOUT_MS;
    let refreshCount = 1;
    let pollBase = ilink.DEFAULT_BASE_URL;
    let scanned = false;
    try {
        let qr = await ilink.fetchQrCode({ localTokens: [config.token] });
        onSnapshot({ type: 'qrcode_generated', qrcode: qr.qrcodeUrl, display: { qrcode: qr.qrcodeUrl, weUrl: qr.qrcodeUrl }, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
        while (Date.now() < deadline && !controller.signal.aborted) {
            const status = await ilink.pollQrStatus({ baseUrl: pollBase, qrcode: qr.qrcode, verifyCode: session.verifyCode || undefined, signal: controller.signal });
            switch (status.status) {
                case 'scaned':
                    session.verifyCode = '';
                    if (!scanned) onSnapshot({ type: 'scanned' });
                    scanned = true;
                    break;
                case 'scaned_but_redirect':
                    if (status.redirect_host) pollBase = `https://${status.redirect_host}`;
                    break;
                case 'need_verifycode': {
                    onSnapshot({ type: 'need_verifycode', retry: Boolean(session.verifyCode) });
                    session.verifyCode = await new Promise(resolve => {
                        session.waiter = resolve;
                        controller.signal.addEventListener('abort', () => resolve(''), { once: true });
                    });
                    session.waiter = null;
                    continue;
                }
                case 'expired':
                case 'verify_code_blocked': {
                    refreshCount += 1;
                    if (refreshCount > MAX_QR_REFRESH) {
                        onSnapshot({ type: 'failed', serviceError: { message: status.status === 'expired' ? '二维码多次过期，请重试' : '验证码多次输入错误，请稍后再试' } });
                        return { saved: false };
                    }
                    onSnapshot({ type: 'expired' });
                    qr = await ilink.fetchQrCode({ localTokens: [config.token] });
                    pollBase = ilink.DEFAULT_BASE_URL;
                    scanned = false;
                    session.verifyCode = '';
                    onSnapshot({ type: 'qrcode_generated', qrcode: qr.qrcodeUrl, display: { qrcode: qr.qrcodeUrl, weUrl: qr.qrcodeUrl }, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
                    break;
                }
                case 'binded_redirect':
                    onSnapshot({ type: 'failed', serviceError: { message: '该微信已绑定到当前保存的 bot，无需重复扫码；可直接测试连通性。' } });
                    return { saved: false, alreadyConnected: true };
                case 'confirmed': {
                    if (!status.ilink_bot_id || !status.bot_token) {
                        onSnapshot({ type: 'failed', serviceError: { message: '登录失败：服务器未返回 bot 信息' } });
                        return { saved: false };
                    }
                    await runWithTenant(tenantId, () => configRepo.saveConfig({
                        token: status.bot_token,
                        baseUrl: status.baseurl || ilink.DEFAULT_BASE_URL,
                        botId: status.ilink_bot_id,
                        ownerUserId: status.ilink_user_id || '',
                        source: 'qrcode'
                    }));
                    appendLog(instance, 'info', `扫码登录成功（bot=${status.ilink_bot_id}）`);
                    onSnapshot({ type: 'confirmed' });
                    return { saved: true, status: await applyConfig(tenantId) };
                }
                default:
                    break;
            }
            await sleep(1000, controller.signal);
        }
        if (!controller.signal.aborted) onSnapshot({ type: 'failed', serviceError: { message: '登录超时，请重试' } });
        return { saved: false };
    } finally {
        if (instance.qr === session) instance.qr = null;
    }
}

function submitQrVerifyCode(tenantId, code) {
    const session = getInstance(tenantId).qr;
    const value = String(code || '').trim();
    if (!session?.waiter) throw serviceError('WEIXIN_QR_NO_PENDING', '当前没有等待输入验证码的扫码流程');
    if (!/^\d{1,12}$/.test(value)) throw serviceError('WEIXIN_QR_CODE_INVALID', '请输入手机微信上显示的数字');
    session.waiter(value);
    return { ok: true };
}

// ── 状态 / 诊断 / 测试 ───────────────────────────────────

async function getStatus(tenantId = getTenantId()) {
    return runWithTenant(tenantId, async () => {
        const config = await configRepo.getConfig();
        const instance = getInstance(tenantId);
        const running = Boolean(instance.controller);
        const state = running ? instance.runtime : 'idle';
        let summary = null;
        try { summary = await targetsRepo.countSummary(CHANNEL); } catch { summary = null; }
        return {
            channel: CHANNEL,
            tenantId,
            enabled: config.enabled,
            configured: Boolean(config.token),
            runtime: { state, failureReason: running ? instance.failureReason : (instance.lastError?.message || null) },
            connected: state === 'ready',
            startedAt: instance.startedAt,
            lastPollAt: instance.lastPollAt,
            lastError: instance.lastError,
            stale: running && instance.fingerprint !== configRepo.connectionFingerprint(config),
            staleReason: running && instance.fingerprint !== configRepo.connectionFingerprint(config) ? 'config' : null,
            provider: instance.provider ? { ...instance.provider.stats, activeRuns: instance.provider.activeRuns.size } : null,
            summary,
            bot: { id: config.botId, ownerUserId: config.ownerUserId, source: config.source },
            openclaw: await detectOpenClaw(config),
            qrPending: Boolean(instance.qr?.waiter)
        };
    });
}

async function getDiagnostics(tenantId = getTenantId()) {
    const instance = getInstance(tenantId);
    return {
        status: await getStatus(tenantId),
        runtime: { state: instance.runtime, lastPollAt: instance.lastPollAt, pendingChains: instance.chains.size, contextTokens: Object.keys(instance.state?.contextTokens || {}).length },
        logs: instance.logs.slice(-LOG_KEEP).reverse()
    };
}

async function testConnection(tenantId = getTenantId()) {
    const steps = [];
    const push = (key, label, ok, detail) => steps.push({ key, label, ok, detail: detail || '' });
    const config = await runWithTenant(tenantId, () => configRepo.getConfig());
    if (!config.token) {
        push('config', '登录凭据', false, '缺少 bot token：请扫码登录或从 OpenClaw 导入');
        return { ok: false, steps };
    }
    push('config', '登录凭据', true, `bot=${config.botId || '未知'}，来源=${({ qrcode: '扫码', openclaw: 'OpenClaw 导入', manual: '手动' })[config.source] || '未知'}`);
    const started = Date.now();
    const resp = await ilink.getConfig({ baseUrl: config.baseUrl, token: config.token, userId: config.ownerUserId, botAgent: config.botAgent });
    const stale = resp.ret === ilink.STALE_TOKEN_ERRCODE || resp.errcode === ilink.STALE_TOKEN_ERRCODE;
    const reachable = Object.keys(resp).length > 0;
    push('api', 'iLink 接口', reachable && !stale, !reachable ? `无法访问 ${config.baseUrl}` : (stale ? 'token 已失效，请重新扫码或导入' : `可访问，耗时 ${Date.now() - started}ms`));
    if (!reachable || stale) return { ok: false, steps };
    const openclaw = await detectOpenClaw(config);
    if (openclaw.sameToken && openclaw.pluginEnabled) {
        push('openclaw', 'OpenClaw 占用', false, 'OpenClaw 微信插件仍在使用同一个 bot，消息会被两边抢收；请点击「暂停 OpenClaw 微信」');
    }
    const instance = getInstance(tenantId);
    const wasRunning = Boolean(instance.controller);
    try {
        await connect(tenantId);
        // 等第一轮长轮询返回（服务端最多挂起约 35 秒；首轮常立即返回）
        const until = Date.now() + 40000;
        while (instance.runtime === 'starting' && Date.now() < until) await sleep(500);
        const ok = instance.runtime === 'ready';
        push('poll', '消息长轮询', ok, ok ? '已就绪，可以在微信里给助理发消息了' : (instance.failureReason || `当前状态：${instance.runtime}`));
    } catch (error) {
        push('poll', '消息长轮询', false, error.message);
    }
    if (!config.enabled && !wasRunning) {
        await disconnect(tenantId);
        push('cleanup', '恢复状态', true, '频道未启用，测试连接已断开');
    }
    return { ok: steps.every(step => step.ok), steps };
}

// ── 主动推送 ─────────────────────────────────────────────

async function push(tenantId = getTenantId(), { text, targets, trigger = 'system', source = '' } = {}) {
    const content = String(text || '').trim();
    if (!content) throw serviceError('WEIXIN_PUSH_EMPTY', '推送内容不能为空');
    if (content.length > MAX_PUSH_CHARS) throw serviceError('WEIXIN_PUSH_TOO_LONG', `推送内容不能超过 ${MAX_PUSH_CHARS} 字`);
    return runWithTenant(tenantId, async () => {
        const config = await configRepo.getConfig();
        const finalTargets = configRepo.normalizeTargets(Array.isArray(targets) && targets.length ? targets : config.push.defaultTargets).slice(0, MAX_PUSH_TARGETS);
        if (!finalTargets.length) throw serviceError('WEIXIN_PUSH_NO_TARGET', '没有推送目标：请传入 targets，或在「频道对接 › 微信」配置默认推送范围');
        const instance = getInstance(tenantId);
        if (!instance.controller || instance.runtime !== 'ready') throw serviceError('WEIXIN_NOT_CONNECTED', '微信助理未连接，请在「全局设置 › 频道对接 › 微信」启用并连接', 503);
        const results = [];
        for (const target of finalTargets) {
            const stored = await targetsRepo.getTarget(CHANNEL, target.kind, target.id);
            const base = { kind: target.kind, id: target.id, name: stored?.name || target.id };
            const log = entry => targetsRepo.logMessage(CHANNEL, { direction: 'out', kind: target.kind, targetId: target.id, text: content, trigger, source, ...entry });
            const verdict = access.checkTarget(config.access, target);
            let error = '';
            if (!verdict.allowed) error = access.describeDenial(verdict);
            else if (target.kind === 'group') error = '微信助理暂不支持向群推送';
            else if (!instance.state.contextTokens[target.id]) error = '该联系人尚未给助理发过消息，暂无可推送的会话';
            if (error) {
                results.push({ ...base, ok: false, error });
                await log({ status: verdict.allowed ? 'error' : 'denied', error });
                continue;
            }
            try {
                await sendToUser(instance, target.id, content);
                results.push({ ...base, ok: true });
                await log({ status: 'ok', toolSessionId: stored?.toolSessionId || null });
            } catch (sendError) {
                const message = describeSendError(sendError);
                results.push({ ...base, ok: false, error: message });
                await log({ status: 'error', error: message });
            }
        }
        const sent = results.filter(item => item.ok).length;
        return { ok: sent === results.length, sent, failed: results.length - sent, results };
    });
}

async function autoStartAll(listTenantIds) {
    const ids = new Set(['default']);
    try {
        (await listTenantIds()).forEach(id => id && ids.add(id));
    } catch (error) {
        console.warn('[Weixin] 读取租户列表失败，仅检查默认租户：', error.message);
    }
    for (const tenantId of ids) {
        try {
            const config = await runWithTenant(tenantId, () => configRepo.getConfig());
            if (!config.enabled) continue;
            await connect(tenantId);
            console.log(`[Weixin] 租户 ${tenantId} 已启动微信长轮询`);
        } catch (error) {
            getInstance(tenantId).lastError = { code: error.code || 'WEIXIN_START_FAILED', message: error.message, at: new Date().toISOString() };
            console.warn(`[Weixin] 租户 ${tenantId} 自动连接失败：${error.message}`);
        }
    }
}

async function stopAll() {
    await Promise.allSettled([...instances.values()].map(instance => stopInstance(instance, 'shutdown')));
}

function resetForTests() {
    instances.clear();
}

module.exports = {
    CHANNEL,
    connect,
    disconnect,
    restart,
    applyConfig,
    getStatus,
    getDiagnostics,
    testConnection,
    runQrAuth,
    submitQrVerifyCode,
    importFromOpenClaw,
    setOpenClawWeixin,
    push,
    autoStartAll,
    stopAll,
    inboundText,
    toWeixinText,
    chunkText,
    resetForTests
};
