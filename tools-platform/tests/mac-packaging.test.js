const test = require('node:test');
const assert = require('node:assert/strict');
const picomatch = require('picomatch');
const { buildArguments } = require('../scripts/build-mac');
const { build } = require('../package.json');

test('desktop packages exclude local data and credentials while keeping shipped tools', () => {
    const excluded = picomatch(build.files.filter(p => p.startsWith('!')).map(p => p.slice(1)), { dot: true });
    for (const file of [
        'backend/data/tenants/example/tools.db', 'backend/data/custom-tools/user-tool/index.html',
        'backend/backups/tenant.zip', 'backend/factory-reset-archives/archive/report.json',
        'backend/logs/runtime.txt', 'backend/tmp/upload.xlsx', 'backend/runtime/state.json',
        'backend/node_modules/sqlite3/build/Release/node_sqlite3.node',
        'frontend/assets/videos/local.mov', 'backend/.env.production', 'backend/private.p12',
        'backend/models/desktop-license-authority.js',
        'backend/builtin-tools/tool-mtakhxqm/audio/audio.bundle.zip',
        'backend/builtin-tools/tool-mtakhxqm/audio/sound.mp3',
        'backend/builtin-tools/f12-to-extension/chrome-capture-pro/bundle.js'
    ]) assert.ok(excluded(file), `Must exclude ${file}`);
    for (const file of [
        'backend/defaults/quick-start-bundle.json',
        'backend/builtin-tools/tool-mtakhxqm/audio/manifest.json',
        'backend/builtin-tools/f12-to-extension/chrome-capture-pro.template.zip',
        'frontend/downloads/uivision-extension-9.6.1.zip',
        'frontend/desktop-license-client-config.json', 'desktop-pet/pet-manager.js',
        'desktop-pet/pet-keyboard-hook.js'
    ]) assert.equal(excluded(file), false, `Must retain ${file}`);
});

test('release requires notarization; local builds are isolated and cannot publish', () => {
    assert.throws(() => buildArguments([], {}), /notarization credentials/);
    assert.throws(() => buildArguments(['--publish=always'], {}), /Supported options/);
    const local = buildArguments(['--local'], {}, 'arm64', new Date('2026-10-04T12:00:00Z'));
    assert.ok(local.args.includes('--arm64'));
    assert.ok(local.args.includes('--config.mac.notarize=false'));
    assert.ok(local.args.includes('--config.directories.output=dist/mac-local-2026-10-04T12-00-00-000Z'));
    assert.deepEqual(local.args.slice(0, 6), ['--mac', 'dmg', 'zip', '--arm64', '--publish', 'never']);
    const release = buildArguments(['--x64'], { APPLE_KEYCHAIN_PROFILE: 'test-profile' });
    assert.deepEqual(release.args, ['--mac', 'dmg', 'zip', '--x64', '--publish', 'never']);
    assert.deepEqual(buildArguments([], { APPLE_KEYCHAIN_PROFILE: 'test-profile' }).args,
        ['--mac', 'dmg', 'zip', '--x64', '--arm64', '--publish', 'never']);
    const appleId = buildArguments([], {
        APPLE_ID: 'test@example.invalid', APPLE_APP_SPECIFIC_PASSWORD: 'test-only', APPLE_TEAM_ID: 'TESTTEAM'
    });
    assert.ok(appleId.args.includes('--config.mac.notarize.teamId=TESTTEAM'));
    assert.equal(appleId.args.some(arg => arg.includes('test-only')), false);
    assert.equal(build.mac.forceCodeSigning, true);
    assert.equal(build.mac.notarize, true);
    assert.ok(build.mac.target.some(target => target.target === 'zip'));
});
