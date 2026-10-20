# 用法: python3 scripts/cue_frames.py <note-id> <video.mp4>
# 在每个 cue 关键词被念到的时刻抽一帧（标注 段/关键词/秒数），拼成 renders/frames/<id>-cues.jpg 供核对"画面不晚于旁白"
import json, subprocess, sys, os
note, src = sys.argv[1], sys.argv[2]
cues = json.load(open(f'renders/{note}-cues.json', encoding='utf8'))
seen = set(); cues = [c for c in cues if not ((c['seg'], c['cue']) in seen or seen.add((c['seg'], c['cue'])))]
d = f'renders/frames/{note}-cues'; os.makedirs(d, exist_ok=True)
from PIL import Image, ImageDraw, ImageFont
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 22)
cols = 5; n = len(cues); sheet = Image.new('RGB', (cols * 640, ((n + cols - 1) // cols) * 360))
for i, c in enumerate(cues):
    f = f'{d}/{i:02d}.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(c['abs']), '-i', src, '-frames:v', '1', '-vf', 'scale=640:360', f], check=True)
    im = Image.open(f).convert('RGB'); dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 640, 32], fill=(0, 0, 0)); dr.text((8, 4), f"{c['seg']} | {c['cue']} | {c['abs']}s", font=FONT, fill=(255, 220, 0))
    sheet.paste(im, ((i % cols) * 640, (i // cols) * 360))
sheet.save(f'renders/frames/{note}-cues.jpg', quality=85); print(n, 'cues ->', f'renders/frames/{note}-cues.jpg')
