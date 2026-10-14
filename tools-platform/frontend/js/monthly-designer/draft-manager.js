/* Draft writes never call the formal report save endpoint. Each window has its own draft. */
(function(){
 'use strict';
 function create(api){
  const {t,escape:esc,request}=api;let draftId=crypto.randomUUID(),signature='',pending=null,state='',lastWrite=0,available=[],started=false,paused=false;
  const toolbar=document.querySelector('.designer-toolbar'),badge=document.createElement('span'),button=document.createElement('button'),notice=document.createElement('div');
  badge.id='monthlySaveState';badge.setAttribute('role','status');badge.className='monthly-save-state';button.type='button';button.dataset.openDrafts='';notice.className='monthly-draft-notice';notice.hidden=true;notice.dataset.controls='';
  toolbar.insertBefore(badge,toolbar.querySelector('#designerStatus'));toolbar.querySelector('[data-menu=more] .studio-menu-content').append(button);document.querySelector('.designer-layout').before(notice);button.onclick=()=>open().catch(error=>api.status(error.message));
  function sync(){if(state==='saved'&&api.dirty()&&api.signature()!==signature)state='';button.textContent=t('草稿与恢复','Drafts & recovery');badge.textContent=!api.dirty()?(api.hasSaved()?t('已保存到服务器','Saved to server'):t('尚未正式保存','Not yet saved to server')):state==='saving'?t('正在保存草稿…','Saving draft…'):state==='saved'?t('草稿已保存 · 未正式保存','Draft saved · report unsaved'):state==='error'?t('草稿保存失败 · 修改仍在当前窗口','Draft failed · edits remain in this window'):t('有未保存修改','Unsaved changes');badge.dataset.state=api.dirty()?state:'clean';}
  async function flush(){
   if(pending){await pending;return flush();}
   if(!started||paused||!api.dirty()||!api.ready())return;
   const document=api.document(),next=JSON.stringify(document);if(next===signature){sync();return;}
   state='saving';sync();const id=draftId;
   pending=request('/api/upload/monthly-drafts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({document,baseRevision:api.revision()??null})}).then(()=>{signature=next;lastWrite=Date.now();state=JSON.stringify(api.document())===next?'saved':'';}).catch(error=>{state='error';lastWrite=Date.now();throw error;}).finally(()=>{pending=null;sync();});
   return pending;
  }
  async function list(){available=await request('/api/upload/monthly-drafts');return available;}
  async function open(){
   const items=await list(),dialog=document.createElement('dialog');dialog.className='monthly-edit-dialog';dialog.dataset.controls='';
   dialog.innerHTML=`<h3>${t('草稿与恢复','Drafts & recovery')}</h3><p>${t('自动草稿按账号和编辑窗口分别保存，不递增正式报告编号。恢复后仍需正式保存。','Drafts are saved separately for your account and each editing window. They do not advance the report number; recovered drafts still require a formal save.')}</p><div class="monthly-draft-list">${items.length?items.map(item=>`<article><strong>${esc(item.name)}</strong><small>${esc(item.report_month)} · ${esc(new Date(item.updated_at).toLocaleString())}</small><button type="button" data-restore-draft="${esc(item.id)}">${t('恢复此草稿','Restore draft')}</button><button type="button" data-delete-draft="${esc(item.id)}">${t('删除草稿','Delete draft')}</button></article>`).join(''):`<p>${t('暂无自动草稿','No drafts yet')}</p>`}</div><p role="status"></p><footer><button type="button" data-close>${t('关闭','Close')}</button></footer>`;
   document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.onclick=async event=>{const remove=event.target.closest('[data-delete-draft]');if(remove){try{await request('/api/upload/monthly-drafts/'+encodeURIComponent(remove.dataset.deleteDraft),{method:'DELETE'});remove.closest('article').remove();}catch(error){dialog.querySelector('[role=status]').textContent=error.message;}return;}const selected=event.target.closest('[data-restore-draft]');if(!selected)return;selected.disabled=true;try{
    if(api.dirty())await flush();
    paused=true;const result=await request('/api/upload/monthly-drafts/'+encodeURIComponent(selected.dataset.restoreDraft));
    await api.restore(result);begin();state='';sync();notice.hidden=true;dialog.close();api.status(t('草稿已恢复，请核对后保存到服务器','Draft restored; review it and save to server'));
   }catch(error){dialog.querySelector('[role=status]').textContent=error.message;}finally{paused=false;selected.disabled=false;}};
  }
  function begin(){draftId=crypto.randomUUID();signature='';state='';lastWrite=0;sync();}
  async function saved(){if(pending)await pending.catch(()=>{});const id=draftId;begin();try{await request('/api/upload/monthly-drafts/'+encodeURIComponent(id),{method:'DELETE'});}catch(_){api.status(t('正式月报已保存；草稿清理失败，可稍后重试','Report saved; draft cleanup failed, retry later'));}}
  async function start(){started=true;sync();try{const items=await list();if(items.length){notice.hidden=false;notice.innerHTML=`<span>${t('发现 '+items.length+' 份自动草稿，可查看并恢复未正式保存的内容。',items.length+' drafts are available to review and recover.')}</span><button type="button" data-review-drafts>${t('查看与恢复','Review & recover')}</button><button type="button" data-dismiss-drafts>${t('稍后','Later')}</button>`;notice.querySelector('[data-review-drafts]').onclick=()=>button.click();notice.querySelector('[data-dismiss-drafts]').onclick=()=>notice.hidden=true;}}catch(_){} }
  setInterval(()=>{if(!started)return;sync();if(api.ready()&&api.dirty()&&!pending&&(state!=='error'||Date.now()-lastWrite>10000))flush().catch(()=>{});},2500);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush().catch(()=>{});});
  window.addEventListener('tools:languagechange',sync);
  return {start,flush,begin,saved,sync,changed:()=>{state='';sync();},settle:()=>pending?.catch(()=>{})||Promise.resolve()};
 }
 window.MonthlyDraftManager={create};
})();
