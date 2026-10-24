const fs = require('node:fs');
const path = require('node:path');
const appDb = require('./app-db');
const pool = require('./tenant-sqlite-pool');
const { BASE_DATA_DIR, getDataDir, getReportDataDir, getTenantId } = require('./tenant-context');

const KNOWN = {
    'tools.db': ['tools', '工具业务', 'Tools'],
    'report.db': ['report', '报表历史与指标', 'Reports & Metrics'],
    'requirements.db': ['requirements', '需求与流转日志', 'Requirements'],
    'ai-knowledge.db': ['ai-knowledge', 'AI 知识索引', 'AI Knowledge Index'],
    'chat-history.db': ['chat-history', '聊天记录', 'Chat History'],
    'datacom-knowledge.db': ['datacom-knowledge', '数通知识库', 'Datacom Knowledge'],
    'ezscan-warehouse.db': ['ezscan-warehouse', '仓储数据', 'Warehouse']
};
const PURPOSES = {
    tools: ['UIVF12 脚本、SLA 规则与快照、导入源表、AI 月报及平台工具业务数据。', 'UIVF12 scripts, SLA rules and snapshots, imported sources, AI reports and platform tool data.'],
    report: ['报表入库历史、各类别月度得分，以及指标目标、原始值和计分明细。', 'Stored report history, monthly category scores, metric targets, raw values and scoring details.'],
    requirements: ['需求广场的需求内容、负责人、处理状态，以及流转与备注日志。', 'Requirements, assignees, workflow status, transitions and notes.'],
    'ai-knowledge': ['AI 检索使用的项目文档索引、内容分块与索引状态，可根据源文档重建。', 'Project document indexes, content chunks and indexing state used for AI retrieval; rebuildable from source documents.'],
    'chat-history': ['聊天记录中心导入的来源、会话、消息、人员目录和分析缓存。', 'Imported chat sources, conversations, messages, participant directory and analytics cache.'],
    'datacom-knowledge': ['数通协议专家的知识文章、分类、大纲、修订历史与学习批注。', 'Datacom protocol articles, categories, outlines, revisions and learning annotations.'],
    'ezscan-warehouse': ['仓储管理工具保存的仓储业务状态及其修订版本。', 'Warehouse business state and revisions saved by the warehouse management tool.'],
    platform: ['全局账号、登录会话、租户注册及认证安全控制数据。', 'Global accounts, login sessions, tenant registration and authentication security control data.']
};
const SQLITE_FILE = /\.(?:db|sqlite|sqlite3)$/i;
const ARCHIVE_FILE = /(?:backup|before|corrupt|repaired|archive|restore|\.bak|\.old|\.tmp)/i;

function error(message, status, code) {
    return Object.assign(new Error(message), { status, code });
}

// Only live files directly inside the current tenant's configured directories.
// Never traverse tenant, backup, custom-tool, or archive subdirectories.
function catalog() {
    const items = [];
    const add = (root, name, scope, definition) => {
        const file = path.join(root, name);
        let stat;
        try {
            stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink()) return;
            if (path.dirname(fs.realpathSync(file)) !== fs.realpathSync(root)) return;
        } catch (err) {
            if (err.code === 'ENOENT') return;
            throw err;
        }
        const [id, label, labelEn] = definition;
        const purpose = PURPOSES[id];
        const empty = stat.size === 0;
        items.push({ id, name,
            label: purpose ? label : empty ? '空数据库文件' : '扩展库（用途未登记）',
            labelEn: purpose ? labelEn : empty ? 'Empty Database File' : 'Extension (Purpose Unregistered)',
            scope, tenantId: scope === 'platform' ? null : getTenantId(), size: stat.size, file,
            kind: purpose ? 'runtime' : empty ? 'empty' : 'extension',
            description: purpose ? purpose[0] : empty ? '此文件为 0 字节，尚未初始化数据表，也没有业务数据。' : '数据目录中的扩展或历史数据库，当前版本未登记其业务用途；可查看表目录和字段结构。',
            descriptionEn: purpose ? purpose[1] : empty ? 'This is a zero-byte file with no initialized tables or business data.' : 'An extension or legacy database whose business purpose is not registered in the current version; inspect its tables and schema.'
        });
    };
    const dataDir = getDataDir();
    const reportDir = getReportDataDir();
    for (const [name, definition] of Object.entries(KNOWN)) {
        add(name === 'report.db' ? reportDir : dataDir, name, name === 'report.db' ? 'report' : 'data', definition);
    }
    if (path.resolve(dataDir) === path.resolve(BASE_DATA_DIR)) {
        const tools = items.find(item => item.id === 'tools');
        if (tools) {
            tools.label = '工具业务与平台控制';
            tools.labelEn = 'Tools & Platform Control';
            tools.description += ' 默认租户的此库还保存全局账号、会话与租户控制数据。';
            tools.descriptionEn += ' For the default tenant, this database also stores global accounts, sessions and tenant control data.';
        }
    }
    if (fs.existsSync(dataDir)) {
        for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
            if (!entry.isFile() || !SQLITE_FILE.test(entry.name) || ARCHIVE_FILE.test(entry.name) || KNOWN[entry.name]) continue;
            add(dataDir, entry.name, 'data', [`data:${entry.name}`, entry.name, entry.name]);
        }
    }
    // The control plane lives in the default tools.db. Avoid duplicating that
    // physical database for the default tenant; name it explicitly for others.
    const platformFile = path.join(BASE_DATA_DIR, 'tools.db');
    if (path.resolve(platformFile) !== path.resolve(dataDir, 'tools.db')) {
        add(BASE_DATA_DIR, 'tools.db', 'platform', ['platform', '平台账号与租户（全局）', 'Accounts & Tenants (Global)']);
    }
    return items;
}

function listDatabases() {
    return catalog().map(({ file, ...item }) => item);
}

function resolveDatabase(id = 'tools') {
    if (typeof id !== 'string') throw error('数据库标识无效', 400, 'INVALID_DATABASE');
    const item = catalog().find(entry => entry.id === id);
    if (!item) throw error('数据库不存在或不属于当前租户，请刷新数据库列表', 404, 'DATABASE_NOT_AVAILABLE');
    if (id === 'tools') return { ...item, ...appDb };
    if (id === 'platform') return { ...item, ...require('./platform-db') };
    const query = method => (sql, params = []) => new Promise((resolve, reject) => {
        const connection = pool.getConnection(item.name, item.scope === 'report' ? 'report' : 'data');
        connection[method](sql, params, function (err, rows) {
            if (err) reject(err);
            else resolve(method === 'run' ? { lastID: this.lastID, changes: this.changes } : rows);
        });
    });
    return { ...item, all: query('all'), get: query('get'), run: query('run') };
}

module.exports = { listDatabases, resolveDatabase };
