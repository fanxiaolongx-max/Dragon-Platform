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
    await wait(0);
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

test('warehouse client retains failed edits and supports explicit retry with the latest snapshot', async () => {
    let attempts = 0;
    const client = create({ debounceMs: 60000, retryDelaysMs: [], fetch: async (_url, init) => {
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

test('transient autosave failures retry the latest edit without a manual flush', async () => {
    const writes = [];
    let last, edited = false;
    const client = create({ debounceMs: 1, retryDelaysMs: [5], fetch: async (_url, init) => {
        if (!init.method) return response(initial());
        writes.push(JSON.parse(init.body));
        if (writes.length === 1) return response({ error: 'temporary outage' }, 503);
        last = writes.at(-1).data;
        return confirmed(1);
    }, onChange: state => {
        if (state.error && state.saving && writes.length === 1 && !edited) { edited = true; client.enqueue({ value: 'latest' }); }
    } });
    await client.load();
    client.enqueue({ value: 'first' });
    for (let i = 0; i < 100 && client.getStatus().pending; i++) await wait(5);
    assert.equal(client.getStatus().pending, false);
    assert.equal(client.getStatus().error, '');
    assert.deepEqual(last, { value: 'latest' });
    assert.deepEqual(writes.map(x => x.revision), [0, 0]);
});

test('a lost PUT acknowledgement is verified from SQLite state without a duplicate write', async () => {
    let server = initial(), writes = 0;
    const client = create({ retryDelaysMs: [0], fetch: async (_url, init) => {
        if (!init.method) return response(server);
        writes++;
        server = initial({ data: JSON.parse(init.body).data, revision: 1, updatedAt: '2026-10-17T10:00:00Z' });
        throw new TypeError('connection closed after commit');
    } });
    await client.load();
    client.enqueue({ docs: [{ status: '已审核' }] });
    assert.equal(await client.flush(), true);
    assert.equal(writes, 1);
    assert.equal(client.getStatus().revision, 1);
    assert.equal(client.getStatus().pending, false);
});

test('reconciliation preserves newer edits queued after the unacknowledged commit', async () => {
    let server = initial(), writes = 0;
    const client = create({ retryDelaysMs: [0], fetch: async (_url, init) => {
        if (!init.method) return response(server);
        writes++;
        const body = JSON.parse(init.body);
        assert.equal(body.revision, server.revision);
        server = initial({ data: body.data, revision: server.revision + 1 });
        if (writes === 1) {
            client.enqueue({ value: 'newer' });
            throw new TypeError('lost reply');
        }
        return confirmed(server.revision);
    } });
    await client.load(); client.enqueue({ value: 'first' });
    assert.equal(await client.flush(), true);
    assert.equal(writes, 2);
    assert.equal(server.revision, 2);
    assert.deepEqual(server.data, { value: 'newer' });
});

test('uncertain writes never overwrite a newer server snapshot or a changed tenant', async () => {
    for (const tenantChanged of [false, true]) {
        let reads = 0, writes = 0;
        const client = create({ retryDelaysMs: [0], fetch: async (_url, init) => {
            if (!init.method) return response(++reads === 1 ? initial() : initial({ revision: 1, data: { value: 'other user' }, tenantId: tenantChanged ? 'another-tenant' : 'default' }));
            writes++; throw new TypeError('lost reply');
        } });
        await client.load(); client.enqueue({ value: 'my changes' });
        assert.equal(await client.flush(), false);
        assert.equal(client.getStatus().pending, true);
        assert.equal(client.getStatus().conflict, true);
        assert.equal(writes, 1);
    }
});

test('validation and permanent HTTP failures do not auto retry', async () => {
    for (const status of [400, 401, 403, 413]) {
        let writes = 0;
        const client = create({ retryDelaysMs: [0, 0], fetch: async (_url, init) => {
            if (!init.method) return response(initial());
            writes++; return response({ error: 'permanent failure' }, status);
        } });
        await client.load(); client.enqueue({ value: 1 });
        assert.equal(await client.flush(), false);
        assert.equal(writes, 1);
        assert.equal(client.getStatus().pending, true);
    }
    let writes = 0;
    const client = create({ validate: () => { throw new Error('bad draft'); }, fetch: async (_url, init) => { if (init.method) writes++; return response(initial()); } });
    await client.load(); client.enqueue({ value: 1 });
    assert.equal(await client.flush(), false);
    assert.equal(writes, 0);
    assert.match(client.getStatus().error, /bad draft/);
});


test('a fresh edit resumes autosave after retries were exhausted', async () => {
    let writes = 0, saved;
    const client = create({ debounceMs: 1, retryDelaysMs: [], fetch: async (_url, init) => {
        if (!init.method) return response(initial());
        writes++;
        if (writes === 1) return response({ error: 'temporarily offline' }, 503);
        saved = JSON.parse(init.body).data;
        return confirmed(1);
    } });
    await client.load(); client.enqueue({ value: 'first' });
    assert.equal(await client.flush(), false);
    client.enqueue({ value: 'corrected' });
    for (let i = 0; i < 100 && client.getStatus().pending; i++) await wait(5);
    assert.equal(client.getStatus().pending, false);
    assert.equal(client.getStatus().error, '');
    assert.deepEqual(saved, { value: 'corrected' });
});
