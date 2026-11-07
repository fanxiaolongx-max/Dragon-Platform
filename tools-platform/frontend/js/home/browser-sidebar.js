// 一个 Dragon 浏览器：桌面端使用原生标签页，Web/手机读取并接管同一账号的浏览器。
(function () {
    'use strict';
    const bridge=window.DragonBrowser;
    const L=(zh,en)=>/^en/.test(window.ToolsI18n?.getLanguage?.()||localStorage.getItem('tools_lang')||'')?en:zh;
    const esc=value=>String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    let panel,surface,toggle,address,tabsNode,hint,image,status,controlBox,textInput,operatorBanner,aiPointer;
    let menu='',menuSignature='',closedTabs=[],draggedTab=null;
    let intentUntil=0,lastActivity=0,activitySent=0,idleRelease=false;
    let open=false,connected=false,docked=false,raf=0,readingVisible=false,previousMenu=null;
    let state={tabs:[]},displayedFrame=null,autoFit=true,pageWidth=0,zoomed=false,tabSignature='';
    let busy=false,refreshing=false,controller=null,viewEpoch=0,timer=null,lastHeartbeat=0,manualToken='';
    const suspended=new Set();
    const icons={back:'<path d="m12 4-6 6 6 6M6 10h11"/>',forward:'<path d="m8 4 6 6-6 6M3 10h11"/>',reload:'<path d="M16 7a7 7 0 1 0 1 6M16 3v5h-5"/>',extensions:'<path d="M7 3h3a2 2 0 1 1 4 0h3v5a2 2 0 1 0 0 4v5h-5a2 2 0 1 0-4 0H3v-5a2 2 0 1 1 0-4V3z"/>',downloads:'<path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5"/>',more:'<circle cx="4" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="16" cy="10" r="1"/>',tabs:'<path d="m5 8 5 5 5-5"/>',external:'<path d="M11 3h6v6M17 3 8 12M8 4H3v13h13v-5"/>',popout:'<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M12 3v14"/>',close:'<path d="m5 5 10 10M15 5 5 15"/>','new-tab':'<path d="M10 3v14M3 10h14"/>',keyboard:'<rect x="2" y="4" width="16" height="12" rx="2"/><path d="M5 7h1m3 0h1m3 0h2M5 10h1m3 0h1m3 0h2M6 13h8"/>'};
    const icon=name=>`<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.more}</svg>`;
    function menuButton(action,label,disabled=false){return `<button type="button" data-browser="${action}"${disabled?' disabled':''}>${esc(label)}</button>`;}
    function setMenu(next){menu=menu===next?'':next;menuSignature='';renderMenu();layout();}
    function renderMenu(){
        const popup=panel.querySelector('.dc-browser-popup');if(!popup)return;
        popup.hidden=!menu;
        for(const name of ['more','downloads','extensions','tabs','keyboard'])panel.querySelector(`[data-browser="${name}"]`)?.setAttribute('aria-expanded',String(menu===name));
        controlBox.hidden=Boolean(bridge)||!manualToken||menu!=='keyboard';
        if(!menu)return;
        const signature=JSON.stringify([menu,state.downloads,state.history,state.bookmarks,state.tabs,state.zoom,state.find,state.libraryError,L('中','en')]);
        if(signature===menuSignature)return;menuSignature=signature;
        let body='',title='';
        if(menu==='more'){
            title=L('浏览器菜单','Browser menu');
            body=menuButton('new-tab',L('新建标签页','New tab'))+menuButton('reopen-tab',L('恢复关闭的标签页','Reopen closed tab'),!bridge&&!closedTabs.length)+ '<hr>'+
                menuButton('find-open',L('在页面中查找','Find in page'),!bridge)+menuButton('print',L('打印…','Print…'),!bridge)+
                `<div class="dc-browser-zoom"><span>${L('缩放','Zoom')}</span>${menuButton('zoom-out','−')}<span>${bridge?state.zoom||100:Math.round((zoomed?1.5:1)*100)}%</span>${menuButton('zoom-in','＋')}${menuButton('zoom-reset',L('重置','Reset'))}</div><hr>`+
                menuButton('screenshot',L('保存页面截图','Save screenshot'))+menuButton('downloads',L('下载','Downloads'))+
                menuButton('history',L('历史记录','History'))+menuButton('bookmarks',L('收藏夹','Bookmarks'))+
                menuButton('keyboard',L('网页输入与上传','Page input and upload'),Boolean(bridge))+ '<hr>'+menuButton('external',L('在系统浏览器中打开','Open in system browser'))+
                menuButton('devtools',L('开发者工具','Developer tools'),!bridge);
        }else if(menu==='downloads'){
            title=L('下载','Downloads');const items=state.downloads||[];
            body=bridge?menuButton('downloads-folder',L('打开下载文件夹','Open Downloads folder')):'';
            body+=items.length?items.slice(0,50).map(item=>`<div class="dc-browser-download"><div><b>${esc(item.name)}</b><small>${esc(({completed:L('已完成','Completed'),progressing:L('下载中','Downloading'),paused:L('已暂停','Paused'),cancelled:L('已取消','Cancelled'),interrupted:L('已中断','Interrupted'),failed:L('失败','Failed')})[item.state]||item.state)} · ${Math.round((item.received||0)/1024)} KB</small></div><div>${(item.state==='completed'?['open','show']:item.state==='progressing'?['pause','cancel']:item.state==='paused'?['resume','cancel']:[]).map(action=>`<button type="button" data-download="${esc(item.id)}" data-download-action="${action}">${({open:L('打开','Open'),show:L('文件夹','Folder'),pause:L('暂停','Pause'),resume:L('继续','Resume'),cancel:L('取消','Cancel')})[action]}</button>`).join('')}</div></div>`).join(''):`<p>${bridge?L('暂无下载记录','No downloads yet'):L('Web 端暂不提供服务端浏览器的文件下载管理。可保存当前页面截图；网站文件请在系统浏览器中下载。','Server browser downloads are not available here. Save a screenshot, or download website files in your system browser.')}</p>`;
        }else if(menu==='extensions'){
            title=L('扩展程序','Extensions');body=bridge?'<p>'+L('管理已加载的扩展，导入 ZIP 或文件夹，或启用本机 Chrome / Edge 扩展。','Manage loaded extensions, import a ZIP or folder, or enable local Chrome / Edge extensions.')+'</p>'+menuButton('plugins',L('管理扩展程序…','Manage extensions…')):'<p>'+L('扩展管理适用于 Dragon 桌面版。Web 侧栏无法访问或安装你当前 Chrome / Safari 的扩展。','Extension management is available in Dragon desktop. The web sidebar cannot access or install your Chrome / Safari extensions.')+'</p>';
        }else if(menu==='history'||menu==='bookmarks'){
            title=menu==='history'?L('历史记录','History'):L('收藏夹','Bookmarks');
            body=bridge?(state[menu]||[]).slice(0,80).map(item=>`<button type="button" class="dc-browser-library-item" data-library-url="${esc(item.url)}"><b>${esc(item.title||item.url)}</b><small>${esc(item.url)}</small></button>`).join('')||'<p>'+L('暂无记录','No entries yet')+'</p>':'<p>'+L('历史与收藏管理目前在 Dragon 桌面版提供。','History and bookmarks are available in Dragon desktop.')+'</p>';
            if(state.libraryError)body='<p>'+L('记录暂时不可用，请重试。','Records are unavailable. Try again.')+'</p>';
        }else if(menu==='tabs'){
            title=L('所有标签页','All tabs');body=state.tabs.map(tab=>`<button type="button" data-tab="${esc(tab.id)}">${tab.id===state.activeId?'✓ ':''}<span aria-hidden="true" class="dc-browser-tab-icon">◎</span>${esc(tab.title||L('新标签页','New tab'))}</button>`).join('')||menuButton('new-tab',L('新建标签页','New tab'));
        }else if(menu==='keyboard'){
            title=L('网页输入与上传','Page input and upload');body=manualToken?'':'<p>'+L('点击网页即可开始操作。','Click the page to start interacting.')+'</p>';
        }
        popup.innerHTML=`<header><b>${title}</b>${menuButton('dismiss-menu','×')}</header><div class="dc-browser-popup-body">${body}</div>`;
    }

    let streamController=null,streaming=false,gesture=null,errorUntil=0;
    const tokenKey=()=>`dragon_browser_control:${localStorage.getItem('tools_tenant_id')||'default'}:${localStorage.getItem('tools_user')||''}`;
    try{manualToken=sessionStorage.getItem(tokenKey())||'';if(manualToken)lastActivity=Date.now();}catch{}
    function remember(token){if(token&&token!==manualToken)lastActivity=Date.now();manualToken=token||'';try{manualToken?sessionStorage.setItem(tokenKey(),manualToken):sessionStorage.removeItem(tokenKey());}catch{}}
    function headers(){const result=window.getAuthHeaderForNav?.()||{};const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');if(token&&!result.Authorization)result.Authorization=`Bearer ${token}`;return result;}
    function showError(message){errorUntil=Date.now()+6000;status.textContent=message;}
    function fit(){
        if(!open||!autoFit)return;
        const left=Math.max(0,document.querySelector('.home-main')?.getBoundingClientRect().left||0),available=innerWidth-left;
        const preferred=Number(state.layout?.preferredWidth);
        const width=innerWidth<=860?innerWidth-32:preferred>=360&&preferred<=744?preferred:pageWidth>0&&pageWidth<=600?Math.max(320,pageWidth+32):Math.min(1280,Math.max(720,Math.round(available*.7)));
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
        raf=0;if(!bridge||!connected)return;
        const modal=[...document.querySelectorAll('[aria-modal="true"],.app-dialog,.modal.open')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
        if(!open||suspended.size||document.hidden||document.body.classList.contains('dc-sidebar-resizing')||modal)return bridge.bounds(null);
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
            if(!open||suspended.size||document.hidden||busy||refreshing)return;
            if(manualToken&&Date.now()-lastHeartbeat>30000){lastHeartbeat=Date.now();api('heartbeat').catch(()=>{});}
            if(!streaming)refresh(true);
        },2000);
    }
    async function show(){
        window.ChatFiles?.closePreview();window.DragonClawWorkspace?.closePanel?.();
        const fresh=!open;if(fresh)collapseMenu();open=true;
        if(bridge&&(!connected||!docked)){connected=await bridge.connect().catch(()=>false);docked=connected;}
        visibility();if(fresh)requestAnimationFrame(fit);
        if(bridge){if(connected&&!state.tabs.length)bridge.action('new-tab');}
        else{startRefresh();await refresh();}
    }
    function close(){
        menu='';renderMenu();
        if(manualToken)api('release',{},true).catch(()=>{});
        if(gesture?.remote){gesture.ended=true;remotePointer(gesture,'cancel',{});}gesture=null;busy=false;streamController?.abort();streamController=null;streaming=false;clearInterval(timer);timer=null;open=false;restoreMenu();viewEpoch++;controller?.abort();refreshing=false;visibility();
    }
    function render(){
        const current=state.tabs.find(tab=>tab.id===state.activeId),url=state.url||current?.url||'';
        const elsewhere=Boolean(state.manual?.active&&!manualToken);
        if(document.activeElement!==address)address.value=url==='about:blank'?'':url;
        address.readOnly=!bridge&&elsewhere;
        const signature=JSON.stringify([state.tabs,state.activeId]);
        if(signature!==tabSignature){
            tabSignature=signature;
            tabsNode.innerHTML=state.tabs.length?state.tabs.map(tab=>`<span class="dc-browser-tab" draggable="true" role="tab" aria-selected="${tab.id===state.activeId}" aria-current="${tab.id===state.activeId}"><button type="button" data-tab="${esc(tab.id)}" title="${esc(tab.url)}">${esc(tab.title||L('新标签页','New tab'))}</button><button type="button" data-close-tab="${esc(tab.id)}" aria-label="${L('关闭标签','Close tab')}">×</button></span>`).join(''):`<span class="dc-browser-tab" aria-current="true"><button type="button" data-browser="new-tab">◎ ${L('新标签页','New tab')}</button></span>`;
        }
        if(signature!==panel.dataset.visibleTabSignature){panel.dataset.visibleTabSignature=signature;tabsNode.querySelector('[aria-current=true]')?.scrollIntoView({block:'nearest',inline:'nearest'});}
        for(const button of tabsNode.querySelectorAll('button'))button.disabled=busy||elsewhere;
        const labels={more:L('更多选项','More options'),downloads:L('下载','Downloads'),extensions:L('扩展程序','Extensions'),tabs:L('搜索标签页','All tabs'),keyboard:L('网页输入与上传','Page input and upload'),close:L('关闭浏览器','Close browser'),popout:L('独立窗口','Separate window'),external:L('在外部浏览器打开','Open externally'),back:L('后退','Back'),forward:L('前进','Forward'),reload:L('刷新','Refresh'), 'new-tab':L('新标签页','New tab')};
        for(const [name,label]of Object.entries(labels)){const button=panel.querySelector(`[data-browser="${name}"]`);if(!button)continue;button.title=label;button.setAttribute('aria-label',label);}
        panel.querySelector('[data-browser=popout]').hidden=!bridge;
        panel.querySelector('[data-browser=back]').disabled=busy||elsewhere||!state.canBack;
        panel.querySelector('[data-browser=forward]').disabled=busy||elsewhere||!state.canForward;
        for(const button of panel.querySelectorAll('[data-browser=new-tab]'))button.disabled=busy||elsewhere;
        panel.querySelector('[type=submit]').disabled=busy||elsewhere;
        panel.querySelector('[type=submit]').setAttribute('aria-label',L('打开网址','Go'));
        address.placeholder=L('输入网址开始浏览','Enter a URL to browse');address.setAttribute('aria-label',L('网址','URL'));
        toggle.textContent=L('浏览器','Browser');panel.querySelector('strong').textContent=L('Dragon 浏览器','Dragon Browser');panel.setAttribute('aria-label',L('内置浏览器','Built-in browser'));
        hint.hidden=true;hint.textContent='';
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
        panel.querySelector('[data-browser=keyboard]').hidden=Boolean(bridge);layout();
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
        if(!quiet)status.textContent=L('正在读取浏览器画面…','Loading browser view…');
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
        if(!data.manual?.active&&!busy)remember('');state={...data,tabs:data.tabs||[]};
        if(data.available&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(data.image||'')){
            image._pendingFrame=data;image.src=data.image;image.alt=data.title||L('网页画面','Browser view');image.hidden=false;
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
    async function api(action,details={},keepalive=false){
        const sentToken=manualToken;
        const response=await fetch('/api/agent-workspace/browser/control',{method:'POST',credentials:'same-origin',cache:'no-store',keepalive,headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({action,token:sentToken,...details})});
        const result=await response.json();
        if(!response.ok){if(['BROWSER_CONTROL_REQUIRED','BROWSER_NO_TAB'].includes(result.code)&&manualToken===sentToken)remember('');throw Error(result.error||`HTTP ${response.status}`);}
        if(result.token)remember(result.token);
        if(action!=='heartbeat'&&action!=='release'){lastActivity=Date.now();if(state.operator)state.operator.expiresAt=lastActivity+5000;}
        if(action==='release'&&manualToken===sentToken)remember('');
        return result;
    }
    async function command(action,details={}){
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
    function input(action,details={}){if(manualToken&&displayedFrame)return command(action,{frameId:displayedFrame.frameId,...details});}
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
        if(bridge)return bridge.action('navigate',address.value);
        let url;try{url=normalizeUrl(address.value);}catch{status.textContent=L('请输入有效的 HTTP 或 HTTPS 网址。','Enter a valid HTTP or HTTPS URL.');return;}
        autoFit=true;pageWidth=0;command('open',{url});
    }
    function action(name){
        if(name==='close')return close();
        if(name==='dismiss-menu'){menu='';renderMenu();return layout();}
        if(['more','downloads','extensions','tabs','keyboard','history','bookmarks'].includes(name)){
            setMenu(name);if(bridge&&['history','bookmarks'].includes(name))bridge.action(name);
            return;
        }
        if(name==='screenshot'){
            if(bridge){bridge.action('screenshot');return;}
            if(image.hidden)return;const a=document.createElement('a');a.href=image.src;a.download=image.src.startsWith('data:image/jpeg')?'Dragon-page.jpg':'Dragon-page.png';a.click();return;
        }
        if(name==='reopen-tab'&&!bridge){const tab=closedTabs.pop();if(tab)command('new-tab').then(()=>command('open',{url:tab.url}));return;}
        if(!bridge&&['zoom-in','zoom-out','zoom-reset'].includes(name)){zoomed=name==='zoom-in';image.style.width=zoomed?`${Math.max(image.naturalWidth,surface.clientWidth*1.5)}px`:'100%';menuSignature='';render();return;}
        if(bridge&&['plugins','print','devtools','find-open'].includes(name)){menu='';renderMenu();layout();}

        if(name==='popout'){bridge.popout();docked=false;return close();}
        if(name==='external'){const url=state.url||state.tabs.find(tab=>tab.id===state.activeId)?.url;if(bridge)return bridge.action('external');if(/^https?:\/\//.test(url||''))window.open(url,'_blank','noopener,noreferrer');return;}
        if(bridge)return bridge.action(name);
        if(name==='upload')return panel.querySelector('[data-local-files]').click();
        if(name==='reload')return command('reload');
        if(name==='stop-and-control')return command('takeover');
        if(name==='return-ai')return command('release');
        if(name==='new-tab'){pageWidth=0;autoFit=true;return command('new-tab');}
        if(name==='back'||name==='forward')return command(name);
        if(name==='send-text')return input('type',{text:textInput.value,replace:controlBox.querySelector('[data-replace]').checked});
        if(name==='remote-up'||name==='remote-down')return input('scroll',{x:.5,y:.5,deltaY:(name==='remote-up'?-1:1)*Math.min(3000,Math.round((displayedFrame?.viewport?.height||900)*.7))});
        if(['remote-tab','remote-enter','remote-backspace'].includes(name))return input('key',{key:{'remote-tab':'Tab','remote-enter':'Enter','remote-backspace':'Backspace'}[name]});
        if(name==='remote-zoom'){zoomed=!zoomed;image.style.width=zoomed?`${Math.max(image.naturalWidth,surface.clientWidth)}px`:'100%';render();}
    }
    function init(){
        toggle=document.getElementById('dcBrowserToggle');const workspace=document.getElementById('dcWorkspacePanel');if(!toggle||!workspace)return;
        panel=document.createElement('aside');panel.className='dc-browser-panel';panel.id='dcBrowserPanel';panel.hidden=true;
        const button=(name)=>`<button type="button" data-browser="${name}">${icon(name)}</button>`;
        panel.innerHTML=`<header class="dc-browser-head"><strong>Dragon 浏览器</strong><div class="dc-browser-tabbar"><div class="dc-browser-tabs" role="tablist"></div>${button('new-tab')}${button('tabs')}</div><div class="dc-browser-window-actions">${button('popout')}${button('external')}${button('close')}</div></header><form class="dc-browser-address"><div class="dc-browser-navigation">${button('back')}${button('forward')}${button('reload')}</div><input autocomplete="off" spellcheck="false" enterkeyhint="go"><button type="submit" class="dc-browser-go" aria-label="Go">↵</button><div class="dc-browser-toolbar-actions">${button('keyboard')}${button('extensions')}${button('downloads')}${button('more')}</div></form><div class="dc-browser-hint" hidden></div><section class="dc-browser-popup" hidden></section><div class="dc-browser-find" hidden><input data-find-input><span data-find-count></span><button type="button" data-find-forward="false">↑</button><button type="button" data-find-forward="true">↓</button><button type="button" data-browser="find-close">×</button></div><div class="dc-browser-control" hidden><label></label><div class="dc-browser-type"><input data-remote-text autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" data-browser="send-text"></button></div><div class="dc-browser-control-options"><label><input type="checkbox" data-replace><span data-label="replace"></span></label><label><input type="checkbox" data-mask><span data-label="mask"></span></label><label><input type="checkbox" data-drag-mode><span data-label="drag"></span></label></div><div class="dc-browser-upload"><button type="button" data-browser="upload"></button><input type="file" data-local-files hidden></div><div class="dc-browser-control-keys"><button type="button" data-browser="remote-up"></button><button type="button" data-browser="remote-down"></button><button type="button" data-browser="remote-tab"></button><button type="button" data-browser="remote-backspace"></button><button type="button" data-browser="remote-enter"></button><button type="button" data-browser="remote-zoom"></button></div></div><div class="dc-browser-surface"><div class="dc-browser-agent-view"><div class="dc-browser-agent-status" role="status"></div><img hidden></div></div>`;
        workspace.after(panel);surface=panel.querySelector('.dc-browser-surface');address=panel.querySelector('.dc-browser-address input');tabsNode=panel.querySelector('.dc-browser-tabs');hint=panel.querySelector('.dc-browser-hint');image=panel.querySelector('.dc-browser-agent-view img');status=panel.querySelector('.dc-browser-agent-status');controlBox=panel.querySelector('.dc-browser-control');textInput=panel.querySelector('[data-remote-text]');
        operatorBanner=document.createElement('div');operatorBanner.className='dc-browser-operator';operatorBanner.hidden=true;operatorBanner.setAttribute('role','status');operatorBanner.innerHTML='<span></span><button type="button" data-browser="stop-and-control"></button>';surface.append(operatorBanner);
        aiPointer=document.createElement('div');aiPointer.className='dc-browser-ai-pointer';aiPointer.hidden=true;aiPointer.innerHTML='<svg width="24" height="28" viewBox="0 0 24 28" aria-hidden="true"><path d="M2 2L20 17L12 18L8 26Z" fill="currentColor" stroke="white" stroke-width="2"/></svg><span>AI</span>';surface.append(aiPointer);
        setInterval(()=>{
            if(bridge||!open)return;renderOperator();
            if(manualToken&&!busy&&!gesture&&!idleRelease&&Date.now()-lastActivity>=5000){idleRelease=true;api('release').then(()=>refresh(true)).catch(()=>{}).finally(()=>{idleRelease=false;});}
        },200);
        panel.querySelector('.dc-browser-agent-view').hidden=Boolean(bridge);
        window.SidebarResize?.bind({panel,cssVar:'--browser-panel-width',storageKey:'dragon_browser_sidebar_width',defaultWidth:480,onManualResize:()=>{autoFit=false;}});
        toggle.addEventListener('click',()=>open?close():show());panel.querySelector('form').addEventListener('submit',event=>{event.preventDefault();navigate();});
        panel.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.browser)action(button.dataset.browser);if(button.dataset.tab){if(bridge)bridge.action('tab-select',button.dataset.tab);else command('select-tab',{tabId:button.dataset.tab});}if(button.dataset.closeTab){const closed=state.tabs.find(tab=>tab.id===button.dataset.closeTab);if(closed&&/^https?:/.test(closed.url))closedTabs.push(closed);closedTabs=closedTabs.slice(-20);if(bridge)bridge.action('tab-close',button.dataset.closeTab);else command('close-tab',{tabId:button.dataset.closeTab});}});
        panel.addEventListener('click',event=>{
            const button=event.target.closest('button');if(!button)return;
            if(button.dataset.download&&bridge)bridge.action('download-action',{id:button.dataset.download,action:button.dataset.downloadAction});
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
        controlBox.addEventListener('keydown',activity);controlBox.addEventListener('pointerdown',activity);
        controlBox.querySelector('[data-mask]').addEventListener('change',event=>{textInput.type=event.target.checked?'password':'text';});textInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();action('send-text');}});
        image.addEventListener('load',()=>{displayedFrame=image._pendingFrame;pageWidth=displayedFrame?.viewport?.width||image.naturalWidth;fit();});image.addEventListener('dragstart',event=>event.preventDefault());
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
            if(intent(event)){operatorBanner.querySelector('button').focus();return;}if(!manualToken||busy||event.ctrlKey||event.metaKey||event.altKey)return;
            if(['Enter','Tab','Backspace','Delete','Escape','ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();input('key',{key:event.key});}
            else if(event.key.length===1){event.preventDefault();input('type',{text:event.key});}
        });
        image.addEventListener('pointercancel',cancelGesture);
        image.addEventListener('lostpointercapture',cancelGesture);
        image.addEventListener('click',event=>{if(!manualToken&&!state.operator?.active&&!busy&&state.available){const point=relative(event);command('takeover').then(()=>input('click',point));return;}if(intent(event))return;if(!manualToken||busy||Date.now()<suppressClick)return;input('click',relative(event));});
        image.addEventListener('dragover',event=>{if(manualToken&&event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
        image.addEventListener('drop',event=>{event.preventDefault();if(manualToken&&event.dataTransfer?.files.length)uploadFiles(event.dataTransfer.files,relative(event));});
        image.addEventListener('wheel',event=>{if(intent(event))return;if(!manualToken||event.ctrlKey||zoomed)return;event.preventDefault();wheelDelta+=event.deltaY;clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{const deltaY=Math.max(-3000,Math.min(3000,Math.round(wheelDelta)));wheelDelta=0;if(!busy)input('scroll',{x:.5,y:.5,deltaY});},120);},{passive:false});
        for(const[name,key]of[['home:hub','hub'],['home:tool-frame','tool']])window.addEventListener(name,event=>{event.detail?.open?suspended.add(key):suspended.delete(key);visibility();});
        window.addEventListener('dragon-claw:sidebar-layout',layout);window.addEventListener('dragon-claw:browser-update',event=>{if(bridge)return;if(event.detail?.tool==='browser_navigate'){autoFit=true;pageWidth=0;}if(innerWidth>860||open)show();});
        window.matchMedia('(max-width: 860px)').addEventListener('change',event=>{if(event.matches)close();});window.addEventListener('resize',()=>{if(autoFit)fit();layout();});window.addEventListener('tools:languagechange',render);
        window.addEventListener('beforeunload',()=>{if(manualToken)api('release',{},true).catch(()=>{});bridge?.bounds(null);bridge?.reading?.(false);});document.addEventListener('visibilitychange',()=>{layout();if(document.hidden){if(gesture?.remote){gesture.ended=true;remotePointer(gesture,'cancel',{});gesture=null;}streamController?.abort();}else if(open){refresh(true);}});
        document.addEventListener('pointerdown',event=>{if(innerWidth<=860&&open&&!panel.contains(event.target)&&!toggle.contains(event.target)&&!event.target.closest('[aria-modal="true"],.app-dialog'))close();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu){menu='';renderMenu();layout();event.preventDefault();return;}if(event.key==='Escape'&&open&&!event.defaultPrevented&&!document.querySelector('[aria-modal="true"]'))close();});
        new ResizeObserver(layout).observe(surface);new MutationObserver(layout).observe(document.body,{attributes:true,childList:true,subtree:true,attributeFilter:['class','hidden','open','style']});
        if(bridge){bridge.onState(value=>{const before=state.tabs.find(tab=>tab.id===state.activeId)?.url,after=value.tabs.find(tab=>tab.id===value.activeId)?.url;if(before!==after){autoFit=true;pageWidth=0;}if(value.panel==='downloads'&&state.panel!=='downloads')menu='downloads';state=value;render();requestAnimationFrame(fit);});bridge.onReveal(()=>{if(innerWidth>860||open)show();});bridge.onFocusUrl(()=>{address.focus();address.select();});bridge.onPoppedOut(()=>{docked=false;close();});bridge.connect().then(value=>{connected=value;docked=value;layout();}).catch(()=>{});}
        render();window.DragonBrowserSidebar={open:show,close,showAgentView:show,isOpen:()=>open};
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
