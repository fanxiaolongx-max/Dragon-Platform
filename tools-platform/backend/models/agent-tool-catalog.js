// 工具清单（全局设置 › 智能体工具）：按来源列出 Dragon Claw 首页对话能用的工具——
// 引擎自带、常驻、按需分组、技能专用、浏览器、MCP 服务；每个工具显示类别、说明占用的 token 与调用次数。
const toolsService = require('./agent-tools-service');
const registry = require('./agent-tool-registry');
const agentLoop = require('./agent-loop');
const contextStats = require('./agent-context-stats');
const usage = require('./agent-tool-usage');

const KIND_LABEL = { read: '只读', write: '写入', destructive: '删除', external: '外部 / 发送', command: '命令' };

function summaryOf(description) {
    const first = String(description || '').split(/(?<=[。；;])|\n/)[0].trim();
    return first.length > 90 ? `${first.slice(0, 90)}…` : first;
}

async function build({ user }) {
    const stats = await usage.stats().catch(() => new Map());
    const coreByName = new Map(toolsService.definitions().map(def => [def.name, def]));
    const item = (def, kind) => {
        const used = stats.get(def.name);
        return { name: def.name, summary: summaryOf(def.description), kind: kind || toolsService.kindOf(def.name) || 'read',
            kindLabel: KIND_LABEL[kind || toolsService.kindOf(def.name) || 'read'] || '', tokens: contextStats.estimateTokens(JSON.stringify(def)),
            calls: used?.calls || 0, failures: used?.failures || 0, lastUsedAt: used?.lastUsedAt || null };
    };
    const groups = [];
    groups.push({ id: 'builtin', label: '引擎自带', mode: 'always', note: '所有对话都带：任务清单、向用户提问、精确计算',
        tools: Object.values(agentLoop.BUILTIN_DEFINITIONS).map(def => item(def, 'read')) });
    groups.push({ id: 'always', label: '工作区常驻', mode: 'always', note: '选了工作目录时每步都带的文件、命令与只读数据库工具',
        tools: [...registry.ALWAYS].map(name => coreByName.get(name)).filter(Boolean).map(def => item(def)) });
    for (const [id, group] of Object.entries(registry.GROUPS)) {
        groups.push({ id, label: group.label, mode: 'deferred', note: '按需加载：系统提示只列名称，模型用 tool_search 加载',
            tools: group.names.map(name => coreByName.get(name)).filter(Boolean).filter(def => !registry.ALWAYS.has(def.name)).map(def => item(def)) });
    }
    const skillSets = [
        ['netcare-data', 'NetCare 数据（@netcare-data）', () => require('./digital-human/netcare-agent').definitions(), () => 'read'],
        ['ops-group', '自动化运营（@ops-group）', () => require('./channels/ops-agent').definitions(), name => require('./channels/ops-agent').kindOf(name)],
        ['welink-office', 'WeLink 办公（@welink-office）', () => require('./channels/welink-cli-agent').definitions({ write: true }), name => (name === 'welink_action' ? 'external' : 'read')]
    ];
    for (const [id, label, defs, kindOf] of skillSets) {
        try { groups.push({ id, label, mode: 'skill', note: '选择该技能或模型用 load_skill 加载后提供', tools: defs().map(def => item(def, kindOf(def.name))) }); } catch (_error) { /* 未配置时跳过 */ }
    }
    const extras = await require('./agent-extra-tools').toolsets({ owner: `${require('./tenant-context').getTenantId()}::${user?.username || ''}`, readOnly: user?.role !== 'admin' });
    const browserAvailable = require('./agent-browser').available();
    if (!extras.some(set => set.id === 'browser')) {
        groups.push({ id: 'browser', label: '浏览器', mode: 'browser', available: false,
            note: browserAvailable ? '只给管理员' : '本机没有找到 Chrome / Edge（可用环境变量 TOOLS_AGENT_BROWSER_PATH 指定）；桌面端使用 Dragon 浏览器', tools: [] });
    }
    for (const set of extras) {
        groups.push({ id: set.id, label: set.label, mode: set.id === 'browser' ? 'browser' : 'mcp', available: true, note: '按需加载；只读工具直接执行，其余按审批',
            tools: set.definitions.map(def => item(def, set.kindOf(def.name))) });
    }
    return { groups, mcp: require('./agent-mcp').tenantAllowed() };
}

module.exports = { build };
