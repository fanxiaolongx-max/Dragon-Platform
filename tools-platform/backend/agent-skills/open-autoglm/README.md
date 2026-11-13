# Open-AutoGLM Agent Skill, Python SDK & MCP Server

Welcome to the **Open-AutoGLM** Agent Skill package!

This package lets any AI coding agent (such as Antigravity, Dragon Claw, Claude Code, Cursor, Copilot, LangChain) or external program connect to your Open-AutoGLM server at `https://yutang.fanxiaolong.uk`.

## Included Files
- `SKILL.md`: Standard Agent Skill definition with complete tool usage prompt and REST references.
- `scripts/autoglm_client.py`: Zero-dependency standalone Python CLI & SDK.
- `scripts/mcp_server.py`: Standard MCP (Model Context Protocol) Server for platforms like Dragon Claw, Claude Desktop, Cursor.
- `references/api_reference.md`: Detailed HTTP API endpoints and request/response specifications.

## Quick Installation

### Option 1: Install as an Agent Skill (Antigravity / Claude Code / Dragon Claw)
Copy the entire `open-autoglm` folder into your agent's skills directory:
- **Antigravity / Gemini**: `~/.gemini/antigravity/skills/open-autoglm/` or `<workspace>/.gemini/skills/open-autoglm/`
- **Claude Code**: `~/.claude/skills/open-autoglm/` or `.claude/skills/open-autoglm/`
- **Dragon Claw / General**: Inside your workspace. (⚠️ 注意：在 Dragon Claw 中使用时，请在会话界面左下角**选择工作空间**，以授权 Agent 终端执行权限！)

### Option 2: Configure as a Native MCP Server (Dragon Claw / Claude Desktop)
在 Dragon Claw 的 **“技能·插件·工具” -> MCP 服务** 或 Claude Desktop 的 `claude_desktop_config.json` 中添加：
```json
{
  "mcpServers": {
    "open-autoglm": {
      "command": "python",
      "args": ["/path/to/open-autoglm/scripts/mcp_server.py"],
      "env": {
        "AUTOGLM_BASE_URL": "https://yutang.fanxiaolong.uk",
        "AUTOGLM_API_KEY": "ak_autoglm_0OBKNPasZ6yvBV4zT_5lYieMsrw7nXHczbn-P1K4qj8"
      }
    }
  }
}
```
**配置为 MCP 后，Agent 无需终端权限即可直接原生调用 `open_autoglm_get_screenshot`、`open_autoglm_run_task` 等工具！**

### Option 3: Use as a Python CLI / Script
```bash
# Check connected phones
python scripts/autoglm_client.py devices

# Send AI task
python scripts/autoglm_client.py run "打开相机拍照" --wait
```
