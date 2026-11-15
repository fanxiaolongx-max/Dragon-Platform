/* AI BI: talk to get a board (canvas size and cells), then drag, resize, mark and tune without AI.
   Each cell is an AI report cell — prompt → recipe (compute + template view) → output — placed on a free canvas.
   The AI only plans the board and compiles changed cells; moving, resizing and display settings rerun locally. */
(function(){
    'use strict';
    const B=window.AiBiModel,T=window.AiReportTemplates;
    const $=selector=>document.querySelector(selector);
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const lang=()=>window.ToolsI18n?.getLanguage?.()==='en-US'?'en':'zh';
    const t=(zh,en)=>lang()==='en'?en:zh;
    const BOARD='bi-board';
    const previousMonth=()=>{const date=new Date();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);};
    const state={board:null,boards:[],selected:null,busy:new Map(),planning:false,saved:'',undo:[],zoom:'fit',focus:null,presenting:false};
    const dataCache=new Map();
    const fresh=new Set(); // cells whose content just landed: they fade in once
    const canvasNode=$('#biCanvas'),scaler=$('#biScaler'),stage=$('#biStage'),side=$('#biSide');

    // ── State helpers ─────────────────────────────────────────────────────────────────────────────────────────
    const snapshot=()=>JSON.stringify(state.board);
    const dirty=()=>!!state.board&&snapshot()!==state.saved;
    function checkpoint(){state.undo.push(snapshot());if(state.undo.length>50)state.undo.shift();}
    function undo(){const previous=state.undo.pop();if(!previous)return status(t('没有可撤销的操作','Nothing to undo'));state.board=JSON.parse(previous);render();status(t('已撤销','Undone'));}
    const item=id=>state.board?.items.find(entry=>entry.id===id)||null;
    let statusTimer=0;
    function status(message){const node=$('#biStatus');node.textContent=message||(dirty()?t('未保存','Unsaved'):'');node.classList.toggle('is-dirty',!message&&dirty());$('[data-bi=save]').disabled=!dirty();clearTimeout(statusTimer);if(message)statusTimer=setTimeout(()=>status(''),3200);}
    const month=()=>state.board?.month||previousMonth();
    const palette=()=>window.AiReportWidgets.paletteOf({palette:state.board?.palette||[]});
    const viewOf=entry=>entry?.recipe?T.viewFromRender(entry.recipe.render):null;

    // ── Running a cell: data (cached per month and sources) → sandbox; template views are fitted to the cell size ──
    async function inputFor(entry){
        const key=JSON.stringify([month(),entry.recipe.sources]);
        if(!dataCache.has(key))dataCache.set(key,window.AiReportTrace.post(entry.id,t('读取数据','Read data'),'/api/ai-report/run-data',{month:month(),recipe:entry.recipe}).catch(error=>{dataCache.delete(key);throw error;}));
        const data=await dataCache.get(key);
        return {...JSON.parse(JSON.stringify(data.input||{})),$month:month()};
    }
    async function runItem(entry){
        const view=viewOf(entry),zoom=B.scaleOf(entry,state.board.canvas),render=view?T.renderSource(B.fitView(view,{w:entry.w/zoom,h:entry.h/zoom},T)):entry.recipe.render;
        const input=await inputFor(entry);
        const {html,widgets}=await window.AiReportSandbox.run({compute:entry.recipe.compute,render,input,summary:false}).catch(error=>{const hint=T.dataHint(input);throw new Error(hint?`${error.message}\n${hint}`:error.message);});
        entry.output={html:window.AiReportSanitize.clean(html),widgets:window.AiReportWidgets.cleanSpecs(widgets),month:month(),error:'',generatedAt:new Date().toISOString()};
        fresh.add(entry.id);
    }
    // Compiling asks the AI for a recipe (template first); a failed run goes back once with the error.
    async function compileItem(entry){
        // A rebuild after a failed run starts from that error, so the AI fixes it instead of repeating it.
        let error=entry.recipe&&entry.prompt===entry.recipePrompt?entry.output?.error||'':'';
        for(let attempt=0;attempt<3;attempt++){
            const zoom=B.scaleOf(entry,state.board.canvas);
            const prompt=`${entry.prompt}\n【尺寸约束】格子宽 ${Math.round(entry.w/zoom)}px、高 ${Math.round(entry.h/zoom)}px，全部内容必须在这个范围内完整显示，不出现滚动条。`;
            const reply=await window.AiReportTrace.post(entry.id,t('生成格子','Build cell'),'/api/ai-report/cell/compile',{month:month(),interactive:false,prompt,recipe:entry.recipe,previousPrompt:entry.recipePrompt||'',error});
            if(reply.type==='ask')throw Object.assign(new Error(reply.question),{ask:true});
            entry.recipe=reply.recipe;
            try{await runItem(entry);entry.recipePrompt=entry.prompt;return;}catch(problem){error=problem.message||String(problem);}
        }
        throw new Error(error);
    }
    async function work(entry,label,job){
        if(state.busy.has(entry.id))return;
        state.busy.set(entry.id,label);paint();
        try{await job();}
        catch(error){entry.output={...(entry.output||{html:'',widgets:[]}),error:error.message||String(error)};}
        finally{state.busy.delete(entry.id);render();}
    }
    const build=entry=>work(entry,t('AI 正在生成…','Building…'),()=>compileItem(entry));
    const rerun=entry=>entry.recipe?work(entry,t('正在计算…','Computing…'),()=>runItem(entry)):Promise.resolve();
    // Two at a time: each cell has its own sandbox run.
    async function queue(list,job){const pending=[...list];const next=async()=>{while(pending.length)await job(pending.shift());};await Promise.all([next(),next()]);}

    // ── Canvas ───────────────────────────────────────────────────────────────────────────────────────────────
    function scale(){
        const size=state.board.canvas;
        if(state.presenting)return Math.min(window.innerWidth/size.width,window.innerHeight/size.height);
        if(state.zoom!=='fit')return Number(state.zoom)||1;
        return Math.max(0.1,Math.min(1,(stage.clientWidth-48)/size.width,(stage.clientHeight-48)/size.height));
    }
    function layoutCanvas(){
        if(!state.board)return;
        const size=state.board.canvas,k=scale();
        Object.assign(canvasNode.style,{width:size.width+'px',height:size.height+'px',transform:`scale(${k})`,background:size.background});
        canvasNode.style.backgroundImage=state.presenting?'none':'';
        Object.assign(scaler.style,{width:size.width*k+'px',height:size.height*k+'px'});
        palette().forEach((color,index)=>canvasNode.style.setProperty('--kit-c'+index,color));
        canvasNode.style.setProperty('--air-accent',palette()[0]);
    }
    function itemHtml(entry){
        const busy=state.busy.get(entry.id),error=entry.output?.error,selected=state.selected===entry.id;
        const stateHtml=busy?`<div class="bi-item-state is-busy"><span class="bi-spin"></span>${esc(busy)}</div>`
            :error?`<div class="bi-item-state is-error"><strong>${t('这个格子没有生成成功','This cell failed')}</strong><span>${esc(error.slice(0,240))}</span><button type="button" data-item-build="${esc(entry.id)}">${t('重新生成','Rebuild')}</button></div>`
            :!entry.output?.html?`<div class="bi-item-state is-idle">${entry.prompt?`<span>${esc(entry.prompt.slice(0,120))}</span><button type="button" data-item-build="${esc(entry.id)}">${t('生成','Build')}</button>`:`<span>${t('选中后在右边写下这个格子要展示什么','Select and describe what this cell shows')}</span>`}</div>`:'';
        return `<div class="bi-item${selected?' is-selected':''}${entry.frame===false?' is-frameless':''}${entry.y<28?' is-top':''}${fresh.has(entry.id)&&!busy&&!error?' is-fresh':''}" data-cell="${esc(entry.id)}" style="left:${entry.x}px;top:${entry.y}px;width:${entry.w}px;height:${entry.h}px">
            <div class="bi-item-body air-output" data-zoom="${B.scaleOf(entry,state.board.canvas)}" style="zoom:${B.scaleOf(entry,state.board.canvas)}">${entry.output?.html&&!error?entry.output.html:''}</div>${stateHtml}
            <div class="bi-grip" data-grip title="${esc(t('拖动移动','Drag to move'))}">⠿ ${esc(entry.title||t('格子','Cell'))}</div><span class="bi-handle" data-resize title="${esc(t('拖动调整大小','Drag to resize'))}"></span></div>`;
    }
    function paintCanvas(){
        if(!state.board)return;
        layoutCanvas();
        canvasNode.innerHTML=state.board.items.map(itemHtml).join('')+(state.board.items.length?'':`<div class="bi-empty"><span class="bi-empty-icon" aria-hidden="true">🧩</span>${t('说一句话，就有一块看板','One sentence, one board')}<small>${t('在右边说说想看什么，或点一个例子；也可以双击画布自己加格子','Describe it on the right, pick an example, or double-click to add a cell')}</small><div class="bi-empty-picks">${EXAMPLES().slice(0,3).map(text=>`<button type="button" data-choice="${esc(text)}">${esc(text.split('：')[0])}</button>`).join('')}</div></div>`);
        fresh.clear();
        fitBodies(canvasNode);
        window.AiReportWidgets.hydrate(canvasNode,(cellId,widgetId)=>item(cellId)?.output?.widgets?.find(widget=>widget.id===widgetId),{palette:palette(),interactive:{editing:false,lang:lang()}});
    }
    // Content taller than its cell is scaled down to fit (never below 60% of the cell's size), so nothing is cut off.
    function fitBodies(root){
        for(const body of root.querySelectorAll('.bi-item-body')){
            const base=Number(body.dataset.zoom)||1;body.style.zoom=base;
            if(!body.firstElementChild)continue;
            const over=body.scrollHeight/Math.max(1,body.clientHeight);
            if(over>1.02)body.style.zoom=String(Math.max(base*0.6,base/over*0.98).toFixed(3));
        }
    }
    function paint(){paintCanvas();paintSide();toolbar();}
    const render=paint;

    // Moving and resizing: snapped to the grid, kept on the canvas; template cells redraw at the new size.
    let drag=null;
    canvasNode.addEventListener('pointerdown',event=>{
        if(state.presenting||marker?.active())return;
        const node=event.target.closest('[data-cell]');if(!node)return;
        // Buttons in a cell (rebuild…) act on click; selecting first would redraw the cell and swallow that click.
        if(event.target.closest('[data-item-build]'))return;
        const entry=item(node.dataset.cell),grip=event.target.closest('[data-grip]'),resize=event.target.closest('[data-resize]');
        if(state.selected!==entry.id){state.selected=entry.id;state.focus=entry.id;paint();}
        if(!grip&&!resize)return;
        event.preventDefault();
        drag={id:entry.id,mode:resize?'resize':'move',x:event.clientX,y:event.clientY,start:{x:entry.x,y:entry.y,w:entry.w,h:entry.h},k:scale(),before:snapshot()};
        node.classList.add('is-dragging');canvasNode.setPointerCapture(event.pointerId);
    });
    canvasNode.addEventListener('pointermove',event=>{
        if(!drag)return;
        const entry=item(drag.id),size=state.board.canvas,dx=(event.clientX-drag.x)/drag.k,dy=(event.clientY-drag.y)/drag.k;
        if(drag.mode==='move'){entry.x=Math.max(0,Math.min(size.width-entry.w,B.snap(drag.start.x+dx)));entry.y=Math.max(0,Math.min(size.height-entry.h,B.snap(drag.start.y+dy)));}
        else{entry.w=Math.max(160,Math.min(size.width-entry.x,B.snap(drag.start.w+dx)));entry.h=Math.max(100,Math.min(size.height-entry.y,B.snap(drag.start.h+dy)));}
        const node=canvasNode.querySelector(`[data-cell="${CSS.escape(entry.id)}"]`);Object.assign(node.style,{left:entry.x+'px',top:entry.y+'px',width:entry.w+'px',height:entry.h+'px'});
    });
    canvasNode.addEventListener('pointerup',()=>{
        if(!drag)return;const current=drag;drag=null;const entry=item(current.id);
        canvasNode.querySelector(`[data-cell="${CSS.escape(current.id)}"]`)?.classList.remove('is-dragging');
        if(entry.x===current.start.x&&entry.y===current.start.y&&entry.w===current.start.w&&entry.h===current.start.h)return;
        state.undo.push(current.before);
        if(current.mode==='resize'&&entry.recipe&&viewOf(entry))rerun(entry);else paint();
    });
    canvasNode.addEventListener('dblclick',event=>{
        if(state.presenting||event.target.closest('[data-cell],.bi-empty-picks'))return;
        const box=canvasNode.getBoundingClientRect(),k=scale(),size=state.board.canvas;
        checkpoint();
        const entry=B.item({x:B.snap((event.clientX-box.left)/k-240),y:B.snap((event.clientY-box.top)/k-160),w:480,h:320},size);
        state.board.items.push(entry);state.selected=entry.id;state.focus=entry.id;paint();side.querySelector('[data-item-prompt]')?.focus();
    });
    canvasNode.addEventListener('click',event=>{
        const pick=event.target.closest('.bi-empty [data-choice]');if(pick)return send(pick.dataset.choice);
        const button=event.target.closest('[data-item-build]');if(button){const entry=item(button.dataset.itemBuild);if(entry?.prompt){state.selected=entry.id;state.focus=entry.id;build(entry);}return;}
        if(!event.target.closest('[data-cell]')&&state.selected&&!drag){state.selected=null;state.focus=null;paint();}
    });

    // Marking: template cells get new display settings straight away; anything else goes to the board conversation.
    const marker=window.AiReportMarker?.create({root:canvasNode,t,onMark:(id,mark)=>markItem(id,mark),onChange:on=>{const button=$('[data-bi=mark]');button.classList.toggle('is-active',on);button.textContent=on?t('完成标记','Done marking'):t('📍 标记','📍 Mark');}});
    async function markItem(id,mark){
        const entry=item(id);if(!entry)return;state.selected=id;state.focus=id;
        const where=[mark.slot&&t(`分区 ${mark.slot}`,`slot ${mark.slot}`),mark.kind==='chart'?t('图表','chart'):mark.text&&`“${mark.text}”`].filter(Boolean).join(' · ');
        const text=`📍 ${entry.title||t('格子','Cell')}${where?`（${where}）`:''}：${mark.note}`;
        const view=viewOf(entry),free=!view&&entry.recipe?T.freeParams(entry.recipe.render):null;
        if(!view&&!free)return send(text);
        state.board.chat.push({role:'user',text});
        await work(entry,t('正在按标记调整…','Adjusting…'),async()=>{
            const reply=await window.AiReportTrace.post(id,t('标记调整','Adjust from mark'),'/api/ai-report/cell/adjust',{...(view?{view}:{params:free.defs}),prompt:entry.prompt,note:mark.note,target:{slot:mark.slot,text:mark.text,kind:mark.kind,title:mark.title}});
            let change=null;
            if(reply.type==='view'&&reply.view&&view)change={render:T.renderSource(reply.view),prompt:T.withDescription(entry.prompt,reply.view)};
            else if(reply.type==='params'&&reply.values&&free){const code=T.setFreeParams(entry.recipe.render,reply.values);change={render:code,prompt:T.withFreeDescription(entry.prompt,T.freeParams(code).defs)};}
            if(change){checkpoint();applyChange(entry,change,false);state.board.chat.push({role:'ai',text:reply.reply||t('已按标记调整。','Adjusted.')});await runItem(entry);}
            else{state.board.chat.pop();window.setTimeout(()=>send(text),0);}
        });
    }
    function applyChange(entry,change,run=true){
        const synced=entry.recipePrompt===entry.prompt;
        entry.recipe={...entry.recipe,render:change.render};entry.prompt=change.prompt;if(synced)entry.recipePrompt=entry.prompt;
        if(run)rerun(entry);
    }
    // A cell whose code has no settings yet: one AI step pulls its display values into kit.params; nothing else changes.
    const extracting=new Set();
    async function extractItem(entry){
        if(extracting.has(entry.id))return;extracting.add(entry.id);paintSide();
        const before=entry.recipe;
        await work(entry,t('正在整理可调设置…','Making settings…'),async()=>{
            const reply=await window.AiReportTrace.post(entry.id,t('整理可调设置','Make settings'),'/api/ai-report/cell/params',{render:entry.recipe.render,prompt:entry.prompt});
            if(!reply.render||!T.freeParams(reply.render))throw new Error(t('没能整理出可调设置，可以在对话里直接说要改什么','No settings found; describe the change in the conversation'));
            checkpoint();entry.recipe={...entry.recipe,render:reply.render};
            try{await runItem(entry);}catch(error){entry.recipe=before;throw error;}
            const synced=entry.recipePrompt===entry.prompt;entry.prompt=T.withFreeDescription(entry.prompt,T.freeParams(reply.render).defs);if(synced)entry.recipePrompt=entry.prompt;
        });
        extracting.delete(entry.id);paintSide();
    }

    // ── Side panel: the selected cell (prompt, display settings) above the board conversation ───────────────────
    function itemPanel(entry){
        const busy=state.busy.has(entry.id),changed=entry.prompt&&entry.prompt!==entry.recipePrompt;
        return `<div class="bi-side-section bi-item-panel">
            <h3>${t('选中的格子','Selected cell')}<span class="bi-pos">${entry.x}, ${entry.y} · ${entry.w}×${entry.h}</span></h3>
            <label>${t('名称（只在编辑时显示）','Name (editor only)')}<input data-item-title value="${esc(entry.title)}" maxlength="80"></label>
            <label>${t('格子提示词：这个格子展示什么','Prompt: what this cell shows')}<textarea data-item-prompt rows="4" ${busy?'disabled':''}>${esc(entry.prompt)}</textarea></label>
            <div class="bi-row"><button type="button" class="bi-primary" data-item-action="build" ${busy||!entry.prompt?'disabled':''}>${entry.recipe?(changed?t('按提示词重新生成','Rebuild from prompt'):t('重新生成','Rebuild')):t('生成','Build')}</button>
                <button type="button" data-item-action="frame">${entry.frame===false?t('显示卡片底','Show card'):t('去掉卡片底','No card')}</button>
                <button type="button" data-item-action="duplicate">${t('复制','Duplicate')}</button><button type="button" data-item-action="delete" class="bi-danger">${t('删除','Delete')}</button></div>
            ${entry.recipe?`<h3>${t('展示设置（不用 AI，立即重画）','Display settings (no AI)')}</h3><div class="bi-view">${window.AiReportParamPanel.html({recipe:entry.recipe,scale:entry.scale||null,autoScale:B.autoScale(state.board.canvas),t,lang:lang(),busy,skip:['height'],extracting:extracting.has(entry.id)})}</div>`:''}
        </div>`;
    }
    const EXAMPLES=()=>[
        t('做一个 16:9 的运维质量看板：顶部核心指标，中间近 6 个月趋势和各运营商达标对比，底部未达标明细','A 16:9 operations dashboard: KPIs on top, 6-month trends and per-operator targets, failing items below'),
        t('做一页 A4 竖向的月度汇报：标题、结论、关键指标、问题清单','An A4 portrait monthly summary: title, conclusion, key metrics, issues'),
        t('做一个 32:9 的超宽大屏，突出告警和故障分布','A 32:9 video wall highlighting alarms and faults'),
        t('现在有哪些数据可以用？','What data is available?'),
    ];
    function chatHtml(){
        const log=state.board.chat.map((entry,index)=>{
            const choices=entry.choices?.length&&index===state.board.chat.length-1?`<div class="bi-choices">${entry.choices.map(choice=>`<button type="button" data-choice="${esc(choice)}">${esc(choice)}</button>`).join('')}</div>`:'';
            return `<div class="bi-msg is-${entry.kind==='note'?'note':entry.role}${index>=shownMessages?' is-new':''}">${esc(entry.text)}${choices}</div>`;}).join('');
        const empty=state.board.chat.length?'':`<div class="bi-examples"><p class="bi-pos">${t('说说想看什么，AI 会定画布大小、排好格子，再逐个取数生成。比如：','Say what you want to see; the AI sizes the canvas, lays out cells and builds them. For example:')}</p>${EXAMPLES().map(text=>`<button type="button" data-choice="${esc(text)}">${esc(text)}</button>`).join('')}</div>`;
        const focus=state.focus&&item(state.focus);
        return `<div class="bi-chat"><div class="bi-side-section"><h3>${t('看板对话','Board conversation')}<button type="button" class="bi-btn" data-bi-clear title="${esc(t('清空对话记录（看板不变）','Clear the conversation (the board stays)'))}">${t('清空','Clear')}</button></h3></div>
            <div class="bi-log">${empty}${log}${state.planning?`<div class="bi-msg is-ai">${t('AI 正在设计看板','Designing the board')}<span class="bi-typing" aria-hidden="true"><i></i><i></i><i></i></span></div>`:''}</div>
            ${focus?`<div class="bi-focus">${t('正在说：','Talking about: ')}${esc(focus.title||t('选中的格子','the selected cell'))}<button type="button" data-unfocus aria-label="${esc(t('改为说整个看板','Talk about the whole board'))}">✕</button></div>`:''}
            <form class="bi-composer" data-composer><textarea rows="2" maxlength="4000" placeholder="${esc(focus?t('说说这个格子要怎么改…','How should this cell change…'):t('说说想做什么看板，或要怎么改…','Describe the board, or what to change…'))}" ${state.planning?'disabled':''}></textarea><button type="submit" ${state.planning?'disabled':''}>${t('发送','Send')}</button></form>
            <div class="bi-hint">${t('<kbd>Enter</kbd> 发送 · 选中格子后 <kbd>←↑→↓</kbd> 微调位置（<kbd>Shift</kbd> 大步）· <kbd>⌘/Ctrl+Z</kbd> 撤销 · <kbd>⌘/Ctrl+S</kbd> 保存','<kbd>Enter</kbd> send · arrows nudge the selected cell · <kbd>⌘/Ctrl+Z</kbd> undo')}</div></div>`;
    }
    // Only messages and panels that are new animate in; redraws of what is already shown stay still.
    let shownMessages=Infinity,shownPanel='';
    function paintSide(){
        if(!state.board){side.innerHTML='';return;}
        const keep=side.querySelector('.bi-composer textarea')?.value||'',log=side.querySelector('.bi-log'),bottom=log?log.scrollHeight-log.scrollTop-log.clientHeight<40:true;
        const entry=state.selected&&item(state.selected);
        side.innerHTML=(entry?itemPanel(entry):'')+chatHtml();
        shownMessages=state.board.chat.length;
        const panel=side.querySelector('.bi-item-panel');if(panel&&entry&&shownPanel!==entry.id)panel.classList.add('is-new');shownPanel=entry?.id||'';
        const input=side.querySelector('.bi-composer textarea');if(input&&keep)input.value=keep;
        const nextLog=side.querySelector('.bi-log');if(nextLog&&bottom)nextLog.scrollTop=nextLog.scrollHeight;
    }
    side.addEventListener('change',event=>{
        const entry=state.selected&&item(state.selected);if(!entry)return;
        const P=window.AiReportParamPanel;
        if(P.isScale(event.target)){checkpoint();const value=P.readScale(side);if(value)entry.scale=value;else delete entry.scale;paintCanvas();if(entry.recipe)rerun(entry);return;}
        if(P.isInput(event.target)&&entry.recipe){const change=P.read(side,entry.recipe,entry.prompt);if(change){checkpoint();applyChange(entry,change);}return;}
        if(event.target.matches('[data-item-title]')){checkpoint();entry.title=event.target.value.trim().slice(0,80);paintCanvas();toolbar();return;}
        // No redraw here: the change fires as the user clicks Build, and redrawing would swallow that click.
        if(event.target.matches('[data-item-prompt]')){checkpoint();entry.prompt=event.target.value.trim().slice(0,4000);toolbar();}
    });
    side.addEventListener('click',event=>{
        const choice=event.target.closest('[data-choice]');if(choice)return send(choice.dataset.choice);
        if(event.target.closest('[data-unfocus]')){state.focus=null;return paintSide();}
        if(event.target.closest('[data-bi-clear]')){checkpoint();state.board.chat=[];return paintSide();}
        if(event.target.closest('[data-pp-extract]')){const entry=state.selected&&item(state.selected);if(entry?.recipe)extractItem(entry);return;}
        const action=event.target.closest('[data-item-action]')?.dataset.itemAction,entry=state.selected&&item(state.selected);if(!action||!entry)return;
        if(action==='build'){const prompt=side.querySelector('[data-item-prompt]')?.value.trim();if(prompt&&prompt!==entry.prompt){checkpoint();entry.prompt=prompt;}if(entry.prompt)build(entry);return;}
        checkpoint();
        if(action==='frame'){if(entry.frame===false)delete entry.frame;else entry.frame=false;return paint();}
        if(action==='duplicate'){const copy={...JSON.parse(JSON.stringify(entry)),id:B.uid('item'),x:Math.min(state.board.canvas.width-entry.w,entry.x+24),y:Math.min(state.board.canvas.height-entry.h,entry.y+24)};state.board.items.push(copy);state.selected=copy.id;state.focus=copy.id;return paint();}
        if(action==='delete'){state.board.items=state.board.items.filter(other=>other.id!==entry.id);state.selected=null;state.focus=null;return paint();}
    });
    // Build is usable as soon as there is something to build from, before the prompt field loses focus.
    side.addEventListener('input',event=>{if(!event.target.matches('[data-item-prompt]'))return;const button=side.querySelector('[data-item-action="build"]'),entry=state.selected&&item(state.selected);if(button&&entry)button.disabled=state.busy.has(entry.id)||!event.target.value.trim();});
    side.addEventListener('submit',event=>{if(!event.target.matches('[data-composer]'))return;event.preventDefault();const input=event.target.querySelector('textarea'),text=input.value.trim();if(text){input.value='';send(text);}});
    side.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.target.matches('.bi-composer textarea')){event.preventDefault();event.target.form.requestSubmit();}});

    // ── Conversation → plan → only new or changed cells are built ─────────────────────────────────────────────
    const brief=()=>({name:state.board.name,canvas:state.board.canvas,items:state.board.items.map(entry=>({id:entry.id,title:entry.title,x:entry.x,y:entry.y,w:entry.w,h:entry.h,prompt:entry.prompt}))});
    async function send(text){
        if(state.planning||!state.board)return;
        const focusId=state.focus||'';
        state.board.chat.push({role:'user',text});state.planning=true;paintSide();
        let plan=null;
        try{
            const reply=await window.AiReportTrace.post(BOARD,t('看板对话','Board conversation'),'/api/ai-report/bi/plan',{month:month(),message:text,chat:state.board.chat.slice(0,-1),board:brief(),focus:state.focus||''});
            if(reply.type==='plan')plan=reply;
            else if(reply.type==='ask')state.board.chat.push({role:'ai',text:reply.question,choices:reply.choices||[]});
            else state.board.chat.push({role:'ai',text:reply.text||t('（没有回答）','(No answer)')});
        }catch(error){state.board.chat.push({role:'ai',kind:'note',text:t('出错了：','Error: ')+(error.message||error)});}
        state.planning=false;
        if(!plan)return paint();
        checkpoint();
        const before=new Map(state.board.items.map(entry=>[entry.id,entry]));
        state.board.name=plan.name||state.board.name;state.board.canvas=plan.canvas;
        state.board.items=plan.items.map(next=>{const old=before.get(next.id);return old?{...old,title:next.title,x:next.x,y:next.y,w:next.w,h:next.h,prompt:next.prompt}:next;});
        // Talking about one cell always changes it: when the plan kept its prompt word for word, the request is added to it.
        const focused=focusId&&state.board.items.find(entry=>entry.id===focusId);
        if(focused&&focused.recipe&&focused.prompt===before.get(focusId)?.prompt)focused.prompt=`${focused.prompt}\n${text}`.slice(0,4000);
        const toBuild=state.board.items.filter(entry=>!entry.recipe||entry.prompt!==entry.recipePrompt);
        const toFit=state.board.items.filter(entry=>!toBuild.includes(entry)&&viewOf(entry)&&(()=>{const old=before.get(entry.id);return old&&(old.w!==entry.w||old.h!==entry.h);})());
        state.board.chat.push({role:'ai',text:`${plan.reply||t('看板已更新。','Board updated.')}${toBuild.length?t(`\n正在生成 ${toBuild.length} 个格子…`,`\nBuilding ${toBuild.length} cells…`):''}`});
        if(state.selected&&!item(state.selected)){state.selected=null;state.focus=null;}
        paint();
        await Promise.all([queue(toBuild,build),queue(toFit,rerun)]);
        if(toBuild.length){const failed=toBuild.filter(entry=>entry.output?.error).length;state.board.chat.push({role:'ai',kind:'note',text:failed?t(`${toBuild.length-failed} 个格子已生成，${failed} 个没成功（点格子上的“重新生成”，或在对话里补充说明）`,`${toBuild.length-failed} built, ${failed} failed`):t(`${toBuild.length>1?`${toBuild.length} 个格子都`:'格子'}生成好了。拖动 ⠿ 可移动，右下角可调大小；选中格子可以直接改展示设置。`,`All ${toBuild.length} cells built.`)});paintSide();}
    }

    // ── Boards: list, open, save, new, copy, rename, delete ──────────────────────────────────────────────────
    function toolbar(){
        if(!state.board)return;
        $('#biName').textContent=state.board.name;document.title=`${state.board.name} - AI BI`;
        $('#biMonth').value=month();
        const size=state.board.canvas,preset=B.PRESETS.find(item=>item.width===size.width&&item.height===size.height);
        $('#biPreset').innerHTML=B.PRESETS.map(item=>`<option value="${item.id}" ${preset?.id===item.id?'selected':''}>${esc(lang()==='en'?item.labelEn:item.label)}</option>`).join('')+`<option value="custom" ${preset?'':'selected'}>${t('自定义','Custom')}</option>`;
        $('#biWidth').value=size.width;$('#biHeight').value=size.height;
        $('#biList').innerHTML=state.boards.map(entry=>`<button type="button" data-open="${esc(entry.id)}" aria-current="${entry.id===state.board.id}"><span>${esc(entry.name)}</span><small>${entry.canvas?`${entry.canvas.width}×${entry.canvas.height} · `:''}${entry.items||0} ${t('格','cells')}</small></button>`).join('')||`<p class="bi-pos" style="padding:6px 10px">${t('还没有保存的看板','No saved boards yet')}</p>`;
        status('');
    }
    async function loadBoards(){try{state.boards=await API.get('/api/ai-bi/boards');}catch(_){state.boards=[];}}
    async function confirmDiscard(){return !dirty()||await window.AppDialog?.confirm?.(t('当前看板有未保存的修改，放弃这些修改吗？','Discard unsaved changes?'),{confirmText:t('放弃修改','Discard')})===true||(!window.AppDialog&&confirm(t('放弃未保存的修改？','Discard unsaved changes?')));}
    function adopt(board){shownMessages=Infinity;state.board=B.normalize(board);state.board.month||=previousMonth();state.saved=board.id?JSON.stringify(state.board):'';state.selected=null;state.focus=null;state.undo=[];dataCache.clear();render();}
    async function openBoard(id){if(!await confirmDiscard())return;try{adopt(await API.get('/api/ai-bi/boards/'+encodeURIComponent(id)));refreshMissing();}catch(error){status(error.message);}}
    async function newBoard(){if(!await confirmDiscard())return;adopt({name:t('未命名看板','Untitled board'),month:month(),canvas:{width:1920,height:1080}});}
    async function save(){
        if(!state.board)return;
        try{status(t('正在保存…','Saving…'));const saved=await API.post('/api/ai-bi/boards',state.board);state.board.id=saved.id;state.board.updatedAt=saved.updatedAt;state.saved=snapshot();await loadBoards();toolbar();status(t('已保存','Saved'));}
        catch(error){status(t('保存失败：','Save failed: ')+error.message);}
    }
    async function ask(message,value){return window.AppDialog?.prompt?await window.AppDialog.prompt(message,{defaultValue:value}):window.prompt(message,value);}
    // Cells saved without their output (or from another month) are recomputed locally on open.
    function refreshMissing(){queue(state.board.items.filter(entry=>entry.recipe&&(!entry.output?.html||entry.output.month!==month())&&!entry.output?.error),rerun);}

    $('.bi-toolbar').addEventListener('click',async event=>{
        const button=event.target.closest('button');if(!button)return;const menu=button.closest('details');if(menu)menu.open=false;
        if(button.dataset.open)return openBoard(button.dataset.open);
        const action=button.dataset.bi;
        if(action==='save')return save();
        if(action==='new')return newBoard();
        if(action==='mark')return marker?.toggle();
        if(action==='refresh'){dataCache.clear();return queue(state.board.items.filter(entry=>entry.recipe),rerun);}
        if(action==='present')return present(true);
        if(action==='export')return exportHtml();
        if(action==='rename'){const name=await ask(t('看板名称','Board name'),state.board.name);if(name&&name.trim()){checkpoint();state.board.name=name.trim().slice(0,120);render();}return;}
        if(action==='copy'){const name=await ask(t('另存为','Save as'),state.board.name+t(' 副本',' copy'));if(name&&name.trim()){state.board={...JSON.parse(snapshot()),id:'',name:name.trim().slice(0,120)};state.saved='';await save();}return;}
        if(action==='delete'){if(!state.board.id)return newBoard();const ok=window.AppDialog?.confirm?await window.AppDialog.confirm(t('删除这个看板？删除后无法恢复。','Delete this board? This cannot be undone.'),{tone:'danger',confirmText:t('删除','Delete')}):confirm(t('删除这个看板？','Delete this board?'));if(!ok)return;
            try{await API.delete('/api/ai-bi/boards/'+encodeURIComponent(state.board.id));state.saved=snapshot();await loadBoards();if(state.boards.length)await openBoard(state.boards[0].id);else adopt({name:t('未命名看板','Untitled board'),month:month()});}catch(error){status(error.message);}}
    });
    $('#biMonth').addEventListener('change',event=>{if(!B.validMonth(event.target.value))return;checkpoint();state.board.month=event.target.value;dataCache.clear();toolbar();queue(state.board.items.filter(entry=>entry.recipe),rerun);});
    function resizeCanvas(width,height){
        checkpoint();state.board.canvas=B.canvas({...state.board.canvas,width,height});const size=state.board.canvas;
        // Cells keep their place and shrink to fit when the canvas gets smaller.
        state.board.items=state.board.items.map(entry=>{const w=Math.min(entry.w,size.width),h=Math.min(entry.h,size.height);return {...entry,w,h,x:Math.min(entry.x,size.width-w),y:Math.min(entry.y,size.height-h)};});
        paint();queue(state.board.items.filter(entry=>viewOf(entry)),rerun);
    }
    $('#biPreset').addEventListener('change',event=>{const preset=B.PRESETS.find(item=>item.id===event.target.value);if(preset)resizeCanvas(preset.width,preset.height);});
    for(const id of ['#biWidth','#biHeight'])$(id).addEventListener('change',()=>resizeCanvas(Number($('#biWidth').value),Number($('#biHeight').value)));
    $('#biZoom').addEventListener('change',event=>{state.zoom=event.target.value;layoutCanvas();});
    let resizeTimer=0;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(layoutCanvas,80);});
    document.addEventListener('click',event=>document.querySelectorAll('.bi-toolbar details[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}));
    document.addEventListener('keydown',event=>{
        const editing=event.target.closest?.('input,textarea,select,[contenteditable]');
        if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();}
        else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&!editing){event.preventDefault();undo();}
        else if(event.key==='Escape'&&state.presenting)present(false);
        else if(event.key==='Escape'&&!editing&&state.selected&&!marker?.active()){state.selected=null;state.focus=null;paint();}
        else if(event.key.startsWith('Arrow')&&!editing&&state.selected&&!state.presenting){
            // Nudge by the grid (Shift: five steps); kept on the canvas.
            const entry=item(state.selected);if(!entry)return;event.preventDefault();
            const step=B.GRID*(event.shiftKey?5:1),size=state.board.canvas,dx={ArrowLeft:-step,ArrowRight:step}[event.key]||0,dy={ArrowUp:-step,ArrowDown:step}[event.key]||0;
            if(!nudging){checkpoint();nudging=true;}clearTimeout(nudgeTimer);nudgeTimer=setTimeout(()=>{nudging=false;},600);
            entry.x=Math.max(0,Math.min(size.width-entry.w,entry.x+dx));entry.y=Math.max(0,Math.min(size.height-entry.h,entry.y+dy));
            const node=canvasNode.querySelector(`[data-cell="${CSS.escape(entry.id)}"]`);if(node){node.style.left=entry.x+'px';node.style.top=entry.y+'px';}
            const pos=side.querySelector('.bi-item-panel .bi-pos');if(pos)pos.textContent=`${entry.x}, ${entry.y} · ${entry.w}×${entry.h}`;status('');
        }
        else if((event.key==='Delete'||event.key==='Backspace')&&!editing&&state.selected){checkpoint();state.board.items=state.board.items.filter(entry=>entry.id!==state.selected);state.selected=null;state.focus=null;paint();}
    });
    let nudging=false,nudgeTimer=0;
    window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});

    // Present: only the canvas, fitted to the screen (full screen when the browser allows it).
    function present(on){
        state.presenting=on;document.body.classList.toggle('bi-presenting',on);marker?.set(false);
        if(on){state.selected=null;document.documentElement.requestFullscreen?.().catch(()=>{});}
        else if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});
        paint();
    }
    document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&state.presenting)present(false);else layoutCanvas();});

    // Export: one HTML file with the board as static content (charts become SVG).
    async function exportHtml(){
        status(t('正在导出…','Exporting…'));
        try{
            const holder=document.createElement('div');holder.style.cssText='position:absolute;left:-100000px;top:0';
            const size=state.board.canvas;
            holder.innerHTML=`<div class="bi-canvas is-clean" style="position:relative;transform:none;width:${size.width}px;height:${size.height}px;background:${size.background}">${state.board.items.filter(entry=>entry.output?.html&&!entry.output.error).map(entry=>`<div class="bi-item${entry.frame===false?' is-frameless':''}" data-cell="${esc(entry.id)}" style="left:${entry.x}px;top:${entry.y}px;width:${entry.w}px;height:${entry.h}px"><div class="bi-item-body air-output" data-zoom="${B.scaleOf(entry,size)}" style="zoom:${B.scaleOf(entry,size)}">${entry.output.html}</div></div>`).join('')}</div>`;
            document.body.append(holder);fitBodies(holder);
            window.AiReportWidgets.freeze(holder,(cellId,widgetId)=>item(cellId)?.output?.widgets?.find(widget=>widget.id===widgetId),{palette:palette()});
            const css=(await Promise.all([...document.querySelectorAll('link[rel=stylesheet][href*="ai-report.css"],link[rel=stylesheet][href*="ai-bi.css"]')].map(link=>fetch(link.href).then(response=>response.text()).catch(()=>'')))).join('\n');
            const vars=palette().map((color,index)=>`--kit-c${index}:${color}`).join(';');
            const markup=holder.innerHTML;holder.remove();
            const html=`<!doctype html><html lang="${lang()==='en'?'en':'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(state.board.name)}</title><style>${css}\nbody{margin:0;background:#e9edf2;display:flex;justify-content:center;padding:24px}.bi-canvas{${vars};--air-accent:${palette()[0]}}</style></head><body>${markup}</body></html>`;
            const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));link.download=`${state.board.name.replace(/[\\/:*?"<>|]/g,'_')}-${month()}.html`;document.body.append(link);link.click();setTimeout(()=>{URL.revokeObjectURL(link.href);link.remove();},1000);
            status(t('已导出','Exported'));
        }catch(error){status(t('导出失败：','Export failed: ')+error.message);}
    }

    // ── Start: the most recent board, or a fresh one ─────────────────────────────────────────────────────────
    (async()=>{
        await loadBoards();
        const wanted=new URLSearchParams(location.search).get('board');
        const first=wanted&&state.boards.find(entry=>entry.id===wanted)?wanted:state.boards[0]?.id;
        if(first){try{adopt(await API.get('/api/ai-bi/boards/'+encodeURIComponent(first)));refreshMissing();return;}catch(_){/* fall through to a new board */}}
        adopt({name:t('未命名看板','Untitled board'),month:previousMonth(),canvas:{width:1920,height:1080}});
    })();
    window.AiBiApp={state,send,save};
})();
