(function() {
    'use strict';
    const ipc=require('electron').ipcRenderer;
    const peek=new URLSearchParams(location.search).get('peek')==='1';
    const body=document.body,rows=document.getElementById('quotaRows');
    const surface=document.querySelector('.quota-panel'),header=document.getElementById('panelDrag');
    const providers=[['codex','Codex'],['claudecode','Claude Code'],['antigravity','Antigravity']];
    const icon=provider=>'../frontend/assets/desktop-agents/'+provider+'.png';
    const cards=new Map();
    let quotas=null,group='gemini',selection='codex';
    let config={mode:'top',orientation:'horizontal',expanded:false,autoHide:true,collapsed:false};
    let inside=false,engaged=false,dragging=null,dragFrame=0,hideTimer=0,collapseTimer=0,hoverTimer=0;
    if(peek)body.className='peek';
    function setText(node,value) { if(node.textContent!==value)node.textContent=value; }
    function english() { return window.PetI18n.getLanguage()==='en-US'; }
    function text() {
        return english()?{title:'Account quota',five:'5 hours',week:'Weekly',remaining:'remaining',reset:'Resets ',hint:'Click quota to view history',updated:'Updated ',unknown:'Plan unavailable',expand:'Show quota tray',menu:'Quota tray menu',hide:'Hide quota tray',drag:'Drag to move · Snap to an edge',footer:'Hover for details · Drag to dock'}:
            {title:'账户剩余额度',five:'5 小时',week:'每周',remaining:'剩余',reset:'重置于 ',hint:'点击额度查看历史',updated:'更新于 ',unknown:'未提供订阅信息',expand:'展开额度托盘',menu:'额度托盘菜单',hide:'隐藏额度托盘',drag:'拖动移动 · 四边贴边停靠',footer:'悬停查看详情 · 拖动贴边停靠'};
    }
    function createCell(id) {
        const cell=document.createElement('button');cell.type='button';cell.className='quota-cell';cell.dataset.window=id;
        const caption=document.createElement('span');caption.className='quota-window-label';
        const number=document.createElement('div');number.className='quota-value';
        const digits=document.createElement('span'),unit=document.createElement('span');unit.className='quota-percent';unit.textContent='%';number.append(digits,unit);
        const track=document.createElement('span');track.className='quota-track';const fill=document.createElement('i');track.append(fill);
        const reset=document.createElement('span');reset.className='quota-reset';reset.hidden=!peek;
        cell.append(caption,number,track,reset);
        const refs={cell,caption,digits,unit,fill,reset};
        cell.addEventListener('click',()=>{
            const provider=peek?selection:cell.closest('.quota-row').dataset.provider;
            const entry=currentEntry(provider);
            ipc.send('pet-open-quota-trends',{provider,groupId:entry?.key.slice(provider.length+1)||(provider==='antigravity'?group:provider),windowId:id});
        });
        return refs;
    }
    function currentEntry(provider) {
        const entries=window.PetQuotaView.groups(quotas,english()),id=provider==='antigravity'?group:provider;
        const fallback=entries.find(entry=>entry.provider===provider);
        return entries.find(entry=>entry.key===provider+':'+id)||(!['live','cached'].includes(fallback?.status)?fallback:null);
    }
    function updateCell(refs,entry,id,title) {
        const t=text(),available=entry&&['live','cached'].includes(entry.status);
        const w=entry?.windows.find(item=>item.id===id);
        const value=available&&Number.isFinite(w?.value)?Math.max(0,Math.min(100,w.value)):null;
        refs.cell.className='quota-cell'+(value===null?' unknown':value<=20?' low':value<=40?' warning':'');
        setText(refs.digits,value===null?'—':String(Math.round(value)));refs.unit.hidden=value===null;
        setText(refs.caption,id==='5h'?t.five:t.week);refs.caption.dataset.short=id==='5h'?'5h':english()?'W':'周';
        const label=title+' · '+refs.caption.textContent+' · '+(value===null?entry?.state||'—':Math.round(value)+'% '+t.remaining)+(w?.reset?' · '+t.reset+w.reset:'');
        refs.cell.setAttribute('aria-label',label);
        refs.fill.style.transform='scaleX('+(value===null?0:value/100)+')';
        setText(refs.reset,w?.reset?t.reset+w.reset:'—');
    }
    if(!peek) {
        for(const [provider,title] of providers) {
            const row=document.createElement('div');row.className='quota-row '+provider;row.dataset.provider=provider;
            const brand=document.createElement('div');brand.className='provider-heading';
            const name=document.createElement('div');name.className='provider-name';
            const image=document.createElement('img');image.className='provider-icon';image.src=icon(provider);image.alt='';image.draggable=false;
            const label=document.createElement('span');label.className='provider-label';name.append(image,label);
            const meta=document.createElement('div');meta.className='provider-meta';
            const badge=document.createElement('span');badge.className='membership-badge';
            const detail=document.createElement('span');detail.className='provider-detail';meta.append(badge,detail);brand.append(name,meta);row.append(brand);
            const cells=['5h','weekly'].map(createCell);cells.forEach(refs=>row.append(refs.cell));
            row.addEventListener('pointerenter',()=>{
                clearTimeout(hoverTimer);
                if(!dragging&&!config.expanded&&!config.collapsed)hoverTimer=setTimeout(()=>ipc.send('pet-quota-panel-peek',provider),80);
            });
            row.addEventListener('pointerleave',()=>{clearTimeout(hoverTimer);ipc.send('pet-quota-panel-peek',null);});
            cards.set(provider,{row,label,badge,detail,cells,title});rows.append(row);
        }
    }
    const peekCells=peek?['5h','weekly'].map(createCell):[];
    if(peek)peekCells.forEach(refs=>document.getElementById('peekQuotas').append(refs.cell));
    function render() {
        const t=text();document.title=t.title;
        if(peek) {
            const entry=currentEntry(selection),title=selection==='antigravity'&&!english()?'反重力':providers.find(([id])=>id===selection)[1];
            document.getElementById('peekIcon').src=icon(selection);
            setText(document.getElementById('peekTitle'),title);
            setText(document.getElementById('peekPlan'),entry?.membership?.label||'');
            setText(document.getElementById('peekState'),entry?.state||'—');
            setText(document.getElementById('peekGroup'),selection==='antigravity'?(group==='gemini'?'Gemini':'Claude / GPT'):t.remaining);
            setText(document.getElementById('peekUpdated'),entry?.updated?t.updated+entry.updated:'');
            setText(document.getElementById('peekHint'),t.hint);
            document.getElementById('quotaPeek').setAttribute('aria-label',title+' · '+t.title);
            peekCells.forEach((refs,index)=>updateCell(refs,entry,index?'weekly':'5h',title));
            return;
        }
        setText(document.getElementById('panelTitle'),t.title);setText(document.getElementById('panelHint'),t.footer);
        header.title=t.drag;surface.setAttribute('aria-label',t.title);
        document.getElementById('panelMenu').setAttribute('aria-label',t.menu);
        document.getElementById('panelHide').setAttribute('aria-label',t.hide);
        document.getElementById('edgeSensor').setAttribute('aria-label',t.expand);
        for(const [provider,card] of cards) {
            const entry=currentEntry(provider),title=provider==='antigravity'&&!english()?'反重力':card.title;
            card.row.classList.toggle('cached',entry?.status==='cached');
            card.row.setAttribute('aria-label',title+' · '+(entry?.state||'—'));
            setText(card.label,title);setText(card.badge,entry?.membership?.label||'');
            card.badge.title=entry?.membership?.label||t.unknown;
            setText(card.detail,entry?.status==='live'?'':entry?.state||'—');
            card.cells.forEach((refs,index)=>updateCell(refs,entry,index?'weekly':'5h',title));
        }
        document.querySelector('.live-indicator').style.opacity=providers.some(([id])=>currentEntry(id)?.status==='live')?'1':'.25';
    }
    function cancelHide() {
        clearTimeout(hideTimer);clearTimeout(collapseTimer);
        body.classList.remove('tucking');
    }
    function scheduleHide() {
        clearTimeout(hideTimer);
        if(peek||inside||engaged||dragging||config.collapsed||config.expanded||!config.autoHide||config.mode==='free')return;
        hideTimer=setTimeout(()=>{
            body.classList.add('tucking');
            collapseTimer=setTimeout(()=>ipc.send('pet-quota-panel-collapse',true),window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:280);
        },1400);
    }
    function reveal() {
        inside=true;cancelHide();
        if(config.collapsed)ipc.send('pet-quota-panel-collapse',false);
    }
    ipc.on('pet-quota-update',(_event,data)=>{quotas=data;render();});
    ipc.on('pet-quota-panel-config',(_event,next)=>{
        if(peek)return;
        const wasCollapsed=config.collapsed;
        group=next?.group==='third-party'?'third-party':'gemini';
        config={...config,...next};
        body.classList.toggle('expanded',config.expanded===true);body.classList.toggle('compact',!config.expanded);
        body.classList.toggle('vertical',config.orientation==='vertical');body.classList.toggle('horizontal',config.orientation!=='vertical');
        body.dataset.mode=config.mode;
        body.classList.toggle('collapsed',config.collapsed===true);
        if(wasCollapsed&&!config.collapsed) {
            body.classList.add('tucking');
            requestAnimationFrame(()=>requestAnimationFrame(()=>body.classList.remove('tucking')));
        } else if(!config.collapsed)body.classList.remove('tucking');
        render();scheduleHide();
    });
    ipc.on('pet-quota-panel-engaged',(_event,value)=>{engaged=value===true;if(engaged)cancelHide();else scheduleHide();});
    ipc.on('pet-quota-peek-config',(_event,next)=>{
        if(!peek)return;
        selection=providers.some(([id])=>id===next?.provider)?next.provider:'codex';
        group=next?.group==='third-party'?'third-party':'gemini';body.dataset.side=next.side;
        body.style.setProperty('--pointer',next.pointer+'px');render();
    });
    ipc.on('pet-quota-peek-visible',(_event,visible)=>{
        if(!peek)return;
        if(visible)requestAnimationFrame(()=>body.classList.add('peek-visible'));else body.classList.remove('peek-visible');
    });
    window.addEventListener('pet:languagechange',render);
    if(peek) {
        document.getElementById('quotaPeek').addEventListener('pointerenter',()=>ipc.send('pet-quota-peek-hold',true));
        document.getElementById('quotaPeek').addEventListener('pointerleave',()=>ipc.send('pet-quota-peek-hold',false));
        render();ipc.send('pet-quota-peek-ready');return;
    }
    body.addEventListener('pointerenter',reveal);
    body.addEventListener('pointerleave',()=>{inside=false;clearTimeout(hoverTimer);ipc.send('pet-quota-panel-peek',null);scheduleHide();});
    document.getElementById('edgeSensor').addEventListener('pointerenter',reveal);
    document.getElementById('edgeSensor').addEventListener('click',reveal);
    surface.addEventListener('pointerdown',event=>{
        if(event.button!==0||event.target.closest('button')||config.collapsed)return;
        cancelHide();clearTimeout(hoverTimer);dragging=event.pointerId;surface.setPointerCapture(event.pointerId);
        body.classList.add('is-dragging');body.dataset.mode='free';header.classList.add('is-dragging');
        ipc.send('pet-quota-panel-drag','start');
    });
    surface.addEventListener('pointermove',event=>{
        if(dragging!==event.pointerId||dragFrame)return;
        dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(dragging!==null)ipc.send('pet-quota-panel-drag','move');});
    });
    function finishDrag(event) {
        if(dragging!==event.pointerId)return;
        cancelAnimationFrame(dragFrame);dragFrame=0;dragging=null;
        body.classList.remove('is-dragging');header.classList.remove('is-dragging');
        ipc.send('pet-quota-panel-drag','end');scheduleHide();
    }
    surface.addEventListener('pointerup',finishDrag);surface.addEventListener('pointercancel',finishDrag);surface.addEventListener('lostpointercapture',finishDrag);
    header.addEventListener('dblclick',event=>{if(!event.target.closest('button'))ipc.send('pet-quota-panel-dock');});
    document.getElementById('panelHide').addEventListener('click',()=>ipc.send('pet-quota-panel-hide'));
    document.getElementById('panelMenu').addEventListener('click',()=>{cancelHide();ipc.send('pet-quota-panel-menu');});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!config.expanded&&config.mode!=='free')ipc.send('pet-quota-panel-collapse',true);});
    render();ipc.send('pet-quota-panel-ready');
})();
