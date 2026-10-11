/* Report references are independent of library navigation. No cross-month fallback. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlySourceRules=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    const validMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'');
    const shift=(value,offset)=>{if(!validMonth(value))return '';const date=new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5))-1+offset,1));return date.toISOString().slice(0,7);};
    const time=value=>Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value||'')?value.replace(' ','T')+'Z':value)||0;
    const identity=value=>String(value||'').replace(/20\d{2}[-_年]?(0?[1-9]|1[0-2])(?:月|(?=\b|\.|_|-))/g,'{month}');
    function fileMonth(file,catalog){
        if(validMonth(file.target_period))return file.target_period;
        const match=String(file.name||'').match(/(20\d{2})[-_年]?(0?[1-9]|1[0-2])(?:月|\b|\.|_)/);if(match)return match[1]+'-'+match[2].padStart(2,'0');
        const batch=(catalog.batches||[]).find(item=>item.id===file.batch_id);if(validMonth(batch?.target_period))return batch.target_period;
        if(batch?.target_month>=1&&batch.target_month<=12){const date=new Date(batch.created_at||file.created_at),year=date.getUTCFullYear()-(batch.target_month-(date.getUTCMonth()+1)>=6?1:0);return year+'-'+String(batch.target_month).padStart(2,'0');}return '';
    }
    function snapshotMonth(snapshot,catalog){
        if(validMonth(snapshot.target_period))return snapshot.target_period;
        const related=(catalog.snapshots||[]).find(item=>item.id===snapshot.sourceSnapshotId)||snapshot,batch=(catalog.batches||[]).find(item=>item.id===related.batch_id),target=related.targetMonth||related.target_month||batch?.target_month;
        if(validMonth(batch?.target_period))return batch.target_period;
        if(target>=1&&target<=12){const date=new Date(batch?.created_at||related.captured_at),year=date.getUTCFullYear()-(target-(date.getUTCMonth()+1)>=6?1:0);return year+'-'+String(target).padStart(2,'0');}return '';
    }
    function validate(rule){
        if(!rule||typeof rule!=='object'||!['relative','fixed','global'].includes(rule.monthMode)||!['latest','pinned'].includes(rule.versionMode)||!Number.isInteger(rule.offset)||Math.abs(rule.offset)>1200||typeof rule.month!=='string'||rule.month&&!validMonth(rule.month)||['sourceKey','sourceKind','versionId','sheetName'].some(key=>typeof rule[key]!=='string'||rule[key].length>2000))throw new Error('Invalid monthly source rule');
        if(rule.versionSignature!==undefined&&(typeof rule.versionSignature!=='string'||rule.versionSignature.length>2000))throw new Error('Invalid monthly version signature');
        return rule;
    }
    const targetMonth=(rule,reportMonth)=>rule.monthMode==='global'?'':rule.monthMode==='fixed'?rule.month:shift(reportMonth,rule.offset);
    function create(file,sheet,catalog,reportMonth,pinned=false){const period=fileMonth(file,catalog),base=validMonth(reportMonth)?reportMonth:period;return {monthMode:period&&base?'relative':'global',offset:period&&base?(Number(period.slice(0,4))-Number(base.slice(0,4)))*12+Number(period.slice(5))-Number(base.slice(5)):0,month:'',versionMode:pinned||!period?'pinned':'latest',versionId:pinned||!period?file.id:'',...(pinned||!period?{versionSignature:file.sha256||file.created_at||''}:{}),sourceKey:identity(file.source_key||file.name),sourceKind:file.kind||'original',sheetName:sheet?.name||''};}
    function resolve(rule,catalog,reportMonth,kind='file'){
        validate(rule);const period=targetMonth(rule,reportMonth);if(rule.monthMode!=='global'&&!validMonth(period))return null;
        const items=kind==='file'?catalog.files||[]:catalog.snapshots||[];
        const candidates=items.filter(item=>{
            if(rule.versionMode==='pinned'&&(item.id!==rule.versionId||rule.versionSignature&&(kind==='file'?item.sha256||item.created_at||'':item.captured_at||'')!==rule.versionSignature))return false;
            if(period&&(kind==='file'?fileMonth(item,catalog):snapshotMonth(item,catalog))!==period)return false;
            if(kind==='file')return (item.kind||'original')===rule.sourceKind&&identity(item.source_key||item.name)===rule.sourceKey&&item.sheets?.some(sheet=>!rule.sheetName||sheet.name===rule.sheetName);
            return !rule.sourceKind||item.kind===rule.sourceKind;
        }).sort((a,b)=>time(b.created_at||b.captured_at)-time(a.created_at||a.captured_at)||String(b.id).localeCompare(String(a.id)));
        if(kind!=='file')return candidates;
        const file=candidates[0],sheet=file?.sheets.find(item=>!rule.sheetName||item.name===rule.sheetName);return sheet?{file,sheet,period}:null;
    }
    function catalogGroups(catalog,period){
        const groups=new Map();for(const file of catalog.files||[]){if(period&&fileMonth(file,catalog)!==period)continue;const key=JSON.stringify([file.kind||'original',identity(file.source_key||file.name)]);if(!groups.has(key))groups.set(key,{key,versions:[]});groups.get(key).versions.push(file);}
        return [...groups.values()].map(group=>{group.versions.sort((a,b)=>time(b.created_at)-time(a.created_at)||String(b.id).localeCompare(String(a.id)));return {...group,file:group.versions[0]};});
    }
    function references(block){return [...(block.binding?[{key:'binding',value:block.binding}]:[]),...(block.chart?.pivot?.sources||[]).map((value,index)=>({key:'pivot:'+index,value})),...(block.chart?.series||[]).map((value,index)=>({key:'series:'+index,value}))];}
    function validateSaved(saved){
        if(!saved||typeof saved!=='object'||saved.month!==undefined&&!validMonth(saved.month)||!saved.catalog||!Array.isArray(saved.catalog.files)||!Array.isArray(saved.catalog.snapshots)||!Array.isArray(saved.catalog.batches)||!Array.isArray(saved.resources)||saved.resources.length>32||JSON.stringify(saved).length>12000000)throw new Error('Invalid monthly saved data');
        if(saved.definition&&(!saved.definition||Array.isArray(saved.definition)||typeof saved.definition!=='object'||Object.keys(saved.definition).some(key=>!['type','binding','chart','columns','filters','limit','rule'].includes(key))))throw new Error('Invalid monthly saved definition');
        for(const item of saved.resources){if(!item||typeof item.url!=='string'||!/^\/api\/(?:upload\/source-(?:sheets|snapshots)\/[\w%./:-]+|duty-roster\?month=\d{4}-\d{2})$/.test(item.url)||!item.data||typeof item.data!=='object')throw new Error('Invalid monthly saved resource');}
    }
    return {validMonth,shift,time,identity,fileMonth,snapshotMonth,validate,targetMonth,create,resolve,catalogGroups,references,validateSaved};
});
