/* Focus editing changes only the viewport. The original cell and iframe stay in place in the DOM. */
(function(){
    'use strict';
    function create({root,pane,chat,select,t}){
        let active=null,backdrop=null,animation=null,phase=0;
        const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
        function target(){
            const box=pane.getBoundingClientRect(),panel=chat.getBoundingClientRect();
            const top=Math.max(16,box.top+20),left=Math.max(16,box.left+20);
            if(innerWidth<=700){const bottom=Math.min(innerHeight-16,panel.top-12);return {left:12,top,width:innerWidth-24,height:Math.max(140,bottom-top)};}
            const right=Math.min(innerWidth-20,panel.left-20);
            const width=Math.max(160,Math.min(940,right-left));
            // Both columns share the chat panel's actual border edges, including viewport/chrome changes.
            return {left:left+Math.max(0,(right-left-width)/2),top:panel.top,width,height:Math.max(1,panel.height)};
        }
        function position(cell,rect){Object.assign(cell.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',minHeight:'0',margin:'0',zIndex:'102',transformOrigin:'0 0'});}
        function transition(cell,from,to,closing=false){
            animation?.cancel();
            if(reduced())return Promise.resolve();
            const transform=`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`;
            animation=cell.animate(closing?[{transform:'none'},{transform}]:[{transform},{transform:'none'}],{duration:280,easing:'cubic-bezier(.2,.8,.2,1)'});
            return animation.finished.catch(()=>{});
        }
        function fitContent(){
            if(!active?.body)return;
            const {cell,body,source}=active,style=getComputedStyle(cell);
            const left=parseFloat(style.paddingLeft)||0,right=parseFloat(style.paddingRight)||0,top=parseFloat(style.paddingTop)||0,bottom=parseFloat(style.paddingBottom)||0;
            const width=Math.max(1,cell.clientWidth-left-right),height=Math.max(1,cell.clientHeight-top-bottom),scale=Math.min(width/source.width,height/source.height);
            Object.assign(body.style,{position:'absolute',boxSizing:'border-box',width:source.width+'px',height:source.height+'px',minHeight:'0',flex:'none',left:(left+(width-source.width*scale)/2)+'px',top:(top+(height-source.height*scale)/2)+'px',transformOrigin:'0 0',transform:`scale(${scale})`});
            AiReportInteractive.setEditorScale(active.id,scale);
        }
        function update(){if(active?.cell&&!active.closing){position(active.cell,target());fitContent();}}
        const resize=new ResizeObserver(update);resize.observe(pane);resize.observe(chat);addEventListener('resize',update);
        function paintTools(data){
            if(!active?.tools)return;const {picker,path,status,width,height,apply}=active.tools;
            picker.replaceChildren();const auto=document.createElement('option');auto.value='';auto.textContent=t('自动选择 · 悬停预选','Auto select · hover to preview');picker.append(auto);
            for(const item of data?.items||[]){const option=document.createElement('option');option.value=item.id;option.textContent='　'.repeat(Math.max(0,item.depth-1))+item.depth+' · '+item.name;picker.append(option);}
            picker.value=data?.selected||'';path.replaceChildren();
            width.disabled=height.disabled=apply.disabled=!data?.size;
            if(active.tools.selection!==data?.selected){active.tools.selection=data?.selected;active.tools.dirtySize=false;}
            if(!active.tools.dirtySize){if(document.activeElement!==width)width.value=data?.size?.width||'';if(document.activeElement!==height)height.value=data?.size?.height||'';}
            for(const item of data?.path||[]){const button=document.createElement('button');button.type='button';button.textContent=item.depth+' · '+item.name;button.title=item.name;button.addEventListener('click',()=>AiReportInteractive.selectElement(active.id,item.id));path.append(button);}
            status.textContent=data?.path?.length?t('拖动角点缩放；表格边界可调列宽、行高','Drag a corner to resize; table edges adjust columns and rows'):t('悬停查看目标，点击选中；可从列表选择任意层级','Hover to preview, click to select; choose any level from the list');
        }
        root.addEventListener('air-element-selection',event=>{if(active?.id===event.detail?.cellId)paintTools(event.detail);});
        function decorate(){
            if(!active)return;const cell=root.querySelector(`[data-cell="${CSS.escape(active.id)}"]`);if(!cell){close({animate:false});return;}
            if(active.cell===cell)return;
            const from=cell.getBoundingClientRect(),placeholder=document.createElement('div');placeholder.className='air-focus-placeholder';placeholder.style.cssText=`grid-column:${cell.style.gridColumn};height:${from.height}px`;cell.before(placeholder);
            active.cell=cell;active.placeholder=placeholder;active.style=cell.getAttribute('style');active.fit=cell.classList.contains('is-fit');active.role=cell.getAttribute('role');
            active.body=cell.querySelector(':scope>.air-cell-body');active.bodyStyle=active.body?.getAttribute('style');
            if(!active.source&&active.body)active.source={width:Math.max(1,active.body.offsetWidth),height:Math.max(1,active.body.offsetHeight)};
            cell.classList.add('air-focus-cell','is-fit');cell.setAttribute('role','dialog');cell.setAttribute('aria-label',t('放大编辑格子','Enlarged cell editor'));
            const tools=document.createElement('div');tools.className='air-element-tools';
            const picker=document.createElement('select');picker.setAttribute('aria-label',t('选择组件层级','Select component layer'));picker.addEventListener('change',()=>AiReportInteractive.selectElement(active.id,picker.value));
            const path=document.createElement('nav');path.setAttribute('aria-label',t('当前组件层级路径','Current component path'));const status=document.createElement('small');
            const sizes=document.createElement('div');sizes.className='air-element-sizes';const fields=['宽','高'].map((label,index)=>{const wrapper=document.createElement('label');wrapper.textContent=t(label,index?'H':'W');const input=document.createElement('input');input.type='number';input.min='1';input.step='1';input.setAttribute('aria-label',t(index?'组件高度':'组件宽度',index?'Component height':'Component width'));wrapper.append(input);sizes.append(wrapper);return input;});
            const apply=document.createElement('button');apply.type='button';apply.textContent=t('设置尺寸','Set size');const setSize=()=>{AiReportInteractive.resizeElement(active.id,Number(fields[0].value),Number(fields[1].value));active.tools.dirtySize=false;};apply.addEventListener('click',setSize);for(const field of fields){field.addEventListener('input',()=>{active.tools.dirtySize=true;});field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();setSize();}});}sizes.append(apply);
            tools.append(picker,path,sizes,status);cell.append(tools);active.tools={root:tools,picker,path,status,width:fields[0],height:fields[1],apply};
            AiReportInteractive.setPrecision(active.id,true);paintTools(AiReportInteractive.selection(active.id));
            const button=cell.querySelector('[data-cell-focus]');if(button){active.icon=button.innerHTML;button.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 9h6V3M15 3v6h6M21 15h-6v6M9 21v-6H3"/></svg>';button.setAttribute('aria-label',t('退出放大','Exit enlarged view'));button.title=t('退出放大（Esc）','Exit enlarged view (Esc)');button.setAttribute('aria-expanded','true');}
            position(cell,target());fitContent();return from;
        }
        async function open(id){
            if(active?.id===id)return;
            if(active)await close({animate:false});
            const cell=root.querySelector(`[data-cell="${CSS.escape(id)}"]`);if(!cell)return;
            const from=cell.getBoundingClientRect();select(id);
            active={id,cell:null,closing:false};phase++;
            document.body.classList.add('air-focus-open');
            backdrop=document.createElement('div');backdrop.className='air-focus-backdrop';backdrop.setAttribute('aria-hidden','true');backdrop.addEventListener('click',()=>close());document.body.append(backdrop);
            decorate();const current=active,token=phase;
            current.cell.classList.add('is-focus-animating');await transition(current.cell,from,target());
            if(active===current&&phase===token){current.cell.classList.remove('is-focus-animating');current.cell.querySelector('[data-cell-focus]')?.focus({preventScroll:true});}
        }
        function restore(current){
            const cell=current.cell;if(!cell)return;
            current.tools?.root.remove();current.tools=null;AiReportInteractive.setPrecision(current.id,false);AiReportInteractive.setEditorScale(current.id,1);
            cell.setAttribute('style',current.style||'');cell.classList.remove('air-focus-cell','is-focus-animating');if(!current.fit)cell.classList.remove('is-fit');
            if(current.body){if(current.bodyStyle===null)current.body.removeAttribute('style');else current.body.setAttribute('style',current.bodyStyle||'');}
            if(current.role===null)cell.removeAttribute('role');else cell.setAttribute('role',current.role);cell.removeAttribute('aria-label');
            const button=cell.querySelector('[data-cell-focus]');if(button){if(current.icon)button.innerHTML=current.icon;button.setAttribute('aria-label',t('放大编辑','Enlarge cell'));button.title=t('放大编辑','Enlarge cell');button.setAttribute('aria-expanded','false');}
            current.placeholder?.remove();
        }
        async function close({animate=true}={}){
            if(!active)return;const current=active,token=++phase;current.closing=true;
            animation?.cancel();if(animate)backdrop?.classList.add('is-closing');
            if(animate&&current.cell?.isConnected&&current.placeholder?.isConnected){
                const from=current.placeholder.getBoundingClientRect(),to=current.cell.getBoundingClientRect();current.cell.classList.add('is-focus-animating');await transition(current.cell,from,to,true);
            }
            if(phase!==token)return;
            restore(current);active=null;backdrop?.remove();backdrop=null;document.body.classList.remove('air-focus-open');
        }
        function beforeRender(){if(!active)return;animation?.cancel();restore(active);active.cell=null;active.placeholder=null;}
        function sync(){if(!active)return;if(active.closing){close({animate:false});return;}decorate();}
        document.addEventListener('keydown',event=>{if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}},true);
        addEventListener('beforeprint',()=>close({animate:false}));
        root.addEventListener('air-cell-escape',()=>{if(active)close();});
        document.addEventListener('focusin',event=>{if(active&&!active.closing&&!active.cell?.contains(event.target)&&!chat.contains(event.target))active.cell?.querySelector('[data-cell-focus]')?.focus({preventScroll:true});});
        return {open,close,beforeRender,sync,get id(){return active?.id||null;}};
    }
    window.AiReportFocus={create};
})();
