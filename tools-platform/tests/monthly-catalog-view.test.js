const test=require('node:test');const assert=require('node:assert/strict');const view=require('../frontend/js/monthly-designer/catalog-view');const engine=require('../frontend/js/monthly-designer/document-engine');
function fixture(){return {batches:[{id:'b',created_at:'2026-10-10T09:00:00Z',target_month:9},{id:'no-rules',created_at:'2026-08-10T09:00:00Z',target_month:8}],files:[{id:'f',batch_id:'b',name:'风险表.csv',source_key:'风险表',source_key_aliases:['old-corrupted-key'],metricLabels:['TOPN 风险'],sheets:[{id:'sheet',name:'Data'}]},{id:'n',batch_id:'no-rules',name:'没有指标.xlsx',sheets:[]}],snapshots:[{id:'raw',kind:'extraction',batch_id:'b',captured_at:'2026-10-10T09:00:00Z',target_month:9,metrics:[{key:'risk',label:'TOPN 风险'}],sections:[{key:'risk'}]},{id:'assessment:raw@@9',sourceSnapshotId:'raw',kind:'assessment',batch_id:'b',captured_at:'2026-10-10 09:03:00',target_month:9,metrics:[{key:'assessment:A:Risk',label:'A / Risk'}],sections:[{key:'risk'}]}]};}
test('source library groups a single import with extraction and assessment by import date and target month',()=>{const catalog=fixture();const groups=view.groups(catalog);assert.equal(groups.length,2);assert.equal(groups[0].period,'2026-09');assert.equal(groups[0].snapshots.length,2);assert.deepEqual(groups[0].fileIds,['f']);assert.equal(groups[0].importedAt,catalog.snapshots[0].captured_at);assert.deepEqual(groups[1].fileIds,['n']);assert.equal(view.fileTitle(catalog.files[0]),'TOPN 风险');assert.equal(view.fileTitle(catalog.files[1]),'没有指标.xlsx');});
test('pinned options show only the selected metric data definition; processed sections omit assessment duplicates',()=>{const catalog=fixture();assert.deepEqual(view.eligibleSnapshots({kind:'metric',metricKey:'risk'},catalog).map(s=>s.id),['raw']);assert.deepEqual(view.eligibleSnapshots({kind:'metric',metricKey:'assessment:A:Risk'},catalog).map(s=>s.id),['assessment:raw@@9']);assert.deepEqual(view.eligibleSnapshots({kind:'section',sectionKey:'risk'},catalog).map(s=>s.id),['raw']);assert.equal(engine.resolve({kind:'file',mode:'latest',sourceKey:'old-corrupted-key'},catalog).file.id,'f');});
test('legacy missing target month inherits its linked single saved assessment period, separate targets remain separate',()=>{const catalog=fixture();catalog.snapshots[0].target_month=null;assert.equal(view.groups(catalog)[0].snapshots.length,2);assert.equal(view.snapshotPeriod(catalog.snapshots[0],catalog),'2026-09');catalog.snapshots.push({...catalog.snapshots[1],id:'assessment:raw@@10',target_month:10});assert.equal(view.groups(catalog).filter(g=>g.batchIds.includes('b')).length,2);assert.equal(view.period('2026-01-10T00:00:00Z',12),'2025-12');});
test('expiring ticket files are correctly identified',()=>{
    assert.equal(view.isExpiringTicketFile({name:'PBI_自动抓取-整改详单_整改_Latest.csv'}),true);
    assert.equal(view.isExpiringTicketFile({name:'PBI_自动抓取-风险详单_Latest.csv'}),true);
    assert.equal(view.isExpiringTicketFile({name:'PBI_自动抓取-详单-SR_Latest.csv'}),true);
    assert.equal(view.isExpiringTicketFile({name:'巡检详单.csv'}),true);
    assert.equal(view.isExpiringTicketFile({name:'待办清单.xlsx'}),true);
    assert.equal(view.isExpiringTicketFile({name:'维保临期单.csv'}),true);
    assert.equal(view.isExpiringTicketFile({name:'日常配置表.xlsx'}),false);
    assert.equal(view.isExpiringTicketFile(null),false);
    assert.equal(view.sourceFileTitle({name:'PBI_自动抓取-整改详单_整改_Latest.csv'}),'整改');
    assert.equal(view.sourceFileTitle({name:'PBI_自动抓取-风险详单_Latest_2026年09月.csv'}),'风险-9月');
    assert.equal(view.sourceFileTitle({name:'PBI_自动抓取-CPT风险详表_Latest (1).csv'}),'专项风险 (1)');
    assert.equal(view.sourceFileTitle({name:'PBI_自动抓取-详单-SR_Latest_2026年10月.csv'}),'SR-10月');
    assert.equal(view.sourceFileTitle({name:'PBI_自动抓取-详单漏洞_漏洞预警_Latest.csv'},'en'),'Vulnerability');
    const batch=Array.from({length:6},(_,index)=>({name:index?'表'+index+'.csv':'整改率.csv',metricLabels:index?['IBMS','月度例会']:['整改率','IBMS','月度例会']}));
    assert.equal(view.fileTitle(batch[0],batch),'整改率');
    assert.equal(view.fileTitle({name:'PBI_自动抓取-风险详单_Latest_2026年9月.csv',metricLabels:['TOPN 风险','IBMS','月度例会']},batch),'风险-9月');
});
test('priority files are ranked and sorted by dashboard presentation order with expiring ticket tables highlighted',()=>{
    const files=[
        {name:'未知其他表.xlsx',metricLabels:[]},
        {name:'PBI_自动抓取-详单-SR_Latest.csv',metricLabels:[]},
        {name:'TOPN风险表.xlsx',metricLabels:['TOPN 风险']},
        {name:'EOS治理.xlsx',metricLabels:['重急EOS']},
        {name:'整改完成率.xlsx',metricLabels:['整改完成率']},
        {name:'PBI_自动抓取-整改详单_整改_Latest.csv',metricLabels:[]},
        {name:'巡检详单_Latest.csv',metricLabels:['巡检详单']}
    ];
    const sorted=view.sortPriorityFiles(files);
    const names=sorted.map(f=>f.name);
    assert.equal(names[0],'整改完成率.xlsx');
    assert.equal(names[1],'PBI_自动抓取-整改详单_整改_Latest.csv');
    assert.equal(names[2],'TOPN风险表.xlsx');
    assert.equal(names[3],'EOS治理.xlsx');
    assert.equal(names[4],'巡检详单_Latest.csv');
    assert.equal(names[5],'PBI_自动抓取-详单-SR_Latest.csv');
    assert.equal(names[6],'未知其他表.xlsx');
    const priority=files.filter(f=>view.hasExtractedMetrics(f,files)||view.isExpiringTicketFile(f));
    assert.equal(priority.length,6);
    assert.equal(priority.some(f=>f.name==='未知其他表.xlsx'),false);
});
test('expiring ticket sections are correctly identified and prioritized by left sidebar dashboard rules',()=>{
    const catalog={
        files:[
            {id:'f_rect',name:'PBI_自动抓取-整改详单_整改_Latest.csv'},
            {id:'f_topn',name:'TOPN风险表.xlsx',metricLabels:['TOPN 风险']},
            {id:'f_other',name:'自定义原始表.csv'}
        ]
    };
    assert.equal(view.isExpiringTicketSection({key:'rectification',title:'整改'},catalog),true);
    assert.equal(view.isExpiringTicketSection({key:'special',title:'🛠️ CPT专项风险合集'},catalog),true);
    assert.equal(view.isExpiringTicketSection({key:'risk',title:'⚠️ 常规风险合集'},catalog),true);
    assert.equal(view.isExpiringTicketSection({key:'vulnerability',title:'🧯 漏洞预警详单'},catalog),true);
    assert.equal(view.isExpiringTicketSection({key:'sr',title:'📞 SR详单分析'},catalog),true);
    assert.equal(view.isExpiringTicketSection({key:'sec_inspect',title:'巡检详单'},catalog),true);
    assert.equal(view.isExpiringTicketSection({key:'sec_linked',fileIds:['f_rect']},catalog),true);
    assert.equal(view.isExpiringTicketSection({key:'topn',title:'TOPN 风险'},catalog),false);
    assert.equal(view.isExpiringTicketSection({key:'eos',title:'全量EOS-产品'},catalog),false);
    assert.equal(view.isExpiringTicketSection(null,catalog),false);

    const sections=[
        {key:'sec_other',title:'未知业务表'},
        {key:'sr',title:'📞 SR详单分析'},
        {key:'vulnerability',title:'🧯 漏洞预警详单'},
        {key:'sec_eos',title:'重急EOS收编'},
        {key:'rectification',title:'🔧 当前整改详单合集'},
        {key:'sec_topn',title:'TOPN 风险'},
        {key:'risk',title:'⚠️ 常规风险合集'},
        {key:'sec_inspect',title:'巡检详单'},
        {key:'special',title:'🛠️ CPT专项风险合集'},
        {key:'sec_lithium',title:'锂电池整改完成率'}
    ];
    const sorted=view.sortPrioritySections(sections,catalog);
    const keys=sorted.map(s=>s.key);
    // Ticket tables come first, in core sequence: rectification -> special -> risk -> vulnerability -> sr -> other ticket tables
    assert.equal(keys[0],'rectification');
    assert.equal(keys[1],'special');
    assert.equal(keys[2],'risk');
    assert.equal(keys[3],'vulnerability');
    assert.equal(keys[4],'sr');
    assert.equal(keys[5],'sec_inspect');
    // Followed by business/metric processed tables sorted by REPORT_METRIC_ORDER
    assert.equal(keys[6],'sec_topn');
    assert.equal(keys[7],'sec_eos');
    assert.equal(keys[8],'sec_lithium');
    // Followed by other tables
    assert.equal(keys[9],'sec_other');
});

