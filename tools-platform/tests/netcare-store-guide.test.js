const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('jszip');
const base = path.join(__dirname, '../backend/builtin-tools/f12-to-extension');
const guide = require(path.join(base, 'netcare-store-guide.js'));
const packer = require(path.join(base, 'packer-core.js'));

test('download, in-page guide and Markdown source use the same complete submission text', () => {
  assert.equal(guide.markdown, fs.readFileSync(path.join(base, guide.filename), 'utf8'));
  for (const term of ['权限', '隐私政策', 'RFC', 'AI 审计', 'https://*/*', 'API Key', '审核测试说明', 'Microsoft Partner Center', 'Developer Dashboard']) {
    assert.ok(guide.markdown.includes(term), term);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(base, 'netcare-store-guide.js'), 'utf8'), /<\/script>/i);
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  assert.match(html, /netcare-store-guide\.js\?v=20261011-01/);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('NetCare ZIP includes guide in local and store packages without leaking configuration', async () => {
  const code = fs.readFileSync(path.join(base, 'netcare-rfc-word.js'), 'utf8');
  const baseOptions = {
    name: 'NetCare RFC 方案与 AI 审计',
    version: '1.0.0',
    description: 'RFC solution downloader and AI auditor',
    matches: 'https://netcare-ae.gts.huawei.com/p/netcare/index.html*\nhttps://netcare.huawei.com/p/netcare/index.html*\nhttps://netcare-de.gts.huawei.com/p/netcare/index.html*\nhttps://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*',
    world: 'MAIN',
    allFrames: true,
    manualLaunch: true,
    includePopup: true,
    runAt: 'document_idle',
    license: { enabled: false },
    code
  };

  for (const packageTarget of ['local', 'store']) {
    const generated = packer.buildPackage({ ...baseOptions, packageTarget });
    assert.equal(generated.files[guide.filename], guide.markdown);
    assert.ok(generated.manifest.permissions.includes('webNavigation'));
    const zip = new JSZip();
    Object.entries(generated.files).forEach(([name, contents]) => zip.file(name, contents));
    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    assert.equal(await reopened.file(guide.filename).async('string'), guide.markdown);
  }
  const flagged = packer.buildPackage({ code: 'console.log("custom build")', netcareBridge: true });
  assert.equal(flagged.files[guide.filename], guide.markdown);
  const ordinary = packer.buildPackage({ code: 'console.log("ordinary")' });
  assert.equal(ordinary.files[guide.filename], undefined);
});

test('guide availability follows the loaded code instead of its name or previous selection', () => {
  assert.equal(guide.matchesScript({ code: '/* TP_NETCARE_RFC_WORD_V1 */' }), true);
  assert.equal(guide.matchesScript({ name: 'NetCare RFC 方案与 AI 审计', code: 'console.log("other")' }), false);
  assert.equal(guide.matchesScript({ code: '' }), false);
  assert.equal(guide.matchesScript({ code: 'TP_EXAM_AI_V1' }), false);
  assert.equal(guide.matchesScript({ netcareBridge: true }), true);
});
