'use strict';
const { run, requestJson, windowQuota, snapshot, unavailable, membership } = require('./quota-common');

function parseAntigravityQuota(data, details) {
    const response = data?.response || data;
    const groups = (Array.isArray(response?.groups) ? response.groups : []).map((group,index) => {
        const name = String(group.displayName || 'Model group').slice(0,80);
        const id = /gemini/i.test(name) ? 'gemini' : /claude|gpt/i.test(name) ? 'third-party' : 'group-'+index;
        return {id,label:name,windows:(Array.isArray(group.buckets) ? group.buckets : []).map(bucket => windowQuota(
            bucket.window === '5h' ? '5h' : bucket.window === 'weekly' ? 'weekly' : String(bucket.window || 'other').slice(0,30),
            typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction*100 : null,
            bucket.resetTime, bucket.window === '5h' ? 300 : bucket.window === 'weekly' ? 10080 : null))};
    });
    const value = snapshot('antigravity',groups);
    const user = details?.userStatus || details?.response?.userStatus;
    const plan = user?.planStatus?.planInfo;
    value.membership=membership(plan?.planName || plan?.teamsTier);
    const credits = user?.userTier?.availableCredits;
    if (Array.isArray(credits)) {
        const amount = credits.find(credit => credit?.creditType === 'GOOGLE_ONE_AI' || credit?.creditType === 1)?.creditAmount;
        const balance = typeof amount === 'string' && /^\d+$/.test(amount) ? Number(amount) : amount;
        if (Number.isSafeInteger(balance) && balance > 0) {
            value.creditsBalance = balance;
            value.active = true;
        }
    }
    if (!value.active) return unavailable('antigravity','unsupported');
    // Compatibility with the pre-existing desktop renderer. Missing values stay null.
    for (const [id,prefix] of [['gemini','gemini'],['third-party','claude']]) {
        const group = groups.find(g=>g.id===id);
        for (const [windowId,key] of [['5h','5h'],['weekly','Weekly']]) {
            const w = group?.windows.find(w=>w.id===windowId);
            value[prefix+key] = w?.remainingPercent ?? null;
            value[prefix+key+'Reset'] = w?.resetsAt || '';
        }
    }
    return value;
}
function parseProcesses(output, platform) {
    const rows = platform === 'win32' ? JSON.parse(output || '[]') : output.split('\n').map(line => {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line); return match ? {ProcessId:Number(match[1]),CommandLine:match[2]} : null;
    }).filter(Boolean);
    return (Array.isArray(rows) ? rows : [rows]).filter(row => /(?:antigravity|language_server)/i.test(row.CommandLine || '') && /language_server/i.test(row.CommandLine || '')).map(row => {
        const text = row.CommandLine;
        const flag = name => new RegExp('--'+name+'(?:=|\\s+)(?:"([^"\\r\\n]+)"|([^\\s]+))').exec(text);
        const csrf = flag('csrf_token'), port = flag('https_server_port');
        const envEligible = platform === 'darwin' && /^["']?(?:\/Applications|\/Users\/[^/\s]+\/Applications)\/Antigravity\.app\/Contents\/Resources\/bin\/language_server(?:\s|["']|$)/.test(text);
        return {pid:Number(row.ProcessId),csrf:csrf?.[1] || csrf?.[2],port:Number(port?.[1] || port?.[2]),envEligible};
    }).filter(row => Number.isInteger(row.pid) && row.pid > 0 && (row.csrf || row.envEligible));
}
function createAntigravityReader(options = {}) {
    const platform = options.platform || process.platform, execute = options.run || run, request = options.requestJson || requestJson;
    let cached = null;
    async function fetchAt(endpoint) {
        // Discovery can only ever produce a loopback URL. Never send this CSRF credential remotely.
        const data = await request('https://127.0.0.1:'+endpoint.port+'/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',{
            method:'POST',body:{},rejectUnauthorized:false,
            headers:{'Connect-Protocol-Version':'1','x-codeium-csrf-token':endpoint.csrf}
        });
        let details=null;
        try {
            details=await request('https://127.0.0.1:'+endpoint.port+'/exa.language_server_pb.LanguageServerService/GetUserStatus',{
                method:'POST',body:{},rejectUnauthorized:false,
                headers:{'Connect-Protocol-Version':'1','x-codeium-csrf-token':endpoint.csrf}
            });
        } catch (_) { /* Quota is still available if membership and credits cannot be read. */ }
        const result = parseAntigravityQuota(data, details);
        if (!result.active) throw new Error('unsupported');
        return result;
    }
    return async function read() {
        if (cached) { try { return await fetchAt(cached); } catch (_) { cached = null; } }
        let processes;
        try {
            const output = platform === 'win32' ? await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',
                'Get-CimInstance Win32_Process -Filter "Name LIKE \'language_server%\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress']) :
                await execute('/bin/ps',['-axo','pid=,args=']);
            processes = parseProcesses(output,platform);
        } catch (_) { return unavailable('antigravity'); }
        for (const process of processes) {
            let csrf = process.csrf;
            if (!csrf && process.envEligible) {
                try {
                    const output = await execute('/bin/ps',['eww','-p',String(process.pid),'-o','command=']);
                    csrf = /(?:^|\s)ANTIGRAVITY_SERVER_CSRF_TOKEN=([^\s]+)/.exec(output)?.[1];
                } catch (_) { continue; }
            }
            if (!csrf) continue;
            let ports = process.port > 0 && process.port <= 65535 ? [process.port] : [];
            if (!ports.length) {
                try {
                    const output = platform === 'win32' ? await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',
                        'Get-NetTCPConnection -State Listen -OwningProcess '+process.pid+' | Select-Object -ExpandProperty LocalPort | ConvertTo-Json -Compress']) :
                        await execute('/usr/sbin/lsof',['-a','-p',String(process.pid),'-iTCP','-sTCP:LISTEN','-Fn']);
                    ports = platform === 'win32' ? [].concat(JSON.parse(output || '[]')) : [...output.matchAll(/^n.*:(\d+)$/gm)].map(m=>Number(m[1]));
                } catch (_) { continue; }
            }
            for (const port of [...new Set(ports)].filter(p=>Number.isInteger(p)&&p>0&&p<=65535)) {
                const endpoint = {port,csrf};
                try { const result = await fetchAt(endpoint); cached = endpoint; return result; } catch (_) {}
            }
        }
        return unavailable('antigravity',processes.length ? 'unavailable' : 'offline');
    };
}
module.exports = { createAntigravityReader, parseAntigravityQuota, parseProcesses };
