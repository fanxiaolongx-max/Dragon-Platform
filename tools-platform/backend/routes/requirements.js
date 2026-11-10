const express = require('express');
const router = express.Router();
const transport = require('../models/requirements-transport');
const uploads = require('../models/requirements-upload');
const { board, transaction } = require('../models/requirements-board');
const { parseImages } = require('../models/requirements-images');
const { isSuperAdmin } = require('../middleware/auth');
const { DEFAULT_TENANT_ID, getTenantId, runWithTenant } = require('../models/tenant-context');

// Descriptions and remarks can contain pasted credentials or scripts; do not log write bodies.
router.use((req, _res, next) => {
    if (req.method !== 'GET') req.suppressBodyLog = true;
    next();
});

// This router is mounted after authentication and tenant context injection.
router.get('/transport-key', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(transport.getPublicConfig(req.user));
});

const uploadEndpoint = action => async (req, res) => {
    try {
        const result = await action(req);
        res.status(result.status || 200).json(result.body || result);
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : '需求分块上传处理失败',
            code: error.code || 'REQUIREMENT_UPLOAD_FAILED'
        });
    }
};

router.post('/uploads/start', uploadEndpoint(async req => {
    if (req.body?.method === 'PUT') {
        const query = await board();
        const row = await query.get('SELECT creator FROM Requirements WHERE id = ?', [req.body.requirementId]);
        if (!row) throw requestError('需求不存在', 404);
        if (!canEdit(row, req.user)) throw requestError('没有权限修改此需求', 403);
    }
    return uploads.start(req.body || {}, req.user);
}));
router.post('/uploads/:uploadId/chunk', uploadEndpoint(req => uploads.receive(req.params.uploadId, req.body || {}, req.user)));
router.delete('/uploads/:uploadId', uploadEndpoint(req => { uploads.cancel(req.params.uploadId, req.user); return { success: true }; }));
router.post('/uploads/:uploadId/complete', uploadEndpoint(req => uploads.complete(req.params.uploadId, req.user, (envelope, target) => {
    const body = transport.decrypt(envelope, { user: req.user, method: target.method, path: target.path });
    return (target.method === 'POST' ? createRequirement : updateRequirement)(
        { user: req.user, params: { id: target.requirementId }, body }
    ).then(value => ({ body: value }), error => ({
        status: error.status || 500, body: { error: error.status ? error.message : '需求保存失败', code: error.code }
    }));
})));

function decryptRequest(req, res, next) {
    try {
        req.body = transport.decrypt(req.body, {
            user: req.user, method: req.method, path: `/api/requirements${req.path === '/' ? '' : req.path}`
        });
        next();
    } catch (error) {
        res.status(error.status || 400).json({ error: error.message, code: error.code || 'REQUIREMENT_TRANSPORT_INVALID' });
    }
}

const statuses = ['提交', '需求接受', '需求实现中', '需求完成', '验收完成', '需求评价'];
const requestError = (message, status) => Object.assign(new Error(message), { status });
const canEdit = (row, user) => isSuperAdmin(user) || row.creator === user.username;
const isUrgent = value => value === true || value === 1 || value === '1' ? 1 : 0;

function endpoint(action) {
    return async (req, res, next) => {
        try {
            res.setHeader('Cache-Control', 'private, no-store');
            const result = await action(req, res);
            if (result !== undefined) res.json(result);
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
            next(error);
        }
    };
}

router.get('/', endpoint(async () => {
    const query = await board();
    const rows = await query.all(`SELECT id, title, substr(description, 1, 300) AS description, length(description) > 300 AS description_truncated,
        status, creator, assignee, category, urgent, created_at, updated_at
        FROM Requirements ORDER BY created_at DESC, id DESC`);
    return rows.map(({ description_truncated, ...row }) => description_truncated ? { ...row, description_truncated: true } : row);
}));

router.post('/skill-publications', endpoint(async req => {
    const skillId = typeof req.body?.skillId === 'string' ? req.body.skillId : '';
    const snapshot = await require('../models/agent-skills-store').publicationSnapshot(skillId, req.user);
    if (!snapshot) throw requestError('请先保存你的技能版本', 404);
    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    return transaction(async query => {
        const pending = await query.get(`SELECT id FROM Requirements WHERE creator = ?
            AND json_extract(skill_publication, '$.snapshot.id') = ?
            AND json_extract(skill_publication, '$.state') = 'pending' AND status <> '已拒绝'`, [req.user.username, skillId]);
        if (pending) throw requestError('此技能已有待审核的发布申请', 409);
        const { id } = await query.run(
            'INSERT INTO Requirements (title, description, category, status, creator, skill_publication) VALUES (?, ?, ?, ?, ?, ?)',
            [`技能发布申请：${snapshot.name}`, reason, '技能发布申请', statuses[0], req.user.username,
                JSON.stringify({ state: 'pending', snapshot, applicantTenant: req.user.homeTenantId || getTenantId() })]
        );
        await query.run('INSERT INTO RequirementLogs (req_id, old_status, new_status, remark, operator) VALUES (?, ?, ?, ?, ?)',
            [id, '', statuses[0], '提交技能发布申请', req.user.username]);
        return { success: true, id };
    });
}));

router.post('/:id/approve-skill', endpoint(async req => {
    if (!isSuperAdmin(req.user)) throw requestError('仅超级管理员可审核发布', 403);
    return transaction(async query => {
        const row = await query.get('SELECT creator, status, skill_publication FROM Requirements WHERE id = ?', [req.params.id]);
        if (!row?.skill_publication) throw requestError('技能发布申请不存在', 404);
        const publication = JSON.parse(row.skill_publication);
        if (publication.state === 'published') return { success: true };
        if (row.status === '已拒绝') throw requestError('已拒绝的申请无法发布', 409);
        await require('../models/agent-skills-store').publishSnapshot(publication.snapshot, req.user.username);
        if (publication.applicantTenant && publication.applicantTenant !== DEFAULT_TENANT_ID) {
            await runWithTenant(publication.applicantTenant, () => require('../models/tool-distribution')
                .setPersonalEntry({ username: row.creator }, `skill:${publication.snapshot.id}`, { origin: true, fork: false }));
        }
        const published = { ...publication, state: 'published', approvedBy: req.user.username, approvedAt: new Date().toISOString() };
        await query.run('UPDATE Requirements SET status = ?, assignee = ?, skill_publication = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['需求完成', req.user.username, JSON.stringify(published), req.params.id]);
        await query.run('INSERT INTO RequirementLogs (req_id, old_status, new_status, remark, operator) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, row.status, '需求完成', '已允许发布技能', req.user.username]);
        return { success: true };
    });
}));

router.get('/:id/images/:index', endpoint(async (req, res) => {
    const query = await board();
    const row = await query.get('SELECT images FROM Requirements WHERE id = ?', [req.params.id]);
    const image = row && /^\d+$/.test(req.params.index) && JSON.parse(row.images)[Number(req.params.index)];
    if (!image) throw requestError('图片不存在', 404);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(image.type).send(Buffer.from(image.data, 'base64'));
}));

router.get('/:id', endpoint(async req => {
    const query = await board();
    const row = await query.get('SELECT * FROM Requirements WHERE id = ?', [req.params.id]);
    if (!row) throw requestError('需求不存在', 404);
    const canManage = isSuperAdmin(req.user);
    const { skill_publication: rawPublication, ...details } = row;
    const publication = rawPublication && JSON.parse(rawPublication);
    return {
        ...details,
        skillPublication: publication ? {
            id: publication.snapshot.id,
            name: publication.snapshot.name,
            state: publication.state === 'pending' && row.status === '已拒绝' ? 'rejected' : publication.state,
            approvedBy: publication.approvedBy,
            approvedAt: publication.approvedAt,
            markdown: canManage || row.creator === req.user.username ? publication.snapshot.markdown : undefined
        } : undefined,
        images: JSON.parse(row.images).map(({ name }, index) => ({ name, href: `/api/requirements/${row.id}/images/${index}` })),
        canEdit: canEdit(row, req.user), canManage,
        logs: await query.all('SELECT * FROM RequirementLogs WHERE req_id = ? ORDER BY id ASC', [row.id])
    };
}));

async function createRequirement(req) {
    const { title, description = '', category, urgent, images } = req.body || {};
    if (typeof title !== 'string' || !title.trim()) throw requestError('标题为必填项', 400);
    if (typeof category !== 'string' || !category.trim()) throw requestError('页面分类为必选项', 400);
    if (typeof description !== 'string') throw requestError('需求描述无效', 400);
    const attachments = JSON.stringify(parseImages(images));
    const creator = req.user.username;
    const status = statuses[0];
    return transaction(async query => {
        const { id } = await query.run(
            'INSERT INTO Requirements (title, description, category, status, creator, urgent, images) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [title, description, category, status, creator, isUrgent(urgent), attachments]
        );
        await query.run('INSERT INTO RequirementLogs (req_id, old_status, new_status, remark, operator) VALUES (?, ?, ?, ?, ?)',
            [id, '', status, '创建需求', creator]);
        return { success: true, id, message: '需求提交成功' };
    });
}
router.post('/', decryptRequest, endpoint(createRequirement));

async function updateRequirement(req) {
    const { id } = req.params;
    const { title, description, category, status, assignee, remark, urgent, images } = req.body || {};
    return transaction(async query => {
        const row = await query.get('SELECT * FROM Requirements WHERE id = ?', [id]);
        if (!row) throw requestError('需求不存在', 404);
        if (!canEdit(row, req.user)) throw requestError('没有权限修改此需求', 403);
        const canManage = isSuperAdmin(req.user);
        if (!canManage && (status !== undefined && status !== row.status || assignee !== undefined && (assignee || '') !== (row.assignee || ''))) {
            throw requestError('仅超级管理员可处理需求', 403);
        }
        for (const value of [title, description, category, status, assignee, remark]) {
            if (value !== undefined && typeof value !== 'string') throw requestError('需求字段无效', 400);
        }
        if (title !== undefined && !title.trim() || category !== undefined && !category.trim()) throw requestError('标题和页面分类为必填项', 400);
        const nextStatus = canManage && status !== undefined ? status : row.status;
        if (nextStatus !== row.status) {
            const oldIndex = statuses.indexOf(row.status);
            const newIndex = statuses.indexOf(nextStatus);
            if (row.status === '已拒绝') throw requestError('已拒绝的需求无法再流转', 400);
            if (nextStatus !== '已拒绝') {
                if (newIndex < 0 || oldIndex < 0) throw requestError('无效的状态', 400);
                if (newIndex < oldIndex) throw requestError('流程不能回退', 400);
                if (newIndex > oldIndex + 1) throw requestError('流程不能跳级', 400);
            }
        }
        const attachments = images === undefined ? row.images : JSON.stringify(parseImages(images, JSON.parse(row.images)));
        await query.run(`UPDATE Requirements SET title = ?, description = ?, category = ?, status = ?, assignee = ?, urgent = ?, images = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [title ?? row.title, description ?? row.description, category ?? (row.category || '未分类'), nextStatus,
                canManage ? assignee ?? row.assignee : row.assignee, urgent === undefined ? row.urgent : isUrgent(urgent), attachments, id]);
        if (nextStatus !== row.status || remark?.trim()) {
            await query.run('INSERT INTO RequirementLogs (req_id, old_status, new_status, remark, operator) VALUES (?, ?, ?, ?, ?)',
                [id, row.status, nextStatus, remark || '更新需求信息', req.user.username]);
        }
        return { success: true, message: '更新成功' };
    });
}
router.put('/:id', decryptRequest, endpoint(updateRequirement));

router.delete('/:id', endpoint(req => transaction(async query => {
    const { id } = req.params;
    const row = await query.get('SELECT creator FROM Requirements WHERE id = ?', [id]);
    if (!row) throw requestError('需求不存在', 404);
    if (!canEdit(row, req.user)) throw requestError('没有权限删除此需求', 403);
    await query.run('DELETE FROM RequirementLogs WHERE req_id = ?', [id]);
    await query.run('DELETE FROM Requirements WHERE id = ?', [id]);
    return { success: true, message: '删除成功' };
})));

router.closeDatabase = async function closeDatabase() {};

module.exports = router;
