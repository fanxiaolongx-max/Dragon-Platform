// 埃及车辆违章查询 (PPO Traffic Violations) 专用原生工具集
// 直连 PPO 查询中枢服务 (http://127.0.0.1:17654)
// 全员可用：供智能体自主查询车辆违章、检测官方状态、查询历史记录
const path = require('path');
const agentLoop = require('./agent-loop');

const SKILL_ID = 'ppo-traffic';
const DEFAULT_BASE_URL = process.env.PPO_BASE_URL || 'http://127.0.0.1:17654';
const DEFAULT_API_KEY = process.env.PPO_API_KEY || '';

function definitions() {
    return [
        {
            name: 'ppo_query_violations',
            description: '查询埃及机动车交通违章（مخالفات رخص المركبات）。提交车牌阿拉伯字母、纯数字车牌号及车主证件（中国护照号或14位埃及身份证号），同步排队轮询获取埃及公诉机关（PPO）官方违章记录、违章总额（EGP）、违章笔数、和解金额等。全员可用。',
            parameters: {
                type: 'object',
                properties: {
                    letters: {
                        type: 'string',
                        description: '车牌的 2~3 个阿拉伯字母，以空格分隔（例如："أ ف س" 或 "س ي د"）'
                    },
                    number: {
                        type: 'string',
                        description: '1~8 位纯数字车牌号（例如："3413"）'
                    },
                    passport: {
                        type: 'string',
                        description: '车主中国护照号（例如："E12345678"），与 national_id 二选一'
                    },
                    national_id: {
                        type: 'string',
                        description: '车主14位埃及身份证号（埃及公民使用），与 passport 二选一'
                    },
                    wait: {
                        type: 'boolean',
                        description: '是否排队等待官方返回最终查询结果（默认 true，通常耗时 10~25 秒）'
                    }
                },
                required: ['letters', 'number']
            }
        },
        {
            name: 'ppo_check_status',
            description: '检测埃及公诉机关（PPO）违章查询中枢服务及埃及官方违章门户的连通状态、服务可用性与队列负载。',
            parameters: { type: 'object', properties: {} }
        },
        {
            name: 'ppo_query_history',
            description: '查看最近提交的车辆违章查询历史记录与处理状态。',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: '返回历史记录条数，默认 5 条' }
                }
            }
        }
    ];
}

function buildPrompt() {
    return `### 🚗 埃及车辆违章查询 (PPO Traffic Violations)
- 本技能已全员开放使用，你拥有以下专用 native 工具：
  - \`ppo_query_violations\`: 核心违章查询。必填 letters（2~3个阿拉伯字母，如 "أ ف س"）与 number（数字车牌，如 "3413"）；车主证件提供 passport（中国护照如 "E12345678"）或 national_id（14位埃及身份证）；默认 wait=true 会自动轮询官网获取最终罚金与违章笔数。
  - \`ppo_check_status\`: 检查 PPO 服务与埃及官方系统状态。
  - \`ppo_query_history\`: 查阅最近查询记录。
- **调用规范**：
  1. 用户告知车牌与证件时，**必须直接调用 \`ppo_query_violations\`**，不要要求用户去终端运行命令，也不要让用户自己去官网查询。
  2. 若用户缺少车主证件（护照或身份证）或车牌字母不完整，请友好提示用户提供。中国护照签发国代码为 10206。
  3. 查询成功时，向用户清晰展示：
     - 车辆车牌（阿拉伯字母 + 数字）
     - 违章笔数（عدد المخالفات）
     - 罚金总额（إجمالي الغرامات，单位：埃及磅 EGP）
     - 和解优惠金（若有）
  4. 若官方返回失败（如 LICENSE_DATA_UPDATE_REQUIRED 表示车辆需去交警部门更新档案；IDENTITY_MISMATCH 表示车牌与证件不符；OFFICIAL_MAINTENANCE 表示埃及官网正在维护），应给予清晰友好的中文解释。`;
}

// 辅助方法：规范化阿拉伯字母
function normalizeLetters(lettersInput) {
    if (Array.isArray(lettersInput)) {
        return lettersInput.map(c => String(c || '').replace(/\u0640/g, '').trim()).filter(Boolean);
    }
    const raw = String(lettersInput || '').replace(/[,，、]/g, ' ').split(/\s+/);
    return raw.map(c => c.replace(/\u0640/g, '').trim()).filter(Boolean);
}

// 执行工具
async function execute(name, args = {}, _options = {}) {
    const baseUrl = (process.env.PPO_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const apiKey = process.env.PPO_API_KEY || DEFAULT_API_KEY;
    const headers = {
        'Accept': 'application/json',
        'X-Device-Id': 'ppo_dragonclaw_gateway'
    };
    if (apiKey) {
        headers['X-API-Key'] = apiKey;
    }

    try {
        if (name === 'ppo_check_status') {
            const resp = await fetch(`${baseUrl}/api/v1/status`, { headers, signal: AbortSignal.timeout(10000) });
            if (!resp.ok) {
                const text = await resp.text();
                return { content: `PPO 服务状态检测异常 (HTTP ${resp.status}): ${text}`, isError: true, summary: '服务状态检测异常' };
            }
            const data = await resp.json();
            const serverStatus = data.server?.status === 'operational' ? '正常' : '异常';
            const officialStatus = data.official?.status || '正常';
            const queued = data.queue?.queuedCount ?? data.queue?.queued ?? 0;
            return {
                content: JSON.stringify(data, null, 2),
                summary: `PPO 服务运行${serverStatus}，官方门户状态：${officialStatus}，当前队列：${queued}`
            };
        }

        if (name === 'ppo_query_history') {
            const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 50);
            const resp = await fetch(`${baseUrl}/api/v1/history?limit=${limit}`, { headers, signal: AbortSignal.timeout(10000) });
            if (!resp.ok) {
                const text = await resp.text();
                return { content: `获取违章查询历史失败 (HTTP ${resp.status}): ${text}`, isError: true, summary: '获取历史失败' };
            }
            const data = await resp.json();
            const count = data.items?.length || 0;
            return {
                content: JSON.stringify(data, null, 2),
                summary: `已获取最近 ${count} 条违章查询记录`
            };
        }

        if (name === 'ppo_query_violations') {
            const letters = normalizeLetters(args.letters);
            const plateNumber = String(args.number || '').trim();
            const passport = String(args.passport || '').trim();
            const nationalId = String(args.national_id || '').trim();
            const wait = args.wait !== false;

            if (letters.length < 2 || letters.length > 3) {
                return {
                    content: `车牌阿拉伯字母必须为 2 到 3 个，当前收到: ${letters.join(' ')}。`,
                    isError: true,
                    summary: '车牌字母格式不正确'
                };
            }
            if (!plateNumber) {
                return { content: '缺少车牌数字。', isError: true, summary: '缺少车牌数字' };
            }
            if (!passport && !nationalId) {
                return { content: '查询违章需提供车主中国护照号（passport）或14位埃及身份证号（national_id）。', isError: true, summary: '缺少车主证件信息' };
            }

            const ownerType = nationalId ? 'national_id' : 'passport';
            const documentNumber = nationalId || passport;
            const payload = {
                plate: {
                    letters,
                    number: plateNumber
                },
                owner: {
                    type: ownerType,
                    documentNumber,
                    country: '10206',
                    foreignType: ownerType === 'national_id' ? 'citizen' : 'foreign'
                }
            };

            const submitResp = await fetch(`${baseUrl}/api/v1/queries`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000)
            });

            if (!submitResp.ok) {
                const errText = await submitResp.text();
                let errMsg = errText;
                try {
                    const parsed = JSON.parse(errText);
                    errMsg = parsed.error?.message || errText;
                } catch (_) {}
                return {
                    content: `提交违章查询任务失败 (HTTP ${submitResp.status}): ${errMsg}`,
                    isError: true,
                    summary: `查询任务提交失败: ${errMsg}`
                };
            }

            const submitData = await submitResp.json();
            const queryId = submitData.query?.id;
            if (!queryId) {
                return { content: JSON.stringify(submitData, null, 2), summary: '查询已提交，但未返回任务 ID' };
            }

            if (!wait) {
                return {
                    content: JSON.stringify(submitData, null, 2),
                    summary: `查询任务已提交排队（任务 ID: ${queryId}）`
                };
            }

            // 轮询等待结果（最多 45 秒）
            const startTime = Date.now();
            const maxWaitMs = 45000;
            let finalData = submitData;

            while (Date.now() - startTime < maxWaitMs) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                    const pollResp = await fetch(`${baseUrl}/api/v1/queries/${queryId}`, { headers, signal: AbortSignal.timeout(10000) });
                    if (!pollResp.ok) continue;
                    finalData = await pollResp.json();
                    if (finalData.status === 'success' || finalData.status === 'failed') {
                        break;
                    }
                } catch (_err) {
                    // 网络抖动，继续下一轮轮询
                }
            }

            const plateDisplay = `${letters.join(' ')} ${plateNumber}`;
            if (finalData.status === 'success' && finalData.result) {
                const totalFine = finalData.result.totalFine || '0 EGP';
                const count = finalData.result.violationCount || '0';
                return {
                    content: JSON.stringify(finalData, null, 2),
                    summary: `违章查询成功：车牌【${plateDisplay}】，共 ${count} 笔违章，总罚金：${totalFine}`
                };
            } else if (finalData.status === 'failed') {
                const errCode = finalData.error?.code || 'UNKNOWN_ERROR';
                const errMsg = finalData.error?.message || '埃及官网查询失败';
                return {
                    content: JSON.stringify(finalData, null, 2),
                    isError: true,
                    summary: `查询未通过 [${errCode}]: ${errMsg}`
                };
            } else {
                return {
                    content: JSON.stringify(finalData, null, 2),
                    summary: `查询任务已进入官方处理队列（状态: ${finalData.status || 'queued'}，任务 ID: ${queryId}）`
                };
            }
        }

        return { content: `未知违章工具: ${name}`, isError: true };
    } catch (err) {
        return {
            content: `违章查询操作异常: ${err.message || err}`,
            isError: true,
            summary: `违章服务异常: ${err.message || err}`
        };
    }
}

async function runTurn({ client: aiClient, systemInstruction, messages, signal, onDelta, onEvent, maxOutputTokens, temperature, model, extras = null, vision = null }) {
    const result = await agentLoop.runToolLoop({
        extras,
        vision,
        client: aiClient, model, systemPrompt: `${systemInstruction}\n${buildPrompt()}`, messages, tools: definitions(),
        write: event => (event.type === 'delta' ? onDelta?.(event.delta) : onEvent?.(event)),
        signal, maxOutputTokens, temperature, task: String(messages.at(-1)?.content || ''), callIdPrefix: 'ppo',
        executeCall: async (call, { start }) => {
            const args = call.args && typeof call.args === 'object' ? call.args : {};
            start({ tool: call.name, args });
            const outcome = await execute(call.name, args);
            return { ...outcome, output: String(outcome.content || '').slice(0, 4000) };
        },
        toolsUnsupported: () => ({ note: '（当前模型不支持工具调用，埃及车辆违章查询工具不可用。）' })
    });
    return { text: result.text, usage: result.usage, toolLog: result.toolLog, ...(result.toolsUnsupported ? { toolsUnsupported: true } : {}) };
}

module.exports = {
    SKILL_ID,
    definitions,
    buildPrompt,
    execute,
    runTurn,
    canUsePpo: async () => true // 全员可用
};
