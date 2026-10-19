# 用法: python3 scripts/mix_bgm.py <note-id>
# 先运行 build.py。按 index.html 中配音位置拼出旁白轨，用 sidechaincompress 让音乐在人声处自动压低。
# 共享素材: assets/music/bgm_raw.wav（bgm.py 生成）→ bgm_even.wav（响度归一）；输出 assets/music/<id>-bgm.mp3
import re, subprocess, sys, os
note = sys.argv[1]
html = open('index.html', encoding='utf8').read()
total = float(re.search(r'data-composition-id="main"[^>]*data-duration="([\d.]+)"', html).group(1))
voices = re.findall(r'<audio id="el-[\w-]+-voice" src="([^"]+)" data-start="([\d.]+)"', html)
probe = lambda f: float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())
src = 'assets/music/bgm_even.wav'
if not os.path.exists(src):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'assets/music/bgm_raw.wav', '-af', 'highpass=f=35,loudnorm=I=-20:TP=-2:LRA=7', '-ar', '44100', src], check=True)
dur = probe(src)
# 1) 不够长就用中段交叉淡入循环续上
ext = src
if dur < total + 1:
    ext = f'assets/music/{note}-bgm_long.wav'; need = total + 6 - dur
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ss', str(min(40, dur / 3)), '-t', str(need + 6), '-i', src,
                    '-filter_complex', '[0][1]acrossfade=d=5:c1=tri:c2=tri', ext], check=True)
# 2) 旁白轨
nar = f'assets/music/{note}-narration.wav'
args = ['ffmpeg', '-v', 'error', '-y']
for f, _ in voices: args += ['-i', f]
fc = ''.join(f'[{i}]adelay={int(float(s)*1000)}|{int(float(s)*1000)},aresample=44100,pan=mono|c0=c0[v{i}];' for i, (_, s) in enumerate(voices))
fc += ''.join(f'[v{i}]' for i in range(len(voices))) + f'amix=inputs={len(voices)}:normalize=0,apad=whole_dur={total}[out]'
subprocess.run(args + ['-filter_complex', fc, '-map', '[out]', '-t', str(total), nar], check=True)
# 3) 侧链压缩：有人声时音乐降约 10~12 dB，停顿时 0.6 秒内回升
fc = ('[0]aresample=44100,pan=stereo|c0=c0|c1=c0,highpass=f=40,volume=0.8[m];[1]aresample=44100,pan=stereo|c0=c0|c1=c0,volume=2.5[sc];'
      '[m][sc]sidechaincompress=threshold=0.02:ratio=10:attack=40:release=650:makeup=1:knee=4[d];'
      f'[d]alimiter=limit=0.9,afade=t=in:d=1,afade=t=out:st={total-4}:d=4[o]')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', ext, '-i', nar, '-filter_complex', fc,
                '-map', '[o]', '-t', str(total), '-ar', '44100', '-b:a', '192k', f'assets/music/{note}-bgm.mp3'], check=True)
print('total', total, 'voices', len(voices))
