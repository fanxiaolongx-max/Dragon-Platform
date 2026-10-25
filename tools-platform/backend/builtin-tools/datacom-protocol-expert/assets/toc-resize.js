// Width preference is local to this browser; responsive clamping never overwrites it.
const KEY = 'dk_toc_width';
export function mountTocResize(toc) {
    const handle = toc?.querySelector('.dk-toc-resize');
    if (!handle) return () => {};
    const layout = toc.parentElement;
    let preferred = 230, finish;
    try { preferred = Number(localStorage.getItem(KEY)) || 230; } catch (_) { /* Private browsing. */ }
    preferred = Math.max(180, Math.min(420, preferred));
    const apply = () => {
        const available = layout.getBoundingClientRect().width;
        const max = Math.max(180, Math.min(420, available * .42, available - 348));
        layout.style.setProperty('--toc-w', `${Math.round(Math.min(preferred, max))}px`);
    };
    const save = width => {
        preferred = Math.max(180, Math.min(420, width));
        try { localStorage.setItem(KEY, String(preferred)); } catch (_) { /* Private browsing. */ }
        apply();
    };
    const down = event => {
        if (event.button !== 0) return;
        event.preventDefault();
        finish?.();
        const startX = event.clientX, startWidth = toc.getBoundingClientRect().width;
        document.body.classList.add('is-resizing');
        const move = e => save(startWidth + startX - e.clientX);
        finish = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', finish);
            document.removeEventListener('pointercancel', finish);
            document.body.classList.remove('is-resizing');
            finish = null;
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', finish);
    };
    const key = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault();
        save(event.key === 'Home' ? 230 : toc.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 16 : -16));
    };
    const reset = () => save(230);
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('keydown', key);
    handle.addEventListener('dblclick', reset);
    const observer = new ResizeObserver(apply);
    observer.observe(layout);
    apply();
    return () => {
        finish?.(); observer.disconnect();
        handle.removeEventListener('pointerdown', down);
        handle.removeEventListener('keydown', key);
        handle.removeEventListener('dblclick', reset);
    };
}
