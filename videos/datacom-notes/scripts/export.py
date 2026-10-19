# 用法: python3 scripts/export.py <note-id> <render.mp4> [poster秒数]
# 输出到 tools-platform/frontend/assets/promotions/datacom/：<id>.mp4（720p 小窗）、<id>-hd.mp4（1080p）、<id>-poster.jpg，并合并 manifest.json
import json, os, subprocess, sys, datetime
note, src = sys.argv[1], sys.argv[2]; pt = sys.argv[3] if len(sys.argv) > 3 else '9'
spec = json.load(open(f'scripts/notes/{note}.json', encoding='utf8'))
out = os.path.abspath('../../tools-platform/frontend/assets/promotions/datacom'); os.makedirs(out, exist_ok=True)
ff = ['ffmpeg', '-v', 'error', '-y', '-i', src]
subprocess.run(ff + ['-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', f'{out}/{note}-hd.mp4'], check=True)
subprocess.run(ff + ['-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-maxrate', '1200k', '-bufsize', '2400k', '-pix_fmt', 'yuv420p',
                     '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', f'{out}/{note}.mp4'], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', pt, '-i', src, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', f'{out}/{note}-poster.jpg'], check=True)
d = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{out}/{note}-hd.mp4']).decode())
mf = f'{out}/manifest.json'
try: man = json.load(open(mf, encoding='utf8'))
except FileNotFoundError: man = {}
today = datetime.date.today().strftime('%Y%m%d'); prev = man.get(note, {}).get('v', '')
seq = int(prev.split('-')[1]) + 1 if prev.startswith(today + '-') else 1
man[note] = {'v': f'{today}-{seq}', 'duration': round(d, 1), 'title': spec['title']}
json.dump(man, open(mf + '.tmp', 'w', encoding='utf8'), ensure_ascii=False, indent=2); os.replace(mf + '.tmp', mf)
print(json.dumps(man[note], ensure_ascii=False))
# 自动登记远程媒体清单；Git 推送前由媒体钩子上传附件，MP4 不进入代码仓库。
subprocess.run(['node', os.path.join(out, '../../../../scripts/prepare-datacom-videos.js'), '--write'], check=True)
print('Remote media registered. Before committing: cd tools-platform && npm run datacom:publish-videos')
