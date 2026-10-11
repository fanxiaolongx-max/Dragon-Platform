(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlySourceTableRules=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function typeKey(file){return String(file.source_key||file.name||'').replace(/\.[^.]+$/,'').replace(/^PBI_自动抓取[\s_-]*/i,'').replace(/latest.*$/i,'').replace(/20\d{2}年\d{1,2}月|20\d{2}[-_]\d{2}(?:[-_]\d{2})?/g,'').replace(/[\s_-]+$/,'').toLowerCase();}
 function validate(rules){if(!Array.isArray(rules)||rules.length>200)throw new Error('最多200条规则 / Up to 200 rules');for(const r of rules){if(!r||!['header','replace'].includes(r.kind)||typeof r.from!=='string'||!r.from||r.from.length>2000||typeof r.to!=='string'||r.to.length>2000||typeof r.column!=='string')throw new Error('规则不完整 / Invalid rule');if(r.kind==='header'&&!r.to.trim())throw new Error('表头不能为空 / Empty header');}return rules;}
 function apply(table,rules){validate(rules);let headers=[...table.headers],rows=table.rows.map(row=>({...row}));for(const r of rules){if(r.kind==='header'){if(!headers.includes(r.from)||r.from===r.to)continue;if(headers.includes(r.to))throw new Error('表头名称重复 / Duplicate header: '+r.to);headers=headers.map(h=>h===r.from?r.to:h);rows=rows.map(row=>{return Object.fromEntries(Object.entries(row).map(([key,value])=>[key===r.from?r.to:key,value]));});}else for(const row of rows)for(const h of headers){if(r.column&&r.column!==h)continue;const value=row[h];if(value===null||value===undefined)continue;const text=String(value);if(r.contains?text.includes(r.from):text===r.from)row[h]=r.contains?text.split(r.from).join(r.to):r.to;}}return {...table,headers,rows};}
 function applyOperations(table,operations){
  if(!Array.isArray(operations)||operations.length>2000)throw new Error('Invalid table operations');
  let result={...table,headers:[...table.headers],rows:table.rows.map(row=>({...row}))};
  for(const op of operations){
   if(op?.kind==='rules')result=apply(result,op.rules);
   else if(op?.kind==='cell'&&Number.isInteger(op.row)&&op.row>=0&&op.row<result.rows.length&&result.headers.includes(op.column)&&typeof op.value==='string'&&op.value.length<=100000)result.rows[op.row][op.column]=op.value;
   else throw new Error('Invalid table operation');
  }
  return result;
 }
 return {typeKey,validate,apply,applyOperations};
});
