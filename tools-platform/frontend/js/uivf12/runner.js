/* Shared handshake for local and server-generated UI.Vision runner pages. */
(function () {
    window.UIVRunner = {
        start(macro) {
            const status = document.getElementById('status');
            const retry = document.getElementById('retry');
            const english = String(document.documentElement.lang).startsWith('en');
            const text = (zh, en) => english ? en : zh;
            let accepted = false;
            let timer;
            function send() {
                if (accepted) return;
                retry.hidden = true;
                status.classList.remove('error');
                status.textContent = text('正在连接 UI.Vision…', 'Connecting to UI.Vision…');
                clearTimeout(timer);
                timer = setTimeout(() => {
                    status.classList.add('error');
                    status.textContent = text('未收到插件响应。请在当前浏览器启用 UI.Vision，允许 embedded macros，并将当前域名加入白名单。桌面应用请返回数据抓取页，使用内置 Dragon 浏览器运行。', 'No extension response. Enable UI.Vision in this browser, allow embedded macros and allowlist this origin. In the desktop app, return to Data Capture and use the built-in Dragon browser.');
                    retry.hidden = false;
                }, 12000);
                window.dispatchEvent(new CustomEvent('kantuSaveAndRunMacro', { detail: {
                    json: macro, direct: true, storageMode: 'browser', closeRPA: false, loadmacrotree: '0'
                } }));
            }
            window.addEventListener('kantuInvokeSuccess', () => {
                accepted = true; clearTimeout(timer); retry.hidden = true;
                status.classList.remove('error');
                status.textContent = text('UI.Vision 已接收宏，请在运行窗口查看执行进度。', 'UI.Vision accepted the macro. View progress in its run window.');
            }, { once: true });
            retry.addEventListener('click', send);
            // Let the extension finish installing its document-start listeners.
            setTimeout(send, 500);
        }
    };
})();
