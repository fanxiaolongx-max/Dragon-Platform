// 平台策略只限制非超级管理员的智能体工具调用。缺省沿用各工具的角色和审批规则。
const { isSuperAdmin } = require('../middleware/auth');
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

async function deniedKeys() {
    return runWithTenant(DEFAULT_TENANT_ID, async () => {
        await readKV(CATEGORY, '', false);
        const rows = await require('./app-db').all('SELECT key FROM sys_kv_store WHERE category = ? AND value = ?', [CATEGORY, 'true']);
        return new Set(rows.map(row => row.key));
    });
}

async function forActor(user, owner) {
    if (isSuperAdmin(user) || (!user && !owner)) return allowAll;
    const denied = await deniedKeys();
    if (!denied.size) return allowAll;
    const actor = user ?? await require('./tool-distribution').actorForOwner(owner);
    return isSuperAdmin(actor) ? allowAll : name => !denied.has(`tool:${name}`) && !denied.has(`group:${groupFor(name)}`);
}

function setAccess(scope, id, enabled) {
    const key = `${scope}:${id}`;
    return runWithTenant(DEFAULT_TENANT_ID, () => enabled ? deleteKV(CATEGORY, key) : writeKV(CATEGORY, key, true));
}

module.exports = { groupFor, deniedKeys, forActor, setAccess };
