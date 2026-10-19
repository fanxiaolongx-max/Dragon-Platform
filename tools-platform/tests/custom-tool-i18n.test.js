const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const customToolsRepo = require('../backend/models/custom-tools-repository');
const i18nService = require('../backend/models/custom-tool-i18n-service');
const exportService = require('../backend/models/custom-tool-export-service');
const JSZip = require('jszip');

test('every registered custom HTML tool has a valid offline translation resource', async t => {
    const tools = await customToolsRepo.listTools();
    if (!tools.length) return t.skip('no custom tools installed in this data dir (clean checkout)');
    for (const tool of tools) {
        const candidates = [
            path.join(customToolsRepo.CUSTOM_TOOLS_DIR, tool.slug, '.i18n.json'),
            path.join(customToolsRepo.BUILTIN_TOOLS_DIR, tool.slug, '.i18n.json'),
            path.join(i18nService.TRANSLATIONS_DIR, `${tool.slug}.json`)
        ];
        const resource = candidates.find(candidate => fs.existsSync(candidate));
        assert.equal(Boolean(resource), true, `${tool.slug} is missing its translation resource`);
        const translations = JSON.parse(fs.readFileSync(resource, 'utf8'));
        assert.equal(Array.isArray(translations), false);
        Object.entries(translations).forEach(([source, translated]) => {
            assert.equal(Boolean(source.trim()), true);
            assert.equal(Boolean(String(translated).trim()), true, `${tool.slug} has an empty translation for ${source}`);
        });
    }
});

test('language runtime is linked for served HTML and embedded for downloaded HTML', () => {
    const source = '<!doctype html><html><body><h1>人数计数</h1></body></html>';
    const served = i18nService.injectLanguageRuntime(source, 'tool-mrrgpqy4');
    const downloaded = i18nService.injectLanguageRuntime(source, 'tool-mrrgpqy4', { inlineRuntime: true, standalone: true });

    assert.match(served, /window\.__TOOLS_CUSTOM_I18N__/);
    assert.match(served, /custom-tool-i18n-runtime\.js/);
    assert.match(downloaded, /window\.__TOOLS_CUSTOM_I18N__/);
    assert.match(downloaded, /toolsCustomLanguageButton/);
    assert.match(downloaded, /toolsCustomIconFallback/);
    assert.match(downloaded, /ri-arrow-go-back-line/);
    assert.doesNotMatch(downloaded, /src="\/js\/shared\/custom-tool-i18n-runtime\.js/);
});

test('saved-webpage ZIP ignores macOS metadata and preserves the companion resource folder', async () => {
    const zip = new JSZip();
    zip.file('Saved Page.html', '<html><script src="./Saved Page_files/app.js"></script></html>');
    zip.file('Saved Page_files/app.js', 'window.savedPageReady = true;');
    zip.file('__MACOSX/._Saved Page.html', 'apple-double metadata');
    zip.file('__MACOSX/Saved Page_files/._app.js', 'apple-double metadata');
    zip.file('.DS_Store', 'finder metadata');
    const archive = await zip.generateAsync({ type: 'base64' });
    const files = await customToolsRepo.readZipFiles(archive);

    assert.deepEqual(files.map(([filePath]) => filePath), ['index.html', 'Saved Page_files/app.js']);
    assert.match(files[0][1].toString('utf8'), /Saved Page_files\/app\.js/);
});

test('custom tool export keeps single-file tools as HTML and packages multi-file tools as ZIP', async () => {
    const tool = { slug: 'export-test-tool', name: '导出测试', nameEn: 'Export Test' };
    const index = Buffer.from('<!doctype html><html><body><h1>测试</h1><script src="assets/app.js"></script></body></html>');
    const single = await exportService.packageToolFiles(tool, [['index.html', index]]);
    assert.equal(single.type, 'html');
    assert.equal(single.fileCount, 1);
    assert.match(single.buffer.toString('utf8'), /toolsCustomLanguageButton/);

    const multiple = await exportService.packageToolFiles(tool, [
        ['index.html', index],
        ['assets/app.js', Buffer.from('window.toolReady = true;')],
        ['.i18n.json', Buffer.from('{}')],
        ['.tool-manifest.json', Buffer.from('{}')]
    ]);
    assert.equal(multiple.type, 'zip');
    assert.equal(multiple.fileCount, 2);
    const archive = await JSZip.loadAsync(multiple.buffer);
    assert.deepEqual(Object.keys(archive.files).sort(), ['assets/', 'assets/app.js', 'index.html']);
    assert.match(await archive.file('index.html').async('string'), /toolsCustomLanguageButton/);
    assert.equal(await archive.file('assets/app.js').async('string'), 'window.toolReady = true;');
});

test('watermark with version and seconds-precision timestamp is injected into custom HTML tools and is idempotent', () => {
    const rawHtml = '<!doctype html><html><head><title>Tool</title></head><body><h1>Content</h1></body></html>';
    const specificDate = new Date('2026-09-19T14:38:25.000Z');
    const served = i18nService.injectLanguageRuntime(rawHtml, 'department-reward-penalty', {
        mtime: specificDate,
        version: 'v1.0.239'
    });

    assert.match(served, /id="__tools_html_meta_watermark__"/);
    assert.match(served, /class="tools-html-meta-watermark"/);
    assert.match(served, /pointer-events:\s*none/);
    assert.match(served, /tools-watermark-ver">v1\.0\.239</);
    assert.match(served, /tools-watermark-slug">department-reward-penalty</);
    // Verifies seconds precision: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}
    assert.match(served, /tools-watermark-time">更新: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}</);
    assert.match(served, /data-mtime-iso="2026-09-19T14:38:25\.000Z"/);

    // Verify idempotency: calling injectLanguageRuntime again does not duplicate the watermark
    const reInjected = i18nService.injectLanguageRuntime(served, 'department-reward-penalty', {
        mtime: new Date('2026-09-19T14:39:00.000Z'),
        version: 'v1.0.240'
    });
    const watermarkMatches = reInjected.match(/id="__tools_html_meta_watermark__"/g);
    assert.equal(watermarkMatches.length, 1);
    assert.match(reInjected, /tools-watermark-ver">v1\.0\.240</);
});

test('injectLanguageRuntime always targets the document root closing body tag when multiple body tags exist in source', () => {
    const rawHtml = `<!doctype html>
<html>
<head><title>Tool with inline templates</title></head>
<body>
    <script>
        const sampleHtml = '<div><span>Inline html</span></body></html>';
        console.log(sampleHtml);
    </script>
    <div id="app">Main App</div>
</body>
</html>`;

    const result = i18nService.injectLanguageRuntime(rawHtml, 'department-reward-penalty');
    
    // Injected watermark should be right before the final </body>, NOT inside the script
    const scriptIndex = result.indexOf('console.log(sampleHtml);');
    const watermarkIndex = result.indexOf('id="__tools_html_meta_watermark__"');
    const lastBodyIndex = result.lastIndexOf('</body>');
    const appIndex = result.indexOf('id="app"');

    assert.ok(watermarkIndex > appIndex, 'Watermark must be injected after #app');
    assert.ok(watermarkIndex > scriptIndex, 'Watermark must NOT be injected inside the script block');
    assert.ok(watermarkIndex < lastBodyIndex, 'Watermark must be injected before the last closing body tag');
});


