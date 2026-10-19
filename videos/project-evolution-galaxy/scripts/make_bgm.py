# 史诗预告片风格配乐（程序合成，原创）
# 120BPM，44 小节 = 88 秒，D 小调；尾声转向 F 大调
#   0-8    冷开场   低频长音 + 远处钢琴
#   8-20   萌芽     弦乐固定音型 + 星星点亮的铃声
#   20-36  成长     太鼓 + 每个里程碑一声 braam
#   36-48  加速     全鼓组 + 16 分音型 + 时钟滴答
#   48-52  蓄力     无限上升音 + 军鼓滚奏，51.5 秒骤停半拍
#   52-64  高潮     impact + braam + 主旋律
#   64-68  余震     只剩混响尾巴与两声钢琴
#   68-88  尾声     钢琴 + 弦乐，落在 F 大调
import numpy as np, wave, json, os
SR = 44100
BEAT, BAR = 0.5, 2.0
TOTAL = 88.0
N = int(SR * TOTAL)
rng = np.random.default_rng(11)
L = np.zeros(N); R = np.zeros(N)
DRY_L = np.zeros(N); DRY_R = np.zeros(N)   # 不进混响的低频

def add(sig, t, gain=1.0, pan=0.0, dry=False):
    i = int(round(t * SR))
    if i >= N or i < 0: return
    s = sig[: N - i] * gain
    a, b = (DRY_L, DRY_R) if dry else (L, R)
    a[i:i + len(s)] += s * min(1, 1 - pan)
    b[i:i + len(s)] += s * min(1, 1 + pan)

def T(d): return np.arange(int(SR * d)) / SR
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def saw(f, t): return 2 * ((f * t) % 1) - 1
def lp(x, fc, order=4):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / (1 + (f / fc) ** order), len(x))
def hp(x, fc, order=4):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * (1 - 1 / (1 + (f / fc) ** order)), len(x))
def env_ar(t, a, d):  # attack 线性，指数衰减
    return np.minimum(t / max(a, 1e-4), 1) * np.exp(-t / d)

# ---------- 音色 ----------
def drone(notes, d, vol):
    t = T(d); s = np.zeros_like(t)
    for n in notes:
        f = midi(n)
        for det in (-0.004, 0.0, 0.005):
            s += saw(f * (1 + det), t)
        s += np.sin(2 * np.pi * f / 2 * t) * 1.5
    s = lp(s, 420)
    lfo = 0.75 + 0.25 * np.sin(2 * np.pi * 0.11 * t)
    e = np.minimum(t / 2.5, 1) * np.minimum((d - t) / 2.5, 1)
    return s * lfo * e * vol / (len(notes) * 4)

def braam(root, d=4.0, vol=1.0, seed=0):
    t = T(d); s = np.zeros_like(t)
    r = np.random.default_rng(seed)
    for n in (root, root + 7, root + 12, root - 12):
        f = midi(n)
        for _ in range(4):
            s += saw(f * (1 + r.uniform(-0.012, 0.012)), t)
    dark, bright = lp(s, 220), lp(s, 1600)
    open_ = np.clip(t / 0.35, 0, 1) * np.exp(-t / 1.4)
    s = dark * (1 - open_) + bright * open_
    s = np.tanh(s / 6 * 2.2)
    e = np.minimum(t / 0.04, 1) * np.exp(-t / 1.6) * np.minimum((d - t) / 0.4, 1)
    sub = np.sin(2 * np.pi * midi(root - 12) * t) * np.exp(-t / 1.8)
    return (s * 0.8 + sub * 0.7) * e * vol

def impact(vol=1.0):
    t = T(3.5)
    f = 30 + 90 * np.exp(-t * 7)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.1)
    n = lp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 6)
    return (sub * 1.0 + n * 0.5) * vol

def taiko(vol=1.0, pitch=1.0):
    t = T(0.9)
    f = (60 + 110 * np.exp(-t * 30)) * pitch
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.28)
    click = lp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 60) * 0.4
    return (body + click) * vol

def kick(vol=1.0):
    t = T(0.5)
    f = 42 + 120 * np.exp(-t * 32)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16) * vol

def snare(vol=1.0, long=False):
    t = T(0.6 if long else 0.25)
    n = hp(rng.standard_normal(len(t)), 1000) * np.exp(-t / (0.16 if long else 0.06))
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05)
    return (n * 0.55 + tone * 0.45) * vol

def tick(vol=1.0):
    t = T(0.04)
    return np.sin(2 * np.pi * 3200 * t) * np.exp(-t / 0.006) * vol

def crash(vol=1.0):
    t = T(4.0)
    return hp(rng.standard_normal(len(t)), 4000) * np.exp(-t / 1.0) * 0.35 * vol

def ost(n, d=0.22, vol=1.0, bright=1200):
    t = T(d)
    f = midi(n)
    s = saw(f, t) + saw(f * 1.006, t) * 0.7
    return lp(s, bright) * env_ar(t, 0.004, d / 3) * vol * 0.45

def bell(n, vol=1.0):
    t = T(3.0); f = midi(n); s = np.zeros_like(t)
    for k, a, dec in ((1, 1, 1.4), (2.76, 0.45, 0.6), (5.4, 0.25, 0.3), (8.93, 0.1, 0.15)):
        s += a * np.sin(2 * np.pi * f * k * t) * np.exp(-t / dec)
    return s * np.minimum(t / 0.002, 1) * vol * 0.35

def piano(n, d=3.0, vol=1.0):
    t = T(d); f = midi(n); s = np.zeros_like(t)
    for k, a in enumerate((1, .55, .32, .2, .12, .07, .04), start=1):
        s += a * np.sin(2 * np.pi * f * k * (1 + 0.0004 * k * k) * t) * np.exp(-t * (0.9 + 0.9 * k))
    s += 0.25 * np.sin(2 * np.pi * f * 1.002 * t) * np.exp(-t * 1.1)
    return s * np.minimum(t / 0.003, 1) * np.minimum((d - t) / 0.2, 1) * vol * 0.4

def strings(notes, d, vol=1.0, bright=1500, attack=1.2):
    t = T(d); s = np.zeros_like(t)
    vib = 1 + 0.003 * np.sin(2 * np.pi * 5.2 * t)
    for n in notes:
        f = midi(n)
        for det in (-0.007, -0.002, 0.003, 0.008):
            s += saw(f * (1 + det) * vib, t)
    s = lp(s, bright)
    e = np.minimum(t / attack, 1) * np.minimum((d - t) / min(1.0, d / 3), 1)
    return s * e * vol / (len(notes) * 4) * 0.9

def lead(n, d, vol=1.0):
    t = T(d); f = midi(n); s = np.zeros_like(t)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(t / 0.6, 1)
    for det in (-0.01, -0.004, 0, 0.004, 0.01):
        s += saw(f * (1 + det) * vib, t)
    s = lp(s / 5, 2200)
    e = np.minimum(t / 0.25, 1) * np.minimum((d - t) / 0.4, 1)
    return s * e * vol * 0.5

def shepard(d, vol=1.0):
    t = T(d); s = np.zeros_like(t)
    oct_ = 2.0 * t / d                     # 共上升两个八度
    for k in range(8):
        lf = 5.5 + k + oct_                 # log2 频率
        lf = 5.5 + ((lf - 5.5) % 8)
        f = 2 ** lf
        amp = np.exp(-((lf - 9.2) ** 2) / 2.2)
        s += amp * np.sin(2 * np.pi * np.cumsum(f) / SR)
    return s * (0.15 + 0.85 * (t / d) ** 1.5) * vol * 0.35

def noise_swell(d, vol=1.0):
    t = T(d)
    return lp(rng.standard_normal(len(t)), 2500) * (t / d) ** 3 * vol * 0.4

# ---------- 编排 ----------
CH = {'Dm': [50, 53, 57], 'Bb': [46, 50, 53], 'F': [53, 57, 60], 'C': [48, 52, 55], 'Gm': [43, 46, 50], 'A': [45, 49, 52]}
ROOT = {'Dm': 38, 'Bb': 34, 'F': 41, 'C': 36, 'Gm': 43, 'A': 33}
PROG = ['Dm', 'Bb', 'F', 'C']
def bt(b, beat=0.0): return b * BAR + beat * BEAT
STAR_TIMES = [9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0]
MILESTONES = [20, 24, 28, 32, 36, 40, 44]
NUMBERS = [52, 56, 60]

# 冷开场 0-8
add(drone([38, 45], 22, 0.9), 0.0, dry=True)
for t, n in ((1.0, 74), (3.0, 69), (5.0, 77), (6.5, 76)): add(piano(n, 4, 0.55), t, 1, 0.15)
add(noise_swell(2.0, 0.8), 6.0)

# 萌芽 8-20
for b in range(4, 10):
    c = PROG[b % 4]
    add(strings([n + 12 for n in CH[c]], BAR + 0.6, 0.45), bt(b))
    for k in range(8):
        notes = [CH[c][0] + 12, CH[c][0] + 12, CH[c][1] + 12, CH[c][0] + 12, CH[c][2] + 12, CH[c][0] + 12, CH[c][1] + 12, CH[c][2]]
        add(ost(notes[k], 0.22, 0.35 + 0.05 * (b - 4), 700 + 80 * (b - 4)), bt(b, k * 0.5), 1, -0.35 if k % 2 else 0.35)
    add(kick(0.45), bt(b), dry=True)
    if b >= 7:
        for k in range(8): add(tick(0.12), bt(b, k * 0.5), 1, 0.3)
pent = [74, 77, 79, 81, 84, 86, 81, 79, 84, 86, 89]
for i, t in enumerate(STAR_TIMES): add(bell(pent[i], 0.5), t, 1, (-0.5 + i / 10))

# 成长 20-36
for b in range(10, 18):
    c = PROG[b % 4]
    add(strings([n + 12 for n in CH[c]] + [CH[c][0]], BAR + 0.5, 0.5, 2000), bt(b))
    add(drone([ROOT[c] + 12], BAR + 0.3, 0.6), bt(b), dry=True)
    for k in range(8):
        notes = [CH[c][0] + 12, CH[c][0] + 24, CH[c][1] + 12, CH[c][0] + 12, CH[c][2] + 12, CH[c][0] + 24, CH[c][1] + 12, CH[c][2] + 12]
        add(ost(notes[k], 0.2, 0.55, 1600), bt(b, k * 0.5), 1, -0.4 if k % 2 else 0.4)
    add(taiko(0.9), bt(b, 0), dry=True); add(taiko(0.6, 1.2), bt(b, 1.5), dry=True); add(taiko(0.7, 0.9), bt(b, 2))
    if b >= 12: add(snare(0.7, True), bt(b, 2))
    for k in range(8): add(tick(0.14), bt(b, k * 0.5 + 0.25), 1, 0.3)
for i, t in enumerate(MILESTONES[:4]):
    c = PROG[int(t / BAR) % 4]
    add(braam(ROOT[c] + 12, 3.8, 0.85, i), t, 1, -0.2); add(braam(ROOT[c] + 12, 3.8, 0.85, 100 + i), t, 1, 0.2)
    add(impact(0.5), t, dry=True)

# 加速 36-48
for b in range(18, 24):
    c = PROG[b % 4]
    add(strings([n + 12 for n in CH[c]] + [CH[c][0] + 24], BAR + 0.5, 0.6, 2600), bt(b))
    add(drone([ROOT[c] + 12], BAR + 0.3, 0.75), bt(b), dry=True)
    for k in range(16):
        seq = [0, 12, 3, 12, 7, 12, 3, 12]
        base = CH[c][0] + 12
        n = base + seq[k % 8] if seq[k % 8] != 3 else CH[c][1] + 12
        add(ost(n, 0.15, 0.55, 2400), bt(b, k * 0.25), 1, -0.45 if k % 2 else 0.45)
    for k in range(4): add(kick(0.85), bt(b, k), dry=True)
    add(snare(0.8, True), bt(b, 1)); add(snare(0.8, True), bt(b, 3))
    add(taiko(0.8), bt(b, 0), dry=True); add(taiko(0.6, 1.3), bt(b, 2.5), dry=True)
    for k in range(16): add(tick(0.16 + 0.1 * (k % 4 == 0)), bt(b, k * 0.25), 1, 0.3)
for k in range(8): add(taiko(0.5 + 0.06 * k, 1.0 + 0.05 * k), bt(23, 2 + k * 0.25), dry=True)
for i, t in enumerate(MILESTONES[4:]):
    c = PROG[int(t / BAR) % 4]
    add(braam(ROOT[c] + 12, 3.8, 0.95, 10 + i), t, 1, -0.25); add(braam(ROOT[c] + 12, 3.8, 0.95, 200 + i), t, 1, 0.25)
    add(impact(0.6), t, dry=True)

# 蓄力 48-52
add(shepard(3.5, 1.0), 48.0)
add(drone([38, 45, 50], 3.6, 0.9), 48.0, dry=True)
roll = []
t = 48.0
while t < 51.5:
    p = (t - 48) / 3.5
    step = 0.25 if p < 0.4 else (0.125 if p < 0.8 else 0.0625)
    add(snare(0.25 + 0.75 * p), t, 1, (-0.2 if int(t * 16) % 2 else 0.2))
    t += step
add(noise_swell(3.5, 1.2), 48.0)

# 高潮 52-64
mel = [(52, 74, 1.9), (54, 77, 1.9), (56, 81, 1.9), (58, 79, 1.9), (60, 81, 1.9), (62, 86, 1.9)]
for b in range(26, 32):
    c = PROG[(b - 26) % 4]
    add(strings([n + 12 for n in CH[c]] + [CH[c][0] + 24, CH[c][1] + 24], BAR + 0.5, 0.75, 3200, 0.2), bt(b))
    add(drone([ROOT[c], ROOT[c] + 12], BAR + 0.3, 0.9), bt(b), dry=True)
    for k in range(16):
        seq = [0, 12, 7, 12, 3, 12, 7, 15]
        n = CH[c][0] + 12 + seq[k % 8]
        add(ost(n, 0.14, 0.6, 3200), bt(b, k * 0.25), 1, -0.5 if k % 2 else 0.5)
    add(kick(1.0), bt(b, 0), dry=True); add(kick(0.8), bt(b, 1.5), dry=True); add(kick(0.9), bt(b, 2.5), dry=True)
    add(snare(1.0, True), bt(b, 2))
    for k in range(8): add(taiko(0.55, 1.1 + 0.1 * (k % 2)), bt(b, k * 0.5), dry=True)
    for k in range(8): add(tick(0.18), bt(b, k * 0.5 + 0.25), 1, 0.3)
for t0, n, d in mel:
    add(lead(n, d, 0.8), t0, 1, -0.15); add(lead(n - 12, d, 0.5), t0, 1, 0.15)
for i, t in enumerate(NUMBERS):
    c = PROG[int((t - 52) / BAR) % 4]
    add(braam(ROOT[c] + 12, 3.9, 1.05, 30 + i), t, 1, -0.3); add(braam(ROOT[c] + 12, 3.9, 1.05, 300 + i), t, 1, 0.3)
    add(impact(1.0), t, dry=True); add(crash(1.0), t)

# 余震 64-68
add(impact(1.0), 64.0, dry=True)
add(braam(38, 4.0, 0.6, 77), 64.0)
add(piano(69, 4, 0.6), 65.0, 1, -0.1); add(piano(74, 4, 0.5), 66.5, 1, 0.1)

# 尾声 68-88：Bb F C Dm | Bb F C C | F F
ep = ['Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'C', 'C', 'F', 'F']
for i, c in enumerate(ep):
    b = 34 + i
    swell = 1.0 + (0.35 if i in (6, 7) else 0)
    final = i >= 8
    notes = CH[c] if not (i == 7) else [48, 53, 55]   # Csus4
    add(strings([n + 12 for n in notes] + [ROOT[c] + 12], BAR + (2.5 if final else 0.6), 0.42 * swell, 1300 + 400 * (i >= 4), 1.0), bt(b))
    if i < 8:
        arp = [notes[0] + 12, notes[1] + 12, notes[2] + 12, notes[1] + 24, notes[2] + 12, notes[1] + 12, notes[0] + 24, notes[2] + 12]
        for k in range(8): add(piano(arp[k], 1.8, 0.42 * (0.9 if k % 2 else 1)), bt(b, k * 0.5), 1, -0.2 if k % 2 else 0.2)
        add(piano(ROOT[c] + 12, 2.5, 0.45), bt(b))
add(piano(65, 5, 0.6), 84.0); add(piano(69, 5, 0.5), 84.0); add(piano(72, 5, 0.5), 84.0); add(piano(77, 5, 0.55), 84.0)
add(bell(89, 0.35), 84.0, 1, 0.2)

# ---------- 混音 ----------
ir_len = int(SR * 3.0)
ir = rng.standard_normal((2, ir_len)) * np.exp(-np.arange(ir_len) / SR * 1.9)
ir[:, : int(SR * 0.02)] *= np.linspace(0, 1, int(SR * 0.02))
ir = np.stack([lp(ir[0], 6000), lp(ir[1], 6000)])
def conv(x, h):
    nfft = 1 << int(np.ceil(np.log2(len(x) + len(h))))
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)[: len(x)]
wetL, wetR = conv(L, ir[0]), conv(R, ir[1])
wscale = np.abs(L).max() / (np.abs(wetL).max() + 1e-9)
L = L * 0.72 + wetL * wscale * 0.45 + DRY_L
R = R * 0.72 + wetR * wscale * 0.45 + DRY_R

t_ = np.arange(N) / SR
# 段落增益曲线：高潮前留余量，51.5-52 骤停半拍
gain = np.interp(t_, [0, 8, 20, 36, 47.9, 48, 51.45, 51.5, 51.99, 52, 63.9, 64, 68, 88],
                 [0.9, 0.9, 0.8, 0.82, 0.85, 0.9, 1.0, 0.0, 0.0, 1.25, 1.25, 1.1, 0.95, 0.95])
L *= gain; R *= gain
m = max(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(L / m * 2.2) / np.tanh(2.2), np.tanh(R / m * 2.2) / np.tanh(2.2)
fo = int(SR * 2.5)
env = np.ones(N); env[: int(SR * 0.2)] = np.linspace(0, 1, int(SR * 0.2)); env[-fo:] = np.linspace(1, 0, fo) ** 1.4
L *= env * 0.92; R *= env * 0.92
pcm = (np.clip(np.stack([L, R], 1), -1, 1) * 32767).astype('<i2')
with wave.open('assets/bgm.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
json.dump({'stars': STAR_TIMES, 'milestones': MILESTONES, 'numbers': NUMBERS, 'total': TOTAL}, open('assets/bgm_marks.json', 'w'))
print('ok')
