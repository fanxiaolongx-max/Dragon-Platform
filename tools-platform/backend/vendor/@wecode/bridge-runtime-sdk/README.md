# 平台内置 WeLink SDK（@wecode/bridge-runtime-sdk）

「全局设置 › 频道对接」优先使用这里的 SDK，不需要另外安装 welink-cli。

## 放置方式

把 SDK 包原样复制到本目录，结构如下：

```
backend/vendor/@wecode/bridge-runtime-sdk/
├── package.json        # name 必须为 @wecode/bridge-runtime-sdk
└── dist/
    ├── index.js        # SDK 本体（单文件、无外部依赖，约 468 KB）
    └── index.d.ts      # 类型声明
```

来源：welink-cli 安装目录或 Bot 工程的 `node_modules/@wecode/bridge-runtime-sdk/`（当前对接版本 1.0.7）。

## 说明

- SDK 是纯 JS 的 ESM 包，支持 Node.js ≥ 18；桌面版 Electron 28 / Node 18 缺少全局 WebSocket，平台会在加载 SDK 前通过运行依赖 `ws` 补齐。已有原生 WebSocket 时保留原实现。
- 桌面版打包时本目录通过 `asarUnpack` 解包到 `app.asar.unpacked`，运行时从真实文件加载。
- 升级 SDK：直接替换本目录文件，然后在频道对接页面点击「重新检测 SDK」。
- 加载顺序：配置的 SDK 路径 → 本目录 → 项目依赖 → npm 全局目录。
