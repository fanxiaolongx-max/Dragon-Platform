// 保险箱：加密入库、按账号隔离、站点精确匹配、接口不泄露密码。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-vault-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const { createVault, originOf, ownerOf, maskUsername } = require('../backend/models/password-vault');
const directory = path.join(sandbox, 'vault-a');
let vault = createVault({ directory, protector: () => null });

test.after(async () => { await vault.close(); fs.rmSync(sandbox, { recursive: true, force: true }); });

test('owner is the login account; sites are exact origins', () => {
    assert.equal(ownerOf({ username: 'alice', tenantId: 'team-x', homeTenantId: 'default', isSuper: true }), 'alice');
    assert.equal(ownerOf({}), null);
    assert.equal(originOf('https://Example.com/login?next=/'), 'https://example.com');
    assert.equal(originOf('http://10.0.0.8:8080/a'), 'http://10.0.0.8:8080');
    for (const bad of ['ftp://example.com', 'javascript:alert(1)', 'https://user:pw@example.com', 'example.com', '']) assert.equal(originOf(bad), null);
    assert.equal(maskUsername('alice@example.com'), 'al***@example.com');
    assert.equal(maskUsername('administrator'), 'ad***r');
});

test('passwords are encrypted at rest and never listed', async () => {
    const { entry, created } = await vault.save('alice', { url: 'https://example.com/login', username: ' alice@example.com ', password: 'S3cret-Passw0rd!' });
    assert.equal(created, true);
    assert.deepEqual([entry.origin, entry.host, entry.username], ['https://example.com', 'example.com', 'alice@example.com']);
    const listed = await vault.list('alice');
    assert.equal(listed.entries.length, 1);
    assert.equal(JSON.stringify(listed).includes('S3cret'), false);
    for (const file of fs.readdirSync(directory)) assert.equal(fs.readFileSync(path.join(directory, file)).includes('S3cret-Passw0rd!'), false, `${file} holds no plaintext`);
    assert.equal(await vault.reveal('alice', entry.id), 'S3cret-Passw0rd!');

    // 同站点同用户名再保存是更新，不是新增
    const again = await vault.save('alice', { url: 'https://example.com/', username: 'alice@example.com', password: 'changed-pw' });
    assert.equal(again.created, false);
    assert.equal((await vault.list('alice')).entries.length, 1);
    assert.equal(await vault.reveal('alice', entry.id), 'changed-pw');
});

test('accounts cannot see, use, change or delete each other\'s entries — admins included', async () => {
    const mine = (await vault.list('alice')).entries[0];
    assert.deepEqual((await vault.list('root-admin')).entries, []);
    assert.deepEqual(await vault.find('root-admin', 'https://example.com'), []);
    assert.equal(await vault.credentials('root-admin', 'https://example.com'), null);
    await assert.rejects(vault.reveal('root-admin', mine.id), { code: 'VAULT_NOT_FOUND' });
    await assert.rejects(vault.update('root-admin', mine.id, { password: 'x' }), { code: 'VAULT_NOT_FOUND' });
    await assert.rejects(vault.remove('root-admin', mine.id), { code: 'VAULT_NOT_FOUND' });
    await assert.rejects(vault.list(''), { code: 'VAULT_OWNER' });

    // 同站点同用户名，各存各的
    await vault.save('root-admin', { url: 'https://example.com', username: 'alice@example.com', password: 'admin-own-pw' });
    assert.equal((await vault.credentials('alice', 'https://example.com')).password, 'changed-pw');
    assert.equal((await vault.credentials('root-admin', 'https://example.com')).password, 'admin-own-pw');
});

test('a ciphertext moved to another account or site cannot be decrypted', async () => {
    const sqlite3 = require('sqlite3');
    const db = new sqlite3.Database(path.join(directory, 'vault.db'));
    const run = (sql, args) => new Promise((resolve, reject) => db.run(sql, args, error => error ? reject(error) : resolve()));
    await run("UPDATE vault_logins SET secret = (SELECT secret FROM vault_logins WHERE owner = 'alice') WHERE owner = 'root-admin'");
    await new Promise(resolve => db.close(resolve));
    const stolen = (await vault.list('root-admin')).entries[0];
    await assert.rejects(vault.reveal('root-admin', stolen.id), { code: 'VAULT_CORRUPT' });
    await vault.remove('root-admin', stolen.id);
});

test('credentials are only handed out for the exact origin', async () => {
    assert.equal(await vault.credentials('alice', 'https://example.com.evil.test/login'), null);
    assert.equal(await vault.credentials('alice', 'http://example.com/login'), null, 'https credentials are not used on http');
    assert.equal(await vault.credentials('alice', 'https://sub.example.com/'), null);
    const hit = await vault.credentials('alice', 'https://example.com/any/path');
    assert.deepEqual([hit.username, hit.password], ['alice@example.com', 'changed-pw']);
    assert.equal((await vault.list('alice')).entries[0].useCount, 2);
});

test('several accounts per site, editing, never-save, auto-submit cooldown', async () => {
    const second = (await vault.save('alice', { url: 'https://example.com', username: 'ops', password: 'ops-pw', label: '运维账号' })).entry;
    assert.equal((await vault.find('alice', 'https://example.com')).length, 2);
    assert.equal((await vault.credentials('alice', 'https://example.com', { username: 'ops' })).password, 'ops-pw');
    await assert.rejects(vault.update('alice', second.id, { username: 'alice@example.com' }), { code: 'VAULT_DUPLICATE' });
    const renamed = await vault.update('alice', second.id, { username: 'ops2', autoSubmit: false });
    assert.deepEqual([renamed.username, renamed.autoSubmit, renamed.label], ['ops2', false, '运维账号']);
    assert.equal(await vault.reveal('alice', second.id), 'ops-pw', 'password survives a rename');
    await assert.rejects(vault.save('alice', { url: 'https://example.com', username: '', password: 'x' }), { code: 'VAULT_INVALID' });
    await assert.rejects(vault.save('alice', { url: 'file:///etc/passwd', username: 'a', password: 'x' }), { code: 'VAULT_INVALID' });

    assert.equal(await vault.neverSave('alice', 'https://bank.example'), false);
    await vault.setNeverSave('alice', 'https://bank.example/login', true);
    assert.equal(await vault.neverSave('alice', 'https://bank.example'), true);
    assert.equal(await vault.neverSave('root-admin', 'https://bank.example'), false);
    assert.deepEqual((await vault.list('alice')).neverSave, ['https://bank.example']);

    assert.equal(vault.claimAutoSubmit('alice', 'https://example.com/login'), true);
    assert.equal(vault.claimAutoSubmit('alice', 'https://example.com/again'), false);
    assert.equal(vault.claimAutoSubmit('root-admin', 'https://example.com'), true);
});

test('the master key is sealed by the OS key store when there is one, and the vault stays locked without it', async () => {
    const sealedDir = path.join(sandbox, 'vault-sealed');
    const store = { encryptString: text => Buffer.from(`sealed:${text}`), decryptString: buffer => String(buffer).replace(/^sealed:/, '') };
    const sealed = createVault({ directory: sealedDir, protector: () => store });
    const { entry } = await sealed.save('alice', { url: 'https://example.com', username: 'a', password: 'pw-sealed' });
    await sealed.close();
    assert.deepEqual(fs.readdirSync(sealedDir).filter(name => name.startsWith('master')), ['master.key.sealed']);

    const elsewhere = createVault({ directory: sealedDir, protector: () => null });
    await assert.rejects(elsewhere.list('alice'), { code: 'VAULT_LOCKED' });
    await elsewhere.close();

    const back = createVault({ directory: sealedDir, protector: () => store });
    assert.equal(await back.reveal('alice', entry.id), 'pw-sealed');
    await back.close();
});

test('data survives a restart', async () => {
    await vault.close();
    vault = createVault({ directory, protector: () => null });
    assert.equal((await vault.credentials('alice', 'https://example.com', { username: 'alice@example.com' })).password, 'changed-pw');
});
