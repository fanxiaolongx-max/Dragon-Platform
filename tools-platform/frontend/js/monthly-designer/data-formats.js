(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyDataFormats=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    function validate(rules){
        if(!Array.isArray(rules)||rules.length>200)throw new Error('Invalid data formats');const seen=new Set();
        for(const rule of rules){if(!rule||!['column','row','all'].includes(rule.scope)||typeof rule.target!=='string'||rule.target.length>2000||rule.scope!=='all'&&!rule.target.trim()||typeof rule.field!=='string'||rule.field.length>2000||!['number','percent','percentValue'].includes(rule.format)||!Number.isInteger(rule.decimals)||rule.decimals<0||rule.decimals>8||typeof rule.thousands!=='boolean'||typeof rule.zeroAsBlank!=='boolean')throw new Error('Invalid data format');const key=JSON.stringify([rule.scope,rule.scope==='all'?'':rule.target,rule.scope==='row'?rule.field:'']);if(seen.has(key))throw new Error('Duplicate data format');seen.add(key);}return rules;
    }
    function numeric(value){
        if(typeof value==='number')return Number.isFinite(value)?{value,percent:false}:null;
        const text=String(value??'').trim();if(!text)return null;
        if(!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*[%％]?$/.test(text))return null;
        const percent=/[%％]$/.test(text),number=Number(text.replace(/,/g,'').replace(/\s*[%％]$/,''));return Number.isFinite(number)?{value:number,percent}:null;
    }
    function numericFields(tables){return [...new Set(tables.flatMap(table=>(table.headers||[]).filter(field=>(table.rows||[]).some(row=>numeric(row[field])!==null))))];}
    function numericRowNames(tables,field=''){return [...new Set(tables.flatMap(table=>{const key=field||table.headers?.[0];return (table.rows||[]).filter(row=>(table.headers||[]).some(header=>header!==key&&numeric(row[header])!==null)).map(row=>String(row[key]??'')).filter(Boolean);} ))];}
    function validateContext(rules,tables){validate(rules);const fields=numericFields(tables);for(const rule of rules){if(rule.scope==='column'&&!fields.includes(rule.target)||rule.scope==='row'&&!numericRowNames(tables,rule.field).includes(rule.target)||rule.scope==='all'&&!fields.length)throw new Error('Target has no numeric values');}return rules;}
    function format(value,rule){
        const parsed=numeric(value);if(!parsed||!rule)return String(value??'');
        let number=parsed.value;if(rule.zeroAsBlank&&number===0)return '';
        if(rule.format==='percent'&&!parsed.percent)number*=100;if(!Number.isFinite(number))return String(value??'');
        const result=new Intl.NumberFormat('en-US',{minimumFractionDigits:rule.decimals,maximumFractionDigits:rule.decimals,useGrouping:rule.thousands}).format(number).replace(/^-0(?=\.0+$|$)/,'0');
        return result+(rule.format==='number'?'':'%');
    }
    function matchesColumn(header,target){return header===target||header.split(' · ').includes(target);}
    function ruleFor(rules,header,rowLabels,category=false){
        return rules.find(rule=>rule.scope==='row'&&rowLabels.get(rule.field||'')===rule.target&&!category)||rules.find(rule=>rule.scope==='column'&&matchesColumn(header,rule.target))||(!category?rules.find(rule=>rule.scope==='all'):null);
    }
    function replace(element,text){const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);if(nodes.length){nodes[0].nodeValue=text;nodes.slice(1).forEach(node=>node.nodeValue='');}else element.textContent=text;}
    function apply(block,target){
        const rules=block.dataFormats||[];if(!rules.length)return;
        target.querySelectorAll('table').forEach(table=>{
            const headers=Array.from(table.tHead?.rows[0]?.cells||[],cell=>{const value=cell.dataset.mappingOriginal??cell.textContent;cell.dataset.mappingOriginal=value;return value;});
            for(const section of [...table.tBodies,...(table.tFoot?[table.tFoot]:[])])for(const row of section.rows){
                if(!row.dataset.formatRow)row.dataset.formatRow=row.cells[0]?.dataset.mappingOriginal??row.cells[0]?.textContent??'';
                const raw=cell=>cell.dataset.numberValue??cell.dataset.formatOriginal??cell.dataset.mappingOriginal??cell.textContent;
                const labels=new Map([['',raw(row.cells[0])]]);let position=0;for(const cell of row.cells){labels.set(headers[position]||'',raw(cell));position+=cell.colSpan;}
                position=0;for(const cell of row.cells){
                    const header=cell.dataset.numberField||headers[position]||'',category=position<(block.chart?.pivot?.rows?.length||1)||rules.some(rule=>rule.scope==='row'&&rule.field&&rule.field===header);
                    const original=raw(cell),rule=ruleFor(rules,header,labels,category);cell.dataset.formatOriginal=original;
                    if(rule){const text=format(original,rule);if(text!==cell.textContent&&numeric(original))replace(cell,text);}position+=cell.colSpan;
                }
            }
        });
        target.querySelectorAll('svg [data-number-value],.pivot-chart-totals [data-number-value]').forEach(element=>{
            const field=element.dataset.numberField||'',row=element.dataset.numberRow||'',labels=new Map([['',row],[element.dataset.numberRowField||'',row]]);
            const active=element.hasAttribute('data-number-axis')?rules.filter(rule=>rule.scope!=='row'):rules;
            const rule=ruleFor(active,field,labels);if(rule)replace(element,format(element.dataset.numberValue,rule));
        });
        const metric=target.querySelector('.document-metric');if(metric){const value=metric.querySelector('strong'),name=metric.querySelector('span')?.textContent||'',rule=rules.find(rule=>rule.scope==='column'&&rule.target===name)||rules.find(rule=>rule.scope==='all');if(value&&rule)replace(value,format(value.textContent,rule));}
    }
    return {validate,validateContext,numericFields,numericRowNames,numeric,format,matchesColumn,ruleFor,apply};
});
