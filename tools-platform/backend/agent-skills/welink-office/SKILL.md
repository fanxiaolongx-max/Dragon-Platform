---
name: WeLink 办公
name_en: WeLink office
description: 以本人身份使用 WeLink：查联系人/聊天/会议/云空间/邮件/日历，确认后发消息、建会、发邮件
description_en: Use WeLink as yourself: query contacts, chats, meetings, drive, mail and calendar; send, schedule and mail after you confirm
workspace: false
tools: welink-office
order: 8
icon: 💼
---

# WeLink 办公 / WeLink office

目标：通过本机安装的 welink-cli，以**用户本人**的 WeLink 身份办公：找人、回顾聊天、准备会议、整理邮件和日程，并在用户确认后代为发消息、建会、发邮件等。

仅管理员可用；需要管理员先在「全局设置 › 频道对接 › WeLink › 个人身份（welink-cli）」检测安装、扫码登录并启用，且本机 WeLink PC 保持登录。结果以工具返回为准，不要编造人员、消息、会议或邮件。

## 两个工具

- `welink_query`：查询，以及下载（云空间文件 `onebox file-download`、分享外链 `onebox file-share-link-download`、邮件附件 `mail attachment`）。下载目录由平台指定，**不要传 output / path**；返回里有保存位置。
- `welink_action`：会改变外部状态的操作，需管理员开启「允许写操作」。**每次调用都会在对话里弹出审批卡，用户点「允许」才执行**；拒绝或超时就是没执行。
  - 消息：`im send-to-user`、`im send-to-group`（text / image / file 至少一个）、`im create-group`、`im add-group-member`、`im recall-message`
  - 会议：`meeting create`、`meeting update`、`meeting cancel`、`meeting topic-create`、`meeting topic-update`、`meeting topic-delete`
  - 云空间：`onebox file-upload`（用 `file` 传本机完整路径）、`file-copy`、`file-move`、`file-rename`、`file-remove`、`folder-new`、`folder-rename`、`folder-remove`、`file-share-link-get`、`file-share-link-edit`、`file-share-link-remove`
  - 邮件：`mail send`、`mail reply`、`mail reply-all`、`mail forward`、`mail move`
  - 日历：`calendar create`
  - 联系人：`contact add_favorite`、`contact del_favorite`（用 `accounts`）

## 写操作守则

1. 只做用户明确要求的事；一次调用只做一件事，不要批量连发。
2. 收件人、成员、与会人必须是查到的真实账号 / 邮箱：先 `search person`（必要时 `contact detail`）拿到 `w3account` / 邮箱；同名多人或查不到时先问用户，不要猜。
3. 发消息、发邮件的正文按用户意思写好再调用；审批卡会原样展示给用户看，用户允许后才发出。
4. 工具返回成功前，不要说「已发送 / 已创建 / 已删除」；被拒绝时如实说未执行，可以询问要不要修改后再试。
5. 本期不支持：`config` 系列命令和版本检查，请让用户在终端自己执行。

## 调用约定

`welink_query` 的参数名与 welink-cli 一致（不带 `--`），例如：

- 找人：`{"command":"search person","options":{"text":"张三","page-size":10}}`，结果里 `w3account` 是账号、`welinkId` 是消息 ID。
- 聊天记录：`{"command":"im query-history-message","options":{"user-account":"a00123456","query-count":30}}`；群聊用 `group-id`（二选一）。先用 `im query-recent-conversation` 或 `search group` 拿到群 ID。
- 联系人详情：`{"command":"contact detail","accounts":["welinkId1","welinkId2"]}`。
- 会议列表：`meeting query-list` 的 `meeting-start-time` / `meeting-end-time` 是 **13 位毫秒时间戳**，`type`：0 公开、1 待参加（默认）、2 已结束、3 我预定、4 所有、5 我管理；`size` ≤ 30。平台已内置默认值（默认查今天待参加、按时间升序、第 1 页 10 条），查今天待参加会议直接调用即可，无需必填参数。
- 建会：`{"command":"meeting create","options":{"subject":"测试会议","start-time":1777100400000,"end-time":1777102200000,"meeting-user-list":["a00123456","b00234567"]}}`。开始时间必须在未来且 31 天内，时长 15 分钟 ~ 7 天；与会人用工号。只能修改 / 取消通过 CLI 创建的会议。
- 发消息：`{"command":"im send-to-user","options":{"receiver":"a00123456","text":"…"}}`；群用 `im send-to-group` + `group-id`。
- 发邮件：`{"command":"mail send","options":{"to":["a@huawei.com"],"cc":["b@huawei.com"],"subject":"…","body":"…"}}`；`html: true` 时 body 写 HTML。回复 / 转发用 `mail reply` / `reply-all` / `forward` + `item-id`。
- 建日程：`{"command":"calendar create","options":{"subject":"…","start":"2026-10-28T14:00:00","end":"2026-10-28T15:00:00","attendee":["a@huawei.com"]}}`；填了 attendee 会自动发邀请。注意这和 `meeting create`（WeLink 会议）是两回事：用户说「约个会议 / 拉个会」默认用 `meeting create`，说「日程 / 日历 / Outlook 邀请」用 `calendar create`。
- 会议 ID：所有 `meeting-id` 都是会议主键（来自 query-list 的 meetingId），**不是视频会议号**。
- 会议搜索：`{"command":"meeting fuzzy-search","options":{"result-type":"meeting","limit":10,"offset":0},"search":[{"type":"subject","content":"周会"}]}`，时间范围再加 `startTime` / `endTime` 条件（毫秒时间戳）。
- 云空间：个人空间的 `space-id` 来自 `onebox user-info` 的 `cloudUserId`；根目录 `folder-id` 为 0；团队空间/群空间的 space-id 只能从用户提供的 onebox 网页链接里解析（`#teamspaceFile/<页>/<folder-id>/<space-id>`）。云空间接口每秒限 1 次，不要连续猛调。
- 邮件/日历：直接查即可，CLI 提示未发现邮箱服务器时平台会自动 `mail autodiscover` 并重试；自动失败时再问用户邮箱手动执行。`start` 包含当天、`end` **不包含**当天：查 5 月 8 日要写 `start=2026-05-08, end=2026-05-09`。列表不含正文，需要正文再用 `mail get` / `calendar get`。默认时区 China Standard Time，用户在其他时区时传 `timezone`（如 `Egypt Standard Time`）。
- 聊天里的图片/文件是 `/:um_begin{外链|类型|大小|文件名|0|...;提取码|...}/:um_end` 形式：第 1 段是外链，倒数第二组分号分隔的最后一段是提取码。用户要文件时用 `onebox file-share-link-download`（`link` + `plain-access-code`）下载。

## 常用流程

1. **会前准备**：`meeting query-list`（type=1，时间取今天到明天）→ 选中会议 `meeting info` + `meeting topic` → 需要时 `meeting topic-materials`，汇总议题、汇报人和材料清单。
2. **邮件速览**：`mail list`（`is-read`=0，按需 `start`）→ 对重要邮件 `mail get` → 按「需要我回复 / 需要我知悉 / 可忽略」分组，给出建议回复要点（不代发）。
3. **今日日程**：`calendar list`（今天到明天）+ `meeting query-list`（type=1）合并去重，按时间排出今天的安排和冲突；**务必在最终回答中列出清晰的时间、主题、地点和参会人清单**，严禁留空或只回复已查询。
4. **群聊回顾**：`search group` 找到群 → `im query-history-message`（group-id，query-count 50）→ 总结结论、待办和 @我 的事项。
5. **约会议**：`search person` 确认每位与会人的工号 → 按用户给的时间算出毫秒时间戳 → `welink_action` `meeting create`（审批）→ 成功后告诉用户会议主题、时间、与会人和返回的 meetingId；需要议题再 `meeting topic-create`。
6. **代发消息 / 邮件**：查到对方账号或邮箱 → 写好内容 → `welink_action`（审批）→ 用户允许并成功后再确认已发送。

查询失败时如实转述错误（如未登录、WeLink PC 未启动、未执行 autodiscover），并告诉用户去设置页处理；不要换参数反复重试同一个失败。
