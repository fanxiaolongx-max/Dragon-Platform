'use strict';
const SIDEBAR_SIZE = {width:360,height:64};
const SIDE_SIZE = {width:68,height:248};
const DETAIL_SIZE = {width:286,height:426};
const EDGE_PEEK = 6;
function sidebarSize(placement={},expanded=false) {
    const vertical=['left','right'].includes(placement?.mode)||placement?.mode==='free'&&placement.orientation==='vertical';
    return expanded?DETAIL_SIZE:vertical?SIDE_SIZE:SIDEBAR_SIZE;
}
function sidebarBounds(area, placement = {}, expanded = false) {
    // The native window AND its painted surface meet the edge, with no inset.
    const margin=0;
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
function collapsedBounds(bounds) {
    const {mode}=bounds;
    if(mode==='top')return {...bounds,height:EDGE_PEEK};
    if(mode==='bottom')return {...bounds,y:bounds.y+bounds.height-EDGE_PEEK,height:EDGE_PEEK};
    if(mode==='left')return {...bounds,width:EDGE_PEEK};
    if(mode==='right')return {...bounds,x:bounds.x+bounds.width-EDGE_PEEK,width:EDGE_PEEK};
    return bounds;
}
function peekBounds(area,rail,index=0) {
    const width=Math.min(312,area.width),height=Math.min(234,area.height),gap=10;
    const vertical=rail.orientation==='vertical';
    const target=vertical?rail.y+38+(index+.5)*(rail.height-44)/3:rail.x+26+(index+.5)*(rail.width-52)/3;
    let side=rail.mode;
    if(side==='free')side=vertical?(rail.x+rail.width/2>area.x+area.width/2?'right':'left'):(rail.y+rail.height/2>area.y+area.height/2?'bottom':'top');
    let x=vertical?(side==='right'?rail.x-width-gap:rail.x+rail.width+gap):target-width/2;
    let y=vertical?target-height/2:(side==='bottom'?rail.y-height-gap:rail.y+rail.height+gap);
    x=Math.round(Math.max(area.x,Math.min(area.x+area.width-width,x)));
    y=Math.round(Math.max(area.y,Math.min(area.y+area.height-height,y)));
    return {x,y,width,height,side,pointer:Math.max(24,Math.min((vertical?height:width)-24,target-(vertical?y:x)))};
}
function droppedSidebar(bounds,area,placement={},expanded=false) {
    // Select the closest edge before changing the window's size at a corner.
    const edges=[['top',Math.abs(bounds.y-area.y)],['bottom',Math.abs(bounds.y+bounds.height-area.y-area.height)],
        ['left',Math.abs(bounds.x-area.x)],['right',Math.abs(bounds.x+bounds.width-area.x-area.width)]];
    edges.sort((a,b)=>a[1]-b[1]);
    const mode=edges[0][1]<=40?edges[0][0]:'free';
    return sidebarBounds(area,{...bounds,mode,orientation:placement.orientation},expanded);
}
module.exports={SIDEBAR_SIZE,EDGE_PEEK,sidebarSize,sidebarBounds,droppedSidebar,collapsedBounds,peekBounds};
