// 团队浏览器的出口代理：公网放行，服务器本机、链路本地与内网地址拒绝（内网可用环境变量放开）。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');

const proxy = require('../backend/models/team-browser-proxy');

test('address policy blocks the server itself, link-local and private networks', () => {
    for (const ip of ['127.0.0.1', '127.8.9.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', '169.254.169.254', 'fe80::1', '224.0.0.1']) {
        assert.ok(proxy.blockedReason(ip), ip);
    }
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', 'fd00::1']) {
        assert.equal(proxy.blockedReason(ip), '内网地址', ip);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111']) assert.equal(proxy.blockedReason(ip), '', ip);

    process.env.TOOLS_TEAM_BROWSER_PRIVATE_NETWORK = 'allow';
    try {
        assert.equal(proxy.blockedReason('10.1.2.3'), '');
        assert.ok(proxy.blockedReason('127.0.0.1'), 'the server itself stays blocked');
        assert.ok(proxy.blockedReason('169.254.169.254'), 'cloud metadata stays blocked');
    } finally { delete process.env.TOOLS_TEAM_BROWSER_PRIVATE_NETWORK; }
});

test('the proxy refuses local targets for plain HTTP and CONNECT', async t => {
    const local = http.createServer((_req, res) => res.end('LOCAL-SECRET'));
    await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
    const proxyUrl = new URL(await proxy.ensure());
    t.after(async () => { await proxy.close(); await new Promise(resolve => local.close(resolve)); });
    const port = local.address().port;

    const viaProxy = target => new Promise((resolve, reject) => {
        const req = http.request({ host: proxyUrl.hostname, port: proxyUrl.port, path: target, headers: { Host: new URL(target).host } }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end();
    });
    for (const target of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, 'http://169.254.169.254/latest/meta-data/']) {
        const result = await viaProxy(target);
        assert.equal(result.status, 403, target);
        assert.doesNotMatch(result.body, /LOCAL-SECRET/);
    }

    const connect = target => new Promise((resolve, reject) => {
        const socket = net.connect(Number(proxyUrl.port), proxyUrl.hostname, () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
        let data = '';
        socket.on('data', chunk => { data += chunk; });
        socket.on('close', () => resolve(data));
        socket.on('error', reject);
    });
    assert.match(await connect(`127.0.0.1:${port}`), /^HTTP\/1\.1 403/);
    assert.match(await connect(`[::1]:${port}`), /^HTTP\/1\.1 403/);
});
