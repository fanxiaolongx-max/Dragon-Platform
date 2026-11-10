// 团队账号浏览器的出口代理：团队的 Chrome 只能经这里上网（--proxy-server），由平台决定能连到哪里。
// 目标域名在这里解析并直接连到解析出的地址（页面无法用 DNS 重绑定绕过），以下地址一律拒绝：
// - 服务器本机（回环地址、本机各网卡地址）与链路本地地址（含云厂商元数据 169.254.169.254）；
// - 内网地址（10/8、172.16/12、192.168/16、100.64/10、fc00::/7）——团队需要访问内网业务系统时，
//   设置环境变量 TOOLS_TEAM_BROWSER_PRIVATE_NETWORK=allow 放开（本机与链路本地仍然拒绝）。
const dns = require('dns');
const http = require('http');
const net = require('net');
const os = require('os');

let listening = null;

function ipv4Number(ip) {
    return ip.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}
const inV4 = (ip, base, bits) => (ipv4Number(ip) >>> (32 - bits)) === (ipv4Number(base) >>> (32 - bits));

function localAddresses() {
    return new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item => item.address.toLowerCase().split('%')[0]));
}

/** 返回拒绝原因；允许访问时返回空串 */
function blockedReason(address) {
    let ip = String(address || '').toLowerCase().split('%')[0];
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) ip = mapped[1];
    const allowPrivate = String(process.env.TOOLS_TEAM_BROWSER_PRIVATE_NETWORK || '').toLowerCase() === 'allow';
    if (localAddresses().has(ip)) return '服务器本机地址';
    if (net.isIPv4(ip)) {
        if (inV4(ip, '127.0.0.0', 8) || inV4(ip, '0.0.0.0', 8)) return '服务器本机地址';
        if (inV4(ip, '169.254.0.0', 16)) return '链路本地地址';
        if (ipv4Number(ip) >= ipv4Number('224.0.0.0')) return '组播或保留地址';
        if (!allowPrivate && (inV4(ip, '10.0.0.0', 8) || inV4(ip, '172.16.0.0', 12) || inV4(ip, '192.168.0.0', 16) || inV4(ip, '100.64.0.0', 10))) return '内网地址';
        return '';
    }
    if (net.isIPv6(ip)) {
        if (ip === '::1' || ip === '::') return '服务器本机地址';
        if (/^fe[89ab]/.test(ip)) return '链路本地地址';
        if (/^ff/.test(ip)) return '组播地址';
        if (!allowPrivate && /^f[cd]/.test(ip)) return '内网地址';
        return '';
    }
    return '无法识别的地址';
}

async function resolveAllowed(hostname) {
    const host = String(hostname || '').replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true, verbatim: true });
    if (!addresses.length) throw Object.assign(new Error('域名没有解析结果'), { statusCode: 502 });
    // 任何一个解析结果落在受限范围就整体拒绝，避免同一域名混着内外网地址
    for (const item of addresses) {
        const reason = blockedReason(item.address);
        if (reason) throw Object.assign(new Error(`团队浏览器不能访问${reason}（${host}）`), { statusCode: 403 });
    }
    return addresses[0].address;
}

function refuse(socket, error) {
    const status = error.statusCode === 403 ? '403 Forbidden' : '502 Bad Gateway';
    const body = `${error.message || '无法连接'}\n`;
    socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

function createProxy() {
    const server = http.createServer(async (req, res) => {
        // 明文 HTTP：Chrome 发来绝对地址
        let target;
        try { target = new URL(req.url); } catch (_error) { target = null; }
        if (!target || target.protocol !== 'http:') { res.writeHead(400).end(); return; }
        try {
            const address = await resolveAllowed(target.hostname);
            const headers = { ...req.headers };
            for (const name of ['proxy-connection', 'proxy-authorization']) delete headers[name];
            const upstream = http.request({ host: address, port: target.port || 80, method: req.method, path: `${target.pathname}${target.search}`, headers }, response => {
                res.writeHead(response.statusCode, response.headers);
                response.pipe(res);
            });
            upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
            req.pipe(upstream);
        } catch (error) {
            res.writeHead(error.statusCode === 403 ? 403 : 502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`${error.message || '无法连接'}\n`);
        }
    });
    // HTTPS / WebSocket：CONNECT 隧道
    server.on('connect', async (req, socket, head) => {
        socket.on('error', () => {});
        const match = String(req.url || '').match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
        if (!match) return refuse(socket, { message: '无效的目标' });
        try {
            const address = await resolveAllowed(match[1]);
            const upstream = net.connect({ host: address, port: Number(match[2]) }, () => {
                socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head?.length) upstream.write(head);
                upstream.pipe(socket);
                socket.pipe(upstream);
            });
            upstream.on('error', () => socket.destroy());
            socket.on('close', () => upstream.destroy());
        } catch (error) { refuse(socket, error); }
    });
    server.on('clientError', (_error, socket) => socket.destroy());
    return server;
}

/** 启动（进程内只起一个），返回 http://127.0.0.1:端口 */
function ensure() {
    if (!listening) {
        listening = new Promise((resolve, reject) => {
            const server = createProxy();
            server.once('error', error => { listening = null; reject(error); });
            server.listen(0, '127.0.0.1', () => { server.unref(); resolve({ server, url: `http://127.0.0.1:${server.address().port}` }); });
        });
    }
    return listening.then(item => item.url);
}

async function close() {
    const current = listening;
    listening = null;
    if (current) await current.then(item => new Promise(resolve => { item.server.closeAllConnections?.(); item.server.close(resolve); })).catch(() => {});
}

module.exports = { blockedReason, close, ensure, resolveAllowed };
