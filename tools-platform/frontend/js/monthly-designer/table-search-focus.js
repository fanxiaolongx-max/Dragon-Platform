(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyTableSearchFocus=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const text=value=>value&&typeof value==='object'?JSON.stringify(value):String(value??'');
 const fold=value=>text(value).normalize('NFKC').toLowerCase();
 function build(table,context,rules=[]){
  const rows=new Map(),columns=new Set(),query=typeof context?.query==='string'?context.query.trim():'';if(!query)return {rows,columns};const needle=fold(query);
  const record=(row,column)=>{if(!rows.has(row))rows.set(row,new Set());if(column>=0){rows.get(row).add(column);columns.add(column);}};
  table.headers.forEach((header,index)=>{if(fold(header).includes(needle))columns.add(index);});
  table.rows.forEach((row,index)=>table.headers.forEach((header,column)=>{if(fold(row[header]).includes(needle))record(index,column);}));
  const hit=context.hit||{};let field=hit.field;
  if(hit.kind==='mapping'){const alias=rules.find(rule=>rule.kind==='header'&&`${rule.from} → ${rule.to}`===field);if(alias)field=alias.to;}
  if(typeof field==='string'&&!table.headers.includes(field)){for(const rule of rules)if(rule.kind==='header'&&field===rule.from)field=rule.to;}
  const column=table.headers.indexOf(field),row=Number.isInteger(hit.rowNumber)?hit.rowNumber-1:-1;
  if(['original-content','mapping'].includes(hit.kind)&&row>=0&&row<table.rows.length)record(row,column);
  if(['column','original-column','mapping'].includes(hit.kind)&&row<0&&column>=0)columns.add(column);
  return {rows,columns};
 }
 return {text,build};
});
