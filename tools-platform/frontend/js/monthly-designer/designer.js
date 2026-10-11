(function(){
    'use strict';
    const engine=window.MonthlyDocumentEngine;
    const view=window.MonthlyCatalogView;
    let libraryPeriod=null,libraryDate=null,libraryGroup=null;
    let language=window.ToolsI18n?.getLanguage()==='en-US'?'en':'zh';
    let current=engine.defaults(),catalog={files:[],snapshots:[],batches:[]},generation=0,renderPromise=Promise.resolve(),dirty=false;
    let metricTranslations=Object.create(null),globalCategories=[];
    let cardGesture=null,metaGesture=null,cardGridObserver=null,saving=false;
    const history=[],cache=new Map(),fields=new Map();let fieldIndex=0;
    const root=document.getElementById('monthlyDocument'),dialog=document.getElementById('blockEditor');
    const t=(zh,en)=>language==='en'?en:zh;
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const status=value=>document.getElementById('designerStatus').textContent=value;
    const pair=value=>value?.[language]||'';
    const clone=value=>JSON.parse(JSON.stringify(value));
    function checkpoint(){history.push(clone(current));if(history.length>30)history.shift();dirty=true;}
    async function request(url,options){const headers={...getAuthHeaders(),...options?.headers};if(options?.body instanceof FormData)for(const key of Object.keys(headers))if(key.toLowerCase()==='content-type')delete headers[key];const res=await fetch(url,{credentials:'same-origin',...options,headers});return handleResponse(res,{method:options?.method || 'GET',path:url});}
    function cached(url){if(!cache.has(url))cache.set(url,request(url).catch(error=>{cache.delete(url);throw error;}));return cache.get(url);}
    function edit(value,key='value',placeholder=''){
        const field=`field-${fieldIndex++}`;fields.set(field,{value,key});return `<div class="document-edit" contenteditable="true" data-field="${field}" style="${value.fieldAlign?.[key]?.[language]?'text-align:'+value.fieldAlign[key][language]:''}" data-placeholder="${escape(placeholder)}">${window.MonthlyInlineTools.renderText(pair(value[key]),catalog,metricLabel,key==='text'?value.textRuns?.[language]:value.fieldRuns?.[key]?.[language])}</div>`;
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
    function setLogo(url){checkpoint();current.logo=url;render();status(t('Logo 已更换，请保存月报','Logo changed; save the report'));}
    function actions(){
        const names={load:t('载入','Load'),new:t('新建月报','New report'),save:t('保存到服务器','Save to server'),refresh:t('刷新数据库数据','Refresh database'), 'add-section':t('＋模块','＋ Module'),layout:t('页面与信息栏','Page & metadata'),html:t('导出 HTML','Export HTML'),print:t('打印 / PDF','Print / PDF'),pdf:t('导出 PDF','Export PDF'),image:t('导出图片','Export image'),project:t('导出工程','Export project'),language:language==='zh'?'English':'中文',undo:t('撤销','Undo')};
        document.querySelectorAll('.designer-toolbar [data-action]').forEach(el=>el.textContent=names[el.dataset.action]);
        document.getElementById('designerName').textContent=t('护网与网络安全月报编辑器','Network security report designer');
        document.getElementById('projectImportLabel').textContent=t('导入工程','Import project');
        logoChoices();
    }
    function targetLabel(period){return period?t(`${period} 目标`,`${period} target`):t('未指定目标月份','No target month');}
    function snapshotLabel(snapshot){return `${view.timeLabel(view.importTime(snapshot,catalog))} · ${targetLabel(view.snapshotPeriod(snapshot,catalog))} · ${snapshot.kind==='assessment'?t('报表考核结果','Saved assessment'):t('导入提取指标','Imported metrics')}`;}
    function metricLabel(value){
        const text=String(value??'');
        if(language!=='en')return text;
        const translated=metricTranslations[text]||metricTranslations[text.trim()];
        if(translated)return translated;
        return text.includes(' / ')?text.split(' / ').map(part=>metricTranslations[part]||part).join(' / '):text;
    }
    function readMetricTranslations(mapping){
        const result=Object.create(null);
        for(const [key,value] of Object.entries(mapping||{})){
            if(key==='expiring_days_legend'||typeof value!=='string')continue;
            const parsed=new DOMParser().parseFromString(value,'text/html');
            result[key]=(parsed.querySelector('span')||parsed.body).textContent.trim();
        }
        return result;
    }
    function fileDisplayName(file,withMerged=false){
        const batchFiles=engine.mergeFiles(catalog.files.filter(item=>item.batch_id===file.batch_id));
        const labels=view.fileDisplayMetrics(file,batchFiles);
        const title=!view.isExpiringTicketFile(file)&&labels.length?labels.map(metricLabel).join('、'):view.fileTitle(file,batchFiles,language);
        const count=file.mergedFiles?.length||1;
        return title+(withMerged&&count>1?` [${t('合并','Merged')} ${count}]`:'');
    }
    window.MonthlyCharts.init({root,library:document.getElementById('sourceLibrary'),catalog:()=>catalog,load:cached,t,escape,block:id=>findBlock(id)?.block,change:()=>{checkpoint();},render:()=>{const pending=render();status(t('图表配置已更新，请保存月报','Chart configuration updated; save the report'));return pending;},status});
    function restoreLibrary(){
        const prefs=current.libraryPrefs||{};
        libraryPeriod=prefs.period??null;libraryDate=prefs.date??null;libraryGroup=prefs.group??null;
        library();
    }
    function filterLibrary(){
        const query=(current.libraryPrefs?.search||'').toLowerCase().trim();
        document.querySelectorAll('#sourceLibrary .library-file-item').forEach(element=>element.hidden=Boolean(query&&!element.dataset.fileName.includes(query)));
    }
    document.getElementById('sourceLibrary').addEventListener('toggle',event=>{
        const element=event.target;if(!element.isConnected||!document.getElementById('sourceLibrary').contains(element))return;
        const key=element.matches('.library-file-item')?'expandedFileIds':null;
        if(!key||!current.libraryPrefs)return;
        const id=element.dataset.fileId;
        const previous=current.libraryPrefs[key]||[];
        if(previous.includes(id)===element.open)return;
        current.libraryPrefs[key]=element.open?[...previous,id]:previous.filter(value=>value!==id);dirty=true;
    },true);
    function library(){
        const groups=view.groups(catalog);
        const periods=[...new Set(groups.map(group=>group.period))].sort((a,b)=>b.localeCompare(a));
        if(!periods.includes(libraryPeriod))libraryPeriod=periods[0]??'';
        const inPeriod=groups.filter(group=>group.period===libraryPeriod);
        const dates=[...new Set(inPeriod.map(group=>group.date))];
        if(!dates.includes(libraryDate))libraryDate=dates[0]??'';
        const dated=inPeriod.filter(group=>group.date===libraryDate);
        if(!dated.some(group=>group.id===libraryGroup))libraryGroup=dated.find(group=>group.fileIds.length)?.id ?? dated[0]?.id;
        const selected=dated.find(group=>group.id===libraryGroup);
        current.libraryPrefs={search:'',expandedFileIds:[],expandedSheetIds:[],...current.libraryPrefs,period:libraryPeriod,date:libraryDate,group:libraryGroup||''};
        engine.applyReportDefaults(current,libraryPeriod,libraryDate);
        const batchFiles=catalog.files.filter(file=>selected?.fileIds.includes(file.id));
        const periodDutyFiles=catalog.files.filter(file=>(file.kind==='duty_roster'||file.source_key==='夜间运维值班表')&&(!libraryPeriod||file.name.includes(libraryPeriod)||selected?.fileIds.includes(file.id)));
        const topicFiles=catalog.files.filter(file=>file.kind==='topic_monthly'&&file.target_period===libraryPeriod);
        const meetingFiles=catalog.files.filter(file=>file.kind==='meeting_attendance'&&file.target_period===libraryPeriod);
        const files=engine.mergeFiles([...new Map([...batchFiles,...periodDutyFiles,...topicFiles,...meetingFiles].map(file=>[file.id,file])).values()]);
        const sortedFiles=view.sortPriorityFiles(files);
        const topicTableFiles=sortedFiles.filter(file=>file.kind==='topic_monthly');
        const meetingTableFiles=sortedFiles.filter(file=>file.kind==='meeting_attendance');
        const ticketFiles=sortedFiles.filter(file=>file.kind!=='topic_monthly'&&file.kind!=='meeting_attendance'&&view.isExpiringTicketFile(file));
        const tableFiles=sortedFiles.filter(file=>file.kind!=='topic_monthly'&&file.kind!=='meeting_attendance'&&!view.isExpiringTicketFile(file)&&(view.hasExtractedMetrics(file,files)||file.kind==='duty_roster'||file.source_key==='夜间运维值班表'));
        const displayedIds=new Set([...ticketFiles,...tableFiles,...topicTableFiles,...meetingTableFiles].map(file=>file.id));
        const rawFiles=sortedFiles.filter(file=>!displayedIds.has(file.id));
        const options=(values,selected,label)=>values.map(value=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label(value))}</option>`).join('');
        const renderFileItem=file=>{
            const isTicket=view.isExpiringTicketFile(file);
            const isDuty=file.kind==='duty_roster'||file.source_key==='夜间运维值班表';
            const title=fileDisplayName(file);
            const metrics=view.fileDisplayMetrics(file,files).map(metricLabel);
            const originals=file.mergedFiles||[file];
            const mergedBadge=originals.length>1?`<span class="library-badge-merged" title="${t('已合并 '+originals.length+' 个原始文件','Merged '+originals.length+' original files')}">${t('合并','Merged')}</span>`:'';
            const dutyLink=isDuty?`<a href="/pages/duty-roster.html?month=${encodeURIComponent(libraryPeriod||'')}" target="_blank" class="library-edit-duty-link">✏️ ${t('前往编辑/查看值班表','Edit/View duty roster')}</a><br>`:'';
            const searchKey=escape((title+' '+originals.map(item=>item.name).join(' ')+' '+(file.metricLabels||[]).concat((file.metricLabels||[]).map(metricLabel)).join(' ')).toLowerCase());
            return `<details class="library-file-item ${isTicket?'library-file-expiring':''}" data-file-id="${escape(file.id)}" ${current.libraryPrefs.expandedFileIds.includes(file.id)?'open':''} data-file-name="${searchKey}"><summary title="${escape(file.name)}">${escape(title)}${mergedBadge}</summary>${originals.map(item=>`<small>${t('原文件','Original file')}: ${escape(item.name)}</small>`).join('')}${originals.length>1?`<small>${t('已合并','Merged')}: ${originals.length} ${t('个原始文件','original files')}</small>`:''}${metrics.length?`<small>${t('对应指标','Extracted')}: ${escape(metrics.join('、'))}</small>`:''}<small>${view.timeLabel(file.created_at)} · ${file.size} bytes</small><small>${file.kind==='meeting_attendance'?t('会议服务器快照：完整原表的按月视图','Meeting server snapshot: month-filtered view of complete originals'):file.kind==='topic_monthly'?t('专题服务器快照：汇总表与原始明细','Topic server snapshot: report tables and source details'):file.kind==='structured'?t('自动抓取的结构化表（CSV 重建）','Structured capture (reconstructed CSV)'):isDuty?t('夜间运维值班表（可在线编辑）','Night duty roster (online editable)'):t('上传原文件','Uploaded original')}</small><small class="${file.parse_status==='ready'?'':'library-warning'}">${file.parse_status==='ready'?t('已存储所有工作表','Worksheets stored'):t('原文件已存档，表格解析未完成','Original archived; parsing incomplete')} ${escape(file.parse_error)}</small>${file.sheets.map(sheet=>`<small>${escape(sheet.name)} · ${sheet.rowCount} ${t('行','rows')}</small>`).join('')}${file.kind==='meeting_attendance'?`<small>${t('快照','Snapshot')}: ${escape(file.snapshot_title)}<br>${t('已按目标月份筛选','Filtered for target month')}: ${escape(file.filter_scope)}<br>${t('原始总行数','Original rows')}: ${file.original_row_count}${file.unknown_date_rows?` · ${t('日期无法识别','Unrecognized dates')}: ${file.unknown_date_rows} (${t(file.unknown_dates_retained?'沿用考勤规则保留于工单窗口':'未纳入本月',file.unknown_dates_retained?'retained in order windows per attendance rules':'excluded from month')})`:''}</small>`:''}${window.MonthlyCharts.library(file)}${dutyLink}${originals.map(item=>`<a href="/api/upload/source-files/${encodeURIComponent(item.id)}/download">${file.kind==='meeting_attendance'?t('下载已筛选考勤表','Download filtered attendance tables'):file.kind==='topic_monthly'?t('下载专题数据表','Download topic worksheets'):t('下载原文件','Download source')}${originals.length>1?' · '+escape(item.name):''}</a>`).join('<br>')}</details>`;
        };
        document.getElementById('sourceLibrary').innerHTML=`<h3>${t('服务器数据资料库','Server source library')}</h3><p>${t('按目标月份和导入时间查看原始表。所选月份同步报告信息，不改变已绑定模块的数据。','Browse originals by target month and import time. Selected months update report metadata without changing block bindings.')}</p><a href="/sla">${t('前往导入数据','Import data')}</a><p>${t('全部原始文件','Total originals')}: ${catalog.files.length}<br>${t('导入 / 目标月份组合','Import / target periods')}: ${groups.length}</p>
        <label>${t('目标月份','Target month')}<select id="libraryTargetPeriod">${options(periods,libraryPeriod,targetLabel)}</select></label><label>${t('快照导入日期','Snapshot import date')}<select id="libraryImportDate">${options(dates,libraryDate,value=>value||'—')}</select></label><label>${t('导入批次','Import batch')}<select id="libraryImportBatch">${dated.map(group=>`<option value="${escape(group.id)}" ${group.id===libraryGroup?'selected':''}>${escape(view.timeLabel(group.importedAt))} · ${group.fileIds.length} ${t('个源表','sources')}</option>`).join('')}</select></label>
        <p>${selected?.snapshots.some(snapshot=>snapshot.kind==='assessment')?t('此批次含导入提取指标及报表保存的考核结果；两种口径属于同一来源。','This import has extracted metrics and saved assessment results; both refer to the same source.'):t('当前批次原始表完整保存，包含所有月份和工作表。','This batch retains all months and worksheets.')}<br>${t('当前显示','Showing')}: ${files.length} ${t('个原始表','originals')}</p><input id="sourceSearch" maxlength="2000" value="${escape(current.libraryPrefs.search)}" placeholder="${t('搜索指标或表格名称','Search metric or table name')}">
        <div class="source-section-header"><span>${t('临期详单','Expiry tickets')}</span><span class="source-section-count">${ticketFiles.length} ${t('个','items')}</span></div>
        <div id="sourceTicketFileList">${ticketFiles.map(renderFileItem).join('')||`<p class="library-empty">${t('暂无临期详单','No expiry ticket tables')}</p>`}</div>
        <div class="source-section-header"><span>${t('指标与关键数据表','Metrics & priority tables')}</span><span class="source-section-count">${tableFiles.length} ${t('个','items')}</span></div>
        <div id="sourceFileList">${tableFiles.map(renderFileItem).join('')||`<p class="library-empty">${t(files.length?'暂无指标与关键数据表':'该快照未存档原始表，仍可在模块中引用已存指标。',files.length?'No metric or priority tables':'This snapshot has no archived originals. Stored metrics can still be bound to blocks.')}</p>`}</div>
        ${topicTableFiles.length?`<div class="source-section-header"><span>${t('专题分析月报数据','Topic monthly report data')}</span><span class="source-section-count">${topicTableFiles.length} ${t('个','items')}</span></div><div id="sourceTopicFileList">${topicTableFiles.map(renderFileItem).join('')}</div>`:''}
        ${meetingTableFiles.length?`<div class="source-section-header"><span>${t('会议考勤原始表','Meeting attendance sources')}</span><span class="source-section-count">${meetingTableFiles.length} ${t('个','items')}</span></div><div id="sourceMeetingFileList">${meetingTableFiles.map(renderFileItem).join('')}</div>`:''}
        <div class="source-section-header"><span>${t('原始表名称呈现','Raw table names')}</span><span class="source-section-count">${rawFiles.length} ${t('个','items')}</span></div>
        <div id="sourceRawFileList">${rawFiles.map(renderFileItem).join('')||`<p class="library-empty">${t(files.length?'所有原始表已在上方展示':'暂无原始文件存档',files.length?'All original tables are shown above':'No archived original files')}</p>`}</div>`;
        document.getElementById('libraryTargetPeriod').onchange=event=>{checkpoint();libraryPeriod=event.target.value;libraryDate=null;libraryGroup=null;library();render();};
        document.getElementById('libraryImportDate').onchange=event=>{checkpoint();libraryDate=event.target.value;libraryGroup=null;library();render();};
        document.getElementById('libraryImportBatch').onchange=event=>{checkpoint();libraryGroup=event.target.value;library();render();};
        document.getElementById('sourceSearch').oninput=event=>{current.libraryPrefs.search=event.target.value;dirty=true;filterLibrary();};
        filterLibrary();window.MonthlyPivotPanel?.sync();
    }
    function sectionControls(section,index){return `<div class="document-controls" data-controls><button data-op="section-up" data-section="${section.id}" ${index===0?'disabled':''}>↑</button><button data-op="section-down" data-section="${section.id}" ${index===current.sections.length-1?'disabled':''}>↓</button><select data-section-width="${section.id}" aria-label="${t('模块宽度','Module width')}">${[3,4,6,8,12].map(span=>`<option value="${span}" ${span===section.span?'selected':''}>${span}/12</option>`).join('')}</select><select data-add-kind="${section.id}" aria-label="${t('添加内容','Add content')}"><option value="">${t('＋添加内容位置','＋ Add content slot')}</option>${['text','metric','table','chart','summary'].map(type=>`<option value="${type}">${typeName(type)}</option>`).join('')}</select><button data-op="copy-section" data-section="${section.id}">⧉</button><button data-op="remove-section" data-section="${section.id}">${t('删除模块','Delete module')}</button></div>`;}
    function navigationRows(){
        const rows=current.navRows||2;const sections=current.sections.filter(item=>!item.overview);const count=sections.length;let start=0;
        return Array.from({length:rows},(_,row)=>{const length=Math.floor(count/rows)+(row<count%rows?1:0);const offset=start;const items=sections.slice(start,start+length);start+=length;return `<div class="document-nav-row">${items.map((item,index)=>`<a href="#section-${item.id}">${String(offset+index+1).padStart(2,'0')}　${escape(pair(item.title))}</a>`).join('')}</div>`;}).join('');
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
        if(link)link.textContent=`${String(index+1).padStart(2,'0')}　${title}`;
    }
    function render(){
        engine.applyReportDefaults(current,libraryPeriod,libraryDate);
        if(engine.formatOverview(current))dirty=true;
        if(engine.sampleOverview(current))dirty=true;
        current.sections.forEach(section=>section.blocks.forEach(block=>{
            if(block.type==='metric'&&['file','section'].includes(block.binding?.kind))block.type='table';
        }));
        const token=++generation;fields.clear();fieldIndex=0;actions();
        root.style.width=`${current.pageWidth}px`;
        const metaWidthVal = current.metaWidth ? `${current.metaWidth}px` : '100%';
        const metaRowHeightVal = current.metaRowHeight ? `${current.metaRowHeight}px` : '38px';
        const metaLabelWidthVal = current.metaLabelWidth ? `${current.metaLabelWidth}px` : '90px';
        const metaLayoutItems = metadataLayout(current.meta, current.metaAlignMode || 'grid');
        const metaHtml = `<div class="document-meta-wrapper" data-controls-container style="width:${metaWidthVal};"><div class="document-meta-toolbar" data-controls><span class="document-meta-toolbar-title">📋 ${t('报告信息栏','Report metadata')} <small style="font-weight:normal;color:#64748b;">(${current.meta.length}${t('项',' items')})</small></span><div class="document-meta-toolbar-actions"><span class="meta-tool-group"><span class="meta-tool-label">${t('竖线对齐:','Align:')}</span><button type="button" data-meta-op="align-3" class="${(current.metaAlignMode||'grid')==='col-3'?'active':''}" aria-pressed="${(current.metaAlignMode||'grid')==='col-3'}" title="${t('整齐三列对齐 (4-4-4)，末尾自动补齐','3-col aligned (4-4-4)')}">📐 ${t('三列对齐','3-col')}</button><button type="button" data-meta-op="align-2" class="${(current.metaAlignMode||'grid')==='col-2'?'active':''}" aria-pressed="${(current.metaAlignMode||'grid')==='col-2'}" title="${t('整齐两列对齐 (6-6)','2-col aligned (6-6)')}">📐 ${t('两列对齐','2-col')}</button><button type="button" data-meta-op="align-auto" class="${(current.metaAlignMode||'grid')==='grid'?'active':''}" aria-pressed="${(current.metaAlignMode||'grid')==='grid'}" title="${t('智能对齐竖线','Auto-align lines')}">📐 ${t('自动对齐','Auto')}</button></span><span class="meta-tool-group"><span class="meta-tool-label">${t('行高:','Height:')}</span><button type="button" data-meta-op="height-32" class="${current.metaRowHeight===32?'active':''}" title="${t('紧凑 (32px)','Compact')}">${t('紧凑','Compact')}</button><button type="button" data-meta-op="height-38" class="${(!current.metaRowHeight||current.metaRowHeight===38)?'active':''}" title="${t('标准 (38px)','Standard')}">${t('标准','Standard')}</button><button type="button" data-meta-op="height-48" class="${current.metaRowHeight===48?'active':''}" title="${t('舒适 (48px)','Comfortable')}">${t('舒适','Comfy')}</button></span><span class="meta-tool-group"><span class="meta-tool-label">${t('整体宽:','Width:')}</span><button type="button" data-meta-op="width-100" class="${!current.metaWidth?'active':''}">100%</button><button type="button" data-meta-op="width-90" class="${current.metaWidth===1150?'active':''}">90%</button></span><button type="button" data-meta-op="open-layout" data-action="layout" class="btn-meta-settings" title="${t('打开完整布局与高级尺寸弹窗','Open layout & sizing dialog')}">⚙️ ${t('布局与尺寸','Layout & size')}</button><button type="button" data-meta-op="add-item" title="${t('增加新信息项','Add field')}">＋ ${t('信息项','Field')}</button></div></div><div class="document-meta" style="--meta-container-width:100%;--meta-min-height:${metaRowHeightVal};--meta-label-width:${metaLabelWidthVal};">${metaLayoutItems.map((layout,index)=>{const item=current.meta[index];const cellHeightStyle=item.heightUnits?`min-height:calc(${item.heightUnits} * var(--meta-min-height, 38px));`:'';return `<div class="document-meta-cell" data-meta-id="${item.id}" style="grid-column:span ${layout.displaySpan};${cellHeightStyle}"><div class="meta-cell-controls" data-controls><button type="button" data-meta-cell-op="move-prev" ${index===0?'disabled':''} data-meta-id="${item.id}" title="${t('向前移动信息项','Move field earlier')}">◀</button><span class="meta-cell-badge" data-meta-cell-op="span-cycle" data-meta-id="${item.id}" title="${t('点击循环切换预设宽度','Cycle width')}" style="cursor:pointer;">${layout.displaySpan}格</span><button type="button" data-meta-cell-op="move-next" ${index===current.meta.length-1?'disabled':''} data-meta-id="${item.id}" title="${t('向后移动信息项','Move field later')}">▶</button><button type="button" data-meta-cell-op="height-toggle" data-meta-id="${item.id}" title="${t('切换高度 (单行 / 双倍 / 三倍)','Toggle height')}">↕ ${item.heightUnits?item.heightUnits+'x':'1x'}</button><button type="button" data-meta-cell-op="span-full" data-meta-id="${item.id}" title="${t('一键设为整行全宽 (12格)','Full width')}">↔</button><button type="button" data-meta-cell-op="remove" data-meta-id="${item.id}" title="${t('删除此项','Delete field')}">×</button></div><div class="document-meta-label">${edit(item,'label')}</div><div class="document-meta-value">${edit(item,'value')}</div><div class="meta-cell-resize-handle" data-controls data-meta-resize="${item.id}" title="${t('拖动调整宽度与高度','Drag to resize width and height')}">◢</div></div>`;}).join('')}</div></div>`;
        root.innerHTML=`<header class="document-masthead"><img data-edit-logo title="${t('点击更换 Logo','Click to change logo')}" src="${escape(current.logo)}" alt="" style="width:${current.logoWidth}px;align-self:${{left:'flex-start',center:'center',right:'flex-end'}[current.logoAlign]};${current.logo?'':'display:none'}"><h1>${edit(current,'title',t('输入月报总标题','Enter report title'))}</h1></header>${metaHtml}${navigationMarkup()}<div class="document-sections">${current.sections.map((section,index)=>`<section id="section-${section.id}" class="document-section" style="grid-column:span ${section.span}"><div class="document-section-head"><span>${section.overview?'':String(current.sections.filter(item=>!item.overview).indexOf(section)+1).padStart(2,'0')}</span><h2>${edit(section,'title',t('模块标题','Module title'))}</h2></div>${sectionControls(section,index)}<div class="document-blocks" data-card-section="${section.id}">${section.blocks.map((block,index)=>`<article class="document-block" data-card-id="${block.id}" style="grid-column:span ${block.span};text-align:${block.align};${block.heightUnits?`min-height:calc(${block.heightUnits} * (var(--card-grid-unit,40px) + 12px) - 12px)`:""}"><div class="document-controls" data-controls><button type="button" class="card-drag-handle" data-card-drag="${block.id}" aria-label="${t("拖动卡片","Drag card")}" title="${t("拖动排序或移至其他模块","Drag to reorder or move to another module")}">⠿</button><span>${typeName(block.type)}</span>${block.type==='chart'?window.MonthlyCharts.toggleButton(block)+`<button type="button" data-open-pivot="${block.id}" title="${t('打开数据透视字段面板','Open pivot fields panel')}" aria-label="${t('打开数据透视字段面板','Open pivot fields panel')}">⊞</button>`:''}<button type="button" data-op="data-formats" data-block="${block.id}" title="${t('数据规整','Number formatting')}" aria-label="${t('数据规整','Number formatting')}">0.0%</button><button type="button" data-op="name-mappings" data-block="${block.id}" title="${t('表头 / 行名称映射','Column / row name mapping')}" aria-label="${t('表头 / 行名称映射','Column / row name mapping')}">⇄</button><button data-op="block-edit" data-block="${block.id}">${t('绑定与布局','Bind & layout')}</button><button data-op="block-up" data-block="${block.id}" ${index===0?'disabled':''}>←</button><button data-op="block-down" data-block="${block.id}" ${index===section.blocks.length-1?'disabled':''}>→</button><button data-op="copy-block" data-block="${block.id}">⧉</button><button data-op="remove-block" data-block="${block.id}">${t('删除','Delete')}</button></div><h3>${edit(block,'title',t('内容标题（可留空）','Content title (optional)'))}</h3>${block.type==='text'?`<div class="document-block-text">${edit(block,'text',t('点击填写正文，可粘贴纯文本','Click to edit or paste plain text'))}</div>`:`<div class="document-block-data" id="data-${block.id}">${t('读取数据库数据…','Loading database data…')}</div>`}<button type="button" class="card-resize-handle" data-card-resize="${block.id}" data-controls aria-label="${t('调整卡片宽度与高度','Resize card width and height')}" title="${t('按网格调整宽高','Resize in grid units')}">◢</button></article>`).join('')}</div></section>`).join('')}</div><footer class="document-footer">${edit(current,'footer',t('页脚（可自定义）','Custom footer'))}</footer>`;
        compactControls();observeCardGrids();
        root.querySelector('img').onerror=event=>event.target.hidden=true;
        const jobs=current.sections.flatMap(section=>section.blocks.filter(block=>block.type!=='text').map(async block=>{const target=document.getElementById(`data-${block.id}`);try{const result=await renderData(block);if(generation===token&&target?.isConnected){target.innerHTML=result;window.MonthlyNameMappings.apply(block,target);window.MonthlyDataFormats.apply(block,target);formatTableCells(block,target);}}catch(error){if(generation===token&&target?.isConnected)target.textContent=error.message;}}));
        updateEmptyState();
        renderPromise=Promise.all(jobs).then(()=>{if(generation===token){updateEmptyState();window.MonthlyPivotPanel?.sync();}});return renderPromise;
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
        root.querySelectorAll('.document-controls [data-op]').forEach(button=>{const item=operations[button.dataset.op];if(item){button.textContent=item[0];button.title=item[1];button.setAttribute('aria-label',item[1]);}});
        root.querySelectorAll('[data-add-kind]').forEach(select=>{select.options[0].textContent='＋';select.title=t('添加内容组件','Add content');});
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
        const update=grid=>{const style=getComputedStyle(grid);const width=grid.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);grid.style.setProperty('--card-grid-unit',`${Math.max(1,(width-11*12)/12)}px`);};
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
            if(badge)badge.textContent=`${nextSpan}格`;sizeGuides(metaGesture.cell,nextSpan);
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
            const targetMonth=engine.documentMonth(current)||libraryPeriod||'2026-08';
            try{
                const dutyData=await cached(`/api/duty-roster?month=${encodeURIComponent(targetMonth)}`);
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
            }catch(e){console.warn('Load duty roster failed',e);}
        }
        if(resolved?.sheet){
            const members=resolved.file.mergedFiles||[resolved.file];
            const tables=await Promise.all(members.map(async file=>{const sheet=block.binding.sheetName?file.sheets.find(item=>item.name===block.binding.sheetName):file.sheets[0];if(!sheet)return null;return {...await cached(`/api/upload/source-sheets/${encodeURIComponent(sheet.id)}`),file};}));
            const available=tables.filter(Boolean);
            const origin=t('源文件','Source file');
            return {headers:[...new Set(available.flatMap(table=>table.headers).concat(members.length>1?[origin]:[]))],rows:available.flatMap(table=>table.rows.map(row=>members.length>1?{...row,[origin]:table.file.name}:row)),note:fileDisplayName(resolved.file,true)+' / '+resolved.sheet.name};
        }
        if(resolved?.section){const section=await cached(`/api/upload/source-snapshots/${encodeURIComponent(resolved.snapshot.sourceSnapshotId||resolved.snapshot.id)}/sections/${encodeURIComponent(resolved.section.key)}`);return {...section,note:t('快照保存的清洗结果：','Saved processed result: ')+section.title};}
        if(resolved?.metric?.parentMetricKey&&block.binding.tableMode==='processed')return {headers:[],rows:[],note:t('该历史子指标保存了提取值，未单独保存匹配明细；请引用原始表查看来源。','This historical child metric has a saved value but no separate matched rows; use its original table to inspect the source.')};
        if(resolved?.metric&&block.binding.tableMode==='processed'&&resolved.metric.sourceSection){
            const table=await cached(`/api/upload/source-snapshots/${encodeURIComponent(resolved.snapshot.sourceSnapshotId||resolved.snapshot.id)}/metrics/${encodeURIComponent(resolved.metric.sourceMetricKey||resolved.metric.key)}/rows`);return {...table,note:table.hasSelections?t('提取时规则匹配的清洗记录：','Processed rows matched at extraction: ')+table.title:t('历史快照未保存规则匹配明细。','This legacy snapshot has no saved matched rows.')};
        }
        const files=resolved?.metric?.fileIds.map(id=>catalog.files.find(file=>file.id===id)).filter(Boolean)||[];
        const sheets=[];
        for(const file of files){const sheet=block.binding.sheetName?file.sheets.find(sheet=>sheet.name===block.binding.sheetName):file.sheets[0];if(sheet){const data=await cached(`/api/upload/source-sheets/${encodeURIComponent(sheet.id)}`);sheets.push({...data,file});}}
        const rows=sheets.flatMap(sheet=>sheet.rows.map(row=>({...row,[t('源文件','Source file')]:sheet.file.name})));
        return {headers:[...new Set(sheets.flatMap(sheet=>sheet.headers).concat(sheets.length?[t('源文件','Source file')]:[]))],rows,note:files.length?t('指标关联原始表（未经清洗）：','Linked originals (unprocessed): ')+engine.mergeFiles(files).map(file=>fileDisplayName(file,true)).join(' / '):t('历史指标没有可追溯原始文件；新导入后可自动关联。','This legacy metric has no archived original. New imports provide source links.')};
    }
    function sourceNote(detail,resolved){
        const date=resolved?.snapshot?view.dateKey(view.importTime(resolved.snapshot,catalog)):view.dateKey(resolved?.file?.created_at);
        return `<small class="document-source-note" data-source-date="${escape(date)}"><span class="document-source-detail">${escape(detail)}</span><span class="document-source-date">${escape(date)}</span></small>`;
    }
    async function renderData(block){
        const resolved=engine.resolve(block.binding,catalog);
        if(block.type==='metric')return resolved?.metric?`<div class="document-metric"><span>${escape(metricLabel(resolved.metric.label))}</span><strong>${escape(resolved.metric.value)}</strong></div>${sourceNote(snapshotLabel(resolved.snapshot),resolved)}`:escape(t('选择“绑定与布局”引用数据库指标','Choose Bind & layout to reference a stored metric'));
        if(block.type==='chart'&&(block.chart.pivot||block.chart.series?.length))return window.MonthlyCharts.render(block);
        const data=await sourceRows(block,resolved);const rows=engine.filterRows(data.rows,block.filters);
        if(block.type==='summary')return `<div class="document-block-text">${escape(engine.summary(block,resolved?.metric?{...resolved,metric:{...resolved.metric,label:metricLabel(resolved.metric.label)}}:resolved,rows,language))}</div>${sourceNote(data.note,resolved)}`;
        if(block.type==='chart'){
            let values;
            if(resolved?.metric){values=catalog.snapshots.filter(snapshot=>block.binding.mode!=='pinned'||snapshot.captured_at<=resolved.snapshot.captured_at).slice().reverse().map(snapshot=>({snapshot,metric:engine.resolve({...block.binding,mode:'pinned',snapshotId:snapshot.id},catalog)?.metric})).filter(item=>item.metric).map(({snapshot,metric})=>({label:snapshot.captured_at.slice(0,10),value:number(metric.value),displayLabel:String(metric.value)})).filter(item=>item.value!==null);}
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
            block.binding={kind:'file',mode:'pinned',fileId:file.id,sourceKey:file.source_key||'',sheetName:sheet.name,tableMode:'original'};
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
    function commitText(element){
        const entry=fields.get(element.dataset.field);if(!entry)return;
        const {value:owner,key}=entry,runs=window.MonthlyRichText.read(element),value=runs.map(run=>run.text).join('');
        if(entry.cellBlock&&value!==entry.baseText)return;
        const oldRuns=key==='text'?owner.textRuns:owner.fieldRuns?.[key];
        const previousRuns=entry.initialRuns||oldRuns?.[language]||(owner[key][language]?[{text:owner[key][language],style:{}}]:[]);
        const comparable=items=>JSON.stringify(items.map(run=>({...run,style:Object.fromEntries(Object.entries(run.style).sort(([a],[b])=>a.localeCompare(b)))})));
        const alignment=element.style.textAlign,previousAlignment=owner.fieldAlign?.[key]?.[language]||'';
        if(value!==owner[key][language]||comparable(runs)!==comparable(previousRuns)||alignment!==previousAlignment){
            if(entry.cellBlock&&!entry.cellBlock.tableFormats?.some(item=>item.key===owner.key)&&entry.cellBlock.tableFormats?.length>=2000){status(t('单元格格式数量已达上限','Cell formatting limit reached'));return;}
            checkpoint();if(key==='value'&&owner.autoFill&&value!==owner[key][language])owner.autoFill=false;
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
    root.addEventListener('paste',event=>{if(!event.target.closest('[contenteditable]'))return;event.preventDefault();if(event.target.closest('.table-cell-edit'))return;document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});
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
        if(op==='data-formats'&&found){window.MonthlyDataFormatEditor.open(found.block);return;}
        if(op==='name-mappings'&&found){window.MonthlyMappingEditor.open(found.block);return;}
        if(op==='block-edit'){editBlock(found);return;}
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
    const presetEditorApi={t,request,status,change:checkpoint,render,tables:async block=>{
        const sources=block.chart?.pivot?.sources||block.chart?.series||[];
        const tables=await Promise.all([...new Set(sources.map(source=>source.sheetId).filter(Boolean))].map(id=>cached('/api/upload/source-sheets/'+encodeURIComponent(id))));
        if(block.binding)tables.push(await sourceRows(block,engine.resolve(block.binding,catalog)));
        const target=document.getElementById('data-'+block.id);
        target?.querySelectorAll('table').forEach(table=>{const headers=Array.from(table.tHead?.rows[0]?.cells||[],cell=>cell.dataset.mappingOriginal??cell.textContent);const rows=Array.from(table.tBodies[0]?.rows||[],row=>Object.fromEntries(Array.from(row.cells,(cell,index)=>[headers[index]||String(index),cell.dataset.numberValue??cell.dataset.formatOriginal??cell.dataset.mappingOriginal??cell.textContent])));tables.push({headers,rows});});
        return tables;
    }};
    window.MonthlyMappingEditor.init(presetEditorApi);window.MonthlyDataFormatEditor.init(presetEditorApi);
    function editBlock(found){
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
        <div class="editor-row"><label>${t('更新方式','Update policy')}<select name="mode">${[['latest',t('自动引用最后一次导入','Latest imported record')],['pinned',t('固定历史快照 / 文件','Pin historical snapshot / file')]].map(([value,label])=>option(value,label,b.mode||'latest')).join('')}</select></label><label>${t('固定来源目标月份','Pinned source target month')}<select name="pinTargetPeriod"><option value="">${t('全部目标月份','All target months')}</option></select></label><label>${t('固定来源导入日期','Pinned source import date')}<select name="pinImportDate"><option value="">${t('全部导入日期','All import dates')}</option></select></label><label>${t('固定快照','Pinned snapshot')}<select name="snapshotId"><option value="">—</option>${catalog.snapshots.map(snapshot=>option(snapshot.id,snapshotLabel(snapshot),b.snapshotId)).join('')}</select></label><label>${t('固定原文件','Pinned original file')}<select name="fileId"><option value="">—</option>${engine.mergeFiles(catalog.files).map(file=>option(file.id,`${fileDisplayName(file,true)} · ${view.timeLabel(file.created_at)}`,selectedFileId)).join('')}</select></label><label>${t('工作表名（留空为第一张）','Sheet name (blank = first)')}<input name="sheetName" value="${escape(b.sheetName||'')}"></label></div>
        <p data-editor-note="source">${t('“自动引用”使用相同指标标识或原文件系列的最新入库记录。原始表未经清洗；清洗表保留快照时的结果。历史指标缺少原文件时显示说明，不拼接不相关文件。','Latest mode uses the latest matching metric key or file series. Originals are unprocessed; processed tables preserve snapshot results. Missing legacy originals remain unavailable.')}</p>
        <div class="editor-column-picker"></div><datalist id="availableColumns"></datalist><label>${t('展示列（每行一个，空白=全部）','Display columns (one per line; blank = all)')}<textarea name="columns">${escape(block.columns.join('\n'))}</textarea></label><label>${t('最多显示表格行数（1–10000）','Maximum displayed rows (1–10000)')}<input name="limit" type="number" min="1" max="10000" value="${block.limit}" required></label>
        <h4 data-editor-note="filters">${t('表格筛选规则','Table filters')}</h4><div class="editor-filters"></div><button data-add-filter type="button">${t('＋筛选条件','＋ Filter')}</button>
        <div class="editor-row"><label>${t('图表分组列','Chart group column')}<input name="chartX" list="availableColumns" value="${escape(block.chart.x)}"></label><label>${t('图表数值列','Chart value column')}<input name="chartY" list="availableColumns" value="${escape(block.chart.y)}"></label></div><label>${t('图表统计','Chart aggregation')}<select name="aggregation">${[['count',t('计数','Count')],['sum',t('数值求和','Sum')]].map(([value,label])=>option(value,label,block.chart.aggregation)).join('')}</select></label><p data-editor-note="chart">${t('指标图表自动展示已存历史值；原始表图表按列统计。','Metric charts show stored historical values; table charts aggregate selected columns.')}</p>
        <label>${t('中文总结规则','Chinese summary rule')}<textarea name="ruleZh" maxlength="5000">${escape(block.rule.zh)}</textarea></label><label>${t('英文总结规则','English summary rule')}<textarea name="ruleEn" maxlength="5000">${escape(block.rule.en)}</textarea></label><p data-editor-note="summary">${t('总结字段：{label} 指标名，{value} 指标值，{date} 数据日期，{target} 入库目标，{gap} 差距，{count}/{rows} 筛选后行数。','Summary fields: {label}, {value}, {date}, {target}, {gap}, {count}/{rows}.')}</p><p role="status"></p><footer><button data-cancel type="button">${t('取消','Cancel')}</button><button type="submit">${t('应用','Apply')}</button></footer></form>`;
        function addFilter(filter={column:'',op:'contains',value:''}){const row=document.createElement('div');row.innerHTML=`<input list="availableColumns" placeholder="${t('列名','Column')}" value="${escape(filter.column)}"><select>${['contains','eq','neq','gt','lt','empty','notEmpty'].map(op=>option(op,{contains:t('包含','Contains'),eq:t('等于','Equals'),neq:t('不等于','Not equal'),gt:t('大于','Greater'),lt:t('小于','Less'),empty:t('空','Empty'),notEmpty:t('非空','Not empty')}[op],filter.op)).join('')}</select><input placeholder="${t('条件值','Value')}" value="${escape(filter.value)}"><button type="button">×</button>`;row.querySelector('button').onclick=()=>row.remove();dialog.querySelector('.editor-filters').append(row);}
        block.filters.forEach(addFilter);dialog.querySelector('[data-add-filter]').onclick=()=>addFilter();dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
        dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const f=event.target.elements;try{syncContentType('kind');const draft=clone(current);const target=draft.sections.flatMap(section=>section.blocks).find(item=>item.id===block.id);Object.assign(target,{type:f.type.value,span:Number(f.span.value),heightUnits:Number(f.heightUnits.value),align:f.align.value,limit:Number(f.limit.value),columns:f.columns.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),filters:[...dialog.querySelectorAll('.editor-filters>div')].map(row=>({column:row.querySelectorAll('input')[0].value,op:row.querySelector('select').value,value:row.querySelectorAll('input')[1].value})),chart:{...target.chart,x:f.chartX.value,y:f.chartY.value,aggregation:f.aggregation.value},rule:{zh:f.ruleZh.value,en:f.ruleEn.value},binding:{kind:f.kind.value,mode:f.mode.value,metricKey:f.kind.value==='metric'?f.metricKey.value:'',sourceKey:f.kind.value==='file'?f.sourceKey.value:'',sectionKey:f.kind.value==='metric' ? (metrics.find(metric=>metric.key===f.metricKey.value)?.sourceSection || '') : f.kind.value==='section'?f.sectionKey.value:'',tableMode:f.kind.value==='metric'?f.tableMode.value:'original',snapshotId:f.mode.value==='pinned'&&f.kind.value!=='file'?f.snapshotId.value:'',fileId:f.mode.value==='pinned'&&f.kind.value==='file'?f.fileId.value:'',sheetName:f.kind.value!=='section'&&(f.kind.value!=='metric'||f.tableMode.value!=='processed')?f.sheetName.value:''}});if(f.section.value!==found.section.id){draft.sections.find(item=>item.id===found.section.id).blocks=draft.sections.find(item=>item.id===found.section.id).blocks.filter(item=>item.id!==target.id);draft.sections.find(item=>item.id===f.section.value).blocks.push(target);}engine.normalize(draft);checkpoint();current=draft;dialog.close();render();}catch(error){dialog.querySelector('[role=status]').textContent=error.message;}};
        const form=dialog.querySelector('form');
        const savedMetric=metrics.find(metric=>metric.keyAliases.includes(b.metricKey));
        form.elements.metricOrigin.value=b.metricKey?.startsWith('assessment:')?'assessment':'extraction';
        form.elements.metricLevel.value=savedMetric?.metricLevel||'main';
        function updateMetricOptions(changed){
            const f=form.elements;const oldKey=f.metricKey.value;
            if(changed==='metricOrigin'||changed==='metricLevel')f.metricCategory.value='';
            const eligible=metrics.filter(metric=>(metric.key.startsWith('assessment:')?'assessment':'extraction')===f.metricOrigin.value&&(metric.metricLevel||'main')===f.metricLevel.value);
            const category=f.metricCategory.value;
            const categories=[...new Set([...globalCategories,...eligible.map(metric=>metric.category).filter(Boolean)])];
            f.metricCategory.innerHTML=option('',t('全部分类','All categories'),category)+categories.map(value=>option(value,metricLabel(value),category)).join('');
            const narrowed=eligible.filter(metric=>f.metricLevel.value!=='sub'||!f.metricCategory.value||metric.category===f.metricCategory.value);
            f.metricKey.innerHTML=option('',narrowed.length?'—':t('此范围暂无已存指标','No saved metrics in this scope'),oldKey)+narrowed.map(metric=>option(metric.key,metricLabel(metric.label),oldKey)).join('');
        }
        updateMetricOptions('initial');
        if(savedMetric?.category){form.elements.metricCategory.value=savedMetric.category;updateMetricOptions('initial');}
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
        let bindingGeneration=0;
        async function updateColumns(){
            const token=++bindingGeneration;const f=form.elements;
            const binding={kind:f.kind.value,mode:f.mode.value,metricKey:f.metricKey.value,sourceKey:f.sourceKey.value,sectionKey:f.sectionKey.value,tableMode:f.tableMode.value,snapshotId:f.snapshotId.value,fileId:f.fileId.value,sheetName:f.sheetName.value};
            try {const data=await sourceRows({...block,binding},engine.resolve(binding,catalog));if(token!==bindingGeneration||!dialog.open)return;const selected=f.columns.value.split(/\r?\n/).filter(Boolean);dialog.querySelector('#availableColumns').innerHTML=data.headers.map(header=>`<option value="${escape(header)}"></option>`).join('');dialog.querySelector('.editor-column-picker').innerHTML=`<p>${t('可用字段（勾选展示列；空选=全部）','Available fields (select columns; none = all)')}</p><div>${data.headers.map(header=>`<label><input type="checkbox" value="${escape(header)}" ${selected.includes(header)?'checked':''}> ${escape(header)}</label>`).join('')}</div>`;dialog.querySelector('.editor-column-picker').onchange=()=>{f.columns.value=[...dialog.querySelectorAll('.editor-column-picker input:checked')].map(el=>el.value).join('\n');};}catch(error){if(token===bindingGeneration)dialog.querySelector('.editor-column-picker').textContent=error.message;}
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
            dialog.querySelectorAll('.editor-row').forEach(row=>row.hidden=Array.from(row.children).every(child=>child.hidden));
        }
        for(const name of ['type','kind','mode','metricKey','sourceKey','sectionKey','tableMode','snapshotId','fileId','sheetName','pinTargetPeriod','pinImportDate','metricOrigin','metricLevel','metricCategory'])form.elements[name].addEventListener('change',()=>{syncContentType(name);if(['metricOrigin','metricLevel','metricCategory'].includes(name))updateMetricOptions(name);updatePinnedSources();simplify();updateColumns();});
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
    async function refresh(){status(t('正在读取服务器原始表与指标…','Reading server originals and metrics…'));const [sources,mapping,categories]=await Promise.all([request('/api/upload/source-catalog'),request('/api/sla/prefs/i18nMap').catch(()=>metricTranslations),request('/api/sla/categories').catch(()=>[])]);catalog=sources;globalCategories=Array.isArray(categories)?categories:[];metricTranslations=readMetricTranslations(mapping);cache.clear();library();await render();status(t('数据库数据已刷新；模板保持当前配置','Database refreshed; document layout retained'));}

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
    async function exportDocument(){
        await renderPromise;updateEmptyState();const clone=root.cloneNode(true);clone.classList.add('document-export');
            // Export the rendered page width, including any editor shrinkage on narrow screens.
            clone.style.width=root.getBoundingClientRect().width+'px';clone.style.maxWidth='none';clone.style.flex='none';
            const typography=getComputedStyle(root);clone.style.fontFamily=typography.fontFamily;clone.style.fontSize=typography.fontSize;
            clone.querySelectorAll('.document-meta-cell,.document-section,.document-block').forEach(element=>{const original=root.querySelector(element.dataset.metaId?`[data-meta-id="${element.dataset.metaId}"].document-meta-cell`:element.dataset.cardId?`[data-card-id="${element.dataset.cardId}"]`:`#${element.id}`);if(original){const style=getComputedStyle(original);element.style.setProperty('grid-column',style.gridColumn,'important');element.style.padding=style.padding;}});
            clone.querySelectorAll('.inline-metric').forEach(element=>element.replaceWith(document.createTextNode(element.textContent)));clone.querySelectorAll('.document-source-note').forEach(note=>{note.textContent=note.dataset.sourceDate||'';note.removeAttribute('data-source-date');});clone.querySelectorAll('[data-controls]').forEach(el=>el.remove());clone.querySelectorAll('[contenteditable]').forEach(el=>{el.removeAttribute('contenteditable');el.removeAttribute('data-placeholder');el.removeAttribute('data-field');});const logo=clone.querySelector('.document-masthead img');if(logo&&current.logo){logo.src=await exportLogo(current.logo);logo.removeAttribute('hidden');}const css=await fetch('/css/monthly-designer.css?v=20261010-53').then(res=>res.text());
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
    async function runAction(action){
        root.querySelectorAll('.document-edit').forEach(commitText);
        document.activeElement?.blur();
        if(action==='language'){language=language==='zh'?'en':'zh';library();await render();await listDocuments();return;}
        if(action==='undo'){if(history.length){current=history.pop();dirty=true;restoreLibrary();render();}return;}
        if(action==='new'){checkpoint();current=engine.defaults();window.MonthlyCharts.resetPanels();restoreLibrary();await render();status(t('新月报尚未保存','New report is unsaved'));return;}
        if(action==='save'){
            if(saving)return;
            const toolbar=document.querySelector('.designer-toolbar'),button=toolbar.querySelector('[data-action=save]');
            saving=true;root.inert=true;toolbar.inert=true;button.disabled=true;
            button.textContent=t('正在保存…','Saving…');status(t('正在保存到服务器…','Saving to server…'));
            try{
                let draft=engine.normalize(engine.prepareMonthlySave(current,libraryPeriod)),previous=null;
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
            }catch(error){
                const message=t('保存失败：','Save failed: ')+error.message;
                status(message);window.showToast(message,'error');
            }finally{saving=false;root.inert=false;toolbar.inert=false;button.disabled=false;actions();}
            return;
        }
        if(action==='load'){const id=document.getElementById('documentList').value;if(!id)return;const result=await request(`/api/upload/monthly-documents/${encodeURIComponent(id)}`);checkpoint();current=engine.normalize(result.document);window.MonthlyCharts.resetPanels();dirty=false;restoreLibrary();await render();status(t('已载入服务器月报','Stored report loaded'));return;}
        if(action==='refresh')return refresh();
        if(action==='add-section'){checkpoint();current.sections.push(engine.section());return render();}
        if(action==='layout')return editLayout();
        if(action==='project'){download(new Blob([JSON.stringify({fileType:'monthly-document-project',document:engine.normalize(current)},null,2)],{type:'application/json'}),`${current.name.replace(/[\\/:*?"<>|]/g,'_')}.json`);return;}
        if(action==='html'){const {clone,css}=await exportDocument();download(new Blob([outputHtml(clone,css)],{type:'text/html'}),`${current.name.replace(/[\\/:*?"<>|]/g,'_')}.html`);return;}
        if(['print','pdf','image'].includes(action))await visualExport(action);
    }
    document.querySelector('.designer-toolbar').onclick=event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(action)runAction(action).catch(error=>status(error.message));};
    document.getElementById('projectImport').onchange=async event=>{try{const project=JSON.parse(await event.target.files[0].text());if(project.fileType!=='monthly-document-project')throw new Error(t('无效的工程文件','Invalid project file'));const document=engine.normalize(project.document);checkpoint();delete document.id;current=document;window.MonthlyCharts.resetPanels();restoreLibrary();await render();status(t('工程已载入，引用数据按当前租户资料库解析','Project loaded; bindings resolve in this tenant'));}catch(error){status(error.message);}finally{event.target.value='';}};
    window.addEventListener('tools:languagechange',()=>{language=window.ToolsI18n?.getLanguage()==='en-US'?'en':'zh';library();render();listDocuments().catch(error=>status(error.message));});
    window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
    window.MonthlyDesigner={getDocument:()=>clone(current),getCatalog:()=>clone(catalog),applyDocument:async document=>{current=engine.normalize(document);window.MonthlyCharts.resetPanels();restoreLibrary();return render();},refresh,whenRendered:()=>renderPromise};
    async function initialize(){
        const toolbar=document.querySelector('.designer-toolbar');
        root.inert=true;toolbar.inert=true;
        try{
            const [sources,documents]=await Promise.allSettled([refresh(),listDocuments()]);
            if(documents.status==='rejected')throw documents.reason;
            const latest=documents.value[0];
            if(latest){
                const result=await request(`/api/upload/monthly-documents/${encodeURIComponent(latest.id)}`);
                current=engine.normalize(result.document);window.MonthlyCharts.resetPanels();dirty=false;history.length=0;
                restoreLibrary();await render();document.getElementById('documentList').value=current.id;
                status(t('已自动载入最近保存的服务器月报','Latest saved server report loaded automatically'));
            }else status(t('服务器暂无已保存月报，已打开新建模板','No saved server reports; opened a new template'));
            if(sources.status==='rejected')status(t('月报已打开，但数据资料库读取失败：','Report opened, but data sources could not be loaded: ')+sources.reason.message);
        }catch(error){status(error.message);}
        finally{root.inert=false;toolbar.inert=false;}
    }
    window.MonthlyPivotPanel.init({root,library:document.getElementById('sourceLibrary'),t,escape,status,block:id=>findBlock(id)?.block,targets:()=>current.sections.flatMap(section=>section.blocks.filter(block=>block.type==='chart'&&block.chart.pivot).map((block,index)=>({id:block.id,label:(pair(section.title)||t('模块','Module'))+' / '+(pair(block.title)||t('透视 '+(index+1),'Pivot '+(index+1)))}))),selectSource:async(id,payload,selected)=>{
        const file=catalog.files.find(file=>file.id===payload.fileId&&file.sheets.some(sheet=>sheet.id===payload.sheetId))||catalog.files.find(file=>file.sheets.some(sheet=>sheet.id===payload.sheetId)),sheet=file?.sheets.find(sheet=>sheet.id===payload.sheetId);if(!sheet)throw new Error(t('源表不存在','Source table not found'));
        let block=findBlock(id)?.block;
        if(!block?.chart.pivot){if(!selected)return id;const draft=clone(current),section=draft.sections[0]||engine.section();if(!draft.sections.length)draft.sections.push(section);block=engine.block('chart');block.title=engine.bilingual('数据透视表','Pivot table');block.chart.type='table';block.chart.pivot={sources:[{fileId:file.id,sheetId:sheet.id,label:window.MonthlyCharts.sourceLabel(file)}],rows:[],columns:[],values:[],filters:[],excludeTotals:true,showTotals:false,sort:'source'};section.blocks.push(block);engine.normalize(draft);checkpoint();current=draft;await render();status(t('透视数据源已更新，请保存月报','Pivot sources updated; save the report'));return block.id;}
        await window.MonthlyCharts.changePivot(block,pivot=>{if(selected&&!pivot.sources.some(source=>source.sheetId===sheet.id))pivot.sources.push({fileId:file.id,sheetId:sheet.id,label:window.MonthlyCharts.sourceLabel(file)});if(!selected)pivot.sources=pivot.sources.filter(source=>source.sheetId!==sheet.id);});
        status(t('透视数据源已更新，请保存月报','Pivot sources updated; save the report'));return block.id;
    }});
    const inlineTools=window.MonthlyInlineTools.start({root,dialog,t,request,getCatalog:()=>catalog,metricLabel,
        setLogo,
        commitText
    });
    document.getElementById('logoSelect').onchange=event=>{
        const value=event.target.value;
        if(value==='gallery'){logoChoices();inlineTools.chooseLogo();}
        else if(value!==current.logo)setLogo(value);
    };
    window.MonthlyRichText.start({root,t,commitText});
    actions();render();initialize();
})();
