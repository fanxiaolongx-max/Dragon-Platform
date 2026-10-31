const { openExistingConnection } = require('./tenant-sqlite-pool');

// An exclusive transaction connection prevents unrelated requests from joining a gallery mutation.
module.exports = async function transaction(work) {
    const connection = await openExistingConnection('tools.db');
    connection.configure('busyTimeout', 5000);
    const execute = (sql, values = []) => new Promise((resolve, reject) => connection.run(sql, values, function(error) { error ? reject(error) : resolve(this.changes); }));
    const all = (sql, values = []) => new Promise((resolve, reject) => connection.all(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
    const get = async (sql, values) => (await all(sql, values))[0];
    try { await execute('BEGIN IMMEDIATE'); const result = await work({ execute, all, get }); await execute('COMMIT'); return result; }
    catch (error) { await execute('ROLLBACK').catch(() => {}); throw error; }
    finally { await new Promise(resolve => connection.close(resolve)); }
};
