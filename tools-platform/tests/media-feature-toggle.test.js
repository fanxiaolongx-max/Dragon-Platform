const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const authSessionsRepo = require('../backend/models/auth-sessions-repository');
const {
    router: mediaRoutes,
    isMediaFeatureEnabled,
    setMediaFeatureEnabled,
    hasAdminMediaSession
} = require('../backend/routes/media');

test('媒体资源总开关功能测试：控制公开接口可用性与影视入口状态', async () => {
    const wasInitiallyEnabled = isMediaFeatureEnabled();
    const app = express();
    app.use(express.json());

    // 模拟 admin session
    const adminToken = 'admin-media-test-' + Date.now();
    await authSessionsRepo.saveSession(adminToken, 'admin', 'admin', Date.now() + 60000);

    // 挂载路由
    app.use('/api/media', mediaRoutes);
    app.get(['/cinema', '/cinema.html', '/cinama', '/cinama.html'], async (req, res) => {
        if (!isMediaFeatureEnabled()) {
            const isAdmin = await hasAdminMediaSession(req);
            if (!isAdmin) {
                return res.redirect('/login');
            }
        }
        res.status(200).send('<html><body>Cinema Page</body></html>');
    });

    try {
        // --- 1. 停用状态验证 ---
        setMediaFeatureEnabled(false);
        assert.equal(isMediaFeatureEnabled(), false);

        // 公开状态接口
        const publicStatusRes = await request(app).get('/api/media/public/status').expect(200);
        assert.equal(publicStatusRes.body.enabled, false);

        // 未登录用户访问点播接口被拒绝 403
        const forbiddenList = await request(app).get('/api/media/public/list').expect(403);
        assert.equal(forbiddenList.body.code, 'MEDIA_FEATURE_DISABLED');

        // 未登录用户访问 /cinema 被重定向至 /login
        const redirectRes = await request(app).get('/cinema').expect(302);
        assert.equal(redirectRes.headers.location, '/login');

        // 管理员在停用状态下依然可预览点播与接口
        const adminListRes = await request(app)
            .get('/api/media/public/list')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);
        assert.equal(adminListRes.body.success, true);

        const adminCinemaRes = await request(app)
            .get('/cinema')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);
        assert.match(adminCinemaRes.text, /Cinema Page/);

        // 管理端 overview 包含 enabled: false
        const overviewRes = await request(app)
            .get('/api/media/admin/overview')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);
        assert.equal(overviewRes.body.enabled, false);

        // --- 2. 管理员启用媒体功能 ---
        const enableRes = await request(app)
            .post('/api/media/admin/status')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: true })
            .expect(200);
        assert.equal(enableRes.body.success, true);
        assert.equal(enableRes.body.enabled, true);
        assert.equal(isMediaFeatureEnabled(), true);

        // 公开接口恢复 200 访问
        const enabledListRes = await request(app).get('/api/media/public/list').expect(200);
        assert.equal(enabledListRes.body.success, true);

        // 公开访问 /cinema 正常打开
        const publicCinemaRes = await request(app).get('/cinema').expect(200);
        assert.match(publicCinemaRes.text, /Cinema Page/);

        // --- 3. 管理员再次停用媒体功能 ---
        const disableRes = await request(app)
            .post('/api/media/admin/status')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ enabled: false })
            .expect(200);
        assert.equal(disableRes.body.success, true);
        assert.equal(disableRes.body.enabled, false);
        assert.equal(isMediaFeatureEnabled(), false);

        // 公开接口再次被阻断
        await request(app).get('/api/media/public/list').expect(403);
        const reRedirectRes = await request(app).get('/cinema').expect(302);
        assert.equal(reRedirectRes.headers.location, '/login');
    } finally {
        setMediaFeatureEnabled(wasInitiallyEnabled);
    }
});
