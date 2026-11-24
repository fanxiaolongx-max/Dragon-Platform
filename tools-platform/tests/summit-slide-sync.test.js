const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const { createSummitSlideSyncRouter } = require('../backend/routes/summit-slide-sync');

test('summit rooms share the slide and prompter language within the team and close for every participant', async t => {
    const host = { tenantId: 'summit', username: 'host' };
    const projector = { tenantId: 'summit', username: 'projector' };
    const outsider = { tenantId: 'another-team', username: 'host' };
    const users = { host, projector, outsider };
    const app = express();
    app.use(express.json(), (req, _res, next) => {
        req.user = users[req.get('X-Test-User')];
        next();
    });
    let clock = Date.now();
    const router = createSummitSlideSyncRouter({ nowMs: () => clock, sendDeck: (_req, res) => res.send('slide deck'), sendDemoPrompter: (_req, res) => res.send('demo prompter') });
    app.use('/api/public/summit-view', router.publicViewer);
    app.use('/api/summit-slide-sync', router);
    const server = app.listen(0, '127.0.0.1');
    t.after(() => server.close());
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/summit-slide-sync`;
    function request(method, user, room, body) {
        const headers = {};
        if (user) headers['X-Test-User'] = user;
        if (room) headers['X-Summit-Sync-Room'] = room;
        if (body) headers['Content-Type'] = 'application/json';
        return fetch(url, { method, headers, body: body && JSON.stringify(body) });
    }

    assert.equal((await request('POST', null, null, { from: 'we-ai', slideIndex: 4 })).status, 401);
    assert.equal((await request('POST', 'host', null, { from: 'ai-en', slideIndex: 4 })).status, 400);
    const translate = (who, body) => fetch(url + '/translate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(who ? {'X-Test-User':who} : {}) }, body:JSON.stringify(body) });
    const utterance = { from:'en', targets:['ar','zh'], text:'Hello, everyone.' };
    assert.equal((await translate(null, utterance)).status, 401);
    assert.equal((await translate('host', { ...utterance, targets:['ar','ar'] })).status, 400);
    assert.equal((await translate('host', utterance)).status, 403);
    const creation = await request('POST', 'host', null, { from: 'we-ai', slideIndex: 4 });
    assert.equal(creation.status, 201);
    const { room, viewer, expiresAt } = await creation.json();
    const publicUrl = url.replace('summit-slide-sync', 'public/summit-view');
    const watch = (key, user, suffix = '') => fetch(publicUrl + suffix, {
        headers: { 'X-Summit-Sync-Room': key, ...(user ? { 'X-Test-User': user } : {}) }
    });
    assert.equal(expiresAt, clock + 8 * 3600000);
    assert.notEqual(viewer, room);
    assert.equal((await watch(room)).status, 404);
    assert.equal((await watch(viewer, null, '/deck')).status, 200);
    assert.equal(await (await watch(viewer, null, '/demo-prompter')).text(), 'demo prompter');
    assert.equal((await watch(room, null, '/demo-prompter')).status, 404);
    assert.deepEqual(await (await watch(viewer, 'outsider')).json(), { from: 'we-ai', slideIndex: 4, revision: 1 });
    assert.equal((await request('PUT', 'host', viewer, { from: 'we-ai', slideIndex: 1 })).status, 404);
    assert.match(room, /^[a-f0-9]{32}$/);
    assert.equal((await request('GET', null, null)).status, 401);
    assert.deepEqual(await (await request('GET', 'projector', null)).json(), { revision: 0 });
    const defaultWrite = await request('PUT', 'host', null, { from: 'we-ai', slideIndex: 2, language: 'ar' });
    assert.equal(defaultWrite.status, 200);
    const defaultState = await defaultWrite.json();
    assert.equal(defaultState.slideIndex, 2);
    assert.equal(defaultState.language, 'ar');
    assert.deepEqual(await (await request('GET', 'projector', null)).json(), defaultState);
    assert.deepEqual(await (await request('GET', 'outsider', null)).json(), { revision: 0 });
    assert.equal((await request('DELETE', 'host', null)).status, 404);
    assert.deepEqual(await (await request('GET', 'host', null)).json(), defaultState);
    assert.equal((await request('GET', 'outsider', room)).status, 404);
    assert.equal((await request('PUT', 'outsider', room, { from: 'ai-en', slideIndex: 8 })).status, 404);

    const initial = await request('GET', 'projector', room);
    assert.equal(initial.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await initial.json(), { from: 'we-ai', slideIndex: 4, revision: 1 });
    assert.equal((await request('PUT', 'projector', room, { from: 'ai-en', slideIndex: 11 })).status, 400);
    assert.equal((await request('PUT', 'host', room, { from: 'we-ai', slideIndex: 4, language: 'bi' })).status, 400);
    assert.equal((await request('PUT', 'projector', room, { from: 'ai-en', slideIndex: 4, language: 'zh' })).status, 400);
    assert.equal((await request('PUT', 'host', room, { from: 'we-ai', slideIndex: 4, language: 'en' })).status, 200);
    assert.deepEqual(await (await request('GET', 'projector', room)).json(),
        { from: 'we-ai', slideIndex: 4, language: 'en', revision: 2 });
    assert.equal((await request('PUT', 'projector', room, { from: 'ai-en', slideIndex: 10 })).status, 200);
    assert.deepEqual(await (await request('GET', 'host', room)).json(),
        { from: 'ai-en', slideIndex: 10, language: 'en', revision: 3, viewer, expiresAt });
    assert.deepEqual(await (await watch(viewer)).json(), { from: 'ai-en', slideIndex: 10, language: 'en', revision: 3 });

    const focused = await (await request('PUT', 'host', room,
        { from: 'we-ai', slideIndex: 6, language: 'en', focus: 3, theme: 'dark' })).json();
    assert.equal(focused.focus, 3);
    assert.equal(focused.revision, 4);
    assert.deepEqual(await (await watch(viewer)).json(), focused);
    assert.equal((await request('PUT', 'projector', room, { from: 'ai-en', slideIndex: 7, focus: 3 })).status, 400);
    assert.equal((await request('PUT', 'host', room, { from: 'we-ai', slideIndex: 6, language: 'en', focus: 100 })).status, 400);
    const manualPage = await (await request('PUT', 'projector', room, { from: 'ai-en', slideIndex: 7 })).json();
    assert.equal(manualPage.focus, undefined);
    assert.equal(manualPage.language, 'en');
    assert.equal(manualPage.theme, 'dark');
    assert.equal((await watch(viewer).then(r => r.json())).theme, 'dark');
    assert.equal((await request('PUT', 'projector', room, { from: 'ai-en', slideIndex: 7, theme: 'light' })).status, 400);
    assert.equal((await request('PUT', 'host', room, { from: 'we-ai', slideIndex: 7, theme: 'invalid' })).status, 400);

    const cue = { start: -500, end: 8400 };
    const cueWrite = { from: 'we-ai', slideIndex: 7, language: 'en', screenCue: cue };
    assert.equal((await request('PUT', 'host', room, cueWrite)).status, 200);
    clock += 5000;
    assert.deepEqual((await (await watch(viewer)).json()).screenCue, { start: -5500, end: 3400 });
    clock += 3500;
    assert.equal((await (await watch(viewer)).json()).screenCue, null);
    assert.equal((await request('PUT', 'host', room, { ...cueWrite, screenCue: { start: 0, end: 30000 } })).status, 400);

    const captions = [{ lang: 'ar', text: 'مرحبًا' }, { lang: 'en', text: 'Hello' }];
    const captionWrite = { from: 'we-ai', language: 'zh', slideIndex: 7, captions };
    assert.equal((await request('PUT', 'host', room, captionWrite)).status, 200);
    assert.deepEqual((await (await watch(viewer)).json()).captions, captions);
    const sizedCaptions = captions.map((line, i) => ({ ...line, size: i ? 'small' : 'large' }));
    assert.equal((await request('PUT', 'host', room, { ...captionWrite, captions: sizedCaptions })).status, 200);
    assert.deepEqual((await (await watch(viewer)).json()).captions, sizedCaptions);
    for (const invalid of [[{ ...captions[0], size: 'huge' }], [...captions, { lang: 'zh', text: '好' }], [captions[0], captions[0]], [{lang:'en',text:'a'.repeat(1001)}]]) {
        assert.equal((await request('PUT', 'host', room, { ...captionWrite, captions:invalid })).status, 400);
    }
    assert.equal((await request('PUT', 'projector', room, { from:'ai-en', slideIndex:7, captions })).status, 400);
    await request('PUT', 'host', room, { ...captionWrite, captions:[] });
    assert.deepEqual((await (await watch(viewer)).json()).captions, []);

    assert.equal((await request('DELETE', 'projector', room)).status, 403);
    assert.equal((await request('DELETE', 'host', room)).status, 204);
    assert.equal((await request('GET', 'projector', room)).status, 404);
    assert.equal((await watch(viewer)).status, 404);
    assert.equal((await watch(viewer, 'outsider', '/deck')).status, 404);
    const limited = await (await request('POST', 'host', null, { from: 'we-ai', slideIndex: 1, hours: 1 })).json();
    clock += 3599999;
    assert.equal((await request('PUT', 'host', limited.room, { from: 'we-ai', slideIndex: 2 })).status, 200);
    clock++;
    assert.equal((await watch(limited.viewer)).status, 404);
    assert.equal((await watch(limited.viewer, null, '/deck')).status, 404);
});
