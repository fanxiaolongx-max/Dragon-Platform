'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-portal-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
process.env.INITIAL_ADMIN_USERNAME = 'portal-admin';
process.env.INITIAL_ADMIN_PASSWORD = 'Original-password-2026!';
const portal = require('../backend/models/snapshot-portal');
const security = require('../backend/models/snapshot-portal-security');
const users = require('../backend/models/auth-users-repository');
const { hashPassword } = require('../backend/middleware/auth');
const { runWithTenant } = require('../backend/models/tenant-context');
const promotions = require('../backend/models/platform-promotions-repository');
const checkout = path.join(temp, 'site');
const items = [{ slug: 'demo-tool', name: 'Published demo', href: './demo-tool/index.html' }];
const changed = () => new Map([['demo-tool/index.html', '<!doctype html><html><head></head><body>CONFIDENTIAL_SNAPSHOT</body></html>'], ['demo-tool/data/value.json', '{"private":"private-business-value"}']]);
const manifest = () => JSON.parse(fs.readFileSync(path.join(checkout, 'tp-static/site.json')));
async function decrypted(name, meta = manifest()) {
    return security.open(fs.readFileSync(path.join(checkout, meta.files[name].url)), await security.getKey(meta.keyId), meta.files[name].iv).toString();
}
async function loginKey(meta, username, password) {
    const account = meta.accounts.find(a => a.id === security.digest(username));
    const key = crypto.pbkdf2Sync(hashPassword(password), Buffer.from(account.salt, 'base64'), meta.iterations, 32, 'sha256');
    return JSON.parse(security.open(Buffer.from(account.wrapped, 'base64'), key, account.iv));
}
test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/platform-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('publishes original homepage and login, encrypts tool data and uses separate wrapped login keys', async () => {
    fs.mkdirSync(checkout);
    for (const [name, bytes] of changed()) { const target = path.join(checkout, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
    await portal.buildPortal(checkout, items, changed());
    const meta = manifest();
    const plain = JSON.stringify(meta) + fs.readFileSync(path.join(checkout, 'login.html'));
    assert.doesNotMatch(plain, /Original-password-2026!|CONFIDENTIAL_SNAPSHOT|private-business-value/);
    assert.equal(plain.includes(hashPassword('Original-password-2026!')), false);
    assert.equal(fs.existsSync(path.join(checkout, 'demo-tool/data/value.json')), false);
    assert.doesNotMatch(fs.readFileSync(path.join(checkout, 'demo-tool/index.html'), 'utf8'), /CONFIDENTIAL/);
    assert.match(await decrypted('demo-tool/index.html'), /CONFIDENTIAL_SNAPSHOT/);
    const home = await decrypted('index.html');
    for (const id of ['homeSidebar', 'dragonClaw', 'toolsGrid', 'statsBar', 'homePromotions']) assert.ok(home.includes(`id="${id}"`), id);
    const login = fs.readFileSync(path.join(checkout, 'login.html'), 'utf8');
    assert.match(login, /id="loginPanel"/);
    assert.match(login, /project-evolution.html/);
    assert.match(fs.readFileSync(path.join(checkout, 'tp-static/frontend/js/home/promo-video.js'), 'utf8'), /Dragon-Platform-Media\/releases\/download/);
    assert.match(fs.readFileSync(path.join(checkout, 'tp-static/frontend/js/project-evolution.js'), 'utf8'), /Dragon-Platform-Media\/releases\/download/);
    const data = JSON.parse(await decrypted('portal-data.json'));
    assert.deepEqual(data.appVersion, { name: require('../package.json').productName || require('../package.json').name, version: require('../package.json').version });
    assert.deepEqual(meta.identity['/api/app-version'], data.appVersion, 'the login page can read the same publish-time version before authentication');
    assert.deepEqual(Object.keys(meta.identity['/api/app-version']).sort(), ['name', 'version'], 'public version metadata excludes business and authentication data');
    assert.deepEqual(data.promotions, await promotions.getConfig());
    const cover = data.promotions.links.find(link => link.coverImage.startsWith('/assets/promotions/')).coverImage;
    assert.ok(fs.existsSync(path.join(checkout, 'tp-static/frontend', cover.slice(1))), 'local promotion covers are published');
    const auth = await loginKey(meta, 'portal-admin', 'Original-password-2026!');
    assert.equal(auth.username, 'portal-admin');
    assert.equal(Buffer.from(auth.key, 'base64').equals(await security.getKey(meta.keyId)), true);
    await assert.rejects(loginKey(meta, 'portal-admin', 'wrong-password'));
});

test('password changes rotate site keys and reencrypt retained tools; unchanged publishes remain stable', async () => {
    const first = manifest();
    await portal.buildPortal(checkout, items, new Map());
    assert.equal(JSON.stringify(manifest()), JSON.stringify(first));
    await users.saveUser('portal-admin', 'admin', hashPassword('Changed-password-2026!'));
    await portal.buildPortal(checkout, items, new Map());
    const next = manifest();
    assert.notEqual(next.keyId, first.keyId);
    assert.match(await decrypted('demo-tool/index.html'), /CONFIDENTIAL_SNAPSHOT/);
    await assert.rejects(loginKey(next, 'portal-admin', 'Original-password-2026!'));
    assert.equal((await loginKey(next, 'portal-admin', 'Changed-password-2026!')).username, 'portal-admin');
});

test('portal keys and home data remain tenant scoped and omitted tools are inaccessible', async () => {
    await promotions.saveConfig({ maxLinks: 1, rotateSeconds: 45, videos: [{ id: 'eos', enabled: false }], links: [{ id: 'tenant-only', name: 'Tenant site', url: 'https://tenant.example/', coverImage: 'https://tenant.example/cover.webp' }] });
    await portal.buildPortal(checkout, items, new Map());
    const data = JSON.parse(await decrypted('portal-data.json'));
    assert.equal(data.promotions.maxLinks, 1);
    assert.equal(data.promotions.rotateSeconds, 45);
    assert.equal(data.promotions.videos.find(video => video.id === 'eos').enabled, false);
    assert.equal(data.promotions.links.find(link => link.id === 'tenant-only').coverImage, 'https://tenant.example/cover.webp');
    const baseKey = manifest().keyId;
    const beta = path.join(temp, 'beta');
    fs.mkdirSync(beta);
    await runWithTenant('beta', () => portal.buildPortal(beta, [], new Map()));
    await assert.rejects(runWithTenant('beta', () => portal.buildPortal(checkout, items, changed())), /不属于当前租户/);
    const betaManifest = JSON.parse(fs.readFileSync(path.join(beta, 'tp-static/site.json')));
    const betaHome = betaManifest.files['portal-data.json'];
    const betaData = JSON.parse(security.open(fs.readFileSync(path.join(beta, betaHome.url)), await runWithTenant('beta', () => security.getKey(betaManifest.keyId)), betaHome.iv));
    assert.equal(betaData.promotions.links.some(link => link.id === 'tenant-only'), false);
    assert.equal(betaData.promotions.videos.find(video => video.id === 'eos').enabled, true);
    assert.notEqual(betaManifest.keyId, baseKey);
    assert.equal(betaManifest.files['demo-tool/index.html'], undefined);
    await portal.buildPortal(checkout, [], new Map());
    assert.equal(manifest().files['demo-tool/index.html'], undefined);
});
