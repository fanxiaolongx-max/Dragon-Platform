---
name: 家庭财务记账助手
name_en: Family Finance Bookkeeper
description: 连接 WISE 家庭财务系统 (https://wise.fanxiaolong.uk/family_finance) 记支出、收入、转账，查余额、流水和财务概况。用户想记账、查余额、看明细或财务概况时使用。
description_en: Connect to WISE Family Finance system to record expenses, income, transfers, and query balances, transactions and summary.
icon: 💰
order: 25
---

# 💰 WISE 家庭财务记账助手

目标：连接 WISE 家庭财务管理系统，直接记账、转账、查流水、查余额和财务概况。

## 🔐 密钥与安全规范
- 服务地址：`https://wise.fanxiaolong.uk`
- 本机安全存储：密钥保存在本机 `~/.config/wise-finance/api_key`（权限 0600，只有本机当前用户可读），也可通过环境变量 `WISE_API_KEY` 注入。
- **绝不在聊天回复、日志或临时文件中打印输出明文密钥。**
- 辅助脚本 `quick_record.py` 会自动读取本地凭据，推荐优先使用脚本执行。

---

## 🛠️ CLI 常用入口（推荐）

统一入口脚本路径（任何工作目录下均可直接调用）：
```bash
W=/Volumes/512G/06-工具开发/privacy-policy/tools-platform/backend/agent-skills/family-finance-bookkeeper/scripts/quick_record.py
```

| 操作需求 | CLI 命令 |
| --- | --- |
| 查所有账户余额 | `python3 "$W" --accounts` |
| 查财务总览（净资产、本月收支结余） | `python3 "$W" --summary` |
| 查最近流水明细 | `python3 "$W" --transactions 20` |
| 查某个账户的流水 | `python3 "$W" --transactions 20 微信` |
| 记一笔支出 | `python3 "$W" 微信 35 餐饮 麻辣烫` |
| 记一笔收入 | `python3 "$W" --income 招商银行 8000 工资 11月薪水` |
| 账户间转账 | `python3 "$W" --transfer 招商银行 微信 1000 生活费转账` |
| 撤销/删除流水 | `python3 "$W" --delete 123` |

---

## 🌐 HTTP 接口直接调用

如需用 `curl` 发送定制请求，通过本地安全文件获取 Key，避免硬编码：
```bash
API_KEY=$(cat ~/.config/wise-finance/api_key 2>/dev/null || echo "$WISE_API_KEY")
```

### 1. 记账（支出 / 收入）
`POST https://wise.fanxiaolong.uk/api/finance/transactions`
- Headers: `Authorization: Bearer $API_KEY`, `Content-Type: application/json; charset=utf-8`
- Body:
  - `type`："支出" 或 "收入"
  - `account`（必填）：账户名（如 微信、招商银行、现金、CIB、N26、支付宝）或 `account_id`
  - `amount`（必填）：正数金额（系统按 type 自动处理正负）
  - `category`（可选）：支出（餐饮/交通/购物/居住/娱乐/医疗/旅游/其他）；收入（工资/理财/兼职/奖金/其他）
  - `description`（可选）：备注或商户
  - `tx_date`（可选）：`YYYY-MM-DD`，默认当天

### 2. 账户转账
`POST https://wise.fanxiaolong.uk/api/finance/transactions`
- Body: `{"type": "转账", "from_account": "招商银行", "to_account": "微信", "amount": 1000, "description": "备用金", "tx_date": "2026-11-13"}`

### 3. 查账户列表
`GET https://wise.fanxiaolong.uk/api/finance/accounts`
- 返回数组：`[{id, name, balance, currency, owner}]`

### 4. 查流水
`GET https://wise.fanxiaolong.uk/api/finance/transactions?limit=20&account=微信`

### 5. 财务概况
`GET https://wise.fanxiaolong.uk/api/finance/summary`
- 返回：今日支出、本月收入/支出/结余/储蓄率、净资产、各账户余额等。

### 6. 删除/撤销流水
`DELETE https://wise.fanxiaolong.uk/api/finance/transactions/{id}`
- 删除后金额会自动回退到原账户余额。删除前请与用户确认流水 ID。

### 7. 新建账户
`POST https://wise.fanxiaolong.uk/api/finance/accounts`
- Body: `{"name": "美元现金", "currency": "USD", "balance": 0, "owner": "我"}`

---

## 💬 对话交互规范
1. 用户没说明具体日期时，默认使用当天；“昨天”、“大前天”等相对时间按用户时区换算成 `YYYY-MM-DD`。
2. 遇到知名商户或场景自动推断分类：例如“星巴克、瑞幸、麦当劳”归入“餐饮”，“滴滴、打车、高铁”归入“交通”。
3. 记账或转账成功后，清晰告知用户记账详情及受影响账户的**最新余额**，例如：
   > “已为您记下：【微信】支出 35.00 元（餐饮 · 麻辣烫），微信当前最新余额为 3,639.00 元。”
4. 当用户提及的账户名与账本不完全一致时，先调 `python3 "$W" --accounts` 查询可用账户列表再做对齐确认。
