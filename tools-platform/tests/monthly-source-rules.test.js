const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../frontend/js/monthly-designer/source-rules'),E=require('../frontend/js/monthly-designer/document-engine'),T=require('../frontend/js/monthly-designer/templates');
const file=(id,period,date,kind='original')=>({id,name:'high-risk_'+period+'.csv',source_key:'high-risk_'+period,kind,target_period:period,batch_id:'b'+period,created_at:date,sheets:[{id:'s'+id,name:'Sheet1',headers:['category','value']}]});
const catalog={files:[file('oct','2026-10','2026-10-11'),file('sep2','2026-09','2026-10-12'),file('sep1','2026-09','2026-10-10'),file('topic','2026-10','2026-10-14','topic_monthly')],batches:[],snapshots:[]};
test('month latest, offsets, fixed month and pinned version are independent; no fallback across months or source kind',()=>{
 const rule=S.create(catalog.files[0],catalog.files[0].sheets[0],catalog,'2026-10');assert.equal(S.resolve(rule,catalog,'2026-10').file.id,'oct');
 assert.equal(S.resolve({...rule,offset:-1},catalog,'2026-10').file.id,'sep2');assert.equal(S.resolve({...rule,monthMode:'fixed',month:'2026-09'},catalog,'2027-03').file.id,'sep2');
 assert.equal(S.resolve({...rule,monthMode:'fixed',month:'2026-09',versionMode:'pinned',versionId:'sep1'},catalog,'2027-03').file.id,'sep1');assert.equal(S.resolve(rule,catalog,'2026-11'),null);
 assert.equal(S.resolve({...rule,monthMode:'global'},catalog,'2026-10').file.id,'sep2');assert.equal(S.shift('2026-01',-1),'2025-12');assert.equal(S.shift('2026-10',-12),'2025-10');
});
test('catalog groups monthly versions by source identity and kind, never by display label alone',()=>{const groups=S.catalogGroups(catalog,'2026-09');assert.equal(groups.length,1);assert.equal(groups[0].file.id,'sep2');assert.equal(groups[0].versions.length,2);assert.equal(S.catalogGroups(catalog,'2026-10').length,2);});
test('document rules round trip, legacy bindings retain behavior, snapshots preserve inputs for history and templates strip them',()=>{
 const report=E.defaults(),block=report.sections[0].blocks[0];report.reportMonth='2026-10';block.type='table';block.binding={kind:'file',mode:'latest',sourceKey:'high-risk_2026-09',sheetName:'Sheet1'};
 assert.equal(E.resolve(block.binding,catalog).file.id,'sep2');block.binding.reference=S.create(catalog.files[0],catalog.files[0].sheets[0],catalog,'2026-10');assert.equal(E.resolve(block.binding,{...catalog,reportMonth:'2026-10'}).file.id,'oct');
 block.savedData={catalog,resources:[{url:'/api/upload/source-sheets/soct',data:{headers:['category','value'],rows:[{category:'A',value:18}]}}]};assert.deepEqual(E.normalize(report).sections[0].blocks[0].savedData,block.savedData);
 const template=T.capture(report,catalog);assert.equal(template.document.sections[0].blocks[0].savedData,undefined);assert.equal(template.document.sections[0].blocks[0].binding.reference.offset,0);
 assert.throws(()=>E.normalize({...report,reportMonth:'2026-13'}));assert.throws(()=>S.validate({...block.binding.reference,offset:NaN}));assert.throws(()=>S.validateSaved({...block.savedData,resources:[{url:'https://evil.test/',data:{}}]}));
});
test('metric and processed source rules keep extraction and assessment definitions separate and obey report month',()=>{
 const snapshots=[{id:'old',kind:'extraction',target_month:9,captured_at:'2026-10-10',metrics:[{key:'m',value:9,label:'Metric'}],sections:[]},{id:'new',kind:'extraction',target_month:10,captured_at:'2026-10-11',metrics:[{key:'m',value:10,label:'Metric'}],sections:[]},{id:'assessment',kind:'assessment',target_month:10,captured_at:'2026-10-12',metrics:[{key:'assessment:m',value:80,label:'Metric'}],sections:[]}];
 const data={files:[],batches:[],snapshots,reportMonth:'2026-10'},reference={monthMode:'relative',offset:0,month:'',versionMode:'latest',versionId:'',sourceKey:'',sourceKind:'extraction',sheetName:''};
 assert.equal(E.resolve({kind:'metric',mode:'latest',metricKey:'m',reference},data).metric.value,10);assert.equal(E.resolve({kind:'metric',mode:'latest',metricKey:'m',reference:{...reference,offset:-1}},data).metric.value,9);
});

test('pinned imports detect an overwritten version; saved structured definitions are validated and stripped from reusable templates',()=>{
 const original={...catalog.files[0],sha256:'original'},data={...catalog,files:[original]},reference=S.create(original,original.sheets[0],data,'2026-10',true);
 assert.equal(S.resolve(reference,data,'2026-10').file.id,'oct');assert.equal(S.resolve(reference,{...data,files:[{...original,sha256:'replaced'}]},'2026-10'),null);
 const report=E.defaults(),block=report.sections[0].blocks[0];block.type='table';block.savedData={month:'2026-10',catalog:data,resources:[],definition:{type:'table',binding:null,chart:block.chart,columns:[],filters:[],limit:100,rule:block.rule}};
 assert.ok(E.normalize(report).sections[0].blocks[0].savedData.definition);assert.equal(T.capture(report,data).document.sections[0].blocks[0].savedData,undefined);
 assert.throws(()=>E.normalize({...report,sections:[{...report.sections[0],blocks:[{...block,savedData:{...block.savedData,definition:{...block.savedData.definition,html:'unsafe'}}}]}]}));
});
test('dynamic metrics choose latest within the report month regardless of catalog ordering',()=>{
 const snapshots=[{id:'old',kind:'extraction',target_period:'2026-10',captured_at:'2026-10-10',sections:[{key:'risk'}],metrics:[{key:'m',label:'Metric',value:2,sourceSection:'risk'}]},{id:'new',kind:'extraction',target_period:'2026-10',captured_at:'2026-10-11',sections:[{key:'risk'}],metrics:[{key:'m',label:'Metric',value:8,sourceSection:'risk'}]}];
 assert.equal(E.metricTextParts('[[@metric:m]]',{files:[],batches:[],snapshots,reportMonth:'2026-10'})[0].value,8);
 assert.equal(E.metricTextParts('[[@metric:m]]',{files:[],batches:[],snapshots,reportMonth:'2026-11'})[0].missing,true);
});

test('library groups identical filenames across original and structured archives by month and time, preserving reference identities',()=>{
 const catalog={batches:[],files:[{...file('upload','2026-09','2026-10-12T12:00:00Z'),name:'SR_Latest_2026年09月.csv'},{...file('capture','2026-09','2026-10-12T11:00:00Z','structured'),name:'SR_Latest_2026年09月.csv'},{...file('other-month','2026-08','2026-10-12T13:00:00Z'),name:'SR_Latest_2026年09月.csv'},{...file('other-name','2026-09','2026-10-12T10:00:00Z'),name:'SR_2026年09月.csv'}]};
 const groups=S.libraryGroups(catalog,'2026-09');assert.equal(groups.length,2);assert.equal(groups.find(group=>group.file.id==='upload').versions.length,2);assert.equal(S.catalogGroups(catalog,'2026-09').length,2);const rule=S.create(catalog.files[1],catalog.files[1].sheets[0],catalog,'2026-09',true);assert.equal(S.resolve(rule,catalog,'2026-09').file.id,'capture');assert.equal(S.libraryGroups(catalog,'').length,3);
});

test('month and pinned references retain renamed main/child metric aliases without mixing categories or assessment sources',()=>{
 const old={id:'old-alias',kind:'extraction',target_period:'2025-09',captured_at:'2025-10-01',sections:[],metrics:[{key:'legacy-risk',label:'Risk',value:5,subMetrics:[{category:'TE',value:40},{category:'ORG',value:60}]}]};
 const fresh={id:'new-alias',kind:'extraction',target_period:'2026-09',captured_at:'2026-10-01',sections:[],metrics:[{key:'new-risk',label:'Risk',value:9,subMetrics:[{category:'TE',value:88},{category:'ORG',value:92}]}]};
 const assessment={...old,id:'assessment-alias',kind:'assessment',metrics:[{key:'assessment:risk',label:'Risk / TE',category:'TE',value:777}]};
 const data={files:[],batches:[],snapshots:[fresh,old,assessment],reportMonth:'2026-09'};
 const reference={monthMode:'fixed',offset:0,month:'2025-09',versionMode:'pinned',versionId:old.id,sourceKind:'extraction',sourceKey:'',sheetName:''};
 const binding={kind:'metric',metricKey:'submetric:new-risk:TE',reference};
 assert.equal(E.resolve(binding,data).metric.value,40);assert.equal(E.resolve(binding,data).snapshot.id,old.id);
 assert.equal(E.resolve({...binding,metricKey:'new-risk'},data).metric.value,5);
 assert.equal(E.resolve({...binding,reference:{...reference,versionMode:'latest',versionId:''}},data).metric.value,40);
 assert.equal(E.resolve({...binding,metricKey:'submetric:new-risk:ORG'},data).metric.value,60);
 assert.equal(E.resolve({...binding,metricKey:'submetric:new-risk:VDF'},data),null);
 assert.equal(E.resolve({...binding,reference:{...reference,month:'2024-09'}},data),null);
 assert.equal(E.resolve({...binding,reference:{...reference,versionId:assessment.id}},data),null);
});
