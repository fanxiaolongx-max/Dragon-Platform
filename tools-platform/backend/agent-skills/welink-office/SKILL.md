---
name: WeLink 办公
name_en: WeLink office
description: 以本人身份查询 WeLink 联系人、聊天记录、会议、云空间、邮件与日历
description_en: Query WeLink contacts, chats, meetings, cloud drive, mail and calendar as yourself
workspace: false
order: 8
icon: 💼
---

# WeLink 办公 / WeLink office

目标：通过本机安装的 welink-cli，以**用户本人**的 WeLink 身份查询办公信息，帮用户找人、回顾聊天、准备会议、整理邮件和日程。

仅管理员可用；需要管理员先在「全局设置 › 频道对接 › WeLink › 个人身份（welink-cli）」检测安装、扫码登录并启用，且本机 WeLink PC 保持登录。所有查询都通过 `welink_query` 工具，结果以工具返回为准，不要编造人员、消息、会议或邮件。

## 能力边界（第一期只读）

- 可以：搜索联系人/群组、查联系人详情、最近会话、群成员、聊天记录、会议列表/详情/议题/材料、会议模糊搜索、云空间浏览与搜索、邮件文件夹/列表/详情、日历列表/详情。
- 不可以：发消息、撤回、建群、拉人、建会/改会/取消、发/回/转邮件、建日程、云空间上传/下载/删除/外链。用户提出时说明这一期不支持；如有帮助，给出等价的 `welink-cli` 命令让用户自己在终端执行，并提醒会以本人身份对外生效。

## 调用约定

`welink_query` 的参数名与 welink-cli 一致（不带 `--`），例如：

- 找人：`{"command":"search person","options":{"text":"张三","page-size":10}}`，结果里 `w3account` 是账号、`welinkId` 是消息 ID。
- 聊天记录：`{"command":"im query-history-message","options":{"user-account":"a00123456","query-count":30}}`；群聊用 `group-id`（二选一）。先用 `im query-recent-conversation` 或 `search group` 拿到群 ID。
- 联系人详情：`{"command":"contact detail","accounts":["welinkId1","welinkId2"]}`。
- 会议列表：`meeting query-list` 的 `meeting-start-time` / `meeting-end-time` 是 **13 位毫秒时间戳**，`type`：0 公开、1 待参加、2 已结束、3 我预定、4 所有、5 我管理；`size` ≤ 30。
- 会议 ID：所有 `meeting-id` 都是会议主键（来自 query-list 的 meetingId），**不是视频会议号**。
- 会议搜索：`{"command":"meeting fuzzy-search","options":{"result-type":"meeting","limit":10,"offset":0},"search":[{"type":"subject","content":"周会"}]}`，时间范围再加 `startTime` / `endTime` 条件（毫秒时间戳）。
- 云空间：个人空间的 `space-id` 来自 `onebox user-info` 的 `cloudUserId`；根目录 `folder-id` 为 0；团队空间/群空间的 space-id 只能从用户提供的 onebox 网页链接里解析（`#teamspaceFile/<页>/<folder-id>/<space-id>`）。云空间接口每秒限 1 次，不要连续猛调。
- 邮件/日历：首次使用前必须 `mail autodiscover`（传用户邮箱，不知道就问）。`start` 包含当天、`end` **不包含**当天：查 5 月 8 日要写 `start=2026-05-08, end=2026-05-09`。列表不含正文，需要正文再用 `mail get` / `calendar get`。默认时区 China Standard Time，用户在其他时区时传 `timezone`（如 `Egypt Standard Time`）。
- 聊天里的图片/文件是 `/:um_begin{外链|...|提取码...}/:um_end` 形式，这一期不下载，只告诉用户链接。

## 常用流程

1. **会前准备**：`meeting query-list`（type=1，时间取今天到明天）→ 选中会议 `meeting info` + `meeting topic` → 需要时 `meeting topic-materials`，汇总议题、汇报人和材料清单。
2. **邮件速览**：`mail list`（`is-read`=0，按需 `start`）→ 对重要邮件 `mail get` → 按「需要我回复 / 需要我知悉 / 可忽略」分组，给出建议回复要点（不代发）。
3. **今日日程**：`calendar list`（今天到明天）+ `meeting query-list`（type=1）合并去重，按时间排出今天的安排和冲突。
4. **群聊回顾**：`search group` 找到群 → `im query-history-message`（group-id，query-count 50）→ 总结结论、待办和 @我 的事项。

查询失败时如实转述错误（如未登录、WeLink PC 未启动、未执行 autodiscover），并告诉用户去设置页处理；不要换参数反复重试同一个失败。
