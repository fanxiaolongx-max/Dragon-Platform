---
name: 代码审查
name_en: Code review
description: 检查真实缺陷、回归风险与遗漏
description_en: Review concrete bugs, regressions and missing checks
workspace: true
order: 3
---

# 代码审查 / Code review

目标：发现可触发、可解释的真实缺陷，默认只读，不自动修改或提交。

1. 先确认审查范围。优先读取 git status、目标 diff，再读相关完整函数和调用方。没有 diff 时检查用户指定模块；不要擅自选远程分支作基准。
2. 重点检查权限与租户边界、异步竞态、异常/取消处理、状态恢复、数据兼容、平台差异和已有行为回归。
3. 每项发现写清触发场景、后果、源码位置与可行修复方向，按严重程度排序。只列可从代码或测试说明的缺陷，不把纯风格偏好当作 bug。
4. 必要时运行聚焦测试或临时复现；不得为审查修改真实业务数据或执行发布。输出实际验证范围。
5. 未发现问题时明确说明，并指出检查范围和剩余验证空白，不声称代码绝无问题。

For English responses, present concrete findings first, followed by validation limits.
