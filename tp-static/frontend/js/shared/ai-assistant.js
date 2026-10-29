/**
 * 全局悬浮 AI 客服助手组件
 * 封装在 IIFE 中，避免污染全局变量
 */
(function () {
    // 注入 CSS 样式
    const style = document.createElement('style');
    style.innerHTML = `
        /* AI Assistant 样式定义 */
        /* 右侧停靠标签：与首页「工作区」标签同一套形状与材质（Dragon Claw 青蓝紫） */
        .ai-fab {
            position: fixed;
            bottom: 140px;
            right: 0;
            height: 48px;
            min-width: 54px;
            box-sizing: border-box;
            padding: 0 11px 0 10px;
            border-radius: 24px 0 0 24px;
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(16, 32, 54, 0.94));
            border: 1px solid rgba(100, 255, 218, 0.3);
            border-right: none;
            color: #e6fffa;
            display: flex;
            align-items: center;
            box-shadow:
                -8px 10px 26px rgba(2, 6, 23, 0.4),
                0 0 18px rgba(45, 212, 191, 0.12),
                inset 0 1px 0 rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            cursor: pointer;
            z-index: 100000;
            transition: border-color 0.22s, box-shadow 0.22s, background 0.22s, opacity 0.2s;
            user-select: none;
            isolation: isolate;
            outline: none;
            -webkit-tap-highlight-color: transparent;
            font-family: inherit;
        }
        .ai-fab::before {
            content: "";
            position: absolute;
            inset: -2px;
            z-index: -1;
            border-radius: inherit;
            background: radial-gradient(circle at 30% 50%, rgba(45, 212, 191, 0.22), rgba(96, 165, 250, 0.08) 55%, transparent 78%);
            opacity: 0;
            transition: opacity 0.22s;
            pointer-events: none;
        }
        .ai-fab-orb {
            position: relative;
            flex: none;
            width: 32px;
            height: 32px;
        }
        .ai-fab-orb::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: conic-gradient(from 210deg, #64ffda, #60a5fa, #a78bfa, #f472b6, #64ffda);
            -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px));
            mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px));
            animation: ai-fab-spin 9s linear infinite;
        }
        .ai-fab-avatar {
            position: absolute;
            inset: 3px;
            width: calc(100% - 6px);
            height: calc(100% - 6px);
            border-radius: 50%;
            object-fit: cover;
            pointer-events: none;
        }
        .ai-fab-dot {
            position: absolute;
            right: -1px;
            bottom: -1px;
            width: 9px;
            height: 9px;
            border: 2px solid #0f172a;
            border-radius: 50%;
            background: #34d399;
            box-shadow: 0 0 6px rgba(52, 211, 153, 0.8);
        }
        .ai-fab-label {
            max-width: 0;
            overflow: hidden;
            white-space: nowrap;
            opacity: 0;
            font-size: 12.5px;
            font-weight: 700;
            letter-spacing: 0.01em;
            transition: max-width 0.26s cubic-bezier(.2,.8,.2,1), opacity 0.2s, margin 0.26s;
        }
        @media (hover: hover) {
            .ai-fab:hover .ai-fab-label,
            .ai-fab:focus-visible .ai-fab-label {
                max-width: 120px;
                margin-left: 9px;
                opacity: 1;
            }
        }
        .ai-fab:hover,
        .ai-fab[aria-expanded="true"] {
            border-color: rgba(100, 255, 218, 0.55);
            box-shadow:
                -10px 14px 32px rgba(2, 6, 23, 0.48),
                0 0 24px rgba(45, 212, 191, 0.22),
                inset 0 1px 0 rgba(255, 255, 255, 0.12);
        }
        .ai-fab:hover::before,
        .ai-fab:focus-visible::before,
        .ai-fab[aria-expanded="true"]::before { opacity: 1; }
        .ai-fab:focus-visible {
            box-shadow:
                -10px 14px 32px rgba(2, 6, 23, 0.48),
                0 0 0 2px rgba(100, 255, 218, 0.75);
        }
        .ai-fab.is-pulse .ai-fab-orb { animation: ai-fab-pulse 0.6s cubic-bezier(.2,.8,.2,1); }
        @keyframes ai-fab-spin { to { transform: rotate(360deg); } }
        @keyframes ai-fab-pulse { 0% { transform: scale(1); } 40% { transform: scale(0.86); } 100% { transform: scale(1); } }
        .ai-proactive-alert {
            position: fixed;
            width: min(360px, calc(100vw - 32px));
            box-sizing: border-box;
            padding: 14px 42px 14px 16px;
            border: 1px solid rgba(129,140,248,0.3);
            border-radius: 16px;
            color: #273449;
            background: rgba(255,255,255,0.97);
            box-shadow: 0 18px 48px rgba(15,23,42,0.2), inset 0 1px 0 rgba(255,255,255,0.9);
            z-index: 100020;
            font-size: 13px;
            line-height: 1.55;
            cursor: pointer;
            opacity: 0;
            pointer-events: none;
            transform: translateY(12px) scale(0.965);
            transform-origin: bottom right;
            will-change: transform, opacity, filter;
        }
        .ai-proactive-alert.show {
            opacity:1; pointer-events:auto; transform:translateY(0) scale(1);
            animation:ai-alert-arrive .48s cubic-bezier(.16,1,.3,1) both;
        }
        .ai-proactive-alert[data-placement="below"] { transform-origin:top right; }
        .ai-proactive-alert.is-leaving { pointer-events:none; animation:ai-alert-depart .28s cubic-bezier(.4,0,1,1) both; }
        .ai-proactive-alert.is-closing { animation:ai-alert-close-away .34s cubic-bezier(.4,0,.7,.2) both; }
        @keyframes ai-alert-arrive {
            0% { opacity:0; transform:translateY(14px) scale(.94); filter:blur(3px); }
            58% { opacity:1; transform:translateY(-2px) scale(1.012); filter:blur(0); }
            100% { opacity:1; transform:translateY(0) scale(1); filter:blur(0); }
        }
        @keyframes ai-alert-depart {
            from { opacity:1; transform:translateY(0) scale(1); filter:blur(0); }
            to { opacity:0; transform:translateY(8px) scale(.975); filter:blur(1.5px); }
        }
        @keyframes ai-alert-close-away {
            0% { opacity:1; transform:translate(0,0) scale(1); filter:blur(0); }
            100% { opacity:0; transform:translate(12px,10px) scale(.88); filter:blur(2px); }
        }
        .ai-proactive-alert::after {
            content:""; position:absolute; right:var(--ai-alert-arrow-right, 24px); bottom:-8px; width:14px; height:14px;
            background:#fff; border-right:1px solid rgba(129,140,248,.3); border-bottom:1px solid rgba(129,140,248,.3);
            transform:rotate(45deg);
        }
        .ai-proactive-alert[data-placement="below"]::after {
            top:-8px; bottom:auto; border:0; border-left:1px solid rgba(129,140,248,.3); border-top:1px solid rgba(129,140,248,.3);
        }
        .ai-proactive-alert-kicker { display:flex; align-items:center; gap:7px; margin-bottom:5px; color:#5b63c8; font-size:11px; font-weight:800; letter-spacing:.04em; }
        .ai-proactive-alert-ai-badge {
            display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border:1px solid rgba(124,58,237,.25); border-radius:999px;
            color:#fff; background:linear-gradient(135deg,#6366f1,#8b5cf6 58%,#c026d3); box-shadow:0 3px 10px rgba(109,40,217,.22);
            font-size:9px; line-height:1.3; letter-spacing:.06em; text-transform:uppercase;
        }
        .ai-proactive-alert-text { display:block; overflow-wrap:anywhere; }
        .ai-proactive-alert-ai-panel {
            display:none; position:relative; margin-top:10px; padding:9px 10px; overflow:hidden; border:1px solid transparent; border-radius:11px;
            background:linear-gradient(#f8faff,#f8faff) padding-box,linear-gradient(115deg,#60a5fa,#8b5cf6,#ec4899,#22d3ee,#60a5fa) border-box;
            background-size:100% 100%,240% 100%; box-shadow:0 5px 18px rgba(99,102,241,.10);
            animation:ai-polish-flow 4.5s linear infinite;
        }
        .ai-proactive-alert.ai-polished .ai-proactive-alert-ai-panel,
        .ai-proactive-alert.ai-deep-analyzed .ai-proactive-alert-ai-panel { display:block; }
        .ai-proactive-alert-ai-head { display:flex; align-items:center; gap:7px; margin-bottom:5px; }
        .ai-proactive-alert-ai-caption { color:#7c3aed; font-size:10px; font-weight:800; letter-spacing:.04em; }
        .ai-proactive-alert-ai-text { color:#556176; font-size:11px; line-height:1.55; word-break:break-word; }
        .ai-proactive-alert-ai-char { display:inline-block; opacity:0; transform:translateY(4px); animation:ai-polish-char .32s cubic-bezier(.2,.8,.2,1) forwards; animation-delay:calc(var(--ai-char-index) * 16ms); }
        @keyframes ai-polish-flow { to { background-position:0 0,240% 0; } }
        @keyframes ai-polish-char { to { opacity:1; transform:translateY(0); } }
        .ai-proactive-alert-footer { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; }
        .ai-proactive-alert-hint { flex:1; min-width:0; color:#7b8799; font-size:11px; }
        .ai-proactive-alert-actions { display:flex; align-items:center; gap:5px; flex-shrink:0; }
        .ai-proactive-alert-action {
            min-height:25px; padding:3px 8px; border:1px solid rgba(129,140,248,.22); border-radius:7px;
            color:#667085; background:rgba(248,250,252,.88); font-size:10px; line-height:1.2; cursor:pointer;
            transition:color .16s ease,background .16s ease,border-color .16s ease,transform .16s ease;
        }
        .ai-proactive-alert-action:hover { color:#4f46e5; background:#eef2ff; border-color:rgba(99,102,241,.4); transform:translateY(-1px); }
        .ai-proactive-alert-action:active { transform:translateY(0) scale(.97); }
        .ai-proactive-alert-close {
            position:absolute; right:9px; top:8px; width:26px; height:26px; border:0; border-radius:8px;
            color:#7b8799; background:transparent; cursor:pointer; font-size:18px; line-height:1;
        }
        .ai-proactive-alert-close:hover { color:#334155; background:#eef1f8; }
        .ai-proactive-alert[data-theme="graph"],
        body.ai-kg-open .ai-proactive-alert { color:#dbe4f3; background:rgba(18,28,47,.98); border-color:rgba(129,140,248,.4); }
        .ai-proactive-alert[data-theme="graph"]::after,
        body.ai-kg-open .ai-proactive-alert::after { background:#121c2f; border-color:rgba(129,140,248,.4); }
        .ai-proactive-alert[data-theme="graph"] .ai-proactive-alert-ai-panel,
        body.ai-kg-open .ai-proactive-alert .ai-proactive-alert-ai-panel { background:linear-gradient(#111b2e,#111b2e) padding-box,linear-gradient(115deg,#38bdf8,#818cf8,#e879f9,#22d3ee,#38bdf8) border-box; background-size:100% 100%,240% 100%; }
        .ai-proactive-alert[data-theme="graph"] .ai-proactive-alert-ai-text,
        body.ai-kg-open .ai-proactive-alert .ai-proactive-alert-ai-text { color:#b8c5dc; }
        .ai-proactive-alert[data-theme="graph"] .ai-proactive-alert-action,
        body.ai-kg-open .ai-proactive-alert .ai-proactive-alert-action { color:#aab7cc; background:rgba(30,41,59,.8); border-color:rgba(129,140,248,.28); }
        .ai-proactive-alert[data-theme="graph"] .ai-proactive-alert-action:hover,
        body.ai-kg-open .ai-proactive-alert .ai-proactive-alert-action:hover { color:#c7d2fe; background:#26324a; border-color:rgba(129,140,248,.5); }
        .ai-proactive-alert[data-compact="true"] { padding:11px 12px; border-radius:14px; font-size:12px; line-height:1.5; overscroll-behavior:contain; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-kicker { padding-right:28px; margin-bottom:4px; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-text { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-ai-panel { margin-top:8px; padding:7px 8px; border-radius:9px; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-ai-text { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-footer { flex-wrap:wrap; gap:6px; margin-top:7px; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-hint { flex-basis:100%; font-size:10px; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-actions { margin-left:auto; max-width:100%; flex-wrap:wrap; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-action { min-height:32px; font-size:11px; }
        .ai-proactive-alert[data-compact="true"] .ai-proactive-alert-close { right:5px; top:4px; width:30px; height:30px; }
        @media (prefers-reduced-motion: reduce) {
            .ai-proactive-alert, .ai-proactive-alert.show, .ai-proactive-alert.is-leaving, .ai-proactive-alert.is-closing, .ai-proactive-alert-ai-panel, .ai-proactive-alert-ai-char { animation:none; transition:opacity .01ms linear; transform:none; filter:none; }
            .ai-proactive-alert-ai-char { opacity:1; }
        }
        .ai-panel {
            position: fixed;
            bottom: 80px;
            right: 62px;
            width: 420px;
            height: min(640px, calc(100vh - 120px));
            background: #f7f9fd !important;
            color: #334155 !important;
            border-radius: 20px;
            border: 1px solid rgba(148,163,184,0.34);
            box-shadow:
                0 28px 80px rgba(15,23,42,0.30),
                0 8px 24px rgba(15,23,42,0.14),
                inset 0 1px 0 rgba(255,255,255,0.9);
            z-index: 100000;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transform: translateY(20px) scale(0.95);
            opacity: 0;
            pointer-events: none;
            transition: width 0.28s cubic-bezier(.2,.8,.2,1), height 0.28s cubic-bezier(.2,.8,.2,1), inset 0.28s cubic-bezier(.2,.8,.2,1), border-radius 0.28s, transform 0.28s, opacity 0.2s;
            transform-origin: bottom right;
        }
        .ai-panel.open {
            transform: translateY(0) scale(1);
            opacity: 1;
            pointer-events: auto;
        }
        body.ai-kg-open .ai-panel.open { z-index: 100300; }
        .ai-panel.expanded {
            width: min(760px, calc(100vw - 80px));
            height: min(820px, calc(100vh - 80px));
            max-width: none;
            max-height: none;
            bottom: 40px;
        }
        .ai-panel.fullscreen {
            inset: 0;
            width: 100vw;
            height: 100vh;
            max-width: none;
            max-height: none;
            border: 0;
            border-radius: 0;
            transform-origin: center;
        }
        body.ai-chat-fullscreen {
            overflow: hidden !important;
        }
        .ai-header {
            min-height: 68px;
            box-sizing: border-box;
            background:
                radial-gradient(circle at 18% 0%, rgba(129,140,248,0.36), transparent 34%),
                linear-gradient(135deg, #25356f 0%, #4d3f91 58%, #684598 100%);
            color: #fff;
            padding: 12px 16px 12px 18px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex: 0 0 auto;
        }
        .ai-brand {
            display: flex;
            align-items: center;
            gap: 11px;
            min-width: 0;
        }
        .ai-brand-mark {
            width: 34px;
            height: 34px;
            border-radius: 11px;
            display: grid;
            place-items: center;
            overflow: hidden;
            background: #fff;
            border: 1px solid rgba(255,255,255,0.72);
            box-shadow: 0 4px 12px rgba(20,27,67,0.2);
        }
        .ai-brand-mark img { width:100%; height:100%; display:block; object-fit:cover; }
        .ai-brand-copy { min-width: 0; }
        .ai-brand-title {
            font-size: 15px;
            line-height: 1.2;
            font-weight: 700;
            letter-spacing: 0.01em;
            white-space: nowrap;
        }
        .ai-brand-subtitle {
            margin-top: 3px;
            font-size: 10px;
            line-height: 1.2;
            color: rgba(237,242,255,0.72);
            font-weight: 500;
            white-space: nowrap;
        }
        .ai-brand-title-compact,
        .ai-brand-subtitle-compact { display:none; }
        .ai-panel:not(.expanded):not(.fullscreen) .ai-header {
            min-height:60px;
            padding:9px 10px 9px 14px;
        }
        .ai-panel:not(.expanded):not(.fullscreen) .ai-brand { gap:8px; }
        .ai-panel:not(.expanded):not(.fullscreen) .ai-brand-mark { width:30px; height:30px; border-radius:9px; }
        .ai-panel:not(.expanded):not(.fullscreen) .ai-brand-title { font-size:13px; line-height:1.05; }
        .ai-panel:not(.expanded):not(.fullscreen) .ai-brand-subtitle { margin-top:3px; font-size:8px; line-height:1.05; }
        .ai-panel:not(.expanded):not(.fullscreen) .ai-brand-title-full,
        .ai-panel:not(.expanded):not(.fullscreen) .ai-brand-subtitle-full { display:none; }
        .ai-panel:not(.expanded):not(.fullscreen) .ai-brand-title-compact,
        .ai-panel:not(.expanded):not(.fullscreen) .ai-brand-subtitle-compact { display:inline; }
        .ai-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .ai-action-btn {
            background: rgba(255,255,255,0.11);
            border: 1px solid rgba(255,255,255,0.12);
            color: #fff !important;
            width: 32px;
            height: 32px;
            padding: 0;
            border-radius: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.18s, transform 0.18s, border-color 0.18s;
        }
        .ai-action-btn:hover {
            background: rgba(255,255,255,0.22);
            border-color: rgba(255,255,255,0.3);
            transform: translateY(-1px);
        }
        .ai-action-btn svg {
            width: 16px;
            height: 16px;
            pointer-events: none;
        }
        .ai-action-btn.ai-close {
            background: rgba(255,255,255,0.17);
        }
        .ai-chat-body {
            flex: 1;
            min-height: 0;
            padding: 22px;
            overflow-y: auto;
            background:
                radial-gradient(circle at 15% 0%, rgba(99,102,241,0.055), transparent 34%),
                linear-gradient(180deg, #f7f9fd 0%, #f2f5fa 100%);
            display: flex;
            flex-direction: column;
            gap: 16px;
            scroll-behavior: smooth;
        }
        .ai-msg {
            max-width: 88%;
            padding: 13px 16px;
            border-radius: 16px;
            font-size: 14px;
            line-height: 1.6;
            word-wrap: break-word;
        }
        .ai-msg.user {
            background: linear-gradient(135deg, #556ee6, #7259c8);
            color: #fff;
            align-self: flex-end;
            border-bottom-right-radius: 6px;
            box-shadow: 0 8px 20px rgba(85,110,230,0.2);
        }
        .ai-msg.ai {
            background: #fff;
            color: #243247;
            align-self: flex-start;
            border-bottom-left-radius: 6px;
            box-shadow: 0 8px 24px rgba(30,41,59,0.07);
            border: 1px solid #e6eaf2;
        }
        .ai-panel.fullscreen .ai-chat-body {
            padding-left: max(28px, calc((100vw - 1080px) / 2));
            padding-right: max(28px, calc((100vw - 1080px) / 2));
        }
        .ai-panel.fullscreen .ai-msg { max-width: min(82%, 880px); }
        .ai-msg p { margin: 0 0 8px 0; }
        .ai-msg p:last-child { margin: 0; }
        .ai-msg ul, .ai-msg ol {
            margin: 0 0 8px 0;
            padding-left: 20px;
        }
        .ai-msg li { margin-bottom: 4px; }
        .ai-msg pre {
            background: rgba(226,232,240,0.72);
            padding: 8px;
            border-radius: 6px;
            overflow-x: auto;
            font-size: 13px;
        }
        .ai-msg code {
            background: rgba(226,232,240,0.76);
            padding: 2px 4px;
            border-radius: 4px;
            color: #ef4444;
            font-family: monospace;
        }
        .ai-msg h1, .ai-msg h2, .ai-msg h3, .ai-msg h4 {
            margin: 16px 0 8px;
            color: #1f2d44;
            line-height: 1.35;
        }
        .ai-msg h1:first-child, .ai-msg h2:first-child, .ai-msg h3:first-child, .ai-msg h4:first-child { margin-top: 0; }
        .ai-msg h1 { font-size: 18px; }
        .ai-msg h2 { font-size: 16px; }
        .ai-msg h3 { font-size: 15px; }
        .ai-msg h4 { font-size: 14px; }
        .ai-msg blockquote {
            margin: 10px 0;
            padding: 8px 11px;
            border-left: 3px solid #8492ec;
            border-radius: 0 8px 8px 0;
            background: #f5f7ff;
            color: #58657b;
        }
        .ai-table-wrap {
            width: 100%;
            margin: 12px 0 14px;
            overflow-x: auto;
            border: 1px solid #e1e6ef;
            border-radius: 12px;
            background: #fff;
            box-shadow: 0 5px 18px rgba(30,41,59,0.055);
            scrollbar-width: thin;
        }
        .ai-markdown-table {
            width: 100%;
            min-width: max(520px, calc(var(--ai-table-columns) * 160px));
            table-layout: fixed;
            border-collapse: separate;
            border-spacing: 0;
            font-size: 12px;
            line-height: 1.45;
        }
        .ai-markdown-table th {
            position: sticky;
            top: 0;
            z-index: 1;
            padding: 10px 12px;
            border-bottom: 1px solid #dce2ed;
            background: linear-gradient(180deg, #f5f7ff, #eef1fa);
            color: #36415a;
            font-weight: 700;
            overflow-wrap: anywhere;
        }
        .ai-markdown-table td {
            padding: 10px 12px;
            border-bottom: 1px solid #edf0f5;
            color: #46536a;
            vertical-align: top;
            overflow-wrap: anywhere;
        }
        .ai-markdown-table td code, .ai-markdown-table th code { white-space: normal; overflow-wrap: anywhere; }
        .ai-markdown-table tbody tr:last-child td { border-bottom: 0; }
        .ai-markdown-table tbody tr:nth-child(even) td { background: #fafbfe; }
        .ai-markdown-table tbody tr:hover td { background: #f2f5ff; }
        .ai-markdown-table .align-center { text-align: center; }
        .ai-markdown-table .align-right { text-align: right; }
        .ai-markdown-table td.numeric { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .ai-panel:not(.expanded):not(.fullscreen) .ai-msg.ai:has(.ai-markdown-table) { max-width: 96%; }
        .ai-token-usage {
            font-size: 11px;
            color: #94a3b8;
            margin-top: 8px;
            text-align: right;
            border-top: 1px dashed #e2e8f0;
            padding-top: 6px;
        }
        .ai-grounding {
            margin-top: 9px;
            padding-top: 8px;
            border-top: 1px dashed rgba(148,163,184,0.48);
            color: #64748b;
            font-size: 11px;
            line-height: 1.45;
        }
        .ai-grounding-title {
            color: #475569;
            font-weight: 600;
            margin-bottom: 3px;
        }
        .ai-grounding-item {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        button.ai-grounding-item {
            display: block;
            width: 100%;
            padding: 2px 4px;
            border: 0;
            border-radius: 5px;
            background: transparent;
            color: inherit;
            font: inherit;
            line-height: inherit;
            text-align: left;
            cursor: pointer;
        }
        button.ai-grounding-item:hover {
            color: #4f5db2;
            background: #f1f3ff;
        }
        .ai-grounding-graph {
            width: 100%;
            margin: 0 0 4px;
            padding: 4px 7px;
            border: 1px solid #dfe5f3;
            border-radius: 8px;
            background: #f7f8fd;
            color: #5663b4;
            font: inherit;
            text-align: left;
            cursor: pointer;
            transition: border-color 0.16s, background 0.16s, color 0.16s;
        }
        .ai-grounding-graph:hover {
            border-color: #bfc8ee;
            background: #eef1ff;
            color: #4653a4;
        }
        .ai-grounding-graph.metric-reference {
            border-color: #d8ccf6;
            background: linear-gradient(135deg, #f7f4ff, #f1f3ff);
            color: #674ca8;
        }
        .ai-grounding-graph.metric-reference:hover {
            border-color: #b9a5ed;
            background: linear-gradient(135deg, #f0eaff, #e9edff);
            color: #573b99;
        }
        .ai-input-area {
            display: flex;
            padding: 14px 16px 16px;
            background: #fff;
            border-top: 1px solid #e7ebf2;
            gap: 10px;
            align-items: center;
        }
        .ai-input {
            flex: 1;
            height: 46px;
            box-sizing: border-box;
            padding: 12px 17px;
            border: 1px solid #d9dfeb;
            border-radius: 14px;
            outline: none;
            font-size: 14px;
            transition: all 0.2s;
            background: #f7f9fc;
            color: #1e293b !important;
        }
        .ai-input::placeholder {
            color: #94a3b8 !important;
        }
        .ai-input:focus {
            border-color: #7585e8;
            background: #fff;
            box-shadow: 0 0 0 4px rgba(102,126,234,0.11);
        }
        .ai-send-btn {
            background: #667eea;
            color: #fff;
            border: none;
            width: 46px;
            height: 46px;
            flex: 0 0 46px;
            border-radius: 14px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            box-shadow: 0 7px 18px rgba(102,126,234,0.28);
        }
        .ai-send-btn:hover {
            background: #5a6fd6;
            transform: scale(1.05);
        }
        .ai-send-btn.is-generating {
            background: #ef6678;
            box-shadow: 0 7px 18px rgba(239,102,120,0.28);
        }
        .ai-send-btn.is-generating .ai-stop-square {
            width: 12px;
            height: 12px;
            border-radius: 3px;
            background: currentColor;
        }
        .ai-msg.ai.streaming::after {
            content: "";
            display: inline-block;
            width: 7px;
            height: 15px;
            margin-left: 3px;
            vertical-align: -2px;
            border-radius: 2px;
            background: #667eea;
            animation: ai-stream-caret 0.9s steps(1, end) infinite;
        }
        @keyframes ai-stream-caret { 50% { opacity: 0.18; } }
        .ai-typing {
            font-size: 12px;
            color: #94a3b8;
            font-style: italic;
            align-self: flex-start;
            margin-top: -8px;
            display: none;
            padding: 0 16px;
        }
        .ai-context-notice {
            align-self: center;
            max-width: calc(100% - 44px);
            margin: 2px auto 8px;
            padding: 7px 12px;
            border: 1px solid #d9def8;
            border-radius: 999px;
            background: linear-gradient(135deg, #f5f7ff, #f0efff);
            color: #626b91;
            font-size: 11px;
            line-height: 1.4;
            text-align: center;
            box-shadow: 0 3px 10px rgba(78,70,160,0.07);
        }
        .ai-context-notice.is-working { animation: ai-context-pulse 1.25s ease-in-out infinite; }
        .ai-context-notice.is-done { border-color: #cce7dc; background: #f1fbf6; color: #39745e; }
        .ai-context-notice.is-failed { border-color: #f0d6b5; background: #fff8ed; color: #94662e; }
        @keyframes ai-context-pulse { 50% { opacity: 0.62; transform: translateY(-1px); } }
        .ai-suggestions {
            display:flex;
            align-items:center;
            gap:8px;
            padding:10px 16px 12px;
            box-sizing:border-box;
            background: #fff;
            border-top: 1px solid #edf0f5;
            height:50px;
            max-height:50px;
            overflow-x: auto;
            overflow-y: hidden;
            flex: 0 0 auto;
            scrollbar-width:none;
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
            opacity: 1;
            transition: max-height 0.22s ease, height 0.22s ease, padding 0.22s ease, opacity 0.16s ease, border-color 0.16s;
        }
        .ai-suggestions::-webkit-scrollbar { display:none; }
        .ai-suggestions.is-collapsed {
            height: 0;
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
            opacity: 0;
            overflow: hidden;
            border-top-color: transparent;
            pointer-events: none;
        }
        .ai-suggestion-chip {
            flex:0 0 auto;
            width:auto;
            max-width:168px;
            min-width: 0;
            border: 1px solid #dfe4f4;
            background: #f6f7fc;
            color: #5865b8;
            border-radius: 999px;
            padding: 7px 10px;
            font-size: 12px;
            line-height: 1.2;
            height: 28px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
        }
        .ai-panel:not(.expanded) .ai-suggestion-chip {
            max-width:138px;
        }
        .ai-panel.fullscreen .ai-suggestions,
        .ai-panel.fullscreen .ai-input-area {
            padding-left: max(24px, calc((100vw - 1040px) / 2));
            padding-right: max(24px, calc((100vw - 1040px) / 2));
        }
        .ai-suggestions:empty {
            display: none;
        }
        .ai-suggestion-chip:hover {
            background: rgba(238,242,255,0.92);
            border-color: #aebcff;
        }
        .ai-history-panel {
            display: none;
            background: #fff;
            border-bottom: 1px solid #e7ebf2;
            max-height: 210px;
            overflow-y: auto;
            padding: 10px 14px;
        }
        .ai-history-panel.open {
            display: block;
        }
        .ai-history-item {
            border: 1px solid rgba(148,163,184,0.32);
            border-radius: 10px;
            padding: 9px 10px;
            margin-bottom: 8px;
            cursor: pointer;
            background: rgba(248,250,252,0.72);
        }
        .ai-history-item:hover {
            border-color: #aebcff;
            background: rgba(245,247,255,0.9);
        }
        .ai-history-title {
            font-size: 12px;
            color: #334155;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .ai-history-meta {
            font-size: 11px;
            color: #94a3b8;
            margin-top: 4px;
        }
        .ai-archive-overlay {
            position:fixed; inset:0; z-index:100500; display:none; place-items:center; padding:20px;
            box-sizing:border-box; background:rgba(15,23,42,.48); backdrop-filter:blur(10px);
        }
        .ai-archive-overlay.open { display:grid; }
        .ai-archive-window {
            width:min(1120px,calc(100vw - 40px)); height:min(780px,calc(100vh - 40px));
            display:flex; flex-direction:column; overflow:hidden; border-radius:20px;
            border:1px solid #dce2ed; background:#f7f9fd; color:#334155;
            box-shadow:0 32px 100px rgba(15,23,42,.38);
        }
        .ai-archive-header { min-height:66px; padding:0 20px; display:flex; align-items:center; gap:14px; color:#fff; background:linear-gradient(135deg,#25356f,#594394 64%,#684598); }
        .ai-archive-heading { min-width:0; flex:1; }
        .ai-archive-title { font-size:17px; font-weight:760; }
        .ai-archive-subtitle { margin-top:3px; color:rgba(237,242,255,.72); font-size:10px; }
        .ai-archive-close { width:34px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.12); color:#fff; cursor:pointer; font-size:20px; }
        .ai-archive-toolbar { display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid #e3e8f1; background:#fff; }
        .ai-archive-search { flex:1; height:40px; padding:0 14px; border:1px solid #d8dfeb; border-radius:11px; outline:none; background:#f7f9fc; color:#243247; }
        .ai-archive-search:focus { border-color:#7585e8; box-shadow:0 0 0 3px rgba(102,126,234,.11); }
        .ai-archive-count { color:#7b879b; font-size:11px; white-space:nowrap; }
        .ai-archive-content { flex:1; min-height:0; display:grid; grid-template-columns:350px minmax(0,1fr); }
        .ai-archive-list { overflow:auto; padding:12px; border-right:1px solid #e3e8f1; background:#f2f5fa; }
        .ai-archive-item { width:100%; margin-bottom:9px; padding:12px; border:1px solid #dce2ed; border-radius:12px; background:#fff; color:#334155; text-align:left; cursor:pointer; }
        .ai-archive-item:hover,.ai-archive-item.active { border-color:#9caaee; background:#f4f6ff; }
        .ai-archive-item-header { display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:4px; }
        .ai-archive-item-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:700; }
        .ai-archive-badge { display:inline-block; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600; line-height:1.4; white-space:nowrap; }
        .ai-archive-badge.active { background:#e0f2fe; color:#0284c7; }
        .ai-archive-badge.archived { background:#f1f5f9; color:#64748b; }
        .ai-archive-item-question { margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#64748b; font-size:11px; }
        .ai-archive-item-meta { margin-top:7px; color:#94a3b8; font-size:9px; }
        .ai-archive-preview { min-width:0; overflow:auto; padding:22px; background:#f8fafd; }
        .ai-archive-preview-head { display:flex; align-items:flex-start; gap:12px; margin-bottom:18px; }
        .ai-archive-preview-heading { min-width:0; flex:1; }
        .ai-archive-preview-title { color:#1f2d44; font-size:16px; font-weight:740; word-break:break-word; }
        .ai-archive-preview-path { margin-top:5px; color:#8491a7; font-size:10px; word-break:break-all; }
        .ai-archive-restore { height:34px; padding:0 12px; border:0; border-radius:10px; background:linear-gradient(135deg,#556ee6,#7259c8); color:#fff; cursor:pointer; font-size:11px; font-weight:700; }
        .ai-archive-message { max-width:88%; margin-bottom:12px; padding:11px 14px; border-radius:13px; font-size:12px; line-height:1.6; word-break:break-word; }
        .ai-archive-message.user { margin-left:auto; color:#fff; background:linear-gradient(135deg,#556ee6,#7259c8); border-bottom-right-radius:5px; }
        .ai-archive-message.ai { color:#334155; background:#fff; border:1px solid #e4e9f1; border-bottom-left-radius:5px; }
        .ai-archive-message p { margin:0 0 8px; }
        .ai-archive-message p:last-child { margin-bottom:0; }
        .ai-archive-message pre { overflow:auto; padding:10px; border-radius:8px; background:#f2f5fa; }
        .ai-archive-message code { padding:1px 4px; border-radius:4px; background:#edf1f7; }
        .ai-archive-message ul,.ai-archive-message ol { margin:6px 0; padding-left:20px; }
        .ai-archive-empty { display:grid; place-items:center; min-height:220px; color:#8491a7; font-size:12px; text-align:center; line-height:1.7; }
        .ai-archive-overlay[data-theme="graph"] { background:rgba(3,7,15,.66); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-window { border-color:rgba(137,152,201,.25); background:#0d1422; color:#cbd5e1; box-shadow:0 34px 110px rgba(0,0,0,.68); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-header { background:radial-gradient(circle at 16% 0%,rgba(91,112,211,.2),transparent 34%),linear-gradient(135deg,#111a2c,#151b30 62%,#211938); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-toolbar { background:#0f1726; border-color:rgba(132,147,194,.17); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-search { background:#111a2b; color:#e4e9f5; border-color:rgba(136,152,207,.3); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-list { background:#0a101b; border-color:rgba(132,147,194,.17); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-item { background:#151e31; color:#dfe5f2; border-color:rgba(132,147,194,.18); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-item:hover,.ai-archive-overlay[data-theme="graph"] .ai-archive-item.active { background:#1b2740; border-color:rgba(130,148,232,.5); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-badge.active { background:#0c4a6e; color:#38bdf8; }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-badge.archived { background:#1e293b; color:#94a3b8; }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-item-question { color:#94a3b8; }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-preview { background:#0d1422; }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-preview-title { color:#edf1fb; }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-message.ai { color:#cbd5e1; background:#151e31; border-color:rgba(132,147,194,.18); }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-message.ai h1,.ai-archive-overlay[data-theme="graph"] .ai-archive-message.ai h2,.ai-archive-overlay[data-theme="graph"] .ai-archive-message.ai h3 { color:#edf1fb; }
        .ai-archive-overlay[data-theme="graph"] .ai-archive-message.ai pre,.ai-archive-overlay[data-theme="graph"] .ai-archive-message.ai code { background:#0d1422; color:#b9c8ff; }
        .ai-panel[data-theme="graph"] {
            background:#0d1422 !important; color:#cbd5e1 !important;
            border-color:rgba(137,152,201,.28); border-radius:16px;
            box-shadow:0 28px 90px rgba(0,0,0,.58),0 0 0 1px rgba(102,120,194,.12),inset 0 1px 0 rgba(255,255,255,.05);
        }
        .ai-panel:not(.fullscreen) .ai-header { cursor:grab; touch-action:none; user-select:none; }
        .ai-panel.dragging { transition:none; }
        .ai-panel.dragging .ai-header { cursor:grabbing; }
        .ai-panel.fullscreen .ai-header { cursor:default; }
        .ai-panel[data-theme="graph"].dragging { box-shadow:0 34px 100px rgba(0,0,0,.66),0 0 0 1px rgba(126,145,222,.28); }
        .ai-panel[data-theme="graph"] .ai-header {
            border-bottom:1px solid rgba(137,152,201,.18);
            background:radial-gradient(circle at 16% 0%,rgba(91,112,211,.2),transparent 34%),linear-gradient(135deg,#111a2c,#151b30 62%,#211938);
        }
        .ai-panel[data-theme="graph"] .ai-brand-mark { background:#151d31; border-color:rgba(153,169,224,.25); }
        .ai-panel[data-theme="graph"] .ai-chat-body {
            background:radial-gradient(circle at 14% 0%,rgba(86,104,196,.08),transparent 34%),linear-gradient(180deg,#0d1422,#0a101b);
        }
        .ai-panel[data-theme="graph"] .ai-msg.ai { background:#151e31; color:#cbd5e1; border-color:rgba(132,147,194,.18); box-shadow:0 10px 28px rgba(0,0,0,.18); }
        .ai-panel[data-theme="graph"] .ai-msg.user { background:linear-gradient(135deg,#5065c7,#7653b8); box-shadow:0 9px 24px rgba(54,63,142,.3); }
        .ai-panel[data-theme="graph"] .ai-msg h1, .ai-panel[data-theme="graph"] .ai-msg h2, .ai-panel[data-theme="graph"] .ai-msg h3, .ai-panel[data-theme="graph"] .ai-msg h4 { color:#edf1fb; }
        .ai-panel[data-theme="graph"] .ai-msg code { background:rgba(102,119,184,.2); color:#b9c8ff; }
        .ai-panel[data-theme="graph"] .ai-msg pre, .ai-panel[data-theme="graph"] .ai-msg blockquote { background:#101827; color:#aeb9d0; border-color:#6678cf; }
        .ai-panel[data-theme="graph"] .ai-token-usage, .ai-panel[data-theme="graph"] .ai-grounding { color:#7886a2; border-color:rgba(137,152,201,.2); }
        .ai-panel[data-theme="graph"] .ai-grounding-title { color:#aeb9d0; }
        .ai-panel[data-theme="graph"] .ai-grounding-graph { background:#111a2c; color:#9eaff2; border-color:rgba(132,148,207,.22); }
        .ai-panel[data-theme="graph"] .ai-grounding-graph:hover, .ai-panel[data-theme="graph"] button.ai-grounding-item:hover { background:#18243c; color:#c6d4ff; border-color:rgba(146,165,245,.45); }
        .ai-panel[data-theme="graph"] .ai-grounding-graph.metric-reference { background:linear-gradient(135deg,rgba(112,85,189,.22),rgba(80,101,199,.18)); color:#caa9f8; border-color:rgba(168,136,238,.3); }
        .ai-panel[data-theme="graph"] .ai-grounding-graph.metric-reference:hover { background:linear-gradient(135deg,rgba(112,85,189,.34),rgba(80,101,199,.28)); color:#e5d5fd; border-color:rgba(189,162,247,.55); }
        .ai-panel[data-theme="graph"] .ai-suggestions, .ai-panel[data-theme="graph"] .ai-input-area, .ai-panel[data-theme="graph"] .ai-history-panel { background:#0f1726; border-color:rgba(132,147,194,.17); }
        .ai-panel[data-theme="graph"] .ai-suggestion-chip, .ai-panel[data-theme="graph"] .ai-history-item { background:#151e31; color:#aebcf0; border-color:rgba(132,147,194,.2); }
        .ai-panel[data-theme="graph"] .ai-suggestion-chip:hover, .ai-panel[data-theme="graph"] .ai-history-item:hover { background:#1b2740; border-color:rgba(130,148,232,.48); }
        .ai-panel[data-theme="graph"] .ai-history-title { color:#dfe5f2; }
        .ai-panel[data-theme="graph"] .ai-input { background:#111a2b; color:#e4e9f5 !important; border-color:rgba(136,152,207,.3); }
        .ai-panel[data-theme="graph"] .ai-input:focus { background:#151e31; border-color:#7081e4; box-shadow:0 0 0 3px rgba(99,102,241,.16); }
        .ai-panel[data-theme="graph"] .ai-send-btn { background:linear-gradient(135deg,#5369d9,#7653bd); }
        .ai-panel[data-theme="graph"] .ai-table-wrap, .ai-panel[data-theme="graph"] .ai-markdown-table { background:#111a2b; border-color:rgba(132,147,194,.2); }
        .ai-panel[data-theme="graph"] .ai-markdown-table th { background:#182239; color:#dfe5f2; border-color:rgba(132,147,194,.2); }
        .ai-panel[data-theme="graph"] .ai-markdown-table td { color:#aeb9d0; border-color:rgba(132,147,194,.13); }
        .ai-panel[data-theme="graph"] .ai-markdown-table tbody tr:nth-child(even) td, .ai-panel[data-theme="graph"] .ai-markdown-table tbody tr:hover td { background:#141e31; }
        @media (max-width: 520px) {
            .ai-fab {
                right: 0;
                bottom: 124px;
                height: 44px;
                min-width: 50px;
                padding: 0 9px;
                border-radius: 22px 0 0 22px;
            }
            .ai-fab-orb { width: 30px; height: 30px; }
            .ai-panel,
            .ai-panel.expanded {
                right: 12px;
                bottom: 130px;
                width: calc(100vw - 24px);
                height: min(70vh, 550px);
                max-width: none;
            }
            .ai-panel.fullscreen {
                inset: 0;
                width: 100vw;
                height: 100vh;
                border-radius: 0;
            }
            .ai-brand-subtitle { display: none; }
            .ai-header { padding-left: 12px; padding-right: 10px; }
            .ai-header-actions { gap: 4px; }
            .ai-archive-overlay { padding:0; }
            .ai-archive-window { width:100vw; height:100vh; border-radius:0; }
            .ai-archive-content { grid-template-columns:1fr; }
            .ai-archive-list { max-height:38vh; border-right:0; border-bottom:1px solid #e3e8f1; }
        }
        @media (max-width: 400px) {
            .ai-brand-copy { display:none; }
            .ai-header-actions { gap:3px; }
            .ai-action-btn { width:30px; height:30px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .ai-fab,
            .ai-fab::before,
            .ai-fab-label,
            .ai-panel {
                transition-duration: 0.01ms !important;
            }
            .ai-fab-orb::before,
            .ai-fab.is-pulse .ai-fab-orb { animation: none; }
        }
    `;
    document.head.appendChild(style);

    const AI_TEXT = {
        zh: {
            open: '打开Dragon Claw智能体', title: 'Dragon Claw智能体', titleCompact: 'Dragon Claw', subtitle: '项目知识 · 数据分析 · 运营建议', subtitleCompact: '知识 · 数据 · 运营',
            alertKicker: '主动 KPI 提醒', alertTaskKicker: '近 7 天临期任务', alertHint: '点击打开助手继续追问', alertClose: '关闭提醒', alertAi: 'AI 深度分析', alertAiCaption: '深度分析结果', alertSnoozeToday: '今天不再提醒', alertCopy: '复制', alertCopied: '已复制',
            graph: '知识与指标图谱', history: '历史问答', archive: '查看归档会话', graphTheme: '切换图谱深色主题', lightTheme: '切换明亮主题', expand: '放大窗口', restore: '恢复默认大小',
            fullscreen: '全屏聊天', exitFullscreen: '退出全屏', close: '关闭', send: '发送消息', stop: '停止生成',
            welcome: '👋 你好！我是您的专属智能体 Dragon Claw，正在为您加载页面上下文...', thinking: 'Dragon Claw 正在思考...',
            placeholder: '向 Dragon Claw 提问有关本页面的内容...', graphLoadFailed: '知识图谱组件加载失败',
            historyLoading: '正在加载历史问答...', historyEmpty: '暂无历史问答', unnamed: '未命名对话',
            messages: '条', historyFailed: '历史问答加载失败：', historyRestoreFailed: '历史问答恢复失败：',
            archiveTitle: '归档会话', archiveSubtitle: '跨页面查看、搜索和恢复历史对话', archiveSearch: '搜索页面、路径或对话内容…',
            archiveSelect: '选择左侧会话查看完整记录', archiveLoading: '正在加载归档会话…', archiveEmpty: '暂无归档会话',
            archiveCount: n => `共 ${n} 个历史会话`, archiveFailed: '归档会话加载失败：', restoreArchive: '恢复并继续对话', restoringArchive: '正在恢复…',
            statusActive: '活跃', statusArchived: '已归档', enterChat: '进入此对话',
            initPrompt: '你好，请用简短的话总结一下这个页面的核心功能以及如何使用它。',
            connectFailed: '连接 AI 服务失败：', error: '错误：', answerBasis: '本次回答依据',
            openGraph: '打开知识关系图谱', cache: '项目知识', hitChunks: n => `引用 ${n} 个相关片段`, cacheMiss: '未找到足够相关的项目片段', knowledgeNotNeeded: '本题未使用项目文档', knowledgeLibrary: '知识库', candidates: '候选',
            files: '文件', chunks: '片段', latestMonth: '最新月份', storedData: '入库数据', data: '数据', unknownFile: '未知文件', businessConfig: '实时业务配置', metricGraphReference: '运营指标图谱', metricsReferenced: n => `引用 ${n} 个指标`, submetricsReferenced: n => `${n} 个子指标`,
            contextCompressing: '对话较长，正在自动整理早期上下文…', contextCompressed: (n, kept) => `已压缩 ${n} 条早期消息，并保留最近 ${kept} 条与关键摘要`, contextCompressionFailed: '上下文整理未完成，本次将继续使用最近消息',
            current: '本次', total: '累计', approxCost: n => `(约${n}毛)`, totalCost: n => `(总计${n}毛)`
        },
        en: {
            open: 'Open Dragon Claw Agent', title: 'Dragon Claw Agent', titleCompact: 'Dragon Claw', subtitle: 'Project knowledge · Data analysis · Operations', subtitleCompact: 'Knowledge · Data · Ops',
            alertKicker: 'Proactive KPI alert', alertTaskKicker: 'Tasks due in 7 days', alertHint: 'Click to open the assistant and follow up', alertClose: 'Dismiss alert', alertAi: 'AI Deep Analysis', alertAiCaption: 'Deep Analysis', alertSnoozeToday: 'Mute today', alertCopy: 'Copy', alertCopied: 'Copied',
            graph: 'Knowledge & Metrics Graph', history: 'Chat history', archive: 'View archived chats', graphTheme: 'Switch to graph dark theme', lightTheme: 'Switch to light theme', expand: 'Expand window', restore: 'Restore default size',
            fullscreen: 'Full-screen chat', exitFullscreen: 'Exit full screen', close: 'Close', send: 'Send message', stop: 'Stop generating',
            welcome: '👋 Hi! I’m Dragon Claw, your dedicated intelligent agent. Loading current page context...', thinking: 'Dragon Claw is thinking...',
            placeholder: 'Ask Dragon Claw about this page or the project...', graphLoadFailed: 'Failed to load the knowledge graph',
            historyLoading: 'Loading chat history…', historyEmpty: 'No chat history yet', unnamed: 'Untitled conversation',
            messages: 'messages', historyFailed: 'Failed to load chat history: ', historyRestoreFailed: 'Failed to restore chat history: ',
            archiveTitle: 'Archived chats', archiveSubtitle: 'Browse, search, and restore conversations across pages', archiveSearch: 'Search pages, paths, or messages…',
            archiveSelect: 'Select a conversation to view its full history', archiveLoading: 'Loading archived chats…', archiveEmpty: 'No archived chats yet',
            archiveCount: n => `${n} conversations`, archiveFailed: 'Failed to load archived chats: ', restoreArchive: 'Restore and continue', restoringArchive: 'Restoring…',
            statusActive: 'Active', statusArchived: 'Archived', enterChat: 'Open conversation',
            initPrompt: 'Please briefly summarize the core purpose of this page and how to use it.',
            connectFailed: 'Could not connect to the AI service: ', error: 'Error: ', answerBasis: 'Sources for this answer',
            openGraph: 'Open knowledge graph', cache: 'Project knowledge', hitChunks: n => `${n} relevant chunks cited`, cacheMiss: 'No sufficiently relevant project chunks found', knowledgeNotNeeded: 'Project documents were not used for this question', knowledgeLibrary: 'library', candidates: 'candidates',
            files: 'files', chunks: 'chunks', latestMonth: 'latest month', storedData: 'Stored data', data: 'Data', unknownFile: 'Unknown file', businessConfig: 'Live business config', metricGraphReference: 'Operations metric graph', metricsReferenced: n => `${n} metrics referenced`, submetricsReferenced: n => `${n} submetrics`,
            contextCompressing: 'This conversation is long. Condensing earlier context…', contextCompressed: (n, kept) => `Condensed ${n} earlier messages; kept the latest ${kept} plus a key summary`, contextCompressionFailed: 'Context condensation did not finish; continuing with recent messages',
            current: 'This reply', total: 'Total', approxCost: n => `(approx. ${n} mao)`, totalCost: n => `(total ${n} mao)`
        }
    };
    function getAiLang() {
        const raw = window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || document.documentElement.lang || 'zh-CN';
        return String(raw).toLowerCase().startsWith('en') ? 'en' : 'zh';
    }
    function aiT(key, ...args) {
        const value = AI_TEXT[getAiLang()][key] ?? AI_TEXT.zh[key] ?? key;
        return typeof value === 'function' ? value(...args) : value;
    }

    // 创建 DOM
    const fab = document.createElement('div');
    fab.className = 'ai-fab';
    fab.setAttribute('role', 'button');
    fab.setAttribute('tabindex', '0');
    fab.setAttribute('aria-label', '打开Dragon Claw智能体');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('title', 'Dragon Claw智能体');
    fab.innerHTML = '<span class="ai-fab-orb" aria-hidden="true"><img class="ai-fab-avatar" src="./tp-static/frontend/assets/dragon-claw-avatar.jpg" alt="" draggable="false"><span class="ai-fab-dot"></span></span><span class="ai-fab-label">Dragon Claw</span>';
    document.body.appendChild(fab);

    const proactiveAlert = document.createElement('div');
    proactiveAlert.className = 'ai-proactive-alert';
    proactiveAlert.setAttribute('role', 'status');
    proactiveAlert.innerHTML = `
        <button class="ai-proactive-alert-close" type="button" aria-label="关闭提醒">×</button>
        <span class="ai-proactive-alert-kicker"><span class="ai-proactive-alert-kicker-label">主动 KPI 提醒</span></span>
        <span class="ai-proactive-alert-text"></span>
        <span class="ai-proactive-alert-ai-panel"><span class="ai-proactive-alert-ai-head"><span class="ai-proactive-alert-ai-badge" title="AI 深度分析">✦ AI</span><span class="ai-proactive-alert-ai-caption">深度分析结果</span></span><span class="ai-proactive-alert-ai-text"></span></span>
        <span class="ai-proactive-alert-footer"><span class="ai-proactive-alert-hint">点击打开助手继续追问</span><span class="ai-proactive-alert-actions"><button class="ai-proactive-alert-action ai-proactive-alert-snooze" type="button">今天不再提醒</button><button class="ai-proactive-alert-action ai-proactive-alert-copy" type="button">复制</button></span></span>`;
    document.body.appendChild(proactiveAlert);

    const panel = document.createElement('div');
    panel.className = 'ai-panel';
    panel.innerHTML = `
        <div class="ai-header">
            <div class="ai-brand">
                <div class="ai-brand-mark" aria-hidden="true"><img src="./tp-static/frontend/assets/dragon-claw-avatar.jpg?v=20260924-01" alt="Dragon Claw"></div>
                <div class="ai-brand-copy">
                    <div class="ai-brand-title"><span class="ai-brand-title-full">Dragon Claw智能体</span><span class="ai-brand-title-compact">Dragon Claw</span></div>
                    <div class="ai-brand-subtitle"><span class="ai-brand-subtitle-full">项目知识 · 数据分析 · 运营建议</span><span class="ai-brand-subtitle-compact">知识 · 数据 · 运营</span></div>
                </div>
            </div>
            <div class="ai-header-actions">
                <button class="ai-action-btn ai-knowledge-graph" type="button" title="知识与指标图谱" aria-label="知识与指标图谱">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="7" r="2.2"/><circle cx="8" cy="18" r="2.2"/><circle cx="17" cy="17" r="2.2"/><path d="M8 7l7.8-.1M7 8l1 7.8M10 17.8l4.8-.5M17.7 9.2l-.5 5.6M8 7.5l7.5 7.8"/></svg>
                </button>
                <button class="ai-action-btn ai-history" type="button" title="历史问答" aria-label="历史问答">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
                </button>
                <button class="ai-action-btn ai-archive" type="button" title="归档会话" aria-label="归档会话">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v13H4z"/><path d="M3 3h18v4H3zM9 11h6"/></svg>
                </button>
                <button class="ai-action-btn ai-theme-toggle" type="button" title="切换图谱深色主题" aria-label="切换图谱深色主题" aria-pressed="false">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/><path d="M17.5 3.5v3M16 5h3"/></svg>
                </button>
                <button class="ai-action-btn ai-expand" type="button" title="放大窗口" aria-label="放大窗口" aria-pressed="false">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 5V3h12v12h-2"/></svg>
                </button>
                <button class="ai-action-btn ai-fullscreen" type="button" title="全屏聊天" aria-label="全屏聊天" aria-pressed="false">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>
                </button>
                <button class="ai-action-btn ai-close" type="button" title="关闭" aria-label="关闭">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
                </button>
            </div>
        </div>
        <div class="ai-history-panel" id="aiHistoryPanel"></div>
        <div class="ai-chat-body" id="aiChatBody">
            <div class="ai-msg ai" id="aiInitialMessage">👋 你好！我是您的专属智能体 Dragon Claw，正在为您加载页面上下文...</div>
            <div class="ai-typing" id="aiTyping">Dragon Claw 正在思考...</div>
        </div>
        <div class="ai-suggestions" id="aiSuggestions"></div>
        <div class="ai-input-area">
            <input type="text" class="ai-input" id="aiInput" placeholder="向 Dragon Claw 提问有关本页面的内容...">
            <button class="ai-send-btn" id="aiSendBtn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
        </div>
    `;
    document.body.appendChild(panel);

    const archiveOverlay = document.createElement('div');
    archiveOverlay.className = 'ai-archive-overlay';
    archiveOverlay.innerHTML = `
        <section class="ai-archive-window" role="dialog" aria-modal="true" aria-labelledby="aiArchiveTitle">
            <header class="ai-archive-header">
                <div class="ai-archive-heading"><div class="ai-archive-title" id="aiArchiveTitle">归档会话</div><div class="ai-archive-subtitle">跨页面查看、搜索和恢复历史对话</div></div>
                <button type="button" class="ai-archive-close" aria-label="关闭">×</button>
            </header>
            <div class="ai-archive-toolbar"><input class="ai-archive-search" type="search" placeholder="搜索页面、路径或对话内容…"><span class="ai-archive-count"></span></div>
            <div class="ai-archive-content"><div class="ai-archive-list"></div><div class="ai-archive-preview"><div class="ai-archive-empty">选择左侧会话查看完整记录</div></div></div>
        </section>`;
    document.body.appendChild(archiveOverlay);

    const chatBody = document.getElementById('aiChatBody');
    const input = document.getElementById('aiInput');
    const sendBtn = document.getElementById('aiSendBtn');
    const typing = document.getElementById('aiTyping');
    const suggestionsEl = document.getElementById('aiSuggestions');
    const historyPanel = document.getElementById('aiHistoryPanel');
    const archiveBtn = panel.querySelector('.ai-archive');
    const archiveList = archiveOverlay.querySelector('.ai-archive-list');
    const archivePreview = archiveOverlay.querySelector('.ai-archive-preview');
    const archiveSearch = archiveOverlay.querySelector('.ai-archive-search');
    const archiveCount = archiveOverlay.querySelector('.ai-archive-count');
    const themeBtn = panel.querySelector('.ai-theme-toggle');
    const expandBtn = panel.querySelector('.ai-expand');
    const fullscreenBtn = panel.querySelector('.ai-fullscreen');
    const initialMessage = panel.querySelector('#aiInitialMessage');

    function setActionText(element, text) {
        element?.setAttribute('title', text);
        element?.setAttribute('aria-label', text);
    }
    const AI_THEME_KEY = 'tools_ai_assistant_theme';
    function detectPageAssistantTheme() {
        const roots = [document.documentElement, document.body].filter(Boolean);
        for (const root of roots) {
            const marker = [root.getAttribute('data-theme'), root.getAttribute('data-color-scheme'), root.className]
                .filter(Boolean).join(' ').toLowerCase();
            if (/(^|[\s_-])(dark|night|black)([\s_-]|$)/.test(marker)) return 'graph';
            if (/(^|[\s_-])(light|day|white)([\s_-]|$)/.test(marker)) return 'light';
        }
        for (const root of [document.body, document.documentElement].filter(Boolean)) {
            const style = window.getComputedStyle(root);
            if (style.colorScheme === 'dark') return 'graph';
            if (style.colorScheme === 'light') return 'light';
            const match = style.backgroundColor.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)$/i);
            if (!match || (match[4] !== undefined && Number(match[4]) === 0)) continue;
            const luminance = (Number(match[1]) * 299 + Number(match[2]) * 587 + Number(match[3]) * 114) / 1000;
            return luminance < 128 ? 'graph' : 'light';
        }
        return null;
    }
    function getFallbackAssistantTheme() {
        try {
            const saved = localStorage.getItem(AI_THEME_KEY);
            if (['light', 'graph'].includes(saved)) return saved;
        } catch (_error) {}
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'graph' : 'light';
    }
    let assistantTheme = (() => {
        return detectPageAssistantTheme() || getFallbackAssistantTheme();
    })();
    function applyAssistantTheme(theme, { persist = false } = {}) {
        assistantTheme = theme === 'graph' ? 'graph' : 'light';
        panel.dataset.theme = assistantTheme;
        proactiveAlert.dataset.theme = assistantTheme;
        archiveOverlay.dataset.theme = assistantTheme;
        themeBtn.setAttribute('aria-pressed', String(assistantTheme === 'graph'));
        setActionText(themeBtn, aiT(assistantTheme === 'graph' ? 'lightTheme' : 'graphTheme'));
        if (persist) {
            try { localStorage.setItem(AI_THEME_KEY, assistantTheme); } catch (_error) {}
        }
    }
    function applyContextTheme() {
        applyAssistantTheme(detectPageAssistantTheme() || getFallbackAssistantTheme());
    }
    function applyAiLanguage() {
        setActionText(fab, aiT('open'));
        updateProactiveKicker();
        proactiveAlert.querySelector('.ai-proactive-alert-hint').textContent = aiT('alertHint');
        setActionText(proactiveAlert.querySelector('.ai-proactive-alert-close'), aiT('alertClose'));
        setActionText(proactiveAlert.querySelector('.ai-proactive-alert-ai-badge'), aiT('alertAi'));
        proactiveAlert.querySelector('.ai-proactive-alert-ai-caption').textContent = aiT('alertAiCaption');
        proactiveAlert.querySelector('.ai-proactive-alert-snooze').textContent = aiT('alertSnoozeToday');
        proactiveAlert.querySelector('.ai-proactive-alert-copy').textContent = aiT('alertCopy');
        panel.querySelector('.ai-brand-title-full').textContent = aiT('title');
        panel.querySelector('.ai-brand-title-compact').textContent = aiT('titleCompact');
        panel.querySelector('.ai-brand-subtitle-full').textContent = aiT('subtitle');
        panel.querySelector('.ai-brand-subtitle-compact').textContent = aiT('subtitleCompact');
        setActionText(panel.querySelector('.ai-knowledge-graph'), aiT('graph'));
        setActionText(panel.querySelector('.ai-history'), aiT('history'));
        setActionText(archiveBtn, aiT('archive'));
        setActionText(themeBtn, aiT(assistantTheme === 'graph' ? 'lightTheme' : 'graphTheme'));
        setActionText(expandBtn, panel.classList.contains('expanded') ? aiT('restore') : aiT('expand'));
        setActionText(fullscreenBtn, panel.classList.contains('fullscreen') ? aiT('exitFullscreen') : aiT('fullscreen'));
        setActionText(panel.querySelector('.ai-close'), aiT('close'));
        archiveOverlay.querySelector('.ai-archive-title').textContent = aiT('archiveTitle');
        archiveOverlay.querySelector('.ai-archive-subtitle').textContent = aiT('archiveSubtitle');
        archiveOverlay.querySelector('.ai-archive-close').setAttribute('aria-label', aiT('close'));
        archiveSearch.placeholder = aiT('archiveSearch');
        const archiveEmpty = archivePreview.querySelector('.ai-archive-empty');
        if (archiveEmpty && !archiveOverlay.classList.contains('loading')) archiveEmpty.textContent = aiT('archiveSelect');
        setActionText(sendBtn, activeChatController ? aiT('stop') : aiT('send'));
        input.placeholder = aiT('placeholder');
        typing.textContent = aiT('thinking');
        if (isFirstOpen && initialMessage) initialMessage.textContent = aiT('welcome');
    }
    
    let isFirstOpen = true;
    let messages = [];
    let currentSessionId = null;
    let cumulativeTokens = 0;
    let cumulativeCost = 0;
    let knowledgeGraphLoader = null;
    let activeChatController = null;
    const sendButtonDefaultHtml = sendBtn.innerHTML;
    const brandFab = createBrandFab(fab);
    function openKnowledgeGraph(options = {}) {
        if (window.openToolsKnowledgeGraph) {
            window.openToolsKnowledgeGraph(options).catch(error => appendMessage(`⚠️ ${error.message}`, 'ai'));
            return;
        }
        if (window.AIKnowledgeGraph?.open) {
            window.AIKnowledgeGraph.open(options);
            return;
        }
        if (!knowledgeGraphLoader) {
            knowledgeGraphLoader = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = './tp-static/frontend/js/shared/ai-knowledge-graph-spatial-themes-v5.js';
                script.onload = resolve;
                script.onerror = () => reject(new Error(aiT('graphLoadFailed')));
                document.body.appendChild(script);
            });
        }
        knowledgeGraphLoader
            .then(() => window.AIKnowledgeGraph?.open?.(options))
            .catch(error => appendMessage(`⚠️ ${error.message}`, 'ai'));
    }

    // 点击反馈：头像徽章轻按回弹（替代原先常驻 30fps 重绘的粒子画布）
    function createBrandFab(root) {
        let timer = 0;
        return {
            pulse() {
                root.classList.remove('is-pulse');
                void root.offsetWidth;
                root.classList.add('is-pulse');
                clearTimeout(timer);
                timer = setTimeout(() => root.classList.remove('is-pulse'), 650);
            }
        };
    }

    function getFabRectData() {
        const rect = fab.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
        };
    }

    function notifyFabPosition() {
        positionProactiveAlert();
        window.dispatchEvent(new CustomEvent('tools:ai-fab-position', {
            detail: { rect: getFabRectData() }
        }));
    }

    function positionProactiveAlert() {
        const rect = fab.getBoundingClientRect();
        // 使用可见视口，避免页面横向溢出、Safari 工具栏或软键盘让浮层定位到屏幕之外。
        const viewport = window.visualViewport;
        const viewportWidth = viewport?.width || document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = viewport?.height || window.innerHeight;
        const compact = viewportWidth <= 600 || (window.matchMedia('(pointer: coarse)').matches && viewportHeight <= 500);
        const margin = 12;
        const minLeft = (viewport?.offsetLeft || 0) + margin;
        const minTop = (viewport?.offsetTop || 0) + margin;
        const maxRight = minLeft + viewportWidth - margin * 2;
        const maxBottom = minTop + viewportHeight - margin * 2;
        const width = Math.max(0, Math.min(compact ? 320 : 360, viewportWidth - margin * 2));
        const left = Math.max(minLeft, Math.min(maxRight - width, rect.right - width));
        proactiveAlert.dataset.compact = String(compact);
        proactiveAlert.style.width = `${width}px`;
        const viewportLimit = Math.max(0, Math.min(maxBottom - minTop, compact ? Math.min(280, viewportHeight * .45) : Infinity));
        proactiveAlert.style.maxHeight = '';
        proactiveAlert.style.overflowY = '';
        const measuredHeight = proactiveAlert.offsetHeight || 118;
        const availableAbove = Math.max(0, Math.min(maxBottom, rect.top - 14) - minTop);
        const availableBelow = Math.max(0, maxBottom - Math.max(minTop, rect.bottom + 14));
        const placeAbove = measuredHeight <= availableAbove || availableAbove >= availableBelow;
        const availableSpace = placeAbove ? availableAbove : availableBelow;
        const heightLimit = Math.min(viewportLimit, availableSpace);
        proactiveAlert.style.maxHeight = `${heightLimit}px`;
        proactiveAlert.style.overflowY = measuredHeight > heightLimit ? 'auto' : '';
        const height = Math.min(measuredHeight, heightLimit);
        const top = placeAbove ? rect.top - height - 14 : rect.bottom + 14;
        proactiveAlert.style.left = `${Math.round(left)}px`;
        proactiveAlert.style.top = `${Math.round(Math.max(minTop, Math.min(maxBottom - height, top)))}px`;
        proactiveAlert.dataset.placement = placeAbove ? 'above' : 'below';
        const arrowRight = Math.min(width - 30, Math.max(18, left + width - (rect.left + rect.width / 2) - 7));
        proactiveAlert.style.setProperty('--ai-alert-arrow-right', `${Math.round(arrowRight)}px`);
    }

    function openOrClosePanel() {
        panel.classList.toggle('open');
        fab.setAttribute('aria-expanded', panel.classList.contains('open') ? 'true' : 'false');
        if (panel.classList.contains('open')) {
            applyContextTheme();
            if (isFirstOpen) {
                isFirstOpen = false;
                initChat();
            }
            loadSuggestions();
            setTimeout(() => input.focus(), 300);
        }
    }
    
    fab.onclick = () => {
        brandFab.pulse();
        hideProactiveAlert();
        openOrClosePanel();
    };

    fab.addEventListener('pointerenter', () => {
        const now = Date.now();
        if (now - lastProactiveHoverAt < PROACTIVE_HOVER_COOLDOWN_MS) return;
        lastProactiveHoverAt = now;
        loadProactiveAlert();
    });

    proactiveAlert.querySelector('.ai-proactive-alert-close').addEventListener('click', event => {
        event.stopPropagation();
        hideProactiveAlert({ reason:'close' });
    });
    proactiveAlert.querySelector('.ai-proactive-alert-snooze').addEventListener('click', event => {
        event.stopPropagation();
        snoozeProactiveAlertsToday();
        hideProactiveAlert({ reschedule:false, reason:'close' });
        scheduleProactiveAlert();
    });
    proactiveAlert.querySelector('.ai-proactive-alert-copy').addEventListener('click', async event => {
        event.stopPropagation();
        const button = event.currentTarget;
        const original = proactiveAlert.querySelector('.ai-proactive-alert-text').textContent.trim();
        const polished = (proactiveAlert.classList.contains('ai-polished') || proactiveAlert.classList.contains('ai-deep-analyzed'))
            ? proactiveAlert.querySelector('.ai-proactive-alert-ai-text').textContent.replace(/\u00a0/g, ' ').trim()
            : '';
        const copyText = polished
            ? `${original}\n\n${aiT('alertAiCaption')}：\n${polished}`
            : original;
        try {
            await navigator.clipboard.writeText(copyText);
        } catch (_error) {
            const textarea = document.createElement('textarea');
            textarea.value = copyText;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        button.textContent = aiT('alertCopied');
        window.setTimeout(() => { button.textContent = aiT('alertCopy'); }, 1400);
    });
    proactiveAlert.addEventListener('click', () => {
        const prompt = proactiveAlert.dataset.prompt || '';
        const displayText = proactiveAlert.querySelector('.ai-proactive-alert-text').textContent || prompt;
        hideProactiveAlert();
        openAssistant({ prompt, displayText });
    });
    proactiveAlert.addEventListener('pointerenter', () => {
        if (proactiveHideTimer) window.clearTimeout(proactiveHideTimer);
        proactiveHideTimer = null;
    });
    proactiveAlert.addEventListener('pointerleave', () => {
        if (!proactiveAlert.classList.contains('show') || proactiveAlert.classList.contains('is-leaving')) return;
        if (proactiveHideTimer) window.clearTimeout(proactiveHideTimer);
        proactiveHideTimer = window.setTimeout(() => hideProactiveAlert(), PROACTIVE_HOVER_LEAVE_GRACE_MS);
    });
    window.addEventListener('resize', positionProactiveAlert);
    window.visualViewport?.addEventListener('resize', positionProactiveAlert);
    window.visualViewport?.addEventListener('scroll', positionProactiveAlert);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !proactiveTimer && !proactiveAlert.classList.contains('show')) scheduleProactiveAlert();
    });

    fab.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        brandFab.pulse();
        openOrClosePanel();
    };

    function restorePanelDragPosition() {
        if (!panel.dataset.dragLeft) return;
        panel.style.left = panel.dataset.dragLeft;
        panel.style.top = panel.dataset.dragTop;
        panel.style.right = panel.dataset.dragRight;
        panel.style.bottom = panel.dataset.dragBottom;
    }
    
    panel.querySelector('.ai-close').onclick = () => {
        panel.classList.remove('open');
        panel.classList.remove('fullscreen');
        document.body.classList.remove('ai-chat-fullscreen');
        fullscreenBtn.setAttribute('aria-pressed', 'false');
        setActionText(fullscreenBtn, aiT('fullscreen'));
        restorePanelDragPosition();
        fab.setAttribute('aria-expanded', 'false');
        fab.focus();
    };
    expandBtn.onclick = () => {
        const expanded = panel.classList.toggle('expanded');
        expandBtn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
        setActionText(expandBtn, expanded ? aiT('restore') : aiT('expand'));
        if (panel.style.left) requestAnimationFrame(() => {
            const rect = panel.getBoundingClientRect();
            const position = clampPanelPosition(rect.left, rect.top);
            panel.style.left = `${position.left}px`;
            panel.style.top = `${position.top}px`;
        });
    };
    fullscreenBtn.onclick = () => {
        const fullscreen = panel.classList.toggle('fullscreen');
        if (fullscreen) {
            panel.dataset.dragLeft = panel.style.left || '';
            panel.dataset.dragTop = panel.style.top || '';
            panel.dataset.dragRight = panel.style.right || '';
            panel.dataset.dragBottom = panel.style.bottom || '';
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '';
            panel.style.bottom = '';
        } else restorePanelDragPosition();
        document.body.classList.toggle('ai-chat-fullscreen', fullscreen);
        fullscreenBtn.setAttribute('aria-pressed', fullscreen ? 'true' : 'false');
        setActionText(fullscreenBtn, fullscreen ? aiT('exitFullscreen') : aiT('fullscreen'));
        setTimeout(() => input.focus(), 120);
    };
    panel.querySelector('.ai-knowledge-graph').onclick = () => openKnowledgeGraph({ mode: 'knowledge' });
    panel.querySelector('.ai-history').onclick = async () => {
        historyPanel.classList.toggle('open');
        if (historyPanel.classList.contains('open')) {
            await loadHistorySessions();
        }
    };
    archiveBtn.onclick = openArchiveBrowser;
    archiveOverlay.querySelector('.ai-archive-close').onclick = closeArchiveBrowser;
    archiveOverlay.addEventListener('click', event => {
        if (event.target === archiveOverlay) closeArchiveBrowser();
    });
    let archiveSearchTimer = null;
    archiveSearch.addEventListener('input', () => {
        clearTimeout(archiveSearchTimer);
        archiveSearchTimer = setTimeout(() => loadArchivedSessions(archiveSearch.value), 260);
    });
    themeBtn.onclick = () => applyAssistantTheme(assistantTheme === 'graph' ? 'light' : 'graph', { persist:true });

    let panelDrag = null;
    function clampPanelPosition(left, top) {
        const margin = 10;
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        return {
            left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
            top: Math.max(margin, Math.min(window.innerHeight - height - margin, top))
        };
    }
    panel.querySelector('.ai-header').addEventListener('pointerdown', event => {
        if (panel.classList.contains('fullscreen')) return;
        if (event.button !== 0 || event.target.closest('button, input, a')) return;
        const rect = panel.getBoundingClientRect();
        panelDrag = { pointerId:event.pointerId, offsetX:event.clientX - rect.left, offsetY:event.clientY - rect.top };
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.classList.add('dragging');
        panel.querySelector('.ai-header').setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    panel.querySelector('.ai-header').addEventListener('pointermove', event => {
        if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
        const position = clampPanelPosition(event.clientX - panelDrag.offsetX, event.clientY - panelDrag.offsetY);
        panel.style.left = `${position.left}px`;
        panel.style.top = `${position.top}px`;
    });
    function finishPanelDrag(event) {
        if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
        panelDrag = null;
        panel.classList.remove('dragging');
        try { panel.querySelector('.ai-header').releasePointerCapture(event.pointerId); } catch (_error) {}
    }
    panel.querySelector('.ai-header').addEventListener('pointerup', finishPanelDrag);
    panel.querySelector('.ai-header').addEventListener('pointercancel', finishPanelDrag);
    
    window.addEventListener('resize', () => {
        if (panel.style.left && !panel.classList.contains('fullscreen')) {
            const rect = panel.getBoundingClientRect();
            const position = clampPanelPosition(rect.left, rect.top);
            panel.style.left = `${position.left}px`;
            panel.style.top = `${position.top}px`;
        }
        notifyFabPosition();
    }, { passive: true });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (archiveOverlay.classList.contains('open')) {
            closeArchiveBrowser();
            return;
        }
        if (!panel.classList.contains('fullscreen')) return;
        panel.classList.remove('fullscreen');
        document.body.classList.remove('ai-chat-fullscreen');
        fullscreenBtn.setAttribute('aria-pressed', 'false');
        setActionText(fullscreenBtn, aiT('fullscreen'));
        restorePanelDragPosition();
        input.focus();
    });
    
    setTimeout(notifyFabPosition, 0);
    window.addEventListener('tools:languagechange', applyAiLanguage);
    applyAiLanguage();

    function renderMarkdownLike(text) {
        const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
        const blocks = [];

        function inline(value) {
            const codeTokens = [];
            const keep = html => {
                codeTokens.push(html);
                return `\u0000CODE${codeTokens.length - 1}\u0000`;
            };
            // 本机文件 / 图片 / 文件引用 → 下载卡片与可放大图片（js/shared/chat-files.js）
            let source = globalThis.ChatFiles ? globalThis.ChatFiles.transformInline(String(value || ''), keep) : String(value || '');
            source = source.replace(/`([^`]+)`/g, (_match, code) => {
                const token = `\u0000CODE${codeTokens.length}\u0000`;
                codeTokens.push(`<code>${escapeHtml(code)}</code>`);
                return token;
            });
            // [文字](链接)：只允许站内绝对路径和 http(s)，站外链接新窗口打开。
            source = source.replace(/\[([^\]\n]+)\]\(((?:\/(?!\/)|https?:\/\/)[^\s)]+)\)/g, (_match, label, href) => {
                const token = `\u0000CODE${codeTokens.length}\u0000`;
                const external = /^https?:/i.test(href);
                codeTokens.push(`<a class="ai-md-link" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(label)}</a>`);
                return token;
            });
            source = escapeHtml(source)
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/__([^_]+)__/g, '<strong>$1</strong>')
                .replace(/~~([^~]+)~~/g, '<del>$1</del>');
            codeTokens.forEach((html, index) => {
                source = source.replace(`\u0000CODE${index}\u0000`, () => html);
            });
            return source;
        }

        function splitTableRow(line) {
            let source = String(line || '').trim();
            if (source.startsWith('|')) source = source.slice(1);
            if (source.endsWith('|')) source = source.slice(0, -1);
            const cells = [];
            let current = '';
            let escaped = false;
            for (const char of source) {
                if (escaped) {
                    current += char;
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === '|') {
                    cells.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            cells.push(current.trim());
            return cells;
        }

        function tableAlignment(cell) {
            const value = String(cell || '').trim();
            if (/^:-{3,}:$/.test(value)) return 'align-center';
            if (/^-{3,}:$/.test(value)) return 'align-right';
            return 'align-left';
        }

        function isTableSeparator(line) {
            const cells = splitTableRow(line);
            return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
        }

        function isSpecialStart(index) {
            const line = lines[index] || '';
            return /^```/.test(line.trim())
                || /^#{1,4}\s+/.test(line)
                || /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)
                || /^\s*>\s?/.test(line)
                || (line.includes('|') && isTableSeparator(lines[index + 1] || ''));
        }

        let index = 0;
        while (index < lines.length) {
            const line = lines[index];
            if (!line.trim()) { index += 1; continue; }

            if (/^```/.test(line.trim())) {
                const language = line.trim().slice(3).trim();
                const code = [];
                index += 1;
                while (index < lines.length && !/^```/.test(lines[index].trim())) code.push(lines[index++]);
                if (index < lines.length) index += 1;
                blocks.push(`<pre data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
                continue;
            }

            if (line.includes('|') && isTableSeparator(lines[index + 1] || '')) {
                const headers = splitTableRow(line);
                const alignments = splitTableRow(lines[index + 1]).map(tableAlignment);
                const rows = [];
                index += 2;
                while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
                    const cells = splitTableRow(lines[index]);
                    while (cells.length < headers.length) cells.push('');
                    rows.push(cells.slice(0, headers.length));
                    index += 1;
                }
                const head = headers.map((cell, cellIndex) => `<th scope="col" class="${alignments[cellIndex] || 'align-left'}">${inline(cell)}</th>`).join('');
                const body = rows.map(row => `<tr>${row.map((cell, cellIndex) => {
                    const numeric = /^[-+]?\d[\d,.]*(?:%|分|条|个)?$/.test(cell.trim()) ? ' numeric' : '';
                    return `<td class="${alignments[cellIndex] || 'align-left'}${numeric}">${inline(cell)}</td>`;
                }).join('')}</tr>`).join('');
                blocks.push(`<div class="ai-table-wrap" role="region" aria-label="AI 分析表格" tabindex="0"><table class="ai-markdown-table" style="--ai-table-columns:${headers.length}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
                continue;
            }

            const heading = line.match(/^(#{1,4})\s+(.+)$/);
            if (heading) {
                const level = heading[1].length;
                blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
                index += 1;
                continue;
            }

            if (/^\s*[-*+]\s+/.test(line)) {
                const items = [];
                while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
                    items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
                    index += 1;
                }
                blocks.push(`<ul>${items.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
                continue;
            }

            if (/^\s*\d+[.)]\s+/.test(line)) {
                const items = [];
                while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
                    items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''));
                    index += 1;
                }
                blocks.push(`<ol>${items.map(item => `<li>${inline(item)}</li>`).join('')}</ol>`);
                continue;
            }

            if (/^\s*>\s?/.test(line)) {
                const quote = [];
                while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
                blocks.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
                continue;
            }

            const paragraph = [line.trim()];
            index += 1;
            while (index < lines.length && lines[index].trim() && !isSpecialStart(index)) paragraph.push(lines[index++].trim());
            blocks.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
        }
        return blocks.join('');
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderGrounding(grounding) {
        if (!grounding || typeof grounding !== 'object') return '';
        const items = [];
        let cacheHtml = '';
        let metricGraphHtml = '';
        const knowledgeCache = grounding.knowledgeCache;
        if (knowledgeCache) {
            const hitText = knowledgeCache.state === 'hit'
                ? aiT('hitChunks', Number(knowledgeCache.hitCount) || 0)
                : knowledgeCache.state === 'not_needed'
                    ? aiT('knowledgeNotNeeded')
                    : aiT('cacheMiss');
            const diagnostic = `${aiT('openGraph')} · ${aiT('candidates')}: ${Number(knowledgeCache.candidateCount) || 0}${knowledgeCache.relevanceThreshold ? ` · threshold: ${knowledgeCache.relevanceThreshold}` : ''}`;
            cacheHtml = `<button type="button" class="ai-grounding-graph" data-open-knowledge-graph="true" title="${escapeHtml(diagnostic)}">🧠 ${escapeHtml(aiT('cache'))}: ${escapeHtml(hitText)} · ${escapeHtml(aiT('knowledgeLibrary'))} ${Number(knowledgeCache.documentCount) || 0} ${escapeHtml(aiT('files'))} / ${Number(knowledgeCache.chunkCount) || 0} ${escapeHtml(aiT('chunks'))}</button>`;
        }
        const dataSource = grounding.dataSource;
        if (dataSource) {
            if (dataSource.available) {
                const month = dataSource.month ? (getAiLang() === 'en' ? `Month ${dataSource.month}` : `${dataSource.month}月`) : aiT('latestMonth');
                const snapshot = dataSource.snapshotId ? ` · ${dataSource.snapshotId}` : '';
                const createdAt = dataSource.createdAt ? ` · ${dataSource.createdAt}` : '';
                items.push({ text: `📊 ${aiT('storedData')}: ${month}${snapshot}${createdAt}` });
            } else if (dataSource.reason) {
                items.push({ text: `📊 ${aiT('data')}: ${dataSource.reason}` });
            }
        }
        const sources = Array.isArray(grounding.knowledgeSources) ? grounding.knowledgeSources : [];
        sources.slice(0, 4).forEach(source => {
            const line = source.startLine ? `:${source.startLine}` : '';
            items.push({
                text: `📄 ${source.path || aiT('unknownFile')}${line}`,
                source
            });
        });
        const toolData = grounding.toolData;
        (Array.isArray(toolData?.tools) ? toolData.tools : []).forEach(tool => {
            const sources = Array.isArray(tool.sources) ? tool.sources : [];
            if (!sources.length) {
                items.push({ text: `📦 ${getAiLang() === 'en' ? 'Tool data' : '工具数据'}: ${tool.name} · ${getAiLang() === 'en' ? 'no readable data' : '无可读取的数据'}` });
                return;
            }
            sources.slice(0, 3).forEach(source => {
                const picked = (Array.isArray(source.selected) ? source.selected : []).slice(0, 2).map(item => {
                    const period = item.period ? ` ${item.period.start}~${item.period.end}` : '';
                    return `${item.name || ''}${period}`.trim();
                }).filter(Boolean).join('、');
                items.push({ text: `📦 ${getAiLang() === 'en' ? 'Tool data' : '工具数据'}: ${tool.name} · ${source.label} ${source.count}${picked ? ` · ${picked}` : ''}` });
            });
        });
        const configSources = Array.isArray(grounding.configSources) ? grounding.configSources : [];
        configSources.slice(0, 4).forEach(source => {
            const updatedAt = source.updatedAt ? ` · ${source.updatedAt}` : '';
            items.push({ text: `⚙️ ${aiT('businessConfig')}: ${source.title || source.source}${updatedAt}` });
        });
        const metricGraph = grounding.metricGraph;
        if (metricGraph && Array.isArray(metricGraph.references) && metricGraph.references.length) {
            const subMetricCount = metricGraph.references.reduce((sum, item) => sum + (Array.isArray(item.subMetrics) ? item.subMetrics.length : 0), 0);
            const monthLabel = metricGraph.month ? (getAiLang() === 'en' ? `Month ${metricGraph.month}` : `${metricGraph.month}月`) : aiT('latestMonth');
            const details = [aiT('metricsReferenced', metricGraph.references.length), subMetricCount ? aiT('submetricsReferenced', subMetricCount) : '', monthLabel].filter(Boolean).join(' · ');
            const graphOptions = {
                mode: 'metrics',
                month: metricGraph.month || null,
                metricReferences: metricGraph.references
            };
            metricGraphHtml = `<button type="button" class="ai-grounding-graph metric-reference" data-open-knowledge-graph="true" data-graph-options="${escapeHtml(JSON.stringify(graphOptions))}" title="${escapeHtml(aiT('openGraph'))}">📈 ${escapeHtml(aiT('metricGraphReference'))}: ${escapeHtml(details)}</button>`;
        }
        if (!items.length && !cacheHtml && !metricGraphHtml) return '';
        const sourcePayload = escapeHtml(JSON.stringify(sources));
        if (cacheHtml && sources.length) cacheHtml = cacheHtml.replace('data-open-knowledge-graph="true"', `data-open-knowledge-graph="true" data-knowledge-sources="${sourcePayload}"`);
        return `<div class="ai-grounding"><div class="ai-grounding-title">${escapeHtml(aiT('answerBasis'))}</div>${cacheHtml}${metricGraphHtml}${items.map(item => item.source
            ? `<button type="button" class="ai-grounding-item" data-open-knowledge-graph="true" data-knowledge-sources="${escapeHtml(JSON.stringify([item.source]))}" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</button>`
            : `<div class="ai-grounding-item" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</div>`).join('')}</div>`;
    }

    function appendMessage(text, role, tokens = 0, cost = 0, grounding = null) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'ai-msg ' + role;
        
        let contentHtml = renderMarkdownLike(text);
        if (role === 'ai' && tokens > 0) {
            cumulativeTokens += tokens;
            cumulativeCost += cost;
            const fmtCost = cost > 0 ? aiT('approxCost', cost.toFixed(4)) : '';
            const fmtTotal = cumulativeCost > 0 ? aiT('totalCost', cumulativeCost.toFixed(3)) : '';
            contentHtml += `<div class="ai-token-usage">${aiT('current')}: ${tokens} ${fmtCost} | ${aiT('total')}: ${cumulativeTokens} ${fmtTotal}</div>`;
        }
        if (role === 'ai') contentHtml += renderGrounding(grounding);
        
        msgDiv.innerHTML = contentHtml;
        chatBody.insertBefore(msgDiv, typing);
        chatBody.scrollTop = chatBody.scrollHeight;
        return msgDiv;
    }

    chatBody.addEventListener('click', event => {
        const trigger = event.target.closest('[data-open-knowledge-graph]');
        if (!trigger) return;
        if (trigger.dataset.graphOptions) {
            try {
                openKnowledgeGraph(JSON.parse(trigger.dataset.graphOptions));
                return;
            } catch (_error) {}
        }
        let sources = [];
        try { sources = JSON.parse(trigger.dataset.knowledgeSources || '[]'); } catch (_error) {}
        openKnowledgeGraph({ mode: 'knowledge', sources });
    });

    function getPageContext() {
        const pageTitle = document.title;
        let context = '';
        // 优先抓取页面核心区域
        const contentEl = document.querySelector('.page-content');
        if (contentEl) {
            context = contentEl.innerText;
        } else {
            // 如果没有 page-content 类，退化抓取全部 body
            context = document.body.innerText;
        }
        return { pageTitle, context };
    }

    function getPagePath() {
        return window.location.pathname || '/';
    }

    function getAuthHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? ('Bearer ' + token) : ''
        };
    }

    const PROACTIVE_MIN_DELAY_MS = 5 * 60 * 1000;
    const PROACTIVE_MAX_DELAY_MS = 60 * 60 * 1000;
    const PROACTIVE_HOVER_COOLDOWN_MS = 60 * 1000;
    const PROACTIVE_VISIBLE_MS = 18 * 1000;
    const PROACTIVE_HOVER_LEAVE_GRACE_MS = 6 * 1000;
    const PROACTIVE_SEEN_KEY = 'tools_ai_proactive_alerts_seen_v2';
    const PROACTIVE_SNOOZE_KEY = 'tools_ai_proactive_alerts_snoozed_v1';
    const PROACTIVE_ENTRY_PATHS = new Set(['/', '/uivf12', '/sla', '/report', '/expedite', '/monthly']);
    let proactiveTimer = null;
    let proactiveHideTimer = null;
    let proactiveExitTimer = null;
    let proactiveLoading = false;
    let proactiveActive = null;
    let lastProactiveHoverAt = 0;

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function scheduleProactiveAlert() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        if (!token) return;
        if (proactiveTimer) window.clearTimeout(proactiveTimer);
        const delay = isProactiveSnoozedToday()
            ? Math.max(1000, new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1).getTime() - Date.now() + 1000)
            : randomInt(PROACTIVE_MIN_DELAY_MS, PROACTIVE_MAX_DELAY_MS);
        proactiveTimer = window.setTimeout(() => {
            proactiveTimer = null;
            loadProactiveAlert();
        }, delay);
    }

    function localDateKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function proactiveSeenStorageKey() {
        const tenantId = localStorage.getItem('tools_tenant_id') || 'default';
        return `${PROACTIVE_SEEN_KEY}:${tenantId}`;
    }

    function proactiveSnoozeStorageKey() {
        const tenantId = localStorage.getItem('tools_tenant_id') || 'default';
        return `${PROACTIVE_SNOOZE_KEY}:${tenantId}`;
    }

    function isProactiveSnoozedToday() {
        try { return localStorage.getItem(proactiveSnoozeStorageKey()) === localDateKey(); } catch (_error) { return false; }
    }

    function snoozeProactiveAlertsToday() {
        try { localStorage.setItem(proactiveSnoozeStorageKey(), localDateKey()); } catch (_error) {}
    }

    function readSeenProactiveKeys() {
        try {
            const value = JSON.parse(localStorage.getItem(proactiveSeenStorageKey()) || '{}');
            if (value.date !== localDateKey() || !Array.isArray(value.seen)) return [];
            return value.seen.slice(-500);
        } catch (_error) {
            return [];
        }
    }

    function writeSeenProactiveKeys(seen) {
        try {
            localStorage.setItem(proactiveSeenStorageKey(), JSON.stringify({
                date: localDateKey(),
                seen: [...new Set(seen)].slice(-500)
            }));
        } catch (_error) {}
    }

    function proactiveItemKey(item) {
        return item?.kind === 'task'
            ? `task:${item.owner || ''}:${item.taskType || ''}`
            : `kpi:${item?.metric || ''}`;
    }

    function chooseProactiveItems(items) {
        const pool = Array.isArray(items) ? items : [];
        if (!pool.length) return [];
        let seen = new Set(readSeenProactiveKeys());
        let available = pool.filter(item => !seen.has(proactiveItemKey(item)));
        if (!available.length) {
            seen = new Set();
            available = pool;
        }
        const seenOrder = readSeenProactiveKeys();
        const lastKind = String(seenOrder[seenOrder.length - 1] || '').split(':')[0];
        const tasks = available.filter(item => item.kind === 'task');
        const metrics = available.filter(item => item.kind !== 'task');
        let preferred = lastKind
            ? (lastKind === 'task' ? metrics : tasks)
            : (Math.random() < 0.35 && tasks.length ? tasks : metrics);
        if (!preferred.length) preferred = tasks.length ? tasks : metrics;
        if (preferred[0]?.kind !== 'task') {
            const imported = preferred.filter(item => item.sourceType !== 'manual');
            if (imported.length) preferred = imported;
        }
        const shuffled = [...preferred].sort(() => Math.random() - 0.5);
        const take = preferred[0]?.kind === 'task' ? 1 : randomInt(1, 3);
        const selected = shuffled.slice(0, Math.min(take, shuffled.length));
        writeSeenProactiveKeys([...seen, ...selected.map(proactiveItemKey)]);
        return selected;
    }

    function formatProactiveTemplate(items) {
        const first = items[0];
        if (first?.kind === 'task') {
            if (getAiLang() === 'en') return `${first.owner} has ${first.count} ${first.taskType} task(s) due within 7 days. Please arrange follow-up soon.`;
            return `${first.owner}最近 7 天有 ${first.count} 个${first.taskType}类临期任务，请尽快安排处理。`;
        }
        const customerGroup = first?.customerGroup || (getAiLang() === 'en' ? 'The selected group' : '相关客户群');
        const metric = first?.metric || (getAiLang() === 'en' ? 'this metric' : '该指标');
        if (getAiLang() === 'en') {
            const more = items.length > 1 ? ` and ${items.length - 1} more priority gaps` : '';
            return `${customerGroup}'s ${metric} is ${first?.actual || 'below target'} versus ${first?.target || 'the target'}${more}. A quick follow-up may help move it forward.`;
        }
        const more = items.length > 1 ? `，另有 ${items.length - 1} 项重点差距` : '';
        return `${customerGroup}的「${metric}」当前为 ${first?.actual || '未达标'}，目标 ${first?.target || '待核对'}${more}。建议尽快关注一下。`;
    }

    function updateProactiveKicker() {
        const alertMonth = Number(proactiveAlert.dataset.month) || null;
        const isTask = proactiveAlert.dataset.kind === 'task';
        proactiveAlert.querySelector('.ai-proactive-alert-kicker-label').textContent = alertMonth
            && !isTask ? `${aiT('alertKicker')} · ${getAiLang() === 'en' ? `Month ${alertMonth}` : `${alertMonth}月`}`
            : aiT(isTask ? 'alertTaskKicker' : 'alertKicker');
    }

    function buildProactivePrompt(items, snapshot) {
        const isTask = items[0]?.kind === 'task';
        const lines = items.map((item, index) => item.kind === 'task'
            ? `${index + 1}. 负责人 ${item.owner}：未来 7 天有 ${item.count} 个${item.taskType}类临期任务`
            : `${index + 1}. ${item.customerGroup} / ${item.metric}：实际 ${item.actual || '无值'}，目标 ${item.target || '未配置'}${item.gap ? `，差距 ${item.gap}` : ''}`);
        const timeText = snapshot
            ? `目标月份 ${snapshot.month} 月，快照生成时间 ${snapshot.createdAt || '未知'}`
            : '最新入库报表';
        return `请根据这条主动${isTask ? '临期任务' : ' KPI'}预警的深度分析结果（含细分维度与历史快照趋势）继续深入分析，并给出具体的优先整改推进建议。不得展示或猜测具体单号。\n数据口径：${timeText}\n${lines.join('\n')}`;
    }

    function revealProactiveAiText(message) {
        const target = proactiveAlert.querySelector('.ai-proactive-alert-ai-text');
        target.innerHTML = '';
        Array.from(message).forEach((char, index) => {
            if (char === '\n') {
                target.appendChild(document.createElement('br'));
                return;
            }
            const span = document.createElement('span');
            span.className = 'ai-proactive-alert-ai-char';
            span.style.setProperty('--ai-char-index', String(Math.min(index, 160)));
            span.textContent = char === ' ' ? '\u00a0' : char;
            target.appendChild(span);
        });
    }

    function hideProactiveAlert({ reschedule = true, reason = 'auto' } = {}) {
        if (!proactiveAlert.classList.contains('show')) return;
        if (proactiveHideTimer) window.clearTimeout(proactiveHideTimer);
        proactiveHideTimer = null;
        proactiveActive = null;
        if (proactiveExitTimer) window.clearTimeout(proactiveExitTimer);
        proactiveAlert.classList.add('is-leaving');
        proactiveAlert.classList.toggle('is-closing', reason === 'close');
        proactiveExitTimer = window.setTimeout(() => {
            proactiveAlert.classList.remove('show', 'is-leaving', 'is-closing');
            proactiveExitTimer = null;
        }, reason === 'close' ? 340 : 280);
        if (reschedule) scheduleProactiveAlert();
    }

    async function humanizeProactiveAlert(items, activeToken, snapshot) {
        try {
            const response = await fetch('/api/ai/proactive-alert-message', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ items, snapshot, language: getAiLang() })
            });
            if (!response.ok) return;
            const data = await response.json();
            if (proactiveActive !== activeToken || !proactiveAlert.classList.contains('show')) return;
            const message = String(data.message || '').trim();
            if (message) {
                revealProactiveAiText(message);
                if (data.source === 'ai' || data.source === 'rule') {
                    proactiveAlert.classList.add('ai-polished');
                    proactiveAlert.classList.add('ai-deep-analyzed');
                    if (proactiveHideTimer) window.clearTimeout(proactiveHideTimer);
                    proactiveHideTimer = window.setTimeout(() => hideProactiveAlert(), PROACTIVE_VISIBLE_MS);
                }
                positionProactiveAlert();
            }
        } catch (_error) {
            // 模板文案已经显示，AI 降级时不打扰用户。
        }
    }

    function showProactiveAlert(items, snapshot) {
        const activeToken = `${Date.now()}-${Math.random()}`;
        proactiveActive = activeToken;
        if (proactiveExitTimer) window.clearTimeout(proactiveExitTimer);
        proactiveExitTimer = null;
        proactiveAlert.classList.remove('ai-polished', 'ai-deep-analyzed', 'show', 'is-leaving', 'is-closing');
        proactiveAlert.querySelector('.ai-proactive-alert-ai-text').innerHTML = '';
        proactiveAlert.dataset.kind = items[0]?.kind === 'task' ? 'task' : 'kpi';
        proactiveAlert.dataset.month = Number(snapshot?.month) ? String(snapshot.month) : '';
        updateProactiveKicker();
        proactiveAlert.querySelector('.ai-proactive-alert-text').textContent = formatProactiveTemplate(items);
        proactiveAlert.dataset.prompt = buildProactivePrompt(items, snapshot);
        positionProactiveAlert();
        void proactiveAlert.offsetWidth;
        proactiveAlert.classList.add('show');
        positionProactiveAlert();
        if (proactiveHideTimer) window.clearTimeout(proactiveHideTimer);
        proactiveHideTimer = window.setTimeout(() => hideProactiveAlert(), PROACTIVE_VISIBLE_MS);
        humanizeProactiveAlert(items, activeToken, snapshot);
    }

    async function loadProactiveAlert() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        if (!token) return;
        if (isProactiveSnoozedToday()) {
            scheduleProactiveAlert();
            return;
        }
        if (proactiveLoading || panel.classList.contains('open') || document.hidden) {
            scheduleProactiveAlert();
            return;
        }
        proactiveLoading = true;
        try {
            const response = await fetch('/api/ai/proactive-alerts?limit=200', { headers: getAuthHeaders() });
            if (response.status === 401) {
                // 401 身份过期或未登录，停止主动告警轮询
                return;
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const selected = chooseProactiveItems(data.items);
            if (data.available && selected.length) showProactiveAlert(selected, data.snapshot);
            else scheduleProactiveAlert();
        } catch (_error) {
            scheduleProactiveAlert();
        } finally {
            proactiveLoading = false;
        }
    }

    function setGeneratingState(active) {
        sendBtn.classList.toggle('is-generating', active);
        sendBtn.innerHTML = active ? '<span class="ai-stop-square" aria-hidden="true"></span>' : sendButtonDefaultHtml;
        setActionText(sendBtn, active ? aiT('stop') : aiT('send'));
        sendBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    function shouldFollowStream() {
        return chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 110;
    }

    function createSmoothStreamRenderer(msgDiv) {
        let received = '';
        let visible = '';
        let timer = null;
        msgDiv.classList.add('streaming');

        const paint = () => {
            timer = null;
            const pending = received.length - visible.length;
            if (pending <= 0) return;
            const follow = shouldFollowStream();
            const step = pending > 800 ? 120 : pending > 240 ? 42 : pending > 60 ? 16 : Math.max(1, Math.ceil(pending / 3));
            visible = received.slice(0, visible.length + step);
            msgDiv.innerHTML = renderMarkdownLike(visible) || '&nbsp;';
            if (follow) chatBody.scrollTop = chatBody.scrollHeight;
            if (visible.length < received.length) timer = window.setTimeout(paint, 28);
        };

        return {
            append(delta) {
                received += String(delta || '');
                if (!timer) timer = window.setTimeout(paint, 16);
            },
            finish(finalText) {
                if (timer) window.clearTimeout(timer);
                timer = null;
                received = String(finalText || received);
                visible = received;
                msgDiv.classList.remove('streaming');
                return received;
            },
            current() { return received; }
        };
    }

    function createCompressionStatusHandler(anchorNode) {
        let notice = null;
        return status => {
            if (status?.kind === 'code-analysis-retry') {
                if (!notice) {
                    notice = document.createElement('div');
                    notice.className = 'ai-context-notice';
                    chatBody.insertBefore(notice, anchorNode || typing);
                }
                notice.classList.remove('is-working', 'is-done', 'is-failed');
                notice.classList.add(status.phase === 'done' ? 'is-done' : status.phase === 'failed' ? 'is-failed' : 'is-working');
                notice.textContent = status.phase === 'done'
                    ? (getAiLang() === 'en' ? 'Analysis completed with a smaller code range.' : '已缩减代码范围并完成分析。')
                    : status.phase === 'failed'
                        ? (getAiLang() === 'en' ? 'The AI service still rejected the smaller request.' : '缩减代码后，AI 服务仍拒绝请求。')
                        : getAiLang() === 'en'
                            ? `The AI service rejected the request size. Retrying with ${Math.round(status.limit / 1024)}k characters (${status.attempt}/3)…`
                            : `AI 服务拒绝了请求大小，正缩减为 ${Math.round(status.limit / 1024)}k 字符重试（第 ${status.attempt}/3 次）…`;
                return;
            }
            if (!status || status.kind !== 'context-compression') return;
            if (!notice) {
                notice = document.createElement('div');
                notice.className = 'ai-context-notice';
                chatBody.insertBefore(notice, anchorNode || typing);
            }
            notice.classList.remove('is-working', 'is-done', 'is-failed');
            if (status.phase === 'start') {
                notice.classList.add('is-working');
                notice.textContent = aiT('contextCompressing');
                typing.textContent = aiT('contextCompressing');
                typing.style.display = 'block';
            } else if (status.phase === 'done') {
                notice.classList.add('is-done');
                notice.textContent = aiT('contextCompressed', Number(status.compressedMessages) || 0, Number(status.retainedRecentMessages) || 0);
                typing.textContent = aiT('thinking');
            } else if (status.phase === 'failed') {
                notice.classList.add('is-failed');
                notice.textContent = aiT('contextCompressionFailed');
                typing.textContent = aiT('thinking');
            }
            chatBody.scrollTop = chatBody.scrollHeight;
        };
    }

    function finalizeStreamMessage(msgDiv, text, data = {}) {
        let contentHtml = renderMarkdownLike(text);
        const tokens = Number(data.tokens) || 0;
        const cost = Number(data.cost) || 0;
        if (tokens > 0) {
            cumulativeTokens += tokens;
            cumulativeCost += cost;
            const fmtCost = cost > 0 ? aiT('approxCost', cost.toFixed(4)) : '';
            const fmtTotal = cumulativeCost > 0 ? aiT('totalCost', cumulativeCost.toFixed(3)) : '';
            contentHtml += `<div class="ai-token-usage">${aiT('current')}: ${tokens} ${fmtCost} | ${aiT('total')}: ${cumulativeTokens} ${fmtTotal}</div>`;
        }
        contentHtml += renderGrounding(data.grounding);
        msgDiv.classList.remove('streaming');
        msgDiv.innerHTML = contentHtml;
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    // onEvent：接收 delta/status/done/error 之外的事件（工作区模式的 approval / tool_start / tool_result / change 等）。
    async function requestStreamingChat(payload, { signal, onDelta, onStatus, onEvent }) {
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { ...getAuthHeaders(), Accept: 'application/x-ndjson' },
            body: JSON.stringify({ ...payload, stream: true }),
            signal
        });
        const contentType = String(res.headers.get('content-type') || '');
        if (!res.ok) {
            let message = `${res.status} ${res.statusText}`;
            let errorData = {};
            try {
                errorData = await res.json();
                message = errorData.error || message;
            } catch (_error) {}
            // 带上错误码，调用方可针对性处理（如首页 Skill 缺少工作目录时给出「选择目录」）
            throw Object.assign(new Error(message), { status: res.status, code: errorData.code, details: errorData });
        }
        if (!contentType.includes('application/x-ndjson')) {
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            if (data.conversationCompression?.performed) onStatus?.(data.conversationCompression);
            if (data.reply) onDelta(data.reply);
            return data;
        }
        if (!res.body || typeof res.body.getReader !== 'function') throw new Error('当前浏览器不支持流式响应');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalPayload = null;
        const consumeLine = line => {
            const raw = String(line || '').trim();
            if (!raw) return;
            let event;
            try { event = JSON.parse(raw); } catch (_error) { return; }
            if (event.type === 'delta') onDelta(event.delta || '');
            else if (event.type === 'status') onStatus?.(event.status || {});
            else if (event.type === 'done') finalPayload = event;
            else if (event.type === 'error') throw new Error(event.error || 'AI 流式输出失败');
            else onEvent?.(event);
        };
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            lines.forEach(consumeLine);
            if (done) break;
        }
        if (buffer.trim()) consumeLine(buffer);
        if (!finalPayload) throw new Error('AI 流式连接在完成前中断');
        return finalPayload;
    }

    let suggestionScrollFrame = 0;
    let suggestionScrollPaused = false;
    let suggestionScrollResumeAt = 0;

    function startSuggestionAutoScroll() {
        cancelAnimationFrame(suggestionScrollFrame);
        suggestionsEl.scrollLeft = 0;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        let lastTime = performance.now();
        suggestionScrollResumeAt = lastTime + 1400;
        const step = now => {
            const elapsed = Math.min(50, now - lastTime);
            lastTime = now;
            const maxScroll = Math.max(0, suggestionsEl.scrollWidth - suggestionsEl.clientWidth);
            if (maxScroll > 2 && panel.classList.contains('open') && !suggestionScrollPaused && now >= suggestionScrollResumeAt) {
                if (suggestionsEl.scrollLeft >= maxScroll - 1) {
                    suggestionsEl.scrollTo({ left:0, behavior:'smooth' });
                    suggestionScrollResumeAt = now + 1600;
                } else {
                    suggestionsEl.scrollLeft = Math.min(maxScroll, suggestionsEl.scrollLeft + elapsed * 0.026);
                }
            }
            suggestionScrollFrame = requestAnimationFrame(step);
        };
        suggestionScrollFrame = requestAnimationFrame(step);
    }

    suggestionsEl.addEventListener('pointerenter', () => { suggestionScrollPaused = true; });
    suggestionsEl.addEventListener('pointerleave', () => {
        suggestionScrollPaused = false;
        suggestionScrollResumeAt = performance.now() + 900;
    });
    suggestionsEl.addEventListener('focusin', () => { suggestionScrollPaused = true; });
    suggestionsEl.addEventListener('focusout', () => {
        suggestionScrollPaused = false;
        suggestionScrollResumeAt = performance.now() + 900;
    });
    suggestionsEl.addEventListener('touchstart', () => { suggestionScrollPaused = true; }, { passive:true });
    suggestionsEl.addEventListener('touchend', () => {
        suggestionScrollPaused = false;
        suggestionScrollResumeAt = performance.now() + 1200;
    }, { passive:true });

    async function loadSuggestions() {
        try {
            const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
            const res = await fetch(`/api/ai/suggestions?pagePath=${encodeURIComponent(getPagePath())}&limit=8`, {
                headers: { 'Authorization': token ? ('Bearer ' + token) : '' }
            });
            const data = await res.json();
            const items = (Array.isArray(data.items) ? data.items : [])
                .filter(item => !/^\[object\s+\w+Event\]$/i.test(String(item.question || '').trim()));
            suggestionsEl.innerHTML = items.map(item => {
                const q = escapeHtml(item.question || '');
                return `<button class="ai-suggestion-chip" title="${q}" data-question="${q}">${q}</button>`;
            }).join('');
            suggestionsEl.querySelectorAll('.ai-suggestion-chip').forEach(btn => {
                btn.onclick = () => sendMessage(btn.getAttribute('data-question') || '');
            });
            startSuggestionAutoScroll();
        } catch (e) {
            cancelAnimationFrame(suggestionScrollFrame);
            suggestionsEl.innerHTML = '';
        }
    }

    let archiveLoadSequence = 0;
    function closeArchiveBrowser() {
        archiveOverlay.classList.remove('open', 'loading');
        archiveBtn.focus();
    }

    async function openArchiveBrowser() {
        applyAssistantTheme(assistantTheme);
        archiveOverlay.classList.add('open');
        archiveSearch.value = '';
        archivePreview.innerHTML = `<div class="ai-archive-empty">${escapeHtml(aiT('archiveSelect'))}</div>`;
        await loadArchivedSessions('');
        setTimeout(() => archiveSearch.focus(), 80);
    }

    async function loadArchivedSessions(query = '') {
        const sequence = ++archiveLoadSequence;
        archiveOverlay.classList.add('loading');
        archiveList.innerHTML = `<div class="ai-archive-empty">${escapeHtml(aiT('archiveLoading'))}</div>`;
        archiveCount.textContent = '';
        try {
            const res = await fetch(`/api/ai/sessions-archive?query=${encodeURIComponent(query)}&limit=200`, {
                headers: getAuthHeaders()
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `${res.status}`);
            if (sequence !== archiveLoadSequence) return;
            const items = Array.isArray(data.items) ? data.items : [];
            archiveCount.textContent = aiT('archiveCount', Number(data.total) || items.length);
            if (!items.length) {
                archiveList.innerHTML = `<div class="ai-archive-empty">${escapeHtml(aiT('archiveEmpty'))}</div>`;
                archivePreview.innerHTML = `<div class="ai-archive-empty">${escapeHtml(aiT('archiveEmpty'))}</div>`;
                return;
            }
            archiveList.innerHTML = items.map(item => `
                <button type="button" class="ai-archive-item" data-session-id="${escapeHtml(item.id)}">
                    <div class="ai-archive-item-header">
                        <div class="ai-archive-item-title">${escapeHtml(item.page_title || item.page_path || aiT('unnamed'))}</div>
                        <span class="ai-archive-badge ${item.is_archived ? 'archived' : 'active'}">${escapeHtml(item.is_archived ? aiT('statusArchived') : aiT('statusActive'))}</span>
                    </div>
                    <div class="ai-archive-item-question">${escapeHtml(item.last_question || aiT('unnamed'))}</div>
                    <div class="ai-archive-item-meta">${escapeHtml(`${item.updated_at || item.archived_at || ''} · ${item.message_count || 0} ${aiT('messages')}`)}</div>
                </button>`).join('');
            archiveList.querySelectorAll('.ai-archive-item').forEach((element, index) => {
                element.onclick = () => previewArchivedSession(items[index], element);
            });
            archiveList.querySelector('.ai-archive-item')?.click();
        } catch (error) {
            if (sequence !== archiveLoadSequence) return;
            archiveList.innerHTML = `<div class="ai-archive-empty">⚠️ ${escapeHtml(aiT('archiveFailed') + error.message)}</div>`;
        } finally {
            if (sequence === archiveLoadSequence) archiveOverlay.classList.remove('loading');
        }
    }

    async function previewArchivedSession(session, element) {
        archiveList.querySelectorAll('.ai-archive-item').forEach(item => item.classList.toggle('active', item === element));
        archivePreview.innerHTML = `<div class="ai-archive-empty">${escapeHtml(aiT('archiveLoading'))}</div>`;
        try {
            const res = await fetch(`/api/ai/sessions/${encodeURIComponent(session.id)}/messages`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `${res.status}`);
            const items = Array.isArray(data.items) ? data.items : [];
            const actionText = session.is_archived ? aiT('restoreArchive') : aiT('enterChat');
            archivePreview.innerHTML = `
                <div class="ai-archive-preview-head">
                    <div class="ai-archive-preview-heading">
                        <div class="ai-archive-preview-title">
                            ${escapeHtml(session.page_title || aiT('unnamed'))}
                            <span class="ai-archive-badge ${session.is_archived ? 'archived' : 'active'}" style="margin-left:8px;vertical-align:middle;">${escapeHtml(session.is_archived ? aiT('statusArchived') : aiT('statusActive'))}</span>
                        </div>
                        <div class="ai-archive-preview-path">${escapeHtml(session.page_path || '')}</div>
                    </div>
                    <button type="button" class="ai-archive-restore">${escapeHtml(actionText)}</button>
                </div>
                <div class="ai-archive-messages">${items.map(item => `<div class="ai-archive-message ${item.role === 'model' ? 'ai' : 'user'}">${renderMarkdownLike(item.content || '')}</div>`).join('')}</div>`;
            archivePreview.querySelector('.ai-archive-restore').onclick = event => restoreArchivedSession(session.id, event.currentTarget, Boolean(session.is_archived));
        } catch (error) {
            archivePreview.innerHTML = `<div class="ai-archive-empty">⚠️ ${escapeHtml(aiT('archiveFailed') + error.message)}</div>`;
        }
    }

    async function restoreArchivedSession(sessionId, button, wasArchived = true) {
        button.disabled = true;
        button.textContent = wasArchived ? aiT('restoringArchive') : aiT('enterChat');
        try {
            if (wasArchived) {
                const res = await fetch(`/api/ai/sessions/${encodeURIComponent(sessionId)}/unarchive`, {
                    method: 'POST', headers: getAuthHeaders(), body: '{}'
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `${res.status}`);
            }
            closeArchiveBrowser();
            if (!panel.classList.contains('open')) openOrClosePanel();
            await restoreHistorySession(sessionId);
            await loadHistorySessions();
        } catch (error) {
            button.disabled = false;
            button.textContent = wasArchived ? aiT('restoreArchive') : aiT('enterChat');
            archivePreview.insertAdjacentHTML('beforeend', `<div class="ai-archive-empty">⚠️ ${escapeHtml(aiT('historyRestoreFailed') + error.message)}</div>`);
        }
    }

    async function loadHistorySessions() {
        historyPanel.innerHTML = `<div class="ai-history-meta">${escapeHtml(aiT('historyLoading'))}</div>`;
        try {
            const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
            const res = await fetch(`/api/ai/sessions?pagePath=${encodeURIComponent(getPagePath())}&limit=20`, {
                headers: { 'Authorization': token ? ('Bearer ' + token) : '' }
            });
            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            if (!items.length) {
                historyPanel.innerHTML = `<div class="ai-history-meta">${escapeHtml(aiT('historyEmpty'))}</div>`;
                return;
            }
            historyPanel.innerHTML = items.map(item => {
                const title = escapeHtml(item.last_question || aiT('unnamed'));
                const meta = escapeHtml(`${item.updated_at || ''} · ${item.message_count || 0} ${aiT('messages')}`);
                return `
                    <div class="ai-history-item" data-session-id="${item.id}">
                        <div class="ai-history-title">${title}</div>
                        <div class="ai-history-meta">${meta}</div>
                    </div>
                `;
            }).join('');
            historyPanel.querySelectorAll('.ai-history-item').forEach(item => {
                item.onclick = () => restoreHistorySession(item.getAttribute('data-session-id'));
            });
        } catch (e) {
            historyPanel.innerHTML = `<div class="ai-history-meta">${escapeHtml(aiT('historyFailed') + e.message)}</div>`;
        }
    }

    async function restoreHistorySession(sessionId) {
        if (!sessionId) return;
        try {
            const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
            const res = await fetch(`/api/ai/sessions/${encodeURIComponent(sessionId)}/messages`, {
                headers: { 'Authorization': token ? ('Bearer ' + token) : '' }
            });
            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            currentSessionId = sessionId;
            messages = items.map(item => ({
                role: item.role === 'model' ? 'model' : 'user',
                content: item.content || ''
            }));
            cumulativeTokens = 0;
            cumulativeCost = 0;
            Array.from(chatBody.querySelectorAll('.ai-msg')).forEach(node => node.remove());
            items.forEach(item => appendMessage(
                item.content || '',
                item.role === 'model' ? 'ai' : 'user',
                item.role === 'model' ? Number(item.tokens) || 0 : 0,
                item.role === 'model' ? Number(item.cost) || 0 : 0
            ));
            historyPanel.classList.remove('open');
        } catch (e) {
            appendMessage(`⚠️ ${aiT('historyRestoreFailed')}${e.message}`, 'ai');
        }
    }

    async function initChat() {
        if (activeChatController) return;
        typing.style.display = 'block';
        chatBody.scrollTop = chatBody.scrollHeight;

        const { pageTitle, context } = getPageContext();

        // 隐式发送初始消息，要求总结
        const initPrompt = aiT('initPrompt');
        messages.push({ role: 'user', content: initPrompt });
        const controller = new AbortController();
        activeChatController = controller;
        setGeneratingState(true);
        const initialNode = chatBody.children[0];
        initialNode.innerHTML = '';
        const streamRenderer = createSmoothStreamRenderer(initialNode);

        try {
            const data = await requestStreamingChat({
                messages,
                context,
                pageTitle,
                pagePath: getPagePath(),
                uiLanguage: getAiLang(),
                persist: false
            }, {
                signal: controller.signal,
                onDelta: delta => {
                    if (!delta) return;
                    typing.style.display = 'none';
                    streamRenderer.append(delta);
                }
            });
            const finalText = streamRenderer.finish(data.reply || streamRenderer.current());
            messages.push({ role: 'model', content: finalText });
            finalizeStreamMessage(initialNode, finalText, data);
        } catch (e) {
            const partialText = streamRenderer.finish();
            if (partialText) {
                messages.push({ role: 'model', content: partialText });
                finalizeStreamMessage(initialNode, partialText);
            } else {
                const last = messages[messages.length - 1];
                if (last && last.role === 'user' && last.content === initPrompt) messages.pop();
                initialNode.textContent = e?.name === 'AbortError' ? aiT('welcome') : `⚠️ ${aiT('connectFailed')}${e.message}`;
            }
        } finally {
            typing.style.display = 'none';
            if (activeChatController === controller) activeChatController = null;
            setGeneratingState(false);
        }
    }

    async function sendMessage(presetText, options = {}) {
        if (activeChatController) return;
        const text = String(presetText || input.value || '').trim();
        if (!text) return;
        const displayText = String(options.displayText || text).trim();

        suggestionsEl.classList.add('is-collapsed');
        
        appendMessage(displayText, 'user');
        input.value = '';
        messages.push({ role: 'user', content: text });
        
        typing.style.display = 'block';
        chatBody.scrollTop = chatBody.scrollHeight;
        
        const pageContext = getPageContext();
        const pageTitle = pageContext.pageTitle;
        const context = options.context === undefined ? pageContext.context : String(options.context || '');
        const controller = new AbortController();
        activeChatController = controller;
        setGeneratingState(true);
        const streamMessage = appendMessage('', 'ai');
        const streamRenderer = createSmoothStreamRenderer(streamMessage);
        const handleCompressionStatus = createCompressionStatusHandler(streamMessage);

        try {
            const data = await requestStreamingChat({
                messages,
                context,
                pageTitle,
                pagePath: getPagePath(),
                uiLanguage: getAiLang(),
                sessionId: currentSessionId,
                codeAnalysis: options.codeAnalysis
            }, {
                signal: controller.signal,
                onDelta: delta => {
                    if (!delta) return;
                    typing.style.display = 'none';
                    streamRenderer.append(delta);
                },
                onStatus: handleCompressionStatus
            });

            if (data.sessionId) currentSessionId = data.sessionId;
            if (options.codeAnalysis && data.sessionId) messages[messages.length - 1].content = displayText;
            if (options.codeAnalysis && data.codeAnalysisAttempts > 1) handleCompressionStatus({ kind:'code-analysis-retry', phase:'done' });
            const finalText = streamRenderer.finish(data.reply || streamRenderer.current());
            messages.push({ role: 'model', content: finalText });
            finalizeStreamMessage(streamMessage, finalText, data);
            loadSuggestions();
        } catch (e) {
            if (options.codeAnalysis && /请求限制|request size/i.test(String(e.message || ''))) handleCompressionStatus({ kind:'code-analysis-retry', phase:'failed' });
            const partialText = streamRenderer.finish();
            if (e && e.name === 'AbortError') {
                if (partialText) {
                    messages.push({ role: 'model', content: partialText });
                    finalizeStreamMessage(streamMessage, partialText);
                } else {
                    streamMessage.remove();
                }
            } else {
                if (partialText) {
                    finalizeStreamMessage(streamMessage, `${partialText}\n\n> ⚠️ ${aiT('error')}${e.message}`);
                } else {
                    streamMessage.remove();
                    const last = messages[messages.length - 1];
                    if (last && last.role === 'user' && last.content === text) messages.pop();
                    appendMessage(`⚠️ ${aiT('error')}${e.message}`, 'ai');
                }
            }
        } finally {
            typing.style.display = 'none';
            if (activeChatController === controller) activeChatController = null;
            setGeneratingState(false);
            input.focus();
        }
    }

    sendBtn.onclick = () => {
        if (activeChatController) {
            activeChatController.abort();
            return;
        }
        sendMessage();
    };
    input.addEventListener('input', () => {
        if (input.value.trim()) suggestionsEl.classList.add('is-collapsed');
    });
    input.onkeydown = (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        sendMessage();
    };

    async function openAssistant(options = {}) {
        applyContextTheme();
        panel.classList.add('open');
        fab.setAttribute('aria-expanded', 'true');
        loadSuggestions();
        const prompt = String(options.prompt || '').trim();
        if (prompt) {
            if (isFirstOpen) {
                isFirstOpen = false;
                initialMessage?.remove();
            }
            while (activeChatController) {
                await new Promise(resolve => window.setTimeout(resolve, 100));
            }
            await sendMessage(prompt, { displayText: options.displayText, context: options.context, codeAnalysis: options.codeAnalysis });
        } else if (isFirstOpen) {
            isFirstOpen = false;
            await initChat();
        }
        setTimeout(() => input.focus(), 120);
    }

    window.ToolsAIAssistant = {
        // 供首页 Dragon Claw 复用的渲染与流式请求能力，避免另起一套实现。
        renderMarkdown: renderMarkdownLike,
        renderGrounding,
        requestStreamingChat,
        openKnowledgeGraph,
        open: openAssistant,
        ask(prompt, options = {}) {
            return openAssistant({ ...options, prompt });
        }
    };

    applyContextTheme();
    const pageThemeObserver = new MutationObserver(() => applyContextTheme());
    pageThemeObserver.observe(document.documentElement, { attributes:true, attributeFilter:['class', 'style', 'data-theme', 'data-color-scheme'] });
    pageThemeObserver.observe(document.body, { attributes:true, attributeFilter:['class', 'style', 'data-theme', 'data-color-scheme'] });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyContextTheme);
    scheduleProactiveAlert();
    const proactiveEntryPath = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
    if (PROACTIVE_ENTRY_PATHS.has(proactiveEntryPath)) {
        window.setTimeout(() => loadProactiveAlert(), 700);
    }

})();
