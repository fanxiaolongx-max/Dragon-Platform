function T(s,nth){var C="",M=[],i,k;for(i=0;i<W.length;i++){for(k=0;k<W[i].t.length;k++){C+=W[i].t[k];M.push(i);}}
 s=String(s).replace(/\s+/g,"");var P="",MM=[];for(i=0;i<C.length;i++){if(!/\s/.test(C[i])){P+=C[i];MM.push(M[i]);}}
 var p=-1,n=nth||0,from=0;while(n>=0){p=P.indexOf(s,from);if(p<0)return 0;from=p+1;n--;}
 return Math.round((W[MM[p]].s+LEAD)*100)/100;}
function figure(id,o){o=o||{};var body=o.body||"#ffb3c6",hat=o.hat||"#ffe08f";
 return '<svg id="'+id+'" class="fig" viewBox="0 0 160 220" width="'+(o.w||240)+'" height="'+(o.h||330)+'" style="overflow:visible">'+
 '<g id="'+id+'-legL"><path class="ln" d="M70 152 L64 196"/><ellipse cx="58" cy="204" rx="15" ry="8" fill="#5b4636"/></g>'+
 '<g id="'+id+'-legR"><path class="ln" d="M92 152 L98 196"/><ellipse cx="104" cy="204" rx="15" ry="8" fill="#5b4636"/></g>'+
 '<path class="ol" d="M54 92 Q80 82 106 92 L112 154 Q80 166 48 154 Z" fill="'+body+'"/>'+
 '<g id="'+id+'-armL"><path class="ln" d="M58 104 Q40 124 38 146"/><circle class="ol" cx="37" cy="151" r="10" fill="#ffe3d0"/></g>'+
 '<g id="'+id+'-armR"><path class="ln" d="M102 104 Q120 124 122 146"/><circle class="ol" cx="123" cy="151" r="10" fill="#ffe3d0"/></g>'+
 '<g id="'+id+'-head"><circle class="ol" cx="80" cy="52" r="38" fill="#ffe9d6"/>'+
 '<path class="ol" d="M44 44 Q80 -8 116 44 Q80 26 44 44 Z" fill="'+hat+'"/><circle class="ol" cx="80" cy="6" r="9" fill="'+hat+'"/>'+
 '<circle cx="66" cy="58" r="5" fill="#5b4636"/><circle cx="94" cy="58" r="5" fill="#5b4636"/>'+
 '<ellipse cx="55" cy="72" rx="9" ry="6" fill="#ffb3c6" opacity=".7"/><ellipse cx="105" cy="72" rx="9" ry="6" fill="#ffb3c6" opacity=".7"/>'+
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
function pop(tl,sel,t,o){o=o||{};var s=Math.max(o.s||.82,.78);tl.fromTo(sel,{opacity:0,scale:s,y:(o.y||0)+18,x:o.x||0,rotation:-2},{opacity:1,scale:1,y:0,x:0,rotation:0,duration:o.d||.6,ease:"back.out(1.35)",transformOrigin:o.origin||"50% 60%"},t);}
function draw(tl,sel,t,d){tl.fromTo(sel,{strokeDashoffset:1},{strokeDashoffset:0,duration:d||.6,ease:"power2.out"},t);}
function captions(tl,boxId){var box=document.getElementById(boxId);CAPS.forEach(function(c,i){var e=document.createElement("div");e.className="c";e.textContent=c.t;box.appendChild(e);
 var s=c.s+LEAD,en=c.e+LEAD+0.05;tl.fromTo(e,{opacity:0,y:10,scale:.97},{opacity:1,y:0,scale:1,duration:.28,ease:"sine.out"},s-.05);
 tl.to(e,{opacity:0,y:-6,duration:.2,ease:"sine.in"},Math.max(s+.3,en-.14));});
 if(typeof WHY!=="undefined"&&WHY&&WHY.t){var card=document.createElement("div");card.className="whycard";card.setAttribute("data-layout-allow-overlap","");
  card.innerHTML='<div class="wq"><svg viewBox="0 0 40 40" width="46" height="46"><path d="M20 4c-7 0-12 5-12 11 0 4 2 7 5 9v5h14v-5c3-2 5-5 5-9 0-6-5-11-12-11z" fill="#ffe08f" stroke="#5b4636" stroke-width="2.5" stroke-linejoin="round"/><path d="M14 33h12M16 37h8" stroke="#5b4636" stroke-width="2.5" stroke-linecap="round"/></svg><span>一句话记住</span></div><div class="wt"></div>';
  card.querySelector(".wt").textContent=WHY.t;box.parentNode.appendChild(card);
  var a=WHY.s+LEAD,b=WHY.e+LEAD;
  tl.fromTo(card,{opacity:0,y:34,scale:.92,rotation:-1.5},{opacity:1,y:0,scale:1,rotation:0,duration:.6,ease:"back.out(1.3)"},a-.15);
  if(WHY.end){card.classList.add("is-end");var dim=document.createElement("div");dim.className="whydim";box.parentNode.insertBefore(dim,card);tl.fromTo(dim,{opacity:0},{opacity:1,duration:.5,ease:"sine.out"},a-.2);}
  else tl.to(card,{opacity:0,y:-24,scale:.96,duration:.38,ease:"sine.in"},b+.05);
  if(document.getElementById("dn-armR")){dpoint(tl,"dn",a+.2,Math.max(.6,b-a-1.2));}}}
function icon(n,c,s){c=c||"#ffe08f";s=s||100;var b='<svg viewBox="0 0 100 100" width="'+s+'" height="'+s+'" style="overflow:visible">',e='</svg>';
 var m={
 box:'<path class="ol" d="M12 34 L50 16 L88 34 L88 72 L50 90 L12 72 Z" fill="'+c+'"/><path class="ln" d="M12 34 L50 52 L88 34 M50 52 V90"/>',
 zip:'<rect class="ol" x="20" y="10" width="60" height="80" rx="10" fill="'+c+'"/><path class="ln" stroke-dasharray="5 9" d="M50 12 V58"/><rect class="ol" x="38" y="58" width="24" height="20" rx="5" fill="#fff"/>',
 doc:'<path class="ol" d="M22 8 H62 L80 26 V92 H22 Z" fill="'+c+'"/><path class="ln" d="M62 8 V26 H80 M34 46 H68 M34 60 H68 M34 74 H56"/>',
 gear:'<g class="ln">'+[0,45,90,135,180,225,270,315].map(function(a){return '<path d="M50 8 V22" transform="rotate('+a+' 50 50)"/>';}).join("")+'</g><circle class="ol" cx="50" cy="50" r="30" fill="'+c+'"/><circle class="ol" cx="50" cy="50" r="11" fill="#fff"/>',
 cursor:'<path class="ol" d="M28 12 L28 80 L45 64 L58 90 L70 84 L57 60 L80 58 Z" fill="'+c+'"/>',
 shield:'<path class="ol" d="M50 8 L86 22 V50 C86 72 70 86 50 94 C30 86 14 72 14 50 V22 Z" fill="'+c+'"/><path class="ln" d="M32 52 L45 65 L70 38"/>',
 camera:'<rect class="ol" x="10" y="28" width="80" height="56" rx="12" fill="'+c+'"/><path class="ol" d="M32 28 L38 16 H62 L68 28" fill="'+c+'"/><circle class="ol" cx="50" cy="56" r="17" fill="#fff"/><circle cx="50" cy="56" r="7" fill="#5b4636"/>',
 lock:'<path class="ln" d="M30 44 V32 C30 14 70 14 70 32 V44"/><rect class="ol" x="20" y="42" width="60" height="46" rx="10" fill="'+c+'"/><circle cx="50" cy="62" r="6" fill="#5b4636"/><path class="ln" d="M50 66 V76"/>',
 check:'<circle class="ol" cx="50" cy="50" r="40" fill="'+c+'"/><path class="ln" style="stroke-width:9" d="M28 52 L44 68 L74 34"/>',
 cross:'<circle class="ol" cx="50" cy="50" r="40" fill="'+c+'"/><path class="ln" style="stroke-width:9" d="M33 33 L67 67 M67 33 L33 67"/>',
 ask:'<circle class="ol" cx="50" cy="50" r="40" fill="'+c+'"/><path class="ln" style="stroke-width:8" d="M36 38 C36 22 66 22 64 40 C62 52 50 52 50 64"/><circle cx="50" cy="78" r="5" fill="#5b4636"/>',
 search:'<circle class="ol" cx="42" cy="42" r="26" fill="'+c+'"/><path class="ln" style="stroke-width:10" d="M62 62 L88 88"/>',
 folder:'<path class="ol" d="M8 24 H38 L46 34 H92 V82 H8 Z" fill="'+c+'"/>',
 puzzle:'<path class="ol" d="M14 30 H40 C34 14 62 14 56 30 H82 V50 C98 44 98 72 82 66 V88 H14 Z" fill="'+c+'"/>',
 star:'<path class="ol" d="M50 8 L61 38 L92 40 L68 60 L76 91 L50 74 L24 91 L32 60 L8 40 L39 38 Z" fill="'+c+'"/>',
 bell:'<path class="ol" d="M50 12 C30 12 24 30 24 48 L24 64 L14 76 H86 L76 64 V48 C76 30 70 12 50 12 Z" fill="'+c+'"/><path class="ln" d="M40 84 Q50 94 60 84"/>',
 chart:'<rect class="ol" x="14" y="50" width="16" height="38" rx="4" fill="'+c+'"/><rect class="ol" x="42" y="28" width="16" height="60" rx="4" fill="#fff"/><rect class="ol" x="70" y="12" width="16" height="76" rx="4" fill="'+c+'"/>',
 cal:'<rect class="ol" x="12" y="20" width="76" height="68" rx="10" fill="#fff"/><path class="ol" d="M12 20 H88 V40 H12 Z" fill="'+c+'"/><path class="ln" d="M32 10 V28 M68 10 V28"/><circle cx="34" cy="60" r="5" fill="#5b4636"/><circle cx="54" cy="60" r="5" fill="#5b4636"/><circle cx="72" cy="60" r="5" fill="#5b4636"/>',
 chat:'<path class="ol" d="M10 18 H90 V68 H50 L28 90 V68 H10 Z" fill="'+c+'"/><path class="ln" style="stroke-width:5" d="M26 36 H74 M26 52 H58"/>',
 mail:'<rect class="ol" x="8" y="22" width="84" height="58" rx="10" fill="'+c+'"/><path class="ln" d="M10 28 L50 58 L90 28"/>',
 group:'<circle class="ol" cx="34" cy="34" r="16" fill="'+c+'"/><circle class="ol" cx="68" cy="34" r="16" fill="#fff"/><path class="ol" d="M6 86 C6 64 62 64 62 86 Z" fill="'+c+'"/><path class="ol" d="M44 86 C46 66 94 66 94 86 Z" fill="#fff"/>',
 funnel:'<path class="ol" d="M8 14 H92 L58 54 V86 L42 76 V54 Z" fill="'+c+'"/>',
 chip:'<path class="ln" style="stroke-width:5" d="M36 8V24M50 8V24M64 8V24M36 76V92M50 76V92M64 76V92M8 36H24M8 50H24M8 64H24M76 36H92M76 50H92M76 64H92"/><rect class="ol" x="22" y="22" width="56" height="56" rx="10" fill="'+c+'"/><text x="50" y="59" text-anchor="middle" font-family="ZCOOL KuaiLe" font-size="24" fill="#5b4636">AI</text>',
 cloud:'<path class="ol" d="M26 76H76C90 76 96 63 91 53C87 44 78 41 71 43C67 28 52 22 40 28C30 33 26 43 28 51C15 52 10 63 15 70C18 74 22 76 26 76Z" fill="'+c+'"/>',
 coin:'<circle class="ol" cx="50" cy="50" r="38" fill="'+c+'"/><circle cx="50" cy="50" r="28" fill="none" stroke="#5b4636" stroke-width="3" stroke-dasharray="5 5"/><path class="ln" d="M38 38H62M50 38V66"/>',
 building:'<rect class="ol" x="20" y="14" width="60" height="78" rx="5" fill="'+c+'"/>'+[0,1,2,3].map(function(r){return [0,1,2].map(function(k){return '<rect x="'+(29+k*16)+'" y="'+(24+r*15)+'" width="10" height="9" rx="2" fill="#fff" stroke="#5b4636" stroke-width="2"/>';}).join("");}).join("")+'<rect class="ol" x="42" y="78" width="16" height="14" fill="#fff"/>',
 tree:'<path class="ol" d="M44 92 L46 58 L54 58 L56 92 Z" fill="#c8a27a"/><circle class="ol" cx="50" cy="40" r="26" fill="'+c+'"/><circle class="ol" cx="30" cy="54" r="15" fill="'+c+'"/><circle class="ol" cx="70" cy="54" r="15" fill="'+c+'"/>',
 phone:'<rect class="ol" x="28" y="8" width="44" height="84" rx="10" fill="'+c+'"/><rect x="34" y="18" width="32" height="58" rx="4" fill="#fff" stroke="#5b4636" stroke-width="2.5"/><circle cx="50" cy="84" r="3.5" fill="#5b4636"/>',
 mic:'<rect class="ol" x="36" y="10" width="28" height="48" rx="14" fill="'+c+'"/><path class="ln" d="M26 46C26 62 36 70 50 70C64 70 74 62 74 46M50 70V88M36 90H64"/>',
 glasses:'<circle class="ol" cx="30" cy="54" r="18" fill="'+c+'" fill-opacity=".55"/><circle class="ol" cx="70" cy="54" r="18" fill="'+c+'" fill-opacity=".55"/><path class="ln" d="M48 50Q50 46 52 50M12 50L4 42M88 50L96 42"/>',
 headset:'<path class="ln" d="M18 62V50C18 30 32 16 50 16C68 16 82 30 82 50V62"/><rect class="ol" x="12" y="56" width="18" height="30" rx="7" fill="'+c+'"/><rect class="ol" x="70" y="56" width="18" height="30" rx="7" fill="'+c+'"/>',
 car:'<path class="ol" d="M10 64V52L22 34H70L86 50L92 54V64Z" fill="'+c+'"/><path d="M28 40H48V50H22Z M54 40H68L78 50H54Z" fill="#fff" stroke="#5b4636" stroke-width="2.5" stroke-linejoin="round"/><circle class="ol" cx="28" cy="66" r="10" fill="#fff"/><circle class="ol" cx="74" cy="66" r="10" fill="#fff"/>',
 bear:'<circle class="ol" cx="26" cy="26" r="12" fill="'+c+'"/><circle class="ol" cx="74" cy="26" r="12" fill="'+c+'"/><circle class="ol" cx="50" cy="54" r="36" fill="'+c+'"/><ellipse cx="50" cy="66" rx="14" ry="10" fill="#fff4dd"/><circle cx="38" cy="50" r="4.5" fill="#5b4636"/><circle cx="62" cy="50" r="4.5" fill="#5b4636"/><circle cx="50" cy="62" r="4" fill="#5b4636"/>',
 cooker:'<path class="ol" d="M14 48H86V78C86 86 80 90 72 90H28C20 90 14 86 14 78Z" fill="'+c+'"/><path class="ol" d="M10 48C10 34 30 26 50 26C70 26 90 34 90 48Z" fill="#fff"/><rect class="ol" x="42" y="18" width="16" height="10" rx="4" fill="'+c+'"/><rect x="40" y="62" width="20" height="12" rx="3" fill="#fff" stroke="#5b4636" stroke-width="2.5"/>',
 pendant:'<path class="ln" d="M40 10V24M60 10V24M38 10H62"/><rect class="ol" x="24" y="22" width="52" height="66" rx="16" fill="'+c+'"/><circle cx="50" cy="48" r="10" fill="#fff" stroke="#5b4636" stroke-width="3"/><circle cx="50" cy="48" r="4" fill="#5b4636"/><path class="ln" style="stroke-width:3.5" d="M38 72H62"/>',
 brain:'<path class="ol" d="M50 20C42 12 26 16 24 28C14 30 10 42 16 50C10 58 14 72 26 74C30 86 46 88 50 80C54 88 70 86 74 74C86 72 90 58 84 50C90 42 86 30 76 28C74 16 58 12 50 20Z" fill="'+c+'"/><path class="ln" style="stroke-width:3.5" d="M50 22V80M34 38C40 40 42 46 40 52M66 38C60 40 58 46 60 52M32 62C38 60 44 62 46 68M68 62C62 60 56 62 54 68"/>',
 wave:'<path class="ln" style="stroke-width:7" d="M14 42V58M30 30V70M46 18V82M62 30V70M78 40V60"/>',
 eye:'<path class="ol" d="M6 50C20 26 80 26 94 50C80 74 20 74 6 50Z" fill="#fff"/><circle class="ol" cx="50" cy="50" r="16" fill="'+c+'"/><circle cx="50" cy="50" r="6" fill="#5b4636"/>',
 face:'<circle class="ol" cx="50" cy="50" r="38" fill="'+c+'"/><circle cx="38" cy="44" r="5" fill="#5b4636"/><circle cx="62" cy="44" r="5" fill="#5b4636"/><path class="ln" style="stroke-width:5" d="M36 62Q50 74 64 62"/>',
 plug:'<path class="ln" d="M38 10V30M62 10V30"/><path class="ol" d="M26 28H74V48C74 62 64 70 50 70C36 70 26 62 26 48Z" fill="'+c+'"/><path class="ln" d="M50 70V92"/><text x="50" y="56" text-anchor="middle" font-family="ZCOOL KuaiLe" font-size="20" fill="#5b4636">AI</text>',
 fridge:'<rect class="ol" x="24" y="8" width="52" height="86" rx="8" fill="'+c+'"/><path class="ln" style="stroke-width:4" d="M24 40H76M66 18V30M66 50V66"/>',
 pot:'<path class="ol" d="M16 44H84V74C84 84 76 90 66 90H34C24 90 16 84 16 74Z" fill="'+c+'"/><path class="ln" d="M8 50H16M84 50H92M34 34C30 26 38 22 34 14M50 34C46 26 54 22 50 14M66 34C62 26 70 22 66 14"/>',
 wallet:'<rect class="ol" x="10" y="26" width="80" height="58" rx="10" fill="'+c+'"/><path class="ol" d="M62 46H90V64H62C56 64 54 60 54 55C54 50 56 46 62 46Z" fill="#fff"/><circle cx="64" cy="55" r="4" fill="#5b4636"/>',
 server:'<rect class="ol" x="18" y="10" width="64" height="24" rx="5" fill="'+c+'"/><rect class="ol" x="18" y="38" width="64" height="24" rx="5" fill="'+c+'"/><rect class="ol" x="18" y="66" width="64" height="24" rx="5" fill="'+c+'"/><circle cx="30" cy="22" r="3.5" fill="#47cf9f"/><circle cx="30" cy="50" r="3.5" fill="#47cf9f"/><circle cx="30" cy="78" r="3.5" fill="#47cf9f"/>',
 laptop:'<rect class="ol" x="18" y="18" width="64" height="44" rx="6" fill="'+c+'"/><rect x="24" y="24" width="52" height="32" rx="3" fill="#fff" stroke="#5b4636" stroke-width="2.5"/><path class="ol" d="M8 68H92L86 80H14Z" fill="'+c+'"/>',
 clock:'<circle class="ol" cx="50" cy="52" r="38" fill="'+c+'"/><circle cx="50" cy="52" r="30" fill="#fff" stroke="#5b4636" stroke-width="2.5"/><path class="ln" d="M50 52V34M50 52L62 60"/>',
 bolt:'<path class="ol" d="M58 6 L22 56 H46 L38 94 L80 40 H54 Z" fill="'+c+'"/>',
 table:'<rect class="ol" x="10" y="18" width="80" height="64" rx="8" fill="#fff"/><path class="ln" style="stroke-width:5" d="M10 38 H90 M10 58 H90 M38 18 V82 M64 18 V82"/><rect x="12" y="20" width="76" height="16" rx="5" fill="'+c+'" opacity=".9"/>'
 };return b+m[n]+e;}
function sparkle(x,y,s,c){return '<svg class="abs" style="left:'+x+'px;top:'+y+'px" viewBox="0 0 40 40" width="'+s+'" height="'+s+'"><path class="ol" style="stroke-width:3" d="M20 2 L24 16 L38 20 L24 24 L20 38 L16 24 L2 20 L16 16 Z" fill="'+(c||"#ffe08f")+'"/></svg>';}
function cur(tl,sel,x,y,t,d){tl.to(sel,{x:x,y:y,duration:d||.7,ease:"sine.inOut"},t);}
function click(tl,sel,t){tl.to(sel,{scale:.86,duration:.1,yoyo:true,repeat:1,transformOrigin:"50% 50%",ease:"power1.inOut"},t);}
function typeText(tl,id,text,t,dur){var el=document.getElementById(id);el.innerHTML=text.split("").map(function(c){return '<span style="opacity:0">'+(c===" "?"&nbsp;":c)+'</span>';}).join("");
 tl.to(el.children,{opacity:1,duration:.01,stagger:dur/Math.max(1,text.length)},t);}
function toggle(tl,id,t){tl.to("#"+id,{backgroundColor:"#47cf9f",duration:.2},t);tl.to("#"+id+" i",{x:34,duration:.25,ease:"back.out(2)"},t);}
function arrow(x,y,w,h,id){return '<svg class="abs" style="left:'+x+'px;top:'+y+'px" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" style="overflow:visible"><path id="'+id+'" class="ln" pathLength="1" stroke-dasharray="1" d="M6 '+(h/2)+' C'+(w*.3)+' '+(h*.1)+' '+(w*.6)+' '+(h*.9)+' '+(w-26)+' '+(h/2)+'"/><path id="'+id+'h" class="ln" d="M'+(w-40)+' '+(h/2-16)+' L'+(w-8)+' '+(h/2)+' L'+(w-40)+' '+(h/2+16)+'" opacity="0"/></svg>';}

function dino(id,o){o=o||{};var b=o.body||"#9fe0c9",bl=o.belly||"#f4ffd6",sp=o.spike||"#ffe08f",w=o.w||240,h=o.h||230;
 return '<svg id="'+id+'" class="fig" viewBox="0 0 240 230" width="'+w+'" height="'+h+'" style="overflow:visible">'+
 '<g id="'+id+'-tail"><path class="ol" d="M66 152 C36 160 12 150 2 124 C22 134 42 130 60 116 Z" fill="'+b+'"/><path class="ol" style="stroke-width:4" d="M30 142 L24 126 L42 136 Z" fill="'+sp+'"/></g>'+
 '<g id="'+id+'-legL"><rect class="ol" x="84" y="176" width="32" height="40" rx="15" fill="'+b+'"/><path class="ln" style="stroke-width:4" d="M94 210 V214 M104 210 V214"/></g>'+
 '<g id="'+id+'-legR"><rect class="ol" x="124" y="176" width="32" height="40" rx="15" fill="'+b+'"/><path class="ln" style="stroke-width:4" d="M134 210 V214 M144 210 V214"/></g>'+
 '<path class="ol" d="M56 138 C56 98 112 86 152 102 C182 114 188 152 176 178 C164 198 122 204 92 196 C68 190 56 168 56 138 Z" fill="'+b+'"/>'+
 '<path d="M112 124 C142 122 170 138 168 166 C164 188 130 192 114 182 C98 170 98 132 112 124 Z" fill="'+bl+'"/>'+
 '<path class="ol" style="stroke-width:4" d="M68 120 L76 98 L92 114 Z M92 108 L104 86 L116 106 Z M118 102 L132 82 L142 104 Z" fill="'+sp+'"/>'+
 '<g id="'+id+'-armL"><path class="ln" d="M112 140 Q136 146 144 172"/><circle class="ol" cx="146" cy="177" r="9" fill="'+b+'"/></g>'+
 '<g id="'+id+'-armR"><path class="ln" d="M152 140 Q180 144 190 172"/><circle class="ol" cx="192" cy="177" r="9" fill="'+b+'"/></g>'+
 '<g id="'+id+'-head"><circle class="ol" cx="142" cy="62" r="46" fill="'+b+'"/>'+
 '<path class="ol" style="stroke-width:4" d="M116 24 L124 4 L136 22 Z M138 20 L148 0 L160 20 Z M160 24 L172 8 L176 30 Z" fill="'+sp+'"/>'+
 '<circle cx="124" cy="60" r="11" fill="#fff" stroke="#5b4636" stroke-width="3"/><circle cx="162" cy="60" r="11" fill="#fff" stroke="#5b4636" stroke-width="3"/>'+
 '<circle class="pu" cx="127" cy="62" r="6" fill="#5b4636"/><circle class="pu" cx="165" cy="62" r="6" fill="#5b4636"/><circle cx="129" cy="59" r="2" fill="#fff"/><circle cx="167" cy="59" r="2" fill="#fff"/>'+
 '<ellipse cx="108" cy="80" rx="10" ry="6" fill="#ffb3c6" opacity=".75"/><ellipse cx="178" cy="80" rx="10" ry="6" fill="#ffb3c6" opacity=".75"/>'+
 '<path class="ln" style="stroke-width:5" d="M130 82 Q143 96 156 82"/><circle cx="138" cy="74" r="2" fill="#5b4636"/><circle cx="148" cy="74" r="2" fill="#5b4636"/></g></svg>';}
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
