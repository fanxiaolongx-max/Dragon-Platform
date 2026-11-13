---
name: 微信本地库查询
name_en: WeChat Vault
description: 只读查询本机微信 4.x 解密库：最新消息、最近 N 分钟新消息、未读、按人/群看记录（图片自动解码、可在对话里直接显示）、关键词搜索、导出；按会话列出/导出图片、视频、文件、语音（转 mp3/本地转文字）；管理实时解密服务
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
| 最近 N 分钟新消息 | `$W recent 10`（`--format json` 得结构化） |
| 库里最新消息时间 + 最近会话 | `$W latest --limit 10` |
| 未读 / 最近会话 | `$W unread --limit 30` / `$W sessions --limit 20` |
| 某人/某群聊天记录（含图片） | `$W history "Sanyli" --limit 20`，可加 `--start-time "2026-11-12 20:00"` |
| 关键词搜索 | `$W search "配送费" --format text`，`--chat "兰小梅"` 限定会话 |
| 导出聊天 | `$W export "兰小梅" --start-time 2026-10-01 --limit 5000` |
| 联系人/群成员/统计 | `$W contacts --query 关键字`、`$W members 群名`、`$W stats 会话名` |
| 漏回/被@/转账红包 | `$W pending --since 48h --format text` |
| 会话里的图片/视频/文件/语音 | `$W media "兰小梅" --type image --since 48h --view` |
| 导出媒体、语音转文字 | `$W export-media "兰小梅" --type image --limit 20`；`$W voice-mp3 "Sanyli" --limit 5 --transcribe` |

会话名可写备注、昵称或微信号，模糊匹配取第一个；有歧义先 `contacts --query`。时间都是开罗 UTC+2。`recent`/`latest`/`history` 会先做一次增量同步。

## 2. 用户问图片/照片/截图/视频/文件/语音时（必须照做）

1. 跑 `$W history "会话" --limit 20`（或 `recent`/`latest`）。图片消息后面会带 `〔图片 · 高清原图〕 查看: /Volumes/512G/wechat-local-vault/media-cache/<md5>_hd.png`（已自动解码，默认每次最多新解 8 张，`--media-limit 30` 可加大）。只要图片、要更早的：`$W media "会话" --type image --since 7d --view`。
2. **展示给用户**：回复里写 `![Sanyli 11:22 发的图](/Volumes/512G/wechat-local-vault/media-cache/<md5>_hd.png)`，网页会直接显示，点开可放大。路径原样照抄，不要放进代码块。
3. **自己要看懂内容**（用户问"图里是什么/写了啥"）：调用 `view_image`，path 填上面的完整路径。
4. 「仅缩略图」：照样展示，并说明很模糊，要原图请用户在微信里点开这张图，再重新查。「本机没有」：请用户在微信里点开/下载后再查。
5. 视频：`查看:` 是封面图（同样用 `![]()` 显示），`文件:` 是 mp4（写出路径，网页给下载卡片）；只有封面时提醒在微信里播放一次。文件：写出 `文件:` 路径。语音：`$W voice-mp3 "会话" --limit 3 --transcribe`。
6. 有 `查看:` 路径时**不要说看不到图片**；JSON 里对应字段是 `media.view`。

示例：「查看Sanyli消息与图片」→ `$W history "Sanyli" --limit 20` → 摘要文字 + 每张图一行 `![..](查看路径)`。「Sanyli 昨天发的照片」→ `$W media "Sanyli" --type image --since 1d --view`。「最近谁发了图片」→ `$W recent 60`。细节见 `MEDIA.md`。

## 3. 密钥在哪里（Dragon 保险箱）

- 存储：平台保险箱 `backend/data/vault/vault.db`（AES-256-GCM，主密钥 `backend/data/vault/master.key`，600 权限，不进全局备份）。
- 归属账号 `admin`；站点 `https://wechat-db.local`（虚拟站点，已关闭自动填充/自动提交）。
- 每个数据库一条：用户名 = `<wxid>/<库相对路径>`，例如 `anshanfan_1f9b/message/message_0.db`、`anshanfan_1f9b/session/session.db`；密码 = 64 位十六进制 SQLCipher 原始密钥；备注 `微信库密钥 <路径>`。共 25 条。
- 读取：`node scripts/vault_keys.js export`（stdout 输出 `{相对路径: 密钥}` JSON，只允许直接管道给解密进程）。实时服务启动时就是这样取的；取不到才回退 `~/.config/wechat-keys.json`。
- 你可以用：`$W keys list`（只列名字）、`$W keys verify`（与 `~/.config/wechat-keys.json` 逐条比对）。**禁止**把密钥打印到对话、日志或文件；不要调用 `export`/`export-file` 给用户看。

## 4. 数据位置与库结构

- 微信原始库（加密，只读）：`~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/anshanfan_1f9b/db_storage/`
- 明文库：`/Volumes/512G/wechat-local-vault/decrypted/current/<相对路径>`（含聊天明文，只在本机）
- 配置：`~/.config/wechat-local-vault.json`（`vault_dir`/`decrypted_dir` 必须指向 `/Volumes/512G/wechat-local-vault`）

主要库：`message/message_0..N.db`（聊天，按时间分片，编号最大最新；每会话一张 `Msg_<md5(username)>`）、`session/session.db`（最新/未读）、`contact/contact.db`（联系人/群）、`hardlink`/`media_*`/`message_resource`（媒体）。各库表结构见 `MEDIA.md` 末尾。手写 SQL 时用 `sqlite3 "file:<库>?mode=ro"`，会话表名 = `Msg_` + md5(username)。

## 5. 实时解密服务（pm2：`wechat-realtime`）

- 监听 `message_*.db`、`session.db`、`contact.db`，以及给媒体命令用的 `media_*.db`、`message_resource.db`、`hardlink.db`（共 17 个库）及其 `-wal`（FSEvents），去抖 1.5 秒，只解密 IV 变化的页并合并 WAL 已提交帧，原位写入明文库（写时持 SQLite 排它锁）。另每 60 秒兜底检查一次。
- `$W status`（状态、CPU/内存、最新消息时间差）、`$W logs 50`、`$W restart`、`$W sync`（手动增量一次）、`$W resync`（丢弃页状态整库重建）。
- 原生命令：`pm2 describe wechat-realtime`、`pm2 restart wechat-realtime`、`pm2 logs wechat-realtime`。配置 `scripts/ecosystem.config.cjs`；日志 `/Volumes/512G/wechat-local-vault/realtime/logs/`；状态 `/Volumes/512G/wechat-local-vault/realtime/status.json`。

## 6. 常见故障

1. **日志 `Operation not permitted`**：pm2 的 node（`/Users/dragon/.hermes/node/bin/node`）没有读微信容器的权限。请用户在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」添加该文件后执行 `pm2 restart wechat-realtime`（不行再 `pm2 update`）。
2. **latest 相差很久**：先看微信本身有没有新写入（原始库 mtime）；微信空闲时可能几分钟才落盘。再看 `$W status` 与日志。
3. **解出来是乱码 / `file is not a database`**：密钥失效（微信重装或换号）。需要用户同意后另行重新抓密钥，再 `node scripts/vault_keys.js import` 更新保险箱并 `pm2 restart wechat-realtime`。本技能不负责抓密钥。
4. **vault_dir 被改**：yichen 的 `decrypt_all_dbs.py` 每次运行都会把配置改回 `~/Library/Application Support/...`。用完把 `~/.config/wechat-local-vault.json` 的 `vault_dir`/`decrypted_dir` 改回 512G；实时服务固定写 512G。用旧脚本整库解密后，执行 `$W resync`。
5. **`database is locked`/偶发 malformed**：服务正在写页，重试一次即可（`recent/latest` 已自动重试）。

## 7. 隐私

- 明文库和导出文件只在本机，不上传、不同步、不发给第三方；回答时只摘录用户要的内容，不整段倾倒聊天。
- 不输出密钥、wxid 等内部标识（工具默认隐藏）；不得把密钥写进 Skill、日志或回复。
- 本技能只读：不发微信、不加好友、不改微信数据；用户要求发消息时说明做不到。

## 8. 媒体细节

`MEDIA.md`（同目录）：消息→文件对应规则、.dat 格式、图片密钥（保险箱 `anshanfan_1f9b/image_aes`、`image_xor`，`$W image-key status`；解不开时 `$W image-key derive --save`，不要打印密钥）、缓存、导出与限制。
