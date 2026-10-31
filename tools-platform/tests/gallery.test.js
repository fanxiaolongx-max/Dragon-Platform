process.env.TOOLS_GALLERY_EXAMPLES = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'picture-island-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const express = require('../backend/node_modules/express'), request = require('supertest');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const db = require('../backend/models/app-db');
const context = require('../backend/models/tenant-context');
const repo = require('../backend/models/gallery-repository');
const service = require('../backend/models/gallery-service');
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    const role = req.headers['x-role'] || 'admin';
    if (role !== 'anonymous') req.user = { username: 'tester', role };
    context.runWithTenant(req.headers['x-tenant'] || 'default', next);
});
app.use('/api/gallery', require('../backend/routes/gallery'));
app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
function png(color = 180, width = 96, height = 64) {
    const image = new PNG({ width, height });
    for (let i = 0; i < image.data.length; i += 4) { image.data[i] = color; image.data[i + 1] = 100; image.data[i + 2] = 150; image.data[i + 3] = 255; }
    return PNG.sync.write(image);
}
const upload = (bytes, fields = {}, tenant = 'default') => {
    let call = request(app).post('/api/gallery/upload').set('x-tenant', tenant);
    for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
    return call.attach('file', bytes, 'poster.png');
};
test.after(async () => { await db.closeDatabase(); await require('../backend/models/tenant-sqlite-pool').closeAll(); fs.rmSync(sandbox, { recursive: true, force: true }); });

test('uploads keep exact originals, generate raster derivatives, group versions and deduplicate within a series', async () => {
    const original = png(), response = await upload(original, { title: 'Autumn poster', category: 'posters' }).expect(201);
    const { item, versionId } = response.body;
    assert.equal(item.versions.length, 1);
    assert.equal(item.versions[0].version_no, 1);
    assert.equal(item.category_id, 'posters');
    const restored = await repo.asset(versionId, 'original');
    assert.deepEqual(restored.bytes, original);
    for (const kind of ['thumbnail', 'preview', 'balanced', 'precise']) {
        const { bytes, mime } = await repo.asset(versionId, kind);
        assert.equal(mime, 'image/jpeg');
        assert.equal(jpeg.decode(bytes).width, 96);
    }
    const repeated = await upload(original, { itemId: item.id }).expect(201);
    assert.equal(repeated.body.duplicate, true);
    assert.equal(repeated.body.versionId, versionId);
    const revised = await upload(png(10), { itemId: item.id, label: 'Approved' }).expect(201);
    assert.equal(revised.body.item.versions.length, 2);
    assert.equal(revised.body.item.versions[0].version_no, 2);
    assert.equal(revised.body.item.versions[0].label, 'Approved');
    const asset = await request(app).get(`/api/gallery/versions/${versionId}/original`).expect(200);
    assert.match(asset.headers['content-disposition'], /attachment/);
    assert.match(asset.headers['cache-control'], /no-store/);
    assert.equal(asset.headers['x-content-type-options'], 'nosniff');
});

test('real image derivatives obey resolution bounds and flatten transparency onto white', async () => {
    const image = new PNG({ width: 1700, height: 20 }); image.data.fill(0);
    const { body } = await upload(PNG.sync.write(image), { title: 'Transparent banner' }).expect(201);
    const id = body.versionId;
    for (const [kind, width] of [['thumbnail',384], ['preview',1600], ['balanced',1024], ['precise',1536]]) {
        const decoded = jpeg.decode((await repo.asset(id, kind)).bytes);
        assert.equal(decoded.width, width); assert.ok(decoded.data[0] > 245); assert.ok(decoded.height >= 1);
    }
});

test('phone EXIF rotation is applied to previews while the original remains unchanged', async () => {
    const image = { width: 40, height: 20, data: Buffer.alloc(40 * 20 * 4, 255) };
    const encoded = jpeg.encode(image, 80).data;
    const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex');
    const header = Buffer.alloc(4); header[0] = 255; header[1] = 225; header.writeUInt16BE(exif.length + 2, 2);
    const original = Buffer.concat([encoded.subarray(0,2),header,exif,encoded.subarray(2)]);
    const uploaded = (await upload(original, { title: 'Phone menu' }).expect(201)).body;
    const preview = jpeg.decode((await repo.asset(uploaded.versionId,'preview')).bytes);
    assert.equal(preview.width,20); assert.equal(preview.height,40);
    assert.deepEqual((await repo.asset(uploaded.versionId,'original')).bytes,original);
});

test('search includes older version text, literal wildcards, filters and stable pagination', async () => {
    const item = (await upload(png(30), { title: 'Hidden restaurant', scope: 'life', category: 'menus' }).expect(201)).body;
    await repo.saveAnalysis(item.versionId, 'balanced', { title: 'Menu', tags: ['中文'], summary: 'A menu', text: 'Garden Bistro 100%_special' });
    await upload(png(31), { itemId: item.item.id }).expect(201);
    const search = await request(app).get('/api/gallery/items').query({ q: '100%_special', scope: 'life', category: 'menus' }).expect(200);
    assert.equal(search.body.total, 1); assert.equal(search.body.items[0].id, item.item.id);
    assert.equal('original' in search.body.items[0], false);
    assert.equal((await request(app).get('/api/gallery/items').query({ q: 'not-present' })).body.total, 0);
    const page = (await request(app).get('/api/gallery/items').query({ page: 999 })).body;
    assert.equal(page.page, page.pages);
    assert.ok(page.items.length <= 36);
});

test('manual categories and metadata work without AI, prevent lost updates and archive reversibly', async () => {
    const category = (await request(app).post('/api/gallery/categories').send({ name: '上海餐厅' }).expect(201)).body;
    assert.equal((await request(app).post('/api/gallery/categories').send({ name: '上海餐厅' })).body.id, category.id);
    const uploaded = (await upload(png(40), { title: '菜单' }).expect(201)).body;
    const url = '/api/gallery/items/' + uploaded.item.id;
    await request(app).patch(url).send({ revision: 0, category_id: 'absent' }).expect(400);
    const updated = (await request(app).patch(url).send({ revision: 0, category_id: category.id, tags: '上海，中文,上海', note: 'Near hotel', favorite: true }).expect(200)).body;
    assert.deepEqual(updated.tags, ['上海', '中文']); assert.equal(updated.favorite, true);
    await request(app).patch(url).send({ revision: 0, title: 'Stale overwrite' }).expect(409);
    const archived = (await request(app).patch(url).send({ revision: updated.revision, archived: true }).expect(200)).body;
    assert.equal((await repo.list({ q: 'Near hotel' })).total, 0);
    assert.equal((await repo.list({ archived: '1', q: 'Near hotel' })).total, 1);
    await upload(png(41), { itemId: uploaded.item.id }).expect(409);
    await request(app).patch(url).send({ revision: archived.revision, archived: false }).expect(200);
    assert.equal((await repo.list({ q: 'Near hotel', favorite: '1' })).total, 1);
});

test('all reads and writes are tenant isolated; readers cannot mutate or invoke AI', async () => {
    const original = (await upload(png(50), { title: 'Tenant secret' }).expect(201)).body;
    const { item, versionId } = original;
    await request(app).get('/api/gallery/items/' + item.id).set('x-tenant', 'other').expect(404);
    await request(app).get(`/api/gallery/versions/${versionId}/preview`).set('x-tenant', 'other').expect(404);
    await upload(png(51), { itemId: item.id }, 'other').expect(404);
    assert.equal((await request(app).get('/api/gallery/items').set('x-tenant','other')).body.total, 0);
    const other = (await upload(png(52), { title: 'Other tenant' }, 'other').expect(201)).body;
    assert.equal((await repo.list({ q: 'Other tenant' })).total, 0);
    await request(app).get('/api/gallery/items/' + other.item.id).expect(404);
    for (const role of ['viewer', 'user']) {
        await request(app).get('/api/gallery/items').set('x-role',role).expect(200);
        assert.equal((await request(app).get('/api/gallery/capabilities').set('x-role',role)).body.canWrite, false);
        await request(app).post('/api/gallery/categories').set('x-role',role).send({ name:'Forbidden' }).expect(403);
        await request(app).patch('/api/gallery/items/' + item.id).set('x-role',role).send({ revision:0 }).expect(403);
        await request(app).post('/api/gallery/upload').set('x-role',role).expect(403);
        await request(app).post(`/api/gallery/versions/${versionId}/analyze`).set('x-role',role).send({ confirmed:true }).expect(403);
    }
    await request(app).get('/api/gallery/items').set('x-role','anonymous').expect(401);
});

test('AI sees exactly one compressed image, caps output, reuses results and never overwrites manual metadata', async () => {
    assert.equal(service.parseAnalysis('{"title":"Menu","categoryId":0}', [{ id:'0', name:'Menu' }]).categoryId, '0');
    const saved = (await upload(png(60), { title:'Manually curated', category:'posters' }).expect(201)).body;
    let calls = 0;
    const client = { generateChat: async options => {
        calls++;
        assert.equal(options.messages.length, 1); assert.equal(options.messages[0].images.length, 1);
        assert.equal(options.maxOutputTokens, calls === 1 ? 650 : 1000);
        const sent = Buffer.from(options.messages[0].images[0].data, 'base64');
        assert.deepEqual(sent, (await repo.asset(saved.versionId, calls === 1 ? 'balanced' : 'precise')).bytes);
        return { text: JSON.stringify({ title:'AI title', categoryId:'invalid-category', suggestedCategory:'Menu', tags:['菜品','餐厅'], summary:'A menu', text:'password=do-not-persist', scope:'life' }) };
    } };
    await assert.rejects(service.analyze(saved.versionId,'balanced',false,client), e => e.status === 400);
    const first = await service.analyze(saved.versionId,'balanced',true,client);
    assert.equal(first.cached,false); assert.equal(first.version.analysis.categoryId,'');
    assert.equal(first.version.analysis.text.includes('do-not-persist'),false);
    assert.equal((await service.analyze(saved.versionId,'balanced',true,client)).cached,true);
    assert.equal(calls,1);
    await service.analyze(saved.versionId,'precise',true,client); assert.equal(calls,2);
    const manual = await repo.read(saved.item.id); assert.equal(manual.title,'Manually curated'); assert.equal(manual.category_id,'posters');
    assert.deepEqual(manual.tags,[]);
});

test('AI outage, malformed response and concurrent requests preserve originals and allow retry', async () => {
    const saved = (await upload(png(70), { title:'Offline safe' }).expect(201)).body;
    const id = saved.versionId;
    await assert.rejects(service.analyze(id,'balanced',true,{ generateChat: async () => { throw new Error('apiKey=never-leak'); } }), e => e.status === 503 && !e.message.includes('never-leak'));
    assert.equal((await repo.readVersion(id)).ai_status,'failed');
    assert.deepEqual((await repo.asset(id,'original')).bytes,png(70));
    await assert.rejects(service.analyze(id,'balanced',true,{ generateChat: async () => ({ text:'not json' }) }),e=>e.status===502);
    let release;
    const pending = service.analyze(id,'balanced',true,{ generateChat: () => new Promise(resolve => { release = resolve; }) });
    while (!release) await new Promise(resolve=>setTimeout(resolve,5));
    await assert.rejects(service.analyze(id,'balanced',true,{}),e=>e.status===429);
    release({ text: JSON.stringify({ title:'Recovered', tags:[], text:'Readable' }) });
    await pending; assert.equal((await repo.readVersion(id)).ai_status,'ready');
});

test('invalid uploads and unknown assets do not create incomplete groups', async () => {
    const before = (await repo.list()).total;
    await upload(Buffer.from('<svg onload="alert(1)"></svg>')).expect(400);
    await upload(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(20)])).expect(422);
    await upload(png(80), { category:'does-not-exist' }).expect(400);
    await request(app).get('/api/gallery/versions/missing/preview').expect(404);
    await request(app).get('/api/gallery/versions/missing/ai_balanced').expect(404);
    assert.equal((await repo.list()).total,before);
});

test('albums collect independent pages, search by restaurant and keep each page history intact', async () => {
    const first = (await upload(png(91),{title:'菜单_上',scope:'life'}).expect(201)).body;
    const second = (await upload(png(92),{title:'菜单_下',scope:'life'}).expect(201)).body;
    await upload(png(93),{itemId:first.item.id,label:'Updated prices'}).expect(201);
    const album = (await request(app).post('/api/gallery/albums').send({name:'日秘料理'}).expect(201)).body;
    assert.equal((await request(app).post('/api/gallery/albums').send({name:'日秘料理'})).body.id,album.id);
    const entries = [first,second].map(row=>({id:row.item.id,revision:row.item.revision}));
    await request(app).post(`/api/gallery/albums/${album.id}/items`).send({items:entries}).expect(200);
    const items = (await request(app).get('/api/gallery/items').query({album:album.id,sort:'title'}).expect(200)).body;
    assert.deepEqual(items.items.map(row=>row.title),['菜单_上','菜单_下']);
    const top = await repo.read(first.item.id), bottom = await repo.read(second.item.id);
    assert.equal(top.versions.length,2);assert.equal(bottom.versions.length,1);
    assert.equal(top.album_name,'日秘料理');assert.equal(top.album_previous,null);assert.equal(top.album_next.id,bottom.id);
    assert.equal(bottom.album_previous.id,top.id);assert.equal(bottom.album_next,null);
    assert.deepEqual((await repo.asset(first.versionId,'original')).bytes,png(91));
    assert.deepEqual((await repo.asset(second.versionId,'original')).bytes,png(92));
    assert.equal((await repo.list({q:'日秘料理'})).total,2);
    assert.equal((await repo.albums()).find(row=>row.id===album.id).item_count,2);
    await request(app).patch('/api/gallery/items/'+bottom.id).send({revision:bottom.revision,archived:true}).expect(200);
    assert.equal((await repo.albums()).find(row=>row.id===album.id).item_count,1);
    assert.equal((await repo.read(top.id)).album_next,null);
    await request(app).patch('/api/gallery/items/'+top.id).send({revision:top.revision,album_id:''}).expect(200);
    assert.equal((await repo.read(top.id)).album_id,'');assert.equal((await repo.read(top.id)).versions.length,2);
    const added = (await upload(png(94),{title:'New album page',album:album.id}).expect(201)).body;
    assert.equal(added.item.album_id,album.id);
    await request(app).post('/api/gallery/albums/none/items').send({items:[{id:added.item.id,revision:added.item.revision}]}).expect(200);
    assert.equal((await repo.read(added.item.id)).album_id,'');
});

test('album bulk moves are atomic, reject stale selections and enforce tenant and writer boundaries', async () => {
    const a = (await upload(png(95),{title:'Atomic A'}).expect(201)).body.item;
    const b = (await upload(png(96),{title:'Atomic B'}).expect(201)).body.item;
    const album = await repo.addAlbum('Atomic album');
    const url = `/api/gallery/albums/${album.id}/items`, entries = [a,b].map(row=>({id:row.id,revision:row.revision}));
    await repo.update(a.id,{revision:a.revision,note:'Changed in another window'});
    await request(app).post(url).send({items:entries}).expect(409);
    assert.equal((await repo.read(a.id)).album_id,'');assert.equal((await repo.read(b.id)).album_id,'');
    await request(app).post(url).send({items:[entries[1],{id:'missing',revision:0}]}).expect(404);
    assert.equal((await repo.read(b.id)).album_id,'');
    await request(app).post(url).send({items:[entries[1],entries[1]]}).expect(400);
    await request(app).post(url).set('x-tenant','album-other').send({items:[entries[1]]}).expect(404);
    await request(app).get('/api/gallery/items').set('x-tenant','album-other').query({album:album.id}).expect(404);
    const own = (await request(app).post('/api/gallery/albums').set('x-tenant','album-other').send({name:'Private album'}).expect(201)).body;
    await request(app).post(`/api/gallery/albums/${own.id}/items`).set('x-tenant','album-other').send({items:[entries[1]]}).expect(404);
    assert.ok(!(await repo.albums()).some(row=>row.id===own.id));
    for(const role of ['viewer','user']) {
        await request(app).get('/api/gallery/albums').set('x-role',role).expect(200);
        await request(app).post('/api/gallery/albums').set('x-role',role).send({name:'Forbidden'}).expect(403);
        await request(app).post(url).set('x-role',role).send({items:[entries[1]]}).expect(403);
    }
    await request(app).get('/api/gallery/albums').set('x-role','anonymous').expect(401);
});

test('album schema migration is repeatable and preserves existing gallery rows',async()=>{
    await context.runWithTenant('gallery-legacy-albums',async()=>{
        await db.run(`CREATE TABLE gallery_items(id TEXT PRIMARY KEY,title TEXT NOT NULL,scope TEXT NOT NULL DEFAULT 'work',category_id TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',note TEXT NOT NULL DEFAULT '',favorite INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
        await db.run('INSERT INTO gallery_items(id,title,note,created_at,updated_at) VALUES(?,?,?,?,?)',['legacy','Existing menu','Keep this note','2026-01-01','2026-01-01']);
        await repo.init();await repo.init();
        const row = await repo.read('legacy');
        assert.equal(row.album_id,'');assert.equal(row.title,'Existing menu');assert.equal(row.note,'Keep this note');
        const album = await repo.addAlbum('Legacy restaurant');
        await repo.assignAlbum(album.id,[{id:row.id,revision:row.revision}]);
        assert.equal((await repo.read('legacy')).album_id,album.id);
    });
});

test('automatic upload fills metadata, creates albums and keeps filed images out of unfiled results',async()=>{
    await context.runWithTenant('auto-gallery',async()=>{
        const client={generateChat:async options=>{
            assert.ok(options.messages[0].images.length<=3);assert.equal(options.maxOutputTokens,900);
            return {text:JSON.stringify({title:'01_招牌菜单',scope:'life',suggestedCategory:'特色菜单',albumName:'Island Kitchen',storageMode:'album',tags:['餐厅','中文'],note:'开罗店 · 中文菜单',versionLabel:'中文版',summary:'菜单上半部'})};
        }};
        const fields={title:'scan',scope:'auto',autoAi:'1',manualFields:'[]'};
        const saved=await service.upload({buffer:png(101),originalname:'scan.png'},null,fields,client);
        assert.equal(saved.aiOrganized,true);assert.equal(saved.item.title,'01_招牌菜单');assert.equal(saved.item.scope,'life');
        assert.deepEqual(saved.item.tags,['餐厅','中文']);assert.equal(saved.item.note,'开罗店 · 中文菜单');
        assert.equal(saved.item.album_name,'Island Kitchen');assert.ok(saved.item.category_id);assert.equal(saved.version.label,'中文版');
        assert.equal((await repo.list({unfiled:'1'})).total,0);assert.equal((await repo.list({q:'Island Kitchen'})).total,1);
        const duplicate=await service.upload({buffer:png(101),originalname:'scan-copy.png'},null,fields,{generateChat(){throw Error('must not call');}});
        assert.equal(duplicate.duplicate,true);assert.equal(duplicate.item.id,saved.item.id);
    });
});

test('manual upload choices override AI title, category, album, purpose, tags, notes, mode and version label',async()=>{
    await context.runWithTenant('manual-gallery',async()=>{
        const category=await repo.addCategory('Human category'),album=await repo.addAlbum('Human album');
        const fields={autoAi:'1',manualFields:JSON.stringify(['title','category_id','album_id','scope','tags','note','storage','version_label']),title:'Human title',category:category.id,album:album.id,scope:'work',tags:'Human tag',note:'Human note',label:'Human version'};
        const saved=await service.upload({buffer:png(102),originalname:'human.png'},null,fields,{generateChat:async()=>({text:JSON.stringify({title:'AI title',scope:'life',suggestedCategory:'AI category',albumName:'AI album',storageMode:'album',tags:['AI tag'],note:'AI note',versionLabel:'AI version'})})});
        assert.equal(saved.item.title,'Human title');assert.equal(saved.item.category_id,category.id);assert.equal(saved.item.album_id,album.id);
        assert.equal(saved.item.scope,'work');assert.deepEqual(saved.item.tags,['Human tag']);assert.equal(saved.item.note,'Human note');assert.equal(saved.version.label,'Human version');
    });
});

test('automatic version detection appends only a validated visual candidate, preserving the original history',async()=>{
    await context.runWithTenant('version-gallery',async()=>{
        const first=await service.upload({buffer:png(103),originalname:'poster-v1.png'},null,{title:'Campaign'});
        const next=await service.upload({buffer:png(104),originalname:'poster-v2.png'},null,{title:'fallback',autoAi:'1',manualFields:'[]'},
            {generateChat:async options=>{assert.equal(options.messages[0].images.length,2);return {text:JSON.stringify({title:'Campaign',storageMode:'version',versionOf:'0',confidence:.98,versionLabel:'客户确认稿'})};}});
        assert.equal(next.item.id,first.item.id);assert.equal(next.item.versions.length,2);assert.equal(next.item.versions[0].label,'客户确认稿');
        assert.deepEqual((await repo.asset(next.versionId,'original')).bytes,png(104));assert.equal((await repo.list()).total,1);
        const other=await service.upload({buffer:png(105),originalname:'menu.png'},null,{title:'fallback',autoAi:'1',manualFields:'[]'},
            {generateChat:async()=>({text:JSON.stringify({title:'Another menu page',storageMode:'version',versionOf:'forged-tenant-id',confidence:1})})});
        assert.notEqual(other.item.id,first.item.id);assert.equal(other.item.versions.length,1);
    });
});

test('manual edits during recognition win, and AI outage preserves the uploaded original',async()=>{
    await context.runWithTenant('concurrent-gallery',async()=>{
        let release;
        const pending=service.upload({buffer:png(106),originalname:'concurrent.png'},null,{title:'concurrent',autoAi:'1',manualFields:'[]'},
            {generateChat:()=>new Promise(resolve=>{release=resolve;})});
        while(!release)await new Promise(resolve=>setTimeout(resolve,5));
        const source=(await repo.list()).items[0];await repo.update(source.id,{revision:source.revision,note:'My note',scope:'life'});
        release({text:JSON.stringify({title:'AI title',note:'AI overwrite',scope:'work'})});
        const result=await pending;assert.equal(result.item.note,'My note');assert.equal(result.item.scope,'life');
        const offline=await service.upload({buffer:png(107),originalname:'offline.png'},null,{title:'offline',autoAi:'1',manualFields:'[]'},
            {generateChat:async()=>{throw Error('password=never-show');}});
        assert.ok(offline.aiWarning);assert.ok(!offline.aiWarning.includes('never-show'));assert.deepEqual((await repo.asset(offline.versionId,'original')).bytes,png(107));
    });
});

test('different named menu pages cannot be merged as versions even if AI proposes a confident match',async()=>{
    await context.runWithTenant('menu-page-safety',async()=>{
        const top=await service.upload({buffer:png(111),originalname:'菜单_上.png'},null,{title:'菜单_上'});
        const bottom=await service.upload({buffer:png(112),originalname:'菜单_下.png'},null,{autoAi:'1',manualFields:'[]'},
            {generateChat:async()=>({text:JSON.stringify({title:'菜单下半部',storageMode:'version',versionOf:'0',confidence:1,albumName:'Menu restaurant',scope:'life'})})});
        assert.notEqual(top.item.id,bottom.item.id);assert.equal(bottom.item.versions.length,1);assert.equal(bottom.item.album_name,'Menu restaurant');
    });
});

test('home includes filed work posters and unfiled life pictures while keeping filed life pictures in albums',async()=>{
    await context.runWithTenant('gallery-home-work',async()=>{
        const album=await repo.addAlbum('Collection');
        const files=[];
        for(const [color,title,scope,group] of [[121,'Filed poster','work',album.id],[122,'Unfiled poster','work',''],[123,'Filed menu','life',album.id],[124,'Loose life picture','life','']]){
            files.push((await service.upload({buffer:png(color),originalname:title+'.png'},null,{title,scope,album:group})).item);
        }
        assert.deepEqual((await repo.list({home:'1',sort:'title'})).items.map(item=>item.title),['Filed poster','Loose life picture','Unfiled poster']);
        assert.equal((await repo.list({album:album.id})).total,2);
        const poster=files[0];await repo.update(poster.id,{revision:poster.revision,archived:true});
        assert.equal((await repo.list({home:'1'})).total,2);
        assert.equal((await context.runWithTenant('gallery-home-other',()=>repo.list({home:'1'}))).total,0);
    });
});

test('batch delete is confirmed, tenant isolated, atomic and reversible with all versions intact',async()=>{
    const a=(await upload(png(108),{title:'Trash A'},'trash-gallery').expect(201)).body;
    const b=(await upload(png(109),{title:'Trash B'},'trash-gallery').expect(201)).body;
    const entries=[a,b].map(row=>({id:row.item.id,revision:row.item.revision}));
    await request(app).delete('/api/gallery/items').set('x-tenant','trash-gallery').send({items:entries}).expect(400);
    await request(app).delete('/api/gallery/items').set('x-tenant','other-trash').send({items:entries,confirmed:true}).expect(404);
    await request(app).delete('/api/gallery/items').set('x-tenant','trash-gallery').set('x-role','viewer').send({items:entries,confirmed:true}).expect(403);
    await request(app).delete('/api/gallery/items').set('x-tenant','trash-gallery').send({items:[entries[0],{id:'missing',revision:0}],confirmed:true}).expect(404);
    assert.equal((await request(app).get('/api/gallery/items').set('x-tenant','trash-gallery')).body.total,2);
    await request(app).delete('/api/gallery/items').set('x-tenant','trash-gallery').send({items:entries,confirmed:true}).expect(200);
    assert.equal((await request(app).get('/api/gallery/items').set('x-tenant','trash-gallery')).body.total,0);
    const deleted=(await request(app).get('/api/gallery/items').set('x-tenant','trash-gallery').query({trash:'1'})).body.items;
    assert.equal(deleted.length,2);
    await request(app).patch('/api/gallery/items/'+a.item.id).set('x-tenant','trash-gallery').send({revision:deleted[0].revision,title:'No resurrection'}).expect(409);
    await request(app).post('/api/gallery/items/restore').set('x-tenant','trash-gallery').send({items:deleted.map(row=>({id:row.id,revision:row.revision}))}).expect(200);
    assert.equal((await request(app).get('/api/gallery/items').set('x-tenant','trash-gallery')).body.total,2);
    await context.runWithTenant('trash-gallery',async()=>assert.deepEqual((await repo.asset(a.versionId,'original')).bytes,png(108)));
});
