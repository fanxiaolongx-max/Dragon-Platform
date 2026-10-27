// @welink-office Skill 的工具：管理员在首页 Dragon Claw（普通对话，不选工作目录）里以本人身份查询 WeLink。
// 第一期只开放只读命令（搜索、联系人、聊天记录、会议、云空间浏览、邮件与日历查询）；
// 发送、撤回、建群、建会、删除、下载等会改变外部状态或写本地磁盘的命令不在白名单里。
// 参数按白名单逐个校验后组装成参数数组交给 welink-cli-runner，不拼命令行字符串。
const runner = require('./welink-cli-runner');

const SKILL_ID = 'welink-office';
const MAX_STEPS = 10;
const RESULT_CHARS = 24 * 1024;
const MAX_VALUE_CHARS = 500;
const MAX_LIST_ITEMS = 50;

// type：string | int | bool（无值开关）| list（同一个参数后跟多个值）| date（YYYY-MM-DD）| ms（13 位毫秒时间戳）
const COMMANDS = {
    'auth status': { label: '查看登录状态', options: {} },
    'search person': { label: '搜索联系人', options: { text: { type: 'string', required: true }, 'page-size': { type: 'int', min: 1, max: 50 } } },
    'search group': { label: '搜索群组', options: { text: { type: 'string', required: true }, 'page-size': { type: 'int', min: 1, max: 50 }, type: { type: 'int', min: 0, max: 2 } } },
    'contact detail': { label: '查询用户详情', positional: { name: 'accounts', required: true }, options: {} },
    'contact favorite_list': { label: '特别关注列表', options: { pageIndex: { type: 'int', min: 1, max: 10000 }, pageSize: { type: 'int', min: 1, max: 50 } } },
    'im query-recent-conversation': { label: '最近会话', options: { count: { type: 'int', min: 1, max: 100 } } },
    'im query-group-member': { label: '群成员', options: { 'group-id': { type: 'string', required: true } } },
    'im query-history-message': {
        label: '聊天记录',
        oneOf: ['group-id', 'user-account'],
        options: { 'group-id': { type: 'string' }, 'user-account': { type: 'string' }, 'query-count': { type: 'int', min: 1, max: 100 }, 'message-id': { type: 'string' }, 'query-direction': { type: 'int', min: 0, max: 1 } }
    },
    'meeting query-list': {
        label: '会议列表',
        options: {
            'meeting-start-time': { type: 'ms', required: true }, 'meeting-end-time': { type: 'ms', required: true },
            type: { type: 'int', min: 0, max: 5, required: true }, 'meeting-sort': { type: 'enum', values: ['asc', 'desc'], required: true },
            page: { type: 'int', min: 0, max: 10000, required: true }, size: { type: 'int', min: 1, max: 30, required: true }
        }
    },
    'meeting info': { label: '会议详情', options: { 'meeting-id': { type: 'string', required: true } } },
    'meeting topic': { label: '会议议题', options: { 'meeting-id': { type: 'string', required: true } } },
    'meeting topic-materials': { label: '议题材料', options: { 'meeting-id': { type: 'string', required: true }, 'topic-id': { type: 'string', required: true } } },
    'meeting fuzzy-search': {
        label: '搜索会议',
        pairs: true,
        options: { 'result-type': { type: 'enum', values: ['meeting', 'file'], required: true }, limit: { type: 'int', min: 1, max: 50, required: true }, offset: { type: 'int', min: 0, max: 10000, required: true }, 'with-full-content': { type: 'enum', values: ['true', 'false'] } }
    },
    'onebox user-info': { label: '个人云空间信息', options: {} },
    'onebox folder-list': { label: '列出文件夹', options: { 'space-id': { type: 'string', required: true }, 'folder-id': { type: 'string' }, limit: { type: 'int', min: 1, max: 100 }, offset: { type: 'int', min: 0, max: 100000 } } },
    'onebox file-info': { label: '文件信息', options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true } } },
    'onebox node-search': {
        label: '搜索云空间',
        options: { 'space-id': { type: 'string', required: true }, name: { type: 'string', required: true }, offset: { type: 'int', min: 0, max: 100000 }, limit: { type: 'int', min: 1, max: 100 }, 'with-path': { type: 'bool' }, 'exact-search': { type: 'bool' }, 'file-type': { type: 'enum', values: ['file', 'folder', 'all'] } }
    },
    'mail autodiscover': { label: '发现邮箱服务器', options: { email: { type: 'string', required: true } } },
    'mail folders': { label: '邮件文件夹', options: {} },
    'mail list': {
        label: '邮件列表',
        options: { 'folder-id': { type: 'string' }, max: { type: 'int', min: 1, max: 100 }, offset: { type: 'int', min: 0, max: 100000 }, 'is-read': { type: 'int', min: -1, max: 1 }, from: { type: 'string' }, subject: { type: 'string' }, start: { type: 'date' }, end: { type: 'date' }, query: { type: 'string' } }
    },
    'mail get': { label: '邮件详情', options: { 'item-id': { type: 'string', required: true }, 'body-type': { type: 'enum', values: ['Text', 'HTML'] } } },
    'calendar list': { label: '日历列表', options: { start: { type: 'date' }, end: { type: 'date' }, max: { type: 'int', min: 1, max: 100 } } },
    'calendar get': { label: '日程详情', options: { 'item-id': { type: 'string', required: true }, 'body-type': { type: 'enum', values: ['Text', 'HTML'] } } }
};
const COMMAND_NAMES = Object.keys(COMMANDS);

function toolError(code, message) {
    return Object.assign(new Error(message), { code });
}

/** 参数名宽松匹配：group-id / groupId / group_id / --group-id 都对应 --group-id。 */
const looseKey = key => String(key || '').replace(/^-+/, '').replace(/[-_]/g, '').toLowerCase();

function checkString(name, value) {
    const text = String(value ?? '').trim();
    if (!text) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 不能为空`);
    if (text.length > MAX_VALUE_CHARS) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 超过 ${MAX_VALUE_CHARS} 字`);
    // 以 - 开头的值会被 CLI 当成参数名
    if (text.startsWith('-')) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 不能以 - 开头`);
    if (/[\u0000-\u001f]/.test(text)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 含有控制字符`);
    return text;
}

function formatValue(name, spec, value) {
    if (spec.type === 'int') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < spec.min || number > spec.max) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 应为 ${spec.min}~${spec.max} 的整数`);
        return String(number);
    }
    if (spec.type === 'ms') {
        const text = String(value ?? '').trim();
        if (!/^\d{13}$/.test(text)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 应为 13 位毫秒时间戳`);
        return text;
    }
    if (spec.type === 'date') {
        const text = String(value ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 应为 YYYY-MM-DD`);
        return text;
    }
    if (spec.type === 'enum') {
        const text = String(value ?? '').trim();
        const match = spec.values.find(item => item.toLowerCase() === text.toLowerCase());
        if (!match) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 只能是 ${spec.values.join(' / ')}`);
        return match;
    }
    return checkString(name, value);
}

function listValues(name, value) {
    const items = (Array.isArray(value) ? value : String(value ?? '').split(/[,，\s]+/)).map(item => String(item ?? '').trim()).filter(Boolean);
    if (!items.length) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 至少需要一个值`);
    if (items.length > MAX_LIST_ITEMS) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 最多 ${MAX_LIST_ITEMS} 个`);
    return items.map(item => checkString(name, item));
}

/** 把模型给的 { command, options, accounts, search } 转成 CLI 参数数组；任何不在白名单里的东西都拒绝。 */
function buildArgs(input = {}) {
    const command = String(input.command || '').trim().replace(/\s+/g, ' ');
    const spec = COMMANDS[command];
    if (!spec) throw toolError('WELINK_COMMAND_NOT_ALLOWED', `不支持的命令：${command || '（空）'}。可用：${COMMAND_NAMES.join('、')}`);
    const args = command.split(' ');
    const given = input.options && typeof input.options === 'object' && !Array.isArray(input.options) ? input.options : {};
    const byLoose = new Map(Object.keys(spec.options).map(name => [looseKey(name), name]));
    const values = {};
    for (const [rawKey, value] of Object.entries(given)) {
        if (value === undefined || value === null || value === '') continue;
        const name = byLoose.get(looseKey(rawKey));
        if (!name) throw toolError('WELINK_ARG_NOT_ALLOWED', `命令 ${command} 不支持参数 ${rawKey}。可用参数：${Object.keys(spec.options).join('、') || '无'}`);
        values[name] = value;
    }
    for (const [name, optionSpec] of Object.entries(spec.options)) {
        if (optionSpec.required && values[name] === undefined) throw toolError('WELINK_ARG_REQUIRED', `命令 ${command} 缺少必填参数 ${name}`);
    }
    if (spec.oneOf && spec.oneOf.filter(name => values[name] !== undefined).length !== 1) {
        throw toolError('WELINK_ARG_REQUIRED', `命令 ${command} 需要且只能提供 ${spec.oneOf.join(' 或 ')} 之一`);
    }
    for (const [name, value] of Object.entries(values)) {
        const optionSpec = spec.options[name];
        if (optionSpec.type === 'bool') {
            if (value === true || value === 'true') args.push(`--${name}`);
            continue;
        }
        args.push(`--${name}`, formatValue(name, optionSpec, value));
    }
    if (spec.pairs) {
        // fuzzy-search 的条件是成对重复的 --search-type X --search-content Y
        const pairs = Array.isArray(input.search) ? input.search : [];
        if (!pairs.length) throw toolError('WELINK_ARG_REQUIRED', `命令 ${command} 需要 search 条件，如 [{"type":"subject","content":"周会"}]`);
        if (pairs.length > 10) throw toolError('WELINK_ARG_INVALID', 'search 条件最多 10 组');
        for (const pair of pairs) {
            args.push('--search-type', checkString('search.type', pair?.type), '--search-content', checkString('search.content', pair?.content));
        }
    }
    if (spec.positional) {
        const name = spec.positional.name;
        args.push(...listValues(name, input[name] ?? given[name]));
    }
    const timezone = String(input.timezone || '').trim();
    if (timezone && /^(mail|calendar) /.test(command)) {
        // --timezone 要写在 mail/calendar 之后、子命令之前
        if (!/^[A-Za-z][A-Za-z .()+-]{1,60}$/.test(timezone)) throw toolError('WELINK_ARG_INVALID', 'timezone 应为 Windows 时区 ID，如 China Standard Time');
        args.splice(1, 0, '--timezone', timezone);
    }
    return { command, args, label: spec.label };
}

function definitions() {
    return [{
        name: 'welink_query',
        description: [
            '以当前用户本人身份执行只读的 welink-cli 命令（需本机 WeLink PC 已登录、平台已启用 welink-cli）。',
            '参数名与 welink-cli 一致（不带 --），例如 {"command":"search person","options":{"text":"张三"}}。',
            'contact detail 用 accounts 传 welinkId 列表；meeting fuzzy-search 用 search 传 [{type,content}] 条件。',
            '只能查询，不能发送消息、发邮件、建会或删除。'
        ].join(''),
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: COMMAND_NAMES, description: '命令' },
                options: { type: 'object', description: '命令参数，键为参数名（如 group-id、query-count、start），值为字符串/数字/布尔' },
                accounts: { type: 'array', items: { type: 'string' }, description: 'contact detail 的 welinkId 列表' },
                timezone: { type: 'string', description: 'mail/calendar 的时区 ID，默认 China Standard Time；如 Egypt Standard Time' },
                search: {
                    type: 'array',
                    description: 'meeting fuzzy-search 的条件',
                    items: { type: 'object', properties: { type: { type: 'string', description: 'subject / startTime / endTime 等' }, content: { type: 'string' } }, required: ['type', 'content'] }
                }
            },
            required: ['command']
        }
    }];
}

function clamp(text) {
    const value = String(text || '');
    return value.length > RESULT_CHARS ? { content: `${value.slice(0, RESULT_CHARS)}\n…（结果过长已截断，请缩小查询范围或分页）`, truncated: true } : { content: value, truncated: false };
}

function countOf(json) {
    if (Array.isArray(json)) return json.length;
    if (json && typeof json === 'object') {
        for (const key of ['data', 'list', 'items', 'records', 'result']) {
            if (Array.isArray(json[key])) return json[key].length;
        }
    }
    return null;
}

async function execute(ctx, name, args = {}) {
    if (name !== 'welink_query') return { content: `未知工具：${name}`, summary: '未知工具', isError: true };
    try {
        runner.assertTenant();
        if (!runner.readConfig().enabled) throw toolError('WELINK_CLI_DISABLED', '管理员尚未在「全局设置 › 频道对接 › WeLink › 个人身份（welink-cli）」启用该能力');
        const built = buildArgs(args && typeof args === 'object' ? args : {});
        const result = await runner.run(built.args, { signal: ctx.signal });
        if (!result.ok) {
            return { content: `welink-cli ${built.command} 失败：${result.error}`, summary: `${built.label}失败`, isError: true };
        }
        const body = result.json !== null ? JSON.stringify(result.json) : result.text;
        const clamped = clamp(body);
        const count = countOf(result.json);
        return { content: clamped.content, summary: `${built.label}${count === null ? '' : ` ${count} 条`}`, truncated: clamped.truncated };
    } catch (error) {
        return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: error.message.slice(0, 120), isError: true };
    }
}

async function buildPrompt() {
    const config = runner.readConfig();
    const lines = ['', '【WeLink 个人身份工具（@welink-office）】'];
    if (!runner.tenantAllowed()) {
        lines.push('当前租户不能使用 welink-cli（只开放给默认租户）。请如实告诉用户。');
    } else if (!config.enabled) {
        lines.push('welink-cli 尚未启用。请告诉用户到「全局设置 › 频道对接 › WeLink › 个人身份（welink-cli）」检测安装、扫码登录并启用。');
    } else {
        lines.push(
            '用 welink_query 以用户本人身份查询 WeLink（只读）。结果以工具返回为准，不要编造人员、消息、会议或邮件内容。',
            `今天是 ${new Date().toLocaleDateString('sv-SE')}（平台服务器本地日期）；meeting 的时间参数是 13 位毫秒时间戳，mail/calendar 的 --end 不包含当天（查某天要写次日）。`,
            config.email ? `已为 ${config.email} 执行过 mail autodiscover。` : '首次查邮件或日历前，需先用 mail autodiscover 传入用户邮箱（不知道就先问用户）。',
            '当前只能查询；用户要求发送、回复、建会、删除时，说明这一期还不支持，并给出可以手动执行的 welink-cli 命令供参考。'
        );
    }
    return lines.join('\n');
}

/**
 * 带 welink_query 工具的一轮回复（与 @ops-group 相同的工具循环）。
 * @returns {Promise<{text, usage, toolLog}>}
 */
async function runTurn({ client, systemInstruction, messages, ctx = {}, signal, onDelta, maxOutputTokens, temperature }) {
    const tools = definitions();
    const history = messages.map(item => ({ ...item }));
    const usage = { promptTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const toolLog = [];
    let activeClient = client;
    for (let step = 1; step <= MAX_STEPS; step += 1) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        let result;
        try {
            result = await activeClient.generateText({ systemInstruction, messages: history, tools, maxOutputTokens, temperature, signal, onDelta });
        } catch (error) {
            if (step === 1 && error?.code === 'AI_TOOLS_UNSUPPORTED') {
                result = await activeClient.generateText({ systemInstruction: `${systemInstruction}\n\n（当前模型不支持工具调用，WeLink 查询暂不可用；请说明需要管理员切换支持函数调用的模型。）`, messages: history, maxOutputTokens, temperature, signal, onDelta });
                return { text: result.text || '', usage: result.usage || usage, toolLog, toolsUnsupported: true };
            }
            throw error;
        }
        if (result.providerClient) activeClient = result.providerClient;
        usage.promptTokens = Number(result.usage?.promptTokens || 0);
        usage.inputTokens += Number(result.usage?.promptTokens || 0);
        usage.outputTokens += Number(result.usage?.outputTokens || 0);
        usage.totalTokens += Number(result.usage?.totalTokens || 0);
        const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
        if (!calls.length) return { text: result.text || '', usage, toolLog };
        if (result.text && onDelta) onDelta('\n\n');
        history.push({ role: 'model', content: result.text || '', toolCalls: calls });
        const toolResults = [];
        for (const call of calls) {
            const outcome = await execute({ ...ctx, signal }, call.name, call.args);
            toolLog.push({ tool: call.name, ok: !outcome.isError, summary: outcome.summary });
            toolResults.push({ id: call.id, name: call.name, content: outcome.content, isError: Boolean(outcome.isError) });
        }
        history.push({ role: 'tool', toolResults });
    }
    const text = '已达到单轮最大工具调用步数，请再发一条消息继续。';
    onDelta?.(text);
    return { text, usage, toolLog };
}

module.exports = { SKILL_ID, COMMANDS, definitions, buildArgs, execute, buildPrompt, runTurn };
