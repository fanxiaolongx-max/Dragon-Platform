(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    let english = localStorage.getItem('tools_lang')?.startsWith('en') || false;
    const t = (zh, en) => english ? en : zh;
    let categories = [], result = { items: [], total: 0, page: 1, pages: 1 }, view = 'all', category = '', page = 1;
    let canWrite = false, selected = [], current = null, uploading = false, listRequest = 0, detailRequest = 0, categoryTarget = '', aiBusy = false;
    let toastTimer, searchTimer, dragDepth = 0;
    const byteSize = bytes => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    const date = value => new Date(value).toLocaleDateString(english ? 'en-GB' : 'zh-CN');
    const guarded = fn => async event => { try { await fn(event); } catch (error) { toast(error.message); } };
    function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
    async function api(path, method = 'GET', body) {
        path = '/api/gallery' + path;
        if (method === 'GET') return API.get(path);
        const headers = getAuthHeaders();
        if (body instanceof FormData) delete headers['Content-Type'];
        const response = await fetch(path, { method, headers, body: body instanceof FormData ? body : JSON.stringify(body) });
        return handleResponse(response, { method, path });
    }
    function permissions() {
        document.querySelectorAll('[data-write]').forEach(el => {
            el.hidden = !canWrite || (el.id === 'applyAi' && activeVersion()?.ai_status !== 'ready') || (el.id === 'emptyUpload' && !!(category || view !== 'all' || $('search').value));
        });
        $('metaForm').querySelectorAll('input,select,textarea').forEach(el => { el.disabled = !canWrite; });
    }
    function categoryName(id) { const c = categories.find(c => c.id === id); return c ? (english ? ({ posters: 'Work posters', menus: 'Restaurant menus', inspiration: 'Inspiration' })[c.id] || c.name : c.name) : t('未分类', 'Uncategorized'); }
    function translate() {
        document.documentElement.lang = english ? 'en' : 'zh-CN';
        document.title = english ? 'Picture Island' : '图屿 · Picture Island';
        document.querySelectorAll('[data-en]').forEach(el => { if (!el.dataset.zh) el.dataset.zh = el.textContent; el.textContent = english ? el.dataset.en : el.dataset.zh; });
        document.querySelectorAll('[data-placeholder-en]').forEach(el => { if (!el.dataset.placeholderZh) el.dataset.placeholderZh = el.placeholder; el.placeholder = english ? el.dataset.placeholderEn : el.dataset.placeholderZh; });
        $('language').textContent = english ? '中' : 'EN';
        $('theme').title = $('theme').ariaLabel = t('切换明暗主题', 'Toggle light / dark theme');
        $('addCategory').title = $('addCategory').ariaLabel = t('新增分类', 'Create category');
        renderCategories(); renderList();
        if (current) { renderVersionOptions(); renderPicture(); }
    }
    function applyTheme() {
        const stored = localStorage.getItem('picture_island_theme');
        document.documentElement.dataset.theme = stored || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    }
    function categoryOptions(value) { return `<option value="">${t('未分类', 'Uncategorized')}</option>` + categories.map(c => `<option value="${escape(c.id)}" ${value === c.id ? 'selected' : ''}>${escape(categoryName(c.id))}</option>`).join(''); }
    function renderCategories() {
        $('categoryNav').innerHTML = `<button data-category="uncategorized" class="${category === 'uncategorized' ? 'active' : ''}">${t('未分类', 'Uncategorized')}</button>` + categories.map(c => `<button data-category="${escape(c.id)}" class="${category === c.id ? 'active' : ''}">${escape(categoryName(c.id))}</button>`).join('');
        for (const id of ['uploadCategory', 'metaCategory']) { const old = $(id).value; $(id).innerHTML = categoryOptions(old); }
    }
    function renderList() {
        const titles = { all: ['全部图片', 'All pictures'], work: ['工作 · 海报', 'Work & posters'], life: ['生活 · 菜单', 'Life & menus'], favorites: ['我的收藏', 'Favorites'], pending: ['待 AI 识别', 'Awaiting AI'], archived: ['已归档', 'Archived'] };
        $('viewTitle').textContent = category ? categoryName(category) : t(...titles[view]);
        $('resultCount').textContent = t(`${result.total} 件收藏`, `${result.total} collections`);
        $('grid').innerHTML = result.items.map(item => `<article class="card">
            <button class="card-open" data-open="${escape(item.id)}"><div class="card-picture"><img src="/api/gallery/versions/${escape(item.cover_id)}/thumbnail" alt="" loading="lazy"><span class="version-badge">${item.version_count} ${t('个版本', item.version_count === 1 ? 'version' : 'versions')}</span></div><div class="card-content"><strong class="card-title">${escape(item.title)}</strong><p class="card-meta">${escape(categoryName(item.category_id))} · ${date(item.updated_at)}</p><div class="card-tags">${item.tags.slice(0, 3).map(tag => `<span class="tag">${escape(tag)}</span>`).join('') || `<span class="tag">${item.scope === 'life' ? t('生活', 'Life') : t('工作', 'Work')}</span>`}</div></div></button>
            ${canWrite ? `<button class="icon card-star" data-favorite="${escape(item.id)}" aria-label="${t('切换收藏', 'Toggle favorite')}" aria-pressed="${item.favorite}">${item.favorite ? '★' : '☆'}</button>` : ''}</article>`).join('');
        $('empty').hidden = result.total > 0;
        const filtered = category || view !== 'all' || $('search').value;
        $('emptyTitle').textContent = filtered ? t('还没有找到这张图片', 'No pictures found') : t('你的第一张，值得好好收藏', 'Every picture deserves a place');
        $('emptyHint').textContent = filtered ? t('试试别的关键词，或切换分类。历史版本也会参与搜索。', 'Try another keyword or category. Historical versions are searched too.') : t('拖入海报、粘贴截图，或添加中文菜单。原图与压缩预览会一起保存。', 'Drop a poster, paste a screenshot, or collect a translated menu. Originals and compressed previews stay together.');
        $('emptyUpload').hidden = !canWrite || !!filtered;
        $('prev').disabled = result.page <= 1; $('next').disabled = result.page >= result.pages;
        $('pageInfo').textContent = `${result.page} / ${result.pages}`;
    }
    async function loadList() {
        const request = ++listRequest, params = new URLSearchParams({ page, sort: $('sort').value, q: $('search').value });
        if (view === 'work' || view === 'life') params.set('scope', view);
        if (view === 'favorites') params.set('favorite', '1');
        if (view === 'pending') params.set('pending', '1');
        if (view === 'archived') params.set('archived', '1');
        if (category) params.set('category', category);
        try {
            const data = await api('/items?' + params);
            if (request !== listRequest) return;
            result = data; page = data.page; $('error').hidden = true; renderList();
        } catch (error) { if (request === listRequest) { $('error').textContent = error.message; $('error').hidden = false; } }
    }
    function navigate(nextView, nextCategory = '') {
        view = nextView; category = nextCategory; page = 1;
        document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view && !category));
        renderCategories(); loadList();
    }
    function chooseFiles(files) {
        const accepted = Array.from(files).filter(file => /image\/(png|jpeg|webp)/.test(file.type));
        if (!accepted.length) { toast(t('请选择 PNG、JPEG 或 WebP 图片', 'Choose PNG, JPEG or WebP pictures')); return; }
        selected = accepted.slice(0, 50);
        if (accepted.length > 50) toast(t('一次最多添加 50 张图片', 'Up to 50 pictures per batch'));
        renderFiles();
    }
    function renderFiles() { $('fileList').textContent = selected.map(file => `${file.name} · ${byteSize(file.size)}`).join('\n'); }
    function openUpload(files, target = null) {
        if (!canWrite || uploading) return;
        $('uploadTarget').innerHTML = `<option value="">${t('每张图片单独收藏', 'Each picture as a separate card')}</option><option value="new-series">${t('这一批是同一作品的不同版本', 'Group these as versions of one picture')}</option>`;
        if (target) {
            const option = new Option(t(`作为「${target.title}」的新版本`, `New version of “${target.title}”`), target.id, true, true);
            $('uploadTarget').add(option); $('uploadScope').value = target.scope; $('uploadCategory').value = target.category_id;
        } else { $('uploadScope').value = view === 'life' ? 'life' : 'work'; $('uploadCategory').value = categories.some(c => c.id === category) ? category : ''; }
        $('seriesTitleField').hidden = true; $('seriesTitle').value = ''; $('uploadLabel').value = ''; $('autoAi').checked = false;
        $('uploadStatus').textContent = ''; selected = []; $('files').value = ''; renderFiles();
        if (files?.length) chooseFiles(files);
        if (!$('uploadDialog').open) $('uploadDialog').showModal();
    }
    async function webpRaster(file) {
        const url = URL.createObjectURL(file), image = new Image();
        try {
            image.src = url; await image.decode();
            const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .94));
            if (!blob) throw new Error(t('无法生成图片预览', 'Unable to create preview'));
            return blob;
        } finally { URL.revokeObjectURL(url); }
    }
    function uploadLock(locked) {
        uploading = locked;
        $('uploadForm').querySelectorAll('input,select,button').forEach(el => { el.disabled = locked; });
    }
    async function startUpload(event) {
        event.preventDefault(); if (uploading || !canWrite) return;
        if (!selected.length) return toast(t('先选择要收藏的图片', 'Choose some pictures first'));
        if ($('uploadTarget').value === 'new-series' && !$('seriesTitle').value.trim()) { $('seriesTitle').focus(); return toast(t('请填写作品名称', 'Enter a series title')); }
        let target = $('uploadTarget').value, failed = [], saved = 0, aiFailed = 0, lastSaved = null, messages = [];
        const grouped = target === 'new-series', automatic = $('autoAi').checked, mode = $('uploadAiMode').value;
        uploadLock(true);
        try {
            for (let i = 0; i < selected.length; i++) {
                const file = selected[i];
                $('uploadStatus').textContent = t(`正在保存 ${i + 1} / ${selected.length}：${file.name}`, `Saving ${i + 1} / ${selected.length}: ${file.name}`);
                try {
                    if (file.size > 25 * 1024 * 1024) throw new Error(t('单张图片不能超过 25 MB', 'Each picture must be 25 MB or less'));
                    const form = new FormData(); form.append('file', file);
                    if (file.type === 'image/webp') form.append('raster', await webpRaster(file), 'preview.jpg');
                    if (target && target !== 'new-series') form.append('itemId', target);
                    form.append('title', grouped ? $('seriesTitle').value : file.name.replace(/\.[^.]+$/, ''));
                    form.append('scope', $('uploadScope').value); form.append('category', $('uploadCategory').value); form.append('label', $('uploadLabel').value);
                    const uploaded = await api('/upload', 'POST', form);
                    lastSaved = uploaded.item; saved++;
                    if (grouped) target = uploaded.item.id;
                    if (automatic) {
                        $('uploadStatus').textContent = t(`已保存 ${i + 1} / ${selected.length}，AI 整理中…`, `Saved ${i + 1} / ${selected.length}. AI indexing…`);
                        try { await api(`/versions/${uploaded.versionId}/analyze`, 'POST', { mode, confirmed: true }); }
                        catch (_) { aiFailed++; }
                    }
                } catch (error) { failed.push(file); messages.push(`${file.name}: ${error.message}`); }
            }
            await loadList();
            if (current && lastSaved?.id === current.id) { current = await api('/items/' + current.id); fillDetail(); }
            const summary = t(`已保存 ${saved} 张${aiFailed ? `，${aiFailed} 张 AI 暂不可用，可手动分类` : ''}`, `Saved ${saved} pictures${aiFailed ? `; AI unavailable for ${aiFailed}, organize manually` : ''}`);
            if (failed.length) {
                selected = failed; renderFiles(); $('uploadStatus').textContent = summary + '\n' + messages.join('\n');
                // A partial grouped upload must retry into the same series, never create a second one.
                if (grouped && target !== 'new-series') { $('uploadTarget').add(new Option(lastSaved.title, target, true, true)); }
            } else { selected = []; $('uploadDialog').close(); toast(summary); }
        } finally { uploadLock(false); }
    }
    const versionLabel = v => `V${v.version_no}${v.label ? ' · ' + v.label : ''}`;
    function activeVersion() { return current?.versions.find(v => v.id === $('versionA').value); }
    function renderVersionOptions() {
        const a = $('versionA').value, b = $('versionB').value;
        const options = current.versions.map(v => `<option value="${escape(v.id)}">${escape(versionLabel(v))}</option>`).join('');
        $('versionA').innerHTML = $('versionB').innerHTML = options;
        $('versionA').value = current.versions.some(v => v.id === a) ? a : current.versions[0]?.id || '';
        $('versionB').value = current.versions.some(v => v.id === b) ? b : current.versions[1]?.id || current.versions[0]?.id || '';
        $('viewMode').options[1].disabled = $('viewMode').options[2].disabled = current.versions.length < 2;
        if (current.versions.length < 2) $('viewMode').value = 'single';
    }
    function fillDetail() {
        $('detailTitle').textContent = current.title; $('metaTitle').value = current.title; $('metaScope').value = current.scope;
        $('metaCategory').innerHTML = categoryOptions(current.category_id); $('metaTags').value = current.tags.join(', '); $('metaNote').value = current.note;
        $('favorite').textContent = current.favorite ? t('★ 已收藏', '★ Favorited') : t('☆ 收藏', '☆ Favorite');
        $('archive').textContent = current.archived ? t('恢复到图库', 'Restore to library') : t('归档这件收藏', 'Archive collection');
        $('addVersion').disabled = current.archived;
        renderVersionOptions(); renderPicture(); permissions();
    }
    function renderPicture() {
        const a = activeVersion(), b = current.versions.find(v => v.id === $('versionB').value);
        if (!a) return;
        const mode = $('viewMode').value, compare = mode !== 'single';
        $('pictureA').src = a.previewUrl; $('captionA').textContent = `${versionLabel(a)} · ${a.width} × ${a.height}`;
        if (b) { $('pictureB').src = b.previewUrl; $('captionB').textContent = versionLabel(b); }
        $('figureB').hidden = $('versionB').hidden = $('versus').hidden = $('compareHint').hidden = !compare;
        $('opacityControl').hidden = mode !== 'overlay'; $('pictureStage').classList.toggle('overlay', mode === 'overlay');
        $('figureB').style.opacity = mode === 'overlay' ? $('opacity').value / 100 : '';
        $('downloadOriginal').href = a.originalUrl; $('downloadPreview').href = a.previewUrl + '?download=1';
        $('downloadOriginal').textContent = t('下载原图', 'Original') + ` · ${byteSize(a.original_bytes)}`;
        $('downloadPreview').textContent = t('下载压缩图', 'Compressed') + ` · ${byteSize(a.preview_bytes)}`;
        $('versionList').innerHTML = current.versions.map(v => `<button class="version-button ${v.id === a.id ? 'active' : ''}" data-version="${escape(v.id)}"><img src="${escape(v.thumbnailUrl)}" alt=""><span>${escape(versionLabel(v))}</span><small>${date(v.created_at)}</small></button>`).join('');
        const analysis = a.analysis || {}, ready = a.ai_status === 'ready';
        $('aiState').textContent = ready ? t('已识别', 'Indexed') : a.ai_status === 'failed' ? t('可重试', 'Retry available') : t('未识别', 'Not indexed');
        $('aiSummary').textContent = analysis.summary || t('手动填写分类、标签和备注，也能快速找到这张图。', 'Add categories, tags and notes to find this picture quickly.');
        $('aiSuggestions').innerHTML = (analysis.tags || []).map(tag => `<span class="tag">${escape(tag)}</span>`).join('');
        $('recognizedText').textContent = analysis.text || t('暂无识别文字', 'No recognized text');
        $('applyAi').hidden = !canWrite || !ready; $('analyze').disabled = aiBusy;
        if (ready) $('detailAiMode').value = a.ai_mode;
    }
    async function openDetail(id) {
        const request = ++detailRequest;
        const loaded = await api('/items/' + id); if (request !== detailRequest) return;
        current = loaded; $('viewMode').value = 'single'; $('versionA').innerHTML = $('versionB').innerHTML = ''; $('aiConfirm').checked = false;
        fillDetail(); $('detailDialog').showModal();
    }
    async function saveMeta(event) {
        event.preventDefault(); if (!current || !canWrite) return;
        current = await api('/items/' + current.id, 'PATCH', { revision: current.revision, title: $('metaTitle').value, scope: $('metaScope').value, category_id: $('metaCategory').value, tags: $('metaTags').value, note: $('metaNote').value });
        fillDetail(); loadList(); toast(t('已保存', 'Saved'));
    }
    async function toggleFavorite(id) {
        const detail = await api('/items/' + id);
        const updated = await api('/items/' + id, 'PATCH', { revision: detail.revision, favorite: !detail.favorite });
        if (current?.id === id) { current.favorite = updated.favorite; current.revision = updated.revision; $('favorite').textContent = current.favorite ? t('★ 已收藏', '★ Favorited') : t('☆ 收藏', '☆ Favorite'); }
        loadList();
    }
    async function analyzeCurrent() {
        const a = activeVersion(); if (!a || !canWrite || aiBusy) return;
        if (!$('aiConfirm').checked) return toast(t('请先确认图片不含密码、凭据或密钥', 'Confirm the picture has no credentials or secrets'));
        aiBusy = true; $('analyze').disabled = true; $('aiState').textContent = t('识别中…', 'Indexing…');
        const itemId = current.id;
        try {
            const data = await api(`/versions/${a.id}/analyze`, 'POST', { mode: $('detailAiMode').value, confirmed: true });
            if (current?.id === itemId) current.versions = current.versions.map(v => v.id === a.id ? data.version : v);
            toast(data.cached ? t('已复用识别结果，不重复调用 AI', 'Reused saved results without another AI call') : t('识别完成，确认建议后可采用', 'Indexed. Review the suggestions before applying.'));
            loadList();
        } catch (error) { if (current?.id === itemId) current.versions = (await api('/items/' + itemId)).versions; throw error; }
        finally { aiBusy = false; if (current?.id === itemId) renderPicture(); }
    }
    async function applyAi() {
        const analysis = activeVersion()?.analysis; if (!analysis?.title || !canWrite) return;
        $('metaTitle').value = analysis.title; $('metaTags').value = analysis.tags.join(', '); $('metaScope').value = analysis.scope;
        if (analysis.categoryId) $('metaCategory').value = analysis.categoryId;
        else if (analysis.suggestedCategory) { categoryTarget = 'metaCategory'; $('categoryName').value = analysis.suggestedCategory; $('categoryDialog').showModal(); }
        toast(t('建议已填入，点击“保存修改”后生效', 'Suggestions filled in. Save changes to apply.'));
    }
    function newCategory(target = '') {
        if (!canWrite) return; categoryTarget = target; $('categoryName').value = ''; $('categoryDialog').showModal(); $('categoryName').focus();
    }
    async function createCategory(event) {
        event.preventDefault(); const created = await api('/categories', 'POST', { name: $('categoryName').value });
        categories = await api('/categories'); renderCategories();
        if (categoryTarget) $(categoryTarget).value = created.id;
        $('categoryDialog').close(); toast(t('分类已创建', 'Category created'));
    }
    async function download(url, filename) {
        const response = await fetch(url, { headers: getAuthHeaders() });
        if (!response.ok) { await handleResponse(response); return; }
        const blobUrl = URL.createObjectURL(await response.blob()), link = document.createElement('a');
        link.href = blobUrl; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    }
    function downloadName(v, compressed) {
        const ext = compressed ? '.jpg' : ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[v.mime];
        return `${current.title.replace(/[\\/:*?"<>|]/g, '_')}-V${v.version_no}${compressed ? '-preview' : ''}${ext}`;
    }
    async function sharePicture() {
        const a = activeVersion(); if (!a) return;
        const response = await fetch(a.previewUrl, { headers: getAuthHeaders() });
        if (!response.ok) return handleResponse(response);
        const file = new File([await response.blob()], downloadName(a, true), { type: 'image/jpeg' });
        if (navigator.canShare?.({ files: [file] })) {
            try { await navigator.share({ files: [file], title: current.title }); return; } catch (error) { if (error.name === 'AbortError') return; }
        }
        await download(a.previewUrl, file.name); toast(t('当前环境无法系统分享，已下载压缩图，可直接发送给朋友', 'System sharing is unavailable. The compressed picture was downloaded for sharing.'));
    }
    $('navigation').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) navigate(button.dataset.view); });
    $('categoryNav').addEventListener('click', event => { const button = event.target.closest('[data-category]'); if (button) navigate('all', category === button.dataset.category ? '' : button.dataset.category); });
    $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; loadList(); }, 200); });
    $('sort').addEventListener('change', () => { page = 1; loadList(); });
    $('prev').onclick = () => { page--; loadList(); }; $('next').onclick = () => { page++; loadList(); };
    $('grid').addEventListener('click', guarded(async event => { const favorite = event.target.closest('[data-favorite]'); if (favorite) return toggleFavorite(favorite.dataset.favorite); const button = event.target.closest('[data-open]'); if (button) await openDetail(button.dataset.open); }));
    $('uploadButton').onclick = $('emptyUpload').onclick = () => openUpload();
    $('files').onchange = () => chooseFiles($('files').files);
    $('uploadTarget').onchange = () => { $('seriesTitleField').hidden = $('uploadTarget').value !== 'new-series'; };
    $('uploadForm').addEventListener('submit', guarded(startUpload));
    $('uploadDialog').addEventListener('cancel', event => { if (uploading) event.preventDefault(); });
    document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => { if (button.dataset.close === 'uploadDialog' && uploading) return; $(button.dataset.close).close(); }; });
    $('viewMode').onchange = $('versionA').onchange = $('versionB').onchange = $('opacity').oninput = () => { $('aiConfirm').checked = false; renderPicture(); };
    $('versionList').onclick = event => { const button = event.target.closest('[data-version]'); if (button) { $('versionA').value = button.dataset.version; $('aiConfirm').checked = false; renderPicture(); } };
    $('metaForm').addEventListener('submit', guarded(saveMeta));
    $('favorite').onclick = guarded(() => toggleFavorite(current.id));
    $('addVersion').onclick = () => openUpload(null, current);
    $('archive').onclick = guarded(async () => { current = await api('/items/' + current.id, 'PATCH', { revision: current.revision, archived: !current.archived }); $('detailDialog').close(); loadList(); toast(current.archived ? t('已归档，可在“已归档”中恢复', 'Archived. Restore it from Archived anytime.') : t('已恢复到图库', 'Restored to library')); });
    $('analyze').onclick = guarded(analyzeCurrent); $('applyAi').onclick = guarded(applyAi);
    $('addCategory').onclick = () => newCategory(); $('uploadNewCategory').onclick = () => newCategory('uploadCategory'); $('detailNewCategory').onclick = () => newCategory('metaCategory');
    $('categoryForm').addEventListener('submit', guarded(createCategory));
    $('downloadOriginal').onclick = guarded(event => { event.preventDefault(); const a = activeVersion(); return download(a.originalUrl, downloadName(a, false)); });
    $('downloadPreview').onclick = guarded(event => { event.preventDefault(); const a = activeVersion(); return download(a.previewUrl, downloadName(a, true)); });
    $('share').onclick = guarded(sharePicture);
    $('theme').onclick = () => { localStorage.setItem('picture_island_theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); applyTheme(); };
    matchMedia('(prefers-color-scheme:dark)').addEventListener('change', applyTheme);
    $('language').onclick = () => {
        // The platform runtime handles native language controls and dispatches the event below.
        if (window.ToolsCustomI18n) return;
        english = !english; localStorage.setItem('tools_lang', english ? 'en-US' : 'zh-CN');
        translate();
    };
    for (const eventName of ['tools:languagechange', 'tools:custom-languagechange']) window.addEventListener(eventName, () => { english = localStorage.getItem('tools_lang')?.startsWith('en') || false; translate(); });
    window.addEventListener('storage', event => { if (event.key === 'tools_lang') { english = event.newValue?.startsWith('en') || false; translate(); } });
    document.addEventListener('keydown', event => { if (event.key === '/' && !document.querySelector('dialog[open]') && !event.target.matches('input,textarea,select')) { event.preventDefault(); $('search').focus(); } });
    document.addEventListener('dragenter', event => { if (canWrite && !uploading && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('dropzone').hidden = false; } });
    document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
    document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').hidden = true; } });
    document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('dropzone').hidden = true; if (!canWrite || uploading) return; if ($('uploadDialog').open) chooseFiles(event.dataTransfer.files); else openUpload(event.dataTransfer.files, $('detailDialog').open ? current : null); });
    document.addEventListener('paste', event => { if (!canWrite || uploading || event.target.matches('input,textarea')) return; const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); if ($('uploadDialog').open) chooseFiles(files); else openUpload(files, $('detailDialog').open ? current : null); } });
    window.addEventListener('beforeunload', event => { if (uploading) { event.preventDefault(); event.returnValue = ''; } });
    applyTheme(); translate(); permissions();
    (async () => { try { const [permissionsResult, categoryResult] = await Promise.all([api('/capabilities'), api('/categories')]); canWrite = permissionsResult.canWrite; categories = categoryResult; renderCategories(); permissions(); await loadList(); } catch (error) { $('error').textContent = error.message; $('error').hidden = false; } })();
})();
