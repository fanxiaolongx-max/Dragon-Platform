// Dragon Claw 的 MCP 客户端：管理员在「全局设置 › 智能体工具」添加 MCP 服务（本机进程 stdio 或 HTTP 地址），
// 服务的工具作为附加工具组接进首页对话（按需加载、默认每次调用都审批）。
// - 只开放给默认租户：MCP 服务在服务器上启动进程或访问网络，不能让租户管理员各自配置。
// - 连不上就跳过：连接有超时，失败的服务标成不可用、它的工具不出现在列表里，60 秒后再试；换到能连上的网络后自动恢复。
// - 环境变量 / 请求头里的值视为密钥：接口只返回打码值，内容加入脱敏名单，不发给模型。
// - 服务要先装好、写死版本，按本地命令启动；不在运行时 npx @latest 现下载。
const { readKV, writeKV } = require('./kv-store');
const { getTenantId } = require('./tenant-context');

const CONFIG_KEY = 'agent_mcp_servers';
const DEFAULT_TENANT_ID = 'default';
const CONNECT_TIMEOUT_MS = 15000;
const FIRST_USE_WAIT_MS = 5000;
const CALL_TIMEOUT_MS = 120000;
const RETRY_AFTER_MS = 60000;
const MAX_SERVERS = 20;
const MASK = '••••••';
const RESULT_CHARS = 2 * 1024 * 1024;

const connections = new Map(); // id → { key, client, tools, status, error, at, connecting }

function mcpError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

function tenantAllowed(tenantId = getTenantId()) {
    return tenantId === DEFAULT_TENANT_ID;
}

const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);

function normalizeMap(value) {
    const out = {};
    for (const [key, raw] of Object.entries(value && typeof value === 'object' ? value : {})) {
        const name = String(key).trim();
        if (/^[A-Za-z_][\w-]{0,99}$/.test(name)) out[name] = String(raw ?? '').slice(0, 4000);
    }
    return out;
}

function normalizeServer(input, index, used) {
    const name = String(input?.name || '').trim().slice(0, 60);
    if (!name) throw mcpError('MCP_CONFIG', `第 ${index + 1} 个服务缺少名称`);
    let id = slug(input.id) || slug(name) || `server${index + 1}`;
    while (used.has(id)) id = `${id}_${index + 1}`.slice(0, 28);
    used.add(id);
    const transport = input.transport === 'http' ? 'http' : 'stdio';
    const server = { id, name, enabled: input.enabled !== false, trusted: input.trusted === true, transport,
        timeoutMs: Math.min(600000, Math.max(5000, Number(input.timeoutMs) || CALL_TIMEOUT_MS)) };
    if (transport === 'stdio') {
        server.command = String(input.command || '').trim();
        if (!server.command) throw mcpError('MCP_CONFIG', `「${name}」缺少启动命令`);
        if (/\bnpx\b[\s\S]*@latest\b/.test(`${server.command} ${(input.args || []).join(' ')}`)) throw mcpError('MCP_CONFIG', `「${name}」不要用 npx …@latest 现下载：请先安装好并写死版本`);
        server.args = (Array.isArray(input.args) ? input.args : String(input.args || '').split(/\n/)).map(item => String(item).trim()).filter(Boolean).slice(0, 50);
        server.cwd = String(input.cwd || '').trim();
        server.env = normalizeMap(input.env);
    } else {
        let url;
        try { url = new URL(String(input.url || '').trim()); } catch (_error) { throw mcpError('MCP_CONFIG', `「${name}」的地址无效`); }
        if (!['http:', 'https:'].includes(url.protocol)) throw mcpError('MCP_CONFIG', `「${name}」只支持 http / https 地址`);
        server.url = url.toString();
        server.headers = normalizeMap(input.headers);
    }
    return server;
}

async function readServers() {
    const stored = await readKV('sys', CONFIG_KEY, []);
    return Array.isArray(stored) ? stored : [];
}

/** 给前端：环境变量 / 请求头只返回打码值 */
function publicServer(server) {
    const mask = map => Object.fromEntries(Object.keys(map || {}).map(key => [key, map[key] ? MASK : '']));
    const conn = connections.get(server.id);
    return { ...server, ...(server.env ? { env: mask(server.env) } : {}), ...(server.headers ? { headers: mask(server.headers) } : {}),
        status: conn?.status || (server.enabled ? 'idle' : 'disabled'), error: conn?.error || '', tools: (conn?.tools || []).map(tool => ({ name: tool.name, description: String(tool.description || '').slice(0, 300) })) };
}

async function listServers() {
    if (!tenantAllowed()) throw mcpError('MCP_TENANT', 'MCP 服务只在默认租户里配置和使用', 403);
    return (await readServers()).map(publicServer);
}

/** 保存整份配置；提交回来的打码值保留原值 */
async function saveServers(input) {
    if (!tenantAllowed()) throw mcpError('MCP_TENANT', 'MCP 服务只在默认租户里配置和使用', 403);
    const list = Array.isArray(input) ? input.slice(0, MAX_SERVERS + 1) : [];
    if (list.length > MAX_SERVERS) throw mcpError('MCP_CONFIG', `最多 ${MAX_SERVERS} 个 MCP 服务`);
    const previous = new Map((await readServers()).map(server => [server.id, server]));
    const used = new Set();
    const servers = list.map((item, index) => {
        const server = normalizeServer(item, index, used);
        const old = previous.get(String(item.id || ''));
        for (const field of ['env', 'headers']) {
            if (!server[field]) continue;
            for (const key of Object.keys(server[field])) if (server[field][key] === MASK) server[field][key] = old?.[field]?.[key] || '';
        }
        return server;
    });
    await writeKV('sys', CONFIG_KEY, servers);
    // 配置变了的连接断开，下次使用时按新配置重连
    const keep = new Map(servers.map(server => [server.id, JSON.stringify(server)]));
    for (const [id, conn] of connections) if (keep.get(id) !== conn.key) disconnect(id);
    return servers.map(publicServer);
}

/** 脱敏名单：MCP 服务的环境变量与请求头里的值 */
async function secrets() {
    if (!tenantAllowed()) return [];
    return (await readServers()).flatMap(server => [...Object.values(server.env || {}), ...Object.values(server.headers || {})]).filter(value => String(value).length >= 6);
}

function disconnect(id) {
    const conn = connections.get(id);
    connections.delete(id);
    conn?.client?.close().catch(() => {});
}

async function connect(server) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const client = new Client({ name: 'dragon-claw', version: '1.0.0' });
    let transport;
    if (server.transport === 'stdio') {
        const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js');
        // 只传系统基础变量（PATH 等）、代理设置和该服务自己的变量，不把平台进程的密钥环境变量带给子进程
        const proxy = Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
        transport = new StdioClientTransport({ command: server.command, args: server.args || [], cwd: server.cwd || undefined, env: { ...getDefaultEnvironment(), ...proxy, ...(server.env || {}) }, stderr: 'ignore' });
    } else {
        const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
        transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers || {} } });
    }
    let timer;
    try {
        await Promise.race([
            client.connect(transport),
            new Promise((_resolve, reject) => { timer = setTimeout(() => reject(mcpError('MCP_TIMEOUT', `连接超时（${CONNECT_TIMEOUT_MS / 1000} 秒）`)), CONNECT_TIMEOUT_MS); })
        ]);
        const tools = [];
        let cursor;
        do {
            const page = await client.listTools(cursor ? { cursor } : {});
            tools.push(...(page.tools || []));
            cursor = page.nextCursor;
        } while (cursor && tools.length < 500);
        return { client, tools };
    } catch (error) {
        client.close().catch(() => {});
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/** 确保已连接；正在连接时等待；失败后 60 秒内不再重试 */
function ensureConnected(server) {
    const key = JSON.stringify(server);
    let conn = connections.get(server.id);
    if (conn && conn.key !== key) { disconnect(server.id); conn = null; }
    if (conn?.status === 'ready') return Promise.resolve(conn);
    if (conn?.connecting) return conn.connecting;
    if (conn?.status === 'error' && Date.now() - conn.at < RETRY_AFTER_MS) return Promise.resolve(conn);
    conn = { key, status: 'connecting', error: '', tools: [], at: Date.now() };
    connections.set(server.id, conn);
    conn.connecting = connect(server).then(({ client, tools }) => {
        Object.assign(conn, { client, tools, status: 'ready', error: '', at: Date.now(), connecting: null });
        client.onclose = () => { if (connections.get(server.id) === conn) Object.assign(conn, { status: 'error', error: '连接已断开', at: Date.now(), client: null }); };
        return conn;
    }, error => {
        Object.assign(conn, { status: 'error', error: String(error.message || error).slice(0, 500), at: Date.now(), connecting: null });
        return conn;
    });
    return conn.connecting;
}

/** 设置页「测试连接」：立即重连并列出工具 */
async function testServer(id) {
    if (!tenantAllowed()) throw mcpError('MCP_TENANT', 'MCP 服务只在默认租户里配置和使用', 403);
    const server = (await readServers()).find(item => item.id === id);
    if (!server) throw mcpError('MCP_NOT_FOUND', '没有这个 MCP 服务', 404);
    disconnect(id);
    return publicServer(await ensureConnected(server).then(() => server));
}

const toolName = (serverId, name) => `mcp__${serverId}__${String(name).replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);

function inputSchema(schema) {
    const { $schema: _ignored, ...rest } = schema && typeof schema === 'object' ? schema : {};
    return rest.type === 'object' ? rest : { type: 'object', properties: {} };
}

function resultText(result) {
    const parts = (result?.content || []).map(item => {
        if (item.type === 'text') return item.text;
        if (item.type === 'resource') return item.resource?.text ?? `[资源 ${item.resource?.uri || ''}]`;
        if (item.type === 'resource_link') return `[链接 ${item.name || ''} ${item.uri || ''}]`;
        if (item.type === 'image' || item.type === 'audio') return `[${item.type === 'image' ? '图片' : '音频'} ${item.mimeType || ''}，模型看不到内容]`;
        return JSON.stringify(item);
    });
    if (result?.structuredContent && !parts.length) parts.push(JSON.stringify(result.structuredContent, null, 1));
    return parts.join('\n').slice(0, RESULT_CHARS) || '（没有返回内容）';
}

/**
 * 首页对话的 MCP 工具组（每个已连接的服务一组）；只给默认租户的管理员。
 * 没连上的服务先等最多 5 秒，仍连不上就跳过这一轮。
 */
async function toolsets({ readOnly }) {
    if (readOnly || !tenantAllowed()) return [];
    const servers = (await readServers()).filter(server => server.enabled);
    if (!servers.length) return [];
    const ready = await Promise.all(servers.map(server => Promise.race([ensureConnected(server), new Promise(resolve => setTimeout(resolve, FIRST_USE_WAIT_MS))]).then(() => [server, connections.get(server.id)])));
    return ready.filter(([, conn]) => conn?.status === 'ready' && conn.tools.length).map(([server, conn]) => {
        const byName = new Map(conn.tools.map(tool => [toolName(server.id, tool.name), tool]));
        return {
            id: `mcp_${server.id}`,
            label: `MCP 服务「${server.name}」${server.trusted ? '（只读，免审批）' : ''}`,
            definitions: [...byName].map(([name, tool]) => ({ name, description: `[MCP ${server.name}] ${String(tool.description || tool.title || tool.name).slice(0, 1000)}`, parameters: inputSchema(tool.inputSchema) })),
            kindOf: () => (server.trusted ? 'read' : 'external'),
            preview: async (name, args) => ({ title: `MCP · ${server.name}`, impact: server.transport === 'stdio' ? `本机进程 ${server.command}` : server.url,
                fields: [{ label: '工具', value: byName.get(name)?.name || name }, { label: '参数', value: JSON.stringify(args || {}, null, 1).slice(0, 2000) }] }),
            alwaysKey: name => name,
            async execute(call) {
                const tool = byName.get(call.name);
                if (!tool) return { content: `MCP 服务里没有工具 ${call.name}`, summary: '工具不存在', isError: true };
                try {
                    const live = await ensureConnected(server);
                    if (live.status !== 'ready') throw mcpError('MCP_UNAVAILABLE', `MCP 服务「${server.name}」不可用：${live.error}`);
                    const result = await live.client.callTool({ name: tool.name, arguments: call.args && typeof call.args === 'object' ? call.args : {} }, undefined, { timeout: server.timeoutMs });
                    const text = resultText(result);
                    return { content: text, summary: `${server.name} · ${tool.name}${result.isError ? ' 失败' : ''}`.slice(0, 120), ...(result.isError ? { isError: true } : {}) };
                } catch (error) {
                    return { content: `错误（${error.code || 'MCP_ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
                }
            }
        };
    });
}

/** 服务启动后预先连接（默认租户），首页第一次对话不用等 */
async function warmup() {
    if (!tenantAllowed()) return;
    const servers = (await readServers().catch(() => [])).filter(server => server.enabled);
    servers.forEach(server => ensureConnected(server));
}

function shutdown() {
    [...connections.keys()].forEach(disconnect);
}
process.once('exit', shutdown);

module.exports = { CONFIG_KEY, MASK, listServers, saveServers, testServer, toolsets, secrets, warmup, shutdown, toolName, tenantAllowed, _internal: { connections, normalizeServer, resultText } };
