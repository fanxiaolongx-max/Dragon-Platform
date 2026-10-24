/* Trusted renderer for recipe widgets. Recipes only produce JSON specs; this code turns them into ECharts charts,
   sortable/searchable tables and tabs, or freezes them into static SVG/HTML for mail and print. */
(function(){
    'use strict';
    const live=[];
    // UI state (drill path, filters, search, sort, page) survives re-renders; a regenerated output brings new spec objects
    // and therefore starts fresh.
    const memory=new WeakMap();
    const remember=widget=>{if(!memory.has(widget))memory.set(widget,{});return memory.get(widget);};
    const DEFAULT_PALETTE=['#2f6fae','#3aa18f','#e0a33a','#c8566b','#7a63b8','#5b8fd1','#8aa34a','#d07a3c'];

    // Specs are data only. Strings lose angle brackets (no HTML in tooltips) and images must be inline data URLs.
    function cleanValue(value,key=''){
        if(typeof value==='string'){if(/^(image|backgroundImage|symbol)$/i.test(key)&&/^(https?:|\/\/|url\()/i.test(value.trim()))return '';return value.replace(/[<>]/g,'');}
        if(Array.isArray(value))return value.slice(0,20000).map(item=>cleanValue(item,key));
        if(value&&typeof value==='object'){const out={};for(const [name,item] of Object.entries(value)){if(name==='__proto__'||name==='constructor')continue;out[name]=cleanValue(item,name);}return out;}
        return typeof value==='number'||typeof value==='boolean'||value===null?value:undefined;
    }
    const cleanSpecs=list=>(Array.isArray(list)?list:[]).map(item=>({id:String(item.id),type:item.type,...(item.alias?{alias:String(item.alias).slice(0,60)}:{}),spec:cleanValue(item.spec)}));

    const baseOption=spec=>spec&&spec.option&&typeof spec.option==='object'?spec.option:spec;
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    // ECharts cannot read CSS variables: a colour like var(--air-accent) shows at rest but its hover shade becomes invalid
    // and the shape vanishes. Variables are resolved to real colours, and hover/blur states always stay visible.
    const VAR=/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g;
    function resolver(palette,root){
        const styles=root&&root.isConnected?getComputedStyle(root):null;
        return name=>{const live=styles?.getPropertyValue(name).trim();if(live)return live;const index=name.match(/^--kit-c(\d)$/);if(index)return palette[Number(index[1])%palette.length];return name==='--air-accent'?palette[0]:'';};
    }
    const HIDDEN=/^(transparent|none|rgba\([^)]*,\s*0(?:\.0+)?\))$/i;
    function keepVisible(value,state=''){
        if(Array.isArray(value))return value.map(item=>keepVisible(item,state));
        if(!value||typeof value!=='object')return value;
        const out={};
        for(const [key,item] of Object.entries(value)){
            const inState=state||(['emphasis','blur','select'].includes(key)?key:'');
            if(inState&&['color','borderColor'].includes(key)&&typeof item==='string'&&HIDDEN.test(item.trim()))continue;
            if(inState&&key==='opacity'&&typeof item==='number'){out[key]=Math.max(inState==='blur'?0.35:0.6,item);continue;}
            out[key]=keepVisible(item,inState);
        }
        return out;
    }
    // Compact, in-bounds defaults the recipe can still override: tight grid with axis labels inside it, overlapping
    // labels hidden, and long category labels truncated (the tooltip keeps the full name).
    function compactDefaults(option){
        const axes=key=>option[key]===undefined?null:(Array.isArray(option[key])?option[key]:[option[key]]);
        if(!axes('xAxis')&&!axes('yAxis'))return option;
        const grid=Array.isArray(option.grid)?option.grid:{top:option.legend?36:14,right:16,bottom:6,left:8,...(option.grid||{})};
        if(!Array.isArray(grid)&&grid.containLabel===undefined)grid.containLabel=true;
        // containLabel already reserves room for axis labels, so wide paddings (20px, '10%') only leave blank strips.
        if(!Array.isArray(grid)&&grid.containLabel){
            const legend=[].concat(option.legend||[])[0],below=legend&&legend.show!==false&&(legend.bottom!==undefined||legend.top==='bottom'),above=legend&&legend.show!==false&&!below;
            const cap=(value,max)=>{const text=String(value??'').trim();return /^\d+(\.\d+)?$/.test(text)?Math.min(Number(text),max):/^\d+(\.\d+)?%$/.test(text)?max:value;};
            Object.assign(grid,{top:cap(grid.top,above?44:24),bottom:cap(grid.bottom,below?36:10),left:cap(grid.left,12),right:cap(grid.right,48)});
        }
        const tidy=list=>list&&list.map(axis=>{
            // A hidden axis still gets label room from containLabel unless its labels are hidden too.
            if(axis&&typeof axis==='object'&&axis.show===false)return {...axis,axisLabel:{...(axis.axisLabel||{}),show:false},axisTick:{show:false},axisLine:{show:false}};
            if(!axis||typeof axis!=='object'||(axis.type&&axis.type!=='category'&&!Array.isArray(axis.data)))return axis;
            const longest=Math.max(0,...(axis.data||[]).map(item=>String(item?.value??item??'').length));
            return {...axis,axisLabel:{hideOverlap:true,...(longest>8?{width:96,overflow:'truncate'}:{}),...(axis.axisLabel||{})}};
        });
        // No zoom sliders or wheel-zoom in report charts: the wheel must keep scrolling the page.
        const out={...option,grid};delete out.dataZoom;
        const x=tidy(axes('xAxis')),y=tidy(axes('yAxis'));
        if(x)out.xAxis=Array.isArray(option.xAxis)?x:x[0];if(y)out.yAxis=Array.isArray(option.yAxis)?y:y[0];
        return out;
    }
    function chartOption(spec,palette,root){
        const lookup=resolver(palette,root);
        const resolve=value=>typeof value==='string'?value.replace(VAR,(_,name,fallback)=>lookup(name)||(fallback||'').trim()||palette[0]):Array.isArray(value)?value.map(resolve):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolve(item)])):value;
        const option=compactDefaults(keepVisible(resolve(cleanValue(baseOption(spec))||{})));
        return {color:palette,textStyle:{fontFamily:'inherit'},tooltip:{trigger:'axis',confine:true},...option,animationDuration:option.animationDuration??500};
    }
    function staticTable(spec,limit=500){
        const rows=(spec.rows||[]).slice(0,limit),note=(spec.rows||[]).length>rows.length?`<div class="kit-note">共 ${spec.rows.length} 行，静态版显示前 ${rows.length} 行</div>`:'';
        return window.AiReportKit.table(rows,{columns:spec.columns})+note;
    }
    function chartSvg(spec,palette,height){
        if(!window.echarts)return '<div class="kit-empty">（交互图表）</div>';
        const chart=window.echarts.init(null,null,{renderer:'svg',ssr:true,width:720,height});
        chart.setOption({...chartOption(spec,palette),animation:false});
        const svg=chart.renderToSVGString();chart.dispose();
        return svg.replace(/<svg /,'<svg class="kit-chart" preserveAspectRatio="xMidYMid meet" ')+(spec?.drill?'<div class="kit-note">交互版可点击下钻查看明细</div>':'');
    }

    function datatable(element,spec,link,saved={}){
        const columns=spec.columns||[],all=spec.rows||[];let {query='',sortKey=null,direction=1,page=0}=saved,filters=[],clear=null;
        element.innerHTML=`<div class="kit-dt-bar"><span class="kit-dt-chips"></span>${spec.search!==false?`<input type="search" placeholder="搜索表格…" aria-label="搜索表格">`:''}<span class="kit-dt-count"></span></div><div class="kit-dt-table"></div><div class="kit-dt-pager"><button type="button" data-dt="prev" aria-label="上一页">‹</button><span></span><button type="button" data-dt="next" aria-label="下一页">›</button></div>`;
        const tableNode=element.querySelector('.kit-dt-table'),pager=element.querySelector('.kit-dt-pager span'),count=element.querySelector('.kit-dt-count');
        const compare=(a,b)=>{const x=a?.[sortKey],y=b?.[sortKey],nx=Number(x),ny=Number(y);return (Number.isFinite(nx)&&Number.isFinite(ny)?nx-ny:String(x??'').localeCompare(String(y??''),'zh'))*direction;};
        function paint(){
            const needle=query.trim().toLowerCase(),linked=all.filter(row=>filters.every(filter=>String(row?.[filter.field]??'')===String(filter.value))),filtered=needle?linked.filter(row=>columns.some(column=>String(row?.[column.key]??'').toLowerCase().includes(needle))):linked;
            const chips=element.querySelector('.kit-dt-chips');chips.innerHTML=filters.map(filter=>`<span class="kit-dt-chip">${esc((columns.find(column=>column.key===filter.field)?.label)||filter.field)} = ${esc(filter.value)}</span>`).join('')+(filters.length?`<button type="button" class="kit-dt-clear" aria-label="清除筛选" title="清除筛选">×</button>`:'');
            chips.querySelector('.kit-dt-clear')?.addEventListener('click',()=>clear?.());
            const sorted=sortKey?[...filtered].sort(compare):filtered,pages=Math.max(1,Math.ceil(sorted.length/spec.pageSize));page=Math.min(page,pages-1);
            tableNode.innerHTML=window.AiReportKit.table(sorted.slice(page*spec.pageSize,(page+1)*spec.pageSize),{columns,maxRows:spec.pageSize});
            tableNode.querySelectorAll('th').forEach((cell,index)=>{const key=columns[index]?.key;cell.classList.add('kit-sortable');cell.tabIndex=0;cell.setAttribute('aria-sort',key===sortKey?(direction>0?'ascending':'descending'):'none');cell.onclick=()=>{direction=sortKey===key?-direction:1;sortKey=key;paint();};cell.onkeydown=event=>{if(event.key==='Enter')cell.click();};});
            Object.assign(saved,{query,sortKey,direction,page});
            pager.textContent=`${page+1} / ${pages}`;if(count)count.textContent=`共 ${sorted.length} 条`;
            element.querySelector('[data-dt=prev]').disabled=page===0;element.querySelector('[data-dt=next]').disabled=page>=pages-1;
        }
        const search=element.querySelector('input');if(search)search.value=query;
        search?.addEventListener('input',event=>{query=event.target.value;page=0;paint();});
        element.querySelector('[data-dt=prev]').onclick=()=>{page--;paint();};element.querySelector('[data-dt=next]').onclick=()=>{page++;paint();};
        if(link)link.tables.set(link.alias,{setFilters(next,onClear){filters=next;clear=onClear;page=0;paint();}});
        paint();
    }
    // Drill-down: clicking a data point filters the linked table(s) by the drill field; where the spec has a level for
    // that name the chart opens it (at most three levels including the top). Breadcrumbs step back; data is precomputed.
    const MAX_DEPTH=2;
    const levelOf=value=>value&&typeof value==='object'?(value.option?{option:value.option,drill:value.drill||null}:{option:value,drill:null}):null;
    function chartWidget(element,widget,palette,link,saved={}){
        const root={option:baseOption(widget.spec),drill:widget.spec?.drill||null};
        element.innerHTML='<div class="kit-drill-bar" hidden></div><div class="kit-chart-canvas"></div>';
        const bar=element.firstElementChild,canvas=element.lastElementChild,chart=window.echarts.init(canvas,null,{renderer:'svg'});
        let path=[],leaf=null;
        const current=()=>path.length?path[path.length-1].level:root;
        for(const value of saved.path||[]){const drill=current().drill,next=levelOf(drill?.levels?.[value]);if(!next||path.length>=MAX_DEPTH)break;path.push({field:drill.field,value,level:next});}
        leaf=saved.leaf||null;
        const targets=()=>[root,...path.map(step=>step.level)].flatMap(level=>[].concat(level.drill?.target||[])).filter(Boolean);
        const reset=()=>{path=[];leaf=null;show();};
        function show(){
            saved.path=path.map(step=>step.value);saved.leaf=leaf;
            chart.setOption(chartOption(current().option,palette,element.closest('.air-report')),true);
            const filters=[...path.map(step=>({field:step.field,value:step.value})),...(leaf?[leaf]:[])].filter(filter=>filter.field);
            bar.hidden=!path.length&&!leaf;
            bar.innerHTML=`<button type="button" data-depth="0">全部</button>${path.map((step,index)=>`<span>›</span><button type="button" data-depth="${index+1}">${esc(step.value)}</button>`).join('')}${leaf?`<span>›</span><b>${esc(leaf.value)}</b>`:''}`;
            for(const alias of new Set(targets()))link.tables.get(alias)?.setFilters(filters,reset);
        }
        bar.addEventListener('click',event=>{const button=event.target.closest('[data-depth]');if(!button)return;path=path.slice(0,Number(button.dataset.depth));leaf=null;show();});
        chart.on('click',params=>{
            const drill=current().drill,value=String(params.name||params.seriesName||'');if(!drill||!value)return;
            const next=levelOf(drill.levels?.[value]);
            if(next&&path.length<MAX_DEPTH){path.push({field:drill.field,value,level:next});leaf=null;}
            else if(drill.field)leaf=leaf?.value===value?null:{field:drill.field,value};
            else return;
            show();
        });
        if(root.drill)canvas.classList.add('is-drillable');
        // Redrawn at most once a frame while a cell or block is being resized.
        let pending=0;const observer=new ResizeObserver(()=>{if(!pending)pending=requestAnimationFrame(()=>{pending=0;if(!chart.isDisposed?.())chart.resize();});});observer.observe(canvas);live.push({chart,observer});
        show();
    }
    function tabs(element,spec){
        const panels=[...element.querySelectorAll(':scope > .kit-tab-panel')];if(panels.length<2)return;
        const bar=document.createElement('div');bar.className='kit-tabs';bar.setAttribute('role','tablist');
        const show=index=>{panels.forEach((panel,i)=>{panel.hidden=i!==index;});bar.querySelectorAll('button').forEach((button,i)=>button.setAttribute('aria-selected',String(i===index)));};
        (spec.labels||[]).forEach((label,index)=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.textContent=label;button.onclick=()=>show(index);bar.append(button);});
        element.classList.add('is-tabs');element.prepend(bar);show(0);
    }

    function each(root,lookup,visit){
        root.querySelectorAll('[data-widget]').forEach(element=>{if(element.dataset.hydrated)return;const cellId=element.closest('[data-cell]')?.dataset.cell,widget=lookup(cellId,element.dataset.widget);if(widget)visit(element,widget);});
    }
    function dispose(){while(live.length){const item=live.pop();item.observer?.disconnect();item.chart?.dispose();}}
    // Live mode: interactive charts and tables in the page (and in exported HTML files).
    function hydrate(root,lookup,{palette=DEFAULT_PALETTE}={}){
        dispose();
        const links=new Map(),linkOf=element=>{const cell=element.closest('[data-cell]')||root;if(!links.has(cell))links.set(cell,{tables:new Map()});return links.get(cell);};
        const charts=[];
        each(root,lookup,(element,widget)=>{
            element.dataset.hydrated='1';
            if(widget.type==='chart'&&window.echarts)charts.push([element,widget]);
            else if(widget.type==='datatable')datatable(element,widget.spec,widget.alias?{...linkOf(element),alias:widget.alias}:null,remember(widget));
            else if(widget.type==='tabs')tabs(element,widget.spec);
        });
        for(const [element,widget] of charts)chartWidget(element,widget,palette,linkOf(element),remember(widget));
    }
    // Static mode: charts become SVG, tables show every row (up to 500), tabs stay stacked with headings.
    function freeze(root,lookup,{palette=DEFAULT_PALETTE}={}){
        each(root,lookup,(element,widget)=>{
            element.dataset.hydrated='1';
            if(widget.type==='chart'){element.innerHTML=chartSvg(widget.spec,palette,parseInt(element.style.height,10)||320);element.style.height='auto';}
            else if(widget.type==='datatable')element.innerHTML=staticTable(widget.spec);
        });
    }
    const paletteOf=theme=>theme?.palette?.length?[...theme.palette,...DEFAULT_PALETTE].slice(0,8):DEFAULT_PALETTE;
    window.AiReportWidgets={cleanSpecs,hydrate,freeze,dispose,paletteOf};
})();
