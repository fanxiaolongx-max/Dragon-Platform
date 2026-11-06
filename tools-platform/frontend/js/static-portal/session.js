(function () {
    'use strict';
    const base = new URL('../', document.currentScript.src);
    // Published tools use the same clean layout in the portal frame and on their own.
    document.documentElement.classList.add('is-embedded-tool', 'is-clean-tool');
    const style = document.createElement('style');
    style.textContent = `
        html.is-embedded-tool { --navbar-h: 0px; }
        html.is-clean-tool :is(#tp-demo-nav, #app-navbar, #navbar-container, .custom-tool-head,
            .ai-fab, .ai-panel, .ai-proactive-alert, .ops-inbox-banner, .ops-home-inbox) { display: none !important; }
        html.is-clean-tool .custom-tool-shell { grid-template-rows: 1fr; }
    `;
    document.head.append(style);
    navigator.serviceWorker?.addEventListener('message', event => {
        if (event.source?.scriptURL !== new URL('tp-static-sw.js', base).href) return;
        if (event.data?.type === 'NEED_KEY') {
            let auth;
            try { auth = JSON.parse(sessionStorage.getItem('tp-static:' + base.pathname)); } catch (_) {}
            event.ports[0]?.postMessage(auth || null);
        }
        if (event.data?.type === 'LOCK') {
            const hadSession = Boolean(sessionStorage.getItem('tp-static:' + base.pathname));
            sessionStorage.removeItem('tp-static:' + base.pathname);
            if (hadSession) location.replace(new URL('login.html', base));
        }
    });
})();
