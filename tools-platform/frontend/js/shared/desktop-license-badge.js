(function () {
    'use strict';
    const endpoint = '/api/desktop-license/status';
    let badge = null;

    function isZh() {
        const selected = localStorage.getItem('tools_language') || navigator.language || 'en';
        return /^zh/i.test(selected);
    }

    function ensureBadge() {
        if (badge) return badge;
        badge = document.createElement('div');
        badge.id = 'desktop-license-badge';
        Object.assign(badge.style, {
            position: 'fixed', right: '9px', bottom: '7px', zIndex: '2147483000',
            maxWidth: 'min(310px, calc(100vw - 18px))', padding: '4px 8px', borderRadius: '7px',
            color: '#3f6259', background: 'rgba(241,247,244,.8)',
            border: '1px solid rgba(82,125,109,.16)', backdropFilter: 'blur(5px)',
            font: '10px/1.35 Segoe UI,Microsoft YaHei,sans-serif', opacity: '.9',
            boxShadow: 'none', transition: 'opacity .2s ease',
            pointerEvents: 'auto', userSelect: 'text'
        });
        badge.onmouseenter = () => { badge.style.opacity = '.96'; };
        badge.onmouseleave = () => { badge.style.opacity = '.9'; };
        document.body.appendChild(badge);
        return badge;
    }

    async function refresh() {
        try {
            const response = await fetch(endpoint, { cache: 'no-store' });
            if (!response.ok) return;
            const state = await response.json();
            if (!state.enabled) {
                if (badge) badge.remove();
                badge = null;
                return;
            }
            const node = ensureBadge();
            const zh = isZh();
            const expires = Number(state.expiresAt);
            const remaining = expires - Number(state.trustedNow || Date.now());
            if (state.valid) {
                const date = new Date(expires).toLocaleString(zh ? 'zh-CN' : undefined);
                node.textContent = zh ? `License 已授权 · 至 ${date}` : `License active · until ${date}`;
                const urgent = remaining <= 24 * 60 * 60 * 1000;
                const warning = remaining <= 7 * 24 * 60 * 60 * 1000;
                node.style.background = urgent ? 'rgba(254,242,242,.9)' : warning ? 'rgba(255,251,235,.9)' : 'rgba(241,247,244,.8)';
                node.style.color = urgent ? '#991b1b' : warning ? '#854d0e' : '#3f6259';
                node.style.borderColor = urgent ? 'rgba(185,28,28,.2)' : warning ? 'rgba(161,98,7,.2)' : 'rgba(82,125,109,.16)';
                node.title = `${zh ? '授权状态：有效' : 'Status: active'}\nLicense ID: ${state.licenseId || '--'}\n${zh ? '联网校验' : 'Online validation'}: ${state.online ? 'Yes' : 'No'}`;
            } else {
                node.textContent = zh ? `License 已失效 · ${state.reasonCode || ''}` : `License invalid · ${state.reasonCode || ''}`;
                node.style.background = 'rgba(254,242,242,.9)';
                node.style.color = '#991b1b';
                node.style.borderColor = 'rgba(185,28,28,.2)';
            }
        } catch (_) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
    else refresh();
    setInterval(refresh, 5 * 60 * 1000);
})();
