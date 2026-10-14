const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ExcelJS = require('exceljs');

test('temporary License monthly Excel gives wrapped copy and table cells enough height', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');
    const start = source.indexOf('        function reportExcelTextHeight(');
    const end = source.indexOf('        async function downloadExcelWorkbook(', start);
    assert.ok(start >= 0 && end > start);

    const copy = {
        classList: { contains: name => name === 'report-copy' },
        textContent: '简要进展：第一行\n第二行\n第三行',
        innerText: '简要进展：第一行\n第二行\n第三行',
        getBoundingClientRect: () => ({ height: 20 })
    };
    const tableCell = {
        textContent: '临时许可证使用进展与商用转换跟踪说明'.repeat(5),
        querySelector: () => null
    };
    const table = {
        tagName: 'TABLE',
        rows: [{ cells: [{ ...tableCell, classList: { contains: name => name === 'report-metric-critical' } }, { ...tableCell, textContent: '其他' }],
            parentElement: { tagName: 'TBODY' }, getBoundingClientRect: () => ({ height: 20 }) }]
    };
    const brand = {
        classList: { contains: name => name === 'report-copy' || name === 'report-title' || name === 'report-footer-brand' },
        textContent: '埃及网络保障与运维服务部',
        innerText: '埃及网络保障与运维服务部',
        getBoundingClientRect: () => ({ height: 40 })
    };
    const documentUrl = 'https://w3.huawei.com/info/cn/doc/viewDoc.do?did=19787023&cata=333961';
    const guidanceLink = {
        classList: { contains: name => name === 'report-copy' || name === 'report-guidance-link' },
        textContent: documentUrl,
        innerText: documentUrl,
        querySelector: () => ({ textContent: documentUrl, href: documentUrl }),
        getBoundingClientRect: () => ({ height: 25 })
    };
    const sheet = { children: [copy, table, guidanceLink, brand], querySelectorAll: () => [table] };
    const append = vm.runInNewContext(`(() => { ${source.slice(start, end)} return appendMonthlyWorksheet; })()`, {
        document: { getElementById: () => sheet },
        getComputedStyle: () => ({ fontWeight: '400', fontSize: '12px', color: 'rgb(0, 0, 0)' }),
        reportExcelRichText: block => block.textContent,
        excelReportColor: () => 'FF000000'
    });
    const workbook = new ExcelJS.Workbook();
    const worksheet = append(workbook);
    assert.ok(worksheet.getRow(1).height >= 50, 'Three explicit lines must be visible');
    assert.ok(worksheet.getRow(2).height >= 60, 'Long wrapped table text must be visible');
    assert.equal(worksheet.getRow(2).getCell(1).font.color.argb, 'FFA61B1B', 'Highlighted counts stay red in Excel');
    assert.equal(worksheet.getRow(3).getCell(1).value.hyperlink, documentUrl, 'Management rule URL remains clickable in Excel');
    assert.equal(worksheet.getRow(4).getCell(1).alignment.horizontal, 'center');
    assert.equal(worksheet.getRow(4).getCell(1).fill.fgColor.argb, 'FFDCEEF4', 'Closing banner matches report title');

    assert.match(source, /紧急恢复场景 License/);
    assert.match(source, /License 管理规定&指导/);
    assert.ok(source.indexOf("addReportTable(host, '（表 2）', highRiskRows") < source.indexOf("addReportTable(host, '（表 3）', rows, 'report-line'"), 'Core risk precedes product lines');
    assert.match(source, /总体目标：无 License 违规使用/);
    assert.match(source, /请 \$\{expiryAccounts \|\| '相关'\} 系统部和 CS 重点关注/);
    assert.match(source, /viewDoc\.do\?did=19787023&cata=333961/);
    assert.match(source, /BP0002976353\/3\?treeId=a709931a-5415-4346-94f2-4756538100d3&flowAdapt=true&orgCode=1001/);

    const buffer = await workbook.xlsx.writeBuffer();
    const readBack = new ExcelJS.Workbook();
    await readBack.xlsx.load(buffer);
    assert.equal(readBack.worksheets[0].getRow(1).height, worksheet.getRow(1).height);
    assert.equal(readBack.worksheets[0].getRow(2).height, worksheet.getRow(2).height);
});

test('temporary License monthly report includes synchronous English report, department signature, and Excel divider', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');
    const topicHtml = fs.readFileSync(path.join(__dirname, '../frontend/pages/topic-analysis.html'), 'utf8');
    const topicJs = fs.readFileSync(path.join(__dirname, '../frontend/js/topic-analysis.js'), 'utf8');

    // 1. Department signature check in topic-analysis and esn-check
    const expectedSig = 'Egypt Network Assurance & Maintenance Service Dept';
    assert.match(topicHtml, /Egypt Network Assurance &amp; Maintenance Service Dept/);
    assert.doesNotMatch(topicHtml, /Operations Service Dept/, 'Legacy Operations Service Dept should be replaced');
    assert.match(source, /Egypt Network Assurance & Maintenance Service Dept/);

    // 2. Bilingual English monthly report generation check
    assert.match(source, /ENGLISH VERSION · 英文对照简报/);
    assert.match(source, /Egypt Operators Temporary License Usage & Commercial Conversion Monthly Report/);
    assert.match(source, /Overall Objective: Zero License non-compliant usage/);
    assert.match(source, /Executive Summary:/);
    assert.match(source, /\[Overall Trend\] The total number of active temporary Licenses/);
    assert.match(source, /\[Core Risks\] No PO temporary Licenses on core network elements/);
    assert.match(source, /\[Redline Violations\]/);
    assert.match(source, /\[Expired & Expiring Soon\] License expiration may lead to network disruptions/);
    assert.match(source, /addReportTable\(host, '\(Table 1\)', rows, 'report-scenario', true\)/);
    assert.match(source, /addReportTable\(host, '\(Table 2\)', highRiskRows, 'report-scenario', true\)/);
    assert.match(source, /addReportTable\(host, '\(Table 3\)', rows, 'report-line', true\)/);
    assert.match(source, /addReportTable\(host, '\(Table 4\)', rows, 'report-status', true\)/);

    // 3. Excel worksheet divider check
    const start = source.indexOf('        function reportExcelTextHeight(');
    const end = source.indexOf('        async function downloadExcelWorkbook(', start);
    const dividerNode = {
        classList: { contains: name => name === 'report-divider-en' }
    };
    const sheet = { children: [dividerNode], querySelectorAll: () => [] };
    const append = vm.runInNewContext(`(() => { ${source.slice(start, end)} return appendMonthlyWorksheet; })()`, {
        document: { getElementById: () => sheet },
        getComputedStyle: () => ({ fontWeight: '400', fontSize: '12px', color: 'rgb(0, 0, 0)' }),
        reportExcelRichText: block => block.textContent,
        excelReportColor: () => 'FF000000'
    });
    const workbook = new ExcelJS.Workbook();
    const worksheet = append(workbook);
    assert.match(worksheet.getRow(1).getCell(1).value, /ENGLISH VERSION/);
    assert.equal(worksheet.getRow(1).getCell(1).alignment.horizontal, 'center');

    // 4. Topic analysis mapping deletion persistence check (Egypt deleted should stay deleted)
    const storage = {};
    const mockLocalStorage = {
        getItem: key => storage[key] ?? null,
        setItem: (key, val) => { storage[key] = String(val); }
    };
    const readMappingConfigFn = vm.runInNewContext(`(() => {
        const DEFAULT_MAPPINGS = {
            'Etisalat Misr': 'e&',
            'Orange Egypt for Telecommunications': 'Orange',
            'Vodafone Egypt': 'Vodafone',
            'Telecom Egypt': 'TE',
            'NILE ON LINE (NOL)': 'e&'
        };
        const DEFAULT_MIN_THRESHOLD = 10;
        function getMappingStorageKey() { return 'topic-eos:mapping-config:v1:default'; }
        ${topicJs.slice(topicJs.indexOf('    function readMappingConfig() {'), topicJs.indexOf('    function saveMappingConfig('))}
        return readMappingConfig;
    })()`, {
        localStorage: mockLocalStorage
    });

    // Default when no storage
    const initialConfig = readMappingConfigFn();
    assert.equal(initialConfig.aliases['Egypt'], undefined, 'Default mappings must NOT include Egypt -> TE');
    assert.equal(initialConfig.aliases['Orange Egypt for Telecommunications'], 'Orange', 'Default mapping for Orange is Orange');
    assert.equal(initialConfig.aliases['Etisalat Misr'], 'e&');
    assert.equal(initialConfig.aliases['Telecom Egypt'], 'TE');
    assert.equal(initialConfig.aliases['Vodafone Egypt'], 'Vodafone');

    // User modifies mapping and saves
    initialConfig.aliases['Custom Client'] = 'CC';
    mockLocalStorage.setItem('topic-eos:mapping-config:v1:default', JSON.stringify({
        minThreshold: 15,
        aliases: initialConfig.aliases
    }));

    // Re-read configuration: custom changes must persist
    const reloadedConfig = readMappingConfigFn();
    assert.equal(reloadedConfig.aliases['Custom Client'], 'CC', 'Custom mapping must persist');
    assert.equal(reloadedConfig.minThreshold, 15);
});

test('temporary License monthly report includes complete multi-format export matrix (PNG scopes, PDF, standalone HTML)', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');

    // 1. Script tags must use local shared scripts
    assert.match(source, /<script src="\/js\/shared\/html2canvas\.min\.js"><\/script>/);
    assert.match(source, /<script src="\/js\/shared\/jspdf\.umd\.min\.js"><\/script>/);

    // 2. Dropdown UI and scope options
    assert.match(source, /id="reportPngDropdown"/);
    assert.match(source, /id="reportPngMenu"/);
    assert.match(source, /data-png-scope="cn"/);
    assert.match(source, /data-png-scope="en"/);
    assert.match(source, /data-png-scope="both"/);
    assert.match(source, /data-png-scope="all-three"/);

    // 3. Export buttons
    assert.match(source, /id="report-pdf"/);
    assert.match(source, /id="report-html"/);

    // 4. Single-language CSS export filters
    assert.match(source, /\.export-mode-cn\s+\[data-report-lang="en"\]/);
    assert.match(source, /\.export-mode-en\s+\[data-report-lang="cn"\]/);

    // 5. Export functions
    assert.match(source, /function togglePngDropdown\(/);
    assert.match(source, /function closePngDropdown\(/);
    assert.match(source, /async function captureAndDownloadMonthlyPng\(scope, button, label\)/);
    assert.match(source, /async function exportMonthlyPng\(scope = 'both'\)/);
    assert.match(source, /async function exportMonthlyPdf\(\)/);
    assert.match(source, /async function exportMonthlyHtml\(\)/);

    // 6. Filename conventions
    assert.match(source, /临时License月报_\$\{label\}\$\{suffix\}\.png/);
    assert.match(source, /临时License月报_\$\{label\}\.pdf/);
    assert.match(source, /临时License月报_\$\{label\}\.html/);
});

test('temporary License monthly report includes bilingual anchors, navigation bar, sync capsule, and diff popover', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');

    // 1. Bidirectional anchors and nav bars
    assert.match(source, /id=['"]license-section-cn['"]|\.id\s*=\s*['"]license-section-cn['"]/);
    assert.match(source, /id=['"]licenseReportNavCn['"]|\.id\s*=\s*['"]licenseReportNavCn['"]/);
    assert.match(source, /id=['"]license-section-en['"]|\.id\s*=\s*['"]license-section-en['"]/);
    assert.match(source, /id=['"]licenseReportNavEn['"]|\.id\s*=\s*['"]licenseReportNavEn['"]/);
    assert.match(source, /跳转到英文版月报 ⬇️/);
    assert.match(source, /⬆️ 返回中文版月报/);

    // 2. Bilingual status capsule and popover DOM
    assert.match(source, /id="report-sync-capsule"/);
    assert.match(source, /id="reportDiffPopover"/);
    assert.match(source, /id="reportDiffStatusTag"/);
    assert.match(source, /id="reportDiffBefore"/);
    assert.match(source, /id="reportDiffAfter"/);
    assert.match(source, /id="reportDiffCopyBtn"/);
    assert.match(source, /id="reportDiffRevertBtn"/);
    assert.match(source, /id="reportDiffAiBtn"/);

    // 3. Logic functions
    assert.match(source, /function updateReportBilingualStatus\(\)/);
    assert.match(source, /function attachDiffPopoverToEnEl\(/);
    assert.match(source, /function showDiffPopover\(anchorEl, context\)/);
    assert.match(source, /function hideDiffPopover\(/);
    assert.match(source, /async function performAiTranslate\(cnEl, enEl, btn\)/);
    assert.match(source, /function revertTranslation\(cnEl, enEl, revertBtn\)/);

    // 4. AI route check
    assert.match(source, /\/api\/ai\/translate/);
});

test('temporary License monthly report supports offline project archive (.license.json export & import)', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');

    // 1. Project control buttons & file input
    assert.match(source, /id="report-export-project"/);
    assert.match(source, /id="report-import-project"/);
    assert.match(source, /id="report-project-file"/);
    assert.match(source, /id="report-project-badge"/);

    // 2. Logic functions
    assert.match(source, /function exportLicenseProject\(\)/);
    assert.match(source, /async function importLicenseProject\(file\)/);

    // 3. File extension and type convention
    assert.match(source, /\.license\.json/);
    assert.match(source, /fileType:\s*'esn-license-monthly-project'/);
});

test('installCanvasGuard protects against zero-dimension canvas crashes', () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');

    assert.match(source, /function installCanvasGuard\(\)/);

    // Run guard in mock CanvasRenderingContext2D environment
    const mockContextProto = {
        createPattern(image, repetition) {
            return { image, repetition };
        }
    };
    const mockContext = {
        mockContextProto
    };

    const guardStart = source.indexOf('(function installCanvasGuard() {');
    assert.ok(guardStart > 0, 'Must have installCanvasGuard IIFE');
    const guardEnd = source.indexOf('})();', guardStart) + 5;
    const guardCode = source.slice(guardStart, guardEnd);

    const dummyCanvas = { width: 0, height: 0 };
    const mockDoc = {
        createElement(tag) {
            return { tagName: tag.toUpperCase(), width: 0, height: 0 };
        }
    };

    const runGuard = vm.runInNewContext(`(() => {
        function CanvasRenderingContext2D() {}
        CanvasRenderingContext2D.prototype = {
            createPattern: function(image, rep) {
                if (image.width === 0 || image.height === 0) {
                    throw new Error('Zero-size canvas image pattern crash');
                }
                return { patternFor: image, rep };
            }
        };
        const document = {
            createElement: function(tag) { return { width: 0, height: 0 }; }
        };
        ${guardCode}
        return CanvasRenderingContext2D;
    })()`);

    const ctx = new runGuard();
    // Normal pattern with non-zero dimensions
    const normalPattern = ctx.createPattern({ width: 100, height: 100 }, 'repeat');
    assert.equal(normalPattern.patternFor.width, 100);

    // Zero dimension image should NOT throw, and fallback to 1x1 dummy
    const safePattern = ctx.createPattern({ width: 0, height: 0 }, 'repeat');
    assert.equal(safePattern.patternFor.width, 1);
    assert.equal(safePattern.patternFor.height, 1);
});

test('esn-check index.html has single root closing body tag and does not leak script code when served with runtime', () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');
    const bodyMatches = [...source.matchAll(/<\/body\s*>/gi)];
    assert.equal(bodyMatches.length, 1, 'File must only contain exactly 1 literal </body> tag at document root');

    const i18nService = require('../backend/models/custom-tool-i18n-service');
    const served = i18nService.injectLanguageRuntime(source, 'esn-check');

    // In the served HTML, the original main script ends before the injected watermark
    const originalScriptSnippetPos = served.indexOf('updateImportSummaryBar();');
    const scriptEndAfterSnippet = served.indexOf('</script>', originalScriptSnippetPos);
    const watermarkPos = served.indexOf('id="__tools_html_meta_watermark__"');
    const finalBodyPos = served.lastIndexOf('</body>');

    assert.ok(watermarkPos > 0, 'Watermark must be injected');
    assert.ok(watermarkPos > scriptEndAfterSnippet, 'Watermark must be injected AFTER original script, not inside a script block');
    assert.ok(watermarkPos < finalBodyPos, 'Watermark must be injected before </body>');

    // Ensure exportMonthlyHtml blob code is not exposed outside script
    assert.doesNotMatch(served, /<\/script>[\s\S]*?';\s*const blob = new Blob/, 'Script code must not leak after </script>');
});

test('column aggregation splits headers into two rows with multi-line notes and wide layout', () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');
    const topicCss = fs.readFileSync(path.join(__dirname, '../frontend/css/topic-analysis.css'), 'utf8');
    const topicJs = fs.readFileSync(path.join(__dirname, '../frontend/js/topic-analysis.js'), 'utf8');
    const msgJs = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/report-msg-export.js'), 'utf8');

    // 1. Two-row header and subnote styles
    assert.match(source, /headRowTop\s*=\s*thead\.insertRow\(\)/);
    assert.match(source, /headRowSub\s*=\s*thead\.insertRow\(\)/);
    assert.match(source, /th(?:First|Total)?\.rowSpan\s*=\s*2/);
    assert.match(source, /thSub\.className\s*=\s*['"]report-col-subnote['"]/);
    assert.match(source, /thSub\.appendChild\(document\.createElement\('br'\)\)/);
    assert.match(source, /\.report-sheet th\.report-col-subnote/);

    // 2. Widescreen container sizing
    assert.match(source, /\.report-sheet\s*\{\s*[^}]*max-width:\s*1320px/);
    assert.match(source, /\.license-html-page\s*\{\s*[^}]*max-width:\s*1560px/);
    assert.match(topicCss, /\.topic-report-sheet\s*\{\s*[^}]*max-width:\s*1320px/);
    assert.match(topicJs, /\.topic-html-page\s*\{\s*[^}]*max-width:\s*1560px/);

    // 3. Outlook MSG wide layout
    // Email width follows the rendered report width, falling back to 1320px.
    assert.match(msgJs, /const emailWidth\s*=[^;]*:\s*1320\s*;/);
    assert.match(msgJs, /target\.setAttribute\('width',\s*'100%'\)/);
});

test('exportMonthlyHtml does not leak ody> text and report-msg-export converts blocks into email tables', () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');
    const msgJs = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/report-msg-export.js'), 'utf8');

    // 1. Must not contain unescaped broken literal `</' + 'head>` or `<' + 'body>`
    assert.doesNotMatch(source, /^[ \t]*<\/' \+ 'head>/m);
    assert.doesNotMatch(source, /^[ \t]*<' \+ 'body>/m);
    assert.match(source, /\$\{'<\/' \+ 'head>'\}/);
    assert.match(source, /\$\{'<' \+ 'body>'\}/);

    // 2. exportMonthlyHtml overrides inner report-sheet max-width to fill license-html-page
    assert.match(source, /\.license-html-page \.report-sheet\s*\{\s*[^}]*max-width:\s*none/);

    // 3. Email export defines convertBlocksToEmailTables and uses MSO width 1320
    assert.match(msgJs, /function convertBlocksToEmailTables\(/);
    assert.match(msgJs, /<!--\[if \(gte mso 9\)\|\(IE\)\]>\s*<table role="presentation" width="\$\{emailWidth\}"/);
});




