# Tools Platform Agent Guide

## 适用范围

本文件适用于 `tools-platform/` 下的全部代码。它是 AI 的项目级工作指南，不是产品文档或某个业务模块的完整规格。

信息优先级：

1. 当前代码和自动化测试是行为真相。
2. `README.md` 是人类面向的产品、部署与运维说明。
3. `docs/` 保存专项 API 文档。
4. 历史 Skill、备份、导出物和构建产物不得作为当前架构的唯一依据。

## 项目概览

Tools Platform 是一个本地/内网质量运营工具中台：

- 后端：Node.js + Express，入口为 `backend/server.js`。
- 前端：原生 HTML/CSS/JavaScript 多页应用，没有前端打包步骤。
- 存储：SQLite 为当前主存储，历史 JSON 只用于启动迁移和兼容。
- 桌面端：Electron，入口为 `electron-main.js`。
- 移动端：`iosapp/` 是独立的 Kotlin Multiplatform/iOS 工程。

不要为局部需求引入新的前端框架、ORM 或第二套存储模式。

## 快速定位

| 领域 | 前端 | API/服务 | 主要存储 |
| --- | --- | --- | --- |
| 公共导航、鉴权、AI 助手 | `frontend/js/shared/` | `backend/middleware/`, `backend/routes/auth.js`, `backend/routes/ai*.js` | 平台库与租户业务库 |
| UIVF12 脚本仓库 | `frontend/pages/uivf12.html`, `frontend/js/uivf12/` | `backend/routes/uiv*.js` | `tools.db` |
| SLA 导入与规则 | `frontend/pages/sla.html`, `frontend/js/sla/` | `backend/routes/sla.js`, `backend/routes/upload.js` | `tools.db` |
| 报表、月报、大屏、催办 | `frontend/pages/{report,monthly,bigscreen,expedite}.html`, `frontend/js/report/` | `backend/routes/db.js` | `report.db` |
| 租户、初始化、备份恢复 | 全局设置和导航界面 | `backend/routes/{tenants,onboarding,global-backup}.js` | 平台库 + 租户目录 |
| 自定义/内置工具 | `frontend/pages/custom-tool.html` | `backend/routes/custom-tools.js`, `backend/models/builtin-tools-sync.js` | `backend/data/custom-tools/`, `backend/builtin-tools/` |
| 需求、问卷、PR 审计、FRT | 同名页面和脚本 | `backend/routes/{requirements,surveys,praudit,frt}.js` | 对应 SQLite 库 |
| 桌面授权与打包 | 授权页面 | `desktop-license-*.js`, `backend/routes/desktop-license-*.js` | 桌面运行时配置 |

修改任一业务前，先读它的页面、页面脚本、路由和 repository/service，不要只看某一层就改。

## 租户与存储边界

- `/api/*` 在鉴权后经过 `tenantMiddleware`，当前租户来自用户 Session。
- 业务代码通过 `backend/models/app-db.js` 或 `backend/models/tenant-sqlite-pool.js` 取得租户感知的数据库连接。
- 禁止在新代码中直接硬编码 `backend/data/tools.db` 或 `data/report.db`。
- 默认租户使用 `TOOLS_DATA_DIR`/`backend/data/` 和 `TOOLS_REPORT_DATA_DIR`/`data/`。
- 命名租户使用 `backend/data/tenants/<tenant-id>/`；其 `tools.db`、`report.db`、`requirements.db`、自定义工具和备份都应保持租户隔离。
- `backend/models/platform-db.js` 只用于账号、Session、租户注册等控制面数据。不要把普通业务数据放进平台库。
- 备份、恢复、删除、出厂重置必须校验租户 ID；不得因“全局备份”的历史命名而扫描或覆盖其他租户。
- 历史报表应优先显示入库时保存的得分、目标和计分模式；除非用户明确要求，不用当前规则重算历史月份。

## 数据库和迁移规则

- 新持久化功能使用 SQLite，不得新增裸 JSON 数据库。
- 历史 JSON 读取只存在于迁移/恢复链路；不要恢复双写或 JSON fallback。
- Schema 变更必须兼容已存在的数据库：使用 `CREATE TABLE IF NOT EXISTS`、可重复执行的 `ALTER TABLE ... ADD COLUMN` 保护，并保留旧行的默认语义。
- 跨库或跨租户修改必须有对应的隔离/恢复测试。
- 不得手工改写实际 `.db`、WAL 或 SHM 文件来实现功能修复。

## API、权限与安全

- `backend/server.js` 中的中间件顺序是公共契约：先处理少量公开路由，再鉴权，再注入租户上下文，然后应用管理员写操作限制。
- 新的业务 API 默认应需要登录；非 GET 默认应需要管理员。如需例外，必须在路由内实施更精确的权限校验。
- 不得记录或发送给 AI 的内容包含明文密码、Token、Cookie、Authorization、API Key、Secret 或私钥。
- 保留 request ID、统一错误码和已有响应结构；不要让局部修改破坏桌面端或移动端调用方。
- 修改 `/api/external/metrics` 时同步检查 `docs/external-metrics-api.md` 和 `iosapp/external-metrics-api.md`。

## 前端规则

- 保持原生多页结构；共享能力优先放在 `frontend/js/shared/` 或共享 CSS，业务逻辑留在对应模块。
- 不要在 HTML 中手写 `?v=` 缓存版本：服务端 `backend/models/asset-versioning.js` 会按文件内容自动追加哈希（`tests/asset-versioning.test.js` 会拦截手写版本）。
- 修改 shared 资源时，用 `rg` 找全部引用页，不要只更新当前页面。
- 新增可见文案时检查中英文切换、暗色/浅色主题、窄屏和 Electron 容器。
- 不要只在 HTML 内复制已有 shared 工具的另一份实现。

## 禁止随意修改的内容

除非用户明确要求相应数据、恢复或发布操作，不得删除、重置或批量重写：

- `backend/data/`, `data/` 中的运行数据和数据库。
- `backend/backups/`, `backups/`, `backend/factory-reset-archives/` 中的备份与归档。
- `backend/data/custom-tools/` 中的用户工具和业务状态。
- `dist/`, `outputs/`, 日志、临时导出物和打包产物。
- `backend/defaults/` 中的默认快照，除非当前任务就是刷新默认快速上手包。

`backend/builtin-tools/` 是版本控制的内置工具源，而 `backend/data/custom-tools/` 是运行时/用户数据；不要混淆两者。

## 开发与验证

常用命令：

```bash
# 后端环境与启动前检查
cd backend && npm run doctor

# 全部 Node 测试
node --test tests/*.test.js

# 定向测试
node --test tests/tenant-isolation.test.js

# 服务端（默认 http://localhost:3030）
npm start

# Electron 桌面端
npm run start:desktop
```

验证要求：

- 后端 route/model/schema 变更：至少运行 `backend` 的 `npm run doctor` 和相关 Node test。
- 租户、备份、恢复变更：运行 `tenant-isolation.test.js` 和 `tenant-backup-boundaries.test.js`。
- 报表变更：检查 report snapshot、target month、auto-fill 及导出文件名相关测试。
- 前端 JavaScript 变更：对改动文件运行 `node --check <file>`，并在需要时做页面级运行验证。
- 修改默认脚本/指标规则后，只在用户明确要求刷新快照时运行 `npm run defaults:export`，因为它会改写版本化文件和 README 片段。
- 不要为普通代码修改运行 Electron 打包命令；打包耗时且包含授权配置前置检查。

## 工作方式

1. 先用 `git status --short` 确认用户已有改动，不覆盖无关工作。
2. 用 `rg`/`rg --files` 定位引用、API、表名和测试。
3. 优先做范围最小且与现有模式一致的修改。
4. 加载与任务直接相关的页面、路由、repository/service 和测试，不依赖过时记忆。
5. 根据风险运行最小充分验证，并在交付时说明实际运行的命令和未验证部分。

