(function () {
    if (window.AIKnowledgeGraph) return;

    const style = document.createElement('style');
    style.textContent = `
        .ai-kg-overlay {
            position: fixed;
            inset: 0;
            z-index: 100200;
            display: none;
            flex-direction: column;
            color: #e8edf8;
            background:
                radial-gradient(circle at 18% 15%, rgba(81,99,211,0.16), transparent 30%),
                radial-gradient(circle at 78% 76%, rgba(117,71,175,0.12), transparent 34%),
                #090e19;
            font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
        }
        .ai-kg-overlay.open { display: flex; }
        body.ai-kg-open { overflow: hidden !important; }
        .ai-kg-header {
            min-height: 66px;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 18px;
            padding: 10px 16px 10px 20px;
            border-bottom: 1px solid rgba(148,163,184,0.15);
            background: rgba(9,14,25,0.8);
            -webkit-backdrop-filter: blur(18px);
            backdrop-filter: blur(18px);
        }
        .ai-kg-brand { min-width: 210px; }
        .ai-kg-title { font-size: 16px; font-weight: 750; letter-spacing: .02em; }
        .ai-kg-subtitle { margin-top: 3px; font-size: 10px; color: #8390aa; }
        .ai-kg-view-switch { display:flex; padding:3px; border-radius:11px; background:rgba(31,40,66,.72); border:1px solid rgba(143,157,207,.16); }
        .ai-kg-view-btn { height:30px; padding:0 10px; border:0; border-radius:8px; background:transparent; color:#8491aa; font-size:11px; cursor:pointer; white-space:nowrap; }
        .ai-kg-view-btn.active { color:#fff; background:linear-gradient(135deg,rgba(83,105,217,.86),rgba(118,83,189,.82)); box-shadow:0 5px 14px rgba(34,43,93,.28); }
        .ai-kg-dimension-switch { display:flex; padding:3px; border-radius:11px; background:rgba(18,25,43,.72); border:1px solid rgba(143,157,207,.16); }
        .ai-kg-dimension-btn { width:36px; height:30px; padding:0; border:0; border-radius:8px; background:transparent; color:#8491aa; font-size:11px; font-weight:750; cursor:pointer; }
        .ai-kg-dimension-btn.active { color:#fff; background:rgba(91,108,204,.62); box-shadow:0 4px 12px rgba(24,31,72,.28); }
        .ai-kg-month-wrap { display:none; align-items:center; gap:6px; color:#8290aa; font-size:10px; white-space:nowrap; }
        .ai-kg-month-wrap.visible { display:flex; }
        .ai-kg-month { height:34px; padding:0 25px 0 9px; border-radius:9px; border:1px solid rgba(143,157,207,.2); outline:none; background:#1a2238; color:#e4e9f5; font-size:11px; }
        .ai-kg-statuses { display: flex; gap: 7px; flex-wrap: wrap; }
        .ai-kg-status {
            padding: 5px 9px;
            border-radius: 999px;
            border: 1px solid rgba(127,141,190,0.2);
            background: rgba(74,86,132,0.16);
            color: #aeb8cf;
            font-size: 11px;
            white-space: nowrap;
        }
        .ai-kg-status strong { color: #f4f6fb; font-weight: 700; }
        .ai-kg-search-wrap { position: relative; flex: 1; max-width: 430px; margin-left: auto; }
        .ai-kg-search {
            width: 100%; height: 38px; box-sizing: border-box;
            padding: 0 76px 0 36px; border-radius: 11px;
            border: 1px solid rgba(143,157,207,.22); outline: none;
            background: rgba(31,40,66,.76); color: #f5f7ff; font-size: 12px;
        }
        .ai-kg-search:focus { border-color: #7081e4; box-shadow: 0 0 0 3px rgba(99,102,241,.14); }
        .ai-kg-search-icon { position:absolute; left:12px; top:10px; color:#7886a4; pointer-events:none; }
        .ai-kg-search-count { position:absolute; right:10px; top:11px; color:#8290ad; font-size:10px; }
        .ai-kg-actions { display:flex; gap:6px; }
        .ai-kg-btn {
            height: 36px; min-width: 36px; padding: 0 10px; border-radius: 10px;
            border: 1px solid rgba(144,158,207,.2); background: rgba(52,63,98,.54);
            color: #dce2f1; cursor: pointer; font-size: 12px;
            display:inline-flex; align-items:center; justify-content:center; line-height:1;
            transition: background .16s, border-color .16s, transform .16s;
        }
        .ai-kg-btn:hover { background: rgba(76,90,141,.65); border-color: rgba(150,163,222,.42); transform: translateY(-1px); }
        .ai-kg-btn.primary { color:#fff; background:linear-gradient(135deg,#5369d9,#7653bd); border-color:transparent; }
        .ai-kg-btn.motion[aria-pressed="true"] { color:#fff; border-color:rgba(125,145,255,.42); background:rgba(82,101,190,.42); }
        .ai-kg-btn.motion[aria-pressed="true"]::before {
            content:""; display:inline-block; width:6px; height:6px; margin-right:6px; border-radius:50%;
            background:#8fa3ff; box-shadow:0 0 10px rgba(143,163,255,.9); vertical-align:1px;
            animation:ai-kg-pulse 1.4s ease-in-out infinite;
        }
        .ai-kg-btn.tour { display:none; }
        .ai-kg-btn.sound { display:none; width:36px; padding:0; font-size:16px; }
        .ai-kg-overlay[data-dimension="3d"] .ai-kg-btn.tour,
        .ai-kg-overlay[data-dimension="3d"] .ai-kg-btn.sound { display:inline-flex; }
        .ai-kg-btn.tour[aria-pressed="true"] {
            color:#fff; border-color:rgba(131,153,255,.48);
            background:linear-gradient(135deg,rgba(69,91,190,.74),rgba(117,72,175,.72));
            box-shadow:0 0 20px rgba(101,116,231,.2);
        }
        @keyframes ai-kg-pulse { 50% { opacity:.42; transform:scale(.76); } }
        .ai-kg-btn.icon { width:36px; padding:0; font-size:17px; }
        .ai-kg-main { position:relative; flex:1; min-height:0; display:flex; }
        .ai-kg-stage { position:relative; flex:1; min-width:0; overflow:hidden; }
        .ai-kg-overlay[data-dimension="3d"] .ai-kg-stage::before {
            content:""; position:absolute; z-index:1; inset:0; pointer-events:none;
            background:
                radial-gradient(circle at 22% 16%, rgba(174,194,255,.09), transparent 29%),
                radial-gradient(ellipse at 52% 56%, transparent 20%, rgba(5,8,18,.18) 68%, rgba(2,4,10,.48) 100%),
                linear-gradient(145deg, rgba(91,112,191,.025), transparent 42%, rgba(0,0,0,.09));
        }
        .ai-kg-overlay[data-dimension="3d"] .ai-kg-stage::after {
            content:""; position:absolute; z-index:1; inset:0; pointer-events:none;
            background:linear-gradient(90deg,rgba(255,255,255,.012) 1px,transparent 1px),linear-gradient(rgba(255,255,255,.01) 1px,transparent 1px);
            background-size:72px 72px; opacity:.18;
            mask-image:radial-gradient(ellipse at center,#000 5%,transparent 72%);
        }
        .ai-kg-canvas { position:relative; z-index:2; width:100%; height:100%; display:block; cursor:grab; touch-action:none; }
        .ai-kg-canvas.dragging { cursor:grabbing; }
        .ai-kg-hint {
            position:absolute; z-index:3; left:18px; bottom:17px; display:flex; gap:7px; flex-wrap:wrap;
            color:#6f7b94; font-size:10px; pointer-events:none;
        }
        .ai-kg-hint span { padding:4px 7px; border-radius:7px; background:rgba(17,24,40,.7); border:1px solid rgba(120,135,180,.12); }
        .ai-kg-legend {
            position:absolute; z-index:3; top:16px; left:18px; display:flex; gap:12px; color:#7f8ba3; font-size:10px;
            padding:8px 10px; border-radius:10px; background:rgba(10,15,27,.72); border:1px solid rgba(126,141,184,.13);
        }
        .ai-kg-legend i { width:7px; height:7px; display:inline-block; border-radius:50%; margin-right:5px; }
        .ai-kg-control-panel {
            position:absolute; z-index:4; top:16px; right:16px; width:292px; max-height:calc(100% - 32px);
            overflow:auto; box-sizing:border-box; padding:14px; border-radius:15px;
            border:1px solid rgba(141,155,202,.2); background:rgba(15,21,35,.94);
            box-shadow:0 22px 58px rgba(0,0,0,.36); backdrop-filter:blur(18px);
            transform:translateX(18px); opacity:0; pointer-events:none;
            transition:transform .2s ease,opacity .18s ease; scrollbar-width:thin;
        }
        .ai-kg-control-panel.open { transform:translateX(0); opacity:1; pointer-events:auto; }
        .ai-kg-control-head { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#eef2fb; font-size:13px; font-weight:720; }
        .ai-kg-control-close { border:0; background:transparent; color:#7f8ca7; font-size:18px; cursor:pointer; }
        .ai-kg-control-section { margin-top:14px; padding-top:12px; border-top:1px solid rgba(124,139,182,.13); }
        .ai-kg-control-section-title { margin-bottom:10px; color:#aeb9d0; font-size:11px; font-weight:700; letter-spacing:.04em; }
        .ai-kg-control-row { display:grid; grid-template-columns:minmax(0,1fr) 42px; gap:8px; align-items:center; margin:9px 0; color:#929fb9; font-size:10px; }
        .ai-kg-control-row input[type="range"] { grid-column:1 / -1; width:100%; accent-color:#806ee8; cursor:pointer; }
        .ai-kg-control-row output { color:#d8def0; text-align:right; font-variant-numeric:tabular-nums; }
        .ai-kg-control-select { grid-column:1 / -1; width:100%; height:34px; padding:0 9px; border-radius:9px; border:1px solid rgba(135,150,198,.2); background:#1b2338; color:#dce3f2; outline:none; font-size:11px; }
        .ai-kg-grow-btn { width:100%; height:38px; margin-top:10px; border:0; border-radius:10px; color:#fff; cursor:pointer; font-size:12px; font-weight:680; background:linear-gradient(135deg,#586fdc,#7d57c3); box-shadow:0 8px 20px rgba(74,76,178,.22); }
        .ai-kg-grow-btn.playing { background:linear-gradient(135deg,#794f98,#515b94); }
        .ai-kg-reset-controls { width:100%; height:32px; margin-top:8px; border-radius:9px; border:1px solid rgba(135,150,198,.18); background:rgba(43,53,83,.46); color:#aeb9d0; cursor:pointer; font-size:10px; }
        .ai-kg-overlay[data-palette="obsidian"] { background:#111; }
        .ai-kg-overlay[data-palette="aurora"] { background:radial-gradient(circle at 18% 18%,rgba(27,141,148,.18),transparent 34%),radial-gradient(circle at 78% 74%,rgba(118,62,168,.2),transparent 38%),#081116; }
        .ai-kg-overlay[data-palette="galaxy"] { background:radial-gradient(circle at 50% 50%,rgba(18,22,48,.5),transparent 60%),radial-gradient(circle at 80% 20%,rgba(45,20,55,.4),transparent 50%),#05050a; }
        .ai-kg-sidebar {
            width: 350px; flex: 0 0 350px; overflow:auto; box-sizing:border-box;
            border-left:1px solid rgba(134,148,189,.14); padding:18px;
            background:rgba(12,18,31,.8); scrollbar-width:thin;
            transition:width .24s ease,flex-basis .24s ease,padding .24s ease,border-color .24s ease,transform .24s ease;
        }
        .ai-kg-main.sidebar-collapsed .ai-kg-sidebar { width:0; flex-basis:0; padding-left:0; padding-right:0; border-left-color:transparent; overflow:hidden; }
        .ai-kg-sidebar-toggle {
            position:absolute; z-index:6; top:50%; right:350px; width:24px; height:54px;
            padding:0; transform:translateY(-50%); border:1px solid rgba(133,149,199,.28);
            border-right:0; border-radius:10px 0 0 10px; color:#9ba8c4;
            background:rgba(19,27,45,.92); box-shadow:-6px 0 18px rgba(0,0,0,.2);
            cursor:pointer; font-size:18px; line-height:1; transition:right .24s ease,background .16s,color .16s;
        }
        .ai-kg-sidebar-toggle:hover { color:#fff; background:rgba(47,59,96,.96); }
        .ai-kg-main.sidebar-collapsed .ai-kg-sidebar-toggle { right:0; }
        .ai-kg-side-empty { color:#758199; font-size:12px; line-height:1.7; padding:20px 4px; }
        .ai-kg-node-type { color:#8491ac; font-size:10px; text-transform:uppercase; letter-spacing:.1em; }
        .ai-kg-node-title { margin-top:6px; color:#f4f6fb; font-size:17px; font-weight:720; word-break:break-word; }
        .ai-kg-node-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-top:6px; }
        .ai-kg-node-heading .ai-kg-node-title { min-width:0; margin-top:0; }
        .ai-kg-node-path { margin-top:7px; color:#8fa0c6; font-size:11px; line-height:1.5; word-break:break-all; }
        .ai-kg-node-stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:15px; }
        .ai-kg-stat-card { padding:10px; border-radius:10px; background:rgba(42,52,81,.46); border:1px solid rgba(120,135,180,.13); }
        .ai-kg-stat-card b { display:block; color:#edf1fb; font-size:15px; }
        .ai-kg-stat-card span { display:block; margin-top:3px; color:#78859e; font-size:10px; }
        .ai-kg-section-title { margin:19px 0 9px; color:#aeb8ce; font-size:11px; font-weight:700; }
        .ai-kg-chunk { margin-bottom:8px; padding:10px; border-radius:10px; background:rgba(31,40,64,.55); border:1px solid rgba(116,130,174,.13); cursor:pointer; }
        .ai-kg-chunk:hover { border-color:rgba(117,134,214,.42); }
        .ai-kg-chunk.answer-citation { border-color:rgba(151,120,255,.4); background:rgba(79,62,139,.26); }
        .ai-kg-chunk-title { color:#dfe5f2; font-size:11px; font-weight:650; }
        .ai-kg-chunk-lines { color:#71809e; font-size:9px; margin-top:3px; }
        .ai-kg-chunk-preview { color:#8e9ab1; font-size:10px; line-height:1.55; margin-top:7px; white-space:pre-wrap; max-height:76px; overflow:hidden; }
        .ai-kg-chunk[data-chunk-detail] { position:relative; }
        .ai-kg-chunk[data-chunk-detail] .ai-kg-chunk-title { padding-right:72px; }
        .ai-kg-chunk[data-chunk-detail]:focus-visible { outline:2px solid rgba(126,145,238,.72); outline-offset:2px; }
        .ai-kg-chunk[data-chunk-detail].expanded .ai-kg-chunk-preview { max-height:none; overflow:visible; color:#b5bfd2; user-select:text; }
        .ai-kg-chunk-toggle { margin-top:7px; color:#8292bf; font-size:9px; text-align:right; }
        .ai-kg-chunk[data-chunk-detail]:hover .ai-kg-chunk-toggle { color:#b8c5ef; }
        .ai-kg-analyze-btn {
            flex:0 0 auto; height:25px; padding:0 8px; border-radius:7px;
            border:1px solid rgba(132,151,235,.3); background:rgba(80,96,177,.2);
            color:#b9c7ff; cursor:pointer; font-size:9px; font-weight:700; white-space:nowrap;
        }
        .ai-kg-analyze-btn:hover { border-color:rgba(153,173,255,.62); background:rgba(91,110,207,.4); color:#fff; }
        .ai-kg-chunk > .ai-kg-analyze-btn { position:absolute; top:8px; right:8px; }
        .ai-kg-rule { margin-top:10px; padding:10px; border-radius:10px; background:rgba(42,52,81,.42); border:1px solid rgba(120,135,180,.14); }
        .ai-kg-rule-main { color:#edf1fb; font-size:13px; font-weight:700; }
        .ai-kg-rule-meta { margin-top:5px; color:#8492ae; font-size:10px; line-height:1.55; }
        .ai-kg-month-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:5px; }
        .ai-kg-month-cell { min-height:38px; padding:6px; box-sizing:border-box; border-radius:8px; background:rgba(31,40,64,.5); border:1px solid rgba(116,130,174,.12); }
        .ai-kg-month-cell.active { border-color:rgba(123,143,238,.5); background:rgba(76,91,169,.3); }
        .ai-kg-month-cell span { display:block; color:#74819a; font-size:8px; }
        .ai-kg-month-cell b { display:block; margin-top:3px; color:#dce3f2; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ai-kg-trend { width:100%; height:126px; display:block; margin-top:4px; border-radius:10px; background:rgba(18,25,43,.56); border:1px solid rgba(116,130,174,.12); }
        .ai-kg-series-legend { display:flex; gap:8px; flex-wrap:wrap; margin-top:7px; color:#8290a9; font-size:9px; }
        .ai-kg-series-legend i { display:inline-block; width:7px; height:7px; margin-right:4px; border-radius:50%; }
        .ai-kg-history-list { margin-top:8px; }
        .ai-kg-history-row { display:grid; grid-template-columns:72px minmax(0,1fr) auto; gap:7px; align-items:center; padding:7px 3px; border-bottom:1px solid rgba(123,137,177,.1); font-size:10px; }
        .ai-kg-history-time { color:#71809b; }
        .ai-kg-history-value { color:#dfe5f2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ai-kg-history-state { padding:2px 5px; border-radius:5px; color:#80d7ad; background:rgba(37,138,96,.14); }
        .ai-kg-history-state.fail { color:#ff9a9a; background:rgba(190,57,72,.14); }
        .ai-kg-history-state.unknown { color:#8290aa; background:rgba(109,122,157,.12); }
        .ai-kg-loading { position:absolute; inset:0; display:grid; place-items:center; background:rgba(9,14,25,.72); z-index:3; }
        .ai-kg-loading-card { padding:14px 18px; border-radius:12px; background:#151d31; border:1px solid #273452; color:#b9c3d8; font-size:12px; box-shadow:0 16px 44px rgba(0,0,0,.25); }
        .ai-kg-loading[hidden] { display:none; }
        @media (max-width: 820px) {
            .ai-kg-header { gap:8px; flex-wrap:wrap; }
            .ai-kg-brand { min-width:170px; }
            .ai-kg-statuses { display:none; }
            .ai-kg-view-switch { margin-left:auto; }
            .ai-kg-month-wrap { order:2; }
            .ai-kg-search-wrap { order:3; max-width:none; flex-basis:100%; }
            .ai-kg-sidebar { position:absolute; right:0; bottom:0; width:min(88vw,350px); height:48%; border-top:1px solid rgba(134,148,189,.14); }
            .ai-kg-sidebar.compact { display:none; }
            .ai-kg-sidebar-toggle { right:min(88vw,350px); }
            .ai-kg-main.sidebar-collapsed .ai-kg-sidebar { width:min(88vw,350px); padding:18px; border-left-color:rgba(134,148,189,.14); transform:translateX(100%); }
            .ai-kg-main.sidebar-collapsed .ai-kg-sidebar-toggle { right:0; }
        }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'ai-kg-overlay';
    overlay.innerHTML = `
        <div class="ai-kg-header">
            <div class="ai-kg-brand">
                <div class="ai-kg-title" id="aiKgTitle">✦ 项目知识关系图谱</div>
                <div class="ai-kg-subtitle" id="aiKgSubtitle">项目 → 模块 → 文件 · 实线为归属，细线为代码依赖</div>
            </div>
            <div class="ai-kg-view-switch" id="aiKgViewSwitch" aria-label="图谱视图">
                <button class="ai-kg-view-btn active" type="button" data-kg-mode="knowledge">项目知识</button>
                <button class="ai-kg-view-btn" type="button" data-kg-mode="metrics">指标体系</button>
            </div>
            <div class="ai-kg-dimension-switch" id="aiKgDimensionSwitch" aria-label="图谱维度">
                <button class="ai-kg-dimension-btn active" type="button" data-kg-dimension="2d" aria-pressed="true">2D</button>
                <button class="ai-kg-dimension-btn" type="button" data-kg-dimension="3d" aria-pressed="false">3D</button>
            </div>
            <label class="ai-kg-month-wrap" id="aiKgMonthWrap">规则月份<select class="ai-kg-month" id="aiKgMonth"></select></label>
            <div class="ai-kg-statuses" id="aiKgStatuses"></div>
            <div class="ai-kg-search-wrap">
                <span class="ai-kg-search-icon">⌕</span>
                <input class="ai-kg-search" id="aiKgSearch" placeholder="搜索 README、接口、报表、AI 助手…">
                <span class="ai-kg-search-count" id="aiKgSearchCount"></span>
            </div>
            <div class="ai-kg-actions">
                <button class="ai-kg-btn" id="aiKgRefresh" title="重建变化的知识文件">刷新知识库</button>
                <button class="ai-kg-btn motion" id="aiKgMotion" type="button" aria-pressed="true" title="开启或暂停力导向仿真">动态仿真</button>
                <button class="ai-kg-btn tour" id="aiKgTour" type="button" aria-pressed="false" title="3D 演示巡航">演示巡航</button>
                <button class="ai-kg-btn sound" id="aiKgSound" type="button" aria-pressed="true" title="关闭巡航音乐" aria-label="关闭巡航音乐">♫</button>
                <button class="ai-kg-btn icon" id="aiKgControls" type="button" aria-pressed="false" title="外观与力度">☷</button>
                <button class="ai-kg-btn icon" id="aiKgFit" title="重置视图">◎</button>
                <button class="ai-kg-btn icon" id="aiKgFullscreen" type="button" aria-pressed="false" title="全屏">⛶</button>
                <button class="ai-kg-btn icon" id="aiKgClose" title="关闭">×</button>
            </div>
        </div>
        <div class="ai-kg-main">
            <div class="ai-kg-stage" id="aiKgStage">
                <canvas class="ai-kg-canvas" id="aiKgCanvas"></canvas>
                <div class="ai-kg-legend" id="aiKgLegend"><span><i style="background:#f5f7ff"></i>项目</span><span><i style="background:#8b9cff"></i>模块</span><span><i style="background:#64739a"></i>知识文件</span></div>
                <div class="ai-kg-control-panel" id="aiKgControlPanel">
                    <div class="ai-kg-control-head"><span data-kg-control-title>外观与力度</span><button class="ai-kg-control-close" type="button" aria-label="关闭">×</button></div>
                    <div class="ai-kg-control-section">
                        <div class="ai-kg-control-section-title" data-kg-appearance-title>外观</div>
                        <label class="ai-kg-control-row"><span data-kg-palette-label>颜色主题</span><select class="ai-kg-control-select" data-setting="palette"><option value="galaxy">银河</option><option value="cosmic">星云</option><option value="obsidian">Obsidian</option><option value="aurora">极光</option></select></label>
                        <label class="ai-kg-control-row"><span data-kg-particle-density-label>背景粒子</span><output data-output="particleDensity"></output><input type="range" min="0" max="1" step="0.05" data-setting="particleDensity"></label>
                        <label class="ai-kg-control-row"><span data-kg-node-size-label>节点大小</span><output data-output="nodeScale"></output><input type="range" min="0.45" max="1.15" step="0.05" data-setting="nodeScale"></label>
                        <label class="ai-kg-control-row"><span data-kg-line-width-label>连线粗细</span><output data-output="lineScale"></output><input type="range" min="0.5" max="2" step="0.1" data-setting="lineScale"></label>
                        <label class="ai-kg-control-row"><span data-kg-label-density-label>标签密度</span><output data-output="labelDensity"></output><input type="range" min="0.3" max="1.5" step="0.1" data-setting="labelDensity"></label>
                        <label class="ai-kg-control-row"><span data-kg-label-opacity-label>文本透明度</span><output data-output="labelOpacity"></output><input type="range" min="0.2" max="1" step="0.05" data-setting="labelOpacity"></label>
                        <label class="ai-kg-control-row"><span data-kg-growth-speed-label>生长速度</span><output data-output="growthSpeed"></output><input type="range" min="0.5" max="2" step="0.1" data-setting="growthSpeed"></label>
                        <button class="ai-kg-grow-btn" id="aiKgGrow" type="button">播放生长动画</button>
                    </div>
                    <div class="ai-kg-control-section">
                        <div class="ai-kg-control-section-title" data-kg-force-title>力度</div>
                        <label class="ai-kg-control-row"><span data-kg-center-label>图谱向心力</span><output data-output="centerForce"></output><input type="range" min="0.2" max="2" step="0.1" data-setting="centerForce"></label>
                        <label class="ai-kg-control-row"><span data-kg-repulsion-label>节点排斥力</span><output data-output="repulsion"></output><input type="range" min="0.3" max="2.5" step="0.1" data-setting="repulsion"></label>
                        <label class="ai-kg-control-row"><span data-kg-attraction-label>相连节点吸引力</span><output data-output="attraction"></output><input type="range" min="0.3" max="2" step="0.1" data-setting="attraction"></label>
                        <label class="ai-kg-control-row"><span data-kg-link-length-label>连线长度</span><output data-output="linkLength"></output><input type="range" min="0.6" max="1.6" step="0.1" data-setting="linkLength"></label>
                        <label class="ai-kg-control-row"><span data-kg-drift-label>漂浮力度</span><output data-output="drift"></output><input type="range" min="0" max="2" step="0.1" data-setting="drift"></label>
                        <button class="ai-kg-reset-controls" id="aiKgResetControls" type="button">恢复默认参数</button>
                    </div>
                </div>
                <div class="ai-kg-hint" id="aiKgHint"><span>拖动画布</span><span>滚轮缩放</span><span>放大显示文件名</span><span>点击节点查看</span><span>拖动节点可拉扯关系</span><span>松手保留惯性</span></div>
                <div class="ai-kg-loading" id="aiKgLoading"><div class="ai-kg-loading-card">正在构建知识关系…</div></div>
            </div>
            <aside class="ai-kg-sidebar" id="aiKgSidebar"><div class="ai-kg-side-empty">点击图谱中的模块或文件，可查看索引时间、知识片段和文件关系。</div></aside>
            <button class="ai-kg-sidebar-toggle" id="aiKgSidebarToggle" type="button" aria-expanded="true">›</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('#aiKgCanvas');
    const main = overlay.querySelector('.ai-kg-main');
    const stage = overlay.querySelector('#aiKgStage');
    const sidebar = overlay.querySelector('#aiKgSidebar');
    const sidebarToggle = overlay.querySelector('#aiKgSidebarToggle');
    const loading = overlay.querySelector('#aiKgLoading');
    const statuses = overlay.querySelector('#aiKgStatuses');
    const searchInput = overlay.querySelector('#aiKgSearch');
    const searchCount = overlay.querySelector('#aiKgSearchCount');
    const titleEl = overlay.querySelector('#aiKgTitle');
    const subtitleEl = overlay.querySelector('#aiKgSubtitle');
    const legendEl = overlay.querySelector('#aiKgLegend');
    const monthWrap = overlay.querySelector('#aiKgMonthWrap');
    const monthSelect = overlay.querySelector('#aiKgMonth');
    const refreshButton = overlay.querySelector('#aiKgRefresh');
    const motionButton = overlay.querySelector('#aiKgMotion');
    const tourButton = overlay.querySelector('#aiKgTour');
    const soundButton = overlay.querySelector('#aiKgSound');
    const controlsButton = overlay.querySelector('#aiKgControls');
    const fullscreenButton = overlay.querySelector('#aiKgFullscreen');
    const controlPanel = overlay.querySelector('#aiKgControlPanel');
    const growButton = overlay.querySelector('#aiKgGrow');
    const ctx = canvas.getContext('2d');
    const DEFAULT_SETTINGS = Object.freeze({ palette:'galaxy', particleDensity:.2, nodeScale:0.72, lineScale:1, labelDensity:1, labelOpacity:1, growthSpeed:1, centerForce:1, repulsion:1, attraction:1, linkLength:1, drift:1 });
    function loadSettings() {
        try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('ai_kg_preferences') || '{}') }; }
        catch (_error) { return { ...DEFAULT_SETTINGS }; }
    }
    function loadSidebarCollapsed() {
        try { return localStorage.getItem('ai_kg_sidebar_collapsed') === '1'; }
        catch (_error) { return false; }
    }
    function loadPreferredMode() {
        try {
            const mode = localStorage.getItem('ai_kg_preferred_mode');
            return ['knowledge', 'metrics'].includes(mode) ? mode : 'knowledge';
        } catch (_error) { return 'knowledge'; }
    }
    function loadTourMuted() {
        try { return localStorage.getItem('ai_kg_tour_muted') === '1'; }
        catch (_error) { return false; }
    }
    const preferredMode = loadPreferredMode();
    const state = {
        data: null,
        mode: preferredMode,
        preferredMode,
        dimension: '2d',
        month: null,
        nodes: [],
        nodeMap: new Map(),
        edges: [],
        width: 1,
        height: 1,
        dpr: 1,
        scale: 0.82,
        panX: 0,
        panY: 0,
        cameraYaw: -0.55,
        cameraPitch: 0.34,
        cameraDistance: 920,
        orbitTargetId: null,
        orbitPivot: { x:0, y:0, z:0 },
        orbitTransition: null,
        cameraTransition: null,
        sidebarCollapsed: loadSidebarCollapsed(),
        hovered: null,
        hoverCandidate: null,
        hoverTimer: 0,
        hoverIntensity: 0,
        hoverTransition: null,
        selected: null,
        pointer: null,
        running: false,
        motionEnabled: true,
        alpha: 1,
        alphaTarget: 0.035,
        lastFrameTime: 0,
        loadSequence: 0,
        searchMatches: new Set(),
        answerFocus: null,
        pendingFocus: null,
        flatPositions: new Map(),
        settings: loadSettings(),
        stars: [],
        hasFailingMetricAlerts: false,
        tour: { active:false, index:0, nextAt:0, nodeIds:[], muted:loadTourMuted() },
        sidebarDocument: null,
        growth: { active:false, startedAt:0, duration:0, nodeOrder:new Map() }
    };
    const TOUR_AUDIO_VOLUME = 0.16;
    const SPACE_PARTICLE_THEMES = Object.freeze({
        galaxy: { stride:1, spin:.0003, drift:12, alpha:1.05, size:1.12, colors:[[255,255,255],[179,203,255],[222,190,255]], shape:'star' },
        cosmic: { stride:1, spin:.00017, drift:52, alpha:1.12, size:1.72, colors:[[186,126,255],[102,187,255],[255,119,190]], shape:'dust' },
        obsidian: { stride:2, spin:.00008, drift:12, alpha:.82, size:1.25, colors:[[238,244,255],[139,158,194],[190,215,255]], shape:'shard' },
        aurora: { stride:1, spin:.00011, drift:64, alpha:.9, size:1.28, colors:[[82,255,204],[91,197,255],[192,123,255]], shape:'aurora' }
    });
    const tourAudio = new Audio('./tp-static/frontend/assets/audio/bgm/pulsebox-lofi-production-522875.mp3');
    tourAudio.loop = true;
    tourAudio.preload = 'auto';
    tourAudio.volume = 0;
    let tourAudioFadeFrame = 0;
    let tourAudioFadeToken = 0;

    const KG_TEXT = {
        zh: {
            view: '图谱视图', knowledge: '项目知识', metrics: '指标体系', ruleMonth: '规则月份', refreshKnowledge: '刷新知识库', refreshMetrics: '刷新指标',
            refreshKnowledgeTitle: '重建变化的知识文件', refreshMetricsTitle: '重新读取指标规则与历史快照', motion: '动态仿真', motionPaused: '仿真已暂停', motionTitle: '开启或暂停力导向仿真', tour: '演示巡航', tourStop: '停止巡航', tourTitle: '自动巡航重要节点，任意操作即停止', soundOnTitle: '关闭巡航音乐', soundOffTitle: '开启巡航音乐', fit: '重置视图', fullscreen: '全屏', exitFullscreen: '退出全屏', sidebarCollapse: '收起详情栏', sidebarExpand: '展开详情栏', close: '关闭',
            knowledgeTitle: '✦ 项目知识关系图谱', metricTitle: '◈ 运营指标体系图谱', knowledgeSubtitle: '项目 → 模块 / 工具 / 数据库 → 文件 / 表 · 细线为代码、查询和资源依赖', metricSubtitle: '月份规则 → 指标分类 → 指标 → 子指标 · 点击查看每日最新历史值',
            searchKnowledge: '搜索 README、工具、数据库表、接口、AI 助手…', searchMetrics: '搜索分类、指标、子指标…',
            hints: ['拖动画布','滚轮缩放','放大显示文件名','点击节点查看','点击空白取消高亮','拖动节点可拉扯关系'],
            hints3d: ['左键拖动空白处旋转','点击节点镜头聚焦','双击设为旋转中心','按住滚轮拖动平移','滚轮缩放','手动操作停止巡航'],
            dimension: '图谱维度',
            project: '项目', module: '模块', knowledgeFile: '知识文件', toolData: '工具/数据资产', monthRules: '月份规则', category: '指标分类', metric: '指标', submetric: '子指标',
            files: '文件', chunks: '片段', dependencies: '依赖', recentUpdated: '最近更新', tools: '工具', databases: '数据库', tables: '数据表', tableRelations: '表关系', snapshots: '历史日期',
            loadingKnowledge: '正在读取项目知识库…', loadingMetrics: '正在读取指标规则与历史快照…', refreshLoading: '正在刷新…', count: n => `${n} 个`, unknown: '未知',
            rootType: '项目根节点', businessModules: '业务模块', codeDependencies: '代码依赖', assetFiles: '资产文件', builtInTools: '自带工具', customTools: '自定义工具',
            assetCategory: '资产分类', htmlTool: 'HTML 工具', database: '数据库', table: '数据表', toolFile: '工具目录文件', related: '关联节点', contained: '下级节点', fileSize: '文件大小', updatedAt: '更新时间', publicAccess: '公开访问', yes: '是', no: '否', columns: '字段', schema: '表结构',
            empty: '点击图谱中的模块、工具、文件、数据库或表，可查看详细关系。', moduleFiles: '模块文件', indexTime: '索引时间', viewChunks: '可点击查看的知识片段', readingFile: '正在读取文件节点', unnamedChunk: '未命名片段', expandChunk: '展开全文', collapseChunk: '收起详情', aiAnalyze: 'AI 分析', analyzeFile: '分析代码文件', analyzeChunk: '分析代码片段', answerSources: '本次回答引用路径', citedChunk: '引用片段', citedFiles: '引用文件', answerMetrics: '本次回答引用指标', referencedMetrics: '个引用指标',
            metricRootType: '指标体系根节点', dataMethod: '数据口径', categoryMetrics: '分类指标', weight: '权重', latest: '最新', valuedDays: '个有值日期', twelveMonthRules: '12个月规则', dailyLatestHistory: '历史有值日期（每日最新）', loadingSavedHistory: '正在读取已保存历史值…', standardScoring: '标准计分', proportionalScoring: '比例计分', noValue: '无值', failing: '未达标', passing: '达标', undetermined: '未判定', noSavedHistory: '这个月份还没有已保存的历史录入快照。', nonNumericHistory: '历史值不是连续数值，已在下方按快照列出。', noRule: '当前指标尚未配置月份目标规则。', bySubmetric: '分子指标', metricHelp: '点击分类、指标或子指标，可查看月份规则和历史录入快照。', metricHistoryRule: '历史值按有值日期读取 ReportMetricData 每天最后一次已保存入库；当前月份规则只用于展示，不重算历史结果。', metricHistoryLoadFailed: '历史快照读取失败', historyTrend: '历史快照趋势', monthRule: n => `${n}月规则`, monthLabel: n => `${n}月`, rootMetricRule: n => `${n}月指标规则`,
            graphLoadFailed: '知识图谱加载失败', metricLoadFailed: '指标图谱加载失败', refreshFailed: '刷新失败',
            controls: '外观与力度', appearance: '外观', force: '力度', palette: '颜色主题', galaxy: '银河', cosmic: '星云', obsidian: 'Obsidian', aurora: '极光', particleDensity: '背景粒子', nodeSize: '节点大小', lineWidth: '连线粗细', labelDensity: '标签密度', labelOpacity: '文本透明度', growthSpeed: '生长速度', playGrowth: '播放生长动画', stopGrowth: '停止动画', centerForce: '图谱向心力', repulsion: '节点排斥力', attraction: '相连节点吸引力', linkLength: '连线长度', drift: '漂浮力度', resetControls: '恢复默认参数'
        },
        en: {
            view: 'Graph view', knowledge: 'Project Knowledge', metrics: 'Metric System', ruleMonth: 'Rule month', refreshKnowledge: 'Refresh Knowledge', refreshMetrics: 'Refresh Metrics',
            refreshKnowledgeTitle: 'Re-index changed knowledge files', refreshMetricsTitle: 'Reload metric rules and snapshots', motion: 'Live Simulation', motionPaused: 'Simulation Paused', motionTitle: 'Start or pause force simulation', tour: 'Guided Tour', tourStop: 'Stop Tour', tourTitle: 'Automatically tour important nodes; any interaction stops it', soundOnTitle: 'Mute tour music', soundOffTitle: 'Play tour music', fit: 'Reset view', fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', sidebarCollapse: 'Collapse details', sidebarExpand: 'Expand details', close: 'Close',
            knowledgeTitle: '✦ Project Knowledge Graph', metricTitle: '◈ Operations Metric Graph', knowledgeSubtitle: 'Project → modules / tools / databases → files / tables · thin lines show code, query, and asset dependencies', metricSubtitle: 'Monthly rules → categories → metrics → submetrics · click to inspect historical values',
            searchKnowledge: 'Search README, tools, database tables, APIs, AI assistant…', searchMetrics: 'Search categories, metrics, submetrics…',
            hints: ['Drag canvas','Wheel to zoom','Zoom in for filenames','Click a node for details','Click empty space to clear focus','Drag nodes to pull relations'],
            hints3d: ['Left-drag empty space to orbit','Click a node to focus camera','Double-click to set orbit center','Middle-drag to pan','Wheel to zoom','Manual input stops the tour'],
            dimension: 'Graph dimension',
            project: 'Project', module: 'Module', knowledgeFile: 'Knowledge File', toolData: 'Tool/Data Asset', monthRules: 'Monthly Rules', category: 'Metric Category', metric: 'Metric', submetric: 'Submetric',
            files: 'files', chunks: 'chunks', dependencies: 'dependencies', recentUpdated: 'Recently updated', tools: 'tools', databases: 'databases', tables: 'tables', tableRelations: 'table relations', snapshots: 'history days',
            loadingKnowledge: 'Loading project knowledge…', loadingMetrics: 'Loading metric rules and snapshots…', refreshLoading: 'Refreshing…', count: n => `${n}`, unknown: 'Unknown',
            rootType: 'Project Root', businessModules: 'Business Modules', codeDependencies: 'Code Dependencies', assetFiles: 'asset files', builtInTools: 'built-in tools', customTools: 'custom tools',
            assetCategory: 'Asset Category', htmlTool: 'HTML Tool', database: 'Database', table: 'Table', toolFile: 'Tool Directory File', related: 'Related Nodes', contained: 'Child Nodes', fileSize: 'File Size', updatedAt: 'Updated', publicAccess: 'Public Access', yes: 'Yes', no: 'No', columns: 'Columns', schema: 'Table Schema',
            empty: 'Click a module, tool, file, database, or table to inspect its relationships.', moduleFiles: 'Module Files', indexTime: 'Indexed At', viewChunks: 'Indexed Knowledge Chunks', readingFile: 'Loading File Node', unnamedChunk: 'Untitled Chunk', expandChunk: 'Expand full text', collapseChunk: 'Collapse details', aiAnalyze: 'AI Analyze', analyzeFile: 'Analyze code file', analyzeChunk: 'Analyze code chunk', answerSources: 'Sources used by this answer', citedChunk: 'Cited chunk', citedFiles: 'cited files', answerMetrics: 'Metrics used by this answer', referencedMetrics: 'referenced metrics',
            metricRootType: 'Metric System Root', dataMethod: 'Data Methodology', categoryMetrics: 'Category Metrics', weight: 'Weight', latest: 'Latest', valuedDays: 'valued days', twelveMonthRules: '12-Month Rules', dailyLatestHistory: 'Historical Values (Latest Saved per Day)', loadingSavedHistory: 'Loading saved historical values…', standardScoring: 'Standard Scoring', proportionalScoring: 'Proportional Scoring', noValue: 'No Value', failing: 'Below Target', passing: 'On Target', undetermined: 'Undetermined', noSavedHistory: 'No saved historical snapshots are available for this month.', nonNumericHistory: 'Historical values are not a continuous numeric series; snapshots are listed below.', noRule: 'No monthly target rule is configured for this metric.', bySubmetric: 'By Submetric', metricHelp: 'Click a category, metric, or submetric to inspect monthly rules and historical snapshots.', metricHistoryRule: 'Historical values use the last saved ReportMetricData entry for each day with data. Current monthly rules are display-only and do not recalculate historical results.', metricHistoryLoadFailed: 'Failed to load historical snapshots', historyTrend: 'Historical Snapshot Trend', monthRule: n => `Month ${n} rule`, monthLabel: n => `Month ${n}`, rootMetricRule: n => `Month ${n} Metric Rules`,
            graphLoadFailed: 'Failed to load the knowledge graph', metricLoadFailed: 'Failed to load the metric graph', refreshFailed: 'Refresh failed',
            controls: 'Appearance & Forces', appearance: 'Appearance', force: 'Forces', palette: 'Color Theme', galaxy: 'Galaxy', cosmic: 'Cosmic', obsidian: 'Obsidian', aurora: 'Aurora', particleDensity: 'Background Particles', nodeSize: 'Node Size', lineWidth: 'Line Width', labelDensity: 'Label Density', labelOpacity: 'Text Opacity', growthSpeed: 'Growth Speed', playGrowth: 'Play Growth Animation', stopGrowth: 'Stop Animation', centerForce: 'Center Force', repulsion: 'Node Repulsion', attraction: 'Linked Attraction', linkLength: 'Link Length', drift: 'Drift Force', resetControls: 'Reset Defaults'
        }
    };
    function kgLang() {
        const raw = window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || document.documentElement.lang || 'zh-CN';
        return String(raw).toLowerCase().startsWith('en') ? 'en' : 'zh';
    }
    function kgT(key, ...args) {
        const value = KG_TEXT[kgLang()][key] ?? KG_TEXT.zh[key] ?? key;
        return typeof value === 'function' ? value(...args) : value;
    }
    function nodeLabel(node) { return kgLang() === 'en' && node?.labelEn ? node.labelEn : (node?.label || ''); }
    function nodeDescription(node) { return kgLang() === 'en' && node?.descriptionEn ? node.descriptionEn : (node?.description || ''); }
    function metricText(value) {
        const text = String(value ?? '');
        if (kgLang() !== 'en') return text;
        return state.data?.translations?.[text] || text;
    }

    function saveSettings() {
        try { localStorage.setItem('ai_kg_preferences', JSON.stringify(state.settings)); } catch (_error) {}
    }

    function syncControlPanel() {
        overlay.dataset.palette = state.settings.palette;
        controlPanel.querySelectorAll('[data-setting]').forEach(input => {
            input.value = state.settings[input.dataset.setting];
        });
        controlPanel.querySelectorAll('[data-output]').forEach(output => {
            const value = Number(state.settings[output.dataset.output]);
            output.textContent = Number.isFinite(value)
                ? output.dataset.output === 'particleDensity' ? `${Math.round(value * 100)}%` : value.toFixed(value % 1 ? 1 : 0)
                : '';
        });
    }

    function authHeaders(extra = {}) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return { ...extra, 'Authorization': token ? `Bearer ${token}` : '' };
    }

    async function readJsonResponse(response, fallbackMessage) {
        const body = await response.text();
        let data;
        try {
            data = body ? JSON.parse(body) : {};
        } catch (_error) {
            const receivedHtml = /^\s*</.test(body);
            throw new Error(receivedHtml
                ? `${fallbackMessage}：后端尚未加载完整代码接口，请重启 Tools Platform 服务后重试`
                : `${fallbackMessage}：服务器返回了无法识别的响应`);
        }
        if (!response.ok) throw new Error(data.error || `${fallbackMessage} (${response.status})`);
        return data;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderAnalyzeButton(scope, chunkIndex = '') {
        const title = kgT(scope === 'file' ? 'analyzeFile' : 'analyzeChunk');
        return `<button type="button" class="ai-kg-analyze-btn" data-ai-analyze="${scope}"${scope === 'chunk' ? ` data-chunk-index="${escapeHtml(chunkIndex)}"` : ''} title="${escapeHtml(title)}">✦ ${escapeHtml(kgT('aiAnalyze'))}</button>`;
    }

    function renderKnowledgeChunk(chunk, documentPath, { citation = false } = {}) {
        return `<div class="ai-kg-chunk${citation ? ' answer-citation' : ''}" data-chunk-detail role="button" tabindex="0" aria-expanded="false">${renderAnalyzeButton('chunk', chunk.chunk_index)}<div class="ai-kg-chunk-title">${escapeHtml(chunk.title || kgT('unnamedChunk'))}</div><div class="ai-kg-chunk-lines">${escapeHtml(documentPath)}:${chunk.start_line}-${chunk.end_line}</div><div class="ai-kg-chunk-preview">${escapeHtml(chunk.content)}</div><div class="ai-kg-chunk-toggle">${escapeHtml(kgT('expandChunk'))}</div></div>`;
    }

    function colorForGroup(group, alpha = 1) {
        let hash = 0;
        for (const char of String(group || 'other')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        const palette = state.settings.palette;
        if (palette === 'obsidian') return `hsla(0, 0%, ${52 + Math.abs(hash) % 28}%, ${alpha})`;
        if (palette === 'galaxy') return `hsla(${((Math.abs(hash) % 160) + 220) % 360}, 85%, 72%, ${alpha})`;
        const hue = palette === 'aurora'
            ? ((Math.abs(hash) % 155) + 128) % 360
            : ((Math.abs(hash) % 170) + 205) % 360;
        return `hsla(${hue}, ${palette === 'aurora' ? 70 : 64}%, ${palette === 'aurora' ? 62 : 67}%, ${alpha})`;
    }

    function accentColor(alpha = 1) {
        if (state.settings.palette === 'obsidian') return `rgba(226,226,226,${alpha})`;
        if (state.settings.palette === 'aurora') return `rgba(57,218,188,${alpha})`;
        if (state.settings.palette === 'galaxy') return `rgba(168,135,255,${alpha})`;
        return `rgba(139,92,246,${alpha})`;
    }

    function formatBytes(value) {
        const bytes = Number(value) || 0;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function formatTime(value) {
        if (!value) return kgT('unknown');
        const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('T') ? '' : 'Z'));
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(kgLang() === 'en' ? 'en-US' : 'zh-CN');
    }

    function isRootNode(node) {
        return node?.type === 'root' || node?.type === 'metricRoot';
    }

    function isGroupNode(node) {
        return node?.type === 'group' || node?.type === 'metricCategory';
    }

    function isLeafNode(node) {
        return ['document', 'citation', 'submetric', 'assetFile', 'table'].includes(node?.type);
    }

    function isMetricMode() {
        return state.mode === 'metrics';
    }

    function formatRuleTarget(rule, category = '') {
        if (!rule) return kgLang() === 'en' ? 'Not configured' : '未配置';
        const categoryValue = category ? rule.categoryTargets?.[String(state.month)]?.[category] : undefined;
        const value = categoryValue ?? rule.monthTarget;
        if (value === null || value === undefined || value === '') return category
            ? (kgLang() === 'en' ? 'Not configured' : '未配置')
            : (kgLang() === 'en' ? 'Configured by submetric' : '按子指标配置');
        const sign = rule.condition === 'lte' ? '≤' : '≥';
        const suffix = rule.isPercent && !String(value).includes('%') ? '%' : '';
        return `${sign} ${value}${suffix}`;
    }

    function setLoading(text, visible = true) {
        loading.hidden = !visible;
        loading.querySelector('.ai-kg-loading-card').textContent = text;
    }

    function showError(message) {
        setLoading('', false);
        sidebar.innerHTML = `<div class="ai-kg-side-empty">⚠️ ${escapeHtml(message)}</div>`;
    }

    function renderStatuses(data) {
        if (data.mode === 'metrics') {
            statuses.innerHTML = `
                <span class="ai-kg-status"><strong>${Number(data.stats?.categories) || 0}</strong> ${kgT('category')}</span>
                <span class="ai-kg-status"><strong>${Number(data.stats?.metrics) || 0}</strong> ${kgT('metric')}</span>
                <span class="ai-kg-status"><strong>${Number(data.stats?.subMetrics) || 0}</strong> ${kgT('submetric')}</span>
                <span class="ai-kg-status"><strong>${Number(data.stats?.snapshots) || 0}</strong> ${kgT('snapshots')}</span>
                <span class="ai-kg-status">${kgLang() === 'en' ? `Month ${Number(data.month) || '-'}` : `${Number(data.month) || '-'} 月规则`}</span>
            `;
            return;
        }
        const refresh = data.status?.lastRefresh;
        const changed = refresh ? Number(refresh.indexedFiles) || 0 : 0;
        statuses.innerHTML = `
            <span class="ai-kg-status"><strong>${Number(data.stats?.documents) || 0}</strong> ${kgT('files')}</span>
            <span class="ai-kg-status"><strong>${Number(data.stats?.chunks) || 0}</strong> ${kgT('chunks')}</span>
            <span class="ai-kg-status"><strong>${Number(data.stats?.builtInTools || 0) + Number(data.stats?.customTools || 0)}</strong> ${kgT('tools')}</span>
            <span class="ai-kg-status"><strong>${Number(data.stats?.databases) || 0}</strong> ${kgT('databases')}</span>
            <span class="ai-kg-status"><strong>${Number(data.stats?.tables) || 0}</strong> ${kgT('tables')}</span>
            <span class="ai-kg-status"><strong>${Number(data.stats?.tableRelations) || 0}</strong> ${kgT('tableRelations')}</span>
            <span class="ai-kg-status">${kgT('recentUpdated')} <strong>${changed}</strong> ${kgT('files')}</span>
            <span class="ai-kg-status">${escapeHtml(formatTime(data.status?.lastIndexedAt))}</span>
        `;
    }

    function initializeLayout(data) {
        state.data = data;
        state.nodes = data.nodes.map(item => ({
            ...item,
            x: 0,
            y: 0,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            motionPhase: [...String(item.id || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 0.73
        }));
        state.nodeMap = new Map(state.nodes.map(item => [item.id, item]));
        state.hasFailingMetricAlerts = state.nodes.some(node => node.isFailing === true);
        state.edges = data.edges.map(edge => ({ ...edge, sourceNode: state.nodeMap.get(edge.source), targetNode: state.nodeMap.get(edge.target) }))
            .filter(edge => edge.sourceNode && edge.targetNode);
        const placeDescendants = (parent, baseAngle, depth = 1, visited = new Set()) => {
            if (depth > 3 || visited.has(parent.id)) return;
            visited.add(parent.id);
            const children = state.edges.filter(edge => edge.type === 'contains' && edge.source === parent.id).map(edge => edge.targetNode).filter(Boolean);
            const ringSize = parent.type === 'tool' || parent.type === 'database' ? 14 : 9;
            children.forEach((child, index) => {
                const ring = Math.floor(index / ringSize);
                const slot = index % ringSize;
                const count = Math.min(ringSize, children.length - ring * ringSize || 1);
                const angle = baseAngle + Math.PI * 2 * slot / count;
                const radius = 58 + ring * 34 + depth * 13;
                child.x = parent.x + Math.cos(angle) * radius;
                child.y = parent.y + Math.sin(angle) * radius;
                child.z = parent.z + Math.sin(angle * 1.7 + child.motionPhase) * (32 + depth * 8);
                placeDescendants(child, angle, depth + 1, visited);
            });
        };
        const groups = state.nodes.filter(isGroupNode);
        groups.forEach((group, groupIndex) => {
            const angle = (Math.PI * 2 * groupIndex / Math.max(1, groups.length)) - Math.PI / 2;
            const groupRadiusX = isMetricMode() ? 330 : 285;
            const groupRadiusY = isMetricMode() ? 270 : 235;
            group.x = Math.cos(angle) * groupRadiusX;
            group.y = Math.sin(angle) * groupRadiusY;
            group.z = Math.sin(angle * 2 + group.motionPhase * 0.08) * (isMetricMode() ? 150 : 125);
            const children = state.edges
                .filter(edge => edge.source === group.id)
                .map(edge => edge.targetNode)
                .filter(Boolean);
            children.forEach((child, childIndex) => {
                const ringSize = isMetricMode() ? 9 : 12;
                const ring = Math.floor(childIndex / ringSize);
                const slot = childIndex % ringSize;
                const countInRing = Math.min(ringSize, children.length - ring * ringSize || 1);
                const localAngle = angle + (Math.PI * 2 * slot / countInRing);
                const radius = (isMetricMode() ? 94 : 74) + ring * (isMetricMode() ? 56 : 42);
                child.x = group.x + Math.cos(localAngle) * radius;
                child.y = group.y + Math.sin(localAngle) * radius;
                child.z = group.z + Math.sin(localAngle * 1.45 + child.motionPhase) * (isMetricMode() ? 82 : 68);
                if (child.type === 'metric') {
                    const subMetrics = state.edges
                        .filter(edge => edge.source === child.id)
                        .map(edge => edge.targetNode)
                        .filter(Boolean);
                    subMetrics.forEach((subMetric, subIndex) => {
                        const subAngle = localAngle + (Math.PI * 2 * subIndex / Math.max(1, subMetrics.length));
                        const subRadius = 48 + Math.floor(subIndex / 8) * 24;
                        subMetric.x = child.x + Math.cos(subAngle) * subRadius;
                        subMetric.y = child.y + Math.sin(subAngle) * subRadius;
                        subMetric.z = child.z + Math.sin(subAngle * 1.8 + subMetric.motionPhase) * 44;
                    });
                } else if (!isMetricMode()) {
                    placeDescendants(child, localAngle, 1, new Set());
                }
            });
        });
        const root = state.nodeMap.get(isMetricMode() ? 'metric-root' : 'root');
        if (root) { root.x = 0; root.y = 0; root.z = 0; root.fixed = true; }
        const hierarchyLevel = new Map();
        if (root) hierarchyLevel.set(root.id, 0);
        let frontier = root ? [root.id] : [];
        while (frontier.length) {
            const next = [];
            frontier.forEach(parentId => {
                const level = hierarchyLevel.get(parentId) || 0;
                state.edges.forEach(edge => {
                    if (edge.type !== 'contains' || edge.source !== parentId || hierarchyLevel.has(edge.target)) return;
                    hierarchyLevel.set(edge.target, level + 1);
                    next.push(edge.target);
                });
            });
            frontier = next;
        }
        const layerSpacing = isMetricMode() ? 118 : 104;
        state.nodes.forEach(node => {
            const fallbackLevel = isRootNode(node) ? 0 : isGroupNode(node) ? 1 : ['metric','tool','database','document'].includes(node.type) ? 2 : 3;
            node.hierarchyLevel = Math.min(4, hierarchyLevel.get(node.id) ?? fallbackLevel);
            node.layerZ = node.hierarchyLevel === 0 ? 0 : (node.hierarchyLevel - 1.15) * layerSpacing;
            if (!isRootNode(node)) node.z = node.layerZ + node.z * 0.32;
        });
        state.flatPositions = new Map(state.nodes.map(node => [node.id, { x:node.x, y:node.y }]));
        state.stars = Array.from({ length: 680 }, () => ({
            x: (Math.random() - 0.5) * 4200,
            y: (Math.random() - 0.5) * 4200,
            z: (Math.random() - 0.5) * 4200,
            size: Math.random() * 2.4 + 0.7,
            alpha: Math.random() * 0.73 + 0.22,
            phase: Math.random() * Math.PI * 2,
            layer: Math.random(),
            colorIndex: Math.floor(Math.random() * 3)
        }));
        state.alpha = 1;
        state.running = state.motionEnabled;
        resetView();
        scheduleFrame();
    }

    function resize() {
        const rect = stage.getBoundingClientRect();
        state.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        state.width = Math.max(1, rect.width);
        state.height = Math.max(1, rect.height);
        canvas.width = Math.round(state.width * state.dpr);
        canvas.height = Math.round(state.height * state.dpr);
        canvas.style.width = `${state.width}px`;
        canvas.style.height = `${state.height}px`;
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        render();
    }

    function resetView() {
        const contentWidth = isMetricMode() ? 1340 : 1080;
        const contentHeight = isMetricMode() ? 900 : 760;
        state.scale = Math.max(0.32, Math.min(1, Math.min(state.width / contentWidth, state.height / contentHeight)));
        state.panX = 0;
        state.panY = 0;
        state.cameraYaw = -0.55;
        state.cameraPitch = 0.34;
        state.orbitTargetId = null;
        state.orbitPivot = { x:0, y:0, z:0 };
        state.orbitTransition = null;
        state.cameraTransition = null;
        stopTour({ keepView:true });
        render();
    }

    function nodePhysicsRadius(node) {
        const scale = state.settings.nodeScale / DEFAULT_SETTINGS.nodeScale;
        if (isRootNode(node)) return 29 * scale;
        if (isGroupNode(node)) return Math.max(14, (Number(node.size || 12) * 0.78 + 9) * scale);
        if (node.type === 'metric') return Math.max(10, (Number(node.size || 10) * 0.78 + 5) * scale);
        return Math.max(4.5, (Number(node.size || 5) * 0.76 + 2.5) * scale);
    }

    function reheat(amount = 0.55) {
        if (!state.motionEnabled) return;
        state.alpha = Math.max(state.alpha, amount);
        state.running = true;
        scheduleFrame();
    }

    function simulate(elapsed = 1) {
        const nodes = state.nodes;
        const alpha = state.alpha;
        const time = performance.now();
        for (const edge of state.edges) {
            const a = edge.sourceNode;
            const b = edge.targetNode;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = state.dimension === '3d' ? b.z - a.z : 0;
            const distance = Math.max(1, Math.hypot(dx, dy, dz));
            const desiredBase = edge.type === 'citation'
                ? 42
                : edge.type === 'contains'
                ? (isRootNode(a) ? (isMetricMode() ? 305 : 250) : a.type === 'metricCategory' ? 112 : a.type === 'metric' ? 56 : a.type === 'tool' || a.type === 'database' ? 72 : a.type === 'assetCategory' ? 108 : 86)
                : 145;
            const desired = desiredBase * state.settings.linkLength;
            const strength = (edge.type === 'citation' ? 0.02 : edge.type === 'contains' ? 0.014 : 0.0022) * state.settings.attraction;
            const force = (distance - desired) * strength * alpha * elapsed;
            const fx = dx / distance * force;
            const fy = dy / distance * force;
            const fz = dz / distance * force;
            if (!a.fixed) { a.vx += fx; a.vy += fy; if (state.dimension === '3d') a.vz += fz; }
            if (!b.fixed) { b.vx -= fx; b.vy -= fy; if (state.dimension === '3d') b.vz -= fz; }
        }
        for (let i = 0; i < nodes.length; i += 1) {
            const a = nodes[i];
            for (let j = i + 1; j < nodes.length; j += 1) {
                const b = nodes[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dz = state.dimension === '3d' ? b.z - a.z : 0;
                const distanceSq = dx * dx + dy * dy + dz * dz + 0.01;
                if (distanceSq > (state.dimension === '3d' ? 40000 : 25600)) continue;
                const distance = Math.sqrt(distanceSq);
                const minDistance = nodePhysicsRadius(a) + nodePhysicsRadius(b) + (isLeafNode(a) && isLeafNode(b) ? 3 : 8);
                const overlap = Math.max(0, minDistance - distance);
                const repel = ((isGroupNode(a) || isGroupNode(b) ? 120 : a.type === 'metric' || b.type === 'metric' ? 72 : 38) / distanceSq) * alpha * state.settings.repulsion;
                const collision = overlap * 0.075 * alpha;
                const fx = dx / distance * (repel + collision) * elapsed;
                const fy = dy / distance * (repel + collision) * elapsed;
                const fz = dz / distance * (repel + collision) * elapsed;
                if (!a.fixed) { a.vx -= fx; a.vy -= fy; if (state.dimension === '3d') a.vz -= fz; }
                if (!b.fixed) { b.vx += fx; b.vy += fy; if (state.dimension === '3d') b.vz += fz; }
            }
        }
        for (const node of nodes) {
            if (node.fixed || node.dragging) continue;
            node.vx += -node.x * 0.000045 * state.settings.centerForce * alpha * elapsed;
            node.vy += -node.y * 0.000045 * state.settings.centerForce * alpha * elapsed;
            if (state.dimension === '3d') node.vz += -node.z * 0.000045 * state.settings.centerForce * alpha * elapsed;
            if (state.dimension === '3d' && Number.isFinite(node.layerZ)) {
                node.vz += (node.layerZ - node.z) * 0.00022 * state.settings.centerForce * Math.max(.22, alpha) * elapsed;
            }
            if (state.motionEnabled && isLeafNode(node)) {
                const phase = Number(node.motionPhase || 0);
                node.vx += Math.sin(time * 0.00072 + phase) * 0.002 * state.settings.drift * elapsed;
                node.vy += Math.cos(time * 0.00061 + phase * 1.37) * 0.002 * state.settings.drift * elapsed;
                if (state.dimension === '3d') node.vz += Math.sin(time * 0.00053 + phase * 0.91) * 0.002 * state.settings.drift * elapsed;
            }
            const damping = Math.pow(0.89, elapsed);
            node.vx *= damping;
            node.vy *= damping;
            node.vz *= damping;
            node.x += node.vx * elapsed;
            node.y += node.vy * elapsed;
            if (state.dimension === '3d') node.z += node.vz * elapsed;
        }
        state.alpha += (state.alphaTarget - state.alpha) * 0.035 * elapsed;
    }

    function worldToScreen(node) {
        if (state.dimension === '3d') {
            const cosYaw = Math.cos(state.cameraYaw);
            const sinYaw = Math.sin(state.cameraYaw);
            const cosPitch = Math.cos(state.cameraPitch);
            const sinPitch = Math.sin(state.cameraPitch);
            const relativeX = node.x - state.orbitPivot.x;
            const relativeY = node.y - state.orbitPivot.y;
            const relativeZ = node.z - state.orbitPivot.z;
            const rotatedX = relativeX * cosYaw - relativeZ * sinYaw;
            const yawDepth = relativeX * sinYaw + relativeZ * cosYaw;
            const rotatedY = relativeY * cosPitch - yawDepth * sinPitch;
            const depth = relativeY * sinPitch + yawDepth * cosPitch;
            const cameraDepth = state.cameraDistance + depth;
            const perspective = Math.max(0.42, Math.min(1.8, state.cameraDistance / Math.max(1, cameraDepth)));
            return {
                x: state.width / 2 + state.panX + rotatedX * state.scale * perspective,
                y: state.height / 2 + state.panY + rotatedY * state.scale * perspective,
                depth,
                perspective,
                visible: cameraDepth > 0
            };
        }
        return {
            x: state.width / 2 + state.panX + node.x * state.scale,
            y: state.height / 2 + state.panY + node.y * state.scale,
            depth: 0,
            perspective: 1,
            visible: true
        };
    }

    function screenNodeRadius(node, point = worldToScreen(node), minimum = 1.5) {
        return Math.max(minimum, Number(node.size || 5) * Math.sqrt(state.scale) * state.settings.nodeScale * (point.perspective || 1));
    }

    function screenDeltaToWorld(node, screenDx, screenDy) {
        if (state.dimension !== '3d') {
            return { x:screenDx / state.scale, y:screenDy / state.scale, z:0 };
        }
        const projection = worldToScreen(node);
        const projectionScale = Math.max(.001, state.scale * (projection.perspective || 1));
        const cameraX = screenDx / projectionScale;
        const cameraY = screenDy / projectionScale;
        const cosYaw = Math.cos(state.cameraYaw);
        const sinYaw = Math.sin(state.cameraYaw);
        const cosPitch = Math.cos(state.cameraPitch);
        const sinPitch = Math.sin(state.cameraPitch);
        const yawDepth = -sinPitch * cameraY;
        return {
            x: cosYaw * cameraX + sinYaw * yawDepth,
            y: cosPitch * cameraY,
            z: -sinYaw * cameraX + cosYaw * yawDepth
        };
    }

    function nodeBaseColor(node, alpha = 1) {
        if (isRootNode(node)) return state.settings.palette === 'galaxy' ? `rgba(255,255,255,${alpha})` : `rgba(247,248,255,${alpha})`;
        if (node?.type === 'citation') return accentColor(Math.min(alpha, 0.98));
        if (isGroupNode(node)) return colorForGroup(node.group, alpha);
        if (node.type === 'metric') return colorForGroup(node.group, Math.min(alpha, 0.96));
        return colorForGroup(node.group, Math.min(alpha, 0.78));
    }

    function drawLitSphere(node, point, radius, emphasized) {
        const sphereRadius = Math.max(.08, radius + (emphasized ? 1.25 : 0));

        if (state.settings.palette === 'galaxy') {
            ctx.save();
            const root = isRootNode(node);
            const glowMultiplier = root
                ? (emphasized ? 2.15 : 1.7)
                : (emphasized ? 2.55 : 1.9);
            const glowSize = sphereRadius * glowMultiplier;
            const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, glowSize);
            gradient.addColorStop(0, `rgba(255,255,255,${root ? 0.68 : 0.82})`);
            gradient.addColorStop(0.14, nodeBaseColor(node, root ? 0.58 : 0.68));
            gradient.addColorStop(0.42, nodeBaseColor(node, emphasized ? 0.28 : 0.13));
            gradient.addColorStop(1, 'transparent');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(point.x, point.y, glowSize, 0, Math.PI * 2);
            ctx.fill();

            if ((isRootNode(node) || isGroupNode(node)) && sphereRadius > 3) {
                ctx.beginPath();
                ctx.ellipse(point.x, point.y, sphereRadius * 2.2, sphereRadius * 0.6, -0.3, 0, Math.PI * 2);
                ctx.strokeStyle = nodeBaseColor(node, emphasized ? 0.7 : 0.25);
                ctx.lineWidth = 1 * state.scale;
                ctx.stroke();
            }
            ctx.restore();
            return;
        }

        const lightX = point.x - sphereRadius * 0.34;
        const lightY = point.y - sphereRadius * 0.38;

        ctx.save();
        if (emphasized) {
            ctx.shadowColor = nodeBaseColor(node, .72);
            ctx.shadowBlur = Math.max(8, sphereRadius * 1.35);
        }
        ctx.beginPath();
        ctx.arc(point.x, point.y, sphereRadius, 0, Math.PI * 2);
        ctx.fillStyle = nodeBaseColor(node, .96);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(point.x, point.y, sphereRadius, 0, Math.PI * 2);
        ctx.clip();

        const diffuse = ctx.createRadialGradient(
            lightX, lightY, Math.max(.2, sphereRadius * .04),
            lightX, lightY, sphereRadius * 2.05
        );
        diffuse.addColorStop(0, 'rgba(255,255,255,.46)');
        diffuse.addColorStop(.24, 'rgba(255,255,255,.18)');
        diffuse.addColorStop(.48, 'rgba(255,255,255,0)');
        diffuse.addColorStop(.76, 'rgba(4,8,18,.14)');
        diffuse.addColorStop(1, 'rgba(2,5,12,.42)');
        ctx.fillStyle = diffuse;
        ctx.fillRect(point.x - sphereRadius, point.y - sphereRadius, sphereRadius * 2, sphereRadius * 2);

        const ambientBounce = ctx.createLinearGradient(point.x, point.y, point.x, point.y + sphereRadius);
        ambientBounce.addColorStop(0, 'rgba(104,129,202,0)');
        ambientBounce.addColorStop(1, 'rgba(104,129,202,.13)');
        ctx.fillStyle = ambientBounce;
        ctx.fillRect(point.x - sphereRadius, point.y, sphereRadius * 2, sphereRadius);

        if (sphereRadius >= 4) {
            ctx.fillStyle = 'rgba(255,255,255,.34)';
            ctx.beginPath();
            ctx.ellipse(
                point.x - sphereRadius * .3,
                point.y - sphereRadius * .34,
                sphereRadius * .12,
                sphereRadius * .065,
                -.55, 0, Math.PI * 2
            );
            ctx.fill();
        }
        ctx.restore();

        if (sphereRadius > .72) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(point.x, point.y, sphereRadius - .3, .72 * Math.PI, 1.7 * Math.PI);
            ctx.lineWidth = Math.max(.45, sphereRadius * .055);
            ctx.strokeStyle = 'rgba(224,233,255,.2)';
            ctx.stroke();
            ctx.restore();
        }
    }

    function shortenFileLabel(value, limit) {
        const label = String(value || '未命名文件');
        if (label.length <= limit) return label;
        const dotIndex = label.lastIndexOf('.');
        const extension = dotIndex > 0 && label.length - dotIndex <= 8 ? label.slice(dotIndex) : '';
        const headLength = Math.max(6, limit - extension.length - 1);
        return `${label.slice(0, headLength)}…${extension}`;
    }

    function labelsOverlap(a, b) {
        return a.left < b.right + 4 && a.right + 4 > b.left && a.top < b.bottom + 3 && a.bottom + 3 > b.top;
    }

    function roundedRectPath(x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function prepareGrowthOrder() {
        const rootId = isMetricMode() ? 'metric-root' : 'root';
        const depth = new Map([[rootId, 0]]);
        const queue = [rootId];
        while (queue.length) {
            const source = queue.shift();
            const nextDepth = (depth.get(source) || 0) + 1;
            state.edges
                .filter(edge => edge.type === 'contains' && edge.source === source)
                .map(edge => edge.target)
                .sort()
                .forEach(target => {
                    if (depth.has(target)) return;
                    depth.set(target, nextDepth);
                    queue.push(target);
                });
        }
        const ordered = [...state.nodes].sort((a, b) => {
            const depthDelta = (depth.get(a.id) ?? 99) - (depth.get(b.id) ?? 99);
            if (depthDelta) return depthDelta;
            const tierDelta = nodeLabelTier(a) - nodeLabelTier(b);
            if (tierDelta) return tierDelta;
            return String(nodeLabel(a)).localeCompare(String(nodeLabel(b)));
        });
        return new Map(ordered.map((node, index) => [node.id, index]));
    }

    function setGrowthButtonState() {
        growButton.textContent = state.growth.active ? kgT('stopGrowth') : kgT('playGrowth');
        growButton.classList.toggle('playing', state.growth.active);
    }

    function startGrowthAnimation() {
        if (!state.nodes.length) return;
        if (state.growth.active) {
            state.growth.active = false;
            setGrowthButtonState();
            render();
            return;
        }
        state.selected = null;
        clearHoverIntent({ immediate: true });
        state.growth = {
            active: true,
            startedAt: performance.now(),
            duration: Math.min(12000, Math.max(4200, state.nodes.length * 28)) / state.settings.growthSpeed,
            nodeOrder: prepareGrowthOrder()
        };
        resetView();
        reheat(0.92);
        state.running = true;
        setGrowthButtonState();
        scheduleFrame();
    }

    function growthNodeProgress(node, now = performance.now()) {
        if (!state.growth.active) return 1;
        const order = state.growth.nodeOrder.get(node.id) ?? state.nodes.length;
        const total = Math.max(1, state.nodes.length - 1);
        const start = order / total * state.growth.duration * 0.82;
        const enterDuration = Math.max(160, Math.min(420, state.growth.duration * 0.08));
        return Math.max(0, Math.min(1, (now - state.growth.startedAt - start) / enterDuration));
    }

    function growthEdgeProgress(edge, now = performance.now()) {
        if (!state.growth.active) return 1;
        const sourceOrder = state.growth.nodeOrder.get(edge.source) ?? 0;
        const targetOrder = state.growth.nodeOrder.get(edge.target) ?? 0;
        const total = Math.max(1, state.nodes.length - 1);
        const start = Math.max(sourceOrder, targetOrder) / total * state.growth.duration * 0.82 + (edge.type === 'contains' ? 30 : 110);
        const drawDuration = edge.type === 'contains' ? 260 : 340;
        const progress = Math.max(0, Math.min(1, (now - state.growth.startedAt - start) / drawDuration));
        return 1 - Math.pow(1 - progress, 3);
    }

    function growthNodeScale(progress) {
        if (progress <= 0 || progress >= 1) return progress;
        const c1 = 1.28;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2);
    }

    function nodeLabelTier(node) {
        if (isRootNode(node)) return 0;
        if (isGroupNode(node) || node?.type === 'assetCategory') return 1;
        if (['metric', 'tool', 'database'].includes(node?.type)) return 2;
        return 3;
    }

    function selectedContainsNode(node) {
        if (!state.selected || !node || state.selected.id === node.id) return false;
        const visited = new Set([node.id]);
        let frontier = [node.id];
        while (frontier.length) {
            const parents = [];
            for (const childId of frontier) {
                for (const edge of state.edges) {
                    if (edge.type !== 'contains' || edge.target !== childId || visited.has(edge.source)) continue;
                    if (edge.source === state.selected.id) return true;
                    visited.add(edge.source);
                    parents.push(edge.source);
                }
            }
            frontier = parents;
        }
        return false;
    }

    function hoverIntentDelay(node) {
        const tier = nodeLabelTier(node);
        if (tier === 0) return 70;
        if (tier === 1) return 105;
        if (tier === 2) return selectedContainsNode(node) ? 115 : 165;
        return selectedContainsNode(node) ? 150 : 310;
    }

    function beginHoverTransition(target, duration) {
        state.hoverTransition = {
            from: state.hoverIntensity,
            to: target,
            startedAt: performance.now(),
            duration
        };
        scheduleFrame();
    }

    function updateHoverTransition(now) {
        const transition = state.hoverTransition;
        if (!transition) return;
        const raw = Math.max(0, Math.min(1, (now - transition.startedAt) / transition.duration));
        const eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        state.hoverIntensity = transition.from + (transition.to - transition.from) * eased;
        if (raw < 1) return;
        state.hoverIntensity = transition.to;
        state.hoverTransition = null;
        if (transition.to === 0) state.hovered = null;
    }

    function clearHoverIntent({ immediate = false } = {}) {
        if (state.hoverTimer) window.clearTimeout(state.hoverTimer);
        state.hoverTimer = 0;
        state.hoverCandidate = null;
        if (immediate) {
            state.hovered = null;
            state.hoverIntensity = 0;
            state.hoverTransition = null;
            return;
        }
        if (state.hovered) beginHoverTransition(0, 240);
    }

    function queueHoverIntent(node) {
        if (!node) {
            if (!state.hoverCandidate && !state.hovered) return;
            if (state.hoverTimer) window.clearTimeout(state.hoverTimer);
            state.hoverTimer = 0;
            state.hoverCandidate = null;
            if (state.hovered && state.hoverTransition?.to !== 0) beginHoverTransition(0, 240);
            return;
        }
        if (node.id === state.selected?.id) {
            if (state.hoverTimer) window.clearTimeout(state.hoverTimer);
            state.hoverTimer = 0;
            state.hoverCandidate = null;
            if (state.hovered?.id === node.id) {
                state.hovered = null;
                state.hoverIntensity = 0;
                state.hoverTransition = null;
                render();
            } else if (state.hovered && state.hoverTransition?.to !== 0) {
                beginHoverTransition(0, 150);
            }
            return;
        }
        if (node.id === state.hovered?.id) {
            if (state.hoverTimer) window.clearTimeout(state.hoverTimer);
            state.hoverTimer = 0;
            state.hoverCandidate = node;
            if (state.hoverTransition?.to === 0) beginHoverTransition(1, 150);
            return;
        }
        if (node.id === state.hoverCandidate?.id) return;
        if (state.hoverTimer) window.clearTimeout(state.hoverTimer);
        state.hoverTimer = 0;
        state.hoverCandidate = node;
        const delay = state.selected ? Math.min(180, hoverIntentDelay(node)) : hoverIntentDelay(node);
        if (state.hovered) beginHoverTransition(0, Math.max(70, Math.min(150, delay)));
        const candidateId = node.id;
        state.hoverTimer = window.setTimeout(() => {
            state.hoverTimer = 0;
            if (state.hoverCandidate?.id !== candidateId || state.pointer) return;
            state.hoverIntensity = 0;
            state.hoverTransition = null;
            state.hovered = node;
            beginHoverTransition(1, 180);
        }, delay);
    }

    function renderHierarchyLabels(highlighted, focusNode, focusStrength, selectedNextLevel) {
        const hasFocus = Boolean(focusNode || state.answerFocus);
        const zoomThreshold = [0, 0.42, 0.92, 1.42];
        const maxLabels = Math.round((state.scale < 0.7 ? 12 : state.scale < 1.05 ? 20 : state.scale < 1.45 ? 38 : state.scale < 2 ? 72 : 120) * state.settings.labelDensity);
        const now = performance.now();
        const candidates = state.nodes.map(node => {
            const tier = nodeLabelTier(node);
            const isNextLevel = selectedNextLevel.has(node.id);
            const forced = node.id === focusNode?.id || state.searchMatches.has(node.id) || isNextLevel || Boolean(state.answerFocus?.nodeIds.has(node.id));
            const visibleByFocus = highlighted.has(node.id) && (tier <= 2 || state.scale >= 1.1);
            const priority = (node.id === focusNode?.id ? 50000 : 0)
                + (isNextLevel ? 42000 : 0)
                + (highlighted.has(node.id) ? 30000 : 0)
                + (state.searchMatches.has(node.id) ? 24000 : 0)
                + (tier === 0 ? 16000 : tier === 1 ? 9000 : tier === 2 ? 3500 : 0)
                + Number(node.size || 0);
            return { node, tier, forced, isNextLevel, visibleByFocus, priority, point: worldToScreen(node), growthProgress: growthNodeProgress(node, now) };
        })
            .filter(item => item.growthProgress >= 0.82)
            .filter(item => item.point.x > -100 && item.point.x < state.width + 100 && item.point.y > -50 && item.point.y < state.height + 50)
            .filter(item => hasFocus
                ? item.forced || item.visibleByFocus
                : item.forced || state.scale >= zoomThreshold[item.tier])
            .sort((a, b) => b.priority - a.priority);
        const occupied = state.nodes.filter(node => growthNodeProgress(node, now) > 0.2).map(node => {
            const point = worldToScreen(node);
            const radius = screenNodeRadius(node, point, 2.2);
            return { nodeId: node.id, left: point.x - radius - 2, right: point.x + radius + 2, top: point.y - radius - 2, bottom: point.y + radius + 2 };
        });
        const charLimit = state.scale >= 2 ? 34 : state.scale >= 1.45 ? 24 : state.scale >= 1 ? 18 : 15;
        let rendered = 0;
        for (const { node, tier, forced, isNextLevel, point } of candidates) {
            if (rendered >= maxLabels && !forced) continue;
            const label = shortenFileLabel(nodeLabel(node), tier <= 1 ? Math.max(20, charLimit) : charLimit);
            const fontSize = tier === 0 ? 12 : tier === 1 ? 10 : 9;
            const fontWeight = tier <= 1 || node.id === focusNode?.id || isNextLevel ? 650 : 450;
            ctx.font = `${fontWeight} ${fontSize}px system-ui`;
            const pill = tier >= 2;
            const width = Math.ceil(ctx.measureText(label).width) + (pill ? 12 : 4);
            const height = pill ? 18 : 16;
            const radius = screenNodeRadius(node, point, 2.2);
            const placements = [
                { x: point.x - width / 2, y: point.y + radius + 5 },
                { x: point.x + radius + 5, y: point.y - height / 2 },
                { x: point.x - radius - width - 5, y: point.y - height / 2 },
                { x: point.x - width / 2, y: point.y - radius - height - 5 },
                { x: point.x + radius + 4, y: point.y + radius + 2 },
                { x: point.x - radius - width - 4, y: point.y + radius + 2 },
                { x: point.x + radius + 4, y: point.y - radius - height - 2 },
                { x: point.x - radius - width - 4, y: point.y - radius - height - 2 }
            ];
            const inBounds = item => item.x >= 4 && item.x + width <= state.width - 4 && item.y >= 4 && item.y + height <= state.height - 4;
            const placement = placements.find(item => {
                const rect = { left: item.x, right: item.x + width, top: item.y, bottom: item.y + height };
                return inBounds(item) && !occupied.some(other => other.nodeId !== node.id && labelsOverlap(rect, other));
            }) || (forced ? placements.find(inBounds) : null);
            if (!placement) continue;
            const rect = { nodeId: `label:${node.id}`, left: placement.x, right: placement.x + width, top: placement.y, bottom: placement.y + height };
            occupied.push(rect);
            const dimmed = hasFocus && !highlighted.has(node.id);
            const normalAlpha = forced ? 1 : tier === 3 ? 0.72 : 0.9;
            const dimmedLabelAlpha = state.answerFocus ? .035 : (1 - .88 * focusStrength);
            ctx.globalAlpha = (dimmed ? normalAlpha * dimmedLabelAlpha : normalAlpha) * state.settings.labelOpacity;
            if (pill) {
                roundedRectPath(placement.x, placement.y, width, height, 6);
                ctx.fillStyle = node.id === focusNode?.id ? 'rgba(72,54,130,.94)' : 'rgba(10,16,29,.82)';
                ctx.fill();
                ctx.strokeStyle = node.id === focusNode?.id ? 'rgba(156,112,255,.85)' : colorForGroup(node.group, .24);
                ctx.lineWidth = node.id === focusNode?.id ? 1 : 0.65;
                ctx.stroke();
            }
            ctx.fillStyle = '#e8edf8';
            ctx.shadowColor = 'rgba(4,8,18,.9)';
            ctx.shadowBlur = pill ? 0 : 4;
            ctx.textAlign = pill ? 'left' : 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, pill ? placement.x + 6 : placement.x + width / 2, placement.y + height / 2 + 0.5);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            rendered += 1;
        }
        ctx.textBaseline = 'alphabetic';
    }

    function shouldAnimateMetricAlerts() {
        return isMetricMode()
            && state.hasFailingMetricAlerts
            && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    }

    function drawFailingMetricHalo(node, point, radius, now) {
        const phase = Number(node.motionPhase || 0) * 0.17;
        const pulse = shouldAnimateMetricAlerts() ? 0.5 + Math.sin(now * 0.0022 + phase) * 0.5 : 0.5;
        const strength = node.type === 'metric' ? 1 : 0.68;
        const innerRadius = Math.max(1, radius * 1.04);
        const outerRadius = Math.max(innerRadius + 6, radius * (2.18 + pulse * 0.46) + 5);
        const gradient = ctx.createRadialGradient(point.x, point.y, innerRadius, point.x, point.y, outerRadius);
        gradient.addColorStop(0, `rgba(255,126,158,${(0.2 + pulse * 0.07) * strength})`);
        gradient.addColorStop(0.5, `rgba(231,87,140,${(0.11 + pulse * 0.045) * strength})`);
        gradient.addColorStop(1, 'rgba(190,55,120,0)');
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(point.x, point.y, outerRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawSpaceParticles(now) {
        if (state.dimension !== '3d') return;
        const particleDensity = Math.max(0, Math.min(1, Number(state.settings.particleDensity) || 0));
        if (!particleDensity) return;
        const profile = SPACE_PARTICLE_THEMES[state.settings.palette] || SPACE_PARTICLE_THEMES.cosmic;
        const particleLimit = Math.ceil(state.stars.length * particleDensity);
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const motionTime = reduceMotion ? 0 : now;
        ctx.save();
        ctx.lineCap = 'round';
        for (let index = 0; index < particleLimit; index += profile.stride) {
            const star = state.stars[index];
            const layer = .35 + star.layer * .85;
            const drift = reduceMotion ? 0 : profile.drift * layer;
            const spin = motionTime * profile.spin * (.58 + star.layer * .72) + star.phase * .025;
            const floatingX = star.x + Math.sin(motionTime * .00013 + star.phase) * drift;
            const floatingY = star.y + Math.cos(motionTime * .00009 + star.phase * 1.7) * drift * (profile.shape === 'aurora' ? 1.15 : .72);
            const floatingZ = star.z + Math.sin(motionTime * .00007 + star.phase * 2.1) * drift * .8;
            const rotatedX = floatingX * Math.cos(spin) - floatingZ * Math.sin(spin);
            const rotatedZ = floatingX * Math.sin(spin) + floatingZ * Math.cos(spin);
            const projected = worldToScreen({ x:rotatedX, y:floatingY, z:rotatedZ });
            if (!projected.visible || projected.x <= -12 || projected.x >= state.width + 12 || projected.y <= -12 || projected.y >= state.height + 12) continue;
            const twinkle = .56 + .44 * Math.sin(motionTime * (.0014 + star.layer * .0012) + star.phase);
            const depth = Math.max(.18, Math.min(1.25, projected.perspective * 1.35));
            const alpha = star.alpha * profile.alpha * twinkle * depth;
            const radius = Math.max(.28, star.size * profile.size * projected.perspective * Math.sqrt(state.scale));
            const [red, green, blue] = profile.colors[star.colorIndex % profile.colors.length];
            ctx.globalAlpha = alpha;
            ctx.fillStyle = `rgb(${red},${green},${blue})`;
            ctx.strokeStyle = `rgba(${red},${green},${blue},${Math.min(1, alpha * 1.45)})`;
            ctx.shadowColor = `rgba(${red},${green},${blue},.65)`;
            ctx.shadowBlur = index % 7 === 0 ? (profile.shape === 'dust' ? 9 : 5) * depth : 0;
            if (profile.shape === 'shard') {
                ctx.beginPath();
                ctx.moveTo(projected.x, projected.y - radius * 1.8);
                ctx.lineTo(projected.x + radius * .72, projected.y);
                ctx.lineTo(projected.x, projected.y + radius * 1.8);
                ctx.lineTo(projected.x - radius * .72, projected.y);
                ctx.closePath();
                ctx.fill();
            } else if (profile.shape === 'aurora') {
                const bloomRadius = radius * (2.15 + star.layer * 1.35);
                const stretchX = 1.04 + Math.sin(star.phase * 1.7) * .2;
                const stretchY = .74 + Math.cos(star.phase * 1.3) * .14;
                const focusX = Math.sin(star.phase * 2.4) * radius * .42;
                const focusY = Math.cos(star.phase * 1.9) * radius * .34;
                ctx.save();
                ctx.globalAlpha = 1;
                ctx.shadowBlur = 0;
                ctx.translate(projected.x, projected.y);
                ctx.rotate(star.phase * .73);
                ctx.scale(stretchX, stretchY);
                const glow = ctx.createRadialGradient(focusX, focusY, 0, 0, 0, bloomRadius);
                glow.addColorStop(0, `rgba(225,255,248,${Math.min(.92, alpha * .92)})`);
                glow.addColorStop(.1, `rgba(${red},${green},${blue},${Math.min(.78, alpha * .72)})`);
                glow.addColorStop(.38, `rgba(${red},${green},${blue},${alpha * .24})`);
                glow.addColorStop(.72, `rgba(${red},${green},${blue},${alpha * .055})`);
                glow.addColorStop(1, `rgba(${red},${green},${blue},0)`);
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(0, 0, bloomRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else {
                ctx.beginPath();
                ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
                ctx.fill();
                if (profile.shape === 'dust' && index % 9 === 0) {
                    ctx.globalAlpha = alpha * .2;
                    ctx.beginPath();
                    ctx.arc(projected.x, projected.y, radius * 4.2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }

    function render() {
        ctx.clearRect(0, 0, state.width, state.height);
        if (!state.nodes.length) return;
        const now = performance.now();
        const hoverStrength = state.hovered ? state.hoverIntensity : 0;
        const focusNode = hoverStrength > 0.015 ? state.hovered : state.selected;
        const answerFocus = !focusNode ? state.answerFocus : null;
        const hasFocus = Boolean(focusNode || answerFocus);
        const focusStrength = focusNode === state.hovered ? hoverStrength : (hasFocus ? 1 : 0);
        const selectedNextLevel = new Set(state.selected
            ? state.edges.filter(edge => edge.type === 'contains' && edge.source === state.selected.id).map(edge => edge.target)
            : []);
        const highlighted = new Set();
        if (answerFocus) answerFocus.nodeIds.forEach(id => highlighted.add(id));
        if (focusNode) {
            highlighted.add(focusNode.id);
            state.edges.forEach(edge => {
                if (edge.source === focusNode.id) highlighted.add(edge.target);
                if (edge.target === focusNode.id) highlighted.add(edge.source);
            });
        }
        const edgeIsActive = edge => focusNode
            ? edge.source === focusNode.id || edge.target === focusNode.id
            : Boolean(answerFocus?.edgeKeys.has(graphEdgeKey(edge.source, edge.target)));
        ctx.lineCap = 'round';
        drawSpaceParticles(now);
        if (state.dimension === '3d') {
            const center = worldToScreen(state.orbitPivot);
            ctx.save();
            ctx.translate(center.x, center.y);
            ctx.rotate(-state.cameraYaw * .16);
            [150, 285, 430].forEach((radius, index) => {
                ctx.beginPath();
                ctx.ellipse(0, 0, radius * state.scale, radius * state.scale * (.22 + Math.abs(Math.cos(state.cameraPitch)) * .13), 0, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(118,139,216,${.055 - index * .012})`;
                ctx.lineWidth = .7;
                ctx.setLineDash([2 + index * 2, 8 + index * 3]);
                ctx.stroke();
            });
            ctx.restore();
        }
        const orderedEdges = [...state.edges].sort((a, b) => {
            const aActive = edgeIsActive(a);
            const bActive = edgeIsActive(b);
            if (aActive !== bActive) return Number(aActive) - Number(bActive);
            if (state.dimension === '3d') {
                const aDepth = (worldToScreen(a.sourceNode).depth + worldToScreen(a.targetNode).depth) / 2;
                const bDepth = (worldToScreen(b.sourceNode).depth + worldToScreen(b.targetNode).depth) / 2;
                return bDepth - aDepth;
            }
            return 0;
        });
        for (const edge of orderedEdges) {
            const a = worldToScreen(edge.sourceNode);
            const b = worldToScreen(edge.targetNode);
            const depthOpacity = state.dimension === '3d'
                ? Math.max(.26, Math.min(1.12, Math.pow(((a.perspective || 1) + (b.perspective || 1)) / 2, 1.28)))
                : 1;
            const depthWidth = state.dimension === '3d'
                ? Math.max(.72, Math.min(1.18, ((a.perspective || 1) + (b.perspective || 1)) / 2))
                : 1;
            const growthProgress = growthEdgeProgress(edge, now);
            if (growthProgress <= 0) continue;
            const drawX = a.x + (b.x - a.x) * growthProgress;
            const drawY = a.y + (b.y - a.y) * growthProgress;
            const active = edgeIsActive(edge);
            const answerActive = Boolean(answerFocus && active);
            if (hasFocus) {
                const baseAlpha = edge.type !== 'contains' ? .11 : .22;
                const activeTarget = answerFocus ? .98 : .88;
                const inactiveTarget = answerFocus ? .008 : .025;
                const activeAlpha = baseAlpha + (activeTarget - baseAlpha) * focusStrength;
                const inactiveAlpha = baseAlpha + (inactiveTarget - baseAlpha) * focusStrength;
                ctx.strokeStyle = active ? accentColor(Math.min(1, activeAlpha * depthOpacity)) : `rgba(94,108,145,${inactiveAlpha * depthOpacity})`;
                ctx.lineWidth = (active ? (answerFocus ? 2.2 : .9 + .55 * focusStrength) : .9 - .35 * focusStrength) * state.settings.lineScale * depthWidth;
                ctx.shadowColor = active ? accentColor((answerFocus ? .96 : .72) * focusStrength) : 'transparent';
                ctx.shadowBlur = active ? (answerFocus ? 12 : 5) * focusStrength : 0;
            } else {
                ctx.strokeStyle = edge.type !== 'contains' ? `rgba(117,132,173,${.11 * depthOpacity})` : `rgba(133,147,187,${.22 * depthOpacity})`;
                ctx.lineWidth = (edge.type !== 'contains' ? 0.65 : 0.9) * state.settings.lineScale * depthWidth;
                ctx.shadowBlur = 0;
            }
            if (answerActive) {
                ctx.save();
                ctx.globalAlpha = Math.min(1, growthProgress * 1.35);
                ctx.strokeStyle = accentColor(.2 * depthOpacity);
                ctx.lineWidth = 6.2 * state.settings.lineScale * depthWidth;
                ctx.shadowColor = accentColor(.9);
                ctx.shadowBlur = 18;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(drawX, drawY); ctx.stroke();
                ctx.restore();
            }
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(drawX, drawY); ctx.stroke();
        }
        if (state.dimension === '3d') {
            const particleStride = Math.max(1, Math.ceil(state.edges.length / 110));
            ctx.save();
            state.edges.forEach((edge, index) => {
                if (index % particleStride || growthEdgeProgress(edge, now) < .98) return;
                const active = edgeIsActive(edge);
                if (hasFocus && !active) return;
                const a = worldToScreen(edge.sourceNode);
                const b = worldToScreen(edge.targetNode);
                if (!a.visible || !b.visible) return;
                const seed = [...`${edge.source}:${edge.target}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
                const speed = active ? .0002 : .000085;
                const t = (now * speed + (seed % 97) / 97) % 1;
                const x = a.x + (b.x - a.x) * t;
                const y = a.y + (b.y - a.y) * t;
                const perspective = a.perspective + (b.perspective - a.perspective) * t;
                const radius = Math.max(.8, (active ? 2.15 : 1.2) * perspective * Math.sqrt(state.scale));
                ctx.globalAlpha = active ? .95 : .32;
                ctx.fillStyle = active ? accentColor(.96) : colorForGroup(edge.targetNode.group, .72);
                ctx.shadowColor = active ? accentColor(.95) : colorForGroup(edge.targetNode.group, .55);
                ctx.shadowBlur = active ? 12 : 5;
                ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
            });
            ctx.restore();
        }
        ctx.shadowBlur = 0;
        const ordered = [...state.nodes].sort((a, b) => state.dimension === '3d'
            ? worldToScreen(b).depth - worldToScreen(a).depth
            : (isLeafNode(a) ? 0 : 1) - (isLeafNode(b) ? 0 : 1));
        for (const node of ordered) {
            const growthProgress = growthNodeProgress(node, now);
            if (growthProgress <= 0) continue;
            const point = worldToScreen(node);
            const isSelected = state.selected?.id === node.id;
            const isHovered = state.hovered?.id === node.id;
            const isSearch = state.searchMatches.has(node.id);
            const dimmed = hasFocus && !highlighted.has(node.id);
            const isAnswerHighlighted = Boolean(answerFocus && highlighted.has(node.id));
            const radius = screenNodeRadius(node, point) * growthNodeScale(growthProgress) * (isAnswerHighlighted ? 1.14 : 1);
            const dimmedNodeAlpha = answerFocus ? .035 : (1 - .88 * focusStrength);
            const depthAlpha = state.dimension === '3d' ? Math.max(.36, Math.min(1, Math.pow(point.perspective || 1, 1.22))) : 1;
            ctx.globalAlpha = (dimmed ? dimmedNodeAlpha : 1) * Math.min(1, growthProgress * 1.5) * depthAlpha;
            const emphasized = Boolean(isSelected || isHovered || isSearch || hasFocus && highlighted.has(node.id));
            if (emphasized) {
                ctx.shadowColor = isRootNode(node) ? '#fff' : colorForGroup(node.group, .85);
                ctx.shadowBlur = isAnswerHighlighted ? 22 : (isSelected || isHovered ? 18 : 8);
            }
            if (state.dimension === '3d') {
                drawLitSphere(node, point, radius, emphasized);
            } else {
                ctx.fillStyle = nodeBaseColor(node);
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius + (isSelected || isHovered ? 1.4 : 0), 0, Math.PI * 2);
                ctx.fill();
            }
            if (isAnswerHighlighted) {
                const pulse = .5 + Math.sin(now * .0032 + Number(node.motionPhase || 0)) * .5;
                ctx.save();
                ctx.globalAlpha = Math.min(1, growthProgress * 1.5);
                ctx.strokeStyle = accentColor(.92);
                ctx.lineWidth = node.type === 'metric' ? 2.4 : 1.7;
                ctx.shadowColor = accentColor(.96);
                ctx.shadowBlur = 16 + pulse * 6;
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius + 3.2 + pulse * 1.4, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
            if (isMetricMode() && node.isFailing === true) drawFailingMetricHalo(node, point, radius, now);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        }
        renderHierarchyLabels(highlighted, focusNode, focusStrength, selectedNextLevel);
    }

    function scheduleFrame() {
        if (state.frame) return;
        state.frame = requestAnimationFrame(timestamp => {
            state.frame = 0;
            updateHoverTransition(timestamp);
            updateOrbitTransition(timestamp);
            const elapsed = state.lastFrameTime ? Math.min(2, Math.max(0.5, (timestamp - state.lastFrameTime) / 16.67)) : 1;
            state.lastFrameTime = timestamp;
            updateCameraTransition(timestamp);
            updateTour(timestamp, elapsed);
            if (state.growth.active && timestamp - state.growth.startedAt > state.growth.duration + 520) {
                state.growth.active = false;
                setGrowthButtonState();
            }
            if (state.running && state.motionEnabled && overlay.classList.contains('open')) {
                simulate(elapsed);
            }
            render();
            if ((state.growth.active || state.hoverTransition || state.orbitTransition || state.cameraTransition || state.tour.active || state.dimension === '3d' || state.running && state.motionEnabled || shouldAnimateMetricAlerts()) && overlay.classList.contains('open')) scheduleFrame();
        });
    }

    function nodeAt(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        let found = null;
        let best = Infinity;
        let nearestDepth = Infinity;
        for (const node of state.nodes) {
            if (growthNodeProgress(node) < 0.28) continue;
            const point = worldToScreen(node);
            const distance = Math.hypot(point.x - x, point.y - y);
            const threshold = Math.max(7, screenNodeRadius(node, point) + 4);
            const visuallyCloser = state.dimension === '3d' && Math.abs(distance - best) < 2 && point.depth < nearestDepth;
            if (distance <= threshold && (distance < best || visuallyCloser)) {
                found = node;
                best = distance;
                nearestDepth = point.depth;
            }
        }
        return found;
    }

    function formatShortTime(value) {
        const date = new Date(String(value || '').replace(' ', 'T'));
        if (Number.isNaN(date.getTime())) return String(value || kgT('unknown'));
        return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    function renderHistoryTrend(data) {
        const colors = ['#8fa3ff', '#eb7c78', '#6fc4ee', '#b28af1', '#76d4ad'];
        const hasNumericValue = point => point.numericValue !== null && point.numericValue !== undefined && point.numericValue !== '' && Number.isFinite(Number(point.numericValue));
        const series = (data.series || []).filter(item => item.points.some(hasNumericValue));
        const values = series.flatMap(item => item.points.filter(hasNumericValue).map(point => Number(point.numericValue)));
        if (!values.length) return `<div class="ai-kg-side-empty">${escapeHtml(kgT('nonNumericHistory'))}</div>`;
        let min = Math.min(...values);
        let max = Math.max(...values);
        const padding = Math.max(1, (max - min) * 0.16);
        if (min === max) { min -= padding; max += padding; }
        else { min -= padding; max += padding; }
        const left = 28;
        const right = 306;
        const top = 14;
        const bottom = 104;
        const y = value => bottom - ((value - min) / Math.max(0.0001, max - min)) * (bottom - top);
        const paths = series.map((item, seriesIndex) => {
            const numericPoints = item.points.filter(hasNumericValue);
            const path = numericPoints.map((point, index) => {
                const x = numericPoints.length <= 1 ? (left + right) / 2 : left + index * (right - left) / (numericPoints.length - 1);
                return `${index ? 'L' : 'M'}${x.toFixed(1)},${y(Number(point.numericValue)).toFixed(1)}`;
            }).join(' ');
            const last = numericPoints[numericPoints.length - 1];
            const lastX = numericPoints.length <= 1 ? (left + right) / 2 : right;
            return `<path d="${path}" fill="none" stroke="${colors[seriesIndex % colors.length]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lastX}" cy="${y(Number(last.numericValue)).toFixed(1)}" r="3" fill="${colors[seriesIndex % colors.length]}"/>`;
        }).join('');
        const legend = series.map((item, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(metricText(item.category))}</span>`).join('');
        return `<svg class="ai-kg-trend" viewBox="0 0 320 126" role="img" aria-label="${escapeHtml(kgT('historyTrend'))}"><line x1="28" y1="104" x2="306" y2="104" stroke="rgba(132,148,190,.2)"/><line x1="28" y1="14" x2="28" y2="104" stroke="rgba(132,148,190,.2)"/><text x="5" y="18" fill="#73819d" font-size="8">${escapeHtml(Number(max.toFixed(2)))}</text><text x="5" y="104" fill="#73819d" font-size="8">${escapeHtml(Number(min.toFixed(2)))}</text>${paths}</svg><div class="ai-kg-series-legend">${legend}</div>`;
    }

    function renderHistoryRows(data) {
        const rows = (data.series || []).flatMap(item => item.points.map(point => ({ ...point, category: item.category })))
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, 24);
        if (!rows.length) return `<div class="ai-kg-side-empty">${escapeHtml(kgT('noSavedHistory'))}</div>`;
        return `<div class="ai-kg-history-list">${rows.map(item => {
            const missingValue = item.value === null || item.value === undefined || ['', '--', '-'].includes(String(item.value).trim());
            const stateClass = missingValue || item.isFailing === null ? 'unknown' : item.isFailing === true ? 'fail' : '';
            const stateText = kgT(missingValue ? 'noValue' : item.isFailing === true ? 'failing' : item.isFailing === false ? 'passing' : 'undetermined');
            return `<div class="ai-kg-history-row" title="${escapeHtml(item.snapshotId)}"><span class="ai-kg-history-time">${escapeHtml(formatShortTime(item.createdAt))}</span><span class="ai-kg-history-value">${escapeHtml(metricText(item.category))} · ${escapeHtml(item.value ?? '--')}</span><span class="ai-kg-history-state ${stateClass}">${escapeHtml(stateText)}</span></div>`;
        }).join('')}</div>`;
    }

    function renderMonthlyRules(rule) {
        if (!rule) return `<div class="ai-kg-side-empty">${escapeHtml(kgT('noRule'))}</div>`;
        return `<div class="ai-kg-month-grid">${Array.from({ length: 12 }, (_, index) => index + 1).map(month => {
            const value = rule.monthlyTargets?.[month];
            const categoryValues = rule.categoryTargets?.[String(month)];
            const text = value !== undefined ? value : categoryValues && Object.keys(categoryValues).length ? kgT('bySubmetric') : '--';
            return `<div class="ai-kg-month-cell ${month === state.month ? 'active' : ''}" title="${escapeHtml(kgT('monthRule', month))}"><span>${escapeHtml(kgT('monthLabel', month))}</span><b>${escapeHtml(text)}</b></div>`;
        }).join('')}</div>`;
    }

    async function selectMetricNode(node) {
        if (!node) {
            sidebar.innerHTML = `<div class="ai-kg-side-empty">${escapeHtml(kgT('metricHelp'))}</div>`;
            return;
        }
        const stats = state.data?.stats || {};
        if (node.type === 'metricRoot') {
            sidebar.innerHTML = `<div class="ai-kg-node-type">${escapeHtml(kgT('metricRootType'))}</div><div class="ai-kg-node-title">${escapeHtml(nodeLabel(node) || kgT('rootMetricRule', state.month))}</div><div class="ai-kg-node-stats"><div class="ai-kg-stat-card"><b>${stats.categories || 0}</b><span>${escapeHtml(kgT('category'))}</span></div><div class="ai-kg-stat-card"><b>${stats.metrics || 0}</b><span>${escapeHtml(kgT('metric'))}</span></div><div class="ai-kg-stat-card"><b>${stats.subMetrics || 0}</b><span>${escapeHtml(kgT('submetric'))}</span></div><div class="ai-kg-stat-card"><b>${stats.snapshots || 0}</b><span>${escapeHtml(kgT('snapshots'))}</span></div></div><div class="ai-kg-section-title">${escapeHtml(kgT('dataMethod'))}</div><div class="ai-kg-node-path">${escapeHtml(kgT('metricHistoryRule'))}</div>`;
            return;
        }
        if (node.type === 'metricCategory') {
            const metrics = state.nodes.filter(item => item.type === 'metric' && item.group === node.group);
            sidebar.innerHTML = `<div class="ai-kg-node-type">${escapeHtml(kgT('category'))}</div><div class="ai-kg-node-title">${escapeHtml(nodeLabel(node))}</div><div class="ai-kg-node-stats"><div class="ai-kg-stat-card"><b>${metrics.length}</b><span>${escapeHtml(kgT('metric'))}</span></div><div class="ai-kg-stat-card"><b>${metrics.reduce((sum, item) => sum + Number(item.subMetricCount || 0), 0)}</b><span>${escapeHtml(kgT('submetric'))}</span></div></div><div class="ai-kg-section-title">${escapeHtml(kgT('categoryMetrics'))}</div>${metrics.map(item => `<div class="ai-kg-chunk" data-node-id="${escapeHtml(item.id)}"><div class="ai-kg-chunk-title">${escapeHtml(nodeLabel(item))}</div><div class="ai-kg-chunk-lines">${escapeHtml(formatRuleTarget(item.rule))} · ${escapeHtml(kgT('weight'))} ${escapeHtml(item.rule?.weight ?? '--')}</div></div>`).join('')}`;
            return;
        }
        const metricNode = node.type === 'metric'
            ? node
            : state.nodes.find(item => item.type === 'metric' && item.label === node.metricLabel);
        if (!metricNode) return;
        const category = node.type === 'submetric' ? node.category : '';
        const rule = metricNode.rule;
        const childNodes = state.edges.filter(edge => edge.source === metricNode.id && edge.targetNode?.type === 'submetric').map(edge => edge.targetNode);
        const subMetricHtml = node.type === 'metric' && childNodes.length
            ? `<div class="ai-kg-section-title">${escapeHtml(kgT('submetric'))}</div>${childNodes.map(item => `<div class="ai-kg-chunk" data-node-id="${escapeHtml(item.id)}"><div class="ai-kg-chunk-title">${escapeHtml(nodeLabel(item))}</div><div class="ai-kg-chunk-lines">${escapeHtml(formatRuleTarget(rule, item.category))} · ${escapeHtml(kgT('latest'))} ${escapeHtml(item.latestValue ?? '--')} · ${Number(item.historySnapshotCount) || 0} ${escapeHtml(kgT('valuedDays'))}</div></div>`).join('')}`
            : '';
        sidebar.innerHTML = `<div class="ai-kg-node-type">${escapeHtml(kgT(node.type === 'submetric' ? 'submetric' : 'metric'))}</div><div class="ai-kg-node-title">${escapeHtml(nodeLabel(node))}</div><div class="ai-kg-node-path">${escapeHtml(metricText(metricNode.group))} · ${escapeHtml(kgT('monthRule', state.month))}</div><div class="ai-kg-rule"><div class="ai-kg-rule-main">${escapeHtml(formatRuleTarget(rule, category))}</div><div class="ai-kg-rule-meta">${escapeHtml(kgT('metric'))}: ${escapeHtml(nodeLabel(metricNode))} · ${escapeHtml(kgT('weight'))} ${escapeHtml(rule?.weight ?? '--')} · ${escapeHtml(kgT(rule?.proportionalScoring ? 'proportionalScoring' : 'standardScoring'))}${category ? ` · ${escapeHtml(kgT('submetric'))} ${escapeHtml(metricText(category))}` : ''}</div></div>${subMetricHtml}<div class="ai-kg-section-title">${escapeHtml(kgT('twelveMonthRules'))}</div>${renderMonthlyRules(rule)}<div class="ai-kg-section-title">${escapeHtml(kgT('dailyLatestHistory'))}</div><div class="ai-kg-side-empty ai-kg-history-loading">${escapeHtml(kgT('loadingSavedHistory'))}</div>`;
        try {
            const query = new URLSearchParams({ metric: metricNode.label, month: String(state.month) });
            if (category) query.set('category', category);
            const response = await fetch(`/api/ai/knowledge/metric-history?${query}`, { headers: authHeaders() });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || kgT('metricHistoryLoadFailed'));
            if (state.selected?.id !== node.id) return;
            const loadingText = sidebar.querySelector('.ai-kg-history-loading');
            if (loadingText) loadingText.remove();
            const hasHistory = (data.series || []).some(item => item.points?.length);
            sidebar.insertAdjacentHTML('beforeend', `${hasHistory ? renderHistoryTrend(data) : ''}${renderHistoryRows(data)}<div class="ai-kg-node-path" style="margin-top:10px">${escapeHtml(kgT('metricHistoryRule'))}</div>`);
        } catch (error) {
            if (state.selected?.id === node.id) sidebar.insertAdjacentHTML('beforeend', `<div class="ai-kg-side-empty">⚠️ ${escapeHtml(error.message)}</div>`);
        }
    }

    async function selectNode(node) {
        state.selected = node;
        state.sidebarDocument = null;
        render();
        if (isMetricMode()) {
            await selectMetricNode(node);
            return;
        }
        if (!node) {
            sidebar.innerHTML = `<div class="ai-kg-side-empty">${escapeHtml(kgT('empty'))}</div>`;
            return;
        }
        if (node.type === 'citation') {
            const source = node.citation || {};
            const range = source.startLine ? `L${source.startLine}${source.endLine && source.endLine !== source.startLine ? `–${source.endLine}` : ''}` : kgT('citedChunk');
            sidebar.innerHTML = `<div class="ai-kg-node-type">${escapeHtml(kgT('citedChunk'))}</div><div class="ai-kg-node-title">${escapeHtml(source.title || node.path)}</div><div class="ai-kg-node-path">${escapeHtml(node.path)} · ${escapeHtml(range)}</div><div class="ai-kg-side-empty">${kgLang() === 'en' ? 'Loading the cited content…' : '正在读取引用内容…'}</div>`;
            try {
                const response = await fetch(`/api/ai/knowledge/document?path=${encodeURIComponent(node.path)}`, { headers: authHeaders() });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || '读取失败');
                if (state.selected?.id !== node.id) return;
                const startLine = Number(source.startLine) || 0;
                const endLine = Number(source.endLine || source.startLine) || startLine;
                const chunks = (data.chunks || []).filter(chunk => !startLine || Number(chunk.end_line) >= startLine && Number(chunk.start_line) <= endLine);
                state.sidebarDocument = data;
                sidebar.innerHTML = `<div class="ai-kg-node-type">${escapeHtml(kgT('citedChunk'))}</div><div class="ai-kg-node-heading"><div class="ai-kg-node-title">${escapeHtml(source.title || node.path)}</div>${renderAnalyzeButton('file')}</div><div class="ai-kg-node-path">${escapeHtml(node.path)} · ${escapeHtml(range)}</div><div class="ai-kg-section-title">${escapeHtml(kgT('viewChunks'))}</div>${(chunks.length ? chunks : data.chunks || []).slice(0, 3).map(chunk => renderKnowledgeChunk(chunk, data.path, { citation:true })).join('')}`;
            } catch (error) {
                if (state.selected?.id === node.id) sidebar.insertAdjacentHTML('beforeend', `<div class="ai-kg-side-empty">⚠️ ${escapeHtml(error.message)}</div>`);
            }
            return;
        }
        if (node.type === 'root') {
            const stats = state.data?.stats || {};
            sidebar.innerHTML = `<div class="ai-kg-node-type">${kgT('rootType')}</div><div class="ai-kg-node-title">Tools Platform</div><div class="ai-kg-node-stats"><div class="ai-kg-stat-card"><b>${stats.documents || 0}</b><span>${kgT('knowledgeFile')}</span></div><div class="ai-kg-stat-card"><b>${stats.chunks || 0}</b><span>${kgT('chunks')}</span></div><div class="ai-kg-stat-card"><b>${Number(stats.builtInTools || 0) + Number(stats.customTools || 0)}</b><span>${kgT('tools')}</span></div><div class="ai-kg-stat-card"><b>${stats.tables || 0}</b><span>${kgT('tables')}</span></div></div>`;
            return;
        }
        if (['assetCategory', 'tool', 'database', 'assetFile', 'table'].includes(node.type)) {
            const childEdges = state.edges.filter(edge => edge.type === 'contains' && edge.source === node.id);
            const relationEdges = state.edges.filter(edge => edge.source === node.id || edge.target === node.id);
            const related = relationEdges.map(edge => edge.source === node.id ? edge.targetNode : edge.sourceNode).filter(item => item && !childEdges.some(edge => edge.target === item.id));
            const typeLabel = node.type === 'assetCategory' ? kgT('assetCategory') : node.type === 'tool' ? kgT('htmlTool') : node.type === 'database' ? kgT('database') : node.type === 'table' ? kgT('table') : kgT('toolFile');
            const statCards = [];
            if (node.type === 'assetCategory') statCards.push([childEdges.length, kgT('contained')]);
            if (node.type === 'tool') statCards.push([node.fileCount || childEdges.length, kgT('assetFiles')], [node.builtIn ? kgT('builtInTools') : kgT('customTools'), kgT('htmlTool')]);
            if (node.type === 'database') statCards.push([node.tableCount || childEdges.length, kgT('tables')], [formatBytes(node.bytes), kgT('fileSize')]);
            if (node.type === 'assetFile') statCards.push([formatBytes(node.bytes), kgT('fileSize')], [String(node.extension || '—').replace('.', '').toUpperCase() || '—', 'TYPE']);
            if (node.type === 'table') statCards.push([node.columns?.length || 0, kgT('columns')], [node.database || '—', kgT('database')]);
            const childrenHtml = childEdges.slice(0, 80).map(edge => `<div class="ai-kg-chunk" data-node-id="${escapeHtml(edge.targetNode.id)}"><div class="ai-kg-chunk-title">${escapeHtml(nodeLabel(edge.targetNode))}</div><div class="ai-kg-chunk-lines">${escapeHtml(edge.targetNode.path || edge.targetNode.type || '')}</div></div>`).join('');
            const relatedHtml = related.slice(0, 40).map(item => `<div class="ai-kg-chunk" data-node-id="${escapeHtml(item.id)}"><div class="ai-kg-chunk-title">${escapeHtml(nodeLabel(item))}</div><div class="ai-kg-chunk-lines">${escapeHtml(item.path || item.type || '')}</div></div>`).join('');
            sidebar.innerHTML = `<div class="ai-kg-node-type">${escapeHtml(typeLabel)}</div><div class="ai-kg-node-title">${escapeHtml(nodeLabel(node))}</div>${node.path ? `<div class="ai-kg-node-path">${escapeHtml(node.path)}</div>` : ''}${nodeDescription(node) ? `<div class="ai-kg-node-path">${escapeHtml(nodeDescription(node))}</div>` : ''}<div class="ai-kg-node-stats">${statCards.map(([value,label]) => `<div class="ai-kg-stat-card"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join('')}</div>${node.updatedAt ? `<div class="ai-kg-section-title">${kgT('updatedAt')}</div><div class="ai-kg-node-path">${escapeHtml(formatTime(node.updatedAt))}</div>` : ''}${node.type === 'tool' ? `<div class="ai-kg-section-title">${kgT('publicAccess')}</div><div class="ai-kg-node-path">${node.publicAccess ? kgT('yes') : kgT('no')}</div>` : ''}${node.columns?.length ? `<div class="ai-kg-section-title">${kgT('columns')}</div><div class="ai-kg-node-path">${escapeHtml(node.columns.join(' · '))}</div>` : ''}${node.schema ? `<div class="ai-kg-section-title">${kgT('schema')}</div><div class="ai-kg-chunk-preview">${escapeHtml(node.schema)}</div>` : ''}${childrenHtml ? `<div class="ai-kg-section-title">${kgT('contained')}</div>${childrenHtml}` : ''}${relatedHtml ? `<div class="ai-kg-section-title">${kgT('related')}</div>${relatedHtml}` : ''}`;
            return;
        }
        if (node.type === 'group') {
            if (node.group === 'tool-data-assets') {
                const children = state.edges.filter(edge => edge.type === 'contains' && edge.source === node.id).map(edge => edge.targetNode).filter(Boolean);
                sidebar.innerHTML = `<div class="ai-kg-node-type">${kgT('toolData')}</div><div class="ai-kg-node-title">${escapeHtml(nodeLabel(node))}</div><div class="ai-kg-node-stats"><div class="ai-kg-stat-card"><b>${state.data?.stats?.builtInTools || 0}</b><span>${kgT('builtInTools')}</span></div><div class="ai-kg-stat-card"><b>${state.data?.stats?.customTools || 0}</b><span>${kgT('customTools')}</span></div><div class="ai-kg-stat-card"><b>${state.data?.stats?.databases || 0}</b><span>${kgT('databases')}</span></div><div class="ai-kg-stat-card"><b>${state.data?.stats?.tables || 0}</b><span>${kgT('tables')}</span></div><div class="ai-kg-stat-card"><b>${state.data?.stats?.tableRelations || 0}</b><span>${kgT('tableRelations')}</span></div></div><div class="ai-kg-section-title">${kgT('contained')}</div>${children.map(item => `<div class="ai-kg-chunk" data-node-id="${escapeHtml(item.id)}"><div class="ai-kg-chunk-title">${escapeHtml(nodeLabel(item))}</div></div>`).join('')}`;
                return;
            }
            const docs = state.nodes.filter(item => item.type === 'document' && item.group === node.group);
            sidebar.innerHTML = `<div class="ai-kg-node-type">${kgT('businessModules')}</div><div class="ai-kg-node-title">${escapeHtml(nodeLabel(node))}</div><div class="ai-kg-node-stats"><div class="ai-kg-stat-card"><b>${docs.length}</b><span>${kgT('files')}</span></div><div class="ai-kg-stat-card"><b>${docs.reduce((sum,item)=>sum+(item.chunks||0),0)}</b><span>${kgT('chunks')}</span></div></div><div class="ai-kg-section-title">${kgT('moduleFiles')}</div>${docs.slice(0,30).map(item=>`<div class="ai-kg-chunk" data-node-id="${escapeHtml(item.id)}"><div class="ai-kg-chunk-title">${escapeHtml(nodeLabel(item))}</div><div class="ai-kg-chunk-lines">${escapeHtml(item.path)}</div></div>`).join('')}`;
            return;
        }
        sidebar.innerHTML = `<div class="ai-kg-node-type">${kgT('readingFile')}</div><div class="ai-kg-node-title">${escapeHtml(nodeLabel(node))}</div><div class="ai-kg-node-path">${escapeHtml(node.path)}</div>`;
        try {
            const response = await fetch(`/api/ai/knowledge/document?path=${encodeURIComponent(node.path)}`, { headers: authHeaders() });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '读取失败');
            if (state.selected?.id !== node.id) return;
            state.sidebarDocument = data;
            sidebar.innerHTML = `
                <div class="ai-kg-node-type">${escapeHtml(data.group?.label || '知识文件')}</div>
                <div class="ai-kg-node-heading"><div class="ai-kg-node-title">${escapeHtml(nodeLabel(node))}</div>${renderAnalyzeButton('file')}</div>
                <div class="ai-kg-node-path">${escapeHtml(data.path)}</div>
                <div class="ai-kg-node-stats"><div class="ai-kg-stat-card"><b>${data.chunk_count || 0}</b><span>${kgT('chunks')}</span></div><div class="ai-kg-stat-card"><b>${formatBytes(data.size_bytes)}</b><span>${kgT('fileSize')}</span></div></div>
                <div class="ai-kg-section-title">${kgT('indexTime')}</div><div class="ai-kg-node-path">${escapeHtml(formatTime(data.indexed_at))}</div>
                <div class="ai-kg-section-title">${kgT('viewChunks')}</div>
                ${(data.chunks || []).map(chunk => renderKnowledgeChunk(chunk, data.path)).join('')}
            `;
        } catch (error) {
            sidebar.innerHTML += `<div class="ai-kg-side-empty">⚠️ ${escapeHtml(error.message)}</div>`;
        }
    }

    function orbitTargetNode() {
        return state.orbitTargetId ? state.nodeMap.get(state.orbitTargetId) : null;
    }

    function setOrbitTarget(node, { animate = true, duration = 620 } = {}) {
        if (state.dimension !== '3d') return;
        const target = node || null;
        const targetId = target?.id || null;
        const targetPoint = target ? { x:target.x, y:target.y, z:target.z } : { x:0, y:0, z:0 };
        state.orbitTargetId = targetId;
        if (!animate) {
            state.orbitPivot = targetPoint;
            state.panX = 0;
            state.panY = 0;
            state.orbitTransition = null;
            render();
            return;
        }
        state.orbitTransition = {
            startedAt: performance.now(),
            duration,
            from: { ...state.orbitPivot },
            fromPanX: state.panX,
            fromPanY: state.panY
        };
        scheduleFrame();
    }

    function startCameraTransition({ scale = state.scale, yaw = state.cameraYaw, pitch = state.cameraPitch, duration = 760 } = {}) {
        if (state.dimension !== '3d') return;
        state.cameraTransition = {
            startedAt: performance.now(), duration,
            fromScale:state.scale, toScale:scale,
            fromYaw:state.cameraYaw, toYaw:yaw,
            fromPitch:state.cameraPitch, toPitch:pitch
        };
        scheduleFrame();
    }

    function updateCameraTransition(now) {
        const transition = state.cameraTransition;
        if (!transition) return;
        const progress = Math.max(0, Math.min(1, (now - transition.startedAt) / transition.duration));
        const eased = progress < .5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        state.scale = transition.fromScale + (transition.toScale - transition.fromScale) * eased;
        state.cameraYaw = transition.fromYaw + (transition.toYaw - transition.fromYaw) * eased;
        state.cameraPitch = transition.fromPitch + (transition.toPitch - transition.fromPitch) * eased;
        if (progress >= 1) state.cameraTransition = null;
    }

    function buildTourNodeIds() {
        const rootId = isMetricMode() ? 'metric-root' : 'root';
        const priority = [
            state.nodeMap.get(rootId),
            ...state.nodes.filter(isGroupNode),
            ...state.nodes.filter(node => isMetricMode() ? node.type === 'metric' : ['tool','database'].includes(node.type))
        ].filter(Boolean);
        const seen = new Set();
        return priority.filter(node => !seen.has(node.id) && seen.add(node.id)).slice(0, 12).map(node => node.id);
    }

    function syncTourButton() {
        tourButton.setAttribute('aria-pressed', String(state.tour.active));
        tourButton.textContent = kgT(state.tour.active ? 'tourStop' : 'tour');
        tourButton.title = kgT('tourTitle');
    }

    function syncTourSoundButton() {
        const enabled = !state.tour.muted;
        const title = kgT(enabled ? 'soundOnTitle' : 'soundOffTitle');
        soundButton.setAttribute('aria-pressed', String(enabled));
        soundButton.setAttribute('aria-label', title);
        soundButton.title = title;
        soundButton.textContent = enabled ? '♫' : '♪̸';
    }

    function fadeTourAudio(targetVolume, duration, { pause = false } = {}) {
        const token = ++tourAudioFadeToken;
        if (tourAudioFadeFrame) cancelAnimationFrame(tourAudioFadeFrame);
        const fromVolume = tourAudio.volume;
        const startedAt = performance.now();
        const step = now => {
            if (token !== tourAudioFadeToken) return;
            const progress = Math.max(0, Math.min(1, (now - startedAt) / Math.max(1, duration)));
            tourAudio.volume = fromVolume + (targetVolume - fromVolume) * progress;
            if (progress < 1) {
                tourAudioFadeFrame = requestAnimationFrame(step);
                return;
            }
            tourAudioFadeFrame = 0;
            if (pause) tourAudio.pause();
        };
        tourAudioFadeFrame = requestAnimationFrame(step);
    }

    function startTourAudio() {
        if (state.tour.muted) return;
        const token = ++tourAudioFadeToken;
        if (tourAudioFadeFrame) cancelAnimationFrame(tourAudioFadeFrame);
        const playback = tourAudio.play();
        const fadeIn = () => {
            if (token !== tourAudioFadeToken || !state.tour.active || state.tour.muted) return;
            fadeTourAudio(TOUR_AUDIO_VOLUME, 1200);
        };
        if (playback && typeof playback.then === 'function') playback.then(fadeIn).catch(() => {});
        else fadeIn();
    }

    function stopTourAudio() {
        if (tourAudio.paused && tourAudio.volume === 0) {
            tourAudioFadeToken += 1;
            if (tourAudioFadeFrame) cancelAnimationFrame(tourAudioFadeFrame);
            tourAudioFadeFrame = 0;
            tourAudio.pause();
            return;
        }
        fadeTourAudio(0, 700, { pause:true });
    }

    function setTourMuted(muted) {
        state.tour.muted = Boolean(muted);
        try { localStorage.setItem('ai_kg_tour_muted', state.tour.muted ? '1' : '0'); } catch (_error) {}
        syncTourSoundButton();
        if (state.tour.muted) stopTourAudio();
        else if (state.tour.active) startTourAudio();
    }

    function stopTour({ keepView = true } = {}) {
        state.tour.active = false;
        state.tour.nextAt = 0;
        stopTourAudio();
        if (!keepView) {
            state.cameraTransition = null;
            setOrbitTarget(null, { animate:false });
        }
        syncTourButton();
    }

    function startTour() {
        if (state.dimension !== '3d' || !state.nodes.length) return;
        state.tour.nodeIds = buildTourNodeIds();
        state.tour.index = 0;
        state.tour.active = Boolean(state.tour.nodeIds.length);
        state.tour.nextAt = performance.now();
        syncTourButton();
        if (state.tour.active) startTourAudio();
        scheduleFrame();
    }

    function updateTour(now, elapsed) {
        if (!state.tour.active || state.dimension !== '3d') return;
        if (!state.cameraTransition && !state.pointer) state.cameraYaw += 0.0002 * Math.min(32, elapsed * 16.67);
        if (now < state.tour.nextAt) return;
        const nodeId = state.tour.nodeIds[state.tour.index % state.tour.nodeIds.length];
        const node = state.nodeMap.get(nodeId);
        state.tour.index += 1;
        state.tour.nextAt = now + 4600;
        if (!node) return;
        focusNode(node, { fromTour:true });
    }

    function updateOrbitTransition(now) {
        const transition = state.orbitTransition;
        const target = orbitTargetNode();
        const targetPoint = target ? { x:target.x, y:target.y, z:target.z } : { x:0, y:0, z:0 };
        if (!transition) {
            if (state.orbitTargetId && target) state.orbitPivot = targetPoint;
            return;
        }
        const progress = Math.max(0, Math.min(1, (now - transition.startedAt) / transition.duration));
        const eased = 1 - Math.pow(1 - progress, 3);
        state.orbitPivot = {
            x: transition.from.x + (targetPoint.x - transition.from.x) * eased,
            y: transition.from.y + (targetPoint.y - transition.from.y) * eased,
            z: transition.from.z + (targetPoint.z - transition.from.z) * eased
        };
        state.panX = transition.fromPanX * (1 - eased);
        state.panY = transition.fromPanY * (1 - eased);
        if (progress >= 1) {
            state.orbitPivot = targetPoint;
            state.panX = 0;
            state.panY = 0;
            state.orbitTransition = null;
        }
    }

    function focusNode(node, { fromTour = false } = {}) {
        if (!node) return;
        if (!fromTour) stopTour({ keepView:true });
        if (state.dimension === '3d') {
            setOrbitTarget(node, { duration:fromTour ? 1100 : 720 });
            const targetScale = fromTour
                ? (isRootNode(node) ? 1.58 : isGroupNode(node) ? 1.9 : 2.12)
                : isRootNode(node) ? Math.max(.72, Math.min(1.05, state.scale * 1.08))
                    : isGroupNode(node) ? Math.max(.92, Math.min(1.34, state.scale * 1.32))
                        : Math.max(1.08, Math.min(1.62, state.scale * 1.42));
            startCameraTransition({
                scale:targetScale,
                yaw:state.cameraYaw + (fromTour ? .32 : .12),
                pitch:Math.max(-.72, Math.min(.72, state.cameraPitch * .72)),
                duration:fromTour ? 1250 : 760
            });
        }
        else {
            const projected = worldToScreen(node);
            state.panX += state.width / 2 - projected.x;
            state.panY += state.height / 2 - projected.y;
        }
        selectNode(node);
        render();
    }

    function updateModeChrome(data) {
        const metrics = data.mode === 'metrics';
        titleEl.textContent = metrics ? kgT('metricTitle') : kgT('knowledgeTitle');
        subtitleEl.textContent = metrics ? kgT('metricSubtitle') : kgT('knowledgeSubtitle');
        legendEl.innerHTML = metrics
            ? `<span><i style="background:#f5f7ff"></i>${kgT('monthRules')}</span><span><i style="background:#8b9cff"></i>${kgT('category')}</span><span><i style="background:#cf7e9d"></i>${kgT('metric')}</span><span><i style="background:#64739a"></i>${kgT('submetric')}</span>`
            : `<span><i style="background:#f5f7ff"></i>${kgT('project')}</span><span><i style="background:#8b9cff"></i>${kgT('module')}</span><span><i style="background:#6fc4ee"></i>${kgT('toolData')}</span><span><i style="background:#64739a"></i>${kgT('knowledgeFile')}</span>`;
        monthWrap.classList.toggle('visible', metrics);
        refreshButton.textContent = metrics ? kgT('refreshMetrics') : kgT('refreshKnowledge');
        refreshButton.title = metrics ? kgT('refreshMetricsTitle') : kgT('refreshKnowledgeTitle');
        searchInput.placeholder = metrics ? kgT('searchMetrics') : kgT('searchKnowledge');
        overlay.querySelectorAll('[data-kg-mode]').forEach(button => button.classList.toggle('active', button.dataset.kgMode === state.mode));
        if (metrics) {
            state.month = Number(data.month);
            monthSelect.innerHTML = (data.availableMonths || []).map(month => `<option value="${month}" ${Number(month) === state.month ? 'selected' : ''}>${kgLang() === 'en' ? `Month ${month}` : `${month}月`}</option>`).join('');
        }
    }

    function applyGraphLanguage() {
        overlay.querySelector('#aiKgViewSwitch').setAttribute('aria-label', kgT('view'));
        overlay.querySelector('#aiKgDimensionSwitch').setAttribute('aria-label', kgT('dimension'));
        overlay.querySelector('[data-kg-mode="knowledge"]').textContent = kgT('knowledge');
        overlay.querySelector('[data-kg-mode="metrics"]').textContent = kgT('metrics');
        monthWrap.childNodes[0].nodeValue = kgT('ruleMonth');
        motionButton.textContent = state.motionEnabled ? kgT('motion') : kgT('motionPaused');
        motionButton.title = kgT('motionTitle');
        syncTourButton();
        syncTourSoundButton();
        controlsButton.title = kgT('controls');
        controlsButton.setAttribute('aria-label', kgT('controls'));
        controlPanel.querySelector('[data-kg-control-title]').textContent = kgT('controls');
        controlPanel.querySelector('[data-kg-appearance-title]').textContent = kgT('appearance');
        controlPanel.querySelector('[data-kg-force-title]').textContent = kgT('force');
        controlPanel.querySelector('[data-kg-palette-label]').textContent = kgT('palette');
        controlPanel.querySelector('[data-kg-particle-density-label]').textContent = kgT('particleDensity');
        controlPanel.querySelector('[data-kg-node-size-label]').textContent = kgT('nodeSize');
        controlPanel.querySelector('[data-kg-line-width-label]').textContent = kgT('lineWidth');
        controlPanel.querySelector('[data-kg-label-density-label]').textContent = kgT('labelDensity');
        controlPanel.querySelector('[data-kg-label-opacity-label]').textContent = kgT('labelOpacity');
        controlPanel.querySelector('[data-kg-growth-speed-label]').textContent = kgT('growthSpeed');
        controlPanel.querySelector('[data-kg-center-label]').textContent = kgT('centerForce');
        controlPanel.querySelector('[data-kg-repulsion-label]').textContent = kgT('repulsion');
        controlPanel.querySelector('[data-kg-attraction-label]').textContent = kgT('attraction');
        controlPanel.querySelector('[data-kg-link-length-label]').textContent = kgT('linkLength');
        controlPanel.querySelector('[data-kg-drift-label]').textContent = kgT('drift');
        controlPanel.querySelector('option[value="galaxy"]').textContent = kgT('galaxy');
        controlPanel.querySelector('option[value="cosmic"]').textContent = kgT('cosmic');
        controlPanel.querySelector('option[value="obsidian"]').textContent = kgT('obsidian');
        controlPanel.querySelector('option[value="aurora"]').textContent = kgT('aurora');
        controlPanel.querySelector('#aiKgResetControls').textContent = kgT('resetControls');
        controlPanel.querySelector('.ai-kg-control-close').setAttribute('aria-label', kgT('close'));
        setGrowthButtonState();
        overlay.querySelector('#aiKgFit').title = kgT('fit');
        updateFullscreenButton();
        syncSidebarToggle();
        overlay.querySelector('#aiKgClose').title = kgT('close');
        overlay.querySelector('#aiKgHint').innerHTML = kgT(state.dimension === '3d' ? 'hints3d' : 'hints').map(item => `<span>${escapeHtml(item)}</span>`).join('');
        if (state.data) {
            updateModeChrome(state.data);
            renderStatuses(state.data);
            if (state.selected) selectNode(state.selected);
            else {
                selectNode(state.nodeMap.get(isMetricMode() ? 'metric-root' : 'root'));
                state.selected = null;
            }
        }
        render();
    }

    function normalizeKnowledgePath(value) {
        return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    }

    function graphEdgeKey(source, target) {
        return `${source}\u0000${target}`;
    }

    function renderAnswerFocusSidebar(focus) {
        const rows = focus.citations.map(item => {
            const source = item.source;
            const range = source.startLine
                ? `L${source.startLine}${source.endLine && source.endLine !== source.startLine ? `–${source.endLine}` : ''}`
                : kgT('citedChunk');
            return `<div class="ai-kg-chunk answer-citation" data-node-id="${escapeHtml(item.node.id)}"><div class="ai-kg-chunk-title">${escapeHtml(source.title || item.document.label || item.document.path)}</div><div class="ai-kg-chunk-lines">${escapeHtml(item.document.path)} · ${escapeHtml(range)}</div></div>`;
        }).join('');
        sidebar.innerHTML = `<div class="ai-kg-node-type">${escapeHtml(kgT('answerSources'))}</div><div class="ai-kg-node-title">${focus.citations.length} ${escapeHtml(kgT('citedFiles'))}</div><div class="ai-kg-node-path">${kgLang() === 'en' ? 'Highlighted nodes are temporary cited chunks; bright links trace each chunk back to the project root.' : '发光节点为本次回答的临时引用片段，高亮连线会从片段逐级回溯到项目根节点。'}</div><div class="ai-kg-section-title">${escapeHtml(kgT('viewChunks'))}</div>${rows}`;
    }

    function fitFocusedNodes(nodes) {
        if (!nodes.length || state.dimension === '3d') return;
        const minX = Math.min(...nodes.map(node => node.x));
        const maxX = Math.max(...nodes.map(node => node.x));
        const minY = Math.min(...nodes.map(node => node.y));
        const maxY = Math.max(...nodes.map(node => node.y));
        const availableWidth = Math.max(280, state.width - (state.sidebarCollapsed ? 80 : 430));
        const availableHeight = Math.max(260, state.height - 150);
        const width = Math.max(170, maxX - minX + 150);
        const height = Math.max(150, maxY - minY + 130);
        state.scale = Math.max(0.62, Math.min(1.55, Math.min(availableWidth / width, availableHeight / height)));
        state.panX = -(minX + maxX) / 2 * state.scale - (state.sidebarCollapsed ? 0 : 90);
        state.panY = -(minY + maxY) / 2 * state.scale;
    }

    function fitAnswerFocus(focus) {
        fitFocusedNodes(focus.citations.flatMap(item => [item.document, item.node]));
    }

    function addFocusPath(startNodeId, nodeIds, edgeKeys) {
        nodeIds.add(startNodeId);
        const visited = new Set([startNodeId]);
        let frontier = [startNodeId];
        while (frontier.length) {
            const parents = [];
            frontier.forEach(childId => {
                state.edges.forEach(edge => {
                    if (edge.type !== 'contains' || edge.target !== childId || visited.has(edge.source)) return;
                    visited.add(edge.source);
                    nodeIds.add(edge.source);
                    edgeKeys.add(graphEdgeKey(edge.source, edge.target));
                    parents.push(edge.source);
                });
            });
            frontier = parents;
        }
    }

    function renderMetricAnswerFocusSidebar(focus) {
        const rows = focus.metrics.map(item => {
            const rule = item.node.rule;
            const subText = item.subNodes.length
                ? `${item.subNodes.length} ${kgT('submetric')}`
                : kgT('metric');
            return `<div class="ai-kg-chunk answer-citation" data-node-id="${escapeHtml(item.node.id)}"><div class="ai-kg-chunk-title">${escapeHtml(nodeLabel(item.node))}</div><div class="ai-kg-chunk-lines">${escapeHtml(item.node.group || '')} · ${escapeHtml(formatRuleTarget(rule))} · ${escapeHtml(subText)}</div></div>`;
        }).join('');
        sidebar.innerHTML = `<div class="ai-kg-node-type">${escapeHtml(kgT('answerMetrics'))}</div><div class="ai-kg-node-title">${focus.metrics.length} ${escapeHtml(kgT('referencedMetrics'))}</div><div class="ai-kg-node-path">${kgLang() === 'en' ? `The highlighted paths show Month ${state.month} rules → categories → metrics → referenced submetrics. Click a metric to inspect saved history.` : `高亮路径展示 ${state.month}月规则 → 指标分类 → 指标 → 本次引用子指标。点击指标可查看已入库历史值。`}</div><div class="ai-kg-section-title">${escapeHtml(kgT('metric'))}</div>${rows}`;
    }

    function applyMetricAnswerFocus(options) {
        const references = Array.isArray(options?.metricReferences) ? options.metricReferences : [];
        state.answerFocus = null;
        if (!isMetricMode() || !references.length) return false;
        const metrics = references.map(reference => {
            const node = state.nodeMap.get(reference.nodeId)
                || state.nodes.find(item => item.type === 'metric' && item.label === reference.label);
            if (!node) return null;
            const requestedSubIds = new Set((reference.subMetrics || []).map(item => item.nodeId).filter(Boolean));
            const requestedCategories = new Set((reference.subMetrics || []).map(item => String(item.category || '')).filter(Boolean));
            const subNodes = state.nodes.filter(item => item.type === 'submetric' && item.metricLabel === node.label)
                .filter(item => !requestedSubIds.size && !requestedCategories.size
                    ? false
                    : requestedSubIds.has(item.id) || requestedCategories.has(String(item.category || '')));
            return { reference, node, subNodes };
        }).filter(Boolean);
        if (!metrics.length) return false;
        const nodeIds = new Set();
        const edgeKeys = new Set();
        metrics.forEach(item => {
            addFocusPath(item.node.id, nodeIds, edgeKeys);
            item.subNodes.forEach(node => addFocusPath(node.id, nodeIds, edgeKeys));
        });
        state.answerFocus = { metrics, nodeIds, edgeKeys };
        fitFocusedNodes(metrics.flatMap(item => [item.node, ...item.subNodes]));
        renderMetricAnswerFocusSidebar(state.answerFocus);
        reheat(0.46);
        return true;
    }

    function applyAnswerFocus(options) {
        const sources = Array.isArray(options?.sources) ? options.sources.filter(source => source?.path) : [];
        state.answerFocus = null;
        if (isMetricMode() || !sources.length) return false;
        const documentNodes = state.nodes.filter(node => node.type === 'document');
        const citations = [];
        sources.forEach((source, index) => {
            const path = normalizeKnowledgePath(source.path);
            const documentNode = state.nodeMap.get(`doc:${path}`)
                || documentNodes.find(node => normalizeKnowledgePath(node.path) === path)
                || documentNodes.find(node => path.endsWith(normalizeKnowledgePath(node.path)) || normalizeKnowledgePath(node.path).endsWith(path));
            if (!documentNode) return;
            const angle = (index * 2.399963229728653) + Number(documentNode.motionPhase || 0) * 0.01;
            const citationNode = {
                id: `citation:${path}:${source.startLine || 0}:${source.endLine || source.startLine || 0}:${index}`,
                type: 'citation',
                label: source.startLine ? `L${source.startLine}${source.endLine && source.endLine !== source.startLine ? `–${source.endLine}` : ''}` : kgT('citedChunk'),
                labelEn: source.startLine ? `L${source.startLine}${source.endLine && source.endLine !== source.startLine ? `–${source.endLine}` : ''}` : KG_TEXT.en.citedChunk,
                title: source.title || '',
                path: documentNode.path,
                group: documentNode.group,
                size: 4.8,
                citation: source,
                x: documentNode.x + Math.cos(angle) * 42,
                y: documentNode.y + Math.sin(angle) * 42,
                z: documentNode.z + Math.sin(angle * 1.7) * 24,
                vx: 0, vy: 0, vz: 0,
                motionPhase: Number(documentNode.motionPhase || 0) + index * 17
            };
            state.nodes.push(citationNode);
            state.nodeMap.set(citationNode.id, citationNode);
            const citationEdge = { source: documentNode.id, target: citationNode.id, type: 'citation', sourceNode: documentNode, targetNode: citationNode };
            state.edges.push(citationEdge);
            citations.push({ source, document: documentNode, node: citationNode, edge: citationEdge });
        });
        if (!citations.length) return false;
        const nodeIds = new Set();
        const edgeKeys = new Set();
        citations.forEach(item => {
            nodeIds.add(item.node.id);
            nodeIds.add(item.document.id);
            edgeKeys.add(graphEdgeKey(item.edge.source, item.edge.target));
            addFocusPath(item.document.id, nodeIds, edgeKeys);
        });
        state.answerFocus = { citations, nodeIds, edgeKeys };
        fitAnswerFocus(state.answerFocus);
        renderAnswerFocusSidebar(state.answerFocus);
        reheat(0.46);
        return true;
    }

    async function loadGraph() {
        const loadSequence = ++state.loadSequence;
        setLoading(isMetricMode() ? kgT('loadingMetrics') : kgT('loadingKnowledge'), true);
        try {
            const endpoint = isMetricMode()
                ? `/api/ai/knowledge/metric-graph${state.month ? `?month=${state.month}` : ''}`
                : '/api/ai/knowledge/graph';
            const response = await fetch(endpoint, { headers: authHeaders() });
            const data = await response.json();
            if (loadSequence !== state.loadSequence) return;
            if (!response.ok) throw new Error(data.error || (isMetricMode() ? kgT('metricLoadFailed') : kgT('graphLoadFailed')));
            updateModeChrome(data);
            renderStatuses(data);
            state.selected = null;
            clearHoverIntent({ immediate: true });
            state.searchMatches = new Set();
            state.growth.active = false;
            setGrowthButtonState();
            searchInput.value = '';
            searchCount.textContent = '';
            initializeLayout(data);
            setLoading('', false);
            if (applyMetricAnswerFocus(state.pendingFocus)) {
                state.pendingFocus = null;
                state.selected = null;
                render();
                return;
            }
            if (applyAnswerFocus(state.pendingFocus)) {
                state.pendingFocus = null;
                state.selected = null;
                render();
                return;
            }
            state.pendingFocus = null;
            const rootNode = state.nodeMap.get(isMetricMode() ? 'metric-root' : 'root');
            await selectNode(rootNode);
            state.selected = null;
            render();
        } catch (error) {
            if (loadSequence !== state.loadSequence) return;
            showError(error.message);
        }
    }

    async function switchMode(mode) {
        if (!['knowledge', 'metrics'].includes(mode) || mode === state.mode) return;
        state.mode = mode;
        state.preferredMode = mode;
        try { localStorage.setItem('ai_kg_preferred_mode', mode); } catch (_error) {}
        state.month = mode === 'metrics' ? state.month : null;
        await loadGraph();
    }

    function switchDimension(dimension) {
        if (!['2d', '3d'].includes(dimension) || dimension === state.dimension) return;
        stopTour({ keepView:true });
        if (dimension === '3d') {
            state.flatPositions = new Map(state.nodes.map(node => [node.id, { x:node.x, y:node.y }]));
        } else {
            state.nodes.forEach(node => {
                const flat = state.flatPositions.get(node.id);
                if (flat) { node.x = flat.x; node.y = flat.y; }
            });
        }
        state.dimension = dimension;
        overlay.dataset.dimension = dimension;
        overlay.querySelectorAll('[data-kg-dimension]').forEach(button => {
            const active = button.dataset.kgDimension === dimension;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        clearHoverIntent({ immediate: true });
        state.pointer = null;
        state.nodes.forEach(node => {
            node.vx = 0;
            node.vy = 0;
            node.vz = 0;
        });
        resetView();
        reheat(0.72);
        overlay.querySelector('#aiKgHint').innerHTML = kgT(dimension === '3d' ? 'hints3d' : 'hints').map(item => `<span>${escapeHtml(item)}</span>`).join('');
        render();
    }

    canvas.addEventListener('pointerdown', event => {
        stopTour({ keepView:true });
        state.cameraTransition = null;
        const middlePan = state.dimension === '3d' && event.button === 1;
        const node = middlePan ? null : nodeAt(event.clientX, event.clientY);
        const navigation = middlePan ? 'pan' : state.dimension === '3d' && !node ? 'orbit' : node ? 'node' : 'pan';
        event.preventDefault();
        clearHoverIntent({ immediate: true });
        state.pointer = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY, yaw: state.cameraYaw, pitch: state.cameraPitch, button:event.button, navigation, node, moved: false, lastTime: performance.now(), velocityX: 0, velocityY: 0, velocityZ: 0 };
        if (node && !node.fixed) node.dragging = true;
        if (node) reheat(0.82);
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', event => {
        if (state.pointer) {
            const dx = event.clientX - state.pointer.x;
            const dy = event.clientY - state.pointer.y;
            if (Math.hypot(dx, dy) > 3) state.pointer.moved = true;
            if (state.pointer.node && !state.pointer.node.fixed && state.pointer.moved) {
                const now = performance.now();
                const elapsedMs = Math.max(8, now - state.pointer.lastTime);
                const movement = screenDeltaToWorld(state.pointer.node, dx, dy);
                const velocityScale = 16.67 / elapsedMs;
                state.pointer.node.x += movement.x;
                state.pointer.node.y += movement.y;
                state.pointer.node.z += movement.z;
                state.pointer.velocityX = movement.x * velocityScale;
                state.pointer.velocityY = movement.y * velocityScale;
                state.pointer.velocityZ = movement.z * velocityScale;
                state.pointer.x = event.clientX; state.pointer.y = event.clientY;
                state.pointer.lastTime = now;
                state.pointer.node.vx = 0; state.pointer.node.vy = 0; state.pointer.node.vz = 0;
                reheat(0.78);
            } else if (!state.pointer.node) {
                if (state.pointer.navigation === 'orbit') {
                    state.cameraYaw = state.pointer.yaw + dx * 0.006;
                    state.cameraPitch = Math.max(-1.25, Math.min(1.25, state.pointer.pitch + dy * 0.006));
                } else {
                    state.panX = state.pointer.panX + dx;
                    state.panY = state.pointer.panY + dy;
                }
            }
            render();
            return;
        }
        const hovered = nodeAt(event.clientX, event.clientY);
        canvas.style.cursor = hovered ? 'pointer' : 'grab';
        queueHoverIntent(hovered);
    });
    canvas.addEventListener('pointerup', event => {
        const pointer = state.pointer;
        state.pointer = null;
        canvas.classList.remove('dragging');
        if (pointer?.node && !pointer.node.fixed) {
            pointer.node.dragging = false;
            if (pointer.moved) {
                pointer.node.vx = Math.max(-12, Math.min(12, pointer.velocityX || 0));
                pointer.node.vy = Math.max(-12, Math.min(12, pointer.velocityY || 0));
                pointer.node.vz = Math.max(-12, Math.min(12, pointer.velocityZ || 0));
                reheat(0.68);
            }
        }
        if (pointer && pointer.node && !pointer.moved) {
            if (state.dimension === '3d') focusNode(pointer.node);
            else selectNode(pointer.node);
        }
        else if (pointer && !pointer.node && !pointer.moved && pointer.button !== 1) {
            state.selected = null;
            state.answerFocus = null;
            state.searchMatches = new Set();
            searchInput.value = '';
            searchCount.textContent = '';
            clearHoverIntent({ immediate: true });
            setOrbitTarget(null);
            if (isMetricMode()) selectMetricNode(null);
            else sidebar.innerHTML = `<div class="ai-kg-side-empty">${escapeHtml(kgT('empty'))}</div>`;
            render();
        }
        try { canvas.releasePointerCapture(event.pointerId); } catch (_error) {}
    });
    canvas.addEventListener('auxclick', event => {
        if (event.button === 1) event.preventDefault();
    });
    canvas.addEventListener('dblclick', event => {
        if (state.dimension !== '3d') return;
        const node = nodeAt(event.clientX, event.clientY);
        if (!node) return;
        event.preventDefault();
        setOrbitTarget(node);
        selectNode(node);
    });
    canvas.addEventListener('pointerleave', () => { if (!state.pointer) clearHoverIntent(); });
    canvas.addEventListener('wheel', event => {
        event.preventDefault();
        stopTour({ keepView:true });
        state.cameraTransition = null;
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left - state.width / 2;
        const mouseY = event.clientY - rect.top - state.height / 2;
        const oldScale = state.scale;
        // 2D can tolerate a little more enlargement; 3D keeps a tighter cap so
        // perspective and near-camera nodes never become disorientingly large.
        const maxScale = state.dimension === '3d' ? 3.8 : 4.25;
        const nextScale = Math.max(0.22, Math.min(maxScale, oldScale * Math.exp(-event.deltaY * 0.0012)));
        const ratio = nextScale / oldScale;
        state.panX = mouseX - (mouseX - state.panX) * ratio;
        state.panY = mouseY - (mouseY - state.panY) * ratio;
        state.scale = nextScale;
        render();
    }, { passive: false });

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        const matches = query ? state.nodes.filter(node => `${node.label || ''} ${node.labelEn || ''} ${node.path || ''} ${node.group || ''} ${node.category || ''} ${node.metricLabel || ''} ${node.database || ''} ${node.slug || ''} ${node.rule?.monthTarget || ''}`.toLowerCase().includes(query)) : [];
        state.searchMatches = new Set(matches.map(node => node.id));
        searchCount.textContent = query ? kgT('count', matches.length) : '';
        if (matches.length === 1) focusNode(matches[0]);
        render();
    });
    searchInput.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const first = state.nodes.find(node => state.searchMatches.has(node.id));
        if (first) focusNode(first);
    });
    function toggleChunkDetail(item) {
        const expanded = item.classList.toggle('expanded');
        item.setAttribute('aria-expanded', String(expanded));
        const label = item.querySelector('.ai-kg-chunk-toggle');
        if (label) label.textContent = kgT(expanded ? 'collapseChunk' : 'expandChunk');
    }
    async function analyzeSidebarCode(button) {
        sidebar.querySelectorAll('.ai-kg-analysis-error').forEach(item => item.remove());
        const documentData = state.sidebarDocument;
        if (!documentData || !Array.isArray(documentData.chunks)) return;
        const scope = button.dataset.aiAnalyze;
        const chunk = scope === 'chunk'
            ? documentData.chunks.find(item => String(item.chunk_index) === String(button.dataset.chunkIndex))
            : null;
        button.disabled = true;
        try {
            const contentQuery = new URLSearchParams({ path:documentData.path });
            if (chunk) {
                contentQuery.set('startLine', chunk.start_line);
                contentQuery.set('endLine', chunk.end_line);
            }
            const response = await fetch(`/api/ai/knowledge/document-content?${contentQuery}`, { headers: authHeaders() });
            const source = await readJsonResponse(response, '读取代码内容失败');
            const code = String(source.content || '');
            if (!code.trim()) throw new Error('当前范围没有可分析的代码');
            const range = chunk ? `:${chunk.start_line}-${chunk.end_line}` : '';
            const completeness = source.truncated
                ? (kgLang() === 'en' ? `The source has ${source.content_chars} characters; the first ${source.included_chars} characters are included due to the analysis safety limit.` : `源文件共 ${source.content_chars} 个字符；受分析安全上限限制，本次包含前 ${source.included_chars} 个字符。`)
                : (kgLang() === 'en' ? 'The complete source content is included.' : '本次已包含该源文件的全部内容。');
            const prompt = kgLang() === 'en'
                ? `Analyze the following code from ${documentData.path}${range}. ${completeness} For this FIRST reply only, give a very concise overview in no more than 3 bullets and 100 words total: (1) purpose, (2) main flow, and (3) only the most important caveat if one exists. Do not translate line by line, enumerate utilities, or restate the source path. Keep this exact code context for follow-up questions. For later follow-ups, the first-reply length limit no longer applies; answer at the depth requested by the user.\n\n${code}`
                : `请分析以下来自 ${documentData.path}${range} 的代码。${completeness}仅限首次回答：请用最多 3 个要点、180 字以内做极简概述，只说①主要作用、②核心流程、③最值得注意的一个问题（若无可省略）。不要逐行翻译、不要罗列所有工具函数、不要重复文件路径。请保留这份精确代码上下文。用户后续追问时，不再受首次字数限制，应按用户问题的深度详细回答。\n\n${code}`;
            const displayText = `${kgT(scope === 'chunk' ? 'analyzeChunk' : 'analyzeFile')}：${documentData.path}${range}${source.truncated && !chunk ? ' · 已按上限截取' : ''}`;
            if (typeof window.openToolsAIAssistant !== 'function') throw new Error('AI 助手尚未就绪');
            if (isGraphFullscreen()) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) await exit.call(document);
            }
            await window.openToolsAIAssistant({ prompt, displayText, context:'' });
        } catch (error) {
            sidebar.insertAdjacentHTML('afterbegin', `<div class="ai-kg-side-empty ai-kg-analysis-error">⚠️ ${escapeHtml(error.message)}</div>`);
        } finally {
            button.disabled = false;
        }
    }
    sidebar.addEventListener('click', event => {
        const analyzeButton = event.target.closest('[data-ai-analyze]');
        if (analyzeButton) {
            event.stopPropagation();
            analyzeSidebarCode(analyzeButton);
            return;
        }
        const item = event.target.closest('[data-node-id]');
        if (item) {
            focusNode(state.nodeMap.get(item.getAttribute('data-node-id')));
            return;
        }
        const chunk = event.target.closest('[data-chunk-detail]');
        if (chunk) toggleChunkDetail(chunk);
    });
    sidebar.addEventListener('keydown', event => {
        if (event.target.closest('[data-ai-analyze]')) return;
        if (!['Enter', ' '].includes(event.key)) return;
        const chunk = event.target.closest('[data-chunk-detail]');
        if (!chunk) return;
        event.preventDefault();
        toggleChunkDetail(chunk);
    });
    overlay.querySelectorAll('[data-kg-mode]').forEach(button => {
        button.onclick = () => switchMode(button.dataset.kgMode);
    });
    overlay.querySelectorAll('[data-kg-dimension]').forEach(button => {
        button.onclick = () => switchDimension(button.dataset.kgDimension);
    });
    monthSelect.onchange = async () => {
        state.month = Number(monthSelect.value);
        await loadGraph();
    };
    overlay.querySelector('#aiKgFit').onclick = resetView;
    tourButton.onclick = () => {
        if (state.tour.active) stopTour({ keepView:true });
        else startTour();
    };
    soundButton.onclick = () => setTourMuted(!state.tour.muted);
    controlsButton.onclick = () => {
        const open = controlPanel.classList.toggle('open');
        controlsButton.setAttribute('aria-pressed', String(open));
    };
    controlPanel.querySelector('.ai-kg-control-close').onclick = () => {
        controlPanel.classList.remove('open');
        controlsButton.setAttribute('aria-pressed', 'false');
    };
    controlPanel.addEventListener('input', event => {
        const input = event.target.closest('[data-setting]');
        if (!input) return;
        state.settings[input.dataset.setting] = input.tagName === 'SELECT' ? input.value : Number(input.value);
        saveSettings();
        syncControlPanel();
        if (['centerForce','repulsion','attraction','linkLength','drift','nodeScale'].includes(input.dataset.setting)) reheat(0.62);
        render();
    });
    growButton.onclick = startGrowthAnimation;
    controlPanel.querySelector('#aiKgResetControls').onclick = () => {
        state.settings = { ...DEFAULT_SETTINGS };
        saveSettings();
        syncControlPanel();
        reheat(0.72);
        render();
    };
    motionButton.onclick = () => {
        state.motionEnabled = !state.motionEnabled;
        motionButton.setAttribute('aria-pressed', String(state.motionEnabled));
        motionButton.textContent = state.motionEnabled ? kgT('motion') : kgT('motionPaused');
        if (state.motionEnabled) reheat(0.45);
        else {
            state.running = false;
            state.nodes.forEach(node => { node.vx = 0; node.vy = 0; });
            render();
        }
    };

    function fullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function isGraphFullscreen() {
        return fullscreenElement() === overlay;
    }

    function updateFullscreenButton() {
        const active = isGraphFullscreen();
        fullscreenButton.textContent = active ? '⤡' : '⛶';
        fullscreenButton.title = kgT(active ? 'exitFullscreen' : 'fullscreen');
        fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
        fullscreenButton.setAttribute('aria-pressed', String(active));
    }

    async function toggleFullscreen() {
        try {
            if (isGraphFullscreen()) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) await exit.call(document);
            } else {
                const enter = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
                if (enter) await enter.call(overlay);
            }
        } catch (_error) {
            // The graph overlay already fills the viewport when browser fullscreen is unavailable.
        } finally {
            updateFullscreenButton();
            requestAnimationFrame(resize);
        }
    }

    fullscreenButton.onclick = toggleFullscreen;

    function syncSidebarToggle() {
        main.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
        sidebarToggle.textContent = state.sidebarCollapsed ? '‹' : '›';
        sidebarToggle.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
        const label = kgT(state.sidebarCollapsed ? 'sidebarExpand' : 'sidebarCollapse');
        sidebarToggle.title = label;
        sidebarToggle.setAttribute('aria-label', label);
    }

    function setSidebarCollapsed(collapsed) {
        state.sidebarCollapsed = Boolean(collapsed);
        try { localStorage.setItem('ai_kg_sidebar_collapsed', state.sidebarCollapsed ? '1' : '0'); } catch (_error) {}
        syncSidebarToggle();
        requestAnimationFrame(resize);
    }

    sidebarToggle.onclick = () => setSidebarCollapsed(!state.sidebarCollapsed);
    overlay.querySelector('#aiKgClose').onclick = () => window.AIKnowledgeGraph.close();
    refreshButton.onclick = async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = kgT('refreshLoading');
        try {
            if (!isMetricMode()) {
                const response = await fetch('/api/ai/knowledge/refresh', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || kgT('refreshFailed'));
            }
            await loadGraph();
        } catch (error) {
            sidebar.innerHTML = `<div class="ai-kg-side-empty">⚠️ ${escapeHtml(error.message)}</div>`;
        } finally {
            button.disabled = false;
            button.textContent = isMetricMode() ? kgT('refreshMetrics') : kgT('refreshKnowledge');
        }
    };
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && overlay.classList.contains('open') && !isGraphFullscreen()) window.AIKnowledgeGraph.close();
    });
    document.addEventListener('fullscreenchange', () => {
        updateFullscreenButton();
        requestAnimationFrame(resize);
    });
    document.addEventListener('webkitfullscreenchange', () => {
        updateFullscreenButton();
        requestAnimationFrame(resize);
    });
    new ResizeObserver(resize).observe(stage);
    window.addEventListener('tools:languagechange', applyGraphLanguage);
    syncControlPanel();
    applyGraphLanguage();

    window.AIKnowledgeGraph = {
        open(options = {}) {
            state.pendingFocus = options && typeof options === 'object' ? options : null;
            const requestedMode = options?.mode;
            if (requestedMode === 'metrics') {
                state.mode = requestedMode;
                const requestedMonth = Number(options.month);
                if (Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12) state.month = requestedMonth;
            } else if (requestedMode === 'knowledge') {
                state.mode = requestedMode;
                state.month = null;
            } else {
                state.mode = state.preferredMode;
            }
            overlay.classList.add('open');
            document.body.classList.add('ai-kg-open');
            resize();
            state.running = state.motionEnabled;
            state.lastFrameTime = 0;
            loadGraph();
            setTimeout(() => searchInput.focus(), 100);
        },
        close() {
            if (isGraphFullscreen()) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) Promise.resolve(exit.call(document)).catch(() => {});
            }
            overlay.classList.remove('open');
            document.body.classList.remove('ai-kg-open');
            stopTour({ keepView:true });
            state.cameraTransition = null;
            state.orbitTransition = null;
            state.running = false;
            if (state.frame) cancelAnimationFrame(state.frame);
            state.frame = 0;
            state.lastFrameTime = 0;
        }
    };
})();
