const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { ensureTenantDirs, getDataDir, getReportDataDir, getTenantId } = require('./tenant-context');

const pools = new Map();

function databasePath(filename, scope = 'data') {
    const tenantId = getTenantId();
    ensureTenantDirs(tenantId);
    const root = scope === 'report' ? getReportDataDir(tenantId) : getDataDir(tenantId);
    return path.join(root, filename);
}

function getConnection(filename, scope = 'data') {
    const filePath = databasePath(filename, scope);
    if (!pools.has(filePath)) {
        const connection = new sqlite3.Database(filePath);
        connection.configure('busyTimeout', 5000);
        connection.serialize(() => {
            connection.run('PRAGMA journal_mode = WAL');
            connection.run('PRAGMA busy_timeout = 5000');
            connection.run('PRAGMA foreign_keys = ON');
        });
        pools.set(filePath, connection);
    }
    return pools.get(filePath);
}

function createDatabaseProxy(filename, scope = 'data') {
    return new Proxy({}, {
        get(_target, property) {
            const connection = getConnection(filename, scope);
            const value = connection[property];
            return typeof value === 'function' ? value.bind(connection) : value;
        }
    });
}

// Transactions used by AI database edits must not share a connection with
// unrelated requests. OPEN_READWRITE also prevents accidentally creating a DB.
function openExistingConnection(filename, scope = 'data') {
    return new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(databasePath(filename, scope), sqlite3.OPEN_READWRITE,
            error => error ? reject(error) : resolve(connection));
    });
}

async function closeAll() {
    const connections = [...pools.values()];
    pools.clear();
    await closeConnections(connections);
}

async function closeConnections(connections) {
    await Promise.all(connections.map(connection => new Promise((resolve, reject) => {
        connection.close(error => error && error.code !== 'SQLITE_MISUSE' ? reject(error) : resolve());
    })));
}

async function closeTenant(tenantId) {
    const tenantRoot = path.resolve(getDataDir(tenantId));
    const matching = [...pools.entries()].filter(([filePath]) => {
        const resolved = path.resolve(filePath);
        return resolved === tenantRoot || resolved.startsWith(`${tenantRoot}${path.sep}`);
    });
    matching.forEach(([filePath]) => pools.delete(filePath));
    await closeConnections(matching.map(([, connection]) => connection));
}

module.exports = { closeAll, closeTenant, createDatabaseProxy, databasePath, getConnection, openExistingConnection };
