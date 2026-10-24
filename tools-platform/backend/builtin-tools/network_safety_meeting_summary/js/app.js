// js/app.js
import * as store from './store.js?v=20260623-1';
import * as editor from './editor.js?v=20261022-1';
import { createComponentEditor } from './component-editor.js?v=20261022-1';
import { initContextMenu } from './context-menu.js?v=20260623-1';
import { defaultSlides } from './default-slides.js?v=20261007-1';
import { renderSlide, slideToJson } from './slide-factory.js?v=20261022-1';
import { initProjectWorkspace } from './project-workspace.js?v=20261006-2';

import { createVisionSlide, refreshVisionAssetUrls } from './vision-template.js?v=20261007-1';

const deck = document.getElementById('deck');
const deckWrapper = document.getElementById('deckWrapper');
const thumbDeck = document.getElementById('thumbDeck');
const sidebar = document.getElementById('sidebar');
const aiSidebar = document.getElementById('aiSidebar');

function updateThumbScale() {
    if (!sidebar || !thumbDeck) return;
    const item = thumbDeck.querySelector('.thumb-item');
    const num = item?.querySelector('.thumb-num');
    const shell = item?.querySelector('.thumb-shell');
    if (!item || !num || !shell || item.clientWidth === 0) return;

    const itemStyle = getComputedStyle(item);
    const shellStyle = getComputedStyle(shell);
    const availableWidth = item.clientWidth
        - parseFloat(itemStyle.paddingLeft)
        - parseFloat(itemStyle.paddingRight)
        - parseFloat(itemStyle.gap || '0')
        - num.getBoundingClientRect().width
        - parseFloat(shellStyle.borderLeftWidth)
        - parseFloat(shellStyle.borderRightWidth);
    const scale = Math.max(0.01, availableWidth / 1920);
    document.documentElement.style.setProperty('--thumb-scale', scale);
}
const mainZoomLabel = document.getElementById('mainZoomLabel');
const statusText = document.getElementById('statusText');

let activeSlideIndex = store.getActiveSlideIndex();
let saveTimer = null;
let thumbTimer = null;
let currentEditorScale = 1.0;
let componentEditor = null;
let thumbnailKeyboardFocus = false;
let slideClipboard = null;
let canvasPanX = 0;
let canvasPanY = 0;
let canvasPanState = null;
let selectedSlideIndices = new Set();
let projectWorkspace = null;

function applyCanvasPan() {
    deck.style.translate = `${canvasPanX}px ${canvasPanY}px`;
    componentEditor?.refreshControls();
}

function resetCanvasPan() {
    canvasPanX = 0;
    canvasPanY = 0;
    applyCanvasPan();
}

function initCanvasPan() {
    deckWrapper.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target !== deckWrapper) return;
        if (document.body.classList.contains('presentation-mode')) return;

        canvasPanState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            panX: canvasPanX,
            panY: canvasPanY
        };
        deckWrapper.classList.add('is-panning');
        deckWrapper.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    deckWrapper.addEventListener('pointermove', event => {
        if (!canvasPanState || event.pointerId !== canvasPanState.pointerId) return;
        canvasPanX = canvasPanState.panX + event.clientX - canvasPanState.startX;
        canvasPanY = canvasPanState.panY + event.clientY - canvasPanState.startY;
        applyCanvasPan();
    });

    const finishCanvasPan = event => {
        if (!canvasPanState || event.pointerId !== canvasPanState.pointerId) return;
        if (deckWrapper.hasPointerCapture(event.pointerId)) {
            deckWrapper.releasePointerCapture(event.pointerId);
        }
        canvasPanState = null;
        deckWrapper.classList.remove('is-panning');
        componentEditor?.refreshControls();
    };

    deckWrapper.addEventListener('pointerup', finishCanvasPan);
    deckWrapper.addEventListener('pointercancel', finishCanvasPan);
}

function initWheelZoom() {
    deckWrapper.addEventListener('wheel', event => {
        if (!event.ctrlKey && !event.metaKey) return;
        if (document.body.classList.contains('presentation-mode')) return;

        event.preventDefault();
        const previousScale = currentEditorScale;
        const scaleStep = event.deltaY < 0 ? 0.1 : -0.1;
        const nextScale = Math.max(0.5, Math.min(3, Math.round((previousScale + scaleStep) * 10) / 10));
        if (nextScale === previousScale) return;

        const deckRect = deck.getBoundingClientRect();
        const pointerX = event.clientX - deckRect.left;
        const pointerY = event.clientY - deckRect.top;
        const ratio = nextScale / previousScale;

        canvasPanX += pointerX * (1 - ratio);
        canvasPanY += pointerY * (1 - ratio);
        applyEditorZoom(nextScale);
        applyCanvasPan();
    }, { passive: false });
}

// --- History Stack ---
let historyStack = [];
let historyIndex = -1;
const maxHistory = 50;

function pushHistory(html) {
    if (historyIndex >= 0 && historyStack[historyIndex] === html) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(html);
    if (historyStack.length > maxHistory) historyStack.shift();
    historyIndex = historyStack.length - 1;
    updateUndoRedoBtns();
}

function updateUndoRedoBtns() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        deck.innerHTML = historyStack[historyIndex];
        renumberSlides();
        componentEditor?.refresh();
        setActiveSlide(activeSlideIndex);
        store.saveState(deck.innerHTML);
        updateUndoRedoBtns();
    }
}

function redo() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        deck.innerHTML = historyStack[historyIndex];
        renumberSlides();
        componentEditor?.refresh();
        setActiveSlide(activeSlideIndex);
        store.saveState(deck.innerHTML);
        updateUndoRedoBtns();
    }
}

function setStatus(text) {
    statusText.textContent = text;
}

function getSlideWraps() {
    return Array.from(deck.querySelectorAll('.slide-wrap')).filter(wrap => wrap.querySelector('.slide'));
}

function renumberSlides() {
    getSlideWraps().forEach((wrap, index) => {
        const num = wrap.querySelector('.slide-num');
        if (num) num.textContent = String(index + 1);
    });
}

function renderThumbnails() {
    const wraps = getSlideWraps();
    thumbDeck.innerHTML = '';
    wraps.forEach((wrap, index) => {
        const item = document.createElement('div');
        const isActive = index === activeSlideIndex || selectedSlideIndices.has(index);
        item.className = `thumb-item ${isActive ? 'active' : ''}`;
        
        const numSpan = document.createElement('span');
        numSpan.className = 'thumb-num';
        numSpan.textContent = String(index + 1);
        
        const shell = document.createElement('div');
        shell.className = 'thumb-shell';
        
        const slide = wrap.querySelector('.slide');
        if (!slide) return;
        shell.appendChild(editor.scrubClone(slide.cloneNode(true)));
        
        item.appendChild(numSpan);
        item.appendChild(shell);
        
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `第 ${index + 1} 页`);
        item.addEventListener('click', (event) => {
            thumbnailKeyboardFocus = true;
            if (event.shiftKey && selectedSlideIndices.size > 0) {
                const lastActive = activeSlideIndex;
                const min = Math.min(lastActive, index);
                const max = Math.max(lastActive, index);
                selectedSlideIndices.clear();
                for (let i = min; i <= max; i++) selectedSlideIndices.add(i);
                activeSlideIndex = index;
                renderThumbnails();
            } else if (event.metaKey || event.ctrlKey) {
                if (selectedSlideIndices.has(index)) {
                    selectedSlideIndices.delete(index);
                    if (selectedSlideIndices.size === 0) selectedSlideIndices.add(index);
                } else {
                    selectedSlideIndices.add(index);
                }
                activeSlideIndex = index;
                renderThumbnails();
            } else {
                setActiveSlide(index);
            }
            thumbDeck.querySelector('.thumb-item.active')?.focus({ preventScroll: true });
        });
        thumbDeck.appendChild(item);
    });

    updateThumbScale();

    if (window.Sortable && !thumbDeck.sortableInst) {
        thumbDeck.sortableInst = Sortable.create(thumbDeck, {
            animation: 150,
            onEnd: function (evt) {
                if (evt.oldIndex === evt.newIndex) return;
                const slides = getSlideWraps();
                const movedSlide = slides[evt.oldIndex];
                if (evt.newIndex >= slides.length) {
                    deck.appendChild(movedSlide);
                } else if (evt.newIndex < evt.oldIndex) {
                    deck.insertBefore(movedSlide, slides[evt.newIndex]);
                } else {
                    deck.insertBefore(movedSlide, slides[evt.newIndex].nextSibling);
                }
                
                if (activeSlideIndex === evt.oldIndex) {
                    activeSlideIndex = evt.newIndex;
                } else if (activeSlideIndex > evt.oldIndex && activeSlideIndex <= evt.newIndex) {
                    activeSlideIndex--;
                } else if (activeSlideIndex < evt.oldIndex && activeSlideIndex >= evt.newIndex) {
                    activeSlideIndex++;
                }
                renumberSlides();
                setActiveSlide(activeSlideIndex);
                saveDeck();
            }
        });
    }
}

function scheduleThumbnails() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(renderThumbnails, 300);
}

function setActiveSlide(index) {
    const wraps = getSlideWraps();
    if (!wraps.length) return;
    componentEditor?.clearSelection();
    window.getSelection()?.removeAllRanges();
    activeSlideIndex = Math.max(0, Math.min(index, wraps.length - 1));
    selectedSlideIndices.clear();
    selectedSlideIndices.add(activeSlideIndex);
    wraps.forEach((wrap, i) => wrap.classList.toggle('is-active', i === activeSlideIndex));
    store.saveActiveSlideIndex(activeSlideIndex);
    renderThumbnails();
    componentEditor?.refreshLayers();
    updatePresentationPageLabel();
    if (document.body.classList.contains('presentation-mode')) clearPresentationInk();
}

function saveDeck() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const html = editor.serializeDeck(deck);
        store.saveState(html);
        pushHistory(html);
        setStatus('已自动保存');
        projectWorkspace?.scheduleAutoSave();
    }, 500);
}

function loadProjectDeck(html, requestedActiveSlide = 0) {
    componentEditor?.clearSelection();
    deck.innerHTML = String(html || '');
    refreshVisionAssetUrls(deck);
    deck.querySelectorAll('.slide-wrap').forEach(wrap => {
        if (!wrap.querySelector('.slide')) wrap.remove();
    });
    if (!getSlideWraps().length) {
        deck.appendChild(renderSlide(createVisionSlide()));
    }
    activeSlideIndex = Math.max(0, Math.min(Number(requestedActiveSlide || 0), getSlideWraps().length - 1));
    renumberSlides();
    componentEditor?.refresh();
    setActiveSlide(activeSlideIndex);
    pushHistory(editor.serializeDeck(deck));
    scheduleThumbnails();
    setTimeout(() => document.getElementById('zoomFitBtn')?.click(), 80);
    setTimeout(upgradeLegacyImportedSlides, 120);
}

function escapeImportedText(value) {
    return String(value || '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
}

function authorizedHeaders() {
    const token = localStorage.getItem('tools_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('读取页面预览失败'));
        reader.readAsDataURL(blob);
    });
}

async function loadAssetPreviewDataUrl(asset) {
    if (!asset?.thumbnailUrl) throw new Error('该素材还没有可用的页面预览');
    const response = await fetch(asset.thumbnailUrl, { headers: authorizedHeaders() });
    if (!response.ok) throw new Error(`读取原始页面失败（HTTP ${response.status}）`);
    return blobToDataUrl(await response.blob());
}

function originalPageHtml(asset, previewDataUrl) {
    return `<div class="ppt-original-page" data-material-id="${escapeImportedText(asset.id)}" data-source-file="${escapeImportedText(asset.fileName || '')}">
        <img class="ppt-original-page-image ppt-locked" data-ppt-lock-set="true" data-component-name="原始 PPT 页面（保真底图）"
             src="${previewDataUrl}" alt="${escapeImportedText(asset.summary || `PPT 第 ${asset.pageNumber || 1} 页`)}" draggable="false">
    </div>`;
}

async function insertLibraryAsset(asset) {
    setStatus('正在读取原始 PPT 页面…');
    const previewDataUrl = await loadAssetPreviewDataUrl(asset);
    const slide = renderSlide({
        id: asset.id,
        layout: 'custom',
        html: originalPageHtml(asset, previewDataUrl)
    });
    deck.appendChild(slide);
    renumberSlides();
    componentEditor?.refresh();
    setActiveSlide(getSlideWraps().length - 1);
    saveDeck();
    scheduleThumbnails();
    setStatus(`已保真插入原始页面：${asset.tag || `第 ${asset.pageNumber || 1} 页`}`);
}

async function upgradeLegacyImportedSlides() {
    const legacySlides = Array.from(deck.querySelectorAll('.imported-material-slide[data-material-id]'));
    if (!legacySlides.length) return;
    let upgraded = 0;
    for (const legacy of legacySlides) {
        try {
            const id = legacy.dataset.materialId;
            const assetResponse = await fetch(`/api/slide-design/assets/${encodeURIComponent(id)}`, { headers: authorizedHeaders() });
            if (!assetResponse.ok) continue;
            const { asset } = await assetResponse.json();
            const previewDataUrl = await loadAssetPreviewDataUrl(asset);
            legacy.outerHTML = originalPageHtml(asset, previewDataUrl);
            upgraded += 1;
        } catch (error) {
            console.warn('[slide-design] legacy page upgrade skipped:', error);
        }
    }
    if (upgraded) {
        componentEditor?.refresh();
        saveDeck();
        scheduleThumbnails();
        setStatus(`已将 ${upgraded} 页旧素材升级为原稿保真页面`);
    }
}

function createDefaultProjectDeckHtml() {
    const host = document.createElement('div');
    defaultSlides.forEach((data, index) => {
        const slide = renderSlide(data);
        if (index === 0) slide.classList.add('is-active');
        host.appendChild(slide);
    });
    return host.innerHTML;
}

function deleteActiveSlide() {
    const wraps = getSlideWraps();
    if (wraps.length <= 1) {
        setStatus('最后一页无法删除');
        return false;
    }
    const toDelete = Array.from(selectedSlideIndices).sort((a, b) => b - a);
    if (toDelete.length >= wraps.length) {
        setStatus('不能删除所有页');
        return false;
    }
    toDelete.forEach(idx => {
        if (wraps[idx]) wraps[idx].remove();
    });
    
    renumberSlides();
    const minDeleted = Math.min(...toDelete);
    setActiveSlide(Math.min(minDeleted, getSlideWraps().length - 1));
    
    if (thumbnailKeyboardFocus) {
        thumbDeck.querySelector('.thumb-item.active')?.focus({ preventScroll: true });
    }
    saveDeck();
    return true;
}

function applyEditorZoom(scale) {
    currentEditorScale = scale;
    document.documentElement.style.setProperty('--editor-scale', String(scale));
    mainZoomLabel.textContent = `${Math.round(scale * 100)}%`;
    componentEditor?.refreshControls();
}

function bootstrap() {
    const savedHtml = store.loadState();
    if (savedHtml) {
        deck.innerHTML = savedHtml;
    } else {
        const customTemplate = localStorage.getItem('ppt_custom_default_template_v5');
        deck.innerHTML = '';
        if (customTemplate) {
            deck.innerHTML = customTemplate;
        } else {
            defaultSlides.forEach((data, i) => {
                const slide = renderSlide(data);
                if (i === 0) slide.classList.add('is-active');
                deck.appendChild(slide);
            });
        }
    }
    refreshVisionAssetUrls(deck);
    deck.querySelectorAll('.slide-wrap').forEach(wrap => {
        if (!wrap.querySelector('.slide')) wrap.remove();
    });
    componentEditor?.refresh();
    pushHistory(editor.serializeDeck(deck));
    
    renumberSlides();
    setActiveSlide(activeSlideIndex);
    updateThumbScale();
    
    setTimeout(() => {
        document.getElementById('zoomFitBtn')?.click();
    }, 100);
    setTimeout(upgradeLegacyImportedSlides, 140);
}

// Event Listeners
deck.addEventListener('input', () => {
    setStatus('正在保存...');
    saveDeck();
    scheduleThumbnails();
});

deck.addEventListener('paste', event => {
    const items = Array.from(event.clipboardData && event.clipboardData.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return;
    const target = event.target.closest('.qr, .slide-pad, .slide');
    if (!target) return;
    event.preventDefault();
    const file = imageItem.getAsFile();
    const reader = new FileReader();
    reader.onload = () => {
        if (event.target.closest('.qr')) {
            const qr = event.target.closest('.qr').querySelector('.qr-box');
            qr.style.background = `url("${reader.result}") center / cover no-repeat`;
            qr.innerHTML = '';
        } else {
            const img = document.createElement('img');
            img.src = reader.result;
            img.style.maxWidth = '180px';
            img.style.maxHeight = '120px';
            img.style.objectFit = 'contain';
            img.style.position = 'absolute';
            img.style.left = '210px';
            img.style.top = '130px';
            target.appendChild(img);
        }
        saveDeck();
        scheduleThumbnails();
    };
    reader.readAsDataURL(file);
});

// --- Toolbar Events ---
document.getElementById('undoBtn')?.addEventListener('click', undo);
document.getElementById('redoBtn')?.addEventListener('click', redo);

document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) redo(); else undo();
        e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        redo();
        e.preventDefault();
    }
});

document.getElementById('duplicateSlideBtn')?.addEventListener('click', () => {
    const wraps = getSlideWraps();
    if (!wraps[activeSlideIndex]) return;
    const clone = wraps[activeSlideIndex].cloneNode(true);
    clone.classList.remove('is-active');
    wraps[activeSlideIndex].after(clone);
    renumberSlides();
    setActiveSlide(activeSlideIndex + 1);
    saveDeck();
});

document.getElementById('deleteSlideBtn')?.addEventListener('click', () => {
    if (confirm('确定要删除当前页吗？')) {
        deleteActiveSlide();
    }
});

thumbDeck.addEventListener('focusin', event => {
    if (event.target.closest('.thumb-item')) thumbnailKeyboardFocus = true;
});

document.addEventListener('pointerdown', event => {
    if (!event.target.closest('#thumbDeck')) thumbnailKeyboardFocus = false;
}, true);

document.addEventListener('keydown', event => {
    if (!thumbnailKeyboardFocus) return;
    if (document.body.classList.contains('presentation-mode')) return;
    if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
    
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    
    if (['delete', 'backspace'].includes(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteActiveSlide();
    } else if (command && key === 'c') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const wraps = getSlideWraps();
        const toCopy = Array.from(selectedSlideIndices).sort((a, b) => a - b);
        slideClipboard = document.createElement('div');
        toCopy.forEach(idx => {
            if (wraps[idx]) slideClipboard.appendChild(wraps[idx].cloneNode(true));
        });
        setStatus(`已复制 ${toCopy.length} 页`);
    } else if (command && key === 'x') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const wraps = getSlideWraps();
        const toCopy = Array.from(selectedSlideIndices).sort((a, b) => a - b);
        slideClipboard = document.createElement('div');
        toCopy.forEach(idx => {
            if (wraps[idx]) slideClipboard.appendChild(wraps[idx].cloneNode(true));
        });
        deleteActiveSlide();
        setStatus(`已剪切 ${toCopy.length} 页`);
    } else if (command && key === 'v') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (slideClipboard) {
            const wraps = getSlideWraps();
            let insertTarget = wraps[Math.max(...Array.from(selectedSlideIndices))] || wraps[activeSlideIndex];
            
            let pastedCount = 0;
            Array.from(slideClipboard.children).forEach(child => {
                const clone = child.cloneNode(true);
                clone.classList.remove('is-active');
                if (insertTarget) {
                    insertTarget.after(clone);
                } else {
                    deck.appendChild(clone);
                }
                insertTarget = clone;
                pastedCount++;
            });
            
            renumberSlides();
            setActiveSlide(activeSlideIndex + pastedCount);
            saveDeck();
            setStatus(`已粘贴 ${pastedCount} 页`);
        }
    } else if (command && key === 'a') {
        event.preventDefault();
        event.stopImmediatePropagation();
        // Since only single slide selection is supported, we just prevent default whole page selection
    }
}, true);

document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        const theme = e.currentTarget.dataset.theme;
        document.documentElement.setAttribute('data-theme', theme);
    });
});

const presentationOverlay = document.getElementById('presentationOverlay');
const presentationCanvas = document.getElementById('presentationInkCanvas');
const presentationLaser = document.getElementById('presentationLaser');
const presentationPageLabel = document.getElementById('presentationPageLabel');
let presentationTool = 'navigate';
let presentationDrawing = null;
let presentationViewState = null;

function updatePresentationPageLabel() {
    if (presentationPageLabel) presentationPageLabel.textContent = `${activeSlideIndex + 1} / ${getSlideWraps().length}`;
}

function resizePresentationCanvas() {
    if (!presentationCanvas) return;
    const ratio = window.devicePixelRatio || 1;
    presentationCanvas.width = Math.round(window.innerWidth * ratio);
    presentationCanvas.height = Math.round(window.innerHeight * ratio);
    presentationCanvas.style.width = `${window.innerWidth}px`;
    presentationCanvas.style.height = `${window.innerHeight}px`;
    const context = presentationCanvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
}

function clearPresentationInk() {
    if (!presentationCanvas) return;
    presentationCanvas.getContext('2d').clearRect(0, 0, presentationCanvas.width, presentationCanvas.height);
}

function fitPresentationSlide() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.max(.1, Math.min(width / 1920, height / 1080));
    applyEditorZoom(scale);
    resetCanvasPan();
}

function setPresentationTool(tool) {
    presentationTool = tool;
    presentationOverlay.dataset.tool = tool;
    presentationOverlay.querySelectorAll('[data-presentation-tool]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.presentationTool === tool);
    });
    presentationLaser.classList.remove('is-visible');
}

function fullscreenDocument() {
    try {
        return window.parent?.document || document;
    } catch {
        return document;
    }
}

async function enterPresentation() {
    if (document.body.classList.contains('presentation-mode')) return;
    document.activeElement?.blur?.();
    componentEditor?.clearSelection();
    presentationViewState = {
        scale: currentEditorScale,
        panX: canvasPanX,
        panY: canvasPanY
    };
    document.body.classList.add('presentation-mode');
    presentationOverlay.setAttribute('aria-hidden', 'false');
    setPresentationTool('navigate');
    updatePresentationPageLabel();
    resizePresentationCanvas();
    fitPresentationSlide();

    const fullscreenTarget = window.frameElement || document.documentElement;
    try {
        if (fullscreenTarget.requestFullscreen) {
            await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' });
        } else if (fullscreenTarget.webkitRequestFullscreen) {
            fullscreenTarget.webkitRequestFullscreen();
        }
        setTimeout(() => {
            resizePresentationCanvas();
            fitPresentationSlide();
        }, 100);
    } catch (error) {
        console.warn('[Presentation] fullscreen failed:', error);
        setStatus('浏览器未允许全屏，已进入只读演示模式');
    }
}

async function exitPresentation() {
    if (!document.body.classList.contains('presentation-mode')) return;
    const fullscreenDoc = fullscreenDocument();
    document.body.classList.remove('presentation-mode');
    presentationOverlay.setAttribute('aria-hidden', 'true');
    try {
        if (fullscreenDoc.fullscreenElement && fullscreenDoc.exitFullscreen) await fullscreenDoc.exitFullscreen();
        else if (fullscreenDoc.webkitFullscreenElement && fullscreenDoc.webkitExitFullscreen) fullscreenDoc.webkitExitFullscreen();
    } catch (error) {
        console.warn('[Presentation] exit fullscreen failed:', error);
    }
    presentationLaser.classList.remove('is-visible');
    clearPresentationInk();
    if (presentationViewState) {
        applyEditorZoom(presentationViewState.scale);
        canvasPanX = presentationViewState.panX;
        canvasPanY = presentationViewState.panY;
        applyCanvasPan();
    }
    presentationViewState = null;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => updateThumbScale());
    });
}

function changePresentationSlide(direction) {
    const nextIndex = Math.max(0, Math.min(activeSlideIndex + direction, getSlideWraps().length - 1));
    if (nextIndex !== activeSlideIndex) setActiveSlide(nextIndex);
}

document.getElementById('presentBtn')?.addEventListener('click', enterPresentation);
document.getElementById('presentationPrevBtn')?.addEventListener('click', () => changePresentationSlide(-1));
document.getElementById('presentationNextBtn')?.addEventListener('click', () => changePresentationSlide(1));
document.getElementById('presentationClearBtn')?.addEventListener('click', clearPresentationInk);
document.getElementById('presentationExitBtn')?.addEventListener('click', exitPresentation);
document.querySelectorAll('[data-presentation-tool]').forEach(button => {
    button.addEventListener('click', () => setPresentationTool(button.dataset.presentationTool));
});

presentationCanvas?.addEventListener('pointerdown', event => {
    if (presentationTool === 'pen') {
        presentationDrawing = { pointerId: event.pointerId };
        presentationCanvas.setPointerCapture(event.pointerId);
        const context = presentationCanvas.getContext('2d');
        context.beginPath();
        context.moveTo(event.clientX, event.clientY);
        context.strokeStyle = '#ef4444';
        context.lineWidth = 4;
    } else if (presentationTool === 'navigate') {
        presentationDrawing = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    }
});

presentationCanvas?.addEventListener('pointermove', event => {
    if (presentationTool === 'laser') {
        presentationLaser.style.left = `${event.clientX}px`;
        presentationLaser.style.top = `${event.clientY}px`;
        presentationLaser.classList.add('is-visible');
    }
    if (presentationTool === 'pen' && presentationDrawing?.pointerId === event.pointerId) {
        const context = presentationCanvas.getContext('2d');
        context.lineTo(event.clientX, event.clientY);
        context.stroke();
    }
});

presentationCanvas?.addEventListener('pointerup', event => {
    if (!presentationDrawing || presentationDrawing.pointerId !== event.pointerId) return;
    if (presentationTool === 'navigate') {
        const moved = Math.hypot(event.clientX - presentationDrawing.startX, event.clientY - presentationDrawing.startY);
        if (moved < 8) changePresentationSlide(event.clientX < window.innerWidth / 2 ? -1 : 1);
    }
    presentationDrawing = null;
});
presentationCanvas?.addEventListener('pointercancel', () => { presentationDrawing = null; });
presentationCanvas?.addEventListener('pointerleave', () => presentationLaser.classList.remove('is-visible'));

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !fullscreenDocument().fullscreenElement && document.body.classList.contains('presentation-mode')) {
        exitPresentation();
    }
});
try {
    window.parent.document.addEventListener('fullscreenchange', () => {
        if (!window.parent.document.fullscreenElement && document.body.classList.contains('presentation-mode')) exitPresentation();
    });
} catch {}

document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('presentation-mode')) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') changePresentationSlide(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') changePresentationSlide(-1);
    else if (e.key.toLowerCase() === 'l') setPresentationTool('laser');
    else if (e.key.toLowerCase() === 'p') setPresentationTool('pen');
    else if (e.key.toLowerCase() === 'c') clearPresentationInk();
    else if (e.key === 'Escape') exitPresentation();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
}, true);

window.addEventListener('resize', () => {
    if (!document.body.classList.contains('presentation-mode')) return;
    resizePresentationCanvas();
    fitPresentationSlide();
});

// --- Rich Text Toolbar ---
const rtToolbar = document.getElementById('richTextToolbar');
let savedRangeForColor = null;
let savedEditableForColor = null;

document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection.rangeCount) {
        if (rtToolbar) {
            rtToolbar.classList.add('hidden');
            document.querySelectorAll('.rt-dropdown-menu').forEach(m => m.classList.add('hidden'));
        }
        return;
    }
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const editable = container.nodeType === 3 ? container.parentElement.closest('.editable') : container.closest('.editable');
    
    if (editable && selection.toString().trim().length > 0) {
        savedRangeForColor = range.cloneRange();
        savedEditableForColor = editable;
        const rect = range.getBoundingClientRect();
        rtToolbar.classList.remove('hidden');
        const top = Math.max(12, rect.top - 46);
        const left = Math.max(12, Math.min(window.innerWidth - rtToolbar.offsetWidth - 12, rect.left + (rect.width / 2) - (rtToolbar.offsetWidth / 2)));
        rtToolbar.style.top = `${top}px`;
        rtToolbar.style.left = `${left}px`;
        
        // Update font name and size labels
        const fontBtnSpan = document.querySelector('#rtFontNameBtn span');
        const sizeBtnSpan = document.querySelector('#rtFontSizeBtn span');
        if (fontBtnSpan) {
            let fontName = document.queryCommandValue('fontName') || '字体';
            fontName = fontName.split(',')[0].replace(/['"]/g, '').trim(); // Take first font, remove quotes
            // Map common English fonts to Chinese if needed
            const fontMap = { 'SimSun': '宋体', 'SimHei': '黑体', 'Microsoft YaHei': '微软雅黑', 'PingFang SC': '苹方', 'ui-sans-serif': '默认字体', 'system-ui': '默认字体', 'sans-serif': '默认字体' };
            fontBtnSpan.textContent = fontMap[fontName] || fontName;
        }
        if (sizeBtnSpan) {
            const fontSize = document.queryCommandValue('fontSize');
            const sizeMap = { '1': '极小', '2': '较小', '3': '常规', '4': '中等', '5': '较大', '6': '极大', '7': '超大' };
            sizeBtnSpan.textContent = sizeMap[fontSize] || '字号';
        }
    } else {
        if (rtToolbar && !rtToolbar.contains(container)) {
            rtToolbar.classList.add('hidden');
            document.querySelectorAll('.rt-dropdown-menu').forEach(m => m.classList.add('hidden'));
        }
    }
});

// Dropdown Toggle Logic
document.addEventListener('mousedown', e => {
    // Handle dropdown toggles
    const toggle = e.target.closest('.rt-dropdown-toggle');
    if (toggle) {
        e.preventDefault(); // Keep selection
        const menu = toggle.nextElementSibling;
        const isHidden = menu.classList.contains('hidden');
        document.querySelectorAll('.rt-dropdown-menu').forEach(m => m.classList.add('hidden'));
        if (isHidden) menu.classList.remove('hidden');
        return;
    }
    
    // Hide dropdowns when clicking outside
    if (!e.target.closest('.rt-dropdown')) {
        document.querySelectorAll('.rt-dropdown-menu').forEach(m => m.classList.add('hidden'));
    }
});

rtToolbar?.querySelectorAll('.rt-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => {
        e.preventDefault(); // Keep selection
        if (!btn.dataset.command) return;
        document.execCommand(btn.dataset.command, false, btn.dataset.value || null);
        saveDeck();
        
        // Hide dropdowns after clicking a command
        document.querySelectorAll('.rt-dropdown-menu').forEach(m => m.classList.add('hidden'));
        
        // Manually trigger selectionchange to update labels
        document.dispatchEvent(new Event('selectionchange'));
    });
});

rtToolbar?.querySelector('.rt-color')?.addEventListener('mousedown', e => {
    // 阻止默认行为，防止焦点离开富文本框导致选区丢失
    // color picker 依然会因为 click 事件而正常弹出
    e.preventDefault();
});

// 颜色选择器在 input 时（拖拽中）实时预览可能因焦点冲突失败，
// 改为在 change 时（面板关闭后）最终应用颜色并彻底恢复焦点。
rtToolbar?.querySelector('.rt-color')?.addEventListener('change', e => {
    if (savedEditableForColor && savedRangeForColor) {
        savedEditableForColor.focus();
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRangeForColor);
    }
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(e.target.dataset.command, false, e.target.value);
    saveDeck();
});
// 兼容实时拖拽：在拖拽时也尝试应用（有些浏览器不需要强制 focus 也能生效）
rtToolbar?.querySelector('.rt-color')?.addEventListener('input', e => {
    if (savedRangeForColor) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRangeForColor);
        document.execCommand('styleWithCSS', false, true);
        document.execCommand(e.target.dataset.command, false, e.target.value);
    }
});

function stepRichTextFontSize(delta) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    let el = range.commonAncestorContainer;
    if (el.nodeType === 3) el = el.parentElement;
    const currentSize = parseFloat(window.getComputedStyle(el).fontSize) || 24;
    const newSize = Math.max(14, Math.min(120, Math.round(currentSize + delta)));
    
    if (selection.toString().trim().length > 0) {
        document.execCommand('styleWithCSS', false, true);
        const span = document.createElement('span');
        span.style.fontSize = `${newSize}px`;
        try {
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
            selection.selectAllChildren(span);
        } catch (_e) {
            el.style.fontSize = `${newSize}px`;
        }
    } else if (el) {
        el.style.fontSize = `${newSize}px`;
    }
    saveDeck();
    document.dispatchEvent(new Event('selectionchange'));
}

document.getElementById('rtSizeDown')?.addEventListener('mousedown', e => {
    e.preventDefault();
    stepRichTextFontSize(-4);
});

document.getElementById('rtSizeUp')?.addEventListener('mousedown', e => {
    e.preventDefault();
    stepRichTextFontSize(4);
});

document.getElementById('rtAiActionBtn')?.addEventListener('mousedown', e => {
    e.preventDefault();
    const selection = window.getSelection();
    const text = selection?.toString()?.trim() || '';
    const aiInput = document.getElementById('aiInput');
    const aiSidebar = document.getElementById('aiSidebar');
    if (aiSidebar && aiSidebar.style.marginRight !== '0px') {
        aiSidebar.style.marginRight = '0px';
    }
    if (aiInput) {
        if (text) {
            aiInput.value = `请润色优化以下文案，使其更专业精炼，并保留核心数据：\n“${text}”`;
        } else {
            aiInput.value = '请帮我润色当前选中文本模块的表达，使其更具说服力。';
        }
        aiInput.focus();
        aiInput.setSelectionRange(aiInput.value.length, aiInput.value.length);
    }
});

// (Removed obsolete rt-select listener)

// --- Media Upload (Double-click & Drag) ---
deck.addEventListener('dblclick', e => {
    const target = e.target.closest('.qr-box, .cover-photo, .avatar, .ppt-image-placeholder');
    if (!target) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = ev => {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            target.style.background = `url("${reader.result}") center / cover no-repeat`;
            target.classList.add('has-image');
            target.innerHTML = '';
            saveDeck();
            scheduleThumbnails();
        };
        reader.readAsDataURL(file);
    };
    input.click();
    e.stopPropagation();
});

deck.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.qr-box, .cover-photo, .avatar, .ppt-image-placeholder, .slide-pad');
    if (target) target.style.opacity = '0.8';
});
deck.addEventListener('dragleave', e => {
    e.preventDefault();
    const target = e.target.closest('.qr-box, .cover-photo, .avatar, .ppt-image-placeholder, .slide-pad');
    if (target) target.style.opacity = '1';
});
deck.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.qr-box, .cover-photo, .avatar, .ppt-image-placeholder, .slide-pad');
    if (!target) return;
    target.style.opacity = '1';
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
        if (target.classList.contains('slide-pad')) {
            const img = document.createElement('img');
            img.src = reader.result;
            img.style.maxWidth = '180px';
            img.style.maxHeight = '120px';
            img.style.objectFit = 'contain';
            img.style.position = 'absolute';
            img.style.left = '210px';
            img.style.top = '130px';
            target.appendChild(img);
        } else {
            target.style.background = `url("${reader.result}") center / cover no-repeat`;
            target.classList.add('has-image');
            target.innerHTML = '';
        }
        saveDeck();
        scheduleThumbnails();
    };
    reader.readAsDataURL(file);
});


document.getElementById('addBlankBtn').addEventListener('click', () => {
    deck.appendChild(renderSlide(createVisionSlide()));
    renumberSlides();
    componentEditor?.refresh();
    setActiveSlide(getSlideWraps().length - 1);
    saveDeck();
});

document.querySelectorAll('.add-element-btn').forEach(button => {
    button.addEventListener('click', () => {
        componentEditor?.addElement(button.dataset.elementKind);
        document.getElementById('addElementMenu')?.classList.add('hidden');
    });
});

document.getElementById('addElementMenuBtn')?.addEventListener('click', event => {
    event.stopPropagation();
    document.getElementById('addElementMenu')?.classList.toggle('hidden');
});

document.addEventListener('click', event => {
    if (!event.target.closest('#addElementMenu, #addElementMenuBtn')) {
        document.getElementById('addElementMenu')?.classList.add('hidden');
    }
});

const LAYERS_AUTO_OPEN_KEY = 'ppt_layers_auto_open';
const PROPERTIES_HEIGHT_KEY = 'ppt_properties_panel_height';
let restorePropertiesPanelHeight = () => {};

function shouldAutoOpenLayers() {
    return localStorage.getItem(LAYERS_AUTO_OPEN_KEY) !== 'false';
}

function toggleLayersPanel(forceOpen = null, source = 'manual') {
    const panel = document.getElementById('layersPanel');
    if (!panel) return;
    const shouldOpen = forceOpen === null ? panel.classList.contains('hidden') : forceOpen;
    panel.classList.toggle('hidden', !shouldOpen);
    if (source === 'manual') {
        localStorage.setItem(LAYERS_AUTO_OPEN_KEY, shouldOpen ? 'true' : 'false');
    }
    syncRightPanels();
    if (shouldOpen) {
        requestAnimationFrame(restorePropertiesPanelHeight);
        componentEditor?.refreshLayers();
    }
}

document.getElementById('toggleLayersBtn')?.addEventListener('click', () => toggleLayersPanel());
document.getElementById('closeLayersBtn')?.addEventListener('click', () => toggleLayersPanel(false));

function initLayersPropertiesResizer() {
    const panel = document.getElementById('layersPanel');
    const propertiesPanel = document.getElementById('propertiesPanel');
    const resizer = document.getElementById('layersPropertiesResizer');
    if (!panel || !propertiesPanel || !resizer) return;

    const applyHeight = height => {
        const maxHeight = Math.max(180, panel.clientHeight - 190);
        const nextHeight = Math.max(180, Math.min(height, maxHeight));
        propertiesPanel.style.flexBasis = `${nextHeight}px`;
        return nextHeight;
    };

    restorePropertiesPanelHeight = () => {
        if (panel.classList.contains('hidden') || panel.clientHeight <= 0) return;
        const savedHeight = Number(localStorage.getItem(PROPERTIES_HEIGHT_KEY));
        if (Number.isFinite(savedHeight) && savedHeight > 0) applyHeight(savedHeight);
    };

    let resizeState = null;
    resizer.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        resizeState = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: propertiesPanel.getBoundingClientRect().height
        };
        panel.classList.add('is-resizing-properties');
        resizer.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    resizer.addEventListener('pointermove', event => {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;
        applyHeight(resizeState.startHeight + resizeState.startY - event.clientY);
    });

    const finishResize = event => {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;
        const height = applyHeight(propertiesPanel.getBoundingClientRect().height);
        localStorage.setItem(PROPERTIES_HEIGHT_KEY, String(Math.round(height)));
        if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
        resizeState = null;
        panel.classList.remove('is-resizing-properties');
    };

    resizer.addEventListener('pointerup', finishResize);
    resizer.addEventListener('pointercancel', finishResize);
    window.addEventListener('resize', () => {
        const currentHeight = propertiesPanel.getBoundingClientRect().height;
        if (currentHeight) applyHeight(currentHeight);
    });
}


document.getElementById('exportPptxBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> 导出中...';
    
    const success = await editor.exportPptx(deck, setStatus);
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    setStatus(success ? 'PPT 已导出' : '导出失败');
});

document.getElementById('exportPdfBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> 导出中...';
    
    const success = await editor.exportPdf(deck, setStatus);
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    setStatus(success ? 'PDF 已导出' : '导出失败');
});

document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const payload = {
        version: 3,
        exportedAt: new Date().toISOString(),
        html: deck.innerHTML
    };
    editor.downloadBlob(`华子胶片设计_${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
});

document.getElementById('importJsonInput').addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    if (file) {
        try {
            const payload = JSON.parse(await file.text());
            if (!payload || !payload.html) throw new Error('JSON 数据无效');
            deck.innerHTML = payload.html;
            renumberSlides();
            componentEditor?.refresh();
            setActiveSlide(0);
            saveDeck();
            setStatus('导入完成');
        } catch(e) {
            alert(`导入失败: ${e.message}`);
        }
    }
    event.target.value = '';
});

document.getElementById('setDefaultBtn')?.addEventListener('click', () => {
    localStorage.setItem('ppt_custom_default_template_v5', editor.serializeDeck(deck));
    setStatus('已成功将当前所有幻灯片保存为您的专属默认模板！');
});

document.getElementById('resetBtn').addEventListener('click', () => {
    if (confirm('确认清空当前正在编辑的所有内容，重新开始吗？（如果设置过默认模板，将恢复为您的默认模板）')) {
        store.clearState();
        location.reload();
    }
});

document.getElementById('restoreSystemBtn')?.addEventListener('click', () => {
    if (confirm('确认清除您设置的自定义默认模板，并恢复到系统出厂模板吗？当前内容也会被清空！')) {
        localStorage.removeItem('ppt_custom_default_template_v5');
        store.clearState();
        location.reload();
    }
});

document.getElementById('zoomOutBtn').addEventListener('click', () => {
    if (currentEditorScale > 0.5) applyEditorZoom(currentEditorScale - 0.25);
});
document.getElementById('zoomInBtn').addEventListener('click', () => {
    if (currentEditorScale < 3.0) applyEditorZoom(currentEditorScale + 0.25);
});
document.getElementById('zoomFitBtn').addEventListener('click', () => {
    const w = deckWrapper.clientWidth - 80;
    const h = deckWrapper.clientHeight - 80;
    const scale = Math.max(0.1, Math.min(w / 1920, h / 1080));
    applyEditorZoom(scale);
    resetCanvasPan();
});

// --- AI Copilot Feature ---
const toggleAiBtn = document.getElementById('toggleAiBtn');

const closeAiBtn = document.getElementById('closeAiBtn');
const aiChatWindow = document.getElementById('aiChatWindow');
const aiInput = document.getElementById('aiInput');
const aiSendBtn = document.getElementById('aiSendBtn');
const aiSettingsBtn = document.getElementById('aiSettingsBtn');
const aiSettingsPanel = document.getElementById('aiSettingsPanel');
const aiRulesInput = document.getElementById('aiRulesInput');
const saveAiRulesBtn = document.getElementById('saveAiRulesBtn');
const PPT_COPILOT_RULES_KEY = 'ppt_copilot_rules';

let aiMessages = [];
let aiReplacingSlide = false;
let pptCopilotRules = localStorage.getItem(PPT_COPILOT_RULES_KEY) || '';

function isAiSidebarOpen() {
    return aiSidebar && (aiSidebar.style.marginRight === '0px' || !aiSidebar.style.marginRight);
}

function syncRightPanels() {
    const offset = isAiSidebarOpen() ? aiSidebar.offsetWidth : 0;
    document.documentElement.style.setProperty('--ai-sidebar-offset', `${offset}px`);
}

function getAuthToken() {
    const tokenMatch = document.cookie.match(/(^|;)\s*jwt_token=([^;]+)/);
    return tokenMatch ? tokenMatch[2] : localStorage.getItem('tools_token');
}

function getPptCopilotRules() {
    return pptCopilotRules || localStorage.getItem(PPT_COPILOT_RULES_KEY) || '';
}

async function loadPptCopilotRules() {
    try {
        const token = getAuthToken();
        const response = await fetch('/api/ai-settings', {
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
        });
        if (!response.ok) throw new Error('load failed');
        const settings = await response.json();
        const serverRules = String(settings.pptCopilotRules || '');
        const localRules = localStorage.getItem(PPT_COPILOT_RULES_KEY) || '';
        pptCopilotRules = serverRules || localRules;
        if (pptCopilotRules) localStorage.setItem(PPT_COPILOT_RULES_KEY, pptCopilotRules);
        if (aiRulesInput) aiRulesInput.value = pptCopilotRules;
        if (!serverRules && localRules) {
            await savePptCopilotRules(localRules, { silent: true });
        }
    } catch {
        pptCopilotRules = localStorage.getItem(PPT_COPILOT_RULES_KEY) || '';
        if (aiRulesInput) aiRulesInput.value = pptCopilotRules;
    }
}

async function savePptCopilotRules(value, options = {}) {
    pptCopilotRules = String(value || '').trim();
    localStorage.setItem(PPT_COPILOT_RULES_KEY, pptCopilotRules);
    const token = getAuthToken();
    const response = await fetch('/api/ai-settings', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ pptCopilotRules })
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '保存规范失败');
    }
    if (!options.silent) appendAiMessage('model', '✅ 个性化制作规范已保存。');
}

document.querySelectorAll('.ai-shortcut-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
        const action = e.currentTarget.dataset.action;
        if (action === 'modify_selected') {
            await modifyWithStructuredAi('selection');
            return;
        }
        if (action === 'layout_page') {
            await modifyWithStructuredAi('page');
            return;
        }
        if (action === 'audit_layout') {
            const issues = componentEditor?.auditPageLayout() || [];
            if (!issues.length) {
                appendAiMessage('model', '✅ 当前页未发现明显的越界、文字溢出或严重重叠。');
            } else {
                const counts = issues.reduce((result, issue) => {
                    result[issue.type] = (result[issue.type] || 0) + 1;
                    return result;
                }, {});
                appendAiMessage('model', `🔎 发现 ${issues.length} 个排版问题：越界 ${counts.outOfBounds || 0}、文字溢出 ${counts.textOverflow || 0}、重叠 ${counts.overlap || 0}。可点击“修复排版”。`);
            }
            return;
        }
        if (action === 'fix_layout') {
            const result = componentEditor?.autoFixPageLayout();
            appendAiMessage('model', result?.fixed
                ? `🪄 已修复 ${result.fixed} 项，剩余 ${result.remaining.length} 个需要人工确认的问题。`
                : '✅ 当前页无需自动修复。');
            scheduleThumbnails();
            return;
        }
        if (action === 'unify_deck') {
            const changed = componentEditor?.unifyDeckStyle() || 0;
            appendAiMessage('model', changed
                ? `🎨 已统一 ${changed} 处样式：标题层级、正文中英文字体、卡片边框圆角与页脚。`
                : '当前没有可统一的样式。');
            scheduleThumbnails();
            return;
        }
        const activeWrap = deck.querySelector('.slide-wrap.is-active');
        if (!activeWrap) return;
        
        let promptText = '';
        let displayMsg = '';
        const baseRule = '【非常重要】以下是当前幻灯片的 JSON 数据。请只润色/翻译文本内容（如标题、列表、正文等），严格保持 `layout`、`id`、原有的 HTML 结构、类名(class) 和非文本元素完全不变！必须返回合法的 JSON 数组，包含修改后的这页数据。';
        
        if (action === 'polish') { promptText = '请帮我润色以下幻灯片页面的文本内容，使其更专业流畅。' + baseRule; displayMsg = '✨ 请帮我润色当前页面'; }
        if (action === 'translate_en') { promptText = '请将以下幻灯片页面的所有中文内容翻译为专业的英文。' + baseRule; displayMsg = '🌐 请将当前页面翻译为英文'; }
        if (action === 'translate_zh') { promptText = '请将以下幻灯片页面的所有英文内容翻译为中文。' + baseRule; displayMsg = '🇨🇳 请将当前页面翻译为中文'; }
        if (action === 'to_metric') {
            promptText = '请将当前页面重构为突出“大数字指标卡片”的高颜值现代化排版风格。提炼出核心量化指标（如百分比、完成度、时间提速等），大字号展示，并搭配精炼的结论阐述。必须使用 layout: "custom"，确保卡片带有 class="ppt-card ...", 且标题正文均带有 class="editable"。返回合法 JSON 数组。';
            displayMsg = '📊 请将当前页提炼为大字指标卡';
        }
        if (action === 'to_comparison') {
            promptText = '请将当前页面的核心论点重新梳理为清晰的“双列对比矩阵”（如：改造前痛点 vs 改造后收益，或方案 A vs 方案 B）。左右对比鲜明，突出成效与优势。必须使用 layout: "custom"，确保卡片带有 class="ppt-card ...", 且所有文字节点带有 class="editable"。返回合法 JSON 数组。';
            displayMsg = '⚖️ 请将当前页转为双列对比';
        }
        if (action === 'to_process') {
            promptText = '请将当前页面内容提炼为 3~4 个步骤的横向流程步骤卡片（带有 01、02、03 序号角标），突出每个阶段的核心举措与目标。必须使用 layout: "custom"，确保卡片带有 class="ppt-card ...", 且所有文字带有 class="editable"。返回合法 JSON 数组。';
            displayMsg = '🪜 请将当前页提炼为流程步骤';
        }
        if (action === 'style_dark') {
            promptText = '请将当前页面的视觉风格整体重构为科技深黑风（在 JSON 中设置 "background": "#0b0f19", "theme": "dark"，采用深色毛玻璃/暗灰高质感卡片，搭配醒目青色或靛蓝高亮，文字清晰锐利）。必须使用 layout: "custom"，确保卡片带有 class="ppt-card ...", 且文字均带有 class="editable"。返回合法 JSON 数组。';
            displayMsg = '🌙 请将当前页重构为科技深黑风';
        }
        if (action === 'style_light') {
            promptText = '请将当前页面的视觉风格整体重构为极简纯白现代风（在 JSON 中设置 "background": "#f8fafc"，采用纯白圆角卡片、细腻边框与阴影，层级分明）。必须使用 layout: "custom"，确保卡片带有 class="ppt-card ...", 且文字均带有 class="editable"。返回合法 JSON 数组。';
            displayMsg = '☀️ 请将当前页重构为极简纯白风';
        }
        if (action === 'to_quote') {
            promptText = '请将当前页的核心战略论断提炼为高冲击力的大字号金句卡片（搭配大引号符号与结论归属标签）。必须使用 layout: "custom"，确保卡片带有 class="ppt-card ...", 且文字均带有 class="editable"。返回合法 JSON 数组。';
            displayMsg = '💬 请提炼核心战略金句卡';
        }
        
        const slideJson = slideToJson(activeWrap);
        const htmlContext = JSON.stringify([slideJson], null, 2);
        
        aiReplacingSlide = true;
        sendAiMessage(promptText + '\n\n```json\n' + htmlContext + '\n```', displayMsg);
    });
});

async function modifyWithStructuredAi(scope = 'selection') {
    const context = scope === 'page'
        ? componentEditor?.getPageContext()
        : componentEditor?.getSelectionContext();
    if (!context?.components?.length) {
        appendAiMessage('model', scope === 'page' ? '当前页面没有可重排的组件。' : '请先在画布中选中一个或多个组件，再输入修改要求。');
        return;
    }
    const instruction = aiInput.value.trim();
    if (!instruction) {
        appendAiMessage('model', scope === 'page'
            ? '请先描述页面布局要求，例如“除标题外整理成三栏卡片，间距一致”。'
            : '请先描述修改要求，例如“统一为深蓝底白字并顶端对齐”。');
        aiInput.focus();
        return;
    }
    aiInput.value = '';
    appendAiMessage('user', `${scope === 'page' ? '🧩' : '🎯'} ${escapeHtml(instruction)}`);
    const loadingId = `ai-component-loading-${Date.now()}`;
    const loadDiv = document.createElement('div');
    loadDiv.id = loadingId;
    loadDiv.className = 'flex items-start space-x-2 mt-4 opacity-50';
    loadDiv.innerHTML = `<div class="w-8 h-8 rounded bg-amber-600/20 text-amber-300 flex items-center justify-center shrink-0"><i class="ph-fill ph-robot animate-pulse"></i></div><div class="bg-zinc-800 text-zinc-200 rounded-lg rounded-tl-none p-3 text-xs">${scope === 'page' ? '正在规划当前页布局...' : `正在分析 ${context.components.length} 个选中组件...`}</div>`;
    aiChatWindow.appendChild(loadDiv);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
    try {
        const token = getAuthToken();
        const response = await fetch('/api/ai/ppt-copilot-actions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                instruction,
                context,
                rules: getPptCopilotRules()
            })
        });
        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch {
            throw new Error(response.ok ? 'AI 返回格式异常，请重试' : `服务请求失败（${response.status}）`);
        }
        if (!response.ok) throw new Error(data.error || '请求失败');
        const applied = componentEditor.applyAiActions(data.actions, scope);
        if (!applied) throw new Error('AI 未返回可执行的修改');
        appendAiMessage('model', `✅ ${escapeHtml(data.summary || `已执行 ${applied} 项修改`)}`);
        scheduleThumbnails();
    } catch (error) {
        appendAiMessage('model', `⚠️ ${escapeHtml(error.message)}`);
    } finally {
        document.getElementById(loadingId)?.remove();
    }
}

function toggleAi() {
    if (isAiSidebarOpen()) {
        aiSidebar.style.marginRight = '-' + aiSidebar.offsetWidth + 'px';
    } else {
        aiSidebar.style.marginRight = '0px';
    }
    syncRightPanels();
}

if (toggleAiBtn) toggleAiBtn.addEventListener('click', toggleAi);
if (closeAiBtn) closeAiBtn.addEventListener('click', toggleAi);

if (aiSettingsBtn) {
    aiSettingsBtn.addEventListener('click', () => {
        aiSettingsPanel.classList.toggle('hidden');
        aiRulesInput.value = getPptCopilotRules();
    });
    aiRulesInput.value = getPptCopilotRules();
    loadPptCopilotRules();
    saveAiRulesBtn.addEventListener('click', async () => {
        const originalText = saveAiRulesBtn.textContent;
        saveAiRulesBtn.textContent = '保存中...';
        saveAiRulesBtn.disabled = true;
        try {
            await savePptCopilotRules(aiRulesInput.value);
            aiSettingsPanel.classList.add('hidden');
        } catch (error) {
            appendAiMessage('model', `⚠️ ${escapeHtml(error.message)}，已先保存到本机浏览器。`);
        } finally {
            saveAiRulesBtn.textContent = originalText;
            saveAiRulesBtn.disabled = false;
        }
    });
}

function appendAiMessage(role, text) {
    const div = document.createElement('div');
    div.className = "flex items-start space-x-2 mt-4";
    if (role === 'user') {
        div.classList.add('justify-end');
        div.innerHTML = `
            <div class="bg-purple-600 text-white rounded-lg rounded-tr-none p-3 max-w-[85%] leading-relaxed shadow-sm text-[13px]">
                ${text.replace(/\n/g, '<br>')}
            </div>
            <div class="w-8 h-8 rounded bg-zinc-800 text-zinc-400 flex items-center justify-center shrink-0">
                <i class="ph-fill ph-user"></i>
            </div>
        `;
    } else {
        div.innerHTML = `
            <div class="w-8 h-8 rounded bg-purple-600/20 text-purple-400 flex items-center justify-center shrink-0">
                <i class="ph-fill ph-robot"></i>
            </div>
            <div class="bg-zinc-800 text-zinc-200 rounded-lg rounded-tl-none p-3 max-w-[85%] leading-relaxed shadow-sm border border-zinc-700/50 text-[13px]">
                ${text.replace(/\n/g, '<br>')}
            </div>
        `;
    }
    aiChatWindow.appendChild(div);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
}

async function sendAiMessage(hiddenContent = null, displayMsg = null) {
    const text = hiddenContent || aiInput.value.trim();
    if (!text && !hiddenContent) return;
    
    // 如果用户的输入明显是“生成/新建页面”的意图，即使选中了组件，也强制走全局生成逻辑
    const isGenerationPrompt = /^(生成|写一个|创建|新建|帮我写|帮我做|增加一页)/.test(text);

    if (!hiddenContent && !isGenerationPrompt && componentEditor?.getSelectionContext()) {
        await modifyWithStructuredAi('selection');
        return;
    }
    
    aiInput.value = '';
    
    appendAiMessage('user', displayMsg || (hiddenContent ? '...' : text));
    aiMessages.push({ role: 'user', content: text });
    
    const loadingId = 'ai-loading-' + Date.now();
    const loadDiv = document.createElement('div');
    loadDiv.id = loadingId;
    loadDiv.className = "flex items-start space-x-2 mt-4 opacity-50";
    loadDiv.innerHTML = `<div class="w-8 h-8 rounded bg-purple-600/20 text-purple-400 flex items-center justify-center shrink-0"><i class="ph-fill ph-robot animate-pulse"></i></div><div class="bg-zinc-800 text-zinc-200 rounded-lg rounded-tl-none p-3 text-xs">正在生成...</div>`;
    aiChatWindow.appendChild(loadDiv);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;

    try {
        const deckSlides = deck.querySelectorAll('.slide-wrap');
        const customRules = getPptCopilotRules();
        const rulesBlock = customRules ? `\n【用户专属 PPT 制作规范】\n${customRules}\n\n` : '';
        
        let currentTemplateBlock = '';
        const activeWrap = deck.querySelector('.slide-wrap.is-active');
        if (activeWrap && !aiReplacingSlide) {
            const currentJson = slideToJson(activeWrap);
            currentTemplateBlock = `\n【参考排版风格】\n你可以参考以下这页 PPT 的排版风格和结构（这是用户当前选中的页面）：\n\`\`\`json\n${JSON.stringify([currentJson])}\n\`\`\`\n如果用户的需求适合这种排版，请尽量沿用这种布局结构。\n`;
        }
        
        const templates = `${rulesBlock}${currentTemplateBlock}`;

        const token = getAuthToken();

        const res = await fetch('/api/ai/ppt-copilot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? 'Bearer ' + token : ''
            },
            body: JSON.stringify({
                messages: aiMessages,
                templates: templates
            })
        });
        
        loadDiv.remove();
        if (!res.ok) throw new Error('请求失败');
        
        const data = await res.json();
        let reply = data.reply || '';
        aiMessages.push({ role: 'model', content: reply });
        
        let jsonStr = reply;
        const jsonMatch = reply.match(/```json\n([\s\S]*?)```/i) || reply.match(/```\n([\s\S]*?)```/i);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }
        
        let generatedSlides = [];
        try {
            generatedSlides = JSON.parse(jsonStr);
        } catch (e) {
            const arrMatch = jsonStr.substring(jsonStr.indexOf('['));
            try {
                generatedSlides = JSON.parse(arrMatch);
            } catch (err) {
                console.warn('Failed to parse AI JSON response', jsonStr);
            }
        }
        
        if (Array.isArray(generatedSlides) && generatedSlides.length > 0) {
            const generatedWraps = generatedSlides.map(slideData => renderSlide(slideData));
            
            if (aiReplacingSlide) {
                const activeWrap = deck.querySelector('.slide-wrap.is-active');
                if (activeWrap) {
                    const activeIndex = getSlideWraps().indexOf(activeWrap);
                    generatedWraps[0].classList.add('is-active');
                    activeWrap.after(generatedWraps[0]);
                    activeWrap.classList.remove('is-active');
                    const slide = generatedWraps[0].querySelector('.slide');
                    if (slide) {
                        slide.classList.add('ai-generated-glow');
                        window.autoFitSlide(slide);
                    }
                    componentEditor?.refresh();
                    setActiveSlide(activeIndex + 1);
                }
                aiReplacingSlide = false;
                appendAiMessage('model', '✨ **新页面已生成！** 已在当前页后方插入。');
            } else {
                generatedWraps.forEach(wrap => {
                    wrap.classList.remove('is-active');
                    deck.appendChild(wrap);
                    const slide = wrap.querySelector('.slide');
                    if (slide) {
                        slide.classList.add('ai-generated-glow');
                        window.autoFitSlide(slide);
                    }
                });
                componentEditor?.refresh();
                appendAiMessage('model', '✨ **幻灯片已添加至末尾。**');
                const slidesCount = getSlideWraps().length;
                setActiveSlide(slidesCount - generatedWraps.length);
            }
            renumberSlides();
            saveDeck();
            scheduleThumbnails();
        } else {
            aiReplacingSlide = false;
            const cleanStr = jsonStr.trim();
            if (cleanStr.startsWith('[') || cleanStr.startsWith('{')) {
                appendAiMessage('model', `⚠️ **生成的内容存在格式错误或因内容过长被截断**。请尝试要求 AI 减少单次生成的篇幅（不要让它一次性排版太复杂的结构）。`);
            } else {
                appendAiMessage('model', escapeHtml(reply));
            }
        }
    } catch (error) {
        const el = document.getElementById(loadingId);
        if (el) el.remove();
        appendAiMessage('model', `⚠️ 发生错误: ${error.message}`);
        aiMessages.pop();
    }
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

if (aiSendBtn) aiSendBtn.addEventListener('click', () => sendAiMessage());
if (aiInput) aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAiMessage();
    }
});

function initResizers() {
    let isResizingLeft = false;
    let isResizingRight = false;
    const leftResizer = document.getElementById('leftResizer');
    const rightResizer = document.getElementById('rightResizer');

    if (leftResizer) {
        leftResizer.addEventListener('mousedown', (e) => {
            isResizingLeft = true;
            document.body.style.cursor = 'col-resize';
            // Disable transition for smoother dragging
            sidebar.style.transition = 'none';
            e.preventDefault();
        });
    }

    if (rightResizer) {
        rightResizer.addEventListener('mousedown', (e) => {
            isResizingRight = true;
            document.body.style.cursor = 'col-resize';
            aiSidebar.style.transition = 'none';
            e.preventDefault();
        });
    }

    window.addEventListener('mousemove', (e) => {
        if (isResizingLeft) {
            const newWidth = Math.max(150, Math.min(e.clientX, 800));
            sidebar.style.width = newWidth + 'px';
            updateThumbScale();
        }
        if (isResizingRight) {
            const newWidth = Math.max(300, Math.min(window.innerWidth - e.clientX, 1200));
            aiSidebar.style.width = newWidth + 'px';
            if (aiSidebar.style.marginRight !== '0px' && aiSidebar.style.marginRight !== '') {
                aiSidebar.style.marginRight = '-' + newWidth + 'px';
            }
            syncRightPanels();
        }
    });

    window.addEventListener('mouseup', () => {
        if (isResizingLeft || isResizingRight) {
            isResizingLeft = false;
            isResizingRight = false;
            document.body.style.cursor = '';
            // Restore transitions
            sidebar.style.transition = '';
            aiSidebar.style.transition = '';
            updateThumbScale();
        }
    });
}

initResizers();
initCanvasPan();
initWheelZoom();
initLayersPropertiesResizer();
syncRightPanels();
window.addEventListener('resize', syncRightPanels);

// Start app
componentEditor = createComponentEditor({
    deck,
    getScale: () => currentEditorScale,
    onChange: () => {
        setStatus('正在保存...');
        saveDeck();
        scheduleThumbnails();
    },
    onStatus: setStatus,
    onSelectionChange: selectedElements => {
        if (selectedElements.length && shouldAutoOpenLayers()) {
            toggleLayersPanel(true, 'auto');
        }
    }
});
bootstrap();
projectWorkspace = initProjectWorkspace({
    getDeckHtml: () => editor.serializeDeck(deck),
    getNewProjectDeckHtml: createDefaultProjectDeckHtml,
    getActiveSlide: () => activeSlideIndex,
    loadDeck: loadProjectDeck,
    insertAsset: insertLibraryAsset,
    setStatus
});

// --- Context Menu ---
initContextMenu(deckWrapper, thumbDeck, {
    isComponentSelected: (component) => componentEditor?.isComponentSelected(component),
    selectComponent: (component, additive) => componentEditor?.selectComponent(component, additive),
    copyComponents: () => componentEditor?.copyComponents(),
    cutComponents: () => componentEditor?.cutComponents(),
    pasteComponents: () => componentEditor?.pasteComponents(),
    duplicateComponents: () => componentEditor?.duplicateComponents(),
    groupComponents: () => componentEditor?.groupComponents(),
    ungroupComponents: () => componentEditor?.ungroupComponents(),
    bringToFront: () => componentEditor?.bringToFront(),
    toggleLock: () => componentEditor?.toggleLock(),
    deleteComponents: () => componentEditor?.deleteComponents(),
    changeBackground: () => {
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/*';
        file.onchange = e => {
            const reader = new FileReader();
            reader.onload = () => {
                const slide = deck.querySelector('.slide-wrap.is-active .slide');
                if (slide) {
                    slide.style.background = `url("${reader.result}") center / cover no-repeat`;
                    saveDeck();
                    scheduleThumbnails();
                }
            };
            if (e.target.files[0]) reader.readAsDataURL(e.target.files[0]);
        };
        file.click();
    },
    addSlide: () => document.getElementById('addBlankBtn')?.click(),
    getActiveSlideIndex: () => activeSlideIndex,
    setActiveSlide: (index) => setActiveSlide(index),
    copySlide: () => {
        const wraps = getSlideWraps();
        const toCopy = Array.from(selectedSlideIndices).sort((a, b) => a - b);
        slideClipboard = document.createElement('div');
        toCopy.forEach(idx => {
            if (wraps[idx]) slideClipboard.appendChild(wraps[idx].cloneNode(true));
        });
        setStatus(`已复制 ${toCopy.length} 页`);
    },
    cutSlide: () => {
        const wraps = getSlideWraps();
        const toCopy = Array.from(selectedSlideIndices).sort((a, b) => a - b);
        slideClipboard = document.createElement('div');
        toCopy.forEach(idx => {
            if (wraps[idx]) slideClipboard.appendChild(wraps[idx].cloneNode(true));
        });
        deleteActiveSlide();
        setStatus(`已剪切 ${toCopy.length} 页`);
    },
    pasteSlide: () => {
        if (slideClipboard) {
            const wraps = getSlideWraps();
            let insertTarget = wraps[Math.max(...Array.from(selectedSlideIndices))] || wraps[activeSlideIndex];
            
            let pastedCount = 0;
            Array.from(slideClipboard.children).forEach(child => {
                const clone = child.cloneNode(true);
                clone.classList.remove('is-active');
                if (insertTarget) {
                    insertTarget.after(clone);
                } else {
                    deck.appendChild(clone);
                }
                insertTarget = clone;
                pastedCount++;
            });
            
            renumberSlides();
            setActiveSlide(activeSlideIndex + pastedCount);
            saveDeck();
            setStatus(`已粘贴 ${pastedCount} 页`);
        }
    },
    duplicateSlide: () => document.getElementById('duplicateSlideBtn')?.click(),
    deleteSlide: deleteActiveSlide
});

window.autoFitSlide = function(slide) {
    const pad = slide.querySelector('.slide-pad');
    if (!pad) return;
    
    const wrap = slide.closest('.slide-wrap');
    const wasHidden = wrap && window.getComputedStyle(wrap).display === 'none';
    if (wasHidden) {
        wrap.style.display = 'block';
        wrap.style.visibility = 'hidden';
    }
    
    let iterations = 0;
    while (pad.scrollHeight > pad.clientHeight && iterations < 30) {
        let changed = false;
        const textElements = pad.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, span, div.editable, div');
        textElements.forEach(el => {
            if (el.innerText && el.innerText.trim().length > 0) {
                const style = window.getComputedStyle(el);
                const fontSize = parseFloat(style.fontSize);
                if (fontSize > 14) {
                    el.style.fontSize = (fontSize * 0.95) + 'px';
                    changed = true;
                }
            }
        });
        if (!changed) break;
        iterations++;
    }
    
    if (wasHidden) {
        wrap.style.display = '';
        wrap.style.visibility = '';
    }
};
