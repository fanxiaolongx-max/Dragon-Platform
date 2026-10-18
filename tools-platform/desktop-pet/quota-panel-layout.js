'use strict';
const PANEL_SIZE = { width:264, height:246 };
function panelBounds(pet, area, anchor, previous) {
    const margin=8, gap=12;
    const width=Math.min(PANEL_SIZE.width,Math.max(1,area.width-margin*2));
    const height=Math.min(PANEL_SIZE.height,Math.max(1,area.height-margin*2));
    const figure=anchor || {x:pet.width*.4,y:pet.height*.4,width:pet.width*.6,height:pet.height*.6};
    const left=pet.x+figure.x, right=left+figure.width;
    const roomLeft=left-area.x-margin, roomRight=area.x+area.width-margin-right;
    let side=previous;
    const needed=width+gap;
    if(side==='left'&&roomLeft>=needed || side==='right'&&roomRight>=needed) { /* Preserve side while it fits. */ }
    else if(roomLeft>=needed&&roomRight>=needed) side=left+figure.width/2 >= area.x+area.width/2 ? 'left':'right';
    else side=roomLeft>=roomRight?'left':'right';
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
    const x=clamp(side==='left'?left-width-gap:right+gap,area.x+margin,area.x+area.width-width-margin);
    const y=clamp(pet.y+figure.y+figure.height-height,area.y+margin,area.y+area.height-height-margin);
    return {x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height),side};
}
module.exports={panelBounds,PANEL_SIZE};
