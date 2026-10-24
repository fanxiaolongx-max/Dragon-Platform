// AI report editor: report documents, the per-cell AI conversation that compiles prompts into recipes, and data for running them.
const express = require('express');
const reports = require('../models/ai-report-repository');
const data = require('../models/ai-report-data');
const model = require('../../frontend/js/ai-report/report-model');
const aiSettingsRepo = require('../models/ai-settings-repository');
const aiProviderClient = require('../models/ai-provider-client');
const images = require('../models/ai-report-images');
const multer = require('multer');

const { AsyncLocalStorage } = require('node:async_hooks');

const router = express.Router();
const MAX_TOOL_STEPS = 8;

// Developer mode: a request carrying _debug:true records every exchange with the model (what was sent, what came
// back, tool calls, retries) and returns it as _trace next to the normal answer, including on errors.
const traceStore = new AsyncLocalStorage();
const TRACE_TEXT = 40000;
const clip = value => { const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1) || ''; return text.length > TRACE_TEXT ? `${text.slice(0, TRACE_TEXT)}\n…（共 ${text.length} 字，后面已截断）` : text; };
function trace(entry) { const item = { at: new Date().toISOString(), ...entry }, store = traceStore.getStore(); if (store && store.length < 120) store.push(item); return item; }
router.use((req, res, next) => {
    if (req.body?._debug !== true) return next();
    delete req.body._debug;
    const store = [], json = res.json.bind(res);
    res.json = body => json(body && typeof body === 'object' && !Array.isArray(body) ? { ...body, _trace: store } : body);
    traceStore.run(store, next);
});
const traced = client => !client || client.__traced ? client : new Proxy(client, { get(target, key, receiver) {
    if (key === '__traced') return true;
    if (key === 'generateImage') return async options => {
        const started = Date.now(), entry = trace({ kind: 'ai', system: '（绘图模型）', messages: clip({ prompt: options.prompt, referenceImages: (options.images || []).length, aspectRatio: options.aspectRatio || '' }), tools: [] });
        try { const result = await target.generateImage(options); Object.assign(entry, { ms: Date.now() - started, reply: clip({ images: result.images.map(image => `${image.mimeType} ${Math.round(image.data.length * 0.75 / 1024)}KB`), text: result.text, usage: result.usage }) }); return result; }
        catch (error) { Object.assign(entry, { ms: Date.now() - started, error: error.message }); throw error; }
    };
    if (key !== 'generateChat') return Reflect.get(target, key, receiver);
    return async options => {
        const started = Date.now(), entry = trace({ kind: 'ai', system: clip(options.systemInstruction || ''), messages: clip((options.messages || []).map(item => ({ role: item.role, content: item.content, ...(item.toolCalls ? { toolCalls: item.toolCalls } : {}), ...(item.toolResults ? { toolResults: item.toolResults } : {}) }))), tools: (options.tools || []).map(tool => tool.name) });
        try {
            const result = await target.generateChat(options);
            Object.assign(entry, { ms: Date.now() - started, reply: clip(result.text || ''), toolCalls: result.toolCalls?.length ? clip(result.toolCalls.map(call => ({ name: call.name, args: call.args }))) : '' });
            if (result.providerClient) result.providerClient = traced(result.providerClient);
            return result;
        } catch (error) { Object.assign(entry, { ms: Date.now() - started, error: error.message }); throw error; }
    };
} });
const TOOL_RESULT_CHARS = 14000;

const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (error) {
        const status = error.status || 500;
        if (status >= 500) console.error('[AI Report]', error);
        res.status(status).json({ error: error.message || 'AI report request failed' });
    }
};
const user = req => String(req.user?.username || req.user?.id || '');

router.get('/documents', handle(async (_req, res) => res.json(await reports.list())));
router.get('/documents/:id', handle(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await reports.read(req.params.id)); }));
router.post('/documents', handle(async (req, res) => res.json(await reports.save(req.body, user(req)))));
router.delete('/documents/:id', handle(async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '只有管理员可以删除月报' });
    res.json(await reports.remove(req.params.id));
}));

// New reports start from the existing monthly template: header, meta fields, chapter titles and footer.
router.get('/template', handle(async (req, res) => {
    const month = model.validMonth(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
    let legacy = null;
    try { legacy = (await require('../models/monthly-template-repository').getDefault()).template; } catch (error) { console.warn('[AI Report] template unavailable:', error.message); }
    res.json(model.fromLegacyTemplate(legacy, month));
}));

router.get('/sources', handle(async (req, res) => res.json(await data.listSources(req.query.month))));
router.post('/run-data', handle(async (req, res) => {
    const recipe = model.normalizeRecipe(req.body?.recipe);
    const { input, missing } = await data.recipeInput(req.body?.month, recipe.sources);
    res.json({ input, missing });
}));

async function aiClient() {
    const settings = await aiSettingsRepo.getRuntimeSettings();
    if (!settings.hasApiKey || !settings.keyLooksValid) {
        const error = new Error('AI 未配置：请先在 AI 设置中配置可用的 API Token。');
        error.status = 503;
        throw error;
    }
    return traced(aiProviderClient.createClient(settings));
}

const KIT_GUIDE = `render(result, kit) 只能返回 HTML 字符串（不能有 <script>、事件属性或外部资源），可用 kit：
- kit.table(rows, {columns:[{key,label,align:'left'|'right',format:'number'|'percent'|'text'}], title, maxRows})：单元格一律按文字显示，不能放 HTML；要把未达标标红时，在行里加 $tone:'bad'（整行标红）或 $tones:{列key:'bad'}（单个单元格标红），达标可用 'good'
- kit.kpi([{label, value, unit, delta, deltaLabel, tone:'good'|'bad'|'neutral'}])：delta 是和对比期的差值（数字），平台会显示成“较上月 +2”“与上月持平”；对比的不是上月时用 deltaLabel 说明（如 '较去年同期'）
- kit.bar([{label, value}], {title, unit, horizontal:true|false})
- kit.line([{name, points:[{x, y}]}], {title, unit})
- kit.pie([{label, value}], {title, unit})
- kit.list(items, {ordered, title})：items 是文字，或 {label, text, anchor, tone}（label 显示在前面，有 anchor 时变成跳转链接；tone:'bad' 整行标红、'good' 标绿；text 里的 **…** 会加粗），或 {html}（html 可以用 kit.link、kit.esc 拼出来）。要标红、加跳转时优先用 {label, text, anchor, tone}，不要自己拼 <span style> 或 <strong>
- kit.text(string)、kit.esc(string)、kit.fmt(number, digits)；kit.text 和 kit.list 的文字里用 **…** 包住的数字或词会加粗并标成主题色（如 kit.text('ORG 拦截 **' + count + '** 次')），要突出关键数字时用它，不要自己拼 <strong>、<b> 或颜色样式
- kit.inlineLink(一句话, anchor, {terms:['指标名称']}) → 把跳转链接嵌进句子里：优先嵌在 terms 里第一个出现的词（通常传格子的 title 或指标名），没有就嵌在第一个带单位的数字上，再没有就嵌在句首短语上；要求“链接嵌在指标名称或数字上”时用它，不要自己写正则去匹配
- kit.nav([{label, anchor, no, note}], {columns, title, numbered}) → 快速跳转导航（一组编号链接，点击跳到对应章节或格子）；kit.link(文字, anchor) → 文中跳转链接。anchor 只能用“月报内容”来源给出的 anchor（如 '#air-chapter-xxx'、'#air-cell-xxx'），其它链接一律无效
- kit.extremes(rows, {label:'name', value:'rate'}) → {same, max:{value, labels:[...]}, min:{value, labels:[...]}}：找最高/最低时用它，它会处理并列；same 为 true 表示全部相等
交互组件（由平台渲染，用户可以交互；邮件和打印时自动转为静态）：
- kit.chart(option, {title, height, id, drill}) ：option 是 ECharts 5 的配置对象（纯 JSON，不能有函数），可用 tooltip、legend、dataZoom、多系列、双轴、堆叠、散点、热力图、仪表盘、雷达图、漏斗图等。需要悬停查看、缩放、切换系列的图表优先用它。
- kit.datatable(rows, {columns:[{key,label}], pageSize, search, title, id}) ：可排序、搜索、分页的明细表。行数超过 10 行的明细优先用它。
- 下钻与联动（图表 + 明细表同时出现时默认加上）：kit.chart(option, {drill:{field:'明细表里对应的列名', target:'明细表的 id', levels:{'某个分类名':{option:下一层的 ECharts 配置, drill:{field, levels}}}}}) 配合 kit.datatable(rows, {id:'明细表的 id'})。点击图表上的某个分类名：明细表按 field 等于该名称筛选；如果 levels 里有这个名称，图表切换到下一层，顶部出现可返回的面包屑。默认两层（汇总 → 下一层或直接筛选明细），最多三层（如 地区部 → 代表处 → 国家）。每一层的数据都必须在 compute 里算好放进 result，render 只负责组装；levels 的键必须和图表上显示的分类名完全一致；下一层的 field 是下一层分类对应的明细列。
- kit.tabs([{label, html}]) ：分页签，html 可以是上面任意组件的输出。
- kit.layout(rows) ：把格子分成命名小格子，rows 是行的数组，每行是 [{id, html, width, title}]（只有一行时可以直接传一行）。id 用简短英文（chart、table、kpi、summary 等），width 是这一行里的占比（如 55、45）。小格子的尺寸由平台控制，用户可以直接拖动调整；放在有高度的小格子里的图表会自动填满高度。
也可以直接拼接带内联样式的 HTML（div/span/table/svg 等）。`;

const DATA_TOOLS_GUIDE = '可用工具：list_sources（本月导入的原始表、sourceKey、表头、行数）、describe_sheet（表头和前 30 行样本）、list_metrics（已提取/考核的指标，可用 query 按名称搜索；用户提到某个指标时先按名称搜一下）、list_report_cells（这份月报的章节和格子，做导航、总览或引用其他格子时用）、list_datasets（平台各模块与自定义工具的结构化数据表：SLA 快照、FRT、值班表、奖惩、问卷、各工具数据等）、describe_dataset（某个数据集的列和前 30 行样本）、search_tool_data（其他工具的文字摘要，只能用于总结）。比率、达成率、考核和提取的数字（如日志回传、备案、SLA 达成率）一般在 list_metrics 里，明细在导入表和数据集里；找数据时这三处都要看，不要凭空猜表名、列名或数字。用户说的名称常和实际名称不完全一样（如“日志回传率”对应指标“日志回传”，“备案率”对应“日志回传备案”），按含义匹配。';

// Conversation: answer questions about the data and settle what the cell should show. No recipes here.
// Conflicts come first: a new requirement that contradicts an existing prompt (this one or another level) is never
// silently applied; the user picks which side wins from clickable choices.
const CONFLICT_RULE = `- 冲突优先询问：用户这次的要求如果和已有提示词里的某条要求冲突（包括当前这段提示词，以及给出的章节样式提示词、月报整体风格提示词、格子提示词），先不要回复 ready，回复 ask：用一两句话说明冲突在哪，两边都引用原文（如“现在的要求：事故写本月起数并和目标比较；你这次说：事故只写增量”），choices 给出 2-4 个可以直接点选的处理方式，每个不超过 20 个字，例如“以这次为准，替换原要求”“保留原来的要求”“只在这个格子例外”“两条都保留：……”。只是补充、细化而不矛盾时不算冲突，不要问。冲突的提问必须用 ask（带 choices），绝不能写在 answer 里让用户打字回答。用户选好后按选择处理，并在复述里说明哪条要求被替换或保留；用户没有选、而是提了别的要求时，先处理新要求，回答末尾再提一句之前的冲突还没确认。`;

const CONFLICT_RETRY = '这是在问用户冲突怎么处理：请改用 {"type":"ask","question":"…","choices":["…","…"]}，choices 给出 2-4 个可以直接点选的处理方式。';
const asksAboutConflict = reply => reply?.type === 'answer' && /冲突/.test(String(reply.text || '')) && /[？?]\s*$/.test(String(reply.text || '').trim());

const CHAT_PROMPT = `你是“AI 月报”的格子助手。月报由许多格子组成，每个格子最终由一段“提示词”描述：用哪些数据、怎么筛选和计算、用什么形式展示、要不要文字总结。
现在是和用户讨论这个格子的阶段：
- 用户问数据相关的问题（有哪些表、有哪些列、某个值是多少、数据大概什么样），就用工具查清后直接回答，回答要具体、简短。不要生成配方，也不要每次都给出表格方案。
- 用户提出要展示的内容时，帮他把需求说清楚：数据来源、口径、筛选、计算、展示形式。不清楚就提问，并给出 2-5 个具体选项。
- 用户想要明细表而源表列很多（超过 8 列）时，先列出建议保留的列（说明理由），问用户是否同意，选项给出 "同意" 和 1-2 个其它合理方案；用户回复同意或说明要增减哪些列都可以。
- 用户提到或更换数据（如“数据源改成 xx”），先用工具查到它实际在哪里（指标、导入表还是数据集）和准确名称，再继续；查不到就如实说明，并给出最接近的几个真实来源作为选项。
${CONFLICT_RULE}
- 用户要改的是显示用的名称（标题、表头、图例、指标的显示名）时，只改显示文字，数据来源保持原来的名称；不要把新名称当成要查的新指标。
- 用户只说某处“不对”“不好”“有问题”而没说要改成什么时（如“标题不对”），不要回复 ready，也不要把当前内容原样复述一遍；回复 ask，说出你对哪里不对的猜测，并给出 2-5 个具体改法作为选项（如标题改成哪几种写法）。
- 需求已经清楚、可以直接生成时（数据来源、口径、展示形式都能确定，没有必须问用户的地方），回复 ready，用一两句话复述你的理解，并写明查到的真实来源（如“指标：日志回传 / TE、ORG、ET”或“导入表：xx / Sheet1”）；系统会自动生成提示词并把内容做出来，不要再让用户点按钮。
- text 和 question 里不要用 Markdown 符号（如 ** 或 #），需要分点时用换行加“- ”。
${DATA_TOOLS_GUIDE}
- 只有用户明确说了要求适用于整份月报（说了“所有格子”“每个格子”“整份月报”“以后都”“全部”这类话，例如“以后所有总结都不超过两句”“月份都写成 X月”“全部图表用横向条形图”），照常处理这个格子，同时在回复的 JSON 里加上 "report_rule":{"section":"最合适的分类名（风格与配色、数据与计算、文字与结论、排版与图表，或新的分类名）","item":"写成一条通用要求的完整一句话"}，系统会问用户要不要加入月报整体风格提示词。不管这次回复是 answer、ask 还是 ready，只要用户这句话里带了这样的要求就要加上 report_rule（例如“这个格子做柱状图；另外以后所有总结都不超过两句”，回复 ready 的同时也要带 report_rule）。要求的对象必须是其他格子或整份月报；说的是这个格子自己的内容时（主语是“这个格子”“这里”“本月概述”“这个图”等），即使句子里有“所有”“全部”也不算，例如“本月概述中所有结论都要简明”只属于这个格子。描述这个格子本身要做什么、要怎么展示的要求一律不算（即使这个格子是总览、导航、汇总其他格子的格子，例如“概述里结论要简明、带跳转链接”只属于这个格子），不要加；月报整体风格提示词里已经有的要求不要重复加。
最终回复只能是一个 JSON 对象，三选一（都可以带上 report_rule）：
{"type":"answer","text":"回答"}
{"type":"ask","question":"要问用户的问题","choices":["选项1","选项2"]}
{"type":"ready","text":"一两句话复述要生成的内容"}
不要输出 Markdown 代码块或其它文字。用户用中文就用中文回答。`;

// Summary: the whole conversation becomes one self-contained cell prompt.
const PROMPT_SUMMARY = `把下面这段关于月报格子的对话总结成这个格子的“最终提示词”。要求：
- 写成给数据分析助手的一段清晰指令（中文，3-10 句或分行要点），只依据对话中用户确认过的内容，不要加入用户没提过的要求。
- 必须写清：数据来源（表名/工作表/指标名）、筛选条件（默认报告月份）、需要的列或字段、计算与排序、展示形式（表格/指标卡/柱状图/折线图/饼图/文字等）、是否需要文字总结以及总结重点。
- 这个格子每个月都会用当月数据重新生成，所以时间要写成“报告月份”“上个月”等相对说法，不要写死具体年月（除非用户明确要求固定某个月）。
- 数据来源只能写对话里查到并说明过的真实来源（指标名称、导入表名、数据集名），不要自己编“xx 原始数据表”这类名称；指标只写名称，不要写 key（key 换月会变）。
- 不要把格子 id、跳转 anchor（如 #air-cell-…）写进提示词：引用其他格子时写“各章节的格子”“风险治理章节的格子”这类说法，格子增删后提示词仍然适用。
- 如果之前已有提示词，在它基础上按对话中的新要求修改；数据来源换了时，删掉只属于旧数据的要求（旧的筛选条件、名称缩写规则、旧图表标题等）。
只输出 JSON：{"prompt":"最终提示词"}`;

// In-cell text edit: the user changed some generated text; the model decides how the change belongs in the prompt.
const TEXT_EDIT_PROMPT = `用户在月报格子的生成结果里直接改了一段文字。你要判断这是哪种修改，并把它准确写进这个格子的“最终提示词”，让以后每个月重新生成时都按这个要求来。
两种方式：
- replace（明确替换）：某个固定文字以后一律换成另一个固定文字，例如表头、标题、图例、固定称呼、名称写法（“回传%”改成“回传率”，“EG-Egypt ET”改成“ET”）。写成明确的替换规则，原文字和新文字都要写出来。
- refine（表述优化）：改的是根据数据生成的句子的写法，例如格式、语气、详略、措辞、顺序（“2026-09”改成“9月”说明月份要写成“X月”；删掉半句说明以后不要写这一点；“最差”改成“相对较低”说明语气要委婉）。概括成通用的写作要求，不要把这个月的具体数字写死进提示词，数字每月都会变。
- 用户改的是数字时，数字来自数据，不能直接改：按意图写成格式或计算要求（保留几位小数、加百分号、换单位等），在 note 里说明数字仍由数据算出。
- 修改位置是“总结”时，写进提示词里对文字总结的要求；其它位置写进对应内容的展示要求。
- 改的文字正好是数据来源名称（指标名、表名、列名）时，用户只是想改显示的文字（标题、表头、图例），数据来源绝不能跟着改：写成“标题显示为‘新文字’，数据仍取指标‘原名称’”。
- replace 只管修改的那个位置：改了表头，就写“表格表头‘X’写成‘Y’”这样的规则，不要把提示词里其它地方（统计口径、指标名称、分析标题等）的同名文字也换掉，除非修改的正是那里。
- 以【】开头的行（如【格子内部布局】【尺寸约束】）由平台自动维护，必须逐字保留，新要求绝不能写进这些行，要写进前面对应的展示或总结要求里。
- 只改和这次修改有关的地方，提示词其余内容逐字保留；已有相同要求不要重复添加，相冲突的旧要求要替换掉。
只输出 JSON：{"mode":"replace 或 refine","note":"一句话告诉用户你是怎么理解这次修改、写进了提示词的哪里","prompt":"修改后的完整最终提示词"}`;

// The changed part of a text edit, trimmed to what actually differs.
function changedPart(before, after) {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
    // Whole words and numbers ("2026-09", not "0" → "9"); a one- or two-character change keeps its neighbours.
    const word = char => /[A-Za-z0-9.%-]/.test(char || '');
    while (start > 0 && word(before[start - 1]) && (word(before[start]) || word(after[start]))) start--;
    while (end > 0 && word(before[before.length - end]) && (word(before[before.length - end - 1]) || word(after[after.length - end - 1]))) end--;
    if (before.length + after.length - 2 * (start + end) <= 3) { start = Math.max(0, start - 1); end = Math.max(0, end - 1); }
    return { from: before.slice(start, before.length - end), to: after.slice(start, after.length - end) };
}

async function textEditTurn(client, { month, prompt, place, kind, before, after, dataNames = [] }) {
    // Short labels (headers, cells, titles) are reported whole; in sentences only the changed words.
    const label = before.length <= 12 && after.length <= 16 && !/[。，；：！？,;:!?]/.test(before + after);
    const { from, to } = label ? { from: before, to: after } : changedPart(before, after);
    const change = !from ? `新增了“${to}”` : !to ? `删掉了“${from}”` : `把“${from}”改成了“${to}”`;
    const content = [`报告月份：${month}`, `当前最终提示词：\n${prompt}`, `修改位置：${place === 'narrative' ? '总结（AI 根据计算结果写的文字总结）' : '格子内容'}${kind ? '中的' + kind : ''}`, `修改前整段：${before}`, `修改后整段：${after}`, `改动：${change}`].join('\n\n');
    // The names the cell actually reads data by: a text edit renames what is shown, never these.
    const names = [...new Set(dataNames.map(name => String(name || '').trim()).filter(name => name && prompt.includes(name)))].slice(0, 40);
    const messages = [{ role: 'user', content: names.length ? `${content}\n\n这个格子实际取数用的数据来源名称（提示词里的数据来源部分必须原样保留这些名称；被修改的文字正好是其中之一时，说明用户只想改显示的文字）：${names.map(name => `“${name}”`).join('、')}` : content }];
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await client.generateChat({ systemInstruction: TEXT_EDIT_PROMPT, messages, maxOutputTokens: 3000, temperature: 0.2 });
        const reply = parseReply(result.text);
        const lost = reply?.prompt ? names.filter(name => !String(reply.prompt).includes(name)) : [];
        if (lost.length) { messages.push({ role: 'model', content: result.text || '' }, { role: 'user', content: `数据来源名称${lost.map(name => `“${name}”`).join('、')}被改掉了，格子会取不到数据。这次只改显示的文字：把数据来源部分恢复成原来的名称，在展示要求里写“标题（或表头、图例）显示为‘${after.slice(0, 40)}’，数据仍取‘${lost[0]}’”。只输出 JSON。` });continue; }
        if (reply?.prompt && String(reply.prompt).trim()) return { mode: reply.mode === 'replace' ? 'replace' : 'refine', note: String(reply.note || '').slice(0, 600), prompt: String(reply.prompt).trim().slice(0, 4000), change };
        messages.push({ role: 'model', content: result.text || '' }, { role: 'user', content: '请只输出约定的 JSON 对象（mode、note、prompt）。' });
    }
    const error = new Error('AI 没能把这次修改写进提示词，请再试一次');
    error.status = 502;
    throw error;
}

// Compile: a confirmed prompt becomes a recipe that reruns every month.
const COMPILE_PROMPT = `你要把月报格子的“最终提示词”编译成一个可以每月重复运行的配方。数字必须由 compute 代码从数据算出，不能写死在代码里。
如果给了“月报整体风格提示词”，其中的通用要求每个格子都要遵守；它和下面的默认做法冲突时以它为准（JSON 格式、kit 用法、数据来源格式等技术约束除外）。
${DATA_TOOLS_GUIDE} 编译前先用工具确认表和列确实存在。

配方格式：
- sources：数组，每项是以下之一：
  {id:'s1', kind:'sheet', label:'表的中文说明', match:{sourceKey:'list_sources 返回的 sourceKey', sheetName:'工作表名'}, monthOffset:0}
  {id:'m1', kind:'metrics', label:'说明', names:['指标名称（list_metrics 返回的 label，原样照抄）'], monthOffset:0}（同一个指标在不同月份的 key 可能不同，名称是稳定的，所以一律按名称取，不要写 keys）
  {id:'d1', kind:'dataset', label:'说明', dataset:'list_datasets 返回的 id', monthOffset:0}（平台模块和自定义工具的结构化数据，可以进入 compute；period 为 current 的数据集是当前数据，需要按报告月份时自己用日期列筛选）
  {id:'r1', kind:'report', label:'说明', include:'outline' 或 'results', chapters:['章节 id，可省略表示全部']}（这份月报本身：做快速跳转导航用 outline；做总览、汇总其他格子用 results）
  {id:'t1', kind:'tool', label:'说明', slug:'工具 slug', question:'要查的问题'}（工具数据只是文字摘要，只能用于总结文字，不能进入 compute）
  monthOffset 为 0 表示报告月份，-1 表示上个月（做环比时用）。
- compute：字符串，必须定义 function compute(input){...}。input[sourceId] 为 {month, file, sheet, headers, rows:[{列名:值}]}（指标源为 {month, metrics:[{key,label,value,target}], values:{名称: 数字}, targets:{名称: 目标数字}, rules:{名称: 'gte' 或 'lte'}}，values 已把 '95%' 这类值转成数字 95，按名称取数，如 input.m1.values['日志回传 / TE']；targets 是当月的目标值（来自预警目标配置，'95%' 也是 95），rules 为 'gte' 表示不低于目标才达标、'lte' 表示不高于目标才达标，判断是否达标、计算与目标的差距时用它们，不要把目标写死在代码里；本月和上月用两个指标源（monthOffset 0 和 -1）、写同样的 names；数据集源为 {month, source, name, period, headers, rows}；月报内容源为 {month, title, chapters:[{id, no:'01', numbered, title, anchor, cells:[{id, anchor, title, summary, result}]}]}（numbered 为 false 的是不编号的章节，比如总览、导航，它的 no 为空），summary 和 result 只在 include 为 'results' 时有，是其他格子已经算好的总结和结果，不含当前格子）；某个来源本月没有数据时为 null，必须处理并返回 {missing:true, message:'...'}。input.$month 是报告月份。返回 JSON 可序列化的结果。列值可能是字符串，计算前转数字。
- render：字符串，必须定义 function render(result, kit){...}。result.missing 为真时返回一句提示。
${KIT_GUIDE}
- 配色交给平台：kit.chart 的 ECharts 配置里一般不要写颜色，平台会自动套用月报主题色；确需区分时只能用 6 位十六进制色值，绝不能在 ECharts 配置里写 var(...)。只有自己拼接的 HTML 内联样式可以用 var(--air-accent)、var(--kit-c0) 到 var(--kit-c7)。
- 坐标轴标签、图例和文字不能超出图表或格子的上下左右边界：长分类名缩写或截断（ECharts 用 axisLabel 的 width + overflow:'truncate' 或 rotate），并在 tooltip 里显示全称；不要让图表上方留出大块空白。
- 提示词里如果有【尺寸约束】，全部内容必须在给定的宽高内完整显示：kit.chart 的 height 按剩余空间设置（减去标题、文字总结和表格占用的高度）；日期缩短为 MM-DD 或 M/D；用 splitNumber 减少刻度；grid 边距收紧并 containLabel:true；图例放顶部单行或省略；表格只保留最关键的列和行（其余用 kit.datatable 分页）；文字总结一到两句；按约束里给出的规则缩写长名称。
- 鼠标悬停、高亮、选中等交互效果只能让元素变深或变浅，不能让任何图形或文字消失：不要把 emphasis/blur/select 的颜色设成 transparent 或 none，不要把透明度设得很低，不要用 emphasis.focus 让其他元素几乎看不见。表格、文字等其他内容同样不能在悬停时被隐藏。
- 格子里不能出现滚动条或需要滑动的区域：不要写 overflow:auto/scroll、max-height 之类限制高度的样式，不要用 ECharts 的 dataZoom；放不下时精简内容、调小图表，长表格用 kit.datatable 分页。
- 提示词要求了标题（如“标题为 X”）时，必须把这个标题显示出来：用 kit.layout(rows,{title:'X'}) 或 kit.chart(option,{title:'X'})，不要只写在 ECharts 配置以外的说明里，也不要漏掉。
- 格子里有两个及以上的内容块（图表、表格、指标卡、文字总结）时，用 kit.layout 排版，不要自己写 flex/grid 的外层布局，也不要给小格子写宽高样式。
- 提示词里有【格子内部布局】时，必须用 kit.layout 和其中列出的同样的小格子 id 与行内顺序（宽度可按其中的占比给 width），高度交给平台；图表放进小格子后不要再设 height。
- 所有数字必须由 compute 从 input 里的真实数据算出：禁止 Math.random、示例数据或写死的数字；找不到数据就返回 {missing:true, message}。
- 提示词要求的计算型指标（名称里带“增量、差值、变化、环比、同比、占比、达成率”等）本身就是要展示的数：在 compute 里算出来，作为这个指标的主数值 value。例如“事故增量”的 value 必须是 本月事故数 − 上月事故数（两个月都是 3 时 value 为 0），绝不能把本月事故数 3 放在 value、再把增量放进 delta；这类指标通常不需要再给 delta。普通指标（如“延期补授权”）的 value 才是本月原值，delta 是和上月的差值。
- 提示词里的数据来源名称不一定和实际名称完全一样：导入表里找不到时，一定再查 list_metrics 和 list_datasets，按含义匹配（如“日志回传率”对应指标“日志回传”）；都找不到就回复 ask 说明，绝不能拿无关的数据代替。
- render 里不能写死描述数据的句子（如“ORG 最高”），结论文字要用 result 里的数据拼出来，或交给 narrative。
- 快速跳转导航：用 include:'outline' 的月报内容源，compute 把章节（或格子）整理成 [{label, anchor, no}]，render 用 kit.nav 显示；默认只列 numbered 为 true 的章节（不编号的总览、导航等不列），编号用数据里的 no；提示词没有特别说明时只列章节、不列格子，kit.nav 用 columns:4（每行 4 个按钮），不加标题、不需要文字总结（narrative 为 null）；提示词说了几行几个时按它算 columns；章节名、编号和 anchor 都从数据里取，不能写死（章节改名、调整顺序后要自动跟着变）。
- 总览 / 汇总：用 include:'results' 的月报内容源。每个格子都有 summary（没有自己总结的格子，平台已经用 AI 从它的结果里提炼了一句，summaryFrom 为 'result'；summary 为空字符串表示没有要点可写），结论直接用 summary，不要在代码里自己从 result 拼要点句子；每个格子的 result 结构各不相同（字段由各自的配方决定），绝不能假设里面有 items、metrics、status 之类的字段；要判断达标与否，就看 summary 里有没有“未达标”；数字只能来自这些结果，取不到就不写；可以用 kit.link 链接到对应格子方便跳转。整体总结（“本月整体…”这类话）必须交给 narrative（设置 narrative:{prompt:'根据各格子的结论概括本月整体情况…'}），render 里不能写任何整体评价或套话。
- 写“最高/最低、最优/最差”这类结论时必须处理并列：用 kit.extremes；全部相等时写“各运营商持平，均为 100”这类话，不写最高最低；并列时列出全部名称（如“TE、ORG 并列最高”）。
- compute 里读取的每个指标名称都必须写进对应指标源的 names（例如要显示“路由器”整体值和“路由器 / TE”等分项时，names 里两者都要有）。指标一律按 list_metrics 返回的名称 label 原样取值（如 input.m1.values['事故']），不要用 key（key 换月可能会变），也不要拿名称去匹配 key；取不到（undefined）要能被发现，不要先填 0 再静默保留。
- compute 返回的字段名必须和 render 读取的字段名完全一致（包括 kit.table 的 columns.key）；运行时会检查，读取不存在的字段会被判为错误。
- 代码里的变量名、函数名、对象属性名一律用英文字母（如 rate、dept、total），不要用中文标识符；中文只出现在字符串里（图例、列标题、说明文字）。
- 月份一律用 input.$month 或 monthOffset，代码和 summary 里都不要写死具体年月。
- summary：{zh:'一句话说明这个配方：数据、计算、展示', en:'same in English'}
- narrative：提示词要求文字总结时给 {prompt:'总结要强调什么'}，否则 null。平台会把 narrative 写出的总结固定显示在格子最上方（蓝色框），所以只能二选一：要总结且没指定位置（或说放在顶部）时用 narrative，render 里不能再写任何总结或结论句；明确要求总结放在别处（如表格下方、图表右侧）时 narrative 设为 null，由 render 用 result 里的数据拼出这段话放到指定位置。绝不能两处都写总结。

最终回复只能是一个 JSON 对象，二选一：
{"type":"recipe","reply":"一句话说明","recipe":{...}}
{"type":"ask","question":"提示词里无法确定、必须问用户的问题","choices":["选项1","选项2"]}
不要输出 Markdown 代码块或其它文字。`;

const TOOLS = [
    { name: 'list_sources', description: '列出报告月份可用的原始表：每个文件的 sourceKey、工作表名、表头、行数', parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM，默认报告月份' } } } },
    { name: 'describe_sheet', description: '读取一个工作表的表头和前 30 行样本', parameters: { type: 'object', properties: { sheetId: { type: 'string' } }, required: ['sheetId'] } },
    { name: 'list_metrics', description: '列出报告月份已提取或考核的指标，每行“名称 = 值（目标）”；指标很多，找某个指标时用 query 按名称搜索（如 "SR FRT"、"回传"）', parameters: { type: 'object', properties: { month: { type: 'string' }, query: { type: 'string', description: '按名称搜索的关键词，空格分隔表示都要包含' } } } },
    { name: 'list_datasets', description: '列出报告月份可用的结构化数据集（平台各模块快照、值班表、奖惩、问卷、自定义工具数据），含 id、来源、列、行数', parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM，默认报告月份' } } } },
    { name: 'describe_dataset', description: '读取某个数据集的列和前 30 行样本', parameters: { type: 'object', properties: { id: { type: 'string' }, month: { type: 'string' } }, required: ['id'] } },
    { name: 'list_report_cells', description: '列出这份月报的章节和格子（编号、标题、跳转 anchor、各格子总结摘要）。做导航、总览、引用或总结其他格子时先用它', parameters: { type: 'object', properties: {} } },
    { name: 'search_tool_data', description: '在平台其他工具中查找与问题相关的数据摘要（文字）', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } }
];

async function runTool(call, month, context = {}) {
    if (call.name === 'list_report_cells') return context.outline || { chapters: [], note: '没有拿到月报大纲' };
    const args = call.args || {};
    const targetMonth = model.validMonth(args.month) ? args.month : month;
    if (call.name === 'list_sources') return data.listSources(targetMonth);
    if (call.name === 'describe_sheet') return data.describeSheet(args.sheetId);
    if (call.name === 'list_metrics') return data.findMetrics(targetMonth, args.query);
    if (call.name === 'list_datasets') return data.listDatasets(targetMonth);
    if (call.name === 'describe_dataset') return data.describeDataset(args.id, targetMonth);
    if (call.name === 'search_tool_data') return data.searchToolData(String(args.question || ''));
    throw new Error('Unknown tool ' + call.name);
}

// Models sometimes add a stray closing brace or an invalid escape (\\d in code). Take the first balanced object,
// then retry with escapes repaired; report the error so a retry can tell the model exactly what to fix.
function firstObject(raw) {
    const start = raw.indexOf('{');
    if (start < 0) return '';
    let depth = 0, inString = false, escaped = false;
    for (let index = start; index < raw.length; index++) {
        const char = raw[index];
        if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
        if (char === '"') inString = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return raw.slice(start, index + 1);
    }
    return raw.slice(start, raw.lastIndexOf('}') + 1);
}
function parseReplyDetailed(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const candidate = firstObject(raw);
    if (!candidate) return { value: null, error: '回复里没有 JSON 对象' };
    try { return { value: JSON.parse(candidate) }; } catch (error) {
        const repaired = candidate.replace(/\\(?!["\\/bfnrtu])/g, '\\\\').replace(/[\u0000-\u001f]/g, char => char === '\n' ? '\\n' : char === '\t' ? '\\t' : '');
        try { return { value: JSON.parse(repaired), repaired: true }; } catch (_) { return { value: null, error: error.message }; }
    }
}
const parseReply = text => parseReplyDetailed(text).value;

const historyMessages = chat => model.cell({ chat }).chat.map(item => ({ role: item.role === 'ai' ? 'model' : 'user', content: (item.kind === 'prompt' ? '【最终提示词】' : '') + item.text + (item.choices ? `\n（选项：${item.choices.join(' / ')}）` : '') }));
// A requirement the user stated in a cell that fits the whole report, offered for the report-wide prompt.
const reportRuleOf = reply => {
    const rule = reply?.report_rule || reply?.reportRule, item = String(rule?.item || '').trim();
    return item ? { reportRule: { section: String(rule.section || '').replace(/[【】]/g, '').trim().slice(0, 20) || '其他要求', item: item.slice(0, 300) } } : {};
};
const askResult = (reply, toolLog) => ({ type: 'ask', question: String(reply.question).slice(0, 2000), choices: (Array.isArray(reply.choices) ? reply.choices : []).slice(0, 6).map(String), tools: toolLog, ...reportRuleOf(reply) });

// A change the chat is about to apply is checked against every existing requirement first; a contradiction turns the
// reply into a question with clickable choices. Answers to such a question go through unchecked.
const CONFLICT_CHECK = `你检查“AI 月报”里用户新提的要求，和已有提示词里的要求是否冲突。
冲突指两者不能同时做到（如“目标线红色虚线”和“目标线蓝色实线”；“事故写本月起数并和目标比较”和“事故只写增量”）。只是补充、细化、或说的是不同的东西时不算冲突。
已有要求按层级给出：这一处的提示词、章节样式提示词、月报整体风格提示词、格子提示词。
只输出 JSON：
没有冲突：{"conflict":false}
有冲突：{"conflict":true,"question":"一两句话说明冲突，两边都引用原文，如：章节样式要求“目标线用红色虚线”，你这次说“目标线改成蓝色实线”，按哪个来？","choices":["以这次为准，替换原要求","保留原来的要求","只在这一处例外"]}
choices 2-4 个，每个不超过 20 个字，可以直接点选。`;
// Answering a question — a conflict question, or any option the AI just offered (clicked, perhaps with context
// appended) — is the user's decision, not a new requirement, so it is never checked for conflicts.
const answeringConflict = (chat, message = '') => {
    const last = [...(Array.isArray(chat) ? chat : [])].reverse().find(item => item?.role === 'ai');
    if (last?.kind !== 'ask') return false;
    const said = String(message || '').trim();
    return /冲突/.test(String(last.text || '')) || (Array.isArray(last.choices) && last.choices.some(choice => choice && said.startsWith(String(choice).trim())));
};
async function checkConflict(client, result, { message, chat, sides }) {
    if (result?.type !== 'ready' || answeringConflict(chat, message)) return result;
    const existing = sides.filter(([, text]) => String(text || '').trim()).map(([name, text]) => `【${name}】\n${String(text).slice(0, 5000)}`).join('\n\n');
    if (!existing) return result;
    try {
        const reply = parseReply((await client.generateChat({ systemInstruction: CONFLICT_CHECK, messages: [{ role: 'user', content: `用户这次的要求：${String(message).slice(0, 3000)}\n\n已有的要求：\n${existing}` }], maxOutputTokens: 800, temperature: 0 })).text);
        if (reply?.conflict === true && reply.question && Array.isArray(reply.choices) && reply.choices.length >= 2) return askResult({ question: reply.question, choices: reply.choices }, result.tools || []);
    } catch (error) { console.warn('[AI Report] conflict check skipped:', error.message); }
    return result;
}

// Runs the model with data tools until it gives a reply that `accept` takes; `accept` returns a result or a correction to send back.
async function runWithTools(client, { system, month, messages, accept, fallback, tools = true, context = {} }) {
    const toolLog = [], retries = [];
    for (let step = 0; step < MAX_TOOL_STEPS + 2; step++) {
        const result = await client.generateChat({ systemInstruction: system, messages, tools: tools && step < MAX_TOOL_STEPS ? TOOLS : undefined, maxOutputTokens: 8000, temperature: 0.2 });
        if (result.toolCalls?.length && step < MAX_TOOL_STEPS) {
            client = result.providerClient || client; // keep the provider that actually answered for the rest of the loop
            messages.push({ role: 'model', content: result.text || '', toolCalls: result.toolCalls });
            const toolResults = [];
            for (const call of result.toolCalls) {
                toolLog.push(call.name);
                try { toolResults.push({ id: call.id, name: call.name, content: JSON.stringify(await runTool(call, month, context)).slice(0, TOOL_RESULT_CHARS) }); }
                catch (error) { toolResults.push({ id: call.id, name: call.name, content: error.message, isError: true }); }
                const done = toolResults.at(-1);trace({ kind: 'tool', name: call.name, args: clip(call.args || {}), result: clip(done.content), ...(done.isError ? { error: done.content } : {}) });
            }
            messages.push({ role: 'tool', toolResults });
            continue;
        }
        const parsed = parseReplyDetailed(result.text);
        const outcome = await accept(parsed.value, toolLog);
        if (outcome.result) return outcome.result;
        const reason = parsed.error ? `JSON 无法解析（${parsed.error}）。请检查括号是否配对、代码字符串里的反斜杠和换行是否转义，重新输出完整 JSON。` : outcome.retry;
        retries.push(parsed.error ? `parse: ${parsed.error}` : outcome.retry.slice(0, 120));
        trace({ kind: 'retry', text: reason });
        messages.push({ role: 'model', content: result.text || '' }, { role: 'user', content: reason });
    }
    console.warn('[AI Report] gave up after', MAX_TOOL_STEPS + 2, 'steps:', JSON.stringify({ tools: toolLog, retries }));
    return { ...fallback, tools: toolLog };
}

// Conversation turn: answers data questions or asks; never compiles a recipe.
const styleLine = style => style ? `月报整体风格提示词（每个格子都要遵守：【风格与配色】决定样式、配色和语气；其它分类是每个格子生成内容时的通用要求，和默认做法冲突时以这里为准）：\n${style}` : '';

function cellTurn(client, { month, prompt, chat, message, style = '', outline = null }) {
    const context = [`报告月份：${month}`, prompt ? `这个格子当前的最终提示词：\n${prompt}` : '这个格子还没有最终提示词', styleLine(style)].filter(Boolean).join('\n');
    const messages = [{ role: 'user', content: context }, { role: 'model', content: '好的。' }, ...historyMessages(chat), { role: 'user', content: message }];
    return runWithTools(client, { system: CHAT_PROMPT, month, messages, context: { outline }, fallback: { type: 'answer', text: '抱歉，我这次没能整理出回答，请换个说法再试一次。' }, accept: (reply, toolLog) => {
        if (asksAboutConflict(reply)) return { retry: CONFLICT_RETRY };
        if (['answer', 'ready'].includes(reply?.type) && reply.text) return { result: { type: reply.type, text: String(reply.text).slice(0, 6000), tools: toolLog, ...reportRuleOf(reply) } };
        if (reply?.type === 'ask' && reply.question) return { result: askResult(reply, toolLog) };
        return { retry: '请只输出约定的 JSON 对象（type 为 answer、ask 或 ready）。' };
    } });
}

// Some models glue a keyword to a Chinese name (const回传 = …), which JS reads as one identifier; add the missing space.
const GLUED_KEYWORD = /\b(const|let|var|return|typeof|new|of|in|throw|await)(?=[\u3400-\u9fff\uf900-\ufaff])/g;
function tidyRecipe(recipe) {
    if (!recipe || typeof recipe !== 'object') return recipe;
    const tidy = code => typeof code === 'string' ? code.replace(GLUED_KEYWORD, '$1 ') : code;
    return { ...recipe, compute: tidy(recipe.compute), render: tidy(recipe.render) };
}

// Compiles the confirmed prompt; an error from a previous run is passed back so the model can fix it.
function compileTurn(client, { month, prompt, recipe, error, style = '', outline = null, previousPrompt = '' }) {
    // A working recipe from an earlier prompt is the base, so a small prompt change does not reroll the title or layout.
    const base = recipe && !error && previousPrompt && previousPrompt !== prompt ? `之前的提示词：\n${previousPrompt}\n\n按之前提示词做出、能正常运行的配方：${JSON.stringify(recipe).slice(0, 12000)}\n在这个配方基础上按提示词的变化修改：提示词没变的部分（标题、布局、配色、文字写法等）保持原样；提示词里有而这个配方还没做到的要求（例如要显示的标题）必须补上；数据来源换了时重新用工具查清新来源的准确名称。` : '';
    const content = [`报告月份：${month}`, `最终提示词：\n${prompt}`, styleLine(style), recipe && error ? `上一次的配方：${JSON.stringify(recipe).slice(0, 12000)}\n运行出错：${error}\n请修正。` : base].filter(Boolean).join('\n\n');
    return runWithTools(client, { system: COMPILE_PROMPT, month, messages: [{ role: 'user', content }], context: { outline }, fallback: { type: 'ask', question: '这个提示词我还没能编译成可运行的配方，能在对话里补充一下用哪张表、哪些列吗？', choices: [] }, accept: async (reply, toolLog) => {
        if (reply?.type === 'ask' && reply.question) return { result: askResult(reply, toolLog) };
        if (reply?.type === 'recipe') {
            let normalized;
            try { normalized = model.normalizeRecipe(tidyRecipe(reply.recipe)); }
            catch (problem) { return { retry: `配方无效：${problem.message}。请修正后只输出 JSON。` }; }
            // Made-up sources would only ever show "no data"; send them back while the model can still look them up.
            const unknown = await data.unknownSources(month, normalized.sources).catch(() => []);
            if (unknown.length) return { retry: `这些数据来源在系统里不存在：${unknown.join('；')}。不要编造 sourceKey、指标名称或数据集 id，只能用 list_sources、list_datasets 返回的值和 list_metrics 返回的指标名称；提示词里的名称可能和实际名称不同，请按含义在导入表、指标和数据集里查找。确实找不到就回复 ask 说明。` };
            return { result: { type: 'recipe', reply: String(reply.reply || '').slice(0, 2000), recipe: normalized, tools: toolLog } };
        }
        return { retry: '请只输出约定的 JSON 对象（type 为 recipe 或 ask）。' };
    } });
}

async function summarizePrompt(client, { month, prompt, chat, instruction = PROMPT_SUMMARY }) {
    const transcript = historyMessages(chat).map(item => `${item.role === 'user' ? '用户' : 'AI'}：${item.content}`).join('\n').slice(-30000);
    const content = [`报告月份：${month}`, prompt ? `之前的最终提示词：\n${prompt}` : '', `对话：\n${transcript}`].filter(Boolean).join('\n\n');
    const reply = parseReply((await client.generateChat({ systemInstruction: instruction, messages: [{ role: 'user', content }], maxOutputTokens: 2000, temperature: 0.2 })).text);
    if (!reply?.prompt) {
        const error = new Error('AI 没有返回有效的提示词，请再点一次');
        error.status = 502;
        throw error;
    }
    return String(reply.prompt).slice(0, 4000);
}

// The report outline the editor sends (chapters, cells, anchors, short summaries), kept small for the AI.
function reportOutline(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.chapters)) return null;
    const text = (item, size) => String(item ?? '').slice(0, size);
    const outline = { title: text(value.title, 200), chapters: value.chapters.slice(0, 40).map(chapter => ({ id: text(chapter?.id, 80), no: text(chapter?.no, 4), numbered: chapter?.numbered !== false, title: text(chapter?.title, 120), anchor: text(chapter?.anchor, 120), cells: (Array.isArray(chapter?.cells) ? chapter.cells : []).slice(0, 40).map(cell => ({ id: text(cell?.id, 80), anchor: text(cell?.anchor, 120), title: text(cell?.title, 80), ...(cell?.summary ? { summary: text(cell.summary, 200) } : {}) })) })) };
    return JSON.stringify(outline).length > 30000 ? null : outline;
}

router.post('/cell/chat', handle(async (req, res) => {
    const { month, prompt = '', chat = [], message = '' } = req.body || {};
    if (!model.validMonth(month)) return res.status(400).json({ error: 'A valid report month is required' });
    if (!String(message).trim()) return res.status(400).json({ error: '请输入要问的内容' });
    const client = await aiClient(), style = String(req.body.style || '').slice(0, 8000);
    const result = await cellTurn(client, { month, prompt: String(prompt).slice(0, 4000), chat, message: String(message).slice(0, 6000), style, outline: reportOutline(req.body.outline) });
    // “Keep the data, rename only” is a decision the user made, not a new requirement to check.
    res.json(req.body.decided === true ? result : await checkConflict(client, result, { message, chat, sides: [['这个格子的最终提示词', prompt], ['月报整体风格与章节样式提示词', style]] }));
}));

router.post('/cell/prompt', handle(async (req, res) => {
    const { month, prompt = '', chat = [] } = req.body || {};
    if (!model.validMonth(month)) return res.status(400).json({ error: 'A valid report month is required' });
    if (!model.cell({ chat }).chat.some(item => item.role === 'user')) return res.status(400).json({ error: '先在对话里说说这个格子要什么' });
    res.json({ prompt: await summarizePrompt(await aiClient(), { month, prompt: String(prompt).slice(0, 4000), chat }) });
}));

router.post('/cell/text-edit', handle(async (req, res) => {
    const { month, prompt = '', place = 'content', kind = '', before = '', after = '' } = req.body || {};
    if (!model.validMonth(month)) return res.status(400).json({ error: 'A valid report month is required' });
    if (!String(prompt).trim()) return res.status(400).json({ error: '这个格子还没有最终提示词' });
    if (String(before) === String(after)) return res.status(400).json({ error: '文字没有变化' });
    const text = value => String(value).slice(0, 3000);
    res.json(await textEditTurn(await aiClient(), { dataNames: (Array.isArray(req.body.dataNames) ? req.body.dataNames : []).slice(0, 60).map(name => String(name).slice(0, 200)), month, prompt: String(prompt).slice(0, 4000), place: place === 'narrative' ? 'narrative' : 'content', kind: String(kind).slice(0, 20), before: text(before), after: text(after) }));
}));

// One-line gists for cells that have no summary of their own, so an overview can quote every cell.
const GIST_PROMPT = '你为月报里没有文字总结的格子各写一句要点（20-60 字），给本月总览引用。只能根据给定的计算结果，不编造数字；有未达标、异常或变化大的情况优先写出来；结果为空或看不出要点时写空字符串。只输出 JSON：{"gists":{"格子 id":"一句要点"}}';
router.post('/cell/gist', handle(async (req, res) => {
    const { month, lang = 'zh', items = [] } = req.body || {};
    if (!model.validMonth(month)) return res.status(400).json({ error: 'A valid report month is required' });
    const list = (Array.isArray(items) ? items : []).slice(0, 40).map(item => ({ id: String(item?.id || '').slice(0, 80), title: String(item?.title || '').slice(0, 80), prompt: String(item?.prompt || '').slice(0, 600), result: item?.result ?? null })).filter(item => item.id);
    if (!list.length) return res.json({ gists: {} });
    const content = `报告月份：${month}\n语言：${lang === 'en' ? 'English' : '中文'}\n格子：${JSON.stringify(list).slice(0, 40000)}`;
    const reply = parseReply((await (await aiClient()).generateChat({ systemInstruction: GIST_PROMPT, messages: [{ role: 'user', content }], maxOutputTokens: 3000, temperature: 0.2 })).text);
    const gists = {};
    for (const item of list) { const text = String(reply?.gists?.[item.id] || '').trim(); if (text) gists[item.id] = text.slice(0, 300); }
    res.json({ gists });
}));

router.post('/cell/compile', handle(async (req, res) => {
    const { month, prompt = '', recipe = null, error = '' } = req.body || {};
    if (!model.validMonth(month)) return res.status(400).json({ error: 'A valid report month is required' });
    if (!String(prompt).trim()) return res.status(400).json({ error: '还没有最终提示词' });
    res.json(await compileTurn(await aiClient(), { month, prompt: String(prompt).slice(0, 4000), recipe, error: String(error).slice(0, 2000), previousPrompt: String(req.body.previousPrompt || '').slice(0, 4000), style: String(req.body.style || '').slice(0, 8000), outline: reportOutline(req.body.outline) }));
}));

const STYLE_CHAT_PROMPT = `你是“AI 月报”的整体风格顾问，维护“月报整体风格提示词”。它按分类分条写：【风格与配色】是主题、色调、配色、图表风格、文字语气；其它分类（如【数据与计算】【文字与结论】【排版与图表】）是每个格子生成内容时都要遵守的通用要求，每条一行、以“- ”开头。
你和用户讨论怎么增加、删除、修改这些条目，或调整风格。它不改变月报的骨架：不增删章节或格子。
${CONFLICT_RULE}
  对整体风格来说，还要检查和各章节样式提示词是否冲突（章节样式在样式上优先于整体风格）：冲突时同样先问，选项如“整体为准，同步改章节样式”“章节保持各自的样式”。
- 用户说清楚了要加、删、改哪一条（或想要的风格）时，回复 ready，用一两句话复述将要做的改动（说明是哪个分类的哪一条）。
- 用户的想法不清楚时提问，并给出 2-5 个具体选项；用户问建议时给出具体建议（颜色可以用名称加色值）。
- 用户问现在有哪些要求时，按分类简要列出。
- text 和 question 里不要用 Markdown 符号（如 ** 或 #）。
最终回复只能是一个 JSON 对象，三选一：
{"type":"answer","text":"回答"}
{"type":"ask","question":"要问用户的问题","choices":["选项1","选项2"]}
{"type":"ready","text":"一两句话复述要应用的风格"}`;

const STYLE_SUMMARY = `把下面对话里用户确认的修改，总结成“月报整体风格提示词”的修改清单。不要重写整份提示词，只列出要改的条目，其余条目由系统原样保留。
只输出 JSON：{"changes":[...]}，每一项是以下之一：
{"action":"add","section":"分类名（不带【】，例如 排版与图表；需要新分类时写新的分类名）","item":"新条目，完整的一句话"}
{"action":"remove","item":"要删除的条目原文（从当前提示词里逐字照抄那一条，不带开头的“- ”）"}
{"action":"replace","item":"要修改的条目原文（逐字照抄）","to":"修改后的完整一句话"}
风格的变化（主题、色调、配色、图表风格、语气）同样作用在“风格与配色”分类上：默认风格那一条被新风格取代时用 replace，补充风格时用 add。
对话里没有确认的修改不要列；用户没有要求修改时输出 {"changes":[]}。`;

// Chat edits to the report prompt come back as a list of changes applied item by item, so untouched items keep
// their exact words; a full text from the model is accepted as a fallback.
async function reviseStyle(client, { prompt, chat }) {
    const current = model.structuredStyle(prompt);
    const transcript = historyMessages(chat).map(item => `${item.role === 'user' ? '用户' : 'AI'}：${item.content}`).join('\n').slice(-20000);
    const messages = [{ role: 'user', content: `当前的月报整体风格提示词：\n${current}\n\n对话：\n${transcript}` }];
    for (let attempt = 0; attempt < 2; attempt++) {
        const result = await client.generateChat({ systemInstruction: STYLE_SUMMARY, messages, maxOutputTokens: 2000, temperature: 0.1 });
        const reply = parseReply(result.text);
        if (Array.isArray(reply?.changes)) {
            const { prompt: next, skipped } = model.applyStyleChanges(current, reply.changes);
            if (skipped.length) console.warn('[AI Report] style changes not matched:', JSON.stringify(skipped).slice(0, 500));
            return next;
        }
        if (reply?.prompt) return /^【[^】\n]+】/m.test(reply.prompt) ? String(reply.prompt).trim() : model.withStyleText(current, reply.prompt);
        messages.push({ role: 'model', content: result.text || '' }, { role: 'user', content: '请只输出约定的 JSON 对象：{"changes":[...]}。' });
    }
    const error = new Error('AI 没有返回有效的修改，请再点一次');
    error.status = 502;
    throw error;
}

const THEME_PROMPT = `根据月报整体风格提示词中【风格与配色】部分（其它分类是内容要求，不影响主题），给出月报的主题配置。只输出 JSON：
{"reply":"一句话说明这套主题本身，例如：深蓝主色、蓝青图表色、无衬线字体、小圆角","theme":{"accent":"#主色","accentSoft":"#很浅的主色背景","heading":"#标题文字色","surface":"#格子底色（很浅或白）","palette":["#图表色1","#图表色2","#图表色3","#图表色4","#图表色5","#图表色6"],"font":"sans 或 serif","radius":0到16的圆角,"frame":"double 或 single 或 none","frameColor":"#边框色","dividers":"line 或 dashed 或 none","dividerColor":"#分隔线色","panels":"box 或 none"}}
颜色都用 6 位十六进制。保证文字与底色对比清晰，图表色彼此容易区分。
frame 是月报四周的边框：double 为外粗内细的双线，single 为单线，none 为不要边框。dividers 是格子之间的分隔：line 为细实线，dashed 为虚线，none 为不要分隔线（格子用卡片样式）。panels 是不显示标题的章节（快速导航、本月概述这类）的样式：box 为浅色细线框围成的面板，none 为不加框。风格里没有提到边框或分隔线时，frame 用 double、dividers 用 line；没提到面板时 panels 用 box；边框色一般用标题色或主色，分隔线色用浅灰或很浅的主色。`;

function styleTurn(client, { prompt, chat, message, chapters = [] }) {
    const chapterStyles = chapters.filter(item => item.style).map(item => `「${item.title}」章节样式提示词：\n${item.style}`).join('\n\n');
    const messages = [{ role: 'user', content: [prompt ? `当前的月报整体风格提示词：\n${prompt}` : '这份月报还没有整体风格提示词', chapterStyles].filter(Boolean).join('\n\n') }, { role: 'model', content: '好的。' }, ...historyMessages(chat), { role: 'user', content: message }];
    return runWithTools(client, { system: STYLE_CHAT_PROMPT, month: '', messages, fallback: { type: 'answer', text: '抱歉，我这次没能整理出回答，请换个说法再试一次。' }, accept: (reply, toolLog) => {
        if (asksAboutConflict(reply)) return { retry: CONFLICT_RETRY };
        if (['answer', 'ready'].includes(reply?.type) && reply.text) return { result: { type: reply.type, text: String(reply.text).slice(0, 6000), tools: toolLog } };
        if (reply?.type === 'ask' && reply.question) return { result: askResult(reply, toolLog) };
        return { retry: '请只输出约定的 JSON 对象（type 为 answer、ask 或 ready）。' };
    }, tools: false });
}

async function compileTheme(client, { prompt }) {
    const reply = parseReply((await client.generateChat({ systemInstruction: THEME_PROMPT, messages: [{ role: 'user', content: prompt }], maxOutputTokens: 1200, temperature: 0.2 })).text);
    const theme = model.normalizeTheme(reply?.theme);
    if (!theme || !theme.palette.length) {
        const error = new Error('AI 没有返回有效的主题配色，请再试一次');
        error.status = 502;
        throw error;
    }
    return { reply: String(reply.reply || '').slice(0, 1000), theme };
}

router.post('/report/chat', handle(async (req, res) => {
    const { prompt = '', chat = [], message = '' } = req.body || {};
    if (!String(message).trim()) return res.status(400).json({ error: '请输入要问的内容' });
    const chapters = (Array.isArray(req.body.chapters) ? req.body.chapters : []).slice(0, 40).map(item => ({ title: String(item?.title || '').slice(0, 120), style: String(item?.style || '').slice(0, 2000) }));
    const client = await aiClient(), result = await styleTurn(client, { prompt: String(prompt).slice(0, 4000), chat, message: String(message).slice(0, 6000), chapters });
    res.json(await checkConflict(client, result, { message, chat, sides: [['月报整体风格提示词', prompt], ['各章节样式提示词', chapters.filter(item => item.style).map(item => `「${item.title}」${item.style}`).join('\n')]] }));
}));
router.post('/report/prompt', handle(async (req, res) => {
    const { prompt = '', chat = [] } = req.body || {};
    if (!model.cell({ chat }).chat.some(item => item.role === 'user')) return res.status(400).json({ error: '先在对话里说说想改的风格或通用要求' });
    res.json({ prompt: (await reviseStyle(await aiClient(), { prompt: String(prompt).slice(0, 4000), chat })).slice(0, 4000) });
}));
router.post('/report/theme', handle(async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: '还没有整体风格提示词' });
    res.json(await compileTheme(await aiClient(), { prompt: prompt.slice(0, 4000) }));
}));

// Summary sentences are written from computed results only, in both report languages.
// Chapter style: one prompt that unifies how a chapter's cells look. Applying it rewrites each cell's render only;
// sources and compute are put back exactly as they were, so the numbers cannot change.
const CHAPTER_CHAT_PROMPT = `你是“AI 月报”的章节样式顾问，维护某个章节的“章节样式提示词”。它只用来统一这个章节里各个格子的样式和风格：标题样式、字号、配色、图表类型与样式（柱宽、数值标签、目标线、图例、坐标轴）、排版与布局、文字总结的位置、长度和语气等。
它绝不改变任何格子的数据来源、筛选口径和计算方法，也不增删格子。用户提到改数据、换指标、改计算时，说明这里只管样式，请到对应格子的对话里改。
${CONFLICT_RULE}
  对章节样式来说，还要检查和章节里各格子提示词中的样式要求、月报整体风格提示词是否冲突（章节样式会覆盖它们的样式部分）：冲突时先问，选项如“章节为准，覆盖格子里的写法”“保留格子各自的写法”。
- 用户说清楚了想要的样式时，回复 ready，用一两句话复述将要统一的样式。
- 用户的想法不清楚，或只说“不好看”“不统一”时，结合给出的格子情况提问，给出 2-5 个具体选项。
- 用户问建议时，看看这些格子现在的差异（标题、图表、目标线、总结写法等），给出具体的统一建议。
- text 和 question 里不要用 Markdown 符号（如 ** 或 #）。
最终回复只能是一个 JSON 对象，三选一：
{"type":"answer","text":"回答"}
{"type":"ask","question":"要问用户的问题","choices":["选项1","选项2"]}
{"type":"ready","text":"一两句话复述要统一的样式"}`;

const CHAPTER_SUMMARY = `把下面对话里用户确认的样式要求，整理成这个章节的“章节样式提示词”：每条一行、以“- ”开头，写成每个格子都能照做的通用样式要求（标题、配色、图表样式、排版、文字总结的位置与写法等）。
如果之前已有章节样式提示词，在它基础上按对话修改：保留没提到的条目，替换冲突的条目，删除用户要求去掉的条目。
不能写任何数据来源、指标、筛选或计算方面的要求；不要写具体某个格子的名称或数字。
只输出 JSON：{"prompt":"章节样式提示词"}`;

function chapterTurn(client, { prompt, chat, message, style = '', cells = [] }) {
    const list = cells.map((cell, index) => `${index + 1}. ${cell.title || '（无标题）'}：${cell.prompt}`).join('\n');
    const context = [prompt ? `当前的章节样式提示词：\n${prompt}` : '这个章节还没有章节样式提示词', list ? `这个章节里已生成的格子：\n${list}` : '这个章节里还没有生成好的格子', styleLine(style)].filter(Boolean).join('\n\n');
    const messages = [{ role: 'user', content: context }, { role: 'model', content: '好的。' }, ...historyMessages(chat), { role: 'user', content: message }];
    return runWithTools(client, { system: CHAPTER_CHAT_PROMPT, month: '', messages, fallback: { type: 'answer', text: '抱歉，我这次没能整理出回答，请换个说法再试一次。' }, accept: (reply, toolLog) => {
        if (asksAboutConflict(reply)) return { retry: CONFLICT_RETRY };
        if (['answer', 'ready'].includes(reply?.type) && reply.text) return { result: { type: reply.type, text: String(reply.text).slice(0, 6000), tools: toolLog } };
        if (reply?.type === 'ask' && reply.question) return { result: askResult(reply, toolLog) };
        return { retry: '请只输出约定的 JSON 对象（type 为 answer、ask 或 ready）。' };
    }, tools: false });
}

router.post('/chapter/chat', handle(async (req, res) => {
    const { prompt = '', chat = [], message = '', cells = [] } = req.body || {};
    if (!String(message).trim()) return res.status(400).json({ error: '请输入要问的内容' });
    const notes = (Array.isArray(cells) ? cells : []).slice(0, 40).map(cell => ({ title: String(cell?.title || '').slice(0, 80), prompt: String(cell?.prompt || '').slice(0, 300) }));
    const client = await aiClient(), style = String(req.body.style || '').slice(0, 4000);
    const result = await chapterTurn(client, { prompt: String(prompt).slice(0, 4000), chat, message: String(message).slice(0, 6000), style, cells: notes });
    res.json(await checkConflict(client, result, { message, chat, sides: [['这个章节的样式提示词', prompt], ['月报整体风格提示词', style], ['章节里各格子的提示词', notes.map(cell => `${cell.title}：${cell.prompt}`).join('\n')]] }));
}));
router.post('/chapter/prompt', handle(async (req, res) => {
    const { prompt = '', chat = [] } = req.body || {};
    if (!model.cell({ chat }).chat.some(item => item.role === 'user')) return res.status(400).json({ error: '先在对话里说说这个章节要统一的样式' });
    res.json({ prompt: await summarizePrompt(await aiClient(), { month: '', prompt: String(prompt).slice(0, 4000), chat, instruction: CHAPTER_SUMMARY }) });
}));

const RESTYLE_TASK = `这是一次章节样式统一，不是重新做格子：
- 下面给出这个格子当前能正常运行的配方。sources 和 compute 必须逐字照抄（系统也会强制换回原样），只修改 render，让展示符合【本章节样式要求】。
- render 只能读取 compute 已经返回的字段，不能新增需要计算的数字；格子最终提示词里关于数据、口径、计算和要显示哪些内容的要求保持不变。
- 样式方面（标题样式、配色、图表样式、排版、文字总结的位置和写法）和最终提示词冲突时，以【本章节样式要求】为准；最终提示词要求显示的标题文字照样显示。
- narrative 不为 null 时可以按章节样式调整总结的写法要求，但总结依据的数据不变；原来为 null 的保持 null。`;

router.post('/cell/restyle', handle(async (req, res) => {
    const { month, prompt = '', recipe = null, attempt = null, error = '' } = req.body || {};
    if (!model.validMonth(month)) return res.status(400).json({ error: 'A valid report month is required' });
    if (!String(prompt).trim() || !recipe) return res.status(400).json({ error: '这个格子还没有生成过' });
    const original = model.normalizeRecipe(recipe), style = String(req.body.style || '').slice(0, 8000);
    const content = [`报告月份：${month}`, `最终提示词：\n${String(prompt).slice(0, 4000)}`, styleLine(style), RESTYLE_TASK, `当前配方：${JSON.stringify(original).slice(0, 14000)}`, attempt && error ? `上一次改出来的配方：${JSON.stringify(attempt).slice(0, 12000)}\n运行出错：${String(error).slice(0, 2000)}\n请修正（仍然只改 render）。` : ''].filter(Boolean).join('\n\n');
    const reply = await runWithTools(await aiClient(), { system: COMPILE_PROMPT, month, messages: [{ role: 'user', content }], tools: false, fallback: null, accept: async (value) => {
        if (value?.type !== 'recipe') return { retry: '请只输出 {"type":"recipe","reply":"…","recipe":{…}}，sources 和 compute 照抄，只改 render。' };
        let normalized;
        try { normalized = model.normalizeRecipe(tidyRecipe({ ...value.recipe, sources: original.sources, compute: original.compute })); }
        catch (problem) { return { retry: `配方无效：${problem.message}。请修正后只输出 JSON。` }; }
        // Data stays the cell's own: whatever came back, sources and compute are the original ones.
        return { result: { type: 'recipe', reply: String(value.reply || '').slice(0, 2000), recipe: { ...normalized, sources: original.sources, compute: original.compute, ...(original.narrative ? {} : { narrative: null }) } } };
    } });
    if (reply?.type !== 'recipe') { const failure = new Error('AI 没能按章节样式改好这个格子'); failure.status = 502; throw failure; }
    res.json(reply);
}));

router.post('/cell/narrative', handle(async (req, res) => {
    const { month, prompt = '', recipe, result } = req.body || {};
    if (!model.validMonth(month)) return res.status(400).json({ error: 'A valid report month is required' });
    const normalized = model.normalizeRecipe(recipe);
    const client = await aiClient();
    const { toolContext } = await data.recipeInput(month, normalized.sources.filter(source => source.kind === 'tool'));
    const instruction = '你为月报格子写总结。只能使用给定的计算结果和资料，不要编造数字。格子需求要求突出、加粗或标色关键数字时，用 **…** 包住要突出的数字或词（每段最多 4 处），平台会显示为加粗主题色；总结是纯文字，不能写 HTML 标签、颜色或样式（要求标红时也只用 **…**）。只写数据能证明的事实：数据里没有的原因（如“进度滞后”“更新不及时”）不能推测或编造，需要说明原因时只能点名数据里未达标的运营商和数值。格子需求里对总结写法的要求（格式、措辞、替换规则、不要写的内容）必须遵守，优先于总结要求。输出 JSON：{"zh":"中文 1-3 句","en":"English 1-3 sentences"}，不要输出其它内容。';
    const content = [`报告月份：${month}`, `格子需求：${prompt}`, styleLine(String(req.body.style || '').slice(0, 8000)), `总结要求：${normalized.narrative?.prompt || '概括本月要点'}`, `计算结果：${JSON.stringify(result ?? null).slice(0, 20000)}`, toolContext ? `其他工具资料：\n${toolContext}` : ''].filter(Boolean).join('\n');
    const reply = parseReply((await client.generateChat({ systemInstruction: instruction, messages: [{ role: 'user', content }], maxOutputTokens: 1200, temperature: 0.3 })).text);
    if (!reply?.zh) return res.status(502).json({ error: 'AI 没有返回有效的总结' });
    // The summary shows as text: tags such as <span style=…> would appear literally, so only their words are kept.
    const plain = text => String(text || '').replace(/<\/?[a-z][^<>]{0,300}>/gi, '').slice(0, 2000);
    res.json({ zh: plain(reply.zh), en: plain(reply.en) });
}));

// Header fields as prompt engineering: one field's text written from its prompt, with the dates already worked out so
// the model never has to do month arithmetic, and the report outline (chapters, cells and their conclusions).
const FIELD_PROMPT = `你为月报开头的一个字段（如部门、报告时间、数据月份、报告目标、标题）按“字段提示词”写出文字。
- 只输出这个字段本身的文字，不加字段名、引号、解释或 Markdown；不要写 HTML。
- 日期、月份一律用下面“日期信息”里给出的值，不要自己推算。
- 需要概括月报内容时，只能用“月报大纲”里的章节和各格子结论，不编造数字和原因。
- 提示词要求保持某种格式、长度或措辞时严格遵守；没有要求时保持和“当前文字”相同的风格和长度。
只输出 JSON：{"zh":"中文文字","en":"English text"}`;
function monthFacts(month) {
    const [year, number] = month.split('-').map(Number), shift = offset => { const date = new Date(Date.UTC(year, number - 1 + offset, 1)); return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1 }; };
    const forms = ({ y, m }) => `${y}-${String(m).padStart(2, '0')}（也可写成 ${y}${String(m).padStart(2, '0')}、${y}年${m}月、${y}/${m}）`;
    const today = new Date();
    return [`报告月份：${forms({ y: year, m: number })}`, `上个月：${forms(shift(-1))}`, `下个月：${forms(shift(1))}`, `今天：${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`].join('\n');
}
router.post('/template/field', handle(async (req, res) => {
    const { month, label = '', prompt = '', current = {}, title = '' } = req.body || {};
    if (!model.validMonth(month)) return res.status(400).json({ error: 'A valid report month is required' });
    if (!String(prompt).trim()) return res.status(400).json({ error: '这个字段还没有提示词' });
    const outline = reportOutline(req.body.outline);
    const content = [`字段：${String(label).slice(0, 80) || '（未命名）'}`, `字段提示词：\n${String(prompt).slice(0, 2000)}`, `当前文字：\n中文：${String(current?.zh || '').slice(0, 2000)}\nEnglish：${String(current?.en || '').slice(0, 2000)}`, `日期信息：\n${monthFacts(month)}`, `月报标题：${String(title).slice(0, 200)}`, outline ? `月报大纲：${JSON.stringify(outline).slice(0, 20000)}` : ''].filter(Boolean).join('\n\n');
    const reply = parseReply((await (await aiClient()).generateChat({ systemInstruction: FIELD_PROMPT, messages: [{ role: 'user', content }], maxOutputTokens: 1500, temperature: 0.2 })).text);
    if (!reply?.zh) return res.status(502).json({ error: 'AI 没有返回这个字段的文字，请再试一次' });
    const plain = text => String(text || '').replace(/<\/?[a-z][^<>]{0,300}>/gi, '').trim().slice(0, 2000);
    res.json({ zh: plain(reply.zh), en: plain(reply.en) || plain(reply.zh) });
}));

// Field conversation: the user and the AI settle how one header field is written; the result is the field prompt
// (fixed text, or instructions the AI follows every month with the dates already worked out).
const FIELD_CHAT_PROMPT = `你是“AI 月报”的开头字段助手，和用户讨论月报开头某一个字段（如部门、报告时间、数据月份、报告目标、标题、页脚）的文字怎么写。
字段文字由“字段提示词”决定：以“固定文字：”开头时原样显示，不调用 AI；其它写法每次换报告月份或刷新时，由 AI 按提示词重新生成，生成时能用到：报告月份及上下月（平台已算好各种写法）、今天日期、月报标题、各章节格子的结论。
- 用户问现在怎么写、能怎么写时，结合当前提示词和当前文字直接回答，给出具体建议。
- 用户想要一段不变的文字时，复述这段文字；想让它每月自动变化时，帮他说清楚：依据什么写、格式、长度、语气。不清楚就提问，并给出 2-5 个具体选项。
- 需求已经清楚时回复 ready，用一两句话复述将要怎么写这个字段；系统会自动生成字段提示词并写进月报开头。
- text 和 question 里不要用 Markdown 符号（如 ** 或 #）。
${CONFLICT_RULE}
最终回复只能是一个 JSON 对象，三选一：
{"type":"answer","text":"回答"}
{"type":"ask","question":"要问用户的问题","choices":["选项1","选项2"]}
{"type":"ready","text":"一两句话复述要怎么写这个字段"}`;
const FIELD_SUMMARY = `把下面关于月报开头一个字段的对话，总结成这个字段的“字段提示词”。
- 用户要的是一段固定不变的文字时，写成“固定文字：”后面紧跟这段文字（原样，不加引号）。
- 否则写成给 AI 的生成要求：依据什么写（报告月份、上下月、各章节格子的结论等）、格式、长度、语气，一到四句；日期写成“报告月份的下一个月”这类相对说法，不写死具体年月。
- 如果之前已有字段提示词，在它基础上按对话修改；只依据对话里用户确认过的内容。
只输出 JSON：{"prompt":"字段提示词"}`;
router.post('/template/field/chat', handle(async (req, res) => {
    const { month, label = '', prompt = '', chat = [], message = '', current = {} } = req.body || {};
    if (!String(message).trim()) return res.status(400).json({ error: '请输入要问的内容' });
    const client = await aiClient(), style = String(req.body.style || '').slice(0, 4000);
    const context = [`字段：${String(label).slice(0, 80)}`, prompt ? `当前的字段提示词：\n${String(prompt).slice(0, 2000)}` : '这个字段还没有提示词（目前是手写的固定文字）', `当前文字：\n中文：${String(current?.zh || '').slice(0, 2000)}\nEnglish：${String(current?.en || '').slice(0, 1000)}`, model.validMonth(month) ? `日期信息：\n${monthFacts(month)}` : '', styleLine(style)].filter(Boolean).join('\n\n');
    const messages = [{ role: 'user', content: context }, { role: 'model', content: '好的。' }, ...historyMessages(chat), { role: 'user', content: String(message).slice(0, 6000) }];
    const result = await runWithTools(client, { system: FIELD_CHAT_PROMPT, month: '', messages, tools: false, fallback: { type: 'answer', text: '抱歉，我这次没能整理出回答，请换个说法再试一次。' }, accept: (reply, toolLog) => {
        if (asksAboutConflict(reply)) return { retry: CONFLICT_RETRY };
        if (['answer', 'ready'].includes(reply?.type) && reply.text) return { result: { type: reply.type, text: String(reply.text).slice(0, 6000), tools: toolLog } };
        if (reply?.type === 'ask' && reply.question) return { result: askResult(reply, toolLog) };
        return { retry: '请只输出约定的 JSON 对象（type 为 answer、ask 或 ready）。' };
    } });
    res.json(await checkConflict(client, result, { message, chat, sides: [['这个字段的提示词', prompt], ['月报整体风格提示词', style]] }));
}));
router.post('/template/field/prompt', handle(async (req, res) => {
    const { month, prompt = '', chat = [] } = req.body || {};
    if (!model.cell({ chat }).chat.some(item => item.role === 'user')) return res.status(400).json({ error: '先在对话里说说这个字段想怎么写' });
    res.json({ prompt: await summarizePrompt(await aiClient(), { month: model.validMonth(month) ? month : '', prompt: String(prompt).slice(0, 2000), chat, instruction: FIELD_SUMMARY }) });
}));

// Image conversation (the logo now, pictures in cells later): upload, pick from history, resize, or have the AI draw a
// new one. The AI draws SVG vector images with the text model, following the slot's built-in base prompt.
// The bytes of an image the report shows (its own store, an older monthly logo, or a bundled asset), for the AI to see.
async function imageBytesOf(url) {
    const value = String(url || '');
    try {
        let match = value.match(/^\/api\/ai-report\/images\/([-\w]{1,80})$/);
        if (match) { const image = await images.read(match[1]); return { mime: image.mime, bytes: Buffer.from(image.bytes) }; }
        match = value.match(/^\/api\/upload\/monthly-logos\/([-\w%]{1,120})\/image$/);
        if (match) { const logo = await require('../models/import-source-repository').getLogo(decodeURIComponent(match[1])); return logo ? { mime: 'image/png', bytes: Buffer.from(logo.image_blob) } : null; }
        match = value.match(/^\/assets\/([-\w./]{1,200})$/);
        if (match && !match[1].includes('..')) { const runtime = require('../models/platform-logo-runtime'), file = runtime.ASSET_NAMES.has(match[1]) ? runtime.resolveLogoAsset(match[1]) : require('node:path').join(__dirname, '../../frontend/assets', match[1]); const bytes = require('node:fs').readFileSync(file); return { mime: /\.svg$/i.test(file) ? 'image/svg+xml' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png', bytes }; }
    } catch (_) { /* an image that cannot be read is simply not shown to the AI */ }
    return null;
}
// What the AI can see of the current image: the picture itself for raster images, the source for SVG.
async function currentImageForAi(url) {
    const image = await imageBytesOf(url);
    if (!image || image.bytes.length > 7 * 1024 * 1024) return { images: [], note: '' };
    if (image.mime === 'image/svg+xml') return { images: [], note: `当前图片是 SVG，源码：\n${image.bytes.toString('utf8').slice(0, 6000)}` };
    return { images: [{ mimeType: image.mime, data: image.bytes.toString('base64') }], note: '' };
}

const imageLibrary = require('../models/ai-report-image-library');
const imageSelection = require('../models/ai-report-image-selection');
router.get('/images', handle(async (req, res) => {
    const list=await imageLibrary.list();
    res.setHeader('Cache-Control','no-store');
    res.json(req.query.page!==undefined||req.query.page_size!==undefined?imageLibrary.page(list,req.query.page,req.query.page_size):list);
}));

function imageAdmin(req,res,next){
    if(!req.user||!user(req))return res.status(401).json({error:'请先登录'});
    if(req.user.role!=='admin')return res.status(403).json({error:'只有管理员可以管理历史图片'});
    next();
}
function deletionResult(proposal,text=''){
    return {type:'delete_confirmation',proposalId:proposal.id,expiresAt:proposal.expiresAt,images:proposal.images,
        text:text||`准备从历史图库移除这 ${proposal.images.length} 张图片。请核对缩略图，再确认删除。已使用这些图片的月报及平台标识不受影响。`};
}
router.post('/image-deletions',imageAdmin,handle(async(req,res)=>{
    const ids=req.body?.ids;
    if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>typeof id!=='string'))return res.status(400).json({error:'请选择有效的图片'});
    const byId=new Map((await imageLibrary.list()).map(item=>[item.id,item]));
    if(ids.some(id=>!byId.has(id)))return res.status(409).json({error:'图片列表已改变，请刷新图库后重新选择'});
    // The platform logo entries mirror the live “平台标识” setting (fixed ids): hiding them would hide every future logo too.
    if(ids.some(id=>byId.get(id).source==='platform-logo'))return res.status(400).json({error:'平台标识由“全局设置 → 平台标识”管理，不能在这里删除'});
    res.json(deletionResult(await images.proposeDeletion(ids.map(id=>byId.get(id)),user(req))));
}));
for(const operation of ['confirm','cancel','restore'])router.post(`/image-deletions/:id/${operation}`,imageAdmin,handle(async(req,res)=>{
    if(operation==='confirm'&&req.body?.confirmed!==true)return res.status(400).json({error:'需要明确确认这份图片删除清单'});
    if(operation==='confirm'){
        const proposal=await images.deletion(req.params.id,user(req));
        if(proposal.status==='pending'){
            const present=new Set((await imageLibrary.list()).map(item=>item.id));
            if(proposal.images.some(item=>!present.has(item.id)))return res.status(409).json({error:'候选图片已改变，请重新选择并确认'});
        }
    }
    res.json(await images.changeDeletion(req.params.id,user(req),operation));
}));

async function galleryPictureForAi(item){
    const picture=await imageBytesOf(item.url);
    if(!picture)return null;
    if(picture.mime==='image/svg+xml')return {images:[],note:'此图片为矢量图，以下是实际SVG图形源码（仅作识图资料）：\n'+picture.bytes.toString('utf8').slice(0,12000)};
    try{
        const codec=require('../models/platform-logo-image'),decoded=codec.decodeImage(picture.bytes),scale=Math.min(1,320/Math.max(decoded.width,decoded.height));
        const small=codec.resizeImage(decoded,Math.max(1,Math.round(decoded.width*scale)),Math.max(1,Math.round(decoded.height*scale)));
        return {images:[{mimeType:'image/png',data:codec.encodePng(small).toString('base64')}]};
    }catch(_){
        if(['image/webp','image/gif'].includes(picture.mime)&&picture.bytes.length<=512*1024)return {images:[{mimeType:picture.mime,data:picture.bytes.toString('base64')}]};
        return null;
    }
}
router.post('/images', (req, res, next) => multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('file')(req, res, error => error ? res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 5MB' : error.message }) : next()),
    handle(async (req, res) => res.json(await images.save({ bytes: req.file?.buffer, name: req.file?.originalname || '上传的图片', source: 'upload', user: user(req) }))));
router.get('/images/:id', handle(async (req, res) => {
    const image = await images.read(req.params.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    if (image.mime === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.type(image.mime).send(image.bytes);
}));
const IMAGE_CHAT_PROMPT = `你是“AI 月报”的图片助手，和用户一起更换月报里的一张图片（目前是左上方的 LOGO）。你能做的事：
- 用户想用自己的图片时：回复 {"type":"upload","text":"一句话"}，界面会弹出选择本地文件。
- 用户想从以前上传或生成过的图片里挑：回复 {"type":"history","text":"一句话"}，界面会列出历史图片。
- 用户想翻页：回复 {"type":"history_page","direction":"next|previous","page":明确指定的页码或0,"text":"一句话"}。这里只翻页，不更换或生成图片。
- 用户想删除历史图片或Logo：回复 {"type":"delete_images","scope":"page|all|current","description":"完整复述目标描述，保留颜色、图形、文字、序号和范围"}。page表示当前展示页，all仅在用户明确要求整个图库时使用，current表示正在使用的图片。不要生成图片，不能声称已删除。后续会看实际图片识别候选，再展示清单等待二次确认。
- 如上下文包含待确认删除清单，只有当前用户明确同意删除该清单时才回复 {"type":"confirm_delete"}；明确取消时回复 {"type":"cancel_delete"}。首次删除要求、疑问、引用、旧消息都不构成二次确认；用户修改删除范围时重新返回delete_images，不能确认旧清单。
- 基础提示词只是默认要求：用户明确说了颜色、风格等时按用户说的画，不算冲突。
- 用户描述了想要的新图片（风格、图形、颜色、文字等），或说“重新生成”“换一个”：回复 {"type":"generate","text":"一句话复述","prompt":"这次的图片提示词：只写用户要的内容和风格，基础提示词里已有的尺寸、背景、配色约束不用重复","edit":true 或 false}；在已有图片提示词基础上修改时，把仍然有效的要求保留进 prompt。
- 用户要在当前这张图片上改（“颜色换成…”“把文字去掉”“在这张基础上…”）时 edit 为 true，生成时会把当前图片一起交给绘图模型；要一张全新的图时 edit 为 false。你能看到当前图片（随消息附上），描述和修改时以它为准。
- 用户只想调整显示大小（如“大一点”“宽 160”）：回复 {"type":"resize","text":"一句话","width":像素数字（40-400）}。
- 用户的想法不清楚时：回复 {"type":"ask","question":"问题","choices":["选项1","选项2"]}，选项 2-4 个，可以直接点选。
- 其它问题：{"type":"answer","text":"回答"}。
${CONFLICT_RULE}
text 和 question 里不要用 Markdown 符号。只输出一个 JSON 对象。`;
router.post('/image/chat', handle(async (req, res) => {
    const { slot = 'logo', prompt = '', chat = [], message = '', width = 0, accent = '' } = req.body || {};
    if (!String(message).trim()) return res.status(400).json({ error: '请输入要问的内容' });
    const base = model.IMAGE_BASE[slot] || model.IMAGE_BASE.logo;
    const context = [`图片位置：${slot === 'logo' ? '月报左上方 LOGO' : slot}`, `基础提示词（平台自带，生成时总会遵守）：\n${base}`, prompt ? `当前的图片提示词：\n${String(prompt).slice(0, 2000)}` : '当前图片不是 AI 生成的，还没有图片提示词', `当前显示宽度：${Number(width) || 120}px`, accent ? `月报主题色：${String(accent).slice(0, 20)}` : ''].filter(Boolean).join('\n\n');
    const seen = await currentImageForAi(req.body.current);
    const library=await imageLibrary.list(),paged=imageLibrary.page(library,req.body.gallery?.page,8);
    let shown=paged.items;
    if(Array.isArray(req.body.gallery?.ids)&&req.body.gallery.ids.length){
        const allowed=new Map(library.map(item=>[item.id,item]));
        if(req.body.gallery.ids.length>8||req.body.gallery.ids.some(id=>!allowed.has(id)))return res.status(409).json({error:'当前图片页已改变，请重新打开历史图库'});
        shown=req.body.gallery.ids.map(id=>allowed.get(id));
    }
    let pending=null;
    if(req.body.pendingProposalId){pending=await images.deletion(req.body.pendingProposalId,user(req));if(pending.status!=='pending'||pending.expiresAt<=new Date().toISOString())pending=null;}
    const galleryContext='\n当前图库展示页：'+JSON.stringify({page:paged.page,totalPages:paged.totalPages,total:paged.total,images:shown.map((v,i)=>({id:v.id,name:v.name,number:i+1})),pendingDeletion:pending?{id:pending.id,images:pending.images.map(({id,name})=>({id,name}))}:null});
    const messages = [{ role: 'user', content: [context+galleryContext, seen.note].filter(Boolean).join('\n\n'), ...(seen.images.length ? { images: seen.images } : {}) }, { role: 'model', content: '好的。' }, ...historyMessages(chat), { role: 'user', content: String(message).slice(0, 4000) }];
    const client = await aiClient();
    const result = await runWithTools(client, { system: IMAGE_CHAT_PROMPT, month: '', messages, tools: false, fallback: { type: 'answer', text: '抱歉，我这次没能理解，请换个说法再试一次。' }, accept: (reply, toolLog) => {
        if (asksAboutConflict(reply)) return { retry: CONFLICT_RETRY };
        if (reply?.type === 'ask' && reply.question) return { result: askResult(reply, toolLog) };
        if (reply?.type === 'generate' && reply.prompt) return { result: { type: 'generate', text: String(reply.text || '').slice(0, 1000), prompt: String(reply.prompt).slice(0, 2000), edit: reply.edit === true } };
        if (reply?.type === 'resize' && Number(reply.width) >= 40 && Number(reply.width) <= 400) return { result: { type: 'resize', text: String(reply.text || '').slice(0, 1000), width: Math.round(Number(reply.width)) } };
        if(reply?.type==='history_page'&&(['next','previous'].includes(reply.direction)||Number.isInteger(reply.page)&&reply.page>0))return {result:{type:'history_page',direction:reply.direction,page:Number(reply.page)||0,text:String(reply.text||'').slice(0,1000)}};
        if(reply?.type==='delete_images'&&typeof reply.description==='string'&&['page','all','current'].includes(reply.scope))return {result:{type:'delete_images',description:reply.description.slice(0,4000),scope:reply.scope}};
        // Deleting needs the review card's button: a typed “确认” shows the exact list again instead of deleting it.
        if(reply?.type==='confirm_delete'&&pending)return {result:{type:'delete_confirmation',proposalId:pending.id,expiresAt:pending.expiresAt,images:pending.images,text:`请核对这 ${pending.images.length} 张图片，然后点下面的“确认删除”按钮；只有点按钮才会删除。`}};
        if(reply?.type==='cancel_delete'&&pending)return {result:{type:'cancel_delete',proposalId:pending.id}};
        if (['upload', 'history', 'answer'].includes(reply?.type) && (reply.text || reply.type !== 'answer')) return { result: { type: reply.type, text: String(reply.text || '').slice(0, 2000) } };
        return { retry: '请只输出约定的 JSON 对象（type 为 upload、history、history_page、delete_images、confirm_delete、cancel_delete、generate、resize、ask 或 answer），确认或取消删除必须先有待确认清单。' };
    } });
    if(result.type==='delete_images'){
        if(req.user?.role!=='admin'||!user(req))return res.status(403).json({error:'只有管理员可以管理历史图片'});
        const candidates=(result.scope==='all'?library:result.scope==='current'?library.filter(item=>item.url===req.body.current):shown).filter(item=>item.source!=='platform-logo');
        // Each batch of 8 is one multimodal call: a whole-library search is kept small, otherwise the user narrows it first.
        if(result.scope==='all'&&candidates.length>64)return res.json({type:'ask',question:`图库有 ${candidates.length} 张图片，一次识别太多。请翻到目标所在的页再说要删哪些，或说得更具体（如颜色、文字、上传时间）。`,choices:['从历史图片中选择']});
        if(candidates.length>500)return res.json({type:'ask',question:'图库较大，请按页删除，或把目标范围限定到500张以内再识别。',choices:['从历史图片中选择']});
        const selected=await imageSelection.select(client,{items:candidates,description:`用户原话：${String(message).slice(0,4000)}\n识别目标：${result.description}`,readPicture:galleryPictureForAi});
        if(selected.ambiguous||!selected.items.length)return res.json({type:'ask',question:selected.text||'暂时没有找到能确定匹配的图片。请补充颜色、文字或本页编号，或点击图片右下角的删除按钮。',choices:['从历史图片中选择']});
        return res.json(deletionResult(await images.proposeDeletion(selected.items,user(req))));
    }
    // A new picture that contradicts the user's own image prompt is asked about first; editing the current picture is a
    // change by definition, and the platform base prompt only sets defaults, so neither is asked about.
    res.json(result.type === 'generate' && !result.edit ? await checkConflict(client, { ...result, type: 'ready' }, { message, chat, sides: [['当前的图片提示词', prompt]] }).then(checked => checked.type === 'ask' ? checked : result) : result);
}));
const IMAGE_SVG_PROMPT = `你是矢量图形设计师，按要求画一张 SVG 图片。
- 只输出 JSON：{"svg":"完整的 <svg ...>...</svg> 代码","name":"不超过 12 个字的图片名"}。
- SVG 必须有 xmlns 和 viewBox；只用 path、circle、rect、ellipse、polygon、line、g、text、linearGradient、radialGradient、defs、clipPath 等基本元素。
- 不能有 <script>、<foreignObject>、<image>、事件属性（onclick 等）、外部链接或字体文件；href 只能写 "#id" 引用本文件里的渐变或裁剪。
- 图形要居中、留出适当边距，在小尺寸下清晰。`;
router.post('/image/generate', handle(async (req, res) => {
    const { slot = 'logo', prompt = '', accent = '', edit = false, current = '' } = req.body || {};
    if (!String(prompt).trim()) return res.status(400).json({ error: '还没有图片提示词' });
    const base = model.IMAGE_BASE[slot] || model.IMAGE_BASE.logo;
    // A configured drawing model (丹青) draws a real picture; editing hands it the current image as a reference.
    const drawing = await aiSettingsRepo.getImageRuntimeSettings().catch(() => null);
    if (drawing?.hasApiKey && drawing.keyLooksValid) {
        const painter = traced(aiProviderClient.createClient(drawing));
        const reference = edit ? (await currentImageForAi(current)).images : [];
        const rasterBase = base.replace(/透明背景/g, '纯白背景（月报底色是白色）').replace(/[（(]viewBox="[^"]*"[）)]/g, '');
        const fullPrompt = [rasterBase, accent && !reference.length ? `主色：${String(accent).slice(0, 20)}` : '', reference.length ? `在附上的图片基础上修改：${prompt}` : `画面内容：${prompt}`].filter(Boolean).join('\n');
        const result = await painter.generateImage({ prompt: fullPrompt, images: reference, aspectRatio: '1:1' });
        const picture = result.images[0];
        if (!picture) { const error = new Error(result.text ? `绘图模型没有返回图片：${result.text.slice(0, 200)}` : '绘图模型没有返回图片，请换个描述再试'); error.status = 502; throw error; }
        const saved = await images.save({ bytes: Buffer.from(picture.data, 'base64'), name: `AI 绘图 ${new Date().toISOString().slice(0, 10)}`, source: 'ai', prompt: fullPrompt, user: user(req) });
        return res.json({ ...saved, engine: 'image-model', model: drawing.model });
    }
    const client = await aiClient();
    let note = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        const content = [`基础提示词：\n${base}`, accent ? `月报主题色：${String(accent).slice(0, 20)}（主色用它）` : '', `这次的图片提示词：\n${String(prompt).slice(0, 2000)}`, note].filter(Boolean).join('\n\n');
        const reply = parseReply((await client.generateChat({ systemInstruction: IMAGE_SVG_PROMPT, messages: [{ role: 'user', content }], maxOutputTokens: 8000, temperature: 0.6 })).text);
        try {
            const svg = images.checkSvg(reply?.svg);
            return res.json({ ...(await images.save({ bytes: Buffer.from(svg), name: `${String(reply.name || 'AI 图片').slice(0, 40)}.svg`, source: 'ai', prompt: `${base}\n${prompt}`, user: user(req) })), engine: 'svg', model: '' });
        } catch (error) { note = `上一次的 SVG 不能用：${error.message}。请重新画，严格遵守要求。`; }
    }
    const error = new Error('AI 没能画出可用的图片，请换个描述再试');error.status = 502;throw error;
}));

// Developer viewer: summarise a trace, diagnose an error from it, or answer a question about a selected passage.
const EXPLAIN_PROMPTS = {
    summary: '你在帮开发者阅读“AI 月报”生成格子的调试记录（发给模型的提示词、模型返回、工具调用、错误）。用中文分点概括这段记录：这一步要做什么、模型实际做了什么、调用了哪些工具、最终结果如何。简洁具体，不要复述大段原文。',
    diagnose: '你在帮开发者排查“AI 月报”生成格子失败或结果不对的原因。根据调试记录，用中文分点写出：1. 出了什么问题（引用关键的报错或返回）；2. 最可能的原因；3. 具体怎么改（改提示词怎么写、换什么数据来源，或是平台问题）。没有发现错误时直接说明，不要编造。',
    ask: '你在帮开发者阅读“AI 月报”的调试记录。用户选中了其中一段并提问，请结合选中内容和上下文，用中文简洁准确地回答。'
};
router.post('/debug/explain', handle(async (req, res) => {
    const { mode = 'summary', text = '', selection = '', question = '' } = req.body || {};
    const system = EXPLAIN_PROMPTS[mode] || EXPLAIN_PROMPTS.summary;
    if (!String(text).trim() && !String(selection).trim()) return res.status(400).json({ error: '没有可分析的内容' });
    const content = [mode === 'ask' ? `选中的内容：\n${String(selection).slice(0, 12000)}\n\n问题：${String(question).slice(0, 2000) || '这段是什么意思？'}` : '', `调试记录：\n${String(text).slice(0, 60000)}`].filter(Boolean).join('\n\n');
    const result = await (await aiClient()).generateChat({ systemInstruction: `${system}\n回答用纯文字，可以用“- ”分点，不要用 Markdown 标题或代码块。`, messages: [{ role: 'user', content }], maxOutputTokens: 2000, temperature: 0.2 });
    res.json({ answer: String(result.text || '').trim().slice(0, 8000) || '（AI 没有返回内容）' });
}));

module.exports = router;
Object.assign(module.exports, { cellTurn, compileTurn, summarizePrompt, reviseStyle, textEditTurn, styleTurn, compileTheme, parseReplyDetailed });
