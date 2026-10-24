/* Rendering helpers for AI recipes. Runs inside the sandbox worker: pure string functions, no DOM or network. */
(function(scope){
    'use strict';
    const PALETTE=['#2f6fae','#3aa18f','#e0a33a','#c8566b','#7a63b8','#5b8fd1','#8aa34a','#d07a3c'];
    // Colours follow the report theme (--kit-c0…7) and fall back to the default palette in plain exports.
    const color=index=>`var(--kit-c${index%PALETTE.length},${PALETTE[index%PALETTE.length]})`;
    const fill=index=>`fill="${PALETTE[index%PALETTE.length]}" style="fill:${color(index)}"`;
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    // Missing or blank values are not numbers: showing them as 0 would look like real data.
    const num=value=>{if(value===null||value===undefined)return null;const text=String(value).replace(/[,%\s]/g,'');if(!text)return null;const number=typeof value==='number'?value:Number(text);return Number.isFinite(number)?number:null;};
    function fmt(value,digits){const number=num(value);if(number===null)return esc(value);const places=digits??(Number.isInteger(number)?0:2);return number.toLocaleString('en-US',{minimumFractionDigits:places,maximumFractionDigits:places});}
    function cellValue(value,format){
        if(value===null||value===undefined||(format&&format!=='text'&&String(value).trim()===''))return '<span class="kit-missing" title="无数据">—</span>';
        if(format==='percent'){const number=num(value);return number===null?esc(value):fmt(Math.abs(number)<=1&&!String(value).includes('%')?number*100:number,1)+'%';}
        if(format==='number')return fmt(value);
        return esc(value);
    }
    const title=text=>text?`<div class="kit-title">${esc(text)}</div>`:'';
    function table(rows,options={}){
        const list=Array.isArray(rows)?rows:[];
        const columns=(options.columns||Object.keys(list[0]||{}).map(key=>({key,label:key}))).map(column=>typeof column==='string'?{key:column,label:column}:column);
        const limit=options.maxRows||200,shown=list.slice(0,limit);
        const head=columns.map(column=>`<th style="text-align:${column.align||'left'}">${esc(column.label??column.key)}</th>`).join('');
        // Cells stay text; a row's $tone ('bad' | 'good') colours the whole row, $tones:{key:'bad'} single cells.
        const tone=value=>value==='bad'||value==='good'?value:'';
        const body=shown.map(row=>{const rowTone=tone(row?.$tone),cellTones=row?.$tones&&typeof row.$tones==='object'?row.$tones:{};return `<tr${rowTone?` class="kit-row-${rowTone}"`:''}>${columns.map(column=>{const cellTone=tone(cellTones[column.key]);return `<td${cellTone?` class="kit-cell-${cellTone}"`:''} style="text-align:${column.align||(column.format&&column.format!=='text'?'right':'left')}">${cellValue(row?.[column.key],column.format)}</td>`;}).join('')}</tr>`;}).join('');
        const more=list.length>shown.length?`<div class="kit-note">共 ${list.length} 行，显示前 ${shown.length} 行</div>`:'';
        return `${title(options.title)}<table class="kit-table"><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${columns.length||1}" class="kit-empty">无数据</td></tr>`}</tbody></table>${more}`;
    }
    // A change always says what it compares to ("较上月 +2", "与上月持平"), never a bare number under the value.
    function deltaText(item){
        const label=item.deltaLabel===undefined||item.deltaLabel===null?'较上月':String(item.deltaLabel),text=String(item.delta).trim();
        const number=typeof item.delta==='number'?item.delta:/^[+-]?\d+(\.\d+)?$/.test(text)?Number(text):null;
        if(number===null||!Number.isFinite(number))return esc(text);
        if(number===0)return esc(label.startsWith('较')?`与${label.slice(1)}持平`:`${label} 持平`.trim());
        return esc(`${label} ${number>0?'+':'−'}${fmt(Math.abs(number),Math.min(2,(String(Math.abs(number)).split('.')[1]||'').length))}${item.deltaUnit??item.unit??''}`.trim());
    }
    // Highest and lowest with ties: every item sharing the top (or bottom) value is listed; same is true when all are equal.
    function extremes(items,{label='label',value='value'}={}){
        const list=(Array.isArray(items)?items:[]).map(item=>({label:String(item?.[label]??''),value:num(item?.[value])})).filter(item=>item.value!==null);
        if(!list.length)return {same:false,max:null,min:null};
        const high=Math.max(...list.map(item=>item.value)),low=Math.min(...list.map(item=>item.value));
        const pick=target=>({value:target,labels:list.filter(item=>item.value===target).map(item=>item.label)});
        return {same:high===low,max:pick(high),min:pick(low)};
    }
    function kpi(items){
        return `<div class="kit-kpis">${(items||[]).map(item=>`<div class="kit-kpi kit-${['good','bad'].includes(item.tone)?item.tone:'neutral'}"><div class="kit-kpi-label">${esc(item.label)}</div><div class="kit-kpi-value">${typeof item.value==='number'?fmt(item.value):esc(item.value)}<small>${esc(item.unit||'')}</small></div>${item.delta!==undefined&&item.delta!==null&&item.delta!==''?`<div class="kit-kpi-delta">${deltaText(item)}</div>`:''}</div>`).join('')}</div>`;
    }
    function bar(data,options={}){
        const items=(data||[]).map(item=>({label:String(item.label??''),value:num(item.value)??0}));
        if(!items.length)return title(options.title)+'<div class="kit-empty">无数据</div>';
        const max=Math.max(...items.map(item=>Math.abs(item.value)),1),unit=esc(options.unit||'');
        if(options.horizontal!==false&&(options.horizontal||items.length>6)){
            const rowHeight=26,width=520,labelWidth=150,height=items.length*rowHeight+8;
            const bars=items.map((item,index)=>{const length=Math.abs(item.value)/max*(width-labelWidth-70),y=index*rowHeight+4;return `<text x="${labelWidth-8}" y="${y+16}" text-anchor="end" class="kit-axis">${esc(item.label.length>18?item.label.slice(0,17)+'…':item.label)}</text><rect x="${labelWidth}" y="${y+4}" width="${length.toFixed(1)}" height="16" rx="3" ${fill(0)}/><text x="${labelWidth+length+6}" y="${y+16}" class="kit-value">${fmt(item.value)}${unit}</text>`;}).join('');
            return `${title(options.title)}<svg class="kit-chart" viewBox="0 0 ${width} ${height}" width="100%" role="img">${bars}</svg>`;
        }
        const width=520,height=220,base=180,slot=(width-40)/items.length,barWidth=Math.min(46,slot*0.6);
        const bars=items.map((item,index)=>{const h=Math.abs(item.value)/max*140,x=20+index*slot+(slot-barWidth)/2;return `<rect x="${x.toFixed(1)}" y="${(base-h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="3" ${fill(index)}/><text x="${(x+barWidth/2).toFixed(1)}" y="${(base-h-6).toFixed(1)}" text-anchor="middle" class="kit-value">${fmt(item.value)}${unit}</text><text x="${(x+barWidth/2).toFixed(1)}" y="${base+16}" text-anchor="middle" class="kit-axis">${esc(item.label.length>8?item.label.slice(0,7)+'…':item.label)}</text>`;}).join('');
        return `${title(options.title)}<svg class="kit-chart" viewBox="0 0 ${width} ${height}" width="100%" role="img"><line x1="16" y1="${base}" x2="${width-16}" y2="${base}" stroke="#cfd8e3"/>${bars}</svg>`;
    }
    function line(series,options={}){
        const list=(series||[]).map(item=>({name:String(item.name??''),points:(item.points||[]).map(point=>({x:String(point.x??''),y:num(point.y)??0}))})).filter(item=>item.points.length);
        if(!list.length)return title(options.title)+'<div class="kit-empty">无数据</div>';
        const labels=[...new Set(list.flatMap(item=>item.points.map(point=>point.x)))],values=list.flatMap(item=>item.points.map(point=>point.y));
        const min=Math.min(0,...values),max=Math.max(...values,1),width=520,height=220,left=40,right=16,top=20,bottom=180;
        const x=label=>left+(labels.length===1?0.5:labels.indexOf(label)/(labels.length-1))*(width-left-right),y=value=>bottom-(value-min)/(max-min||1)*(bottom-top);
        const paths=list.map((item,index)=>`<polyline fill="none" stroke="${PALETTE[index%PALETTE.length]}" style="stroke:${color(index)}" stroke-width="2.5" points="${item.points.map(point=>x(point.x).toFixed(1)+','+y(point.y).toFixed(1)).join(' ')}"/>${item.points.map(point=>`<circle cx="${x(point.x).toFixed(1)}" cy="${y(point.y).toFixed(1)}" r="3" ${fill(index)}/>`).join('')}`).join('');
        const axis=labels.map(label=>`<text x="${x(label).toFixed(1)}" y="${bottom+16}" text-anchor="middle" class="kit-axis">${esc(label)}</text>`).join('');
        const legend=list.length>1?`<div class="kit-legend">${list.map((item,index)=>`<span><i style="background:${color(index)}"></i>${esc(item.name)}</span>`).join('')}</div>`:'';
        return `${title(options.title)}<svg class="kit-chart" viewBox="0 0 ${width} ${height}" width="100%" role="img"><line x1="${left}" y1="${bottom}" x2="${width-right}" y2="${bottom}" stroke="#cfd8e3"/><text x="${left-6}" y="${top+4}" text-anchor="end" class="kit-axis">${fmt(max)}</text>${paths}${axis}</svg>${legend}`;
    }
    function pie(data,options={}){
        const items=(data||[]).map(item=>({label:String(item.label??''),value:Math.max(0,num(item.value)??0)})).filter(item=>item.value>0);
        const total=items.reduce((sum,item)=>sum+item.value,0);
        if(!total)return title(options.title)+'<div class="kit-empty">无数据</div>';
        let angle=-Math.PI/2;const radius=80,center=100;
        const slices=items.map((item,index)=>{const sweep=item.value/total*Math.PI*2,end=angle+sweep,large=sweep>Math.PI?1:0,start=[center+radius*Math.cos(angle),center+radius*Math.sin(angle)],stop=[center+radius*Math.cos(end),center+radius*Math.sin(end)];angle=end;return items.length===1?`<circle cx="${center}" cy="${center}" r="${radius}" ${fill(0)}/>`:`<path d="M${center},${center} L${start[0].toFixed(1)},${start[1].toFixed(1)} A${radius},${radius} 0 ${large} 1 ${stop[0].toFixed(1)},${stop[1].toFixed(1)} Z" ${fill(index)}/>`;}).join('');
        const legend=items.map((item,index)=>`<span><i style="background:${color(index)}"></i>${esc(item.label)} ${fmt(item.value)}${esc(options.unit||'')}（${fmt(item.value/total*100,1)}%）</span>`).join('');
        return `${title(options.title)}<div class="kit-pie"><svg viewBox="0 0 200 200" width="180" height="180" role="img">${slices}<circle cx="${center}" cy="${center}" r="42" fill="#fff"/></svg><div class="kit-legend kit-legend-column">${legend}</div></div>`;
    }
    // Items are text, or {html} built with kit helpers (such as kit.link), or {text}; the output is sanitized anyway.
    // {text, label, anchor, tone}: label becomes a jump link (when anchor is a report anchor) before the text, and
    // tone 'bad' | 'good' colours the line — so lists never need hand-written HTML.
    const listItem=item=>{
        if(!item||typeof item!=='object')return emphasis(esc(item));
        if(item.html!==undefined)return String(item.html);
        const head=item.label!==undefined&&item.text!==undefined?(anchorOf(item.anchor)?link(item.label,item.anchor)+'：':emphasis(esc(item.label))+'：'):'';
        const body=emphasis(esc(item.text??item.label??'')),tone=item.tone==='bad'||item.tone==='good'?item.tone:'';
        return tone?`<span class="kit-tone-${tone}">${head}${body}</span>`:head+body;
    };
    function list(items,options={}){const tag=options.ordered?'ol':'ul';return `${title(options.title)}<${tag} class="kit-list">${(items||[]).map(item=>`<li>${listItem(item)}</li>`).join('')}</${tag}>`;}
    // Interactive widgets: the sandbox only emits a placeholder plus a JSON spec; the page renders them with trusted code.
    // Each placeholder carries a static fallback, used until hydration and in mail/print exports.
    let widgets=[];
    function widget(type,spec,fallback,height,alias){const id='w'+widgets.length;widgets.push({id,type,spec,...(alias?{alias:String(alias).slice(0,60)}:{})});return `<div class="kit-widget kit-widget-${type}" data-widget="${id}"${height?` style="height:${Math.max(160,Math.min(900,Number(height)||320))}px"`:''}>${fallback}</div>`;}
    // drill: {field, target, levels:{点击的名称:{option, drill}}} — click filters the target table by field and, where a level exists, opens it.
    function chart(option,options={}){const spec={option:option||{}};if(options.drill&&typeof options.drill==='object')spec.drill=options.drill;return title(options.title)+widget('chart',spec,'<div class="kit-empty">图表加载中…</div>',options.height||320,options.id);}
    function datatable(rows,options={}){
        const list=(Array.isArray(rows)?rows:[]).slice(0,5000),pageSize=Math.max(5,Math.min(100,Number(options.pageSize)||10));
        const columns=(options.columns||Object.keys(list[0]||{}).map(key=>({key,label:key}))).map(column=>typeof column==='string'?{key:column,label:column}:column);
        return title(options.title)+widget('datatable',{rows:list,columns,pageSize,search:options.search!==false},table(list,{columns,maxRows:pageSize}),0,options.id);
    }
    function tabs(items){
        const list=(items||[]).map(item=>({label:String(item.label??''),html:String(item.html??'')}));
        return widget('tabs',{labels:list.map(item=>item.label)},list.map((item,index)=>`<section class="kit-tab-panel" data-tab="${index}"><h4 class="kit-tab-heading">${esc(item.label)}</h4>${item.html}</section>`).join(''));
    }
    // Layout slots: named sub-blocks whose sizes the platform controls (the user can drag them). rows is a list of rows,
    // each a list of {id, html, width, height, title}; a flat list means a single row. width is a share of the row.
    function layout(rows,options={}){
        const list=(Array.isArray(rows)&&rows.length&&!Array.isArray(rows[0])?[rows]:rows||[]).map(row=>(row||[]).filter(Boolean));
        const slotId=(value,index)=>/^[A-Za-z][\w-]{0,30}$/.test(value||'')?value:'block'+index;
        let index=0;
        const body=list.map(row=>`<div class="kit-row">${row.map(slot=>{const id=slotId(slot.id,++index),weight=num(String(slot.width??'').replace('%',''));
            return `<div class="kit-slot" data-slot="${esc(id)}"${slot.title?` data-slot-title="${esc(slot.title)}"`:''} style="flex:${weight&&weight>0?weight:1} 1 0${slot.height?`;height:${Math.max(60,Math.min(1600,num(slot.height)||0))}px`:''}">${String(slot.html??'')}</div>`;}).join('')}</div>`).join('');
        return `${title(options.title)}<div class="kit-layout">${body}</div>`;
    }
    const resetWidgets=()=>{widgets=[];};const takeWidgets=()=>{const list=widgets;widgets=[];return list;};
    // Links to a chapter or cell of this report (anchors from the report source); anything else stays plain text.
    const anchorOf=value=>/^#air-(chapter|cell)-[\w-]{1,90}$/.test(String(value||''))?String(value):'';
    function link(label,anchor,options={}){
        const href=anchorOf(anchor);
        return href?`<a class="kit-link" href="${href}">${esc(label)}</a>`:`<span>${esc(label)}</span>`;
    }
    // A link inside a sentence: on the first of `terms` found (a metric name), else on the first number with its unit,
    // else on the opening phrase — so a conclusion reads naturally with its jump built in.
    function inlineLink(text,anchor,options={}){
        const plain=String(text??''),href=anchorOf(anchor);if(!href)return esc(plain);
        let at=-1,size=0;
        for(const term of [].concat(options.terms||[]).map(item=>String(item??'').trim()).filter(item=>item.length>=2).sort((a,b)=>b.length-a.length)){const index=plain.indexOf(term);if(index>=0){at=index;size=term.length;break;}}
        // Numbers with a unit first (98%, 3 次), then plain numbers that are not years or dates (2026-09, 2026年).
        if(at<0){const number=plain.match(/-?\d+(?:\.\d+)?\s*(?:%|％|个|次|条|件|人|天|项|小时|分钟)/)||plain.match(/(?<![\d.-])(?!(?:19|20)\d\d(?:[-年/.]|$))-?\d+(?:\.\d+)?(?![\d-])/);if(number){at=number.index;size=number[0].trim().length;}}
        if(at<0){const phrase=plain.match(/^[^，。,；;：:！？!?]{2,24}/);if(phrase){at=0;size=phrase[0].length;}}
        if(at<0)return `${esc(plain)} <a class="kit-link" href="${href}">↗</a>`;
        return `${esc(plain.slice(0,at))}<a class="kit-link" href="${href}">${esc(plain.slice(at,at+size))}</a>${esc(plain.slice(at+size))}`;
    }
    // Quick navigation: numbered links in a grid of `columns` (default fits the width), like a table of contents.
    function nav(items,options={}){
        const list=(Array.isArray(items)?items:[]).filter(item=>item&&item.label);
        const columns=Math.max(1,Math.min(6,Number(options.columns)||0))||'';
        return `${title(options.title)}<nav class="kit-nav"${columns?` style="grid-template-columns:repeat(${columns},minmax(0,1fr))"`:''}>${list.map((item,index)=>{
            const href=anchorOf(item.anchor),no=item.no===undefined||item.no===null?String(index+1).padStart(2,'0'):String(item.no);
            const body=`${options.numbered===false?'':`<b>${esc(no)}</b>`}<span>${esc(item.label)}</span>${item.note?`<small>${esc(item.note)}</small>`:''}`;
            return href?`<a class="kit-nav-item" href="${href}">${body}</a>`:`<span class="kit-nav-item">${body}</span>`;
        }).join('')}</nav>`;
    }
    // **…** marks words or numbers to stand out (bold, theme colour), so recipes never have to build HTML for it.
    const emphasis=html=>html.replace(/\*\*([^*\n]{1,80}?)\*\*/g,'<strong class="kit-em">$1</strong>');
    function text(value){return String(value??'').split(/\n{2,}/).map(paragraph=>`<p class="kit-text">${emphasis(esc(paragraph)).replace(/\n/g,'<br>')}</p>`).join('');}
    scope.AiReportKit={table,kpi,extremes,link,inlineLink,nav,bar,line,pie,list,text,esc,fmt,num,chart,datatable,tabs,layout,PALETTE,_resetWidgets:resetWidgets,_takeWidgets:takeWidgets};
})(typeof self!=='undefined'?self:this);
