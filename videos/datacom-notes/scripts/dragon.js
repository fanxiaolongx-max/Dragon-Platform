/* 毛绒小龙主持人（讲解稿 "host":"dragon" 时替代 clawd.js，接口相同）。
   素材：assets/mascot/dragon-stand-s.png（待机）/ dragon-point-s.png（抬手指向），已是透明 PNG、同一画布对齐。
   姿态：cIdle 呼吸+轻摆、cPoint 切换指向图+小跳、cThink 歪头+问号泡、cNod 点头、cEnter 入场。 */
function clawd(id,o){o=o||{};var w=300,h=Math.round(w*460/399);
 return '<div id="'+id+'" style="position:relative;left:-14px;top:-96px;width:'+w+'px;height:'+h+'px">'+
 '<div style="position:absolute;left:12%;right:12%;bottom:-6px;height:22px;border-radius:50%;background:rgba(0,0,0,.45);filter:blur(6px)"></div>'+
 '<div id="'+id+'-hop" style="position:absolute;inset:0;transform-origin:50% 100%">'+
  '<div id="'+id+'-sway" style="position:absolute;inset:0;transform-origin:50% 100%">'+
   '<div id="'+id+'-body" style="position:absolute;inset:0;transform-origin:50% 100%">'+
    '<img id="'+id+'-stand" src="assets/mascot/dragon-stand-s.png" style="position:absolute;inset:0;width:100%;height:100%">'+
    '<img id="'+id+'-point" src="assets/mascot/dragon-point-s.png" style="position:absolute;inset:0;width:100%;height:100%;opacity:0">'+
 '</div></div></div>'+
 '<div id="'+id+'-think" style="position:absolute;left:-30px;top:-10px;width:78px;height:78px;border-radius:50%;background:#f8fafc;border:3px solid #b45309;display:flex;align-items:center;justify-content:center;font:900 52px/1 sans-serif;color:#b45309;opacity:0">?</div>'+
 '</div>';}
function cIdle(tl,id,t,dur){var n=Math.max(1,Math.floor(dur/1.8)),m=Math.max(1,Math.floor(dur/3.2));
 tl.fromTo("#"+id+"-body",{scaleY:1,scaleX:1},{scaleY:1.022,scaleX:.992,duration:.9,repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t);
 tl.fromTo("#"+id+"-sway",{rotation:-1.2},{rotation:1.2,duration:1.6,repeat:m*2-1,yoyo:true,ease:"sine.inOut"},t);}
function cEnter(tl,sel,t){tl.fromTo(sel,{opacity:0,y:120},{opacity:1,y:0,duration:.55,ease:"back.out(1.5)"},t);}
function cPoint(tl,id,t,hold){hold=hold||1;
 tl.to("#"+id+"-point",{opacity:1,duration:.14,ease:"none"},t);tl.to("#"+id+"-stand",{opacity:0,duration:.14,ease:"none"},t);
 tl.to("#"+id+"-hop",{y:-12,duration:.16,yoyo:true,repeat:1,ease:"power2.out"},t);
 tl.to("#"+id+"-stand",{opacity:1,duration:.18,ease:"none"},t+.3+hold);tl.to("#"+id+"-point",{opacity:0,duration:.18,ease:"none"},t+.3+hold);}
function cThink(tl,id,t,hold){hold=hold||2;
 tl.to("#"+id+"-hop",{rotation:-5,duration:.3,ease:"sine.out"},t);
 tl.fromTo("#"+id+"-think",{opacity:0,scale:.5},{opacity:1,scale:1,duration:.3,ease:"back.out(2)"},t+.1);
 tl.to("#"+id+"-think",{y:-8,duration:.5,yoyo:true,repeat:Math.max(1,Math.floor(hold/.5)-1),ease:"sine.inOut"},t+.4);
 tl.to("#"+id+"-think",{opacity:0,duration:.2},t+hold);tl.to("#"+id+"-hop",{rotation:0,duration:.3,ease:"sine.inOut"},t+hold);}
function cNod(tl,id,t,n){n=n||2;tl.to("#"+id+"-hop",{y:9,duration:.16,yoyo:true,repeat:n*2-1,ease:"sine.inOut"},t);}
