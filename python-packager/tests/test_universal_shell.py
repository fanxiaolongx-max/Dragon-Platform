import hashlib
import importlib.util
import json
from pathlib import Path
import queue
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / 'universal_shell.py'
spec = importlib.util.spec_from_file_location('universal_shell', MODULE_PATH)
shell = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='PR 更新测试 ')
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        for name, value in {'CORE_SCRIPT_PATH': root / 'core_script.py',
                            'VERSION_PATH': root / 'version.json',
                            'BACKUP_DIR_PATH': root / 'backups'}.items():
            self.patch = patch.object(shell, name, str(value))
            self.patch.start()
            self.addCleanup(self.patch.stop)
        self.old = b"print('old')\n"
        Path(shell.CORE_SCRIPT_PATH).write_bytes(self.old)
        self.old_metadata = {'version': '1.0.0', 'sha256': hashlib.sha256(self.old).hexdigest()}
        Path(shell.VERSION_PATH).write_text(json.dumps(self.old_metadata), encoding='utf-8')
        self.config = {'active_source_id': 'github', 'backup_on_update': True,
                       'remote_sources': [{'id': 'github', 'name': 'test', 'url': 'script', 'version_url': 'version'}]}

    def update(self, content, metadata=None):
        metadata = metadata or {'version': '1.1.1', 'sha256': hashlib.sha256(content).hexdigest()}
        with patch.object(shell, 'fetch_url', side_effect=[json.dumps(metadata).encode(), content]):
            return shell.perform_update(self.config)

    def assert_old_intact(self):
        self.assertEqual(Path(shell.CORE_SCRIPT_PATH).read_bytes(), self.old)
        self.assertEqual(json.loads(Path(shell.VERSION_PATH).read_text(encoding='utf-8')), self.old_metadata)

    def test_html_error_does_not_replace_script(self):
        ok, _, _ = self.update(b'<html><body>Gateway error</body></html>')
        self.assertFalse(ok)
        self.assert_old_intact()

    def test_invalid_python_does_not_replace_script(self):
        ok, _, _ = self.update(b'def broken(:\n')
        self.assertFalse(ok)
        self.assert_old_intact()

    def test_checksum_mismatch_does_not_replace_script(self):
        ok, message, _ = self.update(b"print('new')\n", {'version': '1.1.1', 'sha256': '0' * 64})
        self.assertFalse(ok)
        self.assertIn('SHA-256', message)
        self.assert_old_intact()

    def test_version_fetch_failure_does_not_fall_back_to_unverified_update(self):
        with patch.object(shell, 'fetch_url', side_effect=OSError('network down')):
            self.assertFalse(shell.perform_update(self.config)[0])
        self.assert_old_intact()

    def test_backup_failure_aborts_update(self):
        with patch.object(shell.shutil, 'copy2', side_effect=PermissionError('backup denied')):
            self.assertFalse(self.update(b"print('new')\n")[0])
        self.assert_old_intact()

    def test_metadata_replace_failure_rolls_back_script(self):
        real_replace = shell.os.replace

        def replace(source, target):
            if target == shell.VERSION_PATH:
                raise PermissionError('metadata locked')
            return real_replace(source, target)

        with patch.object(shell.os, 'replace', side_effect=replace):
            self.assertFalse(self.update(b"print('new')\n")[0])
        self.assert_old_intact()
        self.assertFalse(list(Path(self.tmp.name).glob('.updater-*')))

    def test_success_and_restore_keep_matching_metadata(self):
        new = "print('中文新版本')\n".encode()
        ok, _, version = self.update(new)
        self.assertTrue(ok)
        self.assertEqual(version, '1.1.1')
        self.assertEqual(Path(shell.CORE_SCRIPT_PATH).read_bytes(), new)
        backups = list(Path(shell.BACKUP_DIR_PATH).glob('*.py.bak'))
        self.assertEqual(len(backups), 1)
        shell.restore_backup(str(backups[0]))
        self.assertEqual(Path(shell.CORE_SCRIPT_PATH).read_bytes(), self.old)
        restored = json.loads(Path(shell.VERSION_PATH).read_text(encoding='utf-8'))
        self.assertEqual(restored['version'], '1.0.0')
        self.assertEqual(restored['sha256'], hashlib.sha256(self.old).hexdigest())

    def test_same_script_refreshes_version_metadata(self):
        ok, _, version = self.update(self.old)
        self.assertTrue(ok)
        self.assertEqual(version, '1.1.1')
        self.assertEqual(json.loads(Path(shell.VERSION_PATH).read_text(encoding='utf-8'))['version'], '1.1.1')

    def test_custom_source_without_manifest_compiles_before_install(self):
        self.config['active_source_id'] = 'custom'
        self.config['custom_url'] = 'script'
        self.config['remote_sources'].append({'id': 'custom', 'name': 'test'})
        with patch.object(shell, 'fetch_url', return_value=b"print('custom')\n"):
            self.assertTrue(shell.perform_update(self.config)[0])


class TerminalTests(unittest.TestCase):
    def test_close_waits_for_update_completion_before_destroying_window(self):
        events = []

        class GUI:
            is_updating = True
            _closing = False
            _close_requested = False
            process = None
            terminal = type('Terminal', (), {'write_ansi': lambda *args: None})()

            def destroy(self):
                events.append('destroyed')

            def _on_close(self):
                shell.UniversalShellGUI._on_close(self)

        gui = GUI()
        gui._on_close()
        self.assertTrue(gui._close_requested)
        self.assertFalse(gui._closing)
        self.assertEqual(events, [])
        shell.UniversalShellGUI._on_update_finished(gui, True, 'updated', '1.1.1')
        self.assertFalse(gui.is_updating)
        self.assertTrue(gui._closing)
        self.assertEqual(events, ['destroyed'])

    def test_multibyte_output_survives_arbitrary_pipe_boundaries(self):
        data = '中文进度 ✅\n最终输出\n'.encode('utf-8')

        class ByteStream:
            def __init__(self):
                self.parts = iter([bytes([byte]) for byte in data] + [b''])

            def read(self, size):
                return next(self.parts)

        self.assertEqual(''.join(shell.iter_process_output(ByteStream())), data.decode())

    def test_fragmented_ansi_keeps_color_and_combined_bold(self):
        inserts = []

        class TextArea:
            def configure(self, **kwargs):
                pass

            def insert(self, index, text, tags=()):
                inserts.append((text, tuple(tags)))

            def see(self, index):
                pass

        terminal = object.__new__(shell.AppleTerminalWidget)
        terminal._active_tags = set()
        terminal._pending_ansi = ''
        terminal._pending_cr = ''
        terminal.text_area = TextArea()
        for chunk in ['\x1b', '[9', '1;1m错误', '\x1b[32m成功', '\x1b[0', 'm普通']:
            terminal.write_ansi(chunk)
        self.assertEqual(''.join(text for text, _ in inserts), '错误成功普通')
        self.assertEqual(set(inserts[0][1]), {'ansi_red', 'ansi_bold'})
        self.assertEqual(set(inserts[1][1]), {'ansi_green', 'ansi_bold'})
        self.assertEqual(inserts[2][1], ())

    def test_windows_crlf_does_not_erase_output_and_carriage_refresh_still_works(self):
        inserts = []
        deletes = []

        class TextArea:
            def configure(self, **kwargs):
                pass

            def insert(self, index, text, tags=()):
                inserts.append(text)

            def delete(self, *args):
                deletes.append(args)

            def see(self, index):
                pass

        terminal = object.__new__(shell.AppleTerminalWidget)
        terminal._active_tags = set()
        terminal._pending_ansi = ''
        terminal._pending_cr = ''
        terminal.text_area = TextArea()
        for chunk in ['第一行\r', '\n第二行\r\n', '进度10%\r', '进度20%']:
            terminal.write_ansi(chunk)
        self.assertEqual(''.join(inserts), '第一行\n第二行\n进度10%进度20%')
        self.assertEqual(len(deletes), 1)

    def test_update_worker_exception_remains_available_to_ui_callback(self):
        events = queue.Queue()
        finished = []

        class Button:
            def config(self, **kwargs):
                pass

        class GUI:
            is_updating = False
            config = {}
            btn_update = Button()
            ui_events = events
            terminal = type('Terminal', (), {'write_ansi': lambda *args: None})()

            def _on_update_finished(self, *args):
                finished.append(args)

        class ImmediateThread:
            def __init__(self, target, **kwargs):
                self.target = target

            def start(self):
                self.target()

        with patch.object(shell.threading, 'Thread', ImmediateThread), patch.object(shell, 'perform_update', side_effect=OSError('disk locked')):
            shell.UniversalShellGUI._on_check_update(GUI())
        callback, args = events.get_nowait()
        callback(*args)
        self.assertEqual(finished, [(False, 'disk locked', '')])


if __name__ == '__main__':
    unittest.main()
