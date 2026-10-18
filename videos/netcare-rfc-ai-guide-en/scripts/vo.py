import asyncio, json, sys, edge_tts
LINES = {
 "s1": "Hi, I'm Audie! Today I'll walk you through the NetCare RFC Plans and AI Audit tool. First, the problem it solves. Then four steps: get the installer, add it to your browser, start using it, and tweak the settings, with every click shown.",
 "bg": "First, the background. An RFC is a network change request, and every request comes with a change plan document. Auditors have to open the requests one by one, download each plan, and check it line by line against a checklist. With lots of requests, it is slow and things get missed. This little tool lives in your browser. It downloads plans in bulk, lets AI do a first pass, and you only read the verdicts.",
 "s2": "Step one: get the installer. Open the Dragon Platform home page, type Extension Packager in the search box, and open F12 Extension Packager. On the left choose Built-in Scripts, click NetCare RFC Plans and AI Audit, then click Generate. You will download a zip file, and that zip is the installer for this tool.",
 "s3": "Step two: add it to your browser. First unzip the file to get a folder. Then type chrome://extensions in the address bar. In Edge, type edge://extensions. Press Enter to open the extensions page. Turn on Developer mode at the top right, then click Load unpacked at the top left, choose the folder you just unzipped, and you are done!",
 "s4": "Step three: start using it. Open the NetCare website, log in, and refresh the page. Then click the puzzle icon at the top right of your browser, find this tool in the list, and click Start Script. A small window pops up at the bottom right of the page.",
 "s4b": "In the small window, paste one or more RFC numbers, the numbers of the change requests you want to check, up to fifty at a time. Click Find and Download, and you will see how far each request has got, one line at a time.",
 "s5": "While downloading the Word plan, it can also open the plan online and automatically find its chapters and attachments. Tick the chapters you care about and pack them into a zip in one click. A screenshot of each chapter exactly as it looks on the page is saved too, as evidence for later.",
 "s6": "With AI Audit switched on, AI follows the rules you wrote and checks every chapter line by line. There are only three verdicts: Pass, Fail, or Needs manual review. You can also export everything as an Excel report in one click.",
 "s7": "Last, the settings. Click the gear icon at the top right of the small window. The General tab lets you choose how many requests download at once and how many seconds to wait between them, and switch on Auto Extract and AI Audit. On the Chapter Rules tab, tick the chapters to check, then write one line of instructions for each, just like briefing a colleague.",
 "s8": "The AI Connection tab tells the tool which AI to use. First pick a provider: OpenAI, Anthropic, Gemini, or even an in-house local service. Then fill in its web address, the model name and the key, which works like a password. Click Test Connection first, and once it works, click Save and Use for Audit. The key stays on your own computer, and sensitive details are masked before anything is sent to the AI.",
 "s9": "Finally, set a backup password of at least eight characters and export an encrypted backup. Even on a new computer, you can restore with one click. That is it! Installer, install, use, settings, you have learned it all. Go and give it a try!",
}
VOICE="en-US-AvaNeural"
async def one(k, text, out):
    c = edge_tts.Communicate(text, VOICE, rate="+3%", pitch="+0Hz", boundary="WordBoundary")
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
