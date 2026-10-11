// Read-only worksheets over tenant-owned topic snapshots; no duplicate database.
const topics=require('./topic-snapshots-repository');
const engine=require('../../frontend/js/shared/topic-monthly-engine');
const fileId=(snapshotId,key)=>`ts-${snapshotId}-${key}`;
function parseId(value){const match=String(value||'').match(/^ts-(topic_[\w]+)-(eos|certificate|change|interception|sr|return|filing)(?:-s(\d+))?$/);return match?{snapshotId:match[1],key:match[2],index:match[3]===undefined?null:Number(match[3])}:null;}
const round2=val=>(val===null||val===undefined||val===''||!Number.isFinite(Number(val)))?null:Number(Number(val).toFixed(2));
function isPercentCol(col,header){if(col&&col.unit==='%')return true;const h=String(header||col?.zh||'');return h.includes('%')||h.includes('（%）')||h.includes('(%)')||h.includes('率')||h.includes('比');}
function cell(value,isPercent=false){if(value&&typeof value==='object')return typeof value.zh==='string'?value.zh:JSON.stringify(value);if(value===null||value===undefined||value==='')return null;if(typeof value==='number'&&isPercent)return round2(value);return value??null;}
function rawSheet(name,rows){const fields=new Set();for(const row of rows)for(const key of Object.keys(row))fields.add(key);const headers=[...fields];return {name,headers,rows:rows.map(row=>Object.fromEntries(headers.map(header=>[header,cell(row[header],isPercentCol(null,header))]))) };}
function tables(item,key){
    const snapshot=item.snapshot,definition=engine.get(key);
    if(!definition||definition.platform!==snapshot.platform||!engine.available(snapshot,key))return null;
    const month=engine.period(snapshot,key);if(!month)return null;
    let sheets;
    if(key==='eos'){
        if(!snapshot.data.eosProduct.length&&!snapshot.data.eosVersion.length)return null;
        const report=topics.buildEosMonthlyReport(item,month),columns={customer:'客户',quantity:'总量',incorporated:'已收编',pending:'待收编',annualPlan:'年度计划',noPlan:'无计划',currentRate:'当前完成率（%）',plannedRate:'计划完成率（%）',targetRate:'目标（%）'};
        sheets=['product','version'].map(type=>{const rows=[...report[type].accounts,{customer:'【总计】',...report[type].total}].map(row=>Object.fromEntries(Object.entries(row).filter(([field,value])=>typeof value!=='object').map(([field,value])=>{const colName=columns[field]||field;const isPercent=['currentRate','plannedRate','targetRate'].includes(field)||isPercentCol(null,colName);return [colName,cell(value,isPercent)];})));return rawSheet(type==='product'?'产品收编客户汇总':'版本收编客户汇总',rows);});
        sheets.push(rawSheet('产品EOS原始明细',snapshot.data.eosProduct),rawSheet('版本EOS原始明细',snapshot.data.eosVersion));
    }else{
        const report=engine.build(snapshot,key,month);
        sheets=report.sections.map(section=>{const headers=section.columns.map(col=>col.zh+(col.unit?`（${col.unit}）`:''));return {name:section.zh,headers,rows:section.rows.map(row=>Object.fromEntries(section.columns.map((col,index)=>[headers[index],cell(row[col.key],isPercentCol(col,headers[index]))]))) };});
        sheets.push(...report.detailSheets.map(sheet=>rawSheet(sheet.name,sheet.rows)));
    }
    const id=fileId(item.id,key),batchId=`ts-${item.id}-${month}`,name=`专题月报-${definition.title.replace(' · ','-')}-${month}.xlsx`;
    return {file:{id,batch_id:batchId,name,source_key:`专题月报:${key}`,kind:'topic_monthly',size:item.payloadBytes,parse_status:'ready',parse_error:'',created_at:item.importedAt,target_period:month,topic_key:key,source_snapshot_id:item.id,metricLabels:[definition.title]},batch:{id:batchId,created_at:item.importedAt,source:'topic_analysis',target_month:Number(month.slice(5)),target_period:month},sheets:sheets.map((sheet,index)=>({...sheet,id:`${id}-s${index}`,fileId:id}))};
}
const catalogCache = new Map();
async function catalog(){
    const files=[],batches=new Map();let offset=0;
    const currentKeys=new Set();
    const tenantId=(require('./tenant-context').getTenantId)?require('./tenant-context').getTenantId():'default';
    while(true){
        const page=await topics.listSnapshots({limit:200,offset,metadataOnly:true});
        for(const meta of page.items){
            const cacheKey=`${tenantId}:${meta.id}`;
            currentKeys.add(cacheKey);
            let cached=catalogCache.get(cacheKey);
            if(!cached){
                const item=await topics.getSnapshot(meta.id);
                if(!item?.snapshot)continue;
                const itemBatches=[],itemFiles=[];
                for(const definition of engine.list){
                    const source=tables(item,definition.key);
                    if(!source)continue;
                    itemBatches.push(source.batch);
                    itemFiles.push({...source.file,sheets:source.sheets.map(sheet=>({id:sheet.id,name:sheet.name,headers:sheet.headers,rowCount:sheet.rows.length}))});
                }
                cached={batches:itemBatches,files:itemFiles};
                catalogCache.set(cacheKey,cached);
            }
            for(const b of cached.batches) batches.set(b.id,b);
            for(const f of cached.files) files.push(f);
        }
        offset+=page.items.length;
        if(offset>=page.total||!page.items.length)break;
    }
    for(const key of catalogCache.keys()) if(key.startsWith(tenantId+':') && !currentKeys.has(key)) catalogCache.delete(key);
    return {files:files.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)),batches:[...batches.values()]};
}
async function source(value){const parsed=parseId(value);if(!parsed)return null;const item=await topics.getSnapshot(parsed.snapshotId);return item?.snapshot?{...tables(item,parsed.key),index:parsed.index}:null;}
async function getSheet(value){const result=await source(value);return result?.sheets?.[result.index]||null;}
async function getFile(value,original=false){
    const result=await source(value);if(!result?.file||result.index!==null)return null;
    if(!original)return result.file;
    const ExcelJS=require('exceljs'),workbook=new ExcelJS.Workbook();
    result.sheets.forEach((sheet,index)=>{const name=(sheet.name.replace(/[\\/?*\[\]:]/g,' ').slice(0,26)||'Sheet')+`-${index+1}`,target=workbook.addWorksheet(name);target.addRow(sheet.headers);sheet.rows.forEach(row=>target.addRow(sheet.headers.map(header=>row[header])));target.getRow(1).font={bold:true};});
    const bytes=Buffer.from(await workbook.xlsx.writeBuffer());return {...result.file,size:bytes.length,original_blob:bytes};
}
module.exports={catalog,getSheet,getFile};
