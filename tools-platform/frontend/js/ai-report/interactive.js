/* Executable report cells live in opaque-origin frames. Only explicit, source-checked messages reach the editor. */
(function(){
    'use strict';
    const sessions=new Set(),precisionCells=new Set();let libraries;
    const script=text=>'<script>'+String(text).replace(/<\/script/gi,'<\\/script')+'<\/script>';
    const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
    // This function is serialized into the child frame, including standalone HTML exports.
    function runtime(initial){
        const root=document.getElementById('air-content');
        let editing=initial.editing!==false,draggedClick=false,state=initial.state||{},edits=initial.edits||{},history=initial.history||[],drag=null,timer;
        const channel=initial.channel;let selectedId='',editor=null;const semantic=new WeakMap(),chartBounds=new WeakMap();let replay=initial.replay||[];
        document.documentElement.classList.toggle('air-editing',editing);
        // Per-cell default: keep cartesian axes visible, even when a generated recipe hid them to save space.
        // An explicit presentation request may opt into preserving the recipe's axis settings.
        if(window.echarts)window.echarts.registerPreprocessor(option=>{
            for(const series of [].concat(option.series||[]))if(series?.type==='bar'&&series.label?.show===undefined){
                series.label={position:'top',distance:4,...series.label,show:true};
            }
            const keepStateVisible=item=>{for(const state of ['emphasis','blur','select'])if(item?.[state])for(const key of ['itemStyle','lineStyle','areaStyle','label'])if(item[state][key]){
                const style=item[state][key];if(typeof style.opacity==='number'&&style.opacity<0.6)style.opacity=1;
                for(const color of ['color','borderColor'])if(typeof style[color]==='string'&&/^(transparent|none|rgba\([^)]*,\s*0(?:\.0+)?\))$/i.test(style[color]))delete style[color];
            }};
            if(editing){option.animation=false;for(const series of [].concat(option.series||[])){keepStateVisible(series);for(const point of series.data||[])if(point&&typeof point==='object')keepStateVisible(point);series.emphasis={...series.emphasis,disabled:true,focus:'none',scale:false};series.blur={...series.blur,itemStyle:{...series.blur?.itemStyle,opacity:1},lineStyle:{...series.blur?.lineStyle,opacity:1},label:{...series.blur?.label,opacity:1}};series.select={...series.select,disabled:true};}}
            if(initial.axes==='preserve')return;
            for(const key of ['xAxis','yAxis'])for(const axis of [].concat(option[key]||[])){
                if(!axis||typeof axis!=='object')continue;
                axis.show=true;axis.axisLine={...axis.axisLine,show:true};axis.axisTick={...axis.axisTick,show:true};axis.axisLabel={...axis.axisLabel,show:true};
                if(key==='yAxis'&&axis.splitNumber===undefined)axis.splitNumber=2;
            }
            for(const grid of [].concat(option.grid||[]))if(grid&&typeof grid==='object')grid.containLabel=true;
        });
        const send=(type,data={})=>parent.postMessage({airInteractive:channel,type,...data},'*');
        const svgNamespace='http://www.w3.org/2000/svg';
        const pathKey=element=>{
            const path=[];let node=element;
            while(node&&node!==root){path.unshift([...node.parentElement.children].indexOf(node));node=node.parentElement;}
            return 'node-'+path.join('-');
        };
        const digest=value=>{let hash=2166136261;for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(36);};
        const explicitKey=node=>{
            const name=node.dataset.airElement;if(!name||name.startsWith('air-chart-'))return '';
            const peers=[...root.querySelectorAll('[data-air-element]')].filter(item=>item.dataset.airElement===name);
            return peers.length>1?name+'::'+peers.indexOf(node):name;
        };
        function chartIdentity(element,host,chart){
            const prefix='air-chart-'+digest(host.id||explicitKey(host)||pathKey(host));
            const box=element.getBoundingClientRect(),bounds=host.getBoundingClientRect(),sx=chart.getWidth()/(bounds.width||1),sy=chart.getHeight()/(bounds.height||1);
            const offset=String(element.style.translate||'0 0').split(/\s+/).map(parseFloat);
            const x=((box.left+box.right)/2-bounds.left)*sx-(offset[0]||0),y=((box.top+box.bottom)/2-bounds.top)*sy-(offset[1]||0);
            const option=chart.getOption(),tag=element.tagName.toLowerCase(),label=element.textContent?.trim()||'';
            const numericLabel=label&&!/^[A-Za-z]/.test(label)?Number(label.replace(/[%％,\s]/g,'')):NaN;
            let best=null;
            (option.series||[]).forEach((series,index)=>{
                if(series.type!=='bar'||!Array.isArray(series.data))return;
                const xAxis=option.xAxis?.[series.xAxisIndex||0],yAxis=option.yAxis?.[series.yAxisIndex||0];
                const vertical=xAxis?.type==='category',categories=(vertical?xAxis:yAxis)?.data;if(!categories)return;
                series.data.forEach((entry,dataIndex)=>{
                    const raw=entry&&typeof entry==='object'&&!Array.isArray(entry)?entry.value:entry,value=Number(raw);
                    if(raw===null||raw===undefined||!Number.isFinite(value))return;
                    if(tag==='text'&&(!Number.isFinite(numericLabel)||Math.abs(numericLabel-value)>0.011))return;
                    if(tag!=='text'&&!['path','rect'].includes(tag))return;
                    const category=categories[dataIndex]?.value??categories[dataIndex];let center,end,zero;
                    try{center=chart.convertToPixel(vertical?{xAxisIndex:series.xAxisIndex||0}:{yAxisIndex:series.yAxisIndex||0},category);end=chart.convertToPixel(vertical?{yAxisIndex:series.yAxisIndex||0}:{xAxisIndex:series.xAxisIndex||0},value);zero=chart.convertToPixel(vertical?{yAxisIndex:series.yAxisIndex||0}:{xAxisIndex:series.xAxisIndex||0},0);}catch(_){return;}
                    if(![center,end,zero].every(Number.isFinite))return;
                    const cross=vertical?x:y,along=vertical?y:x;
                    const slot=(vertical?chart.getWidth():chart.getHeight())/Math.max(1,categories.length);
                    if(Math.abs(cross-center)>slot*0.35)return;
                    if(tag!=='text'){
                        const span=(vertical?box.height*sy:box.width*sx),width=(vertical?box.width*sx:box.height*sy);
                        if(width>slot*0.85||Math.abs(span-Math.abs(end-zero))>4)return;
                    }
                    const score=Math.abs(cross-center)+Math.abs(along-(tag==='text'?end:(end+zero)/2));
                    if(!best||score<best.score)best={score,target:{kind:tag==='text'?'label':'bar',category:String(category),series:String(series.name||index),chart:host.id||pathKey(host)},point:{x:vertical?center:(tag==='text'?end:(end+zero)/2),y:vertical?(tag==='text'?end:(end+zero)/2):center},host,id:prefix+'-'+(tag==='text'?'label':'bar')+'-'+digest((series.id||series.name||index)+'|'+String(category))};
                });
            });
            if(best){semantic.set(element,best);return best.id;}
            // Axis labels and other SVG marks use content/shape identity, never mutable DOM sibling positions.
            const signature=tag==='text'?'text|'+label:tag+'|'+['d','x','y','width','height','cx','cy','r','stroke','fill'].map(attr=>element.getAttribute(attr)||'').join('|');
            return prefix+'-graphic-'+digest(signature);
        }
        function bindChartElements(){
            for(const [host,chart]of charts){
                const used=new Map();
                for(const node of host.querySelectorAll('svg text,svg path,svg rect,svg circle,svg ellipse,svg line,svg polygon,svg polyline')){
                    if(explicitKey(node))continue;
                    const old=node.dataset.airElement,scaled=edits[old]?.size?.kind==='svg',scale=node.style.scale;if(scaled)node.style.scale='none';
                    const id=old&&edits[old]?.text!==undefined?old:chartIdentity(node,host,chart),count=used.get(id)||0;if(scaled)node.style.scale=scale;used.set(id,count+1);
                    node.dataset.airElement=id+(count?'-'+count:'');
                }
            }
        }
        let nodeSequence=0;
        const key=element=>{const named=explicitKey(element)||element.dataset.airElement||element.dataset.airRuntimeId;if(named)return named;let id=pathKey(element);if([...root.querySelectorAll('[data-air-runtime-id]')].some(node=>node.dataset.airRuntimeId===id))id+='-runtime-'+(++nodeSequence);element.dataset.airRuntimeId=id;return id;};
        const find=id=>{
            const runtime=[...root.querySelectorAll('[data-air-runtime-id]')].find(node=>node.dataset.airRuntimeId===id);if(runtime)return runtime;
            const named=[...root.querySelectorAll('[data-air-element]')].find(node=>node.dataset.airElement?.startsWith('air-chart-')?node.dataset.airElement===id:explicitKey(node)===id);if(named)return named;
            if(!id.startsWith('node-'))return null;
            let node=root;for(const index of id.slice(5).split('-'))node=node?.children[Number(index)];
            // Old SVG indices could point at different marks after hover or resize. Do not replay them onto another mark.
            return node?.namespaceURI===svgNamespace?null:node;
        };
        function hideEditSwitches(){
            // Older generated pages may carry their own mode button. Keep the node for script references, hide the redundant chrome.
            for(const node of root.querySelectorAll('button,[role="button"]'))if(/^(?:自由编辑|开启编辑|启用编辑|开始编辑|进入编辑|编辑模式|完成编辑|退出编辑|free edit|enable editing|start editing|edit mode|finish editing)$/i.test((node.textContent||node.getAttribute('aria-label')||'').trim())){
                if(node.style.display!=='none')node.style.setProperty('display','none','important');
            }
        }
        const textOf=node=>node.textContent.trim().replace(/\s+/g,' ').slice(0,100);
        function tableInfo(node){
            const cell=node.closest('th,td'),table=cell?.closest('table');if(!table)return null;
            const rows=[...table.rows].filter(row=>row.closest('table')===table);
            const header=rows.find(row=>row.parentElement.tagName==='THEAD'||[...row.cells].every(cell=>cell.tagName==='TH'));
            if(!header)return null;
            const row=cell.parentElement,head=row===header,headers=[...header.cells].map(textOf);
            const rowKey=head?'':JSON.stringify(headers.map((column,index)=>[column,textOf(row.cells[index]||row)]).sort((a,b)=>a[0].localeCompare(b[0])));
            return {cell,table,row,head,headers,column:headers[cell.cellIndex]||'',rowKey};
        }
        function tableAnchor(node,offset){
            const info=tableInfo(node);if(!info?.column)return null;
            const font=parseFloat(getComputedStyle(node).fontSize)||12,translate=String(node.style.translate||'0 0').split(/\s+/).map(parseFloat);
            return {kind:'table-cell',target:{tableId:explicitKey(info.table)||info.table.id,headers:info.headers.slice().sort(),column:info.column,head:info.head,row:info.rowKey,text:textOf(node)},x:(offset?.x??translate[0]??0)/font||0,y:(offset?.y??translate[1]??0)/font||0};
        }
        function resolveTable(anchor){
            const target=anchor.target;
            let tables=[...root.querySelectorAll('table')].filter(table=>{const info=tableInfo(table.querySelector('th,td')||table);return info&&JSON.stringify(info.headers.slice().sort())===JSON.stringify(target.headers);});
            if(tables.length>1&&target.tableId)tables=tables.filter(table=>(explicitKey(table)||table.id)===target.tableId);
            if(tables.length!==1)return null;
            const nodes=[...tables[0].querySelectorAll('th,td')].filter(cell=>{const info=tableInfo(cell);return info?.table===tables[0]&&info.column===target.column&&info.head===target.head&&(info.head||info.rowKey===target.row);});
            if(nodes.length!==1)return null;
            const cell=nodes[0];if(textOf(cell)===target.text)return cell;
            const leaves=[...cell.querySelectorAll('*')].filter(node=>!node.children.length&&textOf(node)===target.text);return leaves.length===1?leaves[0]:null;
        }
        // CSS scroll/clip containers generated by the model must not hide a manually moved child.
        // Leave untouched scrolling areas alone; only relax an ancestor that actually clips an edit.
        function revealMoved(node){
            const box=node.getBoundingClientRect();
            for(let parent=node.parentElement;parent&&parent!==root;parent=parent.parentElement){
                const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect(),clips=value=>/^(auto|scroll|hidden|clip)$/.test(value);
                if((clips(style.overflowX)&&(box.left<bounds.left-1||box.right>bounds.right+1))||(clips(style.overflowY)&&(box.top<bounds.top-1||box.bottom>bounds.bottom+1)))parent.style.setProperty('overflow','visible','important');
            }
        }
        function anchorOf(node){
            const mark=semantic.get(node),box=node.getBoundingClientRect();
            if(mark){
                const host=mark.host.getBoundingClientRect(),font=parseFloat(getComputedStyle(node).fontSize)||12;
                return {target:mark.target,kind:mark.target.kind==='label'?'chart-label':'chart-mark',x:(box.left+box.width/2-host.left-mark.point.x)/font,y:(box.top+box.height/2-host.top-mark.point.y)/font};
            }
            if(charts.has(node)){const option=charts.get(node).getOption();return {kind:'chart-box',target:{id:node.id,signature:JSON.stringify({axes:[option.xAxis,option.yAxis].map(axes=>(axes||[]).map(axis=>[].concat(axis.data||[]).map(value=>String(value?.value??value)).sort())),series:(option.series||[]).map(series=>({type:series.type,name:series.name||''}))})},textOnly:true};}
            if(node.tagName==='TABLE'){const info=tableInfo(node.querySelector('th,td'));if(info)return {kind:'table',target:{tableId:explicitKey(node)||node.id,headers:info.headers.slice().sort()},textOnly:true};}
            const table=tableAnchor(node);if(table)return table;
            const id=explicitKey(node)||node.id,text=node.children.length?'':node.textContent.trim().slice(0,100);
            if(id&&node.namespaceURI===svgNamespace)return {kind:'named',target:{id,tag:node.tagName},textOnly:true};
            if((id||text)&&node.namespaceURI!==svgNamespace){const parent=node.parentElement.getBoundingClientRect();return {kind:'relative',target:{id,text,tag:node.tagName},x:(box.left+box.width/2-parent.left)/(parent.width||1),y:(box.top+box.height/2-parent.top)/(parent.height||1)};}
            if(textOf(node))return {kind:'component',target:{tag:node.tagName,text:textOf(node)},textOnly:true};
            return null;
        }
        function resolveAnchor(anchor){
            if(anchor.kind==='named'){const nodes=[...root.querySelectorAll('*')].filter(node=>node.tagName===anchor.target.tag&&(explicitKey(node)||node.id)===anchor.target.id);return nodes.length===1?nodes[0]:null;}
            if(anchor.kind==='chart-box'){let nodes=[...charts.keys()].filter(node=>anchorOf(node)?.target?.signature===anchor.target.signature);if(nodes.length>1&&anchor.target.id)nodes=nodes.filter(node=>node.id===anchor.target.id);return nodes.length===1?nodes[0]:null;}
            if(anchor.kind==='table-cell')return resolveTable(anchor);
            if(anchor.kind==='table'){let tables=[...root.querySelectorAll('table')].filter(node=>{const info=tableInfo(node.querySelector('th,td'));return info&&JSON.stringify(info.headers.slice().sort())===JSON.stringify(anchor.target.headers);});if(tables.length>1&&anchor.target.tableId)tables=tables.filter(node=>(explicitKey(node)||node.id)===anchor.target.tableId);return tables.length===1?tables[0]:null;}
            if(anchor.kind==='component'){const nodes=[...root.querySelectorAll('*')].filter(node=>node.tagName===anchor.target.tag&&textOf(node)===anchor.target.text);return nodes.length===1?nodes[0]:null;}
            const nodes=[...root.querySelectorAll('*')].filter(node=>{
                if(anchor.kind.startsWith('chart-')){const m=semantic.get(node)?.target;return m&&m.kind===anchor.target.kind&&m.category===anchor.target.category&&m.series===anchor.target.series;}
                return node.tagName===anchor.target.tag&&(anchor.target.id?(explicitKey(node)===anchor.target.id||node.id===anchor.target.id):node.children.length===0&&node.textContent.trim().slice(0,100)===anchor.target.text);
            });
            if(nodes.length>1&&anchor.kind.startsWith('chart-')){const exact=nodes.filter(node=>semantic.get(node).target.chart===anchor.target.chart);return exact.length===1?exact[0]:null;}
            return nodes.length===1?nodes[0]:null;
        }
        function place(node,edit){
            // Upgrade saved table records before using a parent-row percentage against a new row height.
            if(edit.anchor?.kind==='relative'&&tableInfo(node)){const upgraded=tableAnchor(node,edit);if(upgraded)edit.anchor={...upgraded,textOnly:edit.anchor.textOnly};}
            const a=edit.anchor;if(!a?.kind||a.textOnly)return;
            if(a.kind==='component'||a.kind==='table'){node.style.translate=(edit.x||0)+'px '+(edit.y||0)+'px';return;}
            if(a.kind==='table-cell'){const font=parseFloat(getComputedStyle(node).fontSize)||12;edit.x=Math.round(a.x*font*100)/100;edit.y=Math.round(a.y*font*100)/100;node.style.translate=edit.x+'px '+edit.y+'px';return;}
            const box=node.getBoundingClientRect(),old=String(node.style.translate||'0 0').split(/\s+/).map(parseFloat);let x,y;
            if(a.kind.startsWith('chart-')){const mark=semantic.get(node);if(!mark)return;const host=mark.host.getBoundingClientRect(),font=parseFloat(getComputedStyle(node).fontSize)||12;x=host.left+mark.point.x+a.x*font;y=host.top+mark.point.y+a.y*font;}
            else{const parent=node.parentElement.getBoundingClientRect();x=parent.left+a.x*parent.width;y=parent.top+a.y*parent.height;}
            edit.x=Math.round((x-box.left-box.width/2+(old[0]||0))*100)/100;edit.y=Math.round((y-box.top-box.height/2+(old[1]||0))*100)/100;
            node.style.translate=edit.x+'px '+edit.y+'px';
        }
        function applySize(node,edit){
            const size=edit.size;if(size?.kind==='text')node.style.fontSize=size.fontSize+'px';
            else if(size?.kind==='svg'){node.style.scale='none';const b=node.getBoundingClientRect();Object.assign(node.style,{transformBox:'fill-box',transformOrigin:'center',scale:(size.width/(b.width||1))+' '+(size.height/(b.height||1))});}
            else if(size?.kind==='box')Object.assign(node.style,{width:size.width+'px',height:size.height+'px',minWidth:'0',minHeight:'0',maxWidth:'none',maxHeight:'none',flex:'none'});
            const layout=edit.tableLayout;if(layout&&node.tagName==='TABLE'){
                const info=tableInfo(node.querySelector('th,td'));if(!info)return;
                if(layout.columns){let group=node.querySelector(':scope>colgroup');if(!group){group=document.createElement('colgroup');node.prepend(group);}group.dataset.airInternal='columns';while(group.children.length<info.headers.length)group.append(document.createElement('col'));while(group.children.length>info.headers.length)group.lastChild.remove();node.style.tableLayout='fixed';info.headers.forEach((column,index)=>{const ratio=layout.columns.find(item=>item.column===column)?.ratio;if(ratio!==undefined)group.children[index].style.width=(ratio*100)+'%';});}
                for(const record of layout.rows||[]){const rows=[...node.rows].filter(row=>{const detail=tableInfo(row.cells[0]);return detail&&(detail.head?'head':detail.rowKey)===record.row;});if(rows.length===1)rows[0].style.height=record.height+'px';}
            }
            // A regenerated table may add padding or duplicate a requested header height onto data rows.
            // Fit those unrecorded rows into the user's whole-table height without clipping their text.
            if(size?.kind==='box'&&node.tagName==='TABLE'&&node.getBoundingClientRect().height>size.height+1){
                const rows=[...node.rows],fixed=new Map(rows.map(row=>{const info=tableInfo(row.cells[0]),id=info?.head?'head':info?.rowKey;return [row,(layout?.rows||[]).find(record=>record.row===id)?.height];}));
                const free=rows.filter(row=>fixed.get(row)===undefined),room=Math.max(0,size.height-rows.reduce((sum,row)=>sum+(fixed.get(row)||0),0)),height=room/(free.length||1);
                for(const row of free){row.style.height=height+'px';for(const cell of row.cells){const css=getComputedStyle(cell),line=parseFloat(css.lineHeight)||parseFloat(css.fontSize)*1.2,border=(parseFloat(css.borderTopWidth)||0)+(parseFloat(css.borderBottomWidth)||0),padding=Math.max(0,(height-line-border)/2);cell.style.paddingTop=Math.min(parseFloat(css.paddingTop)||0,padding)+'px';cell.style.paddingBottom=Math.min(parseFloat(css.paddingBottom)||0,padding)+'px';}}
            }
        }
        function protectContent(){
            // Prefer wrapping an intact value over hiding its final digits. Explicitly authored overflow can opt out.
            for(const table of root.querySelectorAll('table'))if(!edits[key(table)]?.size&&table.dataset.airOverflow!=='preserve'){
                const available=Math.min(root.clientWidth,table.parentElement.clientWidth||root.clientWidth);
                if(table.getBoundingClientRect().width>available+1){table.style.tableLayout='fixed';table.style.width='100%';table.style.minWidth='0';for(const cell of table.querySelectorAll('th,td'))Object.assign(cell.style,{overflowWrap:'anywhere',whiteSpace:'normal'});}
            }
            for(const node of root.querySelectorAll('p,span,div,h1,h2,h3,h4,h5,h6,th,td')){
                if(node.children.length||node.closest('[data-air-overflow="preserve"]')||!node.textContent.trim())continue;
                const available=Math.min(node.clientWidth||Infinity,node.parentElement.clientWidth||Infinity,root.clientWidth),natural=node.scrollWidth||node.getBoundingClientRect().width;
                if(natural>available+1){Object.assign(node.style,{overflowWrap:'anywhere',whiteSpace:'normal',textOverflow:'clip'});if(!edits[key(node)]?.size){node.style.maxWidth='100%';if(/hidden|clip/.test(getComputedStyle(node).overflowY))Object.assign(node.style,{height:'auto',maxHeight:'none'});}}
            }
            for(const [host,chart]of charts){
                if(host.dataset.airOverflow==='preserve')continue;
                const option=chart.getOption(),grids=option.grid;if(!Array.isArray(grids)||grids.length!==1)continue;
                let state=chartBounds.get(chart);if(!state){state={base:{...grids[0]},extra:{left:0,right:0,top:0,bottom:0}};chartBounds.set(chart,state);}
                const width=chart.getWidth(),height=chart.getHeight(),pixel=(value,total)=>typeof value==='string'&&value.endsWith('%')?parseFloat(value)*total/100:Number(value)||0;
                for(let pass=0;pass<3;pass++){
                    const bounds=host.getBoundingClientRect(),sx=width/(bounds.width||1),sy=height/(bounds.height||1),overflow={left:0,right:0,top:0,bottom:0};
                    for(const text of host.querySelectorAll('svg text')){if(edits[key(text)])continue;const box=text.getBoundingClientRect();if(!box.width||!box.height)continue;overflow.left=Math.max(overflow.left,(bounds.left+2-box.left)*sx);overflow.right=Math.max(overflow.right,(box.right-bounds.right+2)*sx);overflow.top=Math.max(overflow.top,(bounds.top+2-box.top)*sy);overflow.bottom=Math.max(overflow.bottom,(box.bottom-bounds.bottom+2)*sy);}
                    let changed=false;const grid={};
                    for(const side of ['left','right','top','bottom']){const total=side==='left'||side==='right'?width:height,base=pixel(state.base[side],total),next=Math.min(Math.max(0,total*.4-base),state.extra[side]+Math.max(0,overflow[side]));if(next>state.extra[side]+.5){state.extra[side]=next;changed=true;}grid[side]=base+state.extra[side];}
                    if(!changed)break;chart.setOption({grid:[{...grid,containLabel:true}]},{silent:true});chart.getZr()?.flush?.();bindChartElements();
                }
            }
        }
        function overflowCount(){
            let count=0;const width=innerWidth,height=innerHeight;
            for(const node of root.querySelectorAll('svg text,p,span,div,h1,h2,h3,h4,h5,h6,th,td')){
                if(!node.textContent.trim()||getComputedStyle(node).display==='none'||node.closest('[data-air-overflow="preserve"]'))continue;
                let boxes;if(node.namespaceURI===svgNamespace)boxes=[node.getBoundingClientRect()];else{boxes=[];for(const text of node.childNodes)if(text.nodeType===3&&text.textContent.trim()){const range=document.createRange();range.selectNodeContents(text);boxes.push(...range.getClientRects());}}
                if(boxes.some(box=>{if(!box.width||!box.height)return false;if(box.left<-.5||box.top<-.5||box.right>width+.5||box.bottom>height+.5)return true;for(let parent=node;parent&&parent!==root;parent=parent.parentElement){const css=getComputedStyle(parent),bounds=parent.getBoundingClientRect(),clips=value=>/^(hidden|clip|auto|scroll)$/.test(value);if((clips(css.overflowX)&&(box.left<bounds.left-.5||box.right>bounds.right+.5))||(clips(css.overflowY)&&(box.top<bounds.top-.5||box.bottom>bounds.bottom+.5)))return true;}return false;}))count++;
            }
            return count;
        }
        function apply(){
            hideEditSwitches();
            replay=replay.filter(item=>{const node=resolveAnchor(item.edit.anchor);if(!node)return true;const id=key(node);edits[id]={...item.edit};place(node,edits[id]);const entries=item.histories||[item.history].filter(Boolean);history=history.filter(h=>!entries.some(entry=>(entry.element===h.element||h.element===id)&&entry.action===h.action));history.push(...entries.map(entry=>({...entry,element:id})));return false;});
for(const [id,edit]of Object.entries(edits)){const node=find(id);if(!node)continue;applySize(node,edit);if(edit.x!==undefined)node.style.translate=edit.x+'px '+edit.y+'px';if(edit.text!==undefined&&node.textContent!==edit.text)node.textContent=edit.text;if(edit.anchor)place(node,edit);}for(const [id,edit]of Object.entries(edits))if(edit.x!==undefined){const node=find(id);if(node)revealMoved(node);}protectContent();root.querySelectorAll('.air-element-selected').forEach(node=>node.classList.remove('air-element-selected'));if(selectedId&&!editor)find(selectedId)?.classList.add('air-element-selected');editor?.refresh();}
        function snapshot(){
            const copy=root.cloneNode(true);
            const properties=['display','position','top','right','bottom','left','width','height','min-height','max-width','margin','padding','box-sizing','color','background-color','font-family','font-size','font-weight','line-height','text-align','white-space','overflow-wrap','word-break','border','border-radius','border-collapse','vertical-align','table-layout','flex','flex-direction','flex-wrap','align-items','justify-content','gap','grid-template-columns','grid-column','transform','transform-origin','transform-box','scale','translate','fill','stroke','stroke-width','opacity','clip-path','overflow'];
            const original=[root,...root.querySelectorAll('*')],cloned=[copy,...copy.querySelectorAll('*')];
            original.forEach((node,index)=>{const style=getComputedStyle(node);for(const property of properties)cloned[index].style.setProperty(property,style.getPropertyValue(property));});
            copy.querySelectorAll('script,style,iframe,object,embed').forEach(node=>node.remove());
            copy.removeAttribute('id');return copy.outerHTML;
        }
        function publish(requestId){observeCharts();apply();for(const [id,edit]of Object.entries(edits))if(!edit.anchor&&edit.x!==undefined){const node=find(id);if(node)edit.anchor=anchorOf(node);}send('change',{state,edits,history,snapshot:snapshot(),unresolved:replay.length,overflow:overflowCount(),replay,requestId});}
        function record(change){
            const previous=history.findIndex(item=>item.element===change.element&&item.action===change.action);
            if(previous>=0)history.splice(previous,1);
            history.push({...change,at:new Date().toISOString()});history=history.slice(-30);publish();
        }
        window.airCell={
            getState:()=>state,
            getAdjustments:()=>({edits,history}),
            setState:value=>{state=value;publish();},
            record:change=>record({element:String(change.element||'custom').slice(0,100),action:String(change.action||'edit').slice(0,40),description:String(change.description||'').slice(0,400),before:change.before,after:change.after}),
            snapshot:publish,
            get editing(){return editing;}
        };
        addEventListener('message',event=>{if(event.source!==parent||event.data?.airInteractive!==channel)return;
            if(event.data.type==='mode'){editing=!!event.data.editing;document.documentElement.classList.toggle('air-editing',editing);}
            if(event.data.type==='precision'){editor?.setPrecision(event.data.enabled);}
            if(event.data.type==='editor-scale')editor?.setScale(event.data.scale);
            if(event.data.type==='element-size')editor?.resizeTo(event.data.width,event.data.height);
            if(event.data.type==='element-select'){editor?.command(event.data);}
            if(event.data.type==='snapshot')publish(event.data.requestId);
        });
        addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.target.closest?.('input,textarea,[contenteditable]'))send('escape');});
        addEventListener('error',event=>send('error',{message:String(event.message||'Script failed').slice(0,500)}));
        addEventListener('unhandledrejection',event=>send('error',{message:String(event.reason?.message||event.reason).slice(0,500)}));
        root.addEventListener('pointerdown',event=>{
            if(!editing||event.button!==0||event.target.closest('[data-air-editor]'))return;
            draggedClick=false;
            if(!event.altKey&&event.target.closest('button,input,textarea,select,a,[contenteditable],[data-air-no-drag]'))return;
            let node=editor?editor.target(event.target):(event.target.closest('tspan')?.closest('text')||event.target);if(!(node instanceof Element)||node===root)return;
            if(node.namespaceURI===svgNamespace&&(['defs','clippath'].includes(node.tagName.toLowerCase())||(!editor&&['svg','g'].includes(node.tagName.toLowerCase()))))return;
            selectedId=key(node);root.querySelectorAll('.air-element-selected').forEach(item=>item.classList.remove('air-element-selected'));if(!editor)node.classList.add('air-element-selected');
            editor?.select(node);
            const id=key(node),old=edits[id]||{},x=old.x||0,y=old.y||0;
            drag={node,id,x,y,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,moved:false,before:{x,y},label:(semantic.get(node)?.target?.kind==='label'?node.textContent:editor?.label(node)||node.getAttribute('aria-label')||node.textContent||node.tagName).trim().slice(0,50)};
        },true);
        root.addEventListener('pointermove',event=>{if(!drag)return;const x=drag.x+event.clientX-drag.startX,y=drag.y+event.clientY-drag.startY;
            if(Math.abs(x-drag.x)+Math.abs(y-drag.y)<3&&!drag.moved)return;
            if(!drag.moved&&event.isTrusted)root.setPointerCapture?.(event.pointerId);drag.moved=true;draggedClick=true;event.preventDefault();
            edits[drag.id]={...edits[drag.id],x:Math.round(x),y:Math.round(y)};drag.node.style.translate=x+'px '+y+'px';revealMoved(drag.node);editor?.refresh();event.stopImmediatePropagation();
        },true);
        function end(){if(!drag)return;const current=drag;drag=null;try{root.releasePointerCapture?.(current.pointerId);}catch(_){}if(current.moved){edits[current.id].anchor=anchorOf(current.node);record({element:current.id,label:current.label,action:'move',before:current.before,after:{x:edits[current.id].x,y:edits[current.id].y},anchor:edits[current.id].anchor});}}
        root.addEventListener('pointerup',end,true);root.addEventListener('pointercancel',end,true);
        root.addEventListener('click',event=>{if(draggedClick){event.preventDefault();event.stopImmediatePropagation();draggedClick=false;}},true);
        root.addEventListener('dblclick',event=>{
            if(!editing||event.target.closest('[data-air-editor],button,input,textarea,select,a,[contenteditable]'))return;
            const node=editor?editor.target(event.target):event.target;if(!node||node===root||node.children.length)return;
            event.preventDefault();event.stopImmediatePropagation();const id=key(node),before=node.textContent,box=node.getBoundingClientRect();
            const input=document.createElement('textarea');input.dataset.airEditor='true';input.value=before;
            input.style.cssText='position:fixed;z-index:2147483647;box-sizing:border-box;background:white;color:#172b43;border:2px solid #2875b9;left:'+box.left+'px;top:'+box.top+'px;width:'+Math.max(120,box.width)+'px;height:'+Math.max(45,box.height)+'px';
            document.body.append(input);input.focus();input.select();
            let cancelled=false;
            input.addEventListener('keydown',event=>{if(event.key==='Escape'){cancelled=true;input.blur();}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();input.blur();}});
            input.addEventListener('blur',()=>{const after=input.value;input.remove();if(cancelled||after===before)return;edits[id]={...edits[id],text:after,anchor:{...anchorOf(node),textOnly:edits[id]?.x===undefined}};node.textContent=after;record({element:id,action:'text',before,after});},{once:true});
        },true);
        const charts=new Map();
        let resizeBefore=null,tableBefore=null,tableChange=null;
        editor=window.airCreateElementEditor?.({root,key,charts:()=>[...charts.keys()],anchorOf,tableInfo,textOf,lang:initial.lang,notify:data=>send('editor',data),
            resize(node,size,finished,label,position){const id=key(node);if(!resizeBefore)resizeBefore=edits[id]?.size||null;const edit=edits[id]||={};edit.size=size;edit.anchor||={...anchorOf(node),textOnly:edit.x===undefined};applySize(node,edit);if(position){edit.x=position.x;edit.y=position.y;node.style.translate=position.x+'px '+position.y+'px';edit.anchor=anchorOf(node);}if(finished){record({element:id,label:label||node.dataset.airName||textOf(node)||node.tagName,action:'resize',before:resizeBefore,after:size,...(edit.x!==undefined?{position:{x:edit.x,y:edit.y||0}}:{} )});resizeBefore=null;}},
            resizeTable(node,change,finished){const id=key(node),edit=edits[id]||={};edit.anchor||=anchorOf(node);edit.tableLayout||={};if(change){tableBefore||=JSON.parse(JSON.stringify(edit.tableLayout));if(change.kind==='column'){const widths=change.widths.slice(),i=change.index,delta=Math.max(12-widths[i],Math.min(widths[i+1]-12,change.delta));widths[i]+=delta;widths[i+1]-=delta;const total=widths.reduce((a,b)=>a+b,0);edit.tableLayout.columns=change.headers.map((column,index)=>({column,ratio:widths[index]/total}));tableChange={action:'column-width:'+digest(change.headers[i]),column:change.headers[i],after:{width:Math.round(widths[i]),ratio:widths[i]/total}};}else{const row=node.rows[change.index],info=tableInfo(row.cells[0]),rowKey=info.head?'head':info.rowKey,height=Math.max(8,Math.round(change.height+change.delta));edit.tableLayout.rows=(edit.tableLayout.rows||[]).filter(item=>item.row!==rowKey);edit.tableLayout.rows.push({row:rowKey,height});tableChange={action:'row-height:'+digest(rowKey),row:change.index+1,after:{height}};}applySize(node,edit);}if(finished&&tableChange){record({element:id,label:initial.lang==='en'?'Table':'表格',...tableChange,before:tableBefore});tableBefore=null;tableChange=null;}}
        });editor?.setPrecision(initial.precision);editor?.setScale(initial.uiScale||1);if(!editing)editor?.hide();
        const resizeCharts=new ResizeObserver(entries=>{
            for(const entry of entries){const chart=charts.get(entry.target);if(!chart||chart.isDisposed())continue;
                const {clientWidth:width,clientHeight:height}=entry.target;
                if(width>0&&height>0&&(chart.getWidth()!==width||chart.getHeight()!==height)){chart.resize();bindChartElements();apply();}
            }
        });
        function observeCharts(){
            if(!window.echarts)return;
            for(const node of root.querySelectorAll('div,section,main,figure')){
                const chart=window.echarts.getInstanceByDom(node);if(!chart||chart.isDisposed())continue;
                if(charts.get(node)!==chart){charts.set(node,chart);resizeCharts.observe(node);}
                if(editing){const svg=node.querySelector('svg');if(svg?.parentElement)svg.parentElement.style.overflow='visible';}
                if(node.clientWidth>0&&node.clientHeight>0&&(chart.getWidth()!==node.clientWidth||chart.getHeight()!==node.clientHeight))chart.resize();
            }
            for(const [node,chart]of charts)if(!node.isConnected||chart.isDisposed()){resizeCharts.unobserve(node);charts.delete(node);}
            bindChartElements();
        }
        let queued=false;new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;observeCharts();apply();});}}).observe(root,{childList:true,subtree:true});
        function ready(){
            observeCharts();apply();
            // Off-screen iframe animation frames may pause until scrolled into view. Readiness must not depend on them.
            const zero=[...charts.keys()].find(node=>node.getClientRects().length&&(node.clientWidth<=0||node.clientHeight<=0));
            if(zero)send('error',{message:'图表容器宽度或高度为 0，请为图表提供可用尺寸（百分比高度需要父容器有明确高度）。'});
            send('ready');publish();clearTimeout(timer);timer=setTimeout(publish,300);
        }
        addEventListener('load',ready);
        new ResizeObserver(()=>{send('height',{height:Math.max(40,Math.ceil(Math.max(root.getBoundingClientRect().height,root.scrollHeight)))});}).observe(root);
    }
    async function assets(){
        if(!libraries)libraries=fetch(document.querySelector('script[src*="/js/vendor/echarts.min.js"]')?.src||'/js/vendor/echarts.min.js',{cache:'no-cache'}).then(response=>{if(!response.ok)throw new Error('Chart library unavailable');return response.text();}).catch(error=>{libraries=null;throw error;});
        return libraries;
    }
    function documentOf(spec,{library='',channel='',editing=true,precision=false,lang='zh',uiScale=1}={}){
        const csp="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
        const css='html,body{height:100%;margin:0;padding:0;background:#fff;color:#172b43;font:13px Arial,sans-serif}*{box-sizing:border-box}#air-content{position:relative;height:100%;min-height:0;display:flow-root}.air-editing #air-content *{cursor:move!important}.air-editing #air-content svg{overflow:visible!important}.air-editing #air-content svg [clip-path]{clip-path:none!important}.air-editing #air-content .air-element-selected{outline:1px dashed #3b82c4;outline-offset:2px}.air-editing #air-content :is(button,input,textarea,select,a,[contenteditable]){cursor:auto!important}'+String(spec.css||'');
        const editor=window.AiReportElementEditor?script('window.airCreateElementEditor='+window.AiReportElementEditor.toString()+';'):'';
        return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><style id="air-base">'+css.replace(/<\/style/gi,'<\\/style')+'</style>'+script(library)+editor+'</head><body><div id="air-content">'+String(spec.html||'')+'</div>'+script('('+runtime.toString()+')('+json({channel,editing,precision,lang,uiScale,axes:spec.axes,state:spec.state,edits:spec.edits,history:spec.history,replay:spec.replay})+');')+script(spec.script||'')+'</body></html>';
    }
    // A fixed report cell owns the height budget. Its frame must fit that budget rather than grow behind a clip.
    function availableHeight(frame){
        const cell=frame.closest('.air-cell.is-fit'),body=cell?.querySelector('.air-cell-body');
        if(!body)return null;
        let room=body.clientHeight,child=frame;
        while(child.parentElement){
            const parent=child.parentElement,style=getComputedStyle(parent);
            room-=(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0);
            const flow=[...parent.children].filter(node=>{const css=getComputedStyle(node);return css.display!=='none'&&!['absolute','fixed'].includes(css.position);});
            for(const sibling of flow)if(sibling!==child){const css=getComputedStyle(sibling);room-=sibling.offsetHeight+(parseFloat(css.marginTop)||0)+(parseFloat(css.marginBottom)||0);}
            room-=Math.max(0,flow.length-1)*(parseFloat(style.rowGap)||0);
            if(parent===body)break;child=parent;
        }
        return Math.max(40,Math.floor(room));
    }
    function mount(element,widget,{editing=true,lang='zh',onChange=()=>{}}={}){
        const spec=widget.spec,channel=crypto.randomUUID();
        element.innerHTML='';delete element.dataset.interactiveError;delete element.dataset.interactiveReady;element.style.height='auto';
        const note=document.createElement('div');note.className='air-interactive-error';note.setAttribute('role','status');element.append(note);
        const frame=document.createElement('iframe');frame.title=lang==='en'?'Interactive report cell':'交互月报格子';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');frame.className='air-interactive-frame';frame.style.height=(spec.height||240)+'px';element.append(frame);
        const fitHeight=()=>{const height=availableHeight(frame);if(height!==null&&frame.style.height!==height+'px')frame.style.height=height+'px';return height;};
        fitHeight();
        const sizing=new ResizeObserver(fitHeight);sizing.observe(element.closest('.air-cell-body')||element);
        let active=true,resolveReady;
        const ready=new Promise(resolve=>{resolveReady=resolve;});
        const waiting=new Map();
        const session={frame,channel,cellId:element.closest('[data-cell]')?.dataset.cell,ready,flush(){return new Promise(resolve=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{waiting.delete(id);resolve();},1000);waiting.set(id,()=>{clearTimeout(timer);resolve();});frame.contentWindow?.postMessage({airInteractive:channel,type:'snapshot',requestId:id},'*');});},dispose(){active=false;sizing.disconnect();removeEventListener('message',listen);clearTimeout(timeout);resolveReady();for(const done of waiting.values())done();waiting.clear();sessions.delete(session);}};sessions.add(session);
        const timeout=setTimeout(()=>{if(!active)return;note.textContent=lang==='en'?'Loading timed out — regenerate this cell':'加载超时，可重新生成此格子';element.dataset.interactiveError=note.textContent;resolveReady();},8000);
        function listen(event){
            if(!active||event.source!==frame.contentWindow||event.data?.airInteractive!==channel)return;
            const data=event.data;
            if(data.type==='escape')element.dispatchEvent(new CustomEvent('air-cell-escape',{bubbles:true}));
            if(data.type==='editor'){session.selection=data;element.dispatchEvent(new CustomEvent('air-element-selection',{bubbles:true,detail:{cellId:session.cellId,...data}}));}
            if(data.type==='ready')element.dataset.interactiveReady='true';
            if(data.type==='height'&&Number.isFinite(data.height)&&fitHeight()===null){const height=Math.max(40,Math.min(1600,data.height));if(frame.style.height!==height+'px')frame.style.height=height+'px';}
            if(data.type==='error'){note.textContent=String(data.message||'Script failed').slice(0,500);element.dataset.interactiveError=note.textContent;resolveReady();}
            if(data.type==='change'){
                let value;try{const encoded=JSON.stringify({state:data.state,edits:data.edits,history:data.history,snapshot:data.snapshot,replay:data.replay||[]});if(encoded.length>500000)throw Error('Content too large');value=JSON.parse(encoded);if(typeof value.snapshot!=='string'||!Array.isArray(value.history)||!value.edits||typeof value.edits!=='object'||Array.isArray(value.edits))throw Error('Invalid edit record');value.history=value.history.filter(item=>item&&typeof item==='object'&&typeof item.action==='string').slice(-30);}catch(_){note.textContent=lang==='en'?'Edit record invalid or too large; changes were not saved':'修改记录无效或过大，未保存本次修改';return;}
                const notices=[];if(data.unresolved)notices.push(lang==='en'?`${data.unresolved} adjustment(s) could not be matched uniquely; retained in the previous prompt`:`${data.unresolved} 处调整未找到唯一对应元素；原要求保留在提示词中`);if(data.overflow)notices.push(lang==='en'?`${data.overflow} text item(s) extend beyond the visible area; enlarge the cell or adjust the component`:`${data.overflow} 处文字超出可见范围，可放大格子或调整组件尺寸`);note.textContent=notices.join('；');element.dataset.interactiveOverflow=String(data.overflow||0);onChange(widget,value);clearTimeout(timeout);resolveReady();if(data.requestId&&waiting.has(data.requestId)){waiting.get(data.requestId)();waiting.delete(data.requestId);}
            }
        }
        addEventListener('message',listen);
        assets().then(library=>{if(active)frame.srcdoc=documentOf(spec,{library,channel,editing,lang,uiScale:frame.getBoundingClientRect().width/(frame.offsetWidth||1)||1,precision:precisionCells.has(session.cellId)||!!element.closest('.air-focus-cell')});}).catch(error=>{if(active){note.textContent=error.message;element.dataset.interactiveError=note.textContent;resolveReady();}});
        return session;
    }
    function dispose(){for(const session of [...sessions])session.dispose();}
    async function settle(cellId){
        const current=()=>[...sessions].filter(session=>!cellId||session.cellId===cellId);
        let pending=current();
        for(let attempt=0;attempt<10;attempt++){await Promise.all(pending.map(session=>session.ready));const next=current();if(next.length===pending.length&&next.every(session=>pending.includes(session)))return;pending=next;}
    }
    function promptWithEdits(prompt,widgets){
        const lines=[];
        for(const widget of widgets||[])if(widget.type==='interactive')for(const edit of widget.spec?.history||[]){
            // A fresh chart edit supersedes the matching legacy SVG path record, which is no longer replayed.
            if(String(edit.element).startsWith('node-')&&edit.label&&(widget.spec.history||[]).some(item=>String(item.element).startsWith('air-chart-')&&item.label===edit.label&&item.action===edit.action))continue;
            const rawName=String(edit.label||edit.element||'内容').replace(/\s+/g,' ').slice(0,50),name=String(edit.element).startsWith('air-chart-')&&String(edit.element).includes('-label-')?'数值标签“'+((widget.spec.edits?.[edit.element]?.anchor||edit.anchor)?.target?.category?String((widget.spec.edits?.[edit.element]?.anchor||edit.anchor).target.category).replace(/\s+/g,' ')+' / ':'')+rawName+'”':rawName;
            if(edit.action==='text')lines.push(name+'文字改为“'+String(edit.after||'').replace(/\r?\n/g,'\\n').slice(0,150)+'”');
            else if(edit.action==='resize'){const size=widget.spec.edits?.[edit.element]?.size||edit.after;lines.push(name+(size?.kind==='text'?'字号调整为 '+size.fontSize.toFixed(1)+'px':'尺寸调整为 '+Math.round(size?.width||0)+' × '+Math.round(size?.height||0)+'px')+(edit.position?'；同步位置偏移 '+Math.round(edit.position.x)+'px、'+Math.round(edit.position.y)+'px':''));}
            else if(String(edit.action||'').startsWith('column-width:'))lines.push(name+'列“'+edit.column+'”宽度调整为 '+edit.after.width+'px（占表宽 '+(edit.after.ratio*100).toFixed(1)+'%）');
            else if(String(edit.action||'').startsWith('row-height:'))lines.push(name+'第 '+edit.row+' 行高度调整为 '+edit.after.height+'px（从表头开始计数）');
            else if(edit.action==='move'){const anchor=widget.spec.edits?.[edit.element]?.anchor||edit.anchor;lines.push(name+'相对原位偏移 '+edit.after?.x+'px、'+edit.after?.y+'px'+(anchor?.kind==='chart-label'?'；保持与对应柱顶的位置关系：文字中心距柱顶横向 '+anchor.x.toFixed(2)+'、纵向 '+anchor.y.toFixed(2)+' 个字高（接近 0 表示文字中心压在柱顶边缘）':anchor?.kind==='table-cell'?'；绑定'+(anchor.target.head?'表头':'单元格')+'“'+anchor.target.column+'”，保持相对自身原位横向 '+anchor.x.toFixed(2)+'、纵向 '+anchor.y.toFixed(2)+' 个字高，不随行高放大偏移':anchor?.kind==='relative'?'；保持在所属容器中的相对位置':'（允许重新排版）'));}
            else if(edit.description)lines.push(String(edit.description).replace(/\s+/g,' ').slice(0,200));
        }
        const clean=String(prompt||'').replace(/\n*【手工展示调整】[\s\S]*?(?=\n【[^】\n]+】|$)/g,'').trim();
        const summary=lines.slice(-15).join('；');
        const room=Math.max(0,4000-clean.length-'\n【手工展示调整】'.length);
        return clean+(summary&&room?'\n【手工展示调整】'+summary.slice(0,room):'');
    }
    function carryAdjustments(previous,next){
        const old=(previous||[]).filter(w=>w.type==='interactive'),fresh=(next||[]).filter(w=>w.type==='interactive');
        for(const widget of fresh){const matches=old.filter(w=>widget.alias?w.alias===widget.alias:w.id===widget.id),source=matches.length===1?matches[0]:old.length===1&&fresh.length===1?old[0]:null;if(!source)continue;
            widget.spec.replay=Object.entries(source.spec.edits||{}).filter(([,edit])=>edit.anchor?.kind&&edit.anchor?.target).map(([id,edit])=>({edit,histories:(source.spec.history||[]).filter(h=>h.element===id)}));
        }
    }
    function context(widgets){return (widgets||[]).filter(widget=>widget.type==='interactive').map(widget=>({id:widget.alias||widget.id,html:widget.spec.snapshot||widget.spec.html,script:widget.spec.script,css:widget.spec.css,state:widget.spec.state,changes:widget.spec.history}));}
    function command(cellId,data){for(const session of sessions)if(session.cellId===cellId)session.frame.contentWindow?.postMessage({airInteractive:session.channel,...data},'*');}
    function setPrecision(cellId,enabled){if(enabled)precisionCells.add(cellId);else precisionCells.delete(cellId);command(cellId,{type:'precision',enabled});}
    window.AiReportInteractive={carryAdjustments,mount,dispose,settle,setPrecision,setEditorScale:(cellId,scale)=>command(cellId,{type:'editor-scale',scale}),resizeElement:(cellId,width,height)=>command(cellId,{type:'element-size',width,height}),selectElement:(cellId,id)=>command(cellId,{type:'element-select',id}),selection:cellId=>[...sessions].find(session=>session.cellId===cellId)?.selection,flush:cellId=>Promise.all([...sessions].filter(session=>!cellId||session.cellId===cellId).map(session=>session.flush())),useLibrary:source=>{libraries=Promise.resolve(source);},documentOf,assets,promptWithEdits,context};
})();
