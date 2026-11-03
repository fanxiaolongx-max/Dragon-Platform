const test = require('node:test');
const assert = require('node:assert/strict');
const { trackRounds, summarizeRounds, estimateTokens } = require('../backend/models/ai-round-tracker');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('each model call becomes a round with tokens, first-token time and generation speed', async () => {
    const client = {
        provider: 'openai', model: 'demo',
        async generateText(options) {
            await wait(30);
            options.onDelta?.('你好');
            await wait(40);
            options.onDelta?.('，世界');
            return { text: '你好，世界', usage: { promptTokens: 120, outputTokens: 8 } };
        },
        other: () => 'kept'
    };
    const rounds = [];
    const tracked = trackRounds(client, round => rounds.push(round));
    const deltas = [];
    const result = await tracked.generateText({ onDelta: delta => deltas.push(delta) });
    assert.equal(result.text, '你好，世界');
    assert.deepEqual(deltas, ['你好', '，世界']);
    assert.equal(tracked.other(), 'kept');
    assert.equal(rounds.length, 1);
    const [round] = rounds;
    assert.equal(round.index, 1);
    assert.equal(round.model, 'openai/demo');
    assert.equal(round.inputTokens, 120);
    assert.equal(round.outputTokens, 8);
    assert.equal(round.estimated, false);
    assert.ok(round.ttftMs >= 25 && round.ttftMs < round.ms);
    assert.ok(round.generationMs < round.ms, 'speed counts from the first token');
    assert.ok(round.tps > 0);
});

test('missing usage is estimated and flagged; failed calls are not counted', async () => {
    const rounds = [];
    let fail = false;
    const tracked = trackRounds({ async generateChat() { if (fail) throw new Error('boom'); return { text: 'a'.repeat(400) }; } }, round => rounds.push(round));
    await tracked.generateChat({});
    fail = true;
    await assert.rejects(() => tracked.generateChat({}), /boom/);
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].estimated, true);
    assert.equal(rounds[0].outputTokens, estimateTokens('a'.repeat(400)));
});

test('the average weights long replies by total tokens over total generation time', () => {
    const summary = summarizeRounds([
        { tps: 10, outputTokens: 10, generationMs: 1000, ms: 1200 },
        { tps: 100, outputTokens: 1000, generationMs: 10000, ms: 10500 }
    ]);
    assert.equal(summary.rounds, 2);
    assert.equal(summary.minTps, 10);
    assert.equal(summary.maxTps, 100);
    assert.equal(summary.avgTps, 91.8);
    assert.equal(summary.outputTokens, 1010);
    assert.equal(summary.totalMs, 11700);
});
