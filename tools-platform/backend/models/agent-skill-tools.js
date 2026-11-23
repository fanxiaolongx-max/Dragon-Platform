// Dragon Claw 技能自我进化：智能体能读取技能当前版本，并把完善后的版本提交保存。
// - save_skill 每次都弹审批卡（完全访问也一样，可选本对话不再询问），卡片上是新旧版本的差异；用户允许后保存，旧版本自动备份，可在技能管理里回退；
// - 技能里不能存放或读取账号密码、Token：命中就拒绝保存，让模型改掉再提交；
// - 无人值守的频道对话没人审批，不会保存。
const { unifiedDiff } = require('./agent-change-log');
const { containsSensitiveText, redactText } = require('./ai-sensitive-data');
const fs = require('fs');
const guard = require('./agent-path-guard');

const MAX_SKILL_FILE_BYTES = 512 * 1024;

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
                markdown: { type: 'string', description: '完整的 SKILL.md 文本（与 path 二选一）' },
                path: { type: 'string', description: '工作目录里已写好的 SKILL.md 草稿路径（相对工作目录）。技能较长（超过几千字）时先写进文件再用 path 提交，不要把全文塞进 markdown，否则可能超出单次输出上限被截断' },
                reason: { type: 'string', description: '一两句话：这次改了什么、为什么' }
            },
            required: ['reason']
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

// 技能正文：直接给的 markdown，或工作目录里的草稿文件（长技能一次输出放不下时用）
function skillText(args = {}, root = '') {
    if (typeof args.markdown === 'string' && args.markdown.trim()) return args.markdown;
    const file = String(args.path || '').trim();
    if (!file) throw Object.assign(new Error('缺少 markdown 或 path：直接给完整 SKILL.md 文本，或给工作目录里草稿文件的路径'), { code: 'AGENT_ARGS' });
    if (!root) throw Object.assign(new Error('当前对话没有工作目录，不能用 path 提交；请直接传入 markdown'), { code: 'AGENT_ARGS' });
    const abs = guard.resolveInsideRoot(root, file);
    guard.assertNotSecretFile(abs);
    let stat;
    try { stat = fs.statSync(abs); } catch (_error) { throw Object.assign(new Error(`找不到草稿文件 ${file}`), { code: 'AGENT_NOT_FOUND' }); }
    if (!stat.isFile()) throw Object.assign(new Error(`${file} 不是文件`), { code: 'AGENT_ARGS' });
    if (stat.size > MAX_SKILL_FILE_BYTES) throw Object.assign(new Error(`${file} 超过 ${MAX_SKILL_FILE_BYTES / 1024}KB，技能太长`), { code: 'AGENT_ARGS' });
    const text = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
    if (!text.trim()) throw Object.assign(new Error(`${file} 是空文件`), { code: 'AGENT_ARGS' });
    return text;
}

function parse(markdown) {
    const store = require('./agent-skills-store');
    return store.normalizeSkillMarkdown(String(markdown || ''));
}

async function preview(name, args = {}, { secrets = [], user, root = '' } = {}) {
    if (name !== 'save_skill') return {};
    const store = require('./agent-skills-store');
    const markdown = skillText(args, root);
    // 含账号密码的直接拒绝，不弹审批卡
    const problem = credentialProblem(markdown, secrets);
    if (problem) throw Object.assign(new Error(`没有提交：${problem}。请删掉相关内容后重新提交`), { code: 'SKILL_HAS_CREDENTIALS' });
    const skill = parse(markdown);
    const current = await store.withSkillForUser(skill.id, user, item => store.getSkill(item.id)).catch(() => null);
    const before = current?.markdown || '';
    const after = markdown;
    const diff = unifiedDiff(`@${skill.id}`, before, after);
    return {
        path: `@${skill.id}${current ? '' : '（新技能）'}${args.reason ? ` · ${String(args.reason).slice(0, 120)}` : ''}`,
        diff: redactText(diff.text || '', { secrets }),
        added: diff.added,
        removed: diff.removed,
        message: String(args.reason || '').slice(0, 300)
    };
}

async function execute(call, { username = '', secrets = [], user, root = '' } = {}) {
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    const store = require('./agent-skills-store');
    try {
        if (call.name === 'read_skill') {
            const skill = await store.withSkillForUser(String(args.id || '').replace(/^@/, ''), user, item => store.getSkill(item.id));
            if (!skill) return { content: `没有技能 @${args.id}；新建技能直接用 save_skill 提交。`, summary: '没有这个技能', isError: true };
            return { content: redactText(skill.markdown, { secrets }), summary: `读取 @${skill.id}` };
        }
        const markdown = skillText(args, root);
        const problem = credentialProblem(markdown, secrets);
        if (problem) return { content: `没有保存：${problem}。请删掉相关内容后重新提交。`, summary: '技能含账号密码，未保存', isError: true };
        const skill = parse(markdown);
        const existed = Boolean(await store.withSkillForUser(skill.id, user, item => store.getSkill(item.id)).catch(() => null));
        const saved = await store.createFromMarkdown(markdown, { source: 'agent', createdBy: username, overwrite: true, user });
        const verified = await store.getSkill(saved.id).catch(() => null);
        if (!verified || !String(verified.markdown || '').trim()) {
            return {
                content: `错误（VERIFY_FAILED）：技能保存后回读校验失败，未找到已保存的技能 @${saved.id}。`,
                summary: '保存回读验真失败',
                isError: true
            };
        }
        return {
            verified: true,
            content: `已${existed ? '更新' : '创建'}技能 @${verified.id}「${verified.name}」（已回读验真）${existed ? '，旧版本已自动备份，可在技能管理里回退' : ''}。下次对话即可使用。`,
            summary: `${existed ? '更新' : '创建'} @${verified.id} · 已回读`
        };
    } catch (error) {
        return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
    }
}

/** 附加工具组：read_skill 只读；save_skill 每次确认（kind 'confirm'） */
function toolset({ owner = '', user, secrets = [], root = '' } = {}) {
    const username = String(owner).split('::').pop();
    const actor = () => user ?? require('./tool-distribution').actorForOwner(owner);
    return {
        id: 'skill_evolution',
        label: '技能自我进化：读取技能当前版本、提交创建或完善后的技能（用户审批后保存，自动备份）',
        definitions: DEFINITIONS,
        kindOf: name => (name === 'save_skill' ? 'confirm' : 'read'),
        preview: async (name, args) => preview(name, args, { secrets, user: await actor(), root }),
        alwaysKey: name => name,
        execute: async call => execute(call, { username, secrets, user: await actor(), root })
    };
}

module.exports = { DEFINITIONS, toolset, credentialProblem, _internal: { preview, execute, skillText } };
