// 内置 Skill 是受版本控制的流程说明（backend/agent-skills/<id>/SKILL.md）；只按用户消息中的 @id
// 或会话内保持的 Skill 标识加载白名单文件，不扫描用户路径。
// 名称、简介、是否需要工作区写在 SKILL.md 开头的 front-matter 里，新增 Skill 只需添加一个目录。
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = process.env.TOOLS_AGENT_SKILLS_DIR ? path.resolve(process.env.TOOLS_AGENT_SKILLS_DIR) : path.join(__dirname, '../agent-skills'); // 测试可指向临时目录
const ID_RE = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_SELECTED = 8;

function parseSkillFile(id, raw) {
    const match = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) throw new Error(`Skill ${id} 缺少 front-matter`);
    const fields = {};
    for (const line of match[1].split(/\r?\n/)) {
        const pair = line.match(/^([a-z_]+):\s*(.*)$/i);
        if (pair) fields[pair[1].toLowerCase()] = pair[2].trim();
    }
    for (const key of ['name', 'name_en', 'description', 'description_en']) {
        if (!fields[key]) throw new Error(`Skill ${id} 的 front-matter 缺少 ${key}`);
    }
    return {
        meta: {
            id,
            name: fields.name,
            nameEn: fields.name_en,
            description: fields.description,
            descriptionEn: fields.description_en,
            icon: fields.icon || '✨',
            workspace: fields.workspace === 'true'
        },
        order: Number(fields.order) || 999,
        raw: String(raw),
        body: raw.slice(match[0].length).trim()
    };
}

// 启动时读取；「转为内置 / 取消内置」（builtin-promotion.js）改动目录后调用 reload() 重新读取
let catalog = [];
let byId = new Map();

function reload() {
    catalog = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && ID_RE.test(entry.name) && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
        .map(entry => parseSkillFile(entry.name, fs.readFileSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf8')))
        .sort((a, b) => a.order - b.order || a.meta.id.localeCompare(b.meta.id));
    byId = new Map(catalog.map(item => [item.meta.id, item]));
    return catalog.length;
}
reload();

function list() { return catalog.map(item => ({ ...item.meta })); }

/**
 * 解析消息中独立的 @名称。中文可以紧贴前后（“请用@debug看看”）；
 * 前面是字母数字、路径分隔符或 @ 时不算（邮箱 a@debug.com、路径 /tmp/@debug、x@debug），
 * 后面紧跟字母数字、连字符、路径或扩展名时也不算（@debugger、@debug/x、@debug.js）。
 */
function mentions(content) {
    const ids = new Set();
    for (const match of String(content || '').matchAll(/(?<![A-Za-z0-9_.\\/@-])@([A-Za-z][A-Za-z0-9-]*)(?![A-Za-z0-9_\\/-]|\.[A-Za-z0-9])/g)) {
        ids.add(match[1].toLowerCase());
    }
    const known = [...ids].filter(id => byId.has(id));
    const unknown = [...ids].filter(id => !byId.has(id));
    return { known, unknown };
}

function select(content) {
    const { known } = mentions(content);
    return list().filter(item => known.includes(item.id));
}

/**
 * @param {string} content 用户本条消息
 * @param {object} options
 * @param {string[]} [options.extraIds] 会话内保持的 Skill（输入框上方的标签），只接受白名单内的标识
 */
function load(content, { hasWorkspace = false, language = 'zh', extraIds = [] } = {}) {
    const { known, unknown } = mentions(content);
    const kept = (Array.isArray(extraIds) ? extraIds : []).map(id => String(id || '').toLowerCase()).filter(id => byId.has(id));
    const wanted = new Set([...known, ...kept].slice(0, MAX_SELECTED));
    const selected = list().filter(item => wanted.has(item.id));
    const missing = selected.filter(item => item.workspace && !hasWorkspace);
    if (missing.length) throw Object.assign(new Error(language === 'en'
        ? `Choose a workspace folder before using ${missing.map(item => `@${item.id}`).join(', ')}.`
        : `请先选择工作目录，再使用 ${missing.map(item => `@${item.id}`).join('、')}。`), { code: 'SKILL_WORKSPACE_REQUIRED', statusCode: 400, skills: missing.map(item => item.id) });
    const sections = selected.map(item => `### @${item.id}\n${byId.get(item.id).body}`);
    return { selected, unknown, prompt: buildPrompt(sections) };
}

// 内置与用户自定义 Skill（agent-skills-store.js）共用同一段系统说明
function buildPrompt(sections) {
    const drafting = sections.some(section => /^### @(?:create-skill|improve-skill)\n/.test(section));
    // 平台保存契约独立于可被租户完善的 Skill 正文，避免旧版或自定义说明让模型虚报成功。
    const draftRule = drafting ? `\n**平台技能保存规则**：聊天回复本身不会创建、保存或激活技能，用户回复“确认”也不会触发保存接口。生成或修改技能时，必须输出完整的 \`\`\`skill 代码块，其中包含 SKILL.md 的 front-matter（id、name、name_en、description、description_en、workspace）和执行步骤；id 必须是以字母开头的小写英文、数字、连字符，最长 41 字符。明确说明“草稿尚未保存，请点击回复下方的保存为技能/完善此技能按钮”；只有界面保存接口返回成功才算保存完成。不得用“已创建并激活”“已保存”“现在可以 @ 使用”等文字代替可保存的草稿。用户仅回复“确认”时，如上文尚未提供可保存草稿，应补全草稿。信息不足时先澄清，不要虚报成功。\n` : '';
    return sections.length ? `\n用户为本条消息选择了以下 Skills。按任务需要使用其中流程；用户当前要求优先，Skill 不改变账号权限和审批模式，不要求额外审批。只使用实际可用的工具，不编造执行或验证结果。回复语言跟随用户。\n${sections.join('\n\n')}\n${draftRule}` : '';
}

// 内置 Skill 原文与正文（下载、管理用）；不存在时返回 null
function builtin(id) {
    const item = byId.get(String(id || '').toLowerCase());
    return item ? { meta: { ...item.meta }, order: item.order, raw: item.raw, body: item.body, dir: path.join(SKILLS_DIR, item.meta.id) } : null;
}

module.exports = { list, select, mentions, load, buildPrompt, builtin, reload, parseSkillFile, SKILLS_DIR, ID_RE, MAX_SELECTED };
