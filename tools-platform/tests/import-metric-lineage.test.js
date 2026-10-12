const test=require('node:test'),assert=require('node:assert/strict');const {resolveMetricSource,linkMetric}=require('../backend/models/import-metric-lineage');
const files=[{id:'wfm',name:'WFM.csv'},{id:'sr',name:'SR.csv'}];const sections=[{key:'wfm',sourceFiles:['WFM.csv'],headers:['operation'],rules:[{id:'operation',label:'本年操作量'}]},{key:'sr',sourceFiles:['SR.csv'],headers:['issues'],rules:[{id:'issues',label:'SR数量'}]}];const names=files.map(f=>f.name);
test('legacy batch-wide names and stale IDs are narrowed by section, rule owner and stable key',()=>{
 for(const metric of [{sourceSection:'wfm'},{rule:{sourceSecId:'wfm'}},{key:'wfm_operation'},{rule:{id:'operation'}},{sourceSelections:[{sectionKey:'wfm',indexes:[]}]}])assert.deepEqual(resolveMetricSource({...metric,fileIds:['wfm','sr'],sourceFiles:names},sections,files,names).fileIds,['wfm']);
});
test('Chinese and English unique saved rule names and unique columns recover sources without fuzzy filenames',()=>{
 assert.deepEqual(resolveMetricSource({label:'本年操作量',sourceFiles:names},sections,files,names).fileIds,['wfm']);assert.deepEqual(resolveMetricSource({rule:{colZ:'issues'},sourceFiles:names},sections,files,names).fileIds,['sr']);
 const duplicates=sections.map(s=>({...s,headers:['value'],rules:[{id:'same',label:'Shared'}]}));assert.equal(resolveMetricSource({label:'Shared',rule:{id:'same',colZ:'value'},sourceFiles:names},duplicates,files,names).sourceLinkStatus,'unresolved');
});
test('unknown batch-wide metrics retain no guessed source while explicit cross-table rules retain all real sources',()=>{
 const unknown=resolveMetricSource({label:'IBMS',sourceFiles:names,fileIds:['wfm','sr']},sections,files,names);assert.deepEqual(unknown.fileIds,[]);assert.deepEqual(resolveMetricSource({label:'IBMS',sourceFiles:['WFM.csv'],fileIds:['wfm']},[sections[0]],[files[0]],['WFM.csv']).fileIds,[]);assert.equal(unknown.sourceLinkStatus,'unresolved');
 assert.deepEqual(resolveMetricSource({rule:{scope:'all'}},[...sections,{key:'extra',archiveSupplementary:true,sourceFiles:['Extra.csv']}],[...files,{id:'extra',name:'Extra.csv'}],names).fileIds,['wfm','sr']);
});
test('new explicit section links and independent child rule sources never inherit parent files',()=>{
 const metric=linkMetric({sourceLinkVersion:2,sourceSectionKeys:['wfm'],rule:{subMetrics:[{category:'TE',sourceSecId:'sr'}]},subMetrics:[{category:'TE',value:2}]},sections,files,names);assert.deepEqual(metric.fileIds,['wfm']);assert.deepEqual(metric.subMetrics[0].fileIds,['sr']);
 assert.deepEqual(resolveMetricSource({sourceLinkVersion:2,sourceSectionKeys:[],fileIds:['wfm','sr']},sections,files,names).fileIds,[]);
 assert.deepEqual(resolveMetricSource({sourceLinkVersion:2,fileIds:['foreign-tenant']},sections,files,names).fileIds,[]);
});
