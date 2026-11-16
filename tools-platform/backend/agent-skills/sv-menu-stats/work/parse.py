import json,re,collections
rows=[json.loads(l) for l in open('all.jsonl')]
EMO=re.compile(r'\[[^\[\]]{1,8}\]|[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200d\u20E3\u2190-\u21FF\u3030\u303D\u3297\u3299\u00A9\u00AE\u2122\u2139\u231A-\u23FF\u25A0-\u25FF\U000E0000-\U000E007F]')
NOISE=re.compile(r'推荐|欢迎|祝|温馨|提示|厨师|主厨|副厨|面档|充值|时间|接口人|光盘|浪费|建议|意见|用餐愉快|SV餐厅|大家|家人|今日菜单|菜单如下|准备|开餐|供应|WX|wx|\d{4,}|http|就餐|谢谢|注意|请|周[一二三四五六日天]|星期|厨:|厨：|档口|值班|负责|通知|接龙|截止|已更新|愉快|你|您|我们')
SECT={'荤菜':'荤菜','素菜':'素菜','粗粮':'粗粮','汤':'汤类','面条':'面食','面食':'面食','卤汤':'面食','主食':'主食','果汁':'饮品','饮品':'饮品','明档':'明档','特色':'特色','铁板':'铁板','小菜':'小菜','凉菜':'凉菜','中式早餐':'早餐点心','西式':'西式','本地菜单':'埃及本地','埃及':'埃及本地','水果':'水果','甜品':'甜品','面档':'面食','烧烤':'烧烤','中餐':'中餐'}
def meal_of(text,t):
    h=text[:80]
    for k,v in [('夜宵','夜宵'),('宵夜','夜宵'),('早餐','早餐'),('早上好','早餐'),('午餐','午餐'),('中午','午餐'),('晚餐','晚餐'),('晚饭','晚餐')]:
        if k in h: return v,'标题'
    hh=int(t[11:13])+int(t[14:16])/60
    if 5<=hh<10.5: m='早餐'
    elif hh<15.5: m='午餐'
    elif hh<19.5: m='晚餐'
    else: m='夜宵'
    return m,'时间推断'
def clean(s):
    s=EMO.sub('',s)
    s=re.sub(r'[（(][^）)]{0,12}[）)]','',s)
    s=re.sub(r'^[\s\d\.、\-—*#•·:：]+','',s)
    s=re.sub(r'(一份|一只|一盒|一杯|两道|现做|自制|等$)','',s)
    s=re.sub(r'[\s\*~～!！。,，;；:：/、|]+$','',s).strip(' \t*~～-—·•')
    return s
def dishes_of(text):
    out=[];sect=''
    t=text
    m=re.search(r'早餐(?:已经备好|准备好了)[！!，,]*(?:今天)?有?(.*)',t,re.S)
    if m:
        body=re.split(r'等|欢迎',m.group(1))[0]
        parts=re.split(r'[，,、；;\n]+',body)
        return [('早餐点心',clean(p)) for p in parts if 1<len(clean(p))<=14]
    for line in t.split('\n'):
        raw=EMO.sub('',line).strip()
        if not raw: continue
        sm=re.match(r'^\s*([\u4e00-\u9fa5]{1,6}?(?:菜|类|汤|粮|食|档|汁|品|色|餐)?)[\s]*[:：]\s*(.*)$',raw)
        if sm and any(k in sm.group(1) for k in SECT):
            sect=next(SECT[k] for k in SECT if k in sm.group(1)); raw=sm.group(2)
            if not raw: continue
        elif re.match(r'^(本地菜单|中式早餐|西式早餐|今日菜单如下)',raw):
            sect='埃及本地' if '本地' in raw else ('早餐点心' if '早餐' in raw else sect); continue
        if NOISE.search(raw) or len(raw)>40: continue
        for p in re.split(r'[，,、/；;]+|\s{2,}',raw):
            p=clean(p)
            if 1<len(p)<=14 and re.search(r'[\u4e00-\u9fa5]',p) and not re.fullmatch(r'[\u4e00-\u9fa5]{2,3}',p) or (p and len(p)>=2 and re.search(r'[汤粥面饭饼包饺菜肉鸡鱼蛋奶浆汁果蔬条卷糕虾豆茶]',p) and len(p)<=14):
                out.append((sect,p))
    return out
EXCL=re.compile(r'接龙|班车信息|接口人信息|分批就餐|供应时间通知|温馨提示\n|本周菜单已更新')
menus=[]
for r in rows:
    if r['type']!=1: continue
    x=r['text']
    if EXCL.search(x[:40]): continue
    if not re.search(r'推荐|菜单|早餐|午餐|晚餐|夜宵|宵夜|火锅|简餐',x[:120]): continue
    ds=dishes_of(x)
    if len(ds)<2: continue
    m,src=meal_of(x,r['t'])
    menus.append(dict(t=r['t'],date=r['t'][:10],meal=m,meal_src=src,sender=r['sender'],dishes=ds,text=x))
json.dump(menus,open('menus_raw.json','w'),ensure_ascii=False)
pass #print(len(menus),collections.Counter(m['meal'] for m in menus),collections.Counter(m['meal_src'] for m in menus))
pass #print(len(c)); print(c.most_common(150))
