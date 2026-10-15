// 内置 Skill 是受版本控制的流程说明（backend/agent-skills/<id>/SKILL.md）；只按用户消息中的 @id
// 或会话内保持的 Skill 标识加载白名单文件，不扫描用户路径。
// 名称、简介、是否需要工作区写在 SKILL.md 开头的 front-matter 里，新增 Skill 只需添加一个目录。
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '../agent-skills');
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
            workspace: fields.workspace === 'true'
        },
        order: Number(fields.order) || 999,
        body: raw.slice(match[0].length).trim()
    };
}

// 启动时读取一次：内置 Skill 随版本发布，运行期间不变
const catalog = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && ID_RE.test(entry.name) && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
    .map(entry => parseSkillFile(entry.name, fs.readFileSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf8')))
    .sort((a, b) => a.order - b.order || a.meta.id.localeCompare(b.meta.id));
const byId = new Map(catalog.map(item => [item.meta.id, item]));

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
    return {
        selected,
        unknown,
        prompt: sections.length ? `\n用户为本条消息选择了以下内置 Skills。按任务需要使用其中流程；用户当前要求优先，Skill 不改变账号权限和审批模式，不要求额外审批。只使用实际可用的工具，不编造执行或验证结果。回复语言跟随用户。\n${sections.join('\n\n')}\n` : ''
    };
}

module.exports = { list, select, mentions, load };
