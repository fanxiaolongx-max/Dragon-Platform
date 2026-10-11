/* Manage saved reports without deleting sources, templates or editing content. */
(function(){
 'use strict';
 async function open(api){
  const {t,escape:esc}=api,items=await api.request('/api/upload/monthly-documents'),selected=new Set(items.some(item=>item.id===api.currentId)?[api.currentId]:[]);
  let query='',review=false,busy=false;
  const modal=document.createElement('dialog');modal.className='report-manager-dialog';modal.setAttribute('aria-labelledby','reportManagerTitle');
  modal.innerHTML=`<header><div><span class="report-switch-eyebrow">${t('服务器月报','SAVED REPORTS')}</span><h3 id="reportManagerTitle">${t('删除月报','Delete reports')}</h3></div><button type="button" data-manager-close aria-label="${t('关闭','Close')}">×</button></header><p>${t('选择一份或多份已保存月报。仅删除月报快照，不删除默认模板或数据资料库。','Select one or more saved reports. Deletion removes report snapshots only, preserving the default template and source library.')}</p><div class="report-manager-tools"><input type="search" data-manager-search placeholder="${t('搜索月报名称…','Search reports…')}" aria-label="${t('搜索月报','Search reports')}"><button type="button" data-manager-all>${t('全选搜索结果','Select results')}</button><button type="button" data-manager-clear>${t('清空选择','Clear selection')}</button></div><div class="report-manager-list"></div><div class="report-manager-warning" hidden></div><p data-manager-status role="status"></p><footer><span data-manager-count></span><button type="button" data-manager-back hidden>${t('返回选择','Back')}</button><button type="button" data-manager-close>${t('取消','Cancel')}</button><button type="button" data-manager-delete></button></footer>`;
  const list=modal.querySelector('.report-manager-list'),warning=modal.querySelector('.report-manager-warning'),button=modal.querySelector('[data-manager-delete]'),status=modal.querySelector('[data-manager-status]');
  const filtered=()=>items.filter(item=>item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function draw(){
   const shown=review?items.filter(item=>selected.has(item.id)):filtered();
   list.innerHTML=shown.map(item=>`<label class="report-manager-row"><input type="checkbox" data-report-id="${esc(item.id)}" ${selected.has(item.id)?'checked':''} ${review?'disabled':''}><span><strong>${esc(item.name)}</strong><small>${t('保存时间','Saved')} · ${esc(String(item.updated_at||'').replace('T',' ').replace(/\.\d+Z$/,' UTC'))}${item.id===api.currentId?' · '+t('当前月报','Current report'):''}</small></span></label>`).join('')||`<div class="report-manager-empty">${t('没有符合条件的已保存月报','No matching saved reports')}</div>`;
   warning.hidden=!review;warning.textContent=t('将永久删除所选 '+selected.size+' 份月报，无法撤销。若包含当前月报，页面内容会保留为未保存草稿。','Permanently delete '+selected.size+' reports. This cannot be undone. The current report, if selected, will remain on screen as an unsaved draft.');
   modal.querySelector('.report-manager-tools').hidden=review;modal.querySelector('[data-manager-back]').hidden=!review;modal.querySelector('[data-manager-count]').textContent=t('已选 '+selected.size+' 份','Selected: '+selected.size);button.textContent=review?t('确认删除','Confirm deletion'):t('删除所选月报','Delete selected reports');button.disabled=!selected.size;
  }
  function close(){if(!busy){modal.close();modal.remove();}}
  modal.addEventListener('cancel',event=>{event.preventDefault();close();});
  modal.onchange=event=>{if(event.target.matches('[data-report-id]')){const id=event.target.dataset.reportId;event.target.checked?selected.add(id):selected.delete(id);draw();}};
  modal.querySelector('[data-manager-search]').oninput=event=>{query=event.target.value;draw();};
  modal.onclick=async event=>{
   const target=event.target.closest('button');if(!target||busy)return;
   if(target.hasAttribute('data-manager-close'))return close();
   if(target.hasAttribute('data-manager-all')){filtered().forEach(item=>selected.add(item.id));draw();}
   if(target.hasAttribute('data-manager-clear')){selected.clear();draw();}
   if(target.hasAttribute('data-manager-back')){review=false;status.textContent='';draw();}
   if(!target.hasAttribute('data-manager-delete'))return;
   if(!review){review=true;draw();modal.querySelector('[data-manager-back]').focus();return;}
   busy=true;modal.querySelectorAll('button,input').forEach(el=>el.disabled=true);status.textContent=t('正在删除…','Deleting…');
   try{const result=await api.request('/api/upload/monthly-documents',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...selected],confirmed:true})});await api.onDeleted(result.deletedIds);busy=false;close();}
   catch(error){status.textContent=t('操作失败：','Operation failed: ')+error.message;busy=false;modal.querySelectorAll('button,input').forEach(el=>el.disabled=false);draw();}
  };
  document.body.append(modal);draw();modal.showModal();
 }
 window.MonthlyReportManager={open};
})();
