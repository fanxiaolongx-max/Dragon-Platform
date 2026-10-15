// 桌面版只设置 TOOLS_DATA_DIR：报表库与业务库同目录，platform:report.db 仍指向平台实际使用的库。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-database-desktop-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'userData', 'data');
delete process.env.TOOLS_REPORT_DATA_DIR;
const sqlite3 = require('../backend/node_modules/sqlite3');
const tenant = require('../backend/models/tenant-context');
const service = require('../backend/models/agent-database-service');
const root = path.join(sandbox, 'project');
fs.mkdirSync(root);

async function create(file, sql) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = await new Promise((resolve, reject) => { const connection = new sqlite3.Database(file, error => error ? reject(error) : resolve(connection)); });
    await new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
    await new Promise(resolve => db.close(resolve));
}

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('desktop layout lists report.db once from the shared data directory', async () => {
    assert.equal(tenant.getReportDataDir('default'), tenant.getDataDir('default'));
    const dir = tenant.getDataDir('default');
    await create(path.join(dir, 'report.db'), "CREATE TABLE ReportMetricData (metric_label TEXT, raw_val TEXT); INSERT INTO ReportMetricData VALUES ('整改完成率', '88%');");
    await create(path.join(dir, 'tools.db'), 'CREATE TABLE items (id INTEGER);');
    await tenant.runWithTenant('default', async () => {
        const ids = (await service.listDatabases({ root })).databases.map(item => item.id).sort();
        assert.deepEqual(ids, ['platform:report.db', 'platform:tools.db']);
        for (const id of ['platform:report.db', 'platform:data/report.db', 'platform:report/report.db']) {
            assert.equal((await service.readTable({ root }, { database: id, table: 'ReportMetricData' })).rows[0].raw_val, '88%');
        }
    });
});
