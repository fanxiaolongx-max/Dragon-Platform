// 托管 Python 应用启动页：轮询状态 → 应用就绪后以沙箱 iframe 打开平台签发的访问链接。
// 应用页面没有平台登录态；它的 localStorage 由代理注入的兼容脚本按「应用 + 用户」保存在平台服务端。
(function () {
    const slug = document.body.dataset.hostedApp;
    const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';
    const STATUS_TEXT = {
        installing: '正在安装依赖…', starting: '正在启动…', running: '运行中', stopped: '已停止',
        crashed: '异常退出', install_failed: '依赖安装失败'
    };
    let frame = null;
    let current = null;
    let pollTimer = null;
    let renewTimer = null;
    let logsOpen = false;

    document.body.innerHTML = `
        <main class="ha-stage" id="haStage">
            <section class="ha-card" id="haCard">
                <div class="ha-spinner" id="haSpinner"></div>
                <h1 class="ha-title" id="haTitle">正在打开应用…</h1>
                <p class="ha-detail" id="haDetail"></p>
                <div class="ha-actions" id="haActions"></div>
                <form class="ha-settings" id="haSettings" hidden>
                    <p class="ha-settings-hint" id="haPythonState"></p>
                    <label>Python 路径<input name="pythonPath" placeholder="留空自动检测，例如 C:\\Python311\\python.exe"></label>
                    <label>pip 镜像地址<input name="pipIndexUrl" placeholder="留空使用默认源，例如 https://mirrors.example.com/pypi/simple"></label>
                    <label>信任的镜像主机<input name="pipTrustedHost" placeholder="镜像为 http 或自签证书时填写主机名"></label>
                    <div class="ha-actions"><button type="submit" class="ha-btn primary">保存并重新安装</button><button type="button" class="ha-btn" id="haSettingsCancel">取消</button></div>
                </form>
                <pre class="ha-log" id="haCardLog" hidden></pre>
            </section>
        </main>
        <div class="ha-bar" id="haBar" hidden>
            <button type="button" class="ha-pill" id="haPill" aria-haspopup="menu" aria-expanded="false" title="应用运维">
                <span class="ha-dot" id="haDot"></span><span id="haPillText">运行中</span>
            </button>
            <div class="ha-menu" id="haMenu" role="menu" hidden>
                <div class="ha-menu-meta" id="haMeta"></div>
                <button type="button" role="menuitem" data-action="restart">重启应用</button>
                <button type="button" role="menuitem" data-action="logs">查看运行日志</button>
                <button type="button" role="menuitem" data-action="reinstall">重新安装依赖</button>
                <button type="button" role="menuitem" data-action="settings">Python 环境设置</button>
                <button type="button" role="menuitem" data-action="stop" class="danger">停止应用</button>
            </div>
        </div>
        <aside class="ha-drawer" id="haDrawer" hidden>
            <header><strong>运行日志</strong><button type="button" id="haDrawerClose" aria-label="关闭">×</button></header>
            <pre id="haDrawerLog"></pre>
        </aside>`;
    const $ = id => document.getElementById(id);

    async function api(path, options = {}) {
        const response = await fetch(`/api/hosted-apps/${encodeURIComponent(slug)}${path}`, { credentials: 'same-origin', ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(body.error || `请求失败（${response.status}）`), { status: response.status });
        return body;
    }

    // ── 渲染 ─────────────────────────────────────────
    function setCard({ title, detail = '', busy = false, error = false, actions = [] }) {
        $('haStage').hidden = false;
        $('haCard').classList.toggle('is-error', error);
        $('haSpinner').hidden = !busy;
        $('haTitle').textContent = title;
        $('haDetail').textContent = detail;
        $('haActions').innerHTML = '';
        actions.forEach(({ label, action, primary }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = primary ? 'ha-btn primary' : 'ha-btn';
            button.textContent = label;
            button.addEventListener('click', () => runAction(action));
            $('haActions').appendChild(button);
        });
    }

    function updateBar(app) {
        $('haBar').hidden = !app.isAdmin || !frame;
        $('haDot').dataset.status = app.status;
        $('haPillText').textContent = STATUS_TEXT[app.status] || app.status;
        const meta = [app.packageName && `${app.packageName}${app.version ? ` ${app.version}` : ''}`, app.entry && `入口 ${app.entry}`,
            app.python && `Python ${app.python}`, app.offlineWheels ? '离线依赖' : ''].filter(Boolean);
        $('haMeta').textContent = meta.join(' · ');
    }

    async function refreshLogs(target) {
        if (!current?.isAdmin) return;
        try {
            const { lines } = await api('/logs?limit=200');
            target.textContent = lines.join('\n') || '（暂无日志）';
            target.scrollTop = target.scrollHeight;
        } catch (error) {
            target.textContent = error.message;
        }
    }

    function openFrame(app) {
        $('haStage').hidden = true;
        if (!frame) {
            frame = document.createElement('iframe');
            frame.className = 'ha-frame';
            frame.setAttribute('sandbox', SANDBOX);
            frame.setAttribute('allow', 'clipboard-write; fullscreen');
            frame.title = document.title;
            document.body.appendChild(frame);
        }
        frame.src = app.entryUrl;
        clearTimeout(renewTimer);
        const renewIn = new Date(app.entryExpiresAt).getTime() - Date.now() - 10 * 60 * 1000;
        if (renewIn > 0) renewTimer = setTimeout(() => load({ reopen: true }), Math.min(renewIn, 2 ** 31 - 1));
    }

    function render(app) {
        current = app;
        updateBar(app);
        if (app.status === 'running' && app.entryUrl) {
            openFrame(app);
            updateBar(app);
            return false;
        }
        if (frame) { frame.remove(); frame = null; $('haBar').hidden = true; }
        const adminActions = app.isAdmin ? [{ label: '查看日志', action: 'logs-inline' }] : [];
        if (app.status === 'installing' || app.status === 'starting') {
            setCard({ title: STATUS_TEXT[app.status], detail: app.status === 'installing' ? '首次打开需要创建虚拟环境并安装依赖，可能需要几分钟。' : '应用正在启动，请稍候。', busy: true, actions: adminActions });
            return true;
        }
        if (app.status === 'install_failed') {
            setCard({ title: '依赖安装失败', detail: app.lastError || '', error: true,
                actions: app.isAdmin ? [{ label: '重新安装依赖', action: 'reinstall', primary: true }, { label: 'Python 环境设置', action: 'settings' }, ...adminActions] : [] });
            return false;
        }
        if (app.status === 'crashed') {
            setCard({ title: '应用异常退出', detail: app.lastError || '平台会自动尝试重启。', error: true,
                actions: app.isAdmin ? [{ label: '重新启动', action: 'restart', primary: true }, ...adminActions] : [] });
            return true;
        }
        setCard({ title: '应用已停止', detail: app.isAdmin ? '管理员停止了该应用。' : '应用当前未运行，请联系管理员启动。',
            actions: app.isAdmin ? [{ label: '启动应用', action: 'start', primary: true }, ...adminActions] : [] });
        return false;
    }

    async function load({ reopen = false } = {}) {
        clearTimeout(pollTimer);
        try {
            const { app } = await api('/launch');
            if (reopen && frame) { frame.remove(); frame = null; }
            const keepPolling = render(app);
            if (keepPolling) pollTimer = setTimeout(load, app.status === 'installing' ? 2500 : 1500);
            if (logsOpen) refreshLogs($('haCardLog').hidden ? $('haDrawerLog') : $('haCardLog'));
        } catch (error) {
            setCard({ title: error.status === 404 ? '应用不存在' : '无法打开应用', detail: error.message, error: true, actions: [{ label: '重试', action: 'retry', primary: true }] });
        }
    }

    // Python 路径与 pip 镜像是本机设置，对所有托管应用生效
    async function openSettings() {
        const form = $('haSettings');
        if (frame) { frame.remove(); frame = null; $('haBar').hidden = true; setCard({ title: 'Python 环境设置' }); }
        try {
            const response = await fetch('/api/hosted-apps/settings?refresh=1', { credentials: 'same-origin' });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || '读取设置失败');
            for (const name of ['pythonPath', 'pipIndexUrl', 'pipTrustedHost']) form.elements[name].value = body.settings[name] || '';
            $('haPythonState').textContent = body.python.ok ? `当前使用 Python ${body.python.version}（${body.python.command}）` : body.python.message;
            form.hidden = false;
        } catch (error) {
            if (window.AppDialog) AppDialog.alert(error.message, { title: '读取设置失败', tone: 'danger' });
        }
    }

    $('haSettings').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const payload = Object.fromEntries(['pythonPath', 'pipIndexUrl', 'pipTrustedHost'].map(name => [name, form.elements[name].value.trim()]));
        try {
            const response = await fetch('/api/hosted-apps/settings', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || '保存失败');
            if (!body.python.ok) { $('haPythonState').textContent = body.python.message; return; }
            form.hidden = true;
            await api('/reinstall', { method: 'POST', body: '{}' });
            setTimeout(load, 600);
        } catch (error) {
            $('haPythonState').textContent = error.message;
        }
    });
    $('haSettingsCancel').addEventListener('click', () => { $('haSettings').hidden = true; load(); });

    async function runAction(action) {
        if (action === 'retry') return load();
        if (action === 'settings') return openSettings();
        if (action === 'logs-inline') {
            logsOpen = true;
            $('haCardLog').hidden = false;
            return refreshLogs($('haCardLog'));
        }
        if (action === 'logs') {
            logsOpen = true;
            $('haDrawer').hidden = false;
            return refreshLogs($('haDrawerLog'));
        }
        const confirmations = {
            stop: ['停止后所有用户都无法使用该应用，直到再次启动。确定停止？', '停止应用'],
            reinstall: ['将删除虚拟环境并重新安装全部依赖，期间应用不可用。确定继续？', '重新安装依赖'],
            restart: ['重启期间应用短暂不可用。确定重启？', '重启应用']
        };
        if (confirmations[action] && window.AppDialog) {
            const [message, title] = confirmations[action];
            if (!(await AppDialog.confirm(message, { title, tone: action === 'stop' ? 'danger' : 'info', confirmText: title }))) return;
        }
        try {
            await api(`/${action}`, { method: 'POST', body: '{}' });
            if (frame) { frame.remove(); frame = null; }
            setTimeout(load, 600);
        } catch (error) {
            if (window.AppDialog) AppDialog.alert(error.message, { title: '操作失败', tone: 'danger' });
        }
    }

    $('haPill').addEventListener('click', event => {
        event.stopPropagation();
        const open = $('haMenu').hidden;
        $('haMenu').hidden = !open;
        $('haPill').setAttribute('aria-expanded', String(open));
    });
    $('haMenu').addEventListener('click', event => {
        const action = event.target.closest('button')?.dataset.action;
        if (!action) return;
        $('haMenu').hidden = true;
        runAction(action);
    });
    document.addEventListener('click', () => { $('haMenu').hidden = true; });
    $('haDrawerClose').addEventListener('click', () => { $('haDrawer').hidden = true; logsOpen = false; });

    load();
})();
