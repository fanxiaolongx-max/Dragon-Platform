(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyNameMappings=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    function validate(rules){
        if(!Array.isArray(rules)||rules.length>200)throw new Error('Invalid name mappings');
        const seen=new Set();
        for(const rule of rules){
            if(!rule||!['column','row'].includes(rule.kind)||typeof rule.from!=='string'||!rule.from.trim()||rule.from.length>2000||typeof rule.to!=='string'||!rule.to.trim()||rule.to.length>2000||rule.field!==undefined&&(typeof rule.field!=='string'||rule.field.length>2000))throw new Error('Invalid name mapping');
            const key=JSON.stringify([rule.kind,rule.field||'',rule.from]);if(seen.has(key))throw new Error('Duplicate name mapping');seen.add(key);
        }
        return rules;
    }
    function label(value,rules,kind,field=''){
        const text=String(value??''),rule=rules?.find(rule=>rule.kind===kind&&rule.from===text&&(!rule.field||rule.field===field));
        return rule?rule.to:text;
    }
    function columnLabel(value,rules){return String(value??'').split(' · ').map(part=>label(part,rules,'column')).join(' · ');}
    function replaceText(element,text){
        const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
        if(nodes.length){nodes[0].nodeValue=text;nodes.slice(1).forEach(node=>node.nodeValue='');}else element.textContent=text;
    }
    function apply(block,target){
        const rules=block.nameMappings||[];if(!rules.length)return;
        target.querySelectorAll('table').forEach(table=>{
            const cells=Array.from(table.tHead?.rows[0]?.cells||[]),headers=cells.map(cell=>cell.dataset.mappingOriginal??cell.textContent);
            for(const row of table.tHead?.rows||[])for(const cell of row.cells){const original=cell.textContent;cell.dataset.mappingOriginal=original;const display=columnLabel(original,rules);if(display!==original)replaceText(cell,display);}
            for(const row of table.tBodies[0]?.rows||[]){
                if(!row.dataset.formatRow)row.dataset.formatRow=row.cells[0]?.textContent||'';
                Array.from(row.cells).forEach((cell,index)=>{
                    const field=headers[index]||'',original=cell.textContent;cell.dataset.mappingOriginal=original;
                    const applicable=rules.filter(rule=>rule.kind==='row'&&(rule.field?rule.field===field:index<(block.chart?.pivot?.rows?.length||1)));
                    const display=label(original,applicable,'row',field);if(display!==original)replaceText(cell,display);
                });
            }
        });
        target.querySelectorAll('svg text').forEach(element=>{const original=element.textContent,display=label(original,rules,'row');if(display!==original)replaceText(element,display);else{const column=columnLabel(original,rules);if(column!==original)replaceText(element,column);}});
    }
    return {validate,label,columnLabel,apply};
});
