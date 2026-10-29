const test = require('node:test');
const assert = require('node:assert/strict');
const viewer = require('../frontend/js/shared/ide-diff-viewer');
test('unified diff rows retain old/new positions and emphasize a replacement', () => {
    const [file] = viewer.parse('commit abc\nAuthor: test\n\ndiff --git a/app.py b/app.py\nindex a..b 100644\n--- a/app.py\n+++ b/app.py\n@@ -10,3 +10,4 @@ def build():\n same\n-old = 1\n+new = 2\n+extra = True\n tail\n');
    assert.equal(file.path, 'app.py'); assert.equal(file.added, 2); assert.equal(file.removed, 1);
    assert.deepEqual(file.hunks[0].rows.map(row => [row.type, row.old, row.next]), [['context',10,10],['removed',11,''],['added','',11],['added','',12],['context',12,13]]);
    assert.deepEqual(viewer.changedRange('timeout = 10', 'timeout = 30'), { before: [10,11], after: [10,11] });
});
test('file headers inside source rows do not create false files or counts', () => {
    const [file] = viewer.parse('diff --git a/test.txt b/test.txt\n--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n--- file-like source\n+++ file-like source\n\\ No newline at end of file\n');
    assert.equal(file.path, 'test.txt'); assert.equal(file.added, 1); assert.equal(file.removed, 1);
    assert.equal(file.hunks[0].rows[0].text, '-- file-like source');
    assert.equal(file.hunks[0].rows.at(-1).type, 'note');
});
test('initial commits, deletions, rename-only and binary changes remain separate', () => {
    const files = viewer.parse('diff --git a/new.py b/new.py\nnew file mode 100644\n--- /dev/null\n+++ b/new.py\n@@ -0,0 +1,2 @@\n+import os\n+print(1)\ndiff --git a/gone b/gone\ndeleted file mode 100644\n--- a/gone\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\ndiff --git a/old name b/new name\nsimilarity index 100%\nrename from old name\nrename to new name\ndiff --git a/icon.png b/icon.png\nBinary files a/icon.png and b/icon.png differ\n');
    assert.deepEqual(files.map(file => file.status), ['added','removed','renamed','modified']);
    assert.equal(files[2].path,'new name'); assert.equal(files[3].hunks.length,0);
    assert.equal(files[0].hunks[0].rows[0].next,1);
    assert.equal(files[1].hunks[0].rows[0].old,1);
});
test('Git octal-escaped UTF-8 paths and raw markup are preserved as data', () => {
    const [file] = viewer.parse('diff --git "a/\\346\\265\\213.py" "b/\\346\\265\\213.py"\n--- "a/\\346\\265\\213.py"\n+++ "b/\\346\\265\\213.py"\n@@ -0,0 +1 @@\n+<img src=x onerror=alert(1)>\n');
    assert.equal(file.path,'测.py');
    assert.equal(file.hunks[0].rows[0].text,'<img src=x onerror=alert(1)>');
    assert.deepEqual(viewer.parse(''),[]);
    assert.deepEqual(viewer.parse('diff --cc merged.py\n@@@ combined diff'),[]);
});
