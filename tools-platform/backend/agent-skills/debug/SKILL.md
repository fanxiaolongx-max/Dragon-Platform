---
name: 排查故障
name_en: Debug
description: 复现问题、定位原因、修复并验证
description_en: Reproduce, diagnose, fix and verify a bug
workspace: true
order: 2
icon: 🐞
---

# 排查故障 / Debug

目标：找到证据支持的原因，并在用户授权范围内完成最小修复及验证。

1. 明确实际行为、期望行为、触发条件；已有错误与复现信息足够时直接开始。先看工作区已有修改，保留用户的工作。
2. 查相关入口、调用链、日志和测试，用一个最小复现区分可能原因。不要因报错提到某组件就直接归咎该组件。
3. 如果用户只要求分析，止于诊断；如果要求修复，修改根因并检查相关调用方，避免扩大重构。遵守现有权限；管理员完全访问时自主推进已授权的常规操作。
4. 运行与修改直接相关的最小充分验证；测试缺失时使用可重复的临时样例。不要改真实业务数据库来通过测试。
5. 汇报原因、修改位置、实际验证结果和未验证边界。清楚区分“已修复”“推测”“需外部环境验证”，失败时继续定位，不伪造通过。

Follow the same evidence → fix → verification workflow when replying in English.
