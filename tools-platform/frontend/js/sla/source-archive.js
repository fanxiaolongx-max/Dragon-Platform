(function(){
    'use strict';
    const english=()=>window.ToolsI18n?.getLanguage()==='en-US';
    const label=(zh,en)=>english()?en:zh;
    window.updateUploadStatusVisibility = window.updateUploadStatusVisibility || function() {
        if (!document || typeof document.getElementById !== 'function') return;
        const group = document.getElementById('upload-status-group');
        if (!group) return;
        const s1 = document.getElementById('sourceArchiveStatus');
        const s2 = document.getElementById('metricSnapshotSyncStatus');
        const has1 = Boolean(s1 && (s1.textContent.trim() || s1.children?.length > 0));
        const has2 = Boolean(s2 && (s2.textContent.trim() || s2.children?.length > 0) && s2.style.display !== 'none');
        group.style.display = (has1 || has2) ? 'inline-flex' : 'none';
        group.classList.toggle('has-content', has1 || has2);
    };
    const status = (typeof document.getElementById === 'function' ? document.getElementById('sourceArchiveStatus') : null) || (() => {
        const el = document.createElement('div');
        el.id = 'sourceArchiveStatus';
        el.className = 'upload-status-item upload-source-archive-status';
        el.setAttribute('role', 'status');
        const group = (typeof document.getElementById === 'function' ? document.getElementById('upload-status-group') : null) || (typeof document.querySelector === 'function' ? document.querySelector('.upload-actions') : null);
        if (group && typeof group.appendChild === 'function') group.appendChild(el);
        return el;
    })();
    const message = value => {
        status.textContent = value;
        window.updateUploadStatusVisibility();
    };
    async function request(url,options){const headers=getAuthHeaders();if(options?.body instanceof FormData)delete headers['Content-Type'];const response=await fetch(url,{credentials:'same-origin',...options,headers:{...headers,...options?.headers}});return handleResponse(response,{method:options?.method || 'GET',path:url});}
    const json=(method,value)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    function csv(rows){const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';return [headers,...rows.map(row=>headers.map(h=>row[h]))].map(row=>row.map(quote).join(',')).join('\r\n');}
    async function archive(files,meta={}){
        const settings=await request('/api/upload/import-settings',{cache:'no-store'});
        if(!settings.uploadOriginals){
            message(label('原始数据上传已关闭：本次不保存原文件及全部工作表，继续提取指标并保存快照。可在全局设置 → 数据导入中重新开启。','Original data uploads are off: original files and full worksheets will not be archived. Metric extraction and snapshots continue. Enable uploads in Global Settings → Data Import.'));
            return null;
        }
        const batch=await request('/api/upload/source-batches',json('POST',{source:meta.source || 'manual',targetMonth:window.SLATargetMonth?.get?.()}));
        let saved=0;
        // Persist every selected original before month filtering or extraction starts.
        const items=[];
        for(const source of files){
            message(label(`正在保存原始表格 ${saved+1}/${files.length}：${source.name}`,`Archiving original ${saved+1}/${files.length}: ${source.name}`));
            const structured=Array.isArray(source.__uivRows);
            const file=structured?new File([csv(source.__uivRows)],source.name.replace(/\.[^.]+$/,'.csv'),{type:'text/csv'}):source;
            const form=new FormData();form.append('file',file);form.append('kind',structured?'structured':'original');form.append('originalName',file.name);
            const item=await request(`/api/upload/source-batches/${encodeURIComponent(batch.id)}/files`,{method:'POST',body:form});
            items.push({source,item,structured});saved++;
        }
        let errors=0;
        for(const {source,item,structured} of items){
            let sheets;
            try{
                if(structured){sheets=[{name:'Captured rows',headers:[...new Set(source.__uivRows.flatMap(row=>Object.keys(row)))],rows:source.__uivRows}];}
                else {const workbook=XLSX.read(await source.arrayBuffer(),{type:'array'});sheets=workbook.SheetNames.map(name=>{const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{raw:false,defval:''});const headerRows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,raw:false,defval:'',blankrows:false});return {name,headers:[...new Set([...rows.flatMap(row=>Object.keys(row)),...(rows.length?[]:(headerRows[0]||[]).map(String))])],rows};});}
                await request(`/api/upload/source-files/${encodeURIComponent(item.id)}/sheets`,json('PUT',{sheets}));
            }catch(error){errors++;await request(`/api/upload/source-files/${encodeURIComponent(item.id)}/sheets`,json('PUT',{sheets:[],parseError:error.message}));}
        }
        message(label(`已永久保存 ${saved} 个原始表格${errors?`，${errors} 个表格解析失败（原文件仍已保存）`:''}。未配置提取规则的表格也可在月报中引用。`,`Permanently archived ${saved} source tables${errors?`; ${errors} parsing errors (originals retained)`:''}. Tables without extraction rules are available in the report designer.`));
        const link=document.createElement('a');link.href='/pages/monthly-designer.html';link.textContent=label(' 打开数据资料库与月报编辑器',' Open source library & report designer');status.append(link);
        window.updateUploadStatusVisibility();
        return batch.id;
    }
    let busy=false;
    async function readArchivedWorksheets(file){
        if(file.parse_status==='ready'){
            return Promise.all(file.sheets.map(sheet=>request(`/api/upload/source-sheets/${encodeURIComponent(sheet.id)}`)));
        }
        // Pending/failed parsing never discards the original; try it locally for review.
        const response=await fetch(`/api/upload/source-files/${encodeURIComponent(file.id)}/download`,{credentials:'same-origin',headers:getAuthHeaders()});
        if(!response.ok){await handleResponse(response);throw new Error(`HTTP ${response.status}`);}
        const workbook=XLSX.read(await response.arrayBuffer(),{type:'array'});
        return workbook.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(workbook.Sheets[name],{raw:false,defval:''})}));
    }
    async function withLock(fn){if(busy)throw new Error(label('请等待本次导入完成','Wait for the current import'));busy=true;const inputs=[...document.querySelectorAll('.upload-actions input,.upload-actions button,#slaTargetMonthSelect')].map(input=>({input,disabled:input.disabled}));inputs.forEach(({input})=>input.disabled=true);try{return await fn();}catch(error){message(label(`导入未完成：${error.message}。已保存的原始文件仍在服务器资料库中。`,`Import incomplete: ${error.message}. Archived originals remain in the server library.`));if(typeof showToast==='function')showToast(error.message,'error');throw error;}finally{busy=false;inputs.forEach(({input,disabled})=>input.disabled=disabled);}}
    window.SLASourceArchive={archive,withLock,readArchivedWorksheets};
})();
