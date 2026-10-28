# Dragon 2D 桌宠

以用户提供的青绿色毛毡小龙照片为参考，使用 imagegen 生成手绘风格透明素材。最终采用 2D；已移除试验性的 WebGL 模型和旧图特图片。

本目录保存随 Electron 客户端分发的角色图片；动画、窗口、额度与故事逻辑位于 `desktop-pet/` 和后端对应模块。当前资源及调用关系核对日期：2026-10-28。

## 图集与静态姿态

四张 1536 × 1024 透明图集，每张四列两行，共 32 张姿态：

| 图集 | 内容 |
| --- | --- |
| idle-atlas.png | 睁眼、半闭眼、闭眼、重新睁眼，以及四种张望姿态 |
| wave-atlas.png | 抬手、挥手、放下的八个连续姿态 |
| walk-atlas.png | 八个轻步行走姿态 |
| states-atlas.png | 思考两帧、悬空两帧、坐下与困倦三帧、开心摸头一帧 |

[dragon-artwork.js](../../dragon-artwork.js) 在本地读取图集，按每格 384 × 512 裁切，统一比例与脚底基线，输出 400 × 600 的透明画布。坐下时不拉长身体，挥手时不随包围框宽度缩小角色。[dragon-life.js](../../dragon-life.js) 按动作节奏播放，拖动、点击、打字和工作状态优先于随机待机动作。[dragon-presence.js](../../dragon-presence.js) 管理朝向和视线。遵守减少动态效果设置；窗口隐藏时停止逐帧切换。

`idle.png`、`wave.png`、`walk.png`、`think.png`、`dragged.png`、`pat.png`、`sleep.png` 均为 400 × 600，是同一图集机械裁出的静态资源，用于首屏、头像及加载失败回退；无 AI 重绘。更新图集后，需要重新生成这七个静态文件时，从项目根目录运行：

```bash
node_modules/.bin/electron scripts/prepare-dragon-pet.cjs
```

该脚本复用运行时裁切逻辑并覆盖上述七张 PNG；正常启动或仅修改文档无需执行。添加姿态时应同时检查 `dragon-artwork.js` 的帧映射、`dragon-life.js` 的动作序列和静态回退。

## 桌面运行与额度侧栏

[pet-manager.js](../../pet-manager.js) 管理桌宠、聊天、设置、额度侧栏和趋势窗口。新配置默认缩放为 `0.75x`，默认显示额度侧栏并在隐藏桌宠时保留侧栏；既有明确设置继续沿用。系统托盘中的「显示 Agent 额度侧栏」控制显示，「隐藏桌宠时保留额度侧栏」控制桌宠隐藏或停用后的保留行为。

额度侧栏默认是 416 × 58 的横栏，停靠左右边缘时为 152 × 184 的竖栏；支持四边停靠、自由摆放、记住位置，以及切换详细面板。显示 Codex、Claude Code、Antigravity 的可用额度，点击额度数字可查看历史趋势。有效新读数经本地登录接口保存到当前租户 SQLite，按安装标识与用户隔离；没有采样的时段不会补造历史。

外部 Agent HUD 应用独立运行。本目录图片与额度侧栏不提供会话派发；平台首页的原生桌面对话连接、排队、Codex 引导及 DragonTAC 同会话讨论见 [桌面 Agent 会话接入](../../../docs/desktop-agent-conversations.md)。

聊天与设置采用 Dragon 名称、头像和伙伴角色。既有历史故事及用户修改仍保留，故事中的神话人物属于原稿内容，不是桌宠身份。

## 验证

从项目根目录运行资源与交互逻辑测试：

```bash
node --test tests/desktop-pet-artwork.test.js tests/desktop-pet-presence.test.js tests/desktop-pet-quota-panel.test.js
```

需要验证逐帧渲染、拖动打断、减少动态效果、中英文和深浅主题时，可在有图形环境的本机运行：

```bash
node_modules/.bin/electron tests/dragon-pet-browser.cjs
node_modules/.bin/electron tests/desktop-quota-sidebar-browser.cjs
```
