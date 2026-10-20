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
    fs.writeFileSync(html, '<!doctype html><link rel="stylesheet" href="' + path.join(__dirname, '../frontend/css/shared.css') + '"><body><div class="nav-settings-window" style="display:block;width:auto;height:auto"><div class="snapshot-security"><div id="tools" class="snapshot-tools-list"></div></div></div>');
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadFile(html);
    await win.webContents.executeJavaScript(`const snapshotText=zh=>zh; const navEscape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); const navState={};const getAuthHeaderForNav=()=>({}); const SNAPSHOT_API='';let snapshotProgressTimer=null,snapshotProgressJobId='';\n${code}\nvoid 0;`);
    await evaluate(() => {
        document.getElementById('tools').innerHTML = ['small', 'large'].map(slug => `<div class="snapshot-tool-item" data-tool-slug="${slug}" data-requested-enabled="1"><div class="snapshot-tool-row"><label class="snapshot-tool-enable"><input id="snapshotToolEnabled_${slug}" type="checkbox"><strong>${slug === 'large' ? '负向事件管理' : '奖励申报与评优'}</strong><small class="snapshot-tool-slug">${slug}</small></label><span id="snapshotToolSize_${slug}"></span></div><div id="snapshotToolWarning_${slug}"></div></div>`).join('');
        for (const slug of ['small', 'large']) {
            const item = document.querySelector(`[data-tool-slug="${slug}"]`);
            markSnapshotEstimatePending(item);
            item.dataset.requestedEnabled = '1';
            applyToolEstimateResult(slug, { fileCount: slug === 'large' ? 100 : 2, totalSizeFormatted: '1 MiB', isHeavy: slug === 'large', warningLevel: 'normal', supported: true }, document.getElementById('snapshotToolSize_' + slug), item, document.getElementById('snapshotToolWarning_' + slug));
        }
        toggleAllSnapshotTools(false); toggleAllSnapshotTools(true);
    });
    assert.deepEqual(await evaluate(() => ['small', 'large'].map(slug => { const c = document.getElementById('snapshotToolEnabled_' + slug); return [c.checked, c.disabled]; })), [[true, false], [false, true]]);
    // System dark mode must not mix a dark warning card with the light settings panel.
    for (const [width, height, theme] of [[1440, 1000, 'light'], [1440, 1000, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
        nativeTheme.themeSource = theme; win.setSize(width, height);
        await new Promise(resolve => setTimeout(resolve, 120));
        const results = await evaluate(() => {
            const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
            const luminance = color => rgb(color).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            const contrast = (foreground, background) => { const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
            return [...document.querySelectorAll('.snapshot-tool-item')].map(item => {
                const style = getComputedStyle(item);
                const backgrounds = style.backgroundImage.match(/rgb\([^)]+\)/g) || [style.backgroundColor];
                const name = getComputedStyle(item.querySelector('strong'));
                const slug = getComputedStyle(item.querySelector('.snapshot-tool-slug'));
                const badge = getComputedStyle(item.querySelector('.snapshot-tool-size-badge'));
                const warning = getComputedStyle(item.querySelector('.snapshot-tool-warning-row'));
                return {
                    slug: item.dataset.toolSlug,
                    nameContrast: Math.min(...backgrounds.map(bg => contrast(name.color, bg))),
                    slugContrast: contrast(slug.color, slug.backgroundColor),
                    badgeContrast: contrast(badge.color, badge.backgroundColor),
                    warningContrast: warning.display === 'none' ? 21 : contrast(warning.color, warning.backgroundColor),
                    width: item.clientWidth, scroll: item.scrollWidth,
                    colorScheme: style.colorScheme
                };
            });
        });
        for (const result of results) {
            for (const key of ['nameContrast', 'slugContrast', 'badgeContrast', 'warningContrast']) assert.ok(result[key] >= 4.5, JSON.stringify({ theme, width, key, ...result }));
            assert.equal(result.colorScheme, 'light');
            assert.ok(result.scroll <= result.width + 1, JSON.stringify({ theme, width, ...result }));
        }
        fs.writeFileSync(`/tmp/snapshot-tools-${width}-${theme}.png`, (await win.webContents.capturePage()).toPNG());
    }
    console.log('Tool names, identifiers, size badges and heavy warnings pass 4.5:1 contrast in light/dark system modes at desktop/mobile widths');
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
