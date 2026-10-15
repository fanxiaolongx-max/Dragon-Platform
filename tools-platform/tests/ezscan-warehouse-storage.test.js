const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../frontend/js/ezscan-warehouse-storage');
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const initial = (overrides = {}) => ({ data: null, revision: 0, updatedAt: null, tenantId: 'default', canWrite: true, ...overrides });
const confirmed = revision => response({ success: true, revision, updatedAt: new Date().toISOString() });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('warehouse client loads empty server without writing and authenticates same-origin requests', async () => {
    const calls = [];
    const client = create({ fetch: async (url, init) => { calls.push({ url, init }); return response(initial()); } });
    assert.equal(await client.load(), null);
    assert.equal(client.getStatus().initialized, false);
    assert.equal(client.getStatus().pending, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.cache, 'no-store');
});

test('warehouse client serializes saves and coalesces edits made during an in-flight write', async () => {
    const writes = [];
    let releaseFirst;
    const client = create({ debounceMs: 60000, fetch: async (_url, init) => {
        if (!init.method) return response(initial());
        writes.push(JSON.parse(init.body));
        if (writes.length === 1) return new Promise(resolve => { releaseFirst = () => resolve(confirmed(1)); });
        return confirmed(2);
    } });
    await client.load();
    client.enqueue({ product: 'first' });
    const saving = client.flush();
    assert.equal(client.getStatus().saving, true);
    assert.equal(client.getStatus().revision, 0, 'a pending request is not a confirmed save');
    client.enqueue({ product: 'second' });
    client.enqueue({ product: 'latest' });
    releaseFirst();
    assert.equal(await saving, true);
    assert.deepEqual(writes.map(write => [write.revision, write.data.product, write.tenantId]), [[0, 'first', 'default'], [1, 'latest', 'default']]);
    assert.equal(client.getStatus().revision, 2);
    assert.equal(client.getStatus().pending, false);
});

test('warehouse client retains failed edits and only retries after an explicit retry', async () => {
    let attempts = 0;
    const client = create({ debounceMs: 5, fetch: async (_url, init) => {
        if (!init.method) return response(initial({ data: { products: [] }, revision: 4 }));
        attempts++;
        return attempts === 1 ? response({ error: 'disk unavailable' }, 503) : confirmed(5);
    } });
    await client.load();
    client.enqueue({ products: [{ id: 'p1' }] });
    assert.equal(await client.flush(), false);
    assert.equal(client.getStatus().pending, true);
    assert.equal(client.getStatus().revision, 4);
    assert.match(client.getStatus().error, /disk unavailable/);
    client.enqueue({ products: [{ id: 'p1' }, { id: 'p2' }] });
    await wait(12);
    assert.equal(attempts, 1);
    assert.equal(await client.retry(), true);
    assert.equal(client.getStatus().revision, 5);
    assert.equal(client.getStatus().pending, false);
});

test('warehouse client locks conflicting or tenant-switched writes without dropping pending state', async () => {
    for (const code of ['WAREHOUSE_REVISION_CONFLICT', 'WAREHOUSE_TENANT_CHANGED']) {
        let attempts = 0;
        const client = create({ fetch: async (_url, init) => {
            if (!init.method) return response(initial({ tenantId: 'tenant-a' }));
            attempts++;
            return response({ code }, 409);
        } });
        await client.load();
        client.enqueue({ quantity: 1 });
        assert.equal(await client.flush(), false);
        assert.equal(client.getStatus().conflict, true);
        assert.equal(client.getStatus().pending, true);
        assert.equal(client.enqueue({ quantity: 2 }), false);
        assert.equal(await client.retry(), false);
        assert.equal(attempts, 1);
    }
});

test('warehouse client prevents nonadministrator writes and validates loaded data', async () => {
    let writes = 0;
    const client = create({ fetch: async (_url, init) => {
        if (init.method) writes++;
        return response(initial({ canWrite: false, data: { products: [] } }));
    }, validate: data => { assert.ok(Array.isArray(data.products)); } });
    await client.load();
    assert.equal(client.enqueue({ products: [{ id: 'forbidden' }] }), false);
    assert.equal(writes, 0);
    const invalid = create({ fetch: async () => response(initial({ data: { corrupt: true } })), validate: () => { throw new Error('invalid warehouse'); } });
    await assert.rejects(invalid.load(), /invalid warehouse/);
    assert.equal(invalid.getStatus().loaded, false);
});

test('warehouse client does not confirm invalid save replies and supports timeouts', async () => {
    const client = create({ fetch: async (_url, init) => init.method ? confirmed(7) : response(initial()) });
    await client.load();
    client.enqueue({ quantity: 1 });
    assert.equal(await client.flush(), false);
    assert.equal(client.getStatus().revision, 0);
    assert.equal(client.getStatus().pending, true);
    const timeout = create({ timeoutMs: 5, fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) });
    await assert.rejects(timeout.load(), /响应超时/);
    assert.equal(timeout.getStatus().loading, false);
});

test('warehouse client binds database downloads and reauthentication to the loaded tenant', async () => {
    let calls = 0;
    const client = create({ fetch: async (url, init) => {
        calls++;
        if (url.includes('/database')) {
            assert.match(url, /tenantId=tenant-a/);
            return response({ code: 'WAREHOUSE_TENANT_CHANGED' }, 409);
        }
        return response(initial({ tenantId: 'tenant-a' }));
    } });
    await client.load();
    await assert.rejects(client.downloadDatabase());
    assert.equal(client.getStatus().conflict, true);
    assert.equal(calls, 2);
});

test('sample operations flush pending changes first and bind the latest server revision and tenant', async () => {
    const calls = [];
    let finish;
    const client = create({ fetch: async (url, init) => {
        if (!init.method) return response(initial());
        calls.push({ url, ...JSON.parse(init.body) });
        if (init.method === 'PUT') return confirmed(1);
        return new Promise(resolve => { finish = () => resolve(response({ success: true, revision: 2, data: { samples: true }, updatedAt: '2026-10-15T12:00:00Z' })); });
    } });
    await client.load();
    client.enqueue({ real: true });
    const operation = client.modifySamples('add');
    while (!finish) await wait(1);
    assert.equal(client.getStatus().loading, true);
    assert.equal(client.enqueue({ racing: true }), false);
    await assert.rejects(client.modifySamples('add'));
    finish();
    assert.deepEqual(await operation, { samples: true });
    assert.deepEqual(calls.map(call => [call.revision, call.tenantId]), [[0, 'default'], [1, 'default']]);
    assert.equal(client.getStatus().revision, 2);
    assert.equal(client.getStatus().loading, false);
});

test('sample conflicts lock the stale client and never report an unconfirmed revision', async () => {
    const client = create({ fetch: async (_url, init) => init.method ? response({ code: 'WAREHOUSE_REVISION_CONFLICT' }, 409) : response(initial()) });
    await client.load();
    await assert.rejects(client.modifySamples('add'));
    assert.equal(client.getStatus().conflict, true);
    assert.equal(client.getStatus().revision, 0);
    assert.equal(client.getStatus().loading, false);
});
