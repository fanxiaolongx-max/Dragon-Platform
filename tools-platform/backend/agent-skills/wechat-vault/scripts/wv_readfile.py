#!/usr/bin/env python3
"""wechat-vault read-file：把微信聊天里收到/发出的文件转成文字给 agent（只读，不改原文件）。

  read-file <会话> [--name 关键词] [--since 7d] [--until ..] [--pick N] [--list]
  read-file <文件绝对路径>
  公共选项：--max-chars 20000 --offset 0 --rows 50 --sheet 名称 --ocr auto|on|off --ocr-pages 10 --format text|json

支持：PDF（pdftotext → pypdf；图片型 PDF 用 tesseract chi_sim+eng OCR）、docx、doc/rtf/odt（macOS textutil）、
xlsx/xlsm、xls、csv/tsv、pptx、txt/md/json/xml/html/log 等文本、jpg/png 图片 OCR。
其余格式（zip/apk/rar/…）只给绝对路径和说明。任何文件都会给出本地绝对路径；没下载的给出预期路径。
提取结果缓存在 /Volumes/512G/wechat-local-vault/file-text-cache/（目录 700、文件 600），分页时不重复解析。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import wv_media as wm  # noqa: E402

vc = wm.vc
TEXT_CACHE = wm.VAULT / "file-text-cache"
TMP_ROOT = wm.VAULT / "media-work" / "tmp"
TESSDATA = Path(os.environ.get("WV_TESSDATA", "/Volumes/512G/models/tessdata"))
BIN = "/opt/homebrew/bin"
W_HINT = "wechat-vault read-file"

TEXT_EXT = {"txt", "md", "markdown", "json", "log", "xml", "yaml", "yml", "ini", "conf", "cfg", "py", "js", "ts", "sh", "sql",
            "java", "c", "h", "cpp", "go", "rs", "srt", "vtt", "toml", "properties", "html", "htm"}
TEXTUTIL_EXT = {"doc", "rtf", "odt", "rtfd", "wordml", "webarchive"}
IMAGE_EXT = {"jpg", "jpeg", "png", "bmp", "tif", "tiff", "webp", "gif"}
KNOWN_UNSUPPORTED = {
    "zip": "压缩包", "rar": "压缩包", "7z": "压缩包", "gz": "压缩包", "tar": "压缩包", "apk": "安卓安装包", "ipa": "iOS 安装包",
    "dmg": "macOS 安装镜像", "exe": "Windows 程序", "msi": "Windows 安装包", "mp3": "音频", "m4a": "音频", "wav": "音频",
    "mp4": "视频", "mov": "视频", "avi": "视频", "mkv": "视频", "psd": "设计稿", "ai": "设计稿", "dwg": "CAD 图纸",
    "et": "WPS 表格（请另存为 xlsx）", "wps": "WPS 文字（请另存为 docx）", "dps": "WPS 演示（请另存为 pptx）",
    "ppt": "旧版 PPT（请另存为 pptx）", "key": "Keynote", "pages": "Pages 文稿", "numbers": "Numbers 表格", "eml": "邮件",
}


def human(n) -> str:
    if n is None:
        return "大小未知"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return ""


def tool(name: str) -> str | None:
    return shutil.which(name) or (f"{BIN}/{name}" if Path(f"{BIN}/{name}").exists() else None)


def decode_bytes(b: bytes) -> str:
    for enc in ("utf-8-sig", "gb18030", "utf-16"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            continue
    return b.decode("utf-8", "replace")


def cell(v, width: int = 80) -> str:
    if v is None:
        return ""
    s = str(v).replace("\r", " ").replace("\n", " ⏎ ").replace("|", "／").strip()
    if s.endswith(" 00:00:00"):
        s = s[:-9]
    return s if len(s) <= width else s[: width - 1] + "…"


def table_text(name: str, rows: list[list], total_rows: int, total_cols: int, shown_limit: int) -> str:
    out = [f"## 工作表「{name}」：{total_rows} 行 × {total_cols} 列" + (f"（下面只列前 {shown_limit} 行，--rows N 可调）" if total_rows > shown_limit else "")]
    for i, r in enumerate(rows, 1):
        while r and (r[-1] is None or str(r[-1]).strip() == ""):
            r = r[:-1]
        out.append(f"{i:>4} | " + " | ".join(cell(v) for v in r))
    return "\n".join(out)


# ---------- 各格式 ----------
def ocr_image(path: Path, a) -> str:
    tess = tool("tesseract")
    if not tess:
        return ""
    langs = "chi_sim+eng" if (TESSDATA / "chi_sim.traineddata").exists() else "eng"
    cmd = [tess, str(path), "stdout", "-l", langs] + (["--tessdata-dir", str(TESSDATA)] if TESSDATA.exists() else [])
    r = subprocess.run(cmd, capture_output=True, timeout=180)
    text = decode_bytes(r.stdout)
    if langs.startswith("chi"):  # 中文 OCR 会在汉字间插空格
        text = re.sub(r"(?<=[\u4e00-\u9fff，。：；、！？（）])[ \t]+(?=[\u4e00-\u9fff，。：；、！？（）])", "", text)
    return text


def read_pdf(path: Path, a, notes: list[str]) -> str:
    pages = 0
    pi = tool("pdfinfo")
    if pi:
        m = re.search(r"Pages:\s+(\d+)", subprocess.run([pi, str(path)], capture_output=True, text=True, errors="replace").stdout)
        pages = int(m.group(1)) if m else 0
    text = ""
    pt = tool("pdftotext")
    if pt:
        r = subprocess.run([pt, "-layout", "-enc", "UTF-8", str(path), "-"], capture_output=True, timeout=300)
        text = decode_bytes(r.stdout)
    if not text.strip():
        try:
            from pypdf import PdfReader
            rd = PdfReader(str(path))
            pages = pages or len(rd.pages)
            text = "\n\f".join((p.extract_text() or "") for p in rd.pages)
        except Exception as e:  # noqa: BLE001
            notes.append(f"pypdf 失败：{str(e)[:80]}")
    if pages:
        notes.append(f"PDF 共 {pages} 页")
    visible = len(re.sub(r"\s", "", text))
    image_like = visible < max(30, 20 * max(pages, 1))
    if (image_like and a.ocr != "off") or a.ocr == "on":
        if not tool("tesseract") or not tool("pdftoppm"):
            notes.append("像是扫描件/图片型 PDF，但本机没有 tesseract/pdftoppm，无法 OCR（brew install tesseract poppler）")
            return text
        n = min(pages or a.ocr_pages, a.ocr_pages)
        TMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=TMP_ROOT) as td:
            subprocess.run([tool("pdftoppm"), "-r", "200", "-png", "-f", "1", "-l", str(n), str(path), f"{td}/p"], capture_output=True, timeout=600)
            parts = [f"--- 第 {i} 页（OCR）---\n{ocr_image(img, a)}" for i, img in enumerate(sorted(Path(td).glob("p*.png")), 1)]
        notes.append(f"图片型 PDF，已对前 {n} 页做 OCR（tesseract {'chi_sim+eng' if (TESSDATA / 'chi_sim.traineddata').exists() else 'eng'}），可能有错字"
                     + (f"；共 {pages} 页，--ocr-pages N 可多识别" if pages > n else ""))
        return "\n".join(parts)
    return text.replace("\f", "\n--- 分页 ---\n")


def read_docx(path: Path, a, notes: list[str]) -> str:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    d = docx.Document(str(path))
    out, ntab = [], 0
    for el in d.element.body.iterchildren():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = Paragraph(el, d)
            t = p.text.strip()
            if t:
                style = (p.style.name or "") if p.style is not None else ""
                out.append(("#" * int(style[-1]) + " " if style.startswith("Heading") and style[-1:].isdigit() else "") + t)
        elif tag == "tbl":
            ntab += 1
            rows = [[c.text for c in r.cells] for r in Table(el, d).rows]
            out.append(table_text(f"表格{ntab}", rows[: a.rows], len(rows), max((len(r) for r in rows), default=0), a.rows))
    if ntab:
        notes.append(f"含 {ntab} 个表格")
    return "\n".join(out)


def read_textutil(path: Path, a, notes: list[str]) -> str:
    tu = shutil.which("textutil") or "/usr/bin/textutil"
    r = subprocess.run([tu, "-convert", "txt", "-stdout", str(path)], capture_output=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(decode_bytes(r.stderr)[:120] or "textutil 失败")
    return decode_bytes(r.stdout)


def read_xlsx(path: Path, a, notes: list[str]) -> str:
    import openpyxl
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    out = []
    names = wb.sheetnames
    notes.append(f"{len(names)} 个工作表：{', '.join(names)}")
    for ws in wb.worksheets:
        if a.sheet and a.sheet not in ws.title:
            continue
        rows, total, cols = [], 0, 0
        for r in ws.iter_rows(values_only=True):
            if not any(v is not None and str(v).strip() for v in r):
                continue
            total += 1
            cols = max(cols, max((i + 1 for i, v in enumerate(r) if v is not None and str(v).strip()), default=0))
            if len(rows) < a.rows:
                rows.append(list(r))
        out.append(table_text(ws.title, rows, total, cols, a.rows))
    wb.close()
    return "\n\n".join(out)


def read_xls(path: Path, a, notes: list[str]) -> str:
    import xlrd
    wb = xlrd.open_workbook(str(path))
    notes.append(f"{wb.nsheets} 个工作表：{', '.join(wb.sheet_names())}")
    out = []
    for sh in wb.sheets():
        if a.sheet and a.sheet not in sh.name:
            continue
        rows = [sh.row_values(i) for i in range(min(sh.nrows, a.rows))]
        out.append(table_text(sh.name, rows, sh.nrows, sh.ncols, a.rows))
    return "\n\n".join(out)


def read_csv(path: Path, a, notes: list[str]) -> str:
    text = decode_bytes(path.read_bytes())
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",\t;|")
    except csv.Error:
        dialect = csv.excel_tab if path.suffix.lower() == ".tsv" else csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    return table_text(path.name, rows[: a.rows], len(rows), max((len(r) for r in rows), default=0), a.rows)


def read_pptx(path: Path, a, notes: list[str]) -> str:
    from pptx import Presentation
    prs = Presentation(str(path))
    out = []
    for i, slide in enumerate(prs.slides, 1):
        out.append(f"--- 第 {i} 页 ---")
        for sh in slide.shapes:
            if sh.has_text_frame and sh.text_frame.text.strip():
                out.append(sh.text_frame.text.strip())
            elif getattr(sh, "has_table", False) and sh.has_table:
                rows = [[c.text for c in r.cells] for r in sh.table.rows]
                out.append(table_text(f"第{i}页表格", rows[: a.rows], len(rows), len(rows[0]) if rows else 0, a.rows))
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip():
            out.append("备注：" + slide.notes_slide.notes_text_frame.text.strip())
    notes.append(f"共 {len(prs.slides)} 页幻灯片")
    return "\n".join(out)


def read_text(path: Path, a, notes: list[str]) -> str:
    text = decode_bytes(path.read_bytes()[:20_000_000])
    ext = path.suffix.lower().lstrip(".")
    if ext in ("html", "htm"):
        text = re.sub(r"(?is)<(script|style).*?</\1>", "", text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = re.sub(r"[ \t]+", " ", text)
    elif ext == "json":
        try:
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=1)
        except ValueError:
            pass
    return text


def read_image(path: Path, a, notes: list[str]) -> str:
    if a.ocr == "off":
        notes.append("图片文件，未做 OCR（--ocr on 可识别文字；也可以用 view_image 直接看）")
        return ""
    if not tool("tesseract"):
        notes.append("图片文件，本机没有 tesseract 无法 OCR；可以用 view_image 直接看")
        return ""
    notes.append("图片文件，已 OCR（可能有错字）；要看版式请用 view_image")
    return ocr_image(path, a)


def sniff_kind(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    head = path.open("rb").read(8)
    if ext == "pdf" or head.startswith(b"%PDF"):
        return "pdf"
    if ext in ("docx", "docm", "dotx"):
        return "docx"
    if ext in ("xlsx", "xlsm", "xltx"):
        return "xlsx"
    if ext == "xls":
        return "xls"
    if ext in ("csv", "tsv"):
        return "csv"
    if ext in ("pptx", "ppsx"):
        return "pptx"
    if ext in TEXTUTIL_EXT:
        return "textutil"
    if ext in TEXT_EXT:
        return "text"
    if ext in IMAGE_EXT:
        return "image"
    if ext in KNOWN_UNSUPPORTED:
        return "unsupported"
    if head.startswith(b"PK\x03\x04"):  # 没扩展名的 zip 容器，按内容猜
        try:
            import zipfile
            names = zipfile.ZipFile(path).namelist()
            if "word/document.xml" in names:
                return "docx"
            if "xl/workbook.xml" in names:
                return "xlsx"
            if "ppt/presentation.xml" in names:
                return "pptx"
        except Exception:  # noqa: BLE001
            pass
        return "unsupported"
    if head.startswith(b"\xd0\xcf\x11\xe0"):  # 老 Office 复合文档
        return "textutil" if ext != "ppt" else "unsupported"
    try:  # 未知扩展名：看起来像文本就按文本读
        chunk = path.open("rb").read(4096)
        if chunk and b"\x00" not in chunk:
            decode_bytes(chunk)
            return "text"
    except Exception:  # noqa: BLE001
        pass
    return "unsupported"


READERS = {"pdf": read_pdf, "docx": read_docx, "xlsx": read_xlsx, "xls": read_xls, "csv": read_csv, "pptx": read_pptx,
           "textutil": read_textutil, "text": read_text, "image": read_image}
KIND_LABEL = {"pdf": "PDF", "docx": "Word 文档", "xlsx": "Excel 表格", "xls": "Excel 表格（旧版 xls）", "csv": "CSV/TSV 表格",
              "pptx": "PPT 演示", "textutil": "文档（textutil 转换）", "text": "文本", "image": "图片", "unsupported": "不支持解析的格式"}


def extract(path: Path, a) -> tuple[str, str, list[str]]:
    kind = sniff_kind(path)
    notes: list[str] = []
    if kind == "unsupported":
        ext = path.suffix.lower().lstrip(".") or "无扩展名"
        notes.append(f"{KNOWN_UNSUPPORTED.get(ext, '未知格式')}（.{ext}）无法直接读内容；已给出本地绝对路径，用户可以在 Finder/对应软件里打开")
        return kind, "", notes
    st = path.stat()
    key = hashlib.md5(f"{path}|{st.st_size}|{int(st.st_mtime)}|{kind}|{a.rows}|{a.sheet}|{a.ocr}|{a.ocr_pages}".encode()).hexdigest()
    cache = TEXT_CACHE / f"{key}.json"
    if cache.is_file():
        try:
            d = json.loads(cache.read_text())
            return kind, d["text"], d["notes"]
        except Exception:  # noqa: BLE001
            pass
    try:
        text = READERS[kind](path, a, notes)
    except Exception as e:  # noqa: BLE001
        if kind in ("docx", "xlsx", "pptx", "xls"):  # 扩展名骗人/损坏时退回 textutil
            try:
                text = read_textutil(path, a, notes)
                notes.append(f"{KIND_LABEL[kind]}解析失败（{str(e)[:60]}），已用 textutil 兜底")
            except Exception:  # noqa: BLE001
                notes.append(f"解析失败：{str(e)[:120]}")
                return kind, "", notes
        else:
            notes.append(f"解析失败：{str(e)[:120]}")
            return kind, "", notes
    text = re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n")).strip()
    wm.secure_dir(TEXT_CACHE)
    wm.secure_write(cache, json.dumps({"path": str(path), "text": text, "notes": notes}, ensure_ascii=False).encode())
    return kind, text, notes


# ---------- 会话里找文件 ----------
def find_in_chat(a) -> tuple[dict, list[dict]]:
    wm.sync_once()
    chat, rows = wm.collect(a.target, {"file"}, wm.parse_when(a.since), wm.parse_when(a.until, True), max(a.scan, 1))
    rows = [r for r in rows if not a.name or a.name.lower() in (r.get("name") or "").lower()]
    rows.sort(key=lambda r: r["timestamp"], reverse=True)
    return chat, rows


def file_item_path(r: dict) -> tuple[str, bool]:
    p = (r.get("files") or {}).get("file")
    return (p, True) if p else (r.get("expected_path") or "", False)


def render_matches(chat: dict, rows: list[dict]) -> str:
    out = [f"{chat['display_name']}：找到 {len(rows)} 个文件（开罗时间 UTC+2，最新在前，--pick N 选第 N 个）"]
    for i, r in enumerate(rows, 1):
        p, ok = file_item_path(r)
        state = "本地有" if ok else "未下载，请在微信点开下载"
        out.append(f"{i:>3}. [{r['time_cairo']}] {r['sender']} 〔{r.get('name')} · {human(r.get('size'))} · {state}〕\n     {'路径' if ok else '预期路径'}: {p}")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(prog="wechat-vault read-file", description="把微信聊天里的文件转成文字（只读）")
    ap.add_argument("target", help="会话名（备注/昵称/微信号）或文件绝对路径")
    ap.add_argument("--name", default="", help="文件名关键词（不区分大小写）")
    ap.add_argument("--since"); ap.add_argument("--until")
    ap.add_argument("--pick", type=int, default=1, help="匹配到多个时取第 N 个（1 = 最新）")
    ap.add_argument("--list", action="store_true", help="只列出会话里的文件，不读内容")
    ap.add_argument("--scan", type=int, default=300, help="最多扫描最近多少条文件消息")
    ap.add_argument("--max-chars", type=int, default=20000)
    ap.add_argument("--offset", type=int, default=0, help="从第几个字开始（分页）")
    ap.add_argument("--rows", type=int, default=50, help="表格每个 sheet 最多列出多少行")
    ap.add_argument("--sheet", default="", help="只看名字包含这个词的工作表")
    ap.add_argument("--ocr", choices=["auto", "on", "off"], default="auto")
    ap.add_argument("--ocr-pages", type=int, default=10)
    ap.add_argument("--format", choices=["text", "json"], default="text")
    a = ap.parse_args()

    meta: dict = {}
    others: list[dict] = []
    target = os.path.expanduser(a.target)
    if target.startswith("/") or Path(target).is_file():
        path = Path(target).resolve()
        meta = {"name": path.name, "path": str(path)}
        if not path.is_file():
            msg = {"ok": False, "path": str(path), "error": "文件不存在（如果是微信里的文件：未下载，请在微信点开下载后再读）"}
            print(json.dumps(msg, ensure_ascii=False, indent=1) if a.format == "json" else f"路径: {path}\n{msg['error']}")
            return 1
    else:
        chat, rows = find_in_chat(a)
        if not rows:
            print(f"{chat['display_name']}：没找到{('名字含「' + a.name + '」的') if a.name else ''}文件消息（可放宽 --since/--name，或先 media \"{a.target}\" --type file）")
            return 1
        if a.list:
            if a.format == "json":
                print(json.dumps({"chat": chat["display_name"], "files": [{**{k: r.get(k) for k in ("time_cairo", "sender", "name", "size")},
                      "path": file_item_path(r)[0], "downloaded": file_item_path(r)[1]} for r in rows]}, ensure_ascii=False, indent=1))
            else:
                print(render_matches(chat, rows))
            return 0
        r = rows[min(max(a.pick, 1), len(rows)) - 1]
        others = [x for x in rows if x is not r][:5]
        p, ok = file_item_path(r)
        meta = {"chat": chat["display_name"], "sender": r["sender"], "time_cairo": r["time_cairo"], "name": r.get("name"),
                "size": r.get("size"), "path": p, "downloaded": ok}
        if not ok:
            meta["error"] = "这个文件本机没有：未下载，请在微信里点开这个文件下载，再重新读"
            if a.format == "json":
                print(json.dumps({"ok": False, **meta}, ensure_ascii=False, indent=1))
            else:
                print(f"文件: {meta['name']}（{human(meta['size'])}）  {meta['time_cairo']} {meta['sender']} 发在「{meta['chat']}」\n预期路径: {p}\n{meta['error']}")
            return 1
        path = Path(p)

    st = path.stat()
    meta.setdefault("size", st.st_size)
    kind, text, notes = extract(path, a)
    total = len(text)
    off = max(a.offset, 0)
    part = text[off: off + max(a.max_chars, 0)]
    end = off + len(part)
    data = {"ok": kind != "unsupported" and bool(text), **meta, "path": str(path), "kind": kind, "kind_label": KIND_LABEL[kind],
            "total_chars": total, "offset": off, "end": end, "truncated": end < total, "notes": notes, "text": part}
    if end < total:
        data["next"] = f'{W_HINT} "{path}" --offset {end}'
    if not text and kind != "unsupported" and not notes:
        notes.append("没提取到文字（可能是空文件或纯图片，可试 --ocr on）")
    if a.format == "json":
        data["others"] = [{"name": x.get("name"), "time_cairo": x["time_cairo"], "path": file_item_path(x)[0]} for x in others]
        print(json.dumps(data, ensure_ascii=False, indent=1))
        return 0
    head = [f"文件: {meta.get('name') or path.name}（{KIND_LABEL[kind]}，{human(meta.get('size'))}）"]
    if meta.get("chat"):
        head.append(f"来自: 「{meta['chat']}」 {meta['sender']} {meta['time_cairo']}（开罗 UTC+2）")
    head.append(f"本地绝对路径: {path}")
    if kind != "unsupported":
        head.append(f"文字总长 {total} 字，本次显示第 {off}–{end} 字" + (f"；还有 {total - end} 字，继续读：{data['next']}" if end < total else "（已全部显示）"))
    for n in notes:
        head.append(f"说明: {n}")
    if others:
        head.append("同会话其他匹配文件（--pick N 切换）: " + "；".join(f"{x.get('name')}（{x['time_cairo'][:10]}）" for x in others))
    print("\n".join(head))
    if part:
        print("-" * 40)
        print(part)
    return 0


if __name__ == "__main__":
    sys.exit(main())
