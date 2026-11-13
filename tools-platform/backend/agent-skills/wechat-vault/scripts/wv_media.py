#!/usr/bin/env python3
"""wechat-vault 媒体命令（只读本机微信文件 + 明文库，不联网、不发消息）。

  media <会话> [--type image|video|file|voice] [--since 48h|2026-11-01] [--until ..] [--limit N]
  export-media <会话> [目标目录] [同上过滤] [--transcribe] [--no-thumb]
  decode-image <dat文件> [--out 文件或目录]
  voice-mp3 <会话> [目标目录] ...         （= export-media --type voice）
  image-key status | image-key derive [--save]
  media-stats                              账号媒体目录统计

图片密钥（V2 .dat）：AES key = md5(f"{code}{wxid}")[:16]，XOR = code & 0xFF，code 来自
Documents/app_data/net/kvcomm/key_<code>_* 的文件名；保存在 Dragon 保险箱 <wxid>/image_aes、<wxid>/image_xor。
任何输出、日志都不打印密钥。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
YICHEN = Path(os.environ.get("YICHEN_WECHAT_DIR", "/Volumes/512G/repos/yichen-skills/yichen-wechat-local-vault"))
sys.path.insert(0, str(YICHEN / "scripts"))
import vault_cli as vc  # noqa: E402
from Crypto.Cipher import AES  # noqa: E402

CAIRO = ZoneInfo("Africa/Cairo")
VAULT = Path("/Volumes/512G/wechat-local-vault")
DEFAULT_EXPORT = VAULT / "exports" / "media"
WHISPER_MODEL = Path(os.environ.get("WV_WHISPER_MODEL", "/Volumes/512G/models/whisper/ggml-large-v3-turbo-q5_0.bin"))
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
WHISPER = shutil.which("whisper-cli") or "/opt/homebrew/bin/whisper-cli"
NODE = os.environ.get("WV_NODE", shutil.which("node") or "node")
CONTAINER = Path("~/Library/Containers/com.tencent.xinWeChat/Data").expanduser()
TYPES = {3: "image", 34: "voice", 43: "video", 49: "file"}
V1_AES = b"cfcd208495d565ef"  # md5("0")[:16]，V1 格式固定密钥
MAGIC_V1, MAGIC_V2 = b"\x07\x08V1\x08\x07", b"\x07\x08V2\x08\x07"
IMG_SIG = [(b"\xff\xd8\xff", "jpg"), (b"\x89PNG\r\n\x1a\n", "png"), (b"GIF87a", "gif"), (b"GIF89a", "gif"),
           (b"wxgf", "wxgf"), (b"BM", "bmp"), (b"II*\x00", "tif")]


# ---------- 基础 ----------
def cairo(ts: int) -> str:
    return datetime.fromtimestamp(ts, CAIRO).strftime("%Y-%m-%d %H:%M:%S") if ts else ""


def account_dir() -> Path:
    db = vc.resolve_db_dir()
    if not db:
        sys.exit("找不到微信账号目录（~/.config/wechat-local-vault.json 缺 wxid/db_base_path）")
    return db.parent


def wxid() -> str:
    return str(vc.load_config().get("wxid") or account_dir().name)


def parse_when(value: str | None, end: bool = False) -> int | None:
    if not value:
        return None
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([mhd])", value.strip())
    if m:
        return int(time.time() - float(m.group(1)) * {"m": 60, "h": 3600, "d": 86400}[m.group(2)])
    return vc.parse_time(value, end_of_day=end)


def secure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    os.chmod(p, 0o700)
    return p


def secure_write(p: Path, data: bytes) -> Path:
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    os.chmod(p, 0o600)
    return p


def safe(name: str, limit: int = 80) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .") or "未命名"
    return name[:limit]


def sync_once() -> None:
    py = sys.executable
    subprocess.run([py, str(HERE / "realtime_sync.py"), "--once"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)


# ---------- 图片密钥 ----------
def kvcomm_codes() -> list[int]:
    codes = set()
    for d in (CONTAINER / "Documents/app_data/net/kvcomm", CONTAINER / "Documents/xwechat/net/kvcomm",
              CONTAINER / "Library/Application Support/com.tencent.xinWeChat/xwechat/net/kvcomm"):
        if d.is_dir():
            for e in d.iterdir():
                m = re.fullmatch(r"key_(\d+)(?:_.*)?", e.name)
                if m:
                    codes.add(int(m.group(1)))
    return sorted(codes)


def name_candidates() -> list[str]:
    raw = wxid()
    out = [raw]
    m = re.fullmatch(r"(.+)_[0-9a-f]{4}", raw)  # 账号目录 = 微信号 + _4位后缀
    if m:
        out.append(m.group(1))
    if raw.startswith("wxid_") and raw.count("_") > 1:
        out.append("_".join(raw.split("_", 2)[:2]))
    return list(dict.fromkeys(out))


def sample_v2(limit: int = 40) -> list[Path]:
    root = account_dir() / "msg/attach"
    out = []
    for chat in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True) if root.is_dir() else []:
        for f in sorted(chat.glob("*/Img/*.dat"), reverse=True)[:5]:
            with open(f, "rb") as fh:
                if fh.read(6) == MAGIC_V2:
                    out.append(f)
        if len(out) >= limit:
            break
    return out[:limit]


def derive_image_key() -> dict:
    samples = sample_v2()
    if not samples:
        raise SystemExit("没有找到 V2 图片样本，无法验证")
    for code in kvcomm_codes():
        for name in name_candidates():
            aes = hashlib.md5(f"{code}{name}".encode()).hexdigest()[:16]
            ok = sum(1 for f in samples if _sniff(AES.new(aes.encode(), AES.MODE_ECB).decrypt(f.read_bytes()[15:31])))
            if ok >= max(1, len(samples) * 0.8):
                key = {"aes": aes, "xor": code & 0xFF}
                full_ok = sum(1 for f in samples[:10] if _try_full(f, key))
                return {**key, "_check": f"AES 头校验 {ok}/{len(samples)}，完整解码 {full_ok}/{min(10, len(samples))}"}
    raise SystemExit("kvcomm 推导失败：需要从微信进程内存取图片密钥（见 SKILL.md）")


def _try_full(f: Path, key: dict) -> bool:
    try:
        return decode_dat_bytes(f.read_bytes(), key)[1] in ("jpg", "png", "gif", "wxgf", "webp")
    except Exception:
        return False


_KEY_CACHE: dict | None = None


def load_image_key() -> dict:
    global _KEY_CACHE
    if _KEY_CACHE is None:
        try:
            out = subprocess.run([NODE, str(HERE / "vault_keys.js"), "image-export"], capture_output=True, timeout=30, check=True).stdout
            _KEY_CACHE = json.loads(out)
        except Exception:
            k = derive_image_key()  # 保险箱里没有就现推导（不保存）
            _KEY_CACHE = {"aes": k["aes"], "xor": k["xor"]}
    return _KEY_CACHE


# ---------- 图片解码 ----------
def _sniff(b: bytes) -> str | None:
    for sig, ext in IMG_SIG:
        if b.startswith(sig):
            return ext
    if b.startswith(b"RIFF") and b[8:12] == b"WEBP":
        return "webp"
    return None


def decode_dat_bytes(data: bytes, key: dict | None) -> tuple[bytes, str]:
    if data.startswith((MAGIC_V1, MAGIC_V2)):
        aes = V1_AES if data.startswith(MAGIC_V1) else (key or load_image_key())["aes"].encode()
        xor = 0 if data.startswith(MAGIC_V1) else int((key or load_image_key())["xor"])
        aes_size, xor_size = struct.unpack("<I", data[6:10])[0], struct.unpack("<I", data[10:14])[0]
        aes_end = 15 + aes_size + (16 - aes_size % 16)
        raw_end = len(data) - xor_size
        if aes_end > raw_end:
            raise ValueError("文件结构不对")
        clear = AES.new(aes, AES.MODE_ECB).decrypt(data[15:aes_end])
        pad = clear[-1]
        if not 1 <= pad <= 16 or clear[-pad:] != bytes([pad]) * pad:
            raise ValueError("图片密钥不对")
        out = clear[:-pad] + data[aes_end:raw_end] + bytes(b ^ xor for b in data[raw_end:])
    else:  # 老格式：整文件单字节 XOR，用图片头推算
        out = None
        for sig, _ in IMG_SIG[:4]:
            x = data[0] ^ sig[0]
            if all(data[i] ^ x == sig[i] for i in range(min(len(sig), len(data)))):
                out = bytes(b ^ x for b in data)
                break
        if out is None:
            raise ValueError("不认识的 .dat 格式")
    ext = _sniff(out)
    if not ext:
        raise ValueError("解出来不是图片（密钥可能不对）")
    return out, ext


def decode_image(src: Path, out: Path) -> Path:
    """out 是不带扩展名的目标路径，返回实际文件。wxgf（微信 HEVC）用 ffmpeg 转 jpg。"""
    data, ext = decode_dat_bytes(src.read_bytes(), None)
    if ext == "wxgf":
        with tempfile.TemporaryDirectory(dir=str(out.parent)) as td:
            raw = Path(td) / "x.hevc"
            secure_write(raw, data[data.find(b"\x00\x00\x00\x01"):] if b"\x00\x00\x00\x01" in data else data)
            target = out.with_suffix(".jpg")
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "hevc", "-i", str(raw),
                            "-frames:v", "1", "-update", "1", str(target)], check=True, timeout=30)
            os.chmod(target, 0o600)
            return target
    return secure_write(out.with_suffix("." + ext), data)


# ---------- 消息 → 文件 ----------
def _packed_md5(blob) -> str | None:
    m = re.search(rb"([0-9a-f]{32})", bytes(blob or b""))
    return m.group(1).decode() if m else None


def _appmsg(content: str) -> dict | None:
    i = content.find("<msg")
    if i < 0:
        return None
    try:
        root = ET.fromstring(content[i:])
    except ET.ParseError:
        return None
    app = root.find("appmsg")
    if app is None or (app.findtext("type") or "").strip() != "6":
        return None
    attach = app.find("appattach")
    size = (attach.findtext("totallen") if attach is not None else "") or ""
    return {"title": (app.findtext("title") or "").strip(), "size": int(size) if size.isdigit() else None,
            "md5": (app.findtext("md5") or "").strip().lower() or None,
            "ext": (attach.findtext("fileext") if attach is not None else "") or ""}


def _months(ts: int) -> list[str]:
    return [datetime.fromtimestamp(ts).strftime("%Y-%m")]


def image_files(acct: Path, chat_user: str, ts: int, md5: str | None) -> dict:
    if not md5:
        return {}
    base = acct / "msg/attach" / hashlib.md5(chat_user.encode()).hexdigest()
    found: dict[str, str] = {}
    dirs = [base / m / "Img" for m in _months(ts)]
    for d in dirs + sorted(base.glob("*/Img")):
        for suffix, label in (("_h", "hd"), ("", "mid"), ("_t", "thumb")):
            f = d / f"{md5}{suffix}.dat"
            if label not in found and f.is_file():
                found[label] = str(f)
        if found:
            break
    return found


def video_files(acct: Path, ts: int, md5: str | None) -> dict:
    if not md5:
        return {}
    root = acct / "msg/video"
    for d in [root / m for m in _months(ts)] + sorted(root.glob("*")):
        found = {}
        if (d / f"{md5}.mp4").is_file():
            found["video"] = str(d / f"{md5}.mp4")
        if (d / f"{md5}_thumb.jpg").is_file():
            found["thumb"] = str(d / f"{md5}_thumb.jpg")
        if found:
            return found
    return {}


def file_path(acct: Path, ts: int, info: dict, hardlink: sqlite3.Connection | None) -> str | None:
    title = info["title"]
    for m in _months(ts):
        p = vc.received_file_path(acct / "msg/file" / m, title, info["size"])
        if p:
            return str(p)
    if hardlink is not None and info.get("md5"):  # 兜底：hardlink 索引（按内容 md5）
        try:
            for name, month in hardlink.execute(
                    "SELECT f.file_name, d.username FROM file_hardlink_info_v4 f LEFT JOIN dir2id d ON d.rowid=f.dir1 WHERE f.md5=?", (info["md5"],)):
                p = acct / "msg/file" / str(month) / name
                if p.is_file():
                    return str(p)
        except sqlite3.Error:
            pass
    return None


def expected_file_path(acct: Path, ts: int, info: dict) -> str:
    """文件没下载时微信会把它放到这里（消息所在月份目录 + 原文件名）。"""
    return str(acct / "msg/file" / _months(ts)[0] / (info.get("title") or "未知文件名"))


def human_size(n) -> str:
    if n is None:
        return "大小未知"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return ""


class Voices:
    def __init__(self, dec: Path):
        self.cons = []
        for p in sorted((dec / "message").glob("media_*.db")):
            try:
                con = vc.connect(p)
                ids = {r[1]: r[0] for r in con.execute("SELECT rowid, user_name FROM Name2Id")}
                self.cons.append((con, ids))
            except sqlite3.Error:
                pass

    def get(self, chat_user: str, local_id: int, ts: int, svr_id) -> bytes | None:
        for con, ids in self.cons:
            cid = ids.get(chat_user)
            if cid is None:
                continue
            row = con.execute("SELECT voice_data FROM VoiceInfo WHERE chat_name_id=? AND local_id=? AND create_time=? ORDER BY data_index",
                              (cid, local_id, ts)).fetchone() or (
                con.execute("SELECT voice_data FROM VoiceInfo WHERE chat_name_id=? AND svr_id=?", (cid, svr_id)).fetchone() if svr_id else None)
            if row and row[0]:
                return bytes(row[0])
        return None


def collect(chat_query: str, types: set[str], since: int | None, until: int | None, limit: int) -> tuple[dict, list[dict]]:
    dec = vc.resolve_decrypted_dir()
    contacts, _ = vc.load_contacts(dec)
    chat = vc.resolve_chat(chat_query, contacts)
    if not chat:
        sys.exit(f"找不到会话：{chat_query}（先用 contacts --query 确认）")
    acct = account_dir()
    hl_path = dec / "hardlink/hardlink.db"
    hardlink = vc.connect(hl_path) if hl_path.exists() else None
    voices = Voices(dec) if "voice" in types else None
    want = [t for t, n in TYPES.items() if n in types]
    rows = []
    for db_path, table in vc.find_chat_tables(dec, chat):
        with vc.connect(db_path) as con:
            name2id = vc.load_name2id(con)
            q = (f"SELECT local_id, server_id, local_type, real_sender_id, create_time, message_content, compress_content, "
                 f"packed_info_data, WCDB_CT_message_content AS cf FROM {table} WHERE (local_type & 4294967295) IN ({','.join('?' * len(want))})")
            params: list = list(want)
            if since:
                q += " AND create_time >= ?"; params.append(since)
            if until:
                q += " AND create_time <= ?"; params.append(until)
            q += " ORDER BY create_time DESC LIMIT ?"; params.append(limit * 4)
            for r in con.execute(q, params):
                base = int(r["local_type"]) & 0xFFFFFFFF
                content = vc.decode_value(r["message_content"], r["cf"]) or vc.decode_value(r["compress_content"], r["cf"])
                prefix, content = vc.parse_sender_prefix(content)
                su = name2id.get(int(r["real_sender_id"] or 0), "") or prefix
                sender = "我" if su == wxid_real() else (vc.display_name(su, contacts) if su else chat["display_name"])
                ts = int(r["create_time"] or 0)
                item = {"time_cairo": cairo(ts), "timestamp": ts, "local_id": r["local_id"], "sender": sender, "type": TYPES[base]}
                if base == 3:
                    item["files"] = image_files(acct, chat["username"], ts, _packed_md5(r["packed_info_data"]))
                elif base == 43:
                    item["files"] = video_files(acct, ts, _packed_md5(r["packed_info_data"]))
                    m = re.search(r'playlength="(\d+)"', content)
                    item["seconds"] = int(m.group(1)) if m else None
                elif base == 49:
                    info = _appmsg(content)
                    if not info:
                        continue
                    p = file_path(acct, ts, info, hardlink)
                    item.update(name=info["title"], size=info["size"], size_h=human_size(info["size"]), files={"file": p} if p else {},
                                downloaded=bool(p), path=p or expected_file_path(acct, ts, info))
                    if not p:
                        item["expected_path"] = item["path"]
                        item["note"] = "未下载，请在微信点开下载"
                elif base == 34:
                    m = re.search(r'voicelength="(\d+)"', content)
                    item["seconds"] = round(int(m.group(1)) / 1000, 1) if m else None
                    data = voices.get(chat["username"], r["local_id"], ts, r["server_id"]) if voices else None
                    item["files"] = {"voice_db": f"{len(data)} 字节 silk"} if data else {}
                    item["_voice"] = data
                rows.append(item)
    rows.sort(key=lambda x: x["timestamp"], reverse=True)
    rows = rows[:limit]
    rows.reverse()
    return chat, rows


_ME: str | None = None


def wxid_real() -> str:
    """当前登录账号的 username（用于判断「我」）；与账号目录名可能不同，用 contact 库里的自己。"""
    global _ME
    if _ME is None:
        _ME = os.environ.get("WV_SELF_USERNAME", "")
        if not _ME:
            name = wxid()
            cands = name_candidates()
            dec = vc.resolve_decrypted_dir()
            contacts, _ = vc.load_contacts(dec)
            _ME = next((c for c in cands if c in contacts), cands[-1] if len(cands) > 1 else name)
    return _ME


# ---------- 语音 ----------
def silk_to_mp3(data: bytes, out_mp3: Path, transcribe: bool = False) -> dict:
    import pilk
    with tempfile.TemporaryDirectory(dir=str(out_mp3.parent)) as td:
        silk, pcm = Path(td) / "a.silk", Path(td) / "a.pcm"
        secure_write(silk, data)
        try:
            pilk.decode(str(silk), str(pcm), pcm_rate=24000)
        except Exception:
            secure_write(silk, data[1:] if data[:1] == b"\x02" else b"\x02" + data)
            pilk.decode(str(silk), str(pcm), pcm_rate=24000)
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
                        "-i", str(pcm), "-b:a", "64k", str(out_mp3)], check=True, timeout=60)
        os.chmod(out_mp3, 0o600)
        res = {"mp3": str(out_mp3)}
        if transcribe:
            if not WHISPER_MODEL.exists():
                res["text_error"] = f"没有本地模型 {WHISPER_MODEL}"
                return res
            wav = Path(td) / "a.wav"
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
                            "-i", str(pcm), "-ar", "16000", str(wav)], check=True, timeout=60)
            r = subprocess.run([WHISPER, "-m", str(WHISPER_MODEL), "-l", "zh", "-nt", "-np", "-f", str(wav)],
                               capture_output=True, text=True, timeout=300)
            text = r.stdout.strip()
            res["text"] = text
            secure_write(out_mp3.with_suffix(".txt"), text.encode())
        return res


# ---------- 命令 ----------
def render_list(chat: dict, rows: list[dict]) -> str:
    if not rows:
        return f"{chat['display_name']}：这个范围内没有媒体消息"
    out = [f"{chat['display_name']}：{len(rows)} 条媒体消息（开罗时间 UTC+2）"]
    label = {"image": "图片", "video": "视频", "file": "文件", "voice": "语音"}
    for r in rows:
        extra = r.get("name") or (f"{r['seconds']} 秒" if r.get("seconds") else "")
        files = r.get("files") or {}
        if r["type"] == "file":
            extra += f"（{r.get('size_h') or human_size(r.get('size'))}）"
        state = "本地有" if files else ("未下载，请在微信点开下载" if r["type"] == "file" else "本地没有（未下载/已清理）")
        out.append(f"[{r['time_cairo']}] {r['sender']} {label[r['type']]} {extra} — {state}")
        for k, v in files.items():
            out.append(f"    {k}: {v}")
        if r["type"] == "file":
            if files.get("file"):
                out.append(f'    读内容: wechat-vault read-file "{files["file"]}"')
            elif r.get("expected_path"):
                out.append(f"    预期路径: {r['expected_path']}（未下载，请在微信点开下载）")
    return "\n".join(out)


def cmd_media(a) -> int:
    sync_once()
    chat, rows = collect(a.chat, set(a.type or TYPES.values()), parse_when(a.since), parse_when(a.until, True), a.limit)
    for r in rows:
        r.pop("_voice", None)
    if a.view:  # 图片解码到 media-cache、视频封面复制过去，给出可直接显示的 view 路径
        import wv_view
        budget = [a.view_limit]
        for r in sorted(rows, key=lambda x: x["timestamp"], reverse=True):
            md5 = None
            files = r.get("files") or {}
            if r["type"] == "image" and files:
                label = next(k for k in ("hd", "mid", "thumb") if k in files)
                md5 = re.search(r"([0-9a-f]{32})", Path(files[label]).name)
                if md5 and (budget[0] > 0 or wv_view._cached(f"{md5.group(1)}_{label}")):
                    path, fresh, err = wv_view.view_image(files[label], md5.group(1), label)
                    budget[0] -= int(fresh)
                    if path:
                        files["view"] = path
            elif r["type"] == "video" and files.get("thumb"):
                md5 = re.search(r"([0-9a-f]{32})", Path(files["thumb"]).name)
                cover = wv_view.copy_cover(files["thumb"], md5.group(1)) if md5 else None
                if cover:
                    files["view"] = cover
    if a.format == "json":
        print(json.dumps({"chat": chat["display_name"], "items": rows}, ensure_ascii=False, indent=2))
    else:
        print(render_list(chat, rows))
    return 0


def cmd_export(a) -> int:
    sync_once()
    chat, rows = collect(a.chat, set(a.type or TYPES.values()), parse_when(a.since), parse_when(a.until, True), a.limit)
    dest = secure_dir(Path(a.dest) if a.dest else DEFAULT_EXPORT / safe(chat["display_name"]))
    if not str(dest.resolve()).startswith("/Volumes/512G/"):
        print("提醒：导出目录不在 /Volumes/512G 下", file=sys.stderr)
    stats = {"image": [0, 0], "video": [0, 0], "file": [0, 0], "voice": [0, 0], "missing": 0}
    manifest = []
    for r in rows:
        stem = f"{datetime.fromtimestamp(r['timestamp'], CAIRO).strftime('%Y%m%d-%H%M%S')}_{r['local_id']}"
        sub = secure_dir(dest / r["type"])
        files, entry = r.get("files") or {}, {k: v for k, v in r.items() if k not in ("_voice", "files")}
        try:
            if r["type"] == "image" and files:
                src = files.get("hd") or files.get("mid") or files.get("thumb")
                if a.no_thumb and src == files.get("thumb"):
                    raise FileNotFoundError("只有缩略图")
                entry["out"] = str(decode_image(Path(src), sub / stem))
                entry["level"] = next(k for k, v in files.items() if v == src)
            elif r["type"] == "video" and files:
                src, ext = (files["video"], ".mp4") if files.get("video") else (files["thumb"], "_thumb.jpg")
                t = sub / f"{stem}{ext}"; shutil.copyfile(src, t); os.chmod(t, 0o600); entry["out"] = str(t)
                entry["level"] = "video" if ext == ".mp4" else "thumb（视频本体未下载，只有封面）"
            elif r["type"] == "file" and files.get("file"):
                t = sub / f"{stem}_{safe(Path(files['file']).name, 120)}"; shutil.copyfile(files["file"], t); os.chmod(t, 0o600); entry["out"] = str(t)
            elif r["type"] == "voice" and r.get("_voice"):
                entry.update(silk_to_mp3(r["_voice"], sub / f"{stem}.mp3", a.transcribe))
                entry["out"] = entry.pop("mp3")
            else:
                stats["missing"] += 1
                entry["error"] = "本地没有文件"
                manifest.append(entry)
                continue
            stats[r["type"]][0] += 1
        except Exception as exc:
            stats[r["type"]][1] += 1
            entry["error"] = f"{type(exc).__name__}: {exc}"
        manifest.append(entry)
    old = []
    try:  # 同一目录多次导出时合并清单（按 local_id+type 去重）
        old = json.loads((dest / "manifest.json").read_text()).get("items", [])
    except Exception:
        pass
    seen = {(i.get("local_id"), i.get("type")) for i in manifest}
    manifest = [i for i in old if (i.get("local_id"), i.get("type")) not in seen] + manifest
    manifest.sort(key=lambda i: i.get("timestamp", 0))
    secure_write(dest / "manifest.json", json.dumps({"chat": chat["display_name"], "exported_at": cairo(int(time.time())), "items": manifest},
                                                    ensure_ascii=False, indent=2).encode())
    label = {"image": "图片", "video": "视频", "file": "文件", "voice": "语音"}
    parts = [f"{label[k]} 成功 {v[0]} 失败 {v[1]}" for k, v in stats.items() if k != "missing" and (v[0] or v[1])]
    print(f"已导出到 {dest}（目录 700、文件 600）\n" + "；".join(parts or ["没有可导出的文件"]) + f"；本地缺文件 {stats['missing']} 条\n清单：{dest/'manifest.json'}")
    return 0


def cmd_decode(a) -> int:
    src = Path(a.dat).expanduser()
    out = Path(a.out).expanduser() if a.out else VAULT / "media-cache"
    if a.out is None or out.is_dir() or not out.suffix:
        secure_dir(out)
        out = out / src.stem
    else:
        secure_dir(out.parent)
        out = out.with_suffix("")
    print(decode_image(src, out))
    return 0


def cmd_key(a) -> int:
    if a.action == "status":
        r = subprocess.run([NODE, str(HERE / "vault_keys.js"), "image-status"], capture_output=True, text=True)
        print(r.stdout.strip() or r.stderr.strip())
        return r.returncode
    k = derive_image_key()
    print(f"推导成功（{k.pop('_check')}），kvcomm code 数 {len(kvcomm_codes())}")
    if a.save:
        r = subprocess.run([NODE, str(HERE / "vault_keys.js"), "image-save"], input=json.dumps(k), capture_output=True, text=True)
        print(r.stdout.strip() or r.stderr.strip())
        return r.returncode
    return 0


def cmd_stats(_a) -> int:
    acct = account_dir()
    res = {}
    for name, root, pat in (("图片 .dat（attach）", "msg/attach", None), ("视频（msg/video）", "msg/video", None), ("文件（msg/file）", "msg/file", None)):
        n = size = 0
        kinds: dict[str, int] = {}
        for dp, _, fs in os.walk(acct / root):
            for f in fs:
                if f.startswith("."):
                    continue
                n += 1
                size += os.path.getsize(os.path.join(dp, f))
                k = ("缩略图 _t" if f.endswith("_t.dat") else "高清 _h" if f.endswith("_h.dat") else "原图/中图" if f.endswith(".dat")
                     else "封面 _thumb.jpg" if f.endswith("_thumb.jpg") else Path(f).suffix.lower() or "无扩展名")
                kinds[k] = kinds.get(k, 0) + 1
        res[name] = {"files": n, "MB": round(size / 1e6, 1), "kinds": dict(sorted(kinds.items(), key=lambda x: -x[1])[:8])}
    dec = vc.resolve_decrypted_dir()
    vn = vs = 0
    for p in sorted((dec / "message").glob("media_*.db")):
        with vc.connect(p) as con:
            c, s = con.execute("SELECT count(*), coalesce(sum(length(voice_data)),0) FROM VoiceInfo").fetchone()
            vn += c; vs += s
    res["语音（media_*.db VoiceInfo）"] = {"count": vn, "MB": round(vs / 1e6, 1)}
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="wechat-vault media")
    sp = ap.add_subparsers(dest="cmd", required=True)

    def filters(p, dest=False):
        p.add_argument("chat")
        if dest:
            p.add_argument("dest", nargs="?")
        p.add_argument("--type", action="append", choices=list(TYPES.values()))
        p.add_argument("--since"); p.add_argument("--until")
        p.add_argument("--limit", type=int, default=50)
    p = sp.add_parser("media"); filters(p); p.add_argument("--format", choices=["text", "json"], default="text")
    p.add_argument("--view", action="store_true", help="图片解码到 media-cache 并给出可直接显示的路径")
    p.add_argument("--view-limit", type=int, default=20); p.set_defaults(fn=cmd_media)
    p = sp.add_parser("export-media"); filters(p, True); p.add_argument("--transcribe", action="store_true"); p.add_argument("--no-thumb", action="store_true"); p.set_defaults(fn=cmd_export)
    p = sp.add_parser("decode-image"); p.add_argument("dat"); p.add_argument("--out"); p.set_defaults(fn=cmd_decode)
    p = sp.add_parser("image-key"); p.add_argument("action", choices=["status", "derive"]); p.add_argument("--save", action="store_true"); p.set_defaults(fn=cmd_key)
    p = sp.add_parser("media-stats"); p.set_defaults(fn=cmd_stats)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
