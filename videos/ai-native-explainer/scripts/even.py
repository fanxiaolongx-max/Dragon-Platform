# 把 MusicGen 生成的 BGM 做逐段响度均衡（避免中途忽大忽小），输出 bgm_even.wav
import numpy as np, wave
w = wave.open('assets/music/bgm_raw.wav'); sr = w.getframerate()
x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
win, hop = int(sr * 3), int(sr * .5); n = len(x); centers = np.arange(0, n, hop)
rms = np.array([np.sqrt(np.mean(x[max(0, c - win // 2):c + win // 2] ** 2) + 1e-9) for c in centers])
g = np.clip(10 ** (-18 / 20) / rms, .5, 6.0); g = np.convolve(np.pad(g, 2, mode='edge'), np.ones(5) / 5, mode='valid')
y = x * np.interp(np.arange(n), centers, g); y = np.tanh(y * 1.1) / np.tanh(1.1); y = y / np.abs(y).max() * .89
o = wave.open('assets/music/bgm_even.wav', 'wb'); o.setnchannels(1); o.setsampwidth(2); o.setframerate(sr); o.writeframes((y * 32767).astype(np.int16).tobytes()); o.close()
print('even', round(n / sr, 1))
