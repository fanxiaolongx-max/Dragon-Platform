'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, requestJson, windowQuota, snapshot, unavailable, membership } = require('./quota-common');
const { readDesktopClaudeCredential } = require('./claude-desktop-quota');

function parseClaudeQuota(data, subscriptionType = null) {
    const windows = [];
    for (const [key, minutes] of [['five_hour',300],['seven_day',10080],['seven_day_opus',10080],['seven_day_sonnet',10080]]) {
        const value = data?.[key];
        if (!value) continue;
        windows.push({...windowQuota(key === 'five_hour' ? '5h' : key === 'seven_day' ? 'weekly' : key,
            typeof value.utilization === 'number' && value.utilization >= 0 && value.utilization <= 100 ? 100-value.utilization : null,
            value.resets_at, minutes), label:key === 'seven_day_opus' ? 'Opus' : key === 'seven_day_sonnet' ? 'Sonnet' : undefined});
    }
    const result = snapshot('claudecode',[{id:'claudecode',label:'Claude Code',windows}]);
    result.membership=membership(subscriptionType || data?.subscription_type);
    return result.active ? result : unavailable('claudecode','unsupported');
}
function claudeCommand(home) {
    const file = path.join(home,'.local','bin',process.platform === 'win32' ? 'claude.exe' : 'claude');
    return fs.existsSync(file) ? file : 'claude';
}
async function readClaudeQuota(options = {}) {
    const home = options.home || os.homedir(), platform = options.platform || process.platform;
    const execute = options.run || run, request = options.requestJson || requestJson;
    const configDir = options.configDir || process.env.CLAUDE_CONFIG_DIR || path.join(home,'.claude');
    const desktop = await (options.readDesktop || readDesktopClaudeCredential)({home,platform,run:execute});
    let auth = null;
    if (!desktop.token) {
        try { auth = JSON.parse(await execute(claudeCommand(home),['auth','status','--json'])); } catch (_) {}
    }
    if (!desktop.token && desktop.status !== 'not_installed') return unavailable('claudecode',desktop.status);
    if (!desktop.token && auth?.authMethod === 'api_key') return unavailable('claudecode','api_key');
    if (!desktop.token && auth?.loggedIn === false) return unavailable('claudecode','signed_out');
    let subscriptionType=desktop.subscriptionType || auth?.subscriptionType || null;
    let token = desktop.token || options.token || process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!token) {
        try {
            const file = path.join(configDir,'.credentials.json');
            if (fs.statSync(file).size < 256 * 1024) {
                const oauth = JSON.parse(fs.readFileSync(file,'utf8'))?.claudeAiOauth;
                token = oauth?.accessToken; subscriptionType ||= oauth?.subscriptionType || null;
            }
        } catch (_) {}
    }
    if (!token && platform === 'darwin') {
        // Claude Code's credential store; stdout stays inside this main-process function.
        try {
            const suffix = configDir !== path.join(home,'.claude') ? '-' + require('crypto').createHash('sha256').update(configDir).digest('hex').slice(0,8) : '';
            const stored = JSON.parse(await execute('/usr/bin/security',['find-generic-password','-s','Claude Code-credentials'+suffix,'-w'],{timeout:3000}));
            token = stored?.claudeAiOauth?.accessToken;
            subscriptionType ||= stored?.claudeAiOauth?.subscriptionType || null;
        } catch (_) {}
    }
    if (typeof token !== 'string' || !token) return unavailable('claudecode',auth?.loggedIn ? 'auth_required' : 'signed_out');
    try {
        const result = await request('https://api.anthropic.com/api/oauth/usage',{
            headers:{Authorization:'Bearer '+token,'anthropic-beta':'oauth-2025-04-20'}
        });
        const quota = parseClaudeQuota(result, subscriptionType);
        quota.source = desktop.token ? 'desktop' : 'cli';
        quota.groups.forEach(group => { group.label = desktop.token ? 'Claude Code Desktop' : 'Claude Code CLI'; });
        return quota;
    } catch (error) {
        return unavailable('claudecode',[401,403].includes(error.statusCode) ? 'auth_required' : error.statusCode === 429 ? 'rate_limited' : 'unavailable');
    }
}
module.exports = { readClaudeQuota, parseClaudeQuota };
