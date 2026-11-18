/**
 * 新手引导的静态演示：示范对话和各工具页面的真实截图。
 * 截图来自主线版真实数据，运营商、单号、工号、人名、头像和内部地址均已匿名处理（见 frontend/assets/tour/）。
 * 只用于引导层展示，不请求接口、不加载真实工具、不创建会话。
 * focus 是截图中高亮区域的比例坐标 [左, 上, 右, 下]。
 */
(function initHomeProductTourDemos() {
    if (window.HomeProductTourDemos) return;

    const shot = (name, w, h, focus) => ({ src: `/assets/tour/${name}.webp`, w, h, focus });

    const TOOLS = {
        uivf12: shot('uivf12', 1241, 785, [0.0121, 0.1439, 0.2055, 0.9197]),
        sla: shot('sla', 1241, 785, [0.0105, 0.1809, 0.9823, 1]),
        report: shot('report', 1333, 679, [0.0113, 0.3608, 0.9827, 1]),
        expedite: shot('expedite', 1241, 785, [0.0733, 0.5554, 0.9202, 1]),
        monthly: shot('monthly', 1241, 785, [0.0459, 0.1338, 0.9517, 0.9363]),
        bigscreen: shot('bigscreen', 1241, 785, [0.0161, 0.2803, 0.9831, 1]),
        opsDrafts: shot('opsDrafts', 1241, 785, [0.1346, 0.265, 0.8582, 0.7452])
    };

    function chat(L) {
        return {
            prompt: L('查一下本月未达标的指标，再列出临期和超期的催办事项，并帮我拟好催办草稿。',
                'Show this month’s missed targets, list due and overdue follow-ups, and draft the reminders.'),
            html: `<header class="tm-head"><span class="tm-dot"></span><strong>Dragon Claw</strong><em class="tm-sample">${L('示范回答 · 数据已匿名', 'Sample reply · anonymized')}</em></header>
                <div class="tm-chat" data-chat-thread>
                    <div class="tm-msg is-user" data-chat-user hidden></div>
                    <div class="tm-msg is-ai" data-chat-ai hidden><span class="tm-typing"><i></i><i></i><i></i></span></div>
                </div>
                <div class="tm-composer" data-chat-composer><span data-chat-input></span><span class="tm-caret"></span><span class="tm-send">↑</span></div>`,
            answer: [
                `<p>${L('根据 <b>2026-10-10 入库的 9 月报表快照</b>：客户群排名 V*F 100.15、T* 97.84、O*G 85.38、E* 80.78，未达标项最集中在 <b>E*（7 项）</b>。',
                    'From the <b>September snapshot saved on 2026-10-10</b>: customer groups rank V*F 100.15, T* 97.84, O*G 85.38, E* 80.78. Most missed targets are in <b>E* (7 items)</b>.')}</p>`,
                `<table class="tm-table"><thead><tr><th>${L('客户群', 'Group')}</th><th>${L('指标', 'Metric')}</th><th>${L('当前 → 目标', 'Actual → target')}</th></tr></thead><tbody>
                    <tr><td>E*</td><td>${L('维保订单', 'Maintenance orders')}</td><td class="is-bad">0.2 → ≥1.4</td></tr>
                    <tr><td>E*</td><td>${L('业务收入', 'Business revenue')}</td><td class="is-bad">2.6 → ≥4.7</td></tr>
                    <tr><td>E*</td><td>${L('PS GP 利润率', 'PS GP margin')}</td><td class="is-bad">9.8% → ≥20%</td></tr>
                    <tr><td>O*G</td><td>${L('过保订单及 SPMS', 'Out-of-warranty orders & SPMS')}</td><td class="is-bad">3.4 → ≥5.3</td></tr>
                    <tr><td>O*G</td><td>${L('日志回传率', 'Log upload rate')}</td><td class="is-bad">92% → ≥95%</td></tr>
                    <tr><td>T*</td><td>${L('日志稽查率', 'Log audit rate')}</td><td class="is-bad">71% → ≥80%</td></tr></tbody></table>`,
                `<p><b>${L('临期与超期', 'Due and overdue')}</b></p><ul>
                    <li>${L('整改单 RC2026********04 · Checking · <span class="is-bad">已超期 33 天</span> · 责任人 a8439**84', 'Rectification RC2026********04 · Checking · <span class="is-bad">33 days overdue</span> · owner a8439**84')}</li>
                    <li>${L('整改单 RC2026********64、RC2026********07 · 剩余 13 天（12/1/26 截止）', 'Rectification RC2026********64, RC2026********07 · 13 days left (due 12/1/26)')}</li>
                    <li>${L('CPT 专项风险：3 单处理中已超期 27–33 天，3 单草稿未确认', 'CPT risks: 3 in progress are 27–33 days overdue, 3 drafts are unconfirmed')}</li></ul>`,
                `<p><b>${L('催办草稿', 'Draft reminder')}</b></p><blockquote>${L('各位好，整改单 RC2026********64、RC2026********07 将于 12/1 到期，RC2026********04 已超期 33 天，请今日 18:00 前反馈处理进展，谢谢。', 'Hi all, rectification RC2026********64 and RC2026********07 are due Dec 1, and RC2026********04 is 33 days overdue. Please share progress by 18:00 today. Thanks.')}</blockquote>`,
                `<p class="tm-muted">${L('草稿已放进「运维待办」，确认收件人后才会发送。', 'The draft is waiting in Ops Drafts and will only be sent after you confirm the recipients.')}</p>`
            ]
        };
    }

    window.HomeProductTourDemos = { tools: TOOLS, chat };
})();
