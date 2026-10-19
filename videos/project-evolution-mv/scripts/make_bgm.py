# 程序合成 MV 配乐：120BPM，32 小节 = 64 秒，渐强 → 高潮 → 断崖 → 安静收尾
# 结构（小节从 0 计，1 小节 = 2s）
#   0-3   起点   稀疏钢琴/脉冲        0-8s
#   4-9   抓取   软底鼓 + 踩镲 + 琶音  8-20s
#   10-17 中台化 全鼓组 + 贝斯 + 滚奏   20-36s
#   18-23 高潮   drop，主音+满编        36-48s
#   24-25 断崖   骤停，只剩余音         48-52s
#   26-31 尾声   钢琴 + 弦乐，渐隐      52-64s
import numpy as np, wave, json, os
SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 32
TOTAL = BARS * BAR
N = int(SR * TOTAL)
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)

def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N: return
    s = sig[: N - i]
    L[i:i + len(s)] += s * gain * (1 - max(pan, 0))
    R[i:i + len(s)] += s * gain * (1 + min(pan, 0))

def tt(d): return np.arange(int(SR * d)) / SR
def midi(n): return 440 * 2 ** ((n - 69) / 12)

def lp(x, fc):  # 单极低通
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc); y[i] = acc
    return y
def lp_fast(x, fc):  # FFT 低通，更快
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x))
def hp_fast(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 - 1 / (1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x))

def kick(vol=1.0):
    t = tt(0.45)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) * vol + np.sin(2 * ph) * np.exp(-t * 40) * 0.2 * vol
def clap(vol=1.0):
    t = tt(0.3)
    n = hp_fast(rng.standard_normal(len(t)), 1200)
    env = np.exp(-t * 22) + 0.6 * np.exp(-((t - 0.012) * 400) ** 2)
    return n * env * 0.5 * vol
def snare(vol=1.0):
    t = tt(0.25)
    n = hp_fast(rng.standard_normal(len(t)), 900) * np.exp(-t * 20)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28)
    return (n * 0.5 + tone * 0.5) * vol
def hat(vol=1.0, open_=False):
    t = tt(0.25 if open_ else 0.06)
    n = hp_fast(rng.standard_normal(len(t)), 7000)
    return n * np.exp(-t * (14 if open_ else 80)) * 0.3 * vol
def bass(freq, d=0.45, vol=1.0):
    t = tt(d)
    saw = 2 * ((t * freq) % 1) - 1
    sig = lp_fast(saw, 380) * 0.8 + np.sin(2 * np.pi * freq * t) * 0.6
    env = np.minimum(t * 200, 1) * np.exp(-t * 4.5)
    return sig * env * vol
def pluck(freq, d=1.6, vol=1.0, bright=1.0):
    t = tt(d)
    s = np.zeros_like(t)
    for k, a in enumerate([1, .5, .3, .2, .12, .08], start=1):
        s += a * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (2.0 + 1.4 * k) / bright)
    return s * np.minimum(t * 400, 1) * vol * 0.5
def lead(freq, d=1.0, vol=1.0):
    t = tt(d); s = np.zeros_like(t)
    for det in (-0.012, 0, 0.012):
        f = freq * (1 + det)
        s += 2 * ((t * f) % 1) - 1
    s = lp_fast(s / 3, 2600)
    env = np.minimum(t * 60, 1) * np.exp(-t * 1.6) * np.minimum((d - t) * 20, 1)
    return s * env * vol * 0.5
def pad(freqs, d, vol=1.0):
    t = tt(d); s = np.zeros_like(t)
    for f in freqs:
        for det in (-0.006, 0.006):
            s += 2 * (((t * f * (1 + det)) % 1)) - 1
    s = lp_fast(s / (len(freqs) * 2), 1400)
    env = np.minimum(t / 1.2, 1) * np.minimum((d - t) / 1.2, 1)
    return s * env * vol * 0.55
def riser(d, vol=1.0):
    t = tt(d)
    n = rng.standard_normal(len(t))
    n = hp_fast(n, 1500)
    env = (t / d) ** 2.2
    sw = np.sin(2 * np.pi * np.cumsum(200 + 3000 * (t / d) ** 2) / SR) * 0.15
    return (n * 0.35 + sw) * env * vol
def crash(vol=1.0):
    t = tt(3.0)
    return hp_fast(rng.standard_normal(len(t)), 3500) * np.exp(-t * 1.6) * 0.45 * vol
def impact(vol=1.0):
    t = tt(1.6)
    f = 38 + 60 * np.exp(-t * 6)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.4) * vol

# 和弦进行：Am F C G（每小节一个）
ROOT = [45, 41, 36, 43]   # 低八度根音 MIDI (A2 F2 C2 G2)
CH = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]
def bar_t(b, beat=0.0): return b * BAR + beat * BEAT

# 记录用于画面卡点的关键时刻
marks = {"bpm": BPM, "beat": BEAT, "bar": BAR, "total": TOTAL,
         "sections": {"intro": [0, 8], "scrape": [8, 20], "platform": [20, 36], "climax": [36, 48], "break": [48, 52], "outro": [52, 64]}}

# --- 0-3 起点：稀疏
for b in range(0, 4):
    ch = CH[b % 4]
    add(pluck(midi(ch[2] + 12), 2.4, 0.55), bar_t(b, 0), 1, -0.25)
    if b >= 1: add(pluck(midi(ch[1] + 12), 2.0, 0.45), bar_t(b, 2), 1, 0.25)
    add(pad([midi(n) for n in ch], BAR + 0.8, 0.28 + 0.06 * b), bar_t(b), 1)
for b in range(2, 4):
    add(kick(0.35), bar_t(b, 0)); add(kick(0.25), bar_t(b, 2))
add(riser(BAR, 0.5), bar_t(3), 1)

# --- 4-9 抓取：软底鼓 + 踩镲 + 琶音 + 贝斯
for b in range(4, 10):
    ch = CH[b % 4]
    add(pad([midi(n) for n in ch], BAR + 0.6, 0.3), bar_t(b))
    for k in range(4): add(kick(0.55 + 0.04 * (b - 4)), bar_t(b, k))
    for k in range(8): add(hat(0.5 if k % 2 else 0.8), bar_t(b, k * 0.5))
    for k in range(8):
        add(pluck(midi(ch[k % 3] + 12 + (12 if k % 4 == 3 else 0)), 0.5, 0.5, 0.5), bar_t(b, k * 0.5), 1, (-0.3 if k % 2 else 0.3))
    if b >= 6:
        for k in (0, 1.5, 2.5): add(bass(midi(ROOT[b % 4]), 0.4, 0.55), bar_t(b, k))
    if b >= 8: add(clap(0.5), bar_t(b, 1)); add(clap(0.5), bar_t(b, 3))
add(riser(BAR, 0.6), bar_t(9))
add(snare(0.5), bar_t(9, 3)); add(snare(0.55), bar_t(9, 3.5))

# --- 10-17 中台化：全鼓组 + 贝斯 + 16 分琶音，末两小节滚奏
for b in range(10, 18):
    ch = CH[b % 4]
    add(pad([midi(n) for n in ch], BAR + 0.5, 0.35), bar_t(b))
    for k in range(4): add(kick(0.9), bar_t(b, k))
    add(clap(0.8), bar_t(b, 1)); add(clap(0.8), bar_t(b, 3))
    for k in range(16): add(hat(0.45 + 0.35 * (k % 4 == 2)), bar_t(b, k * 0.25))
    add(hat(0.9, True), bar_t(b, 1.5)); add(hat(0.9, True), bar_t(b, 3.5))
    for k in range(8): add(bass(midi(ROOT[b % 4] + (12 if k % 4 == 3 else 0)), 0.3, 0.7), bar_t(b, k * 0.5))
    for k in range(16):
        add(pluck(midi(ch[k % 3] + 12 + (12 if k % 5 == 4 else 0)), 0.4, 0.45, 0.45), bar_t(b, k * 0.25), 1, (-0.4 if k % 2 else 0.4))
add(riser(2 * BAR, 0.9), bar_t(16))
for k in range(16): add(snare(0.35 + 0.5 * k / 16), bar_t(17, k * 0.25))
for k in range(8): add(snare(0.6 + 0.4 * k / 8), bar_t(17, 2 + k * 0.25)) if False else None

# --- 18-23 高潮：满编。drop 在 bar 18
add(impact(1.0), bar_t(18)); add(crash(1.0), bar_t(18))
for b in range(18, 24):
    ch = CH[b % 4]
    add(pad([midi(n) for n in ch + [ch[0] + 12]], BAR + 0.5, 0.55), bar_t(b))
    for k in range(4): add(kick(1.0), bar_t(b, k))
    add(clap(1.0), bar_t(b, 1)); add(clap(1.0), bar_t(b, 3))
    for k in range(16): add(hat(0.55 + 0.35 * (k % 4 == 2)), bar_t(b, k * 0.25))
    add(hat(1.0, True), bar_t(b, 0.5)); add(hat(1.0, True), bar_t(b, 1.5)); add(hat(1.0, True), bar_t(b, 2.5)); add(hat(1.0, True), bar_t(b, 3.5))
    for k in range(8): add(bass(midi(ROOT[b % 4] + (12 if k % 4 == 3 else 0)), 0.3, 0.85), bar_t(b, k * 0.5))
    for k in range(16):
        add(pluck(midi(ch[k % 3] + 24), 0.35, 0.4, 0.4), bar_t(b, k * 0.25), 1, (-0.5 if k % 2 else 0.5))
    # 主音旋律（每小节两个长音），整体上行
    mel = [[72, 76], [69, 72], [72, 79], [71, 74]][b % 4]
    add(lead(midi(mel[0] + (12 if b >= 20 else 0)), 1.7, 0.75), bar_t(b, 0))
    add(lead(midi(mel[1] + (12 if b >= 20 else 0)), 1.7, 0.75), bar_t(b, 2))
    if b % 2 == 0 and b > 18: add(crash(0.6), bar_t(b))
add(riser(BAR, 1.0), bar_t(23))
for k in range(16): add(snare(0.5 + 0.5 * k / 16), bar_t(23, k * 0.25))

# --- 24-25 断崖：只留低频余音
add(impact(1.0), bar_t(24))
add(pad([midi(45), midi(57), midi(60), midi(64)], 4.2, 0.35), bar_t(24))

# --- 26-31 尾声：钢琴 + 弦乐，渐隐
for b in range(26, 32):
    ch = CH[(b - 26) % 4]
    fade = 1.0 if b < 30 else 0.7
    add(pad([midi(n) for n in ch], BAR + 0.8, 0.40 * fade), bar_t(b))
    for k in range(4):
        add(pluck(midi(ch[k % 3] + 12 + (12 if k == 3 else 0)), 2.2, 0.62 * fade, 1.2), bar_t(b, k), 1, (-0.2 if k % 2 else 0.2))
    if b >= 28: add(pluck(midi(ch[0] - 12), 3.0, 0.5 * fade, 1.6), bar_t(b))
add(pluck(midi(81), 4.5, 0.55, 1.8), bar_t(31, 0), 1, 0.1)   # 最后一个高音留白

# 简易混响：衰减噪声脉冲响应
ir_len = int(SR * 1.6)
ir = rng.standard_normal(ir_len) * np.exp(-np.arange(ir_len) / SR * 3.2)
ir = lp_fast(ir, 5000)
def reverb(x, mix):
    nfft = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]
    return x * (1 - mix) + y * mix * 0.12
L = reverb(L, 0.35); R = reverb(R, 0.35)

# 段落增益：高潮前压低、drop 后抬高，拉开动态对比
tt_ = np.arange(N) / SR
gain = np.interp(tt_, [0, 8, 20, 34, 35.9, 36, 47.9, 48], [1, 1, 0.8, 0.8, 0.95, 1.3, 1.3, 1.0])
L *= gain; R *= gain

# 总线压缩（软削波）+ 归一化 + 首尾淡入淡出
m = np.maximum(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(L / m * 1.9) / np.tanh(1.9), np.tanh(R / m * 1.9) / np.tanh(1.9)
fi = int(SR * 0.4); fo = int(SR * 3.0)
env = np.ones(N); env[:fi] = np.linspace(0, 1, fi); env[-fo:] = np.linspace(1, 0, fo) ** 1.5
L *= env * 0.9; R *= env * 0.9

out = np.stack([L, R], 1)
pcm = (np.clip(out, -1, 1) * 32767).astype('<i2')
os.makedirs('assets', exist_ok=True)
with wave.open('assets/bgm.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
json.dump(marks, open('assets/bgm_marks.json', 'w'), ensure_ascii=False, indent=1)
print('ok', TOTAL, 's')
