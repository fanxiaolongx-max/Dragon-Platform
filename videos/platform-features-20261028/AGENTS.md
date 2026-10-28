# 小龙功能指南维护规则

- 本系列统一使用 `assets/xiaolong-reference.jpg` 中的小龙：青绿色毛毡、米白大眼与肚皮、圆牙、背刺与卷尾。保持同一角色身份；讲解/倾听透明姿态已提供，不改回小码机器人。
- 以一个具体工作任务贯穿“痛点 → 操作 → 结果 → 边界与下一步”；功能事实先读当前前端、路由、service/repository，不能只照旧旁白改名。
- 优先使用当前真实前端组件的本地示例截图。不得拍入账号凭据、个人聊天、真实业务数据；概念手机流程、演示配置和示例数字必须标明。
- 视频串行制作，渲染 `--workers 1`。默认工作目录在 `/Volumes/256G/DragonVideoWork/feature-guides-20261028`，`TMPDIR` 和 `HYPERFRAMES_EXTRACT_CACHE_DIR` 同样指向 256G 盘；`VIDEO_WORK_DIR` 可覆盖制作脚本的默认目录。
- 每集必须完成 check、场景/接缝/手机尺寸审阅、MP4 逐场景解码、时长和音轨检查，再开始下一集。声音未经人工试听时如实记录。
- 成片与配音不进主代码仓库。独立媒体仓库为 `fanxiaolongx-max/Dragon-Platform-Media`；已发布 Release 附件不可覆盖，改片使用新标签并重新生成 SHA-256 清单。
- 首页接入与桌面排除规则参见 README.md；不得把未制作的英语版链接拼进页面，普通话版在英文界面明确标注 Mandarin。
- 只清理本次生成且可再生成的缓存，保留成片、源码、角色原图、最终审阅证据和 HyperFrames 历史；不扫描删除别的项目或用户数据。

- 配音多音字规则：AI 月报里“重复 / 重做 / 重画 / 重新”的重读 chóng；`specs/ai-monthly-guide.json` 的 pronunciations 仅供 TTS 使用，原文与字幕保留正确汉字。不要全局替换“重”，以免破坏“严重”等 zhòng 音词。修改发音或声音配置必须使语音缓存失效。
