'use strict';
// The tray is a notch hanging from the very top edge of the screen on every
// platform. It may only slide horizontally; there are no side or bottom docks.
// NOTCH_EAR is the transparent strip on each side that holds the concave
// "shoulders" joining the notch to the screen edge. NOTCH_GLOW is the further
// transparent margin (sides and bottom) where the breathing halo is painted;
// the main process lets clicks there fall through to whatever is underneath.
const NOTCH_EAR = 12;
const NOTCH_GLOW = 10;
// The compact notch matches the menu bar (macOS) or this height where there is none.
const DEFAULT_BAR_HEIGHT = 32;
const COMPACT_WIDTH = 360;
const DETAIL = {width:286,height:426};
const SIDEBAR_SIZE = {width:COMPACT_WIDTH+(NOTCH_EAR+NOTCH_GLOW)*2,height:DEFAULT_BAR_HEIGHT+NOTCH_GLOW};
const DETAIL_SIZE = {width:DETAIL.width+(NOTCH_EAR+NOTCH_GLOW)*2,height:DETAIL.height+NOTCH_GLOW};
const EDGE_PEEK = 6;
function barHeight(area={}) {
    return Number.isFinite(area.barHeight)?Math.max(24,Math.min(44,Math.round(area.barHeight))):DEFAULT_BAR_HEIGHT;
}
function sidebarSize(_placement={},expanded=false,area={}) {
    return expanded?DETAIL_SIZE:{width:SIDEBAR_SIZE.width,height:barHeight(area)+NOTCH_GLOW};
}
function sidebarBounds(area, placement = {}, expanded = false) {
    const size=sidebarSize(placement,expanded,area);
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
    const width=Math.min(312,area.width),height=Math.min(234,area.height),gap=8;
    const side=NOTCH_EAR+NOTCH_GLOW;
    const inner=rail.width-side*2;
    const target=rail.x+side+26+(index+.5)*(inner-52)/3;
    let x=target-width/2,y=rail.y+rail.height-NOTCH_GLOW+gap;
    x=Math.round(Math.max(area.x,Math.min(area.x+area.width-width,x)));
    y=Math.round(Math.max(area.y,Math.min(area.y+area.height-height,y)));
    return {x,y,width,height,side:'top',pointer:Math.max(24,Math.min(width-24,target-x))};
}
function droppedSidebar(bounds,area,_placement={},expanded=false) {
    return sidebarBounds(area,{x:bounds.x},expanded);
}
module.exports={SIDEBAR_SIZE,DETAIL_SIZE,NOTCH_EAR,NOTCH_GLOW,DEFAULT_BAR_HEIGHT,EDGE_PEEK,barHeight,sidebarSize,sidebarBounds,droppedSidebar,collapsedBounds,peekBounds};
