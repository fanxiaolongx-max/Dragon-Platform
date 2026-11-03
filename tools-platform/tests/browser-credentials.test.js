const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { createBrowserCredentials, loginOrigin, captureSite, attachBrowserLogin } = require('../desktop-promo/browser-credentials');
function encryption() {
    const key = crypto.randomBytes(32);
    return {
        isEncryptionAvailable: () => true,
        encryptString: text => { const iv = crypto.randomBytes(16), cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final()]); },
        decryptString: data => { const decipher = crypto.createDecipheriv('aes-256-cbc', key, data.subarray(0, 16)); return Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]).toString(); }
    };
}
test('browser secrets persist encrypted, stay isolated by exact HTTPS origin and support opt-out and removal', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-passwords-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'logins.db'), secure = encryption(), origin = 'https://netcare.huawei.com';
    let store = createBrowserCredentials(file, secure);
    const value = { username: 'fixture-user-9381', password: 'fixture-secret-7482' };
    assert.equal(await store.save(origin + '/login', value), true);
    assert.deepEqual(await store.read(origin), value);
    for (const url of ['https://datafab-pro.gtsdata.huawei.com', 'https://netcare.huawei.com.evil.test', 'https://netcare.huawei.com:444', 'http://netcare.huawei.com']) assert.equal(await store.read(url), null);
    await store.close();
    const raw = fs.readFileSync(file);
    assert.equal(raw.includes(value.password), false); assert.equal(raw.includes(value.username), false);
    store = createBrowserCredentials(file, secure);
    assert.deepEqual(await store.read(origin), value);
    assert.equal(store.claimAutoSubmit(origin), true); assert.equal(store.claimAutoSubmit(origin), false);
    await store.toggle(origin);
    assert.equal(await store.read(origin), null); assert.equal(await store.save(origin, value), false);
    await store.toggle(origin); assert.deepEqual(await store.read(origin), value);
    await store.remove(origin); assert.equal(await store.read(origin), null); assert.equal(await store.enabled(origin), false);
    await store.toggle(origin); assert.equal(await store.read(origin), null);
    await store.close();
});
test('unavailable OS encryption and Linux basic_text never fall back to plaintext or base64', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-passwords-unavailable-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [index, secure] of [null, { isEncryptionAvailable: () => false }, { ...encryption(), getSelectedStorageBackend: () => 'basic_text' }].entries()) {
        const store = createBrowserCredentials(path.join(root, index + '.db'), secure);
        assert.equal(await store.save('https://netcare.huawei.com', { username: 'fixture', password: 'secret' }), false);
        assert.equal(await store.read('https://netcare.huawei.com'), null); await store.close();
    }
    assert.equal(loginOrigin('https://user:pass@netcare.huawei.com'), null);
    for (const site of ['netcare.huawei.com', 'netcare-ae.gts.huawei.com', 'netcare-de.gts.huawei.com', 'datafab-pro.gtsdata.huawei.com']) assert.equal(captureSite('https://' + site), true);
    assert.equal(captureSite('https://netcare.huawei.com.evil.test'), false);
});
test('IPC never accepts frames, forged origins, stale documents or unrelated tabs', async () => {
    const wc = new EventEmitter(), frame = {}, sent = []; let url = 'https://netcare.huawei.com/login', allowed = true, saves = 0;
    wc.mainFrame = frame; wc.getURL = () => url; wc.isDestroyed = () => false; wc.send = (_channel, payload) => sent.push(payload);
    const store = { read: async () => ({ username: 'fixture', password: 'fixture-secret' }), enabled: async () => true, claimAutoSubmit: () => true, save: async () => { saves++; return true; } };
    const cleanup = attachBrowserLogin(wc, { getStore: () => store, allowed: () => allowed });
    const send = async (action, document = 'doc-1', senderFrame = frame) => { wc.emit('ipc-message', { senderFrame }, 'dragon-browser:login', { action, document }); await new Promise(resolve => setImmediate(resolve)); };
    await send('probe', 'doc-1', {}); assert.equal(sent.length, 0);
    allowed = false; await send('probe'); assert.equal(sent.length, 0);
    allowed = true; await send('probe'); assert.equal(sent[0].origin, 'https://netcare.huawei.com');
    url = 'https://datafab-pro.gtsdata.huawei.com/login'; await send('save'); assert.equal(saves, 0);
    await send('probe', 'doc-2'); await send('save'); assert.equal(saves, 0);
    await send('save', 'doc-2'); assert.equal(saves, 1);
    cleanup(); assert.equal(wc.listenerCount('ipc-message'), 0);
});
