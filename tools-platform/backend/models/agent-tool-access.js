// 平台策略只限制非超级管理员的智能体工具调用。缺省沿用各工具的角色和审批规则。
const { isSuperAdmin, inSuperAdminSpace } = require('../middleware/auth');
const { DEFAULT_TENANT_ID, runWithTenant } = require('./tenant-context');
const { readKV, writeKV, deleteKV } = require('./kv-store');
const CATEGORY = 'agent_tool_access';
const allowAll = () => true;

function groupFor(name) {
    const { ALWAYS, GROUPS } = require('./agent-tool-registry');
    for (const [id, group] of Object.entries(GROUPS)) {
        if (group.names.includes(name)) return id;
    }
    if (ALWAYS.has(name)) return 'always';
    if (['find_platform_tools', 'read_tool_guide'].includes(name)) return 'platform_tools';
    if (['read_skill', 'save_skill'].includes(name)) return 'agent_skills';
    if (['calculate', 'update_plan', 'ask_user', 'view_image', 'task', 'tool_search', 'load_skill'].includes(name)) return 'builtin';
    const prefixes = { mcp__: 'mcp', browser_: 'browser', netcare_: 'netcare-data', ops_: 'ops-group', welink_: 'welink-office', followup_: 'followup' };
    return Object.entries(prefixes).find(([prefix]) => name.startsWith(prefix))?.[1] || 'other';
}

// 平台共享的 MCP 服务进程运行在团队命令沙箱之外（能读服务器文件、访问本机端口），
// WeLink 频道推送以平台公共机器人名义对外发消息：
// 团队账号默认不开放，超级管理员在「智能体工具」里明确开启后才可用。其余工具默认开放、可单独关闭。
// 浏览器不在此列：团队账号的浏览器进程在团队沙箱里、只能经出口代理上网（见 agent-browser.js 的 teamLaunch）。
// 超级管理员空间里的其他账号与频道对话不受这条默认规则影响（仍可被单独关闭）。
const DEFAULT_OFF_GROUPS = ['mcp', 'welink-channel'];

/** 对团队账号关闭的工具 / 分组；teamDefaults=false 时只返回超级管理员明确关闭的 */
async function deniedKeys({ teamDefaults = true } = {}) {
    return runWithTenant(DEFAULT_TENANT_ID, async () => {
        await readKV(CATEGORY, '', false);
        const rows = await require('./app-db').all('SELECT key, value FROM sys_kv_store WHERE category = ?', [CATEGORY]);
        const denied = new Set(rows.filter(row => row.value === 'true').map(row => row.key));
        if (teamDefaults) {
            const granted = new Set(rows.filter(row => row.value === 'false').map(row => row.key));
            for (const group of DEFAULT_OFF_GROUPS) if (!granted.has(`group:${group}`)) denied.add(`group:${group}`);
        }
        return denied;
    });
}

async function forActor(user, owner) {
    if (isSuperAdmin(user) || (!user && !owner)) return allowAll;
    const actor = user ?? await require('./tool-distribution').actorForOwner(owner);
    if (isSuperAdmin(actor)) return allowAll;
    const key = String(owner || '');
    const denied = await deniedKeys({ teamDefaults: !inSuperAdminSpace(actor, key.includes('::') ? key.slice(0, key.indexOf('::')) : undefined) });
    return denied.size ? name => !denied.has(`tool:${name}`) && !denied.has(`group:${groupFor(name)}`) : allowAll;
}

function setAccess(scope, id, enabled) {
    const key = `${scope}:${id}`;
    const defaultOff = scope === 'group' && DEFAULT_OFF_GROUPS.includes(id);
    return runWithTenant(DEFAULT_TENANT_ID, () => {
        if (defaultOff) return enabled ? writeKV(CATEGORY, key, false) : deleteKV(CATEGORY, key);
        return enabled ? deleteKV(CATEGORY, key) : writeKV(CATEGORY, key, true);
    });
}

module.exports = { DEFAULT_OFF_GROUPS, groupFor, deniedKeys, forActor, setAccess };
