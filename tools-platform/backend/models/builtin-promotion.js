// 「转为内置 / 取消内置」：把当前租户的自定义内容写进受版本控制的项目源码目录（提交 Git 后随项目自带），或从中移回。
// - tool   自定义 HTML 工具  ⇄ backend/builtin-tools/<slug>/（沿用 builtin-tools-sync 的受管安装，启动时其它租户自动安装）
// - skill  自定义 Skill      ⇄ backend/agent-skills/<id>/SKILL.md
// - f12    F12 服务器脚本    ⇄ backend/builtin-scripts/f12/<id>.json（bundled-scripts.js 补种）
// - python Python 脚本       ⇄ backend/builtin-scripts/python/<id>.json
// 取消内置时源码目录先备份到当前租户 data/backups/builtin-demoted/，当前租户保留为自定义内容。
// 打包后的桌面版（源码在 app.asar 内）或目录不可写时拒绝操作。
const fs = require('fs');
const path = require('path');
const { getDataDir, BASE_DATA_DIR, TENANTS_ROOT } = require('./tenant-context');
const customTools = require('./custom-tools-repository');
const toolSync = require('./builtin-tools-sync');
const builtinSkills = require('./agent-skills');
const skillStore = require('./agent-skills-store');
const bundled = require('./bundled-scripts');
const f12Presets = require('./f12-script-presets-repository');
const pythonScripts = require('./python-script-repository');

const KINDS = ['tool', 'skill', 'f12', 'python'];
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
// 平台功能依赖的内置工具（首页插件目录、深链接），不允许取消内置
const LOCKED_TOOLS = new Set(['f12-to-extension', 'python-updater']);

function httpError(message, statusCode = 400, code = 'BUILTIN_PROMOTION_INVALID') {
    return Object.assign(new Error(message), { statusCode, code });
}

function sourceDirOf(kind) {
    if (kind === 'tool') return customTools.BUILTIN_TOOLS_DIR;
    if (kind === 'skill') return builtinSkills.SKILLS_DIR;
    return bundled.DIRS[kind];
}

/** 源码目录是否可写（打包后的桌面版只读） */
function writable(kind) {
    const dir = path.resolve(sourceDirOf(kind));
    if (/\.asar(?:[\\/]|$)/i.test(dir)) return false;
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function assertWritable(kind) {
    if (!writable(kind)) throw httpError('当前运行环境的项目源码目录不可写（例如打包后的桌面版），请在项目源码目录运行的服务上操作', 409, 'BUILTIN_SOURCE_READONLY');
}

function status() {
    return { writable: KINDS.every(writable), kinds: Object.fromEntries(KINDS.map(kind => [kind, writable(kind)])), lockedTools: [...LOCKED_TOOLS] };
}

// 提示用的路径：项目内显示相对路径（便于对照 git status），项目外显示绝对路径
function displayPath(target) {
    const relative = path.relative(path.join(__dirname, '../..'), target);
    return relative.startsWith('..') || path.isAbsolute(relative) ? target : relative;
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupSource(kind, id, sourcePath) {
    const target = path.join(getDataDir(), 'backups', 'builtin-demoted', `${kind}-${id}-${timestamp()}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(sourcePath, fs.statSync(sourcePath).isDirectory() ? target : path.join(target, path.basename(sourcePath)), { recursive: true });
    return target;
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, filePath);
}

// ── HTML 工具 ──────────────────────────────
function syncPaths() {
    const dataDir = getDataDir();
    return {
        targetDir: customTools.getCustomToolsDir(),
        stateFile: path.join(dataDir, 'builtin-tools-sync-decisions.json'),
        backupRoot: path.join(dataDir, 'backups/builtin-tools')
    };
}

async function promoteTool(slug) {
    if (!SLUG_RE.test(slug)) throw httpError('无效的工具标识');
    const builtinDir = path.join(customTools.BUILTIN_TOOLS_DIR, slug);
    if (fs.existsSync(builtinDir)) throw httpError('该工具已经是内置工具', 409, 'ALREADY_BUILTIN');
    const tool = await customTools.getTool(slug);
    const runtimeDir = path.join(customTools.getCustomToolsDir(), slug);
    if (!tool || !fs.existsSync(path.join(runtimeDir, 'index.html'))) throw httpError('工具不存在或缺少 index.html', 404, 'TOOL_NOT_FOUND');
    assertWritable('tool');
    const staging = path.join(customTools.BUILTIN_TOOLS_DIR, `.promote-${slug}-${process.pid}.tmp`);
    const hostedRuntime = require('./hosted-apps/runtime');
    const hostedService = require('./hosted-apps/service');
    let hostedBundle = null;
    fs.rmSync(staging, { recursive: true, force: true });
    try {
        fs.cpSync(runtimeDir, staging, { recursive: true, filter: source => !/(^|[\\/])\.DS_Store$/.test(source) });
        // 托管 Python 应用：工具目录只有启动页，应用包另存为 hosted-app.zip 随源码发布（剔除 .env）
        if (hostedRuntime.exists(slug)) {
            const bundle = await hostedService.packageForSource(slug);
            fs.writeFileSync(path.join(staging, hostedService.BUNDLED_PACKAGE), bundle.buffer);
            hostedBundle = bundle;
        }
        const now = new Date().toISOString();
        writeJsonAtomic(path.join(staging, customTools.TOOL_MANIFEST_FILE), {
            version: 1,
            tool: {
                slug,
                name: tool.name,
                ...(tool.nameEn ? { nameEn: tool.nameEn } : {}),
                icon: tool.icon || '🧩',
                description: tool.description || '',
                ...(tool.descriptionEn ? { descriptionEn: tool.descriptionEn } : {}),
                tags: Array.isArray(tool.tags) ? tool.tags : [],
                href: tool.href || `/tools/${slug}`,
                filePath: tool.filePath || `/custom-tools/${slug}/index.html`,
                publicAccess: tool.publicAccess === true,
                createdAt: tool.createdAt || now,
                updatedAt: now
            },
            history: null
        });
        fs.renameSync(staging, builtinDir);
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
    // 当前租户的运行副本登记为「受管内置」，避免下次启动被当成差异提示
    const source = toolSync.validateBundledTool(customTools.BUILTIN_TOOLS_DIR, slug);
    const paths = syncPaths();
    const candidate = toolSync.compareBundledTool(source, paths.targetDir);
    if (candidate.status !== 'unchanged') {
        const result = toolSync.applyBuiltinToolDecisions({
            sourceDir: customTools.BUILTIN_TOOLS_DIR, ...paths, applySlugs: [slug],
            expectedFingerprints: { [slug]: candidate.fingerprint }, includePreview: false
        });
        if (result.invalid.length) throw httpError(`已写入内置目录，但登记运行副本失败：${result.invalid[0].error}`, 500);
    }
    if (hostedBundle) {
        const hash = require('crypto').createHash('sha256').update(hostedBundle.buffer).digest('hex');
        hostedRuntime.updateState(slug, { bundleHash: hash }); // 当前租户的应用即源码里的版本，不重复安装
    }
    return { kind: 'tool', id: slug, builtIn: true, path: displayPath(builtinDir),
        ...(hostedBundle ? { hostedApp: true, packageBytes: hostedBundle.buffer.length, removedFiles: hostedBundle.removed } : {}) };
}

function tenantDataDirs() {
    const dirs = [BASE_DATA_DIR];
    if (fs.existsSync(TENANTS_ROOT)) {
        fs.readdirSync(TENANTS_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory()).forEach(entry => dirs.push(path.join(TENANTS_ROOT, entry.name)));
    }
    return dirs;
}

async function demoteTool(slug) {
    if (!SLUG_RE.test(slug)) throw httpError('无效的工具标识');
    const builtinDir = path.join(customTools.BUILTIN_TOOLS_DIR, slug);
    if (!fs.existsSync(path.join(builtinDir, customTools.TOOL_MANIFEST_FILE))) throw httpError('该工具不是内置工具', 409, 'NOT_BUILTIN');
    if (LOCKED_TOOLS.has(slug)) throw httpError('该工具是平台核心内置工具（首页插件目录与深链接依赖它），不能取消内置', 409, 'BUILTIN_LOCKED');
    assertWritable('tool');
    // 当前租户还没有运行副本时先装上，取消内置后仍可使用
    const runtimeDir = path.join(customTools.getCustomToolsDir(), slug);
    const installedNow = !fs.existsSync(path.join(runtimeDir, 'index.html'));
    if (installedNow) fs.cpSync(builtinDir, runtimeDir, { recursive: true });
    const backup = backupSource('tool', slug, builtinDir);
    fs.rmSync(builtinDir, { recursive: true, force: true });
    // 各租户的受管副本去掉内置标记，变回普通自定义工具（文件与业务数据不动）
    for (const dataDir of tenantDataDirs()) {
        const manifestPath = path.join(dataDir, 'custom-tools', slug, customTools.TOOL_MANIFEST_FILE);
        let manifest = null;
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }
        if (!manifest || (manifest.builtIn !== true && !manifest.system)) continue;
        delete manifest.builtIn;
        delete manifest.system;
        writeJsonAtomic(manifestPath, manifest);
    }
    if (installedNow) await customTools.reconcileToolsFromDisk(); // 刚补装的副本按磁盘清单登记到工具列表
    return { kind: 'tool', id: slug, builtIn: false, backup };
}

// ── Skill ──────────────────────────────────
function skillMarkdown(skill) {
    const line = (key, value) => `${key}: ${String(value ?? '').replace(/\r?\n/g, ' ').trim()}`;
    return ['---', line('name', skill.name), line('name_en', skill.nameEn || skill.name), line('description', skill.description || skill.name),
        line('description_en', skill.descriptionEn || skill.description || skill.nameEn || skill.name), line('workspace', skill.workspace ? 'true' : 'false'),
        line('order', 100), line('icon', skill.icon || '✨'), '---', '', skill.body.trim(), ''].join('\n');
}

function safeRelative(file) {
    const relative = path.posix.normalize(String(file || '').replace(/\\/g, '/'));
    return relative && !relative.startsWith('../') && !path.posix.isAbsolute(relative) && relative !== '..' && relative.toLowerCase() !== 'skill.md' ? relative : '';
}

async function promoteSkill(id) {
    const skill = await skillStore.getCustom(id);
    if (!skill) throw httpError(builtinSkills.builtin(id) ? '该技能已经是内置技能' : '技能不存在', builtinSkills.builtin(id) ? 409 : 404);
    assertWritable('skill');
    const dir = path.join(builtinSkills.SKILLS_DIR, skill.id);
    if (fs.existsSync(dir)) throw httpError(`内置技能目录 ${skill.id} 已存在`, 409, 'ALREADY_BUILTIN');
    const staging = path.join(builtinSkills.SKILLS_DIR, `.promote-${skill.id}-${process.pid}.tmp`);
    fs.rmSync(staging, { recursive: true, force: true });
    try {
        fs.mkdirSync(staging, { recursive: true });
        fs.writeFileSync(path.join(staging, 'SKILL.md'), skillMarkdown(skill), 'utf8');
        for (const file of skill.files) {
            const relative = safeRelative(file.path);
            if (!relative) continue;
            fs.mkdirSync(path.dirname(path.join(staging, relative)), { recursive: true });
            fs.writeFileSync(path.join(staging, relative), file.content, 'utf8');
        }
        builtinSkills.parseSkillFile(skill.id, fs.readFileSync(path.join(staging, 'SKILL.md'), 'utf8')); // 校验内置格式
        fs.renameSync(staging, dir);
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
    builtinSkills.reload();
    await skillStore.deleteRows(skill.id);
    return { kind: 'skill', id: skill.id, builtIn: true, path: displayPath(dir) };
}

function readTextFiles(dir) {
    const files = [];
    const walk = relative => {
        for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
            const next = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(next);
            else if (entry.isFile() && next.toLowerCase() !== 'skill.md') files.push({ path: next, content: fs.readFileSync(path.join(dir, next), 'utf8') });
        }
    };
    walk('');
    return files;
}

async function demoteSkill(id, { createdBy = '' } = {}) {
    const builtin = builtinSkills.builtin(id);
    if (!builtin) throw httpError('该技能不是内置技能', 409, 'NOT_BUILTIN');
    assertWritable('skill');
    const files = readTextFiles(builtin.dir);
    const backup = backupSource('skill', builtin.meta.id, builtin.dir);
    fs.rmSync(builtin.dir, { recursive: true, force: true });
    builtinSkills.reload();
    await skillStore.deleteRows(builtin.meta.id);
    await skillStore.insertDemoted({ ...builtin.meta, body: builtin.body }, files, createdBy);
    return { kind: 'skill', id: builtin.meta.id, builtIn: false, backup };
}

// ── F12 服务器脚本 / Python 脚本 ─────────────
async function promoteScript(kind, id) {
    const file = bundled.filePath(kind, id);
    if (fs.existsSync(file)) throw httpError('该脚本已经是内置脚本', 409, 'ALREADY_BUILTIN');
    if (kind === 'python' && id === pythonScripts.DEFAULT_SCRIPT_ID) throw httpError('该脚本随 Python 打包器源码内置', 409, 'ALREADY_BUILTIN');
    let payload;
    if (kind === 'f12') {
        const preset = await f12Presets.getPreset(id);
        if (!preset) throw httpError('脚本不存在', 404);
        payload = { version: 1, kind: 'f12-preset', preset };
    } else {
        const script = await pythonScripts.getScript(id);
        if (!script) throw httpError('脚本不存在', 404);
        payload = { version: 1, kind: 'python-script', script: { id: script.id, name: script.name, description: script.description || '', version: script.current_version || '1.0.0', code: script.code } };
    }
    assertWritable(kind);
    writeJsonAtomic(file, payload);
    return { kind, id, builtIn: true, path: displayPath(file) };
}

async function demoteScript(kind, id) {
    const file = bundled.filePath(kind, id);
    if (!fs.existsSync(file)) throw httpError(kind === 'python' && id === pythonScripts.DEFAULT_SCRIPT_ID ? '该脚本随 Python 打包器源码内置，不能取消' : '该脚本不是内置脚本', 409, 'NOT_BUILTIN');
    assertWritable(kind);
    const backup = backupSource(kind, id, file);
    fs.rmSync(file, { force: true });
    return { kind, id, builtIn: false, backup };
}

async function promote(kind, id, options = {}) {
    if (!KINDS.includes(kind)) throw httpError('不支持的类型');
    const cleanId = String(id || '').trim();
    if (kind === 'tool') return promoteTool(cleanId.toLowerCase());
    if (kind === 'skill') return promoteSkill(cleanId.toLowerCase(), options);
    return promoteScript(kind, cleanId);
}

async function demote(kind, id, options = {}) {
    if (!KINDS.includes(kind)) throw httpError('不支持的类型');
    const cleanId = String(id || '').trim();
    if (kind === 'tool') return demoteTool(cleanId.toLowerCase());
    if (kind === 'skill') return demoteSkill(cleanId.toLowerCase(), options);
    return demoteScript(kind, cleanId);
}

module.exports = { KINDS, LOCKED_TOOLS, status, promote, demote, writable };
