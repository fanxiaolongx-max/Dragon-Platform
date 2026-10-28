# WeLink CLI：把散落的办公信息找回来

GOAL: 用户能完成第一个小任务，并理解结果该如何核对。
OUTPUT: HyperFrames，1920×1080，30fps；1080p 成片 + 720p 预览。
TIME: 逐句实际配音决定各段长度，最终秒数与帧区间见 timing.json。
LOOK: #f2f5f8 工作台底色，#183047 正文，#147a65 功能强调色；Noto Sans SC 65px/800 标题，33–56px 关键标签，42px 字幕；安全边距 154px。
OBJECTS: 实际产品组件截图（本地假接口，无账号凭据和真实业务数据）；可辨认的详单/手机/月份/流程线；统一使用用户参考图的小龙毛毡角色。
MOTION: power2.out 0.42秒分步出现；关键操作后再展示结果，标题落定后不漂移；单次 0.9秒指示手势。
AUDIO: Xiaoxiao 普通话神经语音，-3% 语速；原创 86BPM 稀疏钢琴/低音配乐，语音能量驱动 duck，-16 LUFS / -1.5dBTP 目标。
BANNED: 无来源数据、夸大效率承诺、自动绕过审批、虚构实时连通；霓虹粒子、深色小字漂浮、三张功能卡堆砌、整页逐字朗读。
QA: 全场景中帧、切点、360px 缩略图、字幕窗口、长标题、音轨和编码；输出必须与 data-duration 相符。

## 分镜
1. 会要开了，资料还散在各处 — pain；旁白原稿见 ../specs/welink-cli-guide.json
2. 这一次，是以你本人的身份 — identity；旁白原稿见 ../specs/welink-cli-guide.json
3. 先登录，再打开办公能力 — screen；旁白原稿见 ../specs/welink-cli-guide.json
4. 从一个明确的问题开始 — prompt；旁白原稿见 ../specs/welink-cli-guide.json
5. 把信息，整理成开会前的清单 — collect；旁白原稿见 ../specs/welink-cli-guide.json
6. 查询之后，要发送就先确认 — approval；旁白原稿见 ../specs/welink-cli-guide.json
7. 能执行，也要看得到结果 — audit；旁白原稿见 ../specs/welink-cli-guide.json
8. 先把会议准备，交给一句话 — end；旁白原稿见 ../specs/welink-cli-guide.json

## 事实依据
- frontend/js/shared/welink-cli-settings.js
- backend/routes/channels.js
- backend/models/channels/welink-cli-{runner,agent}.js
- backend/agent-skills/welink-office/SKILL.md