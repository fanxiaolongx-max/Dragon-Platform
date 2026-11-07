# 桌面 Agent 工作区性能口径

统计范围是接口实际读取到的桌面会话日志（有读取长度和消息条数上限），不是整个账号的历史、机器性能或模型回答质量。卡片显示来源、样本数和统计范围；可展开“统计口径与数据来源”，或复制诊断信息查看原始 token 计数、样本数和合并运行毫秒数；未上报显示 `—`，不补零、不按“正常速度区间”裁剪数据。

## 用量和缓存

- 消息：已读取的可见用户／Agent 消息。
- 模型调用：日志请求记录数；有请求 ID 时去重，不据此推断并发数。
- Token 用量：输入加输出。Codex 的输入已包含缓存输入，不重复累加 cached_input_tokens；Claude 的 input_tokens、cache_read_input_tokens、cache_creation_input_tokens 合计为完整输入。
- 输出 Token：供应商报告的输出，可能包含隐藏推理，并不全是肉眼可见文字。推理 token 已上报时单独提示。
- 缓存读取占比：`有缓存明细请求的缓存读取 token 之和 / 同批请求的完整输入 token 之和`。缓存写入不是读取命中；字段缺失不是 0；只展示有效样本，并标注上报调用数／总调用数。这是按 token 加权的读取占比，不是“有多少请求命中缓存”。

## 首 Token 与纯输出流速

TTFT 包含排队、网络、预处理等时间，不能等同于纯 Prefill 耗时。`input_tokens / TTFT` 也不是硬件实测 Prefill 速度。

当前 Codex 本地 task_complete 上报 duration_ms、time_to_first_token_ms 和轮次起止时间。面板首 Token 延迟为这些**轮次级实报**的算术均值，并明确注明轮次口径，不能拿来冒充每个 API 请求的 TTFT。秒级 epoch 时间会转换为毫秒，耗时优先使用显式 duration_ms。

纯输出流速只接受逐请求 stream 计时及匹配的可见输出 token。首 Token 后计时需排除首 Token 本身；有多个请求时使用 `Σ首 Token 后输出 / Σ解码时间`，是按解码时长加权的速率。`平均(每个请求的 TPS)` 则是请求等权的算术均值，两者含义不同。

桌面日志若只记录“上一个日志边界到这次写入”的耗时，可能混入工具运行、排队和其他工作，不能代替解码时间。因此这些 rounds 标为 timingEstimated=true、timingSource=log-boundary，generationMs/tps 留空。缺少逐请求数据时 Decode TPS 显示 `—`，不把整轮输出除以整轮耗时冒充吐字速度。隐藏推理 token 与可见流计时也不能混算。

## 会话处理吞吐

`完整轮次的输入与输出 token / 已记录运行窗口合并后的墙钟时长`，包含缓存上下文、工具等待与工程开销。并行窗口取并集，避免重复累加重叠时间；轮次只有完整起止记录且对应 token 日志从开始就可见时才参与。尚未完成或被日志读取边界截断的轮次不参与。

此卡是**含输入的会话处理吞吐**，区别于性能基准中常用的系统输出吞吐。数值很高可能来自大上下文和缓存，不能据此宣称模型吐字快，也不能把模型调用数当作并发数。

## 参考

- [NVIDIA: LLM Inference Benchmarking: Fundamental Concepts](https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/)
- [Claude: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

## 验证

- `node --test tests/desktop-agent-performance.test.js tests/desktop-agents.test.js`
- `node_modules/.bin/electron tests/desktop-agents-browser.cjs`
- `DESKTOP_PERFORMANCE_PREVIEW=1 node_modules/.bin/electron tests/desktop-agents-browser.cjs`

## WorkBuddy 适配

WorkBuddy 原生 JSONL 将用量写在 message 或 function_call 等事件的 providerData.usage / providerData.rawUsage 中，不只在可见的 assistant 回复里。适配器单独读取用量记录，按原生 messageId（其次 conversationRequestId + stepSeq）去重，正文和工具返回不会混进统计。以规范化 inputTokens / outputTokens 为优先；缓存采用 inputTokensDetails.cached_tokens 等明确字段，避免把 rawUsage 中的通用占位零误当作没有命中缓存。总输入已含缓存时不再重复累加。

用量事件独立于可见消息：Agent 运行期间只要写出新调用用量，面板便可更新调用数、输入／输出 token、缓存读取比例和模型标识；即使尚无新正文也可更新。不调用或前置原生 WorkBuddy 窗口。没有真实首 Token、纯解码或完整运行窗口计时的 WorkBuddy 会话相应卡片保持 `—`。session_usage.used / size 是上下文占用信息，不作为累计模型用量。

## 平台原生对话

工作区新增“本轮模型统计”折叠卡，统计最近一条回复的已完成调用，生成时展开、结束自动折叠；用户手动展开或折叠后保留本轮选择。加载更早历史不会覆盖最新回复。包含调用数、输入与输出、调用平均首字延迟、纯输出流速、缓存读取占比、调用处理吞吐和调用用时。

平台的调用处理吞吐使用输入加输出除以各调用耗时之和，区别于桌面日志的完整会话窗口吞吐。未流式返回、仅单个输出块、自动切换模型、计数带隐藏推理或用量估算时，不宣称实测解码速率。首字计时仅使用非空可见文本回调。缓存字段缺失显示不可用。

Antigravity 从 PLANNER_RESPONSE 的 cache_read_tokens 补充缓存读取计数，step_index 在会话内去重；工具调用但尚无可见回复时，用量仍可更新。日志没有逐请求解码计时，不以日志边界补造。

## 每条回复底栏

统计卡片与回复底栏并存。每条回复底栏保留本轮汇总输入、输出 Token，TPS 最低／按解码时长加权平均／最高，以及 TTFT 和调用数；悬浮可查看精确总输入输出、总 Token 和各调用的模型、用量、缓存与计时。无可靠解码计时也保留 TPS 项并显示 `—`，不隐藏整个统计底栏。Codex 实报的轮次级 TTFT 明确标为“轮次”，不冒充请求计时。WorkBuddy 的调用用量按用户提问归组，挂到该轮最后一条可见回答，同时保留会话汇总使用的独立用量流，通过请求 ID 去重。

普通平台对话与频道时间线共用同一套回复底栏。频道 messages 接口返回模型名、持久化输入输出以及白名单化的 model_round 统计，不暴露工具参数等其他事件内容。轮询可合并同 ID 消息的后补统计，保留阅读位置；未调用模型的手动发送和固定确认消息不伪造用量。已有历史只能展示实际保存过的字段。

回复底栏悬浮提示只列出最近 3 次调用，保留原调用序号；顶部汇总仍覆盖本轮全部调用。

统计悬浮明细使用随内容伸展的提示框，按原始行显示；仅当最长行超过视口宽度时换行，提示框保持在可视范围内，支持键盘聚焦与 Escape 关闭。

## 原生计时补充（2026-11-07）

- Antigravity：通过现有本机 CDP，在当前原生页面调用只读 `GetCascadeTrajectoryGeneratorMetadata`；不切会话、不前置窗口。按 `stepIndices`、输入/输出计数同时校验后关联日志调用。读取 `chatModel.timeToFirstToken`、`streamingDuration` 和白名单化用量，绝不传出响应头、提示词等字段。10 秒缓存；接口不可用时继续显示本地用量。
- TTFT：Antigravity 使用原生请求均值；Codex 保留已结束轮次实报均值，两者注明口径。
- Antigravity 原生流式速率：原生全部输出 Token（含推理）除以原生 streamingDuration，按时长加权。独立于纯可见文字解码指标，前端明确标为“原生流”。分块和缓冲会影响该速率，不能当作逐 Token 硬件吞吐。
- WorkBuddy：SDK 会话日志中 `agent_message_chunk` 的本机时间戳，通过 `conversationRequestId` 与主会话用户消息关联，展示“首文字响应（观测）”。不是每次 API 的 TTFT；包含首文字之前的全部等待。日志缺失或超过完整读取限制时不推断，防止把日志尾部的第一条误当为真正首字。
- Claude Code：官方 Enhanced Telemetry 的 `claude_code.llm_request` span 提供 `ttft_ms`、`first_content_ms`、`duration_ms` 和 `request_id`；需要启用本机遥测收集，当前转录读取不能代替该接口。参考 https://code.claude.com/docs/en/monitoring-usage#traces-beta 。
- Codex：官方 OTel 有 API、SSE、WebSocket 事件及响应推理/首 Token 指标，App Server 有增量输出通知；要测逐请求速率，需要按请求/响应 ID 关联实时事件，不能把事件处理 duration 当生成时间。参考 https://developers.openai.com/codex/config-advanced/ 和 https://developers.openai.com/codex/app-server/ 。

Claude/Codex/WorkBuddy 的本机遥测接收器现已接入，见下节；已有原生进程不会被强制重启。

## 本机实时采集器

后端在本机桌面已绑定账号时启动 `127.0.0.1:4319`（可用 `TOOLS_DESKTOP_TELEMETRY_PORT` 更改）。只接受 OTLP JSON 的 `/v1/logs`、`/v1/traces`，以及 OTLP Protobuf 的 `/v1/traces`；支持 gzip，原始和解压体均限制 4 MiB。拒绝浏览器 Origin，非本机连接和其他路径；数据不会发往外部遥测服务。

接收器只保留原生会话/请求 ID、Token 计数、计时等白名单字段，丢弃提示词、正文、工具参数、响应头、用户邮箱等。当前设备绑定确定租户及账号，通过租户连接写入 SQLite `desktop_agent_request_timings`。查询仍通过桌面对话的绑定鉴权，不能跨账号、跨租户读取。按原生请求 ID（Claude 区分桌面会话 ID、CLI 会话 ID和 API request ID）及用量校验关联；重放上报不会重复累加调用。重试请求不据此推断生成速率。

配置命令（需先启动平台；保留已有遥测配置与其他设置）：

```bash
node scripts/configure-desktop-timing.js
```

此命令只为尚未配置遥测的本机 `.claude/settings.json`、`.workbuddy/settings.json` 与 `.codex/config.toml` 设置本机目标，关闭提示词、响应正文和工具内容导出。新启动的 Agent 进程生效；不强制重启运行中的应用。若已有其他遥测目标则跳过，不能覆盖用户配置。当前会话尚未收到可关联的计时时，工作区显示“等待上报”，不伪造历史值。

Codex 原生桌面还可只读取得最终回答的 `startedAtMs`、`completedAtMs`：按轮次 ID、正文哈希、最终纯文字调用关联，扣除已实报推理 Token 后显示“文字流速（观测）”。工具调用、推理计数未知、正文不一致或关联歧义均拒绝计算；不切换或前置窗口。优先采用请求遥测，同一均值不混合包含推理的原生流式速率与排除推理的文字观测速率。

独立 CLI 探测与原生桌面会话的模型支持可能不同；HTTP 400 或未完成的探测不能作为真实 TTFT/TPS 的成功验证。历史消息没有留存计时且原生客户端也无法补充时仍显示未上报。
