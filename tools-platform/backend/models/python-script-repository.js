const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { run, get, all } = require('./app-db');

const PACKAGER_DIR = path.resolve(__dirname, '../../../python-packager');
const CORE_SCRIPT_FILE = path.join(PACKAGER_DIR, 'core_script.py');
const VERSION_FILE = path.join(PACKAGER_DIR, 'version.json');
const CONFIG_FILE = path.join(PACKAGER_DIR, 'updater_config.json');

const DEFAULT_SCRIPT_ID = 'pr-audit-sampler';

function sha256(text) {
    return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function getInitialCoreScript() {
    if (fs.existsSync(CORE_SCRIPT_FILE)) {
        try {
            return fs.readFileSync(CORE_SCRIPT_FILE, 'utf8');
        } catch (_) {}
    }
    return '';
}

async function ensureReady() {
    await run(`CREATE TABLE IF NOT EXISTS python_scripts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        current_version TEXT NOT NULL DEFAULT '1.0.0',
        code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);

    await run(`CREATE TABLE IF NOT EXISTS python_script_versions (
        id TEXT PRIMARY KEY,
        script_id TEXT NOT NULL,
        version TEXT NOT NULL,
        changelog TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '系统内置',
        code TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
    )`);

    await run('CREATE INDEX IF NOT EXISTS idx_py_ver_script ON python_script_versions(script_id, created_at DESC)');

    // 种子数据：内置第一版 PR 报告抽查脚本
    const existing = await get('SELECT id FROM python_scripts WHERE id = ?', [DEFAULT_SCRIPT_ID]);
    if (!existing) {
        const initialCode = getInitialCoreScript();
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const digest = sha256(initialCode);

        await run(
            `INSERT INTO python_scripts (id, name, description, current_version, code, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                DEFAULT_SCRIPT_ID,
                'PR 报告抽查脚本',
                '从 001 RFC、002 风险、003 整改、004 SR 合并表中按分层均匀分布抽查单子并生成分析报表',
                '1.0.0',
                initialCode,
                now,
                now
            ]
        );

        await run(
            `INSERT INTO python_script_versions (id, script_id, version, changelog, author, code, sha256, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                'ver_' + Date.now().toString(36) + '_init',
                DEFAULT_SCRIPT_ID,
                '1.0.0',
                '初始内置版本：支持 RFC/风险/整改/SR 抽查、Hamilton 分配与彩色 ANSI 报告',
                'CodeArts 智能体',
                initialCode,
                digest,
                now
            ]
        );
    }
}

async function listScripts() {
    await ensureReady();
    return all('SELECT id, name, description, current_version, updated_at, length(code) as code_size FROM python_scripts ORDER BY updated_at DESC');
}

async function getScript(id) {
    await ensureReady();
    const script = await get('SELECT * FROM python_scripts WHERE id = ?', [id]);
    if (!script) return null;
    return script;
}

async function saveScript(data) {
    await ensureReady();
    const id = String(data.id || '').trim() || ('script_' + Date.now().toString(36));
    const name = String(data.name || '').trim();
    if (!name) throw new Error('脚本名称不能为空');

    const description = String(data.description || '').trim();
    const code = String(data.code || '');
    if (!code.trim()) throw new Error('脚本代码不能为空');

    const version = String(data.version || '1.0.0').trim();
    const changelog = String(data.changelog || '代码更新').trim();
    const author = String(data.author || '平台用户').trim();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const digest = sha256(code);

    const existing = await get('SELECT id, current_version FROM python_scripts WHERE id = ?', [id]);

    if (existing) {
        await run(
            `UPDATE python_scripts SET name = ?, description = ?, current_version = ?, code = ?, updated_at = ? WHERE id = ?`,
            [name, description, version, code, now, id]
        );
    } else {
        await run(
            `INSERT INTO python_scripts (id, name, description, current_version, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, name, description, version, code, now, now]
        );
    }

    // 记录版本快照
    const verId = 'ver_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    await run(
        `INSERT INTO python_script_versions (id, script_id, version, changelog, author, code, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [verId, id, version, changelog, author, code, digest, now]
    );

    return { id, name, version, sha256: digest, updated_at: now };
}

async function listVersions(scriptId) {
    await ensureReady();
    return all(
        'SELECT id, version, changelog, author, sha256, created_at, length(code) as code_size FROM python_script_versions WHERE script_id = ? ORDER BY created_at DESC',
        [scriptId]
    );
}

async function getVersion(versionId) {
    await ensureReady();
    return get('SELECT * FROM python_script_versions WHERE id = ?', [versionId]);
}

/**
 * 计算行级别文本差异
 */
function computeDiff(oldText = '', newText = '') {
    const oldLines = String(oldText || '').split(/\r?\n/);
    const newLines = String(newText || '').split(/\r?\n/);

    // 基于 Myers / LCS 的基础行对比
    const m = oldLines.length;
    const n = newLines.length;

    // 构建 LCS 表（当文件不超过 3000 行时非常快）
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
            if (oldLines[i] === newLines[j]) {
                dp[i + 1][j + 1] = dp[i][j] + 1;
            } else {
                dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    const diff = [];
    let i = m;
    let j = n;
    let additions = 0;
    let deletions = 0;
    let unchanged = 0;

    const stack = [];
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            stack.push({ type: 'same', oldLine: i, newLine: j, text: oldLines[i - 1] });
            unchanged++;
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            stack.push({ type: 'add', oldLine: null, newLine: j, text: newLines[j - 1] });
            additions++;
            j--;
        } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
            stack.push({ type: 'del', oldLine: i, newLine: null, text: oldLines[i - 1] });
            deletions++;
            i--;
        }
    }

    stack.reverse();

    return {
        stats: {
            additions,
            deletions,
            unchanged,
            oldTotal: m,
            newTotal: n
        },
        lines: stack
    };
}

/**
 * 将代码同步写入本地仓库的 python-packager/core_script.py 与 version.json
 */
async function syncToPackagerRepo(scriptId, code, metadata = {}) {
    if (!fs.existsSync(PACKAGER_DIR)) {
        fs.mkdirSync(PACKAGER_DIR, { recursive: true });
    }

    const version = String(metadata.version || '1.0.0').trim();
    const name = String(metadata.name || 'PR 报告抽查脚本').trim();
    const changelog = String(metadata.changelog || '从平台热更新').trim();
    const digest = sha256(code);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // 1. 写入 core_script.py
    fs.writeFileSync(CORE_SCRIPT_FILE, code, 'utf8');

    // 2. 写入 version.json
    const verData = {
        name,
        version,
        updated_at: now,
        description: metadata.description || 'PR 报告抽查脚本核心文件',
        author: metadata.author || 'CodeArts 智能体',
        sha256: digest,
        changelog
    };
    fs.writeFileSync(VERSION_FILE, JSON.stringify(verData, null, 2), 'utf8');

    return {
        success: true,
        sha256: digest,
        version,
        corePath: CORE_SCRIPT_FILE,
        versionPath: VERSION_FILE,
        updatedAt: now
    };
}

/**
 * 导出包含通用外壳全套源码的 ZIP 包
 */
async function exportUniversalShellZip() {
    const zip = new JSZip();

    const filesToInclude = [
        'universal_shell.py',
        'core_script.py',
        'version.json',
        'updater_config.json',
        'requirements.txt',
        'build_exe.bat',
        'run_launcher.bat',
        'README.md'
    ];

    for (const filename of filesToInclude) {
        const filePath = path.join(PACKAGER_DIR, filename);
        if (fs.existsSync(filePath)) {
            zip.file(filename, fs.readFileSync(filePath));
        }
    }

    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = {
    ensureReady,
    listScripts,
    getScript,
    saveScript,
    listVersions,
    getVersion,
    computeDiff,
    syncToPackagerRepo,
    exportUniversalShellZip,
    DEFAULT_SCRIPT_ID
};
