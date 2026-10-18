function T(s,nth){var C="",M=[],i,k;for(i=0;i<W.length;i++){for(k=0;k<W[i].t.length;k++){C+=W[i].t[k];M.push(i);}}
 s=String(s).replace(/\s+/g,"");var P="",MM=[];for(i=0;i<C.length;i++){if(!/\s/.test(C[i])){P+=C[i];MM.push(M[i]);}}
 var p=-1,n=nth||0,from=0;while(n>=0){p=P.indexOf(s,from);if(p<0)return 0;from=p+1;n--;}
 return Math.round((W[MM[p]].s+LEAD)*100)/100;}
function figure(id,o){o=o||{};var body=o.body||"#ff8fab",hat=o.hat||"#ffd166";
 return '<svg id="'+id+'" class="fig" viewBox="0 0 160 220" width="'+(o.w||240)+'" height="'+(o.h||330)+'" style="overflow:visible">'+
 '<g id="'+id+'-legL"><path class="ln" d="M70 152 L64 196"/><ellipse cx="58" cy="204" rx="15" ry="8" fill="#2d2a32"/></g>'+
 '<g id="'+id+'-legR"><path class="ln" d="M92 152 L98 196"/><ellipse cx="104" cy="204" rx="15" ry="8" fill="#2d2a32"/></g>'+
 '<path class="ol" d="M54 92 Q80 82 106 92 L112 154 Q80 166 48 154 Z" fill="'+body+'"/>'+
 '<g id="'+id+'-armL"><path class="ln" d="M58 104 Q40 124 38 146"/><circle class="ol" cx="37" cy="151" r="10" fill="#ffe3d0"/></g>'+
 '<g id="'+id+'-armR"><path class="ln" d="M102 104 Q120 124 122 146"/><circle class="ol" cx="123" cy="151" r="10" fill="#ffe3d0"/></g>'+
 '<g id="'+id+'-head"><circle class="ol" cx="80" cy="52" r="38" fill="#ffe9d6"/>'+
 '<path class="ol" d="M44 44 Q80 -8 116 44 Q80 26 44 44 Z" fill="'+hat+'"/><circle class="ol" cx="80" cy="6" r="9" fill="'+hat+'"/>'+
 '<circle cx="66" cy="58" r="5" fill="#2d2a32"/><circle cx="94" cy="58" r="5" fill="#2d2a32"/>'+
 '<ellipse cx="55" cy="72" rx="9" ry="6" fill="#ff8fab" opacity=".7"/><ellipse cx="105" cy="72" rx="9" ry="6" fill="#ff8fab" opacity=".7"/>'+
 '<path class="ln" style="stroke-width:5" d="M70 74 Q80 84 90 74"/></g></svg>';}
function put(id,html){document.getElementById(id).innerHTML=html;}
function wave(tl,id,t,n){var a=id+"-armR";tl.to("#"+a,{rotation:-150,svgOrigin:"102 104",duration:.35,ease:"power2.out"},t);
 tl.to("#"+a,{rotation:-120,svgOrigin:"102 104",duration:.22,repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t+.35);
 tl.to("#"+a,{rotation:0,svgOrigin:"102 104",duration:.4,ease:"power2.inOut"},t+.35+n*.44);}
function bounce(tl,id,t,n,h){tl.to("#"+id,{y:-(h||14),duration:.28,repeat:n*2-1,yoyo:true,ease:"power1.inOut"},t);}
function walk(tl,id,t,dur,n){tl.to("#"+id+"-legL",{rotation:18,svgOrigin:"70 152",duration:dur/(n*2),repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t);
 tl.to("#"+id+"-legR",{rotation:-18,svgOrigin:"92 152",duration:dur/(n*2),repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t);}
function typing(tl,id,t,dur){var n=Math.max(2,Math.round(dur/.16));
 tl.to("#"+id+"-armL",{rotation:-38,svgOrigin:"58 104",duration:.3,ease:"power2.out"},t);
 tl.to("#"+id+"-armR",{rotation:38,svgOrigin:"102 104",duration:.3,ease:"power2.out"},t);
 tl.to("#"+id+"-armL",{rotation:-26,svgOrigin:"58 104",duration:.16,repeat:n,yoyo:true,ease:"none"},t+.3);
 tl.to("#"+id+"-armR",{rotation:26,svgOrigin:"102 104",duration:.16,repeat:n,yoyo:true,ease:"none"},t+.38);}
function point(tl,id,t,hold){var a=id+"-armR";tl.to("#"+a,{rotation:-100,svgOrigin:"102 104",duration:.35,ease:"back.out(1.6)"},t);
 tl.to("#"+a,{rotation:0,svgOrigin:"102 104",duration:.4,ease:"power2.inOut"},t+.35+(hold||1));}
function pop(tl,sel,t,o){o=o||{};tl.fromTo(sel,{opacity:0,scale:o.s||.6,y:o.y||0,x:o.x||0},{opacity:1,scale:1,y:0,x:0,duration:o.d||.45,ease:"back.out(1.7)",transformOrigin:o.origin||"50% 50%"},t);}
function draw(tl,sel,t,d){tl.fromTo(sel,{strokeDashoffset:1},{strokeDashoffset:0,duration:d||.6,ease:"power2.out"},t);}
function captions(tl,boxId){var box=document.getElementById(boxId);CAPS.forEach(function(c,i){var e=document.createElement("div");e.className="c";e.textContent=c.t;box.appendChild(e);
 var s=c.s+LEAD,en=c.e+LEAD+0.05;tl.fromTo(e,{opacity:0,y:14},{opacity:1,y:0,duration:.2,ease:"power2.out"},s);
 tl.to(e,{opacity:0,duration:.15},Math.max(s+.25,en-.12));});}
function icon(n,c,s){c=c||"#ffd166";s=s||100;var b='<svg viewBox="0 0 100 100" width="'+s+'" height="'+s+'" style="overflow:visible">',e='</svg>';
 var m={
 box:'<path class="ol" d="M12 34 L50 16 L88 34 L88 72 L50 90 L12 72 Z" fill="'+c+'"/><path class="ln" d="M12 34 L50 52 L88 34 M50 52 V90"/>',
 zip:'<rect class="ol" x="20" y="10" width="60" height="80" rx="10" fill="'+c+'"/><path class="ln" stroke-dasharray="5 9" d="M50 12 V58"/><rect class="ol" x="38" y="58" width="24" height="20" rx="5" fill="#fff"/>',
 doc:'<path class="ol" d="M22 8 H62 L80 26 V92 H22 Z" fill="'+c+'"/><path class="ln" d="M62 8 V26 H80 M34 46 H68 M34 60 H68 M34 74 H56"/>',
 gear:'<g class="ln">'+[0,45,90,135,180,225,270,315].map(function(a){return '<path d="M50 8 V22" transform="rotate('+a+' 50 50)"/>';}).join("")+'</g><circle class="ol" cx="50" cy="50" r="30" fill="'+c+'"/><circle class="ol" cx="50" cy="50" r="11" fill="#fff"/>',
 cursor:'<path class="ol" d="M28 12 L28 80 L45 64 L58 90 L70 84 L57 60 L80 58 Z" fill="'+c+'"/>',
 shield:'<path class="ol" d="M50 8 L86 22 V50 C86 72 70 86 50 94 C30 86 14 72 14 50 V22 Z" fill="'+c+'"/><path class="ln" d="M32 52 L45 65 L70 38"/>',
 camera:'<rect class="ol" x="10" y="28" width="80" height="56" rx="12" fill="'+c+'"/><path class="ol" d="M32 28 L38 16 H62 L68 28" fill="'+c+'"/><circle class="ol" cx="50" cy="56" r="17" fill="#fff"/><circle cx="50" cy="56" r="7" fill="#2d2a32"/>',
 lock:'<path class="ln" d="M30 44 V32 C30 14 70 14 70 32 V44"/><rect class="ol" x="20" y="42" width="60" height="46" rx="10" fill="'+c+'"/><circle cx="50" cy="62" r="6" fill="#2d2a32"/><path class="ln" d="M50 66 V76"/>',
 check:'<circle class="ol" cx="50" cy="50" r="40" fill="'+c+'"/><path class="ln" style="stroke-width:9" d="M28 52 L44 68 L74 34"/>',
 cross:'<circle class="ol" cx="50" cy="50" r="40" fill="'+c+'"/><path class="ln" style="stroke-width:9" d="M33 33 L67 67 M67 33 L33 67"/>',
 ask:'<circle class="ol" cx="50" cy="50" r="40" fill="'+c+'"/><path class="ln" style="stroke-width:8" d="M36 38 C36 22 66 22 64 40 C62 52 50 52 50 64"/><circle cx="50" cy="78" r="5" fill="#2d2a32"/>',
 search:'<circle class="ol" cx="42" cy="42" r="26" fill="'+c+'"/><path class="ln" style="stroke-width:10" d="M62 62 L88 88"/>',
 folder:'<path class="ol" d="M8 24 H38 L46 34 H92 V82 H8 Z" fill="'+c+'"/>',
 puzzle:'<path class="ol" d="M14 30 H40 C34 14 62 14 56 30 H82 V50 C98 44 98 72 82 66 V88 H14 Z" fill="'+c+'"/>',
 star:'<path class="ol" d="M50 8 L61 38 L92 40 L68 60 L76 91 L50 74 L24 91 L32 60 L8 40 L39 38 Z" fill="'+c+'"/>',
 table:'<rect class="ol" x="10" y="18" width="80" height="64" rx="8" fill="#fff"/><path class="ln" style="stroke-width:5" d="M10 38 H90 M10 58 H90 M38 18 V82 M64 18 V82"/><rect x="12" y="20" width="76" height="16" rx="5" fill="'+c+'" opacity=".9"/>'
 };return b+m[n]+e;}
function sparkle(x,y,s,c){return '<svg class="abs" style="left:'+x+'px;top:'+y+'px" viewBox="0 0 40 40" width="'+s+'" height="'+s+'"><path class="ol" style="stroke-width:3" d="M20 2 L24 16 L38 20 L24 24 L20 38 L16 24 L2 20 L16 16 Z" fill="'+(c||"#ffd166")+'"/></svg>';}
function cur(tl,sel,x,y,t,d){tl.to(sel,{x:x,y:y,duration:d||.7,ease:"power2.inOut"},t);}
function click(tl,sel,t){tl.to(sel,{scale:.86,duration:.1,yoyo:true,repeat:1,transformOrigin:"50% 50%",ease:"power1.inOut"},t);}
function typeText(tl,id,text,t,dur){var el=document.getElementById(id);el.innerHTML=text.split("").map(function(c){return '<span style="opacity:0">'+(c===" "?"&nbsp;":c)+'</span>';}).join("");
 tl.to(el.children,{opacity:1,duration:.01,stagger:dur/Math.max(1,text.length)},t);}
function toggle(tl,id,t){tl.to("#"+id,{backgroundColor:"#06d6a0",duration:.2},t);tl.to("#"+id+" i",{x:34,duration:.25,ease:"back.out(2)"},t);}
function arrow(x,y,w,h,id){return '<svg class="abs" style="left:'+x+'px;top:'+y+'px" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" style="overflow:visible"><path id="'+id+'" class="ln" pathLength="1" stroke-dasharray="1" d="M6 '+(h/2)+' C'+(w*.3)+' '+(h*.1)+' '+(w*.6)+' '+(h*.9)+' '+(w-26)+' '+(h/2)+'"/><path id="'+id+'h" class="ln" d="M'+(w-40)+' '+(h/2-16)+' L'+(w-8)+' '+(h/2)+' L'+(w-40)+' '+(h/2+16)+'" opacity="0"/></svg>';}

function dino(id,o){o=o||{};var b=o.body||"#7bdcb5",bl=o.belly||"#f4ffd6",sp=o.spike||"#ffd166",w=o.w||240,h=o.h||230;
 return '<svg id="'+id+'" class="fig" viewBox="0 0 240 230" width="'+w+'" height="'+h+'" style="overflow:visible">'+
 '<g id="'+id+'-tail"><path class="ol" d="M66 152 C36 160 12 150 2 124 C22 134 42 130 60 116 Z" fill="'+b+'"/><path class="ol" style="stroke-width:4" d="M30 142 L24 126 L42 136 Z" fill="'+sp+'"/></g>'+
 '<g id="'+id+'-legL"><rect class="ol" x="84" y="176" width="32" height="40" rx="15" fill="'+b+'"/><path class="ln" style="stroke-width:4" d="M94 210 V214 M104 210 V214"/></g>'+
 '<g id="'+id+'-legR"><rect class="ol" x="124" y="176" width="32" height="40" rx="15" fill="'+b+'"/><path class="ln" style="stroke-width:4" d="M134 210 V214 M144 210 V214"/></g>'+
 '<path class="ol" d="M56 138 C56 98 112 86 152 102 C182 114 188 152 176 178 C164 198 122 204 92 196 C68 190 56 168 56 138 Z" fill="'+b+'"/>'+
 '<path d="M112 124 C142 122 170 138 168 166 C164 188 130 192 114 182 C98 170 98 132 112 124 Z" fill="'+bl+'"/>'+
 '<path class="ol" style="stroke-width:4" d="M68 120 L76 98 L92 114 Z M92 108 L104 86 L116 106 Z M118 102 L132 82 L142 104 Z" fill="'+sp+'"/>'+
 '<g id="'+id+'-armL"><path class="ln" d="M112 140 Q130 148 134 164"/><circle class="ol" cx="135" cy="168" r="8" fill="'+b+'"/></g>'+
 '<g id="'+id+'-armR"><path class="ln" d="M152 140 Q174 146 178 164"/><circle class="ol" cx="179" cy="168" r="8" fill="'+b+'"/></g>'+
 '<g id="'+id+'-head"><circle class="ol" cx="142" cy="62" r="46" fill="'+b+'"/>'+
 '<path class="ol" style="stroke-width:4" d="M116 24 L124 4 L136 22 Z M138 20 L148 0 L160 20 Z M160 24 L172 8 L176 30 Z" fill="'+sp+'"/>'+
 '<circle cx="124" cy="60" r="11" fill="#fff" stroke="#2d2a32" stroke-width="3"/><circle cx="162" cy="60" r="11" fill="#fff" stroke="#2d2a32" stroke-width="3"/>'+
 '<circle class="pu" cx="127" cy="62" r="6" fill="#2d2a32"/><circle class="pu" cx="165" cy="62" r="6" fill="#2d2a32"/><circle cx="129" cy="59" r="2" fill="#fff"/><circle cx="167" cy="59" r="2" fill="#fff"/>'+
 '<ellipse cx="108" cy="80" rx="10" ry="6" fill="#ff8fab" opacity=".75"/><ellipse cx="178" cy="80" rx="10" ry="6" fill="#ff8fab" opacity=".75"/>'+
 '<path class="ln" style="stroke-width:5" d="M130 82 Q143 96 156 82"/><circle cx="138" cy="74" r="2" fill="#2d2a32"/><circle cx="148" cy="74" r="2" fill="#2d2a32"/></g></svg>';}
function dwave(tl,id,t,n){var a="#"+id+"-armR";tl.to(a,{rotation:-70,svgOrigin:"152 140",duration:.35,ease:"power2.out"},t);
 tl.to(a,{rotation:-102,svgOrigin:"152 140",duration:.22,repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t+.35);
 tl.to(a,{rotation:0,svgOrigin:"152 140",duration:.4,ease:"power2.inOut"},t+.35+n*.44);}
function dcheer(tl,id,t){tl.to("#"+id+"-armR",{rotation:-95,svgOrigin:"152 140",duration:.3,ease:"back.out(2)"},t);tl.to("#"+id+"-armL",{rotation:170,svgOrigin:"112 140",duration:.3,ease:"back.out(2)"},t);}
function dpoint(tl,id,t,hold){var a="#"+id+"-armR";tl.to(a,{rotation:-75,svgOrigin:"152 140",duration:.35,ease:"back.out(1.6)"},t);tl.to(a,{rotation:0,svgOrigin:"152 140",duration:.4,ease:"power2.inOut"},t+.35+(hold||1));}
function dtail(tl,id,t,dur){tl.to("#"+id+"-tail",{rotation:10,svgOrigin:"62 140",duration:.35,repeat:Math.max(1,Math.round(dur/.35)-1),yoyo:true,ease:"sine.inOut"},t);}
function dtype(tl,id,t,dur){var n=Math.max(2,Math.round(dur/.16));
 tl.to("#"+id+"-armR",{rotation:-40,svgOrigin:"152 140",duration:.3,ease:"power2.out"},t);tl.to("#"+id+"-armL",{rotation:-30,svgOrigin:"112 140",duration:.3,ease:"power2.out"},t);
 tl.to("#"+id+"-armR",{rotation:-22,svgOrigin:"152 140",duration:.16,repeat:n,yoyo:true,ease:"none"},t+.3);tl.to("#"+id+"-armL",{rotation:-12,svgOrigin:"112 140",duration:.16,repeat:n,yoyo:true,ease:"none"},t+.38);}
function dwalk(tl,id,t,dur,n){tl.to("#"+id+"-legL",{rotation:16,svgOrigin:"100 178",duration:dur/(n*2),repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t);tl.to("#"+id+"-legR",{rotation:-16,svgOrigin:"140 178",duration:dur/(n*2),repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t);}
function dlook(tl,id,t,x){tl.to("#"+id+" .pu",{x:x,duration:.25,ease:"power2.out"},t);}
