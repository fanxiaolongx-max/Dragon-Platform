#!/usr/bin/env python3
"""微信消息库实时增量解密服务（只本机、不联网、不发消息）。

监听 db_storage 下的消息分库 / 会话库 / 联系人库及其 -wal 文件（macOS FSEvents，经 watchdog），
去抖约 1.5 秒后只处理变化的库：
  1. 读取「主库 + WAL 已提交帧」的加密快照（复用 yichen 工具的 windows_wal.read_snapshot，未提交的帧不采用）；
  2. SQLCipher 每次写页都会换 16 字节 IV，按 IV 比较找出变化的页，只解密这些页；
  3. 在明文库上持有 SQLite 排它锁后原位写入变化页，查询进程最多等几百毫秒，不会读到半截页。
首次遇到某个库（或明文库被别的工具整份替换）时整库解密一次，之后都是页级增量。

密钥：启动时通过 vault_keys.js export 从 Dragon 保险箱读取；失败才回退 ~/.config/wechat-keys.json。
日志与状态写到 <vault_dir>/realtime/，日志里不写密钥。
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import signal
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
YICHEN = Path(os.environ.get("YICHEN_WECHAT_DIR", "/Volumes/512G/repos/yichen-skills/yichen-wechat-local-vault"))
sys.path.insert(0, str(YICHEN / "scripts"))
from Crypto.Cipher import AES  # noqa: E402
from windows_wal import read_snapshot  # noqa: E402

PAGE = 4096
RESERVE = 80
CONFIG_FILE = Path("~/.config/wechat-local-vault.json").expanduser()
KEYS_FILE = Path("~/.config/wechat-keys.json").expanduser()
DEFAULT_VAULT_DIR = Path("/Volumes/512G/wechat-local-vault")
WATCH_RE = re.compile(r"^(message/message_\d+\.db|session/session\.db|contact/contact\.db)$")
DEBOUNCE = float(os.environ.get("WV_DEBOUNCE", "1.5"))
MAX_DELAY = 5.0
POLL_EVERY = 60.0

stop = threading.Event()


def log(msg: str) -> None:
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


def load_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text())
    except Exception:
        return {}


def load_keys() -> tuple[dict, str]:
    node = os.environ.get("WV_NODE", "node")
    try:
        out = subprocess.run([node, str(HERE / "vault_keys.js"), "export"], capture_output=True, timeout=30, check=True).stdout
        keys = json.loads(out)
        if keys:
            return keys, "dragon-vault"
    except Exception as exc:  # 不打印 stdout，避免任何密钥进日志
        log(f"WARN 从保险箱读取密钥失败（{type(exc).__name__}），回退 {KEYS_FILE}")
    from decrypt_all_dbs import key_name_to_rel
    raw = json.loads(KEYS_FILE.read_text())
    return {key_name_to_rel(k): v for k, v in raw.items() if key_name_to_rel(k)}, "keys-file"


class Syncer:
    def __init__(self, db_base: Path, out_base: Path, state_dir: Path, keys: dict, key_source: str):
        self.db_base, self.out_base, self.state_dir = db_base, out_base, state_dir
        self.keys, self.key_source = keys, key_source
        self.status_file = state_dir.parent / "status.json"
        self.status = {"pid": os.getpid(), "started_at": datetime.now().isoformat(timespec="seconds"),
                       "key_source": key_source, "databases": {}}
        self.lock = threading.Lock()
        self.denied_logged: set[str] = set()
        self.lock_file = open(state_dir.parent / "sync.lock", "a")  # 与 `wechat-vault sync` 等一次性进程互斥

    # ---- state ----
    def _state_path(self, rel: str) -> Path:
        return self.state_dir / (rel.replace("/", "__") + ".json")

    def _load_state(self, rel: str) -> dict | None:
        try:
            st = json.loads(self._state_path(rel).read_text())
            st["ivs"] = bytes.fromhex(st["ivs"])
            return st
        except Exception:
            return None

    def _save_state(self, rel: str, ivs: bytes, dst: Path, key: str, src_fp) -> None:
        info = dst.stat()
        data = {"ivs": ivs.hex(), "dst_ino": info.st_ino, "dst_size": info.st_size,
                "key_sha256": hashlib.sha256(key.encode()).hexdigest(), "src": src_fp}
        tmp = self._state_path(rel).with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        os.chmod(tmp, 0o600)
        os.replace(tmp, self._state_path(rel))

    def _write_status(self) -> None:
        if self.status_file is None:  # 一次性同步不覆盖常驻服务的状态文件
            return
        self.status["updated_at"] = datetime.now().isoformat(timespec="seconds")
        tmp = self.status_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.status, ensure_ascii=False, indent=2))
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.status_file)

    def fingerprint(self, rel: str):
        src = self.db_base / rel
        out = []
        for p in (src, Path(str(src) + "-wal")):
            try:
                s = p.stat()
                out.append([s.st_size, s.st_mtime_ns])
            except FileNotFoundError:
                out.append(None)
        return out

    # ---- decrypt ----
    @staticmethod
    def _decrypt_page(cipher_key: bytes, page: bytes, pn: int) -> bytes:
        start = 16 if pn == 0 else 0
        iv = page[PAGE - RESERVE: PAGE - RESERVE + 16]
        dec = AES.new(cipher_key, AES.MODE_CBC, iv).decrypt(page[start: PAGE - RESERVE])
        out = bytearray(PAGE)
        if pn == 0:
            out[:16] = b"SQLite format 3\x00"
            out[16: 16 + len(dec)] = dec
            out[16:18] = struct.pack(">H", PAGE)
            out[18] = 1  # 明文副本用回滚日志模式：读者不建 -wal/-shm，配合本服务的排它锁
            out[19] = 1
            counter = struct.pack(">I", int(time.time()) & 0xFFFFFFFF)  # 变更计数器，让读者丢弃旧缓存
            out[24:28] = counter
            out[92:96] = counter
        else:
            out[: len(dec)] = dec
        return bytes(out)

    def sync(self, rel: str, reason: str) -> None:
        fcntl.flock(self.lock_file, fcntl.LOCK_EX)
        try:
            self._sync(rel, reason)
        finally:
            fcntl.flock(self.lock_file, fcntl.LOCK_UN)

    def _sync(self, rel: str, reason: str) -> None:
        key = self.keys.get(rel)
        if not key:
            return
        src, dst = self.db_base / rel, self.out_base / rel
        t0 = time.time()
        fp = self.fingerprint(rel)
        try:
            merged = read_snapshot(src)
        except PermissionError:
            self._record(rel, error="EPERM: 本进程没有读取微信容器的权限（需给 pm2 所用 node 开「完全磁盘访问权限」）")
            if rel not in self.denied_logged:
                self.denied_logged.add(rel)
                log(f"MISS {rel}: Operation not permitted —— 需要给运行 pm2 的 node 开「完全磁盘访问权限」后 pm2 restart wechat-realtime")
            return
        except Exception as exc:
            self._record(rel, error=f"snapshot: {exc}")
            log(f"MISS {rel}: 读取快照失败 {exc}")
            return
        self.denied_logged.discard(rel)
        if len(merged) < PAGE or len(merged) % PAGE:
            self._record(rel, error="快照大小异常")
            return
        n = len(merged) // PAGE
        ivs = b"".join(merged[i * PAGE + PAGE - RESERVE: i * PAGE + PAGE - RESERVE + 16] for i in range(n))
        ck = bytes.fromhex(key)
        st = self._load_state(rel)
        full = (st is None or not dst.exists() or st.get("key_sha256") != hashlib.sha256(key.encode()).hexdigest()
                or dst.stat().st_ino != st.get("dst_ino") or dst.stat().st_size != st.get("dst_size"))
        if full:
            self._full(dst, merged, n, ck)
            changed = n
        else:
            old = st["ivs"]
            pages = [i for i in range(n) if ivs[i * 16:(i + 1) * 16] != old[i * 16:(i + 1) * 16]]
            changed = len(pages)
            if pages or n * 16 != len(old):
                if 0 not in pages:
                    pages.insert(0, 0)  # 总是重写第 1 页：更新变更计数器与库大小
                self._patch(dst, merged, pages, n, ck)
        self._save_state(rel, ivs, dst, key, fp)
        ms = int((time.time() - t0) * 1000)
        self._record(rel, pages=n, changed=changed, mode="full" if full else "incremental", ms=ms)
        if changed:
            log(f"OK   {rel}: {'整库' if full else '增量'} {changed}/{n} 页 {ms}ms ({reason})")

    def _full(self, dst: Path, merged: bytes, n: int, ck: bytes) -> None:
        dst.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=f".{dst.name}.", suffix=".tmp", dir=dst.parent)
        try:
            with os.fdopen(fd, "wb") as f:
                for i in range(n):
                    f.write(self._decrypt_page(ck, merged[i * PAGE:(i + 1) * PAGE], i))
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp, 0o600)
            con = sqlite3.connect(f"file:{tmp}?immutable=1", uri=True)
            con.execute("SELECT count(*) FROM sqlite_master").fetchone()
            con.close()
            for side in ("-wal", "-shm", "-journal"):
                try:
                    os.unlink(str(dst) + side)
                except FileNotFoundError:
                    pass
            os.replace(tmp, dst)
        except BaseException:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass
            raise

    def _patch(self, dst: Path, merged: bytes, pages: list[int], n: int, ck: bytes) -> None:
        con = sqlite3.connect(str(dst), timeout=10, isolation_level=None)
        try:
            con.execute("BEGIN EXCLUSIVE")  # 读者此时会等待，不会读到半截页
            fd = os.open(dst, os.O_RDWR)
            try:
                for i in pages:
                    os.pwrite(fd, self._decrypt_page(ck, merged[i * PAGE:(i + 1) * PAGE], i), i * PAGE)
                os.ftruncate(fd, n * PAGE)
                os.fsync(fd)
            finally:
                os.close(fd)
            con.execute("ROLLBACK")
        finally:
            con.close()

    def _record(self, rel: str, **info) -> None:
        with self.lock:
            entry = self.status["databases"].setdefault(rel, {})
            entry.update(info)
            entry["at"] = datetime.now().isoformat(timespec="seconds")
            if "error" not in info:
                entry.pop("error", None)
            self._write_status()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="同步一次就退出")
    ap.add_argument("--resync", action="store_true", help="丢弃页状态，整库重建被监听的库")
    args = ap.parse_args()

    cfg = load_config()
    db_base = Path(cfg.get("db_base_path") or "").expanduser()
    vault_dir = DEFAULT_VAULT_DIR
    if str(cfg.get("vault_dir", "")).rstrip("/") != str(DEFAULT_VAULT_DIR):
        log(f"WARN 配置里的 vault_dir={cfg.get('vault_dir')} 不是 {DEFAULT_VAULT_DIR}，本服务仍写 {DEFAULT_VAULT_DIR}")
    out_base = vault_dir / "decrypted/current"
    state_dir = vault_dir / "realtime/state"
    state_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(state_dir.parent, 0o700)
    if not db_base.is_dir():
        log(f"ERROR 找不到微信数据库目录（db_base_path）")
        return 2
    if args.resync:
        for p in state_dir.glob("*.json"):
            p.unlink()

    keys, source = load_keys()
    watched = sorted(rel for rel in keys if WATCH_RE.match(rel))
    log(f"START pid={os.getpid()} 密钥来源={source} 监听 {len(watched)} 个库 去抖={DEBOUNCE}s")
    syncer = Syncer(db_base, out_base, state_dir, keys, source)
    if args.once:
        syncer.status_file = None

    last_fp = {}
    for rel in watched:
        st = syncer._load_state(rel)
        if st is None or st.get("src") != syncer.fingerprint(rel):
            syncer.sync(rel, "startup")
        last_fp[rel] = syncer.fingerprint(rel)
    syncer._write_status()
    if args.once:
        return 0

    pending: dict[str, list[float]] = {}
    cond = threading.Condition()

    def notify(path: str) -> None:
        try:
            rel = os.path.relpath(path, db_base)
        except ValueError:
            return
        for suffix in ("-wal", "-shm"):
            if rel.endswith(suffix):
                rel = rel[: -len(suffix)]
        if rel in keys and WATCH_RE.match(rel):
            now = time.time()
            with cond:
                first = pending.get(rel, [now, now])[0]
                pending[rel] = [first, now]
                cond.notify()

    from watchdog.events import FileSystemEventHandler
    from watchdog.observers import Observer

    class Handler(FileSystemEventHandler):
        def on_any_event(self, event):
            if not event.is_directory:
                notify(event.src_path)
                if getattr(event, "dest_path", ""):
                    notify(event.dest_path)

    observer = Observer()
    for sub in ("message", "session", "contact"):
        observer.schedule(Handler(), str(db_base / sub), recursive=False)
    observer.start()

    def handle_sig(*_):
        stop.set()
        with cond:
            cond.notify()
    signal.signal(signal.SIGTERM, handle_sig)
    signal.signal(signal.SIGINT, handle_sig)

    next_poll = time.time() + POLL_EVERY
    while not stop.is_set():
        with cond:
            cond.wait(timeout=0.5)
            now = time.time()
            due = [rel for rel, (first, last) in pending.items() if now - last >= DEBOUNCE or now - first >= MAX_DELAY]
            for rel in due:
                pending.pop(rel)
        for rel in due:
            fp = syncer.fingerprint(rel)
            if fp != last_fp.get(rel):
                try:
                    syncer.sync(rel, "fsevent")
                except Exception as exc:
                    log(f"MISS {rel}: {type(exc).__name__}: {exc}")
                last_fp[rel] = fp
        if time.time() >= next_poll:  # 兜底：万一漏了文件事件
            next_poll = time.time() + POLL_EVERY
            for rel in watched:
                fp = syncer.fingerprint(rel)
                if fp != last_fp.get(rel):
                    try:
                        syncer.sync(rel, "poll")
                    except Exception as exc:
                        log(f"MISS {rel}: {type(exc).__name__}: {exc}")
                    last_fp[rel] = fp
    observer.stop()
    observer.join(timeout=5)
    log("STOP")
    return 0


if __name__ == "__main__":
    sys.exit(main())
