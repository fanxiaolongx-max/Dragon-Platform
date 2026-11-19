// 共享对话：把一个 Dragon Claw 对话共享给其他账号，大家接着同一段上下文往下聊，消息互相可见、标注发送账号。
//
// 设计（一个账号 = 一个团队，各自的对话在各自团队库里）：
// - 共享关系、成员、中转消息放在平台控制库（data/platform/control.db），不跨团队直接读写别人的业务库。
// - 每个成员在自己团队库里有一份本地对话（local_session_id）。发起者的本地对话就是原对话；接受者接受时新建一份。
// - 本地写入新消息后推送（push）到中转表；打开 / 轮询时拉取（pull）别人推送的消息写入自己的本地对话。
//   拉取的消息带 { type: 'shared_author' } 事件，界面据此显示发送账号，也不会被再推回去。
// - 新的模型调用、文件与命令都在当前操作者自己的账号 / 团队沙箱里执行；只共享上下文（历史消息与其中的对话附件）。
//   对话附件推送时复制到共享文件区，拉取时再复制进接收者自己的附件目录，路径各自改写，不暴露对方的目录。
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { run, get, all } = require('./control-db');
const tenantContext = require('./tenant-context');

const MAX_MEMBERS = 200;
const MAX_TITLE = 160;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

let readyPromise = null;
function ensureReady() {
    if (!readyPromise) {
        readyPromise = (async () => {
            await run(`CREATE TABLE IF NOT EXISTS shared_conversations (
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                owner_tenant TEXT NOT NULL DEFAULT 'default',
                origin_session_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                link_token TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (owner_tenant, owner, origin_session_id)
            )`);
            await run(`CREATE TABLE IF NOT EXISTS shared_conversation_members (
                share_id TEXT NOT NULL,
                username TEXT NOT NULL,
                tenant_id TEXT NOT NULL DEFAULT '',
                local_session_id TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'member',
                status TEXT NOT NULL DEFAULT 'pending',
                invited_by TEXT NOT NULL DEFAULT '',
                via TEXT NOT NULL DEFAULT 'invite',
                invited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                responded_at DATETIME,
                pulled_seq INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (share_id, username)
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_shared_members_user ON shared_conversation_members(username, status)');
            await run('CREATE INDEX IF NOT EXISTS idx_shared_members_local ON shared_conversation_members(tenant_id, username, local_session_id)');
            await run(`CREATE TABLE IF NOT EXISTS shared_conversation_messages (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                share_id TEXT NOT NULL,
                author TEXT NOT NULL,
                author_name TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                events TEXT NOT NULL DEFAULT '',
                model_name TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_shared_messages_share ON shared_conversation_messages(share_id, seq)');
            // 已推送的本地消息（每个成员本地对话里的消息 id → 中转序号），保证重复推送不会产生重复消息
            await run(`CREATE TABLE IF NOT EXISTS shared_conversation_pushed (
                share_id TEXT NOT NULL,
                username TEXT NOT NULL,
                local_message_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                PRIMARY KEY (share_id, username, local_message_id)
            )`);
            await run(`CREATE TABLE IF NOT EXISTS share_groups (
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                name TEXT NOT NULL,
                members TEXT NOT NULL DEFAULT '[]',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                used_at DATETIME
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_share_groups_owner ON share_groups(owner)');
            await run(`CREATE TABLE IF NOT EXISTS share_recent (
                owner TEXT NOT NULL,
                kind TEXT NOT NULL,
                target TEXT NOT NULL,
                uses INTEGER NOT NULL DEFAULT 0,
                used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (owner, kind, target)
            )`);
        })().catch(error => { readyPromise = null; throw error; });
    }
    return readyPromise;
}

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const newId = prefix => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
const cleanName = value => String(value || '').trim().slice(0, 120);
const chatRepo = () => require('./ai-chat-repository');
const users = () => require('./auth-users-repository');

async function userMap() {
    const { items } = await users().listUsers();
    return items || {};
}
async function displayNames(usernames) {
    const map = await userMap();
    const result = {};
    for (const name of usernames) result[name] = map[name]?.displayName || name;
    return result;
}

// ── 进程内互斥：同一成员的推送 / 拉取不并发，避免重复写入 ──
const locks = new Map();
function withLock(key, task) {
    const previous = locks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    const tail = next.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return next;
}

// ── 附件：对话里的附件以 Markdown 链接 [名称](<绝对路径>) 写在消息里 ──
function sharedFilesBase() {
    return path.join(tenantContext.BASE_DATA_DIR, 'platform', 'shared-conversation-files');
}
function realOrSelf(target) {
    try { return fs.realpathSync(target); } catch (_error) { return path.resolve(target); }
}
function inside(base, target) {
    const rel = path.relative(realOrSelf(base), realOrSelf(target));
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}
async function copyInto(source, dir) {
    const stat = await fsp.stat(source).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > MAX_FILE_BYTES) return '';
    const target = path.join(dir, crypto.randomBytes(4).toString('hex'), path.basename(source));
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fsp.copyFile(source, target);
    return target;
}
/** 把 text 里落在 fromBase 下的附件复制到 toDir，并改写成新路径；不在 fromBase 下的路径（别人的目录、工作区文件）原样保留 */
async function relinkFiles(text, fromBase, toDir) {
    const paths = [...new Set([...String(text || '').matchAll(/\(<([^>\n]+)>\)/g)].map(match => match[1]))];
    let result = String(text || '');
    for (const original of paths) {
        if (!path.isAbsolute(original) || !inside(fromBase, original)) continue;
        const copied = await copyInto(original, toDir).catch(() => '');
        if (copied) result = result.split(`(<${original}>)`).join(`(<${copied}>)`);
    }
    return result;
}
function uploadDirFor(tenantId, username) {
    return require('./agent-artifacts').uploadDir(`${tenantId}::${username}`);
}

// ── 查询 ──
async function getShare(shareId) {
    await ensureReady();
    return get('SELECT * FROM shared_conversations WHERE id = ?', [String(shareId || '')]);
}
async function getMember(shareId, username) {
    await ensureReady();
    return get('SELECT * FROM shared_conversation_members WHERE share_id = ? AND username = ?', [String(shareId || ''), String(username || '')]);
}
async function memberByLocal(tenantId, username, sessionId) {
    await ensureReady();
    return get(`SELECT m.*, s.status AS share_status FROM shared_conversation_members m JOIN shared_conversations s ON s.id = m.share_id
        WHERE m.tenant_id = ? AND m.username = ? AND m.local_session_id = ? AND m.status = 'accepted'`, [tenantId, username, String(sessionId || '')]);
}

function linkFor(share) {
    return `/?share=${encodeURIComponent(share.link_token)}`;
}

async function describe(share, me) {
    const members = await all('SELECT username, role, status, via, invited_at, responded_at FROM shared_conversation_members WHERE share_id = ? ORDER BY role = \'owner\' DESC, invited_at ASC', [share.id]);
    const names = await displayNames([share.owner, ...members.map(item => item.username)]);
    const mine = members.find(item => item.username === me);
    const last = await get('SELECT MAX(seq) AS seq, MAX(created_at) AS at, COUNT(*) AS count FROM shared_conversation_messages WHERE share_id = ?', [share.id]);
    return {
        id: share.id,
        title: share.title,
        status: share.status,
        owner: share.owner,
        ownerName: names[share.owner] || share.owner,
        isOwner: share.owner === me,
        link: linkFor(share),
        createdAt: share.created_at,
        updatedAt: last?.at || share.updated_at,
        messageCount: Number(last?.count) || 0,
        role: mine?.role || '',
        myStatus: mine?.status || '',
        members: members.filter(item => !['left', 'removed'].includes(item.status)).map(item => ({
            username: item.username, name: names[item.username] || item.username, role: item.role, status: item.status, via: item.via
        }))
    };
}

// ── 推送 / 拉取 ──
async function pushMember(share, member) {
    const repo = chatRepo();
    const rows = await repo.listMessagesForShare(member.local_session_id);
    if (!rows.length) return 0;
    const pushed = new Set((await all('SELECT local_message_id FROM shared_conversation_pushed WHERE share_id = ? AND username = ?', [share.id, member.username])).map(row => row.local_message_id));
    const names = await displayNames([member.username]);
    let count = 0;
    for (const row of rows) {
        if (pushed.has(row.id) || !String(row.content || '').trim()) continue;
        let events = [];
        try { events = row.events ? JSON.parse(row.events) : []; } catch (_error) { events = []; }
        if (!Array.isArray(events)) events = [];
        if (events.some(event => event?.type === 'shared_author')) continue; // 别人的消息拉进来的副本
        if (String(row.id).startsWith('agent_') && !Number(row.agent_final)) break; // 工作区回答还没结束：保持顺序，等结束再推
        const content = await relinkFiles(row.content, uploadDirFor(member.tenant_id, member.username), path.join(sharedFilesBase(), share.id));
        const result = await run(`INSERT INTO shared_conversation_messages (share_id, author, author_name, role, content, events, model_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [share.id, member.username, names[member.username] || member.username, row.role === 'model' ? 'model' : 'user', content,
            JSON.stringify(events.filter(event => event?.type !== 'workspace_checkpoint')), String(row.model_name || '').slice(0, 120)]);
        await run('INSERT OR IGNORE INTO shared_conversation_pushed (share_id, username, local_message_id, seq) VALUES (?, ?, ?, ?)', [share.id, member.username, row.id, result.lastID]);
        count += 1;
    }
    if (count) await run('UPDATE shared_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [share.id]);
    return count;
}

async function pullMember(share, member) {
    const rows = await all('SELECT * FROM shared_conversation_messages WHERE share_id = ? AND seq > ? ORDER BY seq ASC LIMIT 500', [share.id, Number(member.pulled_seq) || 0]);
    if (!rows.length) return 0;
    const repo = chatRepo();
    const session = await repo.getSession(member.local_session_id);
    let count = 0;
    let seq = Number(member.pulled_seq) || 0;
    for (const row of rows) {
        seq = row.seq;
        if (row.author === member.username) continue;
        let events = [];
        try { events = row.events ? JSON.parse(row.events) : []; } catch (_error) { events = []; }
        const content = await relinkFiles(row.content, path.join(sharedFilesBase(), share.id), path.join(uploadDirFor(member.tenant_id, member.username), `shared-${share.id}`));
        await repo.addMessage({
            sessionId: member.local_session_id,
            pagePath: session?.page_path || '/',
            pageTitle: session?.page_title || '',
            owner: member.username,
            role: row.role,
            content,
            modelName: row.model_name,
            events: [...(Array.isArray(events) ? events : []), { type: 'shared_author', author: row.author, name: row.author_name || row.author, at: row.created_at }]
        });
        count += 1;
    }
    await run('UPDATE shared_conversation_members SET pulled_seq = ? WHERE share_id = ? AND username = ?', [seq, share.id, member.username]);
    return count;
}

/**
 * 同步当前账号在当前团队里的一个本地共享对话：先推送自己的新消息，再拉取别人的。
 * 必须在该成员自己的租户上下文里调用（读写的是本人团队库）。
 */
async function syncLocal({ tenantId, username, sessionId }) {
    const member = await memberByLocal(tenantId, username, sessionId);
    if (!member) return null;
    return withLock(`${member.share_id}\n${username}`, async () => {
        const share = await getShare(member.share_id);
        const fresh = await getMember(member.share_id, username);
        if (!share || !fresh || fresh.status !== 'accepted') return null;
        const exists = await chatRepo().getSession(fresh.local_session_id);
        if (!exists) { // 本地对话已删除：视为退出共享
            await run("UPDATE shared_conversation_members SET status = 'left', responded_at = CURRENT_TIMESTAMP WHERE share_id = ? AND username = ?", [share.id, username]);
            linkedCache = null;
            return null;
        }
        if (share.status !== 'active') return { shareId: share.id, pushed: 0, pulled: 0, closed: true };
        const pushed = await pushMember(share, fresh);
        const pulled = await pullMember(share, { ...fresh, pulled_seq: fresh.pulled_seq });
        return { shareId: share.id, pushed, pulled, closed: false };
    });
}

// 本地写入钩子：只对已共享的本地对话做事（内存里缓存一份「已共享的本地对话」集合，避免每条消息都查控制库）
let linkedCache = null;
async function linkedSet() {
    if (!linkedCache) {
        linkedCache = (async () => {
            await ensureReady();
            const rows = await all(`SELECT m.tenant_id, m.username, m.local_session_id FROM shared_conversation_members m JOIN shared_conversations s ON s.id = m.share_id
                WHERE m.status = 'accepted' AND s.status = 'active' AND m.local_session_id <> ''`);
            return new Set(rows.map(row => `${row.tenant_id}\n${row.username}\n${row.local_session_id}`));
        })().catch(error => { linkedCache = null; throw error; });
    }
    return linkedCache;
}
const pending = new Map();
function schedulePush(tenantId, username, sessionId) {
    if (!sessionId || !username) return;
    const key = `${tenantId}\n${username}\n${sessionId}`;
    clearTimeout(pending.get(key));
    const timer = setTimeout(() => {
        pending.delete(key);
        linkedSet().then(set => {
            if (!set.has(key)) return null;
            return tenantContext.runWithTenant(tenantId, () => syncLocal({ tenantId, username, sessionId }));
        }).catch(error => console.warn('[shared-conversations] push failed:', error.message));
    }, 400);
    if (typeof timer.unref === 'function') timer.unref();
    pending.set(key, timer);
}

// ── 共享 / 邀请 ──
async function ensureShare({ tenantId, username, sessionId, title }) {
    await ensureReady();
    const owned = await chatRepo().assertSessionOwner(sessionId, username).catch(() => null);
    if (!owned) throw fail(404, 'SHARE_SESSION_NOT_FOUND', '对话不存在或还没有保存的消息');
    // 这个对话本身就是别人共享给我的本地副本：返回原共享，邀请时加进同一个共享
    const linked = await get(`SELECT share_id FROM shared_conversation_members WHERE tenant_id = ? AND username = ? AND local_session_id = ? AND status = 'accepted'`, [tenantId, username, sessionId]);
    let share = linked ? await getShare(linked.share_id) : await get('SELECT * FROM shared_conversations WHERE owner_tenant = ? AND owner = ? AND origin_session_id = ?', [tenantId, username, sessionId]);
    const cleanTitle = String(title || '').replace(/\[([^\]]*)\]\(<[^>]*>\)/g, '$1').replace(/\s*\[[^\]]*$/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (!share) {
        const id = newId('shr');
        await run(`INSERT INTO shared_conversations (id, owner, owner_tenant, origin_session_id, title, link_token) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, username, tenantId, sessionId, cleanTitle || '共享对话', crypto.randomBytes(18).toString('base64url')]);
        await run(`INSERT INTO shared_conversation_members (share_id, username, tenant_id, local_session_id, role, status, invited_by, via, responded_at)
            VALUES (?, ?, ?, ?, 'owner', 'accepted', ?, 'owner', CURRENT_TIMESTAMP)`, [id, username, tenantId, sessionId, username]);
        linkedCache = null;
        share = await getShare(id);
    } else if (share.status !== 'active' && share.owner === username) {
        await run("UPDATE shared_conversations SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [share.id]);
        await run("UPDATE shared_conversation_members SET status = 'accepted' WHERE share_id = ? AND username = ?", [share.id, username]);
        linkedCache = null;
        share = await getShare(share.id);
    } else if (share.status !== 'active') {
        throw fail(409, 'SHARE_CLOSED', '发起者已停止共享这个对话');
    }
    if (cleanTitle && share.owner === username && cleanTitle !== share.title) {
        await run('UPDATE shared_conversations SET title = ? WHERE id = ?', [cleanTitle, share.id]);
        share.title = cleanTitle;
    }
    // 先把已有的历史推到中转，被邀请的人一接受就能看到完整上下文
    await syncLocal({ tenantId, username, sessionId });
    return share;
}

async function invite({ tenantId, username, sessionId, title, usernames = [], groupIds = [] }) {
    const share = await ensureShare({ tenantId, username, sessionId, title });
    const map = await userMap();
    const targets = new Set(Array.isArray(usernames) ? usernames.map(cleanName).filter(Boolean) : []);
    const groups = [];
    for (const groupId of Array.isArray(groupIds) ? groupIds.slice(0, 20) : []) {
        const group = await get('SELECT * FROM share_groups WHERE id = ? AND owner = ?', [String(groupId), username]);
        if (!group) continue;
        groups.push(group);
        for (const member of parseMembers(group.members)) targets.add(member);
    }
    targets.delete(username);
    const unknown = [...targets].filter(name => !map[name]);
    if (unknown.length) throw fail(400, 'SHARE_UNKNOWN_USER', `账号不存在：${unknown.slice(0, 5).join('、')}`);
    const existing = await all('SELECT username, status FROM shared_conversation_members WHERE share_id = ?', [share.id]);
    if (existing.filter(item => !['left', 'removed', 'declined'].includes(item.status)).length + targets.size > MAX_MEMBERS) throw fail(400, 'SHARE_TOO_MANY', `一个共享对话最多 ${MAX_MEMBERS} 人`);
    const invited = [];
    const already = [];
    for (const target of targets) {
        const row = existing.find(item => item.username === target);
        if (row && ['accepted', 'pending'].includes(row.status)) { already.push(target); continue; }
        await run(`INSERT INTO shared_conversation_members (share_id, username, tenant_id, role, status, invited_by, via, invited_at)
            VALUES (?, ?, ?, 'member', 'pending', ?, 'invite', CURRENT_TIMESTAMP)
            ON CONFLICT(share_id, username) DO UPDATE SET status = 'pending', invited_by = excluded.invited_by, via = 'invite', invited_at = CURRENT_TIMESTAMP, responded_at = NULL`,
        [share.id, target, map[target].tenantId || 'default', username]);
        invited.push(target);
    }
    for (const target of targets) await touchRecent(username, 'user', target);
    for (const group of groups) {
        await touchRecent(username, 'group', group.id);
        await run('UPDATE share_groups SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [group.id]);
    }
    return { share: await describe(await getShare(share.id), username), invited, already };
}

async function shareForSession({ tenantId, username, sessionId }) {
    await ensureReady();
    const member = await get(`SELECT share_id FROM shared_conversation_members WHERE tenant_id = ? AND username = ? AND local_session_id = ? AND status = 'accepted'`, [tenantId, username, String(sessionId || '')]);
    const share = member ? await getShare(member.share_id)
        : await get('SELECT * FROM shared_conversations WHERE owner_tenant = ? AND owner = ? AND origin_session_id = ?', [tenantId, username, String(sessionId || '')]);
    return share ? describe(share, username) : null;
}

async function inbox(username) {
    await ensureReady();
    const rows = await all(`SELECT m.share_id, m.invited_by, m.invited_at, m.via, s.title, s.owner FROM shared_conversation_members m
        JOIN shared_conversations s ON s.id = m.share_id WHERE m.username = ? AND m.status = 'pending' AND s.status = 'active' ORDER BY m.invited_at DESC LIMIT 50`, [username]);
    const names = await displayNames(rows.flatMap(row => [row.owner, row.invited_by]));
    const items = [];
    for (const row of rows) {
        const stats = await get('SELECT COUNT(*) AS count FROM shared_conversation_messages WHERE share_id = ?', [row.share_id]);
        const members = await get("SELECT COUNT(*) AS count FROM shared_conversation_members WHERE share_id = ? AND status = 'accepted'", [row.share_id]);
        items.push({
            shareId: row.share_id, title: row.title, owner: row.owner, ownerName: names[row.owner] || row.owner,
            invitedBy: row.invited_by, invitedByName: names[row.invited_by] || row.invited_by, invitedAt: row.invited_at, via: row.via,
            messageCount: Number(stats?.count) || 0, memberCount: Number(members?.count) || 0
        });
    }
    return items;
}

async function respond({ tenantId, username, shareId, action }) {
    if (!['accept', 'decline', 'ignore'].includes(action)) throw fail(400, 'SHARE_BAD_ACTION', '无效的操作');
    const share = await getShare(shareId);
    const member = share && await getMember(share.id, username);
    if (!share || !member || ['left', 'removed'].includes(member.status)) throw fail(404, 'SHARE_INVITE_NOT_FOUND', '邀请不存在或已失效');
    if (share.status !== 'active') throw fail(409, 'SHARE_CLOSED', '发起者已停止共享这个对话');
    if (member.status === 'accepted') {
        const exists = member.local_session_id && member.tenant_id === tenantId && await chatRepo().getSession(member.local_session_id);
        if (exists || action !== 'accept') return { status: 'accepted', sessionId: exists ? member.local_session_id : '' };
    }
    if (action !== 'accept') {
        await run('UPDATE shared_conversation_members SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE share_id = ? AND username = ?', [action === 'decline' ? 'declined' : 'ignored', share.id, username]);
        return { status: action === 'decline' ? 'declined' : 'ignored' };
    }
    // 接受：在本人当前团队里新建一份本地对话，并拉取全部历史
    const sessionId = await chatRepo().getOrCreateSession({ owner: username, pagePath: '/', pageTitle: share.title });
    await run(`UPDATE shared_conversation_members SET status = 'accepted', tenant_id = ?, local_session_id = ?, pulled_seq = 0, responded_at = CURRENT_TIMESTAMP
        WHERE share_id = ? AND username = ?`, [tenantId, sessionId, share.id, username]);
    await run('DELETE FROM shared_conversation_pushed WHERE share_id = ? AND username = ?', [share.id, username]);
    linkedCache = null;
    await require('./conversation-list-repository').save(username, { source: 'mine', id: sessionId, title: share.title }).catch(() => {});
    await syncLocal({ tenantId, username, sessionId });
    return { status: 'accepted', sessionId, share: await describe(share, username) };
}

async function joinByLink({ username, token }) {
    await ensureReady();
    const share = await get('SELECT * FROM shared_conversations WHERE link_token = ?', [String(token || '')]);
    if (!share) throw fail(404, 'SHARE_LINK_INVALID', '共享链接无效或已失效');
    if (share.status !== 'active') throw fail(409, 'SHARE_CLOSED', '发起者已停止共享这个对话');
    const member = await getMember(share.id, username);
    if (member?.status === 'accepted' && member.local_session_id) return { status: 'accepted', shareId: share.id, sessionId: member.local_session_id, tenantId: member.tenant_id };
    const map = await userMap();
    await run(`INSERT INTO shared_conversation_members (share_id, username, tenant_id, role, status, invited_by, via, invited_at)
        VALUES (?, ?, ?, 'member', 'pending', ?, 'link', CURRENT_TIMESTAMP)
        ON CONFLICT(share_id, username) DO UPDATE SET status = 'pending', via = 'link', invited_at = CURRENT_TIMESTAMP, responded_at = NULL`,
    [share.id, username, map[username]?.tenantId || 'default', share.owner]);
    const item = (await inbox(username)).find(row => row.shareId === share.id);
    return { status: 'pending', shareId: share.id, invite: item };
}

async function listMine({ tenantId, username }) {
    await ensureReady();
    const rows = await all(`SELECT m.share_id, m.local_session_id, m.pulled_seq FROM shared_conversation_members m JOIN shared_conversations s ON s.id = m.share_id
        WHERE m.username = ? AND m.tenant_id = ? AND m.status = 'accepted' AND m.local_session_id <> ''`, [username, tenantId]);
    const items = [];
    for (const row of rows) {
        const share = await getShare(row.share_id);
        const others = await get("SELECT COUNT(*) AS count FROM shared_conversation_members WHERE share_id = ? AND username <> ? AND status IN ('accepted', 'pending')", [row.share_id, username]);
        // 发起者还没邀请到任何人（只是打开过共享面板）：不算共享对话
        if (!Number(others?.count) && share.owner === username) continue;
        const unread = await get('SELECT COUNT(*) AS count FROM shared_conversation_messages WHERE share_id = ? AND seq > ? AND author <> ?', [row.share_id, Number(row.pulled_seq) || 0, username]);
        items.push({ ...(await describe(share, username)), sessionId: row.local_session_id, unread: Number(unread?.count) || 0 });
    }
    return items;
}

async function leave({ tenantId, username, sessionId }) {
    const member = await memberByLocal(tenantId, username, sessionId);
    if (!member) throw fail(404, 'SHARE_NOT_FOUND', '这个对话没有共享');
    const share = await getShare(member.share_id);
    if (share.owner === username) {
        // 发起者：停止共享，所有人保留各自已同步的内容，之后不再同步
        await run("UPDATE shared_conversations SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [share.id]);
        await run("UPDATE shared_conversation_members SET status = 'removed' WHERE share_id = ? AND status IN ('pending', 'ignored', 'declined')", [share.id]);
        linkedCache = null;
        return { closed: true };
    }
    await run("UPDATE shared_conversation_members SET status = 'left', responded_at = CURRENT_TIMESTAMP WHERE share_id = ? AND username = ?", [share.id, username]);
    linkedCache = null;
    return { left: true };
}

async function removeMember({ tenantId, username, sessionId, target }) {
    const member = await memberByLocal(tenantId, username, sessionId);
    const share = member && await getShare(member.share_id);
    if (!share || share.owner !== username) throw fail(403, 'SHARE_OWNER_ONLY', '只有发起者可以移除成员');
    if (target === username) throw fail(400, 'SHARE_BAD_TARGET', '不能移除自己，请使用「停止共享」');
    await run("UPDATE shared_conversation_members SET status = 'removed', responded_at = CURRENT_TIMESTAMP WHERE share_id = ? AND username = ?", [share.id, cleanName(target)]);
    linkedCache = null;
    return describe(share, username);
}

async function onLocalDeleted({ tenantId, username, sessionId }) {
    await ensureReady();
    const result = await run("UPDATE shared_conversation_members SET status = 'left', responded_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND username = ? AND local_session_id = ? AND status = 'accepted'", [tenantId, username, String(sessionId || '')]);
    if (result.changes) linkedCache = null;
}

// ── 账号、常用群组、最近使用 ──
// query：账号名 / 显示名包含，或拼音（全拼、首字母）命中显示名；移动端没有拼音库，由这里过滤
async function accounts(username, query = '') {
    const map = await userMap();
    const q = String(query || '').trim().toLowerCase().slice(0, 64);
    const pinyin = q ? require('../../frontend/js/shared/pinyin-search.js') : null;
    return Object.values(map).filter(user => user.username !== username)
        .map(user => ({ username: user.username, name: user.displayName || user.username }))
        .filter(user => !q || user.username.toLowerCase().includes(q) || user.name.toLowerCase().includes(q)
            || (pinyin.isPinyinQuery(q) && pinyin.pinyinMatches(user.name, q)))
        .sort((a, b) => a.username.localeCompare(b.username, undefined, { numeric: true }));
}

function parseMembers(raw) {
    try { const list = JSON.parse(raw || '[]'); return Array.isArray(list) ? list.map(cleanName).filter(Boolean) : []; } catch (_error) { return []; }
}
async function listGroups(username) {
    await ensureReady();
    const rows = await all('SELECT * FROM share_groups WHERE owner = ? ORDER BY COALESCE(used_at, created_at) DESC LIMIT 100', [username]);
    return rows.map(row => ({ id: row.id, name: row.name, members: parseMembers(row.members), usedAt: row.used_at, createdAt: row.created_at }));
}
async function saveGroup(username, { id, name, members }) {
    await ensureReady();
    const cleanGroupName = String(name || '').trim().slice(0, 40);
    if (!cleanGroupName) throw fail(400, 'SHARE_GROUP_NAME', '请填写群组名称');
    const map = await userMap();
    const list = [...new Set((Array.isArray(members) ? members : []).map(cleanName).filter(item => item && item !== username && map[item]))].slice(0, MAX_MEMBERS);
    if (!list.length) throw fail(400, 'SHARE_GROUP_EMPTY', '群组至少需要一位成员');
    if (id) {
        const result = await run('UPDATE share_groups SET name = ?, members = ? WHERE id = ? AND owner = ?', [cleanGroupName, JSON.stringify(list), String(id), username]);
        if (!result.changes) throw fail(404, 'SHARE_GROUP_NOT_FOUND', '群组不存在');
        return (await listGroups(username)).find(group => group.id === id);
    }
    if ((await get('SELECT COUNT(*) AS count FROM share_groups WHERE owner = ?', [username])).count >= 100) throw fail(400, 'SHARE_GROUP_LIMIT', '最多保存 100 个常用群组');
    const groupId = newId('grp');
    await run('INSERT INTO share_groups (id, owner, name, members) VALUES (?, ?, ?, ?)', [groupId, username, cleanGroupName, JSON.stringify(list)]);
    return (await listGroups(username)).find(group => group.id === groupId);
}
async function deleteGroup(username, id) {
    await ensureReady();
    await run('DELETE FROM share_groups WHERE id = ? AND owner = ?', [String(id), username]);
    await run("DELETE FROM share_recent WHERE owner = ? AND kind = 'group' AND target = ?", [username, String(id)]);
}
async function touchRecent(owner, kind, target) {
    await run(`INSERT INTO share_recent (owner, kind, target, uses, used_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(owner, kind, target) DO UPDATE SET uses = uses + 1, used_at = CURRENT_TIMESTAMP`, [owner, kind, target]);
}
/** 智能提示：按「最近用过 + 用过的次数」排序（近 30 天内的权重更高） */
async function recent(username) {
    await ensureReady();
    const rows = await all('SELECT kind, target, uses, used_at FROM share_recent WHERE owner = ? ORDER BY used_at DESC LIMIT 60', [username]);
    const now = Date.now();
    const score = row => {
        const age = (now - Date.parse(String(row.used_at).replace(' ', 'T') + 'Z')) / 86400000;
        return Number(row.uses) + Math.max(0, 30 - (Number.isFinite(age) ? age : 30)) / 3;
    };
    const map = await userMap();
    const groups = await listGroups(username);
    const sorted = rows.sort((a, b) => score(b) - score(a));
    return {
        users: sorted.filter(row => row.kind === 'user' && map[row.target]).slice(0, 8).map(row => ({ username: row.target, name: map[row.target].displayName || row.target, uses: row.uses })),
        groups: sorted.filter(row => row.kind === 'group').map(row => groups.find(group => group.id === row.target)).filter(Boolean).slice(0, 5)
    };
}

/** 给模型的上下文：别人发的提问前标注发送账号，模型能分清是谁在说话 */
function authorOf(events) {
    let list = events;
    if (typeof list === 'string') { try { list = JSON.parse(list || '[]'); } catch (_error) { list = []; } }
    return Array.isArray(list) ? list.find(event => event?.type === 'shared_author') || null : null;
}

module.exports = {
    ensureReady, schedulePush, syncLocal, ensureShare, invite, shareForSession, inbox, respond, joinByLink, listMine, leave, removeMember,
    onLocalDeleted, accounts, listGroups, saveGroup, deleteGroup, recent, authorOf, linkFor, sharedFilesBase,
    _resetCache: () => { linkedCache = null; }
};
