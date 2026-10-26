# Dragon 桌宠故事库

桌宠内置 40 篇中英文故事。每篇包含标题、一句话悬念、三段完整正文、内容分类和参考来源。图特第一人称是文学叙事设定；神话、古代文学、信仰象征与历史事实有各自说明，不把角色亲历当作历史证言。

## 使用

- 首次主动搭话约在启动后 90 秒；之后默认每 3 分钟一次，并加入 ±20% 的随机间隔。设置可关闭搭话，或调整为 1–30 分钟。开启气泡才会主动展示；交互、菜单、聊天生成期间暂缓。
- 每轮打乱故事顺序，遍历后再开始下一轮。故事气泡停留 18 秒，点击或按 Enter/空格可打开故事问答。
- 对话窗口自动请求平台 `/api/ai/chat`，把对应内置全文、分类说明和对话历史作为上下文。连接失败、HTTP 错误、流式错误、空回复或 30 秒超时，均使用已读取的 SQLite 故事全文。
- AI 恢复后可继续追问；AI 不可用时，追问会回到已保存的故事片段，关于真实性/来源的问题展示分类说明与参考资料。此模式不生成新的事实回答。
- 对话窗口提供“听一个故事”和“阅读内置全文”。平台本地服务需要运行才能读取故事库；AI 服务可以关闭。
- 随机眨眼、双眨眼、观察、思考与招手每 10–32 秒尝试一次，用户互动会中断。手动固定状态时暂缓随机待机，关闭窗口/隐藏页面不会继续主动展示。

## 2D 动作与眼神

Dragon 使用四张透明图集，共 32 张手绘姿态。眨眼、张望、挥手、行走、思考、悬空、坐下与困倦各有独立图片；按一致比例与脚底基线解码，不把坐姿拉成长身体。动作由 `dragon-life.js` 的单一播放时钟管理，拖动、点击、打字和工作状态优先；旧图片与 WebGL 试验实现已移除。

正视待机通过 `dragon-presence.js` 的局部 SVG 滤镜提供轻微瞳孔移动。附近鼠标可引起短暂注视，之后平滑回正；非正视帧、互动、隐藏窗口和系统减少动态效果状态暂停眼神位移。桌面坐标只用于本机绘制，不保存或发送给 AI。素材来源及静态文件重建方式见 [Dragon 资源说明](../desktop-pet/assets/dragon/README.md)。

## 存储与接口

`backend/builtin-content/pet-stories.js` 是版本控制的初始内容，不是运行数据库。`pet-stories-repository.js` 首次读取时通过正常建表与 `INSERT OR IGNORE` 写入当前租户 `tools.db` 的 `desktop_pet_stories` 表。重复初始化保留已有行；关闭再打开数据库、恢复备份后仍可初始化。全量 SQLite 备份包含故事表，不新增 JSON 数据库，也不修改默认快速上手快照。

`GET /api/desktop-pet/stories?language=zh-CN|en-US` 返回标题与悬念目录；`GET /api/desktop-pet/stories/:id?language=...` 返回全文、说明与来源。继承会话租户，只允许已登录且开启桌面运行环境的本机访问。无跨租户目录扫描。桌宠本机专用会话沿用原有默认租户身份。

IPC 仅允许桌宠/聊天窗口读取目录，聊天窗口读取全文；故事点击总是显示窗口，加载期间暂存请求，准备就绪后投递一次。快速切换会取消旧请求，清空新对话会清除故事上下文。

`desktop-pet-config.json` 新增 `eyeGazeOn`、`randomMotionOn`、`proactiveStoriesOn`（默认 true）和 `storyIntervalMinutes`（默认 3）。保留已有缩放、打字、气泡和坐标配置。

## 内容范围

月亮与五天、心与羽毛、荷鲁斯之眼、太阳夜航、奥西里斯与伊西斯、创世故事、法老女王与蓬特航行、图坦卡蒙文物、罗塞塔石碑、金字塔石料与测量、沉船者与神蛇、雄辩农夫、胡夫宫廷故事、护身符等。

每篇参考资料一并存储，可通过全文接口查看。资料主要来自大都会艺术博物馆、大英博物馆、苏格兰国家博物馆、伦敦大学学院与世界历史百科。历史类故事采用叙事场景包装；涉及未完整保存的文学作品会明确保留结局的不确定性。

## 验证

```bash
(cd backend && npm run doctor)
node --test tests/desktop-pet-artwork.test.js tests/desktop-pet-presence.test.js tests/desktop-pet-stories.test.js tests/desktop-pet-language.test.js tests/pet-keyboard-hook.test.js
node --test tests/tenant-isolation.test.js tests/tenant-backup-boundaries.test.js
```

测试使用独立临时目录，不改动真实业务数据库。`node_modules/.bin/electron tests/dragon-pet-browser.cjs` 检查 32 张素材、动作播放与中断、减少动态效果，以及中英文、深浅主题和窄窗口设置页。


桌宠形象与聊天身份已更新为 Dragon，动画采用 32 张 2D 姿态（见 `desktop-pet/assets/dragon/README.md`）。历史故事原稿和租户自行编辑的内容保留；其中的图特第一人称是故事角色叙述，不是 Dragon 的身份。
