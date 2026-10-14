import hashlib
import importlib.util
import json
from pathlib import Path
import queue
import tempfile
import unittest
import tkinter as tk
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

    def test_resolve_custom_urls(self):
        s1, v1 = shell.resolve_custom_urls('https://github.com/foo/bar')
        self.assertEqual(s1, 'https://raw.githubusercontent.com/foo/bar/main/python-packager/core_script.py')
        self.assertEqual(v1, 'https://raw.githubusercontent.com/foo/bar/main/python-packager/version.json')

        s2, v2 = shell.resolve_custom_urls('https://github.com/foo/bar/blob/main/python-packager/core_script.py')
        self.assertEqual(s2, 'https://raw.githubusercontent.com/foo/bar/main/python-packager/core_script.py')
        self.assertEqual(v2, 'https://raw.githubusercontent.com/foo/bar/main/python-packager/version.json')

        s3, v3 = shell.resolve_custom_urls('https://github.com/foo/bar/tree/v2/sub')
        self.assertEqual(s3, 'https://raw.githubusercontent.com/foo/bar/v2/sub/core_script.py')
        self.assertEqual(v3, 'https://raw.githubusercontent.com/foo/bar/v2/sub/version.json')

        s4, v4 = shell.resolve_custom_urls('https://example.com/custom_test.py')
        self.assertEqual(s4, 'https://example.com/custom_test.py')
        self.assertEqual(v4, 'https://example.com/version.json')

        s5, v5 = shell.resolve_custom_urls('https://example.com/packager/')
        self.assertEqual(s5, 'https://example.com/packager/core_script.py')
        self.assertEqual(v5, 'https://example.com/packager/version.json')

        self.assertEqual(shell.resolve_custom_urls(''), ('', ''))

    def test_custom_source_with_github_repo_url_resolves_and_updates(self):
        self.config['active_source_id'] = 'custom'
        self.config['custom_url'] = 'https://github.com/test-org/test-repo'
        self.config['remote_sources'].append({'id': 'custom', 'name': 'test'})
        fetched_urls = []
        def mock_fetch(url, timeout=None):
            fetched_urls.append(url)
            if url.endswith('version.json'):
                return b'{"version": "2.0.0", "sha256": "' + hashlib.sha256(b"print('github_custom')\n").hexdigest().encode() + b'"}'
            return b"print('github_custom')\n"
        with patch.object(shell, 'fetch_url', side_effect=mock_fetch):
            ok, msg, ver = shell.perform_update(self.config)
            self.assertTrue(ok)
            self.assertEqual(ver, '2.0.0')
            self.assertEqual(fetched_urls[0], 'https://raw.githubusercontent.com/test-org/test-repo/main/python-packager/version.json')
            self.assertEqual(fetched_urls[1], 'https://raw.githubusercontent.com/test-org/test-repo/main/python-packager/core_script.py')


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
        screen = shell.AnsiScreen()
        for chunk in ['\x1b', '[9', '1;1m错误', '\x1b[32m成功', '\x1b[0', 'm普通']:
            screen.feed(chunk)
        self.assertEqual(screen.text(), '错误成功普通')
        self.assertEqual(set(screen.lines[0][0][1]), {'ansi_red', 'ansi_bold'})
        self.assertEqual(set(screen.lines[0][2][1]), {'ansi_green', 'ansi_bold'})
        self.assertEqual(screen.lines[0][4][1], ())

    def test_windows_crlf_preserves_lines_and_carriage_refresh_overwrites(self):
        screen = shell.AnsiScreen()
        for chunk in ['第一行\r', '\n第二行\r\n', '进度10%\r', '进度20%']:
            screen.feed(chunk)
        self.assertEqual(screen.text(), '第一行\n第二行\n进度20%')

    def test_new_menu_clears_previous_menu_instead_of_appending(self):
        screen = shell.AnsiScreen()
        screen.feed('old menu\n请选择: ')
        for chunk in ['\x1b[2', 'J\x1b', '[Hnew menu\n请选择: ']:
            screen.feed(chunk)
        self.assertEqual(screen.text(), 'new menu\n请选择: ')

    def test_progress_cursor_movement_redraws_without_duplicate_lines(self):
        screen = shell.AnsiScreen()
        screen.feed('合并 ...\n导出 ...\n')
        for _ in range(5):
            screen.feed('\x1b[2A\x1b[2K合并完成\n\x1b[2K导出完成\n')
        self.assertEqual(screen.text(), '合并完成\n导出完成\n')

    def test_split_input_markers_do_not_show_and_track_prompt_state(self):
        screen = shell.AnsiScreen()
        for chunk in ['请选择: \x1b]', '777;input;', 'on\x07']:
            screen.feed(chunk)
        self.assertTrue(screen.awaiting_input)
        self.assertEqual(screen.text(), '请选择: ')
        screen.echo_input('2')
        self.assertFalse(screen.awaiting_input)
        self.assertEqual(screen.text(), '请选择: 2\n')
        screen.feed('\x1b]777;input;off\x07请输入比例: \x1b]777;input;on\x07')
        self.assertTrue(screen.awaiting_input)
        self.assertEqual(screen.text(), '请选择: 2\n请输入比例: ')

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


class NativeTerminalTests(unittest.TestCase):
    def setUp(self):
        try:
            self.root = tk.Tk()
        except tk.TclError as error:
            self.skipTest(f'Native Tk is unavailable: {error}')
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        self.commands = []
        self.terminal = shell.AppleTerminalWidget(self.root)
        self.terminal.pack(fill=tk.BOTH, expand=True)
        self.terminal.on_input_send = self.commands.append
        self.terminal.write_ansi('只读历史\n请输入: \x1b]777;input;on\x07')

    def test_inline_input_preserves_history_and_sends_only_current_line(self):
        area = self.terminal.text_area
        area.insert('end-1c', '中文 0.2')
        area.delete('1.0', 'input_start')
        self.assertEqual(area.get('1.0', 'input_start'), '只读历史\n请输入: ')
        self.terminal._on_enter_pressed()
        self.assertEqual(self.commands, ['中文 0.2\n'])
        self.assertEqual(area.get('1.0', 'end-1c'), '只读历史\n请输入: 中文 0.2\n')
        area.insert('end', '处理时不得输入')
        self.assertNotIn('处理时不得输入', area.get('1.0', 'end-1c'))

    def test_editing_and_pasting_cannot_change_previous_output_or_submit_multiple_lines(self):
        area = self.terminal.text_area
        area.mark_set('insert', 'input_start')
        area.delete('input_start-1c')
        self.assertEqual(area.get('1.0', 'end-1c'), '只读历史\n请输入: ')
        area.insert('1.0', '1\n0')
        self.assertEqual(self.terminal._draft(), '1 0')
        self.assertEqual(self.commands, [])
        self.assertEqual(area.get('1.0', 'input_start'), '只读历史\n请输入: ')

    def test_redraw_replaces_old_menu_and_preserves_pending_input(self):
        self.terminal.text_area.insert('end-1c', '待输入')
        self.terminal.write_ansi('\r\x1b[2K请输入新值: ')
        self.assertEqual(self.terminal._draft(), '待输入')
        self.terminal.clear_terminal()
        self.assertEqual(self.terminal.text_area.get('1.0', 'end-1c'), '请输入新值: 待输入')
        self.terminal.write_ansi('\x1b]777;input;off\x07\x1b[2J\x1b[H新菜单\n请选择: \x1b]777;input;on\x07')
        self.assertEqual(self.terminal.text_area.get('1.0', 'end-1c'), '新菜单\n请选择: 待输入')

    def test_history_and_quick_commands_use_the_same_prompt_input(self):
        self.terminal.send_input_text('2')
        self.assertFalse(self.terminal.send_input_text('8'))
        self.assertEqual(self.commands, ['2\n'])
        self.terminal.write_ansi('比例: \x1b]777;input;on\x07')
        self.terminal._history_move(-1)
        self.assertEqual(self.terminal._draft(), '2')
        self.terminal._history_move(1)
        self.assertEqual(self.terminal._draft(), '')


class DataDirectoryTests(unittest.TestCase):
    def test_directory_choice_is_saved_and_restarts_the_session(self):
        with tempfile.TemporaryDirectory(prefix='PR 配置 ') as directory:
            root = Path(directory)
            chosen = root / '自定义目录'
            chosen.mkdir()
            calls = []
            class GUI:
                process = None
                config = {'data_directory': ''}
                def _refresh_status(self):
                    calls.append('refresh')
                def _restart_script_process(self):
                    calls.append('restart')
            gui = GUI()
            with patch.object(shell, 'APP_DIR', str(root)), patch.object(shell, 'CONFIG_PATH', str(root / 'config.json')), \
                 patch.object(shell, 'DATA_DIR_PATH', str(root / 'data')), \
                 patch.object(shell.filedialog, 'askdirectory', return_value=str(chosen)):
                shell.UniversalShellGUI._on_choose_data_dir(gui)
                saved = shell.load_config()
                self.assertEqual(saved['data_directory'], '自定义目录')
                self.assertEqual(shell.configured_data_dir(saved), str(chosen))
            self.assertEqual(calls, ['refresh', 'restart'])

    def test_canceling_directory_choice_does_not_save_or_restart(self):
        class GUI:
            process = None
            config = {'data_directory': ''}
        with patch.object(shell.filedialog, 'askdirectory', return_value=''), patch.object(shell, 'save_config') as save:
            shell.UniversalShellGUI._on_choose_data_dir(GUI())
        save.assert_not_called()


class CustomSourceUITests(unittest.TestCase):
    def test_toggle_custom_source_input_visibility(self):
        packed = []
        forgotten = []
        class DummyWidget:
            def pack(self, **kwargs):
                packed.append(kwargs)
            def pack_forget(self):
                forgotten.append(True)
        class GUI:
            config = {'active_source_id': 'github'}
            custom_url_frame = DummyWidget()
            btn_update = object()
        gui = GUI()

        shell.UniversalShellGUI._toggle_custom_source_input(gui)
        self.assertEqual(len(forgotten), 1)

        gui.config['active_source_id'] = 'custom'
        shell.UniversalShellGUI._toggle_custom_source_input(gui)
        self.assertEqual(len(packed), 1)
        self.assertIs(packed[0]['before'], gui.btn_update)

    def test_save_custom_url_writes_config_and_notifies(self):
        terminal_output = []
        class DummyVar:
            def __init__(self, val): self.val = val
            def get(self): return self.val
        class GUI:
            config = {'custom_url': ''}
            custom_url_var = DummyVar('https://github.com/my-org/my-repo')
            terminal = type('T', (), {'write_ansi': lambda s, text: terminal_output.append(text)})()
        gui = GUI()

        with patch.object(shell, 'save_config') as save:
            shell.UniversalShellGUI._save_custom_url(gui, notify=True)
            self.assertEqual(gui.config['custom_url'], 'https://github.com/my-org/my-repo')
            save.assert_called_once_with(gui.config)
            self.assertTrue(any('自动保存' in msg for msg in terminal_output))

    def test_default_tool_name_is_pr_assistant(self):
        self.assertEqual(shell.load_version_info()['name'], 'PR小助手')


class TerminalCtrlCTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.addCleanup(self.root.destroy)
        self.terminal = shell.AppleTerminalWidget(self.root)
        self.terminal.pack()

    def test_prompt_text_get_sel_without_selection_returns_empty_without_tclerror(self):
        # 即使没有任何文本被选中，直接调用 proxy 获取选区也不会抛出 TclError 崩溃
        result = self.terminal.text_area._proxy('get', 'sel.first', 'sel.last')
        self.assertEqual(result, '')

    def test_on_terminal_ctrl_c_without_selection_triggers_callback(self):
        called = []
        self.terminal.on_ctrl_c_cb = lambda: called.append(True)
        ret = self.terminal._on_terminal_ctrl_c()
        self.assertEqual(ret, 'break')
        self.assertEqual(called, [True])

    def test_on_terminal_ctrl_c_with_selection_copies_text(self):
        self.terminal.text_area.program_edit = True
        self.terminal.text_area.insert('1.0', '待复制的内容')
        self.terminal.text_area.program_edit = False
        self.terminal.text_area.tag_add('sel', '1.0', '1.4')
        called = []
        self.terminal.on_ctrl_c_cb = lambda: called.append(True)
        ret = self.terminal._on_terminal_ctrl_c()
        self.assertEqual(ret, 'break')
        self.assertEqual(called, [])  # 有划选时仅复制，不触发中断回调
        self.assertEqual(self.root.clipboard_get(), '待复制的')


class UIScalingTests(unittest.TestCase):
    def test_zoom_in_out_and_reset(self):
        saved_configs = []
        class DummyWidget:
            def config(self, **kwargs): pass
            def configure(self, **kwargs): pass
            def tag_configure(self, *args, **kwargs): pass
        class GUI:
            ui_scale = 1.0
            config = {'ui_scale': 1.0}
            lbl_zoom_level = DummyWidget()
            lbl_app_name = DummyWidget()
            lbl_version_badge = DummyWidget()
            lbl_script_meta = DummyWidget()
            lbl_data_dir = DummyWidget()
            btn_update = DummyWidget()
            btn_run_script = DummyWidget()
            custom_url_entry = DummyWidget()
            _sub_action_buttons = []
            _scaled_labels = []
            terminal = None
            def minsize(self, w, h): pass
            _on_zoom_in = shell.UniversalShellGUI._on_zoom_in
            _on_zoom_out = shell.UniversalShellGUI._on_zoom_out
            _on_zoom_reset = shell.UniversalShellGUI._on_zoom_reset
            _apply_ui_scale = shell.UniversalShellGUI._apply_ui_scale

        gui = GUI()
        with patch.object(shell, 'save_config', side_effect=lambda c: saved_configs.append(dict(c))):
            gui._on_zoom_in()
            self.assertAlmostEqual(gui.ui_scale, 1.1)
            self.assertAlmostEqual(gui.config['ui_scale'], 1.1)

            gui._on_zoom_in()
            self.assertAlmostEqual(gui.ui_scale, 1.2)

            gui._on_zoom_out()
            self.assertAlmostEqual(gui.ui_scale, 1.1)

            gui._on_zoom_reset()
            self.assertAlmostEqual(gui.ui_scale, 1.0)
            self.assertAlmostEqual(gui.config['ui_scale'], 1.0)


if __name__ == '__main__':
    unittest.main()
