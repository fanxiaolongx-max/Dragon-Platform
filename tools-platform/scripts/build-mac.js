const path = require('path');
const { spawnSync } = require('child_process');

function buildArguments(argv, env, arch = process.arch, now = new Date()) {
    const local = argv.includes('--local');
    const allowed = new Set(['--local', '--arm64', '--x64']);
    if (argv.some(arg => !allowed.has(arg))) {
        throw new Error('Supported options: --local, --arm64, --x64');
    }
    const hasCredentials = Boolean(env.APPLE_KEYCHAIN_PROFILE
        || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
        || (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER));
    if (!local && !hasCredentials) {
        throw new Error('Release builds require Apple notarization credentials. Set APPLE_KEYCHAIN_PROFILE, or use build:mac:local for a signed local test only.');
    }
    const architectures = argv.filter(arg => arg === '--arm64' || arg === '--x64');
    if (architectures.length === 0) architectures.push(...(local ? [`--${arch}`] : ['--x64', '--arm64']));
    // Explicit targets prevent per-target arch arrays in package.json from overriding --arm64/--x64.
    const args = ['--mac', 'dmg', 'zip', ...architectures, '--publish', 'never'];
    // electron-builder 24 does not read APPLE_TEAM_ID itself.
    if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
        args.push(`--config.mac.notarize.teamId=${env.APPLE_TEAM_ID}`);
    }
    if (local) {
        const timestamp = now.toISOString().replace(/[:.]/g, '-');
        args.push(`--config.directories.output=dist/mac-local-${timestamp}`);
        // A local test may be signed without notarization, but must never be mistaken for a release.
        if (!hasCredentials) args.push('--config.mac.notarize=false');
    }
    return { args, local, hasCredentials };
}

function main() {
    if (process.platform !== 'darwin') throw new Error('Build macOS packages on macOS.');
    const { args, local, hasCredentials } = buildArguments(process.argv.slice(2), process.env);
    if (local && !hasCredentials) {
        console.log('[mac] Signed local test only; Apple notarization is not configured. Do not distribute this package.');
    }
    const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...args], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, USE_HARD_LINKS: 'false' },
        stdio: 'inherit'
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
}

if (require.main === module) {
    try { main(); } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { buildArguments };
