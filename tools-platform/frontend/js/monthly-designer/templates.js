(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./document-engine'):root.MonthlyDocumentEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyTemplates=api;})(typeof window==='object'?window:globalThis,function(engine){
    'use strict';
    const view=typeof module==='object'&&module.exports?require('./catalog-view'):window.MonthlyCatalogView;
    const copy=value=>JSON.parse(JSON.stringify(value));
    const month=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'')?value:'';
    const monthIndex=value=>Number(value.slice(0,4))*12+Number(value.slice(5,7))-1;
    const shifted=(value,offset)=>{const index=monthIndex(value)+offset;return Math.floor(index/12)+'-'+String(index%12+1).padStart(2,'0');};
    const sourceKey=value=>String(value||'').replace(/20\d{2}[-_年](1[0-2]|0?[1-9])(?:月|[-_]\d{2})?/g,'{month}');
    function filePeriod(file,catalog){
        if(month(file.target_period))return file.target_period;
        const named=String(file.name||'').match(/(20\d{2})[-_年]?(0?[1-9]|1[0-2])(?:月|\b|\.)/);
        if(named)return named[1]+'-'+named[2].padStart(2,'0');
        const batch=(catalog.batches||[]).find(item=>item.id===file.batch_id);
        const target=batch?.target_month;
        if(target>=1&&target<=12)return view.period(batch.created_at||file.created_at,target);
        return '';
    }
    function clean(document){
        const draft=engine.normalize(document);
        delete draft.id;delete draft.saveCount;delete draft.reportMonth;
        draft.name=draft.name.replace(/-\d{4}-(0[1-9]|1[0-2])$/,'');
        delete draft.inlineData;
        if(draft.libraryPrefs){draft.libraryPrefs.period='';draft.libraryPrefs.date='';draft.libraryPrefs.group='';draft.libraryPrefs.expandedFileIds=[];draft.libraryPrefs.expandedSheetIds=[];}
        for(const item of draft.meta)if(['period','source','number'].includes(item.autoFill)){item.value=engine.bilingual('','');if(item.fieldRuns)delete item.fieldRuns.value;}
        for(const section of draft.sections)for(const block of section.blocks){
            delete block.savedData;delete block.previousData;delete block.mappingPresetId;delete block.dataFormatPresetId;
            if(block.binding&&['metric','section'].includes(block.binding.kind)){block.binding.mode='latest';delete block.binding.snapshotId;}
        }
        return draft;
    }
    function normalize(input){
        if(!input||input.version!==1||!Array.isArray(input.sources)||input.sources.length>2000)throw new Error('Invalid monthly template');
        const seen=new Set();
        for(const source of input.sources){
            if(!source||['sheetId','sourceKey','sheetName','kind','period'].some(key=>typeof source[key]!=='string'||source[key].length>2000)||!source.sheetId||seen.has(source.sheetId)||source.period&&!month(source.period)||!Number.isInteger(source.monthOffset)||Math.abs(source.monthOffset)>1200)throw new Error('Invalid template source');
            seen.add(source.sheetId);
        }
        return {version:1,document:clean(input.document),sources:input.sources.map(({sheetId,sourceKey,sheetName,kind,period,monthOffset})=>({sheetId,sourceKey,sheetName,kind,period,monthOffset}))};
    }
    function capture(document,catalog={files:[],batches:[]}){
        const origin=engine.documentMonth(document)||month(document.libraryPrefs?.period),sources=new Map(),draft=engine.normalize(document);
        const add=reference=>{
            if(!reference)return;
            const file=(catalog.files||[]).find(item=>(!reference.fileId||item.id===reference.fileId)&&(!reference.sourceKey||item.source_key===reference.sourceKey)&&item.sheets?.some(sheet=>sheet.id===reference.sheetId||!reference.sheetId&&sheet.name===reference.sheetName));
            const sheet=file?.sheets.find(sheet=>sheet.id===reference.sheetId||!reference.sheetId&&sheet.name===reference.sheetName);
            if(!sheet)return;
            reference.sheetId=sheet.id;
            const period=filePeriod(file,catalog);
            sources.set(sheet.id,{sheetId:sheet.id,sourceKey:sourceKey(file.source_key||file.name),sheetName:sheet.name,kind:file.kind||'',period,monthOffset:origin&&period?monthIndex(period)-monthIndex(origin):0});
        };
        for(const section of draft.sections)for(const block of section.blocks){add(block.binding);for(const source of block.chart.series||[])add(source);for(const source of block.chart.pivot?.sources||[])add(source);}
        return normalize({version:1,document:draft,sources:[...sources.values()]});
    }
    function create(input,catalog={files:[],batches:[]},reportMonth=''){
        const template=normalize(input),draft=copy(template.document);
        const libraryPeriods=view.groups({files:[],snapshots:[],batches:[],...catalog}).map(group=>group.period).filter(month);
        const periods=(libraryPeriods.length?libraryPeriods:(catalog.files||[]).map(file=>filePeriod(file,catalog))).filter(month).sort().reverse();
        const period=month(reportMonth)||periods[0]||new Date().toISOString().slice(0,7),references=new Map();draft.reportMonth=period;draft.dataRulesVersion=1;
        for(const source of template.sources){
            const expected=period?shifted(period,source.monthOffset):'';
            const candidates=(catalog.files||[]).filter(file=>(file.kind||'')===source.kind&&sourceKey(file.source_key||file.name)===source.sourceKey&&(!expected||filePeriod(file,catalog)===expected)&&file.sheets?.some(sheet=>sheet.name===source.sheetName)).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
            const file=candidates[0],sheet=file?.sheets.find(item=>item.name===source.sheetName);
            if(sheet)references.set(source.sheetId,{fileId:file.id,sheetId:sheet.id,period:expected});
        }
        const remap=reference=>{
            if(!reference)return;const source=template.sources.find(source=>source.sheetId===reference.sheetId);if(!source)return;
            const found=references.get(reference.sheetId);reference.fileId=found?.fileId||'';reference.sheetId=found?.sheetId||'';
            if(reference.kind==='file')reference.mode='pinned';
            if(!reference.reference)reference.reference={sourceKey:source.sourceKey,sourceKind:source.kind||'original',sheetName:source.sheetName,monthMode:'relative',offset:source.monthOffset,month:'',versionMode:'latest',versionId:''};
            if(reference.label&&month(reference.label)&&period)reference.label=shifted(period,source.monthOffset);
        };
        for(const section of draft.sections){section.id=engine.uid();for(const block of section.blocks){block.id=engine.uid();remap(block.binding);for(const source of block.chart.series||[])remap(source);for(const source of block.chart.pivot?.sources||[])remap(source);if(block.binding&&!block.binding.reference&&['metric','section'].includes(block.binding.kind))block.binding.reference={monthMode:'relative',offset:0,month:'',versionMode:'latest',versionId:'',sourceKey:'',sourceKind:block.binding.metricKey?.startsWith('assessment:')?'assessment':'extraction',sheetName:''};}}
        for(const item of draft.meta)item.id=engine.uid();
        engine.applyReportDefaults(draft,period,new Date().toISOString().slice(0,10));return engine.normalize(draft);
    }
    return {capture,normalize,create,filePeriod};
});
