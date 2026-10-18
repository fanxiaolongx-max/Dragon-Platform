'use strict';
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');

function run(file, args, options = {}) {
    return new Promise((resolve, reject) => execFile(file, args, {
        timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, ...options
    }, (error, stdout) => error ? reject(Object.assign(new Error('command_failed'), { code:error.code })) : resolve(stdout)));
}
function percent(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 10) / 10 : null;
}
function resetTime(value) {
    if (value == null || value === '') return null;
    const stamp = typeof value === 'number' ? value * 1000 : Date.parse(value);
    return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}
function windowQuota(id, remainingPercent, resetsAt, durationMinutes) {
    return { id, remainingPercent:percent(remainingPercent), resetsAt:resetTime(resetsAt), durationMinutes:durationMinutes || null };
}
function membership(value) {
    if (typeof value !== 'string') return null;
    const raw=value.trim().toLowerCase().replace(/\s+/g,'_');
    const aliases={google_ai_pro:'pro',google_ai_ultra:'ultra',teams_tier_pro:'pro',teams_tier_ultra:'ultra',
        ent26:'enterprise',enterprise_cbp_automation:'enterprise',enterprise_cbp_usage_based:'enterprise',
        self_serve_business_prolite:'business',self_serve_business_usage_based:'business'};
    const tier=Object.prototype.hasOwnProperty.call(aliases,raw) ? aliases[raw] : raw;
    const labels={free:'Free',go:'Go',plus:'Plus',pro:'Pro',prolite:'Pro Lite',max:'Max',ultra:'Ultra',team:'Team',business:'Business',enterprise:'Enterprise',edu:'Edu'};
    return Object.prototype.hasOwnProperty.call(labels,tier) ? {tier,label:labels[tier],premium:tier !== 'free'} : null;
}
function snapshot(provider, groups, now = Date.now()) {
    return { provider, active:groups.some(g => g.windows.some(w => w.remainingPercent !== null)), status:'live', groups, updatedAt:now, checkedAt:now };
}
function unavailable(provider, status = 'unavailable') {
    return { provider, active:false, status, groups:[], updatedAt:null, checkedAt:Date.now() };
}
function requestJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const body = options.body === undefined ? undefined : JSON.stringify(options.body);
        const { body:unused, ...rest } = options;
        const req = (url.startsWith('https:') ? https : http).request(url, {
            timeout:4000, ...rest, headers:{ 'Content-Type':'application/json', ...options.headers }
        }, res => {
            let data = '', size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) req.destroy(new Error('response_too_large')); else data += chunk; });
            res.on('error', () => reject(new Error('network_error')));
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) return reject(Object.assign(new Error('http_error'), { statusCode:res.statusCode }));
                try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('invalid_response')); }
            });
        });
        req.on('error', () => reject(new Error('network_error')));
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end(body);
    });
}
// Reader cache stays in memory. Only sanitized fresh measurements enter SQLite history.
function cachedReader(provider, read, ttl = 60000, now = Date.now) {
    let last = null, checked = 0, pending = null, result = null;
    return function (force = false) {
        if (pending) return pending;
        if (!force && result && now() - checked < ttl) return Promise.resolve(result);
        pending = Promise.resolve().then(read).catch(() => unavailable(provider)).then(value => {
            checked = now();
            if (value.status === 'live' && value.active) last = value;
            else if (last && checked - last.updatedAt < 15 * 60000 && !['api_key','signed_out','not_installed','auth_required','desktop_session_required'].includes(value.status)) {
                value = { ...last, status:'cached', checkedAt:checked, groups:last.groups.map(g => ({ ...g, windows:g.windows.map(w => ({...w,
                    remainingPercent:w.resetsAt && Date.parse(w.resetsAt) <= checked ? null : w.remainingPercent
                })) })) };
            } else last = null;
            result = value; return value;
        }).finally(() => { pending = null; });
        return pending;
    };
}
module.exports = { run, percent, resetTime, windowQuota, snapshot, unavailable, requestJson, cachedReader, membership };
