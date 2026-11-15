// AI BI 看板：一张自由画布上的若干 AI 格子（格子 = AI 月报格子 + 位置）。每个团队一张表，整张看板存 JSON。
const crypto = require('node:crypto');
const { run, get, all } = require('./app-db');
const { getTenantId } = require('./tenant-context');
const Board = require('../../frontend/js/ai-bi/model');

const readyByTenant = new Map();
function ready() {
    const tenant = getTenantId();
    if (!readyByTenant.has(tenant)) {
        readyByTenant.set(tenant, run(`CREATE TABLE IF NOT EXISTS ai_bi_boards (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, report_month TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)`)
            .catch(error => { readyByTenant.delete(tenant); throw error; }));
    }
    return readyByTenant.get(tenant);
}
const failure = (message, status) => Object.assign(new Error(message), { status });
function checkId(id) { if (typeof id !== 'string' || !/^[-\w]{1,80}$/.test(id)) throw failure('Invalid board ID', 400); }

async function list() {
    await ready();
    const rows = await all('SELECT id, name, report_month AS month, payload_json, updated_at AS updatedAt, updated_by AS updatedBy FROM ai_bi_boards ORDER BY updated_at DESC, id');
    return rows.map(({ payload_json: payload, ...row }) => { let board = {}; try { board = JSON.parse(payload); } catch (_) { /* listed without details */ } return { ...row, canvas: board.canvas || null, items: Array.isArray(board.items) ? board.items.length : 0 }; });
}

async function read(id) {
    checkId(id);
    await ready();
    const row = await get('SELECT payload_json, updated_at FROM ai_bi_boards WHERE id = ?', [id]);
    if (!row) throw failure('看板不存在', 404);
    return { ...JSON.parse(row.payload_json), id, updatedAt: row.updated_at };
}

async function save(input, user = '') {
    const board = Board.normalize(input || {});
    board.id ||= 'board-' + crypto.randomUUID();
    const now = new Date().toISOString();
    board.updatedAt = now;
    const payload = JSON.stringify(board);
    if (Buffer.byteLength(payload) > Board.LIMITS.payload) throw failure('看板内容太大，无法保存：请减少格子数量或明细行数', 413);
    await ready();
    await run(`INSERT INTO ai_bi_boards (id, name, report_month, payload_json, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, report_month = excluded.report_month,
        payload_json = excluded.payload_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [board.id, board.name, board.month, payload, now, now, String(user || '').slice(0, 200)]);
    return board;
}

async function remove(id) {
    checkId(id);
    await ready();
    if (!(await get('SELECT id FROM ai_bi_boards WHERE id = ?', [id]))) throw failure('看板不存在', 404);
    await run('DELETE FROM ai_bi_boards WHERE id = ?', [id]);
    return { id, deleted: true };
}

module.exports = { list, read, save, remove };
