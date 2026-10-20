# 用法: python3 scripts/build.py <note-id>
# 读取 scripts/notes/<id>.json + assets/voice/<id>/words.json，生成 compositions/frames/<id>-<seg>.html 和 index.html。
# 讲解稿里所有 "cue"/"xxxCue" 关键词会换算成场景内秒数 "ct"/"xxxCt"；找不到关键词会报错退出。
import json, re, subprocess, os, sys, difflib
LEAD = 0.4; TAIL = 0.55; END = 2.2
ANTIC = 0.35  # 画面元素提前量：在含该关键词的字幕出现前 ANTIC 秒触发，保证不晚于旁白/字幕
note = sys.argv[1]
spec = json.load(open(f'scripts/notes/{note}.json', encoding='utf8'))
words = {w['id']: w for w in json.load(open(f'assets/voice/{note}/words.json', encoding='utf8'))}
css = open('scripts/shared.css', encoding='utf8').read()
lib = open('scripts/lib.js', encoding='utf8').read() + '\n' + open('scripts/clawd.js', encoding='utf8').read()
FONTS = '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">'
PUN = r'[，。！？；：、,.!?;:\s“”"\'（）()—…\-/·↔→<>《》]'
strip = lambda s: re.sub(PUN, '', s)
def dur(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())
def char_times(rec):
    """显示文本(去标点)每个字 -> (start,end)。用 difflib 把显示文本对齐到 TTS 实际返回的词，发音替换处线性插值。"""
    D = strip(rec['text']); wc = []; wt = []
    for w in rec['words']:
        for ch in strip(w['text']): wc.append(ch); wt.append((w['start'], w['end']))
    Wc = ''.join(wc)
    m = [None] * len(D)
    for a, b, n in difflib.SequenceMatcher(None, D.lower(), Wc.lower(), autojunk=False).get_matching_blocks():
        for k in range(n): m[a + k] = b + k
    known = [i for i in range(len(D)) if m[i] is not None]
    out = []
    for i in range(len(D)):
        if m[i] is not None: out.append(wt[m[i]]); continue
        lo = max([k for k in known if k < i], default=None); hi = min([k for k in known if k > i], default=None)
        if lo is None: out.append(wt[0] if wt else (0, 0))
        elif hi is None: out.append(wt[m[lo]])
        else:
            f = (i - lo) / (hi - lo); s = wt[m[lo]][1] + (wt[m[hi]][0] - wt[m[lo]][1]) * f; out.append((s, s + .05))
    return D, out
def clauses(text):
    parts = re.findall(r'[^，。！？；：]+[，。！？；：]?', text)
    out = []; cur = ''
    for p in parts:
        if cur and (len(strip(cur + p)) > 16 or cur[-1] in '。！？'): out.append(cur); cur = p
        else: cur += p
    if cur: out.append(cur)
    return out
def caps(rec, ct):
    res = []; pos = 0
    for c in clauses(rec['text']):
        n = len(strip(c))
        if n == 0: continue
        a = min(pos, len(ct) - 1); b = min(pos + n - 1, len(ct) - 1)
        res.append({'t': re.sub(r'[，、；：]+$', '', c.strip()).rstrip('。').strip(), 's': round(ct[a][0] + LEAD, 2), 'e': round(ct[b][1] + LEAD, 2)})
        pos += n
    return res
bad = []; CUES = []
def clause_start(rec, ct):
    """每个字 -> 它所在字幕分句的开始时间（与 caps() 同一分句规则）"""
    out = []; pos = 0
    for c in clauses(rec['text']):
        n = len(strip(c))
        if n == 0: continue
        out += [ct[min(pos, len(ct) - 1)][0]] * n; pos += n
    return out
def resolve(obj, D, ct, sid, cs=None):
    if isinstance(obj, list): return [resolve(x, D, ct, sid, cs) for x in obj]
    if not isinstance(obj, dict): return obj
    o = {}
    for k, v in obj.items():
        if (k == 'cue' or k.endswith('Cue')) and isinstance(v, str):
            kw, nth = (v.split('#') + ['0'])[:2]; kw = strip(kw); p = -1; s = 0
            for _ in range(int(nth) + 1):
                p = D.find(kw, s)
                if p < 0: break
                s = p + 1
            if p < 0: bad.append((sid, v)); p = 0
            at = max(0.6, min(ct[p][0], cs[p]) + LEAD - ANTIC)
            o[k[:-3] + 'Ct' if k != 'cue' else 'ct'] = round(at, 2)
            CUES.append({'seg': sid, 'cue': v, 'ct': round(at, 2), 'spoken': round(ct[p][0] + LEAD, 2)})
        o[k] = resolve(v, D, ct, sid, cs) if k not in ('cue',) else v
    return o
segs = spec['segments']; D_ = []; ST = []; t = 0; scenes = []
for i, seg in enumerate(segs):
    rec = words[seg['id']]
    assert rec['text'] == seg['say'], f'{seg["id"]}: 讲解稿已改动，请先运行 vo.py'
    vd = dur(f'assets/voice/{note}/{seg["id"]}.mp3')
    d = round(vd + LEAD + (END if i == len(segs) - 1 else TAIL), 2)
    D, ct = char_times(rec); n0 = len(CUES)
    S = resolve(seg, D, ct, seg['id'], clause_start(rec, ct)); S['series'] = spec['title']
    for c in CUES[n0:]: c['abs'] = round(t + c['spoken'], 2); c['absCt'] = round(t + c['ct'], 2)
    scenes.append((seg, S, caps(rec, ct), d, vd)); ST.append(round(t, 2)); D_.append(d); t += d
if bad: print('MISSING cue keywords:', bad); raise SystemExit(1)
total = round(t, 2)
os.makedirs('compositions/frames', exist_ok=True)
for f in os.listdir('compositions/frames'):
    if f.startswith(note + '-'): os.remove(f'compositions/frames/{f}')
slots = ''
for i, (seg, S, cp, d, vd) in enumerate(scenes):
    cid = f'{note}-{seg["id"]}'
    data = 'var S=%s;var CAPS=%s;var SDUR=%s;' % (json.dumps(S, ensure_ascii=False), json.dumps(cp, ensure_ascii=False), d)
    html = f'''<!doctype html><html><head><meta charset="UTF-8"></head><body>
<template>{FONTS}
<style>{css}</style>
<div id="root" data-composition-id="{cid}" data-width="1920" data-height="1080">
  <div class="board"></div><div class="vig"></div>
  <div class="stage abs" style="inset:0"></div>
  <div class="cap"></div>
</div>
<script>
{lib}
{data}
(function(){{var root=document.querySelector('[data-composition-id="{cid}"]');var tl=gsap.timeline({{paused:true}});scene(tl,root);window.__timelines["{cid}"]=tl;}})();
</script>
</template></body></html>
'''
    open(f'compositions/frames/{cid}.html', 'w', encoding='utf8').write(html)
    slots += f'  <div id="el-{seg["id"]}" data-composition-id="{cid}" data-composition-src="compositions/frames/{cid}.html" data-start="{ST[i]}" data-duration="{d}" data-track-index="1" data-width="1920" data-height="1080"></div>\n'
    slots += f'  <audio id="el-{seg["id"]}-voice" src="assets/voice/{note}/{seg["id"]}.mp3" data-start="{round(ST[i] + LEAD, 2)}" data-duration="{round(vd, 2)}" data-track-index="{10 + i}" data-volume="1"></audio>\n'
# 转场：蓝/紫两道斜幕横扫
trans = ''; tjs = ''
for k in range(1, len(ST)):
    b = ST[k]; s0 = round(b - .45, 2)
    trans += f'  <div id="tr{k}" class="clip trn" data-start="{s0}" data-duration="1.0" data-track-index="{40 + k % 2}"><i id="tr{k}a" style="background:#2563eb"></i><i id="tr{k}b" style="background:#7c3aed"></i><i id="tr{k}c" style="background:#f59e0b;width:60px"></i></div>\n'
    tjs += f'tl.fromTo("#tr{k}a,#tr{k}b,#tr{k}c",{{x:-2600}},{{x:0,duration:.42,stagger:.05,ease:"power3.in"}},{s0});tl.to("#tr{k}a,#tr{k}b,#tr{k}c",{{x:2600,duration:.45,stagger:.05,ease:"power3.out"}},{round(b + .02, 2)});\n'
html = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">{FONTS}
<style>*{{margin:0;padding:0;box-sizing:border-box}}html,body{{width:1920px;height:1080px;overflow:hidden;background:#0b1226}}
#root{{position:relative;width:100%;height:100%;background:#0b1226;overflow:hidden}}
#root>div[data-composition-src]{{position:absolute;inset:0}}
.trn{{position:absolute;inset:0;z-index:100;pointer-events:none;overflow:hidden}}.trn i{{position:absolute;top:-200px;left:-300px;width:2600px;height:1480px;transform:skewX(-14deg)}}.trn i:nth-child(2){{left:-200px}}.trn i:nth-child(3){{left:2280px;width:60px}}</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="{total}">
{slots}{trans}  <audio id="el-bgm" src="assets/music/{note}-bgm.mp3" data-start="0" data-duration="{total}" data-track-index="30" data-volume="0.55"></audio>
</div>
<script>const tl=gsap.timeline({{paused:true}});
{tjs}window.__timelines["main"]=tl;</script>
</body></html>
'''
open('index.html', 'w', encoding='utf8').write(html)
json.dump(CUES, open(f'renders/{note}-cues.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
json.dump({'note': note, 'title': spec['title'], 'duration': total}, open('renders/last-build.json', 'w', encoding='utf8'), ensure_ascii=False)
print('starts', ST); print('durs', D_); print('total', total)
for seg, S, cp, d, vd in scenes: print(seg['id'], [c['t'] for c in cp])
