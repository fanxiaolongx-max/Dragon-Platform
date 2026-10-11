(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyMetricFormulas=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const fail=code=>{const error=new Error(code);error.code=code;throw error;};
 function number(value){
  if(typeof value==='number'){if(Number.isFinite(value))return value;fail('non_numeric');}
  if(typeof value!=='string'||!value.trim())fail('non_numeric');
  const text=value.trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?:[eE][+-]?\d+)?%?$/.test(text))fail('non_numeric');
  const result=Number(text.replace(/,/g,'').replace(/%$/,''))/(text.endsWith('%')?100:1);if(!Number.isFinite(result))fail('non_numeric');return result;
 }
 function compile(expression){
  if(typeof expression!=='string'||!expression.trim()||expression.length>200)fail('invalid_expression');
  const normalized=expression.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').toUpperCase(),tokens=[];let offset=0;
  while(offset<normalized.length){if(/\s/.test(normalized[offset])){offset++;continue;}const match=normalized.slice(offset).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|^[A-Z]+|^[+\-*/^(),]/);if(!match)fail('invalid_expression');tokens.push(match[0]);offset+=match[0].length;if(tokens.length>120)fail('invalid_expression');}
  let index=0,depth=0;const variables=new Set();
  const take=value=>tokens[index]===value&&(index++,true);
  const required=value=>{if(!take(value))fail('invalid_expression');};
  function primary(){
   if(++depth>24)fail('invalid_expression');let node;const token=tokens[index++];
   if(token==='('){node=sum();required(')');}
   else if(token==='A'||token==='B'){variables.add(token);node={variable:token};}
   else if(['MIN','MAX','ABS','ROUND'].includes(token)){required('(');const args=[sum()];while(take(','))args.push(sum());required(')');if(args.length>16||token==='ABS'&&args.length!==1||token==='ROUND'&&(args.length<1||args.length>2)||['MIN','MAX'].includes(token)&&args.length<2)fail('invalid_expression');node={call:token,args};}
   else if(token&&/^(?:\d|\.)/.test(token)){const value=Number(token);if(!Number.isFinite(value))fail('non_finite');node={value};}
   else fail('invalid_expression');depth--;return node;
  }
  function power(){const left=primary();return take('^')?{op:'^',left,right:unary()}:left;}
  function unary(){return take('+')?unary():take('-')?{negate:unary()}:power();}
  function product(){let node=unary();while(['*','/'].includes(tokens[index])){const op=tokens[index++];node={op,left:node,right:unary()};}return node;}
  function sum(){let node=product();while(['+','-'].includes(tokens[index])){const op=tokens[index++];node={op,left:node,right:product()};}return node;}
  const tree=sum();if(index!==tokens.length)fail('invalid_expression');if(!variables.has('A')||!variables.has('B'))fail('two_variables_required');return tree;
 }
 function evaluate(expression,a,b){
  const tree=compile(expression),values={A:number(a),B:number(b)};
  function walk(node){
   let result;
   if(node.variable)return values[node.variable];if(node.value!==undefined)return node.value;
   if(node.negate)result=-walk(node.negate);
   else if(node.call){const args=node.args.map(walk);if(node.call==='ABS')result=Math.abs(args[0]);if(node.call==='MIN')result=Math.min(...args);if(node.call==='MAX')result=Math.max(...args);if(node.call==='ROUND'){const digits=args[1]??0;if(!Number.isInteger(digits)||Math.abs(digits)>6)fail('invalid_precision');const scale=10**digits;result=Math.sign(args[0])*Math.round((Math.abs(args[0])+Number.EPSILON)*scale)/scale;}}
   else{const left=walk(node.left),right=walk(node.right);if(node.op==='+')result=left+right;if(node.op==='-')result=left-right;if(node.op==='*')result=left*right;if(node.op==='/'){if(right===0)fail('division_by_zero');result=left/right;}if(node.op==='^')result=left**right;}
   if(!Number.isFinite(result))fail('non_finite');return result;
  }
  return walk(tree);
 }
 function display(value,digits=2,percent=false){const scaled=value*(percent?100:1);if(!Number.isFinite(scaled))fail('non_finite');return String(Number(scaled.toFixed(digits)))+(percent?'%':'');}
 function sourceKeys(text){
  if(typeof text!=='string')return null;
  const matches=[...text.matchAll(/\[\[@metric:([^\]\n]+)\]\]/g)];if(matches.length!==2||text.replace(/\[\[@metric:[^\]\n]+\]\]/g,'').match(/[^ \t\u00a0]/))return null;
  try{return matches.map(match=>decodeURIComponent(match[1]));}catch(_){return null;}
 }
 function validate(items){
  if(!Array.isArray(items)||items.length>2000)fail('invalid_formula');const ids=new Set();
  for(const item of items){
   if(!item||typeof item.id!=='string'||!/^[\w-]{1,80}$/.test(item.id)||ids.has(item.id)||!Array.isArray(item.keys)||item.keys.length!==2||item.keys.some(key=>typeof key!=='string'||!key||key.length>2000)||!Number.isInteger(item.digits)||item.digits<0||item.digits>6||typeof item.percent!=='boolean')fail('invalid_formula');ids.add(item.id);compile(item.expression);
   if(typeof item.originalText!=='string'||item.originalText.length>12000||JSON.stringify(sourceKeys(item.originalText))!==JSON.stringify(item.keys)||!Array.isArray(item.originalRuns)||item.originalRuns.length>20||item.originalRuns.map(run=>run?.text).join('')!==item.originalText)fail('invalid_formula');
   for(const run of item.originalRuns){if(!run||typeof run.text!=='string'||!run.style||typeof run.style!=='object'||Array.isArray(run.style))fail('invalid_formula');for(const [key,value] of Object.entries(run.style)){if(['color','background'].includes(key)){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))fail('invalid_formula');}else if(key==='fontSize'){if(!Number.isInteger(value)||value<8||value>72)fail('invalid_formula');}else if(['bold','underline'].includes(key)){if(typeof value!=='boolean')fail('invalid_formula');}else fail('invalid_formula');}}
  }
 }
 function importBlock(block,definitions,existing,uid){
  const serialized=JSON.stringify(block),used=definitions.filter(item=>serialized.includes('[[@formula:'+item.id+']]')),mapping=new Map(used.map(item=>[item.id,uid()]));
  const remap=value=>{if(typeof value==='string')return value.replace(/\[\[@formula:([\w-]+)\]\]/g,(token,id)=>mapping.has(id)?'[[@formula:'+mapping.get(id)+']]':token);if(Array.isArray(value))return value.map(remap);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,remap(item)]));return value;};
  return {block:remap(block),definitions:[...existing,...used.map(item=>({...item,id:mapping.get(item.id)}))]};
 }
 return {number,compile,evaluate,display,sourceKeys,validate,importBlock};
});
