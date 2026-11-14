// WISE 家庭财务记账助手专用原生工具集
// 直接连接外部 WISE 财务系统 (https://wise.fanxiaolong.uk/family_finance)
// 供智能体自主记支出、记收入、转账、查余额与查流水
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT_PATH = path.resolve(__dirname, '../agent-skills/family-finance-bookkeeper/scripts/quick_record.py');

function runQuickRecord(args) {
    return new Promise((resolve, reject) => {
        execFile('python3', [SCRIPT_PATH, ...args], { timeout: 15000 }, (error, stdout, stderr) => {
            if (error) {
                const msg = stderr ? stderr.trim() : error.message;
                return reject(new Error(msg || '执行记账脚本失败'));
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
            } catch (_e) {
                resolve({ raw: stdout.trim() });
            }
        });
    });
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
- 当用户要求记账、查余额、查流水或转账时，**必须直接调用上述 finance_* 工具**。
- **严禁调用 insert_database_row / list_databases / database_schema 等平台数据库工具**：WISE 财务数据存储在独立的外部系统 (https://wise.fanxiaolong.uk)，本地平台 SQLite 库没有财务表。
- 记账或转账成功后，清晰告知用户记账详情及受影响账户的最新余额。`;
}

async function execute(name, args = {}) {
    try {
        if (name === 'finance_record_expense') {
            const acc = String(args.account || '').trim();
            const amt = Number(args.amount);
            const cat = String(args.category || '其他').trim();
            const desc = String(args.description || '').trim();
            const res = await runQuickRecord([acc, String(amt), cat, desc]);
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
            const res = await runQuickRecord(['--income', acc, String(amt), cat, desc]);
            return {
                content: JSON.stringify(res),
                summary: `已在【${acc}】记收入 ${amt} 元（${cat}${desc ? ' · ' + desc : ''}）`
            };
        }
        if (name === 'finance_query_accounts') {
            const res = await runQuickRecord(['--accounts']);
            const count = Array.isArray(res) ? res.length : 0;
            return {
                content: JSON.stringify(res),
                summary: `查询到 ${count} 个财务账户余额`
            };
        }
        if (name === 'finance_query_summary') {
            const res = await runQuickRecord(['--summary']);
            return {
                content: JSON.stringify(res),
                summary: '已获取家庭财务概况'
            };
        }
        if (name === 'finance_query_transactions') {
            const cliArgs = ['--transactions', String(args.limit || 20)];
            if (args.account) cliArgs.push(String(args.account).trim());
            const res = await runQuickRecord(cliArgs);
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
            const res = await runQuickRecord(['--transfer', fromAcc, toAcc, String(amt), desc]);
            return {
                content: JSON.stringify(res),
                summary: `已从【${fromAcc}】转入【${toAcc}】${amt} 元`
            };
        }
        if (name === 'finance_delete_transaction') {
            const id = String(args.transaction_id || '').trim();
            const res = await runQuickRecord(['--delete', id]);
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

module.exports = {
    SKILL_ID: 'family-finance-bookkeeper',
    definitions,
    buildPrompt,
    execute
};
