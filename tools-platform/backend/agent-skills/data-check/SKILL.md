---
name: 数据核查
name_en: Data check
description: 只读核对表结构、口径和数据异常
description_en: Check schemas, definitions and anomalies read-only
workspace: true
order: 4
icon: 📊
---

# 数据核查 / Data check

目标：通过只读查询核对真实数据，避免错误口径和无依据结论。

1. 先明确用户关注的指标、时间范围、单位、租户与数据源；能从问题和表结构确认的内容无需重复追问。
2. 用 list_databases 找到实际数据库，再用 database_schema 查看相关表与列，最后用 read_database_table 分页读取必要列。优先当前租户实际业务库，不把同名空库当作数据源。
3. 留意空值、重复、异常范围、单位与日期差异。历史快照与当前配置分开解释，不用当前规则擅自重算历史。
4. 只读核查，不写入、修复、重算或导出全库，不尝试读取被排除的凭据。若工具不支持所需统计，说明限制；管理员可使用现有 Shell 对用户指定的业务数据做必要只读统计。
5. 区分样本与全量：结果有 nextOffset 或截断时不能宣称已检查全库。报告数据源、筛选条件、覆盖范围、发现与待确认项，避免把缺失数据当成 0。

For English requests, use the same read-only checks and disclose sampling/pagination limits.
