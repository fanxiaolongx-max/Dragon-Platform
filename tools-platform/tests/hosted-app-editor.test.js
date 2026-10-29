const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const editorService = require('../backend/models/hosted-apps/editor-service');
const runtime = require('../backend/models/hosted-apps/runtime');
const highlighter = require('../frontend/js/shared/ide-highlighter');

test('hosted app editor: file tree listing filters git and virtualenvs', async () => {
    const tree = editorService.getFileTree('aiops-report');
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
    const file = editorService.readFile('aiops-report', 'requirements.txt');
    assert.equal(file.path, 'requirements.txt');
    assert.ok(file.content.includes('fastapi'), 'content must include fastapi');
    assert.equal(file.isBinary, false);

    // Traversal rejection
    assert.throws(() => {
        editorService.readFile('aiops-report', '../../package.json');
    }, /403|非法路径/);

    assert.throws(() => {
        editorService.readFile('aiops-report', '.git/config');
    }, /403|禁止/);

    // Create scratch file, save, read back, delete
    const scratchRel = 'scratch_test_ide.py';
    const saved = editorService.saveFile('aiops-report', scratchRel, 'print("hello ide")\n');
    assert.equal(saved.success, true);
    assert.equal(saved.path, scratchRel);

    const readScratch = editorService.readFile('aiops-report', scratchRel);
    assert.equal(readScratch.content, 'print("hello ide")\n');

    // Rename scratch file
    const renamedRel = 'scratch_test_renamed.py';
    const renamed = editorService.renameItem('aiops-report', scratchRel, renamedRel);
    assert.equal(renamed.success, true);

    // Delete scratch file
    const deleted = editorService.deleteItem('aiops-report', renamedRel);
    assert.equal(deleted.success, true);
});

test('hosted app editor: git status, history, commit and diff', async () => {
    const status = editorService.getGitStatus('aiops-report');
    assert.ok(status.branch, 'must have branch name');
    assert.equal(status.remoteUrl, 'https://github.com/fanxiaolongx-max/Dragon-Platform-online.git');

    const history = editorService.getGitHistory('aiops-report', 10);
    assert.ok(Array.isArray(history), 'history must be array');
    assert.ok(history.length >= 1, 'must have at least initial commit');
    assert.ok(history[0].hash, 'commit must have hash');
    assert.ok(history[0].shortHash, 'commit must have shortHash');

    const diff = editorService.getDiff('aiops-report', { commitHash: history[0].hash });
    assert.ok(diff.diff, 'diff must produce output');
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
