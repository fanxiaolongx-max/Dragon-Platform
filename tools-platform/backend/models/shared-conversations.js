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
            await run(`CREATE TABLE IF NOT EXISTS shared_conversation_skill_grants (
                id TEXT PRIMARY KEY,
                share_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                skill_name TEXT NOT NULL DEFAULT '',
                approver TEXT NOT NULL,
                approver_tenant TEXT NOT NULL DEFAULT 'default',
                requester TEXT NOT NULL,
                requester_tenant TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                is_builtin INTEGER NOT NULL DEFAULT 0,
                snapshot_json TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                decided_at DATETIME
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_shared_skill_grants_share ON shared_conversation_skill_grants(share_id, skill_id)');
            await run('CREATE INDEX IF NOT EXISTS idx_shared_skill_grants_approver ON shared_conversation_skill_grants(approver, status)');
            await run(`CREATE TABLE IF NOT EXISTS shared_conversation_skill_members (
                grant_id TEXT NOT NULL,
                username TEXT NOT NULL,
                tenant_id TEXT NOT NULL DEFAULT 'default',
                installed_id TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'imported',
                conflict_action TEXT NOT NULL DEFAULT '',
                granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (grant_id, username, tenant_id)
            )`);
            const cols = await all('PRAGMA table_info(shared_conversations)').catch(() => []);
            const colNames = new Set(cols.map(c => c.name));
            if (!colNames.has('origin_root')) {
                await run("ALTER TABLE shared_conversations ADD COLUMN origin_root TEXT NOT NULL DEFAULT ''").catch(() => {});
            }
            if (!colNames.has('workspace_shared')) {
                await run('ALTER TABLE shared_conversations ADD COLUMN workspace_shared INTEGER NOT NULL DEFAULT 1').catch(() => {});
            }
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

// ── 附件与生成文件：正文链接、工具产物、工作区生成文件的跨账号安全中转 ──
const FILE_ARG_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit', 'read_file', 'read_document', 'query_data', 'diff_files', 'view_image']);
const artifacts = () => require('./agent-artifacts');
const guard = () => require('./agent-path-guard');
const boundary = () => require('./team-boundary');

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
function uploadDirFor(tenantId, username) {
    return artifacts().uploadDir(`${tenantId}::${username}`);
}
function ownerDirFor(tenantId, username) {
    return artifacts().ownerDir(`${tenantId}::${username}`);
}
function isSafeCopyTarget(real, allowedRoots = [], allowRelativeDotInTrusted = true) {
    try { guard().assertNotSecretFile(real); } catch (_error) { return false; }
    // 禁止读取任意隐藏目录（.git/.ssh/.aws 等）；平台自己的 artifacts/uploads/shared 与已知代理媒体目录例外
    const trustedBases = [
        artifacts().baseDir(),
        artifacts().uploadsBase(),
        sharedFilesBase(),
        path.join(require('os').homedir(), '.codex'),
        path.join(require('os').homedir(), '.gemini', 'antigravity', 'brain')
    ].map(realOrSelf);
    const trustedBase = allowRelativeDotInTrusted && trustedBases.find(base => inside(base, real));
    const inspected = trustedBase ? path.relative(trustedBase, real) : real;
    if (inspected.split(/[\\/]/).some(part => part.startsWith('.') && part !== '.' && part !== '..' && part !== '.user_uploaded')) {
        return false;
    }
    return allowedRoots.some(root => root && inside(root, real));
}
async function copyInto(source, dir, cache = null) {
    const real = realOrSelf(source);
    const stat = await fsp.stat(real).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > MAX_FILE_BYTES) return '';
    const cacheKey = `${real}\0${stat.mtimeMs}\0${stat.size}`;
    if (cache?.has(cacheKey)) return cache.get(cacheKey);
    const target = path.join(dir, crypto.randomBytes(4).toString('hex'), path.basename(real));
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fsp.copyFile(real, target);
    cache?.set(cacheKey, target);
    return target;
}
function normalizeFileRef(raw, { baseRoot = '', allowTilde = false } = {}) {
    let value = String(raw || '').trim();
    if (!value || value.length > 4096 || /[\0\r\n]/.test(value)) return '';
    if (/^(?:https?:|data:|mailto:|javascript:|#)/i.test(value)) return '';
    if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim();
    if (/^file:\/\//i.test(value)) {
        try { value = decodeURIComponent(new URL(value).pathname); } catch (_error) { return ''; }
        if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    }
    value = value.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/(\.[A-Za-z0-9]{1,8}):\d+(?::\d+)?$/, '$1');
    if (value.startsWith('~/')) {
        if (!allowTilde) return '';
        value = path.join(require('os').homedir(), value.slice(2));
    }
    if (path.isAbsolute(value)) return path.resolve(value);
    if (baseRoot && /\.[A-Za-z0-9]{1,8}$/.test(value)) return path.resolve(baseRoot, value);
    return '';
}
async function resolveSenderRoot(member, session) {
    if (session?.agent_root) return session.agent_root;
    if (session?.agent_session_id) {
        const saved = await require('./agent-transcript-repository').load(session.agent_session_id).catch(() => null);
        if (saved?.root) return saved.root;
    }
    if (tenantContext.normalizeTenantId(member.tenant_id) !== tenantContext.DEFAULT_TENANT_ID) {
        return boundary().workspaceRoot(member.tenant_id);
    }
    return '';
}
function createPathRelinker({ allowedRoots, baseRoot = '', allowTilde = false, allowPlatformOutputs = false, toDir, cache }) {
    const roots = allowedRoots.filter(Boolean);
    if (allowPlatformOutputs) roots.push(path.resolve(__dirname, '../../outputs'));
    return async (raw, { extraRoots = [] } = {}) => {
        const resolved = normalizeFileRef(raw, { baseRoot, allowTilde });
        if (!resolved) return '';
        const real = realOrSelf(resolved);
        const permitted = [...roots, ...extraRoots.filter(Boolean)];
        if (!isSafeCopyTarget(real, permitted)) return '';
        return copyInto(real, toDir, cache).catch(() => '');
    };
}
/** 把正文里的附件、工具产物与工作区文件链接复制到 toDir，并统一改写成指向副本的链接 */
async function relinkFiles(text, relinkOrFromBase, toDir, cache = new Map()) {
    const relink = typeof relinkOrFromBase === 'function'
        ? relinkOrFromBase
        : createPathRelinker({ allowedRoots: [relinkOrFromBase], toDir, cache });
    const files = new Map();
    const record = (copied, tool = 'file') => {
        if (copied && !files.has(copied)) files.set(copied, { name: path.basename(copied), path: copied, tool });
    };
    let result = String(text || '');
    // 1. 尖括号本地路径：(<path>)
    for (const original of [...new Set([...result.matchAll(/\(<([^>\n]+)>\)/g)].map(match => match[1]))]) {
        const copied = await relink(original);
        if (copied) {
            result = result.split(`(<${original}>)`).join(`(<${copied}>)`);
            record(copied);
        }
    }
    // 2. /api/agent-files/(raw|view|download|stat)?path=... 链接
    for (const match of [...result.matchAll(/(\/api\/agent-files\/(?:raw|view|download|stat)\?[^\s)"'`>]+)/g)]) {
        const fullUrl = match[1];
        try {
            const parsed = new URL(fullUrl, 'http://localhost');
            const rawPath = parsed.searchParams.get('path') || '';
            const copied = await relink(rawPath);
            if (copied) {
                parsed.searchParams.set('path', copied);
                result = result.split(fullUrl).join(`${parsed.pathname}${parsed.search}`);
                record(copied);
            }
        } catch (_error) { /* ignore malformed query */ }
    }
    // 3. 普通 Markdown 链接/图片：[name](path) 或 ![alt](path)（不含已转成 <...> 或远程 URL 的）
    for (const match of [...result.matchAll(/(!?\[[^\]]*\]\()([^<)\n]+)(\))/g)]) {
        const rawHref = String(match[2] || '').trim().replace(/\s+"[^"]*"$/, '');
        if (!rawHref || /^(?:https?:|data:|mailto:|\/api\/|#)/i.test(rawHref)) continue;
        const copied = await relink(rawHref);
        if (copied) {
            result = result.split(`${match[1]}${match[2]}${match[3]}`).join(`${match[1]}<${copied}>${match[3]}`);
            record(copied);
        }
    }
    return typeof relinkOrFromBase === 'function' ? { content: result, files: [...files.values()] } : result;
}
async function relinkEvents(events, relink, { recordFile } = {}) {
    if (!Array.isArray(events)) return [];
    const next = [];
    for (const rawEvent of events) {
        if (!rawEvent || typeof rawEvent !== 'object' || rawEvent.type === 'workspace_checkpoint') continue;
        const event = { ...rawEvent };
        if (event.type === 'tool_start' && event.args && typeof event.args === 'object') {
            const candidate = event.sharedPath || (FILE_ARG_TOOLS.has(event.tool) ? event.args.path : '');
            if (candidate) {
                const copied = await relink(candidate);
                if (copied) {
                    event.sharedPath = copied;
                    recordFile?.(copied, event.tool);
                }
            }
        } else if (event.type === 'tool_result') {
            if (event.artifact?.path) {
                const copied = await relink(event.artifact.path);
                if (copied) {
                    event.artifact = { ...event.artifact, path: copied };
                    recordFile?.(copied, event.tool || 'artifact');
                }
            }
            if (Array.isArray(event.images) && event.images.length) {
                const mapped = [];
                for (const img of event.images) {
                    const copied = await relink(img, { extraRoots: [path.join(require('os').homedir(), '.codex'), path.join(require('os').homedir(), '.gemini', 'antigravity', 'brain')] });
                    mapped.push(copied || img);
                    if (copied) recordFile?.(copied, event.tool || 'image');
                }
                event.images = mapped;
            }
            if (event.sharedPath) {
                const copied = await relink(event.sharedPath);
                if (copied) {
                    event.sharedPath = copied;
                    recordFile?.(copied, event.tool);
                }
            }
        } else if (event.type === 'shared_files' && Array.isArray(event.files)) {
            const synced = [];
            for (const file of event.files) {
                if (!file?.path) continue;
                const copied = await relink(file.path);
                const finalPath = copied || file.path;
                synced.push({ ...file, path: finalPath });
                if (copied) recordFile?.(copied, file.tool);
            }
            event.files = synced;
        }
        next.push(event);
    }
    return next;
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
    const originRoot = share.status === 'active' && Number(share.workspace_shared ?? 1) === 1
        ? await resolveOriginWorkspaceRoot(share).catch(() => '')
        : '';
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
        sharedWorkspace: originRoot ? {
            enabled: true,
            shareId: share.id,
            owner: share.owner,
            ownerName: names[share.owner] || share.owner,
            isOwner: share.owner === me,
            folderName: path.basename(originRoot) || '共享工作区',
            writable: true,
            canRunCommand: share.owner === me,
            virtualRoot: `shared-ws://${share.id}`
        } : null,
        members: members.filter(item => !['left', 'removed'].includes(item.status)).map(item => ({
            username: item.username, name: names[item.username] || item.username, role: item.role, status: item.status, via: item.via
        }))
    };
}

function mergeSharedFilesEvent(events, extraFiles = []) {
    const list = Array.isArray(events) ? events.filter(event => event && event.type !== 'shared_files') : [];
    const merged = new Map();
    for (const event of Array.isArray(events) ? events : []) {
        if (event?.type === 'shared_files' && Array.isArray(event.files)) {
            for (const file of event.files) if (file?.path) merged.set(file.path, file);
        }
    }
    for (const file of extraFiles) if (file?.path) merged.set(file.path, file);
    if (merged.size) list.push({ type: 'shared_files', files: [...merged.values()] });
    return list;
}

// ── 推送 / 拉取 ──
async function pushMember(share, member) {
    const repo = chatRepo();
    const rows = await repo.listMessagesForShare(member.local_session_id);
    if (!rows.length) return 0;
    const pushed = new Set((await all('SELECT local_message_id FROM shared_conversation_pushed WHERE share_id = ? AND username = ?', [share.id, member.username])).map(row => row.local_message_id));
    const names = await displayNames([member.username]);
    const session = await repo.getSession(member.local_session_id);
    if (share.owner === member.username && share.origin_session_id === member.local_session_id && session?.agent_root && isShareableWorkspaceRoot(session.agent_root)) {
        const realOrigin = realOrSelf(session.agent_root);
        if (share.origin_root !== realOrigin) {
            await run('UPDATE shared_conversations SET origin_root = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [realOrigin, share.id]).catch(() => {});
            share.origin_root = realOrigin;
        }
    }
    const senderRoot = await resolveSenderRoot(member, session);
    const sharedOriginRoot = (!senderRoot && Number(share.workspace_shared ?? 1) === 1)
        ? await resolveOriginWorkspaceRoot(share).catch(() => '')
        : '';
    const effectiveBaseRoot = senderRoot || sharedOriginRoot;
    const isUnconfined = tenantContext.normalizeTenantId(member.tenant_id) === tenantContext.DEFAULT_TENANT_ID;
    const sharedDir = path.join(sharedFilesBase(), share.id);
    const copyCache = new Map();
    const relink = createPathRelinker({
        allowedRoots: [uploadDirFor(member.tenant_id, member.username), ownerDirFor(member.tenant_id, member.username), senderRoot, sharedOriginRoot],
        baseRoot: effectiveBaseRoot,
        allowTilde: isUnconfined,
        allowPlatformOutputs: true,
        toDir: sharedDir,
        cache: copyCache
    });
    let count = 0;
    for (const row of rows) {
        if (pushed.has(row.id) || !String(row.content || '').trim()) continue;
        let events = [];
        try { events = row.events ? JSON.parse(row.events) : []; } catch (_error) { events = []; }
        if (!Array.isArray(events)) events = [];
        if (events.some(event => event?.type === 'shared_author')) continue; // 别人的消息拉进来的副本
        if (String(row.id).startsWith('agent_') && !Number(row.agent_final)) break; // 工作区回答还没结束：保持顺序，等结束再推
        const collected = new Map();
        const recordFile = (copied, tool = 'file') => {
            if (copied && !collected.has(copied)) collected.set(copied, { name: path.basename(copied), path: copied, tool });
        };
        const contentResult = await relinkFiles(row.content, relink, sharedDir, copyCache);
        for (const file of contentResult.files) recordFile(file.path, file.tool);
        const relinkedEvents = mergeSharedFilesEvent(
            await relinkEvents(events, relink, { recordFile }),
            [...collected.values()]
        );
        const result = await run(`INSERT INTO shared_conversation_messages (share_id, author, author_name, role, content, events, model_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [share.id, member.username, names[member.username] || member.username, row.role === 'model' ? 'model' : 'user', contentResult.content,
            JSON.stringify(relinkedEvents), String(row.model_name || '').slice(0, 120)]);
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
    const sharedDir = path.join(sharedFilesBase(), share.id);
    const recipientDir = path.join(uploadDirFor(member.tenant_id, member.username), `shared-${share.id}`);
    const copyCache = new Map();
    const relink = createPathRelinker({ allowedRoots: [sharedDir], toDir: recipientDir, cache: copyCache });
    let count = 0;
    let seq = Number(member.pulled_seq) || 0;
    for (const row of rows) {
        seq = row.seq;
        if (row.author === member.username) continue;
        let events = [];
        try { events = row.events ? JSON.parse(row.events) : []; } catch (_error) { events = []; }
        const collected = new Map();
        const recordFile = (copied, tool = 'file') => {
            if (copied && !collected.has(copied)) collected.set(copied, { name: path.basename(copied), path: copied, tool });
        };
        const contentResult = await relinkFiles(row.content, relink, recipientDir, copyCache);
        for (const file of contentResult.files) recordFile(file.path, file.tool);
        const relinkedEvents = mergeSharedFilesEvent(
            await relinkEvents(Array.isArray(events) ? events : [], relink, { recordFile }),
            [...collected.values()]
        );
        await repo.addMessage({
            sessionId: member.local_session_id,
            pagePath: session?.page_path || '/',
            pageTitle: session?.page_title || '',
            owner: member.username,
            role: row.role,
            content: contentResult.content,
            modelName: row.model_name,
            events: [...relinkedEvents, { type: 'shared_author', author: row.author, name: row.author_name || row.author, at: row.created_at }]
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
        await applyApprovedSkillGrants(share.id, fresh).catch(() => {});
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
    await resolveOriginWorkspaceRoot(share).catch(() => '');
    // 先把已有的历史推到中转，被邀请的人一接受就能看到完整上下文
    await syncLocal({ tenantId, username, sessionId });
    return getShare(share.id);
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

async function shareForSession({ tenantId, username, sessionId, role = '' }) {
    await ensureReady();
    const member = await get(`SELECT share_id FROM shared_conversation_members WHERE tenant_id = ? AND username = ? AND local_session_id = ? AND status = 'accepted'`, [tenantId, username, String(sessionId || '')]);
    const share = member ? await getShare(member.share_id)
        : await get('SELECT * FROM shared_conversations WHERE owner_tenant = ? AND owner = ? AND origin_session_id = ?', [tenantId, username, String(sessionId || '')]);
    if (!share) return null;
    const base = await describe(share, username);
    const caps = await sessionCapabilities({ tenantId, username, role, sessionId, shareId: share.id }).catch(() => ({ skills: [], tools: [], aliases: {}, pendingForMe: [] }));
    return {
        ...base,
        missingCapabilities: { skills: caps.skills, tools: caps.tools },
        pendingSkillRequests: caps.pendingForMe,
        skillAliases: caps.aliases
    };
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
    await applyApprovedSkillGrants(share.id, { username, tenant_id: tenantId }).catch(() => {});
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
        WHERE m.username = ? AND m.tenant_id = ? AND s.status = 'active' AND m.status = 'accepted' AND m.local_session_id <> ''`, [username, tenantId]);
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

/** 给模型的上下文：别人发的提问与回复标注发送账号，并提取消息关联的共享/产物文件 */
function parseEventsList(events) {
    let list = events;
    if (typeof list === 'string') { try { list = JSON.parse(list || '[]'); } catch (_error) { list = []; } }
    return Array.isArray(list) ? list : [];
}
function authorOf(events) {
    return parseEventsList(events).find(event => event?.type === 'shared_author') || null;
}
function filesOf(events) {
    const list = parseEventsList(events);
    const found = new Map();
    const put = (filePath, tool = 'file') => {
        if (!filePath || !path.isAbsolute(String(filePath))) return;
        if (!found.has(filePath)) found.set(filePath, { name: path.basename(String(filePath)), path: String(filePath), tool });
    };
    for (const event of list) {
        if (event?.type === 'shared_files' && Array.isArray(event.files)) {
            for (const file of event.files) put(file?.path, file?.tool);
        } else if (event?.type === 'tool_start' && event.sharedPath) {
            put(event.sharedPath, event.tool);
        } else if (event?.type === 'tool_result') {
            if (event.artifact?.path) put(event.artifact.path, event.tool || 'artifact');
            if (event.sharedPath) put(event.sharedPath, event.tool);
            if (Array.isArray(event.images)) for (const img of event.images) put(img, event.tool || 'image');
        }
    }
    return [...found.values()];
}
async function syncIfShared({ tenantId, username, sessionId }) {
    if (!sessionId || !username) return null;
    const set = await linkedSet();
    if (!set.has(`${tenantId}\n${username}\n${sessionId}`)) return null;
    return syncLocal({ tenantId, username, sessionId });
}

const RESTRICTED_TOOL_RE = /^(?:mcp__|welink_|netcare_|ops_|open_autoglm|finance_|ppo_|voice_creator_|.*_uiv_script$|(?:insert|update|delete)_database_row|run_command$)/;

function historyCapabilitiesIn(messages = []) {
    const skillIds = [];
    const skillSet = new Set();
    const tools = [];
    const toolSet = new Set();
    for (const msg of messages) {
        const list = parseEventsList(msg?.events);
        for (const ev of list) {
            if (ev?.type === 'skills' && Array.isArray(ev.skills)) {
                for (const id of ev.skills) {
                    const clean = String(id || '').trim().toLowerCase();
                    if (clean && !skillSet.has(clean)) { skillSet.add(clean); skillIds.push(clean); }
                }
            }
            if (ev?.type === 'tool_start' && ev.tool && RESTRICTED_TOOL_RE.test(String(ev.tool))) {
                const name = String(ev.tool);
                if (!toolSet.has(name)) { toolSet.add(name); tools.push(name); }
            }
        }
    }
    return { skillIds, tools };
}

async function grantedSkillMemberships(tenantId, username) {
    await ensureReady();
    return all(`SELECT m.*, g.share_id, g.skill_id, g.skill_name, g.approver, g.approver_tenant, g.is_builtin, g.snapshot_json
        FROM shared_conversation_skill_members m
        JOIN shared_conversation_skill_grants g ON g.id = m.grant_id
        WHERE m.username = ? AND m.tenant_id = ? AND g.status = 'approved'`, [username, tenantId]);
}

async function resolveSkillOrigin(shareId, skillId) {
    const cleanId = String(skillId || '').trim().toLowerCase();
    const store = require('./agent-skills-store');
    const dist = require('./tool-distribution');
    const share = await getShare(shareId);
    if (!share) return null;
    const isPublic = await dist.hasEntryAccess(`skill:${cleanId}`).catch(() => false);
    const candidates = await all("SELECT username, tenant_id, role FROM shared_conversation_members WHERE share_id = ? AND status = 'accepted' ORDER BY role = 'owner' DESC", [shareId]);
    const ordered = [
        { username: share.owner, tenant_id: share.owner_tenant },
        ...candidates.filter(c => c.username !== share.owner)
    ];
    for (const member of ordered) {
        if (!member.tenant_id || member.tenant_id === tenantContext.DEFAULT_TENANT_ID) continue;
        const found = await tenantContext.runWithTenant(member.tenant_id, async () => {
            const custom = await store.getCustom(cleanId);
            if (!custom) return null;
            const prefs = await dist.personalEntry({ username: member.username, role: 'admin' }, `skill:${cleanId}`);
            if (prefs?.grant || prefs?.origin) return null;
            return { skill: { ...custom, builtIn: false, markdown: store.toPublicationSnapshot(custom, custom.files).markdown }, owner: custom.createdBy || member.username, ownerTenant: member.tenant_id, isBuiltin: false };
        }).catch(() => null);
        if (found) return { ...found, isPublic };
    }
    const map = await userMap();
    const superAdmin = Object.values(map).find(u => u.role === 'admin' && (u.tenantId || 'default') === tenantContext.DEFAULT_TENANT_ID)?.username || share.owner;
    const plat = await tenantContext.runWithTenant(tenantContext.DEFAULT_TENANT_ID, () => store.getSkill(cleanId)).catch(() => null);
    if (!plat) return { skill: null, owner: superAdmin, ownerTenant: tenantContext.DEFAULT_TENANT_ID, isBuiltin: false, isPublic };
    const owner = !plat.builtIn && plat.createdBy && map[plat.createdBy] ? plat.createdBy : superAdmin;
    return { skill: plat, owner, ownerTenant: tenantContext.DEFAULT_TENANT_ID, isBuiltin: Boolean(plat.builtIn), isPublic };
}

function deriveAliasId(baseId, owner, takenSet) {
    const clean = String(baseId || 'skill').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const suffix = crypto.createHash('sha1').update(`${baseId}:${owner}`).digest('hex').slice(0, 4);
    const candidates = [
        `${clean.slice(0, 32)}-s-${suffix}`,
        `${clean.slice(0, 29)}-s-${suffix}2`,
        `${clean.slice(0, 29)}-${crypto.randomBytes(2).toString('hex')}`
    ];
    return candidates.find(id => /^[a-z][a-z0-9-]{1,40}$/.test(id) && !takenSet.has(id)) || `skill-${crypto.randomBytes(4).toString('hex')}`;
}

async function installGrantForMember(grant, member) {
    const store = require('./agent-skills-store');
    const dist = require('./tool-distribution');
    const skillId = String(grant.skill_id || '').toLowerCase();
    let snapshot = null;
    try { snapshot = grant.snapshot_json ? JSON.parse(grant.snapshot_json) : null; } catch { snapshot = null; }
    if (!snapshot) return { installedId: skillId, mode: 'missing_snapshot', conflictAction: '' };
    const isPublic = await dist.hasEntryAccess(`skill:${skillId}`).catch(() => false);
    if (member.username === grant.approver && member.tenant_id === grant.approver_tenant) {
        await run(`INSERT OR REPLACE INTO shared_conversation_skill_members (grant_id, username, tenant_id, installed_id, mode, conflict_action) VALUES (?, ?, ?, ?, 'owner', '')`,
            [grant.id, member.username, member.tenant_id, skillId]);
        return { installedId: skillId, mode: 'owner', conflictAction: '' };
    }
    if (isPublic) {
        await run(`INSERT OR REPLACE INTO shared_conversation_skill_members (grant_id, username, tenant_id, installed_id, mode, conflict_action) VALUES (?, ?, ?, ?, 'public', 'superseded_by_public')`,
            [grant.id, member.username, member.tenant_id, skillId]);
        return { installedId: skillId, mode: 'public', conflictAction: 'superseded_by_public' };
    }
    if (Number(grant.is_builtin) || member.tenant_id === tenantContext.DEFAULT_TENANT_ID) {
        const mode = Number(grant.is_builtin) ? 'scoped-builtin' : 'scoped-platform';
        await run(`INSERT OR REPLACE INTO shared_conversation_skill_members (grant_id, username, tenant_id, installed_id, mode, conflict_action) VALUES (?, ?, ?, ?, ?, '')`,
            [grant.id, member.username, member.tenant_id, skillId, mode]);
        return { installedId: skillId, mode, conflictAction: '' };
    }
    const outcome = await tenantContext.runWithTenant(member.tenant_id, async () => {
        const allLocal = await store.listAll({ includeHidden: true });
        const taken = new Set(allLocal.map(item => item.id));
        const existingCustom = await store.getCustom(skillId);
        const prefs = await dist.personalEntry({ username: member.username, role: 'admin' }, `skill:${skillId}`);
        let targetId = skillId;
        let conflictAction = '';
        if (existingCustom && !prefs?.grant) {
            targetId = deriveAliasId(skillId, grant.approver, taken);
            conflictAction = 'renamed_alias';
        }
        await store.installSharedGrant(snapshot, {
            targetId,
            sourceId: skillId,
            grantId: grant.id,
            shareId: grant.share_id,
            owner: grant.approver,
            user: { username: member.username, role: 'admin' }
        });
        return { installedId: targetId, mode: 'imported', conflictAction };
    });
    await run(`INSERT OR REPLACE INTO shared_conversation_skill_members (grant_id, username, tenant_id, installed_id, mode, conflict_action) VALUES (?, ?, ?, ?, ?, ?)`,
        [grant.id, member.username, member.tenant_id, outcome.installedId, outcome.mode, outcome.conflictAction]);
    return outcome;
}

async function applyApprovedSkillGrants(shareId, member) {
    await ensureReady();
    const approved = await all("SELECT * FROM shared_conversation_skill_grants WHERE share_id = ? AND status = 'approved'", [shareId]);
    for (const grant of approved) {
        await installGrantForMember(grant, member).catch(error => console.warn('[shared-conversations] install skill grant failed:', error.message));
    }
}

async function notifyApproverExternal(grant, shareTitle, requesterName) {
    try {
        const inbox = require('./agent-approval-inbox');
        const settings = await tenantContext.runWithTenant(grant.approver_tenant || 'default', () => inbox.getSettings(grant.approver));
        if (!settings?.enabled || !settings.targets?.length) return;
        const text = `**🔐 私有 Skill 共享审批**\n${requesterName} 在共享对话「${shareTitle}」中申请使用你维护的技能 \`@${grant.skill_id}\`（${grant.skill_name || grant.skill_id}）。\n同意后将向该共享对话的成员导入此技能（非全员开放），请登录 Dragon Claw 在横幅或消息中心处理。`;
        if (settings.channel === 'welink-cli') {
            const agent = require('./channels/welink-cli-agent');
            const runner = require('./channels/welink-cli-runner');
            for (const target of settings.targets) {
                const built = agent.buildArgs(target.kind === 'group' ? { command: 'im send-to-group', options: { 'group-id': target.id, text } } : { command: 'im send-to-user', options: { receiver: target.id, text } }, { mode: 'write' });
                await runner.run(built.args).catch(() => {});
            }
        } else {
            await require('./channels').push({ channel: settings.channel, text, targets: settings.targets, trigger: 'system', source: 'Dragon Claw 共享技能审批' }).catch(() => {});
        }
    } catch { /* best-effort */ }
}

async function sessionCapabilities({ tenantId, username, role = '', sessionId, shareId = '' }) {
    await ensureReady();
    if (!shareId) {
        const member = await memberByLocal(tenantId, username, sessionId);
        if (!member) return { skills: [], tools: [], aliases: {}, pendingForMe: [] };
        shareId = member.share_id;
    }
    const share = await getShare(shareId);
    if (!share) return { skills: [], tools: [], aliases: {}, pendingForMe: [] };
    const rows = await chatRepo().listMessagesForShare(sessionId);
    const { skillIds, tools: historyTools } = historyCapabilitiesIn(rows);
    const store = require('./agent-skills-store');
    const availableSkills = await store.listForUser({ username, role: role || (tenantId === tenantContext.DEFAULT_TENANT_ID ? 'admin' : 'admin') });
    const availableSet = new Set(availableSkills.map(s => s.id));
    const memberGrants = await grantedSkillMemberships(tenantId, username);
    const aliases = {};
    for (const mg of memberGrants) {
        if (mg.share_id === shareId && mg.installed_id && availableSet.has(mg.installed_id)) {
            aliases[mg.skill_id] = mg.installed_id;
        }
    }
    const grants = await all('SELECT * FROM shared_conversation_skill_grants WHERE share_id = ?', [shareId]);
    const names = await displayNames([share.owner, ...grants.flatMap(g => [g.approver, g.requester])]);
    const missingSkills = [];
    for (const skillId of skillIds) {
        if (availableSet.has(skillId) || (aliases[skillId] && availableSet.has(aliases[skillId]))) continue;
        const origin = await resolveSkillOrigin(shareId, skillId);
        const existingGrant = grants.find(g => g.skill_id === skillId && (g.status === 'pending' || g.status === 'approved'));
        const lastRejected = !existingGrant && grants.find(g => g.skill_id === skillId && g.status === 'rejected');
        const approver = existingGrant?.approver || origin?.owner || '';
        const extraNames = approver ? await displayNames([approver]) : {};
        missingSkills.push({
            id: skillId,
            name: existingGrant?.skill_name || origin?.skill?.name || skillId,
            owner: approver,
            ownerName: extraNames[approver] || names[approver] || approver,
            isBuiltin: Boolean(origin?.isBuiltin),
            canRequest: Boolean(origin?.skill) && approver !== username,
            status: existingGrant?.status || (lastRejected ? 'rejected' : 'none'),
            requestId: existingGrant?.id || '',
            reason: !origin?.skill ? 'not_installed' : 'not_shared'
        });
    }
    const ADMIN_DB_WRITE_TOOLS = new Set(['insert_database_row', 'update_database_rows', 'delete_database_rows']);
    const allowedTool = await require('./agent-tool-access').forActor({ username, role: role || 'user' }, `${tenantId}::${username}`);
    const missingTools = historyTools
        .filter(tool => !allowedTool(tool) || ((role || 'user') !== 'admin' && ADMIN_DB_WRITE_TOOLS.has(tool)))
        .map(name => ({ name, reason: !allowedTool(name) ? 'tool_disabled_or_restricted' : 'admin_only' }));
    const isSuper = role === 'admin' && tenantId === tenantContext.DEFAULT_TENANT_ID;
    const formatSkillReq = (g, titleText = share.title) => ({
        id: g.id,
        requestId: g.id,
        shareId: g.share_id,
        sessionId: sessionId || '',
        title: titleText,
        shareTitle: titleText,
        skillId: g.skill_id,
        skillName: g.skill_name || g.skill_id,
        requestedBy: g.requester,
        requestedByName: names[g.requester] || g.requester,
        requester: g.requester,
        requesterName: names[g.requester] || g.requester,
        approver: g.approver,
        approverName: names[g.approver] || g.approver,
        isBuiltin: Boolean(g.is_builtin),
        status: g.status,
        note: g.note,
        createdAt: g.created_at
    });
    const pendingForMe = grants
        .filter(g => g.status === 'pending' && (g.approver === username || (isSuper && g.approver_tenant === tenantContext.DEFAULT_TENANT_ID)))
        .map(g => formatSkillReq(g, share.title));
    return { skills: missingSkills, tools: missingTools, aliases, pendingForMe };
}

async function requestSkillShare({ tenantId, username, role = '', sessionId, skillId, note = '' }) {
    await ensureReady();
    const cleanId = String(skillId || '').trim().toLowerCase();
    if (!cleanId) throw fail(400, 'SHARE_SKILL_REQUIRED', '缺少需要申请的技能标识');
    const member = await memberByLocal(tenantId, username, sessionId);
    const share = member ? await getShare(member.share_id) : null;
    if (!share || share.status !== 'active') throw fail(404, 'SHARE_NOT_FOUND', '仅有效的共享对话成员可以申请');
    const origin = await resolveSkillOrigin(share.id, cleanId);
    if (!origin?.skill) throw fail(404, 'SKILL_NOT_FOUND', `未找到技能 @${cleanId}，可能已被归属人删除`);
    const withUpdatedShare = async extra => ({
        ...extra,
        share: await shareForSession({ tenantId, username, role, sessionId })
    });
    if (origin.isPublic) return withUpdatedShare({ status: 'already_available', alreadyAvailable: true, skillId: cleanId, reason: 'public' });
    const store = require('./agent-skills-store');
    const avail = await store.listForUser({ username, role: role || (tenantId === tenantContext.DEFAULT_TENANT_ID ? 'admin' : 'admin') });
    if (avail.some(s => s.id === cleanId)) return withUpdatedShare({ status: 'already_available', alreadyAvailable: true, skillId: cleanId, reason: 'owned' });

    const existing = await get("SELECT * FROM shared_conversation_skill_grants WHERE share_id = ? AND skill_id = ? AND status IN ('pending', 'approved') ORDER BY created_at DESC LIMIT 1", [share.id, cleanId]);
    if (existing?.status === 'pending') return withUpdatedShare({ status: 'pending', deduplicated: true, request: existing });
    if (existing?.status === 'approved') {
        const outcome = await installGrantForMember(existing, { username, tenant_id: tenantId });
        return withUpdatedShare({ status: 'approved', alreadyAvailable: true, grant: existing, outcome });
    }

    const requestId = newId('sgr');
    await run(`INSERT INTO shared_conversation_skill_grants (id, share_id, skill_id, skill_name, approver, approver_tenant, requester, requester_tenant, status, is_builtin, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [requestId, share.id, cleanId, String(origin.skill.name || cleanId).slice(0, 120), origin.owner, origin.ownerTenant || 'default', username, tenantId, origin.isBuiltin ? 1 : 0, String(note || '').slice(0, 300)]);
    const created = await get('SELECT * FROM shared_conversation_skill_grants WHERE id = ?', [requestId]);
    const names = await displayNames([username, origin.owner]);
    await notifyApproverExternal(created, share.title, names[username] || username);
    return withUpdatedShare({ status: 'pending', request: created });
}

async function inboxSkillRequests(username, { tenantId = 'default', isSuper = false } = {}) {
    await ensureReady();
    const rows = isSuper && tenantId === tenantContext.DEFAULT_TENANT_ID
        ? await all(`SELECT g.*, s.title AS share_title FROM shared_conversation_skill_grants g JOIN shared_conversations s ON s.id = g.share_id
            WHERE g.status = 'pending' AND s.status = 'active' AND (g.approver = ? OR g.approver_tenant = ?) ORDER BY g.created_at DESC LIMIT 50`, [username, tenantContext.DEFAULT_TENANT_ID])
        : await all(`SELECT g.*, s.title AS share_title FROM shared_conversation_skill_grants g JOIN shared_conversations s ON s.id = g.share_id
            WHERE g.status = 'pending' AND s.status = 'active' AND g.approver = ? ORDER BY g.created_at DESC LIMIT 50`, [username]);
    const names = await displayNames(rows.flatMap(r => [r.approver, r.requester]));
    return rows.map(row => ({
        id: row.id,
        requestId: row.id,
        shareId: row.share_id,
        title: row.share_title,
        shareTitle: row.share_title,
        skillId: row.skill_id,
        skillName: row.skill_name || row.skill_id,
        requestedBy: row.requester,
        requestedByName: names[row.requester] || row.requester,
        requester: row.requester,
        requesterName: names[row.requester] || row.requester,
        approver: row.approver,
        approverName: names[row.approver] || row.approver,
        isBuiltin: Boolean(row.is_builtin),
        status: row.status,
        note: row.note,
        createdAt: row.created_at
    }));
}

async function respondSkillRequest({ tenantId = 'default', username, isSuper = false, requestId, action }) {
    await ensureReady();
    if (!['approve', 'reject'].includes(action)) throw fail(400, 'SHARE_BAD_ACTION', '无效的操作');
    const grant = await get('SELECT * FROM shared_conversation_skill_grants WHERE id = ?', [String(requestId || '')]);
    if (!grant) throw fail(404, 'SHARE_REQUEST_NOT_FOUND', '审批申请不存在或已失效');
    const share = await getShare(grant.share_id);
    if (!share || share.status !== 'active') throw fail(409, 'SHARE_CLOSED', '该共享对话已停止共享');
    const canApprove = grant.approver === username || (isSuper && grant.approver_tenant === tenantContext.DEFAULT_TENANT_ID);
    if (!canApprove) throw fail(403, 'SHARE_APPROVER_ONLY', '只有该技能的归属人或超级管理员可以审批');
    if (grant.status !== 'pending') return { status: grant.status, requestId: grant.id, skillId: grant.skill_id };

    if (action === 'reject') {
        await run("UPDATE shared_conversation_skill_grants SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = ?", [grant.id]);
        return { status: 'rejected', requestId: grant.id, skillId: grant.skill_id };
    }

    const store = require('./agent-skills-store');
    const skill = await tenantContext.runWithTenant(grant.approver_tenant || tenantContext.DEFAULT_TENANT_ID, () => store.getSkill(grant.skill_id));
    if (!skill) throw fail(404, 'SKILL_NOT_FOUND', `技能 @${grant.skill_id} 已被归属人删除，无法共享`);
    const snapshot = {
        id: skill.id,
        name: skill.name,
        markdown: skill.markdown || store.toPublicationSnapshot(skill, skill.files).markdown,
        files: skill.files || [],
        updatedAt: skill.updatedAt || ''
    };
    await run("UPDATE shared_conversation_skill_grants SET status = 'approved', skill_name = ?, snapshot_json = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?",
        [String(skill.name || grant.skill_id).slice(0, 120), JSON.stringify(snapshot), grant.id]);
    const approved = await get('SELECT * FROM shared_conversation_skill_grants WHERE id = ?', [grant.id]);
    const accepted = await all("SELECT username, tenant_id FROM shared_conversation_members WHERE share_id = ? AND status = 'accepted'", [grant.share_id]);
    const installed = [];
    for (const m of accepted) {
        const out = await installGrantForMember(approved, m).catch(error => ({ error: error.message, installedId: grant.skill_id, mode: 'error' }));
        installed.push({ username: m.username, tenantId: m.tenant_id, ...out });
    }
    return { status: 'approved', requestId: grant.id, skillId: grant.skill_id, skillName: skill.name, installed, grantedCount: installed.filter(x => !x.error).length };
}

// ── 共享工作区逻辑挂载（安全目录检查 + 实时活跃授权解析） ──
const SENSITIVE_DOT_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.npm', '.pypirc']);
function isShareableWorkspaceRoot(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') return false;
    let real;
    try {
        real = fs.realpathSync(dirPath);
        if (!fs.statSync(real).isDirectory()) return false;
    } catch {
        return false;
    }
    const os = require('os');
    const home = realOrSelf(os.homedir());
    const baseData = realOrSelf(tenantContext.BASE_DATA_DIR);
    const vaultDir = realOrSelf(path.join(baseData, 'vault'));
    const platformDir = realOrSelf(path.join(baseData, 'platform'));
    const blockedExact = new Set([
        path.parse(real).root,
        '/Users', '/home', '/Volumes', '/etc', '/var', '/usr', '/bin', '/sbin', '/System', '/Library',
        home, baseData, vaultDir, platformDir, '/Volumes/512G/wechat-local-vault'
    ].map(p => realOrSelf(p)));
    if (blockedExact.has(real)) return false;
    if (inside(vaultDir, real) || inside(platformDir, real) || inside('/Volumes/512G/wechat-local-vault', real)) return false;
    const segments = real.split(/[\\/]/).filter(Boolean);
    if (segments.some(seg => SENSITIVE_DOT_DIRS.has(seg))) return false;
    return true;
}

async function resolveOriginWorkspaceRoot(share) {
    if (!share || share.status !== 'active' || Number(share.workspace_shared ?? 1) !== 1) return '';
    let candidate = String(share.origin_root || '').trim();
    if (!candidate) {
        const originSession = await tenantContext.runWithTenant(share.owner_tenant || 'default', () => chatRepo().getSession(share.origin_session_id)).catch(() => null);
        candidate = String(originSession?.agent_root || '').trim();
        if (candidate && isShareableWorkspaceRoot(candidate)) {
            candidate = realOrSelf(candidate);
            await run('UPDATE shared_conversations SET origin_root = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [candidate, share.id]).catch(() => {});
        }
    }
    return isShareableWorkspaceRoot(candidate) ? realOrSelf(candidate) : '';
}

async function syncOriginWorkspaceRoot({ tenantId, username, sessionId, root }) {
    await ensureReady();
    if (!tenantId || !username || !sessionId || !root) return false;
    const share = await get('SELECT * FROM shared_conversations WHERE owner_tenant = ? AND owner = ? AND origin_session_id = ? AND status = \'active\'',
        [tenantId, username, String(sessionId)]);
    if (!share || !isShareableWorkspaceRoot(root)) return false;
    const real = realOrSelf(root);
    if (share.origin_root === real) return true;
    await run('UPDATE shared_conversations SET origin_root = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [real, share.id]);
    return true;
}

async function resolveSharedWorkspace({ tenantId, username, sessionId = '', shareId = '' }) {
    await ensureReady();
    if (!username) return null;
    let share = null;
    if (shareId) {
        const member = await get("SELECT * FROM shared_conversation_members WHERE share_id = ? AND username = ? AND tenant_id = ? AND status = 'accepted'",
            [String(shareId), username, tenantId]);
        if (!member) return null;
        share = await getShare(member.share_id);
    } else if (sessionId) {
        const member = await memberByLocal(tenantId, username, sessionId);
        if (!member) return null;
        share = await getShare(member.share_id);
    }
    if (!share || share.status !== 'active' || Number(share.workspace_shared ?? 1) !== 1) return null;
    const originRoot = await resolveOriginWorkspaceRoot(share);
    if (!originRoot) return null;
    const names = await displayNames([share.owner]);
    const isOwner = share.owner === username && (share.owner_tenant || 'default') === tenantId;
    return {
        shareId: share.id,
        owner: share.owner,
        ownerTenant: share.owner_tenant || 'default',
        ownerName: names[share.owner] || share.owner,
        isOwner,
        root: originRoot,
        folderName: path.basename(originRoot) || '共享工作区',
        writable: true,
        canRunCommand: isOwner,
        virtualRoot: `shared-ws://${share.id}`
    };
}

async function isSharedWorkspaceActive({ shareId, tenantId, username }) {
    return Boolean(await resolveSharedWorkspace({ shareId, tenantId, username }));
}

module.exports = {
    ensureReady, schedulePush, syncLocal, syncIfShared, ensureShare, invite, shareForSession, inbox, inboxSkillRequests, respond, joinByLink, listMine, leave, removeMember,
    onLocalDeleted, accounts, listGroups, saveGroup, deleteGroup, recent, authorOf, filesOf, linkFor, sharedFilesBase,
    sessionCapabilities, grantedSkillMemberships, requestSkillShare, respondSkillRequest,
    isShareableWorkspaceRoot, syncOriginWorkspaceRoot, resolveSharedWorkspace, isSharedWorkspaceActive,
    _resetCache: () => { linkedCache = null; }
};
