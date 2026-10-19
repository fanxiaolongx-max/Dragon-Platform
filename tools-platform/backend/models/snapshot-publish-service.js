const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { run, get, all, getDbPath } = require('./app-db');
const { getTenantId, runWithTenant } = require('./tenant-context');
const { updatePublishMenu, removePublishMenuItems, readPublishMenuItems, MENU_FILE } = require('./snapshot-publish-menu');

const execGit = promisify(execFile);
const git = (file, args, options = {}) => execGit(file, args, {
    ...options,
    env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
        GIT_ASKPASS: '',
        SSH_ASKPASS: ''
    }
});
const active = new Set();
const scheduleTimers = new Map();
const schemaInflight = new Map();
const DEFAULT_TOOL_SLUG = 'department-reward-penalty';
const TOOL_SLUG = DEFAULT_TOOL_SLUG;
const DEFAULT_FILE_TEMPLATE = '{toolSlug}/index.html';
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;
const EVIDENCE_FILE = /^[a-f0-9-]{36}\.(?:pdf|png|jpg|jpeg|txt|zip|rar|7z|tar|gz|eml|msg)$/i;
const PAGES_MARKER = '{"toolId":"department-reward-penalty","format":1}\n';
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

const { injectGatekeeper } = require('./snapshot-gatekeeper');

const explicitProviders = new Map();

function getCustomToolsRepo() {
    return require('./custom-tools-repository');
}

function getStaticToolRootDir(slug) {
    if (!slug || typeof slug !== 'string') return null;
    try {
        return getCustomToolsRepo().getToolRootDir(slug);
    } catch (_) {
        return null;
    }
}

function isStaticTool(slug) {
    const rootDir = getStaticToolRootDir(slug);
    if (!rootDir) return false;
    const indexPath = path.join(rootDir, 'index.html');
    return fs.existsSync(indexPath) && fs.statSync(indexPath).isFile();
}

function collectStaticToolFiles(rootDir) {
    const files = new Map();
    let totalBytes = 0;
    const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) continue;

            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
                if (relativePath.toLowerCase() === 'index.html') continue;

                const stat = fs.statSync(fullPath);
                totalBytes += stat.size;
                if (totalBytes > MAX_TOTAL_BYTES) {
                    throw bad('静态工具资源文件总大小超出 100 MB 限制');
                }
                files.set(relativePath, fs.readFileSync(fullPath));
            }
        }
    }

    walk(rootDir);
    return files;
}

function createStaticToolProvider(slug) {
    const rootDir = getStaticToolRootDir(slug);
    if (!rootDir) return null;
    const indexPath = path.join(rootDir, 'index.html');
    if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) return null;

    let toolName = slug;
    let toolDesc = '纯静态页面，可直接离线查看。';
    try {
        const manifestFile = path.join(rootDir, '.tool-manifest.json');
        if (fs.existsSync(manifestFile)) {
            const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
            if (parsed?.tool?.name) toolName = parsed.tool.name;
            if (parsed?.tool?.description) toolDesc = parsed.tool.description;
        }
    } catch (_) {}

    return {
        slug,
        name: toolName,
        description: toolDesc,
        defaultFile: `${slug}/index.html`,
        isGenericStatic: true,
        buildSnapshot: async (tenantId, options = {}) => {
            if (!fs.existsSync(indexPath)) throw bad(`静态工具入口 index.html 不存在：${slug}`, 404);
            let html = fs.readFileSync(indexPath, 'utf8');
            const encryption = options.encryption;
            if (encryption?.enabled && (encryption.passwordHash || encryption.hash)) {
                html = injectGatekeeper(html, encryption, slug);
            }
            return html;
        },
        buildPagesSnapshot: async (tenantId, options = {}) => {
            if (!fs.existsSync(indexPath)) throw bad(`静态工具入口 index.html 不存在：${slug}`, 404);
            let html = fs.readFileSync(indexPath, 'utf8');
            const encryption = options.encryption;
            if (encryption?.enabled && (encryption.passwordHash || encryption.hash)) {
                html = injectGatekeeper(html, encryption, slug);
            }
            const files = collectStaticToolFiles(rootDir);
            return { html, files };
        }
    };
}

function listStaticToolSlugs() {
    const slugs = new Set();
    try {
        const repo = getCustomToolsRepo();
        const customDir = repo.getCustomToolsDir();
        if (fs.existsSync(customDir)) {
            for (const dirent of fs.readdirSync(customDir, { withFileTypes: true })) {
                if (dirent.isDirectory() && !dirent.name.startsWith('.')) {
                    if (isStaticTool(dirent.name)) slugs.add(dirent.name);
                }
            }
        }
        const builtinDir = repo.BUILTIN_TOOLS_DIR;
        if (fs.existsSync(builtinDir)) {
            for (const dirent of fs.readdirSync(builtinDir, { withFileTypes: true })) {
                if (dirent.isDirectory() && !dirent.name.startsWith('.')) {
                    if (isStaticTool(dirent.name)) slugs.add(dirent.name);
                }
            }
        }
    } catch (_) {}
    return slugs;
}

class ProviderRegistry extends Map {
    has(key) {
        if (explicitProviders.has(key)) return true;
        return isStaticTool(key);
    }

    get(key) {
        if (explicitProviders.has(key)) return explicitProviders.get(key);
        if (isStaticTool(key)) return createStaticToolProvider(key);
        return undefined;
    }

    set(key, value) {
        explicitProviders.set(key, value);
        return this;
    }

    delete(key) {
        return explicitProviders.delete(key);
    }

    clear() {
        explicitProviders.clear();
    }

    *keys() {
        const seen = new Set();
        for (const key of explicitProviders.keys()) {
            seen.add(key);
            yield key;
        }
        for (const key of listStaticToolSlugs()) {
            if (!seen.has(key)) {
                seen.add(key);
                yield key;
            }
        }
    }

    *[Symbol.iterator]() {
        for (const key of this.keys()) {
            yield [key, this.get(key)];
        }
    }

    *entries() {
        yield* this[Symbol.iterator]();
    }

    *values() {
        for (const key of this.keys()) {
            yield this.get(key);
        }
    }

    get size() {
        return Array.from(this.keys()).length;
    }
}

const providers = new ProviderRegistry();

function fingerprintSnapshotBundle(output, mode) {
    const hash = crypto.createHash('sha256');
    const add = (name, contents) => {
        const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents));
        hash.update(name + '\0' + bytes.length + '\0');
        hash.update(bytes);
    };
    add('mode', mode);
    add('index.html', output.html);
    for (const [name, contents] of [...output.files].sort(([a], [b]) => a.localeCompare(b))) add(name, contents);
    return hash.digest('hex');
}

function registerProvider(slug, provider) {
    if (!slug || !provider) return;
    providers.set(slug, { slug, ...provider });
}

registerProvider('department-reward-penalty', {
    slug: 'department-reward-penalty',
    name: '负向事件管理',
    description: '查看负向事件、人员、规则及审计数据的只读快照。',
    defaultFile: 'department-reward-penalty/index.html',
    buildSnapshot: (tenantId, opts) => require('./department-reward-penalty-snapshot').buildSnapshot(tenantId, opts),
    buildPagesSnapshot: (tenantId, opts) => require('./department-reward-penalty-snapshot').buildPagesSnapshot(tenantId, opts)
});

registerProvider('reward-program', {
    slug: 'reward-program',
    name: '奖励申报与评优',
    description: '查看奖项规则、申报表彰记录、公示信息与凭据文件的只读快照。',
    defaultFile: 'reward-program/index.html',
    buildSnapshot: (tenantId, opts) => require('./reward-program-snapshot').buildSnapshot(tenantId, opts),
    buildPagesSnapshot: (tenantId, opts) => require('./reward-program-snapshot').buildPagesSnapshot(tenantId, opts)
});

registerProvider('tool-msf5b7nn', {
    slug: 'tool-msf5b7nn',
    name: '会议考勤',
    description: '查看会议考勤历史快照、明细和统计结果的只读页面。',
    defaultFile: 'tool-msf5b7nn/index.html',
    buildSnapshot: (tenantId, opts) => require('./meeting-attendance-snapshot').buildSnapshot(tenantId, opts),
    buildPagesSnapshot: (tenantId, opts) => require('./meeting-attendance-snapshot').buildPagesSnapshot(tenantId, opts)
});

registerProvider('tool-ms4xb66s', {
    slug: 'tool-ms4xb66s',
    name: '操作激励统计',
    description: '查看操作激励历史快照、核算明细及会议考勤联动结果的只读页面。',
    defaultFile: 'tool-ms4xb66s/index.html',
    buildSnapshot: (tenantId, opts) => require('./operation-incentive-snapshot').buildSnapshot(tenantId, opts),
    buildPagesSnapshot: (tenantId, opts) => require('./operation-incentive-snapshot').buildPagesSnapshot(tenantId, opts)
});

registerProvider('tool-mumxi3px', {
    name: '强控业务比对检索',
    description: '查询服务器保存的产品范围数据，推送时同步生成最新数据快照。',
    defaultFile: 'tool-mumxi3px/index.html',
    buildSnapshot: (tenantId, opts) => require('./product-scope-snapshot').buildSnapshot(tenantId, opts),
    buildPagesSnapshot: (tenantId, opts) => require('./product-scope-snapshot').buildPagesSnapshot(tenantId, opts)
});

registerProvider('datacom-protocol-expert', {
    name: '数通协议专家',
    description: '查看当前租户知识库的分类、文章、搜索及 3D 交互实验的只读快照。',
    defaultFile: 'datacom-protocol-expert/index.html',
    buildSnapshot: (tenantId, opts) => require('./datacom-knowledge-snapshot').buildSnapshot(tenantId, opts),
    buildPagesSnapshot: (tenantId, opts) => require('./datacom-knowledge-snapshot').buildPagesSnapshot(tenantId, opts)
});

registerProvider('tool-mqp55fna', {
    name: '六个一信息收集',
    description: '查看调查模板与全部提交记录的只读快照。',
    defaultFile: 'tool-mqp55fna/index.html',
    buildSnapshot: (tenantId, opts) => require('./catalog-tool-snapshot').buildSnapshot('tool-mqp55fna', tenantId, opts),
    buildPagesSnapshot: (tenantId, opts) => require('./catalog-tool-snapshot').buildPagesSnapshot('tool-mqp55fna', tenantId, opts)
});

registerProvider('f12-to-extension', {
    name: 'F12 扩展打包',
    description: '在静态页面载入脚本并下载浏览器扩展 ZIP；不签发 License。',
    defaultFile: 'f12-to-extension/index.html',
    buildSnapshot: (tenantId, opts) => require('./f12-static-packer').buildSnapshot(tenantId, opts),
    buildPagesSnapshot: (tenantId, opts) => require('./f12-static-packer').buildPagesSnapshot(tenantId, opts)
});

function getPagesMarker(toolSlug) {
    return JSON.stringify({ toolId: toolSlug, format: 1 }) + '\n';
}

function isManagedDataDir(dataDir, toolSlug) {
    if (!fs.existsSync(dataDir)) return false;
    const marker = path.join(dataDir, '.tools-platform-snapshot.json');
    if (fs.existsSync(marker) && fs.lstatSync(marker).isFile()) {
        try {
            const raw = fs.readFileSync(marker, 'utf8').trim().replace(/^\uFEFF/, '');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                if (parsed.toolId === toolSlug) return true;
                if (toolSlug === DEFAULT_TOOL_SLUG && parsed.toolId === 'department-reward-penalty') return true;
            }
        } catch (_) {}
    }
    // Heuristic fallback: if this folder contains data files from this tool's previous snapshot
    if (toolSlug === DEFAULT_TOOL_SLUG) {
        if (fs.existsSync(path.join(dataDir, 'state.json')) && fs.existsSync(path.join(dataDir, 'records.json'))) {
            return true;
        }
    } else if (toolSlug === 'reward-program') {
        if (fs.existsSync(path.join(dataDir, 'rules.json')) && fs.existsSync(path.join(dataDir, 'applications.json'))) {
            return true;
        }
    }
    return false;
}

function resolvePublishPath(template, toolSlug = TOOL_SLUG) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(toolSlug)) throw bad('工具 slug 无效');
    const file = String(template || '').trim();
    if ((file.match(/\{toolSlug\}/g) || []).length > 1) throw bad('HTML 路径只能包含一个 {toolSlug} 占位符');
    const resolved = file.replace('{toolSlug}', toolSlug);
    if (!/^[\w./-]+\.html$/.test(resolved) || resolved.startsWith('/') || resolved.split('/').some(part => !part || part === '..')) throw bad('仓库内 HTML 路径无效；仅支持 {toolSlug} 占位符');
    return resolved;
}

function rejectSymlinkParents(root, target) {
    let current = root;
    for (const part of path.relative(root, target).split(path.sep)) {
        current = path.join(current, part);
        if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw bad('目标路径包含符号链接，已停止发布');
    }
}

async function ready() {
    const key = getDbPath();
    if (schemaInflight.has(key)) return schemaInflight.get(key);
    const task = (async () => {
    await run(`CREATE TABLE IF NOT EXISTS snapshot_publish_settings (
        key TEXT PRIMARY KEY, repo_dir TEXT NOT NULL, branch TEXT NOT NULL,
        remote_url TEXT NOT NULL DEFAULT '',
        publish_mode TEXT NOT NULL DEFAULT 'single',
        encryption_enabled INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT NOT NULL DEFAULT '',
        password_salt TEXT NOT NULL DEFAULT '',
        schedule_enabled INTEGER NOT NULL DEFAULT 0,
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        schedule_anchor_at TEXT NOT NULL DEFAULT '',
        last_auto_at TEXT NOT NULL DEFAULT '',
        last_auto_error TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS snapshot_tool_settings (
        tool_slug TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        encryption_enabled INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT NOT NULL DEFAULT '',
        password_salt TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS snapshot_publish_jobs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, stage TEXT NOT NULL,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        progress INTEGER NOT NULL DEFAULT 0, entries_json TEXT NOT NULL DEFAULT '[]',
        command_logs_json TEXT NOT NULL DEFAULT '[]',
        commit_sha TEXT NOT NULL DEFAULT '', file_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    const columns = await all('PRAGMA table_info(snapshot_publish_settings)');
    if (!columns.some(column => column.name === 'remote_url')) await run("ALTER TABLE snapshot_publish_settings ADD COLUMN remote_url TEXT NOT NULL DEFAULT ''");
    if (!columns.some(column => column.name === 'publish_mode')) await run("ALTER TABLE snapshot_publish_settings ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'single'");
    if (!columns.some(column => column.name === 'encryption_enabled')) await run('ALTER TABLE snapshot_publish_settings ADD COLUMN encryption_enabled INTEGER NOT NULL DEFAULT 0');
    if (!columns.some(column => column.name === 'password_hash')) await run("ALTER TABLE snapshot_publish_settings ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''");
    if (!columns.some(column => column.name === 'password_salt')) await run("ALTER TABLE snapshot_publish_settings ADD COLUMN password_salt TEXT NOT NULL DEFAULT ''");
    if (!columns.some(column => column.name === 'schedule_enabled')) await run('ALTER TABLE snapshot_publish_settings ADD COLUMN schedule_enabled INTEGER NOT NULL DEFAULT 0');
    if (!columns.some(column => column.name === 'interval_minutes')) await run('ALTER TABLE snapshot_publish_settings ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 60');
    if (!columns.some(column => column.name === 'schedule_anchor_at')) await run("ALTER TABLE snapshot_publish_settings ADD COLUMN schedule_anchor_at TEXT NOT NULL DEFAULT ''");
    if (!columns.some(column => column.name === 'last_auto_at')) await run("ALTER TABLE snapshot_publish_settings ADD COLUMN last_auto_at TEXT NOT NULL DEFAULT ''");
    if (!columns.some(column => column.name === 'last_auto_error')) await run("ALTER TABLE snapshot_publish_settings ADD COLUMN last_auto_error TEXT NOT NULL DEFAULT ''");
    const jobColumns = await all('PRAGMA table_info(snapshot_publish_jobs)');
    if (!jobColumns.some(column => column.name === 'trigger_type')) await run("ALTER TABLE snapshot_publish_jobs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual'");
    if (!jobColumns.some(column => column.name === 'command_logs_json')) await run("ALTER TABLE snapshot_publish_jobs ADD COLUMN command_logs_json TEXT NOT NULL DEFAULT '[]'");
    if (!jobColumns.some(column => column.name === 'tool_slug')) await run("ALTER TABLE snapshot_publish_jobs ADD COLUMN tool_slug TEXT NOT NULL DEFAULT ''");
    })();
    schemaInflight.set(key, task);
    try { await task; } finally { if (schemaInflight.get(key) === task) schemaInflight.delete(key); }
}

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(String(password) + ':' + String(salt)).digest('hex');
}

function validate(settings) {
    const repoDir = String(settings.repoDir || '').trim();
    const remoteUrl = String(settings.remoteUrl || '').trim();
    const branch = String(settings.branch || '').trim();
    const file = String(settings.file || '').trim();
    const publishMode = String(settings.publishMode || 'single');
    const intervalMinutes = Number(settings.intervalMinutes == null ? 60 : settings.intervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < MIN_INTERVAL_MINUTES || intervalMinutes > MAX_INTERVAL_MINUTES) throw bad('定时推送周期须为 5–1440 分钟');
    if ((!repoDir && !remoteUrl) || !branch || !file) throw bad('请填写本地 Git 仓库或远端地址，并指定分支和 HTML 路径');
    if (!['single', 'pages'].includes(publishMode)) throw bad('推送格式无效');
    if (repoDir.length > 500 || remoteUrl.length > 500 || !/^[\w./-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw bad('仓库配置格式无效');
    const resolvedFile = resolvePublishPath(file);
    if (resolvedFile === 'index.html') throw bad('仓库根目录 index.html 保留为工具菜单，请使用 {toolSlug}/index.html 等子路径');
    if (remoteUrl) {
        if (/^https:\/\//i.test(remoteUrl)) {
            let url;
            try { url = new URL(remoteUrl); } catch { throw bad('远端 HTTPS 地址格式无效'); }
            if (!url.hostname || url.username || url.password || url.search || url.hash) throw bad('远端地址不得包含账号、密码、Token 或查询参数');
        } else if (!/^ssh:\/\/[\w@.-]+[:/]\S+$/.test(remoteUrl) && !/^git@[\w.-]+:[\w./-]+$/.test(remoteUrl)) throw bad('远端地址仅支持 HTTPS 或 SSH Git 仓库');
    }
    const resolved = repoDir ? path.resolve(repoDir) : '';
    if (!remoteUrl && !fs.existsSync(path.join(resolved, '.git'))) throw bad('本地仓库不存在或缺少 .git');

    const encryptionEnabled = settings.encryptionEnabled === true || settings.encryption_enabled === 1 || settings.encryption_enabled === true;
    const password = typeof settings.password === 'string' ? settings.password.trim() : '';
    if (encryptionEnabled && password && password.length < 4) throw bad('访问密码至少需 4 位字符');
    if (encryptionEnabled && password.length > 100) throw bad('访问密码长度不能超过 100 位字符');

    return {
        repoDir: resolved, remoteUrl, branch, file, resolvedFile, publishMode,
        encryptionEnabled, password,
        passwordHash: settings.passwordHash || '',
        passwordSalt: settings.passwordSalt || '',
        scheduleEnabled: settings.scheduleEnabled === true, intervalMinutes
    };
}

async function getToolSettings(toolSlug, includeSecrets = false) {
    await ready();
    const row = await get('SELECT * FROM snapshot_tool_settings WHERE tool_slug = ?', [toolSlug]);
    if (row) {
        const res = {
            toolSlug,
            enabled: Boolean(row.enabled),
            encryptionEnabled: Boolean(row.encryption_enabled),
            hasPassword: Boolean(row.password_hash),
            updatedAt: row.updated_at
        };
        if (includeSecrets) {
            res.passwordHash = row.password_hash || '';
            res.passwordSalt = row.password_salt || '';
        }
        return res;
    }
    // Fallback for department-reward-penalty from legacy settings table
    if (toolSlug === DEFAULT_TOOL_SLUG) {
        const legacy = await get('SELECT encryption_enabled, password_hash, password_salt, updated_at FROM snapshot_publish_settings WHERE key = ?', [DEFAULT_TOOL_SLUG]);
        if (legacy && (legacy.encryption_enabled || legacy.password_hash)) {
            const res = {
                toolSlug,
                enabled: true,
                encryptionEnabled: Boolean(legacy.encryption_enabled),
                hasPassword: Boolean(legacy.password_hash),
                updatedAt: legacy.updated_at
            };
            if (includeSecrets) {
                res.passwordHash = legacy.password_hash || '';
                res.passwordSalt = legacy.password_salt || '';
            }
            return res;
        }
    }
    const res = {
        toolSlug,
        enabled: toolSlug === DEFAULT_TOOL_SLUG,
        encryptionEnabled: false,
        hasPassword: false,
        updatedAt: ''
    };
    if (includeSecrets) {
        res.passwordHash = '';
        res.passwordSalt = '';
    }
    return res;
}

async function saveToolSettings(toolSlug, input) {
    if (!providers.has(toolSlug)) throw bad('未知的工具标识：' + toolSlug);
    await ready();
    const current = await getToolSettings(toolSlug, true);
    const enabled = input.enabled !== undefined ? Boolean(input.enabled) : current.enabled;
    const encryptionEnabled = input.encryptionEnabled === true || input.encryption_enabled === 1 || input.encryption_enabled === true;
    const password = typeof input.password === 'string' ? input.password.trim() : '';
    if (encryptionEnabled && password && password.length < 4) throw bad('访问密码至少需 4 位字符');
    if (encryptionEnabled && password.length > 100) throw bad('访问密码长度不能超过 100 位字符');

    let salt = current.passwordSalt || '';
    let hash = current.passwordHash || '';
    if (encryptionEnabled) {
        if (password) {
            salt = crypto.randomBytes(16).toString('hex');
            hash = hashPassword(password, salt);
        } else if (!hash) {
            throw bad('开启密码保护时必须设置访问密码');
        }
    } else {
        salt = '';
        hash = '';
    }

    await run(`INSERT INTO snapshot_tool_settings (tool_slug, enabled, encryption_enabled, password_hash, password_salt, updated_at)
               VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(tool_slug) DO UPDATE SET
                   enabled=excluded.enabled,
                   encryption_enabled=excluded.encryption_enabled,
                   password_hash=excluded.password_hash,
                   password_salt=excluded.password_salt,
                   updated_at=CURRENT_TIMESTAMP`,
        [toolSlug, enabled ? 1 : 0, encryptionEnabled ? 1 : 0, hash, salt]);

    // Keep legacy table row in sync if toolSlug is department-reward-penalty
    if (toolSlug === DEFAULT_TOOL_SLUG) {
        await run(`UPDATE snapshot_publish_settings SET encryption_enabled=?, password_hash=?, password_salt=?, updated_at=CURRENT_TIMESTAMP WHERE key=?`,
            [encryptionEnabled ? 1 : 0, hash, salt, DEFAULT_TOOL_SLUG]).catch(() => {});
    }

    return getToolSettings(toolSlug);
}

async function getSettings(includeSecrets = false) {
    await ready();
    const row = await get('SELECT * FROM snapshot_publish_settings WHERE key = ?', [DEFAULT_TOOL_SLUG]);
    const toolSettingsList = await Promise.all(
        Array.from(providers.keys()).map(async slug => {
            const tool = await require('./custom-tools-repository').getTool(slug).catch(() => null);
            const ts = await getToolSettings(slug, includeSecrets);
            return {
                ...ts,
                name: tool?.name || providers.get(slug).name,
                description: tool?.description || providers.get(slug).description
            };
        })
    );

    const drpSettings = toolSettingsList.find(t => t.toolSlug === DEFAULT_TOOL_SLUG) || {
        encryptionEnabled: false,
        hasPassword: false
    };

    if (!row) {
        const defaults = {
            repoDir: process.env.TOOLS_SNAPSHOT_REPO_DIR || '', remoteUrl: '',
            branch: process.env.TOOLS_SNAPSHOT_BRANCH || process.env.TOOLS_SNAPSHOT_GITHUB_BRANCH || 'master',
            file: process.env.TOOLS_SNAPSHOT_PATH || process.env.TOOLS_SNAPSHOT_GITHUB_PATH || DEFAULT_FILE_TEMPLATE,
            resolvedFile: resolvePublishPath(process.env.TOOLS_SNAPSHOT_PATH || process.env.TOOLS_SNAPSHOT_GITHUB_PATH || DEFAULT_FILE_TEMPLATE),
            publishMode: 'single',
            encryptionEnabled: drpSettings.encryptionEnabled,
            hasPassword: drpSettings.hasPassword,
            tools: toolSettingsList,
            scheduleEnabled: false, intervalMinutes: 60, lastAutoAt: '', lastAutoError: '', nextRunAt: '', source: 'environment'
        };
        if (includeSecrets) { defaults.passwordHash = drpSettings.passwordHash || ''; defaults.passwordSalt = drpSettings.passwordSalt || ''; }
        return defaults;
    }
    const result = {
        repoDir: row.repo_dir, remoteUrl: row.remote_url, branch: row.branch, file: row.file_path,
        resolvedFile: resolvePublishPath(row.file_path), publishMode: row.publish_mode || 'single',
        encryptionEnabled: drpSettings.encryptionEnabled,
        hasPassword: drpSettings.hasPassword,
        tools: toolSettingsList,
        scheduleEnabled: Boolean(row.schedule_enabled), intervalMinutes: row.interval_minutes,
        lastAutoAt: row.last_auto_at || '', lastAutoError: row.last_auto_error || '',
        nextRunAt: row.schedule_enabled ? new Date((Date.parse(row.schedule_anchor_at || row.updated_at) || Date.now()) + row.interval_minutes * 60000).toISOString() : '',
        updatedAt: row.updated_at, source: 'saved'
    };
    if (includeSecrets) {
        result.passwordHash = drpSettings.passwordHash || '';
        result.passwordSalt = drpSettings.passwordSalt || '';
    }
    return result;
}

async function saveSettings(input) {
    const value = validate(input);
    await ready();

    if (input.toolSlug && (input.encryptionEnabled !== undefined || input.password !== undefined || input.enabled !== undefined)) {
        await saveToolSettings(input.toolSlug, input);
    } else if (input.encryptionEnabled !== undefined || input.password) {
        await saveToolSettings(DEFAULT_TOOL_SLUG, input);
    }
    if (Array.isArray(input.tools)) {
        for (const t of input.tools) {
            if (t && t.toolSlug && providers.has(t.toolSlug)) {
                await saveToolSettings(t.toolSlug, t);
            }
        }
    }

    const currentTool = await getToolSettings(DEFAULT_TOOL_SLUG, true);
    let hash = currentTool.passwordHash || '';
    let salt = currentTool.passwordSalt || '';

    await run(`INSERT INTO snapshot_publish_settings (key, repo_dir, remote_url, branch, file_path, publish_mode, encryption_enabled, password_hash, password_salt, schedule_enabled, interval_minutes, schedule_anchor_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET repo_dir=excluded.repo_dir, remote_url=excluded.remote_url, branch=excluded.branch, file_path=excluded.file_path,
            publish_mode=excluded.publish_mode, encryption_enabled=excluded.encryption_enabled, password_hash=excluded.password_hash, password_salt=excluded.password_salt,
            schedule_enabled=excluded.schedule_enabled, interval_minutes=excluded.interval_minutes, schedule_anchor_at=excluded.schedule_anchor_at, updated_at=CURRENT_TIMESTAMP`,
    [DEFAULT_TOOL_SLUG, value.repoDir, value.remoteUrl, value.branch, value.file, value.publishMode, currentTool.encryptionEnabled ? 1 : 0, hash, salt, value.scheduleEnabled ? 1 : 0, value.intervalMinutes, new Date().toISOString()]);
    await scheduleTenant(getTenantId());
    return getSettings();
}

async function getPrerequisites() {
    const logs = [];
    const log = (stage, type, msg, latencyMs = null, cmd = '') => {
        logs.push({
            at: new Date().toISOString(),
            stage,
            type, // 'info' | 'success' | 'warn' | 'error'
            msg,
            cmd,
            latencyMs
        });
    };

    const overallStart = Date.now();
    log('环境检测', 'info', '正在检测本地 Git 命令环境与版本信息...');

    let version = '';
    const gitVerStart = Date.now();
    try {
        const verRes = await git('git', ['--version'], { timeout: 5000 });
        const verDuration = Date.now() - gitVerStart;
        version = verRes.stdout.trim().slice(0, 80);
        log('环境检测', 'success', `Git 命令可用: ${version}`, verDuration, 'git --version');
    } catch (verErr) {
        const verDuration = Date.now() - gitVerStart;
        log('环境检测', 'error', `未检测到 Git 命令或执行失败: ${verErr.message}`, verDuration, 'git --version');
        return {
            gitFound: false,
            gitVersion: '',
            remoteConfigured: false,
            remoteReady: false,
            branchReady: false,
            latencyMs: verDuration,
            attempts: 1,
            maxAttempts: 10,
            message: '未检测到 Git。请安装 Git for Windows，并确认 git.exe 已加入 PATH。',
            logs
        };
    }

    const settings = await getSettings();
    if (!settings.remoteUrl && !settings.repoDir) {
        log('配置检查', 'warn', '尚未配置远端 Git 仓库地址或本地镜像目录');
        return {
            gitFound: true,
            gitVersion: version,
            remoteConfigured: false,
            remoteReady: false,
            branchReady: false,
            latencyMs: Date.now() - overallStart,
            attempts: 0,
            maxAttempts: 10,
            message: '请先配置 CodeHub 仓库的 Git 克隆地址或本地镜像目录。',
            logs
        };
    }

    let remote = '';
    let config;
    try {
        config = validate(settings);
        if (config.remoteUrl) {
            remote = config.remoteUrl;
            log('地址解析', 'info', `使用配置的远端 Git 仓库地址: ${remote}`);
        } else if (config.repoDir) {
            const originStart = Date.now();
            log('地址解析', 'info', `正在读取本地镜像仓库 origin: ${config.repoDir}...`, null, 'git -C [repoDir] remote get-url origin');
            const originRes = await git('git', ['-C', config.repoDir, 'remote', 'get-url', 'origin'], { timeout: 5000 });
            remote = originRes.stdout.trim();
            log('地址解析', 'info', `成功解析出镜像 origin: ${remote}`, Date.now() - originStart);
        }
        if (!remote) throw new Error('未能获取有效的远端 Git 地址 (Missing origin)');
    } catch (cfgErr) {
        log('配置检查', 'error', `配置校验异常: ${cfgErr.message}`);
        return {
            gitFound: true,
            gitVersion: version,
            remoteConfigured: false,
            remoteReady: false,
            branchReady: false,
            latencyMs: Date.now() - overallStart,
            attempts: 0,
            maxAttempts: 10,
            message: `配置无效：${cfgErr.message}`,
            logs
        };
    }

    const maxAttempts = 10;
    let lastError = null;
    log('网络探测', 'info', `开始探测与 CodeHub 远端分支 [${config.branch}] 的连通性 (最多尝试 ${maxAttempts} 次)...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const attemptStart = Date.now();
        const displayCmd = `git ls-remote --exit-code --heads ${remote} ${config.branch}`;
        try {
            const lsRes = await git('git', ['ls-remote', '--exit-code', '--heads', remote, config.branch], { timeout: 15000 });
            const attemptDuration = Date.now() - attemptStart;
            const branchHead = (lsRes.stdout.trim().split(/\s+/)[0] || '').slice(0, 12);
            log('远端探测', 'success', `[尝试 ${attempt}/${maxAttempts}] 成功连接远端！往返延迟: ${attemptDuration}ms${branchHead ? ` (分支 HEAD: ${branchHead})` : ''}`, attemptDuration, displayCmd);
            log('检测完成', 'success', `Git 与 CodeHub 远端连接正常，总探测耗时 ${Date.now() - overallStart}ms`);
            return {
                gitFound: true,
                gitVersion: version,
                remoteConfigured: true,
                remoteReady: true,
                branchReady: true,
                remoteUrl: remote,
                branch: config.branch,
                latencyMs: attemptDuration,
                totalDurationMs: Date.now() - overallStart,
                attempts: attempt,
                maxAttempts,
                message: `Git 可用，且分支 ${config.branch} 已就绪（延迟 ${attemptDuration}ms，尝试 ${attempt}/${maxAttempts}）。`,
                logs
            };
        } catch (err) {
            const attemptDuration = Date.now() - attemptStart;
            lastError = err;
            const isTimeout = err.killed || err.code === 'ETIMEDOUT';
            const errMsg = isTimeout ? '连接超时（超过 15 秒）' : (err.message || '网络连接失败');
            log('远端探测', 'warn', `[尝试 ${attempt}/${maxAttempts}] 连接失败 (耗时 ${attemptDuration}ms): ${errMsg}`, attemptDuration, displayCmd);

            if (attempt < maxAttempts) {
                const backoffMs = Math.min(2000, 300 * attempt);
                log('等待重试', 'info', `将在 ${backoffMs}ms 后发起第 ${attempt + 1} 次尝试...`);
                await new Promise(r => setTimeout(r, backoffMs));
            }
        }
    }

    const totalDuration = Date.now() - overallStart;
    log('检测完成', 'error', `已达到最大尝试次数 (${maxAttempts} 次)，无法连接远端分支。总耗时 ${totalDuration}ms`);
    return {
        gitFound: true,
        gitVersion: version,
        remoteConfigured: true,
        remoteReady: false,
        branchReady: false,
        remoteUrl: remote,
        branch: config.branch,
        latencyMs: null,
        totalDurationMs: totalDuration,
        attempts: maxAttempts,
        maxAttempts,
        message: `无法连接远端分支（已重试 ${maxAttempts} 次）：${lastError?.message || '未知网络错误'}`,
        logs
    };
}

async function getJob(id) {
    await ready();
    const row = await get('SELECT * FROM snapshot_publish_jobs WHERE id = ?', [id]);
    if (!row) return null;
    return {
        id: row.id, status: row.status, stage: row.stage, progress: row.progress,
        trigger: row.trigger_type || 'manual',
        toolSlug: row.tool_slug || '',
        entries: JSON.parse(row.entries_json || '[]'),
        commandLogs: JSON.parse(row.command_logs_json || '[]'),
        commit: row.commit_sha, path: row.file_path,
        createdAt: row.created_at, updatedAt: row.updated_at
    };
}

async function listJobs() {
    await ready();
    const rows = await all('SELECT * FROM snapshot_publish_jobs ORDER BY created_at DESC LIMIT 10');
    return rows.map(row => ({
        id: row.id, status: row.status, stage: row.stage, progress: row.progress,
        trigger: row.trigger_type || 'manual',
        toolSlug: row.tool_slug || '',
        entries: JSON.parse(row.entries_json || '[]'),
        commandLogs: JSON.parse(row.command_logs_json || '[]'),
        commit: row.commit_sha, path: row.file_path,
        createdAt: row.created_at, updatedAt: row.updated_at
    }));
}

async function updateJob(job, status, stage, progress, message, commit = '') {
    job.status = status; job.stage = stage; job.progress = progress;
    if (message) job.entries.push({ at: new Date().toISOString(), stage, message });
    if (commit) job.commit = commit;
    await run('UPDATE snapshot_publish_jobs SET status=?, stage=?, progress=?, entries_json=?, command_logs_json=?, commit_sha=?, updated_at=? WHERE id=?',
        [status, stage, progress, JSON.stringify(job.entries), JSON.stringify(job.commandLogs || []), job.commit || '', new Date().toISOString(), job.id]);
}

function formatSize(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

async function recordCommandLog(job, entry) {
    job.commandLogs = job.commandLogs || [];
    job.commandLogs.push(entry);
    if (job.commandLogs.length > 200) job.commandLogs = job.commandLogs.slice(-200);
    await run('UPDATE snapshot_publish_jobs SET command_logs_json=?, updated_at=? WHERE id=?',
        [JSON.stringify(job.commandLogs), new Date().toISOString(), job.id]).catch(() => {});
}

async function runGit(job, args, options = {}, displayCmdOverride = '') {
    const start = Date.now();
    let displayCmd = displayCmdOverride;
    if (!displayCmd) {
        displayCmd = 'git ' + args.map(a => {
            if (typeof a !== 'string') return String(a);
            if (/[\s"']/.test(a)) return JSON.stringify(a);
            return a;
        }).join(' ');
    }
    let stdout = '';
    let stderr = '';
    try {
        const res = await git('git', args, options);
        stdout = String(res.stdout || '').trim();
        stderr = String(res.stderr || '').trim();
        const durationMs = Date.now() - start;
        let output = [stdout, stderr].filter(Boolean).join('\n');
        if (output.length > 20000) output = output.slice(0, 20000) + '\n... (输出过长，已截断)';
        await recordCommandLog(job, {
            at: new Date().toISOString(),
            cmd: displayCmd,
            output,
            durationMs,
            failed: false
        });
        return res;
    } catch (err) {
        stdout = String(err.stdout || '').trim();
        stderr = String(err.stderr || err.message || '').trim();
        const durationMs = Date.now() - start;
        let output = [stdout, stderr].filter(Boolean).join('\n');
        if (output.length > 20000) output = output.slice(0, 20000) + '\n... (输出过长，已截断)';
        await recordCommandLog(job, {
            at: new Date().toISOString(),
            cmd: displayCmd,
            output,
            durationMs,
            failed: true
        });
        throw err;
    }
}

function removeDisabledPublishedTool(checkout, item, paths) {
    const relativePage = item.href.slice(2);
    const page = path.resolve(checkout, relativePage);
    if (!page.startsWith(checkout + path.sep)) throw bad('停用工具的远端页面路径无效，已停止清理');
    rejectSymlinkParents(checkout, page);
    const pageStat = fs.lstatSync(page, { throwIfNoEntry: false });
    if (pageStat && !pageStat.isFile()) throw bad(`停用工具页面不是普通文件：${relativePage}`);

    const relativeDir = path.posix.dirname(relativePage);
    const dataDir = path.join(path.dirname(page), 'data');
    rejectSymlinkParents(checkout, dataDir);
    const marker = path.join(dataDir, '.tools-platform-snapshot.json');
    const markerStat = fs.lstatSync(marker, { throwIfNoEntry: false });
    let managedData = false;
    if (markerStat) {
        if (!markerStat.isFile()) throw bad(`停用工具的数据标记不是普通文件：${item.slug}`);
        let parsed;
        try { parsed = JSON.parse(fs.readFileSync(marker, 'utf8')); }
        catch { throw bad(`停用工具的数据标记无效：${item.slug}`); }
        if (parsed?.toolId !== item.slug || parsed?.format !== 1) throw bad(`停用工具的数据目录归属不匹配：${item.slug}`);
        managedData = true;
    }

    // A dedicated slug directory with its own marker belongs to this published tool,
    // including the CSS/JS/assets written beside index.html by generic static tools.
    if (managedData && path.posix.basename(relativeDir) === item.slug) {
        fs.rmSync(path.dirname(page), { recursive: true, force: true });
        paths.push(relativeDir);
        return '目录';
    }
    if (pageStat) fs.unlinkSync(page);
    paths.push(relativePage);
    if (managedData) {
        fs.rmSync(dataDir, { recursive: true, force: true });
        paths.push(path.posix.join(relativeDir, 'data'));
    }
    return managedData ? '页面和数据目录' : '页面（未标记的其他文件已保留）';
}

async function publish(job, tenantId, settings, options = {}) {
    const key = getDbPath() + ':' + job.id;
    active.add(key);
    let staging;
    try {
        const config = validate(settings);
        let targetSlugs = [];
        const disabledSlugs = new Set();
        if (options.toolSlug) {
            targetSlugs = [options.toolSlug];
        } else {
            for (const slug of providers.keys()) {
                const toolSettings = await getToolSettings(slug);
                if (toolSettings.enabled !== false) targetSlugs.push(slug);
                else disabledSlugs.add(slug);
            }
        }
        if (options.toolSlug && options.toolSlug !== DEFAULT_TOOL_SLUG
            && !config.file.includes('{toolSlug}')
            && !resolvePublishPath(config.file, options.toolSlug).split('/').includes(options.toolSlug)) {
            throw bad('当前仓库路径未包含工具标识；请在全局设置中改用 {toolSlug}/index.html 或 pages/{toolSlug}/index.html 后推送该工具');
        }
        const pageOwners = new Map();
        const dataOwners = new Map();
        for (const slug of targetSlugs) {
            const resolved = resolvePublishPath(config.file, slug);
            const pageOwner = pageOwners.get(resolved);
            if (pageOwner) {
                throw bad(`HTML 路径冲突：[${providers.get(pageOwner)?.name || pageOwner}] 与 [${providers.get(slug)?.name || slug}] 都会写入 ${resolved}；请使用 {toolSlug}/index.html`);
            }
            pageOwners.set(resolved, slug);
            if (config.publishMode === 'pages') {
                const dataPath = path.posix.join(path.posix.dirname(resolved), 'data');
                const existing = dataOwners.get(dataPath);
                if (existing) {
                    throw bad(`Pages 分离版的路径模板会让 [${providers.get(existing)?.name || existing}] 与 [${providers.get(slug)?.name || slug}] 共用 ${dataPath}/；请改用 {toolSlug}/index.html 或 pages/{toolSlug}/index.html`);
                }
                dataOwners.set(dataPath, slug);
            }
        }
        await updateJob(job, 'running', '检查仓库', 12, '已读取当前租户的推送配置，正在检查 origin 和目标分支');
        let remote = config.remoteUrl;
        if (!remote) {
            const res = await runGit(job, ['-C', config.repoDir, 'remote', 'get-url', 'origin'], { timeout: 10000 }, 'git remote get-url origin');
            remote = res.stdout.trim();
        }
        if (!remote) throw bad('本地仓库未配置 origin');
        staging = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-snapshot-push-'));
        const checkout = path.join(staging, 'checkout');
        const hasLocalMirror = Boolean(config.repoDir && fs.existsSync(path.join(config.repoDir, '.git')));
        const cloneArgs = ['clone', '--depth', '1', '--single-branch', '--branch', config.branch];
        if (hasLocalMirror) cloneArgs.push('--reference-if-able', config.repoDir);
        cloneArgs.push('--', remote, checkout);

        const cloneDesc = hasLocalMirror
            ? '在隔离目录中浅克隆远端分支（已开启本地镜像加速），原仓库工作区不会被修改'
            : '在隔离目录中浅克隆远端分支（depth=1），原仓库工作区不会被修改';
        await updateJob(job, 'running', '获取分支', 26, cloneDesc);
        const cloneDisplay = 'git clone --depth 1 --single-branch --branch ' + config.branch +
            (hasLocalMirror ? ` --reference-if-able ${JSON.stringify(config.repoDir)}` : '') +
            ` -- ${JSON.stringify(remote)} checkout`;
        const cloneStart = Date.now();
        await runGit(job, cloneArgs, { timeout: 300000 }, cloneDisplay);
        const cloneSec = ((Date.now() - cloneStart) / 1000).toFixed(1);
        await updateJob(job, 'running', '获取分支', 38, `远端分支获取完成（耗时 ${cloneSec}s）`);

        const paths = ['index.html', MENU_FILE];
        let guideName = 'README.md';
        const disabledPublishedItems = options.toolSlug ? [] : readPublishMenuItems(checkout).filter(item => disabledSlugs.has(item.slug));
        if (!targetSlugs.length && !disabledPublishedItems.length) throw bad('没有已启用或待清理的静态发布工具');
        if (disabledPublishedItems.length) {
            await updateJob(job, 'running', '清理停用工具', 43, `发现 ${disabledPublishedItems.length} 个已取消勾选且仍存在于远端菜单的工具`);
            for (const item of disabledPublishedItems) {
                const scope = removeDisabledPublishedTool(checkout, item, paths);
                await recordCommandLog(job, { at: new Date().toISOString(), type: 'info', msg: `[停用清理] ${item.name} (${item.slug})：已删除${scope}` });
            }
            const menuResult = removePublishMenuItems(checkout, disabledSlugs);
            if (menuResult) guideName = menuResult.guideName;
        }

        for (const slug of targetSlugs) {
            const provider = providers.get(slug);
            if (!provider) continue;
            const tool = await require('./custom-tools-repository').getTool(slug);
            const toolName = tool?.name || provider.name;
            const toolSecurity = await getToolSettings(slug, true);
            const toolResolvedFile = resolvePublishPath(config.file, slug);
            const snapshotOptions = {
                encryption: {
                    enabled: Boolean(toolSecurity.encryptionEnabled && toolSecurity.passwordHash),
                    passwordHash: toolSecurity.passwordHash,
                    passwordSalt: toolSecurity.passwordSalt
                }
            };

            await updateJob(job, 'running', '生成快照', 48, config.publishMode === 'pages'
                ? `正在生成 [${toolName}] Pages 页面、数据与证据文件`
                : `正在生成 [${toolName}] 只读单文件 HTML`);

            const output = config.publishMode === 'pages'
                ? await provider.buildPagesSnapshot(tenantId, snapshotOptions)
                : { html: await provider.buildSnapshot(tenantId, snapshotOptions), files: new Map() };
            const fingerprint = fingerprintSnapshotBundle(output, config.publishMode);

            await recordCommandLog(job, {
                at: new Date().toISOString(),
                type: 'info',
                msg: `[生成快照] 工具: ${toolName} (${slug})，模式: ${config.publishMode === 'pages' ? 'Pages' : '单文件'}${snapshotOptions.encryption.enabled ? ' (已开启访问密码保护)' : ''}，页面大小: ${formatSize(output.html.length)}${config.publishMode === 'pages' ? `，提取数据文件: ${output.files.size} 个` : ''}`
            });

            const destination = path.join(checkout, toolResolvedFile);
            rejectSymlinkParents(checkout, destination);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, output.html);
            paths.push(toolResolvedFile);

            const dataRelative = path.posix.join(path.posix.dirname(toolResolvedFile), 'data');
            const dataDir = path.join(path.dirname(destination), 'data');
            rejectSymlinkParents(checkout, dataDir);
            const marker = path.join(dataDir, '.tools-platform-snapshot.json');
            const expectedMarker = getPagesMarker(slug);
            const managedData = isManagedDataDir(dataDir, slug);

            if (config.publishMode === 'pages' && fs.existsSync(dataDir) && !managedData) {
                throw bad(`目标 data/ 目录已存在但不是 [${toolName}] 的发布目录，请选择独立的工具路径`);
            }

            if (config.publishMode === 'pages') {
                output.files.set('data/.tools-platform-snapshot.json', expectedMarker);
                for (const [relative, contents] of output.files) {
                    const file = path.join(path.dirname(destination), relative);
                    rejectSymlinkParents(checkout, file);
                    fs.mkdirSync(path.dirname(file), { recursive: true });
                    fs.writeFileSync(file, contents);
                    paths.push(path.posix.join(path.posix.dirname(toolResolvedFile), relative));
                }
                paths.push(dataRelative);
                if (path.posix.dirname(toolResolvedFile) !== '.') {
                    paths.push(path.posix.dirname(toolResolvedFile));
                }
                await recordCommandLog(job, {
                    at: new Date().toISOString(),
                    type: 'info',
                    msg: `[文件写入] [${toolName}] 成功写入 ${toolResolvedFile} 及 ${output.files.size} 个数据与附件文件`
                });
            }

            // Remove only files this publisher owns
            const expectedEvidence = new Set([...output.files.keys()].filter(name => name.startsWith('data/evidence/')).map(name => path.basename(name)));
            const evidenceDir = path.join(dataDir, 'evidence');
            rejectSymlinkParents(checkout, evidenceDir);
            if (managedData && fs.existsSync(evidenceDir)) {
                let removedCount = 0;
                for (const name of fs.readdirSync(evidenceDir)) if (EVIDENCE_FILE.test(name) && !expectedEvidence.has(name)) {
                    const oldFile = path.join(evidenceDir, name);
                    if (fs.lstatSync(oldFile).isFile()) { fs.unlinkSync(oldFile); removedCount++; }
                }
                if (removedCount > 0) {
                    await recordCommandLog(job, {
                        at: new Date().toISOString(),
                        type: 'info',
                        msg: `[附件清理] [${toolName}] 清理了 ${removedCount} 个远端已过期的历史证据附件`
                    });
                }
            }

            if (config.publishMode === 'single' && managedData) {
                if (fs.existsSync(dataDir)) {
                    fs.rmSync(dataDir, { recursive: true, force: true });
                }
                paths.push(dataRelative);
            }

            const menuRes = updatePublishMenu(checkout, {
                slug,
                name: toolName,
                description: tool?.description || provider.description,
                href: './' + toolResolvedFile,
                encrypted: Boolean(snapshotOptions.encryption.enabled),
                fingerprint
            });
            guideName = menuRes.guideName || guideName;
        }

        paths.push(guideName);
        await updateJob(job, 'running', '更新仓库介绍', 62, '正在同步首页菜单和仓库工具说明');
        await recordCommandLog(job, {
            at: new Date().toISOString(),
            type: 'info',
            msg: `[菜单同步] 已同步 .tools-platform-menu.json 与仓库指南文件 ${guideName}`
        });

        await updateJob(job, 'running', '检查变更', 68, config.publishMode === 'pages' ? '正在逐文件比较 HTML、JSON 和证据附件' : '已生成只读快照 HTML，正在检查目标文件变更');
        const uniquePaths = Array.from(new Set(paths));
        await runGit(job, ['-C', checkout, 'add', '-A', '--', ...uniquePaths], { timeout: 30000 }, 'git add -A -- ' + uniquePaths.join(' '));
        const diffRes = await runGit(job, ['-C', checkout, 'diff', '--cached', '--name-only', '--', ...uniquePaths], {}, 'git diff --cached --name-only');
        const changed = diffRes.stdout.trim().split('\n').filter(Boolean);
        const dirty = changed.length > 0;
        const forceDeploy = Boolean(options.force);
        const summaryNames = [
            ...targetSlugs.map(s => providers.get(s)?.name || s),
            ...disabledPublishedItems.map(item => `停用${item.name}`)
        ].join('、');
        if (dirty) {
            await updateJob(job, 'running', '检查变更', 75, '本次变更 ' + changed.length + ' 个文件：' + changed.slice(0, 4).join('、') + (changed.length > 4 ? ' 等' : ''));
            await runGit(job, ['-C', checkout, '-c', 'user.name=Tools Platform', '-c', 'user.email=tools-platform@localhost', 'commit', '-m', `Update readonly tools snapshot (${summaryNames})`], { timeout: 30000 }, `git commit -m "Update readonly tools snapshot (${summaryNames})"`);
            await updateJob(job, 'running', '推送远端', 86, '仅提交发生变化的发布文件；正在更新远端 ' + config.branch + ' 分支');
            const pushStart = Date.now();
            await runGit(job, ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/' + config.branch], { timeout: 300000 }, `git push origin HEAD:refs/heads/${config.branch}`);
            const pushSec = ((Date.now() - pushStart) / 1000).toFixed(1);
            await updateJob(job, 'running', '推送远端', 96, `远端更新成功（耗时 ${pushSec}s）`);
        } else if (forceDeploy) {
            await updateJob(job, 'running', '检查变更', 75, '发布文件无变化，按强制推送模式创建空提交以触发 Pages 重新部署');
            await runGit(job, ['-C', checkout, '-c', 'user.name=Tools Platform', '-c', 'user.email=tools-platform@localhost', 'commit', '--allow-empty', '-m', `Force redeploy readonly tools snapshot (${summaryNames})`], { timeout: 30000 }, `git commit --allow-empty -m "Force redeploy readonly tools snapshot (${summaryNames})"`);
            await updateJob(job, 'running', '推送远端', 86, '强制提交完成；正在更新远端 ' + config.branch + ' 分支');
            const pushStart = Date.now();
            await runGit(job, ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/' + config.branch], { timeout: 300000 }, `git push origin HEAD:refs/heads/${config.branch}`);
            const pushSec = ((Date.now() - pushStart) / 1000).toFixed(1);
            await updateJob(job, 'running', '推送远端', 96, `远端强制更新成功（耗时 ${pushSec}s）`);
        } else {
            await updateJob(job, 'running', '检查变更', 96, '发布内容无变化，跳过 git commit/push（如需刷新平台部署可使用“强制推送”）');
        }
        const rev = await runGit(job, ['-C', checkout, 'rev-parse', 'HEAD'], {}, 'git rev-parse HEAD');
        const commit = rev.stdout.trim();
        await updateJob(job, 'success', '完成', 100, '推送完成；Pages 发布可能仍需等待托管平台部署', commit);
    } catch (error) {
        console.error('[SNAPSHOT-PUBLISH] Push job failed:', job.id, 'stage:', job.stage, error.message || error.code || error);
        let message;
        if (error.status === 400) {
            message = error.message;
        } else if (error.code === 'ENOENT') {
            message = '未找到 Git 命令：请在运行服务或绿色版的电脑上安装 Git 并加入 PATH';
        } else if (error.code === 'ETIMEDOUT' || error.killed) {
            message = `操作超时（超过 300 秒）：阶段 [${job.stage}] 网络连接较慢或远端无响应。建议配置“本地 Git 镜像仓库”加速。`;
        } else {
            message = error.message ? '推送失败：' + error.message : '推送失败：请检查仓库 origin、目标分支、Git 凭据和远端并发更新';
        }
        await updateJob(job, 'failed', '失败', job.progress || 0, message);
    } finally {
        active.delete(key);
        if (staging) {
            try { fs.rmSync(staging, { recursive: true, force: true }); }
            catch (cleanupError) { console.warn('[SNAPSHOT-PUBLISH] Staging cleanup warning:', cleanupError.message); }
        }
    }
}

async function startJob(tenantId, options = {}) {
    await ready();
    const settings = validate(await getSettings(true));
    const toolSlug = String(options.toolSlug || '').trim();
    if (toolSlug && !providers.has(toolSlug)) throw bad('该工具尚未接入静态页面发布');
    const keyPrefix = getDbPath() + ':';
    if ([...active].some(key => key.startsWith(keyPrefix))) throw bad('当前租户已有推送任务正在执行', 409);
    const existing = (await listJobs()).find(item => item.status === 'running');
    if (existing) throw bad('当前租户已有推送任务正在执行', 409);
    const now = new Date().toISOString();
    const trigger = options.trigger === 'scheduled' ? 'scheduled' : 'manual';
    const jobPath = toolSlug
        ? resolvePublishPath(settings.file, toolSlug)
        : settings.resolvedFile;
    const job = {
        id: crypto.randomUUID(),
        status: 'running',
        stage: '排队',
        progress: 3,
        trigger,
        toolSlug,
        entries: [{ at: now, stage: '排队', message: trigger === 'scheduled' ? '定时任务已创建' : '已创建推送任务' }],
        commandLogs: [{ at: now, type: 'info', msg: trigger === 'scheduled' ? '启动定时推送流水线' : '启动手动推送流水线' }],
        commit: '',
        path: jobPath,
        createdAt: now,
        updatedAt: now
    };
    active.add(keyPrefix + job.id);
    try {
        await run('INSERT INTO snapshot_publish_jobs (id,status,stage,trigger_type,tool_slug,progress,entries_json,command_logs_json,commit_sha,file_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            [job.id, job.status, job.stage, trigger, toolSlug, job.progress, JSON.stringify(job.entries), JSON.stringify(job.commandLogs), '', job.path, now, now]);
        setImmediate(() => { publish(job, tenantId, settings, options).catch(() => {}); });
        return job;
    } catch (error) { active.delete(keyPrefix + job.id); throw error; }
}

function stopTenantScheduler(tenantId) {
    const timer = scheduleTimers.get(tenantId);
    if (timer) clearTimeout(timer);
    scheduleTimers.delete(tenantId);
}

async function runScheduledTenant(tenantId) {
    return runWithTenant(tenantId, async () => {
        const now = new Date().toISOString();
        try {
            const current = await getSettings();
            if (!current.scheduleEnabled) return null;
            await run('UPDATE snapshot_publish_settings SET schedule_anchor_at=?, last_auto_at=?, last_auto_error=? WHERE key=?',
                [now, now, '', DEFAULT_TOOL_SLUG]);
            return await startJob(tenantId, { trigger: 'scheduled' });
        } catch (error) {
            const message = error.status ? error.message : '定时推送启动失败，请检查仓库配置和服务日志';
            await run('UPDATE snapshot_publish_settings SET last_auto_error=? WHERE key=?', [message, DEFAULT_TOOL_SLUG]).catch(() => {});
            console.warn('[snapshot-publish] 定时任务启动失败：' + message);
            return null;
        } finally {
            await scheduleTenant(tenantId).catch(error => console.warn('[snapshot-publish] 重排定时任务失败：' + error.message));
        }
    });
}

async function scheduleTenant(tenantId) {
    stopTenantScheduler(tenantId);
    return runWithTenant(tenantId, async () => {
        const settings = await getSettings();
        if (!settings.scheduleEnabled || settings.source !== 'saved') return { enabled: false, nextRunAt: '' };
        const dueAt = Date.parse(settings.nextRunAt);
        const delay = Math.max(1000, Math.min(2147483647, dueAt - Date.now()));
        const timer = setTimeout(() => { runScheduledTenant(tenantId).catch(error => console.warn('[snapshot-publish] 定时任务执行失败：' + error.message)); }, delay);
        timer.unref?.();
        scheduleTimers.set(tenantId, timer);
        return { enabled: true, nextRunAt: new Date(dueAt).toISOString() };
    });
}

async function startScheduler() {
    const tenants = await require('./tenants-repository').listTenantsForUser('', 'admin');
    return Promise.all(tenants.map(tenant => scheduleTenant(tenant.id)));
}

module.exports = {
    getSettings, saveSettings, getPrerequisites, getJob, listJobs, startJob,
    scheduleTenant, startScheduler, stopTenantScheduler, runScheduledTenant,
    resolvePublishPath, hashPassword,
    getToolSettings, saveToolSettings, registerProvider, providers
};
