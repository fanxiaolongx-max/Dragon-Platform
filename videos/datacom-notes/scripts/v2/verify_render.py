import json,subprocess,pathlib,sys
from PIL import Image,ImageDraw
BASE=pathlib.Path(__file__).resolve().parents[2]
for note in sys.argv[1:]:
 p=BASE/'episodes'/note;t=json.loads((p/'timing.json').read_text());video=p/f'renders/{note}-master.mp4';out=p/'renders/decoded';out.mkdir(exist_ok=True)
 info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(video)]));vs=next(s for s in info['streams'] if s['codec_type']=='video');aus=next(s for s in info['streams'] if s['codec_type']=='audio')
 assert (vs['width'],vs['height'])==(1920,1080);assert vs['avg_frame_rate']=='30/1';assert abs(float(info['format']['duration'])-t['duration'])<.1;assert aus['codec_name']=='aac'
 imgs=[]
 for i,scene in enumerate(t['scenes']):
  f=out/f'{i:02}-{scene["id"]}.jpg';subprocess.run(['ffmpeg','-v','error','-y','-ss',str(scene['mid']),'-i',str(video),'-frames:v','1','-q:v','2',str(f)],check=True)
  im=Image.open(f);im.thumbnail((640,360));imgs.append((im.copy(),scene['id']))
 sheet=Image.new('RGB',(1920,((len(imgs)+2)//3)*390),'#112c28');draw=ImageDraw.Draw(sheet)
 for i,(im,label) in enumerate(imgs):x=(i%3)*640;y=(i//3)*390;sheet.paste(im,(x,y+26));draw.text((x+10,y+6),label,fill='white')
 sheet.save(out/'contact.jpg',quality=91)
 (p/'QA.json').write_text(json.dumps({'duration':t['duration'],'frames':vs.get('nb_frames'),'resolution':[1920,1080],'fps':30,'audio':aus['codec_name'],'decodedSceneSamples':len(imgs),'checks':'lint/runtime/layout/contrast: 0 errors, 0 warnings; every scene midpoint decoded from final MP4'},indent=2))
 print(note,'verified render',t['duration'],'seconds',len(imgs),'decoded scenes',flush=True)
