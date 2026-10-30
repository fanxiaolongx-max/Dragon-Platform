const express = require('express');
const multer = require('multer');
const { requireAdmin } = require('../middleware/auth');
const { getTenantId, runWithTenant } = require('../models/tenant-context');
const repo = require('../models/gallery-repository');
const service = require('../models/gallery-service');
const router = express.Router();
router.use((req, res, next) => {
    req.suppressBodyLog = true;
    res.setHeader('Cache-Control', 'private, no-store');
    if (!req.user) return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
    next();
});
const handle = fn => async (req, res, next) => {
    try { await fn(req, res); } catch (error) {
        if (!error.status) return next(error);
        res.status(error.status).json({ error: error.message, code: 'GALLERY_REQUEST_FAILED' });
    }
};
router.get('/capabilities', (req, res) => res.json({ canWrite: req.user.role === 'admin' }));
router.get('/categories', handle(async (_req, res) => res.json(await repo.categories())));
router.post('/categories', requireAdmin, handle(async (req, res) => res.status(201).json(await repo.addCategory(req.body?.name))));
router.get('/items', handle(async (req, res) => res.json(await repo.list(req.query))));
router.get('/items/:id', handle(async (req, res) => res.json(await repo.read(req.params.id))));
router.patch('/items/:id', requireAdmin, handle(async (req, res) => res.json(await repo.update(req.params.id, req.body || {}))));
const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 2, fields: 8, fieldSize: 2000 } }).fields([{ name: 'file', maxCount: 1 }, { name: 'raster', maxCount: 1 }]);
router.post('/upload', requireAdmin, (req, res, next) => {
    const tenant = getTenantId();
    multipart(req, res, error => runWithTenant(tenant, () => {
        if (error) return res.status(400).json({ error: '上传失败，单张图片不能超过 25 MB', code: 'GALLERY_UPLOAD_INVALID' });
        next();
    }));
}, handle(async (req, res) => res.status(201).json(await service.upload(req.files?.file?.[0], req.files?.raster?.[0], req.body || {}))));
router.post('/versions/:id/analyze', requireAdmin, handle(async (req, res) => res.json(await service.analyze(req.params.id, req.body?.mode, req.body?.confirmed === true))));
router.get('/versions/:id/:kind', handle(async (req, res) => {
    if (!['thumbnail','preview','original'].includes(req.params.kind)) throw repo.fail('图片类型不存在', 404);
    const image = await repo.asset(req.params.id, req.params.kind);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(image.mime);
    if (req.params.kind === 'original' || req.query.download === '1') {
        const ext = req.params.kind === 'original' ? ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[image.mime] : '.jpg';
        const filename = image.filename.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\r\n]/g, '_') + ext;
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    }
    res.send(image.bytes);
}));
module.exports = router;
