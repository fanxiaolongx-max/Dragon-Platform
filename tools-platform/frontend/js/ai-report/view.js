/* Renders an AI report to HTML. The same markup serves editing, preview and standalone export. */
(function(){
    'use strict';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const multiline=value=>esc(value).replace(/\n/g,'<br>');

    function editable(value,field,options){
        if(options.mode!=='edit')return multiline(value);
        return `<span contenteditable="plaintext-only" spellcheck="false" data-edit="${esc(field)}" data-placeholder="${esc(options.t('点击编辑','Click to edit'))}">${multiline(value)}</span>`;
    }
    // A header field with its prompt button: ✦ is lit when the text is generated from a prompt rather than fixed.
    function field(value,key,options,prompts={}){
        if(options.mode!=='edit')return multiline(value);
        const prompt=prompts[key]?.prompt,generated=!!prompt&&AiReportModel.fixedText(prompt)===null,busy=options.busyFields?.has(key);
        return `<span class="air-field${generated?' is-generated':''}${busy?' is-busy':''}">${editable(value,key,options)}<button type="button" class="air-field-prompt" data-field-prompt="${esc(key)}" title="${esc(generated?options.t('这段文字由提示词生成，点击打开字段对话','Generated from a prompt — open the field conversation'):options.t('打开字段对话：设置这段文字的提示词（固定文字，或由 AI 按报告月份生成）','Open the field conversation to set this text\'s prompt'))}" aria-label="${esc(options.t('字段对话','Field conversation'))}"></button></span>`;
    }
    function masthead(doc,options){
        const {template}=doc,text=value=>AiReportModel.text(value,options.lang),prompts=template.fields||{};
        const meta=template.meta.map(item=>`<div class="air-meta-item" style="grid-column:span ${item.span}"><b>${editable(text(item.label),'meta-label:'+item.id,options)}</b><span>${field(text(item.value),'meta-value:'+item.id,options,prompts)}</span></div>`).join('');
        const logo=template.logo?`<img class="air-logo" src="${esc(options.logoSrc||template.logo)}" alt="" style="width:${template.logoWidth}px">`:'';
        // In the editor the logo opens its image conversation (upload, history, AI drawing, size).
        const logoBlock=options.mode==='edit'?`<button type="button" class="air-logo-edit" data-image-chat="logo" title="${esc(options.t('图片对话：上传、从历史中选择，或让 AI 画一张新的 LOGO','Image conversation: upload, pick or draw a new logo'))}">${logo||`<span class="air-logo-empty">${esc(options.t('添加 LOGO','Add a logo'))}</span>`}<span class="air-logo-tag">✦ ${esc(options.t('图片对话','Image'))}</span></button>`:logo;
        return `<header class="air-masthead">${logoBlock}
            <h1>${field(text(template.title),'title',options,prompts)}</h1>${text(template.subtitle)||options.mode==='edit'?`<p class="air-subtitle">${field(text(template.subtitle),'subtitle',options,prompts)}</p>`:''}
            ${meta?`<div class="air-meta">${meta}</div>`:''}</header>`;
    }
    function cellBody(cell,options){
        const t=options.t,busy=options.busy?.get(cell.id),output=cell.output;
        if(options.mode==='edit'&&!cell.recipe&&!cell.chat.length&&!busy){
            return `<form class="air-ask" data-ask="${cell.id}"><textarea rows="2" maxlength="4000" placeholder="${esc(t('这个格子想放什么？例如：按严重级别统计本月整改单；也可以先问“整改详单有哪些列”','What should this cell show? e.g. this month\'s rectification orders by severity — or ask “what columns does the rectification sheet have”'))}"></textarea><button type="submit">${t('开始','Start')}</button></form>`;
        }
        const parts=[];
        // Progress is shown by the ring around the cell; while nothing is generated yet a quiet skeleton holds the place.
        if(busy&&!output?.html)parts.push('<div class="air-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>');
        if(output?.error&&options.mode==='edit')parts.push(`<div class="air-error">${esc(t('运行失败：','Run failed: ')+output.error)}</div>`);
        const narrative=output&&AiReportModel.text(output.narrative,options.lang);
        // The AI summary may mark key numbers with **…**; they show bold in the theme colour.
        if(narrative)parts.push(`<div class="air-narrative${output.narrativeMonth!==options.month&&options.mode==='edit'?' is-stale':''}">${multiline(narrative).replace(/\*\*([^*<]{1,80}?)\*\*/g,'<strong class="kit-em">$1</strong>')}</div>`);
        if(output?.html)parts.push(`<div class="air-output">${AiReportSanitize.clean(output.html)}</div>`);
        if(cell.missing?.length&&options.mode==='edit')parts.push(`<div class="air-note">${esc(t('本月缺少数据：','Missing this month: ')+cell.missing.map(item=>item.label||item.id).join('、'))}</div>`);
        if(!parts.length&&options.mode==='edit'){
            const last=cell.chat[cell.chat.length-1],label=cell.prompt&&!cell.recipe?t('提示词已生成，打开对话点“试一下”看效果','Prompt ready — open the chat and use “Try it”'):last?.kind==='ask'?t('AI 有问题需要你确认，点这里继续','AI has a question — continue here'):t('点这里继续对话','Continue the conversation');
            parts.push(`<button type="button" class="air-pending" data-cell-chat="${cell.id}">${esc(label)}</button>`);
        }
        return parts.join('');
    }
    // Progress ring: the lit share of the cell's perimeter is how far the work has got; the colour is the stage.
    const STAGES=[['queued',/等待|Queued/i,8],['think',/查数据|思考|thinking|reading data/i,20],['prompt',/总结对话|最终提示词|写进提示词|Summariz|final prompt|into the prompt/i,40],['narrative',/写总结|writing the summary/i,95],['compile',/配方|新尺寸|修改后|主题|recipe|Regenerating|edited prompt|theme/i,65],['compute',/计算|恢复|Computing|Restoring/i,85]];
    function stageOf(label){const found=STAGES.find(([,pattern])=>pattern.test(String(label||'')));return found?{stage:found[0],to:found[2]}:{stage:'compile',to:50};}
    function ringMarkup(ring){
        const head=Math.max(0,ring.to-2.5);
        return `<svg class="air-progress air-progress-${ring.stage}${ring.done?' is-done':''}" style="--from:${ring.from||0};--to:${ring.to}" aria-hidden="true"><rect class="air-progress-track" pathLength="100"></rect><rect class="air-progress-bar" pathLength="100"></rect>${ring.done?'':`<rect class="air-progress-glint" pathLength="100" style="stroke-dasharray:0 ${head} 2.5 100"></rect>`}</svg>`;
    }
    function cellMarkup(cell,options){
        const t=options.t,selected=options.selected===cell.id;
        const style=`grid-column:span ${cell.span};${cell.height?`${cell.fit?'height':'min-height'}:${cell.height}px;`:''}`;
        const tools=options.mode==='edit'?`<div class="air-cell-tools"><button type="button" data-cell-drag="${cell.id}" title="${esc(t('拖动换位置','Drag to move'))}" aria-label="${esc(t('拖动','Move'))}">⠿</button><button type="button" data-cell-chat="${cell.id}">${t('对话','Chat')}</button><button type="button" data-cell-copy="${cell.id}" title="${esc(t('复制这个格子（含对话、提示词和内容），放在它后面','Duplicate this cell with its conversation, prompt and content'))}" aria-label="${esc(t('复制格子','Duplicate cell'))}">⧉</button>${cell.recipe?`<button type="button" data-cell-run="${cell.id}" title="${esc(t('按本月数据重新生成','Regenerate with this month\'s data'))}">⟳</button>`:''}<button type="button" data-cell-delete="${cell.id}" title="${esc(t('删除格子','Delete cell'))}" aria-label="${esc(t('删除格子','Delete cell'))}">×</button></div><div class="air-resize" data-resize="${cell.id}" title="${esc(t('拖动调整宽高，双击恢复自动高度','Drag to resize; double-click for auto height'))}"></div>`:'';
        const ring=options.rings?.get(cell.id),busy=options.busy?.get(cell.id);
        return `<div class="air-cell${selected?' is-selected':''}${cell.height?' has-height':''}${cell.fit?' is-fit':''}" id="air-cell-${cell.id}" data-cell="${cell.id}" style="${style}"${busy?` aria-busy="true" title="${esc(busy)}"`:''}>${ring?ringMarkup(ring):''}${tools}<div class="air-cell-body">${cellBody(cell,options)}</div></div>`;
    }
    // Theme variables scope colours, font and corners to the report (and its exports); the editor chrome keeps its own.
    function themeStyle(theme){
        if(!theme)return '';
        const vars={'--air-accent':theme.accent,'--air-accent-soft':theme.accentSoft,'--rep-heading':theme.heading,'--rep-surface':theme.surface,'--rep-radius':theme.radius+'px','--rep-font':theme.font==='serif'?'"Songti SC","STSong","Noto Serif SC",Georgia,serif':'inherit'};
        theme.palette.forEach((color,index)=>{vars['--kit-c'+index]=color;});
        if(theme.frameColor)vars['--rep-frame-color']=theme.frameColor;if(theme.dividerColor)vars['--rep-divider-color']=theme.dividerColor;
        return Object.entries(vars).map(([key,value])=>`${key}:${value}`).join(';');
    }
    // Chapter numbers skip unnumbered chapters (overview, navigation), so the rest count 01, 02… without gaps.
    function chapterNumbers(doc){let next=0;return doc.chapters.map(chapter=>chapter.numbered===false||chapter.heading===false?'':String(++next).padStart(2,'0'));}
    // The default template has a double frame and lines between cells until a theme says otherwise.
    const frameOf=theme=>({frame:theme?.frame||'double',dividers:theme?.dividers||'line',panels:theme?.panels||'box'});
    function report(doc,options){
        const t=options.t,text=value=>AiReportModel.text(value,options.lang),edit=options.mode==='edit';
        // Between chapters (and before the first) a thin insert line appears on hover.
        const insert=index=>edit?`<div class="air-chapter-insert"><button type="button" data-insert-chapter="${index}" title="${esc(t('在这里插入一个新章节','Insert a new chapter here'))}">＋ ${t('插入章节','Insert chapter')}</button></div>`:'';
        const numbers=chapterNumbers(doc);
        const chapters=doc.chapters.map((chapter,index)=>`${insert(index)}<section class="air-chapter${numbers[index]?'':' is-unnumbered'}${chapter.heading===false?' is-headless':''}" id="air-chapter-${chapter.id}" data-chapter="${chapter.id}">
            <h2>${numbers[index]?`<span class="air-chapter-no">${numbers[index]}</span>`:''}${editable(text(chapter.title),'chapter:'+chapter.id,options)}${edit?`<span class="air-chapter-tools"><button type="button" class="air-chapter-drag" data-chapter-drag="${chapter.id}" title="${esc(t('拖动调整章节位置（拖动时月报会缩小，显示全部章节）','Drag to move the chapter (the report zooms out to show every chapter)'))}" aria-label="${esc(t('拖动章节','Move chapter'))}">⠿</button><button type="button" class="air-chapter-refresh" data-chapter-refresh="${chapter.id}" title="${esc(t('用本月数据重新计算本章节的格子，并重写文字总结','Recompute this chapter\'s cells with this month\'s data and rewrite the summaries'))}" aria-label="${esc(t('刷新本章节','Refresh chapter'))}">⟳</button><button type="button" class="air-chapter-style${chapter.style?.prompt?' is-set':''}" data-chapter-style="${chapter.id}" title="${esc(chapter.style?.prompt?t('章节样式提示词（已设置）：统一本章节格子的样式和风格，不改数据','Chapter style prompt (set): unifies how this chapter\'s cells look, not their data'):t('章节样式提示词：统一本章节格子的样式和风格，不改数据','Chapter style prompt: unify how this chapter\'s cells look, without changing data'))}" aria-label="${esc(t('章节样式','Chapter style'))}">✦</button><button type="button" class="air-chapter-heading" data-chapter-heading="${chapter.id}" aria-pressed="${chapter.heading!==false}" title="${esc(chapter.heading===false?t('这个章节不显示标题（导航、总览），点击恢复标题','No title bar — click to show it again'):t('点击隐藏这个章节的标题栏（适合导航、总览）','Click to hide this chapter\'s title bar (navigation, overview)'))}">T</button><button type="button" class="air-chapter-numbering" data-chapter-numbering="${chapter.id}" aria-pressed="${chapter.numbered!==false}" title="${esc(chapter.numbered===false?t('这个章节不编号，点击恢复编号','Not numbered — click to number it'):t('点击取消这个章节的编号（总览、导航等）','Click to leave this chapter unnumbered (overview, navigation)'))}">#</button><button type="button" data-chapter-move="${chapter.id}:-1" ${index===0?'disabled':''} aria-label="${esc(t('上移章节','Move chapter up'))}">↑</button><button type="button" data-chapter-move="${chapter.id}:1" ${index===doc.chapters.length-1?'disabled':''} aria-label="${esc(t('下移章节','Move chapter down'))}">↓</button><button type="button" data-chapter-delete="${chapter.id}" aria-label="${esc(t('删除章节','Delete chapter'))}">×</button></span>`:''}</h2>
            <div class="air-grid" data-grid="${chapter.id}">${chapter.cells.map(cell=>cellMarkup(cell,options)).join('')}${edit?`<button type="button" class="air-add-cell" data-add-cell="${chapter.id}">＋ ${t('添加格子','Add cell')}</button>`:''}</div></section>`).join('');
        const footer=text(doc.template.footer);
        const styleTools=edit?`<div class="air-report-tools"><button type="button" data-style-chat title="${esc(t('整份月报的风格，以及每个格子生成时都遵守的通用要求（可编辑、可对话修改）','The report\'s style and the rules every cell follows (edit directly or through the chat)'))}">✦ ${t('整体风格','Report style')}</button><button type="button" data-refresh-all title="${esc(t('用本月数据重新计算所有已生成的格子，并重写文字总结（不改提示词和配方）','Recompute every generated cell with this month\'s data and rewrite the summaries (prompts and recipes stay)'))}">⟳ ${t('刷新全部格子','Refresh all cells')}</button></div>`:'';
        return `${styleTools}${masthead(doc,options)}${chapters}${edit?`<button type="button" class="air-add-chapter" data-add-chapter>＋ ${t('添加章节','Add chapter')}</button>`:''}${footer||edit?`<footer class="air-footer">${field(footer,'footer',options,doc.template.fields||{})}</footer>`:''}`;
    }
    window.AiReportView={report,themeStyle,frameOf,chapterNumbers,stageOf,esc};
})();
