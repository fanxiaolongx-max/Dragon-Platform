# 原创轻器乐：Rhodes / 木琴泛音、稀疏低音、分段留白；固定种子，无第三方音乐素材。
import json,pathlib,sys,subprocess,wave
import numpy as np
BASE=pathlib.Path(__file__).resolve().parents[2];SR=44100

def synth(note):
 spec=json.loads((BASE/f'scripts/notes/{note}.json').read_text());out=BASE/'episodes'/note; timing=json.loads((out/'timing.json').read_text());total=timing['duration'];n=int(total*SR);rng=np.random.default_rng(219 if note=='ospf-dr-bdr' else 331)
 music=np.zeros((n,2),np.float32);voice=np.zeros(n,np.float32)
 def tone(midi,start,dur,amp,pan=0,kind='rhodes'):
  a=int(start*SR);length=min(int(dur*SR),n-a)
  if a<0 or length<=0:return
  t=np.arange(length,dtype=np.float32)/SR;f=440*2**((midi+spec.get('transpose',0)-69)/12)
  if kind=='bass':y=np.sin(2*np.pi*f*t)+.17*np.sin(4*np.pi*f*t);env=(1-np.exp(-t*18))*np.exp(-t/1.1)
  elif kind=='bell':y=np.sin(2*np.pi*f*t)+.22*np.sin(2*np.pi*f*3.01*t)*np.exp(-t*5);env=(1-np.exp(-t*120))*np.exp(-t/0.48)
  else:y=np.sin(2*np.pi*f*t+.18*np.sin(2*np.pi*f*2*t)*np.exp(-t*3))+.16*np.sin(2*np.pi*f*2*t)*np.exp(-t*2);env=(1-np.exp(-t*80))*np.exp(-t/1.6)
  fade=np.minimum(1,(length-np.arange(length))/(SR*.06));y=(y*env*fade*amp).astype(np.float32)
  music[a:a+length,0]+=y*np.sqrt((1-pan)/2);music[a:a+length,1]+=y*np.sqrt((1+pan)/2)
 bpm=spec.get('bpm',84 if note=='ospf-dr-bdr' else 78);beat=60/bpm;bar=4*beat
 chords=[[48,55,59,64,67],[45,52,55,60,64],[41,48,52,57,60],[43,50,55,59,64]]
 for k,start in enumerate(np.arange(0,total,bar)):
  chord=chords[(k//2)%4];strength=.032 if k%8 not in (6,7) else .023
  for j,m in enumerate(chord[1:]):tone(m,start+j*.028,3.4,strength,pan=(j-1.5)*.22)
  tone(chord[0]-12,start+.01,2,.045,kind='bass')
  # 只在隔小节后半段回答，避免持续旋律与旁白抢注意力。
  if k%4 in (1,3):
   for j,idx in enumerate([2,3,2]):tone(chord[idx]+12,start+(2+j*.5)*beat,1.1,.016,pan=.28 if j%2 else -.28,kind='bell')
 # 短房间尾音；不使用密集鼓点。
 for delay,gain in [(.083,.16),(.137,.10)]:
  shift=int(delay*SR);music[shift:]+=music[:-shift].copy()*gain
 for rec in timing['voice']:
  raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(BASE/rec['file']),'-f','f32le','-ac','1','-ar',str(SR),'-'])
  audio=np.frombuffer(raw,np.float32).copy();rms=np.sqrt(np.mean(audio**2));audio*=.105/max(.001,rms)
  a=int(rec['start']*SR);audio=audio[:n-a];voice[a:a+len(audio)]+=audio
 # 为旁白腾出存在感频段：2.2 kHz 宽带衰减，并清除配乐低频累积。
 carved=subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0','-af','highpass=f=120,equalizer=f=2200:t=q:w=0.7:g=-7,lowpass=f=6500','-f','f32le','pipe:1'],input=music.astype('<f4').tobytes(),stdout=subprocess.PIPE,check=True).stdout
 music=np.frombuffer(carved,np.float32).reshape(-1,2).copy()[:n]
 # 以实际语音能量计算平滑 duck，停顿自然恢复。
 block=441;energy=np.array([np.sqrt(np.mean(voice[i:i+block]**2)) for i in range(0,n,block)])
 target=np.where(energy>.018,.24,1.0);smooth=[];v=1.0
 for x in target:
  alpha=.3 if x<v else .018;v+=alpha*(x-v);smooth.append(v)
 env=np.interp(np.arange(n),np.arange(len(smooth))*block,smooth).astype(np.float32)
 envelope=np.minimum(np.arange(n)/(SR*2),(n-np.arange(n))/(SR*3));envelope=np.clip(envelope,0,1)
 music*=env[:,None]*envelope[:,None]
 mixed=voice[:,None]*np.ones((1,2),np.float32)+music
 # 限制峰值后用双通道响度标准化，保留可懂度。
 mixed=np.tanh(mixed*1.1)/1.1
 wav=out/'assets/master-raw.wav'
 with wave.open(str(wav),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((np.clip(mixed,-1,1)*32767).astype('<i2').tobytes())
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-af','highpass=f=65,loudnorm=I=-16:TP=-1.5:LRA=8','-ar','44100','-b:a','192k',str(out/'assets/master.mp3')],check=True)
 wav.unlink()
 (out/'MEDIA.md').write_text('''# 素材来源与混音\n\n- 语音：Edge TTS `zh-CN-XiaoxiaoNeural`，-2% 语速；作者原稿，分句停顿与实际逐词时间同步字幕。\n- 音乐：scripts/v2/score.py 原创固定谱面，Rhodes 泛音、木琴、稀疏低音；无第三方采样、无循环商用音乐。\n- 角色：scripts/v2/mascot.js 原创“小码”，黑白终端与薄荷绿配色；不使用官方 Codex 标志。\n- 图形：原创 SVG，依据 RFC 2328 / RFC 3101 及所列厂商文档；蓝色为控制信息，绿色为选中结果或转发，珊瑚色为限制，数字及限定条件明确。\n- 混音：人声 RMS 匹配、配乐 120Hz 高通 + 2.2kHz/-7dB 宽带 carve + 6.5kHz 低通，实际语音能量驱动的平滑 duck、淡入淡出、最终 -16 LUFS / -1.5 dBTP 目标；无密集鼓点或抢占语言频段的主旋律。\n- 二进制音频和渲染结果被 Git 忽略，成品仅通过独立媒体仓库发布。\n''')
 print(note,'mixed',round(total,1),flush=True)
for note in sys.argv[1:]:synth(note)
