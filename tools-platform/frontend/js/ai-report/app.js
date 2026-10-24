/* AI report editor: a template plus chapters of cells; each cell is a prompt the AI compiles into a monthly recipe. */
(function(){
    'use strict';
    const M=AiReportModel,esc=AiReportView.esc;
    const $=selector=>document.querySelector(selector);
    const state={doc:null,saved:'',lang:/^en/i.test(window.ToolsI18n?.getLanguage?.()||'')?'en':'zh',preview:false,selected:null,busy:new Map(),undo:[],reports:[],drafts:new Map()};
    const t=(zh,en)=>state.lang==='en'?en:zh;
    // An opened but unused chapter style chat is not an unsaved change.
    const snapshot=()=>JSON.stringify(state.doc,(key,value)=>(key==='style'||M.FIELD_KEY.test(key)||M.IMAGE_KEY.test(key))&&value&&typeof value==='object'&&'chat' in value&&!value.prompt&&!value.chat?.length&&!value.theme?undefined:value);
    const dirty=()=>!!state.doc&&snapshot()!==state.saved;
    const previousMonth=()=>{const date=new Date();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);};
    const reportRoot=$('#airReport'),chatRoot=$('#airChat');

    function checkpoint(){state.undo.push(snapshot());if(state.undo.length>60)state.undo.shift();}
    function undo(){const previous=state.undo.pop();if(!previous)return status(t('没有可撤销的操作','Nothing to undo'));state.doc=JSON.parse(previous);render();status(t('已撤销','Undone'));}
    let statusTimer=null;
    function status(message){const node=$('#airStatus');clearTimeout(statusTimer);if(message){node.textContent=message;statusTimer=setTimeout(()=>status(),3500);return;}node.textContent=state.busy.size?t(`AI 正在处理 ${state.busy.size} 个格子…`,`AI working on ${state.busy.size} cell(s)…`):dirty()?t('● 未保存','● Unsaved'):t('已保存','Saved');node.classList.toggle('is-dirty',dirty());}

    // The whole report is one more conversation target: its style chat lives on doc.style and only changes the look.
    const REPORT='__report__';
    // A chapter's style chat is a target too: its prompt only restyles the chapter's cells (render), never their data.
    const CHAPTER='chapter-style:',FIELD='field:',IMAGE='image:';
    const imageSlotOf=cellId=>String(cellId||'').startsWith(IMAGE)&&M.IMAGE_KEY.test(cellId.slice(IMAGE.length))?cellId.slice(IMAGE.length):'';
    const fieldKeyOf=cellId=>String(cellId||'').startsWith(FIELD)&&M.FIELD_KEY.test(cellId.slice(FIELD.length))?cellId.slice(FIELD.length):'';
    const chapterOf=cellId=>String(cellId||'').startsWith(CHAPTER)?state.doc?.chapters.find(item=>item.id===cellId.slice(CHAPTER.length))||null:null;
    function find(cellId){
        if(!state.doc)return null;
        if(cellId===REPORT)return {kind:'report',cell:state.doc.style,chapter:{title:M.bilingual('整份月报 · 风格与每个格子的通用要求','Whole report · style and rules for every cell')},busy:state.busy.get(REPORT)};
        const slot=imageSlotOf(cellId);
        if(slot&&state.doc.template){const tpl=state.doc.template,images=tpl.images||={},record=images[slot]||={prompt:'',chat:[]};return {kind:'image',cell:record,image:{slot,url:tpl.logo,width:tpl.logoWidth,base:M.IMAGE_BASE[slot]},chapter:{title:{zh:'月报开头 · LOGO',en:'Report header · Logo'}},busy:state.busy.get(cellId)};}
        const fieldKey=fieldKeyOf(cellId);
        if(fieldKey&&state.doc.template){const field=headerField(fieldKey);if(!field)return null;const fields=state.doc.template.fields||={};const record=fields[fieldKey]||={prompt:'',chat:[],appliedPrompt:''};return {kind:'field',cell:record,field,chapter:{title:{zh:`月报开头 · ${field.label}`,en:`Report header · ${field.label}`}},busy:state.busy.get(cellId)};}
        const styled=chapterOf(cellId);
        if(styled){styled.style||={prompt:'',chat:[],appliedPrompt:''};return {kind:'chapter',cell:styled.style,chapter:{title:{zh:`「${styled.title.zh||styled.title.en||''}」章节 · 统一格子样式`,en:`“${styled.title.en||styled.title.zh||''}” chapter · cell style`}},busy:state.busy.get(cellId)};}
        const found=M.findCell(state.doc,cellId);return found?{...found,kind:'cell',busy:state.busy.get(cellId)}:null;
    }
    // The report style, plus the style of the chapter the cell sits in (it wins on looks; data stays the cell's own).
    const styleOf=cell=>{
        const base=state.doc.style.prompt||'',own=cell?.id&&M.findCell(state.doc,cell.id)?.chapter?.style?.prompt;
        return own?`${base}\n\n【本章节样式要求】（只管这个章节里格子的样式和风格，和上面关于样式的要求冲突时以这里为准；不改变数据来源、口径和计算）\n${own}`:base;
    };
    const widgetLookup=(cellId,widgetId)=>find(cellId)?.cell?.output?.widgets?.find(item=>item.id===widgetId);
    const imageLibrary=AiReportImageLibrary.create({API,t,find,render,aiStep,actions:record=>withUndo(record,IMAGE_ACTIONS())});
    const chat=AiReportChat.create({root:chatRoot,t,lang:()=>state.lang,find,send:(cellId,text)=>converse(cellId,text),retry:(cellId,index)=>retryMessage(cellId,index),makePrompt:cellId=>makePrompt(cellId),tryPrompt:cellId=>tryPrompt(cellId),revert:cellId=>revertPrompt(cellId),savePrompt:(cellId,text)=>savePromptEdit(cellId,text),close:()=>select(null),pickImage:(cellId,url,index)=>pickImage(cellId,url,index),imagePage:imageLibrary.page,removeImage:imageLibrary.remove,imageDeletion:imageLibrary.decide});

    function staleCells(){return M.cells(state.doc).filter(cell=>AiReportRunner.needsNarrative(cell,state.doc.reportMonth));}
    // A cell whose finished content differs from what was last shown gets the splash transition (old → new).
    const shown={docId:null,signatures:new Map()};
    const outputSignature=cell=>cell.output?`${cell.output.error||''}\u0001${cell.output.html||''}\u0001${JSON.stringify(cell.output.narrative||'')}`:'';
    function changedCells(){
        if(shown.docId!==state.doc.id){shown.docId=state.doc.id;shown.signatures.clear();}
        const changed=[];
        for(const cell of M.cells(state.doc)){
            if(state.busy.has(cell.id))continue; // results in between steps are not the change the user waits for
            const signature=outputSignature(cell),before=shown.signatures.get(cell.id);
            if(before!==undefined&&before!==signature&&cell.output?.html&&!cell.output.error)changed.push(cell.id);
            shown.signatures.set(cell.id,signature);
        }
        return state.preview||state.printing?[]:changed;
    }
    function render(){
        if(!state.doc)return;
        const splash=AiReportSplash.capture(reportRoot,changedCells()),splashLayer=reportRoot.querySelector(':scope>.air-splash-layer');
        // What was typed into empty cells (and where the caret was) survives re-renders such as resizing.
        const active=document.activeElement?.closest?.('[data-ask] textarea')?document.activeElement:null;
        for(const input of reportRoot.querySelectorAll('[data-ask] textarea'))state.drafts.set(input.closest('[data-ask]').dataset.ask,input.value);
        const caret=active?{id:active.closest('[data-ask]').dataset.ask,start:active.selectionStart,end:active.selectionEnd}:null;
        reportRoot.classList.toggle('is-preview',state.preview);document.body.classList.toggle('air-preview-mode',state.preview);
        reportRoot.style.cssText=AiReportView.themeStyle(state.doc.style.theme);Object.assign(reportRoot.dataset,AiReportView.frameOf(state.doc.style.theme));
        reportRoot.innerHTML=AiReportView.report(state.doc,{mode:state.preview?'preview':'edit',lang:state.lang,t,month:state.doc.reportMonth,busy:state.busy,busyFields,selected:state.selected,rings:progressRings()});
        // Widgets are interactive in the page; printing freezes them so every row and chart lands on paper.
        const widgetOptions={palette:AiReportWidgets.paletteOf(state.doc.style.theme)};
        AiReportLayout.apply(reportRoot,cellId=>find(cellId)?.cell?.layout);
        if(state.printing)AiReportWidgets.freeze(reportRoot,widgetLookup,widgetOptions);else{AiReportWidgets.hydrate(reportRoot,widgetLookup,widgetOptions);AiReportLayout.fitRows(reportRoot);fitCells();if(!state.preview){decorateSlots();paintSettling();}}
        AiReportLayout.drawDividers(reportRoot);
        // Everything above measured the report at full size; a zoomed-out view (moving chapters) comes back last.
        applyZoom();
        if(splashLayer)reportRoot.append(splashLayer);AiReportSplash.play(reportRoot,splash);
        if(!state.preview&&!state.printing&&M.cells(state.doc).some(cell=>AiReportRunner.readsReport(cell)))followReport();
        for(const input of reportRoot.querySelectorAll('[data-ask] textarea')){const id=input.closest('[data-ask]').dataset.ask;if(state.drafts.get(id))input.value=state.drafts.get(id);if(caret?.id===id){input.focus({preventScroll:true});input.setSelectionRange(caret.start,caret.end);}}
        chat.render(state.preview?null:state.selected);
        document.body.classList.toggle('air-chat-open',!chatRoot.hidden);
        toolbar();status();
    }
    function toolbar(){
        $('#airMonth').value=state.doc.reportMonth;
        $('#airReportName').textContent=state.doc.name;
        $('#airReportList').innerHTML=state.reports.map(item=>`<button type="button" data-open="${esc(item.id)}" aria-current="${item.id===state.doc.id}"><span>${esc(item.name)}</span><small>${esc(item.reportMonth)}</small></button>`).join('')||`<p>${t('还没有保存的月报','No saved reports yet')}</p>`;
        const stale=staleCells().length,narratives=$('#airNarratives');
        narratives.hidden=!stale||state.preview;narratives.textContent=t(`更新总结（${stale}）`,`Update summaries (${stale})`);
        $('[data-air=preview]').textContent=state.preview?t('返回编辑','Edit'):t('预览','Preview');
        $('[data-air=language]').textContent=state.lang==='en'?'中文':'EN';
        $('[data-air=save]').disabled=!dirty();
        document.title=`${state.doc.name} - AI 月报`;
    }
    // Rings grow from where they were; a cell that just finished shows one full (or red, on error) ring that fades out.
    state.rings=new Map();
    function progressRings(){
        const rings=new Map();
        for(const [cellId,label] of state.busy){if(cellId===REPORT)continue;const stage=AiReportView.stageOf(label),previous=state.rings.get(cellId);rings.set(cellId,{...stage,from:previous?previous.to:0});}
        for(const [cellId,previous] of state.rings)if(!state.busy.has(cellId))rings.set(cellId,{stage:find(cellId)?.cell?.output?.error?'error':'done',from:previous.to,to:100,done:true});
        state.rings=new Map([...rings].filter(([,ring])=>!ring.done));
        return rings;
    }
    // Selecting only moves the highlight and swaps the chat panel; the report is not re-rendered, so focus, drill-down
    // and table state in every cell survive.
    function select(cellId){
        state.selected=cellId;
        reportRoot.querySelectorAll('.air-cell.is-selected').forEach(node=>node.classList.remove('is-selected'));
        if(cellId&&cellId!==REPORT)reportRoot.querySelector(`[data-cell="${CSS.escape(cellId)}"]`)?.classList.add('is-selected');
        chat.render(state.preview?null:cellId);
        document.body.classList.toggle('air-chat-open',!chatRoot.hidden);
    }
    // While the chat is open, any interaction inside another cell (input, buttons, charts, tables) switches the chat to it.
    const followCell=event=>{const cellId=event.target.closest?.('[data-cell]')?.dataset.cell;if(cellId&&!state.preview&&!chatRoot.hidden&&state.selected!==cellId)select(cellId);};

    // Chat only discusses the cell; a final prompt is made on request, and “试一下” compiles and runs it.
    async function aiStep(cellId,label,work){
        const found=find(cellId);if(!found||state.busy.has(cellId))return;
        checkpoint();state.busy.set(cellId,label);state.selected=cellId;render();
        try{await work(found.cell);}
        catch(error){const live=find(cellId)?.cell;if(live)live.chat.push({role:'ai',kind:'note',text:t('出错了：','Error: ')+error.message});}
        finally{state.busy.delete(cellId);render();}
    }
    // When the AI says the need is settled, the prompt is written and run right away — no clicks.
    function converse(cellId,text){
        const pending=find(cellId)?.cell;
        // A report-wide rule offered by the AI: adding it needs no AI call.
        if(pending&&cellId!==REPORT&&pending.chat.at(-1)?.purpose==='rule'){
            const offer=pending.chat.at(-1);checkpoint();pending.chat.push({role:'user',text});
            const added=text===RULE_CHOICES()[0]&&addReportRule(offer.rule);
            pending.chat.push({role:'ai',kind:'answer',text:text===RULE_CHOICES()[0]?(added?t(`已加入月报整体风格提示词的【${offer.rule.section}】：${offer.rule.item}。之后每个格子生成时都会遵守；点右上角“✦ 整体风格”可以查看或撤回。`,`Added to the report prompt under ${offer.rule.section}.`):t('月报整体风格提示词里已经有这条要求了。','The report prompt already has this rule.')):t('好的，这条只用于这个格子。','OK, only for this cell.')});
            render();return;
        }
        if(pending&&cellId!==REPORT&&pending.chat.at(-1)?.purpose==='abbr'){
            pending.chat.push({role:'user',text});
            if(text===ABBREVIATION_CHOICES()[3]){pending.chat.push({role:'ai',kind:'ask',purpose:'abbr',text:t('请直接写出缩写规则，例如：地区部名称只保留前两个字；去掉“ORG:”这类前缀；日期写成 9/7。','Write the abbreviation rule, e.g. keep the first two characters of region names.'),choices:[]});render();return;}
            pending.abbreviation=text;return applySize(cellId);
        }
        if(imageSlotOf(cellId))return imageTurn(cellId,text);
        if(fieldKeyOf(cellId))return aiStep(cellId,t('AI 正在思考…','AI is thinking…'),async cell=>{
            const key=fieldKeyOf(cellId),field=headerField(key);
            cell.chat.push({role:'user',text});render();
            const reply=await AiReportTrace.post(cellId,t('字段对话','Field chat'),'/api/ai-report/template/field/chat',{month:state.doc.reportMonth,label:field.label,prompt:cell.prompt,chat:cell.chat.slice(0,-1),message:text,current:{zh:field.target.zh,en:field.target.en},style:state.doc.style.prompt||''});
            if(reply.type==='ask'){cell.chat.push({role:'ai',kind:'ask',text:reply.question,choices:reply.choices||[]});return;}
            cell.chat.push({role:'ai',kind:'answer',text:reply.text});
            if(reply.type==='ready'){await writePrompt(cellId,cell);await generateField(key);}
        });
        if(chapterOf(cellId))return aiStep(cellId,t('AI 正在思考…','AI is thinking…'),async cell=>{
            cell.chat.push({role:'user',text});render();
            const reply=await AiReportTrace.post(cellId,t('章节样式对话','Chapter style chat'),'/api/ai-report/chapter/chat',{prompt:cell.prompt,chat:cell.chat.slice(0,-1),message:text,style:state.doc.style.prompt||'',cells:chapterCellNotes(cellId)});
            if(reply.type==='ask'){cell.chat.push({role:'ai',kind:'ask',text:reply.question,choices:reply.choices||[]});return;}
            cell.chat.push({role:'ai',kind:'answer',text:reply.text});
            if(reply.type==='ready'){await writePrompt(cellId,cell);await applyChapterStyle(cellId,cell);}
        });
        return aiStep(cellId,t('AI 正在查数据、思考…','AI is reading data and thinking…'),async cell=>{
            cell.chat.push({role:'user',text});render();
            // “Keep the data” hands the AI the last prompt that ran, so it restores those data sources and only renames text.
            const keepData=cellId!==REPORT&&text===t('数据不变，只改显示文字','Keep the data, rename the text only')&&cell.recipe&&cell.recipePrompt&&cell.recipePrompt!==cell.prompt;
            const message=keepData?`${text}。上一次能正常取到数据的提示词是：\n${cell.recipePrompt}\n请保留它的数据来源（指标、表、列的名称原样不变），只按最新提示词修改标题、表头等显示文字，然后回复 ready。`:text;
            const report=cellId===REPORT,reply=await AiReportTrace.post(cellId,report?t('整体风格对话','Report style chat'):t('格子对话','Cell chat'),report?'/api/ai-report/report/chat':'/api/ai-report/cell/chat',{month:state.doc.reportMonth,prompt:cell.prompt,chat:cell.chat.slice(0,-1),message,...(keepData?{decided:true}:{}),style:styleOf(cell),...(report?{chapters:state.doc.chapters.filter(chapter=>chapter.style?.prompt).map(chapter=>({title:M.text(chapter.title,'zh'),style:chapter.style.prompt}))}:{outline:AiReportRunner.outline(cell)})});
            const offerRule=()=>{if(!report&&reply.reportRule)cell.chat.push({role:'ai',kind:'ask',purpose:'rule',rule:reply.reportRule,text:t(`这条要求看起来适用于整份月报：“${reply.reportRule.item}”。要加入月报整体风格提示词的【${reply.reportRule.section}】吗？加入后每个格子生成时都会遵守。`,`This looks like a rule for the whole report: “${reply.reportRule.item}”. Add it to the report prompt?`),choices:RULE_CHOICES()});};
            if(reply.type==='ask'){cell.chat.push({role:'ai',kind:'ask',text:reply.question,choices:reply.choices||[]});offerRule();return;}
            cell.chat.push({role:'ai',kind:'answer',text:reply.text});
            if(reply.type==='ready'){
                const before=cell.prompt;await writePrompt(cellId,cell);
                // Same prompt as the one on screen: rebuilding would only reroll a working cell (titles, layout lost).
                if(!report&&cell.prompt===before&&cell.recipe&&cell.recipePrompt===before&&cell.output&&!cell.output.error)cell.chat.push({role:'ai',kind:'note',text:t('最终提示词没有变化，格子内容保持不变。想改哪里请直接说要改成什么；需要重新生成可以点“再试一次”。','The final prompt did not change, so the cell stays as it is. Say what to change, or click “Try again” to rebuild.')});
                else await (report?applyStyle(cell):compileAndRun(cellId,cell));
            }
            offerRule();
        });
    }
    // Retry sends the same words again. For the latest message (with no final prompt after it) the earlier answer
    // dissolves away and is replaced; otherwise the words go in again as a new message, leaving prompts untouched.
    async function retryMessage(cellId,index){
        const cell=find(cellId)?.cell,item=cell?.chat[index];if(!item||item.role!=='user'||state.busy.has(cellId))return;
        const replace=index===cell.chat.map(message=>message.role).lastIndexOf('user')&&!cell.chat.slice(index+1).some(message=>message.kind==='prompt');
        if(replace){await chat.dissolve(index);checkpoint();cell.chat.splice(index);}
        return converse(cellId,item.text);
    }
    async function writePrompt(cellId,cell){
        state.busy.set(cellId,t('正在总结对话，生成最终提示词…','Summarizing into the final prompt…'));render();
        const {prompt}=await AiReportTrace.post(cellId,t('生成最终提示词','Write the final prompt'),cellId===REPORT?'/api/ai-report/report/prompt':fieldKeyOf(cellId)?'/api/ai-report/template/field/prompt':chapterOf(cellId)?'/api/ai-report/chapter/prompt':'/api/ai-report/cell/prompt',{month:state.doc.reportMonth,prompt:cell.prompt,chat:cell.chat});
        cell.prompt=prompt;cell.chat.push({role:'ai',kind:'prompt',text:prompt});if(cellId!==REPORT&&!chapterOf(cellId)&&!fieldKeyOf(cellId))syncNarrowLayout(cell);
    }
    // A failed run goes back to the compiler once with the error, so most code slips fix themselves.
    async function compileAndRun(cellId,cell){
        const month=state.doc.reportMonth;let error='',usable=null;syncNarrowLayout(cell);
        // When every attempt fails, the cell is never left blank: content that ran (only its title missing) stays,
        // otherwise the previous recipe and output come back.
        const before={recipe:cell.recipe,recipePrompt:cell.recipePrompt,output:cell.output,missing:cell.missing};
        for(let attempt=0;attempt<3;attempt++){
            state.busy.set(cellId,t('正在把提示词变成配方…','Turning the prompt into a recipe…'));render();
            const reply=await AiReportTrace.post(cellId,t(`编译配方（第 ${attempt+1} 次）`,`Compile recipe (attempt ${attempt+1})`),'/api/ai-report/cell/compile',{month,prompt:cell.prompt,recipe:cell.recipe,previousPrompt:attempt?'':cell.recipePrompt||'',error,style:styleOf(cell),outline:AiReportRunner.outline(cell)});
            if(reply.type==='ask'){
                // A cell that ran before and now cannot find its data after a wording change can keep its data and rename only.
                const keep=before.recipe&&/找不到|没有找到|未找到|不存在|找到以下|哪一个/.test(reply.question||'')?[t('数据不变，只改显示文字','Keep the data, rename the text only')]:[];
                cell.chat.push({role:'ai',kind:'ask',text:reply.question,choices:[...keep,...(reply.choices||[])]});return;
            }
            cell.recipe=reply.recipe;cell.recipePrompt=cell.prompt;
            state.busy.set(cellId,t('正在计算本月数据…','Computing this month…'));render();
            try{await AiReportRunner.run(cell,month,{style:styleOf(cell)});AiReportTrace.note(cellId,t(`运行配方（第 ${attempt+1} 次）：成功`,`Run recipe (attempt ${attempt+1}): ok`),t('沙箱里计算和展示都完成了。','Compute and render finished in the sandbox.'));render();const crowdedRow=reportRoot.querySelector(`[data-cell="${CSS.escape(cellId)}"]`)?.dataset.layoutIssue;
                // Blocks that did not fit side by side go back once to be laid out properly; the last try keeps the automatic fix.
                if(crowdedRow&&attempt<2)throw new Error(`${crowdedRow}。页面已临时缩小字号并换行，但请重新排版：把放不下的内容块换到下一行（如文字总结放在顶部或底部、图表和表格上下排列），或减少表格列数，保证每块在分到的宽度里完整显示。`);const lost=AiReportRunner.missingTitle(cell);if(lost&&String(cell.output?.html||'').replace(/<[^>]*>/g,'').trim()){usable={recipe:cell.recipe,output:cell.output,missing:cell.missing};}if(lost)throw new Error(`提示词要求显示标题“${lost}”，但格子里没有这个标题。请用 kit.layout(rows,{title:'${lost}'}) 或 kit.chart(option,{title:'${lost}'}) 把它显示在最上方。`);reconcileLayout(cell);rememberResult(cell);return;}catch(problem){error=problem.message;AiReportTrace.note(cellId,t(`运行出错（第 ${attempt+1} 次），交回 AI 修正`,`Run failed (attempt ${attempt+1}), sent back to the AI`),error,{error:true});}
        }
        if(usable){cell.recipe=usable.recipe;cell.recipePrompt=cell.prompt;cell.output=usable.output;cell.missing=usable.missing;reconcileLayout(cell);rememberResult(cell);}
        else if(before.output&&!before.output.error){cell.recipe=before.recipe;cell.recipePrompt=before.recipePrompt;cell.output=before.output;cell.missing=before.missing;}
        cell.chat.push({role:'ai',kind:'note',text:t(`生成失败：${error}。${usable?'格子先显示这次生成的内容。':before.output&&!before.output.error?'格子保持原来的内容。':''}可以在对话里补充说明后重新生成提示词再试。`,`Run failed: ${error}. Add details in the chat, regenerate the prompt and try again.`)});
    }
    // The names a recipe reads data by (metric names, tables, sheets, datasets) — kept intact when only text is renamed.
    function dataNamesOf(recipe){
        return (recipe?.sources||[]).flatMap(source=>source.kind==='metrics'?source.names||[]:source.kind==='sheet'?[source.label,source.match?.sheetName,source.match?.sourceKey]:source.kind==='dataset'?[source.label]:[]).filter(Boolean);
    }
    // The style prompt becomes a theme (colours, font, corners) applied to the whole report, including existing charts.
    async function applyStyle(style){
        state.busy.set(REPORT,t('正在根据风格生成主题…','Building the theme from the style…'));render();
        const {theme,reply}=await AiReportTrace.post(REPORT,t('生成主题','Build theme'),'/api/ai-report/report/theme',{prompt:style.prompt});
        style.theme=theme;style.themePrompt=style.prompt;rememberResult(style,true);
        style.chat.push({role:'ai',kind:'answer',text:`${reply?reply.replace(/[。.]?$/,'。'):t('已应用到整份月报。','Applied to the whole report. ')}${t('样式马上生效；数据、文字和排版方面的通用要求会在各格子下次生成时生效。','The look changes now; the rules apply when each cell is generated next.')}`});
    }
    // What the chapter's cells are, so the style chat can talk about them (titles and what each one shows).
    function chapterCellNotes(styleId){
        return (chapterOf(styleId)?.cells||[]).filter(cell=>cell.recipe).map(cell=>({title:AiReportRunner.cellTitle(cell,state.lang)||'',prompt:String(cell.prompt||'').slice(0,300)}));
    }
    // Restyle every generated cell in the chapter: the server keeps each recipe's sources and compute as they are and
    // only rewrites render, so numbers cannot change. A cell that fails keeps its previous recipe and output.
    async function applyChapterStyle(styleId,style){
        const chapter=chapterOf(styleId);if(!chapter)return;
        const cells=chapter.cells.filter(cell=>cell.recipe&&!state.busy.has(cell.id)),month=state.doc.reportMonth,failed=[];
        for(const cell of cells)state.busy.set(cell.id,t('等待统一样式…','Queued for restyling…'));render();
        await Promise.all([0,1].map(async()=>{while(cells.length){
            const cell=cells.shift(),before={recipe:cell.recipe,output:cell.output,missing:cell.missing};let error='';
            for(let attempt=0;attempt<3;attempt++){
                state.busy.set(cell.id,t('正在按章节样式调整…','Applying the chapter style…'));render();
                try{
                    const reply=await AiReportTrace.post(cell.id,t('按章节样式调整','Restyle for chapter'),'/api/ai-report/cell/restyle',{month,prompt:cell.prompt,recipe:before.recipe,attempt:error?cell.recipe:null,error,style:styleOf(cell)});
                    cell.recipe=reply.recipe;
                    await AiReportRunner.run(cell,month,{withNarrative:!!cell.recipe.narrative,style:styleOf(cell)});
                    const lost=AiReportRunner.missingTitle(cell);if(lost)throw new Error(`提示词要求显示标题“${lost}”，但格子里没有这个标题。`);
                    reconcileLayout(cell);rememberResult(cell);error='';break;
                }catch(problem){error=problem.message||String(problem);AiReportTrace.note(cell.id,t('章节样式调整出错','Restyle failed'),error,{error:true});}
            }
            if(error){cell.recipe=before.recipe;cell.output=before.output;cell.missing=before.missing;failed.push(AiReportRunner.cellTitle(cell,state.lang)||cell.id);}
            state.busy.delete(cell.id);render();
        }}));
        style.appliedPrompt=style.prompt;
        const done=chapter.cells.filter(cell=>cell.recipe).length-failed.length;
        style.chat.push({role:'ai',kind:failed.length?'note':'answer',text:failed.length?t(`已按章节样式调整 ${done} 个格子；${failed.join('、')} 没能调整成功，保持原样。可以在对话里补充说明后点“重新应用”。`,`Restyled ${done} cell(s); ${failed.join(', ')} kept their previous look.`):t(`已按章节样式调整本章节的 ${done} 个格子，数据和计算没有改动。之后在这个章节新生成的格子也会遵守这些样式要求。`,`Restyled ${done} cell(s) in this chapter; data and calculations are unchanged. New cells here follow the style too.`)});
    }
    // Each prompt keeps what it produced, so undoing the next prompt can bring this result back without asking the AI.
    const promptIndexes=cell=>cell.chat.map((message,index)=>message.kind==='prompt'?index:-1).filter(index=>index>=0);
    function rememberResult(cell,report=false){
        const message=cell.chat[promptIndexes(cell).at(-1)];if(!message||message.text!==cell.prompt)return;
        if(report)message.theme=cell.theme;
        else{message.recipe=cell.recipe;message.narrative=cell.output?.narrative||null;message.narrativeMonth=cell.output?.narrativeMonth||'';}
    }
    // Undo the latest final prompt: the messages since the previous prompt dissolve away, and the previous prompt's
    // recipe (or theme) comes back, rerun on this month's data. With no previous prompt the cell returns to blank.
    async function revertPrompt(cellId){
        const found=find(cellId);if(!found||state.busy.has(cellId))return;
        const {cell}=found,report=cellId===REPORT,indexes=promptIndexes(cell);if(!indexes.length)return;
        // A chapter style goes back to its previous wording; the cells keep their current look until it is applied again.
        if(imageSlotOf(cellId)){const previous=indexes.length>1?indexes.at(-2):-1;await chat.dissolve(previous+1);checkpoint();cell.chat.splice(previous+1);cell.prompt=previous>=0?cell.chat[previous].text:'';chat.reveal(cellId,Math.max(0,previous));render();status(t('已撤回到上一个图片提示词；LOGO 保持当前这张','Reverted the image prompt; the logo stays'));return;}
        if(fieldKeyOf(cellId)){const previous=indexes.length>1?indexes.at(-2):-1;await chat.dissolve(previous+1);checkpoint();cell.chat.splice(previous+1);cell.prompt=previous>=0?cell.chat[previous].text:'';chat.reveal(cellId,Math.max(0,previous));render();if(cell.prompt)await generateField(fieldKeyOf(cellId));status(t('已撤回到上一个字段提示词','Reverted to the previous field prompt'));return;}
        if(chapterOf(cellId)){const previous=indexes.length>1?indexes.at(-2):-1;await chat.dissolve(previous+1);checkpoint();cell.chat.splice(previous+1);cell.prompt=previous>=0?cell.chat[previous].text:'';chat.reveal(cellId,Math.max(0,previous));render();status(t('已撤回章节样式提示词；格子保持当前样式，需要时点“应用到本章节”','Chapter style reverted; cells keep their look until applied again'));return;}
        const previous=indexes.length>1?indexes.at(-2):-1;
        if(previous<0&&!await AppDialog.confirm(t('这是第一个最终提示词。撤回会清空这段对话，格子回到空白，确定吗？','This is the first final prompt. Undoing clears this conversation and empties the cell. Continue?'),{tone:'danger',confirmText:t('撤回','Undo')}))return;
        await chat.dissolve(previous+1);
        checkpoint();
        const undone=cell.chat[indexes.at(-1)];
        if(!report&&undone?.sized&&undone.previousSize){cell.height=undone.previousSize.height||0;cell.fit=!!undone.previousSize.fit&&!!cell.height;cell.span=undone.previousSize.span||cell.span;}
        cell.chat.splice(previous+1);
        const before=previous>=0?cell.chat[previous]:null;
        // A regenerated prompt with the same words may not have run yet; reuse the result of an identical earlier prompt.
        const snapshot=before&&[...cell.chat].reverse().find(message=>message.kind==='prompt'&&message.text===before.text&&(report?message.theme:message.recipe));
        cell.prompt=before?.text||'';
        if(report){if(!(before&&cell.themePrompt===before.text)){cell.theme=snapshot?.theme||null;cell.themePrompt=snapshot?before.text:'';}}
        else if(before&&cell.recipe&&cell.recipePrompt===before.text){/* the cell already shows this prompt's result */}
        else if(snapshot){
            cell.recipe=snapshot.recipe;cell.recipePrompt=before.text;
            state.busy.set(cellId,t('正在恢复上一个结果…','Restoring the previous result…'));render();
            try{await AiReportRunner.run(cell,state.doc.reportMonth,{withNarrative:false,style:styleOf(cell)});if(snapshot.narrative)cell.output={...cell.output,narrative:snapshot.narrative,narrativeMonth:snapshot.narrativeMonth||''};}catch(_){/* the error stays on the cell output */}
            finally{state.busy.delete(cellId);}
        }else{cell.recipe=null;cell.recipePrompt='';cell.output=null;cell.missing=undefined;}
        chat.reveal(cellId,Math.max(0,previous));render();
        status(previous>=0?t('已撤回到上一个最终提示词','Reverted to the previous final prompt'):t('已撤回，格子回到空白','Undone; the cell is blank again'));
    }
    // A hand-edited prompt is kept as a new prompt (so undo returns to the previous wording) and generated right away.
    function savePromptEdit(cellId,text){
        return aiStep(cellId,t('正在按修改后的提示词生成…','Generating from the edited prompt…'),async cell=>{
            if(text!==cell.prompt){cell.prompt=text;cell.chat.push({role:'ai',kind:'prompt',text,edited:true});}
            await (cellId===REPORT?applyStyle(cell):imageSlotOf(cellId)?drawImage(cellId,cell):fieldKeyOf(cellId)?generateField(fieldKeyOf(cellId)):chapterOf(cellId)?applyChapterStyle(cellId,cell):compileAndRun(cellId,cell));
        });
    }
    // --- In-cell text edits ----------------------------------------------------------------------------------------
    // Double-click generated text to edit it in place. The AI decides whether the change is a fixed replacement or a
    // wording rule and writes it into the final prompt (a new prompt, so undo works); then the summary alone, or the
    // whole content, is regenerated from it.
    const TEXT_NODES='p,td,th,li,h1,h2,h3,h4,h5,h6,dt,dd,caption,span,div,b,strong,em,small';
    function editableText(target){
        const body=target.closest?.('.air-cell-body');if(!body||state.preview)return null;
        if(target.closest('svg,canvas,button,input,textarea,select,[data-widget-chart],.kit-widget-chart,.kit-slot-tag,.kit-slot-edge,.kit-slot-badge,.air-ask,.air-error,.air-note,.air-skeleton,.kit-drill-bar'))return null;
        const node=target.closest(TEXT_NODES);
        if(!node||!body.contains(node)||node===body||!node.innerText.trim())return null;
        // A box holding blocks (rows, paragraphs, tables) is layout, not a piece of text.
        return [...node.children].some(child=>/^(DIV|P|TABLE|UL|OL|SECTION|ARTICLE)$/.test(child.tagName))?null:node;
    }
    const textKind=node=>node.closest('th')?'表头':node.closest('td')?'表格单元格':node.closest('li')?'列表项':node.matches('h1,h2,h3,h4,h5,h6,caption,.kit-title')?'标题':node.closest('[class*="kit-kpi"]')?'指标卡':'文字';
    function startTextEdit(node){
        const cellId=node.closest('[data-cell]')?.dataset.cell,cell=find(cellId)?.cell;
        if(!cell?.prompt||!cell.output||state.busy.has(cellId))return;
        const before=node.innerText.trim(),html=node.innerHTML,selection=getSelection(),range=selection.rangeCount?selection.getRangeAt(0).cloneRange():null;
        try{node.contentEditable='plaintext-only';}catch(_){node.contentEditable='true';}node.spellcheck=false;node.classList.add('air-text-editing');node.focus();
        if(range&&node.contains(range.commonAncestorContainer)){selection.removeAllRanges();selection.addRange(range);}
        let done=false;
        const finish=commit=>{
            if(done)return;done=true;node.removeEventListener('keydown',keys);node.removeEventListener('blur',blur);node.removeAttribute('contenteditable');node.classList.remove('air-text-editing');
            const after=node.innerText.replace(/\s+\n/g,'\n').trim();
            if(!commit||after===before){node.innerHTML=html;return;}
            editCellText(cellId,{place:node.closest('.air-narrative')?'narrative':'content',kind:textKind(node),before,after});
        };
        const keys=event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish(false);}else if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();finish(true);}};
        const blur=()=>finish(true);
        node.addEventListener('keydown',keys);node.addEventListener('blur',blur);
    }
    function editCellText(cellId,edit){
        return aiStep(cellId,t('正在把你的修改写进提示词…','Writing your edit into the prompt…'),async cell=>{
            // The edited summary shows at once; numbers and the rest follow from the regenerated content.
            if(edit.place==='narrative'&&cell.output?.narrative){cell.output={...cell.output,narrative:{...cell.output.narrative,[state.lang==='en'?'en':'zh']:edit.after}};render();}
            const reply=await AiReportTrace.post(cellId,t('把文字修改写进提示词','Write text edit into the prompt'),'/api/ai-report/cell/text-edit',{month:state.doc.reportMonth,prompt:cell.prompt,...edit,dataNames:dataNamesOf(cell.recipe)});
            const summaryOnly=edit.place==='narrative'&&!!cell.recipe?.narrative&&cell.recipePrompt===cell.prompt;
            cell.chat.push({role:'user',text:t(`（在格子里修改）${reply.change}`,`(Edited in the cell) “${edit.before}” → “${edit.after}”`)});
            cell.chat.push({role:'ai',kind:'answer',text:`${reply.mode==='replace'?t('按明确替换处理','Fixed replacement'):t('按表述优化处理','Wording refinement')}：${reply.note}`});
            cell.prompt=reply.prompt;cell.chat.push({role:'ai',kind:'prompt',text:reply.prompt,edited:true});
            if(!summaryOnly)return compileAndRun(cellId,cell);
            cell.recipePrompt=cell.prompt;state.busy.set(cellId,t('AI 正在写总结…','AI is writing the summary…'));render();
            cell.output=await AiReportRunner.narrative(cell,state.doc.reportMonth,styleOf(cell));rememberResult(cell);
        });
    }
    // --- Sub-block (layout slot) sizing --------------------------------------------------------------------------
    // Slots are sized by the platform: dragging applies the exact size at once (no AI call), records it on the cell,
    // and keeps the final prompt's layout line in sync so later generations reuse the same slot ids.
    const LAYOUT_MARK='【格子内部布局】';
    const slotsOf=row=>[...row.children].filter(child=>child.matches('.kit-slot[data-slot]'));
    const slotTitle=slot=>slot.dataset.slotTitle||slot.querySelector('.kit-title')?.textContent.trim()||'';
    function decorateSlots(){
        for(const slot of reportRoot.querySelectorAll('.air-cell .kit-slot[data-slot]')){
            if(slot.querySelector(':scope>.kit-slot-tag'))continue;
            const siblings=slotsOf(slot.parentElement),last=siblings.at(-1)===slot;
            slot.insertAdjacentHTML('beforeend',`<span class="kit-slot-tag">${esc(slot.dataset.slot)}${slotTitle(slot)?' · '+esc(slotTitle(slot)):''}</span>${last?'':`<span class="kit-slot-edge kit-slot-edge-x" data-slot-resize="x" title="${esc(t('拖动调整这个小格子的宽度','Drag to change this block\'s width'))}"></span>`}<span class="kit-slot-edge kit-slot-edge-y" data-slot-resize="y" title="${esc(t('拖动调整这个小格子的高度，双击恢复自动高度','Drag to change this block\'s height; double-click for auto height'))}"></span>`);
        }
    }
    function startSlotResize(event,handle){
        const slot=handle.closest('[data-slot]'),cellNode=slot.closest('[data-cell]'),cell=find(cellNode?.dataset.cell)?.cell;if(!cell)return;
        event.preventDefault();event.stopPropagation();checkpoint();
        const axis=handle.dataset.slotResize,row=slot.parentElement,slots=slotsOf(row),index=slots.indexOf(slot),rects=slots.map(item=>item.getBoundingClientRect());
        const weights=slots.map(item=>parseFloat(getComputedStyle(item).flexGrow)||1),total=weights.reduce((sum,value)=>sum+value,0);
        const startX=event.clientX,startY=event.clientY,badge=document.createElement('span');badge.className='kit-slot-badge';slot.append(badge);
        const others=rects.filter((_,i)=>i!==index).map(rect=>Math.round(rect.height));
        slot.classList.add('is-sizing');document.body.classList.add('air-slot-sizing');
        let height=Math.round(rects[index].height);
        // A fixed-size cell grows with its blocks (never below the size it had), instead of squeezing them back.
        const body=cellNode.querySelector('.air-cell-body'),cellStart=cell.fit?Math.round(cellNode.getBoundingClientRect().height):0;
        const growCell=()=>{if(!cellStart)return;const over=contentHeight(body)-28-body.clientHeight,next=Math.max(cellStart,Math.round(cellNode.getBoundingClientRect().height+over));cellNode.style.height=next+'px';};
        let frame=0,lastMove=null;
        const move=moveEvent=>{lastMove=moveEvent;if(!frame)frame=requestAnimationFrame(()=>{frame=0;applyMove(lastMove);});};
        const applyMove=moveEvent=>{
            if(axis==='x'){
                const next=index+1,pairPx=rects[index].width+rects[next].width,pairWeight=weights[index]+weights[next];
                const px=Math.max(pairPx*0.12,Math.min(pairPx*0.88,rects[index].width+moveEvent.clientX-startX));
                let share=px/pairPx*pairWeight/total*100;const round=Math.round(share/5)*5;if(Math.abs(round-share)<=1.2)share=round;
                const weight=share/100*total;weights[index]=weight;weights[next]=pairWeight-weight;
                slots[index].style.flex=`${weights[index]} 1 0`;slots[next].style.flex=`${weights[next]} 1 0`;
                badge.textContent=`${Math.round(share)}% · ${Math.round(weights[next]/total*100)}%`;
            }else{
                height=Math.max(60,Math.min(1600,Math.round(rects[index].height+moveEvent.clientY-startY)));
                const near=others.find(other=>Math.abs(other-height)<=8);if(near)height=near;
                slot.style.height=height+'px';slot.classList.add('has-height');AiReportLayout.fitCharts(slot,height);growCell();
                badge.textContent=`${height}px${near?' · '+t('与相邻对齐','aligned'):''}`;
            }
        };
        const up=()=>{
            if(frame){cancelAnimationFrame(frame);frame=0;applyMove(lastMove);}
            removeEventListener('pointermove',move);removeEventListener('pointerup',up);document.body.classList.remove('air-slot-sizing');
            cell.layout={...cell.layout};
            if(axis==='x')slots.forEach((item,i)=>{cell.layout[item.dataset.slot]={...cell.layout[item.dataset.slot],width:Math.round(weights[i]/total*100)};});
            else cell.layout[slot.dataset.slot]={...cell.layout[slot.dataset.slot],height};
            const box=cellNode.getBoundingClientRect();
            if(cellStart&&Math.round(box.height)!==cell.height){cell.height=Math.round(box.height);refreshSizeConstraint(cell,{span:cell.span,width:Math.round(box.width),height:cell.height});}
            syncLayoutPrompt(cell,cellNode);render();
        };
        addEventListener('pointermove',move);addEventListener('pointerup',up);
    }
    function layoutLine(cell,cellNode){
        const parts=[...cellNode.querySelectorAll('.kit-slot[data-slot]')].map(slot=>{
            const size=cell.layout[slot.dataset.slot]||{},row=slotsOf(slot.parentElement),weights=row.map(item=>parseFloat(getComputedStyle(item).flexGrow)||1);
            const width=size.width||Math.round((parseFloat(getComputedStyle(slot).flexGrow)||1)/weights.reduce((sum,value)=>sum+value,0)*100);
            return `${slot.dataset.slot}${slotTitle(slot)?'（'+slotTitle(slot)+'）':' '}宽 ${width}%、${size.height?`高 ${size.height}px`:'高度自动'}`;
        });
        return `${LAYOUT_MARK}内容按命名小格子排版，尺寸由平台精确控制。重新生成时必须用 kit.layout 和同样的小格子 id（render 里不要再给它们写宽高）：${parts.join('；')}。`;
    }
    function syncLayoutPrompt(cell,cellNode){
        const line=layoutLine(cell,cellNode),next=`${String(cell.prompt||'').replace(new RegExp(`\\n*${LAYOUT_MARK}[^\\n]*`,'g'),'').trim()}\n${line}`;
        const latest=cell.chat[promptIndexes(cell).at(-1)];
        if(latest&&latest.text===cell.prompt)latest.text=next;if(cell.recipePrompt===cell.prompt)cell.recipePrompt=next;cell.prompt=next;
        const note=t(`已按你的调整固定小格子尺寸：${line.split('）：').pop().replace(/。$/,'')}。最终提示词已同步，不需要重新生成。`,'Block sizes applied and synced to the final prompt; no regeneration needed.');
        const last=cell.chat.at(-1);
        if(last?.kind==='answer'&&last.text.startsWith(t('已按你的调整固定小格子尺寸','Block sizes applied')))last.text=note;else cell.chat.push({role:'ai',kind:'answer',text:note});
    }
    // After a regeneration, sizes for slots the new content no longer has are dropped (and said so).
    function reconcileLayout(cell){
        const present=AiReportLayout.slotsIn(cell.output?.html),missing=Object.keys(cell.layout||{}).filter(slot=>!present.includes(slot));
        if(!missing.length)return;
        cell.layout=Object.fromEntries(Object.entries(cell.layout).filter(([slot])=>present.includes(slot)));
        cell.chat.push({role:'ai',kind:'note',text:t(`新生成的内容里没有这些小格子，对应的尺寸设置已移除：${missing.join('、')}。`,`These blocks are gone from the new content; their sizes were removed: ${missing.join(', ')}.`)});
    }

    // --- Forced size -------------------------------------------------------------------------------------------
    const SIZE_MARK='【尺寸约束】';
    function sizeConstraint(size,abbreviation,mode='shrink'){
        const fill=mode==='grow'
            ?'内容要充分利用这个空间，不要留下大块空白：图表放大到合适高度，可显示数值标签、增加坐标轴刻度或补充图例；表格可多显示几行或几列；文字总结可稍详细（两到四句）；但同样不能超出边界。'
            :`请用紧凑展示：日期缩短为 MM-DD 或 M/D；减少坐标轴刻度；收紧图表边距，图例放在顶部单行或省略；长标签${abbreviation?`按此规则缩写：${abbreviation}`:'倾斜或截断，悬停提示中显示全称'}；文字总结控制在一到两句。`;
        return `${SIZE_MARK}格子宽 ${size.span}/12 栏${size.width?`（约 ${size.width}px）`:''}、高 ${size.height}px。全部内容（图表、表格、文字）必须在这个空间内完整显示，不能超出上下左右边界。${fill}`;
    }
    // Height the content really needs: the lowest bottom edge of the cell body's blocks, plus the cell's padding.
    function contentHeight(body){
        if(!body)return 0;const top=body.getBoundingClientRect().top;
        return Math.round(Math.max(0,...[...body.children].map(child=>child.getBoundingClientRect().bottom-top))+28);
    }
    // Content that cannot use a wider cell: its charts, tables and cards stop well short of the right edge.
    function underfilledWidth(body){
        if(!body)return false;const box=body.getBoundingClientRect();
        const blocks=[...body.querySelectorAll('svg,table,img,canvas,.kit-kpi,.kit-legend')].filter(element=>element.offsetParent);
        if(!blocks.length)return false;
        return Math.max(...blocks.map(element=>element.getBoundingClientRect().right))-box.left<box.width*0.85;
    }
    // Narrow cells (4/12 or less) stack everything: the final prompt says so in a platform-kept line that goes away when
    // the cell is widened, and the page stacks narrow cells' blocks by itself whatever the recipe wrote (CSS).
    const NARROW_MARK='【窄格子布局】',NARROW_SPAN=4;
    function syncNarrowLayout(cell){
        if(!cell?.prompt||!cell.span)return;
        const without=String(cell.prompt).replace(new RegExp(`\\n*${NARROW_MARK}[^\\n]*`,'g'),'').trim();
        const next=cell.span<=NARROW_SPAN?`${without}\n${NARROW_MARK}格子较窄（${cell.span}/12 栏）：标题、图表、表格、文字总结等所有内容必须从上到下排列，一行只放一个内容块，不要左右并排；用 kit.layout 时每行只放一个小格子。`:without;
        if(next===cell.prompt)return;
        const latest=cell.chat[promptIndexes(cell).at(-1)];
        if(latest&&latest.text===cell.prompt)latest.text=next;if(cell.recipePrompt===cell.prompt)cell.recipePrompt=next;cell.prompt=next;
    }
    const withConstraint=(prompt,constraint)=>`${String(prompt||'').replace(new RegExp(`\\n*${SIZE_MARK}[^\\n]*`,'g'),'').trim()}\n${constraint}`;
    // Long category names that will not fit once the cell is small; the user decides how to abbreviate them.
    function longLabels(cell){
        const names=new Set();
        for(const widget of cell.output?.widgets||[]){
            if(widget.type!=='chart')continue;const option=widget.spec?.option||widget.spec||{};
            for(const axis of [].concat(option.xAxis||[],option.yAxis||[]))for(const item of axis?.data||[])names.add(String(item?.value??item));
            for(const series of [].concat(option.series||[]))for(const item of series?.data||[])if(item&&typeof item==='object'&&item.name)names.add(String(item.name));
        }
        return [...names].filter(name=>name.length>6).slice(0,3);
    }
    const RULE_CHOICES=()=>[t('加入整体提示词','Add to the report prompt'),t('只用于这个格子','Only this cell')];
    // Adds one item to the report-wide prompt as a new version (undo in the style chat brings the old one back); an
    // applied style stays applied, since rules do not change the theme.
    function addReportRule(rule){
        const style=state.doc.style,before=style.prompt,next=M.applyStyleChanges(before,[{action:'add',section:rule.section,item:rule.item}]).prompt;
        if(next===before)return false;
        style.prompt=next;style.chat.push({role:'ai',kind:'prompt',text:next,edited:true});if(style.themePrompt===before)style.themePrompt=next;
        return true;
    }
    const ABBREVIATION_CHOICES=()=>[t('自动缩写，悬停显示全称','Abbreviate automatically, full name on hover'),t('只保留最后一级（如“埃及代表处”）','Keep only the last level'),t('去掉前缀（如“ORG:”）','Drop prefixes such as “ORG:”'),t('我自己定规则','I will write the rule')];
    // After a resize the AI waits a moment: a bar at the cell's bottom counts down, adjusting again pauses it (the size
    // from before the first drag is kept for undo), and “立即生成” / “撤销调整” skip the wait.
    const SETTLE_MS=2500,settling=new Map();
    function scheduleSize(cellId,size,before,mode){
        const previous=settling.get(cellId);clearTimeout(previous?.timer);
        const entry={size,before:previous?.before||before,mode,until:Date.now()+SETTLE_MS};
        entry.timer=setTimeout(()=>settleNow(cellId),SETTLE_MS);settling.set(cellId,entry);render();
    }
    function settleNow(cellId){
        const entry=settling.get(cellId);if(!entry)return;clearTimeout(entry.timer);settling.delete(cellId);render();
        sizeChanged(cellId,entry.size,entry.before,entry.mode);
    }
    function pauseSettling(cellId){const entry=settling.get(cellId);if(entry){clearTimeout(entry.timer);entry.timer=0;entry.until=0;}return entry;}
    function cancelSettling(cellId){const entry=settling.get(cellId);if(!entry)return;clearTimeout(entry.timer);settling.delete(cellId);}
    function undoSettling(cellId){
        const entry=settling.get(cellId),cell=find(cellId)?.cell;if(!entry||!cell)return;cancelSettling(cellId);
        checkpoint();cell.span=entry.before.span;cell.height=entry.before.height;cell.fit=entry.before.fit;render();
        status(t('已撤销尺寸调整','Size change undone'));
    }
    const paintSettlingPaused=node=>{const bar=node.querySelector('.air-settle');if(bar){bar.classList.add('is-paused');bar.querySelector('span').textContent=t('调整中…松手后按新尺寸重新生成','Adjusting… regenerates after you let go');}};
    function paintSettling(){
        for(const [cellId,entry] of settling){
            const node=reportRoot.querySelector(`[data-cell="${CSS.escape(cellId)}"]`);if(!node)continue;
            const left=Math.max(0,entry.until-Date.now()),paused=!entry.until;
            const bar=document.createElement('div');bar.className='air-settle'+(paused?' is-paused':'');
            bar.innerHTML=`<span>${paused?t('调整中…松手后按新尺寸重新生成','Adjusting… regenerates for the new size after you let go'):t('即将按新尺寸重新生成，可以继续调整','Regenerating for the new size shortly — keep adjusting if needed')}</span><button type="button" data-settle-now="${esc(cellId)}">${t('立即生成','Now')}</button><button type="button" data-settle-undo="${esc(cellId)}">${t('撤销调整','Undo')}</button><i style="animation-duration:${left}ms"></i>`;
            node.append(bar);
        }
    }
    function sizeChanged(cellId,size,before,mode='shrink'){
        const cell=find(cellId)?.cell;if(!cell)return;
        cell.pendingSize={size,before,mode};select(cellId);
        const names=mode==='shrink'?longLabels(cell):[];
        if(names.length&&!cell.abbreviation){
            cell.chat.push({role:'ai',kind:'ask',purpose:'abbr',text:t(`格子缩小到 宽约 ${size.width}px、高 ${size.height}px 后，有些名称比较长（如“${names.join('”“')}”）。要怎么缩写？`,`At ${size.width}×${size.height}px some names are long (e.g. “${names.join('”, “')}”). How should they be shortened?`),choices:ABBREVIATION_CHOICES()});
            render();return;
        }
        return applySize(cellId);
    }
    function applySize(cellId){
        return aiStep(cellId,t('正在按新尺寸重新生成…','Regenerating for the new size…'),async cell=>{
            // The pending size is not saved with the report; after a reload the cell's current size stands in.
            const {size,before,mode='shrink'}=cell.pendingSize||{size:{span:cell.span,width:Math.round(reportRoot.querySelector(`[data-cell="${CSS.escape(cellId)}"]`)?.getBoundingClientRect().width||0),height:cell.height},before:{}};delete cell.pendingSize;
            const next=withConstraint(cell.prompt,sizeConstraint(size,cell.abbreviation,mode));
            const how=mode==='grow'?t('内容会放大并充分利用新空间（更高的图表、数值标签、更多行列、稍详细的总结）','content will grow to use the new space'):t(`日期缩短、坐标轴和边距压缩、长名称${cell.abbreviation?'按“'+cell.abbreviation+'”缩写':'截断并悬停显示全称'}、总结控制在一两句`,'compact dates, axes and margins');
            cell.chat.push({role:'ai',kind:'answer',text:t(`已把格子固定为 宽 ${size.span}/12${size.width?`（约 ${size.width}px）`:''}、高 ${size.height}px，并把尺寸要求写进最终提示词：${how}。正在按新尺寸重新生成…`,`Fixed the cell at ${size.span}/12 (~${size.width}px) × ${size.height}px and added the size to the final prompt: ${how}. Regenerating…`)});
            cell.chat.push({role:'ai',kind:'prompt',text:next,sized:true,previousSize:before});cell.prompt=next;
            await compileAndRun(cellId,cell);
        });
    }
    // Growing a fixed cell only refreshes the numbers in the constraint; the content already fits.
    function refreshSizeConstraint(cell,size){
        if(!cell.prompt.includes(SIZE_MARK))return;
        const next=withConstraint(cell.prompt,sizeConstraint(size,cell.abbreviation,/充分利用这个空间/.test(cell.prompt)?'grow':'shrink')),latest=cell.chat[promptIndexes(cell).at(-1)];
        if(latest&&latest.text===cell.prompt)latest.text=next;if(cell.recipePrompt===cell.prompt)cell.recipePrompt=next;cell.prompt=next;
    }
    // Charts in a fixed cell give up or take height until the content matches the cell (the regenerated recipe then
    // lays it out properly).
    function fitCells(){
        for(const node of reportRoot.querySelectorAll('.air-cell.is-fit')){
            const body=node.querySelector('.air-cell-body');if(!body)continue;
            const overflow=contentHeight(body)-28-body.clientHeight;if(Math.abs(overflow)<=4)continue;
            // Charts in blocks the user sized keep that size.
            const charts=[...node.querySelectorAll('.kit-widget-chart')].filter(element=>element.offsetParent&&!element.closest('.kit-slot.has-height'));if(!charts.length)continue;
            const each=Math.ceil(overflow/charts.length)+(overflow>0?2:0);
            for(const element of charts)element.style.height=Math.max(110,Math.min(1200,element.offsetHeight-each))+'px';
        }
    }
    function makePrompt(cellId){return aiStep(cellId,t('正在总结对话，生成最终提示词…','Summarizing into the final prompt…'),cell=>writePrompt(cellId,cell));}
    function tryPrompt(cellId){return aiStep(cellId,t('正在把提示词变成配方…','Turning the prompt into a recipe…'),cell=>cellId===REPORT?applyStyle(cell):imageSlotOf(cellId)?drawImage(cellId,cell):fieldKeyOf(cellId)?generateField(fieldKeyOf(cellId)):chapterOf(cellId)?applyChapterStyle(cellId,cell):compileAndRun(cellId,cell));}
    async function runCell(cellId,{withNarrative=true}={}){
        const cell=find(cellId)?.cell;if(!cell?.recipe)return;
        state.busy.set(cellId,t('正在计算本月数据…','Computing this month…'));render();
        try{await AiReportRunner.run(cell,state.doc.reportMonth,{withNarrative,style:styleOf(cell)});}catch(error){AiReportTrace.note(cellId,t('用本月数据重新计算：失败','Recompute with this month: failed'),error.message||String(error),{error:true});/* the error is also kept on the cell output */}
        finally{state.busy.delete(cellId);render();}
    }
    // Cells that read other cells (overviews, navigation) run after everything they read.
    // Cells run two at a time; each has its own recipe, sandbox and output, so they never affect one another. Cells the
    // AI is already working on are left alone. chapterId limits the run to one chapter.
    async function runAll({withNarrative=false,chapterId=''}={}){
        const scope=chapterId?state.doc.chapters.find(chapter=>chapter.id===chapterId)?.cells||[]:M.cells(state.doc);
        const cells=scope.filter(cell=>cell.recipe&&!state.busy.has(cell.id));if(!cells.length)return 0;
        for(const cell of cells)state.busy.set(cell.id,t('等待更新…','Queued…'));render();
        const queue=cells.filter(cell=>!AiReportRunner.readsReport(cell)),later=cells.filter(cell=>AiReportRunner.readsReport(cell));
        await Promise.all([0,1].map(async()=>{while(queue.length){const cell=queue.shift();await runCell(cell.id,{withNarrative}).catch(()=>{});}}));
        for(const cell of later)await runCell(cell.id,{withNarrative}).catch(()=>{});
        rememberReportInputs();
        return cells.length;
    }
    async function refreshCells(chapterId=''){
        if(!state.doc.reportMonth)return status(t('请先选择报告月份','Pick the report month first'));
        const count=await runAll({withNarrative:true,chapterId});if(!chapterId)await generateFields();
        const failed=(chapterId?state.doc.chapters.find(chapter=>chapter.id===chapterId)?.cells||[]:M.cells(state.doc)).filter(cell=>cell.recipe&&cell.output?.error).length;
        status(!count?t('没有可以刷新的格子（还没生成，或正在处理中）','No cells to refresh'):failed?t(`已刷新 ${count} 个格子，其中 ${failed} 个出错，点开格子可以看原因`,`Refreshed ${count} cells; ${failed} failed`):t(`已用 ${state.doc.reportMonth} 的数据刷新 ${count} 个格子`,`Refreshed ${count} cells with ${state.doc.reportMonth} data`));
    }
    // When what a reading cell sees changes (another cell's result, a chapter title, cells moved), it recomputes on
    // its own; if it reads results, its summary is marked for updating, like after a month change.
    const reportInputs=new Map();let followTimer=0;
    const inputOf=cell=>JSON.stringify(cell.recipe.sources.filter(source=>source.kind==='report').map(source=>AiReportRunner.reportInput(cell,source)));
    function rememberReportInputs(){for(const cell of M.cells(state.doc))if(AiReportRunner.readsReport(cell))reportInputs.set(cell.id,inputOf(cell));}
    function followReport(){
        clearTimeout(followTimer);
        followTimer=setTimeout(async()=>{
            for(const cell of M.cells(state.doc).filter(item=>AiReportRunner.readsReport(item)&&item.output&&!state.busy.has(item.id))){
                const input=inputOf(cell),before=reportInputs.get(cell.id);reportInputs.set(cell.id,input);
                if(before===undefined||before===input)continue;
                state.busy.set(cell.id,t('正在根据其他格子重新计算…','Recomputing from the other cells…'));render();
                try{const hadSummary=!!cell.output?.narrativeMonth;await AiReportRunner.run(cell,state.doc.reportMonth,{withNarrative:false,style:styleOf(cell)});if(hadSummary&&AiReportRunner.readsResults(cell))cell.output={...cell.output,narrativeMonth:''};}catch(_){/* the error stays on the cell */}
                finally{state.busy.delete(cell.id);render();}
            }
        },400);
    }
    async function updateNarratives(){
        for(const cell of staleCells()){
            state.busy.set(cell.id,t('AI 正在写总结…','AI is writing the summary…'));render();
            try{cell.output=await AiReportRunner.narrative(cell,state.doc.reportMonth,styleOf(cell));}catch(error){status(error.message);}
            finally{state.busy.delete(cell.id);render();}
        }
    }

    // Template text edits apply to the current language on blur; structure edits re-render.
    function applyEdit(field,value){
        const doc=state.doc,tpl=doc.template,[kind,id]=field.split(':');
        const target=kind==='title'?tpl.title:kind==='subtitle'?tpl.subtitle:kind==='footer'?tpl.footer:kind==='chapter'?doc.chapters.find(item=>item.id===id)?.title:kind==='meta-label'?tpl.meta.find(item=>item.id===id)?.label:kind==='meta-value'?tpl.meta.find(item=>item.id===id)?.value:null;
        if(!target||target[state.lang]===value)return;
        checkpoint();target[state.lang]=value;
        // Typing over a header field means “use this text”: its prompt becomes fixed text (Chinese is the prompt's language).
        const record=tpl.fields?.[field];
        if(record?.prompt&&(M.fixedText(record.prompt)===null||state.lang==='zh')){const text=M.FIXED_PREFIX+(target.zh||value);record.prompt=text;record.appliedPrompt=text;record.chat.push({role:'ai',kind:'prompt',text,edited:true});}
        status();toolbar();
    }
    // --- Header fields as prompts ----------------------------------------------------------------------------------
    // Each header field has its own conversation (opened from its ✦) whose final prompt is fixed text, or a prompt the AI
    // fills in for the report month. Generated fields follow month changes and full refreshes.
    const busyFields=new Set();
    function headerField(key){
        const tpl=state.doc.template,[kind,id]=key.split(':'),item=kind==='meta-value'?tpl.meta.find(entry=>entry.id===id):null;
        const target=kind==='title'?tpl.title:kind==='subtitle'?tpl.subtitle:kind==='footer'?tpl.footer:item?.value;
        const label=kind==='title'?t('标题','Title'):kind==='subtitle'?t('副标题','Subtitle'):kind==='footer'?t('页脚','Footer'):M.text(item?.label,state.lang)||t('字段','Field');
        return target?{target,label}:null;
    }
    async function generateField(key){
        const field=headerField(key),record=state.doc.template.fields?.[key],prompt=record?.prompt;if(!field||!prompt)return;
        const fixed=M.fixedText(prompt);
        if(fixed!==null){if(field.target.zh!==fixed){checkpoint();if(field.target.en===field.target.zh||!field.target.en)field.target.en=fixed;field.target.zh=fixed;}record.appliedPrompt=prompt;render();return;}
        busyFields.add(key);render();
        try{
            const reply=await AiReportTrace.post(FIELD+key,t(`生成开头字段：${field.label}`,`Header field: ${field.label}`),'/api/ai-report/template/field',{month:state.doc.reportMonth,label:field.label,prompt,current:{zh:field.target.zh,en:field.target.en},title:M.text(state.doc.template.title,'zh'),outline:AiReportRunner.outline(null)});
            checkpoint();field.target.zh=reply.zh;field.target.en=reply.en;record.appliedPrompt=prompt;
        }catch(error){record.chat.push({role:'ai',kind:'note',text:t(`生成失败：${error.message}。可以在对话里补充说明后再试。`,`Generation failed: ${error.message}`)});status(t(`“${field.label}”没能生成：`,`“${field.label}” failed: `)+error.message);}
        finally{busyFields.delete(key);render();}
    }
    // --- Image conversation ----------------------------------------------------------------------------------------
    // The logo (and later pictures in cells) is changed through a conversation: fixed steps for upload, history and size
    // as buttons; anything typed goes to the AI, which picks a step or draws a new SVG from the slot's base prompt.
    const IMAGE_ACTIONS=()=>[t('上传本地图片','Upload an image'),t('从历史图片中选择','Pick from history'),t('用 AI 生成新图片','Draw a new one with AI'),t('调整显示大小','Change the size')];
    const AFTER_GENERATE=()=>[t('用这张替换','Use this one'),t('再画一张','Draw another'),t('保留原来的','Keep the current one')];
    // Every change to the picture (replace, pick, upload, size) can be undone step by step; the stack is saved with the report.
    const UNDO_LABEL=()=>t('撤回上一次更换','Undo the last change');
    const withUndo=(record,choices)=>record.undo?.length?[UNDO_LABEL(),...choices]:choices;
    const picking=new WeakSet();
    function pushUndo(record){const tpl=state.doc.template;record.undo=[...(record.undo||[]),{url:tpl.logo,width:tpl.logoWidth}].slice(-20);}
    function undoImage(cellId,record){
        const step=record.undo?.pop(),tpl=state.doc.template;
        if(!step){record.chat.push({role:'ai',kind:'answer',text:t('没有可以撤回的更换了。','Nothing to undo.'),choices:IMAGE_ACTIONS()});render();return;}
        tpl.logo=step.url;tpl.logoWidth=step.width;
        record.chat.push({role:'ai',kind:'image',text:t(`已撤回，换回上一张（宽 ${step.width}px）。`,`Undone — back to the previous picture (${step.width}px).`),images:[{url:step.url,name:'',id:''}],choices:withUndo(record,IMAGE_ACTIONS())});render();
    }
    const imageLabel=slot=>slot==='logo'?'LOGO':t('图片','image');
    function pickFile(){
        return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';input.style.display='none';
            input.addEventListener('change',()=>{resolve(input.files?.[0]||null);input.remove();},{once:true});addEventListener('focus',()=>setTimeout(()=>{if(input.isConnected&&!input.files?.length){resolve(null);input.remove();}},800),{once:true});document.body.append(input);input.click();});
    }
    async function uploadImage(file){
        const form=new FormData();form.append('file',file);const token=localStorage.getItem('tools_token');
        const response=await fetch('/api/ai-report/images',{method:'POST',body:form,credentials:'include',headers:token?{Authorization:'Bearer '+token}:{}});
        const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||t('上传失败','Upload failed'));return body;
    }
    function useImage(cellId,image){
        const slot=imageSlotOf(cellId),tpl=state.doc.template,record=tpl.images[slot];checkpoint();
        if(slot==='logo'&&tpl.logo!==image.url){pushUndo(record);tpl.logo=image.url;}record.appliedPrompt=image.prompt||'';
        record.chat.push({role:'ai',kind:'image',text:t(`已把${imageLabel(slot)}换成这张。想再改可以继续说，比如“大一点”“换成蓝绿色”；不满意可以撤回。`,`Replaced the ${imageLabel(slot)}.`),images:[{url:image.url,name:image.name||'',id:image.id||''}],choices:withUndo(record,IMAGE_ACTIONS())});render();
    }
    // The gallery keeps the usual next steps (upload, draw, size, undo) as buttons from the moment it opens.
    async function showHistory(cellId,record){await imageLibrary.show(cellId,record);const gallery=record.chat.at(-1);if(gallery?.kind==='gallery')gallery.choices=withUndo(record,IMAGE_ACTIONS().filter((_,index)=>index!==1));}
    // Drawn by the 丹青 drawing model when one is set (editing hands it the current image), otherwise as SVG.
    async function drawImage(cellId,record,{edit=false}={}){
        state.busy.set(cellId,t('AI 正在画图…','The AI is drawing…'));render();
        try{
            const image=await AiReportTrace.post(cellId,t('AI 画图','Draw image'),'/api/ai-report/image/generate',{slot:imageSlotOf(cellId),prompt:record.prompt,accent:state.doc.style.theme?.accent||'',edit,current:state.doc.template.logo});
            const by=image.engine==='image-model'?t(`绘图模型 ${image.model} ${edit?'在当前图片基础上改好了':'画好了'}，看看这张？`,`Drawn by ${image.model}.`):t('用对话模型画了一张 SVG 矢量图（还没配置绘图模型），看看这张？','Drawn as SVG by the chat model.');
            record.chat.push({role:'ai',kind:'image',text:by,images:[{url:image.url,name:image.name,id:image.id}],choices:AFTER_GENERATE()});
        }finally{state.busy.delete(cellId);}
    }
    function imageTurn(cellId,text){
        const found=find(cellId),record=found?.cell;if(!record||state.busy.has(cellId))return;
        const [upload,history,ai,size]=IMAGE_ACTIONS(),[use,again,keep]=AFTER_GENERATE();
        checkpoint();record.chat.push({role:'user',text});picking.delete(record);render();
        if(text===UNDO_LABEL())return undoImage(cellId,record);
        // The file picker must open inside the click itself, before anything is awaited.
        if(text===upload){const picked=pickFile();return aiStep(cellId,t('正在上传…','Uploading…'),async()=>{const file=await picked;if(!file){record.chat.push({role:'ai',kind:'note',text:t('没有选择文件。','No file chosen.'),choices:IMAGE_ACTIONS()});return;}useImage(cellId,await uploadImage(file));});}
        if(text===history)return aiStep(cellId,t('正在读取历史图片…','Loading images…'),()=>showHistory(cellId,record));
        if(text===ai){record.chat.push({role:'ai',kind:'ask',text:t('想要什么样的图片？可以直接描述图形、风格、颜色，或点一个开始：','Describe the picture, or pick a start:'),choices:[t('延续现在的风格，换个图形','Same style, new shape'),t('盾牌 + 网络节点，深蓝色','Shield with network nodes, navy'),t('简洁的 CS 字母徽标','A clean “CS” monogram')]});render();return;}
        if(text===size){record.chat.push({role:'ai',kind:'ask',text:t(`现在宽 ${state.doc.template.logoWidth}px，要多大？`,`Now ${state.doc.template.logoWidth}px wide. How big?`),choices:[t('小一点（100px）','Smaller (100px)'),t('标准（120px）','Standard (120px)'),t('大一点（160px）','Bigger (160px)')]});render();return;}
        const lastImage=[...record.chat].reverse().find(item=>item.kind==='image'&&item.images?.length);
        if(text===use&&lastImage){useImage(cellId,{...lastImage.images[0],prompt:record.prompt});return;}
        if(text===keep){record.chat.push({role:'ai',kind:'answer',text:t('好的，保留现在这张。','OK, keeping the current one.'),choices:IMAGE_ACTIONS()});render();return;}
        if(text===again&&record.prompt)return aiStep(cellId,t('AI 正在画图…','The AI is drawing…'),cell=>drawImage(cellId,cell));
        const width=Number((text.match(/（(\d{2,3})px）/)||[])[1]);
        if(width){if(state.doc.template.logoWidth!==width)pushUndo(record);state.doc.template.logoWidth=width;record.chat.push({role:'ai',kind:'answer',text:t(`已调整为宽 ${width}px。`,`Now ${width}px wide.`),choices:withUndo(record,IMAGE_ACTIONS())});render();return;}
        return aiStep(cellId,t('AI 正在思考…','AI is thinking…'),async cell=>{
            const reply=await AiReportTrace.post(cellId,t('图片对话','Image chat'),'/api/ai-report/image/chat',{slot:imageSlotOf(cellId),prompt:cell.prompt,chat:cell.chat.slice(0,-1),message:text,width:state.doc.template.logoWidth,accent:state.doc.style.theme?.accent||'',current:state.doc.template.logo,...imageLibrary.context(cellId)});
            if(await imageLibrary.reply(cellId,cell,reply))return;
            if(reply.type==='ask'){cell.chat.push({role:'ai',kind:'ask',text:reply.question,choices:reply.choices||[]});return;}
            if(reply.type==='upload'){cell.chat.push({role:'ai',kind:'ask',text:reply.text||t('点下面的按钮选择本地图片：','Choose a file:'),choices:[upload]});return;}
            if(reply.type==='history'){if(reply.text)cell.chat.push({role:'ai',kind:'answer',text:reply.text});await showHistory(cellId,cell);return;}
            if(reply.type==='resize'){checkpoint();if(state.doc.template.logoWidth!==reply.width)pushUndo(cell);state.doc.template.logoWidth=reply.width;cell.chat.push({role:'ai',kind:'answer',text:reply.text||t(`已调整为宽 ${reply.width}px。`,`Now ${reply.width}px wide.`),choices:withUndo(cell,IMAGE_ACTIONS())});return;}
            if(reply.type==='generate'){cell.chat.push({role:'ai',kind:'answer',text:reply.text});cell.prompt=reply.prompt;cell.chat.push({role:'ai',kind:'prompt',text:reply.prompt});await drawImage(cellId,cell,{edit:reply.edit});return;}
            cell.chat.push({role:'ai',kind:'answer',text:reply.text});
        });
    }
    // Picking in a gallery switches the picture in place (the report shows it at once) without a new message each time;
    // the last pick stays. A run of picks is one undo step, back to the picture from before the gallery.
    function pickImage(cellId,url,index){
        imageLibrary.focus(cellId,index);
        const record=find(cellId)?.cell,gallery=record?.chat[index]?.kind==='gallery'?record.chat[index]:[...(record?.chat||[])].reverse().find(message=>message.kind==='gallery'&&message.images?.some(image=>image.url===url));
        if(!record||!gallery||state.busy.has(cellId))return;
        const tpl=state.doc.template;if(tpl.logo===url&&gallery.picked===url)return;
        // A run of picks — in any gallery, until something else happens in the conversation — is one undo step.
        checkpoint();if(!picking.has(record)&&tpl.logo!==url){pushUndo(record);picking.add(record);}
        gallery.picked=url;tpl.logo=url;record.appliedPrompt='';gallery.choices=withUndo(record,IMAGE_ACTIONS().filter((_,index)=>index!==1));render();
    }
    async function generateFields(){
        const fields=state.doc.template.fields||{},keys=Object.keys(fields).filter(key=>fields[key].prompt&&M.fixedText(fields[key].prompt)===null);
        await Promise.all(keys.map(generateField));return keys.length;
    }
    function moveCell(cellId,beforeId,chapterId){
        const from=M.findCell(state.doc,cellId);if(!from||cellId===beforeId)return;
        checkpoint();from.chapter.cells.splice(from.index,1);
        const chapter=state.doc.chapters.find(item=>item.id===chapterId)||from.chapter,index=beforeId?chapter.cells.findIndex(item=>item.id===beforeId):-1;
        chapter.cells.splice(index<0?chapter.cells.length:index,0,from.cell);render();
    }
    // --- Moving cells ----------------------------------------------------------------------------------------------
    // Like rearranging home-screen icons: the card lifts and follows the pointer, a placeholder keeps its place, and the
    // cards it passes slide aside (FLIP animations) to make room; on release it settles into the gap.
    const EASE='cubic-bezier(.2,.8,.2,1)',reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Records where the cards are, changes the DOM, then animates each card from where it was to where it now is.
    function flip(nodes,change){
        const before=new Map(nodes.map(node=>[node,node.getBoundingClientRect()]));
        nodes.forEach(node=>node.getAnimations().forEach(animation=>{if(animation.id==='air-flip')animation.cancel();}));
        change();
        if(reducedMotion())return;
        // In the zoomed-out report the screen distance is scaled; the animation runs in the report's own units.
        const scale=zoom?zoom.scale:1;
        for(const node of nodes){
            const was=before.get(node),now=node.getBoundingClientRect(),dx=(was.left-now.left)/scale,dy=(was.top-now.top)/scale;
            if(Math.abs(dx)>0.5||Math.abs(dy)>0.5)node.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],{duration:340,easing:EASE}).id='air-flip';
        }
    }
    // --- Inserting and moving chapters --------------------------------------------------------------------------------
    function insertChapter(index){
        checkpoint();const chapter=M.chapter({title:M.bilingual('新章节','New chapter'),cells:[M.cell({span:12})]});
        state.doc.chapters.splice(Math.max(0,Math.min(state.doc.chapters.length,index)),0,chapter);render();
        // The new title is ready to type over.
        const title=reportRoot.querySelector(`[data-edit="chapter:${CSS.escape(chapter.id)}"]`);
        if(title){title.scrollIntoView({block:'center',behavior:reducedMotion()?'auto':'smooth'});title.focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(title);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
    }
    // Dragging a chapter zooms the whole report out so every chapter is within reach (like the home screen's edit
    // mode); chapters slide aside to make room, and on release the report zooms back in on the chapter where it landed.
    let zoom=null;
    const ZOOM_EASE='cubic-bezier(.22,1,.36,1)',ZOOM_MS=520;
    const topOffset=()=>document.documentElement.classList.contains('air-chrome-hidden')?12:(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-h'))||52)+(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--air-toolbar-h'))||52)+12;
    const applyZoom=()=>{if(zoom)Object.assign(reportRoot.style,{transformOrigin:'50% 0',transform:`translateY(${zoom.dy}px) scale(${zoom.scale})`});};
    function zoomOut(){
        const rect=reportRoot.getBoundingClientRect(),top=topOffset(),room=innerHeight-top-16;
        zoom={scale:Math.max(.12,Math.min(1,room/reportRoot.offsetHeight)),dy:top-rect.top};
        document.documentElement.style.overflow='hidden';document.body.classList.add('air-zoomed');reportRoot.classList.add('is-zoomed');
        reportRoot.style.transition=reducedMotion()?'none':`transform ${ZOOM_MS}ms ${ZOOM_EASE}`;applyZoom();
    }
    // Lands on `chapterId`: the page scrolls there under cover of the zoomed view, then the report grows back into place.
    function zoomIn(chapterId){
        if(!zoom)return;
        const rect=reportRoot.getBoundingClientRect(),naturalTop=scrollY+rect.top-zoom.dy,target=reportRoot.querySelector(`[data-chapter="${CSS.escape(chapterId)}"]`);
        document.documentElement.style.overflow='';
        const scrollTarget=Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,naturalTop+(target?target.offsetTop:0)-topOffset()));
        reportRoot.style.transition='none';zoom.dy+=scrollTarget-scrollY;applyZoom();scrollTo(0,scrollTarget);void reportRoot.offsetWidth;
        const done=()=>{zoom=null;reportRoot.style.transition='';reportRoot.style.transform='';reportRoot.style.transformOrigin='';reportRoot.classList.remove('is-zoomed');document.body.classList.remove('air-zoomed');};
        if(reducedMotion())return done();
        reportRoot.style.transition=`transform ${ZOOM_MS}ms ${ZOOM_EASE}`;reportRoot.style.transform='translateY(0) scale(1)';
        setTimeout(done,ZOOM_MS+40);
    }
    function startChapterMove(event,chapterId){
        const node=reportRoot.querySelector(`[data-chapter="${CSS.escape(chapterId)}"]`);if(!node||event.button!==0||state.preview)return;
        event.preventDefault();
        const startX=event.clientX,startY=event.clientY,style=node.getAttribute('style')||'';
        let lifted=false,placeholder=null,grab=null,home=null,pointer={x:startX,y:startY},done=false;
        const chapters=()=>[...reportRoot.querySelectorAll(':scope>.air-chapter:not(.is-lifted),:scope>.air-chapter-placeholder')];
        // Screen point → the report's own (unscaled) coordinates, whatever the zoom is at this moment of its animation.
        const local=point=>{const rect=reportRoot.getBoundingClientRect(),scale=rect.width/reportRoot.offsetWidth;return {x:(point.x-rect.left)/scale,y:(point.y-rect.top)/scale};};
        const place=()=>{const at=local(pointer);Object.assign(node.style,{left:(at.x-grab.x)+'px',top:(at.y-grab.y)+'px'});};
        function lift(){
            lifted=true;zoomOut();
            const at=local(pointer);grab={x:at.x-node.offsetLeft,y:at.y-node.offsetTop};home=node.nextElementSibling;
            placeholder=document.createElement('div');placeholder.className='air-chapter-placeholder';placeholder.style.height=node.offsetHeight+'px';node.before(placeholder);
            Object.assign(node.style,{position:'absolute',left:node.offsetLeft+'px',top:node.offsetTop+'px',width:node.offsetWidth+'px',margin:'0'});
            node.classList.add('is-lifted');document.body.classList.add('air-moving');place();
        }
        function retarget(){
            const under=document.elementFromPoint(pointer.x,pointer.y)?.closest('.air-chapter:not(.is-lifted)');
            if(!under||under.getAnimations().some(animation=>animation.id==='air-flip'))return;
            const rect=under.getBoundingClientRect(),before=pointer.y<rect.top+rect.height/2;
            let anchor=under;
            if(!before){anchor=under.nextElementSibling;while(anchor&&!anchor.matches('.air-chapter:not(.is-lifted),.air-add-chapter'))anchor=anchor.nextElementSibling;}
            if(anchor===placeholder||placeholder.nextElementSibling===anchor)return;
            flip(chapters(),()=>reportRoot.insertBefore(placeholder,anchor||null));
        }
        const move=moveEvent=>{
            pointer={x:moveEvent.clientX,y:moveEvent.clientY};
            if(!lifted){if(Math.hypot(pointer.x-startX,pointer.y-startY)<4)return;lift();}
            place();retarget();
        };
        function finish(commit){
            if(done)return;done=true;
            removeEventListener('pointermove',move);removeEventListener('pointerup',up);removeEventListener('keydown',keys,true);
            if(!lifted)return;
            if(!commit)flip(chapters(),()=>reportRoot.insertBefore(placeholder,home&&home.parentElement===reportRoot?home:null));
            const dx=placeholder.offsetLeft-node.offsetLeft,dy=placeholder.offsetTop-node.offsetTop;
            const settle=()=>{
                const index=[...reportRoot.querySelectorAll(':scope>.air-chapter:not(.is-lifted),:scope>.air-chapter-placeholder')].indexOf(placeholder);
                landing?.cancel();node.setAttribute('style',style);node.classList.remove('is-lifted');document.body.classList.remove('air-moving');placeholder.remove();
                const from=state.doc.chapters.findIndex(item=>item.id===chapterId);
                if(commit&&index>=0&&index!==from){checkpoint();const [chapter]=state.doc.chapters.splice(from,1);state.doc.chapters.splice(index,0,chapter);}
                render();zoomIn(chapterId);
            };
            const landing=reducedMotion()?null:node.animate([{transform:'none'},{transform:`translate(${dx}px,${dy}px)`}],{duration:300,easing:EASE,fill:'forwards'});
            if(landing)landing.finished.then(settle,settle);else settle();
        }
        const up=()=>finish(true),keys=keyEvent=>{if(keyEvent.key==='Escape'){keyEvent.preventDefault();keyEvent.stopPropagation();finish(false);}};
        addEventListener('pointermove',move);addEventListener('pointerup',up);addEventListener('keydown',keys,true);
    }
    function startMove(event,cellId){
        const node=reportRoot.querySelector(`[data-cell="${CSS.escape(cellId)}"]`);if(!node||event.button!==0)return;
        event.preventDefault();
        const startX=event.clientX,startY=event.clientY,home={grid:node.parentElement,next:node.nextElementSibling},style=node.getAttribute('style')||'';
        let lifted=false,rect=null,offsetX=0,offsetY=0,placeholder=null,pointer={x:startX,y:startY},scrollTimer=0,done=false;
        const cards=()=>[...reportRoot.querySelectorAll('.air-grid>.air-cell:not(.is-lifted),.air-grid>.air-cell-placeholder,.air-grid>.air-add-cell')];
        const place=()=>{node.style.transform=`translate(${pointer.x-offsetX-rect.left}px,${pointer.y-offsetY-rect.top}px) scale(1.025)`;};
        function lift(){
            lifted=true;rect=node.getBoundingClientRect();offsetX=startX-rect.left;offsetY=startY-rect.top;
            placeholder=document.createElement('div');placeholder.className='air-cell-placeholder';placeholder.style.cssText=`grid-column:${node.style.gridColumn||getComputedStyle(node).gridColumn};height:${rect.height}px`;
            node.before(placeholder);
            Object.assign(node.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',margin:'0'});
            node.classList.add('is-lifted');document.body.classList.add('air-moving');place();
            scrollTimer=setInterval(autoScroll,16);
        }
        // Over another card: take its place (cards between slide over). Over a chapter's empty end: go to the end.
        function retarget(){
            const under=document.elementFromPoint(pointer.x,pointer.y),grid=under?.closest('.air-grid');if(!grid)return;
            const target=under.closest('.air-grid>.air-cell:not(.is-lifted),.air-grid>.air-add-cell');
            if(target?.getAnimations().some(animation=>animation.id==='air-flip'))return; // a card still sliding away would bounce straight back
            const order=[...grid.children],from=order.indexOf(placeholder);
            // Over its own placeholder or a gap between cards nothing changes; only below the last card means "the end".
            const last=[...grid.querySelectorAll(':scope>.air-cell:not(.is-lifted),:scope>.air-cell-placeholder')].at(-1);
            if(!target&&last&&pointer.y<last.getBoundingClientRect().bottom)return;
            let anchor;
            if(!target||target.matches('.air-add-cell'))anchor=grid.querySelector(':scope>.air-add-cell');
            else if(placeholder.parentElement===grid&&from>=0&&from<order.indexOf(target))anchor=target.nextElementSibling;
            else anchor=target;
            if(anchor===placeholder||anchor===placeholder.nextElementSibling&&placeholder.parentElement===grid)return;
            flip(cards(),()=>grid.insertBefore(placeholder,anchor));
        }
        function autoScroll(){
            const edge=80,speed=pointer.y<edge+120?-(edge+120-pointer.y)/6:pointer.y>innerHeight-edge?(pointer.y-innerHeight+edge)/6:0;
            if(speed){scrollBy(0,speed);retarget();}
        }
        const move=moveEvent=>{
            pointer={x:moveEvent.clientX,y:moveEvent.clientY};
            if(!lifted){if(Math.hypot(pointer.x-startX,pointer.y-startY)<4)return;lift();}
            place();retarget();
        };
        function finish(commit){
            if(done)return;done=true;
            removeEventListener('pointermove',move);removeEventListener('pointerup',up);removeEventListener('keydown',keys,true);clearInterval(scrollTimer);
            if(!lifted)return;
            if(!commit)flip(cards(),()=>home.grid.insertBefore(placeholder,home.next&&home.next.parentElement===home.grid?home.next:home.grid.querySelector(':scope>.air-add-cell')));
            const target=placeholder.getBoundingClientRect();let landing=null;
            const settle=()=>{
                const grid=placeholder.parentElement,next=placeholder.nextElementSibling,moved=!(grid===home.grid&&next===home.next);
                landing?.cancel();node.setAttribute('style',style);node.classList.remove('is-lifted');document.body.classList.remove('air-moving');
                placeholder.replaceWith(node);
                if(commit&&moved)moveCell(cellId,next?.dataset.cell||null,grid.dataset.grid);else render();
            };
            if(reducedMotion())return settle();
            landing=node.animate([{transform:node.style.transform},{transform:`translate(${target.left-rect.left}px,${target.top-rect.top}px) scale(1)`}],{duration:280,easing:EASE,fill:'forwards'});
            landing.finished.then(settle,settle);
        }
        const up=()=>finish(true),keys=keyEvent=>{if(keyEvent.key==='Escape'){keyEvent.preventDefault();keyEvent.stopPropagation();finish(false);}};
        addEventListener('pointermove',move);addEventListener('pointerup',up);addEventListener('keydown',keys,true);
    }
    // Resizing snaps to the 12-column grid and to neighbouring cells, drawing a guide wherever an edge lines up.
    function startResize(event,cellId){
        const cell=find(cellId)?.cell,node=event.target.closest('.air-cell'),grid=node?.parentElement;if(!cell||!grid)return;
        event.preventDefault();checkpoint();
        const pending=pauseSettling(cellId);if(pending)paintSettlingPaused(node);
        const before={height:cell.height,fit:cell.fit,span:cell.span};let vertical=false;
        const SNAP=10,GAP=12,rect=node.getBoundingClientRect(),gridRect=grid.getBoundingClientRect(),column=(gridRect.width+GAP)/12,startX=event.clientX,startY=event.clientY;
        const left=rect.left-gridRect.left,top=rect.top-gridRect.top;
        const others=[...grid.querySelectorAll('.air-cell')].filter(item=>item!==node).map(item=>item.getBoundingClientRect());
        const xEdges=others.flatMap(other=>[other.left-gridRect.left,other.right-gridRect.left]);
        // Heights that end level with a cell in the same row, or equal another cell's height.
        const heights=others.flatMap(other=>[other.height,...(Math.abs(other.top-rect.top)<4?[other.bottom-rect.top]:[])]).filter(height=>height>=60);
        const guide=axis=>{const line=document.createElement('div');line.className='air-guide air-guide-'+axis;line.hidden=true;grid.append(line);return line;};
        const guideX=guide('x'),guideY=guide('y');
        const show=(line,position,property)=>{const key=String(Math.round(position));if(line.hidden||line.dataset.at!==key){line.classList.remove('is-snapped');void line.offsetWidth;line.classList.add('is-snapped');}line.hidden=false;line.dataset.at=key;line.style[property]=position+'px';};
        node.classList.add('is-resizing');document.body.classList.add('air-resizing');
        try{event.target.setPointerCapture?.(event.pointerId);}catch(_){/* synthetic or already released pointers */}
        // A live size badge; height moves in 10px steps unless it lines up with a neighbour.
        const STEP=10,sizeBadge=document.createElement('span');sizeBadge.className='air-size-badge';node.append(sizeBadge);
        const paintBadge=()=>{sizeBadge.textContent=`${cell.span}/12${vertical||cell.fit?` · ${cell.height}px`:''}`;};paintBadge();
        // Pointer moves are applied once per frame, so the cell keeps up with the mouse instead of queueing work.
        let frame=0,lastMove=null;
        const move=moveEvent=>{lastMove=moveEvent;if(!frame)frame=requestAnimationFrame(()=>{frame=0;applyMove(lastMove);});};
        const applyMove=moveEvent=>{
            cell.span=Math.max(1,Math.min(12,Math.round((rect.width+moveEvent.clientX-startX+GAP)/column)));
            const right=left+cell.span*column-GAP;
            if(xEdges.some(edge=>Math.abs(edge-right)<=2))show(guideX,right,'left');else guideX.hidden=true;
            node.style.gridColumn=`span ${cell.span}`;
            // The chosen height is a minimum: bigger content still grows the cell, smaller content returns to it.
            if(Math.abs(moveEvent.clientY-startY)>4){
                let height=rect.height+moveEvent.clientY-startY;
                const nearest=heights.reduce((best,target)=>Math.abs(target-height)<Math.abs(best-height)?target:best,Infinity);
                if(Math.abs(nearest-height)<=SNAP){height=nearest;show(guideY,top+height,'top');}else{guideY.hidden=true;height=Math.round(height/STEP)*STEP;}
                vertical=true;cell.height=Math.max(60,Math.min(1600,Math.round(height)));node.style[cell.fit?'height':'minHeight']=cell.height+'px';node.classList.add('has-height');
            }
            paintBadge();
        };
        // Releasing smaller than the generated content forces that size: the cell keeps it, charts shrink at once, and
        // the size becomes part of the final prompt so the next generation is designed for it.
        const up=()=>{
            if(frame){cancelAnimationFrame(frame);frame=0;applyMove(lastMove);}
            removeEventListener('pointermove',move);removeEventListener('pointerup',up);guideX.remove();guideY.remove();sizeBadge.remove();document.body.classList.remove('air-resizing');
            const body=node.querySelector('.air-cell-body'),natural=contentHeight(body),width=Math.round(node.getBoundingClientRect().width);
            const changed=vertical||cell.span!==before.span,height=vertical||cell.fit?cell.height:Math.round(node.getBoundingClientRect().height);
            const generated=changed&&cell.recipe&&cell.output&&!cell.output.error;
            // Smaller than the content, or bigger than the content can ever fill: fix the size and regenerate for it.
            const shrink=generated&&(vertical||cell.fit)&&height<natural-8;
            const grow=generated&&!shrink&&((vertical&&height>natural+40)||(cell.span>before.span&&underfilledWidth(body)));
            if(shrink||grow){cell.height=height;cell.fit=true;scheduleSize(cellId,{span:cell.span,width,height},pending?.before||before,grow?'grow':'shrink');return;}
            // Back to a size the content fits: nothing to regenerate any more.
            if(pending)cancelSettling(cellId);
            if(changed&&cell.fit)refreshSizeConstraint(cell,{span:cell.span,width,height});
            if(changed)syncNarrowLayout(cell);
            render();
        };
        addEventListener('pointermove',move);addEventListener('pointerup',up);
    }

    reportRoot.addEventListener('focusout',event=>{const field=event.target.closest('[data-edit]');if(field)applyEdit(field.dataset.edit,field.innerText.replace(/\n$/,'').trim());});
    reportRoot.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.closest('[data-edit^="chapter:"],[data-edit="title"]')){event.preventDefault();event.target.blur();}if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&event.target.closest('.air-ask textarea')){event.preventDefault();event.target.form.requestSubmit();}});
    reportRoot.addEventListener('submit',event=>{const form=event.target.closest('[data-ask]');if(!form)return;event.preventDefault();const text=form.querySelector('textarea').value.trim();if(text){state.drafts.delete(form.dataset.ask);form.querySelector('textarea').value='';converse(form.dataset.ask,text);}});
    // Links made by navigation or overview cells scroll to their chapter or cell and flash it.
    reportRoot.addEventListener('click',event=>{
        const jump=event.target.closest('a[href^="#air-"]');if(!jump)return;
        event.preventDefault();event.stopImmediatePropagation();
        const target=document.getElementById(jump.getAttribute('href').slice(1));if(!target)return;
        target.scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});
        target.classList.remove('is-jump-target');void target.offsetWidth;target.classList.add('is-jump-target');
    },true);
    reportRoot.addEventListener('click',async event=>{
        const target=event.target,data=target.closest('button')?.dataset||{};
        if(data.cellChat){select(data.cellChat);chatRoot.querySelector('textarea')?.focus();return;}
        if(data.styleChat!==undefined){select(REPORT);chatRoot.querySelector('textarea')?.focus();return;}
        if(data.cellRun)return runCell(data.cellRun);
        // Duplicate: same size, conversation, prompt, recipe and output, placed right after; its chat opens for editing.
        if(data.cellCopy){const found=find(data.cellCopy);if(!found)return;checkpoint();const source=JSON.parse(JSON.stringify(found.cell)),latest=[...source.chat].reverse().find(message=>message.kind==='prompt');const copy=M.cell({...source,id:M.uid('cell'),chat:latest?[latest]:[]});copy.missing=found.cell.missing;found.chapter.cells.splice(found.index+1,0,copy);state.selected=copy.id;render();status(t('已复制格子，可以在右侧对话里继续修改','Cell duplicated; refine it in the chat'));return;}
        if(data.cellDelete){const found=find(data.cellDelete);if(found&&(found.cell.recipe||found.cell.chat.length)&&!await AppDialog.confirm(t('删除这个格子和它的对话、配方？','Delete this cell with its conversation and recipe?'),{tone:'danger',confirmText:t('删除','Delete')}))return;checkpoint();found.chapter.cells.splice(found.index,1);if(state.selected===data.cellDelete)state.selected=null;return render();}
        if(data.addCell){checkpoint();const cell=M.cell({span:6});state.doc.chapters.find(item=>item.id===data.addCell).cells.push(cell);state.selected=cell.id;render();reportRoot.querySelector(`[data-ask="${cell.id}"] textarea`)?.focus();return;}
        if(data.insertChapter!==undefined){insertChapter(Number(data.insertChapter));return;}
        if(data.settleNow){settleNow(data.settleNow);return;}
        if(data.settleUndo){undoSettling(data.settleUndo);return;}
        if(data.refreshAll!==undefined)return refreshCells();
        if(data.chapterRefresh)return refreshCells(data.chapterRefresh);
        // Clicking the logo always brings the picker to the bottom of its conversation (history page 1 with the action
        // buttons), unless the latest message already is one.
        if(data.imageChat){
            const id=IMAGE+data.imageChat;select(id);
            const record=find(id)?.cell;
            if(record&&!state.busy.has(id)&&record.chat.at(-1)?.kind!=='gallery'){checkpoint();aiStep(id,t('正在读取历史图片…','Loading images…'),()=>showHistory(id,record));}
            return;
        }
        if(data.fieldPrompt){select(FIELD+data.fieldPrompt);chatRoot.querySelector('textarea')?.focus();return;}
        if(data.chapterStyle){select(CHAPTER+data.chapterStyle);chatRoot.querySelector('textarea')?.focus();return;}
        if(data.chapterHeading){const chapter=state.doc.chapters.find(item=>item.id===data.chapterHeading);if(chapter){checkpoint();if(chapter.heading===false)delete chapter.heading;else chapter.heading=false;render();}return;}
        if(data.chapterNumbering){const chapter=state.doc.chapters.find(item=>item.id===data.chapterNumbering);if(chapter){checkpoint();if(chapter.numbered===false)delete chapter.numbered;else chapter.numbered=false;render();}return;}
        if(data.addChapter!==undefined){checkpoint();state.doc.chapters.push(M.chapter({title:M.bilingual('新章节','New chapter'),cells:[M.cell({span:12})]}));return render();}
        if(data.chapterMove){const [id,step]=data.chapterMove.split(':'),index=state.doc.chapters.findIndex(item=>item.id===id),next=index+Number(step);if(next<0||next>=state.doc.chapters.length)return;checkpoint();const [item]=state.doc.chapters.splice(index,1);state.doc.chapters.splice(next,0,item);return render();}
        if(data.chapterDelete){if(!await AppDialog.confirm(t('删除整个章节及其中所有格子？','Delete this chapter and all its cells?'),{tone:'danger',confirmText:t('删除','Delete')}))return;checkpoint();state.doc.chapters=state.doc.chapters.filter(item=>item.id!==data.chapterDelete);return render();}
        const cellNode=target.closest('[data-cell]');
        if(cellNode&&!state.preview&&!target.closest('textarea,button,a,[contenteditable]')&&state.selected!==cellNode.dataset.cell)select(cellNode.dataset.cell);
    });
    reportRoot.addEventListener('pointerdown',event=>{followCell(event);const slotHandle=event.target.closest('[data-slot-resize]');if(slotHandle)return startSlotResize(event,slotHandle);const chapterMover=event.target.closest('[data-chapter-drag]');if(chapterMover)return startChapterMove(event,chapterMover.dataset.chapterDrag);const mover=event.target.closest('[data-cell-drag]');if(mover)return startMove(event,mover.dataset.cellDrag);const handle=event.target.closest('[data-resize]');if(handle)startResize(event,handle.dataset.resize);});
    reportRoot.addEventListener('focusin',followCell);
    reportRoot.addEventListener('dblclick',event=>{
        if(event.target.closest('[data-resize],[data-slot-resize]'))return;
        const node=editableText(event.target);if(node)startTextEdit(node);
    });
    reportRoot.addEventListener('dblclick',event=>{
        const edge=event.target.closest('[data-slot-resize="y"]'),slotNode=edge?.closest('[data-slot]'),cellNode=slotNode?.closest('[data-cell]'),slotCell=cellNode&&find(cellNode.dataset.cell)?.cell;
        if(slotCell?.layout?.[slotNode.dataset.slot]?.height){checkpoint();const {height,...rest}=slotCell.layout[slotNode.dataset.slot];slotCell.layout={...slotCell.layout,[slotNode.dataset.slot]:rest};syncLayoutPrompt(slotCell,cellNode);render();}
    });
    reportRoot.addEventListener('dblclick',event=>{const handle=event.target.closest('[data-resize]');if(!handle)return;const cell=find(handle.dataset.resize)?.cell;if(cell){checkpoint();cell.height=0;cell.fit=false;render();}});

    async function loadReports(){try{state.reports=await API.get('/api/ai-report/documents');}catch(error){state.reports=[];status(error.message);}}
    async function confirmDiscard(){return !dirty()||AppDialog.confirm(t('当前月报有未保存的修改，确定放弃吗？','This report has unsaved changes. Discard them?'),{tone:'danger',confirmText:t('放弃修改','Discard')});}
    async function openReport(id){if(!await confirmDiscard())return;state.doc=M.normalize(await API.get('/api/ai-report/documents/'+encodeURIComponent(id)));state.saved=snapshot();state.undo=[];state.selected=null;render();}
    async function newReport(month=previousMonth()){if(!await confirmDiscard())return;state.doc=M.normalize(await API.get('/api/ai-report/template?month='+month));state.saved='';state.undo=[];state.selected=null;render();}
    async function save(){
        if(!state.doc)return;$('[data-air=save]').disabled=true;
        try{const saved=M.normalize(await API.post('/api/ai-report/documents',state.doc));state.doc.id=saved.id;state.doc.updatedAt=saved.updatedAt;state.saved=snapshot();await loadReports();render();status(t('已保存到服务器','Saved to server'));}
        catch(error){status(t('保存失败：','Save failed: ')+error.message);toolbar();}
    }
    async function setMonth(month){
        if(!M.validMonth(month)||month===state.doc.reportMonth)return;
        checkpoint();state.doc.reportMonth=month;render();await runAll({withNarrative:false});await generateFields();
        if(staleCells().length)status(t('数字已按新月份更新；文字总结点“更新总结”重写','Numbers updated; use “Update summaries” to rewrite the text'));
    }
    async function renameOrCopy(copy){
        const name=await AppDialog.prompt(copy?t('另存为新的月报名称','Save as a new report named'):t('月报名称','Report name'),{defaultValue:state.doc.name});
        if(!name?.trim())return;checkpoint();state.doc.name=name.trim().slice(0,200);if(copy)state.doc.id='';render();if(copy)await save();
    }
    async function removeReport(){
        if(!state.doc.id||!await AppDialog.confirm(t(`删除月报“${state.doc.name}”？此操作不能撤销。`,`Delete report “${state.doc.name}”? This cannot be undone.`),{tone:'danger',confirmText:t('删除','Delete')}))return;
        await API.delete('/api/ai-report/documents/'+encodeURIComponent(state.doc.id));state.saved=snapshot();await loadReports();
        if(state.reports.length)await openReport(state.reports[0].id);else await newReport();
    }
    async function exportAs(kind){
        const options={lang:state.lang,t};
        try{if(kind==='html')await AiReportExport.html(state.doc,options);else if(kind==='msg')await AiReportExport.msg(state.doc,options);else{state.preview=true;state.printing=true;render();AiReportExport.print();state.printing=false;render();}}
        catch(error){status(t('导出失败：','Export failed: ')+error.message);}
    }

    $('#airMonth').addEventListener('change',event=>setMonth(event.target.value));
    $('.air-toolbar').addEventListener('click',async event=>{
        const button=event.target.closest('button');if(!button)return;const menu=button.closest('details');if(menu)menu.open=false;
        if(button.dataset.open)return openReport(button.dataset.open);
        const action=button.dataset.air;
        if(action==='new')return newReport(state.doc?.reportMonth);
        if(action==='copy')return renameOrCopy(true);
        if(action==='rename')return renameOrCopy(false);
        if(action==='delete')return removeReport();
        if(action==='save')return save();
        if(action==='preview'){state.preview=!state.preview;state.selected=null;return render();}
        if(action==='language'){state.lang=state.lang==='en'?'zh':'en';return render();}
        if(action==='narratives')return updateNarratives();
        if(action&&action.startsWith('export-'))return exportAs(action.slice(7));
    });
    document.addEventListener('click',event=>document.querySelectorAll('.air-toolbar details[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}));
    document.addEventListener('keydown',event=>{
        const editing=event.target.closest?.('input,textarea,[contenteditable]');
        if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();}
        else if((event.metaKey||event.ctrlKey)&&!event.shiftKey&&event.key.toLowerCase()==='z'&&!editing){event.preventDefault();undo();}
        else if(event.key==='Escape'&&state.selected&&!editing)select(null);
    });
    addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});

    AiReportRunner.useReport(()=>({doc:state.doc,lang:state.lang}));
    // The platform bar and the report toolbar can be folded away for more room; the choice is remembered per browser.
    const CHROME_KEY='air-chrome-hidden';
    function setChrome(hidden,remember=true){
        document.documentElement.classList.toggle('air-chrome-hidden',hidden);
        const toggle=$('[data-air=chrome]'),label=hidden?t('展开顶部栏','Show the top bars'):t('收起顶部栏','Hide the top bars');
        toggle.setAttribute('aria-pressed',String(hidden));toggle.setAttribute('aria-label',label);toggle.title=label;
        if(remember)try{localStorage.setItem(CHROME_KEY,hidden?'1':'0');}catch(_){/* storage unavailable: the choice lasts this visit */}
    }
    try{setChrome(localStorage.getItem(CHROME_KEY)==='1',false);}catch(_){setChrome(false,false);}
    $('[data-air=chrome]').addEventListener('click',()=>setChrome(!document.documentElement.classList.contains('air-chrome-hidden')));
    // The shared startup screen shows each loading step; a failed step keeps it open with the reason and a retry.
    (async()=>{
        const startup=window.ToolsPageStartup,step=(key,work)=>startup?startup.run(key,work):work();
        await step('list',loadReports).catch(()=>{});
        try{await step('report',()=>state.reports.length?openReport(state.reports[0].id):newReport());}
        catch(error){reportRoot.innerHTML=`<p class="air-error">${esc(t('月报加载失败：','Could not load the report: ')+error.message)}</p>`;}
        document.body.classList.remove('air-booting');
        await startup?.finish();
    })();
    window.AiReportApp={state,render,runAll,save,find,converse,makePrompt,tryPrompt,revertPrompt,generateField,generateFields};
})();
