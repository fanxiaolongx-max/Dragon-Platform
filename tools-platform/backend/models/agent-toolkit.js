// Dragon Claw 常用工具（全部离线，只用项目已有依赖）：精确计算、读 Office 文档、表格查询、比较差异、压缩解压。
// 文件类工具只在工作目录内操作（agent-path-guard），由 agent-tools-service 登记、按类别走工作区审批。
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const acorn = require('acorn');
const JSZip = require('jszip');
const guard = require('./agent-path-guard');
const { unifiedDiff } = require('./agent-change-log');

const LIMITS = {
    documentBytes: 50 * 1024 * 1024,
    documentRows: 200,
    maxDocumentRows: 2000,
    queryRows: 200,
    maxQueryRows: 1000,
    queryLoadRows: 200000,
    diffBytes: 2 * 1024 * 1024,
    zipFiles: 5000,
    zipBytes: 200 * 1024 * 1024,
    unzipBytes: 500 * 1024 * 1024
};

function toolError(code, message) {
    return Object.assign(new Error(message), { code });
}

// ── calculate ────────────────────────────────────────────
const DAY_MS = 86400000;
const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function parseDate(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) throw toolError('AGENT_CALC_DATE', `日期需写成 YYYY-MM-DD：${text}`);
    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (new Date(time).getUTCDate() !== Number(match[3])) throw toolError('AGENT_CALC_DATE', `日期不存在：${text}`);
    return time;
}
const formatDate = time => new Date(time).toISOString().slice(0, 10);
function weekendSet(spec) {
    if (spec === undefined || spec === null || spec === '') return new Set([0, 6]);
    return new Set(String(spec).toLowerCase().split(/[\s,，、]+/).filter(Boolean).map(item => {
        const day = WEEKDAY[item.slice(0, 3)] ?? WEEKDAY[item.replace(/^周|^星期/, '')];
        if (day === undefined) throw toolError('AGENT_CALC_DATE', `无法识别的休息日：${item}（用 sat,sun 或 周五,周六）`);
        return day;
    }));
}
function workdaysBetween(start, end, weekend) {
    const from = parseDate(start);
    const to = parseDate(end);
    const off = weekendSet(weekend);
    // 与 Excel NETWORKDAYS 一致：首尾两天都算
    const [low, high] = from <= to ? [from, to] : [to, from];
    if (high - low > 3660 * DAY_MS) throw toolError('AGENT_CALC_RANGE', '日期跨度不能超过 10 年');
    let count = 0;
    for (let time = low; time <= high; time += DAY_MS) if (!off.has(new Date(time).getUTCDay())) count += 1;
    return from <= to ? count : -count;
}
function addWorkdays(start, days, weekend) {
    let time = parseDate(start);
    const off = weekendSet(weekend);
    const total = Math.trunc(Number(days));
    if (!Number.isFinite(total) || Math.abs(total) > 3000) throw toolError('AGENT_CALC_RANGE', '工作日数需在 ±3000 以内');
    const step = total >= 0 ? DAY_MS : -DAY_MS;
    for (let left = Math.abs(total); left > 0;) {
        time += step;
        if (!off.has(new Date(time).getUTCDay())) left -= 1;
    }
    return formatDate(time);
}
const numbers = list => list.flat(Infinity).map(Number);
const FUNCTIONS = {
    abs: Math.abs, round: (value, digits = 0) => Number(Math.round(Number(`${value}e${digits}`)) + `e-${digits}`), floor: Math.floor, ceil: Math.ceil,
    trunc: Math.trunc, sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow, exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sign: Math.sign,
    min: (...args) => Math.min(...numbers(args)), max: (...args) => Math.max(...numbers(args)),
    sum: (...args) => numbers(args).reduce((total, value) => total + value, 0),
    avg: (...args) => { const list = numbers(args); return list.reduce((total, value) => total + value, 0) / list.length; },
    median: (...args) => { const list = numbers(args).sort((a, b) => a - b); const mid = Math.floor(list.length / 2); return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2; },
    percent: (part, whole) => (Number(part) / Number(whole)) * 100,
    change_percent: (from, to) => ((Number(to) - Number(from)) / Math.abs(Number(from))) * 100,
    today: () => formatDate(Date.parse(new Date().toLocaleDateString('sv-SE'))),
    days_between: (start, end) => Math.round((parseDate(end) - parseDate(start)) / DAY_MS),
    add_days: (date, days) => formatDate(parseDate(date) + Math.trunc(Number(days)) * DAY_MS),
    add_months: (date, months) => {
        const base = new Date(parseDate(date));
        const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + Math.trunc(Number(months)), 1));
        const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        return formatDate(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(base.getUTCDate(), last)));
    },
    workdays_between: workdaysBetween,
    add_workdays: addWorkdays,
    weekday: date => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(parseDate(date)).getUTCDay()]
};
const CONSTANTS = { PI: Math.PI, E: Math.E };
const BINARY = {
    '+': (a, b) => (typeof a === 'string' || typeof b === 'string' ? `${a}${b}` : a + b), '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b,
    '%': (a, b) => a % b, '**': (a, b) => a ** b, '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b,
    '==': (a, b) => a === b, '===': (a, b) => a === b, '!=': (a, b) => a !== b, '!==': (a, b) => a !== b
};

function evaluate(node) {
    switch (node.type) {
        case 'Literal':
            if (typeof node.value !== 'number' && typeof node.value !== 'string' && typeof node.value !== 'boolean') throw toolError('AGENT_CALC_SYNTAX', '只支持数字、字符串和布尔值');
            return node.value;
        case 'Identifier':
            if (Object.prototype.hasOwnProperty.call(CONSTANTS, node.name)) return CONSTANTS[node.name];
            throw toolError('AGENT_CALC_SYNTAX', `未知名称：${node.name}`);
        case 'UnaryExpression':
            if (node.operator === '-') return -evaluate(node.argument);
            if (node.operator === '+') return +evaluate(node.argument);
            if (node.operator === '!') return !evaluate(node.argument);
            break;
        case 'BinaryExpression':
            if (BINARY[node.operator]) return BINARY[node.operator](evaluate(node.left), evaluate(node.right));
            break;
        case 'LogicalExpression':
            if (node.operator === '&&') return evaluate(node.left) && evaluate(node.right);
            if (node.operator === '||') return evaluate(node.left) || evaluate(node.right);
            break;
        case 'ConditionalExpression':
            return evaluate(node.test) ? evaluate(node.consequent) : evaluate(node.alternate);
        case 'ArrayExpression':
            return node.elements.map(evaluate);
        case 'CallExpression': {
            const name = node.callee.type === 'Identifier' ? node.callee.name : (node.callee.type === 'MemberExpression' && node.callee.object.name === 'Math' ? node.callee.property.name : '');
            const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, name) ? FUNCTIONS[name] : null;
            if (!fn) throw toolError('AGENT_CALC_SYNTAX', `不支持的函数：${name || '表达式'}`);
            return fn(...node.arguments.map(evaluate));
        }
        default:
    }
    throw toolError('AGENT_CALC_SYNTAX', `不支持的写法：${node.type}${node.operator ? ` ${node.operator}` : ''}`);
}

function tidy(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return String(value);
        return Number.isInteger(value) ? value : Number(value.toPrecision(12)); // 去掉 0.1+0.2 这类浮点尾巴
    }
    return Array.isArray(value) ? value.map(tidy) : value;
}

function calculate(args = {}) {
    const list = Array.isArray(args.expressions) ? args.expressions : [args.expression];
    const items = list.map(item => String(item ?? '').trim()).filter(Boolean).slice(0, 50);
    if (!items.length) throw toolError('AGENT_ARGS', '缺少 expression');
    const lines = items.map(expression => {
        try {
            if (expression.length > 2000) throw toolError('AGENT_ARGS', '表达式过长');
            const ast = acorn.parseExpressionAt(expression.replace(/×/g, '*').replace(/÷/g, '/'), 0, { ecmaVersion: 2020 });
            if (ast.end < expression.length && expression.slice(ast.end).trim()) throw toolError('AGENT_CALC_SYNTAX', `无法解析：${expression.slice(ast.end).trim()}`);
            return `${expression} = ${JSON.stringify(tidy(evaluate(ast)))}`;
        } catch (error) {
            return `${expression} → 错误：${error.code === 'AGENT_CALC_SYNTAX' || error.code?.startsWith?.('AGENT_') ? error.message : `无法计算（${error.message}）`}`;
        }
    });
    const failed = lines.filter(line => line.includes(' → 错误：')).length;
    return { content: lines.join('\n'), summary: items.length === 1 ? lines[0].slice(0, 120) : `${items.length} 个表达式${failed ? `，${failed} 个出错` : ''}`, ...(failed === items.length ? { isError: true } : {}) };
}

// ── 读取 Office 文档与表格 ───────────────────────────────
function cellText(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) {
        const iso = value.toISOString();
        return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('T', ' ').replace(/\.000Z$/, '');
    }
    if (typeof value === 'object') {
        if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
        if ('result' in value) return cellText(value.result);
        if ('text' in value) return cellText(value.text);
        if ('error' in value) return String(value.error);
        if ('sharedFormula' in value || 'formula' in value) return '';
        return JSON.stringify(value);
    }
    return String(value);
}

function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; } else if (char === '"') quoted = false; else field += char;
        } else if (char === '"' && field === '') quoted = true;
        else if (char === delimiter) { row.push(field); field = ''; } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[index + 1] === '\n') index += 1;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += char;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

async function resolveFile(ctx, filePath) {
    if (!filePath) throw toolError('AGENT_ARGS', '缺少 path');
    // 本人的对话附件和大结果文件可以用完整路径读取，即使不在工作目录里（或没有工作目录）
    const owned = ctx.artifactOwner && path.isAbsolute(String(filePath)) && require('./agent-artifacts').ownsFile(ctx.artifactOwner, String(filePath));
    if (!owned && !ctx.root) throw toolError('AGENT_PATH_OUTSIDE', '没有工作目录时只能读取本人上传的附件（用附件的完整路径）');
    const abs = owned ? path.resolve(String(filePath)) : guard.resolveInsideRoot(ctx.root, filePath);
    guard.assertNotSecretFile(abs);
    const display = owned ? path.basename(abs) : guard.toDisplayPath(ctx.root, abs);
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) throw toolError('AGENT_NOT_FOUND', `文件不存在：${display}`);
    if (stat.isDirectory()) throw toolError('AGENT_IS_DIR', `${display} 是目录`);
    if (stat.size > LIMITS.documentBytes) throw toolError('AGENT_TOO_LARGE', `${display} 超过 ${LIMITS.documentBytes / 1024 / 1024}MB`);
    return { abs, display, ext: path.extname(abs).slice(1).toLowerCase(), size: stat.size };
}

/** 读出表格：[{ name, rows: string[][] }]；Excel 每个工作表一项，CSV 一项 */
async function loadSheets(file) {
    if (['csv', 'tsv', 'txt'].includes(file.ext)) {
        let text = await fsp.readFile(file.abs, 'utf8');
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        const newline = text.indexOf('\n');
        const first = text.slice(0, newline === -1 ? 2000 : newline);
        const delimiter = file.ext === 'tsv' || (first.split('\t').length > first.split(',').length) ? '\t' : ',';
        return [{ name: path.basename(file.abs, path.extname(file.abs)), rows: parseDelimited(text, delimiter) }];
    }
    if (['xlsx', 'xlsm'].includes(file.ext)) {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file.abs);
        return workbook.worksheets.map(sheet => {
            const rows = [];
            sheet.eachRow({ includeEmpty: true }, (row, number) => {
                const values = [];
                for (let col = 1; col <= sheet.actualColumnCount || col <= row.cellCount; col += 1) values.push(cellText(row.getCell(col).value));
                rows[number - 1] = values;
            });
            return { name: sheet.name, rows: Array.from(rows, row => row || []) };
        });
    }
    if (['xls', 'et'].includes(file.ext)) throw toolError('AGENT_FORMAT', '旧版 .xls 暂不支持，请另存为 .xlsx 或 .csv');
    return null;
}

const xmlText = xml => xml.replace(/<w:tab\/>|<a:tab\/>/g, '\t').replace(/<w:br\/>|<a:br\/>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function readDocx(abs) {
    const zip = await JSZip.loadAsync(await fsp.readFile(abs));
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) throw toolError('AGENT_FORMAT', '不是有效的 .docx 文件');
    const body = xml.replace(/[\s\S]*?<w:body>/, '').replace(/<w:sectPr[\s\S]*$/, '');
    const blocks = [];
    // 表格按行输出成「|」分隔，段落逐行输出
    const parts = body.split(/(<w:tbl>[\s\S]*?<\/w:tbl>)/);
    for (const part of parts) {
        if (part.startsWith('<w:tbl>')) {
            const rows = part.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || [];
            rows.forEach(row => blocks.push(`| ${(row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(cell => xmlText((cell.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).join(' ')).trim().replace(/\|/g, '\\|')).join(' | ')} |`));
            blocks.push('');
        } else {
            for (const paragraph of part.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || []) {
                const heading = paragraph.match(/<w:pStyle w:val="(?:Heading|heading|标题)\s*(\d)"/);
                const text = xmlText(paragraph).trim();
                if (text) blocks.push(heading ? `${'#'.repeat(Math.min(6, Number(heading[1])))} ${text}` : text);
            }
        }
    }
    return blocks.join('\n');
}

async function readPptx(abs) {
    const zip = await JSZip.loadAsync(await fsp.readFile(abs));
    const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
    if (!slides.length) throw toolError('AGENT_FORMAT', '不是有效的 .pptx 文件，或没有幻灯片');
    const out = [];
    for (const [index, name] of slides.entries()) {
        const xml = await zip.file(name).async('string');
        const paragraphs = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map(xmlText).map(text => text.trim()).filter(Boolean);
        const notesName = name.replace('slides/slide', 'notesSlides/notesSlide');
        const notesXml = zip.file(notesName) ? await zip.file(notesName).async('string') : '';
        const notes = (notesXml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map(xmlText).map(text => text.trim()).filter(text => text && !/^\d+$/.test(text));
        out.push(`## 第 ${index + 1} 页\n${paragraphs.join('\n') || '（无文字）'}${notes.length ? `\n备注：${notes.join(' ')}` : ''}`);
    }
    return out.join('\n\n');
}

async function readDocument(ctx, args = {}) {
    const file = await resolveFile(ctx, args.path);
    if (file.ext === 'docx') {
        const text = await readDocx(file.abs);
        return { content: `${file.display}（Word 文档）\n\n${text || '（没有文字内容）'}`, summary: `${file.display} · ${text.length} 字` };
    }
    if (file.ext === 'pptx') {
        const text = await readPptx(file.abs);
        return { content: `${file.display}（PPT）\n\n${text}`, summary: `${file.display} · ${(text.match(/^## 第/gm) || []).length} 页` };
    }
    if (['pdf', 'doc', 'ppt', 'msg'].includes(file.ext)) throw toolError('AGENT_FORMAT', `暂不支持 .${file.ext}：请另存为 .docx / .pptx / .xlsx 后再读，或让用户复制文字`);
    const sheets = await loadSheets(file);
    if (!sheets) throw toolError('AGENT_FORMAT', `read_document 支持 .xlsx/.xlsm/.csv/.tsv/.docx/.pptx；纯文本文件请用 read_file`);
    const wanted = args.sheet ? sheets.find(sheet => sheet.name === String(args.sheet)) : sheets.find(sheet => sheet.rows.some(row => row.some(Boolean))) || sheets[0];
    if (!wanted) throw toolError('AGENT_NOT_FOUND', `没有工作表「${args.sheet}」，现有：${sheets.map(sheet => sheet.name).join('、')}`);
    const start = Math.max(1, Math.floor(Number(args.startRow)) || 1);
    const count = Math.min(LIMITS.maxDocumentRows, Math.max(1, Math.floor(Number(args.maxRows)) || LIMITS.documentRows));
    const rows = wanted.rows.slice(start - 1, start - 1 + count);
    const overview = sheets.length > 1 ? `工作表：${sheets.map(sheet => `${sheet.name}（${sheet.rows.length} 行）`).join('、')}\n` : '';
    const body = rows.map((row, index) => `${start + index}│${row.map(value => String(value).replace(/\t|\n/g, ' ')).join('\t')}`).join('\n');
    const end = start - 1 + rows.length;
    const more = end < wanted.rows.length ? `\n…还有 ${wanted.rows.length - end} 行：继续读取用 startRow=${end + 1}；要统计、筛选请用 query_data。` : '';
    return { content: `${file.display} · 工作表「${wanted.name}」第 ${start}-${end} 行，共 ${wanted.rows.length} 行（制表符分隔）\n${overview}${body}${more}`,
        summary: `${file.display} / ${wanted.name} ${start}-${end}` };
}

// ── query_data：表格载入内存 SQLite，只读 SQL ─────────────
const sqlName = name => `"${String(name).replace(/"/g, '""')}"`;
const NUMERIC_RE = /^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i;

function tableFrom(rows, preferredName) {
    const cleaned = rows.filter(row => row && row.some(value => String(value).trim() !== ''));
    if (!cleaned.length) return null;
    const width = Math.max(...cleaned.map(row => row.length));
    const seen = new Map();
    const columns = Array.from({ length: width }, (_, index) => {
        let name = String(cleaned[0][index] ?? '').trim() || `col_${index + 1}`;
        const count = seen.get(name) || 0;
        seen.set(name, count + 1);
        if (count) name = `${name}_${count + 1}`;
        return name;
    });
    const data = cleaned.slice(1, LIMITS.queryLoadRows + 1).map(row => columns.map((_, index) => String(row[index] ?? '').trim()));
    const numeric = columns.map((_, index) => data.some(row => row[index] !== '') && data.every(row => row[index] === '' || NUMERIC_RE.test(row[index].replace(/,/g, ''))));
    return { name: preferredName, columns, numeric, rows: data.map(row => row.map((value, index) => (value === '' ? null : numeric[index] ? Number(value.replace(/,/g, '')) : value))),
        truncated: cleaned.length - 1 > LIMITS.queryLoadRows };
}

function assertReadOnlySql(sql) {
    const text = String(sql || '').trim().replace(/;\s*$/, '');
    if (!text) return '';
    const stripped = text.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
    if (!/^\s*(select|with)\b/i.test(stripped)) throw toolError('AGENT_SQL_READONLY', '只支持一条 SELECT（可以用 WITH）');
    if (stripped.includes(';')) throw toolError('AGENT_SQL_READONLY', '一次只能执行一条语句');
    if (/\b(attach|detach|pragma|vacuum|load_extension|insert|update|delete|replace|create|drop|alter)\b/i.test(stripped)) throw toolError('AGENT_SQL_READONLY', '只能查询，不能写入或访问其他数据库文件');
    return text;
}

async function queryData(ctx, args = {}) {
    const sources = Array.isArray(args.sources) && args.sources.length ? args.sources.slice(0, 8) : [{ path: args.path, sheet: args.sheet, table: args.table }];
    const sql = assertReadOnlySql(args.sql);
    const tables = [];
    for (const [index, source] of sources.entries()) {
        const file = await resolveFile(ctx, source.path);
        const sheets = await loadSheets(file);
        if (!sheets) throw toolError('AGENT_FORMAT', `${file.display} 不是表格文件（支持 .xlsx/.xlsm/.csv/.tsv）`);
        const picked = source.sheet ? sheets.filter(sheet => sheet.name === String(source.sheet)) : sheets;
        if (!picked.length) throw toolError('AGENT_NOT_FOUND', `${file.display} 没有工作表「${source.sheet}」`);
        for (const sheet of picked) {
            const base = source.table || (sources.length === 1 && picked.length === 1 ? 'data' : picked.length > 1 ? sheet.name : `t${index + 1}`);
            const table = tableFrom(sheet.rows, String(base));
            if (table) tables.push({ ...table, source: `${file.display}${picked.length > 1 || source.sheet ? ` / ${sheet.name}` : ''}` });
        }
    }
    if (!tables.length) throw toolError('AGENT_NOT_FOUND', '表格里没有数据');
    const sqlite3 = require('sqlite3');
    const db = new sqlite3.Database(':memory:');
    const exec = (statement, params = []) => new Promise((resolve, reject) => db.run(statement, params, error => (error ? reject(error) : resolve())));
    try {
        db.configure('limit', sqlite3.LIMIT_ATTACHED, 0); // 即使绕过语句检查也不能挂载磁盘上的数据库文件
        for (const table of tables) {
            await exec(`CREATE TABLE ${sqlName(table.name)} (${table.columns.map((column, index) => `${sqlName(column)} ${table.numeric[index] ? 'NUMERIC' : 'TEXT'}`).join(', ')})`);
            await exec('BEGIN');
            const insert = db.prepare(`INSERT INTO ${sqlName(table.name)} VALUES (${table.columns.map(() => '?').join(', ')})`);
            for (const row of table.rows) await new Promise((resolve, reject) => insert.run(row, error => (error ? reject(error) : resolve())));
            await new Promise(resolve => insert.finalize(resolve));
            await exec('COMMIT');
        }
        const schema = tables.map(table => `表 ${sqlName(table.name)}（来自 ${table.source}，${table.rows.length} 行${table.truncated ? `，只载入前 ${LIMITS.queryLoadRows} 行` : ''}）：${table.columns.map((column, index) => `${sqlName(column)} ${table.numeric[index] ? '数字' : '文本'}`).join(', ')}`).join('\n');
        if (!sql) {
            const samples = tables.map(table => `${table.name} 前 5 行：${JSON.stringify(table.rows.slice(0, 5))}`).join('\n');
            return { content: `${schema}\n${samples}\n\n用 sql 参数写一条 SELECT 查询（列名含空格或中文时用双引号）。`, summary: `${tables.length} 张表，未执行查询` };
        }
        const limit = Math.min(LIMITS.maxQueryRows, Math.max(1, Math.floor(Number(args.maxRows)) || LIMITS.queryRows));
        const rows = await new Promise((resolve, reject) => db.all(`SELECT * FROM (${sql}) LIMIT ${limit + 1}`, (error, result) => (error ? reject(toolError('AGENT_SQL', `SQL 错误：${error.message}\n${schema}`)) : resolve(result))));
        const more = rows.length > limit;
        const shown = rows.slice(0, limit);
        const columns = shown.length ? Object.keys(shown[0]) : [];
        const body = [columns.join('\t'), ...shown.map(row => columns.map(column => (row[column] === null ? '' : typeof row[column] === 'number' ? tidy(row[column]) : String(row[column]).replace(/\t|\n/g, ' '))).join('\t'))].join('\n');
        return { content: `${schema}\n\n结果 ${shown.length} 行${more ? `（只显示前 ${limit} 行，可调大 maxRows 或加聚合 / 筛选）` : ''}：\n${body}`, summary: `查询返回 ${shown.length}${more ? '+' : ''} 行` };
    } finally {
        db.close();
    }
}

// ── diff_files ───────────────────────────────────────────
async function diffFiles(ctx, args = {}) {
    const side = async (filePath, text, label) => {
        if (typeof text === 'string') return { label, text };
        const file = await resolveFile(ctx, filePath);
        if (file.size > LIMITS.diffBytes) throw toolError('AGENT_TOO_LARGE', `${file.display} 超过 2MB，不适合逐行比较`);
        if (guard.looksBinaryByName(file.abs)) throw toolError('AGENT_BINARY', `${file.display} 是二进制文件`);
        return { label: file.display, text: await fsp.readFile(file.abs, 'utf8') };
    };
    if (!args.path && typeof args.text !== 'string') throw toolError('AGENT_ARGS', '需要 path 或 text');
    if (!args.otherPath && typeof args.otherText !== 'string') throw toolError('AGENT_ARGS', '需要 otherPath 或 otherText');
    const left = await side(args.path, args.text, '文本 A');
    const right = await side(args.otherPath, args.otherText, '文本 B');
    const diff = unifiedDiff(`${left.label} → ${right.label}`, left.text, right.text, Math.min(10, Math.max(0, Number(args.context ?? 3))));
    return { content: diff.text ? diff.text : `${left.label} 与 ${right.label} 内容相同`, summary: diff.text ? `+${diff.added} −${diff.removed}` : '内容相同' };
}

// ── zip / unzip ──────────────────────────────────────────
async function collectZipEntries(ctx, paths) {
    const entries = [];
    let total = 0;
    const skipped = [];
    const add = async (abs, base) => {
        const stat = await fsp.lstat(abs).catch(() => null);
        if (!stat || stat.isSymbolicLink()) return;
        const display = guard.toDisplayPath(ctx.root, abs);
        if (stat.isDirectory()) {
            if (guard.isIgnoredDirName(path.basename(abs)) && abs !== ctx.root) { skipped.push(`${display}/`); return; }
            for (const name of await fsp.readdir(abs)) await add(path.join(abs, name), base);
            return;
        }
        try { guard.assertNotSecretFile(abs); } catch (_error) { skipped.push(display); return; }
        total += stat.size;
        if (entries.length >= LIMITS.zipFiles || total > LIMITS.zipBytes) throw toolError('AGENT_TOO_LARGE', `打包内容超过 ${LIMITS.zipFiles} 个文件或 ${LIMITS.zipBytes / 1024 / 1024}MB`);
        // 压缩包里的路径从所选文件 / 目录这一层开始（打包 pkg 目录得到 pkg/…）
        entries.push({ abs, display, name: path.relative(base, abs).split(path.sep).join('/') });
    };
    for (const item of paths) {
        const abs = guard.resolveInsideRoot(ctx.root, item);
        await add(abs, abs === ctx.root ? ctx.root : path.dirname(abs));
    }
    return { entries, total, skipped };
}

async function planZip(ctx, args = {}) {
    const paths = (Array.isArray(args.paths) ? args.paths : [args.paths]).filter(Boolean).map(String);
    if (!paths.length) throw toolError('AGENT_ARGS', '缺少 paths');
    if (!args.output || !/\.zip$/i.test(String(args.output))) throw toolError('AGENT_ARGS', 'output 必须是 .zip 文件路径');
    const outAbs = guard.resolveInsideRoot(ctx.root, args.output);
    const outDisplay = guard.toDisplayPath(ctx.root, outAbs);
    if (fs.existsSync(outAbs) && args.overwrite !== true) throw toolError('AGENT_EXISTS', `${outDisplay} 已存在；覆盖需要 overwrite=true`);
    const collected = await collectZipEntries(ctx, paths);
    if (!collected.entries.length) throw toolError('AGENT_NOT_FOUND', '没有可打包的文件');
    return { outAbs, outDisplay, ...collected };
}

async function zipFiles(ctx, args = {}) {
    const plan = await planZip(ctx, args);
    const zip = new JSZip();
    for (const entry of plan.entries) {
        if (entry.abs !== plan.outAbs) zip.file(entry.name, await fsp.readFile(entry.abs));
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    ctx.changeLog?.snapshotBefore(plan.outDisplay, plan.outAbs);
    await fsp.mkdir(path.dirname(plan.outAbs), { recursive: true });
    await fsp.writeFile(plan.outAbs, buffer);
    const entry = ctx.changeLog?.recordAfter(plan.outDisplay);
    return {
        content: `已打包 ${plan.entries.length} 个文件 → ${plan.outDisplay}（${(buffer.length / 1024).toFixed(1)} KB）${plan.skipped.length ? `\n跳过（密钥文件或依赖目录）：${plan.skipped.slice(0, 20).join('、')}` : ''}`,
        summary: `${plan.outDisplay} · ${plan.entries.length} 个文件`,
        changeEntry: entry
    };
}

async function planUnzip(ctx, args = {}) {
    const file = await resolveFile(ctx, args.path);
    if (file.ext !== 'zip') throw toolError('AGENT_FORMAT', '只支持 .zip');
    const targetRel = args.to || path.join(path.dirname(file.display), path.basename(file.display, '.zip'));
    const targetAbs = guard.resolveInsideRoot(ctx.root, targetRel);
    const zip = await JSZip.loadAsync(await fsp.readFile(file.abs));
    const files = Object.values(zip.files).filter(item => !item.dir && !/^__MACOSX\//.test(item.name));
    if (files.length > LIMITS.zipFiles) throw toolError('AGENT_TOO_LARGE', `压缩包里有 ${files.length} 个文件，超过 ${LIMITS.zipFiles}`);
    const items = files.map(item => {
        // JSZip 会把 ../ 规整掉；原始路径带 ../ 或是绝对路径的压缩包一律拒绝，不悄悄改写
        const original = String(item.unsafeOriginalName || item.name);
        if (/(^|[\\/])\.\.([\\/]|$)/.test(original) || path.isAbsolute(original) || /^[A-Za-z]:/.test(original)) throw toolError('AGENT_PATH_OUTSIDE', `压缩包里的路径跳出了目标目录：${original}`);
        // 防止 ../ 之类的路径跳出目标目录（zip slip）
        const abs = guard.resolveInsideRoot(ctx.root, path.join(path.relative(ctx.root, targetAbs), item.name));
        if (!guard.isInside(targetAbs, abs)) throw toolError('AGENT_PATH_OUTSIDE', `压缩包里的路径跳出了目标目录：${item.name}`);
        return { item, abs, display: guard.toDisplayPath(ctx.root, abs), exists: fs.existsSync(abs) };
    });
    const conflicts = items.filter(entry => entry.exists);
    if (conflicts.length && args.overwrite !== true) throw toolError('AGENT_EXISTS', `目标里已有 ${conflicts.length} 个同名文件（如 ${conflicts.slice(0, 3).map(entry => entry.display).join('、')}）；覆盖需要 overwrite=true`);
    return { file, targetDisplay: guard.toDisplayPath(ctx.root, targetAbs), items, conflicts: conflicts.length };
}

async function unzipFile(ctx, args = {}) {
    const plan = await planUnzip(ctx, args);
    let total = 0;
    const changes = [];
    for (const entry of plan.items) {
        const buffer = await entry.item.async('nodebuffer');
        total += buffer.length;
        if (total > LIMITS.unzipBytes) throw toolError('AGENT_TOO_LARGE', `解压后超过 ${LIMITS.unzipBytes / 1024 / 1024}MB，已停止（已写出部分文件）`);
        ctx.changeLog?.snapshotBefore(entry.display, entry.abs);
        await fsp.mkdir(path.dirname(entry.abs), { recursive: true });
        await fsp.writeFile(entry.abs, buffer);
        const change = ctx.changeLog?.recordAfter(entry.display);
        if (change) changes.push(change);
    }
    return {
        content: `已解压 ${plan.items.length} 个文件到 ${plan.targetDisplay}/（${(total / 1024).toFixed(1)} KB${plan.conflicts ? `，覆盖 ${plan.conflicts} 个` : ''}）\n${plan.items.slice(0, 50).map(entry => entry.display).join('\n')}${plan.items.length > 50 ? '\n…' : ''}`,
        summary: `${plan.targetDisplay}/ · ${plan.items.length} 个文件`,
        changeEntries: changes
    };
}

module.exports = { LIMITS, calculate, readDocument, queryData, diffFiles, zipFiles, planZip, unzipFile, planUnzip, assertReadOnlySql, parseDelimited };
