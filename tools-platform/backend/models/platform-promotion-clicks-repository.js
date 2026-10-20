// 平台推广点击统计：按天 × 推广项 × 渠道 × 账号累计，统计页只展示汇总（点击次数、去重人数），不展示账号明细。
const { run, get, all, getDatabase } = require('./app-db');

const KINDS = new Set(['video', 'link']);
// video：首页打开视频大窗；tab：浏览器新标签页打开链接；desktop：从首页弹出桌面大窗；card：在右下角卡片堆里直接放大
const CHANNELS = new Set(['video', 'tab', 'desktop', 'card']);
const DEDUPE_MS = 5000;
const MAX_DAYS = 365;

const initializations = new WeakMap();
async function ensureReady() {
    const connection = getDatabase();
    if (!initializations.has(connection)) {
        const pending = run(`
            CREATE TABLE IF NOT EXISTS platform_promotion_clicks (
                click_date TEXT NOT NULL,
                promo_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                channel TEXT NOT NULL,
                username TEXT NOT NULL,
                click_count INTEGER NOT NULL DEFAULT 0,
                last_clicked_at TEXT NOT NULL,
                PRIMARY KEY (click_date, promo_id, channel, username)
            )
        `);
        initializations.set(connection, pending);
        pending.catch(() => initializations.delete(connection));
    }
    await initializations.get(connection);
}

const localDate = (date = new Date()) => date.toLocaleDateString('sv');
const normalizeId = value => String(value || '').trim().replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 80);

async function record({ promoId, kind, channel, username, now = new Date() }) {
    const id = normalizeId(promoId);
    if (!id || !KINDS.has(kind) || !CHANNELS.has(channel)) throw new Error('无效的推广点击记录');
    const user = String(username || 'anonymous').slice(0, 120);
    await ensureReady();
    const day = localDate(now);
    const at = now.toISOString();
    // 同一账号几秒内重复点击同一推广项只算一次
    const existing = await get('SELECT last_clicked_at FROM platform_promotion_clicks WHERE click_date = ? AND promo_id = ? AND channel = ? AND username = ?', [day, id, channel, user]);
    if (existing && now.getTime() - Date.parse(existing.last_clicked_at) < DEDUPE_MS) return false;
    await run(`
        INSERT INTO platform_promotion_clicks (click_date, promo_id, kind, channel, username, click_count, last_clicked_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(click_date, promo_id, channel, username)
        DO UPDATE SET click_count = click_count + 1, last_clicked_at = excluded.last_clicked_at
    `, [day, id, kind, channel, user, at]);
    return true;
}

async function summary({ days = 30, now = new Date() } = {}) {
    const span = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days)) || 30));
    const start = new Date(now);
    start.setDate(start.getDate() - span + 1);
    const from = localDate(start);
    await ensureReady();
    const rows = await all(`
        SELECT promo_id, kind, channel, SUM(click_count) AS clicks, MAX(last_clicked_at) AS last_clicked_at
        FROM platform_promotion_clicks WHERE click_date >= ? GROUP BY promo_id, kind, channel
    `, [from]);
    const users = await all(`
        SELECT promo_id, COUNT(DISTINCT username) AS users
        FROM platform_promotion_clicks WHERE click_date >= ? GROUP BY promo_id
    `, [from]);
    const daily = await all(`
        SELECT click_date, SUM(click_count) AS clicks
        FROM platform_promotion_clicks WHERE click_date >= ? GROUP BY click_date ORDER BY click_date
    `, [from]);
    const totalUsers = await get('SELECT COUNT(DISTINCT username) AS users FROM platform_promotion_clicks WHERE click_date >= ?', [from]);
    const byId = new Map();
    rows.forEach(row => {
        const item = byId.get(row.promo_id) || { id: row.promo_id, kind: row.kind, clicks: 0, users: 0, channels: {}, lastClickedAt: null };
        item.clicks += Number(row.clicks) || 0;
        item.channels[row.channel] = (item.channels[row.channel] || 0) + (Number(row.clicks) || 0);
        if (!item.lastClickedAt || row.last_clicked_at > item.lastClickedAt) item.lastClickedAt = row.last_clicked_at;
        byId.set(row.promo_id, item);
    });
    users.forEach(row => { const item = byId.get(row.promo_id); if (item) item.users = Number(row.users) || 0; });
    const items = [...byId.values()].sort((a, b) => b.clicks - a.clicks);
    return {
        days: span,
        from,
        to: localDate(now),
        totalClicks: items.reduce((sum, item) => sum + item.clicks, 0),
        totalUsers: Number(totalUsers && totalUsers.users) || 0,
        items,
        daily: daily.map(row => ({ date: row.click_date, clicks: Number(row.clicks) || 0 }))
    };
}

module.exports = { KINDS, CHANNELS, DEDUPE_MS, record, summary };
