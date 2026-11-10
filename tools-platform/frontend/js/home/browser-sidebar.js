// 一个 Dragon 浏览器：桌面端使用原生标签页，Web/手机读取并接管同一账号的浏览器。
(function () {
    'use strict';
    const bridge=window.DragonBrowser;
    const L=(zh,en)=>/^en/.test(window.ToolsI18n?.getLanguage?.()||localStorage.getItem('tools_lang')||'')?en:zh;
    const esc=value=>String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    let panel,surface,toggle,address,tabsNode,hint,image,status,statusBadge,statusTextNode,agentStatusNode,controlBox,textInput,operatorBanner,aiPointer;
    let menu='',menuSignature='',closedTabs=[],draggedTab=null,lastTheme='',pendingTab=null,tabSequence=0,tabScrollTimer=null,lastVisibleTab='';
    let intentUntil=0,lastActivity=0,activitySent=0,idleRelease=false;
    let open=false,connected=false,docked=false,raf=0,readingVisible=false,previousMenu=null;
    let state={tabs:[]},displayedFrame=null,autoFit=true,pageWidth=0,zoomed=false,viewScale=1,tabSignature='';
    let keyQueue=[],keySending=false,keyTimer=null,keyEpoch=0;
    let busy=false,refreshing=false,controller=null,viewEpoch=0,timer=null,lastHeartbeat=0,manualToken='';
    const suspended=new Set();
    let toolAllowsBrowser=false;
    const icons={back:'<path d="m12 4-6 6 6 6M6 10h11"/>',forward:'<path d="m8 4 6 6-6 6M3 10h11"/>',reload:'<path d="M16 7a7 7 0 1 0 1 6M16 3v5h-5"/>',extensions:'<path d="M7 3h3a2 2 0 1 1 4 0h3v5a2 2 0 1 0 0 4v5h-5a2 2 0 1 0-4 0H3v-5a2 2 0 1 1 0-4V3z"/>',downloads:'<path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5"/>',more:'<circle cx="4" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="16" cy="10" r="1"/>',tabs:'<path d="m5 8 5 5 5-5"/>',external:'<path d="M11 3h6v6M17 3 8 12M8 4H3v13h13v-5"/>',close:'<path d="m5 5 10 10M15 5 5 15"/>','new-tab':'<path d="M10 3v14M3 10h14"/>',keyboard:'<rect x="2" y="4" width="16" height="12" rx="2"/><path d="M5 7h1m3 0h1m3 0h2M5 10h1m3 0h1m3 0h2M6 13h8"/>'};
    const icon=name=>`<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.more}</svg>`;
    function menuButton(action,label,disabled=false){return `<button type="button" data-browser="${action}"${disabled?' disabled':''}>${esc(label)}</button>`;}
    function syncTheme(force=false){
        const theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
        if(bridge&&connected&&(force||theme!==lastTheme)){lastTheme=theme;bridge.action('theme',theme);}
    }
    function positionMenu(){
        if(!menu)return;const popup=panel.querySelector('.dc-browser-popup');
        const name=['downloads','extensions','tabs','keyboard'].includes(menu)?menu:'more';
        let anchor=panel.querySelector(`[data-browser="${name}"]`);if(!anchor.getClientRects().length)anchor=panel.querySelector('[data-browser=more]');
        const r=panel.getBoundingClientRect(),a=anchor.getBoundingClientRect(),width=Math.min(menu==='keyboard'?400:menu==='downloads'?360:menu==='extensions'?320:280,r.width-16);
        const values={top:`${a.bottom-r.top+6}px`,right:`${Math.max(8,Math.min(r.width-width-8,r.right-a.right))}px`,maxHeight:`${Math.max(100,Math.min(520,r.bottom-a.bottom-18))}px`,width:`${width}px`};
        for(const[key,value]of Object.entries(values))if(popup.style[key]!==value)popup.style[key]=value;
    }
    function setMenu(next){
        if(bridge&&['more','downloads','extensions','tabs','history','bookmarks'].includes(next)){
            const name=['downloads','extensions','tabs'].includes(next)?next:'more',r=panel.querySelector(`[data-browser="${name}"]`).getBoundingClientRect();
            bridge.action('sidebar-menu',{name:next,x:Math.round(r.left),y:Math.round(r.bottom+4)});return;
        }
        menu=menu===next?'':next;menuSignature='';renderMenu();layout();
    }
    function renderMenu(){
        const popup=panel.querySelector('.dc-browser-popup');if(!popup)return;
        popup.hidden=!menu;positionMenu();
        for(const name of ['more','downloads','extensions','tabs','keyboard'])panel.querySelector(`[data-browser="${name}"]`)?.setAttribute('aria-expanded',String(menu===name));
        controlBox.hidden=Boolean(bridge)||!manualToken||menu!=='keyboard';
        if(!menu)return;
        const signature=JSON.stringify([menu,state.downloads,state.extensions,state.history,state.bookmarks,state.tabs,state.zoom,state.find,state.libraryError,L('中','en')]);
        if(signature===menuSignature)return;menuSignature=signature;
        let body='',title='';
        if(menu==='more'){
            title=L('浏览器菜单','Browser menu');
            body=menuButton('reopen-tab',L('恢复关闭的标签页','Reopen closed tab'),!bridge&&!closedTabs.length)+ '<hr>'+
                menuButton('find-open',L('在页面中查找','Find in page'),!bridge)+menuButton('print',L('打印…','Print…'),!bridge)+
                `<div class="dc-browser-zoom"><span>${L('缩放','Zoom')}</span>${menuButton('zoom-out','−')}<span>${bridge?state.zoom||100:Math.round(viewScale*100)}%</span>${menuButton('zoom-in','＋')}${menuButton('zoom-reset',L('重置','Reset'))}</div><hr>`+
                menuButton('screenshot',L('保存页面截图','Save screenshot'))+menuButton('downloads',L('下载','Downloads'))+
                menuButton('history',L('历史记录','History'))+menuButton('bookmarks',L('收藏夹','Bookmarks'))+
                menuButton('keyboard',L('网页输入与上传','Page input and upload'),Boolean(bridge)||!state.available||state.url==='about:blank')+ '<hr>'+menuButton('external',bridge?L('在系统默认浏览器打开','Open in default browser'):L('在新标签页打开','Open in new tab'))+
                menuButton('devtools',L('开发者工具','Developer tools'),!bridge);
        }else if(menu==='downloads'){
            title=L('下载','Downloads');const items=state.downloads||[];
            body=bridge?menuButton('downloads-folder',L('打开下载文件夹','Open Downloads folder')):`<p>${L('单个文件上限 50 MB，请在关闭浏览器会话前保存。','Up to 50 MB per file. Save it before the browser session ends.')}</p>`;
            const states={completed:L('已完成','Completed'),progressing:L('下载中','Downloading'),paused:L('已暂停','Paused'),cancelled:L('已取消','Cancelled'),interrupted:L('已中断','Interrupted'),failed:L('失败','Failed'),'too-large':L('文件超过 50 MB','File exceeds 50 MB')};
            const actions={save:L('保存到本机','Save to device'),open:L('打开','Open'),show:L('文件夹','Folder'),pause:L('暂停','Pause'),resume:L('继续','Resume'),cancel:L('取消','Cancel')};
            body+=items.length?items.slice(0,50).map(item=>{
                const controls=item.state==='completed'?(bridge?['open','show']:['save']):!bridge?[]:item.state==='progressing'?['pause','cancel']:item.state==='paused'?['resume','cancel']:[];
                return `<div class="dc-browser-download"><div><b>${esc(item.name)}</b><small>${esc(states[item.state]||item.state)} · ${Math.round((item.received||0)/1024)} KB</small></div><div>${controls.map(action=>`<button type="button" data-download="${esc(item.id)}" data-download-action="${action}">${actions[action]}</button>`).join('')}</div></div>`;
            }).join(''):`<p>${L('暂无下载记录','No downloads yet')}</p>`;
        }else if(menu==='extensions'){
            title=L('扩展程序','Extensions');body=bridge?((state.extensions||[]).map(item=>`<div class="dc-browser-download"><div><b>${esc(item.name)}</b><small>${esc(item.version)} · ${item.enabled?L('已加载','Loaded'):L('加载失败','Failed to load')}</small></div></div>`).join(''))+'<p>'+L('管理已加载的扩展，导入 ZIP 或文件夹，或启用本机 Chrome / Edge 扩展。','Manage loaded extensions, import a ZIP or folder, or enable local Chrome / Edge extensions.')+'</p>'+menuButton('plugins',L('管理扩展程序…','Manage extensions…')):'<p>'+L('扩展管理适用于 Dragon 桌面版。Web 侧栏无法访问或安装你当前 Chrome / Safari 的扩展。','Extension management is available in Dragon desktop. The web sidebar cannot access or install your Chrome / Safari extensions.')+'</p>';
        }else if(menu==='history'||menu==='bookmarks'){
            title=menu==='history'?L('历史记录','History'):L('收藏夹','Bookmarks');
            body=bridge?(state[menu]||[]).slice(0,80).map(item=>`<button type="button" class="dc-browser-library-item" data-library-url="${esc(item.url)}"><b>${esc(item.title||item.url)}</b><small>${esc(item.url)}</small></button>`).join('')||'<p>'+L('暂无记录','No entries yet')+'</p>':'<p>'+L('历史与收藏管理目前在 Dragon 桌面版提供。','History and bookmarks are available in Dragon desktop.')+'</p>';
            if(state.libraryError)body='<p>'+L('记录暂时不可用，请重试。','Records are unavailable. Try again.')+'</p>';
        }else if(menu==='tabs'){
            title=L('所有标签页','All tabs');body=state.tabs.map(tab=>`<button type="button" data-tab="${esc(tab.id)}">${tab.id===state.activeId?'✓ ':''}<span aria-hidden="true" class="dc-browser-tab-icon">◎</span>${esc(tab.url==='about:blank'?L('新标签页','New tab'):tab.title||L('新标签页','New tab'))}</button>`).join('')||'<p>'+L('暂无标签页，点击 + 开始浏览。','No tabs yet. Click + to start browsing.')+'</p>';
        }else if(menu==='keyboard'){
            title=L('网页输入与上传','Page input and upload');body='<p>'+L('将文字或文件发送到当前网页，不会发送到对话。先点击网页里的输入框或上传按钮，再使用下方工具。','Send text or files to the current webpage, not the chat. First click a field or upload button on the page, then use the tools below.')+'</p>'+(manualToken?'':'<p>'+L('请先打开网页并点击页面，再使用此工具。','Open a webpage and click it before using these tools.')+'</p>');
        }
        const focused=popup.contains(document.activeElement)?document.activeElement:null,downloadFocus=focused?.dataset.download,downloadAction=focused?.dataset.downloadAction,scroll=popup.scrollTop;
        popup.querySelector('.dc-browser-popup-content').innerHTML=`<header><b>${title}</b>${menuButton('dismiss-menu','×')}</header><div class="dc-browser-popup-body">${body}</div>`;
        popup.scrollTop=scroll;if(downloadFocus)popup.querySelector(`[data-download="${CSS.escape(downloadFocus)}"][data-download-action="${CSS.escape(downloadAction)}"]`)?.focus({preventScroll:true});
    }

    let streamController=null,streaming=false,gesture=null,errorUntil=0;
    const tokenKey=()=>`dragon_browser_control:${localStorage.getItem('tools_tenant_id')||'default'}:${localStorage.getItem('tools_user')||''}`;
    try{manualToken=sessionStorage.getItem(tokenKey())||'';if(manualToken)lastActivity=Date.now();}catch{}
    function remember(token){if(token&&token!==manualToken)lastActivity=Date.now();manualToken=token||'';try{manualToken?sessionStorage.setItem(tokenKey(),manualToken):sessionStorage.removeItem(tokenKey());}catch{}}
    function headers(){const result=window.getAuthHeaderForNav?.()||{};const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');if(token&&!result.Authorization)result.Authorization=`Bearer ${token}`;return result;}
    function setStatus(text,type='info'){
        const msg=String(text||'').trim();
        if(!statusBadge)return;
        if(!msg){
            statusBadge.hidden=true;
            if(statusTextNode)statusTextNode.textContent='';
            statusBadge.classList.remove('is-error','is-loading');
            if(agentStatusNode&&!image?.hidden)agentStatusNode.textContent='';
            return;
        }
        const isBlankPrompt=!displayedFrame&&image?.hidden;
        if(isBlankPrompt){
            statusBadge.hidden=true;
            if(statusTextNode)statusTextNode.textContent='';
            if(agentStatusNode)agentStatusNode.textContent=msg;
            return;
        }
        if(agentStatusNode)agentStatusNode.textContent='';
        statusBadge.hidden=false;
        const isError=type==='error'||Date.now()<=errorUntil;
        statusBadge.classList.toggle('is-error',isError);
        statusBadge.classList.toggle('is-loading',!isError&&(type==='loading'||/读取|加载|上传|重连|刷新|Loading|Uploading|Connecting|Refreshing/i.test(msg)));
        if(statusTextNode)statusTextNode.textContent=msg;
        statusBadge.title=msg;
    }
    function showError(message){errorUntil=Date.now()+6000;status.textContent=message;}
    function fit(){
        if(!open||!autoFit)return;
        const left=Math.max(0,document.querySelector('.home-main')?.getBoundingClientRect().left||0),available=innerWidth-left;
        const preferred=Number(state.layout?.preferredWidth);
        // 手机页面按手机宽度收窄；电脑页面尽量放宽，只给中间对话留出可读的宽度。
        const desktop=Math.max(720,Math.round(available-Math.max(380,available*.25)));
        const width=innerWidth<=860?innerWidth-32:preferred>=360&&preferred<=744?preferred:pageWidth>0&&pageWidth<=600?Math.max(320,pageWidth+32):desktop;
        window.SidebarResize?.setWidth(panel,width);
    }
    function collapseMenu(){
        const v2=document.documentElement.dataset.ui==='v2';
        previousMenu={v2,collapsed:document.body.classList.contains(v2?'v2-side-collapsed':'home-sidebar-collapsed')};
        if(v2&&window.HomeV2?.setSideCollapsed)window.HomeV2.setSideCollapsed(true,{remember:false});
        else document.body.classList.add(v2?'v2-side-collapsed':'home-sidebar-collapsed');
        autoFit=true;
    }
    function restoreMenu(){
        if(!previousMenu)return;
        const {v2,collapsed}=previousMenu,key=v2?'v2-side-collapsed':'home-sidebar-collapsed';
        const next=innerWidth<=860&&v2?true:collapsed;
        if(document.body.classList.contains(key)){
            if(v2&&window.HomeV2?.setSideCollapsed)window.HomeV2.setSideCollapsed(next,{remember:false});
            else{document.body.classList.toggle(key,next);document.body.classList.remove('v2-mobile-side-open');}
        }
        previousMenu=null;
    }
    function bounds(){
        raf=0;positionMenu();if(!bridge||!connected)return;
        const modal=[...document.querySelectorAll('[aria-modal="true"],.app-dialog,.modal.open')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
        if(!open||suspended.size||document.hidden||document.body.classList.contains('dc-sidebar-resizing')||modal||panel?.classList.contains('is-swarm-canvas'))return bridge.bounds(null);
        const rect=surface.getBoundingClientRect();bridge.bounds(rect.width>0&&rect.height>0?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null);
    }
    function layout(){if(!raf)raf=requestAnimationFrame(bounds);}
    function visibility(){
        const visible=open&&!suspended.size;if(!visible)streamController?.abort();panel.hidden=!visible;document.body.classList.toggle('dc-browser-open',visible);toggle.setAttribute('aria-pressed',String(visible));
        if(readingVisible!==visible){readingVisible=visible;bridge?.reading?.(visible);window.dispatchEvent(new CustomEvent('dragon-claw:browser-reading',{detail:{active:visible}}));}layout();
    }
    function startRefresh(){
        if(bridge||timer)return;
        lastHeartbeat=Date.now();
        timer=setInterval(()=>{
            if(!open||suspended.size||document.hidden||busy||refreshing||panel?.classList.contains('is-swarm-canvas'))return;
            if(manualToken&&Date.now()-lastHeartbeat>30000){lastHeartbeat=Date.now();api('heartbeat').catch(()=>{});}
            if(!streaming)refresh(true);
        },2000);
    }
    async function show({createEmpty=true,liveCanvas=false}={}){
        window.ChatFiles?.closePreview();window.DragonClawWorkspace?.closePanel?.();window.DragonTerminalSidebar?.close?.();
        if(!liveCanvas&&panel?.classList.contains('is-swarm-canvas'))window.DragonHtmlSwarm?.deactivate?.();
        // 普通桌面工具与侧栏并排显示；独立原生工具视图仍暂停挂载，避免互相覆盖。
        if(toolAllowsBrowser)suspended.delete('tool');
        const fresh=!open;if(fresh)collapseMenu();open=true;
        if(!liveCanvas&&bridge&&(!connected||!docked)){connected=await bridge.connect().catch(()=>false);docked=connected;}
        syncTheme(true);visibility();if(fresh)requestAnimationFrame(fit);
        if(liveCanvas)return;
        if(bridge){if(createEmpty&&connected&&!state.tabs.length)bridge.action('new-tab');}
        else{startRefresh();await refresh();}
    }
    function close(){
        window.DragonHtmlSwarm?.deactivate?.();
        clearKeyboard();pendingTab=null;tabSignature='';
        menu='';renderMenu();
        if(manualToken)api('release',{},true).catch(()=>{});
        if(gesture?.remote){gesture.ended=true;remotePointer(gesture,'cancel',{});}gesture=null;busy=false;streamController?.abort();streamController=null;streaming=false;clearInterval(timer);timer=null;open=false;restoreMenu();viewEpoch++;controller?.abort();refreshing=false;visibility();
    }
    const reduceMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function paintTabs(tabs,activeId){
        const existing=new Map([...tabsNode.children].filter(node=>!node.classList.contains('is-leaving')).map(node=>[node.dataset.tabKey,node]));
        const previous=new Map([...existing].map(([id,node])=>[id,node.getBoundingClientRect().left]));
        const wanted=new Set(),added=[];
        for(const tab of tabs){
            let node=existing.get(tab.id)||(tab.id===pendingTab?.id?existing.get(pendingTab.previousId):null);
            if(!node){node=document.createElement('span');node.className='dc-browser-tab';node.innerHTML='<button type="button"><span class="dc-browser-tab-title"></span></button><button type="button">×</button>';added.push(node);}
            wanted.add(node);node.dataset.tabKey=tab.id;node.draggable=!tab.pending;node.setAttribute('role','tab');node.setAttribute('aria-selected',String(tab.id===activeId));node.setAttribute('aria-current',String(tab.id===activeId));node.classList.toggle('is-pending',Boolean(tab.pending));
            const select=node.firstElementChild,closeButton=node.lastElementChild,title=tab.url==='about:blank'?L('新标签页','New tab'):tab.title||L('新标签页','New tab');
            select.dataset.tab=tab.id;select.title=tab.url||'';if(select.firstElementChild.textContent!==title)select.firstElementChild.textContent=title;
            closeButton.dataset.closeTab=tab.id;closeButton.setAttribute('aria-label',L('关闭标签','Close tab'));node.setAttribute('aria-busy',String(Boolean(tab.pending)));
            if(node!==tabsNode.children[[...wanted].length-1])tabsNode.insertBefore(node,tabsNode.children[[...wanted].length-1]||null);
        }
        for(const node of existing.values())if(!wanted.has(node)){
            node.classList.add('is-leaving');node.setAttribute('aria-current','false');node.setAttribute('aria-hidden','true');node.removeAttribute('role');node.removeAttribute('data-tab-key');for(const button of node.querySelectorAll('button'))button.disabled=true;
            if(reduceMotion()){node.remove();continue;}
            const width=node.getBoundingClientRect().width;
            node.animate([{opacity:1,minWidth:width+'px',maxWidth:width+'px',transform:'scale(1)'},{opacity:0,minWidth:'0px',maxWidth:'0px',padding:'0px',marginInlineEnd:'-5px',transform:'scale(.94)'}],{duration:150,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'}).finished.catch(()=>{}).then(()=>node.remove());
        }
        if(!reduceMotion())for(const node of wanted){
            if(added.includes(node)){
                const width=node.getBoundingClientRect().width;
                node.animate([{opacity:0,minWidth:'0px',maxWidth:'0px',marginInlineEnd:'-5px',transform:'translateY(4px) scale(.96)'},{opacity:1,minWidth:width+'px',maxWidth:width+'px',marginInlineEnd:'0px',transform:'translateY(0) scale(1)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
            }else{const delta=previous.get(node.dataset.tabKey)-node.getBoundingClientRect().left;if(Math.abs(delta)>.5)node.animate([{transform:`translateX(${delta}px)`},{transform:'translateX(0)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});}
        }
        if(lastVisibleTab!==activeId){lastVisibleTab=activeId;clearTimeout(tabScrollTimer);tabScrollTimer=setTimeout(()=>{
            const node=tabsNode.querySelector('[aria-current=true]');if(!node)return;const r=node.getBoundingClientRect(),box=tabsNode.getBoundingClientRect(),delta=r.right>box.right?r.right-box.right:r.left<box.left?r.left-box.left:0;
            if(delta)tabsNode.scrollTo({left:tabsNode.scrollLeft+delta,behavior:reduceMotion()?'auto':'smooth'});
        },reduceMotion()?0:180);}
    }
    async function createTab(){
        if(panel?.classList.contains('is-swarm-canvas')){window.DragonHtmlSwarm?.deactivate?.();if(!bridge)startRefresh();}
        if(bridge){bridge.action('new-tab');return;}
        if(pendingTab?.pending||busy||state.manual?.active&&!manualToken)return;
        clearKeyboard();const placeholder={id:`pending-tab-${++tabSequence}`,title:'',url:'about:blank',pending:true};pendingTab=placeholder;tabSignature='';pageWidth=0;autoFit=true;render();
        try{
            const result=await api('new-tab');
            if(!open){if(manualToken)await api('release');pendingTab=null;return;}
            if(!result.tabId)throw Error(L('新标签页未能创建，请重试。','Could not create the tab. Try again.'));
            if(pendingTab!==placeholder)return;
            placeholder.previousId=placeholder.id;placeholder.id=result.tabId;placeholder.pending=false;
            state={...state,activeId:result.tabId,url:'about:blank',canBack:false,canForward:false,available:true};tabSignature='';render();
            // Display the acknowledged tab immediately; lease renewal and screenshot run in the background.
            await api('takeover');if(open)refresh(true);
        }catch(error){if(pendingTab===placeholder){pendingTab=null;tabSignature='';render();showError(error.message);if(open)refresh(true);}}
    }
    function render(){
        syncTheme();
        const tabs=state.tabs.slice();if(pendingTab&&!tabs.some(tab=>tab.id===pendingTab.id))tabs.push(pendingTab);
        const activeId=pendingTab?.id||state.activeId,current=tabs.find(tab=>tab.id===activeId),url=pendingTab?'about:blank':state.url||current?.url||'';
        const elsewhere=Boolean(state.manual?.active&&!manualToken),creating=Boolean(pendingTab?.pending);
        if((document.activeElement!==address||creating)&&!panel?.classList.contains('is-swarm-canvas'))address.value=url==='about:blank'?'':url;
        address.readOnly=!bridge&&(elsewhere||creating);
        const signature=JSON.stringify([tabs,activeId,L('中','en')]);
        if(signature!==tabSignature){tabSignature=signature;paintTabs(tabs,activeId);}
        for(const button of tabsNode.querySelectorAll('button'))button.disabled=busy||elsewhere||creating||button.closest('.is-leaving')!==null;
        const labels={more:L('更多选项','More options'),downloads:L('下载','Downloads'),extensions:L('扩展程序','Extensions'),tabs:L('搜索标签页','All tabs'),keyboard:L('网页输入与上传','Page input and upload'),close:L('关闭浏览器','Close browser'),external:bridge?L('在系统默认浏览器打开','Open in default browser'):L('在新标签页打开','Open in new tab'),back:L('后退','Back'),forward:L('前进','Forward'),reload:L('刷新','Refresh'), 'new-tab':L('新标签页','New tab')};
        const hasDownloads=!bridge&&Boolean(state.downloads?.length);
        panel.querySelector('.dc-browser-toolbar-actions [data-browser=downloads]').classList.toggle('has-downloads',hasDownloads);
        if(hasDownloads)labels.downloads=L('下载（有记录）','Downloads available');
        for(const [name,label]of Object.entries(labels))for(const button of panel.querySelectorAll(`[data-browser="${name}"]`)){button.title=label;button.setAttribute('aria-label',label);}
        panel.querySelector('[data-browser=back]').disabled=busy||elsewhere||!state.canBack;
        panel.querySelector('[data-browser=forward]').disabled=busy||elsewhere||!state.canForward;
        for(const button of panel.querySelectorAll('[data-browser=new-tab]'))button.disabled=busy||elsewhere||creating;
        panel.querySelector('[type=submit]').disabled=busy||elsewhere||creating;
        panel.querySelector('[type=submit]').setAttribute('aria-label',L('打开网址','Go'));
        address.placeholder=L('输入网址开始浏览','Enter a URL to browse');address.setAttribute('aria-label',L('网址','URL'));
        toggle.textContent=L('浏览器','Browser');panel.querySelector('strong').textContent=L('Dragon 浏览器','Dragon Browser');panel.setAttribute('aria-label',L('内置浏览器','Built-in browser'));
        hint.hidden=true;hint.textContent='';
        const blank=!url||url==='about:blank';surface.classList.toggle('is-empty',blank);if(!bridge&&blank){image.hidden=true;status.textContent=L('输入网址或搜索关键词开始浏览','Enter a URL or search to start browsing');}
        renderOperator();
        controlBox.hidden=Boolean(bridge)||!manualToken||menu!=='keyboard';
        controlBox.querySelector('label').textContent=L('先点网页输入框，再在这里输入','Click a page field, then type here');
        textInput.placeholder=L('内容直接发送到网页','Send directly to the page');textInput.setAttribute('aria-label',L('网页输入','Page input'));textInput.disabled=busy;
        const keys={'send-text':L('发送输入','Send text'),'remote-up':L('上滚','Up'),'remote-down':L('下滚','Down'),'remote-tab':L('下一项','Tab'),'remote-backspace':L('退格','Backspace'),'remote-enter':L('回车','Enter'),'remote-zoom':zoomed?L('适应宽度','Fit width'):L('放大画面','Zoom view')};
        for(const[name,label]of Object.entries(keys)){const button=panel.querySelector(`[data-browser="${name}"]`);button.textContent=label;button.disabled=busy;}
        panel.querySelector('[data-label=replace]').textContent=L('替换当前输入框','Replace current field');panel.querySelector('[data-label=mask]').textContent=L('隐藏输入','Hide input');
        panel.querySelector('[data-label=drag]').textContent=L('拖拽模式（手机）','Drag mode (touch)');
        const upload=panel.querySelector('[data-browser=upload]');upload.textContent=L(state.upload?'选择文件上传到网页':'先点击网页的上传按钮',state.upload?'Choose files for this page':'Click the page upload button first');upload.disabled=busy||!state.upload;
        panel.querySelector('[data-local-files]').multiple=Boolean(state.upload?.multiple);
        image.classList.toggle('is-controllable',Boolean(manualToken));image.tabIndex=0;image.style.touchAction=manualToken&&!zoomed?'none':'auto';renderMenu();
        const findBar=panel.querySelector('.dc-browser-find'),findWasHidden=findBar.hidden;findBar.hidden=!bridge||!state.find?.open;
        if(findWasHidden&&!findBar.hidden)panel.querySelector('[data-find-input]').focus();
        panel.querySelector('[data-find-input]').placeholder=L('在页面中查找','Find in page');panel.querySelector('[data-find-input]').setAttribute('aria-label',L('在页面中查找','Find in page'));
        if(bridge&&state.find?.open)panel.querySelector('[data-find-count]').textContent=`${state.find.activeMatch||0} / ${state.find.matches||0}`;
        panel.querySelector('[data-browser=keyboard]').hidden=Boolean(bridge)||blank;layout();
    }
    function renderOperator(){
        if(!operatorBanner||bridge)return;
        const manual=Boolean(manualToken),elsewhere=state.manual?.active&&!manual,ai=state.operator?.active;
        const show=ai||Boolean(state.operator?.handoff)||(Date.now()<intentUntil&&ai);
        operatorBanner.hidden=!show||!state.available;operatorBanner.classList.toggle('is-manual',manual);
        const seconds=Math.max(0,Math.ceil(((state.operator?.expiresAt||lastActivity+5000)-Date.now())/1000));
        operatorBanner.querySelector('span').textContent=manual?L(`你正在操作 · ${seconds} 秒后 AI 继续`,`You are in control · AI resumes in ${seconds}s`):elsewhere?L('其他窗口正在操作','Controlled in another window'):ai?L('AI 正在操作 · 暂停后可操作页面','AI is working · pause to interact'):L('页面由 AI 控制','AI controls this page');
        const button=operatorBanner.querySelector('button');button.textContent=manual?L('立即交还','Return to AI'):L('停止并接管','Stop and take control');button.disabled=busy||elsewhere;
        button.dataset.browser=manual?'return-ai':'stop-and-control';
        const cursor=state.operator?.cursor;
        aiPointer.hidden=!ai||manual||!cursor||Date.now()-cursor.at>5000||image.hidden;
        if(!aiPointer.hidden){const r=image.getBoundingClientRect(),s=surface.getBoundingClientRect();aiPointer.style.left=`${r.left-s.left+cursor.x*r.width}px`;aiPointer.style.top=`${r.top-s.top+cursor.y*r.height}px`;}
    }
    function intent(event){
        if(bridge||!state.available)return false;
        if(manualToken){activity();return false;}
        if(!state.operator?.active)return true;
        event?.preventDefault();intentUntil=Date.now()+5000;renderOperator();return true;
    }
    function activity(){
        if(!manualToken)return;
        lastActivity=Date.now();if(state.operator)state.operator.expiresAt=lastActivity+5000;
        if(Date.now()-activitySent>500){activitySent=Date.now();api('activity').catch(()=>{});}renderOperator();
    }
    async function refresh(quiet=false){
        if(bridge||!open)return;
        if(quiet&&refreshing)return;
        const epoch=++viewEpoch;controller?.abort();const request=new AbortController();controller=request;refreshing=true;
        const timeout=setTimeout(()=>request.abort(),20000);
        const hasVisibleFrame=Boolean(displayedFrame&&!image.hidden);
        if(!quiet&&!hasVisibleFrame)status.textContent=L('正在读取浏览器画面…','Loading browser view…');
        try{
            const response=await fetch('/api/agent-workspace/browser/view',{headers:headers(),credentials:'same-origin',cache:'no-store',signal:request.signal});const data=await response.json();
            if(epoch!==viewEpoch)return;if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
            applyView(data);
        }catch(error){if(epoch===viewEpoch)status.textContent=error.name==='AbortError'?L('读取超时，请点 ↻ 重试。','Loading timed out. Use ↻ to retry.'):error.message;}
        finally{clearTimeout(timeout);if(epoch===viewEpoch){refreshing=false;startStream();}}
    }
    function applyView(data){
        if((gesture&&!gesture.remote)||(busy&&streaming&&!gesture?.remote))return;
        if(data.error){status.textContent=data.error;return;}
        if(pendingTab&&!pendingTab.pending){if(!data.tabs?.some(tab=>tab.id===pendingTab.id))return;pendingTab=null;}
        if(!data.manual?.active&&!busy)remember('');state={...data,tabs:data.tabs||[]};
        if(data.available&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(data.image||'')){
            image.onload=()=>{if(image.src!==data.image)return;displayedFrame=data;pageWidth=data.viewport?.width||image.naturalWidth;fit();};image.src=data.image;image.alt=data.title||L('网页画面','Browser view');image.hidden=false;
            if(Date.now()>errorUntil)status.textContent='';
        }else{displayedFrame=null;image.hidden=true;status.textContent=L('输入网址开始浏览，或让 AI 打开一个网站。','Enter a URL to browse, or ask AI to open a site.');}
        render();
    }
    async function startStream(){
        if(bridge||streaming||!open||suspended.size||document.hidden||!state.available)return;
        const request=new AbortController();streamController=request;streaming=true;
        let reader;
        try{
            const response=await fetch('/api/agent-workspace/browser/stream',{headers:headers(),credentials:'same-origin',cache:'no-store',signal:request.signal});
            if(!response.ok||!response.body?.getReader||!response.headers.get('content-type')?.includes('application/x-ndjson'))return;
            reader=response.body.getReader();const decoder=new TextDecoder();let pending='';
            while(open&&!suspended.size&&!document.hidden&&!request.signal.aborted){
                const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});
                if(pending.length>16*1024*1024)throw Error('Frame too large');
                let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(line)applyView(JSON.parse(line));}
            }
        }catch(error){if(error.name!=='AbortError')status.textContent=L('连接中断，正在重新连接…','Connection lost. Reconnecting…');}
        finally{reader?.cancel().catch(()=>{});if(streamController===request){streamController=null;streaming=false;}}
    }
    async function uploadFiles(files,point){
        if(!manualToken||busy||!displayedFrame||!files.length)return;
        if(files.length>5||[...files].some(file=>file.size>20*1024*1024)){showError(L('单个文件上限 20MB，一次最多 5 个','Up to 5 files, 20MB each'));return;}
        const form=new FormData();form.set('action',point?'file-drop':'upload');form.set('token',manualToken);form.set('frameId',displayedFrame.frameId);
        if(point){form.set('x',point.x);form.set('y',point.y);}else form.set('chooserId',state.upload?.id||'');
        for(const file of files)form.append('files',file);
        busy=true;render();status.textContent=L('正在上传文件…','Uploading files…');
        try{
            const response=await fetch('/api/agent-workspace/browser/upload',{method:'POST',headers:headers(),credentials:'same-origin',body:form});const data=await response.json();
            if(!response.ok)throw Error(data.error||'Upload failed');
            busy=false;await refresh();
        }catch(error){showError(error.message);}finally{busy=false;render();panel.querySelector('[data-local-files]').value='';}
    }
    async function saveDownload(button){
        const item=state.downloads?.find(item=>item.id===button.dataset.download&&item.state==='completed');
        if(!item)return;
        button.disabled=true;
        try{
            const response=await fetch('/api/agent-workspace/browser/downloads/'+encodeURIComponent(item.id),{headers:headers(),credentials:'same-origin',cache:'no-store'});
            if(!response.ok)throw Error(L('下载文件已失效或暂时无法读取。','The download has expired or is unavailable.'));
            const url=URL.createObjectURL(await response.blob());
            const link=document.createElement('a');
            link.href=url;link.download=item.name;link.click();
            setTimeout(()=>URL.revokeObjectURL(url),60000);
        }catch(error){showError(error.message);}
        finally{button.disabled=false;}
    }
    async function api(action,details={},keepalive=false){
        const sentToken=manualToken;
        const response=await fetch('/api/agent-workspace/browser/control',{method:'POST',credentials:'same-origin',cache:'no-store',keepalive,headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({action,token:sentToken,...details})});
        const result=await response.json();
        if(!response.ok){if(['BROWSER_CONTROL_REQUIRED','BROWSER_NO_TAB'].includes(result.code)&&manualToken===sentToken)remember('');throw Object.assign(Error(result.error||`HTTP ${response.status}`),{code:result.code});}
        if(result.token)remember(result.token);
        if(action!=='heartbeat'&&action!=='release'){lastActivity=Date.now();if(state.operator)state.operator.expiresAt=lastActivity+5000;}
        if(action==='release'&&manualToken===sentToken)remember('');
        return result;
    }
    async function command(action,details={}){
        if(['open','new-tab','select-tab','close-tab','release'].includes(action))clearKeyboard();
        if(busy)return;busy=true;render();
        try{
            if(!manualToken&&!['open','new-tab','takeover','release'].includes(action))await api('takeover');
            await api(action,details);
            if(['open','new-tab'].includes(action))await api('takeover');
            if(!open&&manualToken){await api('release',{},true);return;}
            if(action==='type')textInput.value='';
            busy=false;await refresh();
        }catch(error){showError(error.message||L('操作未确认，请刷新画面核对。','Input not confirmed. Refresh to check.'));}
        finally{busy=false;render();}
    }
    function clearKeyboard(){keyEpoch++;keyQueue=[];clearTimeout(keyTimer);}
    function sameDocument(a,b){return a&&b&&a.tabId===b.tabId&&a.url===b.url&&a.documentId===b.documentId;}
    function enqueueKey(action,details){
        if(!displayedFrame)return;
        const context={tabId:displayedFrame.tabId,url:displayedFrame.url,documentId:displayedFrame.documentId};
        const tail=keyQueue.at(-1);
        if(action==='type'&&!details.replace&&tail?.action==='type'&&!(keySending&&keyQueue.length===1)&&!tail.details.replace&&sameDocument(context,tail.context)&&tail.details.text.length+details.text.length<=10000)tail.details.text+=details.text;
        else keyQueue.push({action,details:{...details},context});
        lastActivity=Date.now();clearTimeout(keyTimer);keyTimer=setTimeout(flushKeys,20);
    }
    async function freshInputFrame(){
        await refresh();
        for(let n=0;n<40;n++){if(displayedFrame?.frameId===state.frameId)return displayedFrame;await new Promise(resolve=>setTimeout(resolve,10));}
        return displayedFrame;
    }
    async function flushKeys(){
        if(keySending||!keyQueue.length)return;
        if(busy||gesture){keyTimer=setTimeout(flushKeys,30);return;}
        keySending=true;const epoch=keyEpoch;
        try{
            while(keyQueue.length&&epoch===keyEpoch&&open){
                const item=keyQueue[0];if(!sameDocument(item.context,displayedFrame))throw Error(L('页面已切换，已暂停后续输入，请确认页面后重试。','The page changed. Further input was paused; check the page before retrying.'));
                if(!manualToken){if(state.operator?.active)throw Error(L('AI 正在操作，请先停止并接管。','Stop AI and take control before typing.'));await api('takeover');await freshInputFrame();if(!sameDocument(item.context,displayedFrame))throw Error(L('页面已切换，请确认后重新输入。','The page changed. Check it before typing again.'));}
                if(epoch!==keyEpoch||!open)break;
                try{await api(item.action,{frameId:displayedFrame.frameId,...item.details});}
                catch(error){
                    if(error.code!=='BROWSER_VIEW_STALE'||!item.context.documentId)throw error;
                    const fresh=await freshInputFrame();if(epoch!==keyEpoch||!open)break;if(!sameDocument(item.context,fresh))throw error;
                    await api(item.action,{frameId:fresh.frameId,...item.details});
                }
                if(epoch!==keyEpoch)break;keyQueue.shift();
            }
        }catch(error){if(epoch===keyEpoch){const unsent=keyQueue.filter(item=>item.action==='type').map(item=>item.details.text).join('');if(unsent)textInput.value+=unsent;clearKeyboard();showError(error.message);refresh(true);}}
        finally{keySending=false;if(keyQueue.length)keyTimer=setTimeout(flushKeys,0);if(!streaming)refresh(true);}
    }
    function input(action,details={}){if(['type','key'].includes(action)){enqueueKey(action,details);return;}if(manualToken&&displayedFrame)return command(action,{frameId:displayedFrame.frameId,...details});}

    function remotePointer(g,phase,point){
        g.pending={phase,point};
        if(g.sending)return;
        g.sending=true;
        (async()=>{
            try{
                while(g.pending){
                    const next=g.pending;g.pending=null;
                    await api('pointer',{phase:next.phase,pointerId:g.remoteId,frameId:g.frameId,...next.point});
                }
            }catch(error){g.pending=null;showError(error.message);await api('pointer',{phase:'cancel'}).catch(()=>{});}
            finally{g.sending=false;if(g.ended){busy=false;render();refresh(true);}}
        })();
    }
    function normalizeUrl(raw){const value=raw.trim();if(!value)throw Error();if(!/^[a-z][a-z\d+.-]*:/i.test(value)&&(/\s/.test(value)||!/[.:/]/.test(value)))return 'https://www.google.com/search?q='+encodeURIComponent(value);const prefix=/^(localhost|127\.0\.0\.1)(:|\/|$)/.test(value)?'http://':'https://';const url=new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value)?value:prefix+value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();return url.href;}
    function navigate(){
        if(/^dragon:\/\/ai-swarm-canvas/i.test(address.value.trim()))return;
        if(panel?.classList.contains('is-swarm-canvas')){window.DragonHtmlSwarm?.deactivate?.();if(!bridge)startRefresh();}
        if(bridge)return bridge.action('navigate',address.value);
        let url;try{url=normalizeUrl(address.value);}catch{status.textContent=L('请输入有效的 HTTP 或 HTTPS 网址。','Enter a valid HTTP or HTTPS URL.');return;}
        autoFit=true;pageWidth=0;command('open',{url});
    }
    function action(name){
        if(name==='close')return close();
        if(name==='dismiss-menu'){menu='';renderMenu();return layout();}
        if(['more','downloads','extensions','tabs','keyboard','history','bookmarks'].includes(name)){
            setMenu(name);
            return;
        }
        if(name==='screenshot'){
            if(bridge){bridge.action('screenshot');return;}
            if(image.hidden)return;const a=document.createElement('a');a.href=image.src;a.download=image.src.startsWith('data:image/jpeg')?'Dragon-page.jpg':'Dragon-page.png';a.click();return;
        }
        if(name==='reopen-tab'&&!bridge){const tab=closedTabs.pop();if(tab)command('new-tab').then(()=>command('open',{url:tab.url}));return;}
        if(!bridge&&['zoom-in','zoom-out','zoom-reset'].includes(name)){viewScale=name==='zoom-reset'?1:Math.max(.5,Math.min(3,Math.round((viewScale+(name==='zoom-in'?.25:-.25))*100)/100));zoomed=viewScale!==1;image.style.width=`${viewScale*100}%`;menuSignature='';render();return;}
        if(bridge&&['plugins','print','devtools','find-open'].includes(name)){menu='';renderMenu();layout();}

        if(name==='popout')name='external';
        if(name==='external'){const url=state.url||state.tabs.find(tab=>tab.id===state.activeId)?.url;if(bridge)return bridge.action('external');if(/^https?:\/\//.test(url||''))window.open(url,'_blank','noopener,noreferrer');return;}
        if(name==='new-tab')return createTab();
        if(bridge)return bridge.action(name);
        if(name==='upload')return panel.querySelector('[data-local-files]').click();
        if(name==='reload'){status.textContent=L('正在刷新…','Refreshing…');return command('reload');}
        if(name==='stop-and-control')return command('takeover');
        if(name==='return-ai')return command('release');
        if(name==='back'||name==='forward')return command(name);
        if(name==='send-text'){const text=textInput.value;textInput.value='';return input('type',{text,replace:controlBox.querySelector('[data-replace]').checked});}
        if(name==='remote-up'||name==='remote-down')return input('scroll',{x:.5,y:.5,deltaY:(name==='remote-up'?-1:1)*Math.min(3000,Math.round((displayedFrame?.viewport?.height||900)*.7))});
        if(['remote-tab','remote-enter','remote-backspace'].includes(name))return input('key',{key:{'remote-tab':'Tab','remote-enter':'Enter','remote-backspace':'Backspace'}[name]});
        if(name==='remote-zoom'){zoomed=!zoomed;viewScale=zoomed?Math.max(image.naturalWidth/surface.clientWidth,1.5):1;image.style.width=`${viewScale*100}%`;render();}
    }
    function init(){
        toggle=document.getElementById('dcBrowserToggle');const workspace=document.getElementById('dcWorkspacePanel');if(!toggle||!workspace)return;
        panel=document.createElement('aside');panel.className='dc-browser-panel';panel.classList.toggle('dc-browser-native',Boolean(bridge));panel.id='dcBrowserPanel';panel.hidden=true;
        const button=(name)=>`<button type="button" data-browser="${name}">${icon(name)}</button>`;
        panel.innerHTML=`<header class="dc-browser-head"><strong>Dragon 浏览器</strong><div class="dc-browser-tabbar"><div class="dc-browser-tabs" role="tablist"></div>${button('new-tab')}${button('tabs')}</div><div class="dc-browser-window-actions">${button('external')}${button('close')}</div></header><form class="dc-browser-address"><div class="dc-browser-navigation">${button('back')}${button('forward')}${button('reload')}</div><div class="dc-browser-url-wrap"><input autocomplete="off" spellcheck="false" enterkeyhint="go"><div class="dc-browser-status-badge" role="status" aria-live="polite" hidden><span class="dc-browser-status-dot" aria-hidden="true"></span><span class="dc-browser-status-text"></span></div></div><button type="submit" class="dc-browser-go" aria-label="Go">↵</button><div class="dc-browser-toolbar-actions">${button('keyboard')}${button('extensions')}${button('downloads')}${button('more')}</div></form><div class="dc-browser-hint" hidden></div><section class="dc-browser-popup" hidden><div class="dc-browser-popup-content"></div></section><div class="dc-browser-find" hidden><input data-find-input><span data-find-count></span><button type="button" data-find-forward="false">↑</button><button type="button" data-find-forward="true">↓</button><button type="button" data-browser="find-close">×</button></div><div class="dc-browser-control" hidden><label></label><div class="dc-browser-type"><input data-remote-text autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" data-browser="send-text"></button></div><div class="dc-browser-control-options"><label><input type="checkbox" data-replace><span data-label="replace"></span></label><label><input type="checkbox" data-mask><span data-label="mask"></span></label><label><input type="checkbox" data-drag-mode><span data-label="drag"></span></label></div><div class="dc-browser-upload"><button type="button" data-browser="upload"></button><input type="file" data-local-files hidden></div><div class="dc-browser-control-keys"><button type="button" data-browser="remote-up"></button><button type="button" data-browser="remote-down"></button><button type="button" data-browser="remote-tab"></button><button type="button" data-browser="remote-backspace"></button><button type="button" data-browser="remote-enter"></button><button type="button" data-browser="remote-zoom"></button></div></div><div class="dc-browser-surface"><div class="dc-browser-agent-view"><div class="dc-browser-agent-status" role="status"></div><img hidden></div></div>`;
        workspace.after(panel);surface=panel.querySelector('.dc-browser-surface');address=panel.querySelector('.dc-browser-address input');tabsNode=panel.querySelector('.dc-browser-tabs');hint=panel.querySelector('.dc-browser-hint');image=panel.querySelector('.dc-browser-agent-view img');statusBadge=panel.querySelector('.dc-browser-status-badge');statusTextNode=panel.querySelector('.dc-browser-status-text');agentStatusNode=panel.querySelector('.dc-browser-agent-status');controlBox=panel.querySelector('.dc-browser-control');textInput=panel.querySelector('[data-remote-text]');
        status={
            get textContent(){return statusTextNode?.textContent||agentStatusNode?.textContent||'';},
            set textContent(val){
                const isErr=Date.now()<=errorUntil;
                setStatus(val,isErr?'error':'info');
            }
        };
        panel.querySelector('.dc-browser-popup').append(controlBox);
        operatorBanner=document.createElement('div');operatorBanner.className='dc-browser-operator';operatorBanner.hidden=true;operatorBanner.setAttribute('role','status');operatorBanner.innerHTML='<span></span><button type="button" data-browser="stop-and-control"></button>';surface.append(operatorBanner);
        aiPointer=document.createElement('div');aiPointer.className='dc-browser-ai-pointer';aiPointer.hidden=true;aiPointer.innerHTML='<svg width="24" height="28" viewBox="0 0 24 28" aria-hidden="true"><path d="M2 2L20 17L12 18L8 26Z" fill="currentColor" stroke="white" stroke-width="2"/></svg><span>AI</span>';surface.append(aiPointer);
        setInterval(()=>{
            if(bridge||!open)return;renderOperator();
            if(manualToken&&!busy&&!keySending&&!keyQueue.length&&!gesture&&!idleRelease&&Date.now()-lastActivity>=5000){idleRelease=true;api('release').then(()=>refresh(true)).catch(()=>{}).finally(()=>{idleRelease=false;});}
        },200);
        panel.querySelector('.dc-browser-agent-view').hidden=Boolean(bridge);
        window.SidebarResize?.bind({panel,cssVar:'--browser-panel-width',storageKey:'dragon_browser_sidebar_width',defaultWidth:480,onManualResize:()=>{autoFit=false;}});
        toggle.addEventListener('click',()=>open?close():show());panel.querySelector('form').addEventListener('submit',event=>{event.preventDefault();navigate();});
        panel.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.browser)action(button.dataset.browser);if(button.dataset.tab){if(bridge)bridge.action('tab-select',button.dataset.tab);else command('select-tab',{tabId:button.dataset.tab});}if(button.dataset.closeTab){const closedId=button.dataset.closeTab,closed=state.tabs.find(tab=>tab.id===closedId);if(closed&&/^https?:/.test(closed.url))closedTabs.push(closed);closedTabs=closedTabs.slice(-20);const lastTab=state.tabs.filter(tab=>tab.id!==closedId&&!tab.pending).length===0;if(bridge)bridge.action('tab-close',closedId);else command('close-tab',{tabId:closedId});if(lastTab)close();}});
        panel.addEventListener('click',event=>{
            const button=event.target.closest('button');if(!button)return;
            if(button.dataset.download&&bridge)bridge.action('download-action',{id:button.dataset.download,action:button.dataset.downloadAction});
            if(!bridge&&button.dataset.downloadAction==='save')saveDownload(button);
            if(button.dataset.libraryUrl&&bridge){bridge.action('library-open',button.dataset.libraryUrl);setMenu(menu);}
            if(button.dataset.findForward&&bridge)bridge.action('find',{text:panel.querySelector('[data-find-input]').value,forward:button.dataset.findForward==='true'});
        });
        panel.querySelector('[data-find-input]').addEventListener('input',event=>bridge?.action('find',{text:event.target.value}));
        panel.querySelector('[data-find-input]').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();bridge?.action('find',{text:event.target.value,forward:!event.shiftKey});}});
        address.addEventListener('focus',()=>address.select());
        tabsNode.addEventListener('dragstart',event=>{draggedTab=event.target.closest('[role=tab]')?.querySelector('[data-tab]')?.dataset.tab;if(draggedTab)event.dataTransfer.setData('text/plain',draggedTab);});
        tabsNode.addEventListener('dragover',event=>{if(draggedTab)event.preventDefault();});
        tabsNode.addEventListener('drop',event=>{event.preventDefault();const target=event.target.closest('[role=tab]')?.querySelector('[data-tab]')?.dataset.tab;if(target&&draggedTab&&target!==draggedTab){const from=state.tabs.findIndex(tab=>tab.id===draggedTab),to=state.tabs.findIndex(tab=>tab.id===target);if(bridge)bridge.action('tab-move',{id:draggedTab,beforeId:from<to?(state.tabs[to+1]?.id||null):target});else command('move-tab',{tabId:draggedTab,index:to});}draggedTab=null;});
        tabsNode.addEventListener('dragend',()=>{draggedTab=null;});
        panel.addEventListener('keydown',event=>{
            if(!(event.ctrlKey||event.metaKey))return;const key=event.key.toLowerCase();
            if(key==='l'){event.preventDefault();address.focus();address.select();}
            if(key==='t'){event.preventDefault();action(event.shiftKey?'reopen-tab':'new-tab');}
            if(key==='w'){event.preventDefault();const tab=state.tabs.find(tab=>tab.id===state.activeId);if(tab)panel.querySelector(`[data-close-tab="${CSS.escape(tab.id)}"]`)?.click();}
            if(key==='f'&&bridge){event.preventDefault();bridge.action('find-open');panel.querySelector('[data-find-input]').focus();}
        });
        document.addEventListener('pointerdown',event=>{if(menu&&!event.target.closest('.dc-browser-popup,.dc-browser-toolbar-actions,[data-browser=tabs]')){menu='';renderMenu();layout();}});
        new MutationObserver(()=>{syncTheme();render();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
        controlBox.addEventListener('keydown',activity);controlBox.addEventListener('pointerdown',activity);
        controlBox.querySelector('[data-mask]').addEventListener('change',event=>{textInput.type=event.target.checked?'password':'text';});textInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();action('send-text');}});
        image.addEventListener('dragstart',event=>event.preventDefault());
        panel.querySelector('[data-local-files]').addEventListener('change',event=>uploadFiles(event.target.files));
        let suppressClick=0,wheelTimer=null,wheelDelta=0;
        const relative=event=>{const r=image.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};};
        image.addEventListener('pointerdown',event=>{
            if(event.button!==0||intent(event)||!manualToken||busy||zoomed)return;
            gesture={id:event.pointerId,startX:event.clientX,startY:event.clientY,points:[relative(event)],touch:event.pointerType==='touch'&&!panel.querySelector('[data-drag-mode]').checked};
            image.setPointerCapture(event.pointerId);
            if(!gesture.touch){
                Object.assign(gesture,{remote:true,remoteId:crypto.randomUUID(),frameId:displayedFrame.frameId});busy=true;render();
                remotePointer(gesture,'down',gesture.points[0]);
            }
        });
        image.addEventListener('pointermove',event=>{if(manualToken&&event.isTrusted)activity();if(gesture?.id===event.pointerId){gesture.points.push(relative(event));if(gesture.remote)remotePointer(gesture,'move',relative(event));if(gesture.points.length>100)gesture.points=gesture.points.filter((_,i)=>i%2===0);}});
        image.addEventListener('pointerup',event=>{
            if(gesture?.id!==event.pointerId)return;const g=gesture;gesture=null;
            if(g.remote){g.ended=true;suppressClick=Date.now()+500;remotePointer(g,'up',relative(event));return;}
            if(Math.hypot(event.clientX-g.startX,event.clientY-g.startY)<6)return;
            suppressClick=Date.now()+500;
            if(g.touch){const rect=image.getBoundingClientRect();input('scroll',{x:.5,y:.5,deltaY:Math.max(-3000,Math.min(3000,Math.round((g.startY-event.clientY)/rect.height*(displayedFrame?.viewport?.height||900))))});}
        });
        const cancelGesture=()=>{if(gesture?.remote){gesture.ended=true;remotePointer(gesture,'cancel',{});}gesture=null;};
        image.addEventListener('keydown',event=>{
            if(!manualToken&&!state.operator?.active&&state.available&&!event.ctrlKey&&!event.metaKey&&!event.altKey){const key=event.key;if(['Enter','Tab','Backspace','Delete','Escape','ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Home','End'].includes(key)||key.length===1){event.preventDefault();input(key.length===1?'type':'key',key.length===1?{text:key}:{key});}return;}
            if(intent(event)){operatorBanner.querySelector('button').focus();return;}if(!manualToken||event.ctrlKey||event.metaKey||event.altKey)return;
            if(['Enter','Tab','Backspace','Delete','Escape','ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();input('key',{key:event.key});}
            else if(event.key.length===1){event.preventDefault();input('type',{text:event.key});}
        });
        image.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain');if(text&&manualToken){event.preventDefault();input('type',{text});}});
        image.addEventListener('pointercancel',cancelGesture);
        image.addEventListener('lostpointercapture',cancelGesture);
        image.addEventListener('click',event=>{if(!manualToken&&!state.operator?.active&&!busy&&state.available){const point=relative(event);command('takeover').then(()=>input('click',point));return;}if(intent(event))return;if(!manualToken||busy||Date.now()<suppressClick)return;input('click',relative(event));});
        image.addEventListener('dragover',event=>{if(manualToken&&event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
        image.addEventListener('drop',event=>{event.preventDefault();if(manualToken&&event.dataTransfer?.files.length)uploadFiles(event.dataTransfer.files,relative(event));});
        image.addEventListener('wheel',event=>{if(!manualToken&&!state.operator?.active&&!busy&&state.available&&!event.ctrlKey&&!zoomed){event.preventDefault();const deltaY=Math.max(-3000,Math.min(3000,Math.round(event.deltaY)));command('takeover').then(()=>input('scroll',{x:.5,y:.5,deltaY}));return;}if(intent(event))return;if(!manualToken||event.ctrlKey||zoomed)return;event.preventDefault();wheelDelta+=event.deltaY;clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{const deltaY=Math.max(-3000,Math.min(3000,Math.round(wheelDelta)));wheelDelta=0;if(!busy)input('scroll',{x:.5,y:.5,deltaY});},120);},{passive:false});
        for(const[name,key]of[['home:hub','hub'],['home:tool-frame','tool']])window.addEventListener(name,event=>{
            if(key==='tool')toolAllowsBrowser=Boolean(bridge&&event.detail?.open&&event.detail?.browserAllowed);
            event.detail?.open?suspended.add(key):suspended.delete(key);visibility();
        });
        window.addEventListener('dragon-claw:sidebar-layout',layout);window.addEventListener('dragon-claw:browser-update',event=>{if(bridge)return;if(event.detail?.tool==='browser_navigate'){autoFit=true;pageWidth=0;}if(innerWidth>860||open)show();});
        window.matchMedia('(max-width: 860px)').addEventListener('change',event=>{if(event.matches)close();});window.addEventListener('resize',()=>{if(autoFit)fit();layout();});window.addEventListener('tools:languagechange',render);
        window.addEventListener('beforeunload',()=>{if(manualToken)api('release',{},true).catch(()=>{});bridge?.bounds(null);bridge?.reading?.(false);});document.addEventListener('visibilitychange',()=>{layout();if(document.hidden){if(gesture?.remote){gesture.ended=true;remotePointer(gesture,'cancel',{});gesture=null;}streamController?.abort();}else if(open){refresh(true);}});
        document.addEventListener('pointerdown',event=>{if(innerWidth<=860&&open&&!panel.contains(event.target)&&!toggle.contains(event.target)&&!event.target.closest('[aria-modal="true"],.app-dialog'))close();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu){menu='';renderMenu();layout();event.preventDefault();return;}if(event.key==='Escape'&&open&&!event.defaultPrevented&&!document.querySelector('[aria-modal="true"]'))close();});
        new ResizeObserver(layout).observe(surface);new MutationObserver(layout).observe(document.body,{attributes:true,childList:true,subtree:true,attributeFilter:['class','hidden','open','style']});
        bridge?.onUivImport?.(href=>{
            // Import in the existing authenticated tool frame, retaining the capture tab.
            try {
                const url=new URL(href,location.origin);
                if(url.origin!==location.origin||url.pathname!=='/sla'||url.searchParams.get('autoImport')!=='1')return;
                if(window.HomeToolFrame?.open(url.pathname+url.search))close();
            }catch{}
        });
        if(bridge){bridge.onState(value=>{const before=state.tabs.find(tab=>tab.id===state.activeId)?.url,after=value.tabs.find(tab=>tab.id===value.activeId)?.url;if(before!==after){autoFit=true;pageWidth=0;}state=value;if(open&&!state.tabs.length)close();else{render();requestAnimationFrame(fit);}});bridge.onReveal(()=>{if(innerWidth>860||open)show({createEmpty:false});});bridge.onFocusUrl(()=>{address.focus();address.select();});bridge.onPoppedOut(()=>{docked=false;close();});bridge.connect().then(value=>{connected=value;docked=value;layout();}).catch(()=>{});}
        render();window.DragonBrowserSidebar={open:show,close,showAgentView:show,isOpen:()=>open};
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
