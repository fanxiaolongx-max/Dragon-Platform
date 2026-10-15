# Dragon Claw 内置 Skills

## 使用

在首页输入框输入 `@`，按中文名称、英文名称或标识搜索。↑↓ 切换选项，Enter/Tab 插入引用，也可用鼠标选择；选中后继续写任务，再按 Enter 发送。Shift+Enter 保持换行，Esc 关闭菜单，`/session` 等命令继续可用。

| 引用 | 用途 | 可直接测试的任务 |
| --- | --- | --- |
| `@project-map` | 只读梳理项目 | 帮我梳理项目入口、主要模块、数据流和启动方式 |
| `@debug` | 复现、定位、修复、验证 | 分析这条报错的根因，先不要修改代码：…… |
| `@code-review` | 默认只读审查真实缺陷 | 审查当前未提交修改，重点检查权限和异步竞态 |
| `@data-check` | 只读检查业务数据 | 找到本月报表数据，检查缺失和重复，说明检查范围 |
| `@write-doc` | 起草或写入项目文档 | 写一份给新同事的项目上手说明，先给草稿 |

前四项需要先选择工作目录，以便实际调用文件/数据库工具；`@write-doc` 可以不选目录直接起草，若需要基于源码编写或保存文件，则需选择目录和具备相应权限。

可在同一消息引用多个 Skill。中文可以紧贴引用，例如 `请用@debug看看`、`@debug帮我查`；邮箱（`a@debug.com`）、路径（`/tmp/@debug`）、文件名（`@debug.js`）不会被当作 Skill。写错名字时输入框下方会提示「未识别的 Skill」，回复顶部也会标出未识别的引用。

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
- 首页 `/api/ai/chat` 从当前用户消息解析引用，并合并请求体 `skills`（会话内保持的标签，最多 8 个，只接受目录内的标识），读取白名单文件注入本次模型系统上下文。客户端不能传入任意文件路径替换内置指令；没有引用时不读取 Skill 正文。流式 `start` 事件返回 `skills` 与 `unknownSkills`；已加载的标识以 `{ type: 'skills' }` 事件随回复入库。缺少工作目录时返回 400 `SKILL_WORKSPACE_REQUIRED`（含 `skills` 字段）。
- 前端独立选择器 `frontend/js/home/dragon-claw-skills.js` 与原生首页共用输入框；样式、键盘、输入法行为单独实现，不替换已有斜杠菜单。

Skill 提供流程方法，不创建工具或账号权限。普通用户仍只读；管理员 full 模式继续自主执行现有工具，不因加载 Skill 增加审批。用户当前要求（例如“只分析”“请修复”）优先于 Skill 的默认流程。模型是否正确遵循流程仍需实际模型验收，不能由“已加载”标签保证。

## 验证

`tests/agent-skills.test.js` 覆盖实际文件加载、标识识别、去重和工作区前提。`tests/ai-chat-ownership-route.test.js` 通过真实 HTTP 检查登录、无目录提示、模型收到 Skill 正文，以及普通用户没有因 Skill 获得写入或 Shell 工具。

运行 `node_modules/.bin/electron tests/dragon-claw-skills-browser.cjs`，使用真实首页 DOM、完整首页/Skills 脚本和临时浏览器配置，检查搜索、键盘/鼠标选择、加载重试、中文输入法、斜杠菜单兼容、发送内容、已加载提示、英文与窄屏浅色布局。模型传输使用模拟响应，未调用真实供应商。

源码更新后，已运行的 PM2 后端需重新加载，浏览器需刷新；已安装桌面程序需重新打包/安装后才能包含本功能。本次未重启生产进程或制作安装包。

本次全项目 `node --test --test-concurrency=4 tests/*.test.js` 共 1,182 项通过，0 失败、0 跳过。后端 `npm run doctor`、修改过的业务 JS 语法检查与 `git diff --check` 通过；Skills、动态状态和恢复三组 Chromium 检查通过。旧浏览器测试夹具补齐了当前首页已有的用户消息按钮与历史分页依赖，没有修改这两项产品行为。
