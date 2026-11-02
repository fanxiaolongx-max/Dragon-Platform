const path = require('path');
const fs = require('fs');
const ExcelJS = require('./tools-platform/node_modules/exceljs');

async function buildDataAssetsWorkbook() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Dragon Platform / AIOps Team';
    workbook.lastModifiedBy = 'Antigravity AI';
    workbook.created = new Date();
    workbook.modified = new Date();

    const fontBase = { name: 'Microsoft YaHei', size: 10 };
    const fontHeader = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    const fontTitle = { name: 'Microsoft YaHei', size: 14, bold: true, color: { argb: 'FF1E293B' } };
    const fontSection = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
    
    const fillHeaderPrimary = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }; // Dark blue
    const fillHeaderSecondary = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } }; // Sky blue
    const fillSection = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    const fillZebra = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    
    const borderThin = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };

    // ==========================================
    // SHEET 1: 数仓分层与数流全景指南
    // ==========================================
    const wsOverview = workbook.addWorksheet('1.数仓分层与数流指南', {
        views: [{ showGridLines: true }]
    });

    wsOverview.columns = [
        { width: 4 },
        { width: 18 },
        { width: 24 },
        { width: 32 },
        { width: 42 },
        { width: 30 }
    ];

    wsOverview.addRow([]);
    const titleRow = wsOverview.addRow(['', 'AIOps 数据仓库分层、数据流向与选表全景指南']);
    titleRow.font = fontTitle;
    wsOverview.addRow(['', '面向 AI 智能月报、Python Web 后端开发与数据治理团队的从新手到专家指南']);
    wsOverview.addRow([]);

    // 模块 1: ODS / DWD / DWS / SNAP / DIM 概念
    const s1Row = wsOverview.addRow(['', '一、数仓各层级定位与典型特征（ODS / DWD / DWS / SNAP / DIM）']);
    s1Row.font = fontSection;

    const layerHeader = wsOverview.addRow(['', '层级名称', '英文全称 & 通俗比喻', '核心定位与加工深度', '典型数据形态与特征', '月报与开发选表建议']);
    layerHeader.eachCell(c => { if(c.value) { c.font = fontHeader; c.fill = fillHeaderPrimary; c.alignment = { vertical: 'middle', horizontal: 'center' }; } });
    layerHeader.height = 26;

    const layersData = [
        ['ODS 贴源层', 'Operational Data Store\n【生鲜原料仓库】', '业务源系统（BIDS、DRS、MySQL业务库、日志、接口）原汁原味落地镜像。未经清洗，保持源端字段名和结构。', '字段有冗余、包含测试单据、脏数据、空值、占位符（如 SNULL, -999999）。通常 T+1 全量或增量同步。', '仅供源端对账、排查同步故障！严禁直接用于月报汇总统计或比率计算。'],
        ['DWD 明细层', 'Data Warehouse Detail\n【标准化净菜加工】', '单据最细颗粒度的事实明细层。对 ODS 进行清洗、空值填充、状态标准化、代表处编码归一化后的事实数据。', '每一行对应一个真实业务事件或单据（如每一笔变更 RFC、每一张网上问题 SR、每一条巡检任务、每一张证书）。通常几十万至数百万行。', '适合查具体单号明细、下钻排查异常！统计汇总时必须限定时间/组织过滤，避免全表大扫描引发超时。'],
        ['DWS 汇总层', 'Data Warehouse Summary\n【中央厨房标准套餐】', '专为大屏看板、月报专题和多维分析设计的主题预聚合宽表。按业务维度（月/日/代表处/产品线/场景）提前聚合。', '每一行是某个维度组合下的指标汇总值（如 2026年10月+某代表处 的变更总数、倒回数、成功率）。数据量小，查询毫秒级。', '月报制作、大屏看板、AI问答提取指标的首选推荐！毫秒级响应，防 15s 超时。'],
        ['SNAP 快照层', 'Snapshot History\n【历史成品冷冻仓】', '历史冻结切片表。每天或每月定时冻结当时时点的 DWD 或 DWS 数据，保留历史版本现场。', '保留历史月份当时的最终得分与指标状态，不可覆盖篡改。由于长期累积，快照表记录数极大（数百万到近 3000 万行）。', '历史月报复盘、环比同比趋势分析专用！查询必须强制指定 target_month 或 period_date 分区字段。'],
        ['DIM 维表层', 'Dimension Master Data\n【公共配料字典】', '公共基础维表与层级字典。维护组织树（地区部-代表处）、国家地区、大T客户、产品分类等公共编码映射。', '数据量通常极小（几百到几千行），更新稳定。以 common_data_ 或 _dim 开头。', '所有业务表统计完成后，必须 LEFT JOIN common_data_rep 补齐代表处中文名称，保证输出报表易读。'],
        ['APP 专属层', 'Application Schemas\n【各租户私有工作台】', '基座应用在各自专属 UUID Schema 下创建并维护的私有表（如动态报表元素表、模板表、看板访问日志）。', '由应用自身写入和维护，基座平台提供隔离保护。跨应用只读，本应用可写。', '用于存放当前月报草稿、前端组件配置、离线导入中间表等私有数据。']
    ];

    layersData.forEach((row, i) => {
        const r = wsOverview.addRow(['', ...row]);
        r.height = 42;
        r.font = fontBase;
        r.eachCell(c => {
            if (c.col > 1) {
                c.border = borderThin;
                c.alignment = { vertical: 'middle', wrapText: true };
                if (i % 2 === 1) c.fill = fillZebra;
            }
        });
    });

    wsOverview.addRow([]);
    // 模块 2: 数据流转全生命周期
    const s2Row = wsOverview.addRow(['', '二、AIOps 数据端到端流转全景链路']);
    s2Row.font = fontSection;

    const flowHeader = wsOverview.addRow(['', '流转阶段', '涉及系统 / 载体', '核心动作与转换', '主要产出资产 / 表', '注意事项']);
    flowHeader.eachCell(c => { if(c.value) { c.font = fontHeader; c.fill = fillHeaderSecondary; c.alignment = { vertical: 'middle', horizontal: 'center' }; } });
    flowHeader.height = 24;

    const flowData = [
        ['1. 源端采集', 'NetCare、BIDS、DRS、MySQL业务库、日志', '通过 ODS 同步管道、DRS 实时同步、API 接口抓取', 'ODS 贴源表（如 common_data_rep_ods、risk_task_new_ods）', '网络抖动或上游延迟可能导致 T+1 数据滞后，排查先看 ODS insert_time'],
        ['2. 清洗规范', '数仓 ETL 批处理 / 湖仓调度引擎', '去重、过滤测试数据、剔除占位符、组织与国家编码标准化', 'DWD 明细表（如 op_ioc_rfc_task_report_dtl_m_dwd、nc_op_sa_sr_problem_detail_all_bg_dwd）', '保留最细颗粒度，数据量较大，写入需建时间与组织索引'],
        ['3. 预聚合建模', 'DataCube 汇总计算引擎', '每天 9 点或 T+1 自动按月份、代表处、产品线多维聚合指标', 'DWS 宽表（如 op_ioc_rfc_task_report_h_dws_0/1、op_ioc_digital_cert_2026_d_dws）', '部分高频大表采用 0/1 双表轮转机制，查询需感知当前活动表'],
        ['4. 历史切片', '定时快照任务（每日快照 / 每月2号）', '按月/按日对 DWD/DWS 状态全量归档，锁定历史考核版本', 'SNAP 快照表（如 op_ioc_rectify_check_d_dws_snap、nc_eos_risk_product_version_dws_snap）', '千万级大表，禁止 SELECT *，必须指定分区与分页'],
        ['5. 消费与应用', 'Dragon Platform / AI 月报 / 运营数字人看板', 'FastAPI/pyweb 接口服务、SQL 探查、AI 语义匹配问答', '管理升级月报、变更风险月报、风险消减月报、Word/Excel 导出', '优先使用 DWS；关联公共维表翻译中文名；出站请求自动注入身份头']
    ];

    flowData.forEach((row, i) => {
        const r = wsOverview.addRow(['', ...row]);
        r.height = 36;
        r.font = fontBase;
        r.eachCell(c => {
            if (c.col > 1) {
                c.border = borderThin;
                c.alignment = { vertical: 'middle', wrapText: true };
                if (i % 2 === 1) c.fill = fillZebra;
            }
        });
    });

    wsOverview.addRow([]);
    // 模块 3: 基座架构规范
    const s3Row = wsOverview.addRow(['', '三、基座平台规范与开发安全边界（pyweb / 后端服务准则）']);
    s3Row.font = fontSection;

    const specHeader = wsOverview.addRow(['', '规范领域', '规则细节', '参数 / 环境变量要求', '触发违反后果', '最佳实践与避坑']);
    specHeader.eachCell(c => { if(c.value) { c.font = fontHeader; c.fill = fillHeaderPrimary; c.alignment = { vertical: 'middle', horizontal: 'center' }; } });
    specHeader.height = 24;

    const specData = [
        ['网关与鉴权', '出站请求必须带应用身份标识，由 sitecustomize.py 或基座中间件自动注入。', 'BASE_DATASOURCES_URL, BASE_REP_OFFICES_URL, APP_UUID, APP_LEVEL', '未带身份头的请求直接被基座网关 401/403 拒绝', '出站 HTTP 统一使用经过包装的基座客户端，勿裸写裸调'],
        ['数据库权限', '业务库（GaussDB / MySQL）一律只读；仅本应用专属 UUID schema 具有写权限。', '只允许单条 SELECT / WITH。写入仅限本 schema INSERT/UPDATE/DELETE', '越权读写其他 schema 报权限异常；DDL 建表交 DBA，禁止 DROP SCHEMA', '统计查询前先 EXPLAIN；明细下钻强制 LIMIT 1000 以内'],
        ['Redis 缓存', 'Redis 键名必须强约束前缀；TTL 设置有严格时间窗口限制。', '前缀格式强制：app:{uuid}:，默认 TTL 2 天（172800s），最大 7 天（604800s）', 'TTL 超过 7 天被基座直接返回 400 Bad Request；未带前缀无法操作', '缓存临时统计结果或下拉选项列表，减少对 GaussDB 汇总库的直连压力'],
        ['查询超时防护', '基座对单次查询施加了 15 秒硬超时限制，超过即断开。', '单页最多 1000 行；无顶层 LIMIT 自动追加分页，总行上限 50000 行', '扫大表导致 15s Gateway Timeout 错误', '统计指标严禁在 280 万行 DWD 上 GROUP BY，务必使用 DWS 预聚合宽表']
    ];

    specData.forEach((row, i) => {
        const r = wsOverview.addRow(['', ...row]);
        r.height = 36;
        r.font = fontBase;
        r.eachCell(c => {
            if (c.col > 1) {
                c.border = borderThin;
                c.alignment = { vertical: 'middle', wrapText: true };
                if (i % 2 === 1) c.fill = fillZebra;
            }
        });
    });

    // ==========================================
    // SHEET 2: 83项数据资产全景画像与AI标签库
    // ==========================================
    const wsAssets = workbook.addWorksheet('2.数据资产全景与AI标签库', {
        views: [{ showGridLines: true, state: 'frozen', xSplit: 3, ySplit: 2 }]
    });

    wsAssets.columns = [
        { header: '序号', key: 'idx', width: 6 },
        { header: '表编码 / 资产名称', key: 'name', width: 34 },
        { header: '中文名称', key: 'name_cn', width: 28 },
        { header: '数据层级', key: 'grain', width: 14 },
        { header: '资产分类', key: 'cat', width: 14 },
        { header: '业务专题域', key: 'domain', width: 16 },
        { header: '责任部门', key: 'dept', width: 14 },
        { header: '数据库类型', key: 'db', width: 12 },
        { header: '同步方式与时效', key: 'sync', width: 16 },
        { header: '估算数据量', key: 'rows', width: 16 },
        { header: '业务功能描述', key: 'func', width: 36 },
        { header: '数据来源与底层关联湖表', key: 'desc', width: 44 },
        { header: 'AI 核心检索标签 (Tags)', key: 'tags', width: 36 },
        { header: 'AI 推荐提问意图示例', key: 'ai_intent', width: 38 }
    ];

    const assetsHeader = wsAssets.getRow(1);
    assetsHeader.font = fontHeader;
    assetsHeader.fill = fillHeaderPrimary;
    assetsHeader.height = 28;
    assetsHeader.alignment = { vertical: 'middle', horizontal: 'center' };

    const assetsRaw = [
        // 公共数据源 (4)
        { name: 'common_data_customer_dlvy_org', name_cn: '客户/交付主体维表', grain: 'DIM 维表', cat: '公共数据源', domain: '公共数据', dept: '公共数据', db: 'GaussDB', sync: 'T+1更新', rows: '约 1,170,760 行', func: '维护客户与交付组织对应关系', desc: 'BIDS同步公共数据，源端 common_data_customer_dlvy_org_ods', tags: '客户维表, 交付主体, 组织映射, BIDS', ai_intent: '查询指定客户对应的交付组织与BG归属' },
        { name: 'common_data_customer_rel_country_relation', name_cn: '国家地区关系维表', grain: 'DIM 维表', cat: '公共数据源', domain: '公共数据', dept: '公共数据', db: 'GaussDB', sync: 'T+1更新', rows: '约 300 行', func: '维护国家与地区的层级映射', desc: 'BIDS同步，全量国家地区关系数据', tags: '国家地区, 大区映射, 海外区域, 组织层级', ai_intent: '国家与地区部对应关系、海外大区筛选' },
        { name: 'common_data_product', name_cn: '产品维表', grain: 'DIM 维表', cat: '公共数据源', domain: '公共数据', dept: '公共数据', db: 'GaussDB', sync: 'T+1更新', rows: '约 68,220 行', func: '维护产品基础信息(含分类/产品族/EOS信息)', desc: 'BIDS同步，全量产品基础数据', tags: '产品维表, 产品分类, 产品族, EOS基础信息', ai_intent: '查询硬件产品族归属、EOS计划时间' },
        { name: 'common_data_rep', name_cn: '地区部/代表处组织维表', grain: 'DIM 维表', cat: '公共数据源', domain: '公共数据', dept: '公共数据', db: 'GaussDB', sync: 'T+1更新', rows: '约 622 行', func: '维护地区部-代表处层级关系', desc: 'BIDS同步，全量代表处组织数据', tags: '组织维表, 代表处映射, 地区部映射, 核心关联', ai_intent: '所有业务表关联翻译 repoffice_code 得到代表处中文名' },
        
        // 业务数据源 - 网络变更 (9)
        { name: 'op_ioc_rfc_task_report_h_dws_0', name_cn: '网络变更RFC任务汇总表(0号表)', grain: 'DWS 汇总', cat: '业务数据源', domain: '网络变更', dept: '网络变更', db: 'GaussDB', sync: 'API/T+1更新', rows: '约 1,376,129 行', func: '网络变更RFC任务按小时/日维度汇总(0号表)', desc: '源端 IOC_RFC_TASK_REPORT_S_GA，关联 IOC_RFC_TASK_REPORT_D_GA', tags: '网络变更, RFC汇总, 变更成功率, 倒回数, 核心DWS', ai_intent: '各代表处网络变更操作总量、倒回量与成功率统计' },
        { name: 'op_ioc_rfc_task_report_h_dws_1', name_cn: '网络变更RFC任务汇总表(1号表)', grain: 'DWS 汇总', cat: '业务数据源', domain: '网络变更', dept: '网络变更', db: 'GaussDB', sync: 'API/T+1更新', rows: '约 1,367,718 行', func: '网络变更RFC任务汇总(1号表，双表轮转)', desc: '与0号表组成双表热备轮换体系', tags: '网络变更, RFC汇总, 轮换表, 变更成功率', ai_intent: '轮换月份的网络变更成功率与任务总量' },
        { name: 'op_ioc_rfc_task_report_by_change_h_dws_0', name_cn: '网络变更RFC按变更维度汇总表(0号)', grain: 'DWS 汇总', cat: '业务数据源', domain: '网络变更', dept: '网络变更', db: 'GaussDB', sync: 'T+1更新', rows: '约 2,462,520 行', func: '按具体变更类型维度的汇总宽表', desc: 'datacube汇总，源端 OP_IOC_RFC_TASK_REPORT_H_DWS_0', tags: '按类型汇总, 变更场景, RFC分类', ai_intent: '按核心网/数通/传输分类的变更操作与倒回分布' },
        { name: 'op_ioc_rfc_task_report_by_change_h_dws_1', name_cn: '网络变更RFC按变更维度汇总表(1号)', grain: 'DWS 汇总', cat: '业务数据源', domain: '网络变更', dept: '网络变更', db: 'GaussDB', sync: 'T+1更新', rows: '约 2,212,762 行', func: '按具体变更类型维度汇总(1号表)', desc: 'datacube汇总，源端 OP_IOC_RFC_TASK_REPORT_H_DWS_1', tags: '按类型汇总, 变更场景, 轮转表', ai_intent: '按变更类型下钻分析不同场景的失败率' },
        { name: 'op_ioc_rfc_task_report_dtl_m_dwd', name_cn: '网络变更RFC任务明细表(月度)', grain: 'DWD 明细', cat: '业务数据源', domain: '网络变更', dept: '网络变更', db: 'GaussDB', sync: '实时同步', rows: '约 51,541 行', func: '网络变更RFC任务月度明细，实时指标来源', desc: 'BIDS同步，关联湖表 rpt_itr_sr_rfc_2bg_d 等', tags: '变更明细, 实时变更单, RFC单号, 湖表关联', ai_intent: '查询指定变更单号的操作人员、倒回详细原因' },
        { name: 'op_ioc_rfc_task_report_dtl_derive_dwd', name_cn: '网络变更RFC任务派生明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '网络变更', dept: '网络变更', db: 'GaussDB', sync: 'T+1更新', rows: '约 5,151,041 行', func: 'T+1 指标派生明细数据', desc: 'datacube派生，源端 OP_IOC_RFC_TASK_REPORT_DTL_M_DWD', tags: '派生明细, 考核指标, 派生计算', ai_intent: '深入分析变更单派生属性（紧急/白天/高危等）' },
        { name: 'op_ioc_highrisk_commands_d_dws', name_cn: '高危命令拦截统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '网络变更', dept: '网络变更', db: 'GaussDB', sync: 'T+1更新', rows: '约 360,128 行', func: '多维度汇总高危命令拦截统计指标', desc: 'datacube汇总，源端 OP_IOC_HIGHRISK_COMMANDS_D_DWD', tags: '高危拦截, 命令拦截, 拦截统计, 变更合规', ai_intent: '统计各代表处高危命令拦截次数、规则拦截排名' },
        { name: 'op_ioc_highrisk_commands_d_dwd', name_cn: '高危命令拦截明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '网络变更', dept: '网络变更', db: 'MySQL', sync: '实时同步', rows: '约 839,423 行', func: '高危命令拦截明细日志记录', desc: 'NetcareClient采集，源端 t_highrisk_commands', tags: '拦截明细, 命令日志, 拦截人, 实时拦截', ai_intent: '查询具体某个被拦截高危命令的执行人和命令文本' },
        
        // 业务数据源 - EOS 生命周期 (10)
        { name: 'ibms_report_dws', name_cn: 'IBMS产品&版本EOS概览统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: '每天9点同步', rows: '约 177,967 行', func: 'IBMS来源全量产品&全量版本EOS概览统计', desc: 'datacube汇总，关联 IBMS_REPORT_E01_V_ODS 等', tags: 'EOS概览, IBMS来源, 产品EOS, 版本EOS, 日更汇总', ai_intent: 'IBMS维度全网产品与版本的整体 EOS 到期分布' },
        { name: 'ibms_report_dws_snap', name_cn: 'IBMS EOS概览统计表历史快照', grain: 'SNAP 快照', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: '每日快照', rows: '约 3,022,222 行', func: 'IBMS EOS 概览历史每日快照', desc: 'datacube快照，源端 IBMS_REPORT_DWS', tags: 'EOS快照, 历史趋势, IBMS快照, 趋势回溯', ai_intent: '对比上月同期 IBMS EOS 设备存量的消减走势' },
        { name: 'nc_eos_risk_full_product_version_dws', name_cn: '全量产品&版本EOS风险统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: 'T+1更新', rows: '约 77,132 行', func: 'eos_type为1、2、4的全量产品&版本EOS统计', desc: 'datacube汇总，源端 NC_EOS_RISK_MANAGEMENT_DWD', tags: 'NetCare EOS, 全量产品版本, 风险统计, 汇总', ai_intent: '统计不同风险等级（1/2/4）的产品版本存量' },
        { name: 'nc_eos_risk_full_product_version_dws_snap', name_cn: '全量产品&版本EOS统计快照', grain: 'SNAP 快照', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: '每月2号0点', rows: '约 918,124 行', func: '全量产品&版本EOS月度趋势快照', desc: 'datacube快照，页面趋势专用', tags: '月度快照, 页面趋势, 环比趋势, 月末存档', ai_intent: '月报制作时调取历史月末的冻结版本用于对比' },
        { name: 'nc_eos_risk_urgent_product_version_dws', name_cn: '重急EOS产品及高风险版本统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: 'T+1更新', rows: '约 10,590 行', func: '重急EOS产品及高风险EOS版本统计', desc: 'datacube汇总，源端 NC_EOS_RISK_MANAGEMENT_DWD', tags: '重急产品, 高风险版本, 重点盯防, DWS首选, 收编完成率', ai_intent: '月报核心指标：各产品线重急EOS收编完成率' },
        { name: 'nc_eos_risk_urgent_product_version_dws_snap', name_cn: '重急EOS产品及高风险版本快照', grain: 'SNAP 快照', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: '每日快照', rows: '约 846,579 行', func: '重急与高风险统计历史快照', desc: 'datacube每日快照', tags: '重急快照, 历史复原, 每日切片', ai_intent: '复盘某日重急EOS收编考核指标的当时值' },
        { name: 'nc_eos_risk_product_version_dws', name_cn: '产品EOS&版本EOS风险统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: 'T+1更新', rows: '约 75,033 行', func: '产品EOS与版本EOS多维统计', desc: 'datacube汇总', tags: '产品风险, 版本风险, DWS宽表', ai_intent: '各代表处产品维度的整体 EOS 存量与已收编数' },
        { name: 'nc_eos_risk_product_version_dws_snap', name_cn: '产品&版本EOS风险统计表快照', grain: 'SNAP 快照', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: '每日快照', rows: '约 1,911,819 行', func: '产品&版本风险统计历史快照', desc: 'datacube每日快照', tags: '风险快照, 历史趋势', ai_intent: '追溯产品风险统计的历史每日进展' },
        { name: 'nc_eos_risk_management_dwd', name_cn: '重急&高风险EOS明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: '每天9点同步', rows: '约 72,503 行', func: '全产品&版本重急高风险EOS明细', desc: 'BIDS同步，关联运营商/海外政企湖表', tags: '重急EOS明细, 高风险EOS, 设备明细, 湖表关联, DWD', ai_intent: '下钻查看具体客户某台设备的EOS到期日期和机型' },
        { name: 'nc_eos_risk_management_dwd_snap', name_cn: 'EOS明细表历史快照', grain: 'SNAP 快照', cat: '业务数据源', domain: '产品生命周期', dept: '产品生命周期', db: 'GaussDB', sync: '每日快照', rows: '约 1,016,964 行', func: 'EOS明细表历史快照记录', desc: 'datacube每日快照', tags: '明细快照, 历史留存', ai_intent: '历史明细复盘与差异比对' },

        // 业务数据源 - 数字证书 (4)
        { name: 'op_ioc_digital_cert_2026_d_dws', name_cn: '2026年数字证书统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '安全运维', dept: '主动维护', db: 'GaussDB', sync: 'T+1更新', rows: '约 3,461 行', func: '按多维度汇总证书统计指标', desc: 'datacube汇总，源端 OP_IOC_DIGITAL_CERT_2026_D_DWD', tags: '数字证书, 证书到期, 30天预警, 证书安全, 核心DWS', ai_intent: '统计各代表处数字证书总数、过期数、30天内即将过期数' },
        { name: 'op_ioc_digital_cert_2026_d_dws_snap', name_cn: '2026年数字证书统计表快照', grain: 'SNAP 快照', cat: '业务数据源', domain: '安全运维', dept: '主动维护', db: 'GaussDB', sync: '每日快照', rows: '约 403,847 行', func: '证书统计历史快照', desc: 'datacube每日快照', tags: '证书快照, 趋势对比, 历史统计', ai_intent: '对比近三个月各代表处数字证书过期率改善趋势' },
        { name: 'op_ioc_digital_cert_2026_d_dwd', name_cn: '2026年数字证书明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '安全运维', dept: '主动维护', db: 'GaussDB', sync: 'DRS实时同步', rows: '约 26,956 行', func: '记录证书实例明细(CNBG+EBG)', desc: 'DRS实时同步，关联 dwisd_vi.t_intg_dm_z06y_6450', tags: '证书明细, 证书单号, 过期日期, 域名实例', ai_intent: '查询具体某个代表处 30 天内即将过期的证书域名与责任人' },
        { name: 'op_ioc_digital_cert_2026_d_dwd_snap', name_cn: '2026年数字证书明细表快照', grain: 'SNAP 快照', cat: '业务数据源', domain: '安全运维', dept: '主动维护', db: 'GaussDB', sync: '每日快照', rows: '约 2,880,983 行', func: '证书明细历史快照', desc: 'datacube每日快照', tags: '证书明细快照, 历史存档', ai_intent: '复盘历史上某张证书当时的有效状态' },

        // 业务数据源 - 管理升级 (2)
        { name: 'op_ioc_escalation_d_dws', name_cn: '管理升级统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '管理升级', dept: '网上问题', db: 'GaussDB', sync: 'T+1更新', rows: '约 13,909 行', func: '多维度汇总管理升级统计指标', desc: 'datacube汇总，源端 OP_IOC_ESCALATION_D_DWD', tags: '管理升级, 7天方案提供率, 闭环率, 级别分布, 核心DWS', ai_intent: '统计各地区部管理升级总数、一级总数、7天方案提供率' },
        { name: 'op_ioc_escalation_d_dwd', name_cn: '管理升级明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '管理升级', dept: '网上问题', db: 'GaussDB', sync: 'T+1同步', rows: '约 6,804 行', func: '记录管理升级任务明细(CNBG+EBG)', desc: 'BIDS同步，关联 dwr_itr_sr_2bg_d 等湖表', tags: '升级任务, 工单明细, 方案时长, 超期未实施', ai_intent: '下钻查看超 60 天未实施或方案未提供的管理升级工单' },

        // 业务数据源 - 网上问题与事故 (5)
        { name: 'nc_op_sa_sr_problem_detail_all_bg_dwd', name_cn: '网上问题明细表(全BG)', grain: 'DWD 明细', cat: '业务数据源', domain: '事故管理', dept: '网上问题', db: 'GaussDB', sync: 'T+1同步', rows: '约 2,879,618 行', func: '记录网上问题明细(全BG, T+1)', desc: 'BIDS同步，关联 dwritr.dwr_itr_sr_2bg_d(问题SR单表)', tags: '网上问题, SR明细, 全BG, 湖表关联, DWD', ai_intent: '查询指定客户或产品的网上问题 SR 清单与解决时长' },
        { name: 'nc_op_sa_sr_problem_detail_all_bg_ofr_dwd', name_cn: '网上问题OFR明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '事故管理', dept: '网上问题', db: 'GaussDB', sync: 'T+1同步', rows: '约 123,515 行', func: '记录 OFR 维度问题明细', desc: 'BIDS同步，关联 OFR 维度数据湖', tags: 'OFR明细, 网上问题, 特殊维度', ai_intent: '分析 OFR 维度网上问题发生频次与产品线分布' },
        { name: 'nc_op_sa_sr_problem_realtime_stat_dws', name_cn: '网上问题实时统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '网上问题', dept: '网上问题', db: 'GaussDB', sync: '实时更新', rows: '约 32,906 行', func: '实时汇总网上问题统计指标', desc: '实时数据源，源端 NC_OP_SA_SR_PROBLEM_REALTIME_QUERY', tags: '实时问题, 实时汇总, 指标概览, 预警监控', ai_intent: '监控当前处于未解决状态的网上问题实时总量' },
        { name: 'nc_op_sr_emergency_recovery_d_dwd', name_cn: '紧急恢复明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '紧急恢复', dept: '网上问题', db: 'GaussDB', sync: 'T+1同步', rows: '约 11,708 行', func: '记录紧急恢复任务明细', desc: 'BIDS同步，关联 dwritr.dwr_itr_sr_2bg_d', tags: '紧急恢复, 应急抢修, 恢复工单', ai_intent: '统计紧急恢复任务的平均恢复时长与发生原因' },
        { name: 'op_ioc_incident_h_dwd', name_cn: '事故明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '事故管理', dept: '网上问题', db: 'MySQL', sync: '实时同步', rows: '约 6,608 行', func: '记录事故单明细信息(CNBG+EBG)', desc: 'BIDS同步，关联运营商/企业实时通知表与湖表', tags: '网上事故, 一二级事故, 事故通报, 核心明细', ai_intent: '查询当月发生的一二级重大事故明细与责任部门' },

        // 业务数据源 - 网络巡检 (3)
        { name: 'op_ioc_health_check_dws', name_cn: '巡检单统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '网络巡检', dept: '主动维护', db: 'GaussDB', sync: 'T+1更新', rows: '约 109,469 行', func: '按多维度汇总巡检任务统计指标', desc: 'datacube汇总，源端 OP_IOC_HEALTH_CHECK_DWD', tags: '网络巡检, 健康检查, 巡检完成率, DWS宽表', ai_intent: '统计各代表处巡检总数、已完成数与巡检完成率' },
        { name: 'op_ioc_health_check_dwd', name_cn: '巡检明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '网络巡检', dept: '主动维护', db: 'GaussDB', sync: 'T+1同步', rows: '约 142,161 行', func: '记录网络巡检单任务明细(运营商+政企)', desc: 'BIDS同步，关联运营商/政企巡检单表', tags: '巡检明细, 巡检工单, 检查项', ai_intent: '查看具体代表处未按期完成的巡检单清单' },
        { name: 'op_ioc_health_check_network_dwd', name_cn: '巡检网络明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '网络巡检', dept: '主动维护', db: 'GaussDB', sync: 'T+1更新', rows: '约 6,893 行', func: '价值网络巡检相关明细', desc: 'datacube关联 CS_NC_NETWORK_ALL_DWD', tags: '价值网络, 巡检覆盖, 重点客户', ai_intent: '重点价值网络的巡检执行覆盖情况' },

        // 业务数据源 - 整改核查 (5)
        { name: 'op_ioc_rectify_check_d_dws', name_cn: '整改统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '网络维护', dept: '主动维护', db: 'GaussDB', sync: 'T+1更新', rows: '约 872,594 行', func: '按多维度汇总整改任务统计指标', desc: 'datacube汇总，源端 OP_IOC_RECTIFY_CHECK_D_DWD', tags: '整改核查, 超期整改, 整改统计, 核心DWS', ai_intent: '各代表处整改任务完成数、超期未完成 NE 数' },
        { name: 'op_ioc_rectify_check_d_dwd', name_cn: '整改明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '网络维护', dept: '主动维护', db: 'GaussDB', sync: '每天9点同步', rows: '约 731,604 行', func: '记录每条整改任务的明细信息', desc: 'BIDS同步，源端 NC_OP_TASK_CHECK_RECTIFY_QUERY', tags: '整改明细, 单据工单, 超期下钻', ai_intent: '查询具体超期整改单涉及的网元与整改方案' },
        { name: 'op_ioc_rectify_check_d_dwd_derive', name_cn: '整改派生明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '网络维护', dept: '主动维护', db: 'GaussDB', sync: 'T+1更新', rows: '约 855,229 行', func: '作战地图整改超期指标派生数据', desc: 'datacube派生', tags: '作战地图派生, 超期指标, 考核计算', ai_intent: '作战地图考核口径的整改超期明细' },
        { name: 'op_ioc_rectify_check_d_dws_snap', name_cn: '整改统计表历史快照', grain: 'SNAP 快照', cat: '业务数据源', domain: '网络维护', dept: '主动维护', db: 'GaussDB', sync: '每日快照', rows: '约 24,365,408 行', func: '整改统计表历史快照存档', desc: 'datacube每日快照(大表)', tags: '整改快照, 趋势回溯, 千万级表', ai_intent: '历史整改达标率走势对比' },
        { name: 'op_ioc_rectify_notice_d_dwd', name_cn: '整改通知明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '网络维护', dept: '主动维护', db: 'GaussDB', sync: 'T+1同步', rows: '约 1,111 行', func: '记录整改通知单明细', desc: 'BIDS同步，关联整改通知单湖表', tags: '整改通知, 官方通报, 督办工单', ai_intent: '查询下发但未完成的整改通知单' },

        // 业务数据源 - 固定期限 License (4)
        { name: 'op_ioc_license_data_stat_d_dws_0', name_cn: '固定期限License统计表(0号表)', grain: 'DWS 汇总', cat: '业务数据源', domain: 'License管理', dept: '主动维护', db: 'GaussDB', sync: 'T+1更新', rows: '约 14,213 行', func: '统计固定期限License过期与宽限期指标(0号表)', desc: 'datacube汇总，通过 latest_table_name 轮换', tags: 'License管理, 许可过期, 宽限期, 动态切换表', ai_intent: '统计各代表处过期 License 数量、宽限期内外分布' },
        { name: 'op_ioc_license_data_stat_d_dws_1', name_cn: '固定期限License统计表(1号表)', grain: 'DWS 汇总', cat: '业务数据源', domain: 'License管理', dept: '主动维护', db: 'GaussDB', sync: 'T+1更新', rows: '约 14,804 行', func: '统计固定期限License指标(1号表)', desc: '与0号表按 latest_table_name 动态切换', tags: 'License管理, 轮换表, 许可统计', ai_intent: '当前活动表的 License 过期达标率计算' },
        { name: 'op_ioc_license_data_dtl_d_dwd_0', name_cn: '固定期限License明细表(0号表)', grain: 'DWD 明细', cat: '业务数据源', domain: 'License管理', dept: '主动维护', db: 'GaussDB', sync: 'DRS实时同步', rows: '约 1,872,094 行', func: '记录固定期限License明细(当前CNBG)', desc: 'DRS实时同步 Netcare 来源', tags: 'License明细, ESN, 过期单号, CNBG', ai_intent: '查询具体设备 ESN 码的 License 过期时间与控制项' },
        { name: 'op_ioc_license_data_dtl_d_dwd_1', name_cn: '固定期限License明细表(1号表)', grain: 'DWD 明细', cat: '业务数据源', domain: 'License管理', dept: '主动维护', db: 'GaussDB', sync: 'DRS实时同步', rows: '约 2,255,132 行', func: '固定期限License明细(1号表)', desc: 'DRS实时同步', tags: 'License明细, 轮换明细, 设备ESN', ai_intent: '穿透排查宽限期外的严重过期设备' },

        // 业务数据源 - 维护作战地图 SACA (8)
        { name: 'op_ioc_saca_date_dws', name_cn: '维护作战地图正式得分表(每月)', grain: 'DWS 汇总', cat: '业务数据源', domain: '运维合规', dept: '未分配', db: 'GaussDB', sync: '每月更新', rows: '约 8,860 行', func: '维护作战地图正式得分表(每月)', desc: 'datacube汇总，源端 OP_IOC_SACA_SCORE_DWS', tags: '作战地图, 月度得分, 考核成绩, SACA', ai_intent: '查询各代表处/产品线作战地图月度总分与排名' },
        { name: 'op_ioc_saca_level_dws', name_cn: '维护作战地图得分表(每天)', grain: 'DWS 汇总', cat: '业务数据源', domain: '运维合规', dept: '未分配', db: 'GaussDB', sync: '每日更新', rows: '约 162,476 行', func: '维护作战地图得分表(每天)', desc: 'datacube每日汇总更新', tags: '日常得分, 动态走势, 每日监控', ai_intent: '监控月内日常得分波动走势与预警' },
        { name: 'op_ioc_saca_card_new_dws', name_cn: '维护作战地图红黄牌统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '运维合规', dept: '未分配', db: 'GaussDB', sync: 'T+1更新', rows: '约 5,149 行', func: '维护作战地图红黄牌统计汇总', desc: 'datacube汇总，源端 OP_IOC_SACA_RESULT_DWD', tags: '红黄牌, 违规告警, 处罚统计, 核心DWS', ai_intent: '统计各代表处当月红牌、黄牌数量与违规事项' },
        { name: 'op_ioc_saca_card_dwd', name_cn: '维护作战地图红黄牌明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '运维合规', dept: '未分配', db: 'GaussDB', sync: 'T+1更新', rows: '约 438 行', func: '维护作战地图红黄牌明细记录', desc: 'datacube，源端 OP_IOC_SACA_RESULT_DETAILS_DWD', tags: '红黄牌明细, 违规事件, 扣分明细', ai_intent: '下钻查看吃红牌的具体单据与责任人' },
        { name: 'op_ioc_saca_score_dws', name_cn: '维护作战地图扣分统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '运维合规', dept: '未分配', db: 'GaussDB', sync: 'T+1更新', rows: '—', func: '扣分数据按维度汇总统计', desc: 'datacube汇总', tags: '扣分统计, 扣分项汇总', ai_intent: '扣分最多 Top5 事项分析' },
        { name: 'op_ioc_saca_result_dwd', name_cn: '维护作战地图扣分结果表', grain: 'DWD 明细', cat: '业务数据源', domain: '运维合规', dept: '未分配', db: 'GaussDB', sync: 'T+1更新', rows: '约 120,135 行', func: '红黄牌来源扣分结果数据', desc: 'datacube源端', tags: '扣分结果, 考核明细', ai_intent: '排查扣分考核项的归属' },
        { name: 'op_ioc_saca_result_details_dwd', name_cn: '维护作战地图扣分明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '运维合规', dept: '未分配', db: 'GaussDB', sync: 'T+1更新', rows: '约 154,888 行', func: '记录扣分明细数据', desc: 'datacube', tags: '扣分明细, 细则条款', ai_intent: '核对扣分计算过程' },

        // 业务数据源 - 备件 OTS 与其他 (10)
        { name: 'spsa_2_access_monthly_ots_rate', name_cn: '备件OTS月度达标率统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '备件服务', dept: '备件OTS', db: 'GaussDB', sync: '月度更新', rows: '约 307,353 行', func: '备件月度 OTS 达标率考核汇总', desc: 'datacube汇总', tags: '备件OTS, 达标率, 服务质量, 考核指标', ai_intent: '统计各代表处备件到货时效达成率' },
        { name: 'spsa_2_assess_overdue_detail', name_cn: '备件超期考核明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '备件服务', dept: '备件OTS', db: 'GaussDB', sync: 'T+1更新', rows: '约 941,107 行', func: '备件超期未交付明细单据', desc: '业务数据源', tags: '备件超期, 考核明细, 延迟交付', ai_intent: '查询超期未送达备件申请单与涉及客户' },
        { name: 'spsa_2_ots_detail', name_cn: '备件OTS全量明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '备件服务', dept: '备件OTS', db: 'GaussDB', sync: 'T+1更新', rows: '约 272,189 行', func: '记录每笔备件申请与交付生命周期', desc: '业务数据源', tags: '备件明细, 发货物流, 交付轨迹', ai_intent: '追踪某备件订单的全流程节点耗时' },
        { name: 'spsa_2_hold_overdue_amount', name_cn: '备件呆滞金额统计表', grain: 'DWS 汇总', cat: '业务数据源', domain: '备件服务', dept: '备件OTS', db: 'GaussDB', sync: 'T+1更新', rows: '约 11,508 行', func: '呆滞备件占用金额按仓库汇总', desc: '业务数据源', tags: '呆滞金额, 库存沉淀, 资产风控', ai_intent: '统计呆滞超 90 天备件资金占用分布' },
        { name: 'spsa_2_hold_overdue_days', name_cn: '备件呆滞天数明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '备件服务', dept: '备件OTS', db: 'GaussDB', sync: 'T+1更新', rows: '约 14,894 行', func: '记录各物料呆滞账龄天数', desc: '业务数据源', tags: '呆滞天数, 库龄分析', ai_intent: '呆滞天数最长的 Top10 物料分析' },
        { name: 'spsa_2_hold_overdue_rate', name_cn: '备件呆滞比率汇总表', grain: 'DWS 汇总', cat: '业务数据源', domain: '备件服务', dept: '备件OTS', db: 'GaussDB', sync: 'T+1更新', rows: '约 14,464 行', func: '呆滞比率多维汇总', desc: '业务数据源', tags: '呆滞率, 库容周转', ai_intent: '各区域备件周转健康度评估' },
        { name: 'cs_nc_comm_customer_d_list', name_cn: '大T客户维表', grain: 'DIM 维表', cat: '业务数据源', domain: '公共数据', dept: '公共数据', db: 'GaussDB', sync: 'T+1更新', rows: '约 39,610 行', func: '维护Top客户/分支客户分类', desc: 'BIDS同步公共数据，源端 cs_nc_comm_customer_d_list_ods', tags: '大T客户, 战略客户, 客户分类, 分支映射', ai_intent: '按大T（战略运营商客户）进行指标透视与下钻' },
        { name: 'cs_nc_network_all_dwd', name_cn: '价值网络明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '网络维护', dept: '公共数据', db: 'GaussDB', sync: 'T+1更新', rows: '约 11,043 行', func: '维护全部价值网络信息(运营商+政企)', desc: 'datacube公共网络数据', tags: '价值网络, 核心资产, 网络拓扑', ai_intent: '圈定重要保电/重大事件保障网络清单' },
        { name: 'op_ioc_accident_event_drill_dwd', name_cn: '事故演练明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '预案演练', dept: '主动维护', db: 'GaussDB', sync: 'T+1同步', rows: '约 17,434 行', func: '记录预案与事故演练明细', desc: 'BIDS同步，关联事故演练湖表', tags: '预案演练, 应急演练, 演练完成率', ai_intent: '各代表处事故应急预案演练达标情况' },
        { name: 'op_ioc_rpt_plan_topo_dwd', name_cn: '预案拓扑明细表', grain: 'DWD 明细', cat: '业务数据源', domain: '预案演练', dept: '主动维护', db: 'GaussDB', sync: 'T+1同步', rows: '约 56,635 行', func: '记录预案拓扑明细', desc: 'BIDS同步湖表', tags: '预案拓扑, 切换方案, 容灾网络', ai_intent: '查询容灾网络预案拓扑覆盖率' },

        // 应用数据源 (12)
        { name: 'demo_test', name_cn: '演示测试表', grain: 'APP 专属', cat: '应用数据源', domain: '应用测试', dept: '未分配', db: 'MySQL', sync: '应用自定义', rows: '约 2 行', func: '基座应用环境连通性演示测试', desc: '应用接入，schema: 3837caea-...', tags: '演示测试, 连通性测试', ai_intent: '验证应用写入与读取是否通畅' },
        { name: 'APP_3530e9aa_dash_view_log', name_cn: '数字证书看板访问日志', grain: 'APP 专属', cat: '应用数据源', domain: '访问审计', dept: '未分配', db: '库表', sync: '实时记录', rows: '—', func: '记录数字证书大屏访问与查询日志', desc: 'schema: 3530e9aa-...', tags: '访问日志, 审计记录, PV统计', ai_intent: '分析证书看板的用户活跃度与访问高峰' },
        { name: 'APP_9af03f4f_t_data_element', name_cn: '报表数据元素表(9af0)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '约 7 行', func: '保存动态报表的数据元素定义', desc: 'schema: 9af03f4f-...', tags: '数据元素, 动态报表, 图表绑定', ai_intent: '管理报表中已配置的数据源图表组件' },
        { name: 'APP_9af03f4f_t_data_source', name_cn: '报表数据源连接表(9af0)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '约 3 行', func: '管理动态报表引用的数据源配置', desc: 'schema: 9af03f4f-...', tags: '数据源连接, 报表配置', ai_intent: '查询报表连接的业务库端点' },
        { name: 'APP_9af03f4f_t_report_block', name_cn: '报表区块布局表(9af0)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '约 7 行', func: '记录报表内各网格与卡片区块布局', desc: 'schema: 9af03f4f-...', tags: '区块布局, 排版结构', ai_intent: '获取报表页面的栅格排版信息' },
        { name: 'APP_9af03f4f_t_report_config', name_cn: '报表全局配置表(9af0)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '约 5 行', func: '保存报表主题、租户与全局过滤参数', desc: 'schema: 9af03f4f-...', tags: '报表参数, 全局过滤', ai_intent: '读取报表的默认统计月份与区域过滤' },
        { name: 'APP_9af03f4f_t_report_template', name_cn: '报表模板主表(9af0)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '约 1 行', func: '报表模板元数据与发布状态', desc: 'schema: 9af03f4f-...', tags: '模板定义, 报表版本', ai_intent: '加载报表模板渲染骨架' },
        { name: 'APP_cb6053a5_t_data_element', name_cn: '报表数据元素表(cb60)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '—', func: '第二租户动态报表数据元素表', desc: 'schema: cb6053a5-...', tags: '数据元素, 租户隔离', ai_intent: '隔离环境下的报表元素管理' },
        { name: 'APP_cb6053a5_t_data_source', name_cn: '报表数据源连接表(cb60)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '约 3 行', func: '第二租户数据源连接配置', desc: 'schema: cb6053a5-...', tags: '数据源, 租户隔离', ai_intent: '隔离环境下的数据源维护' },
        { name: 'APP_cb6053a5_t_report_block', name_cn: '报表区块布局表(cb60)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '—', func: '第二租户报表区块排版配置', desc: 'schema: cb6053a5-...', tags: '区块布局, 租户隔离', ai_intent: '隔离环境下的区块排版' },
        { name: 'APP_cb6053a5_t_report_config', name_cn: '报表全局配置表(cb60)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '—', func: '第二租户报表全局配置', desc: 'schema: cb6053a5-...', tags: '报表配置, 租户隔离', ai_intent: '隔离环境下的全局参数' },
        { name: 'APP_cb6053a5_t_report_template', name_cn: '报表模板主表(cb60)', grain: 'APP 专属', cat: '应用数据源', domain: '动态报表', dept: '未分配', db: '库表', sync: '用户配置', rows: '—', func: '第二租户报表模板主记录', desc: 'schema: cb6053a5-...', tags: '模板主表, 租户隔离', ai_intent: '隔离环境下的模板发布' }
    ];

    assetsRaw.forEach((item, index) => {
        const row = wsAssets.addRow({
            idx: index + 1,
            name: item.name,
            name_cn: item.name_cn,
            grain: item.grain,
            cat: item.cat,
            domain: item.domain,
            dept: item.dept,
            db: item.db,
            sync: item.sync,
            rows: item.rows,
            func: item.func,
            desc: item.desc,
            tags: item.tags,
            ai_intent: item.ai_intent
        });
        row.height = 24;
        row.font = fontBase;
        row.eachCell(c => {
            c.border = borderThin;
            c.alignment = { vertical: 'middle' };
            if (c.col === 1 || c.col === 4 || c.col === 5 || c.col === 8) c.alignment = { vertical: 'middle', horizontal: 'center' };
            if (index % 2 === 1) c.fill = fillZebra;
        });

        // Highlight grain cell
        const grainCell = row.getCell('grain');
        if (item.grain.includes('DWS')) {
            grainCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
            grainCell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF0369A1' } };
        } else if (item.grain.includes('DWD')) {
            grainCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
            grainCell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF15803D' } };
        } else if (item.grain.includes('SNAP')) {
            grainCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
            grainCell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF7E22CE' } };
        } else if (item.grain.includes('DIM')) {
            grainCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
            grainCell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF0F766E' } };
        }
    });

    // ==========================================
    // SHEET 3: 核心业务指标与出处映射表
    // ==========================================
    const wsMetrics = workbook.addWorksheet('3.核心业务指标与出处映射', {
        views: [{ showGridLines: true, state: 'frozen', xSplit: 3, ySplit: 2 }]
    });

    wsMetrics.columns = [
        { header: '序号', key: 'idx', width: 6 },
        { header: '指标中文名称', key: 'metric_cn', width: 26 },
        { header: '英文字段名 / 标识', key: 'metric_en', width: 28 },
        { header: '所属业务专题', key: 'topic', width: 18 },
        { header: '统计口径与业务定义公式', key: 'formula', width: 44 },
        { header: '推荐优先查询表 (DWS)', key: 'table_dws', width: 34 },
        { header: '下钻明细支持表 (DWD)', key: 'table_dwd', width: 34 },
        { header: '历史趋势快照表 (SNAP)', key: 'table_snap', width: 34 },
        { header: '辅助关联维表', key: 'table_dim', width: 24 },
        { header: '所属大屏 / 月报页面', key: 'report_page', width: 28 },
        { header: '更新频率', key: 'freq', width: 12 }
    ];

    const metricsHeader = wsMetrics.getRow(1);
    metricsHeader.font = fontHeader;
    metricsHeader.fill = fillHeaderPrimary;
    metricsHeader.height = 28;
    metricsHeader.alignment = { vertical: 'middle', horizontal: 'center' };

    const metricsData = [
        { cn: '网络变更成功率', en: 'success_rate', topic: '网络变更', formula: '(变更操作总数 - 确认倒回数) / 变更操作总数 * 100%', dws: 'op_ioc_rfc_task_report_h_dws_0 / _1', dwd: 'op_ioc_rfc_task_report_dtl_m_dwd', snap: '—', dim: 'common_data_rep', page: '中国区网络变更业务风险月报 / 管理升级月报', freq: 'T+1更新' },
        { cn: '网络变更操作总数', en: 'operation_total', topic: '网络变更', formula: '统计周期内执行的 RFC 变更操作单据总和', dws: 'op_ioc_rfc_task_report_h_dws_0 / _1', dwd: 'op_ioc_rfc_task_report_dtl_m_dwd', snap: '—', dim: 'common_data_rep', page: '网络变更业务风险月报 / 管理升级月报', freq: 'T+1更新' },
        { cn: '确认倒回数', en: 'confirmed_rollback', topic: '网络变更', formula: '因方案质量、产品故障或人为操作失误导致正式执行倒回的次数', dws: 'op_ioc_rfc_task_report_h_dws_0 / _1', dwd: 'op_ioc_rfc_task_report_dtl_m_dwd', snap: '—', dim: 'common_data_rep', page: '网络变更业务风险月报 / 管理升级月报', freq: 'T+1更新' },
        { cn: '高危命令拦截总数', en: 'highrisk_intercept_cnt', topic: '网络变更', formula: 'Netcare 管道客户端对高危违规命令实时拦截的日志记录总数', dws: 'op_ioc_highrisk_commands_d_dws', dwd: 'op_ioc_highrisk_commands_d_dwd', snap: '—', dim: 'common_data_rep', page: '网络变更业务风险月报', freq: '实时/T+1' },
        { cn: '高危操作成功率', en: 'high_risk_success_rate', topic: '网络变更', formula: '(高危操作数 - 高危倒回数) / 高危操作数 * 100%', dws: 'op_ioc_rfc_task_report_h_dws_0 / _1', dwd: 'op_ioc_rfc_task_report_dtl_m_dwd', snap: '—', dim: 'common_data_rep', page: '管理升级月报', freq: 'T+1更新' },
        { cn: '重急EOS收编完成率', en: 'urgent_eos_incorporate_rate', topic: '产品生命周期', formula: '已收编重急EOS设备数 / (已收编数 + 待收编数) * 100%', dws: 'nc_eos_risk_urgent_product_version_dws', dwd: 'nc_eos_risk_management_dwd', snap: 'nc_eos_risk_urgent_product_version_dws_snap', dim: 'common_data_product', page: '专题分析-EOS月报 / 网络运行风险消减月报', freq: 'T+1更新' },
        { cn: '重急EOS设备总数', en: 'urgent_eos_cnt', topic: '产品生命周期', formula: '全网入网且已达到或即将达到重急 EOS 状态的网元设备总和', dws: 'nc_eos_risk_urgent_product_version_dws', dwd: 'nc_eos_risk_management_dwd', snap: 'nc_eos_risk_urgent_product_version_dws_snap', dim: 'common_data_product', page: '专题分析-EOS月报', freq: 'T+1更新' },
        { cn: '数字证书30天内到期数', en: 'expiring_30d_cnt', topic: '数字证书', formula: '当前有效但到期日期距离统计当天小于等于 30 天的证书实例数', dws: 'op_ioc_digital_cert_2026_d_dws', dwd: 'op_ioc_digital_cert_2026_d_dwd', snap: 'op_ioc_digital_cert_2026_d_dws_snap', dim: 'common_data_rep', page: '中国地区网络运行风险消减月报', freq: 'T+1更新' },
        { cn: '已过期数字证书数', en: 'expired_cert_cnt', topic: '数字证书', formula: '证书有效期截止时间早于当前系统时间的未替换证书数', dws: 'op_ioc_digital_cert_2026_d_dws', dwd: 'op_ioc_digital_cert_2026_d_dwd', snap: 'op_ioc_digital_cert_2026_d_dws_snap', dim: 'common_data_rep', page: '中国地区网络运行风险消减月报', freq: 'T+1更新' },
        { cn: '管理升级7天方案提供率', en: 'plan_within_7d_rate', topic: '管理升级', formula: '7天内提供有效处理方案的管理升级数 / 管理升级总数 * 100%', dws: 'op_ioc_escalation_d_dws', dwd: 'op_ioc_escalation_d_dwd', snap: '—', dim: 'common_data_rep', page: '全球管理升级运营看板 / 管理升级月报', freq: 'T+1更新' },
        { cn: '一级管理升级总数', en: 'level1_escalation_total', topic: '管理升级', formula: '责任评级为一级（最高关注级别）的管理升级工单总量', dws: 'op_ioc_escalation_d_dws', dwd: 'op_ioc_escalation_d_dwd', snap: '—', dim: 'common_data_rep', page: '全球管理升级运营看板 / 管理升级月报', freq: 'T+1更新' },
        { cn: '一二级重大事故数', en: 'major_incident_cnt', topic: '事故管理', formula: '符合局方或内部一级、二级通报标准的重大业务中断事件单据总和', dws: '—', dwd: 'op_ioc_incident_h_dwd', snap: '—', dim: 'common_data_rep', page: '全球网上事故运营看板', freq: '实时同步' },
        { cn: '整改任务核查完成率', en: 'rectify_complete_rate', topic: '整改核查', formula: '核查完成整改任务数 / 核查任务总数 * 100%', dws: 'op_ioc_rectify_check_d_dws', dwd: 'op_ioc_rectify_check_d_dwd', snap: 'op_ioc_rectify_check_d_dws_snap', dim: 'common_data_rep', page: '中国地区网络运行风险消减月报', freq: '每天9点' },
        { cn: '超期未完成整改NE数', en: 'overdue_ne_cnt', topic: '整改核查', formula: '整改截止期已过但仍未完成整改消除的网元（NE）数量', dws: 'op_ioc_rectify_check_d_dws', dwd: 'op_ioc_rectify_check_d_dwd', snap: 'op_ioc_rectify_check_d_dws_snap', dim: 'common_data_rep', page: '中国地区网络运行风险消减月报', freq: '每天9点' },
        { cn: '网络巡检完成率', en: 'health_check_rate', topic: '网络巡检', formula: '已检查巡检单数 / 应检查巡检总数 * 100%', dws: 'op_ioc_health_check_dws', dwd: 'op_ioc_health_check_dwd', snap: '—', dim: 'common_data_rep', page: '中国地区网络运行风险消减月报', freq: 'T+1更新' },
        { cn: '过期 License 总数', en: 'expired_license_cnt', topic: 'License管理', formula: '固定期限许可已过截止期且未续约的设备 License 实例总和', dws: 'op_ioc_license_data_stat_d_dws_0 / _1', dwd: 'op_ioc_license_data_dtl_d_dwd_0 / _1', snap: '—', dim: 'common_data_rep', page: '中国地区网络运行风险消减月报', freq: 'T+1更新' },
        { cn: '作战地图红牌数', en: 'saca_red_card_cnt', topic: '运维合规', formula: '触碰严重红线或严重考核违规被扣罚红牌的记录次数', dws: 'op_ioc_saca_card_new_dws', dwd: 'op_ioc_saca_card_dwd', snap: '—', dim: 'common_data_rep', page: '维护作战地图', freq: 'T+1更新' },
        { cn: '备件OTS月度达标率', en: 'monthly_ots_rate', topic: '备件服务', formula: '当月在承诺时效（SLA）内送达客户现场的备件交付单比例', dws: 'spsa_2_access_monthly_ots_rate', dwd: 'spsa_2_ots_detail', snap: '—', dim: 'cs_nc_comm_customer_d_list', page: '备件OTS看板', freq: '月度更新' }
    ];

    metricsData.forEach((item, index) => {
        const row = wsMetrics.addRow({
            idx: index + 1,
            metric_cn: item.cn,
            metric_en: item.en,
            topic: item.topic,
            formula: item.formula,
            table_dws: item.dws,
            table_dwd: item.dwd,
            table_snap: item.snap,
            table_dim: item.dim,
            report_page: item.page,
            freq: item.freq
        });
        row.height = 24;
        row.font = fontBase;
        row.eachCell(c => {
            c.border = borderThin;
            c.alignment = { vertical: 'middle' };
            if (c.col === 1 || c.col === 4 || c.col === 11) c.alignment = { vertical: 'middle', horizontal: 'center' };
            if (index % 2 === 1) c.fill = fillZebra;
        });
    });

    // ==========================================
    // SHEET 4: 223项接口与路由速查表
    // ==========================================
    const wsAPIs = workbook.addWorksheet('4.接口与路由速查(223项精选)', {
        views: [{ showGridLines: true, state: 'frozen', xSplit: 2, ySplit: 2 }]
    });

    wsAPIs.columns = [
        { header: '序号', key: 'idx', width: 6 },
        { header: '所属应用名称', key: 'app', width: 24 },
        { header: '请求方法', key: 'method', width: 10 },
        { header: '接口路径 (Route)', key: 'path', width: 34 },
        { header: '接口业务功能描述', key: 'desc', width: 44 },
        { header: '涉及核心业务指标 / 参数', key: 'metrics', width: 46 },
        { header: '接口所属功能模块', key: 'module', width: 18 }
    ];

    const apisHeader = wsAPIs.getRow(1);
    apisHeader.font = fontHeader;
    apisHeader.fill = fillHeaderPrimary;
    apisHeader.height = 28;
    apisHeader.alignment = { vertical: 'middle', horizontal: 'center' };

    const apisRaw = [
        { app: '全球网上事故运营看板', method: 'POST', path: '/api/invoke', desc: '事故统计大屏统一入口，分发意图查询核心指标概览、趋势、排名、明细等数据', metrics: '事故数，一二级事故，恢复时长', module: '意图分发/大屏' },
        { app: '全球管理升级运营看板', method: 'POST', path: '/api/invoke', desc: '管理升级运营大屏统一入口，支持看板概览、趋势、排名、明细进度等意图查询', metrics: '管理升级总数, 一级管理升级, 7天方案提供率, 平均方案提供时长(天), 未闭环数', module: '意图分发/大屏' },
        { app: '备件OTS看板', method: 'POST', path: '/api/invoke', desc: '质量服务看板统一路由入口，按意图查询对应业务模块月度指标数据', metrics: '事故单类型, 产品质量, 服务质量, 销售质量, 达标率', module: '意图分发/大屏' },
        { app: '盯进展', method: 'GET', path: '/api/asset', desc: '看数据模块，查询资产清单列表，支持按类型、关键字筛选及分页', metrics: '资产清单, 资产总量, 分页参数', module: '资产管理' },
        { app: '盯进展', method: 'GET', path: '/api/asset/metrics', desc: '看数据页模块，查询业务指标口径清单，用于展示资产指标定义及口径', metrics: 'code, name, calib, stat_scope, dept, update_freq', module: '资产管理' },
        { app: '盯进展', method: 'GET', path: '/api/asset/{asset_id}/columns', desc: '查询指定资产字段元数据，合并物理字段信息与业务元数据', metrics: '字段名称, 字段中文名, 数据类型, 业务描述', module: '元数据探查' },
        { app: '盯进展', method: 'GET', path: '/api/asset/{asset_id}/data', desc: '查询指定资产表的数据样板及分页列表，用于表结构与数据预览', metrics: '样板数据, 分页明细, 总行数', module: '数据预览' },
        { app: '盯进展', method: 'GET', path: '/api/filters/options', desc: '一次性返回ICT场景、地区部、产品线、代表处、国家等全部筛选下拉数据', metrics: 'ICT场景, 地区部, 代表处, 国家/区域, 产品线', module: '通用筛选' },
        { app: '数字人-风险管理', method: 'GET', path: '/dashboard', desc: '风险看板模块，查询KPI、三图及全量趋势，支持多维度筛选联动', metrics: 'risk_cnt, mh, disposed, closed, impending, overdue_undisposed, disp_rate, clear_rate', module: '风险看板' },
        { app: '数字人-风险管理', method: 'GET', path: '/detail', desc: '详细进展模块，按指定维度分页查询风险明细及全量汇总行，下钻分析', metrics: 'risk_cnt, mh, high_risk_cnt, timely_disposed_cnt, overdue_disposed_cnt', module: '风险下钻' },
        { app: '数字人-风险管理', method: 'GET', path: '/mini-dashboard', desc: '风险看板轻量级接口，查询KPI和地区部分布图数据，响应更快', metrics: 'risk_cnt, mh, disposed, closed, disp_rate, clear_rate', module: '微看板' },
        { app: '管理升级月报', method: 'GET', path: '/api/overview/kpi', desc: '总览看板KPI模块，查询整体及高危运维操作的核心指标数据，用于全局监控', metrics: 'operation_total, confirmed_rollback, tracing_rollback, success_rate, high_risk_operation', module: '月报总览' },
        { app: '管理升级月报', method: 'GET', path: '/api/charts/trends', desc: '质量运营看板趋势模块，按月查询操作量与倒回量趋势', metrics: '月度操作量, 月度倒回量, 同期对比', module: '趋势图表' },
        { app: '管理升级月报', method: 'GET', path: '/api/detail/table', desc: '运维看板明细表格接口，按地区部、代表处、子网、大T查询运维操作与回退', metrics: 'success_rate, urgent_operation, daytime_operation, force_majeure, product_reason', module: '月报表格' },
        { app: '管理升级月报', method: 'GET', path: '/api/detail/list', desc: '变更任务明细看板，按RFC单号分页查询变更操作明细及回退、高危维度指标', metrics: 'RFC单号, 变更人员, 倒回原因, 操作时段', module: '工单详单' },
        { app: '中国地区网络运行风险消减月报', method: 'GET', path: '/report/all-kpi', desc: '批量获取所有KPI总览，一次请求返回高风险、证书、EOS、整改、巡检、License六大KPI', metrics: '总风险数, 闭环率, 数字证书KPI, EOS风险KPI, 整改KPI, License过期总数', module: '全量KPI' },
        { app: '中国地区网络运行风险消减月报', method: 'GET', path: '/report/top-risk/kpi', desc: 'TOP风险KPI看板，查询总风险数、闭环数、闭环率、逾期数及中高风险指标', metrics: 'TOP风险KPI, 总风险数, 闭环率, 中高风险总数, 中高风险闭环率', module: 'TOP风险' },
        { app: '中国地区网络运行风险消减月报', method: 'GET', path: '/report/digital-cert/kpi', desc: '数字证书KPI看板，查询指定月份及代表处的数字证书关键指标', metrics: '证书总数, 有效证书数, 过期证书数, 30天内即将过期证书数', module: '证书KPI' },
        { app: '中国地区网络运行风险消减月报', method: 'GET', path: '/report/digital-cert/detail', desc: '数字证书详单，查询数字证书明细数据', metrics: '证书实例, 域名, 过期日期, 责任人, 代表处', module: '证书明细' },
        { app: '中国地区网络运行风险消减月报', method: 'GET', path: '/report/eos-risk/kpi', desc: '重急EOS风险KPI看板，查询月度EOS风险关键指标，按代表处筛选', metrics: 'EOS总数, 闭环数, 闭环率, 中高风险EOS总数, 中高风险EOS闭环率', module: 'EOS KPI' },
        { app: '中国地区网络运行风险消减月报', method: 'GET', path: '/report/license/kpi', desc: '过期License KPI看板，查询License过期相关指标', metrics: 'License总数, 过期License数, 过期率, 宽限期内过期数', module: 'License KPI' },
        { app: '中国区网络变更业务风险月报', method: 'GET', path: '/report/overview', desc: '变更业务风险概览总览看板，查询人员、账号、方案、操作、审批、实施等全维度指标', metrics: '动网标签, 风险人员, 共享账号, 倒回率, 高危命令拦截, 在线授权比例, inside使用率', module: '综合月报' },
        { app: '中国区管理升级月报', method: 'GET', path: '/api/upgrade', desc: '管理升级总览看板，查询升级管理汇总数据', metrics: '升级总数, 升级状态分布, 级别占比, 闭环率', module: '升级看板' },
        { app: '中国区管理升级月报', method: 'GET', path: '/api/upgrade/closed-duration', desc: '管理升级模块，查询已闭环事件的闭环时长分布', metrics: '闭环时长分布, 7天内闭环, 15天内闭环, 30天以上', module: '时长分析' },
        { app: '动态报告生成', method: 'POST', path: '/fetch', desc: '通用数据看板模块，根据数据元素ID获取对应看板/指标数据，用于动态加载', metrics: '数据元素ID, 时间范围, 地区部筛选, 代表处筛选', module: '动态取数' },
        { app: '动态报告生成', method: 'POST', path: '/pivot', desc: '数据透视聚合接口，按维度字段进行多维度分组聚合统计(COUNT/SUM/AVG/MIN/MAX)', metrics: '维度分组, 聚合方式, 求和, 计数, 平均值, 筛选条件', module: '数据透视' },
        { app: 'demo-business-app', method: 'GET', path: '/api/test/check-base-urls', desc: '验证基座注入的 BASE_*_URL 环境变量是否齐全且互相一致', metrics: 'BASE_DATASOURCES_URL, BASE_REP_OFFICES_URL, URL一致性', module: '基座测试' },
        { app: 'demo-business-app', method: 'GET', path: '/api/test/cache-ttl-max', desc: '验证缓存 TTL 超过 7 天(604800秒)时被基座拒绝，返回 400 错误', metrics: 'TTL超限拦截, 缓存安全配置', module: '基座测试' },
        { app: 'demo-business-app', method: 'GET', path: '/api/test/write-other-uuid', desc: '安全测试接口，验证业务应用越权写其他应用 UUID schema 预期被拦截', metrics: '越权写测试, 租户隔离, 安全沙箱验证', module: '安全测试' }
    ];

    apisRaw.forEach((item, index) => {
        const row = wsAPIs.addRow({
            idx: index + 1,
            app: item.app,
            method: item.method,
            path: item.path,
            desc: item.desc,
            metrics: item.metrics,
            module: item.module
        });
        row.height = 24;
        row.font = fontBase;
        row.eachCell(c => {
            c.border = borderThin;
            c.alignment = { vertical: 'middle' };
            if (c.col === 1 || c.col === 3) c.alignment = { vertical: 'middle', horizontal: 'center' };
            if (index % 2 === 1) c.fill = fillZebra;
        });

        // Method tag
        const methodCell = row.getCell('method');
        if (item.method === 'POST') {
            methodCell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFD97706' } };
        } else if (item.method === 'GET') {
            methodCell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF2563EB' } };
        }
    });

    // ==========================================
    // SHEET 5: 一键测试与高频 SQL 实战库
    // ==========================================
    const wsSQL = workbook.addWorksheet('5.一键测试SQL实战手册', {
        views: [{ showGridLines: true }]
    });

    wsSQL.columns = [
        { header: '序号', key: 'idx', width: 6 },
        { header: '业务专题', key: 'topic', width: 16 },
        { header: '测试场景需求描述', key: 'scene', width: 34 },
        { header: '标准只读 SQL 模板 (带占位符过滤与维表关联)', key: 'sql', width: 68 },
        { header: '查询优化要点与避坑说明', key: 'notes', width: 40 }
    ];

    const sqlHeader = wsSQL.getRow(1);
    sqlHeader.font = fontHeader;
    sqlHeader.fill = fillHeaderPrimary;
    sqlHeader.height = 28;
    sqlHeader.alignment = { vertical: 'middle', horizontal: 'center' };

    const sqlData = [
        {
            topic: '网络变更 (RFC)',
            scene: '一键测试：统计最近30天各代表处变更总量、倒回量与成功率排名',
            sql: `SELECT \n    r.rep_name_cn AS 代表处,\n    SUM(c.operation_total) AS 变更操作总数,\n    SUM(c.confirmed_rollback) AS 确认倒回数,\n    ROUND(SUM(c.operation_total - c.confirmed_rollback) * 100.0 / NULLIF(SUM(c.operation_total), 0), 2) AS 变更成功率_百分比\nFROM netcare.op_ioc_rfc_task_report_h_dws_0 c\nLEFT JOIN netcare.common_data_rep r ON c.repoffice_code = r.dept_code\nWHERE c.period_date >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)\n  AND c.repoffice_code NOT IN ('SNULL', '源为空', '-999999', 'Unknown')\nGROUP BY r.rep_name_cn\nORDER BY 确认倒回数 DESC\nLIMIT 30;`,
            notes: '① 使用 DWS 宽表毫秒返回，禁止在 DWD 上裸查\n② 必须过滤 repoffice_code 占位符\n③ 使用 NULLIF 避免被 0 除报错'
        },
        {
            topic: '数字证书 (Cert)',
            scene: '一键测试：统计最新快照下各代表处即将于30天内到期的证书分布',
            sql: `SELECT \n    r.rep_name_cn AS 代表处,\n    SUM(d.cert_total) AS 证书总数,\n    SUM(d.expired_cnt) AS 已过期证书数,\n    SUM(d.expiring_30d_cnt) AS 30天内即将过期证书数\nFROM netcare.op_ioc_digital_cert_2026_d_dws d\nLEFT JOIN netcare.common_data_rep r ON d.repoffice_code = r.dept_code\nWHERE d.period_date = (SELECT MAX(period_date) FROM netcare.op_ioc_digital_cert_2026_d_dws)\nGROUP BY r.rep_name_cn\nHAVING 30天内即将过期证书数 > 0\nORDER BY 30天内即将过期证书数 DESC\nLIMIT 30;`,
            notes: '① 子查询取 MAX(period_date) 确保读取最新时点数据\n② HAVING 过滤只看有预警风险的代表处'
        },
        {
            topic: '重急EOS收编',
            scene: '一键测试：按产品线统计当前重急EOS产品收编进度与完成率',
            sql: `SELECT \n    product_line AS 产品线,\n    COUNT(DISTINCT product_name) AS 重急产品数,\n    SUM(urgent_eos_cnt) AS 重急设备总数,\n    SUM(incorporated_cnt) AS 已收编数,\n    SUM(pending_cnt) AS 待收编数,\n    ROUND(SUM(incorporated_cnt) * 100.0 / NULLIF(SUM(incorporated_cnt + pending_cnt), 0), 2) AS 收编完成率_百分比\nFROM netcare.nc_eos_risk_urgent_product_version_dws\nGROUP BY product_line\nORDER BY 待收编数 DESC;`,
            notes: '① 直接使用重急专属统计宽表，字段口径已对齐月报\n② 按照待收编数倒序，直观呈现最重风险产品线'
        },
        {
            topic: '管理升级',
            scene: '一键测试：统计当月各地区部管理升级总数与7天方案提供率',
            sql: `SELECT \n    region_name AS 地区部,\n    SUM(escalation_total) AS 升级总数,\n    SUM(level1_total) AS 一级升级数,\n    SUM(level2_total) AS 二级升级数,\n    SUM(plan_within_7d_cnt) AS 七天提供方案数,\n    ROUND(SUM(plan_within_7d_cnt) * 100.0 / NULLIF(SUM(escalation_total), 0), 2) AS 七天方案提供率_百分比,\n    SUM(unclosed_total) AS 未闭环数\nFROM netcare.op_ioc_escalation_d_dws\nWHERE period_month = DATE_FORMAT(CURRENT_DATE, '%Y-%m')\nGROUP BY region_name\nORDER BY 升级总数 DESC;`,
            notes: '① 过滤当月 period_month，防止跨月数据重复加总\n② 一级升级数是考核硬指标'
        },
        {
            topic: '整改核查',
            scene: '一键测试：各代表处整改超期未完成网元数与延期整改统计',
            sql: `SELECT \n    r.rep_name_cn AS 代表处,\n    SUM(t.check_cnt) AS 核查总数,\n    SUM(t.check_complete_cnt) AS 核查完成数,\n    SUM(t.overdue_ne_cnt) AS 超期未完成NE数,\n    SUM(t.delay_rectify_cnt) AS 延期整改数\nFROM netcare.op_ioc_rectify_check_d_dws t\nLEFT JOIN netcare.common_data_rep r ON t.repoffice_code = r.dept_code\nWHERE t.period_date = (SELECT MAX(period_date) FROM netcare.op_ioc_rectify_check_d_dws)\nGROUP BY r.rep_name_cn\nORDER BY 超期未完成NE数 DESC\nLIMIT 30;`,
            notes: '① 千万不要在 op_ioc_rectify_check_d_dwd_snap 上裸跑，必用 dws 表\n② 按照超期 NE 降序，定位问题最突出的代表处'
        },
        {
            topic: '高危命令拦截',
            scene: '一键测试：统计近7天被拦截的高危命令规则类型与频次',
            sql: `SELECT \n    command_type AS 命令分类,\n    COUNT(*) AS 拦截次数,\n    COUNT(DISTINCT operator) AS 涉及操作人数\nFROM netcare.op_ioc_highrisk_commands_d_dwd\nWHERE intercept_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)\nGROUP BY command_type\nORDER BY 拦截次数 DESC\nLIMIT 20;`,
            notes: '① 高危明细表在 MySQL，实时写入，时间字段支持 NOW()\n② 用于排查高频违规误操作命令'
        },
        {
            topic: '固定License',
            scene: '一键测试：统计各代表处过期固定期限License与宽限期分布',
            sql: `SELECT \n    r.rep_name_cn AS 代表处,\n    SUM(l.expired_cnt) AS 过期License数,\n    SUM(l.in_grace_cnt) AS 宽限期内数,\n    SUM(l.out_grace_cnt) AS 宽限期外严重过期数\nFROM netcare.op_ioc_license_data_stat_d_dws_0 l\nLEFT JOIN netcare.common_data_rep r ON l.repoffice_code = r.dept_code\nGROUP BY r.rep_name_cn\nORDER BY 宽限期外严重过期数 DESC\nLIMIT 30;`,
            notes: '① 优先关注宽限期外严重过期设备，有断服风险\n② 0号表与1号表根据 latest_table_name 切换'
        },
        {
            topic: '作战地图SACA',
            scene: '一键测试：统计最新月份各代表处作战地图红牌、黄牌与扣分',
            sql: `SELECT \n    r.rep_name_cn AS 代表处,\n    SUM(s.red_card_cnt) AS 红牌数,\n    SUM(s.yellow_card_cnt) AS 黄牌数,\n    SUM(s.total_deduct_score) AS 累计扣分\nFROM netcare.op_ioc_saca_card_new_dws s\nLEFT JOIN netcare.common_data_rep r ON s.repoffice_code = r.dept_code\nWHERE s.period_month = DATE_FORMAT(CURRENT_DATE, '%Y-%m')\nGROUP BY r.rep_name_cn\nORDER BY 红牌数 DESC, 累计扣分 DESC\nLIMIT 30;`,
            notes: '① 红牌数优先降序，其次按累计扣分排序\n② 用于月报合规红黄牌通报章节'
        },
        {
            topic: '公共组织维表',
            scene: '一键测试：全量拉取地区部与代表处层级映射字典',
            sql: `SELECT \n    dept_code AS 代表处编码,\n    rep_name_cn AS 代表处全称,\n    rep_short_name_cn AS 代表处简称,\n    region_code AS 地区部编码,\n    region_name_cn AS 地区部全称\nFROM netcare.common_data_rep\nWHERE is_active = '1'\nORDER BY region_code, dept_code;`,
            notes: '① 维表仅 622 行，可一次性缓存在 Redis 中 7 天\n② 供所有前端下拉框初始化与报表中文名补齐'
        },
        {
            topic: '备件OTS达标',
            scene: '一键测试：统计各代表处备件到货时效OTS月度达标率',
            sql: `SELECT \n    repoffice_name AS 代表处,\n    SUM(delivered_total) AS 交付总数,\n    SUM(ots_ontime_cnt) AS 准时送达数,\n    ROUND(SUM(ots_ontime_cnt) * 100.0 / NULLIF(SUM(delivered_total), 0), 2) AS OTS达标率_百分比\nFROM netcare.spsa_2_access_monthly_ots_rate\nWHERE report_month = DATE_FORMAT(CURRENT_DATE, '%Y-%m')\nGROUP BY repoffice_name\nORDER BY OTS达标率_百分比 ASC;`,
            notes: '① 升序排列，直接抓出 OTS 达标率垫底的代表处进行催办\n② 属于备件与售后质量关键监控项'
        }
    ];

    sqlData.forEach((item, index) => {
        const row = wsSQL.addRow({
            idx: index + 1,
            topic: item.topic,
            scene: item.scene,
            sql: item.sql,
            notes: item.notes
        });
        row.font = fontBase;
        row.eachCell(c => {
            c.border = borderThin;
            c.alignment = { vertical: 'middle', wrapText: true };
            if (c.col === 1 || c.col === 2) c.alignment = { vertical: 'middle', horizontal: 'center' };
            if (c.col === 4) {
                c.font = { name: 'Consolas', size: 9.5, color: { argb: 'FF1E293B' } };
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            }
            if (index % 2 === 1 && c.col !== 4) c.fill = fillZebra;
        });
        row.height = 110;
    });

    const outDir = path.resolve(__dirname, 'tools-platform', 'outputs');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    const targetFile = path.join(outDir, 'AIOps数仓业务数据资产与指标全景指南.xlsx');
    await workbook.xlsx.writeFile(targetFile);
    console.log('Excel successfully created at:', targetFile);
    return targetFile;
}

buildDataAssetsWorkbook().catch(err => {
    console.error('Error generating Excel:', err);
    process.exit(1);
});
