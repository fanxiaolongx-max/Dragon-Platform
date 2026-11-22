---
name: 指标规则条件维护
name_en: Metric rule conditions
description: 批量修改数据导入页指标规则的条件值或加别名，改前预览命中行数，改后可回退
description_en: Batch-edit or alias data-import metric rule conditions with a match preview and rollback
workspace: false
tools: sla_rules
order: 6
icon: 🎯
---

# 指标规则条件维护 / Metric rule conditions

目标：让数据导入页的指标规则重新准确命中数据，所有修改都可预览、可追溯、可回退。

适用：数据导入页（SLA）里某些指标或子指标不高亮、取不到数，常见原因是业务名称改了（如「e&系统部」改成「etisalat系统部」），规则里的条件值没跟着改。用户要求批量改条件值、加别名，或回退之前的修改。

## 工具

- `sla_find_metric_rules`：查条件值，并按最近一次导入给出每条命中几行。`unmatched: true` 列出零命中的条件，并给出数据里没有被任何规则匹配的候选值。
- `sla_update_metric_conditions`：批量修改或加别名。每次都会弹审批卡，列出每处改动和改前、改后命中的行数，用户确认后才写入。
- `sla_list_metric_rule_changes`：查看改动记录。
- `sla_revert_metric_rule_change`：按记录回退。

工具不可用时先用 tool_search 加载 `sla_rules` 分组。只有管理员有这组工具；没有时请用户让管理员操作，或在数据导入页里手动修改。

## 别名语法

条件值写成 `[旧名]|[新名]`，任一别名命中即满足，可以写多个，如 `[e&系统部]|[etisalat系统部]`。只有整串都是「[..]|[..]」的形式才按别名处理，普通值里的竖线照原文匹配。`[空]`、`[非空]` 的含义不变，也可以放进别名列表。别名本身不能含 `[`、`]`、`|`。

名称改过时，优先加别名（`addAliases`），不要直接替换：这样历史文件和新文件都能匹配。只有用户明确要求替换时，才用 `to`。

## 步骤

1. **确认范围**：先用 `sla_find_metric_rules`。用户给了旧值就按旧值 `query`；只说"有些没高亮"就用 `unmatched: true`。把找到的位置（表、指标、子指标分类、当前值、命中行数、候选新值）简要列给用户。新值以数据里的候选值为准，不要自己猜。候选不唯一或看不出对应关系时，先问用户。
2. **提交修改**：调用 `sla_update_metric_conditions`，`replacements` 一条旧值对应一项，必要时用 `prefKeys`、`metricLabels` 缩小范围，`summary` 写一句原因。用户在审批卡上确认后才会写入。
3. **核对结果**：
   - 返回里有改后仍为 0 行，或命中行数变少的提醒时，要如实告诉用户，并给出下一步建议。
   - 告诉用户改动记录 ID。
   - 提醒用户：已打开的数据导入页面要刷新后才用新规则；不刷新就在页面上保存规则，会覆盖这次修改。
4. **回退**：用户说改错了或要撤销时，先用 `sla_list_metric_rule_changes` 找到对应记录，再调用 `sla_revert_metric_rule_change`。回退只改回那些之后没有被再改过的地方，冲突的地方要列给用户。回退本身也会生成记录，可以再回退。

## 不要做

- 不要用通用数据库工具直接改 `sla_prefs` 的 JSON。那样没有预览，也无法按处回退，还会触发整库备份。
- 只改条件值时用 `sla_update_metric_conditions`；要改条件列、取值列、类型、聚合方式、子指标，或新增 / 删除整条规则时，先 `sla_read_metric_rules` 看原规则，再用 `sla_edit_metric_rules`（同样有审批预览、改动记录和回退）。指标 ID 和预警目标不要改。
- 不要声称"已修复高亮"，除非改后命中行数大于 0。命中行数只是按最近一次导入估算，下一次导入的数据可能不同。

For English requests, follow the same steps: find, preview with match counts, apply after approval, report the change ID, and revert by change ID.
