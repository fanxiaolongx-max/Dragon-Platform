/**
 * uivf12/extension-guide.js - UI.Vision RPA 扩展下载与安装指南控制器
 */
(function () {
    const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/uivision/gcbalfbdmfieckjlnblleoemohcganoc';
    const EDGE_STORE_URL = 'https://microsoftedge.microsoft.com/addons/detail/uivision-rpa-%E6%B5%8F%E8%A7%88%E5%99%A8%E8%87%AA%E5%8A%A8%E5%8C%96%E5%B7%A5%E5%85%B7/goapmjinbaeomoemgdcnnhoedopjnddd';
    const EXTENSION_ZIP_URL = '/downloads/uivision-extension-9.6.1.zip';
    const EXTENSION_API_DOWNLOAD_URL = '/api/uiv/extension-download';
    const EXTENSION_VERSION = '9.6.1';

    let overlayEl = null;
    let keyHandlerAttached = false;
    let currentStore = detectBrowser();
    let userManuallySwitched = false;

    function detectBrowser() {
        try {
            const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
            if (/Edg\//i.test(ua)) return 'edge';
        } catch (_) {}
        return 'chrome';
    }

    function getCurrentStoreUrl() {
        return currentStore === 'edge' ? EDGE_STORE_URL : CHROME_STORE_URL;
    }

    function getOverlay() {
        if (!overlayEl) {
            overlayEl = document.getElementById('uivExtensionGuideOverlay');
        }
        return overlayEl;
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            close();
        }
    }

    function updateStoreUI() {
        const overlay = getOverlay();
        if (!overlay) return;
        const t = window.UIVT || (k => k);

        const badge = overlay.querySelector('#uivExtBrowserBadge');
        const primaryBtnText = overlay.querySelector('#uivExtPrimaryBtnText');
        const switchLink = overlay.querySelector('#uivExtSwitchStoreLink');

        if (currentStore === 'edge') {
            if (badge) badge.textContent = t('uiv.extension.badgeEdge') || 'Edge 商店';
            if (primaryBtnText) primaryBtnText.textContent = t('uiv.extension.openEdgeStore') || '🌐 前往 Edge 商店官方安装';
            if (switchLink) switchLink.textContent = t('uiv.extension.switchToChrome') || '切换 Chrome 商店';
        } else {
            if (badge) badge.textContent = t('uiv.extension.badgeChrome') || 'Chrome 商店';
            if (primaryBtnText) primaryBtnText.textContent = t('uiv.extension.openChromeStore') || '🌐 前往 Chrome 商店官方安装';
            if (switchLink) switchLink.textContent = t('uiv.extension.switchToEdge') || '切换 Edge 商店';
        }
    }

    function openOfficialStore() {
        const url = getCurrentStoreUrl();
        window.open(url, '_blank', 'noopener,noreferrer');
        const t = window.UIVT || (k => k);
        if (window.showToast) {
            showToast(t('uiv.extension.toastOpeningStore') || '🌐 正在打开官方扩展商店...', 'info');
        }
    }

    function switchStore(targetStore) {
        userManuallySwitched = true;
        if (targetStore === 'chrome' || targetStore === 'edge') {
            currentStore = targetStore;
        } else {
            currentStore = currentStore === 'edge' ? 'chrome' : 'edge';
        }
        updateStoreUI();
        const t = window.UIVT || (k => k);
        if (window.showToast) {
            const storeName = currentStore === 'edge' ? 'Edge' : 'Chrome';
            showToast(t('uiv.extension.toastStoreSwitched', { store: storeName }) || `已切换为 ${storeName} 商店`, 'info');
        }
    }

    function open(autoDownload = false) {
        const overlay = getOverlay();
        if (!overlay) return;

        if (!userManuallySwitched) {
            currentStore = detectBrowser();
        }
        updateStoreUI();

        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('uiv-modal-open');

        if (!keyHandlerAttached) {
            document.addEventListener('keydown', onKeyDown);
            keyHandlerAttached = true;
        }

        const firstFocus = overlay.querySelector('#uivExtDownloadDirectBtn') || overlay.querySelector('.uiv-extension-close');
        if (firstFocus) {
            setTimeout(() => firstFocus.focus(), 50);
        }

        if (autoDownload) {
            download();
        }
    }

    function close() {
        const overlay = getOverlay();
        if (!overlay) return;

        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('uiv-modal-open');

        if (keyHandlerAttached) {
            document.removeEventListener('keydown', onKeyDown);
            keyHandlerAttached = false;
        }
    }

    function download() {
        const link = document.createElement('a');
        link.href = EXTENSION_ZIP_URL;
        link.download = `uivision-extension-${EXTENSION_VERSION}.zip`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 200);

        const t = window.UIVT || (k => k);
        if (window.showToast) {
            showToast(t('uiv.extension.toastDownloading') || `⚡ UI.Vision v${EXTENSION_VERSION} 本地插件包下载已触发！`, 'info');
        }

        const btn = document.getElementById('uivExtDownloadDirectBtn');
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = `<span>⏳ 正在启动下载...</span>`;
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 1800);
        }
    }

    async function copyUrl(urlText, btn) {
        const t = window.UIVT || (k => k);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(urlText);
            } else {
                const input = document.createElement('input');
                input.value = urlText;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                input.remove();
            }
            if (window.showToast) {
                showToast(t('uiv.extension.copySuccess') || `✅ 已复制地址: ${urlText}`, 'success');
            }
            if (btn) {
                const prev = btn.textContent;
                btn.textContent = '✅ 已复制';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = prev;
                    btn.classList.remove('copied');
                }, 1500);
            }
        } catch (err) {
            console.warn('复制地址失败:', err);
            if (window.showToast) {
                showToast(`请手动复制: ${urlText}`, 'warning');
            }
        }
    }

    async function copyAllSteps(btn) {
        const t = window.UIVT || (k => k);
        const stepsText = [
            `【UI.Vision RPA 扩展简易安装指南】`,
            `----------------------------------------------------`,
            `方式一：官方商店直接安装（推荐 · 1步搞定）`,
            `1. Chrome 商店：${CHROME_STORE_URL}`,
            `2. Edge 商店：${EDGE_STORE_URL}`,
            `   - 进入页面后点击「添加至 Chrome」或「获取」即可一键安装。`,
            `   - 安装后在浏览器右上角 🧩 扩展栏中钉选 UI.Vision，进入详情开启「允许访问文件网址」。`,
            ``,
            `方式二：本地离线安装包（备用 · 无法访问外网商店时）`,
            `1. 下载并解压离线包: uivision-extension-${EXTENSION_VERSION}.zip`,
            `2. 浏览器地址栏打开扩展管理页面并开启右上角「开发者模式」:`,
            `   - Chrome: chrome://extensions/`,
            `   - Edge: edge://extensions/`,
            `3. 点击「加载已解压的扩展程序」，选择解压后的插件文件夹。`,
            `----------------------------------------------------`,
            `安装完成后，回到数据抓取工作台点击智能调度仓库底部的「🚀 运行批脚本」，即可直接驱动 UI.Vision 自动抓取！`
        ].join('\n');

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(stepsText);
            } else {
                const input = document.createElement('textarea');
                input.value = stepsText;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                input.remove();
            }
            if (window.showToast) {
                showToast(t('uiv.extension.stepsCopied') || '✅ 安装指南已复制到剪贴板！', 'success');
            }
            if (btn) {
                const prev = btn.textContent;
                btn.textContent = '✅ 已复制指引';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = prev;
                    btn.classList.remove('copied');
                }, 1800);
            }
        } catch (err) {
            console.warn('复制指引失败:', err);
            if (window.showToast) {
                showToast('复制失败，请手动选择复制', 'error');
            }
        }
    }

    function refreshI18n() {
        const t = window.UIVT || (k => k);
        const overlay = getOverlay();
        if (!overlay) return;

        const setText = (sel, val) => {
            const el = overlay.querySelector(sel);
            if (el && val) el.textContent = val;
        };

        const setHtml = (sel, val) => {
            const el = overlay.querySelector(sel);
            if (el && val) el.innerHTML = val;
        };

        setText('.uiv-extension-eyebrow', t('uiv.extension.modalEyebrow'));
        setText('#uivExtensionModalTitle', t('uiv.extension.modalTitle'));
        setText('#uivExtensionModalSubtitle', t('uiv.extension.modalSubtitle'));
        setText('#uivExtDownloadCardTitle', t('uiv.extension.downloadCardTitle'));
        setText('#uivExtDownloadCardMeta', t('uiv.extension.downloadCardMeta'));
        setText('#uivExtDownloadFallbackBtn', t('uiv.extension.downloadFallbackBtn'));
        setText('#uivExtBadge1', t('uiv.extension.badgeMethod1'));
        setText('#uivExtMethod1Title', t('uiv.extension.method1Title'));
        setHtml('#uivExtMethod1Desc1', t('uiv.extension.method1Desc1'));
        setHtml('#uivExtMethod1Desc2', t('uiv.extension.method1Desc2'));
        setText('#uivExtBadge2', t('uiv.extension.badgeMethod2'));
        setText('#uivExtMethod2Title', t('uiv.extension.method2Title'));
        setHtml('#uivExtMethod2Desc1', t('uiv.extension.method2Desc1'));
        setHtml('#uivExtMethod2Desc2', t('uiv.extension.method2Desc2'));
        setHtml('#uivExtMethod2Desc3', t('uiv.extension.method2Desc3'));
        setText('#uivExtCopyChromeBtn', t('uiv.extension.copyChrome'));
        setText('#uivExtCopyEdgeBtn', t('uiv.extension.copyEdge'));
        setHtml('#uivExtTipBox', t('uiv.extension.tip'));
        setText('#uivExtCopyGuideBtn', t('uiv.extension.copyGuideBtn'));
        setText('#uivExtDoneBtn', t('uiv.extension.doneBtn'));

        updateStoreUI();

        // 更新页面主按钮
        const mainBtnText = document.querySelector('#btnDownloadUivExtension .btn-text');
        if (mainBtnText) mainBtnText.textContent = t('uiv.extension.btnText');
        const mainBtn = document.getElementById('btnDownloadUivExtension');
        if (mainBtn) mainBtn.title = t('uiv.extension.btnTitle');
    }

    window.UIVExtensionGuide = {
        open,
        close,
        download,
        copyUrl,
        copyAllSteps,
        openOfficialStore,
        switchStore,
        getCurrentStoreUrl,
        detectBrowser,
        updateStoreUI,
        refreshI18n,
        zipUrl: EXTENSION_ZIP_URL,
        apiUrl: EXTENSION_API_DOWNLOAD_URL,
        version: EXTENSION_VERSION,
        CHROME_STORE_URL,
        EDGE_STORE_URL
    };
})();
