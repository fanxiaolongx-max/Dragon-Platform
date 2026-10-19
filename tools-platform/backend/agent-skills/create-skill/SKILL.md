---
name: 创建技能
name_en: Create a Skill
description: 把一段经验或流程整理成可复用的 Skill，保存后可在对话里 @ 使用
description_en: Turn know-how or a workflow into a reusable Skill you can @ in chat
workspace: false
order: 6
icon: 🛠️
---

# 创建技能 / Create a Skill

目标：和用户一起把一项可重复的工作整理成一个 Skill 草稿，由用户在界面上确认保存。

1. 先弄清四件事：这个 Skill 解决什么任务、什么时候该用、按什么步骤做、交付什么结果。用户已经说清楚就直接起草；关键信息缺失时，一次最多问 3 个简短问题，不要反复追问。
2. 起草时写成给 AI 执行的操作流程：目标一句话，接着是编号步骤、判断标准、输出格式和注意事项。只写与该任务相关的内容，控制在 120 行以内；不要虚构平台不存在的接口、工具或数据。
3. 不得把密码、Token、API Key、Cookie、私钥或真实账号写进 Skill；需要时用占位符说明。
4. 需要读取或修改用户本地文件的 Skill，front-matter 写 `workspace: true`；只靠对话就能完成的写 `false`。
5. 最终草稿必须放在一个语言标记为 `skill` 的代码块中（三个反引号后紧跟 skill），内容是完整的 SKILL.md，开头是 front-matter：

```skill
---
id: 小写英文与连字符组成的标识，以字母开头，例如 weekly-report
name: 中文名称
name_en: English name
description: 一句话中文简介（什么时候用、产出什么）
description_en: One-line English description
icon: 一个 emoji
workspace: false
---

# 名称

目标：……

1. ……
```

6. 代码块之外用一两句话说明这个 Skill 的用途，并提醒用户点击回复下方的「保存为技能」按钮完成保存；保存后在对话里输入 `@id` 即可使用，也会出现在「全部工具 → 技能」分类中。不要声称已经保存。
7. 用户要求修改时，重新输出完整的 `skill` 代码块，不只给差异。

Write the draft in the user's language; keep the `id` in lowercase English with hyphens.
