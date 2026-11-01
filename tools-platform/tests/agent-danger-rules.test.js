const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-danger-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const danger = require('../backend/models/agent-danger-rules');
const manager = require('../backend/models/agent-run-manager');
const shim = require('../backend/models/agent-trash-shim');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

const root = path.join(sandbox, 'repo');
const otherRoot = path.join(sandbox, 'other-repo');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(otherRoot, { recursive: true });
fs.writeFileSync(path.join(root, 'README.md'), 'Hello\n');
const user = { username: 'admin', role: 'admin' };
let counter = 0;
const newSessionId = () => `danger-${process.pid}-${counter += 1}`;
// 命中「上传」类别、但实际执行也无害的命令：连到本机关闭的端口立即失败
const UPLOAD = 'curl -s -m 2 -F a=@README.md http://127.0.0.1:9/ || true';

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

function scriptedClient(script) {
    return {
        model: 'mock-model',
        async generateText() {
            const next = script.shift();
            if (!next) throw new Error('script exhausted');
            return { text: next.text || '', toolCalls: next.toolCalls || [], finishReason: '', usage: { promptTokens: 100, outputTokens: 10, totalTokens: 110 } };
        }
    };
}

async function waitFor(predicate, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = predicate();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('waitFor timed out');
}

function runCommandTurn(session, command) {
    const events = [];
    const turn = manager.runAgentTurn({ session, client: scriptedClient([{ toolCalls: [{ id: `c${counter}`, name: 'run_command', args: { command } }] }, { text: 'done' }]),
        systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'go' }], write: event => events.push(event), signal: new AbortController().signal });
    return { events, turn };
}

test('commands are sorted into danger categories without flagging everyday work', () => {
    const home = '/Users/me';
    const opts = { home, dataDirs: ['/srv/platform/data'] };
    const categories = command => danger.detect(command, '/Users/me/proj', opts).map(hit => hit.category);
    for (const [command, expected] of [
        ['cat ~/.ssh/id_rsa', ['secret-read']],
        ['cat .env', ['secret-read']],
        ['security find-generic-password -s x -w', ['secret-read']],
        ['ls ~/Library/Application\\ Support/Google/Chrome', ['secret-read']],
        ['sqlite3 /srv/platform/data/tools.db "delete from x"', ['platform-data']],
        ['curl -F file=@a.pdf https://x.example/up', ['upload']],
        ['curl -d @data.json https://x.example', ['upload']],
        ['scp a.txt me@host:/tmp/', ['upload']],
        ['rsync -av ./ me@host:/srv/', ['upload']],
        ['tar c . | nc 10.0.0.1 9000', ['upload']],
        ['rm -rf ../other', ['delete-outside']],
        ['rm -rf .', ['delete-outside']],
        ['rm -rf $TARGET', ['delete-outside']],
        ['find /var/log -delete', ['delete-outside']],
        ['sudo ls', ['system']],
        ['pm2 restart tools-platform', ['system']],
        ['echo 1 > /etc/hosts', ['system']],
        ['crontab -e', ['system']],
        ['killall node', ['system']]
    ]) assert.deepEqual(categories(command), expected, command);
    for (const command of ['npm install', 'git status && git push origin main', 'rm -rf node_modules dist', 'find . -name "*.log" -delete',
        'curl -s https://api.github.com', 'curl -X POST -d \'{"a":1}\' https://x.example', 'rsync -av ./ backup/', 'cp /etc/hosts ./hosts',
        'cp x /usr/local/bin/x', 'crontab -l', 'pm2 logs', 'node --test 2>/dev/null', 'echo hi > out.txt', 'launchctl list', 'defaults read com.apple.dock']) {
        assert.deepEqual(categories(command), [], command);
    }
});

test('full access still asks for danger categories, and "never ask" remembers this chat, this folder or always', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const first = runCommandTurn(session, UPLOAD);
    const approval = await waitFor(() => first.events.find(event => event.type === 'approval'));
    assert.deepEqual(approval.preview.danger.map(hit => hit.category), ['upload']);
    assert.deepEqual(approval.preview.dangerScopes, ['session', 'workspace', 'global']);
    manager.resolveApproval(approval.id, 'always', user, 'default', 'workspace');
    const done = await first.turn;
    assert.equal(done.denied, 0);
    assert.equal(first.events.find(event => event.type === 'approval_result').scope, 'workspace');
    assert.deepEqual((await danger.list()).map(rule => [rule.category, rule.scope, rule.root]), [['upload', 'workspace', fs.realpathSync(root)]]);

    // 同一目录的新对话不再询问；其他危险类别照常询问
    const again = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const second = runCommandTurn(again, UPLOAD);
    assert.equal((await second.turn).denied, 0);
    assert.equal(second.events.some(event => event.type === 'approval'), false);
    assert.equal(manager.classifyDecision(again, 'run_command', { command: 'sudo -n true' }), 'ask');
    assert.equal(manager.classifyDecision(again, 'run_command', { command: 'echo ok' }), 'allow', 'ordinary commands stay automatic in full access');

    // 其他目录仍询问；选「本对话」只记在这次对话里
    const elsewhere = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root: otherRoot, permissionMode: 'full' });
    fs.writeFileSync(path.join(otherRoot, 'README.md'), 'x\n');
    const third = runCommandTurn(elsewhere, UPLOAD);
    const otherApproval = await waitFor(() => third.events.find(event => event.type === 'approval'));
    manager.resolveApproval(otherApproval.id, 'always', user, 'default', 'session');
    await third.turn;
    assert.equal(elsewhere.dangerAllowed.has('upload'), true);
    assert.equal((await danger.list()).length, 1, 'session scope is not persisted');

    // 拒绝时提示不要换写法绕过
    const denySession = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root: otherRoot, permissionMode: 'full' });
    const fourth = runCommandTurn(denySession, 'sudo -n true');
    manager.resolveApproval((await waitFor(() => fourth.events.find(event => event.type === 'approval'))).id, 'deny', user, 'default');
    assert.equal((await fourth.turn).denied, 1);

    for (const rule of await danger.list()) await danger.remove(rule.id);
});

test('unattended channel chats skip danger commands until a permanent rule allows them', async () => {
    const session = manager.ensureWeLinkSession({ user, tenantId: 'default', chatSessionId: `chat-${process.pid}` });
    fs.writeFileSync(path.join(session.root, 'README.md'), 'x\n');
    const blocked = runCommandTurn(session, UPLOAD);
    const result = await blocked.turn;
    assert.equal(result.denied, 1);
    assert.equal(blocked.events.some(event => event.type === 'approval'), false, 'nobody can answer a card in a channel');
    assert.match(blocked.events.find(event => event.type === 'tool_result').summary, /无人值守/);

    const rule = await danger.add({ category: 'upload', scope: 'global', by: 'admin' });
    const allowed = runCommandTurn(session, UPLOAD);
    assert.equal((await allowed.turn).denied, 0);
    await danger.remove(rule.id);
    await assert.rejects(danger.remove(rule.id), { code: 'AGENT_DANGER_RULE_NOT_FOUND' });
    await assert.rejects(danger.add({ category: 'nope', scope: 'global' }), { code: 'AGENT_DANGER_CATEGORY' });
});

test('rm in agent commands moves files to the Trash except temp files and build output', { skip: !shim.shimDir() && 'needs macOS /usr/bin/trash' }, () => {
    const env = shim.withShim({ PATH: process.env.PATH });
    assert.equal(env.PATH.split(path.delimiter)[0], shim.shimDir());
    const dir = path.join(sandbox, 'rm-check');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    const sh = (command, expectFail = false) => {
        try { execFileSync('/bin/sh', ['-c', command], { cwd: dir, env, stdio: 'pipe' }); return 0; } catch (error) { if (!expectFail) throw error; return error.status; }
    };
    assert.equal(execFileSync('/bin/sh', ['-c', 'command -v rm'], { env }).toString().trim(), path.join(shim.shimDir(), 'rm'));
    assert.equal(sh('rm a.txt'), 0);
    assert.equal(fs.existsSync(path.join(dir, 'a.txt')), false, 'temp-dir files are deleted directly');
    assert.equal(sh('rm missing.txt', true), 1);
    assert.equal(sh('rm -f missing.txt'), 0);
    assert.equal(sh('rm sub', true), 1, 'a directory still needs -r');
    assert.equal(sh('rm -r sub'), 0);
    assert.equal(fs.existsSync(path.join(dir, 'sub')), false);
});

test('platform databases are backed up once before the agent first changes them', async () => {
    const sqlite3 = require('../backend/node_modules/sqlite3');
    const tenant = require('../backend/models/tenant-context');
    const service = require('../backend/models/agent-database-service');
    const file = path.join(tenant.getDataDir('default'), 'agentwrite.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = await new Promise((resolve, reject) => { const connection = new sqlite3.Database(file, error => error ? reject(error) : resolve(connection)); });
    await new Promise((resolve, reject) => db.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO records VALUES (1, 'before');", error => error ? reject(error) : resolve()));
    await new Promise(resolve => db.close(resolve));
    const dir = service.backupDir();
    // 一份过期的旧备份 + 两份更旧的：写入后只保留最近 3 份
    fs.mkdirSync(dir, { recursive: true });
    const old = Date.now() / 1000 - 7200;
    for (const stamp of ['2020-01-01', '2020-01-02', '2020-01-03']) {
        const name = path.join(dir, `agentwrite--${stamp}.db`);
        fs.writeFileSync(name, 'old');
        fs.utimesSync(name, old, old);
    }
    const ctx = { root, readOnly: false, changeLog: {} };
    const target = { database: 'platform:agentwrite.db', table: 'records', operation: 'update', values: { label: 'after' }, filters: [{ column: 'id', op: 'eq', value: 1 }] };
    const result = await service.writeTable(ctx, target);
    assert.match(result.note, /修改前的整库备份/);
    const backups = fs.readdirSync(dir).filter(name => name.startsWith('agentwrite--')).sort();
    assert.equal(backups.length, 3);
    assert.equal(backups.includes('agentwrite--2020-01-01.db'), false, 'oldest copy pruned');
    const latest = path.join(dir, backups.at(-1));
    const copy = await new Promise((resolve, reject) => { const connection = new sqlite3.Database(latest, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(connection)); });
    const row = await new Promise((resolve, reject) => copy.get('SELECT label FROM records WHERE id = 1', (error, value) => error ? reject(error) : resolve(value)));
    await new Promise(resolve => copy.close(resolve));
    assert.equal(row.label, 'before', 'the copy holds the data from before the change');

    assert.doesNotMatch((await service.writeTable(ctx, { ...target, values: { label: 'again' } })).note, /整库备份/, 'same session: no second copy');
    assert.doesNotMatch((await service.writeTable({ ...ctx, changeLog: {} }, { ...target, values: { label: 'third' } })).note, /整库备份/, 'a fresh copy within the hour is reused');
    assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('agentwrite--')).length, 3);
});
