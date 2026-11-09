// ================== 双语切换引擎 ==================
const REQ_I18N_DICT = {
    "需求管理 - Dragon Claw": "Requirements - Dragon Claw",
    "需求管理广场": "Requirements Plaza",
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
    "全局通用": "General",
    "新增页面": "New Page",
    "工具中台首页": "Home",
    "数据抓取(UIVF12)": "Data Fetch (UIVF12)",
    "数据导入(SLA)": "Data Import (SLA)",
    "报表看板": "Dashboard",
    "一键催办": "Expedite",
    "月报页面": "Monthly Report",
    "需求管理": "Requirements",
    "简短描述需求的核心目的": "Briefly describe the core purpose",
    "详细说明背景、期望效果等": "Detail the background, expected results, etc.",
    "留空或填写负责人": "Leave blank or enter assignee",
    "流转状态时，建议填写备注": "Suggest adding a remark during state transition",
    "需求详情描述": "Description",
    "未设字数上限": "No character limit",
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
    "已拒绝 (暂不采纳)": "Rejected",
    "暂无需求，点击右上角提交一个吧！": "No requests, click top right to submit one!",
    "提交新需求": "Submit New Request",
    "需求详情与管理": "Request Details & Management",
    "保存中...": "Saving...",
    "需求已更新": "Request updated",
    "上传图片": "Add images",
    "意见反馈": "Feedback",
    "技能发布申请": "Skill publication request",
    "允许发布": "Approve publication",
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
    "在需求广场中优先展示并高亮提醒": "Show first in the plaza with a highlighted alert",
    "相关截图 / 附件": "Screenshots / Attachments",
    "点击添加": "Click to add",
    "支持拖拽或粘贴": "Drag or paste supported",
    "查看大图": "View image",
    "删除图片": "Delete image",
    "已保存": "Saved",
    "新添加": "New",
    "图片预览": "Image Preview",
    "关闭预览": "Close preview",
    "上一张": "Previous",
    "下一张": "Next",
    "已达到最大图片限制 (6张)": "Maximum limit reached (6 images)",
    "最多只能添加 6 张图片，超出部分已忽略": "Up to 6 images allowed, extra images ignored",
    "仅支持 PNG、JPG、WebP、GIF 格式的图片": "Only PNG, JPG, WebP, GIF images are supported",
    "单张图片不能超过 4 MB": "Each image must not exceed 4 MB",
    "最多 6 张图片，每张不超过 4 MB": "Up to 6 images, 4 MB each",
    "已保存图片": "Saved image",
    "新添加图片": "New image"
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
    ReqApp.updateDescriptionCount();
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

// 原生线描图标，统一使用 currentColor 适配深浅主题。
function reqIcon(name) {
    const paths = {
        list: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h4"/>',
        search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
        queue: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 4v16M12 9h4M12 13h4"/>',
        alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
        check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18"/>',
        tool: '<path d="M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3Z"/>'
    };
    return `<svg class="req-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.list}</svg>`;
}

const ReqApp = {
    requirements: [],
    currentReqId: null,
    canManageCurrent: false,
    currentPage: 1,
    pageSize: 8,
    existingImages: [],
    pendingImages: [],
    previewImageList: [],
    currentPreviewIndex: 0,
    canEdit: true,

    fallbackCategories: [
        { value: '全局通用', label: '全局通用' },
        { value: '新增页面', label: '新增页面' },
        { value: '工具中台首页', label: '工具中台首页' },
        { value: '数据抓取(UIVF12)', label: '数据抓取(UIVF12)' },
        { value: '数据导入(SLA)', label: '数据导入(SLA)' },
        { value: '报表看板', label: '报表看板' },
        { value: '一键催办', label: '一键催办' },
        { value: '月报页面', label: '月报页面' },
        { value: '需求管理', label: '需求管理' }
    ],

    init: async function() {
        this.refreshCategoryOptions();
        const descInput = document.getElementById('reqDescInput');
        if (descInput) descInput.addEventListener('input', () => this.updateDescriptionCount());
        this.initImagesUI();
        this.updateDescriptionCount();
        await this.loadRequirements();
    },

    initImagesUI: function() {
        const input = document.getElementById('reqImagesInput');
        const dropzone = document.getElementById('reqUploadDropzone');
        if (input) {
            input.addEventListener('change', event => {
                const files = [...(event.target.files || [])];
                this.handleFilesSelected(files);
            });
        }
        if (dropzone) {
            ['dragenter', 'dragover'].forEach(name => {
                dropzone.addEventListener(name, e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (this.canEdit && ((this.existingImages?.length || 0) + (this.pendingImages?.length || 0) < 6)) {
                        dropzone.classList.add('is-dragover');
                    }
                });
            });
            ['dragleave', 'dragend', 'drop'].forEach(name => {
                dropzone.addEventListener(name, e => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.remove('is-dragover');
                });
            });
            dropzone.addEventListener('drop', e => {
                e.preventDefault();
                e.stopPropagation();
                if (!this.canEdit) return;
                const files = [...(e.dataTransfer?.files || [])];
                if (files.length) this.handleFilesSelected(files);
            });
        }
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('paste', event => {
                const modal = document.getElementById('reqModal');
                if (!modal || modal.style.display === 'none' || !this.canEdit) return;
                const items = event.clipboardData?.items;
                if (!items) return;
                const imageFiles = [];
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type && items[i].type.startsWith('image/')) {
                        const file = items[i].getAsFile();
                        if (file) imageFiles.push(file);
                    }
                }
                if (imageFiles.length) {
                    event.preventDefault();
                    this.handleFilesSelected(imageFiles);
                }
            });
            window.addEventListener('keydown', event => {
                const previewModal = document.getElementById('reqPreviewModal');
                if (previewModal && previewModal.style.display !== 'none') {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        this.closePreviewModal();
                    } else if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        this.prevPreviewImage();
                    } else if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        this.nextPreviewImage();
                    }
                    return;
                }
                const reqModal = document.getElementById('reqModal');
                if (event.key === 'Escape' && reqModal && reqModal.style.display !== 'none') {
                    if (document.activeElement?.tagName !== 'TEXTAREA') {
                        this.closeModal();
                    }
                }
            });
        }
    },

    handleFilesSelected: function(files) {
        if (!files || !files.length || !this.canEdit) return;
        const input = document.getElementById('reqImagesInput');
        if (input) input.value = '';

        const currentTotal = (this.existingImages?.length || 0) + (this.pendingImages?.length || 0);
        if (currentTotal >= 6) {
            showToast(tText('已达到最大图片限制 (6张)', 'Maximum limit reached (6 images)'), 'error');
            return;
        }

        let accepted = 0;
        let rejectedFormat = 0;
        let rejectedSize = 0;

        for (const file of files) {
            const nowTotal = (this.existingImages?.length || 0) + (this.pendingImages?.length || 0);
            if (nowTotal >= 6) {
                showToast(tText('最多只能添加 6 张图片，超出部分已忽略', 'Up to 6 images allowed, extra images ignored'), 'info');
                break;
            }
            if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
                rejectedFormat++;
                continue;
            }
            if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
                rejectedSize++;
                continue;
            }
            const isDup = (this.pendingImages || []).some(p => p.name === file.name && p.size === file.size && p.file?.lastModified === file.lastModified);
            if (isDup) continue;

            const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : '';
            this.pendingImages.push({ file, name: file.name, size: file.size, type: file.type, url });
            accepted++;
        }

        if (rejectedFormat > 0) {
            showToast(tText('仅支持 PNG、JPG、WebP、GIF 格式的图片', 'Only PNG, JPG, WebP, GIF images are supported'), 'error');
        } else if (rejectedSize > 0) {
            showToast(tText('单张图片不能超过 4 MB', 'Each image must not exceed 4 MB'), 'error');
        }

        this.refreshImagesUI();
    },

    removePendingImage: function(index) {
        if (!this.pendingImages || index < 0 || index >= this.pendingImages.length) return;
        const item = this.pendingImages.splice(index, 1)[0];
        if (item?.url && typeof URL !== 'undefined' && URL.revokeObjectURL) {
            URL.revokeObjectURL(item.url);
        }
        this.refreshImagesUI();
    },

    cleanupPendingImages: function() {
        if (this.pendingImages && this.pendingImages.length) {
            this.pendingImages.forEach(item => {
                if (item?.url && typeof URL !== 'undefined' && URL.revokeObjectURL) {
                    URL.revokeObjectURL(item.url);
                }
            });
        }
        this.pendingImages = [];
        const input = document.getElementById('reqImagesInput');
        if (input) input.value = '';
    },

    refreshImagesUI: function() {
        this.existingImages = this.existingImages || [];
        this.pendingImages = this.pendingImages || [];
        const totalCount = this.existingImages.length + this.pendingImages.length;
        this.imageCount = totalCount;

        const countEl = document.getElementById('reqImagesCount');
        if (countEl) countEl.textContent = `(${totalCount}/6)`;

        const pickerEl = document.getElementById('reqImagesPicker');
        if (pickerEl) pickerEl.style.display = (!this.canEdit || totalCount >= 6) ? 'none' : 'flex';

        const sectionEl = document.getElementById('reqImagesSection');
        if (sectionEl) sectionEl.hidden = (!totalCount && !this.canEdit);

        const listEl = document.getElementById('reqImagesList');
        if (!listEl) return;
        listEl.replaceChildren();

        // Render existing images
        this.existingImages.forEach((img, idx) => {
            const card = document.createElement('div');
            card.className = 'req-image-card';
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.title = img.name || tText('已保存图片', 'Saved image');

            const tag = document.createElement('span');
            tag.className = 'req-image-tag';
            tag.textContent = tText('已保存', 'Saved');

            const image = document.createElement('img');
            image.src = img.href;
            image.alt = img.name || 'image';
            image.loading = 'lazy';

            const mask = document.createElement('div');
            mask.className = 'req-image-mask';

            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'req-image-btn preview-btn';
            previewBtn.title = tText('查看大图', 'View image');
            previewBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
            previewBtn.onclick = (e) => {
                e.stopPropagation();
                this.openPreviewModal(idx);
            };

            mask.append(previewBtn);
            card.append(tag, image, mask);
            card.onclick = () => this.openPreviewModal(idx);
            listEl.append(card);
        });

        // Render pending images
        this.pendingImages.forEach((item, pIdx) => {
            const globalIdx = this.existingImages.length + pIdx;
            const card = document.createElement('div');
            card.className = 'req-image-card';
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.title = item.name || tText('新添加图片', 'New image');

            const tag = document.createElement('span');
            tag.className = 'req-image-tag new';
            tag.textContent = tText('新添加', 'New');

            const image = document.createElement('img');
            image.src = item.url;
            image.alt = item.name || 'image';

            const mask = document.createElement('div');
            mask.className = 'req-image-mask';

            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'req-image-btn preview-btn';
            previewBtn.title = tText('查看大图', 'View image');
            previewBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
            previewBtn.onclick = (e) => {
                e.stopPropagation();
                this.openPreviewModal(globalIdx);
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'req-image-btn delete-btn';
            deleteBtn.title = tText('删除图片', 'Delete image');
            deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                this.removePendingImage(pIdx);
            };

            mask.append(previewBtn, deleteBtn);
            card.append(tag, image, mask);
            card.onclick = () => this.openPreviewModal(globalIdx);
            listEl.append(card);
        });
    },

    openPreviewModal: function(index) {
        const allImages = [
            ...(this.existingImages || []).map(img => ({ name: img.name, url: img.href })),
            ...(this.pendingImages || []).map(p => ({ name: p.name, url: p.url }))
        ];
        if (!allImages.length || index < 0 || index >= allImages.length) return;
        this.previewImageList = allImages;
        this.currentPreviewIndex = index;
        this.updatePreviewModalUI();
        const modal = document.getElementById('reqPreviewModal');
        if (modal) modal.style.display = 'flex';
    },

    closePreviewModal: function() {
        const modal = document.getElementById('reqPreviewModal');
        if (modal) modal.style.display = 'none';
        const img = document.getElementById('reqPreviewImage');
        if (img) img.src = '';
    },

    prevPreviewImage: function() {
        if (!this.previewImageList || !this.previewImageList.length) return;
        if (this.currentPreviewIndex > 0) {
            this.currentPreviewIndex--;
            this.updatePreviewModalUI();
        }
    },

    nextPreviewImage: function() {
        if (!this.previewImageList || !this.previewImageList.length) return;
        if (this.currentPreviewIndex < this.previewImageList.length - 1) {
            this.currentPreviewIndex++;
            this.updatePreviewModalUI();
        }
    },

    updatePreviewModalUI: function() {
        if (!this.previewImageList || !this.previewImageList.length) return;
        const current = this.previewImageList[this.currentPreviewIndex];
        const titleEl = document.getElementById('reqPreviewFilename');
        if (titleEl) titleEl.textContent = current.name || tText('图片预览', 'Image Preview');
        const indexEl = document.getElementById('reqPreviewIndex');
        if (indexEl) indexEl.textContent = `${this.currentPreviewIndex + 1} / ${this.previewImageList.length}`;
        const imgEl = document.getElementById('reqPreviewImage');
        if (imgEl) imgEl.src = current.url;

        const prevBtn = document.getElementById('reqPreviewPrev');
        if (prevBtn) prevBtn.disabled = (this.currentPreviewIndex === 0);
        const nextBtn = document.getElementById('reqPreviewNext');
        if (nextBtn) nextBtn.disabled = (this.currentPreviewIndex >= this.previewImageList.length - 1);
    },

    updateDescriptionCount: function() {
        const input = document.getElementById('reqDescInput');
        const counter = document.getElementById('reqDescCount');
        if (!input || !counter) return;
        // 按 Unicode 码点计数，避免常用 emoji 被 UTF-16 长度算成两个字。
        const count = Array.from(input.value).length.toLocaleString(currentReqLang === 'en' ? 'en-US' : 'zh-CN');
        counter.textContent = tText(`已输入 ${count} 字 · 还可输入：不限`, `${count} characters entered · Remaining: unlimited`);
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
            uniqueCategories.push({ value, label: String(category.label || value).replace(/^[^\p{L}\p{N}]+/u, '') });
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
            board.innerHTML = `<div style="color: var(--req-muted); grid-column: 1 / -1; text-align: center; padding: 40px;">${tText('暂无需求，点击右上角提交一个吧！', 'No requests, click top right to submit one!')}</div>`;
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
                miniFlowHtml = `<div style="color: var(--req-ink); font-size: 13px; font-weight: bold; border: 1px dashed var(--req-ink); padding: 4px 12px; border-radius: 12px; background: var(--req-soft);">${tText('已拒绝采纳', 'Rejected')}</div>`;
            } else {
                miniFlowHtml = `<div style="display:flex; align-items:center;">`;
                statuses.forEach((s, idx) => {
                    const isCompleted = idx < currentIndex;
                    const isActive = idx === currentIndex;
                    miniFlowHtml += `
                        <div class="req-mini-step ${isActive ? 'is-active' : isCompleted ? 'is-complete' : ''}">
                            <div class="req-mini-dot"></div>
                            <div class="req-mini-label">${tText(s.replace('需求', ''), ['Submit', 'Accept', 'Progressing', 'Done', 'Verify', 'Evaluate'][idx] || s)}</div>
                        </div>`;
                    if (idx < statuses.length - 1) miniFlowHtml += `<div class="req-mini-line ${isCompleted ? 'is-complete' : ''}"></div>`;
                });
                miniFlowHtml += `</div>`;
            }

            card.innerHTML = `
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
                        ${req.urgent ? `<span class="urgent-badge">${reqIcon('alert')} ${tText('紧急', 'Urgent')}</span>` : ''}
                        <h3 class="req-title" style="margin:0; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${this.escapeHTML(req.title)}">${this.escapeHTML(req.title)}</h3>
                        <span class="req-status-badge" style="background:rgba(255,255,255,0.1); color:var(--req-muted); margin:0;">${this.escapeHTML(req.category || tText('未分类', 'Uncategorized'))}</span>
                    </div>
                    <div class="req-desc" style="margin-bottom: 6px; -webkit-line-clamp: 1;" title="${this.escapeHTML(req.description || tText('无详细描述', 'No description'))}">${this.escapeHTML(req.description || tText('无详细描述', 'No description'))}</div>
                    <div class="req-meta" style="font-size: 12px; color: var(--req-muted);">
                        <span>${reqIcon('user')} ${this.escapeHTML(req.creator || 'Guest')}</span>
                        <span style="margin: 0 6px;">|</span>
                        <span>${reqIcon('calendar')} ${timeStr}</span>
                    </div>
                </div>

                <div style="display: flex; align-items: center; justify-content: center; min-width: 320px; padding: 0 10px;">
                    ${miniFlowHtml}
                </div>

                <div style="width: 130px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; border-left: 1px dashed rgba(255,255,255,0.1); padding-left: 16px;">
                    <span class="req-status-badge ${statusClass}" style="margin: 0 0 8px 0; width: 100%; text-align: center; box-sizing: border-box;">${tText(req.status, { '提交': 'Submitted', '需求接受': 'Accepted', '需求实现中': 'In Progress', '需求完成': 'Completed', '验收完成': 'Verified', '需求评价': 'Evaluated', '已拒绝': 'Rejected' }[req.status] || req.status)}</span>
                    ${req.assignee ? `<span style="font-size: 12px; color: var(--req-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;" title="${this.escapeHTML(req.assignee)}">${reqIcon('tool')} ${this.escapeHTML(req.assignee)}</span>` : `<span style="font-size: 12px; color: var(--req-muted); font-style: italic;">${tText('未分配', 'Unassigned')}</span>`}
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
            { icon: 'list', value: total, label: tText('全部需求', 'All requests'), tone: 'blue' },
            { icon: 'search', value: submitted, label: tText('Codex 待确认', 'Codex review'), tone: 'violet' },
            { icon: 'queue', value: accepted + implementing, label: tText('实现队列', 'Build queue'), tone: 'cyan' },
            { icon: 'alert', value: urgent, label: tText('紧急需求', 'Urgent'), tone: 'orange' },
            { icon: 'check', value: `${completionRate}%`, label: tText('完成率', 'Completion'), tone: 'green' }
        ];
        document.getElementById('reqStatsTop').innerHTML = topStats.map(stat => `
            <article class="req-stat-card stat-tone-${stat.tone}">
                <span class="stat-card-icon">${reqIcon(stat.icon)}</span>
                <span class="stat-card-copy"><strong>${stat.value}</strong><small>${stat.label}</small></span>
                <span class="stat-card-glow"></span>
            </article>
        `).join('');

        const flowGroups = [
            { label: tText('待评估', 'Awaiting'), value: submitted },
            { label: tText('已接受', 'Accepted'), value: accepted },
            { label: tText('实现中', 'Building'), value: implementing },
            { label: tText('已完成', 'Completed'), value: completed }
        ];
        document.getElementById('reqStatsLeft').innerHTML = `
            <div class="stat-rail-heading"><span class="stat-live-dot"></span><div><small>${tText('实时流程', 'LIVE FLOW')}</small><strong>${tText('交付雷达', 'Delivery radar')}</strong></div></div>
            <div class="stat-flow-list">
                ${flowGroups.map(group => {
                    const ratio = total ? Math.max(group.value ? 7 : 0, Math.round((group.value / total) * 100)) : 0;
                    return `<div class="stat-flow-item"><span><em>${group.label}</em><b>${group.value}</b></span><i><u style="width:${ratio}%"></u></i></div>`;
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

    renderImages: function(images, canEdit) {
        this.cleanupPendingImages();
        this.canEdit = Boolean(canEdit);
        const validList = [];
        for (const image of (images || [])) {
            if (/^\/api\/requirements\/\d+\/images\/\d+$/.test(image.href)) {
                validList.push(image);
            }
        }
        this.existingImages = validList;
        this.refreshImagesUI();
    },

    renderPublication: function(publication, canManage = false) {
        const section = document.getElementById('reqSkillPublication');
        section.hidden = !publication;
        if (!publication) return;
        document.getElementById('reqSkillPublicationTitle').textContent = `${tText('技能发布申请', 'Skill publication request')} · @${publication.id}`;
        document.getElementById('reqSkillPublicationStatus').textContent = publication.state === 'published'
            ? tText(`已由 ${publication.approvedBy} 发布`, `Published by ${publication.approvedBy}`)
            : publication.state === 'rejected' ? tText('已拒绝', 'Rejected') : tText('待超级管理员审核', 'Awaiting administrator review');
        const content = document.getElementById('reqSkillPublicationContent');
        content.hidden = !publication.markdown;
        content.textContent = publication.markdown || '';
        document.getElementById('reqApproveSkill').hidden = !canManage || publication.state !== 'pending';
    },

    approveSkill: async function() {
        const id = this.currentReqId;
        const button = document.getElementById('reqApproveSkill');
        if (!id || button.disabled) return;
        if (!await AppDialog.confirm(tText('将此版本发布为全员可用的技能？当前系统版本会保留在版本历史中。', 'Publish this version for all users? The current system version is kept in version history.'),
            { title: tText('允许发布', 'Approve publication') })) return;
        button.disabled = true;
        try {
            await API.post(`/api/requirements/${id}/approve-skill`, {});
            await this.openEditModal(id);
            await this.loadRequirements();
        } catch (error) {
            showToast(error.message, 'error');
        } finally { button.disabled = false; }
    },

    openCreateModal: function() {
        this.currentReqId = null;
        this.canManageCurrent = false;
        this.renderImages([], true);
        this.renderPublication(null);
        document.getElementById('modalTitle').textContent = tText('提交新需求', 'Submit New Request');
        
        // Reset form and enable inputs
        const inputs = ['reqTitleInput', 'reqCategorySelect', 'reqDescInput', 'reqStatusSelect', 'reqAssigneeInput', 'reqRemarkInput'];
        inputs.forEach(id => {
            document.getElementById(id).value = '';
            document.getElementById(id).disabled = false;
        });
        this.updateDescriptionCount();
        document.getElementById('reqStatusSelect').value = '提交';
        document.getElementById('reqUrgentInput').checked = false;
        document.getElementById('reqUrgentInput').disabled = false;
        
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
            this.updateDescriptionCount();
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
            
            this.canManageCurrent = req.canManage === true;
            const canEdit = req.canEdit === true;
            for (const id of ['reqTitleInput', 'reqCategorySelect', 'reqDescInput', 'reqUrgentInput', 'reqRemarkInput']) {
                document.getElementById(id).disabled = !canEdit;
            }
            document.getElementById('reqStatusSelect').disabled = !this.canManageCurrent;
            document.getElementById('reqAssigneeInput').disabled = !this.canManageCurrent;
            document.getElementById('btnDeleteReq').style.display = canEdit ? 'block' : 'none';
            document.getElementById('btnSaveReq').style.display = canEdit ? 'block' : 'none';
            this.renderImages(req.images || [], canEdit);
            this.renderPublication(req.skillPublication, this.canManageCurrent);

            document.getElementById('reqModal').style.display = 'flex';
        } catch (e) {
            showToast(tText('获取需求详情失败: ', 'Failed to get request details: ') + e.message, 'error');
        }
    },

    closeModal: function() {
        this.cleanupPendingImages();
        this.closePreviewModal();
        const modal = document.getElementById('reqModal');
        if (modal) modal.style.display = 'none';
    },

    ...window.RequirementsClient,

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
            if (this.canManageCurrent) {
                payload.status = document.getElementById('reqStatusSelect').value;
                payload.assignee = document.getElementById('reqAssigneeInput').value.trim();
            }
            payload.remark = document.getElementById('reqRemarkInput').value.trim();
        }

        try {
            const btn = document.getElementById('btnSaveReq');
            btn.textContent = tText('保存中...', 'Saving...');
            btn.disabled = true;

            const pendingFiles = (this.pendingImages || []).map(item => item.file);
            const inputFiles = [...(document.getElementById('reqImagesInput')?.files || [])];
            const filesToEncode = pendingFiles.length ? pendingFiles : inputFiles;
            if (filesToEncode.length) payload.images = await this.encodeImages(filesToEncode);
            const method = this.currentReqId ? 'PUT' : 'POST';
            const path = this.currentReqId ? `/api/requirements/${this.currentReqId}` : '/api/requirements';
            await this.submitPayload(payload, method, path, message => { btn.textContent = message; });
            showToast(this.currentReqId ? tText('需求已更新', 'Request updated') : tText('需求提交成功', 'Request submitted successfully'), 'success');

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
                durationText = `<div class="step-duration" style="font-size:10px; color:var(--req-muted); margin-top:2px;">${tText(`停 ${days} 天`, `Stop ${days} days`)}</div>`;
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
            container.innerHTML = `<div style="color:var(--req-muted); font-size:12px;">${tText('暂无日志', 'No logs')}</div>`;
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
                actionText = `${tText('状态流转：', 'Status: ')}<span style="color:var(--req-muted)">${tText(log.old_status, mapEn[log.old_status]||log.old_status)}</span> ➔ <span style="color:var(--req-ink)">${tText(log.new_status, mapEn[log.new_status]||log.new_status)}</span>`;
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

if (typeof window !== 'undefined') {
    window.ReqApp = ReqApp;
}

document.addEventListener('DOMContentLoaded', () => {
    ReqApp.init();
    const storedLang = localStorage.getItem('tools_lang') || navigator.language || 'zh';
    applyReqLanguage(storedLang.startsWith('en') ? 'en' : 'zh');
});

window.addEventListener('tools:requirement-page-categories-change', event => {
    ReqApp.refreshCategoryOptions(event.detail?.categories);
});
