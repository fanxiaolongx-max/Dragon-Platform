(function(){
 'use strict';
 function start(api){
  let activeId=null,layer=null,frame=0;const highlighted=new Set();
  function clear(){layer?.remove();layer=null;for(const node of highlighted){node.classList.remove('metric-inspected');node.removeAttribute('data-inspect-color');}highlighted.clear();}
  function schedule(){if(activeId&&!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});}
  function draw(){
   clear();const buttons=api.root.querySelectorAll('[data-op="inspect-references"]');buttons.forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.block===activeId));button.title=api.t(button.dataset.block===activeId?'收起指标引用':'查看本组件指标引用',button.dataset.block===activeId?'Hide metric references':'Inspect component references');});
   if(!activeId||document.body.classList.contains('studio-preview'))return;
   const scope=[...api.root.querySelectorAll('[data-card-id]')].find(card=>card.dataset.cardId===activeId);if(!scope){activeId=null;return;}
   layer=document.createElement('div');layer.className='metric-inspector-layer';layer.setAttribute('data-controls','');layer.setAttribute('aria-label',api.t('指标引用详情','Metric reference details'));document.body.append(layer);
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('metric-inspector-lines');layer.append(svg);
   const occupied=[],routes=[],width=Math.min(280,window.innerWidth-24),leftLimit=window.scrollX+12,rightLimit=window.scrollX+window.innerWidth-width-12;
   const nodes=[...scope.querySelectorAll('[data-metric-token]')];
   const anchors=nodes.map(node=>node.getBoundingClientRect());
   if(!nodes.length){api.status(api.t('当前组件没有指标引用。输入 @ 可插入指标。','No metric references in this component. Type @ to insert one.'));return;}
   for(const [index,node] of nodes.entries()){
    node.classList.add('metric-inspected');node.dataset.inspectColor=String(index%6);highlighted.add(node);const rect=anchors[index];if(!rect.width||!rect.height)continue;
    const card=document.createElement('aside');card.className='metric-inspector-bubble';card.dataset.inspectColor=node.dataset.inspectColor;card.style.width=width+'px';const detail=api.describe(node.dataset.metricToken),heading=document.createElement('strong');heading.textContent=detail.title;card.append(heading);
    for(const text of detail.notes){const line=document.createElement('small');line.textContent=text;card.append(line);}layer.append(card);
    const height=card.getBoundingClientRect().height,preferredX=Math.max(leftLimit,Math.min(rightLimit,rect.left+window.scrollX)),anchorY=rect.bottom+window.scrollY;const gap=20+8*anchors.filter(other=>other.width&&Math.abs(other.bottom-rect.bottom)<16).length;let x=preferredX,y=anchorY+gap;if(rect.bottom+gap+height>window.innerHeight&&rect.top-height-gap>160)y=rect.top+window.scrollY-height-gap;
    // Prefer adjacent columns before stacking; all coordinates stay in document space.
    const intersects=(cx,cy)=>occupied.filter(box=>cx<box.x+box.width+8&&cx+width+8>box.x&&cy<box.y+box.height+8&&cy+height+8>box.y);
    for(let attempt=0;attempt<=occupied.length;attempt++){
     const candidates=[preferredX,...occupied.flatMap(box=>[box.x+box.width+8,box.x-width-8]),leftLimit,rightLimit].filter(cx=>cx>=leftLimit&&cx<=rightLimit).sort((a,b)=>Math.abs(a-preferredX)-Math.abs(b-preferredX));
     const free=candidates.find(cx=>!intersects(cx,y).length);if(free!==undefined){x=free;break;}
     y=Math.max(...intersects(preferredX,y).map(box=>box.y+box.height+8));
    }
    occupied.push({x,y,width,height});card.style.left=x+'px';card.style.top=y+'px';
    const line=document.createElementNS(svg.namespaceURI,'path'),startX=rect.left+rect.width/2+window.scrollX,endX=Math.max(x+12,Math.min(x+width-12,startX)),above=y+height<=rect.top+window.scrollY,startY=above?rect.top+window.scrollY:anchorY,endY=above?y+height:y,direction=above?-1:1;// Allocate separate horizontal lanes wherever leader spans overlap.
    const minX=Math.min(startX,endX),maxX=Math.max(startX,endX);let routeY=startY+direction*10;
    while(routes.some(route=>minX<=route.maxX+4&&maxX+4>=route.minX&&Math.abs(route.y-routeY)<8))routeY+=direction*8;
    routes.push({minX,maxX,y:routeY});line.dataset.inspectColor=node.dataset.inspectColor;line.setAttribute('d',`M ${startX} ${startY} L ${startX} ${routeY} L ${endX} ${routeY} L ${endX} ${endY}`);svg.append(line);
   }
   const bottom=Math.max(document.documentElement.scrollHeight,...occupied.map(box=>box.y+box.height+12));svg.setAttribute('width',String(document.documentElement.clientWidth));svg.setAttribute('height',String(bottom));
  }
  function toggle(blockId){activeId=activeId===blockId?null:blockId;draw();}
  // Refresh after report rendering/editing, without observing our own annotations.
  new MutationObserver(schedule).observe(api.root,{childList:true,characterData:true,subtree:true});
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeId){activeId=null;draw();}});
  return {toggle};
 }
 window.MonthlyReferenceInspector={start};
})();
