import re
from pathlib import Path

TARGET = Path(__file__).resolve().parent / 'css' / 'pages' / 'praudit.css'

with open(TARGET, 'r') as f:
    content = f.read()

huawei_print_css = """
        /* ======= HUAWEI STYLE PRINT & PDF RENDERING ======= */
        .pdf-render-root, #printReport {
            font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
            color: #191919;
        }

        .pdf-render-root {
            position: fixed;
            left: -10000px;
            top: 0;
            width: 794px;
            background: #fff;
            padding: 30px;
            z-index: -1;
        }

        .pdf-render-root .print-title, #printReport .print-title {
            font-size: 24px;
            font-weight: 600;
            text-align: center;
            color: #c8102e; /* Huawei Red Accent */
            margin-bottom: 8px;
            padding-bottom: 10px;
            border-bottom: 2px solid #c8102e;
        }

        .pdf-render-root .print-title-en, #printReport .print-title-en,
        .pdf-render-root .print-meta, #printReport .print-meta {
            display: block;
            color: #555;
            font-size: 12px;
            text-align: center;
            font-weight: 400;
        }

        .pdf-render-root .summary-kpi-container, #printReport .summary-kpi-container {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 24px;
        }

        .pdf-render-root .summary-kpi-card, #printReport .summary-kpi-card {
            flex: 1;
            border: 1px solid #e5e5e5;
            padding: 12px;
            text-align: center;
            background: #fafafa;
        }

        .pdf-render-root .summary-kpi-value, #printReport .summary-kpi-value {
            font-size: 24px;
            font-weight: 700;
            color: #191919;
            margin-top: 6px;
        }

        .pdf-render-root .summary-table, #printReport .summary-table,
        .pdf-render-root .print-check-table, #printReport .print-check-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            table-layout: fixed;
        }

        .pdf-render-root .summary-table th, #printReport .summary-table th,
        .pdf-render-root .summary-table td, #printReport .summary-table td,
        .pdf-render-root .print-check-table th, #printReport .print-check-table th,
        .pdf-render-root .print-check-table td, #printReport .print-check-table td {
            border: 1px solid #d9d9d9;
            padding: 10px 12px;
            text-align: left;
            vertical-align: top;
            white-space: normal !important;
            word-wrap: break-word;
            word-break: break-word;
        }

        .pdf-render-root .summary-table th, #printReport .summary-table th,
        .pdf-render-root .print-check-table th, #printReport .print-check-table th {
            background: #f4f5f6;
            color: #191919;
            font-weight: 600;
        }

        .pdf-render-root .print-card, #printReport .print-card {
            border: 1px solid #d9d9d9;
            margin-bottom: 24px;
            page-break-inside: avoid;
        }

        .pdf-render-root .print-card-header, #printReport .print-card-header {
            background: #f4f5f6;
            padding: 10px 12px;
            border-bottom: 1px solid #d9d9d9;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .pdf-render-root .print-card-header h3, #printReport .print-card-header h3 {
            margin: 0;
            font-size: 15px;
            color: #191919;
        }

        .pdf-render-root .print-info-grid, #printReport .print-info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            border-top: 1px solid #d9d9d9;
            border-left: 1px solid #d9d9d9;
        }

        .pdf-render-root .print-info-item, #printReport .print-info-item {
            display: grid;
            grid-template-columns: minmax(118px, 34%) 1fr;
            min-height: 58px;
            border-right: 1px solid #d9d9d9;
            border-bottom: 1px solid #d9d9d9;
            break-inside: avoid;
        }
        
        .pdf-render-root .print-info-item.placeholder, #printReport .print-info-item.placeholder {
            background: #fff;
        }

        .pdf-render-root .print-info-label, #printReport .print-info-label {
            display: flex;
            flex-direction: column;
            justify-content: center;
            background: #f4f5f6;
            border-right: 1px solid #d9d9d9;
            padding: 7px 8px;
            font-size: 11px;
            font-weight: 600;
            color: #555;
            word-break: break-word;
        }

        .pdf-render-root .print-info-value, #printReport .print-info-value {
            display: flex;
            align-items: center;
            padding: 7px 8px;
            font-size: 12px;
            word-break: break-word;
        }

        .pdf-render-root .print-group-header, #printReport .print-group-header {
            margin: 24px 0 12px;
            padding: 9px 12px;
            border: 1px solid #d9d9d9;
            border-left: 4px solid #c8102e; /* Huawei Red */
            background: #fafafa;
            color: #191919;
            font-size: 14px;
            font-weight: 600;
            page-break-after: avoid;
        }

        .pdf-render-root .print-toc-page, #printReport .print-toc-page {
            min-height: 1030px;
            padding: 8px 4px;
            background: #fff;
            page-break-after: always;
        }

        .pdf-render-root .print-toc-title, #printReport .print-toc-title {
            text-align: center;
            font-size: 20px;
            font-weight: 600;
            margin: 0 0 22px;
            color: #191919;
        }

        .pdf-render-root .print-toc-group, #printReport .print-toc-group {
            margin: 14px 0 8px;
            padding: 7px 10px;
            border-bottom: 2px solid #c8102e;
            color: #191919;
            font-size: 13px;
            font-weight: 600;
        }

        .pdf-render-root .print-toc-item, #printReport .print-toc-item {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 12px;
            padding: 8px 10px;
            border-bottom: 1px solid #e5e5e5;
            color: #333;
            text-decoration: none;
            font-size: 12px;
            line-height: 1.35;
        }

        .pdf-render-root .print-toc-hint, #printReport .print-toc-hint {
            text-align: center;
            color: #888;
            font-size: 11px;
            margin-top: 16px;
        }

        .pdf-render-root .print-summary-zh, #printReport .print-summary-zh { color: #191919; }
        .pdf-render-root .print-summary-en, #printReport .print-summary-en { color: #555; }
        .pdf-render-root .p-pass, #printReport .p-pass { color: #00B365; font-weight: 600; }
        .pdf-render-root .p-fail, #printReport .p-fail { color: #c8102e; font-weight: 600; }
        .pdf-render-root .p-wait, #printReport .p-wait { color: #FF9900; font-weight: 600; }
        .pdf-render-root .p-reason, #printReport .p-reason {
            color: #c8102e;
            border-left: 2px solid #c8102e;
            padding-left: 6px;
            font-size: 11px;
            margin-top: 6px;
            white-space: normal !important;
            word-break: break-word;
        }

        .pdf-render-root .print-img, #printReport .print-img {
            max-width: 100%;
            max-height: 120px;
            object-fit: contain;
            border: 1px solid #d9d9d9;
            padding: 2px;
            display: block;
        }
"""

# Regex to remove old .pdf-render-root rules
# It starts at `.pdf-render-root {` and ends before `.container {`
content = re.sub(r'\.pdf-render-root \{[\s\S]*?(?=\.container \{)', huawei_print_css + '\n', content)

# Regex to replace everything inside @media print { ... }
media_print_content = """
        @media print {
            @page {
                margin: 15mm;
                size: A4 portrait;
            }

            body {
                background: #fff !important;
                margin: 0;
                padding: 0;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .no-print {
                display: none !important;
            }

            /* 强制隐藏由于外部 JS 引入的导航栏和客服图标 */
            nav, .navbar, #topNavbar, .ai-fab, .ai-panel, #chatbot-container, .chatbot-icon, .robot-icon, iframe, .toast-msg, #toastMsg, .toast, #globalToast {
                display: none !important;
            }

            #printReport {
                display: block !important;
                width: 100%;
            }
            
            .print-summary-page {
                page-break-after: always;
                margin-bottom: 20px;
            }
        }
"""

# The @media print block is at the very end of the file.
content = re.sub(r'@media print\s*\{[\s\S]*\}\s*$', media_print_content.strip() + '\n', content)

with open(TARGET, 'w') as f:
    f.write(content)
