// 在页面样式和导航配置加载前应用已缓存的平台名称，避免标签页闪现旧品牌。
(function () {
    'use strict';

    function apply(identity, language) {
        const title = document.querySelector('title[data-platform-page-title]');
        if (!title) return false;
        let legacyName = '';
        try {
            language = language || window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang');
            if (!identity) {
                identity = JSON.parse(localStorage.getItem('tools_platform_identity') || 'null');
                legacyName = localStorage.getItem('tools_platform_name') || '';
            }
        } catch (_) { /* 存储不可用或缓存损坏时先显示页面名称。 */ }
        const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '';
        let name = clean(language === 'en-US' ? identity?.platformNameEn : identity?.platformNameZh)
            || clean(identity?.platformName) || clean(legacyName);
        if (name === '图特工具平台' || name === 'Thoth Platform') {
            name = language === 'en-US' ? 'Dragon Platform' : 'Dragon 工具平台';
        }
        const pageName = (language === 'en-US' ? title.dataset.platformPageTitleEn : title.dataset.platformPageTitle)
            || title.dataset.platformPageTitle;
        const next = name ? `${name} - ${pageName}` : pageName;
        if (document.title !== next) document.title = next;
        return true;
    }

    window.ToolsPlatformTitle = { apply };
    apply();
})();
