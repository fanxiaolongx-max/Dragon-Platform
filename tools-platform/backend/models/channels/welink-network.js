// WeLink 个人身份（welink-cli）只能在华为内网使用：CLI 的开放平台接口 open.inner.welink.huawei.com
// 在外网解析不到。先查 DNS 再连 443，两步都通才算内网；结果短暂缓存，避免每次打开弹窗都等待。
const dns = require('dns');
const net = require('net');

const INTRANET_HOST = 'open.inner.welink.huawei.com';
const PROBE_TIMEOUT_MS = 3000;
const CACHE_OK_MS = 5 * 60 * 1000;
const CACHE_FAIL_MS = 20 * 1000;
const EXTRANET_HINT = 'WeLink 个人身份仅限华为内网使用。当前网络无法访问 WeLink 内网服务，请连接公司内网（或 VPN）后重新检测。';

let cached = null;
let pending = null;
let overrides = {};

function withTimeout(promise, ms, code) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms); })
    ]).finally(() => clearTimeout(timer));
}

function lookup(host) {
    return withTimeout(dns.promises.lookup(host), PROBE_TIMEOUT_MS, 'DNS_TIMEOUT');
}

function connect(address, port = 443) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: address, port });
        const done = error => { socket.destroy(); error ? reject(error) : resolve(); };
        socket.setTimeout(PROBE_TIMEOUT_MS, () => done(Object.assign(new Error('CONNECT_TIMEOUT'), { code: 'CONNECT_TIMEOUT' })));
        socket.once('connect', () => done());
        socket.once('error', done);
    });
}

async function probe() {
    const checkedAt = new Date().toISOString();
    if (process.env.HUAWEI_INTRANET === '1' || process.env.HUAWEI_INTRANET === 'true') {
        return { intranet: true, host: INTRANET_HOST, checkedAt, forced: true };
    }
    if (process.env.HUAWEI_INTRANET === '0' || process.env.HUAWEI_INTRANET === 'false') {
        return { intranet: false, host: INTRANET_HOST, checkedAt, reason: 'FORCED_EXTRANET', hint: EXTRANET_HINT, forced: true };
    }
    try {
        const { address } = await (overrides.lookup || lookup)(INTRANET_HOST);
        await (overrides.connect || connect)(address, 443);
        return { intranet: true, host: INTRANET_HOST, checkedAt };
    } catch (error) {
        return { intranet: false, host: INTRANET_HOST, checkedAt, reason: error.code || error.message, hint: EXTRANET_HINT };
    }
}

/** 返回 { intranet, host, checkedAt, reason?, hint? }；refresh 跳过缓存。 */
async function checkIntranet({ refresh = false } = {}) {
    if (!refresh && cached && Date.now() - cached.at < (cached.result.intranet ? CACHE_OK_MS : CACHE_FAIL_MS)) return cached.result;
    pending ||= probe().then(result => {
        cached = { at: Date.now(), result };
        return result;
    }).finally(() => { pending = null; });
    return pending;
}

/**
 * 判断当前是否由于处于华为内网环境（或显式配置）而禁用微信助理的所有功能。
 * 华为内网下无法访问微信外网服务（https://ilinkai.weixin.qq.com），自动禁用收发消息、长轮询、扫码授权与推送。
 * @returns {Promise<{ disabled: boolean, intranet?: boolean, reason?: string, hint?: string }>}
 */
async function isWeixinDisabled({ refresh = false } = {}) {
    if (typeof overrides.isWeixinDisabled === 'function') {
        return overrides.isWeixinDisabled({ refresh });
    }
    if (process.env.DISABLE_WEIXIN === '1' || process.env.DISABLE_WEIXIN === 'true') {
        return { disabled: true, intranet: false, reason: 'ENV_DISABLED', hint: '微信助理功能已通过环境变量（DISABLE_WEIXIN）禁用。' };
    }
    if (process.env.DISABLE_WEIXIN_ON_INTRANET === '0' || process.env.DISABLE_WEIXIN_ON_INTRANET === 'false') {
        return { disabled: false, intranet: false };
    }
    const net = await checkIntranet({ refresh });
    if (net.intranet) {
        return {
            disabled: true,
            intranet: true,
            reason: 'INTRANET_DISABLED',
            hint: '华为内网环境无法访问微信外网服务（ilinkai.weixin.qq.com），微信助理已自动停用。'
        };
    }
    return { disabled: false, intranet: false };
}

function setOverridesForTest(next = {}) {
    overrides = next;
    cached = null;
    pending = null;
}

module.exports = { INTRANET_HOST, EXTRANET_HINT, checkIntranet, isWeixinDisabled, setOverridesForTest };
