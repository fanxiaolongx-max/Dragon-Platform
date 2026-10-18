'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { windowQuota, snapshot, unavailable, membership } = require('./quota-common');

function parseCodexQuota(response, accountPlan = null) {
    const buckets = response?.rateLimitsByLimitId;
    const entries = buckets && Object.keys(buckets).length ? Object.entries(buckets) : [['codex', response?.rateLimits]];
    const groups = entries.filter(([, bucket]) => bucket).map(([id, bucket]) => ({
        id, label:id === 'codex' ? 'Codex' : String(bucket.limitName || id).slice(0,80),
        windows:[bucket.primary, bucket.secondary].filter(Boolean).map(w => windowQuota(
            w.windowDurationMins === 300 ? '5h' : w.windowDurationMins === 10080 ? 'weekly' : 'other',
            typeof w.usedPercent === 'number' && w.usedPercent >= 0 && w.usedPercent <= 100 ? 100 - w.usedPercent : null,
            w.resetsAt, w.windowDurationMins))
    }));
    const value = snapshot('codex', groups);
    value.membership=membership(buckets?.codex?.planType) || membership(response?.rateLimits?.planType) || membership(accountPlan);
    return value.active ? value : unavailable('codex','unsupported');
}
function codexCommandForFile(file, env = process.env, runtime = process.execPath) {
    try {
        if (!fs.statSync(file).isFile()) return null;
        const real = fs.realpathSync(file);
        let nodeScript = /\.(?:[cm]?js)$/i.test(real);
        if (!nodeScript) {
            const fd = fs.openSync(real, 'r');
            try {
                const head = Buffer.alloc(256);
                const size = fs.readSync(fd, head, 0, head.length, 0);
                nodeScript = /^#![^\r\n]*\bnode(?:\s|$)/.test(head.toString('utf8', 0, size).split('\n')[0]);
            } finally { fs.closeSync(fd); }
        }
        // Finder-launched apps have no Homebrew Node in PATH. npm's Codex entry
        // uses /usr/bin/env node, so run it explicitly with Electron's own Node.
        // Keep the canonical script path so npm/pnpm optional packages resolve.
        return nodeScript ? {file:runtime,args:[real],env:{...env,ELECTRON_RUN_AS_NODE:'1'}} : {file,args:[]};
    } catch (_) { return null; }
}
function codexCommand(home = os.homedir(), platform = process.platform, options = {}) {
    const env = options.env || process.env, runtime = options.runtime || process.execPath;
    const onPath = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean).map(dir=>path.join(dir,platform === 'win32' ? 'codex.exe' : 'codex'));
    for (const file of onPath) {
        const command = codexCommandForFile(file,env,runtime);
        if (command) return command;
    }
    const candidates = platform === 'win32' ? [path.join(home,'.local','bin','codex.exe')] : [
        path.join(home,'.local','bin','codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
        '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
        '/Applications/Codex.app/Contents/Resources/codex'
    ];
    for (const file of candidates) {
        const command = codexCommandForFile(file,env,runtime);
        if (command) return command;
    }
    if (platform === 'win32') {
        const roots = [path.join(env.APPDATA || path.join(home,'AppData','Roaming'),'npm','node_modules','@openai','codex'),
            path.join(env.LOCALAPPDATA || path.join(home,'AppData','Local'),'Programs','codex')];
        for (const root of roots) {
            const script = path.join(root,'bin','codex.js');
            const command = codexCommandForFile(script,env,runtime);
            if (command) return command;
        }
    }
    return {file:'codex',args:[]};
}
function readCodexQuota(options = {}) {
    const command = options.command || codexCommand();
    return new Promise(resolve => {
        let child, buffer = '', done = false, stage = 'init', accountPlan = null;
        const timer = setTimeout(() => finish(unavailable('codex')), options.timeout || 12000);
        function finish(value) {
            if (done) return; done = true; clearTimeout(timer);
            if (child) {
                child.stdin?.destroy(); child.kill();
                const killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 500); killTimer.unref();
            }
            resolve(value);
        }
        function send(message) { if (!done) child.stdin.write(JSON.stringify(message)+'\n'); }
        try {
            child = (options.spawn || spawn)(command.file,[...command.args,'app-server','--listen','stdio://'],{
                cwd:os.homedir(), env:command.env || process.env, windowsHide:true, stdio:['pipe','pipe','ignore']
            });
        } catch (_) { finish(unavailable('codex','not_installed')); return; }
        child.on('error', () => finish(unavailable('codex','not_installed')));
        child.on('exit', () => finish(unavailable('codex')));
        child.stdin.on('error', () => finish(unavailable('codex')));
        child.stdout.on('data', data => {
            if (done) return;
            buffer += data.toString();
            if (buffer.length > 1024 * 1024) { finish(unavailable('codex')); return; }
            let index;
            while ((index = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0,index); buffer = buffer.slice(index+1);
                let message; try { message = JSON.parse(line); } catch (_) { continue; }
                if (stage === 'init' && message.id === 1) {
                    if (message.error) { finish(unavailable('codex','unsupported')); return; }
                    stage = 'account'; send({method:'initialized',params:{}}); send({id:3,method:'account/read',params:{refreshToken:false}});
                } else if (stage === 'account' && message.id === 3) {
                    const account = message.result?.account;
                    if (!message.error && !account) { finish(unavailable('codex','signed_out')); return; }
                    if (account?.type === 'apiKey') { finish(unavailable('codex','api_key')); return; }
                    accountPlan = account?.planType || null;
                    stage = 'quota'; send({id:2,method:'account/rateLimits/read',params:{}});
                } else if (stage === 'quota' && message.id === 2) {
                    // Never forward app-server errors: they can include auth diagnostics.
                    finish(message.error ? unavailable('codex',/auth|sign.?in|log.?in|api.?key/i.test(message.error.message || '') ? 'auth_required' : 'unavailable') : parseCodexQuota(message.result, accountPlan)); return;
                }
            }
        });
        send({id:1,method:'initialize',params:{clientInfo:{name:'tools_platform_quota',title:'Tools Platform quota',version:'1.0.0'}}});
    });
}
module.exports = { readCodexQuota, parseCodexQuota, codexCommand, codexCommandForFile };
