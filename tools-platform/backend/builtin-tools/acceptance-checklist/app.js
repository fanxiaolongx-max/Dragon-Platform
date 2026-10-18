'use strict';
(() => {
    const words = {
        title: ['在线验收表', 'Acceptance Checklist'], subtitle: ['交付有记录，验收有依据。', 'Record deliveries. Review with evidence.'],
        export: ['导出 Excel（含图片）', 'Export Excel with images'], project: ['项目名称', 'Project'], month: ['验收月份', 'Acceptance month'],
        reviewer: ['验收人', 'Reviewer'], procurement: ['采购项目', 'Procurement item'], unit: ['单位', 'Unit'], items: ['交付物验收', 'Deliverable review'],
        add: ['＋ 添加项目', '＋ Add item'], deliverable: ['交付物 / 验收内容', 'Deliverable / Acceptance criteria'], weight: ['权重 %', 'Weight %'],
        baseline: ['基准数量', 'Baseline'], actual: ['实际数量', 'Actual output'], result: ['验收结果', 'Acceptance result'],
        evidence: ['图片证明', 'Image evidence'], remarks: ['备注 / 整改说明', 'Notes / Corrective action'], actions: ['操作', 'Actions'],
        privacy: ['填报和图片仅保存在当前浏览器，不上传服务器。清理浏览器数据会丢失记录，请定期备份。', 'Entries and images stay in this browser. Clearing browser data removes them. Back up regularly.'],
        imageHint: ['每项最多 6 张图片 · 自动压缩 · 点击缩略图查看', 'Up to 6 images per item · Compressed locally · Click to preview'],
        rules: ['原表扣罚规则（参考）', 'Original penalty rules (reference)'],
        rulesHint: ['保留图片中的条款供核对，不自动计算扣罚或验收得分。', 'Reference terms from the supplied image. No automatic penalties or acceptance score.'],
        layoutHint: ['已精简原表：BOQ、采购项目和单位移至表头；移除重复小计和总验收比例列。', 'Simplified: BOQ, procurement item and unit moved to the header; duplicate subtotal and acceptance percentage removed.'],
        backup: ['备份数据（含图片）', 'Back up with images'], restore: ['恢复备份', 'Restore backup'], upload: ['＋ 添加图片', '＋ Add images'],
        pending: ['待验收', 'Pending'], pass: ['通过', 'Passed'], conditional: ['有条件通过', 'Conditional pass'], fail: ['不通过', 'Failed'], na: ['不适用', 'Not applicable'],
        saved: ['已保存到浏览器', 'Saved in browser'], saving: ['正在保存…', 'Saving…'], unsaved: ['保存失败，请立即备份', 'Save failed. Back up now.'],
        storageError: ['无法读取本地存储，本次修改不会自动保存。可先备份数据，或在普通浏览器窗口打开。', 'Local storage is unavailable. Changes will not be saved automatically. Back up data or open in a regular browser window.'],
        remove: ['删除项目', 'Delete item'], removeImage: ['删除图片', 'Remove image'], confirmRemove: ['删除此验收项目及其图片？', 'Delete this item and its images?'],
        confirmRestore: ['恢复将替换当前表格及图片，建议先备份。确定继续？', 'Restore replaces the current checklist and images. Back up first. Continue?'],
        invalidBackup: ['备份格式无效或超出限制，当前数据未修改。', 'Invalid or oversized backup. Current data was not changed.'],
        restored: ['备份已恢复。', 'Backup restored.'], backedUp: ['备份已下载，包含全部填报和图片。', 'Backup downloaded with all entries and images.'],
        imageError: ['图片需为可读取的 PNG、JPEG 或 WebP，单张不超过 10 MB，每项最多 6 张。', 'Use readable PNG, JPEG or WebP images, up to 10 MB each and 6 images per item.'],
        exported: ['Excel 已导出，图片已嵌入工作表。', 'Excel exported with embedded images.'], exportError: ['导出失败，请检查数量、图片或可用内存后重试。', 'Export failed. Check quantities, images and available memory.'],
        limit: ['最多支持 100 个验收项目。', 'Up to 100 acceptance items.'], totals: ['权重合计', 'Total weight'], weightWarning: ['（应为 100%，请核对）', '(expected 100%; please check)'],
        count: ['项', 'items'], reviewed: ['已验收', 'Reviewed'], images: ['张图片', 'images'], preview: ['查看图片', 'Preview image'], working: ['处理中…', 'Working…']
    };
    const penalties = [
        ['排名第 4 或以下：扣罚 500 USD。', 'Ranking 4 or below: deduction of USD 500.'],
        ['数据不正确：每个 KPI 扣罚 200 USD。', 'Incorrect data: deduction of USD 200 per KPI.'],
        ['违反 L1 / L2 流程：每次扣罚 1,000 USD。', 'L1 / L2 process violation: deduction of USD 1,000 per case.'],
        ['网络重大问题或客户投诉涉及以下情形，每次扣罚 1,000 USD：关闭风险工单不合格；整改确认及实施逾期；未按时完成整改；错误确认整改范围、遗漏相关方。', 'Network major issue or customer complaint due to: unqualified close risk ticket; overdue rectification confirmation / implementation; failure to complete rectification on time; wrongly confirmed rectification scope with parties omitted. Deduction of USD 1,000 per case.']
    ];
    const statuses = ['pending', 'pass', 'conditional', 'fail', 'na'];
    const $ = selector => document.querySelector(selector);
    let lang = 'zh', db, state, timer, revision = 0, savedRevision = 0, saveChain = Promise.resolve(), busy = false;
    const t = key => words[key][lang === 'en' ? 1 : 0];
    const uid = () => globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newRow = (name = '', weight = 0) => ({ id: uid(), name, weight, baseline: 1, actual: '', result: 'pending', notes: '', images: [] });
    function defaults() {
        const now = new Date();
        return { version: 1, meta: { project: 'Egypt Customer Support', month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, reviewer: '', boq: 'CS - CNBG O&M - 1', procurement: 'Customer Support Service On-site Support Premium Package - Per Service Package', unit: 'PCS' }, rows: [
            newRow('Egypt Maintenance Operation Month Report', 40), newRow('Egypt SPM Horse Racing Monthly Report', 15),
            newRow('Egypt Network Safety Monthly Meeting MOM', 15), newRow('Egypt CS PR report', 30)
        ] };
    }
    function message(key, error = false) { $('#message').textContent = t(key); $('#message').classList.toggle('error', error); }
    function saveStatus(key) { $('#save-status').textContent = t(key); $('#save-status').classList.toggle('invalid', key === 'unsaved'); }
    function changed() {
        revision++;
        saveStatus('saving');
        clearTimeout(timer);
        timer = setTimeout(persist, 250);
        summary();
    }
    function writeState(snapshot) {
        return new Promise((resolve, reject) => {
            if (!db) return reject(new Error('Storage unavailable'));
            const tx = db.transaction('sheets', 'readwrite');
            tx.objectStore('sheets').put(snapshot, 'current');
            tx.oncomplete = resolve;
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Storage write failed'));
        });
    }
    function persist() {
        clearTimeout(timer);
        const snapshot = structuredClone(state), version = revision;
        saveChain = saveChain.catch(() => {}).then(() => writeState(snapshot)).then(() => {
            savedRevision = version;
            if (version === revision) saveStatus('saved');
        }).catch(() => { saveStatus('unsaved'); message('unsaved', true); });
        return saveChain;
    }
    function openStorage() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('tools-acceptance-checklist-v1', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('sheets');
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('Storage blocked'));
            request.onsuccess = () => {
                db = request.result;
                const tx = db.transaction('sheets', 'readonly');
                const read = tx.objectStore('sheets').get('current');
                read.onsuccess = () => resolve(read.result);
                read.onerror = () => reject(read.error);
            };
        });
    }
    function element(tag, props = {}, text) {
        const node = document.createElement(tag);
        Object.assign(node, props);
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function summary() {
        const total = state.rows.reduce((n, row) => n + Number(row.weight || 0), 0);
        $('#summary').textContent = `${state.rows.length} ${t('count')} · ${t('reviewed')} ${state.rows.filter(r => r.result !== 'pending').length}/${state.rows.length} · ${t('pass')} ${state.rows.filter(r => r.result === 'pass').length} · ${state.rows.reduce((n, r) => n + r.images.length, 0)} ${t('images')}`;
        $('#weight-total').textContent = `${t('totals')} ${Number(total.toFixed(2))}% ${Math.abs(total - 100) > .001 ? t('weightWarning') : ''}`;
        $('#weight-total').classList.toggle('invalid', Math.abs(total - 100) > .001);
    }
    function renderImages(cell, row) {
        cell.replaceChildren();
        const images = element('div', { className: 'images' });
        row.images.forEach((image, i) => {
            const wrap = element('div', { className: 'image-wrap' });
            const preview = element('button', { className: 'thumbnail', title: `${t('preview')}: ${image.name}` });
            preview.append(element('img', { src: image.data, alt: image.name }));
            preview.onclick = () => { $('#preview-image').src = image.data; $('#preview-name').textContent = image.name; $('#preview').showModal(); };
            const remove = element('button', { className: 'image-remove', title: t('removeImage') }, '×');
            remove.setAttribute('aria-label', `${t('removeImage')} ${i + 1}`);
            remove.onclick = () => { row.images.splice(i, 1); renderImages(cell, row); changed(); };
            wrap.append(preview, remove); images.append(wrap);
        });
        const label = element('label', { className: 'upload' }, t('upload'));
        const input = element('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, disabled: row.images.length >= 6 });
        input.setAttribute('aria-label', t('upload'));
        input.onchange = async () => {
            const files = [...input.files];
            if (!files.length) return;
            if (files.length + row.images.length > 6) { message('imageError', true); input.value = ''; return; }
            input.disabled = true;
            try {
                const converted = await Promise.all(files.map(compressImage));
                if (!state.rows.includes(row)) return;
                row.images.push(...converted); changed(); renderImages(cell, row);
            } catch (_) { message('imageError', true); input.disabled = false; input.value = ''; }
        };
        label.append(input); cell.append(images, label);
    }
    function renderRows() {
        $('#rows').replaceChildren();
        state.rows.forEach((row, index) => {
            const tr = element('tr');
            tr.append(element('td', {}, index + 1));
            ['name', 'weight', 'baseline', 'actual', 'result', 'images', 'notes'].forEach(field => {
                const td = element('td');
                if (field === 'images') renderImages(td, row);
                else {
                    let input;
                    if (field === 'result') {
                        input = element('select');
                        statuses.forEach(value => input.append(element('option', { value }, t(value))));
                        input.value = row.result; input.dataset.value = row.result;
                    } else if (field === 'name' || field === 'notes') input = element('textarea', { value: row[field], maxLength: field === 'name' ? 500 : 2000 });
                    else input = element('input', { type: 'number', min: '0', max: field === 'weight' ? '100' : '1000000000', step: 'any', value: row[field] });
                    input.dataset.field = field;
                    const labels = { name: 'deliverable', weight: 'weight', baseline: 'baseline', actual: 'actual', result: 'result', notes: 'remarks' };
                    input.setAttribute('aria-label', `${index + 1} ${t(labels[field])}`);
                    input.addEventListener(field === 'result' ? 'change' : 'input', () => {
                        if (!input.checkValidity()) { input.reportValidity(); return; }
                        row[field] = ['weight', 'baseline', 'actual'].includes(field) && input.value !== '' ? Number(input.value) : input.value;
                        if (field === 'result') input.dataset.value = row.result;
                        changed();
                    });
                    td.append(input);
                }
                tr.append(td);
            });
            const td = element('td'), remove = element('button', { className: 'delete', title: t('remove') }, '×');
            remove.setAttribute('aria-label', `${t('remove')} ${index + 1}`);
            remove.onclick = () => { if (confirm(t('confirmRemove'))) { state.rows.splice(index, 1); renderRows(); changed(); } };
            td.append(remove); tr.append(td); $('#rows').append(tr);
        });
        summary();
    }
    function render() {
        document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
        document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
        $('#language-toggle').textContent = lang === 'en' ? '中文' : 'English';
        $('#rules-list').replaceChildren(...penalties.map(rule => element('li', {}, rule[lang === 'en' ? 1 : 0])));
        document.querySelectorAll('[data-meta]').forEach(input => { input.value = state.meta[input.dataset.meta]; });
        renderRows();
        saveStatus(db ? (savedRevision === revision ? 'saved' : 'saving') : 'unsaved');
    }
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) return reject(new Error('Invalid image'));
            const url = URL.createObjectURL(file), image = new Image();
            image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot decode image')); };
            image.onload = () => {
                try {
                    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                    resolve({ name: file.name.slice(0, 200), data: canvas.toDataURL('image/jpeg', .86), width: canvas.width, height: canvas.height });
                } catch (error) { reject(error); } finally { URL.revokeObjectURL(url); }
            };
            image.src = url;
        });
    }
    function download(blob, name) {
        const url = URL.createObjectURL(blob), a = element('a', { href: url, download: name });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    function filename(extension) { return `Acceptance_${state.meta.month || 'undated'}_${(state.meta.project || 'Checklist').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 60)}.${extension}`; }
    function validate(data) {
        if (data?.version !== 1 || !data.meta || !Array.isArray(data.rows) || data.rows.length > 100) throw new Error('Invalid backup');
        const clean = { version: 1, meta: {}, rows: [] };
        for (const key of Object.keys(defaults().meta)) {
            if (typeof data.meta[key] !== 'string' || data.meta[key].length > 300) throw new Error('Invalid metadata');
            clean.meta[key] = data.meta[key];
        }
        if (clean.meta.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(clean.meta.month)) throw new Error('Invalid month');
        for (const row of data.rows) {
            if (!row || typeof row.name !== 'string' || row.name.length > 500 || typeof row.notes !== 'string' || row.notes.length > 2000 || !statuses.includes(row.result) || !Array.isArray(row.images) || row.images.length > 6) throw new Error('Invalid row');
            for (const key of ['weight', 'baseline', 'actual']) if (row[key] !== '' && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0 || row[key] > (key === 'weight' ? 100 : 1e9))) throw new Error('Invalid number');
            const images = row.images.map(img => {
                if (!img || typeof img.name !== 'string' || img.name.length > 200 || typeof img.data !== 'string' || img.data.length > 15e6 || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(img.data) || !Number.isFinite(img.width) || !Number.isFinite(img.height) || img.width <= 0 || img.height <= 0 || img.width > 1600 || img.height > 1600) throw new Error('Invalid image');
                return { name: img.name, data: img.data, width: img.width, height: img.height };
            });
            clean.rows.push({ id: uid(), name: row.name, weight: row.weight, baseline: row.baseline, actual: row.actual, result: row.result, notes: row.notes, images });
        }
        return clean;
    }
    async function exportExcel() {
        if (busy) return;
        // Invalid numeric text must never silently export a previous value.
        const invalid = [...document.querySelectorAll('input')].find(input => !input.checkValidity());
        if (invalid) { invalid.reportValidity(); invalid.focus(); return; }
        busy = true; $('#export').disabled = true; $('#export').textContent = t('working');
        const snapshot = structuredClone(state);
        try {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Acceptance Checklist';
            const sheet = workbook.addWorksheet(lang === 'en' ? 'Acceptance' : '验收表', { views: [{ state: 'frozen', ySplit: 8 }] });
            sheet.columns = [5, 46, 12, 13, 13, 23, 38, 40].map(width => ({ width }));
            sheet.mergeCells('A1:H1'); sheet.getCell('A1').value = t('title'); sheet.getRow(1).height = 32;
            sheet.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FF176C62' } };
            sheet.mergeCells('A2:H2'); sheet.getCell('A2').value = `${t('project')}: ${snapshot.meta.project}`;
            sheet.mergeCells('A3:H3'); sheet.getCell('A3').value = `${t('month')}: ${snapshot.meta.month}    ${t('reviewer')}: ${snapshot.meta.reviewer}`;
            sheet.mergeCells('A4:H4'); sheet.getCell('A4').value = `BOQ: ${snapshot.meta.boq}    ${t('unit')}: ${snapshot.meta.unit}`;
            sheet.mergeCells('A5:H5'); sheet.getCell('A5').value = `${t('procurement')}: ${snapshot.meta.procurement}`; sheet.getRow(5).height = 32;
            sheet.mergeCells('A6:H6'); sheet.getCell('A6').value = t('rulesHint');
            const headers = ['#', t('deliverable'), t('weight'), t('baseline'), t('actual'), t('result'), t('evidence'), t('remarks')];
            const head = sheet.getRow(8); head.values = headers; head.height = 26;
            head.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176C62' } }; cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }; });
            snapshot.rows.forEach((item, index) => {
                const rowNo = index + 9, row = sheet.getRow(rowNo);
                row.values = [index + 1, item.name, item.weight, item.baseline, item.actual, t(item.result), '', item.notes];
                row.height = Math.max(64, Math.ceil(item.images.length / 2) * 108);
                row.getCell(6).dataValidation = { type: 'list', allowBlank: false, formulae: [`"${statuses.map(t).join(',')}"`], showErrorMessage: true, errorTitle: t('result'), error: statuses.map(t).join(' / ') };
                item.images.forEach((img, i) => {
                    const id = workbook.addImage({ base64: img.data, extension: img.data.startsWith('data:image/png') ? 'png' : 'jpeg' });
                    const ratio = Math.min(115 / img.width, 126 / img.height);
                    sheet.addImage(id, { tl: { nativeCol: 6, nativeColOff: (8 + (i % 2) * 125) * 9525, nativeRow: rowNo - 1, nativeRowOff: (8 + Math.floor(i / 2) * 144) * 9525 }, ext: { width: Math.round(img.width * ratio), height: Math.round(img.height * ratio) }, editAs: 'oneCell' });
                });
            });
            sheet.eachRow(row => row.eachCell({ includeEmpty: true }, cell => { cell.alignment = { vertical: 'top', wrapText: true }; }));
            if (snapshot.rows.length) sheet.autoFilter = { from: 'A8', to: `H${snapshot.rows.length + 8}` };
            sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
            const reference = workbook.addWorksheet(lang === 'en' ? 'Penalty reference' : '扣罚规则参考');
            reference.columns = [{ width: 120 }]; reference.addRow([t('rulesHint')]);
            penalties.forEach(rule => { const row = reference.addRow([rule[lang === 'en' ? 1 : 0]]); row.alignment = { wrapText: true }; row.height = 55; });
            const buffer = await workbook.xlsx.writeBuffer();
            download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename('xlsx'));
            message('exported');
        } catch (_) { message('exportError', true); }
        finally { busy = false; $('#export').disabled = false; $('#export').textContent = t('export'); }
    }
    $('#language-toggle').onclick = () => { lang = lang === 'en' ? 'zh' : 'en'; render(); };
    $('#add').onclick = () => { if (state.rows.length >= 100) return message('limit', true); state.rows.push(newRow()); renderRows(); changed(); };
    $('#export').onclick = exportExcel;
    $('#backup').onclick = () => { download(new Blob([JSON.stringify(state)], { type: 'application/json' }), filename('json')); message('backedUp'); };
    $('#restore').onclick = () => $('#restore-file').click();
    $('#restore-file').onchange = async event => {
        const file = event.target.files[0]; event.target.value = '';
        if (!file) return;
        try {
            if (file.size > 80 * 1024 * 1024) throw new Error('Oversized backup');
            const restored = validate(JSON.parse(await file.text()));
            // Decode every image before replacing live data, so damaged backups cannot poison exports.
            await Promise.all(restored.rows.flatMap(row => row.images.map(img => new Promise((resolve, reject) => {
                const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = img.data;
            }))));
            if (!confirm(t('confirmRestore'))) return;
            state = restored; changed(); render(); await persist(); message(savedRevision === revision ? 'restored' : 'unsaved', savedRevision !== revision);
        } catch (_) { message('invalidBackup', true); }
    };
    document.querySelectorAll('[data-meta]').forEach(input => input.addEventListener('input', () => {
        if (input.checkValidity()) { state.meta[input.dataset.meta] = input.value; changed(); }
    }));
    window.addEventListener('beforeunload', event => {
        if (revision !== savedRevision) { persist(); event.preventDefault(); event.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && revision !== savedRevision) persist(); });
    state = defaults();
    // Disable editing until IndexedDB is loaded; initialization must not overwrite early input.
    $('main').inert = true;
    openStorage().then(saved => {
        if (saved) state = validate(saved);
        render();
    }).catch(() => { render(); message('storageError', true); saveStatus('unsaved'); }).finally(() => { $('main').inert = false; });
})();
