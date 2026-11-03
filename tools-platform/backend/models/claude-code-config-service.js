const fs = require('fs');
const os = require('os');
const path = require('path');
const friendLinksRepo = require('./friend-links-repository');

function makeBackupSuffix(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function readExistingSettings(settingsPath) {
    if (!fs.existsSync(settingsPath)) return {};
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (error) {
        throw new Error(`Claude Code 配置不是有效 JSON，未做修改：${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Claude Code 配置格式无效，未做修改');
    }
    return parsed;
}

function buildClaudeCodeSettings(existing, apiRelay) {
    const config = friendLinksRepo.normalizeApiRelay(apiRelay);
    const existingEnv = existing.env && typeof existing.env === 'object' && !Array.isArray(existing.env)
        ? { ...existing.env }
        : {};
    const useApiKey = apiRelay && apiRelay.anthropicAuthType === 'ANTHROPIC_API_KEY';
    if (useApiKey) {
        delete existingEnv.ANTHROPIC_AUTH_TOKEN;
        existingEnv.ANTHROPIC_API_KEY = config.apiKey;
    } else {
        delete existingEnv.ANTHROPIC_API_KEY;
        existingEnv.ANTHROPIC_AUTH_TOKEN = config.apiKey;
    }
    existingEnv.ANTHROPIC_BASE_URL = config.baseUrl;
    existingEnv.ANTHROPIC_MODEL = config.defaultModel;
    existingEnv.ANTHROPIC_SMALL_FAST_MODEL = config.fastModel;
    return {
        ...existing,
        env: existingEnv
    };
}

function installClaudeCodeConfig(apiRelay, options = {}) {
    const desktopRuntime = options.desktopRuntime !== undefined
        ? Boolean(options.desktopRuntime)
        : process.env.TOOLS_DESKTOP_RUNTIME === '1';
    if (!desktopRuntime) {
        const error = new Error('自动添加仅支持 Dragon Claw 本地 EXE；网页版请使用一键复制');
        error.code = 'DESKTOP_RUNTIME_REQUIRED';
        throw error;
    }

    const homeDir = options.homeDir || os.homedir();
    const claudeDir = path.join(homeDir, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');
    fs.mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
    const existing = readExistingSettings(settingsPath);
    const merged = buildClaudeCodeSettings(existing, apiRelay);
    let backupPath = null;

    if (fs.existsSync(settingsPath)) {
        backupPath = path.join(claudeDir, `settings.backup-${makeBackupSuffix()}.json`);
        fs.copyFileSync(settingsPath, backupPath);
        try { fs.chmodSync(backupPath, 0o600); } catch (_) {}
    }

    const tempPath = path.join(claudeDir, `.settings-${process.pid}-${Date.now()}.tmp`);
    try {
        fs.writeFileSync(tempPath, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tempPath, settingsPath);
        try { fs.chmodSync(settingsPath, 0o600); } catch (_) {}
    } catch (error) {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
        throw error;
    }

    const authKey = (apiRelay && apiRelay.anthropicAuthType === 'ANTHROPIC_API_KEY') ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN';
    return {
        installed: true,
        settingsPath,
        backupPath,
        variables: ['ANTHROPIC_BASE_URL', authKey, 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']
    };
}

module.exports = {
    makeBackupSuffix,
    readExistingSettings,
    buildClaudeCodeSettings,
    installClaudeCodeConfig
};
