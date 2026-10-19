# 数通笔记视频发布

视频成品托管在独立的 Dragon-Platform-Media GitHub Releases，应用代码仓库只保存源码、封面、元数据与校验清单。视频不会进入 main 的 Git 历史或 Electron 包。播放时通过应用同源地址按需下载、校验和缓存，兼容 Range、拖动进度和缓存后的离线播放。

## 新增或更新视频

1. 在 `videos/datacom-notes/` 制作视频，文章 ID 与知识库对应。使用 `scripts/export.py <id> <render.mp4>` 导出普通版、高清版和封面。导出会更新页面清单并自动生成后端媒体清单。
2. 在 tools-platform 执行 `npm run datacom:publish-videos`。需要已登录 `gh` 且有媒体仓库写权限。该命令扫描页面清单，生成 SHA-256 分段、创建独立媒体 Release、上传缺失附件并验证远端。重复执行不会覆盖已发布视频。
3. 执行 `npm run datacom:verify-videos`，再提交源码、封面和两份清单。不要强制添加被忽略的 MP4、配音或渲染缓存。
4. 首次克隆运行 `npm run media:install-hook`。之后 `git push` 前自动检查清单并同步缺失媒体；若直接放入视频但尚未生成清单，推送会失败并提示先执行发布命令。CI 再检查远端附件是否齐全及哈希是否一致。

手动导出也遵循以下目录：

```
frontend/assets/promotions/datacom/
  manifest.json          # {"<article-id>": {"v":"YYYYMMDD-N", "title":"...", "duration":117.8}}
  <article-id>.mp4        # 忽略；普通版
  <article-id>-hd.mp4     # 忽略；高清版
  <article-id>-poster.jpg # 随代码发布
```

每个版本使用 `datacom-<article-id>-<v>` 标签；修改成品必须递增 v。已发布标签不可覆盖或删除，旧客户端依赖其固定内容。新版本可以复用旧版本本地文件缺失时保存的清单；新增或变更版本必须有两种质量的本地成品及封面。

## 实现与验证

- `scripts/prepare-datacom-videos.js`：自动登记与 fast-start/整文件/分段校验。
- `scripts/sync-media-releases.js`：检查固定媒体仓库、上传、远端大小和 SHA-256 校验；`--check` 只检查、不写远端。
- `backend/datacom-note-videos.json`：服务端冻结的下载元数据，和首页视频共用缓存实现。缓存位置默认是 TOOLS_DATA_DIR 下 `cache/home-videos/<sha256>/`，可用 TOOLS_PROMO_CACHE_DIR 覆盖。
- `assets/note-video.js`：页面仍使用同源地址，不直接嵌入凭据或可变 latest 地址。

本地检查：`node --test tests/datacom-video-publishing.test.js tests/home-promo-videos.test.js`。
远端检查：`npm run datacom:verify-videos`。实际发布后另检查视频 URL 的 HTTP 206、Content-Range 和首段内容，不能只看 Release 标签存在。

仅适用于公开的内置教学内容。租户私有笔记、用户上传和业务数据不应发布到公共媒体仓库。
