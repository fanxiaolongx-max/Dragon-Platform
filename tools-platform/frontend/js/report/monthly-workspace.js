(function () {
    'use strict';

    const toolKey = () => `standard-monthly-report:${tenant()}`;
    const labels = {
        zh: { groupEdit:'编辑与设置', groupProject:'工程与版本', groupDownload:'下载与交付', bold:'加粗', italic:'斜体', color:'文字颜色', colors:['琥珀色','红色','蓝色','绿色','深灰色'], 'reset-month':'恢复本月自动文案', 'reset-fixed':'恢复固定文案', 'toggle-time':'隐藏导入时间', showTime:'显示导入时间', config:'映射与阈值配置', 'export-project':'导出工程', 'import-project':'导入工程', 'save-snapshot':'保存快照', snapshots:'月报快照库', diff:'月报比对', 'png-menu':'下载 PNG ▾', pdf:'下载 PDF', html:'下载 HTML', excel:'下载 Excel', msg:'下载 MSG', pngZh:'🇨🇳 中文版 PNG · 仅中文简报与图表', pngEn:'🇬🇧 英文版 PNG · 仅英文简报与图表', pngBoth:'🌐 中英文合一 PNG · 完整对照长图', pngAll:'📦 一键下载全部（3张）', configTitle:'网络名称映射与临期阈值', warning:'重点提示天数（含已超期）', mappingHelp:'每行填写 原始网络名称 = 分类缩写；留空表示沿用一键催办中的映射。', cancel:'取消', save:'保存', editHint:'点击正文或表格单元格可编辑；选中文字后可加粗、设为斜体或改色。' },
        en: { groupEdit:'Edit & Settings', groupProject:'Projects & Versions', groupDownload:'Downloads', bold:'Bold', italic:'Italic', color:'Text color', colors:['Amber','Red','Blue','Green','Slate'], 'reset-month':'Restore generated copy', 'reset-fixed':'Restore fixed copy', 'toggle-time':'Hide import details', showTime:'Show import details', config:'Mapping & warning days', 'export-project':'Export project', 'import-project':'Import project', 'save-snapshot':'Save snapshot', snapshots:'Snapshot library', diff:'Compare reports', 'png-menu':'Download PNG ▾', pdf:'Download PDF', html:'Download HTML', excel:'Download Excel', msg:'Download MSG', pngZh:'🇨🇳 Chinese PNG', pngEn:'🇬🇧 English PNG', pngBoth:'🌐 Bilingual PNG', pngAll:'📦 Download all three', configTitle:'Network mapping and warning days', warning:'Highlight within days (including overdue)', mappingHelp:'One mapping per line: original network name = category abbreviation. Empty uses the expedite mapping.', cancel:'Cancel', save:'Save', editHint:'Click report text or a table cell to edit; select text to bold, italicize, or recolor.' }
    };
    const configUi = {
        zh: { subtitle:'设置网络归属与临期单据的提示范围', mapping:'网络名称映射', unit:'天', close:'关闭', example:'例如：EG-Egypt ET = ET' },
        en: { subtitle:'Set network categories and the ticket warning window', mapping:'Network name mapping', unit:'days', close:'Close', example:'Example: EG-Egypt ET = ET' }
    };
    const actionRoot = document.getElementById('monthlyWorkspaceActions');
    const status = document.getElementById('monthlyWorkspaceStatus');
    const dialog = document.getElementById('monthlyWorkspaceDialog');
    const state = { warningDays:10, mappings:{}, sourceTimeHidden:false, restoring:false, exporting:false, activeEdit:null, selectedRange:null };
    const selectionToolbar = document.getElementById('monthlySelectionToolbar');
    const bridge = () => window.MonthlyReportBridge;
    const lang = () => window.currentLang === 'en' ? 'en' : 'zh';
    const tenant = () => { try { return localStorage.getItem('tools_tenant_id') || 'default'; } catch (_) { return 'default'; } };
    const settingsKey = () => `monthly-workspace:settings:v1:${tenant()}`;
    const dateRange = () => {
        const trends = bridge()?.getState().trends || [];
        return trends.length ? `${trends[0].date}_${trends[trends.length - 1].date}` : 'empty';
    };
    const selectedRange = () => {
        const report = bridge()?.getState() || {};
        return report.startDate && report.endDate ? `${report.startDate}_${report.endDate}` : dateRange();
    };
    const reportKey = (language = lang()) => `monthly-workspace:copy:v1:${tenant()}:${selectedRange()}:target-${bridge()?.getState().targetMonth || ''}:${language}`;
    const fixedKey = (language = lang()) => `monthly-workspace:fixed:v1:${tenant()}:${language}`;
    const readJson = key => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { return {}; } };
    const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    const tr = key => labels[lang()][key];
    const notify = message => { status.textContent = message; };
    const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    function cleanHtml(html) {
        const root = document.createElement('div');
        root.innerHTML = String(html || '');
        const allowed = new Set(['BR','B','STRONG','I','EM','U','SPAN','A','SMALL','SUB','SUP']);
        function clean(node) {
            [...node.childNodes].forEach(child => {
                if (child.nodeType === 8) { child.remove(); return; }
                if (child.nodeType !== 1) return;
                if (child.tagName === 'FONT') {
                    const span = document.createElement('span');
                    const fontColor = child.getAttribute('color');
                    if (fontColor && CSS.supports('color', fontColor)) span.style.color = fontColor;
                    span.append(...child.childNodes);
                    child.replaceWith(span);
                    clean(span);
                    return;
                }
                if (!allowed.has(child.tagName)) {
                    child.replaceWith(...child.childNodes);
                    clean(node);
                    return;
                }
                const color = child.style.color;
                const weight = child.style.fontWeight;
                const href = child.tagName === 'A' ? child.getAttribute('href') : null;
                [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
                if (color && CSS.supports('color', color)) child.style.color = color;
                if (weight === 'bold' || Number(weight) >= 600) child.style.fontWeight = 'bold';
                if (href && href.startsWith('#')) child.setAttribute('href', href);
                clean(child);
            });
        }
        clean(root);
        return root.innerHTML;
    }

    function editableTargets() {
        const fixed = document.querySelectorAll('#report-content .section-title, #manual-score-section > h4, #full-report-section > h4, #monthly-explanation-section h3, #monthly-explanation-section h4');
        const dynamic = document.querySelectorAll('#summary-content p, #summary-content li, #summary-content h4, #ranking-table tbody td, #matrix-table tbody td, #manual-score-table tbody td, #full-report-content td, #full-report-content th, #monthly-explanation-section p, #monthly-explanation-section li');
        return [
            ...[...fixed].map((element, index) => ({ element, scope:'fixed', key:`fixed-${index}` })),
            ...[...dynamic].map((element, index) => ({ element, scope:'dynamic', key:`dynamic-${index}` }))
        ];
    }

    function afterRender() {
        hideSelectionToolbar();
        if (state.restoring) return;
        const ready = !!bridge()?.getState().trends?.length;
        actionRoot.hidden = !ready;
        if (!ready) return;
        const dynamic = readJson(reportKey());
        const fixed = readJson(fixedKey());
        let migratedLegend = false;
        editableTargets().forEach(({ element, scope, key }) => {
            element.dataset.monthlyEditKey = key;
            element.dataset.monthlyEditScope = scope;
            element.contentEditable = 'true';
            element.classList.add('monthly-editable');
            const saved = (scope === 'fixed' ? fixed : dynamic)[key];
            if (typeof saved === 'string') {
                element.innerHTML = cleanHtml(saved);
                if (element.matches('.monthly-ticket-intro p')) {
                    const oldLegends = element.querySelectorAll('small');
                    if (oldLegends.length) {
                        oldLegends.forEach(node => node.remove());
                        dynamic[key] = cleanHtml(element.innerHTML).trim();
                        migratedLegend = true;
                    }
                }
            }
        });
        if (migratedLegend) writeJson(reportKey(), dynamic);
        applyTimeVisibility();
        setLabels();
    }

    function saveEdit(element) {
        if (!element?.dataset.monthlyEditKey || state.exporting) return;
        const key = element.dataset.monthlyEditScope === 'fixed' ? fixedKey() : reportKey();
        const entries = readJson(key);
        entries[element.dataset.monthlyEditKey] = cleanHtml(element.innerHTML);
        writeJson(key, entries);
        notify(lang() === 'en' ? 'Edits saved in this browser.' : '修改已保存在当前浏览器。');
    }

    function hideSelectionToolbar() {
        selectionToolbar.hidden = true;
        state.selectedRange = null;
    }

    function updateSelectionToolbar() {
        if (state.exporting || actionRoot.hidden) { hideSelectionToolbar(); return; }
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
            if (!selectionToolbar.contains(document.activeElement)) hideSelectionToolbar();
            return;
        }
        const range = selection.getRangeAt(0);
        const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
        const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
        const editable = start?.closest?.('#report-content [data-monthly-edit-key]');
        if (!editable || !editable.contains(end) || !selection.toString().trim()) { hideSelectionToolbar(); return; }
        state.activeEdit = editable;
        state.selectedRange = range.cloneRange();
        selectionToolbar.hidden = false;
        const rect = range.getBoundingClientRect();
        const width = selectionToolbar.offsetWidth;
        const height = selectionToolbar.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
        const top = rect.top > height + 10 ? rect.top - height - 7 : Math.min(window.innerHeight - height - 8, rect.bottom + 7);
        selectionToolbar.style.left = `${left}px`;
        selectionToolbar.style.top = `${Math.max(8, top)}px`;
    }

    function formatSelection(command, value) {
        const range = state.selectedRange;
        const editable = state.activeEdit;
        if (!range || !editable?.isConnected || !editable.contains(range.commonAncestorContainer)) return;
        editable.focus();
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand(command, false, value);
        saveEdit(editable);
        updateSelectionToolbar();
    }

    function setLabels() {
        actionRoot.querySelectorAll('[data-action]').forEach(button => {
            const action = button.dataset.action;
            button.textContent = action === 'toggle-time' && state.sourceTimeHidden ? tr('showTime') : tr(action);
        });
        for (const [group, key] of [['edit','groupEdit'],['project','groupProject'],['download','groupDownload']]) actionRoot.querySelector(`[data-monthly-group="${group}"]`).textContent = tr(key);
        for (const [scope, key] of [['zh','pngZh'],['en','pngEn'],['both','pngBoth'],['all','pngAll']]) actionRoot.querySelector(`[data-png="${scope}"]`).textContent = tr(key);
        document.querySelector('#monthlyColorLabel .monthly-color-text').textContent = tr('color');
        document.getElementById('monthlyTextColor').setAttribute('aria-label', tr('color'));
        selectionToolbar.querySelectorAll('[data-format]').forEach(button => { button.setAttribute('aria-label', tr(button.dataset.format)); button.title = tr(button.dataset.format); });
        selectionToolbar.querySelectorAll('[data-color]').forEach((button, index) => { button.setAttribute('aria-label', tr('colors')[index]); button.title = tr('colors')[index]; });
        const customColor = document.getElementById('monthlySelectionColor');
        customColor.setAttribute('aria-label', tr('color'));
        customColor.title = tr('color');
        document.getElementById('monthlyWorkspaceDialogTitle').textContent = tr('configTitle');
        document.getElementById('monthlyConfigSubtitle').textContent = configUi[lang()].subtitle;
        document.getElementById('monthlyWarningLabel').textContent = tr('warning');
        document.getElementById('monthlyWarningUnit').textContent = configUi[lang()].unit;
        document.getElementById('monthlyMappingLabel').textContent = configUi[lang()].mapping;
        document.getElementById('monthlyMappingHelp').textContent = tr('mappingHelp');
        document.getElementById('monthlyNetworkMappingText').placeholder = configUi[lang()].example;
        document.getElementById('monthlyConfigClose').setAttribute('aria-label', configUi[lang()].close);
        document.getElementById('monthlyConfigClose').title = configUi[lang()].close;
        document.getElementById('monthlyConfigCancel').textContent = tr('cancel');
        document.getElementById('monthlyConfigSave').textContent = tr('save');
        document.getElementById('monthlyWorkspaceStatus').title = tr('editHint');
    }

    function applyTimeVisibility() {
        const panel = document.getElementById('monthlySourcePanel');
        if (panel) panel.hidden = state.sourceTimeHidden;
    }

    function loadSettings() {
        const saved = readJson(settingsKey());
        state.warningDays = Number.isInteger(saved.warningDays) && saved.warningDays >= 0 && saved.warningDays <= 365 ? saved.warningDays : 10;
        state.mappings = saved.mappings && typeof saved.mappings === 'object' && !Array.isArray(saved.mappings) ? saved.mappings : {};
        state.sourceTimeHidden = !!saved.sourceTimeHidden;
        applyTimeVisibility();
    }

    function showConfig() {
        document.getElementById('monthlyWarningDays').value = state.warningDays;
        document.getElementById('monthlyNetworkMappingText').value = Object.entries(state.mappings).map(([key, val]) => `${key} = ${val}`).join('\n');
        dialog.showModal();
    }

    function saveConfig() {
        const days = Number(document.getElementById('monthlyWarningDays').value);
        if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error('Warning days must be between 0 and 365');
        const mappings = {};
        for (const line of document.getElementById('monthlyNetworkMappingText').value.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const split = line.indexOf('=');
            if (split < 1 || !line.slice(split + 1).trim()) throw new Error(`Invalid mapping: ${line}`);
            mappings[line.slice(0, split).trim()] = line.slice(split + 1).trim();
        }
        state.warningDays = days;
        state.mappings = mappings;
        writeJson(settingsKey(), { warningDays:days, mappings, sourceTimeHidden:state.sourceTimeHidden });
        dialog.close();
        bridge().render();
    }

    function collectProject() {
        const report = bridge().getState();
        if (!report.trends?.length) throw new Error('No monthly report data');
        return { fileType:'standard-monthly-project', schemaVersion:1, exportedAt:new Date().toISOString(), report,
            settings:{ warningDays:state.warningDays, mappings:state.mappings, sourceTimeHidden:state.sourceTimeHidden },
            copy:{ zh:readJson(reportKey('zh')), en:readJson(reportKey('en')), fixedZh:readJson(fixedKey('zh')), fixedEn:readJson(fixedKey('en')) } };
    }

    function download(blob, filename) {
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
    const filenameBase = () => `Monthly_Report_${dateRange()}`;

    function exportProject() {
        const project = collectProject();
        download(new Blob([JSON.stringify(project, null, 2)], { type:'application/json' }), `${filenameBase()}_project.json`);
        notify(lang() === 'en' ? 'Project exported.' : '工程已导出。');
    }

    function applyProject(project) {
        if (project?.fileType !== 'standard-monthly-project' || project.schemaVersion !== 1 || !Array.isArray(project.report?.trends) || !project.report.trends.length || !project.report.latest) throw new Error('Invalid monthly report project');
        state.restoring = true;
        try {
            const settings = project.settings || {};
            state.warningDays = Number.isInteger(settings.warningDays) ? settings.warningDays : 10;
            state.mappings = settings.mappings && typeof settings.mappings === 'object' ? settings.mappings : {};
            state.sourceTimeHidden = !!settings.sourceTimeHidden;
            writeJson(settingsKey(), { warningDays:state.warningDays, mappings:state.mappings, sourceTimeHidden:state.sourceTimeHidden });
            bridge().applyState(project.report);
            for (const [language, value] of [['zh',project.copy?.zh],['en',project.copy?.en]]) if (value && typeof value === 'object') writeJson(reportKey(language), value);
            for (const [language, value] of [['zh',project.copy?.fixedZh],['en',project.copy?.fixedEn]]) if (value && typeof value === 'object') writeJson(fixedKey(language), value);
        } finally { state.restoring = false; }
        bridge().render();
        notify(lang() === 'en' ? 'Project loaded into the workspace.' : '工程已载入当前工作区。');
    }

    async function saveSnapshot() {
        const project = collectProject();
        const en = lang() === 'en';
        const name = await AppDialog.prompt(en ? 'Snapshot name:' : '快照名称：', { title: en ? 'Save snapshot' : '保存快照', defaultValue: `${filenameBase()} ${new Date().toLocaleTimeString()}`, maxLength: 120, confirmText: en ? 'Save' : '保存', cancelText: en ? 'Cancel' : '取消' });
        if (name === null) return;
        const sheet = await buildExportSheet(['zh','en']);
        try {
            await window.ReportSnapshotDiff.Store.saveSnapshot({ toolKey:toolKey(), topicKey:'monthly', month:dateRange(), name:name.trim() || filenameBase(), summary:{ title:filenameBase(), targetMonth:project.report.targetMonth }, payload:{ projectData:project, htmlContent:sheet.innerHTML } });
            notify(lang() === 'en' ? 'Snapshot saved.' : '快照已保存。');
        } finally { sheet.remove(); }
    }

    async function openSnapshots() {
        await window.ReportSnapshotDiff.openSnapshotManager({ toolKey:toolKey(), topicKey:'monthly', onSaveNewSnapshot:saveSnapshot, onCompareSnapshot:id => openDiff(id), onRestoreSnapshot:snapshot => applyProject(snapshot.payload?.projectData) });
        const overlay = [...document.querySelectorAll('.report-diff-overlay')].at(-1);
        if (!overlay?.querySelector('.report-snapshot-mgr-dialog')) return;
        overlay.classList.add('monthly-snapshot-manager');
        const english = lang() === 'en';
        overlay.querySelector('.report-diff-title').innerHTML = english ? '<span>📚</span> Monthly snapshot library' : '<span>📚</span> 月报快照库';
        overlay.querySelector('.report-diff-subtitle').textContent = english ? 'Manage saved reports across devices' : '管理已保存并可跨设备使用的历史月报';
        overlay.querySelector('#smNewSnapshotBtn').innerHTML = english ? '<span>📸</span> Save current report' : '<span>📸</span> 保存当前月报';
        overlay.querySelector('#smCloseBtn').setAttribute('aria-label', english ? 'Close snapshot library' : '关闭快照库');
        const empty = overlay.querySelector('#smListContainer > div:not(.report-snapshot-item)');
        if (empty) {
            empty.className = 'monthly-snapshot-empty';
            empty.innerHTML = english ? '<span aria-hidden="true">📚</span><strong>No saved snapshots yet</strong><span>Save the current report to keep a version here.</span>' : '<span aria-hidden="true">📚</span><strong>暂无已保存的月报快照</strong><span>保存当前月报后，即可在这里查看和恢复。</span>';
        }
        overlay.querySelectorAll('.report-snapshot-item').forEach(item => {
            const title = item.querySelector('.report-snapshot-item-title');
            const month = title?.querySelector('.report-diff-pane-badge');
            const meta = item.querySelector('.report-snapshot-item-meta');
            if (month && meta) {
                month.remove();
                if (english) meta.textContent = meta.textContent.replace(/^保存时间：/, 'Saved: ');
                meta.prepend(month);
            }
            for (const [selector, zh, en] of [['.sm-rename-btn','✏️ 重命名','✏️ Rename'],['.sm-delete-btn','🗑️ 删除','🗑️ Delete'],['.sm-compare-btn','🔍 对比','🔍 Compare'],['.sm-restore-btn','📖 读取','📖 Restore']]) {
                const button = item.querySelector(selector);
                if (button) button.textContent = english ? en : zh;
            }
        });
    }

    async function openDiff(id = null) {
        const sheet = await buildExportSheet(['zh','en']);
        try {
            await window.ReportSnapshotDiff.Viewer.openDiffModal({ toolKey:toolKey(), topicKey:'monthly', baselineSnapshotId:id, currentHtml:sheet.innerHTML, currentProject:collectProject(), onApplyToWorkspace:({ rightSheet }) => {
                if (!rightSheet) return;
                rightSheet.querySelectorAll('.monthly-export-part').forEach(part => {
                    const language = part.dataset.monthlyLang;
                    if (!['zh','en'].includes(language)) return;
                    const dynamic = readJson(reportKey(language));
                    const fixed = readJson(fixedKey(language));
                    part.querySelectorAll('[data-monthly-edit-key]').forEach(source => {
                        const target = source.dataset.monthlyEditScope === 'fixed' ? fixed : dynamic;
                        target[source.dataset.monthlyEditKey] = cleanHtml(source.innerHTML);
                    });
                    writeJson(reportKey(language), dynamic);
                    writeJson(fixedKey(language), fixed);
                });
                bridge().render();
            } });
        } finally { sheet.remove(); }
    }

    function chartImage(id) {
        const dom = document.getElementById(id);
        const instance = dom && window.echarts?.getInstanceByDom(dom);
        return instance ? instance.getDataURL({ type:'jpeg', pixelRatio:1.5, backgroundColor:'#fff' }) : '';
    }

    function copyReportPart(language) {
        window.currentLang = language;
        bridge().render();
        const part = document.createElement('section');
        part.className = 'monthly-export-part';
        part.dataset.monthlyLang = language;
        const title = document.getElementById('monthlyReportTitle').cloneNode(true);
        title.removeAttribute('id');
        title.removeAttribute('data-i18n');
        title.removeAttribute('role');
        title.removeAttribute('tabindex');
        title.querySelector('#monthlyFrontendVersion')?.remove();
        part.appendChild(title);
        const period = document.getElementById('report-date-range').cloneNode(true);
        period.removeAttribute('id');
        period.removeAttribute('data-i18n');
        part.appendChild(period);
        const body = document.getElementById('report-content').cloneNode(true);
        body.removeAttribute('id');
        body.style.display = 'block';
        body.querySelectorAll('[data-i18n]').forEach(el => el.removeAttribute('data-i18n'));
        body.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
        for (const id of ['chart-overall','chart-groups']) {
            const image = chartImage(id);
            const target = body.querySelector(`#${id}`);
            if (target && image) target.innerHTML = `<img src="${image}" alt="${escapeText(id)}">`;
        }
        part.appendChild(body);
        return part;
    }

    async function buildExportSheet(languages) {
        if (!bridge().getState().trends?.length) throw new Error('No monthly report data');
        document.activeElement?.blur?.();
        const original = window.currentLang;
        state.exporting = true;
        const sheet = document.createElement('div');
        sheet.className = 'monthly-export-sheet';
        sheet.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;';
        document.body.appendChild(sheet);
        try {
            for (const language of languages) sheet.appendChild(copyReportPart(language));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return sheet;
        } catch (error) { sheet.remove(); throw error; }
        finally { window.currentLang = original; bridge().render(); state.exporting = false; }
    }

    async function exportPng(languages, suffix) {
        const sheet = await buildExportSheet(languages);
        try {
            const canvas = await html2canvas(sheet, { scale:1.7, backgroundColor:'#fff', useCORS:true, windowWidth:1200 });
            await new Promise(resolve => canvas.toBlob(blob => { if (blob) download(blob, `${filenameBase()}_${suffix}.png`); resolve(); }, 'image/png'));
        } finally { sheet.remove(); }
    }

    function excelDisplayValue(element) {
        if (!element.querySelector('strong,b,i,em,span[style],font')) return element.textContent.trim();
        const richText = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const text = walker.currentNode.textContent;
            if (!text) continue;
            const style = getComputedStyle(walker.currentNode.parentElement);
            const rgb = style.color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            const color = rgb ? { argb:'FF' + rgb.slice(1, 4).map(value => Number(value).toString(16).padStart(2, '0')).join('').toUpperCase() } : undefined;
            richText.push({ text, font:{ bold:Number.parseInt(style.fontWeight, 10) >= 600, italic:style.fontStyle === 'italic', ...(color ? { color } : {}) } });
        }
        return richText.length ? { richText } : element.textContent.trim();
    }

    function openMsgProgress() {
        document.getElementById('monthlyMsgProgress')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'monthlyMsgProgress';
        overlay.className = 'monthly-msg-overlay';
        overlay.innerHTML = `<div class="monthly-msg-dialog" role="dialog" aria-modal="true" aria-labelledby="monthlyMsgTitle">
            <div class="monthly-msg-head"><div><h3 id="monthlyMsgTitle"></h3><p class="monthly-msg-subtitle"></p></div><button class="monthly-msg-close" type="button" aria-label="关闭">×</button></div>
            <div class="monthly-msg-progress" role="status"></div><div class="monthly-msg-log" role="log" aria-live="polite"></div>
            <div class="monthly-msg-foot"><button class="monthly-msg-copy" type="button"></button><button class="monthly-msg-done" type="button" disabled></button></div></div>`;
        document.body.appendChild(overlay);
        const english = lang() === 'en';
        overlay.querySelector('#monthlyMsgTitle').textContent = english ? 'Monthly MSG export' : '月报 MSG 导出';
        overlay.querySelector('.monthly-msg-subtitle').textContent = english ? 'Preparation, server response and file validation' : '完整记录准备、服务端响应与文件校验过程';
        overlay.querySelector('.monthly-msg-copy').textContent = english ? 'Copy log' : '复制日志';
        overlay.querySelector('.monthly-msg-done').textContent = english ? 'Done' : '完成';
        overlay.querySelector('.monthly-msg-close').setAttribute('aria-label', english ? 'Close log' : '关闭日志');
        const lines = [];
        const log = (level, message) => {
            const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
            lines.push(entry);
            const row = document.createElement('div');
            row.className = 'monthly-msg-log-line';
            row.dataset.level = level;
            row.textContent = entry;
            const list = overlay.querySelector('.monthly-msg-log');
            list.appendChild(row);
            list.scrollTop = list.scrollHeight;
            if (level === 'step' || level === 'success' || level === 'error') overlay.querySelector('.monthly-msg-progress').textContent = message;
        };
        overlay.querySelector('.monthly-msg-close').addEventListener('click', () => overlay.remove());
        overlay.querySelector('.monthly-msg-done').addEventListener('click', () => overlay.remove());
        overlay.querySelector('.monthly-msg-copy').addEventListener('click', () => {
            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(lines.join('\n')).catch(error => log('error', error.message));
            else log('error', english ? 'Clipboard access is unavailable.' : '当前环境无法访问剪贴板。');
        });
        return { log, finish:(message, error = false) => { log(error ? 'error' : 'success', message); overlay.querySelector('.monthly-msg-done').disabled = false; } };
    }

    const formatByteCount = bytes => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${(bytes / 1_000).toFixed(1)} KB`;
    const msgText = (zh, en) => lang() === 'en' ? en : zh;

    async function buildWorkbook() {
        const workbook = new ExcelJS.Workbook();
        const sheet = await buildExportSheet(['zh','en']);
        try {
            sheet.querySelectorAll('.monthly-export-part').forEach((part, index) => {
                const ws = workbook.addWorksheet(index === 0 ? '中文月报' : 'English Report');
                ws.addRow([part.querySelector('h2')?.textContent || 'Monthly Report']);
                ws.addRow([part.querySelector('p')?.textContent || '']);
                part.querySelectorAll('#summary-content p, #summary-content li, .section-title, h4').forEach(el => {
                    const row = ws.addRow([excelDisplayValue(el)]);
                    if (el.classList.contains('is-imminent')) {
                        row.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFDF6F1' } };
                        row.getCell(1).font = { color:{ argb:'FF8F3D20' }, bold:true };
                    }
                });
                part.querySelectorAll('table').forEach(table => {
                    ws.addRow([]);
                    table.querySelectorAll('tr').forEach(row => ws.addRow([...row.querySelectorAll('th,td')].map(excelDisplayValue)));
                });
                part.querySelectorAll('.chart-container img').forEach((chart, chartIndex) => {
                    if (!/^data:image\/jpeg;base64,/.test(chart.src)) return;
                    ws.addRow([]);
                    ws.addRow([chart.alt || `Chart ${chartIndex + 1}`]);
                    const imageId = workbook.addImage({ base64:chart.src, extension:'jpeg' });
                    ws.addImage(imageId, { tl:{ col:0, row:ws.rowCount }, ext:{ width:900, height:300 } });
                    for (let row = 0; row < 18; row++) ws.addRow([]);
                });
                ws.columns.forEach(col => { col.width = 25; });
            });
            const raw = workbook.addWorksheet('Source Data');
            raw.addRow(['Date','Compliance Rate','Passed Metrics','Total Metrics']);
            bridge().getState().trends.forEach(row => raw.addRow([row.date,row.compliance_rate,row.passed_metrics,row.total_metrics]));
            raw.addRow([]);
            const appendJson = (name, value) => {
                const json = JSON.stringify(value ?? null);
                for (let index = 0; index < json.length; index += 30000) raw.addRow([name, Math.floor(index / 30000) + 1, json.slice(index, index + 30000)]);
            };
            appendJson('Latest snapshot JSON', bridge().getState().latest);
            bridge().getState().trends.forEach((row, index) => appendJson(`Trend ${index + 1} JSON`, row));
            return workbook;
        } finally { sheet.remove(); }
    }

    async function exportMsg(sheet, progress) {
        progress.log('step', msgText('1/6 正在转换中英文月报及表格样式…', '1/6 Formatting the bilingual report and tables…'));
        const currentTheme = document.documentElement.getAttribute('data-theme');
        let email;
        try {
            if (currentTheme === 'dark') document.documentElement.setAttribute('data-theme', 'light');
            email = window.ReportMsgExport.copyForEmail(sheet);
        } finally {
            if (currentTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        }
        if (!email) throw new Error('Unable to prepare report email');
        progress.log('info', msgText(`已整理 ${email.querySelectorAll('table').length} 个表格。`, `Formatted ${email.querySelectorAll('table').length} tables.`));
        progress.log('step', msgText('2/6 正在嵌入图表…', '2/6 Embedding charts…'));
        const originalCharts = sheet.querySelectorAll('.chart-container img');
        const emailCharts = email.querySelectorAll('#chart-overall, #chart-groups');
        originalCharts.forEach((source, index) => {
            const target = emailCharts[index];
            if (!target || !/^data:image\/(?:png|jpeg);base64,/.test(source.src)) return;
            const image = document.createElement('img');
            image.src = source.src;
            image.alt = source.alt || 'Chart';
            image.width = 900;
            image.style.cssText = 'display:block;width:100%;max-width:900px;height:auto;';
            target.appendChild(image);
        });
        progress.log('info', msgText(`已嵌入 ${email.querySelectorAll('#chart-overall img, #chart-groups img').length} 张图表。`, `Embedded ${email.querySelectorAll('#chart-overall img, #chart-groups img').length} charts.`));
        progress.log('step', msgText('3/6 正在生成 Excel 原始数据附件…', '3/6 Building the Excel source-data attachment…'));
        const workbook = await buildWorkbook();
        const bytes = await workbook.xlsx.writeBuffer();
        const encoded = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(new Blob([bytes]));
        });
        progress.log('info', msgText(`Excel 附件大小：${formatByteCount(bytes.byteLength || bytes.length)}。`, `Excel attachment: ${formatByteCount(bytes.byteLength || bytes.length)}.`));
        progress.log('step', msgText('4/6 正在封装邮件正文与请求…', '4/6 Packaging the email body and request…'));
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeText(filenameBase())}</title></head><body>${email.outerHTML}</body></html>`;
        const payload = JSON.stringify({ subject:filenameBase(), html, text:email.textContent || '', attachment:{ filename:`${filenameBase()}.xlsx`, data:encoded } });
        progress.log('info', msgText(`HTML 正文：${formatByteCount(new TextEncoder().encode(html).length)}；附件编码：${formatByteCount(encoded.length)}；请求总量：${formatByteCount(new TextEncoder().encode(payload).length)}。`, `HTML body: ${formatByteCount(new TextEncoder().encode(html).length)}; encoded attachment: ${formatByteCount(encoded.length)}; request: ${formatByteCount(new TextEncoder().encode(payload).length)}.`));
        progress.log('step', msgText('5/6 正在请求服务端生成 MSG…', '5/6 Asking the server to generate the MSG…'));
        const response = await fetch('/api/report-msg/export', { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json' }, body:payload });
        progress.log('info', msgText(`服务端响应：HTTP ${response.status}。`, `Server response: HTTP ${response.status}.`));
        if (!response.ok) {
            const errorBody = await response.json().catch(() => null);
            const detail = errorBody?.message || errorBody?.error;
            if (errorBody?.error) progress.log('error', msgText(`错误代码：${errorBody.error}${errorBody.htmlBytes ? `；HTML：${formatByteCount(errorBody.htmlBytes)}` : ''}${errorBody.requestDataBytes ? `；合计：${formatByteCount(errorBody.requestDataBytes)}` : ''}。`, `Error code: ${errorBody.error}${errorBody.htmlBytes ? `; HTML: ${formatByteCount(errorBody.htmlBytes)}` : ''}${errorBody.requestDataBytes ? `; total: ${formatByteCount(errorBody.requestDataBytes)}` : ''}.`));
            throw new Error(`${lang() === 'en' ? 'MSG export failed' : 'MSG 导出失败'} (HTTP ${response.status})${detail ? `：${detail}` : ''}`);
        }
        progress.log('step', msgText('6/6 正在校验并下载 MSG 文件…', '6/6 Validating and downloading the MSG…'));
        const blob = await response.blob();
        const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        if (signature[0] !== 0xd0 || signature[1] !== 0xcf || signature[2] !== 0x11 || signature[3] !== 0xe0) throw new Error('服务端未返回有效的 MSG 文件');
        progress.log('info', msgText(`已校验 Outlook 文件签名；MSG 文件大小：${formatByteCount(blob.size)}。`, `Outlook file signature verified; MSG size: ${formatByteCount(blob.size)}.`));
        download(blob, `${filenameBase()}.msg`);
    }

    async function exportMsgWithProgress() {
        const progress = openMsgProgress();
        let sheet;
        try {
            progress.log('step', msgText('正在准备完整中英文报告…', 'Preparing the complete bilingual report…'));
            sheet = await buildExportSheet(['zh','en']);
            await exportMsg(sheet, progress);
            progress.finish(lang() === 'en' ? 'MSG exported successfully.' : 'MSG 导出完成，可在下载目录查看。');
        } catch (error) {
            progress.finish(error.message, true);
            throw error;
        } finally { sheet?.remove(); }
    }

    async function exportFormat(format) {
        if (format === 'excel') { download(new Blob([await (await buildWorkbook()).xlsx.writeBuffer()]), `${filenameBase()}.xlsx`); return; }
        const sheet = await buildExportSheet(['zh','en']);
        try {
            if (format === 'pdf') {
                const canvas = await html2canvas(sheet, { scale:1.4, backgroundColor:'#fff', useCORS:true, windowWidth:1200 });
                const pdf = new window.jspdf.jsPDF({ orientation:'p', unit:'pt', format:'a4' });
                const pageWidth = 595.28;
                const pageHeight = 841.89;
                const imageHeight = canvas.height * pageWidth / canvas.width;
                const image = canvas.toDataURL('image/jpeg',0.92);
                for (let page = 0; page < Math.ceil(imageHeight / pageHeight); page++) {
                    if (page) pdf.addPage();
                    pdf.addImage(image,'JPEG',0,-page * pageHeight,pageWidth,imageHeight);
                }
                pdf.save(`${filenameBase()}.pdf`);
            } else if (format === 'html') {
                const css = [...document.querySelectorAll('head style')].map(el => el.textContent).join('\n');
                const cleanSheet = sheet.cloneNode(true);
                cleanSheet.removeAttribute('style');
                const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeText(filenameBase())}</title><style>body{margin:0;background:#f0f2f5}.monthly-export-sheet{max-width:1100px;margin:20px auto;background:#fff;padding:28px;box-sizing:border-box}.monthly-export-part{margin-bottom:36px}.chart-container img{width:100%;height:auto}${css}</style></head><body>${cleanSheet.outerHTML}</body></html>`;
                download(new Blob([html],{ type:'text/html;charset=utf-8' }),`${filenameBase()}.html`);
            }
        } finally { sheet.remove(); }
    }

    async function handleAction(action) {
        if (action === 'bold' || action === 'color') return;
        if (action === 'reset-month' || action === 'reset-fixed') {
            for (const language of ['zh','en']) localStorage.removeItem(action === 'reset-month' ? reportKey(language) : fixedKey(language));
            bridge().render();
            return;
        }
        if (action === 'toggle-time') {
            state.sourceTimeHidden = !state.sourceTimeHidden;
            writeJson(settingsKey(), { warningDays:state.warningDays, mappings:state.mappings, sourceTimeHidden:state.sourceTimeHidden });
            applyTimeVisibility(); setLabels(); return;
        }
        if (action === 'config') return showConfig();
        if (action === 'export-project') return exportProject();
        if (action === 'import-project') return document.getElementById('monthlyProjectInput').click();
        if (action === 'save-snapshot') return saveSnapshot();
        if (action === 'snapshots') return openSnapshots();
        if (action === 'diff') return openDiff();
        if (action === 'png-menu') { const menu = document.getElementById('monthlyPngMenu'); menu.hidden = !menu.hidden; return; }
        if (action === 'msg') return exportMsgWithProgress();
        return exportFormat(action);
    }

    loadSettings();
    setLabels();
    actionRoot.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action) Promise.resolve(handleAction(action)).catch(error => { console.error(error); notify(error.message); });
        const scope = event.target.closest('[data-png]')?.dataset.png;
        if (scope) {
            document.getElementById('monthlyPngMenu').hidden = true;
            const run = async () => {
                if (scope === 'all') { for (const [langs, suffix] of [[['zh'],'zh'],[['en'],'en'],[['zh','en'],'bilingual']]) await exportPng(langs,suffix); }
                else await exportPng(scope === 'both' ? ['zh','en'] : [scope], scope === 'both' ? 'bilingual' : scope);
            };
            run().catch(error => { console.error(error); notify(error.message); });
        }
    });
    document.getElementById('report-content').addEventListener('focusin', event => { state.activeEdit = event.target.closest('[data-monthly-edit-key]'); });
    document.getElementById('report-content').addEventListener('input', event => saveEdit(event.target.closest('[data-monthly-edit-key]')));
    document.getElementById('report-content').addEventListener('blur', event => {
        const el = event.target.closest('[data-monthly-edit-key]');
        if (el) {
            if (!selectionToolbar.contains(event.relatedTarget)) el.innerHTML = cleanHtml(el.innerHTML);
            saveEdit(el);
        }
    }, true);
    actionRoot.querySelector('[data-action="bold"]').addEventListener('mousedown', event => event.preventDefault());
    actionRoot.querySelector('[data-action="bold"]').addEventListener('click', () => { document.execCommand('bold'); if (state.activeEdit) saveEdit(state.activeEdit); });
    document.getElementById('monthlyTextColor').addEventListener('input', event => {
        if (state.selectedRange) formatSelection('foreColor', event.target.value);
        else { state.activeEdit?.focus(); document.execCommand('foreColor', false, event.target.value); if (state.activeEdit) saveEdit(state.activeEdit); }
    });
    document.addEventListener('selectionchange', () => requestAnimationFrame(updateSelectionToolbar));
    window.addEventListener('scroll', () => { if (!selectionToolbar.hidden) updateSelectionToolbar(); }, true);
    window.addEventListener('resize', () => { if (!selectionToolbar.hidden) updateSelectionToolbar(); });
    selectionToolbar.addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
    selectionToolbar.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.format) formatSelection(button.dataset.format);
        else if (button.dataset.color) formatSelection('foreColor', button.dataset.color);
    });
    document.getElementById('monthlySelectionColor').addEventListener('input', event => formatSelection('foreColor', event.target.value));
    document.getElementById('monthlyConfigCancel').addEventListener('click', () => dialog.close());
    document.getElementById('monthlyConfigClose').addEventListener('click', () => dialog.close());
    document.getElementById('monthlyConfigSave').addEventListener('click', () => { try { saveConfig(); } catch (error) { notify(error.message); } });
    document.getElementById('monthlyProjectInput').addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try { applyProject(JSON.parse(await file.text())); } catch (error) { notify(error.message); }
        event.target.value = '';
    });
    window.addEventListener('tools:languagechange', setLabels);
    window.MonthlyWorkspace = { afterRender, getWarningDays:() => state.warningDays, getNetworkMappings:() => ({ ...(window._monthlyNetworkMappings || {}), ...state.mappings }), collectProject, applyProject };
})();
