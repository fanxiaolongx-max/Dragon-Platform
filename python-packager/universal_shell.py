# -*- coding: utf-8 -*-
"""
Python 通用脚本启动器 (热更新版 · 苹果风格内置交互终端)
=========================================================
架构设计：
  1. 苹果风格内置终端 (Embedded Apple-Style Terminal)：
     - 采用 macOS 窗口控制红黄绿三色圆点、极简标题栏与深色控制台设计；
     - 进程输入/输出直接嵌入于 GUI 主界面内，告别弹出独立外部黑框窗口；
     - 支持完整 ANSI 彩色高亮、多步进度条动态刷新、交互式选项输入与快捷按键条。
  2. 动态核心脚本 (Dynamic Core Logic)：
     - 启动器优先加载运行同级目录下的 core_script.py。
  3. 在线热更新 (Hot Updater)：
     - 客户端点击“检查并更新”，即可从 GitHub (或国内镜像/第三方源) 直接拉取最新 core_script.py 与 version.json；
     - 仅需下载数 KB 核心源码并自动热替换，无需重新下载/安装几十兆的 EXE！
"""

import os
import sys
import json
import time
import shutil
import hashlib
import threading
import subprocess
import re
import urllib.request
import urllib.error
from datetime import datetime

# GUI 库 (Python 内置)
import tkinter as tk
from tkinter import ttk, messagebox

# ============================================================
# 基础路径与环境自适应
# ============================================================
IS_FROZEN = getattr(sys, 'frozen', False)

if IS_FROZEN:
    APP_DIR = os.path.dirname(os.path.abspath(sys.executable))
    BUNDLE_DIR = getattr(sys, '_MEIPASS', APP_DIR)
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = APP_DIR

CORE_SCRIPT_NAME = "core_script.py"
VERSION_FILE_NAME = "version.json"
CONFIG_FILE_NAME = "updater_config.json"
BACKUP_DIR_NAME = "backups"

CORE_SCRIPT_PATH = os.path.join(APP_DIR, CORE_SCRIPT_NAME)
VERSION_PATH = os.path.join(APP_DIR, VERSION_FILE_NAME)
CONFIG_PATH = os.path.join(APP_DIR, CONFIG_FILE_NAME)
BACKUP_DIR_PATH = os.path.join(APP_DIR, BACKUP_DIR_NAME)
DATA_DIR_PATH = os.path.join(APP_DIR, "data")


def ensure_workspace():
    """首次运行时释放初始文件与数据目录"""
    os.makedirs(BACKUP_DIR_PATH, exist_ok=True)
    os.makedirs(DATA_DIR_PATH, exist_ok=True)

    if not os.path.exists(CORE_SCRIPT_PATH):
        bundled_core = os.path.join(BUNDLE_DIR, CORE_SCRIPT_NAME)
        if os.path.exists(bundled_core):
            try:
                shutil.copy2(bundled_core, CORE_SCRIPT_PATH)
            except Exception as e:
                print(f"[Warn] 释放初始 core_script.py 失败: {e}")

    if not os.path.exists(VERSION_PATH):
        bundled_ver = os.path.join(BUNDLE_DIR, VERSION_FILE_NAME)
        if os.path.exists(bundled_ver):
            try:
                shutil.copy2(bundled_ver, VERSION_PATH)
            except Exception:
                pass
        else:
            default_ver = {
                "name": "PR 报告抽查脚本",
                "version": "1.0.0",
                "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "description": "初始内置脚本",
                "changelog": "初始版本发布"
            }
            try:
                with open(VERSION_PATH, "w", encoding="utf-8") as f:
                    json.dump(default_ver, f, ensure_ascii=False, indent=2)
            except Exception:
                pass

    if not os.path.exists(CONFIG_PATH):
        bundled_cfg = os.path.join(BUNDLE_DIR, CONFIG_FILE_NAME)
        if os.path.exists(bundled_cfg):
            try:
                shutil.copy2(bundled_cfg, CONFIG_PATH)
            except Exception:
                pass


def load_config():
    """读取更新源配置"""
    default_config = {
        "active_source_id": "github",
        "custom_url": "",
        "custom_version_url": "",
        "backup_on_update": True,
        "remote_sources": [
            {
                "id": "github",
                "name": "GitHub 官方源 (Raw)",
                "url": "https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/core_script.py",
                "version_url": "https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/version.json"
            },
            {
                "id": "ghproxy",
                "name": "GitHub 加速镜像 (ghproxy.net)",
                "url": "https://ghproxy.net/https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/core_script.py",
                "version_url": "https://ghproxy.net/https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/version.json"
            },
            {
                "id": "mirror_ghproxy",
                "name": "GitHub 加速镜像 (mirror.ghproxy.com)",
                "url": "https://mirror.ghproxy.com/https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/core_script.py",
                "version_url": "https://mirror.ghproxy.com/https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/version.json"
            },
            {
                "id": "custom",
                "name": "第三方 / 自定义远程地址",
                "url": "",
                "version_url": ""
            }
        ]
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                default_config.update(saved)
        except Exception:
            pass
    return default_config


def save_config(cfg):
    """保存更新源配置"""
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Error] 保存配置失败: {e}")


def load_version_info():
    """读取本地核心脚本版本信息"""
    info = {
        "name": "PR 报告抽查脚本",
        "version": "1.0.0",
        "updated_at": "未知",
        "description": "从 RFC、风险、整改、SR 合并表中按规则抽查",
        "sha256": "",
        "changelog": "初始版本"
    }
    if os.path.exists(VERSION_PATH):
        try:
            with open(VERSION_PATH, "r", encoding="utf-8") as f:
                info.update(json.load(f))
        except Exception:
            pass

    if os.path.exists(CORE_SCRIPT_PATH):
        try:
            with open(CORE_SCRIPT_PATH, "rb") as f:
                data = f.read()
                info["actual_sha256"] = hashlib.sha256(data).hexdigest()
                info["file_size_kb"] = round(len(data) / 1024, 2)
            mtime = os.path.getmtime(CORE_SCRIPT_PATH)
            info["actual_mtime"] = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
    else:
        info["actual_sha256"] = ""
        info["file_size_kb"] = 0
        info["actual_mtime"] = "文件缺失"

    return info


# ============================================================
# 热更新下载与校验核心
# ============================================================
def fetch_url(url, timeout=12):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PythonUniversalShell/1.0",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
        }
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise Exception(f"HTTP 响应状态异常: {resp.status}")
        return resp.read()


def perform_update(config, on_progress=None):
    active_id = config.get("active_source_id", "github")
    sources = config.get("remote_sources", [])
    active_src = next((s for s in sources if s["id"] == active_id), None)

    if not active_src:
        return False, "无效的更新源配置", ""

    if active_id == "custom":
        script_url = config.get("custom_url", "").strip()
        ver_url = config.get("custom_version_url", "").strip()
        if not script_url:
            return False, "请填写自定义脚本下载 URL 地址", ""
    else:
        script_url = active_src.get("url", "")
        ver_url = active_src.get("version_url", "")

    if on_progress:
        on_progress("正在连接远端仓库获取最新版本信息...")

    remote_ver_data = None
    if ver_url:
        try:
            raw_ver = fetch_url(ver_url, timeout=10)
            remote_ver_data = json.loads(raw_ver.decode('utf-8'))
        except Exception as e:
            print(f"[Info] 远端 version.json 获取跳过: {e}")

    if on_progress:
        on_progress(f"正在从 [{active_src['name']}] 下载最新核心逻辑代码...")

    try:
        new_script_bytes = fetch_url(script_url, timeout=15)
    except urllib.error.URLError as e:
        err_msg = str(e.reason if hasattr(e, 'reason') else e)
        hint = "（若直连 GitHub 较慢，请在右上角切换为【GitHub 加速镜像】）" if "github" in active_id.lower() else ""
        return False, f"下载远端脚本失败: {err_msg} {hint}", ""
    except Exception as e:
        return False, f"下载异常: {str(e)}", ""

    try:
        script_text = new_script_bytes.decode('utf-8')
    except UnicodeDecodeError:
        return False, "下载的文件无法以 UTF-8 解码，可能不是有效的 Python 脚本", ""

    if len(script_text.strip()) < 50:
        return False, "下载的脚本内容过小，可能返回了错误页面", ""

    new_sha256 = hashlib.sha256(new_script_bytes).hexdigest()
    current_ver = load_version_info()
    if current_ver.get("actual_sha256") == new_sha256:
        return True, "当前本地脚本已是最新代码，无需更新！", current_ver.get("version", "1.0.0")

    if on_progress:
        on_progress("正在自动备份当前版本...")

    if os.path.exists(CORE_SCRIPT_PATH) and config.get("backup_on_update", True):
        os.makedirs(BACKUP_DIR_PATH, exist_ok=True)
        cur_v = current_ver.get("version", "unknown")
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        bak_name = f"core_script_v{cur_v}_{ts}.py.bak"
        bak_path = os.path.join(BACKUP_DIR_PATH, bak_name)
        try:
            shutil.copy2(CORE_SCRIPT_PATH, bak_path)
        except Exception as e:
            print(f"[Warn] 备份旧脚本失败: {e}")

    if on_progress:
        on_progress("正在写入最新核心脚本...")

    with open(CORE_SCRIPT_PATH, "wb") as f:
        f.write(new_script_bytes)

    target_ver = remote_ver_data or {}
    updated_ver_info = {
        "name": target_ver.get("name", current_ver.get("name", "PR 报告抽查脚本")),
        "version": target_ver.get("version", f"{current_ver.get('version', '1.0.0')}.hotfix"),
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "description": target_ver.get("description", "从远端热更新的核心脚本"),
        "sha256": new_sha256,
        "changelog": target_ver.get("changelog", "通过 Universal Shell 在线热更新完成")
    }

    try:
        with open(VERSION_PATH, "w", encoding="utf-8") as f:
            json.dump(updated_ver_info, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Warn] 更新 version.json 失败: {e}")

    return True, f"热更新成功！最新代码已写入部署，大小: {round(len(new_script_bytes)/1024, 2)} KB", updated_ver_info["version"]


# ============================================================
# 苹果风格内置终端控件 (AppleTerminalWidget)
# ============================================================
class AppleTerminalWidget(tk.Frame):
    """
    优雅、专业、美观的苹果风格内置交互控制台
    - macOS Traffic Light 3点控制栏 (🔴 关/停  🟡 清屏  🟢 重启)
    - 完整支持 ANSI 8/16 色与粗体映射
    - 支持 Carriage Return (\\r) 原地刷新与多步任务旋转进度条
    - 底部集成紧凑交互输入栏 (Prompt ❯ + Enter 发送)
    - 快捷操作小药丸按键栏 (一键点选菜单项，免键盘盲打)
    """

    ANSI_TOKEN_RE = re.compile(r'(\x1b\[[0-9;]*[a-zA-Z]|\r|\n|[^\x1b\r\n]+)')

    def __init__(self, master, on_stop_cb=None, on_restart_cb=None):
        super().__init__(master, bg="#0d1117", bd=1, relief="solid", highlightbackground="#30363d", highlightthickness=1)
        self.on_stop_cb = on_stop_cb
        self.on_restart_cb = on_restart_cb
        self.on_input_send = None

        self._active_tags = set()
        self._build_terminal_ui()

    def _build_terminal_ui(self):
        # 1. 顶部 macOS 风格标题栏
        self.title_bar = tk.Frame(self, bg="#161b22", height=34, padx=10)
        self.title_bar.pack(side=tk.TOP, fill=tk.X)
        self.title_bar.pack_propagate(False)

        # 苹果红黄绿三色小圆点
        dots_frame = tk.Frame(self.title_bar, bg="#161b22")
        dots_frame.pack(side=tk.LEFT, fill=tk.Y)

        self.btn_dot_red = tk.Label(dots_frame, text="●", fg="#ff5f56", bg="#161b22", font=("Arial", 12), cursor="hand2")
        self.btn_dot_red.pack(side=tk.LEFT, padx=(0, 5))
        self.btn_dot_red.bind("<Button-1>", lambda e: self.on_stop_cb() if self.on_stop_cb else None)

        self.btn_dot_yellow = tk.Label(dots_frame, text="●", fg="#ffbd2e", bg="#161b22", font=("Arial", 12), cursor="hand2")
        self.btn_dot_yellow.pack(side=tk.LEFT, padx=(0, 5))
        self.btn_dot_yellow.bind("<Button-1>", lambda e: self.clear_terminal())

        self.btn_dot_green = tk.Label(dots_frame, text="●", fg="#27c93f", bg="#161b22", font=("Arial", 12), cursor="hand2")
        self.btn_dot_green.pack(side=tk.LEFT, padx=(0, 10))
        self.btn_dot_green.bind("<Button-1>", lambda e: self.on_restart_cb() if self.on_restart_cb else None)

        # 居中标题
        self.lbl_title = tk.Label(
            self.title_bar,
            text="zsh — 抽查脚本交互终端 (core_script.py)",
            fg="#8b949e",
            bg="#161b22",
            font=("Consolas", 9, "bold")
        )
        self.lbl_title.pack(side=tk.LEFT, expand=True)

        # 右侧状态徽章与小操作钮
        right_frame = tk.Frame(self.title_bar, bg="#161b22")
        right_frame.pack(side=tk.RIGHT, fill=tk.Y)

        self.status_badge = tk.Label(
            right_frame,
            text="○ 空闲",
            fg="#8b949e",
            bg="#21262d",
            font=("微软雅黑", 8, "bold"),
            padx=7,
            pady=2
        )
        self.status_badge.pack(side=tk.LEFT, padx=(0, 8))

        btn_clear = tk.Label(right_frame, text="🧹 清屏", fg="#58a6ff", bg="#161b22", font=("微软雅黑", 8), cursor="hand2")
        btn_clear.pack(side=tk.LEFT, padx=(0, 6))
        btn_clear.bind("<Button-1>", lambda e: self.clear_terminal())

        # 2. 终端主体文本框 (Text + Scrollbar)
        body_frame = tk.Frame(self, bg="#0d1117")
        body_frame.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # 优先选择美观等宽字体
        font_family = "Menlo" if sys.platform == 'darwin' else "Consolas"

        self.text_area = tk.Text(
            body_frame,
            bg="#0d1117",
            fg="#c9d1d9",
            insertbackground="#58a6ff",
            selectbackground="#1f6feb",
            selectforeground="#ffffff",
            font=(font_family, 10),
            wrap=tk.CHAR,
            relief="flat",
            bd=0,
            padx=12,
            pady=10
        )
        self.text_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        scrollbar = ttk.Scrollbar(body_frame, orient=tk.VERTICAL, command=self.text_area.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.text_area.configure(yscrollcommand=scrollbar.set)

        # 配置 ANSI 颜色标签
        self._config_ansi_tags(font_family)

        # 3. 底部快捷操作小药丸行 (点击直接发送指令，提升易用性)
        self.quick_bar = tk.Frame(self, bg="#161b22", padx=10, pady=4)
        self.quick_bar.pack(side=tk.TOP, fill=tk.X)

        tk.Label(self.quick_bar, text="常用选项快捷点选：", fg="#6e7681", bg="#161b22", font=("微软雅黑", 8)).pack(side=tk.LEFT, padx=(0, 4))

        quick_commands = [
            ("1 开始抽查", "1"),
            ("2 设置比例", "2"),
            ("3 抽查范围", "3"),
            ("4 抽样策略", "4"),
            ("5 查看配置", "5"),
            ("6 自动合并", "6"),
            ("7 立即合并", "7"),
            ("8 智能导入", "8"),
            ("0 退出", "0"),
            ("⏎ 回车确认", ""),
        ]

        for label_text, cmd_val in quick_commands:
            pill = tk.Label(
                self.quick_bar,
                text=label_text,
                fg="#79c0ff",
                bg="#21262d",
                activeforeground="#ffffff",
                activebackground="#1f6feb",
                font=("Consolas", 8, "bold"),
                padx=6,
                pady=1,
                cursor="hand2"
            )
            pill.pack(side=tk.LEFT, padx=2)
            pill.bind("<Button-1>", lambda e, val=cmd_val: self.send_input_text(val))

        # 4. 底部交互输入栏
        self.input_bar = tk.Frame(self, bg="#161b22", padx=10, pady=6)
        self.input_bar.pack(side=tk.BOTTOM, fill=tk.X)

        # 提示符 ❯
        self.prompt_lbl = tk.Label(self.input_bar, text="❯", fg="#38bdf8", bg="#161b22", font=("Consolas", 12, "bold"))
        self.prompt_lbl.pack(side=tk.LEFT, padx=(2, 6))

        # 输入框
        self.entry_input = tk.Entry(
            self.input_bar,
            bg="#0d1117",
            fg="#f0f6fc",
            insertbackground="#38bdf8",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#30363d",
            highlightcolor="#38bdf8",
            font=(font_family, 10)
        )
        self.entry_input.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=4, padx=(0, 8))
        self.entry_input.bind("<Return>", lambda e: self._on_enter_pressed())

        # 发送按钮
        self.btn_send = tk.Button(
            self.input_bar,
            text="发送 (Enter)",
            bg="#238636",
            fg="#ffffff",
            activebackground="#2ea043",
            activeforeground="#ffffff",
            relief="flat",
            font=("微软雅黑", 8, "bold"),
            padx=10,
            command=self._on_enter_pressed
        )
        self.btn_send.pack(side=tk.LEFT)

    def _config_ansi_tags(self, font_family):
        self.text_area.tag_configure("ansi_red", foreground="#ff7b72")
        self.text_area.tag_configure("ansi_green", foreground="#7ee787")
        self.text_area.tag_configure("ansi_yellow", foreground="#f2cc60")
        self.text_area.tag_configure("ansi_blue", foreground="#79c0ff")
        self.text_area.tag_configure("ansi_magenta", foreground="#d2a8ff")
        self.text_area.tag_configure("ansi_cyan", foreground="#56d4dd")
        self.text_area.tag_configure("ansi_white", foreground="#f0f6fc")
        self.text_area.tag_configure("ansi_gray", foreground="#8b949e")

        self.text_area.tag_configure("ansi_bg_blue", background="#1e3a8a")
        self.text_area.tag_configure("ansi_bg_cyan", background="#134e4a")
        self.text_area.tag_configure("ansi_bold", font=(font_family, 10, "bold"))

        # 用户交互输入展示专用 tag
        self.text_area.tag_configure("user_input", foreground="#38bdf8", font=(font_family, 10, "bold"))
        self.text_area.tag_configure("sys_hint", foreground="#6e7681", font=(font_family, 9, "italic"))

    def write_ansi(self, text):
        """解析 ANSI 控制序列并安全渲染至终端文本框"""
        if not text:
            return

        for tok in self.ANSI_TOKEN_RE.findall(text):
            if tok == '\r':
                # 回车：删除当前最后一行内容，支持进度条/Spinner单行刷新
                self.text_area.delete('end-1c linestart', 'end-1c')
            elif tok == '\n':
                self.text_area.insert('end', '\n')
            elif tok.startswith('\x1b['):
                cmd = tok[-1]
                param = tok[2:-1]

                if cmd == 'm':
                    # 颜色控制
                    if param in ('', '0'):
                        self._active_tags.clear()
                    elif param == '1':
                        self._active_tags.add('ansi_bold')
                    elif param in ('91', '31'):
                        self._active_tags.add('ansi_red')
                    elif param in ('92', '32'):
                        self._active_tags.add('ansi_green')
                    elif param in ('93', '33'):
                        self._active_tags.add('ansi_yellow')
                    elif param in ('94', '34'):
                        self._active_tags.add('ansi_blue')
                    elif param in ('95', '35'):
                        self._active_tags.add('ansi_magenta')
                    elif param in ('96', '36'):
                        self._active_tags.add('ansi_cyan')
                    elif param in ('97', '37'):
                        self._active_tags.add('ansi_white')
                    elif param in ('90', '30'):
                        self._active_tags.add('ansi_gray')
                    elif param == '44':
                        self._active_tags.add('ansi_bg_blue')
                    elif param == '46':
                        self._active_tags.add('ansi_bg_cyan')
                elif cmd == 'K':
                    # 清行
                    self.text_area.delete('end-1c linestart', 'end-1c')
                elif cmd == 'A':
                    # 光标上移 N 行
                    n = int(param) if param.isdigit() else 1
                    for _ in range(n):
                        self.text_area.delete('end-2c linestart', 'end-1c')
                elif cmd == 'J':
                    # 清屏 (不完全清除历史，仅追加优雅分割线)
                    self.text_area.insert('end', '\n─── 屏幕刷新 ───\n', ('sys_hint',))
            else:
                self.text_area.insert('end', tok, tuple(self._active_tags))

        self.text_area.see('end')

    def clear_terminal(self):
        self.text_area.delete('1.0', 'end')
        self._active_tags.clear()

    def set_running_status(self, is_running, pid=None):
        if is_running:
            pid_txt = f" (PID: {pid})" if pid else ""
            self.status_badge.config(text=f"● 运行中{pid_txt}", fg="#3fb950", bg="#1a3d24")
        else:
            self.status_badge.config(text="○ 空闲", fg="#8b949e", bg="#21262d")

    def send_input_text(self, text):
        if self.on_input_send:
            self.write_ansi(f"❯ {text}\n")
            self.on_input_send(text + "\n")

    def _on_enter_pressed(self):
        val = self.entry_input.get()
        self.entry_input.delete(0, tk.END)
        self.send_input_text(val)


# ============================================================
# 主 GUI 界面 (Apple 优雅风格整体布局)
# ============================================================
class UniversalShellGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PR 报告抽查工具 — Python 脚本通用热更新启动器")
        self.geometry("980x740")
        self.minsize(860, 620)

        # 苹果深色基底色
        self.configure(bg="#0b0f19")

        ensure_workspace()
        self.config = load_config()
        self.ver_info = load_version_info()
        self.is_updating = False

        # 进程管控
        self.process = None
        self.reader_thread = None

        self._apply_styles()
        self._build_ui()
        self._refresh_status()

        # 启动时自动就绪提示
        self.terminal.write_ansi(
            f"\033[96m\033[1m========================================================================\033[0m\n"
            f" \033[92m● Python 脚本通用热更新启动器已就绪\033[0m  [\033[93mv{self.ver_info.get('version', '1.0.0')}\033[0m]\n"
            f" • 架构：通用外壳隔离 + 核心抽查逻辑动态热更新 (免重复打包安装)\n"
            f" • 点击下方快捷按钮或输入选项数字即可在内置终端中直接交互抽查。\n"
            f"\033[96m========================================================================\033[0m\n\n"
        )

        # 自动启动核心脚本
        self.after(300, self._start_script_process)

    def _apply_styles(self):
        style = ttk.Style(self)
        try:
            style.theme_use('clam')
        except Exception:
            pass

        style.configure("TFrame", background="#0b0f19")
        style.configure("TCombobox", font=("微软雅黑", 9))

    def _build_ui(self):
        main_wrap = tk.Frame(self, bg="#0b0f19", padx=14, pady=12)
        main_wrap.pack(fill=tk.BOTH, expand=True)

        # 1. 顶部专业控制与状态栏卡片
        top_bar = tk.Frame(main_wrap, bg="#161f30", bd=1, relief="solid", highlightbackground="#223147", highlightthickness=1, padx=14, pady=10)
        top_bar.pack(side=tk.TOP, fill=tk.X, pady=(0, 10))

        # 左侧：脚本信息与版本
        info_left = tk.Frame(top_bar, bg="#161f30")
        info_left.pack(side=tk.LEFT, fill=tk.Y)

        title_row = tk.Frame(info_left, bg="#161f30")
        title_row.pack(anchor="w")

        tk.Label(title_row, text="🐍", font=("Apple Color Emoji", 15), bg="#161f30").pack(side=tk.LEFT, padx=(0, 6))
        self.lbl_app_name = tk.Label(title_row, text="PR 报告抽查工具", fg="#f0f6fc", bg="#161f30", font=("微软雅黑", 13, "bold"))
        self.lbl_app_name.pack(side=tk.LEFT, padx=(0, 8))

        self.lbl_version_badge = tk.Label(title_row, text="v1.0.0", fg="#38bdf8", bg="#0f2b48", font=("Consolas", 10, "bold"), padx=6, pady=1)
        self.lbl_version_badge.pack(side=tk.LEFT, padx=(0, 10))

        self.lbl_script_meta = tk.Label(info_left, text="核心文件: core_script.py · 大小: - KB", fg="#8b949e", bg="#161f30", font=("微软雅黑", 8))
        self.lbl_script_meta.pack(anchor="w", pady=(3, 0))

        # 中右侧：更新源选择与热更新按钮
        actions_right = tk.Frame(top_bar, bg="#161f30")
        actions_right.pack(side=tk.RIGHT, fill=tk.Y)

        src_row = tk.Frame(actions_right, bg="#161f30")
        src_row.pack(anchor="e", pady=(0, 6))

        tk.Label(src_row, text="更新源:", fg="#8b949e", bg="#161f30", font=("微软雅黑", 8)).pack(side=tk.LEFT, padx=(0, 4))
        self.source_names = [s["name"] for s in self.config.get("remote_sources", [])]
        self.source_combo = ttk.Combobox(src_row, values=self.source_names, state="readonly", width=26)
        active_id = self.config.get("active_source_id", "github")
        sources = self.config.get("remote_sources", [])
        active_idx = next((i for i, s in enumerate(sources) if s["id"] == active_id), 0)
        self.source_combo.current(active_idx)
        self.source_combo.pack(side=tk.LEFT, padx=(0, 8))
        self.source_combo.bind("<<ComboboxSelected>>", self._on_source_changed)

        # 热更新按钮
        self.btn_update = tk.Button(
            src_row,
            text="🔄 检查并在线热更新",
            bg="#0284c7",
            fg="#ffffff",
            activebackground="#0369a1",
            activeforeground="#ffffff",
            relief="flat",
            font=("微软雅黑", 8, "bold"),
            padx=9,
            pady=2,
            command=self._on_check_update
        )
        self.btn_update.pack(side=tk.LEFT)

        # 辅助操作行
        btn_sub_row = tk.Frame(actions_right, bg="#161f30")
        btn_sub_row.pack(anchor="e")

        self.btn_run_script = tk.Button(
            btn_sub_row,
            text="🚀 重启抽查会话",
            bg="#238636",
            fg="#ffffff",
            activebackground="#2ea043",
            activeforeground="#ffffff",
            relief="flat",
            font=("微软雅黑", 8, "bold"),
            padx=8,
            pady=1,
            command=self._restart_script_process
        )
        self.btn_run_script.pack(side=tk.LEFT, padx=(0, 6))

        btn_open = tk.Button(
            btn_sub_row,
            text="📂 脚本目录",
            bg="#21262d",
            fg="#c9d1d9",
            activebackground="#30363d",
            activeforeground="#ffffff",
            relief="flat",
            font=("微软雅黑", 8),
            padx=6,
            pady=1,
            command=self._on_open_dir
        )
        btn_open.pack(side=tk.LEFT, padx=(0, 4))

        btn_data = tk.Button(
            btn_sub_row,
            text="📁 数据目录",
            bg="#21262d",
            fg="#c9d1d9",
            activebackground="#30363d",
            activeforeground="#ffffff",
            relief="flat",
            font=("微软雅黑", 8),
            padx=6,
            pady=1,
            command=self._on_open_data_dir
        )
        btn_data.pack(side=tk.LEFT, padx=(0, 4))

        btn_bak = tk.Button(
            btn_sub_row,
            text="⏪ 备份回滚",
            bg="#21262d",
            fg="#c9d1d9",
            activebackground="#30363d",
            activeforeground="#ffffff",
            relief="flat",
            font=("微软雅黑", 8),
            padx=6,
            pady=1,
            command=self._on_manage_backups
        )
        btn_bak.pack(side=tk.LEFT, padx=(0, 4))

        btn_log = tk.Button(
            btn_sub_row,
            text="ℹ️ 版本说明",
            bg="#21262d",
            fg="#c9d1d9",
            activebackground="#30363d",
            activeforeground="#ffffff",
            relief="flat",
            font=("微软雅黑", 8),
            padx=6,
            pady=1,
            command=self._on_view_changelog
        )
        btn_log.pack(side=tk.LEFT)

        # 2. 中间苹果风格内置交互终端
        self.terminal = AppleTerminalWidget(
            main_wrap,
            on_stop_cb=self._stop_script_process,
            on_restart_cb=self._restart_script_process
        )
        self.terminal.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self.terminal.on_input_send = self._send_to_process

    def _refresh_status(self):
        self.ver_info = load_version_info()
        ver = self.ver_info.get("version", "1.0.0")
        name = self.ver_info.get("name", "PR 报告抽查脚本")
        sz = self.ver_info.get("file_size_kb", 0)
        mtime = self.ver_info.get("actual_mtime", "-")

        self.lbl_app_name.config(text=name)
        self.lbl_version_badge.config(text=f"v{ver}")
        self.lbl_script_meta.config(text=f"核心文件: {CORE_SCRIPT_NAME} · 大小: {sz} KB · 修改时间: {mtime}")

    def _on_source_changed(self, event=None):
        idx = self.source_combo.current()
        sources = self.config.get("remote_sources", [])
        if 0 <= idx < len(sources):
            self.config["active_source_id"] = sources[idx]["id"]
            save_config(self.config)
            self.terminal.write_ansi(f"\n\033[96m[更新配置] 远端更新源已切换为：{sources[idx]['name']}\033[0m\n")

    def _start_script_process(self):
        """拉起内置进程并在内置终端中实时收发"""
        if self.process and self.process.poll() is None:
            self.terminal.write_ansi("\033[93m[提示] 脚本已经在运行中...\033[0m\n")
            return

        if not os.path.exists(CORE_SCRIPT_PATH):
            self.terminal.write_ansi(f"\033[91m[错误] 未找到核心脚本: {CORE_SCRIPT_PATH}\033[0m\n")
            return

        # 启动命令
        if IS_FROZEN:
            cmd = [sys.executable, '--run-core']
        else:
            cmd = [sys.executable, '-u', CORE_SCRIPT_PATH]

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["TERM"] = "xterm-256color"
        env["PYTHONIOENCODING"] = "utf-8"

        try:
            self.process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=APP_DIR,
                env=env,
                bufsize=0
            )

            self.terminal.set_running_status(True, pid=self.process.pid)
            self.btn_run_script.config(text="🔄 重启抽查会话")

            # 启动 stdout 读取线程
            def reader_worker():
                while self.process and self.process.poll() is None:
                    try:
                        raw = self.process.stdout.read(1)
                        if not raw:
                            break
                        char = raw.decode('utf-8', errors='replace')
                        self.after(0, lambda c=char: self.terminal.write_ansi(c))
                    except Exception:
                        break

                ret = self.process.poll() if self.process else -1
                self.after(0, lambda: self._on_process_terminated(ret))

            self.reader_thread = threading.Thread(target=reader_worker, daemon=True)
            self.reader_thread.start()

        except Exception as e:
            self.terminal.write_ansi(f"\033[91m[启动异常] 无法拉起脚本进程: {e}\033[0m\n")

    def _stop_script_process(self):
        """中止当前脚本进程"""
        if self.process and self.process.poll() is None:
            try:
                self.process.terminate()
                self.terminal.write_ansi("\n\033[93m[用户中断] 已向脚本进程发送终止信号...\033[0m\n")
            except Exception as e:
                self.terminal.write_ansi(f"\n\033[91m[终止失败] {e}\033[0m\n")
        else:
            self.terminal.write_ansi("\n\033[90m[提示] 当前无正在运行的脚本进程。\033[0m\n")

    def _restart_script_process(self):
        """重启脚本进程"""
        self._stop_script_process()
        self.terminal.write_ansi("\n\033[96m[正在重启核心抽查脚本...]\033[0m\n\n")
        self.after(400, self._start_script_process)

    def _on_process_terminated(self, ret_code):
        self.terminal.set_running_status(False)
        self.terminal.write_ansi(f"\n\033[90m[进程已退出，返回码: {ret_code}] 点击【🚀 重启抽查会话】可重新运行。\033[0m\n")

    def _send_to_process(self, text_with_nl):
        if self.process and self.process.poll() is None:
            try:
                self.process.stdin.write(text_with_nl.encode('utf-8'))
                self.process.stdin.flush()
            except Exception as e:
                self.terminal.write_ansi(f"\033[91m[输入错误] 无法写入进程 stdin: {e}\033[0m\n")
        else:
            self.terminal.write_ansi("\033[90m[提示] 进程未在运行，输入已被忽略。点击【🚀 重启抽查会话】可启动。\033[0m\n")

    def _on_check_update(self):
        if self.is_updating:
            return
        self.is_updating = True
        self.btn_update.config(state="disabled", text="⏳ 正在检查远端...")

        def update_worker():
            def progress_cb(msg):
                self.after(0, lambda: self.terminal.write_ansi(f"\033[96m[热更新动态] {msg}\033[0m\n"))

            try:
                ok, msg, new_ver = perform_update(self.config, on_progress=progress_cb)
                self.after(0, lambda: self._on_update_finished(ok, msg, new_ver))
            except Exception as e:
                self.after(0, lambda: self._on_update_finished(False, str(e), ""))

        threading.Thread(target=update_worker, daemon=True).start()

    def _on_update_finished(self, ok, msg, new_ver):
        self.is_updating = False
        self.btn_update.config(state="normal", text="🔄 检查并在线热更新")
        self._refresh_status()

        if ok:
            self.terminal.write_ansi(
                f"\n\033[92m\033[1m🎉 {msg}\033[0m\n"
                f"\033[92m当前核心脚本已更新至最新版 v{new_ver}！\033[0m\n"
                f"\033[96m无需重新安装客户端，点击上方【🚀 重启抽查会话】即可直接使用新代码！\033[0m\n\n"
            )
            messagebox.showinfo("热更新提示", f"{msg}\n\n当前核心版本：v{new_ver}\n下次启动或点击【重启】即可立即生效，免重新下载安装包！")
        else:
            self.terminal.write_ansi(f"\n\033[91m[更新提示] {msg}\033[0m\n\n")
            messagebox.showwarning("更新提示", msg)

    def _on_open_dir(self):
        try:
            if sys.platform == 'win32':
                os.startfile(APP_DIR)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', APP_DIR])
            else:
                subprocess.Popen(['xdg-open', APP_DIR])
            self.terminal.write_ansi(f"\033[90m[系统] 已打开脚本所在文件夹: {APP_DIR}\033[0m\n")
        except Exception as e:
            messagebox.showerror("打开目录失败", str(e))

    def _on_open_data_dir(self):
        try:
            os.makedirs(DATA_DIR_PATH, exist_ok=True)
            if sys.platform == 'win32':
                os.startfile(DATA_DIR_PATH)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', DATA_DIR_PATH])
            else:
                subprocess.Popen(['xdg-open', DATA_DIR_PATH])
            self.terminal.write_ansi(f"\033[90m[系统] 已打开数据表格存放目录: {DATA_DIR_PATH}\033[0m\n")
        except Exception as e:
            messagebox.showerror("打开数据目录失败", str(e))

    def _on_manage_backups(self):
        os.makedirs(BACKUP_DIR_PATH, exist_ok=True)
        files = sorted(os.listdir(BACKUP_DIR_PATH), reverse=True)
        if not files:
            messagebox.showinfo("备份管理", "当前尚无历史备份文件。\n每次在线热更新前都会在此自动创建安全备份。")
            return

        dlg = tk.Toplevel(self)
        dlg.title("历史备份回滚")
        dlg.geometry("520x360")
        dlg.configure(bg="#161b22")

        tk.Label(dlg, text="请选择要恢复的历史版本备份：", bg="#161b22", fg="#f0f6fc", font=("微软雅黑", 10, "bold")).pack(anchor="w", padx=16, pady=(16, 8))

        lb = tk.Listbox(dlg, bg="#0d1117", fg="#e6edf3", selectbackground="#1f6feb", font=("Consolas", 9), selectmode=tk.SINGLE)
        lb.pack(fill=tk.BOTH, expand=True, padx=16, pady=4)
        for f in files:
            lb.insert(tk.END, f)
        lb.select_set(0)

        def do_restore():
            sel = lb.curselection()
            if not sel:
                return
            fn = lb.get(sel[0])
            src = os.path.join(BACKUP_DIR_PATH, fn)
            try:
                shutil.copy2(src, CORE_SCRIPT_PATH)
                messagebox.showinfo("恢复成功", f"已成功将核心脚本恢复至备份：\n{fn}")
                dlg.destroy()
                self._refresh_status()
                self.terminal.write_ansi(f"\n\033[92m[备份回退成功] 核心脚本已恢复至：{fn}\033[0m\n")
            except Exception as e:
                messagebox.showerror("恢复失败", str(e))

        btn_row = tk.Frame(dlg, bg="#161b22")
        btn_row.pack(fill=tk.X, padx=16, pady=12)
        tk.Button(btn_row, text="恢复选中的备份", bg="#0284c7", fg="#ffffff", font=("微软雅黑", 9, "bold"), relief="flat", command=do_restore).pack(side=tk.RIGHT, padx=(6, 0))
        tk.Button(btn_row, text="取消", bg="#30363d", fg="#ffffff", font=("微软雅黑", 9), relief="flat", command=dlg.destroy).pack(side=tk.RIGHT)

    def _on_view_changelog(self):
        info = load_version_info()
        ver = info.get("version", "1.0.0")
        name = info.get("name", "PR 报告抽查脚本")
        updated = info.get("updated_at", "-")
        cl = info.get("changelog", "无详细变更日志")
        desc = info.get("description", "-")

        text = (
            f"【脚本名称】{name}\n"
            f"【当前版本】v{ver}\n"
            f"【发布时间】{updated}\n"
            f"【功能描述】{desc}\n\n"
            f"【版本说明与变更历史】\n{cl}\n\n"
            f"【内置苹果终端优势】\n"
            f"• 交互终端直接内置在 GUI 窗口内，告别弹出独立外部黑框窗口；\n"
            f"• 支持完整 ANSI 彩色字体与原地旋转进度条；\n"
            f"• 底部配备常用指令快捷点选条，点击即可执行，无需反复键盘输入。\n"
        )
        messagebox.showinfo(f"{name} — 版本详情", text)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--run-core':
        # 命令行直跑支持
        import runpy
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(line_buffering=True, write_through=True)
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(line_buffering=True, write_through=True)
        sys.path.insert(0, APP_DIR)
        runpy.run_path(CORE_SCRIPT_PATH, run_name='__main__')
        return

    app = UniversalShellGUI()
    app.mainloop()


if __name__ == '__main__':
    main()
