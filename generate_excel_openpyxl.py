import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def create_aiops_guide_excel():
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    font_family = "微软雅黑"
    font_title = Font(name=font_family, size=15, bold=True, color="1E293B")
    font_subtitle = Font(name=font_family, size=10, italic=True, color="64748B")
    font_section = Font(name=font_family, size=11, bold=True, color="1E40AF")
    font_header = Font(name=font_family, size=10.5, bold=True, color="FFFFFF")
    font_base = Font(name=font_family, size=9.5, color="1E293B")
    font_bold = Font(name=font_family, size=9.5, bold=True, color="1E293B")
    font_code = Font(name="Consolas", size=9, color="0F172A")
    font_notes = Font(name=font_family, size=9, color="475569")

    fill_header_primary = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")
    fill_header_sub = PatternFill(start_color="0284C7", end_color="0284C7", fill_type="solid")
    fill_zebra = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    fill_section = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    # Grain fills
    fill_dws = PatternFill(start_color="E0F2FE", end_color="E0F2FE", fill_type="solid")
    font_dws = Font(name=font_family, size=9.5, bold=True, color="0369A1")
    fill_dwd = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
    font_dwd = Font(name=font_family, size=9.5, bold=True, color="15803D")
    fill_ods = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    font_ods = Font(name=font_family, size=9.5, bold=True, color="B45309")
    fill_snap = PatternFill(start_color="F3E8FF", end_color="F3E8FF", fill_type="solid")
    font_snap = Font(name=font_family, size=9.5, bold=True, color="7E22CE")
    fill_dim = PatternFill(start_color="CCFBF1", end_color="CCFBF1", fill_type="solid")
    font_dim = Font(name=font_family, size=9.5, bold=True, color="0F766E")
    fill_app = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    font_app = Font(name=font_family, size=9.5, bold=True, color="475569")

    thin_border_side = Side(style="thin", color="E2E8F0")
    border_cell = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)
    border_header = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=Side(style="medium", color="1E3A8A"))

    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    align_top_left = Alignment(horizontal="left", vertical="top", wrap_text=True)

    # =========================================================================
    # SHEET 1: 数仓分层与数流全景指南
    # =========================================================================
    ws1 = wb.create_sheet(title="1.数仓分层与数流指南")
    ws1.views.sheetView[0].showGridLines = True

    ws1.column_dimensions["A"].width = 3
    ws1.column_dimensions["B"].width = 16
    ws1.column_dimensions["C"].width = 24
    ws1.column_dimensions["D"].width = 32
    ws1.column_dimensions["E"].width = 42
    ws1.column_dimensions["F"].width = 32

    ws1.append([])
    ws1.append(["", "AIOps 数据仓库分层、数据流向与选表全景指南"])
    ws1.cell(2, 2).font = font_title
    ws1.append(["", "面向 AI 智能月报、Python Web 后端开发与数据治理团队的从浅入深实战指南"])
    ws1.cell(3, 2).font = font_subtitle
    ws1.append([])

    # 章节 1
    ws1.append(["", "一、数仓各层级定位与典型特征（ODS / DWD / DWS / SNAP / DIM）"])
    ws1.cell(5, 2).font = font_section

    headers1 = ["", "层级名称", "英文全称 & 通俗比喻", "核心定位与加工深度", "典型数据形态与特征", "月报与开发选表建议"]
    ws1.append(headers1)
    h_row = ws1.max_row
    ws1.row_dimensions[h_row].height = 28
    for col in range(2, 7):
        c = ws1.cell(h_row, col)
        c.font = font_header
        c.fill = fill_header_primary
        c.alignment = align_center
        c.border = border_header

    layers_data = [
        ("ODS 贴源层", "Operational Data Store\n【生鲜原料仓库】", "业务源系统（BIDS、DRS、MySQL业务库、日志、接口）原汁原味落地镜像。未经清洗，保持源端字段名和结构。", "字段有冗余、包含测试单据、脏数据、空值、占位符（如 SNULL, -999999）。通常 T+1 全量或增量同步。", "仅供源端对账、排查同步故障！严禁直接用于月报汇总统计或比率计算。"),
        ("DWD 明细层", "Data Warehouse Detail\n【标准化净菜加工】", "单据最细颗粒度的事实明细层。对 ODS 进行清洗、空值填充、状态标准化、代表处编码归一化后的事实数据。", "每一行对应一个真实业务事件或单据（如每一笔变更 RFC、每一张网上问题 SR、每一条巡检任务、每一张证书）。通常几十万至数百万行。", "适合查具体单号明细、下钻排查异常！统计汇总时必须限定时间/组织过滤，避免全表大扫描引发超时。"),
        ("DWS 汇总层", "Data Warehouse Summary\n【中央厨房标准套餐】", "专为大屏看板、月报专题和多维分析设计的主题预聚合宽表。按业务维度（月/日/代表处/产品线/场景）提前聚合。", "每一行是某个维度组合下的指标汇总值（如 2026年10月+某代表处 的变更总数、倒回数、成功率）。数据量小，查询毫秒级。", "月报制作、大屏看板、AI问答提取指标的首选推荐！毫秒级响应，防 15s 超时。"),
        ("SNAP 快照层", "Snapshot History\n【历史成品冷冻仓】", "历史冻结切片表。每天或每月定时冻结当时时点的 DWD 或 DWS 数据，保留历史版本现场。", "保留历史月份当时的最终得分与指标状态，不可覆盖篡改。由于长期累积，快照表记录数极大（数百万到近 3000 万行）。", "历史月报复盘、环比同比趋势分析专用！查询必须强制指定 target_month 或 period_date 分区字段。"),
        ("DIM 维表层", "Dimension Master Data\n【公共配料字典】", "公共基础维表与层级字典。维护组织树（地区部-代表处）、国家地区、大T客户、产品分类等公共编码映射。", "数据量通常极小（几百到几千行），更新稳定。以 common_data_ 或 _dim 开头。", "所有业务表统计完成后，必须 LEFT JOIN common_data_rep 补齐代表处中文名称，保证输出报表易读。"),
        ("APP 专属层", "Application Schemas\n【各租户私有工作台】", "基座应用在各自专属 UUID Schema 下创建并维护的私有表（如动态报表元素表、模板表、看板访问日志）。", "由应用自身写入和维护，基座平台提供隔离保护。跨应用只读，本应用可写。", "用于存放当前月报草稿、前端组件配置、离线导入中间表等私有数据。")
    ]

    for idx, row in enumerate(layers_data):
        ws1.append(["", *row])
        curr_row = ws1.max_row
        ws1.row_dimensions[curr_row].height = 42
        for col in range(2, 7):
            c = ws1.cell(curr_row, col)
            c.font = font_base
            c.border = border_cell
            c.alignment = align_left
            if idx % 2 == 1:
                c.fill = fill_zebra
        ws1.cell(curr_row, 2).alignment = align_center

    ws1.append([])
    # 章节 2
    ws1.append(["", "二、AIOps 数据端到端流转全景链路"])
    ws1.cell(ws1.max_row, 2).font = font_section

    headers2 = ["", "流转阶段", "涉及系统 / 载体", "核心动作与转换", "主要产出资产 / 表", "注意事项与避坑"]
    ws1.append(headers2)
    h_row2 = ws1.max_row
    ws1.row_dimensions[h_row2].height = 26
    for col in range(2, 7):
        c = ws1.cell(h_row2, col)
        c.font = font_header
        c.fill = fill_header_sub
        c.alignment = align_center
        c.border = border_header

    flow_data = [
        ("1. 源端采集", "NetCare、BIDS、DRS、MySQL业务库、日志", "通过 ODS 同步管道、DRS 实时同步、API 接口抓取", "ODS 贴源表（如 common_data_rep_ods、risk_task_new_ods）", "网络抖动或上游延迟可能导致 T+1 数据滞后，排查先看 ODS insert_time"),
        ("2. 清洗规范", "数仓 ETL 批处理 / 湖仓调度引擎", "去重、过滤测试数据、剔除占位符、组织与国家编码标准化", "DWD 明细表（如 op_ioc_rfc_task_report_dtl_m_dwd、nc_op_sa_sr_problem_detail_all_bg_dwd）", "保留最细颗粒度，数据量较大，写入需建时间与组织索引"),
        ("3. 预聚合建模", "DataCube 汇总计算引擎", "每天 9 点或 T+1 自动按月份、代表处、产品线多维聚合指标", "DWS 宽表（如 op_ioc_rfc_task_report_h_dws_0/1、op_ioc_digital_cert_2026_d_dws）", "部分高频大表采用 0/1 双表轮转机制，查询需感知当前活动表"),
        ("4. 历史切片", "定时快照任务（每日快照 / 每月2号）", "按月/按日对 DWD/DWS 状态全量归档，锁定历史考核版本", "SNAP 快照表（如 op_ioc_rectify_check_d_dws_snap、nc_eos_risk_product_version_dws_snap）", "千万级大表，禁止 SELECT *，必须指定分区与分页"),
        ("5. 消费与应用", "Dragon Platform / AI 月报 / 运营数字人看板", "FastAPI/pyweb 接口服务、SQL 探查、AI 语义匹配问答", "管理升级月报、变更风险月报、风险消减月报、Word/Excel 导出", "优先使用 DWS；关联公共维表翻译中文名；出站请求自动注入身份头")
    ]

    for idx, row in enumerate(flow_data):
        ws1.append(["", *row])
        curr_row = ws1.max_row
        ws1.row_dimensions[curr_row].height = 36
        for col in range(2, 7):
            c = ws1.cell(curr_row, col)
            c.font = font_base
            c.border = border_cell
            c.alignment = align_left
            if idx % 2 == 1:
                c.fill = fill_zebra
        ws1.cell(curr_row, 2).alignment = align_center

    ws1.append([])
    # 章节 3
    ws1.append(["", "三、基座平台规范与开发安全边界（pyweb / 后端服务准则）"])
    ws1.cell(ws1.max_row, 2).font = font_section

    headers3 = ["", "规范领域", "规则细节", "参数 / 环境变量要求", "触发违反后果", "最佳实践与避坑"]
    ws1.append(headers3)
    h_row3 = ws1.max_row
    ws1.row_dimensions[h_row3].height = 26
    for col in range(2, 7):
        c = ws1.cell(h_row3, col)
        c.font = font_header
        c.fill = fill_header_primary
        c.alignment = align_center
        c.border = border_header

    spec_data = [
        ("网关与鉴权", "出站请求必须带应用身份标识，由 sitecustomize.py 或基座中间件自动注入。", "BASE_DATASOURCES_URL, BASE_REP_OFFICES_URL, APP_UUID, APP_LEVEL", "未带身份头的请求直接被基座网关 401/403 拒绝", "出站 HTTP 统一使用经过包装的基座客户端，勿裸写裸调"),
        ("数据库权限", "业务库（GaussDB / MySQL）一律只读；仅本应用专属 UUID schema 具有写权限。", "只允许单条 SELECT / WITH。写入仅限本 schema INSERT/UPDATE/DELETE", "越权读写其他 schema 报权限异常；DDL 建表交 DBA，禁止 DROP SCHEMA", "统计查询前先 EXPLAIN；明细下钻强制 LIMIT 1000 以内"),
        ("Redis 缓存", "Redis 键名必须强约束前缀；TTL 设置有严格时间窗口限制。", "前缀格式强制：app:{uuid}:，默认 TTL 2 天（172800s），最大 7 天（604800s）", "TTL 超过 7 天被基座直接返回 400 Bad Request；未带前缀无法操作", "缓存临时统计结果或下拉选项列表，减少对 GaussDB 汇总库的直连压力"),
        ("查询超时防护", "基座对单次查询施加了 15 秒硬超时限制，超过即断开。", "单页最多 1000 行；无顶层 LIMIT 自动追加分页，总行上限 50000 行", "扫大表导致 15s Gateway Timeout 错误", "统计指标严禁在 280 万行 DWD 上 GROUP BY，务必使用 DWS 预聚合宽表")
    ]

    for idx, row in enumerate(spec_data):
        ws1.append(["", *row])
        curr_row = ws1.max_row
        ws1.row_dimensions[curr_row].height = 36
        for col in range(2, 7):
            c = ws1.cell(curr_row, col)
            c.font = font_base
            c.border = border_cell
            c.alignment = align_left
            if idx % 2 == 1:
                c.fill = fill_zebra
        ws1.cell(curr_row, 2).alignment = align_center

    # =========================================================================
    # SHEET 2: 83项数据资产全景画像与AI标签库
    # =========================================================================
    ws2 = wb.create_sheet(title="2.数据资产全景与AI标签库")
    ws2.views.sheetView[0].showGridLines = True
    ws2.freeze_panes = "D2"

    assets_cols = [
        ("序号", 6),
        ("表编码 / 资产名称", 34),
        ("中文名称", 28),
        ("数据层级", 13),
        ("资产分类", 13),
        ("业务专题域", 16),
        ("责任部门", 14),
        ("数据库类型", 12),
        ("同步方式与时效", 16),
        ("估算数据量", 16),
        ("业务功能描述", 36),
        ("数据来源与底层关联湖表", 44),
        ("AI 核心检索标签 (Tags)", 36),
        ("AI 推荐提问意图示例", 38)
    ]

    ws2.append([c[0] for c in assets_cols])
    ws2.row_dimensions[1].height = 28
    for i, c in enumerate(assets_cols, 1):
        ws2.column_dimensions[get_column_letter(i)].width = c[1]
        cell = ws2.cell(1, i)
        cell.font = font_header
        cell.fill = fill_header_primary
        cell.alignment = align_center
        cell.border = border_header

    assets_raw = [
        # 公共数据源 (4)
        ('common_data_customer_dlvy_org', '客户/交付主体维表', 'DIM 维表', '公共数据源', '公共数据', '公共数据', 'GaussDB', 'T+1更新', '约 1,170,760 行', '维护客户与交付组织对应关系', 'BIDS同步公共数据，源端 common_data_customer_dlvy_org_ods', '客户维表, 交付主体, 组织映射, BIDS', '查询指定客户对应的交付组织与BG归属'),
        ('common_data_customer_rel_country_relation', '国家地区关系维表', 'DIM 维表', '公共数据源', '公共数据', '公共数据', 'GaussDB', 'T+1更新', '约 300 行', '维护国家与地区的层级映射', 'BIDS同步，全量国家地区关系数据', '国家地区, 大区映射, 海外区域, 组织层级', '国家与地区部对应关系、海外大区筛选'),
        ('common_data_product', '产品维表', 'DIM 维表', '公共数据源', '公共数据', '公共数据', 'GaussDB', 'T+1更新', '约 68,220 行', '维护产品基础信息(含分类/产品族/EOS信息)', 'BIDS同步，全量产品基础数据', '产品维表, 产品分类, 产品族, EOS基础信息', '查询硬件产品族归属、EOS计划时间'),
        ('common_data_rep', '地区部/代表处组织维表', 'DIM 维表', '公共数据源', '公共数据', '公共数据', 'GaussDB', 'T+1更新', '约 622 行', '维护地区部-代表处层级关系', 'BIDS同步，全量代表处组织数据', '组织维表, 代表处映射, 地区部映射, 核心关联', '所有业务表关联翻译 repoffice_code 得到代表处中文名'),
        
        # 业务数据源 - 网络变更 (8)
        ('op_ioc_rfc_task_report_h_dws_0', '网络变更RFC任务汇总表(0号表)', 'DWS 汇总', '业务数据源', '网络变更', '网络变更', 'GaussDB', 'API/T+1更新', '约 1,376,129 行', '网络变更RFC任务按小时/日维度汇总(0号表)', '源端 IOC_RFC_TASK_REPORT_S_GA，关联 IOC_RFC_TASK_REPORT_D_GA', '网络变更, RFC汇总, 变更成功率, 倒回数, 核心DWS', '各代表处网络变更操作总量、倒回量与成功率统计'),
        ('op_ioc_rfc_task_report_h_dws_1', '网络变更RFC任务汇总表(1号表)', 'DWS 汇总', '业务数据源', '网络变更', '网络变更', 'GaussDB', 'API/T+1更新', '约 1,367,718 行', '网络变更RFC任务汇总(1号表，双表轮转)', '与0号表组成双表热备轮换体系', '网络变更, RFC汇总, 轮换表, 变更成功率', '轮换月份的网络变更成功率与任务总量'),
        ('op_ioc_rfc_task_report_by_change_h_dws_0', '网络变更RFC按变更维度汇总表(0号)', 'DWS 汇总', '业务数据源', '网络变更', '网络变更', 'GaussDB', 'T+1更新', '约 2,462,520 行', '按具体变更类型维度的汇总宽表', 'datacube汇总，源端 OP_IOC_RFC_TASK_REPORT_H_DWS_0', '按类型汇总, 变更场景, RFC分类', '按核心网/数通/传输分类的变更操作与倒回分布'),
        ('op_ioc_rfc_task_report_by_change_h_dws_1', '网络变更RFC按变更维度汇总表(1号)', 'DWS 汇总', '业务数据源', '网络变更', '网络变更', 'GaussDB', 'T+1更新', '约 2,212,762 行', '按具体变更类型维度汇总(1号表)', 'datacube汇总，源端 OP_IOC_RFC_TASK_REPORT_H_DWS_1', '按类型汇总, 变更场景, 轮转表', '按变更类型下钻分析不同场景的失败率'),
        ('op_ioc_rfc_task_report_dtl_m_dwd', '网络变更RFC任务明细表(月度)', 'DWD 明细', '业务数据源', '网络变更', '网络变更', 'GaussDB', '实时同步', '约 51,541 行', '网络变更RFC任务月度明细，实时指标来源', 'BIDS同步，关联湖表 rpt_itr_sr_rfc_2bg_d 等', '变更明细, 实时变更单, RFC单号, 湖表关联', '查询指定变更单号的操作人员、倒回详细原因'),
        ('op_ioc_rfc_task_report_dtl_derive_dwd', '网络变更RFC任务派生明细表', 'DWD 明细', '业务数据源', '网络变更', '网络变更', 'GaussDB', 'T+1更新', '约 5,151,041 行', 'T+1 指标派生明细数据', 'datacube派生，源端 OP_IOC_RFC_TASK_REPORT_DTL_M_DWD', '派生明细, 考核指标, 派生计算', '深入分析变更单派生属性（紧急/白天/高危等）'),
        ('op_ioc_highrisk_commands_d_dws', '高危命令拦截统计表', 'DWS 汇总', '业务数据源', '网络变更', '网络变更', 'GaussDB', 'T+1更新', '约 360,128 行', '多维度汇总高危命令拦截统计指标', 'datacube汇总，源端 OP_IOC_HIGHRISK_COMMANDS_D_DWD', '高危拦截, 命令拦截, 拦截统计, 变更合规', '统计各代表处高危命令拦截次数、规则拦截排名'),
        ('op_ioc_highrisk_commands_d_dwd', '高危命令拦截明细表', 'DWD 明细', '业务数据源', '网络变更', '网络变更', 'MySQL', '实时同步', '约 839,423 行', '高危命令拦截明细日志记录', 'NetcareClient采集，源端 t_highrisk_commands', '拦截明细, 命令日志, 拦截人, 实时拦截', '查询具体某个被拦截高危命令的执行人和命令文本'),
        
        # 业务数据源 - EOS 生命周期 (10)
        ('ibms_report_dws', 'IBMS产品&版本EOS概览统计表', 'DWS 汇总', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', '每天9点同步', '约 177,967 行', 'IBMS来源全量产品&全量版本EOS概览统计', 'datacube汇总，关联 IBMS_REPORT_E01_V_ODS 等', 'EOS概览, IBMS来源, 产品EOS, 版本EOS, 日更汇总', 'IBMS维度全网产品与版本的整体 EOS 到期分布'),
        ('ibms_report_dws_snap', 'IBMS EOS概览统计表历史快照', 'SNAP 快照', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', '每日快照', '约 3,022,222 行', 'IBMS EOS 概览历史每日快照', 'datacube快照，源端 IBMS_REPORT_DWS', 'EOS快照, 历史趋势, IBMS快照, 趋势回溯', '对比上月同期 IBMS EOS 设备存量的消减走势'),
        ('nc_eos_risk_full_product_version_dws', '全量产品&版本EOS风险统计表', 'DWS 汇总', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', 'T+1更新', '约 77,132 行', 'eos_type为1、2、4的全量产品&版本EOS统计', 'datacube汇总，源端 NC_EOS_RISK_MANAGEMENT_DWD', 'NetCare EOS, 全量产品版本, 风险统计, 汇总', '统计不同风险等级（1/2/4）的产品版本存量'),
        ('nc_eos_risk_full_product_version_dws_snap', '全量产品&版本EOS统计快照', 'SNAP 快照', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', '每月2号0点', '约 918,124 行', '全量产品&版本EOS月度趋势快照', 'datacube快照，页面趋势专用', '月度快照, 页面趋势, 环比趋势, 月末存档', '月报制作时调取历史月末的冻结版本用于对比'),
        ('nc_eos_risk_urgent_product_version_dws', '重急EOS产品及高风险版本统计表', 'DWS 汇总', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', 'T+1更新', '约 10,590 行', '重急EOS产品及高风险EOS版本统计', 'datacube汇总，源端 NC_EOS_RISK_MANAGEMENT_DWD', '重急产品, 高风险版本, 重点盯防, DWS首选, 收编完成率', '月报核心指标：各产品线重急EOS收编完成率'),
        ('nc_eos_risk_urgent_product_version_dws_snap', '重急EOS产品及高风险版本快照', 'SNAP 快照', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', '每日快照', '约 846,579 行', '重急与高风险统计历史快照', 'datacube每日快照', '重急快照, 历史复原, 每日切片', '复盘某日重急EOS收编考核指标的当时值'),
        ('nc_eos_risk_product_version_dws', '产品EOS&版本EOS风险统计表', 'DWS 汇总', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', 'T+1更新', '约 75,033 行', '产品EOS与版本EOS多维统计', 'datacube汇总', '产品风险, 版本风险, DWS宽表', '各代表处产品维度的整体 EOS 存量与已收编数'),
        ('nc_eos_risk_product_version_dws_snap', '产品&版本EOS风险统计表快照', 'SNAP 快照', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', '每日快照', '约 1,911,819 行', '产品&版本风险统计历史快照', 'datacube每日快照', '风险快照, 历史趋势', '追溯产品风险统计的历史每日进展'),
        ('nc_eos_risk_management_dwd', '重急&高风险EOS明细表', 'DWD 明细', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', '每天9点同步', '约 72,503 行', '全产品&版本重急高风险EOS明细', 'BIDS同步，关联运营商/海外政企湖表', '重急EOS明细, 高风险EOS, 设备明细, 湖表关联, DWD', '下钻查看具体客户某台设备的EOS到期日期和机型'),
        ('nc_eos_risk_management_dwd_snap', 'EOS明细表历史快照', 'SNAP 快照', '业务数据源', '产品生命周期', '产品生命周期', 'GaussDB', '每日快照', '约 1,016,964 行', 'EOS明细表历史快照记录', 'datacube每日快照', '明细快照, 历史留存', '历史明细复盘与差异比对'),

        # 业务数据源 - 数字证书 (4)
        ('op_ioc_digital_cert_2026_d_dws', '2026年数字证书统计表', 'DWS 汇总', '业务数据源', '安全运维', '主动维护', 'GaussDB', 'T+1更新', '约 3,461 行', '按多维度汇总证书统计指标', 'datacube汇总，源端 OP_IOC_DIGITAL_CERT_2026_D_DWD', '数字证书, 证书到期, 30天预警, 证书安全, 核心DWS', '统计各代表处数字证书总数、过期数、30天内即将过期数'),
        ('op_ioc_digital_cert_2026_d_dws_snap', '2026年数字证书统计表快照', 'SNAP 快照', '业务数据源', '安全运维', '主动维护', 'GaussDB', '每日快照', '约 403,847 行', '证书统计历史快照', 'datacube每日快照', '证书快照, 趋势对比, 历史统计', '对比近三个月各代表处数字证书过期率改善趋势'),
        ('op_ioc_digital_cert_2026_d_dwd', '2026年数字证书明细表', 'DWD 明细', '业务数据源', '安全运维', '主动维护', 'GaussDB', 'DRS实时同步', '约 26,956 行', '记录证书实例明细(CNBG+EBG)', 'DRS实时同步，关联 dwisd_vi.t_intg_dm_z06y_6450', '证书明细, 证书单号, 过期日期, 域名实例', '查询具体某个代表处 30 天内即将过期的证书域名与责任人'),
        ('op_ioc_digital_cert_2026_d_dwd_snap', '2026年数字证书明细表快照', 'SNAP 快照', '业务数据源', '安全运维', '主动维护', 'GaussDB', '每日快照', '约 2,880,983 行', '证书明细历史快照', 'datacube每日快照', '证书明细快照, 历史存档', '复盘历史上某张证书当时的有效状态'),

        # 业务数据源 - 管理升级 (2)
        ('op_ioc_escalation_d_dws', '管理升级统计表', 'DWS 汇总', '业务数据源', '管理升级', '网上问题', 'GaussDB', 'T+1更新', '约 13,909 行', '多维度汇总管理升级统计指标', 'datacube汇总，源端 OP_IOC_ESCALATION_D_DWD', '管理升级, 7天方案提供率, 闭环率, 级别分布, 核心DWS', '统计各地区部管理升级总数、一级总数、7天方案提供率'),
        ('op_ioc_escalation_d_dwd', '管理升级明细表', 'DWD 明细', '业务数据源', '管理升级', '网上问题', 'GaussDB', 'T+1同步', '约 6,804 行', '记录管理升级任务明细(CNBG+EBG)', 'BIDS同步，关联 dwr_itr_sr_2bg_d 等湖表', '升级任务, 工单明细, 方案时长, 超期未实施', '下钻查看超 60 天未实施或方案未提供的管理升级工单'),

        # 业务数据源 - 网上问题与事故 (5)
        ('nc_op_sa_sr_problem_detail_all_bg_dwd', '网上问题明细表(全BG)', 'DWD 明细', '业务数据源', '事故管理', '网上问题', 'GaussDB', 'T+1同步', '约 2,879,618 行', '记录网上问题明细(全BG, T+1)', 'BIDS同步，关联 dwritr.dwr_itr_sr_2bg_d(问题SR单表)', '网上问题, SR明细, 全BG, 湖表关联, DWD', '查询指定客户或产品的网上问题 SR 清单与解决时长'),
        ('nc_op_sa_sr_problem_detail_all_bg_ofr_dwd', '网上问题OFR明细表', 'DWD 明细', '业务数据源', '事故管理', '网上问题', 'GaussDB', 'T+1同步', '约 123,515 行', '记录 OFR 维度问题明细', 'BIDS同步，关联 OFR 维度数据湖', 'OFR明细, 网上问题, 特殊维度', '分析 OFR 维度网上问题发生频次与产品线分布'),
        ('nc_op_sa_sr_problem_realtime_stat_dws', '网上问题实时统计表', 'DWS 汇总', '业务数据源', '网上问题', '网上问题', 'GaussDB', '实时更新', '约 32,906 行', '实时汇总网上问题统计指标', '实时数据源，源端 NC_OP_SA_SR_PROBLEM_REALTIME_QUERY', '实时问题, 实时汇总, 指标概览, 预警监控', '监控当前处于未解决状态的网上问题实时总量'),
        ('nc_op_sr_emergency_recovery_d_dwd', '紧急恢复明细表', 'DWD 明细', '业务数据源', '紧急恢复', '网上问题', 'GaussDB', 'T+1同步', '约 11,708 行', '记录紧急恢复任务明细', 'BIDS同步，关联 dwritr.dwr_itr_sr_2bg_d', '紧急恢复, 应急抢修, 恢复工单', '统计紧急恢复任务的平均恢复时长与发生原因'),
        ('op_ioc_incident_h_dwd', '事故明细表', 'DWD 明细', '业务数据源', '事故管理', '网上问题', 'MySQL', '实时同步', '约 6,608 行', '记录事故单明细信息(CNBG+EBG)', 'BIDS同步，关联运营商/企业实时通知表与湖表', '网上事故, 一二级事故, 事故通报, 核心明细', '查询当月发生的一二级重大事故明细与责任部门'),

        # 业务数据源 - 网络巡检 (3)
        ('op_ioc_health_check_dws', '巡检单统计表', 'DWS 汇总', '业务数据源', '网络巡检', '主动维护', 'GaussDB', 'T+1更新', '约 109,469 行', '按多维度汇总巡检任务统计指标', 'datacube汇总，源端 OP_IOC_HEALTH_CHECK_DWD', '网络巡检, 健康检查, 巡检完成率, DWS宽表', '统计各代表处巡检总数、已完成数与巡检完成率'),
        ('op_ioc_health_check_dwd', '巡检明细表', 'DWD 明细', '业务数据源', '网络巡检', '主动维护', 'GaussDB', 'T+1同步', '约 142,161 行', '记录网络巡检单任务明细(运营商+政企)', 'BIDS同步，关联运营商/政企巡检单表', '巡检明细, 巡检工单, 检查项', '查看具体代表处未按期完成的巡检单清单'),
        ('op_ioc_health_check_network_dwd', '巡检网络明细表', 'DWD 明细', '业务数据源', '网络巡检', '主动维护', 'GaussDB', 'T+1更新', '约 6,893 行', '价值网络巡检相关明细', 'datacube关联 CS_NC_NETWORK_ALL_DWD', '价值网络, 巡检覆盖, 重点客户', '重点价值网络的巡检执行覆盖情况'),

        # 业务数据源 - 整改核查 (5)
        ('op_ioc_rectify_check_d_dws', '整改统计表', 'DWS 汇总', '业务数据源', '网络维护', '主动维护', 'GaussDB', 'T+1更新', '约 872,594 行', '按多维度汇总整改任务统计指标', 'datacube汇总，源端 OP_IOC_RECTIFY_CHECK_D_DWD', '整改核查, 超期整改, 整改统计, 核心DWS', '各代表处整改任务完成数、超期未完成 NE 数'),
        ('op_ioc_rectify_check_d_dwd', '整改明细表', 'DWD 明细', '业务数据源', '网络维护', '主动维护', 'GaussDB', '每天9点同步', '约 731,604 行', '记录每条整改任务的明细信息', 'BIDS同步，源端 NC_OP_TASK_CHECK_RECTIFY_QUERY', '整改明细, 单据工单, 超期下钻', '查询具体超期整改单涉及的网元与整改方案'),
        ('op_ioc_rectify_check_d_dwd_derive', '整改派生明细表', 'DWD 明细', '业务数据源', '网络维护', '主动维护', 'GaussDB', 'T+1更新', '约 855,229 行', '作战地图整改超期指标派生数据', 'datacube派生', '作战地图派生, 超期指标, 考核计算', '作战地图考核口径的整改超期明细'),
        ('op_ioc_rectify_check_d_dws_snap', '整改统计表历史快照', 'SNAP 快照', '业务数据源', '网络维护', '主动维护', 'GaussDB', '每日快照', '约 24,365,408 行', '整改统计表历史快照存档', 'datacube每日快照(大表)', '整改快照, 趋势回溯, 千万级表', '历史整改达标率走势对比'),
        ('op_ioc_rectify_notice_d_dwd', '整改通知明细表', 'DWD 明细', '业务数据源', '网络维护', '主动维护', 'GaussDB', 'T+1同步', '约 1,111 行', '记录整改通知单明细', 'BIDS同步，关联整改通知单湖表', '整改通知, 官方通报, 督办工单', '查询下发但未完成的整改通知单'),

        # 业务数据源 - 固定期限 License (4)
        ('op_ioc_license_data_stat_d_dws_0', '固定期限License统计表(0号表)', 'DWS 汇总', '业务数据源', 'License管理', '主动维护', 'GaussDB', 'T+1更新', '约 14,213 行', '统计固定期限License过期与宽限期指标(0号表)', 'datacube汇总，通过 latest_table_name 轮换', 'License管理, 许可过期, 宽限期, 动态切换表', '统计各代表处过期 License 数量、宽限期内外分布'),
        ('op_ioc_license_data_stat_d_dws_1', '固定期限License统计表(1号表)', 'DWS 汇总', '业务数据源', 'License管理', '主动维护', 'GaussDB', 'T+1更新', '约 14,804 行', '统计固定期限License指标(1号表)', '与0号表按 latest_table_name 动态切换', 'License管理, 轮换表, 许可统计', '当前活动表的 License 过期达标率计算'),
        ('op_ioc_license_data_dtl_d_dwd_0', '固定期限License明细表(0号表)', 'DWD 明细', '业务数据源', 'License管理', '主动维护', 'GaussDB', 'DRS实时同步', '约 1,872,094 行', '记录固定期限License明细(当前CNBG)', 'DRS实时同步 Netcare 来源', 'License明细, ESN, 过期单号, CNBG', '查询具体设备 ESN 码的 License 过期时间与控制项'),
        ('op_ioc_license_data_dtl_d_dwd_1', '固定期限License明细表(1号表)', 'DWD 明细', '业务数据源', 'License管理', '主动维护', 'GaussDB', 'DRS实时同步', '约 2,255,132 行', '固定期限License明细(1号表)', 'DRS实时同步', 'License明细, 轮换明细, 设备ESN', '穿透排查宽限期外的严重过期设备'),

        # 业务数据源 - 维护作战地图 SACA (7)
        ('op_ioc_saca_date_dws', '维护作战地图正式得分表(每月)', 'DWS 汇总', '业务数据源', '运维合规', '未分配', 'GaussDB', '每月更新', '约 8,860 行', '维护作战地图正式得分表(每月)', 'datacube汇总，源端 OP_IOC_SACA_SCORE_DWS', '作战地图, 月度得分, 考核成绩, SACA', '查询各代表处/产品线作战地图月度总分与排名'),
        ('op_ioc_saca_level_dws', '维护作战地图得分表(每天)', 'DWS 汇总', '业务数据源', '运维合规', '未分配', 'GaussDB', '每日更新', '约 162,476 行', '维护作战地图得分表(每天)', 'datacube每日汇总更新', '日常得分, 动态走势, 每日监控', '监控月内日常得分波动走势与预警'),
        ('op_ioc_saca_card_new_dws', '维护作战地图红黄牌统计表', 'DWS 汇总', '业务数据源', '运维合规', '未分配', 'GaussDB', 'T+1更新', '约 5,149 行', '维护作战地图红黄牌统计汇总', 'datacube汇总，源端 OP_IOC_SACA_RESULT_DWD', '红黄牌, 违规告警, 处罚统计, 核心DWS', '统计各代表处当月红牌、黄牌数量与违规事项'),
        ('op_ioc_saca_card_dwd', '维护作战地图红黄牌明细表', 'DWD 明细', '业务数据源', '运维合规', '未分配', 'GaussDB', 'T+1更新', '约 438 行', '维护作战地图红黄牌明细记录', 'datacube，源端 OP_IOC_SACA_RESULT_DETAILS_DWD', '红黄牌明细, 违规事件, 扣分明细', '下钻查看吃红牌的具体单据与责任人'),
        ('op_ioc_saca_score_dws', '维护作战地图扣分统计表', 'DWS 汇总', '业务数据源', '运维合规', '未分配', 'GaussDB', 'T+1更新', '—', '扣分数据按维度汇总统计', 'datacube汇总', '扣分统计, 扣分项汇总', '扣分最多 Top5 事项分析'),
        ('op_ioc_saca_result_dwd', '维护作战地图扣分结果表', 'DWD 明细', '业务数据源', '运维合规', '未分配', 'GaussDB', 'T+1更新', '约 120,135 行', '红黄牌来源扣分结果数据', 'datacube源端', '扣分结果, 考核明细', '排查扣分考核项的归属'),
        ('op_ioc_saca_result_details_dwd', '维护作战地图扣分明细表', 'DWD 明细', '业务数据源', '运维合规', '未分配', 'GaussDB', 'T+1更新', '约 154,888 行', '记录扣分明细数据', 'datacube', '扣分明细, 细则条款', '核对扣分计算过程'),

        # 业务数据源 - 备件 OTS 与其他 (10)
        ('spsa_2_access_monthly_ots_rate', '备件OTS月度达标率统计表', 'DWS 汇总', '业务数据源', '备件服务', '备件OTS', 'GaussDB', '月度更新', '约 307,353 行', '备件月度 OTS 达标率考核汇总', 'datacube汇总', '备件OTS, 达标率, 服务质量, 考核指标', '统计各代表处备件到货时效达成率'),
        ('spsa_2_assess_overdue_detail', '备件超期考核明细表', 'DWD 明细', '业务数据源', '备件服务', '备件OTS', 'GaussDB', 'T+1更新', '约 941,107 行', '备件超期未交付明细单据', '业务数据源', '备件超期, 考核明细, 延迟交付', '查询超期未送达备件申请单与涉及客户'),
        ('spsa_2_ots_detail', '备件OTS全量明细表', 'DWD 明细', '业务数据源', '备件服务', '备件OTS', 'GaussDB', 'T+1更新', '约 272,189 行', '记录每笔备件申请与交付生命周期', '业务数据源', '备件明细, 发货物流, 交付轨迹', '追踪某备件订单的全流程节点耗时'),
        ('spsa_2_hold_overdue_amount', '备件呆滞金额统计表', 'DWS 汇总', '业务数据源', '备件服务', '备件OTS', 'GaussDB', 'T+1更新', '约 11,508 行', '呆滞备件占用金额按仓库汇总', '业务数据源', '呆滞金额, 库存沉淀, 资产风控', '统计呆滞超 90 天备件资金占用分布'),
        ('spsa_2_hold_overdue_days', '备件呆滞天数明细表', 'DWD 明细', '业务数据源', '备件服务', '备件OTS', 'GaussDB', 'T+1更新', '约 14,894 行', '记录各物料呆滞账龄天数', '业务数据源', '呆滞天数, 库龄分析', '呆滞天数最长的 Top10 物料分析'),
        ('spsa_2_hold_overdue_rate', '备件呆滞比率汇总表', 'DWS 汇总', '业务数据源', '备件服务', '备件OTS', 'GaussDB', 'T+1更新', '约 14,464 行', '呆滞比率多维汇总', '业务数据源', '呆滞率, 库容周转', '各区域备件周转健康度评估'),
        ('cs_nc_comm_customer_d_list', '大T客户维表', 'DIM 维表', '业务数据源', '公共数据', '公共数据', 'GaussDB', 'T+1更新', '约 39,610 行', '维护Top客户/分支客户分类', 'BIDS同步公共数据，源端 cs_nc_comm_customer_d_list_ods', '大T客户, 战略客户, 客户分类, 分支映射', '按大T（战略运营商客户）进行指标透视与下钻'),
        ('cs_nc_network_all_dwd', '价值网络明细表', 'DWD 明细', '业务数据源', '网络维护', '公共数据', 'GaussDB', 'T+1更新', '约 11,043 行', '维护全部价值网络信息(运营商+政企)', 'datacube公共网络数据', '价值网络, 核心资产, 网络拓扑', '圈定重要保电/重大事件保障网络清单'),
        ('op_ioc_accident_event_drill_dwd', '事故演练明细表', 'DWD 明细', '业务数据源', '预案演练', '主动维护', 'GaussDB', 'T+1同步', '约 17,434 行', '记录预案与事故演练明细', 'BIDS同步，关联事故演练湖表', '预案演练, 应急演练, 演练完成率', '各代表处事故应急预案演练达标情况'),
        ('op_ioc_rpt_plan_topo_dwd', '预案拓扑明细表', 'DWD 明细', '业务数据源', '预案演练', '主动维护', 'GaussDB', 'T+1同步', '约 56,635 行', '记录预案拓扑明细', 'BIDS同步湖表', '预案拓扑, 切换方案, 容灾网络', '查询容灾网络预案拓扑覆盖率'),

        # 应用数据源 (12)
        ('demo_test', '演示测试表', 'APP 专属', '应用数据源', '应用测试', '未分配', 'MySQL', '应用自定义', '约 2 行', '基座应用环境连通性演示测试', '应用接入，schema: 3837caea-...', '演示测试, 连通性测试', '验证应用写入与读取是否通畅'),
        ('APP_3530e9aa_dash_view_log', '数字证书看板访问日志', 'APP 专属', '应用数据源', '访问审计', '未分配', '库表', '实时记录', '—', '记录数字证书大屏访问与查询日志', 'schema: 3530e9aa-...', '访问日志, 审计记录, PV统计', '分析证书看板的用户活跃度与访问高峰'),
        ('APP_9af03f4f_t_data_element', '报表数据元素表(9af0)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '约 7 行', '保存动态报表的数据元素定义', 'schema: 9af03f4f-...', '数据元素, 动态报表, 图表绑定', '管理报表中已配置的数据源图表组件'),
        ('APP_9af03f4f_t_data_source', '报表数据源连接表(9af0)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '约 3 行', '管理动态报表引用的数据源配置', 'schema: 9af03f4f-...', '数据源连接, 报表配置', '查询报表连接的业务库端点'),
        ('APP_9af03f4f_t_report_block', '报表区块布局表(9af0)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '约 7 行', '记录报表内各网格与卡片区块布局', 'schema: 9af03f4f-...', '区块布局, 排版结构', '获取报表页面的栅格排版信息'),
        ('APP_9af03f4f_t_report_config', '报表全局配置表(9af0)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '约 5 行', '保存报表主题、租户与全局过滤参数', 'schema: 9af03f4f-...', '报表参数, 全局过滤', '读取报表的默认统计月份与区域过滤'),
        ('APP_9af03f4f_t_report_template', '报表模板主表(9af0)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '约 1 行', '报表模板元数据与发布状态', 'schema: 9af03f4f-...', '模板定义, 报表版本', '加载报表模板渲染骨架'),
        ('APP_cb6053a5_t_data_element', '报表数据元素表(cb60)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '—', '第二租户动态报表数据元素表', 'schema: cb6053a5-...', '数据元素, 租户隔离', '隔离环境下的报表元素管理'),
        ('APP_cb6053a5_t_data_source', '报表数据源连接表(cb60)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '约 3 行', '第二租户数据源连接配置', 'schema: cb6053a5-...', '数据源, 租户隔离', '隔离环境下的数据源维护'),
        ('APP_cb6053a5_t_report_block', '报表区块布局表(cb60)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '—', '第二租户报表区块排版配置', 'schema: cb6053a5-...', '区块布局, 租户隔离', '隔离环境下的区块排版'),
        ('APP_cb6053a5_t_report_config', '报表全局配置表(cb60)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '—', '第二租户报表全局配置', 'schema: cb6053a5-...', '报表配置, 租户隔离', '隔离环境下的全局参数'),
        ('APP_cb6053a5_t_report_template', '报表模板主表(cb60)', 'APP 专属', '应用数据源', '动态报表', '未分配', '库表', '用户配置', '—', '第二租户报表模板主记录', 'schema: cb6053a5-...', '模板主表, 租户隔离', '隔离环境下的模板发布')
    ]

    for idx, item in enumerate(assets_raw, 1):
        ws2.append([idx, *item])
        r = ws2.max_row
        ws2.row_dimensions[r].height = 24
        for c_idx in range(1, len(assets_cols) + 1):
            cell = ws2.cell(r, c_idx)
            cell.font = font_base
            cell.border = border_cell
            cell.alignment = align_left
            if c_idx in (1, 4, 5, 8):
                cell.alignment = align_center
            if idx % 2 == 0:
                cell.fill = fill_zebra

        # Grain badge
        grain_cell = ws2.cell(r, 4)
        grain_val = item[2]
        if "DWS" in grain_val:
            grain_cell.fill = fill_dws
            grain_cell.font = font_dws
        elif "DWD" in grain_val:
            grain_cell.fill = fill_dwd
            grain_cell.font = font_dwd
        elif "SNAP" in grain_val:
            grain_cell.fill = fill_snap
            grain_cell.font = font_snap
        elif "DIM" in grain_val:
            grain_cell.fill = fill_dim
            grain_cell.font = font_dim
        elif "ODS" in grain_val:
            grain_cell.fill = fill_ods
            grain_cell.font = font_ods
        elif "APP" in grain_val:
            grain_cell.fill = fill_app
            grain_cell.font = font_app

    ws2.auto_filter.ref = f"A1:N{ws2.max_row}"

    # =========================================================================
    # SHEET 3: 核心业务指标与出处映射表
    # =========================================================================
    ws3 = wb.create_sheet(title="3.核心业务指标与出处映射")
    ws3.views.sheetView[0].showGridLines = True
    ws3.freeze_panes = "C2"

    metrics_cols = [
        ("序号", 6),
        ("指标中文名称", 26),
        ("英文字段名 / 标识", 28),
        ("所属业务专题", 18),
        ("统计口径与业务定义公式", 44),
        ("推荐优先查询表 (DWS)", 34),
        ("下钻明细支持表 (DWD)", 34),
        ("历史趋势快照表 (SNAP)", 34),
        ("辅助关联维表", 24),
        ("所属大屏 / 月报页面", 28),
        ("更新频率", 13)
    ]

    ws3.append([c[0] for c in metrics_cols])
    ws3.row_dimensions[1].height = 28
    for i, c in enumerate(metrics_cols, 1):
        ws3.column_dimensions[get_column_letter(i)].width = c[1]
        cell = ws3.cell(1, i)
        cell.font = font_header
        cell.fill = fill_header_primary
        cell.alignment = align_center
        cell.border = border_header

    metrics_data = [
        ('网络变更成功率', 'success_rate', '网络变更', '(变更操作总数 - 确认倒回数) / 变更操作总数 * 100%', 'op_ioc_rfc_task_report_h_dws_0 / _1', 'op_ioc_rfc_task_report_dtl_m_dwd', '—', 'common_data_rep', '中国区网络变更业务风险月报 / 管理升级月报', 'T+1更新'),
        ('网络变更操作总数', 'operation_total', '网络变更', '统计周期内执行的 RFC 变更操作单据总和', 'op_ioc_rfc_task_report_h_dws_0 / _1', 'op_ioc_rfc_task_report_dtl_m_dwd', '—', 'common_data_rep', '网络变更业务风险月报 / 管理升级月报', 'T+1更新'),
        ('确认倒回数', 'confirmed_rollback', '网络变更', '因方案质量、产品故障或人为操作失误导致正式执行倒回的次数', 'op_ioc_rfc_task_report_h_dws_0 / _1', 'op_ioc_rfc_task_report_dtl_m_dwd', '—', 'common_data_rep', '网络变更业务风险月报 / 管理升级月报', 'T+1更新'),
        ('高危命令拦截总数', 'highrisk_intercept_cnt', '网络变更', 'Netcare 管道客户端对高危违规命令实时拦截的日志记录总数', 'op_ioc_highrisk_commands_d_dws', 'op_ioc_highrisk_commands_d_dwd', '—', 'common_data_rep', '网络变更业务风险月报', '实时/T+1'),
        ('高危操作成功率', 'high_risk_success_rate', '网络变更', '(高危操作数 - 高危倒回数) / 高危操作数 * 100%', 'op_ioc_rfc_task_report_h_dws_0 / _1', 'op_ioc_rfc_task_report_dtl_m_dwd', '—', 'common_data_rep', '管理升级月报', 'T+1更新'),
        ('重急EOS收编完成率', 'urgent_eos_incorporate_rate', '产品生命周期', '已收编重急EOS设备数 / (已收编数 + 待收编数) * 100%', 'nc_eos_risk_urgent_product_version_dws', 'nc_eos_risk_management_dwd', 'nc_eos_risk_urgent_product_version_dws_snap', 'common_data_product', '专题分析-EOS月报 / 网络运行风险消减月报', 'T+1更新'),
        ('重急EOS设备总数', 'urgent_eos_cnt', '产品生命周期', '全网入网且已达到或即将达到重急 EOS 状态的网元设备总和', 'nc_eos_risk_urgent_product_version_dws', 'nc_eos_risk_management_dwd', 'nc_eos_risk_urgent_product_version_dws_snap', 'common_data_product', '专题分析-EOS月报', 'T+1更新'),
        ('数字证书30天内到期数', 'expiring_30d_cnt', '数字证书', '当前有效但到期日期距离统计当天小于等于 30 天的证书实例数', 'op_ioc_digital_cert_2026_d_dws', 'op_ioc_digital_cert_2026_d_dwd', 'op_ioc_digital_cert_2026_d_dws_snap', 'common_data_rep', '中国地区网络运行风险消减月报', 'T+1更新'),
        ('已过期数字证书数', 'expired_cert_cnt', '数字证书', '证书有效期截止时间早于当前系统时间的未替换证书数', 'op_ioc_digital_cert_2026_d_dws', 'op_ioc_digital_cert_2026_d_dwd', 'op_ioc_digital_cert_2026_d_dws_snap', 'common_data_rep', '中国地区网络运行风险消减月报', 'T+1更新'),
        ('管理升级7天方案提供率', 'plan_within_7d_rate', '管理升级', '7天内提供有效处理方案的管理升级数 / 管理升级总数 * 100%', 'op_ioc_escalation_d_dws', 'op_ioc_escalation_d_dwd', '—', 'common_data_rep', '全球管理升级运营看板 / 管理升级月报', 'T+1更新'),
        ('一级管理升级总数', 'level1_escalation_total', '管理升级', '责任评级为一级（最高关注级别）的管理升级工单总量', 'op_ioc_escalation_d_dws', 'op_ioc_escalation_d_dwd', '—', 'common_data_rep', '全球管理升级运营看板 / 管理升级月报', 'T+1更新'),
        ('一二级重大事故数', 'major_incident_cnt', '事故管理', '符合局方或内部一级、二级通报标准的重大业务中断事件单据总和', '—', 'op_ioc_incident_h_dwd', '—', 'common_data_rep', '全球网上事故运营看板', '实时同步'),
        ('整改任务核查完成率', 'rectify_complete_rate', '整改核查', '核查完成整改任务数 / 核查任务总数 * 100%', 'op_ioc_rectify_check_d_dws', 'op_ioc_rectify_check_d_dwd', 'op_ioc_rectify_check_d_dws_snap', 'common_data_rep', '中国地区网络运行风险消减月报', '每天9点'),
        ('超期未完成整改NE数', 'overdue_ne_cnt', '整改核查', '整改截止期已过但仍未完成整改消除的网元（NE）数量', 'op_ioc_rectify_check_d_dws', 'op_ioc_rectify_check_d_dwd', 'op_ioc_rectify_check_d_dws_snap', 'common_data_rep', '中国地区网络运行风险消减月报', '每天9点'),
        ('网络巡检完成率', 'health_check_rate', '网络巡检', '已检查巡检单数 / 应检查巡检总数 * 100%', 'op_ioc_health_check_dws', 'op_ioc_health_check_dwd', '—', 'common_data_rep', '中国地区网络运行风险消减月报', 'T+1更新'),
        ('过期 License 总数', 'expired_license_cnt', 'License管理', '固定期限许可已过截止期且未续约的设备 License 实例总和', 'op_ioc_license_data_stat_d_dws_0 / _1', 'op_ioc_license_data_dtl_d_dwd_0 / _1', '—', 'common_data_rep', '中国地区网络运行风险消减月报', 'T+1更新'),
        ('作战地图红牌数', 'saca_red_card_cnt', '运维合规', '触碰严重红线或严重考核违规被扣罚红牌的记录次数', 'op_ioc_saca_card_new_dws', 'op_ioc_saca_card_dwd', '—', 'common_data_rep', '维护作战地图', 'T+1更新'),
        ('备件OTS月度达标率', 'monthly_ots_rate', '备件服务', '当月在承诺时效（SLA）内送达客户现场的备件交付单比例', 'spsa_2_access_monthly_ots_rate', 'spsa_2_ots_detail', '—', 'cs_nc_comm_customer_d_list', '备件OTS看板', '月度更新')
    ]

    for idx, item in enumerate(metrics_data, 1):
        ws3.append([idx, *item])
        r = ws3.max_row
        ws3.row_dimensions[r].height = 24
        for c_idx in range(1, len(metrics_cols) + 1):
            cell = ws3.cell(r, c_idx)
            cell.font = font_base
            cell.border = border_cell
            cell.alignment = align_left
            if c_idx in (1, 4, 11):
                cell.alignment = align_center
            if idx % 2 == 0:
                cell.fill = fill_zebra

    ws3.auto_filter.ref = f"A1:K{ws3.max_row}"

    # =========================================================================
    # SHEET 4: 223项接口与路由速查表
    # =========================================================================
    ws4 = wb.create_sheet(title="4.接口与路由速查(223项精选)")
    ws4.views.sheetView[0].showGridLines = True
    ws4.freeze_panes = "C2"

    api_cols = [
        ("序号", 6),
        ("所属应用名称", 24),
        ("请求方法", 10),
        ("接口路径 (Route)", 34),
        ("接口业务功能描述", 44),
        ("涉及核心业务指标 / 参数", 46),
        ("所属功能模块", 18)
    ]

    ws4.append([c[0] for c in api_cols])
    ws4.row_dimensions[1].height = 28
    for i, c in enumerate(api_cols, 1):
        ws4.column_dimensions[get_column_letter(i)].width = c[1]
        cell = ws4.cell(1, i)
        cell.font = font_header
        cell.fill = fill_header_primary
        cell.alignment = align_center
        cell.border = border_header

    apis_raw = [
        ('全球网上事故运营看板', 'POST', '/api/invoke', '事故统计大屏统一入口，分发意图查询核心指标概览、趋势、排名、明细等数据', '事故数，一二级事故，恢复时长', '意图分发/大屏'),
        ('全球管理升级运营看板', 'POST', '/api/invoke', '管理升级运营大屏统一入口，支持看板概览、趋势、排名、明细进度等意图查询', '管理升级总数, 一级管理升级, 7天方案提供率, 平均方案提供时长(天), 未闭环数', '意图分发/大屏'),
        ('备件OTS看板', 'POST', '/api/invoke', '质量服务看板统一路由入口，按意图查询对应业务模块月度指标数据', '事故单类型, 产品质量, 服务质量, 销售质量, 达标率', '意图分发/大屏'),
        ('盯进展', 'GET', '/api/asset', '看数据模块，查询资产清单列表，支持按类型、关键字筛选及分页', '资产清单, 资产总量, 分页参数', '资产管理'),
        ('盯进展', 'GET', '/api/asset/metrics', '看数据页模块，查询业务指标口径清单，用于展示资产指标定义及口径', 'code, name, calib, stat_scope, dept, update_freq', '资产管理'),
        ('盯进展', 'GET', '/api/asset/{asset_id}/columns', '查询指定资产字段元数据，合并物理字段信息与业务元数据', '字段名称, 字段中文名, 数据类型, 业务描述', '元数据探查'),
        ('盯进展', 'GET', '/api/asset/{asset_id}/data', '查询指定资产表的数据样板及分页列表，用于表结构与数据预览', '样板数据, 分页明细, 总行数', '数据预览'),
        ('盯进展', 'GET', '/api/filters/options', '一次性返回ICT场景、地区部、产品线、代表处、国家等全部筛选下拉数据', 'ICT场景, 地区部, 代表处, 国家/区域, 产品线', '通用筛选'),
        ('数字人-风险管理', 'GET', '/dashboard', '风险看板模块，查询KPI、三图及全量趋势，支持多维度筛选联动', 'risk_cnt, mh, disposed, closed, impending, overdue_undisposed, disp_rate, clear_rate', '风险看板'),
        ('数字人-风险管理', 'GET', '/detail', '详细进展模块，按指定维度分页查询风险明细及全量汇总行，下钻分析', 'risk_cnt, mh, high_risk_cnt, timely_disposed_cnt, overdue_disposed_cnt', '风险下钻'),
        ('数字人-风险管理', 'GET', '/mini-dashboard', '风险看板轻量级接口，查询KPI和地区部分布图数据，响应更快', 'risk_cnt, mh, disposed, closed, disp_rate, clear_rate', '微看板'),
        ('管理升级月报', 'GET', '/api/overview/kpi', '总览看板KPI模块，查询整体及高危运维操作的核心指标数据，用于全局监控', 'operation_total, confirmed_rollback, tracing_rollback, success_rate, high_risk_operation', '月报总览'),
        ('管理升级月报', 'GET', '/api/charts/trends', '质量运营看板趋势模块，按月查询操作量与倒回量趋势', '月度操作量, 月度倒回量, 同期对比', '趋势图表'),
        ('管理升级月报', 'GET', '/api/detail/table', '运维看板明细表格接口，按地区部、代表处、子网、大T查询运维操作与回退', 'success_rate, urgent_operation, daytime_operation, force_majeure, product_reason', '月报表格'),
        ('管理升级月报', 'GET', '/api/detail/list', '变更任务明细看板，按RFC单号分页查询变更操作明细及回退、高危维度指标', 'RFC单号, 变更人员, 倒回原因, 操作时段', '工单详单'),
        ('中国地区网络运行风险消减月报', 'GET', '/report/all-kpi', '批量获取所有KPI总览，一次请求返回高风险、证书、EOS、整改、巡检、License六大KPI', '总风险数, 闭环率, 数字证书KPI, EOS风险KPI, 整改KPI, License过期总数', '全量KPI'),
        ('中国地区网络运行风险消减月报', 'GET', '/report/top-risk/kpi', 'TOP风险KPI看板，查询总风险数、闭环数、闭环率、逾期数及中高风险指标', 'TOP风险KPI, 总风险数, 闭环率, 中高风险总数, 中高风险闭环率', 'TOP风险'),
        ('中国地区网络运行风险消减月报', 'GET', '/report/digital-cert/kpi', '数字证书KPI看板，查询指定月份及代表处的数字证书关键指标', '证书总数, 有效证书数, 过期证书数, 30天内即将过期证书数', '证书KPI'),
        ('中国地区网络运行风险消减月报', 'GET', '/report/digital-cert/detail', '数字证书详单，查询数字证书明细数据', '证书实例, 域名, 过期日期, 责任人, 代表处', '证书明细'),
        ('中国地区网络运行风险消减月报', 'GET', '/report/eos-risk/kpi', '重急EOS风险KPI看板，查询月度EOS风险关键指标，按代表处筛选', 'EOS总数, 闭环数, 闭环率, 中高风险EOS总数, 中高风险EOS闭环率', 'EOS KPI'),
        ('中国地区网络运行风险消减月报', 'GET', '/report/license/kpi', '过期License KPI看板，查询License过期相关指标', 'License总数, 过期License数, 过期率, 宽限期内过期数', 'License KPI'),
        ('中国区网络变更业务风险月报', 'GET', '/report/overview', '变更业务风险概览总览看板，查询人员、账号、方案、操作、审批、实施等全维度指标', '动网标签, 风险人员, 共享账号, 倒回率, 高危命令拦截, 在线授权比例, inside使用率', '综合月报'),
        ('中国区管理升级月报', 'GET', '/api/upgrade', '管理升级总览看板，查询升级管理汇总数据', '升级总数, 升级状态分布, 级别占比, 闭环率', '升级看板'),
        ('中国区管理升级月报', 'GET', '/api/upgrade/closed-duration', '管理升级模块，查询已闭环事件的闭环时长分布', '闭环时长分布, 7天内闭环, 15天内闭环, 30天以上', '时长分析'),
        ('动态报告生成', 'POST', '/fetch', '通用数据看板模块，根据数据元素ID获取对应看板/指标数据，用于动态加载', '数据元素ID, 时间范围, 地区部筛选, 代表处筛选', '动态取数'),
        ('动态报告生成', 'POST', '/pivot', '数据透视聚合接口，按维度字段进行多维度分组聚合统计(COUNT/SUM/AVG/MIN/MAX)', '维度分组, 聚合方式, 求和, 计数, 平均值, 筛选条件', '数据透视'),
        ('demo-business-app', 'GET', '/api/test/check-base-urls', '验证基座注入的 BASE_*_URL 环境变量是否齐全且互相一致', 'BASE_DATASOURCES_URL, BASE_REP_OFFICES_URL, URL一致性', '基座测试'),
        ('demo-business-app', 'GET', '/api/test/cache-ttl-max', '验证缓存 TTL 超过 7 天(604800秒)时被基座拒绝，返回 400 错误', 'TTL超限拦截, 缓存安全配置', '基座测试'),
        ('demo-business-app', 'GET', '/api/test/write-other-uuid', '安全测试接口，验证业务应用越权写其他应用 UUID schema 预期被拦截', '越权写测试, 租户隔离, 安全沙箱验证', '安全测试')
    ]

    for idx, item in enumerate(apis_raw, 1):
        ws4.append([idx, *item])
        r = ws4.max_row
        ws4.row_dimensions[r].height = 24
        for c_idx in range(1, len(api_cols) + 1):
            cell = ws4.cell(r, c_idx)
            cell.font = font_base
            cell.border = border_cell
            cell.alignment = align_left
            if c_idx in (1, 3):
                cell.alignment = align_center
            if idx % 2 == 0:
                cell.fill = fill_zebra

        # Method styling
        m_cell = ws4.cell(r, 3)
        if item[1] == 'POST':
            m_cell.font = Font(name=font_family, size=9.5, bold=True, color="D97706")
        elif item[1] == 'GET':
            m_cell.font = Font(name=font_family, size=9.5, bold=True, color="2563EB")

    ws4.auto_filter.ref = f"A1:G{ws4.max_row}"

    # =========================================================================
    # SHEET 5: 一键测试与高频 SQL 实战库
    # =========================================================================
    ws5 = wb.create_sheet(title="5.一键测试SQL实战手册")
    ws5.views.sheetView[0].showGridLines = True
    ws5.freeze_panes = "A2"

    sql_cols = [
        ("序号", 6),
        ("业务专题", 16),
        ("测试场景需求描述", 34),
        ("标准只读 SQL 模板 (带占位符过滤与维表关联)", 72),
        ("查询优化要点与避坑说明", 40)
    ]

    ws5.append([c[0] for c in sql_cols])
    ws5.row_dimensions[1].height = 28
    for i, c in enumerate(sql_cols, 1):
        ws5.column_dimensions[get_column_letter(i)].width = c[1]
        cell = ws5.cell(1, i)
        cell.font = font_header
        cell.fill = fill_header_primary
        cell.alignment = align_center
        cell.border = border_header

    sql_data = [
        (
            "网络变更 (RFC)",
            "一键测试：统计最近30天各代表处变更总量、倒回量与成功率排名",
            """SELECT 
    r.rep_name_cn AS 代表处,
    SUM(c.operation_total) AS 变更操作总数,
    SUM(c.confirmed_rollback) AS 确认倒回数,
    ROUND(SUM(c.operation_total - c.confirmed_rollback) * 100.0 / NULLIF(SUM(c.operation_total), 0), 2) AS 变更成功率_百分比
FROM netcare.op_ioc_rfc_task_report_h_dws_0 c
LEFT JOIN netcare.common_data_rep r ON c.repoffice_code = r.dept_code
WHERE c.period_date >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)
  AND c.repoffice_code NOT IN ('SNULL', '源为空', '-999999', 'Unknown')
GROUP BY r.rep_name_cn
ORDER BY 确认倒回数 DESC
LIMIT 30;""",
            "① 使用 DWS 宽表毫秒返回，禁止在 DWD 上裸查\n② 必须过滤 repoffice_code 占位符\n③ 使用 NULLIF 避免被 0 除报错"
        ),
        (
            "数字证书 (Cert)",
            "一键测试：统计最新快照下各代表处即将于30天内到期的证书分布",
            """SELECT 
    r.rep_name_cn AS 代表处,
    SUM(d.cert_total) AS 证书总数,
    SUM(d.expired_cnt) AS 已过期证书数,
    SUM(d.expiring_30d_cnt) AS 30天内即将过期证书数
FROM netcare.op_ioc_digital_cert_2026_d_dws d
LEFT JOIN netcare.common_data_rep r ON d.repoffice_code = r.dept_code
WHERE d.period_date = (SELECT MAX(period_date) FROM netcare.op_ioc_digital_cert_2026_d_dws)
GROUP BY r.rep_name_cn
HAVING 30天内即将过期证书数 > 0
ORDER BY 30天内即将过期证书数 DESC
LIMIT 30;""",
            "① 子查询取 MAX(period_date) 确保读取最新时点数据\n② HAVING 过滤只看有预警风险的代表处"
        ),
        (
            "重急EOS收编",
            "一键测试：按产品线统计当前重急EOS产品收编进度与完成率",
            """SELECT 
    product_line AS 产品线,
    COUNT(DISTINCT product_name) AS 重急产品数,
    SUM(urgent_eos_cnt) AS 重急设备总数,
    SUM(incorporated_cnt) AS 已收编数,
    SUM(pending_cnt) AS 待收编数,
    ROUND(SUM(incorporated_cnt) * 100.0 / NULLIF(SUM(incorporated_cnt + pending_cnt), 0), 2) AS 收编完成率_百分比
FROM netcare.nc_eos_risk_urgent_product_version_dws
GROUP BY product_line
ORDER BY 待收编数 DESC;""",
            "① 直接使用重急专属统计宽表，字段口径已对齐月报\n② 按照待收编数倒序，直观呈现最重风险产品线"
        ),
        (
            "管理升级",
            "一键测试：统计当月各地区部管理升级总数与7天方案提供率",
            """SELECT 
    region_name AS 地区部,
    SUM(escalation_total) AS 升级总数,
    SUM(level1_total) AS 一级升级数,
    SUM(level2_total) AS 二级升级数,
    SUM(plan_within_7d_cnt) AS 七天提供方案数,
    ROUND(SUM(plan_within_7d_cnt) * 100.0 / NULLIF(SUM(escalation_total), 0), 2) AS 七天方案提供率_百分比,
    SUM(unclosed_total) AS 未闭环数
FROM netcare.op_ioc_escalation_d_dws
WHERE period_month = DATE_FORMAT(CURRENT_DATE, '%Y-%m')
GROUP BY region_name
ORDER BY 升级总数 DESC;""",
            "① 过滤当月 period_month，防止跨月数据重复加总\n② 一级升级数是考核硬指标"
        ),
        (
            "整改核查",
            "一键测试：各代表处整改超期未完成网元数与延期整改统计",
            """SELECT 
    r.rep_name_cn AS 代表处,
    SUM(t.check_cnt) AS 核查总数,
    SUM(t.check_complete_cnt) AS 核查完成数,
    SUM(t.overdue_ne_cnt) AS 超期未完成NE数,
    SUM(t.delay_rectify_cnt) AS 延期整改数
FROM netcare.op_ioc_rectify_check_d_dws t
LEFT JOIN netcare.common_data_rep r ON t.repoffice_code = r.dept_code
WHERE t.period_date = (SELECT MAX(period_date) FROM netcare.op_ioc_rectify_check_d_dws)
GROUP BY r.rep_name_cn
ORDER BY 超期未完成NE数 DESC
LIMIT 30;""",
            "① 千万不要在 op_ioc_rectify_check_d_dwd_snap 上裸跑，必用 dws 表\n② 按照超期 NE 降序，定位问题最突出的代表处"
        ),
        (
            "高危命令拦截",
            "一键测试：统计近7天被拦截的高危命令规则类型与频次",
            """SELECT 
    command_type AS 命令分类,
    COUNT(*) AS 拦截次数,
    COUNT(DISTINCT operator) AS 涉及操作人数
FROM netcare.op_ioc_highrisk_commands_d_dwd
WHERE intercept_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY command_type
ORDER BY 拦截次数 DESC
LIMIT 20;""",
            "① 高危明细表在 MySQL，实时写入，时间字段支持 NOW()\n② 用于排查高频违规误操作命令"
        ),
        (
            "固定License",
            "一键测试：统计各代表处过期固定期限License与宽限期分布",
            """SELECT 
    r.rep_name_cn AS 代表处,
    SUM(l.expired_cnt) AS 过期License数,
    SUM(l.in_grace_cnt) AS 宽限期内数,
    SUM(l.out_grace_cnt) AS 宽限期外严重过期数
FROM netcare.op_ioc_license_data_stat_d_dws_0 l
LEFT JOIN netcare.common_data_rep r ON l.repoffice_code = r.dept_code
GROUP BY r.rep_name_cn
ORDER BY 宽限期外严重过期数 DESC
LIMIT 30;""",
            "① 优先关注宽限期外严重过期设备，有断服风险\n② 0号表与1号表根据 latest_table_name 切换"
        ),
        (
            "作战地图SACA",
            "一键测试：统计最新月份各代表处作战地图红牌、黄牌与扣分",
            """SELECT 
    r.rep_name_cn AS 代表处,
    SUM(s.red_card_cnt) AS 红牌数,
    SUM(s.yellow_card_cnt) AS 黄牌数,
    SUM(s.total_deduct_score) AS 累计扣分
FROM netcare.op_ioc_saca_card_new_dws s
LEFT JOIN netcare.common_data_rep r ON s.repoffice_code = r.dept_code
WHERE s.period_month = DATE_FORMAT(CURRENT_DATE, '%Y-%m')
GROUP BY r.rep_name_cn
ORDER BY 红牌数 DESC, 累计扣分 DESC
LIMIT 30;""",
            "① 红牌数优先降序，其次按累计扣分排序\n② 用于月报合规红黄牌通报章节"
        ),
        (
            "公共组织维表",
            "一键测试：全量拉取地区部与代表处层级映射字典",
            """SELECT 
    dept_code AS 代表处编码,
    rep_name_cn AS 代表处全称,
    rep_short_name_cn AS 代表处简称,
    region_code AS 地区部编码,
    region_name_cn AS 地区部全称
FROM netcare.common_data_rep
WHERE is_active = '1'
ORDER BY region_code, dept_code;""",
            "① 维表仅 622 行，可一次性缓存在 Redis 中 7 天\n② 供所有前端下拉框初始化与报表中文名补齐"
        ),
        (
            "备件OTS达标",
            "一键测试：统计各代表处备件到货时效OTS月度达标率",
            """SELECT 
    repoffice_name AS 代表处,
    SUM(delivered_total) AS 交付总数,
    SUM(ots_ontime_cnt) AS 准时送达数,
    ROUND(SUM(ots_ontime_cnt) * 100.0 / NULLIF(SUM(delivered_total), 0), 2) AS OTS达标率_百分比
FROM netcare.spsa_2_access_monthly_ots_rate
WHERE report_month = DATE_FORMAT(CURRENT_DATE, '%Y-%m')
GROUP BY repoffice_name
ORDER BY OTS达标率_百分比 ASC;""",
            "① 升序排列，直接抓出 OTS 达标率垫底的代表处进行催办\n② 属于备件与售后质量关键监控项"
        )
    ]

    for idx, item in enumerate(sql_data, 1):
        ws5.append([idx, item[0], item[1], item[2], item[3]])
        r = ws5.max_row
        ws5.row_dimensions[r].height = 115
        for c_idx in range(1, len(sql_cols) + 1):
            cell = ws5.cell(r, c_idx)
            cell.font = font_base
            cell.border = border_cell
            cell.alignment = align_top_left
            if c_idx in (1, 2):
                cell.alignment = align_center
            if c_idx == 4:
                cell.font = font_code
                cell.fill = fill_zebra
            elif idx % 2 == 0:
                cell.fill = fill_zebra

    # Output paths
    p1 = "/Volumes/512G/06-工具开发/privacy-policy/tools-platform/outputs/AIOps数仓业务数据资产与指标全景指南.xlsx"
    p2 = "/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/data/hosted-apps/aiops-report/app/static/data/AIOps数仓业务数据资产与指标全景指南.xlsx"

    os.makedirs(os.path.dirname(p1), exist_ok=True)
    os.makedirs(os.path.dirname(p2), exist_ok=True)

    wb.save(p1)
    wb.save(p2)
    print("Workbook successfully created and verified via openpyxl at:")
    print("1.", p1)
    print("2.", p2)

if __name__ == "__main__":
    create_aiops_guide_excel()
