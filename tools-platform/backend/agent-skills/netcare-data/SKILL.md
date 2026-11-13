---
name: NetCare 数据
name_en: NetCare data
description: 经数字人基座查询 NetCare 业务库（只读）与本应用库（支持读写）：找表、看字段与样例、按条件统计、应用库数据管理
description_en: Query NetCare business data (read-only) and app schema (read-write) through the digital human base: find tables, inspect columns and samples, aggregate, manage app data
workspace: false
tools: netcare
order: 9
icon: 🧭
---

# NetCare 数据 / NetCare data

目标：通过数字人基座，只读查询 NetCare 业务库（netcare）并支持对本应用 schema（scope=app）进行查询与数据读写，回答指标、明细与口径问题并维护应用数据，结论以真实查询结果为准。

仅管理员可用；需要先在「全局设置 › 频道对接 › 数字人」导入配置并启用。表结构核对与人工标注在「NetCare 数据探查」页（/netcare-explorer）。

## 工具

- `netcare_tables`：按关键词 / 类别找表，返回表名、中文名、模块、粒度、估算行数、是否已核对。
- `netcare_describe`：看一张表的字段、类型、识别出的时间 / 地区部 / 代表处字段、取数提示和几行样例。
- `netcare_query`：结构化查询（字段、AND 条件、分组、聚合、排序、行数），字段名按真实表结构校验。优先用它做统计。
- `netcare_sql`：执行 SQL：业务库（scope=business）只读查询（SELECT / WITH）；应用库（scope=app）支持查询与写操作（INSERT / UPDATE / DELETE，修改/删除必须带 WHERE 条件）。业务表写 `netcare.表名`。

## 通用流程与优化策略

1. **先确认范围**：缺少时间、组织、指标或汇总/明细粒度时合并追问一次；已明确则直接查。可合理推断时先查并说明假设，例如“各代表处完成情况”默认全量代表处、最新月末快照。
2. **防超时与查询优化**（基座单次请求有 15s 超时限制）：
   - **优先汇总表**：同主题有 DWS（汇总）与 DWD（明细）时，统计分析务必优先用 DWS，避免数十万行 DWD 扫表超时。
   - **拆分复杂关联**：跨表 JOIN 容易触发超时，推荐先在主表聚合，再查公共维度表取中文映射，在回答中合并。
   - **先小后大**：新表先 LIMIT 5 确认字段格式和时间样例，再跑全量聚合。
   - **速查表跳过搜索**：遇到下方已知速查表中的主题，跳过 `netcare_tables` 搜索步骤，直接 describe 或 query。
3. **公共映射表（通用）**：
   - 代表处编码映射名称：`netcare.common_data_rep`（关联条件：业务表 `repoffice_code = common_data_rep.dept_code`，取 `rep_name_cn` 或 `rep_short_name_cn`）。
4. **口径与结果说明**：
   - 说明使用表名、过滤条件、统计日期/区间、是全量还是样本，附上 SQL 摘要便于复核。

## 数仓分层与选表原则

- **ODS（贴源层）**：未清洗原始数据，可能含脏数据与测试数据。仅用于溯源，**不要用于月报指标统计**。
- **DWD（明细层）**：标准清洗后的事实明细（单笔 RFC/SR/证书/工单）。**适合查单号、下钻明细**。查统计时务必带时间/组织过滤。
- **DWS（汇总层）**：按业务维度（年月/代表处/产品线）预聚合的指标宽表。**月报、看板、AI问答首选！** 毫秒级返回，避免超时。
- **SNAP（快照表）**：历史切片（每日/每月冻结）。**历史月报复现与月度趋势专用**，查询必须限定 `target_month` 或 `period_date`。
- **DIM（维表）**：`common_data_rep`（代表处/地区部）、`common_data_product`（产品）、`common_data_customer_rel_country_relation`（国家地区）。

## 核心业务专题速查

### 1. 整改核查（Rectify）
- **汇总（优先）**：`netcare.op_ioc_rectify_check_d_dws`（代表处×日期；check_cnt, check_complete_cnt, check_uncomplete_cnt, overdue_ne_cnt, delay_rectify_cnt）
- **明细/快照**：`netcare.op_ioc_rectify_check_d_dwd`、`_dws_snap`、`_dwd_snap`

### 2. 网络变更 RFC 与高危拦截（RFC & Change）
- **汇总（优先）**：`netcare.op_ioc_rfc_task_report_h_dws_0` / `_1`（T+1轮转；operation_total, confirmed_rollback, success_rate, high_risk_operation, high_risk_rollback, urgent_operation）
- **按变更维度**：`netcare.op_ioc_rfc_task_report_by_change_h_dws_0` / `_1`
- **高危拦截**：`netcare.op_ioc_highrisk_commands_d_dws`（拦截量/规则分布）、`_dwd`（明细）
- **月度任务明细**：`netcare.op_ioc_rfc_task_report_dtl_m_dwd`

### 3. EOS 产品与版本风险（EOS Lifecycle）
- **汇总（优先）**：`netcare.nc_eos_risk_product_version_dws`、`netcare.nc_eos_risk_urgent_product_version_dws`（eos_type 1/2/4、总量、已收编、待收编、完成率）
- **全量概览**：`netcare.ibms_report_dws`、`netcare.nc_eos_risk_full_product_version_dws`
- **明细/快照**：`netcare.nc_eos_risk_management_dwd`、`_dws_snap`、`ibms_report_dws_snap`

### 4. 数字证书（Digital Certificate）
- **汇总（优先）**：`netcare.op_ioc_digital_cert_2026_d_dws`（证书总数、有效数、过期数、30天即将到期数）
- **明细/快照**：`netcare.op_ioc_digital_cert_2026_d_dwd`、`_dws_snap`、`_dwd_snap`

### 5. 网上问题 SR 与重大事故（Problems & Incidents）
- **明细**：`netcare.nc_op_sa_sr_problem_detail_all_bg_dwd`（全BG网上问题SR明细）
- **实时统计**：`netcare.nc_op_sa_sr_problem_realtime_stat_dws`
- **事故与恢复**：`netcare.op_ioc_incident_h_dwd`（一二级事故单）、`netcare.nc_op_sr_emergency_recovery_d_dwd`

### 6. 管理升级（Escalation）
- **汇总（优先）**：`netcare.op_ioc_escalation_d_dws`（总数、一/二/三级数、7天方案提供率、平均提供天数、未提供/未闭环数）
- **明细**：`netcare.op_ioc_escalation_d_dwd`

### 7. 网络巡检与健康检查（Health Check）
- **汇总（优先）**：`netcare.op_ioc_health_check_dws`（检查总数、已检、未检、检查率）
- **明细**：`netcare.op_ioc_health_check_dwd`、`netcare.op_ioc_health_check_network_dwd`

### 8. 固定期限 License 管理（License Monitor）
- **汇总（优先）**：`netcare.op_ioc_license_data_stat_d_dws_0` / `_1`（过期总数、宽限期内外过期数、即将到期数、过期率）
- **明细**：`netcare.op_ioc_license_data_dtl_d_dwd_0` / `_1`

### 9. 维护作战地图 SACA（Battle Map & Score）
- **得分**：`netcare.op_ioc_saca_date_dws`（月）、`netcare.op_ioc_saca_level_dws`（日）
- **红黄牌/扣分**：`netcare.op_ioc_saca_card_new_dws`、`netcare.op_ioc_saca_score_dws`、`netcare.op_ioc_saca_result_details_dwd`、`netcare.op_ioc_saca_card_dwd`

### 10. 备件 OTS（Spare Parts OTS）
- **月度达标率**：`netcare.spsa_2_access_monthly_ots_rate`
- **超期与呆滞**：`netcare.spsa_2_assess_overdue_detail`、`netcare.spsa_2_ots_detail`、`netcare.spsa_2_hold_overdue_days`、`netcare.spsa_2_hold_overdue_amount`

## 提问意图匹配

按上述专题选表：回退/倒回→RFC；命令拦截→高危；重急/收编/生命周期→EOS；即将过期→先区分证书或 License；7天方案/未闭环→管理升级；SR/紧急恢复→网上问题；延期/核查→整改；预防性维护→巡检；红黄牌/扣分→SACA。
组织与国家映射用 `common_data_rep`、`common_data_customer_rel_country_relation`，大T客户分类用 `cs_nc_comm_customer_d_list`；这些维表不能代替业务指标表。

## 口径注意

- 估算行数来自 information_schema，不是精确值；要精确数用 `netcare_query` 的 count。
- `_0/_1`、`_01~_12` 结尾的分区族可能是轮换表或分区：先确认哪张是当前有效数据，不要把同族多张表的结果直接相加。
- 时间字段形态不一：毫秒时间戳（如 CHANGE_TIME）、`2024-06-20T00:00:00`、`2024-06-20 00:00:00`、`2024-06` 都有，过滤前先看样例。
- `SNULL`、`源为空`、`SOURCE IS NULL`、`-999999`、`Unknown` 等是占位值，统计时通常要排除并说明。
- 业务库只读，不做任何写入；查不到数据时如实说明，不要把缺失当成 0。

For English requests, follow the same read-only flow, ask for scope clarification if ambiguous, and disclose sampling and definitions.
