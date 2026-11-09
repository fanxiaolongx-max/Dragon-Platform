const test = require('node:test');
const assert = require('node:assert/strict');
const { interactiveUpgrade } = require('../backend/models/agent-tools-service');
const { plainOutput } = require('../backend/models/terminal-sessions');

test('login commands are upgraded to the interactive terminal; echo-piped credentials are stripped', () => {
    assert.deepEqual(interactiveUpgrade('echo "eyJabc=" | thcli auth login --browser no'), { command: 'thcli auth login --browser no', stripped: true });
    assert.deepEqual(interactiveUpgrade('thcli auth login --browser no'), { command: 'thcli auth login --browser no', stripped: false });
    assert.ok(interactiveUpgrade('npm login'));
    assert.ok(interactiveUpgrade('cd app && gh auth login'));
    for (const command of ['gh auth login --with-token < token.txt', 'thcli auth status', 'thcli auth login --help', 'echo hi | grep login',
        'git log --grep login', 'ls login', 'sudo login', 'echo login', 'npm i -g tencent-tokenhub-cli && thcli --version']) {
        assert.equal(interactiveUpgrade(command), null, command);
    }
});

test('interactive output strips terminal control codes and hides what the user typed', () => {
    const raw = '\x1b]0;title\x07\x1b[32m请粘贴凭据:\x1b[0m eyJsecret-token\r\nprogress 10%\rprogress 100%\r\n收到 eyJsecret-token\r\n';
    const text = plainOutput(raw, ['eyJsecret-token\r']);
    assert.equal(text, '请粘贴凭据: [用户输入已隐藏]\nprogress 100%\n收到 [用户输入已隐藏]');
});

test('multi-line login commands are detected and self-killing pkill segments are dropped', () => {
    assert.deepEqual(interactiveUpgrade('pkill -f "thcli auth login"\nthcli auth login --browser no'), { command: 'thcli auth login --browser no', stripped: false, droppedKill: true });
    assert.deepEqual(interactiveUpgrade('pkill -f "thcli auth login" || true; thcli auth login --browser no'), { command: 'thcli auth login --browser no', stripped: false, droppedKill: true });
    assert.equal(interactiveUpgrade('pkill -f "thcli auth login"'), null);
    assert.equal(interactiveUpgrade('ps aux | grep login'), null);
});

test('the interactive tab banner is shown to the user but not returned to the model', async () => {
    const { createCommand } = require('../backend/models/terminal-sessions');
    const handle = createCommand('test-owner', { command: 'echo done', cwd: process.cwd(), banner: '提示：只给用户看' });
    await handle.wait();
    const { output } = handle.snapshot();
    assert.ok(output.includes('done'));
    assert.ok(!output.includes('只给用户看'));
});

test('background nohup login commands run in the foreground interactive terminal instead', () => {
    assert.deepEqual(interactiveUpgrade('nohup thcli auth login > /tmp/thcli-login.log 2>&1 & sleep 2 && cat /tmp/thcli-login.log'), { command: 'thcli auth login', stripped: false, background: true });
    assert.deepEqual(interactiveUpgrade('gh auth login --web >/tmp/gh.log 2>&1 &'), { command: 'gh auth login --web', stripped: false, background: true });
    assert.equal(interactiveUpgrade('nohup node server.js > out.log 2>&1 &'), null);
    assert.equal(interactiveUpgrade('nohup thcli auth status > /tmp/s.log 2>&1 &'), null);
});
