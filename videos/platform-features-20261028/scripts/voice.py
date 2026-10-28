import asyncio,json,pathlib,sys,subprocess,re,os
import edge_tts
BASE=pathlib.Path(__file__).resolve().parents[1]
WORK=pathlib.Path(os.environ.get('VIDEO_WORK_DIR','/Volumes/256G/DragonVideoWork/feature-guides-20261028'))
def spoken_text(text, pronunciations):
 for original,phonetic in pronunciations.items():text=text.replace(original,phonetic)
 return text

def cache_matches(cached,text,spoken,profile):
 return cached.get('text')==text and cached.get('spoken')==spoken and cached.get('profile')==profile

async def main(key):
 spec=json.loads((BASE/'specs'/f'{key}.json').read_text());d=WORK/key/'assets/voice';d.mkdir(parents=True,exist_ok=True);records=[]
 for s in spec['scenes']:
  path=d/f"{s['id']}.mp3";meta=d/f"{s['id']}.json"
  spoken=spoken_text(s.get('spoken',s['say']),spec.get('pronunciations',{}))
  cached=json.loads(meta.read_text()) if meta.exists() else {}
  if path.exists() and cache_matches(cached,s['say'],spoken,spec['voice']):
   rec=json.loads(meta.read_text())
  else:
   for attempt in range(3):
    try:
     words=[];audio=bytearray()
     async for item in edge_tts.Communicate(spoken,spec['voice']['name'],rate=spec['voice']['rate'],pitch=spec['voice'].get('pitch','+0Hz'),boundary='WordBoundary').stream():
      if item['type']=='audio':audio.extend(item['data'])
      elif item['type']=='WordBoundary':words.append(dict(text=item['text'],start=item['offset']/1e7,end=(item['offset']+item['duration'])/1e7))
     if not words:raise ValueError('No speech boundaries')
     path.write_bytes(audio);rec=dict(id=s['id'],text=s['say'],spoken=spoken,profile=spec['voice'],words=words);meta.write_text(json.dumps(rec,ensure_ascii=False));break
    except Exception:
     if attempt==2:raise
     await asyncio.sleep(2)
  rec['audioDuration']=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)]))
  records.append(rec);print(key,s['id'],round(rec['audioDuration'],1),'seconds',flush=True)
 (WORK/key/'voice.json').write_text(json.dumps(records,ensure_ascii=False,indent=1))
if __name__=='__main__':asyncio.run(main(sys.argv[1]))
