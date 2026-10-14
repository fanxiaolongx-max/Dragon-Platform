(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyMonthReview=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 function findings(document,from,to){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(to)||from===to)return [];
  const year=from.slice(0,4),month=Number(from.slice(5)),entries=[];
  const add=(owner,scope,key,label)=>{for(const language of ['zh','en']){const text=owner[key]?.[language];if(typeof text==='string'&&text.trim())entries.push({scope,id:owner.id||'',key,language,label,text});}};
  for(const key of ['title','subtitle','footer'])add(document,'document',key,key);
  for(const item of document.meta||[])if(!item.autoFill)add(item,'meta','value',item.label?.zh||'');
  for(const section of document.sections||[]){add(section,'section','title',section.title?.zh||'');for(const block of section.blocks||[]){add(block,'block','title',block.title?.zh||section.title?.zh||'');if(['text','summary'].includes(block.type))add(block,'block',block.type==='summary'?'rule':'text',block.title?.zh||section.title?.zh||'');}}
  const pattern=new RegExp(`(^|[^\\d])(?:${year}[-/.]0?${month}(?!\\d)|${year}年\\s*0?${month}月|0?${month}月)|\\b(?:${months[month-1]}|${months[month-1].slice(0,3)}${month===9?'|Sept':''})\\b|截至月底|截至本月底|截至上月底|上个月|上月|本月|\\b(?:last month|this month|month[ -]end)\\b`,'gi');
  return entries.flatMap(entry=>{
   // Ignore reference syntax; dynamic values are checked by the existing update preview.
   const manual=entry.text.replace(/\[\[@(?:metric|formula):[^\]\n]+\]\]/g,token=>' '.repeat(token.length));
   const matches=[...manual.matchAll(pattern)].map(match=>{const prefix=match[1]||'';return {text:match[0].slice(prefix.length),index:match.index+prefix.length};});
   return matches.length?[{...entry,matches}]:[];
  });
 }
 return {findings};
});
