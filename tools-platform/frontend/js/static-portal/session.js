(function () {
    'use strict';
    const base = new URL('../', document.currentScript.src);
    navigator.serviceWorker?.addEventListener('message', event => {
        if (event.source?.scriptURL !== new URL('tp-static-sw.js', base).href) return;
        if (event.data?.type === 'NEED_KEY') {
            let auth;
            try { auth = JSON.parse(sessionStorage.getItem('tp-static:' + base.pathname)); } catch (_) {}
            event.ports[0]?.postMessage(auth || null);
        }
        if (event.data?.type === 'LOCK') {
            sessionStorage.removeItem('tp-static:' + base.pathname);
            location.replace(new URL('login.html', base));
        }
    });
})();
