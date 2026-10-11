(function(){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function renderText(text,catalog,label,runs,resolveMetrics=true){
  const render=value=>resolveMetrics?MonthlyDocumentEngine.metricTextParts(value,catalog).map(part=>part.token?`<span class="inline-metric" contenteditable="false" data-metric-token="${escape(part.token)}" title="${escape(label(part.label))}">${escape(part.value)}</span>`:escape(part.text)).join(''):escape(value);
  if(!runs||runs.map(run=>run.text).join('')!==text)return render(text);
  return runs.map(run=>{const s=run.style||{},styles=[s.bold!==undefined?`font-weight:${s.bold?700:400}`:'',s.underline!==undefined?`text-decoration:${s.underline?'underline':'none'}`:'',s.fontSize?`font-size:${s.fontSize}px`:'',s.color?`color:${s.color}`:'',s.background?`background-color:${s.background}`:''].filter(Boolean).join(';');return `<span style="${escape(styles)}">${render(run.text)}</span>`;}).join('');
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
  root.addEventListener('keydown',event=>{
   const field=event.target.closest('[contenteditable=true]');
   if(event.key!=='@'||!field||!field.closest('.document-block-text'))return;
   const selection=getSelection();if(!selection?.rangeCount)return;
   event.preventDefault();close();const range=selection.getRangeAt(0).cloneRange();
   if(!field.contains(range.commonAncestorContainer))return;
   const rect=range.getBoundingClientRect(),fallback=field.getBoundingClientRect();
   menu=document.createElement('div');menu.className='metric-mention-menu';menu.setAttribute('role','dialog');menu.setAttribute('aria-label',t('引用指标','Insert metric'));
   menu.innerHTML=`<strong>${t('引用指标值','Insert metric value')}</strong><button type="button" data-close aria-label="${t('关闭','Close')}">×</button><label>${t('指标来源','Source')}<select data-source><option value="extraction">${t('导入提取','Imported metrics')}</option><option value="assessment">${t('报表考核','Assessment')}</option></select></label><label>${t('指标层级','Level')}<select data-level><option value="main">${t('主指标','Main')}</option><option value="sub">${t('子指标','Child')}</option></select></label><label data-category-label>${t('全局分类','Global category')}<select data-category></select></label><input data-search placeholder="${t('搜索提取指标','Search metrics')}"><div data-results></div>`;
   document.body.append(menu);menu.style.left=Math.max(8,Math.min(rect.left||fallback.left,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min((rect.bottom||fallback.top)+6,innerHeight-menu.offsetHeight-8))+'px';
   const source=menu.querySelector('[data-source]'),level=menu.querySelector('[data-level]'),category=menu.querySelector('[data-category]'),search=menu.querySelector('[data-search]');
   const metrics=()=>MonthlyDocumentEngine.metricOptions(api.getCatalog()).filter(metric=>(metric.key.startsWith('assessment:')?'assessment':'extraction')===source.value&&metric.metricLevel===level.value);
   const draw=()=>{
    const q=search.value.trim().toLowerCase(),eligible=metrics().filter(metric=>level.value!=='sub'||!category.value||metric.category===category.value);
    const items=q?eligible.filter(metric=>api.metricLabel(metric.label).toLowerCase().includes(q)):recentMetrics.map(key=>eligible.find(metric=>metric.key===key)).filter(Boolean).slice(0,3);
    menu.querySelector('[data-results]').innerHTML=(q?'':items.length?`<small>${t('最近使用','Recently used')}</small>`:'')+items.map(metric=>`<button type="button" data-key="${escape(metric.key)}">${escape(api.metricLabel(metric.label))}</button>`).join('')+(q&&!items.length?`<p>${t('暂无匹配指标','No matching metrics')}</p>`:'');
    menu.style.top=Math.max(8,Math.min((rect.bottom||fallback.top)+6,innerHeight-menu.offsetHeight-8))+'px';
   };
   const reset=()=>{menu.querySelector('[data-category-label]').hidden=level.value!=='sub';category.innerHTML=`<option value="">${t('全部分类','All categories')}</option>`+[...new Set(metrics().map(metric=>metric.category).filter(Boolean))].map(value=>`<option>${escape(value)}</option>`).join('');draw();};
   source.onchange=level.onchange=reset;category.onchange=search.oninput=draw;
   menu.querySelector('[data-close]').onclick=()=>{close();field.focus();};
   menu.onkeydown=event=>{if(event.key==='Escape'){close();field.focus();}};
   menu.onclick=event=>{
    const key=event.target.closest('[data-key]')?.dataset.key;if(!key)return;
    if(!field.isConnected){close();return;}
    const token='[[@metric:'+encodeURIComponent(key)+']]';const holder=document.createElement('span');holder.innerHTML=renderText(token,api.getCatalog(),api.metricLabel);const chip=holder.firstChild;
    field.focus();range.deleteContents();range.insertNode(chip);const space=document.createTextNode(' ');chip.after(space);range.setStartAfter(space);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
    const previous=recentMetrics.indexOf(key);if(previous!==-1)recentMetrics.splice(previous,1);recentMetrics.unshift(key);recentMetrics.length=Math.min(recentMetrics.length,3);
    api.commitText(field);close();
   };
   reset();search.focus();
  });
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
  return {chooseLogo};
 }
 window.MonthlyInlineTools={renderText,serialize,start};
})();
