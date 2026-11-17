/* Marking mode: click spots inside cells to drop persistent numbered pins, edit notes, re-run AI, or delete marks.
   Pins track each cell continuously across zoom, scroll, sidebar resizing, and cell moves. */
(function(){
    'use strict';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

    function create({root,layer=null,t,onMark,onChange=()=>{},onMarksChange=()=>{}}){
        let active=false,visible=true,popover=null,activeId=null,draft=null,seq=0,hint=null;
        let marks=[];
        const pinLayer=document.createElement('div');
        pinLayer.className='air-mark-layer';
        const hostLayer=()=>{
            const target=layer||root;
            if(target&&pinLayer.parentElement!==target){
                if(getComputedStyle(target).position==='static')target.style.position='relative';
                target.append(pinLayer);
            }
            return target;
        };

        const nextNumber=()=>marks.reduce((m,item)=>Math.max(m,Number(item.number)||0),0)+1;
        const makeId=()=>'m'+Date.now().toString(36)+(++seq).toString(36);
        const notifyMarks=()=>{try{onMarksChange(list());}catch(_){}renderHint();};

        function closePopover(){
            popover?.remove();popover=null;
            if(draft&&draft.id===activeId)draft=null;
            activeId=null;
            renderPins();
        }

        function updateHint(){
            if(!active){hint?.remove();hint=null;return;}
            if(!hint){
                hint=document.createElement('div');
                hint.className='air-mark-hint';
                hint.setAttribute('role','status');
                hint.addEventListener('click',event=>{
                    if(event.target.closest('[data-mark-clear-all]')){clearAll();return;}
                    if(event.target.closest('[data-mark-done]'))set(false);
                });
                document.body.append(hint);
            }
            const count=marks.length;
            hint.innerHTML=`<span>${esc(t('标记模式：点击格子添加批注，点编号可修改或删除 · Esc 退出','Marking: click cells to add pins; click a pin to edit or delete · Esc to exit'))}</span>${count?`<button type="button" class="air-mark-hint-btn" data-mark-clear-all>${esc(t(`清空 ${count} 个标记`,`Clear ${count}`))}</button>`:''}<button type="button" class="air-mark-hint-btn is-done" data-mark-done>${esc(t('完成标记','Done'))}</button>`;
        }
        const renderHint=()=>updateHint();

        function positionPopover(pinNode){
            if(!popover||!pinNode||!pinNode.isConnected)return;
            const rect=pinNode.getBoundingClientRect();
            const pw=popover.offsetWidth||296,ph=popover.offsetHeight||164;
            const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
            let left=rect.left+rect.width/2-24;
            left=clamp(left,10,Math.max(10,vw-pw-10));
            let top=rect.bottom+10;
            if(top+ph>vh-12&&rect.top-ph-12>=8)top=rect.top-ph-10;
            else top=clamp(top,10,Math.max(10,vh-ph-12));
            Object.assign(popover.style,{left:Math.round(left)+'px',top:Math.round(top)+'px'});
        }

        function sync(){
            const target=hostLayer();
            if(!target||!pinLayer.isConnected)return;
            pinLayer.hidden=!visible||root.classList.contains('is-preview');
            if(pinLayer.hidden){if(popover)closePopover();return;}
            const layerRect=pinLayer.getBoundingClientRect();
            const all=draft?[...marks,draft]:marks;
            const nodes=new Map([...pinLayer.querySelectorAll('.air-mark-pin')].map(el=>[el.dataset.markId,el]));
            for(const mark of all){
                const el=nodes.get(mark.id);if(!el)continue;
                const cellNode=[...root.querySelectorAll('[data-cell]')].find(n=>n.dataset.cell===mark.cellId);
                if(!cellNode){el.hidden=true;continue;}
                const cr=cellNode.getBoundingClientRect();
                if(cr.width<=0||cr.height<=0){el.hidden=true;continue;}
                el.hidden=false;
                el.style.left=Math.round(cr.left-layerRect.left+clamp(mark.rx,0.02,0.98)*cr.width)+'px';
                el.style.top=Math.round(cr.top-layerRect.top+clamp(mark.ry,0.02,0.98)*cr.height)+'px';
            }
            if(popover&&activeId){
                const activePin=nodes.get(activeId);
                if(activePin&&!activePin.hidden)positionPopover(activePin);
            }
        }

        function renderPins(){
            hostLayer();
            const all=draft?[...marks,draft]:marks;
            pinLayer.replaceChildren();
            for(const mark of all){
                const pin=document.createElement('button');
                pin.type='button';
                pin.className=`air-mark-pin is-${mark===draft?'draft':(mark.status||'saved')}${mark.id===activeId?' is-open':''}`;
                pin.dataset.markId=mark.id;
                const summary=mark.note?`#${mark.number}: ${mark.note}`:t(`新标记 #${mark.number}`,`Draft #${mark.number}`);
                pin.title=summary;
                pin.setAttribute('aria-label',summary);
                const label=document.createElement('span');
                label.textContent=String(mark.number);
                pin.append(label);
                pinLayer.append(pin);
            }
            sync();
        }

        function targetOf(node){
            const slot=node.closest('[data-slot]')?.dataset.slot||'';
            const chart=node.closest('.kit-widget-chart,svg,canvas');
            const near=chart?'':String(node.closest('th,td,li,.kit-title,.kit-kpi,p,span,strong,b,small')?.innerText||'').replace(/\s+/g,' ').trim();
            const text=near.length<=60?near:'';
            const title=node.closest('[data-slot]')?.querySelector('.kit-title')?.innerText||node.closest('[data-cell]')?.querySelector('.kit-title')?.innerText||'';
            return {slot,text,kind:chart?'chart':text?'text':'area',title:String(title).trim().slice(0,40)};
        }

        function openPopover(mark,{isNew=false}={}){
            popover?.remove();popover=null;
            activeId=mark.id;
            renderPins();
            const pinNode=[...pinLayer.querySelectorAll('.air-mark-pin')].find(el=>el.dataset.markId===mark.id);
            popover=document.createElement('form');
            popover.className='air-mark-pop';
            const where=[mark.slot&&t(`分区 ${mark.slot}`,`slot ${mark.slot}`),mark.kind==='chart'?t('图表','chart'):mark.text&&`“${mark.text}”`].filter(Boolean).join(' · ');
            const stateLabel=isNew?t('新标记','New'):mark.status==='sent'?t('已交给 AI','Sent'):t('已暂存','Saved');
            popover.innerHTML=`<div class="air-mark-pop-head"><span class="air-mark-badge">#${mark.number}</span><span class="air-mark-state is-${isNew?'draft':(mark.status||'saved')}">${esc(stateLabel)}</span><small>${esc(where||t('当前位置','Spot'))}</small><button type="button" class="air-mark-close" data-mark-close aria-label="${esc(t('关闭','Close'))}">×</button></div><textarea rows="3" maxlength="600" placeholder="${esc(t('这里要怎么改？例如：标题改成“各运营商回传率”、改成横向条、只显示前 5 名','What should change here?'))}">${esc(mark.note||'')}</textarea><div class="air-mark-pop-actions">${isNew?`<button type="button" data-mark-cancel>${t('取消','Cancel')}</button><button type="button" data-mark-save>${t('暂存','Save pin')}</button>`:`<button type="button" class="air-mark-del" data-mark-delete>${t('删除','Delete')}</button><button type="button" data-mark-save>${t('保存','Save')}</button>`}<button type="submit" class="air-primary">${isNew?t('交给 AI','Send to AI'):t('重新交给 AI','Re-run AI')}</button></div>`;
            document.body.append(popover);
            positionPopover(pinNode);
            const input=popover.querySelector('textarea');
            input.focus();
            input.setSelectionRange(input.value.length,input.value.length);

            const commit=(sendToAi)=>{
                const note=input.value.trim();
                if(!note){input.focus();return;}
                const entry={...mark,note,status:sendToAi?'sent':(mark.status==='sent'&&!isNew?'sent':'saved'),updatedAt:Date.now()};
                if(isNew){draft=null;marks.push(entry);}
                else{marks=marks.map(item=>item.id===entry.id?entry:item);}
                closePopover();
                renderPins();
                notifyMarks();
                if(sendToAi)onMark(entry.cellId,{...entry});
            };

            popover.addEventListener('submit',event=>{event.preventDefault();commit(true);});
            popover.addEventListener('click',event=>{
                if(event.target.closest('[data-mark-close]'))return closePopover();
                if(event.target.closest('[data-mark-cancel]')){draft=null;return closePopover();}
                if(event.target.closest('[data-mark-save]'))return commit(false);
                if(event.target.closest('[data-mark-delete]')){
                    marks=marks.filter(item=>item.id!==mark.id);
                    draft=null;
                    closePopover();
                    renderPins();
                    notifyMarks();
                }
            });
            input.addEventListener('keydown',event=>{
                if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();popover.requestSubmit();}
                if(event.key==='Escape'){event.stopPropagation();closePopover();}
            });
        }

        pinLayer.addEventListener('click',event=>{
            const pin=event.target.closest('.air-mark-pin');if(!pin)return;
            event.preventDefault();event.stopPropagation();
            const found=draft?.id===pin.dataset.markId?draft:marks.find(item=>item.id===pin.dataset.markId);
            if(!found)return;
            if(activeId===found.id&&popover){closePopover();return;}
            openPopover(found,{isNew:found===draft});
        });

        root.addEventListener('click',event=>{
            if(!active)return;
            const cellNode=event.target.closest('[data-cell]');
            if(!cellNode||event.target.closest('.air-cell-tools,.bi-grip,.bi-handle,button,textarea,input,select,[data-ask],.air-mark-pin'))return;
            event.preventDefault();event.stopImmediatePropagation();
            const rect=cellNode.getBoundingClientRect();
            const rx=clamp((event.clientX-rect.left)/Math.max(1,rect.width),0.02,0.98);
            const ry=clamp((event.clientY-rect.top)/Math.max(1,rect.height),0.02,0.98);
            const target=targetOf(event.target);
            draft={id:makeId(),number:nextNumber(),cellId:cellNode.dataset.cell,rx,ry,...target,note:'',status:'draft'};
            openPopover(draft,{isNew:true});
        },true);

        const outsideClose=event=>{
            if(!popover)return;
            if(popover.contains(event.target)||event.target.closest('.air-mark-pin'))return;
            if(active&&event.target.closest('[data-cell]'))return;
            closePopover();
        };
        document.addEventListener('pointerdown',outsideClose);
        document.addEventListener('keydown',event=>{
            if(event.key!=='Escape')return;
            if(popover){closePopover();return;}
            if(active)set(false);
        });
        window.addEventListener('resize',sync,{passive:true});
        let syncRaf=0;
        const scheduleSync=()=>{if(!syncRaf)syncRaf=requestAnimationFrame(()=>{syncRaf=0;sync();});};
        if(typeof MutationObserver==='function'&&root){
            new MutationObserver(scheduleSync).observe(root,{childList:true,attributes:true,attributeFilter:['class']});
        }

        function set(on){
            active=!!on;
            document.documentElement.classList.toggle('air-marking',active);
            if(!active){draft=null;closePopover();}
            renderHint();
            onChange(active);
        }

        function list(){return marks.map(item=>({...item}));}
        function load(next=[],{silent=false}={}){
            draft=null;closePopover();
            marks=Array.isArray(next)?next.filter(item=>item&&item.cellId).map((item,idx)=>({
                id:String(item.id||makeId()),
                number:Number(item.number)>0?Math.round(Number(item.number)):idx+1,
                cellId:String(item.cellId),
                rx:clamp(Number(item.rx)??0.5,0.02,0.98),
                ry:clamp(Number(item.ry)??0.5,0.02,0.98),
                slot:String(item.slot||''),
                text:String(item.text||''),
                kind:String(item.kind||'area'),
                title:String(item.title||''),
                note:String(item.note||''),
                status:item.status==='sent'?'sent':'saved',
                updatedAt:Number(item.updatedAt)||Date.now()
            })):[];
            renderPins();
            if(!silent)notifyMarks(); else renderHint();
        }
        function remove(id){
            const before=marks.length;
            marks=marks.filter(item=>item.id!==id);
            if(activeId===id)closePopover();
            if(marks.length!==before){renderPins();notifyMarks();}
        }
        function clearAll({silent=false}={}){
            draft=null;marks=[];closePopover();renderPins();
            if(!silent)notifyMarks(); else renderHint();
        }
        function setVisible(on){visible=!!on;sync();}

        renderPins();
        return {toggle:()=>set(!active),set,active:()=>active,list,load,remove,clearAll,sync,setVisible};
    }
    window.AiReportMarker={create};
})();
