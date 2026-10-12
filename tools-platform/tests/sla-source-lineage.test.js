const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../frontend/js/sla/upload.js'),'utf8');const events=fs.readFileSync(require.resolve('../frontend/js/sla/events.js'),'utf8');const helpers=events.slice(events.indexOf('function getMetricRuleConditions'),events.indexOf('function buildMetricConditionFieldOptions'));
function context(){const requests=[];const state={};const window={AppState:state,GlobalMetrics:{},GlobalTargets:{},SLATargetMonth:{get:()=>9},SLASourceArchive:{archive:async files=>{requests.push(['archive',files]);return 'batch-1';},withLock:fn=>fn()}};const dom={items:[],main:{innerHTML:''}};const ctx=vm.createContext({window,Blob,console:{log(){},error(){},warn(){},info(){}},document:{querySelectorAll:()=>[],getElementById:id=>id==='sticky-bar-content'?{querySelectorAll:()=>dom.items}:dom.main},API:{post:async(url,payload)=>requests.push([url,JSON.parse(JSON.stringify(payload))])},showToast(){},alert(){},setTimeout,SLAT:k=>k,metricRuleRowMatches:()=>true});vm.runInContext(helpers,ctx);vm.runInContext(source,ctx);return {ctx,window,requests,dom};}
test('SLA uploads archive all selected originals before month filtering, even when none match',async()=>{const {ctx,window,requests}=context();window.SLATargetMonth.get=()=>10;const files=[{name:'PBI_自动抓取-风险详单_Latest_2026年9月.csv'}];ctx.files=files;await vm.runInContext('processBatchFiles(files)',ctx);assert.equal(requests[0][0],'archive');assert.equal(JSON.stringify(requests[0][1]),JSON.stringify(files));assert.equal(requests.length,1);});
test('snapshot stores unique rule keys, corresponding files and matched cleaned rows even with identical labels',async()=>{const {ctx,window,requests,dom}=context();const rule={id:'count',type:'count',colX:'network',valY:'A',colZ:'status',valK:'open'};window.AppState.one={title:'One',sourceFiles:['one.csv'],orderedHeaders:['network','status'],globalData:[{network:'A',status:'open'},{network:'B',status:'open'}],customMetrics:[rule]};window.AppState.two={title:'Two',sourceFiles:['two.csv'],orderedHeaders:['network','status'],globalData:[{network:'A',status:'closed'},{network:'A',status:'open'}],customMetrics:[rule]};window.GlobalMetrics={one_count:{label:'Same label'},two_count:{label:'Same label'}};dom.items=['one_count','two_count'].map(key=>({dataset:{metricKey:key},classList:{contains:()=>false},querySelector:selector=>selector==='.info-label'?{innerText:'Same label:'}:selector==='.info-value'?{innerText:'1',classList:{contains:()=>false}}:null}));ctx.dom=dom;await vm.runInContext("captureAndUploadSnapshot(['one.csv','two.csv'],{sourceBatchId:'batch-1'})",ctx);const snapshot=requests.find(item=>item[0]==='/api/sla/snapshot')[1];assert.equal(snapshot.sourceBatchId,'batch-1');assert.deepEqual(snapshot.topMetrics.map(metric=>metric.key),['one_count','two_count']);assert.deepEqual(snapshot.topMetrics[0].sourceFiles,['one.csv']);assert.deepEqual(snapshot.topMetrics[0].sourceSelections,[{sectionKey:'one',indexes:[0]}]);assert.deepEqual(snapshot.topMetrics[1].sourceSelections,[{sectionKey:'two',indexes:[1]}]);assert.equal(snapshot.sourceSections.length,2);});

test('disabled original archive reads current server setting and skips files without blocking extraction',async()=>{
 const calls=[];const status={setAttribute(){},style:{},textContent:''};const window={};
 const ctx=vm.createContext({window,document:{createElement:()=>status,querySelector:()=>({after(){}})},getAuthHeaders:()=>({}),handleResponse:async r=>r,fetch:async url=>{calls.push(url);return {uploadOriginals:false};},FormData,console});
 vm.runInContext(fs.readFileSync(require.resolve('../frontend/js/sla/source-archive.js'),'utf8'),ctx);
 assert.equal(await window.SLASourceArchive.archive([{name:'months.xlsx'}]),null);
 assert.deepEqual(calls,['/api/upload/import-settings']);assert.match(status.textContent,/已关闭/);
 const extraction=context();extraction.window.SLASourceArchive.archive=()=>window.SLASourceArchive.archive([{name:'months.xlsx'}]);
 await vm.runInContext("captureAndUploadSnapshot(['months.xlsx'],{sourceBatchId:null})",extraction.ctx);
 const snapshot=extraction.requests.find(item=>item[0]==='/api/sla/snapshot')[1];assert.equal(snapshot.sourceBatchId,null);
});

function archiveReviewContext(files,sheets){
 const {ctx,window,requests}=context();const main={innerHTML:'existing workspace'},nav={innerHTML:'',style:{},querySelector:()=>null,prepend(note){this.note=note;}};const cached=new Map();const initialized=[];
 ctx.escapeHTML=s=>String(s);ctx.localStorage={setItem:(k,v)=>cached.set(k,v),removeItem:k=>cached.delete(k)};
 ctx.document={head:{appendChild(){}},createElement:()=>({style:{}}),querySelector:()=>null,querySelectorAll:()=>[],getElementById:id=>id==='main-wrapper'?main:id==='summary-nav-area'?nav:null};
 ctx.API.get=async url=>{requests.push(['GET',url]);return {files};};
 window.SLASourceArchive.readArchivedWorksheets=async file=>sheets(file);
 window.SLASection={initSection:async(...args)=>{initialized.push(args);window.AppState[args[0]]={sourceData:args[3]};}};
 return {ctx,window,requests,main,nav,cached,initialized};
}
test('archive review restores all batch files, sheets and months without writes, ignores current target month',async()=>{
 const files=[{id:'a',batch_id:'batch',name:'Latest_2026年9月.xlsx'},{id:'b',batch_id:'batch',name:'Latest_2026年11月.xlsx'},{id:'foreign',batch_id:'other',name:'other.csv'}];
 const c=archiveReviewContext(files,async file=>file.id==='a'?[{name:'Nine and ten',rows:[{month:9,value:0},{month:10,value:2}]},{name:'Unconfigured',rows:[{month:12}]}]:[{name:'Eleven',rows:[{month:11}]}]);
 c.window.SLATargetMonth.get=()=>1;const result=await c.window.SLAUpload.loadArchivedSnapshot({id:'history',timestamp:'2026-09-01T00:00:00Z',sourceBatchId:'batch'});
 assert.equal(result.files,2);assert.equal(result.sheets,3);assert.equal(c.initialized.length,2);assert.deepEqual(c.initialized.flatMap(args=>args[3].map(row=>row.month)),[9,10,11,12]);assert.equal(c.initialized[0][3][0].value,0);
 assert.ok(c.initialized.every(args=>args[7].reviewOnly));assert.ok(c.requests.every(([method])=>method==='GET'));
 const cache=JSON.parse(c.cached.get('sla_last_import_workspace_v1'));assert.equal(cache.meta.type,'archive-review');assert.equal(cache.meta.sourceSnapshotId,'history');assert.equal(cache.sections.length,2);
});
test('missing originals or failed worksheet reads preserve the current workspace',async()=>{
 const c=archiveReviewContext([{id:'broken',batch_id:'batch',name:'broken.xls'}],async()=>{throw new Error('Unable to parse');});c.window.AppState.existing={marker:7};
 await assert.rejects(c.window.SLAUpload.loadArchivedSnapshot({sourceBatchId:null}),/sla.history.noOriginals/);
 await assert.rejects(c.window.SLAUpload.loadArchivedSnapshot({sourceBatchId:'batch'}),/Unable to parse/);
 assert.equal(c.main.innerHTML,'existing workspace');assert.equal(c.window.AppState.existing.marker,7);assert.equal(c.initialized.length,0);
});

test('old archive-review caches repair Chinese titles from original file identity without changing rows or uploading',async()=>{
 const file={id:'chinese-original',name:'PBI_自动抓取-风险详单_Latest.csv',sheets:[{name:'Sheet1'}]};const c=archiveReviewContext([file],async()=>[]);
 c.ctx.localStorage.getItem=key=>c.cached.get(key)||null;
 const secId='other_archive_'+vm.runInContext("generateSchemaHash('chinese-original@@Sheet1')",c.ctx);
 const corrupt=Buffer.from(file.name,'utf8').toString('latin1');const payload={version:1,savedAt:'2026-10-10T09:00:00Z',meta:{type:'archive-review',sourceTimestamp:'2026-10-10T09:00:00Z',originalFileCount:1,worksheetCount:1,files:[corrupt]},sections:[{secId,mode:'other',title:corrupt+' / Sheet1',baseName:corrupt+' / Sheet1',sourceFiles:[corrupt],data:[{month:9,value:0},{month:10,value:4}]}]};
 c.cached.set('sla_last_import_workspace_v1',JSON.stringify(payload));assert.equal(await c.window.SLAUpload.restoreCachedWorkspace(),true);
 assert.equal(c.initialized[0][2],file.name+' / Sheet1');assert.equal(c.initialized[0][5],file.name+' / Sheet1');assert.deepEqual(JSON.parse(JSON.stringify(c.initialized[0][3])),payload.sections[0].data);assert.deepEqual(JSON.parse(JSON.stringify(c.initialized[0][6])),[file.name]);
 const restored=JSON.parse(c.cached.get('sla_last_import_workspace_v1'));assert.equal(restored.sections[0].secId,secId);assert.equal(restored.meta.files[0],file.name);assert.equal(restored.meta.archiveNamesVersion,1);assert.equal(restored.savedAt,payload.savedAt);assert.ok(c.requests.every(([method])=>method==='GET'));
});

test('archive review restores specific import types, original metric keys and saved rule configuration; extra sheets stay available',async()=>{
 const modes=['rectification','risk','special','sr','vulnerability'];const files=modes.map(mode=>({id:mode,batch_id:'batch',name:mode+'.csv'}));
 const c=archiveReviewContext(files,async()=>[{name:'Sheet1',rows:[{status:'open',value:7}]}]);
 const sourceSections=modes.map(mode=>({key:mode,mode,title:mode,sourceFiles:[mode+'.csv'],schemaHash:'sla_prefs_'+mode+'_original',rules:[{id:'count',label:mode,type:'count',colZ:'status',valK:'open'}]}));
 await c.window.SLAUpload.loadArchivedSnapshot({sourceBatchId:'batch',sourceSections,files:files.map(file=>file.name),selectedTargetMonth:9,timestamp:'2026-09-30T00:00:00Z'});
 const orderedModes=['rectification','special','risk','sr','vulnerability'];assert.deepEqual(c.initialized.map(args=>args[0]),orderedModes);assert.deepEqual(c.initialized.map(args=>args[1]),orderedModes);assert.equal(c.initialized[2][7].originalSchemaHash,'sla_prefs_risk_original');assert.equal(c.initialized[1][7].savedRules[0].id,'count');
 const cache=JSON.parse(c.cached.get('sla_last_import_workspace_v1'));assert.equal(cache.meta.reviewMonitoringVersion,1);assert.equal(cache.sections[1].savedRules[0].id,'count');assert.equal(cache.sections[2].originalSchemaHash,'sla_prefs_risk_original');assert.ok(c.requests.every(([method])=>method==='GET'));
});

test('new snapshots explicitly leave unknown core metrics unlinked and give cross-source children their own origin',async()=>{
 const {ctx,window,requests,dom}=context();const rule={id:'main',type:'extract',colX:'name',valY:'A',colZ:'value',subMetrics:[{id:'child',category:'TE',sourceSecId:'two',colZ:'value'}]};
 window.AppState.one={sourceFiles:['one.csv'],orderedHeaders:['name','value'],globalData:[{name:'A',value:10}],customMetrics:[rule]};window.AppState.two={sourceFiles:['two.csv'],orderedHeaders:['name','value'],globalData:[{name:'B',value:2}],customMetrics:[]};window.GlobalMetrics={one_main:{label:'主指标'},core:{label:'IBMS'}};
 dom.items=['one_main','core'].map(key=>({dataset:{metricKey:key},classList:{contains:()=>false},querySelector:selector=>selector==='.info-label'?{innerText:key==='core'?'IBMS:':'主指标:'}:selector==='.info-value'?{innerText:'10',classList:{contains:()=>false}}:selector==='.sub-metrics-list'&&key==='one_main'?{querySelectorAll:()=>[{innerText:'TE:2'}]}:null}));
 await vm.runInContext("captureAndUploadSnapshot(['one.csv','two.csv'],{sourceBatchId:'batch-1'})",ctx);const saved=requests.find(item=>item[0]==='/api/sla/snapshot')[1];assert.deepEqual(saved.topMetrics[0].sourceSectionKeys,['one']);assert.deepEqual(saved.topMetrics[0].subMetrics[0].sourceSectionKeys,['two']);assert.deepEqual(saved.topMetrics[0].subMetrics[0].sourceFiles,['two.csv']);assert.equal(saved.topMetrics[1].sourceLinkVersion,2);assert.deepEqual(saved.topMetrics[1].sourceSectionKeys,[]);assert.deepEqual(saved.topMetrics[1].sourceFiles,[]);
});
