/* Full-screen viewer for developer traces: the whole text, copy, “AI 总结”, “分析错误原因”, and a floating bar on any
   selected passage to ask the AI about just that part. Answers stack up in the side panel. */
(function(){
    'use strict';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    let root=null,current='';
    async function copy(text,button){
        try{await navigator.clipboard.writeText(text);}catch(_){const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;opacity:0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}
        if(button){const label=button.textContent;button.textContent='✓ 已复制';setTimeout(()=>{button.textContent=label;},1400);}
    }
    function answerCard(title,quote){
        const side=root.querySelector('.air-tv-answers');root.querySelector('.air-tv-side').hidden=false;
        const card=document.createElement('section');card.className='air-tv-answer is-busy';
        card.innerHTML=`<h4>${esc(title)}</h4>${quote?`<blockquote>${esc(quote.length>300?quote.slice(0,300)+'…':quote)}</blockquote>`:''}<div class="air-tv-answer-text"><span class="air-spinner" aria-hidden="true"></span> AI 正在分析…</div>`;
        side.prepend(card);return card;
    }
    async function explain(mode,{selection='',question=''}={}){
        const card=answerCard(mode==='summary'?'AI 总结':mode==='diagnose'?'错误原因分析':'问：'+(question||'这段是什么意思？'),mode==='ask'?selection:'');
        try{
            const {answer}=await API.post('/api/ai-report/debug/explain',{mode,text:current,selection,question});
            card.querySelector('.air-tv-answer-text').innerHTML=esc(answer).replace(/\n/g,'<br>');
            const button=document.createElement('button');button.type='button';button.className='air-tv-mini';button.textContent='⧉ 复制';button.onclick=()=>copy(answer,button);card.append(button);
        }catch(error){card.querySelector('.air-tv-answer-text').textContent='出错了：'+(error.message||error);}
        card.classList.remove('is-busy');
    }
    // A selection inside the text shows a small bar; “AI 对话” turns it into a question box about that passage.
    function selectionBar(){
        const bar=root.querySelector('.air-tv-select'),text=root.querySelector('.air-tv-text');
        const hide=()=>{bar.hidden=true;bar.innerHTML='';};
        text.addEventListener('mouseup',()=>setTimeout(()=>{
            const selection=getSelection(),picked=selection&&!selection.isCollapsed?selection.toString().trim():'';
            if(!picked||!text.contains(selection.anchorNode))return hide();
            const rect=selection.getRangeAt(0).getBoundingClientRect(),box=root.querySelector('.air-tv-box').getBoundingClientRect();
            bar.hidden=false;bar.dataset.text=picked;bar.style.left=Math.max(8,Math.min(box.width-300,rect.left-box.left))+'px';bar.style.top=Math.max(48,rect.top-box.top-44)+'px';
            bar.innerHTML=`<button type="button" data-tv-ask>✦ AI 对话</button><button type="button" data-tv-copy-sel>⧉ 复制</button>`;
        },0));
        bar.addEventListener('click',event=>{
            if(event.target.closest('[data-tv-copy-sel]')){copy(bar.dataset.text,event.target.closest('button'));return;}
            if(event.target.closest('[data-tv-ask]')){bar.innerHTML=`<form class="air-tv-ask"><input type="text" placeholder="针对选中的内容提问，回车发送（不填直接问“这段是什么意思”）" aria-label="问题"><button type="submit">发送</button></form>`;bar.querySelector('input').focus();}
        });
        bar.addEventListener('submit',event=>{event.preventDefault();const question=bar.querySelector('input').value.trim(),picked=bar.dataset.text;hide();explain('ask',{selection:picked,question});});
        text.addEventListener('mousedown',event=>{if(!bar.contains(event.target))hide();});
    }
    function close(){if(!root)return;root.remove();root=null;document.removeEventListener('keydown',onKey,true);}
    const onKey=event=>{if(event.key==='Escape'&&root){event.stopPropagation();if(!root.querySelector('.air-tv-select').hidden){root.querySelector('.air-tv-select').hidden=true;return;}close();}};
    function open({title='调试记录',text=''}={}){
        close();current=String(text||'');
        root=document.createElement('div');root.className='air-tv';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label',title);
        root.innerHTML=`<div class="air-tv-box"><header><strong>${esc(title)}</strong><small>${current.length.toLocaleString()} 字 · 选中任意一段可以直接问 AI</small><span class="air-tv-actions"><button type="button" data-tv-copy>⧉ 复制全部</button><button type="button" data-tv-summary>✦ AI 总结全部内容</button><button type="button" data-tv-diagnose>🩺 分析错误原因</button><button type="button" class="air-tv-close" data-tv-close aria-label="关闭">×</button></span></header>
            <div class="air-tv-body"><pre class="air-tv-text">${esc(current)}</pre><aside class="air-tv-side" hidden><div class="air-tv-answers"></div></aside></div><div class="air-tv-select" hidden></div></div>`;
        document.body.append(root);
        root.addEventListener('click',event=>{
            if(event.target===root||event.target.closest('[data-tv-close]'))return close();
            if(event.target.closest('[data-tv-copy]'))return copy(current,event.target.closest('button'));
            if(event.target.closest('[data-tv-summary]'))return explain('summary');
            if(event.target.closest('[data-tv-diagnose]'))return explain('diagnose');
        });
        document.addEventListener('keydown',onKey,true);selectionBar();
        root.querySelector('[data-tv-close]').focus();
    }
    window.AiReportTraceViewer={open,close};
})();
