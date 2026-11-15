/* Marking mode: click a spot in a cell, write what should change there, and hand that to the AI.
   The mark carries where it was made (the slot and the nearby text), so "this title" or "that bar" needs no
   description. Interactive frames stop taking clicks while marking, so every spot can be marked. */
(function(){
    'use strict';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    function create({root,t,onMark,onChange=()=>{}}){
        let active=false,popover=null,pin=null,count=0;
        const clear=()=>{popover?.remove();popover=null;pin?.remove();pin=null;};
        function set(on){active=!!on;document.documentElement.classList.toggle('air-marking',active);if(!active)clear();onChange(active);}
        // What the mark points at: the slot (named sub-block of a template cell) and a short piece of nearby text.
        function targetOf(node){
            const slot=node.closest('[data-slot]')?.dataset.slot||'';
            const chart=node.closest('.kit-widget-chart,svg,canvas');
            // Only a small, specific element counts as "the text here"; a click on a big container names no text.
            const near=chart?'':String(node.closest('th,td,li,.kit-title,.kit-kpi,p,span,strong,b,small')?.innerText||'').replace(/\s+/g,' ').trim();
            const text=near.length<=60?near:'';
            const title=node.closest('[data-slot]')?.querySelector('.kit-title')?.innerText||node.closest('[data-cell]')?.querySelector('.kit-title')?.innerText||'';
            return {slot,text,kind:chart?'chart':text?'text':'area',title:String(title).trim().slice(0,40)};
        }
        function open(cellId,target,x,y){
            clear();count++;
            pin=document.createElement('span');pin.className='air-mark-pin';pin.textContent=String(count);pin.style.left=x+'px';pin.style.top=y+'px';document.body.append(pin);
            popover=document.createElement('form');popover.className='air-mark-pop';
            const where=[target.slot&&t(`分区 ${target.slot}`,`slot ${target.slot}`),target.kind==='chart'?t('图表','chart'):target.text&&`“${target.text}”`].filter(Boolean).join(' · ');
            popover.innerHTML=`<small>${esc(where||t('这里','Here'))}</small><textarea rows="2" maxlength="600" placeholder="${esc(t('这里要怎么改？例如：标题改成“各运营商回传率”、改成横向条、只显示前 5 名','What should change here?'))}"></textarea><div><button type="button" data-mark-cancel>${t('取消','Cancel')}</button><button type="submit" class="air-primary">${t('交给 AI','Send to AI')}</button></div>`;
            const left=Math.min(x+12,window.scrollX+document.documentElement.clientWidth-300),top=y+14;
            Object.assign(popover.style,{left:Math.max(window.scrollX+8,left)+'px',top:top+'px'});document.body.append(popover);
            const input=popover.querySelector('textarea');input.focus();
            popover.addEventListener('submit',event=>{event.preventDefault();const note=input.value.trim();if(!note)return;const done=pin;popover.remove();popover=null;pin=null;done.classList.add('is-sent');setTimeout(()=>done.remove(),1600);onMark(cellId,{...target,note});});
            popover.addEventListener('click',event=>{if(event.target.closest('[data-mark-cancel]'))clear();});
            input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();popover.requestSubmit();}if(event.key==='Escape')clear();});
        }
        root.addEventListener('click',event=>{
            if(!active)return;
            const cellNode=event.target.closest('[data-cell]');if(!cellNode||event.target.closest('.air-cell-tools,button,textarea,input,select,[data-ask]'))return;
            event.preventDefault();event.stopImmediatePropagation();
            open(cellNode.dataset.cell,targetOf(event.target),event.pageX,event.pageY);
        },true);
        document.addEventListener('keydown',event=>{if(active&&event.key==='Escape'&&!popover)set(false);});
        return {toggle:()=>set(!active),set,active:()=>active};
    }
    window.AiReportMarker={create};
})();
