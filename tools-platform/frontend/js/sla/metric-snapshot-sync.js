/** Save recalculated metrics against the loaded import, without uploading originals again. */
(function(root){
    'use strict';
    function create(api){
        let context=null,timer=null,running=false,pending=false,epoch=0;
        const fingerprint=()=>JSON.stringify(Object.entries(api.getState()||{}).sort(([a],[b])=>a.localeCompare(b)).filter(([,state])=>!state.archiveSupplementary).map(([id,state])=>[id,state.customMetrics||[],state.riskRuleConfig||null,state.sectionRuleConfig||null]));
        function reset(){epoch++;clearTimeout(timer);context=null;pending=false;api.status('idle');}
        function bind(value){reset();if(!value||!Array.isArray(value.files))return;context={...value,fingerprint:value.fingerprint??fingerprint()};api.status('ready');}
        function schedule(){
            if(!context||context.fingerprint===fingerprint())return;
            clearTimeout(timer);timer=setTimeout(flush,600);
        }
        async function flush(force=false){
            clearTimeout(timer);if(running){pending=true;return;}
            if(!context||force!==true&&context.fingerprint===fingerprint())return;
            const owner=context,version=epoch,signature=fingerprint(),month=api.getMonth();running=true;
            api.status('saving');
            try{
                const snapshot=await api.capture(owner.files,{source:owner.source||'manual',sourceBatchId:owner.sourceBatchId||null,updateId:owner.month===month?owner.derivedSnapshotId:null,ruleRefresh:true});
                if(epoch===version){context={...owner,month,derivedSnapshotId:snapshot.id,fingerprint:signature};api.persist(context);api.status('saved');}
            }catch(error){if(epoch===version)api.status('failed',error,flush);}
            finally{running=false;if(pending){pending=false;schedule();}}
        }
        return {bind,reset,schedule,flush,fingerprint,hasChanges:()=>!!context&&context.fingerprint!==fingerprint()};
    }
    if(typeof module==='object'&&module.exports){module.exports={create};return;}
    const english=()=>root.ToolsI18n?.getLanguage()==='en-US';
    root.SLAMetricSnapshotSync=create({
        getState:()=>root.AppState,getMonth:()=>root.SLATargetMonth?.get?.(),
        capture:(files,meta)=>{root.evaluateAllMetrics?.();return root.SLAUpload.captureAndUploadSnapshot(files,meta);},
        persist:context=>{try{const key='sla_last_import_workspace_v1',cached=JSON.parse(localStorage.getItem(key)||'null');if(cached){cached.meta.metricSnapshotContext=context;localStorage.setItem(key,JSON.stringify(cached));}}catch(_){}},
        status:function paintStatus(state,error,retry){
            if(state==='idle'){
                const el = typeof document !== 'undefined' && typeof document.getElementById === 'function' ? document.getElementById('metricSnapshotSyncStatus') : null;
                if (el) { el.textContent = ''; el.style.display = 'none'; }
                if (typeof root.updateUploadStatusVisibility === 'function') root.updateUploadStatusVisibility();
                return;
            }
            let box = typeof document !== 'undefined' && typeof document.getElementById === 'function' ? document.getElementById('metricSnapshotSyncStatus') : null;
            if (!box && typeof document !== 'undefined' && typeof document.createElement === 'function') {
                box = document.createElement('div');
                box.id = 'metricSnapshotSyncStatus';
                box.className = 'upload-status-item upload-metric-sync-status';
                box.setAttribute('role', 'status');
                const host = (typeof document.getElementById === 'function' ? document.getElementById('upload-status-group') : null) || (typeof document.getElementById === 'function' ? document.getElementById('sourceArchiveStatus')?.parentElement : null) || (typeof document.querySelector === 'function' ? document.querySelector('.upload-actions') : null);
                if (host && typeof host.appendChild === 'function') host.appendChild(box);
            }
            box.style.display = 'inline-flex';
            const text = {
                ready: ['保存指标规则后会自动同步结果，也可手动保存当前指标数据。', 'Saving metric rules automatically synchronizes results. You can also save current metric data manually.'],
                saving: ['正在计算并保存指标数据…', 'Calculating and saving metrics…'],
                saved: ['指标数据已保存到服务器，月报刷新资料库后即可引用。', 'Metrics saved to server. Refresh the report library to use them.'],
                failed: ['指标数据保存失败，规则已保留，请重试。', 'Metric data could not be saved. Rules are retained; please retry.']
            };
            box._renderStatus = () => paintStatus(state, error, retry);
            box.textContent = '';
            box.style.color = state === 'failed' ? 'var(--danger, #b42318)' : '';
            const span = document.createElement('span');
            span.className = 'upload-status-text';
            span.textContent = text[state][english() ? 1 : 0];
            box.appendChild(span);
            if (state !== 'saving') {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn-save upload-btn-sync';
                button.textContent = state === 'failed'
                    ? (english() ? 'Retry saving' : '重试保存')
                    : (english() ? 'Save current metrics' : '保存当前指标数据');
                button.onclick = () => state === 'failed' ? retry() : root.SLAMetricSnapshotSync.flush(true);
                box.appendChild(button);
            }
            if (typeof root.updateUploadStatusVisibility === 'function') root.updateUploadStatusVisibility();
        }
    });
    root.addEventListener('tools:languagechange',()=>document.getElementById('metricSnapshotSyncStatus')?._renderStatus?.());
    root.SLAMetricSnapshotSync.rulesFailed=()=>{if(root.SLAMetricSnapshotSync.hasChanges())root.showToast?.(english()?'Metric rules were not saved; metric data has not been synchronized. Save the rules again.':'指标规则未保存成功，指标数据尚未同步。请再次保存规则。','error');};
})(typeof window==='object'?window:globalThis);
