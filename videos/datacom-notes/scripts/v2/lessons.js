// OSPFv2 teaching figures. One data model per figure; timeline time owns every reveal.
function label(tl,svg,x,y,text,t=.5,size=26,color='#375e57',weight=600){const e=addText(svg,x,y,text,size,color,weight);pop(tl,e,t);return e;}
function box(svg,x,y,w,h,fill='#fff',stroke='#bed2c6'){const g=svgEl('g',{'data-node':'1'});g.appendChild(svgEl('rect',{x,y,width:w,height:h,rx:18,fill,stroke,'stroke-width':2.5}));svg.appendChild(g);return g;}
function plainPath(svg,d,color='#087c9b',width=5,arrow=true){const p=svgEl('path',{d,fill:'none',stroke:color,'stroke-width':width,'stroke-linecap':'round','stroke-linejoin':'round'});if(arrow)p.setAttribute('marker-end',`url(#${S.id}-arr)`);svg.appendChild(p);return p;}
Object.assign(RENDER,{
 'packet-envelope'(tl,st){
  const svg=makeSvg(st);
  const ip=box(svg,38,5,1190,370,'#e4eee5');pop(tl,ip,.4);
  label(tl,svg,632,54,'IP 数据报 · Protocol = 89',.6,33,'#087c9b',800);
  const head=box(svg,72,90,1122,115);pop(tl,head,time('二十四',SDUR*.33));
  label(tl,svg,630,134,'OSPF 公共头 · 24 bytes',time('二十四',SDUR*.33),30,'#173b38',800);
  label(tl,svg,630,178,'Version  |  Type  |  Length  |  Router ID  |  Area ID  |  校验 / 认证',time('二十四',SDUR*.33)+.3,24);
  const body=box(svg,72,230,1122,112,'#dff2e7','#14876d');pop(tl,body,SDUR*.56);
  label(tl,svg,630,276,'报文体：随 Type = 1 / 2 / 3 / 4 / 5 改变',SDUR*.56,29,'#087c68',700);
  label(tl,svg,630,320,'Hello / DD / LSR / LSU / LSAck',SDUR*.56+.3,27);
  label(tl,svg,630,420,'这里的 Type 是报文类型；LSA 另有自己的类型字段',time('类型字段',SDUR*.75),28,'#9e4e32',700);
 },
 'message-flow'(tl,st){
  const svg=makeSvg(st);label(tl,svg,125,35,'R1',.3,32,'#173b38',800);label(tl,svg,1145,35,'R2',.3,32,'#173b38',800);
  const l=plainPath(svg,'M125 60V405','#bdcec4',3,false),r=plainPath(svg,'M1145 60V405','#bdcec4',3,false);draw(tl,l,.5);draw(tl,r,.5);
  S.rows.forEach(([a,b],i)=>{const y=115+i*128,t=i===0?1:SDUR*(i===1?.34:.63);const reverse=i===1;
   if(i===2){const g=box(svg,190,y-60,900,94,'#dff2e7','#14876d');pop(tl,g,t);label(tl,svg,640,y-23,a+' · '+b,t+.1,28,'#087c68',700);return;}
   const both=a.includes('⇄')||a==='ExStart';
   const p=plainPath(svg,reverse?`M1110 ${y}H160`:`M160 ${y}H1110`,'#087c9b',5,true);draw(tl,p,t);packet(tl,svg,p,t+.3,'#087c9b');
   if(both){const q=plainPath(svg,reverse?`M160 ${y+15}H1110`:`M1110 ${y+15}H160`,'#087c9b',4,true);draw(tl,q,t+.2);}
   label(tl,svg,635,y-44,a,t,28,'#087c9b',800);label(tl,svg,635,y-11,b,t+.12,28,'#173b38',600);
  });
 },
 'request-cards'(tl,st){
  const svg=makeSvg(st);S.fields.forEach(([a,b],i)=>{const y=12+i*132,t=i===0?.7:SDUR*(i===1?.32:.6);const g=box(svg,30,y,1195,113);g.appendChild(svgEl('rect',{x:30,y,width:315,height:113,rx:18,fill:'#dff0e4'}));
   g.appendChild(svgEl('text',{x:55,y:y+65,fill:'#087c68','font-size':28,'font-weight':800},a));
   g.appendChild(svgEl('text',{x:375,y:y+65,fill:'#173b38','font-size':28,'font-weight':600},b));pop(tl,g,t);
  });
 },
 'packet-bundle'(tl,st){
  const svg=makeSvg(st);const bag=box(svg,30,15,750,380,'#e4eee5');pop(tl,bag,.6);label(tl,svg,400,66,'LSU · 一个报文',.6,34,'#087c9b',800);
  [0,1,2].forEach(i=>{const c=box(svg,75+i*220,106,195,230);c.appendChild(svgEl('path',{d:`M${95+i*220} 140H${250+i*220}`,stroke:'#14876d','stroke-width':6}));c.appendChild(svgEl('text',{x:173+i*220,y:198,'text-anchor':'middle',fill:'#087c68','font-size':31,'font-weight':800},'LSA '+(i+1)));c.appendChild(svgEl('text',{x:173+i*220,y:258,'text-anchor':'middle',fill:'#375e57','font-size':28},'头 + 正文'));pop(tl,c,1.2+i*.7);});
  const db=box(svg,960,70,260,290,'#dff2e7','#14876d');pop(tl,db,SDUR*.48);label(tl,svg,1090,180,'LSDB',SDUR*.48,40,'#087c68',800);label(tl,svg,1090,235,'资料库',SDUR*.48+.2,30);
  const p=plainPath(svg,'M800 220H935','#14876d',6);draw(tl,p,SDUR*.57);packet(tl,svg,p,SDUR*.57+.3);
  label(tl,svg,638,426,'信封负责运输，LSA 才是描述网络的资料',SDUR*.7,28,'#087c68',700);
 },
 'packet-timeline'(tl,st){
  const svg=makeSvg(st);const items=[['Hello','认识 / 保活'],['DD','比目录'],['LSR','点名索取'],['LSU','补正文'],['LSAck','显式确认']];
  items.forEach(([a,b],i)=>{const x=120+i*250,t=.5+i*SDUR*.105;const g=node(svg,x,165,a,b,i===4?'#14876d':'#087c9b',212);pop(tl,g,t);if(i){const p=plainPath(svg,`M${x-135} 165H${x-116}`,'#6d9683',4);draw(tl,p,t+.1);}});
  const loop=plainPath(svg,'M1120 235Q1120 350 650 350H120Q45 350 70 238','#14876d',5);draw(tl,loop,SDUR*.62,1.1);
  label(tl,svg,650,310,'Full 后：Hello 持续，变化仍用 LSU / 确认传播',SDUR*.62+.5,28,'#087c68',700);
  label(tl,svg,650,418,'图示为需要完整邻接的初次同步；隐式确认未单独画出',SDUR*.75,24);
 },
 'lsa-router'(tl,st){
  const svg=makeSvg(st),a=[180,195],b=[900,70],c=[900,325];
  const na=node(svg,...a,'R1','Type-1 始发者','#173b38',245);pop(tl,na,.5);
  [[b,'R2',10],[c,'R3',30]].forEach(([p,name,cost],i)=>{const n=node(svg,...p,name,'本区域路由器','#173b38',220);pop(tl,n,1+i*.7);const q=line(svg,a,p,{color:'#087c9b',width:6,arrow:true,offset:135});draw(tl,q,1.3+i*SDUR*.23);label(tl,svg,560,i===0?82:334,'R1 → '+name+'：cost '+cost,1.3+i*SDUR*.23,29,'#087c9b',800);});
  label(tl,svg,640,420,'示例 cost 为教学设定；另一方向由另一台路由器描述',SDUR*.63,28,'#9e4e32',700);
 },
 'area-summary'(tl,st){
  const svg=makeSvg(st);const ar=box(svg,8,10,460,365,'#e4eee5');pop(tl,ar,.4);label(tl,svg,238,60,'Area 1 · 细节',.5,30,'#173b38',800);
  [[110,160],[355,145],[240,285]].forEach((p,i)=>{pop(tl,node(svg,...p,'R'+(i+1),'', '#173b38',135),.7+i*.25);});
  [[110,160,355,145],[110,160,240,285],[355,145,240,285]].forEach(p=>{const l=line(svg,p.slice(0,2),p.slice(2),{offset:72});svg.appendChild(l);draw(tl,l,1);});
  const abr=node(svg,645,195,'ABR','重新生成 Type 3','#087c9b',255);pop(tl,abr,SDUR*.28);
  const card=box(svg,850,95,390,230,'#dff2e7','#14876d');pop(tl,card,SDUR*.46);label(tl,svg,1045,154,'Type 3 · 区域间路标',SDUR*.46,28,'#087c68',800);label(tl,svg,1045,215,'10.1.0.0/16',SDUR*.46+.2,32);label(tl,svg,1045,275,'Metric = 20（示例）',SDUR*.46+.4,27);
  const p=plainPath(svg,'M493 195H502','#087c9b',4),q=plainPath(svg,'M793 195H830','#14876d',5);draw(tl,p,SDUR*.3);draw(tl,q,SDUR*.48);
  label(tl,svg,640,420,'“Summary-LSA” 是类型名；地址聚合需另行配置',SDUR*.7,28,'#9e4e32',700);
 },
 'lsa-external'(tl,st){
  const svg=makeSvg(st);const cols=[['Type 4','ASBR 在哪里？','目标：ASBR 的 Router ID'],['Type 5','外部前缀在哪儿？','目标：192.0.2.0/24']];
  cols.forEach(([a,b,c],i)=>{const x=25+i*645,t=i===0?SDUR*.3:.8;const card=box(svg,x,15,580,300,i?'#dff2e7':'#e3eef0',i?'#14876d':'#087c9b');pop(tl,card,t);label(tl,svg,x+290,80,a,t,43,i?'#087c68':'#087c9b',800);label(tl,svg,x+290,155,b,t+.2,33);label(tl,svg,x+290,240,c,t+.4,27);});
  label(tl,svg,640,390,'若 FA 非零：还要按内部路由递归到 FA',SDUR*.7,30,'#9e4e32',700);
 },
 'spf-demo'(tl,st){
  const svg=makeSvg(st),ps=[[150,230],[640,70],[1130,230]];
  const p=line(svg,ps[0],ps[1],{color:'#b2c7bd',width:4,arrow:true}),q=line(svg,ps[1],ps[2],{color:'#b2c7bd',width:4,arrow:true}),r=line(svg,ps[0],ps[2],{color:'#a5bdb1',width:4,arrow:true});
  [p,q,r].forEach((x,i)=>draw(tl,x,.6+i*.2));ps.forEach((x,i)=>pop(tl,node(svg,...x,'R'+(i+1),i===0?'当前根节点':'',i===0?'#087c9b':'#173b38',168),.4+i*.2));
  label(tl,svg,355,105,'10',.9,36,'#087c9b',800);label(tl,svg,930,105,'5',1.1,36,'#087c9b',800);label(tl,svg,640,272,'直达：30',.7,30,'#4f716b',700);
  const t=time('先到',SDUR*.3);[p,q].forEach((l,i)=>{tl.to(l,{stroke:'#14876d',strokeWidth:8,duration:.45},t+i*1.5);packet(tl,svg,l,t+.3+i*1.5);});tl.to(r,{opacity:.32,duration:.5},t+3);
  label(tl,svg,640,378,'经 R2：10 + 5 = 15 < 30',t+3,38,'#087c68',800);
  label(tl,svg,640,425,'R1 到 R3 的下一跳：R2',t+3.3,28,'#087c68',700);
 },
 'metric-compare'(tl,st){
  const svg=makeSvg(st);const headers=['出口','内部代价','外部代价','E1：相加','E2：先比外部'];const xs=[100,340,570,810,1090];
  headers.forEach((v,i)=>label(tl,svg,xs[i],50,v,.5,28,'#375e57',700));
  [['A','5','20','25 · 更优','20'],['B','30','10','40','10 · 更优']].forEach((row,i)=>{const y=120+i*120;const g=box(svg,20,y-45,1220,95,i?'#eef4e9':'#fff');pop(tl,g,.9+i*.7);row.forEach((v,j)=>label(tl,svg,xs[j],y+15,v,j<3?.9+i*.7:time(j===3?'E1':'E2',j===3?SDUR*.4:SDUR*.6),j===0?31:32,j>=3?'#087c68':'#173b38',j>=3?800:600));});
  label(tl,svg,640,370,'示例前提：同一外部前缀、同一外部类型、可达的内部路径',SDUR*.73,28,'#9e4e32',700);
  label(tl,svg,640,418,'E2 外部 cost 相同，再比较内部代价等规则',SDUR*.78,28,'#087c68',700);
 },
 'lsa-freshness'(tl,st){
  const svg=makeSvg(st);const rows=[['1','序列号','有符号数值大者更新'],['2','校验和','序列相同：校验和值大者更新'],['3','MaxAge','序列 / 校验相同：唯一 MaxAge 实例优先'],['4','Age 差','否则：差 > 900s 选年轻者；其余同实例']];
  rows.forEach(([n,a,b],i)=>{const t=.7+i*SDUR*.2,y=8+i*104,g=box(svg,28,y,1200,91,i===2?'#f5e8dc':'#fff');g.appendChild(svgEl('text',{x:55,y:y+58,fill:'#087c68','font-size':32,'font-weight':800},n+'  '+a));g.appendChild(svgEl('text',{x:340,y:y+58,fill:'#173b38','font-size':28,'font-weight':500},b));pop(tl,g,t);});
 },
 'lsa-aging'(tl,st){
  const svg=makeSvg(st);label(tl,svg,640,35,'同一实例的 LS age · 刷新产生新实例（Age 归零）',.5,28,'#375e57',700);const p=plainPath(svg,'M130 170H1120','#aec7b9',7);draw(tl,p,.7,1);
  [[140,'0','始发'],[620,'1800s','刷新 → 新实例'],[1120,'3600s','未替换时 MaxAge']].forEach(([x,a,b],i)=>{const t=.5+i*SDUR*.21;const c=svgEl('circle',{cx:x,cy:170,r:13,fill:i===2?'#b55b38':'#14876d'});svg.appendChild(c);pop(tl,c,t);label(tl,svg,x,115,a,t,38,i===2?'#9e4e32':'#087c68',800);label(tl,svg,x,225,b,t+.2,30);});
  const flush=plainPath(svg,'M280 315H1100Q1120 315 1120 195','#b96a47',5);draw(tl,flush,time('主动撤销',SDUR*.6),1);label(tl,svg,650,365,'主动撤销：设为 MaxAge，再泛洪',time('主动撤销',SDUR*.6)+.3,30,'#9e4e32',700);
  label(tl,svg,640,425,'达到 MaxAge 后，仍须满足确认 / 邻接同步等清理条件',SDUR*.78,25);
 },
 'area-backbone'(tl,st){
  const svg=makeSvg(st);const rects=[[20,'Area 1'],[475,'Area 0 · 骨干'],[930,'Area 2']];
  rects.forEach(([x,n],i)=>{const g=box(svg,x,15,325,340,i===1?'#dff2e7':'#e7ede3');pop(tl,g,.5+i*.3);label(tl,svg,x+162,80,n,.5+i*.3,31,i===1?'#087c68':'#173b38',800);});
  [[182,'R1'],[637,'核心 R'],[1092,'R2']].forEach(([x,n])=>pop(tl,node(svg,x,225,n,'区域内','#173b38',150),.9));
  const abrs=[[410,'ABR A'],[865,'ABR B']];abrs.forEach(([x,n],i)=>{const g=node(svg,x,225,n,'边界路由器','#087c9b',185);pop(tl,g,1+i*.4);});
  [[265,309],[511,554],[720,764],[966,1009]].forEach(([a,b],i)=>{const p=plainPath(svg,`M${a} 225H${b}`,'#087c9b',5);draw(tl,p,1.6+i*.35);});
  label(tl,svg,640,410,'区域内拓扑分别维护；常规区域间传播通过骨干',SDUR*.59,28,'#087c68',700);
 },
 'area-gate'(tl,st){
  const svg=makeSvg(st),m=S.mode;const modes={normal:['普通区域',[true,true,true]],stub:['Stub',[true,false,false]],total:['Totally Stub',[false,false,false]],nssa:['NSSA',[true,false,false]]};const [name,allow]=modes[m];
  const area=box(svg,780,0,465,405,'#e5efe4');pop(tl,area,.4);label(tl,svg,1013,45,name,.5,32,'#087c68',800);
  const gate=svgEl('path',{d:'M645 35V335',stroke:'#173b38','stroke-width':8,'stroke-linecap':'round'});svg.appendChild(gate);draw(tl,gate,.6);label(tl,svg,645,385,'ABR · 边界',.7,28,'#173b38',800);
  ['Type 3 · 区域间明细','Type 4 · ASBR 路标','Type 5 · 外部前缀'].forEach((n,i)=>{const y=100+i*97,t=.8+i*SDUR*.15,ok=allow[i];label(tl,svg,240,y-20,n,t,29,'#173b38',700);const p=plainPath(svg,`M75 ${y+10}H${ok?1150:606}`,ok?'#087c9b':'#b96a47',5);draw(tl,p,t+.2,.85);packet(tl,svg,p,t+.4,ok?'#087c9b':'#b96a47');
   label(tl,svg,ok?1015:700,y-9,ok?'允许':'阻挡',t+1.4,28,ok?'#087c68':'#9e4e32',800);
  });
  label(tl,svg,1014,355,m==='nssa'?'区域内 1 / 2 + 本地 7':'区域内 Type 1 / 2 保留',SDUR*.51,28,'#087c68',700);
  if(m==='stub'||m==='total')label(tl,svg,1014,397,'+ Type 3 缺省 0.0.0.0/0',SDUR*.66,28,'#087c68',800);
  if(m==='nssa')label(tl,svg,640,428,'本区 ASBR → Type 7 → 翻译 ABR → Type 5（满足条件时）',SDUR*.68,28,'#087c68',700);
  if(m==='total')label(tl,svg,640,428,'Type 3 缺省是保留的例外；Totally 为常见厂商扩展',SDUR*.73,28,'#9e4e32',700);
 },
 'area-default'(tl,st){
  const svg=makeSvg(st);const rows=[['普通 NSSA','常见 Type 7 缺省','生成条件 / 自动行为：按厂商与配置核对'],['Totally NSSA','常见 Type 3 缺省','no-summary；仍保留本区 Type 7']];
  rows.forEach(([a,b,c],i)=>{const t=i===0?.7:SDUR*.45,y=10+i*196,g=box(svg,28,y,1200,175,i?'#dff2e7':'#fff');pop(tl,g,t);label(tl,svg,260,y+67,a,t,34,'#087c68',800);label(tl,svg,850,y+64,b,t+.2,31,'#087c9b',800);label(tl,svg,640,y+137,c,t+.4,27);});
 },
 'default-forward'(tl,st){
  const svg=makeSvg(st);const r=box(svg,30,8,1200,144);pop(tl,r,.4);label(tl,svg,630,59,'路由表（示例）',.5,29,'#173b38',800);label(tl,svg,630,108,'10.1.0.0/16 → 区域内路径     0.0.0.0/0 → ABR',.7,29);
  const branch=node(svg,215,295,'分支 R1','做最长前缀匹配','#173b38',255);pop(tl,branch,1);
  const local=node(svg,1070,230,'本区域','10.1.2.3','#14876d',225),abr=node(svg,1070,375,'ABR','其他无明细的目的','#087c9b',225);
  pop(tl,local,time('十点一',SDUR*.26));pop(tl,abr,time('如果没有',SDUR*.53));
  const p=line(svg,[215,295],[1070,230],{color:'#14876d',width:7,arrow:true,offset:140});draw(tl,p,time('十点一',SDUR*.26));packet(tl,svg,p,time('十点一',SDUR*.26)+.4);
  const q=line(svg,[215,295],[1070,375],{color:'#087c9b',width:7,arrow:true,offset:140});draw(tl,q,time('如果没有',SDUR*.53));packet(tl,svg,q,time('如果没有',SDUR*.53)+.4,'#087c9b');
  label(tl,svg,640,229,'具体前缀优先匹配',time('十点一',SDUR*.26),28,'#087c68',700);label(tl,svg,640,411,'无更具体匹配，才用 /0',time('如果没有',SDUR*.53),28,'#087c9b',700);
 }
});
Object.assign(RENDER,{
 'nssa-translation'(tl,st){const svg=makeSvg(st);const ps=[[180,190],[640,190],[1100,190]],names=['NSSA ASBR','翻译 ABR','其他允许区域'],subs=['区域内：Type 7','满足条件 → Type 5','接收 Type 5'];ps.forEach((p,i)=>pop(tl,node(svg,...p,names[i],subs[i],i===1?'#087c9b':'#173b38',280),.5+i*SDUR*.16));[[0,1],[1,2]].forEach(([a,b],i)=>{const p=line(svg,ps[a],ps[b],{color:'#087c9b',width:6,arrow:true,offset:160});draw(tl,p,1.3+i*SDUR*.28);packet(tl,svg,p,1.6+i*SDUR*.28,'#087c9b');});label(tl,svg,640,330,'Type 7 本身不跨区域；翻译者生成新的 Type 5',SDUR*.56,29,'#087c68',700);label(tl,svg,640,400,'检查 P-bit、FA、翻译者、选路及聚合等条件',SDUR*.73,28,'#9e4e32',700);}
});

Object.assign(RENDER,{'lsa-pseudonode'(tl,st){
 const svg=makeSvg(st);svg.querySelector('marker').setAttribute('orient','auto-start-reverse');
 const net=node(svg,640,90,'共享网段','Type-2 LSA','#087c9b',300);pop(tl,net,.5);
 const ps=[[190,300],[640,330],[1090,300]],ports=[[190,258,520,132],[640,288,640,132],[1090,258,760,132]];
 ps.forEach((p,i)=>{pop(tl,node(svg,...p,['R1','R3','R4'][i],'SPF 路由器顶点','#173b38',270),.7+i*.4);const v=ports[i];const q=plainPath(svg,`M${v[0]} ${v[1]}L${v[2]} ${v[3]}`,'#087c9b',4);q.setAttribute('marker-start',`url(#${S.id}-arr)`);draw(tl,q,1+i*.7);});
 label(tl,svg,225,65,'路由器 → 网段',.8,28);label(tl,svg,225,110,'接口 cost',1,32,'#087c9b',800);
 label(tl,svg,1055,65,'网段 → 路由器',1.2,28);label(tl,svg,1055,110,'cost = 0',1.4,32,'#087c9b',800);
 label(tl,svg,640,424,'DR 生成 Network-LSA；伪节点不表示实际数据绕行',SDUR*.58,28,'#087c68',700);
}});
