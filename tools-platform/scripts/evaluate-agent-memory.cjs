// Run explicitly: node scripts/evaluate-agent-memory.cjs <new-results-directory>
// Uses the configured chat provider and records normal billable usage. No production chats are read.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const extended = require('../tests/fixtures/memory-eval/extended.cjs');
const cases = process.argv.includes('--extended') ? extended : require('../tests/fixtures/memory-eval/cases.cjs');
const { summarize } = require('../backend/models/ai-context-compaction');
const settingsRepo = require('../backend/models/ai-settings-repository');
const { createClient } = require('../backend/models/ai-provider-client');
const { closeDatabase } = require('../backend/models/app-db');

const sideTopics = [
    ['读书会', '座位牌用浅蓝字，最终海报待确认。'],
    ['桌面图标', '图标暂用灰色，等待视觉评审后再决定。'],
    ['茶水间', '下午补充纸杯，清点清单另行归档。'],
    ['入门培训', '先演示如何查看帮助，再让学员练习搜索。'],
    ['海报样稿', '本轮先保留空白边距，图片比例沿用旧版。'],
    ['样品柜', '摆放次序可调整，目前只核对标签是否清晰。']
];
const independent = [
    ['把英文单词 blue 翻译成中文，只给颜色名。', '蓝色'],
    ['新问题，7乘以8等于多少？', '56'],
    ['从“桌子，橘子，椅子”中选出水果，只给名称。', '橘子'],
    ['这次只提取“编号 KV-581，颜色蓝”中的编号。', 'KV-581'],
    ['What is the plural of mouse (animal)?', 'mice'],
    ['把日期 2031-04-17 的月份写成数字，去掉前导零。', '4']
];

function historyFor(index, background) {
    // Four lengths, with the target appearing near the start, middle or end.
    const turns = 3 + (index % 4) * 7;
    const history = [];
    const target = background.split('||');
    const position = [0, Math.floor(turns / 2), turns][Math.floor(index / 4) % 3];
    for (let i = 0; i <= turns; i++) {
        if (i === position) {
            for (const content of target) {
                history.push({ role: 'user', content }, { role: 'model', content: '收到。' });
            }
        }
        if (i < turns) {
            const [name, detail] = sideTopics[(i + index) % sideTopics.length];
            history.push({ role: 'user', content: '另开一项内部讨论，' + name + '，批次 S-' + (i + 20) + '。' + detail },
                { role: 'model', content: '已列为该批次的讨论事项，最后版仍以负责人确认的信息为准。' });
        }
    }
    return history.map((row, i) => ({ ...row, id: 'm' + (i + 1) }));
}

function normalize(value) {
    return String(value).normalize('NFKC').trim().replace(/[。.!！]$/, '').toLowerCase();
}

function transcript(rows) {
    return rows.map(row => '[' + (row.id || '') + ' ' + row.role + '] '
        + (row.toolResults || row.toolCalls ? JSON.stringify(row.toolResults || row.toolCalls) : row.content)).join('\n');
}

async function run() {
    if (!process.argv[2]) throw new Error('请指定一个新的结果目录。');
    const dest = path.resolve(process.argv[2]);
    fs.mkdirSync(dest);
    const settings = await settingsRepo.getRuntimeSettings();
    if (!settings.hasApiKey) throw new Error('对话模型尚未配置。');
    const client = createClient({ ...settings, autoSwitchEnabled: false, fallbackProfiles: [] });
    const emit = (file, row) => fs.appendFileSync(path.join(dest, file), JSON.stringify(row) + '\n');
    const meta = { model: settings.model, provider: settings.provider, started: new Date().toISOString(), histories: cases.length, repeats: 2 };
    fs.writeFileSync(path.join(dest, 'run.json'), JSON.stringify(meta, null, 2));
    const ablation = process.argv.includes('--ablation');
    const arms = ablation ? ['ablated'] : ['raw', 'summary', 'none'];
    const instruction = '你正在完成独立问题。历史资料仅在适用时使用，当前明确要求优先。根据已知信息回答；依据不足时仅答“未知”。只给所问的值，数量写阿拉伯数字，不加解释或单位。';
    let next = 0;
    async function worker() {
        while (next < cases.length) {
            const index = next++;
            const [family, title, background, question, answer, override, replacement] = cases[index];
            const history = historyFor(index, background);
            history.push(...extended.toolHistory(title));
            const raw = transcript(history);
            const writerCalls = [];
            const writer = { generateText: async options => {
                const start = performance.now();
                const result = await client.generateText(options);
                writerCalls.push({ usage: result.usage, ms: Math.round(performance.now() - start) });
                return result;
            } };
            const summary = ablation ? '' : await summarize({ client: writer, entries: history, signal: AbortSignal.timeout(120000) });
            emit('histories.jsonl', { index, family, title, history, summary, writerCalls });
            const [unrelated, independentAnswer] = independent[index % independent.length];
            const probes = [['recall', question, answer]];
            if (!ablation) probes.push(['override', override, replacement], ['switch', unrelated, independentAnswer]);
            // Keep every distractor and its original message ID. Remove only the focal episode.
            const unrelatedHistory = transcript(history.filter(row => row.content?.startsWith('另开一项内部讨论，')
                || row.content === '已列为该批次的讨论事项，最后版仍以负责人确认的信息为准。'));
            for (let repeat = 0; repeat < meta.repeats; repeat++) {
                for (const [probeIndex, [kind, q, expected]] of probes.entries()) {
                    for (let step = 0; step < arms.length; step++) {
                        const arm = arms[(step + index + repeat + probeIndex) % arms.length];
                        const material = { raw, summary, none: '', ablated: unrelatedHistory }[arm];
                        const start = performance.now();
                        const result = await client.generateChat({
                            systemInstruction: instruction,
                            messages: [{ role: 'user', content: '历史资料：\n' + material + '\n\n当前问题：' + q }],
                            maxOutputTokens: 128, temperature: 0, signal: AbortSignal.timeout(60000)
                        });
                        emit('answers.jsonl', { index, family, title, kind, question: q, repeat, arm, expected,
                            actual: result.text, pass: normalize(result.text) === normalize(expected),
                            ms: Math.round(performance.now() - start), usage: result.usage });
                    }
                }
            }
            console.log('完成', index + 1, title);
        }
    }
    await Promise.all(Array.from({ length: 5 }, worker));
    console.log('完成全部实验，结果目录', dest);
}

run().catch(error => { console.error('实验中断', error.code || error.name, String(error.message).slice(0, 120)); process.exitCode = 1; }).finally(closeDatabase);
