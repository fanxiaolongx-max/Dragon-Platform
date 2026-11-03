# 工具固定主题排查记录

排查日期：2026-11-03。按当前工作区及本机已安装工具清点，覆盖 133 个 HTML 页面、4,432 个原生表单及按钮控件；主题检查失败 0 项。

## 固定规则

- 普通工具固定亮色，平台首页、旧版首页偏好和操作系统切换均不改变工具配色。
- 大屏、项目演进、粒子特效、功能全景等原生暗色设计保留暗色。兼容原有暗色授权管理、存储状态及法律说明页。
- input、textarea、select、button 的 color-scheme 跟随工具自己的固定主题，月份选择器等不再随操作系统变暗。
- 固定工具页面的外观切换控件隐藏；胶片等内容本身的主题选择保留。
- 平台首页、登录及启动页面继续管理平台外观，不属于工具固定规则。

固定暗色路径由 `backend/models/asset-versioning.js` 中的 `NATIVE_DARK_TOOL_PATHS` 声明：

| 路径 | 用途 |
| --- | --- |
| pages/bigscreen.html | 质量运营大屏 |
| pages/project-evolution.html | 项目演进银河展示 |
| pages/desktop-license-admin.html | 原生暗色授权管理 |
| pages/storage.html | 原生暗色存储状态 |
| pages/privacy.html | 原生暗色隐私说明 |
| pages/terms.html | 原生暗色服务条款 |
| custom-tools/particle-effects | 粒子特效 |
| custom-tools/tool-msh8aro4 | 功能全景 |

新增原生暗色工具可在 HTML head 明确声明 `<meta name="tools-tool-theme" content="dark">`；未声明的工具默认亮色。子页面继承同一工具的路径策略。

## 修复的入口

1. 共享主题运行时不再读取、订阅或写入平台 `tools_theme`，旧版首页偏好不再绕过工具规则。
2. CSS 系统主题媒体查询和 JS matchMedia 使用固定偏好；保留原生 MediaQueryList 事件语义。
3. 工具自身保存的旧暗色根属性、class 和延迟主题脚本不会再覆盖固定主题，动态样式同样处理。
4. 原生页面、自定义工具主页面、HTML 子页面、Python 托管应用代理统一注入相同运行时，注入脚本按内容哈希更新缓存。
5. AI 月报月份输入从硬编码暗色改为亮色表单变量。
6. 托管应用仅改写传输中的 HTML；不修改用户包、运行数据或沙箱权限。

## 验证范围

| 分类 | HTML 页数 |
| --- | ---: |
| 原生工具及辅助页面 | 24 |
| 内置工具源码（含导航子页） | 45 |
| 本机运行时工具（只读检查，含导航子页） | 54 |
| Python 应用当前 static HTML | 10 |
| 合计 | 133 |

- CSS 清单检查读取实际 HTML 和本地 CSS，执行生产主题注入；逐页比较平台/系统切换前后的页面背景、文字、所有表单及按钮控件的背景、文字及 color-scheme。123 页固定亮色、10 页固定暗色（内置源码与运行时副本分别计数）。
- CSS 清单检查移除业务脚本、阻断远端资源，不调用业务接口、不导入或保存数据。UIVF12 的亮色 bootstrap class 单独模拟。下载用浏览器扩展模板、历史包与 app.old 不算工具导航页。
- 独立 Electron 运行测试覆盖亮色、暗色、Python 亮色沙箱及暗色沙箱四种情形：真实运行时、页面延迟主题脚本、旧偏好、storage 事件、系统切换、动态 CSS/文本修改及原生控件；托管页面仍为 opaque origin。
- 上述验证不代表逐个工具的完整业务流程或所有图表数据均已端到端测试。

已运行：

```bash
npm run doctor --prefix backend
node --test tests/tool-theme-policy.test.js tests/asset-versioning.test.js tests/uivf12-floating-theme.test.js tests/navbar-settings-split.test.js tests/hosted-apps.test.js
node_modules/.bin/electron tests/tool-fixed-theme-browser.cjs
node_modules/.bin/electron scripts/audit-tool-themes.cjs
```

Doctor 通过；相关 Node 测试 33 项通过；四类 Electron 运行验证通过；133 页 CSS 清单检查全部通过。改动的 JavaScript/CJS 文件也已运行 `node --check`。

## 页面清单

控件包含 input（不含 type=hidden）、textarea、select、button；不读取输入值。

| 页面 | 标题 | 固定主题 | 控件数 | 主题检查 |
| --- | --- | --- | ---: | --- |
| `frontend/pages/ai-report.html` | AI 月报 - Dragon Claw | 亮色 | 13 | 通过 |
| `frontend/pages/bigscreen.html` | 埃及维护运营质量看板 - Dragon Claw | 暗色 | 28 | 通过 |
| `frontend/pages/cinema.html` | 🎬 Tools Cinema - 光影点播大厅 | 亮色 | 42 | 通过 |
| `frontend/pages/custom-tool.html` | 自定义工具 - Dragon Claw | 亮色 | 9 | 通过 |
| `frontend/pages/db-explorer.html` | 数据探索 - DB Explorer | 亮色 | 50 | 通过 |
| `frontend/pages/desktop-license-activation.html` | Dragon Claw - 软件授权激活 | 亮色 | 16 | 通过 |
| `frontend/pages/desktop-license-admin.html` | 桌面端 License 签发与管理 | 暗色 | 26 | 通过 |
| `frontend/pages/duty-roster.html` | 夜间运维值班表编辑器 - Dragon Claw | 亮色 | 11 | 通过 |
| `frontend/pages/expedite.html` | 一键催办 - Dragon Claw | 亮色 | 33 | 通过 |
| `frontend/pages/frt.html` | FRT 自动化核算平台 V15 (动态规则引擎版) | 亮色 | 11 | 通过 |
| `frontend/pages/monthly.html` | 埃及维护运营月度报告 - Dragon Claw | 亮色 | 48 | 通过 |
| `frontend/pages/netcare-explorer.html` | NetCare 数据探查 - Dragon Claw | 亮色 | 0 | 通过 |
| `frontend/pages/praudit.html` | PR进展附件记录 - 审计级批量自检系统 | 亮色 | 47 | 通过 |
| `frontend/pages/privacy.html` | Privacy Policy - Dragon Claw | 暗色 | 0 | 通过 |
| `frontend/pages/project-evolution.html` | 项目演进 · 银河之旅 | 暗色 | 2 | 通过 |
| `frontend/pages/python-updater.html` | 正在跳转 - Python 脚本更新器 | 亮色 | 0 | 通过 |
| `frontend/pages/report.html` | 专业报表看板 - Dragon Claw | 亮色 | 32 | 通过 |
| `frontend/pages/requirements.html` | 需求管理 - Dragon Claw | 亮色 | 13 | 通过 |
| `frontend/pages/sla.html` | Task SLA 风险监控台 - Dragon Claw | 亮色 | 59 | 通过 |
| `frontend/pages/storage.html` | 存储迁移状态 - Dragon Claw | 暗色 | 2 | 通过 |
| `frontend/pages/terms.html` | Terms of Service - Dragon Claw | 暗色 | 0 | 通过 |
| `frontend/pages/topic-analysis.html` | 专题分析 | 亮色 | 48 | 通过 |
| `frontend/pages/uivf12.html` | UIVF12 抓取引擎 v6.6 - Dragon Claw | 亮色 | 97 | 通过 |
| `frontend/pages/uivision-runner-local.html` | UIVF12 Direct Runner | 亮色 | 1 | 通过 |
| `builtin-tools/acceptance-checklist/index.html` | 在线验收表 / Acceptance Checklist | 亮色 | 13 | 通过 |
| `builtin-tools/chat-history-center/index.html` | 聊天记录中心 | 亮色 | 99 | 通过 |
| `builtin-tools/datacom-protocol-expert/index.html` | 数通协议专家 | 亮色 | 6 | 通过 |
| `builtin-tools/department-reward-penalty/index.html` | 负向事件管理 | 亮色 | 145 | 通过 |
| `builtin-tools/eos_tool-v8/index.html` | 重急EOS收编工具  /  Urgent EOS Dashboard | 亮色 | 29 | 通过 |
| `builtin-tools/esn-check/index.html` | 临时 License 统计与月报 | 亮色 | 86 | 通过 |
| `builtin-tools/f12-to-extension/index.html` | F12 脚本扩展打包器 (F12 to Extension) | 亮色 | 36 | 通过 |
| `builtin-tools/hostedapptestkit/index.html` | HostedAppTestKit | 亮色 | 0 | 通过 |
| `builtin-tools/network_safety_meeting_summary/index.html` | 华子胶片设计 | 亮色 | 191 | 通过 |
| `builtin-tools/network_safety_meeting_summary/reference/network_safety_oath_huawei_template_pack.html` | Network Safety Oath - Huawei Style Template Pack | 亮色 | 0 | 通过 |
| `builtin-tools/nis_2026h1_summary/index.html` | 北部非洲NIS 2026年H1经营总结 | 亮色 | 0 | 通过 |
| `builtin-tools/optical-transfer/index.html` | Decimen Optical Transfer — transfer files with light | 亮色 | 5 | 通过 |
| `builtin-tools/optical-transfer/receive/index.html` | Decimen Optical Transfer — receive | 亮色 | 7 | 通过 |
| `builtin-tools/optical-transfer/send/index.html` | Decimen Optical Transfer — send | 亮色 | 16 | 通过 |
| `builtin-tools/particle-effects/index.html` | 粒子特效 | 暗色 | 35 | 通过 |
| `builtin-tools/picture-island/index.html` | 图屿 · Picture Island | 亮色 | 91 | 通过 |
| `builtin-tools/pr/index.html` | PR透视 · 整改流程审计 | 亮色 | 65 | 通过 |
| `builtin-tools/pr-2/index.html` | 84转业务外包PR/PO下单及跟进流程交接说明 | 亮色 | 3 | 通过 |
| `builtin-tools/python-updater/index.html` | Python 脚本更新器 (Python Script Hot-Updater) | 亮色 | 19 | 通过 |
| `builtin-tools/question-bank-assistant-privacy/index.html` | Privacy Policy · Tools Platform Extensions (Question Bank & NetCare Audit) | 亮色 | 4 | 通过 |
| `builtin-tools/question-bank-study/index.html` | 题库学习与 Excel 转换 | 亮色 | 9 | 通过 |
| `builtin-tools/reward-program/index.html` | 奖励申报与评优 | 亮色 | 6 | 通过 |
| `builtin-tools/supplier-quotation-comparison/index.html` | 供应商报价比价 | 亮色 | 16 | 通过 |
| `builtin-tools/tool-dining-card-wechat/index.html` | 营业流水刷卡与微信就餐统计工具 | 亮色 | 54 | 通过 |
| `builtin-tools/tool-mqp55fna/index.html` | 六个一信息收集 | 亮色 | 42 | 通过 |
| `builtin-tools/tool-mqtlwcrv/index.html` | 3MS 爬虫脚本维护与生成工具 | 亮色 | 9 | 通过 |
| `builtin-tools/tool-mr0vvmyi/index.html` | Unified Customer Activity Upload Guide | 亮色 | 8 | 通过 |
| `builtin-tools/tool-mr87218d/index.html` | 膳食秘书工作手册 - 餐厅全景 | 亮色 | 289 | 通过 |
| `builtin-tools/tool-mr88gv9x/index.html` | CS质量运营工具平台介绍 | 亮色 | 3 | 通过 |
| `builtin-tools/tool-mrhqjeya/index.html` | Executive Horizon - 旗舰版行政日程指挥中心 | 亮色 | 48 | 通过 |
| `builtin-tools/tool-mrlpwjk3/index.html` | 欠款分析工具 (Top Debtors Analysis) - 终极完美版 | 亮色 | 7 | 通过 |
| `builtin-tools/tool-mro1gt5o/index.html` | 营业流水刷卡统计工具 | 亮色 | 27 | 通过 |
| `builtin-tools/tool-mrrgpqy4/index.html` | 人数计数器 | 亮色 | 4 | 通过 |
| `builtin-tools/tool-mrrn48dc/index.html` | 去土耳其海边旅游倒计时 | 亮色 | 0 | 通过 |
| `builtin-tools/tool-mrsw86w8/index.html` | 网络安全与质量管理事项通知 | 亮色 | 13 | 通过 |
| `builtin-tools/tool-ms1saxuh/index.html` | SV满意度评分分析器 V8 | 亮色 | 13 | 通过 |
| `builtin-tools/tool-ms4xb66s/index.html` | 埃及代表处夜间操作激励统计工具 | 亮色 | 125 | 通过 |
| `builtin-tools/tool-msbmscxd/index.html` | PC 三方软件全景分析 | 亮色 | 52 | 通过 |
| `builtin-tools/tool-msbmu55i/index.html` | iDesk Third-Party Tools Action Plan | 亮色 | 25 | 通过 |
| `builtin-tools/tool-msf5b7nn/index.html` | 会议出席统计工具 | 亮色 | 72 | 通过 |
| `builtin-tools/tool-msh8aro4/index.html` | Tools Platform · 功能全景 / Capability Overview | 暗色 | 7 | 通过 |
| `builtin-tools/tool-mtakhxqm/index.html` | 阿拉伯语/埃及口语 沉浸式互动学习 | 亮色 | 49 | 通过 |
| `builtin-tools/tool-mtpx4vtr/index.html` | 餐饮下单数据智能核对平台 - 完整规则版 | 亮色 | 23 | 通过 |
| `builtin-tools/tool-mumxi3px/index.html` | 强控业务比对产品查询系统 | 亮色 | 7 | 通过 |
| `builtin-tools/tool-mv9strpn/index.html` | 译维Ezscan 仓储管理系统 · 服务器存储版 | 亮色 | 6 | 通过 |
| `data/custom-tools/acceptance-checklist/index.html` | 在线验收表 / Acceptance Checklist | 亮色 | 13 | 通过 |
| `data/custom-tools/aiops-report/index.html` | AiOps-Report | 亮色 | 0 | 通过 |
| `data/custom-tools/aiops-risk/index.html` | AiOps-Risk | 亮色 | 0 | 通过 |
| `data/custom-tools/chat-history-center/index.html` | 聊天记录中心 | 亮色 | 99 | 通过 |
| `data/custom-tools/datacom-protocol-expert/index.html` | 数通协议专家 | 亮色 | 6 | 通过 |
| `data/custom-tools/department-reward-penalty/index.html` | 负向事件管理 | 亮色 | 145 | 通过 |
| `data/custom-tools/eos_tool-v8/index.html` | 重急EOS收编工具  /  Urgent EOS Dashboard | 亮色 | 29 | 通过 |
| `data/custom-tools/esn-check/index.html` | 临时 License 统计与月报 | 亮色 | 86 | 通过 |
| `data/custom-tools/f12-to-extension/index.html` | F12 脚本扩展打包器 (F12 to Extension) | 亮色 | 36 | 通过 |
| `data/custom-tools/hostedapptestkit/index.html` | HostedAppTestKit | 亮色 | 0 | 通过 |
| `data/custom-tools/mayrig/index.html` | Mayrig 亚美尼亚菜单 | 亮色 | 0 | 通过 |
| `data/custom-tools/network_safety_meeting_summary/index.html` | 华子胶片设计 | 亮色 | 191 | 通过 |
| `data/custom-tools/network_safety_meeting_summary/reference/network_safety_oath_huawei_template_pack.html` | Network Safety Oath - Huawei Style Template Pack | 亮色 | 0 | 通过 |
| `data/custom-tools/nis_2026h1_summary/index.html` | 北部非洲NIS 2026年H1经营总结 | 亮色 | 0 | 通过 |
| `data/custom-tools/optical-transfer/index.html` | Decimen Optical Transfer — transfer files with light | 亮色 | 5 | 通过 |
| `data/custom-tools/optical-transfer/receive/index.html` | Decimen Optical Transfer — receive | 亮色 | 7 | 通过 |
| `data/custom-tools/optical-transfer/send/index.html` | Decimen Optical Transfer — send | 亮色 | 16 | 通过 |
| `data/custom-tools/parkst/index.html` | Park Street 早午餐菜单 | 亮色 | 0 | 通过 |
| `data/custom-tools/particle-effects/index.html` | 粒子特效 | 暗色 | 35 | 通过 |
| `data/custom-tools/picture-island/index.html` | 图屿 · Picture Island | 亮色 | 91 | 通过 |
| `data/custom-tools/pr/index.html` | PR透视 · 整改流程审计 | 亮色 | 65 | 通过 |
| `data/custom-tools/pr-2/index.html` | 84转业务外包PR/PO下单及跟进流程交接说明 | 亮色 | 3 | 通过 |
| `data/custom-tools/python-updater/index.html` | Python 脚本更新器 (Python Script Hot-Updater) | 亮色 | 19 | 通过 |
| `data/custom-tools/question-bank-assistant-privacy/index.html` | Privacy Policy · Tools Platform Extensions (Question Bank & NetCare Audit) | 亮色 | 4 | 通过 |
| `data/custom-tools/question-bank-study/index.html` | 题库学习与 Excel 转换 | 亮色 | 9 | 通过 |
| `data/custom-tools/reward-program/index.html` | 奖励申报与评优 | 亮色 | 6 | 通过 |
| `data/custom-tools/supplier-quotation-comparison/index.html` | 供应商报价比价 | 亮色 | 16 | 通过 |
| `data/custom-tools/tool-dining-card-wechat/index.html` | 营业流水刷卡与微信就餐统计工具 | 亮色 | 54 | 通过 |
| `data/custom-tools/tool-mqp55fna/index.html` | 六个一信息收集 | 亮色 | 42 | 通过 |
| `data/custom-tools/tool-mqtlwcrv/index.html` | 3MS 爬虫脚本维护与生成工具 | 亮色 | 9 | 通过 |
| `data/custom-tools/tool-mr0vvmyi/index.html` | Unified Customer Activity Upload Guide | 亮色 | 8 | 通过 |
| `data/custom-tools/tool-mr87218d/index.html` | 膳食秘书工作手册 - 餐厅全景 | 亮色 | 289 | 通过 |
| `data/custom-tools/tool-mr88gv9x/index.html` | CS质量运营工具平台介绍 | 亮色 | 3 | 通过 |
| `data/custom-tools/tool-mrhqjeya/index.html` | Executive Horizon - 旗舰版行政日程指挥中心 | 亮色 | 48 | 通过 |
| `data/custom-tools/tool-mrlpwjk3/index.html` | 欠款分析工具 (Top Debtors Analysis) - 终极完美版 | 亮色 | 7 | 通过 |
| `data/custom-tools/tool-mro1gt5o/index.html` | 营业流水刷卡统计工具 | 亮色 | 27 | 通过 |
| `data/custom-tools/tool-mrrgpqy4/index.html` | 人数计数器 | 亮色 | 4 | 通过 |
| `data/custom-tools/tool-mrrn48dc/index.html` | 去土耳其海边旅游倒计时 | 亮色 | 0 | 通过 |
| `data/custom-tools/tool-mrsw86w8/index.html` | 网络安全与质量管理事项通知 | 亮色 | 13 | 通过 |
| `data/custom-tools/tool-ms1saxuh/index.html` | SV满意度评分分析器 V8 | 亮色 | 13 | 通过 |
| `data/custom-tools/tool-ms4xb66s/index.html` | 埃及代表处夜间操作激励统计工具 | 亮色 | 125 | 通过 |
| `data/custom-tools/tool-msbmscxd/index.html` | PC 三方软件全景分析 | 亮色 | 52 | 通过 |
| `data/custom-tools/tool-msbmu55i/index.html` | iDesk Third-Party Tools Action Plan | 亮色 | 25 | 通过 |
| `data/custom-tools/tool-msf5b7nn/index.html` | 会议出席统计工具 | 亮色 | 72 | 通过 |
| `data/custom-tools/tool-msh8aro4/index.html` | Tools Platform · 功能全景 / Capability Overview | 暗色 | 7 | 通过 |
| `data/custom-tools/tool-msqfmv82/index.html` | PDF 全能工具箱 - 白底拼接版 | 亮色 | 29 | 通过 |
| `data/custom-tools/tool-msqfplq0/index.html` | PDF 编辑器 Pro Ultra (增强版) | 亮色 | 35 | 通过 |
| `data/custom-tools/tool-mtakhxqm/index.html` | 阿拉伯语/埃及口语 沉浸式互动学习 | 亮色 | 49 | 通过 |
| `data/custom-tools/tool-mtpx4vtr/index.html` | 餐饮下单数据智能核对平台 - 完整规则版 | 亮色 | 23 | 通过 |
| `data/custom-tools/tool-mttuw8kn/index.html` | 埃及行政 PMO 综合管控台 | 亮色 | 53 | 通过 |
| `data/custom-tools/tool-mu2t8i0i/index.html` | 薪资换汇盈亏计算器 (USD ⇌ EGP ⇌ CNY) | 亮色 | 5 | 通过 |
| `data/custom-tools/tool-mu2t8wi3/index.html` | 微信账单就餐人数统计工具（分文件详表） | 亮色 | 2 | 通过 |
| `data/custom-tools/tool-mumxi3px/index.html` | 强控业务比对产品查询系统 | 亮色 | 7 | 通过 |
| `data/custom-tools/tool-mv9strpn/index.html` | 译维Ezscan 仓储管理系统 · 服务器存储版 | 亮色 | 6 | 通过 |
| `hosted-apps/aiops-report/static/dev.html` | AiOps-Report · 运营数据工作台 | 亮色 | 53 | 通过 |
| `hosted-apps/aiops-report/static/index.html` | AI 月报 · AiOps-Report | 亮色 | 29 | 通过 |
| `hosted-apps/aiops-risk/static/detail.html` | AiOps-Risk 风险管理详单 | 亮色 | 15 | 通过 |
| `hosted-apps/aiops-risk/static/index.html` | AiOps-Risk 风险管理看板 | 亮色 | 41 | 通过 |
| `hosted-apps/aiops-risk/static/log.html` | 风险处置日志 | 亮色 | 0 | 通过 |
| `hosted-apps/aiops-risk/static/mini.html` | 风险管理看板 · 小页面 | 亮色 | 0 | 通过 |
| `hosted-apps/aiops-risk/static/test-embed.html` | 嵌入测试 | 亮色 | 0 | 通过 |
| `hosted-apps/aiops-risk/static/test-mini-size.html` | 小页面尺寸测试 | 亮色 | 0 | 通过 |
| `hosted-apps/hostedapptestkit/static/index.html` | 托管应用自检台 | 亮色 | 52 | 通过 |
| `hosted-apps/hostedapptestkit/static/pages/about.html` | 第二个页面 · 托管应用自检台 | 亮色 | 2 | 通过 |
