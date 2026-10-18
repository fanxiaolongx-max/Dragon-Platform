/* 毛绒手札小龙：毛边滤镜 + 渐变体积 + 缝线 + 纽扣眼 + 小翅膀 */
function lighten(h,a){var n=parseInt(h.slice(1),16),r=n>>16,g=n>>8&255,b=n&255;r=Math.round(r+(255-r)*a);g=Math.round(g+(255-g)*a);b=Math.round(b+(255-b)*a);return "#"+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);}
function darken(h,a){var n=parseInt(h.slice(1),16),r=n>>16,g=n>>8&255,b=n&255;r=Math.round(r*(1-a));g=Math.round(g*(1-a));b=Math.round(b*(1-a));return "#"+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);}
function dino(id,o){o=o||{};var b=o.body||"#8fd8b8",bl=o.belly||"#fff1d2",sp=o.spike||"#ffb08a",wg=o.wing||"#f6b3c8",w=o.w||240,h=o.h||240;
 var L=lighten(b,.35),D=darken(b,.22),SD=darken(sp,.18),BD=darken(bl,.14),WD=darken(wg,.18),S=darken(b,.38);
 var g=function(n){return id+"-"+n;};
 var fur='filter="url(#'+g("fur")+')"';
 return '<svg id="'+id+'" class="fig" viewBox="0 0 240 240" width="'+w+'" height="'+h+'" style="overflow:visible">'+
 '<defs>'+
 '<radialGradient id="'+g("gb")+'" cx="42%" cy="34%" r="70%"><stop offset="0" stop-color="'+L+'"/><stop offset=".62" stop-color="'+b+'"/><stop offset="1" stop-color="'+D+'"/></radialGradient>'+
 '<radialGradient id="'+g("gl")+'" cx="40%" cy="30%" r="75%"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="'+bl+'"/></radialGradient>'+
 '<radialGradient id="'+g("gs")+'" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="'+lighten(sp,.35)+'"/><stop offset="1" stop-color="'+sp+'"/></radialGradient>'+
 '<radialGradient id="'+g("gw")+'" cx="30%" cy="70%" r="90%"><stop offset="0" stop-color="'+lighten(wg,.35)+'"/><stop offset="1" stop-color="'+wg+'"/></radialGradient>'+
 '<radialGradient id="'+g("gc")+'"><stop offset="0" stop-color="#ff8fa8" stop-opacity=".75"/><stop offset="1" stop-color="#ff8fa8" stop-opacity="0"/></radialGradient>'+
 '<radialGradient id="'+g("ge")+'" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#5a4a52"/><stop offset="1" stop-color="#1f1a22"/></radialGradient>'+
 '<filter id="'+g("fur")+'" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="2.8" xChannelSelector="R" yChannelSelector="G" result="d"/>'+
 '<feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="2" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 -0.75 0.5" result="nm"/><feComposite in="nm" in2="d" operator="in" result="tx"/><feBlend in="tx" in2="d" mode="multiply"/></filter>'+
 '</defs>'+
 '<g id="'+g("all")+'">'+
 '<ellipse cx="122" cy="230" rx="66" ry="8" fill="#5b4636" opacity=".14"/>'+
 '<g id="'+g("wingL")+'" '+fur+'><path d="M84 132 C62 98 30 92 16 104 C32 108 34 120 28 128 C42 124 50 134 44 144 C58 138 70 146 74 156 Z" fill="url(#'+g("gw")+')" stroke="'+WD+'" stroke-width="2.5" stroke-linejoin="round"/><path d="M78 140 L34 112 M76 148 L46 136" stroke="'+WD+'" stroke-width="2" stroke-dasharray="3 4" fill="none" stroke-linecap="round"/></g>'+
 '<g id="'+g("wingR")+'" '+fur+'><path d="M160 132 C182 98 214 92 228 104 C212 108 210 120 216 128 C202 124 194 134 200 144 C186 138 174 146 170 156 Z" fill="url(#'+g("gw")+')" stroke="'+WD+'" stroke-width="2.5" stroke-linejoin="round"/><path d="M166 140 L210 112 M168 148 L198 136" stroke="'+WD+'" stroke-width="2" stroke-dasharray="3 4" fill="none" stroke-linecap="round"/></g>'+
 '<g id="'+g("tail")+'" '+fur+'><path d="M74 176 C48 182 26 176 12 154 C18 176 34 200 76 202 Z" fill="url(#'+g("gb")+')" stroke="'+S+'" stroke-width="2.5" stroke-linejoin="round"/><path d="M22 168 L14 152 L30 160 Z" fill="'+sp+'" stroke="'+SD+'" stroke-width="2" stroke-linejoin="round"/></g>'+
 '<g id="'+g("legL")+'" '+fur+'><ellipse cx="96" cy="214" rx="24" ry="17" fill="url(#'+g("gb")+')" stroke="'+S+'" stroke-width="2.5"/><ellipse cx="96" cy="220" rx="13" ry="7" fill="'+bl+'" opacity=".9"/></g>'+
 '<g id="'+g("legR")+'" '+fur+'><ellipse cx="148" cy="214" rx="24" ry="17" fill="url(#'+g("gb")+')" stroke="'+S+'" stroke-width="2.5"/><ellipse cx="148" cy="220" rx="13" ry="7" fill="'+bl+'" opacity=".9"/></g>'+
 '<g id="'+g("body")+'">'+
 '<g '+fur+'><path d="M58 168 C56 126 86 110 122 110 C158 110 188 126 186 168 C184 206 156 222 122 222 C88 222 60 206 58 168 Z" fill="url(#'+g("gb")+')" stroke="'+S+'" stroke-width="2.5"/>'+
 '<ellipse cx="122" cy="172" rx="40" ry="38" fill="url(#'+g("gl")+')"/></g>'+
 '<ellipse cx="122" cy="172" rx="36" ry="34" fill="none" stroke="'+BD+'" stroke-width="2" stroke-dasharray="4 5" stroke-linecap="round"/>'+
 '<path d="M106 160 Q122 164 138 160 M104 176 Q122 181 140 176 M108 192 Q122 196 136 192" stroke="'+BD+'" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>'+
 '</g>'+
 '<g id="'+g("armL")+'" '+fur+'><path d="M78 148 C64 154 58 168 62 182 C66 190 78 188 80 178 C82 168 86 160 90 156 Z" fill="url(#'+g("gb")+')" stroke="'+S+'" stroke-width="2.5" stroke-linejoin="round"/></g>'+
 '<g id="'+g("armR")+'" '+fur+'><path d="M166 148 C180 154 186 168 182 182 C178 190 166 188 164 178 C162 168 158 160 154 156 Z" fill="url(#'+g("gb")+')" stroke="'+S+'" stroke-width="2.5" stroke-linejoin="round"/></g>'+
 '<g id="'+g("head")+'">'+
 '<g '+fur+'><path d="M96 34 C92 20 98 8 106 4 C108 16 112 26 116 32 Z" fill="url(#'+g("gs")+')" stroke="'+SD+'" stroke-width="2.2" stroke-linejoin="round"/>'+
 '<path d="M148 32 C152 26 156 16 158 4 C166 8 172 20 168 34 Z" fill="url(#'+g("gs")+')" stroke="'+SD+'" stroke-width="2.2" stroke-linejoin="round"/>'+
 '<path d="M124 26 C122 16 126 8 132 4 C136 10 138 18 136 26 Z" fill="url(#'+g("gs")+')" stroke="'+SD+'" stroke-width="2.2" stroke-linejoin="round"/>'+
 '<ellipse cx="132" cy="80" rx="62" ry="54" fill="url(#'+g("gb")+')" stroke="'+S+'" stroke-width="2.5"/>'+
 '<ellipse cx="134" cy="102" rx="30" ry="20" fill="url(#'+g("gl")+')" opacity=".95"/></g>'+
 '<path d="M90 44 Q132 24 174 44" stroke="'+D+'" stroke-width="2" stroke-dasharray="4 5" fill="none" stroke-linecap="round"/>'+
 '<ellipse cx="96" cy="100" rx="15" ry="10" fill="url(#'+g("gc")+')"/><ellipse cx="170" cy="100" rx="15" ry="10" fill="url(#'+g("gc")+')"/>'+
 '<g id="'+g("eyeL")+'"><ellipse cx="110" cy="80" rx="11" ry="13" fill="url(#'+g("ge")+')"/><circle cx="106" cy="74" r="4.2" fill="#fff"/><circle cx="114" cy="86" r="1.8" fill="#fff" opacity=".8"/></g>'+
 '<g id="'+g("eyeR")+'"><ellipse cx="156" cy="80" rx="11" ry="13" fill="url(#'+g("ge")+')"/><circle cx="152" cy="74" r="4.2" fill="#fff"/><circle cx="160" cy="86" r="1.8" fill="#fff" opacity=".8"/></g>'+
 '<circle cx="128" cy="98" r="1.8" fill="'+S+'"/><circle cx="138" cy="98" r="1.8" fill="'+S+'"/>'+
 '<path id="'+g("mouth")+'" d="M124 106 Q128 112 133 107 Q138 112 142 106" stroke="#5b4636" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+
 '<path d="M130 109 Q133 115 136 109" fill="#ff8fa8" opacity=".9"/>'+
 '</g></g></svg>';}
var DP={armL:"84 152",armR:"160 152",head:"132 128",tail:"74 186",wingL:"80 140",wingR:"164 140",legL:"96 204",legR:"148 204",body:"122 222",eyeL:"110 80",eyeR:"156 80",all:"122 228"};
function dset(tl,id,part,v,t,d,e){v.svgOrigin=DP[part];v.duration=d==null?.5:d;v.ease=e||"sine.inOut";tl.to("#"+id+"-"+part,v,t);}
function didle(tl,id,t0,dur){
 var n=Math.max(1,Math.floor(dur/1.6));
 tl.to("#"+id+"-body",{scaleY:1.025,scaleX:.99,svgOrigin:DP.body,duration:.8,repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t0);
 tl.to("#"+id+"-head",{y:-2,rotation:2,svgOrigin:DP.head,duration:1.6,repeat:Math.max(1,Math.floor(dur/1.6))-1,yoyo:true,ease:"sine.inOut"},t0);
 tl.to("#"+id+"-wingL",{rotation:-12,svgOrigin:DP.wingL,duration:.45,repeat:Math.max(1,Math.floor(dur/.45))-1,yoyo:true,ease:"sine.inOut"},t0);
 tl.to("#"+id+"-wingR",{rotation:12,svgOrigin:DP.wingR,duration:.45,repeat:Math.max(1,Math.floor(dur/.45))-1,yoyo:true,ease:"sine.inOut"},t0);
 tl.to("#"+id+"-tail",{rotation:8,svgOrigin:DP.tail,duration:.9,repeat:Math.max(1,Math.floor(dur/.9))-1,yoyo:true,ease:"sine.inOut"},t0);
 for(var t=t0+1.3;t<t0+dur-.3;t+=2.9){["eyeL","eyeR"].forEach(function(e){tl.to("#"+id+"-"+e,{scaleY:.1,svgOrigin:DP[e],duration:.07,yoyo:true,repeat:1,ease:"power1.inOut"},t);});}
}
function dtail(tl,id,t,dur){didle(tl,id,t,(typeof SDUR!=="undefined"?SDUR:t+dur)-t);}
function dwave(tl,id,t,n){dset(tl,id,"armR",{rotation:-118},t,.45,"back.out(1.6)");
 tl.to("#"+id+"-armR",{rotation:-145,svgOrigin:DP.armR,duration:.28,repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t+.45);
 dset(tl,id,"armR",{rotation:0},t+.45+n*.56,.55,"sine.inOut");
 dset(tl,id,"head",{rotation:6},t,.5);dset(tl,id,"head",{rotation:0},t+.45+n*.56,.6);}
function dcheer(tl,id,t){dset(tl,id,"armR",{rotation:-128},t,.45,"back.out(1.8)");dset(tl,id,"armL",{rotation:128},t,.45,"back.out(1.8)");
 tl.to("#"+id+"-mouth",{scaleY:1.6,svgOrigin:"133 106",duration:.3,ease:"back.out(2)"},t);
 dset(tl,id,"armR",{rotation:-20},t+1.6,.6);dset(tl,id,"armL",{rotation:20},t+1.6,.6);
 dset(tl,id,"armR",{rotation:0},t+2.3,.5);dset(tl,id,"armL",{rotation:0},t+2.3,.5);tl.to("#"+id+"-mouth",{scaleY:1,svgOrigin:"133 106",duration:.4},t+2.3);}
function dpoint(tl,id,t,hold){dset(tl,id,"armR",{rotation:-92},t,.5,"back.out(1.5)");dset(tl,id,"head",{rotation:8},t,.5);
 dset(tl,id,"armR",{rotation:0},t+.5+(hold||1),.55);dset(tl,id,"head",{rotation:0},t+.5+(hold||1),.6);}
function dtype(tl,id,t,dur){var n=Math.max(2,Math.round(dur/.18));
 dset(tl,id,"armR",{rotation:28},t,.35);dset(tl,id,"armL",{rotation:-28},t,.35);
 tl.to("#"+id+"-armR",{rotation:18,svgOrigin:DP.armR,duration:.18,repeat:n,yoyo:true,ease:"sine.inOut"},t+.35);
 tl.to("#"+id+"-armL",{rotation:-18,svgOrigin:DP.armL,duration:.18,repeat:n,yoyo:true,ease:"sine.inOut"},t+.44);
 dset(tl,id,"armR",{rotation:0},t+.4+dur,.4);dset(tl,id,"armL",{rotation:0},t+.4+dur,.4);}
function dwalk(tl,id,t,dur,n){tl.to("#"+id+"-legL",{rotation:14,y:-4,svgOrigin:DP.legL,duration:dur/(n*2),repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t);
 tl.to("#"+id+"-legR",{rotation:-14,y:-4,svgOrigin:DP.legR,duration:dur/(n*2),repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t+dur/(n*4));
 tl.to("#"+id+"-all",{rotation:3,svgOrigin:DP.all,duration:dur/(n*2),repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t);}
function dlook(tl,id,t,x){tl.to("#"+id+"-eyeL,#"+id+"-eyeR",{x:x,duration:.3,ease:"sine.out"},t);}
function bounce(tl,id,t,n,h){var el="#"+id;for(var i=0;i<n;i++){var s=t+i*.56;
 tl.to(el,{y:-(h||14),scaleY:1.04,scaleX:.97,duration:.26,ease:"sine.out",transformOrigin:"50% 100%"},s);
 tl.to(el,{y:0,scaleY:.95,scaleX:1.04,duration:.2,ease:"sine.in",transformOrigin:"50% 100%"},s+.26);
 tl.to(el,{scaleY:1,scaleX:1,duration:.1,ease:"sine.out",transformOrigin:"50% 100%"},s+.46);}}
