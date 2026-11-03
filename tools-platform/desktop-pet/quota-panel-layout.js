'use strict';
// The tray is a notch hanging from the very top edge of the screen on every
// platform. It may only slide horizontally; there are no side or bottom docks.
// NOTCH_EAR is the transparent strip on each side that holds the concave
// "shoulders" joining the notch to the screen edge.
const NOTCH_EAR = 12;
const SIDEBAR_SIZE = {width:360+NOTCH_EAR*2,height:64};
const DETAIL_SIZE = {width:286+NOTCH_EAR*2,height:426};
const EDGE_PEEK = 6;
function sidebarSize(_placement={},expanded=false) {
    return expanded?DETAIL_SIZE:SIDEBAR_SIZE;
}
function sidebarBounds(area, placement = {}, expanded = false) {
    const size=sidebarSize(placement,expanded);
    const width=Math.min(size.width,Math.max(1,area.width));
    const height=Math.min(size.height,Math.max(1,area.height));
    const x=Number.isFinite(placement?.x)?placement.x:area.x+(area.width-width)/2;
    const clamped=Math.max(area.x,Math.min(area.x+area.width-width,x));
    return {x:Math.round(clamped),y:area.y,width,height,mode:'top',orientation:'horizontal'};
}
function collapsedBounds(bounds) {
    return {...bounds,height:EDGE_PEEK};
}
function peekBounds(area,rail,index=0) {
    const width=Math.min(312,area.width),height=Math.min(234,area.height),gap=10;
    const inner=rail.width-NOTCH_EAR*2;
    const target=rail.x+NOTCH_EAR+26+(index+.5)*(inner-52)/3;
    let x=target-width/2,y=rail.y+rail.height+gap;
    x=Math.round(Math.max(area.x,Math.min(area.x+area.width-width,x)));
    y=Math.round(Math.max(area.y,Math.min(area.y+area.height-height,y)));
    return {x,y,width,height,side:'top',pointer:Math.max(24,Math.min(width-24,target-x))};
}
function droppedSidebar(bounds,area,_placement={},expanded=false) {
    return sidebarBounds(area,{x:bounds.x},expanded);
}
module.exports={SIDEBAR_SIZE,DETAIL_SIZE,NOTCH_EAR,EDGE_PEEK,sidebarSize,sidebarBounds,droppedSidebar,collapsedBounds,peekBounds};
