/**
 * 新手引导的静态演示：示范对话和各工具的真实页面快照。
 * frontend/assets/tour/*.html 是从主线版真实页面导出的静态快照（已去掉脚本），
 * 运营商、单号、工号、人名、头像和内部地址均已匿名；引导里用无脚本 iframe 原样渲染。
 * 只用于引导层展示，不请求业务接口、不加载真实工具、不创建会话。
 */
(function initHomeProductTourDemos() {
    if (window.HomeProductTourDemos) return;

    // 快照按导出时的视口尺寸排版（1314×783），引导里按比例缩放显示。
    const page = name => ({ page: `/assets/tour/${name}.html`, w: 1314, h: 783 });

    const opsDraft = L => `<section class="ops-inbox-panel tm-ops">
        <header class="ops-inbox-heading"><div><span class="ops-eyebrow">${L('会话内运营草稿', 'DRAFTS FOR THIS CONVERSATION')}</span><h3>${L('待确认消息', 'Messages to review')}</h3><span class="ops-count">2</span><small class="ops-total">${L('全部 2 条待确认', '2 pending overall')}</small></div><button type="button" tabindex="-1">${L('刷新', 'Refresh')}</button></header>
        <p class="ops-inbox-description">${L('这里显示发往当前会话的草稿。发送前请核对正文和完整收件对象。', 'Drafts for this conversation are shown here. Check the text and all recipients before sending.')}</p>
        <div class="ops-card-list">
            <details class="ops-card" open data-tour-focus><summary><span class="ops-card-icon">✦</span><span class="ops-card-title"><b>${L('每日临期催办 · WeLink', 'Daily follow-up · WeLink')}</b><small>2026/11/18 09:00</small></span><span class="ops-tag">${L('待确认', 'Review')}</span></summary>
                <div class="ops-card-body"><div class="ops-recipients">${L('发送至：', 'Send to: ')}WeLink ${L('群「O*G 交付保障群」、单聊 a8440**02、o0083**61', 'group “O*G delivery”, direct a8440**02, o0083**61')}</div>
                <div class="ops-preview">📅【11-Month】Follow-up Reminder
@所有人 Hi Team, the following items are due within 3 days:

🔹 [O*G]:
    ↳ Rectification RC2026********07 · due 12/1/26 · owner a8440**02
    ↳ Rectification RC2026********64 · due 12/1/26 · owner o0083**61
🔹 [E*]:
    ↳ 🚨 CPT2026********00 · overdue 27 days · owner N*** A***

Please reply with progress before 18:00 today. Thanks!</div>
                <div class="ops-card-actions"><button type="button" class="ops-primary" tabindex="-1">${L('确认并发送', 'Confirm & send')}</button><button type="button" tabindex="-1">${L('修改正文', 'Edit')}</button><button type="button" class="ops-discard" tabindex="-1">${L('丢弃', 'Discard')}</button><span class="ops-send-hint">${L('确认后立即发送到上述全部对象', 'Confirmation sends immediately to all recipients listed above')}</span></div></div></details>
            <details class="ops-card"><summary><span class="ops-card-icon">✦</span><span class="ops-card-title"><b>${L('CPT 风险周报 · 微信', 'CPT risk weekly · WeChat')}</b><small>2026/11/18 09:00</small></span><span class="ops-tag">${L('待确认', 'Review')}</span></summary></details>
        </div></section>`;

    const TOOLS = {
        uivf12: page('uivf12'),
        sla: page('sla'),
        report: page('report'),
        expedite: page('expedite'),
        monthly: page('monthly'),
        bigscreen: page('bigscreen'),
        opsDrafts: { html: opsDraft }
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
