// ADC UI compatibility for hosted AiOps pages. Original application files are never changed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run, get, all, getDatabase } = require('../app-db');
const settings = require('../ai-settings-repository');
const provider = require('../ai-provider-client');
const { redactText } = require('../ai-sensitive-data');
const tenant = require('../tenant-context');
const ready = new WeakMap();
const busy = new Set();
function ensureReady() {
    const db = getDatabase();
    if (!ready.has(db)) ready.set(db, run(`CREATE TABLE IF NOT EXISTS hosted_adc_sessions (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '', messages TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
    )`).catch(error => { ready.delete(db); throw error; }));
    return ready.get(db);
}
const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });
async function session(id, claims) {
    await ensureReady();
    const row = await get('SELECT * FROM hosted_adc_sessions WHERE id=? AND owner=? AND slug=?', [id, claims.u, claims.s]);
    if (!row) throw fail(404, '会话不存在');
    return { ...row, messages: JSON.parse(row.messages) };
}
async function dispatch(route, method, body, claims, generate = null) {
    await ensureReady();
    if (route === '/models' && method === 'GET') {
        const choices = await settings.getModelChoices();
        return { defaultId: choices.defaultId, models: choices.models.map(({ id, name, description }) => ({ id, name, description })) };
    }
    if (route === '/sessions' && method === 'GET') return { sessions: await all('SELECT id,title,model_id,updated_at FROM hosted_adc_sessions WHERE owner=? AND slug=? ORDER BY updated_at DESC LIMIT 100', [claims.u, claims.s]) };
    if (route === '/sessions' && method === 'POST') {
        const id = crypto.randomUUID();
        await run('INSERT INTO hosted_adc_sessions(id,owner,slug,updated_at) VALUES(?,?,?,?)', [id, claims.u, claims.s, new Date().toISOString()]);
        return { id };
    }
    if (route.startsWith('/sessions/') && method === 'GET') return session(route.slice(10), claims);
    if (route !== '/chat' || method !== 'POST') throw fail(404, '接口不存在');
    const row = await session(String(body.sessionId || ''), claims);
    const question = String(body.message || '').trim();
    if (!question || question.length > 20000) throw fail(400, '问题长度应为 1–20000 字符');
    const lock = `${tenant.getTenantId()}:${row.id}`;
    if (busy.has(lock)) throw fail(409, '当前会话正在生成，请稍候');
    busy.add(lock);
    try {
        const choice = await settings.resolveModelChoice(body.modelId || row.model_id);
        if (!choice) throw fail(503, '没有可用的对话模型');
        const config = await settings.getRuntimeSettings({ profileId: choice.profileId });
        if (!generate && (!config.hasApiKey || !config.keyLooksValid)) throw fail(503, '请先在平台 AI 设置中配置可用的对话模型');
        const secrets = await settings.getRedactionSecrets();
        const clean = value => redactText(value, { secrets });
        const messages = [...row.messages.slice(-40), { role: 'user', content: clean(question) }];
        const dataTools = require('./adc-data-tools');
        const access = await dataTools.create(claims.s);
        const client = generate ? null : provider.createClient(config);
        const result = await dataTools.answer({
            generate: generate || (options => client.generateChat(options)), access, clean,
            options: { messages, systemInstruction: config.systemPrompt || '你是 Dragon Claw，帮助用户分析网络运营数据。', maxOutputTokens: config.maxOutputTokens || 8192, signal: body.signal }
        });
        if (body.signal?.aborted) throw fail(499, '已停止');
        const text = clean(String(result.text || ''));
        if (!text.trim()) throw fail(502, '模型没有返回正文，请重试');
        // Bound stored context as well as provider input; no credentials are stored or sent.
        const saved = [...messages, { role: 'assistant', content: text }].slice(-100);
        await run('UPDATE hosted_adc_sessions SET messages=?,title=?,model_id=?,updated_at=? WHERE id=? AND owner=? AND slug=?', [JSON.stringify(saved), row.title || clean(question).replace(/^【系统上下文，请勿向用户复述】[\s\S]*?用户问题：/, '').slice(0, 80), choice.id, new Date().toISOString(), row.id, claims.u, claims.s]);
        return { text, sessionId: row.id, modelId: choice.id };
    } finally { busy.delete(lock); }
}
function adaptHtml(html, prefix) {
    if (!html.includes('ADCChat v1.4') || !html.includes('id="aiBarFrame"')) return html;
    // Replace only the bundled ADC client; keep the application UI and business code intact.
    return html.replace(/<script>\s*\/\*\s*\n \* ADCChat v1\.4[\s\S]*?<\/script>/, `<script src="${prefix}/__platform/adc/client.js"></script>`)
        .replace('const onSite = ADC_ORIGINS.includes(location.origin);', 'const onSite = true;')
        .replace(/frame\.src = location\.origin \+\s*'\/adc-agent\/static\/deepagent-sandbox\/index\.html\?project_name=OperationsDigitalHuman'\s*\+\s*'&module_name=OperationsDigitalHuman&deepAgent_name=agent_OperationsDigitalHuman';/, `frame.src = window.ADCChat.chatUrl;`);
}
function json(res, status, value) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
}
async function handle(req, res, route, claims) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const assets = { '/client.js': ['adc-client.js', 'application/javascript'], '/chat.js': ['adc-chat.js', 'application/javascript'], '/chat.css': ['adc-chat.css', 'text/css'], '/chat': ['adc-chat.html', 'text/html'] };
    if (assets[route] && req.method === 'GET') {
        const [file, type] = assets[route];
        res.setHeader('Content-Type', `${type}; charset=utf-8`);
        res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'");
        return res.end(fs.readFileSync(path.join(__dirname, '../../../frontend/hosted-adc', file)));
    }
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.end(); }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
        let body = {};
        if (req.method === 'POST') {
            const chunks = []; let size = 0;
            for await (const chunk of req) { size += chunk.length; if (size > 100000) throw fail(413, '请求过大'); chunks.push(chunk); }
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, '无效 JSON'); }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, '无效请求');
        }
        const result = await dispatch(route, req.method, { ...body, signal: controller.signal }, claims);
        if (!res.destroyed) json(res, 200, result);
    } catch (error) {
        // Provider errors may contain request URLs/credentials; do not expose them to hosted apps.
        if (!res.destroyed) json(res, error.expose ? error.status : 502, { error: error.expose ? error.message : 'AI 请求失败，请检查平台模型配置或稍后重试', code: 'HOSTED_ADC_ERROR' });
    } finally { clearTimeout(timeout); }
}
module.exports = { adaptHtml, handle, dispatch };
