(function(){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function renderText(text,catalog,label,runs,resolveMetrics=true){
  const parts=resolveMetrics?MonthlyDocumentEngine.metricTextParts(text,catalog):[{text}];
  const styled=runs&&runs.map(run=>run.text).join('')===text;let offset=0;
  const spans=[];let end=0;if(styled)for(const run of runs){spans.push({start:end,end:end+run.text.length,style:run.style||{}});end+=run.text.length;}
  const wrap=(html,s={})=>{const styles=[s.bold!==undefined?`font-weight:${s.bold?700:400}`:'',s.underline!==undefined?`text-decoration:${s.underline?'underline':'none'}`:'',s.fontSize?`font-size:${s.fontSize}px`:'',s.color?`color:${s.color}`:'',s.background?`background-color:${s.background}`:''].filter(Boolean).join(';');return styles?`<span style="${escape(styles)}">${html}</span>`:html;};
  return parts.map(part=>{
   const start=offset;offset+=(part.token||part.text).length;
   if(part.token){const html=`<span class="inline-metric${part.formulaId?' inline-formula':''}" contenteditable="false" ${part.formulaId?'data-formula-id="'+escape(part.formulaId)+'"':''} data-metric-token="${escape(part.token)}" title="${escape(label(part.label))}">${escape(part.value)}</span>`;return wrap(html,spans.find(run=>run.start<=start&&run.end>start)?.style);}
   if(!styled)return escape(part.text);
   return spans.filter(run=>run.end>start&&run.start<offset).map(run=>wrap(escape(part.text.slice(Math.max(0,run.start-start),Math.min(part.text.length,run.end-start))),run.style)).join('');
  }).join('');
 }
 function serialize(element){
  const read=node=>node.nodeType===3?node.textContent:node.dataset?.metricToken|| (node.nodeName==='BR'?'\n':(node.nodeName==='DIV'&&node.previousSibling?'\n':'')+Array.from(node.childNodes).map(read).join(''));
  return Array.from(element.childNodes).map(read).join('');
 }
 function start(api){
  const root=api.root,dialog=api.dialog,t=api.t;let menu=null;
  const recentMetrics=[];
  const close=()=>{menu?.remove();menu=null;};
  document.addEventListener('pointerdown',event=>{if(menu&&!menu.contains(event.target))close();});
  function textField(target){
   const field=target.closest?.('.document-edit[contenteditable=true]');
   if(field&&root.contains(field)&&field.getAttribute('aria-readonly')!=='true')return field;
   const input=target.closest?.('input,textarea');
   return input&&!input.disabled&&!input.readOnly&&(dialog.contains(input)||input.closest('[data-inspector-editor]'))&&/^(?:title|text|rule)(?:Zh|En)$/.test(input.name)?input:null;
  }
  function openMetric(field,range,existing=null){
   close();const toolbar=document.querySelector('.rich-text-toolbar');if(toolbar)toolbar.hidden=true;const input=field.matches('input,textarea'),selection=getSelection();
   const rect=existing?.getBoundingClientRect?.()||(input?field.getBoundingClientRect():range.getBoundingClientRect()),fallback=field.getBoundingClientRect();
   const options=MonthlyDocumentEngine.metricOptions(api.getCatalog());let selectedKey='';
   try{selectedKey=decodeURIComponent(existing?.dataset.metricToken?.slice(10,-2)||'');}catch(_){}
   const selected=options.find(metric=>metric.key===selectedKey||metric.keyAliases?.includes(selectedKey));
   menu=document.createElement('div');menu.className='metric-mention-menu';menu.setAttribute('role','dialog');menu.setAttribute('aria-label',t(existing?'编辑指标引用':'引用指标',existing?'Edit metric reference':'Insert metric'));
   menu.innerHTML=`<strong>${t(existing?'编辑指标引用':'引用指标值',existing?'Edit metric reference':'Insert metric value')}</strong><button type="button" data-close aria-label="${t('关闭','Close')}">×</button><label>${t('指标来源','Source')}<select data-source><option value="extraction">${t('导入提取','Imported metrics')}</option><option value="assessment">${t('报表考核','Assessment')}</option></select></label><label>${t('指标层级','Level')}<select data-level><option value="main">${t('主指标','Main')}</option><option value="sub">${t('子指标','Child')}</option></select></label><label data-category-label>${t('全局分类','Global category')}<select data-category></select></label><input data-search aria-label="${t('搜索指标','Search metrics')}" placeholder="${t('搜索提取指标','Search metrics')}"><div data-results></div>`;
   // A picker for a modal form must be inside that dialog to remain interactive.
   (dialog.open&&dialog.contains(field)?dialog:document.body).append(menu);
   menu.style.left=Math.max(8,Math.min(rect.left||fallback.left,innerWidth-menu.offsetWidth-8))+'px';
   const source=menu.querySelector('[data-source]'),level=menu.querySelector('[data-level]'),category=menu.querySelector('[data-category]'),search=menu.querySelector('[data-search]');
   const metrics=()=>options.filter(metric=>(metric.key.startsWith('assessment:')?'assessment':'extraction')===source.value&&metric.metricLevel===level.value);
   const draw=()=>{
    const q=search.value.trim().toLowerCase(),eligible=metrics().filter(metric=>level.value!=='sub'||!category.value||metric.category===category.value);
    const items=q?eligible.filter(metric=>api.metricLabel(metric.label).toLowerCase().includes(q)):[...new Set([selectedKey,...recentMetrics])].map(key=>eligible.find(metric=>metric.key===key)).filter(Boolean).slice(0,3);
    menu.querySelector('[data-results]').innerHTML=(q?'':items.length?`<small>${t('最近使用','Recently used')}</small>`:'')+items.map(metric=>`<button type="button" data-key="${escape(metric.key)}" aria-pressed="${metric.key===selectedKey}">${escape(api.metricLabel(metric.label))}</button>`).join('')+(q&&!items.length?`<p>${t('暂无匹配指标','No matching metrics')}</p>`:`<small>${t('输入名称搜索指标','Type a name to find metrics')}</small>`);
    menu.style.top=Math.max(8,Math.min((rect.bottom||fallback.top)+6,innerHeight-menu.offsetHeight-8))+'px';
   };
   const reset=()=>{menu.querySelector('[data-category-label]').hidden=level.value!=='sub';category.innerHTML=`<option value="">${t('全部分类','All categories')}</option>`+[...new Set(metrics().map(metric=>metric.category).filter(Boolean))].map(value=>`<option>${escape(value)}</option>`).join('');draw();};
   source.onchange=level.onchange=reset;category.onchange=search.oninput=draw;
   const restore=()=>{close();if(!field.isConnected)return;field.focus();if(input)field.setSelectionRange(range.start,range.end);else if(field.contains(range.commonAncestorContainer)){selection.removeAllRanges();selection.addRange(range);}};
   menu.querySelector('[data-close]').onclick=restore;
   menu.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();restore();}};
   menu.onclick=event=>{
    const key=event.target.closest('[data-key]')?.dataset.key;if(!key)return;
    if(!field.isConnected||!input&&existing&&!existing.isConnected){close();return;}
    const token='[[@metric:'+encodeURIComponent(key)+']]';
    field.focus();
    if(input){field.setRangeText(token,range.start,range.end,'end');field.dispatchEvent(new Event('input',{bubbles:true}));}
    else{
     const holder=document.createElement('span');holder.innerHTML=renderText(token,api.getCatalog(),api.metricLabel);const chip=holder.firstChild;
     if(existing){chip.style.cssText=existing.style.cssText;existing.replaceWith(chip);range.setStartAfter(chip);}
     else{range.deleteContents();range.insertNode(chip);const space=document.createTextNode(' ');chip.after(space);range.setStartAfter(space);}
     range.collapse(true);selection.removeAllRanges();selection.addRange(range);api.commitText(field);
    }
    const previous=recentMetrics.indexOf(key);if(previous!==-1)recentMetrics.splice(previous,1);recentMetrics.unshift(key);recentMetrics.length=Math.min(recentMetrics.length,3);close();
   };
   if(selected){source.value=selected.key.startsWith('assessment:')?'assessment':'extraction';level.value=selected.metricLevel;search.value=api.metricLabel(selected.label);}
   reset();if(selected?.category){category.value=selected.category;draw();}search.focus();search.select();
  }
  function insertMetric(event){
   if(event.isComposing)return;const field=textField(event.target);if(!field)return;
   const input=field.matches('input,textarea'),selection=getSelection();
   if(!input&&!selection?.rangeCount)return;
   const range=input?{start:field.selectionStart,end:field.selectionEnd}:selection.getRangeAt(0).cloneRange();
   if(!input&&(!field.contains(range.startContainer)||!field.contains(range.endContainer)))return;
   if(!input)for(const chip of field.querySelectorAll('[data-metric-token]')){if(chip.contains(range.startContainer))range.setStartBefore(chip);if(chip.contains(range.endContainer))range.setEndAfter(chip);}
   event.preventDefault();openMetric(field,range);
  }
  document.addEventListener('keydown',event=>{if(event.key==='@')insertMetric(event);});
  document.addEventListener('beforeinput',event=>{if(event.inputType==='insertText'&&event.data==='@')insertMetric(event);});
  let metricPointer=null;
  root.addEventListener('pointerdown',event=>{
   const selection=getSelection();metricPointer={x:event.clientX,y:event.clientY,range:selection?.rangeCount?selection.getRangeAt(0).cloneRange():null};
  });
  root.addEventListener('click',event=>{
   const pointer=metricPointer;metricPointer=null;
   const chip=event.target.closest('.inline-metric'),field=chip&&textField(chip);if(!field)return;
   // A drag already established a text selection. Do not collapse it to the final metric.
   if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>4&&!getSelection().isCollapsed)return;
   if(chip.dataset.formulaId){event.preventDefault();openFormula(field,null,chip);return;}
   if(event.shiftKey&&pointer?.range&&field.contains(pointer.range.commonAncestorContainer)){
    const selected=pointer.range.cloneContents().querySelectorAll('.inline-metric:not(.inline-formula)');
    const anchor=selected.length===1?Array.from(field.querySelectorAll('.inline-metric:not(.inline-formula)')).find(item=>pointer.range.intersectsNode(item)):null;
    if(anchor&&anchor!==chip){const chips=Array.from(field.querySelectorAll('.inline-metric')),range=document.createRange();range.setStartBefore(chips.indexOf(anchor)<chips.indexOf(chip)?anchor:chip);range.setEndAfter(chips.indexOf(anchor)<chips.indexOf(chip)?chip:anchor);if(formulaSelection(field,range)){field.focus();getSelection().removeAllRanges();getSelection().addRange(range);return;}}
   }
   field.focus();const range=document.createRange();range.selectNode(chip);getSelection().removeAllRanges();getSelection().addRange(range);
  });
  root.addEventListener('dblclick',event=>{
   const chip=event.target.closest('.inline-metric'),field=chip&&textField(chip);if(!field||chip.dataset.formulaId)return;
   event.preventDefault();const range=document.createRange();range.selectNode(chip);openMetric(field,range,chip);
  });
  document.addEventListener('dblclick',event=>{
   const field=textField(event.target);if(!field?.matches('input,textarea'))return;
   const position=field.selectionStart;for(const match of field.value.matchAll(/\[\[@metric:([^\]\n]+)\]\]/g)){
    if(position>=match.index&&position<match.index+match[0].length){event.preventDefault();openMetric(field,{start:match.index,end:match.index+match[0].length},{dataset:{metricToken:match[0]}});break;}
   }
  });
  let formulaEditor=null;
  const formulaMessages={invalid_expression:()=>t('公式不正确，请检查运算符和括号。','Invalid expression. Check operators and parentheses.'),two_variables_required:()=>t('公式需要同时使用 A 和 B 两个指标。','Use both A and B in the expression.'),non_numeric:()=>t('指标不是有效数值，无法计算。','A metric is not a valid number.'),division_by_zero:()=>t('除数为 0，无法计算。','Cannot divide by zero.'),non_finite:()=>t('计算结果超出范围。','The result is outside the supported range.'),invalid_precision:()=>t('ROUND 的小数位须为 -6 到 6 的整数。','ROUND precision must be an integer from -6 to 6.')};
  const formulaMessage=error=>formulaMessages[error.code||error]?.()||t('公式配置不可用。','Formula configuration is unavailable.');
  function selectionRuns(field,range){
   const prefix=range.cloneRange();prefix.selectNodeContents(field);prefix.setEnd(range.startContainer,range.startOffset);
   const length=fragment=>MonthlyRichText.read(fragment).reduce((sum,run)=>sum+run.text.length,0),start=length(prefix.cloneContents()),end=start+length(range.cloneContents()),selected=[];let offset=0;
   for(const run of MonthlyRichText.read(field)){const a=Math.max(0,start-offset),b=Math.min(run.text.length,end-offset);if(b>a)selected.push({text:run.text.slice(a,b),style:run.style});offset+=run.text.length;}
   return selected;
  }
  function formulaSelection(field,range){
   if(!field?.isConnected||textField(field)!==field||field.matches('input,textarea')||range.collapsed||!field.contains(range.startContainer)||!field.contains(range.endContainer))return null;
   const selected=range.cloneRange();for(const chip of field.querySelectorAll('[data-metric-token]')){if(chip.contains(selected.startContainer))selected.setStartBefore(chip);if(chip.contains(selected.endContainer))selected.setEndAfter(chip);}
   const originalRuns=selectionRuns(field,selected),originalText=originalRuns.map(run=>run.text).join(''),keys=MonthlyMetricFormulas.sourceKeys(originalText);
   if(!keys||originalRuns.length>20||selected.cloneContents().querySelectorAll('.inline-metric:not(.inline-formula)').length!==2)return null;
   return {range:selected,keys,originalText,originalRuns};
  }
  function adjacentFormulaSelection(field,range){
   if(!field?.isConnected||!range||range.collapsed||!field.contains(range.commonAncestorContainer))return null;
   const selected=range.cloneContents().querySelectorAll('.inline-metric');if(selected.length!==1||selected[0].classList.contains('inline-formula'))return null;
   const chips=Array.from(field.querySelectorAll('.inline-metric')),chip=chips.find(item=>range.intersectsNode(item));if(!chip)return null;
   const index=chips.indexOf(chip);
   for(const neighbor of [chips[index+1],chips[index-1]]){if(!neighbor||neighbor.classList.contains('inline-formula'))continue;const pair=document.createRange();pair.setStartBefore(chips.indexOf(neighbor)<index?neighbor:chip);pair.setEndAfter(chips.indexOf(neighbor)<index?chip:neighbor);const result=formulaSelection(field,pair);if(result)return result;}
   return null;
  }
  function replaceFormulaSelection(field,range,replacement,newDefinition){
   const prefix=range.cloneRange();prefix.selectNodeContents(field);prefix.setEnd(range.startContainer,range.startOffset);
   const length=fragment=>MonthlyRichText.read(fragment).reduce((sum,run)=>sum+run.text.length,0),start=length(prefix.cloneContents()),end=start+length(range.cloneContents()),before=[],after=[];let offset=0;
   for(const run of MonthlyRichText.read(field)){const from=Math.max(0,start-offset),to=Math.max(0,end-offset);if(from>0)before.push({text:run.text.slice(0,from),style:run.style});if(to<run.text.length)after.push({text:run.text.slice(to),style:run.style});offset+=run.text.length;}
   const runs=[...before,...replacement,...after].filter(run=>run.text),catalog=api.getCatalog();
   field.innerHTML=renderText(runs.map(run=>run.text).join(''),newDefinition?{...catalog,inlineFormulas:[...(catalog.inlineFormulas||[]),newDefinition]}:catalog,api.metricLabel,runs);
   api.commitFormula(field,newDefinition);field.focus();const caret=document.createRange(),position=start+replacement.reduce((sum,run)=>sum+run.text.length,0);let count=0,placed=false;
   function walk(node){if(placed)return;const token=node.dataset?.metricToken;if(token||node.nodeType===3){const size=token?token.length:node.textContent.length;if(position<=count+size){if(token)caret.setStartAfter(node);else caret.setStart(node,Math.max(0,position-count));placed=true;}count+=size;}else Array.from(node.childNodes).forEach(walk);}
   Array.from(field.childNodes).forEach(walk);if(!placed)caret.setStart(field,field.childNodes.length);caret.collapse(true);getSelection().removeAllRanges();getSelection().addRange(caret);
  }
  function openFormula(field,range,existing=null){
   if(formulaEditor?.open||!field?.isConnected)return;
   const selected=existing?null:formulaSelection(field,range);if(!existing&&!selected)return;
   const definition=existing?api.getCatalog().inlineFormulas?.find(item=>item.id===existing.dataset.formulaId):selected;if(!definition)return;
   close();const toolbar=document.querySelector('.rich-text-toolbar');if(toolbar)toolbar.hidden=true;
   const target=existing?document.createRange():selected.range;if(existing)target.selectNode(existing);
   const editor=document.createElement('dialog');formulaEditor=editor;editor.className='metric-formula-editor';editor.setAttribute('data-controls','');editor.setAttribute('aria-label',t(existing?'编辑指标公式':'两项指标计算',existing?'Edit metric formula':'Calculate two metrics'));
   const operands=MonthlyDocumentEngine.metricTextParts(definition.originalText,api.getCatalog()).filter(part=>part.token);
   editor.innerHTML=`<form><header><div><h3>${t(existing?'编辑指标公式':'两项指标计算',existing?'Edit metric formula':'Calculate two metrics')}</h3><p>${t('结果保留指标引用，更新月报数据后重新计算。','The result stays linked to the metrics and recalculates when report data is updated.')}</p></div><button type="button" data-formula-close aria-label="${t('关闭','Close')}">×</button></header><div class="formula-operands">${operands.map((part,index)=>`<div><span>${index?'B':'A'}</span><div><strong>${escape(api.metricLabel(part.label))}</strong><small>${escape(part.value)}</small></div></div>`).join('')}</div><label>${t('计算公式','Expression')}<input data-formula-expression autocomplete="off" spellcheck="false" maxlength="200" value="${escape(existing?definition.expression:'A + B')}" aria-label="${t('计算公式','Expression')}"></label><div class="formula-presets">${[['A + B','相加','Add'],['A - B','相减','Subtract'],['A * B','相乘','Multiply'],['A / B','比例','Ratio'],['(A + B) / 2','平均值','Average'],['(A - B) / B','变化率','Change rate']].map(([expression,zh,en])=>`<button type="button" data-formula-preset="${expression}">${t(zh,en)}</button>`).join('')}</div><p class="formula-help">${t('支持 + − × /、括号、乘方 ^，以及 ROUND、MIN、MAX、ABS。例：ROUND((A-B)/B, 4)。百分比文本按比例数参与计算。','Supports + − × /, parentheses, powers (^), ROUND, MIN, MAX and ABS. Example: ROUND((A-B)/B, 4). Percentage text is treated as a ratio.')}</p><div class="formula-options"><label>${t('小数位（最多）','Maximum decimals')}<select data-formula-digits>${Array.from({length:7},(_,index)=>`<option value="${index}" ${index===(definition.digits??2)?'selected':''}>${index}</option>`).join('')}</select></label><label>${t('显示方式','Display')}<select data-formula-percent><option value="number" ${!definition.percent?'selected':''}>${t('数值','Number')}</option><option value="percent" ${definition.percent?'selected':''}>${t('百分比','Percentage')}</option></select></label></div><div class="formula-preview" aria-live="polite"><span>${t('计算结果','Result')}</span><strong data-formula-preview></strong><p data-formula-error role="status"></p></div><footer>${existing?`<button type="button" data-formula-remove>${t('取消公式，恢复两个指标','Remove formula, restore both metrics')}</button>`:''}<button type="button" data-formula-close>${t('返回','Back')}</button><button type="submit" data-formula-apply>${t('应用公式','Apply formula')}</button></footer></form>`;
   document.body.append(editor);editor.addEventListener('close',()=>{editor.remove();if(formulaEditor===editor)formulaEditor=null;});
   const finish=()=>{editor.close();editor.remove();if(formulaEditor===editor)formulaEditor=null;};
   const expression=editor.querySelector('[data-formula-expression]'),digits=editor.querySelector('[data-formula-digits]'),percent=editor.querySelector('[data-formula-percent]'),apply=editor.querySelector('[data-formula-apply]');
   function preview(){try{const value=MonthlyMetricFormulas.evaluate(expression.value,...operands.map(part=>part.missing?null:part.value));editor.querySelector('[data-formula-preview]').textContent=MonthlyMetricFormulas.display(value,Number(digits.value),percent.value==='percent');editor.querySelector('[data-formula-error]').textContent='';apply.disabled=false;}catch(error){editor.querySelector('[data-formula-preview]').textContent='—';editor.querySelector('[data-formula-error]').textContent=formulaMessage(error);apply.disabled=true;}}
   editor.addEventListener('input',preview);editor.addEventListener('change',preview);
   editor.addEventListener('click',event=>{const preset=event.target.closest('[data-formula-preset]');if(preset){expression.value=preset.dataset.formulaPreset;percent.value=preset.dataset.formulaPreset==='(A - B) / B'?'percent':'number';preview();}if(event.target.closest('[data-formula-close]'))finish();if(event.target.closest('[data-formula-remove]')){if(field.isConnected&&existing?.isConnected){replaceFormulaSelection(field,target,definition.originalRuns);finish();}}});
   editor.querySelector('form').onsubmit=event=>{event.preventDefault();if(apply.disabled||!field.isConnected||existing&&!existing.isConnected)return;try{
    const next={id:MonthlyDocumentEngine.uid(),keys:definition.keys,expression:expression.value,digits:Number(digits.value),percent:percent.value==='percent',originalText:definition.originalText,originalRuns:definition.originalRuns};MonthlyMetricFormulas.validate([next]);
    const style=existing?selectionRuns(field,target)[0]?.style||{}:definition.originalRuns.find(run=>run.text.includes('[[@metric:'))?.style||{};
    replaceFormulaSelection(field,target,[{text:'[[@formula:'+next.id+']]',style}],next);finish();
   }catch(error){editor.querySelector('[data-formula-error]').textContent=formulaMessage(error);}};
   editor.showModal();preview();expression.focus();expression.select();
  }
  async function chooseLogo(){
   close();dialog.innerHTML=`<h3>${t('服务器 Logo 图库','Server logo library')}</h3><p>${t('上传后保存在当前租户，可在多份月报中重复选择。支持 PNG、JPG、WEBP。','Uploaded logos are stored for this tenant and can be reused. PNG, JPG and WEBP supported.')}</p><label>${t('上传新的 Logo','Upload new logo')}<input data-upload-logo type="file" accept="image/png,image/jpeg,image/webp"></label><p role="status"></p><div class="logo-gallery"></div><footer><button type="button" data-logo-close>${t('关闭','Close')}</button></footer>`;dialog.showModal();
   const gallery=dialog.querySelector('.logo-gallery'),message=dialog.querySelector('[role=status]');
   const draw=async()=>{const items=await api.request('/api/upload/monthly-logos');gallery.innerHTML=[{id:'default',name:t('默认 Logo','Default logo'),url:'/assets/logo.png'},...items.map(item=>({...item,url:'/api/upload/monthly-logos/'+item.id+'/image'}))].map(item=>`<button type="button" data-logo-url="${escape(item.url)}" aria-label="${escape(item.name)}"><img src="${escape(item.url)}" alt=""><span>${escape(item.name)}</span></button>`).join('');};
   gallery.onclick=event=>{const url=event.target.closest('[data-logo-url]')?.dataset.logoUrl;if(url){api.setLogo(url);dialog.close();}};
   dialog.querySelector('[data-logo-close]').onclick=()=>dialog.close();
   dialog.querySelector('[data-upload-logo]').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;event.target.disabled=true;message.textContent=t('正在上传…','Uploading…');
    try{const prepared=await PlatformLogoUpload.prepareFile(file),body=new FormData();body.append('file',prepared,prepared.name);await api.request('/api/upload/monthly-logos',{method:'POST',body});await draw();message.textContent=t('上传成功，点击 Logo 即可应用','Uploaded. Select a logo to apply.');window.showToast(message.textContent,'success');}catch(error){message.textContent=t('上传失败：','Upload failed: ')+error.message;window.showToast(message.textContent,'error');}finally{event.target.disabled=false;event.target.value='';}
   };
   try{await draw();}catch(error){message.textContent=error.message;}
  }
  root.addEventListener('click',event=>{if(event.target.closest('[data-edit-logo]'))chooseLogo();});
  return {chooseLogo,formulaSelection,adjacentFormulaSelection,openFormula};
 }
 window.MonthlyInlineTools={renderText,serialize,start};
})();
