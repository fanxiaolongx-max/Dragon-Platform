// 工具清单（全局设置 › 智能体工具）：按来源列出 Dragon Claw 首页对话能用的工具——
// 引擎自带、常驻、按需分组、技能专用、浏览器、MCP 服务；每个工具显示类别、说明占用的 token 与调用次数。
const toolsService = require('./agent-tools-service');
const registry = require('./agent-tool-registry');
const agentLoop = require('./agent-loop');
const contextStats = require('./agent-context-stats');
const usage = require('./agent-tool-usage');
const access = require('./agent-tool-access');
const { isSuperAdmin } = require('../middleware/auth');

const KIND_LABEL = { read: '只读', write: '写入', destructive: '删除', external: '外部 / 发送', command: '命令' };

function summaryOf(description) {
    const first = String(description || '').split(/(?<=[。；;])|\n/)[0].trim();
    return first.length > 90 ? `${first.slice(0, 90)}…` : first;
}

async function build({ user }) {
    const stats = await usage.stats().catch(() => new Map());
    const manage = isSuperAdmin(user);
    const denied = manage ? await access.deniedKeys() : new Set();
    const allowed = await access.forActor(user);
    const core = toolsService.definitions({ readOnly: Boolean(user && user.role !== 'admin') }).filter(def => allowed(def.name));
    const item = (def, kind) => {
        const used = stats.get(def.name);
        return { name: def.name, enabled: !denied.has(`tool:${def.name}`), summary: summaryOf(def.description), kind: kind || toolsService.kindOf(def.name) || 'read',
            kindLabel: KIND_LABEL[kind || toolsService.kindOf(def.name) || 'read'] || '', tokens: contextStats.estimateTokens(JSON.stringify(def)),
            calls: used?.calls || 0, failures: used?.failures || 0, lastUsedAt: used?.lastUsedAt || null };
    };
    const groups = [];
    const addGroup = (id, label, mode, defs, kindOf) => {
        const tools = defs.filter(def => allowed(def.name)).map(def => item(def, kindOf?.(def.name)));
        if (tools.length || manage) groups.push({ id, label, mode, tools });
    };
    addGroup('builtin', '引擎自带', 'always', [
        ...Object.values(agentLoop.BUILTIN_DEFINITIONS),
        require('./agent-subagent').DEFINITION,
        ...registry.META
    ], () => 'read');
    addGroup('always', '工作区文件与命令', 'always', core.filter(def => access.groupFor(def.name) === 'always'));
    for (const [id, group] of Object.entries(registry.GROUPS)) {
        addGroup(id, group.label, 'deferred', core.filter(def => access.groupFor(def.name) === id));
    }
    const skillSets = [
        ['netcare-data', 'NetCare 数据（@netcare-data）', () => require('./digital-human/netcare-agent').definitions(), name => (name === 'netcare_sql' ? 'write' : 'read')],
        ['ops-group', '自动化运营（@ops-group）', () => require('./channels/ops-agent').definitions(), name => require('./channels/ops-agent').kindOf(name)],
        ['welink-office', 'WeLink 办公（@welink-office）', () => require('./channels/welink-cli-agent').definitions({ write: true }), name => (name === 'welink_action' ? 'external' : 'read')]
    ];
    const skillStore = require('./agent-skills-store');
    const visibleSkills = manage || !user ? null : new Set((await skillStore.listForUser(user)).map(skill => skill.id));
    for (const [id, label, defs, kindOf] of skillSets) {
        if (visibleSkills && (user.role !== 'admin' || !visibleSkills.has(id) || await skillStore.unavailableReason(id))) continue;
        addGroup(id, label, 'skill', defs(), kindOf);
    }
    const extras = await require('./agent-extra-tools').toolsets({ owner: `${require('./tenant-context').getTenantId()}::${user?.username || ''}`, user, readOnly: Boolean(user && user.role !== 'admin') });
    const mcp = extras.filter(set => set.sharedMcp);
    addGroup('mcp', '平台共享 MCP', 'mcp', mcp.flatMap(set => set.definitions), name => mcp.find(set => set.definitions.some(def => def.name === name))?.kindOf(name));
    for (const set of extras.filter(set => !set.sharedMcp)) {
        addGroup(access.groupFor(set.definitions[0].name), set.label, 'deferred', set.definitions, name => set.kindOf(name));
    }
    return { groups: groups.map(group => ({ ...group, enabled: !denied.has(`group:${group.id}`) })), manage, mcp: true };
}

module.exports = { build };
