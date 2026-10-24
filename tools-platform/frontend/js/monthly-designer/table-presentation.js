/* Display-only rules use original field names and row keys, never row offsets. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyTablePresentation=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const empty=()=>({rowField:'',nameMappings:[],hiddenColumns:[],hiddenRows:[],marks:[]});
 const text=(value,blank=false)=>typeof value==='string'&&value.length<=2000&&(blank||!!value.trim());
 const rowKey=row=>JSON.stringify([row.field,row.value]);
 const markKey=mark=>JSON.stringify([mark.scope,mark.scope==='row'?'':mark.column,mark.scope==='column'?'':mark.field,mark.scope==='column'?'':mark.value]);
 function validate(rules){
  if(!rules||typeof rules!=='object'||Array.isArray(rules))throw Error('Invalid table presentation');
  if(rules.rowField!==undefined&&!text(rules.rowField,true))throw Error('Invalid row field');
  const mappings=typeof module==='object'&&module.exports?require('./name-mappings'):window.MonthlyNameMappings;mappings.validate(rules.nameMappings);
  for(const name of ['hiddenColumns','hiddenRows','marks'])if(!Array.isArray(rules[name])||rules[name].length>500)throw Error('Invalid table presentation');
  const unique=(items,key)=>{const keys=items.map(key);if(new Set(keys).size!==keys.length)throw Error('Duplicate table presentation rule');};
  if(rules.hiddenColumns.some(column=>!text(column))||rules.hiddenRows.some(row=>!row||!text(row.field)||!text(row.value,true)))throw Error('Invalid hidden field or row');
  for(const mark of rules.marks){
   if(!mark||!['column','row','cell'].includes(mark.scope)||mark.scope!=='row'&&!text(mark.column)||mark.scope!=='column'&&(!text(mark.field)||!text(mark.value,true))||!mark.background&&!mark.color||['background','color'].some(key=>mark[key]!==undefined&&(typeof mark[key]!=='string'||!/^#[0-9a-f]{6}$/i.test(mark[key]))))throw Error('Invalid table mark');
  }
  unique(rules.hiddenColumns,value=>value);unique(rules.hiddenRows,rowKey);unique(rules.marks,markKey);
  return rules;
 }
 function scope(file,sheetName){
  const categories=typeof module==='object'&&module.exports?require('./source-category-rules'):window.MonthlySourceCategories;
  const sources=typeof module==='object'&&module.exports?require('./source-rules'):window.MonthlySourceRules;
  return JSON.stringify([categories.identity({...file,name:sources.tableName(file.name)}).key,String(sheetName||'')]);
 }
 function raw(cell){return cell?.dataset.presentationValue??cell?.dataset.mappingOriginal??cell?.textContent??'';}
 function cells(table){return Array.from(table.tHead?.rows[0]?.cells||[],(cell,index)=>({field:cell.dataset.presentationColumn??cell.dataset.mappingOriginal??cell.textContent,index}));}
 function describe(cell){
  const table=cell.closest('table[data-presentation-table]');if(!table)return null;
  const headers=cells(table),column=headers[cell.cellIndex]?.field,row=cell.parentElement,header=row.parentElement.tagName==='THEAD',field=headers.find(item=>item.field===table.dataset.presentationRowField)?.field||headers[0]?.field;
  if(!column||!field||!header&&!row.hasAttribute('data-presentation-row'))return null;
  return {table,cell,column,field,value:header?'':raw(row.cells[headers.find(item=>item.field===field)?.index??0]),header,display:cell.textContent};
 }
 function apply(block,target){
  const rules=block.tablePresentation?.rules||empty();
  for(const table of target.querySelectorAll('table[data-presentation-table]')){
   const headers=cells(table);table.dataset.presentationRowField=rules.rowField||rules.hiddenRows[0]?.field||rules.marks.find(mark=>mark.field)?.field||headers[0]?.field||'';
   for(const row of table.rows){
    if(row.parentElement.tagName==='TFOOT'){for(const cell of row.cells)if(cell.colSpan>1)cell.colSpan=Math.max(1,headers.filter(item=>!rules.hiddenColumns.includes(item.field)).length);continue;}
    const body=row.hasAttribute('data-presentation-row'),values=new Map(headers.map(({field,index})=>[field,raw(row.cells[index])])),hideRow=body&&rules.hiddenRows.some(rule=>values.has(rule.field)&&values.get(rule.field)===rule.value);
    if(hideRow){row.hidden=true;row.dataset.presentationHidden='';row.style.display='none';}
    for(const {field:column,index} of headers){const cell=row.cells[index];if(!cell)continue;
     if(rules.hiddenColumns.includes(column)){cell.hidden=true;cell.dataset.presentationHidden='';cell.style.display='none';}
     const matches=rules.marks.filter(mark=>mark.scope==='column'?mark.column===column:body&&values.has(mark.field)&&values.get(mark.field)===mark.value&&(mark.scope==='row'||mark.column===column));
     for(const mark of matches.sort((a,b)=>['column','row','cell'].indexOf(a.scope)-['column','row','cell'].indexOf(b.scope))){if(mark.background){cell.style.backgroundColor=mark.background;cell.dataset.presentationFill='';}if(mark.color){cell.style.color=mark.color;cell.dataset.presentationColor='';}}
    }
   }
  }
 }
 return {empty,validate,scope,rowKey,markKey,raw,cells,describe,apply};
});
