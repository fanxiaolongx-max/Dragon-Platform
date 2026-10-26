# DragonTAC 桌面端投递实测

日期：2026-10-26。用户明确授权在现有业务对话中发送测试消息。

## 桌面 Agent 与 CLI 分开判定

本机 Codex（应用包标识 `com.openai.codex`）、Claude（`com.anthropic.claudefordesktop`）、Antigravity（`com.google.antigravity`）均正在运行。Claude 桌面界面当前选择 Opus 5.5，Antigravity 界面当前选择 Gemini 3.8 Flash High。CLI 的认证代理或 `agy` 是否存在，不决定这些桌面会话是否可用。

| 桌面客户端 | 测试所在现有会话 | 收发回执 | 公开网页读取实测 |
| --- | --- | --- | --- |
| Codex | 分析 Dragon Claw 工作区能力 | `DRAGONTAC_CODEX_DESKTOP_OK_20261026` | 首轮使用 `web.run open`；另一次严格禁止抓取替代的测试，已通过 ChatGPT/Codex 应用内浏览器读取实际页面 |
| Claude Code 桌面 | Dragon Platform | `DRAGONTAC_CLAUDE_DESKTOP_OK_20261026` | 成功；实际使用 WebFetch |
| Antigravity 桌面 | Push Code and Restart PM2 | `DRAGONTAC_ANTIGRAVITY_DESKTOP_OK_20261026` | 成功；当前会话使用 HTTP/curl 读取，未挂载独立浏览器页面驱动工具 |

三家均返回标题 **Example Domain**、正文第一句 **This domain is for use in documentation examples without needing permission.**、来源 `https://example.com/`，并返回各自网页测试口令。这些是向桌面应用的现有会话发消息、再读回回复的结果，没有用新 CLI 进程冒充桌面端。

Codex 通过当前应用的会话接口投递和等待结果；Claude 与 Antigravity 通过已有的桌面控制能力进行输入、发送及读取回执。这证明了桌面端收发路径可以打通；当前测试控制器不等于已经部署在 DragonClaw 后端、持续运行的 Desktop Connector。

## 后续接入方向

DragonTAC 应优先使用独立的 **desktop** 传输适配器，CLI 保留为明确可选的备用通道。桌面进程状态、会话身份、收发、实际工具能力、结果与错误都应独立报告。需要固定目标会话、任务关联号和结果回传，避免根据当前前台窗口盲目发送。

公开网页抓取与真实浏览器控制是两种能力。首轮网页测试证明三家公开网页读取；不能由此宣称三家都能操作登录页、动态页面、点击或下载。

Codex 另行执行了“必须用真实浏览器、不得使用 web.run/WebFetch/curl 替代”的专项测试，实际使用应用内浏览器，返回：

- 页面标题：Example Domain。
- 可见正文首句：该域名仅用于文档示例，无需获得许可。
- 浏览器：ChatGPT 应用内浏览器；当前 URL：`https://example.com/`。
- 回执：`DRAGONTAC_CODEX_GUI_BROWSER_OK_20261026`。

该桌面任务于 66.8 秒内完成，记录包含浏览器控制工具调用。Claude 和 Antigravity 本轮只验证了网页抓取，不把它们的结果标记为真实浏览器控制已经通过。

Agent HUD 0.5.5 的 MCP 已实际连通，工具目录仍是 HUD 读取/布局编辑工具，不提供任务投递。桌面投递应复用真实可用的会话接口或专门的桌面连接器；HUD 负责可观测性，不把其工具目录没有的能力写成已经接通。

## 本次本地服务恢复记录

原默认 PM2 主守护进程在一次单项目重启中 RPC 不再响应，项目未进入启动代码。未重启或迁移其他项目。Tools Platform 已在仅包含本项目的临时 PM2 实例恢复，健康接口重新返回 `ok`：

```sh
PM2_HOME=/Users/dragon/.pm2-tools-platform-rescue pm2 status
PM2_HOME=/Users/dragon/.pm2-tools-platform-rescue pm2 restart tools-platform
```

本临时实例使用 Node.js 24。默认 PM2 管理器修复并接管前，应先停止该临时实例，避免重复监听 3030；不要把默认 PM2 的故障状态误报为已恢复正常。未修改业务数据库文件来恢复服务。
