# NetCare RFC 方案与 AI 审计 · Chrome / Edge 上架指南

核对日期：2026-10-15。本文依据当前内置脚本与打包器（基线 v1.0.18）编写，参考题库与答题助手上架指南的结构与合规标准，已根据 Chrome Web Store 最新审查反馈（Yellow Argon 关键字反垃圾规则）完成描述合规修订。本指南用于开发者准备向应用商店提交扩展，不代表已获得平台豁免或承诺包必定通过审核。发布前请根据最终生成的发布 ZIP 包和实时官方政策进行逐项复核。

---

## 1. 是否可以上架（合规与审核判定）

本扩展可准备向 **Microsoft Edge 外挂程序应用商店 (Edge Add-ons)** 与 **Google Chrome 网上应用店 (Chrome Web Store)** 提交，但当前版本包含企业内网系统交互与自主大模型 API 调用，**不能视为已默认满足所有无条件公开发布要求**。

### 1.1 合规属性判定

- **明确的运维与研发效能用途**：批量查询 RFC 变更方案、导出 DOCX 数字化文档、提取附件归档 ZIP、生成带排版和原图证据的审计表格 (Excel)，属于标准的“开发者/IT 运维生产力工具”范畴，受商店政策保护。
- **辅助性质与安全边界**：AI 审计结果仅提供 `通过 (pass)`、`不通过 (fail)`、`需人工核查 (needs_review)` 三态判定与结构化发现建议，工具定位为**“专家辅助复核与材料整理工具”**，不提供自动点击审批或绕过审批流程的功能，符合软件安全规范。
- **本地化隐私架构**：大模型 API Key 仅保存在浏览器本地扩展存储 (`chrome.storage.local`)，方案正文、附件、截图与快照完全在本地内存及 IndexedDB 处理，不经过任何开发者中转服务器，符合 Chromium 拓展的最小特权与隐私保护准则。

### 1.2 核心审核风险与合规红线

1. **绝对真实描述，禁止虚假声明**：
   - 不得以“纯本地、完全不联网、无网络通信”宣传本插件。当用户配置并启用 AI 审计时，选定章节文本与 TXT 附件会直接发送给用户配置的大模型端点。
   - 不得宣称“100% 审计准确率”、“免除人工审批”或“绝对安全”。
2. **企业系统凭证与安全授权**：
   - 扩展不得携带或拦截用户的企业登录 Cookie 或 SSO Token；所有方案下载均依赖用户浏览器当前已登录会话。
   - 不得随扩展附带任何客户或企业内部真实方案数据、拓扑机密或内网凭据。
3. **商标与专有名称规范**：
   - 商店标题与描述中若包含“NetCare”或“Huawei”，应在副标题或说明中声明“用于辅助 NetCare 系统用户进行 RFC 方案文档整理的第三方效能工具”，避免审核员判定为冒充官方应用或侵犯知识产权。建议使用：`NetCare RFC 方案与 AI 审计助手` 或 `RFC Solution & AI Audit Assistant for NetCare`。
4. **广泛主机权限风险**：
   - 为支持用户自由配置大模型服务器（含私有内网模型与公有云服务），扩展声明了 `https://*/*` 与 `http://*/*`。这是商店审核的重点关注对象。若面向公网通用商店发布，需准备完备的权限申诉理由；若可能，可在定制版本中将模型端点收窄为选定服务商或改用声明式用户授权。

---

## 2. 提交前待办事项清单（开发者必查）

- [ ] **打包模式**：在 F12 扩展打包器中务必选择 **“Microsoft Edge 插件商店提交包（移除 manifest.key）”**；该模式会自动剥离清单固定公钥并**强制关闭代码混淆**（商店对混淆代码极易拒审）。
- [ ] **代码规范核查**：确保打包出来的代码无 `eval()`、无 `new Function()`、无动态远程加载 `<script src="https://...">`。内置的 html2canvas 已经过离线本地化打包，满足 MV3 离线代码合规要求。
- [ ] **模型与审计脱敏核验**：确认在请求模型与生成日志时，系统识别到的密码、Token、Authorization、私钥均已执行脱敏替换。
- [ ] **图标与宣传素材**：
  - 扩展图标：16×16、32×32、48×48、128×128 PNG（建议原创设计的盾牌/文档/芯片图标，保持 16px 安全边距）。
  - Edge 徽标：300×300 PNG。
  - 宣传截图：1280×800 高清截图（至少 1 张，推荐 3~4 张），**截图内必须全部使用脱敏模拟数据，严禁出现真实公司单号、敏感拓扑图或员工账号**。
- [ ] **公开隐私政策 URL**：必须部署并提供长期有效、公网可访问的隐私政策页面（如使用 GitHub Pages），政策内容需与本指南第 11 节保持一致。
- [ ] **准备审核测试环境**：
  - 准备一份供审核员测试的公开或模拟测试端点及测试用例。
  - 详细的 Reviewer Notes 说明如何输入模拟 RFC 单号、如何配置测试模型，以及预期输出效果。

---

## 3. 包结构与配套资料

标准商店发布包为 `extension-netcare-rfc-word-v<版本号>-edge-store.zip`，根目录结构如下：

```text
├── manifest.json                  # 清单文件（无 manifest.key）
├── background.js                 # 扩展后台服务（处理模型转发与标签页管理）
├── content.js                    # 页面核心注入脚本（方案抓取与浮窗）
├── popup.html                    # 扩展工具栏弹窗入口
├── popup.css                     # 弹窗样式
├── popup.js                      # 弹窗控制逻辑
└── NETCARE_STORE_SUBMISSION_GUIDE.md  # 本上架指南（随包提供，便于溯源）
```

> **注意**：商店包上传后，Microsoft 与 Google 会由应用商店签名并分配永久 Extension ID。本地包保留固定 Key，切勿将 `-local.zip` 误传至商店后台。

---

## 4. 可复制：中文商店名称与短描述

### 扩展名称
```text
NetCare RFC 方案与 AI 审计助手
```

### 短描述（132 字符以内）
```text
面向 NetCare 用户的 RFC 数字化方案导出、章节附件归档与多模型 AI 辅助合规审计效能工具。
```

---

## 5. 可复制：英文商店名称与短描述

### Extension Name
```text
NetCare RFC Plan & AI Audit Assistant
```

### Short Description (within 132 characters)
```text
Export RFC digital plans, bundle attachments, and perform offline-first AI compliance audits with custom models.
```

---

## 6. 可复制：中文详细描述

```text
NetCare RFC 方案与 AI 审计助手是一款专为网络运维与工程技术人员打造的方案导出、附件归档与 AI 辅助复核效能工具。

【核心功能】
1. 方案一键导出与在线预览：支持输入一个或多个 RFC 变更单号，自动对接 NetCare 原生导出入口生成标准 DOCX 数字化方案，并可在后台联动打开在线原页进行画中画浏览。
2. 章节结构扫描与全附件归档：自动扫描方案完整目录树，智能识别各章节中的各类离线附件及正文内容；支持按规则提取指定章节并打包生成标准 RFC 归档材料压缩包。
3. 章节规则模板与名称纠错：内置章节模板，支持层级继承匹配；当实际方案章节编号缺失或变更时，可按章节完整标题自动纠错定位，保证提取完整性。
4. 多模型 AI 辅助合规审计：支持用户自主接入 OpenAI（Chat / Responses）、Anthropic（Messages）、Gemini 及兼容协议模型（含私有内网模型与自定义端口）。系统按章节针对性提示词执行三态判定（通过 / 不通过 / 需人工核查），提供中英双语摘要与风险发现。
5. 原始区域截图与证据留存：内置离线渲染组件，对提取章节与关键附件所在 DOM 区域捕获清晰 PNG 原图证据，避免纯文本还原失真。
6. 结构化报告与材料导出：一键导出带合并单元格、详细原因与原图排版的标准审计表格，支持下载包含原始方案、附件、截图与审计结论的完整材料压缩包。
7. 本地安全与配置备份：所有模型 API Key、审计记录与快照均保存在本地浏览器 IndexedDB 及加密存储中；支持通过 AES-256-GCM 密码加密导出与恢复完整配置。

【安全与隐私声明】
- 本工具为前端辅助效能扩展，所有网络请求均在用户本地发出，无第三方中转服务器，开发者不收集任何用户数据。
- 方案下载依赖用户当前浏览器中已登录的有效会话，扩展不拦截、保存或上传任何用户身份凭据（Cookie/SSO Token）。
- AI 审计功能默认关闭，且必须由用户自行配置模型接口及 API Key。调用 AI 时仅外发用户明确勾选的章节文本证据，敏感字段（密码、Token、私钥）会自动脱敏处理。
- 审计结论仅供技术人员复核参考，不代表官方审批意见，亦不替代人工技术复核。
```

---

## 7. 可复制：英文详细描述

```text
NetCare RFC Plan & AI Audit Assistant is a professional productivity extension designed for network engineers and IT operations teams to streamline RFC document export, attachment archiving, and intelligent compliance review.

Key Features:
1. One-Click Document Export: Batch retrieve and export standard DOCX digital plans by RFC change ticket numbers, with optional background picture-in-picture tabs for native online review.
2. Full Directory Scan & Attachment Packaging: Automatically parse native section structures, recognize associated offline attachments and body content, and bundle designated sections into organized archive packages.
3. Hierarchy Templates & Title Correction: Match sections with hierarchical templates. If section numbers vary, smart title-based matching accurately identifies targets without manual intervention.
4. Flexible BYOK AI Audit: Bring your own API keys for OpenAI (Chat/Responses), Anthropic (Messages), Google Gemini, or compatible self-hosted private models. Perform three-state compliance checks (Pass, Fail, Needs Review) with dual-language summaries and findings.
5. High-Fidelity Visual Evidence Capture: Utilizes offline-bundled canvas components to capture screenshot evidence of exact DOM elements and attachment tables, preserving the visual integrity of original plans.
6. Professional Audit Spreadsheet & Materials Export: Generate structured audit spreadsheets with merged cells and embedded screenshot rows. Download complete audit dossiers including source plans, attachments, screenshot evidence, and audit conclusions.
7. Local Isolation & Encrypted Backup: All credentials, audit snapshots, and logs are kept strictly within local browser storage (IndexedDB). Full configurations can be exported and restored using AES-256-GCM encryption.

Security & Privacy Standards:
- Zero Developer Tracking: Fully client-side architecture. The publisher operates no remote servers and collects no telemetry or user data.
- Session Protection: Leverages existing user authentication in the active browser session. Never intercepts, extracts, or transmits login cookies or account passwords.
- Explicit AI Data Dispatch: AI audit is disabled by default. When enabled, only user-selected section texts are transmitted directly to the user-configured model endpoint. Sensitive credentials (keys, tokens) are strictly redacted before dispatch.
- Purely Advisory: AI findings are advisory aids for engineering review and do not execute automated site actions or replace human authorization.
```

---

## 8. 可复制：单一用途描述（Single Purpose）

### 中文版
```text
本扩展专门用于帮助网络运维工程师在授权的 NetCare 方案页面中批量导出 RFC 变更方案、打包章节附件材料，并利用用户自主配置的 AI 模型执行离线式辅助合规复核与本地报表生成。所有功能均严格围绕 RFC 方案归档与合规复核这一单一业务工作流展开。
```

### English Version
```text
This extension is specifically designed to assist network engineers in exporting RFC digital change plans from authorized NetCare portals, archiving section attachments, and performing client-side AI-assisted compliance audits with user-configured models. All features strictly serve this single workflow of RFC document management and review.
```

---

## 9. 可复制：权限理由说明（Permission Justifications）

| 权限名称 | 申诉理由（英文，供后台直接粘贴） | 中文说明 |
| :--- | :--- | :--- |
| `storage` | Stores user-defined section rules, model endpoint configurations, language choices, and local audit preferences within the browser. | 保存章节规则、模型端点、界面语言及本地偏好。 |
| `unlimitedStorage` | Accommodates multi-batch audit snapshots, structured Excel reports, and temporary binary attachment caches in local IndexedDB without browser quota truncation. | 允许 IndexedDB 存储多单审计快照与材料，避免超出配额限制。 |
| `activeTab` | Accesses the active RFC change page when the user explicitly clicks the extension icon and presses "Start Script" to initialize the floating assistant. | 用户点击启动脚本后，获取当前活动标签页以注入浮窗。 |
| `scripting` | Programmatically injects the packaged offline assistant UI and document processing logic into the supported active page upon user command. | 向当前匹配网页注入打包好的本地界面与导出脚本。 |
| `webNavigation` | Detects and coordinates native regional navigation (e.g. cross-region jumps between regional NetCare portals) to seamlessly maintain current RFC batch progress. | 监听并接续中国、德国、埃及站之间的跨区域原生路由跳转。 |
| `Host Permissions` (NetCare & KDP sites) | Grants access to authorized NetCare portal domains and KDP export endpoints to parse solution chapters and download native Word/attachment files. | 访问指定 NetCare 业务域名以读取方案正文并下载附件。 |
| `Host Permissions` (`https://*/*`, `http://*/*`) | Allows direct communication from the background worker to user-configured AI model endpoints (including cloud APIs and self-hosted on-premise HTTP/HTTPS model gateways with custom ports). No cookies are attached. | 允许扩展后台与用户自定义的公有云或私有内网大模型接口通信，绝不携带网站 Cookie。 |

---

## 10. 数据披露与远程代码声明

### 10.1 远程代码 (Remote Code)
- **在使用远程代码吗？ (Are you using remote code?)**：👉 **必须选择【否】(No)**。
- **说明文案**：
```text
All JavaScript, HTML, and CSS assets (including the html2canvas renderer and styling) are completely bundled within the extension package. No remotely hosted scripts, eval(), or dynamic code evaluations are executed. AI endpoints return plain text/JSON data, which is parsed strictly as data and never evaluated as executable code.
```

### 10.2 数据使用与隐私实践 (Data Usage)
在开发者中心勾选数据类型时：
- **Web History / 浏览历史**：👉 **不勾选 (No)**（扩展仅在用户明确交互的匹配页面运行）。
- **User Activity / 用户活动**：👉 **不勾选 (No)**。
- **Personally Identifiable Information / 个人身份信息**：👉 **不勾选 (No)**。
- **Authentication Information / 身份验证信息**：👉 **勾选**（如果后台将用户填写的第三方 AI API Key 归为此类），并注明：
  > "User-provided third-party model API keys are stored strictly in local browser storage and used solely to authenticate direct requests to the respective model providers. No credentials are sent to the publisher."
- **User Content / 用户内容**：👉 **勾选**（因读取方案文本供 AI 审计），并注明：
  > "Section text and test evidence are read from user-visited web pages and forwarded exclusively to user-specified model APIs upon explicit user command for compliance review. No data is collected or retained by the extension developer."

---

## 11. 专属隐私政策（已与题库助手隐私中心合并统一发布）

本平台内置扩展的公开统一隐私政策页面地址（中英双语，公网可访问）：

https://cs.fanxiaolong.uk/custom-tools/question-bank-assistant-privacy/index.html

发布 NetCare 方案与 AI 审计扩展或题库助手扩展时，在“Privacy policy URL *”直接填入此公开链接即可。以下为对应的隐私条款正文（已同步至该页面）：

```text
NetCare RFC 方案与 AI 审计扩展隐私政策
更新日期：[填写发布日期，如 2026-10-11]
开发者主体：[填写真实开发者或团队名称]
联系支持：[填写有效联系邮箱或 GitHub Issue 链接]

1. 概述
NetCare RFC 方案与 AI 审计助手（以下简称“本扩展”）是一款注重用户数据隐私的本地化浏览器扩展。本扩展旨在协助网络工程师导出 RFC 变更方案并执行本地/AI 辅助复核。开发者深知数据安全的重要性，特制定本隐私政策，透明披露数据处理实践。

2. 数据收集与中转
本扩展秉持“零数据收集”原则：
- 开发者不拥有、不运营任何用于收集、分析或中转用户数据的中心化服务器。
- 扩展不包含任何第三方跟踪代码、分析 SDK 或广告推广脚本。
- 扩展完全运行于用户本地设备及浏览器环境中。

3. 网页内容与会话保护
- 本扩展仅在用户明确点击“启动脚本”后，处理用户当前打开的授权 NetCare 网页中的方案内容（包含章节标题、文本内容及附件链接）。
- 本扩展绝不读取、窃取、持久化或外传用户的网站登录凭证、Cookie、Session Token 或企业账户密码。所有文档下载均基于用户现有的有效浏览器会话通过官方通道进行。

4. AI 模型调用与外部传输
- AI 审计功能默认保持关闭状态。只有当用户自主在设置中配置大模型端点、填写 API Key 并勾选开启 AI 审计时，才会发起模型通信。
- 调用 AI 时，扩展仅提取用户选定章节的文本证据，并在发起请求前对密码、Token、私钥等典型凭据进行正则脱敏。
- 请求直接由用户浏览器后台发送至用户指定的大模型端点（如 OpenAI、Anthropic、Google 或用户自建的内网服务器）。各模型服务商对数据的存储、保留与训练政策受其各自隐私条款约束，请用户自行甄别并选择合规的服务商。

5. 本地数据存储与安全
- 用户的配置偏好、章节规则模板、模型设置及 API Key 均保存在浏览器的本地隔离存储 (chrome.storage.local) 中。
- 历史审计快照、生成的 Excel 报表和截图缓存在本地 IndexedDB 中，用户可在扩展界面中随时查看占用空间、导出归档或一键清空。
- 扩展支持全量配置加密备份功能，采用业内标准的 AES-256-GCM 算法与 PBKDF2 密钥派生，备份文件必须使用用户设定的密码方可解密恢复。

6. 权限使用说明
本扩展请求的 storage、activeTab、scripting、webNavigation 及网络主机权限，仅用于实现文档提取、界面呈现、多站点路由接续及用户自主配置的模型请求，绝不超出本政策所声明的范围滥用权限。

7. 政策变更与联系我们
若本扩展功能发生重大变更影响数据处理方式，我们将在此隐私页面及时更新版本。如有任何疑问，请通过上述支持邮箱联系我们。
```

---

## 12. Microsoft Edge 商店详细提交步骤

1. **登录控制台**：使用微软开发者账号登录 [Microsoft Partner Center (Edge Add-ons)](https://partner.microsoft.com/dashboard/microsoftedge)。
2. **创建扩展**：点击“Create new extension”，上传打包器生成的 `extension-netcare-rfc-word-v<版本>-edge-store.zip`。
3. **完善属性 (Properties)**：
   - 分类 (Category)：选择 **「高效工作」 (Productivity)** 或 **「开发者工具」 (Developer Tools)**。
   - 支持链接 (Support URL)：填写真实的 GitHub 仓库或问题反馈地址。
4. **隐私信息 (Privacy)**：
   - 单一用途描述：粘贴第 8 节英文或中文内容。
   - 权限理由：按第 9 节表格逐一复制填入每个权限的对应理由。
   - 远程代码：选择 **【No】** 并粘贴第 10.1 节说明。
   - 隐私政策 URL：填写第 11 节发布的公网隐私政策链接。
5. **详细信息 (Store Listings)**：
   - 填写中文 (Simplified Chinese) 与英文 (English) 页面，分别填入第 4~7 节提供的中英文名称与详细介绍。
   - 上传 300×300 徽标与 1280×800 截屏图片。
6. **提交审核**：在“Notes for certification”中粘贴第 14 节的审核测试说明，点击提交。审核周期通常为 24~48 小时。

---

## 13. Google Chrome 商店详细提交步骤

1. **登录控制台**：登录 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)。
2. **上传程序包**：点击“Add new item”，上传 `-edge-store.zip` 包（该包为标准 MV3，完全兼容 Chrome）。
3. **商品详情 (Store Listing)**：
   - 填入扩展名称、精简描述（132字符）与详细描述（第 4~7 节）。
   - 上传 128×128 图标与至少 1 张 1280×800 截图。
   - 类别建议选择 **Productivity** 或 **Developer Tools**。
4. **隐私权规范 (Privacy Practices)**：
   - 单一用途说明：粘贴第 8 节内容。
   - 权限说明：为 `storage`、`activeTab`、`scripting`、`webNavigation` 及 Host permissions 逐项填写第 9 节理由。
   - 数据使用声明：按第 10.2 节准确勾选，并勾选“我保证遵守开发者计划政策”及“Limited Use”合规承诺。
   - 填写隐私权政策网页 URL。
5. **提供给审核人员的说明 (Notes for Reviewer)**：在后台测试说明字段中填入第 14 节英文文本（首次提交参考 14.1，若遇 Yellow Argon 重新提交参考 14.2），附带演示说明与模拟指引后点击提交。

---

## 14. 可复制：审核测试说明（Reviewer Notes）

### 14.1 首次提交审核说明 (Standard Notes for Reviewer)

```text
Dear Review Team,

Thank you for reviewing the "NetCare RFC Plan & AI Audit Assistant" extension.

1. Extension Purpose:
This tool assists network maintenance engineers in exporting standardized digital change documents (DOCX) from authorized NetCare management portals, archiving chapter attachments, and performing client-side compliance audits using user-configured AI models.

2. Architecture & Security:
- 100% Client-Side: No backend servers are maintained by the developer; no telemetry or tracking is embedded.
- BYOK (Bring Your Own Key): All AI capabilities require the user to configure their own API endpoint and key. Sensitive credentials are kept strictly inside local browser storage and never uploaded to third parties.
- Safe Execution: Zero remote code execution. All UI components, including the canvas snapshot engine, are locally bundled.

3. Testing Instructions (Without Production Credentials):
Since NetCare is an enterprise network management platform, we have designed the extension so that core features can be verified safely:
Step 1: Install the package and navigate to any page matching the manifest or a local test page.
Step 2: Click the extension icon in the toolbar and select "Start Script" (启动脚本). The floating assistant will appear in the bottom-right corner.
Step 3: Click the Settings button (gear icon) in the floating window.
Step 4: Go to "AI Integration" (AI 对接). Add a test model (e.g., standard OpenAI, Anthropic, or compatible gateway) and click "Connection Test". The test makes a direct request using the user's provided credentials and returns diagnostic latency/status without storing keys outside the extension.
Step 5: Navigate to "Section Rules" (章节规则) and "General" (常规) to verify rule hierarchy editing, JSON configuration export, and AES-256-GCM encrypted backup/restore.
Step 6: Review the "Plugin Logs" (插件日志) panel to verify that all logged URLs and headers have credentials and tokens properly redacted.

Support & Privacy Policy:
- Privacy Policy: https://cs.fanxiaolong.uk/custom-tools/question-bank-assistant-privacy/index.html
- Support Contact: fanxiaolongx@gmail.com

Please let us know if any further clarification or simulated test data is needed.
```

### 14.2 针对 Yellow Argon 拒审的专用申诉 / 重审说明 (Notes for Reviewer / Appeal Notes for Yellow Argon Fix)

> **使用场景**：当收到 `Yellow Argon`（关键字垃圾内容 / Keyword Stuffing）拒审通知后，在 Chrome 开发者信息中心修改商品详情后，在「提供给审核人员的说明 (Notes for Reviewer)」或「申诉 (Appeal)」输入框中粘贴以下内容：

```text
Dear Chrome Web Store Review Team,

Thank you for your feedback regarding our extension "NetCare RFC 方案与 AI 审计" (ID: pbfmjlfgfhbkogpljlpdkfjmboogldje).

In response to the Yellow Argon keyword-stuffing notice:
1. Keyword Removal: We have completely removed all file extension listings (specifically "TXT, Word, ZIP, RAR, MSG, PDF") from both the Chinese (China) and English detailed descriptions.
2. Natural Functional Descriptions: The descriptions have been revised to use clean, natural, and context-specific functional descriptions explaining how attachments and sections are archived without enumerating file format keywords.
3. Policy Compliance: The store metadata strictly complies with the Chrome Web Store Program Policies regarding keyword spam and misleading metadata.

Testing Instructions & Verification:
- The updated descriptions can be found under the Store Listing tab for both Chinese (China) and English.
- The extension remains fully client-side (no remote servers or telemetry).
- Functional verification instructions remain as described in our original notes (open options/floating panel -> verify connection test and rule hierarchy).

Thank you for re-evaluating our submission.

Sincerely,
NetCare Extension Development Team
```

---

## 15. 常见拒审风险与过审应对技巧

### 15.1 企业专用系统与无法登录审核 (Restricted / Private Portal)
- **原因**：审核员通常无法访问公司内网或真实 NetCare 生产系统，可能因“无法验证核心功能”拒审。
- **应对方案**：
  1. 在 Reviewer Notes 中详尽说明企业背景与使用场景；
  2. 录制一份 1~2 分钟的无敏感信息的完整功能操作演示视频（包含单号输入、文档导出、AI 审计、Excel 导出），上传至 YouTube（设为 Unlisted 不公开列出）并将链接提供在审核备注中；
  3. 提供本地或公网模拟演示页（Demo Mock Page），供审核员直观体验浮窗交互与配置保存。

### 15.2 Host Permissions 宽泛审查 (`https://*/*`, `http://*/*`)
- **原因**：商店对声明了全域名或 HTTP 访问的拓展审查极其严苛。
- **应对方案**：
  1. 必须在权限理由中强调：全网域名请求**仅用于用户自主配置的私有/公有大模型端点**（如用户公司本地搭建在 `http://192.168.x.x:8000` 或公有云的 AI API），且不带 Cookie；
  2. 若审核团队坚持要求收窄，可将通用发布版收窄为仅支持几大公有服务商域名（`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`），并将内网自建服务版作为企业离线包分发。

### 15.3 敏感词与知识产权审查
- **原因**：标题或描述中出现特定企业品牌商标可能触发自动化合规拦截。
- **应对方案**：
  - 避免使用“NetCare 官方插件”等误导性词汇；
  - 始终标明“用于 NetCare 系统的第三方辅助效能工具”。

### 15.4 关键字垃圾内容拒审处理 (Yellow Argon / Keyword Stuffing)
- **拒审原因**：Google 商店严格禁止在扩展的标题、简介或详细描述中出现格式或标签枚举（例如 `'TXT, Word, ZIP, RAR, MSG, PDF'`）。即便这些是工具支持解析的文件格式，直接作为词组枚举仍会被判定为“过多和/或不相关的关键字 (Keyword Stuffing / Keyword Spam)”。
- **整改要点**：
  1. 彻底移除所有用逗号或斜杠隔开的文件后缀/格式枚举列表；
  2. 使用“各类离线附件”、“相关工程附件”、“标准归档压缩包”等自然中文短语；英文使用“associated offline attachments”、“body content”、“organized archive packages”；
  3. 同步检查其他字段（包括单一用途说明、权限理由），确保均无任何死板的关键词堆砌。
- **控制台申诉与重新提交操作步骤**：
  1. 登录 [Chrome 应用商店开发者信息中心](https://chrome.google.com/webstore/devconsole/)；
  2. 点击列表中被拒的项目：**NetCare RFC 方案与 AI 审计**（ID: `pbfmjlfgfhbkogpljlpdkfjmboogldje`）；
  3. 点击左侧菜单中的 **「商品详情 (Store Listing)」**；
  4. 切换到 **「中文（中国）」** 语言标签，将「详细说明」替换为本指南 **第 6 节** 最新的合规中文描述；
  5. 切换到 **「英语 (English)」** 语言标签，将「Detailed Description」替换为本指南 **第 7 节** 最新的合规英文描述；
  6. 点击右上角「保存草稿」；
  7. 点击左侧菜单进入 **「版本 > 状态」**（或「隐私权规范」/提交页面）；
  8. 找到 **「提供给审核人员的说明 (Notes for Reviewer)」** 字段（或在被拒版本的状态页面点击 **「申诉 (Appeal)」**）；
  9. 粘贴本指南 **第 14.2 节** 的专用说明文本；
  10. 点击 **「提交审核 (Submit for review)」**。

---

## 16. 官方政策与开发规范参考链接

- [Chrome 网上应用店程序政策总则](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Chrome 代码可读性与禁止混淆要求](https://developer.chrome.com/docs/webstore/program-policies/code-readability)
- [Chrome 最小特权与用户数据政策 (Limited Use)](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Microsoft Edge 扩展开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)
- [Microsoft Partner Center 扩展发布指南](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
