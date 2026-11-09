import asyncio, json, sys, re, os, edge_tts
# 每段 = (开场, 目的句, 正文, 目的卡片短句)。目的句在画面中以"为什么"卡片强调；为空则不显示卡片。
LINES = {
 # (开场/正文, 记忆句, 记忆句之后的正文, 卡片短句)。记忆句放在末尾时，正文写在第一项、第三项留空。
 "s1": ("嗨，我是小龙！今天聊一个很火的词：AI 原生。先看两幅画：左边，给一栋老楼外挂一个 AI 插件，这叫用上 AI；右边，一棵树从 AI 的种子里长出来，根、干、叶都流着 AI 的光。", "这才叫，生而 AI。", "", "用上 AI ≠ 生而 AI"),
 "s2": ("怎么分辨？只要问一句：", "把 AI 拿掉，它还能成立吗？", "带着这个问题，我们从七个层面来看：技术架构、产品、组织、用户、交互、商业模式，最后重点讲硬件。", "把 AI 拿掉，它还能成立吗？"),
 "s3": ("第一层，技术架构。传统系统是一个个功能模块，AI 像插件一样挂在旁边。AI 原生的系统，底座就是大模型，往上是知识库检索、智能体，最上面才是界面，数据和决策从模型一路往上流。", "模型是底座，不是外挂。", "", "模型是底座，不是外挂"),
 "s4": ("第二层，产品。拿天气 App 来说，把里面的 AI 推荐拿掉，查天气照样能用，它只是用上了 AI。再看一个对话助手，把模型拿掉，整个产品只剩一个空白的输入框。", "拿掉模型就不存在的产品，才是 AI 原生产品。", "", "拿掉模型，产品就不存在了"),
 "s5": ("第三层，组织。在传统流程里做一个小工具：业务提需求，产品写文档，设计画图，开发、测试、上线，一转眼几周就过去了。", "", "", ""),
 "s6": ("AI 原生的组织里，HR 对着电脑说一句：帮我做个请假登记工具，几分钟就能生成、试用、接进系统。专业团队把精力放在平台、数据和安全上，给大家兜底。所以越来越多的小团队，就能做出过去要几百人才做得到的业务。", "需求是谁提的，就由谁来做。", "", "需求是谁提的，就由谁来做"),
 "s7": ("第四层，用户。新一代用户从小就直接跟 AI 说话：孩子还不会打字，对着平板说，讲一个恐龙去太空的故事，插画和故事马上就来；而很多大人，还习惯打开搜索框，一个字一个字地敲关键词。", "AI 原生用户，习惯说出目标，而不是一步步操作。", "", "说出目标，而不是一步步操作"),
 "s8": ("第五层，交互。一层层点菜单的时代，正在慢慢过去。戴着智能眼镜做饭，问一句，这个要煮几分钟，答案就浮在眼前；手一挥，翻到下一步；看一眼冰箱，它就认出了里面的食材。", "语音、手势和视线，一起成为新的界面。", "", "语音 · 手势 · 视线 = 新界面"),
 "s9": ("第六层，商业模式。AI 每干一件活，都要消耗 Token，也就是算力成本。问一句话只要几枚，生成一段视频就要一大串。如果收的钱撑不住 Token 消耗，用得越多，亏得越多；所以要按用量、按效果，重新设计定价，让天平回正。", "收入，要跑赢 Token 成本。", "", "收入要跑赢 Token 成本"),
 "s10": ("第七层，也是今天的重点：硬件。还是那句话：", "拿掉 AI，它还能独立运行吗？", "电饭煲和相机，拔掉 AI 芯片，照样煮饭、照样拍照，它们只是用上了 AI；而一个 AI 录音挂件，拔掉 AI，就只剩一个能录音的空壳。", "拿掉 AI，它还能独立运行吗？"),
 "s11": ("把这个挂件夹在衣领上开会，它自己只负责听。声音传到云端，AI 把会议变成文字稿、重点总结和待办清单，再推送回你的手机。", "硬件只是入口，真正干活的是背后的 AI。", "", "硬件是入口，干活的是 AI"),
 "s12": ("再看 AI 陪伴玩具。孩子抱着它聊天，它还记得孩子昨天讲过的事。拆开看，里面只有麦克风、喇叭和联网芯片，它的大脑和记忆都在云端。也正因为这样，儿童隐私和内容安全，必须放在第一位。", "", "", ""),
 "s13": ("生意也变了。传统硬件，卖出去，交易就结束了；AI 原生硬件，每天的对话、总结、识别、提醒，都在消耗 Token，也都能变成持续的会员订阅收入。", "卖出去，才是开始。", "", "卖出去，才是开始"),
 "s14": ("把外壳变透明，你会发现：眼镜、耳机、挂件、玩具，甚至汽车，都连着同一个云端大脑。", "AI 原生硬件，等于交互载体，加云端智能，加 Token 经济。", "", "载体 + 云端智能 + Token 经济"),
 "s15": ("最后把七层叠起来：技术架构、产品、组织、用户、交互、商业模式、硬件。AI 原生，不是给旧东西加上 AI，而是从 AI 出发，重新设计一切。我是小龙，我们下次见！", "", "", ""),
}
# 只给语音用的同音替换（字幕仍显示原文）："行"在表格语境读 háng
SPOKEN = [("重新设计", "重新设计")]
VOICE = "zh-CN-YunxiNeural"
PUN = r'[，。！？；：、,.!?;:\s“”"\'（）()—…@]'
def spoken(text):
    for a, b in SPOKEN: text = text.replace(a, b)
    return text
async def one(k, parts, out):
    pre, why, body, short = parts
    text = pre + why + body
    c = edge_tts.Communicate(spoken(text), VOICE, rate="+8%", pitch="+0Hz", boundary="WordBoundary")
    words = []
    with open(f"{out}/{k}.mp3", "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio": f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"text": ch["text"].replace("航", "行"), "start": ch["offset"] / 1e7, "end": (ch["offset"] + ch["duration"]) / 1e7})
    w = None
    if why:
        a = len(re.sub(PUN, '', pre)); b = a + len(re.sub(PUN, '', why))
        chars = []
        for t in words:
            for ch in re.sub(PUN, '', t["text"]): chars.append((t["start"], t["end"]))
        w = {"t": short, "s": round(chars[min(a, len(chars) - 1)][0], 2), "e": round(chars[min(b - 1, len(chars) - 1)][1], 2), "a": a, "chars": b, "end": body == ""}
    return {"id": k, "text": text, "words": words, "why": w}
async def main(out):
    try: old = {x["id"]: x for x in json.load(open(f"{out}/words.json"))}
    except Exception: old = {}
    res = []
    for k, v in LINES.items():
        o = old.get(k)
        if o and o["text"] == v[0] + v[1] + v[2] and os.path.exists(f"{out}/{k}.mp3"): res.append(o)
        else:
            for attempt in range(4):
                try: res.append(await one(k, v, out)); break
                except Exception as e:
                    print(k, 'retry', attempt, e); await asyncio.sleep(2 + attempt * 3)
            else: raise SystemExit(f'{k} failed')
    json.dump(res, open(f"{out}/words.json", "w"), ensure_ascii=False, indent=1)
asyncio.run(main(sys.argv[1]))
