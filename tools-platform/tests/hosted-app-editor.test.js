const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
// CI and local runs must use the same fixture, never an installed user app.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-app-editor-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const editorService = require('../backend/models/hosted-apps/editor-service');
const runtime = require('../backend/models/hosted-apps/runtime');
const highlighter = require('../frontend/js/shared/ide-highlighter');
const slug = 'editor-fixture';
const remoteUrl = path.join(sandbox, 'remote.git');

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
test.before(() => {
    const codeDir = runtime.paths(slug).code;
    for (const dir of ['app', 'static', '.venv', '__pycache__']) {
        fs.mkdirSync(path.join(codeDir, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(codeDir, 'requirements.txt'), 'fastapi\nuvicorn\n');
    fs.writeFileSync(path.join(codeDir, 'app/main.py'), 'print("fixture")\n');
    fs.writeFileSync(path.join(codeDir, 'static/index.html'), '<html></html>\n');
    fs.writeFileSync(path.join(codeDir, '.gitignore'), '.venv/\n__pycache__/\n');
    const git = args => execFileSync('git', args, { cwd: codeDir, stdio: 'pipe' });
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'IDE Test']);
    git(['config', 'user.email', 'ide-test@example.invalid']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.hooksPath', path.join(sandbox, 'empty-hooks')]);
    git(['add', '.']);
    git(['commit', '-m', 'Initial editor fixture']);
    git(['init', '--bare', '-b', 'main', remoteUrl]);
    git(['remote', 'add', 'origin', remoteUrl]);
    git(['push', '-u', 'origin', 'main']);
});

test('hosted app editor: file tree listing filters git and virtualenvs', async () => {
    const tree = editorService.getFileTree(slug);
    assert.ok(Array.isArray(tree), 'tree must be an array');
    assert.ok(tree.length > 0, 'tree must not be empty');
    const names = tree.map(item => item.name);
    assert.ok(!names.includes('.git'), 'must not list .git');
    assert.ok(!names.includes('__pycache__'), 'must not list __pycache__');
    assert.ok(names.includes('requirements.txt'), 'must list requirements.txt');
    assert.ok(names.includes('app'), 'must list app directory');
});

test('hosted app editor: read and save text files with traversal guards', async () => {
    // Read valid file
    const file = editorService.readFile(slug, 'requirements.txt');
    assert.equal(file.path, 'requirements.txt');
    assert.ok(file.content.includes('fastapi'), 'content must include fastapi');
    assert.equal(file.isBinary, false);

    // Traversal rejection
    assert.throws(() => {
        editorService.readFile(slug, '../../package.json');
    }, /403|非法路径/);

    assert.throws(() => {
        editorService.readFile(slug, '.git/config');
    }, /403|禁止/);

    // Create scratch file, save, read back, delete
    const scratchRel = 'scratch_test_ide.py';
    const saved = editorService.saveFile(slug, scratchRel, 'print("hello ide")\n');
    assert.equal(saved.success, true);
    assert.equal(saved.path, scratchRel);

    const readScratch = editorService.readFile(slug, scratchRel);
    assert.equal(readScratch.content, 'print("hello ide")\n');

    // Rename scratch file
    const renamedRel = 'scratch_test_renamed.py';
    const renamed = editorService.renameItem(slug, scratchRel, renamedRel);
    assert.equal(renamed.success, true);

    // Delete scratch file
    const deleted = editorService.deleteItem(slug, renamedRel);
    assert.equal(deleted.success, true);
});

test('hosted app editor: git status, history, commit and diff', async () => {
    const status = editorService.getGitStatus(slug);
    assert.equal(status.branch, 'main');
    assert.equal(status.remoteUrl, remoteUrl);
    assert.equal(status.clean, true);

    editorService.saveFile(slug, 'app/main.py', 'print("updated fixture")\n');
    const commit = editorService.commitChanges(slug, 'Update editor fixture');
    assert.equal(commit.committed, true);

    const history = editorService.getGitHistory(slug, 10);
    assert.ok(Array.isArray(history), 'history must be array');
    assert.equal(history.length, 2, 'must contain the initial and update commits');
    assert.equal(history[0].hash, commit.hash);
    assert.ok(history[0].hash, 'commit must have hash');
    assert.ok(history[0].shortHash, 'commit must have shortHash');

    const diff = editorService.getDiff(slug, { commitHash: history[0].hash });
    assert.ok(diff.diff, 'diff must produce output');
    assert.ok(diff.diff.includes('+print("updated fixture")'));
});

test('hosted app editor: syntax highlighter generates accurate token spans', async () => {
    // Python
    const pyCode = 'def calculate(total: int) -> bool:\n    # comment\n    return total > 0';
    const pyHtml = highlighter.highlight(pyCode, 'python');
    assert.ok(pyHtml.includes('class="tok-keyword">def</span>'), 'highlight def');
    assert.ok(pyHtml.includes('class="tok-comment"># comment</span>'), 'highlight comment');
    assert.ok(pyHtml.includes('class="tok-builtin">int</span>'), 'highlight builtin int');

    // SQL
    const sqlCode = 'SELECT id, name FROM users WHERE id = 1';
    const sqlHtml = highlighter.highlight(sqlCode, 'sql');
    assert.ok(sqlHtml.includes('class="tok-keyword">SELECT</span>'), 'highlight SELECT');
    assert.ok(sqlHtml.includes('class="tok-keyword">FROM</span>'), 'highlight FROM');

    // JavaScript
    const jsCode = 'const x = async () => true;';
    const jsHtml = highlighter.highlight(jsCode, 'javascript');
    assert.ok(jsHtml.includes('class="tok-keyword">const</span>'), 'highlight const');
    assert.ok(jsHtml.includes('class="tok-builtin">true</span>'), 'highlight true');
});
