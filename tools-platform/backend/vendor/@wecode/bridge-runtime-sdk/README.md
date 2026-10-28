# WeLink SDK 本地集成（@wecode/bridge-runtime-sdk）

本目录是「全局设置 → 频道对接 → WeLink」的内置 SDK 查找位置。**当前版本库仅保存本说明，不包含 SDK 的 `package.json` 或 `dist/` 文件**；是否可连接以页面检测结果为准。检测到可用 SDK 后，Bot 频道连接本身不需要另行调用 `welink-cli`。

当前查找、导入和连接行为以 [welink-sdk-loader.js](../../../models/channels/welink-sdk-loader.js)、[channels.js](../../../routes/channels.js) 及 [频道设置界面](../../../../frontend/js/shared/channel-settings.js) 为准，核对日期：2026-10-28。

## 放置方式

可从已有 `welink-cli` 安装目录或 Bot 工程的 `node_modules/@wecode/bridge-runtime-sdk/` 获取 SDK。管理员可以在频道设置中导入 `@wecode` / `bridge-runtime-sdk` 文件夹或单独选择 `dist/index.js`，也可以填写已有 SDK 路径。若需要随客户端分发，则把 SDK 包原样放入本目录，保留来源包的许可与版权文件：

```
backend/vendor/@wecode/bridge-runtime-sdk/
├── package.json        # name 必须为 @wecode/bridge-runtime-sdk
└── dist/
    ├── index.js        # SDK 的完整打包入口
    └── index.d.ts      # 类型声明（页面导入时可选）
```

页面导入要求入口导出 `createBridgeRuntime`；扫码授权还需要 SDK 提供 `qrcodeAuth.run`。版本号来自包信息或 SDK 自报值；仓库测试包含 1.0.7 的模拟包，不代表当前机器已经安装该版本。

## 加载顺序与运行边界

1. 配置的 SDK 路径（包目录、`node_modules` 目录或入口文件）。
2. 页面导入的 SDK：`<BASE_DATA_DIR>/channel-sdk/@wecode/bridge-runtime-sdk/`。
3. 本目录 `backend/vendor/@wecode/bridge-runtime-sdk/`。
4. 后端或项目根目录的 `node_modules`。
5. npm 全局目录及 `welink-cli` 的本机安装位置。

`BASE_DATA_DIR` 由平台的数据目录配置决定，默认是 `backend/data/`。导入文件是所有租户共用的本机运行依赖；WeLink 连接凭据、访问名单与会话配置仍按租户隔离。

SDK 通过动态 `import()` 加载。Electron 28 / Node 18 缺少全局 WebSocket 时，平台在加载前通过运行依赖 `ws` 补齐；已有原生 WebSocket 时保留原实现。完整 SDK 的 Node 版本要求以其 `package.json` 为准。桌面打包配置通过 `asarUnpack` 解包 `backend/vendor/**/*`，加载器优先使用 `app.asar.unpacked` 中的真实文件。

## 更新、移除与诊断

- 页面导入会先写入临时目录，实际加载并检查 `createBridgeRuntime` 后才替换已导入版本；JS 与可选类型文件合计上限为 15 MiB。校验失败时保留已导入版本。
- 更新 SDK 后点击「重新检测 SDK」。已建立的连接仍可能运行旧模块；页面提示版本变化时点击「重启连接」使当前连接使用新 SDK。
- 「移除已导入」只移除本机导入副本，后续检测回退到仍可用的其他查找位置。配置了有效自定义路径时，该路径仍优先。
- 页面显示实际来源、版本、缺失提示及连接状态。SDK 可加载不代表网关凭据有效或连接已建立。

WeLink Bot SDK 与以本人身份操作的 `welink-cli` 是两个入口；后者有单独的安装、登录、默认租户管理员和写操作审批要求。平台整体接入说明见 [项目 README](../../../../README.md#welink-sdk-频道对接手机上的运营助手)。

从项目根目录运行 SDK 检测、导入、WebSocket 兼容和频道行为的隔离测试：

```bash
node --test tests/welink-channel.test.js
```
