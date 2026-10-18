(function() {
    'use strict';
    const ipc=require('electron').ipcRenderer;
    const rows=document.getElementById('quotaRows');
    let quotas=null, group='gemini';
    function render() {
        const english=window.PetI18n.getLanguage()==='en-US';
        const text=english?{title:'ACCOUNT QUOTA',five:'5 hours',week:'Weekly',desktop:'Desktop',gemini:'Gemini',third:'Claude / GPT',live:'Live',cached:'Cached'}:
            {title:'账户剩余额度',five:'5 小时',week:'每周',desktop:'桌面订阅',gemini:'Gemini',third:'Claude / GPT',live:'实时',cached:'缓存'};
        document.getElementById('panelTitle').textContent=text.title;
        document.getElementById('columnFive').textContent=text.five;
        document.getElementById('columnWeek').textContent=text.week;
        document.querySelector('section').setAttribute('aria-label',text.title);
        rows.replaceChildren();
        const entries=window.PetQuotaView.groups(quotas,english);
        for(const [provider,id,title] of [['codex','codex','Codex'],['claudecode','claudecode','Claude Code'],['antigravity',group,english?'Antigravity':'反重力']]) {
            const fallback=entries.find(e=>e.provider===provider);
            const entry=entries.find(e=>e.key===provider+':'+id)||(!['live','cached'].includes(fallback?.status)?fallback:null);
            const row=document.createElement('div');row.className='quota-row '+provider+(entry?.status==='cached'?' cached':'');
            const brand=document.createElement('div'),name=document.createElement('div'),mark=document.createElement('i');
            name.className='provider-name';mark.className='provider-mark';mark.setAttribute('aria-hidden','true');
            name.append(mark,document.createTextNode(title));brand.appendChild(name);
            const meta=document.createElement('div');meta.className='provider-meta';
            const badge=document.createElement('span'), membership=entry?.membership;
            badge.className='membership-badge'+(membership?.premium?' premium':membership?' standard':' unknown');
            if(membership)badge.dataset.tier=membership.tier;
            badge.title=membership?(english?'Subscription: ':'订阅会员：')+membership.label:(english?'Provider did not return a plan':'提供方未返回会员信息');
            if(membership?.premium) {
                const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
                icon.setAttribute('viewBox','0 0 16 12');icon.setAttribute('aria-hidden','true');
                const path=document.createElementNS('http://www.w3.org/2000/svg','path');
                path.setAttribute('d','M2 3 5.5 5 8 1 10.5 5 14 3 12 9H4L2 3ZM4 11h8');
                icon.appendChild(path);badge.appendChild(icon);
            }
            const badgeLabel=document.createElement('span');badgeLabel.textContent=membership?membership.label.toUpperCase():(english?'Unknown':'未识别');
            badge.appendChild(badgeLabel);meta.appendChild(badge);
            const detail=document.createElement('span');detail.className='provider-detail';
            const available=entry && ['live','cached'].includes(entry.status);
            const description=provider==='antigravity'?(group==='third-party'?text.third:text.gemini):'';
            detail.textContent=available?[description,entry.status==='cached'?text.cached:''].filter(Boolean).join(' · '):entry?.state || '—';
            detail.title=detail.textContent;
            if(detail.textContent)meta.appendChild(detail);
            brand.appendChild(meta);row.appendChild(brand);
            for(const [id,label] of [['5h',text.five],['weekly',text.week]]) {
                const window=entry?.windows.find(w=>w.id===id), value=available?window?.value:null;
                const cell=document.createElement('button');cell.type='button';cell.className='quota-cell'+(value==null?' unknown':value<=20?' low':value<=40?' warning':'');
                cell.title=(english?'View trend · ':'查看趋势 · ')+title+' · '+label;
                cell.setAttribute('aria-label',cell.title);
                cell.addEventListener('click',()=>ipc.send('pet-open-quota-trends',{provider,groupId:available?entry.key.slice(provider.length+1):(provider==='antigravity'?group:provider),windowId:id}));
                const number=document.createElement('div');number.className='quota-value';number.textContent=value==null?'—':String(Math.round(value));
                if(value!=null){const unit=document.createElement('span');unit.className='quota-percent';unit.textContent='%';number.appendChild(unit);}
                cell.append(number);row.appendChild(cell);
            }
            rows.appendChild(row);
        }
        const live=entries.some(e=>e.status==='live');
        document.querySelector('.live-indicator').style.opacity=live?'1':'.25';
    }
    ipc.on('pet-quota-update',(_event,data)=>{quotas=data;render();});
    ipc.on('pet-quota-panel-config',(_event,config)=>{group=config?.group==='third-party'?'third-party':'gemini';render();});
    window.addEventListener('pet:languagechange',render);
    let hit=false;
    document.addEventListener('mousemove',event=>{
        const next=!!event.target.closest('.quota-cell');
        if(next!==hit){hit=next;ipc.send('pet-quota-panel-hit',hit);}
    });
    document.addEventListener('mouseleave',()=>{hit=false;ipc.send('pet-quota-panel-hit',false);});
    render();ipc.send('pet-quota-panel-ready');
})();
