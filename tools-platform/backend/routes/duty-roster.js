const express = require('express');
const repo = require('../models/duty-roster-repository');
const router = express.Router();

const handle = fn => async (req, res) => {
    try {
        res.setHeader('X-Data-Source', 'sqlite');
        await fn(req, res);
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.message,
            code: 'DUTY_ROSTER_ERROR'
        });
    }
};

// 获取指定月份的值班表（若未指定，默认为最近编辑的月份或当月）
router.get('/', handle(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let month = String(req.query.month || '').trim();
    if (!month) {
        const list = await repo.listDutyRosters();
        if (list && list.length > 0 && list[0].month) {
            month = list[0].month;
        } else {
            const now = new Date();
            month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
    }
    res.json(await repo.getDutyRoster(month));
}));

// 获取最近编辑月份与当月概览
router.get('/recent', handle(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const list = await repo.listDutyRosters();
    const now = new Date();
    const calendarMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const recentMonth = (list && list.length > 0 && list[0].month) ? list[0].month : calendarMonth;
    res.json({
        recentMonth,
        calendarMonth,
        list
    });
}));

// 获取带预填示例数据的参考值班表
router.get('/sample', handle(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const month = String(req.query.month || '').trim() || '2026-08';
    res.json(repo.getSampleDutyRoster(month));
}));

// 计算指定月份的埃及周分段
router.get('/weeks', handle(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const monthStr = String(req.query.month || '').trim() || '2026-08';
    const match = monthStr.match(/^(\d{4})-(0?[1-9]|1[0-2])$/);
    if (!match) return res.status(400).json({ error: 'Invalid month format, expected YYYY-MM' });
    const weeks = repo.calculateEgyptWeeks(Number(match[1]), Number(match[2]));
    res.json({
        month: `${match[1]}-${String(match[2]).padStart(2, '0')}`,
        weeks,
        weekdays: repo.EGYPT_WEEKDAYS
    });
}));

// 获取所有已保存的值班表列表
router.get('/list', handle(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await repo.listDutyRosters());
}));

// 保存值班表到服务器
router.post('/', handle(async (req, res) => {
    const payload = req.body;
    if (!payload || !payload.month) {
        return res.status(400).json({ error: 'Missing duty roster payload or month' });
    }
    const saved = await repo.saveDutyRoster(payload);
    res.json({
        success: true,
        data: saved
    });
}));

module.exports = router;
