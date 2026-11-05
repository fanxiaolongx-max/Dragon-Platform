# -*- coding: utf-8 -*-
"""
生成 NetCare & DataFab 数据抓取脚本与接口全景字典 Excel
"""

import os
import sqlite3
import json
import re
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def build_excel():
    output_filename = "NetCare_DataFab_数据抓取接口全景字典.xlsx"
    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # 移除默认 sheet

    font_family = "Microsoft YaHei"
    
    # 字体定义
    font_main_title = Font(name=font_family, size=16, bold=True, color="0F172A")
    font_sub_title = Font(name=font_family, size=10, italic=True, color="475569")
    font_section_title = Font(name=font_family, size=12, bold=True, color="1E3A8A")
    font_table_header = Font(name=font_family, size=10.5, bold=True, color="FFFFFF")
    font_cell = Font(name=font_family, size=9.5, color="1E293B")
    font_cell_bold = Font(name=font_family, size=9.5, bold=True, color="0F172A")
    font_code = Font(name="Consolas", size=9, color="0F172A")
    font_code_muted = Font(name="Consolas", size=8.5, color="475569")
    font_kpi_num = Font(name=font_family, size=20, bold=True, color="1E40AF")
    font_kpi_label = Font(name=font_family, size=9.5, bold=True, color="475569")
    font_kpi_sub = Font(name=font_family, size=8.5, color="64748B")
    
    # 徽标胶囊字体与填充
    tag_styles = {
        "汇总": {"fill": PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid"), "font": Font(name=font_family, size=9, bold=True, color="166534")},
        "明细": {"fill": PatternFill(start_color="DBEAFE", end_color="DBEAFE", fill_type="solid"), "font": Font(name=font_family, size=9, bold=True, color="1E40AF")},
        "交叉表": {"fill": PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid"), "font": Font(name=font_family, size=9, bold=True, color="92400E")},
        "图表": {"fill": PatternFill(start_color="F3E8FF", end_color="F3E8FF", fill_type="solid"), "font": Font(name=font_family, size=9, bold=True, color="7E22CE")},
        "预警": {"fill": PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid"), "font": Font(name=font_family, size=9, bold=True, color="991B1B")},
        "下钻": {"fill": PatternFill(start_color="E0F2FE", end_color="E0F2FE", fill_type="solid"), "font": Font(name=font_family, size=9, bold=True, color="0369A1")},
        "辅助": {"fill": PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid"), "font": Font(name=font_family, size=9, bold=True, color="475569")},
    }

    # 背景填充
    fill_header_navy = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid") # 主标题深蓝
    fill_header_sky = PatternFill(start_color="0284C7", end_color="0284C7", fill_type="solid")  # 次表头天蓝
    fill_header_teal = PatternFill(start_color="0D9488", end_color="0D9488", fill_type="solid") # DataFab绿蓝
    fill_zebra = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")        # 斑马纹
    fill_section = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")      # 小节背景
    fill_kpi_card = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")     # KPI卡片蓝背景

    # 边框定义
    border_thin_side = Side(style="thin", color="E2E8F0")
    border_cell = Border(left=border_thin_side, right=border_thin_side, top=border_thin_side, bottom=border_thin_side)
    border_header = Border(left=border_thin_side, right=border_thin_side, top=border_thin_side, bottom=Side(style="medium", color="1E3A8A"))
    border_kpi = Border(left=border_thin_side, right=border_thin_side, top=Side(style="medium", color="3B82F6"), bottom=border_thin_side)

    # 对齐
    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    align_top_left = Alignment(horizontal="left", vertical="top", wrap_text=True)
    align_right = Alignment(horizontal="right", vertical="center", wrap_text=True)

    # -------------------------------------------------------------
    # 读取数据库中的脚本
    # -------------------------------------------------------------
    db_path = 'tools-platform/backend/data/tools.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # NetCare
    cursor.execute('SELECT id, name, category, url, payload_json FROM uiv_scripts WHERE category LIKE "%NetCare%" ORDER BY category, name')
    nc_db_rows = cursor.fetchall()

    # DataFab
    cursor.execute('SELECT id, name, category, url, payload_json FROM uiv_scripts WHERE category = "DataFab" ORDER BY name')
    df_db_rows = cursor.fetchall()
    conn.close()

    # =========================================================================
    # SHEET 1: 全景概览与核心指标 (Dashboard)
    # =========================================================================
    ws1 = wb.create_sheet(title="1.全景概览与架构")
    ws1.views.sheetView[0].showGridLines = True

    ws1.column_dimensions["A"].width = 3
    ws1.column_dimensions["B"].width = 24
    ws1.column_dimensions["C"].width = 28
    ws1.column_dimensions["D"].width = 28
    ws1.column_dimensions["E"].width = 28
    ws1.column_dimensions["F"].width = 28

    # 标题区
    ws1.row_dimensions[2].height = 36
    ws1.merge_cells("B2:F2")
    c_title = ws1.cell(row=2, column=2, value="NetCare & DataFab 数据抓取脚本与接口全景字典")
    c_title.font = font_main_title
    c_title.alignment = align_left

    ws1.row_dimensions[3].height = 20
    ws1.merge_cells("B3:F3")
    c_sub = ws1.cell(row=3, column=2, value="基于 UIVF12 智能抓取调度仓库与 F12 扩展工具群，系统性盘点 42 项自动化抓取脚本与底层 API 接口矩阵")
    c_sub.font = font_sub_title
    c_sub.alignment = align_left

    # KPI 概览卡片 (Row 5 - 7)
    kpis = [
        ("42 项", "自动化抓取脚本总数", "NetCare 19 项 + DataFab 23 项", "B"),
        ("12+7 项", "NetCare 业务与扩展接口", "12 项微服务统计 + 7 项下钻/RFC工具", "C"),
        ("14 个", "DataFab 核心业务专题", "业务比对/红线资源/整改/巡检/演练等", "D"),
        ("3 核心", "DataFab 平台级 API", "getAnswers / SumData / pageView", "E"),
        ("3 大站点", "全球多地域运行环境", "中国区(CN) / 中东区(AE) / 德国区(DE)", "F")
    ]

    for num, label, sub, col in kpis:
        c1 = ws1[f"{col}5"]
        c1.value = num
        c1.font = font_kpi_num
        c1.alignment = align_center
        c1.fill = fill_kpi_card

        c2 = ws1[f"{col}6"]
        c2.value = label
        c2.font = font_kpi_label
        c2.alignment = align_center
        c2.fill = fill_kpi_card

        c3 = ws1[f"{col}7"]
        c3.value = sub
        c3.font = font_kpi_sub
        c3.alignment = align_center
        c3.fill = fill_kpi_card

        for r in range(5, 8):
            cell = ws1[f"{col}{r}"]
            cell.border = border_kpi

    ws1.row_dimensions[5].height = 30
    ws1.row_dimensions[6].height = 18
    ws1.row_dimensions[7].height = 18

    # 架构设计与鉴权机制对比
    ws1.row_dimensions[9].height = 26
    ws1.merge_cells("B9:F9")
    ws1.cell(row=9, column=2, value="平台抓取架构与设计规范概览").font = font_section_title

    headers_arch = ["对比维度", "NetCare 业务系统抓取架构", "DataFab 大数据中台抓取架构", "协同与集成应用场景", "防封控与容错机制"]
    ws1.row_dimensions[10].height = 26
    for col_idx, h in enumerate(headers_arch, start=2):
        cell = ws1.cell(row=10, column=col_idx, value=h)
        cell.font = font_table_header
        cell.fill = fill_header_navy
        cell.alignment = align_center
        cell.border = border_header

    arch_rows = [
        ("服务域名", "https://netcare.huawei.com (中国)\nhttps://netcare-ae.gts.huawei.com (中东)\nhttps://netcare-de.gts.huawei.com (德国)", "https://datafab-pro.gtsdata.huawei.com\n(DataFab 大数据智能决策中台)", "两套系统分别承担【业务事实单据】与【大数据预聚合看板】的数据源供给", "跨站点自动化切换与代理路由"),
        ("接口设计风格", "微服务化业务专用接口\n按主题拆分为独立的统计(/progress_statistics)与详单(/get_list)接口", "模型驱动与组件化统一入口\n95%以上的抓取均由通用接口(/getAnswers)承载，靠组件 ID 区分", "NetCare 适合穿透抓取底表明细，DataFab 适合抓取各组织预计算比率", "接口超时默认 15s 保护，大查询拆分执行"),
        ("认证与安全头", "Header: x-gde-csrf-token (从 localStorage 获取)\nCookie: Session 会话保持，需登录态", "Header: x-xsrf-token, tenantId, project-id\nSession-Affinity-Key: 关联看板 BoardId", "前端 F12 浮窗通过脚本自动嗅探会话中的 Token，无感知注入", "捕获 9999 会话过期并自动告警，提醒刷新登录态"),
        ("数据清洗与结构", "返回 JSON 标准 data 结构，多维数组或行列表对象，需按字段映射清洗", "返回含 totalsData, sumData, columns, rows 的复杂嵌套结构，含公式度量", "仓库脚本内置 extractRows 与 smartValue 解析器，平铺为平面表", "对返回数据签名校验，自动识别并丢弃空行与占位符"),
        ("月报/看板联动", "主要提供 SR、变更、事故、整改、证书、EOS 真实单据事实明细", "主要提供日志回传率、操作资质积分、高危拦截、巡检覆盖率等 KPI", "AI 智能月报与 Dragon Claw 数字人优先读取 DataFab 比率，下钻关联 NetCare 详表", "每日/每月定时切片，自动沉淀历史快照表")
    ]

    for row_idx, r_data in enumerate(arch_rows, start=11):
        ws1.row_dimensions[row_idx].height = 42
        for col_idx, val in enumerate(r_data, start=2):
            cell = ws1.cell(row=row_idx, column=col_idx, value=val)
            cell.font = font_cell_bold if col_idx == 2 else font_cell
            cell.alignment = align_top_left
            cell.border = border_cell
            if row_idx % 2 == 1:
                cell.fill = fill_zebra

    # =========================================================================
    # SHEET 2: NetCare 抓取接口清单 (NetCare APIs)
    # =========================================================================
    ws2 = wb.create_sheet(title="2.NetCare抓取接口清单")
    ws2.views.sheetView[0].showGridLines = True

    ws2.column_dimensions["A"].width = 3
    ws2.column_dimensions["B"].width = 6    # 序号
    ws2.column_dimensions["C"].width = 16   # 业务专题
    ws2.column_dimensions["D"].width = 32   # 脚本名称
    ws2.column_dimensions["E"].width = 14   # 站点/地域
    ws2.column_dimensions["F"].width = 10   # 类型
    ws2.column_dimensions["G"].width = 8    # HTTP方法
    ws2.column_dimensions["H"].width = 50   # 接口完整路径 (Endpoint)
    ws2.column_dimensions["I"].width = 34   # 核心请求参数 (Payload)
    ws2.column_dimensions["J"].width = 36   # 抓取的核心业务指标 / 字段
    ws2.column_dimensions["K"].width = 18   # 脚本唯一 ID

    # 标题
    ws2.row_dimensions[2].height = 32
    ws2.merge_cells("B2:K2")
    ws2.cell(row=2, column=2, value="NetCare 自动化抓取接口与脚本全量矩阵 (19项核心抓取 + 7项扩展接口)").font = font_main_title

    ws2.row_dimensions[3].height = 20
    ws2.merge_cells("B3:K3")
    ws2.cell(row=3, column=2, value="涵盖中国区、德国区与中东区 NetCare 业务系统的微服务统计接口与详单接口，已支持数字人及 PBI 自动化流水线").font = font_sub_title

    # 板块 A: 仓库 19 个核心抓取脚本
    ws2.row_dimensions[5].height = 24
    ws2.merge_cells("B5:K5")
    ws2.cell(row=5, column=2, value="【板块 A】UIVF12 仓库核心抓取脚本与微服务 API (19 项)").font = font_section_title

    headers_nc = ["序号", "业务专题", "抓取脚本名称", "运行站点", "类型", "方法", "接口路径 (API Endpoint)", "核心请求过滤参数 (Payload)", "抓取的指标 / 字段", "脚本唯一 ID"]
    ws2.row_dimensions[6].height = 26
    for col_idx, h in enumerate(headers_nc, start=2):
        cell = ws2.cell(row=6, column=col_idx, value=h)
        cell.font = font_table_header
        cell.fill = fill_header_navy
        cell.alignment = align_center
        cell.border = border_header

    # 预置净化的 NetCare 抓取详细数据
    nc_items = [
        ("数字证书", "PBI_自动抓取-数字证书", "NetCare中国", "汇总", "POST", 
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_digital_cert_detail_statistics",
         "region_code, office_code, bg=CNBG, duetime_year, t1_operator", 
         "有效证书数、过期证书数、30天即将过期数、整改中/闭环证书总数", "script_ymcpehp4e"),
        
        ("设备能源", "PBI_自动抓取-锂电池", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_lithium_battery_detail_statistics",
         "bg=CNBG, region_code, office_code, country_code=EG, network_id",
         "基站/机房锂电池总数、运行异常数、高危告警电池量、健康度等级", "script_8bvw1yltv"),

        ("产品EOS", "PBI_自动抓取-产品EOS风险", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_product_version_eos_progress_statistics",
         "annual_baseline=2026, data_type=product_eos, bg=CNBG, region_code, office_code",
         "全量硬件产品 EOS 总量、已收编/待收编产品数、收编进展完成率", "script_4u0maeg30"),

        ("版本EOS", "PBI_自动抓取-版本EOS风险", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_product_version_eos_progress_statistics",
         "annual_baseline=2026, data_type=version_eos, bg=CNBG, region_code, office_code",
         "各产品软件版本 EOS 存量、高风险版本数、版本升级与替代收编率", "script_3oltwotly"),

        ("重急EOS", "PBI_自动抓取-重急EOS风险", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_product_version_eos_progress_statistics",
         "annual_baseline=2026, eos_type in (1,2,4), bg=CNBG, region_code, office_code",
         "重急高风险 EOS 存量、重点局点设备清单、生命周期延期与收编进展", "script_cin7rgp5n"),

        ("重急EOS", "PBI_自动抓取-重急EOS收编", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_urgent_product_version_eos_progress_statistics",
         "bg=CNBG, region_code, office_code, country_code=EG, annual_baseline",
         "重急产品版本专项收编进度、代表处目标完成率、月度收编推进量", "script_377d81535"),

        ("重急EOS", "PBI_自动抓取-重疾软件EOS", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_urgent_product_version_eos_progress_statistics",
         "bg=CNBG, region_code, office_code, country_code=EG, product_line",
         "重大缺陷软件版本（重疾EOS）分布、局点数量、整改升级进度", "script_7cc14185a"),

        ("网上问题SR", "PBI_自动抓取-SRFRT-CN", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_sr_problem_detail_progress_statistics",
         "bg=CNBG, region_code, office_code, country_code, start_date, end_date",
         "SR 网上问题处理进展、首次响应时长(FRT)达标率、问题闭环率", "script_tvfxkazh8"),

        ("网上问题SR", "PBI_自动抓取-详单-SR-CN", "NetCare中国", "明细", "POST",
         "/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_sr_problem_detail_get_list",
         "metric=sr_total, start_date, end_date, country_code=EG, region_code",
         "SR单号、故障级别、产品线、客户名称、恢复时长、责任人、根因分类", "script_8fd1191c3"),

        ("网上问题SR", "PBI_自动抓取-详单-SR-ME (Dragon Claw定制版)", "NetCare中东", "明细", "POST",
         "/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_sr_problem_detail_get_list",
         "metric=sr_total, start_date, end_date, country_code=EG, region_code",
         "中东海外局点 SR 网上问题工单明细、双语工单摘要、SLA 超期判定", "script_079734ec73dd"),

        ("网络事故", "PBI_自动抓取-事故-CN", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_incident_progress_statistics",
         "bg=CNBG, region_code, office_code, country_code=EG, sr_type=true",
         "网络一二级事故与重大故障单量、定级情况、恢复时效、责任分类", "script_bqt8t967s"),

        ("整改核查", "PBI_自动抓取-路由器整改", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_rectify_check_detail_progress_statistics",
         "product_line=data_communication, region_code, office_code, network_id",
         "路由器与数通设备整改总数、完成数、未完成数、超期未完成 NE 节点数", "script_a0dzr8ie5"),

        ("整改核查", "PBI_自动抓取-数据存储整改", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_rectify_check_detail_progress_statistics",
         "product_line=data_storage, region_code, office_code, network_id",
         "IT与数据存储设备隐患整改数、方案实施率、延期整改单据统计", "script_4zg0kcvvx"),

        ("软件MM", "PBI_自动抓取-软件MM收编/停退", "NetCare中国", "汇总", "POST",
         "/adc-service/web/rest/v1/services////NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_mm_stat",
         "region_code, office_code, country_code=EG, product_line",
         "软件版本维护里程碑(Maintenance Milestone)收编、停服、退市台账", "script_vn1axhibv"),

        ("运维风险", "PBI_自动抓取-风险详单-CN", "NetCare中国", "明细", "POST",
         "/adc-service/web/rest/v1/services/NetCareRiskManageService/risk_management/risk_task_getList",
         "risk_status in (Complete Reviewing;Risk Suspended;Risk Confirming;Risk Open), limit=50",
         "风险单号、风险等级(高/重/中)、当前处理人、处置方案、消减计划", "script_ds33dq14e"),

        ("运维风险", "PBI_自动抓取-风险详单-DE", "NetCare德国", "明细", "POST",
         "/adc-service/web/rest/v1/services/NetCareRiskManageService/risk_management/risk_task_getList",
         "risk_status in (Complete Reviewing;Risk Suspended;Risk Confirming;Risk Open), limit=50",
         "欧洲及德国区域网络风险任务明细、合规审计状态、风险闭环跟踪", "script_1vl4b6ub2"),

        ("预案保障", "PBI_自动抓取-CPT风险详表-CN", "NetCare中国", "明细", "POST",
         "/adc-service/web/rest/v1/legacy/services/common_risk_assurance_task_getList",
         "page_type=all, get_total=true, limit=50, start=0, task_status",
         "CPT 重大事件保障预案任务、演练计划、防控措施实施状态详表", "script_c7z3mheey"),

        ("预案保障", "PBI_自动抓取-CPT风险详表-DE", "NetCare德国", "明细", "POST",
         "/adc-service/web/rest/v1/legacy/services/common_risk_assurance_task_getList",
         "page_type=all, get_total=true, limit=50, start=0, task_status",
         "海外德国代表处 CPT 协同保障任务清单、客户网络保障预案执行状态", "script_ujrn2g139"),

        ("预警冒泡", "PBI_自动抓取-详单预警冒泡_026902-CN", "NetCare中国", "预警", "POST",
         "/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_alarm_metric_detail",
         "rule_id=warning.expiration.overdue.hole..., metric=total_cnt, bg=CNBG",
         "L1/L2 安全漏洞超期传达预警单据、责任人、网元设备、超期天数", "script_97c856e2d")
    ]

    for idx, item in enumerate(nc_items, start=1):
        r_num = 6 + idx
        ws2.row_dimensions[r_num].height = 24
        cat, name, site, kind, method, endpoint, params, metrics, s_id = item
        row_vals = [idx, cat, name, site, kind, method, endpoint, params, metrics, s_id]
        
        for c_idx, val in enumerate(row_vals, start=2):
            cell = ws2.cell(row=r_num, column=c_idx, value=val)
            cell.font = font_code if c_idx in (7, 10) else font_cell
            cell.alignment = align_center if c_idx in (2, 4, 5, 6, 7) else align_left
            cell.border = border_cell
            if idx % 2 == 0:
                cell.fill = fill_zebra
            
            # 胶囊颜色高亮
            if c_idx == 6 and kind in tag_styles:
                cell.fill = tag_styles[kind]["fill"]
                cell.font = tag_styles[kind]["font"]

    # 板块 B: 辅助与扩展工具调用的 NetCare 接口
    start_b = 6 + len(nc_items) + 2
    ws2.row_dimensions[start_b].height = 24
    ws2.merge_cells(f"B{start_b}:K{start_b}")
    ws2.cell(row=start_b, column=2, value="【板块 B】F12 浮窗与扩展工具辅助 NetCare 接口 (7 项)").font = font_section_title

    h_b_row = start_b + 1
    ws2.row_dimensions[h_b_row].height = 26
    headers_b = ["序号", "工具归属", "功能定位", "运行环境 / 来源文件", "类型", "方法", "接口完整路径 (API Endpoint)", "核心入参 / 过滤维度", "业务功能描述", "工具模块标识"]
    for col_idx, h in enumerate(headers_b, start=2):
        cell = ws2.cell(row=h_b_row, column=col_idx, value=h)
        cell.font = font_table_header
        cell.fill = fill_header_sky
        cell.alignment = align_center
        cell.border = border_header

    nc_helper_items = [
        ("NetCare专题分析", "数字证书L3穿透", "netcare-analysis.js (F12浮窗内联)", "下钻", "POST",
         "/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_digital_certificate_l3_grid_get_list",
         "version=2026, metric=need_reduce_cnt, reduction_scenario=2, group_by",
         "证书按代表处、客户、网元层级穿透的三级网格列表，支撑前端即时下钻审计", "uivf12-cert-l3"),

        ("NetCare专题分析", "EOS资产实例穿透", "netcare-analysis.js (F12浮窗内联)", "下钻", "POST",
         "/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_eos_detail_get_list",
         "bordType=new_urgency_eos, data_type=urgency_eos, limit=100, exclusion_recordal",
         "按产品族、局点、合同穿透的 EOS 设备级资产清单，支持 Top-N 排序与核收方案排期", "uivf12-eos-detail"),

        ("NetCare专题分析", "网络变更RFC全景", "netcare-analysis.js (F12浮窗内联)", "汇总", "POST",
         "/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_change_summary",
         "region_code, office_code, start_date, end_date, bu_list, product_lines",
         "网络变更总操作量、成功率、紧急变更量、回退操作量、高危操作分类趋势统计", "uivf12-change-summary"),

        ("NetCare专题分析", "高危命令拦截趋势", "netcare-analysis.js (F12浮窗内联)", "图表", "POST",
         "/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_change_highrisk_commands_charts_statistics",
         "region_code, office_code, country_code, start_date, end_date",
         "事中高危操作拦截命令类型分布、时段分布、违规拦截趋势图表数据", "uivf12-highrisk-stat"),

        ("NetCare专题分析", "网上问题SR全貌", "netcare-analysis.js (F12浮窗内联)", "汇总", "POST",
         "/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_sr_problem_overview_statistics",
         "region_code, office_code, start_date, end_date, sr_types, product_lines",
         "SR 网上问题处理总揽指标：Minor/Major/Critical 严重级别分布、解决平均天数", "uivf12-sr-overview"),

        ("RFC方案与AI审计", "变更手册信息提取", "netcare-rfc-word.js (浏览器控制台/扩展)", "辅助", "GET",
         "/alm/ows/getManualInfo?id={order}&from=undefined",
         "id: RFC变更工单号/方案单号, Header注入 X-CSRF-TOKEN",
         "提取 RFC 实施方案的完整结构、章节配置、操作步骤与附件关联清单", "rfc-word-manual"),

        ("RFC方案与AI审计", "发布工具状态轮询", "netcare-rfc-word.js (浏览器控制台/扩展)", "辅助", "GET",
         "/ows/getPublishToolStatus?toolId={toolId}&orderId={order}",
         "toolId, orderId, 状态检查请求",
         "异步轮询 RFC 自动化方案在线打包与发布状态，驱动前端生成 Word/Excel 审计材料", "rfc-word-publish")
    ]

    for idx, item in enumerate(nc_helper_items, start=1):
        r_num = h_b_row + idx
        ws2.row_dimensions[r_num].height = 24
        cat, name, site, kind, method, endpoint, params, metrics, s_id = item
        row_vals = [idx, cat, name, site, kind, method, endpoint, params, metrics, s_id]
        
        for c_idx, val in enumerate(row_vals, start=2):
            cell = ws2.cell(row=r_num, column=c_idx, value=val)
            cell.font = font_code if c_idx in (7, 10) else font_cell
            cell.alignment = align_center if c_idx in (2, 4, 5, 6, 7) else align_left
            cell.border = border_cell
            if idx % 2 == 0:
                cell.fill = fill_zebra
            if c_idx == 6 and kind in tag_styles:
                cell.fill = tag_styles[kind]["fill"]
                cell.font = tag_styles[kind]["font"]

    # =========================================================================
    # SHEET 3: DataFab 抓取接口与脚本清单 (DataFab Scripts & APIs)
    # =========================================================================
    ws3 = wb.create_sheet(title="3.DataFab抓取脚本与接口")
    ws3.views.sheetView[0].showGridLines = True

    ws3.column_dimensions["A"].width = 3
    ws3.column_dimensions["B"].width = 6    # 序号
    ws3.column_dimensions["C"].width = 24   # 业务看板/专题
    ws3.column_dimensions["D"].width = 34   # 脚本名称
    ws3.column_dimensions["E"].width = 12   # 图表组件类型
    ws3.column_dimensions["F"].width = 30   # 组件唯一 ID (componentId)
    ws3.column_dimensions["G"].width = 32   # 过滤维度字段 (params)
    ws3.column_dimensions["H"].width = 40   # 核心度量 / 公式指标 (measures)
    ws3.column_dimensions["I"].width = 36   # 业务功能与数据用途
    ws3.column_dimensions["J"].width = 18   # 脚本唯一 ID

    # 标题
    ws3.row_dimensions[2].height = 32
    ws3.merge_cells("B2:J2")
    ws3.cell(row=2, column=2, value="DataFab 大数据中台自动化抓取接口与脚本全量矩阵 (23项业务脚本)").font = font_main_title

    ws3.row_dimensions[3].height = 20
    ws3.merge_cells("B3:J3")
    ws3.cell(row=3, column=2, value="覆盖 14 大核心业务看板，通过 DataFab 中台统一服务模型获取跨产品线、多维度的运维预聚合指标与详单数据").font = font_sub_title

    # 板块 A: 3 大底层接口规范
    ws3.row_dimensions[5].height = 24
    ws3.merge_cells("B5:J5")
    ws3.cell(row=5, column=2, value="【板块 A】DataFab 3 大平台级底层核心 API 规范").font = font_section_title

    headers_df_a = ["序号", "API 接口名称", "HTTP方法", "接口完整路径 (API Endpoint)", "入参核心结构", "响应数据结构", "业务功能与使用场景", "安全与鉴权配置", "调用频率与并发策略"]
    ws3.row_dimensions[6].height = 26
    for col_idx, h in enumerate(headers_df_a, start=2):
        cell = ws3.cell(row=6, column=col_idx, value=h)
        cell.font = font_table_header
        cell.fill = fill_header_teal
        cell.alignment = align_center
        cell.border = border_header

    df_apis_spec = [
        ("统一报表与问答数据接口", "POST", "/DataFabKernelCn/v1/answer/getAnswers",
         "boardId, pageId, answerParamList: [{ id, componentId, chartType, maxRows, pageNum, pageSize, params: [ { table, column, values } ] }]",
         "data: [ { data: [...] } ], totalsData: { columns: {...} }, sumData, 包含行数组与预聚合公式度量",
         "仓库 23 个 DataFab 脚本的核心查询入口，统一按组件 ID 和过滤条件获取图表渲染数据集",
         "Header: x-xsrf-token, tenantId, project-id, SESSION-AFFINITY-KEY",
         "支持分页遍历（可达5000页），内置数据指纹防死循环与重复拉取"),
        
        ("汇总与公式聚合计算接口", "POST", "/DataFabKernelCn/v1/answer/getValueTableSumData",
         "id, srcTenantId, boardId, params, chartType='table', answerSource=2, aggFields: [ { columnName, aggType: 'formula' } ]",
         "sumData: { columns: { '度量名称': { formula: '值', average: '值' } } }",
         "针对交叉表或自定义指标公式（如业务比对加权回传率、同比），精确获取服务端公式计算的总计行",
         "同 getAnswers，复用相同 Board 会话与 Tenant 凭据",
         "当 getAnswers totalsData 未携带公式计算值时触发自动回退调用"),

        ("看板浏览埋点与状态初始化", "POST", "/DataFabKernelCn/v1/board/pageView",
         "boardId, tenantId, behavior='VIEW', pageId, requestTime",
         "status: 200, message: 'success'",
         "看板切换与页面初始化埋点，激活大数据中台服务端缓存与会话上下文",
         "Header: x-xsrf-token, tenantId",
         "在批量抓取启动前按需握手调用，保障后续 getAnswers 缓存命中率")
    ]

    for idx, item in enumerate(df_apis_spec, start=1):
        r_num = 6 + idx
        ws3.row_dimensions[r_num].height = 36
        name, method, endpoint, req, resp, desc, auth, perf = item
        row_vals = [idx, name, method, endpoint, req, resp, desc, auth, perf]
        for c_idx, val in enumerate(row_vals, start=2):
            cell = ws3.cell(row=r_num, column=c_idx, value=val)
            cell.font = font_code if c_idx in (4, 5) else font_cell
            cell.alignment = align_center if c_idx in (2, 3) else align_top_left
            cell.border = border_cell
            if idx % 2 == 0:
                cell.fill = fill_zebra

    # 板块 B: 23 个业务主题抓取脚本详细清单
    start_df_b = 6 + len(df_apis_spec) + 2
    ws3.row_dimensions[start_df_b].height = 24
    ws3.merge_cells(f"B{start_df_b}:J{start_df_b}")
    ws3.cell(row=start_df_b, column=2, value="【板块 B】DataFab 23 项业务抓取脚本详细清单 (14 大核心业务主题)").font = font_section_title

    h_df_b_row = start_df_b + 1
    ws3.row_dimensions[h_df_b_row].height = 26
    headers_df_b = ["序号", "业务主题 (Board/Page)", "抓取脚本名称", "图表组件类型", "组件唯一 ID (componentId)", "过滤维度字段 (Params Filter)", "核心度量 / 公式指标 (Measures)", "业务功能与数据用途", "脚本唯一 ID"]
    for col_idx, h in enumerate(headers_df_b, start=2):
        cell = ws3.cell(row=h_df_b_row, column=col_idx, value=h)
        cell.font = font_table_header
        cell.fill = fill_header_navy
        cell.alignment = align_center
        cell.border = border_header

    df_script_items = [
        ("业务比对看板", "PBI_自动抓取_17_CN_业务比对报告看板_CO", "交叉表", "component_674ad386lwa9ca1d_qa",
         "region_name_cn, rep_name_cn, operate_level, planstart_month_fm, planstart_year_fm, country",
         "需回传操作量, 业务比对日志回传完成量, 日志回传率, 备案量, 备案率; 光/无线/数通/云核各产品线需回传/已回传/回传率",
         "抓取月度各代表处、各产品线变更操作的日志回传完成率与备案指标，支撑月报核心 KPI", "script_d86d2057c"),

        ("业务比对看板", "PBI_自动抓取-业务比对明细_17_CN_业务比对报告看板_CO", "明细", "component_e345fflwaa3r7k_qa",
         "operate_level, planstart_year_fm, planstart_month_fm, region_name_cn, rep_name_cn, country",
         "操作单号, 操作名称, 操作人, 产品线, 操作等级(High/Fatal), 回传状态, 未回传原因, 备案状态",
         "抓取单笔变更操作的比对与回传详单，支持下钻穿透排查未回传责任人与漏报单据", "script_bdae4ba28"),

        ("维护红线资源", "PBI_自动抓取_维护红线资源", "汇总", "component_2fb1b19lj2icvcl_qa",
         "region_name, repoffice_name, country_name, region_flag",
         "红线资源配置总量、持证上岗人数、专职维护人员覆盖率、跨区维护合规数",
         "监控关键客户与价值局点网络维护红线资源的人员配备与合规达标状态", "script_3f4ae5174"),

        ("维护红线资源", "PBI_自动抓取-任职匹配度_维护红线资源", "明细", "component_fb914d1lj3zlyua_qa",
         "region_name, repoffice_name, country_name, region_flag",
         "工号, 姓名, 代表处, 维护网元类型, 实际任职资格级别, 岗位要求级别, 匹配度差异(达标/欠缺)",
         "核查一线维护人员的技术任职资格与所维护网络复杂度的匹配矩阵", "script_f5797d6f2"),

        ("维护红线资源", "PBI_自动抓取-红线人员工单统计_维护红线资源", "明细", "component_406c4770mfg7zlzs_qa",
         "region_name, repoffice_name, start_date, end_date",
         "红线人员工号, 姓名, 月度派单总量, 变更操作单数, 违规操作拦截量, 超期工单数",
         "统计红线受限人员或关键岗位人员的工单负荷与操作安全性", "script_91dcc2b29"),

        ("维护红线资源", "PBI_自动抓取-明细红线_维护红线资源", "明细", "component_d895767lj3zn9cl_qa",
         "region_flag, region_name, repoffice_name, network_level",
         "局点代码, 客户名称, 关键网络等级, 责任专家, 备份专家, 红线资源授权状态",
         "输出全量维护红线资源资产底账明细，供合规审计与现场检查使用", "script_653dd1766"),

        ("整改管理", "PBI_自动抓取_整改", "汇总", "component_52b824e5lwugpwa8_qa",
         "region_cn_name, repoffice_cn_name, region_flag, task_status",
         "整改任务总数, 已完成整改数, 未完成整改数, 整改完成率, 逾期未闭环任务数",
         "网络隐患与配置漏洞整改专项推进全景统计，评估代表处整改达标进度", "script_49799ec1c"),

        ("整改管理", "PBI_自动抓取-整改详单_整改", "明细", "component_8b44096llq68y0r_qa",
         "region_cn_name, repoffice_cn_name, region_flag, task_status",
         "整改工单号, 任务标题, 责任代表处, 网元设备, 隐患级别, 计划闭环日期, 实际进展状态",
         "整改任务事实明细表，用于穿透跟踪未完成整改项并进行责任催办", "script_288372730"),

        ("价值网络巡检", "PBI_自动抓取_价值网络巡检", "汇总", "component_94e0842ludjpj2i_qa",
         "region_cn_name, repoffice_cn_name, network_category",
         "价值网络总数, 周期内应巡检数, 已完成巡检数, 巡检完成率, 发现隐患项总数",
         "运营商及政企高价值核心网、骨干网预防性健康检查任务整体完成率监控", "script_11ad43bb1"),

        ("价值网络巡检", "PBI_自动抓取-巡检详单_价值网络巡检", "明细", "component_9ed07888b49_qa",
         "region_cn_name, repoffice_cn_name, inspect_status",
         "巡检报告单号, 网络名称, 设备类型, 巡检执行人, 巡检日期, 发现问题级别, 报告审核状态",
         "单台网元与客户网络巡检明细清单，供客户交付月度健康度报告核实", "script_863188ff4"),

        ("图形化拦截", "PBI_自动抓取_图形化拦截_CN", "交叉表", "component_a36391dmnilrbx7_qa",
         "region_name_cn_mp, rep_name_cn_mp, country, interception_year_fm, interception_month_fm",
         "图形化高危命令拦截总量, 误拦截量, 拦截准确率, 月度环比增幅, 年度同比变化率",
         "多维分析高危操作防线中图形化拦截的拦截量分布与同比趋势", "script_c017eb503"),

        ("图形化拦截", "PBI_自动抓取-详单_图形化拦截_CN", "明细", "component_5e7c85bm7lqdj3l_qa",
         "rep_name_cn_mp, interception_year_fm, interception_month_fm",
         "拦截单号, 触发账号, 目标设备IP, 拦截规则名称, 命中的高危命令串, 拦截时刻, 处置结果",
         "图形化拦截单据事实明细，用于违规命令复盘与工程师安全操作赋能", "script_73ea1710c"),

        ("逃生演练", "PBI_自动抓取_逃生演练", "汇总", "component_192fcb9cmmac2x5d_qa",
         "sub_region_name_cn, rep_office_name_cn, region_flag, cpc",
         "重点局点(CPC)总数, 计划演练局点数, 已实施逃生演练数, 演练达标率, 演练发现缺陷数",
         "评估局点网络灾备逃生预案有效性，保障极端故障场景下的业务自愈能力", "script_43ad8f0fd"),

        ("逃生演练", "PBI_自动抓取-详单_逃生演练", "明细", "component_068dd38mmac2x5d_qa",
         "region_flag, cpc, sub_region_name_cn, rep_office_name_cn",
         "演练项目编号, 演练场景(倒换/双归/断电), 涉及网元, 演练执行时间, 业务恢复耗时, 评审结论",
         "网络逃生演练项目详单，供合规检查与演练真实性溯源对账", "script_2d3aa064e"),

        ("漏洞预警", "PBI_自动抓取_漏洞预警", "汇总", "component_13fea7d3m88k66wa_qa",
         "region_cn_name, repoffice_cn_name, task_status, create_time, priority_type, region_flag",
         "通报漏洞总数, 重急高危漏洞数, 处置中漏洞数, 已消除漏洞数, 漏洞按期消减率",
         "网络安全与产品漏洞预警整体全景，把控全网漏洞暴露面与消减进度", "script_51ea36960"),

        ("漏洞预警", "PBI_自动抓取-详单漏洞_漏洞预警", "明细", "component_dca39f0liwlar8y_qa",
         "task_status, create_time, priority_type, region_flag, region_cn_name, repoffice_cn_name",
         "漏洞CVE编号, 预警通报名称, 涉及产品及版本, 受影响网元量, 补丁/整改方案状态, 闭环截止期",
         "安全漏洞详单明细，指导现场工程师精准打补丁或升级版本", "script_835e93ea9"),

        ("操作资质积分", "PBI_自动抓取_15_CN_事前：操作资质积分_CO", "明细", "component_54d36dc3lu6dyvcl_qa",
         "date_total, region_name_cn, rep_name_cn, operator_name",
         "操作人员工号, 姓名, 所属组织, 现存积分, 奖励加分项, 违规扣分项, 资质有效状态",
         "事前防线核心抓手：监控一线操作人员的资质积分健康度，低于阈值触发操作熔断", "script_f0ca6e45f"),

        ("事中人员管理", "PBI_自动抓取_ADMS_事中：高危命令拦截人员管理", "明细", "component_a59c926mnid8rx9_qa",
         "region_name_cn_mp, rep_office, month_en, country_area_name_cn_mp, year_fm",
         "违规人员工号, 姓名, 责任代表处, 当月拦截次数, 拦截高危命令类型, 补授权处理状态",
         "ADMS 事中管控看板：识别频繁触发高危拦截的高风险人员，开展定向培训或权限管控", "script_145eeea60"),

        ("延期操作补授权", "PBI_自动抓取_延期操作补授权监控", "明细", "component_749c3990lz3x7s33_qa",
         "complete_year_fm, region_name_cn_mp, rep_name_cn_mp, display_others_fm",
         "变更方案号, 变更负责人, 原定割接窗口, 实际操作时间, 延期申请时间, 补授权审批人, 闭环状态",
         "监控夜间割接延期操作的审批合规性，严控未经审批私自延期操作造成的重大事故风险", "script_40b1bda7c"),

        ("产品TOPN风险", "PBI_自动抓取_产品TOPN风险", "明细", "component_9b0ac6clwuhummd_qa",
         "sub_region_name_cn, rep_office_name_cn, region_flag, cpc",
         "TOPN高风险产品型号, 现网运行网元数, 涉及局点等级, 潜在风险特征(硬件故障/软件缺陷), 应对举措",
         "聚焦存量网络中失效率高、停产停服的重点 TOP-N 风险硬件产品与替换方案推进", "script_9852a118a"),

        ("应急演练", "PBI_自动抓取_应急演练", "明细", "component_7090cecemanmfs6g_qa",
         "service_product_flag, key_network, region_flag, cpc, risk_status",
         "应急预案编号, 演练网络名称, 服务产品线, 演练时间, 模拟故障类型, 协同部门响应速度, 演练结论",
         "重大保障前夕的突发故障应急协同响应演练统计与明细台账", "script_045478895"),

        ("日志稽查率", "PBI_自动抓取_日志稽查率CN", "图表", "component_1598c96fm2y3x1w5_qa",
         "region_name_cn_mp, rep_name_cn_mp, country, year_fm, month_fm, display_others_fm",
         "使用账号总数, 已稽查账号数, 未稽查账号数, 账号稽查率, 稽查发现违规账号数",
         "月度折线柱状混合图表：统计网络设备登录账号的审计覆盖率，确保无漏审计账号", "script_9e2ae3881"),

        ("预案拓扑", "PBI_自动抓取_预案拓扑", "明细", "component_921234blwuhebkm_qa",
         "region_cn_name, repoffice_cn_name, service_product_flag",
         "网络拓扑图编号, 关联代表处, 核心链路归属, 预案绑定状态, 拓扑自动化校验结论",
         "校验网络运维预案与现网实际拓扑图的一致性，防止因拓扑不准导致恢复方案失效", "script_362a448e0")
    ]

    for idx, item in enumerate(df_script_items, start=1):
        r_num = h_df_b_row + idx
        ws3.row_dimensions[r_num].height = 24
        cat, name, kind, comp_id, params, metrics, desc, s_id = item
        row_vals = [idx, cat, name, kind, comp_id, params, metrics, desc, s_id]
        
        for c_idx, val in enumerate(row_vals, start=2):
            cell = ws3.cell(row=r_num, column=c_idx, value=val)
            cell.font = font_code if c_idx in (6, 10) else font_cell
            cell.alignment = align_center if c_idx in (2, 4, 5) else align_left
            cell.border = border_cell
            if idx % 2 == 0:
                cell.fill = fill_zebra
            if c_idx == 5 and kind in tag_styles:
                cell.fill = tag_styles[kind]["fill"]
                cell.font = tag_styles[kind]["font"]

    # =========================================================================
    # SHEET 4: 参数字典与数仓口径映射 (Params & Warehouse Mapping)
    # =========================================================================
    ws4 = wb.create_sheet(title="4.参数字典与数仓映射")
    ws4.views.sheetView[0].showGridLines = True

    ws4.column_dimensions["A"].width = 3
    ws4.column_dimensions["B"].width = 18   # 参数编码
    ws4.column_dimensions["C"].width = 24   # 中文名称 / 业务含义
    ws4.column_dimensions["D"].width = 16   # 适用系统
    ws4.column_dimensions["E"].width = 36   # 典型枚举值 / 取值示例
    ws4.column_dimensions["F"].width = 38   # 数仓映射表 / 关联维表口径说明

    # 标题
    ws4.row_dimensions[2].height = 32
    ws4.merge_cells("B2:F2")
    ws4.cell(row=2, column=2, value="接口常用请求参数字典与底层数仓映射对照").font = font_main_title

    ws4.row_dimensions[3].height = 20
    ws4.merge_cells("B3:F3")
    ws4.cell(row=3, column=2, value="指导将抓取脚本的接口入参映射至底层 GaussDB / MySQL 维度字典，保障跨表分析与 AI 查询口径一致").font = font_sub_title

    headers_dict = ["参数编码 / 字段", "中文名称 / 业务含义", "适用系统", "典型枚举值 / 格式示例", "数仓关联维表 / 统计口径说明"]
    ws4.row_dimensions[5].height = 26
    for col_idx, h in enumerate(headers_dict, start=2):
        cell = ws4.cell(row=5, column=col_idx, value=h)
        cell.font = font_table_header
        cell.fill = fill_header_navy
        cell.alignment = align_center
        cell.border = border_header

    dict_items = [
        ("region_code / region_name_cn", "地区部编码 / 名称", "NetCare & DataFab", 
         "026902, 606666, '北部非洲地区部', '欧洲地区部', '中东地区部'", 
         "关联维表: common_data_rep. 业务表 repoffice_code 关联 common_data_rep.dept_code 取 rep_name_cn"),
        
        ("office_code / rep_name_cn", "代表处编码 / 名称", "NetCare & DataFab", 
         "026921, 2686, '埃及代表处', '沙特代表处', '德国代表处'", 
         "各业务汇总表首选分组维度，月报指标优先按代表处聚合展示"),
        
        ("country_code / country", "国家二字码 / 国家名称", "NetCare & DataFab", 
         "'EG', 'SA', 'DE', 'Egypt', 'Saudi Arabia'", 
         "关联维表: common_data_customer_rel_country_relation. 用于海外多国代表处的数据细分"),
        
        ("bg", "业务集团 (Business Group)", "NetCare", 
         "'CNBG' (运营商), 'EBG' (政企), 'CNBG,EBG'", 
         "统计通常区分运营商与政企客户网络，未指定时默认含全量 BG"),
        
        ("product_line / product_line_map", "产品线编码 / 产品线名称", "NetCare & DataFab", 
         "'data_communication' (数通), 'data_storage' (存储), 'wireless' (无线), 'cloud_core_network' (云核), 'optical_business' (光)", 
         "关联维表: common_data_product. DataFab 需注意统计比率时常需识别并选择性剔除 ICT 服务"),
        
        ("operate_level", "操作高危等级", "DataFab", 
         "'High' (高危), 'Fatal' (致命), 'Medium' (中危)", 
         "用于高危拦截看板与业务比对过滤，严控重大风险操作窗口"),
        
        ("planstart_year_fm / planstart_month_fm", "计划执行年月 (两位补零)", "DataFab", 
         "year: '2026', month: '01', '05', '10'", 
         "DataFab 组件的时间过滤标准格式，月份必须通过 padStart(2, '0') 格式化"),
        
        ("annual_baseline / eos_year", "EOS 考核基准年份", "NetCare", 
         "'2026', '2025'", 
         "产品与版本生命周期考核基线，决定是否纳入当期收编考核范围"),
        
        ("data_type / bordType", "EOS 统计口径分类", "NetCare", 
         "'product_eos' (硬件产品), 'version_eos' (软件版本), 'urgency_eos' (重急EOS)", 
         "区分汇总表统计粒度，决定底层调用的预计算模型与明细抽取规则"),
        
        ("metric", "指标度量标识", "NetCare & DataFab", 
         "'sr_total', 'total_cnt', 'need_reduce_cnt', 'before_urgent_incorporation_completion_rate'", 
         "定义接口返回的具体度量列，详单接口传参决定下钻过滤条件"),
        
        ("risk_status", "风险闭环状态", "NetCare", 
         "'Complete Reviewing;Risk Suspended;Risk Confirming;Risk Open'", 
         "分号分隔的多选枚举值，涵盖评审中、挂起、确认中与开启态风险单据"),
        
        ("componentId", "DataFab 组件唯一标识", "DataFab", 
         "'component_674ad386lwa9ca1d_qa', 'component_e345fflwaa3r7k_qa'", 
         "核心路由参数：大数据平台用于索引特定图表组件的模型定义与数据提取 SQL")
    ]

    for idx, item in enumerate(dict_items, start=1):
        r_num = 5 + idx
        ws4.row_dimensions[r_num].height = 24
        p_code, p_name, sys, enum_v, desc = item
        row_vals = [p_code, p_name, sys, enum_v, desc]
        for c_idx, val in enumerate(row_vals, start=2):
            cell = ws4.cell(row=r_num, column=c_idx, value=val)
            cell.font = font_code if c_idx == 2 else font_cell
            cell.alignment = align_center if c_idx in (3, 4) else align_left
            cell.border = border_cell
            if idx % 2 == 0:
                cell.fill = fill_zebra

    # 保存工作簿
    wb.save(output_filename)
    print(f"Excel workbook successfully built: {os.path.abspath(output_filename)}")

if __name__ == '__main__':
    build_excel()
