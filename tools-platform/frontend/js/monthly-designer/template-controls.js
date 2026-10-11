(function(){
    'use strict';
    async function open({request,t,status,capture}){
        const saved=await request('/api/upload/monthly-default-template');
        const dialog=document.createElement('dialog');dialog.className='name-mapping-dialog template-dialog';dialog.setAttribute('data-controls','');
        dialog.innerHTML=`<form><h3>${t('设为默认模板','Set as default template')}</h3><p>${t('保存当前月报的布局、文字样式、图表与透视配置、名称映射及数据规整规则。新建月报使用此模板，目标月份与报告编号重新填写。','Save the current layout, text styles, chart and pivot settings, name mappings and number formats. New reports use this template and fill in the target month and report number again.')}</p><p>${t('当前默认模板：','Current default: ')}${saved.source==='tenant'?t('服务器已保存的模板','Saved server template'):t('程序内置模板','Bundled template')}</p><p>${t('原始表数据仍保存在资料库中，不写入模板；新月报按表名、工作表名及相对月份匹配已有数据源，缺少数据时可重新绑定。','Original table data stays in the library. New reports match existing sources by table, sheet and relative month; missing sources can be rebound.')}</p>${saved.canSyncRepository?`<label class="template-sync"><input type="checkbox" name="sync" checked>${t('同时同步到代码仓库，随程序打包','Also sync to the code repository for packaging')}</label><p>${t('同步会更新内置模板文件，并复制上传的 Logo；完成后需正常提交、推送代码。','Sync updates the bundled template file and copies the uploaded logo. Commit and push these files afterwards.')}</p>`:`<p>${t('本机 Mac 从代码仓库运行时，可在此同步内置模板。','Run from the code repository on the local Mac to sync the bundled template here.')}</p>`}<p class="mapping-status" role="status"></p><footer class="mapping-actions"><button type="button" data-template-cancel>${t('关闭','Close')}</button><button type="submit" data-template-save>${t('保存默认模板','Save default template')}</button></footer></form>`;
        document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('[data-template-cancel]').onclick=()=>dialog.close();
        const form=dialog.querySelector('form'),message=dialog.querySelector('[role=status]');
        form.onsubmit=async event=>{
            event.preventDefault();const button=form.querySelector('[data-template-save]');button.disabled=true;
            let stored=false;
            try{
                message.textContent=t('正在保存默认模板…','Saving default template…');
                await request('/api/upload/monthly-default-template',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(capture())});stored=true;
                let result=t('默认模板已保存，新建月报时生效','Default template saved; it applies to new reports');
                if(form.elements.sync?.checked){await request('/api/upload/monthly-default-template/sync-repository',{method:'POST'});result+=t('；已同步到仓库，请提交内置模板与 Logo 文件','; synced to repository. Commit the bundled template and logo files');}
                message.classList.add('mapping-success');message.textContent=result;status(result);
            }catch(error){message.classList.remove('mapping-success');message.textContent=(stored?t('默认模板已保存，但同步仓库失败：','Default saved, but repository sync failed: '):t('保存失败：','Save failed: '))+error.message;status(message.textContent);}
            finally{button.disabled=false;}
        };
        dialog.showModal();return dialog;
    }
    window.MonthlyTemplateControls={open};
})();
