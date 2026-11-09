const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-model-catalog-'));
process.env.CODEX_HOME=path.join(root,'codex');process.env.WORKBUDDY_CONFIG_DIR=path.join(root,'workbuddy');
const models=require('../backend/models/desktop-agents/models');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('Codex and WorkBuddy catalogs use native visible models and the CLI member allowlist',async()=>{
 fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
 fs.writeFileSync(path.join(process.env.CODEX_HOME,'models_cache.json'),JSON.stringify({identity:'never expose',models:[{slug:'gpt-visible',display_name:'Visible',visibility:'list'},{slug:'gpt-hidden',visibility:'hide'}]}));
 const dir=path.join(process.env.WORKBUDDY_CONFIG_DIR,'cache');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'acc-product-config-v3-fixture.json'),JSON.stringify({secret:'never expose',models:[{id:'hy-fixture',name:'Hy'},{id:'internal',name:'Hidden internal'},{id:'off',disabled:true}],agents:[{name:'cli',models:['hy-fixture','off']}]}));
 assert.deepEqual(await models.list('codex',{force:true}),[{id:'gpt-visible',name:'Visible'}]);
 assert.deepEqual(await models.list('workbuddy',{force:true}),[{id:'hy-fixture',name:'Hy'}]);
 assert.equal(await models.validate('codex',''),'');assert.equal(await models.validate('codex','gpt-visible'),'gpt-visible');
 await assert.rejects(models.validate('codex','hy-fixture'));await assert.rejects(models.validateMap({codex:['a','b']},['codex']));
 await assert.rejects(models.validateMap({workbuddy:'hy-fixture'},['codex']));
 assert.deepEqual(await models.validateMap({codex:'',workbuddy:'hy-fixture'},['codex','workbuddy']),{codex:'',workbuddy:'hy-fixture'});
});


test('native catalogs refresh on the first open of a new calendar day, not every page open',async()=>{
 const file=path.join(process.env.CODEX_HOME,'models_cache.json');
 fs.writeFileSync(file,JSON.stringify({models:[{slug:'day-one',display_name:'Day one',visibility:'list'}]}));
 assert.equal((await models.list('codex',{day:'2026-12-01'}))[0].id,'day-one');
 fs.writeFileSync(file,JSON.stringify({models:[{slug:'day-two',display_name:'Day two',visibility:'list'}]}));
 assert.equal((await models.list('codex',{day:'2026-12-01'}))[0].id,'day-one','same-day opens reuse the loaded list');
 assert.equal((await models.list('codex',{day:'2026-12-02'}))[0].id,'day-two','the next day rereads the native source');
 await assert.rejects(models.list('codex',{day:'invalid'}));
});

test('Claude catalogs are read from the native menu once and then served from storage without touching the app',async()=>{
    const claude=require('../backend/models/desktop-agents/claude-desktop'),original=claude.models,saved=models.stored.save,read=models.stored.read;
    let store=null,uiReads=0;
    models.stored.save=async(_,items)=>{store=items;};models.stored.read=async()=>store||[];
    claude.models=async()=>{uiReads++;return [{id:'Opus 5.5',name:'Opus 5.5'}];};
    try{
        models.memo.delete('claudecode');
        assert.deepEqual(await models.list('claudecode',{cached:true}),[],'page renders never open the native menu');
        assert.equal(uiReads,0);
        assert.equal((await models.list('claudecode'))[0].id,'Opus 5.5');
        models.memo.delete('claudecode'); // 模拟服务重启
        assert.equal((await models.list('claudecode',{day:'2099-01-01'}))[0].id,'Opus 5.5','a new day reuses the stored list');
        assert.equal((await models.list('claudecode',{cached:true}))[0].id,'Opus 5.5');
        assert.equal(uiReads,1);
        await models.list('claudecode',{force:true});
        assert.equal(uiReads,2,'explicit refresh still reads the app');
    } finally {claude.models=original;models.stored.save=saved;models.stored.read=read;models.memo.delete('claudecode');}
});
