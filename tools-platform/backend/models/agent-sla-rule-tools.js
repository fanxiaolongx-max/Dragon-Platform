// Dragon 对话的「数据导入指标规则」工具组：查找条件值、批量修改/加别名（每次审批，审批卡显示
// 每处改动和对照最近一次导入的命中行数）、查看改动记录、按记录回退。只给管理员。
const editor = require('./sla-metric-rule-editor');
const { runWithTenant } = require('./tenant-context');

const REPLACEMENTS_SCHEMA = {
    type: 'array',
    description: '替换清单。每项二选一：{ from, to } 把条件值 from 整串替换成 to；{ from, addAliases: ["新名"] } 给条件值 from 追加别名，结果写成 [旧名]|[新名]，任一命中即可（推荐，新旧数据都能匹配）。match 默认 exact（整串相等，已是别名列表时其中一个别名相等也算）；contains 表示只替换值里出现的这段文字。',
    items: {
        type: 'object',
        properties: {
            from: { type: 'string', description: '现在的条件值，如 e&系统部' },
            to: { type: 'string', description: '替换成的条件值' },
            addAliases: { type: 'array', items: { type: 'string' }, description: '要追加的别名，如 ["etisalat系统部"]' },
            match: { type: 'string', enum: ['exact', 'contains'] }
        },
        required: ['from']
    }
};
const SCOPE_PROPERTIES = {
    prefKeys: { type: 'array', items: { type: 'string' }, description: '只改这些表（sla_find_metric_rules 返回的 prefKey）；不填为全部表' },
    metricLabels: { type: 'array', items: { type: 'string' }, description: '只改指标名包含这些文字的规则' },
    fields: { type: 'array', items: { type: 'string', enum: ['valY', 'conditions', 'valK'] }, description: '改哪些字段：valY 条件值、conditions 附加过滤条件、valK 计数/占比关键字；默认全部' }
};

const DEFINITIONS = [
    {
        name: 'sla_find_metric_rules',
        description: '查找数据导入页（SLA）指标规则里的条件值：主指标和子指标的条件值 Y、附加过滤条件、计数关键字 K，并对照最近一次导入的数据给出每条命中几行。unmatched=true 只列一行都没命中的条件（页面不高亮、取不到数的那些），并给出数据里没被任何规则匹配的候选取值（通常就是改了名的新值）。修改前先用它确认范围。',
        parameters: { type: 'object', properties: {
            query: { type: 'string', description: '按表名、指标名、子指标分类、列名或条件值过滤，如 e&系统部 或 全量EOS' },
            unmatched: { type: 'boolean', description: '只看最近一次导入中零命中的条件' },
            limit: { type: 'integer', description: '最多返回几条，默认 60' }
        } }
    },
    {
        name: 'sla_update_metric_conditions',
        description: '批量修改数据导入页指标规则的条件值（含子指标），或给条件值加别名 [旧名]|[新名]。用户会在审批卡里看到每处改动及最近一次导入里改前/改后的命中行数后再确认；写入后返回改动记录 ID，可用 sla_revert_metric_rule_change 回退。只改条件值，不改指标 ID、列和目标。',
        parameters: { type: 'object', properties: { replacements: REPLACEMENTS_SCHEMA, ...SCOPE_PROPERTIES, summary: { type: 'string', description: '一句话说明这次改动的原因' } }, required: ['replacements'] }
    },
    {
        name: 'sla_list_metric_rule_changes',
        description: '列出最近的指标条件值改动记录（ID、时间、谁改的、改了哪些、是否已回退）。',
        parameters: { type: 'object', properties: { limit: { type: 'integer', description: '默认 20' } } }
    },
    {
        name: 'sla_revert_metric_rule_change',
        description: '回退一次指标条件值改动。只把当前值仍等于那次改后值的地方改回去；之后又被人改过的地方不覆盖，列为冲突。回退本身也会生成一条改动记录，可再回退。',
        parameters: { type: 'object', properties: { changeId: { type: 'string', description: 'sla_update_metric_conditions 或 sla_list_metric_rule_changes 返回的 ID' } }, required: ['changeId'] }
    }
];

const isAdmin = user => Boolean(user && user.role === 'admin');
const RELOAD_NOTE = '已打开的数据导入页面要刷新后才会用新规则（不刷新就保存规则会把这次修改覆盖掉）。';

function changeLines(changes) {
    return changes.map(change => {
        const rows = change.matchedRowsBefore === null ? '（最近一次导入里没有这张表的数据）' : `命中 ${change.matchedRowsBefore} → ${change.matchedRowsAfter} 行`;
        return `${change.where}\n- ${change.from}\n+ ${change.to}\n  ${rows}`;
    }).join('\n');
}

function toolset({ owner = '', user } = {}) {
    const tenantId = String(owner).includes('::') ? String(owner).split('::')[0] : undefined;
    const actor = String(owner).split('::').pop() || user?.username || '';
    const inTenant = fn => (tenantId ? runWithTenant(tenantId, fn) : fn());
    return {
        id: 'sla_rules',
        label: '数据导入指标规则：查找条件值、批量修改或加别名（[旧名]|[新名]）、查看改动记录与回退',
        definitions: DEFINITIONS,
        kindOf: name => (name === 'sla_update_metric_conditions' || name === 'sla_revert_metric_rule_change' ? 'confirm' : 'read'),
        alwaysKey: name => name,
        preview: (name, args = {}) => inTenant(async () => {
            if (name === 'sla_update_metric_conditions') {
                const planned = await editor.plan(args);
                if (!planned.changes.length) throw Object.assign(new Error(`没有找到要改的条件值。${planned.warnings.join('；')}`), { code: 'NOTHING_TO_CHANGE' });
                return {
                    path: `修改 ${planned.changes.length} 处指标条件值${args.summary ? ` · ${String(args.summary).slice(0, 120)}` : ''}`,
                    diff: changeLines(planned.changes),
                    message: [planned.latestImportAt ? `命中行数按最近一次导入（${planned.latestImportAt}）计算。` : '还没有导入过数据，无法预估命中行数。', ...planned.warnings].join('\n')
                };
            }
            if (name === 'sla_revert_metric_rule_change') {
                const record = (await editor.listChanges({ limit: 100 })).find(item => item.id === args.changeId);
                if (!record) throw Object.assign(new Error('没有这条改动记录'), { code: 'NOT_FOUND' });
                return { path: `回退改动 ${record.id}：${record.summary}`, diff: record.changes.map(change => `${change.where}\n- ${change.to}\n+ ${change.from}`).join('\n'), message: `${record.createdAt} · ${record.actor} · 共 ${record.count} 处` };
            }
            return {};
        }),
        execute: call => inTenant(async () => {
            const args = call.args && typeof call.args === 'object' ? call.args : {};
            try {
                if (!isAdmin(user)) throw Object.assign(new Error('修改指标规则需要管理员权限'), { code: 'FORBIDDEN' });
                if (call.name === 'sla_find_metric_rules') {
                    const result = await editor.find(args);
                    return { content: JSON.stringify(result), summary: `找到 ${result.total} 处条件值${args.unmatched ? '（零命中）' : ''}` };
                }
                if (call.name === 'sla_update_metric_conditions') {
                    const result = await editor.apply(args, { actor });
                    if (!result.id) return { content: `没有修改任何条件值。${[...result.warnings, ...result.conflicts.map(item => `${item.where}：${item.reason}`)].join('；')}`, summary: '没有修改', isError: true };
                    return {
                        content: `已修改 ${result.applied.length} 处，改动记录 ID：${result.id}（不对时可用 sla_revert_metric_rule_change 回退）。${result.conflicts.length ? `\n未修改（${result.conflicts.length} 处）：${result.conflicts.map(item => `${item.where}：${item.reason}`).join('；')}` : ''}\n${changeLines(result.applied)}\n${result.warnings.length ? `注意：${result.warnings.join('；')}\n` : ''}${RELOAD_NOTE}`,
                        summary: `已修改 ${result.applied.length} 处 · ${result.id}`
                    };
                }
                if (call.name === 'sla_list_metric_rule_changes') {
                    const items = await editor.listChanges(args);
                    return { content: JSON.stringify(items), summary: `${items.length} 条改动记录` };
                }
                if (call.name === 'sla_revert_metric_rule_change') {
                    const result = await editor.revert(args.changeId, { actor });
                    if (!result.id) return { content: `没有回退任何地方：${result.conflicts.map(item => `${item.where}：${item.reason}${item.current !== undefined ? `（现在是「${item.current}」）` : ''}`).join('；')}`, summary: '没有回退', isError: true };
                    return {
                        content: `已回退 ${result.applied.length} 处，回退记录 ID：${result.id}。${result.conflicts.length ? `\n以下地方之后又被改过，没有覆盖：${result.conflicts.map(item => `${item.where}（现在是「${item.current ?? '已不存在'}」）`).join('；')}` : ''}\n${RELOAD_NOTE}`,
                        summary: `已回退 ${result.applied.length} 处`
                    };
                }
                return { content: `未知工具：${call.name}`, summary: '未知工具', isError: true };
            } catch (error) {
                return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
            }
        })
    };
}

module.exports = { DEFINITIONS, toolset, isAdmin };
