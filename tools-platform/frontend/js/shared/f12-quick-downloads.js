/* Reuse the built-in packer in an isolated frame, including its server version allocation. */
(function (root) {
    const isEnglish = () => root.ToolsI18n?.getLanguage?.() === 'en-US';
    const text = (zh, en) => isEnglish() ? en : zh;
    let catalogPromise;

    function headers() {
        const token = localStorage.getItem('tools_token');
        return token ? { Authorization: 'Bearer ' + token } : {};
    }

    function builtins() {
        if (root.F12BuiltinScripts) return Promise.resolve(root.F12BuiltinScripts);
        if (!catalogPromise) catalogPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/custom-tools/f12-to-extension/builtin-catalog.js';
            const fail = () => {
                catalogPromise = null;
                script.remove();
                reject(new Error(text('无法读取内置插件目录', 'Built-in plugin catalog unavailable')));
            };
            script.onload = () => root.F12BuiltinScripts ? resolve(root.F12BuiltinScripts) : fail();
            script.onerror = fail;
            document.head.append(script);
        });
        return catalogPromise;
    }

    async function catalog() {
        const presets = await builtins();
        const items = Object.entries(presets).map(([id, preset]) => ({
            id: 'builtin:' + id, name: preset.name, nameEn: preset.nameEn || preset.name
        }));
        const response = await fetch('/api/custom-tools/f12-to-extension/scripts', { headers: headers() });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const body = await response.json();
        for (const preset of body.scripts || []) {
            items.push({ id: 'server:' + preset.id, name: preset.name, nameEn: preset.nameEn || preset.name });
        }
        return items;
    }

    function download(item) {
        if (!item || !/^(builtin|server):[a-zA-Z0-9_-]+$/.test(item.scriptId) || !['store', 'local'].includes(item.target)) {
            return Promise.reject(new Error(text('无效的快捷打包配置', 'Invalid packaging shortcut')));
        }
        return new Promise((resolve, reject) => {
            const frame = document.createElement('iframe');
            // getRandomValues also works on HTTP intranet deployments.
            const requestId = Array.from(crypto.getRandomValues(new Uint32Array(4)), number => number.toString(16).padStart(8, '0')).join('');
            frame.hidden = true;
            frame.title = text('F12 扩展打包', 'F12 extension packager');
            const params = new URLSearchParams({
                quickPack: '1', scriptId: item.scriptId.replace(/^builtin:/, ''), target: item.target, requestId
            });
            const finish = error => {
                clearTimeout(timer);
                window.removeEventListener('message', receive);
                frame.remove();
                if (error) reject(error);
                else resolve();
            };
            const receive = event => {
                const data = event.data;
                if (event.origin !== location.origin || event.source !== frame.contentWindow ||
                    data?.source !== 'TP_F12_QUICK_PACK' || data.requestId !== requestId) return;
                if (!data.ok) { finish(new Error(data.error || text('打包失败', 'Packaging failed'))); return; }
                if (!(data.blob instanceof Blob) || !data.blob.size || typeof data.filename !== 'string' ||
                    !/^extension-[a-z0-9-]+-v[0-9.]+-(edge-store|local)\.zip$/.test(data.filename)) {
                    finish(new Error(text('打包响应无效', 'Invalid package response')));
                    return;
                }
                const url = URL.createObjectURL(data.blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = data.filename;
                document.body.append(anchor);
                anchor.click();
                anchor.remove();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                finish();
            };
            const timer = setTimeout(() => finish(new Error(text('打包超时，请检查 F12 打包器连接', 'Packaging timed out; check the F12 packager connection'))), 120000);
            window.addEventListener('message', receive);
            frame.src = '/custom-tools/f12-to-extension/index.html?' + params;
            document.body.append(frame);
        });
    }

    root.ToolsF12QuickDownloads = { catalog, download };
    let renderGeneration = 0;
    async function renderHome() {
        const container = document.getElementById('homeF12QuickDownloads');
        if (!container) return;
        const generation = ++renderGeneration;
        container.replaceChildren();
        if (localStorage.getItem('tools_role') !== 'admin') return;
        try {
            const response = await fetch('/api/nav-settings', { headers: headers() });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const config = await response.json();
            const shortcuts = Array.isArray(config.f12QuickDownloads) ? config.f12QuickDownloads : [];
            if (!shortcuts.length) return;
            const plugins = await catalog();
            if (generation !== renderGeneration) return;
            for (const item of shortcuts) {
                const plugin = plugins.find(preset => preset.id === item.scriptId);
                if (!plugin) continue;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'home-f12-download';
                const label = () => text('下载 · ' + plugin.name, 'Download · ' + plugin.nameEn);
                button.textContent = label();
                button.title = text('打包用途：', 'Package target: ') + (item.target === 'local'
                    ? text('本地安装 / 企业分发', 'Local / enterprise distribution') : text('Edge 插件商店', 'Edge store'));
                button.onclick = async () => {
                    button.disabled = true;
                    button.setAttribute('aria-busy', 'true');
                    button.textContent = text('正在打包…', 'Packaging…');
                    let status = container.querySelector('[role=status]');
                    if (!status) {
                        status = document.createElement('span');
                        status.setAttribute('role', 'status');
                        status.style.cssText = 'flex-basis:100%;font-size:12px;color:#a5b4cf;overflow-wrap:anywhere';
                        container.append(status);
                    }
                    status.textContent = '';
                    try {
                        await download(item);
                        status.textContent = text('已发起下载', 'Download started');
                    } catch (error) {
                        status.textContent = text('打包失败：', 'Packaging failed: ') + error.message;
                    } finally {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                        button.textContent = label();
                    }
                };
                container.append(button);
            }
        } catch (error) {
            if (generation !== renderGeneration) return;
            const note = document.createElement('span');
            note.textContent = text('快捷下载暂不可用', 'Shortcut downloads unavailable');
            note.title = error.message;
            container.append(note);
        }
    }
    window.addEventListener('tools:f12shortcutschange', renderHome);
    window.addEventListener('tools:languagechange', renderHome);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderHome);
    else renderHome();
})(window);
