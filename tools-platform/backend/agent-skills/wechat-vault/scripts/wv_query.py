#!/usr/bin/env python3
"""wechat-vault 查询补充命令（只读明文库）。

recent  最近 N 分钟的新消息：会话名、发送人、时间（开罗 UTC+2）、内容
latest  最新消息时间与最近会话（用来判断实时服务是否跟上）
其余查询（search/history/export/unread/...）直接用 yichen vault_cli.py，见 wechat-vault 入口脚本。
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


def recent(decrypted: Path, minutes: float, limit_per_chat: int) -> list[dict]:
    since = int(time.time() - minutes * 60)
    sessions = with_retry(vc.session_rows, decrypted, False, 200)
    contacts, _ = vc.load_contacts(decrypted)
    rows = []
    for s in sessions:
        if s["timestamp"] < since:
            break
        chat = vc.resolve_chat(s["username"], contacts) or {"username": s["username"], "display_name": s["chat"], "is_group": s["is_group"]}
        chat.setdefault("is_group", "@chatroom" in s["username"])
        msgs = with_retry(vc.collect_history, decrypted, chat, since, None, limit_per_chat, 0, None)
        for m in msgs:
            rows.append({"chat": s["chat"], "is_group": s["is_group"], "sender": m["sender"] or ("我" if not s["is_group"] else ""),
                         "timestamp": m["timestamp"], "time_cairo": cairo(m["timestamp"]), "type": m["type"], "content": m["content"]})
    rows.sort(key=lambda r: r["timestamp"])
    return rows


def render_recent(rows: list[dict], minutes: float) -> str:
    if not rows:
        return f"最近 {minutes:g} 分钟没有新消息（时间为开罗 UTC+2）"
    lines = [f"最近 {minutes:g} 分钟 {len(rows)} 条消息（时间为开罗 UTC+2）", ""]
    for r in rows:
        tag = "[群] " if r["is_group"] else ""
        content = " ⏎ ".join(str(r["content"]).splitlines())
        lines.append(f"[{r['time_cairo']}] {tag}{r['chat']} | {r['sender']}: {content}")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("recent")
    p.add_argument("--minutes", type=float, default=10)
    p.add_argument("--limit-per-chat", type=int, default=100)
    p.add_argument("--format", choices=["text", "json"], default="text")
    p = sub.add_parser("latest")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--format", choices=["text", "json"], default="text")
    args = ap.parse_args()
    decrypted = vc.resolve_decrypted_dir(None)
    if args.cmd == "recent":
        rows = recent(decrypted, args.minutes, args.limit_per_chat)
        vc.output(rows, args.format, lambda shown: render_recent(shown, args.minutes))
    else:
        rows = [r for r in with_retry(vc.session_rows, decrypted, False, args.limit + 5) if not r["username"].startswith("@placeholder")][: max(args.limit, 1)]
        newest = rows[0]["timestamp"] if rows else 0
        data = {"now_cairo": cairo(int(time.time())), "newest_message_cairo": cairo(newest),
                "lag_seconds": int(time.time()) - newest if newest else None,
                "sessions": [{"time_cairo": cairo(r["timestamp"]), "chat": r["chat"], "is_group": r["is_group"], "unread": r["unread"],
                              "sender": r["sender"], "last_message": r["last_message"]} for r in rows]}
        def render(d):
            out = [f"现在 {d['now_cairo']}（开罗 UTC+2），库里最新消息 {d['newest_message_cairo']}，相差 {d['lag_seconds']} 秒", ""]
            for r in d["sessions"][: args.limit]:
                tag = " [群]" if r["is_group"] else ""
                unread = f" ({r['unread']}条未读)" if r["unread"] else ""
                who = f"{r['sender']}: " if r["sender"] and r["is_group"] else ""
                last = " ⏎ ".join(str(r["last_message"]).splitlines())
                out.append(f"[{r['time_cairo']}] {r['chat']}{tag}{unread}\n  {who}{last}")
            return "\n".join(out)
        vc.output(data, args.format, render)
    return 0


if __name__ == "__main__":
    sys.exit(main())
