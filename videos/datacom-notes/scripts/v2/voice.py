import asyncio,json,pathlib,sys,edge_tts
async def main(note):
    spec=json.loads(pathlib.Path(f'scripts/notes/{note}.json').read_text()); out=pathlib.Path(f'assets/voice/{note}');out.mkdir(parents=True,exist_ok=True)
    profile=spec['voice']; previous={}
    if (out/'words.json').exists(): previous={x['id']:x for x in json.loads((out/'words.json').read_text())}
    async def one(seg):
        text=seg['say']
        for a,b in spec['spoken']:text=text.replace(a,b)
        cache=previous.get(seg['id'])
        if cache and cache.get('spoken')==text and cache.get('profile')==profile and (out/f"{seg['id']}.mp3").exists():return cache
        for attempt in range(3):
            try:
                words=[]; audio=bytearray()
                async for item in edge_tts.Communicate(text,profile['name'],rate=profile['rate'],pitch=profile['pitch'],boundary='WordBoundary').stream():
                    if item['type']=='audio':audio.extend(item['data'])
                    elif item['type']=='WordBoundary':words.append(dict(text=item['text'],start=item['offset']/1e7,end=(item['offset']+item['duration'])/1e7))
                if not audio or not words:raise RuntimeError('Empty speech')
                (out/f"{seg['id']}.mp3").write_bytes(audio)
                print(note,seg['id'],'voice ready',flush=True)
                return dict(id=seg['id'],text=seg['say'],spoken=text,profile=profile,words=words)
            except Exception:
                if attempt==2:raise
                await asyncio.sleep(2)
    result=[]
    for seg in spec['segments']:
        result.append(await one(seg));(out/'words.json').write_text(json.dumps(result,ensure_ascii=False,indent=1))
for note in sys.argv[1:]:asyncio.run(main(note))
