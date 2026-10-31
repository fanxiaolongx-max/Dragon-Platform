(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    let english = localStorage.getItem('tools_lang')?.startsWith('en') || false;
    const t = (zh, en) => english ? en : zh;
    let categories = [], result = { items: [], total: 0, page: 1, pages: 1 }, view = 'all', category = '', page = 1;
    let canWrite = false, selected = [], current = null, uploading = false, listRequest = 0, detailRequest = 0, categoryTarget = '', aiBusy = false;
    let toastTimer, searchTimer, dragDepth = 0;
    let readerVersion = '', readerLayout = 'auto', readerZoom = 100, originalRequest = null, originalUrl = '', originalState = '';
    let albums = [], album = '', albumTarget = '', selectionMode = false;
    const selectedItems = new Map();
    const uploadManual = new Set();
    let deletionEntries = [];
    let viewerItems = [];
    let zoomMotion=null, zoomFrame=0, zoomIdleTimer, zoomSnapTimer;
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
        $('metaAlbum').disabled = !canWrite; $('selectPictures').hidden = !canWrite || view === 'albums';
        $('metaForm').querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = !canWrite || !!current?.deleted_at; });
        $('deleteDetail').hidden = !canWrite || !!current?.deleted_at; $('restoreDetail').hidden = !canWrite || !current?.deleted_at;
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
        $('zoomOut').ariaLabel = t('缩小', 'Zoom out'); $('zoomIn').ariaLabel = t('放大', 'Zoom in');
        $('pictureStage').ariaLabel = t('图片查看区域，可滚动阅读', 'Picture viewer, scroll to read');
        $('detailDialog').ariaLabel = t('图片查看器','Picture viewer'); $('filmstripMode').ariaLabel = t('缩略图内容','Thumbnail contents');
        for (const [id,zh,en] of [['toggleInfo','信息与整理','Info and organize'],['toggleCompare','版本对比','Compare versions'],['toggleFilmstrip','缩略图','Thumbnails'],['viewerPrevious','上一张','Previous picture'],['viewerNext','下一张','Next picture'],['share','分享图片','Share picture'],['closeInfo','关闭信息','Close info']]) $(id).title = $(id).ariaLabel = t(zh,en);
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
    const albumName = id => albums.find(a => a.id === id)?.name || '';
    function albumOptions(value) { return `<option value="">${t('不放入相册', 'No album')}</option>` + albums.map(a => `<option value="${escape(a.id)}" ${a.id === value ? 'selected' : ''}>${escape(a.name)}</option>`).join(''); }
    function renderAlbums() {
        const overview = view === 'albums', query = $('search').value.trim().toLocaleLowerCase();
        const visible = overview ? albums.filter(a => a.name.toLocaleLowerCase().includes(query)) : albums.slice(0,6);
        $('albumSection').hidden = !overview;
        $('albumGrid').innerHTML = visible.map(a => `<button class="album-card" data-album="${escape(a.id)}">${a.cover_id ? `<img src="/api/gallery/versions/${escape(a.cover_id)}/thumbnail" data-reading-preview="/api/gallery/versions/${escape(a.cover_id)}/preview" alt="" loading="lazy">` : '<span class="album-symbol">▣</span>'}<span><strong>${escape(a.name)}</strong><small>${a.item_count} ${t('张图片', 'pictures')}</small></span><span aria-hidden="true">↗</span></button>`).join('');
        for (const id of ['uploadAlbum','metaAlbum']) { const value = $(id).value; $(id).innerHTML = albumOptions(value); }
        const value = $('batchAlbum').value;
        $('batchAlbum').innerHTML = `<option value="" disabled ${!value ? 'selected' : ''}>${t('选择目标相册', 'Choose album')}</option>` + albums.map(a => `<option value="${escape(a.id)}" ${value === a.id ? 'selected' : ''}>${escape(a.name)}</option>`).join('') + `<option value="none" ${value === 'none' ? 'selected' : ''}>${t('移出相册', 'Remove from album')}</option>`;
        if (overview) $('resultCount').textContent = t(`${visible.length} 个相册`, `${visible.length} albums`);
    }
    async function refreshAlbums() { const data = await Promise.all([api('/albums'),api('/categories')]); albums = data[0]; categories = data[1]; renderCategories(); renderAlbums(); }
    function renderSelection() {
        $('selectionBar').hidden = !canWrite || !selectionMode || view === 'albums';
        $('selectedCount').textContent = t(`已选 ${selectedItems.size} 张`, `${selectedItems.size} selected`);
        $('selectPictures').textContent = selectionMode ? t('取消选择', 'Cancel selection') : t('选择图片', 'Select pictures');
        $('assignAlbum').disabled = !selectedItems.size || !$('batchAlbum').value;
        document.body.classList.toggle('selecting',selectionMode);
        for (const id of ['batchAlbum','batchNewAlbum','assignAlbum','deleteSelected']) $(id).hidden = view === 'trash';
        $('restoreSelected').hidden = view !== 'trash';
        $('deleteSelected').disabled = $('restoreSelected').disabled = !selectedItems.size;
    }
    function selectItem(id, checked) {
        const item = result.items.find(item => item.id === id); if (!item) return;
        if (checked) selectedItems.set(id,item.revision); else selectedItems.delete(id);
        const input = document.querySelector(`[data-select="${CSS.escape(id)}"]`);
        if (input) { input.checked = checked; input.closest('.card').classList.toggle('selected',checked); }
        renderSelection();
    }
    function openAlbum(id) { $('search').value = ''; $('sort').value = 'title'; navigate('all','',id); }
    function newAlbum(target = '') { if (!canWrite) return; albumTarget = target; $('albumName').value = ''; $('albumDialog').showModal(); $('albumName').focus(); }
    async function createAlbum(event) {
        event.preventDefault(); const created = await api('/albums','POST',{ name:$('albumName').value });
        await refreshAlbums(); if (albumTarget) $(albumTarget).value = created.id;
        $('albumDialog').close(); renderSelection(); toast(t('相册已创建', 'Album created'));
    }
    async function assignSelected() {
        if (!selectedItems.size || !$('batchAlbum').value) return;
        await api(`/albums/${encodeURIComponent($('batchAlbum').value)}/items`,'POST',{ items:Array.from(selectedItems,([id,revision]) => ({id,revision})) });
        selectedItems.clear(); selectionMode = false; await refreshAlbums(); await loadList(); toast(t('已更新所属相册，原图及历史版本均保留', 'Album updated. Originals and versions are preserved.'));
    }
    function proposeDeletion(entries) {
        if (!entries.length) return;
        deletionEntries = entries;
        $('deleteSummary').textContent = t(`已选 ${entries.length} 张图片。`,`${entries.length} pictures selected.`);
        $('deleteDialog').showModal();
    }
    async function deletePictures(event) {
        event.preventDefault(); $('confirmDelete').disabled = true;
        try {
            await api('/items','DELETE',{items:deletionEntries,confirmed:true});
            $('deleteDialog').close(); if ($('detailDialog').open) $('detailDialog').close();
            selectionMode = false; selectedItems.clear(); await refreshAlbums(); await loadList();
            toast(t('已移入回收站，可恢复', 'Moved to Trash. You can restore these pictures.'));
        } finally { $('confirmDelete').disabled = false; }
    }
    async function restorePictures(entries) {
        await api('/items/restore','POST',{items:entries});
        if ($('detailDialog').open) $('detailDialog').close();
        selectionMode = false; await refreshAlbums(); await loadList(); toast(t('图片已恢复', 'Pictures restored'));
    }
    function renderList() {
        const titles = { all: ['全部图片', 'All pictures'], work: ['工作 · 海报', 'Work & posters'], life: ['生活 · 菜单', 'Life & menus'], favorites: ['我的收藏', 'Favorites'], pending: ['待 AI 识别', 'Awaiting AI'], archived: ['已归档', 'Archived'],trash:['回收站','Trash'] };
        $('viewTitle').textContent = album ? albumName(album) : view === 'albums' ? t('我的相册', 'Albums') : $('search').value ? t('搜索结果','Search results') : category ? categoryName(category) : t(...titles[view]);
        $('grid').hidden = $('pagination').hidden = view === 'albums'; $('sort').hidden = view === 'albums';
        $('selectPictures').hidden = !canWrite || view === 'albums'; $('backToAlbums').hidden = !album;
        if (view === 'albums') { $('empty').hidden = true; renderAlbums(); renderSelection(); return; }
        $('resultCount').textContent = t(`${result.total} 件收藏`, `${result.total} collections`);
        $('grid').innerHTML = result.items.map(item => `<article class="card ${selectedItems.has(item.id) ? 'selected' : ''}">
            ${selectionMode && canWrite ? `<label class="card-select"><input type="checkbox" data-select="${escape(item.id)}" aria-label="${escape(t('选择 ', 'Select ') + item.title)}" ${selectedItems.has(item.id) ? 'checked' : ''}></label>` : ''}
            <button class="card-open" data-open="${escape(item.id)}"><div class="card-picture"><img src="/api/gallery/versions/${escape(item.cover_id)}/thumbnail" data-reading-preview="/api/gallery/versions/${escape(item.cover_id)}/preview" alt="" loading="lazy"><span class="version-badge">${item.version_count} ${t('个版本', item.version_count === 1 ? 'version' : 'versions')}</span></div><div class="card-content"><strong class="card-title">${escape(item.title)}</strong><p class="card-meta">${escape(categoryName(item.category_id))} · ${item.is_example ? t('内置示例', 'Example') : date(item.updated_at)}</p><div class="card-tags">${item.tags.slice(0, 3).map(tag => `<span class="tag">${escape(tag)}</span>`).join('') || `<span class="tag">${item.scope === 'life' ? t('生活', 'Life') : t('工作', 'Work')}</span>`}</div></div></button>
            ${item.album_name ? `<button class="card-album text-button" data-album="${escape(item.album_id)}">▣ ${escape(item.album_name)}</button>` : ''}
            ${canWrite && !selectionMode ? `<button class="icon card-star" data-favorite="${escape(item.id)}" aria-label="${t('切换收藏', 'Toggle favorite')}" aria-pressed="${item.favorite}">${item.favorite ? '★' : '☆'}</button>` : ''}</article>`).join('');
        $('empty').hidden = result.total > 0;
        const filtered = category || view !== 'all' || $('search').value;
        $('emptyTitle').textContent = filtered ? t('还没有找到这张图片', 'No pictures found') : albums.some(a=>a.item_count) ? t('图片已收进相册','Your pictures are in albums') : t('你的第一张，值得好好收藏', 'Every picture deserves a place');
        $('emptyHint').textContent = filtered ? t('试试别的关键词，或切换分类。历史版本也会参与搜索。', 'Try another keyword or category. Historical versions are searched too.') : t('“全部图片”展示所有工作图片和未归入相册的生活图片。已整理的生活图片可在“我的相册”查看。', 'All pictures shows every work picture and unfiled life pictures. Open Albums for organized life pictures.');
        $('emptyUpload').hidden = !canWrite || !!filtered;
        $('prev').disabled = result.page <= 1; $('next').disabled = result.page >= result.pages;
        $('pageInfo').textContent = `${result.page} / ${result.pages}`;
        renderAlbums(); renderSelection();
    }
    async function loadList() {
        const request = ++listRequest, params = new URLSearchParams({ page, sort: $('sort').value, q: $('search').value });
        if (view === 'work' || view === 'life') params.set('scope', view);
        if (view === 'favorites') params.set('favorite', '1');
        if (view === 'pending') params.set('pending', '1');
        if (view === 'archived') params.set('archived', '1');
        if (view === 'trash') params.set('trash','1');
        if (view === 'all' && !album && !category && !$('search').value.trim()) params.set('home','1');
        if (category) params.set('category', category);
        if (album) params.set('album', album);
        try {
            const data = await api('/items?' + params);
            if (request !== listRequest) return;
            selectedItems.clear(); result = data; page = data.page; $('error').hidden = true; renderList();
        } catch (error) { if (request === listRequest) { $('error').textContent = error.message; $('error').hidden = false; } }
    }
    function navigate(nextView, nextCategory = '', nextAlbum = '') {
        view = nextView; category = nextCategory; album = nextAlbum; page = 1; selectionMode = false; selectedItems.clear();
        document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view && !category && !album));
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
        uploadManual.clear();
        $('uploadTarget').innerHTML = `<option value="auto">${t('AI 自动判断相册 / 版本 / 独立保存', 'AI decides: album / version / separate')}</option><option value="">${t('每张图片单独收藏', 'Each picture as a separate card')}</option><option value="new-album">${t('同一餐厅 / 项目的不同图片（新相册）', 'Different pages of one restaurant / project (new album)')}</option><option value="new-series">${t('同一张图片的新旧稿（历史版本）', 'Revisions of the same picture (versions)')}</option>`;
        $('uploadAlbum').innerHTML = albumOptions(target?.album_id || album);
        if (target) {
            const option = new Option(t(`作为「${target.title}」的新版本`, `New version of “${target.title}”`), target.id, true, true);
            $('uploadTarget').add(option); $('uploadScope').value = target.scope; $('uploadCategory').value = target.category_id;
        } else { $('uploadScope').value = ['life','work'].includes(view) ? view : 'auto'; $('uploadCategory').value = categories.some(c => c.id === category) ? category : ''; }
        $('seriesTitleField').hidden = true; $('seriesTitle').value = ''; $('uploadLabel').value = ''; $('autoAi').checked = true;
        $('uploadTitle').value = $('uploadTags').value = $('uploadNote').value = ''; $('manualUploadDetails').open = !!target;
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
        if (['new-series','new-album'].includes($('uploadTarget').value) && !$('seriesTitle').value.trim()) { $('seriesTitle').focus(); return toast(t('请填写作品或相册名称', 'Enter a series or album title')); }
        let target = $('uploadTarget').value, failed = [], saved = 0, aiFailed = 0, lastSaved = null, messages = [];
        const grouped = target === 'new-series', automatic = $('autoAi').checked, mode = $('uploadAiMode').value;
        const manual = new Set(uploadManual);
        if (target !== 'auto') manual.add('storage');
        if (grouped || $('uploadTitle').value.trim()) manual.add('title');
        if ($('uploadScope').value !== 'auto') manual.add('scope');
        if ($('uploadCategory').value) manual.add('category_id');
        if ($('uploadAlbum').value || target === 'new-album') manual.add('album_id');
        if ($('uploadTags').value.trim()) manual.add('tags');
        if ($('uploadNote').value.trim()) manual.add('note');
        if ($('uploadLabel').value.trim()) manual.add('version_label');
        if (!automatic) manual.add('storage');
        uploadLock(true);
        try {
            if (target === 'new-album') {
                const created = await api('/albums','POST',{name:$('seriesTitle').value}); await refreshAlbums();
                $('uploadAlbum').value = created.id; $('uploadTarget').value = ''; target = '';
            }
            for (let i = 0; i < selected.length; i++) {
                const file = selected[i];
                $('uploadStatus').textContent = t(`正在保存 ${i + 1} / ${selected.length}：${file.name}`, `Saving ${i + 1} / ${selected.length}: ${file.name}`);
                try {
                    if (file.size > 25 * 1024 * 1024) throw new Error(t('单张图片不能超过 25 MB', 'Each picture must be 25 MB or less'));
                    const form = new FormData(); form.append('file', file);
                    if (file.type === 'image/webp') form.append('raster', await webpRaster(file), 'preview.jpg');
                    if (target && !['new-series','auto'].includes(target)) form.append('itemId', target);
                    form.append('title', grouped ? $('seriesTitle').value : $('uploadTitle').value.trim() || file.name.replace(/\.[^.]+$/, ''));
                    form.append('scope', $('uploadScope').value); form.append('category', $('uploadCategory').value); form.append('label', $('uploadLabel').value);
                    form.append('album', $('uploadAlbum').value);
                    form.append('manualFields',JSON.stringify([...manual])); form.append('autoAi',automatic ? '1' : '0'); form.append('aiMode',mode);
                    form.append('tags',$('uploadTags').value); form.append('note',$('uploadNote').value);
                    if (automatic) $('uploadStatus').textContent = t(`保存并整理 ${i+1} / ${selected.length}：${file.name}`,`Saving and organizing ${i+1} / ${selected.length}: ${file.name}`);
                    const uploaded = await api('/upload', 'POST', form);
                    lastSaved = uploaded.item; saved++;
                    if (grouped) target = uploaded.item.id;
                    if (uploaded.aiWarning) aiFailed++;
                } catch (error) { failed.push(file); messages.push(`${file.name}: ${error.message}`); }
            }
            await refreshAlbums(); await loadList();
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
    function topPreview(event) {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || !img.dataset.readingPreview || img.naturalHeight < img.naturalWidth * 2) return;
        img.classList.add('long-picture');
        // Reuse the existing, sharper preview for old uploads as well as new pictures.
        if (img.getAttribute('src') !== img.dataset.readingPreview) img.src = img.dataset.readingPreview;
    }
    function releaseOriginal() {
        originalRequest?.controller.abort(); originalRequest = null;
        if (originalUrl) URL.revokeObjectURL(originalUrl);
        originalUrl = ''; originalState = '';
    }
    function notifyViewer(open) {
        if (window.parent !== window) window.parent.postMessage({type:'tools-gallery-viewer',open},location.origin);
    }
    function viewerNeighbors() {
        const index = viewerItems.findIndex(item=>item.id===current?.id);
        return index >= 0 ? {previous:viewerItems[index-1],next:viewerItems[index+1],index} : {previous:current?.album_previous,next:current?.album_next,index:-1};
    }
    function setInfo(open) {
        $('detailDialog').classList.toggle('with-info',open); $('toggleInfo').setAttribute('aria-expanded',String(open));
        if (!open) $('pictureStage').focus({preventScroll:true});
    }
    function renderViewerChrome() {
        const neighbors = viewerNeighbors(), a = activeVersion();
        $('viewerPrevious').disabled = !neighbors.previous; $('viewerNext').disabled = !neighbors.next;
        $('viewerMeta').textContent = `${neighbors.index >= 0 ? `${neighbors.index+1} / ${viewerItems.length} · ` : ''}${versionLabel(a)} · ${a.width} × ${a.height}`;
        $('toggleCompare').hidden = current.versions.length < 2;
        if ($('viewMode').value !== 'single') $('viewerAdvanced').hidden = false;
        $('toggleCompare').setAttribute('aria-pressed',String(!$('viewerAdvanced').hidden));
        $('filmstripMode').options[1].disabled = current.versions.length < 2;
        if (current.versions.length < 2) $('filmstripMode').value = 'pictures';
        const versions = $('filmstripMode').value === 'versions';
        $('versionList').hidden = !versions; $('pictureFilmstrip').hidden = versions;
        $('pictureFilmstrip').innerHTML = viewerItems.map(item=>`<button class="film-picture ${item.id === current.id ? 'active' : ''}" data-picture="${escape(item.id)}" title="${escape(item.title)}" aria-label="${escape(item.title)}" aria-pressed="${item.id === current.id}"><img src="/api/gallery/versions/${escape(item.cover_id)}/thumbnail" data-reading-preview="/api/gallery/versions/${escape(item.cover_id)}/preview" alt="" loading="lazy"><span>${escape(item.title)}</span></button>`).join('');
        $('detailDialog').classList.toggle('without-filmstrip',$('viewerFilmstrip').hidden);
    }
    function readingStatus() {
        $('readingStatus').textContent = originalState === 'loading' ? t('正在加载清晰原图…', 'Loading full resolution…')
            : originalState === 'failed' ? t('原图加载失败，点击“适应宽度”重试', 'Full resolution failed. Click Fit width to retry.')
                : t('可滚动向下阅读', 'Scroll down to read');
    }
    async function loadReadableOriginal(a) {
        if (originalUrl || originalRequest) return;
        const request = { id: a.id, controller: new AbortController() };
        originalRequest = request; originalState = 'loading'; readingStatus();
        try {
            const response = await fetch(a.originalUrl, { headers: getAuthHeaders(), signal: request.controller.signal });
            if (!response.ok) { await handleResponse(response); return; }
            const blob = await response.blob();
            if (originalRequest !== request || readerVersion !== a.id || !$('detailDialog').open) return;
            originalUrl = URL.createObjectURL(blob); $('pictureA').src = originalUrl; originalState = 'ready';
        } catch (error) { if (originalRequest === request && error.name !== 'AbortError') originalState = 'failed'; }
        finally { if (originalRequest === request) { originalRequest = null; readingStatus(); } }
    }
    function renderReader(a, compare) {
        if (readerVersion !== a.id) {
            releaseOriginal(); clearZoomSnap(); readerVersion = a.id; readerLayout = 'auto'; readerZoom = 100;
            $('pictureA').src = a.source === 'builtin-example' ? a.thumbnailUrl : a.previewUrl; $('pictureStage').scrollTop = $('pictureStage').scrollLeft = 0;
        }
        const reading = !compare && (readerLayout === 'width' || (readerLayout === 'auto' && a.height >= a.width * 2));
        $('readingToolbar').hidden = compare;
        $('pictureStage').classList.toggle('reading', reading);
        $('pictureStage').style.setProperty('--reading-width', `${readerZoom}%`);
        centerSmallImage(reading ? readerZoom : null);
        $('fitWidth').setAttribute('aria-pressed', String(reading)); $('fitWhole').setAttribute('aria-pressed', String(!reading));
        $('zoomValue').textContent = reading ? `${Math.round($('pictureStage').clientWidth*readerZoom/a.width)}%` : t('全图', 'Full');
        $('zoomOut').disabled = reading && readerZoom <= Math.min(10,zoomStops()[0].value); $('zoomIn').disabled = reading && readerZoom >= Math.max(600,zoomStops()[2].value);
        $('readingStatus').hidden = !reading;
        if (!compare) { if (reading) readingStatus(); if ($('detailDialog').open) void loadReadableOriginal(a); }
        else {
            clearZoomSnap();releaseOriginal();
            if ($('pictureA').getAttribute('src') !== a.previewUrl) $('pictureA').src = a.previewUrl;
        }
    }
    function setReader(layout, zoom = 100, preservePosition = false) {
        const stage = $('pictureStage'), wasReading = stage.classList.contains('reading');
        const previousZoom = readerZoom, top = stage.scrollTop, left = stage.scrollLeft;
        readerLayout = layout; readerZoom = Math.max(Math.min(10,zoomStops()[0].value), Math.min(Math.max(600,zoomStops()[2].value), zoom));
        renderReader(activeVersion(), false);
        if (wasReading && preservePosition) {
            const ratio = readerZoom / previousZoom;
            stage.scrollTop = (top + stage.clientHeight / 2) * ratio - stage.clientHeight / 2;
            stage.scrollLeft = (left + stage.clientWidth / 2) * ratio - stage.clientWidth / 2;
        } else stage.scrollTop = stage.scrollLeft = 0;
    }
    function imageBounds() {
        const img=$('pictureA'),rect=img.getBoundingClientRect();
        if ($('pictureStage').classList.contains('reading')) return rect;
        const style=getComputedStyle(img),width=rect.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height=rect.height-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
        const ratio=Math.min(width/img.naturalWidth,height/img.naturalHeight);
        return {left:rect.left+parseFloat(style.paddingLeft)+(width-img.naturalWidth*ratio)/2,top:rect.top+parseFloat(style.paddingTop)+(height-img.naturalHeight*ratio)/2,width:img.naturalWidth*ratio,height:img.naturalHeight*ratio};
    }
    function clearZoomSnap() {
        cancelAnimationFrame(zoomFrame);zoomFrame=0;zoomMotion=null;$('pictureStage').classList.remove('zooming');
        clearTimeout(zoomIdleTimer);clearTimeout(zoomSnapTimer);$('zoomSnapHint').hidden=true;
    }
    function zoomStops() {
        const stage=$('pictureStage'),a=activeVersion(),style=getComputedStyle(stage);
        const width=stage.clientWidth-(parseFloat(style.getPropertyValue('--fit-inline'))||28);
        const height=stage.clientHeight-(parseFloat(style.getPropertyValue('--fit-block'))||40);
        return [{key:'whole',value:Math.min(width,height*a.width/a.height)/stage.clientWidth*100,label:t('适合屏幕','Fit screen')},
            {key:'width',value:100,label:t('适应宽度','Fit width')},
            {key:'native',value:a.width/stage.clientWidth*100,label:t('100% · 原始尺寸','100% · Actual size')}];
    }
    function centerSmallImage(zoom) {
        const stage=$('pictureStage'),figure=$('pictureA').closest('figure'),a=activeVersion();
        // Keep the same image center when moving between fitted and scrollable layouts.
        const height=zoom===null?0:stage.clientWidth*zoom/100*a.height/a.width;
        const offset=parseFloat(getComputedStyle(stage).getPropertyValue('--fit-center-y'))||-8;
        figure.style.paddingTop=zoom===null?'':`${Math.max(0,(stage.clientHeight-height)/2+offset)}px`;
    }
    function applyZoom(value,anchor) {
        const stage=$('pictureStage');
        readerLayout='width';readerZoom=value;
        stage.classList.add('reading');stage.style.setProperty('--reading-width',`${value}%`);
        centerSmallImage(value);
        const after=$('pictureA').getBoundingClientRect();
        // Never reset scroll to zero between frames: retain the gesture's image-space anchor.
        stage.scrollLeft+=after.left+anchor.u*after.width-anchor.x;
        stage.scrollTop+=after.top+anchor.v*after.height-anchor.y;
        $('zoomValue').textContent=`${Math.round(stage.clientWidth*value/activeVersion().width)}%`;
        $('fitWidth').setAttribute('aria-pressed',String(Math.abs(value-100)<.05));$('fitWhole').setAttribute('aria-pressed','false');
        const stops=zoomStops();
        $('zoomOut').disabled=value<=Math.min(10,stops[0].value)+.001;
        $('zoomIn').disabled=value>=Math.max(600,stops[2].value)-.001;
    }
    function drawZoom(time) {
        zoomFrame=0;const motion=zoomMotion;
        if(!motion||motion.id!==readerVersion||!$('detailDialog').open)return;
        const dt=motion.frameTime?Math.min(40,time-motion.frameTime):16;motion.frameTime=time;
        const target=Math.log(motion.target),before=Math.log(motion.value);
        const direct=motion.source==='pinch'&&!motion.settled;
        const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
        const next=direct||reduce?target:before+(target-before)*(1-Math.exp(-dt/(motion.settled?52:32)));
        const done=Math.abs(target-next)<.0004;
        motion.value=Math.exp(done?target:next);applyZoom(motion.value,motion.anchor);
        if(!done){zoomFrame=requestAnimationFrame(drawZoom);return;}
        if(motion.settled){$('pictureStage').classList.remove('zooming');if(motion.stop?.key==='whole')setReader('whole');}
    }
    function queueZoomFrame() { if(!zoomFrame)zoomFrame=requestAnimationFrame(drawZoom); }
    function settleZoom() {
        const motion=zoomMotion;if(!motion||motion.id!==readerVersion)return;
        motion.settled=true;
        // A gentle settle after input stops, rather than a sticky plateau under the fingers.
        const stop=zoomStops().filter(stop=>Math.abs(Math.log(motion.raw/stop.value))<.065)
            .sort((a,b)=>Math.abs(Math.log(motion.raw/a.value))-Math.abs(Math.log(motion.raw/b.value)))[0];
        motion.stop=stop||null;motion.target=stop?stop.value:motion.raw;
        if(stop){$('zoomSnapHint').textContent=stop.label;$('zoomSnapHint').hidden=false;clearTimeout(zoomSnapTimer);zoomSnapTimer=setTimeout(()=>{$('zoomSnapHint').hidden=true;},1200);}
        queueZoomFrame();
    }
    function zoomPicture(factor,x,y,source='wheel',destination={x,y}) {
        const stage=$('pictureStage'),before=imageBounds();
        if(!before.width||!before.height||!Number.isFinite(before.width))return;
        const baseline=before.width/stage.clientWidth*100;
        const anchor={u:Math.max(0,Math.min(1,(x-before.left)/before.width)),v:Math.max(0,Math.min(1,(y-before.top)/before.height)),x:destination.x,y:destination.y};
        const now=performance.now();
        if(!zoomMotion||zoomMotion.id!==readerVersion||zoomMotion.source!==source||zoomMotion.settled||now-zoomMotion.time>300){
            cancelAnimationFrame(zoomFrame);zoomFrame=0;
            zoomMotion={id:readerVersion,source,raw:baseline,target:baseline,value:baseline,anchor,time:now,frameTime:0,settled:false};
        } else if(source==='pinch') {zoomMotion.anchor.x=destination.x;zoomMotion.anchor.y=destination.y;}
        else zoomMotion.anchor=anchor;
        const stops=zoomStops();
        zoomMotion.raw=Math.max(Math.min(10,stops[0].value),Math.min(Math.max(600,stops[2].value),zoomMotion.raw*factor));
        zoomMotion.target=zoomMotion.raw;zoomMotion.time=now;
        $('zoomSnapHint').hidden=true;stage.classList.add('zooming');clearTimeout(zoomIdleTimer);queueZoomFrame();
        if(source!=='pinch')zoomIdleTimer=setTimeout(settleZoom,source==='button'?0:120);
    }
    const imagePointers=new Map();
    let imageGesture=null, swipePreview=null;
    const imageStage=$('pictureStage');
    function resetSwipe() {
        if (!swipePreview) return;
        swipePreview.animation?.cancel(); swipePreview.layer.remove();
        swipePreview.figure.style.visibility=swipePreview.visibility;
        swipePreview=null;
    }
    function moveSwipe(dx) {
        if (!swipePreview) {
            const bounds=imageStage.getBoundingClientRect(), picture=$('pictureA'), rect=picture.getBoundingClientRect();
            const figure=picture.closest('figure'), style=getComputedStyle(picture);
            const layer=document.createElement('div'); layer.className='swipe-preview'; layer.setAttribute('aria-hidden','true');
            const host=imageStage.parentElement.getBoundingClientRect();
            Object.assign(layer.style,{left:`${bounds.left-host.left}px`,top:`${bounds.top-host.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});
            const track=document.createElement('div'); track.className='swipe-track';layer.append(track);
            const copy=document.createElement('img');copy.src=picture.currentSrc||picture.src;
            Object.assign(copy.style,{left:`${rect.left-bounds.left}px`,top:`${rect.top-bounds.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,padding:style.padding,objectFit:style.objectFit});
            track.append(copy);
            const neighbors=viewerNeighbors();
            for (const [side,item] of [[-1,neighbors.previous],[1,neighbors.next]]) {
                if (!item?.cover_id) continue;
                const image=document.createElement('img'); image.className='swipe-neighbor';
                image.src=`/api/gallery/versions/${encodeURIComponent(item.cover_id)}/thumbnail`;
                Object.assign(image.style,{left:`${side*(bounds.width+16)}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});track.append(image);
            }
            swipePreview={layer,track,figure,visibility:figure.style.visibility,width:bounds.width,neighbors,id:current.id};
            imageStage.parentElement.append(layer);figure.style.visibility='hidden';
        }
        const neighbor=dx<0?swipePreview.neighbors.next:swipePreview.neighbors.previous;
        swipePreview.dx=neighbor?dx:dx*.22;
        swipePreview.track.style.transform=`translate3d(${swipePreview.dx}px,0,0)`;
    }
    async function finishSwipe(commit) {
        const preview=swipePreview;if(!preview)return;
        preview.settling=true;
        const next=preview.dx<0?preview.neighbors.next:preview.neighbors.previous;
        const target=commit&&next ? (preview.dx<0?-1:1)*(preview.width+16) : 0;
        const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:220;
        preview.animation=preview.track.animate([{transform:`translate3d(${preview.dx}px,0,0)`},{transform:`translate3d(${target}px,0,0)`}],{duration,easing:'cubic-bezier(.22,.7,.25,1)',fill:'forwards'});
        try {
            await preview.animation.finished;
            if (swipePreview!==preview || !$('detailDialog').open || current.id!==preview.id) return;
            if (commit&&next) await openDetail(next.id);
        } catch (error) { if(error.name!=='AbortError')toast(error.message); }
        finally { if(swipePreview===preview)resetSwipe(); }
    }
    function gesturePair() {
        const [a,b]=[...imagePointers.values()];
        return b ? {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)} : null;
    }
    imageStage.addEventListener('wheel',event=>{
        if ($('viewMode').value!=='single' || event.shiftKey) return;
        event.preventDefault();resetSwipe();
        const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?imageStage.clientHeight:1);
        zoomPicture(Math.exp(Math.max(-.7,Math.min(.7,-delta*.002))),event.clientX,event.clientY);
    },{passive:false});
    imageStage.addEventListener('pointerdown',event=>{
        if ($('viewMode').value!=='single' || swipePreview?.settling || (event.pointerType==='mouse'&&event.button!==0)) return;
        event.preventDefault();imageStage.focus({preventScroll:true});
        imagePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(imagePointers.size===1) {clearZoomSnap();imageGesture={x:event.clientX,y:event.clientY,lastX:event.clientX,lastTime:performance.now(),velocity:0,touch:event.pointerType==='touch',canSwipe:imageStage.scrollWidth<=imageStage.clientWidth+4,pinched:false,axis:''};}
        if(imagePointers.size>1) {imageGesture.pinched=true;resetSwipe();clearZoomSnap();}
        imageStage.setPointerCapture(event.pointerId);imageStage.classList.add('dragging');
    });
    imageStage.addEventListener('pointermove',event=>{
        const previous=imagePointers.get(event.pointerId);if(!previous)return;
        event.preventDefault();const before=gesturePair();
        imagePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const after=gesturePair(),gesture=imageGesture;
        if(before&&after&&before.distance>4){zoomPicture(after.distance/before.distance,before.x,before.y,'pinch',after);}
        else if(gesture&&!gesture.pinched){
            const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y,now=performance.now();
            gesture.velocity=(event.clientX-gesture.lastX)/Math.max(1,now-gesture.lastTime);gesture.lastX=event.clientX;gesture.lastTime=now;
            if(gesture.touch&&gesture.canSwipe&&!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)gesture.axis=Math.abs(dx)>Math.abs(dy)*1.25?'swipe':'pan';
            if(gesture.axis==='swipe')moveSwipe(dx);
            else {imageStage.scrollLeft-=event.clientX-previous.x;imageStage.scrollTop-=event.clientY-previous.y;}
        }
    });
    function endImagePointer(event) {
        if(!imagePointers.has(event.pointerId))return;
        const gesture=imageGesture;
        imagePointers.delete(event.pointerId);
        if(gesture?.pinched&&imagePointers.size<2)settleZoom();
        if(imagePointers.size)return;
        imageStage.classList.remove('dragging');imageGesture=null;
        if(swipePreview&&!swipePreview.settling){
            const dx=event.clientX-(gesture?.x||0);
            const fast=gesture&&performance.now()-gesture.lastTime<100&&Math.abs(gesture.velocity)>.5&&Math.sign(gesture.velocity)===Math.sign(dx);
            void finishSwipe(event.type==='pointerup'&&!gesture?.pinched&&(Math.abs(dx)>Math.min(120,imageStage.clientWidth*.22)||(Math.abs(dx)>28&&fast)));
        }
        if(imageStage.hasPointerCapture(event.pointerId))imageStage.releasePointerCapture(event.pointerId);
    }
    imageStage.addEventListener('pointerup',endImagePointer);imageStage.addEventListener('pointercancel',endImagePointer);
    imageStage.addEventListener('lostpointercapture',event=>{if(!imagePointers.delete(event.pointerId))return;if(!imagePointers.size){imageGesture=null;imageStage.classList.remove('dragging');if(swipePreview&&!swipePreview.settling)void finishSwipe(false);}});
    $('pictureA').addEventListener('dragstart',event=>event.preventDefault());
    $('detailDialog').addEventListener('close',()=>{imagePointers.clear();imageGesture=null;resetSwipe();clearZoomSnap();imageStage.classList.remove('dragging');});
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
        $('metaAlbum').innerHTML = albumOptions(current.album_id);
        $('albumReader').hidden = !current.album_id; $('openCurrentAlbum').textContent = `▣ ${current.album_name || albumName(current.album_id)}`;
        $('albumPrevious').disabled = !current.album_previous; $('albumNext').disabled = !current.album_next;
        $('favorite').textContent = current.favorite ? t('★ 已收藏', '★ Favorited') : t('☆ 收藏', '☆ Favorite');
        $('archive').textContent = current.archived ? t('恢复到图库', 'Restore to library') : t('归档这件收藏', 'Archive collection');
        $('addVersion').disabled = current.archived || !!current.deleted_at; $('archive').hidden = !canWrite || !!current.deleted_at;
        renderVersionOptions(); renderPicture(); permissions();
    }
    function renderPicture() {
        const a = activeVersion(), b = current.versions.find(v => v.id === $('versionB').value);
        if (!a) return;
        const mode = $('viewMode').value, compare = mode !== 'single';
        renderReader(a, compare); $('captionA').textContent = `${versionLabel(a)} · ${a.width} × ${a.height}${a.source === 'builtin-example' ? t(' · 内置示例 · 原图需联网', ' · Example · Original requires internet') : ''}`;
        if (b) { $('pictureB').src = b.previewUrl; $('captionB').textContent = versionLabel(b); }
        $('figureB').hidden = $('versionB').hidden = $('versus').hidden = $('compareHint').hidden = !compare;
        $('opacityControl').hidden = mode !== 'overlay'; $('pictureStage').classList.toggle('overlay', mode === 'overlay');
        $('figureB').style.opacity = mode === 'overlay' ? $('opacity').value / 100 : '';
        $('downloadOriginal').href = a.originalUrl; $('downloadPreview').href = a.previewUrl + '?download=1';
        $('downloadOriginal').textContent = '↓'; $('downloadOriginal').title = $('downloadOriginal').ariaLabel = t('下载原图', 'Download original') + ` · ${byteSize(a.original_bytes)}`;
        $('downloadPreview').textContent = t('下载压缩图', 'Compressed') + ` · ${byteSize(a.preview_bytes)}`;
        $('versionList').innerHTML = current.versions.map(v => `<button class="version-button ${v.id === a.id ? 'active' : ''}" data-version="${escape(v.id)}"><img src="${escape(v.thumbnailUrl)}" data-reading-preview="${escape(v.previewUrl)}" alt=""><span>${escape(versionLabel(v))}</span><small>${date(v.created_at)}</small></button>`).join('');
        const analysis = a.analysis || {}, ready = a.ai_status === 'ready';
        $('aiState').textContent = ready ? t('已识别', 'Indexed') : a.ai_status === 'failed' ? t('可重试', 'Retry available') : t('未识别', 'Not indexed');
        $('aiSummary').textContent = analysis.summary || t('手动填写分类、标签和备注，也能快速找到这张图。', 'Add categories, tags and notes to find this picture quickly.');
        $('aiSuggestions').innerHTML = (analysis.tags || []).map(tag => `<span class="tag">${escape(tag)}</span>`).join('');
        $('recognizedText').textContent = analysis.text || t('暂无识别文字', 'No recognized text');
        $('applyAi').hidden = !canWrite || !ready || !!current.deleted_at; $('analyze').disabled = aiBusy || !!current.deleted_at;
        if (ready) $('detailAiMode').value = a.ai_mode;
        renderViewerChrome();
    }
    async function openDetail(id) {
        const request = ++detailRequest;
        const loaded = await api('/items/' + id); if (request !== detailRequest) return;
        if (!$('detailDialog').open) {
            viewerItems = result.items.slice();
            $('detailDialog').classList.remove('with-info'); $('toggleInfo').setAttribute('aria-expanded','false');
            $('viewerFilmstrip').hidden = false; $('toggleFilmstrip').setAttribute('aria-pressed','true'); $('filmstripMode').value = 'pictures';
        }
        if (!viewerItems.some(item=>item.id===loaded.id)) viewerItems.unshift({id:loaded.id,title:loaded.title,cover_id:loaded.versions[0]?.id});
        $('viewerAdvanced').hidden = true;
        resetSwipe(); current = loaded; $('viewMode').value = 'single'; $('versionA').innerHTML = $('versionB').innerHTML = ''; $('aiConfirm').checked = false;
        if (!$('detailDialog').open) $('detailDialog').showModal(); fillDetail(); notifyViewer(true);
    }
    async function saveMeta(event) {
        event.preventDefault(); if (!current || !canWrite) return;
        current = await api('/items/' + current.id, 'PATCH', { revision: current.revision, title: $('metaTitle').value, scope: $('metaScope').value, category_id: $('metaCategory').value, album_id:$('metaAlbum').value, tags: $('metaTags').value, note: $('metaNote').value });
        await refreshAlbums(); fillDetail(); loadList(); toast(t('已保存', 'Saved'));
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
            if (current?.id === itemId) { current = data.item; $('versionA').innerHTML = ''; fillDetail(); }
            await refreshAlbums(); loadList();
            toast(t('已按 AI 整理，手动填写的内容已保留','AI organization applied. Manual entries were preserved.'));
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
    $('grid').addEventListener('click', guarded(async event => {
        const albumButton = event.target.closest('[data-album]'); if (albumButton) return openAlbum(albumButton.dataset.album);
        if (event.target.closest('[data-select]')) return;
        const favorite = event.target.closest('[data-favorite]'); if (favorite) return toggleFavorite(favorite.dataset.favorite);
        const button = event.target.closest('[data-open]');
        if (button) { if (selectionMode) selectItem(button.dataset.open,!selectedItems.has(button.dataset.open)); else await openDetail(button.dataset.open); }
    }));
    $('grid').addEventListener('change', event => { if (event.target.matches('[data-select]')) selectItem(event.target.dataset.select,event.target.checked); });
    $('albumGrid').addEventListener('load',topPreview,true);
    $('albumGrid').onclick = event => { const button = event.target.closest('[data-album]'); if (button) openAlbum(button.dataset.album); };
    $('selectPictures').onclick = () => { selectionMode = !selectionMode; selectedItems.clear(); renderList(); };
    $('batchAlbum').onchange = renderSelection; $('assignAlbum').onclick = guarded(assignSelected);
    $('deleteSelected').onclick = () => proposeDeletion(Array.from(selectedItems,([id,revision])=>({id,revision})));
    $('restoreSelected').onclick = guarded(() => restorePictures(Array.from(selectedItems,([id,revision])=>({id,revision}))));
    $('deleteDetail').onclick = () => proposeDeletion([{id:current.id,revision:current.revision}]);
    $('restoreDetail').onclick = guarded(() => restorePictures([{id:current.id,revision:current.revision}]));
    $('deleteForm').addEventListener('submit',guarded(deletePictures));
    $('addAlbum').onclick = () => newAlbum(); $('batchNewAlbum').onclick = () => newAlbum('batchAlbum');
    $('uploadNewAlbum').onclick = () => newAlbum('uploadAlbum'); $('detailNewAlbum').onclick = () => newAlbum('metaAlbum');
    $('albumForm').addEventListener('submit',guarded(createAlbum)); $('backToAlbums').onclick = () => navigate('albums');
    $('albumPrevious').onclick = guarded(() => current.album_previous && openDetail(current.album_previous.id));
    $('albumNext').onclick = guarded(() => current.album_next && openDetail(current.album_next.id));
    $('openCurrentAlbum').onclick = () => { const id = current.album_id; $('detailDialog').close(); openAlbum(id); };
    $('grid').addEventListener('load', topPreview, true); $('versionList').addEventListener('load', topPreview, true);
    $('fitWidth').onclick = () => {clearZoomSnap();setReader('width');}; $('fitWhole').onclick = () => {clearZoomSnap();setReader('whole');};
    const buttonZoom = factor => {clearZoomSnap();resetSwipe();const r=imageStage.getBoundingClientRect();zoomPicture(factor,r.left+r.width/2,r.top+r.height/2,'button');};
    $('zoomIn').onclick = () => buttonZoom(1.25); $('zoomOut').onclick = () => buttonZoom(.8);
    $('detailDialog').addEventListener('close', () => { releaseOriginal(); readerVersion = ''; $('pictureA').removeAttribute('src'); notifyViewer(false); });
    $('toggleInfo').onclick = () => setInfo(!$('detailDialog').classList.contains('with-info')); $('closeInfo').onclick = () => setInfo(false);
    $('viewerPrevious').onclick = guarded(() => {const item=viewerNeighbors().previous;if(item)return openDetail(item.id);});
    $('viewerNext').onclick = guarded(() => {const item=viewerNeighbors().next;if(item)return openDetail(item.id);});
    $('pictureFilmstrip').addEventListener('load',topPreview,true);
    $('pictureFilmstrip').onclick = guarded(async event => {const button=event.target.closest('[data-picture]');if(button)await openDetail(button.dataset.picture);});
    $('filmstripMode').onchange = renderViewerChrome;
    $('toggleFilmstrip').onclick = () => { $('viewerFilmstrip').hidden = !$('viewerFilmstrip').hidden; $('toggleFilmstrip').setAttribute('aria-pressed',String(!$('viewerFilmstrip').hidden)); renderViewerChrome(); };
    $('toggleCompare').onclick = () => { $('viewerAdvanced').hidden = !$('viewerAdvanced').hidden; if ($('viewerAdvanced').hidden) $('viewMode').value='single'; renderPicture(); };
    $('uploadButton').onclick = $('emptyUpload').onclick = () => openUpload();
    $('files').onchange = () => chooseFiles($('files').files);
    $('uploadTarget').onchange = () => { $('seriesTitleField').hidden = !['new-series','new-album'].includes($('uploadTarget').value); };
    const manualInputs = {uploadTitle:'title',uploadScope:'scope',uploadCategory:'category_id',uploadAlbum:'album_id',uploadTags:'tags',uploadNote:'note',uploadLabel:'version_label',uploadTarget:'storage'};
    for (const [id,field] of Object.entries(manualInputs)) $(id).addEventListener('change',()=>{
        if ((['uploadScope','uploadTarget'].includes(id) && $(id).value === 'auto') || (id === 'uploadTitle' && !$(id).value.trim())) uploadManual.delete(field);
        else uploadManual.add(field);
    });
    $('uploadForm').addEventListener('submit', guarded(startUpload));
    $('uploadDialog').addEventListener('cancel', event => { if (uploading) event.preventDefault(); });
    document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => { if (button.dataset.close === 'uploadDialog' && uploading) return; $(button.dataset.close).close(); }; });
    $('viewMode').onchange = $('versionA').onchange = $('versionB').onchange = $('opacity').oninput = () => { $('aiConfirm').checked = false; renderPicture(); };
    $('versionList').onclick = event => { const button = event.target.closest('[data-version]'); if (button) { $('versionA').value = button.dataset.version; $('aiConfirm').checked = false; renderPicture(); } };
    $('metaForm').addEventListener('submit', guarded(saveMeta));
    $('favorite').onclick = guarded(() => toggleFavorite(current.id));
    $('addVersion').onclick = () => openUpload(null, current);
    $('archive').onclick = guarded(async () => { current = await api('/items/' + current.id, 'PATCH', { revision: current.revision, archived: !current.archived }); $('detailDialog').close(); await refreshAlbums(); loadList(); toast(current.archived ? t('已归档，可在“已归档”中恢复', 'Archived. Restore it from Archived anytime.') : t('已恢复到图库', 'Restored to library')); });
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
    document.addEventListener('keydown', event => {
        if (!$('detailDialog').open || Array.from(document.querySelectorAll('dialog[open]')).at(-1) !== $('detailDialog') || event.target.matches('input,textarea,select') || event.ctrlKey || event.metaKey || event.altKey) return;
        if (['ArrowLeft','PageUp'].includes(event.key) && !$('viewerPrevious').disabled) {event.preventDefault();$('viewerPrevious').click();}
        if (['ArrowRight','PageDown'].includes(event.key) && !$('viewerNext').disabled) {event.preventDefault();$('viewerNext').click();}
        if (event.key==='Escape') {event.preventDefault();$('detailDialog').close();}
    });
    window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.type==='tools-platform-escape'&&$('detailDialog').open&&!document.querySelector('dialog[open]:not(#detailDialog)'))$('detailDialog').close();});
    window.addEventListener('pagehide',()=>notifyViewer(false));
    document.addEventListener('dragenter', event => { if (canWrite && !uploading && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('dropzone').hidden = false; } });
    document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
    document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').hidden = true; } });
    document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('dropzone').hidden = true; if (!canWrite || uploading) return; if ($('uploadDialog').open) chooseFiles(event.dataTransfer.files); else openUpload(event.dataTransfer.files, $('detailDialog').open ? current : null); });
    document.addEventListener('paste', event => { if (!canWrite || uploading || event.target.matches('input,textarea')) return; const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); if ($('uploadDialog').open) chooseFiles(files); else openUpload(files, $('detailDialog').open ? current : null); } });
    window.addEventListener('beforeunload', event => { if (uploading) { event.preventDefault(); event.returnValue = ''; } });
    applyTheme(); translate(); permissions(); notifyViewer(false);
    (async () => { try { const [permissionsResult, categoryResult, albumResult] = await Promise.all([api('/capabilities'), api('/categories'), api('/albums')]); canWrite = permissionsResult.canWrite; categories = categoryResult; albums = albumResult; renderCategories(); permissions(); await loadList(); } catch (error) { $('error').textContent = error.message; $('error').hidden = false; } })();
})();
