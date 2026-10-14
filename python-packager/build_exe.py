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


def pyinstaller_args(project_dir, name, dist_dir, work_dir):
    project_dir = Path(project_dir)
    args = [
        "--noconfirm", "--clean", "--onedir", "--console",
        # --windowed sets stdin/stdout/stderr to None in the --run-core process.
        "--hide-console", "hide-early", "--name", name,
        "--distpath", str(dist_dir), "--workpath", str(work_dir),
        "--specpath", str(work_dir),
    ]
    for filename in PORTABLE_FILES[:3]:
        args.extend(["--add-data", f"{project_dir / filename}{os.pathsep}."])
    for module in collect_hidden_imports(project_dir / "core_script.py"):
        args.extend(["--hidden-import", module])
    args.append(str(project_dir / "universal_shell.py"))
    return args


def assemble_portable(project_dir, package_dir, name):
    package_dir = Path(package_dir)
    executable = package_dir / f"{name}.exe"
    if not executable.is_file():
        raise FileNotFoundError(f"PyInstaller did not produce {executable}")
    for filename in PORTABLE_FILES:
        shutil.copy2(Path(project_dir) / filename, package_dir / filename)
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
        # 6.22.0 regressed --hide-console spec generation; 6.22.1 fixed it.
        # https://pyinstaller.org/en/stable/CHANGES.html
        if Version(version("pyinstaller")) < Version("6.22.1"):
            raise RuntimeError("PyInstaller >=6.22.1 is required; install requirements.txt")
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
            "--dist-dir", str(package_dir), "--exe", FRIENDLY_EXE_NAME,
        ], cwd=PROJECT_DIR, check=True)
        print(f"Build and smoke tests passed: {package_dir}")
        return 0
    except (OSError, ValueError, ImportError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
