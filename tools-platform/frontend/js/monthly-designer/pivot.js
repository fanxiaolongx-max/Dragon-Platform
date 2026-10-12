/* Pure, tenant-independent pivot calculations over already archived worksheet rows. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyPivot=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    const SOURCE='__monthly_source',RECORD='__monthly_record';
    const aggregations=['sum','count','countNumbers','average','min','max','distinct'];
    const operations=['eq','neq','contains','gt','gte','lt','lte','empty','notEmpty','in','notIn'];
    const total=value=>/^(?:\[?【?\s*(?:总计|合计|总合计|total|grand total)\s*】?\]?)$/i.test(String(value).trim());
    const numeric=value=>{if(value===null||value===undefined||String(value).trim()==='')return null;const text=String(value).replace(/[,，]/g,'').trim();if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(text))return null;const number=Number(text.replace('%',''));return Number.isFinite(number)?number:null;};
    const text=value=>String(value??'').trim();
    function validate(pivot){
        const fail=()=>{throw new Error('Invalid monthly document pivot');};
        const field=value=>typeof value==='string'&&value.length<=2000;
        const fields=value=>Array.isArray(value)&&value.length<=8&&value.every(field)&&new Set(value).size===value.length;
        if(!pivot||typeof pivot!=='object'||!Array.isArray(pivot.sources)||pivot.sources.length>8||!fields(pivot.rows)||!fields(pivot.columns)||!Array.isArray(pivot.values)||pivot.values.length>8||!Array.isArray(pivot.filters)||pivot.filters.length>20)fail();
        for(const source of pivot.sources){if(!source||['fileId','sheetId','label'].some(key=>!field(source[key])))fail();if(source.mapping!==undefined&&(!source.mapping||Array.isArray(source.mapping)||typeof source.mapping!=='object'||Object.keys(source.mapping).length>200||Object.entries(source.mapping).some(([key,value])=>!field(key)||!field(value)||['__proto__','constructor','prototype'].includes(key))))fail();}
        for(const value of pivot.values)if(!value||!field(value.field)||!field(value.label)||!aggregations.includes(value.aggregation))fail();
        if(pivot.filterLogic!==undefined&&!['and','or'].includes(pivot.filterLogic))fail();
        for(const filter of pivot.filters){if(!filter||!field(filter.field)||!operations.includes(filter.op)||!field(filter.value))fail();if(filter.values!==undefined&&(!Array.isArray(filter.values)||filter.values.length>500||filter.values.some(value=>!field(value))))fail();}
        if(pivot.sort!==undefined&&!['source','label','valueAsc','valueDesc'].includes(pivot.sort))fail();
        if(pivot.showTotals!==undefined&&typeof pivot.showTotals!=='boolean')fail();
        if(pivot.excludeTotals!==undefined&&typeof pivot.excludeTotals!=='boolean')fail();
        return pivot;
    }
    function matches(row,filter){const value=text(row[filter.field]),target=filter.value,number=numeric(value),other=numeric(target);switch(filter.op){case'eq':return value===target;case'neq':return value!==target;case'contains':return value.toLowerCase().includes(target.toLowerCase());case'empty':return !value;case'notEmpty':return !!value;case'in':return (filter.values||[]).includes(value);case'notIn':return !(filter.values||[]).includes(value);case'gt':return number!==null&&other!==null&&number>other;case'gte':return number!==null&&other!==null&&number>=other;case'lt':return number!==null&&other!==null&&number<other;case'lte':return number!==null&&other!==null&&number<=other;default:return false;}}
    function accumulator(){return {sum:0,numbers:0,count:0,min:Infinity,max:-Infinity,distinct:new Set()};}
    function add(state,value,field){const blank=value===null||value===undefined||text(value)==='';if(field===RECORD||!blank)state.count++;if(!blank)state.distinct.add(text(value));const number=numeric(value);if(number!==null){state.sum+=number;state.numbers++;state.min=Math.min(state.min,number);state.max=Math.max(state.max,number);}}
    function finish(state,aggregation){switch(aggregation){case'count':return state.count;case'countNumbers':return state.numbers;case'distinct':return state.distinct.size;case'average':return state.numbers?state.sum/state.numbers:null;case'min':return state.numbers?state.min:null;case'max':return state.numbers?state.max:null;default:return state.numbers?state.sum:null;}}
    function compute(pivot,tables){
        validate(pivot);
        const categories=new Map(),groups=new Map(),cells=new Map(),rowTotals=new Map(),colTotals=new Map(),grand=pivot.values.map(accumulator);let rowCount=0;
        const tuple=(row,fields)=>fields.map(field=>text(row[field]));
        const update=(map,key,row)=>{if(!map.has(key))map.set(key,pivot.values.map(accumulator));map.get(key).forEach((state,index)=>add(state,row[pivot.values[index].field],pivot.values[index].field));};
        tables.forEach((table,index)=>{const source=pivot.sources[index];if(!source)return;for(const original of table.rows||[]){
            const row=Object.assign(Object.create(null),original);for(const [canonical,field] of Object.entries(source.mapping||{}))row[canonical]=original[field];row[SOURCE]=source.label;row[RECORD]=1;
            if(pivot.excludeTotals!==false&&[...pivot.rows,...pivot.columns].filter(field=>field!==SOURCE).some(field=>total(row[field])))continue;
            if(pivot.filters.length&&!pivot.filters[pivot.filterLogic==='or'?'some':'every'](filter=>matches(row,filter)))continue;
            const parts=tuple(row,pivot.rows),columns=tuple(row,pivot.columns),rowKey=JSON.stringify(parts),colKey=JSON.stringify(columns);
            categories.set(rowKey,parts);groups.set(colKey,columns);update(cells,JSON.stringify([rowKey,colKey]),row);update(rowTotals,rowKey,row);update(colTotals,colKey,row);grand.forEach((state,i)=>add(state,row[pivot.values[i].field],pivot.values[i].field));rowCount++;
        }});
        const rowValue=key=>rowTotals.get(key)?.map((state,i)=>finish(state,pivot.values[i].aggregation))||[];
        let rows=[...categories].map(([key,parts])=>({key,parts,totals:rowValue(key)}));
        if(pivot.sort==='label')rows.sort((a,b)=>a.parts.join(' / ').localeCompare(b.parts.join(' / '),undefined,{numeric:true}));
        if(['valueAsc','valueDesc'].includes(pivot.sort)){const direction=pivot.sort==='valueAsc'?1:-1;rows.sort((a,b)=>direction*((a.totals[0]??0)-(b.totals[0]??0)));}
        const columns=[...groups].flatMap(([key,parts])=>pivot.values.map((value,index)=>({key,parts,valueIndex:index,label:value.label||value.field,aggregation:value.aggregation})));
        rows=rows.map(row=>({...row,values:columns.map(column=>{const state=cells.get(JSON.stringify([row.key,column.key]))?.[column.valueIndex];return state?finish(state,column.aggregation):null;})}));
        return {rows,columns,columnTotals:columns.map(column=>finish(colTotals.get(column.key)[column.valueIndex],column.aggregation)),grandTotals:grand.map((state,i)=>finish(state,pivot.values[i].aggregation)),rowCount};
    }
    return {SOURCE,RECORD,aggregations,operations,numeric,total,validate,compute,matches};
});
