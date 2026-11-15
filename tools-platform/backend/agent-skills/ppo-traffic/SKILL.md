---
name: 埃及车辆违章查询
name_en: Egypt Traffic Violations
description: 查询埃及机动车交通违章（مخالفات رخص المركبات）。当用户需要查询埃及车牌违章记录、违章罚款金额（EGP）、和解金额、中国护照或埃及身份证名下车辆违章明细、或检测埃及公诉机关（PPO）服务状态时，使用此技能。全员可用，无需工作目录。
description_en: Query Egyptian vehicle traffic violations (PPO), violation fines (EGP), reconciliation amounts, violation details by Chinese passport or Egyptian national ID, and check PPO official portal service status. Available to all users.
icon: 🚗
workspace: false
tools: ppo-traffic
order: 26
---

# 🚗 埃及车辆违章查询 / Egypt Traffic Violations (PPO)

目标：对接埃及公诉机关（Public Prosecution Office）违章中枢服务，实时查询机动车交通违章记录、罚款金额（EGP）、和解金与处理状态。**全员开放使用，无需选择工作区目录，手机 App 端与 Web 端均可直接使用。**

---

## ⚠️ 智能体专属 Native 工具调用铁律（务必优先直接调用）

平台已为本技能挂载专属 Native 工具，在任何对话（普通对话、工作区、移动端）中均**直接调用原生工具**：

1. **查询车辆交通违章**（核心工具）：
   - 原生工具：`ppo_query_violations`
   - 参数说明：
     - `letters`: 车牌 2~3 个阿拉伯字母，以空格分隔（如 `"أ ف س"`、`"س ي د"`）
     - `number`: 1~8 位纯数字车牌号（如 `"3413"`）
     - `passport`: 车主中国护照号（如 `"E12345678"`，中国护照签发国代码固定为 `10206`）
     - `national_id`: 车主 14 位埃及身份证号（与 `passport` 二选一）
     - `wait`: 默认 `true`（自动排队轮询 10~25 秒直至官网返回最终明细）
   - **向用户展示规范**：
     - 必须结构化清晰呈现：车牌号码、违章笔数、总罚款金额（单位：埃及磅 EGP / جنيه）、快速和解金。
     - 若罚金为 0 或违章笔数为 0，明确告知用户「该车辆目前无未处理交通违章」。

2. **检测官方服务与中枢状态**：
   - 原生工具：`ppo_check_status`
   - 查询 PPO 官网连通性、当前排队队列长度及健康度。

3. **查询最近提交的历史记录**：
   - 原生工具：`ppo_query_history`（可选参数 `limit`: 默认 5 条）

4. **【铁律】严禁要求用户去终端自己运行命令**：
   - 收到用户的车牌和证件后，直接执行 `ppo_query_violations` 获取结果并告知用户。
   - 若用户缺少车主证件号（护照或身份证）或车牌字母不完整，礼貌追问补齐即可。

---

## 🛠️ CLI 备用脚本（具有 Shell 权限环境）

统一入口脚本：
```bash
P=/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/agent-skills/ppo-traffic/scripts/ppo_cli.py
```

| 场景 | CLI 示例 |
| --- | --- |
| 查违章（同步等待） | `python3 "$P" query --letters "أ ف س" --number 3413 --passport "E12345678" --wait` |
| 埃及公民查违章 | `python3 "$P" query --letters "أ ف س" --number 3413 --national-id "29501011234567" --wait` |
| 检测服务状态 | `python3 "$P" status` |
| 查询历史记录 | `python3 "$P" history --limit 5` |

---

## 🔍 官方异常代码与友好解释

当官网返回失败时，向用户提供清晰友好的解释：
- `LICENSE_DATA_UPDATE_REQUIRED`: 埃及交通部门提示该车辆近期没有登记数据，车主需前往所属交通检察部门（نيابة المرور）更新车辆档案。
- `IDENTITY_MISMATCH`: 车牌与提供的证件号码不匹配，请核对护照号/身份证号或车牌字母。
- `OFFICIAL_MAINTENANCE` / `OFFICIAL_AUTH_ERROR`: 埃及公诉机关违章门户正在夜间维护或服务繁忙，可建议稍后重试。
- `INVALID_PLATE_LETTERS`: 车牌字母不合法，埃及车牌仅限 17 个有效阿拉伯字母（أ, ب, ج, د, ر, س, ص, ط, ع, ف, ق, ل, م, ن, ه, و, ي）。
