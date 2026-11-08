(function () {
    'use strict';
    const names={codex:'Codex',claudecode:'Claude Code',antigravity:'Antigravity',workbuddy:'WorkBuddy'};
    const L=(zh,en)=>/^en/.test(window.ToolsI18n?.getLanguage?.()||localStorage.getItem('tools_lang')||'')?en:zh;
    const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const who=()=>['tools_user','tools_tenant_id','tools_token'].map(k=>localStorage.getItem(k)||sessionStorage.getItem(k)||'').join('|');
    let account=who(),scope='',selected={},draft={},hydrated=false,saving=false,sequence=0,loadTail=Promise.resolve();
    const catalogs=new Map();
    const context=()=>window.HomeDesktopAgents?.modelContext?.()||window.HomeAgentDiscussion?.modelContext?.()||null;
    async function request(method,url,body) {
        const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');
        const response=await fetch('/api/desktop-agents'+url,{method,cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
        const data=await response.json();if(!response.ok)throw Error(data.error||'Model request failed');return data;
    }
    function sync() {
        if(account!==who()){account=who();scope='';selected={};draft={};catalogs.clear();sequence++;saving=false;}
        const c=context();
        if(!c?.providers?.length){scope='';selected={};return null;}
        if(scope!==c.key){scope=c.key;selected=c.key==='draft'?draft:{...(c.models||{})};hydrated=c.models!==undefined;saving=false;sequence++;}
        if(!hydrated&&c.models!==undefined){selected={...c.models};hydrated=true;}
        return c;
    }
    function refresh(){window.DragonClaw?.refreshModelPicker?.();}
    const dayKey=()=>{const now=new Date();return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');};
    function load(provider) {
        const day=dayKey(),old=catalogs.get(provider);
        if(old?.loading||old?.day===day&&(!old.error||Date.now()-old.at<60000))return;
        const identity=account,entry={day,at:Date.now(),loading:true,items:old?.items||[],error:''};catalogs.set(provider,entry);
        loadTail=loadTail.catch(()=>{}).then(async()=>{
            if(identity!==who())return;
            try{entry.items=(await request('GET',`/${provider}/models?day=${day}`)).models||[];}
            catch(e){entry.error=e.message;entry.at=Date.now();}
            finally{entry.loading=false;if(identity===who())refresh();}
        });
    }
    function render() {
        const c=sync(),root=document.getElementById('dcModel');
        document.body.classList.toggle('dc-native-models',Boolean(c));
        if(!c||!root)return false;
        c.providers.forEach(p=>load(p));
        root.hidden=false;root.dataset.modelId='';
        const button=document.getElementById('dcModelBtn'),menu=document.getElementById('dcModelMenu');
        const chosen=c.providers.filter(p=>selected[p]);
        document.getElementById('dcModelName').textContent=c.providers.length>1?L(`讨论组模型${chosen.length?' · '+chosen.length:''}`,`Group models${chosen.length?' · '+chosen.length:''}`):selected[c.providers[0]]?(catalogs.get(c.providers[0])?.items.find(m=>m.id===selected[c.providers[0]])?.name||selected[c.providers[0]]):L('默认模型','Default model');
        button.disabled=false;button.title=L('选择连接器模型，从下一条消息生效','Choose connector models for your next message');button.setAttribute('aria-label',button.title);
        button.querySelector('.dc-model-icon')?.remove();
        const signature=JSON.stringify([scope,c.providers,selected,c.providers.map(p=>catalogs.get(p)),saving,L('zh','en')]);
        if(menu.dataset.nativeSignature===signature)return true;
        menu.dataset.nativeSignature=signature;
        const grouped=c.providers.length>1;
        menu.innerHTML=`<div class="dc-model-menu-head"><b>${esc(L('模型','Models'))}</b><span>${esc(grouped?L('每家最多一个 · 下一条消息生效','One per agent · applies next message'):L('下一条消息生效','Applies from your next message'))}</span></div><div class="dc-model-options" role="listbox" aria-multiselectable="${c.providers.length>1}" aria-label="${esc(L('连接器模型','Connector models'))}">${c.providers.map(p=>{
            const catalog=catalogs.get(p)||{},current=selected[p]||'';
            const option=(id,name)=>`<button type="button" class="dc-model-option${current===id?' is-selected':''}" role="option" aria-selected="${current===id}" data-native-provider="${p}" data-native-model="${esc(id)}" ${saving||c.readonly?'disabled':''}><span class="dc-model-option-text"><span class="dc-model-option-name">${esc(name)}</span>${id&&catalog.items?.filter(m=>m.name===name).length>1?`<span class="dc-model-option-desc">${esc(id)}</span>`:''}</span><span aria-hidden="true">${current===id?'✓':''}</span></button>`;
            return `<div role="group" aria-label="${names[p]}">${grouped?`<div class="dc-native-model-heading">${names[p]}</div>`:''}${option('',L('默认（沿用客户端）','Default (inherit client)'))}${catalog.items?.map(m=>option(m.id,m.name)).join('')||''}${catalog.loading?`<p class="dc-model-empty" role="status">${esc(L('正在读取原生模型…','Loading native models…'))}</p>`:''}${catalog.error?`<p class="dc-model-empty">${esc(catalog.error)}</p>`:''}</div>`;
        }).join('')}</div>`;
        return true;
    }
    async function choose(provider,model) {
        const c=sync();if(!c||saving||c.readonly||!c.providers.includes(provider))return;
        if(model&&!(catalogs.get(provider)?.items||[]).some(m=>m.id===model))return;
        const revision=sequence,identity=account,next={...selected,[provider]:model};saving=true;refresh();
        try {
            if(c.save)await c.save(next);
            if(revision!==sequence||identity!==who())return;
            selected=next;if(c.key==='draft')draft=selected;
            window.DragonClawText?.toast?.(L('模型选择将从下一条消息生效','Model selection applies from the next message'));
        } catch(e){if(revision===sequence&&identity===who())window.DragonClawText?.toast?.(e.message);}
        finally{if(revision===sequence&&identity===who()){saving=false;refresh();}}
    }
    function values(){const c=sync();return c?Object.fromEntries(c.providers.map(p=>[p,selected[p]||''])):{};}
    window.HomeDesktopModels={render,values,forProvider:p=>values()[p]||'',seedDraft:(p,m)=>{draft={...draft,[p]:m};if(scope==='draft')selected=draft;},resetDraft:()=>{draft={};if(scope==='draft')selected=draft;},validate:()=>{const c=sync();if(saving)throw Error(L('请等待模型选择保存完成','Wait for model selection to save'));if(c?.providers.some(p=>selected[p]&&catalogs.get(p)?.loading))throw Error(L('请等待所选模型列表读取完成','Wait for the selected model catalog to load'));}};
    document.addEventListener('click',e=>{
        const option=e.target.closest('[data-native-model]');
        if(option&&sync()){e.stopImmediatePropagation();if(!option.disabled)choose(option.dataset.nativeProvider,option.dataset.nativeModel);}
    },true);
    window.addEventListener('home:desktop-model-context',refresh);
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});else refresh();
})();
