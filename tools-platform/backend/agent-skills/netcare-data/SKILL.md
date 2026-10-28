---
name: NetCare 数据
name_en: NetCare data
description: 经数字人基座只读查询 NetCare 业务库：找表、看字段与样例、按条件统计
description_en: Read-only NetCare business data through the digital human base: find tables, inspect columns and samples, aggregate
workspace: false
order: 9
icon: 🧭
---

# NetCare 数据 / NetCare data

目标：通过数字人基座，以只读方式查询 NetCare 业务库（netcare）和本应用 schema，回答指标、明细与口径问题，结论以真实查询结果为准。

仅管理员可用；需要先在「全局设置 › 频道对接 › 数字人」导入配置并启用。表结构核对与人工标注在「NetCare 数据探查」页（/netcare-explorer）。

## 工具

- `netcare_tables`：按关键词 / 类别找表，返回表名、中文名、模块、粒度、估算行数、是否已核对。
- `netcare_describe`：看一张表的字段、类型、识别出的时间 / 地区部 / 代表处字段、取数提示和几行样例。
- `netcare_query`：结构化查询（字段、AND 条件、分组、聚合、排序、行数），字段名按真实表结构校验。优先用它做统计。
- `netcare_sql`：只读 SQL（单条 SELECT / WITH），用于多表关联等结构化查询做不到的情况；业务表写 `netcare.表名`。

## 通用流程与优化策略

1. **查询前主动澄清**：若用户问题缺少必要关键信息，在执行多轮查询前先追问一次（合并问完，避免盲目搜索浪费步数）：
   - 时间范围：哪个月/季度/年？最新快照还是历史区间？
   - 组织范围：全部代表处还是特定代表处/地区部/BG？
   - 指标维度：总体完成率、超期未完成、延期整改等细分？
   - 粒度：各组织汇总统计还是明细列表？
   *注：若用户已明确给出直接查；缺失但能合理推断（如“各代表处完成情况”默认全量+最新月末快照）可先查，并在回答中说明默认假设。*
2. **防超时与查询优化**（基座单次请求有 15s 超时限制）：
   - **优先汇总表**：同主题有 DWS（汇总）与 DWD（明细）时，统计分析务必优先用 DWS，避免数十万行 DWD 扫表超时。
   - **拆分复杂关联**：跨表 JOIN 容易触发超时，推荐先在主表聚合，再查公共维度表取中文映射，在回答中合并。
   - **先小后大**：新表先 LIMIT 5 确认字段格式和时间样例，再跑全量聚合。
   - **速查表跳过搜索**：遇到下方已知速查表中的主题，跳过 `netcare_tables` 搜索步骤，直接 describe 或 query。
3. **公共映射表（通用）**：
   - 代表处编码映射名称：`netcare.common_data_rep`（关联条件：业务表 `repoffice_code = common_data_rep.dept_code`，取 `rep_name_cn` 或 `rep_short_name_cn`）。
4. **口径与结果说明**：
   - 说明使用表名、过滤条件、统计日期/区间、是全量还是样本，附上 SQL 摘要便于复核。

## 整改主题专属速查（仅限整改类查询）

- **汇总表（优先）**：`netcare.op_ioc_rectify_check_d_dws`（粒度：代表处 × 日期快照）
  - 核心字段：`repoffice_code`（代表处编码）、`check_cnt`（核查总数）、`check_complete_cnt`（核查完成数）、`check_uncomplete_cnt`（核查未完成数）、`overdue_ne_cnt`（超期未完成 NE 数）、`delay_rectify_cnt`（延期整改数）、`period_date`（统计日期，如 `YYYY-MM-DD`）。
- **明细表**：`netcare.op_ioc_rectify_check_d_dwd`（单条整改工单，记录数大，仅查具体工单明细时使用）。
- **推荐查询链路**：跳过 tables 搜索 → 直接查询 `op_ioc_rectify_check_d_dws` 按 `repoffice_code` 聚合汇总指标 → 单独查询 `common_data_rep` 获取编码到代表处中文名称映射 → 汇总生成分析表格。

## 口径注意

- 估算行数来自 information_schema，不是精确值；要精确数用 `netcare_query` 的 count。
- `_0/_1`、`_01~_12` 结尾的分区族可能是轮换表或分区：先确认哪张是当前有效数据，不要把同族多张表的结果直接相加。
- 时间字段形态不一：毫秒时间戳（如 CHANGE_TIME）、`2024-06-20T00:00:00`、`2024-06-20 00:00:00`、`2024-06` 都有，过滤前先看样例。
- `SNULL`、`源为空`、`SOURCE IS NULL`、`-999999`、`Unknown` 等是占位值，统计时通常要排除并说明。
- 业务库只读，不做任何写入；查不到数据时如实说明，不要把缺失当成 0。

For English requests, follow the same read-only flow, ask for scope clarification if ambiguous, and disclose sampling and definitions.
