---
name: open-autoglm
name_en: Open-AutoGLM
description: 远程控制与自动化操作 Android 手机：截取手机实时屏幕并在对话中直接展示、查询设备连接与电池状态、运行手机自动化 AI 任务，以及执行点击、滑动、输入文本、按键等 ADB 手势。
description_en: Remotely control and automate Android devices via Open-AutoGLM. Capture real-time phone screens, query devices, run mobile automation tasks, and send ADB gestures.
workspace: true
order: 22
icon: 📱
---

# 📱 Open-AutoGLM 手机自动化控制

目标：通过 Open-AutoGLM 远程控制和自动化操作 Android 手机设备。可在对话中实时截取手机屏幕并直观展示、查询手机连接状态、执行自动化 AI 任务或模拟手势交互。

## ⚠️ 智能体执行指令与工具调用铁律（务必严格遵守）

1. **用户要求截屏/查看屏幕时，必须且只能调用 `run_command` 工具执行命令**：
   ```bash
   python3 "$A" screenshot --out phone_screen.png
   ```
   命令执行成功后，**必须在你的回复中直接使用 Markdown 图片语法展示给用户**：
   ```markdown
   ![手机屏幕](phone_screen.png)
   ```
   网页前端和客户端会自动渲染展示该图片！若你需要理解画面内容辅助决策，可直接调用 `view_image` 工具查看该图片。

2. **用户要求查询设备/手机状态时，必须调用 `run_command` 执行**：
   ```bash
   python3 "$A" devices
   ```

3. **用户要求执行手机任务（如“打开微信发消息”、“刷抖音”、“打卡签到”）时，必须调用 `run_command` 执行**：
   ```bash
   python3 "$A" run "任务描述内容" --wait
   ```

4. **用户要求直接操作手机时，必须调用 `run_command` 执行相应指令**：
   - 点击屏幕：`python3 "$A" tap 500 1000`
   - 滑动屏幕：`python3 "$A" swipe 500 1600 500 600 --duration 300`
   - 输入文字：`python3 "$A" text "需要输入的文本"`
   - 物理/导航按键：`python3 "$A" key home`（支持 `home`, `back`, `enter`, `power`）
   - 执行 ADB Shell：`python3 "$A" shell "dumpsys battery"`

5. **严禁只输出命令让用户去敲**：当用户在聊天框说“查看一下当前屏幕”或“帮我操作手机”，这是对你的任务指令！严禁回复“我无法直接抓取，请在本地运行以下命令”，你必须在当前轮次立即调用 `run_command` 执行命令并返回结果与图片。

6. **严禁凭空臆造工具**：你当前**没有**名为 `open-autoglm__xxx` 的函数工具（如 `open-autoglm__get_screenshot` 不存在！）。

7. **严禁使用浏览器工具**（如 `browser_navigate` 或 `browser_evaluate`）试图去访问 API 地址。所有操作通过上面的 Python 脚本直接完成。

---

## 统一脚本入口（绝对路径，任何工作目录下均可直接调用）

```bash
A=/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/agent-skills/open-autoglm/scripts/autoglm_client.py
```

## 常用场景与 run_command 示例

| 场景 | 推荐命令 |
| --- | --- |
| 查看/截取当前屏幕 | `python3 "$A" screenshot --out phone_screen.png`（并在回复中插入 `![手机屏幕](phone_screen.png)`） |
| 列出已连接设备 | `python3 "$A" devices` |
| 运行 AI 手机自动化任务 | `python3 "$A" run "打开设置查看手机型号" --wait` |
| 查询任务执行状态与日志 | `python3 "$A" status <task_id>` |
| 终止正在运行的任务 | `python3 "$A" stop <task_id>` |
| 点击指定屏幕坐标 | `python3 "$A" tap 500 1000` |
| 滑动屏幕（从坐标1到坐标2） | `python3 "$A" swipe 500 1600 500 600 --duration 300` |
| 输入文本内容 | `python3 "$A" text "你好 AutoGLM"` |
| 返回键 / Home 键 | `python3 "$A" key back` / `python3 "$A" key home` |
| 查看手机电量/系统状态 | `python3 "$A" shell "dumpsys battery"` |

---

## 预置服务环境与凭据
- **服务地址**：`https://yutang.fanxiaolong.uk`
- **预置凭据**：内置于客户端脚本中，也可通过环境变量 `AUTOGLM_BASE_URL` 与 `AUTOGLM_API_KEY` 覆盖。
- 脚本无需安装任何第三方 pip 库，标准 Python 3 原生支持。
