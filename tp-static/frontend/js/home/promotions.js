/* Homepage promotional images are declared in #homePromotions, in display order. */
(function () {
    const i18n = window.ToolsI18n;
    i18n.register('home-promotions', {
        'zh-CN': {
            'home.promotion.title': '推广与资讯',
            'home.promotion.hint': '点击图片，查看大图',
            'home.promotion.open': '查看推广图片大图',
            'home.promotion.maintenance': '让维护责任回归一线，让自主履行成为常态',
            'home.promotion.previous': '上一张图片',
            'home.promotion.next': '下一张图片',
            'home.promotion.select': '图片选择',
            'home.promotion.slide': '查看第 {index} 张图片，共 {total} 张',
            'home.promotion.pause': '暂停播放',
            'home.promotion.play': '继续播放',
            'home.promotion.preview': '图片预览',
            'home.promotion.close': '关闭图片预览'
        },
        'en-US': {
            'home.promotion.title': 'News & Highlights',
            'home.promotion.hint': 'Click an image to enlarge',
            'home.promotion.open': 'Enlarge promotional image',
            'home.promotion.maintenance': 'Bring maintenance responsibility to the frontline and make autonomous delivery the norm',
            'home.promotion.previous': 'Previous image',
            'home.promotion.next': 'Next image',
            'home.promotion.select': 'Select an image',
            'home.promotion.slide': 'View image {index} of {total}',
            'home.promotion.pause': 'Pause slideshow',
            'home.promotion.play': 'Resume slideshow',
            'home.promotion.preview': 'Image Preview',
            'home.promotion.close': 'Close image preview'
        }
    });

    function init() {
        const section = document.getElementById('homePromotions');
        const dialog = document.getElementById('homePromotionDialog');
        if (!section || !dialog) return;
        const slides = Array.from(section.querySelectorAll('.home-promotion-slide'));
        if (!slides.length) { section.hidden = true; return; }
        const controls = section.querySelector('.home-promotions-controls');
        const dotsContainer = section.querySelector('.home-promotions-dots');
        const pauseButton = section.querySelector('[data-promotion-action="pause"]');
        const preview = document.getElementById('homePromotionPreview');
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        let current = 0;
        let timer = null;
        let paused = reducedMotion.matches;
        let hovered = false;
        let focused = false;
        let previousOverflow = '';
        const dots = slides.length > 1 ? slides.map((_, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.addEventListener('click', () => { show(index); schedule(); });
            dotsContainer.appendChild(button);
            return button;
        }) : [];
        controls.hidden = slides.length <= 1;

        function show(index) {
            current = (index + slides.length) % slides.length;
            slides.forEach((slide, i) => { slide.hidden = i !== current; });
            dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === current)));
        }
        function schedule() {
            window.clearTimeout(timer);
            timer = null;
            if (slides.length <= 1 || paused || hovered || focused || document.hidden || dialog.open) return;
            timer = window.setTimeout(() => { show(current + 1); schedule(); }, 6000);
        }
        function translate() {
            slides.forEach(slide => {
                const img = slide.querySelector('img');
                if (img.dataset.i18nAlt) img.alt = i18n.t(img.dataset.i18nAlt);
            });
            dots.forEach((dot, index) => dot.setAttribute('aria-label', i18n.t('home.promotion.slide', { index: index + 1, total: slides.length })));
            pauseButton.dataset.i18n = paused ? 'home.promotion.play' : 'home.promotion.pause';
            pauseButton.textContent = i18n.t(pauseButton.dataset.i18n);
            if (dialog.open) preview.alt = slides[current].querySelector('img').alt;
        }
        slides.forEach(slide => slide.addEventListener('click', () => {
            if (dialog.open) return;
            const img = slide.querySelector('img');
            preview.src = img.currentSrc || img.src;
            preview.alt = img.alt;
            previousOverflow = document.body.style.overflow;
            dialog.showModal();
            document.body.style.overflow = 'hidden';
            schedule();
        }));
        dialog.querySelector('.home-promotion-close').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', event => {
            const rect = dialog.getBoundingClientRect();
            if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
        });
        dialog.addEventListener('close', () => {
            document.body.style.overflow = previousOverflow;
            preview.removeAttribute('src');
            schedule();
        });
        controls.addEventListener('click', event => {
            const action = event.target.closest('[data-promotion-action]')?.dataset.promotionAction;
            if (action === 'previous') show(current - 1);
            if (action === 'next') show(current + 1);
            if (action === 'pause') { paused = !paused; translate(); }
            schedule();
        });
        section.addEventListener('mouseenter', () => { hovered = true; schedule(); });
        section.addEventListener('mouseleave', () => { hovered = false; schedule(); });
        section.addEventListener('focusin', () => { focused = true; schedule(); });
        section.addEventListener('focusout', event => { focused = section.contains(event.relatedTarget); schedule(); });
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('pagehide', () => window.clearTimeout(timer));
        window.addEventListener('pageshow', schedule);
        window.addEventListener('tools:languagechange', translate);
        reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; translate(); schedule(); });
        show(0);
        translate();
        schedule();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
