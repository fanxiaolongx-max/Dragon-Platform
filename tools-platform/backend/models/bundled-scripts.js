// 随项目发布的内置脚本：backend/builtin-scripts/f12/<id>.json（F12 服务器脚本）与 python/<id>.json（Python 脚本）。
// 由「转为内置」（builtin-promotion.js）写入、提交到 Git 后随项目自带；每个租户首次读取脚本库时补种缺失的条目，
// 与内置工具「缺失时自动安装」一致：已存在（同 id 或同名）的脚本不覆盖，保留用户修改。
const fs = require('fs');
const path = require('path');
const { run, get, getDatabase } = require('./app-db');
const f12Presets = require('./f12-script-presets-repository');
const pythonScripts = require('./python-script-repository');

const ROOT = process.env.TOOLS_BUILTIN_SCRIPTS_DIR ? path.resolve(process.env.TOOLS_BUILTIN_SCRIPTS_DIR) : path.join(__dirname, '../builtin-scripts'); // 测试可指向临时目录
const DIRS = { f12: path.join(ROOT, 'f12'), python: path.join(ROOT, 'python') };
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const seededConnections = new WeakSet();

function readBundle(kind) {
    const dir = DIRS[kind];
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(name => name.endsWith('.json') && ID_RE.test(name.slice(0, -5)))
        .map(name => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
                const item = kind === 'f12' ? data.preset : data.script;
                return data.version === 1 && item && item.id === name.slice(0, -5) ? item : null;
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function bundledIds(kind) {
    return new Set(readBundle(kind).map(item => item.id));
}

function filePath(kind, id) {
    if (!DIRS[kind] || !ID_RE.test(String(id || ''))) throw Object.assign(new Error('无效的脚本标识'), { statusCode: 400 });
    return path.join(DIRS[kind], `${id}.json`);
}

async function seedF12() {
    await f12Presets.ensureReady();
    for (const preset of readBundle('f12')) {
        const clash = await get('SELECT id FROM f12_script_presets WHERE id = ? OR name = ? COLLATE NOCASE', [preset.id, String(preset.name || '').trim()]);
        if (clash) continue;
        const input = f12Presets.normalizeInput(preset);
        const now = new Date().toISOString();
        await run(`INSERT INTO f12_script_presets (
                       id, name, description, matches, world, include_popup, manual_launch,
                       run_at, all_frames, optional_permissions_json, code, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            preset.id, input.name, input.description, input.matches, input.world, input.includePopup ? 1 : 0,
            input.manualLaunch ? 1 : 0, input.runAt, input.allFrames ? 1 : 0, JSON.stringify(input.optionalPermissions),
            input.code, preset.createdAt || now, now
        ]);
    }
}

async function seedPython() {
    await pythonScripts.ensureReady();
    for (const script of readBundle('python')) {
        const clash = await get('SELECT id FROM python_scripts WHERE id = ? OR name = ? COLLATE NOCASE', [script.id, String(script.name || '').trim()]);
        if (clash) continue;
        await pythonScripts.saveScript({ ...script, changelog: '内置脚本初始化', author: '系统内置' });
    }
}

/** 当前租户补种一次（按数据库连接记录，租户库重建后会重新检查）；失败不影响脚本库正常读取 */
async function ensureSeeded() {
    const connection = getDatabase();
    if (seededConnections.has(connection)) return;
    seededConnections.add(connection);
    try {
        await seedF12();
        await seedPython();
    } catch (error) {
        seededConnections.delete(connection);
        console.warn('[bundled-scripts] seed failed:', error.message);
    }
}

module.exports = { DIRS, ROOT, readBundle, bundledIds, filePath, ensureSeeded };
