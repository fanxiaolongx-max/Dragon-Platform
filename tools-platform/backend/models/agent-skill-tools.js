// Dragon Claw 技能自我进化：智能体能读取技能当前版本，并把完善后的版本提交保存。
// - save_skill 每次都弹审批卡（完全访问也一样，可选本对话不再询问），卡片上是新旧版本的差异；用户允许后保存，旧版本自动备份，可在技能管理里回退；
// - 技能里不能存放或读取账号密码、Token：命中就拒绝保存，让模型改掉再提交；
// - 无人值守的频道对话没人审批，不会保存。
const { unifiedDiff } = require('./agent-change-log');
const { containsSensitiveText, redactText } = require('./ai-sensitive-data');

const DEFINITIONS = [
    {
        name: 'read_skill',
        description: '读取一个技能（@id）当前保存的完整 SKILL.md（含 front-matter），完善技能前先读它，在此基础上修改。',
        parameters: { type: 'object', properties: { id: { type: 'string', description: '技能 id，如 netcare-rectification-report' } }, required: ['id'] }
    },
    {
        name: 'save_skill',
        description: '创建或更新一个技能：提交完整的 SKILL.md（front-matter 含 id、name、name_en、description、description_en、workspace，后面是执行步骤）。会弹审批卡给用户看新旧差异，用户允许后才保存，旧版本自动备份。'
            + '用户要求创建 / 完善技能，或你用技能做任务时发现步骤有错、过时、被用户纠正，任务完成后都可以提交。技能里不得写入账号、密码、Token，也不得要求运行时去读取它们。',
        parameters: {
            type: 'object',
            properties: {
                markdown: { type: 'string', description: '完整的 SKILL.md 文本' },
                reason: { type: 'string', description: '一两句话：这次改了什么、为什么' }
            },
            required: ['markdown', 'reason']
        }
    }
];

// 技能里出现明文密码，或要求运行时去读取、填写密码 / Token
const CREDENTIAL_RE = [
    /(?:密码|口令|password|passwd|pwd|token|api[_ -]?key|secret)\s*[:：=]\s*[^\s，。,;；`'"]{4,}/i,
    /(?:读取|获取|查询|取出|拿到|fetch|read|load)[^\n]{0,40}(?:密码|口令|password|credential|token)/i,
    /(?:输入|填写|填入|自动登录|type|fill)[^\n]{0,30}(?:密码|口令|password)/i
];

function credentialProblem(markdown, secrets = []) {
    if (containsSensitiveText(markdown, { secrets })) return '技能文本里含有已配置的密钥或 Token';
    const hit = CREDENTIAL_RE.find(re => re.test(markdown));
    return hit ? `技能里不能存放或读取账号密码、Token（命中：「${redactText(String(markdown.match(hit)[0]).slice(0, 40), { secrets })}」）。遇到登录页时应停下来提示用户手动登录` : '';
}

function parse(markdown) {
    const store = require('./agent-skills-store');
    return store.normalizeSkillMarkdown(String(markdown || ''));
}

async function preview(name, args = {}, { secrets = [], user } = {}) {
    if (name !== 'save_skill') return {};
    const store = require('./agent-skills-store');
    // 含账号密码的直接拒绝，不弹审批卡
    const problem = credentialProblem(String(args.markdown || ''), secrets);
    if (problem) throw Object.assign(new Error(`没有提交：${problem}。请删掉相关内容后重新提交`), { code: 'SKILL_HAS_CREDENTIALS' });
    const skill = parse(args.markdown);
    const current = await store.withSkillForUser(skill.id, user, item => store.getSkill(item.id)).catch(() => null);
    const before = current?.markdown || '';
    const after = String(args.markdown || '');
    const diff = unifiedDiff(`@${skill.id}`, before, after);
    return {
        path: `@${skill.id}${current ? '' : '（新技能）'}${args.reason ? ` · ${String(args.reason).slice(0, 120)}` : ''}`,
        diff: redactText(diff.text || '', { secrets }),
        added: diff.added,
        removed: diff.removed,
        message: String(args.reason || '').slice(0, 300)
    };
}

async function execute(call, { username = '', secrets = [], user } = {}) {
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    const store = require('./agent-skills-store');
    try {
        if (call.name === 'read_skill') {
            const skill = await store.withSkillForUser(String(args.id || '').replace(/^@/, ''), user, item => store.getSkill(item.id));
            if (!skill) return { content: `没有技能 @${args.id}；新建技能直接用 save_skill 提交。`, summary: '没有这个技能', isError: true };
            return { content: redactText(skill.markdown, { secrets }), summary: `读取 @${skill.id}` };
        }
        const markdown = String(args.markdown || '');
        const problem = credentialProblem(markdown, secrets);
        if (problem) return { content: `没有保存：${problem}。请删掉相关内容后重新提交。`, summary: '技能含账号密码，未保存', isError: true };
        const skill = parse(markdown);
        const existed = Boolean(await store.withSkillForUser(skill.id, user, item => store.getSkill(item.id)).catch(() => null));
        const saved = await store.createFromMarkdown(markdown, { source: 'agent', createdBy: username, overwrite: true, user });
        return {
            content: `已${existed ? '更新' : '创建'}技能 @${saved.id}「${saved.name}」${existed ? '，旧版本已自动备份，可在技能管理里回退' : ''}。下次对话即可使用。`,
            summary: `${existed ? '更新' : '创建'} @${saved.id}`
        };
    } catch (error) {
        return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
    }
}

/** 附加工具组：read_skill 只读；save_skill 每次确认（kind 'confirm'） */
function toolset({ owner = '', user, secrets = [] } = {}) {
    const username = String(owner).split('::').pop();
    const actor = () => user ?? require('./tool-distribution').actorForOwner(owner);
    return {
        id: 'skill_evolution',
        label: '技能自我进化：读取技能当前版本、提交创建或完善后的技能（用户审批后保存，自动备份）',
        definitions: DEFINITIONS,
        kindOf: name => (name === 'save_skill' ? 'confirm' : 'read'),
        preview: async (name, args) => preview(name, args, { secrets, user: await actor() }),
        alwaysKey: name => name,
        execute: async call => execute(call, { username, secrets, user: await actor() })
    };
}

module.exports = { DEFINITIONS, toolset, credentialProblem, _internal: { preview, execute } };
