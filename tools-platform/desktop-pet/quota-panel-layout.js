'use strict';
const SIDEBAR_SIZE = {width:416,height:58};
const SIDE_SIZE = {width:152,height:184};
const DETAIL_SIZE = {width:286,height:426};
function sidebarSize(placement={},expanded=false) {
    const vertical=['left','right'].includes(placement?.mode)||placement?.mode==='free'&&placement.orientation==='vertical';
    return expanded?DETAIL_SIZE:vertical?SIDE_SIZE:SIDEBAR_SIZE;
}
function sidebarBounds(area, placement = {}, expanded = false) {
    const margin=Math.min(12,Math.max(0,Math.floor(Math.min(area.width,area.height)/8)));
    const mode=['left','right','top','bottom','free'].includes(placement?.mode)?placement.mode:'top';
    const orientation=['left','right'].includes(mode)?'vertical':mode==='free'&&placement.orientation==='vertical'?'vertical':'horizontal';
    const size=sidebarSize({...placement,mode},expanded);
    const width=Math.min(size.width,Math.max(1,area.width-margin*2));
    const height=Math.min(size.height,Math.max(1,area.height-margin*2));
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    const x=mode==='left'?area.x+margin:mode==='right'?area.x+area.width-width-margin:
        Number.isFinite(placement?.x)?placement.x:area.x+(area.width-width)/2;
    const y=mode==='top'?area.y+margin:mode==='bottom'?area.y+area.height-height-margin:
        Number.isFinite(placement?.y)?placement.y:area.y+(area.height-height)/2;
    return {x:Math.round(clamp(x,area.x+margin,area.x+area.width-width-margin)),y:Math.round(clamp(y,area.y+margin,area.y+area.height-height-margin)),width,height,mode,orientation};
}
function droppedSidebar(bounds,area,placement={},expanded=false) {
    // Select the closest edge before changing the window's size at a corner.
    const edges=[['top',Math.abs(bounds.y-area.y)],['bottom',Math.abs(bounds.y+bounds.height-area.y-area.height)],
        ['left',Math.abs(bounds.x-area.x)],['right',Math.abs(bounds.x+bounds.width-area.x-area.width)]];
    edges.sort((a,b)=>a[1]-b[1]);
    const mode=edges[0][1]<=40?edges[0][0]:'free';
    return sidebarBounds(area,{...bounds,mode,orientation:placement.orientation},expanded);
}
module.exports={SIDEBAR_SIZE,sidebarSize,sidebarBounds,droppedSidebar};
