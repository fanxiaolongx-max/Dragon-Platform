# 对话语音输入

首页输入框的麦克风支持普通对话、工作区、第三方 Agent、频道与讨论组等复用 `dcInput` 的会话。它只将录音转为草稿文字，不发送消息或改变当前智能体；现有发送、排队、权限与连接器链路照常工作。不包括微信等外部客户端自己的输入界面。

点击麦克风开始录音，第一次需要浏览器/系统允许麦克风。不弹录音提示框：麦克风变为红色停止图标，再点即结束录音并识别；识别时为旋转状态，再点取消。长按按钮或按 Esc、切换对话、进入后台、输入框变为不可用会停止录音并丢弃未完成结果。识别来源通过按钮光晕区分，具体来源与降级状态可通过悬停提示查看。转写结果插入录音开始时的光标位置；如果用户期间编辑过草稿，则追加文字，不覆盖编辑。识别完成后用户可修改、确认发送。最长 120 秒、8MB，支持中英文等原语言识别。

录音通过 `MediaRecorder` 生成 WebM/Opus（Chrome/Electron）或 MP4（Safari）。识别与当前对话智能体独立：优先使用同租户已配置的 Gemini 或专用转写模型（`whisper-1`、`gpt-transcribe`、`gpt-4o-transcribe`、`gpt-4o-mini-transcribe`，含受支持日期后缀）。专用转写接口采用所配置供应商的 `/audio/transcriptions`；普通 DeepSeek、GLM 文本模型不会被误判为可识别音频。首选失败时最多再试一个可用语音方案，之后使用已就绪的 whisper.cpp 离线引擎，返回实际来源和 `degraded` 标记。

如果平台侧没有可用引擎，浏览器支持 SpeechRecognition 时可使用浏览器识别。只有检测到端侧语言资源已就绪时，才标“浏览器离线”；其他情况明确标“可能联网”。云端失败又无平台离线引擎时，浏览器无法普遍复用已录完的音频，会提示失败并将下一次录音切到浏览器识别。取消或权限拒绝不会触发另一个引擎。

设置 `TOOLS_SPEECH_MODE=offline` 可强制禁止模型 API 和浏览器在线识别，只用平台或浏览器已就绪的离线引擎；没有可用资源时提示未就绪，不静默联网。当前没有直接封装 Windows／macOS 原生 Speech SDK，不能将浏览器识别误称为已集成原生系统离线能力。

音频不保存为对话附件、不写会话记录或日志。云端在内存中处理；平台 Whisper 将音频暂存到权限 0700 的独立临时目录，转换及识别完成／取消后删除，只保留草稿文字。Gemini 计入既有 AI 用量；专用 ASR 按供应商计费，暂不估算进平台 token 用量。文字由用户发送后才进入对应会话。浏览器需要 HTTPS 或 localhost；桌面端在用户点击后请求麦克风权限，macOS 包含音频输入 entitlement 和用途说明。

## 可选离线引擎与体积

不自动下载、不捆绑模型或运行程序，不会因模型显著增加安装包。管理员可复用机器上的运行程序和多语言 GGML 模型；运行时模型占独立磁盘空间。Web／手机的“平台离线识别”运行在平台服务器，音频仍需通过内网送到该服务器，不等于在手机本机运算。

- `TOOLS_SPEECH_WHISPER_PATH`：whisper.cpp 的 `whisper-cli`／`whisper-cli.exe`。
- `TOOLS_SPEECH_FFMPEG_PATH`：ffmpeg。
- `TOOLS_SPEECH_WHISPER_MODEL`：现成 GGML 模型文件完整路径。或 `TOOLS_SPEECH_MODEL_DIR` 指定模型目录，自动查找 `ggml-small.bin`／`ggml-base.bin`／量化 base／tiny。
- 未指定程序时从 PATH 和常见安装位置查找；模型默认查找用户缓存、DragonClaw 应用支持目录。缺程序或缺模型时只回报状态，不修改系统。

Apple SpeechAnalyzer 可由系统管理并按需下载端侧模型，不把资源打进应用包；Windows Win＋H 依赖在线识别，不能作为通用离线保证。中文准确率、专业词和混合语言效果需要实际语料测试，不能直接承诺系统引擎比模型识别更准。

## API

- `GET /api/ai/speech`：登录后返回可用状态及大小、时长限制，不返回凭据。
- `POST /api/ai/speech`：登录、同源校验；multipart 字段 `audio`，返回 `{text, source, degraded}`。普通账号可识别自己的录音。文件头与 MIME 都验证，单租户/账号限一条进行中请求，75 秒总超时，断开连接中止识别。multipart 完成后重绑原租户上下文。
- `speech:microphone`：Electron IPC 仅本地主窗口首页主 frame 可请求；不会给第三方网页提供麦克风桥。

## 验证

```sh
node --test tests/ai-speech.test.js tests/local-speech.test.js tests/desktop-speech.test.js tests/ai-provider-tool-calling.test.js tests/asset-versioning.test.js tests/tenant-isolation.test.js tests/tenant-backup-boundaries.test.js tests/desktop-agent-composer-dock.test.js
node_modules/.bin/electron tests/voice-input-browser.cjs
```

语音 UI 测试使用实际 `MediaRecorder` 和合成音频流，不访问真实麦克风；上游真实转写另用合成朗读验证。尚未做真机 iPhone 或已签名桌面安装包的麦克风端到端测试。

参考：[MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)、[Gemini 音频输入格式](https://firebase.google.com/docs/ai-logic/input-file-requirements#audio)。

产品参考：[Superwhisper 的识别与语言模型分工](https://superwhisper.com/models)、[MacWhisper 的本地模型与云端选项](https://docs.macwhisper.com/article/52-keeping-transcriptions-private)、[Apple 端侧语音模型资源](https://developer.apple.com/videos/play/wwdc2025/277/)、[OpenAI Docs 转写接口](https://developers.openai.com/api/docs/guides/speech-to-text)。

麦克风不显示来源文字：点击后以光晕表示状态，Gemini 为多彩光晕，其他能力为单色光晕（降级为琥珀色、端侧或平台离线为青绿色）。录音结束后光晕收起；具体来源、降级状态和录音时间保留在悬停提示与无障碍状态中。减少动态效果设置下光晕不闪动。

录音时以 Web Audio 检测实际输入电平；采样充分且全程无声时直接保留草稿，不上传音频。环境不支持电平检测时仍使用原识别链路。Gemini 用户消息只包含音频，不再附带文字转写请求，避免静音时将请求文字误当录音内容返回。
