# -*- coding: utf-8 -*-
"""Single build entry point for the local Windows batch file and CI.

The hot-updatable core is bundled as data, so PyInstaller cannot discover its
imports from universal_shell.py. Collect them without executing the core.
"""

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


PROJECT_DIR = Path(__file__).resolve().parent
PACKAGE_NAME = "PR-Audit-Sampler"
FRIENDLY_EXE_NAME = "PR报告抽查工具.exe"
WORKER_EXE_NAME = "PR-Audit-Worker.exe"
PORTABLE_FILES = ("core_script.py", "version.json", "updater_config.json", "README.md")
# These Excel engines are loaded dynamically by pandas, rather than by the core.
EXCEL_HIDDEN_IMPORTS = {"xlrd", "pandas.io.excel._openpyxl", "pandas.io.excel._xlrd"}


def collect_static_imports(script_path):
    """Return every absolute import, including those nested inside functions."""
    script_path = Path(script_path)
    tree = ast.parse(script_path.read_text(encoding="utf-8-sig"), filename=str(script_path))
    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module != "__future__":
                modules.add(node.module)
    return sorted(modules)


def collect_hidden_imports(script_path):
    return sorted(set(collect_static_imports(script_path)) | EXCEL_HIDDEN_IMPORTS)


def verify_core_metadata(project_dir=PROJECT_DIR):
    """Reject stale metadata or CRLF conversion before producing a release."""
    project_dir = Path(project_dir)
    core_bytes = (project_dir / "core_script.py").read_bytes()
    if b"\r\n" in core_bytes:
        raise ValueError("core_script.py must use LF line endings; disable Git core.autocrlf before checkout")
    metadata = json.loads((project_dir / "version.json").read_text(encoding="utf-8-sig"))
    digest = hashlib.sha256(core_bytes).hexdigest()
    if metadata.get("sha256", "").lower() != digest:
        raise ValueError("version.json sha256 does not match core_script.py; update release metadata first")
    if not metadata.get("version"):
        raise ValueError("version.json is missing its version")
    return metadata


def generate_version_info(version_str, output_path):
    parts = [int(p) if p.isdigit() else 0 for p in str(version_str).split(".")]
    while len(parts) < 4:
        parts.append(0)
    parts = tuple(parts[:4])

    content = f"""# UTF-8
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={parts},
    prodvers={parts},
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo(
      [
        StringTable(
          '040904B0',
          [
            StringStruct('CompanyName', 'Tools Platform'),
            StringStruct('FileDescription', 'PR 报告抽查工具 - 自动化运维抽查客户端'),
            StringStruct('FileVersion', '{version_str}'),
            StringStruct('InternalName', 'PR-Audit-Sampler'),
            StringStruct('LegalCopyright', 'Copyright (C) 2026 Tools Platform. All rights reserved.'),
            StringStruct('OriginalFilename', 'PR-Audit-Sampler.exe'),
            StringStruct('ProductName', 'PR 报告抽查工具'),
            StringStruct('ProductVersion', '{version_str}')
          ]
        )
      ]
    ),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""
    Path(output_path).write_text(content, encoding="utf-8")
    return output_path


def build_spec(project_dir, name, version_file=None):
    """GUI 没有控制台；独立 worker 保留标准 IO，两者共享同一依赖目录。"""
    project_dir = Path(project_dir)
    scripts = [str(project_dir / 'universal_shell.py')]
    data = [(str(project_dir / filename), '.') for filename in PORTABLE_FILES[:3]]
    icon = str(project_dir / 'app.ico') if (project_dir / 'app.ico').is_file() else None
    if icon:
        data.append((icon, '.'))
    version_file = str(version_file) if version_file else None
    imports = collect_hidden_imports(project_dir / 'core_script.py')
    return f"""# -*- coding: utf-8 -*-
a = Analysis({scripts!r}, pathex={[str(project_dir)]!r}, binaries=[],
             datas={data!r}, hiddenimports={imports!r}, hookspath=[],
             runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
gui = EXE(pyz, a.scripts, [], exclude_binaries=True, name={name!r},
          console=False, debug=False, strip=False, upx=False,
          contents_directory='_internal', icon={icon!r}, version={version_file!r})
worker = EXE(pyz, a.scripts, [], exclude_binaries=True, name='PR-Audit-Worker',
             console=True, debug=False, strip=False, upx=False,
             contents_directory='_internal', icon={icon!r}, version={version_file!r})
coll = COLLECT(gui, worker, a.binaries, a.datas, strip=False, upx=False, name={name!r})
"""


def pyinstaller_args(project_dir, name, dist_dir, work_dir):
    return ['--noconfirm', '--clean', '--distpath', str(dist_dir),
            '--workpath', str(work_dir), str(Path(work_dir) / 'portable.spec')]


def assemble_portable(project_dir, package_dir, name):
    package_dir = Path(package_dir)
    executable = package_dir / f"{name}.exe"
    if not executable.is_file():
        raise FileNotFoundError(f"PyInstaller did not produce {executable}")
    if not (package_dir / WORKER_EXE_NAME).is_file():
        raise FileNotFoundError(f'Missing background worker: {WORKER_EXE_NAME}')
    for filename in PORTABLE_FILES:
        shutil.copy2(Path(project_dir) / filename, package_dir / filename)
    icon_path = Path(project_dir) / "app.ico"
    if icon_path.is_file():
        shutil.copy2(icon_path, package_dir / "app.ico")
    (package_dir / "data").mkdir(exist_ok=True)
    if executable.name != FRIENDLY_EXE_NAME:
        shutil.copy2(executable, package_dir / FRIENDLY_EXE_NAME)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-only", action="store_true", help="Validate metadata and show frozen dependencies without building")
    parser.add_argument("--name", default=PACKAGE_NAME)
    parser.add_argument("--distpath", type=Path, default=PROJECT_DIR / "dist")
    parser.add_argument("--workpath", type=Path, default=PROJECT_DIR / "build")
    args = parser.parse_args(argv)
    try:
        metadata = verify_core_metadata()
        hidden_imports = collect_hidden_imports(PROJECT_DIR / "core_script.py")
        print(f"Core v{metadata['version']}; hidden imports: {', '.join(hidden_imports)}", flush=True)
        if args.check_only:
            return 0
        if sys.platform != "win32":
            raise RuntimeError("Windows EXE must be built on Windows; use --check-only on other systems")
        from importlib.metadata import version
        from packaging.version import Version
        if Version(version("pyinstaller")) < Version("6.22.1"):
            raise RuntimeError("PyInstaller >=6.22.1 is required; install requirements.txt")
        args.workpath.mkdir(parents=True, exist_ok=True)
        version_file = args.workpath.resolve() / 'version_info.txt'
        generate_version_info(metadata['version'], version_file)
        (args.workpath / 'portable.spec').write_text(build_spec(PROJECT_DIR, args.name, version_file), encoding='utf-8')
        command = [sys.executable, "-m", "PyInstaller"] + pyinstaller_args(
            PROJECT_DIR, args.name, args.distpath.resolve(), args.workpath.resolve()
        )
        subprocess.run(command, cwd=PROJECT_DIR, check=True)
        package_dir = args.distpath.resolve() / args.name
        assemble_portable(PROJECT_DIR, package_dir, args.name)
        # Test an isolated copy. Never run business code against the build or
        # source directories, where existing data or backups could be present.
        subprocess.run([
            sys.executable, str(PROJECT_DIR / "smoke_test.py"),
            "--dist-dir", str(package_dir), "--exe", WORKER_EXE_NAME,
            "--gui-exe", FRIENDLY_EXE_NAME,
        ], cwd=PROJECT_DIR, check=True)
        print(f"Build and smoke tests passed: {package_dir}")
        return 0
    except (OSError, ValueError, ImportError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
