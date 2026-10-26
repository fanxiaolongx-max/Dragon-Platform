# 桌面 Agent 会话接入

## 使用

管理员打开「全局设置 → 桌面 Agent 与 DragonTAC」，启用「本机桌面对话连接」并保存。首页对话侧栏的「桌面 Agent」分类提供服务商切换、搜索和手动同步；开启自动同步后默认每 20 秒更新最近列表。选择原会话后查看最近消息，并在支持发送时直接回复。每家默认最多显示 60 个最近会话，每个会话最多返回最近 200 条文本消息。

这里连接的是**运行平台后端的电脑**，不是访问网页的手机或另一台电脑。Electron 不是必需的：本机后端和桌面 Agent 运行时，普通 Web 页面也可以访问这项功能。首次绑定需要管理员明确启用，默认不向平台导入私人桌面历史。

| 客户端 | 最近会话与历史 | Web 发送 | 当前通道 |
| --- | --- | --- | --- |
| Codex 桌面 | 支持本地已保存文本记录 | 支持，原会话空闲时 | 原生桌面 Unix IPC，会话 UUID 不变 |
| Claude Code 桌面 | 支持本地 Code 会话记录 | 尚未接通，界面明确只读 | 只读元数据与对应 transcript |
| Antigravity 桌面 | 支持当前桌面侧栏可见会话与时间线 | 支持，原会话空闲且输入框没有草稿时 | 运行中桌面应用的本机 Chromium CDP |

Codex 需要本机桌面 IPC 可连接。Antigravity 需要运行中的桌面应用提供 `DevToolsActivePort`，打开网页历史会同步切换其桌面会话；当前连接器面向 Antigravity 桌面应用，不将另一款 Antigravity IDE 的 CLI 当成桌面连接。客户端升级造成协议或页面变化时，发送会明确失败。

Claude 的深链可以打开右侧讨论串，但当前辅助功能树可能只暴露左侧项目输入框，不能由“成功打开窗口”推断消息会发到指定会话。本版本因此关闭其 Web 发送；此前人工桌面测试成功不等于已部署可靠的无人值守连接器。

## 设置与隔离

- 设置包括启停、三家客户端开关、自动同步、同步间隔、列表数量，以及允许 Web 发送。
- 一个服务主机只绑定一个平台账号及租户；其他管理员或租户不能读取或抢占桌面历史。解绑后才可以重新绑定。
- 设置与发送回执使用 SQLite。主机绑定属于平台控制面；租户库保存该租户的设置和请求状态，不复制整份原始 transcript。
- 原生文件路径、目录、认证配置、工具调用输出和推理内容不进入返回的会话数据。正文及标题经过凭据脱敏；含凭据的发送请求被拒绝。
- 列表刷新和历史查看不触发模型任务。发送明确标出服务商及原会话，平台模型或 CLI 不会自动代答。
- 原会话忙碌、客户端不可用或桌面已有未发草稿时不替换任务或草稿。请求编号用于防止重复提交；结果不确定时不自动重发，先核对原会话。

DragonTAC 的升级任务、外部 Agent HUD 和本功能各自保留真实能力状态。这个菜单不会把 HUD 布局工具变成会话派发工具，也不会更改现有升级任务的执行通道。

## 2026-10-26 验证

用户已授权把测试消息发送到现有业务对话。本次使用部署连接器代码进行的真实验证：

- Codex「分析 Dragon Claw 工作区能力」：原生 IPC 向原 UUID 发送，原 transcript 保存用户消息，原会话回复 `DRAGONTAC_CODEX_WEB_OK_20261026`。
- Antigravity「Push Code and Restart PM2」：本机 CDP 向原会话发送，确认新增用户消息，并收到 `DRAGONTAC_AG_RECEIPT_OK_20261026`。回执只比较正文，排除气泡中的时间和操作按钮。
- Claude：本地 Code 会话目录及 transcript 可以读取；发送目标确认未通过，在输入文字前被拦截，现标记为只读。

自动验证命令：

```sh
node --test tests/desktop-agents.test.js
node_modules/.bin/electron tests/desktop-agents-browser.cjs
node_modules/.bin/electron tests/desktop-agents-native-browser.cjs
npm run doctor --prefix backend
```

前两类界面测试使用独立配置和模拟数据，不向业务会话发消息。原生 CDP 测试使用独立 Electron 页面，验证指定会话、已有草稿、忙碌保护、重复正文的新回执及不确定提交。界面覆盖三家切换、历史与回复、草稿保存、重复点击、请求失败、切换竞态、搜索、中英文、窄屏与设置保存。

Codex IPC 协议参考 Agent HUD Native Open 的 `CodexDesktopIPC.swift` 与 `CodexDesktopPermissions.swift`（提交 `f1ebd1b`，Apache-2.0）。项目来源：<https://github.com/jazzenchen/agent-hud-native-open>；许可副本见 [LICENSE](third-party/agent-hud-native-open-LICENSE)。

本轮回归记录：新增 Node/API 测试与表目录测试 7 项通过，租户及备份边界测试 6 项通过；新增两项 Electron 界面测试及导航中英文延迟加载测试通过。全量 Node 测试最近一次为 1643/1644：既有 `ops-groups.test.js` 相邻随机角度断言偶发失败，单独复跑该文件 9 项全部通过。既有 `welink-bot-compose-scroll-browser.cjs` 的输入增高滚动断言仍失败，本次未将其标记为通过，也未改动该测试或相关滚动逻辑。
