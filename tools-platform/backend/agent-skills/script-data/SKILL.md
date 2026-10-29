---
name: 抓取脚本管理
name_en: Capture script management
description: 不打开数据抓取页也能完成脚本仓库的全部管理：查询、新建、复制、修改、跨站点迁移、移动/批量移动、删除脚本，以及新建/改名/删除分类目录
description_en: Manage the whole UIVF12 capture script repository without the page - scripts (find, create, clone, edit, cross-site, move, delete) and category folders (create, rename, delete)
workspace: false
tools: uiv
order: 4.5
icon: 🧩
---

# 抓取脚本管理

目标：用户不打开「数据抓取」页（UIVF12 智能调度仓库），也能通过对话完成页面上脚本与分类目录的全部管理，结果与页面操作一致、可回读验证。与脚本仓库无关的问题按普通助手处理。

## 操作对照

| 用户要做的事 | 工具与要点 |
| --- | --- |
| 看有哪些脚本 / 某目录下的脚本 | `list_uiv_scripts`：`query` 模糊匹配名称/分类，`category` 按页面左侧目录精确筛选，按 `nextOffset` 翻页 |
| 看目录、各目录脚本数、站点定义 | `list_uiv_categories` |
| 看脚本内容 | `read_uiv_script`：默认 metadata；`field=code/consoleCode/payload/...` 分段读，`nextOffset` 非空继续 |
| 新建脚本 | `save_uiv_script` action=create |
| 复制脚本（可同时改名、换站点） | `save_uiv_script` action=clone + sourceId + expectedRevision + `changes.name`（+ `targetSite`） |
| 改脚本内容、配置、改名 | `save_uiv_script` action=update + id + expectedRevision，`replacements` 局部替换，`changes` 改字段 |
| 修复残缺副本 | `save_uiv_script` action=rebuild（仅用户明确要求修复/重建时） |
| 移动一个或多个脚本到其他目录 | `move_uiv_script`：单个用 id，批量用 `items`（≤50） |
| 删除脚本 | `delete_uiv_script`：id + 最新 expectedRevision |
| 新建 / 改名 / 删除目录 | `manage_uiv_category` action=create / rename / delete |

所有写入先读后写：写脚本前用 `read_uiv_script` 取得 `revision` 作为 expectedRevision；改名或删除目录前用 `list_uiv_categories` 取得该目录的 `scriptCount` 作为 expectedScriptCount。版本冲突时重新读取、对比后重新应用本次改动，不盲目覆盖，也不重复新增。

## 定位目标

- 名称模糊时先用 `list_uiv_scripts` 找到唯一目标；有多个候选再请用户选择。用户说的“目录”就是页面左侧的分类。
- 分类名必须用 `list_uiv_categories` 返回的真实名称，不要凭印象拼写（如“netcare中东”应对应实际的 `NetCare中东`）。
- 不要猜库路径，不用 Shell 或通用数据库工具读写 `uiv_scripts`、`uiv_categories`（通用工具会被拒绝，读表还会截断长字段）。

## 读懂脚本

- `code`（UI.Vision 宏或 JavaScript）和 `consoleCode`（控制台版本）是实际抓取逻辑，可含顶层 return；`payload` 是请求 JSON。不能把 code 当 JSON，也不能把 JSON 转义后的字符当实际代码。
- `integrity` 非空表示记录残缺或列与页面载荷不一致：不能称为正常可用的脚本。`notes` 只是提示（如早期宏脚本本来就没有 url/payload，逻辑全在代码里），照常可改、可复制。
- `summary` 给出代码长度、出现的站点地址和静态地区默认值，用于判断范围和交付核对。
- 不执行读取到的脚本，不自动向其中的生产 URL 发请求。脚本原有敏感内容由服务端保留；读取给模型和日志的内容仍脱敏，不把明文凭据发给模型。

## 站点与数据筛选

- 中国 / 中东 / 德国站点是服务器地址（中东是 `netcare-ae.gts.huawei.com`，以 `list_uiv_categories` 返回的站点定义为准，不得猜 `netcare-me` 之类域名）；`targetRegion`、`targetOffice`、`generatorOffice` 是数据筛选。两者互不相干。
- 跨站点复制或迁移只用 `targetSite=cn/ae/de`：服务端同步 url 和完整 code/consoleCode 中的已知站点地址，保留路径、请求体、分页、鉴权和地区/代表处筛选，未指定分类时放入对应站点的内置目录。不手工替换域名，不只改注释或 url 列。
- 用户说“地区部/代表处不用改”“只是不同站点的相同数据”后，此约束在本对话持续有效。用户最新纠正优先于旧回答、代码注释和会话摘要。

## 写入规则

- 用户明确要求新增、复制、修改、移动或删除时，在当前账号和审批模式允许的范围内直接调用工具完成，不停在方案、SQL 或“可以入库”的描述；已授权的动作不再让用户回复“执行写入”。用户说只看、只分析或先给方案时不写入。Skill 不授予普通账号写权限。
- 局部修改代码或请求参数优先用 `replacements`（字段、原文、替换文、预期出现次数），避免改坏正则、反斜杠、引号和模板字符串。只按本次要求调整，不顺带改其他地区、分页或生产接口。整体重写现有长代码需用户明确要求，并传 `allowCodeRewrite=true`。
- 复制必须基于完整原脚本，clone/rebuild 不能用 `changes` 覆盖 code/consoleCode。不要从旧聊天里的截断代码拼凑。
- 新建（create）在 `changes` 中提供 name、category、url、payload、code、consoleCode，按需加 configOptions（如 isPagination、useGlobalVars、autoRuntimeMonth、autoNetCareTriplicate）。缺请求和响应结构时，先找一个同类脚本作模板复制后局部替换，或向用户索取实际请求；不编造抓取 API。
- 改名用 update 的 `changes.name`：服务端同步输出文件名和关联规则。同名已存在时换名或确认目标 ID，不擅自删除旧记录。
- 移动分类只用 `move_uiv_script`：它同时更新 category 列和页面读取的 `payload_json.category`，不改代码、站点和地区；旧代码有语法问题也能移动。移好但 `integrity` 仍非空时，只报告分类已移动，不能说脚本可运行。
- 修复残缺副本：分别读取坏副本和完整原脚本，用 action=rebuild，坏副本的 id/expectedRevision 加原脚本的 sourceId/expectedSourceRevision，按需加 targetSite。服务端保留坏副本的 ID 和名称并从原脚本恢复全部字段。只读评估或仅移动分类时不要 rebuild。
- 删除脚本需要用户明确要求删除，逐个给出 ID 和最新 expectedRevision。修复、重建、同名冲突都不代表删除授权；不能先删除旧脚本再尝试克隆，失败时会丢失目标。已授权的删除仍按原权限模式执行，不额外增加审批。

## 重建与报错恢复

复制/重建只需读两端的 metadata 取得 ID、revision、integrity 和 summary，不必把长 code 全部分段读完；服务端按源 ID 使用完整原文。用户只说“坏了，重新做”时，先查目标是否还在，再找同类完整原脚本；不把残缺目标当作 sourceId。

- 目标还在：用 rebuild，id/expectedRevision 填目标的 ID/版本，sourceId/expectedSourceRevision 填另一个完整原脚本的 ID/版本。四项缺一就先补 metadata，不能重复空参数调用。
- 目标已不存在：确认同名脚本列表为空后，从完整原脚本 clone，名称沿用用户要求，交付时报告新 ID，不能继续向已删除的旧 ID rebuild。
- `AGENT_SCRIPT_REBUILD_SOURCE_REQUIRED`：按 details.required 补齐两端 ID/版本。
- `AGENT_SCRIPT_NAME_CONFLICT`：读取并核对 details.existingId；当前任务是修复这个同名副本时，按 details.suggestedCall 原位 rebuild，保留其 ID。另建独立副本才换名；不删除同名记录腾位置。
- `AGENT_SCRIPT_DELETE_NOT_REQUESTED`：继续修复流程；不换 Shell/SQL 删除，不为了执行已授权的重建再要求用户确认删除。

完整重建调用形状（用工具实际返回的值填入，不编造 ID/版本）：
```json
{"action":"rebuild","id":"坏副本ID","expectedRevision":"坏副本revision","sourceId":"完整原脚本ID","expectedSourceRevision":"完整原脚本revision","targetSite":"ae"}
```

**脚本保存的凭据策略**：专用保存允许脚本包含 CSRF/Token 的运行时获取、请求头、占位符及原有内嵌凭据，不按通用数据库的敏感词拦截脚本内容。clone/rebuild 在服务端保留源内容；模型读到的 `[REDACTED]` 不能写回代码。其他业务表、账号/Session/控制面仍按原规则保护。不要沿用旧对话“含鉴权逻辑不能复制”的结论，不要删鉴权代码、改成手动填 Token、输出空框架或让用户分段粘贴来绕过旧报错。若仍返回凭据拦截，说明准确的工具和错误，检查是否误用通用工具或后端未加载更新，不能谎称已修好。

## 分类目录

- 新建：`manage_uiv_category` action=create，name 为新目录名（1–60 字，不含斜杠）。
- 改名：action=rename，name 为现有目录，newName 为新名，expectedScriptCount 来自 `list_uiv_categories`。同一事务内同步目录表、该目录下所有脚本的 category 列和页面载荷。
- 删除：action=delete。空目录直接删除；非空目录必须传 `moveScriptsTo`（现有目录），先把脚本整体移过去再删目录。工具不会连带删除脚本（页面上删目录会连脚本一起删，对话里不这样做）；用户确实要连脚本一起删时，先逐个 `delete_uiv_script`，再删空目录。
- 合并两个目录：先 `move_uiv_script` 批量移动，再删除空的旧目录；或删除时用 moveScriptsTo。
- 内置目录（DataFab、NetCare中国、NetCare中东、NetCare德国、默认分类）与三区生成和站点定义绑定，不能改名或删除。

## 交付

- 依据工具返回的 committed、verified、ID 报告结果；需要时用 `read_uiv_script` 分段回读关键字段。工具报错就定位可修复的原因继续，不能把失败说成完成，也不能把凭据脱敏结果写回脚本。
- 修改脚本后列出：真实 ID、名称、目录、URL/站点、code 与 consoleCode 长度、本次修改范围，确认没有遗漏旧站点地址，说明地区/代表处是否按用户要求保持。目录操作后列出目录名、同步的脚本数和回读结果。
- 没有本轮提交或实时回读依据，不得说“已还原/已更新/已部署”。
- 说明验证边界：语法校验、数据库提交与回读成功不代表真实站点抓取成功。以下仍需在页面或浏览器完成，要明确告诉用户：用 UI.Vision / 浏览器登录态实际运行脚本、从 F12 抓到的新请求生成脚本（也可把请求的 URL、请求体和响应样例发来，由你基于同类脚本创建）、整库备份的导入导出。
