# 静态平台主页与统一登录

静态推送现在发布原平台主页、原登录页和已推送的只读工具。主页复用 `frontend/index.html`、`frontend/pages/login.html` 及现有样式、导航和中英文组件，不维护另一套仿制主页。分类、搜索、主题相关样式、推广图片、效能概览、视频及工具预览沿用平台表现；打开已推送工具时映射至其静态地址。未推送工具、服务端写操作与不可用功能提示“无权限，请联系管理员添加”。不导出私人 AI 会话、脚本仓库、插件包或账号管理接口。

## 登录与数据保护

- 登录账号来自当前租户有权访问的本地账号快照，密码与推送时的本地密码一致。修改账号或密码后重新推送，不能在纯静态托管上实时查询本地认证服务。
- 每个租户的站点密钥保存在该租户 `tools.db` 的 `snapshot_portal_keys` 表。导出使用独立随机盐、PBKDF2-SHA-256 和 AES-GCM 为账号包装站点密钥，不发布平台明文密码、原始密码哈希、Session、Cookie 或 API 密钥。
- 首页和工具 HTML、业务 JSON、工具附属资源保存为 AES-GCM 密文；公开文件只提供登录页面、通用界面资源、加密清单和引导脚本。直接访问工具或数据地址也不能绕过内容解密。
- 浏览器在当前标签页会话保存解密密钥，所有工具共用一次登录。退出会清除会话并锁定受当前 Service Worker 控制的页面。密码或账号变化会在下一次推送时更换站点密钥，旧登录不能解密新发布内容。
- 使用 HTTPS 的 Pages 托管，浏览器需支持 Service Worker 和 Web Crypto。HTTP localhost 可用于开发测试。网页密码不能撤回已经下载的副本或旧 Git 历史，仓库与托管权限仍按数据的实际可见范围设置。

站点不再使用各工具的独立密码。旧设置字段保留兼容读取，发布与下载入口不再应用它们；底层快照生成器仍保留兼容调用参数。下载单工具 HTML / ZIP 仍是管理员在平台导出的独立只读文件，不等同于网站的加密载荷。

## 视频

右上角的 NetCare RFC、操作激励、EOS 月报和平台指南四组视频同时支持中文和英文普通版、高清版，地址来自 `backend/home-promo-videos.json` 的固定媒体 Release。登录页下方的“项目演进”入口也使用对应的媒体 Release 视频。原生 `<video>` 直接播放远端地址，不设置 `crossorigin`，不复制 MP4 到静态代码仓库。封面及背景图片随通用界面资源发布；视频需要联网，沿用浏览器自动播放限制和静音降级。平台本地的视频请求与缓存接口保持不变。

## 发布与升级

- `index.html` 和各工具 HTML 路径是登录引导页，实际内容通过 Service Worker 解密。
- `tp-static/` 是生成器管理的目录，通用页面资源位于 `tp-static/frontend/`，业务密文位于 `tp-static/payload/`，清单位于 `tp-static/site.json`；`tp-static-sw.js` 位于站点根目录。不要手工修改这些生成文件。
- 首次升级会替换旧的简易工具列表首页，并迁移现有工具到统一登录。曾启用独立密码的旧工具会从当前平台重新生成，移除旧门禁。
- 单工具推送保留其他已发布工具；全量推送会清理已取消勾选的工具。脚本与插件工具暂不参与网站发布，已发布的对应入口会移除。
- 业务数据无变化时复用密文，默认推送不会制造空提交。主页、账号、公共资源或视频映射发生变化时仍能正常识别并更新。强制推送保留原有触发重新部署的行为。
- 本地 Git 镜像只用于读取远端并加速隔离克隆，原工作区不会被修改。站点密钥随租户 SQLite 备份保留；完整重新生成全部已发布工具时可替换旧密文，部分更新需能读取原站点密钥。

## 验证

```bash
node --test tests/snapshot-portal.test.js tests/generic-static-tool-snapshot.test.js tests/static-tool-snapshots.test.js tests/department-reward-penalty-snapshot.test.js tests/catalog-tool-snapshot.test.js
node_modules/.bin/electron tests/snapshot-portal-browser.cjs
PORTAL_REMOTE_VIDEOS=1 node_modules/.bin/electron tests/snapshot-portal-browser.cjs
```

浏览器验证涵盖原登录页、错误密码、主页组件、中英切换、工具权限、直接链接保护、退出、真实数通知识库加载，以及 Service Worker 停止后的资源解密恢复。启用远端视频验证时另检查四组视频两种语言的普通版/高清版与项目演进视频的实际播放。
