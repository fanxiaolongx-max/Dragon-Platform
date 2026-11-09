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
            return { text: '你好，世界', usage: { promptTokens: 120, outputTokens: 8, reasoningTokens: 0, cachedTokens: 60 } };
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
    assert.equal(round.decodeTokens, 7);
    assert.equal(round.cachedInputTokens, 60);
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

test('buffered and reasoning-bearing responses do not invent decode speed', async () => {
    const rounds = [];
    const client = trackRounds({ async generateText(o) { o.onReasoning?.('thinking'); return { text: 'answer', usage: { promptTokens: 10, outputTokens: 5, reasoningTokens: 2 } }; } }, r => rounds.push(r));
    await client.generateText({ onReasoning() {} });
    assert.equal(rounds[0].ttftMs, null);
    assert.equal(rounds[0].generationMs, null);
    assert.equal(rounds[0].tps, null);
    assert.equal(summarizeRounds(rounds).avgTps, 0);
});

test('tool-loop follow-up calls through result.providerClient stay tracked', async () => {
    const other = { provider: 'openai', model: 'b', async generateText() { return { text: 'x', usage: { outputTokens: 1 }, providerClient: this }; } };
    const raw = { provider: 'gemini', model: 'a', calls: 0, async generateText() { this.calls += 1; return { text: '', usage: { outputTokens: 3 }, providerClient: this.calls > 1 ? other : this }; } };
    const rounds = [];
    const client = trackRounds(raw, round => rounds.push(round));
    const first = await client.generateText({});
    assert.equal(first.providerClient, client);
    const second = await first.providerClient.generateText({});
    const third = await second.providerClient.generateText({});
    assert.equal(third.providerClient, second.providerClient);
    assert.deepEqual(rounds.map(round => [round.index, round.model]), [[1, 'gemini/a'], [2, 'gemini/a'], [3, 'openai/b']]);
});
