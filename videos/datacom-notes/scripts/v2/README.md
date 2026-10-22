# 数通教学视频（小码系列）

源数据为 `scripts/notes/<article-id>.json`，文章 ID 必须对应公开内置知识库。每集是独立的 `episodes/<id>/` HyperFrames 工程，不要重写旧集的已发布成品。

## 数据约定

- `chapter`：字符串集数；`sourceLabel`：画面来源；`sources`：可核对的标准或官方资料。
- `voice`、`spoken`：声音参数与英文缩写读法。最长缩写先替换；字幕保留原始 `say`。
- `bpm`、`transpose`：复用既有原创配乐的节奏与移调。保持旁白优先，不加入密集旋律。
- `segments`：一幕一个问题。`id`、`kind`、`title`、`say`、`takeaway` 为基础字段；`guide` 可以覆盖默认观察提示，控制在约三行。
- 新图形放在 `scripts/v2/lessons.js`。接口 cost 的方向、消息流与本地处理、泛洪作用域、厂商扩展都要明确。
- 同一图形的数字只保留一个数据源；例示数字标为示例。图形须随旁白分步揭示，不能只把全文放进白底卡片。

## 制作

遵循项目 `AGENTS.md`，先读取当前 HyperFrames skill。需要 Python 的 edge-tts、numpy、Pillow，系统 FFmpeg 和 Node.js。

```bash
python scripts/v2/voice.py <id>       # 旁白与实际逐词时间；缓存会校验原文/读法/声音参数
python scripts/v2/build.py <id>       # 独立场景、字幕、timing.json；真实语音决定时长
python scripts/v2/score.py <id>       # 既有原创谱面 + 频段 carve + 自动 duck + -16 LUFS 目标
cd episodes/<id>
npm run check
npx hyperframes snapshot --review
npx hyperframes preview --background
# 多 worker 渲染需临时帧空间；内置盘不足可将 TMPDIR 指向空间充足的工作盘
npm run render -- --quality delivery --fps 30 --output renders/<id>-master.mp4
```

检查三类图层：背景不得遮住箭头；本地比较不能画成向邻居发送报文；拓扑边方向及代价不能与讲解相反。核心阅读文字至少 28px，字幕 36px；来源与系列信息是次要署名，高清查看。检查全部场景中段、后段、接缝和窄屏缩略图。

完成渲染后从本目录工程根（`videos/datacom-notes`）执行：

```bash
python scripts/v2/verify_render.py <id>
python scripts/export.py <id> episodes/<id>/renders/<id>-master.mp4 18 --copy-hd --preset fast
```

导出只做一次；重导出会递增媒体版本。多个导出必须顺序执行，避免竞争同一份清单。最后在 `tools-platform` 执行 `npm run datacom:publish-videos`、`npm run datacom:verify-videos`，验证远端 Range 与真实播放后再推送代码。规则详见 `tools-platform/docs/datacom-video-publishing.md`。

只提交源码、逐词时间 JSON、封面和清单。MP4/MP3/WAV、`.thumbnails`、`.hyperframes`、`renders` 和虚拟环境不得提交；不要用 `git add -f` 绕过忽略规则。
