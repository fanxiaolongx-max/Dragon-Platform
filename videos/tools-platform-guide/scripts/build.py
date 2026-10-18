import json,re,subprocess,os
LEAD=0.4; TAIL=0.7
words=json.load(open('assets/voice/words.json',encoding='utf8'))
css=open('scripts/shared.css',encoding='utf8').read()
lib=open('scripts/lib.js',encoding='utf8').read()+'\n'+open('scripts/dino2.js',encoding='utf8').read()
def dur(f):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).decode())
PUN=r'[，。！？；：、,.!?;:\s“”"\'（）()—…]'
def clauses(text):
    parts=re.findall(r'[^，。！？；：]+[，。！？；：]?',text)
    out=[];cur=''
    for p in parts:
        if cur and len(re.sub(PUN,'',cur+p))>16:
            out.append(cur);cur=p
        else: cur+=p
    if cur: out.append(cur)
    return out
def caps(sc):
    toks=sc['words']; chars=[]
    for t in toks:
        for ch in re.sub(PUN,'',t['text']): chars.append((t['start'],t['end']))
    res=[];pos=0
    for c in clauses(sc['text']):
        n=len(re.sub(PUN,'',c))
        if n==0: continue
        a=min(pos,len(chars)-1); b=min(pos+n-1,len(chars)-1)
        res.append({'t':re.sub(r'[，、；：]+$','',c.strip()).rstrip('。').strip(),'s':round(chars[a][0],2),'e':round(chars[b][1],2)})
        pos+=n
    return res
def findT(sc,kw,nth=0):
    C=''
    for w in sc['words']:
        for ch in w['text']:
            if not ch.isspace(): C+=ch
    kw=re.sub(r'\s+','',kw); p=-1; start=0
    for _ in range(nth+1):
        p=C.find(kw,start)
        if p<0: return None
        start=p+1
    return p
early=[]
bad=[]
for i,sc in enumerate(words):
    f=f'src/s{i+1}.html'
    if not os.path.exists(f): continue
    for m in re.finditer(r'T\("([^"]+)"(?:,(\d+))?\)',open(f,encoding='utf8').read()):
        pos=findT(sc,m.group(1),int(m.group(2) or 0))
        if pos is None: bad.append((f,m.group(1)))
        elif sc.get('why') and pos<sc['why']['chars']: early.append((f,m.group(1)))
if bad:
    print('MISSING T() keywords:',bad); raise SystemExit(1)
if early:
    print('KEYWORDS INSIDE WHY SENTENCE:',early); raise SystemExit(1)
D=[];ST=[];t=0
for i,sc in enumerate(words):
    d=dur(f"assets/voice/{sc['id']}.mp3"); D.append(round(d+LEAD+(2.4 if i==len(words)-1 else TAIL),2)); ST.append(round(t,2)); t+=D[-1]
total=round(t,2)
for i,sc in enumerate(words):
    n=i+1
    if not os.path.exists(f'src/s{n}.html'): continue
    s=open(f'src/s{n}.html',encoding='utf8').read()
    data='var SDUR=%s;var WHY=%s;var W=%s;var CAPS=%s;var LEAD=%s;'%(D[i],json.dumps({k:v for k,v in sc['why'].items() if k!='chars'},ensure_ascii=False) if sc.get('why') else 'null',json.dumps([{'t':w['text'],'s':round(w['start'],2),'e':round(w['end'],2)} for w in sc['words']],ensure_ascii=False),json.dumps(caps(sc),ensure_ascii=False),LEAD)
    s=s.replace('<template>','<template><link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Long+Cang&display=swap" rel="stylesheet">',1).replace('/*SHARED*/',css).replace('//LIB',lib).replace('//DATA',data).replace('WOBID',f'wob{n}')
    open(f'compositions/frames/s{n}.html','w',encoding='utf8').write(s)
slots=''
for i,sc in enumerate(words):
    n=i+1
    if not os.path.exists(f'src/s{n}.html'): continue
    slots+=f'  <div id="el-s{n}" data-composition-id="s{n}" data-composition-src="compositions/frames/s{n}.html" data-start="{ST[i]}" data-duration="{D[i]}" data-track-index="1" data-width="1920" data-height="1080"></div>\n'
    slots+=f'  <audio id="el-s{n}-voice" src="assets/voice/{sc["id"]}.mp3" data-start="{round(ST[i]+LEAD,2)}" data-duration="{round(dur("assets/voice/%s.mp3"%sc["id"]),2)}" data-track-index="{10+i}" data-volume="1"></audio>\n'
COLS=['#ffb3c6','#aed8f2','#ffe08f','#9fe0c9','#d9c6ef','#ffc29a','#fffdf8']
CEN=[(240,200),(960,140),(1680,220),(300,880),(980,960),(1660,860),(960,540)]
trans='';tjs=''
bounds=[0.0]+[ST[i] for i in range(1,len(ST))]
for k,t in enumerate(bounds):
    s0=max(0,t-0.55); dur=round((t+0.62)-s0,2)
    circ=''.join(f'<i id="tr{k}c{j}" style="left:{cx-640}px;top:{cy-640}px;background:{COLS[(j+k)%len(COLS)]}"></i>' for j,(cx,cy) in enumerate(CEN))
    trans+=f'  <div id="tr{k}" class="clip trn" data-start="{round(s0,2)}" data-duration="{dur}" data-track-index="{40+k%2}">{circ}<b id="tr{k}s"></b></div>\n'
    sel=','.join(f'#tr{k}c{j}' for j in range(len(CEN)))
    if k==0:
        tjs+=f'gsap.set("{sel}",{{scale:1}});tl.to("{sel}",{{scale:0,duration:.55,stagger:.045,ease:"sine.inOut"}},0.05);tl.fromTo("#tr{k}s",{{scale:1,rotation:0}},{{scale:0,rotation:90,duration:.4,ease:"back.in(1.6)"}},0);\n'
    else:
        tjs+=f'tl.fromTo("{sel}",{{scale:0}},{{scale:1,duration:.5,stagger:.04,ease:"sine.inOut"}},{round(s0,2)});tl.to("{sel}",{{scale:0,duration:.52,stagger:.04,ease:"sine.inOut"}},{round(t+0.05,2)});'
        tjs+=f'tl.fromTo("#tr{k}s",{{scale:0,rotation:-90}},{{scale:1,rotation:0,duration:.4,ease:"back.out(2)"}},{round(t-0.3,2)});tl.to("#tr{k}s",{{scale:0,rotation:90,duration:.35,ease:"back.in(1.6)"}},{round(t+0.12,2)});\n'
html=f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Long+Cang&display=swap" rel="stylesheet">
<style>*{{margin:0;padding:0;box-sizing:border-box}}html,body{{width:1920px;height:1080px;overflow:hidden;background:#fbf3e4}}
#root{{position:relative;width:100%;height:100%;background:#fbf3e4;overflow:hidden}}
#root>div[data-composition-src]{{position:absolute;inset:0}}
.trn{{position:absolute;inset:0;z-index:100;pointer-events:none;overflow:hidden}}.trn i{{position:absolute;width:1280px;height:1280px;border-radius:50%;transform:scale(0)}}.trn b{{position:absolute;left:880px;top:460px;width:160px;height:160px;transform:scale(0);background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Cpath d='M20 2 L24 16 L38 20 L24 24 L20 38 L16 24 L2 20 L16 16 Z' fill='%23fffdf8' stroke='%235b4636' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat}}</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="{total}">
{slots}{trans}  <audio id="el-bgm" src="assets/music/bgm.mp3" data-start="0" data-duration="{total}" data-track-index="30" data-volume="0.6"></audio>
</div>
<script>const tl=gsap.timeline({{paused:true}});
{tjs}window.__timelines["main"]=tl;</script>
</body></html>
'''
open('index.html','w',encoding='utf8').write(html)
print(ST,D,total)
for sc in words: print(sc['id'],[c['t'] for c in caps(sc)])
