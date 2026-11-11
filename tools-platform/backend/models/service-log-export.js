const JSZip = require('jszip');
const db = require('./app-db');
const { getTenantId } = require('./tenant-context');
const { redactText, redactValue } = require('./ai-sensitive-data');

function badRange() {
    return Object.assign(new Error('请选择有效的起止日期，结束日期不能早于开始日期'), { statusCode: 400, code: 'INVALID_LOG_EXPORT_RANGE' });
}

function parseRange(query = {}) {
    const today = new Date();
    const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const startDate = query.startDate || localDay;
    const endDate = query.endDate || startDate;
    const midnight = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRange();
        const date = new Date(`${value}T00:00:00.000Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw badRange();
        return date.getTime();
    };
    const start = midnight(startDate), end = midnight(endDate);
    if (end < start) throw badRange();
    // 每个边界各带一个浏览器本地偏移，兼容跨夏令时的日期范围。
    const offset = (value, fallback) => {
        const number = value === undefined ? fallback : Number(value);
        if (value === '' || !Number.isInteger(number) || Math.abs(number) > 840) throw badRange();
        return number;
    };
    const startOffset = offset(query.startOffset, new Date(`${startDate}T00:00:00`).getTimezoneOffset());
    const nextLocalDay = new Date(`${endDate}T00:00:00`);
    nextLocalDay.setDate(nextLocalDay.getDate() + 1);
    const endOffset = offset(query.endOffset, nextLocalDay.getTimezoneOffset());
    const startAt = new Date(start + startOffset * 60000).toISOString();
    const endAt = new Date(end + 86400000 + endOffset * 60000).toISOString();
    if (endAt <= startAt) throw badRange();
    return { startDate, endDate, startAt, endAt, startOffset, endOffset };
}

// 仅导出保存的文本；不读取附件路径，不跟随图片 URL，不保留嵌入媒体或二进制字段。
function textOnly(value, secrets, key = '') {
    if (/^(?:images?|image_?url|image_?data|attachments?|files?|assets?|audio|video|base64|bytes|buffer|thought_?signature|inline_?data|file_?data)$/i.test(key)) return undefined;
    if (typeof value === 'string') {
        let text = value.replace(/data:[\w.+/-]+(?:;[\w=.+-]+)*;base64,[a-z\d+/=]+/gi, '[omitted media]')
            .replace(/[a-z\d+/=]{1024,}/gi, '[omitted encoded data]')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '[omitted image]')
            .replace(/<img\b[^>]*>/gi, '[omitted image]');
        if (/^\s*[\[{]/.test(text)) {
            try { return JSON.stringify(textOnly(JSON.parse(text), secrets)); } catch (_) { /* 普通代码原样保留 */ }
        }
        return redactText(text, { secrets });
    }
    if (Array.isArray(value)) return value.map(item => textOnly(item, secrets)).filter(item => item !== undefined);
    if (value && typeof value === 'object') {
        if (value.type === 'Buffer' || /^(?:image|audio|video)\//i.test(value.mimeType || value.mime_type || '')) return undefined;
        if (/^(?:image|image_url|input_image|output_image|audio|video|file|document)$/.test(value.type || '')) return undefined;
        return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, textOnly(item, secrets, name)]).filter(([, item]) => item !== undefined));
    }
    return value;
}

async function buildArchive(query, owner) {
    const range = parseRange(query);
    if (!owner) throw Object.assign(new Error('需要登录'), { statusCode: 401 });
    const zip = new JSZip();
    // 配置读取失败时终止导出，避免绕过已配置密钥的脱敏。
    const secrets = await require('./ai-settings-repository').getRedactionSecrets();
    const manifest = {
        format: 'dragon-claw-service-logs', formatVersion: 1, exportedAt: new Date().toISOString(),
        tenant: getTenantId(), exportedBy: owner, range, runtimeLogs: 0, aiMessages: 0, agentTurns: 0, desktopMessages: 0,
        notes: [
            '运行日志：当前租户所选日期内全部现存记录，不应用页面搜索/等级/分页；保留策略为最近30天且最多约50000条，已清理的记录无法恢复。',
            'AI对话：仅当前账号，按消息创建时间筛选；工作区工具转录按轮次创建时间筛选。只含文本/代码/工具过程，不包含附件文件或嵌入媒体。',
            '桌面对话：尽力读取当前账号已绑定连接器可见的历史，受连接器最近会话数量限制；本地历史读取还受现有单会话最近200条/文件尾部8MB等限制，不能保证覆盖全部历史。没有消息时间的内容跳过，不根据会话更新时间猜测日期。'
        ], warnings: []
    };
    const write = (name, value) => zip.file(name, JSON.stringify(redactValue(textOnly(value, secrets), { secrets }), null, 2));
    await require('./service-status-repository').ensureReady();
    // 不通过分页 API，避免截断、翻页时新增日志导致漏行或重复。
    const logs = await db.all(`SELECT * FROM service_runtime_logs WHERE logged_at >= ? AND logged_at < ? ORDER BY logged_at, id`, [range.startAt, range.endAt]);
    manifest.runtimeLogs = logs.length;
    write('runtime-logs.json', logs);
    try {
        await require('./ai-chat-repository').ensureReady();
        const messages = await db.all(`SELECT m.id, m.session_id, m.role, m.content, m.events, m.model_name, m.created_at,
            s.page_title, s.page_path FROM ai_chat_messages m JOIN ai_chat_sessions s ON s.id = m.session_id
            WHERE s.owner = ? AND julianday(m.created_at) >= julianday(?) AND julianday(m.created_at) < julianday(?)
            ORDER BY m.created_at, m.rowid`, [owner, range.startAt, range.endAt]);
        manifest.aiMessages = messages.length;
        write('ai/messages.json', messages);
    } catch (error) {
        manifest.warnings.push('平台AI对话读取失败：' + error.message);
    }
    try {
        await require('./agent-transcript-repository').ensureReady();
        const turns = await db.all(`SELECT run_id, agent_session_id, chat_session_id, status, created_at, updated_at, transcript
            FROM agent_session_turns WHERE owner = ? AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?) ORDER BY created_at, rowid`,
        [`${getTenantId()}::${owner}`, range.startAt, range.endAt]);
        manifest.agentTurns = turns.length;
        write('ai/agent-turns.json', turns);
    } catch (error) {
        manifest.warnings.push('工作区工具转录读取失败：' + error.message);
    }
    try {
        const service = require('./desktop-agents/service');
        const state = await service.discover(owner);
        let undated = 0;
        for (const session of state.rows) {
            try {
                const result = await service.messages(owner, session.provider, session.id, { passive: true });
                if (result.available === false || !Array.isArray(result.items)) throw new Error(result.reason || '会话暂不可读');
                const messages = result.items.filter(item => {
                    const time = Date.parse(item.createdAt || item.timestamp || '');
                    if (!Number.isFinite(time)) { undated++; return false; }
                    return time >= Date.parse(range.startAt) && time < Date.parse(range.endAt);
                });
                if (messages.length) {
                    manifest.desktopMessages += messages.length;
                    const safeId = String(session.id).replace(/[^a-z\d_-]/gi, '_');
                    const safeProvider = String(session.provider).replace(/[^a-z\d_-]/gi, '_');
                    write(`ai/desktop/${safeProvider}-${safeId}.json`, { session: service.publicSession(session), messages });
                }
            } catch (error) { manifest.warnings.push(`桌面对话 ${session.provider}/${session.id}：${error.message}`); }
        }
        if (undated) manifest.warnings.push(`跳过 ${undated} 条没有有效消息时间的桌面对话记录。`);
    } catch (error) { manifest.warnings.push('桌面对话未导出：' + error.message); }
    write('manifest.json', manifest);
    return { filename: `service-logs-${range.startDate}_${range.endDate}.zip`, buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
}

module.exports = { parseRange, textOnly, buildArchive };
