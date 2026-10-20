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
            position: 'fixed', left: '9px', bottom: '7px', zIndex: '2147483000',
            maxWidth: '310px', padding: '4px 8px', borderRadius: '7px',
            color: '#dcfce7', background: 'rgba(6,78,59,.58)',
            border: '1px solid rgba(52,211,153,.35)', backdropFilter: 'blur(5px)',
            font: '10px/1.35 Segoe UI,Microsoft YaHei,sans-serif', opacity: '.62',
            boxShadow: '0 3px 12px rgba(0,0,0,.16)', transition: 'opacity .2s ease',
            pointerEvents: 'auto', userSelect: 'text'
        });
        badge.onmouseenter = () => { badge.style.opacity = '.96'; };
        badge.onmouseleave = () => { badge.style.opacity = '.62'; };
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
                node.style.background = urgent ? 'rgba(127,29,29,.78)' : warning ? 'rgba(120,53,15,.72)' : 'rgba(6,78,59,.58)';
                node.style.color = urgent ? '#fee2e2' : warning ? '#fef3c7' : '#dcfce7';
                node.style.borderColor = urgent ? 'rgba(248,113,113,.58)' : warning ? 'rgba(251,191,36,.5)' : 'rgba(52,211,153,.35)';
                node.title = `${zh ? '授权状态：有效' : 'Status: active'}\nLicense ID: ${state.licenseId || '--'}\n${zh ? '联网校验' : 'Online validation'}: ${state.online ? 'Yes' : 'No'}`;
            } else {
                node.textContent = zh ? `License 已失效 · ${state.reasonCode || ''}` : `License invalid · ${state.reasonCode || ''}`;
                node.style.background = 'rgba(127,29,29,.82)';
                node.style.color = '#fee2e2';
                node.style.borderColor = 'rgba(248,113,113,.6)';
            }
        } catch (_) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
    else refresh();
    setInterval(refresh, 5 * 60 * 1000);
})();
