const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const uploads = require('../models/custom-tool-chunk-upload');

module.exports = function createUploadRouter(importTool, { scope = 'tools', formatResult = tool => ({ tool }) } = {}) {
    const router = express.Router();
    router.use(requireAdmin, (req, _res, next) => { req.suppressBodyLog = true; next(); });
    const endpoint = action => async (req, res) => {
        try { res.json({ success: true, ...await action(req) }); }
        catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : '分块上传处理失败', code: error.code || 'TOOL_CHUNK_UPLOAD_FAILED' }); }
    };
    const owner = req => req.user.username;
    router.get('/key', endpoint(() => ({ publicKey: uploads.getPublicKey() })));
    router.post('/start', endpoint(req => uploads.start(req.body || {}, owner(req), scope)));
    router.post('/:id/chunk', endpoint(req => uploads.receive(req.params.id, req.body || {}, owner(req), scope)));
    router.post('/:id/complete', endpoint(async req => formatResult(await uploads.complete(req.params.id, owner(req), importTool, scope))));
    router.delete('/:id', endpoint(req => { uploads.cancel(req.params.id, owner(req), scope); return {}; }));
    return router;
};
