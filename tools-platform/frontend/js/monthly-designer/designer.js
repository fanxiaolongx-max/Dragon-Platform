(function(){
    'use strict';
    // This stamp identifies the executing script, even if an older copy was cached.
    const scriptVersion='20261012-14';
    const versionBadge=document.createElement('span');versionBadge.id='monthlyScriptVersion';versionBadge.className='monthly-script-version';versionBadge.setAttribute('data-controls','');versionBadge.dataset.version=scriptVersion;document.body.append(versionBadge);
    const engine=window.MonthlyDocumentEngine;
    const view=window.MonthlyCatalogView,S=window.MonthlySourceRules,W=window.MonthlyWorkspace;
    const blockResources=new Map(),dataStates=new Map(),lastResults=new Map(),pendingBlocks=new Map(),pendingBlockUrls=new Map();
    let libraryDays=90,loadedDays=90,catalogComplete=false,directoryCatalog=null,libraryError='',libraryLoading=false,libraryRefreshId=0;try{const saved=Number(localStorage.getItem("monthly-library-days"));if(localStorage.getItem("monthly-library-days")!==null&&Number.isInteger(saved)&&saved>=0&&saved<=36500)libraryDays=saved;}catch(_){}
    let libraryPeriod=null,libraryDate=null,libraryGroup=null,libraryLimit=80,librarySearchTimer=null,librarySearchComposing=false;
    let language=window.ToolsI18n?.getLanguage()==='en-US'?'en':'zh';
    let current=engine.defaults(),catalog={files:[],snapshots:[],batches:[]},generation=0,renderPromise=Promise.resolve(),dirty=false;
    let metricTranslations=Object.create(null),globalCategories=[];
    let cardGesture=null,metaGesture=null,cardGridObserver=null,saving=false,initializing=false,initializationCancelled=false;
    const history=[],cache=new Map(),fields=new Map();let fieldIndex=0;
    const root=document.getElementById('monthlyDocument'),dialog=document.getElementById('blockEditor');
    const t=(zh,en)=>language==='en'?en:zh;
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const status=value=>{const el=document.getElementById('designerStatus');if(el){el.textContent=value;el.title=value||'';}};
    const pair=value=>window.MonthlyLabels.pair(value,language,metricTranslations);
    const clone=value=>JSON.parse(JSON.stringify(value));
    function checkpoint(){history.push(clone(current));if(history.length>30)history.shift();dirty=true;}
    const transport=window.MonthlyRequestClient.create({fetch:(...args)=>fetch(...args),parse:(res,meta)=>handleResponse(res,{...meta,path:meta.path.startsWith('/api/upload/source-search?')?'/api/upload/source-search':meta.path})});
    async function request(url,options={}){const {timeoutMs,onResponse,...init}=options,headers={...getAuthHeaders(),...init.headers};if(init.body instanceof FormData)for(const key of Object.keys(headers))if(key.toLowerCase()==='content-type')delete headers[key];return transport.request(url,{credentials:'same-origin',...init,headers},{timeoutMs:timeoutMs??(init.method&&init.method!=='GET'?60000:15000),onResponse,queued:/^\/api\/(?:upload\/source-(?:sheets|snapshots)\/|duty-roster\?)/.test(url),timeoutMessage:t('读取超时：','Request timed out: ')+url+t('。请重试或检查桌面端运行日志。','. Retry or check the desktop runtime logs.')});}
    const librarySearch=window.MonthlyLibrarySearch?.create({request,t,escape,render:()=>library()})||{configure(){},reset(){},has:()=>false,matchMarkup:()=>'',buttonMarkup:()=>'',statusMarkup:()=>'',bind(){}};
    function cached(url){if(!cache.has(url))cache.set(url,request(url).catch(error=>{cache.delete(url);throw error;}));return cache.get(url);}
    function edit(value,key='value',placeholder=''){
        const field=`field-${fieldIndex++}`;fields.set(field,{value,key});return `<div class="document-edit" contenteditable="true" ${key==='value'&&value.label?.zh==='数据月份'&&current.dataRulesVersion===1?'aria-readonly="true"':''} data-field="${field}" aria-description="${t('输入 @ 引用指标；单击指标设置文字格式，双击更换引用','Type @ to insert a metric; click it to format, double-click to change the reference')}" style="${value.fieldAlign?.[key]?.[language]?'text-align:'+value.fieldAlign[key][language]:''}" data-placeholder="${escape(placeholder)}">${window.MonthlyInlineTools.renderText(pair(value[key]),inlineCatalog(),metricLabel,key==='text'?value.textRuns?.[language]:value.fieldRuns?.[key]?.[language])}</div>`;
    }
    const logoPresets=[
        {url:'/assets/logo.png',zh:'原默认 Logo',en:'Original default logo'},
        {url:'/assets/monthly-logos/01.svg',zh:'01 企业字标',en:'01 Corporate wordmark'},
        {url:'/assets/monthly-logos/02.svg',zh:'02 负空间盾牌',en:'02 Negative space shield'},
        {url:'/assets/monthly-logos/03.svg',zh:'03 建筑几何',en:'03 Architectural geometry'},
        {url:'/assets/monthly-logos/04.svg',zh:'04 CS几何组合',en:'04 CS geometric combination'},
        {url:'',zh:'不显示 Logo',en:'Hide logo'}
    ];
    function logoChoices(){
        const select=document.getElementById('logoSelect');
        const choices=[...logoPresets];
        if(current.logo&&!choices.some(item=>item.url===current.logo))choices.unshift({url:current.logo,zh:'当前 Logo',en:'Current logo'});
        select.setAttribute('aria-label',t('快捷选择 Logo','Quick logo selection'));
        select.innerHTML=choices.map(item=>`<option value="${escape(item.url)}">${escape(item[language])}</option>`).join('')+`<option value="gallery">${t('选择 / 上传其他 Logo…','Choose / upload other logo…')}</option>`;
        select.value=current.logo;
    }
    function syncDefaultFontSizeSelect(){
        const select=document.getElementById('defaultFontSizeSelect');
        if(!select)return;
        const currentSize=current.defaultFontSize||16;
        if(!Array.from(select.options).some(opt=>Number(opt.value)===currentSize)){
            const option=document.createElement('option');option.value=String(currentSize);option.textContent=`${currentSize}px`;
            const next=Array.from(select.options).find(opt=>Number(opt.value)>currentSize);
            if(next)select.insertBefore(option,next);else select.appendChild(option);
        }
        select.value=String(currentSize);
    }
    function updateDefaultFontSize(size){
        const nextSize=Number(size);
        if(!Number.isInteger(nextSize)||nextSize<8||nextSize>72)return;
        const oldSize=current.defaultFontSize||16;
        if(nextSize===oldSize)return;
        checkpoint();
        current.defaultFontSize=nextSize;
        for(const section of current.sections||[]){
            for(const block of section.blocks||[]){
                if(block.textRuns){
                    for(const lang of ['zh','en']){
                        const runs=block.textRuns[lang];
                        if(Array.isArray(runs)){
                            for(const run of runs){
                                if(run.style&&(run.style.fontSize===oldSize||run.style.fontSize===10)){
                                    run.style.fontSize=nextSize;
                                }
                            }
                        }
                    }
                }
            }
        }
        render();
        status(t(`默认文本大小已更新为 ${nextSize}px，请保存月报`,`Default font size updated to ${nextSize}px; save the report`));
    }
    let templateWarning='';
    function createFromDefault(template){
        templateWarning='';
        if(window.MonthlyTemplates&&template)try{return window.MonthlyTemplates.create(template,catalog);}catch(_){templateWarning=t('默认模板格式不兼容；已打开基础模板，服务器模板未改动。','Default template is incompatible; opened a basic template without changing the server template.');}
        else templateWarning=t('默认模板未能读取；已打开基础模板，可重试载入。','Default template unavailable; opened a basic template. Retry loading it.');
        return window.MonthlyTemplates?window.MonthlyTemplates.create(window.MonthlyTemplates.capture(engine.defaults()),catalog):engine.defaults();
    }
    function setLogo(url){checkpoint();current.logo=url;render();status(t('Logo 已更换，请保存月报','Logo changed; save the report'));}
    function actions(){
        const names={'delete-reports':t('删除月报','Delete reports'),new:t('新建月报','New report'),template:t('设为默认模板','Set default template'),save:t('保存到服务器','Save to server'),refresh:t('刷新资料库','Refresh library'),'check-updates':t('检查月报数据更新','Check report updates'), 'add-section':t('＋模块','＋ Module'),layout:t('页面与信息栏','Page & metadata'),html:t('导出 HTML','Export HTML'),msg:t('导出 MSG 邮件','Export MSG email'),print:t('打印 / PDF','Print / PDF'),pdf:t('导出 PDF','Export PDF'),image:t('导出图片','Export image'),project:t('导出工程','Export project'),language:language==='zh'?'English':'中文',undo:t('撤销','Undo')};
        document.querySelectorAll('.designer-toolbar [data-action]').forEach(el=>el.textContent=names[el.dataset.action]);
        document.getElementById('designerName').textContent=t('通用月报编辑器','Universal monthly report editor');
        versionBadge.textContent=t('脚本 v','Script v')+scriptVersion;versionBadge.title=t('当前实际执行的月报编辑器脚本版本','Currently executing monthly editor script version');
        document.title=t('通用月报编辑器','Universal monthly report editor')+' - Tools Platform';
        document.getElementById('legacyMonthlyLink').textContent=t('旧月报','Legacy monthly report');
        document.getElementById('projectImportLabel').textContent=t('导入工程','Import project');
        const monthInput=document.getElementById('reportMonth');monthInput.value=engine.documentMonth(current);document.getElementById('reportMonthLabel').textContent=t('报告月份','Report month');
        logoChoices();window.MonthlyStudioUI?.sync();
    }
    function targetLabel(period){return period?t(`${period} 目标`,`${period} target`):t('未指定目标月份','No target month');}
    function snapshotLabel(snapshot,sourceCatalog=catalog){return `${view.timeLabel(view.importTime(snapshot,sourceCatalog))} · ${targetLabel(view.snapshotPeriod(snapshot,sourceCatalog))} · ${snapshot.kind==='assessment'?t('报表考核结果','Saved assessment'):t('导入提取指标','Imported metrics')}`;}
    function metricLabel(value){
        const text=String(value??'');
        if(language!=='en')return text;
        return window.MonthlyLabels.translate(text,metricTranslations);
    }
    function readMetricTranslations(mapping){
        const result=Object.create(null);
        for(const [key,value] of Object.entries(mapping||{})){
            if(key==='expiring_days_legend'||typeof value!=='string')continue;
            const parsed=new DOMParser().parseFromString(value,'text/html');
            result[key]=(parsed.querySelector('[lang=en],[lang="en-US"],[data-lang=en],.metric-en')||parsed.querySelector('span')||parsed.body).textContent.trim();
        }
        return result;
    }
    function fileDisplayName(file,withMerged=false){
        if(!file)return "";
        const batchFiles=engine.mergeFiles(catalog.files.filter(item=>item.batch_id===file.batch_id));
        const title=metricLabel(view.fileTitle(file,batchFiles,language));
        const count=file.mergedFiles?.length||1;
        return title+(withMerged&&count>1?` [${t('合并','Merged')} ${count}]`:'');
    }
    window.MonthlyCharts.init({root,library:document.getElementById('sourceLibrary'),catalog:reportCatalog,effective:effectiveBlock,load:blockCached,externalPanel:true,t,escape,metricLabel,fileName:fileDisplayName,block:id=>findBlock(id)?.block,change:()=>{checkpoint();},render:()=>{const pending=render();status(t('图表配置已更新，请保存月报','Chart configuration updated; save the report'));return pending;},status});
    function inlineCatalog(){return {...(current.inlineData||catalog),inlineFormulas:current.inlineFormulas||[],reportMonth:current.inlineData&&Object.hasOwn(current.inlineData,'month')?current.inlineData.month:current.dataRulesVersion===1?engine.documentMonth(current):''};}
    function inlinePickerCatalog(){
        const saved=current.inlineData?.snapshots||[];
        return {...catalog,snapshots:[...catalog.snapshots,...saved.filter(snapshot=>!catalog.snapshots.some(item=>item.id===snapshot.id))],inlineFormulas:current.inlineFormulas||[],reportMonth:engine.documentMonth(current)};
    }
    function captureInlineData(){
        if(initializing&&libraryLoading||current.dataRulesVersion!==1||current.inlineData)return;const tokens=new Set();
        for(const text of [current.title,current.footer,...current.meta.flatMap(item=>[item.label,item.value]),...current.sections.flatMap(section=>[section.title,...section.blocks.flatMap(block=>[block.title,block.text,block.rule])])])for(const value of Object.values(text||{}))for(const part of engine.metricTextParts(value,inlineCatalog()))if(part.key)tokens.add(part.key);
        if(!tokens.size)return;const data=inlineCatalog();current.inlineData={month:engine.documentMonth(current),files:[],batches:data.batches,snapshots:data.snapshots.filter(snapshot=>S.snapshotMonth(snapshot,data)===engine.documentMonth(current)).map(snapshot=>({...snapshot,sections:(snapshot.sections||[]).map(section=>({key:section.key})),metrics:clone(snapshot.metrics)}))};
    }
    function reportCatalog(block){return {...(block?.dataUpdateMode==='live'?catalog:block?.savedData?.catalog||catalog),reportMonth:block?.dataUpdateMode==='live'?engine.documentMonth(current):block?.savedData?.month||engine.documentMonth(current)};}
    async function blockCached(url,block){
        const saved=block?.dataUpdateMode==='live'?null:block?.savedData?.resources.find(item=>item.url===url),data=saved?saved.data:await (async()=>{if(block?._savedOnly)throw new Error('Saved resource unavailable');if(block){if(!pendingBlockUrls.has(block.id))pendingBlockUrls.set(block.id,new Set());pendingBlockUrls.get(block.id).add(url);}try{return await cached(url);}finally{pendingBlockUrls.get(block?.id)?.delete(url);}})();
        if(block&&block._renderToken===generation){if(!blockResources.has(block.id))blockResources.set(block.id,new Map());blockResources.get(block.id).set(url,data);}return data;
    }
    function effectiveBlock(block,sourceCatalog=reportCatalog(block),month=sourceCatalog.reportMonth){
        const draft=clone(block);
        for(const {key,value} of S.references(draft))if(key!=='binding'&&value.reference){
            const result=S.resolve(value.reference,sourceCatalog,month);if(!result)throw new Error(t('缺少来源：','Missing source: ')+value.reference.sourceKey+' / '+S.targetMonth(value.reference,month));
            value.fileId=result.file.id;value.sheetId=result.sheet.id;if(S.validMonth(value.label))value.label=result.period||value.label;
        }
        return draft;
    }
    function snapshotCatalog(block){
        const data=reportCatalog(block),fileIds=new Set(),snapshotIds=new Set();
        const draft=effectiveBlock(block,data);
        for(const {key,value} of S.references(draft)){
            if(key==='binding'){
                const found=engine.resolve(value,data);if(found?.file)for(const file of found.file.mergedFiles||[found.file])fileIds.add(file.id);if(found?.snapshot){snapshotIds.add(found.snapshot.id);if(found.snapshot.sourceSnapshotId)snapshotIds.add(found.snapshot.sourceSnapshotId);for(const id of found.metric?.fileIds||[])fileIds.add(id);}
                if(block.type==='chart'&&found?.metric)for(const item of data.snapshots)if(engine.resolve({...value,reference:undefined,mode:'pinned',snapshotId:item.id},data))snapshotIds.add(item.id);
            }else fileIds.add(value.fileId);
        }
        return {files:data.files.filter(file=>fileIds.has(file.id)),snapshots:data.snapshots.filter(item=>snapshotIds.has(item.id)),batches:data.batches.filter(batch=>data.files.some(file=>fileIds.has(file.id)&&file.batch_id===batch.id)||data.snapshots.some(item=>snapshotIds.has(item.id)&&item.batch_id===batch.id))};
    }
    function saveBlockData(block){
        if(initializing&&libraryLoading)return;
        if(block.dataUpdateMode==='live'||!block.savedData&&block.dataUpdateMode!=='snapshot'&&current.dataRulesVersion!==1&&!S.references(block).some(item=>item.value.reference))return;
        if(block.type==='text'||![t('正常','Ready'),t('无匹配记录','No matching records')].includes(dataStates.get(block.id))||!S.references(block).length)return;
        const resources=[...(blockResources.get(block.id)||new Map())].map(([url,data])=>({url,data:clone(data)}));
        const definition=Object.fromEntries(['type','binding','chart','columns','filters','limit','rule'].map(key=>[key,clone(block[key])]));const saved={month:reportCatalog(block).reportMonth,catalog:snapshotCatalog(block),resources,definition};S.validateSaved(saved);block.savedData=saved;delete block.previousData;
    }
    function captureData(){for(const section of current.sections)for(const block of section.blocks)if(block.type!=='text'&&blockResources.has(block.id))saveBlockData(block);captureInlineData();}
    function syncDataState(block){const button=root.querySelector(`[data-op="configure-block"][data-config-tab="source"][data-block="${block.id}"]`);if(button){const state=dataStates.get(block.id)||t('尚未加载','Not loaded');button.title=t('数据来源','Data sources')+' · '+state;button.dataset.dataState=state;}}
    function syncReportDataState(){const states=current.sections.flatMap(section=>section.blocks).filter(block=>block.type!=='text').map(block=>dataStates.get(block.id)),ready=states.filter(state=>state===t('正常','Ready')).length;const control=document.getElementById('reportDataStatus');if(control)control.textContent=t('数据：'+ready+' 项正常、'+(states.length-ready)+' 项待处理','Data: '+ready+' ready, '+(states.length-ready)+' need attention');}
    function rememberSource(file,document=current){
        const key=JSON.stringify([file.kind||'original',S.identity(file.source_key||file.name)]);document.libraryPrefs||={period:libraryPeriod||'',date:libraryDate||'',group:libraryGroup||'',search:'',expandedFileIds:[],expandedSheetIds:[]};document.libraryPrefs.recent=[key,...(document.libraryPrefs.recent||[]).filter(item=>item!==key)].slice(0,30);
    }
    function actualSource(block,key){
        try{const value=S.references(effectiveBlock(block)).find(item=>item.key===key)?.value;if(!value)return '';const data=reportCatalog(block),found=key==='binding'?engine.resolve(value,data):{file:data.files.find(file=>file.id===value.fileId)};
            const file=found?.file,snapshot=found?.snapshot;return file?`${S.fileMonth(file,data)||'—'} · ${view.timeLabel(file.created_at)} · ${value.sheetName||file.sheets.find(sheet=>sheet.id===value.sheetId)?.name||''}`:snapshot?`${S.snapshotMonth(snapshot,data)||'—'} · ${view.timeLabel(view.importTime(snapshot,data))}`:'';
        }catch(_){return '';}
    }
    function referenceVersions(value,rule){
        if(value.kind&&value.kind!=='file')return (S.resolve({...rule,versionMode:'latest'},catalog,engine.documentMonth(current),'snapshot')||[]).map(item=>({id:item.id,label:snapshotLabel(item)}));
        const period=S.targetMonth(rule,engine.documentMonth(current));return catalog.files.filter(file=>S.identity(file.source_key||file.name)===rule.sourceKey&&(file.kind||'original')===rule.sourceKind&&(!period||S.fileMonth(file,catalog)===period)).map(file=>({id:file.id,label:view.timeLabel(file.created_at)+' · '+file.name}));
    }
    async function referenceChange(block,key,option,value){
        if(!catalogComplete){const logId=MonthlyLoadLog.start(t("载入可选来源版本","Loading source versions"));try{catalog=await loadCatalog(0,logId,{history:true});catalogComplete=!catalog.failedGroups?.length;MonthlyLoadLog.finish(logId);}catch(error){MonthlyLoadLog.finish(logId,error.message);throw error;}}
        const draft=clone(current),target=draft.sections.flatMap(section=>section.blocks).find(item=>item.id===block.id),entry=S.references(target).find(item=>item.key===key)?.value;if(!entry)return;
        const oldData=reportCatalog(block),old=key==='binding'?engine.resolve(block.binding,oldData):{file:oldData.files.find(file=>file.id===entry.fileId||file.sheets.some(sheet=>sheet.id===entry.sheetId))};
        let rule=entry.reference;
        if(!rule){if(old?.file)rule=S.create(old.file,old.sheet||old.file.sheets.find(sheet=>sheet.id===entry.sheetId)||old.file.sheets[0],oldData,engine.documentMonth(current));else rule={monthMode:'relative',offset:0,month:'',versionMode:'latest',versionId:'',sourceKey:'',sourceKind:old?.snapshot?.kind||'extraction',sheetName:''};}
        if(option==='relation'){
            if(value==='legacy'){delete entry.reference;if(target.savedData)target.previousData=target.savedData;delete target.savedData;}
            else{rule.monthMode=['fixed','global'].includes(value)?value:'relative';if(!['offset','fixed','global'].includes(value))rule.offset=Number(value);if(value==='fixed')rule.month=engine.documentMonth(current);entry.reference=rule;}
        }else{entry.reference=rule;if(option==='month')rule.month=value;if(option==='offset')rule.offset=Number(value);if(option==='version'){rule.versionMode=value;rule.versionId=value==='pinned'?(old?.file?.id||old?.snapshot?.id||''):'';if(value==='pinned')rule.versionSignature=old?.file?.sha256||old?.file?.created_at||old?.snapshot?.captured_at||'';else delete rule.versionSignature;}if(option==='versionId'){if(!value)return;rule.versionId=value;const version=catalog.files.find(file=>file.id===value)||catalog.snapshots.find(snapshot=>snapshot.id===value);rule.versionSignature=version?.sha256||version?.created_at||version?.captured_at||'';}}
        if(entry.reference){S.validate(entry.reference);const match=S.resolve(rule,catalog,engine.documentMonth(current),entry.kind&&entry.kind!=='file'?'snapshot':'file');if(!match||(Array.isArray(match)&&!match.length))throw new Error(t('缺少对应月份 / 版本来源；当前结果已保留。','No matching month / version; current results retained.'));}
        if(target.savedData)target.previousData=target.savedData;delete target.savedData;engine.normalize(draft);checkpoint();current=draft;blockResources.delete(block.id);cache.clear();await render();
    }
    async function useSelection(action,payloads){
        if(!payloads.length)return;const draft=clone(current),id=window.MonthlyPivotPanel.activeId(),existing=draft.sections.flatMap(section=>section.blocks).find(block=>block.id===id);
        if(action==='add'&&!existing)throw new Error(t('先选择月报中的组件','Select a report component first'));
        const section=(existing?draft.sections.find(section=>section.blocks.some(block=>block.id===id)):draft.sections[0])||engine.section();if(!draft.sections.includes(section))draft.sections.push(section);
        let target=existing;
        if(action==='chart'||action==='add'&&existing.type==='chart'){
            if(action==='chart'){target=engine.block('chart');target.title=engine.bilingual('数据透视图表','Pivot chart');target.chart.type='column';target.chart.pivot={sources:[],rows:[],columns:[],values:[],filters:[],excludeTotals:true,showTotals:false,sort:'source'};section.blocks.push(target);}
            for(const payload of payloads){const file=catalog.files.find(item=>item.id===payload.fileId),sheet=file?.sheets.find(item=>item.id===payload.sheetId);if(!sheet)throw new Error(t('源表不存在','Source not found'));const sources=target.chart.pivot?target.chart.pivot.sources:(target.chart.series||=[]);if(!sources.some(source=>source.sheetId===sheet.id)){if(sources.length>=8)throw new Error(t('最多支持8个数据源','Up to 8 sources'));const source={fileId:file.id,sheetId:sheet.id,label:S.fileMonth(file,catalog)||fileDisplayName(file),reference:S.create(file,sheet,catalog,engine.documentMonth(current))};if(!target.chart.pivot){const data=await cached('/api/upload/source-sheets/'+encodeURIComponent(sheet.id));source.x=data.headers.includes(target.chart.x)?target.chart.x:data.headers.find(field=>data.rows.some(row=>number(row[field])===null&&String(row[field]??'').trim()))||data.headers[0]||'';source.y=data.headers.includes(target.chart.y)?target.chart.y:data.headers.find(field=>field!==source.x&&data.rows.some(row=>number(row[field])!==null))||'';}sources.push(source);}rememberSource(file,draft);}
        }else{
            for(const [index,payload] of payloads.entries()){const file=catalog.files.find(item=>item.id===payload.fileId),sheet=file?.sheets.find(item=>item.id===payload.sheetId);if(!sheet)throw new Error(t('源表不存在','Source not found'));const table=engine.block('table');if(action==='add'&&index===0){for(const key of ['id','title','span','heightUnits','align'])table[key]=clone(existing[key]);if(existing.fieldRuns?.title)table.fieldRuns={title:clone(existing.fieldRuns.title)};if(existing.fieldAlign?.title)table.fieldAlign={title:clone(existing.fieldAlign.title)};section.blocks[section.blocks.indexOf(existing)]=table;}else section.blocks.push(table);table.title.zh||=fileDisplayName(file)+' / '+sheet.name;table.title.en||=file.name+' / '+sheet.name;table.binding={kind:'file',mode:'pinned',fileId:file.id,sourceKey:file.source_key||'',sheetName:sheet.name,tableMode:'original',reference:S.create(file,sheet,catalog,engine.documentMonth(current))};target=table;rememberSource(file,draft);}
        }
        if(target.savedData)target.previousData=target.savedData;delete target.savedData;engine.normalize(draft);checkpoint();current=draft;await render();await window.MonthlyPivotPanel.open(target.id,action==='chart'?'processing':'source');status(t('数据已加入月报；可以撤销','Data added to report; Undo is available'));
    }
    async function previewSource(payload){
        try{await window.MonthlySourceTableEditor.open({...payload,searchContext:librarySearch.previewMatch?.(payload),request,t,escape,onSaved:async()=>{cache.clear();blockResources.clear();await refresh();status(t('原始表已更新；已保存的历史月报结果保持原样，需要时检查数据更新','Source updated; saved historical reports retain their results. Check updates when needed.'));}});}catch(error){status(error.message);}
    }
    function mountEditor(block,host,tab){if(tab==='layout'){mountLayoutEditor(block,host);return;}editBlock(findBlock(block.id),host);host.dataset.inspectorEditorTab=tab;if(tab==='processing')host.querySelector('h3').textContent=({metric:t('选择指标','Choose a metric'),table:t('选择表格与展示字段','Choose table and display fields'),chart:t('图表数据与统计','Chart data and aggregation'),summary:t('选择数据与生成总结','Choose data and build a summary')})[block.type]||t('组件设置','Component settings');host.querySelectorAll('form [name]').forEach(input=>input.closest('label')?.setAttribute('data-inspector-name',input.name));}
    // Layout edits only geometry. Do not build hidden source pickers or read worksheet data.
    function mountLayoutEditor(block,host){
        const found=findBlock(block.id);host.dataset.inspectorEditorTab='layout';
        const option=(value,label,selected)=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label)}</option>`;
        host.innerHTML=`<form class="block-editor-form"><label>${t('移至模块','Move to module')}<select name="section">${current.sections.map(section=>option(section.id,pair(section.title),found.section.id)).join('')}</select></label><label>${t('位置宽度（12列网格）','Slot width (12-column grid)')}<input name="span" type="number" min="1" max="12" value="${block.span}" required></label><label>${t('卡片最小高度（网格数，0=自动）','Minimum card height (grid units; 0 = auto)')}<input name="heightUnits" type="number" min="0" max="100" value="${block.heightUnits||0}" required></label><label>${t('内容对齐','Alignment')}<select name="align">${['left','center','right'].map(value=>option(value,{left:t('左','Left'),center:t('中','Center'),right:t('右','Right')}[value],block.align)).join('')}</select></label><p role="status"></p><footer><button type="button" data-cancel>${t('取消','Cancel')}</button><button type="submit">${t('应用','Apply')}</button></footer></form>`;
        host.querySelector('[data-cancel]').onclick=()=>host.replaceChildren();
        host.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.target;if(!form.reportValidity())return;try{
            const f=form.elements,draft=clone(current),section=draft.sections.find(section=>section.blocks.some(item=>item.id===block.id)),target=section.blocks.find(item=>item.id===block.id);
            Object.assign(target,{span:Number(f.span.value),heightUnits:Number(f.heightUnits.value),align:f.align.value});
            if(f.section.value!==section.id){section.blocks=section.blocks.filter(item=>item.id!==block.id);draft.sections.find(item=>item.id===f.section.value).blocks.push(target);}
            engine.normalize(draft);checkpoint();current=draft;await render();status(t('布局已应用，请保存月报','Layout applied; save the report'));
        }catch(error){host.querySelector('[role=status]').textContent=error.message;}};
    }
    async function componentPresets(block,host){
        host.presetBlock=block;
        host.innerHTML=`<p role="status">${t('读取复用配置…','Loading component presets…')}</p>`;
        let presets=await request('/api/upload/monthly-component-presets'),selected='';if(!host.isConnected)return;
        const draw=()=>{host.innerHTML=`<h3>${t('组件复用配置','Reusable component settings')}</h3><p>${t('保存当前组件已应用的整套配置：来源规则、数据处理、展示样式和布局，供其他月报或模板中的单个组件主动采用。不会更新默认模板，不携带业务数据。','Saves all applied source, processing, style and layout settings for reuse by one component in another report or template. Does not update the default template or include business rows.')}</p><select data-component-preset><option value="">${t('新建配置','New preset')}</option>${presets.map(preset=>`<option value="${preset.id}" ${selected===preset.id?'selected':''}>${escape(preset.name)}</option>`).join('')}</select><input data-component-name maxlength="200" value="${escape(presets.find(preset=>preset.id===selected)?.name||pair(block.title)||typeName(block.type))}" aria-label="${t('配置名称','Preset name')}"><button data-component-load>${t('采用此配置','Use this preset')}</button><button data-component-save>${t('保存复用配置到服务器','Save reusable preset')}</button><button data-component-delete>${t('删除复用配置','Delete preset')}</button><p role="status"></p>`;};draw();
        host.onchange=event=>{if(event.target.matches('[data-component-preset]')){selected=event.target.value;draw();}};
        host.onclick=async event=>{const button=event.target.closest('[data-component-load],[data-component-save],[data-component-delete]');if(!button)return;button.disabled=true;try{
            if(button.hasAttribute('data-component-load')){const preset=presets.find(item=>item.id===selected);if(!preset)throw new Error(t('请选择配置','Select a preset'));const generated=window.MonthlyTemplates.create(preset.rules,catalog,engine.documentMonth(current)),generatedBlock=generated.sections[0].blocks[0],draft=clone(current),imported=window.MonthlyMetricFormulas.importBlock(generatedBlock,generated.inlineFormulas||[],draft.inlineFormulas||[],engine.uid),replacement=imported.block;if(imported.definitions.length)draft.inlineFormulas=imported.definitions;replacement.id=block.id;const section=draft.sections.find(section=>section.blocks.some(item=>item.id===block.id));section.blocks[section.blocks.findIndex(item=>item.id===block.id)]=replacement;engine.normalize(draft);checkpoint();current=draft;blockResources.delete(block.id);await render();return;}
            if(button.hasAttribute('data-component-save')){const name=host.querySelector('[data-component-name]').value.trim();if(!name)throw new Error(t('请填写配置名称','Enter a preset name'));const draft=clone(current),found=findBlock(block.id);draft.sections=[{...clone(found.section),blocks:[clone(found.block)]}];const rules=window.MonthlyTemplates.capture(draft,catalog),preset=await request('/api/upload/monthly-component-presets'+(selected?'/'+encodeURIComponent(selected):''),{method:selected?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,rules})});presets=presets.filter(item=>item.id!==preset.id).concat(preset);selected=preset.id;draw();host.querySelector('[role=status]').textContent=t('配置已保存，可在其他月份主动载入','Saved; explicitly load this preset in another month');return;}
            if(selected){await request('/api/upload/monthly-component-presets/'+encodeURIComponent(selected),{method:'DELETE'});presets=presets.filter(item=>item.id!==selected);selected='';draw();}
        }catch(error){host.querySelector('[role=status]').textContent=error.message;button.disabled=false;}};
    }
    async function configure(action,block,panel){
        try{
            if(action==='advanced'){await window.MonthlyPivotPanel.open(block.id,'processing');const details=panel.querySelector('[data-processing-binding]');if(details)details.open=true;return;}
            if(action==='presets'){const host=panel.querySelector('[data-component-presets-host]'),button=panel.querySelector('[data-inspector-action=presets]');host.hidden=!host.hidden;button.setAttribute('aria-expanded',String(!host.hidden));if(!host.hidden&&!host.children.length)try{await componentPresets(block,host);}catch(error){host.replaceChildren();throw error;}return;}
            let host=panel.querySelector('[data-inspector-editor]');if(!host){host=document.createElement('div');host.setAttribute('data-inspector-editor','');panel.querySelector('.inspector-body').append(host);}
            if(action==='mapping')await window.MonthlyMappingEditor.open(block,host);if(action==='format')await window.MonthlyDataFormatEditor.open(block,host);
            if(action==='pivot'){await window.MonthlyCharts.enablePivot(block);await window.MonthlyPivotPanel.open(block.id,'processing');}
            if(action==='retry'){if(pendingBlocks.has(block.id))return;for(const url of blockResources.get(block.id)?.keys()||[])cache.delete(url);blockResources.delete(block.id);if(block.savedData)block.previousData=block.savedData;delete block.savedData;const job=renderBlock(block,generation);renderPromise=Promise.all([renderPromise,job]).then(()=>{syncReportDataState();window.MonthlyPivotPanel?.sync();});await job;}
        }catch(error){status(error.message);}
    }
    async function checkUpdates(nextMonth=engine.documentMonth(current)){
        const oldInline=inlineCatalog(),inlineValues=new Map([...root.querySelectorAll('[data-metric-token]')].map(element=>[element.dataset.metricToken,element.textContent]));
        const controller=new AbortController(),reads=new Map();
        dialog.innerHTML=`<h3>${t('检查月报数据更新','Check report updates')}</h3><p>${t('正在检查来源匹配与字段…','Checking sources and fields…')}</p><button data-update-stop>${t('取消检查','Cancel check')}</button>`;dialog.showModal();
        let checking=true;const cancel=()=>{if(checking)controller.abort();};dialog.addEventListener('close',cancel,{once:true});dialog.querySelector('[data-update-stop]').onclick=()=>{dialog.close();actions();};
        const read=url=>{if(!reads.has(url))reads.set(url,request(url,{signal:controller.signal}));return reads.get(url);};
        status(t('正在检查来源匹配与字段…','Checking sources and fields…'));let fresh;const updateLog=MonthlyLoadLog.start(t('检查数据更新','Checking data updates'));try{fresh=await loadCatalog(0,updateLog,{meetingFileIds:meetingReferences(),signal:controller.signal});}catch(error){MonthlyLoadLog.finish(updateLog,error.message);checking=false;dialog.close();actions();throw error;}MonthlyLoadLog.finish(updateLog,fresh.failedGroups.length?fresh.failedGroups.join(', '):undefined);catalog=fresh;catalogComplete=false;library();
        const plans=[],blocks=current.sections.flatMap(section=>section.blocks.filter(block=>block.type!=='text').map(block=>({section,block})));let cursor=0;
        await Promise.all(Array.from({length:Math.min(4,blocks.length)},async()=>{while(cursor<blocks.length&&!controller.signal.aborted){const {section,block}=blocks[cursor++];let changed=nextMonth!==engine.documentMonth(current),candidate=clone(block),error='',resources=new Map();delete candidate.savedData;
            try{
                const previous=effectiveBlock(block),next=effectiveBlock(candidate,{...catalog,reportMonth:nextMonth},nextMonth);
                for(const {key,value} of S.references(next)){
                    const before=S.references(previous).find(item=>item.key===key)?.value;let old,newer;
                    if(key==='binding'){old=engine.resolve(before,reportCatalog(block));newer=engine.resolve(value,{...catalog,reportMonth:nextMonth});}
                    else{const oldFile=reportCatalog(block).files.find(file=>file.id===before.fileId);old=oldFile?{file:oldFile,sheet:oldFile.sheets.find(sheet=>sheet.id===before.sheetId)}:null;newer={file:catalog.files.find(file=>file.id===value.fileId),sheet:catalog.files.find(file=>file.id===value.fileId)?.sheets.find(sheet=>sheet.id===value.sheetId)};}
                    if(!newer&&value.sourceKey==='夜间运维值班表')newer={file:{id:'virtual_duty_roster'}};if(!newer)throw new Error(t('缺少来源','Missing source'));if(!newer.file&&!newer.snapshot)throw new Error(t('缺少来源','Missing source'));
                    changed||=JSON.stringify(old)!==JSON.stringify(newer);
                    const urls=[];
                    if(newer.file?.id==='virtual_duty_roster'||newer.file?.kind==='duty_roster')urls.push('/api/duty-roster?month='+encodeURIComponent(value.reference?S.targetMonth(value.reference,nextMonth)||nextMonth:nextMonth));
                    else if(newer.sheet)for(const file of newer.file.mergedFiles||[newer.file]){const sheet=file.sheets.find(sheet=>sheet.name===newer.sheet.name);if(sheet)urls.push('/api/upload/source-sheets/'+encodeURIComponent(sheet.id));}
                    else if(newer.section)urls.push('/api/upload/source-snapshots/'+encodeURIComponent(newer.snapshot.sourceSnapshotId||newer.snapshot.id)+'/sections/'+encodeURIComponent(newer.section.key));
                    else if(newer.metric&&block.type!=='metric'){
                        if(value.tableMode==='processed'&&newer.metric.sourceSection&&!newer.metric.parentMetricKey)urls.push('/api/upload/source-snapshots/'+encodeURIComponent(newer.snapshot.sourceSnapshotId||newer.snapshot.id)+'/metrics/'+encodeURIComponent(newer.metric.sourceMetricKey||newer.metric.key)+'/rows');
                        else for(const fileId of newer.metric.fileIds||[]){const file=catalog.files.find(file=>file.id===fileId),sheet=value.sheetName?file?.sheets.find(sheet=>sheet.name===value.sheetName):file?.sheets[0];if(sheet)urls.push('/api/upload/source-sheets/'+encodeURIComponent(sheet.id));}
                    }
                    const tables=await Promise.all(urls.map(async url=>{const table=await read(url);resources.set(url,table);return table;}));
                    const headers=[...new Set(tables.flatMap(table=>table.headers||table.weeks&&['Period',...table.weeks.map(week=>week.key)]||[]))];
                    const fields=key==='binding'?[...block.columns,...block.filters.map(item=>item.column)]:block.chart.pivot?[...block.chart.pivot.rows,...block.chart.pivot.columns,...block.chart.pivot.values.map(item=>item.field),...block.chart.pivot.filters.map(item=>item.field)].filter(field=>!field.startsWith('__monthly_')).map(field=>value.mapping?.[field]||field):[value.x,value.y].filter(Boolean);
                    const missing=fields.filter(field=>!headers.includes(field));if(missing.length)throw new Error(t('缺少字段：','Missing fields: ')+[...new Set(missing)].join('、'));

                }
            }catch(e){error=e.message;}
            const proposed=S.references(candidate).map(({key,value})=>{try{const resolved=key==='binding'?engine.resolve(value,{...catalog,reportMonth:nextMonth}):S.resolve(value.reference||S.create(catalog.files.find(file=>file.id===value.fileId),null,catalog,nextMonth,true),catalog,nextMonth);const item=resolved?.file||resolved?.snapshot;return item?(item.target_period||S.targetMonth(value.reference||{monthMode:'fixed',month:nextMonth},nextMonth))+' · '+view.timeLabel(item.created_at||item.captured_at):'';}catch(_){return '';}}).filter(Boolean).join('；');
            plans.push({proposed,id:block.id,label:pair(section.title)+' / '+(pair(block.title)||typeName(block.type)),current:S.references(block).map(item=>actualSource(block,item.key)).filter(Boolean).join('；'),candidate,changed,error,resources});
        }}));checking=false;dialog.removeEventListener('close',cancel);if(controller.signal.aborted){actions();status(t('已取消检查','Check cancelled'));return;}plans.sort((a,b)=>blocks.findIndex(item=>item.block.id===a.id)-blocks.findIndex(item=>item.block.id===b.id));
        const texts=[current.title,current.footer,...current.meta.flatMap(item=>[item.label,item.value]),...current.sections.flatMap(section=>[section.title,...section.blocks.flatMap(block=>[block.title,block.text,block.rule])])].flatMap(value=>Object.values(value||{})),freshInline={...catalog,inlineFormulas:current.inlineFormulas||[],reportMonth:current.dataRulesVersion===1||nextMonth!==engine.documentMonth(current)?nextMonth:''},tokens=new Map();
        for(const text of texts)for(const part of engine.metricTextParts(text,oldInline))if(part.key)tokens.set(part.token,part);
        if(tokens.size){const next=new Map();for(const text of texts)for(const part of engine.metricTextParts(text,freshInline))if(part.key)next.set(part.token,part);const missing=[...next.values()].filter(part=>part.missing||part.error),changed=[...tokens].some(([token,part])=>String(inlineValues.get(token)??part.value)!==String(next.get(token)?.value)||JSON.stringify(part.operandValues)!==JSON.stringify(next.get(token)?.operandValues));plans.push({id:'inline',label:t('动态指标（正文 / 信息栏）','Dynamic metrics (text / metadata)'),current:[...tokens].map(([token,part])=>part.label+': '+(inlineValues.get(token)??part.value)).join('；'),proposed:[...next.values()].map(part=>part.label+': '+part.value).join('；'),changed:changed||nextMonth!==engine.documentMonth(current),error:missing.length?t('指标引用或公式异常：','Metric or formula unavailable: ')+missing.map(part=>part.label).join('、'):'',resources:new Map()});}
        const targetMonth=nextMonth,manual=current.sections.flatMap(section=>section.blocks).filter(block=>block.type==='text'&&pair(block.text).trim()&&!/\[\[@(?:metric|formula):/.test(pair(block.text))).length;
        dialog.innerHTML=`<h3>${t('月报数据更新预览','Report data update preview')} · ${escape(targetMonth)}</h3><p>${t('刷新资料库不修改报告。勾选后统一应用，可撤销；固定版本保持锁定。','Refreshing the library does not change the report. Select updates to apply; Undo is available. Pinned versions stay pinned.')}</p>${targetMonth!==engine.documentMonth(current)?`<p>${t('新月份有 '+manual+' 个手填文字组件，请核对数字和月份。',manual+' manual text components require checking numbers and months.')}</p>`:''}<div class="update-preview-scroll"><table class="update-preview"><colgroup><col style="width:36px"><col style="width:20%"><col><col><col style="width:140px"></colgroup><thead><tr><th></th><th>${t('组件','Component')}</th><th>${t('当前来源','Current source')}</th><th>${t('更新后来源','Proposed source')}</th><th>${t('状态','Status')}</th></tr></thead><tbody>${plans.map(plan=>`<tr><td><input type="checkbox" data-update-id="${plan.id}" aria-label="${escape(t('更新：','Update: ')+plan.label)}" ${plan.changed&&!plan.error?'checked':''} ${plan.error?'disabled':''}></td><td>${escape(plan.label)}</td><td>${escape(plan.current)}</td><td>${escape(plan.proposed||'—')}</td><td class="update-preview-state"><span class="update-state-badge" data-update-state="${plan.error?'error':plan.changed?'changed':'same'}">${plan.error?t('待处理','Needs attention'):t(plan.changed?'有更新':'数据一致',plan.changed?'Update available':'Unchanged')}</span>${plan.error?`<small>${escape(plan.error)}</small>`:''}</td></tr>`).join('')}</tbody></table></div><p role="status"></p><footer><button data-update-cancel>${t('取消','Cancel')}</button><button data-update-all>${t('选择全部可用更新','Select all available')}</button><button data-update-apply>${t('应用选中更新','Apply selected')}</button></footer>`;
        dialog.querySelector('[data-update-cancel]').onclick=()=>{dialog.close();actions();};dialog.querySelector('[data-update-all]').onclick=()=>dialog.querySelectorAll('[data-update-id]:not(:disabled)').forEach(input=>input.checked=true);
        dialog.querySelector('[data-update-apply]').onclick=async()=>{
            const selected=new Set([...dialog.querySelectorAll('[data-update-id]:checked')].map(input=>input.dataset.updateId));
            const draft=clone(current);for(const section of draft.sections)for(const block of section.blocks)if(selected.has(block.id)){if(block.savedData)block.previousData=block.savedData;delete block.savedData;blockResources.delete(block.id);}else if(targetMonth!==engine.documentMonth(current)&&S.references(block).some(item=>item.value.reference)){const plan=plans.find(plan=>plan.id===block.id);if(!plan?.error){dialog.querySelector('[role=status]').textContent=t('切换报告月份时，请应用全部按月份引用的组件，避免月份混用。','Select all month-relative components when changing the report month.');return;}}
            if(targetMonth!==engine.documentMonth(current)&&tokens.size&&!selected.has('inline')&&!plans.find(plan=>plan.id==='inline')?.error){dialog.querySelector('[role=status]').textContent=t('请同时应用动态指标月份更新。','Apply the dynamic metric month update as well.');return;}
            checkpoint();if(selected.has('inline')){history.at(-1).inlineData={files:[],snapshots:oldInline.snapshots,batches:oldInline.batches,month:oldInline.reportMonth||''};delete draft.inlineData;}
            current=draft;current.reportMonth=targetMonth;if(targetMonth!==engine.documentMonth(history.at(-1)))current.dataRulesVersion=1;if(targetMonth!==engine.documentMonth(history.at(-1))&&!tokens.size)delete current.inlineData;cache.clear();for(const plan of plans)if(selected.has(plan.id))for(const [url,data] of plan.resources)cache.set(url,Promise.resolve(data));dialog.close();await render();for(const plan of plans)if(plan.error){dataStates.set(plan.id,plan.error+t('；保留上次结果','; last result retained'));if(plan.id!=='inline')syncDataState(findBlock(plan.id).block);}window.MonthlyPivotPanel.sync();syncReportDataState();status(t('已应用数据更新；可撤销，请保存月报','Updates applied; Undo is available. Save the report.'));
        };
        status(t('已完成更新检查','Update check complete'));
    }
    function restoreLibrary(){
        const prefs=current.libraryPrefs||{};if(prefs.loadDays!==undefined&&prefs.loadDays!==libraryDays){libraryDays=prefs.loadDays;if(directoryCatalog&&loadedDays!==libraryDays)refresh().catch(()=>{});}
        libraryPeriod=prefs.period??null;libraryDate=prefs.date??null;libraryGroup=prefs.group??null;
        library();
    }
    document.getElementById('sourceLibrary').addEventListener('toggle',event=>{
        const element=event.target;if(!element.isConnected||!document.getElementById('sourceLibrary').contains(element))return;
        if(element.matches('[data-file-history]')&&element.open&&!element.querySelector('[data-history-body]').children.length){
            const directory=directoryCatalog||catalog,file=directory.files.find(file=>file.id===element.dataset.fileHistory);
            const displayed=new Set(JSON.parse(element.closest('.library-file-item').dataset.currentFileIds||'[]')),groups=file?S.libraryGroups(directory,S.fileMonth(file,directory)).filter(group=>group.versions.some(item=>displayed.has(item.id))):[],versions=[...new Map(groups.flatMap(group=>group.versions).filter(version=>!displayed.has(version.id)).map(version=>[version.id,version])).values()].sort((a,b)=>S.time(b.created_at)-S.time(a.created_at));
            element.querySelector('[data-history-body]').innerHTML=versions.map(version=>`<div class="source-history-version" data-history-version="${escape(version.id)}"><div class="source-history-date">${escape(view.timeLabel(version.created_at))}</div><div class="source-history-name" title="${escape(version.name)}">${escape(view.compactFileName(version.name))}</div><small>${version.kind==='structured'?t('结构化行存档','Structured row archive'):t('原文件存档','Original archive')} · ${Number(version.size)||0} B</small>${window.MonthlyCharts.library(version)}<a class="source-action" href="/api/upload/source-files/${encodeURIComponent(version.id)}/download" title="${escape(view.fileDownloadInfo(version,language))}">${t('下载此版本','Download this version')}</a></div>`).join('')||`<p class="source-history-empty">${t('暂无其他历史版本','No other historical versions')}</p>`;W.syncSelection();
        }
        const key=element.matches('.library-file-item')?'expandedFileIds':null;
        if(!key||!current.libraryPrefs)return;
        const id=element.dataset.fileId;
        const previous=current.libraryPrefs[key]||[];
        if(previous.includes(id)===element.open)return;
        current.libraryPrefs[key]=element.open?[...previous,id]:previous.filter(value=>value!==id);dirty=true;
    },true);
    function library(){
        // Background catalog updates must not rebuild the input during typing or IME composition.
        if(librarySearchComposing||librarySearchTimer!==null)return;
        const contentScroll=document.querySelector('#sourceLibrary .library-content')?.scrollTop||0,searchFocused=document.activeElement?.id==='sourceSearch',cursor=document.activeElement?.selectionStart,cursorEnd=document.activeElement?.selectionEnd,cursorDirection=document.activeElement?.selectionDirection;
        const directory=directoryCatalog||catalog,cutoff=libraryDays?Date.now()-libraryDays*86400000:0;const sourceCatalog={...directory,files:directory.files.filter(file=>!cutoff||S.time(file.created_at)>=cutoff),snapshots:directory.snapshots.filter(snapshot=>!cutoff||S.time(snapshot.captured_at)>=cutoff)};const groups=view.groups(sourceCatalog);
        const periods=[...new Set([...groups.map(group=>group.period),...sourceCatalog.files.map(file=>S.fileMonth(file,sourceCatalog)).filter(Boolean)])].sort((a,b)=>b.localeCompare(a));
        if(!periods.includes(libraryPeriod)&&(!libraryLoading||libraryPeriod===null))libraryPeriod=periods[0]??'';
        const inPeriod=groups.filter(group=>group.period===libraryPeriod);
        const dates=[...new Set(inPeriod.map(group=>group.date))];
        if(!dates.includes(libraryDate)&&(!libraryLoading||libraryDate===null))libraryDate=dates[0]??'';
        const dated=inPeriod.filter(group=>group.date===libraryDate);
        if(!dated.some(group=>group.id===libraryGroup)&&(!libraryLoading||libraryGroup===null))libraryGroup=dated.find(group=>group.fileIds.length)?.id ?? dated[0]?.id;
        const selected=dated.find(group=>group.id===libraryGroup);
        current.libraryPrefs={loadDays:libraryDays,search:'',expandedFileIds:[],expandedSheetIds:[],...current.libraryPrefs,period:libraryPeriod,date:libraryDate,group:libraryGroup||''};
        if(!engine.documentMonth(current))current.reportMonth=libraryPeriod||new Date().toISOString().slice(0,7);
        engine.applyReportDefaults(current,engine.documentMonth(current),'');
        const latestGroups=S.libraryGroups(sourceCatalog,libraryPeriod),latestFiles=latestGroups.map(group=>group.file);
        const batchFiles=current.libraryPrefs.advanced?sourceCatalog.files.filter(file=>selected?.fileIds.includes(file.id)):latestFiles;
        const periodDutyFiles=(current.libraryPrefs.advanced?sourceCatalog.files:latestFiles).filter(file=>(file.kind==='duty_roster'||file.source_key==='夜间运维值班表')&&(!libraryPeriod||file.name.includes(libraryPeriod)||selected?.fileIds.includes(file.id)));
        const topicFiles=(current.libraryPrefs.advanced?sourceCatalog.files:latestFiles).filter(file=>file.kind==='topic_monthly'&&file.target_period===libraryPeriod);
        const meetingFiles=(current.libraryPrefs.advanced?sourceCatalog.files:latestFiles).filter(file=>file.kind==='meeting_attendance'&&file.target_period===libraryPeriod);
        const files=engine.mergeFiles([...new Map([...batchFiles,...periodDutyFiles,...topicFiles,...meetingFiles].map(file=>[file.id,file])).values()]);
        const sortedFiles=view.sortPriorityFiles(files);
        const topicTableFiles=sortedFiles.filter(file=>view.fileCategory(file)==='topic');
        const meetingTableFiles=sortedFiles.filter(file=>view.fileCategory(file)==='meeting');
        const ticketFiles=sortedFiles.filter(file=>view.fileCategory(file)==='tickets');
        const tableFiles=sortedFiles.filter(file=>view.fileCategory(file)==='metrics');
        const displayedIds=new Set([...ticketFiles,...tableFiles,...topicTableFiles,...meetingTableFiles].map(file=>file.id));
        const rawFiles=sortedFiles.filter(file=>!displayedIds.has(file.id));
        const options=(values,selected,label)=>values.map(value=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label(value))}</option>`).join('');
        const historyByFile=new Map();for(const group of S.libraryGroups(directory,libraryPeriod))for(const version of group.versions)historyByFile.set(version.id,group.versions);
        const categoryNames={tickets:t('临期详单','Expiry tickets'),metrics:t('指标与关键数据表','Metrics & priority'),raw:t('原始表名称呈现','Raw table names'),topic:t('专题分析月报数据','Topic monthly report data'),meeting:t('会议考勤原始表','Meeting attendance sources')};
        const renderFileItem=file=>{
            const actualCategory=view.fileCategory(file),isTicket=actualCategory==='tickets',classification=file.library_category_rule||{...window.MonthlySourceCategories.identity(file),mode:window.MonthlySourceCategories.builtin(file)?'builtin':'automatic'},canCorrect=localStorage.getItem('tools_role')==='admin';
            const isDuty=file.kind==='duty_roster'||file.source_key==='夜间运维值班表';
            const title=fileDisplayName(file);
            const metrics=view.fileDisplayMetrics(file,files).map(metricLabel);
            const originals=file.mergedFiles||[file];
            const currentIds=new Set(originals.map(item=>item.id)),historyCount=new Set(originals.flatMap(item=>historyByFile.get(item.id)||[]).filter(item=>!currentIds.has(item.id)).map(item=>item.id)).size;
            const batch=sourceCatalog.batches.find(item=>item.id===file.batch_id),importOrigin=batch?.source||'';
            const states=originals.map(item=>item.metricSourceState||(item.metricLabels?.length?'single':'original')),sourceState=['cross','single','unconfirmed'].find(state=>states.includes(state))||'original';
            const sourceBadge=sourceState==='original'?'':`<span class="library-source-badge" title="${escape(sourceState==='unconfirmed'?t('该导入批次含来源未确认的指标，不表示这些指标属于此表','This import batch contains metrics with unconfirmed sources; they are not attributed to this table'):sourceState==='cross'?t('包含明确配置的跨表统计指标','Contains explicitly configured cross-table metrics'):t('指标已明确关联此原始表','Metrics are linked to this source table'))}">${{single:t('单表','Single table'),cross:t('跨表','Cross-table'),unconfirmed:t('待确认','Unconfirmed')}[sourceState]}</span>`;
            const mergedBadge=originals.length>1?`<span class="library-badge-merged" title="${t('已合并 '+originals.length+' 个原始文件','Merged '+originals.length+' original files')}">${t('合并','Merged')}</span>`:'';
            const dutyLink=isDuty?`<a href="/pages/duty-roster.html?month=${encodeURIComponent(libraryPeriod||'')}" target="_blank" class="source-action library-edit-duty-link">${t('编辑值班表','Edit roster')}</a>`:'';
            const searchKey=escape((title+' '+originals.map(item=>item.name).join(' ')+' '+(file.metricLabels||[]).concat((file.metricLabels||[]).map(metricLabel)).join(' ')).toLowerCase());
            const categoryEditor=`<section class="source-category-editor"><div class="source-category-heading"><strong>${t('纠正分类','Correct category')}</strong><span>${classification.mode==='manual'?t('已手动纠正','Manual rule'):classification.mode==='builtin'?t('默认特殊分类','Default exception'):t('自动分类','Automatic')}</span></div><div class="source-category-form"><select data-category-file="${escape(file.id)}" aria-label="${t('资料库分类','Library category')}" ${canCorrect?'':'disabled'}>${Object.entries(categoryNames).map(([key,label])=>`<option value="${key}" ${key===actualCategory?'selected':''}>${label}</option>`).join('')}</select><button type="button" data-category-save="${escape(file.id)}" ${canCorrect?'':'disabled'}>${t('保存','Save')}</button></div><small>${t('按同类型表保存，后续月份与导入继续适用','Saved for this source type, including future months and imports')} · ${escape(classification.series)}</small>${canCorrect&&classification.mode==='manual'?`<button type="button" class="source-category-reset" data-category-reset="${escape(file.id)}">${t('恢复自动分类','Restore automatic category')}</button>`:''}${!canCorrect?`<small>${t('管理员可修改分类规则','An administrator can change category rules')}</small>`:''}<small data-category-message role="status"></small></section>`;
            return `<details title="${escape(originals.map(item=>item.name).join('\n'))}" data-source-state="${sourceState}" class="library-file-item ${isTicket?'library-file-expiring':''}" data-file-id="${escape(file.id)}" data-current-file-ids="${escape(JSON.stringify(originals.map(item=>item.id)))}" data-source-category="${actualCategory}" data-source-kind="${escape(file.kind||'original')}" data-source-key="${escape(JSON.stringify([file.kind||'original',S.identity(file.source_key||file.name)]))}" ${current.libraryPrefs.expandedFileIds.includes(file.id)?'open':''} data-file-name="${searchKey}"><summary title="${escape(file.name)}">${escape(title)}${mergedBadge}${sourceBadge}<button type="button" data-favorite="${escape(JSON.stringify([file.kind||'original',S.identity(file.source_key||file.name)]))}" title="${t('常用收藏','Favorite')}">${(current.libraryPrefs.favorites||[]).includes(JSON.stringify([file.kind||'original',S.identity(file.source_key||file.name)]))?'★':'☆'}</button></summary><small class="source-version-label">${t('当月最新','Latest in month')} · ${escape(view.timeLabel(file.created_at))}</small><div class="source-card-body">${librarySearch.matchMarkup(file)}${window.MonthlyCharts.library(file)}${file.parse_status!=='ready'?`<div class="library-warning source-parse-warning">${t('表格解析未完成','Worksheet parsing incomplete')} ${escape(file.parse_error)}</div>`:''}<div class="source-file-actions">${dutyLink}${originals.length===1?`<a class="source-action" title="${escape(view.fileDownloadInfo(originals[0],language))}" href="/api/upload/source-files/${encodeURIComponent(originals[0].id)}/download">${t('下载原文件','Download source')}</a>`:`<details class="source-downloads"><summary class="source-action">${t('下载文件','Download files')} · ${originals.length}</summary><div class="source-download-list">${originals.map(item=>`<a href="/api/upload/source-files/${encodeURIComponent(item.id)}/download" title="${escape(view.fileDownloadInfo(item,language))}"><span>${escape(item.name)}</span><span aria-hidden="true">↓</span></a>`).join('')}</div></details>`}</div><div class="source-secondary"><details class="source-history" data-file-history="${escape(file.id)}"><summary>${t('历史版本','Versions')}<small class="source-history-count" title="${t('当前已加载范围内的历史版本，不含当前卡片文件','Historical versions in the loaded range, excluding current files')}">${historyCount} ${t('个',historyCount===1?'version':'versions')}</small></summary><div data-history-body></div></details><details class="source-provenance"><summary>${t('来源详情','Source details')}</summary>${originals.map(item=>`<small>${t('原文件','Original file')}: ${escape(item.name)}</small>`).join('')}${originals.length>1?`<small>${t('已合并','Merged')}: ${originals.length} ${t('个原始文件','original files')}</small>`:''}${metrics.length?`<small>${t('对应指标','Extracted')}: ${escape(metrics.join('、'))}</small>`:''}<small>${view.timeLabel(file.created_at)} · ${file.size} bytes</small><small>${file.kind==='meeting_attendance'?t('会议服务器快照：完整原表的按月视图','Meeting server snapshot: month-filtered view of complete originals'):file.kind==='topic_monthly'?t('专题服务器快照：汇总表与原始明细','Topic server snapshot: report tables and source details'):file.kind==='structured'?t('结构化行存档（CSV 重建）','Structured row archive (reconstructed CSV)'):isDuty?t('夜间运维值班表（可在线编辑）','Night duty roster (online editable)'):t('上传原文件','Uploaded original')}</small>${importOrigin?`<small>${t('导入方式','Import method')}: ${escape(importOrigin==='manual'?t('手动导入','Manual import'):['auto','uivf12'].includes(importOrigin)?t('自动抓取导入','Automatic capture import'):importOrigin)}</small>`:''}<small class="${file.parse_status==='ready'?'':'library-warning'}">${file.parse_status==='ready'?t('已存储所有工作表','Worksheets stored'):t('原文件已存档，表格解析未完成','Original archived; parsing incomplete')} ${escape(file.parse_error)}</small>${file.sheets.map(sheet=>`<small>${escape(sheet.name)} · ${sheet.rowCount} ${t('行','rows')}</small>`).join('')}${file.kind==='meeting_attendance'?`<small>${t('快照','Snapshot')}: ${escape(file.snapshot_title)}<br>${t('已按目标月份筛选','Filtered for target month')}: ${escape(file.filter_scope)}<br>${t('原始总行数','Original rows')}: ${file.original_row_count}${file.unknown_date_rows?` · ${t('日期无法识别','Unrecognized dates')}: ${file.unknown_date_rows} (${t(file.unknown_dates_retained?'沿用考勤规则保留于工单窗口':'未纳入本月',file.unknown_dates_retained?'retained in order windows per attendance rules':'excluded from month')})`:''}</small>`:''}${categoryEditor}</details></div></div></details>`;
        };
        const scoped=(file,category)=>{
            const prefs=current.libraryPrefs,key=JSON.stringify([file.kind||'original',S.identity(file.source_key||file.name)]);
            return (!prefs.category||prefs.category===category)&&(!prefs.kind||prefs.kind===(file.kind||'original'))&&(prefs.view!=='favorites'||(prefs.favorites||[]).includes(key))&&(prefs.view!=='recent'||(prefs.recent||[]).includes(key));
        };
        const ordinary=file=>{const query=current.libraryPrefs.search.trim().toLowerCase();return !query||[file.name,...file.metricLabels||[],...file.sheets.map(sheet=>sheet.name),...file.mergedFiles?.map(item=>item.name)||[]].concat((file.metricLabels||[]).map(metricLabel)).join(' ').toLowerCase().includes(query);};
        const scopeGroups=[[ticketFiles,'tickets'],[tableFiles,'metrics'],[topicTableFiles,'topic'],[meetingTableFiles,'meeting'],[rawFiles,'raw']].flatMap(([items,category])=>items.filter(file=>scoped(file,category)));
        librarySearch.configure({query:current.libraryPrefs.search,files:[...new Set(scopeGroups.flatMap(file=>(file.mergedFiles||[file]).map(item=>item.id)))],ordinaryCount:scopeGroups.filter(ordinary).length,enabled:!libraryLoading});
        if(librarySearch.isActive?.())libraryLimit=Math.max(libraryLimit,(librarySearch.count?.()||0)+scopeGroups.filter(ordinary).length);
        const groupMarkup=(items,category)=>items.filter(file=>scoped(file,category)&&(ordinary(file)||librarySearch.has(file))).slice(0,libraryLimit).map(renderFileItem).join('');
        document.getElementById('sourceLibrary').innerHTML=`<div class="library-heading"><h3>${t('数据资料库','Data library')}</h3><a href="/sla" class="source-action">${t('导入','Import')}</a></div><div class="library-content"><section class="library-loading-settings"><h4>${t('加载范围','Load scope')}</h4><form class="library-range"><label for="libraryLoadDays">${t('最近','Last')}</label><input id="libraryLoadDays" type="number" min="0" max="36500" step="1" value="${libraryDays}" required aria-label="${t('加载天数，0为全部','Load days; 0 means all')}"><span>${t('天','days')}</span><button ${libraryLoading?'disabled':''} type="submit">${t('加载','Load')}</button><button type="button" data-library-all>${t('全部','All')}</button></form><p class="library-range-hint">${libraryDays?t('按导入时间 · 最近 '+libraryDays+' 天','By import time · Last '+libraryDays+' days'):t('全部历史 · 数据量较大时可能需要等待','All history · Large catalogs may take longer')} · ${sourceCatalog.files.length} ${t('张表','tables')}</p><p class="library-range-hint">${current.libraryPrefs.advanced?t('会议考勤历史版本已启用。','Meeting attendance history is enabled.'):t('会议考勤仅显示最新导入快照；高级筛选可载入历史。','Meeting attendance uses the latest imported snapshot; advanced filters load history.')}</p></section>${libraryError?`<p class="library-warning">${escape(t('部分来源不可用；其他数据可使用。','Some sources unavailable; other data usable.')+' '+libraryError)}</p>`:''}
        <label>${t('浏览数据月份','Browse data month')}<select id="libraryTargetPeriod">${options(periods,libraryPeriod,targetLabel)||`<option value="">${t('没有已标记的业务月份','No labeled business month')}</option>`}</select></label><details class="library-advanced" ${current.libraryPrefs.advanced?'open':''}><summary>${t('历史版本 / 高级筛选','History / advanced filters')}</summary><label>${t('快照导入日期','Snapshot import date')}<select id="libraryImportDate">${options(dates,libraryDate,value=>value||'—')}</select></label><label>${t('导入批次','Import batch')}<select id="libraryImportBatch">${dated.map(group=>`<option value="${escape(group.id)}" ${group.id===libraryGroup?'selected':''}>${escape(view.timeLabel(group.importedAt))} · ${group.fileIds.length} ${t('个源表','sources')}</option>`).join('')}</select></label></details>
        <div class="library-search-shell" data-has-deep="${!!librarySearch.buttonMarkup()}"><input id="sourceSearch" maxlength="2000" value="${escape(current.libraryPrefs.search)}" placeholder="${t('搜索指标或表格名称','Search metric or table name')}">${librarySearch.buttonMarkup()}</div>${librarySearch.statusMarkup()}
        <nav class="library-view-tabs" aria-label="${t('显示范围','View')}">${[['all','全部','All'],['favorites','常用','Favorites'],['recent','最近使用','Recent']].map(([key,zh,en])=>`<button type="button" data-library-view="${key}" aria-pressed="${(current.libraryPrefs.view||'all')===key}">${t(zh,en)}</button>`).join('')}</nav><select hidden id="libraryView" aria-label="${t('显示范围','View')}"><option value="all">${t('全部','All')}</option><option value="favorites">${t('常用','Favorites')}</option><option value="recent">${t('最近使用','Recently used')}</option></select><details class="library-filters" ${current.libraryPrefs.kind||current.libraryPrefs.category?'open':''}><summary>${t('来源与分类筛选','Source / category filters')}</summary><div class="library-views"><select id="libraryKind" aria-label="${t('来源类型','Source type')}"><option value="">${t('全部来源类型','All source types')}</option>${[...new Set(files.map(file=>file.kind||'original'))].map(kind=>`<option value="${escape(kind)}">${escape({original:t('上传原表','Uploaded originals'),structured:t('结构化抓取','Structured capture'),topic_monthly:t('专题分析','Topic reports'),meeting_attendance:t('会议考勤','Meeting attendance'),duty_roster:t('夜间值班','Duty roster')}[kind]||kind)}</option>`).join('')}</select><select id="libraryCategory" aria-label="${t('业务分类','Category')}"><option value="">${t('全部业务分类','All categories')}</option>${[['tickets','临期详单','Expiry tickets'],['metrics','指标与关键数据表','Metrics & priority'],['topic','专题分析','Topic analysis'],['meeting','会议考勤','Meeting attendance'],['raw','其他原始表','Other originals']].map(([value,zh,en])=>`<option value="${value}">${t(zh,en)}</option>`).join('')}</select></div><button type="button" data-library-reset>${t('清除筛选','Clear filters')}</button></details><div data-selection-bar hidden><strong></strong><button data-selection="clear">${t('清除选择','Clear selection')}</button><button data-selection="add">${t('加入当前组件','Add to current')}</button><button data-selection="table">${t('新建表格','New table')}</button><button data-selection="chart">${t('新建图表 / 透视','New chart / pivot')}</button></div><div class="source-section-header"><span>${t('临期详单','Expiry tickets')}</span><span class="source-section-count">${ticketFiles.length} ${t('个','items')}</span></div>
        <div id="sourceTicketFileList">${groupMarkup(ticketFiles,'tickets')}</div>
        <div class="source-section-header"><span>${t('指标与关键数据表','Metrics & priority tables')}</span><span class="source-section-count">${tableFiles.length} ${t('个','items')}</span></div>
        <div id="sourceFileList">${groupMarkup(tableFiles,'metrics')||`<p class="library-empty">${t(files.length?'暂无指标与关键数据表':'该快照未存档原始表，仍可在模块中引用已存指标。',files.length?'No metric or priority tables':'This snapshot has no archived originals. Stored metrics can still be bound to blocks.')}</p>`}</div>
        ${topicTableFiles.length?`<div class="source-section-header"><span>${t('专题分析月报数据','Topic monthly report data')}</span><span class="source-section-count">${topicTableFiles.length} ${t('个','items')}</span></div><div id="sourceTopicFileList">${groupMarkup(topicTableFiles,'topic')}</div>`:''}
        ${meetingTableFiles.length?`<div class="source-section-header"><span>${t('会议考勤原始表','Meeting attendance sources')}</span><span class="source-section-count">${meetingTableFiles.length} ${t('个','items')}</span></div><div id="sourceMeetingFileList">${groupMarkup(meetingTableFiles,'meeting')}</div>`:''}
        <div class="source-section-header"><span>${t('原始表名称呈现','Raw table names')}</span><span class="source-section-count">${rawFiles.length} ${t('个','items')}</span></div>
        <div id="sourceRawFileList">${groupMarkup(rawFiles,'raw')||`<p class="library-empty">${t(files.length?'所有原始表已在上方展示':'暂无原始文件存档',files.length?'All original tables are shown above':'No archived original files')}</p>`}</div>${librarySearch.footerMarkup?.()||''}${files.length>libraryLimit&&!librarySearch.isActive?.()?`<button type="button" data-library-more>${t('显示更多表（每类 '+libraryLimit+' 个）','Show more tables ('+libraryLimit+' per category)')}</button>`:''}</div>`;
        document.querySelectorAll('#sourceLibrary .source-section-header').forEach(header=>{if(!header.nextElementSibling?.querySelector('.library-file-item')){header.hidden=true;header.nextElementSibling.hidden=true;}});
        if(!document.querySelector('#sourceLibrary .library-file-item')){const empty=document.createElement('p');empty.className='library-empty-state';empty.textContent=current.libraryPrefs.view==='favorites'&&!current.libraryPrefs.favorites?.length?t('还没有常用表。点击表名旁的☆加入常用。','No favorites yet. Use the star beside a table name.'):current.libraryPrefs.view==='recent'&&!current.libraryPrefs.recent?.length?t('还没有使用记录。将表加入月报后会显示在这里。','No recent usage yet. Add a table to a report to see it here.'):t('当前范围没有匹配的数据。可增加加载天数、加载全部，或调整筛选。','No data matches this range. Increase days, load all, or adjust filters.');document.querySelector('#sourceLibrary .library-content').append(empty);}
        const loadDays=async days=>{if(libraryLoading)return;libraryDays=days;current.libraryPrefs.loadDays=days;dirty=true;libraryLimit=80;try{localStorage.setItem('monthly-library-days',String(days));}catch(_){}try{await refresh();}catch(_){};};
        document.querySelector('.library-range').onsubmit=event=>{event.preventDefault();const days=Number(document.getElementById('libraryLoadDays').value);if(Number.isInteger(days)&&days>=0&&days<=36500)loadDays(days);};document.querySelector('[data-library-all]').onclick=()=>loadDays(0);
        document.getElementById('libraryTargetPeriod').onchange=event=>{checkpoint();libraryPeriod=event.target.value;libraryDate=null;libraryGroup=null;library();};
        document.getElementById('libraryImportDate').onchange=event=>{checkpoint();libraryDate=event.target.value;libraryGroup=null;library();};
        document.getElementById('libraryImportBatch').onchange=event=>{checkpoint();libraryGroup=event.target.value;library();};
        librarySearch.bind(document.getElementById('sourceLibrary'));
        const saveCategory=async(fileId,category,button)=>{const panel=button.closest('.source-category-editor'),message=panel.querySelector('[data-category-message]');panel.querySelectorAll('button,select').forEach(control=>control.disabled=true);try{await request('/api/upload/source-files/'+encodeURIComponent(fileId)+'/category',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({category})});await refresh();const card=Array.from(document.querySelectorAll('.library-file-item')).find(item=>item.dataset.fileId===fileId);if(card){card.open=true;card.querySelector('.source-provenance').open=true;}status(t('分类纠正已保存，同类型后续导入会继续应用','Category rule saved; future imports of this type will use it'));}catch(error){message.textContent=error.message;panel.querySelectorAll('button,select').forEach(control=>control.disabled=false);}};
        document.querySelectorAll('[data-category-save]').forEach(button=>button.onclick=()=>saveCategory(button.dataset.categorySave,button.closest('.source-category-editor').querySelector('[data-category-file]').value,button));
        document.querySelectorAll('[data-category-reset]').forEach(button=>button.onclick=()=>saveCategory(button.dataset.categoryReset,null,button));

        const sourceSearch=document.getElementById('sourceSearch');
        const cancelPendingSearch=()=>{clearTimeout(librarySearchTimer);librarySearchTimer=null;librarySearch.reset();const trigger=document.querySelector('#sourceLibrary [data-deep-start]');if(trigger)trigger.disabled=true;};
        const scheduleSearch=()=>{clearTimeout(librarySearchTimer);librarySearchTimer=setTimeout(()=>{librarySearchTimer=null;if(!librarySearchComposing)library();},sourceSearch.value.trim()?500:0);};
        sourceSearch.addEventListener('compositionstart',()=>{librarySearchComposing=true;cancelPendingSearch();});
        sourceSearch.addEventListener('compositionend',()=>{librarySearchComposing=false;current.libraryPrefs.search=sourceSearch.value;dirty=true;libraryLimit=80;scheduleSearch();});
        sourceSearch.oninput=event=>{cancelPendingSearch();current.libraryPrefs.search=event.target.value;dirty=true;libraryLimit=80;if(!librarySearchComposing&&!event.isComposing)scheduleSearch();};
        sourceSearch.onkeydown=event=>{if(event.key==='Enter'&&!librarySearchComposing&&!event.isComposing&&event.keyCode!==229){event.preventDefault();clearTimeout(librarySearchTimer);librarySearchTimer=null;library();}};
        document.querySelectorAll('[data-library-view]').forEach(button=>button.onclick=()=>{current.libraryPrefs.view=button.dataset.libraryView;dirty=true;libraryLimit=80;library();});document.querySelector('[data-library-reset]').onclick=()=>{Object.assign(current.libraryPrefs,{kind:'',category:'',search:'',view:'all'});dirty=true;libraryLimit=80;library();};
        document.getElementById('libraryCategory').value=current.libraryPrefs.category||'';document.getElementById('libraryCategory').onchange=event=>{current.libraryPrefs.category=event.target.value;dirty=true;libraryLimit=80;library();};
        document.getElementById('libraryView').value=current.libraryPrefs.view||'all';document.getElementById('libraryKind').value=current.libraryPrefs.kind||'';
        document.getElementById('libraryView').onchange=event=>{current.libraryPrefs.view=event.target.value;dirty=true;libraryLimit=80;library();};document.getElementById('libraryKind').onchange=event=>{current.libraryPrefs.kind=event.target.value;dirty=true;libraryLimit=80;library();};
        document.querySelector('.library-advanced').addEventListener('toggle',event=>{if(current.libraryPrefs.advanced!==event.target.open){current.libraryPrefs.advanced=event.target.open;library();refresh().catch(()=>{});}});
        document.querySelector('[data-library-more]')?.addEventListener('click',()=>{libraryLimit+=80;library();});
        if(librarySearch.isActive?.()||searchFocused)document.querySelector('#sourceLibrary .library-content').scrollTop=contentScroll;
        if(searchFocused){document.getElementById('sourceSearch').focus({preventScroll:true});document.getElementById('sourceSearch').setSelectionRange(cursor,cursorEnd,cursorDirection||'none');}
        W.syncSelection();const panel=document.getElementById('pivotFieldsPanel');if(!panel?.querySelector('[data-inspector-editor]')?.children.length)window.MonthlyPivotPanel?.sync();
    }
    function sectionControls(section,index){return `<div class="document-controls" data-controls><button data-op="section-up" data-section="${section.id}" ${index===0?'disabled':''}>↑</button><button data-op="section-down" data-section="${section.id}" ${index===current.sections.length-1?'disabled':''}>↓</button><select data-section-width="${section.id}" aria-label="${t('模块宽度','Module width')}">${[3,4,6,8,12].map(span=>`<option value="${span}" ${span===section.span?'selected':''}>${span}/12</option>`).join('')}</select><select data-add-kind="${section.id}" aria-label="${t('添加内容','Add content')}"><option value="">${t('＋添加内容位置','＋ Add content slot')}</option>${['text','metric','table','chart','summary'].map(type=>`<option value="${type}">${typeName(type)}</option>`).join('')}</select><button data-op="copy-section" data-section="${section.id}">⧉</button><button data-op="remove-section" data-section="${section.id}">${t('删除模块','Delete module')}</button></div>`;}
    function navigationRows(){
        const rows=current.navRows||2;const sections=current.sections.filter(item=>!item.overview);const count=sections.length;let start=0;
        return Array.from({length:rows},(_,row)=>{const length=Math.floor(count/rows)+(row<count%rows?1:0);const offset=start;const items=sections.slice(start,start+length);start+=length;return `<div class="document-nav-row">${items.map((item,index)=>`<a href="#section-${item.id}">${String(offset+index+1).padStart(2,'0')}　${escape(engine.metricTextParts(pair(item.title),inlineCatalog()).map(part=>part.token?part.value:part.text).join(''))}</a>`).join('')}</div>`;}).join('');
    }
    function navigationMarkup(){
        return `<div class="document-nav-wrapper" style="width:${current.navWidth?current.navWidth+'px':'100%'};--nav-row-height:${current.navRowHeight||36}px;--nav-font-size:${current.navFontSize||14}px"><div class="document-meta-toolbar document-nav-toolbar" data-controls><span class="document-meta-toolbar-title">↪ ${t('快捷跳转布局','Quick navigation layout')}</span><div class="document-meta-toolbar-actions"><label>${t('行数','Rows')} <select data-nav-setting="navRows">${Array.from({length:12},(_,index)=>`<option value="${index+1}" ${(current.navRows||2)===index+1?'selected':''}>${index+1}</option>`).join('')}</select></label><label>${t('行高','Row height')} <input data-nav-setting="navRowHeight" type="number" min="24" max="120" value="${current.navRowHeight||36}" aria-label="${t('快捷跳转行高（像素）','Navigation row height (px)')}"> px</label><label>${t('整体宽','Overall width')} <input data-nav-setting="navWidth" type="number" min="0" max="2000" value="${current.navWidth||0}" aria-label="${t('快捷跳转宽度（像素，0=满宽）','Navigation width (px, 0 = full width)')}"> <small>${t('px，0=满宽','px, 0 = full')}</small></label><label>${t('字号','Font size')} <input data-nav-setting="navFontSize" type="number" min="10" max="24" value="${current.navFontSize||14}" aria-label="${t('快捷跳转字号（像素）','Navigation font size (px)')}"> px</label></div></div><nav class="document-nav">${navigationRows()}</nav></div>`;
    }
    function typeName(type){return {text:t('文字','Text'),metric:t('提取指标','Extracted metric'),table:t('原始 / 清洗表格','Original / processed table'),chart:t('数据图表','Data chart'),summary:t('规则总结','Rule summary')}[type];}
    // Fill each metadata row maintaining vertical grid alignment across rows.
    function metadataLayout(items, alignMode='grid'){
        const result=[];let row=[],used=0;
        const flush=()=>{
            if(!row.length)return;
            if(used===12 || alignMode==='free'){
                row.forEach(item=>result.push({...item,displaySpan:item.span}));
            } else if(alignMode==='stretch'){
                const widths=row.map(item=>item.span*12/used);
                const spans=widths.map(Math.floor);
                const priority=widths.map((width,index)=>({index,remainder:width-spans[index]})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
                const spare=12-spans.reduce((sum,span)=>sum+span,0);
                priority.slice(0,spare).forEach(item=>spans[item.index]++);
                row.forEach((item,index)=>result.push({...item,displaySpan:spans[index]}));
            } else {
                const remaining = 12 - used;
                row.forEach((item, index) => {
                    const isLast = (index === row.length - 1);
                    const displaySpan = isLast ? Math.min(12, item.span + remaining) : item.span;
                    result.push({ ...item, displaySpan });
                });
            }
            row=[];used=0;
        };
        items.forEach(item=>{
            const span=Math.max(1,Math.min(12,Number(item.span)||4));
            if(used+span>12&&row.length)flush();
            row.push({...item,span});
            used+=span;
            if(used>=12)flush();
        });
        flush();return result;
    }
    function applyMetaAlign(cols = 3) {
        const spanPerCol = Math.floor(12 / cols);
        current.meta.forEach((item, index) => {
            const isFull = item.span === 12 || (item.label.zh || '').includes('目标') || (item.label.zh || '').includes('概述');
            item.span = isFull ? 12 : spanPerCol;
        });
        let curSum = 0;
        for (let i = 0; i < current.meta.length; i++) {
            const item = current.meta[i];
            if (item.span === 12) { curSum = 0; continue; }
            curSum += item.span;
            const next = current.meta[i + 1];
            if (!next || next.span === 12) {
                if (curSum < 12) item.span += (12 - curSum);
                curSum = 0;
            }
        }
        current.metaAlignMode = cols === 3 ? 'col-3' : (cols === 2 ? 'col-2' : 'grid');
    }
    function syncSectionNavigation(entry,title){
        if(entry?.key!=='title')return;
        const index=current.sections.filter(item=>!item.overview).indexOf(entry.value);
        if(index<0)return;
        const link=root.querySelectorAll('.document-nav a')[index];
        if(link)link.textContent=`${String(index+1).padStart(2,'0')}　${engine.metricTextParts(title,inlineCatalog()).map(part=>part.token?part.value:part.text).join('')}`;
    }
    function render(){
        pendingBlocks.clear();pendingBlockUrls.clear();
        if(current.dataRulesVersion===1){const month=current.meta.find(item=>item.label.zh==='数据月份');if(month)month.autoFill='period';}
        engine.applyReportDefaults(current,engine.documentMonth(current),'');
        if(engine.formatOverview(current))dirty=true;
        if(engine.sampleOverview(current))dirty=true;
        current.sections.forEach(section=>section.blocks.forEach(block=>{
            if(block.type==='metric'&&['file','section'].includes(block.binding?.kind))block.type='table';
        }));
        captureInlineData();const token=++generation;fields.clear();fieldIndex=0;actions();
        root.style.width=`${current.pageWidth}px`;root.parentElement.style.setProperty('--report-page-width',`${current.pageWidth}px`);
        root.style.setProperty('--document-default-font-size',`${current.defaultFontSize||16}px`);
        const metaWidthVal = current.metaWidth ? `${current.metaWidth}px` : '100%';
        const metaRowHeightVal = current.metaRowHeight ? `${current.metaRowHeight}px` : '38px';
        const metaLabelWidthVal = current.metaLabelWidth ? `${current.metaLabelWidth}px` : '90px';
        const metaLayoutItems = metadataLayout(current.meta, current.metaAlignMode || 'grid');
        const metaHtml = `<div class="document-meta-wrapper" data-controls-container style="width:${metaWidthVal};"><div class="document-meta-toolbar" data-controls><span class="document-meta-toolbar-title">📋 ${t('报告信息栏','Report metadata')} <small style="font-weight:normal;color:#64748b;">(${current.meta.length}${t('项',' items')})</small></span><div class="document-meta-toolbar-actions"><span class="meta-tool-group"><span class="meta-tool-label">${t('竖线对齐:','Align:')}</span><button type="button" data-meta-op="align-3" class="${(current.metaAlignMode||'grid')==='col-3'?'active':''}" aria-pressed="${(current.metaAlignMode||'grid')==='col-3'}" title="${t('整齐三列对齐 (4-4-4)，末尾自动补齐','3-col aligned (4-4-4)')}">📐 ${t('三列对齐','3-col')}</button><button type="button" data-meta-op="align-2" class="${(current.metaAlignMode||'grid')==='col-2'?'active':''}" aria-pressed="${(current.metaAlignMode||'grid')==='col-2'}" title="${t('整齐两列对齐 (6-6)','2-col aligned (6-6)')}">📐 ${t('两列对齐','2-col')}</button><button type="button" data-meta-op="align-auto" class="${(current.metaAlignMode||'grid')==='grid'?'active':''}" aria-pressed="${(current.metaAlignMode||'grid')==='grid'}" title="${t('智能对齐竖线','Auto-align lines')}">📐 ${t('自动对齐','Auto')}</button></span><span class="meta-tool-group"><span class="meta-tool-label">${t('行高:','Height:')}</span><button type="button" data-meta-op="height-32" class="${current.metaRowHeight===32?'active':''}" title="${t('紧凑 (32px)','Compact')}">${t('紧凑','Compact')}</button><button type="button" data-meta-op="height-38" class="${(!current.metaRowHeight||current.metaRowHeight===38)?'active':''}" title="${t('标准 (38px)','Standard')}">${t('标准','Standard')}</button><button type="button" data-meta-op="height-48" class="${current.metaRowHeight===48?'active':''}" title="${t('舒适 (48px)','Comfortable')}">${t('舒适','Comfy')}</button></span><span class="meta-tool-group"><span class="meta-tool-label">${t('整体宽:','Width:')}</span><button type="button" data-meta-op="width-100" class="${!current.metaWidth?'active':''}">100%</button><button type="button" data-meta-op="width-90" class="${current.metaWidth===1150?'active':''}">90%</button></span><button type="button" data-meta-op="open-layout" data-action="layout" class="btn-meta-settings" title="${t('打开完整布局与高级尺寸弹窗','Open layout & sizing dialog')}">⚙️ ${t('布局与尺寸','Layout & size')}</button><button type="button" data-meta-op="add-item" title="${t('增加新信息项','Add field')}">＋ ${t('信息项','Field')}</button></div></div><div class="document-meta" style="--meta-container-width:100%;--meta-min-height:${metaRowHeightVal};--meta-label-width:${metaLabelWidthVal};">${metaLayoutItems.map((layout,index)=>{const item=current.meta[index];const cellHeightStyle=item.heightUnits?`min-height:calc(${item.heightUnits} * var(--meta-min-height, 38px));`:'';return `<div class="document-meta-cell" data-meta-id="${item.id}" style="grid-column:span ${layout.displaySpan};${cellHeightStyle}"><div class="meta-cell-controls" data-controls><button type="button" data-meta-cell-op="move-prev" ${index===0?'disabled':''} data-meta-id="${item.id}" title="${t('向前移动信息项','Move field earlier')}">◀</button><span class="meta-cell-badge" data-meta-cell-op="span-cycle" data-meta-id="${item.id}" title="${t('点击循环切换预设宽度','Cycle width')}" style="cursor:pointer;">${layout.displaySpan}${t('格',' cols')}</span><button type="button" data-meta-cell-op="move-next" ${index===current.meta.length-1?'disabled':''} data-meta-id="${item.id}" title="${t('向后移动信息项','Move field later')}">▶</button><button type="button" data-meta-cell-op="height-toggle" data-meta-id="${item.id}" title="${t('切换高度 (单行 / 双倍 / 三倍)','Toggle height')}">↕ ${item.heightUnits?item.heightUnits+'x':'1x'}</button><button type="button" data-meta-cell-op="span-full" data-meta-id="${item.id}" title="${t('一键设为整行全宽 (12格)','Full width')}">↔</button><button type="button" data-meta-cell-op="remove" data-meta-id="${item.id}" title="${t('删除此项','Delete field')}">×</button></div><div class="document-meta-label">${edit(item,'label')}</div><div class="document-meta-value">${edit(item,'value')}</div><div class="meta-cell-resize-handle" data-controls data-meta-resize="${item.id}" title="${t('拖动调整宽度与高度','Drag to resize width and height')}">◢</div></div>`;}).join('')}</div></div>`;
        root.innerHTML=`<header class="document-masthead"><img data-edit-logo title="${t('点击更换 Logo','Click to change logo')}" src="${escape(current.logo)}" alt="" style="width:${current.logoWidth}px;align-self:${{left:'flex-start',center:'center',right:'flex-end'}[current.logoAlign]};${current.logo?'':'display:none'}"><h1>${edit(current,'title',t('输入月报总标题','Enter report title'))}</h1></header>${metaHtml}${navigationMarkup()}<div class="document-sections">${current.sections.map((section,index)=>`<section id="section-${section.id}" class="document-section" style="grid-column:span ${section.span}"><div class="document-section-head"><span>${section.overview?'':String(current.sections.filter(item=>!item.overview).indexOf(section)+1).padStart(2,'0')}</span><h2>${edit(section,'title',t('模块标题','Module title'))}</h2></div>${sectionControls(section,index)}<div class="document-blocks" data-card-section="${section.id}">${section.blocks.map((block,index)=>`<article class="document-block" data-card-id="${block.id}" style="grid-column:span ${block.span};text-align:${block.align};${block.heightUnits?`min-height:calc(${block.heightUnits} * (var(--card-grid-unit,40px) + 12px) - 12px)`:""}"><div class="document-controls" data-controls><button type="button" class="card-drag-handle" data-card-drag="${block.id}" aria-label="${t("拖动卡片","Drag card")}" title="${t("拖动排序或移至其他模块","Drag to reorder or move to another module")}">⠿</button><span>${typeName(block.type)}</span>${[['source','数据来源','Data sources'],['processing','数据处理','Processing'],['style','展示样式','Appearance'],['layout','布局','Layout']].map(([tab,zh,en])=>`<button type="button" class="component-config-shortcut" data-op="configure-block" data-config-tab="${tab}" data-block="${block.id}" title="${t(zh,en)}" aria-label="${t(zh,en)}">${window.MonthlyWorkspace.icon(tab)}</button>`).join('')}<button type="button" data-op="inspect-references" data-block="${block.id}" aria-pressed="false" title="${t('查看本组件指标引用','Inspect component references')}" aria-label="${t('查看本组件指标引用','Inspect component references')}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 .2l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7-.2l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg><span>${t('引用','Refs')}</span></button><button data-op="block-up" data-block="${block.id}" ${index===0?'disabled':''}>←</button><button data-op="block-down" data-block="${block.id}" ${index===section.blocks.length-1?'disabled':''}>→</button><button data-op="copy-block" data-block="${block.id}">⧉</button><button data-op="remove-block" data-block="${block.id}">${t('删除','Delete')}</button></div><h3>${edit(block,'title',t('内容标题（可留空）','Content title (optional)'))}</h3>${block.type==='text'?`<div class="document-block-text">${edit(block,'text',t('点击填写正文，可粘贴纯文本','Click to edit or paste plain text'))}</div>`:`<div class="document-block-data" id="data-${block.id}">${t('读取数据库数据…','Loading database data…')}</div>`}<button type="button" class="card-resize-handle" data-card-resize="${block.id}" data-controls aria-label="${t('调整卡片宽度与高度','Resize card width and height')}" title="${t('按网格调整宽高','Resize in grid units')}">◢</button></article>`).join('')}</div></section>`).join('')}</div><footer class="document-footer">${edit(current,'footer',t('页脚（可自定义）','Custom footer'))}</footer>`;
        compactControls();observeCardGrids();syncDefaultFontSizeSelect();
        root.querySelector('img').onerror=event=>event.target.hidden=true;
        const jobs=current.sections.flatMap(section=>section.blocks.filter(block=>block.type!=='text').map(block=>renderBlock(block,token)));
        updateEmptyState();
        renderPromise=Promise.all(jobs).then(()=>{if(generation===token){updateEmptyState();captureInlineData();window.MonthlyPivotPanel?.sync();syncReportDataState();}});return renderPromise;
    }
    async function renderBlock(block,token){
        pendingBlocks.set(block.id,block);dataStates.set(block.id,t('正在读取','Loading'));syncDataState(block);
        const target=document.getElementById(`data-${block.id}`);try{blockResources.set(block.id,new Map());const result=await renderData({...block,_renderToken:token});if(generation===token&&target?.isConnected){target.innerHTML=result;lastResults.set(block.id,result);dataStates.set(block.id,!block.binding&&!block.chart.pivot?.sources.length&&!block.chart.series?.length?t('尚未绑定来源','Source not bound'):target.querySelector('tbody tr,.document-chart,.document-metric')||block.type==='summary'&&target.textContent.trim()?t('正常','Ready'):t('无匹配记录','No matching records'));window.MonthlyNameMappings.apply(block,target,metricLabel);window.MonthlyDataFormats.apply(block,target);formatTableCells(block,target);saveBlockData(block);if(block.savedData&&block.savedData.catalog.files.some(file=>!catalog.files.some(current=>current.id===file.id)))dataStates.set(block.id,t('来源不可用，正在显示保存结果','Source unavailable; showing saved result'));syncDataState(block);}}catch(error){if(generation===token&&target?.isConnected){const fallback=block.previousData||block.savedData;if(fallback?.definition){try{const restored=await renderData({...block,...fallback.definition,savedData:fallback,previousData:undefined,dataUpdateMode:'snapshot',_savedOnly:true,_renderToken:token});if(generation===token){lastResults.set(block.id,restored);block.savedData=fallback;}}catch(_){}}if(generation!==token||!target.isConnected)return;if(lastResults.has(block.id)){target.innerHTML=lastResults.get(block.id);window.MonthlyNameMappings.apply(block,target,metricLabel);window.MonthlyDataFormats.apply(block,target);formatTableCells(block,target);}else target.textContent=error.message;dataStates.set(block.id,error.message+(lastResults.has(block.id)?t('；显示上次成功结果','; showing last successful result'):''));syncDataState(block);}}finally{if(pendingBlocks.get(block.id)===block)pendingBlocks.delete(block.id);}
    }
    // Empty editor slots remain editable; only presentation output collapses them.
    function updateEmptyState(){
        const hasContent=element=>Boolean(element&&(element.textContent.replace(/[\s\u200b\ufeff]/g,'')||element.querySelector('img,svg,table,video')));
        root.querySelectorAll('.document-edit').forEach(element=>element.toggleAttribute('data-empty',!hasContent(element)));
        root.querySelectorAll('.document-block>h3,.document-block-text,.document-footer,.document-masthead>h1').forEach(element=>element.classList.toggle('export-empty',!hasContent(element)));
        root.querySelectorAll('.document-block').forEach(element=>{
            const body=element.querySelector(':scope>.document-block-text,:scope>.document-block-data');
            const block=findBlock(element.dataset.cardId)?.block;
            const empty=!hasContent(body)||(block?.type!=='text'&&!block?.binding?.kind&&!block?.chart?.series?.length&&!block?.chart?.pivot?.sources?.length);
            body?.classList.toggle('export-empty',empty);
            element.classList.toggle('export-body-empty',empty);
            element.classList.toggle('export-empty',empty&&!hasContent(element.querySelector('h3')));
        });
        root.querySelectorAll('.document-section').forEach(section=>section.classList.toggle('export-empty',!section.querySelector('.document-block:not(.export-empty)')));
    }
    window.addEventListener('beforeprint',updateEmptyState);
    function compactControls(){
        const operations={
            'section-up':['↑',t('模块向前移动','Move module earlier')],'section-down':['↓',t('模块向后移动','Move module later')],
            'copy-section':['⧉',t('复制模块','Duplicate module')],'remove-section':['×',t('删除模块','Delete module')],
            'block-edit':['⚙',t('绑定与布局','Binding and layout')],'block-up':['←',t('组件向前移动','Move content earlier')],
            'block-down':['→',t('组件向后移动','Move content later')],'copy-block':['⧉',t('复制组件','Duplicate content')],'remove-block':['×',t('删除组件','Delete content')]
        };
        root.querySelectorAll('.document-controls [data-op]').forEach(button=>{const item=operations[button.dataset.op];if(item){button.innerHTML=window.MonthlyWorkspace.icon({'section-up':'up','section-down':'down','copy-section':'copy','remove-section':'delete','block-edit':'source','block-up':'left','block-down':'right','copy-block':'copy','remove-block':'delete'}[button.dataset.op]);button.title=item[1];button.setAttribute('aria-label',item[1]);}});
        root.querySelectorAll('[data-add-kind]').forEach(select=>{select.options[0].textContent='＋';select.title=t('添加内容组件','Add content');});
        root.querySelectorAll('[data-card-drag]').forEach(button=>button.innerHTML=window.MonthlyWorkspace.icon('drag'));
        const icons={text:'T',metric:'#',table:'▦',chart:'▥',summary:'≡'};
        root.querySelectorAll('.document-block').forEach(card=>{const block=findBlock(card.dataset.cardId)?.block,label=card.querySelector(':scope>.document-controls>span');if(block&&label){label.textContent=icons[block.type];label.title=typeName(block.type);label.setAttribute('aria-label',typeName(block.type));}});
    }
    function sizeGuides(element,span){
        let guides=element.querySelector(':scope>.size-guides');
        if(!guides){guides=document.createElement('div');guides.className='size-guides';guides.setAttribute('data-controls','');guides.innerHTML='<span class="size-guide-width"></span><span class="size-guide-height"></span>';element.append(guides);}
        const rect=element.getBoundingClientRect();
        guides.querySelector('.size-guide-width').textContent=`↔ ${Math.round(rect.width)} px · ${span}/12 ${t('格','cols')}`;
        guides.querySelector('.size-guide-height').textContent=`↕ ${Math.round(rect.height)} px`;
    }
    function observeCardGrids(){
        cardGridObserver?.disconnect();
        const update=grid=>{const style=getComputedStyle(grid);const width=grid.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),unit=`${Math.max(1,(width-11*12)/12)}px`;if(grid.style.getPropertyValue('--card-grid-unit')!==unit)grid.style.setProperty('--card-grid-unit',unit);};
        cardGridObserver=new ResizeObserver(entries=>entries.forEach(entry=>update(entry.target)));
        root.querySelectorAll('.document-blocks').forEach(grid=>{update(grid);cardGridObserver.observe(grid);});
    }
    root.addEventListener('pointerdown',event=>{
        const metaHandle=event.target.closest('[data-meta-resize]');
        if(metaHandle&&event.button===0){
            document.activeElement?.blur();
            const id=metaHandle.dataset.metaResize;
            const item=current.meta.find(m=>m.id===id);
            const cell=metaHandle.closest('.document-meta-cell');
            const grid=cell?.closest('.document-meta');
            if(item&&cell&&grid){
                const gridRect=grid.getBoundingClientRect();
                const colWidth=gridRect.width/12;
                const rowHeight=current.metaRowHeight||38;
                metaGesture={handle:metaHandle,cell,item,pointer:event.pointerId,x:event.clientX,y:event.clientY,colWidth,rowHeight,startSpan:item.span,startHeight:item.heightUnits||1,moved:false};
                metaHandle.setPointerCapture(event.pointerId);
                event.preventDefault();
                return;
            }
        }
        const handle=event.target.closest('[data-card-drag],[data-card-resize]');
        if(!handle||event.button!==0)return;
        document.activeElement?.blur();
        const found=findBlock(handle.dataset.cardDrag||handle.dataset.cardResize);
        const card=handle.closest('[data-card-id]');const rect=card.getBoundingClientRect();
        const unit=parseFloat(getComputedStyle(card.parentElement).getPropertyValue('--card-grid-unit'))||40;
        cardGesture={handle,card,found,pointer:event.pointerId,resize:!!handle.dataset.cardResize,x:event.clientX,y:event.clientY,unit,span:found.block.span,height:found.block.heightUnits||0,startHeight:rect.height,target:null,moved:false};
        sizeGuides(card,found.block.span);handle.setPointerCapture(event.pointerId);event.preventDefault();
    });
    root.addEventListener('pointermove',event=>{
        if(metaGesture&&metaGesture.pointer===event.pointerId){
            const dx=event.clientX-metaGesture.x,dy=event.clientY-metaGesture.y;
            if(!metaGesture.moved&&Math.hypot(dx,dy)<5)return;
            metaGesture.moved=true;
            const nextSpan=Math.max(1,Math.min(12,metaGesture.startSpan+Math.round(dx/metaGesture.colWidth)));
            const nextHeight=Math.max(1,Math.min(6,metaGesture.startHeight+Math.round(dy/metaGesture.rowHeight)));
            metaGesture.nextSpan=nextSpan;
            metaGesture.nextHeight=nextHeight;
            metaGesture.cell.style.gridColumn=`span ${nextSpan}`;
            metaGesture.cell.style.minHeight=`calc(${nextHeight} * var(--meta-min-height, 38px))`;
            metaGesture.cell.classList.add('meta-cell-resizing');
            const badge=metaGesture.cell.querySelector('.meta-cell-badge');
            if(badge)badge.textContent=`${nextSpan}${t('格',' cols')}`;sizeGuides(metaGesture.cell,nextSpan);
            event.preventDefault();
            return;
        }
        const gesture=cardGesture;if(!gesture||gesture.pointer!==event.pointerId)return;
        const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
        if(!gesture.moved&&Math.hypot(dx,dy)<5)return;
        gesture.moved=true;
        if(gesture.resize){
            gesture.nextSpan=Math.max(1,Math.min(12,gesture.span+Math.round(dx/(gesture.unit+12))));
            gesture.nextHeight=Math.max(1,Math.min(100,Math.round((gesture.startHeight+dy+12)/(gesture.unit+12))));
            gesture.card.style.gridColumn=`span ${gesture.nextSpan}`;
            gesture.card.style.minHeight=`${gesture.nextHeight*(gesture.unit+12)-12}px`;
            gesture.card.classList.add('card-resizing');
        }else{
            gesture.card.classList.add('card-dragging');
            root.querySelectorAll('.card-drop-target').forEach(card=>card.classList.remove('card-drop-target'));
            const element=document.elementFromPoint(event.clientX,event.clientY);
            const target=element?.closest('[data-card-id]');const grid=element?.closest('[data-card-section]');
            gesture.target=null;
            if(target&&target!==gesture.card){const rect=target.getBoundingClientRect();const sameRow=Math.abs(rect.top-gesture.card.getBoundingClientRect().top)<5;gesture.target={section:grid.dataset.cardSection,block:target.dataset.cardId,after:sameRow?event.clientX>rect.left+rect.width/2:event.clientY>rect.top+rect.height/2};target.classList.add('card-drop-target');}
            else if(grid&&!target){gesture.target={section:grid.dataset.cardSection,block:null};grid.classList.add('card-drop-target');}
            if(event.clientY>innerHeight-50)window.scrollBy(0,20);else if(event.clientY<50)window.scrollBy(0,-20);
        }
        sizeGuides(gesture.card,gesture.nextSpan||gesture.span);event.preventDefault();
    });
    function finishMetaGesture(event,cancel=false){
        const gesture=metaGesture;if(!gesture||gesture.pointer!==event.pointerId)return false;
        metaGesture=null;gesture.cell.querySelector(':scope>.size-guides')?.remove();
        if(gesture.handle.hasPointerCapture(event.pointerId))gesture.handle.releasePointerCapture(event.pointerId);
        gesture.cell.classList.remove('meta-cell-resizing');
        if(cancel||!gesture.moved){
            gesture.cell.style.gridColumn=`span ${gesture.startSpan}`;
            gesture.cell.style.minHeight=gesture.startHeight>1?`calc(${gesture.startHeight} * var(--meta-min-height, 38px))`:'';
            return true;
        }
        const nextSpan=gesture.nextSpan||gesture.startSpan;
        const nextHeight=(gesture.nextHeight&&gesture.nextHeight>1)?gesture.nextHeight:0;
        if(nextSpan===gesture.item.span&&nextHeight===(gesture.item.heightUnits||0))return true;
        checkpoint();
        gesture.item.span=nextSpan;
        gesture.item.heightUnits=nextHeight;
        render();
        status(t('报告信息项尺寸已修改，请保存月报','Metadata item resized; save the report'));
        return true;
    }
    function finishCardGesture(event,cancel=false){
        const gesture=cardGesture;if(!gesture||gesture.pointer!==event.pointerId)return;
        cardGesture=null;gesture.card.querySelector(':scope>.size-guides')?.remove();
        if(gesture.handle.hasPointerCapture(event.pointerId))gesture.handle.releasePointerCapture(event.pointerId);
        root.querySelectorAll('.card-drop-target,.card-dragging,.card-resizing').forEach(el=>el.classList.remove('card-drop-target','card-dragging','card-resizing'));
        if(cancel||!gesture.moved){if(gesture.resize){gesture.card.style.gridColumn=`span ${gesture.span}`;gesture.card.style.minHeight=gesture.height?`${gesture.height*(gesture.unit+12)-12}px`:'';}return;}
        const movementSelector=[...new Set([gesture.found.section.id,gesture.target?.section].filter(Boolean))].map(id=>`#section-${id} .document-block`).join(',');
        const before=gesture.resize?null:layoutPositions(movementSelector,[gesture.found.block.id,gesture.target?.block].filter(Boolean));
        const {block,section}=gesture.found;
        if(gesture.resize){if(gesture.nextSpan===block.span&&gesture.nextHeight===(block.heightUnits||0))return;checkpoint();block.span=gesture.nextSpan;block.heightUnits=gesture.nextHeight;}
        else if(gesture.target){
            const destination=current.sections.find(section=>section.id===gesture.target.section);if(!destination)return;
            const target=destination.blocks.find(item=>item.id===gesture.target.block);
            if(target===block)return;
            checkpoint();
            if(target){
                if(destination!==section){
                    section.blocks.splice(section.blocks.indexOf(block),1);
                    const targetIndex=destination.blocks.indexOf(target);
                    destination.blocks.splice(gesture.target.after?targetIndex+1:targetIndex,0,block);
                }else{
                    const sourceIndex=section.blocks.indexOf(block),targetIndex=destination.blocks.indexOf(target);
                    section.blocks[sourceIndex]=target;destination.blocks[targetIndex]=block;
                }
            }
            else{section.blocks.splice(section.blocks.indexOf(block),1);destination.blocks.push(block);}
        }
        else return;
        if(before)renderMovement(movementSelector,before,block.id);else render();status(t('卡片布局已修改，请保存月报','Card layout changed; save the report'));
    }
    root.addEventListener('pointerup',event=>{if(finishMetaGesture(event))return;finishCardGesture(event);});
    root.addEventListener('pointercancel',event=>{if(finishMetaGesture(event,true))return;finishCardGesture(event,true);});
    async function sourceRows(block,resolved){
        if(!resolved&&!block.binding?.sourceKey?.includes('值班'))return {headers:[],rows:[],note:t('尚未绑定数据，或数据库中找不到对应记录。','No data binding or matching stored record.')};
        const isDuty=(resolved?.file?.kind==='duty_roster'||resolved?.file?.source_key==='夜间运维值班表'||block.binding?.sourceKey==='夜间运维值班表'||(block.binding?.metricKey&&String(block.binding.metricKey).startsWith('duty_roster:')));
        if(isDuty){
            const targetMonth=block.binding?.reference?S.targetMonth(block.binding.reference,reportCatalog(block).reportMonth)||S.fileMonth(resolved?.file||{},reportCatalog(block))||engine.documentMonth(current):engine.documentMonth(current)||'2026-08';
            try{
                const dutyData=await blockCached(`/api/duty-roster?month=${encodeURIComponent(targetMonth)}`,block);
                if(dutyData&&Array.isArray(dutyData.weeks)&&Array.isArray(dutyData.rows)){
                    const headers=['Period',...dutyData.weeks.map(w=>w.key)];
                    return {
                        headers,
                        rows:dutyData.rows,
                        summaryText:dutyData.summaryText,
                        totalCount:dutyData.totalCount,
                        monthlyCount:dutyData.monthlyCount,
                        targetMonth,
                        isDutyRoster:true,
                        note:t('夜间运维值班表（按目标月份 '+targetMonth+' 自动分周）','Night operation duty roster ('+targetMonth+')')
                    };
                }
            }catch(e){throw e;}
        }
        if(resolved?.sheet){
            const members=resolved.file.mergedFiles||[resolved.file];
            const tables=await Promise.all(members.map(async file=>{const sheet=block.binding.sheetName?file.sheets.find(item=>item.name===block.binding.sheetName):file.sheets[0];if(!sheet)return null;return {...await blockCached(`/api/upload/source-sheets/${encodeURIComponent(sheet.id)}`,block),file};}));
            const available=tables.filter(Boolean);
            const origin=t('源文件','Source file');
            return {headers:[...new Set(available.flatMap(table=>table.headers).concat(members.length>1?[origin]:[]))],rows:available.flatMap(table=>table.rows.map(row=>members.length>1?{...row,[origin]:table.file.name}:row)),note:fileDisplayName(resolved.file,true)+' / '+resolved.sheet.name+(resolved.file.filter_scope?' · '+resolved.file.filter_scope+' · '+t('原始 '+resolved.file.original_row_count+' 条，适用 '+available.reduce((count,table)=>count+table.rows.length,0)+' 条','Original '+resolved.file.original_row_count+' rows; applicable '+available.reduce((count,table)=>count+table.rows.length,0))+(resolved.file.unknown_date_rows?t('；日期无法识别 '+resolved.file.unknown_date_rows+' 条','; '+resolved.file.unknown_date_rows+' unrecognized dates'):''):'')};
        }
        if(resolved?.section){const section=await blockCached(`/api/upload/source-snapshots/${encodeURIComponent(resolved.snapshot.sourceSnapshotId||resolved.snapshot.id)}/sections/${encodeURIComponent(resolved.section.key)}`,block);return {...section,note:t('快照保存的清洗结果：','Saved processed result: ')+section.title};}
        if(resolved?.metric?.parentMetricKey&&block.binding.tableMode==='processed')return {headers:[],rows:[],note:t('该历史子指标保存了提取值，未单独保存匹配明细；请引用原始表查看来源。','This historical child metric has a saved value but no separate matched rows; use its original table to inspect the source.')};
        if(resolved?.metric&&block.binding.tableMode==='processed'&&resolved.metric.sourceSection){
            const table=await blockCached(`/api/upload/source-snapshots/${encodeURIComponent(resolved.snapshot.sourceSnapshotId||resolved.snapshot.id)}/metrics/${encodeURIComponent(resolved.metric.sourceMetricKey||resolved.metric.key)}/rows`,block);return {...table,note:table.hasSelections?t('提取时规则匹配的清洗记录：','Processed rows matched at extraction: ')+table.title:t('历史快照未保存规则匹配明细。','This legacy snapshot has no saved matched rows.')};
        }
        const files=resolved?.metric?.fileIds.map(id=>reportCatalog(block).files.find(file=>file.id===id)).filter(Boolean)||[];
        const sheets=[];
        for(const file of files){const sheet=block.binding.sheetName?file.sheets.find(sheet=>sheet.name===block.binding.sheetName):file.sheets[0];if(sheet){const data=await blockCached(`/api/upload/source-sheets/${encodeURIComponent(sheet.id)}`,block);sheets.push({...data,file});}}
        const rows=sheets.flatMap(sheet=>sheet.rows.map(row=>({...row,[t('源文件','Source file')]:sheet.file.name})));
        return {headers:[...new Set(sheets.flatMap(sheet=>sheet.headers).concat(sheets.length?[t('源文件','Source file')]:[]))],rows,note:files.length?t('指标关联原始表（未经清洗）：','Linked originals (unprocessed): ')+engine.mergeFiles(files).map(file=>fileDisplayName(file,true)).join(' / '):resolved?.metric?.sourceLinkStatus==='unresolved'?t('指标值已保存，但原始表来源尚未确认；可载入对应原表并重新保存指标数据。','The value is saved, but its source table is unconfirmed. Load the original and save metric data again.'):t('历史指标没有可追溯原始文件；新导入后可自动关联。','This legacy metric has no archived original. New imports provide source links.')};
    }
    function sourceNote(detail,resolved,sourceCatalog=catalog){
        const date=resolved?.snapshot?view.dateKey(view.importTime(resolved.snapshot,sourceCatalog)):view.dateKey(resolved?.file?.created_at);
        return `<small class="document-source-note" data-source-date="${escape(date)}"><span class="document-source-detail">${escape(detail)}</span><span class="document-source-date">${escape(date)}</span></small>`;
    }
    async function renderData(block){
        const stored=block,sourceCatalog=reportCatalog(block);block=effectiveBlock(block,sourceCatalog);
        const resolved=engine.resolve(block.binding,sourceCatalog);
        if(block.binding&&!resolved&&!block.binding.sourceKey?.includes('值班')&&!(block.type==='chart'&&(block.chart.pivot||block.chart.series?.length)))throw new Error(t('缺少来源：没有对应月份 / 版本的数据','Missing source: no matching month / version'));
        if(block.type==='metric')return resolved?.metric?`<div class="document-metric"><span>${escape(metricLabel(resolved.metric.label))}</span><strong>${escape(resolved.metric.value)}</strong></div>${sourceNote(snapshotLabel(resolved.snapshot,sourceCatalog),resolved,sourceCatalog)}`:escape(t('选择“绑定与布局”引用数据库指标','Choose Bind & layout to reference a stored metric'));
        if(block.type==='chart'&&(block.chart.pivot||block.chart.series?.length))return window.MonthlyCharts.render(block);
        const data=await sourceRows(block,resolved);const missing=[...block.columns,...block.filters.map(item=>item.column)].filter(field=>!data.headers.includes(field));if(missing.length)throw new Error(t('缺少字段：','Missing fields: ')+[...new Set(missing)].join('、'));const rows=engine.filterRows(data.rows,block.filters);
        if(block.type==='summary')return `<div class="document-block-text">${window.MonthlyInlineTools.renderText(engine.summary(block,resolved?.metric?{...resolved,metric:{...resolved.metric,label:metricLabel(resolved.metric.label)}}:resolved,rows,language),inlineCatalog(),metricLabel)}</div>${sourceNote(data.note,resolved,sourceCatalog)}`;
        if(block.type==='chart'){
            let values;
            if(resolved?.metric){values=sourceCatalog.snapshots.filter(snapshot=>block.binding.mode!=='pinned'||snapshot.captured_at<=resolved.snapshot.captured_at).slice().reverse().map(snapshot=>({snapshot,metric:engine.resolve({...block.binding,mode:'pinned',snapshotId:snapshot.id},sourceCatalog)?.metric})).filter(item=>item.metric).map(({snapshot,metric})=>({label:snapshot.captured_at.slice(0,10),value:number(metric.value),displayLabel:String(metric.value)})).filter(item=>item.value!==null);}
            else values=engine.group(rows,block.chart);
            return window.MonthlyCharts.controls(block)+(block.chart.type?window.MonthlyCharts.renderValues(block,values.slice(-40),block.chart.y||resolved?.metric?.label):barChart(values.slice(-40)))+sourceNote(`${data.note} · ${values.length} ${t('组（最多展示最后40组）','groups (last 40 shown)')}`,resolved);
        }
        if(data.isDutyRoster){
            const headers=block.columns.length?block.columns:data.headers;
            const periodCol=headers[0]||'Period';
            const displayPeriodCol=periodCol==='Period'?t('时间段','Period'):periodCol;
            const weekCols=headers.slice(1);
            const summaryText=language==='en'
                ?(data.summaryText||`In Total: ${data.totalCount||353}, ${data.monthlyCount||31}*Person-times for Night Operation On-duty`)
                :`累计总计: ${data.totalCount||353}，当月夜间运维值班 ${data.monthlyCount||31}*人次`;
            const weekdayI18n={
                'Sun': t('周日','Sun'),
                'Mon': t('周一','Mon'),
                'Tue': t('周二','Tue'),
                'Wed': t('周三','Wed'),
                'Thu': t('周四','Thu'),
                'Fri': t('周五','Fri'),
                'Sat': t('周六','Sat')
            };
            const rowsMarkup=data.rows.map(row=>{
                const pVal=row[periodCol]||'';
                const isWeekend=pVal==='Fri'||pVal==='Sat'||pVal.includes('Fri')||pVal.includes('Sat')||pVal.includes('周五')||pVal.includes('周六');
                const displayDay=weekdayI18n[pVal]||pVal;
                const cellsMarkup=weekCols.map(col=>`<td>${escape(row[col]||'')}</td>`).join('');
                return `<tr class="${isWeekend?'duty-weekend-row':''}"><td class="duty-weekday-col"><strong>${escape(displayDay)}</strong></td>${cellsMarkup}</tr>`;
            }).join('');
            return `<div class="duty-roster-container"><table class="document-duty-table"><thead><tr><th>${escape(displayPeriodCol)}</th>${weekCols.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rowsMarkup}</tbody><tfoot><tr><td colspan="${headers.length}">${escape(summaryText)}</td></tr></tfoot></table></div>${sourceNote(`${data.note} · ${t('当月出勤','Target month')}: ${data.monthlyCount||31} ${t('人次','person-times')}`,resolved)}`;
        }
        const headers=block.columns.length?block.columns:data.headers;
        if(!headers.length)return escape(data.note);
        function formatCell(val,header){
            if(val===null||val===undefined||val==='')return '';
            if(typeof val==='number'){
                const h=String(header||'');
                if(h.includes('%')||h.includes('率')||h.includes('比')||(Number.isFinite(val)&&String(val).includes('.')&&String(val).split('.')[1].length>2)){
                    return Number(val.toFixed(2));
                }
            }
            return val;
        }
        return `<table><thead><tr>${headers.map(header=>`<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,block.limit).map(row=>`<tr>${headers.map(header=>`<td ${window.MonthlyDataFormats.numeric(row[header])?`data-number-value="${escape(row[header])}" data-number-field="${escape(header)}"`:""}>${escape(formatCell(row[header],header))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}">${t('筛选后无记录','No rows after filtering')}</td></tr>`}</tbody></table>${sourceNote(`${data.note} · ${t('筛选后','Filtered')}: ${rows.length} ${t('行','rows')} · ${t('显示','Shown')}: ${Math.min(rows.length,block.limit)}`,resolved)}`;
    }
    function number(value){const match=String(value??'').replace(/,/g,'').match(/^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/);return match?Number(match[1]):null;}
    function barChart(values){if(!values.length)return escape(t('暂无可绘制的数据','No chart data'));const max=Math.max(1,...values.map(v=>Math.abs(v.value)));const height=values.length*32+20;return `<svg class="document-chart" xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 640 ${height}" role="img" aria-label="${t('已存数据图表','Stored data chart')}">${values.map((item,index)=>`<text x="0" y="${index*32+24}" font-size="12" fill="#233f5c">${escape(item.label.slice(0,20))}</text><rect x="165" y="${index*32+8}" width="${Math.max(1,Math.abs(item.value)/max*360)}" height="20" fill="${item.value<0?'#b91c1c':'#355e87'}"/><text x="${175+Math.abs(item.value)/max*360}" y="${index*32+24}" font-size="12" fill="#233f5c">${escape(item.displayLabel??item.value)}</text>`).join('')}</svg>`;}
    function findBlock(id){for(const section of current.sections){const block=section.blocks.find(block=>block.id===id);if(block)return {block,section};}return null;}
    // Table-name drags bind report cards; field drags keep their pivot/chart behavior.
    const sourceFieldMime='application/x-monthly-field',sourceTableMime='application/x-monthly-table';
    function clearTableDrop(){root.querySelectorAll('.table-source-drop-target').forEach(element=>{element.classList.remove('table-source-drop-target');element.removeAttribute('data-table-drop-hint');});}
    function tableDropTarget(event){
        if(event.target.closest('[data-chart-zone]'))return null;
        const card=event.target.closest('.document-block[data-card-id]');
        return card||event.target.closest('.document-section');
    }
    document.getElementById('sourceLibrary').addEventListener('dragstart',event=>{
        const chip=event.target.closest('[data-chart-field]');if(!chip||!event.dataTransfer)return;
        try{const payload=JSON.parse(chip.dataset.chartField);if(payload.kind==='table')event.dataTransfer.setData(sourceTableMime,JSON.stringify(payload));}catch(_error){}
    });
    document.addEventListener('dragend',clearTableDrop);
    root.addEventListener('dragover',event=>{
        if(!Array.from(event.dataTransfer?.types||[]).includes(sourceTableMime))return;
        const target=tableDropTarget(event);clearTableDrop();if(!target)return;
        event.preventDefault();event.dataTransfer.dropEffect='copy';target.classList.add('table-source-drop-target');
        target.dataset.tableDropHint=target.matches('.document-block')?t('松开以替换为此表格','Drop to replace with this table'):t('松开以新增表格卡片','Drop to add a table card');
    });
    root.addEventListener('dragleave',event=>{if(!root.contains(event.relatedTarget))clearTableDrop();});
    root.addEventListener('drop',async event=>{
        clearTableDrop();const target=tableDropTarget(event);if(!target||!event.dataTransfer)return;
        let payload;try{payload=JSON.parse(event.dataTransfer.getData(sourceTableMime)||event.dataTransfer.getData(sourceFieldMime));}catch(_error){return;}
        if(payload?.kind!=='table')return;
        event.preventDefault();event.stopPropagation();
        try{
            const file=catalog.files.find(item=>item.id===payload.fileId),sheet=file?.sheets.find(item=>item.id===payload.sheetId);
            if(!sheet)throw new Error(t('源表不存在，请刷新数据资料库','Source table not found; refresh the source library'));
            // Commit focused text before cloning, so undo also restores unsaved edits.
            const focused=document.activeElement;if(root.contains(focused)&&focused.matches('.document-edit'))commitText(focused);
            const draft=clone(current),cardId=target.dataset.cardId;
            const section=draft.sections.find(item=>item.id===(cardId?findBlock(cardId)?.section.id:target.id.replace(/^section-/,'')));
            if(!section)return;
            const previous=cardId?section.blocks.find(item=>item.id===cardId):null;
            const block=engine.block('table');
            if(previous){
                for(const key of ['id','title','span','heightUnits','align'])block[key]=clone(previous[key]);
                if(previous.fieldRuns?.title)block.fieldRuns={title:clone(previous.fieldRuns.title)};
                if(previous.fieldAlign?.title)block.fieldAlign={title:clone(previous.fieldAlign.title)};
                section.blocks[section.blocks.indexOf(previous)]=block;
            }else section.blocks.push(block);
            if(!block.title.zh.trim()&&!block.title.en.trim())block.title=engine.bilingual(fileDisplayName(file)+' / '+sheet.name,file.name+' / '+sheet.name);
            block.binding={kind:'file',mode:'pinned',fileId:file.id,sourceKey:file.source_key||'',sheetName:sheet.name,tableMode:'original',reference:S.create(file,sheet,catalog,engine.documentMonth(current))};rememberSource(file,draft);
            engine.normalize(draft);checkpoint();current=draft;await render();
            status(previous?t('已替换为原始 / 清洗表格，请保存月报','Replaced with a source / processed table; save the report'):t('已新增原始 / 清洗表格，请保存月报','Source / processed table added; save the report'));
        }catch(error){status(error.message);}
    });
    function layoutPositions(selector,ids=null){
        return new Map(Array.from(root.querySelectorAll(selector),element=>[element.dataset.metaId||element.dataset.cardId||element.id,(()=>{const rect=element.getBoundingClientRect();return {left:rect.left+scrollX,top:rect.top+scrollY};})()]).filter(([id])=>!ids||ids.includes(id)));
    }
    async function renderMovement(selector,before,movedId){
        const result=render(),token=generation,reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // Data cards and grid sizing settle asynchronously. Measure their final positions,
        // not the temporary loading placeholders that can shift every following row.
        await result;
        const logo=root.querySelector('[data-edit-logo]');if(logo?.src)await logo.decode().catch(()=>{});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(token!==generation)return;

        root.querySelectorAll(selector).forEach(element=>{
            const id=element.dataset.metaId||element.dataset.cardId||element.id,old=before.get(id);
            if(!old)return;
            const rect=element.getBoundingClientRect(),x=old.left-(rect.left+scrollX),y=old.top-(rect.top+scrollY);
            if(Math.abs(x)<1&&Math.abs(y)<1&&id!==movedId)return;
            if(!reduced&&(Math.abs(x)>=1||Math.abs(y)>=1))element.animate([
                {transform:`translate(${x}px,${y}px)`,offset:0},
                {transform:`translate(${-x*.065}px,${-y*.065}px)`,offset:.72},
                {transform:`translate(${x*.025}px,${y*.025}px)`,offset:.88},
                {transform:'translate(0,0)',offset:1}
            ],{duration:520,easing:'cubic-bezier(.22,.75,.3,1)'});
            element.animate([{boxShadow:'inset 0 0 0 2px #3b82f6',backgroundColor:'#dbeafe'}, {boxShadow:'inset 0 0 0 2px #3b82f6',backgroundColor:'#eff6ff',offset:.55}, {boxShadow:'inset 0 0 0 0 transparent',backgroundColor:'transparent'}],{duration:reduced?400:1100,easing:'ease-out'});
        });
        return result;
    }
    function move(array,item,direction){const index=array.indexOf(item);const next=index+direction;if(next>=0&&next<array.length)[array[index],array[next]]=[array[next],array[index]];}
    root.addEventListener('beforeinput',event=>{const entry=fields.get(event.target.dataset.field);if(current.dataRulesVersion===1&&entry?.key==='value'&&entry.value.label?.zh==='数据月份'&&!event.inputType?.startsWith('format')){event.preventDefault();status(t('报告月份请在顶部修改；此处仍可调整文字样式','Change the report month at the top; text formatting remains available here'));}});
    root.addEventListener('input',event=>{commitText(event.target);syncSectionNavigation(fields.get(event.target.dataset.field),event.target.textContent);updateEmptyState();});
    function formatTableCells(block,target){
        target.querySelectorAll('table').forEach((table,tableIndex)=>{
            const headers=Array.from(table.tHead?.rows[0]?.cells||[],cell=>(cell.dataset.mappingOriginal??cell.textContent).slice(0,2000));
            const rowCounts=new Map();Array.from(table.rows).forEach(row=>{
                const group=row.parentElement.tagName;
                const base=group==='TBODY'?row.dataset.formatRow||row.cells[0]?.textContent||'':String(row.sectionRowIndex);
                const identity=group+':'+base,occurrence=rowCounts.get(identity)||0;rowCounts.set(identity,occurrence+1);
                Array.from(row.cells).forEach((cell,column)=>{
                    const key=JSON.stringify([tableIndex,group,base.slice(0,2000),occurrence,headers[column]||String(column),headers.slice(0,column).filter(header=>header===headers[column]).length]),saved=block.tableFormats?.find(item=>item.key===key),owner=saved?clone(saved):{key,value:{zh:'',en:''}};
                    const element=document.createElement('div');element.className='document-edit table-cell-edit';element.contentEditable='true';element.dataset.tableCell='';element.setAttribute('aria-readonly','true');element.innerHTML=cell.innerHTML;cell.replaceChildren(element);
                    const text=window.MonthlyRichText.read(element).map(run=>run.text).join('');let runs=owner.fieldRuns?.value?.[language];
                    if(runs&&runs.map(run=>run.text).join('')!==text){const common=Object.fromEntries(Object.entries(runs[0]?.style||{}).filter(([key,value])=>runs.every(run=>run.style[key]===value)));runs=[{text,style:common}];}
                    if(runs){
                        const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);let offset=0;
                        for(const node of nodes){const length=node.textContent.length,parts=[];let runOffset=0;for(const run of runs){const start=Math.max(offset-runOffset,0),end=Math.min(offset+length-runOffset,run.text.length);if(end>start)parts.push({text:run.text.slice(start,end),style:run.style});runOffset+=run.text.length;}const holder=document.createElement('span');holder.innerHTML=window.MonthlyInlineTools.renderText(node.textContent,catalog,metricLabel,parts,false);node.replaceWith(...holder.childNodes);offset+=length;}
                    }
                    owner.value[language]=text;if(owner.fieldAlign?.value?.[language])element.style.textAlign=owner.fieldAlign.value[language];
                    const field=`field-${fieldIndex++}`;element.dataset.field=field;fields.set(field,{value:owner,key:'value',cellBlock:block,initialRuns:window.MonthlyRichText.read(element),baseText:text});
                });
            });
        });
    }
    function commitText(element,options={}){
        const entry=fields.get(element.dataset.field);if(!entry)return;
        const {value:owner,key}=entry,runs=window.MonthlyRichText.read(element),value=runs.map(run=>run.text).join('');
        if(entry.cellBlock&&value!==entry.baseText)return;
        const oldRuns=key==='text'?owner.textRuns:owner.fieldRuns?.[key];
        const previousRuns=entry.initialRuns||oldRuns?.[language]||(owner[key][language]?[{text:owner[key][language],style:{}}]:[]);
        const comparable=items=>JSON.stringify(items.map(run=>({...run,style:Object.fromEntries(Object.entries(run.style).sort(([a],[b])=>a.localeCompare(b)))})));
        const alignment=element.style.textAlign,previousAlignment=owner.fieldAlign?.[key]?.[language]||'';
        if(!options?.preserveInline&&value!==owner[key][language]&&(/\[\[@(?:metric|formula):/.test(value)||/\[\[@(?:metric|formula):/.test(owner[key][language])))delete current.inlineData;
        if(value!==owner[key][language]||comparable(runs)!==comparable(previousRuns)||alignment!==previousAlignment){
            if(entry.cellBlock&&!entry.cellBlock.tableFormats?.some(item=>item.key===owner.key)&&entry.cellBlock.tableFormats?.length>=2000){status(t('单元格格式数量已达上限','Cell formatting limit reached'));return;}
            if(options?.recordHistory!==false)checkpoint();if(key==='value'&&owner.autoFill&&value!==owner[key][language])owner.autoFill=false;
            owner[key][language]=value;
            const pairRuns=oldRuns||{zh:owner[key].zh?[{text:owner[key].zh,style:{}}]:[],en:owner[key].en?[{text:owner[key].en,style:{}}]:[]};pairRuns[language]=runs;
            if(key==='text')owner.textRuns=pairRuns;else{owner.fieldRuns||={};owner.fieldRuns[key]=pairRuns;}
            owner.fieldAlign||={};owner.fieldAlign[key]||={};if(alignment)owner.fieldAlign[key][language]=alignment;else delete owner.fieldAlign[key][language];
            if(entry.cellBlock){entry.cellBlock.tableFormats||=[];const index=entry.cellBlock.tableFormats.findIndex(item=>item.key===owner.key);if(index<0)entry.cellBlock.tableFormats.push(clone(owner));else entry.cellBlock.tableFormats[index]=clone(owner);entry.initialRuns=clone(runs);}
            syncSectionNavigation(entry,value);status(t('有未保存修改','Unsaved changes'));
        }
    }
    root.addEventListener('beforeinput',event=>{if(event.target.closest('.table-cell-edit')&&!event.inputType?.startsWith('format'))event.preventDefault();});
    root.addEventListener('focusout',event=>commitText(event.target));
    root.addEventListener('paste',event=>{if(metricClipboard.paste(event))return;if(!event.target.closest('[contenteditable]'))return;event.preventDefault();if(event.target.closest('.table-cell-edit'))return;document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});
    root.addEventListener('click',event=>{
        const metaInput=event.target.closest('.document-meta-label,.document-meta-value');
        if(metaInput&&!event.target.closest('[contenteditable]'))metaInput.querySelector('[contenteditable]')?.focus();
        const actionBtn=event.target.closest('[data-action]');
        if(actionBtn){runAction(actionBtn.dataset.action).catch(error=>status(error.message));return;}
        const metaOpBtn=event.target.closest('[data-meta-op]');
        if(metaOpBtn){
            const op=metaOpBtn.dataset.metaOp;
            if(op==='open-layout'||op==='layout'){editLayout();return;}
            if(op==='align-3'){checkpoint();applyMetaAlign(3);render();status(t('已设置为三列对齐','3-column alignment applied'));return;}
            if(op==='align-2'){checkpoint();applyMetaAlign(2);render();status(t('已设置为两列对齐','2-column alignment applied'));return;}
            if(op==='align-auto'){checkpoint();current.metaAlignMode='grid';render();status(t('已恢复网格自动对齐','Auto grid alignment applied'));return;}
            if(op==='height-32'){checkpoint();current.metaRowHeight=32;render();status(t('已设置为紧凑行高 (32px)','Compact row height (32px) applied'));return;}
            if(op==='height-38'){checkpoint();current.metaRowHeight=38;render();status(t('已设置为标准行高 (38px)','Standard row height (38px) applied'));return;}
            if(op==='height-48'){checkpoint();current.metaRowHeight=48;render();status(t('已设置为舒适行高 (48px)','Comfortable row height (48px) applied'));return;}
            if(op==='width-100'){checkpoint();current.metaWidth=0;render();status(t('信息栏已设为 100% 满宽','Metadata width set to 100%'));return;}
            if(op==='width-90'){checkpoint();current.metaWidth=Math.round(current.pageWidth*0.9);render();status(t('信息栏已设为 90% 居中宽度','Metadata width set to 90%'));return;}
            if(op==='add-item'){checkpoint();current.meta.push({id:engine.uid(),label:engine.bilingual('新信息项','New field'),value:engine.bilingual('',''),span:4,heightUnits:0});render();status(t('已添加新信息项','New field added'));return;}
        }
        const metaCellBtn=event.target.closest('[data-meta-cell-op]');
        if(metaCellBtn){
            const op=metaCellBtn.dataset.metaCellOp;
            const id=metaCellBtn.dataset.metaId;
            const item=current.meta.find(m=>m.id===id);
            if(item){
                if(op==='move-prev'||op==='move-next'){
                    const direction=op==='move-prev'?-1:1,index=current.meta.indexOf(item);
                    if(index+direction<0||index+direction>=current.meta.length)return;
                    const before=layoutPositions('.document-meta-cell',[item.id,current.meta[index+direction].id]);checkpoint();move(current.meta,item,direction);
                    renderMovement('.document-meta-cell',before,item.id);status(t('信息项显示顺序已调整，请保存月报','Field order changed; save the report'));return;
                }
                checkpoint();
                if(op==='span-cycle'){const presets=[4,6,8,12,3];const curIdx=presets.indexOf(item.span);item.span=curIdx>=0?presets[(curIdx+1)%presets.length]:4;}
                else if(op==='height-toggle'){item.heightUnits=(item.heightUnits||1)>=3?0:((item.heightUnits||1)+1);}
                else if(op==='span-full'){item.span=12;}
                else if(op==='remove'){current.meta=current.meta.filter(m=>m!==item);}
                render();
                status(t('已更新信息栏布局','Metadata layout updated'));
                return;
            }
        }
        const button=event.target.closest('[data-op]');if(!button)return;const op=button.dataset.op;const section=current.sections.find(section=>section.id===button.dataset.section);const found=findBlock(button.dataset.block);
        if(op==='configure-block'&&found){window.MonthlyPivotPanel.open(found.block.id,button.dataset.configTab);return;}
        if(op==='data-formats'&&found){window.MonthlyPivotPanel.open(found.block.id,'style').then(()=>configure('format',found.block,document.getElementById('pivotFieldsPanel')));return;}
        if(op==='name-mappings'&&found){window.MonthlyPivotPanel.open(found.block.id,'style').then(()=>configure('mapping',found.block,document.getElementById('pivotFieldsPanel')));return;}
        if(op==='inspect-references'){referenceInspector.toggle(button.dataset.block);return;}
        if(op==='block-edit'){window.MonthlyPivotPanel.open(found.block.id);return;}
        if(op==='copy-block'||op==='copy-section'){
            const source=op==='copy-section'?section:found?.block;if(!source)return;
            const draft=clone(current),copy=clone(source);copy.id=engine.uid();
            if(op==='copy-section'){
                copy.blocks.forEach(block=>block.id=engine.uid());
                draft.sections.splice(draft.sections.findIndex(item=>item.id===source.id)+1,0,copy);
            }else{
                const blocks=draft.sections.find(item=>item.id===found.section.id).blocks;
                blocks.splice(blocks.findIndex(item=>item.id===source.id)+1,0,copy);
            }
            try{engine.normalize(draft);}catch(_){status(t('已达到月报模块或组件数量上限，无法继续复制','Report module or content limit reached; cannot duplicate'));return;}
            checkpoint();current=draft;
            const copiedGeneration=generation+1;
            render().then(()=>{
                if(generation!==copiedGeneration)return;
                const element=op==='copy-section'?document.getElementById('section-'+copy.id):root.querySelector(`[data-card-id="${copy.id}"]`);
                element?.scrollIntoView({block:'nearest'});
                element?.animate([{boxShadow:'inset 0 0 0 2px #3b82f6',backgroundColor:'#eff6ff'},{boxShadow:'inset 0 0 0 0 transparent',backgroundColor:'transparent'}],{duration:900,easing:'ease-out'});
            });
            status(t('已在原位置后复制，请保存月报','Duplicated immediately after the original; save the report'));return;
        }
        if(['section-up','section-down','block-up','block-down'].includes(op)){
            const isSection=op.startsWith('section-'),array=isSection?current.sections:found?.section.blocks,item=isSection?section:found?.block;
            if(!item)return;
            const direction=op.endsWith('-up')?-1:1,index=array.indexOf(item);
            if(index+direction<0||index+direction>=array.length)return;
            const selector=isSection?'.document-section':`#section-${found.section.id} .document-block`,before=layoutPositions(selector,[item,array[index+direction]].map(entry=>isSection?'section-'+entry.id:entry.id));
            checkpoint();move(array,item,direction);renderMovement(selector,before,isSection?'section-'+item.id:item.id);
            status(t('显示顺序已调整，请保存月报','Display order changed; save the report'));return;
        }
        checkpoint();if(op==='remove-section')current.sections=current.sections.filter(item=>item!==section);if(op==='remove-block')found.section.blocks=found.section.blocks.filter(item=>item!==found.block);render();});
    root.addEventListener('change',event=>{if(event.target.dataset.navSetting){const input=event.target;const value=Number(input.value);if(input.value===''||!input.checkValidity()||!Number.isInteger(value)){status(t('请填写有效的快捷跳转尺寸','Enter valid navigation dimensions'));return;}checkpoint();current[input.dataset.navSetting]=value;render();status(t('快捷跳转布局已修改，请保存月报','Navigation layout changed; save the report'));return;}if(event.target.dataset.sectionWidth){checkpoint();current.sections.find(section=>section.id===event.target.dataset.sectionWidth).span=Number(event.target.value);render();}if(event.target.dataset.addKind&&event.target.value){checkpoint();current.sections.find(section=>section.id===event.target.dataset.addKind).blocks.push(engine.block(event.target.value));render();}});
    const presetEditorApi={t,metricLabel,pair,request,status,change:checkpoint,render,tables:async block=>{
        const sources=block.chart?.pivot?.sources||block.chart?.series||[];
        const resolved=effectiveBlock(block),tables=await Promise.all([...new Set((resolved.chart?.pivot?.sources||resolved.chart?.series||[]).map(source=>source.sheetId).filter(Boolean))].map(id=>blockCached('/api/upload/source-sheets/'+encodeURIComponent(id),block)));
        if(block.binding)tables.push(await sourceRows(block,engine.resolve(block.binding,reportCatalog(block))));
        const target=document.getElementById('data-'+block.id);
        target?.querySelectorAll('table').forEach(table=>{const headers=Array.from(table.tHead?.rows[0]?.cells||[],cell=>cell.dataset.mappingOriginal??cell.textContent);const rows=Array.from(table.tBodies[0]?.rows||[],row=>Object.fromEntries(Array.from(row.cells,(cell,index)=>[headers[index]||String(index),cell.dataset.numberValue??cell.dataset.formatOriginal??cell.dataset.mappingOriginal??cell.textContent])));tables.push({headers,rows});});
        return tables;
    }};
    window.MonthlyMappingEditor.init(presetEditorApi);window.MonthlyDataFormatEditor.init(presetEditorApi);
    function editBlock(found,host){
        const dialog=host||document.getElementById('blockEditor');
        if(host){dialog.open=true;dialog.close=()=>{dialog.innerHTML='';dialog.open=false;};dialog.showModal=()=>{};}
        const block=found.block;
        const metrics=engine.metricOptions(catalog);
        const fileOptions=[...new Map(engine.mergeFiles(catalog.files).slice().reverse().map(file=>[file.source_key,file])).values()];
        if(!fileOptions.some(file=>file.source_key==='夜间运维值班表')){
            fileOptions.unshift({id:'virtual_duty_roster',name:'夜间运维值班表.xlsx',source_key:'夜间运维值班表',kind:'duty_roster',metricLabels:['夜间运维值班表','值班人次'],sheets:[{id:'virtual_duty_sheet',name:'夜间运维值班表',rowCount:7}],mergedFiles:[]});
        }
        const b=block.binding||{};
        const selectedFileId=engine.mergeFiles(catalog.files).find(file=>file.mergedFiles.some(member=>member.id===b.fileId))?.id||b.fileId;
        const option=(value,label,selected)=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label)}</option>`;
        const allSections=[...new Map(catalog.snapshots.flatMap(snapshot=>snapshot.sections.map(section=>[section.key,section]))).values()];
        const sortedSections=view.sortPrioritySections(allSections,catalog);
        const ticketSections=sortedSections.filter(section=>view.isExpiringTicketSection(section,catalog));
        const otherSections=sortedSections.filter(section=>!view.isExpiringTicketSection(section,catalog));
        let sectionOptionsMarkup=option('','—',b.sectionKey);
        if(ticketSections.length&&otherSections.length){
            sectionOptionsMarkup+=`<optgroup label="${escape(t('临期预警详表','Expiry ticket tables'))}">${ticketSections.map(s=>option(s.key,metricLabel(s.title||s.key),b.sectionKey)).join('')}</optgroup>`;
            sectionOptionsMarkup+=`<optgroup label="${escape(t('业务与关键指标清洗表','Business & metric processed tables'))}">${otherSections.map(s=>option(s.key,metricLabel(s.title||s.key),b.sectionKey)).join('')}</optgroup>`;
        }else{
            sectionOptionsMarkup+=sortedSections.map(s=>option(s.key,metricLabel(s.title||s.key),b.sectionKey)).join('');
        }
        if(b.sectionKey&&!sortedSections.some(s=>s.key===b.sectionKey)){
            sectionOptionsMarkup+=option(b.sectionKey,b.sectionKey,b.sectionKey);
        }
        dialog.innerHTML=`<form><h3>${t('内容位置、数据绑定与规则','Content position, data binding & rules')}</h3><div class="editor-row"><label>${t('内容类型','Content type')}<select name="type">${['text','metric','table','chart','summary'].map(type=>option(type,typeName(type),block.type)).join('')}</select></label><label>${t('移至模块','Move to module')}<select name="section">${current.sections.map(section=>option(section.id,pair(section.title),found.section.id)).join('')}</select></label><label>${t('位置宽度（12列网格）','Slot width (12-column grid)')}<input name="span" type="number" min="1" max="12" value="${block.span}" required></label><label>${t('卡片最小高度（网格数，0=自动）','Minimum card height (grid units; 0 = auto)')}<input name="heightUnits" type="number" min="0" max="100" value="${block.heightUnits||0}" required></label><label>${t('内容对齐','Alignment')}<select name="align">${['left','center','right'].map(value=>option(value,{left:t('左','Left'),center:t('中','Center'),right:t('右','Right')}[value],block.align)).join('')}</select></label></div>
        <label>${t('引用数据类型','Data reference')}<select name="kind">${[['metric',t('已提取指标及其源表','Extracted metric and its sources')],['file',t('原始表（包括无提取规则的表）','Original table (including tables without rules)')],['section',t('已存清洗表','Saved processed table')]].map(([value,label])=>option(value,label,b.kind||'metric')).join('')}</select></label>
        <div class="editor-row" data-metric-filters><label>${t('指标来源','Metric source')}<select name="metricOrigin"><option value="extraction">${t('导入提取','Imported extraction')}</option><option value="assessment">${t('报表考核','Report assessment')}</option></select></label><label>${t('指标层级','Metric level')}<select name="metricLevel"><option value="main">${t('提取主指标','Main metric')}</option><option value="sub">${t('提取子指标','Child metric')}</option></select></label><label>${t('全局分类','Global category')}<select name="metricCategory"><option value="">${t('全部分类','All categories')}</option></select></label></div>
        <div class="editor-row"><label>${t('提取指标','Extracted metric')}<select name="metricKey"><option value="">—</option>${metrics.map(metric=>option(metric.key,metricLabel(metric.label)+' · '+(metric.key.startsWith('assessment:')?t('报表考核','Assessment'):t('导入提取','Imported')),metrics.find(metric=>metric.keyAliases.includes(b.metricKey))?.key)).join('')}</select></label><label>${t('原始文件系列','Source file series')}<select name="sourceKey"><option value="">—</option>${fileOptions.map(file=>option(file.source_key,fileDisplayName(file,true),fileOptions.find(file=>file.source_key===b.sourceKey||(file.source_key_aliases||[]).includes(b.sourceKey))?.source_key)).join('')}</select></label><label>${t('清洗表模块标识','Processed section')}<select name="sectionKey">${sectionOptionsMarkup}</select></label><label>${t('指标源表口径','Metric source table')}<select name="tableMode">${[['original',t('原始表','Original')],['processed',t('快照清洗结果','Saved processed result')]].map(([value,label])=>option(value,label,b.tableMode||'original')).join('')}</select></label></div>
        <div class="editor-row"><label>${t('来源版本','Source version')}<select name="mode">${[['latest',t('对应月份最新版本（推荐）','Latest version for matching month (recommended)')],['pinned',t('固定历史快照 / 文件','Pin historical snapshot / file')]].map(([value,label])=>option(value,label,b.mode||'latest')).join('')}</select></label><label>${t('固定来源目标月份','Pinned source target month')}<select name="pinTargetPeriod"><option value="">${t('全部目标月份','All target months')}</option></select></label><label>${t('固定来源导入日期','Pinned source import date')}<select name="pinImportDate"><option value="">${t('全部导入日期','All import dates')}</option></select></label><label>${t('固定快照','Pinned snapshot')}<select name="snapshotId"><option value="">—</option>${catalog.snapshots.map(snapshot=>option(snapshot.id,snapshotLabel(snapshot),b.snapshotId)).join('')}</select></label><label>${t('固定原文件','Pinned original file')}<select name="fileId"><option value="">—</option>${engine.mergeFiles(catalog.files).map(file=>option(file.id,`${fileDisplayName(file,true)} · ${view.timeLabel(file.created_at)}`,selectedFileId)).join('')}</select></label><label>${t('工作表名（留空为第一张）','Sheet name (blank = first)')}<input name="sheetName" value="${escape(b.sheetName||'')}"></label></div>
        <p data-editor-note="source">${t('“自动引用”使用相同指标标识或原文件系列的最新入库记录。原始表未经清洗；清洗表保留快照时的结果。历史指标缺少原文件时显示说明，不拼接不相关文件。','Latest mode uses the latest matching metric key or file series. Originals are unprocessed; processed tables preserve snapshot results. Missing legacy originals remain unavailable.')}</p>
        <div class="editor-column-picker"></div><datalist id="availableColumns"></datalist><label>${t('展示列（每行一个，空白=全部）','Display columns (one per line; blank = all)')}<textarea name="columns">${escape(block.columns.join('\n'))}</textarea></label><label>${t('最多显示表格行数（1–10000）','Maximum displayed rows (1–10000)')}<input name="limit" type="number" min="1" max="10000" value="${block.limit}" required></label>
        <h4 data-editor-note="filters">${t('表格筛选规则','Table filters')}</h4><div class="editor-filters"></div><button data-add-filter type="button">${t('＋筛选条件','＋ Filter')}</button>
        <div class="editor-row"><label>${t('图表分组列','Chart group column')}<input name="chartX" list="availableColumns" value="${escape(block.chart.x)}"></label><label>${t('图表数值列','Chart value column')}<input name="chartY" list="availableColumns" value="${escape(block.chart.y)}"></label></div><label>${t('图表统计','Chart aggregation')}<select name="aggregation">${[['count',t('计数','Count')],['sum',t('数值求和','Sum')]].map(([value,label])=>option(value,label,block.chart.aggregation)).join('')}</select></label><p data-editor-note="chart">${t('指标图表自动展示已存历史值；原始表图表按列统计。','Metric charts show stored historical values; table charts aggregate selected columns.')}</p>
        <label>${t('中文总结规则','Chinese summary rule')}<textarea name="ruleZh" maxlength="5000">${escape(block.rule.zh)}</textarea></label><label>${t('英文总结规则','English summary rule')}<textarea name="ruleEn" maxlength="5000">${escape(block.rule.en)}</textarea></label><p data-editor-note="summary">${t('总结字段：{label} 指标名，{value} 指标值，{date} 数据日期，{target} 入库目标，{gap} 差距，{count}/{rows} 筛选后行数。','Summary fields: {label}, {value}, {date}, {target}, {gap}, {count}/{rows}.')}</p><p role="status"></p><footer><button data-cancel type="button">${t('取消','Cancel')}</button><button type="submit">${t('应用','Apply')}</button></footer></form>`;
        function addFilter(filter={column:'',op:'contains',value:''}){const row=document.createElement('div');row.innerHTML=`<input list="availableColumns" placeholder="${t('列名','Column')}" value="${escape(filter.column)}"><select>${['contains','eq','neq','gt','lt','empty','notEmpty'].map(op=>option(op,{contains:t('包含','Contains'),eq:t('等于','Equals'),neq:t('不等于','Not equal'),gt:t('大于','Greater'),lt:t('小于','Less'),empty:t('空','Empty'),notEmpty:t('非空','Not empty')}[op],filter.op)).join('')}</select><input placeholder="${t('条件值','Value')}" value="${escape(filter.value)}"><button type="button">×</button>`;row.querySelector('button').onclick=()=>row.remove();dialog.querySelector('.editor-filters').append(row);}
        block.filters.forEach(addFilter);dialog.querySelector('[data-add-filter]').onclick=()=>addFilter();dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
        dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const f=event.target.elements;try{syncContentType('kind');const draft=clone(current);const target=draft.sections.flatMap(section=>section.blocks).find(item=>item.id===block.id);Object.assign(target,{type:f.type.value,span:Number(f.span.value),heightUnits:Number(f.heightUnits.value),align:f.align.value,limit:Number(f.limit.value),columns:f.columns.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),filters:[...dialog.querySelectorAll('.editor-filters>div')].map(row=>({column:row.querySelectorAll('input')[0].value,op:row.querySelector('select').value,value:row.querySelectorAll('input')[1].value})),chart:{...target.chart,x:f.chartX.value,y:f.chartY.value,aggregation:f.aggregation.value},rule:{zh:f.ruleZh.value,en:f.ruleEn.value},binding:{kind:f.kind.value,mode:f.mode.value,metricKey:f.kind.value==='metric'?f.metricKey.value:'',sourceKey:f.kind.value==='file'?f.sourceKey.value:'',sectionKey:f.kind.value==='metric' ? (metrics.find(metric=>metric.key===f.metricKey.value)?.sourceSection || '') : f.kind.value==='section'?f.sectionKey.value:'',tableMode:f.kind.value==='metric'?f.tableMode.value:'original',snapshotId:f.mode.value==='pinned'&&f.kind.value!=='file'?f.snapshotId.value:'',fileId:f.mode.value==='pinned'&&f.kind.value==='file'?f.fileId.value:'',sheetName:f.kind.value!=='section'&&(f.kind.value!=='metric'||f.tableMode.value!=='processed')?f.sheetName.value:''}});if(target.binding.kind==='metric'&&target.type!=='table'){target.binding=metricBinding(target.binding);if(!target.binding.metricKey||!engine.resolve(target.binding,{...catalog,reportMonth:engine.documentMonth(current)}))throw new Error(t('请选择对应月份或版本中可用的指标','Choose a metric available in the matching month/version'));}else if(block.binding?.reference&&block.binding.kind===target.binding.kind&&block.binding.sourceKey===target.binding.sourceKey&&block.binding.metricKey===target.binding.metricKey&&block.binding.sectionKey===target.binding.sectionKey)target.binding.reference=clone(block.binding.reference);
                if(!target.binding.reference&&!(target.binding.kind==='metric'&&target.type!=='table')&&JSON.stringify(block.binding)!==JSON.stringify(target.binding)){const data={...catalog,reportMonth:engine.documentMonth(current)},resolved=engine.resolve(target.binding,data);if(resolved?.file)target.binding.reference=S.create(resolved.file,resolved.sheet,catalog,engine.documentMonth(current),f.mode.value==='pinned');else if(resolved?.snapshot)target.binding.reference={monthMode:'relative',offset:0,month:'',versionMode:f.mode.value==='pinned'?'pinned':'latest',versionId:f.mode.value==='pinned'?resolved.snapshot.id:'',sourceKind:resolved.snapshot.kind||'extraction',sourceKey:'',sheetName:''};}
                if(target.savedData)target.previousData=target.savedData;delete target.savedData;
                if(f.section.value!==found.section.id){draft.sections.find(item=>item.id===found.section.id).blocks=draft.sections.find(item=>item.id===found.section.id).blocks.filter(item=>item.id!==target.id);draft.sections.find(item=>item.id===f.section.value).blocks.push(target);}engine.normalize(draft);checkpoint();current=draft;dialog.close();render();}catch(error){dialog.querySelector('[role=status]').textContent=error.message;}};
        const form=dialog.querySelector('form');let experience;
        if(block.type==='table'&&!b.kind)form.elements.kind.value='file';
        const sheetInput=form.elements.sheetName,sheetPicker=document.createElement('select');sheetPicker.name='sheetName';sheetPicker.innerHTML=option('',t('第一张工作表','First worksheet'),'')+(sheetInput.value?option(sheetInput.value,sheetInput.value,sheetInput.value):'');sheetInput.replaceWith(sheetPicker);
        const savedMetric=metrics.find(metric=>metric.keyAliases.includes(b.metricKey));
        for(const name of ['metricOrigin','metricLevel']){const select=form.elements[name];select.insertAdjacentHTML('afterbegin',option('',t(name==='metricOrigin'?'全部来源':'全部层级',name==='metricOrigin'?'All sources':'All levels'),''));select.value='';}
        function updateMetricOptions(changed){
            const f=form.elements;const oldKey=f.metricKey.value;
            if(changed==='metricOrigin'||changed==='metricLevel')f.metricCategory.value='';
            const eligible=metrics.filter(metric=>(!f.metricOrigin.value||(metric.key.startsWith('assessment:')?'assessment':'extraction')===f.metricOrigin.value)&&(!f.metricLevel.value||(metric.metricLevel||'main')===f.metricLevel.value));
            const category=f.metricCategory.value;
            const categories=[...new Set([...globalCategories,...eligible.map(metric=>metric.category).filter(Boolean)])];
            f.metricCategory.innerHTML=option('',t('全部分类','All categories'),category)+categories.map(value=>option(value,metricLabel(value),category)).join('');
            const narrowed=eligible.filter(metric=>!f.metricCategory.value||metric.category===f.metricCategory.value);
            f.metricKey.innerHTML=option('',narrowed.length?'—':t('此范围暂无已存指标','No saved metrics in this scope'),oldKey)+narrowed.map(metric=>option(metric.key,metricLabel(metric.label),oldKey)).join('');
        }
        updateMetricOptions('initial');
        // Optional filters start broad, so selecting a metric never hides other levels.
        function updatePinnedSources(){
            const f=form.elements;
            const snapshots=f.kind.value==='metric'?catalog.snapshots.filter(snapshot=>engine.resolve({kind:'metric',metricKey:f.metricKey.value,mode:'pinned',snapshotId:snapshot.id},catalog)):view.eligibleSnapshots({kind:f.kind.value,sectionKey:f.sectionKey.value},catalog);
            const files=engine.mergeFiles(catalog.files).filter(file=>!f.sourceKey.value||file.source_key===f.sourceKey.value||(file.source_key_aliases||[]).includes(f.sourceKey.value));
            const records=f.kind.value==='file'?files.map(file=>({id:file.id,date:view.dateKey(file.created_at),period:view.groups(catalog).find(group=>group.fileIds.includes(file.id))?.period||'',label:`${fileDisplayName(file,true)} · ${view.timeLabel(file.created_at)}`})):snapshots.map(snapshot=>({id:snapshot.id,date:view.dateKey(view.importTime(snapshot,catalog)),period:view.snapshotPeriod(snapshot,catalog),label:snapshotLabel(snapshot)}));
            const chosenPeriod=f.pinTargetPeriod.value,chosenDate=f.pinImportDate.value;
            const periods=[...new Set(records.map(record=>record.period))].sort().reverse();
            f.pinTargetPeriod.innerHTML=option('',t('全部目标月份','All target months'),chosenPeriod)+periods.map(period=>option(period||'__unset',targetLabel(period),chosenPeriod)).join('');
            const matching=records.filter(record=>!f.pinTargetPeriod.value||record.period===(f.pinTargetPeriod.value==='__unset'?'':f.pinTargetPeriod.value));
            const dates=[...new Set(matching.map(record=>record.date))];
            f.pinImportDate.innerHTML=option('',t('全部导入日期','All import dates'),chosenDate)+dates.map(date=>option(date,date,chosenDate)).join('');
            const displayed=matching.filter(record=>!f.pinImportDate.value||record.date===f.pinImportDate.value);
            const picker=f.kind.value==='file'?f.fileId:f.snapshotId;const selected=picker.value;
            picker.innerHTML=option('','—',selected)+displayed.map(record=>option(record.id,record.label,selected)).join('');
        }
        function editorBinding(){const f=form.elements;return {kind:f.kind.value,mode:f.mode.value,metricKey:f.metricKey.value,sourceKey:f.sourceKey.value,sectionKey:f.sectionKey.value,tableMode:f.tableMode.value,snapshotId:f.snapshotId.value,fileId:f.fileId.value,sheetName:f.sheetName.value};}
        function metricBinding(binding){
            const selected=savedMetric?.key===binding.metricKey;
            const sameVersion=(b.mode||'latest')===binding.mode&&(b.snapshotId||'')===(binding.mode==='pinned'?binding.snapshotId:'');
            if(selected&&sameVersion&&!b.reference)return binding; // Keep saved legacy references unchanged.
            const reference=selected&&sameVersion&&b.reference?clone(b.reference):{monthMode:'relative',offset:0,month:'',versionMode:binding.mode,versionId:'',sourceKind:binding.metricKey.startsWith('assessment:')?'assessment':'extraction',sourceKey:'',sheetName:''};
            reference.versionMode=binding.mode;reference.versionId=binding.mode==='pinned'?binding.snapshotId:'';
            if(binding.mode==='pinned'&&!(selected&&sameVersion&&b.reference)){
                const snapshot=catalog.snapshots.find(item=>item.id===binding.snapshotId),month=snapshot?S.snapshotMonth(snapshot,catalog):'';
                reference.monthMode=month?'fixed':'global';reference.month=month;reference.offset=0;
            }
            return {...binding,reference};
        }
        function previewMetric(){const binding=metricBinding(editorBinding());return engine.resolve(binding,{...catalog,reportMonth:engine.documentMonth(current)});}
        let bindingGeneration=0;
        async function updateColumns(){
            const token=++bindingGeneration;const f=form.elements;
            const binding=editorBinding();if(f.type.value==='text'||f.type.value==='metric'||f.type.value==='chart'&&f.kind.value==='metric')return;experience?.loading();
            try {const resolved=f.kind.value==='metric'?previewMetric():engine.resolve(binding,catalog),data=await sourceRows({...block,binding,savedData:undefined,dataUpdateMode:'live'},resolved);if(token!==bindingGeneration||!dialog.open)return;const selected=f.columns.value.split(/\r?\n/).filter(Boolean),selectedSheet=f.sheetName.value,sheetNames=[...new Set((resolved?.file?.sheets||[]).map(sheet=>sheet.name))];if(selectedSheet&&!sheetNames.includes(selectedSheet))sheetNames.unshift(selectedSheet);f.sheetName.innerHTML=option('',t('第一张工作表','First worksheet'),selectedSheet)+sheetNames.map(name=>option(name,name,selectedSheet)).join('');dialog.querySelector('#availableColumns').innerHTML=data.headers.map(header=>`<option value="${escape(header)}"></option>`).join('');dialog.querySelector('.editor-column-picker').innerHTML=`<p>${t('可用字段（勾选展示列；空选=全部）','Available fields (select columns; none = all)')}</p><div>${data.headers.map(header=>`<label><input type="checkbox" value="${escape(header)}" ${selected.includes(header)?'checked':''}> ${escape(metricLabel(header))}</label>`).join('')}</div>`;experience?.tablePreview(data,engine.filterRows(data.rows,[...dialog.querySelectorAll('.editor-filters>div')].map(row=>({column:row.querySelectorAll('input')[0].value,op:row.querySelector('select').value,value:row.querySelectorAll('input')[1].value}))),resolved);dialog.querySelector('.editor-column-picker').onchange=()=>{f.columns.value=[...dialog.querySelectorAll('.editor-column-picker input:checked')].map(el=>el.value).join('\n');experience?.sync();};}catch(error){if(token===bindingGeneration){dialog.querySelector('.editor-column-picker').textContent=error.message;experience?.error(error.message);}}
        }
        function syncContentType(changed){
            const f=form.elements;
            let selected=f.kind.value||'metric';
            if(changed==='type'){
                if(f.type.value==='metric')selected='metric';
                else if(f.type.value==='table'&&selected==='metric')selected='file';
            }
            if(f.type.value==='metric'&&selected!=='metric')f.type.value='table';
            const kinds=f.type.value==='metric'?['metric']:f.type.value==='table'?['file','section',...(selected==='metric'?['metric']:[])]:['metric','file','section'];
            const names={metric:f.type.value==='table'?t('按指标关联源表','Source table linked to a metric'):t('已提取指标','Extracted metric'),file:t('原始表（包括无提取规则的表）','Original table (including tables without rules)'),section:t('已存清洗表','Saved processed table')};
            f.kind.innerHTML=kinds.map(kind=>option(kind,names[kind],selected)).join('');
        }
        function simplify(){const f=form.elements;const type=f.type.value;const kind=f.kind.value;const show=(name,value)=>{const el=f[name];if(el)el.closest('label').hidden=!value;};
            for(const name of ['kind','mode'])show(name,type!=='text');
            for(const name of ['pinTargetPeriod','pinImportDate'])show(name,type!=='text'&&f.mode.value==='pinned');
            for(const name of ['metricOrigin','metricLevel'])show(name,type!=='text'&&kind==='metric');show('metricCategory',type!=='text'&&kind==='metric'&&f.metricLevel.value==='sub');show('metricKey',type!=='text'&&kind==='metric');show('sourceKey',type!=='text'&&kind==='file');show('sectionKey',type!=='text'&&kind==='section');show('tableMode',type!=='text'&&type!=='metric'&&kind==='metric');show('snapshotId',type!=='text'&&kind!=='file'&&f.mode.value==='pinned');show('fileId',type!=='text'&&kind==='file'&&f.mode.value==='pinned');show('sheetName',type!=='text'&&type!=='metric'&&kind!=='section'&&(kind!=='metric'||f.tableMode.value!=='processed'));for(const name of ['columns','limit'])show(name,type==='table');for(const name of ['chartX','chartY','aggregation'])show(name,type==='chart'&&kind!=='metric');for(const name of ['ruleZh','ruleEn'])show(name,type==='summary');
            dialog.querySelector('.editor-column-picker').hidden=type!=='table';dialog.querySelector('.editor-filters').hidden=!['table','chart','summary'].includes(type);dialog.querySelector('[data-add-filter]').hidden=dialog.querySelector('.editor-filters').hidden;
            dialog.querySelector('[data-editor-note=source]').hidden=type==='text';
            dialog.querySelector('[data-editor-note=filters]').hidden=dialog.querySelector('.editor-filters').hidden;
            dialog.querySelector('[data-editor-note=chart]').hidden=type!=='chart';
            dialog.querySelector('[data-editor-note=summary]').hidden=type!=='summary';
            dialog.querySelectorAll('.editor-row').forEach(row=>row.hidden=Array.from(row.children).every(child=>child.hidden));experience?.sync();
        }
        for(const name of ['type','kind','mode','metricKey','sourceKey','sectionKey','tableMode','snapshotId','fileId','sheetName','pinTargetPeriod','pinImportDate','metricOrigin','metricLevel','metricCategory'])form.elements[name].addEventListener('change',()=>{syncContentType(name);if(['metricOrigin','metricLevel','metricCategory'].includes(name))updateMetricOptions(name);updatePinnedSources();simplify();updateColumns();});
        experience=window.MonthlyComponentEditor.mount({dialog,form,metrics,t,escape,metricLabel,language,versionLabel:()=>{const reference=metricBinding(editorBinding()).reference;return !reference?t('旧版最新引用（保持原行为）','Legacy latest reference (unchanged)'):reference.monthMode==='global'?t('全库最新（不限月份）','Latest across all months'):t('对应月份最新版本（推荐）','Latest version for matching month (recommended)');},resolveMetric:previewMetric,describeMetric:resolved=>t('数据月份：','Data month: ')+(S.snapshotMonth(resolved.snapshot,catalog)||t('未标注','Unspecified'))+' · '+t('快照：','Snapshot: ')+view.timeLabel(resolved.snapshot.captured_at),summaryText:(resolved,rows)=>engine.summary({rule:{zh:form.elements.ruleZh.value,en:form.elements.ruleEn.value}},resolved?.metric?{...resolved,metric:{...resolved.metric,label:metricLabel(resolved.metric.label)}}:resolved,rows,language),onPick:metric=>{if(!metric)return;for(const name of ['metricOrigin','metricLevel','metricCategory'])form.elements[name].value='';updateMetricOptions('initial');form.elements.metricKey.value=metric.key;form.elements.metricKey.dispatchEvent(new Event('change',{bubbles:true}));}});
        form.addEventListener('input',event=>{if(event.target.closest('.editor-filters'))updateColumns();});form.addEventListener('change',event=>{if(event.target.closest('.editor-filters'))updateColumns();});
        dialog.querySelector('[data-add-filter]').addEventListener('click',()=>updateColumns());dialog.querySelector('.editor-filters').addEventListener('click',()=>updateColumns());
        syncContentType('initial');dialog.showModal();updatePinnedSources();simplify();updateColumns();
    }
    function editLayout(){
        const metaAlignOpts=[['grid',t('智能对齐（默认：保持竖线对齐，末尾项补齐）','Smart grid (aligned tracks)')],['col-3',t('三列对齐（标准 4-4-4 排版）','3-column alignment (4-4-4)')],['col-2',t('两列对齐（对称 6-6 排版）','2-column alignment (6-6)')],['free',t('自由网格（严格按所设格数）','Free grid (exact spans)')],['stretch',t('比例拉伸（旧版比例充满）','Proportional stretch')]];
        dialog.innerHTML=`<form><h3>${t('页面与报告信息布局','Page & report metadata layout')}</h3><label>${t('服务器文档名称','Server document name')}<input name="name" maxlength="200" value="${escape(current.name)}" required></label><div class="editor-row"><label>${t('页面宽度','Page width')}<input name="width" type="number" min="600" max="2000" value="${current.pageWidth}" required></label><label>${t('Logo 地址（留空隐藏）','Logo URL (blank to hide)')}<input name="logo" value="${escape(current.logo)}"></label><label>${t('Logo 宽度','Logo width')}<input name="logoWidth" type="number" min="20" max="400" value="${current.logoWidth}" required></label><label>${t('Logo 位置','Logo position')}<select name="logoAlign">${['left','center','right'].map(v=>`<option ${current.logoAlign===v?'selected':''}>${v}</option>`).join('')}</select></label></div><div class="metadata-global-config"><h4>${t('报告信息栏整体尺寸与排版','Metadata overall dimensions & alignment')}</h4><div class="editor-row"><label>${t('整体宽度（0 = 100% 满宽，或填写 px）','Overall width (0 = 100% full, or enter px)')}<input name="metaWidth" type="number" min="0" max="2000" step="10" value="${current.metaWidth||0}"></label><label>${t('基础行高 / 最小高度（px，0=标准38px）','Base row height (px, 0=standard 38px)')}<input name="metaRowHeight" type="number" min="0" max="200" value="${current.metaRowHeight||0}"></label><label>${t('标签列宽（px，0=默认90px）','Label column width (px, 0=default 90px)')}<input name="metaLabelWidth" type="number" min="0" max="300" value="${current.metaLabelWidth||0}"></label><label>${t('竖线对齐模式','Vertical line alignment mode')}<select name="metaAlignMode">${metaAlignOpts.map(([v,label])=>`<option value="${v}" ${(current.metaAlignMode||'grid')===v?'selected':''}>${escape(label)}</option>`).join('')}</select></label></div><div style="margin-top:8px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;"><span style="font-size:11px;color:#475569;">${t('快捷排版预设:','Quick presets:')}</span><button type="button" class="btn-span-chip" data-preset-align="3">📐 ${t('三列对齐 (4-4-4)','3-col (4-4-4)')}</button><button type="button" class="btn-span-chip" data-preset-align="2">📐 ${t('两列对齐 (6-6)','2-col (6-6)')}</button><button type="button" class="btn-span-chip" data-preset-height="32">📏 32px ${t('紧凑','Compact')}</button><button type="button" class="btn-span-chip" data-preset-height="38">📏 38px ${t('标准','Standard')}</button><button type="button" class="btn-span-chip" data-preset-height="48">📏 48px ${t('舒适','Comfy')}</button></div></div><h4>${t('信息栏项目（顺序、单项宽度与高度均可自定义）','Metadata fields (editable order, width & height)')}</h4><div id="metaEditor"></div><button type="button" data-add-meta>${t('＋信息项','＋ Metadata field')}</button><p role="status"></p><footer><button type="button" data-cancel>${t('取消','Cancel')}</button><button type="submit">${t('应用','Apply')}</button></footer></form>`;
        const items=clone(current.meta);
        const collect=()=>{[...dialog.querySelectorAll('[data-meta-id]')].forEach(row=>{const item=items.find(item=>item.id===row.dataset.metaId);if(!item)return;item.label[language]=row.querySelector('[data-meta-label]').value;item.value[language]=row.querySelector('[data-meta-value]').value;item.span=Number(row.querySelector('[data-meta-span]').value)||4;item.heightUnits=Number(row.querySelector('[data-meta-height]')?.value)||0;});};
        function draw(){dialog.querySelector('#metaEditor').innerHTML=items.map(item=>`<div data-meta-id="${item.id}" class="meta-editor-row"><label style="margin:0;">${t('标题','Label')}<input data-meta-label value="${escape(pair(item.label))}"></label><label style="margin:0;">${t('内容','Content')}<input data-meta-value value="${escape(pair(item.value))}"></label><div><label style="margin:0;">${t('宽度（1–12格）','Width (1–12)')}<input data-meta-span type="number" min="1" max="12" value="${item.span}" required style="padding:4px 6px;"></label><div style="display:flex;gap:3px;margin-top:3px;"><button type="button" class="btn-span-chip" data-set-span="3" title="${t('3格 (1/4宽)','3 units')}">3</button><button type="button" class="btn-span-chip" data-set-span="4" title="${t('4格 (1/3宽，标准三列)','4 units (3-col)')}">4</button><button type="button" class="btn-span-chip" data-set-span="6" title="${t('6格 (半宽，标准两列)','6 units (2-col)')}">6</button><button type="button" class="btn-span-chip" data-set-span="8" title="${t('8格 (2/3宽)','8 units')}">8</button><button type="button" class="btn-span-chip" data-set-span="12" title="${t('12格 (整行全宽)','12 units (Full)')}">12</button></div></div><div><label style="margin:0;">${t('高度倍数','Height')}<select data-meta-height style="padding:4px 6px;"><option value="0" ${(!item.heightUnits||item.heightUnits===1)?'selected':''}>1x ${t('单行','1x')}</option><option value="2" ${item.heightUnits===2?'selected':''}>2x ${t('双倍高','2x')}</option><option value="3" ${item.heightUnits===3?'selected':''}>3x ${t('三倍高','3x')}</option><option value="4" ${item.heightUnits===4?'selected':''}>4x ${t('四倍高','4x')}</option></select></label></div><div style="display:flex;gap:3px;margin-top:18px;"><button type="button" data-meta-up="${item.id}" title="${t('上移','Move up')}">↑</button> <button type="button" data-meta-down="${item.id}" title="${t('下移','Move down')}">↓</button> <button type="button" data-meta-remove="${item.id}" title="${t('删除','Delete')}">×</button></div></div>`).join('');}
        draw();
        dialog.querySelector('#metaEditor').onclick=event=>{
            const el=event.target;if(!el.closest('button'))return;
            collect();
            if(el.dataset.setSpan){
                const row=el.closest('[data-meta-id]');
                const item=items.find(item=>item.id===row.dataset.metaId);
                if(item){item.span=Number(el.dataset.setSpan);draw();}
                return;
            }
            if(el.dataset.metaUp)move(items,items.find(item=>item.id===el.dataset.metaUp),-1);
            if(el.dataset.metaDown)move(items,items.find(item=>item.id===el.dataset.metaDown),1);
            if(el.dataset.metaRemove)items.splice(items.findIndex(item=>item.id===el.dataset.metaRemove),1);
            draw();
        };
        dialog.querySelectorAll('[data-preset-align]').forEach(btn=>{
            btn.onclick=()=>{
                collect();
                const cols=Number(btn.dataset.presetAlign);
                const spanPerCol=Math.floor(12/cols);
                items.forEach(item=>{
                    const isFull=item.span===12||(item.label.zh||'').includes('目标')||(item.label.zh||'').includes('概述');
                    item.span=isFull?12:spanPerCol;
                });
                let curSum=0;
                for(let i=0;i<items.length;i++){
                    const item=items[i];
                    if(item.span===12){curSum=0;continue;}
                    curSum+=item.span;
                    const next=items[i+1];
                    if(!next||next.span===12){
                        if(curSum<12)item.span+=(12-curSum);
                        curSum=0;
                    }
                }
                const alignSelect=dialog.querySelector('select[name=metaAlignMode]');
                if(alignSelect)alignSelect.value=cols===3?'col-3':'col-2';
                draw();
            };
        });
        dialog.querySelectorAll('[data-preset-height]').forEach(btn=>{
            btn.onclick=()=>{
                const input=dialog.querySelector('input[name=metaRowHeight]');
                if(input)input.value=btn.dataset.presetHeight;
            };
        });
        dialog.querySelector('[data-add-meta]').onclick=()=>{collect();items.push({id:engine.uid(),label:engine.bilingual('新信息项','New field'),value:engine.bilingual('',''),span:4,heightUnits:0});draw();};
        dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
        dialog.querySelector('form').onsubmit=event=>{
            event.preventDefault();collect();const f=event.target.elements;
            try{
                const draft={...clone(current),meta:items,name:f.name.value,pageWidth:Number(f.width.value),logo:f.logo.value,logoWidth:Number(f.logoWidth.value),logoAlign:f.logoAlign.value,metaWidth:Number(f.metaWidth.value)||0,metaRowHeight:Number(f.metaRowHeight.value)||0,metaLabelWidth:Number(f.metaLabelWidth.value)||0,metaAlignMode:f.metaAlignMode.value||'grid'};
                engine.normalize(draft);checkpoint();current=draft;dialog.close();render();
            }catch(error){dialog.querySelector('[role=status]').textContent=error.message;}
        };
        dialog.showModal();
    }
    function download(blob,name){const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
    async function listDocuments(){const items=await request('/api/upload/monthly-documents');document.getElementById('documentList').innerHTML=`<option value="">${t('选择已保存月报','Select saved report')}</option>`+items.map(item=>`<option value="${escape(item.id)}" ${item.id===current.id?'selected':''}>${escape(item.name)}</option>`).join('');return items;}
    function loadAuxiliaryConfig(){
        // Optional translations and categories must never hold the source library or editor hostage.
        request('/api/sla/prefs/i18nMap',{timeoutMs:5000}).then(mapping=>{metricTranslations=readMetricTranslations(mapping);if(language==='en'&&!initializing){library();render();}}).catch(()=>{});
        request('/api/sla/categories',{timeoutMs:5000}).then(categories=>{globalCategories=Array.isArray(categories)?categories:[];}).catch(()=>{});
    }
    const directoryNames=()=>({core:t('原始表与指标','Originals & metrics'),topic:t('专题数据','Topic data'),meeting:t('会议考勤','Meeting attendance')});
    async function loadCatalog(days,logId,options={}){
        const names=directoryNames();
        return window.MonthlyCatalogLoader.load({request,days,...options,onEvent:event=>{
            const title=names[event.group];if(initializing)window.MonthlyStartupScreen?.step(event.group,event.state==='ready'?'ready':event.state==='error'?'error':'loading');
            if(event.state==='loading')MonthlyLoadLog.step(logId,title+' · GET '+event.url);
            if(event.state==='response')MonthlyLoadLog.step(logId,title+' · HTTP '+event.status+' · '+t('请求ID','Request ID')+': '+(event.requestId||'—'));
            if(event.state==='ready'){MonthlyLoadLog.step(logId,title+' · '+event.count+' '+t('张表，已可使用','tables ready'));for(const stage of event.stages)MonthlyLoadLog.step(logId,stage.stage+' · '+stage.count+' · '+stage.durationMs+'ms');for(const error of event.errors)MonthlyLoadLog.step(logId,title+' · '+error.code+' · '+(error.id||''));}
            if(event.state==='error')MonthlyLoadLog.step(logId,title+' · '+t('失败：','Failed: ')+event.message);
        }});
    }
    async function refresh(retryGroups){
        librarySearch.reset();
        const initialLoad=initializing,refreshId=++libraryRefreshId,days=libraryDays,logId=MonthlyLoadLog.start(t('资料库加载 · ','Library loading · ')+(days?t('最近 '+days+' 天','Last '+days+' days'):t('全部历史','All history')));libraryLoading=true;document.getElementById('sourceLibrary').setAttribute('aria-busy','true');status(t('正在刷新资料库…','Refreshing source library…'));loadAuxiliaryConfig();
        const apply=data=>{if(refreshId!==libraryRefreshId)return;directoryCatalog=data;catalog=window.MonthlyCatalogLoader.combine([catalog,data]);library();document.getElementById('sourceLibrary').setAttribute('aria-busy','true');};
        try{
            const data=await loadCatalog(days,logId,{previous:directoryCatalog,history:!!current.libraryPrefs?.advanced,retryGroups:retryGroups||window.MonthlyCatalogLoader.groups,onProgress:apply});if(initialLoad&&initializationCancelled)throw new Error(t('已停止加载，可重新载入月报或刷新数据库数据','Loading stopped; load a report or refresh the database to retry'));if(refreshId!==libraryRefreshId)return;
            directoryCatalog=data;loadedDays=days;catalog=!catalogComplete||!days?data:window.MonthlyCatalogLoader.combine([catalog,data]);catalogComplete=catalogComplete||days===0&&current.libraryPrefs?.advanced&&!data.failedGroups.length;
            libraryError=data.failedGroups.length?data.failedGroups.map(group=>directoryNames()[group]).join('、'):(data.diagnostics.errors.length?t('部分记录无法读取','Some records could not be read'):'');
            libraryLoading=false;library();document.getElementById('sourceLibrary').setAttribute('aria-busy','false');
            MonthlyLoadLog.finish(logId,libraryError||undefined);status(libraryError?t('部分来源加载失败，其他数据可正常使用：','Some sources failed; other data remains usable: ')+libraryError:t('资料库已刷新；当前月报数据保持不变。可检查月报数据更新。','Library refreshed; report data retained. Check report updates to apply new versions.'));return data;
        }catch(error){if(refreshId===libraryRefreshId){libraryLoading=false;libraryError=initialLoad&&initializationCancelled?'':error.message;document.getElementById('sourceLibrary').setAttribute('aria-busy','false');MonthlyLoadLog.finish(logId,error.message);status(initialLoad&&initializationCancelled?t('已停止加载，可重新载入月报或刷新数据库数据','Loading stopped; load a report or refresh the database to retry'):t('资料库加载失败：','Library load failed: ')+error.message);library();}throw error;}
    }
    function meetingReferences(){return [...new Set(current.sections.flatMap(section=>section.blocks.flatMap(block=>S.references(block).flatMap(({value})=>[value.fileId,value.reference?.versionId]))).filter(id=>typeof id==='string'&&/^ms-[\w-]+-\d{4}-\d{2}-(qr|rfc|wfm|offline|online)$/.test(id)))].slice(0,64);}
    async function ensureReferencedCatalog(){
        if(catalogComplete||initializing&&!directoryCatalog)return;const missing=current.sections.some(section=>section.blocks.some(block=>!block.savedData&&(S.references(block).some(({key,value})=>{try{return key==='binding'?(()=>{const match=engine.resolve(value,{...catalog,reportMonth:engine.documentMonth(current)});return !match||block.type!=='metric'&&match.metric?.fileIds?.some(id=>!catalog.files.some(file=>file.id===id));})():value.reference?!S.resolve(value.reference,catalog,engine.documentMonth(current)):!catalog.files.some(file=>file.id===value.fileId);}catch(_){return true;}}))));
        const inlineMissing=!current.inlineData&&[current.title,current.footer,...current.meta.flatMap(item=>[item.label,item.value]),...current.sections.flatMap(section=>[section.title,...section.blocks.flatMap(block=>[block.title,block.text,block.rule])])].some(pair=>Object.values(pair||{}).some(text=>engine.metricTextParts(text,inlineCatalog()).some(part=>part.missing||part.error)));
        if(!missing&&!inlineMissing)return;const logId=MonthlyLoadLog.start(t('补充月报引用索引','Loading report reference index'));try{catalog=await loadCatalog(0,logId,{meetingFileIds:meetingReferences()});catalogComplete=false;MonthlyLoadLog.step(logId,t('历史索引仅用于解析月报引用，左侧仍按加载天数展示','History index resolves report references; sidebar still uses its day range'));MonthlyLoadLog.finish(logId);}catch(error){MonthlyLoadLog.finish(logId,error.message);status(error.message);}
    }


    async function exportLogo(source){
        const response=await fetch(source,{credentials:'same-origin'});if(!response.ok)throw new Error(t('Logo 读取失败，请重试','Logo could not be loaded; please retry'));
        const url=URL.createObjectURL(await response.blob());
        try{
            const image=new Image();image.src=url;await image.decode();
            const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
            canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
            canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
            return canvas.toDataURL('image/png');
        }finally{URL.revokeObjectURL(url);}
    }
    async function alignExportCards(clone,css){
        // Compare visible row peers, then equalize their clean output heights after tools disappear.
        const groups=[];
        root.querySelectorAll('.document-blocks').forEach(grid=>{
            const peers=Array.from(grid.querySelectorAll(':scope>.document-block:not(.export-empty)'),element=>({id:element.dataset.cardId,rect:element.getBoundingClientRect()}));
            const taken=new Set();for(const peer of peers){if(taken.has(peer.id))continue;const matches=peers.filter(other=>!taken.has(other.id)&&Math.abs(other.rect.top-peer.rect.top)<2&&Math.abs(other.rect.height-peer.rect.height)<2);matches.forEach(other=>taken.add(other.id));if(matches.length>1)groups.push(matches.map(other=>other.id));}
        });
        if(!groups.length)return;
        const frame=document.createElement('iframe');frame.setAttribute('data-controls','');frame.setAttribute('aria-hidden','true');frame.style.cssText=`position:fixed;left:-100000px;top:0;width:${clone.style.width};height:1000px;border:0;pointer-events:none`;document.body.append(frame);
        try{
            const doc=frame.contentDocument;doc.open();doc.write(outputHtml(clone,css));doc.close();await doc.fonts.ready;await Promise.all(Array.from(doc.images,image=>image.decode()));
            for(const ids of groups){const elements=ids.map(id=>doc.querySelector(`[data-card-id="${id}"]`)).filter(element=>element&&getComputedStyle(element).display!=='none');if(elements.length<2)continue;const height=Math.max(...elements.map(element=>element.getBoundingClientRect().height));for(const element of elements){const target=clone.querySelector(`[data-card-id="${element.dataset.cardId}"]`);target.style.minHeight=height+'px';}}
        }finally{frame.remove();}
    }
    async function waitForOutput(){
        if(!pendingBlocks.size){await renderPromise;return;}
        const waiting=renderPromise,blocks=[...pendingBlocks.values()],canUse=blocks.every(block=>lastResults.has(block.id)||block.savedData||block.previousData);
        dialog.innerHTML=`<h3>${t('部分组件仍在读取数据','Some components are still loading')}</h3><p>${t('可继续等待；有保存结果时，也可以停止读取并使用上次结果。','Continue waiting, or stop reading and use saved results when available.')}</p><ul>${blocks.map(block=>`<li>${escape(pair(block.title)||typeName(block.type))}</li>`).join('')}</ul><footer><button data-output-cancel>${t('取消本次操作','Cancel this action')}</button><button data-output-saved ${canUse?'':'disabled'}>${t('停止读取，使用保存结果','Stop reading; use saved results')}</button></footer>`;
        dialog.showModal();
        let cancelled=false;
        await new Promise(resolve=>{
            const close=()=>{cancelled=true;resolve();};dialog.addEventListener('cancel',close,{once:true});
            dialog.querySelector('[data-output-cancel]').onclick=()=>{cancelled=true;resolve();};
            dialog.querySelector('[data-output-saved]').onclick=()=>{const urls=new Set(blocks.flatMap(block=>[...(pendingBlockUrls.get(block.id)||[])]));transport.cancelReads(t('已停止读取，使用保存结果','Reading stopped; using saved results'),url=>urls.has(url));waiting.then(()=>{for(const block of blocks)for(const item of (block.savedData||block.previousData)?.resources||[])cache.set(item.url,Promise.resolve(item.data));});};
            waiting.finally(()=>{dialog.removeEventListener('cancel',close);resolve();});
        });
        dialog.close();if(cancelled)throw new Error(t('已取消本次操作，数据仍在后台加载','Action cancelled; data continues loading'));
    }
    async function exportDocument(){
        await waitForOutput();updateEmptyState();const clone=root.cloneNode(true);clone.querySelectorAll('.metric-inspected').forEach(node=>{node.classList.remove('metric-inspected');node.removeAttribute('data-inspect-color');});clone.classList.add('document-export');
            // Export the rendered page width, including any editor shrinkage on narrow screens.
            clone.style.width=root.getBoundingClientRect().width+'px';clone.style.maxWidth='none';clone.style.flex='none';
            const typography=getComputedStyle(root);clone.style.fontFamily=typography.fontFamily;clone.style.fontSize=typography.fontSize;
            clone.style.setProperty('--document-default-font-size',`${current.defaultFontSize||16}px`);
            clone.querySelectorAll('.document-meta-cell,.document-section,.document-block').forEach(element=>{const original=root.querySelector(element.dataset.metaId?`[data-meta-id="${element.dataset.metaId}"].document-meta-cell`:element.dataset.cardId?`[data-card-id="${element.dataset.cardId}"]`:`#${element.id}`);if(original){const style=getComputedStyle(original);element.style.setProperty('grid-column',style.gridColumn,'important');element.style.padding=style.padding;}});
            clone.querySelectorAll('.inline-metric').forEach(element=>{element.replaceChildren(document.createTextNode(element.textContent));element.removeAttribute('data-metric-token');element.removeAttribute('title');element.classList.remove('inline-metric','inline-formula');element.removeAttribute('data-formula-id');});clone.querySelectorAll('.document-source-note').forEach(note=>{note.textContent=note.dataset.sourceDate||'';note.removeAttribute('data-source-date');});clone.querySelectorAll('[data-controls]').forEach(el=>el.remove());clone.querySelectorAll('[contenteditable]').forEach(el=>{el.removeAttribute('contenteditable');el.removeAttribute('data-placeholder');el.removeAttribute('data-field');});const logo=clone.querySelector('.document-masthead img');if(logo&&current.logo){logo.src=await exportLogo(current.logo);logo.removeAttribute('hidden');}const css=await fetch('/css/monthly-designer.css?v=20261011-53').then(res=>res.text());
        clone.style.padding=typography.padding;
        await alignExportCards(clone,css);
        return {clone,css};
    }
    function outputHtml(clone,css){return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(pair(current.title))}</title><style>${css}</style></head><body>${clone.outerHTML}</body></html>`;}
    async function outputFrame(){
        const {clone,css}=await exportDocument(),frame=document.createElement('iframe');
        frame.setAttribute('data-controls','');frame.setAttribute('aria-hidden','true');frame.style.cssText=`position:fixed;left:-100000px;top:0;width:${clone.style.width};height:1000px;border:0;pointer-events:none`;
        document.body.append(frame);
        try{
            const doc=frame.contentDocument;doc.open();doc.write(outputHtml(clone,css));doc.close();
            await Promise.all(Array.from(doc.images,image=>image.decode().catch(()=>{})));await doc.fonts.ready;
            const report=doc.getElementById('monthlyDocument'),width=Math.ceil(report.getBoundingClientRect().width),height=Math.ceil(report.getBoundingClientRect().height);
            frame.style.height=height+'px';
            const printStyle=doc.createElement('style');printStyle.textContent=`@media print{@page{size:${width}px ${height+4}px;margin:0}html,body{margin:0;padding:0;min-height:0}.monthly-document{margin:0;box-shadow:none}}`;doc.head.append(printStyle);
            return {frame,report,width,height};
        }catch(error){frame.remove();throw error;}
    }
    async function visualExport(action){
        status(t('正在生成导出文件…','Preparing export…'));const output=await outputFrame();
        const name=current.name.replace(/[\\/:*?"<>|]/g,'_');
        try{
            if(action==='print'){
                output.frame.contentWindow.addEventListener('afterprint',()=>output.frame.remove(),{once:true});
                try{output.frame.contentWindow.focus();output.frame.contentWindow.print();status(t('已打开月报打印窗口','Report print window opened'));}catch(error){output.frame.remove();throw error;}return;
            }
            const scale=Math.min(2,16384/Math.max(output.width,output.height),Math.sqrt(32000000/(output.width*output.height)));
            const canvas=await html2canvas(output.report,{scale,logging:false,backgroundColor:'#fff',useCORS:true,windowWidth:output.width,windowHeight:output.height,scrollX:0,scrollY:0});
            if(action==='image'){
                const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error(t('图片生成失败','Image generation failed'));download(blob,name+'.png');
            }else{
                const factor=Math.min(.75,14400/Math.max(output.width,output.height)),width=output.width*factor,height=output.height*factor;
                const pdf=new window.jspdf.jsPDF({orientation:width>height?'landscape':'portrait',unit:'pt',format:[width,height],compress:true});
                pdf.addImage(canvas,'PNG',0,0,width,height);download(pdf.output('blob'),name+'.pdf');
            }
            status(t('导出成功','Export complete'));
        }finally{if(action!=='print')output.frame.remove();}
    }
    async function buildEmailWorkbook(reportName) {
        if (typeof window.ExcelJS === 'undefined') return null;
        try {
            const workbook = new window.ExcelJS.Workbook();
            workbook.creator = 'Tools Platform · 护网与网络安全月报';
            workbook.created = new Date();
            const metaSheet = workbook.addWorksheet(t('月报概览', 'Overview'));
            metaSheet.addRow([t('报告名称', 'Report Name'), pair(current.title) || current.name]);
            if (current.meta && current.meta.length) {
                current.meta.forEach(m => {
                    const label = pair(m.label);
                    const val = pair(m.value);
                    if (label || val) metaSheet.addRow([label, val]);
                });
            }
            metaSheet.getRow(1).font = { bold: true };
            metaSheet.getColumn(1).width = 24;
            metaSheet.getColumn(2).width = 65;

            let sheetIdx = 1;
            const tables = root.querySelectorAll('table.document-table, table.document-pivot-table, table.document-duty-table, .document-block table');
            const usedNames = new Set([t('月报概览', 'Overview')]);
            tables.forEach(table => {
                const block = table.closest('.document-block');
                const blockTitle = block?.querySelector(':scope > h3')?.textContent?.trim() || `${t('数据表', 'Table')}_${sheetIdx}`;
                let sheetName = blockTitle.replace(/[\\/*?:\[\]]/g, '').slice(0, 28) || `${t('数据表', 'Table')}_${sheetIdx}`;
                if (usedNames.has(sheetName)) sheetName = `${sheetName}_${sheetIdx}`;
                usedNames.add(sheetName);
                sheetIdx++;

                const sheet = workbook.addWorksheet(sheetName);
                const headerRow = [];
                table.querySelectorAll('thead tr th, thead tr td, tr:first-child th').forEach(cell => {
                    headerRow.push(cell.textContent.trim());
                });
                if (headerRow.length) {
                    sheet.addRow(headerRow);
                    sheet.getRow(1).font = { bold: true };
                    sheet.views = [{ state: 'frozen', ySplit: 1 }];
                }
                const bodyRows = table.querySelectorAll('tbody tr');
                const rowElements = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')).slice(headerRow.length ? 1 : 0);
                rowElements.forEach(tr => {
                    const rowData = [];
                    tr.querySelectorAll('td, th').forEach(cell => {
                        const text = cell.textContent.trim();
                        const rawNum = text.replace(/[,，%]/g, '');
                        const num = Number(rawNum);
                        rowData.push(Number.isFinite(num) && rawNum !== '' && !/^0\d+/.test(rawNum) ? num : text);
                    });
                    if (rowData.some(v => v !== '')) sheet.addRow(rowData);
                });
                headerRow.forEach((_, i) => { sheet.getColumn(i + 1).width = Math.max(16, Math.min(45, (headerRow[i]?.length || 10) * 2 + 4)); });
                if (headerRow.length) {
                    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headerRow.length } };
                }
            });

            const bytes = await workbook.xlsx.writeBuffer();
            return { filename: `${reportName}_原始数据.xlsx`, bytes };
        } catch (err) {
            console.warn('[buildEmailWorkbook error]', err);
            return null;
        }
    }
    async function prepareEmailClone(clone) {
        const sectionGrid=clone.querySelector('.document-sections');if(sectionGrid){sectionGrid.style.display='block';sectionGrid.style.width='100%';}
        window.ReportMsgExport.preserveStyles(clone);
        const masthead=clone.querySelector('.document-masthead');
        if(masthead){
            // Flex alignment is not carried into Word/WPS HTML: encode each row explicitly.
            const table=document.createElement('table');table.setAttribute('role','presentation');table.setAttribute('width','100%');table.setAttribute('cellpadding','0');table.setAttribute('cellspacing','0');table.style.cssText=masthead.style.cssText;table.style.display='table';table.style.width='100%';table.style.borderCollapse='collapse';table.style.padding='0';
            for(const child of Array.from(masthead.children)){
                const cell=table.insertRow().insertCell();cell.setAttribute('align',child.tagName==='IMG'?current.logoAlign||'center':'center');cell.style.textAlign=cell.getAttribute('align');cell.style.padding=child.tagName==='IMG'?'18px 0 12px':'0 0 18px';cell.style.width='100%';
                if(child.tagName==='IMG'){child.style.display='inline-block';child.style.margin='0';child.style.width=current.logoWidth+'px';child.setAttribute('width',String(current.logoWidth));child.style.height='auto';}else{child.style.width='100%';child.style.margin='0';child.style.height='auto';}
                cell.append(child);
            }
            masthead.replaceWith(table);
        }
        clone.querySelectorAll('.document-section-head').forEach(head=>{
            const table=document.createElement('table');table.setAttribute('role','presentation');table.setAttribute('width','100%');table.setAttribute('cellpadding','0');table.setAttribute('cellspacing','0');table.style.cssText=head.style.cssText;table.style.display='table';table.style.width='100%';table.style.height='auto';table.style.tableLayout='fixed';table.style.borderCollapse='collapse';table.style.padding='0';
            const row=table.insertRow(),number=row.insertCell(),title=row.insertCell(),balance=row.insertCell();
            for(const cell of [number,balance]){cell.setAttribute('width','36');cell.style.width='36px';cell.style.padding='10px 6px';cell.style.verticalAlign='middle';}
            const heading=head.querySelector('h2');number.textContent=head.querySelector(':scope > span')?.textContent||'';number.style.fontSize='12px';title.setAttribute('align','center');title.style.textAlign='center';title.style.padding='10px 0';title.style.verticalAlign='middle';
            if(heading){heading.style.width='100%';heading.style.maxWidth='none';heading.style.height='auto';heading.style.margin='0';heading.style.textAlign='center';heading.style.whiteSpace='normal';heading.querySelectorAll('.document-edit').forEach(el=>{el.style.width='100%';el.style.height='auto';el.style.textAlign=el.style.textAlign||'center';});title.append(heading);}
            head.replaceWith(table);
        });
        const chartSvgs = Array.from(clone.querySelectorAll('svg.document-chart, svg'));
        for (const svg of chartSvgs) {
            try {
                const block = svg.closest('.document-block');
                const cardId = block?.dataset?.cardId;
                const liveSvg = cardId ? root.querySelector(`[data-card-id="${cardId}"] svg`) : null;
                const targetSvg = liveSvg || svg;
                const bbox = targetSvg.getBoundingClientRect ? targetSvg.getBoundingClientRect() : {};
                const width = Math.max(320, Math.ceil(bbox.width || targetSvg.viewBox?.baseVal?.width || 640));
                const height = Math.max(160, Math.ceil(bbox.height || targetSvg.viewBox?.baseVal?.height || 260));

                let dataUrl = null;
                if (typeof window.html2canvas === 'function' && targetSvg.parentElement) {
                    const canvas = await window.html2canvas(targetSvg.parentElement, {
                        scale: 2,
                        backgroundColor: '#ffffff',
                        logging: false
                    }).catch(() => null);
                    if (canvas) dataUrl = canvas.toDataURL('image/png');
                }
                if (!dataUrl) {
                    const xml = new XMLSerializer().serializeToString(targetSvg);
                    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
                    const url = URL.createObjectURL(svgBlob);
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
                    const canvas = document.createElement('canvas');
                    canvas.width = width * 2; canvas.height = height * 2;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    URL.revokeObjectURL(url);
                    dataUrl = canvas.toDataURL('image/png');
                }
                if (dataUrl) {
                    const imgTag = document.createElement('img');
                    imgTag.src = dataUrl;
                    imgTag.setAttribute('width', String(width));
                    imgTag.style.cssText = `display:block;width:100%;max-width:${width}px;height:auto;margin:8px auto;border:none;`;
                    svg.replaceWith(imgTag);
                }
            } catch (e) {
                console.warn('[SVG conversion to img]', e);
            }
        }

        const metaGrid = clone.querySelector('.document-meta, .document-meta-grid');
        if (metaGrid) {
            clone.querySelectorAll('.document-meta-toolbar, [data-controls]').forEach(el => el.remove());
            const cells = Array.from(metaGrid.querySelectorAll('.document-meta-cell'));
            if (cells.length) {
                const table = document.createElement('table');
                table.setAttribute('role', 'presentation');
                table.setAttribute('width', '100%');
                table.setAttribute('cellpadding', '0');
                table.setAttribute('cellspacing', '0');
                table.setAttribute('border', '0');
                table.style.cssText = 'width:100%;border-collapse:collapse;border-spacing:0;margin:14px 0;box-sizing:border-box;';
                const tbody = document.createElement('tbody');
                table.appendChild(tbody);
                const columns=document.createElement('colgroup');for(let index=0;index<12;index++){const col=document.createElement('col');col.setAttribute('width','8.333%');columns.appendChild(col);}table.prepend(columns);table.style.tableLayout='fixed';

                let currentRow = document.createElement('tr');
                let currentSpan = 0;
                cells.forEach(cell => {
                    const metaId = cell.dataset.metaId;
                    const metaDef = current.meta?.find(m => m.id === metaId);
                    const span = Number(cell.style.gridColumn.match(/span\s+(\d+)/)?.[1]) || metaDef?.span || 4;
                    if (currentSpan + span > 12 && currentSpan > 0) {
                        tbody.appendChild(currentRow);
                        currentRow = document.createElement('tr');
                        currentSpan = 0;
                    }
                    const td = document.createElement('td');
                    const widthPct = Math.round((span / 12) * 100);
                    td.setAttribute('width', `${widthPct}%`);td.colSpan=span;
                    td.style.cssText = `width:${widthPct}%;vertical-align:top;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px;box-sizing:border-box;`;
                    td.style.padding='0';td.style.backgroundColor='#ffffff';
                    const inner=document.createElement('table');inner.setAttribute('role','presentation');inner.setAttribute('width','100%');inner.setAttribute('cellpadding','0');inner.setAttribute('cellspacing','0');inner.style.cssText='width:100%;border-collapse:collapse;';
                    const row=inner.insertRow();
                    for(const selector of ['.document-meta-label','.document-meta-value']){
                        const original=cell.querySelector(selector);if(!original)continue;
                        const valueCell=row.insertCell();
                        if(selector==='.document-meta-label'){const width=Math.round(parseFloat(getComputedStyle(original).width))||90;valueCell.setAttribute('width',String(width));valueCell.style.width=width+'px';valueCell.style.backgroundColor=original.style.backgroundColor;valueCell.style.verticalAlign='middle';}
                        original.style.display='block';valueCell.appendChild(original);
                    }
                    td.appendChild(inner);
                    currentRow.appendChild(td);
                    currentSpan += span;
                });
                if (currentRow.childNodes.length) tbody.appendChild(currentRow);
                const wrapperParent = metaGrid.closest('.document-meta-wrapper') || metaGrid;
                wrapperParent.replaceWith(table);
            }
        }

        // Named bookmarks are understood by email editors that ignore IDs on tables.
        const emailTargets=new Map();clone.querySelectorAll('.document-section').forEach((section,index)=>{
            const id=section.id,name='mr_section_'+(index+1),bookmark=document.createElement('a');bookmark.name=name;bookmark.id=name;bookmark.style.cssText='font-size:1px;line-height:0;text-decoration:none;';
            (section.querySelector('h2 .document-edit')||section.querySelector('h2')||section).prepend(bookmark);emailTargets.set('#'+id,'#'+name);section.removeAttribute('id');
        });
        clone.querySelectorAll('a[href]').forEach(link=>{const target=emailTargets.get(link.getAttribute('href'));if(target)link.setAttribute('href',target);});

        const navigation=clone.querySelector('.document-nav');
        if(navigation){
            const table=document.createElement('table');table.setAttribute('role','presentation');table.setAttribute('width','100%');table.setAttribute('cellpadding','0');table.setAttribute('cellspacing','0');table.style.cssText='width:100%;table-layout:fixed;border-collapse:collapse;margin:14px 0;';
            for(const row of navigation.querySelectorAll('.document-nav-row')){
                const links=Array.from(row.querySelectorAll('a'));const tr=table.insertRow();
                for(const link of links){const td=tr.insertCell();td.setAttribute('width',(100/links.length)+'%');td.style.padding='3px';link.style.display='block';link.style.width='auto';link.style.textAlign='center';link.style.lineHeight=link.style.height || '36px';td.appendChild(link);}
            }
            navigation.replaceWith(table);
        }

        const sections = Array.from(clone.querySelectorAll('.document-section'));
        sections.forEach(section => {
            section.style.cssText = 'display:block;width:100%;margin-bottom:12px;';
            const blocksContainer = section.querySelector('.document-blocks');
            if (blocksContainer) {
                const blocks = Array.from(blocksContainer.querySelectorAll(':scope > .document-block:not(.export-empty)'));
                if (blocks.length) {
                    const table = document.createElement('table');
                    table.setAttribute('role', 'presentation');
                    table.setAttribute('width', '100%');
                    table.setAttribute('cellpadding', '0');
                    table.setAttribute('cellspacing', '0');
                    table.setAttribute('border', '0');
                    table.style.cssText = 'width:100%;border-collapse:separate;border-spacing:12px 12px;margin:0;box-sizing:border-box;';
                    const tbody = document.createElement('tbody');
                    table.appendChild(tbody);
                    const columns=document.createElement('colgroup');for(let index=0;index<12;index++){const col=document.createElement('col');col.setAttribute('width','8.333%');columns.appendChild(col);}table.prepend(columns);table.style.tableLayout='fixed';

                    let currentRow = document.createElement('tr');
                    let currentSpan = 0;
                    blocks.forEach(block => {
                        const cardId = block.dataset.cardId;
                        let span = 12;
                        for (const s of current.sections) {
                            const b = s.blocks.find(item => item.id === cardId);
                            if (b) { span = b.span || 12; break; }
                        }
                        if (currentSpan + span > 12 && currentSpan > 0) {
                            tbody.appendChild(currentRow);
                            currentRow = document.createElement('tr');
                            currentSpan = 0;
                        }
                        const td = document.createElement('td');
                        const widthPct = Math.round((span / 12) * 100);
                        td.setAttribute('width', `${widthPct}%`);td.colSpan=span;
                        td.style.cssText = `width:${widthPct}%;vertical-align:top;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:${block.style.padding||'10px'};box-sizing:border-box;height:${block.style.minHeight||'auto'};`;

                        while (block.firstChild) {
                            td.appendChild(block.firstChild);
                        }
                        currentRow.appendChild(td);
                        currentSpan += span;
                    });
                    if (currentRow.childNodes.length) tbody.appendChild(currentRow);
                    blocksContainer.replaceWith(table);
                }
            }
        });

        clone.querySelectorAll('table').forEach(table=>{
            if(!table.hasAttribute('cellspacing'))table.setAttribute('cellspacing','0');
            if(!table.hasAttribute('cellpadding'))table.setAttribute('cellpadding','0');
        });

        clone.querySelectorAll('.document-block-text').forEach(el=>{
            if(!el.style.fontSize)el.style.fontSize=`${current.defaultFontSize||16}px`;
            // Keep the captured page line height instead of adding mail-only typography.
        });
        clone.querySelectorAll('.document-block h3, td > h3').forEach(el=>{
            if(!el.style.fontSize)el.style.fontSize=`${current.defaultFontSize||16}px`;
            if(!el.style.fontWeight)el.style.fontWeight='700';
            if(!el.style.color)el.style.color='#233f5c';
            if(!el.style.margin)el.style.margin='0 0 8px';
            // Preserve the page's title line height.
        });
        clone.querySelectorAll('.document-section h2, .document-section-head h2').forEach(el=>{
            if(!el.style.fontSize)el.style.fontSize=`${Math.max(18,(current.defaultFontSize||16)+2)}px`;
        });

        return clone;
    }
    async function exportMsg(){
        if (!window.ReportMsgExport) throw new Error(t('MSG 邮件导出组件未就绪，请刷新页面后重试', 'MSG export helper not loaded; please refresh'));
        status(t('正在准备月报 MSG 邮件导出…', 'Preparing MSG email export…'));
        const { clone } = await exportDocument();
        const emailWidth=parseFloat(clone.style.width)||current.pageWidth||1280;clone.style.display='block';clone.style.maxWidth='none';clone.style.margin='0 auto';clone.style.visibility='visible';
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `position:fixed;left:-100000px;top:0;width:${emailWidth}px;background:#ffffff;pointer-events:none;`;
        wrapper.appendChild(clone);
        document.body.appendChild(wrapper);
        try {
            await prepareEmailClone(clone);
            const rawName = current.name.replace(/[\\/:*?"<>|]/g, '_');
            const titleText = pair(current.title) || current.name;
            const monthMeta = current.meta?.find(m => m.id === 'meta-month' || m.id === 'meta-period');
            const month = pair(monthMeta?.value) || '';
            const subject = month ? `${titleText}（${month}）` : titleText;
            const filename = `${rawName}.msg`;
            const attachment = await buildEmailWorkbook(rawName);
            await window.ReportMsgExport.download(clone, subject, filename, attachment);
            status(t('月报 MSG 邮件导出完成！', 'Monthly report MSG email exported successfully!'));
        } finally {
            wrapper.remove();
        }
    }
    async function runAction(action){
        root.querySelectorAll('.document-edit').forEach(commitText);
        document.activeElement?.blur();
        if(action==='language'){language=language==='zh'?'en':'zh';library();await render();await listDocuments();return;}
        if(action==='undo'){if(history.length){current=history.pop();dirty=true;restoreLibrary();render();}return;}
        if(action==='delete-reports')return window.MonthlyReportManager.open({request,t,escape,currentId:current.id,onDeleted:async ids=>{
            if(ids.includes(current.id)){delete current.id;dirty=true;}
            for(const entry of history)if(ids.includes(entry.id))delete entry.id;
            const message=t('已删除 '+ids.length+' 份服务器月报；当前编辑内容保留','Deleted '+ids.length+' server reports; current editing content retained');
            try{await listDocuments();status(message);}catch(error){document.getElementById('documentList').value=current.id||'';status(message+t('；列表刷新失败，请重试刷新：','; list refresh failed; retry refreshing: ')+error.message);}
        }});
        if(action==='template')return window.MonthlyTemplateControls.open({request,t,status,capture:()=>window.MonthlyTemplates.capture(current,catalog)});
        if(action==='new'){
            let template=null;
            try{const saved=await request('/api/upload/monthly-default-template');template=saved?.template;}catch(error){console.warn('[MonthlyDesigner] Failed to fetch default template:',error);}
            checkpoint();current=createFromDefault(template);window.MonthlyCharts.resetPanels();await ensureReferencedCatalog();restoreLibrary();await render();document.getElementById('documentList').value='';status(templateWarning||t('已使用默认模板新建月报，尚未保存','New report created from the default template; unsaved'));return;
        }
        if(action==='save'){
            if(saving)return false;
            const toolbar=document.querySelector('.designer-toolbar'),button=toolbar.querySelector('[data-action=save]');
            saving=true;root.inert=true;toolbar.inert=true;button.disabled=true;
            button.textContent=t('正在保存…','Saving…');status(t('正在保存到服务器…','Saving to server…'));
            try{
                await waitForOutput();captureData();let draft=engine.normalize(engine.prepareMonthlySave(current,engine.documentMonth(current))),previous=null;
                if(draft.id){
                    const stored=await request(`/api/upload/monthly-documents/${encodeURIComponent(draft.id)}`);
                    if(draft.reportMonth&&engine.documentMonth(stored.document)!==draft.reportMonth)delete draft.id;else previous=stored.document;
                }
                draft=engine.nextSaveVersion(draft,previous);
                const result=await request('/api/upload/monthly-documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
                current=engine.normalize(result.document);window.MonthlyCharts.resetPanels();dirty=false;await render();
                const message=t('月报已成功保存到服务器','Report saved successfully to server');
                status(message);window.showToast(message,'success');
                try{await listDocuments();}catch(error){status(message+t('；月报列表刷新失败：','; report list refresh failed: ')+error.message);}
                return true;
            }catch(error){
                const message=t('保存失败：','Save failed: ')+error.message;
                status(message);window.showToast(message,'error');
                return false;
            }finally{saving=false;root.inert=false;toolbar.inert=false;button.disabled=false;actions();}
            return;
        }
        if(action==='refresh')return refresh();
        if(action==='check-updates')return checkUpdates();
        if(action==='add-section'){checkpoint();current.sections.push(engine.section());return render();}
        if(action==='layout')return editLayout();
        if(action==='project'){download(new Blob([JSON.stringify({fileType:'monthly-document-project',document:engine.normalize(current)},null,2)],{type:'application/json'}),`${current.name.replace(/[\\/:*?"<>|]/g,'_')}.json`);return;}
        if(action==='html'){const {clone,css}=await exportDocument();download(new Blob([outputHtml(clone,css)],{type:'text/html'}),`${current.name.replace(/[\\/:*?"<>|]/g,'_')}.html`);return;}
        if(action==='msg')return exportMsg();
        if(['print','pdf','image'].includes(action))await visualExport(action);
    }
    document.querySelector('.designer-toolbar').onclick=event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(action)runAction(action).catch(error=>status(error.message));};
    function confirmReportSwitch(name){
        const prompt=document.createElement('dialog');prompt.className='report-switch-dialog';prompt.setAttribute('aria-labelledby','reportSwitchTitle');prompt.setAttribute('aria-describedby','reportSwitchDescription');
        prompt.innerHTML=`<span class="report-switch-eyebrow">${t('切换月报','SWITCH REPORT')}</span><h3 id="reportSwitchTitle">${t('保存当前月报的修改？','Save changes to this report?')}</h3><p id="reportSwitchDescription">${t('当前月报有未保存的修改。保存后即可切换，或放弃修改直接打开所选月报。','This report has unsaved changes. Save before switching, or discard them to open the selected report.')}</p><div class="report-switch-target"><small>${t('即将打开','Opening next')}</small><strong>${escape(name)}</strong></div><footer><button type="button" data-switch-choice="cancel" autofocus>${t('取消','Cancel')}</button><button type="button" data-switch-choice="discard">${t('不保存切换','Discard & switch')}</button><button type="button" data-switch-choice="save">${t('保存并切换','Save & switch')}</button></footer>`;
        document.body.append(prompt);prompt.showModal();
        return new Promise(resolve=>{const finish=choice=>{prompt.close();prompt.remove();resolve(choice);};prompt.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');},{once:true});prompt.onclick=event=>{const choice=event.target.closest('[data-switch-choice]')?.dataset.switchChoice;if(choice)finish(choice);};});
    }
    let switchingReport=false;
    document.getElementById('documentList').onchange=async event=>{
        const select=event.target,id=select.value,name=select.selectedOptions[0]?.textContent||'';
        select.value=current.id||'';
        if(!id||id===current.id||switchingReport||saving)return;
        switchingReport=true;select.disabled=true;
        try{
            root.querySelectorAll('.document-edit').forEach(commitText);document.activeElement?.blur();
            if(dirty){const choice=await confirmReportSwitch(name);if(choice==='cancel')return;if(choice==='save'&&!await runAction('save'))return;}
            root.inert=true;document.querySelector('.designer-toolbar').inert=true;status(t('正在载入所选月报…','Loading selected report…'));
            const result=await request(`/api/upload/monthly-documents/${encodeURIComponent(id)}`),next=engine.normalize(result.document);
            const previous=current,previousDirty=dirty,previousHistory=history.slice();
            checkpoint();current=next;window.MonthlyCharts.resetPanels();dirty=false;
            try{await ensureReferencedCatalog();restoreLibrary();await render();}
            catch(error){current=previous;dirty=previousDirty;history.splice(0,history.length,...previousHistory);window.MonthlyCharts.resetPanels();restoreLibrary();await render();throw error;}
            select.value=current.id;status(t('已载入服务器月报','Stored report loaded'));
        }catch(error){status(t('切换月报失败：','Report switch failed: ')+error.message);window.showToast(error.message,'error');}
        finally{select.value=current.id||'';select.disabled=false;root.inert=false;document.querySelector('.designer-toolbar').inert=false;switchingReport=false;}
    };
    document.getElementById('projectImport').onchange=async event=>{try{const project=JSON.parse(await event.target.files[0].text());if(project.fileType!=='monthly-document-project')throw new Error(t('无效的工程文件','Invalid project file'));const document=engine.normalize(project.document);checkpoint();delete document.id;current=document;window.MonthlyCharts.resetPanels();await ensureReferencedCatalog();restoreLibrary();await render();status(t('工程已载入，引用数据按当前租户资料库解析','Project loaded; bindings resolve in this tenant'));}catch(error){status(error.message);}finally{event.target.value='';}};
    window.addEventListener('tools:languagechange',()=>{language=window.ToolsI18n?.getLanguage()==='en-US'?'en':'zh';library();render();listDocuments().catch(error=>status(error.message));});
    window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
    window.MonthlyDesigner={getDocument:()=>clone(current),getCatalog:()=>clone(catalog),applyDocument:async document=>{current=engine.normalize(document);await ensureReferencedCatalog();window.MonthlyCharts.resetPanels();restoreLibrary();return render();},refresh,whenRendered:()=>renderPromise};
    async function waitStartupAssets(){
        const image=root.querySelector('.document-masthead img'),cleanup=[];
        const logo=image&&!image.complete?new Promise(resolve=>{const loaded=()=>resolve(true),failed=()=>resolve(false);image.addEventListener('load',loaded,{once:true});image.addEventListener('error',failed,{once:true});cleanup.push(()=>{image.removeEventListener('load',loaded);image.removeEventListener('error',failed);});}):Promise.resolve(!image||!image.getAttribute('src')||image.naturalWidth>0);
        let timer;try{return await Promise.race([Promise.allSettled([logo,document.fonts?.ready||Promise.resolve()]).then(results=>results.every(item=>item.status==='fulfilled'&&item.value!==false)),new Promise(resolve=>timer=setTimeout(()=>resolve(false),5000))]);}finally{clearTimeout(timer);cleanup.forEach(fn=>fn());}
    }
    async function initialize(){
        const toolbar=document.querySelector('.designer-toolbar');
        initializing=true;initializationCancelled=false;
        root.inert=true;toolbar.inert=true;
        const sourceLibrary=document.getElementById('sourceLibrary');
        sourceLibrary.innerHTML=`<h3>${t('服务器数据资料库','Server source library')}</h3><p data-source-loading>${t('正在载入月报与资料库…','Loading report and source library…')}</p>`;
        const startup=window.MonthlyStartupScreen;let startupError='';
        const cancel=()=>{initializationCancelled=true;transport.cancelReads(t('已停止加载，可重新载入月报或刷新数据库数据','Loading stopped; load a report or refresh the database to retry'));root.inert=false;toolbar.inert=false;status(t('已停止加载，可重新载入月报或刷新数据库数据','Loading stopped; load a report or refresh the database to retry'));};
        startup.start({t,onCancel:cancel});startup.step('reports','loading');
        try{
            const sourcesPromise=refresh().then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
            const documents=await listDocuments().then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
            if(initializationCancelled)return;
            startup.step('reports',documents.status==='fulfilled'?'ready':'error');if(documents.status==='rejected')throw documents.reason;startup.step('document','loading');
            const latest=documents.value[0];
            if(latest){
                const result=await request(`/api/upload/monthly-documents/${encodeURIComponent(latest.id)}`);
                if(initializationCancelled)return;
                current=engine.normalize(result.document);startup.step('document');window.MonthlyCharts.resetPanels();dirty=false;history.length=0;
                await ensureReferencedCatalog();const opened=current;restoreLibrary();startup.step('render','loading');const rendering=render();root.inert=false;toolbar.inert=false;await rendering;if(initializationCancelled||current!==opened)return;document.getElementById('documentList').value=current.id;
                status(t('已自动载入最近保存的服务器月报','Latest saved server report loaded automatically'));
            }else{
                let template=null;
                try{const saved=await request('/api/upload/monthly-default-template');if(initializationCancelled)return;template=saved?.template;}catch(error){console.warn('[MonthlyDesigner] Failed to fetch default template on startup:',error);}
                if(initializationCancelled)return;
                current=createFromDefault(template);startup.step('document');window.MonthlyCharts.resetPanels();await ensureReferencedCatalog();const opened=current;restoreLibrary();startup.step('render','loading');const rendering=render();dirty=false;root.inert=false;toolbar.inert=false;await rendering;if(initializationCancelled||current!==opened)return;status(templateWarning||t('服务器暂无已保存月报，已打开默认模板','No saved server reports; opened the default template'));}
            const sources=await sourcesPromise;
            if(!initializationCancelled){startup.step('references','loading');await ensureReferencedCatalog();startup.step('references');startup.step('render','loading');await render();startup.step('render');startup.step('assets','loading');const assetsReady=await waitStartupAssets();if(!initializationCancelled)startup.step('assets',assetsReady?'ready':'error');}
            if(!initializationCancelled&&sources.status==='rejected')status(t('月报已打开，但数据资料库读取失败：','Report opened, but data sources could not be loaded: ')+sources.reason.message);
        }catch(error){if(!initializationCancelled){startupError=error.message;status(error.message);}}
        finally{initializing=false;root.inert=false;toolbar.inert=false;startup.finish({error:startupError,cancelled:initializationCancelled});const placeholder=sourceLibrary.querySelector('[data-source-loading]');if(placeholder)placeholder.textContent=document.getElementById('designerStatus').textContent;}
    }
    MonthlyLoadLog.init({t,status,retry:()=>refresh(directoryCatalog?.failedGroups?.length?directoryCatalog.failedGroups:undefined).catch(()=>{})});MonthlyStudioUI.init({t});
    W.init({root,library:document.getElementById('sourceLibrary'),t,escape,metricLabel,status,find:findBlock,pair,typeName,catalog:()=>catalog,month:()=>engine.documentMonth(current),fileName:fileDisplayName,updateMode:async(block,mode)=>{checkpoint();if(mode==='legacy')delete block.dataUpdateMode;else block.dataUpdateMode=mode;if(mode==='live')delete block.savedData;cache.clear();await render();},actual:actualSource,versions:referenceVersions,referenceChange,useSelection,preview:previewSource,configure,mountEditor,state:block=>dataStates.get(block.id)||t('尚未加载','Not loaded'),favorite:key=>{current.libraryPrefs.favorites||=[];const index=current.libraryPrefs.favorites.indexOf(key);if(index>=0)current.libraryPrefs.favorites.splice(index,1);else current.libraryPrefs.favorites.push(key);dirty=true;library();}});
    document.getElementById('reportMonth').onchange=event=>{const month=event.target.value;if(S.validMonth(month))checkUpdates(month).catch(error=>{status(error.message);actions();});};
    window.MonthlyPivotPanel.init({root,library:document.getElementById('sourceLibrary'),t,escape,metricLabel,status,block:id=>findBlock(id)?.block,
        inspector:W.inspector,inspectorDrop:W.inspectorDrop,inspectorClick:W.inspectorClick,inspectorChange:W.inspectorChange,mountInspector:W.mountInspector,syncSelection:W.syncSelection,
        targets:()=>current.sections.flatMap(section=>section.blocks.map(block=>({id:block.id,label:pair(section.title)+' / '+(pair(block.title)||typeName(block.type))})))
    });
    const inlineTools=window.MonthlyInlineTools.start({root,dialog,t,request,getCatalog:inlineCatalog,getPickerCatalog:inlinePickerCatalog,metricLabel,
        setLogo,
        commitText,commitFormula:(field,definition)=>{checkpoint();if(definition){current.inlineFormulas||=[];current.inlineFormulas.push(definition);}commitText(field,{recordHistory:false,preserveInline:true});}
    });
    document.getElementById('logoSelect').onchange=event=>{
        const value=event.target.value;
        if(value==='gallery'){logoChoices();inlineTools.chooseLogo();}
        else if(value!==current.logo)setLogo(value);
    };
    const fontSelect=document.getElementById('defaultFontSizeSelect');
    if(fontSelect){
        fontSelect.onchange=event=>updateDefaultFontSize(event.target.value);
    }
    const referenceInspector=window.MonthlyReferenceInspector.start({root,t,status,describe:token=>{
        const data=inlineCatalog(),part=engine.metricTextParts(token,data)[0];if(!part)return {title:t('无法识别引用','Unrecognized reference'),notes:[]};
        function details(key){
            const scoped=data.reportMonth?{...data,snapshots:data.snapshots.filter(snapshot=>S.snapshotMonth(snapshot,data)===data.reportMonth).sort((a,b)=>S.time(b.captured_at)-S.time(a.captured_at)||String(b.id).localeCompare(String(a.id)))}:data;
            const sectionKey=data.reportMonth?engine.metricOptions(scoped).find(metric=>metric.keyAliases.includes(key))?.sourceSection:'';
            const resolved=engine.resolve({kind:'metric',mode:'latest',metricKey:key,...(sectionKey?{sectionKey}:{})},scoped);
            if(!resolved)return {name:t('来源缺失','Missing source'),time:t('无可用快照','No available snapshot')};
            const raw=resolved.snapshot.captured_at||'',date=new Date(raw);let time=t('未记录时间','Time not recorded');
            if(/^\d{4}-\d{2}-\d{2}$/.test(raw))time=raw;
            else if(raw&&!Number.isNaN(date.getTime()))time=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')+' '+[date.getHours(),date.getMinutes(),date.getSeconds()].map(value=>String(value).padStart(2,'0')).join(':');
            return {name:metricLabel(resolved.metric.label),time};
        }
        if(!part.formulaId){const source=details(part.key);return {title:source.name,notes:[t('快照：','Snapshot: ')+source.time]};}
        const formula=data.inlineFormulas.find(item=>item.id===part.formulaId);if(!formula)return {title:t('公式缺失','Formula missing'),notes:[]};
        const expression=formula.expression.replace(/\b[AB]\b/g,key=>'('+part.operandValues[key==='A'?0:1]+')').replace(/\*/g,'×').replace(/\//g,'÷');
        return {title:expression+' = '+part.value,notes:formula.keys.map((key,index)=>{const source=details(key);return (index?'B':'A')+' · '+source.name+' · '+source.time;})};
    }});
    const metricClipboard=window.MonthlyClipboard.start({root,getCatalog:inlineCatalog,render:(text,runs,data)=>window.MonthlyInlineTools.renderText(text,data,metricLabel,runs),commit:(definitions,mutate,field)=>{checkpoint();if(definitions.length){current.inlineFormulas||=[];current.inlineFormulas.push(...definitions);}mutate();commitText(field,{recordHistory:false,preserveInline:true});updateEmptyState();}});
    window.MonthlyRichText.start({root,t,commitText,formula:inlineTools,renderText:(text,runs)=>window.MonthlyInlineTools.renderText(text,inlineCatalog(),metricLabel,runs)});
    actions();render();initialize();
})();
