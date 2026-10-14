# macOS 桌面构建与验收

macOS 版本使用与 Windows Setup/Portable 相同的 Electron 入口、内置服务、授权、菜单栏/托盘和桌宠代码。DMG 内的 `.app` 拖到 Applications 后运行，无需另装 Node.js。应用自己的 License 激活仍然保留；Apple 签名不替代产品授权。

## 先本地，再接 GitHub Actions

1. 在 Mac 上安装依赖、检查 Developer ID Application 签名身份。
2. 构建当前架构，在独立输出目录检查签名、包内容、原生依赖和运行行为。
3. 配置 Apple 公证，验证公证与 Gatekeeper。
4. 实际验收桌宠、菜单栏、授权、数据持久化与退出后，再扩展仓库根目录 `.github/workflows/build.yml`。当前工作流仍只发布 Windows。

```bash
security find-identity -v -p codesigning
npm run build:mac:local
```

本地命令默认构建本机架构，输出到 `dist/mac-local-<UTC时间>/`，保留旧产物。可用 `-- --arm64` 或 `-- --x64` 指定架构。签名是必需的；缺少公证凭据时只生成本地测试包，不能作为正式分发验收通过的包。两种架构均需各自验证原生模块，Apple Silicon 上通过不代表 Intel 已通过。

## Apple 公证

需要 Developer ID Application 证书及其私钥；`.cer` 只有公开证书。已导入钥匙串的签名身份可直接用于本地打包，CI 使用加密的 P12 导出文件。

推荐使用钥匙串保存公证认证。在自己的终端交互输入 Apple ID、Team ID 和 App 专用密码，不把密码粘贴进聊天、代码或命令行参数：

```bash
xcrun notarytool store-credentials tools-platform-notary
xcrun notarytool history --keychain-profile tools-platform-notary
APPLE_KEYCHAIN_PROFILE=tools-platform-notary npm run build:mac:local
```

正式双架构构建：

```bash
APPLE_KEYCHAIN_PROFILE=tools-platform-notary npm run build:mac
```

正式命令在没有公证配置时会失败；本地命令有配置时也会执行公证。builder 使用 hardened runtime、Developer ID 签名和 `notarytool`，公证后为 `.app` 附加票据，再生成 DMG 与 ZIP。ZIP 是 `electron-updater` 的 macOS 更新载荷，不能只发布 DMG。

对实际路径检查：

```bash
codesign --verify --deep --strict --verbose=2 'dist/<构建目录>/mac-arm64/Dragon Platform.app'
spctl --assess --type execute --verbose=2 'dist/<构建目录>/mac-arm64/Dragon Platform.app'
xcrun stapler validate 'dist/<构建目录>/mac-arm64/Dragon Platform.app'
hdiutil verify 'dist/<构建目录>/Dragon-Platform-<版本>-arm64.dmg'
```

本地未公证包的 `spctl` / `stapler` 不能通过，不能关闭 Gatekeeper 来冒充正式验收。下载后首次打开的系统确认提示可能仍出现。若另外给 DMG 提交公证并附加票据，应在生成/发布更新元数据前完成，避免改变哈希。

## 必测行为

- DMG 挂载、拖入 Applications、首次 License 激活、主页面启动。
- 菜单栏图标与菜单、打开浏览器、日志、桌宠设置、完全退出；关闭窗口后菜单栏仍可使用。
- 桌宠显示/隐藏、拖动、缩放、动画、声音、聊天；深浅色主题、窄屏、多显示器与 Spaces。
- 全局打字反馈需要用户在系统设置授予辅助功能权限。拒绝时桌宠其他功能应继续可用；授权后切换打字开关或隐藏/唤回桌宠重试。
- 数据写入 `~/Library/Application Support/tools-platform/`，不写入只读 DMG 或 `.app`。重新启动后配置和数据保留。
- 首次无 Mac Release 时检查更新可能报无更新元数据；远端发布 DMG、ZIP、`latest-mac.yml` 后，使用下一版本实际验证下载、重启安装。

构建会排除本机数据库、用户工具运行状态、备份、归档、日志、临时目录、凭据和本地视频，保留 `backend/builtin-tools/`、`backend/defaults/`、桌宠及离线安装资源。构建只排除文件，不删除源数据。

## 后续 Actions 接入

沿用现有 `prepare-release` 产生的同一个 Tag，在 macOS runner 构建，与 Windows job 并行。用 GitHub Secrets 注入 `CSC_LINK` / `CSC_KEY_PASSWORD` 和 Apple 公证凭据，或将公证认证存入 runner 临时钥匙串。不得上传 P12、私钥或密码作为构建产物。

发布同一 Release 的 Windows Setup、Portable，以及 macOS 两种架构的 DMG、ZIP、blockmap 和 `latest-mac.yml`。若分架构 job，需合并更新元数据，避免两个 job 互相覆盖 `latest-mac.yml`；单个 Mac job 构建双架构可由 builder 合并。CI 发布前强制签名、公证及包内容检查通过。

参考：[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、[Apple 命令行公证](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)、[electron-updater 的 ZIP 要求](https://www.electron.build/v26/docs/features/auto-update/)。实际配置以项目锁定的 electron-builder 24.13.3 为准。
