# 内置工具文字对比度排查（2026-11-03）

范围：42 个版本控制内置工具的首屏，平台浅色和深色主题，共 84 个入口状态。使用隔离 Electron profile 和模拟 API，不读写运行数据。检查可见文字、输入值和占位文字的颜色、透明度及祖先底色。

本次修正 16 个工具：F12 与 Python 更新器补齐 Tailwind 主题规则并改善表面/边框/提示色；餐饮核对工具改善辅助文字和页签计数；安全会议工具改善按钮与状态文字；其他工具调整确认存在对比不足的辅助文字。

修改的工具：

- `acceptance-checklist`
- `department-reward-penalty`
- `esn-check`
- `f12-to-extension`
- `network_safety_meeting_summary`
- `nis_2026h1_summary`
- `picture-island`
- `python-updater`
- `tool-dining-card-wechat`
- `tool-mrlpwjk3`
- `tool-mro1gt5o`
- `tool-mrsw86w8`
- `tool-msf5b7nn`
- `tool-mtakhxqm`
- `tool-mtpx4vtr`
- `tool-mv9strpn`

验证：

- `node --check frontend/js/shared/desktop-window.js`
- `node --check tests/builtin-tools-contrast-browser.cjs`
- `node --test tests/asset-versioning.test.js`（10 项）
- `node_modules/.bin/electron tests/desktop-main-window-browser.cjs`
- `node_modules/.bin/electron tests/builtin-tools-contrast-browser.cjs`
- `AUDIT_ALL=1 node_modules/.bin/electron tests/builtin-tools-contrast-browser.cjs`（入口扫描）
- `VERIFY_SUPPORTING=1 AUDIT_SLUGS=<逗号分隔的辅助文字修正工具> node_modules/.bin/electron tests/builtin-tools-contrast-browser.cjs`

自动扫描报告中的 failures 是待核对项，不能直接等同于可访问性缺陷：渐变文字、渐变背景、禁用控件及工具自身的主题模式会影响计算。本次不声明所有页面所有状态均达到 WCAG。未覆盖真实业务数据、所有弹窗/子页/导出物、运行时用户自建工具及桌面安装包。

首屏扫描覆盖：

- `acceptance-checklist`
- `chat-history-center`
- `datacom-protocol-expert`
- `department-reward-penalty`
- `eos_tool-v8`
- `esn-check`
- `f12-to-extension`
- `hostedapptestkit`
- `network_safety_meeting_summary`
- `nis_2026h1_summary`
- `optical-transfer`
- `particle-effects`
- `picture-island`
- `pr`
- `pr-2`
- `python-updater`
- `question-bank-assistant-privacy`
- `question-bank-study`
- `reward-program`
- `supplier-quotation-comparison`
- `tool-dining-card-wechat`
- `tool-mqp55fna`
- `tool-mqtlwcrv`
- `tool-mr0vvmyi`
- `tool-mr87218d`
- `tool-mr88gv9x`
- `tool-mrhqjeya`
- `tool-mrlpwjk3`
- `tool-mro1gt5o`
- `tool-mrrgpqy4`
- `tool-mrrn48dc`
- `tool-mrsw86w8`
- `tool-ms1saxuh`
- `tool-ms4xb66s`
- `tool-msbmscxd`
- `tool-msbmu55i`
- `tool-msf5b7nn`
- `tool-msh8aro4`
- `tool-mtakhxqm`
- `tool-mtpx4vtr`
- `tool-mumxi3px`
- `tool-mv9strpn`
