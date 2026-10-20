# 用法: python3 scripts/export.py <note-id> <render.mp4> [poster秒数]
# 输出到 tools-platform/frontend/assets/promotions/datacom/：<id>.mp4（720p 小窗）、<id>-hd.mp4（1080p）、<id>-poster.jpg，并合并 manifest.json
import json, os, subprocess, sys, datetime, argparse
parser = argparse.ArgumentParser()
parser.add_argument('note'); parser.add_argument('src'); parser.add_argument('poster', nargs='?', default='9')
parser.add_argument('--copy-hd', action='store_true', help='Preserve a verified 1080p H.264/AAC delivery master without recompression')
parser.add_argument('--preset', choices=['slow', 'medium', 'fast'], default='slow')
options = parser.parse_args()
note, src, pt = options.note, options.src, options.poster
spec = json.load(open(f'scripts/notes/{note}.json', encoding='utf8'))
out = os.path.abspath('../../tools-platform/frontend/assets/promotions/datacom'); os.makedirs(out, exist_ok=True)
ff = ['ffmpeg', '-v', 'error', '-y', '-i', src]
if options.copy_hd:
    streams = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', src]))['streams']
    video = next(s for s in streams if s['codec_type'] == 'video')
    assert video['codec_name'] == 'h264' and (video['width'], video['height']) == (1920, 1080), 'copy-hd requires a 1080p H.264 master'
    assert any(s['codec_type'] == 'audio' and s['codec_name'] == 'aac' for s in streams), 'copy-hd requires AAC audio'
    subprocess.run(ff + ['-c', 'copy', '-movflags', '+faststart', f'{out}/{note}-hd.mp4'], check=True)
else:
    subprocess.run(ff + ['-c:v', 'libx264', '-preset', options.preset, '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', f'{out}/{note}-hd.mp4'], check=True)
subprocess.run(ff + ['-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', options.preset, '-crf', '25', '-maxrate', '1500k', '-bufsize', '3000k', '-pix_fmt', 'yuv420p',
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
