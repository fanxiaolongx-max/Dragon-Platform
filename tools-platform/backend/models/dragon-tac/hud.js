// Agent HUD 的标准 MCP 探测适配器。只发现能力，不修改客户端配置、不代答审批。
const { spawn } = require('child_process');
const { executable } = require('./browser');
const path = require('path');
const os = require('os');
function binary() {
    return executable('agent-hud', process.env.TOOLS_DRAGON_TAC_HUD)
        || executable('agent-hud', '/Applications/Agent HUD.app/Contents/MacOS/Agent HUD')
        || executable('agent-hud', '/Applications/Agent HUD.app/Contents/MacOS/AgentHUDOpenApp')
        || executable('agent-hud', path.join(os.homedir(), 'Applications/Agent HUD.app/Contents/MacOS/Agent HUD'));
}
async function inspect() {
    const command = binary();
    if (!command) return { installed: false, connected: false, dispatch: false, tools: [], reason: '未安装 Agent HUD 或未配置 TOOLS_DRAGON_TAC_HUD' };
    return new Promise(resolve => {
        const child = spawn(command, ['--mcp'], { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
        let buffer = '', finished = false;
        const done = data => { if (finished) return; finished = true; clearTimeout(timer); child.kill(); resolve({ installed: true, dispatch: false, ...data }); };
        const timer = setTimeout(() => done({ connected: false, tools: [], reason: 'HUD 未运行、MCP 未启用或连接超时' }), 6000);
        const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
        child.stdin.on('error', () => {});
        child.on('error', () => done({ connected: false, tools: [], reason: 'HUD MCP 启动失败' }));
        child.on('exit', () => done({ connected: false, tools: [], reason: 'HUD MCP 已退出，请检查 HUD 的 MCP 设置' }));
        child.stdout.on('data', chunk => {
            buffer += chunk;
            if (buffer.length > 1000000) return done({ connected: false, tools: [], reason: 'HUD MCP 响应超出上限' });
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
                let value; try { value = JSON.parse(line); } catch { continue; }
                if (value.error) return done({ connected: false, tools: [], reason: 'HUD MCP 拒绝请求，请检查其功能开关' });
                if (value.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }); }
                if (value.id === 2) return done({ connected: true, tools: (value.result?.tools || []).map(tool => tool.name), reason: '已读取实际工具目录；当前执行适配器仍走官方 CLI，不将 HUD 布局/监控工具当成任务派发接口' });
            }
        });
        send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'DragonTAC', version: '1.0' } } });
    });
}
module.exports = { binary, inspect };
