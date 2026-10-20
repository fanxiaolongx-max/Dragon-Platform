// 桌面端（Electron）右下角推广卡片堆的桥接点。
// 后端与 Electron 主进程运行在同一进程：electron-main.js 启动时注册控制器，路由通过这里调用；
// 纯服务端部署（PM2 等）没有控制器，接口返回 available: false，首页退回“封面卡片 + 新标签页打开”。
const { runWithTenant } = require('./tenant-context');

let controller = null;
// 最近一次同步卡片堆的租户与账号：用户直接在卡片堆里放大页面时，点击记到这个租户/账号下
let owner = null;

function configureDesktopPromotions(next) { controller = next || null; }
function getDesktopPromotions() { return controller; }
function rememberOwner(tenantId, username) { owner = { tenantId, username: username || 'desktop' }; }

function recordCardClick(link) {
    if (!owner || !link) return Promise.resolve(false);
    const clicks = require('./platform-promotion-clicks-repository');
    return runWithTenant(owner.tenantId, () => clicks.record({ promoId: link.id, kind: 'link', channel: 'card', username: owner.username }))
        .catch(error => { console.warn('[platform-promotions] 记录卡片点击失败：', error.message || error); return false; });
}

module.exports = { configureDesktopPromotions, getDesktopPromotions, rememberOwner, recordCardClick };
