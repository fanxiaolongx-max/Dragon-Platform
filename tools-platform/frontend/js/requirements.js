// ================== 双语切换引擎 ==================
const REQ_I18N_DICT = {
    "需求管理 - Tools Platform": "Requirements - Tools Platform",
    "🎯 需求管理广场": "🎯 Requirements Plaza",
    "提交、追踪和管理平台新功能与优化需求": "Submit, track, and manage new features and optimizations",
    "默认排序：按进度优先": "Default: Sort by Progress",
    "排序：最近更新时间": "Sort by Recently Updated",
    "排序：最近创建时间": "Sort by Recently Created",
    "+ 提交新需求": "+ New Request",
    "需求详情": "Request Details",
    "提交": "Submit",
    "接受": "Accept",
    "实现中": "Progressing",
    "完成": "Done",
    "验收": "Verify",
    "评价": "Evaluate",
    "需求标题": "Request Title",
    "页面分类": "Category",
    "请选择分类...": "Select Category...",
    "🌐 全局通用": "🌐 General",
    "✨ 新增页面": "✨ New Page",
    "🏠 工具中台首页": "🏠 Home",
    "🚀 数据抓取(UIVF12)": "🚀 Data Fetch (UIVF12)",
    "📊 数据导入(SLA)": "📊 Data Import (SLA)",
    "📈 报表看板": "📈 Dashboard",
    "⚡ 一键催办": "⚡ Expedite",
    "📅 月报页面": "📅 Monthly Report",
    "🎯 需求管理": "🎯 Requirements",
    "简短描述需求的核心目的": "Briefly describe the core purpose",
    "详细说明背景、期望效果等": "Detail the background, expected results, etc.",
    "留空或填写负责人": "Leave blank or enter assignee",
    "流转状态时，建议填写备注": "Suggest adding a remark during state transition",
    "需求详情描述": "Description",
    "当前状态": "Current Status",
    "责任人 (Assignee)": "Assignee",
    "过点备注 (流转日志)": "Flow Remark",
    "流转日志": "Flow Logs",
    "删除需求": "Delete",
    "取消": "Cancel",
    "保存": "Save",
    "1. 提交 (待接受)": "1. Submit (Pending)",
    "2. 需求接受 (评估中)": "2. Accepted (Evaluating)",
    "3. 需求实现中 (开发中)": "3. In Progress (Developing)",
    "4. 需求完成 (待上线)": "4. Done (Pending Release)",
    "5. 验收完成 (已上线)": "5. Verified (Released)",
    "6. 需求评价 (归档)": "6. Evaluated (Archived)",
    "❌ 已拒绝 (暂不采纳)": "❌ Rejected",
    "暂无需求，点击右上角提交一个吧！": "No requests, click top right to submit one!",
    "提交新需求": "Submit New Request",
    "需求详情与管理": "Request Details & Management",
    "保存中...": "Saving...",
    "需求已更新": "Request updated",
    "需求提交成功": "Request submitted successfully",
    "Are you sure you want to delete this request? Related logs will also be permanently deleted.": "Are you sure you want to delete this request? Related logs will also be permanently deleted.",
    "需求已删除": "Request deleted",
    "暂无日志": "No logs",
    "状态流转：": "Status changed: ",
    "更新了信息": "Updated info",
    "未分类": "Uncategorized",
    "无详细描述": "No description",
    "未分配": "Unassigned",
    "紧急需求": "Urgent request",
    "在需求广场中优先展示并高亮提醒": "Show first in the plaza with a highlighted alert"
};

let currentReqLang = 'zh';

function applyReqLanguage(lang) {
    if (currentReqLang === lang) return;
    currentReqLang = lang;
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        // Prevent global i18n from erasing our local translation by overriding if needed
        if (currentReqLang === 'en' && REQ_I18N_DICT[key]) el.innerHTML = REQ_I18N_DICT[key];
        else el.innerHTML = key;
    });
    
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if (currentReqLang === 'en' && REQ_I18N_DICT[key]) el.placeholder = REQ_I18N_DICT[key];
        else el.placeholder = key;
    });
    
    if (typeof ReqApp !== 'undefined') ReqApp.refreshCategoryOptions();
    ReqApp.renderBoard();
}

function tText(zh, en) {
    return currentReqLang === 'en' ? en : zh;
}

window.addEventListener('tools:languagechange', (e) => {
    const isEn = e.detail?.lang?.startsWith('en');
    applyReqLanguage(isEn ? 'en' : 'zh');
});
// ==================================================

const ReqApp = {
    requirements: [],
    currentReqId: null,
    currentPage: 1,
    pageSize: 8,

    fallbackCategories: [
        { value: '全局通用', label: '🌐 全局通用' },
        { value: '新增页面', label: '✨ 新增页面' },
        { value: '工具中台首页', label: '🏠 工具中台首页' },
        { value: '数据抓取(UIVF12)', label: '🚀 数据抓取(UIVF12)' },
        { value: '数据导入(SLA)', label: '📊 数据导入(SLA)' },
        { value: '报表看板', label: '📈 报表看板' },
        { value: '一键催办', label: '⚡ 一键催办' },
        { value: '月报页面', label: '📅 月报页面' },
        { value: '需求管理', label: '🎯 需求管理' }
    ],

    init: async function() {
        this.refreshCategoryOptions();
        await this.loadRequirements();
    },

    refreshCategoryOptions: function(categories) {
        const select = document.getElementById('reqCategorySelect');
        if (!select) return;
        const selectedValue = select.value;
        const source = Array.isArray(categories) && categories.length
            ? categories
            : (typeof window.getRequirementPageCategories === 'function'
                ? window.getRequirementPageCategories()
                : this.fallbackCategories);
        const uniqueCategories = [];
        const knownValues = new Set();
        source.forEach(category => {
            const value = String(category?.value || '').trim();
            if (!value || knownValues.has(value)) return;
            knownValues.add(value);
            uniqueCategories.push({ value, label: String(category.label || value) });
        });

        select.replaceChildren(new Option(tText('请选择分类...', 'Select category...'), '', true, true));
        uniqueCategories.forEach(category => select.add(new Option(category.label, category.value)));
        if (selectedValue) {
            if (!knownValues.has(selectedValue)) select.add(new Option(selectedValue, selectedValue));
            select.value = selectedValue;
        }
    },

    loadRequirements: async function() {
        try {
            this.requirements = await API.get('/api/requirements');
            this.currentPage = 1;
            this.renderBoard();
        } catch (e) {
            console.error('Failed to load requirements', e);
        }
    },

    renderBoard: function() {
        const board = document.getElementById('reqBoard');
        const pagination = document.getElementById('reqPagination');
        board.innerHTML = '';
        this.renderStats();

        if (this.requirements.length === 0) {
            board.innerHTML = `<div style="color: #64748b; grid-column: 1 / -1; text-align: center; padding: 40px;">${tText('暂无需求，点击右上角提交一个吧！', 'No requests, click top right to submit one!')}</div>`;
            pagination.innerHTML = '';
            return;
        }

        const sortType = document.getElementById('reqSortSelect') ? document.getElementById('reqSortSelect').value : 'progress';
        let sortedReqs = [...this.requirements];
        
        if (sortType === 'progress') {
            const statusOrder = { '提交': 1, '需求接受': 2, '需求实现中': 3, '需求完成': 4, '验收完成': 5, '需求评价': 6, '已拒绝': 99 };
            sortedReqs.sort((a, b) => {
                const orderA = statusOrder[a.status] || 99;
                const orderB = statusOrder[b.status] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
            });
        } else if (sortType === 'updated') {
            sortedReqs.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        } else if (sortType === 'created') {
            sortedReqs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        // 紧急需求始终优先，同一优先级内保留用户选择的排序。
        sortedReqs.sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));

        const totalPages = Math.max(1, Math.ceil(sortedReqs.length / this.pageSize));
        this.currentPage = Math.min(Math.max(1, this.currentPage), totalPages);
        const pageStart = (this.currentPage - 1) * this.pageSize;
        const pageReqs = sortedReqs.slice(pageStart, pageStart + this.pageSize);

        pageReqs.forEach(req => {
            const card = document.createElement('div');
            card.className = `req-card${req.urgent ? ' req-card-urgent' : ''}`;
            card.onclick = () => this.openEditModal(req.id);

            const timeStr = new Date(req.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
            const statusClass = `status-${req.status.replace(/\s+/g, '')}`;

            // Mini flow chart HTML
            const statuses = ['提交', '需求接受', '需求实现中', '需求完成', '验收完成', '需求评价'];
            const currentIndex = statuses.indexOf(req.status);
            const isRejected = req.status === '已拒绝';

            let miniFlowHtml = '';
            if (isRejected) {
                miniFlowHtml = `<div style="color: #ef4444; font-size: 13px; font-weight: bold; border: 1px dashed #ef4444; padding: 4px 12px; border-radius: 12px; background: rgba(239, 68, 68, 0.1);">${tText('❌ 已拒绝采纳', '❌ Rejected')}</div>`;
            } else {
                miniFlowHtml = `<div style="display:flex; align-items:center;">`;
                statuses.forEach((s, idx) => {
                    const isCompleted = idx < currentIndex;
                    const isActive = idx === currentIndex;
                    let color = '#334155'; // default
                    let fontColor = '#64748b';
                    if (isCompleted) { color = '#10b981'; fontColor = '#cbd5e1'; }
                    if (isActive) { color = '#3b82f6'; fontColor = '#f8fafc'; }
                    
                    miniFlowHtml += `
                        <div style="display:flex; flex-direction:column; align-items:center; gap:4px; position:relative; width: 38px;">
                            <div style="width: 12px; height: 12px; border-radius: 50%; background: ${color}; z-index: 2; ${isActive ? 'box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);' : ''}"></div>
                            <div style="font-size: 11px; color: ${fontColor}; white-space: nowrap; transform: scale(0.9); ${isActive ? 'font-weight:bold;' : ''}">${tText(s.replace('需求', ''), ['Submit', 'Accept', 'Progressing', 'Done', 'Verify', 'Evaluate'][idx] || s)}</div>
                        </div>
                    `;
                    if (idx < statuses.length - 1) {
                        const lineBg = idx < currentIndex ? '#10b981' : '#334155';
                        miniFlowHtml += `<div style="height: 2px; flex: 1; min-width: 15px; max-width: 25px; background: ${lineBg}; margin-top: -16px; margin-left: -4px; margin-right: -4px; z-index: 1;"></div>`;
                    }
                });
                miniFlowHtml += `</div>`;
            }

            card.innerHTML = `
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
                        ${req.urgent ? `<span class="urgent-badge">⚡ ${tText('紧急', 'Urgent')}</span>` : ''}
                        <h3 class="req-title" style="margin:0; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${this.escapeHTML(req.title)}">${this.escapeHTML(req.title)}</h3>
                        <span class="req-status-badge" style="background:rgba(255,255,255,0.1); color:#cbd5e1; margin:0;">${this.escapeHTML(req.category || tText('未分类', 'Uncategorized'))}</span>
                    </div>
                    <div class="req-desc" style="margin-bottom: 6px; -webkit-line-clamp: 1;" title="${this.escapeHTML(req.description || tText('无详细描述', 'No description'))}">${this.escapeHTML(req.description || tText('无详细描述', 'No description'))}</div>
                    <div class="req-meta" style="font-size: 12px; color: #64748b;">
                        <span>👤 ${this.escapeHTML(req.creator || 'Guest')}</span>
                        <span style="margin: 0 6px;">|</span>
                        <span>📅 ${timeStr}</span>
                    </div>
                </div>

                <div style="display: flex; align-items: center; justify-content: center; min-width: 320px; padding: 0 10px;">
                    ${miniFlowHtml}
                </div>

                <div style="width: 130px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; border-left: 1px dashed rgba(255,255,255,0.1); padding-left: 16px;">
                    <span class="req-status-badge ${statusClass}" style="margin: 0 0 8px 0; width: 100%; text-align: center; box-sizing: border-box;">${tText(req.status, { '提交': 'Submitted', '需求接受': 'Accepted', '需求实现中': 'In Progress', '需求完成': 'Completed', '验收完成': 'Verified', '需求评价': 'Evaluated', '已拒绝': 'Rejected' }[req.status] || req.status)}</span>
                    ${req.assignee ? `<span style="font-size: 12px; color: #94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;" title="${this.escapeHTML(req.assignee)}">🛠️ ${this.escapeHTML(req.assignee)}</span>` : `<span style="font-size: 12px; color: #64748b; font-style: italic;">${tText('未分配', 'Unassigned')}</span>`}
                </div>
            `;
            board.appendChild(card);
        });

        this.renderPagination(sortedReqs.length, totalPages);
    },

    renderStats: function() {
        const requirements = this.requirements || [];
        const total = requirements.length;
        const countByStatus = requirements.reduce((result, item) => {
            result[item.status] = (result[item.status] || 0) + 1;
            return result;
        }, {});
        const submitted = countByStatus['提交'] || 0;
        const accepted = countByStatus['需求接受'] || 0;
        const implementing = countByStatus['需求实现中'] || 0;
        const completed = (countByStatus['需求完成'] || 0)
            + (countByStatus['验收完成'] || 0)
            + (countByStatus['需求评价'] || 0);
        const rejected = countByStatus['已拒绝'] || 0;
        const urgent = requirements.filter(item => Boolean(item.urgent)).length;
        const activeTotal = Math.max(0, total - rejected);
        const completionRate = activeTotal ? Math.round((completed / activeTotal) * 100) : 0;
        const now = Date.now();
        const recent = requirements.filter(item => {
            const createdAt = new Date(item.created_at).getTime();
            return Number.isFinite(createdAt) && now - createdAt <= 7 * 24 * 60 * 60 * 1000;
        }).length;

        const topStats = [
            { icon: '◈', value: total, label: tText('全部需求', 'All requests'), tone: 'blue' },
            { icon: '⌕', value: submitted, label: tText('Codex 待确认', 'Codex review'), tone: 'violet' },
            { icon: '◐', value: accepted + implementing, label: tText('实现队列', 'Build queue'), tone: 'cyan' },
            { icon: '⚡', value: urgent, label: tText('紧急需求', 'Urgent'), tone: 'orange' },
            { icon: '✓', value: `${completionRate}%`, label: tText('完成率', 'Completion'), tone: 'green' }
        ];
        document.getElementById('reqStatsTop').innerHTML = topStats.map(stat => `
            <article class="req-stat-card stat-tone-${stat.tone}">
                <span class="stat-card-icon">${stat.icon}</span>
                <span class="stat-card-copy"><strong>${stat.value}</strong><small>${stat.label}</small></span>
                <span class="stat-card-glow"></span>
            </article>
        `).join('');

        const flowGroups = [
            { label: tText('待评估', 'Awaiting'), value: submitted, color: '#a78bfa' },
            { label: tText('已接受', 'Accepted'), value: accepted, color: '#60a5fa' },
            { label: tText('实现中', 'Building'), value: implementing, color: '#22d3ee' },
            { label: tText('已完成', 'Completed'), value: completed, color: '#34d399' }
        ];
        document.getElementById('reqStatsLeft').innerHTML = `
            <div class="stat-rail-heading"><span class="stat-live-dot"></span><div><small>${tText('实时流程', 'LIVE FLOW')}</small><strong>${tText('交付雷达', 'Delivery radar')}</strong></div></div>
            <div class="stat-flow-list">
                ${flowGroups.map(group => {
                    const ratio = total ? Math.max(group.value ? 7 : 0, Math.round((group.value / total) * 100)) : 0;
                    return `<div class="stat-flow-item"><span><em>${group.label}</em><b>${group.value}</b></span><i><u style="width:${ratio}%;background:${group.color}"></u></i></div>`;
                }).join('')}
            </div>
            <div class="stat-rail-foot"><strong>+${recent}</strong><span>${tText('近 7 天新增', 'new in 7 days')}</span></div>
        `;

        const categoryCounts = requirements.reduce((result, item) => {
            const category = item.category || tText('未分类', 'Uncategorized');
            result[category] = (result[category] || 0) + 1;
            return result;
        }, {});
        const topCategories = Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);
        const maxCategoryCount = topCategories[0]?.[1] || 1;
        document.getElementById('reqStatsRight').innerHTML = `
            <div class="stat-rail-heading"><span class="stat-orbit-icon">◎</span><div><small>${tText('需求分布', 'REQUEST MAP')}</small><strong>${tText('热门领域', 'Top categories')}</strong></div></div>
            <div class="stat-category-list">
                ${topCategories.map(([category, count], index) => `
                    <div class="stat-category-item">
                        <span><em>0${index + 1}</em><b title="${this.escapeHTML(category)}">${this.escapeHTML(category)}</b><strong>${count}</strong></span>
                        <i><u style="width:${Math.round((count / maxCategoryCount) * 100)}%"></u></i>
                    </div>
                `).join('') || `<div class="stat-empty">${tText('暂无数据', 'No data')}</div>`}
            </div>
            <div class="stat-rail-foot stat-rail-foot-orange"><strong>${urgent}</strong><span>${tText('紧急通道', 'urgent lane')}</span></div>
        `;
    },

    changeSort: function() {
        this.currentPage = 1;
        this.renderBoard();
    },

    goToPage: function(page) {
        const totalPages = Math.max(1, Math.ceil(this.requirements.length / this.pageSize));
        const nextPage = Math.min(Math.max(1, page), totalPages);
        if (nextPage === this.currentPage) return;
        this.currentPage = nextPage;
        this.renderBoard();
        document.getElementById('reqBoard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    renderPagination: function(totalItems, totalPages) {
        const pagination = document.getElementById('reqPagination');
        if (totalPages <= 1) {
            pagination.innerHTML = `<span class="pagination-summary">${tText(`共 ${totalItems} 条需求`, `${totalItems} requests`)}</span>`;
            return;
        }

        const startItem = (this.currentPage - 1) * this.pageSize + 1;
        const endItem = Math.min(this.currentPage * this.pageSize, totalItems);
        const pageButtons = [];
        for (let page = 1; page <= totalPages; page++) {
            if (page === 1 || page === totalPages || Math.abs(page - this.currentPage) <= 1) {
                pageButtons.push(`<button type="button" class="pagination-btn${page === this.currentPage ? ' active' : ''}" onclick="ReqApp.goToPage(${page})" ${page === this.currentPage ? 'aria-current="page"' : ''}>${page}</button>`);
            } else if (pageButtons[pageButtons.length - 1] !== '<span class="pagination-ellipsis">…</span>') {
                pageButtons.push('<span class="pagination-ellipsis">…</span>');
            }
        }

        pagination.innerHTML = `
            <span class="pagination-summary">${tText(`第 ${startItem}–${endItem} 条，共 ${totalItems} 条`, `${startItem}–${endItem} of ${totalItems}`)}</span>
            <div class="pagination-controls">
                <button type="button" class="pagination-btn pagination-nav" onclick="ReqApp.goToPage(${this.currentPage - 1})" ${this.currentPage === 1 ? 'disabled' : ''}>${tText('上一页', 'Previous')}</button>
                ${pageButtons.join('')}
                <button type="button" class="pagination-btn pagination-nav" onclick="ReqApp.goToPage(${this.currentPage + 1})" ${this.currentPage === totalPages ? 'disabled' : ''}>${tText('下一页', 'Next')}</button>
            </div>
        `;
    },

    openCreateModal: function() {
        this.currentReqId = null;
        document.getElementById('modalTitle').textContent = tText('提交新需求', 'Submit New Request');
        
        // Reset form and enable inputs
        const inputs = ['reqTitleInput', 'reqCategorySelect', 'reqDescInput', 'reqStatusSelect', 'reqAssigneeInput', 'reqRemarkInput'];
        inputs.forEach(id => {
            document.getElementById(id).value = '';
            document.getElementById(id).disabled = false;
        });
        document.getElementById('reqStatusSelect').value = '提交';
        document.getElementById('reqUrgentInput').checked = false;
        
        // UI visibility
        document.getElementById('manageRow').style.display = 'none';
        document.getElementById('remarkGroup').style.display = 'none';
        document.getElementById('flowchartContainer').style.display = 'none';
        document.getElementById('logsSection').style.display = 'none';
        
        document.getElementById('btnDeleteReq').style.display = 'none';
        document.getElementById('btnSaveReq').style.display = 'block';

        document.getElementById('reqModal').style.display = 'flex';
    },

    openEditModal: async function(id) {
        try {
            const req = await API.get(`/api/requirements/${id}`);
            this.currentReqId = id;
            document.getElementById('modalTitle').textContent = tText('需求详情与管理', 'Request Details & Management');
            
            document.getElementById('reqTitleInput').value = req.title;
            const categorySelect = document.getElementById('reqCategorySelect');
            if (req.category) {
                // Check if option exists, otherwise select default or create option
                const exists = Array.from(categorySelect.options).some(opt => opt.value === req.category);
                if (!exists) {
                    const newOpt = new Option(req.category, req.category);
                    categorySelect.add(newOpt);
                }
                categorySelect.value = req.category;
            } else {
                categorySelect.value = '';
            }
            
            document.getElementById('reqDescInput').value = req.description;
            document.getElementById('reqUrgentInput').checked = Boolean(req.urgent);
            document.getElementById('reqStatusSelect').value = req.status;
            document.getElementById('reqAssigneeInput').value = req.assignee || '';
            document.getElementById('reqRemarkInput').value = '';

            // Update Flowchart (pass req to access logs)
            this.updateFlowchart(req);

            // Update Select Options to prevent backwards/skipping
            const statuses = ['提交', '需求接受', '需求实现中', '需求完成', '验收完成', '需求评价'];
            const currentIndex = statuses.indexOf(req.status);
            const selectEl = document.getElementById('reqStatusSelect');
            
            for (let i = 0; i < selectEl.options.length; i++) {
                const opt = selectEl.options[i];
                const optVal = opt.value;
                if (req.status === '已拒绝') {
                    opt.disabled = optVal !== '已拒绝';
                } else if (optVal === '已拒绝') {
                    opt.disabled = false;
                } else {
                    const optIndex = statuses.indexOf(optVal);
                    // 允许留在当前状态，或前进一格
                    if (optIndex < currentIndex || optIndex > currentIndex + 1) {
                        opt.disabled = true;
                    } else {
                        opt.disabled = false;
                    }
                }
            }

            // Render Logs
            this.renderLogs(req.logs || []);

            // UI visibility
            document.getElementById('manageRow').style.display = 'flex';
            document.getElementById('remarkGroup').style.display = 'block';
            document.getElementById('flowchartContainer').style.display = 'flex';
            document.getElementById('logsSection').style.display = 'block';
            
            // Set inputs state based on admin role
            const isAdmin = localStorage.getItem('tools_role') === 'admin';
            const inputs = ['reqTitleInput', 'reqCategorySelect', 'reqDescInput', 'reqUrgentInput', 'reqStatusSelect', 'reqAssigneeInput', 'reqRemarkInput'];
            inputs.forEach(id => {
                document.getElementById(id).disabled = !isAdmin;
            });
            
            // Allow delete and save only if admin
            if (isAdmin) {
                document.getElementById('btnDeleteReq').style.display = 'block';
                document.getElementById('btnSaveReq').style.display = 'block';
            } else {
                document.getElementById('btnDeleteReq').style.display = 'none';
                document.getElementById('btnSaveReq').style.display = 'none';
            }

            document.getElementById('reqModal').style.display = 'flex';
        } catch (e) {
            showToast(tText('获取需求详情失败: ', 'Failed to get request details: ') + e.message, 'error');
        }
    },

    closeModal: function() {
        document.getElementById('reqModal').style.display = 'none';
    },

    saveReq: async function() {
        const title = document.getElementById('reqTitleInput').value.trim();
        const category = document.getElementById('reqCategorySelect').value;
        const description = document.getElementById('reqDescInput').value.trim();
        
        if (!title) {
            showToast(tText('需求标题不能为空', 'Title cannot be empty'), 'error');
            return;
        }
        if (!category) {
            showToast(tText('请选择页面分类', 'Please select a category'), 'error');
            return;
        }

        const urgent = document.getElementById('reqUrgentInput').checked;
        const payload = { title, description, category, urgent };

        if (this.currentReqId) {
            payload.status = document.getElementById('reqStatusSelect').value;
            payload.assignee = document.getElementById('reqAssigneeInput').value.trim();
            payload.remark = document.getElementById('reqRemarkInput').value.trim();
        }

        try {
            const btn = document.getElementById('btnSaveReq');
            const originalText = btn.textContent;
            btn.textContent = tText('保存中...', 'Saving...');
            btn.disabled = true;

            if (this.currentReqId) {
                await API.put(`/api/requirements/${this.currentReqId}`, payload);
                showToast(tText('需求已更新', 'Request updated'), 'success');
            } else {
                await API.post('/api/requirements', payload);
                showToast(tText('需求提交成功', 'Request submitted successfully'), 'success');
            }

            this.closeModal();
            this.loadRequirements();
        } catch (e) {
            showToast(tText('保存失败: ', 'Save failed: ') + e.message, 'error');
        } finally {
            const btn = document.getElementById('btnSaveReq');
            btn.textContent = tText('保存', 'Save');
            btn.disabled = false;
        }
    },

    deleteReq: async function() {
        if (!this.currentReqId) return;
        if (!await AppDialog.confirm(tText('确定要删除这个需求吗？相关的流转日志也会被删除且不可恢复。', 'Are you sure you want to delete this request? Related logs will also be permanently deleted.'), { title: tText('删除需求', 'Delete request'), tone: 'danger', confirmText: tText('删除', 'Delete'), cancelText: tText('取消', 'Cancel') })) return;

        try {
            await API.delete(`/api/requirements/${this.currentReqId}`);
            showToast(tText('需求已删除', 'Request deleted'), 'success');
            this.closeModal();
            this.loadRequirements();
        } catch (e) {
            showToast(tText('删除失败: ', 'Delete failed: ') + e.message, 'error');
        }
    },

    updateFlowchart: function(req) {
        const currentStatus = req.status;
        const statuses = ['提交', '需求接受', '需求实现中', '需求完成', '验收完成', '需求评价'];
        let currentIndex = statuses.indexOf(currentStatus);
        const isRejected = currentStatus === '已拒绝';
        
        if (isRejected) {
            currentIndex = 0; // 只保留提交状态点亮
        }

        // 计算各个状态的进入时间
        const timeEntered = {};
        timeEntered['提交'] = new Date(req.created_at).getTime();
        
        const logs = req.logs || [];
        logs.forEach(log => {
            if (log.new_status && statuses.includes(log.new_status) && !timeEntered[log.new_status]) {
                timeEntered[log.new_status] = new Date(log.created_at).getTime();
            }
        });
        
        const now = Date.now();
        const getDays = (ms) => Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
        
        const steps = document.querySelectorAll('.flow-step');
        const lines = document.querySelectorAll('.step-line');

        steps.forEach((step, index) => {
            const stepStatus = statuses[index];
            step.className = 'flow-step'; // reset
            
            // 计算并显示停留时间
            let durationText = '';
            if (timeEntered[stepStatus]) {
                const startTime = timeEntered[stepStatus];
                let endTime = now;
                
                if (index < currentIndex && timeEntered[statuses[index + 1]]) {
                    endTime = timeEntered[statuses[index + 1]];
                } else if (isRejected) {
                    const rejectLog = logs.slice().reverse().find(l => l.new_status === '已拒绝');
                    if (rejectLog) endTime = new Date(rejectLog.created_at).getTime();
                } else if (currentStatus === statuses[statuses.length - 1] && index !== statuses.length - 1) {
                     // 正常完结流程，前面节点的endTime已经被限制了，这里是兜底
                }

                const days = getDays(endTime - startTime);
                // 确保至少显示0天，或者可以显示详细的停留天数
                durationText = `<div class="step-duration" style="font-size:10px; color:#64748b; margin-top:2px;">${tText(`停 ${days} 天`, `Stop ${days} days`)}</div>`;
            }

            let durEl = step.querySelector('.step-duration');
            if (durEl) {
                if (durationText) durEl.outerHTML = durationText;
                else durEl.remove();
            } else if (durationText) {
                step.insertAdjacentHTML('beforeend', durationText);
            }

            if (isRejected) {
                if (index === 0) step.classList.add('completed');
                else step.style.opacity = '0.2';
            } else {
                step.style.opacity = '';
                if (index < currentIndex) {
                    step.classList.add('completed');
                } else if (index === currentIndex) {
                    step.classList.add('active');
                }
            }
        });

        lines.forEach((line, index) => {
            line.className = 'step-line'; // reset
            if (!isRejected && index < currentIndex) {
                line.classList.add('completed');
            }
        });
    },

    renderLogs: function(logs) {
        const container = document.getElementById('logsTimeline');
        container.innerHTML = '';
        
        if (logs.length === 0) {
            container.innerHTML = `<div style="color:#64748b; font-size:12px;">${tText('暂无日志', 'No logs')}</div>`;
            return;
        }

        logs.forEach(log => {
            const dateStr = new Date(log.created_at).toLocaleString('zh-CN', { 
                month: '2-digit', day: '2-digit', 
                hour: '2-digit', minute: '2-digit' 
            });

            const el = document.createElement('div');
            el.className = 'log-item';
            
            let actionText = '';
            if (log.old_status && log.new_status && log.old_status !== log.new_status) {
                const mapEn = { '提交': 'Submitted', '需求接受': 'Accepted', '需求实现中': 'In Progress', '需求完成': 'Completed', '验收完成': 'Verified', '需求评价': 'Evaluated', '已拒绝': 'Rejected' };
                actionText = `${tText('状态流转：', 'Status: ')}<span style="color:#94a3b8">${tText(log.old_status, mapEn[log.old_status]||log.old_status)}</span> ➔ <span style="color:#34d399">${tText(log.new_status, mapEn[log.new_status]||log.new_status)}</span>`;
            } else {
                actionText = tText('更新了信息', 'Updated info');
            }

            el.innerHTML = `
                <div class="log-time">${dateStr}</div>
                <div class="log-content">
                    <div class="log-header">
                        <span class="log-operator">${this.escapeHTML(log.operator || 'System')}</span>
                        <span class="log-action">${actionText}</span>
                    </div>
                    ${log.remark ? `<div class="log-remark">${this.escapeHTML(log.remark)}</div>` : ''}
                </div>
            `;
            container.appendChild(el);
        });
    },

    escapeHTML: function(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }
};

document.addEventListener('DOMContentLoaded', () => {
    ReqApp.init();
    const storedLang = localStorage.getItem('tools_lang') || navigator.language || 'zh';
    applyReqLanguage(storedLang.startsWith('en') ? 'en' : 'zh');
});

window.addEventListener('tools:requirement-page-categories-change', event => {
    ReqApp.refreshCategoryOptions(event.detail?.categories);
});
