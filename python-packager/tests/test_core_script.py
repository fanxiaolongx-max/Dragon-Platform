"""PR 抽查核心的输入、表头及菜单恢复回归测试（只使用临时数据）。"""
import contextlib
import importlib.util
import io
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd


class CoreScriptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix='pr-core-test-')
        cls.root = Path(cls.workspace.name)
        source = Path(__file__).resolve().parents[1] / 'core_script.py'
        module_path = cls.root / 'core_script.py'
        shutil.copyfile(source, module_path)
        spec = importlib.util.spec_from_file_location('pr_core_under_test', module_path)
        cls.core = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.core)

    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()

    def test_import_uses_temporary_data_directory(self):
        self.assertEqual(Path(self.core.DATA_DIR), self.root / 'data')
        self.assertTrue((self.root / 'data').is_dir())

    def test_excel_headers_are_normalized_and_readers_close(self):
        path = self.root / 'risk.xlsx'
        pd.DataFrame({
            '风险ID': ['R-1'], '风险等级 ': ['High'],
            '风险状态': ['Risk Closed'],
        }).to_excel(path, index=False)
        self.assertEqual(self.core.classify_excel_file(path, False), '风险')
        df = self.core._read_sheet_safely(path)
        self.assertEqual(len(self.core.filter_risk_closed(df)), 1)
        # 两个入口都应退出 ExcelFile 上下文，即使读表失败也关闭句柄。
        for reader in (self.core._read_sheet_safely, self.core.inspect_excel_headers):
            with self.subTest(reader=reader.__name__):
                excel = MagicMock()
                excel.__enter__.return_value.sheet_names = ['Task List']
                with patch.object(self.core.pd, 'ExcelFile', return_value=excel), \
                     patch.object(self.core.pd, 'read_excel', side_effect=ValueError('坏表')):
                    try:
                        reader(path)
                    except self.core.DataValidationError:
                        pass
                excel.__exit__.assert_called_once()

    def test_normalized_duplicate_headers_are_rejected(self):
        path = self.root / 'duplicate-headers.xlsx'
        pd.DataFrame({'风险等级': ['High'], '风险等级 ': ['Middle']}).to_excel(path, index=False)
        with self.assertRaisesRegex(self.core.DataValidationError, '重名列'):
            self.core._read_sheet_safely(path)

    def test_unreadable_sheet_does_not_silently_return_none(self):
        with self.assertRaisesRegex(self.core.DataValidationError, '读取表格失败'):
            self.core._read_sheet_safely(self.root / 'missing.xlsx')

    def test_merge_read_failure_does_not_write_partial_results(self):
        df = pd.DataFrame({'风险ID': ['R-1'], '风险等级': ['High']})
        with patch.object(self.core, '_read_sheet_safely', side_effect=[
            df, self.core.DataValidationError('第二个源表无法读取'),
        ]), patch.object(self.core, '_source_fingerprints', return_value=[]), \
             patch.object(self.core.pd, 'ExcelWriter') as writer:
            with self.assertRaisesRegex(self.core.DataValidationError, '第二个源表'):
                self.core.merge_risk(['first.xlsx', 'second.xlsx'])
            writer.assert_not_called()

    def test_sampling_rejects_invalid_ratios(self):
        df = pd.DataFrame({'id': ['A', 'B']})
        for ratio in (0, -0.5, 1.1, float('nan'), float('inf'), -float('inf')):
            with self.subTest(ratio=ratio):
                with self.assertRaises(self.core.DataValidationError):
                    self.core.stratified_sample(df, [], None, {}, ratio, False, 1)
        self.assertEqual(len(self.core.stratified_sample(df, [], None, {}, 1, False, 1)), 2)

    def test_scope_menu_keeps_original_ratio_on_invalid_input(self):
        for ratio in ('0', '-0.5', '1.1', 'nan', 'inf'):
            with self.subTest(ratio=ratio):
                cfg = self.core.clone_cfg(self.core.DEFAULT_CONFIG)
                cfg['scopes']['risk_suspend']['ratio'] = 0.2
                with patch('builtins.input', side_effect=['1', 'y', 'n', ratio, '0']), \
                     patch.object(self.core, 'clear_screen'), \
                     contextlib.redirect_stdout(io.StringIO()):
                    self.core.menu_set_scopes(cfg)
                self.assertEqual(cfg['scopes']['risk_suspend']['ratio'], 0.2)

    def test_scope_menu_accepts_valid_ratio(self):
        cfg = self.core.clone_cfg(self.core.DEFAULT_CONFIG)
        with patch('builtins.input', side_effect=['1', 'y', 'n', '1', '0']), \
             patch.object(self.core, 'clear_screen'), \
             contextlib.redirect_stdout(io.StringIO()):
            self.core.menu_set_scopes(cfg)
        self.assertEqual(cfg['scopes']['risk_suspend']['ratio'], 1)

    def test_negative_and_out_of_range_scope_numbers_do_not_edit_scopes(self):
        cfg = self.core.clone_cfg(self.core.DEFAULT_CONFIG)
        original = self.core.clone_cfg(cfg)
        with patch('builtins.input', side_effect=['-1', '11', '0']), \
             patch.object(self.core, 'clear_screen'), \
             contextlib.redirect_stdout(io.StringIO()):
            self.core.menu_set_scopes(cfg)
        self.assertEqual(cfg, original)

    def test_missing_required_columns_stop_sampling_before_any_scope(self):
        cfg = self.core.clone_cfg(self.core.DEFAULT_CONFIG)
        df = pd.DataFrame({'风险ID': ['R-1'], '风险状态': ['Risk Closed']})
        with patch.object(self.core, 'auto_prepare', return_value=[]), \
             patch.object(self.core, 'load_risk', return_value=(df, 'risk.xlsx')), \
             patch.object(self.core, 'load_rect', return_value=(None, None)), \
             patch.object(self.core, 'load_rfc', return_value=(None, None)), \
             patch.object(self.core, 'load_sr', return_value=(None, None)), \
             patch.object(self.core, 'stratified_sample') as sample:
            with self.assertRaisesRegex(self.core.DataValidationError, '风险等级'):
                self.core.run_sampling(cfg)
            sample.assert_not_called()

    def test_columns_for_disabled_strategies_and_scopes_are_optional(self):
        cfg = self.core.clone_cfg(self.core.DEFAULT_CONFIG)
        for scope in cfg['scopes'].values():
            scope['enable'] = False
        cfg['scopes']['rect_closed']['enable'] = True
        cfg.update(uniform_operator=False, uniform_productline=False, priority_high=False)
        df = pd.DataFrame({'任务号': ['T-1'], '任务状态': ['Rectification Closed']})
        self.core._validate_sampling_columns({'整改': df}, cfg)
        cfg['scopes']['rect_delay']['enable'] = True
        with self.assertRaisesRegex(self.core.DataValidationError, '是否延期'):
            self.core._validate_sampling_columns({'整改': df}, cfg)

    def test_main_recovers_from_data_errors_without_export(self):
        progress = MagicMock()
        progress.tasks = [{'status': 'running'}]
        output = io.StringIO()
        with patch('builtins.input', side_effect=['1', '', '0']), \
             patch.object(self.core, 'clear_screen'), \
             patch.object(self.core, 'Progress', return_value=progress), \
             patch.object(self.core, 'run_sampling', side_effect=self.core.DataValidationError('缺少风险等级')), \
             patch.object(self.core, 'export_results') as export, \
             contextlib.redirect_stdout(output):
            self.core.main()
        export.assert_not_called()
        progress.fail.assert_called_with(0, '操作中止')
        progress.finish.assert_called_once()
        self.assertIn('缺少风险等级', output.getvalue())
        self.assertIn('再见', output.getvalue())

    def test_main_recovers_from_excel_output_lock(self):
        progress = MagicMock()
        progress.tasks = []
        output = io.StringIO()
        with patch('builtins.input', side_effect=['1', '', '0']), \
             patch.object(self.core, 'clear_screen'), \
             patch.object(self.core, 'Progress', return_value=progress), \
             patch.object(self.core, 'run_sampling', return_value=({'risk_closed': {}}, 1, {}, [])), \
             patch.object(self.core, 'export_results', side_effect=PermissionError('输出被占用')), \
             patch.object(self.core, 'print_report') as report, \
             contextlib.redirect_stdout(output):
            self.core.main()
        report.assert_not_called()
        progress.finish.assert_called_once()
        self.assertIn('请关闭正在 Excel 中打开的输出文件', output.getvalue())
        self.assertIn('再见', output.getvalue())


class SourceAndSamplingTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory(prefix='pr-source-test-')
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        module_path = self.root / 'core_script.py'
        shutil.copyfile(Path(__file__).resolve().parents[1] / 'core_script.py', module_path)
        spec = importlib.util.spec_from_file_location('pr_sources_under_test', module_path)
        self.core = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.core)

    def source(self, name, ids, directory=None):
        directory = directory or Path(self.core.DATA_DIR)
        directory.mkdir(parents=True, exist_ok=True)
        filename = directory / name
        pd.DataFrame({'风险ID': ids, '风险等级': ['High'] * len(ids),
                      '风险状态': ['Risk Closed'] * len(ids)}).to_excel(filename, index=False)
        return filename

    def cfg(self, *scopes):
        cfg = self.core.clone_cfg(self.core.DEFAULT_CONFIG)
        cfg.update(auto_merge=False, uniform_operator=False, uniform_productline=False,
                   priority_high=False, seed=42)
        for key, value in cfg['scopes'].items():
            value['enable'] = key in scopes
        return cfg

    def sampling(self, cfg, **frames):
        with contextlib.ExitStack() as stack:
            for src, function in [('风险', 'load_risk'), ('整改', 'load_rect'), ('RFC', 'load_rfc'), ('SR', 'load_sr')]:
                stack.enter_context(patch.object(self.core, function, return_value=(frames.get(src), 'source.xlsx')))
            return self.core.run_sampling(cfg)

    def test_default_deduplication_uses_unique_candidate_count_before_quota(self):
        frame = pd.DataFrame({'风险ID': [f'R-{i}' for i in range(100)] * 2,
                              '风险等级': ['High'] * 200, '风险状态': ['Risk Closed'] * 200,
                              '数据来源文件': ['first.xlsx'] * 100 + ['second.xlsx'] * 100})
        cfg = self.cfg('risk_closed')
        results, _, _, _ = self.sampling(cfg, **{'风险': frame})
        result = results['risk_closed']
        self.assertEqual(result['raw_total'], 200)
        self.assertEqual(result['total'], 100)
        self.assertEqual(len(result['picked']), 10)
        self.assertEqual(result['picked']['风险ID'].nunique(), 10)
        self.assertEqual(len(frame), 200)

    def test_conflicting_status_or_level_stops_before_any_sampling(self):
        for column, values in [('风险状态', ['Risk Suspended', 'Risk Closed']), ('风险等级', ['High', 'Middle'])]:
            with self.subTest(column=column):
                frame = pd.DataFrame({'风险ID': ['R-1', 'R-1'], '风险等级': ['High', 'High'],
                                      '风险状态': ['Risk Closed', 'Risk Closed'],
                                      '数据来源文件': ['old.xlsx', 'new.xlsx']})
                frame[column] = values
                with patch.object(self.core, 'stratified_sample') as sample:
                    with self.assertRaisesRegex(self.core.DataValidationError, f'R-1.*{column}.*old.xlsx'):
                        self.sampling(self.cfg('risk_closed', 'risk_suspend'), **{'风险': frame})
                    sample.assert_not_called()

    def test_record_policy_preserves_repeated_and_conflicting_rows(self):
        frame = pd.DataFrame({'风险ID': ['R-1', 'R-1'], '风险等级': ['High', 'Middle'],
                              '风险状态': ['Risk Closed', 'Risk Closed']})
        cfg = self.cfg('risk_closed')
        cfg.update(duplicate_policy='records', ratio=1)
        results, _, _, _ = self.sampling(cfg, **{'风险': frame})
        self.assertEqual(results['risk_closed']['total'], 2)
        self.assertEqual(len(results['risk_closed']['picked']), 2)

    def test_same_number_in_different_source_types_is_independent(self):
        risk = pd.DataFrame({'风险ID': ['SAME'], '风险等级': ['High'], '风险状态': ['Risk Closed']})
        sr = pd.DataFrame({'问题单号/SR Number': ['SAME'], '问题级别/Problem Level': ['Critical'],
                           '问题单状态/SR Status': ['Closed']})
        results, _, _, _ = self.sampling(self.cfg('risk_closed', 'sr_closed_critical'), **{'风险': risk, 'SR': sr})
        self.assertEqual(len(results['risk_closed']['picked']), 1)
        self.assertEqual(len(results['sr_closed_critical']['picked']), 1)

    def test_rectification_scope_overlap_is_preserved_after_source_deduplication(self):
        frame = pd.DataFrame({'任务号': ['T-1', 'T-1'], '任务状态': ['Rectification Closed'] * 2,
                              '是否延期': ['是', '是']})
        cfg = self.cfg('rect_closed', 'rect_delay')
        results, seed, paths, _ = self.sampling(cfg, **{'整改': frame})
        for key in ('rect_closed', 'rect_delay'):
            self.assertEqual(results[key]['raw_total'], 2)
            self.assertEqual(results[key]['total'], 1)
            self.assertEqual(results[key]['picked']['任务号'].tolist(), ['T-1'])
        filename, total = self.core.export_results(results, cfg, seed, paths)
        self.assertEqual(len(total), 2)
        config = pd.read_excel(filename, sheet_name='抽查配置').set_index('配置项')['值']
        self.assertEqual(config['重复单号处理'], self.core.DUPLICATE_POLICIES['unique'])
        counts = pd.read_excel(filename, sheet_name='候选统计')
        self.assertEqual(counts['原始候选记录数'].tolist(), [2, 2])
        self.assertEqual(counts['处理后候选数'].tolist(), [1, 1])

    def test_empty_numbers_do_not_get_collapsed_into_one_ticket(self):
        frame = pd.DataFrame({'风险ID': [None, ' '], '风险等级': ['High'] * 2,
                              '风险状态': ['Risk Closed'] * 2})
        with self.assertRaisesRegex(self.core.DataValidationError, '2 条记录缺少单号'):
            self.sampling(self.cfg('risk_closed'), **{'风险': frame})

    def test_policy_selection_keeps_default_or_changes_to_records(self):
        for choice, expected in [('', 'unique'), ('2', 'records')]:
            cfg = self.cfg('risk_closed')
            with patch('builtins.input', side_effect=['', '', '', 'n', choice]), contextlib.redirect_stdout(io.StringIO()):
                self.core.menu_set_strategy(cfg)
            self.assertEqual(cfg['duplicate_policy'], expected)

    def test_source_manifest_is_hidden_and_identical_sources_need_no_merge(self):
        source = self.source('risk.xlsx', ['R-1'])
        info = self.core.merge_risk([source])
        with pd.ExcelFile(info['out']) as workbook:
            self.assertIn(self.core.SOURCE_MANIFEST_SHEET, workbook.sheet_names)
        workbook = self.core.load_workbook(info['out'])
        try:
            self.assertEqual(workbook[self.core.SOURCE_MANIFEST_SHEET].sheet_state, 'hidden')
        finally:
            workbook.close()
        self.assertFalse(self.core.need_merge_for_type('风险'))
        os.utime(source, (1_900_000_000, 1_900_000_000))
        self.assertFalse(self.core.need_merge_for_type('风险'))

    def test_content_replacement_with_preserved_time_triggers_merge(self):
        source = self.source('risk.xlsx', ['R-1'])
        before = source.stat()
        self.core.merge_risk([source])
        self.source('risk.xlsx', ['R-2'])
        os.utime(source, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertTrue(self.core.need_merge_for_type('风险'))
        self.core.auto_prepare(self.core.DEFAULT_CONFIG)
        frame, _ = self.core.load_risk()
        self.assertEqual(frame['风险ID'].tolist(), ['R-2'])

    def test_adding_an_old_file_and_removing_a_source_rebuilds_candidates(self):
        first = self.source('first.xlsx', ['R-1'])
        self.core.merge_risk([first])
        second = self.source('second.xlsx', ['R-2'])
        os.utime(second, (1, 1))
        self.assertTrue(self.core.need_merge_for_type('风险'))
        self.core.auto_prepare(self.core.DEFAULT_CONFIG)
        self.assertEqual(set(self.core.load_risk()[0]['风险ID']), {'R-1', 'R-2'})
        first.unlink()
        self.assertTrue(self.core.need_merge_for_type('风险'))
        self.core.auto_prepare(self.core.DEFAULT_CONFIG)
        self.assertEqual(self.core.load_risk()[0]['风险ID'].tolist(), ['R-2'])

    def test_removing_every_source_stops_sampling_and_preserves_old_merge(self):
        source = self.source('risk.xlsx', ['R-1'])
        output = Path(self.core.merge_risk([source])['out'])
        original = output.read_bytes()
        source.unlink()
        with self.assertRaisesRegex(self.core.DataValidationError, '原始文件已全部移除'):
            self.core.auto_prepare(self.core.DEFAULT_CONFIG)
        self.assertEqual(output.read_bytes(), original)

    def test_manual_merged_sheet_without_sources_remains_usable(self):
        merged = Path(self.core.DATA_DIR) / self.core.RISK_MERGED_NAME
        pd.DataFrame({'风险ID': ['manual']}).to_excel(merged, index=False)
        self.assertFalse(self.core.need_merge_for_type('风险'))

    def test_legacy_merge_with_sources_rebuilds_once_even_if_source_time_is_old(self):
        source = self.source('risk.xlsx', ['R-1'])
        merged = Path(self.core.DATA_DIR) / self.core.RISK_MERGED_NAME
        pd.DataFrame({'风险ID': ['stale']}).to_excel(merged, index=False)
        os.utime(source, (1, 1))
        self.assertTrue(self.core.need_merge_for_type('风险'))
        self.core.merge_risk()
        self.assertFalse(self.core.need_merge_for_type('风险'))

    def test_external_import_sources_and_added_neighbors_are_tracked(self):
        with tempfile.TemporaryDirectory(prefix='external-pr-source-') as external:
            directory = Path(external)
            source = self.source('external.xlsx', ['R-1'], directory)
            self.core.merge_risk([source])
            self.assertFalse(self.core.need_merge_for_type('风险'))
            self.source('added.xlsx', ['R-2'], directory)
            self.assertTrue(self.core.need_merge_for_type('风险'))
            self.core.merge_risk()
            self.assertEqual(set(self.core.load_risk()[0]['风险ID']), {'R-1', 'R-2'})

    def test_data_directory_additions_are_not_hidden_by_legacy_sources(self):
        directory = Path(self.core.RISK_DIR)
        legacy = self.source('risk_management_export_1.xlsx', ['R-1'], directory)
        self.core.merge_risk([legacy])
        self.source('new-risk.xlsx', ['R-2'])
        self.assertTrue(self.core.need_merge_for_type('风险'))
        self.core.merge_risk()
        self.assertEqual(set(self.core.load_risk()[0]['风险ID']), {'R-1', 'R-2'})

    def test_source_edit_during_read_does_not_overwrite_last_merge(self):
        source = self.source('risk.xlsx', ['R-1'])
        output = Path(self.core.merge_risk([source])['out'])
        original = output.read_bytes()
        reader = self.core._read_sheet_safely

        def edit_during_read(filename):
            frame = reader(filename)
            self.source('risk.xlsx', ['R-2'])
            return frame

        with patch.object(self.core, '_read_sheet_safely', side_effect=edit_during_read):
            with self.assertRaisesRegex(self.core.DataValidationError, '读取过程中发生变化'):
                self.core.merge_risk([source])
        self.assertEqual(output.read_bytes(), original)

    def test_external_source_on_another_windows_drive_uses_absolute_path(self):
        source = self.source('risk.xlsx', ['R-1'])
        with patch.object(self.core.os.path, 'relpath', side_effect=ValueError('different drives')):
            self.core.merge_risk([source])
            manifest = self.core._read_source_manifest(self.core._find_merged_for_type('风险'))
            self.assertEqual(manifest[0][0], os.path.normcase(str(source)).replace(os.sep, '/'))
            self.assertFalse(self.core.need_merge_for_type('风险'))

    def test_all_four_merge_types_store_valid_source_manifests(self):
        frames = [
            ('风险', self.core.merge_risk, {'风险ID': ['R-1'], '风险等级': ['High'], '风险状态': ['Risk Closed']}),
            ('整改', self.core.merge_rect, {'任务号': ['T-1'], '任务状态': ['Rectification Closed'], '重要程度': ['一般']}),
            ('RFC', self.core.merge_rfc, {'作业单号/Ticket ID': ['RFC-1'], '状态/RFC Status': ['已关闭'], '级别/Severity': ['High']}),
            ('SR', self.core.merge_sr, {'问题单号/SR Number': ['SR-1'], '问题单状态/SR Status': ['Closed'], '问题级别/Problem Level': ['Critical']}),
        ]
        for name, merge, data in frames:
            with self.subTest(source=name):
                source = Path(self.core.DATA_DIR) / f'{name}.xlsx'
                pd.DataFrame(data).to_excel(source, index=False)
                info = merge([source])
                self.assertEqual(info['total'], 1)
                self.assertFalse(self.core.need_merge_for_type(name))
                self.assertEqual(len(self.core._read_source_manifest(info['out'])), 1)


if __name__ == '__main__':
    unittest.main()
