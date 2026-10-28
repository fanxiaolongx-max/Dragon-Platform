# Dragon 平台四项新能力 · 小龙功能指南

2026-10-28 按当前代码制作：AI 月报、WeLink CLI、WeLink SDK、数字人数据基座，每项一集普通话讲解视频。以一个具体任务贯穿“痛点 → 操作 → 结果 → 复用/边界”，不承诺未经测量的效率提升。

## 小龙角色规则

用户提供的 `assets/xiaolong-reference.jpg` 是唯一基础角色：青绿色毛毡、大眼睛、圆润牙齿、米白肚皮与三道缝线、背刺与卷尾。`xiaolong-teach.png` / `xiaolong-listen.png` 为透明讲解与倾听姿态。后续新增/修改本系列统一使用小龙，不替换成机器人，不改变角色身份。动作轻微且让位于教学重点。

## 原稿与真实能力

`specs/*.json` 保存旁白、镜头、功能入口和当前代码依据。各集目录包含可编辑 HTML、时间表、配音逐词边界、检查与成片审阅记录。`scripts/capture-ui.cjs` 用真实前端组件配合纯本地假接口截取界面；演示不读取用户数据库、不连接 WeLink、不调用真实基座，不发送消息或执行写操作。

第一集使用 README 已公开的脱敏 AI 月报截图；其余界面使用当前前端代码生成的本地演示配置。业务数字、手机会话概念图均标明示例，不当作真实运营结果。

## 串行制作与磁盘

工作目录：`/Volumes/256G/DragonVideoWork/feature-guides-20261028/`。

配音 MP3、混音、渲染、预览版、审阅截图、临时 Chrome 配置和抽帧缓存都放在该目录。每次只制作、渲染一集，`--workers 1`，先完成验证，再开始下一集；不运行四份渲染。源代码和成片保留，可再生成的重复审阅帧在最终验证后清理。

本系列使用 HyperFrames 0.8.186、FFmpeg、Edge TTS、Noto Sans SC（OFL）及 GSAP。`scripts/voice.py`、`build.py`、`score.py`、`finish.py` 依次完成配音、构建、原创配乐混音和最终验证。语音为合成配音；声音做响度测量，没有人工试听。

## 独立媒体发布规则

成片只有独立媒体仓库 Release，不提交 MP4/配音/缓存到代码仓库。

- 媒体仓库：`fanxiaolongx-max/Dragon-Platform-Media`
- 不可变 Release：`feature-guides-20261028-1`；改片必须新版本/新标签，禁止覆盖。
- 文件：`<id>.mp4` 为 720p 预览，`<id>-hd.mp4` 为 1080p 高清；`<id>-poster.jpg` 为封面。
- `tools-platform/scripts/prepare-home-promo-videos.js` 自动生成大小、整文件和分段 SHA-256，保存到 `backend/home-promo-videos.json`。
- `npm run promo:sync-media` 上传并核验；`node scripts/sync-media-releases.js --check` 验证远端。
- `backend/models/home-promo-videos.js` 复用按需缓存和 Range 播放；页面仍访问 `/assets/promotions/<id>.mp4`，无需把媒体装进桌面包。
- 新增内置视频需要同时登记前端 `promo-video.js`、后端 `BUILTIN_VIDEOS`、媒体清单、桌面排除规则及对应测试；英文界面注明普通话配音，未制作英语版时不得指向不存在的 `-en` 文件。

默认启用四个新视频；平台推广设置仍允许逐个隐藏，保留原有视频和用户推广配置。

## 新克隆重建

在 256G 盘创建 Python venv 并安装 edge-tts、numpy；安装 FFmpeg 和 Node。设置 `VIDEO_WORK_DIR`、`TMPDIR`、`HYPERFRAMES_EXTRACT_CACHE_DIR` 到外置盘。逐集执行 `scripts/voice.py <id>` → `scripts/build.py <id>` → `scripts/score.py <id>`；进入外置盘该集目录运行 check / snapshot / preview 后，以 `render --workers 1 --quality delivery --output renders/<id>-hd.mp4` 生成高清片，最后执行 `scripts/finish.py <id>` 生成预览并核验。

构建器在临时目录里找不到字体、GSAP 或界面截图时，会使用本仓库每集 assets 中保存的素材，因此新克隆不依赖本机旧缓存。更新界面时再运行本地 `capture-ui.cjs`；不要为截图读取真实用户数据。发布改片必须换媒体 Release 标签，不能覆盖本次附件。

## AI 月报配音修订 20261028-2

用户指出“重”的多音字误读后，将“重画、重做、重新、重复”的配音输入指定为同音的 chóng 提示，屏幕文字和字幕保留原文，“严重”等 zhòng 音词不改。发音和声音配置参与缓存键，防止复用旧的错误录音。测试命令：`python scripts/test_pronunciation.py`。修正版单独发布 `ai-monthly-guide-20261028-2`，其余三集仍使用原 Release；禁止覆盖第一版附件。
