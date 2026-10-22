import json,re,pathlib,subprocess,difflib,sys,shutil
BASE=pathlib.Path(__file__).resolve().parents[2]
FONT='<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
PUN=r'[，。！？；：、,.!?;:\s“”"\'（）()—…\-/·↔→<>《》]'
clean=lambda s:re.sub(PUN,'',s)
def duration(p):return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p)]))
def align(rec):
 d=clean(rec['text']);w='';times=[]
 for word in rec['words']:
  for c in clean(word['text']):w+=c;times.append((word['start'],word['end']))
 mapping={}
 for a,b,n in difflib.SequenceMatcher(None,d.lower(),w.lower(),autojunk=False).get_matching_blocks():
  for k in range(n):mapping[a+k]=b+k
 known=sorted(mapping); result=[]
 for i in range(len(d)):
  if i in mapping: result.append(times[mapping[i]]);continue
  lo=max((k for k in known if k<i),default=known[0]);hi=min((k for k in known if k>i),default=known[-1])
  start=times[mapping[lo]][0]+(times[mapping[hi]][0]-times[mapping[lo]][0])*(i-lo)/max(1,hi-lo)
  result.append((start,start+.08))
 return d,result

def captions(text,times,offset):
 clauses=re.findall(r'[^，。！？；：]+[，。！？；：]?',text); out=[];cur=''
 for c in clauses:
  if cur and (len(clean(cur+c))>21 or cur[-1] in '。！？'):out.append(cur);cur=c
  else:cur+=c
 if cur:out.append(cur)
 result=[];pos=0
 for c in out:
  n=len(clean(c))
  if not n:continue
  a=times[min(pos,len(times)-1)][0]; b=times[min(pos+n-1,len(times)-1)][1];pos+=n
  result.append(dict(text=c.strip().rstrip('，。；：'),start=round(a+offset,3),end=round(b+offset,3)))
 return result

def build(note):
 spec=json.loads((BASE/f'scripts/notes/{note}.json').read_text()); recs={r['id']:r for r in json.loads((BASE/f'assets/voice/{note}/words.json').read_text())}
 out=BASE/'episodes'/note; (out/'compositions').mkdir(parents=True,exist_ok=True);(out/'assets').mkdir(exist_ok=True)
 css=(BASE/'scripts/v2/classroom.css').read_text()
 if int(spec.get('chapter','0'))>=3:css+='\n.guide{font-size:26px}.guide b{font-size:26px}.tag-strip span{font-size:28px}'
 lib=(BASE/'scripts/v2/mascot.js').read_text()+'\n'+(BASE/'scripts/v2/classroom.js').read_text()+'\n'+(BASE/'scripts/v2/lessons.js').read_text()
 cues=['今天','第一','第二','第三','发布者','为零','非零','不用','优先级为零','相同','新设备','点六','点五','直接','故障','接任','下一跳','于是包','先发给','递归','目的前缀','Advertising Router','Forwarding Address','区域内','不能','五类','保留下来','伪节点','Two Way','另一个']
 starts=[]; scenes=[]; caps=[]; voice=[]; t=0
 chapter=spec.get('chapter','01' if note=='ospf-dr-bdr' else '02')
 cues += ['答案','先看信封','二十四','类型字段','请求项','一个更新','网络变化','先比较','最大老化','三十分钟','一小时','主动撤销','先到','十五','E1','E2','三类','五类','七类','区域零','区域一','区域二','十点一','如果没有','先问','第二','第三']
 for i,seg in enumerate(spec['segments']):
  rec=recs[seg['id']]; assert rec['text']==seg['say'],'Stale narration'
  d=duration(BASE/f'assets/voice/{note}/{seg["id"]}.mp3');sd=round(d+1.45+(1.4 if i==len(spec['segments'])-1 else 0),3)
  chars,times=align(rec); S=dict(seg,chapter=chapter,sceneNo=i+1,sceneCount=len(spec['segments']),cueTimes={q:round(times[chars.index(clean(q))][0]+.55,3) for q in cues if clean(q) in chars})
  S['sourceLabel']=spec.get('sourceLabel')
  S['talk']=[{'s':w['start']+.55,'e':w['end']+.55} for w in rec['words'][::2]]
  S['guide']=seg.get('guide') or { 'dr-network':'现在看：'+{'mesh':'假设全互联邻接图','adjacency':'实际完整邻接图','pseudo':'SPF 拓扑图','data':'实际数据转发图','flood':'典型控制消息路径','late':'已有角色下新设备加入','failover':'故障后的角色变化'}.get(S.get('mode'),'角色图'),'fa-network':'蓝色：路由通告。\n绿色：业务流量。\n分别观察两种方向。','hook':'先提出问题，\n再用动画找证据。','recap':'用自己的话，\n讲给另一位同学听。'}.get(seg['kind'],'先核对条件，\n再观察箭头与结论。')
  cid=f'{note}-{seg["id"]}'
  html=f'''<!doctype html><html><head><meta charset="utf-8"></head><body><template>{FONT}<style>{css}</style><div id="root" data-composition-id="{cid}" data-width="1920" data-height="1080"><div class="paper"></div><div class="wash" data-layout-allow-overflow></div><div class="stage"></div></div><script>(function(){{{lib}\nconst S={json.dumps(S,ensure_ascii=False)};const SDUR={sd};const tl=gsap.timeline({{paused:true}});build(tl,document.querySelector('[data-composition-id="{cid}"]'));window.__timelines['{cid}']=tl;}})();</script></template></body></html>'''
  (out/f'compositions/{seg["id"]}.html').write_text(html)
  scenes.append(dict(id=seg['id'],title=seg['title'],start=round(t,3),duration=sd,mid=round(t+sd*.52,3)))
  starts.append(f'<div id="{cid}-host" class="clip" data-composition-id="{cid}" data-composition-src="compositions/{seg["id"]}.html" data-start="{round(t,3)}" data-duration="{sd}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
  caps.extend(captions(seg['say'],times,t+.55));voice.append(dict(file=f'assets/voice/{note}/{seg["id"]}.mp3',start=round(t+.55,3),duration=d));t+=sd
 total=round(t,3)
 caphtml='';capjs=''
 for i,c in enumerate(caps):
  end=min(c['end']+.10,caps[i+1]['start']-.04 if i+1<len(caps) else total-.5)
  caphtml+=f'<div id="cap-{note}-{i}" class="cap-line">{c["text"]}</div>'
  capjs+=f'tl.fromTo("#cap-{note}-{i}",{{opacity:0}},{{opacity:1,duration:.1}},{c["start"]});tl.set("#cap-{note}-{i}",{{opacity:0}},{max(c["start"]+.15,end)});'
 capcid=note+'-captions'
 (out/'compositions/captions.html').write_text(f'''<template>{FONT}<style>{css}</style><div id="root" data-composition-id="{capcid}" data-width="1920" data-height="1080">{caphtml}</div><script>(function(){{const tl=gsap.timeline({{paused:true}});{capjs}window.__timelines['{capcid}']=tl;}})();</script></template>''')
 html=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080">{FONT}<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><style>html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:#f5f5ed}}#root{{position:relative;width:100%;height:100%;overflow:hidden}}#root>div[data-composition-src]{{position:absolute;inset:0}}.caption-host{{z-index:20;pointer-events:none}}</style></head><body><div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="{total}">{''.join(starts)}<div id="{capcid}-host" class="clip caption-host" data-composition-id="{capcid}" data-composition-src="compositions/captions.html" data-start="0" data-duration="{total}" data-track-index="2" data-track-kind="captions" data-width="1920" data-height="1080"></div><audio id="{note}-master" src="assets/master.mp3" data-start="0" data-duration="{total}" data-track-index="3" data-volume="1"></audio></div><script>window.__timelines['main']=gsap.timeline({{paused:true}});</script></body></html>'''
 (out/'index.html').write_text(html)
 (out/'hyperframes.json').write_text(json.dumps({'paths':{'assets':'assets','blocks':'compositions','components':'compositions/components'},'media':{'autoProxy':True}},indent=2))
 (out/'package.json').write_text(json.dumps({'private':True,'scripts':{name:f'npx --yes hyperframes@0.8.185 {command}' for name,command in [('check','check'),('render','render'),('dev','preview')]}},indent=2))
 (out/'timing.json').write_text(json.dumps(dict(note=note,duration=total,scenes=scenes,voice=voice,captions=caps),ensure_ascii=False,indent=2))
 (out/'.gitignore').write_text('.hyperframes/\n.media/\nassets/\nrenders/\n')
 print(note,total,'seconds',len(caps),'captions')
for note in sys.argv[1:]:build(note)
