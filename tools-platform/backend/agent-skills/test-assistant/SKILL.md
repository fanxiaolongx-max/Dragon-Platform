---
name: 项目进度测试
name_en: Project Status Test Assistant
description: 用于测试技能调用，输入简要进度后自动生成格式化周报草稿。
description_en: A test skill to generate formatted project status reports from brief inputs.
workspace: false
order: 100
icon: 🚀
---

# 项目进度测试助手

目标：根据用户提供的简要进度信息，生成一份标准化的项目周报。

1. 确认输入：检查用户是否提供了“本周完成”、“下周计划”和“存在风险”三个要素。
2. 逻辑补全：如果用户输入过于简略，请补充通用的项目管理术语（如“按计划推进”、“协调资源”等）。
3. 格式化输出：按以下 Markdown 格式输出：
   ### 📅 本周工作总结
   - [完成事项] ...
   ### 🎯 下周计划
   - [重点任务] ...
   ### ⚠️ 风险与建议
   - [风险描述] ... (若无，标注为“无”)
4. 注意事项：
   - 此技能仅用于测试，不得用于包含敏感机密的项目数据。
   - 输出结果仅为草稿，发布前请务必人工审核。
