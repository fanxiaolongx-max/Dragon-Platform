(function () {
    'use strict';
    const key = 'ezscan_warehouse_theme';
    const modes = ['system', 'light', 'dark'];
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let mode = 'system';
    try { mode = localStorage.getItem(key) || mode; } catch (_) {}
    function apply(value, persist = false) {
        mode = modes.includes(value) ? value : 'system';
        const resolved = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
        document.documentElement.dataset.warehouseTheme = resolved;
        document.documentElement.dataset.theme = resolved;
        document.documentElement.style.colorScheme = resolved;
        const select = document.getElementById('warehouseTheme');
        if (select) select.value = mode;
        if (persist) { try { localStorage.setItem(key, mode); } catch (_) {} }
    }
    apply(mode);
    media.addEventListener('change', () => { if (mode === 'system') apply(mode); });
    window.addEventListener('storage', event => { if (event.key === key) apply(event.newValue); });
    document.addEventListener('DOMContentLoaded', () => {
        apply(mode);
        document.getElementById('warehouseTheme')?.addEventListener('change', event => apply(event.target.value, true));
    });
}());
