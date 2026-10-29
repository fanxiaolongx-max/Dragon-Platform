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
const scriptService = require('./agent-script-service');
const artifacts = require('./agent-artifacts');
const toolkit = require('./agent-toolkit');
const memoryRepo = require('./agent-memory-repository');

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
    // 工作区循环会把大输出完整存成文件（agent-artifacts），命令输出按这个更大的上限收集
    commandArtifactBytes: 4 * 1024 * 1024,
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
        name: 'list_uiv_scripts', kind: 'read',
        description: '查询当前租户 UIVF12 脚本仓库（数据抓取页「智能调度仓库」）的 ID、名称、分类、URL 和更新时间，不返回截断的 payload_json。query 按名称/分类模糊匹配；category 按页面分组口径精确筛选。pageCategory 出现时表示列与页面载荷不一致。优先于通用数据库或 Shell。',
        parameters: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', description: '精确分类名，按页面左侧目录筛选' }, offset: { type: 'integer' }, limit: { type: 'integer' } } }
    },
    {
        name: 'list_uiv_categories', kind: 'read',
        description: '读取当前租户已登记的脚本分类、页面实际显示的脚本数量，以及与前端三区生成共用的 NetCare 站点定义。移动分类或复制到其他站点前先读取；不得猜中东域名。',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'read_uiv_script', kind: 'read',
        description: '按 ID 分段读取抓取脚本真实字段，返回 revision 和 nextOffset。保存时传 expectedRevision；field 默认 metadata，code/consoleCode/payload 可分段继续读取，不经 Shell 二次转义。',
        parameters: { type: 'object', properties: { id: { type: 'string' },
            field: { type: 'string', enum: ['metadata', 'name', 'category', 'url', 'payload', 'code', 'consoleCode', 'configOptions', 'responseSample', 'responseFocusKeyword', 'responseFocusPath', 'responseFocusConfig', 'originalFileName'] },
            offset: { type: 'integer' }, limit: { type: 'integer' } }, required: ['id'] }
    },
    {
        name: 'save_uiv_script', kind: 'write',
        description: '管理员新增(create)、复制(clone)、修改(update)或从完整原脚本重建坏副本(rebuild)并回读验证。clone 传 sourceId 和新名称，update/rebuild 传目标 id，均需 expectedRevision。rebuild 另需 sourceId/expectedSourceRevision。changes 只含修改字段；targetSite 仅切换站点地址，保留地区筛选；replacements 在完整原文上精确替换。提交前校验 JSON/JS 语法，不执行抓取代码。',
        parameters: { type: 'object', properties: {
            action: { type: 'string', enum: ['create', 'clone', 'update', 'rebuild'] }, id: { type: 'string' }, sourceId: { type: 'string' },
            expectedSourceRevision: { type: 'string', description: 'rebuild 从完整原脚本重建坏副本时必填，需同时提供坏副本的 id/expectedRevision 和原脚本的 sourceId/expectedSourceRevision；保留目标 ID 与名称' },
            expectedRevision: { type: 'string', description: 'clone 填原脚本 revision；update/rebuild 填目标脚本 revision。rebuild 还要另填 sourceId 和 expectedSourceRevision，不能省略。' }, targetSite: { type: 'string', enum: ['cn', 'ae', 'de'], description: 'NetCare目标站点；ae是中东。服务端同步 url、完整 code/consoleCode 内的已知站点地址，保留地区/代表处筛选。' },
            allowCodeRewrite: { type: 'boolean', description: '仅用户明确要求整体重写时使用；普通复制不能覆盖完整代码' },
            changes: { type: 'string', description: '仅需修改的字段，例如 {"name":"新脚本","configOptions":{"isPagination":true}}。clone 不得提供 code/consoleCode。' },
            replacements: { type: 'array', items: { type: 'object', properties: {
                field: { type: 'string', enum: ['code', 'consoleCode', 'payload'] }, oldText: { type: 'string' }, newText: { type: 'string' }, expectedOccurrences: { type: 'integer' }
            }, required: ['field', 'oldText', 'newText', 'expectedOccurrences'] } }
        }, required: ['action'] }
    },
    {
        name: 'move_uiv_script', kind: 'write',
        description: '管理员移动脚本分类；传真实分类名和最新 revision。单个用 id/expectedRevision，批量用 items（最多 50 项，逐项提交并逐项报告）。原子同步数据库 category 列和页面读取的 payload_json.category，回读核对；不改代码/站点/地区，也不受旧代码语法错误影响。返回 integrity 标明残缺脚本不能误报可运行。',
        parameters: { type: 'object', properties: { id: { type: 'string' }, category: { type: 'string' }, expectedRevision: { type: 'string' },
            items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, expectedRevision: { type: 'string' } }, required: ['id', 'expectedRevision'] } }
        }, required: ['category'] }
    },
    {
        name: 'manage_uiv_category', kind: 'write',
        description: '管理员管理数据抓取页左侧的脚本分类（目录）：create 新建、rename 改名、delete 删除。rename/delete 需 list_uiv_categories 返回的 expectedScriptCount；改名在同一事务内同步分类表、脚本 category 列与 payload_json.category。删除非空分类必须传 moveScriptsTo 先整体移走，不会删除脚本。内置分类（DataFab、NetCare中国/中东/德国、默认分类）不能改名或删除。delete 按删除类审批。',
        parameters: { type: 'object', properties: {
            action: { type: 'string', enum: ['create', 'rename', 'delete'] }, name: { type: 'string', description: '新建的分类名，或要改名/删除的现有分类' },
            newName: { type: 'string' }, expectedScriptCount: { type: 'integer' }, moveScriptsTo: { type: 'string', description: '删除非空分类时，脚本整体移入的现有分类' }
        }, required: ['action', 'name'] }
    },
    {
        name: 'delete_uiv_script', kind: 'destructive',
        description: '仅用户明确要求删除时，管理员删除指定 ID 的抓取脚本。修复、重建、同名冲突不得使用本工具腾位置，必须用 rebuild。需最新 expectedRevision，提交后回读，遵守原删除审批模式。',
        parameters: { type: 'object', properties: { id: { type: 'string' }, expectedRevision: { type: 'string' } }, required: ['id', 'expectedRevision'] }
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
    },
    // ── 常用工具（agent-toolkit.js，离线）──────────────────
    {
        name: 'read_document',
        kind: 'read',
        description: '读取 Office 文档：Excel（.xlsx/.xlsm，可选工作表）与 CSV/TSV 按行输出带行号的表格，Word（.docx）输出段落和表格，PPT（.pptx）按页输出文字和备注。PDF、旧版 .doc/.xls 暂不支持；纯文本文件用 read_file。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '相对工作目录的文件路径' },
                sheet: { type: 'string', description: 'Excel 工作表名，默认第一个有数据的工作表' },
                startRow: { type: 'integer', description: '表格起始行（从 1 开始），默认 1' },
                maxRows: { type: 'integer', description: '表格读取行数，默认 200，最多 2000' }
            },
            required: ['path']
        }
    },
    {
        name: 'query_data',
        kind: 'read',
        description: '把 Excel / CSV 表格载入临时内存数据库，用一条只读 SQL（SELECT / WITH）统计、筛选、分组、关联，结果比自己数行或心算准确。第一行是表头；单个文件的表名是 data，多个来源用 sources 并分别起表名。不传 sql 时返回表结构和样例行。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '表格文件路径（单个来源）' },
                sheet: { type: 'string', description: 'Excel 工作表名；不填时每个工作表各成一张表（表名为工作表名）' },
                sources: { type: 'array', description: '多个来源：[{ path, sheet?, table }]，最多 8 个', items: { type: 'object', properties: { path: { type: 'string' }, sheet: { type: 'string' }, table: { type: 'string' } }, required: ['path'] } },
                sql: { type: 'string', description: '一条 SELECT，如 SELECT "地区", COUNT(*) FROM data GROUP BY 1；列名有中文或空格时用双引号' },
                maxRows: { type: 'integer', description: '最多返回行数，默认 200，最多 1000' }
            }
        }
    },
    {
        name: 'diff_files',
        kind: 'read',
        description: '逐行比较两个文本文件（或两段文字）的差异，输出统一 diff 格式。path / text 是一边，otherPath / otherText 是另一边。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' }, otherPath: { type: 'string' },
                text: { type: 'string', description: '直接比较文字时使用' }, otherText: { type: 'string' },
                context: { type: 'integer', description: '差异上下文行数，默认 3' }
            }
        }
    },
    {
        name: 'multi_edit',
        kind: 'write',
        description: '对同一个文件按顺序做多处精确替换，一次提交：任何一处匹配失败都不会改动文件。每处规则与 edit_file 相同（oldString 必须唯一，除非 replaceAll）。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                edits: { type: 'array', description: '按顺序执行的替换，最多 50 处', items: { type: 'object', properties: { oldString: { type: 'string' }, newString: { type: 'string' }, replaceAll: { type: 'boolean' } }, required: ['oldString', 'newString'] } }
            },
            required: ['path', 'edits']
        }
    },
    {
        name: 'zip_files',
        kind: 'write',
        description: '把工作目录里的文件或目录打包成 .zip（跳过密钥文件和 node_modules 等依赖目录）。',
        parameters: {
            type: 'object',
            properties: {
                paths: { type: 'array', items: { type: 'string' }, description: '要打包的文件或目录' },
                output: { type: 'string', description: '输出的 .zip 路径' },
                overwrite: { type: 'boolean', description: '输出文件已存在时覆盖，默认 false' }
            },
            required: ['paths', 'output']
        }
    },
    {
        name: 'unzip_file',
        kind: 'write',
        description: '把 .zip 解压到工作目录（默认解压到同名目录）。已有同名文件时报错，除非 overwrite=true；压缩包里跳出目标目录的路径会被拒绝。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '.zip 文件路径' },
                to: { type: 'string', description: '解压到的目录，默认与压缩包同名' },
                overwrite: { type: 'boolean', description: '覆盖已有文件，默认 false' }
            },
            required: ['path']
        }
    },
    {
        name: 'memory',
        kind: 'write',
        description: '长期记忆：保存用户明确要求记住、或反复用到的偏好与约定（跨对话有效，已有的记忆会列在系统提示里）。action=add 新增、update 修改、delete 删除（按 id）、list 列出。不要保存密码、密钥等凭据，也不要保存一次性的任务细节。',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['add', 'update', 'delete', 'list'] },
                id: { type: 'integer', description: 'update / delete 时的记忆编号' },
                content: { type: 'string', description: '记忆内容，一句话，最多 500 字' }
            },
            required: ['action']
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

function kindOf(toolName, args = null) {
    // 分类工具的删除动作按删除类审批，新建/改名按普通写入
    if (toolName === 'manage_uiv_category' && args?.action === 'delete') return 'destructive';
    if (toolName === 'memory' && args?.action === 'list') return 'read';
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
    // 本人的大结果文件和对话附件在工作目录之外，也允许按行读取
    const artifact = ctx.artifactOwner && path.isAbsolute(String(args.path)) && artifacts.ownsFile(ctx.artifactOwner, String(args.path));
    const abs = artifact ? path.resolve(String(args.path)) : guard.resolveInsideRoot(ctx.root, args.path);
    const display = artifact ? abs : guard.toDisplayPath(ctx.root, abs);
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

async function previewMultiEdit(ctx, args = {}) {
    if (!args.path) throw toolError('AGENT_ARGS', '缺少 path');
    const edits = Array.isArray(args.edits) ? args.edits : [];
    if (!edits.length || edits.length > 50) throw toolError('AGENT_ARGS', 'edits 需要 1–50 处替换');
    const abs = guard.resolveInsideRoot(ctx.root, args.path);
    guard.assertNotSecretFile(abs);
    if (guard.looksBinaryByName(abs)) throw toolError('AGENT_BINARY', '请通过相应业务接口修改数据库或二进制文件');
    const display = guard.toDisplayPath(ctx.root, abs);
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) throw toolError('AGENT_NOT_FOUND', `文件不存在：${display}`);
    const before = await fsp.readFile(abs, 'utf8');
    let after = before;
    let replaced = 0;
    edits.forEach((edit, index) => {
        const label = `第 ${index + 1} 处`;
        if (typeof edit?.oldString !== 'string' || typeof edit?.newString !== 'string' || !edit.oldString) throw toolError('AGENT_ARGS', `${label}：oldString/newString 必须是字符串且 oldString 不能为空`);
        const occurrences = after.split(edit.oldString).length - 1;
        if (occurrences === 0) throw toolError('AGENT_EDIT_NO_MATCH', `${label}：${display} 中找不到 oldString（已按顺序应用前面的修改），文件未改动；请先 read_file 确认精确内容`);
        if (occurrences > 1 && !edit.replaceAll) throw toolError('AGENT_EDIT_AMBIGUOUS', `${label}：oldString 出现 ${occurrences} 次；请扩大 oldString 使其唯一，或设置 replaceAll=true。文件未改动`);
        after = edit.replaceAll ? after.split(edit.oldString).join(edit.newString) : after.replace(edit.oldString, () => edit.newString);
        replaced += edit.replaceAll ? occurrences : 1;
    });
    assertTextSize(after);
    return { abs, display, after, diff: unifiedDiff(display, before, after), replaced };
}

async function multiEdit(ctx, args = {}) {
    const plan = await previewMultiEdit(ctx, args);
    ctx.changeLog?.snapshotBefore(plan.display, plan.abs);
    await atomicWrite(plan.abs, plan.after);
    const entry = ctx.changeLog?.recordAfter(plan.display);
    return {
        content: `已修改 ${plan.display}（${args.edits.length} 处修改共替换 ${plan.replaced} 处，+${plan.diff.added} −${plan.diff.removed}）\n${plan.diff.text}`,
        summary: `${plan.display} +${plan.diff.added} −${plan.diff.removed}`,
        change: entry ? summarizeEntry(entry) : null
    };
}

async function memoryTool(ctx, args = {}) {
    return memoryRepo.execute(ctx, args);
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
        const outputLimit = ctx.fullResults ? LIMITS.commandArtifactBytes : LIMITS.commandOutputBytes;
        const stdout = createOutputCollector(outputLimit);
        const stderr = createOutputCollector(outputLimit);
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
    list_uiv_scripts: async (ctx, args) => ({ content: JSON.stringify(await scriptService.list(ctx, args)), summary: '抓取脚本目录' }),
    list_uiv_categories: async ctx => ({ content: JSON.stringify(await scriptService.categories(ctx)), summary: '脚本分类与站点定义' }),
    read_uiv_script: async (ctx, args) => ({ content: JSON.stringify(await scriptService.read(ctx, args)), summary: `抓取脚本 ${args.id} / ${args.field || 'metadata'}` }),
    save_uiv_script: async (ctx, args) => {
        if (!['create', 'clone', 'update', 'rebuild'].includes(args.action)) throw toolError('AGENT_SCRIPT_INVALID', '保存工具只支持 create、clone、update、rebuild');
        const result = await scriptService.save(ctx, args);
        return { content: JSON.stringify(result), isError: !result.verified, summary: `${result.action} ${result.name} · ${result.verified ? '已保存并回读' : '已提交，回读不一致'}` };
    },
    move_uiv_script: async (ctx, args) => {
        const result = await scriptService.move(ctx, args);
        return { content: JSON.stringify(result), isError: !result.verified,
            summary: result.results ? `${result.moved} 个脚本 → ${result.category}${result.failed ? `，${result.failed} 个失败` : ' · 已逐项回读'}`
                : `${result.name} → ${result.category} · ${result.verified ? '分类已回读' : '回读不一致'}${result.ready ? '' : '；原脚本仍不完整'}` };
    },
    manage_uiv_category: async (ctx, args) => {
        const result = await scriptService.manageCategory(ctx, args);
        const label = { create: '新建分类', rename: '分类改名', delete: '删除分类' }[result.action];
        return { content: JSON.stringify(result), isError: !result.verified,
            summary: `${label} ${result.previousName ? `${result.previousName} → ` : ''}${result.action === 'delete' ? result.previousName : result.category}${result.movedScripts ? ` · 同步 ${result.movedScripts} 个脚本` : ''} · ${result.verified ? '已回读' : '回读不一致'}` };
    },
    delete_uiv_script: async (ctx, args) => {
        scriptService.assertDeletionRequested(ctx);
        const result = await scriptService.save(ctx, { ...args, action: 'delete' });
        return { content: JSON.stringify(result), summary: `删除 ${result.name} · ${result.verified ? '已核对' : '回读不一致'}` };
    },
    list_directory: listDirectory,
    read_file: readFile,
    search,
    list_databases: async (ctx, args) => ({ content: JSON.stringify(await databaseService.listDatabases(ctx, args)), summary: 'SQLite 数据库目录' }),
    database_schema: async (ctx, args) => ({ content: JSON.stringify(await databaseService.schema(ctx, args)), summary: `${args.database} ${args.table || '业务表'}` }),
    read_database_table: async (ctx, args) => ({ content: JSON.stringify(await databaseService.readTable(ctx, args)), summary: `${args.database} / ${args.table}` }),
    ...Object.fromEntries(Object.entries({ insert_database_row: 'insert', update_database_rows: 'update', delete_database_rows: 'delete' })
        .map(([name, operation]) => [name, async (ctx, args) => {
            assertScriptTool(args);
            const result = await databaseService.writeTable(ctx, { ...args, operation });
            return { content: JSON.stringify(result), summary: `${operation} ${args.database} / ${args.table}: ${result.changes} 行` };
        }])),
    write_file: writeFile,
    edit_file: editFile,
    multi_edit: multiEdit,
    read_document: toolkit.readDocument,
    query_data: toolkit.queryData,
    diff_files: toolkit.diffFiles,
    zip_files: async (ctx, args) => {
        const { changeEntry, ...result } = await toolkit.zipFiles(ctx, args);
        return { ...result, change: changeEntry ? summarizeEntry(changeEntry) : null };
    },
    unzip_file: async (ctx, args) => {
        const { changeEntries, ...result } = await toolkit.unzipFile(ctx, args);
        return { ...result, changes: (changeEntries || []).map(summarizeEntry), mutated: true };
    },
    memory: memoryTool,
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
    if (name === 'delete_uiv_script') scriptService.assertDeletionRequested(ctx);
    if (name === 'move_uiv_script') return scriptService.move(ctx, args, true);
    if (name === 'manage_uiv_category') return scriptService.manageCategory(ctx, args, true);
    if (name === 'save_uiv_script' || name === 'delete_uiv_script') return scriptService.preview(ctx, { ...args, action: name === 'delete_uiv_script' ? 'delete' : args.action });
    const databaseOperation = { insert_database_row: 'insert', update_database_rows: 'update', delete_database_rows: 'delete' }[name];
    if (databaseOperation) {
        assertScriptTool(args);
        return databaseService.previewWrite(ctx, { ...args, operation: databaseOperation });
    }
    if (name === 'write_file') {
        const plan = await previewWrite(ctx, args);
        return { path: plan.display, diff: plan.diff.text || (plan.exists ? '' : `（新建文件，${splitCount(plan.content)} 行）`), added: plan.diff.added, removed: plan.diff.removed };
    }
    if (name === 'edit_file') {
        const plan = await previewEdit(ctx, args);
        return { path: plan.display, diff: plan.diff.text, added: plan.diff.added, removed: plan.diff.removed };
    }
    if (name === 'multi_edit') {
        const plan = await previewMultiEdit(ctx, args);
        return { path: plan.display, diff: plan.diff.text, added: plan.diff.added, removed: plan.diff.removed };
    }
    if (name === 'zip_files') {
        const plan = await toolkit.planZip(ctx, args);
        return { title: '打包', fields: [{ label: '输出', value: plan.outDisplay }, { label: '文件', value: `${plan.entries.length} 个，约 ${(plan.total / 1024).toFixed(1)} KB` }] };
    }
    if (name === 'unzip_file') {
        const plan = await toolkit.planUnzip(ctx, args);
        return { title: '解压', fields: [{ label: '压缩包', value: plan.file.display }, { label: '解压到', value: `${plan.targetDisplay}/` }, { label: '文件', value: `${plan.items.length} 个${plan.conflicts ? `（覆盖 ${plan.conflicts} 个已有文件）` : ''}` }] };
    }
    if (name === 'memory') return memoryRepo.preview(ctx, args);
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

function assertScriptTool(args) {
    if (['uiv_scripts', 'uiv_categories'].includes(String(args.table).toLowerCase()) && /^platform:(?:(?:data|report)\/)?tools\.db$/i.test(String(args.database))) {
        throw toolError('AGENT_SCRIPT_TOOL_REQUIRED', '脚本仓库与分类不能用通用数据库工具直接写单列或截断载荷；脚本用 save_uiv_script / move_uiv_script / delete_uiv_script（先读取完整元数据与 revision），分类用 manage_uiv_category。');
    }
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
        // fullResults：调用方（工作区循环）自己把大结果存成文件，这里不再掐头去尾；read_file 本身已按行分页
        if (ctx.fullResults && name !== 'read_file') return { ...safe, content: String(safe.content ?? ''), truncated: Boolean(result.truncated) };
        const clamped = clampResult(safe.content);
        return { ...safe, content: clamped.content, truncated: clamped.truncated || Boolean(result.truncated) };
    } catch (error) {
        return errorResult(ctx, error);
    }
}

// 预览校验与实际执行都保留恢复参数，工作区不能在预览失败时丢掉 suggestedCall。
function errorResult(ctx, error) {
    const message = redactText(error.message, { secrets: ctx.sensitiveValues });
    const content = error.details
        ? JSON.stringify(redactValue({ error: { code: error.code || 'ERROR', message, details: error.details } }, { secrets: ctx.sensitiveValues }))
        : `错误（${error.code || 'ERROR'}）：${message}`;
    return { content, summary: message, isError: true };
}

module.exports = { LIMITS, definitions, kindOf, preview, execute, errorResult, scrubbedEnv, resolveShell, killTree };
