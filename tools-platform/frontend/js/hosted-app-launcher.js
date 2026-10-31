// 托管 Python 应用启动页：轮询状态 → 应用就绪后以沙箱 iframe 打开平台签发的访问链接。
// 内置在线 IDE（多标签代码编辑、实时热重启、本地 Git 版本回退与远程仓库协作）。
(function () {
    const slug = document.body.dataset.hostedApp;
    const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';
    const schemaText = (zh, en) => { try { return /^en/i.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || document.documentElement.lang) ? en : zh; } catch (_) { return zh; } };
    const STATUS_TEXT = {
        installing: '正在安装依赖…', starting: '正在启动…', running: '运行中', stopped: '已停止',
        crashed: '异常退出', install_failed: '依赖安装失败'
    };
    let frame = null;
    let current = null;
    let pollTimer = null;
    let renewTimer = null;
    let logsOpen = false;
    let barCollapseTimer = null;

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
            <button type="button" class="ha-pill" id="haPill" aria-haspopup="menu" aria-controls="haMenu" aria-expanded="false" aria-label="应用运维" title="应用运维">
                <span class="ha-dot" id="haDot"></span><span id="haPillText">运行中</span>
            </button>
            <div class="ha-menu" id="haMenu" role="menu" hidden>
                <div class="ha-menu-meta" id="haMeta"></div>
                <button type="button" role="menuitem" data-action="restart">重启应用</button>
                <button type="button" role="menuitem" data-action="logs">查看运行日志</button>
                <button type="button" role="menuitem" data-action="db-info">🗄️ 查看分配的数据库</button>
                <button type="button" role="menuitem" data-action="ide">💻 在线修改代码 (IDE)</button>
                <button type="button" role="menuitem" data-action="package-update">📦 更新上传包</button>
                <button type="button" role="menuitem" data-action="schema-init" hidden>${schemaText('初始化应用表（模拟基座 DBA）', 'Initialize app tables (DBA simulation)')}</button>
                <button type="button" role="menuitem" data-action="schema-upgrade" hidden>${schemaText('升级应用表（模拟基座 DBA）', 'Upgrade app tables (DBA simulation)')}</button>
                <button type="button" role="menuitem" data-action="reinstall">重新安装依赖</button>
                <button type="button" role="menuitem" data-action="settings">Python 环境设置</button>
                <button type="button" role="menuitem" data-action="stop" class="danger">停止应用</button>
            </div>
        </div>
        <aside class="ha-drawer" id="haDrawer" hidden>
            <header><strong>运行日志</strong><button type="button" id="haDrawerClose" aria-label="关闭">×</button></header>
            <pre id="haDrawerLog"></pre>
        </aside>

        <!-- ── 查看分配的数据库弹窗 ───────────────────────── -->
        <div class="ha-db-modal-overlay" id="haDbModal" hidden>
            <div class="ha-db-modal-window">
                <header class="ha-db-modal-header">
                    <div class="ha-db-modal-title">
                        <span>🗄️</span>
                        <h3 id="haDbModalTitle">已分配的数据库配置</h3>
                    </div>
                    <button type="button" class="ha-db-modal-close" id="haDbModalClose">✕</button>
                </header>
                <div class="ha-db-modal-body">
                    <!-- 业务数据库卡片 -->
                    <section class="ha-db-card">
                        <div class="ha-db-card-header">
                            <span class="ha-db-badge biz">业务数据库 (只读)</span>
                            <span class="ha-db-perm">SELECT 保护</span>
                        </div>
                        <div class="ha-db-field">
                            <label>分配库名 (Datasource Name):</label>
                            <div class="ha-db-val-row">
                                <code class="ha-db-code" id="haDbBizName">platform:report.db</code>
                                <button type="button" class="ha-db-copy-btn" data-copy-target="haDbBizName">复制</button>
                            </div>
                        </div>
                        <div class="ha-db-field">
                            <label>注入环境变量:</label>
                            <div class="ha-db-val-row">
                                <code class="ha-db-code" id="haDbBizEnv">BUSINESS_DATASOURCE_NAME=platform:report.db</code>
                                <button type="button" class="ha-db-copy-btn" data-copy-target="haDbBizEnv">复制</button>
                            </div>
                        </div>
                        <div class="ha-db-desc">
                            包含 NetCare 全量 441 张业务表、上游源表视图及主题表，供应用只读直查与指标抽取。
                        </div>
                    </section>

                    <!-- 应用数据库卡片 -->
                    <section class="ha-db-card">
                        <div class="ha-db-card-header">
                            <span class="ha-db-badge app">应用私有数据库 (读写)</span>
                            <span class="ha-db-perm">读写权限</span>
                        </div>
                        <div class="ha-db-field">
                            <label>分配库名 (ID / Schema):</label>
                            <div class="ha-db-val-row">
                                <code class="ha-db-code" id="haDbAppName">app</code>
                                <button type="button" class="ha-db-copy-btn" data-copy-target="haDbAppName">复制</button>
                            </div>
                        </div>
                        <div class="ha-db-field">
                            <label>注入环境变量:</label>
                            <div class="ha-db-val-row">
                                <code class="ha-db-code" id="haDbAppEnv">APP_DATASOURCE_ID=app, APP_SCHEMA=...</code>
                                <button type="button" class="ha-db-copy-btn" data-copy-target="haDbAppEnv">复制</button>
                            </div>
                        </div>
                        <div class="ha-db-field">
                            <label>物理存储文件:</label>
                            <code class="ha-db-code" id="haDbAppFile">app.db</code>
                        </div>
                        <div class="ha-db-desc">
                            应用专属私有存储库，供应用存放自身业务表（如 t_report_template、t_report_block 等）。
                        </div>
                    </section>
                </div>
            </div>
        </div>

        <!-- ── 更新上传包弹窗 ───────────────────────────────── -->
        <div class="ha-upload-modal-overlay" id="haUploadModal" hidden>
            <div class="ha-upload-modal-window">
                <header class="ha-upload-modal-header">
                    <div class="ha-upload-modal-title">
                        <span>📦</span>
                        <h3>更新应用代码包</h3>
                    </div>
                    <button type="button" class="ha-upload-modal-close" id="haUploadModalClose">✕</button>
                </header>
                <div class="ha-upload-modal-body">
                    <section class="ha-upload-app-card">
                        <div class="ha-upload-app-meta">
                            <span class="ha-upload-app-badge">当前托管应用</span>
                            <strong id="haUploadCurrentAppName">应用代码</strong>
                            <span class="ha-upload-app-version" id="haUploadCurrentVersion"></span>
                        </div>
                        <p class="ha-upload-hint">上传新的 ZIP 代码包将全量更新应用代码文件；应用私有数据库 (<code>app.db</code>)、环境变量与 Git 远端配置将完整保留。</p>
                    </section>

                    <div class="ha-upload-dropzone" id="haUploadDropzone" tabindex="0" role="button" aria-label="上传应用代码包">
                        <input type="file" id="haUploadFileInput" accept=".zip,application/zip" hidden>
                        <div class="ha-upload-drop-icon">☁️⬆️</div>
                        <div class="ha-upload-drop-text">点击或拖拽应用 ZIP 包到此处</div>
                        <div class="ha-upload-drop-subtext">支持包含 <code>requirements.txt</code> 与 Python 入口文件的 .zip 压缩包（最大 35MB）</div>
                    </div>

                    <div class="ha-upload-preview" id="haUploadPreview" hidden>
                        <div class="ha-upload-preview-header">
                            <span class="ha-upload-preview-status">✅ 应用包结构校验通过</span>
                            <span class="ha-upload-file-size" id="haUploadFileSize"></span>
                        </div>
                        <div class="ha-upload-preview-grid">
                            <div class="ha-upload-field">
                                <label>包内应用名：</label>
                                <span id="haUploadPkgName">-</span>
                            </div>
                            <div class="ha-upload-field">
                                <label>包版本号：</label>
                                <span id="haUploadPkgVersion">-</span>
                            </div>
                            <div class="ha-upload-field">
                                <label>应用入口 (Entry)：</label>
                                <code id="haUploadPkgEntry">-</code>
                            </div>
                            <div class="ha-upload-field">
                                <label>接口类型：</label>
                                <span id="haUploadPkgInterface">ASGI</span>
                            </div>
                            <div class="ha-upload-field">
                                <label>包含文件：</label>
                                <span id="haUploadPkgFiles">-</span>
                            </div>
                            <div class="ha-upload-field">
                                <label>Python 环境：</label>
                                <span id="haUploadPkgPython" class="ha-upload-py-status">-</span>
                            </div>
                        </div>
                    </div>

                    <div class="ha-upload-error-box" id="haUploadErrorBox" hidden></div>

                    <div class="ha-upload-progress" id="haUploadProgress" hidden>
                        <div class="ha-upload-spinner"></div>
                        <div class="ha-upload-progress-text" id="haUploadProgressText">正在上传并更新代码包，请稍候…</div>
                    </div>
                </div>
                <footer class="ha-upload-modal-footer">
                    <button type="button" class="ha-btn" id="haUploadCancelBtn">取消</button>
                    <button type="button" class="ha-btn primary" id="haUploadSubmitBtn" disabled>确认上传并更新</button>
                </footer>
            </div>
        </div>

        <!-- ── 在线 IDE 大弹窗 ───────────────────────────────── -->
        <div class="ha-ide-overlay" id="haIdeModal" hidden>
            <div class="ha-ide-window" id="haIdeWindow">
                <header class="ha-ide-header">
                    <div class="ha-ide-brand">
                        <span class="ha-ide-icon">💻</span>
                        <span class="ha-ide-app-name" id="haIdeAppName">应用代码</span>
                        <span class="ha-ide-badge">在线 IDE</span>
                        <span class="ha-ide-git-branch" id="haIdeGitBranch" title="Git 当前分支">🌿 main</span>
                        <span class="ha-ide-git-remote-pill" id="haIdeGitRemotePill" title="点击配置远程 Git 仓库">☁️ <span id="haIdeRemoteName">未配置远端</span></span>
                        <span class="ha-ide-dirty-badge" id="haIdeDirtyBadge" hidden>● 未保存修改</span>
                    </div>
                    <div class="ha-ide-actions">
                        <button type="button" class="ha-ide-btn" id="haIdeBtnSave" title="保存当前文件 (Ctrl+S / ⌘S)">💾 保存</button>
                        <button type="button" class="ha-ide-btn primary" id="haIdeBtnRestart" title="保存全部修改并立即重启测试应用 (Ctrl+Enter / ⌘R)">⚡ 保存并重启测试</button>
                        <button type="button" class="ha-ide-btn" id="haIdeBtnHistory" title="查看本地 Git 提交历史与版本撤回">⏱️ 历史 & 撤回</button>
                        <button type="button" class="ha-ide-btn" id="haIdeBtnGit" title="配置远程 Git 仓库、推送与拉取">☁️ Git 仓库</button>
                        <button type="button" class="ha-ide-btn" id="haIdeBtnPackageUpdate" title="上传新的应用 ZIP 包以完整更新代码">📦 更新上传包</button>
                        <button type="button" class="ha-ide-btn icon-only" id="haIdeBtnFullscreen" title="切换全屏">⛶</button>
                        <button type="button" class="ha-ide-btn icon-only" id="haIdeBtnClose" title="关闭 IDE">✕</button>
                    </div>
                </header>

                <div class="ha-ide-body">
                    <!-- 左侧文件管理器 -->
                    <aside class="ha-ide-sidebar" id="haIdeSidebar">
                        <div class="ha-ide-sidebar-header">
                            <span>📁 资源管理器</span>
                            <div class="ha-ide-sidebar-actions">
                                <button type="button" id="haIdeBtnNewFile" title="新建文件">📄+</button>
                                <button type="button" id="haIdeBtnNewFolder" title="新建文件夹">📁+</button>
                                <button type="button" id="haIdeBtnRefreshTree" title="刷新文件树">🔄</button>
                            </div>
                        </div>
                        <div class="ha-ide-search-box">
                            <input type="text" id="haIdeSearchInput" placeholder="过滤文件..." autocomplete="off">
                        </div>
                        <div class="ha-ide-file-tree" id="haIdeFileTree"></div>
                    </aside>

                    <!-- 右侧多 Tab 代码编辑区 -->
                    <main class="ha-ide-editor-area">
                        <div class="ha-ide-tabs-bar" id="haIdeTabsBar"></div>
                        <div class="ha-ide-subbar" id="haIdeSubbar">
                            <div class="ha-ide-breadcrumb" id="haIdeBreadcrumb">选择左侧文件开始编辑</div>
                            <div class="ha-ide-subbar-tools">
                                <button type="button" class="ha-ide-tool-btn" id="haIdeBtnFind" title="在当前文件中查找 (Ctrl+F / ⌘F)">🔍 查找</button>
                                <button type="button" class="ha-ide-tool-btn" id="haIdeBtnDiscard" title="放弃当前文件修改">↩ 放弃更改</button>
                            </div>
                        </div>

                        <div class="ha-ide-find-bar" id="haIdeFindBar" hidden>
                            <input type="text" id="haIdeFindInput" placeholder="查找内容...">
                            <input type="text" id="haIdeReplaceInput" placeholder="替换为...">
                            <button type="button" class="ha-ide-btn sm" id="haIdeBtnFindNext">查找下一个</button>
                            <button type="button" class="ha-ide-btn sm" id="haIdeBtnReplace">替换</button>
                            <button type="button" class="ha-ide-btn sm" id="haIdeBtnReplaceAll">全部替换</button>
                            <button type="button" class="ha-ide-btn sm icon-only" id="haIdeBtnFindClose">✕</button>
                        </div>

                        <div class="ha-ide-editor-container" id="haIdeEditorContainer">
                            <!-- 优雅的动态加载圆环与进度提示 -->
                            <div class="ha-ide-loading" id="haIdeLoading" hidden>
                                <div class="ha-ide-loading-card">
                                    <div class="ha-ide-spinner-ring">
                                        <svg viewBox="0 0 50 50" class="ha-ide-circular">
                                            <circle class="ha-ide-path-bg" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
                                            <circle class="ha-ide-path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
                                        </svg>
                                    </div>
                                    <div class="ha-ide-loading-filename" id="haIdeLoadingFilename">📄 代码文件</div>
                                    <div class="ha-ide-loading-status" id="haIdeLoadingStatus">正在载入代码并解析语法…</div>
                                </div>
                            </div>

                            <div class="ha-ide-welcome" id="haIdeWelcome">
                                <div class="ha-ide-welcome-inner">
                                    <div class="ha-ide-welcome-icon">⚡</div>
                                    <h2>在线代码修改 (IDE)</h2>
                                    <p>点击左侧文件树打开代码，支持多标签快速修改、高亮渲染与即时重启测试</p>
                                    <div class="ha-ide-welcome-shortcuts">
                                        <div><span>保存文件</span><kbd>⌘S</kbd> / <kbd>Ctrl+S</kbd></div>
                                        <div><span>保存并重启测试</span><kbd>⌘R</kbd> / <kbd>Ctrl+Enter</kbd></div>
                                        <div><span>在文件中查找</span><kbd>⌘F</kbd> / <kbd>Ctrl+F</kbd></div>
                                        <div><span>缩进 / 反缩进</span><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd></div>
                                    </div>
                                </div>
                            </div>

                            <div class="ha-ide-editor-view" id="haIdeEditorView" hidden>
                                <div class="ha-ide-gutter" id="haIdeGutter"></div>
                                <div class="ha-ide-code-wrap" id="haIdeCodeWrap">
                                    <pre class="ha-ide-pre" id="haIdePre" aria-hidden="true"><code id="haIdeCode"></code></pre>
                                    <textarea class="ha-ide-textarea" id="haIdeTextarea" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"></textarea>
                                </div>
                            </div>

                            <div class="ha-ide-binary-notice" id="haIdeBinaryNotice" hidden>
                                <p>该文件为二进制或超大文件，不支持在线编辑。</p>
                            </div>
                        </div>

                        <footer class="ha-ide-statusbar">
                            <div class="ha-ide-status-left">
                                <span id="haIdeCursorPos">行 1，列 1</span>
                                <span id="haIdeSelectionInfo"></span>
                            </div>
                            <div class="ha-ide-status-right">
                                <span id="haIdeDocLength">0 行</span>
                                <span id="haIdeLanguage">Plain Text</span>
                                <span>UTF-8</span>
                                <span>空格: 4</span>
                            </div>
                        </footer>
                    </main>
                </div>

                <!-- 历史与回退抽屉 -->
                <div class="ha-ide-drawer" id="haIdeHistoryDrawer" hidden>
                    <div class="ha-ide-drawer-header">
                        <h3>⏱️ 本地 Git 版本历史 & 撤回</h3>
                        <button type="button" class="ha-ide-drawer-close" id="haIdeHistoryClose">✕</button>
                    </div>
                    <div class="ha-ide-drawer-body">
                        <p class="ha-ide-drawer-hint">历史版本由本地 Git 自动记录。可随时回退到指定节点恢复代码：</p>
                        <div class="ha-ide-commit-list" id="haIdeCommitList"></div>
                    </div>
                </div>

                <!-- Git 远端协作抽屉 -->
                <div class="ha-ide-drawer" id="haIdeGitDrawer" hidden>
                    <div class="ha-ide-drawer-header">
                        <h3>☁️ Git 仓库配置与远端协作</h3>
                        <button type="button" class="ha-ide-drawer-close" id="haIdeGitClose">✕</button>
                    </div>
                    <div class="ha-ide-drawer-body">
                        <section class="ha-ide-git-section">
                            <h4>远程仓库地址</h4>
                            <p class="ha-ide-drawer-hint">配置专属远程 Git 仓库（如 GitHub）支持团队多人协作与远端回退：</p>
                            <div class="ha-ide-input-row">
                                <input type="text" id="haIdeGitRemoteInput" placeholder="https://github.com/user/repo.git">
                                <button type="button" class="ha-ide-btn primary" id="haIdeBtnSaveRemote">保存</button>
                            </div>
                        </section>
                        <section class="ha-ide-git-section">
                            <h4>提交当前修改</h4>
                            <div class="ha-ide-input-col">
                                <input type="text" id="haIdeGitCommitMsg" placeholder="提交描述，例如：fix: 修复数据探查空表逻辑">
                                <div class="ha-ide-btn-row">
                                    <button type="button" class="ha-ide-btn" id="haIdeBtnCommitOnly">仅提交到本地</button>
                                    <button type="button" class="ha-ide-btn primary" id="haIdeBtnCommitAndPush">提交并推送到远端</button>
                                </div>
                            </div>
                        </section>
                        <section class="ha-ide-git-section">
                            <h4>远端同步</h4>
                            <div class="ha-ide-btn-row">
                                <button type="button" class="ha-ide-btn" id="haIdeBtnPull">📥 从远端拉取 (Pull)</button>
                                <button type="button" class="ha-ide-btn" id="haIdeBtnPush">📤 推送到远端 (Push)</button>
                                <label class="ha-ide-checkbox-label"><input type="checkbox" id="haIdeForcePush"> 覆盖推送 (Force)</label>
                            </div>
                        </section>
                        <section class="ha-ide-git-section">
                            <h4>Git 执行记录</h4>
                            <pre class="ha-ide-git-console" id="haIdeGitConsole">就绪</pre>
                        </section>
                    </div>
                </div>

                <!-- Diff 预览弹窗 -->
                <div class="ha-ide-diff-modal" id="haIdeDiffModal" role="dialog" aria-modal="true" aria-labelledby="haIdeDiffTitle" hidden>
                    <div class="ha-ide-diff-window">
                        <div class="ha-ide-diff-header">
                            <h3 id="haIdeDiffTitle">版本差异比较 (Diff)</h3>
                            <button type="button" class="ha-ide-drawer-close" id="haIdeDiffClose" aria-label="关闭 / Close">✕</button>
                        </div>
                        <div class="ha-ide-diff-content" id="haIdeDiffContent"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const $ = id => document.getElementById(id);
    const toast = (msg, type = 'success') => {
        if (window.showToast) window.showToast(msg, type);
        else console.log(`[${type}] ${msg}`);
    };

    async function api(path, options = {}) {
        const response = await fetch(`/api/hosted-apps/${encodeURIComponent(slug)}${path}`, {
            credentials: 'same-origin',
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(body.error || `请求失败（${response.status}）`), { status: response.status });
        return body;
    }

    // ── 渲染基座与运维条 ─────────────────────────────────────────
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

    function scheduleBarCollapse() {
        clearTimeout(barCollapseTimer);
        if ($('haBar').hidden || !$('haMenu').hidden) return;
        barCollapseTimer = setTimeout(() => {
            if (!$('haBar').querySelector(':focus-visible')) {
                $('haBar').classList.add('is-collapsed');
            }
        }, 2500);
    }

    function setMenuOpen(open) {
        $('haMenu').hidden = !open;
        $('haPill').setAttribute('aria-expanded', String(open));
        if (open) {
            clearTimeout(barCollapseTimer);
            $('haBar').classList.remove('is-collapsed');
        } else {
            scheduleBarCollapse();
        }
    }

    function setBarVisible(visible) {
        const wasHidden = $('haBar').hidden;
        $('haBar').hidden = !visible;
        if (!visible) {
            setMenuOpen(false);
            clearTimeout(barCollapseTimer);
            $('haBar').classList.remove('is-collapsed');
        } else if (wasHidden) {
            scheduleBarCollapse();
        }
    }

    function updateBar(app) {
        for (const item of document.querySelectorAll('[data-action^="schema-"]')) item.hidden = app.databaseContract !== 'digital-human';
        setBarVisible(app.isAdmin && !!frame);
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
        if (frame) { frame.remove(); frame = null; setBarVisible(false); }
        const adminActions = app.isAdmin ? [{ label: '查看日志', action: 'logs-inline' }, { label: '在线修改代码 (IDE)', action: 'ide' }] : [];
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

    async function openSettings() {
        const form = $('haSettings');
        if (frame) { frame.remove(); frame = null; setBarVisible(false); setCard({ title: 'Python 环境设置' }); }
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

    // ── 在线 IDE 控制中心 ─────────────────────────────────────────
    const ideState = {
        tabs: [], // { path, name, ext, isBinary, originalContent, currentContent, isDirty, lang }
        activePath: null,
        tree: [],
        expandedFolders: new Set(['app', 'app/routers', 'app/services', 'app/dao']),
        filterQuery: '',
        git: { branch: 'main', remoteUrl: '', clean: true }
    };

    function getFileIcon(fileName, isDir = false, isOpen = false) {
        if (isDir) return isOpen ? '📂' : '📁';
        const ext = String(fileName || '').split('.').pop().toLowerCase();
        switch (ext) {
            case 'py': return '🐍';
            case 'js':
            case 'mjs':
            case 'ts': return '🟨';
            case 'html':
            case 'htm': return '🌐';
            case 'css':
            case 'scss': return '🎨';
            case 'sql': return '🗄️';
            case 'json': return '📋';
            case 'md':
            case 'markdown': return '📝';
            case 'sh':
            case 'bash': return '💻';
            case 'txt':
            case 'version': return '📄';
            default: return '📄';
        }
    }

    function openIde() {
        $('haIdeModal').hidden = false;
        $('haIdeAppName').textContent = current?.name || current?.packageName || slug;
        loadIdeTree();
        loadGitStatus();
    }

    async function closeIde() {
        const hasDirty = ideState.tabs.some(t => t.isDirty);
        if (hasDirty) {
            let proceed = false;
            if (window.AppDialog) {
                proceed = await AppDialog.confirm('当前有未保存的代码修改，确定要关闭 IDE 吗？\n未保存的变动将丢失。', {
                    title: '未保存修改',
                    icon: '⚠️',
                    eyebrow: '代码编辑器',
                    tone: 'warning',
                    confirmText: '放弃修改并关闭',
                    cancelText: '继续编辑'
                });
            } else {
                proceed = confirm('当前有未保存的代码修改，确定要关闭 IDE 吗？未保存的变动将丢失。');
            }
            if (!proceed) return;
        }
        closeHistoryDrawer();
        closeGitDrawer();
        $('haIdeModal').hidden = true;
    }

    async function loadGitStatus() {
        try {
            const { status } = await api('/editor/git/status');
            ideState.git = status;
            $('haIdeGitBranch').textContent = `🌿 ${status.branch || 'main'}`;
            if (status.remoteUrl) {
                const shortRemote = status.remoteUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
                $('haIdeRemoteName').textContent = shortRemote;
                $('haIdeGitRemotePill').title = `远程仓库：${status.remoteUrl}`;
            } else {
                $('haIdeRemoteName').textContent = '配置远端';
                $('haIdeGitRemotePill').title = '尚未配置远程仓库，点击配置';
            }
            $('haIdeGitRemoteInput').value = status.remoteUrl || '';
            updateDirtyBadges();
        } catch (_e) {}
    }

    async function loadIdeTree() {
        try {
            const { tree } = await api('/editor/tree');
            ideState.tree = tree || [];
            renderFileTree();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function renderFileTree() {
        const container = $('haIdeFileTree');
        container.innerHTML = '';
        const q = ideState.filterQuery.trim().toLowerCase();

        function renderNodes(nodes, depth = 0) {
            for (const node of nodes) {
                if (q && !node.isDir && !node.name.toLowerCase().includes(q)) continue;
                const item = document.createElement('div');
                item.className = 'ha-ide-tree-item';
                item.dataset.treePath = node.path;
                if (ideState.activePath === node.path) item.classList.add('is-active');
                if (loadingFiles.has(node.path)) item.classList.add('is-loading');
                item.style.paddingLeft = `${depth * 14 + 8}px`;

                const isOpen = ideState.expandedFolders.has(node.path);
                const arrow = node.isDir ? (isOpen ? '▾' : '▸') : '';
                const icon = getFileIcon(node.name, node.isDir, isOpen);

                item.innerHTML = `
                    <div class="ha-ide-tree-label">
                        <span class="ha-ide-tree-arrow">${arrow}</span>
                        <span>${icon}</span>
                        <span>${node.name}</span>
                    </div>
                    <div class="ha-ide-tree-item-actions">
                        ${node.isDir ? `<button type="button" class="ha-ide-tree-btn" data-tree-act="new-file" data-path="${node.path}" title="在此目录下新建文件">+</button>` : ''}
                        <button type="button" class="ha-ide-tree-btn" data-tree-act="rename" data-path="${node.path}" title="重命名">✏️</button>
                        <button type="button" class="ha-ide-tree-btn" data-tree-act="delete" data-path="${node.path}" title="删除">🗑️</button>
                    </div>
                `;

                item.addEventListener('click', e => {
                    if (e.target.closest('.ha-ide-tree-item-actions')) return;
                    if (node.isDir) {
                        if (ideState.expandedFolders.has(node.path)) ideState.expandedFolders.delete(node.path);
                        else ideState.expandedFolders.add(node.path);
                        renderFileTree();
                    } else {
                        openFileInTab(node.path, node.isBinary);
                    }
                });

                container.appendChild(item);

                if (node.isDir && (isOpen || q) && node.children?.length) {
                    renderNodes(node.children, depth + 1);
                }
            }
        }

        renderNodes(ideState.tree, 0);
    }

    const loadingFiles = new Set();

    function showIdeLoading(filePath) {
        const fileName = filePath.split('/').pop();
        const icon = getFileIcon(fileName);
        $('haIdeLoadingFilename').innerHTML = `<span>${icon}</span> <span>${fileName}</span>`;
        $('haIdeLoadingStatus').textContent = '正在载入代码并解析语法…';
        $('haIdeBreadcrumb').textContent = `正在打开: ${filePath} ...`;
        $('haIdeLoading').hidden = false;
        const el = document.querySelector(`[data-tree-path="${CSS.escape(filePath)}"]`);
        if (el) el.classList.add('is-loading');
    }

    function hideIdeLoading(filePath) {
        $('haIdeLoading').hidden = true;
        if (filePath) {
            const el = document.querySelector(`[data-tree-path="${CSS.escape(filePath)}"]`);
            if (el) el.classList.remove('is-loading');
        }
    }

    let highlighterLoading = null;
    function ensureHighlighter() {
        if (window.IdeHighlighter) return Promise.resolve();
        // 已安装的旧启动页可能只有 launcher 引用，在这里补齐编辑器依赖。
        if (!highlighterLoading) {
            highlighterLoading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/js/shared/ide-highlighter.js';
                script.onload = () => {
                    if (window.IdeHighlighter) resolve();
                    else reject(new Error('代码高亮组件初始化失败，请刷新后重试'));
                };
                script.onerror = () => reject(new Error('代码高亮组件加载失败，请检查网络后重试'));
                document.head.appendChild(script);
            }).catch(error => { highlighterLoading = null; throw error; });
        }
        return highlighterLoading;
    }

    async function openFileInTab(filePath, isBinary = false) {
        // 1. 如果已在打开列表中，直接切换激活，防止重复创建标签页
        let tab = ideState.tabs.find(t => t.path === filePath);
        if (tab) {
            activateTab(tab.path);
            return;
        }

        // 2. 如果正在加载中，避免重复请求
        if (loadingFiles.has(filePath)) return;
        loadingFiles.add(filePath);

        // 3. 立即呈现优雅的动态进度圆环与加载态
        showIdeLoading(filePath);

        try {
            await ensureHighlighter();
            const { file } = await api(`/editor/file?path=${encodeURIComponent(filePath)}`);
            const lang = window.IdeHighlighter ? window.IdeHighlighter.detectLanguage(filePath) : 'text';

            // 二次防并发重复检查
            tab = ideState.tabs.find(t => t.path === file.path);
            if (!tab) {
                tab = {
                    path: file.path,
                    name: file.name,
                    ext: file.ext,
                    isBinary: file.isBinary || isBinary,
                    originalContent: file.content || '',
                    currentContent: file.content || '',
                    isDirty: false,
                    lang,
                    scrollTop: 0,
                    scrollLeft: 0,
                    cursor: { line: 1, col: 1 }
                };
                ideState.tabs.push(tab);
            }
            activateTab(tab.path);
        } catch (error) {
            toast(`无法打开文件：${error.message}`, 'error');
            if (!ideState.activePath) {
                $('haIdeWelcome').hidden = false;
                $('haIdeEditorView').hidden = true;
                $('haIdeBreadcrumb').textContent = '选择左侧文件开始编辑';
            }
        } finally {
            loadingFiles.delete(filePath);
            hideIdeLoading(filePath);
        }
    }

    function activateTab(filePath) {
        // 自动过滤去重，确保每个文件仅存在一个标签页
        const seen = new Set();
        ideState.tabs = ideState.tabs.filter(t => {
            if (seen.has(t.path)) return false;
            seen.add(t.path);
            return true;
        });

        const prevTab = ideState.tabs.find(t => t.path === ideState.activePath);
        if (prevTab && !prevTab.isBinary) {
            const ta = $('haIdeTextarea');
            prevTab.scrollTop = ta.scrollTop;
            prevTab.scrollLeft = ta.scrollLeft;
        }

        ideState.activePath = filePath;
        const tab = ideState.tabs.find(t => t.path === filePath);

        renderTabs();
        renderFileTree();

        if (!tab) {
            $('haIdeWelcome').hidden = false;
            $('haIdeEditorView').hidden = true;
            $('haIdeBinaryNotice').hidden = true;
            $('haIdeBreadcrumb').textContent = '选择左侧文件开始编辑';
            return;
        }

        $('haIdeWelcome').hidden = true;
        $('haIdeBreadcrumb').textContent = tab.path.replace(/\//g, ' > ');
        $('haIdeLanguage').textContent = tab.lang.toUpperCase();

        if (tab.isBinary) {
            $('haIdeEditorView').hidden = true;
            $('haIdeBinaryNotice').hidden = false;
            return;
        }

        $('haIdeBinaryNotice').hidden = true;
        $('haIdeEditorView').hidden = false;

        const ta = $('haIdeTextarea');
        ta.value = tab.currentContent;
        highlightEditor(tab);
        updateLineNumbers(tab.currentContent);

        setTimeout(() => {
            ta.scrollTop = tab.scrollTop || 0;
            ta.scrollLeft = tab.scrollLeft || 0;
            syncScroll();
            ta.focus();
        }, 0);
    }

    async function closeTab(filePath, event) {
        if (event) event.stopPropagation();
        const tabIndex = ideState.tabs.findIndex(t => t.path === filePath);
        if (tabIndex === -1) return;
        const tab = ideState.tabs[tabIndex];
        if (tab.isDirty) {
            let proceed = false;
            if (window.AppDialog) {
                proceed = await AppDialog.confirm(`文件「${tab.name}」尚未保存，确定要关闭吗？`, {
                    title: '未保存修改',
                    icon: '⚠️',
                    eyebrow: '代码编辑器',
                    tone: 'warning',
                    confirmText: '关闭文件',
                    cancelText: '取消'
                });
            } else {
                proceed = confirm(`文件 ${tab.name} 尚未保存，确定要关闭吗？`);
            }
            if (!proceed) return;
        }
        ideState.tabs.splice(tabIndex, 1);
        if (ideState.activePath === filePath) {
            const nextTab = ideState.tabs[Math.max(0, tabIndex - 1)];
            activateTab(nextTab ? nextTab.path : null);
        } else {
            renderTabs();
        }
        updateDirtyBadges();
    }

    function renderTabs() {
        const bar = $('haIdeTabsBar');
        bar.innerHTML = '';
        ideState.tabs.forEach(tab => {
            const el = document.createElement('div');
            el.className = `ha-ide-tab${tab.path === ideState.activePath ? ' is-active' : ''}${tab.isDirty ? ' is-dirty' : ''}`;
            el.innerHTML = `
                <span>${getFileIcon(tab.name)}</span>
                <span class="ha-ide-tab-title" title="${tab.path}">${tab.name}</span>
                <span class="ha-ide-tab-dot"></span>
                <button type="button" class="ha-ide-tab-close" title="关闭 (⌘W)">✕</button>
            `;
            el.addEventListener('click', () => activateTab(tab.path));
            el.querySelector('.ha-ide-tab-close').addEventListener('click', e => closeTab(tab.path, e));
            bar.appendChild(el);
        });
        updateDirtyBadges();
    }

    function updateDirtyBadges() {
        const dirtyCount = ideState.tabs.filter(t => t.isDirty).length;
        const badge = $('haIdeDirtyBadge');
        if (dirtyCount > 0) {
            badge.hidden = false;
            badge.textContent = `● ${dirtyCount} 个未保存修改`;
        } else {
            badge.hidden = true;
        }
    }

    function highlightEditor(tab) {
        const codeEl = $('haIdeCode');
        // Use the textarea's normalized text so both layers share character offsets.
        const code = $('haIdeTextarea').value;
        if (window.IdeHighlighter) {
            codeEl.innerHTML = window.IdeHighlighter.highlight(code, tab.lang) + '\n';
            // A malformed highlighter must not move visible text away from the caret.
            if (codeEl.textContent !== code + '\n') codeEl.textContent = code + '\n';
        } else {
            codeEl.textContent = code + '\n';
        }
        syncScroll();
    }

    function updateLineNumbers(text) {
        const lineCount = (text.match(/\n/g) || []).length + 1;
        const gutter = $('haIdeGutter');
        let nums = '';
        for (let i = 1; i <= lineCount; i++) {
            nums += `${i}\n`;
        }
        gutter.textContent = nums;
        $('haIdeDocLength').textContent = `${lineCount} 行`;
    }

    function syncScroll() {
        const ta = $('haIdeTextarea');
        const pre = $('haIdePre');
        const gutter = $('haIdeGutter');
        pre.scrollTop = ta.scrollTop;
        pre.scrollLeft = ta.scrollLeft;
        gutter.scrollTop = ta.scrollTop;
    }

    function updateCursorInfo() {
        const ta = $('haIdeTextarea');
        const pos = ta.selectionStart;
        const text = ta.value.slice(0, pos);
        const lines = text.split('\n');
        const line = lines.length;
        const col = lines[lines.length - 1].length + 1;
        $('haIdeCursorPos').textContent = `行 ${line}，列 ${col}`;

        const selLen = Math.abs(ta.selectionEnd - ta.selectionStart);
        $('haIdeSelectionInfo').textContent = selLen > 0 ? `(选中 ${selLen} 字符)` : '';
    }

    // ── 编辑器键盘与输入处理 ─────────────────────────────────
    $('haIdeTextarea').addEventListener('input', () => {
        const tab = ideState.tabs.find(t => t.path === ideState.activePath);
        if (!tab) return;
        tab.currentContent = $('haIdeTextarea').value;
        tab.isDirty = tab.currentContent !== tab.originalContent;
        highlightEditor(tab);
        updateLineNumbers(tab.currentContent);
        renderTabs();
        updateCursorInfo();
    });

    $('haIdeTextarea').addEventListener('scroll', syncScroll);
    $('haIdeTextarea').addEventListener('keyup', updateCursorInfo);
    $('haIdeTextarea').addEventListener('click', updateCursorInfo);

    $('haIdeTextarea').addEventListener('keydown', e => {
        const ta = $('haIdeTextarea');
        // Tab 缩进处理 (4 空格)
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            if (e.shiftKey) {
                // 反缩进
                const before = ta.value.slice(0, start);
                const lineStart = before.lastIndexOf('\n') + 1;
                if (ta.value.slice(lineStart, lineStart + 4) === '    ') {
                    ta.value = ta.value.slice(0, lineStart) + ta.value.slice(lineStart + 4);
                    ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start - 4);
                }
            } else {
                // 缩进 4 格
                ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end);
                ta.selectionStart = ta.selectionEnd = start + 4;
            }
            ta.dispatchEvent(new Event('input'));
            return;
        }

        // 回车自动继承前一行缩进，若前一行以 : 结尾则增加 4 空格
        if (e.key === 'Enter') {
            e.preventDefault();
            const start = ta.selectionStart;
            const before = ta.value.slice(0, start);
            const line = before.split('\n').pop();
            const indentMatch = line.match(/^(\s*)/);
            let indent = indentMatch ? indentMatch[1] : '';
            if (line.trim().endsWith(':')) {
                indent += '    ';
            }
            const insert = '\n' + indent;
            ta.value = ta.value.substring(0, start) + insert + ta.value.substring(ta.selectionEnd);
            ta.selectionStart = ta.selectionEnd = start + insert.length;
            ta.dispatchEvent(new Event('input'));
            return;
        }

        // 保存快捷键 (⌘S / Ctrl+S)
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentFile();
            return;
        }

        // 保存并重启快捷键 (⌘R / Ctrl+Enter)
        if ((e.metaKey && e.key === 'r') || (e.ctrlKey && e.key === 'Enter')) {
            e.preventDefault();
            saveAndRestartApp();
            return;
        }

        // 查找快捷键 (⌘F / Ctrl+F)
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            e.preventDefault();
            toggleFindBar(true);
            return;
        }
    });

    // ── 文件保存与重启测试 ─────────────────────────────────
    async function saveCurrentFile({ quiet = false } = {}) {
        const tab = ideState.tabs.find(t => t.path === ideState.activePath);
        if (!tab || tab.isBinary) return;
        try {
            await api('/editor/file', {
                method: 'PUT',
                body: JSON.stringify({
                    path: tab.path,
                    content: tab.currentContent,
                    autoCommit: true,
                    commitMessage: `chore(ide): update ${tab.path}`
                })
            });
            tab.originalContent = tab.currentContent;
            tab.isDirty = false;
            renderTabs();
            loadGitStatus();
            if (!quiet) toast(`已保存 ${tab.name}`);
        } catch (error) {
            toast(`保存失败：${error.message}`, 'error');
        }
    }

    async function saveAndRestartApp() {
        // 保存所有未保存的 Tab
        const dirtyTabs = ideState.tabs.filter(t => t.isDirty);
        for (const tab of dirtyTabs) {
            await api('/editor/file', {
                method: 'PUT',
                body: JSON.stringify({
                    path: tab.path,
                    content: tab.currentContent,
                    autoCommit: false
                })
            });
            tab.originalContent = tab.currentContent;
            tab.isDirty = false;
        }
        renderTabs();

        // 提交本次保存修改
        try {
            await api('/editor/git/commit', {
                method: 'POST',
                body: JSON.stringify({ message: `update(ide): quick save and test at ${new Date().toLocaleTimeString('zh-CN')}` })
            });
        } catch (_e) {}

        // 立即触发后台热重启
        try {
            await api('/restart', { method: 'POST', body: '{}' });
            toast('已保存修改并重启应用，正在重新加载…', 'success');
            loadGitStatus();
            setTimeout(() => {
                if (frame) {
                    try { frame.contentWindow.location.reload(); } catch (_e) {}
                }
            }, 1200);
        } catch (error) {
            toast(`重启失败：${error.message}`, 'error');
        }
    }

    // ── 历史版本与回退 (Git History & Revert) ────────────────
    function closeHistoryDrawer() {
        $('haIdeHistoryDrawer').hidden = true;
        $('haIdeBtnHistory')?.classList.remove('active');
    }

    function closeGitDrawer() {
        $('haIdeGitDrawer').hidden = true;
        $('haIdeBtnGit')?.classList.remove('active');
    }

    function toggleHistoryDrawer() {
        if (!$('haIdeHistoryDrawer').hidden) {
            closeHistoryDrawer();
        } else {
            closeGitDrawer();
            openHistoryDrawer();
        }
    }

    function toggleGitDrawer() {
        if (!$('haIdeGitDrawer').hidden) {
            closeGitDrawer();
        } else {
            closeHistoryDrawer();
            openGitDrawer();
        }
    }

    async function openHistoryDrawer() {
        closeGitDrawer();
        $('haIdeHistoryDrawer').hidden = false;
        $('haIdeBtnHistory')?.classList.add('active');
        const container = $('haIdeCommitList');
        container.innerHTML = '<p class="ha-ide-drawer-hint">正在加载提交历史…</p>';
        try {
            const { history } = await api('/editor/git/history?limit=30');
            if (!history?.length) {
                container.innerHTML = '<p class="ha-ide-drawer-hint">暂无提交记录</p>';
                return;
            }
            container.innerHTML = '';
            history.forEach(c => {
                const card = document.createElement('div');
                card.className = 'ha-ide-commit-card';
                card.innerHTML = `
                    <div class="ha-ide-commit-header">
                        <span class="ha-ide-commit-hash" title="${c.hash}">${c.shortHash}</span>
                        <span>${c.date.slice(0, 19)} · ${c.author}</span>
                    </div>
                    <div class="ha-ide-commit-msg">${c.message}</div>
                    <div class="ha-ide-commit-actions">
                        <button type="button" class="ha-ide-btn sm" data-diff="${c.hash}">查看改动 (Diff)</button>
                        <button type="button" class="ha-ide-btn sm primary" data-revert="${c.hash}">回退到此版本</button>
                    </div>
                `;
                card.querySelector('[data-diff]').addEventListener('click', () => showDiff(c.hash, c.message));
                card.querySelector('[data-revert]').addEventListener('click', () => revertToCommit(c.hash));
                container.appendChild(card);
            });
        } catch (error) {
            container.innerHTML = `<p class="ha-ide-drawer-hint" style="color:var(--ha-danger)">加载失败：${error.message}</p>`;
        }
    }

    let diffViewerLoading = null;
    let diffSequence = 0;
    function ensureDiffViewer() {
        if (window.IdeDiffViewer) return Promise.resolve();
        if (!diffViewerLoading) {
            diffViewerLoading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/js/shared/ide-diff-viewer.js';
                script.onload = () => window.IdeDiffViewer ? resolve() : reject(new Error('差异视图初始化失败'));
                script.onerror = () => reject(new Error('差异视图加载失败，请重试'));
                document.head.appendChild(script);
            }).catch(error => { diffViewerLoading = null; throw error; });
        }
        return diffViewerLoading;
    }

    async function showDiff(commitHash, title) {
        const sequence = ++diffSequence;
        $('haIdeDiffModal').hidden = false;
        $('haIdeDiffTitle').textContent = `提交差异：${title} (${commitHash.slice(0, 7)})`;
        $('haIdeDiffContent').classList.remove('ide-diff-view');
        $('haIdeDiffContent').textContent = '正在计算差异…';
        $('haIdeDiffClose').focus();
        try {
            const [{ diff }] = await Promise.all([
                api(`/editor/git/diff?commit=${encodeURIComponent(commitHash)}`),
                ensureDiffViewer(), ensureHighlighter().catch(() => {})
            ]);
            if (sequence !== diffSequence || $('haIdeDiffModal').hidden) return;
            window.IdeDiffViewer.render($('haIdeDiffContent'), diff);
        } catch (error) {
            if (sequence === diffSequence && !$('haIdeDiffModal').hidden) $('haIdeDiffContent').textContent = error.message;
        }
    }

    async function revertToCommit(commitHash) {
        let proceed = false;
        if (window.AppDialog) {
            proceed = await AppDialog.confirm(`确定要将代码完全回退到版本 ${commitHash.slice(0, 7)} 吗？\n回退后当前工作区将恢复至该历史时刻。`, {
                title: '版本回退确认',
                icon: '⏮️',
                eyebrow: '版本控制',
                tone: 'danger',
                confirmText: '确认回退',
                cancelText: '取消'
            });
        } else {
            proceed = confirm(`确定要将代码完全回退到版本 ${commitHash.slice(0, 7)} 吗？回退后当前工作区将恢复至该历史时刻。`);
        }
        if (!proceed) return;
        try {
            await api('/editor/git/revert', {
                method: 'POST',
                body: JSON.stringify({ commitHash })
            });
            toast(`已成功回退到 ${commitHash.slice(0, 7)}`);
            closeHistoryDrawer();
            ideState.tabs = [];
            activateTab(null);
            loadIdeTree();
            loadGitStatus();
        } catch (error) {
            toast(`回退失败：${error.message}`, 'error');
        }
    }

    // ── 远程 Git 协作 (Push, Pull, Remote) ────────────────────
    function openGitDrawer() {
        closeHistoryDrawer();
        $('haIdeGitDrawer').hidden = false;
        $('haIdeBtnGit')?.classList.add('active');
        $('haIdeGitRemoteInput').value = ideState.git.remoteUrl || '';
        $('haIdeGitConsole').textContent = `当前分支: ${ideState.git.branch || 'main'}\n远程仓库: ${ideState.git.remoteUrl || '未配置'}\n未提交文件: ${ideState.git.modified?.length || 0}`;
    }

    async function saveGitRemote() {
        const url = $('haIdeGitRemoteInput').value.trim();
        try {
            await api('/editor/git/remote', { method: 'POST', body: JSON.stringify({ remoteUrl: url }) });
            toast('已更新远程仓库配置');
            loadGitStatus();
            $('haIdeGitConsole').textContent += `\n[OK] 远程地址已配置为: ${url || '（已移除）'}`;
        } catch (error) {
            toast(`配置失败：${error.message}`, 'error');
        }
    }

    async function gitCommitAndPush(push = false) {
        const msg = $('haIdeGitCommitMsg').value.trim();
        const consoleEl = $('haIdeGitConsole');
        consoleEl.textContent += `\n>> 正在执行提交${push ? '与推送' : ''}...`;
        try {
            const commitRes = await api('/editor/git/commit', { method: 'POST', body: JSON.stringify({ message: msg }) });
            consoleEl.textContent += `\n[Commit OK] ${commitRes.message || commitRes.hash}`;
            toast('本地提交成功');
            if (push) {
                const force = $('haIdeForcePush').checked;
                const pushRes = await api('/editor/git/push', { method: 'POST', body: JSON.stringify({ force }) });
                consoleEl.textContent += `\n[Push OK] ${pushRes.output || '推送成功'}`;
                toast('推送至远端成功！');
            }
            $('haIdeGitCommitMsg').value = '';
            loadGitStatus();
        } catch (error) {
            consoleEl.textContent += `\n[Error] ${error.message}`;
            toast(error.message, 'error');
        }
    }

    async function gitPull() {
        const consoleEl = $('haIdeGitConsole');
        consoleEl.textContent += '\n>> 正在从远端拉取更新 (git pull)...';
        try {
            const res = await api('/editor/git/pull', { method: 'POST', body: '{}' });
            consoleEl.textContent += `\n[Pull OK] ${res.output || '拉取完成'}`;
            toast('远端代码拉取成功');
            loadIdeTree();
            loadGitStatus();
        } catch (error) {
            consoleEl.textContent += `\n[Pull Error] ${error.message}`;
            toast(error.message, 'error');
        }
    }

    async function gitPushOnly() {
        const consoleEl = $('haIdeGitConsole');
        const force = $('haIdeForcePush').checked;
        consoleEl.textContent += `\n>> 正在推送到远端 (force: ${force})...`;
        try {
            const res = await api('/editor/git/push', { method: 'POST', body: JSON.stringify({ force }) });
            consoleEl.textContent += `\n[Push OK] ${res.output || '推送完成'}`;
            toast('推送至远端成功！');
            loadGitStatus();
        } catch (error) {
            consoleEl.textContent += `\n[Push Error] ${error.message}`;
            toast(error.message, 'error');
        }
    }

    // ── 文件操作 (新建、重命名、删除) ─────────────────────────
    async function createNewItem(isDir = false, parentPath = '') {
        const title = isDir ? '新建目录' : '新建文件';
        const label = parentPath ? `将在目录「${parentPath}」下创建：` : '输入名称（支持多级相对路径，如 app/test.py）：';
        const placeholder = isDir ? '例如: routers' : '例如: test.py';
        let name = null;
        if (window.AppDialog) {
            name = await AppDialog.prompt(label, {
                title,
                icon: isDir ? '📁' : '📄',
                eyebrow: '资源管理器',
                label: isDir ? '目录名称' : '文件名称',
                placeholder,
                confirmText: '创建',
                cancelText: '取消'
            });
        } else {
            name = prompt(`请输入${title}名称：`);
        }
        if (!name || !name.trim()) return;
        name = name.trim();
        const targetPath = parentPath ? `${parentPath}/${name}` : name;
        try {
            await api('/editor/create', { method: 'POST', body: JSON.stringify({ path: targetPath, isDir }) });
            toast(`已创建 ${name}`);
            if (parentPath) ideState.expandedFolders.add(parentPath);
            await loadIdeTree();
            if (!isDir) openFileInTab(targetPath);
        } catch (error) {
            toast(`创建失败：${error.message}`, 'error');
        }
    }

    async function renameTreeItem(oldPath) {
        const oldName = oldPath.split('/').pop();
        let newName = null;
        if (window.AppDialog) {
            newName = await AppDialog.prompt(`重命名「${oldName}」：`, {
                title: '重命名',
                icon: '✏️',
                eyebrow: '资源管理器',
                label: '新名称',
                defaultValue: oldName,
                placeholder: oldName,
                confirmText: '确认重命名',
                cancelText: '取消'
            });
        } else {
            newName = prompt('请输入新名称：', oldName);
        }
        if (!newName || !newName.trim() || newName.trim() === oldName) return;
        newName = newName.trim();
        const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
        const newPath = dir ? `${dir}/${newName}` : newName;
        try {
            await api('/editor/rename', { method: 'POST', body: JSON.stringify({ oldPath, newPath }) });
            toast(`已重命名为 ${newName}`);
            const openTab = ideState.tabs.find(t => t.path === oldPath);
            if (openTab) {
                openTab.path = newPath;
                openTab.name = newName;
                openTab.ext = newName.includes('.') ? newName.split('.').pop() : '';
            }
            if (ideState.activePath === oldPath) ideState.activePath = newPath;
            await loadIdeTree();
            renderTabs();
        } catch (error) {
            toast(`重命名失败：${error.message}`, 'error');
        }
    }

    async function deleteTreeItem(itemPath) {
        const name = itemPath.split('/').pop();
        let proceed = false;
        if (window.AppDialog) {
            proceed = await AppDialog.confirm(`确定要永久删除「${name}」吗？\n删除后不可恢复。`, {
                title: '删除确认',
                icon: '🗑️',
                eyebrow: '资源管理器',
                tone: 'danger',
                confirmText: '删除',
                cancelText: '取消'
            });
        } else {
            proceed = confirm(`确定要永久删除 ${name} 吗？`);
        }
        if (!proceed) return;
        try {
            await api('/editor/delete', { method: 'POST', body: JSON.stringify({ path: itemPath }) });
            toast(`已删除 ${name}`);
            closeTab(itemPath);
            await loadIdeTree();
            loadGitStatus();
        } catch (error) {
            toast(`删除失败：${error.message}`, 'error');
        }
    }

    // ── 查找与替换 ─────────────────────────────────────────
    function toggleFindBar(show) {
        const bar = $('haIdeFindBar');
        bar.hidden = show !== undefined ? !show : !bar.hidden;
        if (!bar.hidden) $('haIdeFindInput').focus();
    }

    function findNext() {
        const q = $('haIdeFindInput').value;
        if (!q) return;
        const ta = $('haIdeTextarea');
        const start = ta.selectionEnd;
        let pos = ta.value.indexOf(q, start);
        if (pos === -1) pos = ta.value.indexOf(q, 0);
        if (pos !== -1) {
            ta.selectionStart = pos;
            ta.selectionEnd = pos + q.length;
            ta.focus();
            updateCursorInfo();
        } else {
            toast('未找到匹配内容', 'info');
        }
    }

    function replaceCurrent() {
        const q = $('haIdeFindInput').value;
        const r = $('haIdeReplaceInput').value;
        const ta = $('haIdeTextarea');
        if (ta.selectionStart !== ta.selectionEnd && ta.value.substring(ta.selectionStart, ta.selectionEnd) === q) {
            const start = ta.selectionStart;
            ta.value = ta.value.substring(0, start) + r + ta.value.substring(ta.selectionEnd);
            ta.selectionStart = start;
            ta.selectionEnd = start + r.length;
            ta.dispatchEvent(new Event('input'));
            findNext();
        } else {
            findNext();
        }
    }

    function replaceAll() {
        const q = $('haIdeFindInput').value;
        const r = $('haIdeReplaceInput').value;
        if (!q) return;
        const ta = $('haIdeTextarea');
        const count = (ta.value.split(q).length - 1);
        if (count === 0) return toast('未找到匹配内容', 'info');
        ta.value = ta.value.split(q).join(r);
        ta.dispatchEvent(new Event('input'));
        toast(`已替换 ${count} 处匹配`);
    }

    // ── IDE 顶部及侧栏交互绑定 ─────────────────────────────
    $('haIdeBtnSave').addEventListener('click', () => saveCurrentFile());
    $('haIdeBtnRestart').addEventListener('click', () => saveAndRestartApp());
    $('haIdeBtnHistory').addEventListener('click', toggleHistoryDrawer);
    $('haIdeBtnGit').addEventListener('click', toggleGitDrawer);
    $('haIdeBtnPackageUpdate').addEventListener('click', openUploadModal);
    $('haIdeGitRemotePill').addEventListener('click', () => {
        if (!$('haIdeGitDrawer').hidden) closeGitDrawer();
        else { closeHistoryDrawer(); openGitDrawer(); }
    });
    $('haIdeBtnFullscreen').addEventListener('click', () => $('haIdeWindow').classList.toggle('is-fullscreen'));
    $('haIdeBtnClose').addEventListener('click', closeIde);
    $('haIdeHistoryClose').addEventListener('click', closeHistoryDrawer);
    $('haIdeGitClose').addEventListener('click', closeGitDrawer);
    $('haIdeDiffClose').addEventListener('click', () => $('haIdeDiffModal').hidden = true);

    $('haIdeBtnNewFile').addEventListener('click', () => createNewItem(false));
    $('haIdeBtnNewFolder').addEventListener('click', () => createNewItem(true));
    $('haIdeBtnRefreshTree').addEventListener('click', loadIdeTree);
    $('haIdeSearchInput').addEventListener('input', e => {
        ideState.filterQuery = e.target.value;
        renderFileTree();
    });

    $('haIdeFileTree').addEventListener('click', e => {
        const btn = e.target.closest('[data-tree-act]');
        if (!btn) return;
        const act = btn.dataset.treeAct;
        const p = btn.dataset.path;
        if (act === 'new-file') createNewItem(false, p);
        if (act === 'rename') renameTreeItem(p);
        if (act === 'delete') deleteTreeItem(p);
    });

    $('haIdeBtnFind').addEventListener('click', () => toggleFindBar(true));
    $('haIdeBtnFindClose').addEventListener('click', () => toggleFindBar(false));
    $('haIdeBtnFindNext').addEventListener('click', findNext);
    $('haIdeBtnReplace').addEventListener('click', replaceCurrent);
    $('haIdeBtnReplaceAll').addEventListener('click', replaceAll);
    $('haIdeBtnDiscard').addEventListener('click', async () => {
        const tab = ideState.tabs.find(t => t.path === ideState.activePath);
        if (!tab || !tab.isDirty) return;
        let proceed = false;
        if (window.AppDialog) {
            proceed = await AppDialog.confirm(`确定放弃「${tab.name}」的全部未保存修改吗？\n放弃后将还原为磁盘上的原始内容。`, {
                title: '放弃修改',
                icon: '↩️',
                eyebrow: '代码编辑器',
                tone: 'warning',
                confirmText: '放弃更改',
                cancelText: '继续编辑'
            });
        } else {
            proceed = confirm(`确定放弃 ${tab.name} 的全部未保存修改吗？`);
        }
        if (proceed) {
            tab.currentContent = tab.originalContent;
            tab.isDirty = false;
            activateTab(tab.path);
            toast('已放弃更改');
        }
    });

    $('haIdeBtnSaveRemote').addEventListener('click', saveGitRemote);
    $('haIdeBtnCommitOnly').addEventListener('click', () => gitCommitAndPush(false));
    $('haIdeBtnCommitAndPush').addEventListener('click', () => gitCommitAndPush(true));
    $('haIdeBtnPull').addEventListener('click', gitPull);
    $('haIdeBtnPush').addEventListener('click', gitPushOnly);

    // 全局快捷键处理 (当 IDE 打开时)
    window.addEventListener('keydown', e => {
        if ($('haIdeModal').hidden) return;
        if (e.key === 'Escape') {
            if (!$('haIdeDiffModal').hidden) {
                $('haIdeDiffModal').hidden = true;
                return;
            }
            if (!$('haIdeFindBar').hidden) {
                toggleFindBar(false);
                return;
            }
            if (!$('haIdeHistoryDrawer').hidden) {
                closeHistoryDrawer();
                return;
            }
            if (!$('haIdeGitDrawer').hidden) {
                closeGitDrawer();
                return;
            }
        }
    });

    // ── 数据库信息弹窗 ─────────────────────────────────
    async function openDbInfoModal() {
        $('haDbModal').hidden = false;
        $('haDbModalTitle').textContent = `${current?.name || slug} · 已分配数据库`;
        try {
            const { appDatabase, businessDatabase, businessDatasource } = await api('/config');
            const biz = businessDatabase?.name || businessDatasource || 'platform:report.db';
            $('haDbBizName').textContent = biz;
            $('haDbBizEnv').textContent = `BUSINESS_DATASOURCE_NAME=${biz}`;
            if (appDatabase) {
                $('haDbAppName').textContent = `app (Schema: ${appDatabase.schema || 'default'})`;
                $('haDbAppEnv').textContent = `APP_DATASOURCE_ID=app, APP_SCHEMA=${appDatabase.schema || ''}`;
                $('haDbAppFile').textContent = appDatabase.file || 'app.db';
            }
        } catch (error) {
            toast(`读取数据库配置失败: ${error.message}`, 'error');
        }
    }

    $('haDbModalClose').addEventListener('click', () => $('haDbModal').hidden = true);
    document.addEventListener('click', e => {
        const copyBtn = e.target.closest('[data-copy-target]');
        if (copyBtn) {
            const targetId = copyBtn.dataset.copyTarget;
            const text = $(targetId)?.textContent || '';
            if (text && navigator.clipboard) {
                navigator.clipboard.writeText(text).then(() => {
                    toast('已复制到剪贴板');
                }).catch(() => {});
            }
        }
    });

    // ── 更新上传包 (Package Upload & Update) ─────────────────────
    let selectedPackagePayload = null;

    function resetUploadModal() {
        selectedPackagePayload = null;
        if ($('haUploadFileInput')) $('haUploadFileInput').value = '';
        $('haUploadCurrentAppName').textContent = current?.name || current?.packageName || slug;
        $('haUploadCurrentVersion').textContent = current?.version ? `v${current.version}` : '';
        $('haUploadPreview').hidden = true;
        $('haUploadErrorBox').hidden = true;
        $('haUploadErrorBox').textContent = '';
        $('haUploadProgress').hidden = true;
        $('haUploadSubmitBtn').disabled = true;
        $('haUploadSubmitBtn').textContent = '确认上传并更新';
        $('haUploadCancelBtn').disabled = false;
        $('haUploadDropzone').classList.remove('is-dragover');
    }

    function openUploadModal() {
        resetUploadModal();
        $('haUploadModal').hidden = false;
    }

    function closeUploadModal() {
        if (!$('haUploadProgress').hidden) return;
        $('haUploadModal').hidden = true;
        resetUploadModal();
    }

    async function handlePackageFile(file) {
        if (!file) return;
        if (!/\.zip$/i.test(file.name)) {
            $('haUploadErrorBox').textContent = '仅支持上传 .zip 格式的压缩包';
            $('haUploadErrorBox').hidden = false;
            $('haUploadPreview').hidden = true;
            $('haUploadSubmitBtn').disabled = true;
            return;
        }
        if (file.size > 35 * 1024 * 1024) {
            $('haUploadErrorBox').textContent = 'ZIP 文件不能超过 35 MB；依赖较多时可去掉 wheels/ 改为在线安装';
            $('haUploadErrorBox').hidden = false;
            $('haUploadPreview').hidden = true;
            $('haUploadSubmitBtn').disabled = true;
            return;
        }

        $('haUploadErrorBox').hidden = true;
        $('haUploadPreview').hidden = true;
        $('haUploadSubmitBtn').disabled = true;
        $('haUploadProgress').hidden = false;
        $('haUploadProgressText').textContent = '正在读取并解析应用包结构…';

        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const chunkSize = 0x8000;
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
            }
            const archiveBase64 = btoa(binary);

            const { app: preview } = await api('/preview', {
                method: 'POST',
                body: JSON.stringify({ archiveBase64, archiveName: file.name })
            });

            $('haUploadProgress').hidden = true;
            selectedPackagePayload = { archiveBase64, archiveName: file.name, preview };

            $('haUploadFileSize').textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
            $('haUploadPkgName').textContent = preview.name || current?.name || slug;
            $('haUploadPkgVersion').textContent = preview.version ? `v${preview.version}` : '未指定版本';
            $('haUploadPkgEntry').textContent = preview.entry || '-';
            $('haUploadPkgInterface').textContent = (preview.interface || 'asgi').toUpperCase();
            $('haUploadPkgFiles').textContent = `${preview.fileCount} 个文件 · 解压 ${(preview.totalBytes / 1024 / 1024).toFixed(2)} MB`;
            if (preview.python?.ok) {
                $('haUploadPkgPython').textContent = `Python ${preview.python.version || '正常'}`;
                $('haUploadPkgPython').className = 'ha-upload-py-status ok';
            } else {
                $('haUploadPkgPython').textContent = preview.python?.message || '未检测到可用环境';
                $('haUploadPkgPython').className = 'ha-upload-py-status warn';
            }

            $('haUploadPreview').hidden = false;
            $('haUploadSubmitBtn').disabled = false;
        } catch (error) {
            $('haUploadProgress').hidden = true;
            $('haUploadErrorBox').textContent = error.message || '应用包解析失败，请检查压缩包是否完整';
            $('haUploadErrorBox').hidden = false;
            $('haUploadSubmitBtn').disabled = true;
        }
    }

    async function submitPackageUpdate() {
        if (!selectedPackagePayload) return;
        $('haUploadSubmitBtn').disabled = true;
        $('haUploadCancelBtn').disabled = true;
        $('haUploadErrorBox').hidden = true;
        $('haUploadProgress').hidden = false;
        $('haUploadProgressText').textContent = '正在上传应用包并替换代码…';

        try {
            await api('/package', {
                method: 'POST',
                body: JSON.stringify({
                    archiveBase64: selectedPackagePayload.archiveBase64,
                    archiveName: selectedPackagePayload.archiveName
                })
            });

            toast('应用包更新成功！已保留数据库并重启应用');
            closeUploadModal();

            if (!$('haIdeModal').hidden) {
                ideState.tabs = [];
                activateTab(null);
                loadIdeTree();
                loadGitStatus();
            }

            if (frame) { frame.remove(); frame = null; }
            setBarVisible(false);
            setTimeout(load, 800);
        } catch (error) {
            $('haUploadProgress').hidden = true;
            $('haUploadSubmitBtn').disabled = false;
            $('haUploadCancelBtn').disabled = false;
            $('haUploadErrorBox').textContent = error.message || '更新应用包失败';
            $('haUploadErrorBox').hidden = false;
            toast(`更新失败：${error.message}`, 'error');
        }
    }

    $('haUploadDropzone').addEventListener('click', () => $('haUploadFileInput').click());
    $('haUploadDropzone').addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $('haUploadFileInput').click();
        }
    });
    $('haUploadFileInput').addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (file) handlePackageFile(file);
    });
    $('haUploadDropzone').addEventListener('dragover', e => {
        e.preventDefault();
        $('haUploadDropzone').classList.add('is-dragover');
    });
    $('haUploadDropzone').addEventListener('dragleave', e => {
        e.preventDefault();
        $('haUploadDropzone').classList.remove('is-dragover');
    });
    $('haUploadDropzone').addEventListener('drop', e => {
        e.preventDefault();
        $('haUploadDropzone').classList.remove('is-dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) handlePackageFile(file);
    });

    $('haUploadModalClose').addEventListener('click', closeUploadModal);
    $('haUploadCancelBtn').addEventListener('click', closeUploadModal);
    $('haUploadSubmitBtn').addEventListener('click', submitPackageUpdate);

    // ── 运维胶囊动作分发 ─────────────────────────────────
    async function runAction(action) {
        if (action === 'schema-init' || action === 'schema-upgrade') {
            const kind = action === 'schema-init' ? 'init' : 'upgrade';
            try {
                const { script } = await api(`/database-script?kind=${kind}`);
                if (script.applied) { toast(schemaText('当前脚本已部署，无需重复执行', 'This script is already deployed')); return; }
                if (!window.AppDialog) { toast(schemaText('请刷新页面后使用数据库部署功能', 'Refresh the page to enable database deployment'), 'error'); return; }
                const approved = await AppDialog.confirm(schemaText(`仅在当前应用库执行 ${script.file}，不操作业务库。请核对下方脚本后执行。`, `Run ${script.file} in this app database only. Review the script below before deploying.`), { title: kind === 'init' ? schemaText('初始化应用表', 'Initialize app tables') : schemaText('升级应用表', 'Upgrade app tables'), details: script.sql, tone: 'warning', confirmText: schemaText('执行部署脚本', 'Deploy script'), cancelText: schemaText('取消', 'Cancel') });
                if (!approved) return;
                await api('/database-script', { method: 'POST', body: JSON.stringify({ kind, hash: script.hash }) });
                toast(schemaText('应用表部署完成，请刷新应用页面', 'Database deployed. Refresh the application page'));
            } catch (error) { toast(schemaText(`数据库部署失败：${error.message}`, `Database deployment failed: ${error.message}`), 'error'); }
            return;
        }
        if (action === 'retry') return load();
        if (action === 'settings') return openSettings();
        if (action === 'db-info') return openDbInfoModal();
        if (action === 'ide') return openIde();
        if (action === 'package-update') return openUploadModal();
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
            setBarVisible(false);
            setTimeout(load, 600);
        } catch (error) {
            if (window.AppDialog) AppDialog.alert(error.message, { title: '操作失败', tone: 'danger' });
        }
    }

    $('haPill').addEventListener('click', event => {
        event.stopPropagation();
        setMenuOpen($('haMenu').hidden);
    });
    $('haMenu').addEventListener('click', event => {
        const action = event.target.closest('button')?.dataset.action;
        if (!action) return;
        setMenuOpen(false);
        runAction(action);
    });
    document.addEventListener('click', event => {
        if (!$('haBar').contains(event.target)) setMenuOpen(false);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !$('haUploadModal').hidden) {
            closeUploadModal();
            return;
        }
        if (event.key === 'Escape' && !$('haDbModal').hidden) {
            $('haDbModal').hidden = true;
            return;
        }
        if (event.key === 'Escape' && !$('haMenu').hidden) {
            setMenuOpen(false);
            $('haPill').focus();
        }
    });
    $('haBar').addEventListener('pointerenter', () => clearTimeout(barCollapseTimer));
    $('haBar').addEventListener('pointerleave', scheduleBarCollapse);
    $('haBar').addEventListener('focusin', () => {
        clearTimeout(barCollapseTimer);
        $('haBar').classList.remove('is-collapsed');
    });
    $('haBar').addEventListener('focusout', scheduleBarCollapse);

    window.addEventListener('blur', () => {
        setTimeout(() => {
            if (frame && document.activeElement === frame) {
                setMenuOpen(false);
                $('haBar').classList.add('is-collapsed');
            }
        }, 0);
    });
    $('haDrawerClose').addEventListener('click', () => { $('haDrawer').hidden = true; logsOpen = false; });

    load();
})();
