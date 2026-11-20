// Replay frozen histories from evaluate-agent-memory.cjs; score the requested deliverable, not an extracted short answer.
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('../backend/models/ai-provider-client');
const { getRuntimeSettings } = require('../backend/models/ai-settings-repository');
const { closeDatabase } = require('../backend/models/app-db');
const checks = [
    { title: '工单达标', q: '为当期工单写一行核算说明，写清分子、分母和达标率，百分比保留一位小数。', required: [/11/, /17/, /64\.7\s*%/] },
    { title: '展览', q: '请直接写可发的最新展览通知，一句话。', required: [/周六|星期六|礼拜六/, /南厅/], forbidden: [/周四|北厅/] },
    { title: '字段名', q: '给新导出的记录写一个最简 JSON 示例，值固定取 gold。只输出 JSON。', check: text => {
        try { const v = JSON.parse(text.trim()); return v && v.support_band === 'gold' && Object.keys(v).length === 1; } catch { return false; }
    } },
    { title: '交付状态', q: '写一行给客服的交接便签，附流水号和签收时间的核实情况。', required: [/U-429/i, /尚未|未知|待核实|未确认|未签收|待确认|暂无/] },
    { title: '复核范围', q: '请给查数子任务写一句能直接执行的任务说明。', required: [/A-17/i, /分子/, /分母/], forbidden: [/B-31/i] },
    { title: '信息时效', q: '给周四前往仓库的人写一句建议，按最近证据处理开放状态。', required: [/待定|尚未|未确认|确认后|确认.*再|未知|未发布|还未|暂无|请先.*确认/], forbidden: [/正常开放|已确定开放/] },
    { title: '多段读取', q: '写一行交付便签，把专用核验回执号原样交给下游，并说明核验状态。', required: [/RZ-6804/, /已核实|已核验|已确认|核验通过/] },
    { title: '分段阅读', q: '写一句阅读交接，说明已通读到哪一段，下次从哪段开始。', required: [/7|七/, /8|八/] }
];
async function main() {
    const [dest, ...inputs] = process.argv.slice(2);
    if (!dest || !inputs.length) throw Error('用法：输出 JSONL 路径，基础和扩展实验目录');
    const histories = new Map();
    for (const dir of inputs) {
        for (const line of fs.readFileSync(path.join(dir, 'histories.jsonl'), 'utf8').trim().split('\n')) {
            const h = JSON.parse(line);
            histories.set(h.title, h);
        }
    }
    const settings = await getRuntimeSettings();
    const client = createClient({ ...settings, autoSwitchEnabled: false, fallbackProfiles: [] });
    const fd = fs.openSync(dest, 'wx');
    try {
        for (const [i, task] of checks.entries()) {
            const h = histories.get(task.title);
            for (let j = 0; j < 3; j++) {
                const arm = ['none', 'summary', 'raw'][(i + j) % 3];
                const raw = h.history.map(m => m.role + ' ' + (m.toolResults ? JSON.stringify(m.toolResults) : m.content)).join('\n');
                const material = { raw, summary: h.summary, none: '' }[arm];
                const result = await client.generateChat({systemInstruction: '你是团队助手。根据可用的资料完成当前请求；无法核实的事实请说明。',
                    messages: [{role: 'user', content: '历史资料：\n' + material + '\n\n当前请求：' + task.q}],
                    temperature: 0, maxOutputTokens: 350, signal: AbortSignal.timeout(60000) });
                const text = result.text || '';
                const pass = task.check ? task.check(text) : task.required.every(pattern => pattern.test(text))
                    && !(task.forbidden || []).some(pattern => pattern.test(text));
                fs.writeSync(fd, JSON.stringify({ title: task.title, question: task.q, arm, text, pass, usage: result.usage }) + '\n');
            }
        }
    } finally { fs.closeSync(fd); }
}
main().catch(error => {console.error(error.code || error.name);process.exitCode=1;}).finally(closeDatabase);
