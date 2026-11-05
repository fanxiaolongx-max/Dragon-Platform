/* Serialized into the opaque cell frame. Editor chrome stays outside the report content/snapshot. */
(function(){
    'use strict';
    window.AiReportElementEditor=function({root,key,charts,anchorOf,tableInfo,textOf,resize,resizeTable,notify,lang='zh'}){
        const en=lang==='en',L=(zh,english)=>en?english:zh;
        let precision=false,selected=null,pinned=null,hovered=null,tree=[],lastMessage='',gesture=null,uiScale=1;
        const ui=document.createElement('div');ui.dataset.airEditor='true';
        ui.innerHTML='<style>[data-air-editor] .ae-box{position:fixed;pointer-events:none;z-index:2147483645;border:1px dashed #3184c9;box-sizing:border-box}[data-air-editor] .ae-selected{border:1px solid #1972bf}[data-air-editor] .ae-label{position:absolute;left:0;bottom:100%;font:11px/20px Arial,sans-serif;white-space:nowrap;background:#eaf4ff;color:#124e81;padding:0 5px;border-radius:3px;max-width:240px;overflow:hidden;text-overflow:ellipsis}[data-air-editor] .ae-handle{position:absolute;right:-6px;bottom:-6px;width:13px;height:13px;padding:0;border:2px solid #1972bf;background:#fff;pointer-events:auto;cursor:nwse-resize;border-radius:3px;box-shadow:0 1px 4px #17385233}[data-air-editor] .ae-edge{position:fixed;pointer-events:auto;background:transparent;border:0;padding:0;z-index:2147483646}[data-air-editor] .ae-edge:hover{background:#2184cc55}[data-air-editor] .ae-column{width:9px;cursor:col-resize}[data-air-editor] .ae-row{height:9px;cursor:row-resize}</style><div class="ae-box ae-hover" hidden><span class="ae-label"></span></div><div class="ae-box ae-selected" hidden><button type="button" class="ae-handle"></button></div><div class="ae-edges"></div>';
        document.body.append(ui);
        const hoverBox=ui.querySelector('.ae-hover'),selectionBox=ui.querySelector('.ae-selected'),edges=ui.querySelector('.ae-edges'),handle=ui.querySelector('.ae-handle');
        handle.title=L('拖动缩放当前组件','Drag to resize this component');handle.setAttribute('aria-label',handle.title);
        handle.dataset.resize='se';const handles=[handle];
        for(const direction of ['nw','n','ne','e','s','sw','w']){const button=handle.cloneNode();button.dataset.resize=direction;button.title=L('缩放组件：','Resize component: ')+direction;button.setAttribute('aria-label',button.title);selectionBox.append(button);handles.push(button);}
        const directions={nw:['左上','top left'],n:['上侧','top'],ne:['右上','top right'],e:['右侧','right'],se:['右下','bottom right'],s:['下侧','bottom'],sw:['左下','bottom left'],w:['左侧','left']};for(const control of handles){const labels=directions[control.dataset.resize];control.title=L('缩放组件：','Resize component: ')+L(labels[0],labels[1]);control.setAttribute('aria-label',control.title);}
        const visible=node=>{const b=node.getBoundingClientRect();return (b.width>0||b.height>0)&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden';};
        const excluded=node=>/^(SCRIPT|STYLE|COLGROUP|COL|DEFS|CLIPPATH|TITLE|DESC)$/.test(node.tagName.toUpperCase())||node.hasAttribute('data-air-internal');
        function name(node){
            if(node.dataset.airName)return node.dataset.airName.slice(0,70);
            if(charts().includes(node))return L('图表','Chart');
            const tag=node.tagName.toUpperCase(),text=textOf(node);
            if(tag==='TABLE')return L('表格','Table');if(tag==='TR')return node.querySelector('th')?L('表头行','Header row'):L('数据行','Data row')+' · '+text.slice(0,24);
            if(tag==='TH'||tag==='TD')return (tag==='TH'?L('表头','Header'):L('单元格','Cell'))+' · '+text.slice(0,30);
            const a=anchorOf(node);if(a?.kind?.startsWith('chart-'))return (a.kind==='chart-label'?L('数值标签','Value label'):L('图形','Mark'))+' · '+a.target.category+(tag==='TEXT'?' / '+text:'');
            if(node.namespaceURI==='http://www.w3.org/2000/svg'){if(tag==='TEXT')return L('图表文字','Chart text')+' · '+text;if(tag==='SVG')return L('矢量图','Vector graphic');return L('图形元素','Graphic')+' · '+tag.toLowerCase();}
            if(!node.children.length||/^H[1-6]$/.test(tag)||tag==='P')return text.slice(0,45)||tag;
            return node.getAttribute('aria-label')||node.id||L('内容组','Content group');
        }
        function rebuild(){
            tree=[];const hosts=charts();
            function walk(node,parent){
                if(excluded(node)||!visible(node))return;
                const children=[...node.children].filter(n=>!excluded(n));
                // A single anonymous page wrapper is layout plumbing, rather than the only editable top-level object.
                if(parent===null&&node.parentElement===root&&children.length&&root.children.length===1&&!hosts.includes(node)&&!node.dataset.airElement&&!node.dataset.airName&&/^(DIV|SECTION|MAIN|ARTICLE)$/.test(node.tagName)){for(const child of children)walk(child,null);return;}
                const entry={node,id:key(node),name:name(node),parent,depth:parent?parent.depth+1:1};tree.push(entry);
                if(hosts.includes(node)){for(const mark of node.querySelectorAll('svg text,svg path,svg rect,svg circle,svg ellipse,svg line,svg polygon,svg polyline'))walk(mark,entry);return;}
                if(node.tagName==='TABLE'){for(const row of node.rows)if(row.closest('table')===node)walk(row,entry);return;}
                for(const child of children)walk(child,entry);
            }
            for(const child of root.children)walk(child,null);
        }
        function entryOf(node){return tree.find(item=>item.node===node);}
        function resolve(raw){
            if(!(raw instanceof Element))return null;
            let node=raw.closest('tspan')?.closest('text')||raw;
            let entry;while(node&&node!==root){entry=entryOf(node);if(entry)break;node=node.parentElement;}
            if(!entry)return null;
            if(precision){if(pinned?.isConnected&&pinned.contains(raw))return pinned;return entry.node;}
            while(entry.parent)entry=entry.parent;return entry.node;
        }
        selectionBox.style.zIndex='2147483647';
        function boxAt(box,node){
            box.hidden=!node?.isConnected;if(box.hidden)return;
            const b=node.getBoundingClientRect();Object.assign(box.style,{left:b.left+'px',top:b.top+'px',width:Math.max(1,b.width)+'px',height:Math.max(1,b.height)+'px'});
            const left=Math.max(0,Math.min(innerWidth,b.left)),right=Math.max(0,Math.min(innerWidth,b.right)),top=Math.max(0,Math.min(innerHeight,b.top)),bottom=Math.max(0,Math.min(innerHeight,b.bottom));
            if(box===selectionBox)for(const control of handles){const direction=control.dataset.resize,size=14/uiScale,x=direction.includes('w')?left:direction.includes('e')?right:(left+right)/2,y=direction.includes('n')?top:direction.includes('s')?bottom:(top+bottom)/2;Object.assign(control.style,{position:'fixed',width:size+'px',height:size+'px',left:Math.max(2/uiScale,Math.min(innerWidth-size-2/uiScale,x-size/2))+'px',top:Math.max(2/uiScale,Math.min(innerHeight-size-2/uiScale,y-size/2))+'px',right:'auto',bottom:'auto',cursor:direction.length===1?(direction==='n'||direction==='s'?'ns-resize':'ew-resize'):direction==='nw'||direction==='se'?'nwse-resize':'nesw-resize'});}
            if(box===hoverBox)Object.assign(hoverBox.querySelector('span').style,{position:'fixed',left:Math.max(2/uiScale,Math.min(innerWidth-242/uiScale,left))+'px',top:Math.max(2/uiScale,top-22/uiScale)+'px',bottom:'auto',fontSize:11/uiScale+'px',lineHeight:20/uiScale+'px',maxWidth:Math.min(innerWidth-4/uiScale,240/uiScale)+'px'});
        }
        function message(){
            const current=entryOf(selected),path=[];for(let entry=current;entry;entry=entry.parent)path.unshift({id:entry.id,name:entry.name,depth:entry.depth});
            const b=selected?.getBoundingClientRect(),data={precision,selected:current?.id||'',size:b?{width:Math.round(b.width),height:Math.round(b.height)}:null,path,items:precision?tree.map(({id,name,depth})=>({id,name,depth})):[]};
            const encoded=JSON.stringify(data);if(encoded!==lastMessage){lastMessage=encoded;notify(data);}
        }
        function tableEdges(){
            edges.replaceChildren();if(!precision||!selected)return;
            const table=selected.tagName==='TABLE'?selected:null;if(!table)return;
            const info=tableInfo(table.querySelector('th,td'));if(!info)return;
            const bounds=table.getBoundingClientRect(),header=[...table.rows].find(row=>row.querySelector('th'));
            const cells=header?[...header.cells]:[];
            cells.slice(0,-1).forEach((cell,index)=>{const b=cell.getBoundingClientRect(),button=document.createElement('button');button.type='button';button.className='ae-edge ae-column';button.title=L('调整列宽：','Resize column: ')+info.headers[index];button.setAttribute('aria-label',button.title);button.style.cssText=`left:${b.right-4}px;top:${bounds.top}px;height:${bounds.height}px`;button.addEventListener('pointerdown',event=>beginTable(event,table,'column',index));edges.append(button);});
            [...table.rows].forEach((row,index)=>{const b=row.getBoundingClientRect(),button=document.createElement('button');button.type='button';button.className='ae-edge ae-row';button.title=L('调整行高：第','Resize row: ')+(index+1)+(en?'':'行');button.setAttribute('aria-label',button.title);button.style.cssText=`left:${bounds.left}px;top:${b.bottom-4}px;width:${bounds.width}px`;button.addEventListener('pointerdown',event=>beginTable(event,table,'row',index));edges.append(button);});
        }
        function refresh(){
            rebuild();if(selected&&!selected.isConnected)selected=null;if(pinned&&!pinned.isConnected)pinned=null;
            boxAt(selectionBox,selected);boxAt(hoverBox,hovered);if(hovered)hoverBox.querySelector('span').textContent=L('第','Level ')+(entryOf(hovered)?.depth||1)+(en?' · ':'层 · ')+name(hovered);
            if(!gesture)tableEdges();message();
        }
        function select(node){selected=node;refresh();return node;}
        function stop(event){event.preventDefault();event.stopImmediatePropagation();}
        function begin(event){
            if(!selected||event.button!==0)return;stop(event);
            const node=selected,b=node.getBoundingClientRect(),style=getComputedStyle(node),svg=node.namespaceURI==='http://www.w3.org/2000/svg';
            const offset=String(node.style.translate||'0 0').split(/\s+/).map(parseFloat);
            gesture={node,pointer:event.pointerId,x:event.clientX,y:event.clientY,width:Math.max(1,b.width),height:Math.max(1,b.height),font:parseFloat(style.fontSize)||12,svg,direction:event.currentTarget.dataset.resize||'se',offset:{x:offset[0]||0,y:offset[1]||0},text:node.tagName.toLowerCase()==='text'||(!node.children.length&&!svg&&!/^(TABLE|TH|TD|TR|IMG|DIV)$/.test(node.tagName)),before:null};
            if(event.isTrusted)event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        function beginTable(event,table,kind,index){
            if(event.button!==0)return;stop(event);const info=tableInfo(table.querySelector('th,td'));
            gesture={node:table,pointer:event.pointerId,x:event.clientX,y:event.clientY,table:kind,index,widths:[...table.rows[0].cells].map(c=>c.getBoundingClientRect().width),height:table.rows[index]?.getBoundingClientRect().height||0,headers:info.headers};
            if(event.isTrusted)event.target.setPointerCapture?.(event.pointerId);
        }
        for(const control of handles)control.addEventListener('pointerdown',begin);
        function sizeOf(g,width,height){const rw=width/g.width,rh=height/g.height,ratio=Math.abs(rw-1)>Math.abs(rh-1)?rw:rh;return g.text?{kind:'text',fontSize:Math.max(1,g.font*ratio)}:g.svg?{kind:'svg',width,height}:{kind:'box',width,height};}
        document.addEventListener('pointermove',event=>{
            if(!gesture){if(!root.contains(event.target))return;const next=resolve(event.target);if(next!==hovered){hovered=next;boxAt(hoverBox,next);if(next)hoverBox.querySelector('span').textContent=L('第','Level ')+(entryOf(next)?.depth||1)+(en?' · ':'层 · ')+name(next);}return;}
            stop(event);const g=gesture,dx=event.clientX-g.x,dy=event.clientY-g.y;if(!g.moved&&Math.abs(dx)+Math.abs(dy)<2)return;g.moved=true;
            if(g.table)resizeTable(g.node,{kind:g.table,index:g.index,headers:g.headers,widths:g.widths,delta:g.table==='column'?dx:dy,height:g.height},false);
            else{const d=g.direction,width=Math.max(1,g.width+(d.includes('w')?-dx:d.includes('e')?dx:0)),height=Math.max(1,g.height+(d.includes('n')?-dy:d.includes('s')?dy:0));g.value=sizeOf(g,width,height);g.position=d.includes('w')||d.includes('n')?{x:g.offset.x+(d.includes('w')?g.width-width:0),y:g.offset.y+(d.includes('n')?g.height-height:0)}:null;resize(g.node,g.value,false,name(g.node),g.position);}
            boxAt(selectionBox,selected);boxAt(hoverBox,null);
        },true);
        function end(event){if(!gesture)return;stop(event);const g=gesture;gesture=null;if(g.moved){if(g.table)resizeTable(g.node,null,true);else resize(g.node,g.value,true,name(g.node),g.position);}refresh();}
        document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);
        root.addEventListener('pointerleave',()=>{hovered=null;boxAt(hoverBox,null);});
        return {refresh,select,label:name,target(raw){rebuild();return resolve(raw);},isResizing:()=>!!gesture,setScale(value){uiScale=Number.isFinite(value)&&value>0?value:1;refresh();},resizeTo(width,height){if(!selected||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return;const b=selected.getBoundingClientRect(),svg=selected.namespaceURI==='http://www.w3.org/2000/svg',g={width:Math.max(1,b.width),height:Math.max(1,b.height),font:parseFloat(getComputedStyle(selected).fontSize)||12,svg,text:selected.tagName.toLowerCase()==='text'||(!selected.children.length&&!svg&&!/^(TABLE|TH|TD|TR|IMG|DIV)$/.test(selected.tagName))};resize(selected,sizeOf(g,width,height),true,name(selected));refresh();},setPrecision(value){precision=!!value;pinned=null;hovered=null;if(!precision&&selected)selected=resolve(selected);refresh();},command(data){rebuild();if(data.id===''){pinned=null;return refresh();}const found=tree.find(item=>item.id===data.id);if(found){pinned=found.node;select(found.node);}},hide(){ui.hidden=true;},show(){ui.hidden=false;refresh();}};
    };
})();
