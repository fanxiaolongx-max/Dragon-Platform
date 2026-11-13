#!/usr/bin/env python3
"""给聊天记录里的图片/视频/文件/语音消息附上本地文件信息，并把图片解码成可直接查看的 jpg/png。

- 解码结果缓存在 /Volumes/512G/wechat-local-vault/media-cache/（目录 700、文件 600），
  文件名 = 消息媒体 md5 + 清晰度后缀（_hd / _mid / _thumb / _cover），已解过的直接复用。
- 每次最多解码 media_limit 张（默认 8，从最新的消息开始），其余只给出状态和原始 .dat 路径。
- 只读微信目录和明文库；不打印密钥。
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import wv_media as wm

vc = wm.vc
CACHE = wm.VAULT / "media-cache"
QUALITY = {"hd": "高清原图", "mid": "原图/中图", "thumb": "仅缩略图"}
LABEL = {3: "图片", 43: "视频", 49: "文件", 34: "语音"}
_ACCT: Path | None = None


def acct() -> Path:
    global _ACCT
    if _ACCT is None:
        _ACCT = wm.account_dir()
    return _ACCT


def _cached(stem: str) -> Path | None:
    for ext in ("jpg", "png", "gif", "webp"):
        p = CACHE / f"{stem}.{ext}"
        if p.is_file() and p.stat().st_size > 0:
            return p
    return None


def view_image(dat: str, md5: str, label: str) -> tuple[str | None, bool, str | None]:
    """返回 (可查看路径, 是否本次新解码, 错误)。"""
    stem = f"{md5}_{label}"
    hit = _cached(stem)
    if hit:
        return str(hit), False, None
    wm.secure_dir(CACHE)
    try:
        return str(wm.decode_image(Path(dat), CACHE / stem)), True, None
    except Exception as e:  # noqa: BLE001
        return None, False, f"解码失败：{str(e)[:80]}"


def copy_cover(src: str, md5: str) -> str | None:
    stem = f"{md5}_cover"
    hit = _cached(stem)
    if hit:
        return str(hit)
    try:
        wm.secure_dir(CACHE)
        dst = CACHE / f"{stem}.jpg"
        shutil.copyfile(src, dst)
        os.chmod(dst, 0o600)
        return str(dst)
    except OSError:
        return None


def _raw(dec: Path, row: dict):
    db = dec / "message" / row["db"]
    with vc.connect(db) as con:
        cols = vc.message_columns(con, row["table"])
        flag = cols.get("compression_flag") or "NULL"
        r = con.execute(f"SELECT packed_info_data, message_content, compress_content, {flag} AS cf FROM [{row['table']}] WHERE local_id=?",
                        (row["local_id"],)).fetchone()
    if not r:
        return None, ""
    content = vc.decode_value(r["message_content"], r["cf"]) or vc.decode_value(r["compress_content"], r["cf"])
    return r["packed_info_data"], vc.parse_sender_prefix(content)[1]


def describe(dec: Path, chat_user: str, row: dict, budget: list[int], hardlink) -> dict | None:
    base = int(row.get("local_type") or 0) & 0xFFFFFFFF
    if base not in LABEL or not row.get("db") or not row.get("table"):
        return None
    try:
        packed, content = _raw(dec, row)
    except Exception as e:  # noqa: BLE001
        return {"kind": LABEL[base], "local": False, "note": f"读取消息失败：{str(e)[:60]}"}
    ts = int(row.get("timestamp") or 0)
    md5 = wm._packed_md5(packed)
    if base == 3:
        files = wm.image_files(acct(), chat_user, ts, md5)
        info = {"kind": "图片", "local": bool(files)}
        if not files:
            info["note"] = "本机没有这张图（没下载或已清理），请在微信里点开它后再查"
            return info
        label = next(k for k in ("hd", "mid", "thumb") if k in files)
        info.update(quality=QUALITY[label], source=files[label])
        if label == "thumb":
            info["note"] = "本机只有缩略图（很糊）；要看原图请在微信里点开这张图，再重新查询"
        if budget[0] > 0 or _cached(f"{md5}_{label}"):
            path, fresh, err = view_image(files[label], md5, label)
            if fresh:
                budget[0] -= 1
            if path:
                info["view"] = path
            elif err:
                info["note"] = err
        else:
            info["note"] = (info.get("note", "") + "；" if info.get("note") else "") + "超过本次解码数量，未解码（加大 --media-limit 或用 decode-image）"
        return info
    if base == 43:
        files = wm.video_files(acct(), ts, md5)
        info = {"kind": "视频", "local": "video" in files}
        if "video" in files:
            info.update(quality="原视频", file=files["video"])
        else:
            info["note"] = "本机只有封面，要看视频请在微信里点开播放一次" if files else "本机没有这个视频"
        if "thumb" in files:
            cover = copy_cover(files["thumb"], md5)
            if cover:
                info["view"] = cover
        return info
    if base == 49:
        app = wm._appmsg(content)
        if not app:
            return None  # 链接、引用等，不是文件
        p = wm.file_path(acct(), ts, app, hardlink)
        info = {"kind": "文件", "name": app["title"], "size": app["size"], "local": bool(p)}
        if p:
            info["file"] = p
        else:
            info["note"] = "本机没有这个文件，请在微信里下载后再查"
        return info
    m = wm.re.search(r'voicelength="(\d+)"', content)
    return {"kind": "语音", "seconds": round(int(m.group(1)) / 1000, 1) if m else None, "local": True,
            "note": "语音在库里，用 voice-mp3 会话 --limit N [--transcribe] 转 mp3/文字"}


def enrich(dec: Path, chat_user: str, rows: list[dict], limit: int, budget: list[int] | None = None) -> list[int]:
    """原地给 rows 加 media 字段；从最新的消息开始解码，返回剩余额度。"""
    budget = budget if budget is not None else [max(limit, 0)]
    hl_path = dec / "hardlink/hardlink.db"
    hardlink = None
    for row in sorted(rows, key=lambda r: r.get("timestamp") or 0, reverse=True):
        if (int(row.get("local_type") or 0) & 0xFFFFFFFF) not in LABEL:
            continue
        if hardlink is None and hl_path.exists():
            hardlink = vc.connect(hl_path)
        media = describe(dec, chat_user, row, budget, hardlink)
        if media:
            row["media"] = media
    return budget


def suffix(media: dict | None) -> str:
    """文本输出里接在消息后面的一段；路径前后留空格，DragonClaw 网页会把它识别成图片/文件。"""
    if not media:
        return ""
    bits = [media["kind"]]
    if media.get("quality"):
        bits.append(media["quality"])
    if media.get("name"):
        bits.append(media["name"])
    if media.get("seconds"):
        bits.append(f"{media['seconds']}秒")
    if not media.get("local") and media["kind"] != "语音":
        bits.append("本机没有")
    out = f"  〔{' · '.join(bits)}〕"
    if media.get("view"):
        out += f" 查看: {media['view']} "
    if media.get("file") and media["kind"] in ("视频", "文件"):
        out += f" 文件: {media['file']} "
    if media.get("note") and media["kind"] != "语音":
        out += f" （{media['note']}）"
    return out
