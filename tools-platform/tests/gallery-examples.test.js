const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'gallery-examples-'));
process.env.TOOLS_DATA_DIR = root;
process.env.TOOLS_GALLERY_EXAMPLES = '0';
const db = require('../backend/models/app-db');
const repo = require('../backend/models/gallery-repository');
const transaction = require('../backend/models/gallery-transaction');
const context = require('../backend/models/tenant-context');
const examples = require('../backend/models/gallery-examples');
const catalog = require('../backend/models/gallery-example-catalog');
test.after(async()=> { await db.closeDatabase(); await require('../backend/models/tenant-sqlite-pool').closeAll(); fs.rmSync(root,{recursive:true,force:true}); });

test('bundled examples contain only compact thumbnails, and media release plan uses verified originals',()=> {
    const source = catalog.checkManifest();
    assert.equal(source.items.length,9); assert.equal(Object.keys(source.assets).length,11);
    assert.deepEqual(fs.readdirSync(catalog.directory).sort(),['catalog.json','thumbnails']);
    const thumbSize = Object.keys(source.assets).reduce((n,key)=>n+catalog.thumbnail(key).length,0);
    assert.ok(thumbSize < 512000);
    const plans = require('../scripts/sync-media-releases').planReleases([{catalog:source,directory:root,manifest:catalog.manifestPath}]);
    assert.equal(plans.length,1); assert.equal(plans[0].assets.length,11);
    assert.match(require('../package.json').build.files.join('\n'),/!backend\/\{data,backups,factory-reset-archives,logs,tmp,runtime,node_modules\}/);
});
test('seed is atomic, idempotent, keeps version groups and trash, and stores no original binaries',async()=> {
    await repo.init(); await transaction(examples.seed);
    assert.equal((await repo.list()).total,9);
    assert.equal((await repo.list({home:'1'})).total,7);
    assert.deepEqual(await db.get('SELECT COUNT(*) AS count,SUM(length(original)) AS bytes FROM gallery_versions'),{count:11,bytes:0});
    const summer = catalog.read().items.find(i=>i.versions.length===3);
    const item = await repo.read(summer.id);
    assert.equal(item.versions.length,3);
    assert.equal(item.versions[0].source,'builtin-example');
    assert.ok(item.versions[0].original_bytes>1000000);
    assert.ok((await repo.asset(item.versions[0].id,'thumbnail')).bytes.length>1000);
    await repo.trash([{id:item.id,revision:item.revision}]);
    await transaction(examples.seed); assert.equal((await repo.list()).total,8);
    assert.equal((await repo.list({trash:'1'})).total,1);
    await context.runWithTenant('other',async()=> { await repo.init(); assert.equal((await repo.list()).total,0); await transaction(examples.seed); assert.equal((await repo.list()).total,9); });
    assert.equal((await repo.list()).total,8);
});
test('matching user images retain metadata and binaries; explicit adoption only switches media source',async()=> {
    await context.runWithTenant('existing',async()=> {
        await repo.init(); const item=catalog.read().items[0], v=item.versions[0], meta=catalog.asset(v.file);
        // An existing upload can have the same hash while preserving its own title/album.
        await db.run("INSERT INTO gallery_items(id,title,scope,created_at,updated_at) VALUES('mine','My edited title','life','now','now')");
        await db.run(`INSERT INTO gallery_versions(id,item_id,version_no,label,filename,mime,original,thumbnail,preview,ai_balanced,ai_precise,width,height,sha256,created_at)
            VALUES('mine-v','mine',1,'edited','mine.png','image/png',X'010203',X'',X'',X'',X'',1,1,?,'now')`,[meta.sha256]);
        await transaction(examples.seed);
        assert.equal((await repo.read('mine')).title,'My edited title');
        assert.equal((await repo.readVersion('mine-v')).example_key,'');
        await transaction(db=>examples.seed(db,{adoptExisting:true}));
        assert.equal((await repo.readVersion('mine-v')).source,'builtin-example');
        assert.equal((await db.get("SELECT length(original) AS size FROM gallery_versions WHERE id='mine-v'")).size,3);
        assert.equal((await repo.list()).total,9);
    });
});
test('remote media rejects untrusted redirects, wrong hashes, oversized payloads and offline failures',async()=> {
    const key=Object.keys(catalog.read().assets)[0];
    await assert.rejects(examples.fetchOriginal(key,async()=>new Response('',{status:302,headers:{location:'https://example.com/private'}})),/redirect/);
    await assert.rejects(examples.fetchOriginal(key,async()=>new Response('corrupt')),/checksum/);
    await assert.rejects(examples.fetchOriginal(key,async()=>new Response(Buffer.alloc(catalog.asset(key).size+1))),/large/);
    await assert.rejects(examples.original(key,{cacheDir:path.join(root,'offline'),fetcher:async()=>{throw Error('offline');}}),error=>error.status===503);
    assert.ok((await examples.asset(key,'thumbnail')).bytes.length>1000);
    assert.throws(()=>catalog.asset('../../other'));
});
test('validated tenant cache is reused; corrupt bytes are never served',async(t)=> {
    const key=Object.keys(catalog.read().assets)[0], meta=catalog.asset(key), directory=path.join(root,'cache');
    fs.mkdirSync(directory); fs.writeFileSync(path.join(directory,meta.sha256),'corrupt');
    await assert.rejects(examples.original(key,{cacheDir:directory,fetcher:async()=>new Response('wrong')}),error=>error.status===503);
    const bytes=Buffer.from('verified fixture'), hash=catalog.digest(bytes);
    t.mock.method(catalog,'asset',()=>({...meta,size:bytes.length,sha256:hash}));
    let requests=0;
    const fetcher=async()=> { requests++; return new Response(bytes); };
    const [a,b]=await Promise.all([examples.original(key,{cacheDir:directory,fetcher}),examples.original(key,{cacheDir:directory,fetcher})]);
    assert.deepEqual(a,bytes); assert.deepEqual(b,bytes); assert.equal(requests,1);
    assert.deepEqual(await examples.original(key,{cacheDir:directory,fetcher}),bytes); assert.equal(requests,1);
    fs.writeFileSync(path.join(directory,hash),'broken');
    assert.deepEqual(await examples.original(key,{cacheDir:directory,fetcher}),bytes); assert.equal(requests,2);
});
test('normal first access installs examples independently for a fresh tenant',async()=> {
    process.env.TOOLS_GALLERY_EXAMPLES='1';
    try { await context.runWithTenant('fresh-auto',async()=> assert.equal((await repo.list()).total,9)); }
    finally { process.env.TOOLS_GALLERY_EXAMPLES='0'; }
});
test('original and all derivatives persist across module reloads; concurrent views compress only once',async(t)=> {
    const key=Object.keys(catalog.read().assets)[0], meta=catalog.asset(key);
    const {PNG}=require('pngjs'), image=new PNG({width:32,height:24}); image.data.fill(255);
    const bytes=PNG.sync.write(image), hash=catalog.digest(bytes);
    t.mock.method(catalog,'asset',()=>({...meta,size:bytes.length,sha256:hash}));
    const service=require('../backend/models/gallery-service'), compress=service.compress;
    let requests=0, compressions=0;
    t.mock.method(service,'compress',async bytes=> {compressions++;return compress(bytes);});
    const fetcher=async()=> {requests++;return new Response(bytes);};
    await context.runWithTenant('cache-a',async()=> {
        const kinds=['preview','balanced','precise'];
        const first=await Promise.all(kinds.map(kind=>examples.asset(key,kind,{fetcher})));
        assert.equal(requests,1);assert.equal(compressions,1);
        assert.match(examples.cacheDirectory(),/cache-a[/\\]runtime[/\\]gallery-examples$/);
        delete require.cache[require.resolve('../backend/models/gallery-examples')];
        const restarted=require('../backend/models/gallery-examples');
        const offline=async()=>{throw Error('offline');};
        for (const [i,kind] of kinds.entries()) assert.deepEqual(await restarted.asset(key,kind,{fetcher:offline}),first[i]);
        assert.deepEqual(await restarted.original(key,{fetcher:offline}),bytes);
        assert.equal(requests,1);assert.equal(compressions,1);
        fs.writeFileSync(path.join(restarted.cacheDirectory(),`${hash}.derivatives-v1.preview`),'broken');
        assert.deepEqual(await restarted.asset(key,'preview',{fetcher:offline}),first[0]);
        assert.equal(compressions,2,'corrupt derivative is rebuilt from the local original');
    });
    await context.runWithTenant('cache-b',async()=> {
        await assert.rejects(examples.original(key,{fetcher:async()=>{throw Error('offline');}}),error=>error.status===503);
        assert.ok(!fs.existsSync(path.join(examples.cacheDirectory(),hash)),'a different tenant does not reuse another tenant cache');
    });
});
test('previous temporary downloads migrate locally without another media request',async(t)=> {
    const key=Object.keys(catalog.read().assets)[0], meta=catalog.asset(key),bytes=Buffer.from('legacy fixture');
    const hash=catalog.digest(bytes);
    t.mock.method(catalog,'asset',()=>({...meta,size:bytes.length,sha256:hash}));
    await context.runWithTenant('legacy-cache',async()=> {
        const legacy=path.join(context.getDataDir(),'tmp','gallery-examples',hash);
        fs.mkdirSync(path.dirname(legacy),{recursive:true});fs.writeFileSync(legacy,bytes);
        assert.deepEqual(await examples.original(key,{fetcher:async()=>{throw Error('must not download');}}),bytes);
        assert.deepEqual(fs.readFileSync(path.join(examples.cacheDirectory(),hash)),bytes);
        assert.ok(fs.existsSync(legacy),'migration preserves the older copy');
    });
});
