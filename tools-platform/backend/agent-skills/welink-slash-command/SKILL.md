---
name: WeLink 斜杠命令
name_en: WeLink slash commands
description: 管理、生成、注册、调试和发布 WeLink 客户端斜杠命令（基于 assistant-command-executor / ace）
description_en: Manage, scaffold, register, debug and publish WeLink client slash commands with assistant-command-executor (ace)
workspace: false
tools: welink-office
order: 9
icon: ⚡
---

# WeLink 斜杠命令 / WeLink slash commands

目标：使用 WeLink 官方斜杠命令框架（`assistant-command-executor`，简称 `ace`）在 WeLink 客户端聊天窗口中快速注册、管理、发布和调试 `/` 斜杠命令，为用户本人或群聊成员提供一键打开平台、唤起 We 码或本地 Python 自动化消息回调能力。

---

## 核心机制：它是给谁用的？

在 WeLink 中注册斜杠命令时，使用者范围取决于**命令入口（Scopes）**与**命令类型（Type）**：

1. **入口范围（Scopes）**：
   - `1 = IM单聊`：只有单聊（私聊、传输助手）聊天框输入 `/` 时才可见。
   - `2 = IM群聊`：群聊聊天框输入 `/` 时可见。
   - `1,2 = 单聊与群聊`：单聊与群聊均可见。

2. **使用者是自己还是群里所有人？**
   - **Type 1（直接打开网页 / We码）——群内所有人独立可用**：
     - 若配置了群聊入口，群内**任何成员**在群里输入 `/command` 或从 `/` 菜单选中，其自己的 WeLink 客户端会**直接在本地弹出配置的目标网页或 We 码**。
     - 该类型完全由客户端处理跳转，**不依赖开发者本地常驻进程**，所有人均可独立点击打开。
   - **Type 3（本地 Python 命令，处理消息并回复）——群内所有人可用，但由你本机提供服务**：
     - 若配置了群聊入口，群内**任何成员**在群里输入 `/command 查数据` 时，消息会由 WeLink 网关通过长连接下发到**你本机运行的 `ace serve` 进程**（回调 `async def handle(ctx)`）。
     - 你本地代码处理完毕后，通过 `ctx.send_text("...")` 将结果发回群里，**群内所有成员都能看到回复**。
     - **服务依赖性**：因为逻辑运行在你电脑的 Python 进程中，**如果你电脑上的 `ace serve` 离线，群里其他人触发命令就会显示未响应或超时**。你本机相当于该群命令的微服务 Backend。
   - **个人高频快捷入口（单聊）**：
     - 在「WeLink 传输助手」或单聊窗口中配置命令，是你个人的高效工作流入口，输入 `/dragonclaw` 可一键唤出龙爪平台或触发本地个人脚本。

> **网关生效时效说明**：发布或更新命令后，WeLink 网关大约需要 **5 ~ 10 分钟** 刷新缓存，生效后客户端重新键入 `/` 即可看到最新候选菜单。

---

## 前置环境要求

运行与调试斜杠命令工具需要在 Windows 工作站具备以下环境：
1. **操作系统**：Windows 10 / 11（WeLink PC 客户端保持登录并在线）。
2. **Python**：Python 3.11 及以上版本（需支持 `asyncio`、`websockets>=12.0`、`aioconsole>=0.8.2`）。
3. **Node.js & welink-cli**：全局安装 `welink-cli` 且已完成扫码登录。
4. **ace 框架代码**：`assistant_command_executor` 代码仓库（通常位于 `C:\Users\<user>\workspace\assistant_command_executor`）。
   - 安装依赖：`pip install -e . -i https://mirrors.tools.huawei.com/pypi/simple`

---

## 命令类型规范与选择

| 类型代码 | 类型名称 | 典型场景 | 是否需本地进程常驻 | 交互效果 |
|---|---|---|---|---|
| **1** | 直接打开网页 / We码 | 龙爪平台一键直达、报表看版、知识库跳转 | 否（一次性注册） | 客户端弹出内嵌浏览器或系统浏览器直接加载目标 URL |
| **2** | 聊天中返回网页卡片 | 发送特定分享卡片、带缩略图与按钮的富卡片 | 否 | 在当前对话流中直接插入富媒体卡片 |
| **3** | 本地 Python 命令 | 自动化查数据、执行 Python 脚本、调本地 AI 回复 | **是**（需运行 `ace serve`） | 接收用户传入的参数，在本地处理后 `ctx.send_text` 回复聊天 |

---

## 命令代码规范与脚手架结构

在 `assistant_command_executor` 根目录下，命令存放在 `commands/<name>_command/` 文件夹中：

```
assistant_command_executor/
├── commands/
│   └── dragonclaw_command/
│       ├── __init__.py
│       └── command.py
├── gateway.json
└── pyproject.toml
```

### Type 1（直接打开网页）标准 `command.py` 模版：

```python
"""
WeLink 斜杠命令: dragonclaw
类型: 1 (直接打开网页)
入口: 1, 2 (单聊与群聊)
"""

# 命令元数据配置
CONFIG = {
    "name": "dragonclaw",
    "chinese_name": "龙爪平台",
    "description": "龙爪自动化工具平台快捷入口",
    "description_en": "Dragon Claw Platform",
    "command_type": 1,          # 1: 打开网页
    "scopes": ["user", "group"], # 1: IM单聊, 2: IM群聊
    "url": "http://127.0.0.1:5200"  # 目标网页 URL
}
```

### Type 3（本地 Python 命令，与 Dragon Claw 联动）标准 `command.py` 模版：

```python
"""
WeLink 斜杠命令: dc_query
类型: 3 (本地 Python 命令)
入口: 1, 2 (单聊与群聊)
"""
import asyncio
import urllib.request
import json

CONFIG = {
    "name": "dc_query",
    "chinese_name": "龙爪智能查询",
    "description": "输入 /dc_query <问题> 查询平台数据与状态",
    "description_en": "Query Dragon Claw via slash command",
    "command_type": 3,
    "scopes": ["user", "group"]
}

async def handle(ctx):
    """
    ctx 包含上下文对象:
    - ctx.raw_text: 用户输入的完整指令字符串 (如: "/dc_query 查本周告警")
    - ctx.args: 剔除命令名后的参数列表
    - ctx.user_account: 发送人工号
    - ctx.is_group: 是否群聊
    - ctx.group_id: 群 ID (群聊时有效)
    - ctx.send_text(text): 发送文本回复
    - ctx.send_markdown(md): 发送 Markdown 回复
    """
    param = " ".join(ctx.args).strip()
    if not param:
        await ctx.send_text("请输入查询内容，例如：/dc_query 查今天待参加会议")
        return

    await ctx.send_text(f"⏳ 正在通过 Dragon Claw 查询：{param} ...")

    try:
        # 可调用 Dragon Claw 本地 HTTP 接口获取数据
        req_data = json.dumps({"query": param, "account": ctx.user_account}).encode('utf-8')
        req = urllib.request.Request("http://127.0.0.1:5200/api/channels/welink/query-proxy", 
                                     data=req_data, 
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            reply = data.get("text") or "✅ 查询完成，未发现异常。"
            await ctx.send_text(reply)
    except Exception as e:
        await ctx.send_text(f"❌ 查询失败或服务未就绪: {str(e)}")
```

---

## 常用操作指令与工作流

进入 `assistant_command_executor` 目录：

1. **启动服务与连接网关**：
   ```bash
   python -m ace serve --env prod
   ```
2. **在交互式终端中管理命令**：
   - `help`：显示帮助菜单
   - `list`：列出本地所有可用命令及其发布状态
   - `status`：查看与 WeLink 网关的长连接状态
   - `new <name>`：交互式新建一个命令脚手架
   - `publish <name>`：将指定的命令发布注册到 WeLink 网关
   - `unpublish <name>`：从 WeLink 网关注销该命令
   - `exit` / `quit`：退出服务

---

## 故障排查与最佳实践

1. **输入 `/` 后没有看到新发布的命令**：
   - 检查是否刚发布不足 10 分钟（网关缓存需 5~10 分钟）。
   - 检查 `scopes` 配置是否包含当前聊天类型（单聊选了 1，群聊选了 2）。
   - 尝试在 WeLink PC 客户端按 `Ctrl+R` 刷新或重新启动 WeLink 客户端。
2. **Type 3 命令群成员输入后提示超时**：
   - 检查发布者本机的 `python -m ace serve --env prod` 进程是否正在运行。
   - 检查本机网络是否处于华为内网 / VPN 环境。
3. **URL 无法打开**：
   - Type 1 如果配置 `http://localhost:5200`，只有本机点击能访问；若要群里其他人都能访问，目标 URL 需配置为局域网 IP、域名或部署在内网服务器上的真实地址。
