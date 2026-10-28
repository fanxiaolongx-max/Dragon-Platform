# Fixed original chamber-pop score; no downloaded music, no copyrighted samples.
import json,pathlib,subprocess,sys,wave,os
import numpy as np
W=pathlib.Path(os.environ.get('VIDEO_WORK_DIR','/Volumes/256G/DragonVideoWork/feature-guides-20261028')); key=sys.argv[1];p=W/key;t=json.loads((p/'timing.json').read_text());SR=32000;n=int(t['duration']*SR);music=np.zeros((n,2),np.float32);voice=np.zeros(n,np.float32)
shift={'ai-monthly-guide':0,'welink-cli-guide':2,'welink-sdk-guide':5,'digital-human-guide':-2}[key]
def tone(m,start,dur,amp,pan=0,kind='piano'):
 a=int(start*SR);l=min(int(dur*SR),n-a)
 if l<=0:return
 tt=np.arange(l,dtype=np.float32)/SR;f=440*2**((m+shift-69)/12)
 env=(1-np.exp(-tt*65))*np.exp(-tt/(1.8 if kind=='piano' else .7))
 y=np.sin(2*np.pi*f*tt)+.2*np.sin(4*np.pi*f*tt)*np.exp(-tt*3)+.07*np.sin(6*np.pi*f*tt)*np.exp(-tt*4)
 y*=env*amp*np.minimum(1,(l-np.arange(l))/(SR*.04))
 music[a:a+l,0]+=y*np.sqrt((1-pan)/2);music[a:a+l,1]+=y*np.sqrt((1+pan)/2)
beat=60/86;bar=beat*4;chords=[[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]]
for i,start in enumerate(np.arange(0,t['duration'],bar)):
 c=chords[(i//2)%4]
 if i%8!=7:
  for j,m in enumerate(c[1:]):tone(m,start+j*.035,3.3,.034,pan=(j-1)*.3)
  tone(c[0]-12,start,2,.039,kind='bass')
 if i%4==3:
  for j,m in enumerate([c[2]+12,c[1]+12]):tone(m,start+(2+j*.75)*beat,1,.013,pan=.25)
for s in t['scenes']:
 raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(p/'assets/voice'/f"{s['id']}.mp3"),'-f','f32le','-ac','1','-ar',str(SR),'-'])
 v=np.frombuffer(raw,np.float32).copy();v*=.12/max(.001,np.sqrt(np.mean(v**2)));a=int((s['start']+.35)*SR);v=v[:n-a];voice[a:a+len(v)]+=v
 # A quiet tactile tick when a new step begins, well below the voice.
 tone(84,s['start']+.12,.16,.028,kind='tick')
block=320;energy=np.array([np.sqrt(np.mean(voice[i:i+block]**2)) for i in range(0,n,block)]);gain=1.;smooth=[]
for e in energy:
 target=.22 if e>.017 else .85;gain+=(target-gain)*(.32 if target<gain else .015);smooth.append(gain)
duck=np.interp(np.arange(n),np.arange(len(smooth))*block,smooth).astype(np.float32)
fade=np.clip(np.minimum(np.arange(n)/(SR*1.5),(n-np.arange(n))/(SR*2.5)),0,1);music*=duck[:,None]*fade[:,None]
mix=np.tanh(voice[:,None]+music);raw=p/'assets/master.wav'
with wave.open(str(raw),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((mix*32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg','-v','error','-y','-i',str(raw),'-af','highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=8','-ar','44100','-b:a','192k',str(p/'assets/master.mp3')],check=True)
raw.unlink();print(key,'master mixed',t['duration'],flush=True)
