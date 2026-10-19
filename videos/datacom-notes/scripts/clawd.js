/* Clawd 像素小人：10px 像素格的 SVG，替代 dino2.js。
   姿态：cIdle 待机呼吸+眨眼、cPoint 向左指（内容在左）、cThink 思考（眼睛上瞟+像素问号泡）、cNod 点头、cEnter 入场。 */
function clawd(id,o){o=o||{};var w=o.w||270,h=Math.round(w*130/150);
 var B="#d97757",HL="#ec9a78",SH="#b65d40",K="#1a1020";
 function r(x,y,ww,hh,c,ex){return '<rect x="'+x+'" y="'+y+'" width="'+ww+'" height="'+hh+'" fill="'+c+'"'+(ex||'')+'/>';}
 return '<svg id="'+id+'" class="clawd" viewBox="-30 -40 180 170" width="'+w+'" height="'+h+'" shape-rendering="crispEdges" style="overflow:visible">'+
 '<ellipse cx="75" cy="122" rx="62" ry="6" fill="#000" opacity=".35"/>'+
 '<g id="'+id+'-think" opacity="0">'+r(118,-4,8,8,"#e2e8f0")+r(130,-18,12,12,"#e2e8f0")+
  '<g transform="translate(140,-40)">'+r(0,0,30,30,"#e2e8f0")+r(9,5,12,4,K)+r(18,9,4,6,K)+r(12,15,6,4,K)+r(12,22,6,4,K)+'</g></g>'+
 '<g id="'+id+'-legs">'+r(30,80,10,22,SH)+r(50,80,10,22,SH)+r(90,80,10,22,SH)+r(110,80,10,22,SH)+'</g>'+
 '<g id="'+id+'-body">'+
  '<g id="'+id+'-armL">'+r(10,40,10,20,B)+'</g>'+
  '<g id="'+id+'-ptr" opacity="0">'+r(-20,40,40,10,B)+r(-30,38,10,14,HL)+'</g>'+
  '<g id="'+id+'-armR">'+r(130,40,10,20,B)+'</g>'+
  r(20,10,110,72,B)+r(20,10,110,8,HL)+r(20,74,110,8,SH)+
  '<g id="'+id+'-eyes">'+r(45,30,10,22,K)+r(95,30,10,22,K)+r(47,32,4,6,"#fff",' opacity=".55"')+r(97,32,4,6,"#fff",' opacity=".55"')+'</g>'+
 '</g></svg>';}
function cIdle(tl,id,t,dur){var n=Math.max(1,Math.floor(dur/1.6));
 tl.fromTo("#"+id+"-body",{scaleY:1},{scaleY:1.035,svgOrigin:"75 82",duration:.8,repeat:n*2-1,yoyo:true,ease:"sine.inOut"},t);
 for(var b=t+1.4;b<t+dur-.4;b+=3.1){tl.to("#"+id+"-eyes",{scaleY:.12,svgOrigin:"75 41",duration:.07,yoyo:true,repeat:1,ease:"none"},b);}}
function cEnter(tl,sel,t){tl.fromTo(sel,{opacity:0,y:140},{opacity:1,y:0,duration:.55,ease:"back.out(1.6)"},t);}
function cPoint(tl,id,t,hold){hold=hold||1;
 tl.set("#"+id+"-armL",{opacity:0},t);tl.set("#"+id+"-ptr",{opacity:1},t);
 tl.fromTo("#"+id+"-ptr",{x:36},{x:0,duration:.22,ease:"steps(3)"},t);
 tl.to("#"+id+"-eyes",{x:-6,duration:.15,ease:"steps(2)"},t);
 tl.to("#"+id+"-ptr",{x:-6,duration:.18,yoyo:true,repeat:3,ease:"steps(2)"},t+.25);
 tl.to("#"+id+"-ptr",{x:36,duration:.18,ease:"steps(3)"},t+.25+hold);
 tl.set("#"+id+"-ptr",{opacity:0},t+.45+hold);tl.set("#"+id+"-armL",{opacity:1},t+.45+hold);
 tl.to("#"+id+"-eyes",{x:0,duration:.15,ease:"steps(2)"},t+.45+hold);}
function cThink(tl,id,t,hold){hold=hold||2;
 tl.to("#"+id+"-eyes",{x:6,y:-8,duration:.2,ease:"steps(2)"},t);
 tl.to("#"+id+"-armR",{y:-12,duration:.2,ease:"steps(2)"},t);
 tl.fromTo("#"+id+"-think",{opacity:0,y:10},{opacity:1,y:0,duration:.3,ease:"steps(3)"},t+.1);
 tl.to("#"+id+"-think",{y:-6,duration:.5,yoyo:true,repeat:Math.max(1,Math.floor(hold/.5)-1),ease:"steps(2)"},t+.4);
 tl.to("#"+id+"-think",{opacity:0,duration:.2,ease:"steps(2)"},t+hold);
 tl.to("#"+id+"-eyes",{x:0,y:0,duration:.2,ease:"steps(2)"},t+hold);
 tl.to("#"+id+"-armR",{y:0,duration:.2,ease:"steps(2)"},t+hold);}
function cNod(tl,id,t,n){n=n||2;
 tl.to("#"+id+"-body",{y:8,duration:.14,yoyo:true,repeat:n*2-1,ease:"steps(2)"},t);
 tl.to("#"+id+"-eyes",{scaleY:.3,svgOrigin:"75 41",duration:.14,yoyo:true,repeat:1,ease:"none"},t);}
