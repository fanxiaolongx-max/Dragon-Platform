/* 数据驱动场景渲染：build.py 注入 S（分段数据，cue 已换算成场景内秒数 ct）、CAPS、SDUR。 */
function el(tag,cls,html,style,id){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;if(style)e.setAttribute("style",style);if(id)e.id=id;return e;}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
var TONE={ok:"#22c55e",info:"#3b82f6",warn:"#f59e0b",bad:"#ef4444"};
function pop(tl,sel,t,o){o=o||{};tl.fromTo(sel,{opacity:0,y:o.y==null?24:o.y,scale:o.s||.94},{opacity:1,y:0,scale:1,duration:o.d||.5,ease:"back.out(1.5)"},t);}
function slideIn(tl,sel,t,x){tl.fromTo(sel,{opacity:0,x:x==null?-50:x},{opacity:1,x:0,duration:.45,ease:"power3.out"},t);}
function glow(tl,sel,t,c){tl.fromTo(sel,{boxShadow:"0 0 0px 0px "+c},{boxShadow:"0 0 34px 6px "+c,duration:.35,yoyo:true,repeat:3,ease:"sine.inOut"},t);}
function captions(tl,box){CAPS.forEach(function(c){var e=el("div","c");e.textContent=c.t;box.appendChild(e);
 tl.fromTo(e,{opacity:0,y:10},{opacity:1,y:0,duration:.22,ease:"sine.out"},c.s-.05);
 tl.to(e,{opacity:0,y:-6,duration:.16,ease:"sine.in"},Math.max(c.s+.3,c.e-.1));});}
function scene(tl,root){var st=root.querySelector(".stage"),P=S.id+"-",cid=P+"cl";
 var hd=el("div","head",'<span class="chip">'+esc(S.head)+'</span>');st.appendChild(hd);
 st.appendChild(el("div","series",'数通协议专家 · <b>'+esc(S.series)+'</b>'));
 tl.fromTo(hd,{opacity:0,x:-40},{opacity:1,x:0,duration:.5,ease:"power3.out"},.15);
 var cb=el("div","clawdbox");cb.id=P+"cb";cb.innerHTML=clawd(cid,{w:270});st.appendChild(cb);
 cEnter(tl,"#"+P+"cb",.3);cIdle(tl,cid,.9,SDUR-1);
 var R=RENDER[S.type];R(tl,st,P,cid);
 (S.clawd||[]).forEach(function(a){if(a.pose==="point")cPoint(tl,cid,a.ct,a.hold);else if(a.pose==="think")cThink(tl,cid,a.ct,a.hold);else if(a.pose==="nod")cNod(tl,cid,a.ct,a.n);});
 captions(tl,root.querySelector(".cap"));}
var RENDER={
 title:function(tl,st,P,cid){
  var t=el("div","ttl",esc(S.title));st.appendChild(t);var u=el("div","uline");st.appendChild(u);
  var s=el("div","sub",esc(S.subtitle||""));st.appendChild(s);
  tl.fromTo(t,{opacity:0,y:40},{opacity:1,y:0,duration:.7,ease:"power3.out"},.4);
  tl.fromTo(u,{scaleX:0},{scaleX:1,duration:.7,ease:"power2.inOut"},.9);
  tl.fromTo(s,{opacity:0,y:20},{opacity:1,y:0,duration:.5},1.3);
  var tg=el("div","tags");st.appendChild(tg);(S.tags||[]).forEach(function(x,i){var e=el("span","tag",esc(x.t));tg.appendChild(e);pop(tl,e,x.ct+i*.18);});
  if(S.strip){var sp=el("div","strip");st.appendChild(sp);var items=S.strip.items.map(function(x){var e=el("span",null,esc(x));sp.appendChild(e);return e;});
   tl.fromTo(items,{opacity:0,y:16},{opacity:1,y:0,duration:.3,stagger:.12},S.strip.ct-.2);
   items.forEach(function(e,i){var t0=S.strip.ct+1+i*.28;tl.to(e,{color:"#fff",borderColor:"#f59e0b",backgroundColor:"rgba(245,158,11,.18)",duration:.18},t0);
    if(i<items.length-1)tl.to(e,{color:"#94a3b8",borderColor:"rgba(148,163,184,.35)",backgroundColor:"rgba(0,0,0,0)",duration:.25},t0+.3);});}
  cPoint(tl,cid,1.2,1.4);},
 question:function(tl,st,P,cid){var T=S.term;
  var tm=el("div","term",'<div class="bar"><i></i><i></i><i></i></div><div class="cmd"></div>');st.appendChild(tm);
  pop(tl,tm,.5);var cmd=tm.querySelector(".cmd");cmd.innerHTML=("&lt;R1&gt; "+esc(T.cmd)).replace(/(&[a-z]+;|.)/g,'<span style="opacity:0">$1</span>');
  tl.to(cmd.children,{opacity:1,duration:.01,stagger:1.1/cmd.children.length},.9);
  T.rows.forEach(function(r,i){var c=TONE[r.tone]||"#94a3b8";var e=el("div","tr",'<span>'+esc(r.cells[0])+'</span><span>'+esc(r.cells[1])+'</span><span><b class="badge" style="color:'+c+';border-color:'+c+'">'+esc(r.cells[2])+'</b></span>');tm.appendChild(e);
   slideIn(tl,e,r.ct-.15+(i===2?.2:0),-30);if(r.tone!=="ok")glow(tl,e.querySelector(".badge"),r.ct+.4,c);});
  var q=el("div","qbox",'<div class="q">?</div><div class="qt"></div>');q.querySelector(".qt").textContent=S.question[0].t;st.appendChild(q);
  pop(tl,q,S.question[0].ct-.2,{s:.6});cThink(tl,cid,1.2,Math.max(1.5,S.question[0].ct-1.6));},
 fsm:function(tl,st,P,cid){var W=S.nw||270,H=110,N={};
  var svgNS="http://www.w3.org/2000/svg",svg=document.createElementNS(svgNS,"svg");svg.setAttribute("width","1920");svg.setAttribute("height","1080");svg.setAttribute("style","position:absolute;left:0;top:0;overflow:visible");st.appendChild(svg);
  S.edges.forEach(function(e){S.nodes.forEach(function(nd){if(nd.id===e.from&&e.ct<nd.ct)nd.ct=e.ct;});});
  var n=S.nodes.length;S.nodes.forEach(function(nd,i){var at=nd.at||[100+W/2+i*((1400-W)/Math.max(1,n-1)),440];N[nd.id]={x:at[0],y:at[1],nd:nd};});
  function clip(a,b){var dx=b.x-a.x,dy=b.y-a.y,k=Math.min(Math.abs(dx)>0?(W/2+14)/Math.abs(dx):1e9,Math.abs(dy)>0?(H/2+14)/Math.abs(dy):1e9);return [a.x+dx*k,a.y+dy*k];}
  S.edges.forEach(function(e,i){var A=N[e.from],B=N[e.to],p,lab,ang,d;
   if(e.arc){var mx=(A.x+B.x)/2,my=Math.min(A.y,B.y)-150,C={x:mx,y:my},s=clip(A,C),f=clip(B,C);d="M"+s[0]+" "+s[1]+" Q"+mx+" "+my+" "+f[0]+" "+f[1];lab=[.25*s[0]+.5*mx+.25*f[0],.25*s[1]+.5*my+.25*f[1]];ang=Math.atan2(f[1]-my,f[0]-mx);p=f;}
   else{var s2=clip(A,B),f2=clip(B,A);d="M"+s2[0]+" "+s2[1]+" L"+f2[0]+" "+f2[1];lab=[(s2[0]+f2[0])/2,(s2[1]+f2[1])/2-(Math.abs(A.y-B.y)<2?40:0)];ang=Math.atan2(f2[1]-s2[1],f2[0]-s2[0]);p=f2;}
   var path=document.createElementNS(svgNS,"path");path.setAttribute("d",d);path.setAttribute("fill","none");path.setAttribute("stroke","#f59e0b");path.setAttribute("stroke-width","5");path.setAttribute("stroke-linecap","round");path.setAttribute("pathLength","1");path.setAttribute("stroke-dasharray","1");path.setAttribute("stroke-dashoffset","1");svg.appendChild(path);
   var hd=document.createElementNS(svgNS,"path");var c=Math.cos(ang),sn=Math.sin(ang);hd.setAttribute("d","M"+(p[0]-22*c+12*sn)+" "+(p[1]-22*sn-12*c)+" L"+p[0]+" "+p[1]+" L"+(p[0]-22*c-12*sn)+" "+(p[1]-22*sn+12*c)+" Z");hd.setAttribute("fill","#f59e0b");hd.setAttribute("opacity","0");svg.appendChild(hd);
   var lb=el("div","elab",esc(e.label),"left:"+lab[0]+"px;top:"+lab[1]+"px");st.appendChild(lb);
   tl.to(path,{strokeDashoffset:0,duration:.55,ease:"power2.out"},e.ct-.3);tl.to(hd,{opacity:1,duration:.1},e.ct+.2);
   tl.fromTo(lb,{opacity:0,scale:.7},{opacity:1,scale:1,duration:.3,ease:"back.out(2)"},e.ct-.1);});
  var prev=null;S.nodes.forEach(function(nd){var q=N[nd.id];var b=el("div","node"+(nd.final?" final":""),esc(nd.label),"left:"+(q.x-W/2)+"px;top:"+(q.y-H/2)+"px;width:"+W+"px;height:"+H+"px");st.appendChild(b);
   var sb=el("div","nsub",esc(nd.sub||""),"left:"+(q.x-260)+"px;width:520px;top:"+(nd.subUp?q.y-H/2-56:q.y+H/2+16)+"px");st.appendChild(sb);
   pop(tl,b,nd.ct-.1,{s:.6});tl.fromTo(sb,{opacity:0},{opacity:1,duration:.3},nd.ct+.25);
   var gc=nd.final?"rgba(34,197,94,.75)":"rgba(245,158,11,.7)";
   tl.to(b,{boxShadow:"0 0 36px 6px "+gc,borderColor:nd.final?"#22c55e":"#f59e0b",duration:.3},nd.ct+.2);
   if(prev)tl.to(prev,{boxShadow:"0 0 0px 0px rgba(0,0,0,0)",borderColor:"#3b82f6",duration:.3},nd.ct+.2);prev=b;});
  if(S.note){var nt=el("div","note",'<i>!</i>'+esc(S.note.t),"left:100px;top:"+(S.note.y||760)+"px");st.appendChild(nt);pop(tl,nt,S.note.ct-.2);}
  cPoint(tl,cid,S.nodes[Math.min(1,n-1)].ct,1);if(S.note)cPoint(tl,cid,S.note.ct+.2,1);},
 compare:function(tl,st,P,cid){var w=S.widths||[1.35,1,1.25],sum=w.reduce(function(a,b){return a+b;},0);
  if(S.caption){var cp=el("div","tcap","◆ "+esc(S.caption));st.appendChild(cp);slideIn(tl,cp,.6,-30);}
  var tb=el("div",S.compact?"tbl cpt":"tbl");st.appendChild(tb);
  function row(cells,cls,tone){var r=el("div","trow"+(cls?" "+cls:""));if(tone)r.appendChild(el("i","st",null,"background:"+TONE[tone]));
   cells.forEach(function(c,j){var d=el("div",j===0&&!cls&&/^[\x00-\x7f]+$/.test(c)?"td mono":"td",esc(c),"width:"+(1396*w[j]/sum)+"px"+(j===1&&tone&&!cls?";color:"+TONE[tone]+";font-weight:700":""));r.appendChild(d);});tb.appendChild(r);return r;}
  var h=row(S.cols,"h");slideIn(tl,h,.8,-30);
  var rows=S.rows.map(function(r){var e=row(r.cells,null,r.tone);slideIn(tl,e,r.ct-.15);return e;});
  if(S.flash){var cell=rows[S.flash.row].children[S.flash.col+1];tl.to(cell,{color:"#f59e0b",fontWeight:900,duration:.2},S.flash.ct);glow(tl,rows[S.flash.row],S.flash.ct,"rgba(245,158,11,.6)");cPoint(tl,cid,S.flash.ct,1.2);}
  cPoint(tl,cid,S.rows[0].ct+.2,1);},
 packet:function(tl,st,P,cid){var pt=el("div","ptitle","▸ "+esc(S.packet));st.appendChild(pt);
  var bar=el("div","pkt");st.appendChild(bar);var sum=S.fields.reduce(function(a,f){return a+(f.w||1);},0);
  tl.fromTo(bar,{opacity:0,scaleX:.3},{opacity:1,scaleX:1,duration:.5,ease:"power3.out",transformOrigin:"0 50%"},S.packetCt-.6);slideIn(tl,pt,S.packetCt-.8,-30);
  S.fields.forEach(function(f){var e=el("div","fld"+(f.dim?" dim":""),'<span class="fn">'+esc(f.name)+'</span><span class="fv">'+esc(f.val)+'</span>',"width:"+(1394*(f.w||1)/sum)+"px");bar.appendChild(e);
   tl.fromTo(e.querySelector(".fv"),{opacity:0,y:16},{opacity:1,y:0,duration:.3,ease:"back.out(2)"},Math.max(f.ct,S.packetCt)-.1);
   if(f.hl)tl.to(e,{backgroundColor:"rgba(245,158,11,.28)",duration:.25},f.ct);});
  var D=S.duel;if(D){var L=el("div","rtr card",'<svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="rgba(37,99,235,.25)" stroke="#3b82f6" stroke-width="4"/><path d="M28 40h40M56 30l12 10-12 10M68 58H28M40 48L28 58l12 10" stroke="#e2e8f0" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><div><div class="nm">'+esc(D.left.name)+'</div><div class="rid">RID '+esc(D.left.rid)+'</div></div>',"left:180px");
   var Rr=el("div","rtr card",L.innerHTML.replace(esc(D.left.name),esc(D.right.name)).replace(esc(D.left.rid),esc(D.right.rid)),"left:820px");
   st.appendChild(L);st.appendChild(Rr);var vs=el("div","vs","VS");st.appendChild(vs);
   pop(tl,L,D.ct-.2);pop(tl,Rr,D.ct);pop(tl,vs,D.ct+.2,{s:.5});
   var W2=D.winner==="right"?Rr:L,Lo=D.winner==="right"?L:Rr;
   var m=el("div","role","Master","background:#f59e0b;color:#1a1020");W2.appendChild(m);var s=el("div","role","Slave","background:#334155;color:#cbd5e1");Lo.appendChild(s);
   pop(tl,m,D.winCt-.1,{s:.4});pop(tl,s,D.winCt+.2,{s:.4});tl.to(W2,{borderColor:"#f59e0b",duration:.3},D.winCt);glow(tl,W2,D.winCt,"rgba(245,158,11,.55)");tl.to(Lo,{opacity:.6,duration:.4},D.winCt+.3);
   cPoint(tl,cid,D.winCt,1.4);}},
 recap:function(tl,st,P,cid){S.points.forEach(function(p,i){var e=el("div","pt card",'<span class="n">'+(i+1)+'</span><span class="t">'+esc(p.t)+'</span><span class="ck">✓</span>',"top:"+(230+i*180)+"px");st.appendChild(e);
  slideIn(tl,e,p.ct-.2,-60);tl.fromTo(e.querySelector(".ck"),{opacity:0,scale:0},{opacity:1,scale:1,duration:.35,ease:"back.out(3)"},p.ct+.25);tl.to(e,{borderColor:"rgba(245,158,11,.7)",duration:.3},p.ct+.25);cNod(tl,cid,p.ct+.3,2);});
  cPoint(tl,cid,SDUR-3.2,1.2);}
};
