// node_modules/.bin/electron tests/snapshot-publish-ui-browser.cjs
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const acorn = require('acorn');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-publish-ui-'));
app.setPath('userData', path.join(temp, 'profile'));
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
const names = new Set(['snapshotApi', 'applyToolEstimateResult', 'markSnapshotEstimatePending', 'failSnapshotEstimate', 'renderSnapshotProgress', 'pollSnapshotProgress']);
const assignments = new Set(['toggleAllSnapshotTools', 'openSnapshotPublishProgress', 'closeSnapshotPublishProgress', 'saveSnapshotPublishSettings']);
const code = acorn.parse(source, { ecmaVersion: 'latest' }).body.filter(node =>
    node.type === 'FunctionDeclaration' && names.has(node.id.name) ||
    node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.left.object?.name === 'window' && assignments.has(node.expression.left.property.name)
).map(node => source.slice(node.start, node.end)).join('\n');
let win;
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
app.whenReady().then(async () => {
    const html = path.join(temp, 'index.html');
    fs.writeFileSync(html, '<!doctype html><link rel="stylesheet" href="' + path.join(__dirname, '../frontend/css/shared.css') + '"><body><div id="tools"></div>');
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadFile(html);
    await win.webContents.executeJavaScript(`const snapshotText=zh=>zh; const navEscape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); const navState={};const getAuthHeaderForNav=()=>({}); const SNAPSHOT_API='';let snapshotProgressTimer=null,snapshotProgressJobId='';\n${code}\nvoid 0;`);
    await evaluate(() => {
        document.getElementById('tools').innerHTML = ['small', 'large'].map(slug => `<div class="snapshot-tool-item" data-tool-slug="${slug}" data-requested-enabled="1"><input id="snapshotToolEnabled_${slug}" type="checkbox"><span id="snapshotToolSize_${slug}"></span><div id="snapshotToolWarning_${slug}"></div></div>`).join('');
        for (const slug of ['small', 'large']) {
            const item = document.querySelector(`[data-tool-slug="${slug}"]`);
            markSnapshotEstimatePending(item);
            item.dataset.requestedEnabled = '1';
            applyToolEstimateResult(slug, { fileCount: slug === 'large' ? 100 : 2, totalSizeFormatted: '1 MiB', isHeavy: slug === 'large', warningLevel: 'normal', supported: true }, document.getElementById('snapshotToolSize_' + slug), item, document.getElementById('snapshotToolWarning_' + slug));
        }
        toggleAllSnapshotTools(false); toggleAllSnapshotTools(true);
    });
    assert.deepEqual(await evaluate(() => ['small', 'large'].map(slug => { const c = document.getElementById('snapshotToolEnabled_' + slug); return [c.checked, c.disabled]; })), [[true, false], [false, true]]);
    await evaluate(async () => {
        for (const [id, value] of Object.entries({ snapshotRemoteUrl: 'https://example.test/repo.git', snapshotRepoDir: '', snapshotBranch: 'main', snapshotFile: '{toolSlug}/index.html', snapshotPublishMode: 'pages', snapshotScheduleEnabled: '', snapshotIntervalMinutes: '60' })) {
            const input = document.createElement('input'); input.id = id; input.value = value; document.body.append(input);
        }
        window.fetch = async (_url, options) => { window.savedSnapshotSettings = JSON.parse(options.body); return { ok: true, json: async () => ({ tools: [] }) }; };
        await saveSnapshotPublishSettings({ silent: true, skipPrereq: true });
    });
    assert.deepEqual(await evaluate(() => window.savedSnapshotSettings.tools), [{ toolSlug: 'small', enabled: true }], 'blocked rows must not overwrite settings or delete a previously forced page');
    const longError = 'remote: Error: '.repeat(20) + 'tp-static/payload/' + 'abcdef'.repeat(900) + '.bin\n50 MiB hook declined';
    await evaluate(message => {
        openSnapshotPublishProgress(null, message);
        renderSnapshotProgress({ status: 'failed', stage: '失败', progress: 86, entries: [{ at: new Date().toISOString(), message }], commandLogs: [{ at: new Date().toISOString(), cmd: 'git push origin HEAD:refs/heads/master', output: message, failed: true, durationMs: 101000 }] });
    }, longError);
    for (const [width, height, theme] of [[1440, 1000, 'light'], [390, 844, 'light'], [390, 844, 'dark']]) {
        nativeTheme.themeSource = theme; win.setSize(width, height);
        await new Promise(resolve => setTimeout(resolve, 120));
        const sizes = await evaluate(() => [...document.querySelectorAll('.snapshot-progress-dialog,.snapshot-progress-entry,.snapshot-progress-terminal,.snapshot-terminal-out,.snapshot-failure-content')].map(el => ({ name: el.className, width: el.clientWidth, scroll: el.scrollWidth })));
        for (const size of sizes) assert.ok(size.scroll <= size.width + 1, JSON.stringify({ width, theme, ...size }));
        if (width === 1440) assert.ok(sizes[0].width > 1000, 'desktop dialog should be wide');
        fs.writeFileSync(`/tmp/snapshot-progress-${width}-${theme}.png`, (await win.webContents.capturePage()).toPNG());
    }
    console.log('Select all excludes large tools; disabled/pending states and wide/mobile/dark long-log wrapping passed');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    if (win) win.destroy(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
