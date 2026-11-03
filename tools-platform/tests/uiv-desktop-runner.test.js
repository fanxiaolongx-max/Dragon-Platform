const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { prepareMacro, substitute, runMacro, createUivBatchRunner } = require('../desktop-promo/uiv-batch-runner');
const command = (Command, Target = '', Value = '') => ({ Command, Target, Value });

function fixture() {
    const context = vm.createContext({ window: { results: [], count: 0 } });
    const wc = new EventEmitter();
    wc.isDestroyed = () => false;
    wc.executeJavaScript = async code => vm.runInContext(code, context);
    wc.loadURL = async url => { context.window.results.push(url); wc.emit('dom-ready'); };
    return { page: { webContents: wc }, context };
}

test('desktop batch preserves async results, quoted JSON, login loops, stop jumps and sequential navigation', async () => {
    const { page, context } = fixture();
    await runMacro({ Commands: [
        command('open', 'https://example.com/a'),
        command('executeScript', 'return JSON.stringify({text:"quote\\\" and apostrophe\'"});', 'payload'),
        command('executeScript', "window.results.push(JSON.parse('${payload}').text);"),
        command('store', 'false', 'loggedIn'),
        command('while_v2', '${loggedIn} != "true"'),
        command('executeScript', 'window.count++; return window.count >= 2 ? "true" : "false";', 'loggedIn'),
        command('pause', '1'), command('endWhile'),
        command('open', 'https://example.com/b'),
        command('executeScript', 'return Promise.resolve("stop");', 'control'),
        command('gotoIf_v2', '${control} == "stop"', 'stopped'),
        command('executeScript', 'throw Error("should skip");'),
        command('label', 'stopped'), command('executeScript', 'window.results.push("finished");')
    ] }, page, { wait: async () => {} });
    assert.deepEqual(Array.from(context.window.results), ['https://example.com/a', 'quote" and apostrophe\'', 'https://example.com/b', 'finished']);
    assert.equal(context.window.count, 2);
    assert.equal(page.webContents.listenerCount('destroyed'), 0);
});

test('macro preparation rejects unsupported commands, unsafe protocols, missing labels and unbalanced loops before launch', () => {
    for (const Commands of [[], [command('click')], [command('open', 'file:///tmp/secret')], [command('gotoLabel', 'missing')], [command('while_v2', 'true')], [command('endWhile')]]) {
        assert.throws(() => prepareMacro({ Commands }));
    }
    assert.equal(substitute('return `${internal}` + ${known};', { known: 'value' }, true), 'return `${internal}` + "value";');
});

test('active desktop runs reject duplicate scheduled launches and release the slot when their tab closes', async () => {
    const { page } = fixture();
    let release;
    page.webContents.executeJavaScript = () => new Promise(resolve => { release = resolve; });
    const runner = createUivBatchRunner({ openPage: async () => page, onError: () => {} });
    const macro = { Commands: [command('executeScript', 'return 1;')] };
    assert.equal((await runner.start(macro)).mode, 'desktop-native');
    await assert.rejects(runner.start(macro), /already running/);
    page.webContents.isDestroyed = () => true;
    page.webContents.emit('destroyed');
    release(1);
    assert.equal((await runner.start(macro)).success, true);
});
