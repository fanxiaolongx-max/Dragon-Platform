const STRUCTURAL_COMPONENTS = [
    '.cover-banner',
    '.cover-copy',
    '.cover-photo',
    '.rule-box',
    '.qr',
    '.agenda-table',
    'table',
    '.speaker',
    '.case-layout',
    '.sticky-note',
    '.two-col > .box',
    '.footer',
    '.template-component',
    '.ppt-created-element',
    '.ppt-card',
    'img'
].join(', ');

const STANDALONE_TEXT = [
    '.slide-pad > .slide-title',
    '.slide-pad > .small-title',
    '.slide-pad > .plain-list',
    '.slide-pad > .editable',
    '.slide-pad > h1',
    '.slide-pad > h2',
    '.slide-pad > h3',
    '.slide-pad > h4',
    '.slide-pad > h5',
    '.slide-pad > h6',
    '.slide-pad > p'
].join(', ');

const COMPONENT_SELECTOR = `${STRUCTURAL_COMPONENTS}, ${STANDALONE_TEXT}`;
const LOCKED_BY_DEFAULT = '.footer';
const INTERNAL_TEXT_SELECTOR = '.editable, td, th, li, .case-cells > div, .case-labels > div, .template-editable, h1, h2, h3, h4, h5, h6, p, blockquote';

function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `ppt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function numberStyle(element, property) {
    const inlineValue = parseFloat(element.style[property]);
    if (Number.isFinite(inlineValue)) return inlineValue;
    const computed = getComputedStyle(element);
    if (computed.position === 'absolute' || computed.position === 'fixed') {
        const computedValue = parseFloat(computed[property]);
        if (Number.isFinite(computedValue)) return computedValue;
    }
    return 0;
}

function isTextEditingTarget(target) {
    return Boolean(target.closest('input, textarea, [contenteditable="true"]'));
}

function componentName(element) {
    if (element.dataset.componentName) return element.dataset.componentName;
    if (element.classList.contains('ppt-inner-element')) {
        if (element.matches('td, th')) return '表格单元格';
        if (element.matches('li')) return '列表项';
        if (element.matches('.rule-head')) return '卡片标题';
        if (element.matches('.case-cells > div')) return '案例内容';
        if (element.matches('.case-labels > div')) return '案例标签';
        if (element.matches('h1, h2, h3, h4, h5, h6')) return '标题';
        if (element.matches('p')) return '段落';
        return '内部文本';
    }
    if (element.classList.contains('agenda-table') || element.matches('table')) return '表格';
    if (element.classList.contains('rule-box')) return '规则卡片';
    if (element.classList.contains('qr')) return '二维码';
    if (element.classList.contains('speaker')) return '人物介绍';
    if (element.classList.contains('case-layout')) return '案例区块';
    if (element.classList.contains('sticky-note')) return '便签';
    if (element.classList.contains('cover-photo')) return '封面图片';
    if (element.classList.contains('cover-banner')) return '封面横幅';
    if (element.classList.contains('cover-copy')) return '封面文字';
    if (element.classList.contains('footer')) return '页脚';
    if (element.classList.contains('template-component')) return '模板组件';
    if (element.matches('img')) return '图片';
    if (element.matches('.slide-title, .small-title, h1, h2, h3, h4, h5, h6')) return '标题';
    if (element.classList.contains('box') || element.classList.contains('ppt-card')) return '内容卡片';
    if (element.classList.contains('ppt-shape')) return '形状';
    if (element.classList.contains('ppt-line')) return '线条';
    if (element.classList.contains('ppt-icon')) return '图标';
    if (element.classList.contains('ppt-timeline')) return '时间轴';
    if (element.matches('p')) return '段落';
    return '文本';
}

export function normalizeSlideElements(slide) {
    if (!slide) return;
    const pad = slide.querySelector('.slide-pad');
    if (!pad) return;

    // Never alter built-in vision template or cover slide
    if (slide.classList.contains('cover-slide') || pad.querySelector('.vision-template')) return;

    // 1. Mark all textual content elements with editable class and data-ppt-editable
    pad.querySelectorAll('h1, h2, h3, h4, h5, h6, p, blockquote, li, td, th').forEach(el => {
        el.classList.add('editable');
        el.dataset.pptEditable = 'true';
    });

    // 2. Identify card-like container boxes and standalone content elements
    const candidateContainers = Array.from(pad.querySelectorAll('div, section, article')).filter(container => {
        if (container === pad) return false;
        if (container.closest('.agenda-table, .case-layout, .two-col, .footer')) return false;
        return true;
    });

    candidateContainers.forEach(container => {
        const className = container.className || '';
        // Skip layout wrappers that span full width/height unless they are styled cards
        const isLayoutWrapper = /(?:h-full|w-full)/.test(className) && !/(?:shadow|rounded-[2-3]?xl|border-2)/.test(className);
        if (isLayoutWrapper) return;

        const isStyledCard = /(?:^|\s)(?:bg-white|bg-slate-\d+|bg-blue-\d+|bg-zinc-\d+|bg-gray-\d+|bg-neutral-\d+|rounded-|shadow-|border|card|box|panel|callout)/.test(className)
            || Boolean(container.style.backgroundColor || container.style.border || container.style.boxShadow);

        const parent = container.parentElement;
        const parentIsGridOrFlex = parent && /(?:grid|flex)/.test(parent.className || '');
        const hasTextContent = Boolean(container.querySelector('h1, h2, h3, h4, h5, h6, p, img, svg'));

        if (isStyledCard || (parentIsGridOrFlex && hasTextContent)) {
            const parentCard = container.parentElement?.closest('.ppt-element, .ppt-card');
            if (!parentCard || parentCard === pad) {
                container.classList.add('ppt-element', 'ppt-card');
                container.dataset.pptElementType ||= '内容卡片';
                const heading = container.querySelector('h1, h2, h3, h4, h5, h6');
                if (heading && heading.textContent.trim()) {
                    container.dataset.componentName ||= heading.textContent.trim().slice(0, 16);
                }
            }
        }
    });

    // 3. Any standalone headings, paragraphs, tables, or lists not inside any .ppt-element
    pad.querySelectorAll('h1, h2, h3, h4, h5, h6, p, table, ul, ol').forEach(el => {
        if (el.closest('.ppt-element')) return;
        el.classList.add('ppt-element', 'ppt-created-element');
        if (el.matches('h1, h2, h3, h4, h5, h6')) {
            el.dataset.pptElementType ||= '标题';
            el.dataset.componentName ||= el.textContent.trim().slice(0, 16) || '页面标题';
        } else if (el.matches('p')) {
            el.dataset.pptElementType ||= '段落';
            el.dataset.componentName ||= el.textContent.trim().slice(0, 16) || '正文文本';
        } else if (el.matches('table')) {
            el.dataset.pptElementType ||= '表格';
        } else if (el.matches('ul, ol')) {
            el.dataset.pptElementType ||= '列表';
        }
    });
}

export function createComponentEditor({ deck, getScale, onChange, onStatus, onSelectionChange }) {
    let selected = null;
    const selectedSet = new Set();
    let clipboard = [];
    let pasteCount = 0;
    let moveable = null;
    let toolbar = null;
    let directDrag = null;
    let lassoDrag = null;
    let directResize = null;
    let directRotate = null;
    let layerPointerDrag = null;
    let suppressClick = false;
    const layersList = document.getElementById('layersList');
    const propertiesPanel = document.getElementById('propertiesPanel');
    let verticalGuide = null;
    let horizontalGuide = null;
    let editingComponent = null;
    let editingTarget = null;
    let formatPainter = null;

    const COMPONENT_STYLES = [
        { name: 'white', bg: '#ffffff', color: '#1e293b', border: '1px solid #e2e8f0', shadow: '0 10px 25px -5px rgba(0,0,0,0.06)' },
        { name: 'dark', bg: '#0f172a', color: '#f8fafc', border: '1px solid #334155', shadow: '0 20px 25px -5px rgba(0,0,0,0.35)' },
        { name: 'tint', bg: '#eef2ff', color: '#312e81', border: '1px solid #c7d2fe', shadow: '0 4px 12px rgba(99,102,241,0.08)' },
        { name: 'clear', bg: 'transparent', color: 'inherit', border: '1px dashed #cbd5e1', shadow: 'none' }
    ];

    function cycleComponentStyle() {
        const elements = getSelectedElements();
        if (!elements.length) return;
        elements.forEach(element => {
            const currentIdx = parseInt(element.dataset.styleIdx || '-1', 10);
            const nextIdx = (currentIdx + 1) % COMPONENT_STYLES.length;
            const style = COMPONENT_STYLES[nextIdx];
            element.dataset.styleIdx = String(nextIdx);
            element.style.backgroundColor = style.bg;
            element.style.color = style.color;
            element.style.border = style.border;
            element.style.boxShadow = style.shadow;
        });
        commitChange();
        refreshMoveable();
        positionToolbar();
    }

    function ensureToolbar() {
        if (toolbar) return toolbar;
        toolbar = document.createElement('div');
        toolbar.className = 'ppt-component-toolbar';
        toolbar.innerHTML = `
            <span class="ppt-component-name">组件</span>
            <button type="button" data-action="parent" title="选择父组件"><i class="ph-bold ph-arrow-bend-up-left"></i></button>
            <button type="button" data-action="edit" title="编辑文字（双击）"><i class="ph-bold ph-text-t"></i></button>
            <button type="button" data-action="toggle-style" title="快速换肤（白底/暗色/浅蓝/清透）"><i class="ph-bold ph-paint-bucket"></i></button>
            <button type="button" data-action="duplicate" title="复制组件（Ctrl/Cmd+D）"><i class="ph-bold ph-copy"></i></button>
            <button type="button" data-action="lock" title="锁定/解锁"><i class="ph-bold ph-lock-key"></i></button>
            <button type="button" data-action="front" title="置于顶层"><i class="ph-bold ph-stack-simple"></i></button>
            <button type="button" data-action="ai-action" class="text-indigo-400 hover:text-indigo-300" title="✨ AI局部调整"><i class="ph-bold ph-sparkle"></i></button>
            <button type="button" data-action="delete" title="删除（Delete）"><i class="ph-bold ph-trash"></i></button>
        `;
        document.body.appendChild(toolbar);
        toolbar.addEventListener('mousedown', event => event.preventDefault());
        toolbar.addEventListener('click', event => {
            const action = event.target.closest('button')?.dataset.action;
            if (!action || !selectedSet.size) return;
            if (action === 'parent') selectParent();
            if (action === 'edit' && selectedSet.size === 1) startTextEditing(selected);
            if (action === 'toggle-style') cycleComponentStyle();
            if (action === 'duplicate') duplicateSelected();
            if (action === 'lock') toggleLock();
            if (action === 'front') bringToFront();
            if (action === 'ai-action') {
                const el = selected;
                if (!el) return;
                const name = el.dataset.pptElementType || componentName(el);
                const aiInput = document.getElementById('aiInput');
                const aiSidebar = document.getElementById('aiSidebar');
                if (aiSidebar && aiSidebar.style.marginRight !== '0px') {
                    aiSidebar.style.marginRight = '0px';
                }
                if (aiInput) {
                    aiInput.value = `针对选中的【${name}】进行修改：`;
                    aiInput.focus();
                    aiInput.setSelectionRange(aiInput.value.length, aiInput.value.length);
                }
            }
            if (action === 'delete') deleteSelected();
        });
        return toolbar;
    }

    function ensureMoveable() {
        if (moveable) return moveable;
        const controlBox = document.createElement('div');
        controlBox.className = 'moveable-control-box ppt-manual-control-box';
        controlBox.innerHTML = `
            <span class="moveable-line moveable-line-top"></span>
            <span class="moveable-line moveable-line-right"></span>
            <span class="moveable-line moveable-line-bottom"></span>
            <span class="moveable-line moveable-line-left"></span>
            ${['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw'].map(direction =>
                `<span class="moveable-control moveable-direction moveable-${direction} moveable-resizable"></span>`
            ).join('')}
            <span class="moveable-rotation-line"></span>
            <span class="moveable-control moveable-rotation-control"></span>
        `;
        document.body.appendChild(controlBox);
        moveable = {
            element: controlBox,
            target: null,
            resizable: false,
            rotatable: false,
            updateRect() {
                const target = this.target;
                if (!target || !target.isConnected) {
                    controlBox.style.display = 'none';
                    return;
                }
                const rect = target.getBoundingClientRect();
                controlBox.style.display = 'block';
                controlBox.style.left = `${rect.left}px`;
                controlBox.style.top = `${rect.top}px`;
                controlBox.style.width = `${rect.width}px`;
                controlBox.style.height = `${rect.height}px`;
                controlBox.classList.toggle('is-resizable', Boolean(this.resizable));
                controlBox.classList.toggle('is-rotatable', Boolean(this.rotatable));
            }
        };
        return moveable;
    }

    function refreshMoveable() {
        if (!moveable) return;
        moveable.updateRect();
    }

    function getSelectedElements() {
        return Array.from(selectedSet).filter(element => element.isConnected);
    }

    function selectedEditable(element = selected) {
        if (!element) return null;
        if (element.classList.contains('ppt-inner-element')) return element;
        if (element.matches('.editable, h1, h2, h3, h4, h5, h6, p, blockquote')) return element;
        return element.querySelector('.editable, h1, h2, h3, h4, h5, h6, p, blockquote');
    }

    function captureFormat(element) {
        const editable = selectedEditable(element);
        const outerStyle = getComputedStyle(element);
        const textStyle = editable ? getComputedStyle(editable) : null;
        return {
            sourceId: element.dataset.pptElementId,
            outer: {
                background: outerStyle.background,
                border: outerStyle.border,
                borderRadius: outerStyle.borderRadius,
                boxShadow: outerStyle.boxShadow,
                opacity: outerStyle.opacity
            },
            text: textStyle ? {
                color: textStyle.color,
                fontFamily: textStyle.fontFamily,
                fontSize: textStyle.fontSize,
                fontWeight: textStyle.fontWeight,
                fontStyle: textStyle.fontStyle,
                lineHeight: textStyle.lineHeight,
                letterSpacing: textStyle.letterSpacing,
                textAlign: textStyle.textAlign,
                textDecoration: textStyle.textDecoration,
                textTransform: textStyle.textTransform
            } : null
        };
    }

    function setFormatPainter(snapshot) {
        formatPainter = snapshot;
        document.body.classList.toggle('is-format-painting', Boolean(snapshot));
        propertiesPanel?.querySelector('[data-style-action="format-painter"]')
            ?.classList.toggle('is-active', Boolean(snapshot));
    }

    function applyFormatPainter(target) {
        if (!formatPainter || !target || target.dataset.pptElementId === formatPainter.sourceId) return false;
        Object.assign(target.style, formatPainter.outer);
        const editable = selectedEditable(target);
        if (editable && formatPainter.text) Object.assign(editable.style, formatPainter.text);
        setFormatPainter(null);
        commitChange();
        onStatus?.('格式已应用');
        return true;
    }

    function isImageComponent(element = selected) {
        return Boolean(element?.matches('img, .cover-photo, .avatar, .qr-box, .ppt-image-placeholder')
            || element?.querySelector('.qr-box, img'));
    }

    function imageTarget(element = selected) {
        if (!element) return null;
        if (element.matches('img, .cover-photo, .avatar, .qr-box, .ppt-image-placeholder')) return element;
        return element.querySelector('.qr-box, img');
    }

    function isTableComponent(element = selected) {
        return Boolean(element?.matches('table, .agenda-table, td, th') || element?.closest('table'));
    }

    function isLayoutBoundInner(element = selected) {
        if (!element || element.matches('table, .agenda-table')) return false;
        return Boolean(element.matches('td, th, li')
            || (element.classList.contains('ppt-inner-element') && (element.closest('table') || !element.style.position || element.style.position === 'static')));
    }

    function parentComponent(element = selected) {
        if (!element?.classList.contains('ppt-inner-element')) return null;
        return element.parentElement?.closest('.ppt-element') || null;
    }

    function internalEditTargets(component) {
        if (!component) return [];
        if (component.classList.contains('ppt-inner-element')) {
            const parent = parentComponent(component);
            return parent ? internalEditTargets(parent) : [component];
        }
        const candidates = Array.from(component.querySelectorAll(INTERNAL_TEXT_SELECTOR));
        const leafTargets = candidates.filter(candidate => {
            return !candidates.some(other => other !== candidate && candidate.contains(other));
        });
        if ((component.matches('.editable') || component.matches('h1, h2, h3, h4, h5, h6, p')) && !leafTargets.length) {
            leafTargets.push(component);
        }
        return leafTargets;
    }

    function activeSlide() {
        return deck.querySelector('.slide-wrap.is-active .slide');
    }

    function topLevelElements(slide = activeSlide()) {
        if (!slide) return [];
        return Array.from(slide.querySelectorAll('.ppt-element')).filter(element => {
            if (element.classList.contains('ppt-inner-element') || element.classList.contains('ppt-hidden')) return false;
            const parent = element.parentElement?.closest('.ppt-element');
            return !parent || parent === element || !slide.contains(parent);
        });
    }

    function elementRectInSlide(element) {
        const slide = element.closest('.slide');
        const slideRect = slide.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const scale = getScale();
        return {
            left: (rect.left - slideRect.left) / scale,
            top: (rect.top - slideRect.top) / scale,
            right: (rect.right - slideRect.left) / scale,
            bottom: (rect.bottom - slideRect.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale,
            centerX: (rect.left + rect.width / 2 - slideRect.left) / scale,
            centerY: (rect.top + rect.height / 2 - slideRect.top) / scale
        };
    }

    function selectionBounds(elements = getSelectedElements()) {
        if (!elements.length) return null;
        const rects = elements.map(elementRectInSlide);
        const left = Math.min(...rects.map(rect => rect.left));
        const top = Math.min(...rects.map(rect => rect.top));
        const right = Math.max(...rects.map(rect => rect.right));
        const bottom = Math.max(...rects.map(rect => rect.bottom));
        return {
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top,
            centerX: (left + right) / 2,
            centerY: (top + bottom) / 2
        };
    }

    function ensureGuides() {
        const slide = activeSlide();
        if (!slide) return;
        if (!verticalGuide || verticalGuide.parentElement !== slide) {
            verticalGuide?.remove();
            verticalGuide = document.createElement('div');
            verticalGuide.className = 'ppt-snap-guide is-vertical';
            slide.appendChild(verticalGuide);
        }
        if (!horizontalGuide || horizontalGuide.parentElement !== slide) {
            horizontalGuide?.remove();
            horizontalGuide = document.createElement('div');
            horizontalGuide.className = 'ppt-snap-guide is-horizontal';
            slide.appendChild(horizontalGuide);
        }
    }

    function hideGuides() {
        verticalGuide?.classList.remove('is-visible');
        horizontalGuide?.classList.remove('is-visible');
    }

    function snapDrag(dx, dy, baseBounds = null) {
        const selectedElements = getSelectedElements();
        const bounds = baseBounds || selectionBounds(selectedElements);
        const slide = activeSlide();
        if (!bounds || !slide) return { dx, dy };
        const others = Array.from(slide.querySelectorAll('.ppt-element'))
            .filter(element => !selectedSet.has(element) && !element.classList.contains('ppt-hidden'));
        const xTargets = [0, 960, 1920];
        const yTargets = [0, 540, 1080];
        others.forEach(element => {
            const rect = elementRectInSlide(element);
            xTargets.push(rect.left, rect.centerX, rect.right);
            yTargets.push(rect.top, rect.centerY, rect.bottom);
        });
        const movingX = [bounds.left + dx, bounds.centerX + dx, bounds.right + dx];
        const movingY = [bounds.top + dy, bounds.centerY + dy, bounds.bottom + dy];
        const threshold = 5;
        let bestX = null;
        let bestY = null;
        movingX.forEach(value => xTargets.forEach(target => {
            const diff = target - value;
            if (Math.abs(diff) <= threshold && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) {
                bestX = { diff, target };
            }
        }));
        movingY.forEach(value => yTargets.forEach(target => {
            const diff = target - value;
            if (Math.abs(diff) <= threshold && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) {
                bestY = { diff, target };
            }
        }));
        ensureGuides();
        if (bestX) {
            dx += bestX.diff;
            verticalGuide.style.left = `${bestX.target}px`;
            verticalGuide.classList.add('is-visible');
        } else {
            verticalGuide?.classList.remove('is-visible');
        }
        if (bestY) {
            dy += bestY.diff;
            horizontalGuide.style.top = `${bestY.target}px`;
            horizontalGuide.classList.add('is-visible');
        } else {
            horizontalGuide?.classList.remove('is-visible');
        }
        return { dx, dy };
    }

    function markComponents(root = deck) {
        const slides = root.classList?.contains('slide')
            ? [root]
            : (root.matches?.('.slide-wrap') ? [root.querySelector('.slide')] : Array.from(root.querySelectorAll('.slide'))).filter(Boolean);
        slides.forEach(slide => normalizeSlideElements(slide));

        root.querySelectorAll('.editable').forEach(editable => {
            editable.dataset.pptEditable = 'true';
            if (!editable.classList.contains('ppt-editing')) {
                editable.setAttribute('contenteditable', 'false');
            }
        });
        root.querySelectorAll(COMPONENT_SELECTOR).forEach(element => {
            // A vision picture wrapper is the editable object. Its backing img
            // must not appear again as a duplicate layer or intercept selection.
            if (element.matches('img') && element.closest('.vision-visual')) {
                element.classList.remove('ppt-element');
                return;
            }
            element.classList.add('ppt-element');
            element.dataset.pptElementId ||= createId();
            element.dataset.pptElementType ||= componentName(element);
            element.classList.toggle('ppt-hidden', element.dataset.pptHidden === 'true');
            if (element.dataset.pptHidden === 'true') element.style.visibility = 'hidden';
            if (element.matches(LOCKED_BY_DEFAULT) && !element.hasAttribute('data-ppt-lock-set')) {
                element.classList.add('ppt-locked');
                element.dataset.pptLockSet = 'true';
            }
        });
        root.querySelectorAll('.ppt-element').forEach(component => {
            internalEditTargets(component).forEach(target => {
                if (target === component) return;
                target.classList.add('ppt-inner-element');
                target.dataset.pptElementId ||= createId();
                target.dataset.pptElementType ||= componentName(target);
                target.dataset.pptEditable = 'true';
                if (target !== editingTarget) target.setAttribute('contenteditable', 'false');
            });
        });
    }

    function resolveComponent(target) {
        if (!target) return null;
        const inner = target.closest('.ppt-inner-element');
        if (inner && inner.closest('.slide')) return inner;
        const element = target.closest('.ppt-element');
        if (element && element.closest('.slide')) return element;
        const structural = target.closest(STRUCTURAL_COMPONENTS);
        if (structural && structural.closest('.slide')) return structural;
        const text = target.closest(STANDALONE_TEXT);
        if (text && text.closest('.slide')) return text;
        const editable = target.closest('.editable, h1, h2, h3, h4, h5, h6, p');
        return editable && editable.closest('.slide') ? editable : null;
    }

    function positionToolbar() {
        const bar = ensureToolbar();
        const elements = getSelectedElements();
        if (!elements.length || editingTarget) {
            bar.classList.remove('is-visible');
            return;
        }
        bar.querySelector('.ppt-component-name').textContent = elements.length > 1
            ? `已选 ${elements.length} 个`
            : selected.dataset.pptElementType || componentName(selected);
        bar.querySelector('[data-action="parent"]').style.display = parentComponent(selected) ? '' : 'none';
        bar.querySelector('[data-action="edit"]').style.display = elements.length === 1 ? '' : 'none';
        bar.querySelector('[data-action="lock"] i').className = elements.every(element => element.classList.contains('ppt-locked'))
            ? 'ph-bold ph-lock-key-open'
            : 'ph-bold ph-lock-key';
        
        // Add class before measuring so offsetHeight is not 0
        bar.classList.add('is-visible');
        
        const rects = elements.map(element => element.getBoundingClientRect());
        const leftEdge = Math.min(...rects.map(rect => rect.left));
        const topEdge = Math.min(...rects.map(rect => rect.top));
        const top = Math.max(8, topEdge - bar.offsetHeight - 8);
        const left = Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, leftEdge));
        bar.style.top = `${top}px`;
        bar.style.left = `${left}px`;
    }

    function rgbToHex(color) {
        const match = color?.match(/\d+/g);
        if (!match || match.length < 3) return '#000000';
        return `#${match.slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
    }

    function renderProperties() {
        if (!propertiesPanel) return;
        const elements = getSelectedElements();
        const empty = propertiesPanel.querySelector('.properties-empty');
        const content = propertiesPanel.querySelector('.properties-content');
        if (elements.length !== 1 || !selected) {
            empty.classList.remove('hidden');
            content.classList.add('hidden');
            empty.textContent = elements.length > 1 ? `已选择 ${elements.length} 个组件，可使用上方对齐工具` : '选择单个组件后编辑属性';
            return;
        }
        empty.classList.add('hidden');
        content.classList.remove('hidden');
        const rect = elementRectInSlide(selected);
        const computed = getComputedStyle(selected);
        const values = {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            rotate: parseFloat(selected.dataset.pptRotate || computed.rotate || '0') || 0,
            zIndex: parseInt(computed.zIndex, 10) || 0,
            opacity: Math.round((parseFloat(computed.opacity) || 1) * 100),
            borderRadius: parseFloat(computed.borderRadius) || 0,
            borderWidth: parseFloat(computed.borderWidth) || 0,
            padding: parseFloat(computed.padding) || 0
        };
        Object.entries(values).forEach(([property, value]) => {
            const input = content.querySelector(`[data-property="${property}"]`);
            if (input && document.activeElement !== input) input.value = String(Math.round(value * 100) / 100);
        });
        const borderColorInput = content.querySelector('[data-property="borderColor"]');
        if (document.activeElement !== borderColorInput) borderColorInput.value = rgbToHex(computed.borderColor);

        const editable = selectedEditable();
        const textSection = content.querySelector('.properties-text-section');
        textSection.classList.toggle('hidden', !editable);
        if (editable) {
            const style = getComputedStyle(editable);
            const fontFamilyInput = content.querySelector('[data-property="fontFamily"]');
            const fontSizeInput = content.querySelector('[data-property="fontSize"]');
            const lineHeightInput = content.querySelector('[data-property="lineHeight"]');
            const colorInput = content.querySelector('[data-property="color"]');
            const backgroundInput = content.querySelector('[data-property="backgroundColor"]');
            if (document.activeElement !== fontFamilyInput) {
                const currentFamily = style.fontFamily.toLowerCase();
                const matchingOption = Array.from(fontFamilyInput.options).find(option => {
                    const primaryFont = option.value.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
                    return currentFamily.includes(primaryFont);
                });
                fontFamilyInput.value = matchingOption?.value || 'Arial, sans-serif';
            }
            if (document.activeElement !== fontSizeInput) fontSizeInput.value = String(Math.round(parseFloat(style.fontSize) * 100) / 100);
            if (document.activeElement !== lineHeightInput) {
                const lineHeight = parseFloat(style.lineHeight);
                const fontSize = parseFloat(style.fontSize) || 1;
                lineHeightInput.value = String(Math.round((Number.isFinite(lineHeight) ? lineHeight / fontSize : 1.2) * 10) / 10);
            }
            if (document.activeElement !== colorInput) colorInput.value = rgbToHex(style.color);
            if (document.activeElement !== backgroundInput) backgroundInput.value = rgbToHex(getComputedStyle(selected).backgroundColor);
            content.querySelector('[data-style-action="bold"]').classList.toggle('is-active', Number(style.fontWeight) >= 600 || style.fontWeight === 'bold');
            content.querySelector('[data-style-action="italic"]').classList.toggle('is-active', style.fontStyle === 'italic');
            ['left', 'center', 'right'].forEach(align => {
                content.querySelector(`[data-style-action="align-${align}"]`).classList.toggle('is-active', style.textAlign === align);
            });
            content.querySelector('[data-style-action="format-painter"]')?.classList.toggle('is-active', Boolean(formatPainter));
        }

        const imageSection = content.querySelector('.properties-image-section');
        imageSection.classList.toggle('hidden', !isImageComponent());
        if (isImageComponent()) {
            const target = imageTarget();
            const fit = target.matches('img') ? getComputedStyle(target).objectFit : target.dataset.pptObjectFit || 'cover';
            content.querySelector('[data-property="objectFit"]').value = fit;
        }
        content.querySelector('.properties-table-section').classList.toggle('hidden', !isTableComponent());
    }

    function updateSelectionVisuals() {
        deck.querySelectorAll('.ppt-selected, .ppt-selected-secondary').forEach(element => {
            element.classList.remove('ppt-selected', 'ppt-selected-secondary');
        });
        getSelectedElements().forEach(element => {
            element.classList.add(element === selected ? 'ppt-selected' : 'ppt-selected-secondary');
        });
        const controls = ensureMoveable();
        if (controls) {
            const single = selectedSet.size === 1 && selected;
            const transformable = single && !single.classList.contains('ppt-locked') && !isLayoutBoundInner(single);
            controls.target = single || null;
            controls.resizable = Boolean(transformable);
            controls.rotatable = Boolean(transformable);
            refreshMoveable();
        }
        positionToolbar();
        renderLayers();
        renderProperties();
    }

    function select(element, additive = false) {
        if (!element || !element.isConnected) return clearSelection();
        if (!additive) applyFormatPainter(element);
        stopTextEditing();
        if (!additive) {
            selectedSet.clear();
            selectedSet.add(element);
            selected = element;
        } else if (selectedSet.has(element)) {
            selectedSet.delete(element);
            if (selected === element) selected = getSelectedElements().at(-1) || null;
        } else {
            selectedSet.add(element);
            selected = element;
        }
        updateSelectionVisuals();
        onSelectionChange?.(getSelectedElements());
        if (selectedSet.size) onStatus?.(selectedSet.size > 1 ? `已选择 ${selectedSet.size} 个组件` : `${componentName(selected)}已选中；Shift 点击多选`);
    }

    function clearSelection() {
        stopTextEditing();
        selectedSet.clear();
        selected = null;
        updateSelectionVisuals();
        hideGuides();
    }

    function selectParent() {
        const parent = parentComponent();
        if (parent) select(parent, false);
    }

    function placeCaretAtPoint(target, clientX, clientY) {
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.caretRangeFromPoint?.(clientX, clientY)
            || document.caretPositionFromPoint?.(clientX, clientY);
        if (!range) return;
        const node = range.startContainer || range.offsetNode;
        const offset = range.startOffset ?? range.offset;
        if (!node || !target.contains(node)) return;
        const caret = document.createRange();
        caret.setStart(node, offset);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
    }

    function startTextEditing(component, preferredEditable = null, point = null) {
        const editable = preferredEditable
            || (component.classList.contains('ppt-inner-element') ? component : null)
            || (component.matches('.editable, h1, h2, h3, h4, h5, h6, p, blockquote') ? component : component.querySelector('.editable, h1, h2, h3, h4, h5, h6, p, blockquote'));
        if (!editable) {
            onStatus?.('该组件没有可编辑文字');
            return;
        }
        stopTextEditing();
        editingComponent = component.classList.contains('ppt-inner-element') ? parentComponent(component) || component : component;
        editingTarget = editable;
        editingComponent.classList.add('ppt-editing');
        editable.classList.add('ppt-inner-editing');
        editable.setAttribute('contenteditable', 'true');
        editable.focus();
        if (point) {
            placeCaretAtPoint(editable, point.x, point.y);
        } else {
            const selection = window.getSelection();
            selection?.selectAllChildren(editable);
            selection?.collapseToEnd();
        }
        if (moveable) {
            moveable.target = null;
            moveable.resizable = false;
            moveable.rotatable = false;
            refreshMoveable();
        }
        positionToolbar();
    }

    function stopTextEditing() {
        deck.querySelectorAll('.ppt-editing').forEach(component => component.classList.remove('ppt-editing'));
        deck.querySelectorAll('.ppt-inner-editing').forEach(target => target.classList.remove('ppt-inner-editing'));
        deck.querySelectorAll('[data-ppt-editable="true"][contenteditable="true"]').forEach(editable => {
            editable.setAttribute('contenteditable', 'false');
        });
        window.getSelection()?.removeAllRanges();
        editingComponent = null;
        editingTarget = null;
        if (selected && moveable) {
            const enabled = !selected.classList.contains('ppt-locked');
            moveable.target = selectedSet.size === 1 ? selected : null;
            moveable.resizable = enabled;
            moveable.rotatable = enabled;
            refreshMoveable();
        }
        positionToolbar();
    }

    function deleteSelected() {
        const targets = getSelectedElements().filter(element => !element.classList.contains('ppt-locked'));
        if (!targets.length) return onStatus?.('所选组件均已锁定');
        clearSelection();
        targets.forEach(target => target.remove());
        commitChange();
    }

    function duplicateSelected() {
        const sources = getSelectedElements();
        if (!sources.length) return;
        const clones = sources.map(source => {
            const clone = source.cloneNode(true);
            clone.classList.remove('ppt-selected', 'ppt-selected-secondary', 'ppt-editing');
            clone.dataset.pptElementId = createId();
            
            const rect = elementRectInSlide(source);
            clone.style.position = 'absolute';
            clone.style.margin = '0';
            clone.style.left = `${rect.left + 15}px`;
            clone.style.top = `${rect.top + 15}px`;
            clone.style.width = `${rect.width}px`;
            clone.style.height = `${rect.height}px`;
            
            activeSlide().appendChild(clone);
            return clone;
        });
        markComponents(activeSlide());
        selectedSet.clear();
        clones.forEach(clone => selectedSet.add(clone));
        selected = clones.at(-1);
        updateSelectionVisuals();
        commitChange();
    }

    function groupSelected() {
        const elements = getSelectedElements();
        if (elements.length < 2) return;
        
        // 1. Snapshot all bounding rects BEFORE modifying the DOM to prevent flex layout shifts
        const rects = elements.map(el => ({
            el,
            rect: elementRectInSlide(el)
        }));
        
        const bounds = selectionBounds(elements);
        if (!bounds) return;

        const group = document.createElement('div');
        group.className = 'ppt-element ppt-group';
        group.style.position = 'absolute';
        group.style.left = `${bounds.left}px`;
        group.style.top = `${bounds.top}px`;
        group.style.width = `${bounds.width}px`;
        group.style.height = `${bounds.height}px`;
        group.dataset.pptElementType = 'group';
        group.dataset.pptElementId = createId();

        rects.forEach(({ el, rect }) => {
            el.style.position = 'absolute';
            el.style.margin = '0';
            el.style.left = `${rect.left - bounds.left}px`;
            el.style.top = `${rect.top - bounds.top}px`;
            el.style.width = `${rect.width}px`;
            el.style.height = `${rect.height}px`;
            
            el.classList.remove('ppt-element', 'ppt-selected', 'ppt-selected-secondary');
            el.classList.add('ppt-inner-element');
            group.appendChild(el);
        });

        activeSlide().appendChild(group);
        selectedSet.clear();
        selectedSet.add(group);
        selected = group;
        updateSelectionVisuals();
        refreshMoveable();
        commitChange();
        onStatus?.('已组合组件');
    }

    function ungroupSelected() {
        const groups = getSelectedElements().filter(el => el.classList.contains('ppt-group'));
        if (!groups.length) return;

        selectedSet.clear();
        const slide = activeSlide();

        groups.forEach(group => {
            const groupLeft = parseFloat(group.style.left || 0);
            const groupTop = parseFloat(group.style.top || 0);
            const children = Array.from(group.children);
            
            group.style.rotate = '0deg'; 
            group.dataset.pptRotate = '0';

            children.forEach(el => {
                const elLeft = parseFloat(el.style.left || 0);
                const elTop = parseFloat(el.style.top || 0);
                el.style.left = `${groupLeft + elLeft}px`;
                el.style.top = `${groupTop + elTop}px`;
                
                el.classList.remove('ppt-inner-element');
                el.classList.add('ppt-element');
                slide.appendChild(el);
                selectedSet.add(el);
            });
            group.remove();
        });

        selected = getSelectedElements().at(-1);
        updateSelectionVisuals();
        refreshMoveable();
        commitChange();
        onStatus?.('已取消组合');
    }

    function copySelected() {
        const sources = getSelectedElements();
        if (!sources.length) return;
        clipboard = sources.map(source => {
            const clone = source.cloneNode(true);
            clone.classList.remove('ppt-selected', 'ppt-selected-secondary', 'ppt-editing');
            return {
                node: clone,
                rect: elementRectInSlide(source)
            };
        });
        pasteCount = 0;
        onStatus?.(`已复制 ${clipboard.length} 个组件`);
    }

    function cutSelected() {
        if (!selectedSet.size) return;
        copySelected();
        deleteSelected();
    }

    function selectAllComponents() {
        const slide = activeSlide();
        if (!slide) return;
        const elements = Array.from(slide.querySelectorAll('.ppt-element')).filter(el => !el.classList.contains('ppt-locked') && !el.classList.contains('ppt-hidden'));
        if (!elements.length) return;
        selectedSet.clear();
        elements.forEach(el => selectedSet.add(el));
        selected = elements.at(-1);
        updateSelectionVisuals();
        refreshMoveable();
        positionToolbar();
        onStatus?.(`已全选 ${elements.length} 个组件`);
    }

    function pasteClipboard() {
        if (!clipboard.length) return;
        const slide = activeSlide();
        if (!slide) return;
        
        pasteCount++;
        
        const clones = clipboard.map(item => {
            const clone = item.node.cloneNode(true);
            clone.dataset.pptElementId = createId();
            clone.style.position = 'absolute';
            clone.style.margin = '0';
            
            let offsetX = pasteCount * 60;
            let offsetY = pasteCount * 60;
            
            if (item.rect.left + offsetX + item.rect.width > 1920 || item.rect.top + offsetY + item.rect.height > 1080) {
                pasteCount = 1;
                offsetX = 60;
                offsetY = 60;
            }
            
            clone.style.left = `${item.rect.left + offsetX}px`;
            clone.style.top = `${item.rect.top + offsetY}px`;
            clone.style.width = `${item.rect.width}px`;
            clone.style.height = `${item.rect.height}px`;
            
            slide.appendChild(clone);
            return clone;
        });
        markComponents(slide);
        selectedSet.clear();
        clones.forEach(clone => selectedSet.add(clone));
        selected = clones.at(-1);
        updateSelectionVisuals();
        commitChange();
    }

    function toggleLock() {
        const elements = getSelectedElements();
        if (!elements.length) return;
        const shouldLock = !elements.every(element => element.classList.contains('ppt-locked'));
        elements.forEach(element => {
            element.classList.toggle('ppt-locked', shouldLock);
            element.dataset.pptLockSet = 'true';
        });
        updateSelectionVisuals();
        commitChange();
    }

    function bringToFront() {
        const elements = getSelectedElements();
        if (!elements.length) return;
        const siblings = Array.from(elements[0].parentElement.children);
        const maxZ = siblings.reduce((max, node) => Math.max(max, parseInt(getComputedStyle(node).zIndex, 10) || 0), 0);
        elements.forEach((element, index) => {
            element.style.zIndex = String(maxZ + index + 1);
        });
        commitChange();
    }

    function nudge(dx, dy) {
        const elements = getSelectedElements().filter(element => !element.classList.contains('ppt-locked'));
        if (!elements.length) return;
        elements.forEach(element => {
            element.style.position = element.style.position || (getComputedStyle(element).position === 'static' ? 'relative' : getComputedStyle(element).position);
            element.style.left = `${numberStyle(element, 'left') + dx}px`;
            element.style.top = `${numberStyle(element, 'top') + dy}px`;
        });
        refreshMoveable();
        positionToolbar();
        commitChange();
    }

    function commitChange() {
        refreshMoveable();
        positionToolbar();
        renderLayers();
        onChange?.();
    }

    function describeElement(element) {
        const editable = selectedEditable(element);
        const style = getComputedStyle(element);
        const textStyle = editable ? getComputedStyle(editable) : null;
        return {
            id: element.dataset.pptElementId,
            type: element.dataset.pptElementType || componentName(element),
            locked: element.classList.contains('ppt-locked'),
            text: editable?.innerText || '',
            html: editable?.innerHTML || '',
            rect: elementRectInSlide(element),
            style: {
                backgroundColor: style.backgroundColor,
                borderColor: style.borderColor,
                borderWidth: style.borderWidth,
                borderRadius: style.borderRadius,
                opacity: style.opacity,
                padding: style.padding,
                color: textStyle?.color || style.color,
                fontFamily: textStyle?.fontFamily || '',
                fontSize: textStyle?.fontSize || '',
                fontWeight: textStyle?.fontWeight || '',
                fontStyle: textStyle?.fontStyle || '',
                lineHeight: textStyle?.lineHeight || '',
                textAlign: textStyle?.textAlign || ''
            }
        };
    }

    function getSelectionContext() {
        const elements = getSelectedElements();
        if (!elements.length) return null;
        return {
            scope: elements.length === 1 ? 'single' : 'selection',
            components: elements.map(describeElement),
            bounds: selectionBounds(elements)
        };
    }

    function getPageContext() {
        const elements = topLevelElements();
        return {
            scope: 'page',
            slide: { width: 1920, height: 1080 },
            components: elements.slice(0, 80).map(describeElement)
        };
    }

    function applyAiActions(actions, scope = 'selection') {
        if (!Array.isArray(actions)) return 0;
        const scopedElements = scope === 'page'
            ? topLevelElements()
            : getSelectedElements();
        if (!scopedElements.length) return 0;
        const elementById = new Map(scopedElements.map(element => [element.dataset.pptElementId, element]));
        const allowedOuterStyles = new Set([
            'backgroundColor', 'borderColor', 'borderWidth', 'borderRadius',
            'borderStyle', 'boxShadow', 'opacity', 'padding'
        ]);
        const allowedTextStyles = new Set([
            'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
            'lineHeight', 'letterSpacing', 'textAlign', 'textDecoration'
        ]);
        const pixelStyles = new Set([
            'borderWidth', 'borderRadius', 'padding', 'fontSize', 'letterSpacing'
        ]);
        let applied = 0;
        const resolveTargets = action => {
            if (action.target === 'all') return scopedElements;
            if (Array.isArray(action.targets)) return action.targets.map(id => elementById.get(id)).filter(Boolean);
            if (action.target && elementById.has(action.target)) return [elementById.get(action.target)];
            return scopedElements.length === 1 ? scopedElements : [];
        };
        actions.slice(0, 40).forEach(action => {
            if (!action || typeof action !== 'object') return;
            const targets = resolveTargets(action).filter(element => !element.classList.contains('ppt-locked'));
            if (action.type === 'setText' && typeof action.value === 'string') {
                targets.forEach(element => {
                    const editable = selectedEditable(element);
                    if (!editable) return;
                    editable.textContent = action.value.slice(0, 5000);
                    applied++;
                });
            }
            if (action.type === 'setStyle' && action.styles && typeof action.styles === 'object') {
                targets.forEach(element => {
                    const editable = selectedEditable(element);
                    Object.entries(action.styles).forEach(([key, value]) => {
                        if (typeof value !== 'string' && typeof value !== 'number') return;
                        const normalizedValue = typeof value === 'number' && pixelStyles.has(key) ? `${value}px` : value;
                        const safeValue = String(normalizedValue).trim();
                        if (!safeValue || /url\s*\(|expression\s*\(|javascript:|[;}]/i.test(safeValue)) return;
                        if (allowedOuterStyles.has(key)) {
                            element.style[key] = safeValue;
                            applied++;
                        } else if (editable && allowedTextStyles.has(key)) {
                            editable.style[key] = safeValue;
                            applied++;
                        }
                    });
                });
            }
            if (action.type === 'move') {
                const dx = Number(action.dx) || 0;
                const dy = Number(action.dy) || 0;
                targets.forEach(element => {
                    moveBy(element, Math.max(-1920, Math.min(1920, dx)), Math.max(-1080, Math.min(1080, dy)));
                    applied++;
                });
            }
            if (action.type === 'setPosition') {
                targets.forEach(element => {
                    const rect = elementRectInSlide(element);
                    const x = Number.isFinite(Number(action.x)) ? Number(action.x) : rect.left;
                    const y = Number.isFinite(Number(action.y)) ? Number(action.y) : rect.top;
                    moveBy(element, Math.max(0, Math.min(1920, x)) - rect.left, Math.max(0, Math.min(1080, y)) - rect.top);
                    applied++;
                });
            }
            if (action.type === 'resize') {
                targets.forEach(element => {
                    if (Number.isFinite(Number(action.width))) element.style.width = `${Math.max(12, Math.min(1920, Number(action.width)))}px`;
                    if (Number.isFinite(Number(action.height))) element.style.height = `${Math.max(12, Math.min(1080, Number(action.height)))}px`;
                    applied++;
                });
            }
            if (action.type === 'align' && targets.length >= 2) {
                const entries = targets.map(element => ({ element, rect: elementRectInSlide(element) }));
                const bounds = selectionBounds(targets);
                const mode = String(action.mode || 'left');
                if (mode === 'left') entries.forEach(entry => moveBy(entry.element, bounds.left - entry.rect.left, 0));
                if (mode === 'center') entries.forEach(entry => moveBy(entry.element, bounds.centerX - entry.rect.centerX, 0));
                if (mode === 'right') entries.forEach(entry => moveBy(entry.element, bounds.right - entry.rect.right, 0));
                if (mode === 'top') entries.forEach(entry => moveBy(entry.element, 0, bounds.top - entry.rect.top));
                if (mode === 'middle') entries.forEach(entry => moveBy(entry.element, 0, bounds.centerY - entry.rect.centerY));
                if (mode === 'bottom') entries.forEach(entry => moveBy(entry.element, 0, bounds.bottom - entry.rect.bottom));
                applied++;
            }
            if (action.type === 'grid' && targets.length >= 2) {
                const columns = Math.max(1, Math.min(6, Number(action.columns) || 2));
                const gap = Math.max(0, Math.min(60, Number(action.gap) || 12));
                const startX = Math.max(0, Math.min(440, Number(action.x) || 40));
                const startY = Math.max(0, Math.min(320, Number(action.y) || 70));
                const totalWidth = Math.max(20, Math.min(440, Number(action.width) || 400));
                const cellWidth = (totalWidth - gap * (columns - 1)) / columns;
                targets.forEach((element, index) => {
                    const rect = elementRectInSlide(element);
                    const rowHeight = Math.max(20, Number(action.rowHeight) || rect.height);
                    const targetX = startX + (index % columns) * (cellWidth + gap);
                    const targetY = startY + Math.floor(index / columns) * (rowHeight + gap);
                    moveBy(element, targetX - rect.left, targetY - rect.top);
                    if (action.equalWidth !== false) element.style.width = `${cellWidth}px`;
                    applied++;
                });
            }
        });
        if (applied) {
            updateSelectionVisuals();
            commitChange();
        }
        return applied;
    }

    function auditPageLayout() {
        const elements = topLevelElements().filter(element => !element.classList.contains('ppt-locked'));
        const issues = [];
        elements.forEach(element => {
            const rect = elementRectInSlide(element);
            if (rect.left < 0 || rect.top < 0 || rect.right > 1920 || rect.bottom > 1080) {
                issues.push({ type: 'outOfBounds', id: element.dataset.pptElementId, name: componentName(element) });
            }
            const editable = selectedEditable(element);
            if (editable && (editable.scrollWidth > editable.clientWidth + 2 || editable.scrollHeight > editable.clientHeight + 2)) {
                issues.push({ type: 'textOverflow', id: element.dataset.pptElementId, name: componentName(element) });
            }
        });
        for (let i = 0; i < elements.length; i++) {
            const a = elementRectInSlide(elements[i]);
            for (let j = i + 1; j < elements.length; j++) {
                if (elements[i].contains(elements[j]) || elements[j].contains(elements[i])) continue;
                const b = elementRectInSlide(elements[j]);
                const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
                const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
                const overlapArea = overlapWidth * overlapHeight;
                const smallerArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
                if (overlapArea / smallerArea > .18) {
                    issues.push({
                        type: 'overlap',
                        ids: [elements[i].dataset.pptElementId, elements[j].dataset.pptElementId],
                        names: [componentName(elements[i]), componentName(elements[j])]
                    });
                }
            }
        }
        return issues;
    }

    function autoFixPageLayout() {
        const slide = activeSlide();
        const elements = topLevelElements(slide).filter(element => !element.classList.contains('ppt-locked'));
        let fixed = 0;
        elements.forEach(element => {
            const rect = elementRectInSlide(element);
            const targetX = Math.max(8, Math.min(472 - rect.width, rect.left));
            const targetY = Math.max(8, Math.min(352 - rect.height, rect.top));
            if (targetX !== rect.left || targetY !== rect.top) {
                moveBy(element, targetX - rect.left, targetY - rect.top);
                fixed++;
            }
            const editable = selectedEditable(element);
            if (editable && editable.scrollHeight > editable.clientHeight + 2) {
                let size = parseFloat(getComputedStyle(editable).fontSize) || 10;
                while (size > 6 && editable.scrollHeight > editable.clientHeight + 2) {
                    size -= .5;
                    editable.style.fontSize = `${size}px`;
                }
                fixed++;
            }
        });

        const movable = elements.filter(element => !/标题/.test(componentName(element)));
        const overlaps = auditPageLayout().filter(issue => issue.type === 'overlap');
        if (overlaps.length && movable.length >= 2) {
            const columns = movable.length >= 5 ? 3 : 2;
            const gap = 10;
            const startX = 34;
            const startY = 72;
            const totalWidth = 412;
            const cellWidth = (totalWidth - gap * (columns - 1)) / columns;
            const rows = Math.ceil(movable.length / columns);
            const rowHeight = Math.max(48, Math.min(110, (250 - gap * (rows - 1)) / rows));
            movable.forEach((element, index) => {
                const rect = elementRectInSlide(element);
                const x = startX + (index % columns) * (cellWidth + gap);
                const y = startY + Math.floor(index / columns) * (rowHeight + gap);
                moveBy(element, x - rect.left, y - rect.top);
                element.style.width = `${cellWidth}px`;
                element.style.height = `${rowHeight}px`;
                fixed++;
            });
        }
        if (fixed) {
            updateSelectionVisuals();
            commitChange();
        }
        return { fixed, remaining: auditPageLayout() };
    }

    function unifyDeckStyle() {
        let changed = 0;
        deck.querySelectorAll('.slide').forEach(slide => {
            slide.querySelectorAll('.slide-title, .small-title').forEach(title => {
                title.style.fontFamily = "'Microsoft YaHei', 'PingFang SC', sans-serif";
                title.style.fontWeight = '700';
                title.style.color = 'var(--red)';
                changed++;
            });
            slide.querySelectorAll('.editable').forEach(editable => {
                if (!editable.matches('.slide-title, .small-title')) {
                    editable.style.fontFamily = "'Microsoft YaHei', 'PingFang SC', sans-serif";
                    editable.style.lineHeight ||= '1.4';
                    changed++;
                }
            });
            slide.querySelectorAll('.ppt-card, .rule-box, .box').forEach(card => {
                card.style.borderRadius = '8px';
                card.style.borderColor = '#d4d4d8';
                card.style.borderStyle = 'solid';
                card.style.borderWidth = '1px';
                changed++;
            });
            slide.querySelectorAll('.footer').forEach(footer => {
                footer.style.fontFamily = "Arial, 'Microsoft YaHei', sans-serif";
                footer.style.opacity = '.85';
                changed++;
            });
        });
        if (changed) commitChange();
        return changed;
    }

    function handleClick(event) {
        if (suppressClick) {
            suppressClick = false;
        }
        // Selection is now fully handled by pointer events (handlePointerDown/Up)
        // to ensure robustness across browsers and drag scenarios.
    }

    function handleDoubleClick(event) {
        const component = resolveComponent(event.target);
        if (!component) return;
        select(component, false);
        const exactTarget = event.target.closest('.ppt-inner-element, td, th, li, .editable, h1, h2, h3, h4, h5, h6, p, blockquote');
        startTextEditing(component, exactTarget, { x: event.clientX, y: event.clientY });
        event.preventDefault();
        event.stopPropagation();
    }

    function addElement(kind) {
        const slide = deck.querySelector('.slide-wrap.is-active .slide');
        if (!slide) return;
        let element;
        if (kind === 'title') {
            element = document.createElement('h2');
            element.className = 'ppt-created-element ht-created-title editable';
            element.dataset.componentName = '页面标题';
            element.textContent = '点击输入页面标题';
            Object.assign(element.style, { width: '1040px', minHeight: '86px' });
        } else if (kind === 'text') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ht-created-text editable';
            element.dataset.componentName = '正文文本';
            element.innerHTML = '在此输入正文内容。建议保持观点简洁、层次清晰。';
            Object.assign(element.style, { width: '760px', minHeight: '150px' });
        } else if (kind === 'image') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-image-placeholder ht-created-image';
            element.dataset.componentName = '图片';
            element.innerHTML = '<span>IMAGE</span><strong>双击或拖入图片</strong><small>支持 PNG / JPG</small>';
            Object.assign(element.style, { width: '620px', height: '360px' });
        } else if (kind === 'table') {
            element = document.createElement('table');
            element.className = 'ppt-created-element ht-created-table';
            element.dataset.componentName = '数据表格';
            element.style.width = '1120px';
            element.innerHTML = `
                <tbody class="editable" contenteditable="false">
                    <tr><th>项目</th><th>当前状态</th><th>负责人</th><th>计划时间</th></tr>
                    <tr><td>重点任务一</td><td>进行中</td><td>责任人</td><td>YYYY-MM-DD</td></tr>
                    <tr><td>重点任务二</td><td>待启动</td><td>责任人</td><td>YYYY-MM-DD</td></tr>
                </tbody>
            `;
        } else if (kind === 'note') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ht-created-note editable';
            element.dataset.componentName = '重点提示';
            element.innerHTML = '<strong>重点提示</strong><br>双击编辑需要特别强调的结论或行动要求。';
            Object.assign(element.style, { width: '650px', minHeight: '190px' });
        } else if (kind === 'card') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-card ht-created-card editable';
            element.dataset.componentName = '内容卡片';
            element.innerHTML = '<i>01</i><strong>卡片标题</strong><span>用一段简洁内容说明核心观点、进展或结论。</span>';
            Object.assign(element.style, { width: '500px', minHeight: '270px' });
        } else if (kind === 'shape') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-shape ht-created-shape';
            element.dataset.componentName = '强调形状';
            Object.assign(element.style, {
                width: '220px', height: '150px'
            });
        } else if (kind === 'line') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-line ht-created-line';
            element.dataset.componentName = '分隔线';
            Object.assign(element.style, {
                width: '680px', height: '8px'
            });
        } else if (kind === 'icon') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-icon ht-created-icon editable';
            element.dataset.componentName = '编号图标';
            element.textContent = '01';
            Object.assign(element.style, {
                width: '120px', height: '120px'
            });
        } else if (kind === 'timeline') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-timeline ht-created-timeline';
            element.dataset.componentName = '时间轴';
            element.innerHTML = `
                <div class="ppt-timeline-line"></div>
                <div class="ppt-timeline-item editable"><b>01</b><span>现状分析</span><small>明确问题与目标</small></div>
                <div class="ppt-timeline-item editable"><b>02</b><span>方案实施</span><small>落实责任与动作</small></div>
                <div class="ppt-timeline-item editable"><b>03</b><span>闭环验证</span><small>复盘结果并固化</small></div>
            `;
            Object.assign(element.style, { width: '1320px', height: '300px' });
        } else if (kind === 'metric') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-card ht-created-metric bg-white rounded-2xl p-8 border border-slate-200/90 shadow-md flex flex-col justify-between';
            element.dataset.componentName = '指标数据卡';
            element.innerHTML = `
                <div class="flex items-center justify-between">
                    <span class="text-xl font-bold text-slate-500 editable ppt-inner-element">关键业务指标</span>
                    <span class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-bold editable ppt-inner-element">+15.8% ↑</span>
                </div>
                <div class="my-4">
                    <span class="text-7xl font-black text-indigo-600 tracking-tight editable ppt-inner-element">99.98%</span>
                </div>
                <p class="text-xl text-slate-600 editable ppt-inner-element">核心系统无中断连续高可用运行保障</p>
            `;
            Object.assign(element.style, { width: '560px', minHeight: '270px' });
        } else if (kind === 'process') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-card ht-created-process bg-white/95 rounded-2xl p-8 border border-slate-200/90 shadow-md';
            element.dataset.componentName = '流程步骤';
            element.innerHTML = `
                <div class="grid grid-cols-3 gap-6">
                    <div class="p-5 bg-slate-50 rounded-xl border border-slate-200/60 flex flex-col justify-between">
                        <div class="w-12 h-12 rounded-xl bg-indigo-600 text-white font-black text-2xl flex items-center justify-center mb-3 editable ppt-inner-element">01</div>
                        <h4 class="text-2xl font-bold text-slate-800 mb-2 editable ppt-inner-element">感知发现</h4>
                        <p class="text-lg text-slate-500 editable ppt-inner-element">多源威胁情报实时汇聚感知</p>
                    </div>
                    <div class="p-5 bg-slate-50 rounded-xl border border-slate-200/60 flex flex-col justify-between">
                        <div class="w-12 h-12 rounded-xl bg-indigo-600 text-white font-black text-2xl flex items-center justify-center mb-3 editable ppt-inner-element">02</div>
                        <h4 class="text-2xl font-bold text-slate-800 mb-2 editable ppt-inner-element">分析定级</h4>
                        <p class="text-lg text-slate-500 editable ppt-inner-element">自动化编排与风险影响评估</p>
                    </div>
                    <div class="p-5 bg-slate-50 rounded-xl border border-slate-200/60 flex flex-col justify-between">
                        <div class="w-12 h-12 rounded-xl bg-indigo-600 text-white font-black text-2xl flex items-center justify-center mb-3 editable ppt-inner-element">03</div>
                        <h4 class="text-2xl font-bold text-slate-800 mb-2 editable ppt-inner-element">闭环处置</h4>
                        <p class="text-lg text-slate-500 editable ppt-inner-element">秒级拦截联动，沉淀防护规则</p>
                    </div>
                </div>
            `;
            Object.assign(element.style, { width: '1180px', minHeight: '260px' });
        } else if (kind === 'comparison') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-card ht-created-comparison bg-white rounded-2xl p-8 border border-slate-200/90 shadow-md';
            element.dataset.componentName = '对比矩阵';
            element.innerHTML = `
                <div class="grid grid-cols-2 gap-8">
                    <div class="p-6 bg-rose-50/70 border border-rose-200 rounded-2xl">
                        <span class="inline-block px-3 py-1 bg-rose-500 text-white text-sm font-bold rounded-full mb-3 editable ppt-inner-element">传统旧模式 (Before)</span>
                        <h4 class="text-2xl font-bold text-rose-900 mb-3 editable ppt-inner-element">人工响应迟缓与割裂</h4>
                        <ul class="space-y-2 text-lg text-slate-700">
                            <li class="editable ppt-inner-element">✕ 告警日均超 1000 条，疲于应付</li>
                            <li class="editable ppt-inner-element">✕ 平均处置时长超 3.5 小时</li>
                        </ul>
                    </div>
                    <div class="p-6 bg-emerald-50/70 border border-emerald-200 rounded-2xl">
                        <span class="inline-block px-3 py-1 bg-emerald-600 text-white text-sm font-bold rounded-full mb-3 editable ppt-inner-element">升级新模式 (After)</span>
                        <h4 class="text-2xl font-bold text-emerald-900 mb-3 editable ppt-inner-element">自动化编排与秒级阻断</h4>
                        <ul class="space-y-2 text-lg text-slate-700">
                            <li class="editable ppt-inner-element">✓ 智能压降 90% 重复无效告警</li>
                            <li class="editable ppt-inner-element">✓ 闭环自动化处置率达到 92%</li>
                        </ul>
                    </div>
                </div>
            `;
            Object.assign(element.style, { width: '1080px', minHeight: '290px' });
        } else if (kind === 'bento') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-card ht-created-bento bg-white/95 rounded-2xl p-8 border border-slate-200/90 shadow-md';
            element.dataset.componentName = 'Bento 栅格';
            element.innerHTML = `
                <div class="grid grid-cols-3 gap-6">
                    <div class="col-span-2 p-6 bg-gradient-to-br from-indigo-50/60 to-white border border-indigo-100 rounded-2xl flex flex-col justify-between">
                        <div>
                            <span class="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded-lg editable ppt-inner-element">战略重点</span>
                            <h3 class="text-3xl font-extrabold text-slate-900 mt-4 mb-2 editable ppt-inner-element">新一代安全智能运营中枢</h3>
                            <p class="text-xl text-slate-600 leading-relaxed editable ppt-inner-element">集成大数据流批处理与生成式 AI 研判引擎，实现全链路实时监测与自治防护。</p>
                        </div>
                    </div>
                    <div class="p-6 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col justify-between">
                        <span class="text-sm font-bold text-slate-400 uppercase tracking-wider editable ppt-inner-element">运行战果</span>
                        <div class="text-6xl font-black text-indigo-600 my-2 editable ppt-inner-element">0 事故</div>
                        <p class="text-base text-slate-500 editable ppt-inner-element">连续安全无故障运行 730 天</p>
                    </div>
                </div>
            `;
            Object.assign(element.style, { width: '1180px', minHeight: '300px' });
        } else if (kind === 'quote') {
            element = document.createElement('div');
            element.className = 'ppt-created-element ppt-card ht-created-quote bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-8 border border-slate-700 shadow-2xl flex flex-col justify-between';
            element.dataset.componentName = '核心金句';
            element.innerHTML = `
                <span class="text-6xl text-indigo-400 font-serif leading-none">“</span>
                <p class="text-3xl font-bold text-slate-100 my-4 leading-relaxed editable ppt-inner-element">安全不是业务奔跑的刹车皮，而是保障高速驰骋的安全带。</p>
                <div class="flex items-center gap-4">
                    <span class="px-3 py-1 bg-indigo-500 text-white text-sm font-semibold rounded-full editable ppt-inner-element">核心战略金句</span>
                    <span class="text-lg text-slate-400 editable ppt-inner-element">网络安全工作研讨总结</span>
                </div>
            `;
            Object.assign(element.style, { width: '920px', minHeight: '260px' });
        }
        if (!element) return;
        const createdCount = slide.querySelectorAll('.ppt-created-element').length;
        element.style.position = 'absolute';
        element.style.left = `${180 + (createdCount % 4) * 38}px`;
        element.style.top = `${260 + (createdCount % 5) * 38}px`;
        element.style.zIndex = String(20 + createdCount);
        slide.appendChild(element);
        markComponents(slide);
        select(element);
        commitChange();
        if (['title', 'text', 'note', 'card', 'icon', 'metric', 'process', 'comparison', 'bento', 'quote'].includes(kind)) {
            startTextEditing(element);
        }
    }

    function layerElements() {
        const slide = activeSlide();
        if (!slide) return [];
        return Array.from(slide.querySelectorAll('.ppt-element')).sort((a, b) => {
            const zA = parseInt(getComputedStyle(a).zIndex, 10) || 0;
            const zB = parseInt(getComputedStyle(b).zIndex, 10) || 0;
            if (zA !== zB) return zB - zA;
            return Array.from(slide.querySelectorAll('.ppt-element')).indexOf(b)
                - Array.from(slide.querySelectorAll('.ppt-element')).indexOf(a);
        });
    }

    function renderLayers() {
        if (!layersList) return;
        const elements = layerElements();
        layersList.innerHTML = elements.map(element => {
            const id = element.dataset.pptElementId;
            const name = element.dataset.pptElementType || componentName(element);
            const hidden = element.dataset.pptHidden === 'true';
            const locked = element.classList.contains('ppt-locked');
            const isSelected = selectedSet.has(element);
            return `
                <div class="layer-row ${isSelected ? 'is-selected' : ''} ${hidden ? 'is-hidden' : ''}" draggable="true" data-layer-id="${id}">
                    <span class="layer-drag-handle" title="拖动调整层级"><i class="ph-bold ph-dots-six-vertical"></i></span>
                    <button type="button" class="layer-action" data-layer-action="visibility" title="${hidden ? '显示' : '隐藏'}">
                        <i class="ph-bold ${hidden ? 'ph-eye-slash' : 'ph-eye'}"></i>
                    </button>
                    <span class="layer-name" title="${name}">${name}</span>
                    <button type="button" class="layer-action" data-layer-action="lock" title="${locked ? '解锁' : '锁定'}">
                        <i class="ph-bold ${locked ? 'ph-lock-key' : 'ph-lock-key-open'}"></i>
                    </button>
                    <button type="button" class="layer-action" data-layer-action="raise" title="上移一层">
                        <i class="ph-bold ph-caret-up"></i>
                    </button>
                </div>
            `;
        }).join('');
        document.querySelectorAll('.layers-align-actions button').forEach(button => {
            const distribute = button.dataset.align?.startsWith('distribute');
            button.disabled = selectedSet.size < (distribute ? 3 : 2);
        });
    }

    function findLayerElement(id) {
        return activeSlide()?.querySelector(`.ppt-element[data-ppt-element-id="${CSS.escape(id)}"]`) || null;
    }

    function toggleVisibility(element) {
        const hidden = element.dataset.pptHidden !== 'true';
        element.dataset.pptHidden = String(hidden);
        element.classList.toggle('ppt-hidden', hidden);
        element.style.visibility = hidden ? 'hidden' : '';
        if (hidden && selectedSet.has(element)) {
            selectedSet.delete(element);
            if (selected === element) selected = getSelectedElements().at(-1) || null;
        }
        updateSelectionVisuals();
        commitChange();
    }

    function raiseLayer(element) {
        const elements = layerElements().reverse();
        elements.forEach((item, index) => {
            item.style.zIndex = String(index + 1);
        });
        element.style.zIndex = String(elements.length + 1);
        commitChange();
    }

    function reorderLayer(draggedId, targetId, placement = 'before') {
        const orderedTopDown = layerElements();
        const dragged = findLayerElement(draggedId);
        const target = findLayerElement(targetId);
        if (!dragged || !target || dragged === target) return;
        const without = orderedTopDown.filter(element => element !== dragged);
        const targetIndex = without.indexOf(target);
        without.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, dragged);
        without.reverse().forEach((element, index) => {
            element.style.zIndex = String(index + 1);
        });
        commitChange();
    }

    function clearLayerDragFeedback() {
        layersList?.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after').forEach(row => {
            row.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
        });
    }

    function updateLayerDropFeedback(row, clientY) {
        if (!row || row.classList.contains('is-dragging')) return null;
        layersList.querySelectorAll('.is-drop-before, .is-drop-after').forEach(item => {
            if (item !== row) item.classList.remove('is-drop-before', 'is-drop-after');
        });
        const placement = clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'before' : 'after';
        row.classList.toggle('is-drop-before', placement === 'before');
        row.classList.toggle('is-drop-after', placement === 'after');
        return placement;
    }

    function moveBy(element, dx, dy) {
        element.style.position = element.style.position || (getComputedStyle(element).position === 'static' ? 'relative' : getComputedStyle(element).position);
        element.style.left = `${numberStyle(element, 'left') + dx}px`;
        element.style.top = `${numberStyle(element, 'top') + dy}px`;
    }

    function alignSelection(action) {
        const elements = getSelectedElements().filter(element => !element.classList.contains('ppt-locked'));
        if (elements.length < 2) return;
        const entries = elements.map(element => ({ element, rect: elementRectInSlide(element) }));
        const bounds = selectionBounds(elements);
        if (action === 'left') entries.forEach(entry => moveBy(entry.element, bounds.left - entry.rect.left, 0));
        if (action === 'center') entries.forEach(entry => moveBy(entry.element, bounds.centerX - entry.rect.centerX, 0));
        if (action === 'right') entries.forEach(entry => moveBy(entry.element, bounds.right - entry.rect.right, 0));
        if (action === 'top') entries.forEach(entry => moveBy(entry.element, 0, bounds.top - entry.rect.top));
        if (action === 'middle') entries.forEach(entry => moveBy(entry.element, 0, bounds.centerY - entry.rect.centerY));
        if (action === 'bottom') entries.forEach(entry => moveBy(entry.element, 0, bounds.bottom - entry.rect.bottom));
        if (action === 'distribute-h' && entries.length >= 3) {
            const sorted = entries.sort((a, b) => a.rect.left - b.rect.left);
            const totalWidth = sorted.reduce((sum, entry) => sum + entry.rect.width, 0);
            const gap = (bounds.width - totalWidth) / (sorted.length - 1);
            let cursor = bounds.left;
            sorted.forEach(entry => {
                moveBy(entry.element, cursor - entry.rect.left, 0);
                cursor += entry.rect.width + gap;
            });
        }
        if (action === 'distribute-v' && entries.length >= 3) {
            const sorted = entries.sort((a, b) => a.rect.top - b.rect.top);
            const totalHeight = sorted.reduce((sum, entry) => sum + entry.rect.height, 0);
            const gap = (bounds.height - totalHeight) / (sorted.length - 1);
            let cursor = bounds.top;
            sorted.forEach(entry => {
                moveBy(entry.element, 0, cursor - entry.rect.top);
                cursor += entry.rect.height + gap;
            });
        }
        commitChange();
    }

    function applyNumericProperty(property, rawValue) {
        if (!selected || selectedSet.size !== 1) return;
        const value = Number(rawValue);
        if (!Number.isFinite(value)) return;
        const rect = elementRectInSlide(selected);
        if (property === 'x') moveBy(selected, value - rect.left, 0);
        if (property === 'y') moveBy(selected, 0, value - rect.top);
        if (property === 'width') selected.style.width = `${Math.max(12, value)}px`;
        if (property === 'height') selected.style.height = `${Math.max(12, value)}px`;
        if (property === 'rotate') {
            selected.dataset.pptRotate = String(value);
            selected.style.rotate = `${value}deg`;
        }
        if (property === 'zIndex') selected.style.zIndex = String(Math.max(0, Math.round(value)));
        if (property === 'opacity') selected.style.opacity = String(Math.max(0, Math.min(100, value)) / 100);
        if (property === 'borderRadius') selected.style.borderRadius = `${Math.max(0, value)}px`;
        if (property === 'borderWidth') {
            selected.style.borderStyle = value > 0 ? (getComputedStyle(selected).borderStyle === 'none' ? 'solid' : getComputedStyle(selected).borderStyle) : 'none';
            selected.style.borderWidth = `${Math.max(0, value)}px`;
        }
        if (property === 'padding') selected.style.padding = `${Math.max(0, value)}px`;
        if (property === 'fontSize') {
            const editable = selectedEditable();
            if (editable) editable.style.fontSize = `${Math.max(5, value)}px`;
        }
        if (property === 'lineHeight') {
            const editable = selectedEditable();
            if (editable) editable.style.lineHeight = String(Math.max(.6, Math.min(4, value)));
        }
        commitChange();
    }

    function applyTextStyle(action) {
        const editable = selectedEditable();
        if (!editable) return;
        if (action === 'format-painter') {
            if (formatPainter) {
                setFormatPainter(null);
                onStatus?.('已取消格式刷');
            } else if (selected) {
                setFormatPainter(captureFormat(selected));
                onStatus?.('格式刷已启用，请点击目标组件');
            }
            return;
        }
        const style = getComputedStyle(editable);
        if (action === 'bold') editable.style.fontWeight = Number(style.fontWeight) >= 600 || style.fontWeight === 'bold' ? '400' : '700';
        if (action === 'italic') editable.style.fontStyle = style.fontStyle === 'italic' ? 'normal' : 'italic';
        if (action.startsWith('align-')) editable.style.textAlign = action.replace('align-', '');
        if (action === 'background-transparent') selected.style.background = 'transparent';
        commitChange();
    }

    function applyObjectFit(value) {
        const target = imageTarget();
        if (!target) return;
        if (target.matches('img')) {
            target.style.objectFit = value;
        } else {
            target.dataset.pptObjectFit = value;
            const backgroundImage = getComputedStyle(target).backgroundImage;
            if (backgroundImage && backgroundImage !== 'none') {
                target.style.backgroundSize = value === 'fill' ? '100% 100%' : value;
                target.style.backgroundPosition = 'center';
                target.style.backgroundRepeat = 'no-repeat';
            }
        }
        commitChange();
    }

    function replaceSelectedImage() {
        const target = imageTarget();
        if (!target) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                if (target.matches('img')) {
                    target.src = reader.result;
                } else {
                    const fit = target.dataset.pptObjectFit || 'cover';
                    target.style.backgroundImage = `url("${reader.result}")`;
                    target.style.backgroundPosition = 'center';
                    target.style.backgroundRepeat = 'no-repeat';
                    target.style.backgroundSize = fit === 'fill' ? '100% 100%' : fit;
                    target.classList.add('has-image');
                    if (target.classList.contains('ppt-image-placeholder')) target.textContent = '';
                }
                commitChange();
            };
            reader.readAsDataURL(file);
        }, { once: true });
        input.click();
    }

    function editTable(action) {
        if (!isTableComponent()) return;
        const table = selected.matches('table')
            ? selected
            : selected.closest('table') || selected.querySelector('table');
        if (!table) return;
        const rows = Array.from(table.rows);
        const selectedCell = selected.matches('td, th') && selected.closest('table') === table ? selected : null;
        const selectedRowIndex = selectedCell?.parentElement?.rowIndex ?? rows.length - 1;
        const selectedColumnIndex = selectedCell?.cellIndex ?? (rows[0]?.cells.length || 1) - 1;
        let nextSelection = selectedCell;
        if (action === 'add-row') {
            const columns = rows[0]?.cells.length || 3;
            const insertAt = Math.min(selectedRowIndex + 1, rows.length);
            const row = table.insertRow(insertAt);
            for (let index = 0; index < columns; index++) {
                const cell = row.insertCell();
                cell.textContent = index === 0 ? String(rows.length + 1) : '新内容';
                if (index === 0) cell.className = 'idx';
                if (index === columns - 1) cell.classList.add('owner');
            }
            nextSelection = row.cells[Math.min(selectedColumnIndex, columns - 1)];
        }
        if (action === 'delete-row' && rows.length > 1) {
            const deleteAt = Math.min(selectedRowIndex, rows.length - 1);
            const fallbackRow = rows[deleteAt === rows.length - 1 ? deleteAt - 1 : deleteAt + 1];
            nextSelection = fallbackRow?.cells[Math.min(selectedColumnIndex, fallbackRow.cells.length - 1)] || table;
            table.deleteRow(deleteAt);
        }
        if (action === 'add-column') {
            const insertAt = Math.min(selectedColumnIndex + 1, rows[0]?.cells.length || 0);
            rows.forEach((row, index) => {
                const cell = row.insertCell(insertAt);
                cell.textContent = index === 0 ? '新列' : '新内容';
                if (row === selectedCell?.parentElement) nextSelection = cell;
            });
        }
        if (action === 'delete-column' && (rows[0]?.cells.length || 0) > 1) {
            const deleteAt = Math.min(selectedColumnIndex, rows[0].cells.length - 1);
            const fallbackColumn = deleteAt === rows[0].cells.length - 1 ? deleteAt - 1 : deleteAt + 1;
            nextSelection = selectedCell?.parentElement?.cells[fallbackColumn] || table;
            rows.forEach(row => row.deleteCell(deleteAt));
        }
        Array.from(table.rows).forEach((row, rowIndex) => {
            if (row.cells[0]?.classList.contains('idx')) row.cells[0].textContent = String(rowIndex + 1);
        });
        markComponents(table.closest('.slide') || table);
        if (nextSelection?.isConnected) select(nextSelection, false);
        else select(table, false);
        commitChange();
    }

    function handlePointerDown(event) {
        if (event.button !== 0 || event.target.closest('.moveable-control-box, .ppt-component-toolbar')) return;
        if (event.target.closest('[contenteditable="true"], .ppt-editing')) return;
        const selectedContainer = getSelectedElements().find(element =>
            element === event.target || element.contains(event.target)
        );
        const component = selectedContainer || resolveComponent(event.target);
        if (!component || component.classList.contains('ppt-locked') || component.classList.contains('ppt-editing')) {
            const slide = event.target.closest('.slide-wrap');
            if (slide || event.target.closest('#deckWrapper')) {
                if (!event.shiftKey) clearSelection();
                lassoDrag = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    slide: slide || deck.querySelector('.slide-wrap.is-active') || deck.querySelector('.slide-wrap'),
                    box: null
                };
                if (lassoDrag.slide) lassoDrag.slide.setPointerCapture?.(event.pointerId);
            }
            return;
        }
        if (event.shiftKey) {
            window.getSelection()?.removeAllRanges();
            event.preventDefault();
        }
        const wasSelected = selectedSet.has(component);
        if (!wasSelected) {
            select(component, event.shiftKey);
        }
        
        if (isLayoutBoundInner(component)) return;
        const movable = getSelectedElements().filter(element => !element.classList.contains('ppt-locked'));
        directDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            elements: movable.map(element => ({
                element,
                left: numberStyle(element, 'left'),
                top: numberStyle(element, 'top')
            })),
            bounds: selectionBounds(movable),
            moved: false,
            componentClicked: component,
            wasSelected: wasSelected,
            shiftKey: event.shiftKey
        };
        component.setPointerCapture?.(event.pointerId);
        window.getSelection()?.removeAllRanges();
        if (component.matches('table, .agenda-table')) event.preventDefault();
    }

    function handlePointerMove(event) {
        if (lassoDrag && event.pointerId === lassoDrag.pointerId) {
            let dx = event.clientX - lassoDrag.startX;
            let dy = event.clientY - lassoDrag.startY;
            if (!lassoDrag.box && Math.hypot(dx, dy) > 3) {
                lassoDrag.box = document.createElement('div');
                lassoDrag.box.className = 'ppt-lasso-box';
                lassoDrag.box.style.position = 'fixed';
                lassoDrag.box.style.border = '1px solid #3b82f6';
                lassoDrag.box.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
                lassoDrag.box.style.zIndex = '999999';
                lassoDrag.box.style.pointerEvents = 'none';
                document.body.appendChild(lassoDrag.box);
            }
            if (lassoDrag.box) {
                const left = Math.min(event.clientX, lassoDrag.startX);
                const top = Math.min(event.clientY, lassoDrag.startY);
                const width = Math.abs(dx);
                const height = Math.abs(dy);
                lassoDrag.box.style.left = `${left}px`;
                lassoDrag.box.style.top = `${top}px`;
                lassoDrag.box.style.width = `${width}px`;
                lassoDrag.box.style.height = `${height}px`;
            }
            event.preventDefault();
            return;
        }

        if (!directDrag || event.pointerId !== directDrag.pointerId) return;
        let dx = (event.clientX - directDrag.startX) / getScale();
        let dy = (event.clientY - directDrag.startY) / getScale();
        if (!directDrag.moved && Math.hypot(dx, dy) < 2) return;
        directDrag.moved = true;
        ({ dx, dy } = snapDrag(dx, dy, directDrag.bounds));
        directDrag.elements.forEach(item => {
            item.element.style.position = item.element.style.position || (getComputedStyle(item.element).position === 'static' ? 'relative' : getComputedStyle(item.element).position);
            item.element.style.left = `${item.left + dx}px`;
            item.element.style.top = `${item.top + dy}px`;
        });
        refreshMoveable();
        positionToolbar();
        event.preventDefault();
    }

    function handlePointerUp(event) {
        if (lassoDrag && event.pointerId === lassoDrag.pointerId) {
            if (lassoDrag.box) {
                const lassoRect = lassoDrag.box.getBoundingClientRect();
                const elements = Array.from(lassoDrag.slide?.querySelectorAll('.ppt-element') || []);
                elements.forEach(el => {
                    if (el.classList.contains('ppt-locked')) return;
                    // parent components should be selected if we intersect them.
                    // to prevent inner elements from being lasso'd separately when not intended, we can just allow everything for now.
                    if (el.classList.contains('ppt-inner-element') && el.closest('.table, table, .agenda-table')) return; 
                    
                    const rect = el.getBoundingClientRect();
                    const intersect = !(rect.right < lassoRect.left || 
                                        rect.left > lassoRect.right || 
                                        rect.bottom < lassoRect.top || 
                                        rect.top > lassoRect.bottom);
                    if (intersect) {
                        select(el, true); // true = additive selection
                    }
                });
                lassoDrag.box.remove();
                lassoDrag.box = null;
            }
            if (lassoDrag.slide) lassoDrag.slide.releasePointerCapture?.(event.pointerId);
            lassoDrag = null;
            return;
        }

        if (!directDrag || event.pointerId !== directDrag.pointerId) return;
        const changed = directDrag.moved;
        const component = directDrag.componentClicked;
        const wasSelected = directDrag.wasSelected;
        const shiftKey = directDrag.shiftKey;
        
        directDrag = null;
        hideGuides();
        suppressClick = true; // Selection is handled here, suppress the native click event.
        
        if (!changed && component) {
            if (shiftKey && wasSelected) {
                // Shift-click an already selected item to deselect it
                selectedSet.delete(component);
                if (selected === component) selected = getSelectedElements().at(-1) || null;
                updateSelectionVisuals();
                onSelectionChange?.(getSelectedElements());
            } else if (!shiftKey && wasSelected && selectedSet.size > 1) {
                // Normal click on an item that was part of a multi-selection clears the rest
                select(component, false);
            }
        }
        
        if (changed) commitChange();
    }

    function controlDirection(control) {
        const match = control.className.match(/moveable-(nw|ne|sw|se|n|s|e|w)(?:\s|$)/);
        return match ? match[1] : '';
    }

    function handleControlPointerDown(event) {
        const control = event.target.closest('.moveable-control-box .moveable-control');
        if (!control || selectedSet.size !== 1 || !selected || selected.classList.contains('ppt-locked')) return;
        const rect = selected.getBoundingClientRect();
        const pointerState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            width: rect.width / getScale(),
            height: rect.height / getScale(),
            left: numberStyle(selected, 'left'),
            top: numberStyle(selected, 'top'),
            moved: false
        };
        if (control.classList.contains('moveable-rotation-control')) {
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            directRotate = {
                ...pointerState,
                centerX,
                centerY,
                startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI,
                rotation: parseFloat(selected.dataset.pptRotate || '0')
            };
        } else {
            const direction = controlDirection(control);
            if (!direction) return;
            directResize = { ...pointerState, direction };
        }
        control.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function handleControlPointerMove(event) {
        if (directResize && event.pointerId === directResize.pointerId && selected) {
            const dx = (event.clientX - directResize.startX) / getScale();
            const dy = (event.clientY - directResize.startY) / getScale();
            const west = directResize.direction.includes('w');
            const east = directResize.direction.includes('e');
            const north = directResize.direction.includes('n');
            const south = directResize.direction.includes('s');
            const width = Math.max(12, directResize.width + (east ? dx : west ? -dx : 0));
            const height = Math.max(12, directResize.height + (south ? dy : north ? -dy : 0));
            selected.style.position = selected.style.position || (getComputedStyle(selected).position === 'static' ? 'relative' : getComputedStyle(selected).position);
            selected.style.width = `${width}px`;
            selected.style.height = `${height}px`;
            if (west) selected.style.left = `${directResize.left + dx}px`;
            if (north) selected.style.top = `${directResize.top + dy}px`;
            directResize.moved = true;
            refreshMoveable();
            positionToolbar();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (directRotate && event.pointerId === directRotate.pointerId && selected) {
            const angle = Math.atan2(event.clientY - directRotate.centerY, event.clientX - directRotate.centerX) * 180 / Math.PI;
            const rotation = directRotate.rotation + angle - directRotate.startAngle;
            selected.dataset.pptRotate = String(rotation);
            selected.style.rotate = `${rotation}deg`;
            directRotate.moved = true;
            refreshMoveable();
            positionToolbar();
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    function handleControlPointerUp(event) {
        const resized = directResize && event.pointerId === directResize.pointerId;
        const rotated = directRotate && event.pointerId === directRotate.pointerId;
        if (!resized && !rotated) return;
        const changed = directResize?.moved || directRotate?.moved;
        directResize = null;
        directRotate = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (changed) commitChange();
    }

    function handleKeydown(event) {
        if (isTextEditingTarget(event.target)) {
            if (event.key === 'Tab' && editingComponent) {
                const targets = internalEditTargets(editingComponent);
                const current = editingTarget || event.target.closest('.ppt-inner-element, .editable, td, th, li');
                const currentIndex = Math.max(0, targets.indexOf(current));
                const direction = event.shiftKey ? -1 : 1;
                const next = targets[(currentIndex + direction + targets.length) % targets.length];
                if (next) {
                    event.preventDefault();
                    select(next, false);
                    startTextEditing(next, next);
                }
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.target.blur();
                stopTextEditing();
                refreshMoveable();
            }
            return;
        }
        const command = event.ctrlKey || event.metaKey;
        if (command && event.shiftKey && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            ungroupSelected();
            return;
        }
        if (command && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            groupSelected();
            return;
        }
        if (command && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            selectAllComponents();
            return;
        }
        if (command && event.key.toLowerCase() === 'c' && selectedSet.size) {
            event.preventDefault();
            copySelected();
            return;
        }
        if (command && event.key.toLowerCase() === 'x' && selectedSet.size) {
            event.preventDefault();
            cutSelected();
            return;
        }
        if (command && event.key.toLowerCase() === 'v' && clipboard.length) {
            event.preventDefault();
            pasteClipboard();
            return;
        }
        if (command && event.key.toLowerCase() === 'd' && selectedSet.size) {
            event.preventDefault();
            duplicateSelected();
            return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedSet.size) {
            event.preventDefault();
            deleteSelected();
            return;
        }
        if (event.key === 'Escape') {
            if (formatPainter) {
                setFormatPainter(null);
                onStatus?.('已取消格式刷');
                return;
            }
            clearSelection();
            return;
        }
        const step = event.shiftKey ? 10 : 1;
        const directions = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step]
        };
        if (selectedSet.size && directions[event.key]) {
            event.preventDefault();
            nudge(...directions[event.key]);
        }
    }

    function refresh(root = deck) {
        markComponents(root);
        Array.from(selectedSet).forEach(element => {
            if (!element.isConnected) selectedSet.delete(element);
        });
        if (selected && !selected.isConnected) selected = getSelectedElements().at(-1) || null;
        updateSelectionVisuals();
        refreshMoveable();
        renderLayers();
    }

    markComponents();
    ensureToolbar();
    ensureMoveable();
    renderLayers();
    deck.addEventListener('click', handleClick);
    deck.addEventListener('dblclick', handleDoubleClick);
    deck.addEventListener('pointerdown', handlePointerDown);
    deck.addEventListener('pointermove', handlePointerMove);
    deck.addEventListener('pointerup', handlePointerUp);
    deck.addEventListener('pointercancel', handlePointerUp);
    deck.addEventListener('focusout', event => {
        if (event.target.matches('[data-ppt-editable="true"]')) {
            setTimeout(() => {
                if (editingTarget && document.activeElement === editingTarget) return;
                if (document.activeElement?.matches('[data-ppt-editable="true"][contenteditable="true"]')) return;
                stopTextEditing();
                refreshMoveable();
                onChange?.();
            }, 0);
        }
    });
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('pointerdown', handleControlPointerDown, true);
    document.addEventListener('pointermove', handleControlPointerMove, true);
    document.addEventListener('pointerup', handleControlPointerUp, true);
    document.addEventListener('pointercancel', handleControlPointerUp, true);
    layersList?.addEventListener('click', event => {
        const row = event.target.closest('.layer-row');
        if (!row) return;
        const element = findLayerElement(row.dataset.layerId);
        if (!element) return;
        const action = event.target.closest('[data-layer-action]')?.dataset.layerAction;
        if (action === 'visibility') return toggleVisibility(element);
        if (action === 'lock') {
            if (!selectedSet.has(element)) select(element, false);
            return toggleLock();
        }
        if (action === 'raise') return raiseLayer(element);
        select(element, event.shiftKey);
    });
    layersList?.addEventListener('dragstart', event => {
        const row = event.target.closest('.layer-row');
        if (!row) return;
        event.dataTransfer.setData('text/plain', row.dataset.layerId);
        event.dataTransfer.effectAllowed = 'move';
        row.classList.add('is-dragging');
        requestAnimationFrame(() => {
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
    });
    layersList?.addEventListener('dragover', event => {
        const row = event.target.closest('.layer-row');
        if (!row) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        updateLayerDropFeedback(row, event.clientY);
    });
    layersList?.addEventListener('drop', event => {
        const row = event.target.closest('.layer-row');
        if (!row) return;
        event.preventDefault();
        const placement = row.classList.contains('is-drop-after') ? 'after' : 'before';
        const draggedId = event.dataTransfer.getData('text/plain');
        clearLayerDragFeedback();
        reorderLayer(draggedId, row.dataset.layerId, placement);
    });
    layersList?.addEventListener('dragend', clearLayerDragFeedback);
    layersList?.addEventListener('dragleave', event => {
        if (!layersList.contains(event.relatedTarget)) clearLayerDragFeedback();
    });
    layersList?.addEventListener('pointerdown', event => {
        const handle = event.target.closest('.layer-drag-handle');
        const row = handle?.closest('.layer-row');
        if (!row) return;
        layerPointerDrag = {
            pointerId: event.pointerId,
            layerId: row.dataset.layerId,
            targetId: null,
            placement: 'before'
        };
        row.classList.add('is-dragging');
        handle.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });
    layersList?.addEventListener('pointermove', event => {
        if (!layerPointerDrag || event.pointerId !== layerPointerDrag.pointerId) return;
        const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest('.layer-row');
        if (!targetRow || targetRow.dataset.layerId === layerPointerDrag.layerId) return;
        layerPointerDrag.targetId = targetRow.dataset.layerId;
        layerPointerDrag.placement = updateLayerDropFeedback(targetRow, event.clientY) || 'before';
        event.preventDefault();
    });
    layersList?.addEventListener('pointerup', event => {
        if (!layerPointerDrag || event.pointerId !== layerPointerDrag.pointerId) return;
        const { layerId, targetId, placement } = layerPointerDrag;
        layerPointerDrag = null;
        clearLayerDragFeedback();
        if (targetId) reorderLayer(layerId, targetId, placement);
        event.preventDefault();
    });
    layersList?.addEventListener('pointercancel', () => {
        layerPointerDrag = null;
        clearLayerDragFeedback();
    });
    document.querySelectorAll('.layers-align-actions button').forEach(button => {
        button.addEventListener('click', () => alignSelection(button.dataset.align));
    });
    propertiesPanel?.addEventListener('change', event => {
        const property = event.target.dataset.property;
        if (!property) return;
        if (property === 'objectFit') applyObjectFit(event.target.value);
        if (property === 'fontFamily') {
            const editable = selectedEditable();
            if (editable) {
                editable.style.fontFamily = event.target.value;
                commitChange();
            }
        }
    });
    propertiesPanel?.addEventListener('input', event => {
        const property = event.target.dataset.property;
        if (['x', 'y', 'width', 'height', 'rotate', 'zIndex', 'opacity', 'borderRadius', 'borderWidth', 'padding', 'fontSize', 'lineHeight'].includes(property)) {
            applyNumericProperty(property, event.target.value);
        }
        if (property === 'color') {
            const editable = selectedEditable();
            if (editable) {
                editable.style.color = event.target.value;
                commitChange();
            }
        }
        if (property === 'backgroundColor' && selected) {
            selected.style.background = event.target.value;
            commitChange();
        }
        if (property === 'borderColor' && selected) {
            selected.style.borderColor = event.target.value;
            commitChange();
        }
    });
    propertiesPanel?.addEventListener('click', event => {
        const styleAction = event.target.closest('[data-style-action]')?.dataset.styleAction;
        if (styleAction) return applyTextStyle(styleAction);
        const imageAction = event.target.closest('[data-image-action]')?.dataset.imageAction;
        if (imageAction === 'replace') return replaceSelectedImage();
        const tableAction = event.target.closest('[data-table-action]')?.dataset.tableAction;
        if (tableAction) return editTable(tableAction);
    });
    window.addEventListener('resize', () => {
        refreshMoveable();
        positionToolbar();
    });
    deckWrapperObserver(deck, () => {
        refreshMoveable();
        positionToolbar();
    });

    return {
        refresh,
        clearSelection,
        refreshControls: refreshMoveable,
        refreshLayers: renderLayers,
        addElement,
        getSelectionContext,
        getPageContext,
        applyAiActions,
        auditPageLayout,
        autoFixPageLayout,
        unifyDeckStyle,
        copyComponents: copySelected,
        cutComponents: cutSelected,
        pasteComponents: pasteClipboard,
        duplicateComponents: duplicateSelected,
        deleteComponents: deleteSelected,
        groupComponents: groupSelected,
        ungroupComponents: ungroupSelected,
        bringToFront,
        toggleLock,
        isComponentSelected: (component) => selectedSet.has(component),
        selectComponent: select,
        normalizeSlide: normalizeSlideElements
    };
}

function deckWrapperObserver(deck, callback) {
    if (!window.ResizeObserver) return;
    const wrapper = deck.closest('#deckWrapper');
    if (!wrapper) return;
    const observer = new ResizeObserver(callback);
    observer.observe(wrapper);
}
