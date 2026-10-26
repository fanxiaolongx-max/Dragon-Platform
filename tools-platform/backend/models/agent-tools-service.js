// Dragon Claw 工作区：模型可调用的工具（定义 + 执行）。
// 所有路径都经 agent-path-guard 约束在根目录内；写操作通过 agent-change-log 记录快照。
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { StringDecoder } = require('string_decoder');
const { spawn } = require('child_process');
const guard = require('./agent-path-guard');
const { redactText, redactValue } = require('./ai-sensitive-data');
const { unifiedDiff } = require('./agent-change-log');
const commandGuard = require('./agent-command-guard');
const databaseService = require('./agent-database-service');

const LIMITS = {
    listEntries: 500,
    readLines: 400,
    readBytes: 200 * 1024,
    searchMatches: 200,
    searchFiles: 20000,
    searchFileBytes: 10 * 1024 * 1024,
    searchBudgetMs: 10000,
    writeBytes: 1024 * 1024,
    commandTimeoutMs: 60000,
    commandMaxTimeoutMs: 300000,
    commandOutputBytes: 32 * 1024,
    resultChars: 24 * 1024
};

const SECRET_ENV_RE = /KEY|TOKEN|SECRET|PASSWORD|PASS\b|COOKIE|AUTH|CREDENTIAL/i;

const DATABASE_WRITE_PARAMETERS = {
    type: 'object',
    properties: {
        database: { type: 'string' }, table: { type: 'string' },
        values: { type: 'string', description: 'JSON 对象字符串，列名映射到 SQLite 标量（字符串、数字、布尔值或 null），例如 {"title":"新标题","count":3}；JSON 列的值应先序列化。' },
        filters: { type: 'array', description: '所有条件以 AND 连接。eq 为相等；contains 为文本包含；is_null 匹配空值且无需 value。', items: { type: 'object', properties: {
            column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'contains', 'is_null'] }, value: { type: 'string', description: '用于匹配的文本；数值列可传数值的字符串表示' }
        }, required: ['column', 'op'] } },
        allowAllRows: { type: 'boolean', description: '无 filters 时更新/删除整张表必须显式设为 true' },
        maxAffectedRows: { type: 'integer', description: '最大直接影响行数，默认 1000；超过则拒绝并回滚' }
    },
    required: ['database', 'table']
};

const DEFINITIONS = [
    {
        name: 'list_directory',
        kind: 'read',
        description: '列出工作目录内某个目录的内容（目录在前）。路径相对工作目录，"." 表示根目录。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '相对工作目录的路径，默认 "."' },
                depth: { type: 'integer', description: '递归层数，1-3，默认 1' },
                showHidden: { type: 'boolean', description: '是否包含以 . 开头的条目，默认 false' }
            }
        }
    },
    {
        name: 'read_file',
        kind: 'read',
        description: '读取文本文件内容，带行号。默认从第 1 行读 400 行，单次最多 2000 行；超长的行会被截断。大文件按返回提示用 startLine 继续分段读取；找特定内容先用 search 定位行号再读。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '相对工作目录的文件路径' },
                startLine: { type: 'integer', description: '起始行（从 1 开始），默认 1' },
                limit: { type: 'integer', description: '读取行数，默认 400，最多 2000' },
                endLine: { type: 'integer', description: '结束行（包含）；与 limit 二选一' }
            },
            required: ['path']
        }
    },
    {
        name: 'search',
        kind: 'read',
        description: '在工作目录内按文本或正则搜索文件内容，返回 文件:行号:内容。自动跳过 node_modules、.git、构建产物和二进制文件。',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '要搜索的文本或正则' },
                path: { type: 'string', description: '限定搜索的子目录，默认 "."' },
                regex: { type: 'boolean', description: 'query 是否为正则表达式，默认 false' },
                caseSensitive: { type: 'boolean', description: '是否区分大小写，默认 false' },
                glob: { type: 'string', description: '文件名通配，如 *.js' }
            },
            required: ['query']
        }
    },
    {
        name: 'list_databases', kind: 'read',
        description: '列出当前租户的平台 SQLite（标识如 platform:report.db、platform:tools.db，指向平台实际使用的库）和所选工作目录内的 SQLite（local:相对路径）。后续必须使用返回的 database 标识；path 只用于指定工作目录内更深的子目录。',
        parameters: { type: 'object', properties: { path: { type: 'string' } } }
    },
    {
        name: 'database_schema', kind: 'read',
        description: '查看 SQLite 可读取的业务表；传 table 查看列。账号、聊天、凭据表和敏感列始终排除。',
        parameters: { type: 'object', properties: { database: { type: 'string' }, table: { type: 'string' } }, required: ['database'] }
    },
    {
        name: 'read_database_table', kind: 'read',
        description: '只读分页读取业务表，不接受 SQL。默认前 16 列、20 行，最多 50 行；按 nextOffset 继续。单格最多 1000 字符，敏感字段和凭据被排除或脱敏。',
        parameters: { type: 'object', properties: {
            database: { type: 'string' }, table: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } },
            limit: { type: 'integer' }, offset: { type: 'integer' },
            filter: { type: 'object', properties: { column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'contains'] }, value: { type: 'string' } }, required: ['column', 'op', 'value'] }
        }, required: ['database', 'table'] }
    },
    {
        name: 'insert_database_row', kind: 'write',
        description: '管理员向 SQLite 业务表新增一行。先 list_databases、database_schema 再调用，必须提供 values。支持当前租户的全部业务库和工作目录本地库；凭据/控制面数据不开放。事务提交后返回 changes/lastID，不支持文件撤销。',
        parameters: { ...DATABASE_WRITE_PARAMETERS, required: ['database', 'table', 'values'] }
    },
    {
        name: 'update_database_rows', kind: 'write',
        description: '管理员按结构化 filters 更新 SQLite 业务表，values 为待修改列；条件以 AND 连接。无筛选须显式 allowAllRows=true。执行时在事务内重新核对影响行数，失败回滚；不支持文件撤销。',
        parameters: { ...DATABASE_WRITE_PARAMETERS, required: ['database', 'table', 'values'] }
    },
    {
        name: 'delete_database_rows', kind: 'destructive',
        description: '管理员按结构化 filters 删除 SQLite 业务行。无筛选须显式 allowAllRows=true。按删除类权限审批；执行时核对行数，失败回滚；不支持文件撤销。',
        parameters: DATABASE_WRITE_PARAMETERS
    },
    {
        name: 'write_file',
        kind: 'write',
        description: '创建或整体覆盖一个文本文件。修改已有文件的局部内容时优先使用 edit_file。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '相对工作目录的文件路径' },
                content: { type: 'string', description: '完整文件内容' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'edit_file',
        kind: 'write',
        description: '把文件中唯一出现的 oldString 精确替换为 newString。oldString 必须与文件内容完全一致（含缩进）；出现 0 次或多次都会报错，除非 replaceAll 为 true。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                oldString: { type: 'string' },
                newString: { type: 'string' },
                replaceAll: { type: 'boolean', description: '替换全部出现，默认 false' }
            },
            required: ['path', 'oldString', 'newString']
        }
    },
    {
        name: 'delete_path',
        kind: 'destructive',
        description: '删除文件或目录。删除目录必须传 recursive=true。不能删除工作目录本身。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                recursive: { type: 'boolean', description: '递归删除目录，默认 false' }
            },
            required: ['path']
        }
    },
    {
        name: 'rename_path',
        kind: 'destructive',
        description: '移动或重命名文件/目录，目标已存在时报错。',
        parameters: {
            type: 'object',
            properties: {
                from: { type: 'string' },
                to: { type: 'string' }
            },
            required: ['from', 'to']
        }
    },
    {
        name: 'run_command',
        kind: 'command',
        description: '在工作目录中执行一条 shell 命令（如运行测试、git status、构建）。输出会被截断；默认 60 秒超时，最长 300 秒。',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '完整命令行' },
                timeoutMs: { type: 'integer', description: '超时毫秒数，默认 60000，最大 300000' }
            },
            required: ['command']
        }
    },
    {
        name: 'welink_list_targets',
        kind: 'read',
        description: '列出平台 WeLink 助理历史接触过的人员与群组（按最近活跃排序），用于确定推送对象。canPush=false 表示该目标尚无可推送会话。',
        parameters: {
            type: 'object',
            properties: {
                kind: { type: 'string', description: '"user"（人员）或 "group"（群组），默认全部' },
                query: { type: 'string', description: '按账号、名称或备注过滤' },
                limit: { type: 'integer', description: '最多返回条数，默认 50，最大 200' }
            }
        }
    },
    {
        name: 'welink_send_message',
        kind: 'external',
        description: '通过平台 WeLink 助理主动推送一条消息（支持 Markdown）。targets 省略时推送到管理员配置的默认推送范围。会向外部发送消息，执行前需要用户审批。',
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '消息正文（Markdown），最多 8000 字' },
                targets: {
                    type: 'array',
                    description: '推送目标；来自 welink_list_targets 的 kind 与 id',
                    items: {
                        type: 'object',
                        properties: { kind: { type: 'string', description: '"user" 或 "group"' }, id: { type: 'string' } },
                        required: ['kind', 'id']
                    }
                }
            },
            required: ['text']
        }
    }
];

const KIND_BY_NAME = new Map(DEFINITIONS.map(item => [item.name, item.kind]));

// readOnly：普通用户只拿到查看 / 搜索类工具（管理员全部权限，普通用户只读）
function definitions({ readOnly = false } = {}) {
    return DEFINITIONS
        // 频道联系人属于管理员数据：只读账号不提供 WeLink 工具
        .filter(item => !readOnly || (item.kind === 'read' && !item.name.startsWith('welink_')))
        .map(({ name, description, parameters }) => ({ name, description, parameters }));
}

function kindOf(toolName) {
    return KIND_BY_NAME.get(toolName) || null;
}

function toolError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function clampResult(text) {
    const value = String(text ?? '');
    if (value.length <= LIMITS.resultChars) return { content: value, truncated: false };
    const half = Math.floor((LIMITS.resultChars - 100) / 2);
    return { content: `${value.slice(0, half)}\n…（结果过长，已截断，共 ${value.length} 字符）…\n${value.slice(-half)}`, truncated: true };
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

async function yieldToLoop() {
    await new Promise(resolve => setImmediate(resolve));
}

// ── list_directory ────────────────────────────────────────
async function listDirectory(ctx, args = {}) {
    const abs = guard.resolveInsideRoot(ctx.root, args.path || '.');
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) throw toolError('AGENT_NOT_FOUND', `目录不存在：${args.path || '.'}`);
    if (!stat.isDirectory()) throw toolError('AGENT_NOT_DIR', `不是目录：${args.path || '.'}`);
    const depth = Math.min(3, Math.max(1, Number(args.depth) || 1));
    const showHidden = args.showHidden === true;
    const lines = [];
    let count = 0;
    let truncated = false;
    const walk = async (dir, level) => {
        if (truncated) return;
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (error) {
            lines.push(`${'  '.repeat(level)}（无法读取：${error.code || error.message}）`);
            return;
        }
        entries = entries
            .filter(entry => showHidden || !entry.name.startsWith('.'))
            .sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (count >= LIMITS.listEntries) { truncated = true; return; }
            count += 1;
            const full = path.join(dir, entry.name);
            const indent = '  '.repeat(level);
            if (entry.isDirectory()) {
                lines.push(`${indent}${entry.name}/`);
                if (level + 1 < depth && !guard.isIgnoredDirName(entry.name)) await walk(full, level + 1);
            } else {
                let size = '';
                try { size = `  ${formatSize((await fsp.stat(full)).size)}`; } catch (_error) { /* ignore */ }
                lines.push(`${indent}${entry.name}${entry.isSymbolicLink() ? ' @' : ''}${size}`);
            }
        }
    };
    await walk(abs, 0);
    const header = `${guard.toDisplayPath(ctx.root, abs)}/ （${count} 项${truncated ? '，已截断' : ''}）`;
    return { content: [header, ...lines].join('\n'), summary: `${count} 项` };
}

// ── read_file ─────────────────────────────────────────────
// 与主流编码智能体一致：按行分页（startLine + limit），流式读取不把大文件整个载入内存，
// 单次输出有行数 / 字节上限，超长行截断，末尾明确提示下一段从哪一行继续。
const READ_DEFAULT_LINES = 400;
const READ_MAX_LINES = 2000;
const READ_MAX_LINE_CHARS = 2000;
const READ_COUNT_BUDGET_BYTES = 64 * 1024 * 1024; // 超过这个大小只读到所需位置，不再统计总行数

async function readLineWindow(abs, startLine, maxLines, maxBytes, fileSize, protection) {
    const lines = [];
    let lineNo = 1;
    let prefix = '';
    let lineLength = 0;
    let bytes = 0;
    let stoppedByBytes = false;
    let scanned = 0;
    let firstChunk = true;
    let binary = false;
    const decoder = new StringDecoder('utf8');
    const collecting = () => lines.length < maxLines && !stoppedByBytes;
    const take = () => {
        if (lineNo >= startLine && collecting()) {
            let text = prefix;
            if (text.endsWith('\r')) text = text.slice(0, -1);
            const shown = redactText(lineLength > READ_MAX_LINE_CHARS
                ? `${text}…（本行共 ${lineLength} 字符，已截断）` : text, protection);
            const cost = String(lineNo).length + 2 + shown.length;
            if (bytes + cost > maxBytes && lines.length) stoppedByBytes = true;
            else {
                lines.push({ no: lineNo, text: shown });
                bytes += cost;
            }
        }
        lineNo += 1;
        prefix = '';
        lineLength = 0;
    };
    const consume = text => {
        let start = 0;
        while (start < text.length) {
            const end = text.indexOf('\n', start);
            const segment = end === -1 ? text.slice(start) : text.slice(start, end);
            if (prefix.length < READ_MAX_LINE_CHARS) prefix += segment.slice(0, READ_MAX_LINE_CHARS - prefix.length);
            lineLength += segment.length;
            if (end === -1) break;
            take();
            start = end + 1;
        }
    };
    const stream = fs.createReadStream(abs, { highWaterMark: 64 * 1024 });
    try {
        for await (const chunk of stream) {
            if (firstChunk) {
                firstChunk = false;
                if (guard.isBinaryBuffer(chunk.subarray(0, 8192))) { binary = true; break; }
            }
            scanned += chunk.length;
            consume(decoder.write(chunk));
            if (!collecting() && fileSize > READ_COUNT_BUDGET_BYTES) break;
        }
    } finally {
        stream.destroy();
    }
    const complete = !binary && scanned >= fileSize;
    if (complete) {
        consume(decoder.end());
        if (lineLength) take();
    }
    const totalLines = complete ? lineNo - 1 : null;
    return { lines, totalLines, binary, stoppedByBytes };
}

async function readFile(ctx, args = {}) {
    if (!args.path) throw toolError('AGENT_ARGS', '缺少 path');
    const abs = guard.resolveInsideRoot(ctx.root, args.path);
    const display = guard.toDisplayPath(ctx.root, abs);
    guard.assertNotSecretFile(abs);
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) throw toolError('AGENT_NOT_FOUND', `文件不存在：${display}`);
    if (stat.isDirectory()) throw toolError('AGENT_IS_DIR', `${display} 是目录，请用 list_directory`);
    if (guard.looksBinaryByName(abs)) throw toolError('AGENT_BINARY', `${display} 是二进制文件（${formatSize(stat.size)}），无法以文本读取`);
    const start = Math.max(1, Math.floor(Number(args.startLine)) || 1);
    let count = Math.floor(Number(args.limit)) || 0;
    if (!count && Number(args.endLine) >= start) count = Math.floor(Number(args.endLine)) - start + 1;
    count = Math.min(READ_MAX_LINES, Math.max(1, count || READ_DEFAULT_LINES));
    const { lines, totalLines, binary, stoppedByBytes } = await readLineWindow(abs, start, count, Math.min(LIMITS.readBytes, LIMITS.resultChars - display.length - 1024), stat.size, { secrets: ctx.sensitiveValues || [] });
    if (binary) throw toolError('AGENT_BINARY', `${display} 看起来是二进制文件，无法以文本读取`);
    const totalText = totalLines !== null ? `共 ${totalLines} 行` : `文件较大（${formatSize(stat.size)}），未统计总行数`;
    if (!lines.length) {
        const beyond = totalLines !== null && start > totalLines;
        return {
            content: `${display}（${totalText}）${beyond ? `：startLine=${start} 超出文件末尾` : '：该范围没有内容'}`,
            summary: `${display} 无内容`
        };
    }
    const shownEnd = lines[lines.length - 1].no;
    const more = totalLines === null ? true : shownEnd < totalLines;
    const header = `${display}（第 ${start}-${shownEnd} 行，${totalText}）`;
    const footer = more
        ? `\n…还有后续内容${stoppedByBytes ? '（本次已达单次输出上限）' : ''}：继续读取请用 startLine=${shownEnd + 1}；查找特定内容可先用 search 定位行号。`
        : '';
    const body = lines.map(item => `${String(item.no)}│${item.text}`);
    return { content: `${[header, ...body].join('\n')}${footer}`, summary: `${display} ${start}-${shownEnd}` };
}

// ── search ────────────────────────────────────────────────
function globToRegExp(glob) {
    const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

async function search(ctx, args = {}) {
    if (!args.query) throw toolError('AGENT_ARGS', '缺少 query');
    const abs = guard.resolveInsideRoot(ctx.root, args.path || '.');
    const flags = args.caseSensitive ? 'g' : 'gi';
    let pattern;
    try {
        pattern = args.regex ? new RegExp(args.query, flags) : new RegExp(String(args.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (error) {
        throw toolError('AGENT_ARGS', `正则无效：${error.message}`);
    }
    const fileFilter = args.glob ? globToRegExp(args.glob) : null;
    const matches = [];
    const started = Date.now();
    let filesScanned = 0;
    let stopped = '';
    const walk = async dir => {
        if (stopped) return;
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_error) { return; }
        for (const entry of entries) {
            if (stopped) return;
            if (ctx.signal?.aborted) { stopped = '已中止'; return; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!guard.isIgnoredDirName(entry.name) && !entry.name.startsWith('.')) await walk(full);
                continue;
            }
            if (!entry.isFile()) continue;
            if (fileFilter && !fileFilter.test(entry.name)) continue;
            if (guard.looksBinaryByName(full) || guard.isSecretFile(full)) continue;
            filesScanned += 1;
            if (filesScanned % 200 === 0) {
                await yieldToLoop();
                if (Date.now() - started > LIMITS.searchBudgetMs) { stopped = '超过时间预算'; return; }
            }
            if (filesScanned > LIMITS.searchFiles) { stopped = '文件数过多'; return; }
            let stat;
            try { stat = await fsp.stat(full); } catch (_error) { continue; }
            if (stat.size > LIMITS.searchFileBytes) continue;
            let buffer;
            try { buffer = await fsp.readFile(full); } catch (_error) { continue; }
            if (guard.isBinaryBuffer(buffer)) continue;
            const lines = buffer.toString('utf8').split('\n');
            const display = guard.toDisplayPath(ctx.root, full);
            for (let index = 0; index < lines.length; index += 1) {
                pattern.lastIndex = 0;
                if (!pattern.test(lines[index])) continue;
                matches.push(`${display}:${index + 1}:${lines[index].trim().slice(0, 300)}`);
                if (matches.length >= LIMITS.searchMatches) { stopped = '命中过多'; return; }
            }
        }
    };
    await walk(abs);
    const header = `搜索 "${args.query}"：${matches.length} 处命中，扫描 ${filesScanned} 个文件${stopped ? `（${stopped}，结果不完整）` : ''}`;
    return { content: [header, ...matches].join('\n'), summary: `${matches.length} 处命中` };
}

// ── 写操作 ────────────────────────────────────────────────
function assertTextSize(content) {
    const bytes = Buffer.byteLength(String(content), 'utf8');
    if (bytes > LIMITS.writeBytes) throw toolError('AGENT_TOO_LARGE', `内容超过 ${formatSize(LIMITS.writeBytes)} 上限`);
}

async function atomicWrite(abs, content) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.dragon-claw-${process.pid}-${Date.now()}.tmp`;
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, abs);
}

async function previewWrite(ctx, args = {}) {
    if (!args.path) throw toolError('AGENT_ARGS', '缺少 path');
    assertTextSize(args.content ?? '');
    const abs = guard.resolveInsideRoot(ctx.root, args.path);
    guard.assertNotSecretFile(abs);
    if (guard.looksBinaryByName(abs)) throw toolError('AGENT_BINARY', '请通过相应业务接口修改数据库或二进制文件');
    const display = guard.toDisplayPath(ctx.root, abs);
    const stat = await fsp.stat(abs).catch(() => null);
    if (stat && stat.isDirectory()) throw toolError('AGENT_IS_DIR', `${display} 是目录`);
    const before = stat ? await fsp.readFile(abs, 'utf8').catch(() => '') : '';
    const diff = unifiedDiff(display, before, String(args.content ?? ''));
    return { abs, display, exists: Boolean(stat), diff, content: String(args.content ?? '') };
}

async function writeFile(ctx, args = {}) {
    const plan = await previewWrite(ctx, args);
    ctx.changeLog?.snapshotBefore(plan.display, plan.abs);
    await atomicWrite(plan.abs, plan.content);
    const entry = ctx.changeLog?.recordAfter(plan.display);
    return {
        content: `${plan.exists ? '已覆盖' : '已创建'} ${plan.display}（+${plan.diff.added} −${plan.diff.removed}）`,
        summary: `${plan.display} +${plan.diff.added} −${plan.diff.removed}`,
        change: entry ? summarizeEntry(entry) : null
    };
}

async function previewEdit(ctx, args = {}) {
    if (!args.path) throw toolError('AGENT_ARGS', '缺少 path');
    if (typeof args.oldString !== 'string' || typeof args.newString !== 'string') throw toolError('AGENT_ARGS', 'oldString/newString 必须是字符串');
    if (!args.oldString) throw toolError('AGENT_ARGS', 'oldString 不能为空');
    const abs = guard.resolveInsideRoot(ctx.root, args.path);
    guard.assertNotSecretFile(abs);
    if (guard.looksBinaryByName(abs)) throw toolError('AGENT_BINARY', '请通过相应业务接口修改数据库或二进制文件');
    const display = guard.toDisplayPath(ctx.root, abs);
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) throw toolError('AGENT_NOT_FOUND', `文件不存在：${display}`);
    const before = await fsp.readFile(abs, 'utf8');
    const occurrences = before.split(args.oldString).length - 1;
    if (occurrences === 0) throw toolError('AGENT_EDIT_NO_MATCH', `${display} 中找不到 oldString，请先 read_file 确认精确内容（含缩进与空白）`);
    if (occurrences > 1 && !args.replaceAll) throw toolError('AGENT_EDIT_AMBIGUOUS', `${display} 中 oldString 出现 ${occurrences} 次；请扩大 oldString 使其唯一，或设置 replaceAll=true`);
    const after = args.replaceAll ? before.split(args.oldString).join(args.newString) : before.replace(args.oldString, () => args.newString);
    assertTextSize(after);
    const diff = unifiedDiff(display, before, after);
    return { abs, display, after, diff, occurrences };
}

async function editFile(ctx, args = {}) {
    const plan = await previewEdit(ctx, args);
    ctx.changeLog?.snapshotBefore(plan.display, plan.abs);
    await atomicWrite(plan.abs, plan.after);
    const entry = ctx.changeLog?.recordAfter(plan.display);
    return {
        content: `已修改 ${plan.display}（替换 ${plan.occurrences} 处，+${plan.diff.added} −${plan.diff.removed}）\n${plan.diff.text}`,
        summary: `${plan.display} +${plan.diff.added} −${plan.diff.removed}`,
        change: entry ? summarizeEntry(entry) : null
    };
}

async function deletePath(ctx, args = {}) {
    if (!args.path) throw toolError('AGENT_ARGS', '缺少 path');
    const abs = guard.resolveInsideRoot(ctx.root, args.path);
    if (abs === ctx.root) throw toolError('AGENT_PATH_OUTSIDE', '不能删除工作目录本身');
    const display = guard.toDisplayPath(ctx.root, abs);
    const stat = await fsp.lstat(abs).catch(() => null);
    if (!stat) throw toolError('AGENT_NOT_FOUND', `不存在：${display}`);
    if (stat.isDirectory() && !args.recursive) throw toolError('AGENT_IS_DIR', `${display} 是目录，删除需要 recursive=true`);
    let change = null;
    if (stat.isFile()) {
        ctx.changeLog?.snapshotBefore(display, abs);
        await fsp.rm(abs, { force: true });
        const entry = ctx.changeLog?.recordAfter(display, { kind: 'delete' });
        change = entry ? summarizeEntry(entry) : null;
    } else {
        await fsp.rm(abs, { recursive: true, force: true });
    }
    return { content: `已删除 ${display}${stat.isDirectory() ? '/' : ''}`, summary: `删除 ${display}`, change };
}

async function renamePath(ctx, args = {}) {
    if (!args.from || !args.to) throw toolError('AGENT_ARGS', '缺少 from/to');
    const fromAbs = guard.resolveInsideRoot(ctx.root, args.from);
    const toAbs = guard.resolveInsideRoot(ctx.root, args.to);
    if (fromAbs === ctx.root || toAbs === ctx.root) throw toolError('AGENT_PATH_OUTSIDE', '不能移动工作目录本身');
    const fromDisplay = guard.toDisplayPath(ctx.root, fromAbs);
    const toDisplay = guard.toDisplayPath(ctx.root, toAbs);
    if (!fs.existsSync(fromAbs)) throw toolError('AGENT_NOT_FOUND', `不存在：${fromDisplay}`);
    if (fs.existsSync(toAbs)) throw toolError('AGENT_EXISTS', `目标已存在：${toDisplay}`);
    if (ctx.changeLog?.entries.has(toDisplay)) throw toolError('AGENT_CHANGE_CONFLICT', `目标路径 ${toDisplay} 已有其他变更记录，请先处理该记录`);
    await fsp.mkdir(path.dirname(toAbs), { recursive: true });
    const isFile = (await fsp.lstat(fromAbs)).isFile();
    // 移动前先保存原文件快照：移动后原路径已不存在，事后再读会拿不到内容而无法撤销
    if (isFile) ctx.changeLog?.snapshotBefore(fromDisplay, fromAbs);
    await fsp.rename(fromAbs, toAbs);
    const entry = isFile ? ctx.changeLog?.recordRename(fromDisplay, fromAbs, toDisplay, toAbs) : null;
    return { content: `已移动 ${fromDisplay} → ${toDisplay}`, summary: `${fromDisplay} → ${toDisplay}`, change: entry ? summarizeEntry(entry) : null };
}

// ── run_command ───────────────────────────────────────────
function scrubbedEnv() {
    const env = {};
    Object.entries(process.env).forEach(([key, value]) => {
        if (SECRET_ENV_RE.test(key)) return;
        env[key] = value;
    });
    env.DRAGON_CLAW_AGENT = '1';
    return env;
}

const terminatingProcesses = new WeakSet();
function killTree(child, { platform = process.platform, spawnProcess = spawn, killGroup = process.kill, systemRoot = process.env.SystemRoot || 'C:\\Windows' } = {}) {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode || terminatingProcesses.has(child)) return;
    terminatingProcesses.add(child);
    const fallback = () => { try { child.kill('SIGKILL'); } catch (_ignored) { /* 已退出 */ } };
    try {
        if (platform === 'win32') {
            // 先结束整棵进程树，不能先杀 cmd.exe 再调用 taskkill，否则子进程可能脱离父进程。
            const taskkill = spawnProcess(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
            taskkill.on('error', fallback);
            taskkill.on('close', code => { if (code) fallback(); });
        } else killGroup(-child.pid, 'SIGKILL');
    } catch (_error) {
        fallback();
    }
}

function createOutputCollector(limit) {
    const head = [];
    const tail = [];
    let headBytes = 0;
    let tailBytes = 0;
    let total = 0;
    const half = Math.floor(limit / 2);
    return {
        push(chunk) {
            total += chunk.length;
            if (headBytes < half) {
                const take = chunk.subarray(0, half - headBytes);
                head.push(take);
                headBytes += take.length;
                chunk = chunk.subarray(take.length);
                if (!chunk.length) return;
            }
            tail.push(chunk);
            tailBytes += chunk.length;
            while (tailBytes > half && tail.length) {
                const excess = tailBytes - half;
                if (tail[0].length <= excess) tailBytes -= tail.shift().length;
                else { tail[0] = tail[0].subarray(excess); tailBytes -= excess; }
            }
        },
        text() {
            const headText = Buffer.concat(head).toString('utf8');
            const tailText = Buffer.concat(tail).toString('utf8');
            if (total <= limit) return headText + tailText;
            return `${headText}\n…（省略 ${formatSize(total - headBytes - tailBytes)}）…\n${tailText}`;
        },
        get truncated() { return total > limit; }
    };
}

/**
 * 选择执行命令的 shell。
 * - Windows：ComSpec → %SystemRoot%\System32\cmd.exe → PATH 上的 cmd.exe；避免 ComSpec 被篡改或为空时启动失败。
 * - 其他：$SHELL（必须存在且可执行）→ /bin/sh。
 */
function resolveShell(platform = process.platform, env = process.env) {
    if (platform === 'win32') {
        const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows';
        const candidates = [env.ComSpec, path.join(systemRoot, 'System32', 'cmd.exe'), path.join(systemRoot, 'Sysnative', 'cmd.exe')];
        for (const candidate of candidates) {
            if (candidate && /cmd\.exe$/i.test(candidate) && fs.existsSync(candidate)) return { shell: candidate, args: ['/d', '/s', '/c'] };
        }
        return { shell: 'cmd.exe', args: ['/d', '/s', '/c'] };
    }
    const preferred = env.SHELL;
    if (preferred && path.isAbsolute(preferred) && fs.existsSync(preferred)) return { shell: preferred, args: ['-c'] };
    return { shell: '/bin/sh', args: ['-c'] };
}

async function runCommand(ctx, args = {}) {
    const command = String(args.command || '').trim();
    if (!command) throw toolError('AGENT_ARGS', '缺少 command');
    const timeoutMs = Math.min(LIMITS.commandMaxTimeoutMs, Math.max(1000, Number(args.timeoutMs) || LIMITS.commandTimeoutMs));
    const isWin = process.platform === 'win32';
    const resolved = resolveShell();
    const shell = resolved.shell;
    const shellArgs = [...resolved.args, command];
    const started = Date.now();
    return new Promise(resolve => {
        const stdout = createOutputCollector(LIMITS.commandOutputBytes);
        const stderr = createOutputCollector(LIMITS.commandOutputBytes);
        let child;
        try {
            child = spawn(shell, shellArgs, { cwd: ctx.root, env: scrubbedEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: !isWin, windowsHide: true });
        } catch (error) {
            resolve({ content: `无法启动命令：${error.message}`, summary: '启动失败', isError: true });
            return;
        }
        ctx.onProcess?.(child);
        let finished = false;
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
        const onAbort = () => killTree(child);
        ctx.signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout.on('data', chunk => stdout.push(chunk));
        child.stderr.on('data', chunk => stderr.push(chunk));
        const finish = (code, signal, spawnError) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            ctx.signal?.removeEventListener('abort', onAbort);
            const durationMs = Date.now() - started;
            const parts = [`$ ${command}`];
            if (spawnError) parts.push(`启动失败：${spawnError.message}`);
            const out = stdout.text().trimEnd();
            const err = stderr.text().trimEnd();
            if (out) parts.push(out);
            if (err) parts.push(`[stderr]\n${err}`);
            const status = timedOut ? `已超时（${timeoutMs}ms）并终止` : ctx.signal?.aborted ? '已被用户中止' : `退出码 ${code ?? signal}`;
            parts.push(`— ${status}，耗时 ${durationMs}ms${stdout.truncated || stderr.truncated ? '，输出已截断' : ''}`);
            resolve({
                content: parts.join('\n'),
                summary: status,
                isError: Boolean(spawnError) || timedOut || (code !== 0 && code !== null),
                truncated: stdout.truncated || stderr.truncated,
                exitCode: code,
                durationMs
            });
        };
        child.on('error', error => finish(null, null, error));
        child.on('close', (code, signal) => finish(code, signal));
    });
}

function summarizeEntry(entry) {
    return { path: entry.path, kind: entry.kind, added: entry.added, removed: entry.removed, from: entry.renamedFrom || undefined, source: entry.source || 'agent' };
}

// 命令执行前后对比工作目录，把命令造成的改动记入会话更改（可撤销）。
// 延迟加载 tracker：它经 workspace-changes → pr-service 又依赖本模块，顶层 require 会形成循环。
async function runCommandTracked(ctx, args = {}) {
    if (!ctx.changeLog) return runCommand(ctx, args);
    const tracker = require('./agent-command-tracker');
    const before = await tracker.captureBefore(ctx.root).catch(() => null);
    const result = await runCommand(ctx, args);
    if (!before) return result;
    const detected = await tracker.detectAfter(ctx.root, before).catch(() => []);
    const changes = [];
    for (const item of detected) {
        const entry = ctx.changeLog.recordExternal(item.display, item.abs, {
            originalExists: item.originalExists,
            original: item.original,
            originalTooLarge: item.originalTooLarge,
            source: 'command'
        });
        if (entry) changes.push({ ...summarizeEntry(entry), revertible: ctx.changeLog.isRevertible(entry) });
    }
    if (!changes.length) return detected.length ? { ...result, mutated: true } : result;
    const listed = changes.slice(0, 10).map(item => item.path).join('、');
    return {
        ...result,
        content: `${result.content}\n— 命令改动了 ${changes.length} 个文件：${listed}${changes.length > 10 ? ' 等' : ''}（已记入更改，可撤销）`,
        changes,
        mutated: true
    };
}

const EXECUTORS = {
    list_directory: listDirectory,
    read_file: readFile,
    search,
    list_databases: async (ctx, args) => ({ content: JSON.stringify(await databaseService.listDatabases(ctx, args)), summary: 'SQLite 数据库目录' }),
    database_schema: async (ctx, args) => ({ content: JSON.stringify(await databaseService.schema(ctx, args)), summary: `${args.database} ${args.table || '业务表'}` }),
    read_database_table: async (ctx, args) => ({ content: JSON.stringify(await databaseService.readTable(ctx, args)), summary: `${args.database} / ${args.table}` }),
    ...Object.fromEntries(Object.entries({ insert_database_row: 'insert', update_database_rows: 'update', delete_database_rows: 'delete' })
        .map(([name, operation]) => [name, async (ctx, args) => {
            const result = await databaseService.writeTable(ctx, { ...args, operation });
            return { content: JSON.stringify(result), summary: `${operation} ${args.database} / ${args.table}: ${result.changes} 行` };
        }])),
    write_file: writeFile,
    edit_file: editFile,
    delete_path: deletePath,
    rename_path: renamePath,
    run_command: runCommandTracked,
    welink_list_targets: listWeLinkTargets,
    welink_send_message: sendWeLinkMessage
};

// ── 频道对接（WeLink）：通过平台公共能力调用，不涉及工作目录 ─────────────
async function listWeLinkTargets(ctx, args = {}) {
    if (ctx.readOnly) throw toolError('WELINK_FORBIDDEN', '只读账号不能查看 WeLink 联系人');
    const channels = require('./channels');
    const items = await channels.listTargets({ channel: 'welink', kind: args.kind, q: args.query, limit: Math.min(200, Math.max(1, Number(args.limit) || 50)) });
    const rows = items.map(item => ({ kind: item.kind, id: item.id, name: item.name, canPush: item.canPush, lastActiveAt: item.lastActiveAt }));
    return { content: JSON.stringify(rows), summary: `WeLink 目标 ${rows.length} 个` };
}

async function sendWeLinkMessage(ctx, args = {}) {
    const channels = require('./channels');
    const result = await channels.push({ channel: 'welink', text: args.text, targets: Array.isArray(args.targets) ? args.targets : [], trigger: 'system', source: `dragon-claw:${ctx.username || ''}` });
    const failed = result.results.filter(item => !item.ok);
    return {
        content: JSON.stringify(result),
        summary: `WeLink 推送成功 ${result.sent} 个${failed.length ? `，失败 ${failed.length} 个` : ''}`,
        ...(result.sent ? {} : { isError: true })
    };
}

/** 审批卡片用的预览：对写操作提前算 diff，之后执行时复用同一计划。 */
async function buildPreview(ctx, name, args = {}) {
    const databaseOperation = { insert_database_row: 'insert', update_database_rows: 'update', delete_database_rows: 'delete' }[name];
    if (databaseOperation) return databaseService.previewWrite(ctx, { ...args, operation: databaseOperation });
    if (name === 'write_file') {
        const plan = await previewWrite(ctx, args);
        return { path: plan.display, diff: plan.diff.text || (plan.exists ? '' : `（新建文件，${splitCount(plan.content)} 行）`), added: plan.diff.added, removed: plan.diff.removed };
    }
    if (name === 'edit_file') {
        const plan = await previewEdit(ctx, args);
        return { path: plan.display, diff: plan.diff.text, added: plan.diff.added, removed: plan.diff.removed };
    }
    if (name === 'delete_path') {
        const abs = guard.resolveInsideRoot(ctx.root, args.path || '');
        return { path: guard.toDisplayPath(ctx.root, abs), recursive: args.recursive === true };
    }
    if (name === 'rename_path') {
        return { path: guard.toDisplayPath(ctx.root, guard.resolveInsideRoot(ctx.root, args.from || '')), to: guard.toDisplayPath(ctx.root, guard.resolveInsideRoot(ctx.root, args.to || '')) };
    }
    if (name === 'welink_send_message') {
        const targets = Array.isArray(args.targets) && args.targets.length
            ? args.targets.map(item => `${item.kind === 'group' ? '群' : '人'}:${item.id}`).join('、')
            : '默认推送范围';
        return { channel: 'WeLink', targets, message: String(args.text || '').slice(0, 2000) };
    }
    if (name === 'run_command') {
        const risk = commandGuard.assessCommand(args.command, ctx.root);
        return { command: String(args.command || ''), cwd: ctx.root, ...(risk.risky ? { risk: risk.reasons } : {}) };
    }
    return {};
}

async function preview(ctx, name, args = {}) {
    return redactValue(await buildPreview(ctx, name, args), { secrets: ctx.sensitiveValues });
}

function splitCount(text) {
    return String(text || '').split('\n').length;
}

/**
 * 执行工具。返回 { content, summary, isError?, truncated?, change? }，content 已按上限截断。
 */
async function execute(ctx, name, args = {}) {
    const executor = EXECUTORS[name];
    if (!executor) return { content: `未知工具：${name}`, summary: '未知工具', isError: true };
    try {
        const result = await executor(ctx, args && typeof args === 'object' ? args : {});
        const safe = redactValue(result, { secrets: ctx.sensitiveValues });
        const clamped = clampResult(safe.content);
        return { ...safe, content: clamped.content, truncated: clamped.truncated || Boolean(result.truncated) };
    } catch (error) {
        const message = redactText(error.message, { secrets: ctx.sensitiveValues });
        return { content: `错误（${error.code || 'ERROR'}）：${message}`, summary: message, isError: true };
    }
}

module.exports = { LIMITS, definitions, kindOf, preview, execute, scrubbedEnv, resolveShell, killTree };
