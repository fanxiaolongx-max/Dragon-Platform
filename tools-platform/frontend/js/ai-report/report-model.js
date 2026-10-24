/* AI report document: template header + chapters of prompt-driven cells. Shared by browser and server. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AiReportModel=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    const LIMITS={name:200,prompt:4000,chat:200,widgets:1500000,chatText:6000,choices:8,choice:200,code:30000,html:400000,result:60000,cells:80,chapters:40,meta:24,sources:8};
    const validMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'');
    const uid=prefix=>prefix+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    const str=(value,max)=>typeof value==='string'?value.slice(0,max):'';
    const bilingual=(zh='',en='')=>({zh:String(zh),en:String(en)});
    const pair=(value,max=4000)=>value&&typeof value==='object'?bilingual(str(value.zh,max),str(value.en,max)):bilingual(str(value,max),'');
    const id=(value,prefix)=>typeof value==='string'&&/^[-\w]{1,80}$/.test(value)?value:uid(prefix);
    const clamp=(value,min,max,fallback)=>{const number=Math.round(Number(value));return Number.isFinite(number)?Math.min(max,Math.max(min,number)):fallback;};
    function invalid(message){const error=new Error(message);error.status=400;throw error;}

    // Sizes the user set on a cell's sub-blocks (kit.layout slots): width is a share of its row, height is in px.
    function normalizeLayout(input){
        const out={};
        if(!input||typeof input!=='object')return out;
        for(const [slot,size] of Object.entries(input).slice(0,20)){
            if(!/^[A-Za-z][\w-]{0,30}$/.test(slot)||!size||typeof size!=='object')continue;
            const entry={};if(Number.isFinite(Number(size.width))&&size.width!==null&&size.width!=='')entry.width=clamp(size.width,5,100,0);if(size.height)entry.height=clamp(size.height,60,1600,0);
            if(entry.width||entry.height)out[slot]=entry;
        }
        return out;
    }
    function cell(input={}){
        return {id:id(input.id,'cell'),span:clamp(input.span,1,12,6),height:input.height?clamp(input.height,60,1600,0):0,fit:input.fit===true&&!!input.height,abbreviation:str(input.abbreviation,500),layout:normalizeLayout(input.layout),prompt:str(input.prompt,LIMITS.prompt),recipePrompt:str(input.recipePrompt,LIMITS.prompt),chat:normalizeChat(input.chat),recipe:input.recipe?normalizeRecipe(input.recipe):null,output:input.output?normalizeOutput(input.output):null};
    }
    function chapter(input={}){
        const cells=Array.isArray(input.cells)?input.cells.slice(0,LIMITS.cells).map(cell):[];
        // numbered:false — a chapter without a number (overview, navigation); the others are numbered without gaps.
        // heading:false — no title bar at all (a navigation strip right under the header); such a chapter is never numbered.
        // style — the chapter's own style prompt: it unifies how the chapter's cells look, never their data.
        const style=input.style&&typeof input.style==='object'?{prompt:str(input.style.prompt,LIMITS.prompt),chat:normalizeChat(input.style.chat),appliedPrompt:str(input.style.appliedPrompt,LIMITS.prompt)}:null;
        return {id:id(input.id,'chapter'),title:pair(input.title,200),cells,...(input.numbered===false?{numbered:false}:{}),...(input.heading===false?{heading:false}:{}),...(style&&(style.prompt||style.chat.length)?{style}:{})};
    }
    // A prompt message remembers what it produced (recipe and summary, or the report theme), so undo can restore it.
    function promptSnapshot(item){
        const snapshot=item.edited?{edited:true}:{};
        if(item.sized){snapshot.sized=true;const size=item.previousSize||{};snapshot.previousSize={height:size.height?clamp(size.height,60,1600,0):0,fit:size.fit===true,span:clamp(size.span,1,12,6)};}
        if(item.recipe&&typeof item.recipe==='object'){try{snapshot.recipe=normalizeRecipe(item.recipe);}catch(_){}}
        if(item.narrative&&typeof item.narrative==='object'){snapshot.narrative=pair(item.narrative,4000);if(validMonth(item.narrativeMonth))snapshot.narrativeMonth=item.narrativeMonth;}
        if(item.theme&&typeof item.theme==='object'){const theme=normalizeTheme(item.theme);if(theme)snapshot.theme=theme;}
        return snapshot;
    }
    // Image addresses the report may show: its own image store, older monthly logos, or the bundled assets.
    function imageUrl(value){const url=String(value||'');return /^\/api\/ai-report\/images\/[-\w]{1,80}$|^\/api\/upload\/monthly-logos\/[-\w%]{1,120}\/image$|^\/assets\/[-\w./]{1,200}$/.test(url)?url:'';}
    function normalizeChat(chat){
        return (Array.isArray(chat)?chat:[]).slice(-LIMITS.chat).filter(item=>item&&['user','ai'].includes(item.role)).map(item=>({role:item.role,text:str(item.text,LIMITS.chatText),...(Array.isArray(item.choices)&&item.choices.length?{choices:item.choices.slice(0,LIMITS.choices).map(choice=>str(choice,LIMITS.choice)).filter(Boolean)}:{}),...(['answer','ask','prompt','note','image','gallery','image_delete'].includes(item.kind)?{kind:item.kind}:{}),...(item.kind==='gallery'&&imageUrl(item.picked)?{picked:imageUrl(item.picked)}:{}),...(Array.isArray(item.images)&&['image','gallery','image_delete'].includes(item.kind)?{images:item.images.slice(0,item.kind==='image_delete'?500:60).map(image=>({url:imageUrl(image?.url),name:str(image?.name,200),id:str(image?.id,90)})).filter(image=>image.url)}:{}),...(item.kind==='gallery'&&item.gallery?{gallery:{page:clamp(item.gallery.page,1,1000000,1),pageSize:8,total:clamp(item.gallery.total,0,10000000,0),totalPages:clamp(item.gallery.totalPages,1,1000000,1)}}:{}),...(item.kind==='image_delete'&&item.proposal?{proposal:{id:str(item.proposal.id,90),status:['pending','confirmed','cancelled','restored'].includes(item.proposal.status)?item.proposal.status:'cancelled',expiresAt:str(item.proposal.expiresAt,40)},reviewPage:clamp(item.reviewPage,1,63,1)}:{}),...(['abbr','rule'].includes(item.purpose)?{purpose:item.purpose}:{}),...(item.purpose==='rule'&&item.rule?.item?{rule:{section:str(item.rule.section,20),item:str(item.rule.item,300)}}:{}),...(item.kind==='prompt'?promptSnapshot(item):{})}));
    }
    // Sources are matched by stable identity each month; tool sources only feed the AI-written summary.
    function normalizeSource(source,index){
        if(!source||typeof source!=='object')invalid('Invalid recipe source');
        const sourceId=typeof source.id==='string'&&/^[a-z]\w{0,20}$/i.test(source.id)?source.id:'s'+(index+1);
        if(source.kind==='sheet'){const match=source.match||{};if(!str(match.sourceKey,300)&&!str(match.tableName,300))invalid('Sheet source needs a table identity');return {id:sourceId,kind:'sheet',label:str(source.label,200),match:{sourceKey:str(match.sourceKey,300),tableName:str(match.tableName,300),sheetName:str(match.sheetName,200),kind:str(match.kind,40)},monthOffset:clamp(source.monthOffset,-24,0,0)};}
        if(source.kind==='metrics')return {id:sourceId,kind:'metrics',label:str(source.label,200),names:(Array.isArray(source.names)?source.names:[]).slice(0,60).map(name=>str(name,200)).filter(Boolean),keys:(Array.isArray(source.keys)?source.keys:[]).slice(0,60).map(key=>str(key,300)).filter(Boolean),monthOffset:clamp(source.monthOffset,-24,0,0)};
        if(source.kind==='dataset'){const dataset=str(source.dataset,400);if(!dataset)invalid('Dataset source needs a dataset id');return {id:sourceId,kind:'dataset',label:str(source.label,200),dataset,monthOffset:clamp(source.monthOffset,-24,0,0)};}
        // The report itself: its outline (chapters, cells, anchors) or also the other cells' results and summaries.
        if(source.kind==='report')return {id:sourceId,kind:'report',label:str(source.label,200),include:source.include==='results'?'results':'outline',chapters:(Array.isArray(source.chapters)?source.chapters:[]).slice(0,LIMITS.chapters).map(item=>str(item,80)).filter(Boolean)};
        if(source.kind==='tool')return {id:sourceId,kind:'tool',label:str(source.label,200),slug:str(source.slug,120),question:str(source.question,1000)};
        invalid('Unknown recipe source kind');
    }
    function normalizeRecipe(recipe){
        if(!recipe||typeof recipe!=='object')invalid('Invalid recipe');
        const sources=(Array.isArray(recipe.sources)?recipe.sources:[]).slice(0,LIMITS.sources).map(normalizeSource);
        const compute=str(recipe.compute,LIMITS.code),render=str(recipe.render,LIMITS.code);
        if(!/function\s+compute\s*\(/.test(compute))invalid('Recipe compute must define function compute(input)');
        if(!/function\s+render\s*\(/.test(render))invalid('Recipe render must define function render(result, kit)');
        return {summary:pair(recipe.summary,1000),sources,compute,render,narrative:recipe.narrative&&str(recipe.narrative.prompt,2000)?{prompt:str(recipe.narrative.prompt,2000)}:null};
    }
    function normalizeOutput(output){
        let result=null;try{const text=JSON.stringify(output.result??null);result=text.length<=LIMITS.result?JSON.parse(text):null;}catch(_){result=null;}
        let widgets=[];try{const list=(Array.isArray(output.widgets)?output.widgets:[]).filter(item=>item&&/^w\d{1,3}$/.test(item.id)&&['chart','datatable','tabs'].includes(item.type)).slice(0,40);widgets=JSON.stringify(list).length<=LIMITS.widgets?JSON.parse(JSON.stringify(list)):[];}catch(_){widgets=[];}
        return {month:validMonth(output.month)?output.month:'',html:str(output.html,LIMITS.html),widgets,result,narrative:pair(output.narrative,4000),narrativeMonth:validMonth(output.narrativeMonth)?output.narrativeMonth:'',error:str(output.error,2000),generatedAt:str(output.generatedAt,40)};
    }
    // Report-wide style: its own conversation and prompt, compiled into a theme that only changes look and tone, never structure.
    const hex=(value,fallback='')=>/^#[0-9a-f]{6}$/i.test(value||'')?value.toLowerCase():fallback;
    function normalizeTheme(input){
        if(!input||typeof input!=='object')return null;
        const palette=(Array.isArray(input.palette)?input.palette:[]).map(color=>hex(color)).filter(Boolean).slice(0,8);
        // Frame around the report and lines between cells; reports themed before these existed get the defaults.
        return {accent:hex(input.accent,'#1f5e95'),accentSoft:hex(input.accentSoft,'#e6f0fa'),heading:hex(input.heading,'#132c45'),surface:hex(input.surface,'#ffffff'),palette:palette.length>=3?palette:[],font:input.font==='serif'?'serif':'sans',radius:clamp(input.radius,0,16,8),
            frame:['double','single','none'].includes(input.frame)?input.frame:'double',frameColor:hex(input.frameColor),dividers:['line','dashed','none'].includes(input.dividers)?input.dividers:'line',dividerColor:hex(input.dividerColor),panels:['box','none'].includes(input.panels)?input.panels:'box'};
    }
    // The report-wide prompt: its look (【风格与配色】, the only part the theme reads) plus the rules every cell follows
    // when it is written, in categories of one-line items the user edits or changes through the style chat.
    const STYLE_SECTION='【风格与配色】';
    const DEFAULT_RULES=[
        '【数据与计算】',
        '- 所有数字都由数据计算得出，不写死、不用示例数据；本月取不到数据时如实说明缺少数据。',
        '- 指标按名称取数（同一个指标换月后 key 可能变化）；用到的指标都要列入数据来源。',
        '- 名称里带“增量、差值、变化、环比、同比、占比、达成率”的计算型指标，以算出的结果作为主数值展示。',
        '- 判断是否达标、计算与目标的差距时，使用预警目标配置中的当月目标值，不写死目标。',
        '【文字与结论】',
        '- 每个格子只保留一段文字总结：默认显示在格子顶部；提示词指定了位置时放在指定位置。',
        '- 写“最高 / 最低”“最优 / 最差”时要处理并列：全部相同时写“均为 X，持平”，并列时列出所有名称。',
        '- 指标卡下方的变化写成“较上月 +2”“与上月持平”，不单独显示没有说明的数字。',
        '【排版与图表】',
        '- 格子宽度不超过 4/12 栏时，所有内容从上到下排列，一行只放一个内容块。',
        '- 一个格子里有多个内容块时，用小格子排版；长名称截断或缩写，鼠标悬停时显示全称。',
        '- 鼠标悬停、高亮时图形和文字不能消失；坐标轴标签、图例和文字不能超出格子边界。'
    ].join('\n');
    const DEFAULT_STYLE=`${STYLE_SECTION}\n- 使用平台默认的蓝色商务风格（还没有定制，可以在对话里说明想要的主题、色调和语气）。\n- 月报四周用双线边框包围（外粗内细）；格子之间用细线分隔，不用卡片边框。\n- 不显示标题的章节（快速导航、本月概述）用浅色细线框围成面板，彼此间距紧凑。\n${DEFAULT_RULES}`;
    // Reports from before the rules existed: their style words become the first category, the rules follow.
    function structuredStyle(prompt){
        const text=String(prompt||'').trim();
        if(!text)return DEFAULT_STYLE;
        if(/^【[^】\n]+】/m.test(text))return text;
        return `${STYLE_SECTION}\n${text.split(/\n+/).map(line=>line.trim()).filter(Boolean).map(line=>/^[-•·]/.test(line)?'- '+line.replace(/^[-•·]\s*/,''):'- '+line).join('\n')}\n${DEFAULT_RULES}`;
    }
    // The prompt as categories of items, so chat edits change only the items they name (the model lists the changes,
    // it does not rewrite the text, which used to reword untouched items).
    function styleSections(text){
        const sections=[];let current=null;
        for(const raw of String(text||'').split('\n')){
            const line=raw.trim();if(!line)continue;
            const head=line.match(/^【([^】]+)】\s*(.*)$/);
            if(head){current={name:head[1].trim(),items:[]};sections.push(current);if(head[2])current.items.push(head[2].replace(/^[-•·]\s*/,''));continue;}
            if(!current){current={name:STYLE_SECTION.slice(1,-1),items:[]};sections.push(current);}
            current.items.push(line.replace(/^[-•·]\s*/,''));
        }
        return sections;
    }
    const formatStyle=sections=>sections.filter(section=>section.items.length).map(section=>`【${section.name}】\n${section.items.map(item=>'- '+item).join('\n')}`).join('\n');
    function applyStyleChanges(text,changes){
        const sections=styleSections(text),skipped=[],plain=value=>String(value||'').replace(/^[-•·]\s*/,'').replace(/\s+/g,'').replace(/[。.；;]+$/,'');
        const locate=item=>{
            const wanted=plain(item);if(!wanted)return null;
            for(const same of [found=>found===wanted,found=>found.includes(wanted)||wanted.includes(found)])
                for(const section of sections){const index=section.items.findIndex(found=>same(plain(found)));if(index>=0)return {section,index};}
            return null;
        };
        for(const change of Array.isArray(changes)?changes:[]){
            const item=String(change?.item||'').trim().replace(/^[-•·]\s*/,'');
            if(change?.action==='add'){
                const name=String(change.section||'').replace(/[【】]/g,'').trim()||'其他要求';if(!item)continue;
                let section=sections.find(found=>found.name===name);if(!section){section={name,items:[]};sections.push(section);}
                if(!section.items.some(found=>plain(found)===plain(item)))section.items.push(item);
            }else if(change?.action==='remove'||change?.action==='replace'){
                const at=locate(item);if(!at){skipped.push(change);continue;}
                const to=String(change.to||'').trim().replace(/^[-•·]\s*/,'');
                if(change.action==='remove')at.section.items.splice(at.index,1);else if(to)at.section.items[at.index]=to;
            }
        }
        return {prompt:formatStyle(sections),skipped};
    }
    // A plain style text from the model replaces the 【风格与配色】 items and keeps every other category.
    function withStyleText(text,style){
        const sections=styleSections(text),lines=String(style||'').split(/\n+/).map(line=>line.trim().replace(/^[-•·]\s*/,'')).filter(Boolean);
        const section=sections.find(found=>found.name===STYLE_SECTION.slice(1,-1));
        if(section)section.items=lines;else sections.unshift({name:STYLE_SECTION.slice(1,-1),items:lines});
        return formatStyle(sections);
    }
    function normalizeStyle(input={}){
        const before=str(input.prompt,LIMITS.prompt),prompt=str(structuredStyle(before),LIMITS.prompt),chat=normalizeChat(input.chat);
        let themePrompt=str(input.themePrompt,LIMITS.prompt);
        if(prompt!==before){
            if(themePrompt&&themePrompt===before)themePrompt=prompt;
            const latest=[...chat].reverse().find(item=>item.kind==='prompt');
            if(latest&&latest.text===before)latest.text=prompt;
        }
        // The prompt is shown in the style chat like a cell's final prompt, ready to edit or apply.
        if(!chat.some(item=>item.kind==='prompt'))chat.push({role:'ai',kind:'prompt',text:prompt});
        return {prompt,chat,theme:normalizeTheme(input.theme),themePrompt};
    }
    function normalizeTemplate(input={}){
        return {logo:str(input.logo,500)||'/assets/logo.png',logoWidth:clamp(input.logoWidth,40,400,120),title:pair(input.title,300),subtitle:pair(input.subtitle,300),meta:(Array.isArray(input.meta)?input.meta:[]).slice(0,LIMITS.meta).map(item=>({id:id(item?.id,'meta'),label:pair(item?.label,200),value:pair(item?.value,2000),span:clamp(item?.span,1,12,4)})),footer:pair(input.footer,2000),...templateFields(input.fields,input.prompts),...templateImages(input.images)};
    }
    // Header text as prompt engineering: each field (title, subtitle, meta values, footer) has its own conversation and
    // prompt, like a cell. A prompt that starts with “固定文字：” is shown as written; any other prompt is filled in by
    // the AI for the report month. Older reports stored bare prompts; they become a conversation with that prompt.
    const FIELD_KEY=/^(title|subtitle|footer|meta-value:[-\w]{1,80})$/;
    function templateFields(input,legacy){
        const fields={},source=input&&typeof input==='object'?input:{};
        for(const [key,value] of Object.entries(source).slice(0,60)){
            if(!FIELD_KEY.test(key)||!value||typeof value!=='object')continue;
            const field={prompt:str(value.prompt,2000).trim(),chat:normalizeChat(value.chat),appliedPrompt:str(value.appliedPrompt,2000)};
            if(field.prompt||field.chat.length)fields[key]=field;
        }
        if(legacy&&typeof legacy==='object')for(const [key,value] of Object.entries(legacy).slice(0,60)){
            const prompt=str(value,2000).trim();if(!FIELD_KEY.test(key)||!prompt||fields[key])continue;
            fields[key]={prompt,chat:[{role:'ai',kind:'prompt',text:prompt,edited:true}],appliedPrompt:prompt};
        }
        return Object.keys(fields).length?{fields}:{};
    }
    const FIXED_PREFIX='固定文字：';
    // Built-in base prompt for each image slot; a user's image prompt adds to it (style, subject), never replaces it.
    const IMAGE_BASE={logo:'月报 LOGO：扁平矢量风格，简洁专业，在 120px 宽度下也清晰可辨；画布 1:1（viewBox="0 0 512 512"）；透明背景；主色使用月报主题色，整体不超过 3 种颜色；图形在画布中居中，四周留白均匀；图形为主，若有文字只用一个简短的英文缩写或两三个汉字，无衬线粗体；不画细线、小字、照片质感或复杂渐变。'};
    const IMAGE_KEY=/^logo$/;
    function templateImages(input){
        const images={};
        if(input&&typeof input==='object')for(const [key,value] of Object.entries(input)){
            if(!IMAGE_KEY.test(key)||!value||typeof value!=='object')continue;
            const undo=(Array.isArray(value.undo)?value.undo:[]).slice(-20).map(item=>({url:imageUrl(item?.url),width:clamp(item?.width,40,400,120)})).filter(item=>item.url);
            const image={prompt:str(value.prompt,2000).trim(),chat:normalizeChat(value.chat),...(undo.length?{undo}:{})};
            if(image.prompt||image.chat.length)images[key]=image;
        }
        return Object.keys(images).length?{images}:{};
    }
    const fixedText=prompt=>{const text=String(prompt||'');return text.startsWith(FIXED_PREFIX)?text.slice(FIXED_PREFIX.length):null;};
    function normalize(input){
        if(!input||typeof input!=='object')invalid('Invalid report');
        const chapters=(Array.isArray(input.chapters)?input.chapters:[]).slice(0,LIMITS.chapters).map(chapter);
        return {version:1,id:typeof input.id==='string'&&/^[-\w]{1,80}$/.test(input.id)?input.id:'',name:str(input.name,LIMITS.name).trim()||'AI 月报',reportMonth:validMonth(input.reportMonth)?input.reportMonth:'',template:normalizeTemplate(input.template),style:normalizeStyle(input.style),chapters:chapters.length?chapters:[chapter({title:bilingual('整体情况','Overview'),cells:[cell()]})],updatedAt:str(input.updatedAt,40)};
    }
    // The existing monthly template keeps its header, meta fields, chapter titles and footer; its old components are dropped.
    function fromLegacyTemplate(legacy,reportMonth=''){
        const doc=legacy?.document||legacy||{};
        return normalize({name:doc.name||'AI 月报',reportMonth,template:{logo:doc.logo,logoWidth:doc.logoWidth,title:doc.title,subtitle:doc.subtitle,meta:(doc.meta||[]).map(item=>({label:item.label,value:item.value,span:item.span})),footer:doc.footer},chapters:(doc.sections||[]).filter(section=>!section.overview).map(section=>({title:section.title,cells:[cell({span:12})]}))});
    }
    function text(value,language='zh'){return value?(value[language]||value.zh||value.en||''):'';}
    function cells(doc){return doc.chapters.flatMap(item=>item.cells);}
    function findCell(doc,cellId){for(const item of doc.chapters){const index=item.cells.findIndex(entry=>entry.id===cellId);if(index>=0)return {chapter:item,cell:item.cells[index],index};}return null;}
    return {IMAGE_BASE,IMAGE_KEY,imageUrl,FIELD_KEY,FIXED_PREFIX,fixedText,LIMITS,DEFAULT_STYLE,structuredStyle,styleSections,applyStyleChanges,withStyleText,validMonth,uid,bilingual,cell,chapter,normalize,normalizeRecipe,normalizeOutput,normalizeTheme,fromLegacyTemplate,text,cells,findCell};
});
