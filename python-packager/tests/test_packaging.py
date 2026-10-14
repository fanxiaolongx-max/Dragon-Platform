import hashlib
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest


PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))
from build_exe import collect_static_imports, collect_hidden_imports, pyinstaller_args, verify_core_metadata
from smoke_test import run_core


class PackagingTests(unittest.TestCase):
    def test_actual_core_imports_are_frozen(self):
        imports = set(collect_hidden_imports(PROJECT_DIR / "core_script.py"))
        self.assertTrue({"glob", "pandas", "openpyxl", "openpyxl.styles", "openpyxl.utils", "ctypes", "copy"} <= imports)
        self.assertTrue({"xlrd", "pandas.io.excel._openpyxl", "pandas.io.excel._xlrd"} <= imports)

    def test_ast_collects_aliases_multiple_imports_and_nested_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "core.py"
            script.write_text("import glob as scan, random\nfrom openpyxl.styles import Font\ndef f():\n    import copy\nimport glob\n", encoding="utf-8")
            self.assertEqual(collect_static_imports(script), ["copy", "glob", "openpyxl.styles", "random"])

    def test_relative_and_future_imports_are_not_hidden_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "core.py"
            script.write_text("from __future__ import annotations\nfrom . import local\nfrom .local import value\nfrom xml.etree import ElementTree\n", encoding="utf-8")
            self.assertEqual(collect_static_imports(script), ["xml.etree"])

    def test_build_keeps_console_io_and_hides_windows_console(self):
        args = pyinstaller_args(PROJECT_DIR, "Sampler", Path("dist"), Path("build"))
        self.assertIn("--console", args)
        self.assertEqual(args[args.index("--hide-console") + 1], "hide-early")
        self.assertNotIn("--windowed", args)
        self.assertNotIn("--noconsole", args)
        self.assertIn("glob", args)

    def test_metadata_checks_exact_bytes_and_lf(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            core = b"import glob\n"
            (project / "core_script.py").write_bytes(core)
            (project / "version.json").write_text(json.dumps({"version": "1.1.1", "sha256": hashlib.sha256(core).hexdigest()}), encoding="utf-8")
            self.assertEqual(verify_core_metadata(project)["version"], "1.1.1")
            (project / "core_script.py").write_bytes(core + b"# changed\n")
            with self.assertRaisesRegex(ValueError, "sha256"):
                verify_core_metadata(project)
            (project / "core_script.py").write_bytes(b"import glob\r\n")
            with self.assertRaisesRegex(ValueError, "LF"):
                verify_core_metadata(project)


class SmokeHarnessTests(unittest.TestCase):
    def test_utf8_input_and_output_are_preserved(self):
        with tempfile.TemporaryDirectory(prefix="中文 smoke ") as directory:
            output = run_core([sys.executable, "-c", "print(input())"], directory, "中文输入\n", ("中文输入",), 5)
            self.assertIn("中文输入", output)

    def test_failure_code_rejects_success_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "code 2"):
                run_core([sys.executable, "-c", "print('OK'); raise SystemExit(2)"], directory, "", ("OK",), 5)

    def test_missing_marker_fails_a_zero_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "Missing output"):
                run_core([sys.executable, "-c", "pass"], directory, "", ("OK",), 5)

    def test_timeout_fails_instead_of_hanging_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(subprocess.TimeoutExpired):
                run_core([sys.executable, "-c", "import time; time.sleep(5)"], directory, "", ("OK",), 0.1)


if __name__ == "__main__":
    unittest.main()
