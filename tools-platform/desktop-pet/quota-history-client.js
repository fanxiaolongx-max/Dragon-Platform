'use strict';
// Only sanitized quota snapshots cross the authenticated loopback boundary.
async function requestHistory(base, token, device, query, quotas) {
    const target = new URL('/api/desktop-pet/quota-history', base);
    if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.protocol !== 'http:') throw new Error('LOCAL_QUOTA_SERVER_REQUIRED');
    const options = {headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(10000)};
    if (quotas) {
        options.method = 'POST'; options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify({device,quotas});
    } else for (const [key,value] of Object.entries({device,...query})) target.searchParams.set(key,String(value));
    const response = await fetch(target,options);
    if (!response.ok) throw new Error('QUOTA_HISTORY_UNAVAILABLE');
    const data = await response.json();
    return data.history;
}
module.exports = {requestHistory};
