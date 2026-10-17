const crypto = require('crypto');
const express = require('express');
const authority = require('../models/desktop-license-authority');
const registry = require('../models/desktop-license-registry');
const trustedTime = require('../models/f12-trusted-time-service');

const router = express.Router();
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;
const ATTESTATION_TTL_MS = 10 * 60 * 1000;
const rateBuckets = new Map();

// 线上经 Cloudflare Tunnel 转发，req.ip 恒为本机地址；按真实客户端 IP 限流，避免所有用户共用同一额度
function clientIp(req) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return (cf || forwarded || req.ip || '').slice(0, 64);
}

function allow(ip) {
    const key = String(ip || 'unknown');
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || now - current.startedAt >= 60000) {
        rateBuckets.set(key, { startedAt: now, count: 1 });
        return true;
    }
    current.count += 1;
    return current.count <= 60;
}

router.post('/validate', async (req, res) => {
    if (!allow(clientIp(req))) return res.status(429).json({ error: '请求过于频繁' });
    try {
        const token = String(req.body && req.body.token || '').trim();
        const nonce = String(req.body && req.body.nonce || '').trim();
        const productId = String(req.body && req.body.productId || '').trim();
        const machineId = String(req.body && req.body.machineId || '').trim().toLowerCase();
        if (!/^[-_A-Za-z0-9]{16,128}$/.test(nonce)) return res.status(400).json({ error: 'nonce 无效' });
        if (!token || token.length > 8192) return res.status(400).json({ error: 'License 无效' });

        const clock = await trustedTime.getTrustedTime();
        let verification = authority.verifyToken(token);
        if (verification.valid && productId !== registry.PRODUCT_ID) {
            verification = { valid: false, reasonCode: 'PRODUCT_MISMATCH', payload: verification.payload };
        }
        let record = null;
        let tokenExpiresAt = 0;
        if (verification.valid) {
            const checked = registry.checkPayload(verification.payload, clock.now, token, machineId);
            record = checked.record || null;
            tokenExpiresAt = Number(checked.tokenExpiresAt) || 0;
            if (!checked.valid) verification = { valid: false, reasonCode: checked.reasonCode, payload: verification.payload };
        }

        const expiresAt = tokenExpiresAt || (record ? Number(record.expiresAt) : 0);
        const payload = {
            version: 1,
            productId: registry.PRODUCT_ID,
            licenseId: verification.payload && verification.payload.licenseId || null,
            machineId: /^[a-f0-9]{32}$/.test(machineId) ? machineId : null,
            nonce,
            tokenDigest: crypto.createHash('sha256').update(token).digest('base64url'),
            checkedAt: clock.now,
            attestationExpiresAt: clock.now + ATTESTATION_TTL_MS,
            offlineUntil: verification.valid ? Math.min(expiresAt, clock.now + OFFLINE_GRACE_MS) : clock.now,
            expiresAt,
            valid: verification.valid,
            reasonCode: verification.reasonCode || null
        };
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            success: true,
            attestation: authority.signAttestation(payload),
            timeSource: clock.source,
            timeSampleCount: clock.sampleCount
        });
    } catch (error) {
        console.warn('[desktop-license] validation failed:', error.message || error);
        res.status(400).json({ error: error.message || 'EXE License 校验失败' });
    }
});

// ── 一键申请 License（桌面端在线提交 → 管理员审批 → 桌面端轮询取回） ──
const requests = require('../models/desktop-license-requests-repository');
const submitBuckets = new Map();
function allowSubmit(ip) {
    const key = String(ip || 'unknown');
    const now = Date.now();
    const current = submitBuckets.get(key);
    if (!current || now - current.startedAt >= 3600000) {
        submitBuckets.set(key, { startedAt: now, count: 1 });
        return true;
    }
    current.count += 1;
    return current.count <= 10;
}

const REQUEST_ERRORS = { MACHINE_CODE_REQUIRED: 400, MACHINE_CODE_INVALID: 400, MACHINE_CODE_CHECKSUM: 400, APPLICANT_REQUIRED: 400, TOO_MANY_PENDING: 503, REQUEST_NOT_FOUND: 404 };
function sendRequestError(res, error) {
    res.status(REQUEST_ERRORS[error.code] || 400).json({ error: error.message || '申请处理失败', code: error.code || 'REQUEST_FAILED' });
}

// 桌面端据此判断「在线申请」是否可用
router.get('/ping', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, productId: registry.PRODUCT_ID, requests: true });
});

router.post('/requests', async (req, res) => {
    if (!allow(clientIp(req)) || !allowSubmit(clientIp(req))) return res.status(429).json({ error: '提交过于频繁，请稍后再试', code: 'RATE_LIMITED' });
    if (String(req.body && req.body.productId || '') !== registry.PRODUCT_ID) return res.status(400).json({ error: '产品标识不匹配', code: 'PRODUCT_MISMATCH' });
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, request: await requests.submitRequest({
            machineCode: req.body.machineCode,
            applicantName: req.body.applicantName,
            applicantNote: req.body.applicantNote,
            clientVersion: req.body.clientVersion,
            clientIp: clientIp(req)
        }) });
    } catch (error) {
        sendRequestError(res, error);
    }
});

router.post('/requests/:requestId/status', async (req, res) => {
    if (!allow(clientIp(req))) return res.status(429).json({ error: '请求过于频繁', code: 'RATE_LIMITED' });
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, request: await requests.getClientStatus({ requestId: req.params.requestId, secret: req.body && req.body.secret, machineId: req.body && req.body.machineId }) });
    } catch (error) {
        sendRequestError(res, error);
    }
});

router.post('/requests/:requestId/cancel', async (req, res) => {
    if (!allow(clientIp(req))) return res.status(429).json({ error: '请求过于频繁', code: 'RATE_LIMITED' });
    try {
        res.json({ success: true, request: await requests.cancelRequest({ requestId: req.params.requestId, secret: req.body && req.body.secret, machineId: req.body && req.body.machineId }) });
    } catch (error) {
        sendRequestError(res, error);
    }
});

module.exports = router;
