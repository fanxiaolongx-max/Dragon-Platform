const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(require('node:path').join(__dirname, '../electron-main.js'), 'utf8');
const names = new Set(['prepareLaunchExperience', 'setupAutoUpdater', 'scheduleStartupUpdateCheck', 'registerUpdaterIpcHandlers']);
const functions = acorn.parse(source, { ecmaVersion: 'latest' }).body.filter(n => n.type === 'FunctionDeclaration' && names.has(n.id.name)).map(n => source.slice(n.start, n.end)).join('\n');
function fixture(state = {}) {
    let saved = state;
    const events = {}, handlers = {};
    const ctx = { Date, setTimeout: fn => fn(), app: { getVersion: () => '2.0.0', isPackaged: true },
        readLaunchState: () => saved, writeLaunchState: value => { saved = value; },
        autoUpdater: { on: (name, fn) => events[name] = fn, checkForUpdates: async () => { ctx.checks++; } },
        checks: 0, isPortableWindows: false, updateStatus: {}, ipcMain: { handle: (name, fn) => handlers[name] = fn },
        broadcastUpdateStatus: patch => ctx.updateStatus = { ...ctx.updateStatus, ...patch },
        stopUpdateProgressBalloons() {}, startUpdateProgressBalloons() {}, formatUpdaterError: e => ({ message: e.message }) };
    vm.createContext(ctx); vm.runInContext(functions, ctx);
    return { ctx, events, handlers, saved: () => saved };
}
test('upgrade quiet period persists across restarts without being extended', () => {
    const { ctx, events, saved } = fixture({ lastSeenVersion: '1.0.0' });
    assert.equal(ctx.prepareLaunchExperience().kind, 'updated');
    const timestamp = saved().lastUpgradeAt; assert.ok(Date.parse(timestamp));
    assert.equal(ctx.prepareLaunchExperience().kind, 'normal');
    assert.equal(saved().lastUpgradeAt, timestamp);
    ctx.setupAutoUpdater(); events['update-available']({ version: '2.0.1', releaseNotes: 'Actual release notes' });
    assert.equal(ctx.updateStatus.suppressPrompt, true);
    assert.equal(ctx.updateStatus.releaseNotes, 'Actual release notes');
});
test('old upgrades and first launches allow reminders; each packaged startup still checks', async () => {
    for (const state of [{}, { lastUpgradeAt: new Date(Date.now() - 25 * 3600000).toISOString() }]) {
        const { ctx, events } = fixture(state); ctx.setupAutoUpdater();
        events['update-available']({ version: '2.0.1' }); assert.equal(ctx.updateStatus.suppressPrompt, false);
        ctx.scheduleStartupUpdateCheck(); assert.equal(ctx.checks, 1);
    }
});
test('manual checks preserve active download and install states', async () => {
    const { ctx, handlers } = fixture(); ctx.registerUpdaterIpcHandlers();
    for (const state of ['checking', 'downloading', 'downloaded', 'installing']) {
        ctx.updateStatus = { state }; assert.equal((await handlers['updater:check']()).state, state);
    }
    assert.equal(ctx.checks, 0);
    ctx.updateStatus = { state: 'available', suppressPrompt: true };
    await handlers['updater:check'](); assert.equal(ctx.checks, 1);
});

test('portable desktop checks on startup and manually through its own updater, never electron-updater', async () => {
    // electron-builder writes app-update.yml only for NSIS, so autoUpdater cannot run in the portable build.
    const { ctx, handlers } = fixture(); ctx.isPortableWindows = true;
    const steps = []; ctx.runPortableUpdaterStep = async step => { steps.push(step); return ctx.updateStatus; };
    ctx.scheduleStartupUpdateCheck();
    ctx.registerUpdaterIpcHandlers(); await handlers['updater:check']();
    await handlers['updater:download']();
    assert.deepEqual(steps, ['check', 'check', 'download']);
    assert.equal(ctx.checks, 0, 'autoUpdater is not used by the portable build');
});
