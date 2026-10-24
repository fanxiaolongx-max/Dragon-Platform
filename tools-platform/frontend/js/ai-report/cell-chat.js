/* Side panel for one cell's AI conversation. Chat settles the need; a small link at the bottom summarizes it
   into the cell's final prompt, and “试一下” compiles that prompt and runs it. Reopening starts at the latest
   prompt; scrolling up loads earlier messages. */
(function(){
    'use strict';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const multiline=value=>esc(value).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/^#{1,6}\s+/gm,'').replace(/\n/g,'<br>');
    const PAGE=10;

    function create({root,t,lang,find,send,retry,makePrompt,tryPrompt,revert,savePrompt,close,pickImage=()=>{},imagePage=()=>{},removeImage=()=>{},imageDeletion=()=>{}}){
        let cellId=null,editing=null,kind='cell';const starts=new Map(),openTraces=new Set();
        const Trace=window.AiReportTrace;
        // Image chat: the current picture with the platform's base prompt (folded), and the fixed steps as buttons.
        function imageIntro(found){
            const image=found.image||{},empty=!found.cell.chat.length;
            return `<div class="air-img-current"><img src="${esc(image.url||'')}" alt=""><div><strong>${t('当前图片','Current picture')}</strong><small>${t(`显示宽度 ${image.width||120}px`,`${image.width||120}px wide`)}</small></div>${found.cell.undo?.length?`<button type="button" class="air-img-undo" data-choice="${esc(t('撤回上一次更换','Undo the last change'))}" title="${esc(t(`可撤回 ${found.cell.undo.length} 步`,`${found.cell.undo.length} step(s) to undo`))}">↶ ${t('撤回','Undo')}</button>`:''}</div><details class="air-img-base"><summary>${t('平台基础提示词（AI 画图时总会遵守）','Base prompt (always applied)')}</summary><p>${esc(image.base||'')}</p></details>${empty?`<div class="air-choices air-img-actions">${[t('上传本地图片','Upload an image'),t('从历史图片中选择','Pick from history'),t('用 AI 生成新图片','Draw a new one with AI'),t('调整显示大小','Change the size')].map(choice=>`<button type="button" data-choice="${esc(choice)}">${esc(choice)}</button>`).join('')}</div>`:''}`;
        }
        function imageLibraryView(item,index,busy){
            const review=item.kind==='image_delete',size=8,total=review?item.images.length:(item.gallery?.total??item.images?.length??0);
            const pages=review?Math.max(1,Math.ceil(total/size)):(item.gallery?.totalPages||Math.max(1,Math.ceil(total/size)));
            const page=Math.max(1,Math.min(pages,review?item.reviewPage||1:item.gallery?.page||1));
            const list=review?item.images.slice((page-1)*size,page*size):(item.images||[]).slice(0,size);
            const icon='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
            const tiles=list.map((image,position)=>`<div class="air-img-tile"><div class="air-img-thumb">${review?`<div class="air-img-pick"><img src="${esc(image.url)}" alt="${esc(image.name||'')}" loading="lazy"></div>`:`<button type="button" class="air-img-pick ${image.url===item.picked?'is-picked':''}" aria-pressed="${image.url===item.picked}" data-pick-image="${esc(image.url)}" title="${esc(image.name||'')}" ${busy?'disabled':''}><img src="${esc(image.url)}" alt="${esc(image.name||'')}" loading="lazy"></button>${String(image.id||'').startsWith('platform-')?'':`<button type="button" class="air-img-delete" data-delete-image="${esc(image.id)}" ${busy?'disabled':''} aria-label="${esc(t('从历史图库删除：','Remove from library: ')+(image.name||''))}" title="${esc(t('从历史图库删除','Remove from library'))}">${icon}</button>`}`}<span class="air-img-index">${position+1}</span></div><small class="air-img-name" title="${esc(image.name||'')}">${esc(image.name||t('未命名图片','Untitled image'))}</small></div>`).join('');
            const pager=`<div class="air-img-pagination" aria-label="${esc(t('图片分页','Image pages'))}"><button type="button" data-image-page="${page-1}" ${busy||page<=1?'disabled':''}>‹ ${t('上一页','Previous')}</button><span>${t(`第 ${page} / ${pages} 页 · 共 ${total} 张`,`Page ${page} / ${pages} · ${total} images`)}</span><button type="button" data-image-page="${page+1}" ${busy||page>=pages?'disabled':''}>${t('下一页','Next')} ›</button></div>`;
            let footer='';
            if(review){
                const proposal=item.proposal||{},expired=Date.parse(proposal.expiresAt)<=Date.now();
                const status=proposal.status==='confirmed'?t('已从历史图库删除','Removed from library'):proposal.status==='restored'?t('已撤销删除','Deletion undone'):proposal.status==='cancelled'?t('已取消删除','Deletion cancelled'):expired?t('确认已过期，请重新选择','Review expired; select again'):'';
                footer=`<div class="air-img-delete-review" role="status">${status?`<span>${status}</span>`:`<button type="button" class="air-img-confirm-delete" data-image-deletion="confirm" ${busy?'disabled':''}>${t(`确认删除这 ${total} 张`,`Confirm removal of ${total}`)}</button><button type="button" data-image-deletion="cancel" ${busy?'disabled':''}>${t('取消','Cancel')}</button>`}${proposal.status==='confirmed'?`<button type="button" data-image-deletion="restore" ${busy?'disabled':''}>↶ ${t('撤销删除','Undo deletion')}</button>`:''}</div>`;
            }else{
                // Which picture is in use (the last one picked stays), then how to page and delete by voice.
                const picked=(item.images||[]).find(image=>image.url===item.picked);
                footer=`<p class="air-img-picked">${picked?t(`正在使用：${picked.name||'这张图片'}。点别的图片可以继续切换预览；`,`In use: ${picked.name||'this picture'}. Click another to switch; `):t('点一张图片就会在月报里预览，最后选中的那张会保留；','Click a picture to preview it; the last one you pick stays; ')}${t('也可以说“下一页”“上一页”“删除本页第2张”，删除前会再次展示候选图片确认。','or say “next page” or “remove image 2 on this page” — deletion always shows a review first.')}</p>`;
            }
            return `<div class="air-img-gallery">${tiles||`<p class="air-img-empty">${t('图库暂无图片，可以上传或生成一张。','No images yet. Upload or generate one.')}</p>`}</div>${pager}${footer}`;
        }
        // The last run's error is always shown in the chat, with what to do about a dropped connection.
        function failureBanner(cell){
            const error=cell?.output?.error;if(!error||kind!=='cell')return '';
            const offline=/Failed to fetch|NetworkError|Load failed|网络/i.test(error);
            return `<div class="air-chat-failure" role="status"><strong>${t('最近一次运行失败','The last run failed')}</strong><p>${esc(error)}</p><small>${offline?t('浏览器没有连上服务器（常见于服务正在重启或网络中断），数据和提示词都没有问题；稍等后点“再试一次”或章节的 ⟳ 刷新即可。','The browser could not reach the server (often a restart or network drop). Try again shortly.'):t('可以在下面说明怎么改后重新生成；打开右上角“开发者”可以看到和 AI 来回的完整过程。','Describe the fix below, or turn on Developer mode (top right) to see every step.')}</small></div>`;
        }
        // Developer records: one group per AI request (prompts sent, replies, tools, retries) and local run steps.
        const stepTitle=(step,index)=>step.kind==='ai'?`→ ${t('模型往返','Model call')} ${index}${step.ms?` · ${(step.ms/1000).toFixed(1)}s`:''}${step.toolCalls?` · ${t('要调用工具','calls tools')}`:''}${step.error?' · ⚠ '+esc(step.error.slice(0,60)):''}`:step.kind==='tool'?`🔧 ${t('工具','Tool')} ${esc(step.name)}${step.error?' · ⚠':''}`:step.kind==='retry'?`↻ ${t('要求模型重试','Asked the model to retry')}`:esc(step.kind);
        const preview=text=>{const value=String(text||'');return esc(value.length>1500?value.slice(0,1500)+'\n…':value);};
        const tools=key=>`<span class="air-dev-tools"><button type="button" data-dev-copy="${key}">⧉ ${t('复制','Copy')}</button><button type="button" data-dev-full="${key}">⛶ ${t('全屏','Full screen')}</button></span>`;
        function traceEntry(entry){
            const time=new Date(entry.at).toLocaleTimeString(),open=openTraces.has(entry.id)?' open':'';
            if(entry.kind==='note')return `<details class="air-dev-entry${entry.error?' is-error':''}" data-trace="${entry.id}"${open}><summary><span>${time}</span> ${esc(entry.label)}</summary>${tools(entry.id)}<pre>${preview(entry.text)}</pre></details>`;
            const calls=entry.steps.filter(step=>step.kind==='ai'),used=entry.steps.filter(step=>step.kind==='tool').length,retries=entry.steps.filter(step=>step.kind==='retry').length;
            let index=0;
            const steps=entry.steps.map((step,position)=>{const key=entry.id+':'+position,inner=openTraces.has(key)?' open':'';return `<details class="air-dev-step${step.error?' is-error':''}" data-trace="${key}"${inner}><summary>${stepTitle(step,step.kind==='ai'?++index:0)}</summary>${tools(key)}<pre>${preview(Trace.stepText(step))}</pre></details>`;}).join('');
            const last=entry.error?`<div class="air-dev-result is-error">${t('请求失败：','Request failed: ')}${esc(entry.error)}</div>`:'';
            return `<details class="air-dev-entry${entry.error?' is-error':''}" data-trace="${entry.id}"${open}><summary><span>${time}</span> ${esc(entry.label)} <em>${calls.length} ${t('次模型往返','model calls')}${used?` · ${used} ${t('次工具','tool calls')}`:''}${retries?` · ${retries} ${t('次重试','retries')}`:''} · ${(entry.ms/1000).toFixed(1)}s</em></summary>${tools(entry.id)}${steps||`<p class="air-dev-empty">${t('服务器没有返回过程记录。','No steps were returned.')}</p>`}${last}</details>`;
        }
        function traceSection(id){
            if(!Trace?.enabled())return '';
            const list=Trace.list(id);
            return `<section class="air-dev"><div class="air-dev-head"><strong>${t('开发者记录','Developer log')}</strong><small>${t('本页打开期间最近 40 条，刷新页面后清空','Last 40 items while this page is open')}</small>${list.length?`<button type="button" data-dev-clear>${t('清空','Clear')}</button>`:''}</div>${list.map(traceEntry).join('')||`<p class="air-dev-empty">${t('还没有记录。让 AI 生成、重试或刷新这个格子后，这里会显示每一步：发给模型的提示词和上下文、模型返回、工具调用和出错重试。','Nothing yet. Generate, retry or refresh this cell to see every step here.')}</p>`}</section>`;
        }
        const traceKey=key=>{const [entryId,position]=String(key).split(':'),entry=Trace.list(cellId).find(item=>item.id===entryId);if(!entry)return null;if(position===undefined)return {title:entry.label,text:Trace.entryText(entry)};const step=entry.steps[Number(position)];return step?{title:`${entry.label} · ${step.kind==='tool'?step.name:step.kind==='ai'?t('模型往返','model call'):t('重试','retry')}`,text:Trace.stepText(step)}:null;};
        Trace?.subscribe(id=>{if(cellId&&(id===null||id===cellId))render(cellId,{keepScroll:true});});
        const lastPromptIndex=chat=>chat.map(item=>item.kind).lastIndexOf('prompt');
        function initialStart(chat){const index=lastPromptIndex(chat);return index>=0?index:Math.max(0,chat.length-20);}
        function sourceLine(source){
            if(source.kind==='sheet')return `${t('表','Table')}：${source.label||source.match.sourceKey}${source.match.sheetName?' / '+source.match.sheetName:''}`;
            if(source.kind==='metrics'){const names=[...(source.names||[]),...(source.keys||[])];return `${t('指标','Metrics')}：${names.length?names.join('、'):(source.label||t('本月全部指标','all metrics this month'))}`;}
            if(source.kind==='dataset')return `${t('数据集','Dataset')}：${source.label||source.dataset}`;
            return `${t('其他工具','Other tool')}：${source.label||source.slug}`;
        }
        function recipeDetails(recipe){
            const offset=source=>source.monthOffset?`（${source.monthOffset===-1?t('上月','previous month'):source.monthOffset+t(' 个月',' months')}）`:'';
            // Kept out of the way: what the cell actually reads and runs, for tracking down a wrong number. Every prompt in
            // the history keeps the recipe it produced, so versions can be compared.
            return `<details class="air-recipe"><summary>${t('排查信息','Troubleshooting')}</summary><p>${esc(AiReportModel.text(recipe.summary,lang())||'')}</p><ul>${recipe.sources.map(source=>`<li>${esc(sourceLine(source)+offset(source))}</li>`).join('')}</ul><details class="air-recipe-code"><summary>${t('计算与展示代码','Calculation and display code')}</summary><pre>${esc(recipe.compute)}</pre><pre>${esc(recipe.render)}</pre></details></details>`;
        }
        const swatches=theme=>`<div class="air-swatches">${[theme.accent,theme.heading,...theme.palette].map(color=>`<i style="background:${esc(color)}" title="${esc(color)}"></i>`).join('')}</div>`;
        // The report-wide style uses the same flow; only its words and the result it shows differ.
        const copyButton=(index,role)=>`<button type="button" class="air-msg-copy air-msg-copy-${role}" data-copy-msg="${index}" data-msg-tail="${index}" title="${esc(t('复制这条内容','Copy this message'))}">⧉ ${t('复制','Copy')}</button>`;
        // Under the user's own words: copy, and retry (send the same words to the AI again).
        const userTail=(index,busy)=>`<div class="air-msg-tail air-msg-tail-user" data-msg-tail="${index}">${copyButton(index,'user').replace(` data-msg-tail="${index}"`,'')}<button type="button" class="air-msg-copy air-msg-retry" data-retry-msg="${index}" ${busy?'disabled':''} title="${esc(t('把这句话重新发给 AI','Send these words to the AI again'))}">↻ ${t('重试','Retry')}</button></div>`;
        function message(item,index,cell,busy,latestPrompt,report){
            return messageBody(item,index,cell,busy,latestPrompt,report)+(item.role==='user'?userTail(index,busy):copyButton(index,item.role));
        }
        function messageBody(item,index,cell,busy,latestPrompt,report){
            if(['gallery','image_delete'].includes(item.kind)){
                // Galleries keep the next steps as buttons (latest message only), like any other AI message.
                const actions=item.choices?.length&&index===cell.chat.length-1&&!busy?`<div class="air-choices">${item.choices.map(choice=>`<button type="button" data-choice="${esc(choice)}">${esc(choice)}</button>`).join('')}</div>`:'';
                return `<div class="air-msg air-msg-ai air-msg-pictures" data-msg="${index}">${multiline(item.text)}${imageLibraryView(item,index,busy)}${actions}</div>`;
            }
            if(item.kind==='prompt'){
                const latest=index===latestPrompt,compiled=latest&&(kind==='chapter'||kind==='field'||kind==='image'?cell.appliedPrompt===item.text:report?cell.theme&&cell.themePrompt===item.text:cell.recipe&&cell.recipePrompt===item.text);
                const words=kind==='image'?{title:t('图片提示词','Image prompt'),run:t('按提示词画一张','Draw from the prompt'),again:t('再画一张','Draw another'),done:t('已用于 LOGO','In use as the logo')}:kind==='field'?{title:t('字段提示词','Field prompt'),run:t('生成到月报开头','Write into the header'),again:t('重新生成','Generate again'),done:t('已写入月报开头','Written into the header')}:kind==='chapter'?{title:t('章节样式提示词','Chapter style prompt'),run:t('应用到本章节','Apply to chapter'),again:t('重新应用','Apply again'),done:t('已应用到本章节的格子','Applied to this chapter\'s cells')}:report?{title:t('整体风格提示词','Report style prompt'),run:t('应用到月报','Apply to report'),again:t('重新应用','Apply again'),done:t('已应用到整份月报','Applied to the whole report')}:{title:t('最终提示词','Final prompt'),run:t('试一下','Try it'),again:t('再试一次','Try again'),done:t('已生成到格子里','Shown in the cell')};
                // The latest prompt can be edited in place; saving records it as a new (manually edited) prompt and runs it.
                const editingThis=latest&&editing?.cellId===cellId;
                const head=`<div class="air-prompt-head"><strong>${words.title}</strong>${item.edited?`<span class="air-prompt-tag">${t('手动编辑','Edited')}</span>`:''}${latest&&!busy&&!editingThis?`<button type="button" class="air-prompt-edit" data-edit-prompt title="${esc(t('直接修改这段提示词','Edit this prompt'))}">✎ ${t('编辑','Edit')}</button>`:''}</div>`;
                if(editingThis)return `<div class="air-msg air-msg-prompt is-editing" data-msg="${index}">${head}<div class="air-prompt-draft" contenteditable="plaintext-only" spellcheck="false" data-prompt-draft>${esc(editing.draft)}</div><div class="air-prompt-actions"><button type="button" data-save-prompt>${report?t('保存并应用','Save & apply'):t('保存并生成','Save & generate')}</button><small>${t('Ctrl/⌘+Enter 保存 · Esc 取消','Ctrl/⌘+Enter to save · Esc to cancel')}</small><button type="button" class="air-revert" data-cancel-edit>${t('取消','Cancel')}</button></div></div>`;
                // 【分类】 headings (and platform marks such as 【尺寸约束】) stand out so long prompts are easy to scan.
                return `<div class="air-msg air-msg-prompt" data-msg="${index}">${head}<div>${multiline(item.text).replace(/(^|<br>)(【[^】<]{1,20}】)/g,'$1<b class="air-prompt-mark">$2</b>')}</div>${latest?`<div class="air-prompt-actions"><button type="button" data-try ${busy?'disabled':''}>${compiled?words.again:words.run}</button>${compiled?`<small>${words.done}</small>`:''}${kind==='report'&&cell.chat.filter(entry=>entry.kind==='prompt').length<2?'':`<button type="button" class="air-revert" data-revert ${busy?'disabled':''} title="${esc(t('撤回到上一个最终提示词，并删除之后的对话','Undo to the previous final prompt and remove the conversation after it'))}">↶ ${t('撤回','Undo')}</button>`}</div>${compiled&&kind!=='chapter'&&kind!=='field'&&kind!=='image'?(report?swatches(cell.theme):recipeDetails(cell.recipe)):''}`:(!report&&item.recipe?recipeDetails(item.recipe):'')}</div>`;
            }
            const pictures=item.kind==='image'?`<div class="air-img-preview">${(item.images||[]).map(image=>`<img src="${esc(image.url)}" alt="${esc(image.name||'')}">`).join('')}</div>`:'';
            const choices=item.choices?.length&&index===cell.chat.length-1&&!busy?`<div class="air-choices">${item.choices.map(choice=>`<button type="button" data-choice="${esc(choice)}">${esc(choice)}</button>`).join('')}</div>`:'';
            return `<div class="air-msg air-msg-${item.role}${item.kind==='note'?' air-msg-note':''}${pictures?' air-msg-pictures':''}" data-msg="${index}">${multiline(item.text)}${pictures}${choices}</div>`;
        }
        function render(id=cellId,{keepScroll=false}={}){
            const opened=id!==cellId;if(opened)editing=null;cellId=id;const found=id&&find(id);
            if(!found){root.hidden=true;root.innerHTML='';return;}
            const {cell,chapter,busy}=found,report=found.kind!=='cell';kind=found.kind;
            if(opened||!starts.has(id))starts.set(id,initialStart(cell.chat));
            const start=Math.min(starts.get(id),cell.chat.length),latestPrompt=lastPromptIndex(cell.chat);
            const previousLog=root.querySelector('.air-chat-log'),fromBottom=previousLog?previousLog.scrollHeight-previousLog.scrollTop:0;
            const hasUser=cell.chat.some(item=>item.role==='user');
            const log=cell.chat.slice(start).map((item,offset)=>message(item,start+offset,cell,busy,latestPrompt,report)).join('');
            root.hidden=false;
            root.innerHTML=`<header><div><strong>${kind==='image'?t('图片对话','Image conversation'):kind==='field'?t('字段对话','Field conversation'):kind==='chapter'?t('章节样式对话','Chapter style'):report?t('整体风格对话','Report style'):t('格子对话','Cell conversation')}</strong><small>${esc(AiReportModel.text(chapter.title,lang()))}</small></div><button type="button" class="air-dev-toggle" data-dev-toggle aria-pressed="${Trace?.enabled()?'true':'false'}" title="${esc(t('开发者模式：显示和 AI 来回的完整过程（提示词、上下文、模型返回、工具调用、出错重试）','Developer mode: show every exchange with the AI'))}">${t('开发者','Developer')}</button><button type="button" data-chat-close aria-label="${esc(t('关闭','Close'))}">×</button></header>
                <div class="air-chat-log"><div class="air-pull" aria-hidden="true"><span class="air-pull-icon">↓</span><span class="air-pull-text"></span></div><div class="air-chat-track">${start>0?`<button type="button" class="air-chat-earlier" data-earlier>${t(`下拉查看更早的 ${start} 条对话`,`Pull down for ${start} earlier messages`)}</button>`:''}${kind==='image'?imageIntro(found):''}${log||`<p class="air-chat-empty">${kind==='image'?t('换一张图片：上传本地文件、从以前用过的图片里挑，或者直接描述想要的样子让 AI 画一张。','Change the picture: upload, pick an earlier one, or describe a new one for the AI to draw.'):kind==='field'?t('说说这段开头文字想怎么写：可以给一段固定不变的文字，也可以让它每月自动生成，例如“报告时间写成报告月份的下一个月 YYYYMM”“报告目标结合本月未达标的格子写三段”。也可以先问问现在能怎么写。','Describe how this header text should read: fixed text, or generated every month.'):kind==='chapter'?t('说说这个章节里的格子要统一成什么样式，例如“标题统一 14px 加粗、柱状图统一深蓝色、目标线统一红色虚线、总结统一放在图表下方一到两句”。这里只改样式和风格，不改各格子的数据和计算。','Describe how this chapter\'s cells should look alike. This changes style only, not data or calculations.'):report?t('说说整份月报想要的主题、色调和语气，例如“沉稳的深蓝商务风，图表用蓝绿色系，措辞正式简洁”。这里只改样式和风格，不改章节和格子。','Describe the theme, colours and tone for the whole report. This changes style only, not chapters or cells.'):t('说说这个格子要展示什么，也可以先问问数据，比如“整改详单有哪些列”。想清楚后点下面的“生成最终提示词”。','Describe what this cell should show, or ask about the data first. When it is settled, use “Generate final prompt” below.')}</p>`}${failureBanner(cell)}${traceSection(id)}${busy?`<div class="air-msg air-msg-ai air-msg-busy"><span class="air-spinner" aria-hidden="true"></span>${esc(busy)}</div>`:''}
                ${hasUser&&!busy?`<a href="#" class="air-make-prompt" data-make-prompt>${kind==='image'?'':kind==='field'?(latestPrompt>=0?t('根据对话重新生成字段提示词','Regenerate the field prompt'):t('生成字段提示词','Generate the field prompt')):kind==='chapter'?(latestPrompt>=0?t('根据对话重新生成章节样式提示词','Regenerate the chapter style prompt'):t('生成章节样式提示词','Generate the chapter style prompt')):report?(latestPrompt>=0?t('根据对话重新生成风格提示词','Regenerate the style prompt'):t('生成整体风格提示词','Generate the style prompt')):latestPrompt>=0?t('根据对话重新生成最终提示词','Regenerate final prompt from the conversation'):t('生成最终提示词','Generate final prompt')}</a>`:''}</div></div>
                <form class="air-chat-form"><div class="air-composer"><textarea rows="1" maxlength="6000" aria-label="${esc(t('消息','Message'))}" placeholder="${esc(kind==='image'?t('描述想要的图片，或说“大一点”“换回上一张”…','Describe the picture you want…'):kind==='field'?t('说说这段文字想怎么写，或问问能怎么写…','Describe how this text should read…'):kind==='chapter'?t('说说本章节格子要统一的样式…','Describe the style to unify in this chapter…'):report?t('说说要加、删、改哪条要求，或想要的风格…','Say which rule to add, remove or change, or the style you want…'):t('问问数据，或说说想要的内容…','Ask about the data or describe what you want…'))}" ${busy?'disabled':''}></textarea><div class="air-composer-bar"><small>${t('Enter 发送 · Shift+Enter 换行','Enter to send · Shift+Enter for a new line')}</small><button type="submit" class="air-send" disabled aria-label="${esc(t('发送','Send'))}" title="${esc(t('发送','Send'))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></div></form>`;
            const logNode=root.querySelector('.air-chat-log');
            logNode.scrollTop=keepScroll?logNode.scrollHeight-fromBottom:logNode.scrollHeight;
            pullable(logNode);
        }
        function loadEarlier(){const start=starts.get(cellId)||0;if(!start)return;starts.set(cellId,Math.max(0,start-PAGE));render(cellId,{keepScroll:true});}
        // Pull-to-load: at the top, further upward scrolling (wheel, trackpad or touch) stretches the conversation down with
        // resistance; past the threshold, letting go loads earlier messages, then everything springs back.
        const THRESHOLD=64,MAX_PULL=130;
        function pullable(log){
            const track=log.querySelector('.air-chat-track'),indicator=log.querySelector('.air-pull'),label=indicator.querySelector('.air-pull-text');
            let pull=0,timer=null,touchY=null,loading=false;
            const more=()=>(starts.get(cellId)||0)>0;
            const limit=()=>more()?MAX_PULL:48;
            const paint=(settle=false)=>{
                track.classList.toggle('is-settling',settle);track.style.transform=pull?`translateY(${pull}px)`:'';
                indicator.style.height=pull+'px';indicator.style.opacity=String(Math.min(1,pull/40));
                const ready=more()&&pull>=THRESHOLD;indicator.classList.toggle('is-ready',ready);indicator.classList.toggle('is-loading',loading);
                label.textContent=loading?t('正在加载…','Loading…'):!more()?t('没有更早的对话了','No earlier messages'):ready?t('松开加载更早的对话','Release to load earlier messages'):t('下拉查看更早的对话','Pull down for earlier messages');
            };
            const stretch=delta=>{pull=Math.max(0,Math.min(limit(),pull+delta*(1-pull/(limit()+40))));paint();};
            const release=()=>{
                clearTimeout(timer);timer=null;touchY=null;
                if(more()&&pull>=THRESHOLD&&!loading){loading=true;pull=44;paint(true);setTimeout(()=>{loading=false;loadEarlier();},320);return;}
                pull=0;paint(true);
            };
            log.addEventListener('wheel',event=>{
                if(loading)return event.preventDefault();
                if(log.scrollTop>0||(event.deltaY>=0&&!pull))return;
                event.preventDefault();stretch(-event.deltaY*0.5);
                clearTimeout(timer);timer=setTimeout(release,180);
            },{passive:false});
            log.addEventListener('touchstart',event=>{if(log.scrollTop<=0)touchY=event.touches[0].clientY-pull/0.5;},{passive:true});
            log.addEventListener('touchmove',event=>{if(touchY===null||loading)return;const distance=(event.touches[0].clientY-touchY)*0.5;if(distance<=0&&!pull)return;event.preventDefault();pull=0;stretch(distance);},{passive:false});
            log.addEventListener('touchend',()=>{if(touchY!==null)release();});
            log.addEventListener('touchcancel',()=>{if(touchY!==null)release();});
        }
        root.addEventListener('click',event=>{
            const choice=event.target.closest('[data-choice]');if(choice&&cellId)return send(cellId,choice.dataset.choice);
            if(event.target.closest('[data-earlier]'))return loadEarlier();
            if(event.target.closest('[data-make-prompt]')){event.preventDefault();return makePrompt(cellId);}
            if(event.target.closest('[data-try]'))return tryPrompt(cellId);
            if(event.target.closest('[data-revert]'))return revert(cellId);
            const copy=event.target.closest('[data-copy-msg]');if(copy){copyMessage(copy);return;}
            const again=event.target.closest('[data-retry-msg]');if(again){if(!again.disabled)retry(cellId,Number(again.dataset.retryMsg));return;}
            if(event.target.closest('[data-edit-prompt]')){const cell=find(cellId)?.cell;editing={cellId,draft:cell?.prompt||''};render(cellId,{keepScroll:true});focusDraft();return;}
            if(event.target.closest('[data-cancel-edit]')){editing=null;render(cellId,{keepScroll:true});return;}
            if(event.target.closest('[data-save-prompt]'))return saveDraft();
            const remove=event.target.closest('[data-delete-image]');if(remove&&cellId){event.stopPropagation();removeImage(cellId,Number(remove.closest('[data-msg]').dataset.msg),remove.dataset.deleteImage);return;}
            const imagePager=event.target.closest('[data-image-page]');if(imagePager&&cellId){imagePage(cellId,Number(imagePager.closest('[data-msg]').dataset.msg),Number(imagePager.dataset.imagePage));return;}
            const deletion=event.target.closest('[data-image-deletion]');if(deletion&&cellId){imageDeletion(cellId,Number(deletion.closest('[data-msg]').dataset.msg),deletion.dataset.imageDeletion);return;}
            const picked=event.target.closest('[data-pick-image]');if(picked&&cellId){pickImage(cellId,picked.dataset.pickImage,Number(picked.closest('[data-msg]').dataset.msg));return;}
            if(event.target.closest('[data-dev-toggle]')){Trace.setEnabled(!Trace.enabled());return;}
            if(event.target.closest('[data-dev-clear]')){Trace.clear(cellId);return;}
            const devCopy=event.target.closest('[data-dev-copy]');if(devCopy){const item=traceKey(devCopy.dataset.devCopy);if(item)copyText(item.text,devCopy);return;}
            const devFull=event.target.closest('[data-dev-full]');if(devFull){const item=traceKey(devFull.dataset.devFull);if(item)AiReportTraceViewer.open(item);return;}
            if(event.target.closest('[data-chat-close]'))close();
        });
        // The composer grows with its text (up to about eight lines) and the send button lights up once there is something to send.
        const fit=input=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,200)+'px';root.querySelector('.air-send').disabled=!input.value.trim()||input.disabled;};
        root.addEventListener('input',event=>{if(event.target.matches('.air-composer textarea'))fit(event.target);});
        // A picture that cannot load (removed, or no longer reachable) shows a quiet placeholder instead of a broken icon.
        root.addEventListener('error',event=>{const image=event.target;if(image?.tagName==='IMG'&&image.closest?.('.air-img-gallery,.air-img-preview,.air-img-current'))image.closest('button,.air-img-preview,.air-img-current')?.classList.add('is-broken');},true);
        root.addEventListener('toggle',event=>{const node=event.target.closest?.('[data-trace]');if(!node)return;if(node.open)openTraces.add(node.dataset.trace);else openTraces.delete(node.dataset.trace);},true);
        async function copyText(text,button){
            try{await navigator.clipboard.writeText(text);}catch(_){const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;opacity:0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}
            const label=button.textContent;button.textContent='✓ '+t('已复制','Copied');setTimeout(()=>{button.textContent=label;},1400);
        }
        async function copyMessage(button){
            const item=find(cellId)?.cell?.chat[Number(button.dataset.copyMsg)];if(!item)return;
            const text=item.text+(item.choices?.length?'\n'+item.choices.map(choice=>'- '+choice).join('\n'):'');
            try{await navigator.clipboard.writeText(text);}catch(_){const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;opacity:0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}
            const label=button.textContent;button.textContent='✓ '+t('已复制','Copied');button.classList.add('is-copied');setTimeout(()=>{button.textContent=label;button.classList.remove('is-copied');},1400);
        }
        const focusDraft=()=>{const draft=root.querySelector('[data-prompt-draft]');if(!draft)return;draft.focus();const range=document.createRange();range.selectNodeContents(draft);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);};
        function saveDraft(){const text=(editing?.draft||'').trim(),id=cellId;editing=null;if(!text){render(id,{keepScroll:true});return;}savePrompt(id,text);}
        root.addEventListener('input',event=>{if(event.target.matches('[data-prompt-draft]')&&editing)editing.draft=event.target.innerText;});
        root.addEventListener('keydown',event=>{
            if(!event.target.matches('[data-prompt-draft]'))return;
            if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();saveDraft();}
            else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();editing=null;render(cellId,{keepScroll:true});}
        });
        root.addEventListener('submit',event=>{event.preventDefault();const input=root.querySelector('.air-composer textarea'),text=input.value.trim();if(text&&cellId){input.value='';fit(input);send(cellId,text);}});
        root.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229&&event.target.matches('.air-composer textarea')){event.preventDefault();root.querySelector('.air-chat-form').requestSubmit();}});
        root.addEventListener('click',event=>{if(event.target.closest('.air-composer')&&!event.target.closest('button'))root.querySelector('.air-composer textarea')?.focus();});
        // Undo animation: removed bubbles blur away bottom-up while particles scatter in a Gaussian spray, then their space
        // collapses and the earlier history slides down to the bottom.
        const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const gaussian=()=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
        // Light bubbles would scatter near-white specks; give them a soft accent tint so the spray stays visible.
        function particleColor(node){
            const [r=255,g=255,b=255]=(getComputedStyle(node).backgroundColor.match(/\d+(\.\d+)?/g)||[]).map(Number);
            return (0.299*r+0.587*g+0.114*b)/255>0.82?'rgba(51,120,183,.55)':`rgb(${r},${g},${b})`;
        }
        function burst(node,log){
            const box=node.getBoundingClientRect(),area=log.getBoundingClientRect(),color=particleColor(node),count=Math.max(22,Math.min(64,Math.round(box.width*box.height/650)));
            for(let index=0;index<count;index++){
                const particle=document.createElement('span'),size=3+Math.random()*4.5;particle.className='air-particle';
                Object.assign(particle.style,{left:(box.left-area.left+Math.random()*box.width)+'px',top:(box.top-area.top+log.scrollTop+Math.random()*box.height)+'px',width:size+'px',height:size+'px',background:color});
                log.append(particle);
                particle.animate([{transform:'translate(0,0) scale(1)',opacity:.9,filter:'blur(0)'},{transform:`translate(${gaussian()*46}px,${gaussian()*30-26}px) scale(.2)`,opacity:0,filter:'blur(2px)'}],{duration:620+Math.random()*420,easing:'cubic-bezier(.2,.7,.3,1)',fill:'forwards'}).finished.then(()=>particle.remove(),()=>particle.remove());
            }
            node.animate([{filter:'blur(0)',opacity:1,transform:'none'},{filter:'blur(9px)',opacity:0,transform:'scale(1.03) translateY(-4px)'}],{duration:560,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
        }
        async function dissolve(fromIndex){
            const log=root.querySelector('.air-chat-log');if(!log)return;
            const nodes=[...log.querySelectorAll('[data-msg],[data-msg-tail]')].filter(node=>Number(node.dataset.msg??node.dataset.msgTail)>=fromIndex).reverse();
            if(!nodes.length||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
            root.classList.add('is-dissolving');
            nodes.forEach((node,index)=>setTimeout(()=>burst(node,log),index*110));
            await wait(nodes.length*110+560);
            for(const node of nodes){node.style.height=node.offsetHeight+'px';node.style.overflow='hidden';}
            void log.offsetHeight;
            for(const node of nodes){node.classList.add('is-collapsing');node.style.height='0px';}
            const end=performance.now()+420,pin=()=>{log.scrollTop=log.scrollHeight;if(performance.now()<end)requestAnimationFrame(pin);};pin();
            await wait(440);root.classList.remove('is-dissolving');
        }
        const reveal=(id,index)=>starts.set(id,Math.min(starts.get(id)??index,index));
        return {render,current:()=>cellId,dissolve,reveal};
    }
    window.AiReportChat={create};
})();
