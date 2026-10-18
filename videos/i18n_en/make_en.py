"""Create English twins of the two promo videos: videos/<name>-en/.
Usage: python3 i18n_en/make_en.py   (run from the videos/ directory). Re-runnable; src/ in the twins is regenerated each time."""
import os, re, shutil, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from dicts import *
import narration as NR

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCL = {'renders', 'compositions', 'node_modules', '.hyperframes', 'index.html', '__pycache__'}
VOICE = "en-US-AvaNeural"
RATE = "+3%"

def clone(src, dst):
    os.makedirs(dst, exist_ok=True)
    for n in os.listdir(src):
        if n in EXCL: continue
        s, d = os.path.join(src, n), os.path.join(dst, n)
        if n == 'assets':
            for a in os.listdir(s):
                sa, da = os.path.join(s, a), os.path.join(d, a)
                if a in ('music', 'voice'):
                    os.makedirs(da, exist_ok=True)
                    if a == 'music' and os.path.exists(os.path.join(sa, 'bgm_even.wav')) and not os.path.exists(os.path.join(da, 'bgm_even.wav')):
                        shutil.copy(os.path.join(sa, 'bgm_even.wav'), da)
                elif os.path.isdir(sa): shutil.copytree(sa, da, dirs_exist_ok=True)
                else: os.makedirs(d, exist_ok=True); shutil.copy(sa, da)
        elif os.path.isdir(s): shutil.copytree(s, d, dirs_exist_ok=True)
        else: shutil.copy(s, d)

def font_swap(t):
    t = t.replace('family=ZCOOL+KuaiLe&family=Long+Cang', 'family=Fredoka:wght@500;600&family=Patrick+Hand')
    return t.replace('ZCOOL KuaiLe', 'Fredoka').replace('Long Cang', 'Patrick Hand')

def translate(text, scene, tk, dic, scoped):
    for zh, en in sorted((tk.get(scene) or {}).items(), key=lambda x: -len(x[0])):
        text = text.replace('"%s"' % zh, '"%s"' % en)
    pairs = sorted(scoped.get(scene, []) , key=lambda x: -len(x[0]))
    # global first for long phrases, scoped for short fragments afterwards
    for zh, en in sorted(dic, key=lambda x: -len(x[0])):
        text = text.replace(zh, en)
    for zh, en in pairs: text = text.replace(zh, en)
    return text

def leftover(text):
    return sorted(set(re.findall(r'[^\x00-\x7f<>"\';{}\n]*[一-鿿][^\x00-\x7f<>"\';{}\n]*|[一-鿿]+', text)))

def build_project(name, tk, dic, kind):
    src = os.path.join(ROOT, name); dst = os.path.join(ROOT, name + '-en')
    clone(src, dst)
    miss = {}
    for f in sorted(os.listdir(os.path.join(dst, 'src'))):
        p = os.path.join(dst, 'src', f); sc = f[:-5]
        # always re-translate from the Chinese source
        t = open(os.path.join(src, 'src', f), encoding='utf8').read()
        t = translate(t, sc, tk, dic, SCOPED)
        t = font_swap(t)
        for a, b in ENFIX.get(('p:' if kind == 'platform' else 'n:') + sc, []):
            if a not in t: print('  ENFIX miss', kind, sc, a[:40])
            t = t.replace(a, b)
        open(p, 'w', encoding='utf8').write(t)
        lo = leftover(t)
        if lo: miss[f] = lo
    # scripts: fonts + english-aware captions
    for f in os.listdir(os.path.join(dst, 'scripts')):
        p = os.path.join(dst, 'scripts', f)
        if f.endswith(('.css', '.js', '.py')):
            t = font_swap(open(p, encoding='utf8').read())
            if f == 'build.py':
                t = t.replace('''def clauses(text):
    parts=re.findall(r'[^，。！？；：]+[，。！？；：]?',text)
    out=[];cur=''
    for p in parts:
        if cur and len(re.sub(PUN,'',cur+p))>16:
            out.append(cur);cur=p
        else: cur+=p
    if cur: out.append(cur)
    return out''', '''def clauses(text):
    base=[x for x in re.split(r'(?<=[,.!?;:])\\s+',text) if x]
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
    return out''')
                t = t.replace("re.sub(r'[，、；：]+$','',c.strip()).rstrip('。').strip()", "c.strip().rstrip(',.;:').strip()")
                t = t.replace("PUN=r'[，。！？；：、,.!?;:\\s“”\"\\'（）()—…]'", "PUN=r'[，。！？；：、,.!?;:\\s“”\"\\'（）()—…]'")
            open(p, 'w', encoding='utf8').write(t)
    # voice script
    if kind == 'platform':
        vo = open(os.path.join(src, 'scripts', 'vo.py'), encoding='utf8').read()
        a = vo.index('LINES = {'); b = vo.index('# 只给语音用')
        lines = 'LINES = {\n' + ''.join(' %s: %s,\n' % (json.dumps(k), json.dumps(list(v), ensure_ascii=False)) for k, v in NR.PLATFORM.items()) + '}\n'
        vo = vo[:a] + lines + vo[b:]
        vo = re.sub(r'SPOKEN = \[.*?\]\n', 'SPOKEN = []\n', vo, flags=re.S)
        vo = vo.replace('VOICE = "zh-CN-YunxiNeural"', 'VOICE = "%s"' % VOICE).replace('rate="+8%"', 'rate="%s"' % RATE)
    else:
        vo = open(os.path.join(src, 'scripts', 'vo.py'), encoding='utf8').read()
        a = vo.index('LINES = {'); b = vo.index('VOICE=')
        lines = 'LINES = {\n' + ''.join(' %s: %s,\n' % (json.dumps(k), json.dumps(v, ensure_ascii=False)) for k, v in NR.NETCARE.items()) + '}\n'
        vo = vo[:a] + lines + vo[b:]
        vo = vo.replace('VOICE="zh-CN-YunxiNeural"', 'VOICE="%s"' % VOICE).replace('rate="+6%"', 'rate="%s"' % RATE)
    if kind == 'platform':
        vo = vo.replace('text = pre + why + body', 'text = " ".join(x for x in (pre, why, body) if x)').replace('o["text"] == v[0] + v[1] + v[2]', 'o["text"] == " ".join(x for x in v[:3] if x)')
        vo = vo.replace('a = len(re.sub(PUN, \'\', pre)); b = a + len(re.sub(PUN, \'\', why))', 'a = len(re.sub(PUN, \'\', pre)); b = a + len(re.sub(PUN, \'\', why))')
    os.makedirs(os.path.join(dst, 'compositions', 'frames'), exist_ok=True); os.makedirs(os.path.join(dst, 'renders'), exist_ok=True)
    open(os.path.join(dst, 'scripts', 'vo.py'), 'w', encoding='utf8').write(vo)
    # drop stale chinese voice/words so vo.py regenerates
    vd = os.path.join(dst, 'assets', 'voice')
    return dst, miss

if __name__ == '__main__':
    for name, tk, dic, kind in (('tools-platform-guide', TK_PLATFORM, PLATFORM, 'platform'), ('netcare-rfc-ai-guide', TK_NETCARE, NETCARE, 'netcare')):
        dst, miss = build_project(name, tk, dic, kind)
        print('==', dst)
        for f, lo in miss.items(): print(' leftover', f, lo)
