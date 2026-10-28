import json,pathlib,shutil,re,math,html,sys,os
B=pathlib.Path(__file__).resolve().parents[1];W=pathlib.Path(os.environ.get('VIDEO_WORK_DIR','/Volumes/256G/DragonVideoWork/feature-guides-20261028'));key=sys.argv[1];P=W/key
spec=json.loads((B/'specs'/f'{key}.json').read_text());voice=json.loads((P/'voice.json').read_text());css=(B/'scripts/design.css').read_text();esc=html.escape
(P/'compositions').mkdir(exist_ok=True);(P/'assets').mkdir(exist_ok=True)
for name in ['gsap.min.js']:
 src=W/'common'/name
 if not src.exists():src=B/key/'assets'/name
 shutil.copy2(src,P/'assets'/name)
font=W/'common/GuideSans.ttf'
if not font.exists():font=B/key/'assets/NotoSansSC.ttf'
shutil.copy2(font,P/'assets/NotoSansSC.ttf')
ui={'ai-monthly-guide':'ai-monthly.jpg','welink-cli-guide':'welink-cli.png','welink-sdk-guide':'welink-sdk.png','digital-human-guide':'digital-human.png'}[key];shutil.copy2(W/'ui'/ui if (W/'ui'/ui).exists() else B/key/'assets'/ui,P/'assets'/ui)
if key=='digital-human-guide':shutil.copy2(W/'ui/netcare-explorer.png' if (W/'ui/netcare-explorer.png').exists() else B/key/'assets/netcare-explorer.png',P/'assets/netcare-explorer.png')
for name in ['xiaolong-teach.png','xiaolong-listen.png']:shutil.copy2(B/'assets'/name,P/'assets'/name)
svgrobot='<img id="xiaolong-rest" src="assets/xiaolong-listen.png" alt="小龙"><img id="xiaolong-teach" src="assets/xiaolong-teach.png" alt="小龙讲解" style="opacity:0">'
def node(x,y,w,h,title,sub='',tone=''):
 return f'<g class="reveal"><rect class="node {tone}" x="{x}" y="{y}" width="{w}" height="{h}" rx="18"/><text x="{x+30}" y="{y+58}">{esc(title)}</text><text class="caption" x="{x+30}" y="{y+109}">{esc(sub)}</text></g>'
def svg(body):return '<svg class="flow" viewBox="0 0 1612 535" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="'+spec['accent']+'"/></marker></defs>'+body+'</svg>'
def chart(s):
 if key=='ai-monthly-guide':names=['高','中','低'];values=[1,2,2];unit='条';heading='整改详单 · 合计 5 条';rows=['R-01　高','R-02　中','R-03　中','R-04　低','R-05　低'];maxv=2
 else:names=['客户群 A','客户群 B','客户群 C'];values=[72,81,86];unit='%';heading='未达标指标 · 示例目标 90%';rows=['A：先查差距最大的指标','B：追问整改进展','C：核对更新时间'];maxv=100
 g=f'<text x="55" y="38" font-weight="700">{heading}</text><path d="M65 425H915" stroke="#9eb1c1" stroke-width="3"/>'
 for i,(n,v) in enumerate(zip(names,values)):
  x=125+i*260;h=v/maxv*270
  g+=f'<g class="reveal"><rect class="bar ink" x="{x}" y="{425-h}" width="135" height="{h}" rx="9"/><text class="count" x="{x+67}" y="{405-h}" text-anchor="middle">{v}{unit}</text><text x="{x+67}" y="475" text-anchor="middle">{n}</text></g>'
 g+='<g class="reveal"><rect x="1025" y="50" width="500" height="430" rx="18" fill="#fff" stroke="#c9d6e2" stroke-width="3"/><text x="1065" y="110" font-weight="700">回到明细，核对依据</text>'
 for i,r in enumerate(rows):g+=f'<text class="caption" x="1065" y="{172+i*55}">{r}</text>'
 return svg(g+'</g>')
def visual(s):
 v=s['visual'];a=s['labels']
 if v=='pain':
  papers=''.join(f'<div class="paper reveal" style="left:{80+i*265}px;top:{125-35*(i%2)}px;width:350px;height:330px"><h3>{esc(t)}</h3><div class="line ink"></div><div class="line"></div><div class="line" style="width:75%"></div></div>' for i,t in enumerate(a))
  return papers+'<div class="question reveal">?</div><div class="note">反复找、反复做，真正要解决的问题还没开始</div>'
 if v=='screen' or v=='catalog':
  image='netcare-explorer.png' if v=='catalog' else ui
  extra={'ai-monthly-guide':['先定月份','把任务分成小格','先验证，再复用'],'welink-cli-guide':['本人身份授权','默认租户管理员','先从只读开始'],'welink-sdk-guide':['平台环境要连通','选择可用模型','确认连接状态'],'digital-human-guide':['先检查哪一步失败','不用猜连接结果','内网环境实测']}[key]
  if v=='catalog':extra=['先看业务含义与粒度','检查时间、区域与占位值','核对后再统计']
  calls=''.join(f'<div class="callout reveal">{i+1}　{esc(x)}<small>{extra[i]}</small></div>' for i,x in enumerate(a))
  return f'<div class="screenlabel">产品界面 · 本地演示配置 / 公开说明截图</div><div class="screenbox"><img id="product-screen" src="assets/{image}"></div><div class="callouts">{calls}</div>'
 if v=='prompt':
  lines={'ai-monthly-guide':'统计本月整改详单<br>按 <span class="promptkey">严重级别</span> 分组<br>生成 <span class="promptkey">柱状图 ＋ 明细表</span>','welink-cli-guide':'<span class="promptkey">@welink-office</span><br>查今天的会议<br>列出我要准备的议题和材料','digital-human-guide':'<span class="promptkey">@netcare-data</span><br>先找风险相关表，解释日期字段<br>再统计本月分区域的记录数'}[key]
  return f'<div class="stepmark">示例提问 · 先把事情说清楚</div><div class="promptbox reveal">{lines}</div><div class="chips">'+''.join(f'<span class="reveal">{esc(x)}</span>' for x in a)+'</div>'
 if v=='chart':return chart(s)
 if v=='rewrite':return '<div class="resultbox"><div class="stepmark">最终提示词 · 要求看得见</div><p class="reveal">数据来源：本月整改详单</p><p class="reveal">计算口径：按严重级别计数</p><p id="old-rule" class="reveal">展示范围：全部级别</p><p id="new-rule" style="color:var(--accent);opacity:0">展示范围：优先看高风险</p><div class="stamp reveal">可撤回 ↶</div></div>'
 if v=='month':return svg(node(80,85,420,280,'本月 / 09','整改详单：5 条')+'<path class="connector" d="M550 225H790"/><text x="550" y="180" class="caption">同一配方</text>'+node(850,85,600,280,'下月 / 10','读取下月数据，重新计算','mint')+'<text class="caption" x="110" y="465">示例演示：复用规则，不复制上月结果</text>')
 if v=='export':return svg(node(70,90,570,300,'已核对的月报','章节 / 图表 / 明细 / 总结')+'<path class="connector" d="M690 250H920"/>'+node(980,15,500,140,'HTML','可交互查看')+node(980,185,500,140,'PDF','便于阅读归档')+node(980,355,500,140,'MSG','邮件文件'))
 if v=='identity':return svg(node(100,70,510,340,'你本人的 WeLink','本人已有的账号权限','mint')+'<path class="connector" d="M660 245H870"/>'+node(920,70,580,340,'电脑上的 Dragon Claw','CLI 执行已支持的办公操作')+'<text class="caption" x="115" y="488">与 SDK 机器人通道不同：这里使用个人身份</text>')
 if v=='flow':
  labels=a
  return svg(node(80,50,460,160,labels[0],'问题从这里开始')+'<path class="connector" d="M590 130H960"/>'+node(1010,50,510,160,labels[1],'按当前授权范围处理')+'<path class="connector" d="M1250 255V310H420V255"/>'+node(470,330,720,160,labels[2],'拿到依据，再回答问题','mint'))
 if v=='collect':return svg(node(80,25,530,150,a[0],'时间、议题、材料')+node(80,260,530,150,a[1],'主题、正文、附件')+'<path class="branch" d="M660 100H850V335H660"/><path class="connector" d="M850 225H980"/>'+node(1030,125,480,270,a[2],'回到一次真实的会议准备','mint'))
 if v=='approval':return '<div class="resultbox"><div class="stepmark">示意流程 · 不会真实发送</div><p class="reveal">对象：已核对的会议参与人</p><p class="reveal">内容：已核对的通知与材料</p><p class="reveal">时间：已核对的会议时间</p><p class="reveal accent" style="font-weight:800">等你在审批卡点击「允许」</p><div class="stamp reveal">先确认</div></div>'
 if v=='audit':return svg(node(90,35,620,165,'执行返回','是否成功，先看结果')+'<path class="connector" d="M400 240V300"/>'+node(90,340,620,155,'执行日志','检查对象、参数与异常')+node(950,160,570,220,'登录过期？','回个人身份卡片重新登录','warn'))
 if v=='access':return svg(node(80,100,480,310,'测试用户 / 测试群','先做小范围验证')+'<path class="connector" d="M610 255H880"/>'+node(930,100,600,310,'访问名单','人员与群组分别设置','mint')+'<text class="caption" x="125" y="485">按租户隔离 · 逐步开放使用范围</text>')
 if v=='phone':return '<div class="phone"><div class="phone-head">WeLink 运营助手</div><div class="bubble reveal">本月哪些客户群指标<br>未达标？按差距排序。</div><div class="bubble reply reveal">先看差距最大的对象<br>再追问风险与进展</div></div><div class="dialogtext"><div class="headline">一句话里，带上范围</div><p class="reveal accent">月份　＋　对象　＋　要求</p><p class="reveal">先看全局短板<br>再追问具体对象</p><div class="subline">概念示意 · 非真实手机聊天截图</div></div>'
 if v=='query':return svg(node(60,20,700,150,'先核对字段','日期 / 区域 / 数据粒度')+'<path class="connector" d="M400 215V290"/>'+node(60,335,700,160,'再筛选与聚合','处理占位值与重复分区','mint')+node(990,145,530,230,'最后回看记录','能跑出来 ≠ 口径正确','warn'))
 if v=='boundary':return svg(node(80,50,680,360,a[0],a[1],'mint')+node(860,50,660,360,a[2],'按页面提示与权限使用','warn')+'<text class="caption" x="105" y="485">能力边界依据当前代码与产品说明，后续以实际页面为准</text>')
 if v=='end':return f'<div class="endline reveal">{esc(a[1])}</div><div class="endpath reveal"><b>{esc(a[0])}</b><br>{esc(a[2])}<br><span class="subline">{esc(spec["entry"])}</span></div>'
 raise ValueError(v)

def captions(rec):
 clean=lambda t:re.sub(r'[\W_]+','',t,flags=re.U)
 chars=[]
 for w in rec['words']:
  cs=clean(w['text']);
  for i,c in enumerate(cs):chars.append((w['start']+(w['end']-w['start'])*i/max(1,len(cs)),w['start']+(w['end']-w['start'])*(i+1)/max(1,len(cs))))
 chunks=[];cur=''
 for part in re.findall(r'[^，。！？；：]+[，。！？；：]?',rec['text']):
  while len(part)>23:
   if cur:chunks.append(cur);cur=''
   cut=part.rfind('、',0,21)
   if cut<8:cut=20
   chunks.append(part[:cut]);part=part[cut:]
  if cur and len(cur+part)>22:chunks.append(cur);cur=''
  cur+=part
 if cur:chunks.append(cur)
 pos=0;out=[]
 for c in chunks:
  n=len(clean(c));a=min(pos,len(chars)-1);b=min(pos+n-1,len(chars)-1);pos+=n
  out.append(dict(text=c.rstrip('，。；：'),start=round(chars[a][0]+.35,3),end=round(chars[b][1]+.35+.12,3)))
 return out

start=0;timing=[];hosts='';caps=''
for i,(s,rec) in enumerate(zip(spec['scenes'],voice)):
 d=math.ceil((rec['audioDuration']+(.9 if i<7 else 2.4))*30)/30;sid=f'{key}-{s["id"]}';content=visual(s);beats=[round(1+(d-3)*x,2) for x in [.1,.35,.62]]
 # Spread reveals across the narration, so each new concept arrives with the explanation.
 js=f'''const tl=gsap.timeline({{paused:true}});const parts=Array.from(document.querySelectorAll('#root .reveal'));parts.forEach((el,i)=>{{let at=i===0?0.1:Math.min({d-3},1+i*{max(1.2,(d-4)/max(1,content.count('reveal'))):.3f});tl.fromTo(el,{{opacity:0,y:14}},{{opacity:1,y:0,duration:.42,ease:'power2.out'}},at);}});'''
 if i==0:js=js.replace('i===0?0.1','i===0?0')
 if s['visual']=='screen' or s['visual']=='catalog':
  if key=='ai-monthly-guide':js+=f"tl.fromTo('#product-screen',{{scale:2.25,x:-60,y:0}},{{scale:2.25,x:-60,y:0,duration:.01}},0);tl.to('#product-screen',{{scale:1.8,x:-80,y:-920,duration:1.2,ease:'power2.inOut'}},{d*.46:.2f});"
  else:js+=f"tl.fromTo('#product-screen',{{y:0}},{{y:-105,duration:1.1,ease:'power2.inOut'}},{d*.55:.2f});"
 if s['visual']=='chart':js+="tl.fromTo('.flow > g:last-of-type',{opacity:0,y:14},{opacity:1,y:0,duration:.42},5.5);"
 if s['visual']=='rewrite':js+=f"tl.to('#old-rule',{{opacity:.25,duration:.3}},{d*.56:.2f});tl.to('#new-rule',{{opacity:1,duration:.35}},{d*.59:.2f});"
 # One explanatory gesture at a named beat, rather than a decorative float loop.
 js+=f"tl.to('#xiaolong-rest',{{opacity:0,duration:.2}},{min(3,d/3):.2f});tl.to('#xiaolong-teach',{{opacity:1,duration:.2}},{min(3,d/3):.2f});tl.fromTo('.robot',{{rotation:0,transformOrigin:'50% 100%'}},{{rotation:-3,duration:.4,repeat:1,yoyo:true,ease:'sine.inOut'}},{min(4,d/3):.2f});"

 js+=f"window.__timelines['{sid}']=tl;"
 label='示例数据 · 非真实业务结果' if s['visual'] in ['chart','query','month','approval','phone','collect','prompt'] else '依据当前平台代码与功能说明制作'
 scene=f'''<template><style>{css}</style><div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080" style="--accent:{spec['accent']}"><div class="top">{spec['short']} · 从一个真实任务开始</div><div class="chapter">{i+1} / 8</div><h1 class="title">{esc(s['title'])}</h1><div class="stage">{content}</div><div class="robot" data-layout-ignore>{svgrobot}</div><div class="foot">{label}</div></div><script>{js}</script></template>'''
 (P/'compositions'/f'{s["id"]}.html').write_text(scene)
 hosts+=f'<div id="{sid}" class="clip" data-composition-id="{sid}" data-composition-src="compositions/{s["id"]}.html" data-start="{start:.3f}" data-duration="{d:.3f}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>'
 for j,c in enumerate(captions(rec)):
  length=max(.2,c['end']-c['start']);caps+=f'<div id="cap-{i}-{j}" class="clip caption" data-start="{start+c["start"]:.3f}" data-duration="{length:.3f}" data-track-index="2"><span>{esc(c["text"])}</span></div>'
 timing.append(dict(id=s['id'],start=round(start,3),duration=round(d,3),audio=rec['audioDuration'],title=s['title']));start+=d
caption_style="@font-face{font-family:GuideSans;src:url('assets/NotoSansSC.ttf')}#root{position:absolute;inset:0;pointer-events:none}.caption{position:absolute;left:165px;right:165px;top:899px;height:92px;display:flex;align-items:center;justify-content:center;z-index:30;font:500 42px/1.45 GuideSans;color:#fff}.caption span{background:#183047;padding:10px 28px;border-radius:12px;text-align:center}"
(P/'compositions/captions.html').write_text(f'<template><style>{caption_style}</style><div id="root" data-composition-id="captions" data-width="1920" data-height="1080">{caps}</div><script>window.__timelines.captions=gsap.timeline({{paused:true}});</script></template>')
caps=f'<div id="captions" class="clip" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="{start:.3f}" data-track-index="2" data-track-kind="captions" data-width="1920" data-height="1080" style="z-index:30;pointer-events:none"></div>'
root=f'''<!doctype html><html lang="zh-CN" data-composition-variables='[{{"id":"series","type":"string","label":"系列","default":"Dragon 平台功能指南"}}]'><head><meta charset="UTF-8"><script src="assets/gsap.min.js"></script><style>@font-face{{font-family:GuideSans;src:url('assets/NotoSansSC.ttf')}}html,body{{margin:0;width:1920px;height:1080px;background:#f2f5f8;overflow:hidden}}#root{{position:relative;width:1920px;height:1080px;overflow:hidden}}#root>div[data-composition-src]{{position:absolute;inset:0}}.caption{{position:absolute;left:165px;right:165px;top:899px;height:92px;display:flex;align-items:center;justify-content:center;z-index:30;font:500 42px/1.45 GuideSans;color:#fff}}.caption span{{background:#183047;padding:10px 28px;border-radius:12px;text-align:center}}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="{start:.3f}" data-width="1920" data-height="1080">{hosts}{caps}<audio id="master" src="assets/master.mp3" data-start="0" data-duration="{start:.3f}" data-track-index="3"></audio></div><script>window.__timelines=window.__timelines||{{}};window.__timelines.main=gsap.timeline({{paused:true}});</script></body></html>'''
(P/'index.html').write_text(root);(P/'timing.json').write_text(json.dumps(dict(duration=round(start,3),scenes=timing),ensure_ascii=False,indent=2));(P/'hyperframes.json').write_text(json.dumps({'paths':{'assets':'assets','blocks':'compositions','components':'compositions/components'},'media':{'autoProxy':False}}));(P/'package.json').write_text(json.dumps({'private':True,'scripts':{'check':'npx --yes hyperframes@0.8.186 check','render':'npx --yes hyperframes@0.8.186 render','dev':'npx --yes hyperframes@0.8.186 preview'}}))
print(key,'built',round(start,1),'seconds',flush=True)
