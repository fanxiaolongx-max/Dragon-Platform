// 频道对接公共能力入口（welink / weixin）：其他后端模块、Dragon Claw 工具都通过这里调用，不直接依赖具体频道实现。
//
//   const channels = require('./models/channels');
//   await channels.push({ channel: 'welink', text: '本月报表已发布', targets: [{ kind: 'group', id: 'xxx' }] });
//   await channels.listTargets({ channel: 'welink', kind: 'user', pushableOnly: true });
//
// 租户取自当前请求上下文（AsyncLocalStorage），后台任务需先 runWithTenant。
const { getTenantId } = require('../tenant-context');
const welink = require('./welink-bridge-service');
const weixin = require('./weixin-bridge-service');
const targetsRepo = require('./channel-targets-repository');

const CHANNELS = { welink, weixin };

function resolveChannel(channel = 'welink') {
    const service = CHANNELS[channel];
    if (!service) {
        const error = new Error(`不支持的频道：${channel}`);
        error.code = 'CHANNEL_UNSUPPORTED';
        error.statusCode = 400;
        throw error;
    }
    return service;
}

/** 主动推送；targets 省略时使用该频道配置的默认推送范围。成功的推送会记入该群/人的对话记录。 */
async function push({ channel = 'welink', text, targets, trigger, source } = {}) {
    const result = await resolveChannel(channel).push(getTenantId(), { text, targets, trigger, source });
    await require('./channel-push-history').recordResults(channel, String(text || '').trim(), result, { trigger, source });
    return result;
}

function getStatus({ channel = 'welink' } = {}) {
    return resolveChannel(channel).getStatus(getTenantId());
}

/** 历史出现过的人员/群组，按最近活跃由近及远。 */
function listTargets({ channel = 'welink', kind, q, limit, pushableOnly } = {}) {
    resolveChannel(channel);
    return targetsRepo.listTargets(channel, { kind, q, limit, pushableOnly });
}

module.exports = { CHANNELS: Object.keys(CHANNELS), push, getStatus, listTargets };
