const NS='http://www.w3.org/2000/svg';
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html)e.innerHTML=html;return e;}
function svgEl(tag,attrs,text){const e=document.createElementNS(NS,tag);Object.entries(attrs||{}).forEach(([k,v])=>e.setAttribute(k,v));if(text!==undefined)e.textContent=text;return e;}
function addText(svg,x,y,text,size=24,color='#375e57',weight=500){const e=svgEl('text',{x,y,fill:color,'font-size':size,'font-weight':weight,'text-anchor':'middle'},text);svg.appendChild(e);return e;}
function makeSvg(st){const svg=svgEl('svg',{viewBox:'0 0 1280 430',class:'diagram',xmlns:NS});svg.innerHTML='<defs><marker id="'+S.id+'-arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="context-stroke"/></marker></defs>';st.appendChild(svg);return svg;}
function pop(tl,e,t=.5){tl.fromTo(e,{opacity:0,y:18},{opacity:1,y:0,duration:.5,ease:'power3.out'},Math.max(.15,t));}
function line(svg,a,b,{color='#bdd0c5',width=3,dash='',arrow=false,curve=false,offset=83}={}){const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;const p=[a[0]+dx/l*offset,a[1]+dy/l*offset],q=[b[0]-dx/l*offset,b[1]-dy/l*offset];const e=svgEl('path',{d:curve?`M${p} Q${(p[0]+q[0])/2} ${Math.min(p[1],q[1])-130} ${q}`:`M${p} L${q}`,fill:'none',stroke:color,'stroke-width':width,'stroke-linecap':'round'});if(dash)e.setAttribute('stroke-dasharray',dash);if(arrow)e.setAttribute('marker-end',`url(#${S.id}-arr)`);svg.insertBefore(e,svg.querySelector('g[data-node]'));return e;}
function draw(tl,p,t,d=.75){const len=p.getTotalLength(),dash=p.getAttribute('stroke-dasharray');tl.fromTo(p,{strokeDasharray:len,strokeDashoffset:len,opacity:0},{strokeDashoffset:0,opacity:1,duration:d,ease:'power2.out'},t);tl.set(p,{strokeDasharray:dash||'none'},t+d);}
function packet(tl,svg,p,t,color='#14876d',label=''){const plen=p.getTotalLength(),trail=Array.from({length:201},(_,i)=>p.getPointAtLength(plen*i/200));const dot=svgEl('circle',{r:9,fill:color,stroke:'#fff','stroke-width':3});svg.appendChild(dot);const driver={v:0};tl.fromTo(dot,{opacity:0},{opacity:1,duration:.12},t);tl.to(driver,{v:1,duration:1.4,ease:'none',onUpdate:()=>{const index=Math.min(199,Math.floor(driver.v*200)),f=driver.v*200-index;const pt={x:trail[index].x+(trail[index+1].x-trail[index].x)*f,y:trail[index].y+(trail[index+1].y-trail[index].y)*f};dot.setAttribute('cx',pt.x);dot.setAttribute('cy',pt.y);}},t);tl.to(dot,{opacity:0,duration:.15},t+1.3);return dot;}
function node(svg,x,y,name,sub='',tone='#173b38',w=146){const g=svgEl('g',{'data-node':'1'});g.innerHTML=`<rect x="${x-w/2}" y="${y-42}" width="${w}" height="84" rx="20" fill="#fff" stroke="${tone}" stroke-width="3"/><text x="${x}" y="${y-3}" text-anchor="middle" fill="${tone}" font-size="29" font-weight="800">${esc(name)}</text><text x="${x}" y="${y+27}" text-anchor="middle" fill="#4f716b" font-size="20">${esc(sub)}</text>`;svg.appendChild(g);return g;}
function tag(st,text,y=710){const e=el('div','float-note',esc(text));e.style.top=y+'px';st.appendChild(e);return e;}
function showRows(tl,st,rows,times){const p=el('div','panel');st.appendChild(p);rows.forEach((text,i)=>{const r=el('div','fact-row',`<span class="num">${i+1}</span><b>${esc(text)}</b>`);p.appendChild(r);pop(tl,r,times[i]??1+i*2);});return p;}
function take(tl,st,text,t){if(!text)return;const e=el('div','takeaway',esc(text));st.appendChild(e);pop(tl,e,t);}
function time(q,fallback=1){const k=S.cueTimes?.[q];return k===undefined?fallback:k;}
function build(tl,root){
 const st=root.querySelector('.stage');st.appendChild(el('div','eyebrow','CODEX CLASSROOM · 数通协议专家'));st.appendChild(el('div','series',`机制科普 ${S.chapter} · ${S.sceneNo} / ${S.sceneCount}`));
 const title=el('h1','scene-title',esc(S.title));st.appendChild(title);pop(tl,title,.1);
 const mc=el('div','mascot');const id=S.id+'-bot';mc.innerHTML=mascot(id);st.appendChild(mc);
 const guide=el('div','guide',`<b>小码的观察提示</b>${esc(S.guide||'跟着图里的箭头，先看条件，再看结果。')}`);st.appendChild(guide);pop(tl,guide,.7);
 const source=el('div','source',S.sourceLabel||(S.chapter==='01'?'依据 RFC 2328 §7.3–7.5、§9.4、§12.4.2 · 图形为教学示意':'依据 RFC 2328 §12.4.4、§16.4；RFC 3101 §2.3、§3 · 图形为教学示意'));st.appendChild(source);
 const progress=el('div','progress','<i></i>');st.appendChild(progress);tl.fromTo(progress.firstChild,{scaleX:0},{scaleX:1,duration:SDUR,ease:'none'},0);
 act(tl,id,SDUR,[1.5,SDUR*.38,SDUR*.7]);(S.talk||[]).forEach(w=>{tl.to('#'+id+'-mouth',{scaleY:1.5,svgOrigin:'161 124',duration:.1},w.s);tl.to('#'+id+'-mouth',{scaleY:1,duration:.1},Math.max(w.s+.12,w.e-.1));});
 const render=RENDER[S.kind];if(!render)throw Error('Unknown renderer '+S.kind);render(tl,st);
 take(tl,st,S.takeaway,Math.max(2,SDUR-5.5));
}
const RENDER={
 hook(tl,st){const q=el('div','hero-q',esc(S.question));st.appendChild(q);pop(tl,q,.6);const a=el('div','hero-answer',esc(S.answer));st.appendChild(a);pop(tl,a,time('今天',SDUR*.5));const strip=el('div','tag-strip',S.tags?S.tags.map(x=>'<span>'+esc(x)+'</span>').join(''):S.chapter==='01'?'<span>① 减少邻接</span><span>② 理解伪节点</span><span>③ 分清转发</span>':'<span>① 读懂字段</span><span>② 比较路径</span><span>③ 按步骤排障</span>');st.appendChild(strip);pop(tl,strip,SDUR*.65);},
 quiz(tl,st){const q=el('div','hero-q',esc(S.question));q.style.fontSize='62px';st.appendChild(q);pop(tl,q,.5);const a=el('div','quiz-answer',esc(S.answer));st.appendChild(a);pop(tl,a,time(S.reveal||'不用',SDUR*.35));},
 recap(tl,st){showRows(tl,st,S.points,[time(S.chapter==='01'||Number(S.chapter)>=3?'第一':'发布者',1),time(S.chapter==='01'||Number(S.chapter)>=3?'第二':'为零',SDUR*.37),time(S.chapter==='01'||Number(S.chapter)>=3?'第三':'非零',SDUR*.61)]);},
 election(tl,st){const p=el('div','panel');p.style.padding='18px 30px';st.appendChild(p);p.innerHTML='<div class="ranking h"><span>候选</span><span>接口优先级</span><span>Router ID</span><span>是否有资格</span></div>';const rows=[['R1','100','1.1.1.1','参与比较'],['R2','100','2.2.2.2','同优先级，RID 更大'],['R3','0','9.9.9.9','不参选']];rows.forEach((r,i)=>{const e=el('div','ranking'+(i===2?' disabled':''),r.map((v,j)=>`<span class="${j===3?'candidate'+(i===2?' no':''):''}">${esc(v)}</span>`).join(''));p.appendChild(e);pop(tl,e,[1,time('相同',SDUR*.5),time('优先级为零',2)][i]);});},
 scope(tl,st){const svg=makeSvg(st);const a=node(svg,190,200,'网段 A','Broadcast','#087c9b',230),b=node(svg,1090,200,'网段 B','Broadcast','#087c9b',230),c=node(svg,640,200,'同一台 R1','接口角色不同','#173b38',240);line(svg,[320,200],[510,200]);line(svg,[770,200],[960,200]);addText(svg,418,145,'GE0/0/1：DR',27,'#087c68',700);addText(svg,862,145,'GE0/0/2：DROther',25,'#087c9b',700);pop(tl,a,.7);pop(tl,c,.5);pop(tl,b,time('另一个',SDUR*.4));tag(st,'Point-to-Point：不选举 DR / BDR',714);},
 'dr-network'(tl,st){
  const svg=makeSvg(st),pos=[[350,65],[940,65],[180,330],[650,330],[1120,330]],mode=S.mode;
  if(mode==='pseudo'){
   const n=[640,95],r=[[190,300],[640,330],[1090,300]];
   const net=node(svg,...n,'共享网段','Type-2 LSA','#087c9b',260);pop(tl,net,.5);tl.to(net.querySelector('rect'),{fill:'#daf1e3',duration:.4},time('伪节点',2));
   r.forEach((a,i)=>{const p=line(svg,a,n,{color:'#087c9b',width:4,arrow:true});draw(tl,p,1+i*.7);const nn=node(svg,...a,['R1','R3','R4'][i],'SPF 图里的路由器','#173b38',220);pop(tl,nn,.7+i*.4);});
   addText(svg,380,170,'路由器 → 网段：接口 cost',24);addText(svg,935,170,'网段 → 路由器：0',24);addText(svg,640,408,'由 DR 生成 Network-LSA；这张图不表示实际数据绕行',24,'#087c68',700);return;
  }
  const pairs=[];for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)if(mode==='mesh'||i<2)pairs.push([i,j]);
  const lines={};pairs.forEach(([i,j],k)=>{const p=line(svg,pos[i],pos[j],{color:mode==='mesh'?'#a5bab0':i===0?'#087c9b':'#6ba999',width:mode==='mesh'?2.5:3.5});lines[i+'-'+j]=p;draw(tl,p,.6+k*.14);});
  const roles=mode==='mesh'?['普通邻居','普通邻居','普通邻居','普通邻居','普通邻居']:['DR','BDR','DROther','DROther','DROther'];
  const nodes=pos.map((p,i)=>{const n=node(svg,...p,'R'+(i+1),roles[i],i===0?'#087c9b':i===1?'#14876d':'#173b38');pop(tl,n,.5+i*.12);return n;});
  if(mode==='adjacency'){const p=line(svg,pos[2],pos[3],{color:'#d47a58',width:4,dash:'8 10'});draw(tl,p,time('Two Way',SDUR*.5));addText(svg,413,405,'两个 DROther：2-Way',24,'#9e4e32',700);}
  if(mode==='late'){const n=node(svg,640,202,'新来的 R6','Priority = 200','#bd6949',270);pop(tl,n,time('新设备',2));addText(svg,640,262,'已有角色保持；不直接抢占',25,'#9e4e32',700);}
  if(mode==='data'){const p=line(svg,pos[2],pos[3],{color:'#14876d',width:9,arrow:true});draw(tl,p,time('直接',3));packet(tl,svg,p,time('直接',3)+.5);addText(svg,425,405,'R3 → R4：同一网段直接交付',25,'#087c68',700);}
  if(mode==='flood'){
   [[2,0],[2,1]].forEach(([a,b],i)=>{const p=line(svg,pos[a],pos[b],{color:'#087c9b',width:7,arrow:true});draw(tl,p,time('点六',3)+i*.2);packet(tl,svg,p,time('点六',3)+.4+i*.3,'#087c9b');});
   [3,4].forEach((b,i)=>{const p=line(svg,pos[0],pos[b],{color:'#14876d',width:7,arrow:true});draw(tl,p,time('点五',SDUR*.58)+i*.2);packet(tl,svg,p,time('点五',SDUR*.58)+.3+i*.3);});
   addText(svg,640,210,'.6：发给 DR / BDR',24,'#087c9b',700);addText(svg,640,250,'.5：发给全部 OSPF 路由器',23,'#087c68',700);
  }
  if(mode==='failover'){tl.to(nodes[0],{opacity:.18,duration:.5},time('故障',2));const label=svgEl('rect',{x:867,y:76,width:146,height:31,rx:10,fill:'#d6f0df'});svg.appendChild(label);const text=addText(svg,940,95,'新 DR',20,'#087c68',800);tl.to(nodes[1].querySelector('text:last-child'),{opacity:0,duration:.1},time('接任',4));pop(tl,label,time('接任',4));pop(tl,text,time('接任',4));addText(svg,650,210,'检测故障 → BDR 接任 → 选新 BDR',25,'#087c68',700);}
 },
 lsa(tl,st){const p=el('div','panel');st.appendChild(p);[['目的前缀','192.168.100.0/24'],['Advertising Router','R3 的 Router ID'],['Forwarding Address','0.0.0.0 或一个转发目标地址']].forEach(([a,b],i)=>{const r=el('div','field-row',`<strong>${a}</strong><span>${b}</span>`);p.appendChild(r);pop(tl,r,[time('目的前缀',1),time('Advertising Router',SDUR*.3),time('Forwarding Address',SDUR*.5)][i]);});},
 'fa-network'(tl,st){
  const svg=makeSvg(st),pos=[[100,200],[430,200],[700,65],[970,200],[1190,200]],mode=S.mode;
  svg.appendChild(svgEl('rect',{x:330,y:4,width:735,height:325,rx:35,fill:'#e3eee3',stroke:'#bfd1c1','stroke-width':2}));
  addText(svg,700,370,'共享以太网 10.1.1.0/24 · 线条表示逻辑路径',24,'#4f716b');
  [[0,1],[1,2],[2,3],[1,3],[3,4]].forEach(([i,j])=>line(svg,pos[i],pos[j],{color:'#bbcfc2',width:3}));
  const control=line(svg,pos[2],pos[0],{color:'#087c9b',width:4,arrow:true,dash:'9 8',curve:true});pop(tl,control,.8);addText(svg,320,65,'R3 发布外部 LSA',23,'#087c9b',700);
  const names=['R1','R2','R3','外部网关','目的网段'],subs=['内部观察者','下一跳 / ABR','ASBR · 发布者','10.1.1.254','192.168.100/24'];
  const paths=mode==='zero'?[[0,1],[1,2],[2,3],[3,4]]:mode==='nonzero'?[[0,1],[1,3],[3,4]]:[];
  paths.forEach(([a,b],i)=>{const p=line(svg,pos[a],pos[b],{color:'#14876d',width:8,arrow:true});const t=time(mode==='zero'?'于是包':'下一跳',SDUR*.4)+i*1.45;draw(tl,p,t,.5);packet(tl,svg,p,t+.25);});
  pos.forEach((p,i)=>{const n=node(svg,...p,names[i],subs[i],i===2?'#087c9b':i===3?'#14876d':'#173b38',i===4?165:145);pop(tl,n,.4+i*.15);});
  if(mode!=='topology'){const label=addText(svg,690,410,mode==='zero'?'FA = 0.0.0.0 → 内部路径到 ASBR':'FA = 10.1.1.254 → 内部路径到 FA',28,'#087c68',800);pop(tl,label,1.4);}
 },
 recursive(tl,st){const svg=makeSvg(st);const a=node(svg,190,190,'R1','当前观察者','#173b38',240),b=node(svg,650,190,'R2','实际直接下一跳','#14876d',250),c=node(svg,1080,190,'FA 目标','10.1.1.254','#087c9b',260);const p=line(svg,[190,190],[650,190],{color:'#14876d',width:8,arrow:true,offset:140});draw(tl,p,1.2);packet(tl,svg,p,time('先发给',SDUR*.5));const q=line(svg,[650,190],[1080,190],{color:'#14876d',width:6,dash:'10 8',arrow:true,offset:140});draw(tl,q,time('递归',SDUR*.6));addText(svg,640,335,'R1 的路由表：目的业务前缀 → 下一跳 R2',30,'#087c68',700);[a,b,c].forEach((x,i)=>pop(tl,x,.5+i*.3));},
 unreachable(tl,st){showRows(tl,st,['LSDB：已收到外部 LSA，FA 非零','内部路由：无区域内 / 区域间路径到 FA','结果：不能据此安装外部业务路由'],[.6,time('区域内',SDUR*.25),time('不能',SDUR*.45)]);},
 checklist(tl,st){showRows(tl,st,S.items,[.6,SDUR*.32,SDUR*.56]);},
 nssa(tl,st){const svg=makeSvg(st);const a=node(svg,190,195,'NSSA ASBR','Type-7 发布者','#173b38',245),b=node(svg,640,195,'翻译 ABR','生成 Type-5','#087c9b',260),c=node(svg,1090,195,'其他区域','接收 Type-5','#173b38',245);const p=line(svg,[190,195],[640,195],{color:'#087c9b',width:6,arrow:true,offset:145}),q=line(svg,[640,195],[1090,195],{color:'#087c9b',width:6,arrow:true,offset:145});draw(tl,p,1);draw(tl,q,time('五类',SDUR*.2));[a,b,c].forEach((n,i)=>pop(tl,n,.5+i*.3));addText(svg,640,325,'Adv Router：ASBR → 翻译 ABR',29,'#087c9b',700);const txt=addText(svg,640,380,'FA：继续指向原来的转发目标',29,'#087c68',700);pop(tl,txt,time('保留下来',SDUR*.4));}
};
