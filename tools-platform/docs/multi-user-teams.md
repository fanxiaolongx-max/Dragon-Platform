# 多用户：一个账号 = 一个团队

平台面向 10–20 个团队账号在线使用。每个账号对应一个团队，数据完全隔离；界面上不出现“租户”一词，代码与目录里仍叫 tenant。

## 角色

| 角色 | 谁 | 能做什么 |
|---|---|---|
| 超级管理员 | 内置账号 `admin`（`auth_users.is_super = 1`，默认数据空间） | 全部功能；创建、删除账号和重置密码；进入任意团队排障；不进沙箱 |
| 团队账号 | 超级管理员创建的其他账号（`role = admin`，`is_super = 0`） | 在自己团队里是管理员：改模型、建技能、上传工具、AI 对话、终端；出不了自己的团队 |

登录页只有账号密码。账号由超级管理员在「全局设置 › 账号管理」创建，用户名同时是团队目录名（小写字母、数字、`-`、`_`）。删除账号时团队数据先归档，可选择彻底删除。

## 数据放在哪里

| 位置 | 内容 |
|---|---|
| `backend/data/platform/control.db` | 账号、登录会话、团队登记、平台审计日志。任何团队的数据库浏览和 AI 数据库工具都看不到 |
| `backend/data/`（默认空间） | 超级管理员自己的业务数据，以及全平台共用的内容：登录安全记录与策略、请求统计、需求广场、数字人对接配置、公共模型 |
| `backend/data/tenants/<账号>/` | 该团队的业务库与文件 |
| `backend/data/tenants/<账号>/workspace/` | 团队的 AI 对话目录与终端默认目录 |
| `backend/data/tenants/<账号>/home/` | 命令运行时的 HOME：CLI 登录、npm 全局包、命令行安装的技能 |
| `backend/data/tenants/<账号>/tmp/sandbox/` | 命令运行时的临时目录 |

首次升级时，账号、会话、团队登记从 `backend/data/tools.db` 复制到控制库，复制前把原库备份到 `backend/data/backups/control-plane-migration/`。旧表保留不删，回滚到旧版本时仍能登录。

## 团队账号的边界

- **目录**：AI 对话选择的文件夹、文件工具、终端目录都必须在团队的 `workspace/`、`home/` 或 `tmp/sandbox/` 内，软链接指向外部同样拒绝。
- **命令**：AI 的 `run_command`、交互式命令、终端面板、平台替团队仓库执行的 git，都放进沙箱运行。沙箱内读不到平台数据、平台源码、服务器用户目录和其他团队；只能写团队自己的三个目录；网络不限制。
- **沙箱之外的工具**：平台共享的 MCP 服务、服务器本机浏览器运行在沙箱外。团队账号默认用不了，超级管理员在「全局设置 › 智能体工具」里按组开启后才可用。
- **模型**：超级管理员把模型勾选「分配给所有团队」后，团队可以使用但不能修改，也读不到密钥；团队可以另加自己的模型。
- **技能与 HTML 工具**：内置的全平台共用；团队自己创建或上传的只有本团队可见。超级管理员能看到各团队上传的工具。
- **只给超级管理员**：托管应用、静态页面推送、频道对接、MCP 配置、桌面 Agent、DragonTAC、程序更新、备份恢复、平台标识、媒体资源、平台推广、自定义工具备份、安全策略、数据探索、迁移状态、把配置写回项目源码的操作。

## 部署前提

| 服务器 | 沙箱 | 需要做什么 |
|---|---|---|
| macOS | 系统自带 `sandbox-exec` | 无。平台自己不能运行在另一层沙箱里 |
| Linux | bubblewrap | `apt install bubblewrap`。Ubuntu 24.04 还要放开 `kernel.apparmor_restrict_unprivileged_userns`，或给 bwrap 配 AppArmor 规则 |
| Windows | 没有 | 团队账号不能执行命令和开终端，文件工具仍限制在团队目录内 |

平台第一次用到沙箱时，会用真实的沙箱规则试跑一次。不可用时团队账号的命令和终端直接拒绝并给出原因，不会退回到无沙箱执行；装好依赖后一分钟内自动恢复，不用重启。

其他建议：

- 用普通系统账号运行平台，不要用 root。以 root 运行时 Linux 沙箱会去掉全部特权并屏蔽 `/etc/shadow` 等文件，但普通账号多一层保险。
- 沙箱内可以访问服务器本机端口（例如其他服务的管理端口）。本机上不要运行无需登录就能操作的服务；云主机建议在防火墙封掉元数据地址 `169.254.169.254`。
- 平台是单进程架构（对话、终端、上传会话都在进程内存里），PM2 只开一个实例，不要用 cluster 模式。

## 验证

```bash
node --test tests/team-accounts.test.js tests/team-sandbox.test.js tests/team-shared-models.test.js tests/team-platform-gates.test.js
```

`team-sandbox.test.js` 在沙箱不可用的机器上会跳过命令部分并写明原因。在目标服务器上跑一遍，确认没有被跳过。

## Linux 服务器安装与自动更新

`scripts/server-update.sh` 在服务器上运行，从 GitHub 拉取 `main`（只取 `tools-platform/`），装依赖、重启服务，并安装一个定时器每 5 分钟检查一次更新。新版本启动后健康检查不通过会自动回退到上一个版本。

```bash
curl -fsSL https://raw.githubusercontent.com/fanxiaolongx-max/Dragon-Platform/main/tools-platform/scripts/server-update.sh -o /tmp/server-update.sh
```

```bash
SERVICE=dragon-claw PORT=3030 bash /tmp/server-update.sh install
```

| 命令 | 作用 |
|---|---|
| `bash /opt/<SERVICE>/tools-platform/scripts/server-update.sh update` | 立即检查并更新；没有新提交时什么都不做 |
| `… update --force` | 重装依赖并重启 |
| `… status` | 当前版本、服务状态、下次检查时间 |
| `systemctl stop <SERVICE>-update.timer` | 暂停自动更新 |

可用环境变量：`SERVICE`（服务名，默认 `dragon-claw`）、`PORT`、`INSTALL_DIR`、`DATA_DIR`、`RUN_USER`、`BRANCH`、`UPDATE_INTERVAL`。数据目录在代码目录之外，更新不会动数据。服务的环境变量在 `/etc/<SERVICE>.env`，已存在时不会被覆盖。

每次更新都会重启服务，正在进行的对话和终端会中断。正式环境建议把 `UPDATE_INTERVAL` 调大，或停掉定时器改为手动更新。
