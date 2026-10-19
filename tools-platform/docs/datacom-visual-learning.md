# 数通协议专家：可视化教学改版

## 实现范围

保留原生多页应用与租户 SQLite 架构。主入口改用 HTML/SVG 二维教学视图，默认暂停，按“条件 → 步骤 → 观察结果”组织内容。原 3D 源文件保留兼容，但不再进入主应用模块依赖图，单文件快照不需要加载 Three.js。

| 主题 | 新视图与交互 |
| --- | --- |
| OSPF 报文 | 按真实 bit 宽度排列；5 种报文、3 种认证；字段详情与跨行偏移 |
| 邻居状态机 | 双端时序与状态对照；正常建邻、DROther、MTU 检查失败 |
| 区域与 LSA | 通告处理边界；6 类 LSA 与 5 种目标区域 |
| FA | 分离通告来源与转发目标；零、非零可达、非零不可达 |
| DR / BDR | 完整邻接、SPF 伪节点与假设全互联三个视角 |
| NSSA | 逐项解释 P、FA 与翻译资格；非法假设不绘成正常收敛 |
| CSPF | 带宽/管理组剪枝、最短路成本、SRLG 分离备份、无解状态 |
| 震荡 | 链路事件与选路并列时间轴；区分节流与路径避让 |
| 过滤 | 8 个位置；逐设备比较 LSDB 和 RIB |
| Junos / VRP 策略 | 匹配、修改与终止分支；已接受的路由不继续通过后续节点 |
| VRF | 跨 PE 分发与下一跳解析；本地 instance-import、rib-groups、RT 策略 |
| 5 个计算实验室 | 学习顺序、计算中间态、轴/单位、结果对照与输入验证 |
| RFC ASCII 图 | 自动转二维位图；窄字段编号、完整字段解释、原文保留 |
| 37 张 Mermaid 图 | 统一主题、折线与留白；缩放、横向滚动；逐文章渲染验证 |
| 知识星图 | 领域/主题筛选、全文元数据检索、全部文章、独立学习路径、一跳入向/出向关联 |

主模块：`assets/teaching-stage.js`（播放器）、`diagram-kit.js`（图元）、`ospf-lessons.js`、`junos-lessons.js`、`packet-lesson.js`、`knowledge-map.js`。

## 文案与内容边界

- 种子版本 2 → 3：重新编写 28 篇内置摘要，修正部分核心要点，增加逐篇阅读提示。
- 原笔记 Markdown 正文不改写；提示与正文分别显示。正文中的历史实验结论仍须结合设备、版本和配置解释。
- 沿用现有种子升级机制：更新未人工编辑的种子文章；人工编辑、删除记录与用户文章保留。未直接操作运行数据库、备份或用户工具目录。
- 避免把 FA、DR、NSSA 翻译、vrf-import 匹配、校验和检错等有前提的行为表述为无条件保证。
- 教学拓扑、计时与链路参数是机制示例，不是设备模拟器或实测性能数据。
- 英文切换覆盖新增教学界面控件和主要标题，原笔记与部分教学说明保留中文；语言切换不改变计算和图形状态。

主要核对资料：

- [RFC 2328](https://www.rfc-editor.org/rfc/rfc2328.html)：OSPFv2 状态、字段、作用域、FA、新旧仲裁。
- [RFC 3101](https://www.rfc-editor.org/rfc/rfc3101.html)：NSSA 生成、翻译与翻译者条件。
- [RFC 3630](https://www.rfc-editor.org/rfc/rfc3630.html)、[RFC 3209](https://www.rfc-editor.org/rfc/rfc3209.html)：TE 属性与 RSVP-TE。
- [RFC 5709](https://www.rfc-editor.org/rfc/rfc5709.html)：OSPFv2 HMAC-SHA 认证。
- [RFC 8665](https://www.rfc-editor.org/rfc/rfc8665.html)：SR Prefix-SID 传播与 Mapping Server 的作用域例外。
- [Junos 策略动作](https://www.juniper.net/documentation/us/en/software/junos/routing-policy/topics/concept/policy-configuring-actions-in-routing-policy-terms.html)、[默认策略](https://www.juniper.net/documentation/us/en/software/junos/routing-policy/topics/concept/policy-routing-policies-actions-defaults.html)、[VPN 路由分发](https://www.juniper.net/documentation/us/en/software/junos/vpn-l3/topics/topic-map/l3-vpns-distributing-routes.html)：控制流、挂载点及导入条件。

## 兼容与更新

保持场景 ID、文章关联与 `getContext / restore / select / dispose` 接口。AI 提问使用当前教学步骤、参数和节点详情。旧笔记恢复可识别的参数与进度；旧 3D 专属部件 ID 没有二维对应项时不会强行选择节点。

改动位于版本控制的 `backend/builtin-tools/datacom-protocol-expert/`。已有安装通过平台的内置工具更新流程应用；启动不会无条件覆盖运行目录的自定义改动。已发布的 Pages 或单文件快照需重新生成后才包含新版。此次没有更新运行工具目录、发布站点或进行 Electron 打包。

## 验证

运行：

```sh
cd backend && npm run doctor
# 以下在 tools-platform 根目录
node --test tests/datacom-teaching.test.js tests/datacom-knowledge-frontend.test.js tests/datacom-knowledge.test.js tests/datacom-knowledge-snapshot.test.js tests/asset-versioning.test.js
node --test tests/custom-tool-i18n.test.js tests/builtin-tools-update.test.js tests/datacom-knowledge-ai.test.js
node_modules/.bin/electron tests/datacom-teaching-browser.cjs
node_modules/.bin/electron tests/datacom-knowledge-snapshot-browser.cjs
```

45 个定向 Node 测试通过。14 个本次改动或新增的前端模块通过 `node --check`，`git diff --check` 通过。

浏览器验证使用临时数据：11 个场景的全部选项与步骤、播放/暂停、进度恢复、5 个实验室、非法前缀、星图与学习路径、全部正文 Mermaid、RFC 位图、深浅主题、390px 窄屏、英文控件和本地模拟的 AI 引用上下文。Pages 与 file:// 单文件快照均验证无业务 API 请求，单文件无 HTTP 请求。

未验证：真实网络设备行为、已发布远端站点、实际 AI 服务生成结果以及完整 Electron 安装包。测试未向 AI 服务提交提问。
