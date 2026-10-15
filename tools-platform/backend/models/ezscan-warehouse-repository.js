const fs = require('fs');
const os = require('os');
const path = require('path');
const tenantPool = require('./tenant-sqlite-pool');
const { getDataDir } = require('./tenant-context');
const domain = require('../../frontend/js/ezscan-warehouse-domain');

const DB_FILENAME = 'ezscan-warehouse.db';
const MAX_STATE_BYTES = 20 * 1024 * 1024;
const ARRAY_KEYS = ['products', 'warehouses', 'partners', 'opening', 'docs', 'scans', 'receivables', 'payables', 'workflows', 'roles', 'logs'];
const ID_KEYS = ['products', 'warehouses', 'partners', 'docs', 'scans', 'receivables', 'payables', 'workflows', 'roles'];
const INBOUND = ['其他入库单', '采购入库单', '生产入库单', '退货入库单', '盘盈入库单', '采购收货单'];
const OUTBOUND = ['其他出库单', '领料出库单', '销售发货单'];
const ORDERS = ['采购订单', '销售订单'];
const DOCUMENT_TYPES = [...INBOUND, ...OUTBOUND, ...ORDERS, '库存调拨单', '形态转换单', '盘点单'];
const MODULES = new Set(['首页', '业务流程图', '总货品库存', '出入明细清单', '月度出入库统计', '货品档案', '仓库设置', '往来单位', ...DOCUMENT_TYPES, '条码标签打印', 'PDA扫码记录', '应收账款', '应付账款', '流程设计器', '角色注册']);
const readiness = new WeakMap();

function warehouseError(message, status = 400, code = 'WAREHOUSE_INVALID_STATE') {
    return Object.assign(new Error(message), { status, code });
}

function invalid(message) {
    throw warehouseError(`仓储数据不合法：${message}`);
}

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 10000) => typeof value === 'string' && value.length <= max;
const finite = (value, minimum = 0) => typeof value === 'number' && Number.isFinite(value) && value >= minimum;
const draftNumber = value => value === '' || (typeof value === 'number' && Number.isFinite(value));
const timestamp = value => typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value));

function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validateRevision(revision) {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
        throw warehouseError('缺少有效的服务器数据版本，请刷新后重试', 400, 'WAREHOUSE_INVALID_REVISION');
    }
    return revision;
}

function validateJson(value, depth = 0, seen = new WeakSet()) {
    if (depth > 30) invalid('数据嵌套过深');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) invalid('包含非有限数值');
        return;
    }
    if (typeof value !== 'object' || seen.has(value)) invalid('包含非 JSON 数据或循环引用');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid('包含非 JSON 对象');
    seen.add(value);
    for (const item of Object.values(value)) validateJson(item, depth + 1, seen);
    seen.delete(value);
}

// Keep schema 3 drafts, UI preferences and extension fields intact. Business
// references and quantities are validated before the document reaches SQLite.
function validateState(data) {
    if (!object(data) || data.schema !== 3) invalid('仅支持版本 3 的完整仓储数据');
    validateJson(data);
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
        throw warehouseError('仓储数据超过 20 MB', 413, 'WAREHOUSE_STATE_TOO_LARGE');
    }
    for (const key of ARRAY_KEYS) {
        if (!Array.isArray(data[key]) || data[key].length > 50000) invalid(`${key} 不是有效数组或超出限制`);
        if (data[key].some(row => !object(row))) invalid(`${key} 包含无效记录`);
    }
    if (!object(data.ui) || !Array.isArray(data.ui.tabs) || !object(data.settings) || typeof data.settings.compact !== 'boolean') invalid('缺少界面配置');
    if (data.ui.tabs.length > 50 || data.ui.tabs.some(name => !MODULES.has(name)) || new Set(data.ui.tabs).size !== data.ui.tabs.length) invalid('标签页配置无效');
    const ids = {};
    for (const key of ID_KEYS) {
        ids[key] = new Set();
        const codes = new Set();
        for (const row of data[key]) {
            if (!text(row.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(row.id) || ids[key].has(row.id)) invalid(`${key} ID 重复、缺失或包含不安全字符`);
            ids[key].add(row.id);
            if (row.code && key !== 'scans') {
                if (!text(row.code, 100) || codes.has(row.code)) invalid(`${key} 编码重复或无效`);
                codes.add(row.code);
            }
        }
    }
    for (const row of data.products) {
        if (!text(row.code, 100) || !text(row.name, 200) || !text(row.spec) || !text(row.unit, 50) || !text(row.category) || !finite(row.price) || !finite(row.min)) invalid('货品字段错误');
    }
    for (const row of data.warehouses) {
        if (!text(row.code, 100) || !text(row.name, 200) || !['启用', '停用'].includes(row.enabled)) invalid('仓库字段错误');
    }
    for (const row of data.partners) {
        if (!text(row.name, 200) || !['供应商', '客户', '供应商/客户'].includes(row.type)) invalid('往来单位字段错误');
    }
    const openingKeys = new Set();
    const stock = new Map();
    function addStock(product, warehouse, qty) {
        const key = JSON.stringify([product, warehouse]);
        const next = (stock.get(key) || 0) + qty;
        if (!Number.isFinite(next)) invalid('库存计算超出数值范围');
        stock.set(key, next);
    }
    for (const row of data.opening) {
        const key = JSON.stringify([row.product, row.warehouse]);
        if (!ids.products.has(row.product) || !ids.warehouses.has(row.warehouse) || !finite(row.qty) || openingKeys.has(key)) invalid('期初库存引用或数量错误');
        openingKeys.add(key);
        addStock(row.product, row.warehouse, row.qty);
    }
    const documentNumbers = new Set();
    for (const row of data.docs) {
        const draft = row.status === '草稿';
        if (!DOCUMENT_TYPES.includes(row.type) || !text(row.no, 100) || documentNumbers.has(row.no)
            || (draft ? !text(row.date, 10) || row.date !== '' && !validDate(row.date) : !validDate(row.date))
            || !ids.warehouses.has(row.warehouse) || !['草稿', '已提交', '已审核'].includes(row.status)
            || !text(row.operator, 100) || !Array.isArray(row.lines) || row.lines.length > 3000
            || !timestamp(row.created) || !timestamp(row.updated)) invalid('单据字段或编号错误');
        documentNumbers.add(row.no);
        if (row.partner && !ids.partners.has(row.partner)) invalid('单据往来单位不存在');
        if (row.target && !ids.warehouses.has(row.target)) invalid('目标仓库不存在');
        if (row.sourceId && !ids.docs.has(row.sourceId)) invalid('来源订单不存在');
        if (!draft && row.lines.length === 0) invalid('提交或审核单据缺少明细');
        const lineIds = new Set();
        const countProducts = new Set();
        for (const line of row.lines) {
            if (!object(line) || !text(line.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(line.id) || lineIds.has(line.id) || !ids.products.has(line.product)
                || !draftNumber(line.qty) || !draftNumber(line.price) || !draftNumber(line.actual)
                || !Array.isArray(line.sn) || line.sn.length > 1000 || line.sn.some(sn => !text(sn, 200))) invalid('单据明细错误');
            lineIds.add(line.id);
            if (row.type === '盘点单' && !draft) {
                if (countProducts.has(line.product)) invalid('盘点货品重复');
                countProducts.add(line.product);
            }
            if (row.type === '形态转换单' && !draft && (!ids.products.has(line.targetProduct) || line.targetProduct === line.product || !finite(line.targetQty, 0.00000001))) invalid('转换明细错误');
            if (!draft && (!finite(line.price) || (row.type === '盘点单' ? !finite(line.actual) : !finite(line.qty, 0.00000001)))) invalid('提交或审核单据包含无效明细');
            if (!draft && !Number.isFinite(line.qty * line.price)) invalid('单据金额超出数值范围');
        }
        if (row.type === '库存调拨单' && !draft && (!ids.warehouses.has(row.target) || row.target === row.warehouse)) invalid('调拨目标仓库无效');
        if (row.countEffects != null) {
            if (!Array.isArray(row.countEffects) || row.countEffects.length > 3000) invalid('盘点变动错误');
            for (const effect of row.countEffects) {
                if (!object(effect) || !ids.products.has(effect.product) || !ids.warehouses.has(effect.warehouse) || !finite(effect.qty, -1e12)) invalid('盘点变动引用或数量错误');
            }
        }
        if (row.type === '盘点单' && row.status === '已审核' && !Array.isArray(row.countEffects)) invalid('已审核盘点单缺少库存差额');
        if (row.status !== '已审核' || ORDERS.includes(row.type)) continue;
        if (row.type === '盘点单') {
            row.countEffects.forEach(effect => addStock(effect.product, effect.warehouse, effect.qty));
        } else for (const line of row.lines) {
            if (INBOUND.includes(row.type)) addStock(line.product, row.warehouse, line.qty);
            else if (OUTBOUND.includes(row.type)) addStock(line.product, row.warehouse, -line.qty);
            else if (row.type === '库存调拨单') {
                addStock(line.product, row.warehouse, -line.qty);
                addStock(line.product, row.target, line.qty);
            } else if (row.type === '形态转换单') {
                addStock(line.product, row.warehouse, -line.qty);
                addStock(line.targetProduct, row.warehouse, line.targetQty);
            }
        }
    }
    if ([...stock.values()].some(qty => qty < -1e-8)) invalid('审核单据计算后存在负库存');
    for (const row of data.scans) {
        if (!ids.products.has(row.code) || !ids.warehouses.has(row.warehouse) || !finite(row.qty, 0.00000001)
            || !['待同步', '已同步', '异常'].includes(row.status) || !timestamp(row.time)) invalid('扫码记录错误');
    }
    for (const key of ['receivables', 'payables']) for (const row of data[key]) {
        if (!ids.partners.has(row.partner) || !validDate(row.date) || !validDate(row.due) || row.due < row.date
            || !finite(row.amount, 0.00000001) || !finite(row.paid) || row.paid > row.amount
            || !Array.isArray(row.payments) || row.payments.length > 10000 || row.docId && !ids.docs.has(row.docId)) invalid('资金账单字段错误');
        for (const payment of row.payments) {
            if (!object(payment) || !finite(payment.amount, 0.00000001) || !timestamp(payment.time)) invalid('核销记录错误');
        }
    }
    for (const key of ['workflows', 'roles']) for (const row of data[key]) {
        if (!text(row.code, 100) || !text(row.name, 200) || !['启用', '停用'].includes(row.enabled)
            || key === 'workflows' && !text(row.nodes) || key === 'roles' && !text(row.menus)) invalid('流程或角色字段错误');
    }
    const businessError = domain.businessError(data);
    if (businessError) invalid(businessError);
    return data;
}

function run(connection, sql, params = []) {
    return new Promise((resolve, reject) => connection.run(sql, params, function onRun(error) {
        error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
    }));
}

function get(connection, sql, params = []) {
    return new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

async function readyConnection() {
    const connection = tenantPool.getConnection(DB_FILENAME);
    if (!readiness.has(connection)) {
        const ready = (async () => {
            await run(connection, `CREATE TABLE IF NOT EXISTS warehouse_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                payload_json TEXT,
                revision INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT
            )`);
            await run(connection, 'INSERT OR IGNORE INTO warehouse_state (id, payload_json, revision, updated_at) VALUES (1, NULL, 0, NULL)');
        })().catch(error => {
            readiness.delete(connection);
            throw error;
        });
        readiness.set(connection, ready);
    }
    await readiness.get(connection);
    return connection;
}

async function loadState() {
    const connection = await readyConnection();
    const row = await get(connection, 'SELECT payload_json, revision, updated_at FROM warehouse_state WHERE id = 1');
    return { data: row.payload_json === null ? null : JSON.parse(row.payload_json), revision: row.revision, updatedAt: row.updated_at };
}

async function saveState(data, revision) {
    validateRevision(revision);
    validateState(data);
    const payload = JSON.stringify(data);
    const connection = await readyConnection();
    const updatedAt = new Date().toISOString();
    // The comparison belongs in SQL: two browsers saving the same revision can
    // never both succeed, including when requests reach different processes.
    const result = await run(connection, `UPDATE warehouse_state SET payload_json = ?, revision = revision + 1, updated_at = ?
        WHERE id = 1 AND revision = ?`, [payload, updatedAt, revision]);
    if (!result.changes) throw warehouseError('服务器数据已被其他窗口或用户更新，请刷新后重试', 409, 'WAREHOUSE_REVISION_CONFLICT');
    return { revision: revision + 1, updatedAt };
}

// With a caller-owned destination this is also used by tenant backup. Do not
// create an empty warehouse database just because a tenant backup is requested.
async function createDatabaseBackup(destination) {
    if (destination && !fs.existsSync(path.join(getDataDir(), DB_FILENAME))) return false;
    const connection = await readyConnection();
    const tempDir = destination ? null : await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tools-platform-warehouse-'));
    const filePath = destination ? path.resolve(destination) : path.join(tempDir, DB_FILENAME);
    if (fs.existsSync(filePath)) {
        if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true });
        throw warehouseError('数据库备份目标文件已存在', 409, 'WAREHOUSE_BACKUP_EXISTS');
    }
    try {
        // SQLite copies a coherent committed snapshot, including WAL contents.
        // Reading the live .db with fs.readFile would omit recent WAL writes.
        await run(connection, 'VACUUM INTO ?', [filePath]);
        await fs.promises.chmod(filePath, 0o600);
        if (destination) return true;
        return {
            filePath,
            filename: DB_FILENAME,
            cleanup: () => fs.promises.rm(tempDir, { recursive: true, force: true })
        };
    } catch (error) {
        if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        else await fs.promises.rm(filePath, { force: true }).catch(() => {});
        throw error;
    }
}

module.exports = { DB_FILENAME, MAX_STATE_BYTES, createDatabaseBackup, loadState, saveState, validateRevision, validateState };
