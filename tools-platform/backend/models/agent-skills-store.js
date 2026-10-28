// 用户自定义 Skill（对话里 @create-skill / @improve-skill 生成、或导入 SKILL 压缩包）与内置 Skill 的管理层。
// - 自定义 Skill 存在当前租户的 tools.db（agent_skills），按租户隔离；内置 Skill 仍是版本控制的 SKILL.md（agent-skills.js）。
// - 支持完善内置技能与自定义技能，完善覆盖前自动备份历史版本；支持查看历史版本并随时一键回退。
// - 内置 Skill 的改名、删除（隐藏）记在 agent_skill_overrides，不改动源文件，可随时恢复。
// - 对话加载时合并两者：@id 只在白名单（当前租户可见的 Skill）中匹配，不读取任何用户路径。
const JSZip = require('jszip');
const { run, get, all, getDatabase } = require('./app-db');
const builtinSkills = require('./agent-skills');

const { ID_RE, MAX_SELECTED } = builtinSkills;
const LIMITS = {
    name: 80,
    description: 500,
    body: 60000,
    files: 40,
    fileBytes: 100 * 1024,
    totalFileBytes: 400 * 1024,
    archiveBytes: 5 * 1024 * 1024,
    promptFiles: 20000
};
const TEXT_FILE_RE = /\.(md|markdown|txt|py|js|mjs|cjs|ts|json|ya?ml|toml|ini|sh|bash|ps1|bat|csv|tsv|html?|css|xml|sql|r|rb|go|java|kt|swift|c|h|cpp|hpp|rs|php)$/i;

// 按数据库连接记录已建表（租户库被恢复或重建后会是新连接，重新检查）
const readyConnections = new WeakSet();

function httpError(message, statusCode = 400, code = 'SKILL_INVALID') {
    return Object.assign(new Error(message), { statusCode, code });
}

async function ensureReady() {
    const connection = getDatabase();
    if (readyConnections.has(connection)) return;
    await run(`CREATE TABLE IF NOT EXISTS agent_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_en TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        description_en TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '✨',
        workspace INTEGER NOT NULL DEFAULT 0,
        body TEXT NOT NULL,
        files_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'chat',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);
    await run(`CREATE TABLE IF NOT EXISTS agent_skill_overrides (
        id TEXT PRIMARY KEY,
        name TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    )`);
    await run(`CREATE TABLE IF NOT EXISTS agent_skill_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        name TEXT NOT NULL,
        name_en TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        description_en TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '✨',
        workspace INTEGER NOT NULL DEFAULT 0,
        body TEXT NOT NULL,
        files_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT ''
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_skill_backups_skill_id ON agent_skill_backups(skill_id, created_at DESC)`);
    readyConnections.add(connection);
}

// ── SKILL.md 解析：兼容平台格式（name / name_en / description_en / workspace / icon）
//    与通用 Agent Skills 格式（name 为标识、description 可多行） ──
function parseFrontMatter(raw) {
    const text = String(raw || '').replace(/^﻿/, '');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) return { fields: {}, body: text.trim() };
    const fields = {};
    const lines = match[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const pair = lines[index].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!pair) continue;
        const key = pair[1].toLowerCase().replace(/-/g, '_');
        let value = pair[2].trim();
        if (/^[>|][+-]?$/.test(value)) {
            const parts = [];
            while (index + 1 < lines.length && (/^\s+\S/.test(lines[index + 1]) || !lines[index + 1].trim())) parts.push(lines[++index].trim());
            value = parts.join(value.startsWith('>') ? ' ' : '\n').trim();
        }
        fields[key] = value.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
    }
    return { fields, body: text.slice(match[0].length).trim() };
}

function slugify(value) {
    const slug = String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41);
    return /^[a-z]/.test(slug) ? slug.replace(/-+$/g, '') : '';
}

function clip(value, max) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 把 SKILL.md 文本规范成 Skill 记录；fallbackId 用于没有可用标识的通用格式（取压缩包目录名等） */
function normalizeSkillMarkdown(raw, { fallbackId = '', overrides = {} } = {}) {
    const { fields, body } = parseFrontMatter(raw);
    if (!body) throw httpError('SKILL.md 缺少正文（技能的执行步骤）');
    if (body.length > LIMITS.body) throw httpError(`SKILL.md 正文超过 ${LIMITS.body} 字`);
    const id = slugify(overrides.id) || slugify(fields.id) || (ID_RE.test(String(fields.name || '').toLowerCase()) ? String(fields.name).toLowerCase() : '')
        || slugify(fallbackId) || slugify(fields.name_en) || `skill-${Date.now().toString(36)}`;
    if (!ID_RE.test(id)) throw httpError('技能标识只能使用小写英文、数字和连字符，并以字母开头');
    const name = clip(overrides.name || fields.name || fields.name_en || id, LIMITS.name);
    const nameEn = clip(overrides.nameEn || fields.name_en || fields.name || id, LIMITS.name);
    const description = clip(overrides.description || fields.description || fields.description_en || '', LIMITS.description);
    const descriptionEn = clip(overrides.descriptionEn || fields.description_en || fields.description || '', LIMITS.description);
    const icon = clip(overrides.icon || fields.icon || '✨', 8) || '✨';
    const workspace = String(overrides.workspace ?? fields.workspace ?? '').toLowerCase() === 'true';
    return { id, name, nameEn, description, descriptionEn, icon, workspace, body };
}

/** 解析 SKILL 压缩包：取最浅一层的 SKILL.md，同目录下的文本文件作为附带资料 */
async function parseSkillArchive(buffer, { archiveName = '' } = {}) {
    if (!buffer?.length) throw httpError('压缩包为空');
    if (buffer.length > LIMITS.archiveBytes) throw httpError(`SKILL 压缩包不能超过 ${LIMITS.archiveBytes / 1024 / 1024} MB`);
    let zip;
    try { zip = await JSZip.loadAsync(buffer); } catch { throw httpError('无法读取压缩包，请确认是 ZIP 格式'); }
    const entries = Object.values(zip.files).filter(entry => {
        const parts = entry.name.replace(/\\/g, '/').split('/').filter(Boolean);
        return !entry.dir && !parts.some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._') || part === '..');
    });
    const skillEntry = entries.filter(entry => /(^|\/)skill\.md$/i.test(entry.name))
        .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
    if (!skillEntry) throw httpError('压缩包里没有 SKILL.md，不是 SKILL 技能包', 400, 'SKILL_MD_MISSING');
    const root = skillEntry.name.replace(/\\/g, '/').replace(/[^/]*$/, '');
    const folder = root.split('/').filter(Boolean).pop() || String(archiveName).replace(/\.zip$/i, '');
    const files = [];
    let total = 0;
    let skipped = 0;
    for (const entry of entries) {
        const name = entry.name.replace(/\\/g, '/');
        if (entry === skillEntry || !name.startsWith(root)) continue;
        const relative = name.slice(root.length);
        if (!TEXT_FILE_RE.test(relative) || files.length >= LIMITS.files) { skipped += 1; continue; }
        const content = await entry.async('string');
        const bytes = Buffer.byteLength(content);
        if (bytes > LIMITS.fileBytes || total + bytes > LIMITS.totalFileBytes) { skipped += 1; continue; }
        total += bytes;
        files.push({ path: relative, content });
    }
    return { markdown: await skillEntry.async('string'), fallbackId: folder, files, skipped };
}

function rowToSkill(row) {
    let files = [];
    try { files = JSON.parse(row.files_json || '[]'); } catch { files = []; }
    return {
        id: row.id,
        name: row.name,
        nameEn: row.name_en || row.name,
        description: row.description,
        descriptionEn: row.description_en || row.description,
        icon: row.icon || '✨',
        workspace: Boolean(row.workspace),
        builtIn: false,
        customized: false,
        hidden: false,
        source: row.source,
        fileCount: files.length,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        body: row.body,
        files
    };
}

async function overrides() {
    await ensureReady();
    const rows = await all('SELECT id, name, hidden FROM agent_skill_overrides');
    return new Map(rows.map(row => [row.id, row]));
}

async function listCustomRows() {
    await ensureReady();
    return all('SELECT * FROM agent_skills ORDER BY updated_at DESC, id ASC');
}

/** 当前租户的 Skill 目录（不含正文）。includeHidden 用于管理界面显示被删除的内置 Skill */
async function listAll({ includeHidden = false } = {}) {
    const [overrideMap, customRows] = await Promise.all([overrides(), listCustomRows()]);
    const customMap = new Map(customRows.map(row => [row.id, row]));
    const builtins = builtinSkills.list().map(meta => {
        const override = overrideMap.get(meta.id);
        const custom = customMap.get(meta.id);
        const isCustomized = Boolean(custom);
        let fileCount = 0;
        if (custom) {
            try { fileCount = JSON.parse(custom.files_json || '[]').length; } catch { fileCount = 0; }
        }
        return {
            ...meta,
            name: custom?.name || override?.name || meta.name,
            nameEn: custom?.name_en || meta.nameEn,
            description: custom?.description || meta.description,
            descriptionEn: custom?.description_en || meta.descriptionEn,
            icon: custom?.icon || meta.icon,
            workspace: custom ? Boolean(custom.workspace) : meta.workspace,
            builtIn: true,
            customized: isCustomized,
            hidden: Boolean(override?.hidden),
            renamed: Boolean(override?.name || custom?.name),
            fileCount,
            updatedAt: custom?.updated_at || ''
        };
    });
    // 非内置的自定义技能
    const customs = customRows.filter(row => !builtinSkills.builtin(row.id)).map(row => {
        const { body, files, ...meta } = rowToSkill(row);
        return meta;
    });
    return [...builtins, ...customs].filter(item => includeHidden || !item.hidden);
}

/** 删除自定义 Skill 行（转为内置后调用），同时清掉同标识的内置覆盖记录 */
async function deleteRows(id) {
    await ensureReady();
    const cleanId = String(id || '').toLowerCase();
    await run('DELETE FROM agent_skills WHERE id = ?', [cleanId]);
    await run('DELETE FROM agent_skill_overrides WHERE id = ?', [cleanId]);
}

/** 以给定内容写入自定义 Skill（取消内置后调用），不做内置标识冲突检查 */
async function insertDemoted(skill, files, createdBy = '') {
    await ensureReady();
    const now = new Date().toISOString();
    await run(`INSERT OR REPLACE INTO agent_skills (id, name, name_en, description, description_en, icon, workspace, body, files_json, source, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'builtin', ?, ?, ?)`,
    [skill.id, skill.name, skill.nameEn, skill.description, skill.descriptionEn, skill.icon || '✨', skill.workspace ? 1 : 0, skill.body, JSON.stringify(files || []), createdBy, now, now]);
}

async function getCustom(id) {
    await ensureReady();
    const row = await get('SELECT * FROM agent_skills WHERE id = ?', [String(id || '').toLowerCase()]);
    return row ? rowToSkill(row) : null;
}

/** 获取完整技能详情（支持内置技能、自定义技能以及被完善自定义的内置技能） */
async function getSkill(id) {
    await ensureReady();
    const cleanId = String(id || '').toLowerCase();
    const builtin = builtinSkills.builtin(cleanId);
    const custom = await getCustom(cleanId);
    if (!builtin && !custom) return null;
    if (builtin) {
        const override = (await overrides()).get(cleanId);
        if (custom) {
            return {
                ...custom,
                builtIn: true,
                customized: true,
                originalName: builtin.meta.name,
                originalBody: builtin.body,
                markdown: skillMarkdown(custom, custom.body)
            };
        }
        const meta = { ...builtin.meta, name: override?.name || builtin.meta.name };
        return {
            ...meta,
            builtIn: true,
            customized: false,
            source: 'builtin',
            body: builtin.body,
            files: [],
            fileCount: 0,
            markdown: skillMarkdown(meta, builtin.body)
        };
    }
    return {
        ...custom,
        builtIn: false,
        customized: false,
        markdown: skillMarkdown(custom, custom.body)
    };
}

/** 备份当前技能状态到 agent_skill_backups */
async function createBackup(skillId, { createdBy = '', summary = '' } = {}) {
    await ensureReady();
    const cleanId = String(skillId || '').toLowerCase();
    const current = await getSkill(cleanId);
    if (!current) throw httpError('技能不存在，无法备份', 404, 'SKILL_NOT_FOUND');
    const now = new Date().toISOString();
    const res = await run(
        `INSERT INTO agent_skill_backups (skill_id, name, name_en, description, description_en, icon, workspace, body, files_json, source, created_by, created_at, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cleanId, current.name, current.nameEn || current.name, current.description || '', current.descriptionEn || '', current.icon || '✨',
         current.workspace ? 1 : 0, current.body || '', JSON.stringify(current.files || []), current.source || '', createdBy, now, summary || '技能备份']
    );
    return { id: res?.lastID, skillId: cleanId, createdAt: now, summary: summary || '技能备份' };
}

/** 获取某技能的所有历史备份列表（按时间倒序） */
async function listBackups(skillId) {
    await ensureReady();
    const cleanId = String(skillId || '').toLowerCase();
    const rows = await all(
        `SELECT id, skill_id, name, name_en, description, description_en, icon, workspace, files_json, source, created_by, created_at, summary
         FROM agent_skill_backups WHERE skill_id = ? ORDER BY created_at DESC, id DESC`,
        [cleanId]
    );
    return rows.map(r => ({
        id: r.id,
        skillId: r.skill_id,
        name: r.name,
        nameEn: r.name_en,
        description: r.description,
        descriptionEn: r.description_en,
        icon: r.icon,
        workspace: Boolean(r.workspace),
        fileCount: (() => { try { return JSON.parse(r.files_json || '[]').length; } catch { return 0; } })(),
        source: r.source,
        createdBy: r.created_by,
        createdAt: r.created_at,
        summary: r.summary
    }));
}

/** 获取某个备份的完整内容 */
async function getBackup(skillId, backupId) {
    await ensureReady();
    const cleanId = String(skillId || '').toLowerCase();
    const row = await get(
        `SELECT * FROM agent_skill_backups WHERE skill_id = ? AND id = ?`,
        [cleanId, Number(backupId)]
    );
    if (!row) throw httpError('备份记录不存在', 404, 'BACKUP_NOT_FOUND');
    let files = [];
    try { files = JSON.parse(row.files_json || '[]'); } catch { files = []; }
    return {
        id: row.id,
        skillId: row.skill_id,
        name: row.name,
        nameEn: row.name_en,
        description: row.description,
        descriptionEn: row.description_en,
        icon: row.icon,
        workspace: Boolean(row.workspace),
        body: row.body,
        files,
        source: row.source,
        createdBy: row.created_by,
        createdAt: row.created_at,
        summary: row.summary,
        markdown: skillMarkdown({
            id: row.skill_id,
            name: row.name,
            nameEn: row.name_en,
            description: row.description,
            descriptionEn: row.description_en,
            icon: row.icon,
            workspace: Boolean(row.workspace)
        }, row.body)
    };
}

/** 回退技能到指定备份版本，回退前先自动备份当前版本以便恢复 */
async function rollback(skillId, backupId, { createdBy = '' } = {}) {
    await ensureReady();
    const cleanId = String(skillId || '').toLowerCase();
    const targetBackup = await getBackup(cleanId, backupId);
    if (!targetBackup) throw httpError('备份记录不存在', 404, 'BACKUP_NOT_FOUND');
    const current = await getSkill(cleanId);
    if (current) {
        await createBackup(cleanId, { createdBy, summary: `回退到备份 #${backupId} 前自动备份` });
    }
    const isBuiltin = Boolean(builtinSkills.builtin(cleanId));
    const now = new Date().toISOString();
    await run(
        `INSERT INTO agent_skills (id, name, name_en, description, description_en, icon, workspace, body, files_json, source, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rollback', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_en = excluded.name_en, description = excluded.description,
             description_en = excluded.description_en, icon = excluded.icon, workspace = excluded.workspace, body = excluded.body,
             files_json = excluded.files_json, source = excluded.source, updated_at = excluded.updated_at`,
        [cleanId, targetBackup.name, targetBackup.nameEn, targetBackup.description, targetBackup.descriptionEn, targetBackup.icon,
         targetBackup.workspace ? 1 : 0, targetBackup.body, JSON.stringify(targetBackup.files || []), createdBy, targetBackup.createdAt || now, now]
    );
    if (isBuiltin) {
        await run('UPDATE agent_skill_overrides SET hidden = 0 WHERE id = ?', [cleanId]);
    }
    return getSkill(cleanId);
}

/** 内置技能恢复为初始版本（清除租户覆盖），清除前自动备份 */
async function resetToBuiltin(id, { createdBy = '' } = {}) {
    await ensureReady();
    const cleanId = String(id || '').toLowerCase();
    if (!builtinSkills.builtin(cleanId)) throw httpError('不是内置技能', 400, 'NOT_BUILTIN');
    const custom = await getCustom(cleanId);
    if (custom) {
        await createBackup(cleanId, { createdBy, summary: '恢复内置初始版本前自动备份' });
        await run('DELETE FROM agent_skills WHERE id = ?', [cleanId]);
    }
    await run('DELETE FROM agent_skill_overrides WHERE id = ?', [cleanId]);
    return getSkill(cleanId);
}

async function saveSkill(skill, { files = [], source = 'chat', createdBy = '', overwrite = false } = {}) {
    await ensureReady();
    const cleanId = skill.id;
    const isBuiltin = Boolean(builtinSkills.builtin(cleanId));
    const existingCustom = await getCustom(cleanId);

    // 未指定 overwrite 时做冲突检查
    if (isBuiltin && !overwrite) {
        throw httpError(`@${skill.id} 是内置技能的标识，请换一个`, 409, 'SKILL_ID_RESERVED');
    }
    if (existingCustom && !overwrite) {
        throw httpError(`已存在技能 @${skill.id}`, 409, 'SKILL_EXISTS');
    }

    // 覆盖/完善已有技能前，自动备份原有版本
    if (isBuiltin || existingCustom) {
        await createBackup(cleanId, {
            createdBy,
            summary: existingCustom ? '完善技能前自动备份' : '完善技能前自动备份（内置初始版本）'
        });
    }

    const now = new Date().toISOString();
    await run(`INSERT INTO agent_skills (id, name, name_en, description, description_en, icon, workspace, body, files_json, source, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_en = excluded.name_en, description = excluded.description,
                   description_en = excluded.description_en, icon = excluded.icon, workspace = excluded.workspace, body = excluded.body,
                   files_json = excluded.files_json, source = excluded.source, updated_at = excluded.updated_at`,
    [skill.id, skill.name, skill.nameEn, skill.description, skill.descriptionEn, skill.icon, skill.workspace ? 1 : 0, skill.body,
        JSON.stringify(files), isBuiltin ? 'override' : source, createdBy, existingCustom?.createdAt || now, now]);

    if (isBuiltin) {
        await run('UPDATE agent_skill_overrides SET hidden = 0 WHERE id = ?', [cleanId]);
    }

    const saved = await getCustom(skill.id);
    const { body, files: savedFiles, ...meta } = saved;
    return { ...meta, builtIn: isBuiltin, customized: isBuiltin };
}

/** 对话里 @create-skill / @improve-skill 生成的 SKILL.md 文本，或用户上传的单个 SKILL.md */
async function createFromMarkdown(markdown, options = {}) {
    const fallbackId = String(options.fileName || '').replace(/\.md$/i, '').replace(/(^|[-_.])skill$/i, '');
    const skill = normalizeSkillMarkdown(markdown, { fallbackId, overrides: options.overrides || {} });
    return saveSkill(skill, { source: options.source || 'chat', createdBy: options.createdBy, overwrite: options.overwrite });
}

/** 导入 SKILL 压缩包；overrides 来自导入对话框中用户修改过的名称、简介 */
async function importArchive(buffer, options = {}) {
    const parsed = await parseSkillArchive(buffer, { archiveName: options.archiveName });
    const skill = normalizeSkillMarkdown(parsed.markdown, { fallbackId: parsed.fallbackId, overrides: options.overrides || {} });
    const meta = await saveSkill(skill, { files: parsed.files, source: 'import', createdBy: options.createdBy, overwrite: options.overwrite });
    return { ...meta, skippedFiles: parsed.skipped };
}

/** 导入前预览：返回识别出的标识与名称，供导入对话框预填，不写库 */
async function previewArchive(buffer, { archiveName = '' } = {}) {
    const parsed = await parseSkillArchive(buffer, { archiveName });
    const skill = normalizeSkillMarkdown(parsed.markdown, { fallbackId: parsed.fallbackId });
    const { body, ...meta } = skill;
    return { ...meta, fileCount: parsed.files.length, skippedFiles: parsed.skipped, exists: Boolean(await getCustom(skill.id)), reserved: Boolean(builtinSkills.builtin(skill.id)) };
}

/** 单个 SKILL.md 文件的预览；文件名（去掉 SKILL 字样）作为没有标识时的备选 */
async function previewMarkdown(markdown, { fileName = '' } = {}) {
    const fallbackId = String(fileName).replace(/\.md$/i, '').replace(/(^|[-_.])skill$/i, '');
    const skill = normalizeSkillMarkdown(markdown, { fallbackId });
    const { body, ...meta } = skill;
    return { ...meta, fileCount: 0, skippedFiles: 0, exists: Boolean(await getCustom(skill.id)), reserved: Boolean(builtinSkills.builtin(skill.id)) };
}

async function rename(id, name) {
    await ensureReady();
    const cleanId = String(id || '').toLowerCase();
    const cleanName = clip(name, LIMITS.name);
    if (!cleanName) throw httpError('名称不能为空');
    const now = new Date().toISOString();
    if (builtinSkills.builtin(cleanId)) {
        await run(`INSERT INTO agent_skill_overrides (id, name, hidden, updated_at) VALUES (?, ?, 0, ?)
                   ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`, [cleanId, cleanName, now]);
        return true;
    }
    const result = await run('UPDATE agent_skills SET name = ?, updated_at = ? WHERE id = ?', [cleanName, now, cleanId]);
    if (!result?.changes) throw httpError('技能不存在', 404, 'SKILL_NOT_FOUND');
    return true;
}

/** 自定义 Skill 直接删除；内置 Skill 只是隐藏，若有自定义修改则恢复内置并备份 */
async function remove(id) {
    await ensureReady();
    const cleanId = String(id || '').toLowerCase();
    const now = new Date().toISOString();
    if (builtinSkills.builtin(cleanId)) {
        const custom = await getCustom(cleanId);
        if (custom) {
            await createBackup(cleanId, { summary: '删除自定义修改前备份' });
            await run('DELETE FROM agent_skills WHERE id = ?', [cleanId]);
            return { builtIn: true, revertedCustomization: true };
        }
        await run(`INSERT INTO agent_skill_overrides (id, name, hidden, updated_at) VALUES (?, NULL, 1, ?)
                   ON CONFLICT(id) DO UPDATE SET hidden = 1, updated_at = excluded.updated_at`, [cleanId, now]);
        return { builtIn: true, hidden: true };
    }
    const existing = await getCustom(cleanId);
    if (existing) {
        await createBackup(cleanId, { summary: '删除技能前备份' });
    }
    const result = await run('DELETE FROM agent_skills WHERE id = ?', [cleanId]);
    if (!result?.changes) throw httpError('技能不存在', 404, 'SKILL_NOT_FOUND');
    return { builtIn: false };
}

async function restoreBuiltins() {
    await ensureReady();
    const result = await run('UPDATE agent_skill_overrides SET hidden = 0, name = NULL');
    return result?.changes || 0;
}

function skillMarkdown(meta, body) {
    const line = (key, value) => `${key}: ${String(value ?? '').replace(/\r?\n/g, ' ')}`;
    return ['---', line('id', meta.id), line('name', meta.name), line('name_en', meta.nameEn || meta.name), line('description', meta.description),
        line('description_en', meta.descriptionEn || meta.description || meta.nameEn || meta.name), line('icon', meta.icon || '✨'), line('workspace', meta.workspace ? 'true' : 'false'), '---', '', (body || '').trim(), ''].join('\n');
}

/** 下载为标准 SKILL 压缩包：<id>/SKILL.md + 附带文件，可再次导入 */
async function exportZip(id) {
    const cleanId = String(id || '').toLowerCase();
    const zip = new JSZip();
    const folder = zip.folder(cleanId);
    const builtin = builtinSkills.builtin(cleanId);
    const custom = await getCustom(cleanId);
    if (builtin) {
        if (custom) {
            folder.file('SKILL.md', skillMarkdown(custom, custom.body));
            custom.files.forEach(file => folder.file(file.path, file.content));
        } else {
            const override = (await overrides()).get(cleanId);
            folder.file('SKILL.md', skillMarkdown({ ...builtin.meta, name: override?.name || builtin.meta.name }, builtin.body));
        }
    } else {
        if (!custom) throw httpError('技能不存在', 404, 'SKILL_NOT_FOUND');
        folder.file('SKILL.md', skillMarkdown(custom, custom.body));
        custom.files.forEach(file => folder.file(file.path, file.content));
    }
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), filename: `${cleanId}.zip` };
}

/** 对话加载：与 agent-skills.load 相同的规则，但白名单是当前租户可见的全部 Skill */
async function loadAll(content, { hasWorkspace = false, language = 'zh', extraIds = [] } = {}) {
    const catalog = await listAll();
    const visible = new Map(catalog.map(item => [item.id, item]));
    const { known: mentioned, unknown: notBuiltin } = builtinSkills.mentions(content);
    const known = [...mentioned, ...notBuiltin].filter(id => visible.has(id));
    const unknown = notBuiltin.filter(id => !visible.has(id));
    const kept = (Array.isArray(extraIds) ? extraIds : []).map(id => String(id || '').toLowerCase()).filter(id => visible.has(id));
    const wanted = new Set([...known, ...kept].slice(0, MAX_SELECTED));
    const selected = catalog.filter(item => wanted.has(item.id));
    const missing = selected.filter(item => item.workspace && !hasWorkspace);
    if (missing.length) throw Object.assign(new Error(language === 'en'
        ? `Choose a workspace folder before using ${missing.map(item => `@${item.id}`).join(', ')}.`
        : `请先选择工作目录，再使用 ${missing.map(item => `@${item.id}`).join('、')}。`), { code: 'SKILL_WORKSPACE_REQUIRED', statusCode: 400, skills: missing.map(item => item.id) });
    const sections = [];
    for (const item of selected) {
        if (item.builtIn) {
            const custom = await getCustom(item.id);
            if (custom) {
                let section = `### @${item.id}\n${custom.body}`;
                let budget = LIMITS.promptFiles;
                for (const file of custom.files) {
                    if (file.content.length > budget) break;
                    budget -= file.content.length;
                    section += `\n\n#### 附带文件：${file.path}\n\`\`\`\n${file.content}\n\`\`\``;
                }
                sections.push(section);
                continue;
            }
            sections.push(`### @${item.id}\n${builtinSkills.builtin(item.id).body}`);
            continue;
        }
        const skill = await getCustom(item.id);
        if (!skill) continue;
        let section = `### @${item.id}\n${skill.body}`;
        let budget = LIMITS.promptFiles;
        for (const file of skill.files) {
            if (file.content.length > budget) break;
            budget -= file.content.length;
            section += `\n\n#### 附带文件：${file.path}\n\`\`\`\n${file.content}\n\`\`\``;
        }
        sections.push(section);
    }
    return {
        selected: selected.map(({ builtIn, customized, hidden, renamed, fileCount, updatedAt, source, createdBy, createdAt, ...meta }) => meta),
        unknown,
        prompt: builtinSkills.buildPrompt(sections)
    };
}

module.exports = {
    LIMITS,
    parseFrontMatter,
    normalizeSkillMarkdown,
    parseSkillArchive,
    listAll,
    getCustom,
    getSkill,
    deleteRows,
    insertDemoted,
    createFromMarkdown,
    importArchive,
    previewArchive,
    previewMarkdown,
    rename,
    remove,
    restoreBuiltins,
    resetToBuiltin,
    createBackup,
    listBackups,
    getBackup,
    rollback,
    exportZip,
    loadAll
};
