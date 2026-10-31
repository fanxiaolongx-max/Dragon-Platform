// Only the active, same-origin Picture Island frame can expand over the platform chrome.
(() => {
    const reset = () => document.body.classList.remove('gallery-viewer-open');
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.data?.type !== 'tools-gallery-viewer') return;
        const frame = document.querySelector('.custom-tool-frame[data-tool-slug="picture-island"]');
        if (!frame || event.source !== frame.contentWindow || typeof event.data.open !== 'boolean') return;
        document.body.classList.toggle('gallery-viewer-open',event.data.open);
    });
    document.addEventListener('load', event => { if (event.target.matches?.('.custom-tool-frame')) reset(); },true);
    window.addEventListener('pagehide',reset);
})();
