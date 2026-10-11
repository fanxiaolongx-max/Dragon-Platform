(function (root, factory) { const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.MonthlyDocumentEngine = api; })(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const sourceRules=typeof module==='object'&&module.exports?require('./source-rules'):window.MonthlySourceRules;
    const formulas=typeof module==='object'&&module.exports?require('./metric-formulas'):window.MonthlyMetricFormulas;
    const pivot=typeof module==='object'&&module.exports?require('./pivot'):window.MonthlyPivot;
    const titles = [['网络变更与操作保障', 'Network changes & operations'], ['SR、重大问题与事件恢复', 'SR, major issues & recovery'], ['风险治理与网络韧性', 'Risk governance & resilience'], ['License合规与连续运行', 'License compliance & continuity'], ['EOS退网与收编', 'EOS retirement & consolidation'], ['第三方软件专项清单', 'Third-party software inventory'], ['内控、PR自检与质量稽查', 'Internal controls, PR checks & audits'], ['网络安全例会与决议跟踪', 'Security meetings & action tracking']];
    const uid = () => typeof crypto === 'object' && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bilingual = (zh, en = '') => ({ zh, en });
    function block(type = 'text') { return { id: uid(), type, title: bilingual('', ''), text: bilingual('', ''), span: 12, heightUnits: 0, align: 'left', binding: null, columns: [], filters: [], limit: 50, chart: { x: '', y: '', aggregation: 'count' }, rule: bilingual('{label}：{value}。', '{label}: {value}.') }; }
    function section(zh = '新模块', en = 'New module') { return { id: uid(), title: bilingual(zh, en), span: 12, blocks: [block()] }; }
    function defaults() { return applyReportDefaults({ version: 1, name: '护网与网络安全月报', title: bilingual('埃及代表处交付与服务维护月报', 'Egypt Representative Office Monthly Delivery & Maintenance Report'), subtitle: bilingual('', ''), logo: '/assets/logo.png', logoWidth: 120, logoAlign: 'center', pageWidth: 1280, navRows: 2, navRowHeight: 44, navWidth: 0, navFontSize: 16, defaultFontSize: 16, metaWidth: 0, metaRowHeight: 0, metaLabelWidth: 0, metaAlignMode: 'grid', meta: [['部门', 'Department'], ['报告时间', 'Report date'], ['密级', 'Classification'], ['报告编号', 'Report number'], ['审核人', 'Reviewer'], ['报告目标', 'Report objectives']].map(([zh, en], index) => ({ id: uid(), label: bilingual(zh, en), value: bilingual(index === 2 ? '内部公开' : '', index === 2 ? 'Internal' : ''), span: index === 3 ? 4 : (index === 4 ? 8 : (index === 5 ? 12 : 4)), heightUnits: index === 5 ? 2 : 0 })), sections: [section('整体情况', 'Overall situation'), ...titles.map(([zh, en]) => section(zh, en))], footer: bilingual('', '') }); }
    const objectives = '强化问题与事件管理：规范 SR 处理、事件升级及紧急业务恢复流程，提升问题及时解决率和事故发生后 60 分钟内的业务恢复及时率，保障客户网络稳定运行。确保变更与操作可信：推动适用的变更操作 100% 纳入 IT 管道管理，落实 RFC/MOP 审批、高风险操作拦截、操作日志稽查及业务比对，确保操作合规、过程可追溯、结果可验证。推进主动风险治理：统筹 TOPN、网络整改、巡检、License、EOS及第三方软件风险闭环，完善应急演练、预案拓扑和内控稽查，防范已知风险引发现网重大业务中断与事故。';
    const shortTitles = [['网络变更','Network changes'],['SR与事件','SR & incidents'],['风险治理','Risk governance'],['License','License'],['EOS退网收编','EOS retirement & consolidation'],['第三方软件','Third-party software'],['内控与稽查','Controls & audits'],['网络安全例会','Security meetings']];
    function applyReportDefaults(document, period='', importDate='') {
        const find=label=>document.meta.find(item=>item.label.zh===label);
        if(!find('数据月份')){
            const reviewer=find('审核人');
            if(reviewer?.span===8)reviewer.span=4;
            const item={id:uid(),label:bilingual('数据月份','Data month'),value:bilingual('',''),span:4,heightUnits:0};
            document.meta.splice(Math.max(0,document.meta.indexOf(reviewer)),0,item);
        }
        const fill=(label,zh,en)=>{const item=find(label);if(item&&!item.value.zh.trim()){item.value=bilingual(zh,en);}};
        fill('部门','埃及网络保障与运维服务部','Egypt Network Assurance & Operations Services Department');
        fill('审核人','于祥 00877023','Yu Xiang 00877023');
        fill('报告目标',objectives,'Standardize SR handling, incident escalation and emergency recovery; improve timely resolution and service recovery within 60 minutes. Ensure all applicable changes follow IT pipeline governance, RFC/MOP approval, high-risk operation interception, log audits and business verification. Close TOPN, remediation, inspection, License, EOS and third-party software risks, strengthen emergency drills, contingency plans, topology and internal audits, and prevent major service interruptions.');
        const month=value=>/^\d{4}-\d{2}/.test(value)?value.slice(0,7):'';
        const setAuto=(label,key,value,en)=>{const item=find(label);if(!item)return;if(item.autoFill===undefined&&!item.value.zh.trim())item.autoFill=key;if(item.autoFill===key&&value){const next=bilingual(value,en);for(const language of ['zh','en']){const runs=item.fieldRuns?.value?.[language];if(runs&&item.value[language]!==next[language]){let start=0;item.fieldRuns.value[language]=runs.map(run=>{const text=next[language].slice(start,start+run.text.length);start+=run.text.length;return {...run,text};}).filter(run=>run.text);if(start<next[language].length)item.fieldRuns.value[language].push({text:next[language].slice(start),style:runs.at(-1)?.style||{}});}}item.value=next;}};
        const target=month(period),source=month(importDate);
        if(find('报告时间')?.autoFill==='period')find('报告时间').autoFill='source';
        if(find('数据月份')?.autoFill==='source')find('数据月份').autoFill='period';
        // Save version belongs to the stored month, independent of auto-filled fields changing during rendering.
        const savedMonth=document.reportMonth||String(document.name||'').match(/-(\d{4}-(?:0[1-9]|1[0-2]))$/)?.[1]||'';
        const revision=savedMonth===target?document.saveCount||1:1;
        if(target){setAuto('数据月份','period',target,target);setAuto('报告编号','number','EGY-CS-'+target.replace('-','')+'-V'+revision+'.0','EGY-CS-'+target.replace('-','')+'-V'+revision+'.0');}
        if(source)setAuto('报告时间','source',importDate.slice(0,10),importDate.slice(0,10));
        document.sections.forEach(item=>{if(item.title.zh==='整体情况'||item.title.en==='Overall situation')item.overview=true;const index=titles.findIndex(([zh])=>zh===item.title.zh);if(index>=0)item.title=bilingual(...shortTitles[index]);});
        return document;
    }
    function documentMonth(document){
        if(/^\d{4}-(0[1-9]|1[0-2])$/.test(document.reportMonth||''))return document.reportMonth;
        const suffix=String(document.name||'').match(/-(\d{4}-(?:0[1-9]|1[0-2]))$/);
        if(suffix)return suffix[1];
        const number=document.meta?.find(item=>item.label.zh==='报告编号')?.value.zh.match(/EGY-CS-(\d{4})(0[1-9]|1[0-2])-V/);
        if(number)return number[1]+'-'+number[2];
        const month=document.meta?.find(item=>item.label.zh==='数据月份')?.value.zh.match(/(\d{4})[年-](0?[1-9]|1[0-2])(?:月|$)/);
        return month?month[1]+'-'+month[2].padStart(2,'0'):'';
    }
    function prepareMonthlySave(document,period=''){
        const draft=JSON.parse(JSON.stringify(document));
        const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(period)?period:documentMonth(draft);
        if(month){draft.reportMonth=month;draft.name=draft.name.replace(/-\d{4}-(?:0[1-9]|1[0-2])$/,'').slice(0,192)+'-'+month;}
        return draft;
    }
    function nextSaveVersion(document,previous){
        const draft=JSON.parse(JSON.stringify(document));
        const same=previous&&documentMonth(previous)===documentMonth(draft);
        const oldVersion=previous?.meta?.find(item=>item.label.zh==='报告编号')?.value.zh.match(/-V(\d+)\.\d+$/);
        draft.saveCount=same?(Number.isSafeInteger(previous.saveCount)?previous.saveCount:Number(oldVersion?.[1])||1)+1:1;
        const month=documentMonth(draft),field=draft.meta.find(item=>item.label.zh==='报告编号');
        if(month&&field){field.autoFill='number';field.value=bilingual('EGY-CS-'+month.replace('-','')+'-V'+draft.saveCount+'.0','EGY-CS-'+month.replace('-','')+'-V'+draft.saveCount+'.0');}
        return draft;
    }
    function metricTextParts(text,catalog){
        const parts=[];let start=0;const pattern=/\[\[@(metric|formula):([^\]\n]+)\]\]/g;
        for(const match of String(text).matchAll(pattern)){
            if(match.index>start)parts.push({text:String(text).slice(start,match.index)});
            if(match[1]==='formula'){
                const formula=catalog.inlineFormulas?.find(item=>item.id===match[2]);let value='—',error='';
                const operands=formula?formula.keys.map(key=>metricTextParts('[[@metric:'+encodeURIComponent(key)+']]',catalog)[0]):[],missing=!formula||operands.some(part=>part.missing);
                if(!missing)try{value=formulas.display(formulas.evaluate(formula.expression,...operands.map(part=>part.value)),formula.digits,formula.percent);}catch(issue){error=issue.code||'invalid_expression';}
                parts.push({token:match[0],key:'formula:'+match[2],formulaId:match[2],label:formula?operands.map((part,index)=>(index?'B: ':'A: ')+part.label).join(' / ')+' · '+formula.expression:match[2],value,missing,error,operandValues:operands.map(part=>part.value)});
            }else{
                let key;try{key=decodeURIComponent(match[2]);}catch(_){key='';}
                const metricCatalog=catalog.reportMonth?{...catalog,snapshots:catalog.snapshots.filter(snapshot=>sourceRules.snapshotMonth(snapshot,catalog)===catalog.reportMonth).sort((a,b)=>sourceRules.time(b.captured_at)-sourceRules.time(a.captured_at)||String(b.id).localeCompare(String(a.id)))}:catalog;
                const sectionKey=catalog.reportMonth&&key?metricOptions(metricCatalog).find(metric=>metric.keyAliases.includes(key))?.sourceSection||'':'';
                const resolved=key?resolve({kind:'metric',mode:'latest',metricKey:key,...(sectionKey?{sectionKey}:{})},metricCatalog):null;
                parts.push({token:match[0],key,label:resolved?.metric.label||key,value:resolved?.metric.value??'—',missing:!resolved});
            }
            start=match.index+match[0].length;
        }
        if(start<String(text).length)parts.push({text:String(text).slice(start)});
        return parts;
    }
    function restoreOverviewParagraphs(document){
        let changed=false;
        for(const section of document.sections.filter(item=>item.overview))for(const block of section.blocks.filter(item=>item.type==='text')){
            const text=block.text.zh;if(text.includes('\n'))continue;
            const matches=[...text.matchAll(/(?:变更操作管理|紧急变更管理|风险治理|应急预案及拓扑治理|高价值网络巡检|账号管理|License风险管理|客户例会机制)[：:]/g)];
            if(matches.length<3)continue;
            const boundaries=matches.map(match=>match.index).filter(index=>index>0),runs=block.textRuns?.zh||[{text,style:{}}],result=[];let offset=0;
            for(const run of runs){let start=0;for(const boundary of boundaries.filter(index=>index>=offset&&index<offset+run.text.length)){const local=boundary-offset;if(local>start)result.push({text:run.text.slice(start,local),style:{...run.style}});result.push({text:'\n',style:{}});start=local;}if(start<run.text.length)result.push({text:run.text.slice(start),style:{...run.style}});offset+=run.text.length;}
            block.text.zh=result.map(run=>run.text).join('');if(block.textRuns)block.textRuns.zh=result;changed=true;
        }
        return changed;
    }
    function formatOverview(document){
        let changed=false;
        for(const section of document.sections.filter(item=>item.overview))for(const block of section.blocks.filter(item=>item.type==='text')){
            if(block.overviewFormatVersion===2||!block.text.zh.trim())continue;
            const source=block.text.zh,runs=block.textRuns?.zh||[{text:source,style:{}}];
            let chars=runs.flatMap(run=>run.text.split('').map(text=>({text,style:{...run.style}})));
            const headings=[...source.matchAll(/(?:变更操作管理|紧急变更管理|风险治理|应急预案及拓扑治理|高价值网络巡检|账号管理|License风险管理|客户例会机制)[：:]/g)];
            if(headings.length<3)continue;
            for(const match of headings.reverse()){const lineStart=source.lastIndexOf('\n',match.index-1)+1;if(!/^\s*(?:\d+[.、]\s*)?$/.test(source.slice(lineStart,match.index)))chars.splice(match.index,0,{text:'\n',style:{}});}
            const lines=[];let line=[];for(const item of chars){if(item.text==='\n'){lines.push(line);line=[];}else line.push(item);}lines.push(line);
            let paragraph=0;
            chars=lines.flatMap((items,index)=>{
                const text=items.map(item=>item.text).join('');let result=items;
                if(text.trim()){
                    if(paragraph>0){const prefix=text.match(/^\s*(?:\d+[.、]\s*)?/)[0];result=items.slice(prefix.length);const number='　　'+paragraph+'. ';result=[...number.split('').map(text=>({text,style:{}})),...result];}
                    paragraph++;
                }
                if(index<lines.length-1)result=[...result,{text:'\n',style:{}}];return result;
            });
            const text=chars.map(item=>item.text).join('');
            for(const match of text.matchAll(/(?:^|\n)\s*\d+[.、]\s*[^：:\n]{1,40}[：:]|\[\[@metric:[^\]\n]+\]\]|\d+(?:[,.]\d+)*%?/g)){
                const heading=/[：:]$/.test(match[0]);for(let index=match.index;index<match.index+match[0].length;index++)chars[index].style={...chars[index].style,bold:true,color:heading?'#173c60':'#b91c1c'};
            }
            const result=[];for(const item of chars){const last=result.at(-1);if(last&&JSON.stringify(last.style)===JSON.stringify(item.style))last.text+=item.text;else result.push({text:item.text,style:item.style});}
            block.text.zh=text;block.textRuns||={zh:[],en:block.text.en?[{text:block.text.en,style:{}}]:[]};block.textRuns.zh=result;block.overviewFormatVersion=2;changed=true;
        }
        return changed;
    }
    function sampleOverview(document){
        let changed=false;
        const defaultSize=document.defaultFontSize||16;
        for(const section of document.sections.filter(item=>item.overview))for(const block of section.blocks.filter(item=>item.type==='text')){
            if(block.textRuns||!block.text.zh.trim())continue;
            block.textRuns={zh:[],en:block.text.en?[{text:block.text.en,style:{}}]:[]};
            const pattern=/\[\[@metric:[^\]\n]+\]\]|(?:^|\n)\s*\d+[.、]\s*[^：:\n]{1,32}[：:]|\d+(?:\.\d+)?%?/g;let start=0;
            for(const match of block.text.zh.matchAll(pattern)){
                if(match.index>start)block.textRuns.zh.push({text:block.text.zh.slice(start,match.index),style:{fontSize:defaultSize,color:'#203044'}});
                const heading=/[：:]$/.test(match[0]);block.textRuns.zh.push({text:match[0],style:{fontSize:defaultSize,bold:true,color:heading?'#173c60':'#b91c1c'}});start=match.index+match[0].length;
            }
            if(start<block.text.zh.length)block.textRuns.zh.push({text:block.text.zh.slice(start),style:{fontSize:defaultSize,color:'#203044'}});
            changed=true;
        }
        return changed;
    }
    function normalize(input) {
        function error() { throw new Error('Invalid monthly document'); }
        if (!input || input.version !== 1 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) error();
        const clone = JSON.parse(JSON.stringify(input)); const seen = new Set();
        function ident(obj) { if (!obj || typeof obj.id !== 'string' || !(/^[\w-]{1,80}$/).test(obj.id) || seen.has(obj.id)) error(); seen.add(obj.id); }
        function pair(value, max = 20000) { if (!value || typeof value.zh !== 'string' || typeof value.en !== 'string' || value.zh.length > max || value.en.length > max) error(); }
        function fieldAlignment(item,allowed){
            if(item.fieldAlign===undefined)return;
            if(!item.fieldAlign||typeof item.fieldAlign!=='object'||Array.isArray(item.fieldAlign))error();
            for(const [field,alignments] of Object.entries(item.fieldAlign)){
                if(!allowed.includes(field)||!alignments||typeof alignments!=='object'||Array.isArray(alignments))error();
                for(const [language,value] of Object.entries(alignments))if(!['zh','en'].includes(language)||!['left','center','right','justify'].includes(value))error();
            }
        }
        function fieldRuns(item,allowed){
            fieldAlignment(item,allowed);
            if(item.fieldRuns===undefined)return;
            if(!item.fieldRuns||typeof item.fieldRuns!=='object'||Array.isArray(item.fieldRuns))error();
            for(const [field,pairRuns] of Object.entries(item.fieldRuns)){
                if(!allowed.includes(field)||!pairRuns||typeof pairRuns!=='object')error();
                for(const language of ['zh','en']){
                    const runs=pairRuns[language];if(!Array.isArray(runs)||runs.length>2000)error();
                    for(const run of runs){
                        if(!run||typeof run.text!=='string'||run.text.length>20000||!run.style||typeof run.style!=='object')error();
                        for(const [key,value] of Object.entries(run.style)){
                            if(['color','background'].includes(key)){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))error();}
                            else if(key==='fontSize'){if(!Number.isInteger(value)||value<8||value>72)error();}
                            else if(['bold','underline'].includes(key)){if(typeof value!=='boolean')error();}else error();
                        }
                    }
                }
            }
        }
        function span(value) { if (!Number.isInteger(value) || value < 1 || value > 12) error(); }
        if(clone.inlineFormulas!==undefined)formulas.validate(clone.inlineFormulas);
        if(clone.inlineData!==undefined){sourceRules.validateSaved({catalog:clone.inlineData,resources:[]});if(clone.inlineData.month!==undefined&&clone.inlineData.month!==''&&!sourceRules.validMonth(clone.inlineData.month))error();}
        if(clone.dataRulesVersion!==undefined&&clone.dataRulesVersion!==1)error();
        if(JSON.stringify(clone).length>40000000)throw new Error('Monthly report is too large to save (40 MB maximum)');
        if(clone.reportMonth!==undefined&&clone.reportMonth!==''&&!sourceRules.validMonth(clone.reportMonth))error();
        if (clone.id && !/^[\w-]{1,80}$/.test(clone.id)) error();
        if(clone.libraryPrefs!==undefined){
            const prefs=clone.libraryPrefs;
            if(!prefs||typeof prefs!=='object'||Array.isArray(prefs))error();
            if(typeof prefs.period!=='string'||prefs.period&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(prefs.period)||typeof prefs.date!=='string'||prefs.date&&!/^\d{4}-\d{2}-\d{2}$/.test(prefs.date)||typeof prefs.group!=='string'||prefs.group.length>500||typeof prefs.search!=='string'||prefs.search.length>2000)error();
            if(prefs.rowNameColumns!==undefined&&(!prefs.rowNameColumns||typeof prefs.rowNameColumns!=='object'||Array.isArray(prefs.rowNameColumns)||Object.keys(prefs.rowNameColumns).length>5000||Object.entries(prefs.rowNameColumns).some(([id,column])=>!/^[\w-]{1,80}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||typeof column!=='string'||column.length>2000)))error();
            if(prefs.loadDays!==undefined&&(!Number.isInteger(prefs.loadDays)||prefs.loadDays<0||prefs.loadDays>36500))error();
            for(const key of ['favorites','recent'])if(prefs[key]!==undefined&&(!Array.isArray(prefs[key])||prefs[key].length>5000||prefs[key].some(value=>typeof value!=='string'||value.length>4000)))error();
            if(prefs.view!==undefined&&!['all','favorites','recent'].includes(prefs.view))error();
            if(prefs.category!==undefined&&!['','tickets','metrics','topic','meeting','raw'].includes(prefs.category))error();
            if(prefs.kind!==undefined&&(typeof prefs.kind!=='string'||prefs.kind.length>80))error();
            if(prefs.advanced!==undefined&&typeof prefs.advanced!=='boolean')error();
            for(const key of ['expandedFileIds','expandedSheetIds'])if(!Array.isArray(prefs[key])||prefs[key].length>5000||prefs[key].some(id=>typeof id!=='string'||!/^[\w-]{1,80}$/.test(id)))error();
        }
        pair(clone.title, 500); pair(clone.subtitle, 2000); pair(clone.footer);fieldRuns(clone,['title','footer']);
        if (typeof clone.logo !== 'string' || clone.logo.length > 2000 || clone.logo && !/^(\/assets\/|\/api\/upload\/monthly-logos\/[\w-]+\/image$|https?:\/\/)/.test(clone.logo) || !Number.isInteger(clone.logoWidth) || clone.logoWidth < 20 || clone.logoWidth > 400 || !['left', 'center', 'right'].includes(clone.logoAlign) || !Number.isInteger(clone.pageWidth) || clone.pageWidth < 600 || clone.pageWidth > 2000) error();
        for (const [key, fallback, min, max] of [['navRows',2,1,12],['navRowHeight',36,24,120],['navWidth',0,0,2000],['navFontSize',14,10,24],['defaultFontSize',16,8,72]]) {
            if (clone[key] === undefined) clone[key] = fallback;
            if (!Number.isInteger(clone[key]) || clone[key] < min || clone[key] > max) error();
        }
        if (clone.metaWidth === undefined) clone.metaWidth = 0;
        if (!Number.isInteger(clone.metaWidth) || clone.metaWidth < 0 || clone.metaWidth > 2000) error();
        if (clone.metaRowHeight === undefined) clone.metaRowHeight = 0;
        if (!Number.isInteger(clone.metaRowHeight) || clone.metaRowHeight < 0 || clone.metaRowHeight > 200) error();
        if (clone.metaLabelWidth === undefined) clone.metaLabelWidth = 0;
        if (!Number.isInteger(clone.metaLabelWidth) || clone.metaLabelWidth < 0 || clone.metaLabelWidth > 300) error();
        if (clone.metaAlignMode === undefined) clone.metaAlignMode = 'grid';
        if (!['grid', 'col-3', 'col-2', 'col-4', 'free', 'stretch'].includes(clone.metaAlignMode)) error();
        if (!Array.isArray(clone.meta) || clone.meta.length > 30 || !Array.isArray(clone.sections) || clone.sections.length > 100) error();
        clone.meta.forEach(item => { ident(item);fieldRuns(item,['label','value']); pair(item.label, 200); pair(item.value, 5000); span(item.span); if (item.heightUnits === undefined) item.heightUnits = 0; if (!Number.isInteger(item.heightUnits) || item.heightUnits < 0 || item.heightUnits > 20) error(); });
        let count = 0;
        clone.sections.forEach(item => {
            ident(item);fieldRuns(item,['title']); pair(item.title, 500); span(item.span); if (!Array.isArray(item.blocks)) error(); item.blocks.forEach(item => {
                if (++count > 300) error();
                if(item.tableFormats!==undefined){
                    if(!Array.isArray(item.tableFormats)||item.tableFormats.length>2000)error();
                    const cells=new Set();for(const cell of item.tableFormats){if(!cell||typeof cell.key!=='string'||cell.key.length>12000||!cell.key||cells.has(cell.key))error();cells.add(cell.key);pair(cell.value);fieldRuns(cell,['value']);}
                }
                ident(item);fieldRuns(item,['title','text']); if (!['text', 'metric', 'table', 'chart', 'summary'].includes(item.type)) error(); pair(item.title, 500); pair(item.text); pair(item.rule, 5000); span(item.span); if (!['left', 'center', 'right'].includes(item.align) || !Number.isInteger(item.limit) || item.limit < 1 || item.limit > 10000) error();
                if(item.textRuns!==undefined){
                    if(!item.textRuns||typeof item.textRuns!=='object')error();
                    for(const language of ['zh','en']){
                        const runs=item.textRuns[language];if(!Array.isArray(runs)||runs.length>2000)error();
                        for(const run of runs){if(!run||typeof run.text!=='string'||run.text.length>20000||!run.style||typeof run.style!=='object')error();for(const [key,value] of Object.entries(run.style)){if(['color','background'].includes(key)){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))error();}else if(key==='fontSize'){if(!Number.isInteger(value)||value<8||value>72)error();}else if(['bold','underline'].includes(key)){if(typeof value!=='boolean')error();}else error();}}
                        if(runs.map(run=>run.text).join('')!==item.text[language])error();
                    }
                }
                if(item.nameMappings!==undefined){const mappings=typeof module==='object'&&module.exports?require('./name-mappings'):window.MonthlyNameMappings;mappings.validate(item.nameMappings);}
                if(item.dataFormats!==undefined){const formats=typeof module==='object'&&module.exports?require('./data-formats'):window.MonthlyDataFormats;formats.validate(item.dataFormats);}
                if(item.dataFormatPresetId!==undefined&&(typeof item.dataFormatPresetId!=='string'||!/^[\w-]{1,80}$/.test(item.dataFormatPresetId)))error();
                if(item.mappingPresetId!==undefined&&(typeof item.mappingPresetId!=='string'||!/^[\w-]{1,80}$/.test(item.mappingPresetId)))error();
                if (item.heightUnits === undefined) item.heightUnits = 0;
                if (!Number.isInteger(item.heightUnits) || item.heightUnits < 0 || item.heightUnits > 100) error();
                if(item.dataUpdateMode!==undefined&&!['live','snapshot'].includes(item.dataUpdateMode))error();
                for(const saved of [item.savedData,item.previousData].filter(value=>value!==undefined)){sourceRules.validateSaved(saved);if(saved.definition){const shell=defaults();shell.sections=[{...section(),blocks:[{...block(saved.definition.type),...saved.definition}]}];normalize(shell);}}
                for(const reference of sourceRules.references(item))if(reference.value.reference)sourceRules.validate(reference.value.reference);
                if (item.binding) { const b = item.binding; if (!['metric', 'file', 'section'].includes(b.kind) || !['latest', 'pinned'].includes(b.mode) || Object.entries(b).some(([key,v]) => key!=='reference'&&(typeof v !== 'string' || v.length > 500))) error(); }
                if (!Array.isArray(item.columns) || item.columns.length > 200 || item.columns.some(v => typeof v !== 'string' || v.length > 2000) || !Array.isArray(item.filters) || item.filters.length > 20) error();
                item.filters.forEach(f => { if (typeof f.column !== 'string' || f.column.length > 2000 || !['contains', 'eq', 'neq', 'gt', 'lt', 'empty', 'notEmpty'].includes(f.op) || typeof f.value !== 'string' || f.value.length > 2000) error(); });
                if (!item.chart || !['count', 'sum'].includes(item.chart.aggregation) || typeof item.chart.x !== 'string' || typeof item.chart.y !== 'string') error();
                if(item.chart.type!==undefined&&!['column','bar','line','area','pie','donut','table'].includes(item.chart.type))error();
                if(item.chart.pivot!==undefined)pivot.validate(item.chart.pivot);
                if(item.chart.pieSeries!==undefined&&(!Number.isInteger(item.chart.pieSeries)||item.chart.pieSeries<0||item.chart.pieSeries>7))error();
                if(item.chart.axisMode!==undefined&&!['auto','linear','sqrt'].includes(item.chart.axisMode))error();
                if(item.chart.customers!==undefined&&(!Array.isArray(item.chart.customers)||item.chart.customers.length>100||item.chart.customers.some(value=>typeof value!=='string'||value.length>2000)))error();
                if(item.chart.excludeTotals!==undefined&&typeof item.chart.excludeTotals!=='boolean')error();
                for(const key of ['changePercent','changeAbsolute'])if(item.chart[key]!==undefined&&(!Number.isFinite(item.chart[key])||item.chart[key]<0||item.chart[key]>1000000))error();
                if(item.chart.series!==undefined){
                    if(!Array.isArray(item.chart.series)||item.chart.series.length>8)error();
                    for(const series of item.chart.series){if(!series||['fileId','sheetId','x','y','label'].some(key=>typeof series[key]!=='string'||series[key].length>2000))error();}
                }
                for (const language of ['zh', 'en']) for (const match of item.rule[language].matchAll(/\{([^{}]+)\}/g)) if (!['label', 'value', 'date', 'count', 'target', 'gap', 'rows'].includes(match[1])) throw new Error(`Unknown summary field: ${match[1]}`);
            });
        }); return clone;
    }
    function mergeFiles(files) {
        const groups = new Map();
        for (const file of files || []) {
            const name = String(file.name || '').replace(/\s*\(\d+\)(?=\.[^.]+$|$)/g, '').trim();
            const key = JSON.stringify([file.batch_id || file.id, name]);
            if (!groups.has(key)) groups.set(key, { ...file, name, mergedFiles: [], metricLabels: [], source_key_aliases: [], sheets: [], size: 0 });
            const group = groups.get(key); group.mergedFiles.push(file); group.size += Number(file.size) || 0;
            group.metricLabels = [...new Set([...group.metricLabels, ...file.metricLabels || []])];
            group.source_key_aliases = [...new Set([...group.source_key_aliases, file.source_key, ...file.source_key_aliases || []].filter(Boolean))];
            for (const sheet of file.sheets || []) { const existing = group.sheets.find(item => item.name === sheet.name); if (existing) existing.rowCount = (Number(existing.rowCount) || 0) + (Number(sheet.rowCount) || 0); else group.sheets.push({ ...sheet }); }
            if (file.parse_status !== 'ready') group.parse_status = file.parse_status;
        }
        return [...groups.values()];
    }

    // Expose saved child values without recalculating historical extraction rules.
    function expandMetrics(snapshot) {
        return (snapshot.metrics || []).flatMap(metric => {
            if (snapshot.kind === 'assessment') {
                const category = metric.category || metric.label.split(' / ')[0];
                return [{ ...metric, metricLevel: category === '整体' ? 'main' : 'sub', category: category === '整体' ? '' : category }];
            }
            const main = { ...metric, metricLevel: 'main', category: '' };
            const categories = new Set();
            const children = (metric.subMetrics || []).filter(child => {
                if (!child.category || categories.has(child.category)) return false;
                categories.add(child.category); return true;
            }).map(child => ({ ...metric, ...child, key: `submetric:${encodeURIComponent(metric.key)}:${encodeURIComponent(child.category)}`, parentMetricKey: metric.key, label: `${metric.label} / ${child.category}`, metricLevel: 'sub', category: child.category, subMetrics: [], sourceSelections: child.sourceSelections, savedTarget: child.savedTarget, gap: child.gap, rule: (metric.rule?.subMetrics || []).find(rule => rule.category === child.category) || null }));
            return [main, ...children];
        });
    }

    function metricOptions(catalog) {
        const groups = new Map();
        for (const snapshot of catalog.snapshots || []) for (const metric of expandMetrics(snapshot)) {
            const identity = JSON.stringify([snapshot.kind === 'assessment' ? 'assessment' : 'extraction', metric.metricLevel, metric.category, String(metric.label || '').trim()]);
            if (!groups.has(identity)) groups.set(identity, { ...metric, keyAliases: [] });
            const item = groups.get(identity);
            if (!item.keyAliases.includes(metric.key)) item.keyAliases.push(metric.key);
        }
        return [...groups.values()];
    }

    function resolve(binding, catalog) {
        if (!binding) return null;
        if(binding.reference){
            const {reference,...legacy}=binding;
            const found=sourceRules.resolve(reference,catalog,catalog.reportMonth,binding.kind==='file'?'file':'snapshot');
            if(binding.kind==='file'){if(!found)return null;const file=mergeFiles(catalog.files).find(file=>file.mergedFiles.some(item=>item.id===found.file.id));return file?{file,sheet:file.sheets.find(sheet=>sheet.name===found.sheet.name)}:null;}
            return resolve({...legacy,mode:reference.versionMode==='pinned'?'pinned':'latest',snapshotId:reference.versionId},{...catalog,snapshots:found||[]});
        }
        const snapshots = catalog.snapshots || [];
        if (binding.kind === 'metric' || binding.kind === 'section') {
            const aliases = binding.kind === 'metric' ? metricOptions(catalog).find(metric => metric.keyAliases.includes(binding.metricKey))?.keyAliases || [binding.metricKey] : [binding.metricKey];
            for (const snapshot of snapshots) {
                if (binding.kind === 'metric' && Boolean(binding.metricKey?.startsWith('assessment:')) !== Boolean(snapshot.kind === 'assessment')) continue; if (binding.mode === 'pinned' && snapshot.id !== binding.snapshotId) continue;
                const metric = expandMetrics(snapshot).find(m => aliases.includes(m.key));
                if (binding.kind === 'metric' && metric) return { snapshot, metric };
                if (binding.kind === 'metric' && binding.mode === 'latest' && binding.sectionKey && snapshot.sections.some(section => section.key === binding.sectionKey)) return null;
                const section = snapshot.sections.find(s => s.key === (binding.sectionKey || metric?.sourceSection));
                if (binding.kind === 'section' && section) return { snapshot, section, metric };
            } return null;
        }
        const file = mergeFiles(catalog.files).find(f => binding.mode === 'pinned' ? f.mergedFiles.some(member => member.id === binding.fileId) : f.source_key === binding.sourceKey || (f.source_key_aliases || []).includes(binding.sourceKey));
        if (!file) return null; const sheet = file.sheets.find(s => s.name === binding.sheetName) || (!binding.sheetName ? file.sheets[0] : null); return sheet ? { file, sheet } : null;
    }
    function filterRows(rows, filters) { return rows.filter(row => (filters || []).every(f => { const value = String(row[f.column] ?? ''); switch (f.op) { case 'contains': return value.includes(f.value); case 'eq': return value === f.value; case 'neq': return value !== f.value; case 'empty': return value.trim() === ''; case 'notEmpty': return value.trim() !== ''; case 'gt': return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > Number(f.value); case 'lt': return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) < Number(f.value); default: return false; } })); }
    function summary(item, resolved, rows, language) { const metric = resolved?.metric; const facts = { label: metric?.label ?? '—', value: metric?.value ?? '—', date: resolved?.snapshot?.captured_at ?? resolved?.file?.created_at ?? '—', count: rows.length, rows: rows.length, target: metric?.savedTarget ?? '—', gap: metric?.gap ?? '—' }; return item.rule[language].replace(/\{(\w+)\}/g, (_, key) => String(facts[key] ?? '—')); }
    function group(rows, chart) { const values = new Map(); for (const row of rows) { const key = String(row[chart.x] ?? '—'); if (!values.has(key)) values.set(key, 0); if (chart.aggregation === 'count') values.set(key, values.get(key) + 1); else { const value = row[chart.y]; if (value !== null && String(value ?? '').trim() !== '' && Number.isFinite(Number(value))) values.set(key, values.get(key) + Number(value)); } } return [...values].map(([label, value]) => ({ label, value })); }
    return { uid, bilingual, block, section, defaults, applyReportDefaults, documentMonth, prepareMonthlySave, nextSaveVersion, metricTextParts, restoreOverviewParagraphs, formatOverview, sampleOverview, normalize, mergeFiles, expandMetrics, metricOptions, resolve, filterRows, summary, group };
});
