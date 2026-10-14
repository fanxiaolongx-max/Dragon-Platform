const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const workbenchSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/workbench.js'), 'utf8');
const generatorSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/generator.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/i18n.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(projectRoot, 'frontend/pages/uivf12.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(projectRoot, 'frontend/css/uivf12.css'), 'utf8');

test('uivf12 HTML contains response sample input, focus bar, and choice modal', () => {
    assert.match(pageSource, /id="responseSampleInput"/, 'HTML should contain #responseSampleInput');
    assert.match(pageSource, /id="responseSampleViewer"/, 'HTML should contain #responseSampleViewer');
    assert.match(pageSource, /id="responseFocusBar"/, 'HTML should contain #responseFocusBar');
    assert.match(pageSource, /id="responseFocusKeyword"/, 'HTML should contain #responseFocusKeyword');
    assert.match(pageSource, /id="btnChooseResponseFocus"/, 'HTML should contain #btnChooseResponseFocus');
    assert.match(pageSource, /id="responseFocusPath"/, 'HTML should contain #responseFocusPath');
    assert.match(pageSource, /id="uivResponseChoiceOverlay"/, 'HTML should contain #uivResponseChoiceOverlay');
    assert.match(pageSource, /id="uivResponseChoiceList"/, 'HTML should contain #uivResponseChoiceList');
    assert.match(pageSource, /id="responseSampleGuidePopover"/, 'HTML should contain #responseSampleGuidePopover');
    assert.match(pageSource, /id="responseSampleGuideTrigger"/, 'HTML should contain #responseSampleGuideTrigger');
    assert.match(pageSource, /id="responseFocusMultiHint"/, 'HTML should contain #responseFocusMultiHint');
    assert.match(pageSource, /id="responseFocusCandidateChips"/, 'HTML should contain #responseFocusCandidateChips');
});

test('uivf12 i18n dictionaries contain bilingual response sample and focus keys', () => {
    const dictMatch = i18nSource.match(/const dictionaries = (\{[\s\S]*?\n    \});/);
    assert.ok(dictMatch, 'dictionaries object must exist in i18n.js');
    const dicts = new Function(`return ${dictMatch[1]};`)();

    const expectedKeys = [
        'uiv.input.responseSampleLabel',
        'uiv.input.responseSampleHint',
        'uiv.input.responseSamplePlaceholder',
        'uiv.focus.badge',
        'uiv.focus.singleTable',
        'uiv.focus.multipleTables',
        'uiv.focus.keywordMatched',
        'uiv.focus.keywordMultiple',
        'uiv.focus.keywordNone',
        'uiv.focus.selectedInfo',
        'uiv.focus.chooseTable',
        'uiv.focus.chooseTableMulti',
        'uiv.focus.multiCandidatePrompt',
        'uiv.focus.multiCandidateSpecified',
        'uiv.focus.modalTitle',
        'uiv.focus.modalSubtitle',
        'uiv.focus.modalMultiSubtitle',
        'uiv.focus.matchedBadge',
        'uiv.focus.unmatchedBadge',
        'uiv.focus.keywordPlaceholder',
        'uiv.focus.clearTitle',
        'uiv.focus.closeModal',
        'uiv.focus.activeLog',
        'uiv.sampleGuide.badgeText',
        'uiv.sampleGuide.popoverTitle',
        'uiv.sampleGuide.popoverDesc',
        'uiv.sampleGuide.descDatafab',
        'uiv.sampleGuide.descStandard',
        'uiv.sampleGuide.descNested',
        'uiv.sampleGuide.fillBtn',
        'uiv.sampleGuide.copyBtn'
    ];

    for (const key of expectedKeys) {
        assert.ok(dicts['zh-CN'][key], `zh-CN missing key: ${key}`);
        assert.ok(dicts['en-US'][key], `en-US missing key: ${key}`);
    }
});

test('workbench discoverResponseTables correctly parses DataFab multi-table response', () => {
    // Setup minimal environment to evaluate workbench functions
    const mockWindow = {};
    const fn = new Function('window', `${workbenchSource}; return window.UIVWorkbench;`);
    const UIVWorkbench = fn(mockWindow);

    const sampleResponse = {
        data: [
            {
                id: 'comp_region_001',
                metadata: [
                    { displayName: 'Region', column: 'region_name_en_mp' },
                    { displayName: '变更单数量', column: 'cr_count' }
                ],
                data: [
                    { Region: 'Northern Africa Region', '变更单数量': 10 }
                ]
            },
            {
                id: 'comp_repoffice_002',
                metadata: [
                    { displayName: 'rep_name_en_mp', column: 'rep_name_en_mp' },
                    { displayName: '变更单数量', column: 'cr_count' }
                ],
                data: [
                    { rep_name_en_mp: 'Egypt Rep Office', '变更单数量': 5 }
                ]
            }
        ]
    };

    const tables = UIVWorkbench.discoverResponseTables(sampleResponse);
    assert.equal(tables.length, 2, 'Should discover exactly 2 candidate tables');
    assert.equal(tables[0].componentIndex, 0);
    assert.equal(tables[0].componentId, 'comp_region_001');
    assert.match(tables[0].title, /Region/);
    assert.equal(tables[0].path, 'data[0].data');

    assert.equal(tables[1].componentIndex, 1);
    assert.equal(tables[1].componentId, 'comp_repoffice_002');
    assert.match(tables[1].title, /rep_name_en_mp/);
    assert.match(tables[1].title, /Egypt Rep Office/);
    assert.equal(tables[1].path, 'data[1].data');
});

test('workbench matchTableByKeyword scores and focuses the rep office table', () => {
    const sampleResponse = {
        data: [
            {
                id: 'comp_region_001',
                metadata: [
                    { displayName: 'Region', column: 'region_name_en_mp' },
                    { displayName: '变更单数量', column: 'cr_count' }
                ],
                data: [
                    { Region: 'Northern Africa Region', '变更单数量': 10 }
                ]
            },
            {
                id: 'comp_repoffice_002',
                metadata: [
                    { displayName: 'rep_name_en_mp', column: 'rep_name_en_mp' },
                    { displayName: '变更单数量', column: 'cr_count' }
                ],
                data: [
                    { rep_name_en_mp: 'Egypt Rep Office', '变更单数量': 5 }
                ]
            }
        ]
    };

    const mockDocument = {
        getElementById: (id) => {
            if (id === 'responseSampleInput') return { value: JSON.stringify(sampleResponse), style: {} };
            if (id === 'responseSampleViewer') return { style: {}, innerHTML: '' };
            if (id === 'responseFocusKeyword') return { value: 'rep offic' };
            if (id === 'responseFocusPath') return { value: '' };
            if (id === 'responseFocusBar') return { style: {} };
            if (id === 'responseFocusSummary') return { textContent: '' };
            if (id === 'responseFocusTableCount') return { textContent: '' };
            if (id === 'responseFocusSelectedInfo') return { style: {}, innerHTML: '' };
            return null;
        }
    };
    const mockWindow = { document: mockDocument };
    const fn = new Function('window', 'document', `${workbenchSource}; return window.UIVWorkbench;`);
    const UIVWorkbench = fn(mockWindow, mockDocument);

    UIVWorkbench.formatAndAnalyzeResponseSample();

    const config = UIVWorkbench.getResponseFocusConfig();
    assert.ok(config, 'focus config should be returned');
    assert.equal(config.componentIndex, 1, 'Should match table index 1 (rep office)');
    assert.equal(config.componentId, 'comp_repoffice_002');
    assert.equal(config.path, 'data[1].data');
    assert.equal(config.keyword, 'rep offic');
});

test('generator embeds focus logic into extractRows, extractSmartSumData, and sumReqPayload', () => {
    // Mock environment for generator
    const mockDOM = {
        errorMsg: { innerText: '' },
        jsonInput: { value: '{"srcTenantId":"tenant_123","answerParamList":[{"id":"id_0","params":{}},{"id":"id_1","params":{}}]}', style: {} },
        payloadViewer: { style: {} },
        requestUrl: { value: 'https://datafab-pro.gtsdata.huawei.com/DataFabKernelCn/v1/answer/getAnswers' },
        fileName: { value: 'PBI_RepOffice' },
        useGlobalVars: { checked: true },
        isPagination: { checked: true },
        forceSumData: { checked: true },
        autoFetchCPC: { checked: false },
        autoRuntimeMonth: { checked: false },
        codeOutput: { value: '' },
        consoleOutput: { value: '' }
    };

    const mockWindow = {
        document: {
            getElementById: (id) => mockDOM[id] || null
        },
        UIVGenLog: {
            start: () => {},
            section: () => {},
            info: () => {},
            dim: () => {},
            error: () => {},
            success: () => {},
            done: () => {}
        },
        UIVT: (key) => key,
        UIVWorkbench: {
            formatAndAnalyzeJSON: () => {},
            getParsedPayload: () => JSON.parse(mockDOM.jsonInput.value),
            findKeyDeep: (obj, key) => {
                if (!obj || typeof obj !== 'object') return null;
                if (obj[key] !== undefined) return obj[key];
                for (const k of Object.keys(obj)) {
                    const r = mockWindow.UIVWorkbench.findKeyDeep(obj[k], key);
                    if (r) return r;
                }
                return null;
            },
            setCurrentTitle: () => {}
        }
    };

    const sandbox = new Function('window', 'document', 'UIVGenLog', 'UIVT', `${generatorSource}; return generateScript;`);
    const generateScript = sandbox(mockWindow, mockWindow.document, mockWindow.UIVGenLog, mockWindow.UIVT);

    // 1. Generate with focusConfig on Component 1 (rep office)
    generateScript({
        responseFocus: {
            keyword: 'rep offic',
            path: 'data[1].data',
            componentIndex: 1,
            componentId: 'id_1',
            title: 'rep_name_en_mp (Egypt Rep Office)'
        }
    });

    const consoleScript = mockDOM.consoleOutput.value;
    assert.ok(consoleScript, 'Console script should have been generated');
    assert.match(consoleScript, /const focusCompIdx = 1;/);
    assert.doesNotMatch(consoleScript, /const focusCompIdx = \(focusConfig &&/);

    const rowsMatch = consoleScript.match(/function extractRows\(obj\)\s*\{[\s\S]*?\n\s{9}\}/)[0];
    const sumMatch = consoleScript.match(/function extractSmartSumData\(resObj\)\s*\{[\s\S]*?\n\s{8}\}/)[0];

    const extractRows = new Function('obj', 'console', rowsMatch + '; return extractRows(obj);');
    const extractSmartSumData = new Function('resObj', 'console', sumMatch + '; return extractSmartSumData(resObj);');

    const sampleApiResponse = {
        data: [
            {
                id: 'id_0',
                metadata: [{ displayName: 'Region' }],
                data: [{ Region: 'Northern Africa' }],
                totalsData: { columns: { '变更单数量': { formula: 100 } } }
            },
            {
                id: 'id_1',
                metadata: [{ displayName: 'rep_name_en_mp' }],
                data: [{ rep_name_en_mp: 'Egypt Rep Office' }],
                totalsData: { columns: { '变更单数量': { formula: 55 } } }
            }
        ]
    };

    const rows = extractRows(sampleApiResponse, { log: () => {} });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rep_name_en_mp, 'Egypt Rep Office', 'extractRows must extract component 1 data when focused on rep offic');

    const sum = extractSmartSumData(sampleApiResponse, { log: () => {} });
    assert.ok(sum, 'extractSmartSumData should return sum object');
    assert.equal(sum['变更单数量'].formula, 55, 'extractSmartSumData must prioritize component 1 totalsData');
});

test('generator without responseFocus defaults to backward compatible component 0 extraction', () => {
    const mockDOM = {
        errorMsg: { innerText: '' },
        jsonInput: { value: '{"srcTenantId":"tenant_123","answerParamList":[{"id":"id_0","params":{}},{"id":"id_1","params":{}}]}', style: {} },
        payloadViewer: { style: {} },
        requestUrl: { value: 'https://datafab-pro.gtsdata.huawei.com/DataFabKernelCn/v1/answer/getAnswers' },
        fileName: { value: 'PBI_Default' },
        useGlobalVars: { checked: true },
        isPagination: { checked: true },
        forceSumData: { checked: true },
        autoFetchCPC: { checked: false },
        autoRuntimeMonth: { checked: false },
        codeOutput: { value: '' },
        consoleOutput: { value: '' }
    };

    const mockWindow = {
        document: {
            getElementById: (id) => mockDOM[id] || null
        },
        UIVGenLog: {
            start: () => {},
            section: () => {},
            info: () => {},
            dim: () => {},
            error: () => {},
            success: () => {},
            done: () => {}
        },
        UIVT: (key) => key,
        UIVWorkbench: {
            formatAndAnalyzeJSON: () => {},
            getParsedPayload: () => JSON.parse(mockDOM.jsonInput.value),
            findKeyDeep: (obj, key) => {
                if (!obj || typeof obj !== 'object') return null;
                if (obj[key] !== undefined) return obj[key];
                for (const k of Object.keys(obj)) {
                    const r = mockWindow.UIVWorkbench.findKeyDeep(obj[k], key);
                    if (r) return r;
                }
                return null;
            },
            setCurrentTitle: () => {},
            getResponseFocusConfig: () => null
        }
    };

    const sandbox = new Function('window', 'document', 'UIVGenLog', 'UIVT', `${generatorSource}; return generateScript;`);
    const generateScript = sandbox(mockWindow, mockWindow.document, mockWindow.UIVGenLog, mockWindow.UIVT);

    // Generate without focus config
    generateScript();

    const consoleScript = mockDOM.consoleOutput.value;
    const rowsMatch = consoleScript.match(/function extractRows\(obj\)\s*\{[\s\S]*?\n\s{9}\}/)[0];
    const extractRows = new Function('obj', 'console', rowsMatch + '; return extractRows(obj);');

    const sampleApiResponse = {
        data: [
            {
                id: 'id_0',
                metadata: [{ displayName: 'Region' }],
                data: [{ Region: 'Northern Africa' }]
            },
            {
                id: 'id_1',
                metadata: [{ displayName: 'rep_name_en_mp' }],
                data: [{ rep_name_en_mp: 'Egypt Rep Office' }]
            }
        ]
    };

    const rows = extractRows(sampleApiResponse, { log: () => {} });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Region, 'Northern Africa', 'Without focusConfig, extractRows must default to component 0 for backward compatibility');
});

test('uiv modules are cache-busted and i18n protects against raw key overwriting', () => {
    assert.match(pageSource, /i18n\.js"/);
    assert.match(pageSource, /workbench\.js"/);
    assert.match(pageSource, /generator\.js"/);
    assert.match(pageSource, /save\.js"/);
    assert.match(pageSource, /uivf12\.css"/);
    assert.match(i18nSource, /function isRawKey/);
    assert.match(i18nSource, /!isRawKey\(val\)/);
});

test('jsonInput and responseSampleInput evenly split vertical space', () => {
    assert.match(cssSource, /#jsonInput,\s*#payloadViewer,\s*#responseSampleInput,\s*#responseSampleViewer\s*\{[\s\S]*?flex:\s*1\s+1\s+0;[\s\S]*?min-height:\s*80px;/);
    assert.doesNotMatch(cssSource, /#jsonInput[^{]*\{[^}]*max-height:\s*200px/);
    assert.doesNotMatch(cssSource, /#responseSampleInput[^{]*\{[^}]*max-height:\s*160px/);
});

test('workbench supports sample guide templates and dynamic example loading', () => {
    const mockWindow = {};
    const fn = new Function('window', `${workbenchSource}; return window.UIVWorkbench;`);
    const UIVWorkbench = fn(mockWindow);

    assert.ok(UIVWorkbench.SAMPLE_GUIDE_TEMPLATES.datafab, 'datafab template should exist');
    assert.ok(UIVWorkbench.SAMPLE_GUIDE_TEMPLATES.standard, 'standard template should exist');
    assert.ok(UIVWorkbench.SAMPLE_GUIDE_TEMPLATES.nested, 'nested template should exist');

    const datafabTables = UIVWorkbench.discoverResponseTables(UIVWorkbench.SAMPLE_GUIDE_TEMPLATES.datafab);
    assert.equal(datafabTables.length, 2, 'DataFab guide sample should contain 2 candidate tables');
});

test('workbench handles multi-table matching when keyword exists in multiple tables', () => {
    const sampleMultiResponse = {
        data: [
            {
                id: 'comp_0_overview',
                metadata: [
                    { displayName: 'Region', column: 'region_name_en_mp' },
                    { displayName: 'Count', column: 'cnt' }
                ],
                data: [{ Region: 'North Africa', Count: 10 }]
            },
            {
                id: 'comp_1_detail',
                metadata: [
                    { displayName: 'rep_name', column: 'rep_name' },
                    { displayName: 'Region', column: 'region_name_en_mp' },
                    { displayName: 'Count', column: 'cnt' }
                ],
                data: [{ rep_name: 'Egypt', Region: 'North Africa', Count: 6 }]
            }
        ]
    };

    const mockDOM = {
        responseSampleInput: { value: JSON.stringify(sampleMultiResponse), style: {} },
        responseSampleViewer: { style: {}, innerHTML: '' },
        responseFocusKeyword: { value: 'Region' },
        responseFocusPath: { value: '' },
        responseFocusBar: { style: {} },
        responseFocusSummary: { textContent: '' },
        responseFocusTableCount: { textContent: '' },
        responseFocusSelectedInfo: { style: {}, innerHTML: '' },
        responseFocusMultiHint: { style: { display: 'none' } },
        responseFocusMultiHintText: { textContent: '' },
        responseFocusCandidateChips: { innerHTML: '' },
        btnChooseResponseFocus: {
            classList: {
                add: function(c) { this[c] = true; },
                remove: function(c) { delete this[c]; }
            },
            querySelector: () => ({ textContent: '' })
        }
    };

    const mockWindow = { document: { getElementById: (id) => mockDOM[id] || null } };
    const fn = new Function('window', 'document', `${workbenchSource}; return window.UIVWorkbench;`);
    const UIVWorkbench = fn(mockWindow, mockWindow.document);

    UIVWorkbench.formatAndAnalyzeResponseSample();

    const matches = UIVWorkbench.matchTableByKeyword('Region');
    assert.equal(matches.length, 2, 'Both tables should match the keyword "Region"');
    assert.equal(mockDOM.responseFocusMultiHint.style.display, 'flex', 'Multi-match hint should be displayed');
    assert.ok(mockDOM.responseFocusCandidateChips.innerHTML.includes('表 1') && mockDOM.responseFocusCandidateChips.innerHTML.includes('表 2'), 'Candidate chips for both tables should be rendered');

    // Simulate user explicitly clicking candidate Table 2 (index 1)
    UIVWorkbench.selectFocusTable(1, true);
    assert.equal(UIVWorkbench.isExplicitlySelected(), true);

    const config = UIVWorkbench.getResponseFocusConfig();
    assert.equal(config.componentIndex, 1, 'Component index 1 should be selected');
    assert.equal(config.path, 'data[1].data');
    assert.equal(config.userSelected, true);
});

test('generator extractRows prioritizes componentIndex when keyword matches multiple tables', () => {
    const mockDOM = {
        errorMsg: { innerText: '' },
        jsonInput: { value: '{"srcTenantId":"tenant_123","answerParamList":[{"id":"id_0"},{"id":"id_1"}]}', style: {} },
        payloadViewer: { style: {} },
        requestUrl: { value: 'https://datafab-pro.gtsdata.huawei.com/DataFabKernelCn/v1/answer/getAnswers' },
        fileName: { value: 'PBI_Target' },
        useGlobalVars: { checked: true },
        isPagination: { checked: true },
        forceSumData: { checked: false },
        autoFetchCPC: { checked: false },
        autoRuntimeMonth: { checked: false },
        codeOutput: { value: '' },
        consoleOutput: { value: '' }
    };

    const focusConfig = {
        keyword: 'Region',
        componentIndex: 1,
        componentId: 'comp_1_detail',
        path: 'data[1].data',
        title: 'Rep Office Detail',
        userSelected: true
    };

    const mockWindow = {
        document: {
            getElementById: (id) => mockDOM[id] || null
        },
        UIVGenLog: {
            start: () => {}, section: () => {}, info: () => {}, dim: () => {}, error: () => {}, success: () => {}, done: () => {}
        },
        UIVT: (key) => key,
        UIVWorkbench: {
            formatAndAnalyzeJSON: () => {},
            getParsedPayload: () => JSON.parse(mockDOM.jsonInput.value),
            findKeyDeep: (obj, key) => (obj && obj[key] !== undefined ? obj[key] : null),
            setCurrentTitle: () => {},
            getResponseFocusConfig: () => focusConfig
        }
    };

    const sandbox = new Function('window', 'document', 'UIVGenLog', 'UIVT', `${generatorSource}; return generateScript;`);
    const generateScript = sandbox(mockWindow, mockWindow.document, mockWindow.UIVGenLog, mockWindow.UIVT);

    generateScript();

    const consoleScript = mockDOM.consoleOutput.value;
    const rowsMatch = consoleScript.match(/function extractRows\(obj\)\s*\{[\s\S]*?\n\s{9}\}/)[0];
    const extractRows = new Function('obj', 'console', rowsMatch + '; return extractRows(obj);');

    // API response where BOTH comp 0 and comp 1 match "Region"
    const sampleApiResponse = {
        data: [
            {
                id: 'comp_0_overview',
                metadata: [{ displayName: 'Region' }],
                data: [{ Region: 'Region Overview (Wrong Table)' }]
            },
            {
                id: 'comp_1_detail',
                metadata: [{ displayName: 'Region' }, { displayName: 'rep_name' }],
                data: [{ Region: 'North Africa', rep_name: 'Egypt Rep Office (Correct Table)' }]
            }
        ]
    };

    const rows = extractRows(sampleApiResponse, { log: () => {} });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rep_name, 'Egypt Rep Office (Correct Table)', 'extractRows MUST extract component 1 chosen by user, NOT component 0');
});

