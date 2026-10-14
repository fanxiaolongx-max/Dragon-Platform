# -*- coding: utf-8 -*-
"""
Python 通用脚本启动器 (热更新版 · 苹果风格内置交互终端)
=========================================================
架构设计：
  1. 苹果风格内置终端 (Embedded Apple-Style Terminal)：
     - 采用明确的停止/清屏/重启按钮、极简标题栏与深色控制台设计；
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
import codecs
import queue
import tempfile
import traceback
import builtins
from datetime import datetime

# GUI 库 (Python 内置)
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

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
WORKER_EXE_NAME = 'PR-Audit-Worker.exe'


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
                "name": "PR小助手",
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

    ico_dest = os.path.join(APP_DIR, "app.ico")
    if not os.path.exists(ico_dest):
        bundled_ico = os.path.join(BUNDLE_DIR, "app.ico")
        if os.path.exists(bundled_ico):
            try:
                shutil.copy2(bundled_ico, ico_dest)
            except Exception:
                pass


def load_config():
    """读取更新源配置"""
    default_config = {
        "active_source_id": "github",
        "custom_url": "",
        "custom_version_url": "",
        "backup_on_update": True,
        "data_directory": "",
        "ui_scale": 1.0,
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
        _atomic_write(CONFIG_PATH, json.dumps(cfg, ensure_ascii=False, indent=2).encode('utf-8'))
        return True
    except Exception as e:
        print(f"[Error] 保存配置失败: {e}")
        return False


def configured_data_dir(config):
    value = str(config.get('data_directory') or '').strip()
    return os.path.abspath(os.path.join(APP_DIR, os.path.expanduser(value))) if value else DATA_DIR_PATH


def data_dir_setting(directory):
    directory = os.path.abspath(directory)
    try:
        if os.path.normcase(os.path.commonpath([APP_DIR, directory])) == os.path.normcase(APP_DIR):
            return os.path.relpath(directory, APP_DIR)
    except ValueError:
        pass
    return directory


def load_version_info():
    """读取本地核心脚本版本信息"""
    info = {
        "name": "PR小助手",
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
def validate_script(script_bytes):
    """只编译校验，不执行下载内容。"""
    script_text = script_bytes.decode('utf-8-sig')
    if not script_text.strip():
        raise ValueError("脚本内容为空")
    compile(script_text, CORE_SCRIPT_NAME, 'exec')


def _stage_file(path, content):
    fd, staged_path = tempfile.mkstemp(prefix='.updater-', dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        return staged_path
    except BaseException:
        os.unlink(staged_path)
        raise


def _atomic_write(path, content):
    staged_path = _stage_file(path, content)
    try:
        os.replace(staged_path, path)
    finally:
        if os.path.exists(staged_path):
            os.unlink(staged_path)


def _install_script(script_bytes, version_info):
    """先完成两个文件的写入，再替换；元数据替换失败时还原原脚本。"""
    validate_script(script_bytes)
    metadata_bytes = json.dumps(version_info, ensure_ascii=False, indent=2).encode('utf-8')
    old_script = None
    if os.path.exists(CORE_SCRIPT_PATH):
        with open(CORE_SCRIPT_PATH, 'rb') as stream:
            old_script = stream.read()
    staged_core = _stage_file(CORE_SCRIPT_PATH, script_bytes)
    staged_version = None
    core_replaced = False
    try:
        staged_version = _stage_file(VERSION_PATH, metadata_bytes)
        os.replace(staged_core, CORE_SCRIPT_PATH)
        core_replaced = True
        os.replace(staged_version, VERSION_PATH)
    except Exception:
        if core_replaced:
            if old_script is None:
                os.unlink(CORE_SCRIPT_PATH)
            else:
                _atomic_write(CORE_SCRIPT_PATH, old_script)
        raise
    finally:
        for staged_path in (staged_core, staged_version):
            if staged_path and os.path.exists(staged_path):
                os.unlink(staged_path)


def _backup_current_script(version_info):
    if not os.path.exists(CORE_SCRIPT_PATH):
        return
    os.makedirs(BACKUP_DIR_PATH, exist_ok=True)
    version = re.sub(r'[^a-zA-Z0-9._-]', '_', str(version_info.get('version', 'unknown')))
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    backup_path = os.path.join(BACKUP_DIR_PATH, f'core_script_v{version}_{timestamp}.py.bak')
    shutil.copy2(CORE_SCRIPT_PATH, backup_path)
    metadata = dict(version_info, sha256=version_info.get('actual_sha256', ''))
    _atomic_write(backup_path + '.version.json', json.dumps(metadata, ensure_ascii=False, indent=2).encode('utf-8'))


def restore_backup(backup_path):
    with open(backup_path, 'rb') as stream:
        script_bytes = stream.read()
    validate_script(script_bytes)
    digest = hashlib.sha256(script_bytes).hexdigest()
    metadata_path = backup_path + '.version.json'
    if os.path.exists(metadata_path):
        with open(metadata_path, encoding='utf-8') as stream:
            metadata = json.load(stream)
        if metadata.get('sha256') != digest:
            raise ValueError('备份脚本校验失败，请选择其他备份')
    else:
        # 兼容早期只有 .py.bak 的备份，但不沿用新脚本的版本标记。
        match = re.match(r'core_script_v(.+)_\d{8}_\d{6}\.py\.bak$', os.path.basename(backup_path))
        metadata = {'name': 'PR小助手', 'version': match.group(1) if match else 'restored',
                    'changelog': '从历史脚本备份恢复'}
    metadata.update(sha256=digest, updated_at=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    _backup_current_script(load_version_info())
    _install_script(script_bytes, metadata)


def iter_process_output(stream):
    """保留跨读取块的 UTF-8 字节，且一直读取到 EOF 以保留退出前输出。"""
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    while True:
        raw = stream.read(4096)
        if not raw:
            break
        text = decoder.decode(raw)
        if text:
            yield text
    tail = decoder.decode(b'', final=True)
    if tail:
        yield tail


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


def resolve_custom_urls(raw_input):
    """
    智能解析第三方源地址：
    支持完整 GitHub 仓库主页、分支路径、blob 文件地址、原始 raw 链接或通用 HTTP/HTTPS 脚本地址。
    """
    url = str(raw_input or '').strip().strip('\'"')
    if not url:
        return '', ''

    if 'github.com' in url:
        m_blob = re.match(r'https?://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)', url)
        if m_blob:
            owner, repo, branch, path = m_blob.groups()
            raw_base = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}"
            if path.endswith('.py'):
                parent = path.rsplit('/', 1)[0] if '/' in path else ''
                script_path = path
                ver_path = f"{parent}/version.json" if parent else "version.json"
            else:
                script_path = f"{path.rstrip('/')}/core_script.py"
                ver_path = f"{path.rstrip('/')}/version.json"
            return f"{raw_base}/{script_path}", f"{raw_base}/{ver_path}"

        m_tree = re.match(r'https?://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+)', url)
        if m_tree:
            owner, repo, branch, path = m_tree.groups()
            raw_base = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path.rstrip('/')}"
            return f"{raw_base}/core_script.py", f"{raw_base}/version.json"

        m_repo = re.match(r'https?://github\.com/([^/]+)/([^/]+)/?$', url)
        if m_repo:
            owner, repo = m_repo.groups()
            raw_base = f"https://raw.githubusercontent.com/{owner}/{repo}/main/python-packager"
            return f"{raw_base}/core_script.py", f"{raw_base}/version.json"

    if url.endswith('.py'):
        script_url = url
        ver_url = url.rsplit('/', 1)[0] + '/version.json'
        return script_url, ver_url

    if url.endswith('/'):
        return f"{url}core_script.py", f"{url}version.json"

    return url, ''


def perform_update(config, on_progress=None):
    active_id = config.get("active_source_id", "github")
    sources = config.get("remote_sources", [])
    active_src = next((s for s in sources if s["id"] == active_id), None)

    if not active_src:
        return False, "无效的更新源配置", ""

    if active_id == "custom":
        raw_custom = config.get("custom_url", "").strip()
        if not raw_custom:
            return False, "请填写自定义脚本下载或仓库 URL 地址", ""
        resolved_script, auto_ver = resolve_custom_urls(raw_custom)
        script_url = resolved_script or raw_custom
        ver_url = config.get("custom_version_url", "").strip() or auto_ver
    else:
        script_url = active_src.get("url", "")
        ver_url = active_src.get("version_url", "")

    if on_progress:
        on_progress("正在连接远端仓库获取最新版本信息...")

    remote_ver_data = None
    if ver_url:
        try:
            raw_ver = fetch_url(ver_url, timeout=10)
            remote_ver_data = json.loads(raw_ver.decode('utf-8-sig'))
            if not isinstance(remote_ver_data, dict):
                raise ValueError('version.json 必须是对象')
            if not re.fullmatch(r'[0-9a-fA-F]{64}', str(remote_ver_data.get('sha256', ''))):
                raise ValueError('version.json 缺少有效的 SHA-256 校验值')
        except Exception as e:
            if active_id != "custom":
                return False, f"获取版本校验信息失败，已保留原脚本: {e}", ""
            remote_ver_data = None

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
        validate_script(new_script_bytes)
    except (UnicodeDecodeError, SyntaxError, ValueError) as e:
        return False, f"下载的文件不是有效的 UTF-8 Python 脚本，已保留原脚本: {e}", ""

    new_sha256 = hashlib.sha256(new_script_bytes).hexdigest()
    if remote_ver_data and remote_ver_data['sha256'].lower() != new_sha256:
        return False, "脚本 SHA-256 与版本信息不一致，已保留原脚本，请稍后重试", ""
    current_ver = load_version_info()
    target_ver = remote_ver_data or {}
    updated_ver_info = {
        "name": target_ver.get("name", current_ver.get("name", "PR小助手")),
        "version": target_ver.get("version", f"{current_ver.get('version', '1.0.0')}.hotfix"),
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "description": target_ver.get("description", "从远端热更新的核心脚本"),
        "sha256": new_sha256,
        "changelog": target_ver.get("changelog", "通过 Universal Shell 在线热更新完成")
    }

    try:
        if current_ver.get('actual_sha256') == new_sha256:
            updated_ver_info['version'] = target_ver.get('version', current_ver.get('version', '1.0.0'))
            _atomic_write(VERSION_PATH, json.dumps(updated_ver_info, ensure_ascii=False, indent=2).encode('utf-8'))
            return True, "当前本地脚本已是最新代码，无需更新！", updated_ver_info['version']
        if config.get('backup_on_update', True):
            if on_progress:
                on_progress('正在自动备份当前版本...')
            _backup_current_script(current_ver)
        if on_progress:
            on_progress('正在写入最新核心脚本...')
        _install_script(new_script_bytes, updated_ver_info)
    except Exception as e:
        return False, f"更新未完成: {e}", ""

    return True, f"热更新成功！最新代码已写入部署，大小: {round(len(new_script_bytes)/1024, 2)} KB", updated_ver_info["version"]


# ============================================================
# 苹果风格内置终端控件 (AppleTerminalWidget)
# ============================================================
class AnsiScreen:
    """终端字符屏幕：光标移动覆盖已有内容，清屏不追加历史菜单。"""
    COLORS = {'31': 'red', '91': 'red', '32': 'green', '92': 'green',
              '33': 'yellow', '93': 'yellow', '34': 'blue', '94': 'blue',
              '35': 'magenta', '95': 'magenta', '36': 'cyan', '96': 'cyan',
              '37': 'white', '97': 'white', '30': 'gray', '90': 'gray'}

    def __init__(self):
        self.lines = [[]]
        self.row = self.column = 0
        self.tags = set()
        self.pending = ''
        self.awaiting_input = False

    def clear(self):
        self.lines = [[]]
        self.row = self.column = 0

    def _line(self):
        while len(self.lines) <= self.row:
            self.lines.append([])
        return self.lines[self.row]

    def _put(self, char):
        line = self._line()
        while len(line) <= self.column:
            line.append((' ', ()))
        line[self.column] = (char, tuple(sorted(self.tags)))
        self.column += 1

    def _erase_after_cursor(self):
        del self._line()[self.column:]
        del self.lines[self.row + 1:]

    def _sgr(self, params):
        for code in (params or '0').split(';'):
            if code == '0':
                self.tags.clear()
            elif code == '1':
                self.tags.add('ansi_bold')
            elif code == '22':
                self.tags.discard('ansi_bold')
            elif code in self.COLORS or code == '39':
                self.tags.difference_update('ansi_' + color for color in set(self.COLORS.values()))
                if code in self.COLORS:
                    self.tags.add('ansi_' + self.COLORS[code])
            elif code in ('44', '46', '49'):
                self.tags.difference_update(('ansi_bg_blue', 'ansi_bg_cyan'))
                if code != '49':
                    self.tags.add('ansi_bg_blue' if code == '44' else 'ansi_bg_cyan')

    def _csi(self, params, command):
        numbers = [int(part) if part.isdigit() else 0 for part in params.split(';')]
        amount = max(1, numbers[0])
        if command == 'm':
            self._sgr(params)
        elif command in ('H', 'f'):
            self.row = min(10000, max(0, amount - 1))
            self.column = min(4000, max(0, (numbers[1] or 1) - 1)) if len(numbers) > 1 else 0
        elif command == 'A':
            self.row = max(0, self.row - amount)
        elif command == 'B':
            self.row = min(10000, self.row + amount)
        elif command == 'C':
            self.column = min(4000, self.column + amount)
        elif command == 'D':
            self.column = max(0, self.column - amount)
        elif command == 'G':
            self.column = min(4000, amount - 1)
        elif command == 'J':
            if numbers[0] in (2, 3):
                self.clear()
            elif numbers[0] == 0:
                self._erase_after_cursor()
        elif command == 'K':
            line = self._line()
            if numbers[0] == 2:
                line.clear()
            elif numbers[0] == 1:
                for index in range(min(self.column + 1, len(line))):
                    line[index] = (' ', ())
            else:
                del line[self.column:]

    def feed(self, text):
        text = self.pending + text
        self.pending = ''
        position = 0
        while position < len(text):
            char = text[position]
            if char == '\x1b':
                remaining = text[position:]
                if remaining == '\x1b':
                    self.pending = remaining
                    break
                if remaining.startswith('\x1b['):
                    match = re.match(r'\x1b\[([0-9;?]*)([@-~])', remaining)
                    if not match:
                        if re.fullmatch(r'\x1b\[[0-9;?]*', remaining):
                            self.pending = remaining
                            break
                        position += 2
                        continue
                    self._csi(*match.groups())
                    position += match.end()
                    continue
                if remaining.startswith('\x1b]'):
                    end = remaining.find('\x07')
                    if end < 0:
                        self.pending = remaining
                        break
                    marker = remaining[2:end]
                    if marker == '777;input;on':
                        self.awaiting_input = True
                        self._erase_after_cursor()
                    elif marker == '777;input;off':
                        self.awaiting_input = False
                    position += end + 1
                    continue
                position += 2
                continue
            if char == '\r':
                self.column = 0
            elif char == '\n':
                self.row += 1
                self.column = 0
                self._line()
            elif char == '\b':
                self.column = max(0, self.column - 1)
            elif char == '\t':
                for _ in range(8 - self.column % 8):
                    self._put(' ')
            elif ord(char) >= 32:
                self._put(char)
            position += 1

    def echo_input(self, text):
        for char in text:
            self._put(char)
        self.feed('\n')
        self.awaiting_input = False

    def text(self):
        return '\n'.join(''.join(char for char, _ in line) for line in self.lines)


class PromptText(tk.Text):
    """只允许编辑当前提示后的输入，保留原生选择、复制、粘贴及中文输入法。"""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.program_edit = False
        self.allow_input = False
        self.mark_set('input_start', '1.0')
        self.mark_gravity('input_start', tk.LEFT)
        self._original = self._w + '_original'
        self.tk.call('rename', self._w, self._original)
        self.tk.createcommand(self._w, self._proxy)

    def _proxy(self, *args):
        if args and args[0] in ('insert', 'delete', 'replace') and not self.program_edit:
            if not self.allow_input:
                return ''
            args = list(args)
            if args[0] == 'insert':
                if self.compare(args[1], '<', 'input_start'):
                    args[1] = 'end-1c'
                    self.mark_set('insert', 'end-1c')
                    self.tag_remove('sel', '1.0', 'end')
                args[2] = str(args[2]).replace('\r', ' ').replace('\n', ' ')
            else:
                start = self.index(args[1])
                end = self.index(args[2]) if len(args) > 2 else self.index(f'{start}+1c')
                if self.compare(start, '<', 'input_start'):
                    start = self.index('input_start')
                if self.compare(end, '>', 'end-1c'):
                    end = self.index('end-1c')
                if args[0] == 'delete' and not self.compare(start, '<', end):
                    return ''
                if self.compare(end, '<', start):
                    end = start
                args[1:3] = [start, end]
                if args[0] == 'replace':
                    args[3] = str(args[3]).replace('\r', ' ').replace('\n', ' ')
        try:
            return self.tk.call(self._original, *args)
        except tk.TclError as e:
            if 'characters tagged with "sel"' in str(e):
                return ''
            raise

    def destroy(self):
        self.tk.deletecommand(self._w)
        self.tk.call('rename', self._original, self._w)
        super().destroy()


class AppleTerminalWidget(tk.Frame):
    """
    优雅、专业、美观的苹果风格内置交互控制台
    - 明确的停止、清屏、重启操作按钮
    - 完整支持 ANSI 8/16 色与粗体映射
    - 支持 Carriage Return (\\r) 原地刷新与多步任务旋转进度条
    - 在提示后直接输入，Enter 确认，历史输出受保护
    - 快捷操作小药丸按键栏 (一键点选菜单项，免键盘盲打)
    """

    ANSI_TOKEN_RE = re.compile(r'(\x1b\[[0-9;]*[a-zA-Z]|\r|\n|[^\x1b\r\n]+)')

    def __init__(self, master, on_stop_cb=None, on_restart_cb=None, on_ctrl_c_cb=None):
        super().__init__(master, bg="#0d1117", bd=1, relief="solid", highlightbackground="#30363d", highlightthickness=1)
        self.on_stop_cb = on_stop_cb
        self.on_restart_cb = on_restart_cb
        self.on_ctrl_c_cb = on_ctrl_c_cb
        self.on_input_send = None

        self.screen = AnsiScreen()
        self.history = []
        self.history_position = 0
        self.history_draft = ''
        self.quick_pills = []
        self._build_terminal_ui()

    def _build_terminal_ui(self):
        # 1. 顶部 macOS 风格标题栏
        self.title_bar = tk.Frame(self, bg="#161b22", height=34, padx=10)
        self.title_bar.pack(side=tk.TOP, fill=tk.X)
        self.title_bar.pack_propagate(False)

        controls_frame = tk.Frame(self.title_bar, bg="#161b22")
        controls_frame.pack(side=tk.LEFT, fill=tk.Y, padx=(0, 8))
        controls = [
            ('btn_stop', '■ 停止', '#ff7b72', '#3b1d25',
             lambda: self.on_stop_cb() if self.on_stop_cb else None),
            ('btn_clear', '⌫ 清屏', '#f2cc60', '#312719', self.clear_terminal),
            ('btn_restart', '↻ 重启', '#7ee787', '#173426',
             lambda: self.on_restart_cb() if self.on_restart_cb else None),
        ]
        for name, label, foreground, background, command in controls:
            button = tk.Button(
                controls_frame, text=label, fg=foreground, bg=background,
                activeforeground=foreground, activebackground='#30363d',
                font=('微软雅黑', 8), relief='flat', bd=0,
                padx=7, pady=2, cursor='hand2', command=command
            )
            button.pack(side=tk.LEFT, padx=(0, 4), pady=4)
            setattr(self, name, button)

        # 居中标题
        self.lbl_title = tk.Label(
            self.title_bar,
            text="Python — 抽查脚本交互终端 (core_script.py)",
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

        # 2. 终端主体文本框 (Text + Scrollbar)
        body_frame = tk.Frame(self, bg="#0d1117")
        body_frame.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # 优先选择美观等宽字体
        font_family = "Menlo" if sys.platform == 'darwin' else "Consolas"

        self.text_area = PromptText(
            body_frame,
            bg="#0d1117",
            fg="#c9d1d9",
            insertbackground="#58a6ff",
            selectbackground="#1f6feb",
            selectforeground="#ffffff",
            font=(font_family, 10),
            wrap=tk.NONE,
            relief="flat",
            bd=0,
            padx=12,
            pady=10
        )
        self.text_area.configure(exportselection=False)
        self.text_area.bind('<Return>', self._on_enter_pressed)
        self.text_area.bind('<KP_Enter>', self._on_enter_pressed)
        self.text_area.bind('<Up>', lambda event: self._history_key(event, -1))
        self.text_area.bind('<Down>', lambda event: self._history_key(event, 1))
        self.text_area.bind('<Home>', self._input_home)
        self.text_area.bind('<Tab>', lambda event: 'break')
        self.text_area.bind('<Control-a>', self._select_output)
        self.text_area.bind('<Control-c>', self._on_terminal_ctrl_c)
        self.text_area.bind('<Control-C>', self._on_terminal_ctrl_c)
        if sys.platform == 'darwin':
            self.text_area.bind('<Command-a>', self._select_output)
            self.text_area.bind('<Command-c>', self._on_terminal_ctrl_c)
            self.text_area.bind('<Command-C>', self._on_terminal_ctrl_c)
        self.text_area.grid(row=0, column=0, sticky='nsew')

        scrollbar = ttk.Scrollbar(body_frame, orient=tk.VERTICAL, command=self.text_area.yview)
        scrollbar.grid(row=0, column=1, sticky='ns')
        self.text_area.configure(yscrollcommand=scrollbar.set)
        horizontal = ttk.Scrollbar(body_frame, orient=tk.HORIZONTAL, command=self.text_area.xview)
        horizontal.grid(row=1, column=0, sticky='ew')
        self.text_area.configure(xscrollcommand=horizontal.set)
        body_frame.rowconfigure(0, weight=1)
        body_frame.columnconfigure(0, weight=1)

        # 配置 ANSI 颜色标签
        self._config_ansi_tags(font_family)

        # 3. 底部快捷操作小药丸行 (点击直接发送指令，提升易用性)
        self.quick_bar = tk.Frame(self, bg="#161b22", padx=10, pady=4)
        self.quick_bar.pack(side=tk.TOP, fill=tk.X)

        self.quick_bar_label = tk.Label(self.quick_bar, text="常用选项快捷点选：", fg="#6e7681", bg="#161b22", font=("微软雅黑", 8))
        self.quick_bar_label.pack(side=tk.LEFT, padx=(0, 4))

        quick_commands = [
            ("1 开始抽查", "1"),
            ("2 设置比例", "2"),
            ("3 抽查范围", "3"),
            ("4 抽样策略", "4"),
            ("5 查看配置", "5"),
            ("6 自动合并", "6"),
            ("7 立即合并", "7"),
            ("0 退出", "0"),
            ("⏎ 回车确认", ""),
        ]

        self.quick_pills = []
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
            self.quick_pills.append(pill)

        self.input_hint = tk.Label(self, text='在提示后直接输入 · Enter 确认 · ↑↓ 历史 · Ctrl+C 复制/中断',
                                   bg='#161b22', fg='#8b949e', font=('微软雅黑', 8), anchor='w', padx=12, pady=5)
        self.input_hint.pack(side=tk.BOTTOM, fill=tk.X)

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

    def _on_terminal_ctrl_c(self, event=None):
        try:
            if self.text_area.tag_ranges('sel'):
                text = self.text_area.get('sel.first', 'sel.last')
                if text:
                    self.clipboard_clear()
                    self.clipboard_append(text)
                    return 'break'
        except tk.TclError:
            pass

        if self.on_ctrl_c_cb:
            self.on_ctrl_c_cb()
        return 'break'

    def apply_ui_scale(self, s):
        font_family = "Menlo" if sys.platform == 'darwin' else "Consolas"
        base_size = max(9, int(round(10 * s)))
        small_size = max(7, int(round(8 * s)))
        title_size = max(8, int(round(9 * s)))

        self.text_area.configure(font=(font_family, base_size))
        self.text_area.tag_configure("ansi_bold", font=(font_family, base_size, "bold"))
        self.text_area.tag_configure("user_input", font=(font_family, base_size, "bold"))
        self.text_area.tag_configure("sys_hint", font=(font_family, max(8, base_size - 1), "italic"))

        self.lbl_title.configure(font=("Consolas", title_size, "bold"))
        self.status_badge.configure(font=("微软雅黑", small_size, "bold"))
        self.input_hint.configure(font=("微软雅黑", small_size))

        for btn in [self.btn_stop, self.btn_clear, self.btn_restart]:
            btn.configure(font=("微软雅黑", small_size))

        if hasattr(self, 'quick_bar_label'):
            self.quick_bar_label.configure(font=("微软雅黑", small_size))

        if hasattr(self, 'quick_pills'):
            for pill in self.quick_pills:
                pill.configure(font=("Consolas", small_size, "bold"))

    def _select_output(self, event=None):
        start = 'input_start' if self.screen.awaiting_input else '1.0'
        self.text_area.tag_add('sel', start, 'end-1c')
        return 'break'

    def _input_home(self, event=None):
        if event is not None and event.state & 5:
            return None
        if self.screen.awaiting_input:
            self.text_area.mark_set('insert', 'input_start')
            return 'break'

    def _draft(self):
        return self.text_area.get('input_start', 'end-1c') if self.text_area.allow_input else ''

    def _refresh_view(self, draft=''):
        area = self.text_area
        area.program_edit = True
        try:
            area.delete('1.0', 'end')
            for row, line in enumerate(self.screen.lines):
                if row:
                    area.insert('end', '\n')
                chunk, active_tags = '', ()
                for char, tags in line:
                    if tags != active_tags and chunk:
                        area.insert('end', chunk, active_tags)
                        chunk = ''
                    active_tags = tags
                    chunk += char
                if chunk:
                    area.insert('end', chunk, active_tags)
            area.mark_set('input_start', 'end-1c')
            area.allow_input = self.screen.awaiting_input
            if area.allow_input and draft:
                area.insert('end', draft, ('user_input',))
            area.mark_set('insert', 'end-1c')
            area.configure(insertontime=600 if area.allow_input else 0)
        finally:
            area.program_edit = False
        self.input_hint.config(text='在提示后直接输入 · Enter 确认 · ↑↓ 历史 · Ctrl+C 复制' if area.allow_input
                               else '脚本处理中或已退出 · 回显可选中复制')
        area.see('end')

    def write_ansi(self, text):
        if not text:
            return
        draft = self._draft()
        self.screen.feed(text)
        self._refresh_view(draft)

    def clear_terminal(self):
        draft = self._draft()
        prompt = list(self.screen._line()[:self.screen.column]) if self.screen.awaiting_input else []
        self.screen.clear()
        if prompt:
            self.screen.lines = [prompt]
            self.screen.column = len(prompt)
        self._refresh_view(draft)

    def _history_move(self, direction):
        if self.screen.awaiting_input and self.history:
            if self.history_position == len(self.history):
                self.history_draft = self._draft()
            self.history_position = max(0, min(len(self.history), self.history_position + direction))
            draft = self.history_draft if self.history_position == len(self.history) else self.history[self.history_position]
            self._refresh_view(draft)
        return 'break'

    def _history_key(self, event, direction):
        if event.state & 5:
            return None
        return self._history_move(direction)

    def set_running_status(self, is_running, pid=None):
        if is_running:
            pid_txt = f" (PID: {pid})" if pid else ""
            self.status_badge.config(text=f"● 运行中{pid_txt}", fg="#3fb950", bg="#1a3d24")
        else:
            self.status_badge.config(text="○ 空闲", fg="#8b949e", bg="#21262d")

    def send_input_text(self, text):
        if not self.screen.awaiting_input or not self.on_input_send:
            return False
        text = text.replace('\r', ' ').replace('\n', ' ')
        if self.on_input_send(text + '\n') is False:
            return False
        if text and (not self.history or self.history[-1] != text):
            self.history.append(text)
        self.history_position = len(self.history)
        self.history_draft = ''
        self.screen.echo_input(text)
        self._refresh_view()
        self.text_area.focus_set()
        return True

    def _on_enter_pressed(self, event=None):
        self.send_input_text(self._draft())
        return 'break'


# ============================================================
# 主 GUI 界面 (Apple 优雅风格整体布局)
# ============================================================
class UniversalShellGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PR小助手 — Python 脚本通用热更新启动器")
        self.geometry("980x740")
        self.minsize(860, 620)

        # 苹果深色基底色
        self.configure(bg="#0b0f19")

        # 加载应用图标（Windows 任务栏与窗口标题栏）
        ico_candidates = [
            os.path.join(BUNDLE_DIR, "app.ico"),
            os.path.join(APP_DIR, "app.ico"),
        ]
        for ico in ico_candidates:
            if os.path.exists(ico):
                try:
                    self.iconbitmap(ico)
                    break
                except Exception:
                    pass

        ensure_workspace()
        self.config = load_config()
        self.ver_info = load_version_info()
        self.ui_scale = float(self.config.get("ui_scale", 1.0))
        self.is_updating = False

        # 进程管控
        self.process = None
        self.reader_thread = None
        self.ui_events = queue.Queue()
        self._closing = False
        self._close_requested = False
        self._restart_pending = False
        self._custom_url_timer = None
        self._last_ctrl_c_time = 0
        self.protocol('WM_DELETE_WINDOW', self._on_close)

        self._apply_styles()
        self._build_ui()
        self._refresh_status()
        self._apply_ui_scale(self.ui_scale, persist=False)

        # 启动时自动就绪提示
        self.terminal.write_ansi(
            f"\033[96m\033[1m========================================================================\033[0m\n"
            f" \033[92m● PR小助手已就绪\033[0m  [\033[93mv{self.ver_info.get('version', '1.0.0')}\033[0m]\n"
            f" • 架构：通用外壳隔离 + 核心抽查逻辑动态热更新 (免重复打包安装)\n"
            f" • 点击下方快捷按钮或输入选项数字即可在内置终端中直接交互抽查。\n"
            f"\033[96m========================================================================\033[0m\n\n"
        )

        # 自动启动核心脚本
        self.after(30, self._drain_ui_events)
        self.after(300, self._start_script_process)

    def _drain_ui_events(self):
        if self._closing:
            return
        for _ in range(100):
            try:
                callback, args = self.ui_events.get_nowait()
            except queue.Empty:
                break
            callback(*args)
        self.after(30, self._drain_ui_events)

    def _on_close(self):
        if self.is_updating:
            if not self._close_requested:
                self.terminal.write_ansi('\n[提示] 正在完成脚本更新，完成后将自动关闭窗口。\n')
            self._close_requested = True
            return
        self._closing = True
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=1)
        self.destroy()

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
        info_left.pack(side=tk.TOP, fill=tk.X, pady=(0, 8))

        title_row = tk.Frame(info_left, bg="#161f30")
        title_row.pack(side=tk.TOP, fill=tk.X)

        title_left = tk.Frame(title_row, bg="#161f30")
        title_left.pack(side=tk.LEFT)

        tk.Label(title_left, text="🐍", font=("Apple Color Emoji", 15), bg="#161f30").pack(side=tk.LEFT, padx=(0, 6))
        self.lbl_app_name = tk.Label(title_left, text="PR小助手", fg="#f0f6fc", bg="#161f30", font=("微软雅黑", 13, "bold"))
        self.lbl_app_name.pack(side=tk.LEFT, padx=(0, 8))

        self.lbl_version_badge = tk.Label(title_left, text="v1.0.0", fg="#38bdf8", bg="#0f2b48", font=("Consolas", 10, "bold"), padx=6, pady=1)
        self.lbl_version_badge.pack(side=tk.LEFT, padx=(0, 10))

        # 右上角：界面等比缩放控制器（高分屏缩放适配）
        self.zoom_frame = tk.Frame(title_row, bg="#161f30")
        self.zoom_frame.pack(side=tk.RIGHT)

        self.lbl_zoom_title = tk.Label(self.zoom_frame, text="缩放:", fg="#8b949e", bg="#161f30", font=("微软雅黑", 8))
        self.lbl_zoom_title.pack(side=tk.LEFT, padx=(0, 4))

        self.btn_zoom_out = tk.Button(
            self.zoom_frame, text="🔍－", bg="#21262d", fg="#79c0ff",
            activebackground="#30363d", activeforeground="#ffffff", relief="flat", bd=0,
            font=("微软雅黑", 8, "bold"), padx=5, pady=1, cursor="hand2",
            command=self._on_zoom_out
        )
        self.btn_zoom_out.pack(side=tk.LEFT, padx=1)

        self.lbl_zoom_level = tk.Label(
            self.zoom_frame, text=f"{int(round(self.ui_scale * 100))}%",
            fg="#38bdf8", bg="#0f2b48", font=("Consolas", 8, "bold"),
            padx=6, pady=2, cursor="hand2"
        )
        self.lbl_zoom_level.pack(side=tk.LEFT, padx=2)
        self.lbl_zoom_level.bind("<Button-1>", lambda e: self._on_zoom_reset())

        self.btn_zoom_in = tk.Button(
            self.zoom_frame, text="🔍＋", bg="#21262d", fg="#79c0ff",
            activebackground="#30363d", activeforeground="#ffffff", relief="flat", bd=0,
            font=("微软雅黑", 8, "bold"), padx=5, pady=1, cursor="hand2",
            command=self._on_zoom_in
        )
        self.btn_zoom_in.pack(side=tk.LEFT, padx=1)

        self.lbl_script_meta = tk.Label(info_left, text="核心文件: core_script.py · 大小: - KB", fg="#8b949e", bg="#161f30", font=("微软雅黑", 8))
        self.lbl_script_meta.pack(anchor="w", pady=(3, 0))
        self.lbl_data_dir = tk.Label(info_left, bg='#161f30', fg='#79c0ff', font=('微软雅黑', 8),
                                     anchor='w', justify=tk.LEFT, wraplength=820)
        self.lbl_data_dir.pack(anchor='w', pady=(3, 0))

        # 中右侧：更新源选择与热更新按钮
        actions_right = tk.Frame(top_bar, bg="#161f30")
        actions_right.pack(side=tk.TOP, fill=tk.X)

        src_row = tk.Frame(actions_right, bg="#161f30")
        src_row.pack(anchor="w", pady=(0, 6))

        tk.Label(src_row, text="更新源:", fg="#8b949e", bg="#161f30", font=("微软雅黑", 8)).pack(side=tk.LEFT, padx=(0, 4))
        self.source_names = [s["name"] for s in self.config.get("remote_sources", [])]
        self.source_combo = ttk.Combobox(src_row, values=self.source_names, state="readonly", width=22)
        active_id = self.config.get("active_source_id", "github")
        sources = self.config.get("remote_sources", [])
        active_idx = next((i for i, s in enumerate(sources) if s["id"] == active_id), 0)
        self.source_combo.current(active_idx)
        self.source_combo.pack(side=tk.LEFT, padx=(0, 8))
        self.source_combo.bind("<<ComboboxSelected>>", self._on_source_changed)

        # 第三方源地址输入容器（当且仅当选择第三方源时在下拉旁边自动展开）
        self.custom_url_frame = tk.Frame(src_row, bg="#161f30")
        tk.Label(self.custom_url_frame, text="仓库/脚本地址:", fg="#38bdf8", bg="#161f30", font=("微软雅黑", 8, "bold")).pack(side=tk.LEFT, padx=(0, 4))
        self.custom_url_var = tk.StringVar(value=self.config.get("custom_url", ""))
        self.custom_url_entry = tk.Entry(
            self.custom_url_frame,
            textvariable=self.custom_url_var,
            bg="#0d1117",
            fg="#f0f6fc",
            insertbackground="#f0f6fc",
            font=("Consolas", 8),
            width=32,
            relief="solid",
            bd=1,
            highlightthickness=1,
            highlightcolor="#38bdf8",
            highlightbackground="#30363d"
        )
        self.custom_url_entry.pack(side=tk.LEFT)
        self.custom_url_entry.bind("<FocusOut>", self._on_custom_url_changed)
        self.custom_url_entry.bind("<Return>", self._on_custom_url_changed)
        self.custom_url_var.trace_add("write", self._on_custom_url_keystroke)

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

        self._toggle_custom_source_input()

        # 辅助操作行
        btn_sub_row = tk.Frame(actions_right, bg="#161f30")
        btn_sub_row.pack(anchor="w")

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
            text="📁 设置数据目录",
            bg="#21262d",
            fg="#c9d1d9",
            activebackground="#30363d",
            activeforeground="#ffffff",
            relief="flat",
            font=("微软雅黑", 8),
            padx=6,
            pady=1,
            command=self._on_choose_data_dir
        )
        btn_data.pack(side=tk.LEFT, padx=(0, 4))
        btn_open_data = tk.Button(btn_sub_row, text='打开数据目录', bg='#21262d', fg='#c9d1d9',
                  activebackground='#30363d', activeforeground='#ffffff', relief='flat',
                  font=('微软雅黑', 8), padx=6, pady=1, command=self._on_open_data_dir)
        btn_open_data.pack(side=tk.LEFT, padx=(0, 4))

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

        self._sub_action_buttons = [btn_open, btn_data, btn_open_data, btn_bak, btn_log]
        self._scaled_labels = [self.lbl_script_meta, self.lbl_data_dir, self.lbl_zoom_title]

        # 2. 中间苹果风格内置交互终端
        self.terminal = AppleTerminalWidget(
            main_wrap,
            on_stop_cb=self._stop_script_process,
            on_restart_cb=self._restart_script_process,
            on_ctrl_c_cb=self._handle_terminal_ctrl_c
        )
        self.terminal.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self.terminal.on_input_send = self._send_to_process

        self.bind('<Control-c>', self._on_window_ctrl_c)
        self.bind('<Control-C>', self._on_window_ctrl_c)
        if sys.platform == 'darwin':
            self.bind('<Command-c>', self._on_window_ctrl_c)
            self.bind('<Command-C>', self._on_window_ctrl_c)

    def _refresh_status(self):
        self.ver_info = load_version_info()
        ver = self.ver_info.get("version", "1.0.0")
        name = self.ver_info.get("name", "PR小助手")
        sz = self.ver_info.get("file_size_kb", 0)
        mtime = self.ver_info.get("actual_mtime", "-")

        self.lbl_app_name.config(text=name)
        self.lbl_version_badge.config(text=f"v{ver}")
        self.lbl_script_meta.config(text=f"核心文件: {CORE_SCRIPT_NAME} · 大小: {sz} KB · 修改时间: {mtime}")
        self.lbl_data_dir.config(text=f'当前数据目录：{configured_data_dir(self.config)}')

    def _toggle_custom_source_input(self):
        active_id = self.config.get("active_source_id", "github")
        if active_id == "custom":
            self.custom_url_frame.pack(side=tk.LEFT, padx=(0, 8), before=self.btn_update)
        else:
            self.custom_url_frame.pack_forget()

    def _on_custom_url_keystroke(self, *args):
        if hasattr(self, '_custom_url_timer') and self._custom_url_timer:
            try:
                self.after_cancel(self._custom_url_timer)
            except Exception:
                pass
        self._custom_url_timer = self.after(500, lambda: self._save_custom_url(notify=False))

    def _on_custom_url_changed(self, event=None):
        if hasattr(self, '_custom_url_timer') and self._custom_url_timer:
            try:
                self.after_cancel(self._custom_url_timer)
            except Exception:
                pass
            self._custom_url_timer = None
        self._save_custom_url(notify=True)

    def _save_custom_url(self, notify=False):
        new_val = self.custom_url_var.get().strip()
        if self.config.get("custom_url") != new_val:
            self.config["custom_url"] = new_val
            save_config(self.config)
            if notify:
                display = new_val if len(new_val) <= 45 else (new_val[:42] + '...')
                self.terminal.write_ansi(f"\033[90m[配置] 第三方更新源地址已自动保存：{display or '（已清空）'}\033[0m\n")

    def _on_source_changed(self, event=None):
        idx = self.source_combo.current()
        sources = self.config.get("remote_sources", [])
        if 0 <= idx < len(sources):
            self.config["active_source_id"] = sources[idx]["id"]
            save_config(self.config)
            self._toggle_custom_source_input()
            self.terminal.write_ansi(f"\n\033[96m[更新配置] 远端更新源已切换为：{sources[idx]['name']}\033[0m\n")
            if sources[idx]["id"] == "custom":
                self.custom_url_entry.focus_set()
                self.custom_url_entry.selection_range(0, tk.END)
                if not self.custom_url_var.get().strip():
                    self.terminal.write_ansi("\033[93m[提示] 请在下拉框旁输入第三方仓库地址或脚本链接（输入后自动保存）。\033[0m\n")

    def _start_script_process(self):
        """拉起内置进程并在内置终端中实时收发"""
        if self._closing:
            return
        if self.process and self.process.poll() is None:
            self.terminal.write_ansi("\033[93m[提示] 脚本已经在运行中...\033[0m\n")
            return

        if not os.path.exists(CORE_SCRIPT_PATH):
            self.terminal.write_ansi(f"\033[91m[错误] 未找到核心脚本: {CORE_SCRIPT_PATH}\033[0m\n")
            return

        # 启动命令
        if IS_FROZEN:
            worker = os.path.join(APP_DIR, WORKER_EXE_NAME)
            if not os.path.isfile(worker):
                self.terminal.write_ansi('[启动失败] 缺少后台运行组件，请重新解压完整绿色包。\n')
                return
            cmd = [worker, '--run-core']
        else:
            cmd = [sys.executable, '-u', os.path.abspath(__file__), '--run-core']

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["TERM"] = "xterm-256color"
        env["PYTHONIOENCODING"] = "utf-8"
        env['PR_TERMINAL_EMBEDDED'] = '1'
        env['PR_AUDIT_DATA_DIR'] = configured_data_dir(self.config)
        if not os.path.isdir(env['PR_AUDIT_DATA_DIR']):
            self.terminal.write_ansi('[启动失败] 数据目录不存在，请点击【设置数据目录】重新选择。\n')
            return

        try:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=APP_DIR,
                env=env,
                bufsize=0,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )
            self.process = process

            self.terminal.set_running_status(True, pid=self.process.pid)
            self.btn_run_script.config(text="🔄 重启抽查会话")

            # 启动 stdout 读取线程
            def reader_worker():
                try:
                    for text in iter_process_output(process.stdout):
                        self.ui_events.put((self._write_process_output, (process, text)))
                finally:
                    ret = process.wait()
                    process.stdout.close()
                    process.stdin.close()
                    self.ui_events.put((self._on_process_terminated, (process, ret)))

            self.reader_thread = threading.Thread(target=reader_worker, daemon=True)
            self.reader_thread.start()
            self.terminal.text_area.focus_set()

        except Exception as e:
            self.terminal.write_ansi(f"\033[91m[启动异常] 无法拉起脚本进程: {e}\033[0m\n")

    def _write_process_output(self, process, text):
        if process is self.process:
            self.terminal.write_ansi(text)

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

    def _on_window_ctrl_c(self, event=None):
        if event and getattr(event, 'widget', None) is getattr(self, 'custom_url_entry', None):
            return None
        return self.terminal._on_terminal_ctrl_c(event)

    def _handle_terminal_ctrl_c(self):
        """
        终端快捷键 Ctrl+C 优雅处理：
        1. 若进程未在运行，给予提示。
        2. 若处于子菜单/确认提示中，优先优雅返回主菜单（发送 '0\n' 或 '\n'）。
        3. 若已在主菜单，优雅停止/退出脚本进程（与左上角【■ 停止】一致）。
        4. 若连续快速按 Ctrl+C，或进程处于密集计算中，直接强制停止。
        """
        if not self.process or self.process.poll() is not None:
            self.terminal.write_ansi("\033[90m[提示] 脚本进程未运行。点击【🚀 重启抽查会话】可启动。\033[0m\n")
            return

        now = time.time()
        if hasattr(self, '_last_ctrl_c_time') and (now - self._last_ctrl_c_time < 1.5):
            self.terminal.write_ansi("\n\033[93m[Ctrl+C] 连续中断指令，立即停止脚本进程...\033[0m\n")
            self._stop_script_process()
            self._last_ctrl_c_time = 0
            return
        self._last_ctrl_c_time = now

        is_awaiting = self.terminal.screen.awaiting_input
        recent_text = self.terminal.screen.text().splitlines()[-12:]
        recent_str = '\n'.join(recent_text)
        at_main_menu = ('主菜单' in recent_str and ('请选择:' in recent_str or '请选择: ' in recent_str))

        if at_main_menu:
            self.terminal.write_ansi("\n\033[93m[Ctrl+C] 主菜单中断，正在优雅停止当前抽查会话...\033[0m\n")
            try:
                self.process.stdin.write(b'0\n')
                self.process.stdin.flush()
            except Exception:
                pass
            def ensure_stopped():
                if self.process and self.process.poll() is None:
                    self._stop_script_process()
            self.after(500, ensure_stopped)
        elif is_awaiting:
            self.terminal.write_ansi("\n\033[93m[Ctrl+C] 取消当前操作，正在返回主菜单...\033[0m\n")
            if '按回车返回主菜单' in recent_str:
                self._send_to_process('\n')
            else:
                self._send_to_process('0\n')
        else:
            self.terminal.write_ansi("\n\033[93m[Ctrl+C] 正在中断正在执行的任务...\033[0m\n")
            self._stop_script_process()

    def _on_zoom_in(self):
        new_scale = min(1.8, round(self.ui_scale + 0.1, 2))
        self._apply_ui_scale(new_scale, persist=True)

    def _on_zoom_out(self):
        new_scale = max(0.8, round(self.ui_scale - 0.1, 2))
        self._apply_ui_scale(new_scale, persist=True)

    def _on_zoom_reset(self):
        self._apply_ui_scale(1.0, persist=True)

    def _apply_ui_scale(self, scale, persist=True):
        self.ui_scale = max(0.8, min(1.8, round(scale, 2)))
        if persist:
            self.config["ui_scale"] = self.ui_scale
            save_config(self.config)

        s = self.ui_scale
        if hasattr(self, 'lbl_zoom_level'):
            self.lbl_zoom_level.config(text=f"{int(round(s * 100))}%")

        if hasattr(self, 'lbl_app_name'):
            self.lbl_app_name.config(font=("微软雅黑", max(11, int(round(13 * s))), "bold"))
        if hasattr(self, 'lbl_version_badge'):
            self.lbl_version_badge.config(font=("Consolas", max(9, int(round(10 * s))), "bold"))
        if hasattr(self, 'lbl_script_meta'):
            self.lbl_script_meta.config(font=("微软雅黑", max(7, int(round(8 * s)))))
        if hasattr(self, 'lbl_data_dir'):
            self.lbl_data_dir.config(font=("微软雅黑", max(7, int(round(8 * s)))))
        if hasattr(self, 'btn_update'):
            self.btn_update.config(font=("微软雅黑", max(7, int(round(8 * s))), "bold"))
        if hasattr(self, 'btn_run_script'):
            self.btn_run_script.config(font=("微软雅黑", max(7, int(round(8 * s))), "bold"))
        if hasattr(self, 'custom_url_entry'):
            self.custom_url_entry.config(font=("Consolas", max(7, int(round(8 * s)))))

        if hasattr(self, '_sub_action_buttons'):
            for btn in self._sub_action_buttons:
                btn.config(font=("微软雅黑", max(7, int(round(8 * s)))))

        if hasattr(self, '_scaled_labels'):
            for lbl in self._scaled_labels:
                lbl.config(font=("微软雅黑", max(7, int(round(8 * s)))))

        if hasattr(self, 'terminal') and self.terminal:
            self.terminal.apply_ui_scale(s)

        self.minsize(max(700, int(round(860 * s))), max(500, int(round(620 * s))))

    def _restart_script_process(self):
        """重启脚本进程"""
        if self._restart_pending or self._closing:
            return
        self._restart_pending = True
        self._stop_script_process()
        self.terminal.write_ansi("\n\033[96m[正在重启核心抽查脚本...]\033[0m\n\n")
        def wait_for_exit():
            if self._closing:
                return
            if self.process and self.process.poll() is None:
                self.after(100, wait_for_exit)
                return
            self._restart_pending = False
            self.terminal.screen.awaiting_input = False
            self.terminal.screen.pending = ''
            self.terminal.clear_terminal()
            self._start_script_process()
        self.after(100, wait_for_exit)

    def _on_process_terminated(self, process, ret_code):
        if process is not self.process:
            return
        self.terminal.set_running_status(False)
        self.terminal.screen.awaiting_input = False
        self.terminal.write_ansi(f"\n\033[90m[进程已退出，返回码: {ret_code}] 点击【🚀 重启抽查会话】可重新运行。\033[0m\n")

    def _send_to_process(self, text_with_nl):
        if self.process and self.process.poll() is None:
            try:
                self.process.stdin.write(text_with_nl.encode('utf-8'))
                self.process.stdin.flush()
                return True
            except Exception as e:
                self.terminal.write_ansi(f"\033[91m[输入错误] 无法写入进程 stdin: {e}\033[0m\n")
        else:
            self.terminal.write_ansi("\033[90m[提示] 进程未在运行，输入已被忽略。点击【🚀 重启抽查会话】可启动。\033[0m\n")
        return False

    def _on_check_update(self):
        if self.is_updating:
            return

        if self.config.get("active_source_id") == "custom":
            self._save_custom_url(notify=False)
            if not self.config.get("custom_url", "").strip():
                self.terminal.write_ansi("\033[91m[提示] 请先在上方更新源下拉框旁输入第三方仓库或脚本 URL 地址！\033[0m\n")
                self.custom_url_entry.focus_set()
                return

        self.is_updating = True
        self.btn_update.config(state="disabled", text="⏳ 正在检查远端...")

        def update_worker():
            def progress_cb(msg):
                self.ui_events.put((self.terminal.write_ansi, (f"\033[96m[热更新动态] {msg}\033[0m\n",)))

            try:
                result = perform_update(dict(self.config), on_progress=progress_cb)
            except Exception as e:
                result = (False, str(e), '')
            self.ui_events.put((self._on_update_finished, result))

        threading.Thread(target=update_worker, daemon=True).start()

    def _on_update_finished(self, ok, msg, new_ver):
        self.is_updating = False
        if self._close_requested:
            self._on_close()
            return
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
            directory = configured_data_dir(self.config)
            if not os.path.isdir(directory):
                raise FileNotFoundError('当前数据目录不存在，请先设置数据目录')
            if sys.platform == 'win32':
                os.startfile(directory)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', directory])
            else:
                subprocess.Popen(['xdg-open', directory])
        except Exception as e:
            messagebox.showerror("打开数据目录失败", str(e))

    def _on_choose_data_dir(self):
        if self.process and self.process.poll() is None and not self.terminal.screen.awaiting_input:
            messagebox.showinfo('数据目录', '正在处理数据，请等待操作完成或停止脚本后再切换目录。')
            return
        directory = filedialog.askdirectory(parent=self, title='选择原始 Excel 数据目录',
                                            initialdir=configured_data_dir(self.config), mustexist=True)
        if not directory:
            return
        config = dict(self.config, data_directory=data_dir_setting(directory))
        if not save_config(config):
            messagebox.showerror('数据目录', '配置保存失败，请检查程序目录的写入权限。')
            return
        self.config = config
        self._refresh_status()
        self._restart_script_process()

    def _on_manage_backups(self):
        if self.is_updating:
            messagebox.showinfo('备份管理', '正在热更新，请等待更新完成后再恢复备份。')
            return
        os.makedirs(BACKUP_DIR_PATH, exist_ok=True)
        files = sorted((name for name in os.listdir(BACKUP_DIR_PATH)
                        if name.endswith('.py.bak') and os.path.isfile(os.path.join(BACKUP_DIR_PATH, name))), reverse=True)
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
            if self.is_updating:
                messagebox.showinfo('备份管理', '正在热更新，请等待更新完成后再恢复备份。')
                return
            sel = lb.curselection()
            if not sel:
                return
            fn = lb.get(sel[0])
            src = os.path.join(BACKUP_DIR_PATH, fn)
            try:
                restore_backup(src)
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
        name = info.get("name", "PR小助手")
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
        for stream in (sys.stdin, sys.stdout, sys.stderr):
            if hasattr(stream, 'reconfigure'):
                stream.reconfigure(encoding='utf-8')
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, 'reconfigure'):
                stream.reconfigure(line_buffering=True, write_through=True)
        sys.path.insert(0, APP_DIR)
        sys.argv = [CORE_SCRIPT_PATH]
        os.chdir(APP_DIR)
        original_input = builtins.input
        if os.environ.get('PR_TERMINAL_EMBEDDED') == '1':
            def embedded_input(prompt=''):
                sys.stdout.write(str(prompt) + '\x1b]777;input;on\x07')
                sys.stdout.flush()
                try:
                    line = sys.stdin.readline()
                    if line == '':
                        raise EOFError('输入流已关闭')
                    return line.rstrip('\r\n')
                finally:
                    sys.stdout.write('\x1b]777;input;off\x07')
                    sys.stdout.flush()
            builtins.input = embedded_input
        try:
            runpy.run_path(CORE_SCRIPT_PATH, run_name='__main__')
        except Exception:
            traceback.print_exc()
            print('\n[运行失败] 若提示缺少模块，请下载新版完整绿色包后重试。', file=sys.stderr)
            return 1
        finally:
            builtins.input = original_input
        return 0

    app = UniversalShellGUI()
    if len(sys.argv) == 3 and sys.argv[1] == '--gui-smoke-result':
        result_path = sys.argv[2]
        app.withdraw()
        deadline = time.monotonic() + 20
        stage = 0
        redraw = False
        protected = False
        def inspect():
            nonlocal stage, redraw, protected
            content = app.terminal.screen.text()
            if stage == 0 and app.terminal.screen.awaiting_input and '请选择' in content:
                app.terminal.text_area.insert('end-1c', '2')
                prefix = app.terminal.text_area.get('1.0', 'input_start')
                app.terminal.text_area.delete('1.0', 'input_start')
                protected = app.terminal.text_area.get('1.0', 'input_start') == prefix
                app.terminal._on_enter_pressed()
                stage = 1
            elif stage == 1 and app.terminal.screen.awaiting_input and '请输入抽查比例' in content:
                app.terminal.text_area.insert('end-1c', '0.2')
                app.terminal._on_enter_pressed()
                stage = 2
            elif stage == 2 and app.terminal.screen.awaiting_input and '当前 20%' in content:
                redraw = content.count('PR 报告抽查脚本') == 1
                redraw = redraw and app.terminal.text_area.get('1.0', 'end-1c') == content
                app.terminal.text_area.insert('end-1c', '0')
                app.terminal._on_enter_pressed()
                stage = 3
            if stage == 3 and app.process and app.process.poll() is not None and '再见' in content:
                console = 0
                if sys.platform == 'win32':
                    import ctypes
                    console = ctypes.windll.kernel32.GetConsoleWindow()
                with open(result_path, 'w', encoding='utf-8') as stream:
                    json.dump({'passed': app.process.returncode == 0 and not console and redraw and protected,
                               'console_window': console, 'inline_input': True,
                               'menu_redraw': redraw, 'protected_history': protected}, stream)
                app._on_close()
                return
            if time.monotonic() >= deadline:
                with open(result_path, 'w', encoding='utf-8') as stream:
                    json.dump({'passed': False, 'reason': 'GUI interaction timed out', 'output': content[-2000:]}, stream)
                app._on_close()
                return
            app.after(50, inspect)
        app.after(50, inspect)
    app.mainloop()


if __name__ == '__main__':
    sys.exit(main() or 0)
