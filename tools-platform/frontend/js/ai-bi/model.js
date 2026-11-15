/* AI BI board: a free canvas of cells. Each cell is an AI report cell (prompt → recipe → output) with a position.
   Shared by the page and both servers (save validation), like ai-report/report-model.js. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AiBiModel=api;})(typeof self!=='undefined'?self:typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const LIMITS={name:120,items:60,prompt:4000,chat:120,chatText:4000,html:300000,widgets:600000,code:30000,payload:6*1024*1024};
    // Common canvases: the AI picks one from the conversation, the user can switch or type any size.
    const PRESETS=[
        {id:'16x9',label:'16:9 看板（1920×1080）',labelEn:'16:9 dashboard',width:1920,height:1080},
        {id:'4x3',label:'4:3（1600×1200）',labelEn:'4:3',width:1600,height:1200},
        {id:'a4-landscape',label:'A4 横向（1754×1240）',labelEn:'A4 landscape',width:1754,height:1240},
        {id:'a4-portrait',label:'A4 竖向（1240×1754）',labelEn:'A4 portrait',width:1240,height:1754},
        {id:'wall-32x9',label:'超宽大屏 32:9（3840×1080）',labelEn:'Video wall 32:9',width:3840,height:1080},
        {id:'4k',label:'4K 大屏（3840×2160）',labelEn:'4K wall',width:3840,height:2160},
        {id:'phone',label:'手机竖屏（1080×1920）',labelEn:'Phone portrait',width:1080,height:1920},
        {id:'long',label:'长图（1240×3200）',labelEn:'Long page',width:1240,height:3200},
    ];
    const GRID=8;
    const uid=prefix=>prefix+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    const str=(value,max)=>typeof value==='string'?value.slice(0,max):'';
    const int=(value,min,max,fallback)=>{const number=Math.round(Number(value));return Number.isFinite(number)?Math.min(max,Math.max(min,number)):fallback;};
    const snap=value=>Math.round(value/GRID)*GRID;
    const color=value=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toLowerCase():'';
    const validMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'');
    function canvas(input={}){
        return {width:int(input.width,320,7680,1920),height:int(input.height,240,8000,1080),background:color(input.background)||'#f4f6f9',gap:int(input.gap,0,64,16)};
    }
    // Items stay inside the canvas and keep a usable size.
    function place(item,size){
        const w=int(item.w,120,size.width,480),h=int(item.h,80,size.height,300);
        return {x:int(item.x,0,size.width-w,0),y:int(item.y,0,size.height-h,0),w,h};
    }
    function chat(list){return (Array.isArray(list)?list:[]).slice(-LIMITS.chat).filter(entry=>entry&&typeof entry==='object').map(entry=>({role:entry.role==='user'?'user':'ai',text:str(entry.text,LIMITS.chatText),...(entry.kind?{kind:str(entry.kind,20)}:{}),...(Array.isArray(entry.choices)?{choices:entry.choices.slice(0,6).map(choice=>str(choice,200))}:{})}));}
    function recipe(input){
        if(!input||typeof input!=='object'||typeof input.compute!=='string'||typeof input.render!=='string')return null;
        return {summary:input.summary&&typeof input.summary==='object'?{zh:str(input.summary.zh,1000),en:str(input.summary.en,1000)}:{zh:'',en:''},sources:Array.isArray(input.sources)?JSON.parse(JSON.stringify(input.sources.slice(0,8))):[],compute:str(input.compute,LIMITS.code),render:str(input.render,LIMITS.code),narrative:null};
    }
    function output(input){
        if(!input||typeof input!=='object')return null;
        const widgets=Array.isArray(input.widgets)?input.widgets:[];
        return {html:str(input.html,LIMITS.html),widgets:JSON.stringify(widgets).length<=LIMITS.widgets?JSON.parse(JSON.stringify(widgets)):[],month:validMonth(input.month)?input.month:'',error:str(input.error,2000),generatedAt:str(input.generatedAt,40)};
    }
    function item(input={},size=canvas()){
        return {id:typeof input.id==='string'&&/^[-\w]{1,80}$/.test(input.id)?input.id:uid('item'),title:str(input.title,80),...place(input,size),
            prompt:str(input.prompt,LIMITS.prompt),recipePrompt:str(input.recipePrompt,LIMITS.prompt),chat:chat(input.chat),recipe:recipe(input.recipe),output:output(input.output),
            ...(input.frame===false?{frame:false}:{}),...(Number(input.scale)>=0.5&&Number(input.scale)<=4?{scale:Math.round(Number(input.scale)*100)/100}:{})};
    }
    function normalize(input={}){
        const size=canvas(input.canvas);
        return {version:1,id:typeof input.id==='string'&&/^[-\w]{1,80}$/.test(input.id)?input.id:'',name:str(input.name,LIMITS.name).trim()||'未命名看板',
            month:validMonth(input.month)?input.month:'',canvas:size,palette:(Array.isArray(input.palette)?input.palette:[]).map(color).filter(Boolean).slice(0,8),
            items:(Array.isArray(input.items)?input.items:[]).slice(0,LIMITS.items).map(entry=>item(entry,size)),chat:chat(input.chat),updatedAt:str(input.updatedAt,40)};
    }
    // Text and charts grow with big canvases: the short side against 1080 (4K → 2×, 16:9 and 32:9 → 1×), rounded to 0.05.
    const autoScale=size=>Math.max(1,Math.min(3,Math.round(Math.min(size.width,size.height)/1080*20)/20));
    const scaleOf=(entry,size)=>entry.scale||autoScale(size);
    // Rows of a template view get heights that fill the item, so resizing an item never needs the AI.
    function fitView(view,box,T){
        if(!view||!T)return view;
        const rows=view.rows.length,titleH=view.title?26:0,inner=box.h-24-titleH-(rows-1)*10;
        const rowH=Math.max(100,Math.floor(inner/rows));
        return {...view,rows:view.rows.map(row=>row.map(slot=>{const template=T.get(slot.template);if(!template?.params.some(def=>def.key==='height'))return slot;const hasTitle=!!(slot.params?.title);return {...slot,params:{...slot.params,height:Math.max(120,rowH-(hasTitle?24:0))}};}))};
    }
    // Nothing overlaps: an item that collides is pushed down below the one it hits.
    function resolveOverlaps(items,size){
        const placed=[];
        for(const entry of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)){
            let moved={...entry};
            for(let guard=0;guard<items.length*2;guard++){
                const hit=placed.find(other=>moved.x<other.x+other.w&&moved.x+moved.w>other.x&&moved.y<other.y+other.h&&moved.y+moved.h>other.y);
                if(!hit)break;moved.y=snap(hit.y+hit.h+GRID*2);
            }
            moved.y=Math.min(moved.y,Math.max(0,size.height-moved.h));placed.push(moved);
        }
        const byId=new Map(placed.map(entry=>[entry.id,entry]));
        return items.map(entry=>byId.get(entry.id)||entry);
    }
    // ── Conversation → board plan (shared by both servers) ──────────────────────────────────────────────────
    const PLAN_PROMPT=`你是“AI BI”的看板设计师。用户用对话描述想要的看板、报告、大屏或任何数据页面，你来定画布大小和格子布局，并给每个格子写一段“格子提示词”；之后平台会按提示词逐个取数、选模板、生成图表。
画布 canvas：{width,height,background}，单位像素。常用：16:9 看板 1920×1080；4:3 1600×1200；A4 横向 1754×1240；A4 竖向 1240×1754；超宽大屏 32:9 3840×1080；4K 3840×2160；手机竖屏 1080×1920；长图 1240×3200。用户没说时默认 1920×1080。background 用浅色 #RRGGBB（默认 #f4f6f9）。
格子 items：[{id, title, x, y, w, h, prompt}]，坐标以画布左上角为原点，单位像素，取 8 的倍数；四周留 24 边距，格子之间留 16 间距；不能重叠、不能超出画布。
布局原则：
- 最重要的内容放左上；核心数字放最上面一行（高 120–170）；图表格子宽 ≥ 360、高 ≥ 240；明细表放下方或右侧；一屏 5–12 个格子为宜，宁少勿挤。
- 需要页面标题时，用一个顶部通栏格子（高 64–88，prompt 写“只显示标题文字：XXX，可带报告月份（用 input.$month，不写死具体月份）；模板 quote，不设 title 参数”）。
- 同一行的格子高度一致、对齐；画布填满，不留大块空白。
格子 prompt 要写清：用哪些数据（只写下面数据概况里真实存在的指标、导入表、数据集名称）、筛选（默认报告月份）、计算、建议用哪个模板（从模板目录里选 id，一个格子要放几张图就写多个模板和上下左右关系）、标题。时间写“报告月份”“近 6 个月”这类相对说法。
修改已有看板：只改用户要求的部分。没变的格子原样输出（id、位置、prompt 都不变，这样不会重新生成）；只挪位置的格子保持 prompt 不变；要删除的格子不输出。用户正在说某个格子（会注明）时，通常只改它。
只输出一个 JSON 对象，三选一：
{"type":"answer","text":"回答问题（如有哪些数据、能做什么）"}
{"type":"ask","question":"关键信息缺失时才问（完全不知道主题）","choices":["2-4 个可直接点选的选项"]}
{"type":"plan","reply":"一两句话说明做了什么","name":"看板名称","canvas":{"width":1920,"height":1080,"background":"#f4f6f9"},"items":[...]}
能合理假设时直接给 plan，不要反复确认。`;
    function planCatalog(T){
        if(!T)return '';
        return 'AI 月报模板目录（id｜名称｜适用）：\n'+T.TEMPLATES.map(template=>`- ${template.id}｜${template.name.zh}｜${template.use}`).join('\n');
    }
    function boardBrief(board,focus){
        const current=normalize(board||{});
        return JSON.stringify({name:current.name,canvas:current.canvas,items:current.items.map(entry=>({id:entry.id,title:entry.title,x:entry.x,y:entry.y,w:entry.w,h:entry.h,prompt:entry.prompt,...(entry.id===focus?{focus:true}:{})}))});
    }
    // The model's plan, made safe: sizes clamped, positions snapped, overlaps pushed apart, unknown ids treated as new.
    function fromPlan(reply,board){
        const current=normalize(board||{}),size=canvas(reply?.canvas||current.canvas),known=new Map(current.items.map(entry=>[entry.id,entry]));
        const items=(Array.isArray(reply?.items)?reply.items:[]).slice(0,LIMITS.items).map(raw=>{
            const old=known.get(raw?.id),box=place({x:snap(Number(raw?.x)||0),y:snap(Number(raw?.y)||0),w:snap(Number(raw?.w)||480),h:snap(Number(raw?.h)||300)},size);
            const prompt=str(raw?.prompt,LIMITS.prompt).trim()||old?.prompt||'';
            return old?{...old,...box,title:str(raw?.title,80)||old.title,prompt}:item({title:str(raw?.title,80),...box,prompt},size);
        });
        return {name:str(reply?.name,LIMITS.name).trim()||current.name,canvas:size,items:resolveOverlaps(items,size)};
    }

    return {autoScale,scaleOf,PLAN_PROMPT,planCatalog,boardBrief,fromPlan,LIMITS,PRESETS,GRID,uid,snap,canvas,item,normalize,fitView,resolveOverlaps,validMonth};
});
