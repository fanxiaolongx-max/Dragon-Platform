const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const changes = require('../backend/models/agent-workspace-changes');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-workspace-changes-')));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();

function makeRepo() {
    const repo = path.join(sandbox, `repo-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(path.join(repo, 'app', 'src'), { recursive: true });
    git(repo, 'init', '-q');
    fs.writeFileSync(path.join(repo, 'app', 'README.md'), 'Hello\nWorld\n');
    fs.writeFileSync(path.join(repo, 'app', 'src', 'old.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(repo, 'app', 'gone.txt'), 'bye\n');
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'repo root file\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    return repo;
}

test('manual edits in a git working tree are listed relative to the chosen subdirectory', async () => {
    const repo = makeRepo();
    const root = path.join(repo, 'app');
    fs.writeFileSync(path.join(root, 'README.md'), 'Hello\nDragon\nWorld\n');
    fs.writeFileSync(path.join(root, 'notes.md'), 'a\nb\nc\n');
    fs.rmSync(path.join(root, 'gone.txt'));
    git(repo, 'mv', 'app/src/old.js', 'app/src/new.js');
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'changed outside the workspace\n');

    const result = await changes.listChanges(root);
    assert.equal(result.git, true);
    const byPath = Object.fromEntries(result.changes.map(item => [item.path, item]));
    assert.deepEqual(Object.keys(byPath).sort(), ['README.md', 'gone.txt', 'notes.md', 'src/new.js']);
    assert.deepEqual([byPath['README.md'].kind, byPath['README.md'].added, byPath['README.md'].removed], ['modify', 1, 0]);
    assert.deepEqual([byPath['notes.md'].kind, byPath['notes.md'].added], ['create', 3]);
    assert.equal(byPath['gone.txt'].kind, 'delete');
    assert.equal(byPath['src/new.js'].kind, 'rename');
    assert.equal(byPath['src/new.js'].from, 'src/old.js');
    assert.ok(result.changes.every(item => item.source === 'git' && item.revertible === false), 'external changes are view-only');

    const tracked = await changes.diff(root, 'README.md');
    assert.match(tracked.text, /^--- a\/app\/README\.md/m);
    assert.match(tracked.text, /^\+Dragon$/m);
    const untracked = await changes.diff(root, 'notes.md');
    assert.equal(untracked.kind, 'create');
    assert.match(untracked.text, /^\+b$/m);
    assert.equal(await changes.diff(root, '../outside.txt'), null, 'paths outside the workspace are refused');
});

test('agent changes take precedence and non-git folders fall back to the agent log', async () => {
    const repo = makeRepo();
    const root = path.join(repo, 'app');
    fs.writeFileSync(path.join(root, 'README.md'), 'Hello\nAgent\n');
    fs.writeFileSync(path.join(root, 'manual.txt'), 'by hand\n');
    const agent = [{ path: 'README.md', kind: 'modify', added: 1, removed: 1, revertible: true }];
    const merged = await changes.collect(root, agent);
    assert.equal(merged.git, true);
    assert.deepEqual(merged.changes.map(item => [item.path, item.source, item.revertible]), [['README.md', 'agent', true], ['manual.txt', 'git', false]]);
    const fromCommand = await changes.collect(root, [{ path: 'README.md', kind: 'modify', added: 1, removed: 1, revertible: true, source: 'command' }]);
    assert.equal(fromCommand.changes[0].source, 'command', 'changes made by commands keep their label');

    const plain = path.join(sandbox, 'plain');
    fs.mkdirSync(plain, { recursive: true });
    const fallback = await changes.collect(plain, agent);
    assert.equal(fallback.git, false);
    assert.deepEqual(fallback.changes.map(item => item.source), ['agent']);
    assert.deepEqual(await changes.listChanges(plain), { git: false, changes: [] });
});

test('binary files such as databases are labelled instead of showing +0 -0', async () => {
    const repo = makeRepo();
    const root = path.join(repo, 'app');
    fs.writeFileSync(path.join(root, 'data.db'), Buffer.from([0, 1, 2, 3, 0, 5]));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'db');
    fs.writeFileSync(path.join(root, 'data.db'), Buffer.from([0, 9, 9, 9, 0, 5, 6]));
    fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 0, 1]));
    const result = await changes.listChanges(root);
    const byPath = Object.fromEntries(result.changes.map(item => [item.path, item]));
    assert.equal(byPath['data.db'].binary, true);
    assert.equal(byPath['image.bin'].binary, true);
    assert.equal(byPath['README.md'], undefined);
});
