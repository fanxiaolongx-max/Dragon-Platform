// 内网桌面版共享对话互联（lan-share）：桌面版 + 公司内网时，把共享对话做成「每台电脑各自运行、经主共享者中转」的点对点共享。
//
// 只在桌面版启用（TOOLS_DESKTOP_RUNTIME=1，或测试用 LAN_SHARE=1）；内网判断复用 WeLink 的探测（welink-network.checkIntranet），
// 外网和基座服务器都不涉及。本机内网地址优先取 10.x.x.x，端口就是本机服务端口（默认 3030）。
//
// 模型（每台电脑一个节点，节点号 peer_id 持久保存）：
// - 共享链接 http://<主共享者内网IP>:<端口>/lan-share/<shareId>?t=<令牌>：shareId + 令牌唯一标识这个共享，
//   只有 IP 的话，对方重启换了 IP、这个 IP 被别人的电脑占用时，请求会落到别人的电脑上——那边查不到 shareId+令牌，直接拒绝。
// - 每个节点在自己的控制库里有一份完整的共享对话（复用 shared_conversations / members / messages 中转表）：
//   主共享者就是原来的发起者；加入者在本机建一份本地共享（owner = lan:<发起者节点>），本机界面、推拉、实时围观全部照旧。
// - 所有交互统一经「当前主持节点」（host）：成员把自己的新消息 POST /append 给主持，主持写入中转表后通过长连接 /live
//   通知所有成员拉取（GET /log）；实时流（正在生成的回答）同样 POST /stream 给主持，由主持分发给其他成员。
//   长连接断开时，成员每次心跳顺带拉取（HTTP 轮询兜底），所以只要对方开着本机服务端口就能互通。
// - 消息全局唯一键 origin = <写入节点>:<该节点中转序号>，各节点按 origin 去重，换主持后从头对账也不会重复。
// - 成员表（节点、账号、名字、地址、密钥摘要、加入顺序、在线状态）由主持统一管理并随心跳 / 长连接分发给所有成员。
// - 地址变化：主持发现自己 IP 变了，立即按已知地址通知所有成员（POST /host-changed），共享链接随之重新生成；
//   成员 IP 变了，下次心跳带上新地址，主持更新后分发。
// - 主持下线：成员连续 3 次心跳失败后按加入顺序选举——排在最前且在线的成员临时接任（term+1），通知其他成员改连它；
//   原发起者回来后先跟随临时主持把消息对齐，再以更高的 term 收回主持权。term 大者为准，相同 term 时加入顺序靠前者为准。
// - 鉴权：加入时校验链接令牌；之后每个请求带节点号 + 本节点密钥（x-lan-peer / x-lan-key），按成员表里的密钥摘要校验，
//   所以临时主持也能校验其他成员。移除成员会轮换令牌。只接受内网 / 本机地址发来的请求。
const crypto = require('crypto');
const os = require('os');
const { run, get, all } = require('./control-db');
const tenantContext = require('./tenant-context');
const shared = require('./shared-conversations');
const sharedLive = require('./shared-live');

const HEARTBEAT_MS = Math.max(200, Number(process.env.LAN_SHARE_HEARTBEAT_MS) || 10000);
const HOST_DOWN_AFTER = 3;
const OFFLINE_MS = HEARTBEAT_MS * 4;
const REQUEST_TIMEOUT_MS = Math.max(500, Number(process.env.LAN_SHARE_TIMEOUT_MS) || 5000);
const PROBE_TIMEOUT_MS = Math.min(2500, REQUEST_TIMEOUT_MS);
const LOG_PAGE = 200;
const MAX_ROW_CONTENT = 2 * 1024 * 1024;

const fail = (statusCode, code, message, extra = {}) => Object.assign(new Error(message), { statusCode, code, ...extra });
const sha = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const randomToken = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');
const now = () => Date.now();
const sleep = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); if (typeof t.unref === 'function') t.unref(); });
const pseudo = peerId => `lan:${peerId}`;
const peerOfAuthor = author => String(author || '').split(':')[1] || '';
function safeEqual(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// ── 网络：本机内网地址、端口、可用性 ──
function cleanIp(ip) { return String(ip || '').replace(/^::ffff:/i, '').trim(); }
function isPrivateIPv4(ip) {
    const parts = cleanIp(ip).split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}
function isLoopback(ip) { const value = cleanIp(ip); return value === '::1' || value.startsWith('127.'); }
function lanAddresses() {
    const list = [];
    for (const items of Object.values(os.networkInterfaces() || {})) {
        for (const item of items || []) {
            if (item && !item.internal && (item.family === 'IPv4' || item.family === 4) && isPrivateIPv4(item.address)) list.push(item.address);
        }
    }
    // 公司内网一般是 10.x.x.x；其次 172.16-31 / 192.168（家用路由器、虚拟网卡）
    const rank = ip => (ip.startsWith('10.') ? 0 : ip.startsWith('172.') ? 1 : 2);
    return [...new Set(list)].sort((a, b) => rank(a) - rank(b));
}
function selfAddress() { return cleanIp(process.env.LAN_SHARE_ADDRESS) || lanAddresses()[0] || ''; }
function selfPort() { return Number(process.env.PORT) || 3030; }
function selfUrl() { const address = selfAddress(); return address ? `http://${address}:${selfPort()}` : ''; }
function enabled() {
    if (process.env.LAN_SHARE === '0' || process.env.LAN_SHARE === 'false') return false;
    return process.env.TOOLS_DESKTOP_RUNTIME === '1' || process.env.LAN_SHARE === '1' || process.env.LAN_SHARE === 'true';
}
/** 桌面版 + 内网 + 有内网地址才可用；返回 { available, reason?, hint?, address, port, url } */
async function availability({ refresh = false } = {}) {
    const address = selfAddress();
    const base = { address, port: selfPort(), url: selfUrl() };
    if (!enabled()) return { ...base, available: false, reason: 'NOT_DESKTOP', hint: '内网直连共享仅在桌面版中可用' };
    if (!address) return { ...base, available: false, reason: 'NO_LAN_ADDRESS', hint: '没有检测到本机内网 IP（10.x.x.x），请确认已连接公司内网' };
    const forced = process.env.LAN_SHARE === '1' || process.env.LAN_SHARE === 'true';
    const net = forced ? { intranet: true } : await require('./channels/welink-network').checkIntranet({ refresh }).catch(() => ({ intranet: false }));
    if (!net.intranet) return { ...base, available: false, reason: 'EXTRANET', hint: '当前不在公司内网，内网直连共享不可用' };
    return { ...base, available: true };
}
/** 只接受内网 / 本机地址发来的节点请求 */
function requestAllowed(req) {
    const ip = cleanIp(req.socket?.remoteAddress || req.ip || '');
    return isLoopback(ip) || isPrivateIPv4(ip);
}

// ── 存储（平台控制库） ──
let readyPromise = null;
function ensureReady() {
    if (!readyPromise) {
        readyPromise = (async () => {
            await shared.ensureReady();
            await run('CREATE TABLE IF NOT EXISTS lan_node (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT \'\')');
            await run(`CREATE TABLE IF NOT EXISTS lan_shares (
                share_id TEXT PRIMARY KEY,
                role TEXT NOT NULL DEFAULT 'peer',
                status TEXT NOT NULL DEFAULT 'active',
                token TEXT NOT NULL DEFAULT '',
                term INTEGER NOT NULL DEFAULT 1,
                host_peer_id TEXT NOT NULL DEFAULT '',
                host_url TEXT NOT NULL DEFAULT '',
                origin_peer_id TEXT NOT NULL DEFAULT '',
                self_key TEXT NOT NULL DEFAULT '',
                local_username TEXT NOT NULL DEFAULT '',
                local_tenant TEXT NOT NULL DEFAULT 'default',
                local_session_id TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                forwarded_seq INTEGER NOT NULL DEFAULT 0,
                pulled_host_seq INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            await run(`CREATE TABLE IF NOT EXISTS lan_share_members (
                share_id TEXT NOT NULL,
                peer_id TEXT NOT NULL,
                username TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                key_hash TEXT NOT NULL DEFAULT '',
                join_order INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                last_seen INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (share_id, peer_id)
            )`);
            // 从其他节点收进中转表的消息：全局键 origin → 本机中转序号（去重 + 导出时还原 origin）
            await run(`CREATE TABLE IF NOT EXISTS lan_share_log (
                share_id TEXT NOT NULL,
                origin TEXT NOT NULL,
                local_seq INTEGER NOT NULL,
                PRIMARY KEY (share_id, origin)
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_lan_share_log_seq ON lan_share_log(share_id, local_seq)');
            await run('CREATE INDEX IF NOT EXISTS idx_lan_shares_local ON lan_shares(local_tenant, local_username, local_session_id)');
            const rows = await all('SELECT peer_id, name FROM lan_share_members');
            for (const row of rows) if (row.name) names.set(row.peer_id, row.name);
        })().catch(error => { readyPromise = null; throw error; });
    }
    return readyPromise;
}

let selfIdCache = '';
async function selfPeerId() {
    if (selfIdCache) return selfIdCache;
    await ensureReady();
    const row = await get("SELECT value FROM lan_node WHERE key = 'peer_id'");
    if (row?.value) return (selfIdCache = row.value);
    const id = `pc_${randomToken(9)}`;
    await run("INSERT OR IGNORE INTO lan_node (key, value) VALUES ('peer_id', ?)", [id]);
    selfIdCache = (await get("SELECT value FROM lan_node WHERE key = 'peer_id'"))?.value || id;
    return selfIdCache;
}

const names = new Map(); // peer_id → 显示名（shared-conversations 的 displayNames 用）
/** lan:<节点>[:<账号>] → 显示名；不认识返回空串 */
function displayName(value) {
    const peerId = peerOfAuthor(value);
    return peerId ? names.get(peerId) || '' : '';
}

async function getLan(shareId) {
    await ensureReady();
    return get('SELECT * FROM lan_shares WHERE share_id = ?', [String(shareId || '')]);
}
async function listMembers(shareId) {
    return all('SELECT * FROM lan_share_members WHERE share_id = ? ORDER BY join_order ASC, peer_id ASC', [String(shareId || '')]);
}
async function localUserName(username) {
    try {
        const { items } = await require('./auth-users-repository').listUsers();
        return items?.[username]?.displayName || username;
    } catch { return username; }
}

// ── 进程内互斥 ──
const locks = new Map();
function withLock(key, task) {
    const previous = locks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    const tail = next.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return next;
}

// ── 状态：主持分发给成员的共享信息 ──
function publicMember(row, hostPeerId) {
    return {
        peerId: row.peer_id, username: row.username, name: row.name, url: row.url, keyHash: row.key_hash,
        joinOrder: Number(row.join_order) || 0, status: row.status, lastSeen: Number(row.last_seen) || 0, host: row.peer_id === hostPeerId
    };
}
async function stateOf(lan) {
    const members = await listMembers(lan.share_id);
    return {
        shareId: lan.share_id, title: lan.title, status: lan.status, term: Number(lan.term) || 1,
        hostPeerId: lan.host_peer_id, hostUrl: lan.host_url, originPeerId: lan.origin_peer_id, token: lan.token,
        members: members.map(row => publicMember(row, lan.host_peer_id))
    };
}
function linkOf(lan) {
    return lan.host_url && lan.token ? `${lan.host_url}/lan-share/${encodeURIComponent(lan.share_id)}?t=${encodeURIComponent(lan.token)}` : '';
}
function joinOrderOf(members, peerId) {
    const row = members.find(item => (item.peer_id || item.peerId) === peerId);
    return row ? Number(row.join_order ?? row.joinOrder) || 0 : Number.MAX_SAFE_INTEGER;
}

/** 同步本机共享成员表里的远端成员（lan:<节点>），侧栏 / 成员条据此显示人数与名字 */
async function syncPseudoMembers(lan, members) {
    const self = await selfPeerId();
    for (const member of members) {
        const peerId = member.peer_id || member.peerId;
        if (!peerId || peerId === self) continue;
        if (member.name) names.set(peerId, member.name);
        const status = member.status === 'active' ? 'accepted' : 'removed';
        const role = peerId === lan.origin_peer_id ? 'owner' : 'member';
        await run(`INSERT INTO shared_conversation_members (share_id, username, tenant_id, local_session_id, role, status, invited_by, via, invited_at, responded_at)
            VALUES (?, ?, '', '', ?, ?, ?, 'lan', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(share_id, username) DO UPDATE SET status = excluded.status, role = excluded.role, via = 'lan'`,
        [lan.share_id, pseudo(peerId), role, status, pseudo(lan.origin_peer_id)]);
    }
}

async function upsertMember(shareId, member) {
    await run(`INSERT INTO lan_share_members (share_id, peer_id, username, name, url, key_hash, join_order, status, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(share_id, peer_id) DO UPDATE SET username = excluded.username, name = excluded.name, url = excluded.url,
            key_hash = CASE WHEN excluded.key_hash <> '' THEN excluded.key_hash ELSE lan_share_members.key_hash END,
            join_order = excluded.join_order, status = excluded.status, last_seen = MAX(lan_share_members.last_seen, excluded.last_seen)`,
    [shareId, member.peerId, String(member.username || '').slice(0, 120), String(member.name || '').slice(0, 120), String(member.url || '').slice(0, 200),
        String(member.keyHash || ''), Number(member.joinOrder) || 0, member.status || 'active', Number(member.lastSeen) || 0]);
    if (member.name) names.set(member.peerId, member.name);
}

/** 成员收到主持分发的状态：term 不比本机旧才采用 */
async function applyState(shareId, state) {
    if (!state || state.shareId !== shareId) return null;
    return withLock(`state:${shareId}`, async () => {
        const lan = await getLan(shareId);
        if (!lan || lan.status !== 'active') return lan;
        if ((Number(state.term) || 0) < (Number(lan.term) || 0)) return lan;
        if (state.status === 'closed') { await closeLocal(shareId, 'closed'); return getLan(shareId); }
        const self = await selfPeerId();
        if (state.hostPeerId === self && lan.role !== 'host') return lan; // 别人以为我是主持：等 /host-changed
        await run(`UPDATE lan_shares SET term = ?, host_peer_id = ?, host_url = ?, origin_peer_id = ?, token = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE share_id = ?`,
            [Number(state.term) || lan.term, state.hostPeerId || lan.host_peer_id, state.hostUrl || lan.host_url, state.originPeerId || lan.origin_peer_id,
                state.token || lan.token, String(state.title || lan.title).slice(0, 160), shareId]);
        const known = new Set();
        for (const member of Array.isArray(state.members) ? state.members.slice(0, 300) : []) {
            if (!member?.peerId) continue;
            known.add(member.peerId);
            const existing = await get('SELECT key_hash FROM lan_share_members WHERE share_id = ? AND peer_id = ?', [shareId, member.peerId]);
            // 自己的密钥摘要以本机为准（防止被改写后自己通不过校验）
            if (member.peerId === self && existing?.key_hash) member.keyHash = existing.key_hash;
            await upsertMember(shareId, member);
        }
        if (known.size) {
            const rows = await listMembers(shareId);
            for (const row of rows) if (!known.has(row.peer_id) && row.status === 'active') await run("UPDATE lan_share_members SET status = 'removed' WHERE share_id = ? AND peer_id = ?", [shareId, row.peer_id]);
        }
        const fresh = await getLan(shareId);
        await syncPseudoMembers(fresh, await listMembers(shareId));
        if (fresh.title && fresh.title !== lan.title) await run('UPDATE shared_conversations SET title = ? WHERE id = ?', [fresh.title, shareId]).catch(() => {});
        return fresh;
    });
}

// ── 中转表：导出 / 收录 ──
function parseRowEvents(raw) {
    try { const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : []; } catch { return []; }
}
async function exportRows(lan, rows, { includeRemote = true } = {}) {
    if (!rows.length) return [];
    const self = await selfPeerId();
    const seqs = rows.map(row => row.seq);
    const origins = new Map((await all(`SELECT origin, local_seq FROM lan_share_log WHERE share_id = ? AND local_seq IN (${seqs.map(() => '?').join(',')})`, [lan.share_id, ...seqs]))
        .map(row => [row.local_seq, row.origin]));
    const out = [];
    for (const row of rows) {
        const origin = origins.get(row.seq);
        if (origin && !includeRemote) continue;
        const author = String(row.author || '');
        out.push({
            seq: row.seq,
            origin: origin || `${self}:${row.seq}`,
            author: author.startsWith('lan:') ? author : `lan:${self}:${author}`,
            authorName: row.author_name || author,
            role: row.role === 'model' ? 'model' : 'user',
            content: String(row.content || ''),
            // 文件路径只在原电脑上有效：不带共享附件清单，正文与过程事件照常同步
            events: parseRowEvents(row.events).filter(event => event && event.type !== 'shared_files' && event.type !== 'shared_author'),
            modelName: row.model_name || '',
            createdAt: row.created_at || ''
        });
    }
    return out;
}
async function exportLog(lan, after = 0) {
    const rows = await all('SELECT * FROM shared_conversation_messages WHERE share_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?', [lan.share_id, Number(after) || 0, LOG_PAGE]);
    return { rows: await exportRows(lan, rows), last: rows.length ? rows[rows.length - 1].seq : Number(after) || 0, more: rows.length === LOG_PAGE };
}

/** 收录其他节点的消息（按 origin 去重）；返回新收录条数 */
async function ingest(shareId, rows) {
    const list = Array.isArray(rows) ? rows.slice(0, 500) : [];
    if (!list.length) return 0;
    const self = await selfPeerId();
    const count = await withLock(`log:${shareId}`, async () => {
        let added = 0;
        for (const row of list) {
            const origin = String(row?.origin || '');
            const author = String(row?.author || '');
            if (!/^[\w-]{3,40}:\d+$/.test(origin) || origin.startsWith(`${self}:`)) continue;
            if (!author.startsWith('lan:') || peerOfAuthor(author) === self) continue;
            if (await get('SELECT 1 FROM lan_share_log WHERE share_id = ? AND origin = ?', [shareId, origin])) continue;
            const events = Array.isArray(row.events) ? row.events.filter(event => event && typeof event === 'object' && event.type !== 'shared_author' && event.type !== 'shared_files').slice(0, 400) : [];
            const result = await run(`INSERT INTO shared_conversation_messages (share_id, author, author_name, role, content, events, model_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP))`,
            [shareId, author.slice(0, 200), String(row.authorName || author).slice(0, 120), row.role === 'model' ? 'model' : 'user',
                String(row.content || '').slice(0, MAX_ROW_CONTENT), JSON.stringify(events), String(row.modelName || '').slice(0, 120), String(row.createdAt || '').slice(0, 40)]);
            await run('INSERT OR IGNORE INTO lan_share_log (share_id, origin, local_seq) VALUES (?, ?, ?)', [shareId, origin, result.lastID]);
            if (row.authorName) names.set(peerOfAuthor(author), names.get(peerOfAuthor(author)) || String(row.authorName).slice(0, 120));
            added += 1;
        }
        return added;
    });
    if (count) {
        await run('UPDATE shared_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [shareId]).catch(() => {});
        try { shared.shareEvents.emit('appended', { shareId, lan: true }); } catch { /* ignore */ }
        syncLocalMembers(shareId);
    }
    return count;
}

/** 新消息进了中转表：本机参与这个共享的账号把它拉进各自的本地对话（侧栏未读、后台保存） */
function syncLocalMembers(shareId) {
    all("SELECT tenant_id, username, local_session_id FROM shared_conversation_members WHERE share_id = ? AND status = 'accepted' AND local_session_id <> '' AND username NOT LIKE 'lan:%'", [shareId])
        .then(rows => Promise.all(rows.map(row => tenantContext.runWithTenant(row.tenant_id || tenantContext.DEFAULT_TENANT_ID,
            () => shared.syncLocal({ tenantId: row.tenant_id, username: row.username, sessionId: row.local_session_id })).catch(() => null))))
        .catch(error => console.warn('[lan-share] local sync failed:', error.message));
}

// ── 节点间 HTTP ──
async function call(baseUrl, shareId, path, { method = 'GET', body, lan, headers = {}, timeout = REQUEST_TIMEOUT_MS } = {}) {
    if (!/^http:\/\/[\w.-]+(?::\d+)?$/.test(String(baseUrl || ''))) throw fail(400, 'LAN_BAD_URL', '对方地址无效');
    const self = await selfPeerId();
    const res = await fetch(`${baseUrl}/api/lan-peer/${encodeURIComponent(shareId)}${path}`, {
        method,
        headers: {
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(lan ? { 'x-lan-peer': self, 'x-lan-key': lan.self_key, 'x-lan-token': lan.token } : {}),
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(res.status, data.code || 'LAN_PEER_FAILED', data.error || `HTTP ${res.status}`, { body: data });
    return data;
}

// ── 节点运行时：每个进行中的内网共享一个 ──
const nodes = new Map(); // shareId → { timer, failures, ticks, live, reclaim, forwardAll, hostListener, peerListener }
const streams = new Map(); // shareId → Map(peerId → send)：主持端连进来的成员长连接
const outboxes = new Map(); // shareId → { chain, open }
let suppressRevoked = 0;

/** 结束主持端所有成员长连接（event：结束前最后发一条，如 moved） */
function endStreams(shareId, event = null) {
    const map = streams.get(shareId);
    streams.delete(shareId);
    if (!map) return;
    for (const send of map.values()) { if (event) send(event); send.close?.(); }
}
function broadcast(shareId, event, exceptPeer = '') {
    const map = streams.get(shareId);
    if (!map) return;
    for (const [peerId, send] of map) if (peerId !== exceptPeer) send(event);
}
async function broadcastState(lan) {
    const fresh = await getLan(lan.share_id);
    if (fresh?.role === 'host') broadcast(lan.share_id, { type: 'state', state: await stateOf(fresh) });
}

function nodeOf(shareId) {
    if (!nodes.has(shareId)) nodes.set(shareId, { role: '', timer: null, failures: 0, ticks: 0, live: null, reclaim: false, forwardAll: false, hostListener: null, peerListener: null, sig: '', busy: false });
    return nodes.get(shareId);
}

function attachHostListener(shareId) {
    const node = nodeOf(shareId);
    if (node.hostListener) return;
    node.hostListener = event => {
        if (!event || event.type === 'ping' || event.type === 'revoked') return;
        const by = String(event.by || '');
        if (!by) return;
        if (by.startsWith('lan:')) broadcast(shareId, { type: 'stream', event }, peerOfAuthor(by));
        else selfPeerId().then(self => broadcast(shareId, { type: 'stream', event: { ...event, by: `lan:${self}:${by}` } }));
    };
    sharedLive.hub.on(sharedLive.channel(shareId), node.hostListener);
}
function detachHostListener(shareId) {
    const node = nodes.get(shareId);
    if (node?.hostListener) sharedLive.hub.off(sharedLive.channel(shareId), node.hostListener);
    if (node) node.hostListener = null;
}
// 成员端：本机账号这一轮的实时事件按顺序转给主持（和消息推送共用一条队列，保证「先消息、后结束」）
function attachPeerListener(shareId) {
    const node = nodeOf(shareId);
    if (node.peerListener) return;
    node.peerListener = event => {
        if (!event || event.type === 'ping' || event.type === 'revoked') return;
        const by = String(event.by || '');
        if (!by || by.startsWith('lan:')) return;
        queueEvent(shareId, event);
    };
    sharedLive.hub.on(sharedLive.channel(shareId), node.peerListener);
}
function detachPeerListener(shareId) {
    const node = nodes.get(shareId);
    if (node?.peerListener) sharedLive.hub.off(sharedLive.channel(shareId), node.peerListener);
    if (node) node.peerListener = null;
}

function outboxOf(shareId) {
    if (!outboxes.has(shareId)) outboxes.set(shareId, { chain: Promise.resolve(), open: null });
    return outboxes.get(shareId);
}
function queueTask(shareId, task) {
    const box = outboxOf(shareId);
    box.open = null;
    box.chain = box.chain.then(task).catch(error => { if (process.env.LAN_SHARE_DEBUG) console.warn('[lan-share] task failed:', error.message); });
    return box.chain;
}
function queueEvent(shareId, event) {
    const box = outboxOf(shareId);
    if (box.open) { box.open.push(event); return; }
    const batch = [event];
    box.open = batch;
    box.chain = box.chain.then(async () => {
        await sleep(60);
        if (box.open === batch) box.open = null;
        const lan = await getLan(shareId);
        if (!lan || lan.status !== 'active' || lan.role !== 'peer') return;
        const self = await selfPeerId();
        const events = batch.map(item => ({ ...item, by: `lan:${self}:${item.by}` }));
        await call(lan.host_url, shareId, '/stream', { method: 'POST', body: { events }, lan }).catch(() => {});
    }).catch(() => {});
}

/** 成员端：把本机写入中转表、还没交给主持的消息交给主持（all：换主持时连同收录的别人消息一起对账） */
async function forward(lan, { all: everything = false } = {}) {
    let after = everything ? 0 : Number(lan.forwarded_seq) || 0;
    for (let page = 0; page < 50; page += 1) {
        const rows = await all('SELECT * FROM shared_conversation_messages WHERE share_id = ? AND seq > ? ORDER BY seq ASC LIMIT 100', [lan.share_id, after]);
        if (!rows.length) break;
        const out = await exportRows(lan, rows, { includeRemote: everything });
        if (out.length) await call(lan.host_url, lan.share_id, '/append', { method: 'POST', body: { rows: out }, lan, timeout: REQUEST_TIMEOUT_MS * 3 });
        after = rows[rows.length - 1].seq;
        if (!everything || after > (Number(lan.forwarded_seq) || 0)) await run('UPDATE lan_shares SET forwarded_seq = MAX(forwarded_seq, ?) WHERE share_id = ?', [after, lan.share_id]);
        if (rows.length < 100) break;
    }
}
/** 成员端：从主持拉取新消息 */
async function pull(lan) {
    let after = Number(lan.pulled_host_seq) || 0;
    let total = 0;
    for (let page = 0; page < 50; page += 1) {
        const data = await call(lan.host_url, lan.share_id, `/log?after=${after}`, { lan, timeout: REQUEST_TIMEOUT_MS * 3 });
        total += await ingest(lan.share_id, data.rows);
        if (Number(data.last) > after) {
            after = Number(data.last);
            await run('UPDATE lan_shares SET pulled_host_seq = MAX(pulled_host_seq, ?) WHERE share_id = ?', [after, lan.share_id]);
        }
        if (!data.more) break;
    }
    return total;
}

async function announceHost(lan) {
    const self = await selfPeerId();
    const members = (await listMembers(lan.share_id)).filter(row => row.peer_id !== self && row.status === 'active' && row.url);
    const body = { term: Number(lan.term) || 1, hostPeerId: self, hostUrl: lan.host_url };
    await Promise.all(members.map(row => call(row.url, lan.share_id, '/host-changed', { method: 'POST', body, lan, timeout: PROBE_TIMEOUT_MS }).catch(() => null)));
    broadcast(lan.share_id, { type: 'moved', state: await stateOf(lan) });
}

async function becomeHost(shareId, term) {
    const self = await selfPeerId();
    const url = selfUrl();
    await run("UPDATE lan_shares SET role = 'host', term = ?, host_peer_id = ?, host_url = ?, updated_at = CURRENT_TIMESTAMP WHERE share_id = ?", [term, self, url, shareId]);
    await run('UPDATE lan_share_members SET url = ?, last_seen = ?, status = \'active\' WHERE share_id = ? AND peer_id = ?', [url, now(), shareId, self]);
    const node = nodeOf(shareId);
    node.role = 'host';
    node.failures = 0;
    node.reclaim = false;
    stopLive(shareId);
    detachPeerListener(shareId);
    attachHostListener(shareId);
    sharedLive.clearRemote(shareId);
    const lan = await getLan(shareId);
    console.log(`[lan-share] ${shareId} 由本机主持（term ${term}）`);
    await announceHost(lan);
    return lan;
}

/** 改为跟随另一个主持（被更高 term 的主持取代、主持换了地址、或选举出的临时主持） */
async function adoptHost(shareId, { term, hostPeerId, hostUrl }) {
    const lan = await getLan(shareId);
    if (!lan || !hostPeerId || !hostUrl) return lan;
    const self = await selfPeerId();
    const wasHost = lan.role === 'host';
    const changedHost = hostPeerId !== lan.host_peer_id;
    await run(`UPDATE lan_shares SET role = 'peer', term = ?, host_peer_id = ?, host_url = ?,
        forwarded_seq = CASE WHEN ? THEN 0 ELSE forwarded_seq END, pulled_host_seq = CASE WHEN ? THEN 0 ELSE pulled_host_seq END, updated_at = CURRENT_TIMESTAMP WHERE share_id = ?`,
    [Math.max(Number(term) || 0, Number(lan.term) || 0), hostPeerId, hostUrl, changedHost ? 1 : 0, changedHost ? 1 : 0, shareId]);
    const node = nodeOf(shareId);
    node.role = 'peer';
    node.failures = 0;
    if (wasHost) {
        detachHostListener(shareId);
        node.forwardAll = true; // 卸任：把本机收录的全部消息交给新主持对账
        if (lan.origin_peer_id === self) node.reclaim = true; // 原发起者：对齐后收回主持
        endStreams(shareId, { type: 'moved', state: { term, hostPeerId, hostUrl } });
        console.log(`[lan-share] ${shareId} 改由 ${hostPeerId} 主持（term ${term}）`);
    }
    if (changedHost || wasHost || hostUrl !== lan.host_url) stopLive(shareId);
    attachPeerListener(shareId);
    schedule(shareId, 50);
    return getLan(shareId);
}

/** 主持下线：按加入顺序找第一个还在线的成员接任；轮到自己就接任 */
async function elect(lan) {
    const self = await selfPeerId();
    const members = (await listMembers(lan.share_id)).filter(row => row.status === 'active' && row.peer_id !== lan.host_peer_id);
    for (const row of members) {
        if (row.peer_id === self) { await becomeHost(lan.share_id, (Number(lan.term) || 1) + 1); return; }
        if (!row.url) continue;
        try {
            const state = await call(row.url, lan.share_id, '/state', { lan, timeout: PROBE_TIMEOUT_MS });
            if (state.hostPeerId && state.hostUrl && ((Number(state.term) || 0) > (Number(lan.term) || 0) || state.hostUrl !== lan.host_url)) {
                await adoptHost(lan.share_id, state);
            }
            return; // 排在前面的成员在线：由它接任，等它通知
        } catch { /* 不在线，看下一位 */ }
    }
}

/** 主持端：探测其他成员，发现更高 term（或同 term 加入更早）的主持就让位；反之通知对方 */
async function resolveSplit(lan) {
    const self = await selfPeerId();
    const members = await listMembers(lan.share_id);
    const others = members.filter(row => row.peer_id !== self && row.status === 'active' && row.url);
    const states = await Promise.all(others.map(row => call(row.url, lan.share_id, '/state', { lan, timeout: PROBE_TIMEOUT_MS }).catch(() => null)));
    for (const state of states) {
        if (!state || state.role !== 'host' || state.hostPeerId === self) continue;
        const theirs = Number(state.term) || 0;
        const mine = Number(lan.term) || 0;
        if (theirs > mine || (theirs === mine && joinOrderOf(members, state.hostPeerId) < joinOrderOf(members, self))) {
            await adoptHost(lan.share_id, state);
            return true;
        }
        const target = others.find(row => row.peer_id === state.hostPeerId);
        if (target) call(target.url, lan.share_id, '/host-changed', { method: 'POST', body: { term: mine, hostPeerId: self, hostUrl: lan.host_url }, lan, timeout: PROBE_TIMEOUT_MS }).catch(() => null);
    }
    return false;
}

async function hostTick(lan) {
    const node = nodeOf(lan.share_id);
    const self = await selfPeerId();
    attachHostListener(lan.share_id);
    detachPeerListener(lan.share_id);
    const url = selfUrl();
    if (url && url !== lan.host_url) {
        // 本机 IP 变了：更新共享链接并按已知地址通知所有成员
        await run('UPDATE lan_shares SET host_url = ?, updated_at = CURRENT_TIMESTAMP WHERE share_id = ?', [url, lan.share_id]);
        lan = await getLan(lan.share_id);
        console.log(`[lan-share] ${lan.share_id} 本机地址变为 ${url}，通知成员`);
        await announceHost(lan);
    }
    await run('UPDATE lan_share_members SET last_seen = ?, url = ? WHERE share_id = ? AND peer_id = ?', [now(), lan.host_url, lan.share_id, self]);
    node.ticks += 1;
    if (node.ticks % 3 === 1 && await resolveSplit(lan)) return;
    const members = await listMembers(lan.share_id);
    const sig = JSON.stringify(members.map(row => [row.peer_id, row.url, row.status, now() - row.last_seen < OFFLINE_MS]));
    if (sig !== node.sig) { node.sig = sig; await broadcastState(lan); }
}

async function peerTick(lan) {
    const node = nodeOf(lan.share_id);
    const self = await selfPeerId();
    attachPeerListener(lan.share_id);
    detachHostListener(lan.share_id);
    try {
        const state = await call(lan.host_url, lan.share_id, '/heartbeat', {
            method: 'POST', body: { url: selfUrl(), name: names.get(self) || await localUserName(lan.local_username), username: lan.local_username }, lan
        });
        node.failures = 0;
        lan = await applyState(lan.share_id, state) || lan;
        if (lan.status !== 'active' || lan.role !== 'peer') return;
        connectLive(lan.share_id);
        if (node.forwardAll) { await forward(lan, { all: true }); node.forwardAll = false; lan = await getLan(lan.share_id); }
        await queueTask(lan.share_id, async () => forward(await getLan(lan.share_id)));
        await pull(await getLan(lan.share_id));
        if (node.reclaim && lan.origin_peer_id === self) await becomeHost(lan.share_id, (Number((await getLan(lan.share_id)).term) || 1) + 1);
    } catch (error) {
        if (error.code === 'LAN_NOT_HOST' && error.body?.state?.hostUrl) { await adoptHost(lan.share_id, error.body.state); return; }
        if (error.code === 'LAN_REMOVED') { await closeLocal(lan.share_id, 'removed'); return; }
        if (error.code === 'LAN_CLOSED') { await closeLocal(lan.share_id, 'closed'); return; }
        node.failures += 1;
        if (node.failures >= HOST_DOWN_AFTER) await elect(lan);
    }
}

async function tick(shareId) {
    const node = nodeOf(shareId);
    if (node.busy) return;
    node.busy = true;
    try {
        const lan = await getLan(shareId);
        if (!lan || lan.status !== 'active') { stopNode(shareId); return; }
        if (!names.get(await selfPeerId())) names.set(await selfPeerId(), await localUserName(lan.local_username));
        node.role = lan.role;
        if (lan.role === 'host') await hostTick(lan);
        else await peerTick(lan);
    } catch (error) {
        if (process.env.LAN_SHARE_DEBUG) console.warn('[lan-share] tick failed:', error.message);
    } finally {
        node.busy = false;
        if (nodes.has(shareId)) schedule(shareId);
    }
}
function schedule(shareId, delay = HEARTBEAT_MS) {
    const node = nodeOf(shareId);
    clearTimeout(node.timer);
    node.timer = setTimeout(() => tick(shareId), delay);
    if (typeof node.timer.unref === 'function') node.timer.unref();
}
function startNode(shareId, role = '') {
    if (!enabled()) return;
    const fresh = !nodes.has(shareId);
    const node = nodeOf(shareId);
    if (role) node.role = role;
    if (fresh) schedule(shareId, 30);
}
function stopNode(shareId) {
    const node = nodes.get(shareId);
    if (!node) return;
    clearTimeout(node.timer);
    stopLive(shareId);
    detachHostListener(shareId);
    detachPeerListener(shareId);
    endStreams(shareId);
    nodes.delete(shareId);
    sharedLive.clearRemote(shareId);
}

// ── 成员端长连接：主持推送 state / log / stream / moved / closed / removed ──
function stopLive(shareId) {
    const node = nodes.get(shareId);
    if (node?.live) { try { node.live.abort(); } catch { /* ignore */ } node.live = null; }
}
function connectLive(shareId) {
    const node = nodeOf(shareId);
    if (node.live) return;
    const controller = new AbortController();
    node.live = controller;
    (async () => {
        const lan = await getLan(shareId);
        if (!lan || lan.role !== 'peer') return;
        const self = await selfPeerId();
        const res = await fetch(`${lan.host_url}/api/lan-peer/${encodeURIComponent(shareId)}/live`, {
            headers: { Accept: 'application/x-ndjson', 'x-lan-peer': self, 'x-lan-key': lan.self_key, 'x-lan-token': lan.token },
            signal: controller.signal
        });
        if (!res.ok || !res.body) return;
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                let event;
                try { event = JSON.parse(line); } catch { continue; }
                await handleLiveEvent(shareId, event).catch(error => { if (process.env.LAN_SHARE_DEBUG) console.warn('[lan-share] live event failed:', error.message); });
            }
        }
    })().catch(() => {}).finally(() => {
        if (node.live === controller) node.live = null;
        sharedLive.clearRemote(shareId);
    });
}
async function handleLiveEvent(shareId, event) {
    const self = await selfPeerId();
    switch (event?.type) {
    case 'hello':
        await applyState(shareId, event.state);
        for (const turn of Array.isArray(event.turns) ? event.turns : []) sharedLive.ingestRemote(shareId, { ...turn, type: 'catchup' });
        await pull(await getLan(shareId)).catch(() => {});
        break;
    case 'state':
        await applyState(shareId, event.state);
        break;
    case 'log':
        await pull(await getLan(shareId));
        break;
    case 'stream':
        if (peerOfAuthor(event.event?.by) !== self) sharedLive.ingestRemote(shareId, event.event);
        break;
    case 'moved':
        if (event.state?.hostPeerId && event.state.hostPeerId !== self) await adoptHost(shareId, event.state);
        stopLive(shareId);
        break;
    case 'closed':
        await closeLocal(shareId, 'closed');
        break;
    case 'removed':
        await closeLocal(shareId, 'removed');
        break;
    default:
    }
}

/** 本机这份内网共享被主持关闭 / 本机被移出：收回本地副本（和服务器内共享「发起者停止共享」一致） */
async function closeLocal(shareId, reason = 'closed') {
    const lan = await getLan(shareId);
    if (!lan) return;
    const self = await selfPeerId();
    if (lan.origin_peer_id === self) return; // 发起者本机的共享不因别人而关闭
    await run('UPDATE lan_shares SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE share_id = ?', [reason, shareId]);
    stopNode(shareId);
    await run("UPDATE shared_conversations SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [shareId]);
    await run("UPDATE shared_conversation_members SET status = 'removed', responded_at = CURRENT_TIMESTAMP WHERE share_id = ? AND status IN ('accepted', 'pending')", [shareId]);
    shared._resetCache();
    suppressRevoked += 1;
    try { shared.shareEvents.emit('revoked', { shareId, username: '' }); } finally { suppressRevoked -= 1; }
}

// ── 本机界面：生成链接、加入、状态 ──
async function describeLan(lan) {
    if (!lan) return null;
    const self = await selfPeerId();
    const members = await listMembers(lan.share_id);
    const host = members.find(row => row.peer_id === lan.host_peer_id);
    return {
        shareId: lan.share_id,
        status: lan.status,
        role: lan.role,
        isHost: lan.role === 'host',
        isOrigin: lan.origin_peer_id === self,
        term: Number(lan.term) || 1,
        link: linkOf(lan),
        hostUrl: lan.host_url,
        hostName: host?.name || '',
        selfPeerId: self,
        selfUrl: selfUrl(),
        members: members.filter(row => row.status === 'active').map(row => ({
            peerId: row.peer_id, name: row.name || row.username, username: row.username, url: row.url, joinOrder: Number(row.join_order) || 0,
            host: row.peer_id === lan.host_peer_id, origin: row.peer_id === lan.origin_peer_id, self: row.peer_id === self,
            online: row.peer_id === self || row.peer_id === lan.host_peer_id ? true : now() - (Number(row.last_seen) || 0) < OFFLINE_MS
        }))
    };
}

async function lanForSession({ tenantId, username, sessionId }) {
    await ensureReady();
    const member = await get(`SELECT share_id FROM shared_conversation_members WHERE tenant_id = ? AND username = ? AND local_session_id = ? AND status = 'accepted'`,
        [tenantId, username, String(sessionId || '')]);
    const lan = member ? await getLan(member.share_id) : null;
    return lan && lan.status === 'active' ? lan : null;
}

async function sessionInfo({ tenantId, username, sessionId, refresh = false }) {
    const status = await availability({ refresh });
    const lan = await lanForSession({ tenantId, username, sessionId });
    return { ...status, available: status.available || Boolean(lan && enabled()), lan: await describeLan(lan) };
}

/** 发起（或拿到已有的）内网共享链接；本对话本身是别人共享过来的副本时，返回主持的链接 */
async function ensureHostLink({ tenantId, username, sessionId, title }) {
    const status = await availability({ refresh: true });
    const existing = await lanForSession({ tenantId, username, sessionId });
    if (existing) { startNode(existing.share_id); return describeLan(existing); }
    if (!status.available) throw fail(409, 'LAN_UNAVAILABLE', status.hint || '内网直连共享不可用');
    const share = await shared.ensureShare({ tenantId, username, sessionId, title });
    const self = await selfPeerId();
    const name = await localUserName(username);
    await withLock(`state:${share.id}`, async () => {
        const lan = await getLan(share.id);
        if (lan && lan.status === 'active') return;
        if (lan) await run('DELETE FROM lan_shares WHERE share_id = ?', [share.id]);
        const key = randomToken(24);
        await run(`INSERT INTO lan_shares (share_id, role, status, token, term, host_peer_id, host_url, origin_peer_id, self_key, local_username, local_tenant, local_session_id, title)
            VALUES (?, 'host', 'active', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [share.id, randomToken(18), self, status.url, self, key, username, tenantId, sessionId, share.title || '共享对话']);
        await upsertMember(share.id, { peerId: self, username, name, url: status.url, keyHash: sha(key), joinOrder: 0, status: 'active', lastSeen: now() });
    });
    names.set(self, name);
    startNode(share.id, (await getLan(share.id))?.role);
    return describeLan(await getLan(share.id));
}

function parseLink(link) {
    let url;
    try { url = new URL(String(link || '').trim()); } catch { throw fail(400, 'LAN_BAD_LINK', '内网共享链接格式不正确'); }
    const match = url.pathname.match(/\/lan-share\/([\w-]{4,80})\/?$/);
    const token = url.searchParams.get('t') || '';
    if (url.protocol !== 'http:' || !match || !token) throw fail(400, 'LAN_BAD_LINK', '内网共享链接格式不正确');
    const host = cleanIp(url.hostname);
    if (!isPrivateIPv4(host) && !isLoopback(host)) throw fail(400, 'LAN_BAD_LINK', '内网共享链接必须是内网地址（10.x.x.x 等）');
    return { hostUrl: `http://${url.host}`, shareId: match[1], token };
}

/** 用内网链接加入：连上主持登记成员，在本机建一份本地共享对话并拉取全部历史 */
async function join({ tenantId, username, link }) {
    if (!enabled()) throw fail(409, 'LAN_UNAVAILABLE', '内网直连共享仅在桌面版中可用');
    const { hostUrl, shareId, token } = parseLink(link);
    await ensureReady();
    const self = await selfPeerId();
    const existing = await getLan(shareId);
    const localShare = await get('SELECT owner_tenant FROM shared_conversations WHERE id = ?', [shareId]);
    if ((existing && existing.origin_peer_id === self) || (localShare && localShare.owner_tenant !== 'lan')) {
        // 自己点开了本机发起的共享链接：直接打开本机的对话
        const mine = await get("SELECT local_session_id FROM shared_conversation_members WHERE share_id = ? AND username = ? AND tenant_id = ? AND status = 'accepted' AND local_session_id <> ''", [shareId, username, tenantId]);
        if (mine) return { status: 'accepted', shareId, sessionId: mine.local_session_id, own: true };
        throw fail(409, 'LAN_OWN_SHARE', '这是本机发起的共享对话');
    }
    if (existing && existing.status === 'active') {
        const member = await get("SELECT local_session_id FROM shared_conversation_members WHERE share_id = ? AND username = ? AND tenant_id = ? AND status = 'accepted' AND local_session_id <> ''", [shareId, username, tenantId]);
        if (member) { startNode(shareId); return { status: 'accepted', shareId, sessionId: member.local_session_id }; }
        if (existing.role === 'host' || existing.origin_peer_id === self) throw fail(409, 'LAN_OWN_SHARE', '这是本机发起的共享对话');
        throw fail(409, 'LAN_OTHER_ACCOUNT', '本机的其他账号已加入这个共享对话');
    }
    const key = randomToken(24);
    const name = await localUserName(username);
    const body = { token, peerId: self, username, name, url: selfUrl(), key };
    let target = hostUrl;
    let data = null;
    for (let attempt = 0; attempt < 3 && !data; attempt += 1) {
        try {
            data = await call(target, shareId, '/join', { method: 'POST', body });
        } catch (error) {
            if (error.code === 'LAN_NOT_HOST' && error.body?.state?.hostUrl && error.body.state.hostUrl !== target) { target = error.body.state.hostUrl; continue; }
            if (['LAN_SHARE_NOT_FOUND', 'LAN_BAD_TOKEN'].includes(error.code)) throw fail(404, 'LAN_LINK_INVALID', '共享链接无效或已失效（对方可能已停止共享，或 IP 已变化，请向对方要新链接）');
            if (error.statusCode) throw error;
            throw fail(502, 'LAN_HOST_UNREACHABLE', `连接不到共享者的电脑（${target}），请确认对方桌面版已打开且在同一内网`);
        }
    }
    if (!data?.state) throw fail(502, 'LAN_HOST_UNREACHABLE', '连接不到共享者的电脑');
    const state = data.state;
    if (state.originPeerId === self) throw fail(409, 'LAN_OWN_SHARE', '这是本机发起的共享对话');
    const title = String(state.title || '共享对话').slice(0, 160);
    const sessionId = await tenantContext.runWithTenant(tenantId, () => require('./ai-chat-repository').getOrCreateSession({ owner: username, pagePath: '/', pageTitle: title }));
    await withLock(`state:${shareId}`, async () => {
        for (const table of ['lan_shares', 'lan_share_members', 'lan_share_log']) await run(`DELETE FROM ${table} WHERE share_id = ?`, [shareId]);
        await run('DELETE FROM shared_conversation_messages WHERE share_id = ?', [shareId]);
        await run('DELETE FROM shared_conversation_pushed WHERE share_id = ?', [shareId]);
        await run('DELETE FROM shared_conversation_members WHERE share_id = ?', [shareId]);
        await run(`INSERT INTO shared_conversations (id, owner, owner_tenant, origin_session_id, title, link_token, status, workspace_shared)
            VALUES (?, ?, 'lan', ?, ?, ?, 'active', 0)
            ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, owner_tenant = 'lan', origin_session_id = excluded.origin_session_id, title = excluded.title, status = 'active', workspace_shared = 0, updated_at = CURRENT_TIMESTAMP`,
        [shareId, pseudo(state.originPeerId), `lan:${shareId}`, title, randomToken(18)]);
        await run(`INSERT INTO shared_conversation_members (share_id, username, tenant_id, local_session_id, role, status, invited_by, via, responded_at)
            VALUES (?, ?, ?, ?, 'member', 'accepted', ?, 'lan', CURRENT_TIMESTAMP)`, [shareId, username, tenantId, sessionId, pseudo(state.originPeerId)]);
        await run(`INSERT INTO lan_shares (share_id, role, status, token, term, host_peer_id, host_url, origin_peer_id, self_key, local_username, local_tenant, local_session_id, title)
            VALUES (?, 'peer', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [shareId, state.token || token, Number(state.term) || 1, state.hostPeerId, state.hostUrl || target, state.originPeerId, key, username, tenantId, sessionId, title]);
        await upsertMember(shareId, { peerId: self, username, name, url: selfUrl(), keyHash: sha(key), joinOrder: 0, status: 'active', lastSeen: now() });
    });
    names.set(self, name);
    shared._resetCache();
    await applyState(shareId, state);
    await tenantContext.runWithTenant(tenantId, () => require('./conversation-list-repository').save(username, { source: 'mine', id: sessionId, title })).catch(() => {});
    await pull(await getLan(shareId)).catch(() => {});
    startNode(shareId, 'peer');
    await tenantContext.runWithTenant(tenantId, () => shared.syncLocal({ tenantId, username, sessionId })).catch(() => null);
    return { status: 'accepted', shareId, sessionId, lan: await describeLan(await getLan(shareId)) };
}

// 中转表来了新消息：主持端立即通知成员拉取；成员端把本机账号的新消息排进队列交给主持（同步入队，保证先于这一轮的结束事件）
shared.shareEvents.on('appended', ({ shareId, lan: fromLan }) => {
    const node = nodes.get(shareId);
    if (!node) return;
    if (node.role === 'host') broadcast(shareId, { type: 'log' });
    else if (node.role === 'peer' && !fromLan) {
        queueTask(shareId, async () => {
            const lan = await getLan(shareId);
            if (lan && lan.status === 'active' && lan.role === 'peer') await forward(lan);
        });
    }
});

// 本机共享关系变化：发起者停止共享 → 通知全部成员；本机账号退出 → 告诉主持；主持移除远端成员 → 通知对方并轮换令牌
shared.shareEvents.on('revoked', ({ shareId, username }) => {
    if (suppressRevoked) return;
    onRevoked(shareId, username).catch(error => console.warn('[lan-share] revoke handling failed:', error.message));
});
async function onRevoked(shareId, username) {
    const lan = await getLan(shareId);
    if (!lan || lan.status !== 'active') return;
    const self = await selfPeerId();
    const members = (await listMembers(shareId)).filter(row => row.peer_id !== self && row.status === 'active' && row.url);
    if (!username) {
        // 整个共享停止：只有发起者本机会走到这里（成员本机的关闭由 closeLocal 抑制）
        if (lan.origin_peer_id !== self) return;
        broadcast(shareId, { type: 'closed' });
        await Promise.all(members.map(row => call(row.url, shareId, '/closed', { method: 'POST', body: {}, lan, timeout: PROBE_TIMEOUT_MS }).catch(() => null)));
        await run("UPDATE lan_shares SET status = 'closed' WHERE share_id = ?", [shareId]);
        stopNode(shareId);
        return;
    }
    if (username.startsWith('lan:')) {
        const peerId = peerOfAuthor(username);
        if (lan.role !== 'host' || !peerId || peerId === self) return;
        await removePeer(lan, peerId);
        return;
    }
    if (username !== lan.local_username) return;
    // 本机账号退出这个内网共享
    if (lan.role === 'host') {
        // 临时主持退出：交给下一位在线成员
        const next = members.find(row => now() - (Number(row.last_seen) || 0) < OFFLINE_MS) || members[0];
        if (next) {
            const body = { term: (Number(lan.term) || 1) + 1, hostPeerId: next.peer_id, hostUrl: next.url };
            await Promise.all(members.map(row => call(row.url, shareId, '/host-changed', { method: 'POST', body, lan, timeout: PROBE_TIMEOUT_MS }).catch(() => null)));
        }
    } else {
        await call(lan.host_url, shareId, '/leave', { method: 'POST', body: {}, lan, timeout: PROBE_TIMEOUT_MS }).catch(() => null);
    }
    await run("UPDATE lan_shares SET status = 'left' WHERE share_id = ?", [shareId]);
    stopNode(shareId);
}

async function removePeer(lan, peerId) {
    const row = await get('SELECT * FROM lan_share_members WHERE share_id = ? AND peer_id = ?', [lan.share_id, peerId]);
    if (!row) return;
    await run("UPDATE lan_share_members SET status = 'removed' WHERE share_id = ? AND peer_id = ?", [lan.share_id, peerId]);
    await run("UPDATE shared_conversation_members SET status = 'removed' WHERE share_id = ? AND username = ?", [lan.share_id, pseudo(peerId)]);
    await run('UPDATE lan_shares SET token = ? WHERE share_id = ?', [randomToken(18), lan.share_id]); // 旧链接作废
    const map = streams.get(lan.share_id);
    const send = map?.get(peerId);
    map?.delete(peerId);
    if (send) { send({ type: 'removed' }); send.close?.(); }
    if (row.url) call(row.url, lan.share_id, '/removed', { method: 'POST', body: {}, lan, timeout: PROBE_TIMEOUT_MS }).catch(() => null);
    await broadcastState(lan);
}

// ── 节点接口处理（routes/lan-peer.js 调用；未登录、只校验链接令牌 / 节点密钥） ──
async function authPeer(shareId, req) {
    const lan = await getLan(shareId);
    if (!lan) throw fail(404, 'LAN_SHARE_NOT_FOUND', '共享不存在');
    if (lan.status === 'closed') throw fail(410, 'LAN_CLOSED', '共享已停止');
    if (lan.status !== 'active') throw fail(404, 'LAN_SHARE_NOT_FOUND', '共享不存在');
    const peerId = String(req.get('x-lan-peer') || '');
    const key = String(req.get('x-lan-key') || '');
    const row = peerId && await get('SELECT * FROM lan_share_members WHERE share_id = ? AND peer_id = ?', [shareId, peerId]);
    if (!row || !safeEqual(row.key_hash, sha(key))) throw fail(403, 'LAN_BAD_PEER', '节点校验失败');
    if (row.status === 'removed') throw fail(403, 'LAN_REMOVED', '已被移出共享');
    return { lan, member: row };
}
function notHost(lan) {
    return fail(409, 'LAN_NOT_HOST', '本机不是当前主持', { body: { code: 'LAN_NOT_HOST', state: { term: lan.term, hostPeerId: lan.host_peer_id, hostUrl: lan.host_url } } });
}

async function peerJoin(shareId, body = {}) {
    const lan = await getLan(shareId);
    if (!lan || lan.status !== 'active') throw fail(404, 'LAN_SHARE_NOT_FOUND', '共享不存在或已停止');
    if (!safeEqual(lan.token, body.token)) throw fail(403, 'LAN_BAD_TOKEN', '共享链接无效或已失效');
    if (lan.role !== 'host') throw notHost(lan);
    const peerId = String(body.peerId || '');
    if (!/^[\w-]{3,40}$/.test(peerId) || !body.key) throw fail(400, 'LAN_BAD_PEER', '节点信息无效');
    if (peerId === lan.host_peer_id) throw fail(409, 'LAN_OWN_SHARE', '这是本机发起的共享对话');
    const url = String(body.url || '');
    if (url && !/^http:\/\/[\w.-]+(?::\d+)?$/.test(url)) throw fail(400, 'LAN_BAD_URL', '节点地址无效');
    await withLock(`state:${shareId}`, async () => {
        const existing = await get('SELECT * FROM lan_share_members WHERE share_id = ? AND peer_id = ?', [shareId, peerId]);
        if (existing?.status === 'removed') throw fail(403, 'LAN_REMOVED', '你已被移出这个共享对话');
        const max = await get('SELECT MAX(join_order) AS n FROM lan_share_members WHERE share_id = ?', [shareId]);
        await upsertMember(shareId, {
            peerId, username: body.username, name: body.name || body.username, url, keyHash: sha(body.key),
            joinOrder: existing ? existing.join_order : (Number(max?.n) || 0) + 1, status: 'active', lastSeen: now()
        });
    });
    const fresh = await getLan(shareId);
    await syncPseudoMembers(fresh, await listMembers(shareId));
    shared._resetCache();
    await broadcastState(fresh);
    syncLocalMembers(shareId); // 本机界面刷新成员数
    return { state: await stateOf(fresh) };
}

async function peerHeartbeat(shareId, req) {
    const { lan, member } = await authPeer(shareId, req);
    if (lan.role !== 'host') throw notHost(lan);
    const url = String(req.body?.url || '');
    const name = String(req.body?.name || member.name || '').slice(0, 120);
    if (url && !/^http:\/\/[\w.-]+(?::\d+)?$/.test(url)) throw fail(400, 'LAN_BAD_URL', '节点地址无效');
    const changed = (url && url !== member.url) || (name && name !== member.name) || member.status !== 'active';
    await run("UPDATE lan_share_members SET last_seen = ?, url = CASE WHEN ? <> '' THEN ? ELSE url END, name = CASE WHEN ? <> '' THEN ? ELSE name END, status = 'active' WHERE share_id = ? AND peer_id = ?",
        [now(), url, url, name, name, shareId, member.peer_id]);
    if (name) names.set(member.peer_id, name);
    if (changed) {
        await syncPseudoMembers(lan, await listMembers(shareId));
        await broadcastState(lan);
    }
    return stateOf(await getLan(shareId));
}

async function peerLog(shareId, req) {
    const { lan } = await authPeer(shareId, req);
    if (lan.role !== 'host') throw notHost(lan);
    return exportLog(lan, Number(req.query.after) || 0);
}

async function peerAppend(shareId, req) {
    const { lan, member } = await authPeer(shareId, req);
    if (lan.role !== 'host') throw notHost(lan);
    await run('UPDATE lan_share_members SET last_seen = ? WHERE share_id = ? AND peer_id = ?', [now(), shareId, member.peer_id]);
    const accepted = await ingest(shareId, req.body?.rows);
    return { accepted };
}

async function peerStream(shareId, req) {
    const { lan, member } = await authPeer(shareId, req);
    if (lan.role !== 'host') throw notHost(lan);
    for (const event of Array.isArray(req.body?.events) ? req.body.events.slice(0, 2000) : []) {
        if (peerOfAuthor(event?.by) !== member.peer_id) continue; // 只能代表自己
        sharedLive.ingestRemote(shareId, event); // 本机频道 → 主持监听器再分发给其他成员
    }
    return { ok: true };
}

async function peerLive(shareId, req, res) {
    const { lan, member } = await authPeer(shareId, req);
    if (lan.role !== 'host') throw notHost(lan);
    const self = await selfPeerId();
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    let closed = false;
    const send = event => {
        if (closed || res.destroyed || res.writableEnded) return;
        res.write(`${JSON.stringify(event)}\n`);
        if (['closed', 'removed', 'moved'].includes(event.type)) close();
    };
    const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        const map = streams.get(shareId);
        if (map?.get(member.peer_id) === send) map.delete(member.peer_id);
        if (!res.writableEnded) res.end();
    };
    send.close = () => close();
    if (!streams.has(shareId)) streams.set(shareId, new Map());
    const previous = streams.get(shareId).get(member.peer_id);
    streams.get(shareId).set(member.peer_id, send);
    if (previous) previous.close?.(); // 同一成员重连：旧连接作废
    await run('UPDATE lan_share_members SET last_seen = ? WHERE share_id = ? AND peer_id = ?', [now(), shareId, member.peer_id]);
    attachHostListener(shareId);
    const turns = sharedLive.snapshots(shareId, by => peerOfAuthor(by) === member.peer_id && by.startsWith('lan:'))
        .map(turn => (turn.by.startsWith('lan:') ? turn : { ...turn, by: `lan:${self}:${turn.by}` }));
    send({ type: 'hello', state: await stateOf(lan), turns });
    const timer = setInterval(() => {
        send({ type: 'ping' });
        run('UPDATE lan_share_members SET last_seen = ? WHERE share_id = ? AND peer_id = ?', [now(), shareId, member.peer_id]).catch(() => {});
    }, Math.min(15000, HEARTBEAT_MS));
    if (typeof timer.unref === 'function') timer.unref();
    res.on('close', close);
}

async function peerState(shareId, req) {
    const { lan } = await authPeer(shareId, req);
    return { role: lan.role, term: Number(lan.term) || 1, hostPeerId: lan.host_peer_id, hostUrl: lan.host_url, status: lan.status };
}

async function peerHostChanged(shareId, req) {
    const { lan, member } = await authPeer(shareId, req);
    const self = await selfPeerId();
    const term = Number(req.body?.term) || 0;
    const hostPeerId = String(req.body?.hostPeerId || '');
    const hostUrl = String(req.body?.hostUrl || '');
    if (!/^http:\/\/[\w.-]+(?::\d+)?$/.test(hostUrl)) throw fail(400, 'LAN_BAD_URL', '主持地址无效');
    const members = await listMembers(shareId);
    if (!members.some(row => row.peer_id === hostPeerId && row.status === 'active')) throw fail(400, 'LAN_BAD_PEER', '新主持不是成员');
    // 只能宣布自己是主持，或（交接时）指定下一位；交接只认当前主持发出的
    if (hostPeerId !== member.peer_id && member.peer_id !== lan.host_peer_id) throw fail(403, 'LAN_BAD_PEER', '无权变更主持');
    const mine = Number(lan.term) || 0;
    const accept = term > mine || (term === mine && (hostPeerId === lan.host_peer_id || joinOrderOf(members, hostPeerId) < joinOrderOf(members, lan.host_peer_id)));
    if (!accept) throw fail(409, 'LAN_STALE_TERM', '主持信息已过期', { body: { code: 'LAN_STALE_TERM', state: { term: mine, hostPeerId: lan.host_peer_id, hostUrl: lan.host_url } } });
    if (hostPeerId === self) await becomeHost(shareId, term);
    else await adoptHost(shareId, { term, hostPeerId, hostUrl });
    return { ok: true };
}

async function peerLeave(shareId, req) {
    const { lan, member } = await authPeer(shareId, req);
    if (lan.role !== 'host') throw notHost(lan);
    await run("UPDATE lan_share_members SET status = 'left' WHERE share_id = ? AND peer_id = ?", [shareId, member.peer_id]);
    await run("UPDATE shared_conversation_members SET status = 'left' WHERE share_id = ? AND username = ?", [shareId, pseudo(member.peer_id)]);
    const send = streams.get(shareId)?.get(member.peer_id);
    streams.get(shareId)?.delete(member.peer_id);
    send?.close?.();
    sharedLive.clearRemote(shareId, `lan:${member.peer_id}:`);
    await broadcastState(lan);
    syncLocalMembers(shareId);
    return { ok: true };
}

async function peerClosed(shareId, req) {
    const { lan, member } = await authPeer(shareId, req);
    if (member.peer_id !== lan.origin_peer_id) throw fail(403, 'LAN_BAD_PEER', '只有发起者可以停止共享');
    await closeLocal(shareId, 'closed');
    return { ok: true };
}

async function peerRemoved(shareId, req) {
    const { lan, member } = await authPeer(shareId, req);
    if (member.peer_id !== lan.host_peer_id) throw fail(403, 'LAN_BAD_PEER', '只有主持可以移除成员');
    await closeLocal(shareId, 'removed');
    return { ok: true };
}

/** 落地页预览：只给持有链接令牌的人看标题和发起者 */
async function peerPreview(shareId, token) {
    const lan = await getLan(shareId);
    if (!lan || lan.status !== 'active' || !safeEqual(lan.token, token)) throw fail(404, 'LAN_SHARE_NOT_FOUND', '共享链接无效或已失效');
    const members = await listMembers(shareId);
    const origin = members.find(row => row.peer_id === lan.origin_peer_id);
    return { title: lan.title, ownerName: origin?.name || '', memberCount: members.filter(row => row.status === 'active').length, hostUrl: lan.host_url, isHost: lan.role === 'host' };
}

/** 服务启动：恢复所有进行中的内网共享 */
async function start() {
    if (!enabled()) return;
    await ensureReady();
    await selfPeerId();
    const rows = await all("SELECT share_id, role FROM lan_shares WHERE status = 'active'");
    for (const row of rows) startNode(row.share_id, row.role);
    if (rows.length) console.log(`[lan-share] 恢复 ${rows.length} 个内网共享对话`);
}
function stopAll() { for (const shareId of [...nodes.keys()]) stopNode(shareId); }

module.exports = {
    availability, enabled, requestAllowed, selfUrl, lanAddresses, isPrivateIPv4, displayName,
    sessionInfo, ensureHostLink, join, start, stopAll, parseLink,
    peerJoin, peerHeartbeat, peerLog, peerAppend, peerStream, peerLive, peerState, peerHostChanged, peerLeave, peerClosed, peerRemoved, peerPreview,
    _nodes: nodes, _tick: tick, _selfPeerId: selfPeerId
};
