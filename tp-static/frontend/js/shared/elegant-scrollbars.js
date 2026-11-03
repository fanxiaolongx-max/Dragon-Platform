// 全平台统一的「优雅滚动条」：细、圆角、没有滚动槽和上下箭头，平时透明，只在这个区域滚动时显示，停下约 1 秒后淡出；
// 滑块长度随内容多少变化（内容越多越短）。服务端注入到每个工具页（backend/models/asset-versioning.js），首页与登录页直接引用。
// 工具自己写的滚动条样式也统一覆盖成这一种；Chrome 121+ 里设置了 scrollbar-width / scrollbar-color 会让下面的样式失效，所以重置为 auto。
(function () {
    'use strict';
    if (window.__elegantScrollbars) return;
    window.__elegantScrollbars = true;
    const style = document.createElement('style');
    style.id = 'elegantScrollbars';
    style.textContent = `
        *, *::before, *::after { scrollbar-width: auto !important; scrollbar-color: auto !important; }
        ::-webkit-scrollbar { width: 8px !important; height: 8px !important; background: transparent !important; }
        ::-webkit-scrollbar-track, ::-webkit-scrollbar-track-piece, ::-webkit-scrollbar-corner { background: transparent !important; border: 0 !important; box-shadow: none !important; }
        ::-webkit-scrollbar-button { display: none !important; width: 0 !important; height: 0 !important; }
        ::-webkit-scrollbar-thumb { min-height: 36px; min-width: 36px; border: 2px solid transparent !important; border-radius: 999px !important; background: transparent !important; background-clip: padding-box !important; box-shadow: none !important; }
        .is-scrolling::-webkit-scrollbar-thumb { background-color: rgba(100, 116, 139, 0.42) !important; }
        .is-scrolling::-webkit-scrollbar-thumb:hover, .is-scrolling::-webkit-scrollbar-thumb:active { background-color: rgba(100, 116, 139, 0.62) !important; }
        :is(html[data-theme="dark"], html[data-platform-theme="dark"]) .is-scrolling::-webkit-scrollbar-thumb { background-color: rgba(203, 213, 225, 0.32) !important; }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 正在滚动的那个区域加 is-scrolling（整页滚动时加在 html 上），停下后去掉
    const timers = new WeakMap();
    document.addEventListener('scroll', event => {
        const target = event.target === document || event.target === document.body ? document.documentElement : event.target;
        if (!(target instanceof Element)) return;
        target.classList.add('is-scrolling');
        clearTimeout(timers.get(target));
        timers.set(target, setTimeout(() => target.classList.remove('is-scrolling'), 900));
    }, { capture: true, passive: true });
})();
