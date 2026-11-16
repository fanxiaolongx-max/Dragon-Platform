import json,re,collections,datetime
from parse import rows,EMO,meal_of,EXCL
WD='一二三四五六日'
SECT={'荤菜':'荤菜','素菜':'素菜','粗粮':'粗粮','汤':'汤类','面条':'面食','面食':'面食','卤汤':'面食','主食':'主食','果汁':'饮品','饮品':'饮品','明档':'明档','特色':'特色','铁板':'铁板','煎档':'铁板','小菜':'小菜','凉菜':'凉菜','中式早餐':'早餐点心','西式':'西式','本地':'埃及本地','埃及':'埃及本地','水果':'水果','甜品':'甜品','面档':'面食','烧烤':'烧烤'}
PROSE=re.compile(r'的|了|是|让|吃|根据|提高|由于|已|我|能|快|来|心愿|一起|美味|健康|活力|温暖|欢|啦|呀|哦|吧|么|这|那|每|都|就|会|在|时光|上线|安排|今天|今日|明天|本周|加班|大家|为|给|推荐|欢迎|祝|温馨|提示|厨|充值|时间|接口人|光盘|浪费|建议|意见|愉快|SV|餐厅|家人|菜单|准备|开餐|供应|就餐|谢谢|注意|请|星期|档口|值班|负责|通知|接龙|截止|更新|你|您|们|周[一二三四五六日天末]|点|分钟|号|月|年|元|\d{3,}|[a-zA-Z]{4,}|湿滑|拜拜|满足|醇厚|浓郁|鲜香|过瘾|丰富|独到|咬下|幸福|不再|更浓|乎乎|一碗$|风味$|运行|停运|趟次|支持|早上好|推出|盛宴|爽滑|筋道|清香家常|咕噜|味蕾|口感|调味|滋味|辛劳|疲惫|治愈|暴击|营养|搭配|开启|享受|满满|热乎|地道|正宗|经典|入味|香气|口味$|^三种$|^两道$|^简餐$|一荤一素|煎炒烹烤煮|^豆沙$|师傅|面档|无穷|外焦|里嫩|外酥|热气|腾腾|原汁|越嚼|辛苦|入喉|全身|清爽|不腻|开胃|四溢|一辣一鲜|上瘾|灵魂|悠长|滋补|不燥|味浓|味厚|佳节|财源|森林|美食|暖胃|暖心|^清蒸$|两种锅底|简餐|(?:十足|鲜嫩|细嫩|爽口|下饭|多汁|嚼劲|软糯|轻盈|绵软|适口|弹牙|上头|锁鲜|诱人|鲜美|鲜甜|咸鲜|喷香|激香|解腻|酥脆|松脆|脆嫩|香甜|脱骨|紧实|软烂|滑口|焦香|嫩滑|Q弹|清甜|清鲜|浓香|酥香|脆爽|劲道|家常味|本味|原味|好味道|好搭档|必吃|必点|收尾|冒泡|肥瘦相间|荤素结合|皮薄馅[大足多]|一绝|神器|上桌|品尝|咸香微辣|微辛)$|慢熬|熬制|熬煮|文火|小时|大火翻炒|大火爆炒|自由选择|口味(?:任你|自由)|汤底选择|拌上|吸满|裹满|锁住|涮出|越[嚼拌吃啃]|锅气|锅香十足|特制酱|特色[酱调]料|热油[激泼]|葱姜提鲜|剁椒鲜辣|粉丝吸|饼子吸|粉条吸|豆腐吸|融合|同事|关注|视频号|行政|指南|能量包|C位|导航|云朵|40度|一边鲜|两种[口锅]|吃的就是|简单又|妥妥的|超解腻|更有家常|一口[咬下到去鲜]|其他选择|只有烤鱼火锅')
ANN_EXCL=re.compile(r'就餐指南|服务接口人|行政服务一指禅|视频号|飞机提前落地|加班习惯')
GENERIC={'小菜','素菜','荤菜','饮品','主食','汤类','粗粮','面食','凉菜','早餐','午餐','晚餐','夜宵','中餐','西餐','明档','特色','铁板','汤','菜','甜品'}
NORM=[('番茄','西红柿'),('西兰花','西蓝花'),('洋芋','土豆'),('烧卖','烧麦')]
NMAP={'水煮鸡蛋':'水煮蛋','煮鸡蛋':'水煮蛋','现煎鸡蛋':'煎蛋','煎鸡蛋':'煎蛋','西红柿炒鸡蛋':'西红柿炒蛋','河南胡辣汤':'胡辣汤','河南水煎包':'水煎包','香煎韭菜盒子':'韭菜盒子','炸油条':'油条','脆皮油条':'油条','清炒蔬菜':'清炒时蔬','时令蔬菜':'清炒时蔬','时蔬':'清炒时蔬','炒时蔬':'清炒时蔬','鲜果':'水果','新鲜水果':'水果','时令水果':'水果','鲜果一份':'水果','西点③种':'西点','西点③':'西点','西点3种':'西点','杂粮米饭':'杂粮饭','水煮玉米棒':'玉米','蒸玉米':'玉米','煮玉米':'玉米','汤粉汤面':None,'鸡蛋':'鸡蛋','炒米饭':'炒饭','白米饭':'米饭','本地米饭':'埃及本地米饭','鲜榨果汁':'果汁','中式早点':'中式点心','烤红薯':'红薯','蒸红薯':'红薯'}
STAPLE={'牛奶','酸奶','豆浆','茶叶蛋','水煮蛋','煎蛋','鸡蛋','咸鸭蛋','清炒时蔬','炒青菜','米饭','杂粮饭','馒头','水果','果汁','汤粉','汤面','面条','手工面','西点','中式点心','玉米','红薯','埃及本地米饭','本地面包','花卷','凉拌黄瓜'}
def norm(p):
    p=p.strip()
    for a,b in NORM: p=p.replace(a,b)
    p=re.sub(r'^(明档|新品|还有新品|还有|另有|特供|加餐|现做|现煎|手工|自制)(?=..)','',p) if p not in ('手工面','现煎鸡蛋','现做豆腐脑') else p
    return NMAP.get(p,p)
def clean(s):
    s=EMO.sub('',s)
    if '—' in s:
        left=s.split('—',1)[0].strip()
        if len(left)>=2: s=left
    s=re.sub(r'\[[^\]]{0,6}$','',s); s=re.sub(r'\*\d+$','',s)
    s=re.sub(r'[（(][^）)]{0,14}[）)]','',s)
    s=re.sub(r'^[\s\d\.、\-—*#•·①-⑳]+','',s)
    s=re.sub(r'(一份|一只|一盒|一杯|一个|两道|等等|等|哟)$','',s)
    return s.strip(' \t*~～-—·•.。!！?？"“”\'）)(（：:&＆⁺₊♡')
PERSON=set(r['sender'] for r in rows)
for r in rows:
    if r['type']!=1: continue
    for p in re.findall(r'[（(]([\u4e00-\u9fa5]{2,4})[）)]',r['text']): PERSON.add(p)
    for line in r['text'].split('\n'):
        mm=re.search(r'(厨|档|厨师|负责人?)[^:：\n]{0,4}[:：]\s*([\u4e00-\u9fa5、，, ]{2,30})$',EMO.sub('',line).strip())
        if mm:
            for p in re.split(r'[、，,\s]+',mm.group(2)):
                if 2<=len(p)<=3: PERSON.add(p)
FOOD=set('饭面粉汤粥饼包饺馍菜肉鸡鸭鱼虾蛋奶浆汁果蔬条卷糕豆茶牛羊猪排骨丝片丁块球卤酱煎炒烤蒸炸炖煮拌烧焖酥串锅腐瓜茄薯芋笋菇耳椒葱蒜姜韭芹萝藕米麦糖蜜油盐醋辣酸甜香脆嫩翅爪蹄肚肠虾蟹贝鱿兔饮可乐咖啡水冰粽圆酪芝士堡披萨沙拉沙司馄饨抄手麻花火烧盒烙')
def is_person(p):
    if p in PERSON: return True
    if len(p)<=3 and not any(ch in FOOD for ch in p): return True
    for q in PERSON:
        if len(q)>=2 and len(p)<=6 and p.startswith(q) and p[len(q):] in PERSON: return True
    return False
def expand_item(p):
    p=p.strip()
    if p=='汤粉汤面': return ['汤粉','汤面']
    if p=='汤面葱油饼': return ['汤面','葱油饼']
    if p.endswith('汤粉汤面') and len(p)>4:
        head=re.sub(r'(?:还有|及|和|\s)+$','',p[:-4]).strip(' ]')
        res=[]
        if head: res.extend(expand_item(head))
        res.extend(['汤粉','汤面'])
        return res
    if 2<=len(p)<=12 and re.search(r'[\u4e00-\u9fa5]',p) and not PROSE.search(p) and p not in GENERIC:
        n=norm(p)
        if n and n not in GENERIC and len(n)>=2 and not is_person(n): return [n]
    return []
def split_items(raw):
    for p in re.split(r'[，,、/；;！!。+＋&＆]|还有|(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])|\s{2,}|和|及|或',raw):
        p=clean(p)
        for d in expand_item(p): yield d
def dishes_of(text):
    out=[];sect=''
    m=re.search(r'早餐(?:已经备好|准备好了|已备好)[！!，,]*(?:今天)?有?(.*)',text,re.S)
    if m:
        body=re.split(r'等[！!，,欢]|欢迎|祝',m.group(1))[0]
        return [('早餐点心',d) for d in split_items(body.replace('\n','，'))]
    for line in text.split('\n'):
        raw=EMO.sub('',line).strip()
        if not raw: continue
        br=re.findall(r'【([^】]{2,12})】',raw)
        if br:
            for b in br:
                if '｜' in b or '|' in b: b=re.split(r'[｜|]',b)[-1].strip()
                out+= [(sect,d) for d in split_items(b)]
            continue
        if re.match(r'^(本地菜单|中式早餐|西式早餐|今日菜单如下|中餐)',raw):
            sect='埃及本地' if '本地' in raw else ('早餐点心' if '早餐' in raw else sect); continue
        cm=re.match(r'^([^:：]{0,10})[:：](.*)$',raw)
        if cm:
            head=cm.group(1)
            hit=[SECT[k] for k in SECT if k in head]
            if hit: sect=hit[0]
            raw=cm.group(2).strip()
            if not raw: continue
        elif raw in SECT or (len(raw)<=4 and any(k==raw.strip('类：:') for k in SECT)):
            sect=SECT.get(raw,sect); continue
        if raw.endswith(('～','~')) and not re.search(r'(?:今日推荐|有大家喜爱|超多美味|备受欢迎|有美味的)',raw): continue
        if '｜' in raw or '|' in raw: raw=re.split(r'[｜|]',raw,maxsplit=1)[0].strip()
        if len(raw)>40: continue
        out+=[(sect,d) for d in split_items(raw)]
    seen=set();res=[]
    for s,d in out:
        if d not in seen: seen.add(d);res.append((s,d))
    return res
msgs=[];imgs=[]
for r in rows:
    if r['type']==3: imgs.append(r); continue
    if r['type']!=1: continue
    x=r['text']
    if EXCL.search(x[:40]) or ANN_EXCL.search(x[:200]): continue
    if not re.search(r'推荐|菜单|早餐|午餐|晚餐|夜宵|宵夜|火锅|简餐|早上好',x[:120]): continue
    ds=dishes_of(x)
    if len(ds)<2: continue
    meal,src=meal_of(x,r['t'])
    msgs.append(dict(t=r['t'],date=r['t'][:10],meal=meal,src=src,sender=r['sender'],dishes=ds,text=x))
# ---- classification
def rx(s): return re.compile(s)
CAT=[('小吃/炸物',rx(r'薯条|薯片|甜甜圈|沙琪玛|开口笑|炸鲜奶|麻圆|鸡米花|炸鸡|鸡块$|麻辣烫')),('面条/粉',rx(r'麻食|^.{0,2}炸酱$|卤$|^.{0,3}打卤|粉条|拉条|云吞')),('饮品',rx(r'(汁|茶|豆浆|牛奶|酸奶|咖啡|可乐|饮料|奶茶|莫吉托|薄荷水|番石榴|奶昔|酸梅汤|乌梅汤|豆奶|椰奶|柠檬水|杏仁露)$')),
('面条/粉',rx(r'^汤粉$|^汤面$|面$|面条|米线|河粉|米粉|粉丝汤|^.{0,4}粉$|面片|疙瘩汤|凉皮|擀面皮|拉条子|面筋')),
('汤/粥',rx(r'粥|汤$|羹|糊$|汤饭|豆腐脑|豆花')),
('甜品/水果',rx(r'甜水|糯米糍|糯米滋|龟苓膏|银耳|双皮|糖环|萨其马|粑粑|拔丝|水果|蛋糕|布丁|西米|糖水|双皮奶|冰粉|慕斯|蛋挞|小贝|麻薯|汤圆|元宵|果冻|西瓜|甜品|奶冻|芋圆|糖葫芦|月饼|绿豆沙|酒酿|班戟|泡芙|曲奇|雪糕|冰淇淋|蛋黄酥|麻花|^西点$|奶黄|椰子|桃|梨|苹果|香蕉|葡萄|芒果$|橙$')),
('面点/包点',rx(r'混沌|炒手|粉果|派$|包$|包子|饺|馒头|花卷|饼|卷$|烧麦|馄饨|抄手|锅贴|油条|馍|火烧|盒子|酥$|糕|窝窝头|肠粉|生煎|小笼|汉堡|三明治|面包|披萨|吐司|华夫|麻团|麻园|点心|春卷|粽|油糕|糍粑|烧饼|大饼|饼干|角$|发面|麻球|驴打滚|油饼|煎包|包$')),
('米饭类',rx(r'饭$|饭团|寿司|焖饭|盖饭|抓饭|炒饭|^米饭$|粽子')),
('火锅/烧烤/铁板',rx(r'火锅|串|烧烤|烤肉|铁板|锅$|干锅|烤全羊|羊排$')),
('蛋类',rx(r'蛋$')),
('水产海鲜',rx(r'斑|花甲|花枝|鲷|鱼|虾|蟹|鱿|贝|蛤|海鲜|三文|墨鱼|章鱼|海参|蚌|螺|鳗|带鱼|海带')),
('牛肉',rx(r'牛')),('羊肉',rx(r'羊')),
('禽肉',rx(r'雁|鸡|鸭|鹅|翅|凤爪|鸽')),
('猪肉/其他肉',rx(r'兔|脑花|黄喉|肺片|大骨|狮子头|蚂蚁上树|毛血旺|猪|排骨|五花|肉|蹄|肘|里脊|腊肠|香肠|培根|丸|肥肠|大肠|腰花|肚|午餐肉|火腿|叉烧')),
('豆制品',rx(r'香干|干丝|黄豆|豆腐|豆皮|腐竹|千张|豆干|素鸡|油豆')),
('凉菜/小菜',rx(r'卤味|卤水|凉拌|拌|拍黄瓜|花生|泡菜|咸菜|榨菜|皮蛋|酱菜|小菜|沙拉')),
('粗粮',rx(r'红薯$|香芋|^(玉米|红薯|紫薯|南瓜|山药|芋头|土豆|毛豆|花生|杂粮)$|蒸(玉米|红薯|南瓜|山药|芋头|紫薯)')),
('素菜',rx(r'瓜$|瓜丝|瓜片|上海青|茼蒿|豇豆|银牙|尖椒|辣子|小炒|乱炖|一碗香|小瓜|魔芋|菜|蔬|白菜|土豆|茄|豆角|西蓝花|花菜|菜花|黄瓜|萝卜|菌|菇|蘑|木耳|西葫芦|冬瓜|苦瓜|丝瓜|南瓜|藕|笋|芹|韭|青椒|辣椒|洋葱|生菜|油麦|菠菜|包菜|甘蓝|芦笋|山药|豆芽|荷兰豆|四季豆|秋葵|地三鲜|玉米'))]
MEAT=rx(r'鱼|虾|蟹|鱿|贝|海鲜|三文|牛|羊|鸡|鸭|鹅|翅|凤爪|猪|排骨|五花|肉|蹄|肘|里脊|肠|培根|丸|腰花|肚|火腿|叉烧')
METH=[('凉拌',r'凉拌|拌|凉'),('爆炒/小炒',r'炒|爆|煸|熘|溜'),('红烧/烧',r'红烧|烧(?!麦|饼|烤)|焖|扒'),('炖/煲',r'炖|煲|煨|砂锅'),('蒸',r'蒸'),('煮/涮',r'煮|涮|汆|水煮|火锅'),('煎/贴',r'煎|锅贴'),('炸',r'炸|酥'),('烤/铁板',r'烤|烘|铁板|焗|串'),('卤/酱',r'卤|酱')]
FLAV=[('麻辣/香辣',r'麻辣|香辣|辣子|剁椒|泡椒|水煮|麻婆|红油|钵钵|毛血旺|干锅|辣'),('酸辣/酸',r'酸辣|酸菜|酸汤|老坛|酸'),('糖醋/酸甜',r'糖醋|酸甜|锅包|菠萝|茄汁'),('孜然',r'孜然'),('蒜香',r'蒜'),('咖喱',r'咖喱'),('酱香',r'酱|豉'),('椒盐',r'椒盐'),('甜',r'甜|蜜|糖|豆沙|红枣'),('清淡',r'清炒|清蒸|清汤|白灼|上汤')]
REG=[('埃及/中东',r'本地|埃及|大饼|鹰嘴豆|法拉费|塔米亚|科沙里|蚕豆泥|沙威玛|皮塔|阿拉伯|土耳其|中东'),
('西式',r'披萨|汉堡|意面|意大利|牛排|三明治|沙拉|薯条|华夫|吐司|面包|蛋糕|布丁|西点|焗|芝士|奶酪|培根|泡芙|曲奇|蛋挞|慕斯|西式|牛角'),
('日韩/东南亚',r'寿司|韩式|日式|石锅|泡菜|咖喱|冬阴功|泰式|越南|椰|照烧|天妇罗|紫菜包饭|部队'),
('川渝',r'麻婆|回锅|宫保|鱼香|水煮|川|钵钵|毛血旺|夫妻肺片|辣子鸡|酸菜鱼|担担|口水|重庆|麻辣|红油|冒菜|串串|干煸|老干妈|豆花'),
('湘赣',r'剁椒|湘|小炒肉|农家|擂椒|外婆菜|口味'),
('粤港/潮汕',r'广式|广东|肠粉|叉烧|烧腊|煲仔|凤爪|虾饺|潮州|潮汕|港式|白切|白灼|蜜汁|菠萝包|蛋挞|流沙|老婆饼|糖水|双皮奶'),
('西北/新疆',r'兰州|新疆|大盘鸡|肉夹馍|凉皮|泡馍|油泼|裤带面|抓饭|烤包子|手抓|biang|臊子|拉条子|西北|陕西|甘肃|宁夏|羊肉串|馕|胡辣|擀面皮|岐山|洋芋|烩面|羊杂'),
('东北/华北',r'锅包肉|地三鲜|东北|小鸡炖蘑菇|炖粉条|酸菜白肉|杀猪菜|京酱|北京|天津|煎饼果子|卤煮|驴肉|山东|葱烧|把子肉|道口|河南|水煎包|山西|刀削|饸饹|打卤'),
('江浙沪/闽',r'扬州|东坡|小笼|生煎|杭州|宁波|上海|苏式|无锡|沙县|福建|闽|梅干菜|醉|腌笃鲜|狮子头|蟹粉'),
('云贵/桂',r'云南|过桥|贵州|酸汤|桂林|螺蛳|柳州|米线')]
def classify(d):
    cat='其他/未识别';conf='低'
    for c,r in CAT:
        if r.search(d): cat=c;conf='高';break
    if cat=='其他/未识别' and re.search(r'(鲜榨|饮|露)',d): cat='饮品';conf='中'
    hs=('荤' if MEAT.search(d) and cat not in ('饮品','甜品/水果') else ('素' if cat not in ('饮品','甜品/水果') else '—'))
    meth=next((m for m,r in METH if re.search(r,d)),'未标明')
    flav=next((m for m,r in FLAV if re.search(r,d)),'家常/未标明')
    reg=next((m for m,r in REG if re.search(r,d)),'家常中式(默认)')
    if reg=='家常中式(默认)' and cat=='饮品': reg='—'
    return cat,conf,hs,meth,flav,reg
# ---- slots
slots=collections.OrderedDict()
for m in msgs:
    k=(m['date'],m['meal'])
    s=slots.setdefault(k,dict(date=m['date'],meal=m['meal'],msgs=[],dishes=collections.OrderedDict()))
    s['msgs'].append(m)
    for sec,d in m['dishes']: s['dishes'].setdefault(d,sec)
# image-only slots
pub=collections.Counter(m['sender'] for m in msgs)
pubs={p for p,c in pub.items() if c>=20}
def win(t):
    h=int(t[11:13])+int(t[14:16])/60
    return '早餐' if 5<=h<10.5 else '午餐' if h<15.5 else '晚餐' if h<19.5 else '夜宵'
imgslot=collections.Counter()
for r in imgs:
    if r['sender'] in pubs: imgslot[(r['t'][:10],win(r['t']))]+=1
imgonly={k:v for k,v in imgslot.items() if k not in slots}
json.dump(dict(slots=[dict(date=s['date'],meal=s['meal'],dishes=list(s['dishes'].items()),n=len(s['msgs'])) for s in slots.values()]),open('slots.json','w'),ensure_ascii=False)
json.dump(dict(msgs=len(msgs),imgonly=len(imgonly),src=dict(collections.Counter(m['src'] for m in msgs))),open('analyze_meta.json','w'),ensure_ascii=False)
