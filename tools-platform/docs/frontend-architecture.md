# 前端入口与共享能力

首页只有一套实现：`frontend/index.html`。根元素用 `.platform-home` 限定首页样式；不再读取 `ui=v1/v2`、`tools_home_ui` 或 `data-ui` 来选择首页。`v2-*` 类名、DOM ID 和 CSS 变量是现有组件的标识，不代表还支持第二套布局。

## 当前首页

- `js/home/home-shell.js` / `css/home-shell.css`：侧栏、账号菜单、搜索、主题与入口。
- `js/home/home-tools.js` / `css/home-tools.css`：工具导入、市场、工具卡片、友情链接和 API 中转。
- `js/home/home-mode.js`：对话与工具中心的协调、侧栏宽度。
- `js/home/skill-hub.js`：技能、插件、工具中心。
- `js/home/tool-frame.js`：首页内嵌工具容器。
- `js/shared/tool-navigation.js`：内嵌链接与独立窗口 URL；自定义工具独立窗口使用 `/custom-tools/<slug>/index.html`，由服务端执行其访问策略。

首页保留的 `toolsGrid` 是当前工具目录的数据来源，供 workspace 和工具中心复用，不是可切回的旧首页。

## 平台共享脚本

平台页面按以下顺序加载普通脚本，共享全局状态；最后一个模块负责启动。禁止新增旧导航栏或隐藏 DOM 作为状态载体。

1. `platform-core.js`：工具目录、分类、账号/租户上下文、语言、品牌与公共状态。
2. `platform-dialogs.js`：统一确认与表单对话框。
3. `platform-settings-controller.js`：设置窗口、页签分派、备份/推送控制；首次打开设置时加载 `platform-settings.js`，专项设置继续按需加载。
4. `platform-alerts.js`：告警查询、操作与轮询。
5. `platform-services.js`：健康检查、服务历史和诊断。
6. `platform-tool-updates.js`：内置工具比对与更新。
7. `platform-runtime.js`：页面初始化、版本、会话同步和运行时组件启动。

`window.ToolsPlatform.status()` 返回告警未读数、服务在线状态和版本；`tools:platform-status` 通知首页更新。`ToolsPlatform.catalog()` 返回当前工具目录；`tools:catalog-change` 通知目录变化。账号变动继续使用 `tools:authchange`。

首页动作直接调用 `HomeTools.openImport()`、`HomeTools.openMarket()`、`DragonClaw.newChat()` 和 `openBuiltinToolsComparison()`。不要恢复隐藏旧按钮再模拟点击的桥接实现。

`navState`、`navT`、`openNavSettingsModal` 等名称仍是设置/工具目录的共享接口，与 `/api/nav-settings` 及现有调用方一致，不包含顶部导航渲染器。旧文件 `navbar.js`、`navbar-settings.js`、`home-page.js`、`home-v2.js` 及对应旧首页样式入口均已删除，不提供兼容副本。

## 验证

`tests/platform-architecture.test.js` 守住唯一入口、模块顺序及共享状态事件；`tests/home-tools-hub-browser.cjs` 验证真实 Electron 渲染、工具中心、主题、语言和窄屏。历史方案文档只解释当时的改造背景，当前实现以本文和代码为准。
