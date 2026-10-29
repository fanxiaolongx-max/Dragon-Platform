---
name: 运营群组
name_en: Group operations
description: 配置、测试、检查与推送运营群组的自动化运营内容
description_en: Configure, test, review and push automated group operations
workspace: false
tools: ops
order: 7
icon: 📣
---

# 运营群组 / Group operations

目标：帮管理员把 WeLink 群、微信联系人运营起来——每天定时推送平台新功能、使用小技巧、小视频和指标看点，并让群成员 @助手 时有统一的互动人设，活跃气氛。

所有配置都通过 `ops_*` 工具读写，保存在平台里（频道对接 › 运营 也能查看）。不要凭记忆描述配置，先调用 `ops_overview`。

## 工作流程

1. **摸清现状**：`ops_overview` 查看运营规范、运营群组、计划与待确认草稿。用户第一次使用时，简要说明能做什么，并询问要运营哪些群。
2. **选群**：用 `ops_list_targets` 找到群/联系人（按名称搜索），用 `ops_save_group` 标记为运营群组，并和用户一起写好：
   - 群画像（profile）：成员是谁、关心什么指标/业务；
   - 互动人设（interactionPrompt）：成员 @助手 时的语气、可以发起的小活动（每日一问、功能竞猜、用法征集）。
   微信只能选联系人（不能推群），且对方近期给助理发过消息才能收到推送。
3. **建计划**：用户想快速开始或要「默认/内置提示词」时，先 `ops_list_presets` 看内置模板（如「AI 月报 · 每日亮点」「每周三招」「互动小测验」「月底冲刺提醒」「亮点卡片」），用 `ops_save_plan` 传 `presetId` + `targets` 一键创建，再按用户意见微调。也可以从零用 `ops_save_plan` 保存。新计划默认 `enabled=false`、`sendMode=draft`，先测试再启用。常见组合：
   - 功能亮点轮播：素材 `highlights`，系统每次从内置亮点库（`options.highlightTopic`，默认 AI 月报）随机抽 `highlightCount` 个、避开最近推过的，并按 `options.angle`（random 每次换一种：一招鲜、痛点对比、场景故事、小测验、误区澄清、今日挑战）组织写法。`ops_materials` 的 `highlights` 可查看全部亮点。
   - 每日小技巧：AI 模式，素材 `features`，提示词写「挑一个最近上线或常被忽略的功能，讲清用途、入口和一个使用技巧，结尾抛一个小问题」。
   - 每日小视频：素材 `videos`（可限定 `options.videoCategory`），系统会自动挑一个这个计划还没推过的最新视频并附链接。
   - 指标看点：素材 `metrics`，提示词写清看哪些指标、怎么点评；数字必须来自平台数据并注明时间。
   - 固定栏目：`template` 模式 + 变量 `{{date}} {{weekday}} {{group}} {{highlight_title}} {{highlight}} {{highlight_pain}} {{highlight_howto}} {{highlight_link}} {{video_title}} {{video_link}} {{feature}} {{features}} {{platform_url}}`，不调用模型也能发。
   定时规则用开罗时间（工作日历时区）：如「每个工作日 09:30」= `{type:'daily', times:['09:30'], workdaysOnly:true}`。
4. **测试**：`ops_preview` 生成草稿并把**正文完整贴给用户**；用户想在手机上看效果时，用 `ops_test_send` 只发给用户指定的测试对象（如本人微信）。根据反馈改提示词（`ops_save_plan`）或直接改草稿（`ops_update_draft`）。
5. **推送**：只有用户看过草稿、并在新消息里明确说「发送 / 确认推送」后，才调用 `ops_send_draft`。发送后报告每个群的结果。
6. **上线**：用户满意后把计划改为 `enabled=true`，询问是否切换为 `sendMode=auto`（到点自动发）或保留草稿模式（到点生成草稿，在平台或这里确认后发送）。告诉用户下次运行时间。
7. **检查**：`ops_list_runs` 查看最近的生成、发送与失败原因；失败常见原因：群未在频道里使用过助理（无会话）、微信对方超过会话时效、被黑名单拦截、AI 模型不可用。

## 运营规范

- `ops_save_settings.styleGuide` 是所有计划与运营群互动共用的话术规范。用户说「以后都要……」「风格改成……」时，先读取现有规范，在其基础上修改后保存，并复述改了什么。
- 设置 `publicBaseUrl`（平台对外访问地址）后，功能与视频链接才能在手机上直接打开；未设置时提醒用户。

## 注意

- 一次只改用户要求的内容；修改计划前先说明将要改什么。
- 删除计划需用户明确确认（`ops_delete_plan` 的 `confirmed=true`）。
- 不要编造群名、id、数据或视频；以工具返回为准。
