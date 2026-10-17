const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('jszip');
const base = path.join(__dirname, '../backend/builtin-tools/f12-to-extension');
const guide = require(path.join(base, 'exam-store-guide.js'));
const packer = require(path.join(base, 'packer-core.js'));

test('download, in-page guide and Markdown source use the same complete submission text', () => {
  assert.equal(guide.markdown, fs.readFileSync(path.join(base, guide.filename), 'utf8'));
  for (const term of ['权限', '隐私政策', '自动选择答案', 'https://*/*', 'API Key', '审核测试说明', 'Microsoft Partner Center', 'Developer Dashboard']) assert.ok(guide.markdown.includes(term), term);
  assert.doesNotMatch(fs.readFileSync(path.join(base, 'exam-store-guide.js'), 'utf8'), /<\/script>/i);
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  assert.match(html, /<script src="\.\/exam-store-guide\.js"><\/script>/);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('AI vault ZIP includes guide in local and store packages without adding permissions or leaking configuration', async () => {
  const source = fs.readFileSync(path.join(base, 'exam-question-bank-assistant.js'), 'utf8');
  for (const packageTarget of ['local', 'store']) {
    const generated = packer.buildPackage({ name: 'Exam', code: source, matches: 'https://practice.example/*', manualLaunch: true, packageTarget });
    assert.equal(generated.files[guide.filename], guide.markdown);
    assert.deepEqual(generated.manifest.permissions, ['storage', 'activeTab', 'scripting', 'unlimitedStorage']);
    assert.equal(generated.manifest.content_scripts, undefined);
    const zip = new JSZip();
    Object.entries(generated.files).forEach(([name, contents]) => zip.file(name, contents));
    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    assert.equal(await reopened.file(guide.filename).async('string'), guide.markdown);
  }
  const flagged = packer.buildPackage({ code: 'console.log("custom build")', examVaultBridge: true });
  assert.equal(flagged.files[guide.filename], guide.markdown);
  const ordinary = packer.buildPackage({ code: 'console.log("ordinary")' });
  assert.equal(ordinary.files[guide.filename], undefined);
});

 test('guide availability follows the loaded code instead of its name or previous selection', () => {
  assert.equal(guide.matchesScript({ code: '/* TP_EXAM_VAULT_V1 */' }), true);
  assert.equal(guide.matchesScript({ name: '题库与答题助手', code: 'console.log("other")' }), false);
  assert.equal(guide.matchesScript({ code: '' }), false);
  assert.equal(guide.matchesScript({ code: 'TP_EXAM_AI_V1' }), false);
  assert.equal(guide.matchesScript({ examVaultBridge: true }), true);
});
