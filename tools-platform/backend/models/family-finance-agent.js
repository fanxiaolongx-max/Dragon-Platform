// WISE 家庭财务记账助手专用原生工具集
// 直接连接外部 WISE 财务系统 (https://wise.fanxiaolong.uk/family_finance)
// 采用 100% 原生 Node.js API 通信，零 Python / CLI 依赖，跨平台运行
// 供智能体自主记支出、记收入、转账、查余额与查流水，并在执行前执行环境与连通性快速预检
const fs = require('fs');
const os = require('os');
const path = require('path');
const agentLoop = require('./agent-loop');
const { vault } = require('./password-vault');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
const FALLBACK_URL = 'https://wise.fanxiaolong.uk';

function getBaseUrl() {
    return (process.env.WISE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function todayYMD() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let cachedVaultKey = null;
let lastVaultCheck = 0;

/** 从环境变量、Dragon Claw 保险箱或受保护的本地配置获取 API Key */
async function getApiKey(owner = 'admin') {
    if (process.env.WISE_API_KEY && process.env.WISE_API_KEY.trim()) {
        return process.env.WISE_API_KEY.trim();
    }
    const now = Date.now();
    if (cachedVaultKey && (now - lastVaultCheck < 30000)) {
        return cachedVaultKey;
    }
    try {
        const v = vault();
        const owners = [owner, 'admin', 'f84300033'].filter(Boolean);
        for (const o of owners) {
            const secret = await v.getSecret(o, 'WISE_API_KEY');
            if (secret && secret.value && secret.value.trim()) {
                cachedVaultKey = secret.value.trim();
                lastVaultCheck = now;
                return cachedVaultKey;
            }
        }
    } catch (_) {}

    // 本机受保护文件备用读取（权限 0600，宿主机文件系统）
    const candidatePaths = [
        path.join(os.homedir(), '.config', 'wise-finance', 'api_key'),
        path.join(os.homedir(), '.wise_finance_key'),
        path.resolve(__dirname, '../agent-skills/family-finance-bookkeeper/scripts/.api_key')
    ];
    for (const p of candidatePaths) {
        try {
            if (fs.existsSync(p)) {
                const val = fs.readFileSync(p, 'utf8').trim();
                if (val) return val;
            }
        } catch (_) {}
    }

    return cachedVaultKey || '';
}

/** 单次底层 HTTP 请求封装，带超时控制与 HTML 拦截防御 */
async function doRequest(base, method, endpoint, { data, params, apiKey, timeoutMs = 8000 }) {
    let url = `${base}${endpoint}`;
    if (params) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) sp.append(k, String(v));
        }
        const qs = sp.toString();
        if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }

    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'WiseFinanceSkill/2.0'
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            method,
            headers,
            body: data ? JSON.stringify(data) : undefined,
            signal: controller.signal
        });
        const text = await resp.text();
        const contentType = resp.headers?.get?.('content-type') || '';
        if (text.trim().startsWith('<') || contentType.includes('text/html')) {
            throw new Error(`服务返回了 HTML 页面而非预期 JSON（可能触发了 Cloudflare 拦截、重定向或身份验证）：${text.slice(0, 150)}`);
        }
        if (!resp.ok) {
            let parsed;
            try { parsed = JSON.parse(text); } catch (_) {}
            const errMsg = parsed?.detail || parsed?.error || parsed?.message || text.slice(0, 200) || `HTTP ${resp.status}`;
            const err = new Error(errMsg);
            err.status = resp.status;
            throw err;
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

/** 向上层提供自动回退的高可用 API 请求 */
async function apiCall(method, endpoint, { data, params, owner = 'admin' } = {}) {
    const apiKey = await getApiKey(owner);
    const base = getBaseUrl();
    try {
        return await doRequest(base, method, endpoint, { data, params, apiKey, timeoutMs: 5000 });
    } catch (err) {
        // 若本地端口未启动且远端域名不同，自动回退到公开备用地址
        if (base !== FALLBACK_URL) {
            try {
                return await doRequest(FALLBACK_URL, method, endpoint, { data, params, apiKey, timeoutMs: 8000 });
            } catch (_) {}
        }
        throw err;
    }
}

/** 环境与凭证快速预检：验证 API Key 存在性与服务连通性（2.5 秒超时） */
async function checkPrerequisites({ owner = 'admin' } = {}) {
    const key = await getApiKey(owner);
    if (!key) {
        return {
            ok: false,
            code: 'MISSING_API_KEY',
            error: '未在密码保险箱或环境变量中检测到 WISE_API_KEY。请在「全局设置 › 保险箱 › API 密钥与 Secret」中添加该密钥（名称：WISE_API_KEY）。'
        };
    }

    const base = getBaseUrl();
    const tryProbe = async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        try {
            const resp = await fetch(`${url}/api/finance/summary`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'User-Agent': 'WiseFinanceSkill/2.0'
                },
                signal: controller.signal
            });
            if (resp.status === 401 || resp.status === 403) {
                return { ok: false, code: 'UNAUTHORIZED', error: `WISE 记账服务鉴权失败 (${resp.status})，配置的 WISE_API_KEY 无效或已过期。` };
            }
            if (resp.ok) {
                return { ok: true, url };
            }
            return { ok: false, code: `HTTP_${resp.status}`, error: `HTTP ${resp.status}` };
        } catch (e) {
            const isTimeout = e.name === 'AbortError' || e.message?.includes('timeout') || e.message?.includes('aborted');
            return { ok: false, code: 'NETWORK_ERROR', error: isTimeout ? '连接超时 (2.5s)' : (e.cause?.message || e.message) };
        } finally {
            clearTimeout(timer);
        }
    };

    const localResult = await tryProbe(base);
    if (localResult.ok) return { ok: true, activeUrl: localResult.url, hasKey: true };
    if (localResult.code === 'UNAUTHORIZED') {
        return { ok: false, code: 'UNAUTHORIZED', error: localResult.error };
    }

    if (base !== FALLBACK_URL) {
        const remoteResult = await tryProbe(FALLBACK_URL);
        if (remoteResult.ok) return { ok: true, activeUrl: remoteResult.url, hasKey: true };
        if (remoteResult.code === 'UNAUTHORIZED') {
            return { ok: false, code: 'UNAUTHORIZED', error: remoteResult.error };
        }
    }

    return {
        ok: false,
        code: 'SERVICE_UNREACHABLE',
        error: `无法连接到 WISE 家庭财务后端服务（本地 ${base} 与远程 ${FALLBACK_URL} 均不可达：${localResult.error}）。请确认 WISE 财务服务是否已启动。`
    };
}

function definitions() {
    return [
        {
            name: 'finance_record_expense',
            description: '在 WISE 家庭财务系统中记录一笔支出。自动扣减对应账户余额并保存分类与商户备注。',
            parameters: {
                type: 'object',
                properties: {
                    account: { type: 'string', description: '扣款账户名，如 CIB、微信、招商银行、现金、生活费、支付宝等' },
                    amount: { type: 'number', description: '消费金额（正数）' },
                    category: { type: 'string', description: '支出分类，如餐饮、交通、购物、居住、娱乐、医疗、旅游、其他' },
                    description: { type: 'string', description: '备注或商户名称，如 亚辛新疆炒米粉、超市买菜' }
                },
                required: ['account', 'amount']
            }
        },
        {
            name: 'finance_record_income',
            description: '在 WISE 家庭财务系统中记录一笔收入。自动增加对应账户余额。',
            parameters: {
                type: 'object',
                properties: {
                    account: { type: 'string', description: '收款账户名，如 招商银行、微信、支付宝、现金等' },
                    amount: { type: 'number', description: '收入金额（正数）' },
                    category: { type: 'string', description: '收入分类，如工资、理财、兼职、奖金、其他' },
                    description: { type: 'string', description: '收入备注或来源' }
                },
                required: ['account', 'amount']
            }
        },
        {
            name: 'finance_query_accounts',
            description: '查询 WISE 家庭财务系统的账户列表、各账户当前余额及币种。',
            parameters: { type: 'object', properties: {} }
        },
        {
            name: 'finance_query_summary',
            description: '查询 WISE 家庭财务系统的财务总览概况（今日支出、本月收支、结余、净资产）。',
            parameters: { type: 'object', properties: {} }
        },
        {
            name: 'finance_query_transactions',
            description: '查询 WISE 家庭财务系统最近的流水明细。',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: '返回记录数量，默认 20 条' },
                    account: { type: 'string', description: '可选，筛选特定账户的流水' }
                }
            }
        },
        {
            name: 'finance_transfer',
            description: '在 WISE 家庭财务系统中进行账户间转账（如从招商银行转入微信）。',
            parameters: {
                type: 'object',
                properties: {
                    from_account: { type: 'string', description: '转出账户' },
                    to_account: { type: 'string', description: '转入账户' },
                    amount: { type: 'number', description: '转账金额（正数）' },
                    description: { type: 'string', description: '转账说明或备注' }
                },
                required: ['from_account', 'to_account', 'amount']
            }
        },
        {
            name: 'finance_delete_transaction',
            description: '撤销或删除一笔家庭财务流水（金额会自动回退到原账户余额）。',
            parameters: {
                type: 'object',
                properties: {
                    transaction_id: { type: 'integer', description: '要删除的流水记录 ID' }
                },
                required: ['transaction_id']
            }
        }
    ];
}

function buildPrompt() {
    return `### 💰 WISE 家庭财务记账助手
- 你已拥有家庭财务专用的 native 工具集：
  - finance_record_expense: 记支出（参数：account 账户名如 CIB/微信/现金，amount 金额正数，category 分类，description 备注）
  - finance_record_income: 记收入
  - finance_query_accounts: 查询各账户余额及币种
  - finance_query_summary: 查今日/本月财务总览与结余
  - finance_query_transactions: 查流水明细
  - finance_transfer: 账户间转账
  - finance_delete_transaction: 删除某条流水
- 当用户要求记账、查余额、查流水或转账时，**必须直接调用上述 finance_* 原生工具**。
- **严禁调用 insert_database_row / list_databases / database_schema 等平台数据库工具**：WISE 财务数据存储在独立的外部系统 (https://wise.fanxiaolong.uk)，本地平台 SQLite 库没有财务表。
- 【重要环境与诊断约束】：
  - 本技能采用 100% 原生 Node.js API 通信，宿主机无需安装 Python、curl 或任何外部环境。
  - **严禁在工具报错或环境未就绪时调用 run_command、terminal 执行 ping、curl、nslookup、where 等命令行进行网络探测！** 若遇到 API Key 缺失或网络连接失败，请直接向用户输出清晰的错误信息和设置指引。
- 记账或转账成功后，清晰告知用户记账详情及受影响账户的最新余额。`;
}

async function canUseFinance(user) {
    if (!user) return true;
    const { isSuperAdmin } = require('../middleware/auth');
    if (isSuperAdmin(user)) return true;
    const { hasEntryAccess } = require('./tool-distribution');
    return hasEntryAccess('skill:family-finance-bookkeeper');
}

async function execute(name, args = {}, options = {}) {
    if (options?.user && !(await canUseFinance(options.user))) {
        return {
            content: 'WISE 家庭财务记账助手未向全员开放，仅超级管理员可用。',
            summary: '未开放访问',
            isError: true
        };
    }

    const owner = options?.user?.username || options?.owner || 'admin';
    const prereq = await checkPrerequisites({ owner });
    if (!prereq.ok) {
        return {
            content: `❌ 环境预检未通过：\n${prereq.error}\n\n⚠️ 提示：严禁在终端尝试调用 ping/curl/where/nslookup 等命令行进行探测，请先按上述指引在保险箱中配置 WISE_API_KEY 或检查财务服务端。`,
            summary: `预检失败: ${prereq.code}`,
            isError: true
        };
    }

    try {
        if (name === 'finance_record_expense') {
            const acc = String(args.account || '').trim();
            const amt = Number(args.amount);
            const cat = String(args.category || '其他').trim();
            const desc = String(args.description || '').trim();
            const res = await apiCall('POST', '/api/finance/transactions', {
                data: { account: acc, type: '支出', amount: amt, category: cat, description: desc, tx_date: todayYMD() },
                owner
            });
            return {
                content: JSON.stringify(res),
                summary: `已在【${acc}】记支出 ${amt} 元（${cat}${desc ? ' · ' + desc : ''}）`
            };
        }
        if (name === 'finance_record_income') {
            const acc = String(args.account || '').trim();
            const amt = Number(args.amount);
            const cat = String(args.category || '工资').trim();
            const desc = String(args.description || '').trim();
            const res = await apiCall('POST', '/api/finance/transactions', {
                data: { account: acc, type: '收入', amount: amt, category: cat, description: desc, tx_date: todayYMD() },
                owner
            });
            return {
                content: JSON.stringify(res),
                summary: `已在【${acc}】记收入 ${amt} 元（${cat}${desc ? ' · ' + desc : ''}）`
            };
        }
        if (name === 'finance_query_accounts') {
            const res = await apiCall('GET', '/api/finance/accounts', { owner });
            const count = Array.isArray(res) ? res.length : 0;
            return {
                content: JSON.stringify(res),
                summary: `查询到 ${count} 个财务账户余额`
            };
        }
        if (name === 'finance_query_summary') {
            const res = await apiCall('GET', '/api/finance/summary', { owner });
            return {
                content: JSON.stringify(res),
                summary: '已获取家庭财务概况'
            };
        }
        if (name === 'finance_query_transactions') {
            const limit = Number(args.limit) || 20;
            const params = { limit };
            if (args.account) params.account = String(args.account).trim();
            const res = await apiCall('GET', '/api/finance/transactions', { params, owner });
            return {
                content: JSON.stringify(res),
                summary: '已获取最近流水明细'
            };
        }
        if (name === 'finance_transfer') {
            const fromAcc = String(args.from_account || '').trim();
            const toAcc = String(args.to_account || '').trim();
            const amt = Number(args.amount);
            const desc = String(args.description || '账户转账').trim();
            const res = await apiCall('POST', '/api/finance/transactions', {
                data: { type: '转账', from_account: fromAcc, to_account: toAcc, amount: amt, description: desc, tx_date: todayYMD() },
                owner
            });
            return {
                content: JSON.stringify(res),
                summary: `已从【${fromAcc}】转入【${toAcc}】${amt} 元`
            };
        }
        if (name === 'finance_delete_transaction') {
            const id = String(args.transaction_id || '').trim();
            const res = await apiCall('DELETE', `/api/finance/transactions/${encodeURIComponent(id)}`, { owner });
            return {
                content: JSON.stringify(res),
                summary: `已撤销流水 #${id}`
            };
        }
        return { content: `未知财务工具: ${name}`, isError: true };
    } catch (err) {
        return { content: `财务操作失败: ${err.message || err}`, isError: true, summary: `财务操作失败: ${err.message || err}` };
    }
}

async function runTurn({ client: aiClient, systemInstruction, messages, signal, onDelta, onEvent, maxOutputTokens, temperature, model, extras = null, vision = null, user = null, artifactOwner = '', artifactSession = 'home' }) {
    // 预检前置：如果未配置 API Key 或服务端不通，直接向用户反馈环境状态，避免 LLM 无谓重试与终端探测
    const owner = user?.username || 'admin';
    const prereq = await checkPrerequisites({ owner });
    if (!prereq.ok) {
        const notice = `⚠️ **WISE 家庭财务环境预检未通过**\n\n${prereq.error}\n\n> 💡 **解决指引**：\n> 1. 请在「全局设置 › 保险箱 › API 密钥与 Secret」中添加 \`WISE_API_KEY\` 并保存。\n> 2. 确认 WISE 记账服务正常运行后重新发起记账或查询。`;
        onDelta?.(notice);
        return {
            text: notice,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            toolLog: []
        };
    }

    const result = await agentLoop.runToolLoop({
        extras,
        vision,
        artifactOwner,
        artifactSession: artifactSession || 'home',
        client: aiClient, model, systemPrompt: `${systemInstruction}\n${buildPrompt()}`, messages, tools: definitions(),
        write: event => (event.type === 'delta' ? onDelta?.(event.delta) : onEvent?.(event)),
        signal, maxOutputTokens, temperature, task: String(messages.at(-1)?.content || ''), callIdPrefix: 'finance',
        executeCall: async (call, { start }) => {
            const args = call.args && typeof call.args === 'object' ? call.args : {};
            start({ tool: call.name, args });
            const outcome = await execute(call.name, args, { user });
            return { ...outcome, output: String(outcome.content || '').slice(0, 4000) };
        },
        toolsUnsupported: () => ({ note: '（当前模型不支持工具调用，家庭财务记账工具不可用。）' })
    });
    return { text: result.text, usage: result.usage, toolLog: result.toolLog, ...(result.toolsUnsupported ? { toolsUnsupported: true } : {}) };
}

module.exports = {
    SKILL_ID: 'family-finance-bookkeeper',
    definitions,
    buildPrompt,
    execute,
    runTurn,
    canUseFinance,
    checkPrerequisites,
    getApiKey,
    getBaseUrl
};
