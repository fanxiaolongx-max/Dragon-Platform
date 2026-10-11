(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyCatalogView=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    function date(value){const text=String(value||'');const parsed=new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)?text.replace(' ','T')+'Z':text);return Number.isNaN(parsed.getTime())?null:parsed;}
    function dateKey(value){const d=date(value);if(!d)return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
    function timeLabel(value){const d=date(value);if(!d)return '—';return `${dateKey(value)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;}
    function period(value,month){month=Number(month);if(!Number.isInteger(month)||month<1||month>12)return '';const d=date(value);if(!d)return '';const year=d.getFullYear()-(month-(d.getMonth()+1)>=6?1:0);return `${year}-${String(month).padStart(2,'0')}`;}
    function importTime(snapshot,catalog){return catalog.snapshots.find(s=>s.id===snapshot.sourceSnapshotId)?.captured_at || snapshot.captured_at;}
    function snapshotPeriod(snapshot,catalog){const related=[...new Set(catalog.snapshots.filter(s=>s.sourceSnapshotId===snapshot.id&&s.target_month).map(s=>s.target_month))];return period(importTime(snapshot,catalog),snapshot.target_month||(related.length===1?related[0]:null));}
    function groups(catalog){
        const result=new Map();const byId=new Map(catalog.snapshots.map(s=>[s.id,s]));const usedBatches=new Set();
        function add(identity,time,month,batchId,snapshot,explicitPeriod){const target=explicitPeriod||period(time,month);const key=identity+'@@'+target;let group=result.get(key);if(!group){group={id:key,importedAt:time,date:dateKey(time),period:target,targetMonth:Number(month)||null,batchIds:[],snapshots:[],fileIds:[]};result.set(key,group);}if(batchId){if(!group.batchIds.includes(batchId))group.batchIds.push(batchId);usedBatches.add(batchId);}if(snapshot&&!group.snapshots.some(s=>s.id===snapshot.id))group.snapshots.push(snapshot);}
        for(const snapshot of catalog.snapshots){const source=byId.get(snapshot.sourceSnapshotId);const identity=source?.id || (snapshot.kind==='assessment'?snapshot.sourceImportId||snapshot.id:snapshot.id);const time=source?.captured_at || snapshot.captured_at;const reports=catalog.snapshots.filter(s=>s.sourceSnapshotId===snapshot.id);const months=snapshot.target_month?[snapshot.target_month]:reports.length?[...new Set(reports.map(s=>s.target_month))]:[null];for(const month of months)add(identity,time,month,snapshot.batch_id || source?.batch_id,snapshot);}
        for(const batch of catalog.batches || [])if(!usedBatches.has(batch.id))add('batch:'+batch.id,batch.created_at,batch.target_month,batch.id,null,batch.target_period);
        for(const group of result.values()){group.fileIds=catalog.files.filter(file=>group.batchIds.includes(file.batch_id)).map(file=>file.id);}
        return [...result.values()].sort((a,b)=>(date(b.importedAt)?.getTime()||0)-(date(a.importedAt)?.getTime()||0)||b.period.localeCompare(a.period));
    }
    const REPORT_METRIC_ORDER = [
        // 1. 网络变更与整改
        '整改完成率', '整改', '整改详单',
        // 2. 风险治理
        'TOPN风险完成率', 'TOPN 风险', 'TOPN风险', 'CPT风险', '风险详单', '数字证书消减率', '数字证书', '漏洞', '详单漏洞',
        // 3. EOS治理
        '产品EOS闭环率', '全量EOS-产品', '版本EOS闭环率', '全量EOS-版本',
        '重急EOS闭环率', '重急EOS', '重急EOS收编2025', '重急EOS收编2026', '重急EOS收编',
        '重疾软件EOS', '重疾EOS预案覆盖率',
        // 4. 设备治理与存储
        '锂电池整改完成率', '锂电', '路由器整改完成率', '路由器', '存储整改完成率', '存储整改',
        // 5. 业务比对与日志
        '业务比对回传率', '业务比对备案率', '业务比对', '日志回传', '日志回传备案', '日志稽查率', '日志稽查',
        // 6. 巡检与演练
        '价值网络巡检完成率', '未完成价值网络巡检单数', '价值网络巡检', '价值网络HC', '巡检详单',
        '逃生演练完成率', '逃生演练', '详单_逃生演练', '应急演练完成率', 'iLab 应急演练',
        '拓扑刷新率', '拓扑', '预案刷新率', '预案', 'IBMS刷新率', 'IBMS',
        // 7. 服务、事件与高危拦截
        'SR FRT率', 'SR FRT', '详单-SR', '高危命令拦截次数', '高危命令拦截', 'GUI拦截次数', '图形化拦截', '事故',
        // 8. 例会与专刊
        '月度例会及报告准时完成率', '月度例会', '服务专刊季度提交', 'Jam服务专刊/季度',
        '半年度服务峰会召开', '服务峰会/半年', 'Jam客户互动月度发布', 'Jam客户活动/月度',
        // 9. 基础管理与人员
        '软件MM收编率', '软件MM', '任职率', '维护红线岗位满足率', '维护红线岗', '维护红线', '红线人员工单',
        '0工单人数', '0工单', '工单<1人数', '任职/任命不满足人数', '延期补授权完成率', '延期补授权',
        '超高风险人员', '高风险人员', '专家讲座及经验分享', '专家讲座分享',
        '夜间运维值班表', '值班表', '值班人次',
        // 10. 经营与订单
        '过保订单及SPMS', '维保订单', '业务收入', 'PS GP利润率',
        'TE备件短缺解决方案', 'TE AOS 2.0过保订单', 'ORG AOS 2.0过保订单', 'VDF AOS 2.0过保订单',
        'ET成本控制(GPR提升10%)'
    ];

    function isExpiringTicketFile(file){
        if(!file)return false;
        const text=(String(file.name||'')+' '+(Array.isArray(file.metricLabels)?file.metricLabels.join(' '):'')).toLowerCase();
        if(text.includes('值班'))return false;
        return /(整改详单|风险详单|巡检详单|详单|详表|工单|临期|超期|逾期|待办|清单|ticket|expir)/i.test(text);
    }

    function fileDisplayMetrics(file,allBatchFiles=[]){
        if(!file||!Array.isArray(file.metricLabels)||!file.metricLabels.length)return [];
        if(!Array.isArray(allBatchFiles)||allBatchFiles.length<=2)return file.metricLabels;
        const threshold=Math.max(3,Math.floor(allBatchFiles.length*0.5));
        const specific=file.metricLabels.filter(label=>{
            const matches=allBatchFiles.filter(f=>Array.isArray(f.metricLabels)&&f.metricLabels.includes(label));
            return matches.length<=threshold;
        });
        return specific;
    }

    function hasExtractedMetrics(file,allBatchFiles=[]){
        const specific=fileDisplayMetrics(file,allBatchFiles);
        return specific.length>0;
    }

    function compactFileName(name){
        const original=String(name||'');
        const stem=original.replace(/\.[a-z0-9]{1,10}$/i,'');
        return stem.replace(/^PBI_自动抓取[\s_-]*/i,'')
            .replace(/(^|[^a-z])latest(?=$|[^a-z])/gi,'$1')
            .replace(/([_-])[\s_-]+/g,'$1').replace(/[_-]+(?=\(\d+\)$)/,' ').replace(/\s{2,}/g,' ')
            .replace(/^[\s_-]+|[\s_-]+$/g,'')||stem||original;
    }

    function fileDownloadInfo(file,language='zh'){
        const en=language==='en'||language==='en-US',size=Number(file.size);
        const bytes=Number.isFinite(size)&&size>=0?(size<1024?size+' B':size<1048576?(size/1024).toFixed(1)+' KB':(size/1048576).toFixed(1)+' MB'):(en?'Unknown size':'大小未知');
        const sheets=(file.sheets||[]).map(sheet=>`${sheet.name}: ${Number.isFinite(sheet.rowCount)?sheet.rowCount:(en?'unknown':'未知')} ${en?'rows':'行'} × ${Array.isArray(sheet.headers)?sheet.headers.length:(en?'unknown':'未知')} ${en?'columns':'列'}`);
        return [file.name,(en?'File size: ':'文件大小：')+bytes,...(sheets.length?sheets:[en?'Worksheets not parsed':'工作表尚未解析'])].join('\n');
    }

    function sourceFileTitle(file,language='zh'){
        const name=String(file?.name||'');
        if(!isExpiringTicketFile({name}))return compactFileName(name);
        const types=[
            [/整改详单/i,'整改','Rectification'],
            [/CPT风险详表/i,'专项风险','Special risk'],
            [/风险详单/i,'风险','Risk'],
            [/详单.*漏洞|漏洞.*详单/i,'漏洞','Vulnerability'],
            [/详单[-_]SR(?:[-_]|\b)/i,'SR','SR'],
            [/巡检详单/i,'巡检','Inspection']
        ];
        const type=types.find(([pattern])=>pattern.test(name));
        const month=name.match(/20\d{2}年(0?[1-9]|1[0-2])月/) || name.match(/20\d{2}[-_](0?[1-9]|1[0-2])(?:[-_.]|$)/);
        const duplicate=name.match(/\((\d+)\)(?=\.[^.]+$)/);
        const label=type?type[language==='en'||language==='en-US'?2:1]:(name.replace(/\.(csv|xlsx|xls)$/i,'').replace(/^PBI_自动抓取[-_]/i,'').replace(/Latest.*$/i,'').replace(/20\d{2}年(?:0?[1-9]|1[0-2])月/g,'').replace(/详单|详表/g,'').replace(/^[-_]+|[-_]+$/g,'')||name);
        return label+(month?'-'+Number(month[1])+(language==='en'||language==='en-US'?'':'月'):'')+(duplicate?' ('+duplicate[1]+')':'');
    }

    function fileTitle(file,allBatchFiles=[],language='zh'){
        // Metric associations describe provenance, not the identity of a source table.
        // Legacy snapshots can associate batch-wide metrics with every imported file.
        return sourceFileTitle(file,language);
    }

    function fileReportRank(file,allBatchFiles=[]){
        const labels=[...fileDisplayMetrics(file,allBatchFiles),file?.name||''];
        let bestIndex=999999;
        let bestMatchLen=0;
        for(const label of labels){
            if(!label)continue;
            const lowerLabel=String(label).toLowerCase();
            for(let i=0;i<REPORT_METRIC_ORDER.length;i++){
                const rule=REPORT_METRIC_ORDER[i];
                const lowerRule=rule.toLowerCase();
                let matchLen=0;
                if(lowerLabel===lowerRule){
                    matchLen=lowerRule.length*10;
                }else if(lowerLabel.includes(lowerRule)){
                    matchLen=lowerRule.length;
                }else if(lowerRule.includes(lowerLabel)&&lowerLabel.length>=2){
                    matchLen=lowerLabel.length;
                }
                if(matchLen>0){
                    if(matchLen>bestMatchLen||(matchLen===bestMatchLen&&i<bestIndex)){
                        bestMatchLen=matchLen;
                        bestIndex=i;
                    }
                }
            }
        }
        if(bestIndex!==999999)return bestIndex;
        if(isExpiringTicketFile(file))return 900000;
        return 999999;
    }

    function sortPriorityFiles(files){
        return (files||[]).slice().sort((a,b)=>{
            const rankA=fileReportRank(a,files);
            const rankB=fileReportRank(b,files);
            if(rankA!==rankB)return rankA-rankB;
            const expA=isExpiringTicketFile(a)?1:0;
            const expB=isExpiringTicketFile(b)?1:0;
            if(expA!==expB)return expA-expB;
            return fileTitle(a,files).localeCompare(fileTitle(b,files),'zh-CN');
        });
    }

    function isExpiringTicketSection(section,catalog){
        if(!section)return false;
        const key=String(section.key||'').toLowerCase();
        if(['rectification','special','risk','vulnerability','sr'].includes(key)||/^(rectification|special|risk|vulnerability|sr)(?:[-_:]|$)/i.test(key))return true;
        const title=String(section.title||'');
        if(/(整改详单|专项风险|cpt.*风险|常规风险|风险详单|漏洞预警|详单漏洞|sr.*详单|详单.*sr|巡检详单|详单|详表|工单|临期|超期|逾期|待办|预警|清单|ticket|expir)/i.test(title))return true;
        if(Array.isArray(section.sourceFiles)&&section.sourceFiles.some(name=>isExpiringTicketFile({name})))return true;
        if(catalog?.files&&Array.isArray(section.fileIds)){
            if(section.fileIds.some(id=>isExpiringTicketFile(catalog.files.find(f=>f.id===id))))return true;
        }
        return false;
    }

    function coreTicketRank(section){
        const key=String(section?.key||'').toLowerCase();
        const title=String(section?.title||'').toLowerCase();
        if(key==='rectification'||key.startsWith('rectification')||/整改详单/.test(title)||(title.includes('整改')&&!title.includes('率')&&!title.includes('锂电')&&!title.includes('路由器')&&!title.includes('存储')))return 1;
        if(key==='special'||key.startsWith('special')||/cpt|专项风险/.test(title))return 2;
        if(key==='risk'||key.startsWith('risk')||/常规风险|风险详单/.test(title)||(title.includes('风险')&&!title.includes('topn')&&!title.includes('cpt')&&!title.includes('专项')&&!title.includes('超高风险')&&!title.includes('高风险人员')))return 3;
        if(key==='vulnerability'||key.startsWith('vulnerability')||/漏洞/.test(title))return 4;
        if(key==='sr'||key.startsWith('sr')||/详单.*sr|sr.*详单|\bsr\b/i.test(title))return 5;
        return null;
    }

    function sectionReportRank(section,catalog){
        if(!section)return 999999;
        const isTicket=isExpiringTicketSection(section,catalog);
        if(isTicket){
            const core=coreTicketRank(section);
            if(core!==null)return core;
        }
        const candidates=[];
        if(section.title){
            candidates.push(section.title);
            const cleanTitle=String(section.title)
                .replace(/^📄\s*独立表[:：]\s*/i,'')
                .replace(/\.(csv|xlsx|xls)$/i,'')
                .replace(/^PBI_自动抓取[-_]/i,'')
                .replace(/Latest.*$/i,'')
                .replace(/20\d{2}年(?:0?[1-9]|1[0-2])月/g,'')
                .replace(/^[-_]+|[-_]+$/g,'')
                .trim();
            if(cleanTitle&&cleanTitle!==section.title)candidates.push(cleanTitle);
        }
        if(section.key)candidates.push(section.key);
        if(catalog?.files&&Array.isArray(section.fileIds)){
            for(const fileId of section.fileIds){
                const file=catalog.files.find(f=>f.id===fileId);
                if(file){
                    if(file.name)candidates.push(file.name);
                    if(Array.isArray(file.metricLabels))candidates.push(...file.metricLabels);
                    const title=sourceFileTitle(file);
                    if(title)candidates.push(title);
                }
            }
        }
        if(Array.isArray(section.sourceFiles))candidates.push(...section.sourceFiles);
        if(catalog?.snapshots){
            for(const snap of catalog.snapshots){
                if(Array.isArray(snap.metrics)){
                    for(const m of snap.metrics){
                        if(m.sourceSection===section.key&&m.label)candidates.push(m.label);
                    }
                }
            }
        }

        let bestIndex=999999;
        let bestMatchLen=0;
        for(const label of candidates){
            if(!label)continue;
            const lowerLabel=String(label).toLowerCase();
            for(let i=0;i<REPORT_METRIC_ORDER.length;i++){
                const rule=REPORT_METRIC_ORDER[i];
                const lowerRule=rule.toLowerCase();
                let matchLen=0;
                if(lowerLabel===lowerRule){
                    matchLen=lowerRule.length*10;
                }else if(lowerLabel.includes(lowerRule)){
                    matchLen=lowerRule.length;
                }else if(lowerRule.includes(lowerLabel)&&lowerLabel.length>=2){
                    matchLen=lowerLabel.length;
                }
                if(matchLen>0){
                    if(matchLen>bestMatchLen||(matchLen===bestMatchLen&&i<bestIndex)){
                        bestMatchLen=matchLen;
                        bestIndex=i;
                    }
                }
            }
        }

        if(isTicket){
            if(bestIndex!==999999)return 10+(bestIndex<80?bestIndex:50);
            return 50;
        }

        if(bestIndex!==999999)return 100+bestIndex;
        return 999999;
    }

    function sortPrioritySections(sections,catalog){
        return (sections||[]).slice().sort((a,b)=>{
            const expA=isExpiringTicketSection(a,catalog)?1:0;
            const expB=isExpiringTicketSection(b,catalog)?1:0;
            if(expA!==expB)return expB-expA;
            const rankA=sectionReportRank(a,catalog);
            const rankB=sectionReportRank(b,catalog);
            if(rankA!==rankB)return rankA-rankB;
            const titleA=String(a?.title||a?.key||'');
            const titleB=String(b?.title||b?.key||'');
            return titleA.localeCompare(titleB,'zh-CN');
        });
    }

    function eligibleSnapshots(binding,catalog){return catalog.snapshots.filter(snapshot=>binding.kind==='metric'?!!binding.metricKey&&snapshot.metrics.some(metric=>metric.key===binding.metricKey):binding.kind==='section'?snapshot.kind!=='assessment'&&snapshot.sections.some(section=>!binding.sectionKey||section.key===binding.sectionKey):false);}
    return {date,dateKey,timeLabel,period,importTime,snapshotPeriod,groups,fileTitle,sourceFileTitle,compactFileName,fileDownloadInfo,isExpiringTicketFile,hasExtractedMetrics,fileDisplayMetrics,fileReportRank,sortPriorityFiles,eligibleSnapshots,REPORT_METRIC_ORDER,isExpiringTicketSection,sectionReportRank,sortPrioritySections};
});
