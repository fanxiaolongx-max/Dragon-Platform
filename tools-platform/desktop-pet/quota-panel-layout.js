'use strict';
const SIDEBAR_SIZE = {width:286,height:426};
function sidebarBounds(area, placement = {}) {
    const margin=Math.min(12,Math.max(0,Math.floor(Math.min(area.width,area.height)/8)));
    const width=Math.min(SIDEBAR_SIZE.width,Math.max(1,area.width-margin*2));
    const height=Math.min(SIDEBAR_SIZE.height,Math.max(1,area.height-margin*2));
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    const mode=['left','free'].includes(placement?.mode)?placement.mode:'right';
    const x=mode==='free'&&Number.isFinite(placement.x)?placement.x:mode==='left'?area.x+margin:area.x+area.width-width-margin;
    const y=Number.isFinite(placement?.y)?placement.y:area.y+(area.height-height)/2;
    return {x:Math.round(clamp(x,area.x+margin,area.x+area.width-width-margin)),y:Math.round(clamp(y,area.y+margin,area.y+area.height-height-margin)),width,height,mode};
}
function droppedSidebar(bounds,area) {
    const mode=Math.abs(bounds.x+bounds.width-(area.x+area.width))<=40?'right':Math.abs(bounds.x-area.x)<=40?'left':'free';
    return sidebarBounds(area,{...bounds,mode});
}
module.exports={SIDEBAR_SIZE,sidebarBounds,droppedSidebar};
