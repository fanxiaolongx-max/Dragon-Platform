// 首页对话的附加工具组：浏览器（桌面端 Dragon 浏览器 / 服务端本机 Chrome），以及之后的 MCP 服务。
// 各组整组按需加载（系统提示只列名称，tool_search 加载），审批按工具类别：
// - 工作区：经 agent-tool-registry 的 extraToolsets 接入，走工作区的审批卡与权限模式；
// - 不选目录的对话：forChat() 建一个只含附加工具的登记表，审批卡走同一套 /api/agent-workspace/approvals。
// 只给管理员（打开网址可访问服务端能访问的内网地址）。
const browser = require('./agent-browser');

// 平台工具向导：按需求找平台上的工具、读某个工具的使用说明（只读，所有账号可用）
const PLATFORM_TOOL_DEFINITIONS = [
    {
        name: 'find_platform_tools',
        description: '按用户的需求或关键词，在本平台的工具里找能解决问题的工具（含平台页面和自定义工具），返回名称、入口路径和一句话说明。用户描述一个需求、问「平台有没有能……的工具」、或工具目录里没找到合适的时候用。',
        parameters: { type: 'object', properties: { query: { type: 'string', description: '用户的需求原话或关键词' }, limit: { type: 'integer', description: '最多返回几个，默认 6' } }, required: ['query'] }
    },
    {
        name: 'read_tool_guide',
        description: '读取平台上某个工具的使用说明：能做什么、什么时候用、操作步骤、工作原理、注意事项。用户问某个工具怎么用、怎么工作时用；tool 填工具名称、入口路径或 find_platform_tools 返回的 id。',
        parameters: { type: 'object', properties: { tool: { type: 'string' } }, required: ['tool'] }
    }
];

async function executePlatformTool(name, args = {}, user) {
    const guides = require('./platform-tool-guides');
    try {
        if (name === 'find_platform_tools') {
            const items = await guides.findTools(String(args.query || ''), { limit: Number(args.limit) || 6, user });
            if (!items.length) return { content: '没有找到相关的平台工具。可以换个说法，或参考系统提示里的平台工具目录。', summary: '没有找到' };
            return { content: items.map(item => `- [${item.title}](${item.href})｜id: ${item.id}｜${item.summary}${item.hasGuide ? '' : '（还没有生成详细说明）'}`).join('\n'), summary: `找到 ${items.length} 个工具` };
        }
        const tool = await guides.toolGuide(args.tool, { user });
        if (!tool) {
            const rawRef = String(args.tool || '').trim().replace(/^@|^\/\?skill=/i, '');
            const skillStore = require('./agent-skills-store');
            const allSkills = await skillStore.listForUser(user).catch(() => []);
            const matchedSkill = allSkills.find(item => item.id === rawRef.toLowerCase() || item.name === rawRef || item.nameEn === rawRef);
            if (matchedSkill) {
                const loaded = await skillStore.loadSection(matchedSkill.id, user);
                if (loaded) return { content: loaded.section, summary: `@${matchedSkill.id} 技能说明` };
            }
            return { content: `平台上没有找到「${args.tool}」这个工具，先用 find_platform_tools 搜一下。`, summary: '没有这个工具', isError: true };
        }
        const body = tool.guide
            ? `摘要：${tool.summary}\n\n${tool.guide}`
            : `（这个工具还没有生成使用说明，以下只有简介；需要更多细节时可结合项目知识检索结果，或请管理员在「全局设置 › 智能体工具」生成说明。）\n简介：${tool.description}\n标签：${tool.tags.join('、') || '无'}`;
        return { content: `# ${tool.title}\n入口：${tool.href}\n\n${body}`, summary: `${tool.title} 的使用说明` };
    } catch (error) {
        return { content: `错误：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
    }
}

const platformToolset = user => ({
    id: 'platform_tools',
    label: '平台工具向导：按需求找平台上的工具、读某个工具的使用说明（怎么用、原理）',
    definitions: PLATFORM_TOOL_DEFINITIONS,
    kindOf: () => 'read',
    preview: async () => ({}),
    alwaysKey: name => name,
    execute: call => executePlatformTool(call.name, call.args && typeof call.args === 'object' ? call.args : {}, user)
});

/**
 * 当前可用的附加工具组；owner 为 租户::账号。
 * channel：频道对话（{ channel, conversation, actor, canSaveSkills }），只带只读的平台工具向导和受信任的 MCP 服务；
 * canSaveSkills（微信机器人主人、WeLink 管理员）再带技能自我进化，保存要用户在频道里回复确认码。
 */
async function toolsets({ owner, user, readOnly, channel = null }) {
    if (!owner) return [];
    // 平台共享的 MCP 服务与服务器本机浏览器运行在团队沙箱之外：非超级管理员默认不开放，由 agent-tool-access 统一过滤
    const sets = [platformToolset(user ?? await require('./tool-distribution').actorForOwner(owner))];
    if (channel) {
        if (channel.canSaveSkills) sets.push(require('./agent-skill-tools').toolset({ owner, user }));
        sets.push(...await require('./agent-mcp').toolsets({ readOnly, trustedOnly: true }).catch(error => { console.warn('[agent] MCP 工具不可用：', error.message || error); return []; }));
        return sets;
    }
    sets.push(...await require('./agent-mcp').toolsets().catch(error => { console.warn('[agent] MCP 工具不可用：', error.message || error); return []; }));
    if (readOnly) return sets;
    sets.push(require('./agent-skill-tools').toolset({ owner, user })); // 技能自我进化：保存前用户审批
    const where = browser.available();
    if (where) {
        const ctx = { owner };
        sets.push({
            id: 'browser',
            label: `浏览器（${where.kind === 'desktop' ? 'Dragon 浏览器，页面显示在桌面上' : `本机 ${where.label}，无界面`}）：打开网页、读页面、点击输入、抓网络请求与控制台`,
            definitions: browser.definitions(),
            kindOf: name => browser.kindOf(name),
            preview: (name, args) => browser.preview(ctx, name, args),
            alwaysKey: (name, args) => browser.alwaysKey(name, args),
            execute: (call,{signal}={}) => browser.execute({...ctx,signal}, call.name, call.args && typeof call.args === 'object' ? call.args : {})
        });
    }
    return sets;
}

/**
 * 不选目录的对话：返回 { definitions(), prompt, handles(name), execute(call, { start }), end() }；没有可用工具组时返回 null。
 * 审批：读取类直接执行，其余弹审批卡（「总是允许」在本对话内有效）。
 */
async function forChat({ owner, user, chatSessionId, readOnly, write, signal, sensitiveValues = [], channel = null }) {
    const sets = await toolsets({ owner, user, readOnly, channel });
    if (!sets.length) return null;
    const manager = require('./agent-run-manager');
    const session = manager.chatSession(owner, chatSessionId);
    session.readOnly = Boolean(readOnly);
    session.unattended = Boolean(channel); // 频道里没人能点审批卡
    const registry = await require('./agent-tool-registry').create({ session, user, core: false, skillCatalog: true, extraToolsets: sets, sensitiveValues });
    const run = manager.beginChatRun({ owner, chatSessionId, write, signal });
    return {
        definitions: () => registry.definitions(),
        allowed: registry.allowed,
        prompt: registry.catalogPrompt(),
        handles: name => registry.isMeta(name) || Boolean(registry.toolset(name)),
        async execute(call, { start }) {
            start();
            if (registry.isMeta(call.name)) return registry.runMeta(call);
            const set = registry.toolset(call.name);
            registry.noteCall(call.name);
            const kind = set.kindOf(call.name, call.args);
            // 频道里显示不了审批卡：需要确认的操作挂起，用户回复确认码后再执行
            if (channel && kind === 'confirm' && !session.alwaysAllow.has(set.alwaysKey?.(call.name, call.args) || call.name)) {
                let preview;
                try { preview = await set.preview(call.name, call.args); } catch (error) {
                    return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
                }
                return require('./channels/channel-pending-actions').defer({ ...channel, title: confirmTitle(call, preview), preview, execute: () => set.execute(call) })
                    || { content: '这个操作需要用户确认，当前频道会话无法确认，没有执行', summary: '需要确认，未执行', isError: true };
            }
            const decision = await manager.decideCall(run, call, { kind, preview: () => set.preview(call.name, call.args), key: set.alwaysKey?.(call.name, call.args), sharedMcp: set.sharedMcp });
            if (decision.outcome) return decision.outcome;
            return set.execute(call,{signal});
        },
        end: () => run.end()
    };
}

/** 待确认操作的标题，如「保存技能 @industry-news-summary」 */
function confirmTitle(call, preview = {}) {
    if (call.name === 'save_skill') return `保存技能 ${String(preview.path || '').split(' · ')[0] || ''}`.trim();
    return call.name;
}

/**
 * 频道对话（微信、WeLink 非完全访问）的一轮回复：只有附加工具（技能目录、平台工具向导、受信任的 MCP），没有文件和命令。
 * bufferText：微信一次性发送正文，工具之间的过渡语不逐字下发，结束时只发最终回复。
 */
async function runChannelTurn({ extras, client, systemInstruction, messages, owner, chatSessionId, sensitiveValues = [], signal, onDelta, onEvent, maxOutputTokens, temperature, model, bufferText = false }) {
    const result = await require('./agent-loop').runToolLoop({
        extras, client, model, systemPrompt: systemInstruction, messages, tools: [],
        builtins: ['calculate'], // 频道里没有任务清单和选项卡片
        write: event => (event.type === 'delta' ? (bufferText ? undefined : onDelta?.(event.delta)) : onEvent?.(event)),
        signal, maxOutputTokens, temperature, sensitiveValues, task: String(messages.at(-1)?.content || ''), callIdPrefix: 'channel',
        artifactOwner: owner, artifactSession: chatSessionId || 'channel',
        executeCall: async () => ({ content: '当前对话不提供该工具', summary: '工具不可用', isError: true }),
        toolsUnsupported: () => ({ note: '（当前模型不支持工具调用，不能加载技能或联网搜索；如用户需要，请说明需要管理员切换支持函数调用的模型，不要编造结果。）' })
    });
    if (bufferText) onDelta?.(result.text || '');
    return { text: result.text, usage: result.usage, toolLog: result.toolLog, ...(result.toolsUnsupported ? { toolsUnsupported: true } : {}) };
}

module.exports = { toolsets, forChat, runChannelTurn, confirmTitle };
