/* Content change transition for cells: the old content breaks into dots that spray out, the dots fly to where the new
   content's text and chart marks are and gather there, and the new content comes into focus. Dots take the colour of
   the ink they come from. Only cells on screen animate; reduced motion skips it all. */
(function(){
    'use strict';
    const DURATION=1150,EASE='cubic-bezier(.3,.7,.25,1)';
    const gaussian=()=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    const visible=rect=>rect.bottom>0&&rect.top<innerHeight&&rect.width>0;
    const light=color=>{const [r=255,g=255,b=255]=(String(color).match(/\d+(\.\d+)?/g)||[]).map(Number);return (0.299*r+0.587*g+0.114*b)/255>0.86;};
    const usable=color=>color&&!/^(none|transparent)$/i.test(color)&&!/rgba\([^)]*,\s*0\)/.test(color)&&!light(color);

    // Where the ink is: text line boxes (in the text colour) and chart marks (in their fill), weighted by area.
    function inkBoxes(body){
        const boxes=[],range=document.createRange(),walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.textContent.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
        for(let node=walker.nextNode();node&&boxes.length<500;node=walker.nextNode()){
            const color=getComputedStyle(node.parentElement).color;range.selectNodeContents(node);
            for(const rect of range.getClientRects())if(rect.width>1&&rect.height>1)boxes.push({rect,color:usable(color)?color:'rgba(51,120,183,.6)'});
        }
        for(const mark of [...body.querySelectorAll('svg rect,svg path,svg circle')].slice(0,300)){
            const rect=mark.getBoundingClientRect(),fill=mark.getAttribute('fill')||getComputedStyle(mark).fill;
            if(rect.width>1&&rect.height>1&&rect.width*rect.height<60000&&usable(fill))boxes.push({rect,color:fill});
        }
        return boxes;
    }
    function sample(boxes,count,origin){
        const total=boxes.reduce((sum,box)=>sum+box.rect.width*box.rect.height,0);if(!total)return [];
        return Array.from({length:count},()=>{
            let pick=Math.random()*total,box=boxes[0];
            for(const item of boxes){pick-=item.rect.width*item.rect.height;if(pick<=0){box=item;break;}}
            return {x:box.rect.left-origin.left+Math.random()*box.rect.width,y:box.rect.top-origin.top+Math.random()*box.rect.height,color:box.color};
        });
    }
    // Before the report re-renders: a picture of each changed cell's old content and where its ink was.
    function capture(root,cellIds){
        if(reduced()||!cellIds.length)return null;
        const origin=root.getBoundingClientRect(),shots=[];
        for(const id of cellIds){
            const body=root.querySelector(`[data-cell="${CSS.escape(id)}"] .air-cell-body`),rect=body?.getBoundingClientRect();
            if(!body||!visible(rect))continue;
            // A picture only: no ids or data-* hooks, so nothing mistakes it for the live cell.
            const ghost=body.cloneNode(true);
            for(const node of [ghost,...ghost.querySelectorAll('*')])for(const name of node.getAttributeNames())if(name==='id'||name.startsWith('data-')||name==='contenteditable')node.removeAttribute(name);
            shots.push({id,ghost,rect:{left:rect.left-origin.left,top:rect.top-origin.top,width:rect.width,height:rect.height},boxes:inkBoxes(body),origin});
        }
        return shots.length?shots:null;
    }
    function play(root,shots){
        if(!shots)return;
        const origin=root.getBoundingClientRect();
        let layer=root.querySelector(':scope>.air-splash-layer');
        if(!layer){layer=document.createElement('div');layer.className='air-splash-layer';layer.setAttribute('aria-hidden','true');root.append(layer);}
        const gone=node=>{node.remove();if(!layer.childElementCount)layer.remove();};
        for(const shot of shots){
            const body=root.querySelector(`[data-cell="${CSS.escape(shot.id)}"] .air-cell-body`);if(!body)continue;
            const rect=body.getBoundingClientRect(),area=Math.max(shot.rect.width*shot.rect.height,rect.width*rect.height),count=Math.max(36,Math.min(140,Math.round(area/750)));
            const from=sample(shot.boxes,count,shot.origin),to=sample(inkBoxes(body),count,origin);
            const centre={x:rect.left-origin.left+rect.width/2,y:rect.top-origin.top+rect.height/2};
            // The old content, frozen where it was, blurs away while its dots leave.
            const ghost=document.createElement('div');ghost.className='air-splash-ghost';
            Object.assign(ghost.style,{left:shot.rect.left+'px',top:shot.rect.top+'px',width:shot.rect.width+'px',height:shot.rect.height+'px'});
            ghost.append(shot.ghost);layer.append(ghost);
            ghost.animate([{opacity:1,filter:'blur(0)'},{opacity:0,filter:'blur(8px)',transform:'scale(1.015)'}],{duration:DURATION*0.4,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'}).finished.then(()=>gone(ghost),()=>gone(ghost));
            body.animate([{opacity:0,filter:'blur(8px)'},{opacity:0,filter:'blur(8px)',offset:0.5},{opacity:1,filter:'blur(0)'}],{duration:DURATION,easing:'ease-out'});
            for(let index=0;index<count;index++){
                const start=from[index]||{x:centre.x+gaussian()*rect.width/6,y:centre.y+gaussian()*rect.height/6,color:to[index]?.color||'rgba(51,120,183,.6)'};
                const end=to[index]||{x:centre.x+gaussian()*rect.width/5,y:centre.y+gaussian()*rect.height/5,color:start.color};
                const spray={x:(start.x+end.x)/2+gaussian()*Math.min(90,rect.width/5),y:(start.y+end.y)/2+gaussian()*Math.min(60,rect.height/5)-18};
                const dot=document.createElement('span'),size=2+Math.random()*2.6;dot.className='air-splash-dot';
                Object.assign(dot.style,{left:start.x+'px',top:start.y+'px',width:size+'px',height:size+'px',background:start.color});
                layer.append(dot);
                const move=(point,scale)=>`translate(${point.x-start.x}px,${point.y-start.y}px) scale(${scale})`;
                dot.animate([
                    {transform:move(start,1),opacity:from[index]?0.95:0,background:start.color},
                    {transform:move(spray,0.7),opacity:0.85,filter:'blur(.6px)',offset:0.42,background:end.color},
                    {transform:move(end,1),opacity:0.9,offset:0.82,background:end.color},
                    {transform:move(end,0.4),opacity:0,background:end.color}
                ],{duration:DURATION*(0.85+Math.random()*0.3),delay:Math.random()*90,easing:EASE,fill:'both'}).finished.then(()=>gone(dot),()=>gone(dot));
            }
        }
        if(!layer.childElementCount)layer.remove();
    }
    window.AiReportSplash={capture,play};
})();
