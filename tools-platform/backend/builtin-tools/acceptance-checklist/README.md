# 在线验收表

原生 HTML/CSS/JavaScript，自包含 ExcelJS 4.4.0（MIT）浏览器版，无 CDN 或业务 API。填报和压缩后的图片存入当前浏览器同源 IndexedDB；不写入平台业务库。不同浏览器、设备及域名之间不会同步。同一浏览器同源的使用者共享此工具的本地表格；如需多人协作，应各自备份后交接。

默认内容来自用户提供的验收表照片：四项交付物，权重 40/15/15/30，基准数量均为 1。实际数量及验收结果留空/待验收，避免把原图示例当作已完成事实。BOQ、采购项目、单位移至表头。重复小计和总验收百分比移除；扣罚条款折叠显示，未自动执行扣罚和计分。文字允许修改，照片中较模糊的条款仍应人工核对。

验收结果：待验收、通过、有条件通过、不通过、不适用。支持增加/删除验收项目、备注，每项最多六张 PNG/JPEG/WebP 图片（每张原图不超过 10 MB），在浏览器内压缩为最长边 1600px JPEG。Excel 原生 `.xlsx` 导出含基本信息、结果下拉及全部图片（每行两列缩略图，最多三排），扣罚规则另放参考工作表。Excel 文件用于交付查看，浏览器恢复请使用 JSON 备份；JSON 包含图片。恢复前校验结构及图片可解码性，然后确认覆盖。不要仅依赖浏览器存储长期归档。

单文件交付（无需联网、双击打开，也可上传平台“自定义工具”）：

```sh
node scripts/package-acceptance-checklist.js /tmp/在线验收表.html
```

本目录遵循内置工具清单协议，可通过平台现有“系统工具更新”机制安装。无需修改路由或手工写入运行数据。独立 HTML 和平台地址的浏览器存储相互独立；迁移时用备份/恢复。直接以 `file://` 打开时的持久化行为由浏览器决定，页面会显示保存失败，避免误报已保存。

验证：

```sh
node --check backend/builtin-tools/acceptance-checklist/app.js
node --check scripts/package-acceptance-checklist.js
node_modules/.bin/electron tests/acceptance-checklist-browser.cjs
node --test tests/asset-versioning.test.js
```

## 当前维护入口（2026-10-28）

页面入口为 [index.html](index.html)，交互与 IndexedDB 存储见 [app.js](app.js)。从项目根目录执行上述打包与验证命令；打包命令会写入指定输出文件，仅交付独立 HTML 时执行。平台内置源码和租户运行目录分别维护，修改源码后使用系统工具更新应用。中文与英文、深浅主题及窄屏均应在页面核对；工具 JSON 备份是跨设备交接入口，平台租户备份不包含浏览器 IndexedDB。
