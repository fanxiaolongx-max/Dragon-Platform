const test=require('node:test');const assert=require('node:assert/strict');const engine=require('../frontend/js/monthly-designer/document-engine');
test('reference document has editable overall and eight security modules, with movable content slots',()=>{const document=engine.defaults();assert.equal(document.sections.length,9);assert.match(document.sections[1].title.zh,/网络变更/);const block=engine.block('table');block.span=6;document.sections[1].blocks.push(block);document.sections.reverse();document.meta[0].label.zh='自定义部门';assert.deepEqual(engine.normalize(document),document);});
test('stored data filters retain zeros and grouping/summary rules do not modify sources',()=>{const rows=[{network:'A',count:0},{network:'A',count:2},{network:'B',count:4},{network:'B',count:''}];const original=JSON.stringify(rows);assert.equal(engine.filterRows(rows,[{column:'count',op:'eq',value:'0'}]).length,1);assert.deepEqual(engine.group(rows,{x:'network',y:'count',aggregation:'sum'}),[{label:'A',value:2},{label:'B',value:4}]);const block=engine.block('summary');block.rule.zh='{label}={value}，{rows} 条，目标 {target}';assert.equal(engine.summary(block,{metric:{label:'风险',value:0,savedTarget:0},snapshot:{captured_at:'2026-09'}},rows,'zh'),'风险=0，4 条，目标 0');assert.equal(JSON.stringify(rows),original);});
test('document validation rejects executable logos, malformed layouts and unknown summary fields',()=>{const document=engine.defaults();assert.throws(()=>engine.normalize({...document,logo:'javascript:alert(1)'}));document.sections[0].span=13;assert.throws(()=>engine.normalize(document));document.sections[0].span=12;document.sections[0].blocks[0].rule.zh='{password}';assert.throws(()=>engine.normalize(document),/Unknown/);});

test('latest relevant import without an indicator does not reuse older values',()=>{const catalog={snapshots:[{id:'new',metrics:[],sections:[{key:'risk'}]},{id:'old',metrics:[{key:'risk_count',value:8}],sections:[{key:'risk'}]}]};assert.equal(engine.resolve({kind:'metric',mode:'latest',metricKey:'risk_count',sectionKey:'risk'},catalog),null);assert.equal(engine.resolve({kind:'metric',mode:'pinned',metricKey:'risk_count',snapshotId:'old'},catalog).metric.value,8);});


test('same import duplicate table names merge without mixing months or import batches, preserving bindings and source metadata',()=>{
 const files=[{id:'risk-copy',batch_id:'b',name:'风险 (1).csv',source_key:'risk-copy',sheets:[{id:'copy-sheet',name:'Main',rowCount:2}],metricLabels:['风险'],size:4},{id:'risk',batch_id:'b',name:'风险.csv',source_key:'risk',sheets:[{id:'main-sheet',name:'Main',rowCount:3}],metricLabels:['完成率'],size:6},...['SR-9月.csv','SR-10月.csv','图形化拦截_CN-9月.csv','图形化拦截_CN-10月.csv'].map((name,index)=>({id:'dated-'+index,batch_id:'b',name,sheets:[]})),{id:'old-risk',batch_id:'old',name:'风险.csv',sheets:[]}];
 const original=JSON.stringify(files);const merged=engine.mergeFiles(files);assert.equal(merged.length,6);assert.equal(merged[0].name,'风险.csv');assert.equal(merged[0].mergedFiles.length,2);assert.equal(merged[0].sheets[0].rowCount,5);assert.equal(merged[0].size,10);assert.deepEqual(merged[0].metricLabels,['风险','完成率']);assert.equal(engine.resolve({kind:'file',mode:'pinned',fileId:'risk'},{files}).file.mergedFiles.length,2);assert.equal(engine.resolve({kind:'file',mode:'latest',sourceKey:'risk'},{files}).file.id,'risk-copy');assert.equal(JSON.stringify(files),original);
});


test('saved child metrics resolve by category, keep zero values and use historical assessment classifications',()=>{
 const snapshot={id:'child',kind:'extraction',sections:[],metrics:[{key:'a',label:'Rate',value:90,subMetrics:[{category:'TE',value:0},{category:'ORG',value:95}]}]};
 const children=engine.expandMetrics(snapshot);assert.equal(children.length,3);assert.equal(children[1].metricLevel,'sub');assert.equal(children[1].category,'TE');
 assert.equal(engine.resolve({kind:'metric',mode:'pinned',snapshotId:'child',metricKey:children[1].key},{snapshots:[snapshot]}).metric.value,0);
 assert.deepEqual(engine.expandMetrics({kind:'assessment',metrics:[{key:'assessment:整体:Rate',label:'整体 / Rate'},{key:'assessment:TE:Rate',label:'TE / Rate'}]}).map(metric=>metric.metricLevel),['main','sub']);
});

test('same named metrics share one choice and resolve both latest and pinned legacy values without merging sources or categories',()=>{
 const catalog={snapshots:[{id:'new',kind:'extraction',sections:[],metrics:[{key:'formal',label:'整改',value:98,subMetrics:[{category:'TE',value:90},{category:'ORG',value:99}]}]},{id:'old',kind:'extraction',sections:[],metrics:[{key:'legacy:整改',label:'整改',value:96,subMetrics:[{category:'TE',value:80}]}]},{id:'report',kind:'assessment',sections:[],metrics:[{key:'assessment:整体:整改',label:'整体 / 整改',value:95}]}]};
 assert.equal(engine.metricOptions(catalog).filter(metric=>metric.label==='整改').length,1);
 assert.equal(engine.resolve({kind:'metric',mode:'latest',metricKey:'legacy:整改'},catalog).metric.value,98);
 assert.equal(engine.resolve({kind:'metric',mode:'pinned',snapshotId:'old',metricKey:'formal'},catalog).metric.value,96);
 assert.equal(engine.metricOptions(catalog).length,4);
});

test('card height persists in grid units while old documents default to automatic height',()=>{
 const document=engine.defaults();delete document.sections[0].blocks[0].heightUnits;assert.equal(engine.normalize(document).sections[0].blocks[0].heightUnits,0);
 document.sections[0].blocks[0].heightUnits=7;assert.equal(engine.normalize(document).sections[0].blocks[0].heightUnits,7);
 for(const height of [-1,1.5,101]){document.sections[0].blocks[0].heightUnits=height;assert.throws(()=>engine.normalize(document));}
});

test('navigation dimensions persist and legacy documents retain the default two centered rows',()=>{
 const document=engine.defaults();for(const key of ['navRows','navRowHeight','navWidth','navFontSize'])delete document[key];
 const old=engine.normalize(document);assert.deepEqual([old.navRows,old.navRowHeight,old.navWidth,old.navFontSize],[2,36,0,14]);
 Object.assign(document,{navRows:3,navRowHeight:48,navWidth:900,navFontSize:16});assert.equal(engine.normalize(document).navWidth,900);
 for(const [key,value] of [['navRows',0],['navRowHeight',121],['navWidth',-1],['navFontSize',25]])assert.throws(()=>engine.normalize({...document,[key]:value}));
});

test('metadata dimensions and vertical alignment modes persist, with default items having aligned grid tracks',()=>{
 const document=engine.defaults();
 for(const key of ['metaWidth','metaRowHeight','metaLabelWidth','metaAlignMode'])delete document[key];
 delete document.meta[0].heightUnits;
 const old=engine.normalize(document);
 assert.deepEqual([old.metaWidth,old.metaRowHeight,old.metaLabelWidth,old.metaAlignMode,old.meta[0].heightUnits],[0,0,0,'grid',0]);
 Object.assign(document,{metaWidth:1150,metaRowHeight:48,metaLabelWidth:100,metaAlignMode:'col-3'});
 document.meta[5].heightUnits=3;
 const saved=engine.normalize(document);
 assert.equal(saved.metaWidth,1150);
 assert.equal(saved.metaRowHeight,48);
 assert.equal(saved.metaLabelWidth,100);
 assert.equal(saved.metaAlignMode,'col-3');
 assert.equal(saved.meta[5].heightUnits,3);
 for(const [key,value] of [['metaWidth',-1],['metaWidth',2001],['metaRowHeight',-1],['metaRowHeight',201],['metaLabelWidth',-1],['metaLabelWidth',301],['metaAlignMode','invalid']])assert.throws(()=>engine.normalize({...document,[key]:value}));
});



test('report defaults follow target and source months, retain custom values and exclude overview from numbered modules',()=>{
 const report=engine.applyReportDefaults(engine.defaults(),'2026-09','2026-10-10');
 const field=name=>report.meta.find(item=>item.label.zh===name);
 assert.equal(field('部门').value.zh,'埃及网络保障与运维服务部');assert.equal(field('审核人').value.zh,'于祥 00877023');
 assert.equal(field('报告时间').value.zh,'2026-10-10');assert.equal(field('数据月份').value.zh,'2026-09');assert.equal(field('报告编号').value.zh,'EGY-CS-202609-V1.0');assert.match(field('报告目标').value.zh,/60 分钟/);
 assert.equal(report.sections.filter(item=>!item.overview).length,8);assert.equal(report.sections[0].overview,true);
 const saved=engine.normalize(report);engine.applyReportDefaults(saved,'2026-08','2026-09-03');assert.equal(saved.meta.find(item=>item.label.zh==='报告编号').value.zh,'EGY-CS-202608-V1.0');
 field('报告时间').autoFill=false;field('报告时间').value.zh='自定义时间';engine.applyReportDefaults(report,'2026-07','2026-08-01');assert.equal(field('报告时间').value.zh,'自定义时间');
});

test('inline metric variables resolve current stored values, zeros, aliases and missing metrics without changing text',()=>{
 const text='风险：[[@metric:risk]]；未知：[[@metric:missing]]。';const catalog={snapshots:[{id:'s',metrics:[{key:'risk',label:'风险',value:0}],sections:[]}]};
 const parts=engine.metricTextParts(text,catalog);assert.equal(parts[1].value,0);assert.equal(parts[3].missing,true);assert.equal(parts.map(part=>part.token||part.text).join(''),text);
 catalog.snapshots[0].metrics[0].value=23;assert.equal(engine.metricTextParts(text,catalog)[1].value,23);
});

test('rich text styles persist safely and overview sample preserves source wording and metric tokens',()=>{
 const report=engine.defaults(),block=report.sections[0].blocks[0];block.text.zh='本月372个问题单。\n1. 风险治理：完成268项。[[@metric:risk]]';
 assert.equal(engine.sampleOverview(report),true);assert.equal(block.textRuns.zh.map(run=>run.text).join(''),block.text.zh);assert.ok(block.textRuns.zh.some(run=>run.style.bold));assert.equal(engine.sampleOverview(report),false);assert.deepEqual(engine.normalize(report).sections[0].blocks[0].textRuns,block.textRuns);
 const unsafe=JSON.parse(JSON.stringify(report));unsafe.sections[0].blocks[0].textRuns.zh[0].style.color='url(javascript:alert(1))';assert.throws(()=>engine.normalize(unsafe),/Invalid/);
 const oversized=JSON.parse(JSON.stringify(report));oversized.sections[0].blocks[0].textRuns.zh[0].style.fontSize=1000;assert.throws(()=>engine.normalize(oversized),/Invalid/);
});

test('legacy flattened overview headings recover paragraphs without changing wording, styles or metric tokens',()=>{
 const report=engine.defaults(),block=report.sections[0].blocks[0];block.text.zh='本月平稳。变更操作管理：523次。紧急变更管理：2次。风险治理：[[@metric:risk]]项。';block.textRuns={zh:[{text:block.text.zh,style:{bold:true}}],en:[]};
 assert.equal(engine.restoreOverviewParagraphs(report),true);assert.equal(block.text.zh,'本月平稳。\n变更操作管理：523次。\n紧急变更管理：2次。\n风险治理：[[@metric:risk]]项。');assert.equal(block.textRuns.zh.map(run=>run.text).join(''),block.text.zh);assert.equal(engine.restoreOverviewParagraphs(report),false);engine.normalize(report);
});

test('overview upgrade restores bold labels and adds stable numbering and indentation to split or joined paragraphs',()=>{
 const report=engine.defaults(),block=report.sections[0].blocks[0];block.text.zh='本月372个问题单。\n变更操作管理：523次。\n紧急变更管理：2次。 风险治理：268项。';block.textRuns={zh:[{text:block.text.zh,style:{fontSize:18}}],en:[]};
 assert.equal(engine.formatOverview(report),true);assert.equal(block.text.zh,'本月372个问题单。\n　　1. 变更操作管理：523次。\n　　2. 紧急变更管理：2次。 \n　　3. 风险治理：268项。');assert.ok(block.textRuns.zh.some(run=>run.text.includes('变更操作管理')&&run.style.bold));assert.ok(block.textRuns.zh.every(run=>!run.text.includes('523')||run.style.bold));assert.equal(engine.formatOverview(report),false);engine.normalize(report);
});

test('rich field formatting validates safe styles on document, section, block and metadata fields',()=>{
 const document=engine.defaults(),runs=text=>({zh:[{text,style:{fontSize:8,color:'#173c60',bold:true}}],en:[]});
 document.fieldRuns={title:runs(document.title.zh)};document.sections[0].fieldRuns={title:runs(document.sections[0].title.zh)};document.sections[0].blocks[0].fieldRuns={title:runs('')};document.meta[0].fieldRuns={value:runs(document.meta[0].value.zh)};
 assert.equal(engine.normalize(document).fieldRuns.title.zh[0].style.fontSize,8);
 document.meta[0].fieldRuns.value.zh[0].style.background='url(javascript:alert(1))';assert.throws(()=>engine.normalize(document),/Invalid monthly document/);
 delete document.meta[0].fieldRuns.value.zh[0].style.background;document.fieldRuns.logo=runs('bad');assert.throws(()=>engine.normalize(document),/Invalid monthly document/);
});

test('comparison chart bindings, selected customers and arrow thresholds survive normalization with bounded series',()=>{
 const report=engine.defaults(),chart=engine.block('chart');report.sections[0].blocks=[chart];chart.chart={x:'',y:'',aggregation:'sum',series:[{fileId:'sep',sheetId:'sep-sheet',x:'客户',y:'数量',label:'2026-09'},{fileId:'oct',sheetId:'oct-sheet',x:'客户',y:'数量',label:'2026-10'}],customers:['Orange'],excludeTotals:true,changePercent:20,changeAbsolute:5,axisMode:'auto'};
 assert.deepEqual(engine.normalize(report).sections[0].blocks[0].chart,chart.chart);
 for(const patch of [{series:Array(9).fill(chart.chart.series[0])},{axisMode:'log'},{changePercent:-1},{changeAbsolute:'5'},{customers:[{}]},{excludeTotals:'true'},{series:[{...chart.chart.series[0],fileId:{}}]}]){const invalid=structuredClone(report);Object.assign(invalid.sections[0].blocks[0].chart,patch);assert.throws(()=>engine.normalize(invalid),/Invalid monthly document/);}
});

test('per-report source-library preferences are optional for legacy documents and validate saved selections',()=>{
 const report=engine.defaults();assert.equal(engine.normalize(report).libraryPrefs,undefined);
 report.libraryPrefs={period:'2026-09',date:'2026-10-09',group:'batch:import@@2026-09',search:'客户',expandedFileIds:['file-id'],expandedSheetIds:['sheet-id'],rowNameColumns:{'sheet-id':'区域'}};assert.deepEqual(engine.normalize(report).libraryPrefs,report.libraryPrefs);
 for(const patch of [{period:'2026-13'},{date:'bad-date'},{group:'x'.repeat(501)},{search:'x'.repeat(2001)},{expandedFileIds:['<script>']},{expandedSheetIds:[{}]},{rowNameColumns:[]},{rowNameColumns:{'bad<id>':'客户'}},{rowNameColumns:{'sheet-id':123}},{rowNameColumns:{constructor:'客户'}}]){const invalid=structuredClone(report);Object.assign(invalid.libraryPrefs,patch);assert.throws(()=>engine.normalize(invalid),/Invalid monthly document/);}
});

test('repeat metadata auto-fill does not reuse another saved month version after switching target',()=>{
 const report=engine.defaults();report.saveCount=7;report.reportMonth='2026-09';engine.applyReportDefaults(report,'2026-08','2026-10-10');engine.applyReportDefaults(report,'2026-08','2026-10-10');assert.equal(report.meta.find(item=>item.label.zh==='报告编号').value.zh,'EGY-CS-202608-V1.0');engine.applyReportDefaults(report,'2026-09','2026-10-10');assert.equal(report.meta.find(item=>item.label.zh==='报告编号').value.zh,'EGY-CS-202609-V7.0');
});


test('chart presentations and share-series selection persist for legacy and multi-series bindings',()=>{
 const doc=engine.defaults(),chart=engine.block('chart');doc.sections[0].blocks=[chart];
 assert.equal(engine.normalize(doc).sections[0].blocks[0].chart.type,undefined);
 for(const type of ['column','bar','line','area','pie','donut']){chart.chart.type=type;chart.chart.pieSeries=1;assert.equal(engine.normalize(doc).sections[0].blocks[0].chart.type,type);assert.equal(engine.normalize(doc).sections[0].blocks[0].chart.pieSeries,1);}
 for(const patch of [{type:'radar'},{type:{}},{pieSeries:-1},{pieSeries:8},{pieSeries:1.2},{axisMode:'log'},{customers:[{}]},{excludeTotals:'true'},{changePercent:-1}]){const bad=structuredClone(doc);Object.assign(bad.sections[0].blocks[0].chart,patch);assert.throws(()=>engine.normalize(bad),/Invalid monthly document/);}
});


test('field alignment and table-cell presentation persist with safe properties and bounded keys',()=>{
 const doc=engine.defaults(),block=doc.sections[0].blocks[0];
 doc.fieldAlign={title:{zh:'center',en:'left'}};doc.meta[0].fieldAlign={value:{zh:'right'}};block.fieldAlign={text:{zh:'justify'}};
 block.tableFormats=[{key:'[0,"TFOOT","0",0,"Period"]',value:{zh:'总计30',en:''},fieldRuns:{value:{zh:[{text:'总计30',style:{fontSize:18,bold:false,color:'#b91c1c'}}],en:[]}},fieldAlign:{value:{zh:'center'}}}];
 assert.deepEqual(engine.normalize(doc).sections[0].blocks[0].tableFormats,block.tableFormats);
 for(const mutate of [doc=>doc.fieldAlign.title.zh='url(javascript:alert(1))',doc=>doc.fieldAlign.logo={zh:'center'},doc=>doc.fieldAlign.title.fr='center',doc=>doc.sections[0].blocks[0].tableFormats[0].fieldRuns.value.zh[0].style.color='red',doc=>doc.sections[0].blocks[0].tableFormats.push(structuredClone(doc.sections[0].blocks[0].tableFormats[0])),doc=>doc.sections[0].blocks[0].tableFormats[0].fieldAlign.value.zh='top']){const invalid=structuredClone(doc);mutate(invalid);assert.throws(()=>engine.normalize(invalid),/Invalid monthly document/);}
});
