'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./quota-common');

function desktopDirectory(home, platform) {
    return platform === 'darwin' ? path.join(home,'Library','Application Support','Claude') :
        platform === 'win32' ? path.join(process.env.APPDATA || path.join(home,'AppData','Roaming'),'Claude') : null;
}
function readConfig(dir) {
    try {
        const file = path.join(dir,'config.json');
        return fs.statSync(file).size < 1024 * 1024 ? JSON.parse(fs.readFileSync(file,'utf8')) : {};
    } catch (_) { return {}; }
}
function environmentValue(output, key) {
    return new RegExp('(?:^|\\s)'+key+'=([^\\s]+)').exec(output)?.[1];
}
function selectDesktopEntry(entries, account, now = Date.now()) {
    if (typeof account !== 'string' || !/^[\da-f-]{36}$/i.test(account)) return null;
    return Object.entries(entries || {}).filter(([key,value]) =>
        key.startsWith('acct:'+account+'|') && key.includes(':https://api.anthropic.com:') && key.includes('user:profile') &&
        value && typeof value.token === 'string' && value.token && value.expiresAt > now
    ).sort((a,b)=>b[1].expiresAt-a[1].expiresAt)[0]?.[1] || null;
}
async function readDesktopClaudeCredential(options = {}) {
    const home=options.home || os.homedir(), platform=options.platform || process.platform;
    const dir=options.directory || desktopDirectory(home,platform), execute=options.run || run;
    if (!dir || !fs.existsSync(dir)) return {status:'not_installed'};
    const config=readConfig(dir), account=config.lastKnownAccountUuid;
    if (!account) return {status:'signed_out'};
    if (platform === 'darwin') {
        try {
            // Only inspect Claude Desktop's own bundled Code child processes, for this account.
            // The OS credential stays inside the main process and is sent only to Anthropic.
            const output=await execute('/bin/ps',['-axo','pid=,comm=']);
            const prefix=path.join(dir,'claude-code')+path.sep;
            const processes=output.split('\n').map(line=>/^\s*(\d+)\s+(.+)$/.exec(line)).filter(m=>
                m && m[2].startsWith(prefix) && m[2].endsWith('/claude.app/Contents/MacOS/claude'));
            for (const process of processes.reverse().slice(0,12)) {
                const env=await execute('/bin/ps',['eww','-p',process[1],'-o','command=']);
                if (environmentValue(env,'CLAUDE_CODE_ACCOUNT_UUID') !== account) continue;
                if (environmentValue(env,'ANTHROPIC_BASE_URL') !== 'https://api.anthropic.com') continue;
                const token=environmentValue(env,'CLAUDE_CODE_OAUTH_TOKEN');
                if (token) return {token,status:'ready',source:'desktop',subscriptionType:environmentValue(env,'CLAUDE_CODE_SUBSCRIPTION_TYPE') || null};
            }
        } catch (_) {}
    }
    // Windows Electron safeStorage uses this user's DPAPI. Never copy or alter Claude's store.
    // On macOS decryptString from our application cannot use Claude's separate keychain key.
    if (platform === 'win32') {
        try {
            const decrypt=options.decrypt || require('electron').safeStorage.decryptString;
            for (const key of ['oauth:tokenCacheV2','oauth:tokenCache']) {
                if (typeof config[key] !== 'string') continue;
                const entries=JSON.parse(decrypt(Buffer.from(config[key],'base64')));
                const entry=selectDesktopEntry(entries,account);
                if (entry) return {token:entry.token,status:'ready',source:'desktop',subscriptionType:entry.subscriptionType || null};
            }
        } catch (_) {}
    }
    return {status:'desktop_session_required'};
}
module.exports = { readDesktopClaudeCredential, selectDesktopEntry, environmentValue, desktopDirectory };
