# 用法: python3 scripts/vo.py <note-id>
# 读取 scripts/notes/<id>.json，每段 say 生成一条配音 assets/voice/<id>/<seg>.mp3，并把逐词时间写入 words.json。
# spoken 里的替换只用于发音（字幕仍显示 say 原文），build.py 会做字符对齐。
import asyncio, json, sys, os, edge_tts
VOICE = "zh-CN-YunxiNeural"; RATE = "+10%"
note = sys.argv[1]
spec = json.load(open(f"scripts/notes/{note}.json", encoding="utf8"))
out = f"assets/voice/{note}"; os.makedirs(out, exist_ok=True)
def spoken(text):
    for a, b in spec.get("spoken", []): text = text.replace(a, b)
    return text
async def one(seg):
    text = spoken(seg["say"])
    c = edge_tts.Communicate(text, VOICE, rate=RATE, pitch="+0Hz", boundary="WordBoundary")
    words = []
    with open(f"{out}/{seg['id']}.mp3", "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio": f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"text": ch["text"], "start": ch["offset"] / 1e7, "end": (ch["offset"] + ch["duration"]) / 1e7})
    return {"id": seg["id"], "text": seg["say"], "spoken": text, "words": words}
async def main():
    try: old = {x["id"]: x for x in json.load(open(f"{out}/words.json", encoding="utf8"))}
    except Exception: old = {}
    res = []
    for seg in spec["segments"]:
        o = old.get(seg["id"])
        if o and o["text"] == seg["say"] and o.get("spoken") == spoken(seg["say"]) and os.path.exists(f"{out}/{seg['id']}.mp3"): res.append(o)
        else: res.append(await one(seg)); print("tts", seg["id"])
    json.dump(res, open(f"{out}/words.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
asyncio.run(main())
