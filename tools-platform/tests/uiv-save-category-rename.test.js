const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(projectRoot, 'frontend/pages/uivf12.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(projectRoot, 'frontend/css/uivf12.css'), 'utf8');
const i18nSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/i18n.js'), 'utf8');
const saveSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/save.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/sidebar.js'), 'utf8');
const aiNamingSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/ai-naming.js'), 'utf8');
const scriptsRepo = require('../backend/models/uiv-scripts-repository');

test('uivf12 HTML contains category dropdown next to saveBtn and script rename modal', () => {
    // 1. Category dropdown next to #saveBtn
    assert.match(pageSource, /<select\s+id="saveCategorySelect"/, 'HTML should contain #saveCategorySelect');
    assert.match(pageSource, /data-uiv-i18n="uiv\.save\.autoCategory"/, '#saveCategorySelect should have auto-category default option');
    
    // Check that saveCategorySelect is right next to #saveBtn inside .btn-group
    const btnGroupMatch = pageSource.match(/<button id="saveBtn"[\s\S]*?<\/div>/);
    assert.ok(btnGroupMatch, 'Should find button group containing #saveBtn');
    assert.match(btnGroupMatch[0], /id="saveCategorySelect"/, '#saveCategorySelect must be next to #saveBtn inside the same button group');

    // 2. Script rename modal
    assert.match(pageSource, /id="uivScriptRenameOverlay"/, 'HTML should contain #uivScriptRenameOverlay');
    assert.match(pageSource, /id="uivScriptRenameTitle"/, 'HTML should contain #uivScriptRenameTitle');
    assert.match(pageSource, /id="uivScriptRenameInput"/, 'HTML should contain #uivScriptRenameInput');
    assert.match(pageSource, /id="uivScriptRenameCancel"/, 'HTML should contain #uivScriptRenameCancel');
    assert.match(pageSource, /id="uivScriptRenameSubmit"/, 'HTML should contain #uivScriptRenameSubmit');
});

test('uivf12 CSS contains styles for .save-category-select and .mini-btn.ren', () => {
    assert.match(cssSource, /\.save-category-select\s*\{/, 'CSS should style .save-category-select');
    assert.match(cssSource, /\.mini-btn\.ren\s*\{/, 'CSS should style .mini-btn.ren');
    assert.match(cssSource, /\.mini-btn\.ren:hover/, 'CSS should have hover style for .mini-btn.ren');
});

test('uivf12 i18n dictionaries contain comprehensive bilingual keys for category select and renaming', () => {
    const dictMatch = i18nSource.match(/const dictionaries = (\{[\s\S]*?\n    \});/);
    assert.ok(dictMatch, 'dictionaries object must exist in i18n.js');
    const dicts = new Function(`return ${dictMatch[1]};`)();

    const expectedKeys = [
        'uiv.save.autoCategory',
        'uiv.save.categorySelectTitle',
        'uiv.script.renameAction',
        'uiv.script.renameTitle',
        'uiv.renameDialog.eyebrow',
        'uiv.renameDialog.title',
        'uiv.renameDialog.message',
        'uiv.renameDialog.label',
        'uiv.renameDialog.placeholder',
        'uiv.renameDialog.cancel',
        'uiv.renameDialog.confirm',
        'uiv.renameDialog.required',
        'uiv.renameDialog.duplicate',
        'uiv.toast.scriptRenamed',
        'uiv.toast.renameFail'
    ];

    ['zh-CN', 'en-US'].forEach(lang => {
        expectedKeys.forEach(key => {
            assert.ok(dicts[lang][key], `Missing ${key} in ${lang}`);
        });
    });
});

test('save.js does not block saveCurrentScript on AI naming', () => {
    // Assert saveCurrentScript does not await waitForPending
    assert.doesNotMatch(saveSource, /await\s+window\.UIVAINaming\.waitForPending/, 'saveCurrentScript must not await waitForPending');
    assert.match(saveSource, /window\.UIVAINaming\?\.markSaved\?\.\(\)/, 'saveCurrentScript should notify AI naming that save occurred');
    assert.match(saveSource, /PREFERRED_CATEGORY_STORAGE_KEY\s*=\s*'uiv_preferred_save_category'/, 'save.js must use uiv_preferred_save_category storage key');
    assert.match(saveSource, /syncCategorySelect/, 'save.js must export syncCategorySelect');
    assert.match(saveSource, /onCategorySelectChange/, 'save.js must export onCategorySelectChange');
});

test('ai-naming.js supports markSaved and does not overwrite user name if saved while generating', () => {
    assert.match(aiNamingSource, /hasSavedCurrent/, 'ai-naming.js must track hasSavedCurrent');
    assert.match(aiNamingSource, /markSaved/, 'ai-naming.js must export markSaved');
    assert.match(aiNamingSource, /!hasSavedCurrent/, 'ai-naming.js must check !hasSavedCurrent before applyCandidate');
});

test('sidebar.js builds rename button to the left of delete button and provides rename dialog logic', () => {
    assert.match(sidebarSource, /const\s+renBtn\s*=\s*document\.createElement\('button'\)/, 'sidebar.js must create renBtn');
    assert.match(sidebarSource, /renBtn\.className\s*=\s*'mini-btn ren'/, 'renBtn must have class mini-btn ren');
    assert.match(sidebarSource, /showScriptRenameDialog/, 'sidebar.js must define showScriptRenameDialog');
    assert.match(sidebarSource, /renameScript/, 'sidebar.js must define renameScript');
    
    // Check that renBtn is appended before delBtn
    const renIndex = sidebarSource.indexOf("rightActions.appendChild(renBtn)");
    const delIndex = sidebarSource.indexOf("rightActions.appendChild(delBtn)");
    assert.ok(renIndex !== -1 && delIndex !== -1 && renIndex < delIndex, 'renBtn must be appended before delBtn');
});

test('uiv-scripts-repository renameScript preserves id and metadata, updates macro Name and consoleCode finalOutputName', async () => {
    await scriptsRepo.ensureReady();
    const testId = 'script_test_' + Date.now();
    const initialMacro = JSON.stringify({
        Name: 'OldName',
        CreationDate: '2026-10-12',
        Commands: [{ Command: 'echo', Target: 'hello', Value: '' }]
    }, null, 2);
    const initialConsole = `(async function() {\n    let finalOutputName = "OldName_Latest.csv";\n    console.log(finalOutputName);\n})();`;

    const sampleScript = {
        id: testId,
        name: 'OldName',
        category: 'TestCategory',
        url: 'https://example.com/api',
        code: initialMacro,
        consoleCode: initialConsole,
        payload: '{"foo":"bar"}',
        originalFileName: 'OldName',
        configOptions: { useGlobalVars: true, isPagination: false }
    };

    await scriptsRepo.saveScripts([sampleScript]);

    // Perform rename
    const renamed = await scriptsRepo.renameScript(testId, 'NewRenamedScript');
    assert.ok(renamed, 'renameScript should return updated script object');
    assert.strictEqual(renamed.id, testId, 'id must be preserved');
    assert.strictEqual(renamed.name, 'NewRenamedScript', 'name must be updated');
    assert.strictEqual(renamed.category, 'TestCategory', 'category must be preserved');
    assert.strictEqual(renamed.url, 'https://example.com/api', 'url must be preserved');
    assert.strictEqual(renamed.configOptions.useGlobalVars, true, 'configOptions must be preserved');

    // Check UI.Vision macro Name updated
    const parsedCode = JSON.parse(renamed.code);
    assert.strictEqual(parsedCode.Name, 'NewRenamedScript', 'Macro Name must be updated to new name');

    // Check consoleCode finalOutputName updated
    assert.match(renamed.consoleCode, /let finalOutputName = "NewRenamedScript_Latest\.csv"/, 'consoleCode finalOutputName must be updated');

    // Clean up
    await scriptsRepo.deleteScriptById(testId);
});

test('renameScript automatically synchronizes metric extraction rules, targets, and source table rules to new name', async () => {
    const { run, get } = require('../backend/models/app-db');
    const prefsRepo = require('../backend/models/sla-prefs-repository');

    const testId = 'script_sync_' + Date.now();
    const oldName = 'TestOldScript';
    const newName = 'TestNewScript';

    const oldHash = scriptsRepo.generateSchemaHash(`${oldName}_Latest`);
    const newHash = scriptsRepo.generateSchemaHash(`${newName}_Latest`);
    const oldPrefKey = `sla_prefs_other_${oldHash}`;
    const newPrefKey = `sla_prefs_other_${newHash}`;
    const oldSecId = `other_${oldHash}`;
    const newSecId = `other_${newHash}`;

    // 1. Prepare existing rules in sla_prefs for old script name
    const oldPayload = {
        visibleHeaders: ['colA', 'colB', 'colC'],
        columnWidths: {},
        sortKey: null,
        sortAsc: true,
        customMetrics: [
            {
                id: 'm_test_1',
                type: 'extract',
                colX: 'colA',
                valY: 'TARGET',
                colZ: 'colB',
                sourceSecId: oldSecId,
                label: '测试指标1'
            }
        ],
        _sourceMeta: {
            secId: oldSecId,
            mode: 'other',
            title: `📁 独立表: ${oldName}_Latest`,
            schemaHash: oldPrefKey,
            baseName: `${oldName}_Latest`,
            sourceFiles: [`${oldName}_Latest.csv`],
            matchedPrefix: `${oldName}_Latest*`,
            updatedAt: '2026-10-10T10:00:00.000Z'
        }
    };

    await run(
        `INSERT OR REPLACE INTO sla_prefs (pref_key, pref_kind, payload_json, updated_at) VALUES (?, 'schema', ?, CURRENT_TIMESTAMP)`,
        [oldPrefKey, JSON.stringify(oldPayload)]
    );

    // 2. Prepare warning target in sla_targets for old rule
    await run(
        `INSERT OR REPLACE INTO sla_targets (target_key, label, target_type, weight, auto_fill, is_percent, exceed_by, bonus, extra_config_json, updated_at)
         VALUES (?, '测试指标1', 'number', 10, 0, 0, 0, 0, '{}', CURRENT_TIMESTAMP)`,
        [`${oldSecId}_m_test_1`]
    );

    // 3. Prepare script in uiv_scripts
    const script = {
        id: testId,
        name: oldName,
        category: 'TestCategory',
        url: 'https://example.com/api',
        code: JSON.stringify({ Name: oldName }),
        consoleCode: `let finalOutputName = "${oldName}_Latest.csv";`,
        payload: '{}',
        originalFileName: oldName
    };
    await scriptsRepo.saveScripts([script]);

    // 4. Rename script
    const result = await scriptsRepo.renameScript(testId, newName);
    assert.ok(result, 'renameScript should succeed');
    assert.strictEqual(result.name, newName);
    assert.ok(result.ruleSyncCount >= 1, 'Should report at least 1 synchronized rule');

    // 5. Verify old prefKey was deleted from sla_prefs and new prefKey exists
    const oldRow = await get('SELECT payload_json FROM sla_prefs WHERE pref_key = ?', [oldPrefKey]);
    assert.strictEqual(oldRow, undefined, 'Old pref key should be replaced to prevent duplicate clutter in 全量规则');

    const newRow = await get('SELECT payload_json FROM sla_prefs WHERE pref_key = ?', [newPrefKey]);
    assert.ok(newRow, 'New pref key must exist in sla_prefs');
    const newPayload = JSON.parse(newRow.payload_json);

    // Verify _sourceMeta updated
    assert.strictEqual(newPayload._sourceMeta.secId, newSecId);
    assert.strictEqual(newPayload._sourceMeta.schemaHash, newPrefKey);
    assert.strictEqual(newPayload._sourceMeta.baseName, `${newName}_Latest`);
    assert.strictEqual(newPayload._sourceMeta.title, `📁 独立表: ${newName}_Latest`);
    assert.deepEqual(newPayload._sourceMeta.sourceFiles, [`${newName}_Latest.csv`]);
    assert.strictEqual(newPayload._sourceMeta.matchedPrefix, `${newName}_Latest*`);
    assert.ok(newPayload._sourceMeta.previousHashes.includes(oldPrefKey), 'Must record old prefKey in previousHashes');

    // Verify metric sourceSecId updated
    assert.strictEqual(newPayload.customMetrics[0].sourceSecId, newSecId);
    assert.strictEqual(newPayload.customMetrics[0].label, '测试指标1');

    // 6. Verify sla_targets updated
    const oldTarget = await get('SELECT target_key FROM sla_targets WHERE target_key = ?', [`${oldSecId}_m_test_1`]);
    assert.strictEqual(oldTarget, undefined, 'Old target key should be deleted');
    const newTarget = await get('SELECT target_key, label FROM sla_targets WHERE target_key = ?', [`${newSecId}_m_test_1`]);
    assert.ok(newTarget, 'New target key must exist');
    assert.strictEqual(newTarget.label, '测试指标1');

    // 7. Verify getPrefItem fallback supports old hash lookup
    const directFetch = await prefsRepo.getPrefItem(newPrefKey);
    assert.ok(directFetch.item, 'Should fetch rule by new hash directly');
    const aliasFetch = await prefsRepo.getPrefItem(oldPrefKey);
    assert.ok(aliasFetch.item, 'Should fetch rule by old hash via previousHashes fallback');
    assert.strictEqual(aliasFetch.item._sourceMeta.secId, newSecId);

    // Clean up
    await scriptsRepo.deleteScriptById(testId);
    await run('DELETE FROM sla_prefs WHERE pref_key = ?', [newPrefKey]);
    await run('DELETE FROM sla_targets WHERE target_key = ?', [`${newSecId}_m_test_1`]);
});

test('script analysis modal styles are wider, taller, and optimize 13 columns layout', () => {
    // 1. Modal dimensions
    assert.match(cssSource, /width:\s*min\(1920px,\s*98vw\);/, 'Modal width should be min(1920px, 98vw)');
    assert.match(cssSource, /height:\s*min\(940px,\s*95vh\);/, 'Modal height should be min(940px, 95vh)');

    // 2. Table min-width and column widths
    assert.match(cssSource, /\.script-analysis-table\s*\{[\s\S]*?min-width:\s*1380px;/, 'Table min-width should be 1380px');
    
    // Check that all 13 columns have explicit width rules
    for (let i = 1; i <= 13; i++) {
        const colRegex = new RegExp(`\\.script-analysis-table\\s+th:nth-child\\(${i}\\)[\\s\\S]*?width:`);
        assert.match(cssSource, colRegex, `Column ${i} must have width defined`);
    }

    // 3. HTML table header has 13 columns and empty row spans 13 columns
    assert.match(pageSource, /<td colspan="13" class="script-analysis-empty">等待分析\.\.\.<\/td>/, 'Empty row should span 13 columns');
});

test('renameScript automatically updates download filenames in both JavaScript code and UI.Vision JSON macros', async () => {
    await scriptsRepo.ensureReady();
    const testId = 'script_js_test_' + Date.now();
    const oldName = 'OldJsScript';
    const newName = 'NewJsScript';

    // Standard workbench script: code is a JS async function string
    const sampleJsCode = `return (async function() {
        let finalOutputName = "OldJsScript_Latest.csv";
        const link = document.createElement("a");
        link.download = finalOutputName;
        // 📦 队列 [1/1]: OldJsScript
        const taskName = "OldJsScript";
        console.log("Audit download result: OldJsScript");
    })();`;

    const sampleConsoleCode = `(async function() {
        let finalOutputName = 'OldJsScript_Latest.csv';
        const link = document.createElement("a");
        link.download = finalOutputName;
        const taskName = 'OldJsScript';
    })();`;

    const script = {
        id: testId,
        name: oldName,
        category: 'TestCategory',
        url: 'https://example.com/api',
        code: sampleJsCode,
        consoleCode: sampleConsoleCode,
        payload: '{}',
        originalFileName: oldName
    };

    await scriptsRepo.saveScripts([script]);

    const renamed = await scriptsRepo.renameScript(testId, newName);
    assert.ok(renamed, 'renameScript should succeed');
    assert.strictEqual(renamed.name, newName);
    assert.strictEqual(renamed.originalFileName, newName);
    assert.strictEqual(renamed.newOutputFileName, 'NewJsScript_Latest.csv');

    // Assert code has updated finalOutputName and taskName
    assert.match(renamed.code, /let finalOutputName = "NewJsScript_Latest\.csv"/, 'JS code finalOutputName must be updated');
    assert.match(renamed.code, /taskName = "NewJsScript"/, 'JS code taskName must be updated');
    assert.match(renamed.code, /\/\/ 📦 队列 \[1\/1\]: NewJsScript/, 'JS code queue comment must be updated');
    assert.match(renamed.code, /Audit download result: NewJsScript/, 'JS code audit comment must be updated');

    // Assert consoleCode has updated finalOutputName and taskName
    assert.match(renamed.consoleCode, /finalOutputName = "NewJsScript_Latest\.csv"/, 'consoleCode finalOutputName must be updated');
    assert.match(renamed.consoleCode, /taskName = "NewJsScript"/, 'consoleCode taskName must be updated');

    // Clean up
    await scriptsRepo.deleteScriptById(testId);
});

test('renameScript updates UI.Vision macro Commands targets, exports, and descriptions', async () => {
    await scriptsRepo.ensureReady();
    const testId = 'script_macro_test_' + Date.now();
    const oldName = 'OldMacroScript';
    const newName = 'NewMacroScript';

    const macroObj = {
        Name: oldName,
        CreationDate: '2026-10-12',
        Commands: [
            { Command: 'echo', Target: '[1/1] Run OldMacroScript', Value: '' },
            { Command: 'executeScript', Target: 'let finalOutputName = "OldMacroScript_Latest.csv"; const taskName = "OldMacroScript";', Value: '' },
            { Command: 'localStorageExport', Target: 'OldMacroScript_Latest.csv', Value: '' },
            { Command: 'executeScript', Target: 'return "ok";', Value: '', Description: 'Run controllable UIVF12 script: OldMacroScript' }
        ]
    };

    const script = {
        id: testId,
        name: oldName,
        category: 'TestCategory',
        url: 'https://example.com/api',
        code: JSON.stringify(macroObj, null, 2),
        consoleCode: `let finalOutputName = "OldMacroScript_Latest.csv";`,
        payload: '{}',
        originalFileName: oldName
    };

    await scriptsRepo.saveScripts([script]);

    const renamed = await scriptsRepo.renameScript(testId, newName);
    assert.ok(renamed, 'renameScript should succeed');

    const parsed = JSON.parse(renamed.code);
    assert.strictEqual(parsed.Name, newName);
    assert.strictEqual(parsed.Commands[0].Target, '[1/1] Run NewMacroScript');
    assert.match(parsed.Commands[1].Target, /finalOutputName = "NewMacroScript_Latest\.csv"/);
    assert.match(parsed.Commands[1].Target, /taskName = "NewMacroScript"/);
    assert.strictEqual(parsed.Commands[2].Target, 'NewMacroScript_Latest.csv');
    assert.strictEqual(parsed.Commands[3].Description, 'Run controllable UIVF12 script: NewMacroScript');

    // Clean up
    await scriptsRepo.deleteScriptById(testId);
});

