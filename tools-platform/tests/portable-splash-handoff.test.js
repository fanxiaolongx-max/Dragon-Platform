const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { patchPortableScript, resolveTemplatePath, MARKER, REUSE_MARKER } = require('../scripts/patch-portable-nsis');

const root = path.join(__dirname, '..');
const UPSTREAM_TAIL = [
    'Function .onGUIInit',
    '  !ifdef SPLASH_IMAGE',
    '    BgImage::SetBg $PLUGINSDIR\\splash.bmp',
    '    BgImage::Redraw',
    '  !endif',
    'FunctionEnd',
    'Section',
    '  StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"',
    '  RMDir /r $INSTDIR',
    '  SetOutPath $INSTDIR',
    '  System::Call \'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0\'',
    '  ${StdUtils.GetAllParameters} $R0 0',
    '',
    '  !ifdef SPLASH_IMAGE',
    '    BgImage::Destroy',
    '  !endif',
    '',
    '\tExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0',
    '  SetErrorLevel $0',
    '',
    '  SetOutPath $EXEDIR'
].join('\n');

test('portable NSIS patch keeps the splash up until the startup window signals handoff', () => {
    const { changed, source } = patchPortableScript(UPSTREAM_TAIL);
    assert.equal(changed, true);
    assert.ok(source.includes(MARKER));
    const destroyAt = source.indexOf('BgImage::Destroy', source.indexOf(MARKER));
    assert.ok(source.indexOf('ExecShellWaitEx') < destroyAt, 'app is launched before the splash is destroyed');
    assert.ok(source.indexOf('.startup-window-visible') < destroyAt, 'splash waits for the handoff marker');
    assert.match(source, /WaitForSingleObject\(p r2, i 40\)/, 'loop also stops when the app exits');
    assert.match(source, /\$3 >= 500/, 'loop has a timeout');
    assert.match(source, /StdUtils\.WaitForProcEx\} \$0 \$2[\s\S]*SetErrorLevel \$0/, 'exit code is still propagated');
    assert.ok(source.includes('SetOutPath $EXEDIR'), 'cleanup after the app exits is untouched');
    assert.deepEqual(patchPortableScript(source), { changed: false, source }, 'patch is idempotent');
});

test('portable NSIS patch reuses a running copy of the same build instead of failing to overwrite it', () => {
    const { source } = patchPortableScript(UPSTREAM_TAIL);
    const reuseAt = source.indexOf(REUSE_MARKER);
    assert.ok(reuseAt >= 0);
    const block = source.slice(reuseAt, source.indexOf('SetOutPath $INSTDIR', reuseAt));
    assert.match(block, /FileOpen \$9 "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" a/, 'probes whether the extracted exe is in use');
    assert.match(block, /\$\{If\} \$\{Errors\}[\s\S]*Exec '"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" \$R0'[\s\S]*Quit/, 'in use: launch it so the single-instance lock focuses the window');
    assert.ok(block.indexOf('Exec ') < block.indexOf('RMDir /r $INSTDIR'), 'a running copy is never deleted');
    assert.match(block, /PORTABLE_EXECUTABLE_FILE/, 'the relaunched exe still knows it is portable');
    assert.match(block, /RMDir \/r \$INSTDIR\n  \$\{If\} \$\{FileExists\} "\$INSTDIR\\\*\.\*"[\s\S]*StrCpy \$INSTDIR "\$INSTDIR-\$9"/, 'leftover locked files: extract to a fresh folder');
    assert.equal((source.match(/SetOutPath \$INSTDIR/g) || []).length, 1);
});

test('the app forwards a second launch to the running window', () => {
    const main = fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8');
    assert.match(main, /requestSingleInstanceLock\(\)/);
    assert.match(main, /app\.on\('second-instance'/);
});

test('portable NSIS patch fails loudly on an unexpected template', () => {
    assert.throws(() => patchPortableScript('Section\nSectionEnd\n'), /portable\.nsi/);
});

test('installed electron-builder portable template is patchable', () => {
    const template = fs.readFileSync(resolveTemplatePath(), 'utf8');
    assert.doesNotThrow(() => patchPortableScript(template));
});

test('portable build scripts apply the handoff patch before electron-builder runs', () => {
    const { scripts } = require('../package.json');
    for (const name of ['build:win:portable', 'build:win:publish']) {
        const script = scripts[name];
        const patchAt = script.indexOf('node scripts/patch-portable-nsis.js');
        assert.ok(patchAt >= 0, `${name} applies the patch`);
        assert.ok(patchAt < script.indexOf('electron-builder --win portable'), `${name} patches before building portable`);
    }
});

test('stage-2 startup window matches the stage-1 splash and writes the handoff marker', () => {
    const main = fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8');
    assert.match(main, /STARTUP_WINDOW_SIZE = \{ width: 620, height: 340 \}/);
    assert.match(main, /STARTUP_HANDOFF_MARKER = '\.startup-window-visible'/);
    assert.match(main, /once\('show', \(\) => setTimeout\(signalSplashHandoff/);
    const bmp = fs.readFileSync(path.join(root, 'frontend/assets/portable-splash.bmp'));
    assert.equal(bmp.readInt32LE(18), 620);
    assert.equal(bmp.readInt32LE(22), 340);
    const page = fs.readFileSync(path.join(root, 'frontend/pages/startup.html'), 'utf8');
    assert.ok(page.includes('Dragon Claw'));
    assert.match(page, /body:not\(\.is-live\)[^{]*\{ animation-play-state: paused/, 'first frame stays frozen until handoff');
    const generator = fs.readFileSync(path.join(root, 'scripts/generate-portable-splash.js'), 'utf8');
    assert.match(generator, /startup\.html'\), \{ query: \{ snapshot: '1' \} \}/, 'splash BMP is the startup page snapshot');
});

 test('stage-1 splash is topmost, process-scoped, and upgrades already-patched templates', () => {
    const { source } = patchPortableScript(UPSTREAM_TAIL);
    assert.match(source, /SetWindowPos\(p \$HWNDPARENT, p -1/);
    assert.match(source, /FindWindowEx.*NSISBGImage/);
    assert.match(source, /GetWindowThreadProcessId/);
    assert.match(source, /\$R9 == \$R7/);
    assert.match(source, /SetWindowPos\(p R8, p -1/);
    const handoffOnly = source.replace(/    ; dragon-platform: topmost splash[\s\S]*?    Pop \$R7\n/, '');
    const upgraded = patchPortableScript(handoffOnly);
    assert.equal(upgraded.changed, true);
    assert.equal(upgraded.source, source);
    assert.equal(patchPortableScript(source).changed, false);
});
