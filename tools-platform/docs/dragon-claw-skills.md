# Dragon Claw 内置 Skills

## 使用

在首页输入框输入 `@`，按中文名称、英文名称或标识搜索。↑↓ 切换选项，Enter/Tab 插入引用，也可用鼠标选择；选中后继续写任务，再按 Enter 发送。Shift+Enter 保持换行，Esc 关闭菜单，`/session` 等命令继续可用。

| 引用 | 用途 | 可直接测试的任务 |
| --- | --- | --- |
| `@project-map` | 只读梳理项目 | 帮我梳理项目入口、主要模块、数据流和启动方式 |
| `@debug` | 复现、定位、修复、验证 | 分析这条报错的根因，先不要修改代码：…… |
| `@code-review` | 默认只读审查真实缺陷 | 审查当前未提交修改，重点检查权限和异步竞态 |
| `@data-check` | 只读检查业务数据 | 找到本月报表数据，检查缺失和重复，说明检查范围 |
| `@script-data` | 不开页面管理整个抓取脚本仓库：脚本增删改查、复制、站点迁移、批量移动，分类目录新建/改名/删除；相关任务自动加载 | 复制 PBI 抓取脚本到中东站，保留地区/代表处筛选，保存后核对 |
| `@write-doc` | 起草或写入项目文档 | 写一份给新同事的项目上手说明，先给草稿 |

前四项需要先选择工作目录，以便实际调用文件/数据库工具；`@write-doc` 可以不选目录直接起草，若需要基于源码编写或保存文件，则需选择目录和具备相应权限。

`@script-data` 在首页管理员普通对话及可用工作区中，遇到抓取脚本、脚本仓库、UIVF12、F12 或脚本增删改请求会自动加载，无需手写 `@`。它不需要目录即可管理当前租户的平台脚本仓库；普通 Python/Shell 脚本编写不会自动路由到仓库。自动加载后同样显示「已加载 Skill」，并沿用现有会话标签机制。租户隐藏该内置 Skill 后，不再自动加载；专用运营、WeLink、NetCare 对话仍使用各自工具。

配套工具为 `list_uiv_scripts`、`list_uiv_categories`、`read_uiv_script`、`save_uiv_script`、`move_uiv_script`、`delete_uiv_script` 和 `manage_uiv_category`，一个 Skill 覆盖数据抓取页的脚本与目录管理。`list_uiv_scripts` 可按 `category` 精确筛选页面目录，列与页面载荷不一致时返回 `pageCategory`。长脚本分段读取；复制与局部修改在服务端对完整原文操作，保留未修改字段，避免 Shell/JSON 转义损坏。保存前校验请求 JSON、JavaScript（支持顶层 return）及宏的 executeScript 片段；通过版本校验后事务提交并回读。名称变化沿用现有输出文件名转换，更新现有脚本名称时沿用现有规则同步。普通用户仍无写权限，工作区继续遵守 ask/auto/full；不自动执行真实站点抓取。

`save_uiv_script` 的 `targetSite=cn/ae/de` 与前端三区生成共用 `frontend/js/shared/uiv-site-profiles.js`：中东实际为 `https://netcare-ae.gts.huawei.com`。切换站点统一修改请求 URL、完整宏/控制台代码及配置中的已知站点地址，保留接口路径和地区/代表处筛选。复制不能用 `changes.code/consoleCode` 覆盖成短示例；大幅缩短现有代码也会拒绝。`read_uiv_script`/保存结果包含代码长度、站点及静态地区默认值，缺失字段和列/载荷不一致通过 `integrity` 提示。

分类目录用 `manage_uiv_category`：`create` 新建；`rename` 需 `expectedScriptCount`，同一事务内同步目录表、脚本 `category` 列与 `payload_json.category`；`delete` 只删空目录，非空目录须传 `moveScriptsTo` 先整体移走，不会像页面那样连带删除脚本。内置目录（DataFab、NetCare中国/中东/德国、默认分类）不能改名或删除。删除按删除类审批，新建和改名按普通写入。通用数据库写工具同样不能直接改 `uiv_categories`。

早期导入的宏脚本可能只有 `code/consoleCode`、没有 `url/payload`，这属于正常记录：`read_uiv_script` 以 `notes` 提示而不计入 `integrity`，可照常修改、复制和用 `targetSite` 迁移站点（按代码中的已登记站点地址替换，不补造 url）；新建脚本仍须提供 url 和 payload。

分类移动读取真实分类列表并使用 `move_uiv_script`（批量传 `items`，最多 50 项，逐项校验版本、逐项报告），单条原子更新同时写入 `category` 列与页面读取的 `payload_json.category`，可修正旧记录缺失的 ID/名称/URL 元数据；不会解析或修改代码，也不会因旧代码语法错误拒绝移动。若原记录仍缺抓取字段，结果明确标为不完整。通用数据库写工具不再直接修改平台 `uiv_scripts`，避免只改一列或写入截断载荷。页面拖拽 API 也共用同一移动实现。

用户授权重建时，`action=rebuild` 使用坏副本的 `id/expectedRevision` 和完整原脚本的 `sourceId/expectedSourceRevision`，保留目标 ID、名称，从完整源恢复字段；可配合 `targetSite` 迁移。不自动覆盖、删除已有坏副本。已有对话的“再试一次/不用改/不对”等追问会结合当前账号有权访问的服务端历史自动匹配 Skill，即使客户端没有携带标签也可继续。

用户已明确要求执行，而模型只说「可以写入/建议入库」时，会收到一次继续调用工具的提示；没有本轮提交/回读却声称“已还原/已更新”时，也提示先读取实时状态并纠正结论。只分析请求不会触发写入催促，用户拒绝和只读账号不触发该提示。它用于纠正停在方案或无依据成功的回复，不代表真实模型必然完成任务。

脚本专用保存允许鉴权代码与原有内嵌凭据，不再按通用数据库的敏感词拒绝 `uiv_scripts` 内容。该策略由服务端内部参数启用，只作用于当前租户的脚本库，不能由模型参数开启到其他表；读取结果、过程记录与日志继续脱敏。真实 Token 获取逻辑（如 `csrfToken=m[0]`）可原样保留，不能把读取时的 `[REDACTED]` 写回代码。

重建必须分别读取目标与完整原脚本的 metadata：目标用 `id/expectedRevision`，源用 `sourceId/expectedSourceRevision`。缺参数、同名冲突与目标不存在会返回结构化恢复信息；工作区预览错误和执行错误都保留这些信息。同名修复用错误中的 `suggestedCall` 原位 rebuild，目标已不存在才 clone 并报告新 ID。用户只要求修复时，`delete_uiv_script` 会拒绝“先删后建”；用户明确要求删除时仍按原权限模式执行，既有删除授权可沿用确认追问。不会以空框架或手动分段粘贴代替完整重建。

可在同一消息引用多个 Skill。中文可以紧贴引用，例如 `请用@debug看看`、`@debug帮我查`；邮箱（`a@debug.com`）、路径（`/tmp/@debug`）、文件名（`@debug.js`）不会被当作 Skill。写错名字时输入框下方会提示「未识别的 Skill」，回复顶部也会标出未识别的引用。

**推荐必须依据真实目录**：首页每轮向模型提供当前租户可见的技能元数据（包括自定义技能、排除隐藏项），未选 Skill 时也提供。模型只能把目录中的 ID 推荐为已有技能；新技能只可作为尚未保存的草稿，聊天文字不代表创建成功。目录元数据先脱敏，并作为资料处理，不作为额外指令。

最终回复会核验技能调用名和 `/?skill=` 链接；目录之外的技能引用会去掉调用形式并标为“当前目录未提供，不可调用”，不把模型编造的示例名当作已安装技能。新 `skill` 代码块保留可保存格式，并注明草稿尚未保存；邮件、普通联系人、代码示例和编程注解保持原样。工作区最终转录、对话记录与最终回复同步校正。流式生成阶段仍属于草稿，以完成后的最终回复为准；不重写旧历史。

**会话内保持**：一条消息加载过的 Skill 会显示为输入框上方「本对话持续使用」的标签，之后的消息即使不写 `@id` 也继续加载，直到点标签上的 ×、在空输入框按退格，或开始新对话 / 切换到其他历史会话。发送后回复顶部显示「已加载 Skill」，这个标记随回复入库，恢复历史对话时仍会显示；用户消息里的 `@id` 显示为高亮标签。

需要工作目录的 Skill 在未选目录时会直接提示「请先选择工作目录」，并在消息下给出「选择工作目录」按钮；选好后用该条用户消息的「重新发送」即可。

## 实现与扩展

- 内容源：`backend/agent-skills/<id>/SKILL.md`，属于版本控制源码，随现有 `backend/**/*` 桌面打包规则分发。
- 目录注册：每个 `SKILL.md` 开头的 front-matter 声明 `name`、`name_en`、`description`、`description_en`、`workspace`（是否需要工作目录）和 `order`（菜单顺序）；`backend/models/agent-skills.js` 启动时扫描 `backend/agent-skills/` 读取，front-matter 不会发给模型。新增内置 Skill 只需新建一个目录（名称即标识，小写字母开头，可含数字和连字符）。当前不扫描任意本地路径，不是 MCP 或第三方插件安装器。

```markdown
---
name: 排查故障
name_en: Debug
description: 复现问题、定位原因、修复并验证
description_en: Reproduce, diagnose, fix and verify a bug
workspace: true
order: 2
---

# 正文：给模型的流程说明
```
- `GET /api/ai/skills` 需要登录，只返回公共目录信息，不返回指令正文。
- 首页 `/api/ai/chat` 从当前用户消息解析引用，合并服务端匹配的 `@script-data` 与请求体 `skills`（会话内保持的标签，最多 8 个，只接受目录内的标识），读取白名单文件注入本次模型系统上下文。客户端不能传入任意文件路径替换内置指令；未选择也未自动匹配时不读取 Skill 正文。流式 `start` 事件返回 `skills` 与 `unknownSkills`；已加载的标识以 `{ type: 'skills' }` 事件随回复入库。缺少工作目录时返回 400 `SKILL_WORKSPACE_REQUIRED`（含 `skills` 字段）。
- 前端独立选择器 `frontend/js/home/dragon-claw-skills.js` 与原生首页共用输入框；样式、键盘、输入法行为单独实现，不替换已有斜杠菜单。

Skill 提供流程方法，不创建工具或账号权限。普通用户仍只读；管理员 full 模式继续自主执行现有工具，不因加载 Skill 增加审批。用户当前要求（例如“只分析”“请修复”）优先于 Skill 的默认流程。模型是否正确遵循流程仍需实际模型验收，不能由“已加载”标签保证。

## 验证

`tests/agent-skills.test.js` 覆盖实际文件加载、标识识别、去重和工作区前提。`tests/ai-chat-ownership-route.test.js` 通过真实 HTTP 检查登录、无目录提示、模型收到 Skill 正文，以及普通用户没有因 Skill 获得写入或 Shell 工具。

`tests/ai-skill-catalog-contract.test.js` 覆盖真实目录注入、未注册示例名/链接校验、草稿未保存状态、正常代码和联系人不被误改、目录元数据脱敏、租户/隐藏边界，以及 HTTP 最终回复、历史记录和工作区转录的一致性。模型使用模拟响应，不调用真实供应商。

`tests/agent-script-service.test.js` 使用临时 SQLite 验证长脚本复制、局部修改、新建、删除、语法拒绝、版本冲突、凭据脱敏和租户隔离；`tests/ai-database-chat.test.js` 通过真实 HTTP 和模拟模型验证无 `@` 自动加载、普通对话/工作区实际复制提交与回读，以及停在方案时继续调用工具。不操作生产数据，不向真实站点发送抓取请求。

运行 `node_modules/.bin/electron tests/dragon-claw-skills-browser.cjs`，使用真实首页 DOM、完整首页/Skills 脚本和临时浏览器配置，检查搜索、键盘/鼠标选择、加载重试、中文输入法、斜杠菜单兼容、发送内容、已加载提示、英文与窄屏浅色布局。模型传输使用模拟响应，未调用真实供应商。

源码更新后，已运行的 PM2 后端需重新加载，浏览器需刷新；已安装桌面程序需重新打包/安装后才能包含本功能。本次未重启生产进程或制作安装包。

本次全项目 `node --test --test-concurrency=4 tests/*.test.js` 共 1,182 项通过，0 失败、0 跳过。后端 `npm run doctor`、修改过的业务 JS 语法检查与 `git diff --check` 通过；Skills、动态状态和恢复三组 Chromium 检查通过。旧浏览器测试夹具补齐了当前首页已有的用户消息按钮与历史分页依赖，没有修改这两项产品行为。
