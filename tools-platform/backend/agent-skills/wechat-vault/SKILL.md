---
name: 微信本地库查询
name_en: WeChat Vault
description: 只读查询本机微信 4.x 解密库：最新消息、最近 N 分钟新消息、未读、按人/群看记录、关键词搜索、导出；管理实时解密服务
description_en: Read-only queries over the local decrypted WeChat 4.x databases (latest, recent, unread, history, search, export) and the realtime decrypt service
workspace: true
order: 20
icon: 💬
---

# 微信本地库查询 / WeChat Vault

目标：在用户自己的 Mac 上只读查询已解密的微信聊天库，并维护实时增量解密服务。**不发消息、不登录、不联网、不重新抓密钥。**

统一入口（绝对路径，任何工作目录都能用）：

```bash
W=/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/agent-skills/wechat-vault/scripts/wechat-vault
```

## 1. 常用查询（先用这些，不要自己拼 SQL）

| 需求 | 命令 |
| --- | --- |
| 最近 N 分钟新消息（会话、发送人、开罗时间、内容） | `$W recent 10`（加 `--format json` 得结构化） |
| 库里最新消息时间 + 最近会话 | `$W latest --limit 10` |
| 未读会话 / 最近会话 | `$W unread --limit 30` / `$W sessions --limit 20` |
| 某人/某群聊天记录 | `$W history "Sanyli" --limit 50 --format text`，可加 `--start-time "2026-11-12 20:00"` |
| 关键词搜索（全局或指定会话） | `$W search "配送费" --format text`，`--chat "兰小梅"` 限定会话 |
| 导出某个聊天 | `$W export "兰小梅" --start-time 2026-10-01 --limit 5000` → `/Volumes/512G/wechat-local-vault/exports/` |
| 联系人/群/群成员/统计 | `$W contacts --query 关键字`、`$W members 群名`、`$W stats 会话名` |
| 漏回/被@/转账红包 | `$W pending --since 48h --format text` |

会话名可写备注、昵称或微信号，模糊匹配取第一个；有歧义时先 `contacts --query` 确认。所有时间按 Mac 本地时区（开罗 UTC+2）。`recent`/`latest` 会先顺手做一次增量同步。

## 2. 密钥在哪里（Dragon 保险箱）

- 存储：平台保险箱 `backend/data/vault/vault.db`（AES-256-GCM，主密钥 `backend/data/vault/master.key`，600 权限，不进全局备份）。
- 归属账号 `admin`；站点 `https://wechat-db.local`（虚拟站点，已关闭自动填充/自动提交）。
- 每个数据库一条：用户名 = `<wxid>/<库相对路径>`，例如 `anshanfan_1f9b/message/message_0.db`、`anshanfan_1f9b/session/session.db`；密码 = 64 位十六进制 SQLCipher 原始密钥；备注 `微信库密钥 <路径>`。共 25 条。
- 读取：`node scripts/vault_keys.js export`（stdout 输出 `{相对路径: 密钥}` JSON，只允许直接管道给解密进程）。实时服务启动时就是这样取的；取不到才回退 `~/.config/wechat-keys.json`。
- 你可以用：`$W keys list`（只列名字）、`$W keys verify`（与 `~/.config/wechat-keys.json` 逐条比对）。**禁止**把密钥打印到对话、日志或文件；不要调用 `export`/`export-file` 给用户看。

## 3. 数据位置与库结构

- 微信原始库（加密，只读）：`~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/anshanfan_1f9b/db_storage/`
- 明文库：`/Volumes/512G/wechat-local-vault/decrypted/current/<相对路径>`（含聊天明文，只在本机）
- 配置：`~/.config/wechat-local-vault.json`（`vault_dir`/`decrypted_dir` 必须指向 `/Volumes/512G/wechat-local-vault`）

| 库 | 内容与表结构要点 |
| --- | --- |
| `message/message_0..N.db` | 按时间分片的聊天记录，最新分片编号最大（当前 message_10）。每个会话一张 `Msg_<md5(username)>`：`local_id, server_id, local_type`（低 32 位为类型：1 文本 3 图片 34 语音 43 视频 47 表情 49 链接/文件/引用 10000 系统）`, real_sender_id`（→ 同库 `Name2Id.rowid`）`, create_time`（Unix 秒）`, message_content`（文本或 zstd 压缩 BLOB，`WCDB_CT_message_content=4` 表示压缩）`, packed_info_data`。群消息正文可能带 `wxid:\n` 前缀 |
| `message/biz_message_0.db` | 公众号/服务号消息，结构同上 |
| `message/message_fts.db` | 微信自带全文索引（FTS，较大，实时服务不跟踪） |
| `message/message_resource.db` | 图片/文件等资源索引 `MessageResourceInfo`/`Detail` |
| `message/media_0/1.db` | 语音 `VoiceInfo` |
| `session/session.db` | `SessionTable`：`username, unread_count, summary`（zstd）`, last_timestamp, last_msg_type, last_msg_sender, last_sender_display_name`——查最新/未读从这里开始 |
| `contact/contact.db` | `contact`：`username, alias, remark, nick_name, local_type, ...`；`chat_room`、`chatroom_member` 群信息 |
| `contact/contact_fts.db` | 联系人/群成员全文索引 |
| `sns/sns.db` | 朋友圈 `SnsTimeLine`（XML） |
| `favorite/favorite.db` | 收藏 `fav_db_item` |
| `general/general.db` | 撤回 `revokemessage`、转账 `transferTable`、红包 `redEnvelopeTable`、好友申请 `FMessageTable` |
| `hardlink/hardlink.db` | 图片/文件/视频本地路径索引 |
| `head_image/head_image.db` | 头像缓存 |

表情库（emoticon）目前没有密钥，未解密。手写 SQL 时用 `sqlite3 "file:<库>?mode=ro"`，会话表名 = `Msg_` + md5(username)。

## 4. 实时解密服务（pm2：`wechat-realtime`）

- 监听 `message_*.db`、`session.db`、`contact.db` 及其 `-wal`（FSEvents），去抖 1.5 秒，只解密 IV 变化的页并合并 WAL 已提交帧，原位写入明文库（写时持 SQLite 排它锁）。另每 60 秒兜底检查一次。
- `$W status`（状态、CPU/内存、最新消息时间差）、`$W logs 50`、`$W restart`、`$W sync`（手动增量一次）、`$W resync`（丢弃页状态整库重建）。
- 原生命令：`pm2 describe wechat-realtime`、`pm2 restart wechat-realtime`、`pm2 logs wechat-realtime`。配置 `scripts/ecosystem.config.cjs`；日志 `/Volumes/512G/wechat-local-vault/realtime/logs/`；状态 `/Volumes/512G/wechat-local-vault/realtime/status.json`。

## 5. 常见故障

1. **日志 `Operation not permitted`**：pm2 的 node（`/Users/dragon/.hermes/node/bin/node`）没有读微信容器的权限。请用户在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」添加该文件后执行 `pm2 restart wechat-realtime`（不行再 `pm2 update`）。
2. **latest 相差很久**：先看微信本身有没有新写入（原始库 mtime）；微信空闲时可能几分钟才落盘。再看 `$W status` 与日志。
3. **解出来是乱码 / `file is not a database`**：密钥失效（微信重装或换号）。需要用户同意后另行重新抓密钥，再 `node scripts/vault_keys.js import` 更新保险箱并 `pm2 restart wechat-realtime`。本技能不负责抓密钥。
4. **vault_dir 被改**：yichen 的 `decrypt_all_dbs.py` 每次运行都会把配置改回 `~/Library/Application Support/...`。用完把 `~/.config/wechat-local-vault.json` 的 `vault_dir`/`decrypted_dir` 改回 512G；实时服务固定写 512G。用旧脚本整库解密后，执行 `$W resync`。
5. **`database is locked`/偶发 malformed**：服务正在写页，重试一次即可（`recent/latest` 已自动重试）。

## 6. 隐私

- 明文库和导出文件只在本机，不上传、不同步、不发给第三方；回答时只摘录用户要的内容，不整段倾倒聊天。
- 不输出密钥、wxid 等内部标识（工具默认隐藏）；不得把密钥写进 Skill、日志或回复。
- 本技能只读：不发微信、不加好友、不改微信数据；用户要求发消息时说明做不到。
