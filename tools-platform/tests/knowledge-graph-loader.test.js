const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/js/shared/navbar.js'),'utf8');
const helper=source.slice(source.indexOf('async function loadNavLazyScript('),source.indexOf('\nconst SNAPSHOT_API'));
const loader=source.slice(source.indexOf('let toolsKnowledgeGraphLoader ='),source.indexOf('// 对话里的文件卡片与图片放大'));
function fixture(fail=false){
 const requests=[],scripts=[],opens=[],context={window:{},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({version:'fresh-content-hash'})}},document:{createElement:()=>({}),head:{appendChild:script=>{scripts.push(script);queueMicrotask(()=>{if(fail){fail=false;script.onerror();return;}context.window.AIKnowledgeGraph={open:options=>opens.push(options)};script.onload()})}}}};
 vm.runInNewContext(helper+'\n'+loader,context);return {context,requests,scripts,opens};
}
test('graph lazy loader fetches current content hash and shares concurrent loads',async()=>{
 const f=fixture();await Promise.all([f.context.window.openToolsKnowledgeGraph({mode:'knowledge'}),f.context.window.openToolsKnowledgeGraph({mode:'metrics'})]);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.cache,'no-store');
 assert.match(f.requests[0].url,/asset-version\?path=/);
 assert.deepEqual(f.scripts.map(s=>s.src),['/js/shared/ai-knowledge-graph-spatial-themes-v5.js?v=fresh-content-hash']);
 assert.deepEqual(f.opens.map(o=>o.mode),['knowledge','metrics']);
 await f.context.window.openToolsKnowledgeGraph({mode:'chat'});assert.equal(f.scripts.length,1);
});
test('failed graph load can be retried with a fresh version lookup',async()=>{
 const f=fixture(true);await assert.rejects(f.context.window.openToolsKnowledgeGraph(),/知识图谱组件加载失败/);
 await f.context.window.openToolsKnowledgeGraph();assert.equal(f.requests.length,2);assert.equal(f.opens.length,1);
});
