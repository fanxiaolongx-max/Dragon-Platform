#!/usr/bin/env python3
"""wechat-vault 查询补充命令（只读明文库）。

recent   最近 N 分钟的新消息：会话名、发送人、时间（开罗 UTC+2）、内容
latest   最新消息时间与最近会话（用来判断实时服务是否跟上）
history  某个会话的聊天记录
三者默认给图片/视频/文件/语音消息附上本地文件信息（media 字段），图片解码成可直接查看的 jpg/png
（缓存在 /Volumes/512G/wechat-local-vault/media-cache/，每次最多解 --media-limit 张，--no-media 关闭）。
其余查询（search/export/unread/...）直接用 yichen vault_cli.py，见 wechat-vault 入口脚本。
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

YICHEN = Path(os.environ.get("YICHEN_WECHAT_DIR", "/Volumes/512G/repos/yichen-skills/yichen-wechat-local-vault"))
sys.path.insert(0, str(YICHEN / "scripts"))
import vault_cli as vc  # noqa: E402

CAIRO = ZoneInfo("Africa/Cairo")


def media_mod():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import wv_view  # noqa: E402  只在需要媒体信息时加载（会读图片密钥）
    return wv_view


def cairo(ts: int) -> str:
    return datetime.fromtimestamp(ts, CAIRO).strftime("%Y-%m-%d %H:%M:%S") if ts else ""


def with_retry(fn, *a, **kw):
    for attempt in range(3):  # 实时服务写页时会短暂加锁，偶发 busy 时重试
        try:
            return fn(*a, **kw)
        except sqlite3.DatabaseError:
            if attempt == 2:
                raise
            time.sleep(0.5)


def recent(decrypted: Path, minutes: float, limit_per_chat: int, media_limit: int = 0) -> list[dict]:
    since = int(time.time() - minutes * 60)
    sessions = with_retry(vc.session_rows, decrypted, False, 200)
    contacts, _ = vc.load_contacts(decrypted)
    rows = []
    budget = [max(media_limit, 0)]
    for s in sessions:
        if s["timestamp"] < since:
            break
        chat = vc.resolve_chat(s["username"], contacts) or {"username": s["username"], "display_name": s["chat"], "is_group": s["is_group"]}
        chat.setdefault("is_group", "@chatroom" in s["username"])
        msgs = with_retry(vc.collect_history, decrypted, chat, since, None, limit_per_chat, 0, None)
        if media_limit >= 0 and msgs:
            budget = media_mod().enrich(decrypted, chat["username"], msgs, media_limit, budget)
        for m in msgs:
            rows.append({"chat": s["chat"], "is_group": s["is_group"], "sender": m["sender"] or ("我" if not s["is_group"] else ""),
                         "timestamp": m["timestamp"], "time_cairo": cairo(m["timestamp"]), "type": m["type"], "content": m["content"],
                         **({"media": m["media"]} if m.get("media") else {})})
    rows.sort(key=lambda r: r["timestamp"])
    return rows


def view_suffix(media) -> str:
    return media_mod().suffix(media) if media else ""


def history(decrypted: Path, a) -> dict:
    contacts, _ = vc.load_contacts(decrypted)
    chat = vc.resolve_chat(a.chat, contacts)
    if not chat:
        raise SystemExit(f"找不到聊天对象: {a.chat}（先用 contacts --query 确认）")
    rows = with_retry(vc.collect_history, decrypted, chat, vc.parse_time(a.start_time), vc.parse_time(a.end_time, end_of_day=True),
                      a.limit, a.offset, a.type, False)
    if a.media_limit >= 0:
        media_mod().enrich(decrypted, chat["username"], rows, a.media_limit)
    for r in rows:
        r["time_cairo"] = cairo(r["timestamp"])
        for k in ("db", "table", "sender_username", "server_id"):
            r.pop(k, None)
    shown = [r for r in rows if r.get("media")]
    return {"chat": chat["display_name"], "count": len(rows), "media_count": len(shown),
            "viewable_images": [r["media"]["view"] for r in shown if r["media"].get("view") and r["media"]["kind"] == "图片"],
            "messages": rows}


def render_history(d: dict) -> str:
    if not d["messages"]:
        return f"{d['chat']}：没有找到消息"
    out = [f"{d['chat']}：{d['count']} 条（开罗时间 UTC+2）"]
    for r in d["messages"]:
        content = " ⏎ ".join(str(r["content"]).splitlines())
        who = f"{r['sender']}: " if r.get("sender") else ""
        out.append(f"[{r['time_cairo']}] {who}{content}{view_suffix(r.get('media'))}")
    if d["viewable_images"]:
        out += ["", "可直接展示的图片（在回复里写 ![说明](路径) 即可显示；要看内容用 view_image 工具）："] + [f"  {p}" for p in d["viewable_images"]]
    return "\n".join(out)


def render_recent(rows: list[dict], minutes: float) -> str:
    if not rows:
        return f"最近 {minutes:g} 分钟没有新消息（时间为开罗 UTC+2）"
    lines = [f"最近 {minutes:g} 分钟 {len(rows)} 条消息（时间为开罗 UTC+2）", ""]
    for r in rows:
        tag = "[群] " if r["is_group"] else ""
        content = " ⏎ ".join(str(r["content"]).splitlines())
        lines.append(f"[{r['time_cairo']}] {tag}{r['chat']} | {r['sender']}: {content}{view_suffix(r.get('media'))}")
    return "\n".join(lines)


def media_args(p) -> None:
    p.add_argument("--with-media", "--media", dest="with_media", action="store_true", help="附带媒体信息并解码图片（默认已开启，保留兼容）")
    p.add_argument("--media-limit", type=int, default=8, help="本次最多新解码几张图片（已缓存的不计），默认 8")
    p.add_argument("--no-media", action="store_true", help="不附带媒体信息")


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("recent")
    p.add_argument("--minutes", type=float, default=10)
    p.add_argument("--limit-per-chat", type=int, default=100)
    p.add_argument("--format", choices=["text", "json"], default="text")
    media_args(p)
    p = sub.add_parser("latest")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--format", choices=["text", "json"], default="text")
    media_args(p)
    p = sub.add_parser("history")
    p.add_argument("chat")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--start-time", default="")
    p.add_argument("--end-time", default="")
    p.add_argument("--type", choices=sorted(vc.MESSAGE_TYPE_FILTERS))
    p.add_argument("--format", choices=["text", "json"], default="text")
    media_args(p)
    args = ap.parse_args()
    if args.no_media:
        args.media_limit = -1
    decrypted = vc.resolve_decrypted_dir(None)
    if args.cmd == "recent":
        rows = recent(decrypted, args.minutes, args.limit_per_chat, args.media_limit)
        vc.output(rows, args.format, lambda shown: render_recent(shown, args.minutes))
    elif args.cmd == "history":
        vc.output(history(decrypted, args), args.format, render_history)
    else:
        rows = [r for r in with_retry(vc.session_rows, decrypted, False, args.limit + 5) if not r["username"].startswith("@placeholder")][: max(args.limit, 1)]
        newest = rows[0]["timestamp"] if rows else 0
        data = {"now_cairo": cairo(int(time.time())), "newest_message_cairo": cairo(newest),
                "lag_seconds": int(time.time()) - newest if newest else None,
                "sessions": [{"time_cairo": cairo(r["timestamp"]), "chat": r["chat"], "is_group": r["is_group"], "unread": r["unread"],
                              "sender": r["sender"], "last_message": r["last_message"]} for r in rows]}
        if args.media_limit >= 0:  # 最后一条是图片/视频/文件/语音的会话：附上本地文件信息
            contacts, _ = vc.load_contacts(decrypted)
            budget = [args.media_limit]
            for r, item in zip(rows, data["sessions"]):
                if not any(tag in str(r["last_message"]) for tag in ("[图片]", "[视频]", "[文件]", "[语音]")) and r.get("msg_type") not in ("图片", "视频", "文件", "语音", "image", "video", "file", "voice"):
                    continue
                chat = vc.resolve_chat(r["username"], contacts) or {"username": r["username"], "display_name": r["chat"], "is_group": r["is_group"]}
                chat.setdefault("is_group", "@chatroom" in r["username"])
                last = with_retry(vc.collect_history, decrypted, chat, None, None, 1, 0, None)
                budget = media_mod().enrich(decrypted, chat["username"], last, args.media_limit, budget)
                if last and last[0].get("media"):
                    item["media"] = last[0]["media"]
        def render(d):
            out = [f"现在 {d['now_cairo']}（开罗 UTC+2），库里最新消息 {d['newest_message_cairo']}，相差 {d['lag_seconds']} 秒", ""]
            for r in d["sessions"][: args.limit]:
                tag = " [群]" if r["is_group"] else ""
                unread = f" ({r['unread']}条未读)" if r["unread"] else ""
                who = f"{r['sender']}: " if r["sender"] and r["is_group"] else ""
                last = " ⏎ ".join(str(r["last_message"]).splitlines())
                out.append(f"[{r['time_cairo']}] {r['chat']}{tag}{unread}\n  {who}{last}{view_suffix(r.get('media'))}")
            return "\n".join(out)
        vc.output(data, args.format, render)
    return 0


if __name__ == "__main__":
    sys.exit(main())
