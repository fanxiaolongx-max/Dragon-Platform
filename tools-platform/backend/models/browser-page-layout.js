'use strict';

// 只返回布局尺寸，不读取表单值或向平台传递网页正文。与 Electron 共用同一探测逻辑。
function measurePageLayout() {
    const width=innerWidth,height=innerHeight;
    if(!document.body||width<1)return null;
    // 禁止缩放的 device-width 页面基本是手机专用 H5：按手机宽度展示，不必铺满侧栏。
    const viewport=(document.querySelector('meta[name="viewport" i]')?.content||'').toLowerCase().replace(/\s/g,'');
    if(/width=device-width/.test(viewport)&&/user-scalable=(no|0)|maximum-scale=1(\.0*)?(,|$)/.test(viewport))return {viewportWidth:width,mobile:true,preferredWidth:420};
    const samples=[],styles=new WeakMap();let visited=0,weight=0;
    const style=el=>{if(!styles.has(el))styles.set(el,getComputedStyle(el));return styles.get(el);};
    const visible=el=>{
        for(let node=el;node&&node!==document.documentElement;node=node.parentElement){
            const s=style(node);
            if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;
            // 页头、浮动按钮与提示条不决定正文的阅读宽度。
            if((s.position==='fixed'||s.position==='sticky')&&node.getBoundingClientRect().height<height*.35)return false;
        }
        return true;
    };
    const add=(rect,value)=>{
        if(rect.width<2||rect.height<2||rect.bottom<0||rect.top>height||rect.left<0||rect.right>width+2)return;
        samples.push({left:rect.left,right:Math.min(width,rect.right),weight:value});weight+=value;
    };
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()&&visited++<2400){
        const node=walker.currentNode,el=node.parentElement,text=node.textContent.trim();
        if(text.length<2||!el||el.closest('script,style,noscript,select,textarea,[aria-hidden="true"]')||!visible(el))continue;
        const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()];
        const value=Math.min(120,text.length)/Math.max(1,rects.length);
        for(const rect of rects)add(rect,value);
    }
    for(const el of [...document.querySelectorAll('img,video,canvas,iframe')].slice(0,120)){
        if(visible(el)){const r=el.getBoundingClientRect();add(r,Math.min(160,r.width*r.height/400));}
    }
    if(weight<100||samples.length<5)return {viewportWidth:width,preferredWidth:null};
    const percentile=(key,fraction)=>{
        let cumulative=0;
        for(const item of [...samples].sort((a,b)=>a[key]-b[key])){cumulative+=item.weight;if(cumulative>=weight*fraction)return item[key];}
        return width;
    };
    const left=percentile('left',.025),right=percentile('right',.975),contentWidth=Math.ceil(right-left);
    // 宽视口中的居中窄正文：留出内边距即可，无需把两侧空白也分配给侧栏。
    const narrow=width>720&&contentWidth>=200&&contentWidth<=680&&contentWidth<width*.72&&left>40&&width-right>40;
    return {viewportWidth:width,contentWidth,preferredWidth:narrow?Math.max(360,Math.ceil(contentWidth+64)):null};
}
module.exports={measurePageLayout,script:`(${measurePageLayout.toString()})()`};
