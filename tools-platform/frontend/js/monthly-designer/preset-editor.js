(function(){
    'use strict';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    async function open(api,config,block){
        const t=api.t,dialog=document.createElement('dialog');dialog.className='name-mapping-dialog '+(config.className||'');dialog.setAttribute('data-controls','');dialog.setAttribute('aria-label',config.title(t));document.body.append(dialog);
        let rules=structuredClone(block[config.property]||[]),presets=[],selectedId=block[config.presetProperty]||'',tables=[];
        dialog.innerHTML=`<p>${t('读取配置…','Loading configuration…')}</p>`;dialog.showModal();
        try{[presets,tables]=await Promise.all([api.request(config.endpoint),api.tables(block)]);}catch(error){dialog.remove();api.status(error.message);return;}if(!dialog.isConnected)return;
        const capture=()=>rules=config.capture(dialog);
        function draw(){const name=dialog.querySelector('[data-preset-name]')?.value||presets.find(item=>item.id===selectedId)?.name||block.title?.zh||block.title?.en||config.title(t);dialog.innerHTML=`<h3>${esc(config.title(t))}</h3><p>${esc(config.description(t))}</p><div class="mapping-preset-bar"><select data-mapping-presets aria-label="${t('跨月复用配置','Reusable preset')}"><option value="">${t('新建复用配置','New reusable preset')}</option>${presets.map(item=>`<option value="${esc(item.id)}" ${item.id===selectedId?'selected':''}>${esc(item.name)}</option>`).join('')}</select><button type="button" data-map-action="load">${t('载入','Load')}</button><button type="button" data-map-action="delete" ${selectedId?'':'disabled'}>${t('删除配置','Delete preset')}</button><input data-preset-name maxlength="200" value="${esc(name)}" aria-label="${t('复用配置名称','Preset name')}"></div>${config.rulesMarkup(rules,tables,t,esc)}<button type="button" data-map-action="add">＋ ${t('增加规则','Add rule')}</button><p class="mapping-status" role="status"></p><div class="mapping-actions"><button type="button" data-map-action="cancel">${t('取消','Cancel')}</button><button type="button" data-map-action="apply">${t('应用到本模块','Apply to module')}</button><button type="button" data-map-action="save">${t('保存复用配置到服务器','Save reusable preset to server')}</button></div>`;}
        draw();dialog.addEventListener('close',()=>dialog.remove());
        dialog.addEventListener('change',event=>{if(event.target.matches('[data-mapping-presets]')){selectedId=event.target.value;dialog.querySelector('[data-preset-name]').value=presets.find(item=>item.id===selectedId)?.name||'';dialog.querySelector('[data-map-action=delete]').disabled=!selectedId;}else if(config.change?.(event,dialog)){capture();config.normalize?.(rules,event);draw();}});
        function apply(){api.change();block[config.property]=structuredClone(rules);if(selectedId)block[config.presetProperty]=selectedId;else delete block[config.presetProperty];api.render();api.status(t('配置已应用，请保存月报','Configuration applied; save the report'));}
        dialog.addEventListener('click',async event=>{
            const remove=event.target.closest('[data-remove-mapping]');if(remove){capture();rules.splice(Number(remove.dataset.removeMapping),1);draw();return;}
            const button=event.target.closest('[data-map-action]');if(!button)return;const action=button.dataset.mapAction;
            try{
                if(action==='cancel'){dialog.close();return;}capture();
                if(action==='add'){if(rules.length>=200)throw new Error(t('最多支持200条规则','Up to 200 rules are supported'));rules.push(config.emptyRule());draw();return;}
                if(action==='load'){const preset=presets.find(item=>item.id===selectedId);if(!preset)throw new Error(t('请先选择复用配置','Select a reusable preset'));rules=structuredClone(preset.rules);draw();return;}
                if(action==='delete'){if(!selectedId)return;await api.request(config.endpoint+'/'+encodeURIComponent(selectedId),{method:'DELETE'});presets=presets.filter(item=>item.id!==selectedId);selectedId='';draw();return;}
                config.validate(rules);
                if(action==='save'){const name=dialog.querySelector('[data-preset-name]').value.trim();if(!name)throw new Error(t('请填写复用配置名称','Enter a preset name'));button.disabled=true;const saved=await api.request(config.endpoint+(selectedId?'/'+encodeURIComponent(selectedId):''),{method:selectedId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,rules})});selectedId=saved.id;presets=presets.filter(item=>item.id!==saved.id).concat(saved);apply();draw();const status=dialog.querySelector('.mapping-status');status.classList.add('mapping-success');status.textContent=t('已保存到服务器，可跨月份载入。当前月报仍需点击保存。','Saved on server for reuse across months. Save the current report to persist its module configuration.');return;}
                if(action==='apply'){apply();dialog.close();}
            }catch(error){const status=dialog.querySelector('.mapping-status');if(status){status.classList.remove('mapping-success');status.textContent=config.error?.(error,t)||error.message;}button.disabled=false;}
        });
    }
    window.MonthlyPresetEditor={open};
})();
