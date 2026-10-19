# 数通协议专家维护规则

继承 tools-platform/AGENTS.md。主入口为 index.html / assets/app.js，保持原生 HTML/SVG。

## 笔记视频必须独立发布

- **MP4、配音 MP3 和渲染缓存不得提交到 Dragon-Platform 代码仓库。** 制作源码可以提交。
- 页面播放器是 assets/note-video.js，入口清单是 frontend/assets/promotions/datacom/manifest.json。
- 使用公开内置文章 ID 命名 `<id>.mp4`、`<id>-hd.mp4`、`<id>-poster.jpg`；清单登记 title、duration、v（YYYYMMDD-N）。不得发布租户私有文章、用户数据、Cookie 或密钥。
- 视频附件统一发布到 `fanxiaolongx-max/Dragon-Platform-Media` 的不可变 Release，标签 `datacom-<id>-<v>`。修改视频必须递增 v，绝不覆盖已发布附件。
- 运行 `npm run datacom:publish-videos` 自动登记、上传及校验；运行 `npm run datacom:verify-videos` 检查远端。不要手工拼接 SHA-256 或分段清单。
- `backend/datacom-note-videos.json` 保存固定下载地址、大小、整文件与分段 SHA-256；视频请求复用 home-promo-videos.js 按需下载/缓存，页面 URL 保持 `/assets/promotions/datacom/<id>.mp4`。
- 新克隆运行 `npm run media:install-hook`，使 git push 自动检查并上传缺失的已登记视频。导出脚本自动登记；直接复制视频时先运行发布命令。CI 会检查媒体已发布，但代码仓库中没有 MP4，因此 CI 无法代替本地上传。
- 主仓库仅提交源码、封面和 JSON 清单。桌面包排除全部 datacom MP4；未登记视频不应触发任意 URL 下载。

详细说明：`tools-platform/docs/datacom-video-publishing.md`。
