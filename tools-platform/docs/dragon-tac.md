# DragonTAC 网页分析升级示例

DragonTAC 是 DragonClaw 的升级支持入口。当前示例让用户先确认公开网页地址和执行成员，再使用宿主机已安装的浏览器与官方 Agent CLI 分析，结果写回原会话。不会用模型的一句“已执行”代替真正的任务状态。

用户目标以 **Codex、Claude Code、Antigravity 的桌面会话**为主，CLI 仅保留为备用方案。本页描述目前已经实现的 CLI 备用原型；桌面端的三家真实收发与网页读取测试见 [桌面通道实测](dragon-tac-desktop-probe.md)。CLI 就绪状态不能用来判断桌面应用是否可用。持续运行的 Desktop Connector 尚未部署，不能把当前备用原型标成“后端已自动派发到三家桌面端”。

## 使用

在首页 DragonClaw、WeLink 群聊或微信单聊发送：

```text
打开 https://example.com 并分析页面用途
```

系统回复待确认请求和任务编号。原发起人在原会话中发送：

```text
确认升级 tac_任务编号
```

确认有效期 15 分钟。确认前不打开网页、不调用外部 Agent。重复确认不重复执行；支持“取消 tac_任务编号”和“DragonTAC 状态”。频道会话右侧工作区展示待确认、处理中、成员报告、失败与回传情况。首页通过轮询呈现异步结果。

## 当前执行链

1. Chromium 浏览器使用临时配置读取实际渲染后的网页标题和正文，不继承个人 Cookie。网络只允许公开地址；不读取本机、内网、凭据 URL 或执行页面 POST。
2. Codex 官方 CLI 分析快照，关闭 shell 与搜索工具，在临时目录以只读模式运行。
3. 已就绪的 Claude Code CLI 使用同一份快照复核前一份报告；以 `--bare --tools "" --strict-mcp-config` 运行，通过显式原生 settings 文件读取其已有认证配置。
4. 任务在 SQLite 中保存状态、原会话、原发起人、成员报告及回传结果。成员在确认时锁定；后来新安装的 Agent 不会自动加入已确认任务。进程最多同时执行两项，服务重启时将旧的排队/运行任务标记中断，重新发起确认后再执行。

首次原型针对公开网页、中文分析与 macOS 原生 CLI 做了实测。浏览器将主域名解析到已校验的公网地址并固定解析，其他域名默认拒绝解析；依赖跨域 CDN、登录或复杂交互的页面可能读取不完整，需要后续适配，不能当作通用桌面浏览器控制已经完成。

## HUD 与各 Agent 的真实边界

Agent HUD 是独立应用，DragonTAC 的 `/api/dragon-tac/hud` 通过标准 MCP `initialize` / `tools/list` 读取其真实工具目录，不安装客户端 hooks、不自动答应审批、不把界面工具当成执行接口。

2026-10-26 在本机安装并校验官方 Agent HUD 0.5.5 后，实测 MCP 仅暴露 `get_hud`、`get_hud_screenshot`、`draft_hud`、`discard_hud_draft`、`finish_hud_edit`，没有新建 Agent 任务或投递消息工具。因此当前任务明确标记“官方 CLI 执行”，未通过 HUD 派发；HUD 监控可与原生 CLI 会话并行使用。不能宣称三款桌面端已经通过 HUD 共同执行。

本机的 Codex 已完成真实网页分析；Claude Code 的原生配置指向未启动的本地模型代理 `127.0.0.1:8045`，就绪检查会将它标记不可用，不更改用户的模型/认证设置。已安装 Antigravity 桌面程序，但没有找到 `agy` CLI，当前不会参与任务。其 CLI 适配入口保留，安装并验证后才可参加新任务。桌面应用已安装不等于存在可调用的自动化接口。

上游依据：[Agent HUD](https://github.com/jazzenchen/agent-hud-open)、[MCP 实现说明](https://github.com/jazzenchen/agent-hud-open/blob/main/src/apps/mcp/README.md)、[Codex 非交互执行](https://developers.openai.com/codex/noninteractive)、[Claude Code 程序化调用](https://code.claude.com/docs/en/headless)、[Antigravity CLI](https://antigravity.google/docs/cli/reference/)。

## 部署与诊断

- 在平台服务所在机器安装浏览器和需要的 Agent CLI，并先确认该 CLI 能独立正常回答。管理员可读 `/api/dragon-tac/capabilities`；CLI 存在不等于登录、模型服务或额度可用。
- 可通过 `TOOLS_DRAGON_TAC_BROWSER`、`TOOLS_DRAGON_TAC_CODEX`、`TOOLS_DRAGON_TAC_CLAUDE`、`TOOLS_DRAGON_TAC_ANTIGRAVITY`、`TOOLS_DRAGON_TAC_HUD` 指定可信的本机可执行文件绝对路径；请求内容不能指定可执行文件或命令参数。
- 设置 `TOOLS_DRAGON_TAC_ENABLED=0` 关闭升级入口。启用时，获准与频道助手对话的用户在明确确认后可以消耗宿主 Agent 的额度；沿用频道访问名单，分析结果仅回原群或单聊。工作区查看权限沿用现有租户内共享会话规则。
- 成员执行失败会显示部分失败；所有成员失败则任务失败。分析完成而频道推送失败时保留报告并显示回传错误，不伪造“已送达”，不自动重复发送。
- 暂时只支持该网页示例。代码修改、任意桌面控制、内网登录页和 HUD 的跨客户端派发不因安装 Skill 自动获得能力。
