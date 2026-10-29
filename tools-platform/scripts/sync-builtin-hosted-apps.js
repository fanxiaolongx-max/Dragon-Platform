#!/usr/bin/env node
// 本机开发用：从当前应用代码生成内置包，不读取原始上传包，不改运行数据。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');
const { inspectArchive } = require('../backend/models/hosted-apps/package');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOCAL_FLAG = 'toolsPlatform.syncHostedBundles';
const IGNORED_DIRS = new Set([
    '.git', '.venv', 'venv', 'env', '__pycache__', 'node_modules', '.idea', '.vscode',
    '.pytest_cache', '.mypy_cache', '.ruff_cache', 'logs', 'secrets', 'credentials'
]);
const RUNTIME_DIRS = new Set(['data', 'home', 'uploads', 'backups', 'tmp']);

function excluded(relative) {
    const parts = relative.split('/');
    const name = parts.at(-1).toLowerCase();
    return parts.some(part => IGNORED_DIRS.has(part.toLowerCase()))
        || RUNTIME_DIRS.has(parts[0].toLowerCase())
        || parts.some(part => part === '__MACOSX' || part.startsWith('._'))
        || name === '.ds_store' || name === 'thumbs.db' || name === '_platform_host.py'
        || (/^\.env(?:\.|$)/i.test(name) && name !== '.env.example')
        || /\.(?:py[co]|log|db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(name)
        || /\.(?:pem|key|p12|pfx)$/i.test(name)
        || /^(?:secrets?|credentials?|tokens?)(?:\.|$)/i.test(name);
}

function sourceFiles(codeDir, relative = '', files = new Map()) {
    for (const entry of fs.readdirSync(path.join(codeDir, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (excluded(name)) continue;
        if (entry.isSymbolicLink()) throw new Error(`拒绝打包符号链接：${name}`);
        if (entry.isDirectory()) sourceFiles(codeDir, name, files);
        else if (entry.isFile()) files.set(name, fs.readFileSync(path.join(codeDir, name)));
    }
    return files;
}

async function planBundle(bundle, codeDir) {
    const original = fs.readFileSync(bundle);
    const inspected = await inspectArchive(original);
    const prefix = inspected.root ? `${inspected.root}/` : '';
    const files = sourceFiles(codeDir);
    const oldZip = await JSZip.loadAsync(original);
    const oldFiles = Object.values(oldZip.files).filter(entry => !entry.dir);
    let unchanged = oldFiles.length === files.size;
    for (const [name, content] of files) {
        const old = oldZip.file(prefix + name);
        if (!old || !(await old.async('nodebuffer')).equals(content)) unchanged = false;
    }
    if (unchanged) return null;
    const zip = new JSZip();
    for (const [name, content] of files) {
        zip.file(prefix + name, content, { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await inspectArchive(buffer); // 删除入口或依赖声明等不完整修改不得进入发布包。
    return { bundle, buffer, fileCount: files.size };
}

async function planBundles({ sourceDir, appsDir, slugs }) {
    const plans = [];
    for (const slug of slugs) {
        if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error(`非法应用标识：${slug}`);
        const bundle = path.join(sourceDir, slug, 'hosted-app.zip');
        const codeDir = path.join(appsDir, slug, 'app');
        if (!fs.existsSync(codeDir)) continue; // 此机器未安装的应用保持原包。
        if (fs.lstatSync(codeDir).isSymbolicLink()) throw new Error(`应用目录不能是符号链接：${slug}`);
        const plan = await planBundle(bundle, codeDir);
        if (plan) plans.push({ ...plan, slug });
    }
    return plans;
}

function writePlans(plans) {
    for (const { bundle, buffer } of plans) {
        const temporary = `${bundle}.${process.pid}.tmp`;
        try {
            fs.writeFileSync(temporary, buffer);
            fs.renameSync(temporary, bundle);
        } finally {
            fs.rmSync(temporary, { force: true });
        }
    }
}

function git(args, cwd = PROJECT_ROOT) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function locallyEnabled() {
    try { return git(['config', '--local', '--bool', '--get', LOCAL_FLAG]) === 'true'; }
    catch (_) { return false; }
}

async function main(args = process.argv.slice(2)) {
    const allowed = new Set(['--enable', '--disable', '--hook', '--check']);
    if (args.some(arg => !allowed.has(arg))) throw new Error('支持参数：--enable / --disable / --check / --hook');
    if (args.includes('--enable')) {
        const root = git(['rev-parse', '--show-toplevel']);
        let hooksPath;
        try { hooksPath = git(['config', '--get', 'core.hooksPath']); } catch (_) { /* 尚未启用仓库钩子 */ }
        if (hooksPath && path.resolve(root, hooksPath) !== path.join(root, '.githooks')) {
            throw new Error('当前使用其他 Git hooksPath，请先将内置包同步命令接入现有钩子。');
        }
        for (const hook of ['pre-commit', 'pre-push']) {
            if (!fs.readFileSync(path.join(root, '.githooks', hook), 'utf8').includes('sync-builtin-hosted-apps.js')) {
                throw new Error(`缺少内置包同步钩子：${hook}`);
            }
        }
        git(['config', '--local', 'core.hooksPath', '.githooks']);
        git(['config', '--local', LOCAL_FLAG, 'true']);
        console.log('[hosted-bundles] 已仅在本机启用：提交前打包并暂存，推送前检查。');
        return;
    }
    if (args.includes('--disable')) {
        git(['config', '--local', LOCAL_FLAG, 'false']);
        console.log('[hosted-bundles] 已关闭本机自动同步，其他 Git 钩子保持生效。');
        return;
    }
    const hook = args.includes('--hook');
    if (hook && !locallyEnabled()) return;
    const paths = git(['ls-files', '-z', '--', 'backend/builtin-tools/*/hosted-app.zip']).split('\0').filter(Boolean);
    const plans = await planBundles({
        sourceDir: path.join(PROJECT_ROOT, 'backend/builtin-tools'),
        appsDir: path.join(PROJECT_ROOT, 'backend/data/hosted-apps'),
        slugs: paths.map(file => path.posix.basename(path.posix.dirname(file)))
    });
    if (args.includes('--check')) {
        if (plans.length) throw new Error(`内置包尚未同步：${plans.map(plan => plan.slug).join('、')}。请执行 npm run hosted:sync，再提交 ZIP 后推送。`);
        // pre-push 时文件已打包但未进入提交，也必须阻止遗漏发布。
        if (hook && paths.length) {
            const dirty = git(['status', '--porcelain', '--', ...paths]);
            if (dirty) throw new Error('内置 ZIP 尚未提交，请先提交后再推送。');
        }
        console.log('[hosted-bundles] 检查通过。');
        return;
    }
    writePlans(plans);
    if (hook && paths.length) {
        // 包括用户手动同步过的包；不暂存任何其他文件。
        git(['add', '--', ...paths]);
    }
    for (const plan of plans) console.log(`[hosted-bundles] 已同步 ${plan.slug}（${plan.fileCount} 个文件）${hook ? '，已加入暂存区' : ''}`);
    if (!plans.length) console.log('[hosted-bundles] 内置包已是最新。');
}

if (require.main === module) main().catch(error => {
    console.error(`[hosted-bundles] ${error.message}`);
    process.exitCode = 1;
});

module.exports = { excluded, planBundles, writePlans, main };
