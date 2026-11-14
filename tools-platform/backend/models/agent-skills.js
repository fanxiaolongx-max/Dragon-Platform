// 内置 Skill 是受版本控制的流程说明（backend/agent-skills/<id>/SKILL.md）；只按用户消息中的 @id
// 或任务自动匹配、会话内保持的 Skill 标识加载白名单文件，不扫描用户路径。
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
            workspace: fields.workspace === 'true',
            // 加载该技能时一并加载的工具分组（agent-tool-registry.js 的 GROUPS / TOOLSETS）
            tools: String(fields.tools || '').split(/[,\s]+/).filter(Boolean)
        },
        order: Number(fields.order) || 999,
        raw: String(raw),
        body: raw.slice(match[0].length).trim()
    };
}

// 启动时读取；「转为内置 / 取消内置」（builtin-promotion.js）改动目录后调用 reload() 重新读取
let catalog = [];
let byId = new Map();
let byName = new Map();

function reload() {
    catalog = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && ID_RE.test(entry.name) && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
        .map(entry => parseSkillFile(entry.name, fs.readFileSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf8')))
        .sort((a, b) => a.order - b.order || a.meta.id.localeCompare(b.meta.id));
    byId = new Map(catalog.map(item => [item.meta.id, item]));
    byName = new Map();
    for (const item of catalog) {
        if (item.meta.name && /[\u4e00-\u9fa5]/.test(item.meta.name)) byName.set(item.meta.name.trim().toLowerCase(), item.meta.id);
    }
    return catalog.length;
}
reload();

function list() { return catalog.map(item => ({ ...item.meta })); }

/**
 * 解析消息中独立的 @名称。中文可以紧贴前后（“请用@debug看看”）；
 * 前面是字母数字、路径分隔符或 @ 时不算（邮箱 a@debug.com、路径 /tmp/@debug、x@debug），
 * 后面紧跟字母数字、连字符、路径或扩展名时也不算（@debugger、@debug/x、@debug.js）。
 * 支持中文技能名（如 @家庭财务记账助手），中文人名（如 @张三）不计入未知技能。
 */
function mentions(content) {
    const ids = new Set();
    const unknown = [];
    // 1. ASCII 标识：@debug, @family-finance-bookkeeper
    for (const match of String(content || '').matchAll(/(?<![A-Za-z0-9_.\\/@-])@([A-Za-z][A-Za-z0-9-]*)(?![A-Za-z0-9_\\/-]|\.[A-Za-z0-9])/g)) {
        const id = match[1].toLowerCase();
        if (byId.has(id)) ids.add(id);
        else unknown.push(id);
    }
    // 2. 本地化/中文技能名：@家庭财务记账助手、@排查故障（未命中的中文人名如 @张三 不记入 unknown）
    for (const match of String(content || '').matchAll(/(?<![A-Za-z0-9_.\\/@-])@([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9_-]{0,29})(?![A-Za-z0-9_\\/-]|\.[A-Za-z0-9])/g)) {
        const name = match[1].trim().toLowerCase();
        if (byName.has(name)) ids.add(byName.get(name));
    }
    const known = [...ids];
    return { known, unknown };
}

function select(content) {
    const { known } = mentions(content);
    return list().filter(item => known.includes(item.id));
}

// 自动路由平台抓取脚本任务与自然语言创建/完善技能请求，避免把普通 Python/Shell 脚本需求误当作脚本仓库操作。
function autoSelect(content, { pagePath = '', extraIds = [], contextMessages = [] } = {}) {
    const text = String(content || '');
    const selected = [];
    const knownIds = new Set([...mentions(text).known, ...(Array.isArray(extraIds) ? extraIds : [])]);
    const recentUserMessages = (Array.isArray(contextMessages) ? contextMessages : []).filter(item => item?.role === 'user').slice(-3);

    if (!['ops-group', 'welink-office', 'netcare-data', 'welink-slash-command'].some(id => knownIds.has(id))) {
        const scriptOperation = /(?:复制|删除|修改|新增|改名|重命名|保存|编辑|查询|查看).{0,30}脚本/.test(text)
            && !/python|shell|bash|powershell|本地|\.py\b|\.sh\b|\.js\b/i.test(text);
        const domain = scriptOperation || /脚本.{0,40}(?:分类|目录|挪|移动|站点|迁移)|(?:站点|分类|目录).{0,30}脚本|uiv(?:f12|ision)?|uiv_scripts|\bf12\b|脚本仓库|抓取脚本|采集脚本|数据抓取|targetRegion|targetOffice|generatorOffice|capture script|scraping script/i.test(text)
            || (/uivf12/.test(pagePath) && /脚本|script|抓取|采集/i.test(text));
        const followup = /继续|再试|不对|不用改|不要改|你做吧|就按|保存|写入|入库|复制|改名|改成|删除|执行吧|确认/.test(text)
            && recentUserMessages.some(item => autoSelect(item.content, { pagePath }).includes('script-data'));
        if ((domain || followup) && byId.has('script-data')) selected.push('script-data');
    }

    if (/(?:welink|微联).{0,20}(?:斜杠|slash|ace\b)|(?:斜杠命令|slash\s*command).{0,20}(?:welink|微联|注册|创建|管理|发布)/i.test(text) && byId.has('welink-slash-command')) {
        selected.push('welink-slash-command');
    }

    // Open-AutoGLM 手机端自动化控制：
    // 1. 本轮显式提及手机操作、屏幕截图、自动化控制等
    // 2. 本会话历史中已使用过 @open-autoglm，后续的动作指令（如“打卡设置 截图看看”、“打开设置”、“查看当前屏幕”、“点击确认”等）自动保持 open-autoglm 激活
    if (byId.has('open-autoglm')) {
        const autoglmDirect = /(?:open[-_]?autoglm|autoglm|查看.{0,8}(?:屏幕|截屏|截图|画面)|截取.{0,8}(?:屏幕|截屏|截图|画面)|截个?屏|截图看看|看下?屏幕|手机屏幕|手机截屏|手机端自动化|安卓手机)/i.test(text)
            || /(?:在手机上|在安卓上|手机端).{0,20}(?:打开|运行|点击|操作|设置|查看|打卡)/i.test(text)
            || /(?:打卡|打开).{0,10}(?:设置|应用|app|微信|钉钉|系统|界面).{0,20}(?:截图|看看|截屏)?/i.test(text);

        const sessionHadAutoGLM = (Array.isArray(contextMessages) ? contextMessages : []).some(item => {
            const c = String(item?.content || '');
            if (/@open-autoglm\b|open-autoglm|autoglm/i.test(c)) return true;
            if (Array.isArray(item?.toolCalls) && item.toolCalls.some(call => String(call?.name || '').startsWith('open_autoglm'))) return true;
            try {
                const events = typeof item?.events === 'string' ? JSON.parse(item.events) : item?.events;
                if (Array.isArray(events) && events.some(e => (e.type === 'skills' && Array.isArray(e.skills) && e.skills.includes('open-autoglm')) || (e.tool && String(e.tool).startsWith('open_autoglm')))) return true;
            } catch (_) {}
            return false;
        });

        const autoglmFollowup = sessionHadAutoGLM && (
            autoglmDirect
            || /(?:打卡|打开|点击|滑动|输入|按键|按|返回|桌面|截图|截屏|看|设置|微信|钉钉|应用|app|运行|执行|继续|再试|确认|关闭|搜索)/i.test(text)
            || text.trim().length <= 30 // 短动作指令在 autoglm 对话中通常是手机端操作
        );

        if (autoglmDirect || autoglmFollowup) {
            selected.push('open-autoglm');
        }
    }

    // WISE 家庭财务记账助手：
    // 1. 本轮显式提及记账、支出、开销、消费、账单、小票、发票、报销、查账、查余额、财务概况、转账
    // 2. 本会话历史中已使用过 family-finance-bookkeeper，后续的数字、账户名、确认等短指令自动保持激活
    if (byId.has('family-finance-bookkeeper')) {
        const financeDirect = /(?:记[一两123456789]?笔?账?|录入|支出|开销|消费|账单|小票|发票|报销|查账|查余额|账户余额|财务概况|财务总览|今日支出|本月支出|家庭财务)/.test(text)
            || /(?:转账|从.{1,10}转(?:入|到|给).{1,10})/.test(text);

        const sessionHadFinance = (Array.isArray(contextMessages) ? contextMessages : []).some(item => {
            const c = String(item?.content || '');
            if (/@(?:family-finance-bookkeeper|家庭财务|记账助手)\b|family-finance-bookkeeper|quick_record\.py|wise\.fanxiaolong\.uk/i.test(c)) return true;
            if (Array.isArray(item?.toolCalls) && item.toolCalls.some(call => String(call?.name || '').startsWith('finance_'))) return true;
            try {
                const events = typeof item?.events === 'string' ? JSON.parse(item.events) : item?.events;
                if (Array.isArray(events) && events.some(e => (e.type === 'skills' && Array.isArray(e.skills) && e.skills.includes('family-finance-bookkeeper')) || (e.tool && String(e.tool).startsWith('finance_')))) return true;
            } catch (_) {}
            return false;
        });

        const financeFollowup = sessionHadFinance && (
            financeDirect
            || /(?:确认|记入|记吧|好的|行|可以|录入|撤销|删除|查询|余额)/.test(text)
            || /(?:CIB|微信|支付宝|现金|招商|银行|账户|钱包|生活费|餐饮|交通|购物|房租)/i.test(text)
            || /^\d+(?:\.\d{1,2})?$/.test(text.trim()) // 纯数字金额
            || text.trim().length <= 30
        );

        if (financeDirect || financeFollowup) {
            selected.push('family-finance-bookkeeper');
        }
    }

    const improveSkill = /(?:完善|优化|改进|升级).{0,20}(?:skill\b|技能)|(?:skill\b|技能).{0,16}(?:完善|优化|改进|升级)|\b(?:improve|refine|update)\s+(?:the\s+|this\s+|an?\s+)?skill\b/i.test(text);
    const createSkill = !improveSkill && (/(?:做成|生成|创建|新建|制作|写(?:一?个|个|份)?|整理成|封装成|总结成|保存(?:成|为)|沉淀(?:成|为)|转(?:成|为)).{0,24}(?:skill\b|技能)|(?:skill\b|技能).{0,16}(?:草稿|模板|怎么写|如何写)|\b(?:create|make|build|draft|turn\b[\s\S]{0,40}\binto|save\s+as)\s+(?:a\s+|an\s+)?skill\b/i.test(text));
    const skillFollowup = /^(?:确认|继续|好(?:的)?|可以|行|保存|按这个|就按这个|生成草稿|输出草稿)/i.test(text.trim());
    if ((improveSkill || (skillFollowup && recentUserMessages.some(item => autoSelect(item.content, { pagePath }).includes('improve-skill')))) && byId.has('improve-skill')) {
        selected.push('improve-skill');
    } else if ((createSkill || (skillFollowup && recentUserMessages.some(item => autoSelect(item.content, { pagePath }).includes('create-skill')))) && byId.has('create-skill')) {
        selected.push('create-skill');
    }
    return selected;
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
    const draftRule = drafting ? `\n**平台技能保存规则**：有 save_skill 工具时（可用 tool_search 加载 skill_evolution 分组），先用 read_skill 读当前版本，改好后直接调用 save_skill 提交完整 SKILL.md，用户在审批卡上允许后即保存（旧版本自动备份）；只有 save_skill 返回成功才算保存完成，不要只输出草稿让用户自己点按钮。技能里不得写入账号密码、Token，也不得要求运行时读取它们，遇到登录页应停下来提示用户手动登录。没有 save_skill 工具时：聊天回复本身不会创建、保存或激活技能，用户回复“确认”也不会触发保存接口。生成或修改技能时，必须输出完整的 \`\`\`skill 代码块，其中包含 SKILL.md 的 front-matter（id、name、name_en、description、description_en、workspace）和执行步骤；id 必须是以字母开头的小写英文、数字、连字符，最长 41 字符。明确说明“草稿尚未保存，请点击回复下方的保存为技能/完善此技能按钮”；只有界面保存接口返回成功才算保存完成。不得用“已创建并激活”“已保存”“现在可以 @ 使用”等文字代替可保存的草稿。用户仅回复“确认”时，如上文尚未提供可保存草稿，应补全草稿。信息不足时先澄清，不要虚报成功。\n` : '';
    // 自我进化：用技能做完任务后，发现步骤错了、过时了或被用户纠正，主动提交改进版（save_skill，用户审批后保存）
    const evolveRule = drafting ? '' : '\n**技能自我进化**：用上面的技能完成任务后，如果发现其中步骤有错、已过时、需要绕路，或用户纠正了做法，在回答末尾用一句话说明想怎么改，并在有 save_skill 工具时（tool_search 加载 skill_evolution 分组）用 read_skill 读当前版本、改好后用 save_skill 提交，用户审批后保存。只改确有依据的地方，不得写入账号密码或 Token。\n';
    return sections.length ? `\n以下 Skills 来自用户选择或任务自动匹配。按任务需要使用其中流程；用户当前要求优先，Skill 不改变账号权限和审批模式，不要求额外审批。只使用实际可用的工具，不编造执行或验证结果。回复语言跟随用户。\n${sections.join('\n\n')}\n${draftRule}${evolveRule}` : '';
}

// 内置 Skill 原文与正文（下载、管理用）；不存在时返回 null
function builtin(id) {
    const item = byId.get(String(id || '').toLowerCase());
    return item ? { meta: { ...item.meta }, order: item.order, raw: item.raw, body: item.body, dir: path.join(SKILLS_DIR, item.meta.id) } : null;
}

module.exports = { list, select, mentions, load, autoSelect, buildPrompt, builtin, reload, parseSkillFile, SKILLS_DIR, ID_RE, MAX_SELECTED };
