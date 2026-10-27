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

## 流程

1. 先 `netcare_tables` 找候选表：优先「已核对」、有中文名、有数据的表；同名的 dwd（明细）/ dws（汇总）/ snap（快照）按问题选粒度。
2. 用 `netcare_describe` 确认字段含义和时间字段格式，再查询；不要凭表名猜字段。
3. 统计优先在库里聚合（`metrics` + `groupBy`），不要拉大量明细自己数；明细只取回答需要的列和行。
4. 回答时说明用了哪张表、什么条件和时间范围、是全量统计还是样本；把工具返回的 SQL 摘要附上便于复核。

## 口径注意

- 估算行数来自 information_schema，不是精确值；要精确数用 `netcare_query` 的 count。
- `_0/_1`、`_01~_12` 结尾的分区族可能是轮换表或分区：先确认哪张是当前有效数据，不要把同族多张表的结果直接相加。
- 时间字段形态不一：毫秒时间戳（如 CHANGE_TIME）、`2024-06-20T00:00:00`、`2024-06-20 00:00:00`、`2024-06` 都有，过滤前先看样例。
- `SNULL`、`源为空`、`SOURCE IS NULL`、`-999999`、`Unknown` 等是占位值，统计时通常要排除并说明。
- 地区部 / 代表处字段多为编码，名称需关联 `common_data_rep` 等公共表。
- 业务库只读，不做任何写入；查不到数据时如实说明，不要把缺失当成 0。

For English requests, follow the same read-only flow and disclose sampling and definitions.
