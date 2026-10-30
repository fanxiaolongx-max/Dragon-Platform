// 全局设置 › 平台推广：首页右上角推广区的显示设置、内置视频开关、推广链接增删改。
// 由 navbar.js 在切换到 promotions 标签时按需加载；保存后派发 tools:platform-promotions-changed，首页即时生效。
(function () {
    'use strict';
    if (window.ToolsPromotionSettings) return;

    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const clone = value => JSON.parse(JSON.stringify(value));
    const confirmDialog = (message, options = {}) => (window.AppDialog
        ? window.AppDialog.confirm(message, { cancelText: L('取消', 'Cancel'), ...options })
        : window.showNavbarConfirm({ message, cancelText: L('取消', 'Cancel'), ...options }));
    const COLORS = [
        ['teal', '青绿', 'Teal', '#14b8a6'], ['blue', '蓝', 'Blue', '#3b82f6'], ['violet', '紫', 'Violet', '#8b5cf6'],
        ['orange', '橙', 'Orange', '#f97316'], ['rose', '玫红', 'Rose', '#f43f5e'], ['green', '绿', 'Green', '#10b981']
    ];
    const colorHex = id => (COLORS.find(item => item[0] === id) || COLORS[0])[3];
    const EMPTY_LINK = { id: '', builtin: false, enabled: true, name: '', nameEn: '', badge: '', badgeEn: '', description: '', descriptionEn: '', url: '', color: 'blue', coverImage: '' };

    const view = { content: null, config: null, draft: null, dirty: false, editing: null, notice: null, busy: false, stats: null, statsDays: 30, statsError: '' };

    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }
    const DEFAULT_FIELDS = ['id', 'name', 'nameEn', 'badge', 'badgeEn', 'description', 'descriptionEn', 'url', 'color', 'coverImage'];
    const pickDefault = link => Object.fromEntries(DEFAULT_FIELDS.map(key => [key, link[key] || '']));
    const currentDefaults = () => view.config.links.filter(link => link.builtin).map(pickDefault);

    async function api(method, body, path = '') {
        const res = await fetch('/api/platform-promotions' + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    function ensureStyle() {
        if (document.getElementById('tools-promotion-settings-style')) return;
        const style = document.createElement('style');
        style.id = 'tools-promotion-settings-style';
        style.textContent = `
.npp{display:flex;flex-direction:column;gap:14px;padding-bottom:70px;color:#0f172a}
.npp-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:14px 16px}
.npp-card h4{margin:0 0 4px;font-size:14px;font-weight:850;display:flex;align-items:center;gap:8px}
.npp-desc{margin:0 0 12px;color:#64748b;font-size:12px;line-height:1.6}
.npp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px 14px}
.npp-field{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0}
.npp-field>span{color:#475569;font-weight:700}
.npp-field small{color:#94a3b8;font-weight:500;line-height:1.5}
.npp-field input,.npp-field select{height:32px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:13px;background:#fff;color:#0f172a;min-width:0}
.npp-wide{grid-column:1/-1}
.npp-switch{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;cursor:pointer}
.npp-switch input{width:16px;height:16px}
.npp-list{display:flex;flex-direction:column;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
.npp-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid #f1f5f9;min-width:0}
.npp-row:first-child{border-top:0}
.npp-row.off{background:#f8fafc}
.npp-row.off .npp-main{opacity:.55}
.npp-dot{flex:none;width:10px;height:10px;border-radius:50%}
.npp-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.npp-main strong{font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.npp-main span{font-size:11.5px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.npp-tag{display:inline-block;padding:0 7px;border-radius:999px;font-size:10.5px;font-weight:800;background:#f1f5f9;color:#475569}
.npp-tag.sys{background:#e0e7ff;color:#3730a3}.npp-tag.video{background:#fef3c7;color:#92400e}.npp-tag.link{background:#ccfbf1;color:#115e59}
.npp-actions{flex:none;display:flex;align-items:center;gap:4px}
.npp-btn{height:30px;padding:0 12px;border-radius:7px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap}
.npp-btn:hover:not(:disabled){border-color:#93c5fd;color:#1d4ed8}
.npp-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
.npp-btn.sm{height:26px;padding:0 8px;font-size:11.5px}
.npp-btn.danger{color:#b91c1c}
.npp-btn:disabled{opacity:.45;cursor:not-allowed}
.npp-form{margin-top:12px;padding:12px;border:1px dashed #93c5fd;border-radius:10px;background:#f8fbff}
.npp-form-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.npp-colors{display:flex;gap:6px;flex-wrap:wrap}
.npp-colors label{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid #cbd5e1;border-radius:999px;font-size:12px;cursor:pointer}
.npp-colors label.active{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.npp-colors input{display:none}
.npp-alert{margin-top:10px;padding:10px 12px;border-radius:9px;font-size:12px;line-height:1.6;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a}
.npp-alert.ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
.npp-alert.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.npp-stats-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px}
.npp-seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;margin-left:auto}
.npp-seg button{border:0;background:#fff;color:#334155;padding:0 10px;height:28px;font-size:12px;font-weight:700;cursor:pointer}
.npp-seg button.active{background:#2563eb;color:#fff}
.npp-kpis{display:flex;flex-wrap:wrap;gap:10px}
.npp-kpi{min-width:120px;padding:8px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0}
.npp-kpi b{display:block;font-size:20px;font-weight:850;color:#0f172a;font-variant-numeric:tabular-nums}
.npp-kpi span{font-size:11.5px;color:#64748b}
.npp-table-wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:10px}
.npp-table{width:100%;border-collapse:collapse;font-size:12px}
.npp-table th,.npp-table td{padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:left;white-space:nowrap}
.npp-table th{background:#f8fafc;color:#475569;font-weight:800}
.npp-table td.num,.npp-table th.num{text-align:right;font-variant-numeric:tabular-nums}
.npp-table tr:last-child td{border-bottom:0}
.npp-savebar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:rgba(255,255,255,.96);box-shadow:0 -6px 18px rgba(15,23,42,.06);z-index:2}
.npp-savebar span{margin-right:auto;font-size:12px;color:#64748b}
.npp-savebar span.dirty{color:#b45309;font-weight:800}
@media (max-width:640px){.npp-row{flex-wrap:wrap}.npp-actions{width:100%;justify-content:flex-end}}
`;
        document.head.appendChild(style);
    }

    const pick = (item, key) => (window.ToolsI18n?.getLanguage?.() === 'en-US' && item[`${key}En`]) || item[key] || '';

    function renderDisplayCard() {
        const d = view.draft;
        return `
            <h4>🧭 ${esc(L('展示设置', 'Display'))}</h4>
            <p class="npp-desc">${esc(L('首页右上角同一时间只有一个推广小窗（视频或链接实时画面），其余以横幅显示。链接横幅超过最大数量时定时轮换。', 'The home page shows one promo window at a time (a video or a live page); the rest appear as banners. Link banners rotate when there are more than the maximum.'))}</p>
            <div class="npp-grid">
                <label class="npp-field"><span>${esc(L('首页最多显示链接数', 'Max links on home page'))}</span>
                    <input type="number" min="1" max="10" step="1" data-path="maxLinks" value="${esc(d.maxLinks)}">
                    <small>${esc(L('默认 3 个，范围 1–10', 'Default 3, range 1–10'))}</small></label>
                <label class="npp-field"><span>${esc(L('轮换间隔（秒）', 'Rotation interval (seconds)'))}</span>
                    <input type="number" min="10" max="600" step="5" data-path="rotateSeconds" value="${esc(d.rotateSeconds)}">
                    <small>${esc(L('首页横幅按此间隔轮换；桌面卡片堆最短 60 秒轮换一次', 'Home banners rotate at this interval; the desktop card stack rotates at most once a minute'))}</small></label>
                <div class="npp-field npp-wide">
                    <label class="npp-switch"><input type="checkbox" data-path="desktopStack" ${d.desktopStack ? 'checked' : ''}>${esc(L('桌面端登录后在屏幕右下角打开推广卡片堆（默认关闭）', 'Desktop app: open the promotion card stack at the bottom right after login (off by default)'))}</label>
                    <small>${esc(L('卡片可在托盘菜单暂停；关闭卡片堆后当天不再自动弹出；Windows 全屏或演示时自动隐藏。浏览器访问时改为封面卡片 + 新标签页打开。', 'Cards can be paused from the tray menu; closing the stack hides it for the day; it hides during full-screen apps or presentations on Windows. In a browser, links show a cover card and open in a new tab.'))}</small>
                </div>
            </div>`;
    }

    function renderVideosCard() {
        const rows = view.draft.videos.map((video, index) => `
            <div class="npp-row ${video.enabled ? '' : 'off'}">
                <span class="npp-dot" style="background:#f97316"></span>
                <div class="npp-main"><strong>${esc(pick(video, 'name'))}<span class="npp-tag video">${esc(L('视频', 'Video'))}</span><span class="npp-tag sys">${esc(L('系统自带', 'Built-in'))}</span></strong></div>
                <div class="npp-actions"><label class="npp-switch"><input type="checkbox" data-video="${index}" ${video.enabled ? 'checked' : ''}>${esc(L('显示', 'Show'))}</label></div>
            </div>`).join('');
        return `
            <h4>🎬 ${esc(L('推广视频', 'Promo videos'))}</h4>
            <p class="npp-desc">${esc(L('系统自带视频不能删除，可设为不显示。每次打开首页会轮流播放下一个已显示的视频。', 'Built-in videos cannot be deleted but can be hidden. Each home page visit plays the next visible video.'))}</p>
            <div class="npp-list">${rows}</div>`;
    }

    function renderLinkForm() {
        const link = view.editing.link;
        const coverOnly = view.editing.mode === 'cover';
        const uploadedCover = String(link.coverImage || '').startsWith('data:');
        const field = (key, label, hint = '', type = 'text') => `
            <label class="npp-field"><span>${esc(label)}</span><input type="${type}" data-edit="${key}" value="${esc(link[key])}">${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
        const defaultHint = view.editing.mode === 'default'
            ? `<div class="npp-alert" style="margin:0 0 10px">${esc(L('正在修改项目默认链接：保存后写入项目源码 backend/platform-promotions-defaults.json，提交并推送到 Git 后，所有环境都以此为默认。', 'Editing a project default link: saving writes backend/platform-promotions-defaults.json in the project source. Commit and push it to Git to make it the default everywhere.'))}</div>`
            : '';
        return `
            <div class="npp-form" data-role="link-form">
                ${defaultHint}
                <div class="npp-grid">
                    ${coverOnly ? '' : `
                    ${field('name', L('名称（中文）*', 'Name (Chinese) *'))}
                    ${field('nameEn', L('名称（英文）', 'Name (English)'))}
                    ${field('badge', L('角标（中文）', 'Badge (Chinese)'), L('例如：推广、新站，最多 12 个字', 'e.g. NEW, up to 12 characters'))}
                    ${field('badgeEn', L('角标（英文）', 'Badge (English)'))}
                    ${field('description', L('一句话介绍（中文）', 'Tagline (Chinese)'))}
                    ${field('descriptionEn', L('一句话介绍（英文）', 'Tagline (English)'))}
                    <label class="npp-field npp-wide"><span>${esc(L('链接地址 *', 'URL *'))}</span><input type="url" data-edit="url" value="${esc(link.url)}" placeholder="https://"><small>${esc(L('仅支持 http/https；不能包含账号密码', 'http/https only; no embedded credentials'))}</small></label>
                    <div class="npp-field npp-wide"><span>${esc(L('标识颜色', 'Color'))}</span>
                        <div class="npp-colors">${COLORS.map(([id, zh, en, hex]) => `<label class="${link.color === id ? 'active' : ''}"><input type="radio" name="npp-color" data-edit="color" value="${id}" ${link.color === id ? 'checked' : ''}><span class="npp-dot" style="background:${hex}"></span>${esc(L(zh, en))}</label>`).join('')}</div>
                    </div>
                    `}
                    <label class="npp-field npp-wide"><span>${esc(L('封面图片（可选）', 'Cover image (optional)'))}</span>
                        <input type="text" data-edit="coverImage" value="${esc(uploadedCover ? '' : link.coverImage || '')}" placeholder="${esc(uploadedCover ? L('已选择本地图片，可填写地址替换', 'Local image selected; enter a URL to replace it') : 'https://…')}">
                        <small>${esc(L('填写图片地址，或选择下方本地图片；留空使用渐变背景。', 'Enter an image URL or choose a local image below. Leave blank for the gradient background.'))}</small>
                    </label>
                    <label class="npp-field npp-wide"><span>${esc(L('选择本地图片', 'Choose local image'))}</span><input type="file" data-cover-file accept="image/png,image/jpeg,image/webp"><small>${esc(L('PNG / JPEG / WebP，自动缩小压缩；建议 16:9 横图。', 'PNG / JPEG / WebP, automatically resized and compressed. A 16:9 landscape image works best.'))}</small></label>
                    <div class="npp-field npp-wide"><img data-cover-preview ${link.coverImage ? `src="${esc(link.coverImage)}"` : 'hidden'} alt="${esc(L('封面预览', 'Cover preview'))}" referrerpolicy="no-referrer" style="width:100%;max-width:480px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1"><button type="button" class="npp-btn sm" data-action="clear-cover">${esc(L('清除图片，使用渐变背景', 'Clear image and use gradient'))}</button></div>
                </div>
                <div class="npp-form-actions">
                    <button type="button" class="npp-btn" data-action="cancel-edit">${esc(L('取消', 'Cancel'))}</button>
                    <button type="button" class="npp-btn primary" data-action="apply-edit">${esc(view.editing.mode === 'default' ? L('写入项目默认', 'Save as project default') : (view.editing.index < 0 ? L('添加', 'Add') : L('确定', 'Apply')))}</button>
                </div>
            </div>`;
    }

    function renderLinksCard() {
        const links = view.draft.links;
        const rows = links.map((link, index) => `
            <div class="npp-row ${link.enabled ? '' : 'off'}">
                <span class="npp-dot" style="background:${colorHex(link.color)}"></span>
                <div class="npp-main">
                    <strong>${esc(pick(link, 'name'))}<span class="npp-tag link">${esc(pick(link, 'badge') || L('推广', 'Link'))}</span>${link.builtin ? `<span class="npp-tag sys">${esc(L('系统自带', 'Built-in'))}</span>` : ''}</strong>
                    <span title="${esc(link.url)}">${esc(link.url)}</span>
                </div>
                <div class="npp-actions">
                    <button type="button" class="npp-btn sm" data-action="up" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="${esc(L('上移', 'Move up'))}">↑</button>
                    <button type="button" class="npp-btn sm" data-action="down" data-index="${index}" ${index === links.length - 1 ? 'disabled' : ''} aria-label="${esc(L('下移', 'Move down'))}">↓</button>
                    ${link.builtin
                        ? `<button type="button" class="npp-btn sm" data-action="edit-cover" data-index="${index}">${esc(L('封面图片', 'Cover image'))}</button>` + (view.config.defaultsWritable ? `<button type="button" class="npp-btn sm" data-action="edit-default" data-index="${index}" title="${esc(L('写入项目源码，提交推送后成为默认', 'Writes to the project source; commit and push to make it the default'))}">${esc(L('编辑默认', 'Edit default'))}</button>` : '')
                        : `${view.config.defaultsWritable ? `<button type="button" class="npp-btn sm" data-action="promote-default" data-index="${index}" title="${esc(L('写入项目源码，提交推送后所有环境都自带这个链接', 'Writes to the project source; after commit and push every environment ships with it'))}">${esc(L('设为默认', 'Make default'))}</button>` : ''}
                    <button type="button" class="npp-btn sm" data-action="edit" data-index="${index}">${esc(L('编辑', 'Edit'))}</button>
                    <button type="button" class="npp-btn sm danger" data-action="delete" data-index="${index}">${esc(L('删除', 'Delete'))}</button>`}
                    <label class="npp-switch"><input type="checkbox" data-link="${index}" ${link.enabled ? 'checked' : ''}>${esc(L('显示', 'Show'))}</label>
                </div>
            </div>`).join('');
        return `
            <h4>🔗 ${esc(L('推广链接', 'Promoted links'))}<span style="margin-left:auto"></span><button type="button" class="npp-btn" data-action="add" ${view.editing ? 'disabled' : ''}>＋ ${esc(L('添加链接', 'Add link'))}</button></h4>
            <p class="npp-desc">${esc(L('系统自带链接可更换封面或隐藏；自定义链接可增删改。排序靠前的链接优先显示在首页和桌面卡片堆的最前面。', 'Built-in links can have their covers changed or be hidden; custom links can be added, edited and deleted. Links at the top are shown first on the home page and at the front of the desktop card stack.'))}${view.config.defaultsWritable ? esc(L(' 当前服务运行在项目源码目录：可「编辑默认」或把自定义链接「设为默认」，写入 backend/platform-promotions-defaults.json，提交并推送后即为所有环境的默认链接（也可以直接手动编辑这个文件）。', ' This server runs from the project source: use “Edit default” or “Make default” to write backend/platform-promotions-defaults.json; commit and push it to make it the default everywhere (you can also edit the file by hand).')) : ''}</p>
            ${links.length ? `<div class="npp-list">${rows}</div>` : `<div class="npp-desc">${esc(L('暂无推广链接', 'No promoted links yet'))}</div>`}
            ${view.editing ? renderLinkForm() : ''}`;
    }

    const CHANNEL_LABELS = { video: ['视频大窗', 'Video'], tab: ['新标签页', 'Browser tab'], desktop: ['首页→桌面大窗', 'Home → desktop'], card: ['桌面卡片堆', 'Desktop stack'] };
    function promoName(item) {
        const source = item.kind === 'video' ? view.config.videos : view.config.links;
        const found = source.find(entry => entry.id === item.id);
        return found ? pick(found, 'name') : `${item.id}（${L('已删除', 'deleted')}）`;
    }
    function renderStatsCard() {
        const stats = view.stats;
        const ranges = [7, 30, 90].map(days => `<button type="button" data-action="stats-days" data-days="${days}" class="${view.statsDays === days ? 'active' : ''}">${esc(L(`近 ${days} 天`, `${days} days`))}</button>`).join('');
        let body;
        if (view.statsError) body = `<div class="npp-alert bad">${esc(view.statsError)}</div>`;
        else if (!stats) body = `<div class="npp-desc">${esc(L('正在加载…', 'Loading…'))}</div>`;
        else if (!stats.items.length) body = `<div class="npp-desc">${esc(L('这段时间还没有推广点击', 'No promotion clicks in this period'))}</div>`;
        else {
            const rows = stats.items.map(item => `
                <tr>
                    <td>${esc(promoName(item))}</td>
                    <td><span class="npp-tag ${item.kind === 'video' ? 'video' : 'link'}">${esc(item.kind === 'video' ? L('视频', 'Video') : L('链接', 'Link'))}</span></td>
                    <td class="num">${item.clicks}</td>
                    <td class="num">${item.users}</td>
                    <td>${Object.entries(item.channels).map(([channel, count]) => `${esc(L(...(CHANNEL_LABELS[channel] || [channel, channel])))} ${count}`).join(' · ')}</td>
                    <td>${item.lastClickedAt ? esc(new Date(item.lastClickedAt).toLocaleString()) : '—'}</td>
                </tr>`).join('');
            body = `
                <div class="npp-table-wrap"><table class="npp-table">
                    <thead><tr><th>${esc(L('推广项', 'Item'))}</th><th>${esc(L('类型', 'Type'))}</th><th class="num">${esc(L('点击次数', 'Clicks'))}</th><th class="num">${esc(L('点击人数', 'People'))}</th><th>${esc(L('渠道', 'Channels'))}</th><th>${esc(L('最近点击', 'Last click'))}</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table></div>`;
        }
        return `
            <h4>📊 ${esc(L('点击统计', 'Click statistics'))}</h4>
            <p class="npp-desc">${esc(L('统计打开视频大窗、打开推广链接（新标签页、首页弹出桌面大窗、在桌面卡片堆里直接放大）的次数；同一账号 5 秒内重复点击只算一次。只显示汇总，不显示账号明细。', 'Counts video plays and link opens (browser tab, home → desktop window, or opened from the desktop card stack). Repeat clicks by the same account within 5 seconds count once. Totals only; no per-account details.'))}</p>
            <div class="npp-stats-head">
                <div class="npp-kpis">
                    <div class="npp-kpi"><b>${stats ? stats.totalClicks : '—'}</b><span>${esc(L('总点击次数', 'Total clicks'))}</span></div>
                    <div class="npp-kpi"><b>${stats ? stats.totalUsers : '—'}</b><span>${esc(L('点击人数（去重）', 'Unique people'))}</span></div>
                </div>
                <div class="npp-seg">${ranges}</div>
            </div>
            ${body}`;
    }
    async function loadStats() {
        try {
            view.stats = await api('GET', null, `/stats?days=${view.statsDays}`);
            view.statsError = '';
        } catch (error) {
            view.stats = null;
            view.statsError = L('统计加载失败：', 'Failed to load statistics: ') + error.message;
        }
        const card = view.content?.querySelector('[data-role="stats-card"]');
        if (card) card.innerHTML = renderStatsCard();
    }

    function render() {
        const content = view.content;
        if (!content || !view.draft) return;
        const saved = view.config.updatedAt ? L(`上次保存：${new Date(view.config.updatedAt).toLocaleString()}`, `Last saved: ${new Date(view.config.updatedAt).toLocaleString()}`) : L('使用默认配置', 'Using defaults');
        content.innerHTML = `
            <div class="npp">
                <section class="npp-card">${renderDisplayCard()}</section>
                <section class="npp-card">${renderVideosCard()}</section>
                <section class="npp-card">${renderLinksCard()}</section>
                <section class="npp-card" data-role="stats-card">${renderStatsCard()}</section>
                ${view.notice ? `<div class="npp-alert ${esc(view.notice.type)}">${esc(view.notice.text)}</div>` : ''}
                <div class="npp-savebar">
                    <span class="${view.dirty ? 'dirty' : ''}">${esc(view.dirty ? L('有未保存的修改', 'Unsaved changes') : saved)}</span>
                    <button type="button" class="npp-btn" data-action="reload" ${view.dirty ? '' : 'disabled'}>${esc(L('放弃修改', 'Discard'))}</button>
                    <button type="button" class="npp-btn primary" data-action="save" ${view.busy ? 'disabled' : ''}>${esc(L('保存配置', 'Save'))}</button>
                </div>
            </div>`;
    }

    function markDirty() { view.dirty = true; view.notice = null; }

    function applyEdit() {
        const link = view.editing.link;
        if (!String(link.name).trim()) throw new Error(L('请填写名称', 'Name is required'));
        let parsed;
        try { parsed = new URL(String(link.url).trim()); } catch (_) { throw new Error(L('链接地址无效', 'Invalid URL')); }
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(L('仅支持 http/https 地址', 'Only http/https URLs are supported'));
        const next = { ...link, url: parsed.toString() };
        if (view.editing.index < 0) view.draft.links.push(next);
        else view.draft.links[view.editing.index] = next;
        view.editing = null;
        markDirty();
    }

    async function saveDefaults(links, message) {
        const config = await api('PUT', { links }, '/defaults');
        // 默认链接写入源码后重新读取，保留未保存的租户修改以外的最新状态
        view.config = config;
        if (!view.dirty) view.draft = clone(config);
        else view.draft.links = view.draft.links.map(link => (link.builtin || config.links.some(item => item.builtin && item.id === link.id)) ? { ...(config.links.find(item => item.id === link.id) || link), enabled: link.enabled } : link);
        view.notice = { type: 'ok', text: message };
        window.dispatchEvent(new CustomEvent('tools:platform-promotions-changed', { detail: clone(config) }));
    }

    async function applyDefaultEdit() {
        const link = view.editing.link;
        if (!String(link.name).trim()) throw new Error(L('请填写名称', 'Name is required'));
        const links = currentDefaults().map(item => (item.id === link.id ? pickDefault(link) : item));
        await saveDefaults(links, L('已写入项目默认链接（backend/platform-promotions-defaults.json），记得提交并推送到 Git', 'Saved to backend/platform-promotions-defaults.json. Remember to commit and push it'));
        view.editing = null;
    }

    async function save() {
        if (view.editing && view.editing.mode !== 'default') applyEdit();
        view.busy = true; render();
        try {
            const config = await api('PUT', view.draft);
            view.config = config;
            view.draft = clone(config);
            view.dirty = false;
            view.notice = { type: 'ok', text: L('平台推广配置已保存，首页即时生效', 'Saved. The home page updates right away.') };
            window.dispatchEvent(new CustomEvent('tools:platform-promotions-changed', { detail: clone(config) }));
        } finally {
            view.busy = false;
        }
    }

    async function onClick(event) {
        const button = event.target.closest('[data-action]');
        if (!button || button.disabled) return;
        const action = button.dataset.action;
        const index = Number(button.dataset.index);
        const links = view.draft.links;
        if (action === 'add') view.editing = { index: -1, link: clone(EMPTY_LINK) };
        else if (action === 'edit') view.editing = { index, link: clone(links[index]) };
        else if (action === 'edit-cover') view.editing = { index, link: clone(links[index]), mode: 'cover' };
        else if (action === 'clear-cover' && view.editing) view.editing.link.coverImage = '';
        else if (action === 'edit-default') view.editing = { index, link: clone(links[index]), mode: 'default' };
        else if (action === 'promote-default') {
            const link = links[index];
            const ok = await confirmDialog(L(`把「${link.name}」设为项目默认链接？\n\n会写入项目源码 backend/platform-promotions-defaults.json，提交并推送到 Git 后，所有环境都自带这个链接（之后只能隐藏，不能删除）。`, `Make “${link.name}” a project default link?\n\nIt is written to backend/platform-promotions-defaults.json. After you commit and push, every environment ships with it (it can then only be hidden, not deleted).`), { title: L('设为默认链接', 'Make default link'), confirmText: L('设为默认', 'Make default') });
            if (!ok) return;
            if (view.dirty) await save();
            await saveDefaults(currentDefaults().concat(pickDefault(view.draft.links.find(item => item.id === link.id) || link)), L(`「${link.name}」已设为项目默认链接，记得提交并推送到 Git`, `“${link.name}” is now a project default. Remember to commit and push it`));
        }
        else if (action === 'cancel-edit') view.editing = null;
        else if (action === 'apply-edit') { if (view.editing.mode === 'default') await applyDefaultEdit(); else applyEdit(); }
        else if (action === 'up' && index > 0) { [links[index - 1], links[index]] = [links[index], links[index - 1]]; markDirty(); }
        else if (action === 'down' && index < links.length - 1) { [links[index + 1], links[index]] = [links[index], links[index + 1]]; markDirty(); }
        else if (action === 'delete') {
            const ok = await confirmDialog(L(`删除推广链接「${links[index].name}」？保存后生效。`, `Delete the link “${links[index].name}”? It is removed when you save.`), { title: L('删除推广链接', 'Delete link'), confirmText: L('删除', 'Delete'), tone: 'danger' });
            if (!ok) return;
            links.splice(index, 1);
            markDirty();
        } else if (action === 'reload') { view.draft = clone(view.config); view.editing = null; view.dirty = false; view.notice = null; }
        else if (action === 'save') await save();
        else if (action === 'stats-days') { view.statsDays = Number(button.dataset.days) || 30; view.stats = null; render(); await loadStats(); return; }
        render();
    }

    function onInput(event) {
        const target = event.target;
        if (target.dataset.path) {
            const key = target.dataset.path;
            view.draft[key] = target.type === 'checkbox' ? target.checked : Number(target.value);
            markDirty();
            if (target.type === 'checkbox') render(); else rerenderSaveState();
        } else if (target.dataset.video !== undefined) {
            view.draft.videos[Number(target.dataset.video)].enabled = target.checked;
            markDirty(); render();
        } else if (target.dataset.link !== undefined) {
            view.draft.links[Number(target.dataset.link)].enabled = target.checked;
            markDirty(); render();
        } else if (target.dataset.edit && view.editing) {
            view.editing.link[target.dataset.edit] = target.value;
            if (target.dataset.edit === 'color') render();
            if (target.dataset.edit === 'coverImage') {
                const preview = view.content.querySelector('[data-cover-preview]');
                preview.hidden = !target.value.trim();
                if (target.value.trim()) preview.src = target.value.trim();
                else preview.removeAttribute('src');
            }
        }
    }

    async function selectCover(file) {
        if (!file || !view.editing) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
            throw new Error(L('请选择不超过 10 MB 的 PNG、JPEG 或 WebP 图片', 'Choose a PNG, JPEG or WebP image up to 10 MB'));
        }
        const editing = view.editing;
        const image = await createImageBitmap(file);
        try {
            const scale = Math.min(1, 1440 / image.width, 1440 / image.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            let data = canvas.toDataURL('image/jpeg', .88);
            if (data.length > 699000) data = canvas.toDataURL('image/jpeg', .65);
            if (data.length > 699000) throw new Error(L('图片压缩后仍超过 512 KB，请选择较小的图片', 'The compressed image exceeds 512 KB. Choose a smaller image.'));
            if (view.editing !== editing) return;
            editing.link.coverImage = data;
            render();
        } finally { image.close(); }
    }

    function rerenderSaveState() {
        const label = view.content?.querySelector('.npp-savebar span');
        if (label) { label.className = 'dirty'; label.textContent = L('有未保存的修改', 'Unsaved changes'); }
        const discard = view.content?.querySelector('.npp-savebar [data-action="reload"]');
        if (discard) discard.disabled = false;
    }

    async function renderInto(content) {
        ensureStyle();
        view.content = content;
        content.innerHTML = `<div class="nav-settings-empty">${esc(L('正在加载平台推广配置…', 'Loading promotion settings…'))}</div>`;
        try {
            if (!view.dirty || !view.draft) {
                view.config = await api('GET');
                view.draft = clone(view.config);
                view.dirty = false;
                view.editing = null;
            }
        } catch (error) {
            content.innerHTML = `<div class="nav-settings-empty">${esc(L('加载失败：', 'Failed to load: '))}${esc(error.message)}</div>`;
            return;
        }
        if (!content.dataset.promotionSettingsBound) {
            content.dataset.promotionSettingsBound = '1';
            const active = () => view.content === content && content.querySelector('.npp');
            content.addEventListener('click', event => {
                if (!active()) return;
                onClick(event).catch(error => { view.notice = { type: 'bad', text: error.message }; render(); });
            });
            content.addEventListener('input', event => { if (active() && event.target.type !== 'checkbox' && event.target.type !== 'radio') onInput(event); });
            content.addEventListener('change', event => {
                if (!active()) return;
                if (event.target.hasAttribute('data-cover-file')) selectCover(event.target.files[0]).catch(error => { view.notice = { type: 'bad', text: error.message }; render(); });
                else if (event.target.type === 'checkbox' || event.target.type === 'radio') onInput(event);
            });
        }
        view.notice = null;
        render();
        loadStats();
    }

    window.ToolsPromotionSettings = { render: renderInto };
})();
