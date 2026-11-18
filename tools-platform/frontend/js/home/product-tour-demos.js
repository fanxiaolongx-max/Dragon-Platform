/**
 * 新手引导的静态演示：示例对话和各工具页面的示意画面。
 * 只用于引导层展示，不请求接口、不加载真实工具、不创建会话。
 * 每个演示中带 data-tour-focus 的元素是该步骤的高亮区域。
 */
(function initHomeProductTourDemos() {
    if (window.HomeProductTourDemos) return;

    const bar = (label, value, max, tone = '') =>
        `<div class="tm-bar ${tone}"><span>${label}</span><i style="--w:${Math.round(value / max * 100)}%"></i><b>${value}</b></div>`;

    function chrome(title, body, L, extra = '') {
        return `<header class="tm-head"><span class="tm-dot"></span><strong>${title}</strong>${extra}<em class="tm-sample">${L('示例数据', 'Sample data')}</em></header><div class="tm-body">${body}</div>`;
    }

    const TOOLS = {
        uivf12: L => chrome(L('数据抓取', 'Data Capture'), `
            <div class="tm-toolbar"><span class="tm-input">${L('搜索脚本…', 'Search scripts…')}</span><span class="tm-btn">${L('新建脚本', 'New script')}</span></div>
            <section class="tm-panel" data-tour-focus>
                <div class="tm-row tm-row-head"><span>${L('已选 4 个脚本', '4 scripts selected')}</span><span class="tm-btn is-primary">▶ ${L('批量运行所选', 'Run selected')}</span></div>
                <table class="tm-table">
                    <thead><tr><th></th><th>${L('脚本', 'Script')}</th><th>${L('来源系统', 'Source')}</th><th>${L('状态', 'Status')}</th></tr></thead>
                    <tbody>
                        <tr><td>☑</td><td>${L('故障工单明细', 'Incident tickets')}</td><td>${L('网管系统', 'NMS')}</td><td><span class="tm-tag is-ok">${L('完成 · 1,286 行', 'Done · 1,286 rows')}</span></td></tr>
                        <tr><td>☑</td><td>${L('投诉工单', 'Complaints')}</td><td>${L('客服平台', 'Service desk')}</td><td><span class="tm-progress"><i style="--w:62%"></i></span> 62%</td></tr>
                        <tr><td>☑</td><td>${L('整改单台账', 'Rectification log')}</td><td>${L('质量平台', 'Quality portal')}</td><td><span class="tm-tag">${L('排队中', 'Queued')}</span></td></tr>
                        <tr><td>☑</td><td>${L('CPT 专项风险', 'CPT risks')}</td><td>${L('风控平台', 'Risk portal')}</td><td><span class="tm-tag">${L('排队中', 'Queued')}</span></td></tr>
                    </tbody>
                </table>
            </section>`, L),

        sla: L => chrome(L('数据导入', 'Data Import'), `
            <div class="tm-drop">${L('把 Excel / CSV 拖到这里，或点击选择文件', 'Drop Excel / CSV files here or click to choose')}</div>
            <section class="tm-panel" data-tour-focus>
                <table class="tm-table">
                    <thead><tr><th>${L('文件', 'File')}</th><th>${L('识别为', 'Detected as')}</th><th>${L('行数', 'Rows')}</th><th>${L('时限', 'Deadlines')}</th></tr></thead>
                    <tbody>
                        <tr><td>${L('故障工单明细_11月.xlsx', 'incidents_nov.xlsx')}</td><td>${L('故障工单', 'Incidents')}</td><td>1,286</td><td><span class="tm-tag is-warn">${L('临期 12', '12 due soon')}</span></td></tr>
                        <tr><td>${L('投诉工单_11月.xlsx', 'complaints_nov.xlsx')}</td><td>${L('投诉', 'Complaints')}</td><td>342</td><td><span class="tm-tag is-warn">${L('临期 5', '5 due soon')}</span></td></tr>
                        <tr><td>${L('整改单台账.csv', 'rectification.csv')}</td><td>${L('整改单', 'Rectification')}</td><td>87</td><td><span class="tm-tag is-bad">${L('超期 3', '3 overdue')}</span></td></tr>
                    </tbody>
                </table>
                <div class="tm-row"><span class="tm-muted">${L('已按规则计算指标并标记时限', 'Metrics calculated and deadlines flagged')}</span><span class="tm-btn is-primary">${L('开始批量导入', 'Import all')}</span></div>
            </section>`, L),

        report: L => chrome(L('报表看板', 'Report Dashboard'), `
            <div class="tm-toolbar"><span class="tm-select">2026-11</span><span class="tm-select">${L('快照：11-17 入库', 'Snapshot: Nov 17')}</span></div>
            <section class="tm-panel" data-tour-focus>
                <div class="tm-kpis">
                    <div><small>${L('综合得分', 'Overall score')}</small><b>92.4</b></div>
                    <div><small>${L('达标指标', 'Targets met')}</small><b class="is-ok">9 / 12</b></div>
                    <div><small>${L('未达标', 'Missed')}</small><b class="is-bad">3</b></div>
                </div>
                <table class="tm-table">
                    <thead><tr><th>${L('指标', 'Metric')}</th><th>${L('目标', 'Target')}</th><th>${L('实际', 'Actual')}</th><th>${L('差距', 'Gap')}</th></tr></thead>
                    <tbody>
                        <tr><td>${L('故障处理及时率', 'On-time resolution')}</td><td>95%</td><td>96.8%</td><td class="is-ok">+1.8</td></tr>
                        <tr><td>${L('工单一次解决率', 'First-time fix rate')}</td><td>90%</td><td>86.5%</td><td class="is-bad">−3.5</td></tr>
                        <tr><td>${L('客户满意度', 'Customer satisfaction')}</td><td>4.60</td><td>4.42</td><td class="is-bad">−0.18</td></tr>
                        <tr><td>${L('整改按期完成率', 'Rectification on time')}</td><td>100%</td><td>94%</td><td class="is-bad">−6.0</td></tr>
                        <tr><td>${L('投诉重复率', 'Repeat complaints')}</td><td>≤3%</td><td>2.1%</td><td class="is-ok">${L('达标', 'Met')}</td></tr>
                    </tbody>
                </table>
            </section>`, L),

        expedite: L => chrome(L('一键催办', 'One-Click Follow-Up'), `
            <div class="tm-toolbar"><span class="tm-select">${L('快照：2026-11-17 入库', 'Snapshot: 2026-11-17')}</span><span class="tm-btn">${L('模板配置', 'Templates')}</span><span class="tm-btn is-primary">${L('一键复制简报', 'Copy brief')}</span></div>
            <section class="tm-panel tm-brief" data-tour-focus>
                <p><b>${L('【11 月质量催办简报】', '[November follow-up brief]')}</b></p>
                <p><b>${L('一、未达标指标（3 项）', '1. Missed targets (3)')}</b></p>
                <p>${L('1. 工单一次解决率 86.5%，目标 90%，差 3.5 个百分点', '1. First-time fix rate 86.5% vs 90% target (−3.5 pts)')}</p>
                <p>${L('2. 客户满意度 4.42，目标 4.60', '2. Customer satisfaction 4.42 vs 4.60 target')}</p>
                <p>${L('3. 整改按期完成率 94%，目标 100%', '3. Rectification on time 94% vs 100% target')}</p>
                <p><b>${L('二、3 天内到期事项', '2. Due within 3 days')}</b></p>
                <p>${L('· 整改单 ZG-1123 · 11-20 截止 · 网络保障组', '· Rectification ZG-1123 · due Nov 20 · Network team')}</p>
                <p>${L('· CPT 风险 R-0457 · 11-21 截止 · 客户服务组', '· CPT risk R-0457 · due Nov 21 · Service team')}</p>
                <p>${L('请各责任人今日 18:00 前反馈进展。', 'Owners, please reply with progress by 18:00 today.')}</p>
            </section>`, L),

        monthly: L => chrome(L('月报页面', 'Monthly Report'), `
            <div class="tm-split">
                <aside class="tm-panel tm-side">
                    <small>${L('月份', 'Month')}</small><span class="tm-select">2026-11</span>
                    <small>${L('模板', 'Template')}</small><span class="tm-select">${L('月度质量分析', 'Monthly quality review')}</span>
                    <span class="tm-btn is-primary">${L('让 AI 生成', 'Generate with AI')}</span>
                </aside>
                <section class="tm-panel" data-tour-focus>
                    <h4>${L('各指标达成率', 'Attainment by metric')}</h4>
                    ${bar(L('故障及时率', 'On-time'), 102, 110, 'is-ok')}
                    ${bar(L('一次解决率', 'First-time fix'), 96, 110, 'is-bad')}
                    ${bar(L('满意度', 'CSAT'), 96, 110, 'is-bad')}
                    ${bar(L('整改按期', 'Rectification'), 94, 110, 'is-bad')}
                    <h4>${L('AI 结论', 'AI findings')}</h4>
                    <p class="tm-muted">${L('本月综合得分 92.4，环比 +1.6。一次解决率连续两月下滑，主要集中在夜间工单，建议优先复盘。', 'Overall score 92.4, up 1.6 from last month. First-time fix rate has fallen two months in a row, mostly on night-shift tickets; review those first.')}</p>
                </section>
            </div>`, L),

        bigscreen: L => chrome(L('大屏看板', 'Big Screen Dashboard'), `
            <div class="tm-screen" data-tour-focus>
                <section><h4>${L('近 6 月得分趋势', '6-month score trend')}</h4>
                    <svg viewBox="0 0 200 70" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,50 40,44 80,48 120,34 160,30 200,22" fill="none" stroke="#3ecf9e" stroke-width="3"/><polyline points="0,58 40,56 80,52 120,50 160,46 200,44" fill="none" stroke="#5aa9ff" stroke-width="2" stroke-dasharray="4 4"/></svg>
                </section>
                <section><h4>${L('客户群排名', 'Customer groups')}</h4>
                    <ol><li>${L('客户群 A', 'Group A')}<b>96.1</b></li><li>${L('客户群 B', 'Group B')}<b>93.8</b></li><li>${L('客户群 C', 'Group C')}<b>90.2</b></li><li>${L('客户群 D', 'Group D')}<b class="is-bad">84.7</b></li></ol>
                </section>
                <section class="tm-wide"><h4>${L('风险提醒', 'Risks')}</h4>
                    <p><span class="tm-tag is-bad">${L('超期', 'Overdue')}</span> ${L('整改单 3 张，最久超期 4 天', '3 rectification tickets, up to 4 days overdue')}</p>
                    <p><span class="tm-tag is-warn">${L('临期', 'Due soon')}</span> ${L('CPT 专项风险 2 项将于 48 小时内到期', '2 CPT risks due within 48 hours')}</p>
                </section>
            </div>`, L),

        opsDrafts: L => chrome(L('运维待办', 'Ops Drafts'), `
            <section class="tm-panel tm-draft" data-tour-focus>
                <div class="tm-row"><span class="tm-tag is-ok">WeLink</span><b>${L('群：网络保障群', 'Group: Network support')}</b></div>
                <p class="tm-muted">${L('收件人：网络保障组 · 3 人', 'Recipients: Network team · 3 people')}</p>
                <blockquote>${L('各位好，整改单 ZG-1123 将于 11-20 到期，目前进度 60%。请今日 18:00 前反馈预计完成时间，谢谢。', 'Hi all, rectification ZG-1123 is due Nov 20 and is 60% complete. Please share an expected finish time by 18:00 today. Thanks.')}</blockquote>
                <div class="tm-row tm-end"><span class="tm-btn">${L('编辑', 'Edit')}</span><span class="tm-btn">${L('忽略', 'Dismiss')}</span><span class="tm-btn is-primary">${L('确认发送', 'Confirm & send')}</span></div>
            </section>
            <section class="tm-panel tm-draft is-dim">
                <div class="tm-row"><span class="tm-tag">${L('微信', 'WeChat')}</span><b>${L('私聊：客户服务组', 'Direct: Service team')}</b></div>
                <p class="tm-muted">${L('CPT 风险 R-0457 催办草稿 · 待确认', 'CPT risk R-0457 reminder · awaiting review')}</p>
            </section>`, L)
    };

    function chat(L) {
        return {
            prompt: L('查一下本月未达标的指标，再列出 3 天内到期的催办事项，并帮我拟好催办草稿。',
                'Show this month’s missed targets, list follow-ups due within 3 days, and draft the reminders.'),
            html: `<header class="tm-head"><span class="tm-dot"></span><strong>Dragon Claw</strong><em class="tm-sample">${L('示范回答', 'Sample reply')}</em></header>
                <div class="tm-chat" data-chat-thread>
                    <div class="tm-msg is-user" data-chat-user hidden></div>
                    <div class="tm-msg is-ai" data-chat-ai hidden><span class="tm-typing"><i></i><i></i><i></i></span></div>
                </div>
                <div class="tm-composer" data-chat-composer><span data-chat-input></span><span class="tm-caret"></span><span class="tm-send">↑</span></div>`,
            answer: [
                `<p>${L('根据 <b>11-17 入库的报表快照</b>，本月有 3 项指标未达标：', 'From the <b>Nov 17 report snapshot</b>, 3 targets were missed this month:')}</p>`,
                `<table class="tm-table"><thead><tr><th>${L('指标', 'Metric')}</th><th>${L('实际 / 目标', 'Actual / target')}</th><th>${L('差距', 'Gap')}</th></tr></thead><tbody>
                    <tr><td>${L('工单一次解决率', 'First-time fix rate')}</td><td>86.5% / 90%</td><td class="is-bad">−3.5</td></tr>
                    <tr><td>${L('客户满意度', 'Customer satisfaction')}</td><td>4.42 / 4.60</td><td class="is-bad">−0.18</td></tr>
                    <tr><td>${L('整改按期完成率', 'Rectification on time')}</td><td>94% / 100%</td><td class="is-bad">−6.0</td></tr></tbody></table>`,
                `<p><b>${L('3 天内到期', 'Due within 3 days')}</b></p><ul>
                    <li>${L('整改单 ZG-1123 · 11-20 截止 · 网络保障组', 'Rectification ZG-1123 · due Nov 20 · Network team')}</li>
                    <li>${L('CPT 风险 R-0457 · 11-21 截止 · 客户服务组', 'CPT risk R-0457 · due Nov 21 · Service team')}</li></ul>`,
                `<p><b>${L('催办草稿', 'Draft reminder')}</b></p><blockquote>${L('各位好，整改单 ZG-1123 将于 11-20 到期，请今日 18:00 前反馈预计完成时间。', 'Hi all, rectification ZG-1123 is due Nov 20. Please share an expected finish time by 18:00 today.')}</blockquote>`,
                `<p class="tm-muted">${L('草稿已放进「运维待办」，确认收件人后才会发送。', 'The draft is waiting in Ops Drafts and will only be sent after you confirm the recipients.')}</p>`
            ]
        };
    }

    window.HomeProductTourDemos = { tools: TOOLS, chat };
})();
