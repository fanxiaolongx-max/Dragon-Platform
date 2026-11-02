// 首页主逻辑（原 index.html 内联脚本，移出后可长期缓存；仍是普通脚本，与其他首页脚本共用全局作用域）
        const historyState = {
            items: [],
            filtered: [],
            query: '',
            page: 1,
            pageSize: 10
        };
        let customToolsCount = 0;
        let platformSummary = null;
        const friendLinksState = {
            snapshot: null,
            editorLinks: [],
            editorDirty: false,
            refreshTimer: null,
            probing: false,
            apiRelayTab: 'openai',
            apiRelayDirty: false
        };

        const HOME_I18N = {
            'zh-CN': {
                'home.title': '工具中台',
                'home.description': '统一工具平台入口：UIVF12 抓取引擎 & Task SLA 风险监控台',
                'home.hero.desc': '统一工具中台 · 前后端分离架构 · 数据持久化存储<br>让每一个工具都更强大、更稳定、更易扩展',
                'home.graph.title': '项目知识图谱',
                'home.graph.subtitle': '探索模块、工具、代码与数据关系',
                'home.links.title': '友情链接',
                'home.links.showAll': '展开全部 ({n})',
                'home.links.showLess': '收起',
                'home.links.wise': '财务管理',
                'home.links.app': '手机控制',
                'home.links.yutang': 'AI 远程控机',
                'home.links.api': 'API 中转',
                'home.links.api2': 'API 中转二站',
                'home.links.cs2': '工具中台备用',
                'home.links.csMain': '工具中台主站',
                'home.links.license': 'License 发放',
                'home.links.ssh': '移动终端云',
                'home.links.pcap': '网络分析',
                'home.links.canting': '餐厅服务',
                'home.links.manageTitle': '友情链接管理',
                'home.links.manageSubtitle': '修改后全平台首页立即生效；状态探测由服务端低频执行并复用缓存。',
                'home.links.manageHint': '点击管理友情链接',
                'home.links.adminOnly': '只有超级管理员可以修改友情链接',
                'home.links.interval': '自动探测间隔',
                'home.links.minutes': '分钟',
                'home.links.probeAll': '立即检测全部',
                'home.links.probing': '正在检测…',
                'home.links.add': '＋ 添加友情链接',
                'home.links.cancel': '取消',
                'home.links.save': '保存修改',
                'home.links.saving': '正在保存…',
                'home.links.icon': '图标',
                'home.links.name': '中文名称',
                'home.links.nameEn': '英文名称（可选）',
                'home.links.url': 'https://example.com/',
                'home.links.probeOne': '检测',
                'home.links.delete': '删除',
                'home.links.up': '上移',
                'home.links.down': '下移',
                'home.links.lastProbe': '上次检测：{time}',
                'home.links.neverProbed': '尚未检测 · 默认每 30 分钟低频执行',
                'home.links.unsavedProbe': '有未保存的修改，请先保存后再检测。',
                'home.links.saved': '友情链接已保存',
                'home.links.saveFailed': '保存失败：{message}',
                'home.links.probeFailed': '检测失败：{message}',
                'home.links.status.online': '正常',
                'home.links.status.warning': '安全提示',
                'home.links.status.offline': '不可达',
                'home.links.status.unknown': '未检测',
                'home.apiRelay.title': '⚡ AI API 中转配置',
                'home.apiRelay.subtitle': 'OpenAI、Anthropic 可直接使用；Gemini 模型默认走稳定的 OpenAI 兼容通道。',
                'home.apiRelay.publicBase': '公网 BASE URL',
                'home.apiRelay.apiKey': 'API 密钥',
                'home.apiRelay.openAiModel': 'OpenAI / Gemini 模型',
                'home.apiRelay.defaultModel': 'Anthropic / Claude 主模型',
                'home.apiRelay.fastModel': 'Claude 快速模型',
                'home.apiRelay.copyCurrent': '⧉ 复制当前示例',
                'home.apiRelay.copyAll': '⧉ 一键复制全部对接信息',
                'home.apiRelay.installClaude': '＋ 自动添加到 Claude Code',
                'home.apiRelay.openSite': '打开中转站 ↗',
                'home.apiRelay.save': '保存配置',
                'home.apiRelay.runtimeWeb': '网页版可一键复制；“自动添加”仅在本地 EXE 中可用。',
                'home.apiRelay.runtimeDesktop': '本地 EXE 可自动合并到 Claude Code，并会先备份现有配置。',
                'home.apiRelay.copied': '已复制到剪贴板',
                'home.apiRelay.copyFailed': '复制失败，请手动选择内容复制',
                'home.apiRelay.saved': 'API 中转配置已保存',
                'home.apiRelay.saveFailed': '保存失败：{message}',
                'home.apiRelay.installed': '已添加到 Claude Code：{path}',
                'home.apiRelay.installFailed': '自动添加失败：{message}',
                'home.apiRelay.saveBeforeInstall': '配置已修改，请先保存后再自动添加。',
                'home.custom.note': '导入 HTML 或 ZIP 工具包后，会自动生成首页模块和顶部导航入口，并默认支持静态快照与 Pages 推送',
                'home.custom.upload': '导入 HTML / ZIP / SKILL',
                'home.market.button': '工具市场',
                'home.market.short': '市场',
                'home.builtin.compareShort': '比对',
                'home.builtin.compare': '内置工具差异比对与回退',
                'home.custom.uploadShort': '导入',
                'home.market.title': '工具市场',
                'home.market.subtitle': '从已启用的仓库安装或更新 HTML 工具。',
                'home.market.details': '查看详细更新日志',
                'home.import.title': '导入自定义工具',
                'home.import.subtitle': '一次填写工具信息并上传 HTML 或 ZIP 工具包（自动支持离线快照与 Pages 静态推送）。',
                'home.import.fileTitle': '选择 HTML / ZIP / SKILL 文件',
                'home.import.fileHint': 'HTML 或 ZIP 工具包（最大 35 MB）；含 SKILL.md 的会导入为技能；含 requirements.txt 的 Python Web 应用包（FastAPI 等）由平台托管运行',
                'home.import.pyDetected': '已识别为 Python Web 应用（{entry}，{iface}）：导入后平台会创建独立环境、安装依赖并在工具菜单生成入口',
                'home.import.pyOffline': '，使用包内 {count} 个离线依赖',
                'home.import.pyNoPython': '已识别为 Python Web 应用，但{message}；仍可导入，配置好 Python 后在应用入口重新安装依赖',
                'home.import.pyUpdate': '已托管同名应用「{name}」{version}。要更新它吗？更新会保留应用数据库和访问配置；选择「取消」则作为新应用导入。',
                'home.import.pyUpdateTitle': '更新已托管的 Python 应用',
                'home.import.pyConfirm': '导入后平台会在本机运行这个应用包里的 Python 代码。请只导入来源可信的应用包。应用只能经平台登录后访问，平台数据只读、仅能写自己的应用库。继续导入？',
                'home.import.pyConfirmTitle': '导入 Python 应用',
                'home.import.pySubmit': '导入应用',
                'home.import.pyUpdateSubmit': '更新应用',
                'home.import.pyImported': '已导入，正在后台安装依赖并启动；打开工具入口可查看进度',
                'home.import.pyUpdated': '应用已更新，正在重新启动',
                'home.import.skillChecking': '正在识别文件类型…',
                'home.import.skillDetected': '已识别为 SKILL 技能包 @{id}：导入后出现在「全部工具 → 技能」，可在对话里 @{id} 使用',
                'home.import.skillFiles': '，附带 {count} 个参考文件',
                'home.import.skillSubmit': '导入技能',
                'home.import.skillTitle': '导入技能',
                'home.import.skillName': '中文技能名',
                'home.import.skillNameEn': '英文技能名',
                'home.import.skillExists': '已有技能 @{id}，要用这个技能包覆盖吗？',
                'home.import.skillReserved': '@{id} 是内置技能的标识，请修改 SKILL.md 里的 id 后再导入',
                'home.import.skillImported': '已导入技能 @{id}',
                'home.import.icon': '图标',
                'home.import.name': '中文工具名',
                'home.import.nameEn': '英文工具名',
                'home.import.description': '中文简介',
                'home.import.descriptionEn': '英文简介',
                'home.import.tags': '标签',
                'home.import.tagsPlaceholder': '用逗号分隔，最多 8 个',
                'home.import.cancel': '取消',
                'home.import.done': '完成',
                'home.import.submit': '导入工具',
                'home.import.submitting': '正在导入…',
                'home.import.fileRequired': '请先选择 HTML 或 ZIP 文件',
                'home.import.fileSelected': '已选择：{name} · {size}',
                'home.import.aiAnalyzing': '正在用 AI 分析工具用途并生成信息…',
                'home.import.aiComplete': 'AI 已自动生成中英文名称、简介和标签，你可以继续修改',
                'home.import.aiUnavailable': 'AI 接口当前不可用，请手动填写下方工具信息；不影响继续导入。',
                'home.import.zipHtmlMissing': 'ZIP 中没有找到 HTML 入口文件',
                'home.arrow.tool': '进入工具 →',
                'home.arrow.module': '进入模块 →',
                'home.stats.scripts': '脚本仓库数量',
                'home.stats.history': '历史操作记录',
                'home.stats.tools': '在线工具模块',
                'home.stats.title': '🚀 平台效能总览',
                'home.stats.badge': '基于真实业务数据动态计算',
                'home.stats.checks': '已完成指标检查',
                'home.stats.service': '累计服务次数',
                'home.stats.manual': '等效人工工时',
                'home.stats.saved': '累计节约工时',
                'home.stats.automation': '自动化脚本沉淀',
                'home.stats.efficiency': '提效率约 {rate}%',
                'home.stats.method': '查看效能估算口径',
                'home.stats.note.checks': '自动核对与评分',
                'home.stats.note.service': '业务操作 + 工具访问',
                'home.stats.note.manual': '按保守口径折算',
                'home.stats.note.tools': '统一入口稳定服务',
                'home.stats.note.scripts': '可复用生产力资产',
                'home.stats.methodology': '指标检查 2 分钟/项、脚本手工编制 90 分钟/个、数据导入整理 30 分钟/次、报表整理 45 分钟/份；AI 问答 8 分钟/次、告警研判 3 分钟/次。节约工时已扣除平台操作和人工复核时间，属管理口径估算值。',
                'home.ai.title': '✨ AI 智能应用',
                'home.ai.badge': '已融入核心业务流程',
                'home.ai.scenarios': 'AI 应用场景',
                'home.ai.tasks': '智能任务完成',
                'home.ai.tokens': 'Token 处理量',
                'home.ai.alerts': '告警智能研判',
                'home.ai.pages': '业务页面覆盖',
                'home.ai.saved': 'AI 节约分析时间',
                'home.ai.taskNote': '含 {questions} 次 AI 问答',
                'home.ai.note.scenarios': '助手·适配·告警·PPT',
                'home.ai.note.tokens': '大模型语义处理',
                'home.ai.note.alerts': '模型 + 智能规则兜底',
                'home.ai.note.pages': '已产生真实 AI 会话',
                'home.ai.note.saved': '按保守人工分析口径',
                'home.impact.automationScripts': '自动化脚本',
                'home.impact.hoursSaved': '已节约小时',
                'home.impact.dataImports': '数据导入',
                'home.impact.snapshotsStored': '快照沉淀',
                'home.impact.metricChecks': '指标检查',
                'home.impact.reportSnapshots': '报表快照',
                'home.impact.weaknessesFound': '短板自动识别',
                'home.impact.traceableSnapshots': '可追溯快照',
                'home.impact.monthsStored': '个月数据沉淀',
                'home.impact.historySnapshots': '历史快照',
                'home.impact.customerGroups': '客户群覆盖',
                'home.impact.metricResults': '指标结果',
                'home.impact.autoCalculations': '自动核算',
                'home.impact.requirementsManaged': '需求统一管理',
                'home.impact.workflowTransitions': '流程流转',
                'home.impact.auditRules': '稽查规则',
                'home.impact.auditTemplates': '审计模板',
                'home.impact.tablesProtected': '数据表守护',
                'home.impact.databasesGoverned': '数据库统一治理',
                'home.impact.tablesVisible': '数据表可视',
                'home.impact.coreDatabases': '核心数据库',
                'home.impact.totalOpens': '累计打开',
                'home.impact.onlineTool': '在线工具',
                'home.history.title': '最近操作历史',
                'home.history.allTools': '全部工具',
                'home.history.search': '搜索操作、详情或工具',
                'home.history.count': '{n} 条记录',
                'home.history.justNow': '刚刚',
                'home.history.minutes': '{n} 分钟前',
                'home.history.hours': '{n} 小时前',
                'home.history.yesterday': '昨天 {time}',
                'home.history.refresh': '刷新历史',
                'home.history.loading': '正在加载最近操作历史...',
                'home.history.refreshing': '正在刷新操作历史...',
                'home.history.empty': '当前筛选条件下暂无操作记录。',
                'home.history.none': '当前无可展示记录',
                'home.history.defaultPage': '默认显示最近 10 条',
                'home.history.page': '显示第 {from}-{to} 条，共 {total} 条 · 第 {page}/{pages} 页',
                'home.history.prev': '上一页',
                'home.history.next': '下一页',
                'home.history.failed': '加载失败：{message}',
                'home.history.sourceFailed': '加载失败',
                'home.history.noDetail': '无附加说明',
                'home.tool.uiv': '数据抓取',
                'home.tool.sla': '数据导入',
                'home.tool.custom': '工具管理',
                'home.tool.builtin': '内置工具',
                'home.tool.unknown': '未分类',
                'home.prompt.name': '请输入工具名称：',
                'home.prompt.icon': '请输入工具图标，可留空：',
                'home.prompt.description': '请输入工具简介，可留空：',
                'home.prompt.rename': '修改工具名称：',
                'home.toast.imported': '自定义工具导入成功，入口已生成',
                'home.alert.importFailed': '导入自定义工具失败：{message}',
                'home.confirm.delete': '确定删除这个自定义工具入口和 HTML 文件吗？',
                'home.toast.deleted': '自定义工具已删除',
                'home.toast.renamed': '工具名称已更新',
                'home.alert.deleteFailed': '删除失败：{message}',
                'home.alert.renameFailed': '修改名称失败：{message}',
                'home.dialog.renameTitle': '修改工具名称',
                'home.dialog.deleteTitle': '删除自定义工具',
                'home.dialog.delete': '删除',
                'home.dialog.save': '保存',
                'home.dialog.failed': '操作失败',
                'home.validation.nameRequired': '工具名称不能为空',
                'home.validation.nameTooLong': '工具名称不能超过 80 个字符',
                'home.custom.defaultName': '自定义工具',
                'home.custom.defaultDesc': '由独立 HTML 导入的平台工具，可在统一入口和顶部导航中访问。',
                'home.custom.defaultTag1': '自定义 HTML',
                'home.custom.defaultTag2': '平台入口',
                'home.custom.download': '下载完整工具包',
                'home.custom.downloadApp': '下载原始应用包',
                'home.custom.downloading': '正在下载',
                'home.custom.downloadedApp': '已下载导入时上传的应用包',
                'home.custom.downloadedAppRebuilt': '已下载应用包（该应用导入较早，未保存原始包，已按当前代码重新打包）',
                'home.custom.downloadedHtml': '已下载可独立运行的 HTML',
                'home.custom.downloadedZip': '已下载完整 ZIP 工具包（{count} 个文件）',
                'home.custom.downloadFailed': '下载工具包失败：{message}',
                'home.custom.rename': '修改工具名称',
                'home.custom.delete': '删除自定义工具'
            },
            'en-US': {
                'home.title': 'Tool Hub',
                'home.description': 'Unified tool hub for data capture, SLA import, reporting, and operations workflows.',
                'home.hero.desc': 'A unified tool hub · Decoupled frontend/backend · Persistent data storage<br>Make every tool stronger, steadier, and easier to extend',
                'home.graph.title': 'Project Knowledge Graph',
                'home.graph.subtitle': 'Explore modules, tools, code, and data relationships',
                'home.links.title': 'Links',
                'home.links.showAll': 'Show all ({n})',
                'home.links.showLess': 'Show less',
                'home.links.wise': 'Finance',
                'home.links.app': 'Phone Control',
                'home.links.yutang': 'AI Phone Control',
                'home.links.api': 'API Relay',
                'home.links.api2': 'API Relay 2',
                'home.links.cs2': 'Backup Hub',
                'home.links.csMain': 'Tools Platform',
                'home.links.license': 'Issue Licenses',
                'home.links.ssh': 'Mobile Terminal Cloud',
                'home.links.pcap': 'Network Analysis',
                'home.links.canting': 'Dining Service',
                'home.links.manageTitle': 'Manage Links',
                'home.links.manageSubtitle': 'Changes apply to the home page immediately. Probes run infrequently on the server and reuse cached results.',
                'home.links.manageHint': 'Click to manage links',
                'home.links.adminOnly': 'Only super administrators can edit links',
                'home.links.interval': 'Automatic probe interval',
                'home.links.minutes': 'minutes',
                'home.links.probeAll': 'Check All Now',
                'home.links.probing': 'Checking…',
                'home.links.add': '＋ Add Link',
                'home.links.cancel': 'Cancel',
                'home.links.save': 'Save Changes',
                'home.links.saving': 'Saving…',
                'home.links.icon': 'Icon',
                'home.links.name': 'Chinese name',
                'home.links.nameEn': 'English name (optional)',
                'home.links.url': 'https://example.com/',
                'home.links.probeOne': 'Check',
                'home.links.delete': 'Delete',
                'home.links.up': 'Move up',
                'home.links.down': 'Move down',
                'home.links.lastProbe': 'Last checked: {time}',
                'home.links.neverProbed': 'Not checked yet · low-frequency check every 30 minutes by default',
                'home.links.unsavedProbe': 'Save your changes before running a check.',
                'home.links.saved': 'Links saved',
                'home.links.saveFailed': 'Save failed: {message}',
                'home.links.probeFailed': 'Check failed: {message}',
                'home.links.status.online': 'Online',
                'home.links.status.warning': 'Security notice',
                'home.links.status.offline': 'Unavailable',
                'home.links.status.unknown': 'Unchecked',
                'home.apiRelay.title': '⚡ AI API Relay Setup',
                'home.apiRelay.subtitle': 'OpenAI and Anthropic work directly; Gemini models use the stable OpenAI-compatible route by default.',
                'home.apiRelay.publicBase': 'Public BASE URL',
                'home.apiRelay.apiKey': 'API key',
                'home.apiRelay.openAiModel': 'OpenAI / Gemini model',
                'home.apiRelay.defaultModel': 'Anthropic / Claude model',
                'home.apiRelay.fastModel': 'Claude fast model',
                'home.apiRelay.copyCurrent': '⧉ Copy Current Example',
                'home.apiRelay.copyAll': '⧉ Copy All Integration Details',
                'home.apiRelay.installClaude': '＋ Add to Claude Code',
                'home.apiRelay.openSite': 'Open Relay ↗',
                'home.apiRelay.save': 'Save Setup',
                'home.apiRelay.runtimeWeb': 'The web version can copy details; automatic setup is available only in the local EXE.',
                'home.apiRelay.runtimeDesktop': 'The local EXE can merge this setup into Claude Code after backing up the current settings.',
                'home.apiRelay.copied': 'Copied to clipboard',
                'home.apiRelay.copyFailed': 'Copy failed. Select and copy the content manually.',
                'home.apiRelay.saved': 'API relay setup saved',
                'home.apiRelay.saveFailed': 'Save failed: {message}',
                'home.apiRelay.installed': 'Added to Claude Code: {path}',
                'home.apiRelay.installFailed': 'Automatic setup failed: {message}',
                'home.apiRelay.saveBeforeInstall': 'Save the modified setup before installing it.',
                'home.custom.note': 'Import an HTML file or ZIP package to generate a home card and navigation entry, with out-of-the-box static snapshot and Pages publishing support.',
                'home.custom.upload': 'Import HTML / ZIP / SKILL',
                'home.market.button': 'Tool Market',
                'home.market.short': 'Market',
                'home.builtin.compareShort': 'Diff',
                'home.builtin.compare': 'Compare and restore bundled tools',
                'home.custom.uploadShort': 'Import',
                'home.market.title': 'Tool Market',
                'home.market.subtitle': 'Install or update HTML tools from enabled sources.',
                'home.market.details': 'View detailed update log',
                'home.import.title': 'Import Custom Tool',
                'home.import.subtitle': 'Enter all tool details and select an HTML or ZIP package in one place (with automatic offline snapshot and Pages publishing support).',
                'home.import.fileTitle': 'Choose an HTML / ZIP / SKILL file',
                'home.import.fileHint': 'HTML or ZIP tool package (up to 35 MB). A package with SKILL.md is imported as a Skill; a Python web app package with requirements.txt (FastAPI etc.) is hosted by the platform',
                'home.import.pyDetected': 'Recognized as a Python web app ({entry}, {iface}). The platform will create an isolated environment, install dependencies and add a menu entry',
                'home.import.pyOffline': ', using {count} bundled offline packages',
                'home.import.pyNoPython': 'Recognized as a Python web app, but {message}. You can still import it and reinstall dependencies from the app entry once Python is configured',
                'home.import.pyUpdate': 'An app named "{name}" {version} is already hosted. Update it? Updating keeps the app database and access settings; choose Cancel to import it as a new app.',
                'home.import.pyUpdateTitle': 'Update hosted Python app',
                'home.import.pyConfirm': 'The platform will run the Python code in this package on this machine. Only import packages from trusted sources. The app is reachable only after platform sign-in, reads platform data read-only and can write only its own database. Continue?',
                'home.import.pyConfirmTitle': 'Import Python app',
                'home.import.pySubmit': 'Import app',
                'home.import.pyUpdateSubmit': 'Update app',
                'home.import.pyImported': 'Imported. Dependencies are installing and the app will start in the background; open its entry to follow progress',
                'home.import.pyUpdated': 'App updated and restarting',
                'home.import.skillChecking': 'Checking the file type…',
                'home.import.skillDetected': 'Recognized as Skill package @{id}. After import it appears in All tools → Skills and can be used with @{id} in chat',
                'home.import.skillFiles': ', with {count} reference files',
                'home.import.skillSubmit': 'Import Skill',
                'home.import.skillTitle': 'Import Skill',
                'home.import.skillName': 'Chinese Skill name',
                'home.import.skillNameEn': 'English Skill name',
                'home.import.skillExists': 'Skill @{id} already exists. Replace it with this package?',
                'home.import.skillReserved': '@{id} belongs to a built-in Skill. Change the id in SKILL.md and import again',
                'home.import.skillImported': 'Imported Skill @{id}',
                'home.import.icon': 'Icon',
                'home.import.name': 'Chinese tool name',
                'home.import.nameEn': 'English tool name',
                'home.import.description': 'Chinese description',
                'home.import.descriptionEn': 'English description',
                'home.import.tags': 'Tags',
                'home.import.tagsPlaceholder': 'Comma-separated, up to 8 tags',
                'home.import.cancel': 'Cancel',
                'home.import.done': 'Done',
                'home.import.submit': 'Import Tool',
                'home.import.submitting': 'Importing…',
                'home.import.fileRequired': 'Choose an HTML or ZIP file first',
                'home.import.fileSelected': 'Selected: {name} · {size}',
                'home.import.aiAnalyzing': 'AI is analyzing the tool and generating its details…',
                'home.import.aiComplete': 'AI generated the Chinese and English names, descriptions, and tags. You can still edit them.',
                'home.import.aiUnavailable': 'AI is currently unavailable. Please enter the tool details below manually; you can still continue the import.',
                'home.import.zipHtmlMissing': 'No HTML entry file was found in the ZIP package',
                'home.arrow.tool': 'Open Tool →',
                'home.arrow.module': 'Open Module →',
                'home.stats.scripts': 'Script Repository Items',
                'home.stats.history': 'Operation History Items',
                'home.stats.tools': 'Online Tool Modules',
                'home.stats.title': '🚀 Platform Efficiency Overview',
                'home.stats.badge': 'Calculated dynamically from real business data',
                'home.stats.checks': 'Metric Checks Completed',
                'home.stats.service': 'Cumulative Services',
                'home.stats.manual': 'Manual-equivalent Hours',
                'home.stats.saved': 'Hours Saved',
                'home.stats.automation': 'Automation Scripts',
                'home.stats.efficiency': 'Approx. {rate}% efficiency gain',
                'home.stats.method': 'View estimation methodology',
                'home.stats.note.checks': 'Automated validation and scoring',
                'home.stats.note.service': 'Business actions + tool visits',
                'home.stats.note.manual': 'Conservative workload estimate',
                'home.stats.note.tools': 'Stable service through one hub',
                'home.stats.note.scripts': 'Reusable productivity assets',
                'home.stats.methodology': 'Estimates use 2 minutes per metric check, 90 minutes per manually built script, 30 minutes per data import, and 45 minutes per report; AI estimates use 8 minutes per Q&A request and 3 minutes per alert review. Saved time excludes platform operation and manual review time and is intended as a management estimate.',
                'home.ai.title': '✨ AI Applications',
                'home.ai.badge': 'Embedded into core workflows',
                'home.ai.scenarios': 'AI Use Cases',
                'home.ai.tasks': 'Intelligent Tasks',
                'home.ai.tokens': 'Tokens Processed',
                'home.ai.alerts': 'AI Alert Reviews',
                'home.ai.pages': 'Business Pages Covered',
                'home.ai.saved': 'Analysis Hours Saved',
                'home.ai.taskNote': 'Includes {questions} AI Q&A requests',
                'home.ai.note.scenarios': 'Assistant · Adaptation · Alerts · PPT',
                'home.ai.note.tokens': 'LLM semantic processing',
                'home.ai.note.alerts': 'Model + intelligent rule fallback',
                'home.ai.note.pages': 'Pages with real AI conversations',
                'home.ai.note.saved': 'Conservative manual-analysis estimate',
                'home.impact.automationScripts': 'automation scripts',
                'home.impact.hoursSaved': 'hours saved',
                'home.impact.dataImports': 'data imports',
                'home.impact.snapshotsStored': 'snapshots stored',
                'home.impact.metricChecks': 'metric checks',
                'home.impact.reportSnapshots': 'report snapshots',
                'home.impact.weaknessesFound': 'weaknesses identified',
                'home.impact.traceableSnapshots': 'traceable snapshots',
                'home.impact.monthsStored': 'months of data',
                'home.impact.historySnapshots': 'history snapshots',
                'home.impact.customerGroups': 'customer groups covered',
                'home.impact.metricResults': 'metric results',
                'home.impact.autoCalculations': 'automated calculations',
                'home.impact.requirementsManaged': 'requirements managed',
                'home.impact.workflowTransitions': 'workflow transitions',
                'home.impact.auditRules': 'audit rules',
                'home.impact.auditTemplates': 'audit templates',
                'home.impact.tablesProtected': 'data tables protected',
                'home.impact.databasesGoverned': 'databases governed',
                'home.impact.tablesVisible': 'data tables visible',
                'home.impact.coreDatabases': 'core databases',
                'home.impact.totalOpens': 'total opens',
                'home.impact.onlineTool': 'online tool',
                'home.history.title': 'Recent Operation History',
                'home.history.allTools': 'All Tools',
                'home.history.search': 'Search actions, details or tools',
                'home.history.count': '{n} records',
                'home.history.justNow': 'just now',
                'home.history.minutes': '{n}m ago',
                'home.history.hours': '{n}h ago',
                'home.history.yesterday': 'Yesterday {time}',
                'home.history.refresh': 'Refresh History',
                'home.history.loading': 'Loading recent operation history...',
                'home.history.refreshing': 'Refreshing operation history...',
                'home.history.empty': 'No operation records for the current filter.',
                'home.history.none': 'No records to show',
                'home.history.defaultPage': 'Showing the latest 10 by default',
                'home.history.page': 'Showing {from}-{to} of {total} · Page {page}/{pages}',
                'home.history.prev': 'Previous',
                'home.history.next': 'Next',
                'home.history.failed': 'Load failed: {message}',
                'home.history.sourceFailed': 'Load failed',
                'home.history.noDetail': 'No extra details',
                'home.tool.uiv': 'Data Capture',
                'home.tool.sla': 'Data Import',
                'home.tool.custom': 'Tool Management',
                'home.tool.builtin': 'Built-in Tools',
                'home.tool.unknown': 'Uncategorized',
                'home.prompt.name': 'Tool name:',
                'home.prompt.icon': 'Tool icon, optional:',
                'home.prompt.description': 'Tool description, optional:',
                'home.prompt.rename': 'Rename tool:',
                'home.toast.imported': 'Custom tool imported and entry created',
                'home.alert.importFailed': 'Failed to import custom tool: {message}',
                'home.confirm.delete': 'Delete this custom tool entry and HTML file?',
                'home.toast.deleted': 'Custom tool deleted',
                'home.toast.renamed': 'Tool name updated',
                'home.alert.deleteFailed': 'Delete failed: {message}',
                'home.alert.renameFailed': 'Rename failed: {message}',
                'home.dialog.renameTitle': 'Rename tool',
                'home.dialog.deleteTitle': 'Delete custom tool',
                'home.dialog.delete': 'Delete',
                'home.dialog.save': 'Save',
                'home.dialog.failed': 'Operation failed',
                'home.validation.nameRequired': 'Tool name cannot be empty',
                'home.validation.nameTooLong': 'Tool name cannot exceed 80 characters',
                'home.custom.defaultName': 'Custom Tool',
                'home.custom.defaultDesc': 'A standalone HTML tool imported into the platform and available from the unified entry points.',
                'home.custom.defaultTag1': 'Custom HTML',
                'home.custom.defaultTag2': 'Platform Entry',
                'home.custom.download': 'Download complete package',
                'home.custom.downloadApp': 'Download original app package',
                'home.custom.downloading': 'Downloading',
                'home.custom.downloadedApp': 'Downloaded the app package uploaded at import',
                'home.custom.downloadedAppRebuilt': 'Downloaded the app package (imported before originals were kept, so it was rebuilt from the current code)',
                'home.custom.downloadedHtml': 'Standalone HTML downloaded',
                'home.custom.downloadedZip': 'Complete ZIP package downloaded ({count} files)',
                'home.custom.downloadFailed': 'Failed to download tool package: {message}',
                'home.custom.rename': 'Rename tool',
                'home.custom.delete': 'Delete custom tool'
            }
        };

        const HOME_CARDS = {
            '/uivf12': {
                title: { 'zh-CN': '数据抓取', 'en-US': 'Data Capture' },
                desc: { 'zh-CN': '自动化脚本工程中心，智能调度仓库，一键生成生产级 UI.Vision 宏代码和 F12 控制台脚本。脚本分类管理，支持批量阵列执行。', 'en-US': 'Automation script engineering center with a smart repository, one-click production-ready UI.Vision macros, and F12 console scripts. Supports categorized scripts and batch array execution.' },
                tags: { 'zh-CN': ['🧠 智能 CPC/NID 嗅探', '🔄 翻页引擎', '🌍 NetCare 三大区阵列', '📦 服务端脚本仓库', '📅 运行时双月裂变'], 'en-US': ['🧠 Smart CPC/NID sniffing', '🔄 Pagination engine', '🌍 NetCare region arrays', '📦 Server script repository', '📅 Runtime month splitting'] },
                arrow: 'home.arrow.tool'
            },
            '/sla': {
                title: { 'zh-CN': '数据导入', 'en-US': 'Data Import' },
                desc: { 'zh-CN': '全局数据合控大中台，整改/常规/专项风险三表合一，SLA 预警呼吸灯，支持批量导入、自定义指标推送、分月目标对比。', 'en-US': 'Global data control center combining rectification, regular, and special-risk tables, with SLA warning indicators, batch import, custom metric pushes, and monthly target comparisons.' },
                tags: { 'zh-CN': ['⚡ SLA 倒计时预警', '🎯 分月指标目标', '📋 列去重提取', '💾 服务端偏好持久化', '📥 XLSX 批量导入'], 'en-US': ['⚡ SLA countdown alerts', '🎯 Monthly targets', '📋 Column dedup extraction', '💾 Server-side preferences', '📥 Batch XLSX import'] },
                arrow: 'home.arrow.tool'
            },
            '/report': {
                title: { 'zh-CN': '报表看板', 'en-US': 'Reports' },
                desc: { 'zh-CN': '基于历史快照生成多维度健康度排名与扣分概览矩阵，一目了然定位短板客户群，精准推动业务整改。', 'en-US': 'Generate multidimensional health rankings and deduction matrices from historical snapshots to identify weak customer groups and drive focused remediation.' },
                tags: { 'zh-CN': ['🏆 客户群健康度排名', '🧩 加减分统筹系统', '📆 多快照历史回溯', '📊 数据透视矩阵'], 'en-US': ['🏆 Customer-group health ranking', '🧩 Score adjustment system', '📆 Snapshot history', '📊 Pivot matrix'] },
                arrow: 'home.arrow.tool'
            },
            '/expedite': {
                title: { 'zh-CN': '一键催办', 'en-US': 'One-Click Expedite' },
                desc: { 'zh-CN': '自动根据短板透视矩阵生成高优先级跟进文本。支持自定义忽略关键词、多模板组装，并可一键关联全屏截图及原始报表，方便无缝推送到业务群。', 'en-US': 'Automatically generate high-priority follow-up text from the weakness matrix, with custom ignore keywords, template assembly, and one-click screenshots plus source report attachment.' },
                tags: { 'zh-CN': ['📋 一键文本复制', '📸 全屏高清截图', '📊 原生 Excel 导出', '⚙️ 自定义催办模板'], 'en-US': ['📋 One-click copy', '📸 Full-screen screenshots', '📊 Native Excel export', '⚙️ Custom expedite templates'] },
                arrow: 'home.arrow.tool'
            },
            '/monthly': {
                title: { 'zh-CN': '月报页面', 'en-US': 'Monthly Report' },
                desc: { 'zh-CN': '基于过往历史快照数据，深度挖掘指标长期演进趋势。支持动态多月比对、趋势折线分析，为月度工作复盘提供宏观上帝视角。', 'en-US': 'Explore long-term metric trends from historical snapshots with dynamic multi-month comparison and trend analysis for monthly reviews.' },
                tags: { 'zh-CN': ['📈 跨月趋势对比', '🔍 同比环比分析', '📥 月报快速归档'], 'en-US': ['📈 Cross-month trends', '🔍 YoY/MoM analysis', '📥 Fast monthly archiving'] },
                arrow: 'home.arrow.tool'
            },
            '/bigscreen': {
                title: { 'zh-CN': '大屏看板', 'en-US': 'Big Screen Dashboard' },
                desc: { 'zh-CN': '面向会议室和全屏展示的运营质量态势屏，汇总月报趋势、报表快照、客户群排名、短板指标和预警信号。', 'en-US': 'Full-screen operations display for meeting rooms, combining monthly trends, report snapshots, customer-group ranking, weak metrics, and warning signals.' },
                tags: { 'zh-CN': ['📡 实时态势总览', '🏆 客户群排行', '🚨 短板风险分布', '🧭 趋势驾驶舱'], 'en-US': ['📡 Live situation overview', '🏆 Group ranking', '🚨 Risk distribution', '🧭 Trend cockpit'] },
                arrow: 'home.arrow.tool'
            },
            '/frt': {
                title: { 'zh-CN': 'FRT KPI核算', 'en-US': 'FRT KPI Calculation' },
                desc: { 'zh-CN': 'FRT自动化核算平台 (动态规则引擎版)，支持导入报表智能提取SR类型，动态筛选、预警扣分项。', 'en-US': 'Automated FRT calculation platform with a dynamic rule engine, smart SR type extraction from imported reports, filtering, and deduction warnings.' },
                tags: { 'zh-CN': ['⚙️ 动态规则引擎', '📉 扣分项诊断', '📅 多月智能核算'], 'en-US': ['⚙️ Dynamic rule engine', '📉 Deduction diagnostics', '📅 Multi-month calculation'] },
                arrow: 'home.arrow.module'
            },
            '/requirements': {
                title: { 'zh-CN': '需求管理', 'en-US': 'Request Management' },
                desc: { 'zh-CN': '用于收集、管理和追踪整个平台的新需求。提供直观的流程流转视图，让用户和管理员透明地管理所有功能提议。', 'en-US': 'Collect, manage, and track platform feature requests with a clear workflow view for users and administrators.' },
                tags: { 'zh-CN': ['📝 全民需求提交', '🔄 流程流转追踪', '📊 进度可视化'], 'en-US': ['📝 Open request submission', '🔄 Workflow tracking', '📊 Progress visualization'] },
                arrow: 'home.arrow.module'
            },
            '/praudit': {
                title: { 'zh-CN': 'PR稽查', 'en-US': 'PR Audit' },
                desc: { 'zh-CN': '审计级批量自检系统，用于检查PR进展附件记录，支持导入Excel进行逐项校验，并可生成PDF审计报告。', 'en-US': 'Audit-grade batch self-check system for PR progress attachment records, with Excel import, item-by-item validation, and PDF audit reports.' },
                tags: { 'zh-CN': ['📥 批量数据导入', '✅ 审计级自检', '📄 导出双语PDF'], 'en-US': ['📥 Batch data import', '✅ Audit-grade self-check', '📄 Bilingual PDF export'] },
                arrow: 'home.arrow.module'
            },
            '/storage': {
                title: { 'zh-CN': '迁移状态', 'en-US': 'Migration Status' },
                desc: { 'zh-CN': '统一查看 JSON 到 SQLite 的迁移进度、真实读源、一致性校验结果和当前双写状态，方便后续安全切换到 SQLite 主读。', 'en-US': 'Track JSON-to-SQLite migration progress, active read source, parity checks, and dual-write status before safely switching SQLite to primary reads.' },
                tags: { 'zh-CN': ['🔍 Auto 读源', '✅ Parity 校验', '📊 JSON / SQLite 数量', '🧭 切库治理面板'], 'en-US': ['🔍 Auto read source', '✅ Parity checks', '📊 JSON / SQLite counts', '🧭 Cutover governance'] },
                arrow: 'home.arrow.module'
            },
            '/db-explorer': {
                title: { 'zh-CN': '数据探索', 'en-US': 'Data Explorer' },
                desc: { 'zh-CN': '全平台底层数据的上帝视角，直接查询 SQLite 物理表结构与内容，提供 SQL 般直观的浏览体验。', 'en-US': 'Inspect platform data from the ground up by browsing SQLite table structures and contents with an SQL-like experience.' },
                tags: { 'zh-CN': ['🗄️ SQLite 可视化', '🔍 关系型表查询', '⚡ 实时数据探针'], 'en-US': ['🗄️ SQLite visualization', '🔍 Relational table browsing', '⚡ Live data probe'] },
                arrow: 'home.arrow.module'
            },
            '/netcare-explorer': {
                title: { 'zh-CN': 'NetCare 数据探查', 'en-US': 'NetCare Explorer' },
                desc: { 'zh-CN': '浏览 NetCare 业务库的表结构与数据，使用只读 SQL 核对业务内容，并维护表名、模块与字段标注。', 'en-US': 'Browse NetCare business tables and data, verify records with read-only SQL, and maintain table names, modules, and field annotations.' },
                tags: { 'zh-CN': ['🗂️ 表结构与数据', '🔍 只读 SQL 查询', '📝 业务标注'], 'en-US': ['🗂️ Tables and data', '🔍 Read-only SQL', '📝 Business annotations'] },
                arrow: 'home.arrow.module'
            }
        };

        if (window.ToolsI18n) {
            window.ToolsI18n.register('home', HOME_I18N);
        }

        function t(key, params = {}) {
            return window.ToolsI18n ? window.ToolsI18n.t(key, params) : (HOME_I18N['zh-CN'][key] || key);
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function setText(selector, value) {
            const el = document.querySelector(selector);
            if (el) el.textContent = value;
        }

        function getFriendStatus(status) {
            return ['online', 'warning', 'offline'].includes(status) ? status : 'unknown';
        }

        function getFriendStatusLabel(status) {
            return t(`home.links.status.${getFriendStatus(status)}`);
        }

        function formatFriendProbeTime(value) {
            if (!value) return '';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '';
            return new Intl.DateTimeFormat(window.ToolsI18n?.getLanguage?.() || 'zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            }).format(date);
        }

        function updateFriendLinksMonitorMeta() {
            const meta = document.getElementById('friendLinksMonitorMeta');
            if (!meta) return;
            const lastProbeAt = friendLinksState.snapshot?.lastProbeAt;
            meta.textContent = lastProbeAt
                ? t('home.links.lastProbe', { time: formatFriendProbeTime(lastProbeAt) })
                : t('home.links.neverProbed');
        }

        const FRIEND_LINKS_COLLAPSED = 10;
        const FRIEND_LINKS_EXPANDED_KEY = 'home_friend_links_expanded';
        const FRIEND_LINK_HUES = [168, 199, 217, 258, 291, 330, 24, 45];

        // 未设置图标（或仍是默认 🔗）的链接显示名称首字头像，颜色按名称稳定分配
        function friendLinkBadge(link, name) {
            const icon = String(link.icon || '').trim();
            if (icon && icon !== '🔗') return `<span class="friend-link-icon">${escapeHtml(icon)}</span>`;
            const letter = Array.from(String(name || '?').replace(/^[^\p{L}\p{N}]+/u, ''))[0] || '?';
            const hash = Array.from(String(name || '')).reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)) >>> 0, 7);
            return `<span class="friend-link-icon is-letter" style="--fl-hue:${FRIEND_LINK_HUES[hash % FRIEND_LINK_HUES.length]}">${escapeHtml(letter.toUpperCase())}</span>`;
        }

        function isFriendLinksExpanded() {
            try { return localStorage.getItem(FRIEND_LINKS_EXPANDED_KEY) === '1'; } catch { return false; }
        }

        function renderFriendLinks(snapshot = friendLinksState.snapshot) {
            const list = document.querySelector('.friend-links-list');
            if (!list || !snapshot || !Array.isArray(snapshot.links)) return;
            const lang = window.ToolsI18n?.getLanguage?.() || 'zh-CN';
            const expanded = isFriendLinksExpanded();
            const total = snapshot.links.length;
            list.innerHTML = snapshot.links.map((link, index) => {
                const statusInfo = snapshot.statuses?.[link.id] || {};
                const status = getFriendStatus(statusInfo.status);
                const name = lang === 'en-US' && link.nameEn ? link.nameEn : link.name;
                const detail = [getFriendStatusLabel(status), statusInfo.message, statusInfo.checkedAt ? formatFriendProbeTime(statusInfo.checkedAt) : ''].filter(Boolean).join(' · ');
                const hidden = !expanded && index >= FRIEND_LINKS_COLLAPSED ? ' hidden' : '';
                return `<a class="friend-link status-${status}" data-friend-link-id="${escapeHtml(link.id)}" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${name} · ${detail}`)}"${hidden}>${friendLinkBadge(link, name)}<span class="friend-link-name">${escapeHtml(name)}</span><span class="friend-link-dot" aria-label="${escapeHtml(getFriendStatusLabel(status))}"></span></a>`;
            }).join('');

            const count = document.getElementById('friendLinksCount');
            if (count) {
                count.hidden = total === 0;
                count.textContent = String(total);
            }
            let toggle = document.getElementById('friendLinksToggle');
            if (total <= FRIEND_LINKS_COLLAPSED) {
                toggle?.remove();
                return;
            }
            if (!toggle) {
                toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.id = 'friendLinksToggle';
                toggle.className = 'friend-links-toggle';
                toggle.addEventListener('click', () => {
                    try { localStorage.setItem(FRIEND_LINKS_EXPANDED_KEY, isFriendLinksExpanded() ? '0' : '1'); } catch { /* 无痕模式下仅本次生效 */ }
                    renderFriendLinks();
                });
                list.after(toggle);
            }
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.textContent = expanded ? t('home.links.showLess') : t('home.links.showAll', { n: total });
        }

        function scheduleFriendLinksRefresh(snapshot) {
            clearTimeout(friendLinksState.refreshTimer);
            const nextTime = snapshot?.nextProbeAt ? new Date(snapshot.nextProbeAt).getTime() : 0;
            const untilNext = nextTime > Date.now() ? nextTime - Date.now() + 3000 : 30 * 60 * 1000;
            const jitter = Math.floor(Math.random() * 15000);
            const delay = Math.min(30 * 60 * 1000, Math.max(60000, untilNext)) + jitter;
            friendLinksState.refreshTimer = setTimeout(() => loadFriendLinks(true), delay);
        }

        function applyFriendLinksSnapshot(snapshot) {
            if (!snapshot || !Array.isArray(snapshot.links)) return;
            friendLinksState.snapshot = snapshot;
            renderFriendLinks(snapshot);
            updateFriendLinksMonitorMeta();
            scheduleFriendLinksRefresh(snapshot);
        }

        async function loadFriendLinks(silent = false) {
            try {
                const snapshot = await API.get('/api/friend-links');
                applyFriendLinksSnapshot(snapshot);
                return snapshot;
            } catch (error) {
                if (!silent) console.warn('[friend-links] load failed:', error.message);
                return null;
            }
        }

        function setFriendLinksEditorMessage(message = '', type = 'error') {
            const box = document.getElementById('friendLinksEditorMessage');
            if (!box) return;
            box.textContent = message;
            box.className = `friend-links-editor-message${message ? ` visible ${type}` : ''}`;
        }

        function renderFriendLinkEditorRows() {
            const list = document.getElementById('friendLinkEditorList');
            if (!list) return;
            const statuses = friendLinksState.snapshot?.statuses || {};
            list.innerHTML = friendLinksState.editorLinks.map((link, index) => {
                const info = statuses[link.id] || {};
                const status = getFriendStatus(info.status);
                const time = formatFriendProbeTime(info.checkedAt);
                const statusDetail = [getFriendStatusLabel(status), info.message, time].filter(Boolean).join(' · ');
                return `
                    <div class="friend-link-editor-row" data-friend-editor-index="${index}">
                        <div class="friend-link-editor-fields">
                            <input class="friend-link-editor-input friend-icon" maxlength="8" value="${escapeHtml(link.icon || '🔗')}" placeholder="${escapeHtml(t('home.links.icon'))}" aria-label="${escapeHtml(t('home.links.icon'))}">
                            <input class="friend-link-editor-input friend-name" maxlength="40" value="${escapeHtml(link.name || '')}" placeholder="${escapeHtml(t('home.links.name'))}" aria-label="${escapeHtml(t('home.links.name'))}">
                            <input class="friend-link-editor-input friend-name-en" maxlength="60" value="${escapeHtml(link.nameEn || '')}" placeholder="${escapeHtml(t('home.links.nameEn'))}" aria-label="${escapeHtml(t('home.links.nameEn'))}">
                        </div>
                        <div class="friend-link-editor-bottom">
                            <input class="friend-link-editor-input friend-url" maxlength="2048" value="${escapeHtml(link.url || '')}" placeholder="${escapeHtml(t('home.links.url'))}" aria-label="URL">
                            <div class="friend-link-editor-state ${status}" title="${escapeHtml(statusDetail)}"><strong>${escapeHtml(getFriendStatusLabel(status))}</strong>${time ? ` · ${escapeHtml(time)}` : ''}</div>
                            <div class="friend-link-editor-actions">
                                <button type="button" class="friend-row-btn" data-friend-action="up" title="${escapeHtml(t('home.links.up'))}" ${index === 0 ? 'disabled' : ''}>↑</button>
                                <button type="button" class="friend-row-btn" data-friend-action="down" title="${escapeHtml(t('home.links.down'))}" ${index === friendLinksState.editorLinks.length - 1 ? 'disabled' : ''}>↓</button>
                                <button type="button" class="friend-row-btn" data-friend-action="probe" title="${escapeHtml(t('home.links.probeOne'))}">⌁</button>
                                <button type="button" class="friend-row-btn delete" data-friend-action="delete" title="${escapeHtml(t('home.links.delete'))}">×</button>
                            </div>
                        </div>
                    </div>`;
            }).join('');

            list.querySelectorAll('.friend-link-editor-input').forEach(input => {
                input.addEventListener('input', () => { friendLinksState.editorDirty = true; });
            });
            list.querySelectorAll('[data-friend-action]').forEach(button => {
                button.addEventListener('click', async () => {
                    const row = button.closest('[data-friend-editor-index]');
                    const index = Number(row?.dataset.friendEditorIndex);
                    if (!Number.isInteger(index)) return;
                    const action = button.dataset.friendAction;
                    friendLinksState.editorLinks = collectFriendLinkEditorValues();
                    if (action === 'delete') {
                        friendLinksState.editorLinks.splice(index, 1);
                        friendLinksState.editorDirty = true;
                        renderFriendLinkEditorRows();
                    } else if (action === 'up' || action === 'down') {
                        const target = index + (action === 'up' ? -1 : 1);
                        if (target < 0 || target >= friendLinksState.editorLinks.length) return;
                        [friendLinksState.editorLinks[index], friendLinksState.editorLinks[target]] = [friendLinksState.editorLinks[target], friendLinksState.editorLinks[index]];
                        friendLinksState.editorDirty = true;
                        renderFriendLinkEditorRows();
                    } else if (action === 'probe') {
                        await probeSingleFriendLink(friendLinksState.editorLinks[index].id, button);
                    }
                });
            });
        }

        function collectFriendLinkEditorValues() {
            return Array.from(document.querySelectorAll('#friendLinkEditorList [data-friend-editor-index]')).map((row, index) => ({
                id: friendLinksState.editorLinks[index]?.id || `link_${Date.now().toString(36)}_${index}`,
                icon: row.querySelector('.friend-icon')?.value.trim() || '🔗',
                name: row.querySelector('.friend-name')?.value.trim() || '',
                nameEn: row.querySelector('.friend-name-en')?.value.trim() || '',
                url: row.querySelector('.friend-url')?.value.trim() || ''
            }));
        }

        function closeFriendLinksEditor() {
            document.getElementById('friendLinksModal')?.classList.remove('open');
            document.body.style.overflow = '';
            setFriendLinksEditorMessage('');
        }

        async function openFriendLinksEditor() {
            if (localStorage.getItem('tools_role') !== 'admin') {
                showToast(t('home.links.adminOnly'));
                return;
            }
            if (!friendLinksState.snapshot) await loadFriendLinks();
            if (!friendLinksState.snapshot) return;
            friendLinksState.editorLinks = friendLinksState.snapshot.links.map(link => ({ ...link }));
            friendLinksState.editorDirty = false;
            const interval = document.getElementById('friendLinksInterval');
            if (interval) interval.value = friendLinksState.snapshot.probeIntervalMinutes || 30;
            renderFriendLinkEditorRows();
            updateFriendLinksMonitorMeta();
            setFriendLinksEditorMessage('');
            document.getElementById('friendLinksModal')?.classList.add('open');
            document.body.style.overflow = 'hidden';
        }

        async function saveFriendLinks() {
            const saveBtn = document.getElementById('friendLinksSaveBtn');
            try {
                saveBtn.disabled = true;
                saveBtn.textContent = t('home.links.saving');
                const links = collectFriendLinkEditorValues();
                const probeIntervalMinutes = Number(document.getElementById('friendLinksInterval')?.value || 30);
                const snapshot = await API.put('/api/friend-links', { links, probeIntervalMinutes });
                friendLinksState.editorDirty = false;
                applyFriendLinksSnapshot(snapshot);
                closeFriendLinksEditor();
                showToast(t('home.links.saved'));
            } catch (error) {
                setFriendLinksEditorMessage(t('home.links.saveFailed', { message: error.message }));
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = t('home.links.save');
            }
        }

        async function probeAllFriendLinks() {
            if (friendLinksState.editorDirty) {
                setFriendLinksEditorMessage(t('home.links.unsavedProbe'));
                return;
            }
            const button = document.getElementById('friendLinksProbeAllBtn');
            try {
                friendLinksState.probing = true;
                button.disabled = true;
                button.textContent = t('home.links.probing');
                document.querySelectorAll('[data-friend-action="probe"]').forEach(item => { item.disabled = true; });
                setFriendLinksEditorMessage(t('home.links.probing'), 'info');
                const snapshot = await API.post('/api/friend-links/probe', {});
                applyFriendLinksSnapshot(snapshot);
                renderFriendLinkEditorRows();
                setFriendLinksEditorMessage('');
            } catch (error) {
                setFriendLinksEditorMessage(t('home.links.probeFailed', { message: error.message }));
            } finally {
                friendLinksState.probing = false;
                button.disabled = false;
                button.textContent = t('home.links.probeAll');
                document.querySelectorAll('[data-friend-action="probe"]').forEach(item => { item.disabled = false; });
            }
        }

        async function probeSingleFriendLink(linkId, button) {
            if (friendLinksState.editorDirty) {
                setFriendLinksEditorMessage(t('home.links.unsavedProbe'));
                return;
            }
            try {
                button.disabled = true;
                const payload = await API.post(`/api/friend-links/${encodeURIComponent(linkId)}/probe`, {});
                friendLinksState.snapshot.statuses = { ...(friendLinksState.snapshot.statuses || {}), [linkId]: payload.result };
                renderFriendLinks();
                renderFriendLinkEditorRows();
                setFriendLinksEditorMessage('');
            } catch (error) {
                setFriendLinksEditorMessage(t('home.links.probeFailed', { message: error.message }));
            } finally {
                button.disabled = false;
            }
        }

        function setupFriendLinks() {
            const manageBtn = document.getElementById('friendLinksManageBtn');
            const modal = document.getElementById('friendLinksModal');
            const isAdmin = localStorage.getItem('tools_role') === 'admin';
            manageBtn?.classList.toggle('can-manage', isAdmin);
            manageBtn?.setAttribute('title', t(isAdmin ? 'home.links.manageHint' : 'home.links.adminOnly'));
            manageBtn?.addEventListener('click', openFriendLinksEditor);
            document.getElementById('friendLinksCloseBtn')?.addEventListener('click', closeFriendLinksEditor);
            document.getElementById('friendLinksCancelBtn')?.addEventListener('click', closeFriendLinksEditor);
            document.getElementById('friendLinksSaveBtn')?.addEventListener('click', saveFriendLinks);
            document.getElementById('friendLinksProbeAllBtn')?.addEventListener('click', probeAllFriendLinks);
            document.getElementById('friendLinksAddBtn')?.addEventListener('click', () => {
                friendLinksState.editorLinks = collectFriendLinkEditorValues();
                friendLinksState.editorLinks.push({ id: `link_${Date.now().toString(36)}`, icon: '🔗', name: '', nameEn: '', url: 'https://' });
                friendLinksState.editorDirty = true;
                renderFriendLinkEditorRows();
                document.getElementById('friendLinkEditorList')?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
            document.getElementById('friendLinksInterval')?.addEventListener('input', () => { friendLinksState.editorDirty = true; });
            modal?.addEventListener('click', event => { if (event.target === modal) closeFriendLinksEditor(); });
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape' && modal?.classList.contains('open')) closeFriendLinksEditor();
            });
            (window.HomeMode?.whenTools || (task => task()))(() => {
                if (!friendLinksState.snapshot) loadFriendLinks();
            });
        }

        function getApiRelayValues() {
            const fallback = friendLinksState.snapshot?.apiRelay || {};
            return {
                baseUrl: String(document.getElementById('apiRelayBaseUrl')?.value || fallback.baseUrl || 'https://api.fanxiaolong.uk').trim().replace(/\/+$/, ''),
                apiKey: String(document.getElementById('apiRelayApiKey')?.value || fallback.apiKey || 'xxxx').trim(),
                openAiModel: String(document.getElementById('apiRelayOpenAiModel')?.value || fallback.openAiModel || 'gemini-3-flash').trim(),
                defaultModel: String(document.getElementById('apiRelayDefaultModel')?.value || fallback.defaultModel || 'claude-3-5-sonnet-20241022').trim(),
                fastModel: String(document.getElementById('apiRelayFastModel')?.value || fallback.fastModel || 'gemini-2.5-flash').trim()
            };
        }

        function buildApiRelayExamples(config = getApiRelayValues()) {
            const base = config.baseUrl.replace(/\/+$/, '');
            const openAiBase = `${base}/v1`;
            return {
                openai: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${openAiBase}",\n    api_key="${config.apiKey}"\n)\n\nresponse = client.chat.completions.create(\n    model="${config.openAiModel}",\n    messages=[{"role": "user", "content": "Hello!"}]\n)\n\nprint(response.choices[0].message.content)`,
                anthropic: `from anthropic import Anthropic\n\nclient = Anthropic(\n    base_url="${base}",\n    api_key="${config.apiKey}"\n)\n\nresponse = client.messages.create(\n    model="${config.defaultModel}",\n    max_tokens=1024,\n    messages=[{"role": "user", "content": "Hello!"}]\n)\n\nprint(response.content[0].text)`,
                gemini: `# Gemini 原生 /v1beta 当前配额受限，改用已验证的 OpenAI 兼容 REST\ncurl -X POST \\\n  "${openAiBase}/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${config.apiKey}" \\\n  -d '{\n    "model": "${config.openAiModel}",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`,
                claude: `// ~/.claude/settings.json\n${JSON.stringify({
                    env: {
                        ANTHROPIC_BASE_URL: base,
                        ANTHROPIC_AUTH_TOKEN: config.apiKey,
                        ANTHROPIC_MODEL: config.defaultModel,
                        ANTHROPIC_SMALL_FAST_MODEL: config.fastModel
                    }
                }, null, 2)}`
            };
        }

        function renderApiRelayExample() {
            const examples = buildApiRelayExamples();
            const tab = examples[friendLinksState.apiRelayTab] ? friendLinksState.apiRelayTab : 'openai';
            const protocol = tab === 'claude' ? 'anthropic' : tab;
            const code = document.getElementById('apiRelayCode');
            if (code) code.textContent = examples[tab];
            document.querySelectorAll('[data-api-tab]').forEach(button => button.classList.toggle('active', button.dataset.apiTab === tab));
            document.querySelectorAll('[data-api-protocol]').forEach(card => {
                const selected = card.dataset.apiProtocol === protocol;
                card.classList.toggle('selected', selected);
                card.querySelector('.api-protocol-select')?.setAttribute('aria-pressed', String(selected));
            });
        }

        function selectApiRelayProtocol(protocol) {
            if (!['openai', 'anthropic', 'gemini'].includes(protocol)) return;
            friendLinksState.apiRelayTab = protocol;
            renderApiRelayExample();
        }

        function buildAllApiRelayInfo(config = getApiRelayValues()) {
            const base = config.baseUrl.replace(/\/+$/, '');
            const examples = buildApiRelayExamples(config);
            return [
                'Tools Platform · AI API 中转对接信息',
                '',
                `公网地址: ${base}`,
                `API 密钥: ${config.apiKey}`,
                `OpenAI / Gemini 模型: ${config.openAiModel}`,
                `Anthropic / Claude 主模型: ${config.defaultModel}`,
                `快速模型: ${config.fastModel}`,
                '',
                `OpenAI BASE: ${base}/v1`,
                `OpenAI: ${base}/v1/chat/completions`,
                `OpenAI Responses: ${base}/v1/responses`,
                `Anthropic BASE: ${base}`,
                `Anthropic Messages: ${base}/v1/messages`,
                `Gemini 模型（OpenAI 兼容 REST）: ${base}/v1/chat/completions`,
                `Gemini 原生通道: ${base}/v1beta（当前配额受限）`,
                '',
                '--- Python / OpenAI ---', examples.openai,
                '',
                '--- Python / Anthropic ---', examples.anthropic,
                '',
                '--- Gemini / OpenAI-compatible REST ---', examples.gemini,
                '',
                '--- Claude Code settings.json ---', examples.claude
            ].join('\n');
        }

        async function copyApiRelayText(value) {
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(String(value));
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = String(value);
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    textarea.remove();
                }
                showToast(t('home.apiRelay.copied'));
                return true;
            } catch (_) {
                setApiRelayMessage(t('home.apiRelay.copyFailed'));
                return false;
            }
        }

        function setApiRelayMessage(message = '', type = 'error') {
            const box = document.getElementById('apiRelayMessage');
            if (!box) return;
            box.textContent = message;
            box.className = `friend-links-editor-message${message ? ` visible ${type}` : ''}`;
        }

        function updateApiRelayRuntimeState() {
            const available = friendLinksState.snapshot?.desktopAutoInstallAvailable === true;
            const installBtn = document.getElementById('apiRelayInstallClaudeBtn');
            if (installBtn) {
                installBtn.disabled = !available;
                installBtn.title = t(available ? 'home.apiRelay.runtimeDesktop' : 'home.apiRelay.runtimeWeb');
            }
            setText('#apiRelayRuntimeNote', t(available ? 'home.apiRelay.runtimeDesktop' : 'home.apiRelay.runtimeWeb'));
        }

        async function openApiRelayModal() {
            if (!friendLinksState.snapshot) await loadFriendLinks();
            const config = friendLinksState.snapshot?.apiRelay || {
                baseUrl: 'https://api.fanxiaolong.uk', apiKey: 'xxxx', openAiModel: 'gemini-3-flash', defaultModel: 'claude-3-5-sonnet-20241022', fastModel: 'gemini-2.5-flash'
            };
            const isAdmin = localStorage.getItem('tools_role') === 'admin';
            const fields = {
                apiRelayBaseUrl: config.baseUrl,
                apiRelayApiKey: config.apiKey,
                apiRelayOpenAiModel: config.openAiModel,
                apiRelayDefaultModel: config.defaultModel,
                apiRelayFastModel: config.fastModel
            };
            Object.entries(fields).forEach(([id, value]) => {
                const input = document.getElementById(id);
                if (!input) return;
                input.value = value || '';
                input.readOnly = !isAdmin;
            });
            const keyInput = document.getElementById('apiRelayApiKey');
            if (keyInput) keyInput.type = 'password';
            const saveBtn = document.getElementById('apiRelaySaveBtn');
            if (saveBtn) saveBtn.style.display = isAdmin ? '' : 'none';
            const siteBtn = document.getElementById('apiRelayOpenSiteBtn');
            if (siteBtn) siteBtn.href = config.baseUrl || 'https://api.fanxiaolong.uk/';
            friendLinksState.apiRelayDirty = false;
            renderApiRelayExample();
            updateApiRelayRuntimeState();
            setApiRelayMessage('');
            document.getElementById('apiRelayModal')?.classList.add('open');
            document.body.style.overflow = 'hidden';
        }

        function closeApiRelayModal() {
            document.getElementById('apiRelayModal')?.classList.remove('open');
            document.body.style.overflow = '';
            setApiRelayMessage('');
        }

        async function saveApiRelayConfig() {
            const button = document.getElementById('apiRelaySaveBtn');
            try {
                button.disabled = true;
                const snapshot = await API.put('/api/friend-links/api-relay', getApiRelayValues());
                applyFriendLinksSnapshot(snapshot);
                friendLinksState.apiRelayDirty = false;
                setApiRelayMessage(t('home.apiRelay.saved'), 'info');
                showToast(t('home.apiRelay.saved'));
            } catch (error) {
                setApiRelayMessage(t('home.apiRelay.saveFailed', { message: error.message }));
            } finally {
                button.disabled = false;
            }
        }

        async function installApiRelayToClaudeCode() {
            if (friendLinksState.apiRelayDirty) {
                setApiRelayMessage(t('home.apiRelay.saveBeforeInstall'));
                return;
            }
            const button = document.getElementById('apiRelayInstallClaudeBtn');
            try {
                button.disabled = true;
                const result = await API.post('/api/friend-links/api-relay/install-claude-code', {});
                setApiRelayMessage(t('home.apiRelay.installed', { path: result.settingsPath }), 'info');
            } catch (error) {
                setApiRelayMessage(t('home.apiRelay.installFailed', { message: error.message }));
            } finally {
                button.disabled = friendLinksState.snapshot?.desktopAutoInstallAvailable !== true;
            }
        }

        function setupApiRelay() {
            const list = document.querySelector('.friend-links-list');
            const modal = document.getElementById('apiRelayModal');
            list?.addEventListener('click', event => {
                const apiLink = event.target.closest('[data-friend-link-id="api"]');
                if (!apiLink) return;
                event.preventDefault();
                openApiRelayModal();
            });
            document.getElementById('apiRelayCloseBtn')?.addEventListener('click', closeApiRelayModal);
            modal?.addEventListener('click', event => { if (event.target === modal) closeApiRelayModal(); });
            document.querySelectorAll('[data-api-tab]').forEach(button => button.addEventListener('click', () => {
                friendLinksState.apiRelayTab = button.dataset.apiTab;
                renderApiRelayExample();
            }));
            document.querySelectorAll('[data-api-protocol]').forEach(card => card.addEventListener('click', event => {
                if (event.target.closest('[data-api-copy-protocol]')) return;
                selectApiRelayProtocol(card.dataset.apiProtocol);
            }));
            ['apiRelayBaseUrl', 'apiRelayApiKey', 'apiRelayOpenAiModel', 'apiRelayDefaultModel', 'apiRelayFastModel'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', () => {
                    friendLinksState.apiRelayDirty = true;
                    renderApiRelayExample();
                });
            });
            document.getElementById('apiRelayToggleKeyBtn')?.addEventListener('click', () => {
                const input = document.getElementById('apiRelayApiKey');
                if (input) input.type = input.type === 'password' ? 'text' : 'password';
            });
            document.getElementById('apiRelayCopyBaseBtn')?.addEventListener('click', () => copyApiRelayText(getApiRelayValues().baseUrl));
            document.getElementById('apiRelayCopyKeyBtn')?.addEventListener('click', () => copyApiRelayText(getApiRelayValues().apiKey));
            document.getElementById('apiRelayCopyCodeBtn')?.addEventListener('click', () => copyApiRelayText(buildApiRelayExamples()[friendLinksState.apiRelayTab]));
            document.getElementById('apiRelayCopyAllBtn')?.addEventListener('click', () => copyApiRelayText(buildAllApiRelayInfo()));
            document.querySelectorAll('[data-api-copy-protocol]').forEach(button => button.addEventListener('click', () => {
                const config = getApiRelayValues();
                const bases = { openai: `${config.baseUrl}/v1`, anthropic: config.baseUrl, gemini: `${config.baseUrl}/v1` };
                copyApiRelayText(bases[button.dataset.apiCopyProtocol]);
            }));
            document.getElementById('apiRelaySaveBtn')?.addEventListener('click', saveApiRelayConfig);
            document.getElementById('apiRelayInstallClaudeBtn')?.addEventListener('click', installApiRelayToClaudeCode);
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape' && modal?.classList.contains('open')) closeApiRelayModal();
            });
        }

        function applyHomeI18n() {
            const lang = window.ToolsI18n?.getLanguage?.() || 'zh-CN';
            if (!window.ToolsPlatformTitle?.apply(null, lang)) document.title = t('home.title');
            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc) metaDesc.setAttribute('content', t('home.description'));
            const heroDesc = document.querySelector('.hero p');
            if (heroDesc) heroDesc.innerHTML = t('home.hero.desc');
            document.querySelectorAll('[data-home-i18n]').forEach(el => {
                el.textContent = t(el.dataset.homeI18n);
            });
            const friendLinks = document.querySelector('.friend-links');
            if (friendLinks) friendLinks.setAttribute('aria-label', t('home.links.title').replace(/^🔗\s*/, ''));
            const manageBtn = document.getElementById('friendLinksManageBtn');
            if (manageBtn) manageBtn.title = t(localStorage.getItem('tools_role') === 'admin' ? 'home.links.manageHint' : 'home.links.adminOnly');
            renderFriendLinks();
            updateFriendLinksMonitorMeta();
            if (document.getElementById('friendLinksModal')?.classList.contains('open')) renderFriendLinkEditorRows();
            setText('#apiRelayModalTitle', t('home.apiRelay.title'));
            setText('#apiRelayModalTitle + .friend-links-dialog-subtitle', t('home.apiRelay.subtitle'));
            setText('label[for="apiRelayBaseUrl"]', t('home.apiRelay.publicBase'));
            setText('label[for="apiRelayApiKey"]', t('home.apiRelay.apiKey'));
            setText('label[for="apiRelayOpenAiModel"]', t('home.apiRelay.openAiModel'));
            setText('label[for="apiRelayDefaultModel"]', t('home.apiRelay.defaultModel'));
            setText('label[for="apiRelayFastModel"]', t('home.apiRelay.fastModel'));
            setText('#apiRelayCopyCodeBtn', t('home.apiRelay.copyCurrent'));
            setText('#apiRelayCopyAllBtn', t('home.apiRelay.copyAll'));
            setText('#apiRelayInstallClaudeBtn', t('home.apiRelay.installClaude'));
            setText('#apiRelayOpenSiteBtn', t('home.apiRelay.openSite'));
            setText('#apiRelaySaveBtn', t('home.apiRelay.save'));
            renderApiRelayExample();
            updateApiRelayRuntimeState();
            [['customToolUploadBtn', 'home.custom.upload'], ['toolMarketBtn', 'home.market.button'], ['builtinToolsCompareBtn', 'home.builtin.compare']].forEach(([id, key]) => {
                const button = document.getElementById(id);
                if (!button) return;
                button.title = t(key);
                button.setAttribute('aria-label', t(key));
            });
            setText('#toolMarketTitle', t('home.market.title'));
            setText('#toolMarketSubtitle', t('home.market.subtitle'));
            setText('#customToolImportTitle', t('home.import.title'));
            setText('#customToolImportSubtitle', t('home.import.subtitle'));
            setText('#customToolFileTitle', t('home.import.fileTitle'));
            setText('#customToolFileHint', t('home.import.fileHint'));
            setText('#customToolIconLabel', t('home.import.icon'));
            const importNameLabel = document.getElementById('customToolNameLabel');
            if (importNameLabel) importNameLabel.innerHTML = `${escapeHtml(t('home.import.name'))} <span>*</span>`;
            setText('#customToolNameEnLabel', t('home.import.nameEn'));
            setText('#customToolDescriptionLabel', t('home.import.description'));
            setText('#customToolDescriptionEnLabel', t('home.import.descriptionEn'));
            setText('#customToolTagsLabel', t('home.import.tags'));
            setText('#customToolImportCancel', t('home.import.cancel'));
            const importSubmit = document.getElementById('customToolImportSubmit');
            if (importSubmit && !importSubmit.disabled) importSubmit.textContent = t(importSubmit.dataset.completed === 'true' ? 'home.import.done' : 'home.import.submit');
            const importTags = document.getElementById('customToolTags');
            if (importTags) importTags.placeholder = t('home.import.tagsPlaceholder');
            document.querySelectorAll('#toolsGrid > a.tool-card:not([data-custom-tool-card="1"])').forEach(card => {
                const data = HOME_CARDS[card.getAttribute('href')];
                if (!data) return;
                setTextForCard(card, data, lang);
            });
            setText('.stats-title', t('home.stats.title'));
            setText('.stats-subtitle', t('home.stats.badge'));
            const statLabels = document.querySelectorAll('.stat-label');
            const statLabelKeys = ['home.stats.checks', 'home.stats.service', 'home.stats.manual', 'home.stats.saved', 'home.stats.tools', 'home.stats.automation'];
            statLabels.forEach((label, index) => { if (statLabelKeys[index]) label.textContent = t(statLabelKeys[index]); });
            const statNoteKeys = ['home.stats.note.checks', 'home.stats.note.service', 'home.stats.note.manual', null, 'home.stats.note.tools', 'home.stats.note.scripts'];
            document.querySelectorAll('.stat-note').forEach((note, index) => { if (statNoteKeys[index]) note.textContent = t(statNoteKeys[index]); });
            setText('.methodology summary', t('home.stats.method'));
            setText('#methodologyText', t('home.stats.methodology'));
            setText('.ai-impact-title', t('home.ai.title'));
            setText('.ai-impact-badge', t('home.ai.badge'));
            const aiLabelKeys = ['home.ai.scenarios', 'home.ai.tasks', 'home.ai.tokens', 'home.ai.alerts', 'home.ai.pages', 'home.ai.saved'];
            document.querySelectorAll('.ai-metric-label').forEach((label, index) => { if (aiLabelKeys[index]) label.textContent = t(aiLabelKeys[index]); });
            const aiNoteKeys = ['home.ai.note.scenarios', null, 'home.ai.note.tokens', 'home.ai.note.alerts', 'home.ai.note.pages', 'home.ai.note.saved'];
            document.querySelectorAll('.ai-metric-note').forEach((note, index) => { if (aiNoteKeys[index]) note.textContent = t(aiNoteKeys[index]); });
            if (platformSummary) renderPlatformStats(platformSummary);
            setText('.history-title', t('home.history.title'));
            const countEl = document.getElementById('history-source');
            if (countEl && historyState.items.length) countEl.textContent = t('home.history.count', { n: historyState.items.length });
            setText('#history-refresh', t('home.history.refresh'));
            setText('#history-prev', t('home.history.prev'));
            setText('#history-next', t('home.history.next'));
            renderHistoryFilterOptions();
            const historySearch = document.getElementById('history-search');
            if (historySearch) historySearch.placeholder = t('home.history.search');
            if (!historyState.items.length) setText('#history-page-info', t('home.history.defaultPage'));
        }

        function setTextForCard(card, data, lang) {
            const title = card.querySelector('.card-title');
            const desc = card.querySelector('.card-desc');
            const tags = card.querySelector('.card-features');
            const arrow = card.querySelector('.card-arrow');
            if (title) title.textContent = data.title[lang] || data.title['zh-CN'];
            if (desc) desc.textContent = data.desc[lang] || data.desc['zh-CN'];
            if (tags) {
                tags.innerHTML = (data.tags[lang] || data.tags['zh-CN'])
                    .map(tag => `<span class="feature-tag">${escapeHtml(tag)}</span>`)
                    .join('');
            }
            if (arrow) arrow.textContent = t(data.arrow);
        }

        function formatToolLabel(tool) {
            if (tool === 'uiv') return t('home.tool.uiv');
            if (tool === 'sla') return t('home.tool.sla');
            if (tool === 'custom') return t('home.tool.custom');
            if (tool === 'builtin') return t('home.tool.builtin');
            return tool || t('home.tool.unknown');
        }

        function renderHistoryList(history) {
            const listEl = document.getElementById('history-list');
            const infoEl = document.getElementById('history-page-info');
            const prevBtn = document.getElementById('history-prev');
            const nextBtn = document.getElementById('history-next');
            if (!listEl) return;

            if (!Array.isArray(history) || history.length === 0) {
                listEl.innerHTML = `<div class="history-empty">${escapeHtml(t('home.history.empty'))}</div>`;
                if (infoEl) infoEl.textContent = t('home.history.none');
                if (prevBtn) prevBtn.disabled = true;
                if (nextBtn) nextBtn.disabled = true;
                return;
            }

            const totalPages = Math.max(1, Math.ceil(history.length / historyState.pageSize));
            if (historyState.page > totalPages) historyState.page = totalPages;
            const start = (historyState.page - 1) * historyState.pageSize;
            const pagedItems = history.slice(start, start + historyState.pageSize);

            listEl.innerHTML = pagedItems.map(item => {
                const fullTime = item.time
                    ? new Date(item.time).toLocaleString(window.ToolsI18n?.getLanguage?.() || 'zh-CN', { hour12: false })
                    : '-';
                const detail = item.detail || t('home.history.noDetail');
                return `
                    <div class="history-row">
                        <div><span class="history-tool">${escapeHtml(formatToolLabel(item.tool))}</span></div>
                        <div class="history-action" title="${escapeHtml(item.action || '')}">${escapeHtml(item.action || '-')}</div>
                        <div class="history-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</div>
                        <div class="history-time" title="${escapeHtml(fullTime)}">${escapeHtml(formatHistoryTime(item.time))}</div>
                    </div>
                `;
            }).join('');

            const from = history.length === 0 ? 0 : start + 1;
            const to = Math.min(start + historyState.pageSize, history.length);
            if (infoEl) {
                infoEl.textContent = t('home.history.page', {
                    from,
                    to,
                    total: history.length,
                    page: historyState.page,
                    pages: totalPages
                });
            }
            if (prevBtn) prevBtn.disabled = historyState.page <= 1;
            if (nextBtn) nextBtn.disabled = historyState.page >= totalPages;
        }

        // 近 7 天显示相对时间（刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm），更早显示日期；完整时间放在悬停提示里
        function formatHistoryTime(value) {
            if (!value) return '-';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '-';
            const lang = window.ToolsI18n?.getLanguage?.() || 'zh-CN';
            const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
            if (diffMinutes < 1) return t('home.history.justNow');
            if (diffMinutes < 60) return t('home.history.minutes', { n: diffMinutes });
            const now = new Date();
            const sameDay = date.toDateString() === now.toDateString();
            if (sameDay) return t('home.history.hours', { n: Math.floor(diffMinutes / 60) });
            const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            const clock = date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
            if (date.toDateString() === yesterday.toDateString()) return t('home.history.yesterday', { time: clock });
            const sameYear = date.getFullYear() === now.getFullYear();
            return date.toLocaleDateString(lang, sameYear ? { month: '2-digit', day: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + clock;
        }

        // 筛选项按实际记录动态生成（带条数），新工具开始写历史后自动出现
        function renderHistoryFilterOptions() {
            const select = document.getElementById('history-filter');
            if (!select) return;
            const current = select.value;
            const counts = new Map();
            historyState.items.forEach(item => counts.set(item.tool || '', (counts.get(item.tool || '') || 0) + 1));
            const options = [`<option value="">${escapeHtml(t('home.history.allTools'))} (${historyState.items.length})</option>`];
            [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .forEach(([tool, count]) => options.push(`<option value="${escapeHtml(tool)}">${escapeHtml(formatToolLabel(tool))} (${count})</option>`));
            select.innerHTML = options.join('');
            select.value = counts.has(current) ? current : '';
        }

        function applyHistoryFilters(resetPage = true) {
            const tool = document.getElementById('history-filter')?.value || '';
            const query = historyState.query.trim().toLowerCase();
            historyState.filtered = historyState.items.filter(item => {
                if (tool && (item.tool || '') !== tool) return false;
                if (!query) return true;
                return [item.action, item.detail, formatToolLabel(item.tool)].some(value => String(value || '').toLowerCase().includes(query));
            });
            if (resetPage) historyState.page = 1;
            renderHistoryList(historyState.filtered);
        }

        async function loadOperationHistory(resetPage = true) {
            const listEl = document.getElementById('history-list');
            const countEl = document.getElementById('history-source');
            if (!listEl) return;

            if (resetPage) historyState.page = 1;
            if (listEl) {
                listEl.innerHTML = `<div class="history-empty">${escapeHtml(t('home.history.refreshing'))}</div>`;
            }

            try {
                // 历史上限 200 条（upload-history-repository MAX_HISTORY），一次取全，筛选与搜索在前端完成
                const history = await API.get('/api/upload/history?limit=200');
                historyState.items = Array.isArray(history) ? history : [];
                renderHistoryFilterOptions();
                applyHistoryFilters(resetPage);
                if (countEl) countEl.textContent = t('home.history.count', { n: historyState.items.length });
            } catch (e) {
                if (listEl) {
                    listEl.innerHTML = `<div class="history-empty" style="color:#fca5a5;">${escapeHtml(t('home.history.failed', { message: e.message }))}</div>`;
                }
                if (countEl) countEl.textContent = t('home.history.sourceFailed');
            }
        }

        function changeHistoryPage(delta) {
            historyState.page += delta;
            renderHistoryList(historyState.filtered);
        }

        function formatStatNumber(value) {
            return Number(value || 0).toLocaleString(window.ToolsI18n?.getLanguage?.() || 'zh-CN');
        }

        function formatCompactNumber(value) {
            const number = Number(value || 0);
            if (number < 10000) return formatStatNumber(number);
            return new Intl.NumberFormat(window.ToolsI18n?.getLanguage?.() || 'zh-CN', {
                notation: 'compact',
                maximumFractionDigits: 1
            }).format(number);
        }

        function renderToolImpact(card, stat) {
            if (!card || !stat) return;
            let impact = card.querySelector('.card-impact');
            if (!impact) {
                impact = document.createElement('div');
                impact.className = 'card-impact';
                card.querySelector('.card-features')?.insertAdjacentElement('afterend', impact);
            }
            const primaryLabel = stat.labelKey ? t(stat.labelKey) : (stat.label || '');
            const secondaryLabel = stat.secondaryLabelKey ? t(stat.secondaryLabelKey) : (stat.secondaryLabel || '');
            impact.innerHTML = `<span class="card-impact-primary"><strong>${escapeHtml(formatStatNumber(stat.primary))}</strong> ${escapeHtml(primaryLabel)}</span> <span class="card-impact-sep">·</span> <span class="card-impact-secondary"><strong>${escapeHtml(formatStatNumber(stat.secondary))}</strong> ${escapeHtml(secondaryLabel)}</span>`;
            impact.title = `${formatStatNumber(stat.primary)} ${primaryLabel} · ${formatStatNumber(stat.secondary)} ${secondaryLabel}`;
        }

        function renderPlatformStats(summary) {
            const totals = summary?.totals || {};
            setText('#stat-checks', formatStatNumber(totals.metricChecks));
            setText('#stat-service', formatStatNumber(totals.serviceCount));
            setText('#stat-manual', `≈${formatStatNumber(totals.manualEquivalentHours)}h`);
            setText('#stat-saved', `≈${formatStatNumber(totals.savedHours)}h`);
            setText('#stat-tools', formatStatNumber(totals.onlineTools));
            setText('#stat-scripts', formatStatNumber(totals.scripts));
            setText('#stat-efficiency', t('home.stats.efficiency', { rate: totals.efficiencyRate || 0 }));
            const ai = summary?.ai || {};
            setText('#ai-scenarios', formatStatNumber(ai.applicationScenarios));
            setText('#ai-tasks', formatStatNumber(ai.completedTasks));
            setText('#ai-tokens', formatCompactNumber(ai.tokens));
            setText('#ai-alerts', formatStatNumber(ai.analyzedAlerts));
            setText('#ai-pages', formatStatNumber(ai.coveredPages));
            setText('#ai-saved', `≈${formatStatNumber(ai.savedHours)}h`);
            setText('#ai-task-note', t('home.ai.taskNote', { questions: ai.questions || 0 }));

            document.querySelectorAll('#toolsGrid > a.tool-card:not([data-custom-tool-card="1"]):not([data-skill-card="1"])').forEach(card => {
                const key = card.getAttribute('href').replace(/^\//, '');
                renderToolImpact(card, summary.toolStats?.[key]);
            });
            document.querySelectorAll('#toolsGrid > a[data-custom-tool-card="1"]').forEach(card => {
                renderToolImpact(card, summary.customToolStats?.[card.dataset.toolSlug]);
            });
        }

        async function loadStats() {
            if (!document.getElementById('statsBar')) return;
            try {
                platformSummary = await API.get('/api/platform-metrics/summary');
                renderPlatformStats(platformSummary);
            } catch (e) {
                if (document.getElementById('stat-tools')) document.getElementById('stat-tools').textContent = String(11 + customToolsCount);
            }
        }

        function renderCustomToolCards(tools) {
            const grid = document.getElementById('toolsGrid');
            if (!grid) return;
            window.__homeCustomTools = Array.isArray(tools) ? tools : [];
            grid.querySelectorAll('[data-custom-tool-card="1"]').forEach(el => el.remove());
            const role = localStorage.getItem('tools_role');
            (tools || []).forEach((tool, index) => {
                const isEnglish = window.ToolsI18n?.getLanguage?.() === 'en-US';
                const displayName = isEnglish && tool.nameEn ? tool.nameEn : tool.name;
                const displayDescription = isEnglish && tool.descriptionEn ? tool.descriptionEn : tool.description;
                const hasTags = Array.isArray(tool.tags) && tool.tags.length > 0;
                const tags = hasTags ? tool.tags : [t('home.custom.defaultTag1'), t('home.custom.defaultTag2')];
                const card = document.createElement('a');
                card.href = tool.href;
                card.className = `tool-card custom-tool${tool.hostedApp ? ' is-hosted-app' : ''}`;
                card.dataset.customToolCard = '1';
                card.dataset.toolSlug = tool.slug;
                card.style.setProperty('--card-accent', ['#38bdf8', '#34d399', '#f97316', '#e879f9'][index % 4]);
                card.innerHTML = `
                    <div class="custom-tool-actions">
                        ${tool.hostedApp && role !== 'admin' ? '' : `<button type="button" class="custom-tool-action" title="${escapeHtml(t(tool.hostedApp ? 'home.custom.downloadApp' : 'home.custom.download'))}" onclick="event.preventDefault(); event.stopPropagation(); downloadCustomTool('${escapeHtml(tool.slug)}')">↓</button>`}
                        ${role === 'admin' ? `
                            ${window.BuiltinPromotion?.button('tool', tool.slug, { builtIn: tool.builtIn === true, name: displayName }) || ''}
                            <button type="button" class="custom-tool-action" title="${escapeHtml(t('home.custom.rename'))}" onclick="event.preventDefault(); event.stopPropagation(); renameCustomTool('${escapeHtml(tool.slug)}')">✎</button>
                            <button type="button" class="custom-tool-action delete" title="${escapeHtml(t('home.custom.delete'))}" onclick="event.preventDefault(); event.stopPropagation(); deleteCustomTool('${escapeHtml(tool.slug)}')">×</button>
                        ` : ''}
                    </div>
                    <div class="card-icon">${escapeHtml(tool.icon || '🧩')}</div>
                    <div class="card-title">
                        ${escapeHtml(displayName || t('home.custom.defaultName'))}
                        ${isRecentlyChangedTool(tool) ? '<span class="new-badge">NEW!</span>' : ''}
                        ${tool.hostedApp
                            ? `<span class="tool-kind-badge tool-kind-badge--python" title="${escapeHtml(isEnglish ? 'Python web app hosted by the platform' : '平台托管运行的 Python Web 应用')}">Python</span>`
                            : tool.builtIn === false ? `<span class="tool-kind-badge">${isEnglish ? 'CUSTOM' : '自定义'}</span>` : ''}
                    </div>
                    <div class="card-desc">${escapeHtml(displayDescription || t('home.custom.defaultDesc'))}</div>
                    <div class="card-features">
                        ${tags.map(tag => `<span class="feature-tag${hasTags ? '' : ' is-default'}">${escapeHtml(tag)}</span>`).join('')}
                    </div>
                    <div class="card-impact"></div>
                    <div class="card-arrow">${escapeHtml(t('home.arrow.module'))}</div>
                `;
                grid.appendChild(card);
                renderToolImpact(card, platformSummary?.customToolStats?.[tool.slug] || {
                    primary: 0,
                    labelKey: 'home.impact.totalOpens',
                    secondary: 1,
                    secondaryLabelKey: 'home.impact.onlineTool'
                });
            });
        }

        async function loadCustomTools() {
            try {
                const tools = await API.get('/api/custom-tools');
                customToolsCount = Array.isArray(tools) ? tools.length : 0;
                renderCustomToolCards(tools);
                if (document.getElementById('stat-tools')) document.getElementById('stat-tools').textContent = String(11 + customToolsCount);
            } catch (e) {
                customToolsCount = 0;
                if (document.getElementById('stat-tools')) document.getElementById('stat-tools').textContent = '11';
            }
        }

        function setupCustomToolUpload() {
            const role = localStorage.getItem('tools_role');
            const panel = document.getElementById('customToolsPanel');
            const btn = document.getElementById('customToolUploadBtn');
            const modal = document.getElementById('customToolImportModal');
            const form = document.getElementById('customToolImportForm');
            const input = document.getElementById('customToolFileInput');
            const filePicker = document.getElementById('customToolFilePicker');
            const fileName = document.getElementById('customToolFileName');
            const nameInput = document.getElementById('customToolName');
            const nameEnInput = document.getElementById('customToolNameEn');
            const iconInput = document.getElementById('customToolIcon');
            const descriptionInput = document.getElementById('customToolDescription');
            const descriptionEnInput = document.getElementById('customToolDescriptionEn');
            const tagsInput = document.getElementById('customToolTags');
            const errorBox = document.getElementById('customToolImportError');
            const submitBtn = document.getElementById('customToolImportSubmit');
            const aiStatus = document.getElementById('customToolAiStatus');
            const progressBox = document.getElementById('customToolImportProgress');
            const progressBar = document.getElementById('customToolImportBar');
            const progressStatus = document.getElementById('customToolImportStatus');
            const progressLog = document.getElementById('customToolImportLog');
            const uploadLogs = [];
            const logUpload = ({ percent, message }) => {
                progressBox.hidden = false;
                if (Number.isFinite(percent)) progressBar.value = percent;
                progressStatus.textContent = `${Math.round(progressBar.value)}% · ${message}`;
                uploadLogs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
                if (uploadLogs.length > 500) uploadLogs.shift();
                progressLog.textContent = uploadLogs.join('\n');
                progressLog.scrollTop = progressLog.scrollHeight;
            };
            if (!panel || !btn || !modal || !form || !input) return;
            panel.hidden = role !== 'admin';
            let metadataGeneration = 0;
            // SKILL 技能包（ZIP 内含 SKILL.md，或单个 .md）：导入到「全部工具 → 技能」，而不是 HTML 工具
            let skillImport = null;
            // Python Web 应用包（含 requirements.txt）：由平台托管运行，可更新已托管的同名应用
            let pythonImport = null;
            const tagsField = document.getElementById('customToolTags')?.closest('.tool-import-field');
            const fileToBase64 = async file => {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const chunkSize = 0x8000;
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
                }
                return btoa(binary);
            };
            const isSkillPackage = async file => {
                if (/\.md$/i.test(file.name)) return true;
                if (!/\.zip$/i.test(file.name) || !await ensureJSZip()) return false;
                const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
                const names = Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name.replace(/\\/g, '/'))
                    .filter(name => !name.split('/').some(part => part === '__MACOSX' || part.startsWith('._')));
                const skill = names.filter(name => /(^|\/)skill\.md$/i.test(name)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
                if (!skill) return false;
                // 同时带网页入口的包按 HTML 工具处理（SKILL.md 比任何 HTML 都浅时才算技能包）
                const html = names.filter(name => /\.html?$/i.test(name)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
                return !html || skill.split('/').length <= html.split('/').length;
            };
            const looksLikePythonApp = names => {
                const depth = name => name.split('/').length;
                const set = new Set(names);
                const root = names.filter(name => /(^|\/)requirements\.txt$/i.test(name)).sort((a, b) => depth(a) - depth(b))
                    .map(name => name.slice(0, name.length - 'requirements.txt'.length))
                    .find(prefix => ['platform-app.json', 'run.py', 'app/main.py', 'main.py', 'app.py', 'server.py', 'asgi.py', 'wsgi.py'].some(file => set.has(prefix + file)));
                if (root === undefined) return false;
                const html = names.filter(name => /(^|\/)index\.html?$/i.test(name)).sort((a, b) => depth(a) - depth(b))[0];
                return !html || depth(html) > depth(`${root}requirements.txt`);
            };
            const isPythonPackage = async file => {
                if (!/\.zip$/i.test(file.name) || !await ensureJSZip()) return false;
                const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
                return looksLikePythonApp(Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name.replace(/\\/g, '/'))
                    .filter(name => !name.split('/').some(part => part === '__MACOSX' || part.startsWith('._'))));
            };
            const setPythonMode = app => {
                pythonImport = app;
                if (!skillImport) submitBtn.textContent = t(app ? (app.updateSlug ? 'home.import.pyUpdateSubmit' : 'home.import.pySubmit') : 'home.import.submit');
            };
            const setSkillMode = skill => {
                skillImport = skill;
                if (tagsField) tagsField.hidden = Boolean(skill);
                submitBtn.textContent = t(skill ? 'home.import.skillSubmit' : 'home.import.submit');
                const title = document.getElementById('customToolImportTitle');
                if (title) title.textContent = t(skill ? 'home.import.skillTitle' : 'home.import.title');
                const nameLabel = document.getElementById('customToolNameLabel');
                if (nameLabel) nameLabel.innerHTML = `${escapeHtml(t(skill ? 'home.import.skillName' : 'home.import.name'))} <span>*</span>`;
                const nameEnLabel = document.getElementById('customToolNameEnLabel');
                if (nameEnLabel) nameEnLabel.textContent = t(skill ? 'home.import.skillNameEn' : 'home.import.nameEn');
            };
            const detectSkill = async file => {
                const generation = ++metadataGeneration;
                setAiStatus(t('home.import.skillChecking'), 'loading');
                let preview = null;
                try {
                    if (await isSkillPackage(file)) {
                        const isMarkdown = /\.md$/i.test(file.name);
                        const payload = isMarkdown ? { skillMd: await file.text(), archiveName: file.name } : { archiveBase64: await fileToBase64(file), archiveName: file.name };
                        preview = { ...(await API.post('/api/agent-skills/preview', payload)).skill, payload, isMarkdown };
                    }
                } catch (error) {
                    if (generation !== metadataGeneration) return;
                    setSkillMode(null);
                    setAiStatus(error.message, 'warning');
                    return;
                }
                if (generation !== metadataGeneration) return;
                if (!preview) {
                    setSkillMode(null);
                    let pythonApp = null;
                    try {
                        if (await isPythonPackage(file)) pythonApp = (await API.post('/api/hosted-apps/preview', { archiveBase64: await fileToBase64(file), archiveName: file.name })).app;
                    } catch (error) {
                        if (generation !== metadataGeneration) return;
                        setPythonMode(null);
                        setAiStatus(error.message, 'warning');
                        return;
                    }
                    if (generation !== metadataGeneration) return;
                    if (!pythonApp) {
                        setPythonMode(null);
                        void generateAiMetadata(file);
                        return;
                    }
                    let updateSlug = '';
                    const existing = pythonApp.existing && pythonApp.existing[0];
                    if (existing && await AppDialog.confirm(t('home.import.pyUpdate', { name: existing.name, version: existing.version || '' }), { title: t('home.import.pyUpdateTitle'), confirmText: t('home.import.pyUpdateSubmit') })) {
                        updateSlug = existing.slug;
                    }
                    if (generation !== metadataGeneration) return;
                    setPythonMode({ ...pythonApp, updateSlug });
                    if (updateSlug) nameInput.value = existing.name;
                    else if (pythonApp.name && (!nameInput.value.trim() || nameInput.value === nameInput.dataset.autoValue)) nameInput.value = pythonApp.name;
                    nameInput.dataset.autoValue = nameInput.value;
                    if (pythonApp.description && !descriptionInput.value) descriptionInput.value = pythonApp.description;
                    if (iconInput.value === '🧩') iconInput.value = '🐍';
                    tagsInput.value = 'Python 应用';
                    const detail = pythonApp.python.ok
                        ? t('home.import.pyDetected', { entry: pythonApp.entry, iface: pythonApp.interface.toUpperCase() }) + (pythonApp.offlineWheels ? t('home.import.pyOffline', { count: pythonApp.offlineWheels }) : '')
                        : t('home.import.pyNoPython', { message: pythonApp.python.message });
                    setAiStatus(detail, pythonApp.python.ok ? 'success' : 'warning');
                    return;
                }
                setSkillMode(preview);
                nameInput.value = preview.name || nameInput.value;
                nameInput.dataset.autoValue = nameInput.value;
                nameEnInput.value = preview.nameEn || '';
                descriptionInput.value = preview.description || '';
                descriptionEnInput.value = preview.descriptionEn || '';
                iconInput.value = preview.icon || '✨';
                const detail = t('home.import.skillDetected', { id: preview.id }) + (preview.fileCount ? t('home.import.skillFiles', { count: preview.fileCount }) : '');
                setAiStatus(preview.reserved ? t('home.import.skillReserved', { id: preview.id }) : detail, preview.reserved ? 'warning' : 'success');
            };
            const importSkill = async (overwrite = false) => {
                const body = {
                    ...skillImport.payload,
                    overwrite,
                    source: 'import',
                    name: nameInput.value.trim(),
                    nameEn: nameEnInput.value.trim(),
                    description: descriptionInput.value.trim(),
                    descriptionEn: descriptionEnInput.value.trim(),
                    icon: iconInput.value.trim() || '✨'
                };
                try {
                    return (await API.post(skillImport.isMarkdown ? '/api/agent-skills' : '/api/agent-skills/import', body)).skill;
                } catch (error) {
                    const code = error.body?.code;
                    if (code === 'SKILL_EXISTS' && !overwrite && await AppDialog.confirm(t('home.import.skillExists', { id: skillImport.id }), { title: t('home.import.skillSubmit') })) return importSkill(true);
                    if (code === 'SKILL_ID_RESERVED') throw new Error(t('home.import.skillReserved', { id: skillImport.id }));
                    throw error;
                }
            };

            const formatFileSize = bytes => {
                if (bytes < 1024) return `${bytes} B`;
                if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
            };
            const showImportError = message => {
                errorBox.textContent = message;
                errorBox.classList.add('visible');
            };
            const clearImportError = () => {
                errorBox.textContent = '';
                errorBox.classList.remove('visible');
            };
            const setAiStatus = (message = '', state = '') => {
                aiStatus.textContent = message;
                aiStatus.title = '';
                aiStatus.className = `tool-import-ai-status${message ? ' visible' : ''}${state ? ` ${state}` : ''}`;
            };
            const encodeTextBase64 = text => {
                const bytes = new TextEncoder().encode(text);
                const chunkSize = 0x8000;
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
                }
                return btoa(binary);
            };
            const readToolHtml = async file => {
                if (!/\.zip$/i.test(file.name)) return file.text();
                if (!await ensureJSZip()) throw new Error('ZIP 解析组件未加载');
                const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
                const htmlEntries = Object.values(zip.files)
                    .filter(entry => {
                        const parts = String(entry.name || '').replace(/\\/g, '/').split('/').filter(Boolean);
                        const macMetadata = parts.some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'));
                        return !entry.dir && !macMetadata && /\.html?$/i.test(entry.name);
                    })
                    .sort((a, b) => {
                        const aIndex = /(^|\/)index\.html?$/i.test(a.name) ? 0 : 1;
                        const bIndex = /(^|\/)index\.html?$/i.test(b.name) ? 0 : 1;
                        return aIndex - bIndex || a.name.length - b.name.length;
                    });
                if (!htmlEntries.length) throw new Error(t('home.import.zipHtmlMissing'));
                return htmlEntries[0].async('string');
            };
            const generateAiMetadata = async file => {
                const generation = ++metadataGeneration;
                const baseline = {
                    name: nameInput.value,
                    nameEn: nameEnInput.value,
                    description: descriptionInput.value,
                    descriptionEn: descriptionEnInput.value,
                    tags: tagsInput.value
                };
                setAiStatus(t('home.import.aiAnalyzing'), 'loading');
                try {
                    const html = await readToolHtml(file);
                    const excerpt = html.length > 90000
                        ? `${html.slice(0, 70000)}\n<!-- middle omitted -->\n${html.slice(-20000)}`
                        : html;
                    const metadata = await API.post('/api/custom-tools/ai-metadata', {
                        fileName: file.name,
                        contentBase64: encodeTextBase64(excerpt)
                    });
                    if (generation !== metadataGeneration) return;
                    if (nameInput.value === baseline.name && metadata.name) nameInput.value = metadata.name;
                    if (nameEnInput.value === baseline.nameEn && metadata.nameEn) nameEnInput.value = metadata.nameEn;
                    if (descriptionInput.value === baseline.description && metadata.description) descriptionInput.value = metadata.description;
                    if (descriptionEnInput.value === baseline.descriptionEn && metadata.descriptionEn) descriptionEnInput.value = metadata.descriptionEn;
                    if (tagsInput.value === baseline.tags && Array.isArray(metadata.tags)) tagsInput.value = metadata.tags.join(', ');
                    setAiStatus(t('home.import.aiComplete'), 'success');
                } catch (error) {
                    if (generation !== metadataGeneration) return;
                    setAiStatus(t('home.import.aiUnavailable'), 'warning');
                    aiStatus.title = error.message || '';
                    nameInput.focus();
                }
            };
            const resetImportForm = () => {
                delete submitBtn.dataset.completed;
                submitBtn.textContent = t('home.import.submit');
                progressBox.hidden = true;
                progressBar.value = 0;
                progressLog.textContent = '';
                uploadLogs.length = 0;
                metadataGeneration += 1;
                form.reset();
                input.value = '';
                iconInput.value = '🧩';
                descriptionInput.value = '';
                descriptionEnInput.value = '';
                tagsInput.value = `${t('home.custom.defaultTag1')}, ${t('home.custom.defaultTag2')}`;
                nameInput.dataset.autoValue = '';
                fileName.textContent = '';
                filePicker.classList.remove('has-file');
                setAiStatus();
                setSkillMode(null);
                setPythonMode(null);
                clearImportError();
            };
            const openImportModal = () => {
                resetImportForm();
                modal.classList.add('open');
                document.body.style.overflow = 'hidden';
                window.setTimeout(() => input.focus(), 0);
            };
            const closeImportModal = () => {
                if (submitBtn.disabled) return;
                modal.classList.remove('open');
                document.body.style.overflow = '';
                resetImportForm();
                btn.focus();
            };
            const updateSelectedFile = () => {
                const file = input.files && input.files[0];
                if (!file) {
                    metadataGeneration += 1;
                    fileName.textContent = '';
                    filePicker.classList.remove('has-file');
                    setAiStatus();
                    return;
                }
                clearImportError();
                filePicker.classList.add('has-file');
                fileName.textContent = t('home.import.fileSelected', { name: file.name, size: formatFileSize(file.size) });
                const defaultName = file.name.replace(/\.(html?|zip|md)$/i, '');
                const previousAutoValue = nameInput.dataset.autoValue || '';
                if (!nameInput.value.trim() || nameInput.value === previousAutoValue) nameInput.value = defaultName;
                nameInput.dataset.autoValue = defaultName;
                void detectSkill(file);
            };

            btn.addEventListener('click', openImportModal);
            input.addEventListener('change', updateSelectedFile);
            document.getElementById('customToolImportClose')?.addEventListener('click', closeImportModal);
            document.getElementById('customToolImportCancel')?.addEventListener('click', closeImportModal);
            modal.addEventListener('click', event => {
                if (event.target === modal) closeImportModal();
            });
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape' && modal.classList.contains('open')) closeImportModal();
            });

            form.addEventListener('submit', async event => {
                event.preventDefault();
                if (submitBtn.dataset.completed === 'true') { closeImportModal(); return; }
                clearImportError();
                const file = input.files && input.files[0];
                try {
                    if (!file) throw new Error(t('home.import.fileRequired'));
                    if (skillImport) {
                        if (!nameInput.value.trim()) throw new Error(t('home.validation.nameRequired'));
                        submitBtn.disabled = true;
                        submitBtn.textContent = t('home.import.submitting');
                        const skill = await importSkill();
                        submitBtn.dataset.completed = 'true';
                        showToast(t('home.import.skillImported', { id: skill.id }));
                        window.dispatchEvent(new CustomEvent('skills:changed', { detail: { id: skill.id } }));
                        return;
                    }
                    const isZip = /\.zip$/i.test(file.name);
                    if (!isZip && !/\.html?$/i.test(file.name)) throw new Error('仅支持 HTML 或 ZIP 文件');
                    if (isZip && file.size > 35 * 1024 * 1024) throw new Error('ZIP 文件不能超过 35 MB');
                    const name = nameInput.value.trim();
                    if (!name) throw new Error(t('home.validation.nameRequired'));
                    if (name.length > 80) throw new Error(t('home.validation.nameTooLong'));
                    if (pythonImport && !pythonImport.updateSlug && !(await AppDialog.confirm(t('home.import.pyConfirm'), { title: t('home.import.pyConfirmTitle'), confirmText: t('home.import.pySubmit') }))) return;
                    submitBtn.disabled = true;
                    submitBtn.textContent = t('home.import.submitting');
                    const payload = {
                        ...(pythonImport?.updateSlug ? { updateSlug: pythonImport.updateSlug } : {}),
                        name,
                        nameEn: nameEnInput.value.trim(),
                        icon: iconInput.value.trim() || '🧩',
                        description: descriptionInput.value.trim(),
                        descriptionEn: descriptionEnInput.value.trim(),
                        tags: tagsInput.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 8)
                    };
                    if (isZip) {
                        const bytes = new Uint8Array(await file.arrayBuffer());
                        const chunkSize = 0x8000;
                        let binary = '';
                        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
                        }
                        payload.archiveBase64 = btoa(binary);
                        payload.archiveName = file.name;
                    } else {
                        payload.htmlContent = await file.text();
                    }
                    uploadLogs.length = 0;
                    await CustomToolUpload.upload(payload, { onProgress: logUpload });
                    submitBtn.dataset.completed = 'true';
                    showToast(t(pythonImport ? (pythonImport.updateSlug ? 'home.import.pyUpdated' : 'home.import.pyImported') : 'home.toast.imported'));
                    await loadCustomTools();
                    if (window.refreshCustomToolNavLinks) await window.refreshCustomToolNavLinks();
                } catch (e) {
                    logUpload({ message: t('home.alert.importFailed', { message: e.message }) });
                    showImportError(t('home.alert.importFailed', { message: e.message }));
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = t(submitBtn.dataset.completed === 'true' ? 'home.import.done' : skillImport ? 'home.import.skillSubmit'
                        : pythonImport ? (pythonImport.updateSlug ? 'home.import.pyUpdateSubmit' : 'home.import.pySubmit') : 'home.import.submit');
                }
            });
        }

        function setupToolMarket() {
            const button = document.getElementById('toolMarketBtn');
            const modal = document.getElementById('toolMarketModal');
            const list = document.getElementById('toolMarketList');
            const summary = document.getElementById('toolMarketSummary');
            const trust = document.getElementById('toolMarketTrust');
            const message = document.getElementById('toolMarketMessage');
            const progress = document.getElementById('toolMarketProgress');
            const progressText = document.getElementById('toolMarketProgressText');
            const progressCount = document.getElementById('toolMarketProgressCount');
            const progressBar = document.getElementById('toolMarketProgressBar');
            const log = document.getElementById('toolMarketLog');
            const details = document.getElementById('toolMarketDetails');
            const applyButton = document.getElementById('toolMarketApply');
            const refreshButton = document.getElementById('toolMarketRefresh');
            if (!button || !modal || !list || !applyButton) return;
            let preview = null;
            let loading = false;
            const settingsPanel = document.getElementById('toolMarketSettings');
            const sourceList = document.getElementById('toolMarketSources');
            const settingsMessage = document.getElementById('toolMarketSettingsMessage');

            const resetProgress = () => {
                progress.classList.remove('visible');
                progressBar.style.width = '0%';
                progressText.textContent = '';
                progressCount.textContent = '';
                log.textContent = '';
            };
            const appendLog = value => {
                const time = new Date().toLocaleTimeString(undefined, { hour12: false });
                const lines = log.textContent ? log.textContent.split('\n') : [];
                lines.push(`[${time}] ${value}`);
                log.textContent = lines.slice(-250).join('\n');
                log.scrollTop = log.scrollHeight;
            };

            const english = () => (window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_language')) === 'en-US';
            const text = (zh, en) => english() ? en : zh;
            const logStage = event => {
                const source = event.sourceName || '';
                const slug = event.slug || '';
                const count = Number(event.count) || 0;
                const messages = {
                    sources_ready: text(`已读取仓库设置，启用 ${count} 个仓库`, `Source settings loaded; ${count} enabled`),
                    source_start: text(`开始检查仓库：${source}`, `Checking source: ${source}`),
                    catalog_fetching: text(`${source}：正在获取 catalog.json`, `${source}: fetching catalog.json`),
                    catalog_received: text(`${source}：已获取 catalog.json（${size(event.bytes)}）`, `${source}: catalog.json received (${size(event.bytes)})`),
                    catalog_parsed: text(`${source}：JSON 已解析，发现 ${count} 条工具记录`, `${source}: JSON parsed; ${count} tool records found`),
                    catalog_validated: text(`${source}：工具清单和包文件目录已校验，共 ${count} 个工具`, `${source}: tool list and package file manifests validated; ${count} tools`),
                    catalog_cached: text(`${source}：使用已缓存目录，共 ${count} 个工具`, `${source}: using cached catalog; ${count} tools`),
                    source_done: text(`${source}：目录读取完成`, `${source}: catalog ready`),
                    source_error: text(`${source}：读取失败：${event.error}`, `${source}: failed: ${event.error}`),
                    catalogs_merged: text(`已合并 ${event.sourceCount || 0} 个仓库，共 ${count} 个不重复工具`, `Merged ${event.sourceCount || 0} sources; ${count} unique tools`),
                    tools_comparing: text(`正在对比 ${count} 个工具与本地目录`, `Comparing ${count} tools with local directories`),
                    tool_compared: text(`已比对 ${event.current}/${event.total}：${event.name || slug}`, `Compared ${event.current}/${event.total}: ${event.name || slug}`),
                    preview_done: text(`目录对比完成，共 ${count} 个工具`, `Catalog comparison complete; ${count} tools`),
                    apply_start: text(`开始处理 ${count} 个所选工具`, `Starting ${count} selected tools`),
                    bundled_installing: text(`正在安装 ${count} 个内置工具`, `Installing ${count} bundled tools`),
                    bundled_done: text(`内置工具处理完成，变更 ${count} 个`, `Bundled tools finished; ${count} changed`),
                    package_fetching: text(`${slug}：正在下载工具包`, `${slug}: downloading package`),
                    package_received: text(`${slug}：工具包已下载（${size(event.bytes)}）`, `${slug}: package downloaded (${size(event.bytes)})`),
                    package_verified: text(`${slug}：包大小和 SHA-256 校验通过`, `${slug}: package size and SHA-256 verified`),
                    package_extracted: text(`${slug}：工具包已解压到临时目录`, `${slug}: package extracted to temporary directory`),
                    directory_verified: text(`${slug}：具体工具目录指纹校验通过`, `${slug}: tool directory fingerprint verified`),
                    tools_installing: text(`正在安装 ${count} 个市场工具`, `Installing ${count} market tools`),
                    apply_done: text(`文件安装完成，变更 ${count} 个工具`, `File installation finished; ${count} tools changed`),
                    local_index_updating: text(`正在更新本地工具索引（${count} 个）`, `Updating local tool index (${count})`)
                };
                if (messages[event.stage]) appendLog(messages[event.stage]);
            };
            const requestStream = async (path, body, onProgress) => {
                const token = localStorage.getItem('tools_token');
                const response = await fetch(path, {
                    method: body ? 'POST' : 'GET',
                    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
                    ...(body ? { body: JSON.stringify(body) } : {})
                });
                if (!response.ok) {
                    const errorBody = await response.json().catch(() => ({}));
                    throw new Error(errorBody.error || `HTTP ${response.status}`);
                }
                if (!response.body) throw new Error(text('浏览器不支持读取更新进度', 'Browser cannot read update progress'));
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let pending = '';
                let result;
                const processLine = line => {
                    if (!line.trim()) return;
                    const event = JSON.parse(line);
                    if (event.type === 'progress') { logStage(event); onProgress?.(event); }
                    else if (event.type === 'result') result = event.data;
                    else if (event.type === 'error') throw new Error(event.error || text('工具市场请求失败', 'Tool market request failed'));
                };
                while (true) {
                    const { value, done } = await reader.read();
                    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
                    const lines = pending.split('\n');
                    pending = lines.pop();
                    lines.forEach(processLine);
                    if (done) break;
                }
                processLine(pending);
                if (!result) throw new Error(text('工具市场连接中断，未收到最终结果', 'Tool market connection ended without a result'));
                return result;
            };
            const sourceRow = source => `<div class="tool-market-source" data-source-id="${escapeHtml(source.id || '')}">
                <label><input type="checkbox" class="source-enabled" ${source.enabled !== false ? 'checked' : ''} aria-label="${text('启用仓库', 'Enable source')}"></label>
                <input type="text" class="source-name" value="${escapeHtml(source.name || '')}" placeholder="${text('仓库名称', 'Source name')}" aria-label="${text('仓库名称', 'Source name')}">
                <input type="url" class="source-url" value="${escapeHtml(source.url || '')}" placeholder="http://intranet.example.com/tool-market/catalog.json" aria-label="catalog.json URL">
                <button type="button" class="tool-import-btn source-remove">${text('删除', 'Remove')}</button></div>`;
            const renderSettings = settings => {
                document.getElementById('toolMarketGithubEnabled').checked = settings.githubEnabled;
                sourceList.innerHTML = settings.sources.map(sourceRow).join('');
            };
            const readSettings = () => ({
                githubEnabled: document.getElementById('toolMarketGithubEnabled').checked,
                sources: [...sourceList.querySelectorAll('.tool-market-source')].map(row => ({
                    id: row.dataset.sourceId, name: row.querySelector('.source-name').value.trim(),
                    url: row.querySelector('.source-url').value.trim(), enabled: row.querySelector('.source-enabled').checked
                }))
            });
            document.getElementById('toolMarketSettingsBtn').addEventListener('click', async () => {
                settingsPanel.classList.toggle('open');
                if (settingsPanel.classList.contains('open')) {
                    try { renderSettings(await API.get('/api/custom-tools/market/settings')); settingsMessage.textContent = ''; }
                    catch (error) { settingsMessage.textContent = error.message; }
                }
            });
            document.getElementById('toolMarketAddSource').addEventListener('click', () => {
                sourceList.insertAdjacentHTML('beforeend', sourceRow({ enabled: true }));
                sourceList.lastElementChild.querySelector('.source-name').focus();
            });
            sourceList.addEventListener('click', event => {
                if (event.target.closest('.source-remove')) event.target.closest('.tool-market-source').remove();
            });
            document.getElementById('toolMarketSaveSettings').addEventListener('click', async () => {
                const save = document.getElementById('toolMarketSaveSettings');
                save.disabled = true;
                try {
                    renderSettings(await API.put('/api/custom-tools/market/settings', readSettings()));
                    settingsMessage.textContent = text('设置已保存。', 'Settings saved.');
                    await load(true);
                } catch (error) { settingsMessage.textContent = error.message; appendLog(text(`仓库设置保存失败：${error.message}`, `Saving source settings failed: ${error.message}`)); }
                finally { save.disabled = false; }
            });
            document.getElementById('toolMarketHelpBtn').addEventListener('click', () => {
                const help = document.getElementById('toolMarketHelp');
                help.classList.toggle('open');
                help.innerHTML = text(
                    '<strong>从零配置内网仓库</strong><ol><li>将工具市场仓库的 <code>catalog.json</code> 和 <code>packages/</code> 目录放在内网 HTTP(S) 静态服务器上。</li><li>确认目录内每个工具的 <code>package.url</code> 指向内网包地址，或使用相对路径；包的大小和 SHA-256 必须与目录一致。</li><li>点击“添加第三方仓库”，填写名称和 <code>catalog.json</code> 完整地址，保存后刷新市场。</li><li>内网无法连接 GitHub 时，可取消勾选 GitHub；需要停用某个内网仓库时，取消该仓库左侧勾选。</li></ol>',
                    '<strong>Set up an intranet source</strong><ol><li>Host the market repository’s <code>catalog.json</code> and <code>packages/</code> folder on an HTTP(S) server.</li><li>Use intranet or relative <code>package.url</code> values and keep each package size and SHA-256 accurate.</li><li>Add a source with its name and full <code>catalog.json</code> URL, save, then refresh.</li><li>Disable GitHub when it is unreachable; disable any custom source with its checkbox.</li></ol>'
                );
            });
            const size = bytes => {
                const value = Number(bytes) || 0;
                if (value < 1024) return `${value} B`;
                if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
                return `${(value / 1024 / 1024).toFixed(1)} MB`;
            };
            const formatMarketTime = value => {
                if (!value) return text('未知', 'Unknown');
                const raw = String(value).trim();
                if (/^\d{4}[.-]\d{1,2}[.-]\d{1,2}$/.test(raw)) {
                    return `${raw.replace(/\./g, '-')} (${text('未记录时分秒', 'time not recorded')})`;
                }
                // Version identifiers are not timestamps. Never infer a time from them.
                if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return raw;
                const date = new Date(raw);
                if (!Number.isFinite(date.getTime())) return raw;
                return new Intl.DateTimeFormat(english() ? 'en-GB' : 'zh-CN', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hourCycle: 'h23', timeZoneName: 'shortOffset'
                }).format(date);
            };

            const labels = () => ({
                unchanged: text('已是最新', 'Up to date'),
                missing: text('可安装', 'Available'),
                update: text('可更新', 'Update'),
                conflict: text('本地同名冲突', 'Local conflict'),
                incompatible: text('平台版本不兼容', 'Incompatible'),
                unresolved: text('版本无法比较', 'Version unclear')
            });

            const render = data => {
                preview = data;
                const rawTools = Array.isArray(data?.tools) ? data.tools : [];
                const actionable = rawTools.filter(tool => tool.recommended).length;
                const selectable = rawTools.filter(tool => ['missing', 'update', 'conflict'].includes(tool.status)).length;
                const hasPendingUpdates = rawTools.some(tool => ['update', 'missing', 'conflict'].includes(tool.status));

                const getSortScore = tool => {
                    if (tool.status === 'update') return 0;   // 待更新最优先
                    if (tool.status === 'missing') return 1;  // 可安装新工具次之
                    if (tool.status === 'conflict') return 2; // 冲突次之
                    if (tool.status === 'unchanged') return 3;// 已是最新
                    return 4;                                 // incompatible 等其他
                };

                const tools = [...rawTools].map((tool, index) => ({ tool, index }))
                    .sort((a, b) => {
                        const scoreA = getSortScore(a.tool);
                        const scoreB = getSortScore(b.tool);
                        if (scoreA !== scoreB) return scoreA - scoreB;
                        return a.index - b.index;
                    })
                    .map(item => item.tool);

                const unchangedCount = tools.filter(t => t.status === 'unchanged').length;

                const enabledSources = (data.sources || []).filter(source => source.enabled);
                const failedSources = enabledSources.filter(source => source.error);
                summary.textContent = enabledSources.length === 0
                    ? text('所有仓库已停用。可在右上角齿轮中启用。', 'All sources are disabled. Enable one in settings.')
                    : failedSources.length === enabledSources.length
                        ? text('仓库暂时不可用，请检查地址或网络后刷新。', 'Sources are unavailable. Check their addresses or network and refresh.')
                    : actionable > 0
                    ? text(`共 ${tools.length} 个工具，${actionable} 个建议安装/更新（已优先置顶）`, `${tools.length} tools, ${actionable} recommended updates (pinned to top)`)
                    : text(`共 ${tools.length} 个工具，全部已是最新版本`, `${tools.length} tools, all up to date`);
                message.textContent = failedSources.length && failedSources.length < enabledSources.length
                    ? text(`${failedSources.length} 个仓库暂时不可用，其余仓库已正常加载。`, `${failedSources.length} sources unavailable; others loaded.`) : '';
                const trustState = data?.trust?.state || 'unsigned';
                trust.className = `tool-market-trust${trustState === 'verified' ? '' : ' unverified'}`;
                trust.textContent = !enabledSources.length ? '' : trustState === 'verified'
                    ? text('✓ 目录签名已验证', '✓ Catalog signature verified')
                    : text('⚠ HTTPS + SHA-256 校验', '⚠ HTTPS + SHA-256 verification');
                const statusLabels = labels();

                let hasInsertedDivider = false;
                const itemsHtml = [];
                for (const tool of tools) {
                    const isPending = ['update', 'missing', 'conflict'].includes(tool.status);
                    const isActionable = isPending;
                    const isDimmed = !isPending;

                    if (hasPendingUpdates && !isPending && !hasInsertedDivider && unchangedCount > 0) {
                        hasInsertedDivider = true;
                        itemsHtml.push(`<div class="tool-market-divider"><span>${escapeHtml(text(`其余工具已是最新（${unchangedCount}）`, `Other tools up to date (${unchangedCount})`))}</span></div>`);
                    }

                    const description = english() ? (tool.descriptionEn || tool.description) : tool.description;
                    const disabled = !['missing', 'update', 'conflict'].includes(tool.status);
                    const localModified = tool.localModified
                        ? `<p class="tool-market-warning">${text('检测到本地文件修改；更新前会自动备份。', 'Local file changes detected; a backup will be created before updating.')}</p>` : '';
                    const conflict = tool.status === 'conflict'
                        ? `<p class="tool-market-warning">${text('这是未关联的手动导入工具；只有主动勾选并二次确认才会接管。', 'This manually imported tool is not linked; it is adopted only after selection and confirmation.')}</p>` : '';
                    const sourceLabel = tool.selectedSource === 'builtin'
                        ? text('内置工具较新，将从内置源安装', 'Bundled tool is newer; install from bundled source')
                        : tool.selectedSource === 'unknown'
                            ? text('缺少可比较的发布日期，已停止自动更新', 'Release dates cannot be compared; automatic update paused')
                            : tool.status === 'unchanged'
                                ? text('本地内容与工具市场一致', 'Local content matches the market release')
                                : text('将从工具市场安装', 'Install from the tool market');

                    let badgeHtml = '';
                    if (hasPendingUpdates && isPending) {
                        if (tool.status === 'update') {
                            badgeHtml = `<span class="tool-market-badge update">${text('待更新', 'Update')}</span>`;
                        } else if (tool.status === 'missing') {
                            badgeHtml = `<span class="tool-market-badge new">${text('新工具', 'New')}</span>`;
                        } else if (tool.status === 'conflict') {
                            badgeHtml = `<span class="tool-market-badge conflict">${text('冲突', 'Conflict')}</span>`;
                        }
                    }

                    const cardClasses = [
                        'tool-market-card',
                        `is-${escapeHtml(tool.status)}`,
                        isActionable ? 'is-actionable' : '',
                        isDimmed ? 'is-dimmed' : ''
                    ].filter(Boolean).join(' ');

                    itemsHtml.push(`<article class="${cardClasses}">
                        <input type="checkbox" data-market-slug="${escapeHtml(tool.slug)}" ${tool.recommended ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                        <span class="tool-market-icon">${escapeHtml(tool.icon)}</span>
                        <div class="tool-market-copy">
                            <div class="tool-market-title">${escapeHtml(english() ? (tool.nameEn || tool.name) : tool.name)}${badgeHtml}</div>
                            <p>${escapeHtml(description || '')}</p>${localModified}${conflict}
                            <div class="tool-market-meta">
                                <span>${escapeHtml(tool.sourceName || 'GitHub')} · ${escapeHtml(sourceLabel)}</span>
                                <span>${text('本地更新时间', 'Local updated')}：${escapeHtml(formatMarketTime(tool.localUpdatedAt || tool.localVersion))}</span>
                                <span>${text('内置更新时间', 'Bundled updated')}：${escapeHtml(formatMarketTime(tool.builtinVersion))}</span>
                                <span>${text('市场更新时间', 'Market updated')}：${escapeHtml(formatMarketTime(tool.marketUpdatedAt || tool.releasedAt || tool.marketVersion))}</span>
                                <span>${text('版本', 'Version')} ${escapeHtml(tool.localVersion || '-')} → ${escapeHtml(tool.releaseVersion || '-')}</span>
                                ${tool.selectedSource === 'market' ? `<span>${size(tool.packageSize)}</span><span>${text('需平台', 'Requires')} ${escapeHtml(tool.minPlatformVersion)}+</span>` : ''}
                                <span class="tool-market-fingerprint" title="SHA-256 ${escapeHtml(tool.fingerprint)}">SHA-256 ${escapeHtml(tool.fingerprint.slice(0, 12))}…</span>
                            </div>
                        </div>
                        <span class="tool-market-status ${escapeHtml(tool.status)}">${escapeHtml(statusLabels[tool.status] || tool.status)}</span>
                    </article>`);
                }
                list.innerHTML = itemsHtml.length ? itemsHtml.join('') : `<div class="tool-market-empty">${text('市场目录中暂无工具', 'No tools are currently listed')}</div>`;
                applyButton.disabled = selectable === 0;
                applyButton.textContent = text('更新所选工具', 'Update selected tools');
                refreshButton.textContent = text('刷新', 'Refresh');
            };

            // 目录加载进度：仓库读取占 0–45%（按各仓库所处阶段平均），本地比对占 45–100%（按已比对工具数）
            const SOURCE_STAGE_WEIGHT = { source_start: .05, catalog_fetching: .15, catalog_received: .6, catalog_parsed: .75, catalog_validated: .9, catalog_cached: .9, source_done: 1, source_error: 1 };
            const renderLoadingCard = () => {
                list.innerHTML = `<div class="builtin-sync-loading">
                    <div class="builtin-sync-loading-card">
                        <div class="builtin-sync-loading-head">
                            <div class="builtin-sync-spinner" aria-hidden="true"></div>
                            <div class="builtin-sync-loading-title">${escapeHtml(text('正在加载工具市场目录…', 'Loading tool market catalog…'))}</div>
                            <div class="builtin-sync-loading-percent">0%</div>
                        </div>
                        <div class="builtin-sync-loading-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
                        <div class="builtin-sync-loading-detail">${escapeHtml(text('正在读取仓库设置…', 'Reading source settings…'))}</div>
                    </div>
                    <div class="builtin-sync-skeleton-list" aria-hidden="true">
                        <div class="builtin-sync-skeleton-card"></div><div class="builtin-sync-skeleton-card"></div>
                        <div class="builtin-sync-skeleton-card"></div><div class="builtin-sync-skeleton-card"></div>
                    </div>
                </div>`;
            };
            const createLoadTracker = () => {
                const sources = new Map();
                let sourceCount = 0;
                let percent = 0;
                return event => {
                    let title = null;
                    let detail = null;
                    if (event.stage === 'sources_ready') {
                        sourceCount = Number(event.count) || 0;
                        detail = text(`已启用 ${sourceCount} 个仓库`, `${sourceCount} sources enabled`);
                    } else if (event.stage in SOURCE_STAGE_WEIGHT) {
                        const name = event.sourceName || '';
                        sources.set(name, Math.max(sources.get(name) || 0, SOURCE_STAGE_WEIGHT[event.stage]));
                        const done = [...sources.values()].filter(value => value >= 1).length;
                        const total = Math.max(sourceCount, sources.size, 1);
                        const sum = [...sources.values()].reduce((acc, value) => acc + value, 0);
                        percent = Math.max(percent, sum / total * 45);
                        title = text(`正在读取仓库目录 · ${done}/${total}`, `Reading source catalogs · ${done}/${total}`);
                        detail = {
                            source_start: text(`${name}：开始连接`, `${name}: connecting`),
                            catalog_fetching: text(`${name}：正在获取 catalog.json`, `${name}: fetching catalog.json`),
                            catalog_received: text(`${name}：已下载目录（${size(event.bytes)}）`, `${name}: catalog downloaded (${size(event.bytes)})`),
                            catalog_parsed: text(`${name}：正在校验 ${event.count || 0} 条工具记录`, `${name}: validating ${event.count || 0} tool records`),
                            catalog_validated: text(`${name}：目录校验通过`, `${name}: catalog validated`),
                            catalog_cached: text(`${name}：使用缓存目录`, `${name}: using cached catalog`),
                            source_done: text(`${name}：读取完成`, `${name}: ready`),
                            source_error: text(`${name}：读取失败`, `${name}: failed`)
                        }[event.stage];
                    } else if (event.stage === 'catalogs_merged') {
                        percent = Math.max(percent, 45);
                        detail = text(`已合并 ${event.count || 0} 个工具`, `Merged ${event.count || 0} tools`);
                    } else if (event.stage === 'tools_comparing') {
                        percent = Math.max(percent, 45);
                        title = text(`正在比对本地工具 · 0/${event.count || 0}`, `Comparing local tools · 0/${event.count || 0}`);
                    } else if (event.stage === 'tool_compared') {
                        const total = Math.max(1, Number(event.total) || 1);
                        const current = Math.min(total, Number(event.current) || 0);
                        percent = Math.max(percent, 45 + current / total * 55);
                        title = text(`正在比对本地工具 · ${current}/${total}`, `Comparing local tools · ${current}/${total}`);
                        detail = text(`正在检查：${event.name || event.slug}`, `Checking: ${event.name || event.slug}`);
                    } else if (event.stage === 'preview_done') {
                        percent = 100;
                        title = text('目录加载完成', 'Catalog loaded');
                    } else {
                        return;
                    }
                    const rounded = Math.round(percent);
                    const titleEl = list.querySelector('.builtin-sync-loading-title');
                    const percentEl = list.querySelector('.builtin-sync-loading-percent');
                    const barEl = list.querySelector('.builtin-sync-loading-bar');
                    const fillEl = list.querySelector('.builtin-sync-loading-bar i');
                    const detailEl = list.querySelector('.builtin-sync-loading-detail');
                    if (title && titleEl) titleEl.textContent = title;
                    if (percentEl) percentEl.textContent = `${rounded}%`;
                    if (barEl) barEl.setAttribute('aria-valuenow', String(rounded));
                    if (fillEl) fillEl.style.transform = `scaleX(${percent / 100})`;
                    if (detail && detailEl) detailEl.textContent = detail;
                    if (detail) message.textContent = `${rounded}% · ${detail}`;
                };
            };

            const load = async force => {
                if (loading) return;
                resetProgress();
                appendLog(text('开始刷新工具市场目录', 'Refreshing tool market catalog'));
                loading = true;
                message.textContent = text('正在加载最新工具目录…', 'Loading the latest catalog…');
                summary.textContent = message.textContent;
                trust.textContent = '';
                renderLoadingCard();
                applyButton.disabled = true;
                refreshButton.disabled = true;
                try {
                    const data = await requestStream(`/api/custom-tools/market/preview-stream${force ? '?refresh=1' : ''}`, null, createLoadTracker());
                    render(data);
                } catch (error) {
                    appendLog(text(`目录加载失败：${error.message}`, `Catalog load failed: ${error.message}`));
                    preview = null;
                    list.innerHTML = `<div class="tool-market-empty">${escapeHtml(error.message || text('市场加载失败', 'Failed to load market'))}</div>`;
                    summary.textContent = text('无法连接工具市场', 'Unable to connect to the tool market');
                    trust.textContent = '';
                    message.textContent = text('可稍后刷新；不影响本地工具使用。', 'Try refreshing later; local tools remain available.');
                } finally {
                    loading = false;
                    refreshButton.disabled = false;
                }
            };

            const close = () => {
                if (loading) return;
                modal.classList.remove('open');
                document.body.style.overflow = '';
                button.focus();
            };
            button.addEventListener('click', () => {
                button.dataset.opened = '1';
                modal.classList.add('open');
                details.open = false;
                document.body.style.overflow = 'hidden';
                void load(true);
            });
            document.getElementById('toolMarketClose')?.addEventListener('click', close);
            modal.addEventListener('click', event => { if (event.target === modal) close(); });
            refreshButton.addEventListener('click', () => void load(true));
            applyButton.addEventListener('click', async () => {
                if (!preview || loading) return;
                const selected = [...list.querySelectorAll('[data-market-slug]:checked')].map(input => input.dataset.marketSlug);
                if (!selected.length) {
                    message.textContent = text('请先选择需要安装或更新的工具。', 'Select at least one tool to install or update.');
                    return;
                }
                const adoptSlugs = preview.tools.filter(tool => selected.includes(tool.slug) && tool.status === 'conflict').map(tool => tool.slug);
                if (adoptSlugs.length && !await AppDialog.confirm(text(
                    `将接管 ${adoptSlugs.length} 个同名本地工具。旧目录会先备份，确定继续吗？`,
                    `Adopt ${adoptSlugs.length} local tools with matching slugs? Their current directories will be backed up first.`
                ), { title: text('接管同名工具', 'Adopt local tools'), confirmText: text('继续', 'Continue'), cancelText: text('取消', 'Cancel') })) return;
                loading = true;
                applyButton.disabled = true;
                refreshButton.disabled = true;
                list.querySelectorAll('input').forEach(input => { input.disabled = true; });
                progress.classList.add('visible');
                appendLog(text(`开始更新所选工具（${selected.length} 个）`, `Updating selected tools (${selected.length})`));
                let completed = 0;
                let succeeded = 0;
                const failures = [];
                try {
                    const fingerprints = Object.fromEntries(preview.tools.map(tool => [tool.slug, tool.fingerprint]));
                    for (const slug of selected) {
                        const tool = preview.tools.find(item => item.slug === slug);
                        const displayName = english() ? (tool?.nameEn || tool?.name || slug) : (tool?.name || slug);
                        progressText.textContent = tool?.selectedSource === 'builtin'
                            ? text(`正在从内置工具安装：${displayName}`, `Installing bundled tool: ${displayName}`)
                            : text(`正在下载、校验并安装：${displayName}`, `Downloading, verifying, and installing: ${displayName}`);
                        progressCount.textContent = `${completed + 1} / ${selected.length}`;
                        appendLog(text(`→ ${displayName}：开始处理`, `→ ${displayName}: started`));
                        try {
                            const result = await requestStream('/api/custom-tools/market/apply-stream', {
                                slugs: [slug],
                                adoptSlugs: adoptSlugs.includes(slug) ? [slug] : [],
                                expectedFingerprints: { [slug]: fingerprints[slug] },
                                expectedSources: { [slug]: tool.sourceId || 'github' }
                            });
                            succeeded += Array.isArray(result.changed) ? result.changed.length : 0;
                            appendLog(tool?.selectedSource === 'builtin'
                                ? text(`✓ ${displayName}：已从内置工具恢复`, `✓ ${displayName}: restored from bundled tool`)
                                : text(`✓ ${displayName}：下载、SHA-256 校验和安装完成`, `✓ ${displayName}: downloaded, SHA-256 verified, and installed`));
                        } catch (error) {
                            failures.push({ name: displayName, message: error.message || text('未知错误', 'Unknown error') });
                            appendLog(text(`✗ ${displayName}：${error.message}`, `✗ ${displayName}: ${error.message}`));
                        }
                        completed += 1;
                        progressBar.style.width = `${Math.round(completed / selected.length * 100)}%`;
                    }
                    progressText.textContent = failures.length
                        ? text('更新完成，部分工具失败', 'Update completed with some failures')
                        : text('所选工具全部处理完成', 'All selected tools completed');
                    const completionMessage = failures.length
                        ? text(`成功 ${succeeded} 个，失败 ${failures.length} 个；请查看日志。`, `${succeeded} succeeded, ${failures.length} failed; see the log.`)
                        : text(`已完成 ${succeeded} 个工具的安装/更新。`, `Installed or updated ${succeeded} tools.`);
                    appendLog(text('安装完成，正在重新检查市场和本地工具', 'Installation finished; checking market and local tools again'));
                    const refreshed = await requestStream('/api/custom-tools/market/preview-stream?refresh=1');
                    render(refreshed);
                    message.textContent = completionMessage;
                    progress.classList.add('visible');
                    progressBar.style.width = '100%';
                    await loadCustomTools();
                    if (window.refreshCustomToolNavLinks) await window.refreshCustomToolNavLinks();
                } catch (error) {
                    appendLog(text(`更新流程失败：${error.message}`, `Update workflow failed: ${error.message}`));
                    message.textContent = text(`更新失败：${error.message}`, `Update failed: ${error.message}`);
                    if (preview) render(preview);
                } finally {
                    loading = false;
                    refreshButton.disabled = false;
                }
            });
            window.__simulateToolMarketUpdates = () => {
                if (!preview || !Array.isArray(preview.tools) || preview.tools.length < 2) {
                    console.warn('请先点击打开工具市场加载目录数据');
                    return;
                }
                const mock = JSON.parse(JSON.stringify(preview));
                mock.tools[0].status = 'update';
                mock.tools[0].recommended = true;
                mock.tools[0].releaseVersion = '2026.10.01 (新版本)';
                mock.tools[1].status = 'missing';
                mock.tools[1].recommended = true;
                render(mock);
                console.log('已模拟有更新/新工具场景：已置顶并高亮待更新项，其余卡片保持弱化。点击“刷新”可恢复真实状态。');
            };
        }

        // 卡片中心的圆环下载进度：有 Content-Length 时显示百分比，否则显示转动的圆环；完成后打勾淡出
        function showCardDownloadProgress(slug) {
            const card = document.querySelector(`.custom-tool[data-tool-slug="${CSS.escape(slug)}"]`);
            if (!card) return { update() {}, done() {}, fail() {} };
            card.querySelector('.card-download-progress')?.remove();
            const RADIUS = 20;
            const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
            const overlay = document.createElement('div');
            overlay.className = 'card-download-progress is-indeterminate';
            overlay.setAttribute('role', 'progressbar');
            overlay.setAttribute('aria-label', t('home.custom.downloading'));
            overlay.innerHTML = `
                <div class="cdp-ring">
                    <svg viewBox="0 0 48 48" aria-hidden="true">
                        <circle class="cdp-track" cx="24" cy="24" r="${RADIUS}"></circle>
                        <circle class="cdp-bar" cx="24" cy="24" r="${RADIUS}" stroke-dasharray="${CIRCUMFERENCE}" stroke-dashoffset="${CIRCUMFERENCE * 0.72}"></circle>
                    </svg>
                    <span class="cdp-value">↓</span>
                </div>
                <span class="cdp-size"></span>`;
            ['click', 'mousedown'].forEach(type => overlay.addEventListener(type, event => { event.preventDefault(); event.stopPropagation(); }));
            card.appendChild(overlay);
            requestAnimationFrame(() => overlay.classList.add('visible'));
            const bar = overlay.querySelector('.cdp-bar');
            const value = overlay.querySelector('.cdp-value');
            const size = overlay.querySelector('.cdp-size');
            const formatSize = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
            const close = delay => setTimeout(() => {
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 320);
            }, delay);
            return {
                update(loaded, total) {
                    if (total > 0) {
                        const ratio = Math.min(1, loaded / total);
                        overlay.classList.remove('is-indeterminate');
                        bar.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - ratio));
                        value.textContent = `${Math.round(ratio * 100)}%`;
                        overlay.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
                        size.textContent = `${formatSize(loaded)} / ${formatSize(total)}`;
                    } else {
                        size.textContent = formatSize(loaded);
                    }
                },
                done() {
                    overlay.classList.remove('is-indeterminate');
                    overlay.classList.add('is-done');
                    bar.style.strokeDashoffset = '0';
                    value.textContent = '✓';
                    close(700);
                },
                fail() {
                    overlay.classList.remove('is-indeterminate');
                    overlay.classList.add('is-error');
                    value.textContent = '!';
                    close(1200);
                }
            };
        }

        async function downloadCustomTool(slug) {
            const progress = showCardDownloadProgress(slug);
            try {
                const token = localStorage.getItem('tools_token');
                const response = await fetch(`/api/custom-tools/${encodeURIComponent(slug)}/export`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${response.status}`);
                }
                const total = Number(response.headers.get('Content-Length')) || 0;
                let blob;
                if (response.body && response.body.getReader) {
                    const reader = response.body.getReader();
                    const chunks = [];
                    let loaded = 0;
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        loaded += value.length;
                        progress.update(loaded, total);
                    }
                    blob = new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
                } else {
                    blob = await response.blob();
                }
                progress.done();
                const encodedName = response.headers.get('X-Tool-Export-Filename') || `${slug}.zip`;
                let filename = encodedName;
                try { filename = decodeURIComponent(encodedName); } catch (_) {}
                const link = document.createElement('a');
                const objectUrl = URL.createObjectURL(blob);
                link.href = objectUrl;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
                const exportType = response.headers.get('X-Tool-Export-Type');
                const fileCount = response.headers.get('X-Tool-Export-File-Count') || '1';
                showToast(exportType === 'python-app'
                    ? t(response.headers.get('X-Tool-Export-Original') === '1' ? 'home.custom.downloadedApp' : 'home.custom.downloadedAppRebuilt')
                    : exportType === 'zip'
                        ? t('home.custom.downloadedZip', { count: fileCount })
                        : t('home.custom.downloadedHtml'));
            } catch (error) {
                progress.fail();
                showToast(t('home.custom.downloadFailed', { message: error.message }), 'error');
            }
        }

        async function renameCustomTool(slug) {
            // 用工具的真实名称：卡片标题里还有 NEW!、自定义 / Python 等标签文字
            const tool = (window.__homeCustomTools || []).find(item => item.slug === slug);
            const title = document.querySelector(`[data-custom-tool-card="1"][data-tool-slug="${CSS.escape(slug)}"] .card-title`)?.cloneNode(true);
            title?.querySelectorAll('.new-badge, .tool-kind-badge').forEach(node => node.remove());
            const currentName = tool?.name || title?.textContent?.replace(/\s+/g, ' ').trim() || '';
            const name = await AppDialog.prompt(t('home.prompt.rename'), { title: t('home.dialog.renameTitle'), defaultValue: currentName, maxLength: 80, confirmText: t('home.dialog.save') });
            if (name === null || name.trim() === currentName) return;
            if (!name.trim()) {
                showToast(t('home.alert.renameFailed', { message: t('home.validation.nameRequired') }), 'warning');
                return;
            }
            if (name.trim().length > 80) {
                showToast(t('home.alert.renameFailed', { message: t('home.validation.nameTooLong') }), 'warning');
                return;
            }
            try {
                await API.patch(`/api/custom-tools/${encodeURIComponent(slug)}/name`, { name: name.trim() });
                showToast(t('home.toast.renamed'));
                await loadCustomTools();
                if (window.refreshCustomToolNavLinks) await window.refreshCustomToolNavLinks();
            } catch (e) {
                AppDialog.alert(t('home.alert.renameFailed', { message: e.message }), { title: t('home.dialog.failed'), tone: 'error' });
            }
        }

        async function deleteCustomTool(slug) {
            if (!await AppDialog.confirm(t('home.confirm.delete'), { title: t('home.dialog.deleteTitle'), tone: 'danger', confirmText: t('home.dialog.delete') })) return;
            try {
                await API.delete(`/api/custom-tools/${encodeURIComponent(slug)}`);
                showToast(t('home.toast.deleted'));
                await loadCustomTools();
                if (window.refreshCustomToolNavLinks) await window.refreshCustomToolNavLinks();
            } catch (e) {
                AppDialog.alert(t('home.alert.deleteFailed', { message: e.message }), { title: t('home.dialog.failed'), tone: 'error' });
            }
        }

        window.addEventListener('tools:languagechange', () => {
            applyHomeI18n();
            applyHistoryFilters(false);
            loadCustomTools();
        });

        document.addEventListener('DOMContentLoaded', () => {
            applyHomeI18n();
            document.getElementById('homeKnowledgeGraphEntry')?.addEventListener('click', async event => {
                event.stopPropagation();
                const button = event.currentTarget;
                if (button.disabled) return;
                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    if (!window.openToolsKnowledgeGraph) throw new Error('知识图谱入口尚未加载，请刷新页面后重试');
                    await window.openToolsKnowledgeGraph();
                } catch (error) {
                    if (typeof showToast === 'function') showToast(error.message || '知识图谱打开失败', 'error');
                    else AppDialog.alert(error.message || '知识图谱打开失败', { title: '打开失败', tone: 'error' });
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
            setupFriendLinks();
            setupApiRelay();
            setupCustomToolUpload();
            setupToolMarket();
            loadCustomTools();
            // 统计和操作历史只在工具区显示，不占首屏请求
            (window.HomeMode?.whenTools || (task => task()))(() => {
                loadStats();
                loadOperationHistory();
            });

            document.getElementById('history-filter')?.addEventListener('change', () => applyHistoryFilters(true));
            let historySearchTimer = 0;
            document.getElementById('history-search')?.addEventListener('input', event => {
                clearTimeout(historySearchTimer);
                historySearchTimer = setTimeout(() => {
                    historyState.query = event.target.value || '';
                    applyHistoryFilters(true);
                }, 120);
            });
            document.getElementById('history-refresh')?.addEventListener('click', () => loadOperationHistory(true));
            document.getElementById('history-prev')?.addEventListener('click', () => changeHistoryPage(-1));
            document.getElementById('history-next')?.addEventListener('click', () => changeHistoryPage(1));
        });
    