/**
 * sla/i18n.js - Page dictionary and helpers for the Data Import page.
 */
(function () {
    const dictionaries = {
        'zh-CN': {
            'sla.title': 'Task SLA 风险监控台 - Tools Platform',
            'sla.dialog.notice': '提示',
            'sla.dialog.error': '操作失败',
            'sla.dialog.done': '完成',
            'sla.dialog.confirm': '请确认',
            'sla.dialog.continue': '继续',
            'sla.dialog.cancel': '取消',
            'sla.description': 'Task SLA & 风险监控全局中台，整改/常规/专项三表合一，SLA预警呼吸灯',
            'sla.sticky.title': '⚡ 核心数据舱：',
            'sla.sticky.empty': '(当前未配置指标，请在下方独立表格中点击"🎯 指标"添加)',
            'sla.sticky.noData': '(当前未导入数据，点击右侧"🎯 预警配置"可配置已知指标目标)',
            'sla.sticky.targetConfig': '🎯 预警配置',
            'sla.sticky.expand': '🔽 展开多行',
            'sla.sticky.collapse': '🔼 收起多行',
            'sla.modal.targetTitle': '🎯 配置分月目标与预警方向',
            'sla.modal.saveTargets': '保存全网预警配置',
            'sla.modal.rulesTitle': '📚 全量指标规则总览',
            'sla.modal.rulesSearch': '搜索表名、指标名、字段、关键字、分类...',
            'sla.modal.crossOnly': '只看跨表规则',
            'sla.rules.monthlyOrigin': '月报编辑器创建',
            'sla.rules.monthlyScope': '此规则使用创建时选定的文件类型和工作表',
            'sla.modal.aggFirst': '取原表首条（保留文本）',
            'sla.modal.editTitle': '✏️ 编辑指标规则',
            'sla.modal.editSubtitle': '修改模式、条件、展示统计和挂载关系',
            'sla.modal.metricName': '指标名称',
            'sla.modal.metricNamePh': '例如：业务比对回传率',
            'sla.modal.mode': '模式',
            'sla.modal.extract': '提取 SHOW',
            'sla.modal.extractMulti': '提取多行 AGGREGATE',
            'sla.modal.count': '统计 COUNT',
            'sla.modal.ratio': '占比 RATIO',
            'sla.modal.category': '子指标分类/归属',
            'sla.modal.parent': '挂载到主指标',
            'sla.modal.colX': '条件列 X',
            'sla.modal.valY': '条件值 Y',
            'sla.modal.valYPh': '包含的关键字，可为空',
            'sla.modal.colZ': '展示/统计列 Z',
            'sla.modal.valK': '统计值 K',
            'sla.modal.valKPh': '统计/占比分子关键字',
            'sla.modal.aggregation': '多行计算方法',
            'sla.modal.filterLogic': '全部过滤条件关系',
            'sla.modal.aggSum': '求和（默认）',
            'sla.modal.aggAvg': '平均值',
            'sla.modal.aggMax': '最大值',
            'sla.modal.aggMin': '最小值',
            'sla.modal.aggCount': '有效数值个数',
            'sla.modal.logicAnd': 'AND：主条件和附加条件全部满足',
            'sla.modal.logicOr': 'OR：主条件或任一附加条件满足',
            'sla.modal.cancel': '取消',
            'sla.modal.save': '保存修改',
            'sla.modal.copyTitle': '📋 复制指标规则',
            'sla.modal.copySubtitle': '批量复制后逐行修改字段并保存',
            'sla.modal.copyCount': '复制数量',
            'sla.modal.copyHint': '每一行都会创建一条新规则，保存前可以横向修改名称、模式、字段和挂载关系。',
            'sla.modal.copySave': '保存复制',
            'sla.modal.fastApply': '⚡ 快速映射填写',
            'sla.modal.fastTemplate': '快速映射模板',
            'sla.modal.mappingTitle': '快速映射模板编辑',
            'sla.modal.mappingSubtitle': '固定两列填写；从 Excel 复制两列后粘贴到任意单元格即可自动填充。',
            'sla.modal.mappingHint': '分类来自全局分类；从 Excel 粘贴一列条件值会按当前行向下填充，粘贴两列会按分类名匹配填充。',
            'sla.modal.mappingCategory': '子指标分类',
            'sla.modal.mappingCondition': '条件值',
            'sla.modal.mappingSaveApply': '保存并应用',
            'sla.category.title': '🏷️ 指标维度分类管理（客户群/代表处/地区部）',
            'sla.category.inputPh': '输入新分类名称...',
            'sla.category.add': '➕ 添加',
            'sla.category.save': '保存全部分类',
            'sla.history.title': '📈 历史导入预警快照',
            'sla.history.loading': '正在加载历史快照...',
            'sla.history.loadingShort': '正在加载...',
            'sla.history.loadFail': '加载失败：{message}',
            'sla.history.empty': '暂无历史快照记录。请先使用上方按钮导入表格数据以生成。',
            'sla.history.importTime': '🕒 导入时间',
            'sla.history.targetMonth': '{month}月目标',
            'sla.history.sourceTables': '源表数',
            'sla.history.summary': '📊 汇总数据',
            'sla.history.expandSummary': '展开汇总（{count}项）',
            'sla.history.delete': '删除',
            'sla.history.loadOriginals': '载入到当前页面',
            'sla.history.loadOriginalsTitle': '载入该次导入批次的全部原始文件和工作表，用于回顾，不生成新快照',
            'sla.history.loadingOriginals': '载入中…',
            'sla.history.noOriginals': '该记录未保存原始表，或原始存档已不可用。',
            'sla.history.noWorksheets': '原始文件中没有可载入的工作表。',
            'sla.history.reviewTitle': '原始数据回顾 · {time}',
            'sla.history.reviewNote': '已载入该批次全部 {files} 个原始文件、{sheets} 个工作表，未按目标月份筛选。载入时不重复上传或生成新快照；保存指标规则后会另存重算结果，历史得分保持不变。已恢复导入分组、监控、指标高亮和核心数据舱；按当前规则及日期分析，无当前指标规则时使用快照保存的规则。附加工作表仅供回顾，不参与跨表指标统计。',
            'sla.history.originalsLoaded': '已将原始表载入当前页面，可切换标签查看各工作表。',
            'sla.history.originalsLoadFail': '原始表载入失败：{message}',
            'sla.history.deleteTitle': '删除此快照',
            'sla.history.confirmDelete': '确定要删除这条历史快照吗？删除后不可恢复。',
            'sla.history.deleted': '✅ 快照已成功删除',
            'sla.history.deleteFail': '❌ 删除失败: {message}',
            'sla.history.featherLoading': '正在准备历史预警快照…',
            'sla.history.stepSnapshots': '读取历史快照记录',
            'sla.history.stepConfig': '加载预警目标与格式配置',
            'sla.history.stepCatalog': '检索原始文件存档清单',
            'sla.history.stepRender': '渲染分页数据与指标视图',
            'sla.history.stepCount': '{settled} / {total} 个步骤',
            'sla.history.stepReady': '完成',
            'sla.history.stepRunning': '正在加载',
            'sla.history.stepWaiting': '等待',
            'sla.history.paginationSummary': '共 {total} 条快照 · 展示第 {start} - {end} 条',
            'sla.history.paginationSummaryAll': '共 {total} 条快照 · 展示全部记录',
            'sla.history.pageSizeLabel': '每页展示：',
            'sla.history.pageSizeUnit': '{size} 条 / 页',
            'sla.history.pageSizeDefault': '10 条 / 页 (默认)',
            'sla.history.pageSizeAll': '全部展示',
            'sla.history.firstPage': '首页',
            'sla.history.prevPage': '‹ 上一页',
            'sla.history.nextPage': '下一页 ›',
            'sla.history.lastPage': '末页',
            'sla.history.jumpTo': '跳至',
            'sla.history.pageUnit': '页',
            'sla.history.deleteProgressTitle': '正在删除历史快照…',
            'sla.history.deleteStepRequest': '提交删除指令…',
            'sla.history.deleteStepClean': '安全清理快照数据库记录…',
            'sla.history.deleteStepFiles': '同步清理原始文件与工作表缓存…',
            'sla.history.deleteStepFinish': '清理完成，正在刷新快照列表…',
            'sla.header.title': '📊 全局数据合控大中台',
            'sla.header.edition': '旗舰定制版',
            'sla.version.loading': 'v加载中',
            'sla.version.unmarked': 'v未标记',
            'sla.version.title': '平台版本：{version}',
            'sla.version.missing': '未能获取平台版本',
            'sla.action.categories': '🏷️ 全局分类',
            'sla.action.history': '📈 历史看板',
            'sla.action.rules': '📚 全量规则',
            'sla.action.exportConfig': '💾 导出全量配置',
            'sla.action.exportConfigTitle': '备份所有的列宽、显示状态、顶部指标和预警目标',
            'sla.action.importConfig': '📂 导入配置',
            'sla.action.importConfigTitle': '导入配置文件，一键恢复设置',
            'sla.source.mode': 'SLA读源模式:',
            'sla.source.targetMonth': '目标月份:',
            'sla.source.auto': '自动模式',
            'sla.source.json': 'JSON',
            'sla.source.sqlite': '强制 SQLite',
            'sla.source.targets': '目标来源: {source}',
            'sla.source.prefs': '偏好来源: {source}',
            'sla.source.categories': '分类来源: {source}',
            'sla.source.groups': '分组来源: {source}',
            'sla.source.snapshots': '快照来源: {source}',
            'sla.source.initialNote': '迁移期要求页面直接显示真实读源，便于验证。',
            'sla.source.currentNote': '当前模式: {mode} · 迁移期要求页面直接显示真实读源。',
            'sla.month.option': '{month}月目标',
            'sla.rule.rectTitle': '🔧【整改】',
            'sla.rule.riskTitle': '⚠️【常规风险】',
            'sla.rule.specialTitle': '🛠️【专项风险】',
            'sla.rule.srTitle': '📞【SR详单】',
            'sla.rule.vulnTitle': '🧯【漏洞预警】',
            'sla.rule.strictPrefix': '文件：',
            'sla.rule.rectFile': 'PBI_自动抓取-整改详单_整改_Latest 前缀',
            'sla.rule.rectStatusField': '状态：task_status',
            'sla.rule.rectChecking': 'Checking：task_create_time +30天；剩余 ≤10天红，<30天黄',
            'sla.rule.rectification': 'Rectification Implementation：rectify_plan_end_time；剩余 ≤10天红，<82天黄',
            'sla.rule.riskFile': 'PBI_自动抓取-风险详单_Latest 前缀',
            'sla.rule.riskStatusField': '状态：风险状态 → risk_status（首个非空）',
            'sla.rule.confirming': 'Risk Confirming：创单时间/create_time +30天；剩余 ≤10天红，<30天紫',
            'sla.rule.open': 'Open / Suspended / Complete Reviewing：ticket_close_due_date；剩余 ≤10天红，<30天紫',
            'sla.rule.suspended': '到期日为空：依次取 due_time / 期望关闭时间-挂起 / suspend_due_date',
            'sla.rule.specialFile': 'PBI_自动抓取-CPT风险详表_Latest 前缀',
            'sla.rule.specialStatusField': '状态：状态-Status → task_status_en → task_status → task_status_cn（首个非空）',
            'sla.rule.toConfirm': '待确认/草稿/To Be Confirmed/Draft/Confirm(ing)：创建日期 +30天；剩余 ≤10天红，<30天青',
            'sla.rule.processing': '处理中/评审中/Processing/Reviewing：要求完成日期；剩余 ≤10天红，<30天青',
            'sla.rule.srFile': 'PBI_自动抓取-详单-SR_Latest 前缀',
            'sla.rule.srStatusField': '状态：sr_status_name',
            'sla.rule.srMonitor': '到期：sus_exp_close_date 优先，否则 exp_close_date',
            'sla.rule.suspend': '忽略：Pending / Suspend / Hold / 挂起',
            'sla.rule.srOverdue': '超期/等级：overdue；hw_sev_name / urgency（Critical 阈值）',
            'sla.rule.vulnFile': 'PBI_自动抓取-详单漏洞_漏洞预警_Latest 前缀',
            'sla.rule.vulnStatusField': '状态：task_status',
            'sla.rule.vulnStatus': '范围：Checking / Communication Dept / Communication Customer',
            'sla.rule.vulnCreate': '时限：create_time 或 task_create_time +30天；剩余 ≤10天红，<30天黄',
            'sla.upload.batch': '📦 一键批量导入所有表 (智能分流合并)',
            'sla.upload.rect': '指定导入 [整改]',
            'sla.upload.risk': '指定导入 [常规]',
            'sla.upload.special': '指定导入 [专项]',
            'sla.upload.sr': '指定导入 [SR]',
            'sla.upload.vuln': '指定导入 [漏洞]',
            'sla.upload.clearCache': '清空当前缓存',
            'sla.upload.confirmClearCache': '确认清空当前页面导入缓存？这只会清除浏览器本地保存的当前导入内容，不会删除历史快照、上传历史或服务端配置。',
            'sla.upload.clearCacheSuccess': '已清空当前导入缓存',
            'sla.upload.clearCacheFail': '清空导入缓存失败，请检查浏览器本地存储权限。',
            'sla.upload.cachedTitle': '📊 已恢复上次导入数据',
            'sla.upload.restoreLoading': '⏳ 正在恢复上次导入的数据...',
            'sla.upload.restoreSuccess': '✅ 已恢复上次导入的数据',
            'sla.upload.restoreFailTitle': '上次导入数据恢复失败',
            'sla.upload.restoreFail': '上次导入数据恢复失败，请重新导入文件。',
            'sla.upload.cacheLarge': '⚠️ 本次表格较大，浏览器本地缓存空间不足，切换页面后可能需要重新导入',
            'sla.upload.cacheTooLargeTitle': '上次导入数据过大，未能保存恢复缓存',
            'sla.upload.cacheTooLargeBody': '本次导入已完成当前页面分析，但浏览器本地缓存空间不足，无法保存完整工作区。刷新或切换页面后，需要重新选择原始文件导入；历史快照、上传历史和服务端配置不受影响。',
            'sla.upload.cacheTooLargeRows': '涉及 {rows} 行数据',
            'sla.upload.cacheTooLargeFiles': '文件 {count} 个',
            'sla.upload.cacheTooLargeTime': '发生时间 {time}',
            'sla.upload.cacheTooLargeDismiss': '知道了',
            'sla.upload.cacheTooLargeClear': '重新选择文件导入',
            'sla.upload.parseLoading': '⏳ 正在解析表格数据，请稍候...',
            'sla.upload.emptyFile': '读取失败或为空表！',
            'sla.upload.smartLoading': '⏳ 正在启动智能分拣引擎分析全部文件...',
            'sla.upload.cachedSpecific': '📊 已缓存 {title}',
            'sla.upload.batchSuccess': '📊 批量导入成功 (共解析 {count} 个文件)',
            'sla.upload.uivAutoLoading': '⏳ 正在接收 UIVF12 抓取文件并自动导入...',
            'sla.upload.uivTenantWarning': '⚠️ 自动导入完成前请勿切换租户，也不要关闭当前页面。',
            'sla.section.title.rect': '🔧 整改监控',
            'sla.section.title.risk': '⚠️ 常规风险监控',
            'sla.section.title.special': '🛠️ 专项风险监控',
            'sla.section.title.sr': '📞 SR详单分析',
            'sla.section.title.vuln': '🧯 漏洞预警分析',
            'sla.section.title.rectBatch': '🔧 整改详单合集',
            'sla.section.title.riskBatch': '⚠️ 常规风险合集',
            'sla.section.title.specialBatch': '🛠️ CPT专项风险合集',
            'sla.section.title.vulnBatch': '🧯 漏洞预警详单',
            'sla.section.title.other': '📁 独立表: {name}',
            'sla.empty.main': '请点击上方 <b>"📦 一键批量导入所有表"</b> 按钮，选择文件夹中需要分析的文件...',
            'sla.section.noRulesTitle': '当前表暂无指标规则',
            'sla.section.ruleSummary': '主{main} / 子{sub}',
            'sla.section.ruleSummaryCross': '主{main} / 子{sub} <span style="color:#ff9800; font-weight:bold; margin-left:4px;">+跨表子{cross}</span>',
            'sla.section.all': '全部数据',
            'sla.section.focus': '🔥 重点关注',
            'sla.section.danger': '🔴 紧急',
            'sla.section.warning': '🟠 提醒',
            'sla.section.searchPh': '🔍 当前表内搜索...',
            'sla.section.columns': '⚙️ 列设置 ▼',
            'sla.section.copyUnique': '📋 提取去重 ▼',
            'sla.section.metrics': '🎯 指标 ▼',
            'sla.section.export': '📥 导出',
            'sla.section.filterColumnsPh': '过滤列名...',
            'sla.section.selectAll': '全选',
            'sla.section.clear': '清空',
            'sla.section.copyHint': '点选列名进行去重提取：',
            'sla.section.copySearchPh': '🔍 搜索提取列名...',
            'sla.section.metricHint': '📌 配置顶部悬浮指标推送规则：',
            'sla.section.extractOne': '提取单行数值',
            'sla.section.extractMulti': '提取多行数值',
            'sla.section.countTimes': '统计满足次数',
            'sla.section.countRatio': '统计占比',
            'sla.section.colXOption': '1. 当此列(X)...',
            'sla.section.valYPh': '2. 包含内容(Y) (支持[空]/[非空])',
            'sla.section.colZOption': '3. 则提取该行此列(Z)的值',
            'sla.section.aggregateSum': '4. 多行数值求和（默认）',
            'sla.section.aggregateAvg': '4. 多行数值求平均值',
            'sla.section.aggregateMax': '4. 取多行数值最大值',
            'sla.section.aggregateMin': '4. 取多行数值最小值',
            'sla.section.aggregateCount': '4. 统计有效数值个数',
            'sla.section.conditionRelation': '全部过滤条件关系',
            'sla.section.conditionAnd': 'AND：主条件和附加条件全部满足',
            'sla.section.conditionOr': 'OR：主条件或任一附加条件满足',
            'sla.section.andConditionsHelp': '以下条件与上方主条件同时满足（AND），可不断增加。',
            'sla.section.multiConditionsHelp': '主条件与每条附加条件平级：AND 要求全部满足，OR 只需任意一个条件满足。',
            'sla.section.countXOption': '1. 筛选条件列(X)... (选填)',
            'sla.section.countYPh': '2. 筛选X列含内容(Y) (支持[空]/[非空])',
            'sla.section.countZOption': '3. 目标统计列(Z)',
            'sla.section.countKPh': '4. Z列含关键字(K) (支持[空]/[非空])',
            'sla.section.metricNamePh': '指标展示名称',
            'sla.section.color': '颜色',
            'sla.section.green': '绿(好)',
            'sla.section.red': '红(危)',
            'sla.section.yellow': '黄(警)',
            'sla.section.mainMetric': '作为主指标独立展示',
            'sla.section.chooseCategory': '选择分类',
            'sla.section.saveRule': '➕ 保存规则',
            'sla.section.dataScope': '数据范围:',
            'sla.section.scopeCurrent': '仅当前表 (默认)',
            'sla.section.scopeAll': '🌐 跨所有独立表联合提取',
            'sla.section.advancedFilter': '⚙️ 高级多重过滤',
            'sla.section.advancedHelp': '以下条件与上方主条件同时满足（AND），可不断增加。',
            'sla.section.addCondition': '＋ 增加列条件',
            'sla.section.noRules': '尚无推送规则',
            'sla.section.ruleEdit': '✎ 修改',
            'sla.section.ruleDelete': '✖ 删除',
            'sla.section.crossBadge': '🌐 跨所有独立表',
            'sla.section.crossNote': '(🌐 跨所有独立表联合提取)',
            'sla.section.crossSource': '(跨表数据源: {title})',
            'sla.section.inboundHeader': '🔁 本表作为跨表子指标数据源',
            'sla.section.uncategorized': '未分类',
            'sla.section.subMetricOf': '作为 [{parent}] 的子指标 (归属表: {table})',
            'sla.copy.noData': '当前无数据！',
            'sla.copy.noValid': '无有效数据！',
            'sla.copy.successCount': '✅ 提取成功 ({count}条)：\n{text}',
            'sla.copy.success': '✅ 提取成功：\n{text}',
            'sla.copy.fail': '复制失败',
            'sla.detail.title': '📄 详单行详情',
            'sla.detail.hideEmpty': '👁️ 自动隐藏空字段',
            'sla.detail.copyAll': '📋 复制全部非空字段',
            'sla.detail.syncMain': '📌 常用列置顶主表',
            'sla.detail.frequent': '⭐ 常用',
            'sla.metric.loadingConfig': '正在加载全网指标配置...',
            'sla.metric.noConfig': '当前没有可配置的指标。<br><br><span style="font-size:13px;">请先在下方独立表格中点击"🎯 指标"添加自定义指标。</span>',
            'sla.metric.monthLabel': '{month}月',
            'sla.metric.targetPh': '设定值',
            'sla.metric.gte': '≥ (越大越好)',
            'sla.metric.lte': '≤ (越小越好)',
            'sla.metric.gteShort': '≥ 越大越好',
            'sla.metric.lteShort': '≤ 越小越好',
            'sla.metric.percent': '百分比',
            'sla.metric.currentValue': '实时当前值:',
            'sla.metric.tableMode': '切换表格模式',
            'sla.metric.cardMode': '切换卡片模式',
            'sla.metric.tableModeTitle': '每个指标一行、每个月一列批量编辑',
            'sla.metric.cardModeTitle': '按指标卡片逐项编辑',
            'sla.metric.tableMetric': '指标',
            'sla.metric.tableCurrent': '当前值',
            'sla.metric.tableDirection': '预警方向',
            'sla.metric.targetStats': '总计 {total} 个指标，已填写目标 {filled} 个，未填写 {missing} 个',
            'sla.metric.saved': '✅ 预警目标已保存到服务端！',
            'sla.metric.noChanges': '目标配置没有变更',
            'sla.metric.saveFail': '❌ 保存失败',
            'sla.rules.loading': '正在读取已保存的指标规则...',
            'sla.rules.empty': '暂无匹配的指标规则。未导入表格时也会读取服务器已保存配置；如果这里为空，说明当前还没有保存过自定义指标规则。',
            'sla.rules.current': '当前导入',
            'sla.rules.saved': '已保存配置',
            'sla.rules.main': '主指标',
            'sla.rules.sub': '子指标',
            'sla.rules.crossSub': '跨表子指标',
            'sla.rules.childUnit': '子',
            'sla.rules.folded': '折叠于主指标',
            'sla.rules.view': '查看',
            'sla.rules.edit': '修改',
            'sla.rules.copy': '复制',
            'sla.rules.delete': '删除',
            'sla.rules.expand': '展开子指标',
            'sla.rules.collapse': '收起子指标',
            'sla.rules.summaryShown': '当前显示 <b>{count}</b> 条',
            'sla.rules.summaryCurrent': '当前导入 <b>{count}</b> 条',
            'sla.rules.summarySaved': '已保存配置 <b>{count}</b> 条',
            'sla.rules.summaryCross': '跨表规则 <b>{count}</b> 条',
            'sla.rules.summaryHint': '未导入表格时仍会读取服务器保存规则',
            'sla.rules.thLineage': '关系链路',
            'sla.rules.thTable': '规则表格',
            'sla.rules.thFilePrefix': '命中文件/表名前缀',
            'sla.rules.customFilePrefixMissing': '自定义导入表（{id}）',
            'sla.rules.customFilePrefixMissingTitle': '这是历史保存的自定义导入表规则，当前配置只保留规则ID：{id}，未保存原始文件名前缀。重新导入该表后会优先显示真实文件名。',
            'sla.rules.thSource': '来源',
            'sla.rules.thRuleType': '规则类型',
            'sla.rules.thMainMetric': '主指标名称',
            'sla.rules.thSubMetric': '子指标名称',
            'sla.rules.thMode': '模式',
            'sla.rules.thCondition': '条件 IF',
            'sla.rules.thResult': '展示/统计 THEN',
            'sla.rules.thRelation': '归属/挂载关系',
            'sla.rules.thAction': '操作',
            'sla.rules.independent': '主指标独立展示',
            'sla.rules.attachTo': '挂载到 {table} / {metric}',
            'sla.rules.attachToMetric': '挂载到 {metric}',
            'sla.rules.rootLine': '主指标',
            'sla.rules.crossAttach': '跨表挂载',
            'sla.rules.localAttach': '本表挂载',
            'sla.rules.otherTable': '独立表规则 ({id})',
            'sla.rules.unknownTable': '未知表',
            'sla.rules.extract': '提取',
            'sla.rules.extractMulti': '提取多行',
            'sla.rules.count': '统计',
            'sla.rules.ratio': '占比',
            'sla.rules.contains': 'contains',
            'sla.rules.and': 'and',
            'sla.rules.or': 'or',
            'sla.rules.allRows': '全量行',
            'sla.rules.totalRows': '总行数',
            'sla.rules.uncategorized': '未分类',
            'sla.rules.previewRule': '规则预览',
            'sla.rules.previewOwner': '归属预览',
            'sla.rules.emptyColumn': '(空/不指定列)',
            'sla.rules.noMainMetric': '无可用主指标',
            'sla.rules.notFoundConfig': '未找到对应的指标配置。',
            'sla.rules.notEditable': '未找到这条规则的可编辑配置，请刷新后重试。',
            'sla.rules.notFoundParent': '未找到新的挂载主指标',
            'sla.rules.saveMissing': '保存失败：规则已不存在，请刷新后重试。',
            'sla.rules.savedToast': '指标规则已保存。',
            'sla.rules.saveFail': '保存失败：{message}',
            'sla.rules.needName': '请填写指标名称。',
            'sla.rules.needColZ': '请填写展示/统计列 Z。',
            'sla.rules.needExtractFields': '提取模式需要填写条件列 X 和条件值 Y。',
            'sla.rules.needStatValue': '统计/占比模式需要填写统计值 K。',
            'sla.rules.copyOriginal': '原始规则',
            'sla.rules.copyRowPrefix': '第 {index} 行：',
            'sla.rules.copyMissingTarget': '未找到复制目标配置',
            'sla.rules.copySavedToast': '已复制保存 {count} 条指标规则。',
            'sla.rules.copyFail': '复制失败：{message}',
            'sla.rules.copyNeedOneRow': '至少需要保留一行待复制规则。',
            'sla.rules.fastMappingMainDisabled': '主指标复制不需要模板速填，请直接修改指标名称和字段。',
            'sla.rules.fastMappingMissingTemplate': '没有找到已保存的模板，请先点击“快速映射模板”进行配置。',
            'sla.rules.fastMappingParseEmpty': '没有解析到有效的映射数据，请检查格式。',
            'sla.rules.fastMappingApplied': '已成功应用 {count} 条映射配置。',
            'sla.rules.fastMappingSaveFail': '保存速填模板失败：{message}',
            'sla.rules.extractColX': '条件列 X',
            'sla.rules.extractValY': '条件值 Y',
            'sla.rules.extractColZ': '展示列 Z',
            'sla.rules.extractValK': '统计值 K',
            'sla.rules.countColX': '筛选列 X（可选）',
            'sla.rules.countValY': '筛选值 Y（可选）',
            'sla.rules.countColZ': '统计列 Z',
            'sla.rules.countValK': '统计值 K',
            'sla.rules.ratioColX': '分母筛选列 X（可选）',
            'sla.rules.ratioValY': '分母筛选值 Y（可选）',
            'sla.rules.ratioColZ': '分子列 Z',
            'sla.rules.ratioValK': '分子值 K',
            'sla.config.empty': '当前服务器没有可导出的记忆配置！请先导入表格使用后再试。',
            'sla.config.exported': '✅ 配置已导出',
            'sla.config.exportFail': '❌ 导出失败',
            'sla.config.readFail': '❌ 文件读取失败：\n{message}',
            'sla.config.parseFail': '❌ JSON 格式错误，无法解析配置文件：\n{message}\n\n请检查文件是否是通过"导出配置"下载的原始文件。',
            'sla.config.badRoot': '❌ 配置文件格式不正确：根节点必须是对象。',
            'sla.config.unknown': '❌ 无法识别配置文件格式。\n\n文件包含的字段：\n{fields}{more}\n\n支持的格式：\n① 新版平台导出的 {targets, prefs}\n② 旧版 Task SLA Killer 导出的 {sla_global_targets, sla_prefs_...}',
            'sla.config.imported': '✅ 配置导入成功！{formatTip}\n\n• 预警目标规则：{targets} 条\n• 表格偏好记录：{prefs} 张\n\n请重新导入表格文件，新的设置会自动生效。',
            'sla.config.legacyTip': '（已从旧版格式自动转换）',
            'sla.config.uploadFail': '❌ 配置上传到服务端失败：\n{message}\n\n请确认服务已启动（http://localhost:3030/api/health）。',
            'sla.category.exists': '分类已存在',
            'sla.category.saved': '✅ 分类保存成功',
            'sla.category.saveFail': '保存失败: {message}'
        },
        'en-US': {
            'sla.title': 'Task SLA Risk Monitor - Tools Platform',
            'sla.dialog.notice': 'Notice',
            'sla.dialog.error': 'Operation failed',
            'sla.dialog.done': 'Done',
            'sla.dialog.confirm': 'Please confirm',
            'sla.dialog.continue': 'Continue',
            'sla.dialog.cancel': 'Cancel',
            'sla.description': 'Global Task SLA and risk monitoring console combining rectification, regular risk, and special risk tables.',
            'sla.sticky.title': '⚡ Core Metrics:',
            'sla.sticky.empty': '(No metrics configured. Click "🎯 Metrics" in a table below to add one.)',
            'sla.sticky.noData': '(No data imported. Use "🎯 Alert Config" on the right to configure known metric targets.)',
            'sla.sticky.targetConfig': '🎯 Alert Config',
            'sla.sticky.expand': '🔽 Expand',
            'sla.sticky.collapse': '🔼 Collapse',
            'sla.modal.targetTitle': '🎯 Configure Monthly Targets and Alert Direction',
            'sla.modal.saveTargets': 'Save Global Alert Config',
            'sla.modal.rulesTitle': '📚 All Metric Rules',
            'sla.modal.rulesSearch': 'Search table, metric, field, keyword, category...',
            'sla.modal.crossOnly': 'Cross-table rules only',
            'sla.rules.monthlyOrigin': 'Created in monthly editor',
            'sla.rules.monthlyScope': 'Uses the source type and worksheet selected when created',
            'sla.modal.aggFirst': 'First source row (text allowed)',
            'sla.modal.editTitle': '✏️ Edit Metric Rule',
            'sla.modal.editSubtitle': 'Adjust mode, conditions, display statistics, and ownership',
            'sla.modal.metricName': 'Metric Name',
            'sla.modal.metricNamePh': 'Example: callback rate',
            'sla.modal.mode': 'Mode',
            'sla.modal.extract': 'Extract SHOW',
            'sla.modal.extractMulti': 'Multi-row AGGREGATE',
            'sla.modal.count': 'Count COUNT',
            'sla.modal.ratio': 'Ratio RATIO',
            'sla.modal.category': 'Sub-metric Category',
            'sla.modal.parent': 'Attach to Main Metric',
            'sla.modal.colX': 'Condition Column X',
            'sla.modal.valY': 'Condition Value Y',
            'sla.modal.valYPh': 'Keyword to include, optional',
            'sla.modal.colZ': 'Display/Count Column Z',
            'sla.modal.valK': 'Count Value K',
            'sla.modal.valKPh': 'Numerator keyword',
            'sla.modal.aggregation': 'Multi-row calculation',
            'sla.modal.filterLogic': 'All-filter relationship',
            'sla.modal.aggSum': 'Sum (default)',
            'sla.modal.aggAvg': 'Average',
            'sla.modal.aggMax': 'Maximum',
            'sla.modal.aggMin': 'Minimum',
            'sla.modal.aggCount': 'Numeric value count',
            'sla.modal.logicAnd': 'AND: match primary and all additional conditions',
            'sla.modal.logicOr': 'OR: match primary or any additional condition',
            'sla.modal.cancel': 'Cancel',
            'sla.modal.save': 'Save Changes',
            'sla.modal.copyTitle': '📋 Copy Metric Rule',
            'sla.modal.copySubtitle': 'Copy in bulk, edit each row, then save',
            'sla.modal.copyCount': 'Copy Count',
            'sla.modal.copyHint': 'Each row creates a new rule. Edit names, mode, fields, and attachment before saving.',
            'sla.modal.copySave': 'Save Copies',
            'sla.modal.fastApply': '⚡ Quick Mapping Fill',
            'sla.modal.fastTemplate': 'Quick Mapping Template',
            'sla.modal.mappingTitle': 'Edit Quick Mapping Template',
            'sla.modal.mappingSubtitle': 'Use two fixed columns. Paste two copied Excel columns into any cell to auto-fill.',
            'sla.modal.mappingHint': 'Categories come from global categories. Pasting one Excel column fills condition values downward; pasting two columns matches by category name.',
            'sla.modal.mappingCategory': 'Sub-metric Category',
            'sla.modal.mappingCondition': 'Condition Value',
            'sla.modal.mappingSaveApply': 'Save and Apply',
            'sla.category.title': '🏷️ Metric Dimension Categories (Customer Group / Office / Region)',
            'sla.category.inputPh': 'Enter new category...',
            'sla.category.add': '➕ Add',
            'sla.category.save': 'Save Categories',
            'sla.history.title': '📈 Import Alert Snapshot History',
            'sla.history.loading': 'Loading historical snapshots...',
            'sla.history.loadingShort': 'Loading...',
            'sla.history.loadFail': 'Load failed: {message}',
            'sla.history.empty': 'No historical snapshots yet. Import table data first to generate one.',
            'sla.history.importTime': '🕒 Import Time',
            'sla.history.targetMonth': 'Month {month} Target',
            'sla.history.sourceTables': 'Source Tables',
            'sla.history.summary': '📊 Summary',
            'sla.history.expandSummary': 'Expand summary ({count})',
            'sla.history.delete': 'Delete',
            'sla.history.loadOriginals': 'Load into current page',
            'sla.history.loadOriginalsTitle': 'Review all original files and worksheets from this import batch without creating a new snapshot',
            'sla.history.loadingOriginals': 'Loading…',
            'sla.history.noOriginals': 'No original archive is available for this record.',
            'sla.history.noWorksheets': 'The original files contain no worksheets to load.',
            'sla.history.reviewTitle': 'Original data review · {time}',
            'sla.history.reviewNote': 'Loaded all {files} original files and {sheets} worksheets in this batch without target-month filtering. Loading does not upload data again or create a new snapshot. Saving metric rules stores recalculated results separately; historical scores are unchanged. Import groups, monitoring, metric highlights and core metrics are restored using current rules and date, with saved snapshot metric rules as a fallback. Supplementary worksheets are for review and excluded from cross-table metrics.',
            'sla.history.originalsLoaded': 'Original tables loaded. Switch tabs to review each worksheet.',
            'sla.history.originalsLoadFail': 'Unable to load originals: {message}',
            'sla.history.deleteTitle': 'Delete this snapshot',
            'sla.history.confirmDelete': 'Delete this historical snapshot? This cannot be undone.',
            'sla.history.deleted': '✅ Snapshot deleted',
            'sla.history.deleteFail': '❌ Delete failed: {message}',
            'sla.history.featherLoading': 'Preparing historical snapshots…',
            'sla.history.stepSnapshots': 'Read snapshot records',
            'sla.history.stepConfig': 'Load warning targets and formats',
            'sla.history.stepCatalog': 'Check original file catalog',
            'sla.history.stepRender': 'Render page view and metrics',
            'sla.history.stepCount': '{settled} / {total} steps',
            'sla.history.stepReady': 'Ready',
            'sla.history.stepRunning': 'Loading',
            'sla.history.stepWaiting': 'Waiting',
            'sla.history.paginationSummary': 'Total {total} snapshots · Showing {start} - {end}',
            'sla.history.paginationSummaryAll': 'Total {total} snapshots · Showing all records',
            'sla.history.pageSizeLabel': 'Per page:',
            'sla.history.pageSizeUnit': '{size} / page',
            'sla.history.pageSizeDefault': '10 / page (default)',
            'sla.history.pageSizeAll': 'Show all',
            'sla.history.firstPage': 'First',
            'sla.history.prevPage': '‹ Prev',
            'sla.history.nextPage': 'Next ›',
            'sla.history.lastPage': 'Last',
            'sla.history.jumpTo': 'Go to',
            'sla.history.pageUnit': 'page',
            'sla.history.deleteProgressTitle': 'Deleting snapshot…',
            'sla.history.deleteStepRequest': 'Submitting delete request…',
            'sla.history.deleteStepClean': 'Cleaning up snapshot database record…',
            'sla.history.deleteStepFiles': 'Cleaning up original file archives…',
            'sla.history.deleteStepFinish': 'Done. Refreshing snapshot list…',
            'sla.header.title': '📊 Global Data Control Center',
            'sla.header.edition': 'Flagship Custom',
            'sla.version.loading': 'v loading',
            'sla.version.unmarked': 'v unmarked',
            'sla.version.title': 'Platform version: {version}',
            'sla.version.missing': 'Platform version unavailable',
            'sla.action.categories': '🏷️ Categories',
            'sla.action.history': '📈 History',
            'sla.action.rules': '📚 Rules',
            'sla.action.exportConfig': '💾 Export Config',
            'sla.action.exportConfigTitle': 'Back up column widths, visibility, top metrics, and alert targets',
            'sla.action.importConfig': '📂 Import Config',
            'sla.action.importConfigTitle': 'Import a config file to restore settings',
            'sla.source.mode': 'SLA source mode:',
            'sla.source.targetMonth': 'Target month:',
            'sla.source.auto': 'Auto Mode',
            'sla.source.json': 'JSON',
            'sla.source.sqlite': 'Force SQLite',
            'sla.source.targets': 'Target source: {source}',
            'sla.source.prefs': 'Preference source: {source}',
            'sla.source.categories': 'Category source: {source}',
            'sla.source.groups': 'Group source: {source}',
            'sla.source.snapshots': 'Snapshot source: {source}',
            'sla.source.initialNote': 'The page displays real read sources during migration for validation.',
            'sla.source.currentNote': 'Current mode: {mode} · Real read sources are shown during migration.',
            'sla.month.option': 'Month {month} Target',
            'sla.rule.rectTitle': '🔧 Rectification',
            'sla.rule.riskTitle': '⚠️ Regular Risk',
            'sla.rule.specialTitle': '🛠️ Special Risk',
            'sla.rule.srTitle': '📞 SR Details',
            'sla.rule.vulnTitle': '🧯 Vulnerability',
            'sla.rule.strictPrefix': 'File: ',
            'sla.rule.rectFile': 'prefix PBI_自动抓取-整改详单_整改_Latest',
            'sla.rule.rectStatusField': 'Status: task_status',
            'sla.rule.rectChecking': 'Checking: task_create_time +30d; red ≤10d left, yellow <30d',
            'sla.rule.rectification': 'Rectification Implementation: rectify_plan_end_time; red ≤10d left, yellow <82d',
            'sla.rule.riskFile': 'prefix PBI_自动抓取-风险详单_Latest',
            'sla.rule.riskStatusField': 'Status: 风险状态 → risk_status (first non-empty)',
            'sla.rule.confirming': 'Risk Confirming: created/create_time +30d; red ≤10d left, purple <30d',
            'sla.rule.open': 'Open / Suspended / Complete Reviewing: ticket_close_due_date; red ≤10d left, purple <30d',
            'sla.rule.suspended': 'Empty due date: try due_time / suspended expected close / suspend_due_date',
            'sla.rule.specialFile': 'prefix PBI_自动抓取-CPT风险详表_Latest',
            'sla.rule.specialStatusField': 'Status: 状态-Status → task_status_en → task_status → task_status_cn (first non-empty)',
            'sla.rule.toConfirm': 'To Be Confirmed/Draft/Confirm(ing): create date +30d; red ≤10d left, cyan <30d',
            'sla.rule.processing': 'Processing/Reviewing: required completion date; red ≤10d left, cyan <30d',
            'sla.rule.srFile': 'prefix PBI_自动抓取-详单-SR_Latest',
            'sla.rule.srStatusField': 'Status: sr_status_name',
            'sla.rule.srMonitor': 'Due: sus_exp_close_date first, otherwise exp_close_date',
            'sla.rule.suspend': 'Ignore: Pending / Suspend / Hold / 挂起',
            'sla.rule.srOverdue': 'Overdue/severity: overdue; hw_sev_name / urgency (Critical threshold)',
            'sla.rule.vulnFile': 'prefix PBI_自动抓取-详单漏洞_漏洞预警_Latest',
            'sla.rule.vulnStatusField': 'Status: task_status',
            'sla.rule.vulnStatus': 'Scope: Checking / Communication Dept / Communication Customer',
            'sla.rule.vulnCreate': 'Limit: create_time or task_create_time +30d; red ≤10d left, yellow <30d',
            'sla.upload.batch': '📦 Batch Import All Tables (Smart Routing & Merge)',
            'sla.upload.rect': 'Import [Rectification]',
            'sla.upload.risk': 'Import [Regular]',
            'sla.upload.special': 'Import [Special]',
            'sla.upload.sr': 'Import [SR]',
            'sla.upload.vuln': 'Import [Vulnerability]',
            'sla.upload.clearCache': 'Clear Current Cache',
            'sla.upload.confirmClearCache': 'Clear the current import cache? This only removes the browser-saved current import content. Historical snapshots, upload history, and server config will not be deleted.',
            'sla.upload.clearCacheSuccess': 'Current import cache cleared',
            'sla.upload.clearCacheFail': 'Failed to clear the import cache. Check browser local storage permissions.',
            'sla.upload.cachedTitle': '📊 Restored Last Import',
            'sla.upload.restoreLoading': '⏳ Restoring last imported data...',
            'sla.upload.restoreSuccess': '✅ Restored last imported data',
            'sla.upload.restoreFailTitle': 'Failed to Restore Last Import',
            'sla.upload.restoreFail': 'Failed to restore the last import. Please import files again.',
            'sla.upload.cacheLarge': '⚠️ This table is large and local browser cache is full. You may need to import again after switching pages.',
            'sla.upload.cacheTooLargeTitle': 'The last import was too large to save as a restore cache',
            'sla.upload.cacheTooLargeBody': 'The import completed for the current page, but the browser local cache did not have enough space to save the full workspace. After refresh or navigation, please import the original files again. Historical snapshots, upload history, and server settings are not affected.',
            'sla.upload.cacheTooLargeRows': '{rows} rows involved',
            'sla.upload.cacheTooLargeFiles': '{count} files',
            'sla.upload.cacheTooLargeTime': 'Time {time}',
            'sla.upload.cacheTooLargeDismiss': 'Got it',
            'sla.upload.cacheTooLargeClear': 'Import files again',
            'sla.upload.parseLoading': '⏳ Parsing table data, please wait...',
            'sla.upload.emptyFile': 'Read failed or the table is empty.',
            'sla.upload.smartLoading': '⏳ Starting smart routing engine for all files...',
            'sla.upload.cachedSpecific': '📊 Cached {title}',
            'sla.upload.batchSuccess': '📊 Batch import complete ({count} files parsed)',
            'sla.upload.uivAutoLoading': '⏳ Receiving UIVF12 capture files and importing them automatically...',
            'sla.upload.uivTenantWarning': '⚠️ Do not switch tenants or close this page until automatic import is complete.',
            'sla.section.title.rect': '🔧 Rectification Monitor',
            'sla.section.title.risk': '⚠️ Regular Risk Monitor',
            'sla.section.title.special': '🛠️ Special Risk Monitor',
            'sla.section.title.sr': '📞 SR Detail Analysis',
            'sla.section.title.vuln': '🧯 Vulnerability Alert Analysis',
            'sla.section.title.rectBatch': '🔧 Rectification Details',
            'sla.section.title.riskBatch': '⚠️ Regular Risk Details',
            'sla.section.title.specialBatch': '🛠️ CPT Special Risks',
            'sla.section.title.vulnBatch': '🧯 Vulnerability Alerts',
            'sla.section.title.other': '📁 Standalone Table: {name}',
            'sla.empty.main': 'Click <b>"📦 Batch Import All Tables"</b> above and choose files to analyze...',
            'sla.section.noRulesTitle': 'No metric rules for this table',
            'sla.section.ruleSummary': 'Main {main} / Sub {sub}',
            'sla.section.ruleSummaryCross': 'Main {main} / Sub {sub} <span style="color:#ff9800; font-weight:bold; margin-left:4px;">+ Cross Sub {cross}</span>',
            'sla.section.all': 'All Data',
            'sla.section.focus': '🔥 Focus',
            'sla.section.danger': '🔴 Urgent',
            'sla.section.warning': '🟠 Warning',
            'sla.section.searchPh': '🔍 Search this table...',
            'sla.section.columns': '⚙️ Columns ▼',
            'sla.section.copyUnique': '📋 Unique Extract ▼',
            'sla.section.metrics': '🎯 Metrics ▼',
            'sla.section.export': '📥 Export',
            'sla.section.filterColumnsPh': 'Filter columns...',
            'sla.section.selectAll': 'Select All',
            'sla.section.clear': 'Clear',
            'sla.section.copyHint': 'Click a column to extract unique values:',
            'sla.section.copySearchPh': '🔍 Search extract columns...',
            'sla.section.metricHint': '📌 Configure top floating metric rule:',
            'sla.section.extractOne': 'Extract single-row value',
            'sla.section.extractMulti': 'Extract multiple rows',
            'sla.section.countTimes': 'Count matches',
            'sla.section.countRatio': 'Count ratio',
            'sla.section.colXOption': '1. When column X...',
            'sla.section.valYPh': '2. Contains Y ([empty]/[non-empty] supported)',
            'sla.section.colZOption': '3. Extract value from column Z',
            'sla.section.aggregateSum': '4. Sum values (default)',
            'sla.section.aggregateAvg': '4. Average values',
            'sla.section.aggregateMax': '4. Maximum value',
            'sla.section.aggregateMin': '4. Minimum value',
            'sla.section.aggregateCount': '4. Count numeric values',
            'sla.section.conditionRelation': 'All-filter relationship',
            'sla.section.conditionAnd': 'AND: match primary and all additional conditions',
            'sla.section.conditionOr': 'OR: match primary or any additional condition',
            'sla.section.andConditionsHelp': 'All conditions must match the primary condition (AND). Add more as needed.',
            'sla.section.multiConditionsHelp': 'The primary and additional conditions are peers: AND matches all, while OR matches any one condition.',
            'sla.section.countXOption': '1. Filter column X... (optional)',
            'sla.section.countYPh': '2. Filter X by Y ([empty]/[non-empty] supported)',
            'sla.section.countZOption': '3. Target count column Z',
            'sla.section.countKPh': '4. Z contains keyword K ([empty]/[non-empty] supported)',
            'sla.section.metricNamePh': 'Metric display name',
            'sla.section.color': 'Color',
            'sla.section.green': 'Green',
            'sla.section.red': 'Red',
            'sla.section.yellow': 'Yellow',
            'sla.section.mainMetric': 'Show as independent main metric',
            'sla.section.chooseCategory': 'Choose category',
            'sla.section.saveRule': '➕ Save Rule',
            'sla.section.dataScope': 'Data Scope:',
            'sla.section.scopeCurrent': 'Current table only (Default)',
            'sla.section.scopeAll': '🌐 Joint extract across all tables',
            'sla.section.advancedFilter': '⚙️ Advanced Multi-Filter',
            'sla.section.advancedHelp': 'The conditions below must be satisfied together with the primary condition (AND). Add more as needed.',
            'sla.section.addCondition': '＋ Add Column Condition',
            'sla.section.noRules': 'No push rules configured',
            'sla.section.ruleEdit': '✎ Edit',
            'sla.section.ruleDelete': '✖ Delete',
            'sla.section.crossBadge': '🌐 Across all tables',
            'sla.section.crossNote': '(🌐 Joint extract across all tables)',
            'sla.section.crossSource': '(Cross-table source: {title})',
            'sla.section.inboundHeader': '🔁 This table acts as a cross-table sub-metric data source',
            'sla.section.uncategorized': 'Uncategorized',
            'sla.section.subMetricOf': 'As sub-metric of [{parent}] (Table: {table})',
            'sla.copy.noData': 'No data currently displayed.',
            'sla.copy.noValid': 'No valid data.',
            'sla.copy.successCount': '✅ Extracted ({count} items):\n{text}',
            'sla.copy.success': '✅ Extracted:\n{text}',
            'sla.copy.fail': 'Copy failed',
            'sla.detail.title': '📄 Row Details',
            'sla.detail.hideEmpty': '👁️ Auto-hide Empty Fields',
            'sla.detail.copyAll': '📋 Copy All Non-Empty',
            'sla.detail.syncMain': '📌 Pin Frequent to Main',
            'sla.detail.frequent': '⭐ Frequent',
            'sla.metric.loadingConfig': 'Loading global metric config...',
            'sla.metric.noConfig': 'No configurable metrics yet.<br><br><span style="font-size:13px;">Click "🎯 Metrics" in a table below to add a custom metric.</span>',
            'sla.metric.monthLabel': 'Month {month}',
            'sla.metric.targetPh': 'Target',
            'sla.metric.gte': '≥ (higher is better)',
            'sla.metric.lte': '≤ (lower is better)',
            'sla.metric.gteShort': '≥ Higher',
            'sla.metric.lteShort': '≤ Lower',
            'sla.metric.percent': 'Percent',
            'sla.metric.currentValue': 'Current value:',
            'sla.metric.tableMode': 'Table View',
            'sla.metric.cardMode': 'Card View',
            'sla.metric.tableModeTitle': 'Edit one metric per row and one month per column',
            'sla.metric.cardModeTitle': 'Edit targets by metric cards',
            'sla.metric.tableMetric': 'Metric',
            'sla.metric.tableCurrent': 'Current',
            'sla.metric.tableDirection': 'Direction',
            'sla.metric.targetStats': '{total} metrics total, {filled} with targets, {missing} missing',
            'sla.metric.saved': '✅ Alert targets saved to server',
            'sla.metric.noChanges': 'No target changes',
            'sla.metric.saveFail': '❌ Save failed',
            'sla.rules.loading': 'Reading saved metric rules...',
            'sla.rules.empty': 'No matching metric rules. Saved server config is still checked when no table is imported; if this is empty, no custom metric rules have been saved yet.',
            'sla.rules.current': 'Current Import',
            'sla.rules.saved': 'Saved Config',
            'sla.rules.main': 'Main Metric',
            'sla.rules.sub': 'Sub-metric',
            'sla.rules.crossSub': 'Cross-table Sub',
            'sla.rules.childUnit': 'Sub',
            'sla.rules.folded': 'Folded under main metric',
            'sla.rules.view': 'View',
            'sla.rules.edit': 'Edit',
            'sla.rules.copy': 'Copy',
            'sla.rules.delete': 'Delete',
            'sla.rules.expand': 'Expand sub-metrics',
            'sla.rules.collapse': 'Collapse sub-metrics',
            'sla.rules.summaryShown': 'Showing <b>{count}</b>',
            'sla.rules.summaryCurrent': 'Current import <b>{count}</b>',
            'sla.rules.summarySaved': 'Saved config <b>{count}</b>',
            'sla.rules.summaryCross': 'Cross-table rules <b>{count}</b>',
            'sla.rules.summaryHint': 'Saved server rules are shown even before importing tables',
            'sla.rules.thLineage': 'Lineage',
            'sla.rules.thTable': 'Rule Table',
            'sla.rules.thFilePrefix': 'Matched File / Table Prefix',
            'sla.rules.customFilePrefixMissing': 'Custom imported table ({id})',
            'sla.rules.customFilePrefixMissingTitle': 'This is a saved custom imported-table rule. The current config only keeps rule ID {id}; the original file prefix was not saved. Re-importing the table will show the real source file name first.',
            'sla.rules.thSource': 'Source',
            'sla.rules.thRuleType': 'Rule Type',
            'sla.rules.thMainMetric': 'Main Metric',
            'sla.rules.thSubMetric': 'Sub-metric',
            'sla.rules.thMode': 'Mode',
            'sla.rules.thCondition': 'Condition IF',
            'sla.rules.thResult': 'Display / Count THEN',
            'sla.rules.thRelation': 'Owner / Attachment',
            'sla.rules.thAction': 'Actions',
            'sla.rules.independent': 'Independent main metric',
            'sla.rules.attachTo': 'Attached to {table} / {metric}',
            'sla.rules.attachToMetric': 'Attached to {metric}',
            'sla.rules.rootLine': 'Main Metric',
            'sla.rules.crossAttach': 'Cross-table Attachment',
            'sla.rules.localAttach': 'Same-table Attachment',
            'sla.rules.otherTable': 'Standalone table rule ({id})',
            'sla.rules.unknownTable': 'Unknown table',
            'sla.rules.extract': 'Extract',
            'sla.rules.extractMulti': 'Multi-row extract',
            'sla.rules.count': 'Count',
            'sla.rules.ratio': 'Ratio',
            'sla.rules.contains': 'contains',
            'sla.rules.and': 'and',
            'sla.rules.or': 'or',
            'sla.rules.allRows': 'All rows',
            'sla.rules.totalRows': 'total rows',
            'sla.rules.uncategorized': 'Uncategorized',
            'sla.rules.previewRule': 'Rule Preview',
            'sla.rules.previewOwner': 'Owner Preview',
            'sla.rules.emptyColumn': '(empty / no column)',
            'sla.rules.noMainMetric': 'No available main metric',
            'sla.rules.notFoundConfig': 'Metric configuration not found.',
            'sla.rules.notEditable': 'Editable config for this rule was not found. Refresh and try again.',
            'sla.rules.notFoundParent': 'New parent main metric not found',
            'sla.rules.saveMissing': 'Save failed: this rule no longer exists. Refresh and try again.',
            'sla.rules.savedToast': 'Metric rule saved.',
            'sla.rules.saveFail': 'Save failed: {message}',
            'sla.rules.needName': 'Enter a metric name.',
            'sla.rules.needColZ': 'Choose display/count column Z.',
            'sla.rules.needExtractFields': 'Extract mode requires condition column X and condition value Y.',
            'sla.rules.needStatValue': 'Count/ratio mode requires count value K.',
            'sla.rules.copyOriginal': 'Original Rule',
            'sla.rules.copyRowPrefix': 'Row {index}: ',
            'sla.rules.copyMissingTarget': 'Copy target config was not found',
            'sla.rules.copySavedToast': 'Copied and saved {count} metric rules.',
            'sla.rules.copyFail': 'Copy failed: {message}',
            'sla.rules.copyNeedOneRow': 'Keep at least one rule row to copy.',
            'sla.rules.fastMappingMainDisabled': 'Quick mapping is not needed for main metric copies. Edit the metric name and fields directly.',
            'sla.rules.fastMappingMissingTemplate': 'No saved template found. Click "Quick Mapping Template" to configure one first.',
            'sla.rules.fastMappingParseEmpty': 'No valid mapping data was parsed. Check the format.',
            'sla.rules.fastMappingApplied': 'Applied {count} mapping rows.',
            'sla.rules.fastMappingSaveFail': 'Failed to save quick-fill template: {message}',
            'sla.rules.extractColX': 'Condition Column X',
            'sla.rules.extractValY': 'Condition Value Y',
            'sla.rules.extractColZ': 'Display Column Z',
            'sla.rules.extractValK': 'Count Value K',
            'sla.rules.countColX': 'Filter Column X (optional)',
            'sla.rules.countValY': 'Filter Value Y (optional)',
            'sla.rules.countColZ': 'Count Column Z',
            'sla.rules.countValK': 'Count Value K',
            'sla.rules.ratioColX': 'Denominator Filter Column X (optional)',
            'sla.rules.ratioValY': 'Denominator Filter Value Y (optional)',
            'sla.rules.ratioColZ': 'Numerator Column Z',
            'sla.rules.ratioValK': 'Numerator Value K',
            'sla.config.empty': 'No memory configuration exists on the server yet. Import table data first, then try again.',
            'sla.config.exported': '✅ Config exported',
            'sla.config.exportFail': '❌ Export failed',
            'sla.config.readFail': '❌ File read failed:\n{message}',
            'sla.config.parseFail': '❌ JSON parse failed:\n{message}\n\nCheck whether this is the original file downloaded from Export Config.',
            'sla.config.badRoot': '❌ Invalid config file: root must be an object.',
            'sla.config.unknown': '❌ Unknown config file format.\n\nFields in file:\n{fields}{more}\n\nSupported formats:\n1. New platform export {targets, prefs}\n2. Legacy Task SLA Killer export {sla_global_targets, sla_prefs_...}',
            'sla.config.imported': '✅ Config imported! {formatTip}\n\n• Alert target rules: {targets}\n• Table preference records: {prefs}\n\nRe-import table files for the new settings to take effect.',
            'sla.config.legacyTip': '(converted from legacy format)',
            'sla.config.uploadFail': '❌ Failed to upload config to server:\n{message}\n\nConfirm the service is running (http://localhost:3030/api/health).',
            'sla.category.exists': 'Category already exists',
            'sla.category.saved': '✅ Categories saved',
            'sla.category.saveFail': 'Save failed: {message}'
        }
    };

    function t(key, params = {}) {
        return window.ToolsI18n ? window.ToolsI18n.t(key, params) : key;
    }

    function setText(selector, value) {
        const el = document.querySelector(selector);
        if (el) el.textContent = value;
    }

    function setHtml(selector, value) {
        const el = document.querySelector(selector);
        if (el) el.innerHTML = value;
    }

    function setPlaceholder(selector, value) {
        const el = document.querySelector(selector);
        if (el) el.placeholder = value;
    }

    function sourceLabel(source) {
        if (source === 'sqlite') return 'SQLite';
        if (source === 'json') return 'JSON';
        if (source === 'auto') return t('sla.source.auto');
        return source || '-';
    }

    function applyPage() {
        document.title = t('sla.title');
        const desc = document.querySelector('meta[name="description"]');
        if (desc) desc.setAttribute('content', t('sla.description'));
        setText('.sticky-bar-title', t('sla.sticky.title'));
        setHtml('#sticky-bar-content', `<span style="color:#888;">${t('sla.sticky.empty')}</span>`);
        setText('#btn-target-config', t('sla.sticky.targetConfig'));
        setText('#btn-expand-metrics', t('sla.sticky.expand'));
        setText('#target-modal h3', t('sla.modal.targetTitle'));
        setText('#target-modal .btn-save', t('sla.modal.saveTargets'));
        const targetViewToggle = document.getElementById('target-view-toggle');
        if (targetViewToggle) {
            const isTable = typeof targetModalState !== 'undefined' && targetModalState.view === 'table';
            targetViewToggle.textContent = t(isTable ? 'sla.metric.cardMode' : 'sla.metric.tableMode');
            targetViewToggle.title = t(isTable ? 'sla.metric.cardModeTitle' : 'sla.metric.tableModeTitle');
        }
        setText('#metric-rules-modal h3', t('sla.modal.rulesTitle'));
        setPlaceholder('#metric-rules-search', t('sla.modal.rulesSearch'));
        const crossOnly = document.querySelector('.metric-rules-check');
        if (crossOnly) {
            const input = crossOnly.querySelector('input');
            crossOnly.textContent = ' ' + t('sla.modal.crossOnly');
            if (input) crossOnly.prepend(input);
        }
        setText('#metric-rule-edit-modal h3', t('sla.modal.editTitle'));
        setText('#metric-rule-edit-subtitle', t('sla.modal.editSubtitle'));
        const editLabels = document.querySelectorAll('#metric-rule-edit-modal .metric-rule-edit-field > span');
        [
            'sla.modal.metricName', 'sla.modal.mode', 'sla.modal.category', 'sla.modal.parent',
            'sla.modal.colX', 'sla.modal.valY', 'sla.modal.colZ', 'sla.modal.valK'
        ].forEach((key, index) => { if (editLabels[index]) editLabels[index].textContent = t(key); });
        setPlaceholder('#metric-rule-edit-label', t('sla.modal.metricNamePh'));
        setText('#metric-rule-edit-type option[value="extract"]', t('sla.modal.extract'));
        setText('#metric-rule-edit-type option[value="extract_multi"]', t('sla.modal.extractMulti'));
        setText('#metric-rule-edit-type option[value="count"]', t('sla.modal.count'));
        setText('#metric-rule-edit-type option[value="ratio"]', t('sla.modal.ratio'));
        const multiLabels = document.querySelectorAll('.metric-rule-edit-multi-only > span');
        if (multiLabels[0]) multiLabels[0].textContent = t('sla.modal.aggregation');
        if (multiLabels[1]) multiLabels[1].textContent = t('sla.modal.filterLogic');
        const monthlyOnly = document.querySelector('#metric-rules-monthly-only')?.parentElement;
        if (monthlyOnly) {const input=monthlyOnly.querySelector('input');monthlyOnly.textContent=' '+t('sla.rules.monthlyOrigin');monthlyOnly.prepend(input);}
        setText('#metric-rule-edit-aggregation option[value="first"]', t('sla.modal.aggFirst'));
        setText('#metric-rule-edit-aggregation option[value="sum"]', t('sla.modal.aggSum'));
        setText('#metric-rule-edit-aggregation option[value="avg"]', t('sla.modal.aggAvg'));
        setText('#metric-rule-edit-aggregation option[value="max"]', t('sla.modal.aggMax'));
        setText('#metric-rule-edit-aggregation option[value="min"]', t('sla.modal.aggMin'));
        setText('#metric-rule-edit-aggregation option[value="count"]', t('sla.modal.aggCount'));
        setText('#metric-rule-edit-filter-logic option[value="and"]', t('sla.modal.logicAnd'));
        setText('#metric-rule-edit-filter-logic option[value="or"]', t('sla.modal.logicOr'));
        setPlaceholder('#metric-rule-edit-valy', t('sla.modal.valYPh'));
        setPlaceholder('#metric-rule-edit-valk', t('sla.modal.valKPh'));
        setText('#metric-rule-edit-modal .metric-rule-edit-cancel', t('sla.modal.cancel'));
        setText('#metric-rule-edit-modal .metric-rule-edit-save', t('sla.modal.save'));
        setText('#metric-rule-copy-modal h3', t('sla.modal.copyTitle'));
        setText('#metric-rule-copy-subtitle', t('sla.modal.copySubtitle'));
        setText('#metric-rule-copy-modal .metric-rule-copy-count-field > span', t('sla.modal.copyCount'));
        setText('#metric-rule-copy-modal .metric-rule-copy-hint', t('sla.modal.copyHint'));
        const copySave = document.querySelector('#metric-rule-copy-modal .metric-rule-edit-save');
        if (copySave) copySave.textContent = t('sla.modal.copySave');
        const copyCancel = document.querySelector('#metric-rule-copy-modal .metric-rule-edit-cancel');
        if (copyCancel) copyCancel.textContent = t('sla.modal.cancel');
        setText('#metric-rule-fast-apply-btn', t('sla.modal.fastApply'));
        setText('#metric-rule-fast-template-btn', t('sla.modal.fastTemplate'));
        const copyHeaders = document.querySelectorAll('#metric-rule-copy-modal .metric-rule-copy-table th');
        if (typeof window.updateMetricRuleCopyHeaders === 'function') {
            const type = window.copyingMetricRuleRecord ? (window.findMetricRuleRef?.(window.copyingMetricRuleRecord)?.rule?.type || 'extract') : 'extract';
            window.updateMetricRuleCopyHeaders(type);
        } else {
            [
                '#', 'sla.modal.metricName', 'sla.modal.mode', 'sla.modal.category', 'sla.modal.parent',
                'sla.modal.colX', 'sla.modal.valY', 'sla.modal.colZ', 'sla.modal.valK', 'sla.rules.thAction'
            ].forEach((key, index) => {
                if (!copyHeaders[index]) return;
                copyHeaders[index].textContent = key === '#' ? '#' : t(key);
            });
        }
        setText('#metric-rule-mapping-modal h3', t('sla.modal.mappingTitle'));
        setText('#metric-rule-mapping-modal .metric-rule-template-header p', t('sla.modal.mappingSubtitle'));
        setText('#metric-rule-mapping-modal .metric-rule-template-toolbar span', t('sla.modal.mappingHint'));
        const mappingHeaders = document.querySelectorAll('#metric-rule-mapping-modal .metric-rule-template-table th');
        ['#', 'sla.modal.mappingCategory', 'sla.modal.mappingCondition'].forEach((key, index) => {
            if (!mappingHeaders[index]) return;
            mappingHeaders[index].textContent = key === '#' ? '#' : t(key);
        });
        const mappingCancel = document.querySelector('#metric-rule-mapping-modal .metric-rule-template-footer .metric-rule-mapping-btn.secondary');
        if (mappingCancel) mappingCancel.textContent = t('sla.modal.cancel');
        const mappingApply = document.querySelector('#metric-rule-mapping-modal .metric-rule-template-footer .metric-rule-mapping-btn:not(.secondary)');
        if (mappingApply) mappingApply.textContent = t('sla.modal.mappingSaveApply');
        setText('#category-modal h3', t('sla.category.title'));
        setPlaceholder('#new-category-input', t('sla.category.inputPh'));
        setText('#category-modal .action-btn', t('sla.category.add'));
        setText('#category-modal .btn-save', t('sla.category.save'));
        setText('#history-modal h3', t('sla.history.title'));
        setHtml('#history-modal .loading-text', t('sla.history.loading'));

        const heading = document.querySelector('.header-container h2 > span');
        const edition = heading?.querySelector('span:first-of-type');
        const version = document.getElementById('slaFrontendVersion');
        if (heading) {
            heading.textContent = t('sla.header.title') + ' ';
            if (edition) {
                edition.textContent = t('sla.header.edition');
                heading.appendChild(edition);
            }
            if (version) heading.appendChild(version);
        }
        const sysBtns = document.querySelectorAll('.system-actions .sys-btn');
        if (sysBtns[0]) sysBtns[0].textContent = t('sla.action.categories');
        if (sysBtns[1]) sysBtns[1].textContent = t('sla.action.history');
        if (sysBtns[2]) sysBtns[2].textContent = t('sla.action.rules');
        if (sysBtns[3]) {
            sysBtns[3].textContent = t('sla.action.exportConfig');
            sysBtns[3].title = t('sla.action.exportConfigTitle');
        }
        const importLabel = document.querySelector('.system-actions label.sys-btn');
        if (importLabel) {
            const input = importLabel.querySelector('input');
            importLabel.textContent = t('sla.action.importConfig') + ' ';
            importLabel.title = t('sla.action.importConfigTitle');
            if (input) importLabel.appendChild(input);
        }

        const sourceNotes = document.querySelectorAll('.source-info-wrapper .sla-source-note');
        if (sourceNotes[0]) sourceNotes[0].textContent = t('sla.source.mode');
        if (sourceNotes[1]) sourceNotes[1].textContent = t('sla.source.targetMonth');
        setText('#slaSourceMode option[value="auto"]', t('sla.source.auto'));
        setText('#slaSourceMode option[value="sqlite"]', t('sla.source.sqlite'));
        renderInitialSourcePanel();
        applyRuleBox();
        const uploads = document.querySelectorAll('.upload-actions .upload-btn');
        [
            'sla.upload.batch', 'sla.upload.rect', 'sla.upload.risk',
            'sla.upload.special', 'sla.upload.sr', 'sla.upload.vuln'
        ].forEach((key, index) => {
            const label = uploads[index];
            const input = label?.querySelector('input');
            if (!label || !input) return;
            label.textContent = t(key) + ' ';
            label.appendChild(input);
        });
        setText('.upload-cache-clear', t('sla.upload.clearCache'));
        const mainEmpty = document.querySelector('#main-wrapper > div');
        if (mainEmpty && !document.querySelector('#main-wrapper .section-card')) {
            mainEmpty.innerHTML = t('sla.empty.main');
        }
    }

    function applyRuleBox() {
        const cols = document.querySelectorAll('.rule-box .rule-col');
        const data = [
            ['sla.rule.rectTitle', ['sla.rule.rectFile', 'sla.rule.rectStatusField', 'sla.rule.rectChecking', 'sla.rule.rectification']],
            ['sla.rule.riskTitle', ['sla.rule.riskFile', 'sla.rule.riskStatusField', 'sla.rule.confirming', 'sla.rule.open', 'sla.rule.suspended']],
            ['sla.rule.specialTitle', ['sla.rule.specialFile', 'sla.rule.specialStatusField', 'sla.rule.toConfirm', 'sla.rule.processing']],
            ['sla.rule.srTitle', ['sla.rule.srFile', 'sla.rule.srStatusField', 'sla.rule.srMonitor', 'sla.rule.suspend', 'sla.rule.srOverdue']],
            ['sla.rule.vulnTitle', ['sla.rule.vulnFile', 'sla.rule.vulnStatusField', 'sla.rule.vulnStatus', 'sla.rule.vulnCreate']]
        ];
        cols.forEach((col, index) => {
            const [titleKey, itemKeys] = data[index] || [];
            const strong = col.querySelector('strong');
            if (strong && titleKey) strong.textContent = t(titleKey);
            const ul = col.querySelector('ul');
            if (!ul || !itemKeys) return;
            ul.innerHTML = itemKeys.map((key, liIndex) => {
                const html = liIndex === 0
                    ? `<b>${t('sla.rule.strictPrefix')}</b>${t(key)}`
                    : t(key).replace(/^([^:：]+[:：])/, '<b>$1</b>');
                return `<li>${html}</li>`;
            }).join('');
            const fileItem = ul.querySelector('li:first-child');
            if (fileItem) fileItem.title = fileItem.textContent;
        });
    }

    function renderInitialSourcePanel() {
        const panel = document.getElementById('slaSourcePanel');
        if (!panel || panel.dataset.loaded) return;
        panel.innerHTML = `
            <span class="sla-source-badge">${t('sla.source.targets', { source: '-' })}</span>
            <span class="sla-source-badge">${t('sla.source.prefs', { source: '-' })}</span>
            <span class="sla-source-badge">${t('sla.source.categories', { source: '-' })}</span>
            <span class="sla-source-badge">${t('sla.source.groups', { source: '-' })}</span>
            <span class="sla-source-badge">${t('sla.source.snapshots', { source: '-' })}</span>
            <span class="sla-source-note">${t('sla.source.initialNote')}</span>
        `;
    }

    function applySectionChrome() {
        Object.keys(window.AppState || {}).forEach(secId => {
            const wrapper = document.getElementById(`section-${secId}`);
            if (!wrapper) return;
            const set = (selector, value) => {
                const el = wrapper.querySelector(selector);
                if (el) el.textContent = value;
            };
            const setPh = (selector, value) => {
                const el = wrapper.querySelector(selector);
                if (el) el.placeholder = value;
            };
            set('.filter-btn[data-filter="all"]', t('sla.section.all'));
            set('.filter-btn[data-filter="focus"]', t('sla.section.focus'));
            set('.filter-btn[data-filter="danger"]', t('sla.section.danger'));
            set('.filter-btn[data-filter="warning"]', t('sla.section.warning'));
            set(`#settings-btn-${secId}`, t('sla.section.columns'));
            set(`#copy-btn-${secId}`, t('sla.section.copyUnique'));
            set(`#metrics-btn-${secId}`, t('sla.section.metrics'));
            set(`#export-btn-${secId}`, t('sla.section.export'));
            setPh(`#search-${secId}`, t('sla.section.searchPh'));
            setPh(`#p-search-${secId}`, t('sla.section.filterColumnsPh'));
            set(`#p-all-${secId}`, t('sla.section.selectAll'));
            set(`#p-none-${secId}`, t('sla.section.clear'));
            const copyHint = wrapper.querySelector(`#copy-picker-${secId} .picker-header > div`);
            if (copyHint) copyHint.textContent = t('sla.section.copyHint');
            setPh(`#c-search-${secId}`, t('sla.section.copySearchPh'));
            const metricHint = wrapper.querySelector(`#metrics-picker-${secId} > div:first-child`);
            if (metricHint) metricHint.textContent = t('sla.section.metricHint');

            const typeExtract = wrapper.querySelector(`#metrics-picker-${secId} .m-type-extract-lbl`);
            if (typeExtract) typeExtract.textContent = t('sla.section.extractOne');
            const typeMulti = wrapper.querySelector(`#metrics-picker-${secId} .m-type-multi-lbl`);
            if (typeMulti) typeMulti.textContent = t('sla.section.extractMulti');
            const typeCount = wrapper.querySelector(`#metrics-picker-${secId} .m-type-count-lbl`);
            if (typeCount) typeCount.textContent = t('sla.section.countTimes');
            const typeRatio = wrapper.querySelector(`#metrics-picker-${secId} .m-type-ratio-lbl`);
            if (typeRatio) typeRatio.textContent = t('sla.section.countRatio');

            const scopeTitle = wrapper.querySelector(`#metrics-picker-${secId} .m-scope-title`);
            if (scopeTitle) scopeTitle.textContent = t('sla.section.dataScope');
            const scopeCurrent = wrapper.querySelector(`#metrics-picker-${secId} .m-scope-current-lbl`);
            if (scopeCurrent) scopeCurrent.textContent = t('sla.section.scopeCurrent');
            const scopeAll = wrapper.querySelector(`#metrics-picker-${secId} .m-scope-all-lbl`);
            if (scopeAll) scopeAll.textContent = t('sla.section.scopeAll');

            const advFilter = wrapper.querySelector(`#metrics-picker-${secId} .m-adv-filter-lbl`);
            if (advFilter) advFilter.textContent = t('sla.section.advancedFilter');
            const advLogic = wrapper.querySelector(`#metrics-picker-${secId} .m-condition-logic-lbl`);
            if (advLogic) advLogic.textContent = t('sla.section.conditionRelation');
            const advHelp = wrapper.querySelector(`#m-conditions-help-${secId}`);
            if (advHelp) advHelp.textContent = t('sla.section.advancedHelp');
            const addCondBtn = wrapper.querySelector(`#metrics-picker-${secId} .metric-condition-add`);
            if (addCondBtn) addCondBtn.textContent = t('sla.section.addCondition');

            set(`#m-condition-logic-${secId} option[value="and"]`, t('sla.section.conditionAnd'));
            set(`#m-condition-logic-${secId} option[value="or"]`, t('sla.section.conditionOr'));

            set(`#m-aggregation-${secId} option[value="sum"]`, t('sla.section.aggregateSum'));
            set(`#m-aggregation-${secId} option[value="avg"]`, t('sla.section.aggregateAvg'));
            set(`#m-aggregation-${secId} option[value="max"]`, t('sla.section.aggregateMax'));
            set(`#m-aggregation-${secId} option[value="min"]`, t('sla.section.aggregateMin'));
            set(`#m-aggregation-${secId} option[value="count"]`, t('sla.section.aggregateCount'));

            set(`#m-color-${secId} option[value=""]`, t('sla.section.color'));
            set(`#m-color-${secId} option[value="success"]`, t('sla.section.green'));
            set(`#m-color-${secId} option[value="danger"]`, t('sla.section.red'));
            set(`#m-color-${secId} option[value="warn"]`, t('sla.section.yellow'));

            setPh(`#m-valy-${secId}`, t('sla.section.valYPh'));
            setPh(`#m-c-valy-${secId}`, t('sla.section.countYPh'));
            setPh(`#m-c-valk-${secId}`, t('sla.section.countKPh'));
            setPh(`#m-label-${secId}`, t('sla.section.metricNamePh'));
            set(`#add-metric-btn-${secId}`, t('sla.section.saveRule'));
            const summary = document.getElementById(`rule-summary-badge-${secId}`);
            if (summary) summary.title = t('sla.section.noRulesTitle');
            if (typeof window.populateMetricSelects === 'function') window.populateMetricSelects(secId);
            if (typeof window.renderMetricList === 'function') window.renderMetricList(secId);
        });
        if (typeof window.updateAllMetricRuleSummaries === 'function') window.updateAllMetricRuleSummaries();
    }

    if (window.ToolsI18n) {
        window.ToolsI18n.register('sla', dictionaries);
    }

    window.SLAI18n = { t, applyPage, sourceLabel };
    window.SLAT = t;

    window.addEventListener('tools:languagechange', () => {
        applyPage();
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
        if (window.SLATargetMonth?.init) window.SLATargetMonth.init();
        if (window.SLAMetrics?.renderTopStickyBar) window.SLAMetrics.renderTopStickyBar();
        applySectionChrome();
        if (window.refreshSLAHighlightViews) window.refreshSLAHighlightViews(Object.keys(window.AppState || {}));
        if (window.SLATable?.renderTable) Object.keys(window.AppState || {}).forEach(id => window.SLATable.renderTable(id));
    });
})();
