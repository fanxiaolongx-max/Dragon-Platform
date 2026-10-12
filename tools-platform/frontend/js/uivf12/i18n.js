/**
 * uivf12/i18n.js - Page dictionary and helpers for the Data Capture page.
 */
(function () {
    const dictionaries = {
        'zh-CN': {
            'uiv.title': 'UIVF12 抓取引擎 v6.6 - Tools Platform',
            'uiv.description': 'UI.Vision 全能抓取引擎，自动化脚本工程中心，脚本云端仓库管理',
            'uiv.header.title': '🚀 自动化脚本工程中心',
            'uiv.version.loading': 'v加载中',
            'uiv.version.unmarked': 'v未标记',
            'uiv.version.title': '当前页面资源最新版本：{version}',
            'uiv.version.missing': '未检测到前端资源版本号',
            'uiv.header.tag': '多源融合 + Formula 权威版',
            'uiv.repo.title': '📂 智能调度仓库',
            'uiv.repo.copyAll': '全量打包',
            'uiv.repo.copyAllTitle': '拷贝仓库内所有分类的全部脚本',
            'uiv.repo.tip': '默认清爽折叠，<b>双击回填至工作台</b>。',
            'uiv.repo.mode': '仓库读源模式:',
            'uiv.source.auto': '自动模式',
            'uiv.source.json': 'JSON',
            'uiv.source.sqlite': '强制 SQLite',
            'uiv.source.script': '脚本来源: {source}',
            'uiv.source.category': '分类来源: {source}',
            'uiv.source.initialNote': '仓库加载后会在这里显示当前真实读源。',
            'uiv.source.currentNote': '当前模式: {mode} · 默认要求页面直接渲染当前真实读源，便于迁移期验证。',
            'uiv.repo.newCategory': '[+] 新建自定义分类',
            'uiv.repo.copyBatch': '📦 拷贝全部为批量阵列 (F12)',
            'uiv.repo.copyBatchUiv': '📦 拷贝全部为批量阵列 (UI.V)',
            'uiv.repo.runBatchUiv': '🚀 运行批脚本',
            'uiv.repo.runTestBatchUiv': '🚀 测试批脚本',
            'uiv.repo.siteConsolePlaceholder': '📋 浮窗脚本',
            'uiv.repo.siteConsoleTitle': '选择目标站点并复制该站点的 F12 控制台脚本',
            'uiv.repo.batchSpeedTitle': '当前 {speed} 倍速：脚本间隔约 {seconds} 秒。点击切换 1x / 2x / 4x。',
            'uiv.repo.batchSpeedToast': 'UI.Vision 批量速度已切换为 {speed}x，脚本间隔约 {seconds} 秒',
            'uiv.repo.batchTenantWarning': '⚠️ 本批抓取和自动导入完成前请勿切换租户，否则结果可能导入到其他租户。',
            'uiv.repo.batchTenantCompletionWarning': '抓取已完成，但自动导入尚未完成。请保持当前租户，待数据导入页完成后再切换。',
            'uiv.repo.export': '📤 导出脚本',
            'uiv.repo.import': '📥 导入脚本',
            'uiv.input.urlLabel': '1. 请求 URL 目标地址:',
            'uiv.preset.datafab': '🟢 DataFab - 明细列表',
            'uiv.preset.netcareCn': '🔴 NetCare - 中国节点',
            'uiv.preset.netcareAe': '🔵 NetCare - 中东节点',
            'uiv.preset.netcareDe': '🟠 NetCare - 德国节点',
            'uiv.preset.custom': '⚙️ 自定义新地址...',
            'uiv.urlAssist.custom': '自定义地址',
            'uiv.urlAssist.detected': '已自动识别：{category}',
            'uiv.urlAssist.matches': '仓库匹配 {count} 个地址',
            'uiv.input.payloadLabel': '2. 请求负载 Payload (JSON):',
            'uiv.input.payloadHint': '粘贴后可点击格式化',
            'uiv.input.responseSampleLabel': '3. 响应示例 Response Sample (JSON):',
            'uiv.input.responseSampleHint': '可选，用于识别多表并聚焦提取',
            'uiv.input.responseSamplePlaceholder': '可选：粘贴接口返回的 JSON 响应示例。多表响应时可聚焦提取指定数据（如代表处、明细表等）',
            'uiv.focus.badge': '数据聚焦',
            'uiv.focus.singleTable': '已定位唯一数据表：{name} ({count} 行)',
            'uiv.focus.multipleTables': '已检测到 {count} 个数据表，可选择或按关键词聚焦',
            'uiv.focus.keywordMatched': '关键词 "{keyword}" 已匹配：{name} ({path})',
            'uiv.focus.keywordMultiple': '关键词 "{keyword}" 命中 {count} 个候选表，请点击选择',
            'uiv.focus.keywordNone': '关键词 "{keyword}" 未直接命中表名，生成时将深度搜索',
            'uiv.focus.selectedInfo': '已聚焦：{name} (路径: {path}, {count} 行)',
            'uiv.focus.chooseTable': '📋 选择数据表',
            'uiv.focus.chooseTableMulti': '⚠️ 选择具体表 (命中 {count} 个)',
            'uiv.focus.multiCandidatePrompt': '⚠️ 关键词 "{keyword}" 命中 {count} 个候选表，请点击选择具体提取哪一张表：',
            'uiv.focus.multiCandidateSpecified': '✅ 已从 {count} 个候选命中表中选定：[表 {index}] {name}',
            'uiv.focus.modalTitle': '🎯 选择要抓取的目标数据表',
            'uiv.focus.modalSubtitle': '检测到响应中包含多组数据表或数据块，请选择脚本要提取的数据：',
            'uiv.focus.modalMultiSubtitle': '⚠️ 关键词 "{keyword}" 在以下 {count} 个候选表中均有命中，请点击指定要抓取的目标表：',
            'uiv.focus.matchedBadge': '🎯 命中关键词',
            'uiv.focus.unmatchedBadge': '⚪ 未命中关键词',
            'uiv.focus.keywordPlaceholder': '抓取关键词（可选，如：rep offic、Region）',
            'uiv.focus.clearTitle': '清除数据聚焦',
            'uiv.focus.closeModal': '关闭',
            'uiv.focus.activeLog': '🎯 数据聚焦已激活: {detail}',
            'uiv.sampleGuide.badgeText': '支持格式与动态示例',
            'uiv.sampleGuide.badgeTitle': '鼠标悬停查看支持的格式结构与动态示例（可一键填入测试）',
            'uiv.sampleGuide.popoverTitle': '响应示例支持格式与数据聚焦指南',
            'uiv.sampleGuide.popoverTag': '能力与限制速查',
            'uiv.sampleGuide.popoverDesc': '粘贴接口的真实 JSON 响应示例，工具将自动深度识别其中的所有数据表与图表组件。当响应中存在多张表（如大盘概览、区域汇总、代表处明细等）时，可指定关键词或手动选择目标表，精准生成提取逻辑，彻底避免抓错表。',
            'uiv.sampleGuide.descDatafab': '自动探测每个组件的字段定义、行数与样本，支持按图表名、代表处或字段关键词精准聚焦提取。',
            'uiv.sampleGuide.descStandard': '自动将首行对象的全部键提取为表头字段，适用于通用 REST API 与微服务业务列表接口。',
            'uiv.sampleGuide.descNested': '自动递归搜索深层数组并映射提取路径，兼容各种嵌套层级和分页包装结构。',
            'uiv.sampleGuide.capTitle': '核心能力：',
            'uiv.sampleGuide.capList': '多表自动探测、字段解析、关键词打分匹配、多表冲突引导与一键选择、汇总行自动融合提取。',
            'uiv.sampleGuide.limitTitle': '使用限制：',
            'uiv.sampleGuide.limitList': '必须为合法 JSON 文本；不支持 HTML 页面代码、二进制流、加密内容或验证码保护接口。',
            'uiv.sampleGuide.exampleLabel': '✨ 动态结构示例（可一键填入测试）：',
            'uiv.sampleGuide.tabDatafab': 'DataFab 多组件(含代表处)',
            'uiv.sampleGuide.tabStandard': '标准对象数组',
            'uiv.sampleGuide.tabNested': '嵌套分页结果',
            'uiv.sampleGuide.fillBtn': '⚡ 一键填入当前示例至响应框',
            'uiv.sampleGuide.copyBtn': '📋 复制示例 JSON',
            'uiv.sampleGuide.toastFilled': '✅ 示例已填入并完成智能解析！',
            'uiv.sampleGuide.toastCopied': '✅ 示例 JSON 已复制到剪贴板！',
            'uiv.input.filePlaceholder': '文件名前缀 (例如：PBI_代表处数据)',
            'uiv.input.fileGuideBadge': 'AI 命名',
            'uiv.input.fileGuideTitle': '生成前后均可修改',
            'uiv.input.fileGuideText': '保存时同步侧边栏脚本名与导出 CSV 名',
            'uiv.input.fileAiBadge': 'AI 双语命名',
            'uiv.input.fileAiBadgeLoading': 'AI 命名中',
            'uiv.input.fileAiAnalyzing': '正在分析脚本用途',
            'uiv.input.fileAiAnalyzingHint': '生成简短的中文名与 English name...',
            'uiv.input.fileAiApplied': '已自动回填中英文名称',
            'uiv.input.fileAiSuggestionsReady': 'AI 候选已生成',
            'uiv.input.fileAiKeptManual': '检测到手动修改，已保留；可点击候选替换',
            'uiv.input.fileAiUnavailable': 'AI 自动命名暂不可用',
            'uiv.input.fileAiUnavailableHint': '可继续手动命名，不影响生成与保存',
            'uiv.input.fileAiUseZh': '使用中文名称',
            'uiv.input.fileAiUseEn': 'Use English name',
            'uiv.option.globalVars': '全局变量注入',
            'uiv.option.pagination': '循环翻页',
            'uiv.option.forceSum': '强制获取汇总数据-兜底',
            'uiv.option.cpc': '动态抓取 CPC / NID',
            'uiv.option.runtimeMonth': '开启[运行时:当月+上月]动态双重裂变',
            'uiv.option.netcareTriplicate': '🌍 保存侧边栏时自动生成 NetCare 三大区脚本阵列',
            'uiv.action.format': '🔍 格式化',
            'uiv.action.clear': '🗑️ 清空',
            'uiv.action.generate': '⚡ 一键生成生产级脚本',
            'uiv.action.aiAdaptAll': '✨ AI抓取数据脚本生成器(测试版)',
            'uiv.output.uivLabel': '🤖 生产级 UI.Vision 宏代码:',
            'uiv.output.save': '💾 加入侧边栏',
            'uiv.output.copyUiv': '📋 复制 UIV',
            'uiv.output.uivPlaceholder': '生成后显示 UI.Vision 宏代码...',
            'uiv.output.consoleLabel': '💻 纯浏览器控制台执行脚本 (F12):',
            'uiv.output.copyConsole': '📋 复制 Console',
            'uiv.output.consolePlaceholder': '生成后显示纯浏览器 F12 直跑脚本...',
            'uiv.log.title': '📋 生成日志',
            'uiv.log.clear': '清空',
            'uiv.log.waiting': '等待生成...',
            'uiv.log.busy': '⏳ 生成中...',
            'uiv.log.ok': '✅ 生成成功',
            'uiv.log.err': '❌ 生成失败',
            'uiv.log.done': '脚本生成完毕！',
            'uiv.category.netcareCn': 'NetCare中国',
            'uiv.category.netcareAe': 'NetCare中东',
            'uiv.category.netcareDe': 'NetCare德国',
            'uiv.category.default': '默认分类',
            'uiv.category.empty': '（空）将脚本拖拽至此',
            'uiv.category.copyTitle': '仅打包提取此组脚本',
            'uiv.category.deleteTitle': '删除此分类',
            'uiv.script.itemTitle': '双击回填配置至工作台',
            'uiv.script.renameAction': '重命名',
            'uiv.script.renameTitle': '重命名脚本：{name}',
            'uiv.script.renamePrompt': '请输入新的脚本名称：',
            'uiv.renameDialog.eyebrow': '脚本管理 · 重命名',
            'uiv.renameDialog.title': '重命名脚本',
            'uiv.renameDialog.message': '修改脚本在智能调度仓库中的名称，不影响脚本自动化执行与历史数据关联。',
            'uiv.renameDialog.label': '新脚本名称',
            'uiv.renameDialog.placeholder': '输入新的脚本名称',
            'uiv.renameDialog.hint': '支持中文、英文、数字与下划线',
            'uiv.renameDialog.cancel': '取消',
            'uiv.renameDialog.confirm': '💾 确认重命名',
            'uiv.renameDialog.required': '请先输入脚本名称',
            'uiv.renameDialog.duplicate': '该分类下已存在同名脚本，请换一个名称',
            'uiv.toast.scriptRenamed': '✅ 脚本已重命名为 [{name}]',
            'uiv.toast.scriptRenamedWithRules': '✅ 脚本已重命名为 [{name}]，已自动同步更新 {count} 项数据导入规则',
            'uiv.toast.renameFail': '❌ 重命名失败',
            'uiv.save.autoCategory': '📂 自动判断分类',
            'uiv.save.categorySelectTitle': '选择保存的目标分类（默认自动判断，支持浏览器记忆）',
            'uiv.script.deleteAction': '删除',
            'uiv.script.deleteTitle': '删除脚本：{name}',
            'uiv.deleteDialog.eyebrow': '危险操作',
            'uiv.deleteDialog.title': '确认删除这个脚本？',
            'uiv.deleteDialog.message': '删除后，该脚本将从智能调度仓库中移除，并且无法恢复。',
            'uiv.deleteDialog.cancel': '先不删除',
            'uiv.deleteDialog.confirm': '确认删除',
            'uiv.categoryDeleteDialog.eyebrow': '危险操作 · 批量删除',
            'uiv.categoryDeleteDialog.title': '确认删除这个分类？',
            'uiv.toast.serverFail': '❌ 无法连接服务器，脚本仓库加载失败',
            'uiv.toast.moveFail': '❌ 移动分类失败',
            'uiv.toast.filled': '✅ [{name}] 配置已回填！',
            'uiv.copy.consoleScript': '控制台脚本',
            'uiv.alert.legacyScript': '⚠️ 旧版脚本，请重新生成并覆盖保存。',
            'uiv.confirm.deleteScript': '确定删除 [{name}] 吗？',
            'uiv.toast.scriptDeleted': '✅ 脚本已删除',
            'uiv.toast.deleteFail': '❌ 删除失败',
            'uiv.prompt.newCategory': '请输入新分类名称：',
            'uiv.categoryDialog.eyebrow': '智能调度仓库',
            'uiv.categoryDialog.title': '新建自定义分类',
            'uiv.categoryDialog.message': '给这组脚本起一个清楚、好记的名字，后续可以直接拖拽脚本进行整理。',
            'uiv.categoryDialog.label': '分类名称',
            'uiv.categoryDialog.placeholder': '例如：月报自动化、区域专项',
            'uiv.categoryDialog.hint': '支持中文、英文和数字',
            'uiv.categoryDialog.count': '{count}/{max}',
            'uiv.categoryDialog.cancel': '取消',
            'uiv.categoryDialog.confirm': '✨ 创建分类',
            'uiv.categoryDialog.required': '请先输入分类名称',
            'uiv.categoryDialog.duplicate': '这个分类已经存在，请换一个名称',
            'uiv.toast.categoryCreated': '✅ 分类已创建',
            'uiv.toast.createFail': '❌ 创建失败',
            'uiv.confirm.deleteCategory': '确定要删除分类 [{name}] 吗？\n注意：该分类下的所有脚本也会被一并删除！',
            'uiv.toast.categoryDeleted': '✅ 分类已删除',
            'uiv.alert.emptyExport': '⚠️ 当前脚本仓库为空，没有可导出的脚本！',
            'uiv.export.filename': 'UIVision_脚本仓库_{date}.json',
            'uiv.toast.exported': '✅ 脚本和自定义分类已导出！',
            'uiv.toast.exportFail': '❌ 导出失败',
            'uiv.alert.invalidBackup': '❌ 无效的脚本导入文件',
            'uiv.confirm.importMode': '📦 已读取脚本文件！\n\n点击【确定】融合（保留现有脚本，同名脚本用导入版替换）\n点击【取消】覆盖（清空现有脚本仓库，完全替换）',
            'uiv.toast.imported': '✅ 脚本和自定义分类已导入！',
            'uiv.alert.importFail': '❌ 导入失败：脚本文件解析出错。',
            'uiv.copy.noCode': '⚠️ 没有可复制的代码！',
            'uiv.copy.successButton': '✅ 成功',
            'uiv.copy.toast': '✅ {type} 已复制到剪贴板！',
            'uiv.copy.memoryToast': '✅ [{type}] 复制成功！',
            'uiv.copy.allGroup': '全量总仓库',
            'uiv.copy.fetchFail': '❌ 无法获取脚本列表',
            'uiv.copy.emptyGroup': '⚠️ 当前分类下没有可执行的脚本！',
            'uiv.copy.batchType': '[{group}] 批量阵列 (F12)',
            'uiv.copy.batchTypeUiv': '[{group}] 批量阵列 (UI.V)',
            'uiv.copy.noUivBatch': '⚠️ 当前仓库没有可打包的 UI.Vision 脚本，请重新生成并保存脚本。',
            'uiv.workbench.badJson': 'JSON 格式不合法，请检查标点或括号是否匹配。',
            'uiv.save.needGenerate': '⚠️ 请先生成脚本后再保存！',
            'uiv.save.defaultFile': 'PBI_自动抓取',
            'uiv.save.conflictMany': '发现 {count} 个同名脚本（含裂变分发区域），是否一键覆盖更新？',
            'uiv.save.conflictOne': '已存在名为 [{name}] 的脚本，是否覆盖更新？',
            'uiv.save.toastTriplicate': '✅ {count} 个脚本已分发至三大区！',
            'uiv.save.toastSaved': '✅ 脚本已保存至仓库！',
            'uiv.save.btnTriplicate': '✅ 阵列已分发',
            'uiv.save.btnSaved': '✅ 已保存',
            'uiv.save.noCompression': '❌ 保存失败，且当前浏览器不支持压缩重试',
            'uiv.save.retryTriplicate': '✅ {count} 个脚本已通过压缩重试保存！',
            'uiv.save.retrySaved': '✅ 脚本已通过压缩重试保存！',
            'uiv.save.retryFail': '❌ 保存失败，压缩重试也未成功',
            'uiv.generator.needPayload': '请先提供有效的 Payload JSON！',
            'uiv.generator.needPayloadLog': 'Payload 为空，请先格式化输入',
            'uiv.generator.engineStart': '引擎启动 · UIVF12 {version}',
            'uiv.generator.targetPlatform': '目标平台: {platform}  |  URL: {url}',
            'uiv.generator.payloadSection': 'Payload 解析',
            'uiv.generator.netcareSummary': 'NetCare 模式：已自动注入 need_summary=true',
            'uiv.generator.detectedPlaceholder': '✅ 检测到，已转为动态占位符',
            'uiv.generator.notDetected': '未检测到',
            'uiv.generator.cpcPoint': 'CPC 嵌入点: {state}',
            'uiv.generator.nidPoint': 'NID 嵌入点: {state}',
            'uiv.generator.monthSplit': '月份裂变: {state}',
            'uiv.generator.monthEnabled': '✅ 已开启 [{mode}]',
            'uiv.generator.monthDual': '当月 + 上月双跨度运行',
            'uiv.generator.monthSingle': '单期模式',
            'uiv.generator.off': '关闭',
            'uiv.generator.paramsSection': '参数提取',
            'uiv.generator.notFound': '(未找到)',
            'uiv.generator.missingPageId': '⚠️ 警告：缺少 pageId！已生成自动嗅探代码。',
            'uiv.generator.outputFile': '输出文件名: {name}',
            'uiv.generator.switchSection': '开关配置检查',
            'uiv.generator.on': '开启',
            'uiv.generator.offStatic': '关闭 — 使用静态占位符',
            'uiv.generator.offFirstPage': '关闭 — 仅报文第一页',
            'uiv.generator.onMissingComp': '开启（但 compId 缺失，可能失效）',
            'uiv.generator.onMonthRange': '开启（当月 + 上月）',
            'uiv.generator.globalVars': '全局变量注入: {state}',
            'uiv.generator.pagination': '循环翻页: {state}',
            'uiv.generator.forceSum': '独立大盘兜底: {state}',
            'uiv.generator.runtimeMonth': '运行时月份裂变: {state}',
            'uiv.generator.buildSection': '脚本构建',
            'uiv.generator.scriptTitle': '脚本标题: {title}',
            'uiv.generator.auth': '平台认证: {auth}',
            'uiv.generator.cookieAuth': 'CSRF-Token (Cookie 自动提取)',
            'uiv.generator.localAuth': '本地存储 globalConfig CSRF',
            'uiv.generator.aiAuth': 'AI 适配认证 ({strategy})',
            'uiv.generator.syntaxFail': '生成脚本语法校验失败：{message}',
            'uiv.generator.outputReady': '脚本内容已写入输出区！UIV + F12 Console 双版均就绪',
            'uiv.extension.btnText': '安装 UI.Vision 插件',
            'uiv.extension.btnTitle': '前往官方应用商店安装或下载 UI.Vision RPA 扩展离线包',
            'uiv.extension.sidebarLink': '🧩 安装 UI.Vision 插件 (官方推荐)',
            'uiv.extension.outputTip': '💡 未安装 UI.Vision RPA 插件？点击前往官方商店一键安装或使用本地离线包',
            'uiv.extension.modalEyebrow': '官方扩展 · 快捷安装',
            'uiv.extension.modalTitle': '🧩 UI.Vision RPA 插件下载与安装指南',
            'uiv.extension.modalSubtitle': '优先推荐官方应用商店一键安装 · 支持 Chrome / Edge 浏览器',
            'uiv.extension.downloadCardTitle': 'UI.Vision RPA 官方扩展',
            'uiv.extension.downloadCardMeta': '点击大按钮前往官方应用商店一键添加扩展；若网络受限可使用备用本地包',
            'uiv.extension.badgeChrome': 'Chrome 商店',
            'uiv.extension.badgeEdge': 'Edge 商店',
            'uiv.extension.openChromeStore': '🌐 前往 Chrome 商店官方安装',
            'uiv.extension.openEdgeStore': '🌐 前往 Edge 商店官方安装',
            'uiv.extension.switchToChrome': '切换 Chrome 商店',
            'uiv.extension.switchToEdge': '切换 Edge 商店',
            'uiv.extension.downloadFallbackBtn': '📦 备用：本地下载 (.zip)',
            'uiv.extension.badgeMethod1': '推荐',
            'uiv.extension.method1Title': '官方商店安装（1 步搞定）',
            'uiv.extension.method1Desc1': '点击上方大按钮进入官方商店，点击<b>「添加至 Chrome」</b>（Edge 浏览器为<b>「获取」</b>）即可安装。',
            'uiv.extension.method1Desc2': '安装后在浏览器右上角 🧩 栏<b>钉选 UI.Vision</b>，建议右键插件详情开启<b>「允许访问文件网址」</b>。',
            'uiv.extension.badgeMethod2': '备用',
            'uiv.extension.method2Title': '本地离线安装（无法访问商店时）',
            'uiv.extension.method2Desc1': '点击上方「备用：本地下载」获取 <code>uivision-extension-9.6.1.zip</code> 并解压到本地文件夹。',
            'uiv.extension.method2Desc2': '地址栏打开扩展管理并开启右上角<b>「开发者模式」</b>：',
            'uiv.extension.method2Desc3': '点击左上角<b>「加载已解压的扩展程序」</b>，选中解压出的文件夹即可。',
            'uiv.extension.copyChrome': '📋 复制 chrome://extensions/',
            'uiv.extension.copyEdge': '📋 复制 edge://extensions/',
            'uiv.extension.copyGuideBtn': '📋 复制安装指南文本',
            'uiv.extension.doneBtn': '我已安装完成',
            'uiv.extension.toastDownloading': '⚡ UI.Vision v9.6.1 本地插件包下载已触发！',
            'uiv.extension.toastOpeningStore': '🌐 正在打开官方扩展商店...',
            'uiv.extension.toastStoreSwitched': '已切换为 {store} 商店',
            'uiv.extension.copySuccess': '✅ 扩展管理地址已复制到剪贴板！',
            'uiv.extension.stepsCopied': '✅ 安装指南已复制到剪贴板！',
            'uiv.extension.tip': '💡 <b>小提示</b>：安装完成后，回到数据抓取工作台点击左侧智能调度仓库底部的<b>「🚀 运行批脚本」</b>，即可直接驱动 UI.Vision 插件自动化抓取与执行！',

            // Site script picker
            'uiv.siteScript.title': '选择要复制脚本的站点',
            'uiv.siteScript.subtitle': '受浏览器同源策略限制，请选择你稍后要打开并粘贴脚本的站点。',
            'uiv.siteScript.notice': '浮窗模式不会逐个下载 CSV。抓取完成后可按指标查看详表，并将全部 CSV 一次打包下载为 ZIP。',
            'uiv.siteScript.unresolved': '另有 {count} 个脚本无法识别站点，暂未列出。请先在脚本中补充请求 URL。',
            'uiv.siteScript.empty': '当前执行范围内没有识别到可用站点。<br>请检查仓库脚本的请求 URL 或分类范围设置。',
            'uiv.siteScript.scriptCount': '{count} 个可执行脚本',
            'uiv.siteScript.simulate': '模拟浮窗',
            'uiv.siteScript.copy': '复制此站点',
            'uiv.siteScript.close': '关闭',
            'uiv.siteScript.noScope': '❌ 当前分类或执行范围内没有可导出的脚本',
            'uiv.siteScript.noSite': '❌ 站点 {site} 下没有可导出的脚本',
            'uiv.siteScript.copied': '✅ 已复制 {name} 的 F12 脚本（{count} 个任务{dep}）',
            'uiv.siteScript.depText': '，自动补入 {count} 个跨表依赖',
            'uiv.siteScript.copyFail': '❌ 复制站点脚本失败：{error}',
            'uiv.siteScript.readFail': '❌ 读取站点脚本失败：{error}',

            // AI Scraper Adapter
            'uiv.aiAdapter.title': 'AI 全网站抓取适配器',
            'uiv.aiAdapter.subtitle': 'AI 分析请求和响应结构；匹配 DataFab / NetCare 时自动复用现有成熟逻辑，其他结构使用通用受控模板。',
            'uiv.aiAdapter.close': '关闭',
            'uiv.aiAdapter.step1': '1. 粘贴 DevTools → Copy as fetch',
            'uiv.aiAdapter.parseBtn': '解析并自动填充请求',
            'uiv.aiAdapter.parseSummary': '解析过程只读取静态 fetch 配置，不执行粘贴的代码。',
            'uiv.aiAdapter.step2': '2. 粘贴 DevTools → Copy response',
            'uiv.aiAdapter.keywordLabel': '抓取关键词（可选，用于聚焦响应中的某一组数据）',
            'uiv.aiAdapter.keywordPh': '例如 c10_topN、records、风险列表',
            'uiv.aiAdapter.keywordSummary': '不填写关键词时，AI 会分析完整响应样本。',
            'uiv.aiAdapter.advanced': '高级编辑：检查或修正自动解析结果',
            'uiv.aiAdapter.reqUrl': '请求 URL',
            'uiv.aiAdapter.openUrl': '抓取前打开页面 URL（可选）',
            'uiv.aiAdapter.method': '请求方法',
            'uiv.aiAdapter.bodyType': '请求体类型',
            'uiv.aiAdapter.bodyTypeJson': 'JSON',
            'uiv.aiAdapter.bodyTypeForm': 'URL 编码表单',
            'uiv.aiAdapter.bodyTypeNone': '无请求体',
            'uiv.aiAdapter.pagination': '分页策略',
            'uiv.aiAdapter.paginationAuto': '自动识别（默认）',
            'uiv.aiAdapter.paginationNone': '强制不分页，只抓当前结果',
            'uiv.aiAdapter.credentials': '凭据模式',
            'uiv.aiAdapter.outputFileName': '输出文件名',
            'uiv.aiAdapter.authStrategy': '认证来源',
            'uiv.aiAdapter.authAuto': '让 AI 判断',
            'uiv.aiAdapter.authCookie': '浏览器 Cookie',
            'uiv.aiAdapter.authCookieHeader': 'Cookie 值注入请求头（CSRF）',
            'uiv.aiAdapter.authLocalStorage': 'localStorage',
            'uiv.aiAdapter.authSessionStorage': 'sessionStorage',
            'uiv.aiAdapter.authNone': '无需认证',
            'uiv.aiAdapter.authSourceKey': 'Token/Cookie 来源键',
            'uiv.aiAdapter.authSourceKeyPh': 'access_token 或 XSRF-TOKEN',
            'uiv.aiAdapter.authValuePath': '存储值中的 Token 路径（可选）',
            'uiv.aiAdapter.authValuePathPh': '例如 data.accessToken',
            'uiv.aiAdapter.authHeader': '认证请求头',
            'uiv.aiAdapter.authPrefix': '认证前缀',
            'uiv.aiAdapter.headersLabel': '请求头 JSON（敏感值发送给 AI 前会自动脱敏）',
            'uiv.aiAdapter.bodyLabel': '请求负载 JSON',
            'uiv.aiAdapter.secondResponseLabel': '第二页或空页响应 JSON（可选，用于辅助判断分页）',
            'uiv.aiAdapter.guardrail': '支持 JSON/URL 编码表单、GET/POST、数字/offset/游标分页、GraphQL JSON、Cookie/浏览器存储认证及对象/原始值/二维数组。认证请求头来源未知时，生成脚本会在目标页面本地依次尝试 Cookie、localStorage、sessionStorage 和页面 Token 字段。只有结构高置信匹配才复用成熟引擎；非官方域名不会调用 DataFab / NetCare 专属接口。验证码、动态签名、文件上传和 HTML 页面抓取暂不开放。',
            'uiv.aiAdapter.waitingStart': '等待开始分析',
            'uiv.aiAdapter.stepValidate': '校验输入',
            'uiv.aiAdapter.stepSample': '抽样脱敏',
            'uiv.aiAdapter.stepModel': '模型分析',
            'uiv.aiAdapter.stepVerify': '路径验证',
            'uiv.aiAdapter.previewDefault': '填写请求和响应样本后，点击“AI 分析并验证”。',
            'uiv.aiAdapter.cancel': '取消',
            'uiv.aiAdapter.analyzeBtn': 'AI 分析并验证',
            'uiv.aiAdapter.generateBtn': '生成智能复用脚本',
            'uiv.aiAdapter.choiceTitle': '选择关键词所在的数据片段',
            'uiv.aiAdapter.choiceSubtitle': '响应里多处命中该关键词，请选择要抓取的那一组 JSON 链条。',
            'uiv.aiAdapter.pulseSample': '正在抽样脱敏并准备模型输入…',
            'uiv.aiAdapter.pulseModel': 'AI 正在分析请求与响应结构…',
            'uiv.aiAdapter.pulseWait': '模型仍在分析，正在耐心等待…',
            'uiv.aiAdapter.fetchSourceEmpty': '请先粘贴 Copy as fetch 内容',
            'uiv.aiAdapter.parsingFetch': '正在安全解析 fetch 请求…',
            'uiv.aiAdapter.fetchParsed': 'fetch 已解析。粘贴响应后即可让 AI 分析。',
            'uiv.aiAdapter.parsed': '已解析：',
            'uiv.aiAdapter.headerCount': '{count} 个请求头',
            'uiv.aiAdapter.sensitiveHeadersWarning': '发现敏感请求头：{headers}，发送给 AI 前会脱敏。',
            'uiv.aiAdapter.keywordNeedValidJson': '请先粘贴合法响应 JSON，才能查找关键词。',
            'uiv.aiAdapter.keywordNotFound': '响应样本中未找到关键词“{keyword}”。',
            'uiv.aiAdapter.keywordFoundMultiple': '找到 {count} 处关键词“{keyword}”，请选择要抓取的数据片段。',
            'uiv.aiAdapter.keywordFocused': '已聚焦：{focus}；命中位置：{hit}',
            'uiv.aiAdapter.matchFieldName': '字段名',
            'uiv.aiAdapter.matchFieldValue': '字段值',
            'uiv.aiAdapter.hitPos': '命中位置',
            'uiv.aiAdapter.focusSegment': '聚焦片段',
            'uiv.aiAdapter.rootNode': '(根节点)',
            'uiv.aiAdapter.validatingInput': '正在校验输入…',
            'uiv.aiAdapter.logLocalValidateStart': '开始本地校验输入 JSON。',
            'uiv.aiAdapter.validatingInputJson': '正在校验输入 JSON…',
            'uiv.aiAdapter.validatedInput': '输入校验完成，准备安全分析…',
            'uiv.aiAdapter.logLocalValidatePass': '本地校验通过，准备发送到后端分析。',
            'uiv.aiAdapter.sentToBackend': '已发送到后端，正在抽样、脱敏并调用 AI…',
            'uiv.aiAdapter.modelDoneVerifying': '模型分析完成，正在验证路径…',
            'uiv.aiAdapter.backendDoneRendering': '后端分析完成，正在渲染结果。',
            'uiv.aiAdapter.analyzeDoneFallback': '分析完成（已启用安全兜底）',
            'uiv.aiAdapter.analyzeDoneOk': '分析与路径验证完成',
            'uiv.aiAdapter.statusAnalyzePassed': '分析与样本验证通过，可以生成脚本。',
            'uiv.aiAdapter.needAnalyzeFirst': '请先完成 AI 分析。',
            'uiv.aiAdapter.toastNativeSuccess': '✅ 已使用 {profile} 成熟逻辑 + AI 适配生成脚本，请先单脚本验证。',
            'uiv.aiAdapter.toastGenericSuccess': '✅ 通用 AI 适配脚本已生成，请先单脚本验证后再加入批量仓库。',
            'uiv.aiAdapter.fail': '失败',

            // Script analysis modal
            'uiv.analysis.title': '脚本仓库分析',
            'uiv.analysis.reading': '正在读取脚本仓库...',
            'uiv.analysis.summary': '共 {total} 条脚本 · DataFab {datafab} · NetCare {netcare} · 当前显示 {current}',
            'uiv.analysis.searchPh': '搜索分类、脚本、URL、字段...',
            'uiv.analysis.allCategories': '全部分类',
            'uiv.analysis.saveChanges': '保存修改',
            'uiv.analysis.refresh': '刷新',
            'uiv.analysis.thCategory': '分类',
            'uiv.analysis.thName': '脚本名称',
            'uiv.analysis.thOutput': '生成表名称',
            'uiv.analysis.thUrl': '请求 URL',
            'uiv.analysis.thUpdated': '更新时间',
            'uiv.analysis.thPlatform': '平台',
            'uiv.analysis.thRequest': '请求',
            'uiv.analysis.thCore': '核心对象',
            'uiv.analysis.thFilters': '筛选字段',
            'uiv.analysis.thOptions': '运行开关',
            'uiv.analysis.thResponse': '响应取表',
            'uiv.analysis.thRefill': '回填状态',
            'uiv.analysis.thActions': '操作',
            'uiv.analysis.empty': '等待分析...',
            'uiv.analysis.noMatches': '没有匹配的脚本',
            'uiv.analysis.footer': '双击行可回填；点击筛选字段可改值，点击 × 可删除字段；保存前关闭窗口会提示先保存。',
            'uiv.analysis.copyModified': '复制修改后脚本',
            'uiv.analysis.saveAsNew': '另存为新脚本',
            'uiv.analysis.deleteScript': '删除脚本',
            'uiv.analysis.modifiedTag': '已修改，待保存',
            'uiv.analysis.payloadOk': 'Payload可还原',
            'uiv.analysis.payloadLegacy': '旧脚本无Payload',
            'uiv.analysis.configOk': '开关可还原',
            'uiv.analysis.configCode': '开关靠代码识别',
            'uiv.analysis.copyCellTitle': '点击复制内容',
            'uiv.analysis.optGlobalVars': '全局变量',
            'uiv.analysis.optPagination': '翻页',
            'uiv.analysis.optForceSum': '强制总数',
            'uiv.analysis.optAutoCpc': '动态CPC/NID',
            'uiv.analysis.optAutoMonth': '双月',
            'uiv.analysis.optTriplicate': '三区阵列',
            'uiv.analysis.switchOn': '开',
            'uiv.analysis.switchOff': '关',
            'uiv.analysis.noFilters': '未识别到筛选字段',
            'uiv.analysis.noCore': '脚本中未识别到核心对象',
            'uiv.analysis.otherEmptyFilters': '另{count}个空值字段',
            'uiv.analysis.emptyValue': '空值',
            'uiv.analysis.empty': '空',
            'uiv.analysis.itemCount': ' · 共{count}项',
            'uiv.analysis.saveChangesCount': '保存修改 ({count})',
            'uiv.analysis.copySuccess': '已复制: {text}',
            'uiv.analysis.copyFail': '复制失败',
            'uiv.analysis.savedCount': '已保存 {count} 个修改脚本',
            'uiv.analysis.noScriptsToSave': '没有需要保存的脚本',
            'uiv.analysis.saveFail': '保存修改失败',
            'uiv.analysis.deleteTitle': '删除脚本',
            'uiv.analysis.deleteConfirm': '确定删除脚本 [{name}] 吗？\n删除后会从脚本仓库中移除。',
            'uiv.analysis.deletedToast': '已删除脚本：{name}',
            'uiv.analysis.deleteFail': '删除脚本失败',
            'uiv.analysis.saveAsTitle': '另存为新脚本',
            'uiv.analysis.saveAsMessage': '为当前脚本副本命名并选择保存分类。当前分析窗口里的待修改筛选字段也会一并带入新脚本。',
            'uiv.analysis.saveAsConfirm': '另存为',
            'uiv.analysis.saveAsSuccess': '已另存为新脚本：{name}',
            'uiv.analysis.saveAsFail': '另存为新脚本失败',
            'uiv.analysis.nameRequired': '请填写新脚本名称',
            'uiv.analysis.nameExists': '脚本名称已存在，请换一个名称',
            'uiv.analysis.unsavedTitle': '修改尚未保存',
            'uiv.analysis.unsavedMessage': '还有 {count} 个脚本修改未保存。\n保存后再关闭窗口，避免修改丢失。',
            'uiv.analysis.unsavedSaveClose': '保存后关闭',
            'uiv.analysis.refreshTitle': '刷新分析数据',
            'uiv.analysis.refreshMessage': '当前有未保存修改，刷新会丢失这些修改。\n确定继续刷新吗？',
            'uiv.analysis.refreshConfirm': '继续刷新',
            'uiv.analysis.confirm': '确认',
            'uiv.analysis.cancel': '取消',
            'uiv.analysis.apply': '应用修改',
            'uiv.analysis.defaultCategory': '默认分类',
            'uiv.analysis.editFilterTitle': '编辑筛选字段',
            'uiv.analysis.deleteFilterTitle': '删除筛选字段',
            'uiv.analysis.deleteFilterConfirm': '确定删除筛选字段 [{key}] 吗？\n保存前只会影响当前分析窗口里的待保存版本。',
            'uiv.analysis.deleteFilterBtn': '删除字段',
            'uiv.analysis.copiedModifiedScript': '修改后脚本已复制'
        },
        'en-US': {
            'uiv.title': 'UIVF12 Data Capture Engine v6.6 - Tools Platform',
            'uiv.description': 'UI.Vision capture engine, automation script center, and cloud script repository.',
            'uiv.header.title': '🚀 Automation Script Center',
            'uiv.version.loading': 'v loading',
            'uiv.version.unmarked': 'v unmarked',
            'uiv.version.title': 'Latest frontend asset version: {version}',
            'uiv.version.missing': 'No frontend asset version detected',
            'uiv.header.tag': 'Multi-source Fusion + Formula Authority',
            'uiv.repo.title': '📂 Smart Repository',
            'uiv.repo.copyAll': 'Package All',
            'uiv.repo.copyAllTitle': 'Copy all scripts from every repository category',
            'uiv.repo.tip': 'Collapsed by default. <b>Double-click to refill the workbench</b>.',
            'uiv.repo.mode': 'Repository source mode:',
            'uiv.source.auto': 'Auto Mode',
            'uiv.source.json': 'JSON',
            'uiv.source.sqlite': 'Force SQLite',
            'uiv.source.script': 'Script source: {source}',
            'uiv.source.category': 'Category source: {source}',
            'uiv.source.initialNote': 'The real read source appears here after the repository loads.',
            'uiv.source.currentNote': 'Current mode: {mode} · The page renders the active source directly for migration checks.',
            'uiv.repo.newCategory': '[+] New Custom Category',
            'uiv.repo.copyBatch': '📦 Copy All as Batch Array (F12)',
            'uiv.repo.copyBatchUiv': '📦 Copy All as Batch Array (UI.V)',
            'uiv.repo.runBatchUiv': '🚀 Run Batch',
            'uiv.repo.runTestBatchUiv': '🚀 Test Batch',
            'uiv.repo.siteConsolePlaceholder': '📋 Floating Panel Script',
            'uiv.repo.siteConsoleTitle': 'Choose a target site and copy its F12 console script',
            'uiv.repo.batchSpeedTitle': 'Current {speed}x speed: script interval is about {seconds}s. Click to switch 1x / 2x / 4x.',
            'uiv.repo.batchSpeedToast': 'UI.Vision batch speed switched to {speed}x, script interval about {seconds}s',
            'uiv.repo.batchTenantWarning': '⚠️ Do not switch tenants until this capture batch and its automatic import are complete, or the results may be imported into another tenant.',
            'uiv.repo.batchTenantCompletionWarning': 'Capture is complete, but automatic import is still pending. Keep the current tenant selected until the data import page finishes.',
            'uiv.repo.export': '📤 Export Scripts',
            'uiv.repo.import': '📥 Import Scripts',
            'uiv.input.urlLabel': '1. Request URL target:',
            'uiv.preset.datafab': '🟢 DataFab - Detail List',
            'uiv.preset.netcareCn': '🔴 NetCare - China Node',
            'uiv.preset.netcareAe': '🔵 NetCare - Middle East Node',
            'uiv.preset.netcareDe': '🟠 NetCare - Germany Node',
            'uiv.preset.custom': '⚙️ Custom URL...',
            'uiv.urlAssist.custom': 'Custom URL',
            'uiv.urlAssist.detected': 'Auto-detected: {category}',
            'uiv.urlAssist.matches': '{count} repository URL matches',
            'uiv.input.payloadLabel': '2. Request Payload (JSON):',
            'uiv.input.payloadHint': 'Paste, then format when ready',
            'uiv.input.responseSampleLabel': '3. Response Sample (JSON):',
            'uiv.input.responseSampleHint': 'Optional. Identify multiple tables & focus extraction',
            'uiv.input.responseSamplePlaceholder': 'Optional: Paste JSON response sample. Focus on a specific table when response contains multiple tables (e.g., Rep Office)',
            'uiv.focus.badge': 'Data Focus',
            'uiv.focus.singleTable': 'Located unique table: {name} ({count} rows)',
            'uiv.focus.multipleTables': 'Detected {count} tables. Select one or focus by keyword',
            'uiv.focus.keywordMatched': 'Keyword "{keyword}" matched: {name} ({path})',
            'uiv.focus.keywordMultiple': 'Keyword "{keyword}" matched {count} tables. Click to choose',
            'uiv.focus.keywordNone': 'Keyword "{keyword}" did not match table names; deep search will be used',
            'uiv.focus.selectedInfo': 'Focused: {name} (path: {path}, {count} rows)',
            'uiv.focus.chooseTable': '📋 Select Table',
            'uiv.focus.chooseTableMulti': '⚠️ Select Table ({count} matched)',
            'uiv.focus.multiCandidatePrompt': '⚠️ Keyword "{keyword}" matched {count} candidate tables. Please choose which table to extract:',
            'uiv.focus.multiCandidateSpecified': '✅ Selected from {count} candidate tables: [Table {index}] {name}',
            'uiv.focus.modalTitle': '🎯 Select Target Table to Scrape',
            'uiv.focus.modalSubtitle': 'Multiple tables or data segments were detected in the response. Select the table to extract:',
            'uiv.focus.modalMultiSubtitle': '⚠️ Keyword "{keyword}" was found in {count} candidate tables. Please click to select your target table:',
            'uiv.focus.matchedBadge': '🎯 Matched Keyword',
            'uiv.focus.unmatchedBadge': '⚪ Unmatched',
            'uiv.focus.keywordPlaceholder': 'Scraping keyword (optional, e.g. rep offic, Region)',
            'uiv.focus.clearTitle': 'Clear data focus',
            'uiv.focus.closeModal': 'Close',
            'uiv.focus.activeLog': '🎯 Data focus active: {detail}',
            'uiv.sampleGuide.badgeText': 'Formats & Examples',
            'uiv.sampleGuide.badgeTitle': 'Hover to view supported formats and interactive examples (1-click fill)',
            'uiv.sampleGuide.popoverTitle': 'Response Sample Format Guide & Data Focus',
            'uiv.sampleGuide.popoverTag': 'Capabilities & Limits',
            'uiv.sampleGuide.popoverDesc': 'Paste a real JSON response from DevTools. The tool automatically detects all data tables and chart components. When multiple tables exist (overview, regional summary, rep office details), you can set a keyword or pick a target table to ensure accurate extraction.',
            'uiv.sampleGuide.descDatafab': 'Auto-detects component fields, row counts, and samples. Supports focusing on specific tables (e.g. rep office) by keyword or index.',
            'uiv.sampleGuide.descStandard': 'Extracts all object keys as headers. Suitable for general REST API list responses.',
            'uiv.sampleGuide.descNested': 'Recursively scans deep arrays and maps extraction paths, supporting nested pagination objects.',
            'uiv.sampleGuide.capTitle': 'Key Capabilities:',
            'uiv.sampleGuide.capList': 'Multi-table discovery, field parsing, keyword scoring, conflict guidance, and summary row fusion.',
            'uiv.sampleGuide.limitTitle': 'Limitations:',
            'uiv.sampleGuide.limitList': 'Must be valid JSON; does not support raw HTML, binary streams, encrypted payloads, or CAPTCHA-protected APIs.',
            'uiv.sampleGuide.exampleLabel': '✨ Dynamic Structure Examples (Test with 1-click):',
            'uiv.sampleGuide.tabDatafab': 'DataFab Multi-Component',
            'uiv.sampleGuide.tabStandard': 'Standard Array',
            'uiv.sampleGuide.tabNested': 'Nested Pagination',
            'uiv.sampleGuide.fillBtn': '⚡ Fill Current Example to Input',
            'uiv.sampleGuide.copyBtn': '📋 Copy Example JSON',
            'uiv.sampleGuide.toastFilled': '✅ Sample filled and parsed successfully!',
            'uiv.sampleGuide.toastCopied': '✅ Sample JSON copied to clipboard!',
            'uiv.input.filePlaceholder': 'File prefix, for example: PBI_Office_Data',
            'uiv.input.fileGuideBadge': 'AI Naming',
            'uiv.input.fileGuideTitle': 'Editable before or after generation',
            'uiv.input.fileGuideText': 'Saving syncs the repository script and exported CSV names',
            'uiv.input.fileAiBadge': 'AI Bilingual Names',
            'uiv.input.fileAiBadgeLoading': 'AI Naming',
            'uiv.input.fileAiAnalyzing': 'Analyzing script purpose',
            'uiv.input.fileAiAnalyzingHint': 'Creating concise Chinese and English names...',
            'uiv.input.fileAiApplied': 'Bilingual name applied',
            'uiv.input.fileAiSuggestionsReady': 'AI suggestions are ready',
            'uiv.input.fileAiKeptManual': 'Your manual edit was kept; click a suggestion to replace it',
            'uiv.input.fileAiUnavailable': 'AI naming is unavailable',
            'uiv.input.fileAiUnavailableHint': 'Manual naming still works and saving is unaffected',
            'uiv.input.fileAiUseZh': 'Use Chinese name',
            'uiv.input.fileAiUseEn': 'Use English name',
            'uiv.option.globalVars': 'Inject global variables',
            'uiv.option.pagination': 'Loop pagination',
            'uiv.option.forceSum': 'Force summary fallback',
            'uiv.option.cpc': 'Dynamically fetch CPC / NID',
            'uiv.option.runtimeMonth': 'Enable runtime current + previous month split',
            'uiv.option.netcareTriplicate': '🌍 Auto-generate NetCare three-region script array when saving',
            'uiv.action.format': '🔍 Format',
            'uiv.action.clear': '🗑️ Clear',
            'uiv.action.generate': '⚡ Generate Production Script',
            'uiv.action.aiAdaptAll': '✨ AI Adapt Any Website',
            'uiv.output.uivLabel': '🤖 Production UI.Vision macro:',
            'uiv.output.save': '💾 Add to Sidebar',
            'uiv.output.copyUiv': '📋 Copy UIV',
            'uiv.output.uivPlaceholder': 'Generated UI.Vision macro appears here...',
            'uiv.output.consoleLabel': '💻 Browser console script (F12):',
            'uiv.output.copyConsole': '📋 Copy Console',
            'uiv.output.consolePlaceholder': 'Generated browser F12 script appears here...',
            'uiv.log.title': '📋 Generation Log',
            'uiv.log.clear': 'Clear',
            'uiv.log.waiting': 'Waiting for generation...',
            'uiv.log.busy': '⏳ Generating...',
            'uiv.log.ok': '✅ Generated',
            'uiv.log.err': '❌ Failed',
            'uiv.log.done': 'Script generation complete!',
            'uiv.category.netcareCn': 'NetCare China',
            'uiv.category.netcareAe': 'NetCare Middle East',
            'uiv.category.netcareDe': 'NetCare Germany',
            'uiv.category.default': 'Default Category',
            'uiv.category.empty': '(Empty) Drag scripts here',
            'uiv.category.copyTitle': 'Package only this category',
            'uiv.category.deleteTitle': 'Delete this category',
            'uiv.script.itemTitle': 'Double-click to refill the workbench',
            'uiv.script.renameAction': 'Rename',
            'uiv.script.renameTitle': 'Rename script: {name}',
            'uiv.script.renamePrompt': 'Enter new script name:',
            'uiv.renameDialog.eyebrow': 'Script Management · Rename',
            'uiv.renameDialog.title': 'Rename Script',
            'uiv.renameDialog.message': 'Modify the script name in the smart repository without affecting automation execution or historical data associations.',
            'uiv.renameDialog.label': 'New Script Name',
            'uiv.renameDialog.placeholder': 'Enter new script name',
            'uiv.renameDialog.hint': 'Letters, numbers, underscores, and Chinese characters are supported',
            'uiv.renameDialog.cancel': 'Cancel',
            'uiv.renameDialog.confirm': '💾 Confirm Rename',
            'uiv.renameDialog.required': 'Please enter a script name first',
            'uiv.renameDialog.duplicate': 'A script with the same name already exists in this category. Choose another name.',
            'uiv.toast.scriptRenamed': '✅ Script renamed to [{name}]',
            'uiv.toast.scriptRenamedWithRules': '✅ Script renamed to [{name}] and synced {count} data import rule(s)',
            'uiv.toast.renameFail': '❌ Rename failed',
            'uiv.save.autoCategory': '📂 Auto Category',
            'uiv.save.categorySelectTitle': 'Select target category to save (default: auto detect, saved in browser)',
            'uiv.script.deleteAction': 'Delete',
            'uiv.script.deleteTitle': 'Delete script: {name}',
            'uiv.deleteDialog.eyebrow': 'Dangerous Action',
            'uiv.deleteDialog.title': 'Delete this script?',
            'uiv.deleteDialog.message': 'Once deleted, this script will be removed from the repository and cannot be recovered.',
            'uiv.deleteDialog.cancel': 'Keep Script',
            'uiv.deleteDialog.confirm': 'Delete',
            'uiv.categoryDeleteDialog.eyebrow': 'Dangerous Action · Batch Delete',
            'uiv.categoryDeleteDialog.title': 'Delete this category?',
            'uiv.toast.serverFail': '❌ Cannot connect to the server; script repository failed to load',
            'uiv.toast.moveFail': '❌ Failed to move category',
            'uiv.toast.filled': '✅ [{name}] configuration refilled!',
            'uiv.copy.consoleScript': 'Console Script',
            'uiv.alert.legacyScript': '⚠️ Legacy script. Please regenerate and overwrite-save it.',
            'uiv.confirm.deleteScript': 'Delete [{name}]?',
            'uiv.toast.scriptDeleted': '✅ Script deleted',
            'uiv.toast.deleteFail': '❌ Delete failed',
            'uiv.prompt.newCategory': 'New category name:',
            'uiv.categoryDialog.eyebrow': 'Smart repository',
            'uiv.categoryDialog.title': 'Create custom category',
            'uiv.categoryDialog.message': 'Choose a clear name for this script group. You can drag scripts into it later.',
            'uiv.categoryDialog.label': 'Category name',
            'uiv.categoryDialog.placeholder': 'For example: Monthly automation',
            'uiv.categoryDialog.hint': 'Letters, numbers, and Chinese characters are supported',
            'uiv.categoryDialog.count': '{count}/{max}',
            'uiv.categoryDialog.cancel': 'Cancel',
            'uiv.categoryDialog.confirm': '✨ Create category',
            'uiv.categoryDialog.required': 'Enter a category name first',
            'uiv.categoryDialog.duplicate': 'This category already exists. Choose another name.',
            'uiv.toast.categoryCreated': '✅ Category created',
            'uiv.toast.createFail': '❌ Create failed',
            'uiv.confirm.deleteCategory': 'Delete category [{name}]?\nAll scripts under this category will also be deleted.',
            'uiv.toast.categoryDeleted': '✅ Category deleted',
            'uiv.alert.emptyExport': '⚠️ The script repository is empty; there are no scripts to export.',
            'uiv.export.filename': 'UIVision_Script_Repository_{date}.json',
            'uiv.toast.exported': '✅ Scripts and custom categories exported!',
            'uiv.toast.exportFail': '❌ Export failed',
            'uiv.alert.invalidBackup': '❌ Invalid script import file',
            'uiv.confirm.importMode': '📦 Script file loaded!\n\nOK: merge and replace scripts with matching names\nCancel: clear and replace the current script repository',
            'uiv.toast.imported': '✅ Scripts and custom categories imported!',
            'uiv.alert.importFail': '❌ Import failed: script file parsing error.',
            'uiv.copy.noCode': '⚠️ There is no code to copy.',
            'uiv.copy.successButton': '✅ Done',
            'uiv.copy.toast': '✅ {type} copied to clipboard!',
            'uiv.copy.memoryToast': '✅ [{type}] copied!',
            'uiv.copy.allGroup': 'Full Repository',
            'uiv.copy.fetchFail': '❌ Unable to fetch script list',
            'uiv.copy.emptyGroup': '⚠️ This category has no executable scripts.',
            'uiv.copy.batchType': '[{group}] Batch Array (F12)',
            'uiv.copy.batchTypeUiv': '[{group}] Batch Array (UI.V)',
            'uiv.copy.noUivBatch': '⚠️ No packageable UI.Vision scripts in the repository. Regenerate and save scripts first.',
            'uiv.workbench.badJson': 'Invalid JSON. Check punctuation or bracket matching.',
            'uiv.save.needGenerate': '⚠️ Generate a script before saving.',
            'uiv.save.defaultFile': 'PBI_Auto_Capture',
            'uiv.save.conflictMany': '{count} scripts with the same name were found, including split regional copies. Overwrite all?',
            'uiv.save.conflictOne': 'A script named [{name}] already exists. Overwrite it?',
            'uiv.save.toastTriplicate': '✅ {count} scripts distributed to the three regions!',
            'uiv.save.toastSaved': '✅ Script saved to repository!',
            'uiv.save.btnTriplicate': '✅ Array Distributed',
            'uiv.save.btnSaved': '✅ Saved',
            'uiv.save.noCompression': '❌ Save failed, and this browser does not support compressed retry',
            'uiv.save.retryTriplicate': '✅ {count} scripts saved through compressed retry!',
            'uiv.save.retrySaved': '✅ Script saved through compressed retry!',
            'uiv.save.retryFail': '❌ Save failed; compressed retry also failed',
            'uiv.generator.needPayload': 'Provide a valid Payload JSON first.',
            'uiv.generator.needPayloadLog': 'Payload is empty. Format the input first.',
            'uiv.generator.engineStart': 'Engine start · UIVF12 {version}',
            'uiv.generator.targetPlatform': 'Target platform: {platform}  |  URL: {url}',
            'uiv.generator.payloadSection': 'Payload Parsing',
            'uiv.generator.netcareSummary': 'NetCare mode: injected need_summary=true',
            'uiv.generator.detectedPlaceholder': '✅ Detected and converted to a dynamic placeholder',
            'uiv.generator.notDetected': 'Not detected',
            'uiv.generator.cpcPoint': 'CPC insertion point: {state}',
            'uiv.generator.nidPoint': 'NID insertion point: {state}',
            'uiv.generator.monthSplit': 'Month split: {state}',
            'uiv.generator.monthEnabled': '✅ Enabled [{mode}]',
            'uiv.generator.monthDual': 'current + previous month dual-span run',
            'uiv.generator.monthSingle': 'single-period mode',
            'uiv.generator.off': 'Off',
            'uiv.generator.paramsSection': 'Parameter Extraction',
            'uiv.generator.notFound': '(not found)',
            'uiv.generator.missingPageId': '⚠️ Warning: pageId is missing. Auto-sniffing code was generated.',
            'uiv.generator.outputFile': 'Output file: {name}',
            'uiv.generator.switchSection': 'Switch Configuration Check',
            'uiv.generator.on': 'On',
            'uiv.generator.offStatic': 'Off — static placeholders',
            'uiv.generator.offFirstPage': 'Off — first response page only',
            'uiv.generator.onMissingComp': 'On, but compId is missing and it may fail',
            'uiv.generator.onMonthRange': 'On (current + previous month)',
            'uiv.generator.globalVars': 'Global variable injection: {state}',
            'uiv.generator.pagination': 'Pagination loop: {state}',
            'uiv.generator.forceSum': 'Independent summary fallback: {state}',
            'uiv.generator.runtimeMonth': 'Runtime month split: {state}',
            'uiv.generator.buildSection': 'Script Build',
            'uiv.generator.scriptTitle': 'Script title: {title}',
            'uiv.generator.auth': 'Platform auth: {auth}',
            'uiv.generator.cookieAuth': 'CSRF-Token (auto from cookie)',
            'uiv.generator.localAuth': 'localStorage globalConfig CSRF',
            'uiv.generator.aiAuth': 'AI adapter auth ({strategy})',
            'uiv.generator.syntaxFail': 'Generated script syntax validation failed: {message}',
            'uiv.generator.outputReady': 'Script content written to output areas. UIV + F12 Console are ready.',
            'uiv.extension.btnText': 'Install UI.Vision',
            'uiv.extension.btnTitle': 'Install UI.Vision RPA from official store or download offline package & view guide',
            'uiv.extension.sidebarLink': '🧩 Install UI.Vision (Official Recommended)',
            'uiv.extension.outputTip': '💡 UI.Vision RPA extension not installed? Click for official 1-click install or offline package',
            'uiv.extension.modalEyebrow': 'Official Extension · Quick Setup',
            'uiv.extension.modalTitle': '🧩 UI.Vision RPA Download & Setup Guide',
            'uiv.extension.modalSubtitle': 'Official web stores recommended · Supports Chrome & Edge',
            'uiv.extension.downloadCardTitle': 'UI.Vision RPA Official Extension',
            'uiv.extension.downloadCardMeta': 'Click the button to install in 1 click from official store; local zip available as backup',
            'uiv.extension.badgeChrome': 'Chrome Store',
            'uiv.extension.badgeEdge': 'Edge Store',
            'uiv.extension.openChromeStore': '🌐 Install from Chrome Web Store',
            'uiv.extension.openEdgeStore': '🌐 Install from Edge Add-ons Store',
            'uiv.extension.switchToChrome': 'Switch to Chrome Store',
            'uiv.extension.switchToEdge': 'Switch to Edge Store',
            'uiv.extension.downloadFallbackBtn': '📦 Backup: Local Download (.zip)',
            'uiv.extension.badgeMethod1': 'Recommended',
            'uiv.extension.method1Title': 'Official Store Install (1-Step Setup)',
            'uiv.extension.method1Desc1': 'Click the button above to open official store, then click <b>"Add to Chrome"</b> (or <b>"Get"</b> in Edge) to install.',
            'uiv.extension.method1Desc2': 'Pin 🧩 <b>UI.Vision</b> to your toolbar, and toggle on <b>"Allow access to file URLs"</b> in extension details.',
            'uiv.extension.badgeMethod2': 'Backup',
            'uiv.extension.method2Title': 'Local Offline Package (When Store is Blocked)',
            'uiv.extension.method2Desc1': 'Click "Backup: Local Download" to save <code>uivision-extension-9.6.1.zip</code> and extract to a permanent local folder.',
            'uiv.extension.method2Desc2': 'Open extension management page and toggle ON <b>"Developer mode"</b>:',
            'uiv.extension.method2Desc3': 'Click <b>"Load unpacked"</b> and select the extracted folder.',
            'uiv.extension.copyChrome': '📋 Copy chrome://extensions/',
            'uiv.extension.copyEdge': '📋 Copy edge://extensions/',
            'uiv.extension.copyGuideBtn': '📋 Copy Setup Guide',
            'uiv.extension.doneBtn': 'Done & Close',
            'uiv.extension.toastDownloading': '⚡ UI.Vision v9.6.1 offline zip download started!',
            'uiv.extension.toastOpeningStore': '🌐 Opening official extension store...',
            'uiv.extension.toastStoreSwitched': 'Switched to {store} store',
            'uiv.extension.copySuccess': '✅ Extension URL copied to clipboard!',
            'uiv.extension.stepsCopied': '✅ Setup guide copied to clipboard!',
            'uiv.extension.tip': '💡 <b>Tip</b>: After installation, return to the workbench and click <b>🚀 Run Batch</b> at the bottom of the Smart Repository to invoke UI.Vision for automated data capture!',

            // Site script picker
            'uiv.siteScript.title': 'Select Target Site to Copy Scripts',
            'uiv.siteScript.subtitle': 'Due to browser Same-Origin Policy, please select the target site where you will paste and run scripts.',
            'uiv.siteScript.notice': 'Floating mode avoids one-by-one CSV downloads. Once capture finishes, you can review metrics and batch download all CSVs in a single ZIP.',
            'uiv.siteScript.unresolved': 'Another {count} scripts have no recognizable site and are omitted. Please configure request URLs first.',
            'uiv.siteScript.empty': 'No recognizable sites found within the current scope.<br>Please check script request URLs or category filter settings.',
            'uiv.siteScript.scriptCount': '{count} executable script(s)',
            'uiv.siteScript.simulate': 'Simulate Floating Window',
            'uiv.siteScript.copy': 'Copy Scripts for Site',
            'uiv.siteScript.close': 'Close',
            'uiv.siteScript.noScope': '❌ No exportable scripts found in current category or scope',
            'uiv.siteScript.noSite': '❌ No exportable scripts found under site {site}',
            'uiv.siteScript.copied': '✅ Copied F12 scripts for {name} ({count} task(s){dep})',
            'uiv.siteScript.depText': ', auto-injected {count} cross-table dependencies',
            'uiv.siteScript.copyFail': '❌ Failed to copy site scripts: {error}',
            'uiv.siteScript.readFail': '❌ Failed to load site scripts: {error}',

            // AI Scraper Adapter
            'uiv.aiAdapter.title': 'AI Whole-Website Scraper Adapter',
            'uiv.aiAdapter.subtitle': 'AI analyzes request and response structures; reuses mature engines for DataFab/NetCare, or applies guarded universal templates for other targets.',
            'uiv.aiAdapter.close': 'Close',
            'uiv.aiAdapter.step1': '1. Paste DevTools → Copy as fetch',
            'uiv.aiAdapter.parseBtn': 'Parse & Auto-fill Request',
            'uiv.aiAdapter.parseSummary': 'Parsing only inspects static fetch options; pasted code is never executed.',
            'uiv.aiAdapter.step2': '2. Paste DevTools → Copy response',
            'uiv.aiAdapter.keywordLabel': 'Target Keyword (Optional, to focus on a specific response dataset)',
            'uiv.aiAdapter.keywordPh': 'e.g. c10_topN, records, risk_list',
            'uiv.aiAdapter.keywordSummary': 'When empty, AI will inspect the entire response sample.',
            'uiv.aiAdapter.advanced': 'Advanced Settings: Inspect or tweak parsed parameters',
            'uiv.aiAdapter.reqUrl': 'Request URL',
            'uiv.aiAdapter.openUrl': 'Pre-open Page URL (Optional)',
            'uiv.aiAdapter.method': 'HTTP Method',
            'uiv.aiAdapter.bodyType': 'Body Type',
            'uiv.aiAdapter.bodyTypeJson': 'JSON',
            'uiv.aiAdapter.bodyTypeForm': 'URL-encoded Form',
            'uiv.aiAdapter.bodyTypeNone': 'No Body',
            'uiv.aiAdapter.pagination': 'Pagination Policy',
            'uiv.aiAdapter.paginationAuto': 'Auto Detect (Default)',
            'uiv.aiAdapter.paginationNone': 'Force Single Page (Current results only)',
            'uiv.aiAdapter.credentials': 'Credentials Mode',
            'uiv.aiAdapter.outputFileName': 'Output File Name',
            'uiv.aiAdapter.authStrategy': 'Auth Source',
            'uiv.aiAdapter.authAuto': 'Let AI Decide',
            'uiv.aiAdapter.authCookie': 'Browser Cookie',
            'uiv.aiAdapter.authCookieHeader': 'Inject Cookie into Header (CSRF)',
            'uiv.aiAdapter.authLocalStorage': 'localStorage',
            'uiv.aiAdapter.authSessionStorage': 'sessionStorage',
            'uiv.aiAdapter.authNone': 'No Auth Required',
            'uiv.aiAdapter.authSourceKey': 'Token/Cookie Source Key',
            'uiv.aiAdapter.authSourceKeyPh': 'access_token or XSRF-TOKEN',
            'uiv.aiAdapter.authValuePath': 'Storage Token Path (Optional)',
            'uiv.aiAdapter.authValuePathPh': 'e.g. data.accessToken',
            'uiv.aiAdapter.authHeader': 'Auth Header Name',
            'uiv.aiAdapter.authPrefix': 'Auth Token Prefix',
            'uiv.aiAdapter.headersLabel': 'Request Headers JSON (Sensitive tokens masked before AI call)',
            'uiv.aiAdapter.bodyLabel': 'Request Payload JSON',
            'uiv.aiAdapter.secondResponseLabel': 'Page 2 or Empty Response JSON (Optional, assists pagination check)',
            'uiv.aiAdapter.guardrail': 'Supports JSON/URL-encoded forms, GET/POST, numeric/offset/cursor pagination, GraphQL JSON, Cookie/storage auth, and objects/primitives/2D arrays. If auth header source is unknown, the generated script tests Cookie, localStorage, sessionStorage, and page tokens locally. Mature engines are reused only on high-confidence schema matches; non-official domains never call proprietary endpoints. Captchas, dynamic signatures, file uploads, and HTML scraping are unsupported.',
            'uiv.aiAdapter.waitingStart': 'Waiting to start analysis',
            'uiv.aiAdapter.stepValidate': 'Validate Input',
            'uiv.aiAdapter.stepSample': 'Mask Sample',
            'uiv.aiAdapter.stepModel': 'AI Analysis',
            'uiv.aiAdapter.stepVerify': 'Verify Path',
            'uiv.aiAdapter.previewDefault': 'Fill in request and response samples, then click "AI Analysis & Verification".',
            'uiv.aiAdapter.cancel': 'Cancel',
            'uiv.aiAdapter.analyzeBtn': 'AI Analysis & Verification',
            'uiv.aiAdapter.generateBtn': 'Generate Smart Script',
            'uiv.aiAdapter.choiceTitle': 'Select Target Data Fragment',
            'uiv.aiAdapter.choiceSubtitle': 'Multiple locations matched this keyword. Please select the target JSON chain to capture.',
            'uiv.aiAdapter.pulseSample': 'Sampling, masking and preparing model inputs...',
            'uiv.aiAdapter.pulseModel': 'AI is analyzing request and response structures...',
            'uiv.aiAdapter.pulseWait': 'Model analysis still in progress, waiting patiently...',
            'uiv.aiAdapter.fetchSourceEmpty': 'Please paste "Copy as fetch" content first',
            'uiv.aiAdapter.parsingFetch': 'Safely parsing fetch request...',
            'uiv.aiAdapter.fetchParsed': 'Fetch parsed successfully. Paste response to analyze.',
            'uiv.aiAdapter.parsed': 'Parsed: ',
            'uiv.aiAdapter.headerCount': '{count} header(s)',
            'uiv.aiAdapter.sensitiveHeadersWarning': 'Sensitive headers detected: {headers}. Will be masked before AI analysis.',
            'uiv.aiAdapter.keywordNeedValidJson': 'Please paste valid response JSON to search keywords.',
            'uiv.aiAdapter.keywordNotFound': 'Keyword "{keyword}" not found in response sample.',
            'uiv.aiAdapter.keywordFoundMultiple': 'Found {count} occurrences of "{keyword}". Please select target data segment.',
            'uiv.aiAdapter.keywordFocused': 'Focused: {focus}; Hit position: {hit}',
            'uiv.aiAdapter.matchFieldName': 'Field Name',
            'uiv.aiAdapter.matchFieldValue': 'Field Value',
            'uiv.aiAdapter.hitPos': 'Hit Location',
            'uiv.aiAdapter.focusSegment': 'Focused Segment',
            'uiv.aiAdapter.rootNode': '(Root Node)',
            'uiv.aiAdapter.validatingInput': 'Validating inputs...',
            'uiv.aiAdapter.logLocalValidateStart': 'Starting local validation of input JSON.',
            'uiv.aiAdapter.validatingInputJson': 'Validating input JSON...',
            'uiv.aiAdapter.validatedInput': 'Input validation passed, preparing security analysis...',
            'uiv.aiAdapter.logLocalValidatePass': 'Local validation passed, sending to backend.',
            'uiv.aiAdapter.sentToBackend': 'Sent to backend. Sampling, masking, and calling AI...',
            'uiv.aiAdapter.modelDoneVerifying': 'Model analysis completed, verifying data paths...',
            'uiv.aiAdapter.backendDoneRendering': 'Backend analysis completed, rendering results.',
            'uiv.aiAdapter.analyzeDoneFallback': 'Analysis completed (Safe fallback enabled)',
            'uiv.aiAdapter.analyzeDoneOk': 'Analysis and path verification completed',
            'uiv.aiAdapter.statusAnalyzePassed': 'Analysis and sample verification passed. Ready to generate.',
            'uiv.aiAdapter.needAnalyzeFirst': 'Please complete AI analysis first.',
            'uiv.aiAdapter.toastNativeSuccess': '✅ Script generated using {profile} mature engine + AI adaptation. Please verify individually.',
            'uiv.aiAdapter.toastGenericSuccess': '✅ Universal AI adapted script generated. Please verify individually before adding to batch repo.',
            'uiv.aiAdapter.fail': 'Failed',

            // Script analysis modal
            'uiv.analysis.title': 'Script Repository Analysis',
            'uiv.analysis.reading': 'Reading script repository...',
            'uiv.analysis.summary': 'Total {total} scripts · DataFab {datafab} · NetCare {netcare} · Showing {current}',
            'uiv.analysis.searchPh': 'Search category, script, URL, fields...',
            'uiv.analysis.allCategories': 'All Categories',
            'uiv.analysis.saveChanges': 'Save Changes',
            'uiv.analysis.refresh': 'Refresh',
            'uiv.analysis.thCategory': 'Category',
            'uiv.analysis.thName': 'Script Name',
            'uiv.analysis.thOutput': 'Output Table Name',
            'uiv.analysis.thUrl': 'Request URL',
            'uiv.analysis.thUpdated': 'Updated At',
            'uiv.analysis.thPlatform': 'Platform',
            'uiv.analysis.thRequest': 'Request',
            'uiv.analysis.thCore': 'Core Objects',
            'uiv.analysis.thFilters': 'Filter Fields',
            'uiv.analysis.thOptions': 'Switches',
            'uiv.analysis.thResponse': 'Response Table',
            'uiv.analysis.thRefill': 'Refill Status',
            'uiv.analysis.thActions': 'Actions',
            'uiv.analysis.empty': 'Waiting for analysis...',
            'uiv.analysis.noMatches': 'No matching scripts found',
            'uiv.analysis.footer': 'Double-click a row to refill workbench; click filter fields to edit value, click × to delete field; unsaved changes will prompt on close.',
            'uiv.analysis.copyModified': 'Copy Modified Script',
            'uiv.analysis.saveAsNew': 'Save as New Script',
            'uiv.analysis.deleteScript': 'Delete Script',
            'uiv.analysis.modifiedTag': 'Modified (Unsaved)',
            'uiv.analysis.payloadOk': 'Payload Restorable',
            'uiv.analysis.payloadLegacy': 'Legacy without Payload',
            'uiv.analysis.configOk': 'Switches Restorable',
            'uiv.analysis.configCode': 'Switches Code-Inferred',
            'uiv.analysis.copyCellTitle': 'Click to copy text',
            'uiv.analysis.optGlobalVars': 'Global Vars',
            'uiv.analysis.optPagination': 'Pagination',
            'uiv.analysis.optForceSum': 'Force Total',
            'uiv.analysis.optAutoCpc': 'Dynamic CPC/NID',
            'uiv.analysis.optAutoMonth': 'Bi-Monthly',
            'uiv.analysis.optTriplicate': '3-Zone Triplicate',
            'uiv.analysis.switchOn': 'ON',
            'uiv.analysis.switchOff': 'OFF',
            'uiv.analysis.noFilters': 'No filter fields detected',
            'uiv.analysis.noCore': 'No core objects detected',
            'uiv.analysis.otherEmptyFilters': 'Another {count} empty field(s)',
            'uiv.analysis.emptyValue': 'Empty',
            'uiv.analysis.empty': 'Empty',
            'uiv.analysis.itemCount': ' · {count} item(s)',
            'uiv.analysis.saveChangesCount': 'Save Changes ({count})',
            'uiv.analysis.copySuccess': 'Copied: {text}',
            'uiv.analysis.copyFail': 'Copy failed',
            'uiv.analysis.savedCount': 'Saved {count} modified script(s)',
            'uiv.analysis.noScriptsToSave': 'No scripts need saving',
            'uiv.analysis.saveFail': 'Failed to save changes',
            'uiv.analysis.deleteTitle': 'Delete Script',
            'uiv.analysis.deleteConfirm': 'Are you sure you want to delete script [{name}]?\nIt will be removed from repository permanently.',
            'uiv.analysis.deletedToast': 'Deleted script: {name}',
            'uiv.analysis.deleteFail': 'Failed to delete script',
            'uiv.analysis.saveAsTitle': 'Save as New Script',
            'uiv.analysis.saveAsMessage': 'Name the copy and choose category. Modified filter fields will be included in the new script.',
            'uiv.analysis.saveAsConfirm': 'Save As',
            'uiv.analysis.saveAsSuccess': 'Saved as new script: {name}',
            'uiv.analysis.saveAsFail': 'Failed to save as new script',
            'uiv.analysis.nameRequired': 'Please provide a name for the new script',
            'uiv.analysis.nameExists': 'Script name already exists, please choose another name',
            'uiv.analysis.unsavedTitle': 'Unsaved Changes',
            'uiv.analysis.unsavedMessage': '{count} script modifications are unsaved.\nSave before closing to prevent losing changes.',
            'uiv.analysis.unsavedSaveClose': 'Save and Close',
            'uiv.analysis.refreshTitle': 'Refresh Analysis Data',
            'uiv.analysis.refreshMessage': 'There are unsaved changes. Refreshing will discard these modifications.\nDo you want to continue?',
            'uiv.analysis.refreshConfirm': 'Continue Refresh',
            'uiv.analysis.confirm': 'Confirm',
            'uiv.analysis.cancel': 'Cancel',
            'uiv.analysis.apply': 'Apply',
            'uiv.analysis.defaultCategory': 'Default Category',
            'uiv.analysis.editFilterTitle': 'Edit Filter Field',
            'uiv.analysis.deleteFilterTitle': 'Delete Filter Field',
            'uiv.analysis.deleteFilterConfirm': 'Are you sure you want to delete filter field [{key}]?\nBefore saving, this only affects the pending changes in the current analysis window.',
            'uiv.analysis.deleteFilterBtn': 'Delete Field',
            'uiv.analysis.copiedModifiedScript': 'Copied modified script'
        }
    };

    function isRawKey(val) {
        return typeof val === 'string' && val.startsWith('uiv.');
    }

    function t(key, params = {}) {
        if (window.ToolsI18n) {
            const res = window.ToolsI18n.t(key, params);
            if (res !== key) return res;
        }
        const lang = (window.ToolsI18n && typeof window.ToolsI18n.getLanguage === 'function')
            ? window.ToolsI18n.getLanguage()
            : (localStorage.getItem('tools_lang') || 'zh-CN');
        const dict = dictionaries[lang] || dictionaries['zh-CN'] || {};
        const fallbackVal = dict[key] || (dictionaries['zh-CN'] && dictionaries['zh-CN'][key]);
        if (fallbackVal !== undefined && fallbackVal !== null) {
            return String(fallbackVal).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
        }
        return key;
    }

    function setText(selector, value) {
        const el = document.querySelector(selector);
        if (el && !isRawKey(value)) el.textContent = value;
    }

    function setHtml(selector, value) {
        const el = document.querySelector(selector);
        if (el && !isRawKey(value)) el.innerHTML = value;
    }

    function setPlaceholder(selector, value) {
        const el = document.querySelector(selector);
        if (el && !isRawKey(value)) el.placeholder = value;
    }

    function setTitle(selector, value) {
        const el = document.querySelector(selector);
        if (el && !isRawKey(value)) el.title = value;
    }

    function categoryLabel(category) {
        const map = {
            'NetCare中国': 'uiv.category.netcareCn',
            'NetCare中东': 'uiv.category.netcareAe',
            'NetCare德国': 'uiv.category.netcareDe',
            '默认分类': 'uiv.category.default'
        };
        return map[category] ? t(map[category]) : category;
    }

    function sourceLabel(source) {
        if (source === 'sqlite') return 'SQLite';
        if (source === 'json') return 'JSON';
        if (source === 'auto') return t('uiv.source.auto');
        return source || '-';
    }

    function applyPage() {
        document.title = t('uiv.title');
        const desc = document.querySelector('meta[name="description"]');
        if (desc) desc.setAttribute('content', t('uiv.description'));

        const titleWrap = document.querySelector('.uiv-title-left > span:first-child, .uiv-title > span:first-child');
        const versionEl = document.getElementById('uivFrontendVersion');
        if (titleWrap) {
            titleWrap.textContent = t('uiv.header.title') + ' ';
            if (versionEl) titleWrap.appendChild(versionEl);
        }
        setText('.uiv-title .tag', t('uiv.header.tag'));
        const repoTitle = document.querySelector('.sidebar h2');
        const copyBtn = repoTitle?.querySelector('.cat-copy-btn');
        if (repoTitle) repoTitle.textContent = t('uiv.repo.title') + ' ';
        if (copyBtn) {
            copyBtn.textContent = t('uiv.repo.copyAll');
            copyBtn.title = t('uiv.repo.copyAllTitle');
            repoTitle?.appendChild(copyBtn);
        }
        setHtml('.sidebar h2 + div', t('uiv.repo.tip'));
        setText('.repo-source-controls .repo-source-note', t('uiv.repo.mode'));
        setText('#repoSourceMode option[value="auto"]', t('uiv.source.auto'));
        setText('#repoSourceMode option[value="sqlite"]', t('uiv.source.sqlite'));
        const sourcePanel = document.getElementById('repoSourcePanel');
        if (sourcePanel && !sourcePanel.dataset.loaded) {
            sourcePanel.innerHTML = `
                <span class="repo-source-badge">${t('uiv.source.script', { source: '-' })}</span>
                <span class="repo-source-badge">${t('uiv.source.category', { source: '-' })}</span>
                <span class="repo-source-note">${t('uiv.source.initialNote')}</span>
            `;
        }
        setText('.btn-add-cat', t('uiv.repo.newCategory'));
        setText('.btn-batch-uiv', t('uiv.repo.copyBatchUiv'));
        setText('.btn-batch-uiv-run:not(.btn-batch-uiv-test)', t('uiv.repo.runBatchUiv'));
        setText('.btn-batch-uiv-test', t('uiv.repo.runTestBatchUiv'));
        setText('.btn-batch-site-console', t('uiv.repo.siteConsolePlaceholder'));
        setTitle('.btn-batch-site-console', t('uiv.repo.siteConsoleTitle'));
        if (window.UIVCopy && typeof window.UIVCopy.updateUivBatchSpeedButton === 'function') {
            window.UIVCopy.updateUivBatchSpeedButton();
        }
        setText('.btn-io[onclick="UIVSidebar.exportBackup()"]', t('uiv.repo.export'));
        const importLabel = document.querySelector('label.btn-io');
        if (importLabel) {
            const input = importLabel.querySelector('input');
            importLabel.textContent = t('uiv.repo.import') + ' ';
            if (input) importLabel.appendChild(input);
        }

        const panelLabels = document.querySelectorAll('.left-panel > .panel-label');
        if (panelLabels[0]) panelLabels[0].textContent = t('uiv.input.urlLabel');
        if (panelLabels[1]) {
            const hint = panelLabels[1].querySelector('span') || document.createElement('span');
            panelLabels[1].textContent = t('uiv.input.payloadLabel');
            hint.style.cssText = 'font-size:12px; color:#888; font-weight:normal;';
            hint.textContent = t('uiv.input.payloadHint');
            panelLabels[1].appendChild(hint);
        }
        if (panelLabels[2]) {
            const labelSpan = document.getElementById('responseSampleLabel');
            const hintSpan = document.getElementById('responseSampleHint');
            if (labelSpan) labelSpan.textContent = t('uiv.input.responseSampleLabel');
            if (hintSpan) hintSpan.textContent = t('uiv.input.responseSampleHint');
            setText('.guide-badge-text', t('uiv.sampleGuide.badgeText'));
            setTitle('#responseSampleGuideTrigger', t('uiv.sampleGuide.badgeTitle'));
        }
        setPlaceholder('#responseSampleInput', t('uiv.input.responseSamplePlaceholder'));
        setPlaceholder('#responseFocusKeyword', t('uiv.focus.keywordPlaceholder'));
        setText('#uivResponseChoiceTitle', t('uiv.focus.modalTitle'));
        setText('#uivResponseChoiceSubtitle', t('uiv.focus.modalSubtitle'));
        setText('#btnChooseResponseFocus span:first-child', t('uiv.focus.chooseTable'));
        setTitle('#btnClearResponseFocus', t('uiv.focus.clearTitle'));
        setText('#urlPreset option:nth-child(1)', t('uiv.preset.datafab'));
        setText('#urlPreset option:nth-child(2)', t('uiv.preset.netcareCn'));
        setText('#urlPreset option:nth-child(3)', t('uiv.preset.netcareAe'));
        setText('#urlPreset option:nth-child(4)', t('uiv.preset.netcareDe'));
        setText('#urlPreset option:nth-child(5)', t('uiv.preset.custom'));
        setPlaceholder('#fileName', t('uiv.input.filePlaceholder'));
        setText('.file-name-guide-badge', t('uiv.input.fileGuideBadge'));
        setText('.file-name-guide-title', t('uiv.input.fileGuideTitle'));
        setText('.file-name-guide-text', t('uiv.input.fileGuideText'));

        const optionLabels = document.querySelectorAll('.controls label');
        [
            'uiv.option.globalVars',
            'uiv.option.pagination',
            'uiv.option.forceSum',
            'uiv.option.cpc',
            'uiv.option.runtimeMonth',
            'uiv.option.netcareTriplicate'
        ].forEach((key, index) => {
            const label = optionLabels[index];
            const input = label?.querySelector('input');
            if (!label || !input) return;
            label.textContent = ' ' + t(key);
            label.prepend(input);
        });

        const actionButtons = document.querySelectorAll('.left-panel .btn-group .btn');
        if (actionButtons[0]) actionButtons[0].textContent = t('uiv.action.format');
        if (actionButtons[1]) actionButtons[1].textContent = t('uiv.action.clear');
        if (actionButtons[2]) actionButtons[2].textContent = t('uiv.action.generate');
        setText('.uiv-ai-adapter-entry', t('uiv.action.aiAdaptAll'));
        setText('.right-panel .output-label', t('uiv.output.uivLabel'));
        setText('#saveBtn', t('uiv.output.save'));
        setText('#btnCopyUIV', t('uiv.output.copyUiv'));
        setPlaceholder('#codeOutput', t('uiv.output.uivPlaceholder'));
        setText('.right-panel .console-label', t('uiv.output.consoleLabel'));
        setText('#btnCopyConsole', t('uiv.output.copyConsole'));
        setPlaceholder('#consoleOutput', t('uiv.output.consolePlaceholder'));
        const logTitle = document.querySelector('.gen-log-title');
        const logIcon = document.getElementById('genLogIcon');
        const logBadge = document.getElementById('genLogBadge');
        if (logTitle) {
            logTitle.textContent = '';
            if (logIcon) logTitle.appendChild(logIcon);
            logTitle.appendChild(document.createTextNode(' ' + t('uiv.log.title') + ' '));
            if (logBadge) logTitle.appendChild(logBadge);
        }
        setText('.gen-log-clear', t('uiv.log.clear'));
        setText('.uiv-delete-confirm-eyebrow', t('uiv.deleteDialog.eyebrow'));
        setText('#uivDeleteConfirmTitle', t('uiv.deleteDialog.title'));
        setText('#uivDeleteConfirmMessage', t('uiv.deleteDialog.message'));
        setText('#uivDeleteConfirmCancel', t('uiv.deleteDialog.cancel'));
        setText('#uivDeleteConfirmSubmit', t('uiv.deleteDialog.confirm'));
        setText('#uivCategoryDeleteConfirmEyebrow', t('uiv.categoryDeleteDialog.eyebrow'));
        setText('#uivCategoryDeleteConfirmTitle', t('uiv.categoryDeleteDialog.title'));
        setText('#uivCategoryDeleteConfirmCancel', t('uiv.deleteDialog.cancel'));
        setText('#uivCategoryDeleteConfirmSubmit', t('uiv.deleteDialog.confirm'));
        setText('.uiv-category-create-eyebrow', t('uiv.categoryDialog.eyebrow'));
        setText('#uivCategoryCreateTitle', t('uiv.categoryDialog.title'));
        setText('#uivCategoryCreateMessage', t('uiv.categoryDialog.message'));
        setText('.uiv-category-create-label', t('uiv.categoryDialog.label'));
        setPlaceholder('#uivCategoryCreateInput', t('uiv.categoryDialog.placeholder'));
        setText('.uiv-category-create-hint', t('uiv.categoryDialog.hint'));
        setText('#uivCategoryCreateCancel', t('uiv.categoryDialog.cancel'));
        setText('#uivCategoryCreateSubmit', t('uiv.categoryDialog.confirm'));

        const catSelect = document.getElementById('saveCategorySelect');
        if (catSelect) {
            catSelect.title = t('uiv.save.categorySelectTitle');
            const autoOpt = catSelect.querySelector('option[value=""]');
            if (autoOpt) autoOpt.textContent = t('uiv.save.autoCategory');
        }
        setPlaceholder('#uivScriptRenameInput', t('uiv.renameDialog.placeholder'));

        // Generic data attribute internationalization
        document.querySelectorAll('[data-uiv-i18n]').forEach(node => {
            const key = node.getAttribute('data-uiv-i18n');
            if (key) {
                const val = t(key);
                if (!isRawKey(val)) node.textContent = val;
            }
        });
        document.querySelectorAll('[data-uiv-placeholder]').forEach(node => {
            const key = node.getAttribute('data-uiv-placeholder');
            if (key) {
                const val = t(key);
                if (!isRawKey(val)) node.placeholder = val;
            }
        });
        document.querySelectorAll('[data-uiv-title]').forEach(node => {
            const key = node.getAttribute('data-uiv-title');
            if (key) {
                const val = t(key);
                if (!isRawKey(val)) node.title = val;
            }
        });
        document.querySelectorAll('[data-uiv-aria-label]').forEach(node => {
            const key = node.getAttribute('data-uiv-aria-label');
            if (key) {
                const val = t(key);
                if (!isRawKey(val)) node.setAttribute('aria-label', val);
            }
        });

        // AI Scraper Adapter modal (#uivAiAdapterOverlay)
        setText('#uivAiAdapterOverlay .uiv-ai-header h3', t('uiv.aiAdapter.title'));
        setText('#uivAiAdapterOverlay .uiv-ai-header p', t('uiv.aiAdapter.subtitle'));
        setTitle('#uivAiAdapterOverlay .uiv-ai-header button', t('uiv.aiAdapter.close'));
        setText('#uivAiParseFetchBtn', t('uiv.aiAdapter.parseBtn'));
        setText('#uivAiFetchSummary', t('uiv.aiAdapter.parseSummary'));
        setPlaceholder('#uivAiResponseKeyword', t('uiv.aiAdapter.keywordPh'));
        setText('#uivAiKeywordSummary', t('uiv.aiAdapter.keywordSummary'));
        setText('#uivAiAdapterOverlay .uiv-ai-advanced > summary', t('uiv.aiAdapter.advanced'));
        setText('#uivAiBodyType option[value="json"]', t('uiv.aiAdapter.bodyTypeJson'));
        setText('#uivAiBodyType option[value="form"]', t('uiv.aiAdapter.bodyTypeForm'));
        setText('#uivAiBodyType option[value="none"]', t('uiv.aiAdapter.bodyTypeNone'));
        setText('#uivAiPaginationPolicy option[value="auto"]', t('uiv.aiAdapter.paginationAuto'));
        setText('#uivAiPaginationPolicy option[value="none"]', t('uiv.aiAdapter.paginationNone'));
        setText('#uivAiAuthStrategy option[value="auto"]', t('uiv.aiAdapter.authAuto'));
        setText('#uivAiAuthStrategy option[value="cookie"]', t('uiv.aiAdapter.authCookie'));
        setText('#uivAiAuthStrategy option[value="cookieHeader"]', t('uiv.aiAdapter.authCookieHeader'));
        setText('#uivAiAuthStrategy option[value="localStorage"]', t('uiv.aiAdapter.authLocalStorage'));
        setText('#uivAiAuthStrategy option[value="sessionStorage"]', t('uiv.aiAdapter.authSessionStorage'));
        setText('#uivAiAuthStrategy option[value="none"]', t('uiv.aiAdapter.authNone'));
        setPlaceholder('#uivAiAuthSourceKey', t('uiv.aiAdapter.authSourceKeyPh'));
        setPlaceholder('#uivAiAuthValuePath', t('uiv.aiAdapter.authValuePathPh'));
        setText('.uiv-ai-guardrail', t('uiv.aiAdapter.guardrail'));
        setText('.uiv-ai-progress-steps span[data-threshold="10"]', t('uiv.aiAdapter.stepValidate'));
        setText('.uiv-ai-progress-steps span[data-threshold="30"]', t('uiv.aiAdapter.stepSample'));
        setText('.uiv-ai-progress-steps span[data-threshold="75"]', t('uiv.aiAdapter.stepModel'));
        setText('.uiv-ai-progress-steps span[data-threshold="100"]', t('uiv.aiAdapter.stepVerify'));
        const previewEl = document.getElementById('uivAiAdapterPreview');
        if (previewEl && (!previewEl.dataset.custom || previewEl.dataset.custom === '0')) {
            previewEl.textContent = t('uiv.aiAdapter.previewDefault');
        }
        setText('.uiv-ai-footer .btn-secondary:first-child', t('uiv.aiAdapter.cancel'));
        setText('#uivAiAnalyzeBtn', t('uiv.aiAdapter.analyzeBtn'));
        setText('#uivAiGenerateBtn', t('uiv.aiAdapter.generateBtn'));
        setText('#uivAiKeywordChoiceOverlay .uiv-ai-choice-header h4', t('uiv.aiAdapter.choiceTitle'));
        setText('#uivAiKeywordChoiceOverlay .uiv-ai-choice-dialog > p', t('uiv.aiAdapter.choiceSubtitle'));

        // Script analysis modal (#scriptAnalysisModal)
        setText('#scriptAnalysisTitle', t('uiv.analysis.title'));
        setPlaceholder('#scriptAnalysisSearch', t('uiv.analysis.searchPh'));
        setText('#scriptAnalysisCategory option[value=""]', t('uiv.analysis.allCategories'));
        setText('.script-analysis-save', t('uiv.analysis.saveChanges'));
        setText('.script-analysis-refresh', t('uiv.analysis.refresh'));
        setTitle('.script-analysis-close', t('uiv.siteScript.close'));
        const tableThs = document.querySelectorAll('#scriptAnalysisModal thead th');
        if (tableThs.length >= 13) {
            tableThs[0].textContent = t('uiv.analysis.thCategory');
            tableThs[1].textContent = t('uiv.analysis.thName');
            tableThs[2].textContent = t('uiv.analysis.thOutput');
            tableThs[3].textContent = t('uiv.analysis.thUrl');
            tableThs[4].textContent = t('uiv.analysis.thUpdated');
            tableThs[5].textContent = t('uiv.analysis.thPlatform');
            tableThs[6].textContent = t('uiv.analysis.thRequest');
            tableThs[7].textContent = t('uiv.analysis.thCore');
            tableThs[8].textContent = t('uiv.analysis.thFilters');
            tableThs[9].textContent = t('uiv.analysis.thOptions');
            tableThs[10].textContent = t('uiv.analysis.thResponse');
            tableThs[11].textContent = t('uiv.analysis.thRefill');
            tableThs[12].textContent = t('uiv.analysis.thActions');
        }
        setText('.script-analysis-footer span', t('uiv.analysis.footer'));

        if (window.UIVExtensionGuide?.refreshI18n) window.UIVExtensionGuide.refreshI18n();
        if (window.UIVAIAdapter?.refreshI18n) window.UIVAIAdapter.refreshI18n();
        if (window.UIVScriptAnalysis?.render && document.getElementById('scriptAnalysisModal')?.getAttribute('aria-hidden') === 'false') {
            window.UIVScriptAnalysis.render();
        }
        if (document.getElementById('uiv-site-script-overlay')?.style.display === 'flex' && window.UIVCopy?.openSiteConsoleScriptPicker) {
            window.UIVCopy.openSiteConsoleScriptPicker();
        }
    }

    if (window.ToolsI18n) {
        window.ToolsI18n.register('uivf12', dictionaries);
    }

    window.UIVI18n = {
        t,
        applyPage,
        categoryLabel,
        sourceLabel,
        waitingMarkup: () => `<span style="color:#555; font-size:12px;">${t('uiv.log.waiting')}</span>`
    };
    window.UIVT = t;

    window.addEventListener('tools:languagechange', () => {
        applyPage();
        if (window.UIVSidebar?.refreshI18n) window.UIVSidebar.refreshI18n();
        if (window.UIVGenLog?.refreshI18n) window.UIVGenLog.refreshI18n();
        if (window.UIVExtensionGuide?.refreshI18n) window.UIVExtensionGuide.refreshI18n();
        if (window.UIVAIAdapter?.refreshI18n) window.UIVAIAdapter.refreshI18n();
        if (window.UIVScriptAnalysis?.render && document.getElementById('scriptAnalysisModal')?.getAttribute('aria-hidden') === 'false') {
            window.UIVScriptAnalysis.render();
        }
    });
})();
