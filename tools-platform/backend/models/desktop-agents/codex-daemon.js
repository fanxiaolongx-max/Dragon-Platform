// Codex app-server daemon（ChatGPT.app 内置 Codex 起）：JSON-RPC over WebSocket over unix socket。
// 新版桌面端去掉了旧的多窗口 IPC 路由；桌面以 CODEX_APP_SERVER_USE_LOCAL_DAEMON=1 启动时与本客户端共用同一个 daemon。
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const WebSocket = require('ws');
// 提示给用户的命令必须是绝对路径：用户在终端里通常不在仓库目录下
const loginAgentScript = path.resolve(__dirname, '../../../scripts/codex-daemon-login-agent.sh');
const loginAgentCommand = `sh '${loginAgentScript.replace(/'/g, `'\\''`)}'`;
const failure = (code, message) => Object.assign(new Error(message), { code });
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const socketPath = () => path.join(codexHome(), 'app-server-control', 'app-server-control.sock');
const CLI = process.env.CODEX_CLI_PATH || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const RUNNING = ['inProgress', 'in_progress', 'running'];

function exists() {
    try {
        const stat = fs.statSync(socketPath()); // 跟随软链到 /tmp/codex-daemon-<uid>/...
        return stat.isSocket() && (!process.getuid || stat.uid === process.getuid());
    }
    catch {
        return false;
    }
}

class DaemonClient {
    constructor(timeout = 8000) { this.timeout = timeout; this.seq = 0; this.pending = new Map(); }
    connect() {
        if (!exists())
            return Promise.reject(failure('DESKTOP_UNAVAILABLE', 'Codex app-server daemon 未运行'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.close(); reject(failure('DESKTOP_UNAVAILABLE', 'Codex daemon 连接超时')); }, this.timeout);
            this.ws = new WebSocket('ws://localhost/rpc', { createConnection: () => net.createConnection(socketPath()), maxPayload: 256 * 1024 * 1024 });
            this.ws.on('message', data => {
                let message;
                try { message = JSON.parse(data); }
                catch { return; }
                // 服务端请求（审批等）留给桌面端处理；这里只认自己发出的响应
                if (message.method || message.id == null || !this.pending.has(message.id))
                    return;
                const p = this.pending.get(message.id);
                this.pending.delete(message.id);
                clearTimeout(p.timer);
                message.error ? p.reject(failure('DESKTOP_REJECTED', String(message.error.message || '桌面端拒绝请求'))) : p.resolve(message.result);
            });
            this.ws.on('error', () => this.rejectAll());
            this.ws.on('close', () => this.rejectAll());
            this.ws.once('error', e => { clearTimeout(timer); reject(failure('DESKTOP_UNAVAILABLE', 'Codex daemon 连接失败：' + e.message)); });
            this.ws.once('open', async () => {
                try {
                    await this.request('initialize', { clientInfo: { name: 'dragon-tac', version: '1' } });
                    this.ws.send(JSON.stringify({ method: 'initialized' }));
                    clearTimeout(timer);
                    resolve(this);
                }
                catch (e) {
                    clearTimeout(timer);
                    this.close();
                    reject(e.code === 'DESKTOP_TIMEOUT' ? failure('DESKTOP_UNAVAILABLE', 'Codex daemon 初始化超时') : e);
                }
            });
        });
    }
    request(method, params, timeout = this.timeout) {
        return new Promise((resolve, reject) => {
            const id = ++this.seq;
            const timer = setTimeout(() => { this.pending.delete(id); reject(failure('DESKTOP_TIMEOUT', '桌面端未及时确认，请先查看原会话，避免重复发送')); }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            try { this.ws.send(JSON.stringify({ id, method, params })); }
            catch { clearTimeout(timer); this.pending.delete(id); reject(failure('DESKTOP_UNAVAILABLE', 'Codex daemon 连接已断开')); }
        });
    }
    rejectAll() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(failure('DESKTOP_UNAVAILABLE', 'Codex daemon 连接已断开')); } this.pending.clear(); }
    close() { try { this.ws?.terminate(); } catch { } this.rejectAll(); }
}

async function connection(run, timeout) { const client = new DaemonClient(timeout); await client.connect(); try { return await run(client); } finally { client.close(); } }
// notLoaded 表示 daemon 当前未加载这段会话 = 没有在运行
const runtimeStatus = thread => { const s = thread?.status || { type: 'notLoaded' }; return s.type === 'notLoaded' ? { type: 'idle' } : s; };
async function loaded(client, id) {
    const answer = await client.request('thread/resume', { threadId: id, excludeTurns: true }).catch(async e => {
        if (e.code !== 'DESKTOP_REJECTED')
            throw e;
        if (/already has an active writer/i.test(e.message)) {
            const shared = await desktopOnDaemon();
            throw failure('DESKTOP_UNAVAILABLE', shared === false
                ? '这段会话正被 ChatGPT 桌面端独占（桌面未接入共用 app-server daemon）。请在终端运行 ' + loginAgentCommand + ' 并完全退出重开 ChatGPT.app（Cmd+Q）后重试'
                : '这段会话正被另一个 Codex 进程独占，请先关闭占用该会话的 Codex 窗口或 CLI 后重试');
        }
        throw failure('DESKTOP_UNAVAILABLE', 'Codex 找不到这段会话：' + e.message);
    });
    return answer.thread;
}
async function latestTurn(client, id) { return (await client.request('thread/turns/list', { threadId: id, limit: 1, sortDirection: 'desc' })).data?.[0] || null; }
const text = value => [{ type: 'text', text: value, text_elements: [] }];

async function read(id) {
    return connection(async client => {
        const { thread } = await client.request('thread/read', { threadId: id, includeTurns: false });
        return { threadRuntimeStatus: runtimeStatus(thread), turns: [] };
    });
}
async function create(value, requestId = '', { model = '', cwd = '' } = {}) {
    return connection(async client => {
        const started = await client.request('thread/start', {
            ephemeral: false,
            ...(cwd ? { cwd } : {}),
            ...(model ? { model } : {})
        });
        const threadId = started?.thread?.id;
        if (!threadId)
            throw failure('DESKTOP_PROTOCOL', 'Codex daemon 未返回新会话标识');
        const result = await client.request('turn/start', {
            threadId,
            input: text(value),
            ...(requestId ? { clientUserMessageId: requestId } : {}),
            ...(model ? { model } : {})
        });
        return { id: threadId, path: started?.thread?.path || '', result };
    });
}
async function send(id, value, requestId, model = '') {
    return connection(async client => {
        const thread = await loaded(client, id);
        const turn = await latestTurn(client, id);
        if (runtimeStatus(thread).type === 'active' || RUNNING.includes(turn?.status))
            throw failure('DESKTOP_BUSY', '原会话正在运行，请等待当前回复结束');
        const result = await client.request('turn/start', { threadId: id, input: text(value), clientUserMessageId: requestId, ...(model ? { model } : {}) });
        return { result };
    });
}
async function steer(id, value, requestId) {
    return connection(async client => {
        await loaded(client, id);
        const turn = await latestTurn(client, id);
        if (!RUNNING.includes(turn?.status))
            throw failure('DESKTOP_IDLE', '这一轮已经结束，请直接发送');
        const result = await client.request('turn/steer', { threadId: id, input: text(value), clientUserMessageId: requestId, expectedTurnId: turn.id });
        return { result };
    });
}
async function available(timeout = 1500) {
    try {
        await connection(async () => true, timeout);
        return true;
    }
    catch {
        autostart();
        return false;
    }
}
// daemon 没跑时在后台拉起（仅真实 ~/.codex，测试用的 CODEX_HOME 不拉起），5 分钟最多一次
let lastStart = 0;
function autostart() {
    if (process.env.CODEX_HOME || process.env.TOOLS_CODEX_DAEMON_AUTOSTART === '0' || Date.now() - lastStart < 300000 || !fs.existsSync(CLI))
        return;
    lastStart = Date.now();
    execFile(CLI, ['app-server', 'daemon', 'start'], { timeout: 30000 }, () => { });
}
// 桌面端自己拉起的 stdio app-server 还在 = 桌面没接入 daemon，网页发出的消息桌面不会实时显示
function desktopOnDaemon() {
    return new Promise(resolve => execFile('/bin/ps', ['-axo', 'command='], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => {
        if (e)
            return resolve(null);
        const lines = String(out).split('\n');
        const desktop = lines.some(l => /ChatGPT\.app\/Contents\/MacOS\//.test(l));
        if (!desktop)
            return resolve(null);
        resolve(!lines.some(l => /CodexCLI\.app\/Contents\/MacOS\/codex .*app-server --analytics/.test(l)));
    }));
}
module.exports = { DaemonClient, socketPath, exists, read, create, send, steer, available, desktopOnDaemon, loginAgentCommand };
