const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const { planBundles, writePlans } = require('../scripts/sync-builtin-hosted-apps');

const project = path.resolve(__dirname, '..');
function write(root, file, content) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

async function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-bundle-sync-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sourceDir = path.join(root, 'tools-platform/backend/builtin-tools');
    const appsDir = path.join(root, 'tools-platform/backend/data/hosted-apps');
    const code = path.join(appsDir, 'kit/app');
    const initial = {
        'requirements.txt': 'uvicorn\n',
        'app/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
        'app/db.py': 'old parser',
        'static/removed.js': 'old',
        'db/init.sqlite.sql': 'CREATE TABLE IF NOT EXISTS notes(id INTEGER);',
        'wheels/example.whl': 'offline dependency'
    };
    const zip = new JSZip();
    for (const [name, value] of Object.entries(initial)) {
        zip.file(`Kit/${name}`, value);
        write(code, name, value);
    }
    const bundle = path.join(sourceDir, 'kit/hosted-app.zip');
    fs.mkdirSync(path.dirname(bundle), { recursive: true });
    fs.writeFileSync(bundle, await zip.generateAsync({ type: 'nodebuffer' }));
    return { root, sourceDir, appsDir, code, bundle, options: { sourceDir, appsDir, slugs: ['kit'] } };
}

test('current code additions, edits and deletions sync; runtime data is excluded and repeat runs preserve ZIP bytes', async t => {
    const f = await fixture(t);
    assert.deepEqual(await planBundles(f.options), []);
    write(f.code, 'app/db.py', 'new data.rows parser');
    write(f.code, 'static/new.js', 'new');
    write(f.code, '.env.example', 'PORT=5600');
    fs.unlinkSync(path.join(f.code, 'static/removed.js'));
    const privateFiles = ['.env', '.env.production', 'app/.env.local', '.git/config', '.venv/python',
        '__pycache__/main.pyc', '_platform_host.py', 'data/app.db', 'data/app.db-wal',
        'home/settings.json', 'uploads/a.csv', 'logs/app.log', 'app/private.key', 'tls.pem',
        'credentials.json', 'secrets/values.json', 'other.sqlite3-shm'];
    for (const name of privateFiles) write(f.code, name, 'private fixture');
    const plans = await planBundles(f.options);
    assert.equal(plans.length, 1);
    writePlans(plans);
    const bytes = fs.readFileSync(f.bundle);
    const zip = await JSZip.loadAsync(bytes);
    assert.equal(await zip.file('Kit/app/db.py').async('string'), 'new data.rows parser');
    assert.ok(zip.file('Kit/static/new.js'));
    assert.equal(zip.file('Kit/static/removed.js'), null);
    assert.ok(zip.file('Kit/db/init.sqlite.sql'));
    assert.ok(zip.file('Kit/wheels/example.whl'));
    assert.ok(zip.file('Kit/.env.example'));
    for (const name of privateFiles) assert.equal(zip.file(`Kit/${name}`), null, name);
    assert.deepEqual(await planBundles(f.options), []);
    assert.ok(fs.readFileSync(f.bundle).equals(bytes));
    assert.equal(fs.readFileSync(path.join(f.code, 'data/app.db'), 'utf8'), 'private fixture');
    fs.rmSync(f.code, { recursive: true });
    assert.deepEqual(await planBundles(f.options), [], 'uninstalled apps leave the bundle intact');
});

test('invalid edits and symlinks fail before replacing the published ZIP', async t => {
    const f = await fixture(t);
    const before = fs.readFileSync(f.bundle);
    fs.symlinkSync(f.bundle, path.join(f.code, 'linked.zip'));
    await assert.rejects(planBundles(f.options), /符号链接/);
    fs.unlinkSync(path.join(f.code, 'linked.zip'));
    fs.unlinkSync(path.join(f.code, 'requirements.txt'));
    await assert.rejects(planBundles(f.options), /Python Web 应用/);
    assert.ok(fs.readFileSync(f.bundle).equals(before));
});

test('Git hooks require local opt-in, stage only bundles on commit, and reject unsynced or uncommitted bundles on push', async t => {
    const f = await fixture(t);
    const tempProject = path.join(f.root, 'tools-platform');
    fs.cpSync(path.join(project, 'scripts/sync-builtin-hosted-apps.js'), path.join(tempProject, 'scripts/sync-builtin-hosted-apps.js'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, 'backend/models/hosted-apps'), { recursive: true });
    fs.copyFileSync(path.join(project, 'backend/models/hosted-apps/package.js'), path.join(tempProject, 'backend/models/hosted-apps/package.js'));
    fs.symlinkSync(path.join(project, 'node_modules'), path.join(tempProject, 'node_modules'), 'dir');
    for (const hook of ['pre-commit', 'pre-push']) {
        write(f.root, `.githooks/${hook}`, fs.readFileSync(path.join(project, '../.githooks', hook)));
        fs.chmodSync(path.join(f.root, '.githooks', hook), 0o755);
    }
    write(f.root, '.gitignore', 'tools-platform/backend/data/\ntools-platform/node_modules/\n');
    write(f.root, 'unrelated.txt', 'first');
    const git = (...args) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    git('add', '.');
    git('commit', '-qm', 'initial');
    const cli = (...args) => spawnSync(process.execPath, ['scripts/sync-builtin-hosted-apps.js', ...args], { cwd: tempProject, encoding: 'utf8' });
    write(f.code, 'app/db.py', 'current code');
    const initial = fs.readFileSync(f.bundle);
    assert.equal(cli('--hook').status, 0);
    assert.ok(fs.readFileSync(f.bundle).equals(initial), 'no local flag means no write');
    assert.equal(cli('--enable').status, 0);
    assert.equal(cli('--hook', '--check').status, 1, 'push rejects code newer than bundle');
    assert.equal(cli('--check').status, 1);
    assert.ok(fs.readFileSync(f.bundle).equals(initial), 'check is read-only');
    assert.equal(cli().status, 0, 'manual sync');
    assert.equal(cli('--hook', '--check').status, 1, 'push rejects already generated but uncommitted ZIP');
    write(f.root, 'unrelated.txt', 'unstaged work');
    write(f.root, 'selected.txt', 'commit this');
    git('add', 'selected.txt');
    git('commit', '-qm', 'sync code');
    assert.match(git('show', '--name-only', '--format='), /hosted-app\.zip/);
    assert.match(git('show', '--name-only', '--format='), /selected\.txt/);
    assert.equal(git('diff', '--name-only'), 'unrelated.txt');
    assert.equal(cli('--hook', '--check').status, 0);
    assert.equal(cli('--disable').status, 0);
    write(f.code, 'app/db.py', 'later code');
    const beforeDisabled = fs.readFileSync(f.bundle);
    assert.equal(cli('--hook').status, 0);
    assert.ok(fs.readFileSync(f.bundle).equals(beforeDisabled));
    assert.equal(git('config', 'core.hooksPath'), '.githooks', 'other hooks stay enabled');
});
