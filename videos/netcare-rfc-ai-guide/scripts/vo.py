import asyncio, json, sys, edge_tts
LINES = {
 "s1": "嗨，我是小审！今天手把手教你用 NetCare RFC 方案与 AI 审计小工具：先说它能解决什么问题，再教你拿安装包、装进浏览器、开始使用、做个性设置，每一步都告诉你在哪里点。",
 "bg": "先说背景。RFC 就是网络变更申请单，每张单里都附着一份变更方案。审计同事要一张张打开单子，下载方案文档，再对着检查清单逐条核对。单子一多，又慢又容易漏。这个小工具装在浏览器里：能批量下载方案，还能让 AI 先帮你查一遍，你只需要看结论。",
 "s2": "第一步，拿安装包。打开 Dragon 平台首页，在搜索框输入扩展打包，点开 F12 扩展打包。左边选系统内置脚本，点中 NetCare RFC 方案与 AI 审计，再点生成，就能下载到一个压缩包，它就是这个小工具的安装包。",
 "s3": "第二步，装进浏览器。先把压缩包解压，得到一个文件夹。然后在浏览器地址栏输入 chrome://extensions，用 Edge 就输入 edge://extensions，回车打开扩展管理页。把右上角的开发者模式打开，再点左上角的加载已解压的扩展程序，选中刚才的文件夹，就装好啦。",
 "s4": "第三步，开始使用。先打开并登录 NetCare 网站，刷新一下页面。再点浏览器右上角的拼图图标，在列表里找到这个小工具，点启动脚本，页面右下角就会弹出一个小窗口。",
 "s4b": "在小窗口里，粘贴一个或多个 RFC 单号，也就是要查的变更单编号，每次最多五十个。点查找并下载，每张单处理到哪一步，都会一条条显示出来。",
 "s5": "下载 Word 方案的同时，还能在线打开方案，工具会自动找出里面的章节和附件。勾选你关心的章节，一键打包成压缩包。每个章节在网页上的原样，也会自动截图留底，方便日后对证。",
 "s6": "打开 AI 审计后，AI 会照着你写好的检查要求，把每个章节逐条检查一遍。结果只有三种：通过、不通过、需要人工复核。还能一键导出成 Excel 表格报告。",
 "s7": "最后是设置。点小窗口右上角的齿轮图标。常规页可以调：同时下载几张单，每张之间隔几秒，还能打开自动提取和 AI 审计。章节规则页里，勾选要检查哪些章节，再给每个章节写一句检查要求，就像给同事交代任务一样。",
 "s8": "AI 对接页，是告诉小工具用哪家 AI。先选服务商，OpenAI、Anthropic、Gemini，或者公司内部的本地服务都行。再填它的网址、模型名称和密钥，密钥就像账号密码。先点测试连接，通了再点保存并用于审计。密钥只存在你自己的电脑里，发给 AI 之前，敏感内容也会自动打码。",
 "s9": "最后，设置一个八位以上的备份密码，导出加密备份，换电脑也能一键恢复。好啦，拿包、安装、使用、设置，你都学会啦，快去试试吧！",
}
VOICE="zh-CN-YunxiNeural"
async def one(k, text, out):
    c = edge_tts.Communicate(text, VOICE, rate="+6%", pitch="+0Hz", boundary="WordBoundary")
    words=[]
    with open(f"{out}/{k}.mp3","wb") as f:
        async for ch in c.stream():
            if ch["type"]=="audio": f.write(ch["data"])
            elif ch["type"]=="WordBoundary":
                words.append({"text":ch["text"],"start":ch["offset"]/1e7,"end":(ch["offset"]+ch["duration"])/1e7})
    return {"id":k,"text":text,"words":words}
async def main(out):
    import os
    try: old={x["id"]:x for x in json.load(open(f"{out}/words.json"))}
    except Exception: old={}
    res=[]
    for k,t in LINES.items():
        o=old.get(k)
        if o and o["text"]==t and os.path.exists(f"{out}/{k}.mp3"): res.append(o)
        else: res.append(await one(k,t,out))
    json.dump(res,open(f"{out}/words.json","w"),ensure_ascii=False,indent=1)
asyncio.run(main(sys.argv[1]))
