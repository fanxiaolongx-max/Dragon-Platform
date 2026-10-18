import json,re,subprocess,os
LEAD=0.4; TAIL=0.7
words=json.load(open('assets/voice/words.json',encoding='utf8'))
css=open('scripts/shared.css',encoding='utf8').read()
lib=open('scripts/lib.js',encoding='utf8').read()
def dur(f):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).decode())
PUN=r'[，。！？；：、,.!?;:\s“”"\'（）()—…]'
def clauses(text):
    base=[x for x in re.split(r'(?<=[,.!?;:])\s+',text) if x]
    parts=[]
    for b in base:
        ws=b.split(' ');cur=''
        for w in ws:
            if cur and len(re.sub(PUN,'',cur+w))>30:
                parts.append(cur);cur=w
            else: cur=(cur+' '+w) if cur else w
        if cur: parts.append(cur)
    out=[];cur=''
    for p in parts:
        if cur and len(re.sub(PUN,'',cur+p))>34:
            out.append(cur);cur=p
        else: cur=(cur+' '+p) if cur else p
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
        res.append({'t':c.strip().rstrip(',.;:').strip(),'s':round(chars[a][0],2),'e':round(chars[b][1],2)})
        pos+=n
    return res

# 检查 src 里的 T("关键词") 是否都能在对应旁白里找到
bad=[]
for sc in words:
    f=f'src/{sc["id"]}.html'
    if not os.path.exists(f): continue
    C=re.sub(r'\s+','',''.join(w['text'] for w in sc['words']))
    for m in re.finditer(r'T\("([^"]+)"\)',open(f,encoding='utf8').read()):
        if re.sub(r'\s+','',m.group(1)) not in C: bad.append((sc['id'],m.group(1)))
if bad:
    print('MISSING T() keywords:',bad); raise SystemExit(1)
D=[];ST=[];t=0
for i,sc in enumerate(words):
    d=dur(f"assets/voice/{sc['id']}.mp3"); D.append(round(d+LEAD+(2.4 if i==len(words)-1 else TAIL),2)); ST.append(round(t,2)); t+=D[-1]
total=round(t,2)
for i,sc in enumerate(words):
    n=sc['id']
    if not os.path.exists(f'src/{n}.html'): continue
    s=open(f'src/{n}.html',encoding='utf8').read()
    data='var W=%s;var CAPS=%s;var LEAD=%s;'%(json.dumps([{'t':w['text'],'s':round(w['start'],2),'e':round(w['end'],2)} for w in sc['words']],ensure_ascii=False),json.dumps(caps(sc),ensure_ascii=False),LEAD)
    s=s.replace('<template>','<template><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Patrick+Hand&display=swap" rel="stylesheet">',1).replace('/*SHARED*/',css).replace('//LIB',lib).replace('//DATA',data).replace('WOBID',f'wob{n}')
    open(f'compositions/frames/{n}.html','w',encoding='utf8').write(s)
slots=''
for i,sc in enumerate(words):
    n=sc['id']
    if not os.path.exists(f'src/{n}.html'): continue
    slots+=f'  <div id="el-{n}" data-composition-id="{n}" data-composition-src="compositions/frames/{n}.html" data-start="{ST[i]}" data-duration="{D[i]}" data-track-index="1" data-width="1920" data-height="1080"></div>\n'
    slots+=f'  <audio id="el-{n}-voice" src="assets/voice/{sc["id"]}.mp3" data-start="{round(ST[i]+LEAD,2)}" data-duration="{round(dur("assets/voice/%s.mp3"%sc["id"]),2)}" data-track-index="{10+i}" data-volume="1"></audio>\n'
html=f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Patrick+Hand&display=swap" rel="stylesheet">
<style>*{{margin:0;padding:0;box-sizing:border-box}}html,body{{width:1920px;height:1080px;overflow:hidden;background:#fff7e6}}
#root{{position:relative;width:100%;height:100%;background:#fff7e6;overflow:hidden}}
#root>div[data-composition-src]{{position:absolute;inset:0}}</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="{total}">
{slots}  <audio id="el-bgm" src="assets/music/bgm.mp3" data-start="0" data-duration="{total}" data-track-index="30" data-volume="0.6"></audio>
</div>
<script>const tl=gsap.timeline({{paused:true}});window.__timelines["main"]=tl;</script>
</body></html>
'''
open('index.html','w',encoding='utf8').write(html)
print(ST,D,total)
for sc in words: print(sc['id'],[c['t'] for c in caps(sc)])
