// Codex Desktop's local, length-prefixed IPC. Protocol reference: Agent HUD
// (Apache-2.0), CodexDesktopIPC.swift / CodexDesktopPermissions.swift.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const socketPath = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'ipc/ipc.sock');
const failure = (code, message) => Object.assign(new Error(message), { code });
class DesktopIPC extends EventEmitter {
    constructor(file = socketPath(), timeout = 8000) {
        super();
        this.timeout = timeout;
        this.header = Buffer.alloc(4);
        this.headerBytes = 0;
        this.frame = null;
        this.frameBytes = 0;
        this.pending = new Map();
        const stat = fs.statSync(file);
        if (!stat.isSocket() || process.getuid && stat.uid !== process.getuid())
            throw failure('DESKTOP_UNAVAILABLE', 'Codex 桌面连接不可用');
        this.socket = net.createConnection(file);
        // Allocate each frame once. Repeated Buffer.concat makes large desktop
        // histories quadratic and can time out before the first snapshot arrives.
        this.socket.on('data', data => {
            let offset=0;
            while(offset<data.length){
                if(!this.frame){
                    const n=Math.min(4-this.headerBytes,data.length-offset);
                    data.copy(this.header,this.headerBytes,offset,offset+n);this.headerBytes+=n;offset+=n;
                    if(this.headerBytes<4)continue;
                    const size=this.header.readUInt32LE(0);this.headerBytes=0;
                    if(!size||size>256*1024*1024){this.close();return;}
                    this.frame=Buffer.allocUnsafe(size);this.frameBytes=0;
                }
                const n=Math.min(this.frame.length-this.frameBytes,data.length-offset);
                data.copy(this.frame,this.frameBytes,offset,offset+n);this.frameBytes+=n;offset+=n;
                if(this.frameBytes<this.frame.length)continue;
                const complete=this.frame;this.frame=null;this.frameBytes=0;
                let message;try{message=JSON.parse(complete.toString());}catch{this.close();return;}
                if(message.type==='client-discovery-request'){this.post({type:'client-discovery-response',requestId:message.requestId,response:{canHandle:false}});continue;}
                const pending=this.pending.get(message.requestId);
                if(message.type==='response'&&pending){clearTimeout(pending.timer);this.pending.delete(message.requestId);message.resultType==='success'?pending.resolve(message):pending.reject(failure('DESKTOP_REJECTED',String(message.error||'桌面端拒绝请求')));}
                else this.emit('message',message);
            }
        });
        this.socket.on('error', () => this.rejectAll());
        this.socket.on('close', () => this.rejectAll());
    }
    post(message) { const payload = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4); header.writeUInt32LE(payload.length); this.socket.write(Buffer.concat([header, payload])); }
    request(method, version, params, target) {
        return new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timer = setTimeout(() => { this.pending.delete(requestId); reject(failure('DESKTOP_TIMEOUT', '桌面端未及时确认，请先查看原会话，避免重复发送')); }, this.timeout);
            this.pending.set(requestId, { resolve, reject, timer });
            this.post({ type: 'request', requestId, sourceClientId: this.source || 'initializing-client', ...(target ? { targetClientId: target } : {}), version, method, params, timeoutMs: this.timeout });
        });
    }
    async initialize() { const answer = await this.request('initialize', 0, { clientType: 'dragon-tac' }); this.source = answer.result?.clientId; if (!this.source)
        throw failure('DESKTOP_PROTOCOL', '桌面连接协议不兼容'); }
    async owner(id) { const answer = await this.request('thread-owner-discovery', 1, { hostId: 'local', conversationId: id }); if (!answer.handledByClientId)
        throw failure('DESKTOP_UNAVAILABLE', '请先在 Codex 桌面打开这个会话'); return answer.handledByClientId; }
    async snapshot(id, owner) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.removeListener('message', read); reject(failure('DESKTOP_TIMEOUT', '桌面会话读取超时')); }, this.timeout);
            const read = message => {
                if (message.method !== 'thread-stream-state-changed' || message.sourceClientId !== owner || message.params?.conversationId !== id || message.params?.hostId !== 'local' || message.params?.change?.type !== 'snapshot')
                    return;
                clearTimeout(timer);
                this.removeListener('message', read);
                resolve(message.params.change.conversationState);
            };
            this.on('message', read);
            this.follow(id, owner, true);
        });
    }
    follow(id, owner, following) { this.post({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1, sourceClientId: this.source, targetClientIds: [owner], params: { hostId: 'local', conversationId: id, following } }); }
    rejectAll() { for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(failure('DESKTOP_UNAVAILABLE', 'Codex 桌面连接已断开'));
    } this.pending.clear(); }
    close() { this.socket.destroy(); this.rejectAll(); }
}
async function connection(run) { const ipc = new DesktopIPC(); try {
    await ipc.initialize();
    return await run(ipc);
}
finally {
    ipc.close();
} }
async function read(id) { return connection(async (ipc) => { const owner = await ipc.owner(id); try {
    return await ipc.snapshot(id, owner);
}
finally {
    ipc.follow(id, owner, false);
} }); }
async function send(id, text, requestId) {
    return connection(async (ipc) => {
        let owner;
        const originalTimeout = ipc.timeout;
        ipc.timeout = 1500;
        try {
            owner = await ipc.owner(id);
        }
        catch (error) {
            if (process.platform !== 'darwin' || !/^[a-f0-9-]{36}$/i.test(id))
                throw error;
            await new Promise((resolve, reject) => execFile('/usr/bin/open', ['-g', `codex://threads/${id}`], { timeout: 5000 }, e => e ? reject(failure('DESKTOP_UNAVAILABLE', '无法在 Codex 桌面打开原会话')) : resolve()));
            for (let n = 0; n < 4; n++) {
                await new Promise(r => setTimeout(r, 250));
                try {
                    owner = await ipc.owner(id);
                    break;
                }
                catch { }
            }
            if (!owner)
                throw failure('DESKTOP_UNAVAILABLE', 'Codex 尚未打开这段原生会话，请在桌面打开后重试');
        }
        finally {
            ipc.timeout = originalTimeout;
        }
        const state = await ipc.snapshot(id, owner);
        ipc.follow(id, owner, false);
        const turns = state.turns || [];
        if (state.threadRuntimeStatus?.type === 'active' || turns.some(t => ['inProgress', 'in_progress', 'running'].includes(t.status)))
            throw failure('DESKTOP_BUSY', '原会话正在运行，请等待当前回复结束');
        return ipc.request('thread-follower-start-turn', 2, { conversationId: id, turnStart: { request: { threadId: id, input: [{ type: 'text', text, text_elements: [] }], clientUserMessageId: requestId }, context: { inheritThreadSettings: true } } }, owner);
    });
}
// 引导：把消息并入正在运行的这一轮（与 Codex 桌面输入框运行中“引导”一致）；会话必须已在桌面打开且正在运行。
async function steer(id, text, requestId, cwd) {
    return connection(async (ipc) => {
        const owner = await ipc.owner(id);
        const state = await ipc.snapshot(id, owner);
        ipc.follow(id, owner, false);
        if (state.threadRuntimeStatus?.type !== 'active' && !(state.turns || []).some(t => ['inProgress', 'in_progress', 'running'].includes(t.status)))
            throw failure('DESKTOP_IDLE', '这一轮已经结束，请直接发送');
        const input = [{ type: 'text', text, text_elements: [] }];
        return ipc.request('thread-follower-steer-turn', 1, { conversationId: id, clientUserMessageId: requestId, input, attachments: [], restoreMessage: { id: requestId, text, cwd: cwd || null, context: { workspaceRoots: cwd ? [cwd] : [], collaborationMode: null, commentAttachments: [] } } }, owner);
    });
}
module.exports = { DesktopIPC, socketPath, read, send, steer };
