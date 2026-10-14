# -*- coding: utf-8 -*-
"""
PR 报告抽查脚本
================================
功能：
  1. 从 001 RFC、002 风险、003 整改、004 SR 合并表中按规则抽查单子
  2. 默认抽查范围：
       - 风险-中高风险-风险挂起   (Middle/High + Risk Suspended)
       - 风险-中高风险-风险关闭   (Middle/High + Risk Closed)
       - 整改-已闭环             (Rectification Closed/Completed)
       - 整改-延期               (是否延期=是，与已闭环独立分别统计)
       - RFC-已关闭-高级别        (已关闭 + High/Fatal)
       - RFC-已关闭-Medium        (已关闭 + Medium)
       - RFC-已关闭-Low           (已关闭 + Low，默认不抽)
       - SR-已关闭-Critical       (Closed + Critical)
       - SR-已关闭-Major          (Closed + Major)
       - SR-已关闭-Minor          (Closed + Minor，默认不抽)
  3. 抽样策略：按运营商(风险/RFC/SR 再按产品线)分层均匀分布 + 组内优先高等级/高重要程度
  4. 抽查比例、各范围开关与比例、策略权重均可在主菜单调整
  5. 抽查前自动检测原始表更新并合并统计
  6. 生成抽查总表 Excel（统一关键列 + 各来源明细 + 配置记录）+ 命令行彩色报告

用法：
    python 抽查脚本.py

依赖：pandas、openpyxl（pip install pandas openpyxl）
作者：CodeArts 智能体生成
"""

__script_name__ = "PR 报告抽查脚本"
__version__ = "1.3.0"
__author__ = "CodeArts 智能体生成"

import os
import sys
import math
import re
import glob
import random
import time
import threading
import datetime
import hashlib
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# 抑制 openpyxl 读取导出表时的"no default style"提示（无害，仅刷屏）
import warnings
warnings.filterwarnings('ignore', message='Workbook contains no default style', category=UserWarning)

# ============================================================
# 路径常量与智能扫描
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.expanduser(os.environ.get('PR_AUDIT_DATA_DIR') or os.path.join(BASE_DIR, 'data')))
CUSTOM_DATA_DIR = os.path.normcase(DATA_DIR) != os.path.normcase(os.path.join(BASE_DIR, 'data'))
SOURCE_SCAN_ROOTS = [DATA_DIR] if CUSTOM_DATA_DIR else [DATA_DIR, BASE_DIR]
LEGACY_ROOT = DATA_DIR if CUSTOM_DATA_DIR else BASE_DIR
RISK_DIR = os.path.join(LEGACY_ROOT, '002【2026年1月-9月】风险-运营商-369单')
RECT_DIR = os.path.join(LEGACY_ROOT, '003【2025年1月-2026年9月】整改-运营商-178单')
RFC_DIR = os.path.join(LEGACY_ROOT, '001【2026年1月-9月】RFC-运营商-2098单')
SR_DIR = os.path.join(LEGACY_ROOT, '004【2026年1月-9月】SR-运营商-3418单')

# 确保默认 data 目录存在
os.makedirs(DATA_DIR, exist_ok=True)

# 历史文件名匹配模式与合并后标准文件名
RISK_SRC_PATTERN = 'risk_management_export*.xlsx'
RECT_SRC_PATTERN = 'cs_rc_task_info_getList_all_export_cn_*.xlsx'
RFC_SRC_PATTERN = 'nt_workflow_rfc_getList_for_report_for_export_*.xlsx'
SR_SRC_PATTERN = 'op_ex_sr_problem_detail_export_*.xlsx'
RISK_MERGED_NAME = '【合并后】风险-运营商.xlsx'
RECT_MERGED_NAME = '【合并后】整改-运营商.xlsx'
RFC_MERGED_NAME = '【合并后】RFC-运营商.xlsx'
SR_MERGED_NAME = '【合并后】SR-运营商.xlsx'
SOURCE_MANIFEST_SHEET = '_PR_source_manifest'


class DataValidationError(ValueError):
    """源表无法读取或缺少业务必需字段。"""


def _read_sheet_safely(path, nrows=None):
    """安全读取 Excel 表格，优先读取 'Task List' sheet，不存在则读取首个 sheet"""
    if not path:
        return None
    try:
        with pd.ExcelFile(path) as xl:
            sheet_to_use = 'Task List' if 'Task List' in xl.sheet_names else xl.sheet_names[0]
            df = pd.read_excel(xl, sheet_name=sheet_to_use, nrows=nrows)
        df.columns = [str(c).strip() for c in df.columns]
        if df.columns.duplicated().any():
            raise DataValidationError('去除表头空格后出现重名列，请检查源表表头')
        return df
    except Exception as e:
        raise DataValidationError(f'读取表格失败：{os.path.basename(path)}（{e}）') from e


def inspect_excel_headers(path):
    """快速读取 Excel 首行获取列名列表与 sheet 名（用于指纹识别）"""
    try:
        with pd.ExcelFile(path) as xl:
            sheet_to_use = 'Task List' if 'Task List' in xl.sheet_names else xl.sheet_names[0]
            df_head = pd.read_excel(xl, sheet_name=sheet_to_use, nrows=2)
        cols = [str(c).strip() for c in df_head.columns]
        return cols, sheet_to_use
    except Exception:
        return [], None


def classify_excel_file(path, prompt_interactive=True):
    """
    智能识别 Excel 文件属于哪种类型：'风险'、'整改'、'RFC'、'SR' 或 None。
    1. 首先检查列名特征（权重最高、最准确）
    2. 辅助结合文件名特征
    3. 若特征模糊且 prompt_interactive=True，交互提示用户手动选择
    """
    fname = os.path.basename(path).lower()
    cols, sheet = inspect_excel_headers(path)
    if not cols:
        return None

    scores = {'风险': 0, '整改': 0, 'RFC': 0, 'SR': 0}
    cols_set = set(cols)

    # 1. 风险特征评分
    if '风险ID' in cols_set or any('风险id' in c.lower() for c in cols):
        scores['风险'] += 15
    if '风险等级' in cols_set:
        scores['风险'] += 5
    if '风险状态' in cols_set:
        scores['风险'] += 5
    if '风险类别' in cols_set or '风险标题' in cols_set:
        scores['风险'] += 3
    if 'risk' in fname or '风险' in fname:
        scores['风险'] += 4

    # 2. 整改特征评分
    if '任务号' in cols_set or any('任务号' in c for c in cols):
        scores['整改'] += 15
    if '任务状态' in cols_set:
        scores['整改'] += 5
    if '是否延期' in cols_set:
        scores['整改'] += 5
    if '整改措施' in cols_set or '整改' in fname:
        scores['整改'] += 4
    if 'cs_rc_task' in fname or 'rect' in fname:
        scores['整改'] += 4

    # 3. RFC 特征评分
    if '作业单号/Ticket ID' in cols_set or any('作业单号' in c for c in cols):
        scores['RFC'] += 15
    if '状态/RFC Status' in cols_set:
        scores['RFC'] += 6
    if '级别/Severity' in cols_set:
        scores['RFC'] += 5
    if '客户网络/Network Name' in cols_set:
        scores['RFC'] += 3
    if 'rfc' in fname or 'nt_workflow' in fname:
        scores['RFC'] += 4

    # 4. SR 特征评分
    if '问题单号/SR Number' in cols_set or any('问题单号' in c for c in cols):
        scores['SR'] += 15
    if '问题单状态/SR Status' in cols_set:
        scores['SR'] += 6
    if '问题级别/Problem Level' in cols_set:
        scores['SR'] += 5
    if '逾期/Overdue' in cols_set:
        scores['SR'] += 4
    if 'sr' in fname or 'op_ex_sr' in fname:
        scores['SR'] += 4

    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    best_type, best_score = sorted_scores[0]
    second_type, second_score = sorted_scores[1]

    # 若最高分达到 10 分且明显领先次高分，自动判定
    if best_score >= 10 and best_score >= second_score + 3:
        return best_type

    # 若无法自动确认且允许交互提示
    if prompt_interactive:
        print()
        print(C(f'⚠️  无法完全自动判定文件类型：{os.path.basename(path)}', F_YELLOW, C_BOLD))
        print(f'   文件路径: {C(path, F_GRAY)}')
        print(f'   检测到的表头列名 (前6项): {", ".join(cols[:6])} ...')
        print(f'   评分参考: 风险({scores["风险"]}), 整改({scores["整改"]}), RFC({scores["RFC"]}), SR({scores["SR"]})')
        print(C('   请手动指定该文件所属类型：', F_CYAN))
        print('     [1] 风险-运营商表')
        print('     [2] 整改-运营商表')
        print('     [3] RFC-运营商表')
        print('     [4] SR-运营商表')
        print('     [S] 跳过此文件')
        choice = input(C('   请选择 [1/2/3/4/S]: ', F_YELLOW)).strip().lower()
        mapping = {'1': '风险', '2': '整改', '3': 'RFC', '4': 'SR'}
        if choice in mapping:
            print(C(f'   ✓ 已指定为: {mapping[choice]}', F_GREEN))
            return mapping[choice]
        else:
            print(C('   ⊘ 已跳过该文件', F_GRAY))
            return None

    return None


def _find_merged_for_type(src_type):
    """
    在所有可能位置查找指定类型最新的【合并后】*.xlsx。
    检索顺序：业务历史目录、data/ 目录、BASE_DIR
    """
    dirs = []
    if src_type == '风险':
        dirs.append(RISK_DIR)
    elif src_type == '整改':
        dirs.append(RECT_DIR)
    elif src_type == 'RFC':
        dirs.append(RFC_DIR)
    elif src_type == 'SR':
        dirs.append(SR_DIR)
    dirs.extend(SOURCE_SCAN_ROOTS)

    candidates = []
    keyword = src_type
    for d in dirs:
        if not os.path.exists(d):
            continue
        fs = [f for f in glob.glob(os.path.join(d, '【合并后】*.xlsx')) if keyword in os.path.basename(f)]
        if not fs:
            fs = [f for f in glob.glob(os.path.join(d, f'*{keyword}*合并*.xlsx'))]
        if not fs and d in (RISK_DIR, RECT_DIR, RFC_DIR, SR_DIR):
            fs = glob.glob(os.path.join(d, '【合并后】*.xlsx'))
        candidates.extend(fs)

    if not candidates:
        return None
    return max(candidates, key=os.path.getmtime)


def _find_sources(d, pattern):
    """在目录下找符合 pattern 的原始文件（排除合并后文件与临时文件）"""
    if not os.path.exists(d):
        return []
    fs = [f for f in glob.glob(os.path.join(d, pattern))
          if not os.path.basename(f).startswith('【合并后】') and not os.path.basename(f).startswith('~$')]
    return sorted(fs)


def get_sources_for_type(src_type):
    """
    智能获取指定类型的原始 Excel 文件列表。
    1. 从旧版特定业务目录中按 pattern 查找（兼容原有目录结构）
    2. 同时从 data/ 目录与 BASE_DIR 中自动通过指纹识别查找
    """
    legacy_map = {
        '风险': (RISK_DIR, RISK_SRC_PATTERN),
        '整改': (RECT_DIR, RECT_SRC_PATTERN),
        'RFC':  (RFC_DIR,  RFC_SRC_PATTERN),
        'SR':   (SR_DIR,   SR_SRC_PATTERN),
    }
    dirn, pattern = legacy_map.get(src_type, (None, None))
    legacy_files = _find_sources(dirn, pattern) if dirn and os.path.exists(dirn) else []

    # 自动指纹扫描
    found = list(legacy_files)
    candidate_dirs = [d for d in SOURCE_SCAN_ROOTS + [dirn] if d and os.path.exists(d)]
    seen = {os.path.abspath(path) for path in legacy_files}
    for d in candidate_dirs:
        for f in sorted(glob.glob(os.path.join(d, '*.xlsx')) + glob.glob(os.path.join(d, '*.xls'))):
            bn = os.path.basename(f)
            if bn.startswith('~$') or bn.startswith('【合并后】'):
                continue
            rp = os.path.abspath(f)
            if rp in seen:
                continue
            seen.add(rp)
            ctype = classify_excel_file(f, prompt_interactive=False)
            if ctype == src_type:
                found.append(f)
    return found


def _source_fingerprints(srcs):
    """以相对路径和文件内容识别源数据，忽略不可靠的文件修改时间。"""
    fingerprints = {}
    for filename in srcs:
        digest = hashlib.sha256()
        with open(filename, 'rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        absolute_path = os.path.abspath(filename)
        try:
            source_path = os.path.relpath(absolute_path, BASE_DIR)
        except ValueError:
            # Windows 的外部导入文件可能位于另一个盘符。
            source_path = absolute_path
        relative_path = os.path.normcase(source_path).replace(os.sep, '/')
        fingerprints[relative_path] = digest.hexdigest()
    return sorted(fingerprints.items())


def _read_source_manifest(merged_path):
    """来源记录保存在合并 Excel 的隐藏工作表，兼容旧版和手工合并表。"""
    if not merged_path:
        return None
    workbook = load_workbook(merged_path, read_only=True, data_only=True)
    try:
        if SOURCE_MANIFEST_SHEET not in workbook.sheetnames:
            return None
        sheet = workbook[SOURCE_MANIFEST_SHEET]
        if sheet.cell(1, 1).value != 'PR source manifest' or sheet.cell(1, 2).value != 1:
            raise DataValidationError('合并表来源记录无效，请用菜单 7 重新合并')
        manifest = []
        for path, digest in sheet.iter_rows(min_row=3, max_col=2, values_only=True):
            if not isinstance(path, str) or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
                raise DataValidationError('合并表来源记录损坏，请用菜单 7 重新合并')
            manifest.append((path, digest))
        return sorted(manifest)
    finally:
        workbook.close()


def _write_source_manifest(workbook, manifest):
    sheet = workbook.create_sheet(SOURCE_MANIFEST_SHEET)
    sheet.append(['PR source manifest', 1])
    sheet.append(['源文件相对路径', 'SHA-256'])
    for path, digest in manifest:
        sheet.append([path, digest])
    sheet.sheet_state = 'hidden'


def _current_sources_for_type(src_type):
    """同时跟踪默认目录和智能导入时选过的外部源文件。"""
    sources = {os.path.abspath(path) for path in get_sources_for_type(src_type)}
    manifest = _read_source_manifest(_find_merged_for_type(src_type))
    if manifest is not None:
        known_paths = set()
        for path, _ in manifest:
            path = path.replace('/', os.sep)
            known_paths.add(os.path.abspath(path if os.path.isabs(path) else os.path.join(BASE_DIR, path)))
        sources.update(path for path in known_paths if os.path.isfile(path))
        # 外部导入目录也能识别新增文件；手动指定过的模糊文件保持原分类。
        for directory in {os.path.dirname(path) for path in known_paths}:
            for path in glob.glob(os.path.join(directory, '*.xlsx')) + glob.glob(os.path.join(directory, '*.xls')):
                path = os.path.abspath(path)
                if path in sources or os.path.basename(path).startswith(('~$', '【合并后】')):
                    continue
                if classify_excel_file(path, prompt_interactive=False) == src_type:
                    sources.add(path)
    return sorted(sources)


def need_merge_for_type(src_type, srcs=None):
    """检查源文件增删、改名和内容替换；旧合并表有源文件时首次重建。"""
    if srcs is None:
        srcs = _current_sources_for_type(src_type)
    merged = _find_merged_for_type(src_type)
    previous = _read_source_manifest(merged)
    if not srcs:
        return previous is not None and bool(previous)
    return not merged or previous is None or previous != _source_fingerprints(srcs)


def _read_merge_sources(src_type, srcs):
    if srcs is None:
        srcs = _current_sources_for_type(src_type)
    if not srcs:
        if _read_source_manifest(_find_merged_for_type(src_type)):
            raise DataValidationError(f'{src_type}原始文件已全部移除，已停止操作以避免沿用旧合并数据。请恢复源文件或用菜单 8 重新导入。')
        return [], [], []
    manifest = _source_fingerprints(srcs)
    frames, source_info = [], []
    for filename in srcs:
        frame = _read_sheet_safely(filename)
        frame['数据来源文件'] = os.path.basename(filename)
        frames.append(frame)
        source_info.append((os.path.basename(filename), len(frame)))
    if _source_fingerprints(srcs) != manifest:
        raise DataValidationError(f'{src_type}源文件在读取过程中发生变化，请等待文件保存完成后重试，原合并表保持不变')
    return frames, source_info, manifest


def load_risk():
    p = _find_merged_for_type('风险')
    if not p:
        return None, None
    return _read_sheet_safely(p), p


def load_rect():
    p = _find_merged_for_type('整改')
    if not p:
        return None, None
    return _read_sheet_safely(p), p


def load_rfc():
    p = _find_merged_for_type('RFC')
    if not p:
        return None, None
    return _read_sheet_safely(p), p


def load_sr():
    p = _find_merged_for_type('SR')
    if not p:
        return None, None
    return _read_sheet_safely(p), p


# 整改任务状态排序/着色（与 003 合并脚本一致）
RECT_STATUS_ORDER = {
    'Rectification Completed': 0, 'Rectification Closed': 1,
    'Checking': 2, 'Draft': 3, 'Not Involve': 4,
}
RECT_STATUS_FILL = {
    'Rectification Completed': 'C6EFCE', 'Rectification Closed': 'D9E1F2',
    'Checking': 'FFEB9C', 'Not Involve': 'EDEDED', 'Draft': 'FCE4D6',
}


def _style_header_layout(ws):
    """通用：表头样式 + 冻结首行 + 自动筛选 + 列宽自适应"""
    header_font = Font(name='微软雅黑', size=10, bold=True, color='FFFFFF')
    header_fill = PatternFill(start_color='305496', end_color='305496', fill_type='solid')
    center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    thin = Side(style='thin', color='BFBFBF')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    ncol, nrow = ws.max_column, ws.max_row
    for c in range(1, ncol + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
        cell.border = border
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    for c in range(1, ncol + 1):
        max_len = 0
        cl = get_column_letter(c)
        for r in range(1, min(nrow + 1, 200)):
            v = ws.cell(row=r, column=c).value
            if v is None:
                continue
            s = str(v)
            length = sum(2 if ord(ch) > 127 else 1 for ch in s)
            if length > max_len:
                max_len = length
        ws.column_dimensions[cl].width = min(max(max_len + 2, 10), 50)


def _col_index(ws, name):
    for c in range(1, ws.max_column + 1):
        if ws.cell(row=1, column=c).value == name:
            return c
    return None


def _fill_col(ws, col_name, color_map):
    c = _col_index(ws, col_name)
    if not c:
        return
    for r in range(2, ws.max_row + 1):
        v = ws.cell(row=r, column=c).value
        if v in color_map:
            ws.cell(row=r, column=c).fill = PatternFill(
                start_color=color_map[v], end_color=color_map[v], fill_type='solid')


def _beautify_merged_risk(path):
    wb = load_workbook(path)
    ws = wb['Task List'] if 'Task List' in wb.sheetnames else wb.active
    _style_header_layout(ws)
    _fill_col(ws, '风险等级', {'High': 'FFC7CE', 'Middle': 'FFEB9C', 'Low': 'C6EFCE'})
    _fill_col(ws, '风险状态', {'Risk Closed': 'E2EFDA', 'Risk Suspended': 'FCE4D6'})
    wb.save(path)


def _beautify_merged_rect(path):
    wb = load_workbook(path)
    ws = wb['Task List'] if 'Task List' in wb.sheetnames else wb.active
    _style_header_layout(ws)
    _fill_col(ws, '任务状态', RECT_STATUS_FILL)
    _fill_col(ws, '是否延期', {'是': 'FFC7CE', '否': 'E2EFDA'})
    _fill_col(ws, '重要程度', {'严重': 'FFC7CE', '重要': 'FFEB9C', '一般': 'C6EFCE'})
    wb.save(path)


def merge_risk(srcs=None):
    """合并风险原始表，返回 dict 信息"""
    dfs, src_info, manifest = _read_merge_sources('风险', srcs)
    if not dfs:
        return None
    merged = pd.concat(dfs, ignore_index=True)
    total = len(merged)
    if '风险ID' in merged.columns:
        unique = merged['风险ID'].nunique()
        level_order = {'High': 0, 'Middle': 1, 'Low': 2}
        merged['_lv'] = merged['风险等级'].map(level_order).fillna(3) if '风险等级' in merged.columns else 3
        merged = merged.sort_values(by=['_lv', '风险ID']).drop(columns=['_lv']).reset_index(drop=True)
    else:
        unique = total
    out_dir = RISK_DIR if os.path.exists(RISK_DIR) else DATA_DIR
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, RISK_MERGED_NAME)
    with pd.ExcelWriter(out, engine='openpyxl') as w:
        merged.to_excel(w, sheet_name='Task List', index=False)
        _write_source_manifest(w.book, manifest)
    _beautify_merged_risk(out)
    return {'src': '风险', 'out': out, 'total': total, 'unique': unique,
            'dup': total - unique, 'src_info': src_info}


def merge_rect(srcs=None):
    """合并整改原始表，返回 dict 信息"""
    dfs, src_info, manifest = _read_merge_sources('整改', srcs)
    if not dfs:
        return None
    merged = pd.concat(dfs, ignore_index=True)
    total = len(merged)
    if '任务号' in merged.columns:
        unique = merged['任务号'].nunique()
        merged['_st'] = merged['任务状态'].map(RECT_STATUS_ORDER).fillna(9) if '任务状态' in merged.columns else 9
        merged = merged.sort_values(by=['_st', '任务号']).drop(columns=['_st']).reset_index(drop=True)
    else:
        unique = total
    out_dir = RECT_DIR if os.path.exists(RECT_DIR) else DATA_DIR
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, RECT_MERGED_NAME)
    with pd.ExcelWriter(out, engine='openpyxl') as w:
        merged.to_excel(w, sheet_name='Task List', index=False)
        _write_source_manifest(w.book, manifest)
    _beautify_merged_rect(out)
    return {'src': '整改', 'out': out, 'total': total, 'unique': unique,
            'dup': total - unique, 'src_info': src_info}


# RFC/SR 级别排序
RFC_SEV_ORDER = {'Fatal': 0, 'High': 1, 'Medium': 2, 'Low': 3}
SR_LVL_ORDER = {'Critical': 0, 'Major': 1, 'Minor': 2, 'Non-fault inquiry': 3}


def _beautify_merged_rfc(path):
    wb = load_workbook(path)
    ws = wb['Task List'] if 'Task List' in wb.sheetnames else wb.active
    _style_header_layout(ws)
    _fill_col(ws, '状态/RFC Status', {'已关闭': 'E2EFDA', '已撤销': 'EDEDED'})
    _fill_col(ws, '级别/Severity',
              {'Fatal': 'FFC7CE', 'High': 'FFC7CE', 'Medium': 'FFEB9C', 'Low': 'C6EFCE'})
    wb.save(path)


def _beautify_merged_sr(path):
    wb = load_workbook(path)
    ws = wb['Task List'] if 'Task List' in wb.sheetnames else wb.active
    _style_header_layout(ws)
    _fill_col(ws, '问题单状态/SR Status',
              {'Closed': 'E2EFDA', 'Resolved': 'D9E1F2', 'Solution Provided': 'D9E1F2'})
    _fill_col(ws, '问题级别/Problem Level',
              {'Critical': 'FFC7CE', 'Major': 'FFEB9C', 'Minor': 'C6EFCE', 'Non-fault inquiry': 'EDEDED'})
    _fill_col(ws, '逾期/Overdue', {'是': 'FFC7CE', '否': 'E2EFDA'})
    wb.save(path)


def merge_rfc(srcs=None):
    """合并 RFC 原始表，返回 dict 信息"""
    dfs, src_info, manifest = _read_merge_sources('RFC', srcs)
    if not dfs:
        return None
    merged = pd.concat(dfs, ignore_index=True)
    total = len(merged)
    if '作业单号/Ticket ID' in merged.columns:
        unique = merged['作业单号/Ticket ID'].nunique()
        merged['_lv'] = merged['级别/Severity'].map(RFC_SEV_ORDER).fillna(9) if '级别/Severity' in merged.columns else 9
        merged = merged.sort_values(by=['_lv', '作业单号/Ticket ID']).drop(columns=['_lv']).reset_index(drop=True)
    else:
        unique = total
    out_dir = RFC_DIR if os.path.exists(RFC_DIR) else DATA_DIR
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, RFC_MERGED_NAME)
    with pd.ExcelWriter(out, engine='openpyxl') as w:
        merged.to_excel(w, sheet_name='Task List', index=False)
        _write_source_manifest(w.book, manifest)
    _beautify_merged_rfc(out)
    return {'src': 'RFC', 'out': out, 'total': total, 'unique': unique,
            'dup': total - unique, 'src_info': src_info}


def merge_sr(srcs=None):
    """合并 SR 原始表，返回 dict 信息"""
    dfs, src_info, manifest = _read_merge_sources('SR', srcs)
    if not dfs:
        return None
    merged = pd.concat(dfs, ignore_index=True)
    total = len(merged)
    if '问题单号/SR Number' in merged.columns:
        unique = merged['问题单号/SR Number'].nunique()
        merged['_lv'] = merged['问题级别/Problem Level'].map(SR_LVL_ORDER).fillna(9) if '问题级别/Problem Level' in merged.columns else 9
        merged = merged.sort_values(by=['_lv', '问题单号/SR Number']).drop(columns=['_lv']).reset_index(drop=True)
    else:
        unique = total
    out_dir = SR_DIR if os.path.exists(SR_DIR) else DATA_DIR
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, SR_MERGED_NAME)
    with pd.ExcelWriter(out, engine='openpyxl') as w:
        merged.to_excel(w, sheet_name='Task List', index=False)
        _write_source_manifest(w.book, manifest)
    _beautify_merged_sr(out)
    return {'src': 'SR', 'out': out, 'total': total, 'unique': unique,
            'dup': total - unique, 'src_info': src_info}


def auto_prepare(cfg, prog=None):
    """自动合并：返回本次合并的信息列表（空表示无需合并或已关闭）"""
    done = []
    if not cfg.get('auto_merge', True):
        return done
    for label, merge_fn in [
        ('风险', merge_risk),
        ('整改', merge_rect),
        ('RFC',  merge_rfc),
        ('SR',   merge_sr),
    ]:
        tid = prog.add(f'合并{label}表') if prog else None
        srcs = _current_sources_for_type(label)
        if need_merge_for_type(label, srcs):
            if prog:
                prog.start(tid)
            info = merge_fn(srcs)
            if info:
                done.append(info)
                if prog:
                    prog.done(tid, f'{info["total"]}行 唯一{info["unique"]}')
            else:
                if prog:
                    prog.fail(tid, '未找到原始表')
        else:
            if prog:
                prog.skip(tid, '已是最新')
    return done


def print_merge_report(done):
    """打印自动合并简短报告"""
    if not done:
        return
    print(C('■ 合并统计（按源文件清单和内容检测变化）', F_YELLOW, C_BOLD))
    for info in done:
        dup_color = F_GREEN if info['dup'] == 0 else F_RED
        print(f'  • {C(info["src"], F_CYAN, C_BOLD)}：'
              f'{len(info["src_info"])} 个源文件 → 合并 {C(str(info["total"]), F_YELLOW, C_BOLD)} 行，'
              f'唯一 {info["unique"]}，重复 {C(str(info["dup"]), dup_color, C_BOLD)}')
        print(f'    输出：{C(os.path.basename(info["out"]), F_CYAN)}')
    print()


# ============================================================
# ANSI 彩色输出
# ============================================================
def _enable_ansi():
    if sys.platform == 'win32' and sys.stdout is not None and sys.stdout.isatty():
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            ENABLE_VT = 0x0001 | 0x0002
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), ENABLE_VT)
        except Exception:
            pass

_enable_ansi()

C_RESET = '\033[0m'
C_BOLD = '\033[1m'
F_RED = '\033[91m'
F_GREEN = '\033[92m'
F_YELLOW = '\033[93m'
F_BLUE = '\033[94m'
F_MAGENTA = '\033[95m'
F_CYAN = '\033[96m'
F_WHITE = '\033[97m'
F_GRAY = '\033[90m'
B_BLUE = '\033[44m'
B_CYAN = '\033[46m'
B_GREEN = '\033[46m'


def C(text, *codes):
    return ''.join(codes) + str(text) + C_RESET


def clear_screen():
    sys.stdout.write('\033[2J\033[H')
    sys.stdout.flush()


def print_title(text):
    dl = disp_len(text)
    width = max(dl + 8, 64)
    bar = '═' * width
    print()
    print(C('╔' + bar + '╗', F_CYAN, C_BOLD))
    pad = width - dl
    left = pad // 2
    right = pad - left
    print(C('║', F_CYAN, C_BOLD) + ' ' * left + C(text, F_CYAN, C_BOLD) + ' ' * right + C('║', F_CYAN, C_BOLD))
    print(C('╚' + bar + '╝', F_CYAN, C_BOLD))


_ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')


def _strip_ansi(s):
    return _ANSI_RE.sub('', s)


# 窄 Unicode 标点：在等宽终端占 1 列但 ord>127（默认会算 2 导致偏宽）
_NARROW_CHARS = set(range(0x2010, 0x2016))  # U+2010-U+2015 各种 dash


def disp_len(s):
    total = 0
    for ch in _strip_ansi(s):
        o = ord(ch)
        if o in _NARROW_CHARS:
            total += 1
        elif o > 127:
            total += 2
        else:
            total += 1
    return total


# ============================================================
# 多步骤进度条（spinner + ✓/✗，底部原地刷新）
# ============================================================
_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']


class Progress:
    """多步骤进度条：完成的打 ✓，进行中的旋转 spinner，类似装依赖包的效果，原地刷新。"""

    def __init__(self, title=None):
        self.title = title
        self.tasks = []          # [{label, status, detail}]
        self._lines = 0          # 已渲染行数（用于光标上移）
        self._spin_idx = 0
        self._lock = threading.Lock()
        self._spinning = False
        self._spin_thread = None
        if title:
            print(C(f'■ {title}', F_CYAN, C_BOLD))

    def add(self, label):
        with self._lock:
            self.tasks.append({'label': label, 'status': 'pending', 'detail': ''})
            tid = len(self.tasks) - 1
            self._render()
            return tid

    def start(self, tid):
        with self._lock:
            self.tasks[tid]['status'] = 'running'
            self._render()
        self._ensure_spin()

    def done(self, tid, detail=''):
        with self._lock:
            self.tasks[tid]['status'] = 'done'
            self.tasks[tid]['detail'] = detail
            self._render()
        self._maybe_stop_spin()

    def fail(self, tid, detail=''):
        with self._lock:
            self.tasks[tid]['status'] = 'fail'
            self.tasks[tid]['detail'] = detail
            self._render()
        self._maybe_stop_spin()

    def skip(self, tid, detail=''):
        with self._lock:
            self.tasks[tid]['status'] = 'skip'
            self.tasks[tid]['detail'] = detail
            self._render()
        self._maybe_stop_spin()

    def _ensure_spin(self):
        if not self._spinning:
            self._spinning = True
            self._spin_thread = threading.Thread(target=self._spin_loop, daemon=True)
            self._spin_thread.start()

    def _maybe_stop_spin(self):
        with self._lock:
            if not any(t['status'] == 'running' for t in self.tasks):
                self._spinning = False

    def _spin_loop(self):
        while self._spinning:
            time.sleep(0.12)
            with self._lock:
                if any(t['status'] == 'running' for t in self.tasks):
                    self._spin_idx = (self._spin_idx + 1) % len(_SPINNER_FRAMES)
                    self._render()
                else:
                    self._spinning = False
                    break

    def _render(self):
        out = sys.stdout
        if self._lines > 0:
            out.write(f'\033[{self._lines}A')   # 光标上移
        for t in self.tasks:
            out.write('\033[2K')                  # 清当前行
            label, detail, st = t['label'], t['detail'], t['status']
            if st == 'done':
                line = f'  {C("✓", F_GREEN, C_BOLD)}  {label}'
                if detail:
                    line += f'  {C(detail, F_GRAY)}'
            elif st == 'running':
                sp = _SPINNER_FRAMES[self._spin_idx]
                line = f'  {C(sp, F_YELLOW, C_BOLD)}  {label}{C(" ...", F_GRAY)}'
            elif st == 'fail':
                line = f'  {C("✗", F_RED, C_BOLD)}  {label}'
                if detail:
                    line += f'  {C(detail, F_RED)}'
            elif st == 'skip':
                line = f'  {C("○", F_GRAY)}  {label}'
                if detail:
                    line += f'  {C(detail, F_GRAY)}'
            else:
                line = f'  {C("·", F_GRAY)}  {label}'
            out.write(line + '\n')
        out.flush()
        self._lines = len(self.tasks)

    def finish(self):
        self._spinning = False
        if self._spin_thread:
            self._spin_thread.join(timeout=2)
        with self._lock:
            self._render()


def print_table(headers, rows, header_color=B_BLUE, cell_colors=None, aligns=None):
    ncol = len(headers)
    str_rows = [[('' if v is None else str(v)) for v in r] for r in rows]
    col_w = [disp_len(h) for h in headers]
    for r in str_rows:
        for i in range(ncol):
            col_w[i] = max(col_w[i], disp_len(r[i]))
    col_w = [w + 2 for w in col_w]
    if aligns is None:
        aligns = ['left'] * ncol

    def pad_cell(s, w, align):
        dl = disp_len(s)
        space = w - dl
        if align == 'center':
            l = space // 2
            return ' ' * l + s + ' ' * (space - l)
        elif align == 'right':
            return ' ' * (space - 1) + s + ' '
        else:
            return ' ' + s + ' ' * (space - 1)

    def hline(l, m, r):
        return l + m.join('─' * w for w in col_w) + r

    print(C(hline('┌', '┬', '┐'), F_GRAY))
    hdr = [C(pad_cell(headers[i], col_w[i], 'center'), C_BOLD, F_WHITE, header_color) for i in range(ncol)]
    print(C('│', F_GRAY) + C('│', F_GRAY).join(hdr) + C('│', F_GRAY))
    print(C(hline('├', '┼', '┤'), F_GRAY))
    for ri, r in enumerate(str_rows):
        cells = []
        for ci in range(ncol):
            txt = pad_cell(r[ci], col_w[ci], aligns[ci])
            if cell_colors and cell_colors[ri][ci]:
                cells.append(C(txt, cell_colors[ri][ci], C_BOLD))
            else:
                cells.append(txt)
        print(C('│', F_GRAY) + C('│', F_GRAY).join(cells) + C('│', F_GRAY))
    print(C(hline('└', '┴', '┘'), F_GRAY))


# ============================================================
# 配置
# ============================================================
DEFAULT_CONFIG = {
    'ratio': 0.10,                 # 默认抽查比例
    'seed': None,                  # 随机种子 None=随机
    'priority_high': True,         # 优先高等级/高重要程度
    'uniform_operator': True,      # 按运营商均匀分布
    'uniform_productline': True,   # 风险按产品线均匀分布
    'auto_merge': True,            # 抽查前自动合并统计（检测到原始表更新则合并）
    'duplicate_policy': 'unique',  # unique=按来源类型＋单号去重；records=保留每条记录
    'scopes': {
        'risk_suspend':  {'enable': True,  'ratio': None},  # None=用全局ratio
        'risk_closed':   {'enable': True,  'ratio': None},
        'rect_closed':   {'enable': True,  'ratio': None},  # 整改-已闭环(关闭+完成)
        'rect_delay':    {'enable': True,  'ratio': None},  # 整改-延期
        'rfc_closed_high':   {'enable': True,  'ratio': None},  # RFC-已关闭-高级别(High+Fatal)
        'rfc_closed_medium': {'enable': True,  'ratio': None},  # RFC-已关闭-Medium
        'rfc_closed_low':    {'enable': False, 'ratio': None},  # RFC-已关闭-Low(默认不抽)
        'sr_closed_critical': {'enable': True,  'ratio': None},  # SR-已关闭-Critical
        'sr_closed_major':    {'enable': True,  'ratio': None},  # SR-已关闭-Major
        'sr_closed_minor':    {'enable': False, 'ratio': None},  # SR-已关闭-Minor(默认不抽)
    },
}

SCOPE_META = {
    'risk_suspend': {'name': '风险-中高风险-风险挂起', 'src': '风险'},
    'risk_closed':  {'name': '风险-中高风险-风险关闭', 'src': '风险'},
    'rect_closed':  {'name': '整改-已闭环',           'src': '整改'},
    'rect_delay':   {'name': '整改-延期',             'src': '整改'},
    'rfc_closed_high':   {'name': 'RFC-已关闭-高级别',   'src': 'RFC'},
    'rfc_closed_medium': {'name': 'RFC-已关闭-Medium',   'src': 'RFC'},
    'rfc_closed_low':    {'name': 'RFC-已关闭-Low',      'src': 'RFC'},
    'sr_closed_critical': {'name': 'SR-已关闭-Critical', 'src': 'SR'},
    'sr_closed_major':    {'name': 'SR-已关闭-Major',    'src': 'SR'},
    'sr_closed_minor':    {'name': 'SR-已关闭-Minor',    'src': 'SR'},
}


def clone_cfg(cfg):
    import copy
    return copy.deepcopy(cfg)


# ============================================================
# 抽样核心
# ============================================================
def hamilton_apportion(group_sizes, total_quota):
    """最大余数法按组大小分配整数配额，和=total_quota"""
    keys = list(group_sizes.keys())
    if not keys or total_quota <= 0:
        return {k: 0 for k in keys}
    total = sum(group_sizes.values())
    if total_quota >= total:
        return {k: group_sizes[k] for k in keys}
    raw = {k: group_sizes[k] * total_quota / total for k in keys}
    alloc = {k: int(math.floor(raw[k])) for k in keys}
    remaining = total_quota - sum(alloc.values())
    # 按小数部分降序排，依次+1
    order = sorted(keys, key=lambda k: (raw[k] - alloc[k]), reverse=True)
    idx = 0
    while remaining > 0:
        k = order[idx % len(order)]
        if alloc[k] < group_sizes[k]:
            alloc[k] += 1
            remaining -= 1
        idx += 1
        if idx > len(order) * 4:
            break
    return alloc


# 优先级权重
RECT_IMP_ORDER = {'严重': 3, '重要': 2, '一般': 1}
RISK_LVL_ORDER = {'High': 3, 'Middle': 2, 'Low': 1}
# RFC/SR 优先级（值越大越优先）
RFC_SEV_PRIO = {'Fatal': 4, 'High': 3, 'Medium': 2, 'Low': 1}
SR_LVL_PRIO = {'Critical': 4, 'Major': 3, 'Minor': 2, 'Non-fault inquiry': 1}

# 各来源字段映射：运营商列、产品线列(None=无)、优先级列、优先级映射、明细列
SRC_FIELD_MAP = {
    '风险': {'op': '客户名称', 'pl': '产品线', 'prio': '风险等级', 'pmap': RISK_LVL_ORDER},
    '整改': {'op': '运营商名称', 'pl': None,      'prio': '重要程度', 'pmap': RECT_IMP_ORDER},
    'RFC':  {'op': '客户网络/Network Name', 'pl': '产品线/Product Line',
             'prio': '级别/Severity', 'pmap': RFC_SEV_PRIO},
    'SR':   {'op': '客户名称/Customer Name', 'pl': '产品线/Product Line',
              'prio': '问题级别/Problem Level', 'pmap': SR_LVL_PRIO},
}

# 各来源明细列映射（总表统一列 ← 原始列名）
SRC_DETAIL_MAP = {
    '风险': {'单号': '风险ID', '标题': '风险标题', '状态': '风险状态', '等级': '风险等级',
             '运营商': '客户名称', '产品线': '产品线', '是否延期': None,
             '处理人': '当前处理人', '创建时间': '创单时间'},
    '整改': {'单号': '任务号', '标题': '标题', '状态': '任务状态', '等级': '重要程度',
             '运营商': '运营商名称', '产品线': None, '是否延期': '是否延期',
             '处理人': '处理人', '创建时间': '创建时间'},
    'RFC':  {'单号': '作业单号/Ticket ID', '标题': '摘要/Summary', '状态': '状态/RFC Status',
             '等级': '级别/Severity', '运营商': '客户网络/Network Name',
             '产品线': '产品线/Product Line', '是否延期': None,
             '处理人': '当前处理人/Current Operator', '创建时间': '创建时间/Create Time'},
    'SR':   {'单号': '问题单号/SR Number', '标题': '问题描述/Problem Summary',
             '状态': '问题单状态/SR Status', '等级': '问题级别/Problem Level',
             '运营商': '客户名称/Customer Name', '产品线': '产品线/Product Line',
             '是否延期': '逾期/Overdue', '处理人': '当前责任人/Current Owner',
             '创建时间': '问题单上报时间/SR Report Time'},
}


DUPLICATE_POLICIES = {
    'unique': '按来源类型＋单号去重',
    'records': '按记录抽查（保留重复）',
}


def _duplicate_policy(cfg):
    policy = cfg.get('duplicate_policy', 'unique')
    if policy not in DUPLICATE_POLICIES:
        raise DataValidationError('重复单号处理配置无效，请在菜单 4 重新设置')
    return policy


def _normalized_cell(value, strip_text=True):
    if pd.isna(value):
        return ''
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return str(int(value))
    return str(value).strip() if strip_text else str(value)


def _deduplicate_source(df, src, policy):
    """在范围过滤和配额计算之前去重；同号冲突不得静默选一条。"""
    if policy == 'records':
        return df.copy()
    id_column = SRC_DETAIL_MAP[src]['单号']
    frame = df.copy().reset_index(drop=True)
    frame[id_column] = frame[id_column].map(_normalized_cell)
    missing = frame[id_column].eq('')
    if missing.any():
        raise DataValidationError(f'{src}源表有 {int(missing.sum())} 条记录缺少单号，无法按单号去重，请修正源数据')
    duplicates = frame[frame[id_column].duplicated(keep=False)]
    business_columns = [column for column in frame.columns if column != '数据来源文件']
    for ticket_id, group in duplicates.groupby(id_column, sort=False):
        conflicting = [column for column in business_columns
                       if group[column].map(lambda value: _normalized_cell(value, strip_text=False)).nunique() > 1]
        if conflicting:
            source_files = '、'.join(group['数据来源文件'].dropna().astype(str).unique()) if '数据来源文件' in group else '合并表'
            raise DataValidationError(
                f'{src}单号 {ticket_id} 存在冲突记录，字段：{"、".join(conflicting)}；来源：{source_files}。'
                '已停止抽查，请核对源数据；若需逐条审查不同记录，可在菜单 4 选择按记录抽查。')
    return frame.drop_duplicates(subset=[id_column], keep='first').reset_index(drop=True)


def stratified_sample(df, group_keys, priority_col, priority_map,
                      ratio, priority_high, seed):
    """
    分层抽样：
      df: 待抽样子集
      group_keys: 分层列名 list
      priority_col: 优先级列名
      priority_map: 优先级值->权重
      ratio: 抽样比例
      priority_high: 是否优先高优先级
    返回抽中的 DataFrame
    """
    if not math.isfinite(ratio) or not 0 < ratio <= 1:
        raise DataValidationError('抽查比例必须是 (0,1] 范围内的有限数字')
    sub = df.copy()
    n = len(sub)
    if n == 0:
        return sub
    target = max(1, round(n * ratio))
    target = min(target, n)

    rng = random.Random(seed)

    if not group_keys:
        # 不分层
        if priority_high and priority_col:
            sub = sub.assign(_p=sub[priority_col].map(priority_map).fillna(0))
            # 同优先级内随机
            sub['_r'] = [rng.random() for _ in range(len(sub))]
            sub = sub.sort_values(['_p', '_r'], ascending=[False, True])
            return sub.head(target).drop(columns=['_p', '_r'])
        else:
            return sub.sample(n=target, random_state=seed if seed is not None else rng.randint(0, 2**31))

    # 分层
    sub['_grp'] = sub[group_keys].apply(
        lambda r: '||'.join('' if pd.isna(v) else str(v) for v in r), axis=1)
    group_sizes = sub.groupby('_grp').size().to_dict()
    quota = hamilton_apportion(group_sizes, target)

    picked = []
    for g, q in quota.items():
        if q <= 0:
            continue
        gdf = sub[sub['_grp'] == g]
        if priority_high and priority_col:
            gdf = gdf.assign(_p=gdf[priority_col].map(priority_map).fillna(0))
            gdf['_r'] = [rng.random() for _ in range(len(gdf))]
            gdf = gdf.sort_values(['_p', '_r'], ascending=[False, True])
            picked.append(gdf.head(q))
        else:
            picked.append(gdf.sample(n=min(q, len(gdf)),
                                     random_state=seed if seed is not None else rng.randint(0, 2**31)))
    if picked:
        res = pd.concat(picked, ignore_index=True)
        return res.drop(columns=[c for c in ['_grp', '_p', '_r'] if c in res.columns])
    return sub.iloc[0:0]


# ============================================================
# 范围过滤
# ============================================================
def filter_risk_suspend(df):
    return df[df['风险等级'].isin(['High', 'Middle']) & (df['风险状态'] == 'Risk Suspended')].copy()


def filter_risk_closed(df):
    return df[df['风险等级'].isin(['High', 'Middle']) & (df['风险状态'] == 'Risk Closed')].copy()


def filter_rect_closed(df):
    # 已闭环：整改关闭 + 整改完成
    return df[df['任务状态'].isin(['Rectification Closed', 'Rectification Completed'])].copy()


def filter_rect_delay(df):
    # 延期：是否延期 == 是（与已闭环独立，分别统计）
    return df[df['是否延期'] == '是'].copy()


def filter_rfc_closed_high(df):
    # RFC 已关闭 且 级别 in (High, Fatal)
    return df[(df['状态/RFC Status'] == '已关闭')
              & (df['级别/Severity'].isin(['High', 'Fatal']))].copy()


def filter_rfc_closed_medium(df):
    return df[(df['状态/RFC Status'] == '已关闭')
              & (df['级别/Severity'] == 'Medium')].copy()


def filter_rfc_closed_low(df):
    return df[(df['状态/RFC Status'] == '已关闭')
              & (df['级别/Severity'] == 'Low')].copy()


def filter_sr_closed_critical(df):
    return df[(df['问题单状态/SR Status'] == 'Closed')
              & (df['问题级别/Problem Level'] == 'Critical')].copy()


def filter_sr_closed_major(df):
    return df[(df['问题单状态/SR Status'] == 'Closed')
              & (df['问题级别/Problem Level'] == 'Major')].copy()


def filter_sr_closed_minor(df):
    return df[(df['问题单状态/SR Status'] == 'Closed')
              & (df['问题级别/Problem Level'] == 'Minor')].copy()


SCOPE_FILTERS = {
    'risk_suspend': filter_risk_suspend,
    'risk_closed': filter_risk_closed,
    'rect_closed': filter_rect_closed,
    'rect_delay': filter_rect_delay,
    'rfc_closed_high': filter_rfc_closed_high,
    'rfc_closed_medium': filter_rfc_closed_medium,
    'rfc_closed_low': filter_rfc_closed_low,
    'sr_closed_critical': filter_sr_closed_critical,
    'sr_closed_major': filter_sr_closed_major,
    'sr_closed_minor': filter_sr_closed_minor,
}


SCOPE_REQUIRED_COLUMNS = {
    'risk_suspend': ['风险等级', '风险状态'],
    'risk_closed': ['风险等级', '风险状态'],
    'rect_closed': ['任务状态'],
    'rect_delay': ['是否延期'],
    'rfc_closed_high': ['状态/RFC Status', '级别/Severity'],
    'rfc_closed_medium': ['状态/RFC Status', '级别/Severity'],
    'rfc_closed_low': ['状态/RFC Status', '级别/Severity'],
    'sr_closed_critical': ['问题单状态/SR Status', '问题级别/Problem Level'],
    'sr_closed_major': ['问题单状态/SR Status', '问题级别/Problem Level'],
    'sr_closed_minor': ['问题单状态/SR Status', '问题级别/Problem Level'],
}


def _validate_sampling_columns(src_dfs, cfg):
    """先校验全部启用范围，避免缺列时生成不完整的抽查报告。"""
    for sk, meta in SCOPE_META.items():
        df = src_dfs.get(meta['src'])
        if not cfg['scopes'][sk]['enable'] or df is None:
            continue
        fm = SRC_FIELD_MAP[meta['src']]
        required = list(SCOPE_REQUIRED_COLUMNS[sk])
        required.append(SRC_DETAIL_MAP[meta['src']]['单号'])
        if cfg['uniform_operator']:
            required.append(fm['op'])
        if cfg['uniform_productline'] and fm['pl'] is not None:
            required.append(fm['pl'])
        if cfg['priority_high']:
            required.append(fm['prio'])
        missing = sorted(set(required) - set(df.columns))
        if missing:
            raise DataValidationError(
                f'{meta["name"]}源表缺少必需列：{"、".join(missing)}。'
                '请检查导出表头；若不需要分层或优先级，可在抽样策略中关闭对应选项。')


# ============================================================
# 执行抽查
# ============================================================
def run_sampling(cfg, prog=None):
    # 抽查前自动合并统计（若开启且原始表有更新）
    done = auto_prepare(cfg, prog)

    tid = prog.add('加载合并表') if prog else None
    if prog:
        prog.start(tid)
    risk_df, risk_path = load_risk()
    rect_df, rect_path = load_rect()
    rfc_df, rfc_path = load_rfc()
    sr_df, sr_path = load_sr()
    src_dfs = {'风险': risk_df, '整改': rect_df, 'RFC': rfc_df, 'SR': sr_df}
    src_paths = {'风险': risk_path, '整改': rect_path, 'RFC': rfc_path, 'SR': sr_path}
    _validate_sampling_columns(src_dfs, cfg)
    policy = _duplicate_policy(cfg)
    raw_src_dfs = src_dfs.copy()
    active_sources = {meta['src'] for sk, meta in SCOPE_META.items() if cfg['scopes'][sk]['enable']}
    for src in active_sources:
        if src_dfs[src] is not None:
            src_dfs[src] = _deduplicate_source(src_dfs[src], src, policy)
    n_ready = sum(1 for d in src_dfs.values() if d is not None)
    if prog:
        prog.done(tid, f'{n_ready}/4 来源就绪')

    results = {}   # scope_key -> {picked, total, ratio, src}
    seed = cfg['seed']
    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    for sk, meta in SCOPE_META.items():
        sc = cfg['scopes'][sk]
        if not sc['enable']:
            results[sk] = None
            continue
        ratio = sc['ratio'] if sc['ratio'] is not None else cfg['ratio']
        src = meta['src']
        df = src_dfs.get(src)
        if df is None:
            results[sk] = None
            continue
        tid = prog.add(f'抽样 {meta["name"]}') if prog else None
        if prog:
            prog.start(tid)
        fm = SRC_FIELD_MAP[src]
        sub = SCOPE_FILTERS[sk](df)
        # 分层键：运营商（+产品线，若该来源有产品线列且开启）
        group_keys = []
        if cfg['uniform_operator']:
            group_keys.append(fm['op'])
        if cfg['uniform_productline'] and fm['pl'] is not None:
            group_keys.append(fm['pl'])
        picked = stratified_sample(sub, group_keys, fm['prio'], fm['pmap'],
                                   ratio, cfg['priority_high'], seed)
        results[sk] = {
            'picked': picked, 'total': len(sub), 'ratio': ratio,
            'src': src, 'name': meta['name'], 'sub': sub,
            'raw_total': len(SCOPE_FILTERS[sk](raw_src_dfs[src])),
        }
        if prog:
            prog.done(tid, f'{len(picked)}/{len(sub)}')

    return results, seed, src_paths, done


# ============================================================
# 输出 Excel
# ============================================================
def export_results(results, cfg, seed, src_paths):
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    out_path = os.path.join(DATA_DIR if CUSTOM_DATA_DIR else BASE_DIR, f'【抽查结果】{ts}.xlsx')

    # 统一总表
    rows = []
    seq = 1
    for sk, meta in SCOPE_META.items():
        r = results.get(sk)
        if not r or r['picked'] is None or len(r['picked']) == 0:
            continue
        pk = r['picked']
        dm = SRC_DETAIL_MAP[r['src']]
        for _, row in pk.iterrows():
            def _g(key):
                col = dm.get(key)
                if col is None:
                    return ''
                return row.get(col, '')
            rows.append({
                '序号': seq, '抽查来源': r['src'], '抽查范围': r['name'],
                '单号': _g('单号'), '标题': _g('标题'), '状态': _g('状态'),
                '等级/重要程度': _g('等级'), '运营商': _g('运营商'),
                '产品线': _g('产品线'), '是否延期': _g('是否延期'),
                '处理人': _g('处理人'), '创建时间': _g('创建时间'),
            })
            seq += 1
    total_df = pd.DataFrame(rows)

    with pd.ExcelWriter(out_path, engine='openpyxl') as writer:
        total_df.to_excel(writer, sheet_name='抽查总表', index=False)
        # 各来源明细
        for sk, meta in SCOPE_META.items():
            r = results.get(sk)
            if not r or r['picked'] is None or len(r['picked']) == 0:
                continue
            sheet = f"{meta['src']}-{sk}"[:31]
            r['picked'].to_excel(writer, sheet_name=sheet, index=False)
        # 配置
        cfg_rows = [
            ['抽查比例(全局)', cfg['ratio']],
            ['随机种子', seed],
            ['优先高等级/高重要程度', cfg['priority_high']],
            ['按运营商均匀分布', cfg['uniform_operator']],
            ['风险按产品线均匀分布', cfg['uniform_productline']],
            ['重复单号处理', DUPLICATE_POLICIES[_duplicate_policy(cfg)]],
            ['生成时间', datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')],
        ]
        for src_name, p in src_paths.items():
            cfg_rows.append([f'{src_name}源文件', os.path.basename(p) if p else '未找到'])
        cfg_rows += [['', ''], ['抽查范围', '开启 / 比例 / 候选数 / 抽中数']]
        for sk, meta in SCOPE_META.items():
            r = results.get(sk)
            sc = cfg['scopes'][sk]
            ratio = sc['ratio'] if sc['ratio'] is not None else cfg['ratio']
            if r:
                cfg_rows.append([meta['name'], f"{'开启' if sc['enable'] else '关闭'} / {ratio*100:.0f}% / {r['total']} / {len(r['picked'])}"])
            else:
                cfg_rows.append([meta['name'], f"{'开启' if sc['enable'] else '关闭'} / {ratio*100:.0f}% / - / -"])
        pd.DataFrame(cfg_rows, columns=['配置项', '值']).to_excel(writer, sheet_name='抽查配置', index=False)
        count_rows = [
            {'抽查范围': meta['name'], '原始候选记录数': results[sk].get('raw_total', results[sk]['total']),
             '处理后候选数': results[sk]['total'], '抽中记录数': len(results[sk]['picked'])}
            for sk, meta in SCOPE_META.items() if results.get(sk)
        ]
        pd.DataFrame(count_rows, columns=['抽查范围', '原始候选记录数', '处理后候选数', '抽中记录数']).to_excel(
            writer, sheet_name='候选统计', index=False)

    _beautify(out_path)
    return out_path, total_df


def _beautify(path):
    wb = load_workbook(path)
    header_font = Font(name='微软雅黑', size=10, bold=True, color='FFFFFF')
    header_fill = PatternFill(start_color='305496', end_color='305496', fill_type='solid')
    center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    thin = Side(style='thin', color='BFBFBF')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for ws in wb.worksheets:
        ncol, nrow = ws.max_column, ws.max_row
        for c in range(1, ncol + 1):
            cell = ws.cell(row=1, column=c)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = center
            cell.border = border
        # 总表着色
        if ws.title == '抽查总表':
            src_col = lvl_col = None
            for c in range(1, ncol + 1):
                v = ws.cell(row=1, column=c).value
                if v == '抽查来源':
                    src_col = c
                if v == '等级/重要程度':
                    lvl_col = c
            src_fill = {
                '风险': PatternFill(start_color='FCE4D6', end_color='FCE4D6', fill_type='solid'),
                '整改': PatternFill(start_color='D9E1F2', end_color='D9E1F2', fill_type='solid'),
                'RFC': PatternFill(start_color='E2EFDA', end_color='E2EFDA', fill_type='solid'),
                'SR':  PatternFill(start_color='FFF2CC', end_color='FFF2CC', fill_type='solid'),
            }
            lvl_fill = {
                'High': PatternFill(start_color='FFC7CE', end_color='FFC7CE', fill_type='solid'),
                'Middle': PatternFill(start_color='FFEB9C', end_color='FFEB9C', fill_type='solid'),
                '严重': PatternFill(start_color='FFC7CE', end_color='FFC7CE', fill_type='solid'),
                '重要': PatternFill(start_color='FFEB9C', end_color='FFEB9C', fill_type='solid'),
                'Fatal': PatternFill(start_color='FFC7CE', end_color='FFC7CE', fill_type='solid'),
                'Critical': PatternFill(start_color='FFC7CE', end_color='FFC7CE', fill_type='solid'),
                'Major': PatternFill(start_color='FFEB9C', end_color='FFEB9C', fill_type='solid'),
            }
            for r in range(2, nrow + 1):
                if src_col:
                    v = ws.cell(row=r, column=src_col).value
                    if v in src_fill:
                        ws.cell(row=r, column=src_col).fill = src_fill[v]
                if lvl_col:
                    v = ws.cell(row=r, column=lvl_col).value
                    if v in lvl_fill:
                        ws.cell(row=r, column=lvl_col).fill = lvl_fill[v]
        ws.freeze_panes = 'A2'
        ws.auto_filter.ref = ws.dimensions
        for c in range(1, ncol + 1):
            max_len = 0
            cl = get_column_letter(c)
            for r in range(1, min(nrow + 1, 200)):
                v = ws.cell(row=r, column=c).value
                if v is None:
                    continue
                s = str(v)
                length = sum(2 if ord(ch) > 127 else 1 for ch in s)
                if length > max_len:
                    max_len = length
            ws.column_dimensions[cl].width = min(max(max_len + 2, 10), 50)
    wb.save(path)


# ============================================================
# 命令行报告
# ============================================================
def print_report(results, cfg, seed, out_path, total_df):
    print_title('PR 报告抽查结果')

    # 概览
    print()
    print(C('■ 抽查概览', F_CYAN, C_BOLD))
    ov_rows = []
    ov_colors = []
    total_picked = 0
    total_candidate = 0
    for sk, meta in SCOPE_META.items():
        r = results.get(sk)
        sc = cfg['scopes'][sk]
        ratio = sc['ratio'] if sc['ratio'] is not None else cfg['ratio']
        if not sc['enable']:
            ov_rows.append([meta['name'], C('关闭', F_GRAY), '-', '-', '-'])
            ov_colors.append([F_GRAY, F_GRAY, F_GRAY, F_GRAY, F_GRAY])
            continue
        if not r:
            ov_rows.append([meta['name'], C('开启', F_GREEN), f'{ratio*100:.0f}%', '0(无数据)', '0'])
            ov_colors.append([F_WHITE, F_GREEN, F_CYAN, F_RED, F_RED])
            continue
        cand = r['total']
        pick = len(r['picked'])
        total_picked += pick
        total_candidate += cand
        ov_rows.append([meta['name'], C('开启', F_GREEN), f'{ratio*100:.0f}%', str(cand), C(str(pick), F_YELLOW, C_BOLD)])
        ov_colors.append([F_WHITE, F_GREEN, F_CYAN, F_CYAN, F_YELLOW])
    ov_rows.append([C('合计', C_BOLD), '', '', str(total_candidate), C(str(total_picked), F_MAGENTA, C_BOLD)])
    ov_colors.append([F_MAGENTA, F_MAGENTA, F_MAGENTA, F_MAGENTA, F_MAGENTA])
    print_table(['抽查范围', '状态', '比例', '候选数', '抽中数'], ov_rows,
                cell_colors=ov_colors, aligns=['left', 'center', 'right', 'right', 'right'])
    for sk, meta in SCOPE_META.items():
        r = results.get(sk)
        if r and r.get('raw_total', r['total']) != r['total']:
            print(C(f'  • {meta["name"]}：原始 {r["raw_total"]} 条记录 → 去重后 {r["total"]} 张单子，按去重后数量计算比例。', F_GRAY))

    # 各范围分布
    high_levels = {'High', 'Fatal', 'Critical', '严重'}
    mid_levels = {'Middle', 'Major', '重要'}
    for sk, meta in SCOPE_META.items():
        r = results.get(sk)
        if not r or r['picked'] is None or len(r['picked']) == 0:
            continue
        pk = r['picked']
        src = r['src']
        fm = SRC_FIELD_MAP[src]
        dm = SRC_DETAIL_MAP[src]
        op_col = fm['op']
        pl_col = fm['pl']          # None for 整改
        delay_col = dm.get('是否延期')  # None for 风险/RFC
        print()
        print(C(f'■ {meta["name"]} — 抽中 {len(pk)} 单', F_CYAN, C_BOLD))

        # 分布表
        sub = r['sub']
        if pl_col:
            sub = sub.fillna({op_col: '(空)', pl_col: '(空)'})
            pkf = pk.fillna({op_col: '(空)', pl_col: '(空)'})
            cand_d = sub.groupby([op_col, pl_col]).size().to_dict()
            pick_d = pkf.groupby([op_col, pl_col]).size().to_dict()
            all_keys = set(cand_d) | set(pick_d)
            sorted_keys = sorted(all_keys, key=lambda k: (-cand_d.get(k, 0), str(k)))
            dist_rows, dist_colors = [], []
            for k in sorted_keys:
                c = int(cand_d.get(k, 0))
                p = int(pick_d.get(k, 0))
                dist_rows.append([str(k[0]), str(k[1]), str(c), str(p)])
                dist_colors.append([F_BLUE, F_BLUE, F_GRAY, F_YELLOW])
            dist_rows.append([C('合计', C_BOLD), '', str(r['total']), C(str(len(pk)), F_YELLOW, C_BOLD)])
            dist_colors.append([F_MAGENTA, F_MAGENTA, F_MAGENTA, F_MAGENTA])
            print_table(['运营商', '产品线', '候选数', '抽中数'], dist_rows,
                        cell_colors=dist_colors, aligns=['left', 'left', 'right', 'right'])
        else:
            sub = sub.fillna({op_col: '(空)'})
            pkf = pk.fillna({op_col: '(空)'})
            cand_d = sub.groupby(op_col).size().to_dict()
            pick_d = pkf.groupby(op_col).size().to_dict()
            all_keys = set(cand_d) | set(pick_d)
            sorted_keys = sorted(all_keys, key=lambda k: (-cand_d.get(k, 0), str(k)))
            dist_rows, dist_colors = [], []
            for k in sorted_keys:
                c = int(cand_d.get(k, 0))
                p = int(pick_d.get(k, 0))
                dist_rows.append([str(k), str(c), str(p)])
                dist_colors.append([F_BLUE, F_GRAY, F_YELLOW])
            dist_rows.append([C('合计', C_BOLD), str(r['total']), C(str(len(pk)), F_YELLOW, C_BOLD)])
            dist_colors.append([F_MAGENTA, F_MAGENTA, F_MAGENTA])
            print_table(['运营商', '候选数', '抽中数'], dist_rows,
                        cell_colors=dist_colors, aligns=['left', 'right', 'right'])

        # 明细表
        lvl_col = dm['等级']
        headers = ['单号', '等级', '状态', '运营商']
        if pl_col:
            headers.append('产品线')
        if delay_col:
            headers.append('逾期' if src == 'SR' else '是否延期')
        det_rows, det_colors = [], []
        for _, row in pk.iterrows():
            lv = row.get(lvl_col, '')
            fg = F_RED if lv in high_levels else (F_YELLOW if lv in mid_levels else F_GREEN)
            _op = row.get(op_col, '')
            _op = str(_op) if pd.notna(_op) else '(空)'
            cells = [str(row.get(dm['单号'], '')), str(lv), str(row.get(dm['状态'], '')), _op[:20]]
            colors = [F_WHITE, fg, F_CYAN, F_BLUE]
            if pl_col:
                cells.append(str(row.get(pl_col, '')))
                colors.append(F_BLUE)
            if delay_col:
                dv = str(row.get(delay_col, ''))
                cells.append(dv)
                colors.append(F_RED if dv in ('是', 'Yes') else F_GRAY)
            det_rows.append(cells)
            det_colors.append(colors)
        print_table(headers, det_rows, cell_colors=det_colors,
                    aligns=['left', 'center', 'left', 'left'] + ['left'] * (len(headers) - 4))

    # 结论
    print()
    print(C('■ 抽查配置与输出', F_CYAN, C_BOLD))
    _rp = f'{cfg["ratio"]*100:.0f}%'
    print(f'  • 全局抽查比例：{C(_rp, F_YELLOW, C_BOLD)}')
    print(f'  • 优先高等级/高重要程度：{C("是", F_GREEN, C_BOLD) if cfg["priority_high"] else C("否", F_GRAY)}')
    print(f'  • 重复单号处理：{C(DUPLICATE_POLICIES[_duplicate_policy(cfg)], F_CYAN)}')
    print(f'  • 按运营商均匀分布：{C("是", F_GREEN, C_BOLD) if cfg["uniform_operator"] else C("否", F_GRAY)}')
    print(f'  • 按产品线均匀分布(风险/RFC/SR)：{C("是", F_GREEN, C_BOLD) if cfg["uniform_productline"] else C("否", F_GRAY)}')
    print(f'  • 随机种子：{C(str(seed), F_CYAN)}（复现可用此种子）')
    print(f'  • 抽中总数：{C(str(total_picked), F_MAGENTA, C_BOLD)} 单')
    print(f'  • 输出文件：{C(os.path.basename(out_path), F_CYAN, C_BOLD)}')
    print(f'    路径：{C(out_path, F_GRAY)}')
    print()


# ============================================================
# 交互菜单
# ============================================================
def _input_float(prompt, default):
    while True:
        s = input(C(prompt, F_CYAN) + f' [默认 {default}]: ').strip()
        if s == '':
            return default
        try:
            return float(s)
        except ValueError:
            print(C('  ✗ 请输入数字', F_RED))


def _input_int(prompt, default):
    while True:
        s = input(C(prompt, F_CYAN) + f' [默认 {default}]: ').strip()
        if s == '':
            return default
        try:
            return int(s)
        except ValueError:
            print(C('  ✗ 请输入整数', F_RED))


def _input_bool(prompt, default):
    d = 'y' if default else 'n'
    s = input(C(prompt, F_CYAN) + f' [y/n 默认 {d}]: ').strip().lower()
    if s == '':
        return default
    return s in ('y', 'yes', '1', '是')


def menu_set_ratio(cfg):
    clear_screen()
    print_title('设置抽查比例')
    v = _input_float('请输入抽查比例(0-1, 如 0.1=10%)', cfg['ratio'])
    if math.isfinite(v) and 0 < v <= 1:
        cfg['ratio'] = v
    else:
        print(C('  ✗ 比例需在 (0,1] 区间', F_RED))


def menu_set_scopes(cfg):
    while True:
        clear_screen()
        print(C('■ 抽查范围设置', F_CYAN, C_BOLD))
        keys = list(SCOPE_META.keys())
        for i, sk in enumerate(keys, 1):
            meta = SCOPE_META[sk]
            sc = cfg['scopes'][sk]
            ratio = sc['ratio'] if sc['ratio'] is not None else cfg['ratio']
            en = C('开启', F_GREEN) if sc['enable'] else C('关闭', F_GRAY)
            rstr = C(f'{ratio*100:.0f}%', F_YELLOW) if sc['ratio'] is not None else C(f'{ratio*100:.0f}%(全局)', F_CYAN)
            print(f'  {i}. {meta["name"]}  [{en}]  比例 {rstr}')
        print(f'  0. 返回')
        s = input(C('选择范围编号: ', F_CYAN)).strip()
        if s == '0' or s == '':
            return
        try:
            selected = int(s)
            if not 1 <= selected <= len(keys):
                raise ValueError('范围编号越界')
            sk = keys[selected - 1]
        except (ValueError, IndexError):
            print(C('  ✗ 无效编号', F_RED))
            continue
        meta = SCOPE_META[sk]
        sc = cfg['scopes'][sk]
        sc['enable'] = _input_bool(f'  开启 {meta["name"]}?', sc['enable'])
        use_global = _input_bool('  使用全局比例?', sc['ratio'] is None)
        if use_global:
            sc['ratio'] = None
        else:
            v = _input_float('  请输入该范围比例(0-1)', sc['ratio'] if sc['ratio'] is not None else cfg['ratio'])
            if math.isfinite(v) and 0 < v <= 1:
                sc['ratio'] = v
            else:
                print(C('  ✗ 比例需为 (0,1] 区间内的有限数字，保留原比例', F_RED))


def menu_set_strategy(cfg):
    clear_screen()
    print()
    print(C('■ 抽样策略设置', F_CYAN, C_BOLD))
    cfg['priority_high'] = _input_bool('优先高等级/高重要程度?', cfg['priority_high'])
    cfg['uniform_operator'] = _input_bool('按运营商均匀分布?', cfg['uniform_operator'])
    cfg['uniform_productline'] = _input_bool('按产品线均匀分布(风险/RFC/SR)?', cfg['uniform_productline'])
    set_seed = _input_bool('设置固定随机种子(便于复现)?', cfg['seed'] is not None)
    if set_seed:
        cfg['seed'] = _input_int('请输入随机种子', cfg['seed'] if cfg['seed'] is not None else 42)
    else:
        cfg['seed'] = None
    policy = _duplicate_policy(cfg)
    print(C('重复单号处理（同号冲突不会自动选取一条）：', F_CYAN))
    print('  1. 按来源类型＋单号去重（默认；冲突时停止抽查）')
    print('  2. 按记录抽查（保留重复，可用于审查多次记录）')
    while True:
        choice = input(C(f'请选择 [1/2，回车保留：{DUPLICATE_POLICIES[policy]}]: ', F_CYAN)).strip()
        if not choice:
            break
        if choice in ('1', '2'):
            cfg['duplicate_policy'] = 'unique' if choice == '1' else 'records'
            break
        print(C('  ✗ 请输入 1 或 2', F_RED))


def menu_show_cfg(cfg):
    clear_screen()
    print()
    print(C('■ 当前配置（只读展示，如需修改请用菜单 3 / 4）', F_CYAN, C_BOLD))
    _rp = f'{cfg["ratio"]*100:.0f}%'
    print(f'  • 全局抽查比例：{C(_rp, F_YELLOW, C_BOLD)}')
    print(f'  • 优先高等级/高重要程度：{C("是", F_GREEN) if cfg["priority_high"] else C("否", F_GRAY)}')
    print(f'  • 按运营商均匀分布：{C("是", F_GREEN) if cfg["uniform_operator"] else C("否", F_GRAY)}')
    print(f'  • 按产品线均匀分布(风险/RFC/SR)：{C("是", F_GREEN) if cfg["uniform_productline"] else C("否", F_GRAY)}')
    print(f'  • 自动合并统计：{C("是", F_GREEN) if cfg["auto_merge"] else C("否", F_GRAY)}')
    print(f'  • 重复单号处理：{C(DUPLICATE_POLICIES[_duplicate_policy(cfg)], F_CYAN)}')
    print(f'  • 随机种子：{C(str(cfg["seed"]), F_CYAN) if cfg["seed"] is not None else C("随机", F_GRAY)}')
    print(f'  • 抽查范围：')
    for sk, meta in SCOPE_META.items():
        sc = cfg['scopes'][sk]
        ratio = sc['ratio'] if sc['ratio'] is not None else cfg['ratio']
        en = C('开启', F_GREEN) if sc['enable'] else C('关闭', F_GRAY)
        rstr = f'{ratio*100:.0f}%' + ('(自定义)' if sc['ratio'] is not None else '(全局)')
        print(f'      - {meta["name"]}: [{en}] {rstr}')
    print()


def menu_smart_import():
    """多文件/多文件夹智能分类导入向导"""
    clear_screen()
    print_title('智能扫描与分类导入（多文件 / 多文件夹自动识别）')
    print(C('■ 功能说明：', F_CYAN, C_BOLD))
    print(C('  • 支持扫描多个文件夹，表格即使未按 RFC/SR/整改/风险 分目录存放，', F_WHITE))
    print(C('    脚本也会根据表格的【表头特征列指纹】智能自动识别业务类型。', F_WHITE))
    print(C('  • 遇到未知或模糊表格时，支持交互手动指派归类；', F_WHITE))
    print(C('  • 分类完成后可一键执行多源自动合并，无需重新安装或替换框架。', F_WHITE))
    print()
    print(C(f'当前扫描目录：{"、".join(SOURCE_SCAN_ROOTS)} 及已有的各业务目录', F_GRAY))
    custom_in = input(C('是否指定自定义扫描目录路径 (直接回车使用默认目录，多个目录用分号隔开): ', F_CYAN)).strip()

    scan_dirs = []
    if custom_in:
        for p in custom_in.replace('，', ',').replace('；', ';').split(';'):
            p = p.strip()
            if p:
                if os.path.exists(p):
                    scan_dirs.append(p)
                else:
                    print(C(f'  ⚠️ 路径不存在已忽略: {p}', F_YELLOW))
    if not scan_dirs:
        scan_dirs = list(SOURCE_SCAN_ROOTS)
        for d in [RISK_DIR, RECT_DIR, RFC_DIR, SR_DIR]:
            if os.path.exists(d):
                scan_dirs.append(d)

    print()
    print(C('🔍 正在扫描待识别的 Excel 表格...', F_CYAN))
    for d in scan_dirs:
        print(f'   • {d}')

    all_files = []
    seen = set()
    for d in scan_dirs:
        if not os.path.exists(d):
            continue
        for root, _, files in os.walk(d):
            for fn in files:
                if (fn.endswith('.xlsx') or fn.endswith('.xls')) and not fn.startswith('~$') and not fn.startswith('【合并后】'):
                    fp = os.path.abspath(os.path.join(root, fn))
                    if fp not in seen:
                        seen.add(fp)
                        all_files.append(fp)

    if not all_files:
        print()
        print(C('✗ 未在上述目录中找到任何待处理的 Excel 文件！', F_RED, C_BOLD))
        print(C(f'💡 提示：您可以将原始表格直接拷贝放入 {DATA_DIR} 目录后再次尝试。', F_YELLOW))
        input(C('按回车返回主菜单...', F_GRAY))
        return

    print()
    print(C(f'共扫描到 {len(all_files)} 个原始 Excel 文件，开始智能指纹识别分类：', F_CYAN, C_BOLD))
    classified = {'风险': [], '整改': [], 'RFC': [], 'SR': []}
    skipped = []

    for idx, fp in enumerate(all_files, 1):
        fn = os.path.basename(fp)
        print(f'  [{idx}/{len(all_files)}] 分析: {fn[:36]} ... ', end='', flush=True)
        ctype = classify_excel_file(fp, prompt_interactive=True)
        if ctype in classified:
            classified[ctype].append(fp)
            print(f'-> {C(ctype, F_GREEN, C_BOLD)}')
        else:
            skipped.append(fp)
            print(f'-> {C("跳过/未知", F_GRAY)}')

    print()
    print(C('■ 智能分类结果汇总', F_CYAN, C_BOLD))
    total_recognized = sum(len(v) for v in classified.values())
    for ctype in ['风险', '整改', 'RFC', 'SR']:
        flist = classified[ctype]
        print(f'  • {C(ctype, F_YELLOW, C_BOLD)}：共 {C(str(len(flist)), F_GREEN, C_BOLD)} 个源文件')
        for f in flist[:4]:
            print(f'      - {os.path.basename(f)}')
        if len(flist) > 4:
            print(f'      - ... 以及另外 {len(flist) - 4} 个文件')
    if skipped:
        print(f'  • 未识别/跳过：{len(skipped)} 个文件')

    if total_recognized == 0:
        print()
        print(C('✗ 没有识别到任何有效类型的表格。', F_RED))
        input(C('按回车返回主菜单...', F_GRAY))
        return

    print()
    do_merge = _input_bool('是否立即按照上述识别结果执行合并统计？', True)
    if do_merge:
        prog = Progress('合并进度')
        done = []
        try:
            for label, fn in [('风险', merge_risk), ('整改', merge_rect),
                              ('RFC', merge_rfc), ('SR', merge_sr)]:
                srcs = classified[label]
                if srcs:
                    tid = prog.add(f'合并{label}表')
                    prog.start(tid)
                    info = fn(srcs)
                    if info:
                        done.append(info)
                        prog.done(tid, f'{info["total"]}行 唯一{info["unique"]}')
                    else:
                        prog.fail(tid, '合并失败')
        finally:
            prog.finish()
        print()
        print_merge_report(done)
    input(C('按回车返回主菜单...', F_GRAY))


def main():
    cfg = clone_cfg(DEFAULT_CONFIG)
    while True:
        clear_screen()
        print_title('PR 报告抽查脚本 — 主菜单')
        print(C('━━━ 主菜单 ━━━', F_CYAN, C_BOLD))
        print(f'  {C("1", F_YELLOW, C_BOLD)}. 开始抽查（当前配置）')
        print(f'  {C("2", F_YELLOW, C_BOLD)}. 设置抽查比例（当前 {cfg["ratio"]*100:.0f}%）')
        print(f'  {C("3", F_YELLOW, C_BOLD)}. 设置抽查范围（开关/比例）')
        print(f'  {C("4", F_YELLOW, C_BOLD)}. 设置抽样策略（去重/优先级/均匀分布/种子）')
        print(f'  {C("5", F_YELLOW, C_BOLD)}. 查看当前配置（只读）')
        _am = C('开启', F_GREEN) if cfg['auto_merge'] else C('关闭', F_GRAY)
        print(f'  {C("6", F_YELLOW, C_BOLD)}. 自动合并统计（当前 {_am}）')
        print(f'  {C("7", F_YELLOW, C_BOLD)}. 立即合并统计（手动触发）')
        print(f'  {C("8", F_YELLOW, C_BOLD)}. 智能分类导入（多文件/多文件夹自动识别与合并）')
        print(f'  {C("0", F_YELLOW, C_BOLD)}. 退出')
        s = input(C('请选择: ', F_CYAN)).strip()
        prog = None
        try:
            if s == '1':
                clear_screen()
                prog = Progress('抽查进度')
                results, seed, src_paths, done = run_sampling(cfg, prog)
                if all(v is None for v in results.values()):
                    prog.finish()
                    print(C('✗ 未找到任何数据或范围全部关闭', F_RED, C_BOLD))
                    input(C('按回车返回主菜单...', F_GRAY))
                    continue
                tid = prog.add('导出 Excel 总表')
                prog.start(tid)
                out_path, total_df = export_results(results, cfg, seed, src_paths)
                prog.done(tid, f'{len(total_df)} 行')
                prog.finish()
                print()
                clear_screen()
                print_report(results, cfg, seed, out_path, total_df)
                input(C('按回车返回主菜单...', F_GRAY))
            elif s == '2':
                menu_set_ratio(cfg)
            elif s == '3':
                menu_set_scopes(cfg)
            elif s == '4':
                menu_set_strategy(cfg)
            elif s == '5':
                menu_show_cfg(cfg)
                input(C('按回车返回主菜单...', F_GRAY))
            elif s == '6':
                clear_screen()
                print_title('自动合并设置')
                cfg['auto_merge'] = _input_bool('抽查前自动合并统计（检测到原始表更新则合并）?',
                                                cfg['auto_merge'])
            elif s == '7':
                clear_screen()
                print_title('立即合并统计')
                prog = Progress('合并进度')
                done = []
                for label, fn in [('风险', merge_risk), ('整改', merge_rect),
                                  ('RFC', merge_rfc), ('SR', merge_sr)]:
                    tid = prog.add(f'合并{label}表')
                    prog.start(tid)
                    info = fn()
                    if info:
                        done.append(info)
                        prog.done(tid, f'{info["total"]}行 唯一{info["unique"]}')
                    else:
                        prog.fail(tid, '未找到原始表')
                prog.finish()
                print()
                print_merge_report(done)
                if not done:
                    print(C('  （无原始表可合并）', F_GRAY))
                input(C('按回车返回主菜单...', F_GRAY))
            elif s == '8':
                menu_smart_import()
            elif s == '0':
                print(C('再见 👋', F_CYAN))
                break
            else:
                print(C('✗ 无效选择', F_RED))
                input(C('按回车返回主菜单...', F_GRAY))

        except (DataValidationError, OSError, KeyError) as e:
            if prog is not None:
                for tid, task in enumerate(prog.tasks):
                    if task['status'] == 'running':
                        prog.fail(tid, '操作中止')
                prog.finish()
            print(C(f'✗ 操作未完成：{e}', F_RED, C_BOLD))
            if isinstance(e, PermissionError):
                print(C('请关闭正在 Excel 中打开的输出文件，并检查目录的写入权限。', F_YELLOW))
            input(C('按回车返回主菜单...', F_GRAY))


if __name__ == '__main__':
    main()
