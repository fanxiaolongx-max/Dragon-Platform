// Shared grouping and menus for personal, channel and native desktop lists.
(function(){
    'use strict';
    const API='/api/ai/conversation-list',prefs=new Map(),views=new Map(),bindings=new WeakMap();
    let account='',epoch=0,menu=null,anchor=null;
    const L=(zh,en)=>(window.ToolsI18n?.getLanguage?.()||localStorage.getItem('tools_lang')||'').startsWith('en')?en:zh;
    const identity=()=>['tools_user','tools_tenant_id','tools_token'].map(k=>localStorage.getItem(k)||sessionStorage.getItem(k)||'').join('|');
    const key=(source,id)=>JSON.stringify([source,String(id)]);
    const get=(source,id)=>prefs.get(key(source,id))||{};
    const signal=source=>window.dispatchEvent(new CustomEvent('home:conversation-list-changed',{detail:{source}}));
    const stamp=value=>{if(!value)return NaN;const s=String(value);return Date.parse(/^\d{4}-\d\d-\d\d \d\d:/.test(s)?s.replace(' ','T')+'Z':s)};
    function latest(items,config){return items.filter(item=>{const p=get(config.source,config.id(item));return !p.hidden&&!p.archived;}).map((item,index)=>({item,index})).sort((a,b)=>(stamp(config.date(b.item))||0)-(stamp(config.date(a.item))||0)||a.index-b.index)[0]?.item;}
    function healthDot(health={level:'warning',reason:'checking'}){
        const level=['ok','warning','error'].includes(health.level)?health.level:'warning';
        const labels={connected:L('连接正常','Connected'),offline:L('连接异常或未连接','Offline or unavailable'),checking:L('正在检查连接','Checking connection'),connecting:L('正在连接或重连','Connecting or reconnecting'),stale:L('连接配置待更新','Connection configuration needs updating'),delayed:L('连接延迟','Connection delayed'),degraded:L('连接可用，近期有异常','Connected with a recent issue'),readonly:L('可查看，暂不能发送','Readable, sending unavailable'),disabled:L('连接已停用','Connection disabled')};
        const label=labels[health.reason]||labels.checking;
        return `<span class="connection-status-dot" data-health="${level}" role="img" aria-label="${label}" title="${label}"></span>`;
    }
    function bucket(value,now=new Date()){
        const date=new Date(stamp(value));if(Number.isNaN(date.getTime()))return 'unknown';
        const day=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
        const age=Math.floor((day(now)-day(date))/86400000);
        return age<3?'recent':age<7?'three':age<30?'week':'month';
    }
    const labels=()=>({pinned:L('置顶','Pinned'),recent:L('最近','Recent'),three:L('3 天前','3+ days ago'),week:L('7 天前','7+ days ago'),month:L('一个月前','A month ago'),unknown:L('时间未知','Date unavailable')});
    function sections(items,config){
        const archived=views.get(config.source)==='archived',groups=new Map(),names=labels(),query=(config.query||'').toLowerCase();
        const rows=items.map((item,index)=>({item,index,pref:get(config.source,config.id(item))})).filter(({item,pref})=>!pref.hidden&&Boolean(pref.archived)===archived&&(!query||[config.title(item),pref.title].some(t=>String(t||'').toLowerCase().includes(query))));
        rows.sort((a,b)=>Number(Boolean(b.pref.pinned))-Number(Boolean(a.pref.pinned))||((stamp(config.date(b.item))||0)-(stamp(config.date(a.item))||0))||a.index-b.index);
        for(const row of rows){row.title=row.pref.title||config.title(row.item);const group=row.pref.pinned?'pinned':bucket(config.date(row.item));if(!groups.has(group))groups.set(group,[]);groups.get(group).push(row);}
        return ['pinned','recent','three','week','month','unknown'].filter(g=>groups.has(g)).map(g=>({key:g,label:names[g],entries:groups.get(g)}));
    }
    async function request(method,body){
        const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');
        const response=await fetch(API,{method,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
        const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||L('操作失败，请重试','Could not save. Please retry.'));return data;
    }
    async function load(){
        const current=identity(),version=++epoch;account=current;prefs.clear();views.clear();close();
        try{const data=await request('GET');if(current!==identity()||version!==epoch)return;for(const pref of data.items||[])prefs.set(key(pref.source,pref.id),pref);signal('*');}catch{/* Keep native lists usable if preferences cannot load. */}
    }
    async function save(source,id,patch){
        const current=identity();if(current!==account)throw Error(L('账号已切换，请刷新列表','Account changed. Refresh the list.'));
        const data=await request('PUT',{source,id,...patch});if(current!==identity())return;
        prefs.set(key(source,id),data.item);signal(source);
    }
    function close(focus=false){menu?.remove();menu=null;if(anchor){anchor.classList.remove('is-menu-open');if(focus)anchor.querySelector('[data-conversation-more]')?.focus({preventScroll:true});}anchor=null;}
    const icons={rename:'M3 11l1-4 6-6 3 3-6 6-4 1zm6-8l3 3',pin:'M6 2h4l-.5 4 2.5 3H4l2.5-3L6 2zm2 7v5',archive:'M2 2h12v3H2zm1 3v8h10V5M6 8h4',remove:'M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4'};
    function icon(name){return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${icons[name]}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}
    async function action(config,item,name){
        const current=identity(),source=config.source,id=config.id(item),pref=get(source,id),title=pref.title||config.title(item);
        if(name==='pin')return save(source,id,{pinned:!pref.pinned});
        if(name==='archive')return save(source,id,{archived:!pref.archived});
        if(name==='rename'){
            const value=window.AppDialog?await window.AppDialog.prompt(L('修改在平台列表中显示的名称','Change the name shown in this platform'),{title:L('重命名','Rename'),defaultValue:title,maxLength:160}):window.prompt(L('重命名','Rename'),title);
            if(current!==identity()||value===null||value===undefined||!String(value).trim())return;return save(source,id,{title:String(value).trim()});
        }
        if(config.onDelete)return config.onDelete(item);
        const message=L(`从平台列表移除「${title}」？原客户端的对话和消息会保留。`,`Remove “${title}” from this platform list? The original client's conversation and messages are kept.`);
        const ok=window.AppDialog?await window.AppDialog.confirm(message,{title:L('移除对话','Remove conversation'),confirmText:L('移除','Remove'),tone:'danger'}):window.confirm(message);
        if(ok&&current===identity())await save(source,id,{hidden:true});
    }
    function open(row,config,item,x,y){
        close();anchor=row;row.classList.add('is-menu-open');
        const pref=get(config.source,config.id(item));menu=document.createElement('div');menu.className='conversation-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',L('对话操作','Conversation actions'));
        const actions=[['rename',L('重命名','Rename')],['pin',pref.pinned?L('取消置顶','Unpin'):L('置顶','Pin')],['archive',pref.archived?L('取消归档','Unarchive'):L('归档','Archive')],['remove',L('删除','Delete')]];
        menu.innerHTML=actions.map(([id,label])=>`<button type="button" role="menuitem" data-conversation-action="${id}"${id==='remove'?' class="is-danger"':''}>${icon(id)}<span>${label}</span></button>`).join('');
        menu.addEventListener('click',async event=>{const button=event.target.closest('[data-conversation-action]');if(!button)return;const operation=button.dataset.conversationAction;close();try{await action(config,item,operation);}catch(error){if(window.AppDialog)window.AppDialog.alert(error.message,{title:L('操作失败','Action failed'),tone:'error'});else window.alert(error.message);}});
        menu.addEventListener('keydown',event=>{const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}else if(event.key==='Tab')close();});
        document.body.append(menu);const rect=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';menu.querySelector('button')?.focus({preventScroll:true});
    }
    function enhance(list,config){
        let binding=bindings.get(list);
        if(!binding){binding={};bindings.set(list,binding);
            const show=(event,fromButton=false)=>{const row=event.target.closest('.conversation-list-row');const current=bindings.get(list)?.config;if(!row||!current)return;const item=current.items[Number(row.dataset.conversationIndex)];if(!item)return;event.preventDefault();event.stopPropagation();const r=row.getBoundingClientRect();open(row,current,item,fromButton?r.right-20:event.clientX,fromButton?r.bottom:event.clientY);};
            list.addEventListener('contextmenu',show);
            list.addEventListener('click',event=>{if(event.target.closest('[data-conversation-more]'))show(event,true);},true);
            list.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)show(event,true);});
            list.addEventListener('scroll',()=>close());
        }
        binding.config=config;
        let bar=binding.bar;if(!bar){bar=document.createElement('div');bar.className='conversation-list-toolbar';bar.setAttribute('role','group');binding.bar=bar;bar.addEventListener('click',event=>{const button=event.target.closest('[data-conversation-view]');if(!button)return;const source=bindings.get(list).config.source;views.set(source,button.dataset.conversationView);close();signal(source);});}
        list.before(bar);
        const count=config.items.filter(item=>{const p=get(config.source,config.id(item));return p.archived&&!p.hidden;}).length,archived=views.get(config.source)==='archived';
        bar.innerHTML=`<button type="button" data-conversation-view="active" aria-pressed="${!archived}">${L('对话','Chats')}</button><button type="button" data-conversation-view="archived" aria-pressed="${archived}">${L('已归档','Archived')}${count?' · '+count:''}</button>`;
        for(const main of list.querySelectorAll(config.selector)){
            const index=Number(main.dataset[config.index]),item=config.items[index];if(!item)continue;
            const row=main.closest('.home-chat-owned')||main,wrapper=document.createElement('div');wrapper.className='conversation-list-row';wrapper.dataset.conversationIndex=index;
            row.before(wrapper);wrapper.append(row);const more=document.createElement('button');more.type='button';more.className='conversation-list-more';more.dataset.conversationMore='';more.textContent='···';more.title=L('对话操作','Conversation actions');more.setAttribute('aria-label',more.title);more.setAttribute('aria-haspopup','menu');wrapper.append(more);
            if(get(config.source,config.id(item)).pinned){const pin=document.createElement('span');pin.className='conversation-pin';pin.innerHTML=icon('pin');pin.title=L('已置顶','Pinned');wrapper.append(pin);}
        }
    }
    // 滚动懒加载：列表末尾放一个提示行，滚到离底部约 300px 时自动加载下一页（也可以点它）；没有更多时去掉
    const pagers=new WeakMap();
    function scroller(node){for(let el=node;el&&el!==document.body;el=el.parentElement){const y=getComputedStyle(el).overflowY;if((y==='auto'||y==='scroll')&&el.scrollHeight>el.clientHeight)return el;}return null;}
    function pager(list,{hasMore=false,loading=false,onMore}={}){
        if(!list)return;const old=pagers.get(list);old?.observer?.disconnect();old?.node?.remove();pagers.delete(list);
        if(!hasMore)return;
        const node=document.createElement('button');node.type='button';node.className='conversation-list-pager';node.textContent=loading?L('正在加载…','Loading…'):L('加载更多','Load more');node.disabled=loading;
        node.addEventListener('click',()=>onMore?.());list.append(node);
        const entry={node,observer:null};pagers.set(list,entry);
        if(loading||!('IntersectionObserver' in window))return;
        entry.observer=new IntersectionObserver(items=>{if(items.some(item=>item.isIntersecting)){entry.observer.disconnect();onMore?.();}},{root:scroller(list),rootMargin:'0px 0px 300px 0px'});
        entry.observer.observe(node);
    }
    window.HomeConversationList={sections,enhance,bucket,get,latest,healthDot,close,refresh:load,pager,isArchived:source=>views.get(source)==='archived'};
    document.addEventListener('pointerdown',event=>{if(menu&&!menu.contains(event.target)&&!event.target.closest('[data-conversation-more]'))close();},true);
    window.addEventListener('scroll',()=>close(),true);
    window.addEventListener('resize',()=>close());window.addEventListener('blur',()=>close());
    window.addEventListener('storage',event=>{if(['tools_user','tools_tenant_id','tools_token'].includes(event.key))load();});
    window.addEventListener('tools:languagechange',()=>{close();signal('*');});
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();
