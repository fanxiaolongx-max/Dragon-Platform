const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fingerprintFiles } = require('./tool-content-fingerprint');

const TOOL_MANIFEST_FILE = '.tool-manifest.json';
const SYSTEM_MARKER = 'tools-platform';
const DECISION_STATE_VERSION = 1;

function normalizeSlug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function listFiles(rootDir, relativeDir = '') {
    const absoluteDir = path.join(rootDir, relativeDir);
    const files = [];
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
        const relativePath = path.posix.join(relativeDir.split(path.sep).join('/'), entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`系统工具不允许包含符号链接：${relativePath}`);
        }
        if (entry.isDirectory()) {
            files.push(...listFiles(rootDir, relativePath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        }
    }
    return files.sort();
}

function fileDigest(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileRecord(rootDir, relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
    const stat = fs.statSync(absolutePath);
    return {
        path: relativePath,
        size: stat.size,
        digest: fileDigest(absolutePath)
    };
}

function sumBytes(records) {
    return records.reduce((sum, item) => sum + Number(item && item.size || 0), 0);
}

function validateBundledTool(sourceDir, slug) {
    const toolDir = path.join(sourceDir, slug);
    const manifestPath = path.join(toolDir, TOOL_MANIFEST_FILE);
    const indexPath = path.join(toolDir, 'index.html');
    const manifest = readJson(manifestPath);
    if (!manifest || manifest.version !== 1 || !manifest.tool) {
        throw new Error('系统工具清单无效');
    }
    if (normalizeSlug(manifest.tool.slug) !== slug || manifest.tool.slug !== slug) {
        throw new Error('系统工具清单 slug 与目录不一致');
    }
    if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
        throw new Error('系统工具缺少 index.html');
    }
    const files = listFiles(toolDir);
    return {
        slug,
        toolDir,
        manifest,
        files,
        managedFiles: files.filter(file => file !== TOOL_MANIFEST_FILE),
        fingerprint: fingerprintFiles(toolDir, files)
    };
}

function listBundledTools(sourceDir) {
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) return [];
    return fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && normalizeSlug(entry.name) === entry.name)
        .map(entry => validateBundledTool(sourceDir, entry.name))
        .sort((a, b) => a.slug.localeCompare(b.slug));
}

function isManagedTargetManifest(manifest, slug) {
    return Boolean(
        manifest
        && manifest.version === 1
        && manifest.tool
        && manifest.tool.slug === slug
        && manifest.builtIn === true
        && manifest.system
        && manifest.system.managedBy === SYSTEM_MARKER
    );
}

function matchesLegacyBundledTool(source, targetToolDir, targetManifest) {
    if (
        !targetManifest
        || targetManifest.version !== 1
        || !targetManifest.tool
        || targetManifest.tool.slug !== source.slug
    ) {
        return false;
    }
    for (const relativePath of source.managedFiles) {
        const sourcePath = path.join(source.toolDir, relativePath);
        const targetPath = path.join(targetToolDir, relativePath);
        if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) return false;
        if (!fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath))) return false;
    }
    return true;
}

function buildTargetManifest(source, existingManifest) {
    return {
        ...source.manifest,
        builtIn: true,
        system: {
            managedBy: SYSTEM_MARKER,
            fingerprint: source.fingerprint,
            files: source.managedFiles
        },
        history: existingManifest && existingManifest.history !== undefined
            ? existingManifest.history
            : source.manifest.history || null
    };
}

function readDecisionState(stateFile) {
    if (!stateFile) return { version: DECISION_STATE_VERSION, skipped: {} };
    const state = readJson(stateFile);
    if (!state || state.version !== DECISION_STATE_VERSION || !state.skipped || typeof state.skipped !== 'object') {
        return { version: DECISION_STATE_VERSION, skipped: {} };
    }
    return state;
}

function writeDecisionState(stateFile, state) {
    if (!stateFile) return;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const tempFile = `${stateFile}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.rmSync(stateFile, { force: true });
    fs.renameSync(tempFile, stateFile);
}

function compareBundledTool(source, targetDir, { preserveInstalledRelease = true } = {}) {
    const targetToolDir = path.join(targetDir, source.slug);
    const targetExists = fs.existsSync(targetToolDir) && fs.statSync(targetToolDir).isDirectory();
    const targetManifest = targetExists ? readJson(path.join(targetToolDir, TOOL_MANIFEST_FILE)) : null;
    const managed = isManagedTargetManifest(targetManifest, source.slug);
    const legacyMatch = targetExists && !managed
        ? matchesLegacyBundledTool(source, targetToolDir, targetManifest)
        : false;
    const previousManagedFiles = managed
        && targetManifest.system
        && Array.isArray(targetManifest.system.files)
        ? targetManifest.system.files.filter(file => file !== TOOL_MANIFEST_FILE)
        : [];
    const targetFiles = targetExists
        ? listFiles(targetToolDir).filter(file => file !== TOOL_MANIFEST_FILE)
        : [];
    const sourceFiles = source.managedFiles;
    const paths = new Set([...sourceFiles, ...targetFiles]);
    const previousManagedSet = new Set(previousManagedFiles);
    const sourceSet = new Set(sourceFiles);
    const changes = [];

    for (const relativePath of [...paths].sort()) {
        const oldFile = targetExists ? fileRecord(targetToolDir, relativePath) : null;
        const newFile = sourceSet.has(relativePath) ? fileRecord(source.toolDir, relativePath) : null;
        let type;
        if (!oldFile && newFile) type = 'added';
        else if (oldFile && newFile && oldFile.digest !== newFile.digest) type = 'modified';
        else if (oldFile && newFile) type = 'unchanged';
        else if (oldFile && managed && previousManagedSet.has(relativePath)) type = 'removed';
        else if (oldFile) type = 'preserved';
        else continue;
        changes.push({
            path: relativePath,
            type,
            oldSize: oldFile ? oldFile.size : 0,
            newSize: newFile ? newFile.size : 0
        });
    }

    const counts = changes.reduce((result, item) => {
        result[item.type] = (result[item.type] || 0) + 1;
        return result;
    }, { added: 0, modified: 0, removed: 0, unchanged: 0, preserved: 0 });
    const oldTool = targetManifest && targetManifest.tool ? {
        name: targetManifest.tool.name || source.slug,
        icon: targetManifest.tool.icon || '🧩',
        description: targetManifest.tool.description || ''
    } : null;
    const newTool = {
        name: source.manifest.tool.name || source.slug,
        icon: source.manifest.tool.icon || '🧩',
        description: source.manifest.tool.description || ''
    };
    const toolInfoChanged = Boolean(oldTool && (
        oldTool.name !== newTool.name
        || oldTool.icon !== newTool.icon
        || oldTool.description !== newTool.description
    ));
    const storedFingerprintChanged = managed
        ? targetManifest.system.fingerprint !== source.fingerprint
        : targetExists;
    let canonicalContentMatches = false;
    if (managed) {
        const obsoleteManagedFiles = previousManagedFiles.filter(file => !sourceSet.has(file) && fs.existsSync(path.join(targetToolDir, file)));
        try {
            canonicalContentMatches = obsoleteManagedFiles.length === 0
                && source.files.every(file => fs.existsSync(path.join(targetToolDir, file)))
                && fingerprintFiles(targetToolDir, source.files) === source.fingerprint;
        } catch (_) {
            canonicalContentMatches = false;
        }
    }
    const metadataChanged = managed ? !canonicalContentMatches : targetExists;
    let installedContentMatches = canonicalContentMatches;
    if (managed && !installedContentMatches) {
        try {
            installedContentMatches = fingerprintFiles(targetToolDir, [TOOL_MANIFEST_FILE, ...previousManagedFiles])
                === targetManifest.system.fingerprint;
        } catch (_) { /* 缺失或无法读取的受管文件需要人工确认 */ }
    }
    const sourceTime = Date.parse(source.manifest.tool.updatedAt);
    const installedTime = Date.parse(targetManifest?.tool?.updatedAt);
    const comparableReleases = Number.isFinite(sourceTime) && Number.isFinite(installedTime);
    const installedFromMarket = managed && targetManifest.market?.directoryFingerprint === targetManifest.system.fingerprint;
    // 市场安装代表用户的版本选择，自动流程不再用随包模板替换它。手动比对允许显式回退。
    const retainedRelease = preserveInstalledRelease && managed && !canonicalContentMatches && (
        (comparableReleases && sourceTime < installedTime && installedContentMatches)
        || installedFromMarket
    );
    let status = 'unchanged';
    if (!targetExists) status = 'missing';
    else if (!managed && legacyMatch) status = 'adopt';
    else if (!managed) status = 'conflict';
    else if (!canonicalContentMatches && !retainedRelease) status = 'update';

    return {
        slug: source.slug,
        name: source.manifest.tool.name || source.slug,
        icon: source.manifest.tool.icon || '🧩',
        description: source.manifest.tool.description || '',
        oldTool,
        newTool,
        toolInfoChanged,
        status,
        fingerprint: source.fingerprint,
        targetExists,
        managed,
        localChanges: managed && !installedContentMatches,
        retainedRelease,
        currentSource: targetManifest?.market ? 'market' : managed ? 'builtin' : 'custom',
        currentVersion: targetManifest?.tool?.updatedAt || targetManifest?.market?.releaseVersion || null,
        bundledVersion: source.manifest.tool.updatedAt || null,
        legacyMatch,
        metadataChanged,
        fingerprintMigrated: managed && storedFingerprintChanged && canonicalContentMatches,
        oldBytes: sumBytes(changes.filter(item => item.type !== 'added').map(item => ({ size: item.oldSize }))),
        newBytes: sumBytes(changes.filter(item => item.type !== 'removed' && item.type !== 'preserved').map(item => ({ size: item.newSize }))),
        counts,
        changes
    };
}

function removeEmptyParents(startPath, stopDir) {
    let current = path.dirname(startPath);
    const stop = path.resolve(stopDir);
    while (path.resolve(current).startsWith(`${stop}${path.sep}`)) {
        try {
            if (fs.readdirSync(current).length) return;
            fs.rmdirSync(current);
        } catch (_) {
            return;
        }
        current = path.dirname(current);
    }
}

function copyManagedTool(source, targetDir, existingManifest, { backupBatchDir, onProgress = () => {} } = {}) {
    const slug = source.slug;
    const targetToolDir = path.join(targetDir, slug);
    const nonce = `${process.pid}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const stagingDir = path.join(targetDir, `.builtin-${slug}-${nonce}.tmp`);
    const backupDir = path.join(targetDir, `.builtin-${slug}-${nonce}.bak`);
    const targetExists = fs.existsSync(targetToolDir);

    fs.mkdirSync(stagingDir, { recursive: true });
    try {
        onProgress({ stage: 'backing_up', slug });
        if (targetExists) fs.cpSync(targetToolDir, stagingDir, { recursive: true, force: true });

        const previousFiles = existingManifest
            && existingManifest.system
            && Array.isArray(existingManifest.system.files)
            ? existingManifest.system.files
            : [];
        const nextFiles = new Set(source.managedFiles);
        for (const relativePath of previousFiles) {
            if (nextFiles.has(relativePath)) continue;
            const obsoletePath = path.join(stagingDir, relativePath);
            if (fs.existsSync(obsoletePath) && fs.statSync(obsoletePath).isFile()) {
                fs.rmSync(obsoletePath, { force: true });
                removeEmptyParents(obsoletePath, stagingDir);
            }
        }

        let filesCompleted = 0;
        onProgress({ stage: 'copying', slug, filesCompleted, filesTotal: source.managedFiles.length });
        for (const relativePath of source.managedFiles) {
            const sourcePath = path.join(source.toolDir, relativePath);
            const targetPath = path.join(stagingDir, relativePath);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
            onProgress({ stage: 'copying', slug, filesCompleted: ++filesCompleted, filesTotal: source.managedFiles.length });
        }
        fs.writeFileSync(
            path.join(stagingDir, TOOL_MANIFEST_FILE),
            `${JSON.stringify(buildTargetManifest(source, existingManifest), null, 2)}\n`,
            'utf8'
        );

        if (targetExists) fs.renameSync(targetToolDir, backupDir);
        try {
            fs.renameSync(stagingDir, targetToolDir);
        } catch (error) {
            if (targetExists && fs.existsSync(backupDir) && !fs.existsSync(targetToolDir)) {
                fs.renameSync(backupDir, targetToolDir);
            }
            throw error;
        }
        let persistentBackup = null;
        if (fs.existsSync(backupDir)) {
            if (backupBatchDir) {
                try {
                    fs.mkdirSync(backupBatchDir, { recursive: true });
                    persistentBackup = path.join(backupBatchDir, slug);
                    fs.renameSync(backupDir, persistentBackup);
                } catch (error) {
                    fs.rmSync(targetToolDir, { recursive: true, force: true });
                    if (fs.existsSync(backupDir)) fs.renameSync(backupDir, targetToolDir);
                    throw error;
                }
            } else {
                fs.rmSync(backupDir, { recursive: true, force: true });
            }
        }
        return persistentBackup;
    } catch (error) {
        if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
        if (fs.existsSync(backupDir) && !fs.existsSync(targetToolDir)) {
            fs.renameSync(backupDir, targetToolDir);
        }
        throw error;
    }
}

function previewBuiltinTools({ sourceDir, targetDir, stateFile, includeSkipped = false, preserveInstalledRelease = true, onProgress = () => {} }) {
    const sourcePath = path.resolve(sourceDir);
    const targetPath = path.resolve(targetDir);
    const result = {
        sourceDir: sourcePath,
        targetDir: targetPath,
        samePath: sourcePath === targetPath,
        tools: [],
        pending: [],
        skipped: [],
        unchanged: [],
        invalid: []
    };
    if (result.samePath) return result;

    fs.mkdirSync(targetPath, { recursive: true });
    const decisionState = readDecisionState(stateFile);
    let bundledTools = [];
    try {
        bundledTools = listBundledTools(sourcePath);
    } catch (error) {
        error.message = `读取系统工具失败：${error.message}`;
        throw error;
    }

    const total = bundledTools.length;
    onProgress({ stage: 'listing', current: 0, total });

    let current = 0;
    for (const source of bundledTools) {
        current += 1;
        onProgress({ stage: 'comparing', current, total, slug: source.slug, name: source.name });
        try {
            const comparison = compareBundledTool(source, targetPath, { preserveInstalledRelease });
            const skippedDecision = decisionState.skipped[source.slug];
            comparison.skipped = Boolean(
                skippedDecision
                && skippedDecision.fingerprint === source.fingerprint
            );
            comparison.recommended = comparison.status !== 'conflict' && !comparison.localChanges;
            result.tools.push(comparison);
            if (comparison.status === 'unchanged') result.unchanged.push(comparison.slug);
            else if (comparison.skipped) result.skipped.push(comparison);
            else result.pending.push(comparison);
        } catch (error) {
            result.invalid.push({ slug: source.slug, error: error.message });
        }
    }
    if (!includeSkipped) result.tools = result.pending;
    onProgress({ stage: 'done', current: total, total });
    return result;
}

function applyBuiltinToolDecisions({
    sourceDir,
    targetDir,
    stateFile,
    backupRoot,
    applySlugs = [],
    skipSlugs = [],
    expectedFingerprints = {},
    includePreview = true,
    preserveInstalledRelease = true,
    onProgress = () => {}
}) {
    const sourcePath = path.resolve(sourceDir);
    const targetPath = path.resolve(targetDir);
    if (sourcePath === targetPath) {
        return { samePath: true, installed: [], adopted: [], updated: [], skipped: [], backups: [], invalid: [] };
    }
    const requestedApply = [...new Set(applySlugs.map(normalizeSlug).filter(Boolean))];
    const requestedSkip = [...new Set(skipSlugs.map(normalizeSlug).filter(Boolean))]
        .filter(slug => !requestedApply.includes(slug));
    // Only inspect the requested tools, and reuse each validated source inventory.
    // Full-library scans here used to hash every bundled tool multiple times per update.
    const allRequested = [...requestedApply, ...requestedSkip];
    const sources = new Map();
    const candidates = new Map();
    const total = allRequested.length;
    onProgress({ stage: 'validating', completed: 0, total, checked: 0 });
    for (const slug of allRequested) {
        const source = validateBundledTool(sourcePath, slug);
        sources.set(slug, source);
        const candidate = compareBundledTool(source, targetPath, { preserveInstalledRelease });
        if (candidate.status !== 'unchanged') candidates.set(slug, candidate);
        onProgress({ stage: 'validating', slug, completed: 0, total, checked: sources.size });
    }
    const decisionState = readDecisionState(stateFile);
    const result = {
        samePath: false,
        installed: [],
        adopted: [],
        updated: [],
        skipped: [],
        backups: [],
        invalid: []
    };
    for (const slug of allRequested) {
        const candidate = candidates.get(slug);
        if (!candidate) throw Object.assign(new Error(`系统工具 ${slug} 当前没有待处理差异，请重新比对`), { status: 409 });
        const expected = expectedFingerprints && expectedFingerprints[slug];
        if (!expected) {
            const error = new Error(`系统工具 ${slug} 缺少比对版本标识，请重新查看比对结果`);
            error.status = 400;
            throw error;
        }
        if (expected !== candidate.fingerprint) {
            const error = new Error(`系统工具 ${slug} 已发生变化，请重新查看比对结果`);
            error.status = 409;
            throw error;
        }
    }

    const timestamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const backupBatchDir = backupRoot ? path.join(path.resolve(backupRoot), timestamp) : null;
    let completed = 0;
    for (const slug of requestedApply) {
        const candidate = candidates.get(slug);
        const source = sources.get(slug);
        const targetManifest = readJson(path.join(targetPath, slug, TOOL_MANIFEST_FILE));
        try {
            const backupPath = copyManagedTool(source, targetPath, targetManifest, {
                backupBatchDir,
                onProgress: event => onProgress({ ...event, completed, total })
            });
            if (backupPath) result.backups.push({ slug, path: backupPath });
            if (candidate.status === 'missing') result.installed.push(slug);
            else if (candidate.status === 'adopt') result.adopted.push(slug);
            else result.updated.push(slug);
            delete decisionState.skipped[slug];
        } catch (error) {
            result.invalid.push({ slug, error: error.message });
        }
        onProgress({ stage: 'tool_complete', slug, completed: ++completed, total });
    }
    for (const slug of requestedSkip) {
        const candidate = candidates.get(slug);
        decisionState.skipped[slug] = {
            fingerprint: candidate.fingerprint,
            skippedAt: new Date().toISOString()
        };
        result.skipped.push(slug);
        onProgress({ stage: 'tool_complete', slug, completed: ++completed, total });
    }
    onProgress({ stage: 'saving', completed, total });
    writeDecisionState(stateFile, decisionState);
    if (includePreview) result.preview = previewBuiltinTools({
        sourceDir: sourcePath,
        targetDir: targetPath,
        stateFile,
        preserveInstalledRelease
    });
    return result;
}

function syncBuiltinTools({ sourceDir, targetDir, backupRoot }) {
    const preview = previewBuiltinTools({ sourceDir, targetDir, includeSkipped: true });
    if (preview.samePath) {
        return { samePath: true, installed: [], adopted: [], updated: [], unchanged: [], conflicts: [], invalid: [] };
    }
    const safeTools = preview.tools.filter(tool => tool.status !== 'unchanged' && tool.status !== 'conflict');
    const result = applyBuiltinToolDecisions({
        sourceDir,
        targetDir,
        backupRoot,
        applySlugs: safeTools.map(tool => tool.slug),
        expectedFingerprints: Object.fromEntries(safeTools.map(tool => [tool.slug, tool.fingerprint]))
    });
    return {
        ...result,
        unchanged: preview.unchanged,
        conflicts: preview.tools.filter(tool => tool.status === 'conflict').map(tool => tool.slug)
    };
}

function initializeBuiltinTools({ sourceDir, targetDir, stateFile, backupRoot, logger = console }) {
    const preview = previewBuiltinTools({
        sourceDir,
        targetDir,
        stateFile,
        includeSkipped: true
    });
    if (preview.samePath) {
        return { samePath: true, installed: [], adopted: [], updated: [], skipped: [], backups: [], invalid: [], pending: [] };
    }
    const safeTools = preview.tools.filter(tool => tool.status === 'missing' || tool.status === 'adopt'
        || (tool.status === 'update' && !tool.localChanges && !tool.skipped && Boolean(backupRoot)));
    const result = applyBuiltinToolDecisions({
        sourceDir,
        targetDir,
        stateFile,
        backupRoot,
        applySlugs: safeTools.map(tool => tool.slug),
        expectedFingerprints: Object.fromEntries(safeTools.map(tool => [tool.slug, tool.fingerprint])),
        includePreview: false
    });
    const applied = new Set([...result.installed, ...result.adopted, ...result.updated]);
    result.pending = preview.tools
        .filter(tool => !applied.has(tool.slug) && !tool.skipped && (tool.status === 'update' || tool.status === 'conflict'))
        .map(tool => tool.slug);
    result.invalid.push(...preview.invalid);
    logger.log(`[custom-tools] 内置工具自动同步：已安装 ${result.installed.length}，已更新 ${result.updated.length}，已登记 ${result.adopted.length}，待确认 ${result.pending.length}；实际生效目录：${path.resolve(targetDir)}`);
    for (const tool of preview.tools) {
        if (applied.has(tool.slug)) {
            const action = result.installed.includes(tool.slug) ? '安装' : result.adopted.includes(tool.slug) ? '登记' : '更新';
            const counts = tool.counts;
            logger.log(`[custom-tools] 已${action} ${tool.name} (${tool.slug})：新增 ${counts.added}，修改 ${counts.modified}，移除 ${counts.removed}，保留用户文件 ${counts.preserved}；生效目录：${path.join(targetDir, tool.slug)}`);
        } else if (tool.retainedRelease) {
            logger.log(`[custom-tools] 保留已安装版本 ${tool.name} (${tool.slug})：保留用户选择的市场版本或较新版本；不回退、不重复提示，可在内置比对中手动替换。`);
        } else if (tool.status !== 'unchanged') {
            const reason = tool.skipped ? '管理员已选择跳过此版本' : tool.status === 'conflict' ? '同名自定义工具，未自动覆盖' : tool.localChanges ? '本地内容已修改或旧版校验信息不完整，待管理员确认' : '更新未完成';
            logger.warn(`[custom-tools] 未自动更新 ${tool.name} (${tool.slug})：${reason}。`);
        }
    }
    for (const backup of result.backups) logger.log(`[custom-tools] 更新前备份 ${backup.slug}：${backup.path}`);
    for (const failure of result.invalid) logger.warn(`[custom-tools] 自动同步失败 ${failure.slug}：${failure.error}`);
    return result;
}

module.exports = {
    DECISION_STATE_VERSION,
    SYSTEM_MARKER,
    TOOL_MANIFEST_FILE,
    applyBuiltinToolDecisions,
    compareBundledTool,
    validateBundledTool,
    initializeBuiltinTools,
    listBundledTools,
    previewBuiltinTools,
    syncBuiltinTools
};
