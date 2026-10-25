// 全局设置 › 频道对接 › 运营：自动化运营群组的查看与快捷操作。
// 运营规范、运营群组、运营计划（新建/编辑/启停/立即生成/测试推送）、草稿确认与推送记录。
// 也可以在首页 Dragon Claw 里用 @ops-group 用对话方式完成同样的配置。
// 由 channel-settings.js 在切到「运营」标签时加载，复用其 .nch-* 样式与 ToolsChannels 选择器。
(function () {
    'use strict';
    if (window.ToolsChannelOps) return;

    const API = '/api/channels/ops';
    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const CHANNEL_LABEL = { welink: 'WeLink', weixin: L('微信', 'WeChat') };
    const SOURCE_LABEL = { highlights: L('功能亮点（随机抽取）', 'Feature highlights'), features: L('平台新功能', 'New features'), videos: L('小视频', 'Videos'), metrics: L('指标/报表', 'Metrics'), chat: L('群聊上下文', 'Group chat') };
    const STATUS = {
        generating: ['生成中', 'Generating', ''],
        draft: ['待确认', 'Draft', 'warn'],
        sending: ['发送中', 'Sending', ''],
        sent: ['已发送', 'Sent', 'ok'],
        partial: ['部分成功', 'Partial', 'warn'],
        failed: ['失败', 'Failed', 'bad'],
        discarded: ['已作废', 'Discarded', '']
    };
    const TRIGGER = { schedule: ['定时', 'Scheduled'], manual: ['手动', 'Manual'], test: ['测试', 'Test'] };
    const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

    const state = { root: null, data: null, library: { topics: [], angles: [], presets: [] }, editing: null, busy: '', notice: null, openRuns: new Set() };

    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function request(method, path, body) {
        const res = await fetch(`${API}${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() }, body: body !== undefined ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    function confirmDialog(message, options = {}) {
        return window.AppDialog
            ? window.AppDialog.confirm(message, { cancelText: L('取消', 'Cancel'), ...options })
            : window.showNavbarConfirm({ message, cancelText: L('取消', 'Cancel'), ...options });
    }

    function targetLabel(target) {
        const group = state.data?.groups.find(item => item.channel === target.channel && item.kind === target.kind && item.id === target.id);
        return `${target.kind === 'group' ? '👥' : '👤'} ${group?.name || target.id}`;
    }

    function time(iso) {
        return iso ? new Date(iso).toLocaleString() : '—';
    }

    // ── 渲染 ─────────────────────────────────────────────
    function renderIntro() {
        const settings = state.data.settings;
        return `<section class="nch-card">
            <h4>📣 ${esc(L('自动化运营', 'Automated operations'))}</h4>
            <p class="nch-desc">${esc(L('把 WeLink 群、微信联系人设为运营群组，按计划定时推送平台新功能、使用小技巧、小视频与指标看点；群成员 @助手 时按运营人设互动。也可以在首页 Dragon Claw 输入 @ops-group，用对话方式配置、测试、检查与推送。', 'Mark WeLink groups or WeChat contacts as ops groups and push feature tips, videos and metric highlights on a schedule. Members who @mention the assistant get the ops persona. You can also configure everything in Dragon Claw with @ops-group.'))}</p>
            <div class="nch-grid">
                <label class="nch-field nch-wide"><span>${esc(L('运营话术规范（所有计划生成内容与运营群互动都遵守）', 'Style guide (used by all plans and ops-group replies)'))}</span><textarea data-ops-field="styleGuide" style="height:120px">${esc(settings.styleGuide)}</textarea></label>
                <label class="nch-field nch-wide"><span>${esc(L('平台对外访问地址', 'Public platform URL'))}</span><input data-ops-field="publicBaseUrl" value="${esc(settings.publicBaseUrl)}" placeholder="https://tools.example.com"><small>${esc(L('用于生成功能与视频的完整链接；不填时为站内相对路径，手机上无法直接打开。', 'Used to build full links for features and videos.'))}</small></label>
            </div>
            <div class="nch-row"><button type="button" class="nch-btn primary" data-ops-action="save-settings" ${state.busy ? 'disabled' : ''}>${esc(L('保存规范', 'Save'))}</button>${state.notice ? `<span class="nch-muted" style="color:${state.notice.kind === 'bad' ? '#b91c1c' : '#166534'}">${esc(state.notice.text)}</span>` : ''}</div>
        </section>`;
    }

    function renderGroups() {
        const rows = state.data.groups.map(group => `<tr>
            <td>${esc(CHANNEL_LABEL[group.channel] || group.channel)}</td>
            <td><b>${esc(group.name)}</b><div class="nch-id">${esc(group.id)}</div></td>
            <td><textarea data-ops-group-field="profile" data-key="${esc(`${group.channel}|${group.kind}|${group.id}`)}" rows="2" style="width:100%;min-width:180px;font:inherit;font-size:12px">${esc(group.profile)}</textarea></td>
            <td><textarea data-ops-group-field="interactionPrompt" data-key="${esc(`${group.channel}|${group.kind}|${group.id}`)}" rows="2" style="width:100%;min-width:180px;font:inherit;font-size:12px">${esc(group.interactionPrompt)}</textarea></td>
            <td style="white-space:nowrap"><button type="button" class="nch-link" data-ops-action="save-group" data-key="${esc(`${group.channel}|${group.kind}|${group.id}`)}">${esc(L('保存', 'Save'))}</button><button type="button" class="nch-link danger" data-ops-action="remove-group" data-key="${esc(`${group.channel}|${group.kind}|${group.id}`)}">${esc(L('移除', 'Remove'))}</button></td>
        </tr>`).join('');
        return `<section class="nch-card">
            <h4>👥 ${esc(L('运营群组', 'Ops groups'))}</h4>
            <p class="nch-desc">${esc(L('群画像告诉 AI 这个群是谁、关心什么；互动人设决定成员 @助手 时的语气与小活动。微信只能选联系人（不能推群），对方近期给助理发过消息才能收到推送。', 'The profile tells the AI who the group is; the persona shapes replies when members @mention the assistant. WeChat supports contacts only.'))}</p>
            <div class="nch-row" style="margin-top:0">
                <button type="button" class="nch-btn" data-ops-action="add-group" data-channel="welink">${esc(L('添加 WeLink 群', 'Add WeLink group'))}</button>
                <button type="button" class="nch-btn" data-ops-action="add-group" data-channel="weixin">${esc(L('添加微信联系人', 'Add WeChat contact'))}</button>
            </div>
            <div class="nch-table-wrap"><table class="nch-table">
                <thead><tr><th>${esc(L('频道', 'Channel'))}</th><th>${esc(L('名称', 'Name'))}</th><th>${esc(L('群画像', 'Profile'))}</th><th>${esc(L('互动人设', 'Persona'))}</th><th></th></tr></thead>
                <tbody>${rows || `<tr><td colspan="5" class="nch-muted">${esc(L('还没有运营群组', 'No ops groups yet'))}</td></tr>`}</tbody>
            </table></div>
        </section>`;
    }

    function planCard(plan) {
        const drafts = state.data.runs.filter(run => run.planId === plan.id && run.status === 'draft').length;
        return `<div class="nch-access-col" style="margin-top:10px">
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <b style="font-size:14px">${esc(plan.name)}</b>
                <span class="nch-badge ${plan.enabled ? 'ok' : ''}">${esc(plan.enabled ? L('定时已启用', 'Scheduled') : L('未启用', 'Paused'))}</span>
                <span class="nch-badge">${esc(plan.scheduleText)}</span>
                <span class="nch-badge ${plan.sendMode === 'auto' ? 'warn' : ''}">${esc(plan.sendMode === 'auto' ? L('到点自动发送', 'Auto send') : L('到点生成草稿', 'Draft first'))}</span>
                <span class="nch-badge">${esc(plan.contentMode === 'ai' ? L('AI 生成', 'AI') : L('模板', 'Template'))}</span>
                ${drafts ? `<span class="nch-badge warn">${esc(L(`${drafts} 条草稿待确认`, `${drafts} drafts`))}</span>` : ''}
            </div>
            <div class="nch-muted" style="margin-top:6px">${esc(L('推送对象：', 'Targets: '))}${esc(plan.targets.map(targetLabel).join('、'))}</div>
            <div class="nch-muted">${esc(L('素材：', 'Sources: '))}${esc(plan.sources.map(item => SOURCE_LABEL[item] || item).join('、') || L('无', 'none'))} · ${esc(L('下次运行：', 'Next run: '))}${esc(plan.enabled ? time(plan.nextRunAt) : '—')} · ${esc(L('上次：', 'Last: '))}${esc(time(plan.lastRunAt))}</div>
            <div class="nch-text nch-muted" style="margin-top:6px;white-space:pre-wrap;color:#334155">${esc((plan.contentMode === 'ai' ? plan.prompt : plan.template).slice(0, 300))}</div>
            <div class="nch-row">
                <button type="button" class="nch-btn primary" data-ops-action="run-draft" data-id="${esc(plan.id)}" ${state.busy ? 'disabled' : ''}>${esc(state.busy === `run-${plan.id}` ? L('生成中…', 'Generating…') : L('立即生成草稿', 'Generate draft'))}</button>
                <button type="button" class="nch-btn" data-ops-action="test-send" data-channel="weixin" data-id="${esc(plan.id)}" ${state.busy ? 'disabled' : ''}>${esc(L('测试推送到微信…', 'Test to WeChat…'))}</button>
                <button type="button" class="nch-btn" data-ops-action="test-send" data-channel="welink" data-id="${esc(plan.id)}" ${state.busy ? 'disabled' : ''}>${esc(L('测试推送到 WeLink…', 'Test to WeLink…'))}</button>
                <button type="button" class="nch-btn" data-ops-action="toggle-plan" data-id="${esc(plan.id)}">${esc(plan.enabled ? L('停用定时', 'Pause') : L('启用定时', 'Enable'))}</button>
                <button type="button" class="nch-btn" data-ops-action="edit-plan" data-id="${esc(plan.id)}">${esc(L('编辑', 'Edit'))}</button>
                <button type="button" class="nch-link danger" data-ops-action="delete-plan" data-id="${esc(plan.id)}">${esc(L('删除', 'Delete'))}</button>
            </div>
        </div>`;
    }

    function renderEditor() {
        const p = state.editing;
        if (!p) return '';
        const groups = state.data.groups;
        const checked = target => p.targets.some(item => item.channel === target.channel && item.kind === target.kind && item.id === target.id);
        const s = p.schedule;
        return `<div class="nch-access-col" style="margin-top:10px;background:#fff;border-color:#93c5fd" data-role="ops-editor">
            <h5>${esc(p.id ? L('编辑运营计划', 'Edit plan') : L('新建运营计划', 'New plan'))}</h5>
            <div class="nch-grid">
                <label class="nch-field"><span>${esc(L('名称', 'Name'))}</span><input data-ops-plan="name" value="${esc(p.name)}" maxlength="80"></label>
                <label class="nch-field"><span>${esc(L('内容方式', 'Content'))}</span><select data-ops-plan="contentMode"><option value="ai" ${p.contentMode === 'ai' ? 'selected' : ''}>${esc(L('AI 按提示词生成', 'AI prompt'))}</option><option value="template" ${p.contentMode === 'template' ? 'selected' : ''}>${esc(L('固定模板 + 变量', 'Template'))}</option></select></label>
                <label class="nch-field"><span>${esc(L('发送方式', 'Send mode'))}</span><select data-ops-plan="sendMode"><option value="draft" ${p.sendMode === 'draft' ? 'selected' : ''}>${esc(L('到点生成草稿，确认后发送', 'Draft, confirm to send'))}</option><option value="auto" ${p.sendMode === 'auto' ? 'selected' : ''}>${esc(L('到点自动发送', 'Send automatically'))}</option></select></label>
                <label class="nch-field nch-wide"><span>${esc(p.contentMode === 'ai' ? L('运营提示词', 'Prompt') : L('消息模板', 'Template'))}</span><textarea data-ops-plan="${p.contentMode === 'ai' ? 'prompt' : 'template'}" style="height:100px">${esc(p.contentMode === 'ai' ? p.prompt : p.template)}</textarea>
                    <small>${esc(p.contentMode === 'ai' ? L('写清这条消息讲什么、风格、长度和互动方式；会自动带上运营规范、群画像与所选素材。', 'Describe topic, tone, length and interaction.') : L('变量：{{date}} {{weekday}} {{group}} {{highlight_title}} {{highlight}} {{highlight_pain}} {{highlight_howto}} {{highlight_link}} {{angle}} {{video_title}} {{video_link}} {{video_desc}} {{feature}} {{features}} {{platform_url}}', 'Variables: {{date}} {{weekday}} {{group}} {{video_title}} {{video_link}} {{feature}} {{features}} {{platform_url}}'))}</small></label>
            </div>
            <div class="nch-muted" style="margin:10px 0 4px">${esc(L('推送对象（运营群组）', 'Targets (ops groups)'))}</div>
            <div class="nch-chips">${groups.length ? groups.map((group, index) => `<label class="nch-chip ${group.kind === 'group' ? 'group' : ''}" style="padding-right:9px"><input type="checkbox" data-ops-target="${index}" ${checked(group) ? 'checked' : ''}> <span>${esc(CHANNEL_LABEL[group.channel])} · ${esc(group.name)}</span></label>`).join('') : `<span class="nch-muted">${esc(L('请先在上方添加运营群组', 'Add ops groups first'))}</span>`}</div>
            <div class="nch-muted" style="margin:10px 0 4px">${esc(L('素材', 'Sources'))}</div>
            <div class="nch-chips">${Object.keys(SOURCE_LABEL).map(key => `<label class="nch-chip" style="padding-right:9px"><input type="checkbox" data-ops-source="${key}" ${p.sources.includes(key) ? 'checked' : ''}> <span>${esc(SOURCE_LABEL[key])}</span></label>`).join('')}</div>
            <div class="nch-grid" style="margin-top:10px">
                <label class="nch-field"><span>${esc(L('视频分类（可选）', 'Video category'))}</span><input data-ops-plan="options.videoCategory" value="${esc(p.options.videoCategory)}" placeholder="${esc(L('留空为全部公开分类', 'All public categories'))}"></label>
                <label class="nch-field"><span>${esc(L('新功能回看天数', 'Feature lookback (days)'))}</span><input type="number" min="1" max="90" data-ops-plan="options.featureDays" value="${esc(p.options.featureDays)}"></label>
                <label class="nch-field"><span>${esc(L('亮点专题', 'Highlight topic'))}</span><select data-ops-plan="options.highlightTopic">${state.library.topics.map(topic => `<option value="${esc(topic.id)}" ${p.options.highlightTopic === topic.id ? 'selected' : ''}>${esc(topic.name)}（${topic.count}）</option>`).join('')}</select></label>
                <label class="nch-field"><span>${esc(L('每次抽取亮点数', 'Highlights per run'))}</span><input type="number" min="1" max="5" data-ops-plan="options.highlightCount" value="${esc(p.options.highlightCount || 1)}"></label>
                <label class="nch-field"><span>${esc(L('运营角度', 'Angle'))}</span><select data-ops-plan="options.angle"><option value="random" ${(p.options.angle || 'random') === 'random' ? 'selected' : ''}>${esc(L('每次随机换一种', 'Random each time'))}</option>${state.library.angles.map(angle => `<option value="${esc(angle.id)}" ${p.options.angle === angle.id ? 'selected' : ''} title="${esc(angle.guide)}">${esc(angle.name)}</option>`).join('')}</select></label>
                <label class="nch-field"><span>${esc(L('定时方式', 'Schedule'))}</span><select data-ops-plan="schedule.type"><option value="daily" ${s.type === 'daily' ? 'selected' : ''}>${esc(L('每天', 'Daily'))}</option><option value="weekly" ${s.type === 'weekly' ? 'selected' : ''}>${esc(L('每周', 'Weekly'))}</option><option value="interval" ${s.type === 'interval' ? 'selected' : ''}>${esc(L('固定间隔', 'Interval'))}</option></select></label>
                ${s.type === 'interval'
                    ? `<label class="nch-field"><span>${esc(L('间隔（分钟）', 'Interval (min)'))}</span><input type="number" min="30" data-ops-plan="schedule.intervalMinutes" value="${esc(s.intervalMinutes || 1440)}"></label>`
                    : `<label class="nch-field"><span>${esc(L('发送时刻（开罗时间，逗号分隔）', 'Times (Cairo, comma separated)'))}</span><input data-ops-plan="schedule.times" value="${esc(s.times.join(', '))}" placeholder="09:30, 16:00"></label>`}
            </div>
            ${s.type === 'weekly'
                ? `<div class="nch-chips" style="margin-top:8px">${WEEKDAYS.map((name, day) => `<label class="nch-chip" style="padding-right:9px"><input type="checkbox" data-ops-weekday="${day}" ${s.weekdays.includes(day) ? 'checked' : ''}> <span>${esc(L(`周${name}`, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]))}</span></label>`).join('')}</div>`
                : `<label class="nch-switch" style="margin-top:8px"><input type="checkbox" data-ops-plan="schedule.workdaysOnly" ${s.workdaysOnly ? 'checked' : ''}> ${esc(L('只在工作日（按工作日历）', 'Workdays only'))}</label>`}
            <label class="nch-switch" style="margin-top:8px"><input type="checkbox" data-ops-plan="enabled" ${p.enabled ? 'checked' : ''}> ${esc(L('启用定时（建议先测试满意后再启用）', 'Enable schedule (test first)'))}</label>
            <div class="nch-row"><button type="button" class="nch-btn primary" data-ops-action="save-plan" ${state.busy ? 'disabled' : ''}>${esc(L('保存计划', 'Save plan'))}</button><button type="button" class="nch-btn" data-ops-action="cancel-edit">${esc(L('取消', 'Cancel'))}</button></div>
        </div>`;
    }

    function renderPlans() {
        return `<section class="nch-card">
            <h4>🗓️ ${esc(L('运营计划', 'Plans'))}</h4>
            <p class="nch-desc">${esc(L('每个计划决定推给哪些群、生成什么、什么时候发。新计划默认「到点生成草稿」，可在主页对话区、全局提醒或下方记录中修改并确认发送；跑稳后可切到自动发送。', 'Each plan defines targets, content and schedule. Review, edit and send drafts in home chat, the global reminder or the history below.'))}</p>
            <div class="nch-row" style="margin-top:0">
                <button type="button" class="nch-btn primary" data-ops-action="new-plan">${esc(L('新建计划', 'New plan'))}</button>
                ${state.library.presets.length ? `<select data-ops-preset style="height:30px;border:1px solid #cbd5e1;border-radius:7px;padding:0 8px;font-size:12px;max-width:100%"><option value="">${esc(L('从内置模板新建…', 'New from template…'))}</option>${state.library.presets.map(preset => `<option value="${esc(preset.id)}" title="${esc(preset.description)}">${esc(preset.name)}</option>`).join('')}</select>` : ''}
            </div>
            ${state.editing && !state.editing.id ? renderEditor() : ''}
            ${state.data.plans.map(plan => (state.editing?.id === plan.id ? renderEditor() : planCard(plan))).join('') || (!state.editing ? `<div class="nch-muted" style="margin-top:8px">${esc(L('还没有运营计划。', 'No plans yet.'))}</div>` : '')}
        </section>`;
    }

    function renderRuns() {
        const rows = state.data.runs.map(run => {
            const status = STATUS[run.status] || [run.status, run.status, ''];
            const open = run.status === 'draft' || state.openRuns.has(run.id);
            return `<div class="nch-access-col" style="margin-top:10px">
                <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                    <span class="nch-badge ${status[2]}">${esc(L(status[0], status[1]))}</span>
                    <b>${esc(run.planName || run.planId)}</b>
                    <span class="nch-muted">${esc(L((TRIGGER[run.trigger] || [run.trigger])[0], (TRIGGER[run.trigger] || [run.trigger, run.trigger])[1]))} · ${esc(time(run.createdAt))}${run.sentAt ? ` · ${esc(L('发送于', 'sent'))} ${esc(time(run.sentAt))}` : ''}</span>
                    <span class="nch-muted">→ ${esc(run.targets.map(targetLabel).join('、'))}</span>
                    ${run.status !== 'draft' ? `<button type="button" class="nch-link" data-ops-action="toggle-run" data-id="${esc(run.id)}">${esc(open ? L('收起', 'Less') : L('查看内容', 'Show'))}</button>` : ''}
                </div>
                ${run.meta?.highlightTitles?.length || run.meta?.videoTitle ? `<div class="nch-id" style="margin-top:4px">${run.meta.highlightTitles?.length ? `${esc(L('亮点：', 'Highlights: '))}${esc(run.meta.highlightTitles.join('、'))}` : ''}${run.meta.angle ? ` · ${esc(L('角度：', 'Angle: '))}${esc(state.library.angles.find(item => item.id === run.meta.angle)?.name || run.meta.angle)}` : ''}${run.meta.videoTitle ? ` · ${esc(L('视频：', 'Video: '))}${esc(run.meta.videoTitle)}` : ''}</div>` : ''}
                ${run.error ? `<div class="nch-id" style="color:#b91c1c;margin-top:4px">${esc(run.error)}</div>` : ''}
                ${run.status === 'draft'
                    ? `<textarea data-ops-draft="${esc(run.id)}" style="width:100%;height:150px;margin-top:8px;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font:inherit;font-size:13px">${esc(run.content)}</textarea>
                       <div class="nch-row"><button type="button" class="nch-btn primary" data-ops-action="send-draft" data-id="${esc(run.id)}" ${state.busy ? 'disabled' : ''}>${esc(state.busy === `send-${run.id}` ? L('发送中…', 'Sending…') : L('确认推送', 'Send now'))}</button><button type="button" class="nch-btn" data-ops-action="save-draft" data-id="${esc(run.id)}">${esc(L('保存修改', 'Save edits'))}</button><button type="button" class="nch-link danger" data-ops-action="discard-draft" data-id="${esc(run.id)}">${esc(L('作废', 'Discard'))}</button></div>`
                    : open ? `<div class="nch-text" style="white-space:pre-wrap;margin-top:8px;font-size:12px;color:#334155">${esc(run.content)}</div>${run.results.length ? `<div class="nch-id" style="margin-top:4px">${esc(run.results.map(item => `${item.name}：${item.ok ? '✅' : `❌ ${item.error}`}`).join('；'))}</div>` : ''}` : ''}
            </div>`;
        }).join('');
        return `<section class="nch-card">
            <h4>🧾 ${esc(L('草稿与推送记录', 'Drafts & history'))} <button type="button" class="nch-link" data-ops-action="refresh">${esc(L('刷新', 'Refresh'))}</button></h4>
            <p class="nch-desc">${esc(L('显示最近 40 条；系统最多保留最近 1000 条记录，更早的自动清理，不会无限增长。', 'Showing the latest 40. Only the latest 1000 records are kept; older ones are pruned automatically.'))}</p>
            ${rows || `<div class="nch-muted">${esc(L('还没有记录', 'No records yet'))}</div>`}
        </section>`;
    }

    function render() {
        if (!state.root) return;
        if (!state.data) {
            state.root.innerHTML = `<div class="nav-settings-empty">${esc(L('正在加载运营配置…', 'Loading…'))}</div>`;
            return;
        }
        state.root.innerHTML = renderIntro() + renderGroups() + renderPlans() + renderRuns();
    }

    async function load() {
        const [data, library] = await Promise.all([request('GET', '/overview'), state.library.presets.length ? state.library : request('GET', '/library').catch(() => state.library)]);
        state.data = data;
        state.library = library;
        render();
    }

    // 执行期间只禁用按钮、不重绘，避免冲掉其他输入框里尚未保存的内容；成功后重新加载，失败保留现场
    async function busy(name, task) {
        if (state.busy) return;
        state.busy = name;
        const buttons = [...state.root.querySelectorAll('[data-ops-action]')];
        const pressed = state.pressed;
        const label = pressed?.textContent;
        buttons.forEach(button => { button.disabled = true; });
        if (pressed && name !== 'refresh') pressed.textContent = L('处理中…', 'Working…');
        try {
            await task();
            state.busy = '';
            await load();
        } catch (error) {
            state.busy = '';
            buttons.forEach(button => { button.disabled = false; });
            if (pressed) pressed.textContent = label;
            window.showToast?.(error.message);
        }
    }

    function blankPlan() {
        return { name: '', enabled: false, targets: [], contentMode: 'ai', prompt: '', template: '', sources: ['features'], options: { videoCategory: '', featureDays: 7, highlightTopic: 'ai-report', highlightCount: 1, angle: 'random' }, schedule: { type: 'daily', times: ['09:30'], weekdays: [0], workdaysOnly: true, intervalMinutes: 1440 }, sendMode: 'draft' };
    }

    // 从编辑区读回表单值（只读当前渲染的字段）
    function readEditor() {
        const p = state.editing;
        const box = state.root.querySelector('[data-role="ops-editor"]');
        if (!p || !box) return;
        box.querySelectorAll('[data-ops-plan]').forEach(el => {
            const key = el.dataset.opsPlan;
            const value = el.type === 'checkbox' ? el.checked : el.value;
            if (key === 'schedule.times') p.schedule.times = String(value).split(/[,，\s]+/).filter(Boolean);
            else if (key.includes('.')) {
                const [group, field] = key.split('.');
                p[group][field] = el.type === 'number' ? Number(value) : value;
            } else p[key] = value;
        });
        p.targets = [...box.querySelectorAll('[data-ops-target]')].filter(el => el.checked).map(el => {
            const group = state.data.groups[Number(el.dataset.opsTarget)];
            return { channel: group.channel, kind: group.kind, id: group.id };
        });
        p.sources = [...box.querySelectorAll('[data-ops-source]')].filter(el => el.checked).map(el => el.dataset.opsSource);
        const weekdays = [...box.querySelectorAll('[data-ops-weekday]')];
        if (weekdays.length) p.schedule.weekdays = weekdays.filter(el => el.checked).map(el => Number(el.dataset.opsWeekday));
    }

    function groupByKey(key) {
        const [channel, kind, ...rest] = String(key).split('|');
        return { channel, kind, id: rest.join('|') };
    }

    async function onClick(event) {
        const button = event.target.closest('[data-ops-action]');
        if (!button) return;
        const action = button.dataset.opsAction;
        const id = button.dataset.id;
        state.pressed = button;
        state.notice = null;
        if (action === 'refresh') return busy('refresh', async () => {});
        // 先读取输入框再进入 busy：busy 会重绘面板，之后再读就只剩保存前的旧值
        if (action === 'save-settings') {
            const settings = { styleGuide: state.root.querySelector('[data-ops-field="styleGuide"]').value, publicBaseUrl: state.root.querySelector('[data-ops-field="publicBaseUrl"]').value };
            return busy('settings', async () => {
                await request('PUT', '/settings', settings);
                state.notice = { kind: 'ok', text: L('已保存', 'Saved') };
            });
        }
        if (action === 'add-group') {
            const channel = button.dataset.channel;
            const picked = await window.ToolsChannels.pickTargets({ channel, title: L(`选择要运营的${channel === 'weixin' ? '微信联系人' : 'WeLink 群'}`, 'Choose ops targets'), kind: channel === 'weixin' ? 'user' : 'group', lockKind: true });
            if (!picked?.length) return undefined;
            return busy('groups', async () => {
                for (const item of picked) await request('PUT', '/groups', { channel, kind: item.kind, id: item.id, name: item.name });
            });
        }
        if (action === 'save-group') {
            const ref = groupByKey(button.dataset.key);
            const field = name => [...state.root.querySelectorAll(`[data-ops-group-field="${name}"]`)].find(el => el.dataset.key === button.dataset.key)?.value || '';
            const patch = { ...ref, profile: field('profile'), interactionPrompt: field('interactionPrompt') };
            return busy('groups', async () => {
                await request('PUT', '/groups', patch);
                window.showToast?.(L('已保存', 'Saved'));
            });
        }
        if (action === 'remove-group') {
            if (!await confirmDialog(L('取消该运营群组标记？已有计划中的推送对象不受影响。', 'Remove this ops group?'), { title: L('移除运营群组', 'Remove'), tone: 'danger', confirmText: L('移除', 'Remove') })) return undefined;
            const ref = groupByKey(button.dataset.key);
            return busy('groups', () => request('DELETE', `/groups/${encodeURIComponent(ref.channel)}/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.id)}`));
        }
        if (action === 'new-plan') {
            state.editing = blankPlan();
            return render();
        }
        if (action === 'edit-plan') {
            state.editing = JSON.parse(JSON.stringify(state.data.plans.find(plan => plan.id === id)));
            return render();
        }
        if (action === 'cancel-edit') {
            state.editing = null;
            return render();
        }
        if (action === 'save-plan') {
            readEditor();
            const plan = state.editing;
            return busy('save-plan', async () => {
                const { id: planId, scheduleText, nextRunAt, lastRunAt, createdAt, updatedAt, createdBy, ...body } = plan;
                await request(planId ? 'PUT' : 'POST', planId ? `/plans/${encodeURIComponent(planId)}` : '/plans', body);
                state.editing = null;
            });
        }
        if (action === 'toggle-plan') {
            const plan = state.data.plans.find(item => item.id === id);
            return busy('toggle', () => request('PUT', `/plans/${encodeURIComponent(id)}`, { enabled: !plan.enabled }));
        }
        if (action === 'delete-plan') {
            if (!await confirmDialog(L('删除这个运营计划？推送记录会保留。', 'Delete this plan? History is kept.'), { title: L('删除计划', 'Delete plan'), tone: 'danger', confirmText: L('删除', 'Delete') })) return undefined;
            return busy('delete', () => request('DELETE', `/plans/${encodeURIComponent(id)}`));
        }
        if (action === 'run-draft') return busy(`run-${id}`, () => request('POST', `/plans/${encodeURIComponent(id)}/run`, { mode: 'draft' }));
        if (action === 'test-send') {
            const channel = button.dataset.channel === 'weixin' ? 'weixin' : 'welink';
            const picked = await window.ToolsChannels.pickTargets({ channel, title: L('选择测试推送对象', 'Choose test recipients'), pushableOnly: true });
            if (!picked?.length) return undefined;
            return busy(`run-${id}`, async () => {
                const run = await request('POST', `/plans/${encodeURIComponent(id)}/test`, { targets: picked.map(item => ({ channel, kind: item.kind, id: item.id })) });
                window.showToast?.(run.status === 'sent' ? L('测试推送已发送', 'Test sent') : `${L('测试推送失败：', 'Test failed: ')}${run.error}`);
            });
        }
        if (action === 'save-draft' || action === 'send-draft') {
            const content = state.root.querySelector(`[data-ops-draft="${CSS.escape(id)}"]`)?.value || '';
            if (action === 'save-draft') return busy('draft', () => request('PUT', `/runs/${encodeURIComponent(id)}`, { content }));
            const run = state.data.runs.find(item => item.id === id);
            if (!await confirmDialog(L(`确认推送到：${run.targets.map(targetLabel).join('、')}？`, 'Send to the targets now?'), { title: L('确认推送', 'Send'), confirmText: L('推送', 'Send') })) return undefined;
            return busy(`send-${id}`, async () => {
                const result = await request('POST', `/runs/${encodeURIComponent(id)}/send`, { content });
                window.showToast?.(result.status === 'sent' ? L('已推送', 'Sent') : `${L('推送未全部成功：', 'Partly failed: ')}${result.error}`);
            });
        }
        if (action === 'discard-draft') return busy('draft', () => request('POST', `/runs/${encodeURIComponent(id)}/discard`));
        if (action === 'toggle-run') {
            if (state.openRuns.has(id)) state.openRuns.delete(id);
            else state.openRuns.add(id);
            return render();
        }
        return undefined;
    }

    // 编辑区里切换「内容方式 / 定时方式」需要换字段：先读回当前值再重绘
    function onChange(event) {
        if (event.target.matches?.('[data-ops-preset]')) {
            const preset = state.library.presets.find(item => item.id === event.target.value);
            if (!preset) return;
            const base = blankPlan();
            const { id, description, ...fields } = JSON.parse(JSON.stringify(preset));
            state.editing = { ...base, ...fields, options: { ...base.options, ...(fields.options || {}) }, schedule: { ...base.schedule, ...(fields.schedule || {}) }, targets: [], enabled: false };
            render();
            state.root.querySelector('[data-role="ops-editor"]')?.scrollIntoView({ block: 'nearest' });
            return;
        }
        const key = event.target.dataset?.opsPlan;
        if (key === 'contentMode' || key === 'schedule.type') {
            readEditor();
            render();
        }
    }

    async function renderInto(root) {
        state.root = root;
        state.editing = null;
        state.data = null;
        render();
        if (!root.dataset.opsBound) {
            root.dataset.opsBound = '1';
            root.addEventListener('click', event => { onClick(event).catch(error => window.showToast?.(error.message)); });
            root.addEventListener('change', onChange);
        }
        try {
            await load();
        } catch (error) {
            root.innerHTML = `<div class="nav-settings-empty">${esc(L('加载失败：', 'Failed to load: '))}${esc(error.message)}</div>`;
        }
    }

    window.ToolsChannelOps = { render: renderInto };
})();
