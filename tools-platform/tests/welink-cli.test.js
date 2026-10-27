const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'welink-cli-test-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');

const runner = require('../backend/models/channels/welink-cli-runner');
const agent = require('../backend/models/channels/welink-cli-agent');
const { runWithTenant } = require('../backend/models/tenant-context');

// 假 welink-cli：按参数模拟真实输出（进度行 + JSON、扫码登录过程、未登录报错）
const packageDir = path.join(sandbox, 'npm', 'node_modules', '@welink', 'welink-cli');
fs.mkdirSync(path.join(packageDir, 'bin'), { recursive: true });
fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@welink/welink-cli', version: '1.0.16', bin: { 'welink-cli': 'bin/welink.js' } }));
fs.writeFileSync(path.join(packageDir, 'bin', 'welink.js'), `
const args = process.argv.slice(2);
const key = args.slice(0, 2).join(' ');
if (args[0] === '--version') { console.log('1.0.16'); process.exit(0); }
if (key === 'auth status') { console.log('Login status: logged in'); process.exit(0); }
if (key === 'auth login') {
  console.log('Connecting to WeLink PC...');
  console.log('  Connected successfully');
  console.log('Obtaining QR code...');
  console.log('+----------------------------------------+');
  console.log('|  ██  ██  |');
  console.log('+----------------------------------------+');
  console.log('If QR code is not displayed correctly, open this URL to scan:');
  console.log('https://api.inner.welink.huawei.com/qrcodeg/service/internal/public/v1/qrcodes/img/AbC-123');
  process.stdout.write('Waiting for scan... (elapsed 3 seconds)\\r');
  console.log('Scan successful! Obtaining login credentials...');
  console.log('Login successful. Credentials cached.');
  process.exit(0);
}
if (key === 'im query-recent-conversation') { console.error('Error: not logged in, run welink-cli auth login'); process.exit(1); }
console.log('Connecting to WeLink PC...');
console.log(JSON.stringify({ argv: args, data: [{ w3account: 'a00123456' }] }, null, 2));
`);

runner.setOverridesForTest({ configFile: path.join(sandbox, 'welink-cli.json'), logFile: path.join(sandbox, 'logs', 'welink-cli.log') });
const inDefault = fn => runWithTenant('default', fn);

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('locates welink-cli from a custom folder or an npm .cmd shim and reads the bin entry', () => {
    const entry = path.join(packageDir, 'bin', 'welink.js');
    assert.equal(runner.entryFromCustomPath(path.join(sandbox, 'npm')).entry, entry);
    assert.equal(runner.entryFromCustomPath(packageDir).version, '1.0.16');
    const shim = path.join(sandbox, 'npm', 'welink-cli.cmd');
    fs.writeFileSync(shim, '@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@welink\\welink-cli\\bin\\welink.js" %*\r\n');
    assert.equal(runner.entryFromCmdShim(shim).entry, entry);
    assert.equal(runner.entryFromCustomPath(path.join(sandbox, 'nope')), null);
});

test('parses JSON after progress lines and interprets auth status loosely', () => {
    assert.deepEqual(runner.parseOutput('Connecting to WeLink PC...\n  Connected\n[{"a":1}]').json, [{ a: 1 }]);
    assert.deepEqual(runner.parseOutput('{"success":true}').json, { success: true });
    assert.equal(runner.parseOutput('plain text only').json, null);
    assert.equal(runner.interpretAuthStatus({ ok: true, text: 'Not logged in', stderr: '' }).loggedIn, false);
    assert.equal(runner.interpretAuthStatus({ ok: true, text: 'Logged in as a00123456', stderr: '' }).loggedIn, true);
    assert.equal(runner.interpretAuthStatus({ ok: true, json: { isLoggedIn: false }, text: '{}', stderr: '' }).loggedIn, false);
    assert.equal(runner.interpretAuthStatus({ ok: true, text: 'something new', stderr: '' }).loggedIn, null);
    // welink-cli 1.0.16 的真实输出
    const real = runner.interpretAuthStatus({ ok: true, stderr: '', text: 'Configuration:\n  Environment:  pro\n\nCredentials:\n  User Token:   valid (expires in 62m34s)\n  UID:          dwx1545337' });
    assert.deepEqual({ loggedIn: real.loggedIn, uid: real.uid, environment: real.environment, expiresIn: real.expiresIn, refreshing: real.refreshing },
        { loggedIn: true, uid: 'dwx1545337', environment: 'pro', expiresIn: '62m34s', refreshing: false });
    assert.equal(runner.interpretAuthStatus({ ok: true, stderr: '', text: 'Credentials:\n  User Token:   expired\n  Refresh Token:   valid (expires in 6d)\n  UID:  dwx1' }).refreshing, true);
    assert.equal(runner.interpretAuthStatus({ ok: true, stderr: '', text: 'Credentials:\n  User Token:   invalid\n  UID:  dwx1' }).loggedIn, false);
    assert.equal(runner.interpretAuthStatus({ ok: true, stderr: '', text: 'Credentials:\n  User Token:   not found' }).loggedIn, false);
    assert.deepEqual(runner.classifyLoginLine('Waiting for scan... (elapsed 19 seconds)'), { type: 'waiting', elapsed: 19 });
    assert.equal(runner.classifyLoginLine('https://api.inner.welink.huawei.com/qrcodeg/service/internal/public/v1/qrcodes/img/AytLeg-PwOU').type, 'qrcode');
});

test('only whitelisted read commands with validated options become argument arrays', () => {
    assert.deepEqual(agent.buildArgs({ command: 'search person', options: { text: '张三', pageSize: 10 } }).args, ['search', 'person', '--text', '张三', '--page-size', '10']);
    assert.deepEqual(agent.buildArgs({ command: 'contact favorite_list', options: { 'page-index': 2 } }).args, ['contact', 'favorite_list', '--pageIndex', '2']);
    assert.deepEqual(agent.buildArgs({ command: 'contact detail', accounts: ['id1', 'id2'] }).args, ['contact', 'detail', 'id1', 'id2']);
    assert.deepEqual(agent.buildArgs({ command: 'mail list', options: { 'is-read': 0, start: '2026-10-27' }, timezone: 'Egypt Standard Time' }).args,
        ['mail', '--timezone', 'Egypt Standard Time', 'list', '--is-read', '0', '--start', '2026-10-27']);
    assert.deepEqual(agent.buildArgs({ command: 'onebox node-search', options: { 'space-id': '1', name: '报告', 'with-path': true, 'exact-search': false } }).args,
        ['onebox', 'node-search', '--space-id', '1', '--name', '报告', '--with-path']);
    assert.deepEqual(agent.buildArgs({ command: 'meeting fuzzy-search', options: { resultType: 'meeting', limit: 5, offset: 0 }, search: [{ type: 'subject', content: '周会' }] }).args,
        ['meeting', 'fuzzy-search', '--result-type', 'meeting', '--limit', '5', '--offset', '0', '--search-type', 'subject', '--search-content', '周会']);
    for (const bad of [
        { command: 'im send-to-user', options: { receiver: 'a', text: 'hi' } },
        { command: 'mail send' },
        { command: 'search person', options: { text: '--help' } },
        { command: 'search person', options: { text: 'x', receiver: 'y' } },
        { command: 'search person' },
        { command: 'im query-history-message', options: { 'group-id': '1', 'user-account': 'a' } },
        { command: 'meeting query-list', options: { 'meeting-start-time': '2026-10-27', 'meeting-end-time': '1761494400000', type: 1, 'meeting-sort': 'asc', page: 1, size: 10 } },
        { command: 'mail list', options: { start: '27/10/2026' } },
        { command: 'mail list', timezone: '-x' }
    ]) assert.throws(() => agent.buildArgs(bad), /不支持|不能|缺少|只能|应为|需要/, JSON.stringify(bad));
});

test('runs the CLI with node directly, reports failures, and refuses when disabled or outside the default tenant', async () => {
    runner.saveConfig({ cliPath: packageDir, enabled: false });
    await inDefault(async () => {
        const install = await runner.detect({ refresh: true });
        assert.equal(install.available, true);
        assert.equal(await runner.version(), '1.0.16');
        assert.equal((await runner.authStatus()).loggedIn, true);

        const disabled = await agent.execute({}, 'welink_query', { command: 'search person', options: { text: '张三' } });
        assert.equal(disabled.isError, true);
        assert.match(disabled.content, /尚未.*启用/);

        runner.saveConfig({ enabled: true });
        const ok = await agent.execute({}, 'welink_query', { command: 'search person', options: { text: '张 三; rm -rf /' } });
        assert.equal(ok.isError, undefined);
        assert.deepEqual(JSON.parse(ok.content).argv, ['search', 'person', '--text', '张 三; rm -rf /']);
        assert.equal(ok.summary, '搜索联系人 1 条');

        const failed = await agent.execute({}, 'welink_query', { command: 'im query-recent-conversation' });
        assert.equal(failed.isError, true);
        assert.match(failed.content, /not logged in/);
        assert.match(await agent.buildPrompt(), /welink_query/);
    });
    await runWithTenant('other', async () => {
        const result = await agent.execute({}, 'welink_query', { command: 'search person', options: { text: 'x' } });
        assert.match(result.content, /默认租户/);
        assert.match(await agent.buildPrompt(), /默认租户/);
    });
});

test('login streams the QR URL, text QR and progress, then succeeds', async () => {
    runner.saveConfig({ cliPath: packageDir, env: 'pro' });
    const events = [];
    await inDefault(() => runner.login({ onEvent: event => events.push(event) }));
    const types = events.map(event => event.type);
    assert.ok(types.includes('qrtext'));
    assert.equal(events.find(event => event.type === 'qrcode').url, 'https://api.inner.welink.huawei.com/qrcodeg/service/internal/public/v1/qrcodes/img/AbC-123');
    assert.deepEqual(events.find(event => event.type === 'waiting'), { type: 'waiting', elapsed: 3 });
    assert.ok(types.indexOf('scanned') < types.indexOf('success'));
});

test('every CLI call is logged with duration, exit code and output, in memory and on disk', async () => {
    runner.saveConfig({ cliPath: packageDir, enabled: true });
    runner.clearLogs();
    await inDefault(async () => {
        await runner.run(['search', 'person', '--text', '张 三']);
        await runner.run(['im', 'query-recent-conversation']);
    });
    const { items, running, file } = runner.logs();
    assert.equal(running, null);
    assert.equal(items.length, 2);
    assert.equal(items[0].command, 'welink-cli im query-recent-conversation');
    assert.equal(items[0].code, 1);
    assert.match(items[0].stderr, /not logged in/);
    assert.equal(items[1].command, 'welink-cli search person --text "张 三"');
    assert.equal(items[1].code, 0);
    assert.match(items[1].stdout, /Connecting to WeLink PC/);
    assert.equal(typeof items[1].durationMs, 'number');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(line => line.command), [items[1].command, items[0].command]);
    runner.clearLogs();
    assert.equal(runner.logs().items.length, 0);
    assert.equal(fs.existsSync(file), false);
});

test('runTurn streams tool rows, adds raw output in verbose mode, and nudges a promise-only reply', async () => {
    runner.saveConfig({ cliPath: packageDir, enabled: true, verbose: false });
    const replies = [
        { text: '好的，我来帮你查询，请稍等……' },
        { text: '', toolCalls: [{ id: 'c1', name: 'welink_query', args: { command: 'search person', options: { text: '张三' } } }] },
        { text: '找到 1 人。' }
    ];
    const seen = [];
    const client = { generateText: async ({ messages }) => { seen.push(messages.map(item => item.role)); return replies.shift(); } };
    const events = [];
    const result = await inDefault(() => agent.runTurn({ client, systemInstruction: '', messages: [{ role: 'user', content: '找张三' }], onEvent: event => events.push(event) }));
    assert.equal(result.text, '找到 1 人。');
    assert.deepEqual(seen[1].slice(-2), ['model', 'user'], 'the promise-only reply gets one nudge');
    assert.deepEqual(events.map(event => event.type), ['tool_start', 'tool_result']);
    assert.equal(events[0].tool, 'welink_query');
    assert.equal(events[0].args.command, 'welink-cli search person --text 张三');
    assert.equal(events[1].ok, true);
    assert.equal(events[1].output, undefined, 'raw output only in verbose mode');

    runner.saveConfig({ verbose: true });
    const verboseEvents = [];
    const once = [{ text: '', toolCalls: [{ id: 'c2', name: 'welink_query', args: { command: 'im query-recent-conversation' } }] }, { text: '没登录' }];
    await inDefault(() => agent.runTurn({ client: { generateText: async () => once.shift() }, systemInstruction: '', messages: [{ role: 'user', content: 'x' }], onEvent: event => verboseEvents.push(event) }));
    const failed = verboseEvents.find(event => event.type === 'tool_result');
    assert.equal(failed.ok, false);
    assert.match(failed.output, /^\$ welink-cli im query-recent-conversation/);
    assert.match(failed.output, /not logged in/);

    // 没有「请稍等」之类的承诺语时不补提示
    const plain = [{ text: '你好' }];
    let calls = 0;
    await inDefault(() => agent.runTurn({ client: { generateText: async () => { calls += 1; return plain.shift(); } }, systemInstruction: '', messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(calls, 1);
    runner.saveConfig({ verbose: false });
});

test('welink-office skill is listed as a non-workspace builtin skill', () => {
    const skills = require('../backend/models/agent-skills');
    const skill = skills.list().find(item => item.id === agent.SKILL_ID);
    assert.equal(skill.workspace, false);
    assert.deepEqual(skills.select('@welink-office 看看今天的会').map(item => item.id), ['welink-office']);
});
