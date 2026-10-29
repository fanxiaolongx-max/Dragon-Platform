// 工作区 Agent 的工具登记表：常驻工具每步都发给模型，其余工具只在提示里列名称和一句话简介，
// 由模型调用 tool_search 加载完整说明；Skill 目录里的技能由 load_skill 按需加载正文和专用工具。
// 已加载的工具在会话内保持，并且只往列表末尾追加，前面的部分不变，供应商的提示缓存才能继续命中。
// 权限不因按需加载改变：只读账号只能搜到只读工具，执行时仍走 agent-run-manager 的审批。
const toolsService = require('./agent-tools-service');
const builtinSkills = require('./agent-skills');
const { redactText } = require('./ai-sensitive-data');

// 每步都带上的核心工具：文件与命令，加上只读数据库工具（工作区提示要求涉及平台数据时先 list_databases）；其余核心工具按分组延后加载
const ALWAYS = new Set(['list_directory', 'read_file', 'search', 'write_file', 'edit_file', 'delete_path', 'rename_path', 'run_command',
    'list_databases', 'database_schema', 'read_database_table']);
const GROUPS = {
    database: { label: '平台数据库', names: ['list_databases', 'database_schema', 'read_database_table', 'insert_database_row', 'update_database_rows', 'delete_database_rows'] },
    uiv: { label: 'UIVF12 抓取脚本仓库', names: ['list_uiv_scripts', 'list_uiv_categories', 'read_uiv_script', 'save_uiv_script', 'move_uiv_script', 'manage_uiv_category', 'delete_uiv_script'] },
    'welink-channel': { label: 'WeLink 频道消息', names: ['welink_list_targets', 'welink_send_message'] },
    toolkit: { label: '常用文件工具（Office 文档、表格 SQL 查询、比较差异、批量修改、压缩解压、长期记忆）', names: ['read_document', 'query_data', 'diff_files', 'multi_edit', 'zip_files', 'unzip_file', 'memory'] }
};
const GROUP_OF = new Map(Object.entries(GROUPS).flatMap(([group, item]) => item.names.map(name => [name, group])));

// Skill 专用工具集。带 kindOf 的工具集按类别走工作区审批（运营：改配置、删除、推送都要确认），
// 不带的按各自规则执行（NetCare 只读、WeLink 办公写命令自带审批卡）。selfLoad=false 的只在用户选择该 Skill 时提供。
const TOOLSETS = {
    netcare: {
        skillId: 'netcare-data', selfLoad: true,
        build: async () => {
            const netcare = require('./digital-human/netcare-agent');
            return { definitions: netcare.definitions(), prompt: await netcare.buildPrompt().catch(() => ''), execute: call => netcare.execute(call.name, call.args) };
        }
    },
    ops: {
        skillId: 'ops-group', selfLoad: true,
        build: async () => {
            const ops = require('./channels/ops-agent');
            return { definitions: ops.definitions(), prompt: await ops.buildPrompt().catch(() => ''), kindOf: ops.kindOf, preview: (name, args) => ops.preview(name, args),
                execute: (call, { opsCtx }) => ops.execute(opsCtx, call.name, call.args) };
        }
    },
    // WeLink 办公的写命令自带审批卡
    'welink-office': {
        skillId: 'welink-office', selfLoad: true,
        build: async session => {
            const welink = require('./channels/welink-cli-agent');
            let allowWrite = false;
            try { allowWrite = Boolean(require('./channels/welink-cli-runner').readConfig().allowWrite); } catch (_error) { /* 未配置 welink-cli 时只读 */ }
            return { definitions: welink.definitions({ write: allowWrite }), prompt: await welink.buildPrompt().catch(() => ''),
                execute: (call, { signal, write }) => welink.execute({ actor: session.username, signal, callId: call.id, canApprove: true, onEvent: event => write(event) }, call.name, call.args) };
        }
    }
};
const TOOLSET_OF_SKILL = new Map(Object.entries(TOOLSETS).map(([group, item]) => [item.skillId, group]));

const SEARCH_LIMIT = 6;
const META = [
    {
        name: 'tool_search',
        description: '加载按需工具的完整说明和参数。select 填工具名或分组名（见系统提示中的按需工具列表）；不确定用哪个时用 query 按关键词搜索。加载后的工具在本会话内一直可用，下一步即可调用。',
        parameters: {
            type: 'object',
            properties: {
                select: { type: 'array', items: { type: 'string' }, description: '要加载的工具名或分组名，如 ["list_databases"] 或 ["database"]' },
                query: { type: 'string', description: '关键词，如“数据库”“脚本”' }
            }
        }
    },
    {
        name: 'load_skill',
        description: '加载技能目录中某个技能的完整流程说明；带专用工具的技能会一并加载工具。用户已选择（系统提示里已有 ### @id 段落）的技能不必再加载。',
        parameters: { type: 'object', properties: { id: { type: 'string', description: '技能目录中的 ID' } }, required: ['id'] }
    }
];
const META_NAMES = new Set(META.map(item => item.name));

// 技能 front-matter 的 tools 字段：分组名或 Skill 工具集名
function skillTools(id) {
    const tools = builtinSkills.builtin(id)?.meta.tools;
    return Array.isArray(tools) ? tools : [];
}

function summaryOf(description) {
    const first = String(description || '').split(/(?<=[。；;])|\n/)[0].trim();
    return first.length > 70 ? `${first.slice(0, 70)}…` : first;
}

/**
 * @param {object} input
 * @param {object} input.session     工作区会话；loadedTools / loadedSkills 记在会话上，跨轮保持
 * @param {string[]} input.skillIds  用户本轮选择的技能
 * @param {Array} [input.messages]   送给模型的历史；其中调用过的工具视为已加载，保证历史与工具列表一致
 * @param {boolean} [input.skillCatalog] 系统提示里有技能目录时才提供 load_skill
 */
async function create({ session, skillIds = [], messages = [], skillCatalog = false, sensitiveValues = [] }) {
    const readOnly = Boolean(session.readOnly);
    if (!(session.loadedTools instanceof Set)) session.loadedTools = new Set();
    if (!(session.loadedSkills instanceof Set)) session.loadedSkills = new Set();
    const core = toolsService.definitions({ readOnly });
    const coreByName = new Map(core.map(item => [item.name, item]));
    const toolsets = new Map(); // group → { definitions, names, prompt, execute }
    const userSkills = new Set(skillIds);

    const attachToolset = async group => {
        if (readOnly || toolsets.has(group) || !TOOLSETS[group]) return toolsets.get(group) || null;
        const built = await TOOLSETS[group].build(session);
        const set = { ...built, names: new Set(built.definitions.map(item => item.name)) };
        toolsets.set(group, set);
        return set;
    };
    const loadNames = names => {
        const added = [];
        for (const name of names) {
            if (!coreByName.has(name) || ALWAYS.has(name) || session.loadedTools.has(name)) continue;
            session.loadedTools.add(name);
            added.push(name);
        }
        return added;
    };
    const applySkillTools = async id => {
        const notes = [];
        for (const group of skillTools(id)) {
            if (GROUPS[group]) loadNames(GROUPS[group].names);
            else if (TOOLSETS[group]) {
                if (readOnly) continue;
                if (!userSkills.has(id) && !TOOLSETS[group].selfLoad) { notes.push(`@${id} 的专用工具需要用户在输入框选择该技能后才提供。`); continue; }
                await attachToolset(group);
            }
        }
        return notes;
    };

    // 本轮起始：用户选择的技能和本会话已自行加载过的技能，带上各自的工具
    for (const id of [...userSkills, ...session.loadedSkills]) {
        const group = TOOLSET_OF_SKILL.get(id);
        if (group && !readOnly && (userSkills.has(id) || TOOLSETS[group].selfLoad)) await attachToolset(group);
        await applySkillTools(id);
    }
    for (const message of messages) for (const call of message?.toolCalls || []) loadNames([call.name]);
    const startToolsets = [...toolsets.keys()];

    const definitions = () => {
        const seen = new Set();
        const list = [];
        const push = item => { if (item && !seen.has(item.name)) { seen.add(item.name); list.push(item); } };
        core.filter(item => ALWAYS.has(item.name)).forEach(push);
        META.filter(item => item.name !== 'load_skill' || skillCatalog).forEach(push);
        startToolsets.forEach(group => toolsets.get(group).definitions.forEach(push));
        session.loadedTools.forEach(name => push(coreByName.get(name)));
        toolsets.forEach(set => set.definitions.forEach(push));
        return list;
    };
    const deferred = () => core.filter(item => !ALWAYS.has(item.name) && !session.loadedTools.has(item.name));

    const catalogPrompt = () => {
        const rest = deferred();
        if (!rest.length) return '';
        const byGroup = new Map();
        for (const item of rest) {
            const group = GROUP_OF.get(item.name) || 'other';
            if (!byGroup.has(group)) byGroup.set(group, []);
            byGroup.get(group).push(`  - ${item.name}：${summaryOf(item.description)}`);
        }
        const lines = [...byGroup].map(([group, items]) => `- ${GROUPS[group]?.label || '其他'}（分组 ${group}）\n${items.join('\n')}`);
        return `\n**按需工具**：下列是工具名（不是 Shell 命令，不要用 run_command 执行），当前没有附带参数说明。需要时先调用 tool_search（select 填工具名或分组名）加载，加载后在本会话内一直可用；也可以直接按名称调用，同组工具会一并加载。${skillCatalog ? '技能目录中的技能可用 load_skill 自行加载完整流程。' : ''}\n${lines.join('\n')}\n`;
    };

    const search = ({ select, query } = {}) => {
        const wanted = [];
        for (const raw of Array.isArray(select) ? select : (select ? [select] : [])) {
            const key = String(raw || '').trim();
            if (GROUPS[key]) wanted.push(...GROUPS[key].names);
            else wanted.push(key);
        }
        const terms = String(query || '').toLowerCase().split(/[\s,，、]+/).filter(Boolean);
        if (terms.length) {
            const scored = core.filter(item => !ALWAYS.has(item.name)).map(item => {
                const text = `${item.name} ${GROUP_OF.get(item.name) || ''} ${GROUPS[GROUP_OF.get(item.name)]?.label || ''} ${item.description}`.toLowerCase();
                return { name: item.name, score: terms.filter(term => text.includes(term)).length };
            }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
            wanted.push(...scored.slice(0, SEARCH_LIMIT).map(item => item.name));
        }
        const found = [...new Set(wanted)].filter(name => coreByName.has(name));
        const unknown = [...new Set(wanted)].filter(name => !coreByName.has(name));
        const added = loadNames(found);
        const tools = found.map(name => coreByName.get(name));
        const lines = tools.map(item => `### ${item.name}\n${item.description}\n参数：${JSON.stringify(item.parameters)}`);
        if (unknown.length) lines.push(readOnly ? `未找到或当前账号无权使用：${unknown.join('、')}` : `未找到：${unknown.join('、')}`);
        if (!tools.length && !unknown.length) lines.push('没有匹配的工具。请换个关键词，或参考系统提示里的按需工具列表。');
        const summary = tools.length ? `已加载 ${tools.length} 个工具` : '没有加载新工具';
        return { content: lines.join('\n\n'), summary, isError: !tools.length, added };
    };

    const loadSkill = async ({ id } = {}) => {
        const cleanId = String(id || '').replace(/^@/, '').trim().toLowerCase();
        if (!builtinSkills.ID_RE.test(cleanId)) return { content: '技能 ID 无效。', summary: '技能 ID 无效', isError: true };
        if (userSkills.has(cleanId)) return { content: `@${cleanId} 已在系统提示中加载，直接按其中的流程执行。`, summary: `@${cleanId} 已加载` };
        const loaded = await require('./agent-skills-store').loadSection(cleanId);
        if (!loaded) return { content: `技能目录中没有 @${cleanId}。只能加载目录中列出的技能。`, summary: `没有 @${cleanId}`, isError: true };
        const alreadyLoaded = session.loadedSkills.has(cleanId);
        session.loadedSkills.add(cleanId);
        const before = new Set(toolsets.keys());
        const notes = await applySkillTools(cleanId);
        const newSets = [...toolsets.keys()].filter(group => !before.has(group)).map(group => toolsets.get(group));
        const toolNames = [...newSets.flatMap(set => [...set.names]), ...skillTools(cleanId).flatMap(group => GROUPS[group]?.names || []).filter(name => coreByName.has(name))];
        const parts = [
            alreadyLoaded ? `（@${cleanId} 本会话已加载过，以下为完整内容。）` : '',
            loaded.section,
            ...newSets.map(set => set.prompt).filter(Boolean),
            toolNames.length ? `已加载工具：${toolNames.join('、')}` : '',
            ...notes
        ].filter(Boolean);
        return { content: redactText(parts.join('\n\n'), { secrets: sensitiveValues }), summary: `已加载 @${cleanId}` };
    };

    return {
        definitions,
        deferred,
        catalogPrompt,
        // 本轮开始时挂上的 Skill 工具集说明，放进系统提示；轮中加载的说明随 load_skill 结果返回
        startPrompt: () => startToolsets.map(group => toolsets.get(group).prompt).filter(Boolean).join('\n'),
        isMeta: name => META_NAMES.has(name),
        async runMeta(call) {
            if (call.name === 'tool_search') return search(call.args || {});
            if (call.name === 'load_skill' && skillCatalog) return loadSkill(call.args || {});
            return { content: `工具 ${call.name} 不可用。`, summary: '工具不可用', isError: true };
        },
        toolset: name => [...toolsets.values()].find(set => set.names.has(name)) || null,
        // 模型直接调用了延后的核心工具：照常走审批执行，之后的步骤带上它所在整组的说明（同组工具往往接着要用）
        noteCall: name => loadNames(GROUPS[GROUP_OF.get(name)]?.names || [name]),
        // run_command 的命令只是一个工具名（模型把工具当成 Shell 命令）：返回该工具名并加载它，调用方直接提示，不走审批
        commandNamingTool(command) {
            const name = String(command || '').trim().split(/[\s(]/)[0];
            if (!name || name === 'run_command' || !/^[a-z][a-z0-9_]+$/.test(name)) return null;
            const known = coreByName.has(name) || [...toolsets.values()].some(set => set.names.has(name)) || META_NAMES.has(name);
            if (!known) return null;
            loadNames(GROUPS[GROUP_OF.get(name)]?.names || [name]);
            return name;
        }
    };
}

module.exports = { create, ALWAYS, GROUPS, TOOLSETS, META_NAMES };
