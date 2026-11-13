---
name: open-autoglm
name_en: Open-AutoGLM
description: 远程控制与自动化操作 Android 手机：截取手机实时屏幕并在对话中直接展示、查询设备连接与电池状态、运行手机自动化 AI 任务，以及执行点击、滑动、输入文本、按键等 ADB 手势。
description_en: Remotely control and automate Android devices via Open-AutoGLM. Capture real-time phone screens, query devices, run mobile automation tasks, and send ADB gestures.
workspace: false
tools:
  - open-autoglm
order: 22
icon: 📱
---

# 📱 Open-AutoGLM 手机自动化控制

目标：通过 Open-AutoGLM 远程控制和自动化操作 Android 手机设备。可在对话中实时截取手机屏幕并直观展示、查询手机连接状态、执行自动化 AI 任务或模拟手势交互。无需选择工作空间目录，手机 App 端与 Web 端均可直接使用。

## ⚠️ 智能体原生工具调用指南（优先使用原生工具，无需终端权限）

本技能已为智能体挂载原生专属函数工具，无论用户在手机 App 端、Web 端还是桌面端，也无论是否选择了工作空间，**均直接调用原生工具**：

1. **截取/查看手机屏幕**：
   - 直接调用原生工具：`open_autoglm_get_screenshot`（可选参数 `device_id`）
   - 工具会自动将手机当前画面截取并保存，并在结果中返回 Markdown 图片引用代码。
   - **你必须在给用户的最终回复中包含该 Markdown 图片引用**，例如：`![手机当前屏幕](/Volumes/.../outputs/autoglm/phone_screen_xxx.png)`，界面和手机端会自动渲染出手机屏幕！
   - 如果需要进一步看懂屏幕中的文字内容，可接着调用 `view_image`。

2. **查询已连接的手机设备**：
   - 直接调用原生工具：`open_autoglm_list_devices`

3. **运行端到端手机端自主 AI 任务**（如“打开微信给某某发消息”）：
   - 直接调用原生工具：`open_autoglm_run_task`，参数 `task: "具体指令"`, `wait: true`

4. **模拟手机手势与按键交互**：
   - 直接调用原生工具：`open_autoglm_action`
   - 点击屏幕：`action: "tap", x: 500, y: 1000`
   - 滑动屏幕：`action: "swipe", x1: 500, y1: 1500, x2: 500, y2: 500`
   - 输入文本：`action: "text", text: "需要输入的内容"`
   - 按物理键：`action: "key", key: "home"`（或 `back`, `enter`, `power`）
   - 执行 ADB 命令：`action: "shell", command: "dumpsys battery"`

5. **【铁律】严禁向用户输出终端命令让他们自己去运行**：
   - 当用户要求查看当前屏幕或操作手机时，直接调用上述原生工具，严禁回复“我无法查看，请在本地终端运行命令”。

---

## 备用终端命令行调用（仅限具有 Shell 终端权限的环境）

如果处于终端或脚本自动化环境，也可调用统一入口脚本：
```bash
A=/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/agent-skills/open-autoglm/scripts/autoglm_client.py
```
- 查看屏幕：`python3 "$A" screenshot --out phone_screen.png`
- 查询设备：`python3 "$A" devices`
- 运行任务：`python3 "$A" run "任务内容" --wait`
