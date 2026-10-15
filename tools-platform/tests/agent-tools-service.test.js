const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const guard = require('../backend/models/agent-path-guard');
const tools = require('../backend/models/agent-tools-service');
const { AgentChangeLog, unifiedDiff } = require('../backend/models/agent-change-log');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-tools-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-outside-'));
const root = path.join(sandbox, 'project');
fs.mkdirSync(path.join(root, 'src', 'node_modules', 'dep'), { recursive: true });
fs.writeFileSync(path.join(root, 'README.md'), 'Hello\nWorld\nTODO: later\n');
fs.writeFileSync(path.join(root, 'src', 'index.js'), 'const a = 1;\n// TODO: fix\nconsole.log(a);\n');
fs.writeFileSync(path.join(root, 'src', 'node_modules', 'dep', 'index.js'), '// TODO: inside node_modules\n');
fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
if (process.platform !== 'win32') fs.symlinkSync(outside, path.join(root, 'escape'));

const ROOT = guard.normalizeRoot(root);
const ctx = () => ({ root: ROOT, changeLog: new AgentChangeLog(ROOT), signal: new AbortController().signal });

test.after(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
});

test('path guard keeps every path inside the root, including through symlinks', () => {
    assert.equal(guard.resolveInsideRoot(ROOT, '.'), ROOT);
    assert.equal(guard.resolveInsideRoot(ROOT, 'src/index.js'), path.join(ROOT, 'src', 'index.js'));
    assert.equal(guard.resolveInsideRoot(ROOT, 'new/dir/file.txt'), path.join(ROOT, 'new', 'dir', 'file.txt'), 'not-yet-existing paths are allowed');
    assert.throws(() => guard.resolveInsideRoot(ROOT, '../x'), /超出工作目录/);
    assert.throws(() => guard.resolveInsideRoot(ROOT, outside), /超出工作目录/);
    assert.throws(() => guard.resolveInsideRoot(ROOT, 'a\0b'), /非法字符/);
    if (process.platform !== 'win32') assert.throws(() => guard.resolveInsideRoot(ROOT, 'escape/secret.txt'), /链接/);
    assert.throws(() => guard.normalizeRoot(path.join(sandbox, 'missing')), /不存在/);
    assert.throws(() => guard.normalizeRoot(path.join(root, 'README.md')), /不是目录/);
});

test('list_directory, read_file and search respect ignore rules and limits', async () => {
    const list = await tools.execute(ctx(), 'list_directory', { path: '.', depth: 2 });
    assert.match(list.content, /src\//);
    assert.match(list.content, /README\.md/);
    assert.doesNotMatch(list.content, /\.env/, 'hidden entries are skipped by default');
    assert.doesNotMatch(list.content, /dep/, 'node_modules is not expanded');

    const read = await tools.execute(ctx(), 'read_file', { path: 'README.md', startLine: 2, endLine: 3 });
    assert.match(read.content, /2│World/);
    assert.doesNotMatch(read.content, /1│Hello/);

    const binary = await tools.execute(ctx(), 'read_file', { path: 'logo.png' });
    assert.equal(binary.isError, true);
    const secret = await tools.execute(ctx(), 'read_file', { path: '.env' });
    assert.equal(secret.isError, true);
    assert.match(secret.content, /密钥|环境变量/);
    const dir = await tools.execute(ctx(), 'read_file', { path: 'src' });
    assert.equal(dir.isError, true);

    const found = await tools.execute(ctx(), 'search', { query: 'todo' });
    assert.match(found.content, /README\.md:3/);
    assert.match(found.content, /src\/index\.js:2/);
    assert.doesNotMatch(found.content, /node_modules/);
    const globbed = await tools.execute(ctx(), 'search', { query: 'TODO', glob: '*.md', caseSensitive: true });
    assert.doesNotMatch(globbed.content, /index\.js/);
    const badRegex = await tools.execute(ctx(), 'search', { query: '(', regex: true });
    assert.equal(badRegex.isError, true);
});

test('edit_file requires a unique match and records a revertible change', async () => {
    const context = ctx();
    const missing = await tools.execute(context, 'edit_file', { path: 'README.md', oldString: 'nope', newString: 'x' });
    assert.equal(missing.isError, true);
    assert.match(missing.content, /找不到/);
    fs.writeFileSync(path.join(root, 'dup.txt'), 'same\nsame\n');
    const ambiguous = await tools.execute(context, 'edit_file', { path: 'dup.txt', oldString: 'same', newString: 'other' });
    assert.match(ambiguous.content, /出现 2 次/);
    const all = await tools.execute(context, 'edit_file', { path: 'dup.txt', oldString: 'same', newString: 'other', replaceAll: true });
    assert.equal(all.isError, undefined);
    assert.equal(fs.readFileSync(path.join(root, 'dup.txt'), 'utf8'), 'other\nother\n');

    const preview = await tools.preview(context, 'edit_file', { path: 'README.md', oldString: 'Hello', newString: 'Hi there' });
    assert.match(preview.diff, /^-Hello$/m);
    assert.match(preview.diff, /^\+Hi there$/m);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8').startsWith('Hello'), true, 'preview does not write');

    const edited = await tools.execute(context, 'edit_file', { path: 'README.md', oldString: 'Hello', newString: 'Hi there' });
    assert.deepEqual(edited.change, { path: 'README.md', kind: 'modify', added: 1, removed: 1, from: undefined, source: 'agent' });
    const summary = context.changeLog.summary();
    assert.equal(summary.find(item => item.path === 'README.md').revertible, true);
    assert.match(context.changeLog.diff('README.md').text, /@@ -1,3 \+1,3 @@\n-Hello\n\+Hi there/);
    context.changeLog.revert('README.md');
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'Hello\nWorld\nTODO: later\n');
    assert.equal(context.changeLog.summary().some(item => item.path === 'README.md'), false);
});

test('write_file, delete_path and rename_path stay inside the root and are tracked', async () => {
    const context = ctx();
    const created = await tools.execute(context, 'write_file', { path: 'docs/new.md', content: '# New\n' });
    assert.equal(created.change.kind, 'create');
    assert.equal(fs.readFileSync(path.join(root, 'docs', 'new.md'), 'utf8'), '# New\n');
    const tooBig = await tools.execute(context, 'write_file', { path: 'big.txt', content: 'x'.repeat(tools.LIMITS.writeBytes + 1) });
    assert.equal(tooBig.isError, true);
    const outsideWrite = await tools.execute(context, 'write_file', { path: '../evil.txt', content: 'x' });
    assert.equal(outsideWrite.isError, true);
    assert.equal(fs.existsSync(path.join(sandbox, 'evil.txt')), false);

    const renamed = await tools.execute(context, 'rename_path', { from: 'docs/new.md', to: 'docs/renamed.md' });
    assert.equal(renamed.change.kind, 'create', 'a file created in this session remains a creation after moving');
    assert.equal(fs.existsSync(path.join(root, 'docs', 'renamed.md')), true);
    const clash = await tools.execute(context, 'rename_path', { from: 'docs/renamed.md', to: 'README.md' });
    assert.equal(clash.isError, true);

    const rootDelete = await tools.execute(context, 'delete_path', { path: '.', recursive: true });
    assert.equal(rootDelete.isError, true);
    assert.equal(fs.existsSync(root), true);
    const dirWithoutFlag = await tools.execute(context, 'delete_path', { path: 'docs' });
    assert.equal(dirWithoutFlag.isError, true);
    const deleted = await tools.execute(context, 'delete_path', { path: 'docs/renamed.md' });
    assert.equal(deleted.change, null);
    assert.equal(context.changeLog.summary().some(item => item.path === 'docs/renamed.md'), false, 'create then delete is already back to the initial state');
    assert.equal(fs.existsSync(path.join(root, 'docs', 'renamed.md')), false);
    assert.equal(fs.existsSync(path.join(root, 'docs', 'new.md')), false);

    // 会话前已存在的文件：删除后撤销应恢复原内容
    const context2 = ctx();
    await tools.execute(context2, 'delete_path', { path: 'src/index.js' });
    assert.equal(fs.existsSync(path.join(root, 'src', 'index.js')), false);
    context2.changeLog.revert('src/index.js');
    assert.match(fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8'), /const a = 1;/);
});

// 同一组断言在 POSIX 与 Windows(cmd.exe) 上各用一套命令
const IS_WIN = process.platform === 'win32';
const CMD = IS_WIN
    ? { cwdAndEnv: 'cd & set DRAGON_TEST', failing: 'echo oops 1>&2 & exit /b 3', slow: 'ping -n 6 127.0.0.1 >nul & echo late', big: 'for /L %i in (1,1,8000) do @echo abcdefghijklmnopqrstuvwxyz' }
    : { cwdAndEnv: 'pwd; env | grep DRAGON_TEST || true', failing: 'echo oops 1>&2; exit 3', slow: 'sleep 5; echo late', big: 'yes abcdefghijklmnopqrstuvwxyz | head -c 200000' };

test('resolveShell picks cmd.exe on Windows and an existing $SHELL (or /bin/sh) elsewhere', () => {
    const win = tools.resolveShell('win32', { ComSpec: 'Z:\\missing\\cmd.exe', SystemRoot: 'Z:\\missing' });
    assert.equal(win.shell, 'cmd.exe', 'falls back to PATH lookup when ComSpec/SystemRoot are bogus');
    assert.deepEqual(win.args, ['/d', '/s', '/c']);
    const existing = IS_WIN ? process.env.ComSpec : '/bin/sh';
    if (existing && fs.existsSync(existing)) {
        const picked = tools.resolveShell('win32', { ComSpec: existing });
        if (IS_WIN) assert.equal(picked.shell, existing);
    }
    const posix = tools.resolveShell('linux', { SHELL: '/definitely/not/here' });
    assert.deepEqual(posix, { shell: '/bin/sh', args: ['-c'] });
    const bash = tools.resolveShell('darwin', { SHELL: '/bin/bash' });
    assert.equal(bash.shell, fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');
    const relative = tools.resolveShell('linux', { SHELL: 'zsh' });
    assert.equal(relative.shell, '/bin/sh', 'relative $SHELL is ignored');
});

test('run_command executes in the root with scrubbed env, timeout and output caps', async () => {
    process.env.DRAGON_TEST_API_TOKEN = 'leak-me';
    process.env.DRAGON_TEST_PLAIN = 'visible';
    try {
        const env = await tools.execute(ctx(), 'run_command', { command: CMD.cwdAndEnv });
        assert.match(env.content.toLowerCase(), new RegExp(ROOT.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(env.content, /DRAGON_TEST_PLAIN=visible/);
        assert.doesNotMatch(env.content, /leak-me/);
        assert.equal(env.isError, false);
        assert.match(env.content, /退出码 0/);

        const failing = await tools.execute(ctx(), 'run_command', { command: CMD.failing });
        assert.equal(failing.isError, true);
        assert.match(failing.content, /\[stderr\]\noops/);

        const slow = await tools.execute(ctx(), 'run_command', { command: CMD.slow, timeoutMs: 1000 });
        assert.equal(slow.isError, true);
        assert.match(slow.content, /超时/);

        const big = await tools.execute(ctx(), 'run_command', { command: CMD.big });
        assert.ok(big.content.length < tools.LIMITS.commandOutputBytes + 2000);
        assert.match(big.content, /输出已截断/);
    } finally {
        delete process.env.DRAGON_TEST_API_TOKEN;
        delete process.env.DRAGON_TEST_PLAIN;
    }
});

test('unified diff and tool definitions are well formed', () => {
    const diff = unifiedDiff('a.txt', 'one\ntwo\nthree\n', 'one\n2\nthree\nfour\n');
    assert.equal(diff.added, 2);
    assert.equal(diff.removed, 1);
    assert.match(diff.text, /^--- a\/a\.txt\n\+\+\+ b\/a\.txt\n@@/);
    const defs = tools.definitions();
    assert.deepEqual(defs.map(item => item.name), ['list_directory', 'read_file', 'search', 'list_databases', 'database_schema', 'read_database_table', 'write_file', 'edit_file', 'delete_path', 'rename_path', 'run_command', 'welink_list_targets', 'welink_send_message']);
    assert.deepEqual(tools.definitions({ readOnly: true }).map(item => item.name).filter(name => name.startsWith('welink_')), [], '只读账号不提供 WeLink 工具');
    assert.equal(tools.kindOf('welink_send_message'), 'external');
    defs.forEach(def => assert.equal(def.parameters.type, 'object'));
    assert.equal(tools.kindOf('run_command'), 'command');
    assert.equal(tools.kindOf('delete_path'), 'destructive');
    assert.equal(tools.kindOf('nope'), null);
});

test('read_file pages through large files by line, truncates very long lines and reports the next line', async () => {
    const c = ctx();
    const big = Array.from({ length: 30000 }, (_, index) => `line ${index + 1} ${'x'.repeat(30)}`).join('\n') + '\n';
    fs.writeFileSync(path.join(ROOT, 'big.log.txt'), big);
    assert.ok(Buffer.byteLength(big) > 1024 * 1024, 'fixture is larger than 1 MB');
    const middle = await tools.execute(c, 'read_file', { path: 'big.log.txt', startLine: 20000, limit: 2 });
    assert.match(middle.content, /第 20000-20001 行，共 30000 行/);
    assert.match(middle.content, /20000│line 20000 /);
    assert.match(middle.content, /startLine=20002/);
    const tail = await tools.execute(c, 'read_file', { path: 'big.log.txt', startLine: 29999 });
    assert.match(tail.content, /30000│line 30000 /);
    assert.doesNotMatch(tail.content, /继续读取/, 'no continuation hint at the end');
    const beyond = await tools.execute(c, 'read_file', { path: 'big.log.txt', startLine: 40000 });
    assert.match(beyond.content, /超出文件末尾/);
    const ranged = await tools.execute(c, 'read_file', { path: 'big.log.txt', startLine: 10, endLine: 12 });
    assert.match(ranged.content, /第 10-12 行/);
    fs.writeFileSync(path.join(ROOT, 'wide.txt'), `${'a'.repeat(5000)}\nshort\n`);
    const wide = await tools.execute(c, 'read_file', { path: 'wide.txt' });
    assert.match(wide.content, /本行共 5000 字符，已截断/);
    assert.match(wide.content, /2│short/);
    fs.rmSync(path.join(ROOT, 'big.log.txt'));
    fs.rmSync(path.join(ROOT, 'wide.txt'));
});

test('renaming an existing file can be undone and read-only users only get read tools', async () => {
    const c = ctx();
    fs.writeFileSync(path.join(ROOT, 'before.txt'), 'original\n');
    const moved = await tools.execute(c, 'rename_path', { from: 'before.txt', to: 'moved/after.txt' });
    assert.equal(moved.change.from, 'before.txt');
    assert.equal(c.changeLog.summary().find(item => item.path === 'moved/after.txt').revertible, true, 'the original was captured before moving');
    c.changeLog.revert('moved/after.txt');
    assert.equal(fs.readFileSync(path.join(ROOT, 'before.txt'), 'utf8'), 'original\n');
    assert.equal(fs.existsSync(path.join(ROOT, 'moved', 'after.txt')), false);
    fs.rmSync(path.join(ROOT, 'before.txt'));

    const readOnly = tools.definitions({ readOnly: true }).map(item => item.name).sort();
    assert.deepEqual(readOnly, ['database_schema', 'list_databases', 'list_directory', 'read_database_table', 'read_file', 'search']);
    assert.ok(tools.definitions().some(item => item.name === 'run_command'));
});

test('wide Unicode pages keep a truthful continuation cursor within the outer result limit', async () => {
    const file = path.join(ROOT, 'paged-unicode.txt');
    fs.writeFileSync(file, Array.from({ length: 90 }, (_, i) => `row-${i + 1}-${'内容'.repeat(300)}`).join('\n'));
    let startLine = 1;
    const seen = [];
    for (let page = 0; page < 10; page++) {
        const result = await tools.execute(ctx(), 'read_file', { path: 'paged-unicode.txt', startLine });
        assert.equal(result.truncated, false, 'the generic clamp must not cut off a page footer');
        const numbers = [...result.content.matchAll(/^(\d+)│row-/gm)].map(match => Number(match[1]));
        assert.equal(numbers[0], startLine);
        seen.push(...numbers);
        const next = result.content.match(/startLine=(\d+)/);
        if (!next) break;
        startLine = Number(next[1]);
        assert.equal(startLine, numbers.at(-1) + 1);
    }
    assert.deepEqual(seen, Array.from({ length: 90 }, (_, i) => i + 1));
    // 超长单行跨越多个流块；下一行仍有正确编号和完整 UTF-8。
    fs.writeFileSync(file, `${'a'.repeat(4 * 1024 * 1024)}\n中文尾行\n`);
    const wide = await tools.execute(ctx(), 'read_file', { path: 'paged-unicode.txt' });
    assert.match(wide.content, /本行共 4194304 字符/);
    assert.match(wide.content, /2│中文尾行/);
    fs.rmSync(file);
});

test('Windows cancellation kills the process tree before the parent and is idempotent', () => {
    const calls = [];
    const child = { pid: 12345, exitCode: null, signalCode: null, kill: () => calls.push('parent-kill') };
    const taskkill = new EventEmitter();
    const options = { platform: 'win32', systemRoot: 'C:\\Windows', spawnProcess: (file, args, opts) => {
        calls.push({ file, args, opts });
        return taskkill;
    } };
    tools.killTree(child, options);
    tools.killTree(child, options);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, 'C:\\Windows\\System32\\taskkill.exe');
    assert.deepEqual(calls[0].args, ['/pid', '12345', '/T', '/F']);
    assert.equal(calls[0].opts.windowsHide, true);
    taskkill.emit('error', new Error('synthetic launch failure'));
    assert.equal(calls[1], 'parent-kill', 'fallback only runs if killing the tree fails');
});

test('long command output retains the tail and exit status through both output limits', async () => {
    const file = path.join(ROOT, 'large-output.js');
    fs.writeFileSync(file, "process.stdout.write('x'.repeat(100000) + '\\nFINAL-OUTPUT-MARKER\\n');");
    const result = await tools.execute(ctx(), 'run_command', { command: `"${process.execPath}" large-output.js` });
    assert.equal(result.truncated, true);
    assert.match(result.content, /FINAL-OUTPUT-MARKER/);
    assert.match(result.content, /退出码 0/);
    fs.rmSync(file);
});
