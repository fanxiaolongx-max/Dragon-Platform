# Codex Classroom：第二代教学视频

本目录的两集分别讲 DR/BDR 与 FA，保留独立工程，不覆盖第一代 index.html 或已发布视频。

## 复现与后续创作

在 videos/datacom-notes 下执行。依赖 Node 22+、HyperFrames 0.8.181、FFmpeg / FFprobe、Python edge-tts / numpy。配音需联网；音乐与画面制作在本地完成。

```sh
uv venv .venv-v2
uv pip install --python .venv-v2/bin/python edge-tts numpy pillow
.venv-v2/bin/python scripts/v2/voice.py ospf-dr-bdr ospf-fa
.venv-v2/bin/python scripts/v2/build.py ospf-dr-bdr ospf-fa
.venv-v2/bin/python scripts/v2/score.py ospf-dr-bdr ospf-fa
cd episodes/ospf-dr-bdr
npm run check
npm run render -- --quality delivery --fps 30 --output renders/ospf-dr-bdr-master.mp4
```

另一集在 episodes/ospf-fa 使用相同方式。实际口播和逐词时间决定片长，不人为压快或截断语音。原工程 CLI 从 0.8.169 升至 0.8.181，旧片已重新通过 check；新版各集固定 0.8.181。

- 讲解稿以 scripts/notes/<id>.json 为真相，包含来源、发音替换与 voice 配置；修改 say 后必须重新配音、构建与混音。
- voice.py 的缓存同时核对文案、发音替换与声线配置；不会误用旧声线。
- build.py 对齐原稿与真实语音逐词时间；每幕独立子合成，字幕全片单轨。SVG 箭头在构建时测量，求值与 seek 顺序无关。
- score.py 为固定谱面的原创器乐，无外部商业音乐采样。根据实际语音能量 duck，最终目标 -16 LUFS / -1.5 dBTP，成片仍需复测。
- 小码是原创 Codex 灵感角色，用 GSAP 控制关节、点头、挥手、眨眼和说话动作，不是官方 Codex 标志。
- 先对照 RFC 核对条件与例外，再检查所有分镜中点、结论出现的时刻和字幕；仅 check 通过不足以证明教学内容正确。
- 二进制配音、混音、缓存和 MP4 均不提交。成品用根目录 scripts/export.py 导出，再在 tools-platform 执行 npm run datacom:publish-videos。不可覆盖旧媒体版本；发布规则见根项目 AGENTS.md。
