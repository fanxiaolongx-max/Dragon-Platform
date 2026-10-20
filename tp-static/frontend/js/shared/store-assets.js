(function () {
    'use strict';
    function png(canvas) {
        return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('截图编码失败 / Screenshot encoding failed')), 'image/png'));
    }
    function loadRenderer(doc, view) {
        if (view.html2canvas) return Promise.resolve(view.html2canvas);
        return new Promise((resolve, reject) => {
            const script = doc.createElement('script');
            script.src = './tp-static/frontend/js/shared/html2canvas.min.js';
            script.onload = () => resolve(view.html2canvas);
            script.onerror = () => reject(new Error('无法加载截图组件 / Screenshot component could not load'));
            doc.head.appendChild(script);
        });
    }
    function verifyContent(canvas) {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let low = 255, high = 0;
        for (let i = 0; i < data.length; i += 128) {
            const light = (data[i] + data[i + 1] + data[i + 2]) / 3;
            low = Math.min(low, light); high = Math.max(high, light);
        }
        if (high - low < 20) throw new Error('登录页截图为空，请重试 / Login screenshot is empty; please retry');
    }
    async function capturePage() {
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;left:-16000px;top:0;width:1280px;height:800px;border:0;pointer-events:none';
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('登录页加载超时 / Login page load timed out')), 20000);
                frame.onload = () => { clearTimeout(timer); resolve(); };
                frame.onerror = () => { clearTimeout(timer); reject(new Error('无法加载登录页 / Login page could not load')); };
                frame.src = './login.html'; document.body.appendChild(frame);
            });
            const doc = frame.contentDocument, view = frame.contentWindow;
            if (!doc?.querySelector('.login-wrapper')) throw new Error('未加载到平台登录页 / Platform login page not found');
            // Wait for current branding, fonts and logo, rather than capture a loading shell.
            const ready = async () => {
                await view.loadPlatformIdentity?.();
                await doc.fonts?.ready;
                await Promise.all(Array.from(doc.images).map(img => img.decode ? img.decode().catch(() => {}) : Promise.resolve()));
            };
            let timer;
            try { await Promise.race([ready(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('登录页资源加载超时 / Login assets load timed out')), 20000); })]); }
            finally { clearTimeout(timer); }
            const render = await loadRenderer(doc, view);
            const screenshot = await render(doc.body, {
                width: 1280, height: 800, x: 0, y: 0, scrollX: 0, scrollY: 0, scale: 1,
                windowWidth: 1280, windowHeight: 800, useCORS: true, allowTaint: false,
                backgroundColor: '#050810', logging: false,
                onclone: clone => {
                    clone.querySelectorAll('[data-i18n="login.subtitle"]').forEach(node => node.remove());
                    clone.querySelectorAll('input').forEach(input => { input.value = ''; input.setAttribute('value', ''); });
                    const style = clone.createElement('style');
                    style.textContent = '*{animation:none!important;transition:none!important}.login-slogan-wrap,.login-slogan-wrap p{opacity:1!important;filter:none!important;transform:none!important;mask:none!important;-webkit-mask:none!important}.glass-panel{padding:30px 40px!important}.login-slogan-wrap{margin-top:30px!important;margin-bottom:10px!important}.glass-panel h2{background:none!important;color:#eef2ff!important;-webkit-text-fill-color:#eef2ff!important}';
                    clone.head.appendChild(style);
                }
            });
            verifyContent(screenshot);
            return png(screenshot);
        } finally { frame.remove(); }
    }
    async function form(files) {
        if (files.length > 5) throw new Error('最多选择 5 张截图 / Select up to 5 screenshots');
        const form = new FormData();
        if (files.length) {
            for (const file of files) {
                if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('截图仅支持 PNG/JPEG / Screenshots must be PNG/JPEG');
                if (file.size > 10 * 1024 * 1024) throw new Error('每张截图不超过 10 MB / Each screenshot must be under 10 MB');
                form.append('screenshots', file, file.name);
            }
        } else form.append('screenshots', await capturePage(), 'login-page.png');
        return form;
    }
    window.ToolsStoreAssets = { form };
})();
