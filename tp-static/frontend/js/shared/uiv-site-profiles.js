// 前端三区生成与服务端脚本站点迁移共用同一份站点定义。
(function (root) {
    const profiles = Object.freeze([
        Object.freeze({ id: 'cn', category: 'NetCare中国', origin: 'https://netcare.huawei.com', suffix: '-CN' }),
        Object.freeze({ id: 'ae', category: 'NetCare中东', origin: 'https://netcare-ae.gts.huawei.com', suffix: '-AE' }),
        Object.freeze({ id: 'de', category: 'NetCare德国', origin: 'https://netcare-de.gts.huawei.com', suffix: '-DE' })
    ]);
    if (typeof module === 'object' && module.exports) module.exports = profiles;
    else root.UIVSiteProfiles = profiles;
})(typeof globalThis !== 'undefined' ? globalThis : this);
