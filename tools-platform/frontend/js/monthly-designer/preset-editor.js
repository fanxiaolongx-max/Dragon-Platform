/* Component-local style rules are saved with the report; no shared preset catalog. */
(function(){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 async function open(api,config,block,host){
  const t=api.t,dialog=host||document.createElement('dialog');dialog.className='name-mapping-dialog '+(config.className||'');dialog.mappingBlock=block;dialog.setAttribute('data-controls','');dialog.setAttribute('aria-label',config.title(t));if(!host)document.body.append(dialog);else{dialog.close=()=>dialog.replaceChildren();dialog.showModal=()=>{};}
  let rules=structuredClone(block[config.property]||[]),tables=[];dialog.innerHTML=`<p>${t('读取当前组件数据…','Reading component data…')}</p>`;dialog.showModal();
  try{tables=await api.tables(block);}catch(error){dialog.innerHTML=`<p role="status">${esc(error.message)}</p>`;return;}if(!dialog.isConnected)return;
  const capture=()=>rules=config.capture(dialog);
  function draw(){
   const focused=dialog.contains(document.activeElement)?document.activeElement:null,model=focused?.closest('.monthly-choice')?.previousElementSibling,active=model?.matches('select')?model:focused,rowIndex=active?.closest('tbody tr')?.sectionRowIndex,attribute=active?[...active.attributes].find(item=>item.name.startsWith('data-rule-')||item.name.startsWith('data-format-'))?.name:null,body=dialog.closest('.inspector-body'),scroll=body?.scrollTop;
   const available=config.available?.(tables)!==false;
   dialog.innerHTML=`<h3>${esc(config.title(t))}</h3><p>${esc(config.description(t))}</p>${available?config.rulesMarkup(rules,tables,t,esc):`<p class="local-style-empty">${t('当前组件没有可设置格式的数值。文字内容无需数字格式。','This component has no numeric values to format. Text needs no number formatting.')}</p>`}${available?`<button type="button" data-map-action="add">＋ ${t('增加规则','Add rule')}</button>`:''}<p class="mapping-status" role="status"></p><div class="mapping-actions"><button type="button" data-map-action="cancel">${t('关闭','Close')}</button>${available?`<button type="button" data-map-action="apply">${t('应用到当前组件','Apply to this component')}</button>`:''}</div><small class="local-style-save-note">${t('设置随月报一起保存，无需另存配置。','Settings are saved with the report.')}</small>`;
   if(host)dialog.querySelectorAll('.mapping-rules-table').forEach(table=>{const labels=[...table.querySelectorAll('thead th')].map(th=>th.textContent);table.querySelectorAll('tbody tr').forEach(row=>[...row.cells].forEach((cell,index)=>{cell.dataset.fieldLabel=labels[index]||'';cell.querySelectorAll('input,select').forEach(input=>{if(!input.hasAttribute('aria-label')&&labels[index])input.setAttribute('aria-label',labels[index]);});}));});
   config.afterDraw?.(dialog,t,esc);
   for(const select of dialog.querySelectorAll('select[data-format-choice],select[data-format-field],select[data-rule-choice],select[data-rule-field]'))window.MonthlyChoiceDropdown.select(select,t);
   if(attribute){const scope=rowIndex===undefined?dialog:dialog.querySelectorAll('tbody tr')[rowIndex];const target=scope?.querySelector('['+attribute+']');(target?.choiceDropdown?.box.querySelector('summary')||target)?.focus({preventScroll:true});}if(body)body.scrollTop=scroll;
  }
  draw();if(!host)dialog.addEventListener('close',()=>dialog.remove());
  dialog.onchange=event=>{if(config.change?.(event,dialog)){capture();config.normalize?.(rules,event);draw();}};
  dialog.onclick=async event=>{const remove=event.target.closest('[data-remove-mapping]');if(remove){capture();rules.splice(Number(remove.dataset.removeMapping),1);draw();return;}const button=event.target.closest('[data-map-action]');if(!button)return;try{const action=button.dataset.mapAction;if(action==='cancel'){dialog.close();return;}capture();if(action==='add'){if(rules.length>=200)throw new Error(t('最多支持200条规则','Up to 200 rules'));rules.push(config.emptyRule(tables));draw();return;}if(action==='apply'){config.validate(rules,tables);api.change();block[config.property]=structuredClone(rules);delete block[config.presetProperty];await api.render();api.status(t('设置已应用，请保存月报','Settings applied; save the report'));dialog.querySelector('.mapping-status').textContent=t('已应用，可继续调整','Applied; continue editing');}}catch(error){dialog.querySelector('.mapping-status').textContent=config.error?.(error,t)||error.message;}};
 }
 window.MonthlyPresetEditor={open};
})();
