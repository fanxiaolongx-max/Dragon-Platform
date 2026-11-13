---
name: 微信本地库查询
name_en: WeChat Vault
description: 只读查询本机微信 4.x 解密库：最新消息、最近 N 分钟新消息、未读、按人/群看记录、关键词搜索、导出；按会话列出/导出图片（解码 .dat）、视频、文件、语音（转 mp3/本地转文字）；管理实时解密服务
description_en: Read-only queries over the local decrypted WeChat 4.x databases (latest, recent, unread, history, search, export), media listing/export (image .dat decode, video, file, voice to mp3/local transcript) and the realtime decrypt service
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
| 某会话的图片/视频/文件/语音及本地路径 | `$W media "兰小梅" --type image --since 48h`（`--type` 可重复；`--format json`） |
| 导出媒体（图片解码、语音转 mp3） | `$W export-media "兰小梅" [目标目录] --type image --limit 20`，语音 `$W voice-mp3 "Sanyli" --limit 5 [--transcribe]` |
| 解一张图片 .dat | `$W decode-image <路径.dat> [--out 目录]` |

媒体细节见第 7 节。

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
| `message/message_resource.db` | 资源下载索引 `MessageResourceInfo(chat_id, message_local_id, message_create_time, message_local_type)` / `MessageResourceDetail(message_id, type, size, status)`；媒体命令不依赖它 |
| `message/media_0/1.db` | 语音 `VoiceInfo(chat_name_id→同库 Name2Id.rowid, create_time, local_id, svr_id, voice_data)`，`voice_data` = `0x02` + `#!SILK_V3` |
| `session/session.db` | `SessionTable`：`username, unread_count, summary`（zstd）`, last_timestamp, last_msg_type, last_msg_sender, last_sender_display_name`——查最新/未读从这里开始 |
| `contact/contact.db` | `contact`：`username, alias, remark, nick_name, local_type, ...`；`chat_room`、`chatroom_member` 群信息 |
| `contact/contact_fts.db` | 联系人/群成员全文索引 |
| `sns/sns.db` | 朋友圈 `SnsTimeLine`（XML） |
| `favorite/favorite.db` | 收藏 `fav_db_item` |
| `general/general.db` | 撤回 `revokemessage`、转账 `transferTable`、红包 `redEnvelopeTable`、好友申请 `FMessageTable` |
| `hardlink/hardlink.db` | `image/file/video_hardlink_info_v4(md5=内容md5, file_name, file_size, dir1, dir2)`，`dir2id.rowid` → 会话 md5 或 `YYYY-MM`；只覆盖一部分文件，作兜底 |
| `head_image/head_image.db` | 头像缓存 |

表情库（emoticon）目前没有密钥，未解密。手写 SQL 时用 `sqlite3 "file:<库>?mode=ro"`，会话表名 = `Msg_` + md5(username)。

## 4. 实时解密服务（pm2：`wechat-realtime`）

- 监听 `message_*.db`、`session.db`、`contact.db`，以及给媒体命令用的 `media_*.db`、`message_resource.db`、`hardlink.db`（共 17 个库）及其 `-wal`（FSEvents），去抖 1.5 秒，只解密 IV 变化的页并合并 WAL 已提交帧，原位写入明文库（写时持 SQLite 排它锁）。另每 60 秒兜底检查一次。
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

## 7. 媒体（图片 / 视频 / 文件 / 语音）

账号目录 `A=~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/anshanfan_1f9b`（只读，别改、别删）。`$W media-stats` 看最新统计（2026-11-13：图片 .dat 69,769 个 2.05 GB，其中缩略图 65,796、原图/中图 2,682、高清 846；视频目录 5,747 个 3.9 GB，但 mp4 只有 313 个，其余是封面；文件 107 个 316 MB；语音 1,764 条 25 MB 在库里）。

| 类型 | 消息 local_type | 本地位置 | 怎么对上 |
| --- | --- | --- | --- |
| 图片 | 3 | `$A/msg/attach/<md5(会话username)>/<YYYY-MM>/Img/<M>.dat`，`<M>_h.dat` 高清（点开过才有）、`<M>_t.dat` 缩略图 | `M` = 消息 `packed_info_data` 里那串 32 位十六进制；`YYYY-MM` = 消息本地月份（找不到就扫该会话所有月份）。`Rec/` 子目录是合并转发里的图 |
| 视频 | 43 | `$A/msg/video/<YYYY-MM>/<M>.mp4` + `<M>_thumb.jpg` | 同上，`M` 来自 `packed_info_data`。多数视频没点开过，只有封面，导出时退回封面并在清单注明 |
| 文件 | 49 且 `<appmsg><type>6` | `$A/msg/file/<YYYY-MM>/<title>`，重名会变 `title(1).ext` | 按 `title` + `appattach/totallen` 大小匹配；兜底用 `hardlink.db` 的 `file_hardlink_info_v4.md5 = appmsg/md5` |
| 语音 | 34 | 不在磁盘，在 `message/media_*.db` 的 `VoiceInfo.voice_data`（SILK） | `Name2Id.user_name = 会话` 且 `local_id`、`create_time` 与消息一致（兜底 `svr_id`） |

**图片 .dat 格式**：本账号全部是 4.x **V2**（头 `07 08 56 32 08 07`）：头 15 字节里含 AES 段长度和 XOR 段长度；前段 AES-128-ECB（PKCS7），中段明文，尾段单字节 XOR。也兼容 V1（固定 AES 密钥 `md5("0")[:16]`）和老版整文件 XOR（用 jpg/png/gif 文件头推算 XOR 字节）。解出 `wxgf` 的是微信 HEVC 图，自动用 ffmpeg 转 jpg。

**图片密钥（不需要抓内存）**：`$A/../../app_data/net/kvcomm/` 下有 `key_<code>_*` 文件，AES key = `md5(f"{code}{微信号}")[:16]`（微信号是账号目录去掉 `_1f9b` 后缀），XOR = `code & 0xFF`。已存入 Dragon 保险箱（站点 `https://wechat-db.local`，归属 `admin`）：
- `anshanfan_1f9b/image_aes`：16 位字符串 AES 密钥
- `anshanfan_1f9b/image_xor`：XOR 字节（十进制）
读取顺序：`vault_keys.js image-export`（只管道给 `wv_media.py`）→ 失败时现场从 kvcomm 推导（不保存）。`$W image-key status` 只看条目在不在；微信重装/换号后图片解不开时 `$W image-key derive --save` 重新推导并写回保险箱（会先用 40 个样本验证）。数据库密钥的 `export`/`verify` 只处理 `.db` 条目，不会混入图片密钥。

**命令**

```bash
$W media "会话" [--type image|video|file|voice]... [--since 48h|7d|"2026-11-01"] [--until ..] [--limit 50] [--format json]
$W export-media "会话" [目标目录] [同上过滤] [--no-thumb] [--transcribe]
$W voice-mp3 "会话" [目标目录] [--limit N] [--transcribe]
$W decode-image <xxx.dat> [--out 目录或文件]
$W image-key status | $W image-key derive --save
$W media-stats
```

- `media` 列出：时间（开罗 UTC+2）、发送人、类型、文件名/秒数、本地是否存在、全部候选路径（图片分 hd/mid/thumb）。
- `export-media` 默认目录 `/Volumes/512G/wechat-local-vault/exports/media/<会话名>/`，按 `image/ video/ file/ voice/` 分子目录，文件名 `YYYYmmdd-HHMMSS_<local_id>`；图片取最高清那份解码成 jpg/png（`--no-thumb` 跳过只有缩略图的）；视频复制 mp4，没下载的复制封面；文件原样复制；语音 SILK → PCM（pilk）→ mp3（ffmpeg，24 kHz 64 kbps）。目录 700、文件 600，`manifest.json` 记录每条结果，同目录多次导出会合并。
- `--transcribe`：本地 whisper.cpp（`/opt/homebrew/bin/whisper-cli`，模型 `/Volumes/512G/models/whisper/ggml-large-v3-turbo-q5_0.bin`，中文），文字写在同名 `.txt`。完全离线；一条几秒的语音约 10 秒。
- 每次 `media`/`export-media` 前自动做一次增量同步，保证 hardlink/语音库是最新的。

**限制**
- 只能拿到本机已下载的东西：大多数图片只有缩略图（`_t`，约 1–10 KB 分辨率很低），视频大多只有封面；要原图/原视频需要用户在微信里点开一次，之后再导出。
- 语音只存在 `media_*.db` 里，微信清理过缓存的就没了；转文字准确率取决于口音和噪音。
- 表情（type 47）、朋友圈图片（`cache/*/Sns`）、公众号图片暂不处理。
- 依赖：yichen `.venv`（pycryptodome、zstandard、pilk）、Homebrew `ffmpeg`、`whisper-cli`。
- 导出的明文图片/语音只在本机；回答时只报数量和路径，不要把图片内容、语音文字整段发出去，除非用户要。
