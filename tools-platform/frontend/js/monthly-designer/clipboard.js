/* Transfer references as validated data, never paste arbitrary clipboard HTML. */
(function(){
 'use strict';
 const mime='application/x-monthly-rich-text',marker='data-monthly-clipboard';
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function validate(payload){
  if(!payload||payload.version!==1||!Array.isArray(payload.runs)||payload.runs.length>2000)throw Error('Invalid clipboard');
  let length=0;for(const run of payload.runs){if(typeof run?.text!=='string'||!run.style||typeof run.style!=='object'||Array.isArray(run.style))throw Error('Invalid clipboard');length+=run.text.length;for(const [key,value] of Object.entries(run.style)){if(['color','background'].includes(key)){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw Error('Invalid style');}else if(key==='fontSize'){if(!Number.isInteger(value)||value<8||value>72)throw Error('Invalid style');}else if(['bold','underline'].includes(key)){if(typeof value!=='boolean')throw Error('Invalid style');}else throw Error('Invalid style');}}
  if(length>20000)throw Error('Clipboard too large');MonthlyMetricFormulas.validate(payload.formulas);
  const text=payload.runs.map(run=>run.text).join('');for(const match of text.matchAll(/\[\[@formula:([^\]\n]+)\]\]/g))if(!payload.formulas.some(item=>item.id===match[1]))throw Error('Missing formula');
  return payload;
 }
 function start(api){
  function fieldOf(target){const field=target.closest?.('.document-edit[contenteditable=true]');return field&&api.root.contains(field)&&field.getAttribute('aria-readonly')!=='true'?field:null;}
  function selected(field){const selection=getSelection();if(!selection.rangeCount)return null;const range=selection.getRangeAt(0).cloneRange();if(!field.contains(range.startContainer)||!field.contains(range.endContainer))return null;for(const chip of field.querySelectorAll('[data-metric-token]')){if(chip.contains(range.startContainer))range.setStartBefore(chip);if(chip.contains(range.endContainer))range.setEndAfter(chip);}return range;}
  function selectionRuns(field,range){const prefix=range.cloneRange();prefix.selectNodeContents(field);prefix.setEnd(range.startContainer,range.startOffset);const length=fragment=>MonthlyRichText.read(fragment).reduce((sum,run)=>sum+run.text.length,0),start=length(prefix.cloneContents()),end=start+length(range.cloneContents());let offset=0;return MonthlyRichText.read(field).flatMap(run=>{const from=Math.max(0,start-offset),to=Math.min(run.text.length,end-offset);offset+=run.text.length;return to>from?[{text:run.text.slice(from,to),style:run.style}]:[];});}
  function copy(event){const field=fieldOf(event.target),range=field&&selected(field);if(!range||range.collapsed||!event.clipboardData||!range.cloneContents().querySelector('[data-metric-token]'))return;const runs=selectionRuns(field,range),text=runs.map(run=>run.text).join(''),catalog=api.getCatalog(),formulas=(catalog.inlineFormulas||[]).filter(item=>text.includes('[[@formula:'+item.id+']]'));let payload;try{payload=validate({version:1,runs,formulas});}catch(_){return;}const json=JSON.stringify(payload),plain=range.toString();event.clipboardData.setData('text/plain',plain);event.clipboardData.setData('text/html',`<div ${marker}="${escape(encodeURIComponent(json))}">${api.render(text,runs,catalog)}</div>`);try{event.clipboardData.setData(mime,json);}catch(_){}event.preventDefault();if(event.type==='cut')api.commit([],()=>{range.deleteContents();field.focus();getSelection().removeAllRanges();range.collapse(true);getSelection().addRange(range);},field);}
  api.root.addEventListener('copy',copy);api.root.addEventListener('cut',copy);
  function paste(event){const field=fieldOf(event.target),range=field&&selected(field);if(!field||!range||!event.clipboardData)return false;let payload;try{let raw=event.clipboardData.getData(mime);if(!raw){const html=event.clipboardData.getData('text/html');if(!html||html.length>1000000)return false;raw=new DOMParser().parseFromString(html,'text/html').querySelector('['+marker+']')?.getAttribute(marker);if(!raw)return false;raw=decodeURIComponent(raw);}if(raw.length>500000)return false;payload=validate(JSON.parse(raw));}catch(_){return false;}
   const catalog=api.getCatalog(),imported=MonthlyMetricFormulas.importBlock(payload.runs,payload.formulas,catalog.inlineFormulas||[],MonthlyDocumentEngine.uid),definitions=imported.definitions.slice((catalog.inlineFormulas||[]).length);try{MonthlyMetricFormulas.validate(imported.definitions);}catch(_){return false;}
   const runs=imported.block,text=runs.map(run=>run.text).join(''),template=document.createElement('template');template.innerHTML=api.render(text,runs,{...catalog,inlineFormulas:imported.definitions});const fragment=template.content,last=fragment.lastChild;
   event.preventDefault();api.commit(definitions,()=>{range.deleteContents();range.insertNode(fragment);if(last)range.setStartAfter(last);range.collapse(true);field.focus();getSelection().removeAllRanges();getSelection().addRange(range);},field);return true;
  }
  return {paste};
 }
 window.MonthlyClipboard={start};
})();
