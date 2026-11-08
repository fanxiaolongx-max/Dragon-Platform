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
