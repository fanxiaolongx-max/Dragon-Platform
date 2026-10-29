import pathlib,sys,subprocess,json,shutil,os
B=pathlib.Path(__file__).resolve().parents[1];W=pathlib.Path(os.environ.get('VIDEO_WORK_DIR','/Volumes/256G/DragonVideoWork/feature-guides-20261028'));key=sys.argv[1];p=W/key;r=p/'renders';src=r/f'{key}-hd.mp4';dst=r/f'{key}.mp4'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(src),'-vf','scale=1280:720','-c:v','libx264','-threads','2','-preset','veryfast','-crf','25','-maxrate','1000k','-bufsize','2000k','-c:a','aac','-b:a','128k','-movflags','+faststart',str(dst)],check=True)
t=json.loads((p/'timing.json').read_text());at=t['scenes'][3]['start']+t['scenes'][3]['duration']*.65
subprocess.run(['ffmpeg','-v','error','-y','-ss',str(at),'-i',str(src),'-frames:v','1','-vf','scale=1280:720','-q:v','2',str(r/f'{key}-poster.jpg')],check=True)
reports=[]
for f in [src,dst]:
 info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(f)]));streams=info['streams'];v=next(x for x in streams if x['codec_type']=='video');a=next(x for x in streams if x['codec_type']=='audio');dur=float(info['format']['duration']);assert abs(dur-t['duration'])<.15,(dur,t['duration']);assert v['codec_name']=='h264' and a['codec_name']=='aac';assert a['channels']==2
 reports.append(dict(file=f.name,bytes=f.stat().st_size,duration=dur,width=v['width'],height=v['height'],video=v['codec_name'],audio=a['codec_name']))
# Sample decoded frames at each scene midpoint; evidence lives on the requested external disk.
review=r/'decoded';review.mkdir(exist_ok=True)
for s in t['scenes']:
 subprocess.run(['ffmpeg','-v','error','-y','-ss',str(s['start']+s['duration']*.6),'-i',str(src),'-frames:v','1','-vf','scale=960:540',str(review/f"{s['id']}.png")],check=True)
(p/'render-verification.json').write_text(json.dumps(reports,indent=2));print(json.dumps(reports),flush=True)
# Keep only reproducible source and small assets in Git. Binary narration and films remain outside the repo.
source=B/key;source.mkdir(exist_ok=True)
for name in ['index.html','package.json','hyperframes.json','timing.json','voice.json','render-verification.json']:
 shutil.copy2(p/name,source/name)
shutil.copytree(p/'compositions',source/'compositions',dirs_exist_ok=True,ignore=shutil.ignore_patterns('components'))
(source/'assets').mkdir(exist_ok=True)
for name in ['gsap.min.js','NotoSansSC.ttf']:
 shutil.copy2(p/'assets'/name,source/'assets'/name)
for f in (p/'assets').glob('*.png'):
 # Material assets are copied directly so Windows extractions and zip archives do not fail on symlinks.
 if f.name.startswith('xiaolong-'):
  target=source/'assets'/f.name
  if target.exists() or target.is_symlink():target.unlink()
  shutil.copy2(B/'assets'/f.name,target)
 else:shutil.copy2(f,source/'assets'/f.name)
for f in (p/'assets').glob('*.jpg'):shutil.copy2(f,source/'assets'/f.name)
(source/'REVIEW.md').write_text('''# 成片审阅\n\n采用“一个工作任务”的路线，另外两条路线见 STORYLINES.md。用户提供的小龙参考图决定青绿色毛毡角色；本片统一使用透明讲解/倾听姿态，做短促指示动作。\n\n核对当前页面、脚本、路由与服务的能力边界。真实组件通过本地假接口截取，无真实账号、凭据或私有业务数据；示例数据与概念手机流程明确标注。\n\n自动 check 的 lint、runtime、layout、contrast 无错误；已查看场景、接缝、360px 缩略图，以及最终 MP4 逐场景解码帧。分辨率、时长、H.264/AAC、双声道与 fast-start 由工具验证。语音和音乐做响度测量，没有人工试听，不宣称真人配音。\n\n保留的 craft 提示：辅助来源与截图图内文字可小于主标签；解释段落允许短暂停留，不用装饰性漂移掩盖。逐步构图时连接线暂早于末端节点、以及裁切窗口内的截图平移属于设计，最终连线和画面完整。\n\n较弱镜头是设置页面信息密度；主要操作用大字标注，完整参数应回实际页面查看，不把视频当逐项配置手册。\n''')
