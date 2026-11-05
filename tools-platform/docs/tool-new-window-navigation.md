# 工具导航规则与旧导航入口排查

2026-11-05 起统一两个模式，首页不再提供 v1 布局或“切回旧版”菜单。

| 使用方式 | 地址与行为 |
| --- | --- |
| 普通点击、全局搜索 | 新版首页 `/?app=<编码后的工具路径、query、hash>` 内嵌 |
| 新窗口按钮、window.open、target=_blank、修饰键、中键、右键新标签页 | 工具地址追加 `standalone=1`，没有首页侧栏、项目栏、旧平台导航、全局悬浮助手或平台待办提醒 |
| 直接访问旧工具地址、旧书签、业务脚本的 location 跳转 | 页面 head 中的共享运行时提前转入新版首页内嵌，保留 query 和 hash |
| 单独窗口中的工具自身操作 | 保存、编辑、导出、对话等业务控件继续保留；平台菜单与自定义工具外壳标题栏隐藏 |

`standalone=1` 在同源的自定义工具内部 iframe 中继承。内嵌入口会移除此标记，避免从纯净窗口返回后错误隐藏内嵌工具的上下文助手。该参数只控制布局，不改变登录、权限、租户或数据存取。

## 已核查的入口与修复

- `backend/server.js`：核心工具路由、HTML 别名和 `/tools/:slug`；月报旧别名重定向保留 query。
- `backend/models/asset-versioning.js`：HTML sender 与直接 HTML 访问共用导航运行时；主题豁免页面也注入导航，避免遗漏授权管理页。自定义工具运行时 HTML 继续复用该注入路径，不改写用户文件。
- `frontend/js/home/home-v2.js`：全局搜索原先直接 `location.href = app.href`，现优先调用内嵌容器；移除旧版切换入口。
- `frontend/js/home/tool-frame.js`：普通工具链接内嵌；“在新标签页打开”统一生成纯净地址。
- `frontend/js/shared/navbar.js`：旧导航链接与新窗口备用函数使用同一规则；公开隐私、条款页不显示旧导航。
- `frontend/js/shared/tool-navigation.js`：覆盖 `window.open`、新窗口链接、修饰键、中键和右键菜单；普通链接在右键后仍按原工具地址内嵌。
- `frontend/pages/ai-report.html` 的 `/monthly/legacy`、`frontend/js/sla/source-archive.js` 的 `/monthly` 等业务页普通链接由共享运行时处理，不再显示旧平台导航。

## 路由覆盖

数据抓取、SLA、报表、催办、AI 月报及历史固定版月报、值班表、大屏、专题分析、FRT、PR 审计、存储、数据探索、NetCare 探查、需求、影院、项目演进、Python 更新器、桌面授权管理，以及对应 `/pages/*.html` 别名；`/tools/<slug>`、`/apps/<slug>` 和所有内置/用户自定义工具入口。

`/custom-tools/<slug>/index.html` 新窗口先转为 `/tools/<slug>?standalone=1`，保留工具外壳的加载、权限和状态流程。仅去除资源缓存参数 `_t`，保留其他参数与锚点。附件、下载、外站、blob、页内锚点、UIVision 独立执行器不包装。

## 验证

- `node --test tests/tool-navigation.test.js tests/asset-versioning.test.js tests/navbar-settings-split.test.js`
- `HOME_TOOL_EXTERNAL_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs`：9 类工具内嵌与纯净窗口、直接旧地址迁移、无平台导航/侧栏/助手、query/hash 保留。
- `cd backend && npm run doctor`

修改工具路由时同步维护工具匹配规则。发布后需刷新整个中台页面，已有旧标签页也需刷新；仅刷新内层工具不会更新宿主脚本。
