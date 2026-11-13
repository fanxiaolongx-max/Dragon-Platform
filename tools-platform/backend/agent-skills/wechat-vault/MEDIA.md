# 微信媒体（@wechat-vault 补充说明）

`W=/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/agent-skills/wechat-vault/scripts/wechat-vault`，实现见 `scripts/wv_media.py`。

账号目录 `A=~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/anshanfan_1f9b`（只读，别改、别删）。`$W media-stats` 看最新统计（2026-11-13：图片 .dat 69,769 个 2.05 GB，其中缩略图 65,796、原图/中图 2,682、高清 846；视频目录 5,747 个 3.9 GB，但 mp4 只有 313 个，其余是封面；文件 107 个 316 MB；语音 1,764 条 25 MB 在库里）。

| 类型 | 消息 local_type | 本地位置 | 怎么对上 |
| --- | --- | --- | --- |
| 图片 | 3 | `$A/msg/attach/<md5(会话username)>/<YYYY-MM>/Img/<M>.dat`，`<M>_h.dat` 高清（点开过才有）、`<M>_t.dat` 缩略图 | `M` = 消息 `packed_info_data` 里那串 32 位十六进制；`YYYY-MM` = 消息本地月份（找不到就扫该会话所有月份）。`Rec/` 子目录是合并转发里的图 |
| 视频 | 43 | `$A/msg/video/<YYYY-MM>/<M>.mp4` + `<M>_thumb.jpg` | 同上，`M` 来自 `packed_info_data`。多数视频没点开过，只有封面，导出时退回封面并在清单注明 |
| 文件 | 49 且 `<appmsg><type>6` | `$A/msg/file/<YYYY-MM>/<title>`，重名会变 `title(1).ext` | 按 `title` + `appattach/totallen` 大小匹配；兜底用 `hardlink.db` 的 `file_hardlink_info_v4.md5 = appmsg/md5`；都没有 = 未下载，预期路径 `msg/file/<消息月份>/<title>` |
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

**读文件内容：`read-file`（实现 `scripts/wv_readfile.py`，只读，不改原文件）**

```bash
$W read-file "会话" [--name 关键词] [--since 7d|2026-11-01] [--until ..] [--pick N] [--list] [--scan 300]
$W read-file "/绝对路径/文件.xlsx"
#   公共选项：--max-chars 20000 --offset 0 --rows 50 --sheet 名称 --ocr auto|on|off --ocr-pages 10 --format text|json
```

- 会话模式：先增量同步，再按文件消息（49/type 6）找，`--name` 不区分大小写匹配文件名，默认取最新的；`--list` 只列出，每条都带绝对路径（没下载的写「预期路径」）。
- 输出头：文件名、类型、大小、来自哪个会话/谁/何时（开罗 UTC+2）、**本地绝对路径**、文字总长和本次显示范围、说明（页数、工作表名、OCR 等）、同会话其他匹配文件。没读完时给出 `--offset N` 续读命令。JSON 字段：`ok kind kind_label path downloaded total_chars offset end truncated next notes text others`。
- 格式：
  | 格式 | 方式 |
  | --- | --- |
  | PDF | `pdftotext -layout`，失败用 pypdf；平均每页不到 20 个字视为扫描件，`pdftoppm -r 200` + `tesseract chi_sim+eng`（前 `--ocr-pages` 页，默认 10） |
  | docx | python-docx，按正文顺序输出段落（标题加 `#`）和表格 |
  | doc / rtf / odt | macOS `textutil -convert txt` |
  | xlsx/xlsm、xls、csv/tsv | openpyxl（只读、取公式计算值）/ xlrd / csv；每个工作表写「N 行 × M 列」（不计空行）+ 前 `--rows` 行，单元格超 80 字截断 |
  | pptx | python-pptx，每页文字、表格、备注 |
  | txt/md/json/xml/html/log/代码等 | 自动识别 UTF-8/GB18030；html 去标签，json 美化 |
  | jpg/png 等图片 | tesseract OCR（`--ocr off` 关闭；看版式用 `view_image`） |
  | 其余（zip/rar/7z/apk/ipa/dmg/exe/音视频/WPS 私有格式/ppt/heic/未知二进制） | 不解析，只给绝对路径和说明；无扩展名的 zip 容器会按内容识别 docx/xlsx/pptx，无扩展名的纯文本按文本读 |
- 没下载：输出「预期路径: `$A/msg/file/<消息月份>/<原文件名>`」+「未下载，请在微信点开下载」，退出码 1。微信下载后真实文件名重名时会变 `名(1).ext`，以下载后再查到的路径为准。
- 缓存：提取结果存 `/Volumes/512G/wechat-local-vault/file-text-cache/<md5(路径|大小|mtime|参数)>.json`（目录 700、文件 600），分页时不重复解析；文件变了自动失效。OCR 临时图在 `media-work/tmp/`，用完删除。
- 依赖：yichen `.venv`（pypdf、python-docx、openpyxl、xlrd、python-pptx），Homebrew poppler（pdftotext/pdfinfo/pdftoppm）、tesseract；中文模型 `/Volumes/512G/models/tessdata/chi_sim.traineddata`（tessdata_fast，环境变量 `WV_TESSDATA` 可改）。
- `history`/`recent`/`latest` 里文件消息显示 `〔文件 · 名 · 大小〕 文件: <绝对路径>（可用 read-file 读取内容）`，没下载显示 `预期路径: ... （未下载，请在微信点开下载）`；JSON 的 `media` 有 `name size size_h path local file expected_path read`。`media --type file` 同样每条给路径和大小。

**在对话里看图（`history` / `recent` / `latest` 自动附带，实现 `scripts/wv_view.py`）**

- 三个命令默认给图片(3)/视频(43)/文件(49 type=6)/语音(34)消息加 `media` 字段（文本输出接在消息后面）：
  `kind`；`local`（本机有没有）；`quality`（`高清原图` = `_h.dat`，`原图/中图` = 无后缀，`仅缩略图` = `_t.dat`；视频为 `原视频`）；`source`（原 .dat）；`view`（可直接显示的 jpg/png）；`file`（视频 mp4 / 文件路径）；`name`/`size`/`seconds`；`note`（缺原图、未解码等说明）。`history --format json` 另给 `viewable_images` 列表。
- 解码缓存：`/Volumes/512G/wechat-local-vault/media-cache/<媒体md5>_<hd|mid|thumb|cover>.<jpg|png|gif|webp>`，目录 700、文件 600，已存在就直接复用（不重复解）。视频封面复制成 `_cover.jpg`。
- 数量：从最新的消息往前，每次最多**新解码** `--media-limit` 张（默认 8，已缓存的不计）；超出的给 `source` 和 note。`--no-media` 关闭；`--with-media`/`--media` 兼容旧写法（默认已开）。
- `media "会话" --view [--view-limit 20]`：同样解码到缓存，给 `view:` 路径。`decode-image x.dat` 默认也输出到缓存目录。

**DragonClaw 怎么显示 / 看图**

- **给用户看**：回复里写 `![说明](/Volumes/512G/wechat-local-vault/media-cache/xxx.png)`（或单独一行的裸路径）。前端 `frontend/js/shared/chat-files.js` 把本机图片路径渲染成 `<img>`，经 `/api/agent-files/raw` 读取；该接口只对本机/管理员开放（其他账号只能读 outputs），隐藏目录和凭据文件一律拒绝。点图可放大、下载。
- **模型自己看**：`view_image` 工具（`backend/models/agent-loop.js`）。原来只能读本人附件/截图/工作目录内文件；现在额外放行 `backend/data/agent-image-roots.json` 的 `roots`（当前只有 media-cache）和环境变量 `TOOLS_AGENT_IMAGE_ROOTS` 里的目录，只限 png/jpg/webp/gif，解析链接后必须仍在目录内，且只在本机/管理员（非团队账号）的对话里生效（`routes/ai.js` 传 `allowExtraImageRoots`）。gemini 系列能直接看图；不能看图的模型由绘图模型识别成文字。
- 只有缩略图（`_t`，几 KB）时也能显示，但很糊；要原图请用户在微信里点开这张图，微信会下载 `_h.dat`/原图，再查一次即可。

**限制**
- 只能拿到本机已下载的东西：大多数图片只有缩略图（`_t`，约 1–10 KB 分辨率很低），视频大多只有封面；要原图/原视频需要用户在微信里点开一次，之后再导出。
- 语音只存在 `media_*.db` 里，微信清理过缓存的就没了；转文字准确率取决于口音和噪音。
- 表情（type 47）、朋友圈图片（`cache/*/Sns`）、公众号图片暂不处理。
- 依赖：yichen `.venv`（pycryptodome、zstandard、pilk）、Homebrew `ffmpeg`、`whisper-cli`。
- 导出的明文图片/语音只在本机；回答时只报数量和路径，不要把图片内容、语音文字整段发出去，除非用户要。

## 相关库表

| 库 | 表结构要点 |
| --- | --- |
| `message/media_0/1.db` | `VoiceInfo(chat_name_id→同库 Name2Id.rowid, create_time, local_id, svr_id, voice_data)`，`voice_data` = `0x02` + `#!SILK_V3` |
| `hardlink/hardlink.db` | `image/file/video_hardlink_info_v4(md5=内容md5, file_name, file_size, dir1, dir2)`，`dir2id.rowid` → 会话 md5 或 `YYYY-MM`；只覆盖一部分文件，作兜底 |
| `message/message_resource.db` | 下载索引 `MessageResourceInfo(chat_id, message_local_id, message_create_time, message_local_type)` / `MessageResourceDetail(message_id, type, size, status)`；媒体命令不依赖它 |

这三类库已加入实时服务监听，`media`/`export-media` 运行前也会自动增量同步一次。


## 附：数据库结构（手写 SQL 时看）

明文库根目录 `/Volumes/512G/wechat-local-vault/decrypted/current/`。表情库（emoticon）没有密钥，未解密。

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

