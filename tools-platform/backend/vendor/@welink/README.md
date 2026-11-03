# 内置 welink-cli（@welink/welink-cli 1.0.16）

首页左下角「扫码使用 → WeLink 个人身份」和频道设置里的 welink-cli 优先使用这里的官方包，用户无需再 `npm install -g`。

- 仅 Windows：`welink-cli.exe` 由华为签名，需本机运行并登录 WeLink PC。其他系统会提示「仅支持 Windows」；mac 安装包不打入 exe。
- 仅内网：CLI 访问 `open.inner.welink.huawei.com`，外网时后端拒绝扫码登录并提示连接内网（见 [welink-network.js](../../models/channels/welink-network.js)）。
- 原包的 `scripts/install.js` / `uninstall.js` 会改写用户 PATH，内置时不需要，已去掉；`package.json` 保持原样。
- 升级：用新版官方包覆盖 `welink-cli/` 目录（同样去掉这两个脚本），并更新本文件中的版本号。
