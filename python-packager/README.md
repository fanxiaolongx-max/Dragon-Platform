# Python 脚本通用热更新外壳架构 (Universal Shell & Hot Updater)

## 💡 设计理念与架构

传统的 Python 打包（如直接用 PyInstaller 针对业务脚本打包为单个 EXE），存在以下痛点：
1. **体积臃肿**：每次业务逻辑改动几行代码，用户都需要重新下载 50MB~100MB 的完整绿色包或安装包；
2. **分发缓慢**：对于网络受限或企业内网用户，频繁重新下载安装成本高；
3. **版本碎片化**：用户很难即时保持最新版本。

**本方案的核心架构创新：通用外壳 + 核心逻辑动态热更新**
- **通用外壳 (`universal_shell.py` / `PR报告抽查工具.exe`)**：
  - 内置 Python 解释器与常用依赖（Pandas、OpenPyXL、Requests）；
  - 提供轻量、现代的 GUI 操作界面；
  - 负责拉起交互式控制台运行核心业务脚本；
  - 提供「检查并在线热更新」功能，支持 GitHub 官方 Raw 源、国内加速镜像（ghproxy）、第三方自定义地址。
- **核心逻辑脚本 (`core_script.py`)**：
  - 纯 Python 源码（如 PR 报告抽查脚本）；
  - 启动器优先加载与自身同级目录下的 `core_script.py`；
  - 当你在平台或 GitHub 仓库提交新版本时，客户端只需点击「检查更新」，**仅下载数 KB 的 `.py` 文件并秒级覆盖**，下次启动立即生效，彻底告别重复安装！

---

## 📁 目录结构

```text
python-packager/
├── core_script.py         # 核心业务逻辑脚本（默认内置 PR 报告抽查脚本）
├── universal_shell.py     # 通用外壳启动器 GUI（带脚本更新与交互控制台运行）
├── version.json           # 当前核心脚本版本描述文件
├── updater_config.json    # 远端更新源配置（GitHub 官方源 / 加速镜像 / 自定义源）
├── requirements.txt       # Python 依赖清单
├── build_exe.bat          # 本地 Windows 一键打包脚本
├── run_launcher.bat       # 本地快速测试启动脚本
└── backups/               # 自动备份目录（热更新前自动备份历史版本）
```

---

## 🚀 GitHub Action 自动化打包

每次向 `main` 分支推送 `python-packager/**` 改动，或在 GitHub Actions 界面手动触发时：
- 工作流 `.github/workflows/package-python-exe.yml` 会在 Windows 环境自动使用 PyInstaller 编译通用外壳；
- 生成便携式压缩包 `PR报告抽查工具-Windows-x64.zip`，并作为构建工件（Artifacts）发布；
- **用户只需下载一次该外壳**，后续业务脚本升级仅需更新远端仓库的 `core_script.py`，无需反复重新构建打包！
