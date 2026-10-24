// 微信 iLink Bot 协议客户端：移植自 OpenClaw 官方微信插件 @tencent-weixin/openclaw-weixin@2.4.9
// （src/api/api.ts、src/auth/login-qr.ts）。纯 HTTP JSON，无需 SDK：
//   扫码：get_bot_qrcode → get_qrcode_status（长轮询，confirmed 时返回 bot_token）
//   收消息：getupdates 长轮询（get_updates_buf 游标需持久化）
//   发消息：sendmessage（带对方最近一条消息的 context_token）
const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const CHANNEL_VERSION = '2.4.9';
const ILINK_APP_ID = 'bot';
const BOT_TYPE = '3';
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35000;
const DEFAULT_API_TIMEOUT_MS = 15000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10000;
const QR_LONG_POLL_TIMEOUT_MS = 35000;
/** 服务端返回 -14 表示 bot token 失效（被其他客户端顶替或已解绑）。 */
const STALE_TOKEN_ERRCODE = -14;

const MessageType = { USER: 1, BOT: 2 };
const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 };
const MessageState = { FINISH: 2 };
const TypingStatus = { TYPING: 1, CANCEL: 2 };

function clientVersion(version) {
    const [major = 0, minor = 0, patch = 0] = version.split('.').map(part => parseInt(part, 10) || 0);
    return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function baseInfo(botAgent) {
    return { channel_version: CHANNEL_VERSION, bot_agent: botAgent || 'ToolsPlatform/1.0' };
}

function commonHeaders() {
    return { 'iLink-App-Id': ILINK_APP_ID, 'iLink-App-ClientVersion': String(clientVersion(CHANNEL_VERSION)) };
}

/** X-WECHAT-UIN：随机 uint32 的十进制字符串再 base64。 */
function randomWechatUin() {
    return Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), 'utf-8').toString('base64');
}

function ensureSlash(url) {
    return url.endsWith('/') ? url : `${url}/`;
}

/** message_id 等 uint64 字段先加引号再解析，避免精度丢失。 */
function parseJson(rawText) {
    return JSON.parse(String(rawText || '{}').replace(/"(message_id|msg_id|svr_id)"\s*:\s*(-?\d+)/g, '"$1":"$2"'));
}

async function request({ method = 'POST', baseUrl, endpoint, body, token, timeoutMs, signal, label }) {
    const url = new URL(endpoint, ensureSlash(baseUrl || DEFAULT_BASE_URL));
    const headers = method === 'GET' ? commonHeaders() : {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': randomWechatUin(),
        ...commonHeaders(),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
        const res = await fetch(url, { method, headers, body: method === 'GET' ? undefined : body, signal: controller.signal });
        const text = await res.text();
        if (!res.ok) {
            const error = new Error(`${label} HTTP ${res.status}: ${text.slice(0, 200)}`);
            error.statusCode = res.status;
            throw error;
        }
        return text;
    } finally {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }
}

function isAbort(error) {
    return error && error.name === 'AbortError';
}

/** 长轮询收消息；客户端超时视为无新消息。 */
async function getUpdates({ baseUrl, token, getUpdatesBuf = '', timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS, signal, botAgent }) {
    try {
        const text = await request({
            baseUrl, token, signal, timeoutMs, label: 'getUpdates',
            endpoint: 'ilink/bot/getupdates',
            body: JSON.stringify({ get_updates_buf: getUpdatesBuf, base_info: baseInfo(botAgent) })
        });
        return parseJson(text);
    } catch (error) {
        if (isAbort(error)) return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf, aborted: Boolean(signal?.aborted) };
        throw error;
    }
}

function newClientId() {
    return `tools-weixin-${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/** 发送一条文本消息，返回服务端消息 ID。 */
async function sendText({ baseUrl, token, to, text, contextToken, botAgent, timeoutMs = DEFAULT_API_TIMEOUT_MS }) {
    const clientId = newClientId();
    const body = {
        msg: {
            from_user_id: '',
            to_user_id: to,
            client_id: clientId,
            message_type: MessageType.BOT,
            message_state: MessageState.FINISH,
            item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
            context_token: contextToken || undefined
        },
        base_info: baseInfo(botAgent)
    };
    const resp = parseJson(await request({ baseUrl, token, timeoutMs, label: 'sendMessage', endpoint: 'ilink/bot/sendmessage', body: JSON.stringify(body) }));
    if (resp.ret && resp.ret !== 0) {
        const error = new Error(`sendMessage ret=${resp.ret} ${resp.errmsg || ''}`.trim());
        error.ret = resp.ret;
        throw error;
    }
    return { clientId, messageId: resp.message_id || '' };
}

/** 取 typing_ticket（用于“对方正在输入”）。失败返回空。 */
async function getConfig({ baseUrl, token, userId, contextToken, botAgent }) {
    try {
        return JSON.parse(await request({
            baseUrl, token, timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS, label: 'getConfig',
            endpoint: 'ilink/bot/getconfig',
            body: JSON.stringify({ ilink_user_id: userId, context_token: contextToken, base_info: baseInfo(botAgent) })
        }));
    } catch {
        return {};
    }
}

async function sendTyping({ baseUrl, token, userId, typingTicket, status = TypingStatus.TYPING, botAgent }) {
    if (!typingTicket) return;
    try {
        await request({
            baseUrl, token, timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS, label: 'sendTyping',
            endpoint: 'ilink/bot/sendtyping',
            body: JSON.stringify({ ilink_user_id: userId, typing_ticket: typingTicket, status, base_info: baseInfo(botAgent) })
        });
    } catch {
        // 输入状态只是体验优化，失败忽略
    }
}

async function notify(kind, { baseUrl, token, botAgent }) {
    try {
        return JSON.parse(await request({
            baseUrl, token, timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS, label: `notify${kind}`,
            endpoint: `ilink/bot/msg/notify${kind}`,
            body: JSON.stringify({ base_info: baseInfo(botAgent) })
        }));
    } catch (error) {
        return { ret: -1, errmsg: error.message };
    }
}

const notifyStart = options => notify('start', options);
const notifyStop = options => notify('stop', options);

// ── 扫码登录 ─────────────────────────────────────────────

async function fetchQrCode({ localTokens = [] } = {}) {
    const text = await request({
        baseUrl: DEFAULT_BASE_URL, label: 'fetchQRCode', timeoutMs: DEFAULT_API_TIMEOUT_MS,
        endpoint: `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`,
        body: JSON.stringify({ local_token_list: localTokens.filter(Boolean).slice(0, 10) })
    });
    const data = JSON.parse(text);
    if (!data.qrcode || !data.qrcode_img_content) throw new Error('未获取到微信登录二维码');
    return { qrcode: data.qrcode, qrcodeUrl: data.qrcode_img_content };
}

async function pollQrStatus({ baseUrl = DEFAULT_BASE_URL, qrcode, verifyCode, signal }) {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
    try {
        return JSON.parse(await request({ method: 'GET', baseUrl, endpoint, timeoutMs: QR_LONG_POLL_TIMEOUT_MS, signal, label: 'pollQRStatus' }));
    } catch (error) {
        if (signal?.aborted) throw error;
        // 长轮询超时或网关抖动：按 wait 处理，继续轮询
        return { status: 'wait' };
    }
}

module.exports = {
    DEFAULT_BASE_URL,
    CHANNEL_VERSION,
    STALE_TOKEN_ERRCODE,
    MessageType,
    MessageItemType,
    TypingStatus,
    getUpdates,
    sendText,
    getConfig,
    sendTyping,
    notifyStart,
    notifyStop,
    fetchQrCode,
    pollQrStatus
};
