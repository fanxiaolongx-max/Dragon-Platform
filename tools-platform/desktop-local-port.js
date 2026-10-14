// 桌面版本地服务端口：优先复用上次的端口，其次默认端口，最后由系统分配。
// 浏览器按「协议 + 主机 + 端口」区分站点，端口一变，本地保存的登录信息与会话都会丢失，
// 所以端口要尽量稳定；记录写在用户数据目录，升级覆盖安装不受影响。
const fs = require('fs');
const net = require('net');
const path = require('path');

const DEFAULT_PORT = 3030;

function isValidPort(value) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

function readPreferredPort(statePath) {
    try {
        return isValidPort(JSON.parse(fs.readFileSync(statePath, 'utf8')).port);
    } catch (_) {
        return null;
    }
}

function writePreferredPort(statePath, port) {
    if (!isValidPort(port)) return false;
    try {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        const temp = `${statePath}.${process.pid}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify({ port, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
        fs.renameSync(temp, statePath);
        return true;
    } catch (_) {
        return false;
    }
}

// 与内置服务相同的监听方式（不指定主机）试占端口；占用中返回 null，其他错误照常抛出。
function probePort(port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(null);
            else reject(err);
        });
        server.listen(port, () => {
            const actual = server.address().port;
            server.close(() => resolve(actual));
        });
    });
}

async function chooseLocalPort({ statePath, defaultPort = DEFAULT_PORT, probe = probePort } = {}) {
    const preferred = statePath ? readPreferredPort(statePath) : null;
    const candidates = [...new Set([preferred, isValidPort(defaultPort)].filter(Boolean))];
    for (const candidate of candidates) {
        const port = await probe(candidate);
        if (port) return { port, source: candidate === preferred ? 'previous' : 'default' };
    }
    const port = await probe(0);
    if (!port) throw new Error('无法分配本地服务端口');
    return { port, source: 'random' };
}

module.exports = { DEFAULT_PORT, chooseLocalPort, probePort, readPreferredPort, writePreferredPort };
