import asyncio, json, sys, edge_tts
LINES = {
 "s1": "嗨，我是小审！今天带你三步玩转 NetCare RFC 方案与 AI 审计扩展：安装、使用、配置，一次讲清楚。",
 "s2": "第一步，打包。打开 F12 扩展打包，在系统内置脚本里选中 NetCare RFC 方案与 AI 审计，点击生成，就能拿到一个扩展 ZIP 啦。",
 "s3": "第二步，安装。解压 ZIP，打开浏览器的扩展页面，Chrome 和 Edge 都支持。打开开发者模式，点击加载已解压的扩展程序，选中那个文件夹，就装好啦。",
 "s4": "第三步，使用。刷新已登录的 NetCare 页面，点击工具栏里的扩展图标，再点启动脚本，右下角就会弹出浮窗。输入一个或多个 RFC 单号，点击查找并下载，每批最多五十单，每单的进度一目了然。",
 "s5": "下载 Word 的同时，还能在线打开方案，自动扫描章节和附件，勾选需要的章节，一键打包成 ZIP。每个章节的原始区域截图，也会一起存证。",
 "s6": "开启 AI 审计，模型会按你写的章节规则逐条检查。结论只有三种：通过、不通过、需要人工复核，还能一键导出 Excel 报告。",
 "s7": "接下来是配置。点浮窗右上角的设置，常规页可以调并发数和请求间隔，打开自动提取与 AI 审计。章节规则页里，勾选要提取的章节，再给每个章节写上检查提示词。",
 "s8": "AI 对接页里，选好协议，OpenAI、Anthropic、Gemini 或者兼容的本地服务都行。填上接口地址、模型 ID 和 Key，先测试连接，再点保存并用于审计。Key 只保存在你本地，敏感信息发给模型之前，也会自动脱敏。",
 "s9": "最后，设置一个八位以上的备份密码，导出加密备份，换电脑也能一键恢复。好啦，打包、安装、使用、配置，你都学会啦，快去试试吧！",
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
    res=[await one(k,t,out) for k,t in LINES.items()]
    json.dump(res,open(f"{out}/words.json","w"),ensure_ascii=False,indent=1)
asyncio.run(main(sys.argv[1]))
