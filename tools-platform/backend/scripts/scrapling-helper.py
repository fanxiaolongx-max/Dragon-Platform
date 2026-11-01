#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Scrapling 辅助工具：为 Dragon Claw 提供高性能抗反爬网页抓取与自适应 DOM 解析。
支持两种模式：
1. fetch: 隐身模式抓取公开 URL（基于 curl_cffi 模拟真实浏览器 TLS/JA3 指纹，过 Cloudflare）
2. parse: 解析从 Dragon 浏览器标签页获取的实时 DOM（支持已登录站点，保留 Cookie 与会话态）
"""

import sys
import os
import json
import logging
import argparse
from typing import Dict, Any, List

# 静音 scrapling 的默认 INFO 日志输出，保证 stdout 纯净的 JSON 通信
try:
    from scrapling.core.utils import _utils
    _utils._current_logger.get().setLevel(logging.WARNING)
except Exception:
    pass

def extract_tables(sel) -> List[Dict[str, Any]]:
    """提取页面中的 HTML 表格并转换为结构化数据"""
    tables = []
    try:
        table_nodes = sel.css('table')
        for tbl in table_nodes[:10]:
            rows = []
            headers = [str(th.get_all_text(strip=True) if hasattr(th, 'get_all_text') else th.text or '').strip() for th in tbl.css('th')]
            for tr in tbl.css('tr'):
                cells = [str(td.get_all_text(strip=True) if hasattr(td, 'get_all_text') else td.text or '').strip() for td in tr.css('td')]
                if cells:
                    rows.append(cells)
            if rows or headers:
                tables.append({'headers': headers, 'rows': rows[:50]})
    except Exception:
        pass
    return tables

def tables_to_markdown(tables: List[Dict[str, Any]]) -> str:
    """将提取的表格转为 Markdown 格式"""
    if not tables:
        return ''
    md_blocks = []
    for idx, tbl in enumerate(tables, 1):
        lines = [f'#### 表格 {idx}']
        headers = tbl.get('headers', [])
        rows = tbl.get('rows', [])
        if not headers and rows:
            headers = [f'列 {i+1}' for i in range(len(rows[0]))]
        if headers:
            lines.append('| ' + ' | '.join(headers) + ' |')
            lines.append('| ' + ' | '.join(['---'] * len(headers)) + ' |')
        for r in rows:
            # 补齐或截断单元格以对齐表头
            padded = r + [''] * (len(headers) - len(r)) if headers else r
            lines.append('| ' + ' | '.join([str(c).replace('|', '\\|') for c in padded[:len(headers) or len(r)]]) + ' |')
        md_blocks.append('\n'.join(lines))
    return '\n\n'.join(md_blocks)

def process_selector(sel, css=None, xpath=None, mode='markdown', max_chars=40000) -> Dict[str, Any]:
    """根据 CSS 选择器或 XPath 提取数据"""
    title = ''
    try:
        raw_title = sel.css('title::text').first or ''
        title = str(raw_title).strip()
    except Exception:
        pass

    items = []
    text_content = ''
    tables = []

    if css:
        matched = sel.css(css)
        for m in matched[:100]:
            t = str(m.get_all_text(strip=True) if hasattr(m, 'get_all_text') else (m.text or '')).strip()
            if t:
                items.append(t)
        text_content = '\n'.join(items)
    elif xpath:
        matched = sel.xpath(xpath)
        for m in matched[:100]:
            t = str(m.get_all_text(strip=True) if hasattr(m, 'get_all_text') else (m.text or '')).strip()
            if t:
                items.append(t)
        text_content = '\n'.join(items)
    else:
        # 未指定选择器时，提取表格与主体文本
        tables = extract_tables(sel)
        table_md = tables_to_markdown(tables)
        
        body_text = ''
        try:
            body = sel.css('body')
            if body and hasattr(body, 'get_all_text'):
                body_text = str(body.get_all_text(strip=True)).strip()
            elif body:
                raw_texts = body.css('::text').getall()
                body_text = '\n'.join([str(b).strip() for b in raw_texts if str(b).strip()])
        except Exception:
            pass

        if table_md and body_text:
            text_content = f'{table_md}\n\n#### 页面正文内容\n{body_text}'
        else:
            text_content = body_text or table_md

    if len(text_content) > max_chars:
        text_content = text_content[:max_chars] + f'\n\n…（内容已截断，共保留前 {max_chars} 字符）'

    return {
        'title': title,
        'count': len(items) if (css or xpath) else len(tables),
        'items': items,
        'text': text_content,
        'tables': tables
    }

def cmd_fetch(args):
    try:
        from scrapling import Fetcher
    except ImportError:
        return {'ok': False, 'error': '未安装 scrapling 库，请先执行 pip install scrapling'}

    try:
        page = Fetcher.get(args.url)
        res = process_selector(page, css=args.css, xpath=args.xpath, mode=args.mode, max_chars=args.max_chars)
        return {
            'ok': True,
            'mode': 'fetch',
            'status': page.status,
            'url': page.url,
            **res
        }
    except Exception as e:
        return {'ok': False, 'mode': 'fetch', 'error': str(e)}

def cmd_parse(args):
    try:
        from scrapling import Selector
    except ImportError:
        return {'ok': False, 'error': '未安装 scrapling 库，请先执行 pip install scrapling'}

    try:
        # 从标准输入读取完整 HTML（支持从 Dragon 浏览器 CDP 拿到的实时 DOM）
        html = sys.stdin.read()
        if not html:
            return {'ok': False, 'error': '未传入有效的 HTML 内容'}
        sel = Selector(html)
        res = process_selector(sel, css=args.css, xpath=args.xpath, mode=args.mode, max_chars=args.max_chars)
        return {
            'ok': True,
            'mode': 'parse',
            'status': 200,
            **res
        }
    except Exception as e:
        return {'ok': False, 'mode': 'parse', 'error': str(e)}

def main():
    parser = argparse.ArgumentParser(description='Dragon Claw Scrapling Helper')
    subparsers = parser.add_subparsers(dest='command', required=True)

    fetch_parser = subparsers.add_parser('fetch')
    fetch_parser.add_argument('--url', required=True, help='目标网址')
    fetch_parser.add_argument('--css', help='CSS 选择器')
    fetch_parser.add_argument('--xpath', help='XPath 表达式')
    fetch_parser.add_argument('--mode', default='markdown', choices=['markdown', 'text', 'json'])
    fetch_parser.add_argument('--max-chars', type=int, default=40000)

    parse_parser = subparsers.add_parser('parse')
    parse_parser.add_argument('--css', help='CSS 选择器')
    parse_parser.add_argument('--xpath', help='XPath 表达式')
    parse_parser.add_argument('--mode', default='markdown', choices=['markdown', 'text', 'json'])
    parse_parser.add_argument('--max-chars', type=int, default=40000)

    args = parser.parse_args()
    if args.command == 'fetch':
        res = cmd_fetch(args)
    elif args.command == 'parse':
        res = cmd_parse(args)
    else:
        res = {'ok': False, 'error': f'未知命令 {args.command}'}

    print(json.dumps(res, ensure_ascii=False))

if __name__ == '__main__':
    main()
