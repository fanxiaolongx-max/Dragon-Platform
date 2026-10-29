# 桌宠账户额度

桌宠显示的是账户额度的**剩余百分比**，不是本轮 token 使用量，也不推算剩余 token 数量。代码统一使用 0–100 的百分数，避免在气泡中重复乘以 100。

## 展示与操作

默认显示 360 × 64 的横向额度托盘，新配置停靠顶部；左右侧为 68 × 248 的图标竖栏。托盘使用单一深色或浅色表面，贴边侧为直边，朝内侧保留圆角，没有额外窗口或页面边距。Windows 对齐显示器实际边界；macOS 顶部对齐系统菜单栏下沿（Electron 的原生窗口限制），其余边缘对齐显示器边界。多显示器与负坐标均按所在显示器定位。

横栏显示 Codex、Claude Code、Antigravity 的 5 小时（`5h`）和每周（`周` / `W`）剩余比例；竖栏常驻图标及 5 小时剩余额度。悬停服务商后，在朝屏幕内侧的独立详情浮层中展示两种额度、重置时间、订阅、读取状态与更新时间。浮层带方向箭头，不改变托盘的位置、尺寸或当前应用焦点；跨入浮层可继续操作，离开后淡出。数据不可用时为破折号，缓存以虚线下划线标明，剩余不超过 20% 时显示红色。点击托盘或浮层中的额度数字打开历史趋势。

贴边精简模式默认在离开约 1.4 秒后滑动收起，仅保留 6px 边缘触发条，原生窗口同时缩到 6px，避免透明区域阻挡其他应用；悬停或点击触发条恢复。`···` / 右键菜单中的「贴边时自动收起」可关闭此行为。自由摆放、详细模式、拖动、打开菜单或操作详情时不自动收起。动画使用 transform / opacity，拖动消息按动画帧合并，额度刷新复用原有节点；遵循系统减少动态效果设置。

额度托盘是独立、不可聚焦且可交互的透明窗口，不随桌宠移动。拖动手柄、图标或空白处可移动，靠近顶部、底部、左侧或右侧自动停靠；自由摆放保持原有横竖方向。位置、方向、显示模式与自动收起偏好会保存，既有位置继续沿用。`···` 或右键菜单可选择四边停靠、切换「精简额度栏 / 详细额度面板」（286 × 426）、刷新或隐藏；详细模式的 `×` 也只隐藏额度窗。桌宠菜单或系统托盘可恢复。默认隐藏或停用桌宠后保留额度窗，可关闭「隐藏桌宠时保留额度侧栏」。反重力额度组仍由桌宠菜单选择 Gemini 或 Claude/GPT，默认 Gemini，不合并两组额度。

原来的额度气泡没有定时主动弹出逻辑，点击桌宠或手动请求时显示约 5 秒；数据刷新本身不会强行弹出气泡。故事与连击提示继续使用独立气泡。

- 对话框顶部横向滚动的额度卡显示 Codex、Claude Code Desktop/CLI、Antigravity Gemini、Antigravity Claude/GPT 共享额度。每组包括 5 小时、每周剩余比例，服务返回的其他限制，以及各自重置时间。
- 桌宠菜单新增“额度来源”，默认自动选取第一个可用的实时来源；可以固定为 Codex、Claude Code 或两种 Antigravity 额度。已有的 5 小时/每周/交替轮播设置继续生效。来源偏好沿用原有桌宠配置保存，不存账户凭据。
- “实时”指最近一次成功查询的服务数据，并显示查询时间。缺失数据为“未提供”，不会默认填成 100%。日期按本机时区格式化，中英文随桌面语言切换。
- 平台每 15 秒向可见窗口同步，采集器最多每 60 秒实际查询一次，Claude 为 120 秒；相同来源的并发请求合并。手动刷新可跳过周期缓存。
- 临时网络失败可展示最多 15 分钟的缓存，标明“缓存”及原始更新时间；已过重置时间的缓存窗口隐藏比例，等待新查询。退出登录、API Key 模式、需要重新登录时清除旧额度，不用缓存掩盖认证状态。

## 会员徽章

详细模式在三家名称旁以简洁文字显示实际订阅等级，例如 Plus、Pro、Max、Ultra、Team、Business；精简模式在悬停详情右上角显示。不推测缺失的会员等级。对话框额度卡标题也显示会员等级。

Codex 优先采用额度结果中的 `planType`，缺失时使用同一次 `account/read` 返回的等级。Claude 桌面版从匹配当前账户的 Code 会话订阅信息读取，Windows 从当前账户解密缓存条目读取；CLI 模式使用本机身份信息。Antigravity 从同一本地服务 `GetUserStatus` 的 `planStatus.planInfo` 读取。只传播标准化等级，不传播账号身份、邮箱、原始资料或认证信息。

未知类型显示“未识别”，不根据额度多少、重置周期或购买金额猜测，也不从会员等级推断月付/年付。Antigravity 若只能查询额度、不能查询会员信息，额度仍正常显示。

## 读取来源

### Codex

使用本机 Codex `app-server` 的 stdio 协议，依次 `initialize`、`initialized`、`account/read`、`account/rateLimits/read`。按 `windowDurationMins` 识别 300 分钟和 10080 分钟窗口，`100 - usedPercent` 得到剩余比例。不同长度的窗口单独展示，不把 primary 一律当作 5 小时。

不创建对话、发送提示词或运行推理任务。子进程在成功、失败或 12 秒超时后关闭，只关闭采集器自己启动的进程。API Key 登录显示“API Key 模式”。Mac 会检测 PATH、Homebrew 和已知桌面版内置 CLI；Windows 检测原生命令和 npm 安装入口。未安装或版本不支持时显示对应状态。

协议参考：[OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)。

### Claude Code Desktop 与 CLI

桌面版订阅与命令行登录互不等价。优先检测 Claude Desktop 的当前账户；即使命令行配置了 API Key，也不覆盖桌面版订阅额度。

- macOS：读取 Claude 桌面版配置中的当前账户标识，只检查其自带 Code 子进程的环境，匹配同一账户和 Anthropic 官方服务地址，取得该会话的临时 OAuth 认证。需要至少打开一个 Claude 桌面版 Code 会话；没有会话时明确提示打开，不改用户登录或密钥串。
- Windows：只读 Claude 桌面版配置中的加密 OAuth 缓存，通过本机 Electron safeStorage/当前用户 DPAPI 解密，筛选当前账户、官方域名和未过期的凭据。未取得凭据时提示打开桌面 Code 会话。Windows 分支有隔离测试，本轮没有 Windows 真机验证。
- 未安装 Claude Desktop 时支持 CLI OAuth：读取 `CLAUDE_CODE_OAUTH_TOKEN`、配置目录的 `.credentials.json`，或 macOS CLI 凭据存储。CLI 的 `auth status --json` 为 API Key 时不伪造订阅额度。

使用 Claude 桌面版当前版本同样使用的 `https://api.anthropic.com/api/oauth/usage`，读取 `five_hour`、`seven_day`、按模型区分的每周窗口。这是客户端使用的接口，未来可能变化；失败时保留清晰的状态提示。采集器不刷新 OAuth、不重新登录、不修改 Claude 的配置或会话。

### Antigravity

发现本机 `language_server` 进程和实际监听端口，通过其 loopback HTTPS Connect 接口 `RetrieveUserQuotaSummary` 读取账户组和窗口。支持 macOS 的 `ps/lsof`、Windows 的 CIM/Get-NetTCPConnection，不再依赖固定日志文件名。自签名证书例外仅限固定的 `127.0.0.1` 地址。

Gemini 共享额度、Claude/GPT 第三方共享额度分组展示，后者不是独立 Claude Code 订阅。额度缺少某个窗口时显示未提供，不默认满额。

## 安全与验证

凭据只在 Electron 主进程内存中短暂使用，只发给对应提供方的固定接口，不通过 IPC 发给页面、不记录到日志、不发送给 AI、不写入新数据库。IPC 只广播规范化的比例、重置时间和采集状态。UI 通过 `textContent` 插入服务端标签。

```bash
node --check desktop-pet/quota-detector.js
node --check desktop-pet/quota-common.js
node --check desktop-pet/codex-quota.js
node --check desktop-pet/claude-quota.js
node --check desktop-pet/claude-desktop-quota.js
node --check desktop-pet/antigravity-quota.js
node --check desktop-pet/quota-view.js
node --check desktop-pet/quota-panel.js
node --check desktop-pet/quota-panel-layout.js
node --check desktop-pet/gemini-pet.js
node --check desktop-pet/pet-manager.js
node --test tests/desktop-pet-quota-panel.test.js tests/desktop-pet-quota.test.js tests/desktop-pet-language.test.js tests/desktop-pet-stories.test.js tests/desktop-pet-presence.test.js tests/pet-keyboard-hook.test.js tests/asset-versioning.test.js
```

macOS 本机验证读取三个实际来源，并在独立 Electron 用户目录检查气泡百分数、来源切换、未知值回退、对话框卡片、中英文和窄屏暗色。不触发 Electron 打包，不重启或更改用户正在运行的 Codex、Claude、Antigravity 会话。
