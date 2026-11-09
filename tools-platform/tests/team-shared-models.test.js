// 公共模型：超级管理员分配给所有团队的模型配置，团队可选用但不能修改/删除，Key 不落进团队库；团队可自加模型。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'team-shared-models-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');

const tenant = require('../backend/models/tenant-context');
const repo = require('../backend/models/ai-settings-repository');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');

const PUBLIC_KEY = 'sk-public-0123456789abcdefghijklmnop';

test('teams use shared public models without being able to edit them or read their key', async t => {
    t.after(async () => { await pool.closeAll(); await appDb.closeDatabase(); fs.rmSync(temp, { recursive: true, force: true }); });
    const previousEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-server-env-0123456789abcdefghijk';
    t.after(() => { if (previousEnv === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousEnv; });

    // 团队在公共模型出现之前打开过设置：不会留下一个空白配置抢走默认
    await tenant.runWithTenant('north', () => repo.getPublicSettings());
    const created = await tenant.runWithTenant('default', () => repo.createProfile({ name: '公共 GPT', provider: 'openai', model: 'gpt-4o-mini', apiKey: PUBLIC_KEY, shared: true }));
    const sharedId = `shared:${created.createdProfileId}`;
    await tenant.runWithTenant('default', () => repo.createProfile({ name: '仅超管', provider: 'openai', model: 'gpt-x', apiKey: 'sk-private-0123456789abcdefghijk' }));

    await tenant.runWithTenant('east', async () => {
        const settings = await repo.getPublicSettings();
        assert.deepEqual(settings.profiles.map(item => item.name), ['公共 GPT']);
        assert.equal(settings.activeProfileId, sharedId);
        assert.equal(settings.profiles[0].locked, true);
        assert.ok(!JSON.stringify(settings).includes(PUBLIC_KEY));
        assert.equal((await repo.getRuntimeSettings()).apiKey, PUBLIC_KEY, 'the server can still call the shared model');
        assert.ok((await repo.getRedactionSecrets()).includes(PUBLIC_KEY));

        await assert.rejects(repo.saveSettings({ profileId: sharedId, model: 'other' }), { code: 'AI_PROFILE_SHARED' });
        await assert.rejects(repo.deleteProfile(sharedId), { code: 'AI_PROFILE_SHARED' });

        const copy = await repo.createProfile({ sourceProfileId: sharedId, name: '我的副本' });
        const own = await repo.createProfile({ name: '团队自建', provider: 'openai', model: 'gpt-4.1' });
        assert.equal((await repo.getStoredSettings(copy.createdProfileId)).apiKey, '', 'copying a shared model never copies its key');
        assert.equal((await repo.getRuntimeSettings({ profileId: own.createdProfileId })).apiKey, '', 'teams cannot borrow server environment keys');
        await repo.activateProfile(own.createdProfileId);
        await repo.activateProfile(sharedId);
        await repo.saveSettings({ profileId: own.createdProfileId, shared: true, name: '团队自建2' });
        assert.equal((await repo.getPublicSettings()).profiles.find(item => item.id === own.createdProfileId).shared, false, 'only the super admin space can share');
        const rows = await appDb.all('SELECT value FROM sys_kv_store');
        assert.ok(!JSON.stringify(rows).includes(PUBLIC_KEY), 'the shared key never lands in the team database');
    });

    await tenant.runWithTenant('north', async () => {
        assert.equal((await repo.getPublicSettings()).activeProfileId, sharedId, 'a team that looked earlier still defaults to the shared model');
    });

    await tenant.runWithTenant('default', async () => {
        assert.equal((await repo.getRuntimeSettings({ profileId: created.createdProfileId })).apiKey, PUBLIC_KEY);
        assert.equal((await repo.getPublicSettings()).profiles.find(item => item.id === created.createdProfileId).shared, true);
    });
});
