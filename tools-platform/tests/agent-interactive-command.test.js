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
