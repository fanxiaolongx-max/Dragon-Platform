// 频道心跳抽查与健康自愈看门狗（Channel Heartbeat Watchdog & Auto-heal）。
// 定时抽查每个已对接频道（WeLink、微信）的心跳保持机制与长连接状态，
// 遇到网络抖动、电脑休眠或 duplicate_connection 断线时在网关超时释放后自动重连自愈，
// 并将实时抽查与心跳监控结果汇总至 TOOLS PLATFORM STATUS 服务状态中心。

const { runWithTenant, DEFAULT_TENANT_ID } = require('../tenant-context');
const welink = require('./welink-bridge-service');
const weixin = require('./weixin-bridge-service');
const welinkConfigRepo = require('./welink-config-repository');
const weixinConfigRepo = require('./weixin-config-repository');

const DEFAULT_INTERVAL_MS = 30000; // 30秒定时抽查
const RECONNECT_COOLDOWN_MS = 25000; // 重连冷却时间（避免网关旧会话未超时重复撞车）
const MAX_CONSECUTIVE_RECOVERIES = 5;

let watchdogTimer = null;
let listTenantIdsFn = null;
let isInspecting = false;

// 记录各频道失败追踪与自愈状态（按 tenantId:channel 键）
const channelTrackers = new Map();

function getTrackerKey(tenantId, channel) {
    return `${tenantId || DEFAULT_TENANT_ID}:${channel}`;
}

function getTracker(tenantId, channel) {
    const key = getTrackerKey(tenantId, channel);
    if (!channelTrackers.has(key)) {
        channelTrackers.set(key, {
            firstFailedAt: null,
            lastFailedAt: null,
            lastAttemptAt: null,
            consecutiveFailures: 0,
            recoveryAttempts: 0,
            totalRecoveries: 0,
            lastRecoveredAt: null,
            lastError: null
        });
    }
    return channelTrackers.get(key);
}

const watchdogState = {
    startedAt: null,
    lastCheckAt: null,
    checkCount: 0,
    intervalMs: DEFAULT_INTERVAL_MS,
    autoRecoveryCount: 0,
    lastRecoveryAt: null,
    latestSummary: null
};

/**
 * 抽查 WeLink 频道的长连接与 WebSocket 心跳状态
 */
async function inspectWeLink(tenantId) {
    return runWithTenant(tenantId, async () => {
        const tracker = getTracker(tenantId, 'welink');
        let config = null;
        try {
            config = await welinkConfigRepo.getConfig();
        } catch (err) {
            return {
                id: 'welink',
                name: 'WeLink',
                tenantId,
                enabled: false,
                configured: false,
                status: 'error',
                state: 'incident',
                stateLabel: '配置读取失败',
                heartbeat: { healthy: false, type: 'WebSocket Keepalive', lastHeartbeatAt: null },
                lastError: err.message
            };
        }

        if (!config.enabled) {
            tracker.consecutiveFailures = 0;
            tracker.firstFailedAt = null;
            return {
                id: 'welink',
                name: 'WeLink',
                tenantId,
                enabled: false,
                configured: Boolean(config.channel && config.ak && config.sk),
                status: 'disabled',
                state: 'disabled',
                stateLabel: '未启用',
                heartbeat: { healthy: false, type: 'WebSocket Keepalive', lastHeartbeatAt: null },
                channel: config.channel || '',
                environment: config.environment || 'prod',
                lastCheckAt: new Date().toISOString()
            };
        }

        const configured = Boolean(config.channel && config.ak && config.sk);
        if (!configured) {
            return {
                id: 'welink',
                name: 'WeLink',
                tenantId,
                enabled: true,
                configured: false,
                status: 'unconfigured',
                state: 'degraded',
                stateLabel: '缺少凭据',
                heartbeat: { healthy: false, type: 'WebSocket Keepalive', lastHeartbeatAt: null },
                channel: config.channel || '',
                environment: config.environment || 'prod',
                lastCheckAt: new Date().toISOString(),
                lastError: '未配置 AK/SK 或 Channel，可扫码授权'
            };
        }

        const status = await welink.getStatus(tenantId);
        let diag = null;
        try {
            diag = await welink.getDiagnostics(tenantId);
        } catch (_) {}

        const runtime = status.runtime || {};
        const isReady = status.connected && runtime.state === 'ready';
        const runtimeDiag = diag?.runtime || {};
        const lastHeartbeatAt = runtimeDiag.lastHeartbeatAt || (isReady ? (status.startedAt || new Date().toISOString()) : null);

        if (isReady) {
            tracker.consecutiveFailures = 0;
            tracker.firstFailedAt = null;
            tracker.lastError = null;
            return {
                id: 'welink',
                name: 'WeLink',
                tenantId,
                enabled: true,
                configured: true,
                status: 'connected',
                state: 'operational',
                stateLabel: '网关已连接',
                gatewayState: runtime.state || 'ready',
                channel: config.channel,
                environment: config.environment || 'prod',
                heartbeat: {
                    healthy: true,
                    type: 'WebSocket Keepalive',
                    lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt).toISOString() : new Date().toISOString(),
                    lastReadyAt: runtimeDiag.lastReadyAt ? new Date(runtimeDiag.lastReadyAt).toISOString() : (status.startedAt || null)
                },
                lastCheckAt: new Date().toISOString(),
                autoHeal: {
                    recoveredCount: tracker.totalRecoveries,
                    lastRecoveredAt: tracker.lastRecoveredAt
                },
                lastError: null
            };
        }

        // 连接断开或异常
        const now = Date.now();
        if (!tracker.firstFailedAt) tracker.firstFailedAt = now;
        tracker.lastFailedAt = now;
        tracker.consecutiveFailures += 1;
        const errMsg = status.lastError?.message || runtime.failureReason || '网关连接断开';
        tracker.lastError = errMsg;

        const isDuplicateConnection = /duplicate_connection/i.test(errMsg);
        const timeSinceFirstFailed = now - tracker.firstFailedAt;
        let autoHealed = false;
        let autoHealMsg = null;

        // 自愈触发条件：
        // 1. 已启用且已配置
        // 2. 距离首次检测失败至少已过冷却时间（让网关有充足时间释放旧会话）
        // 3. 距离上次重试至少间隔冷却时间
        // 4. 连续重试未超过上限
        const canAttemptRecovery = timeSinceFirstFailed >= RECONNECT_COOLDOWN_MS
            && (!tracker.lastAttemptAt || (now - tracker.lastAttemptAt) >= RECONNECT_COOLDOWN_MS)
            && tracker.recoveryAttempts < MAX_CONSECUTIVE_RECOVERIES;

        if (canAttemptRecovery) {
            tracker.lastAttemptAt = now;
            tracker.recoveryAttempts += 1;
            console.log(`[ChannelWatchdog] 检测到 WeLink 频道异常 (${errMsg})，已等待 ${Math.round(timeSinceFirstFailed / 1000)}s，尝试自动重连自愈 (第 ${tracker.recoveryAttempts} 次)...`);
            try {
                await welink.restart(tenantId);
                const recheck = await welink.getStatus(tenantId);
                if (recheck.connected && recheck.runtime?.state === 'ready') {
                    autoHealed = true;
                    tracker.totalRecoveries += 1;
                    tracker.lastRecoveredAt = new Date().toISOString();
                    tracker.firstFailedAt = null;
                    tracker.consecutiveFailures = 0;
                    tracker.recoveryAttempts = 0;
                    tracker.lastError = null;
                    watchdogState.autoRecoveryCount += 1;
                    watchdogState.lastRecoveryAt = tracker.lastRecoveredAt;
                    console.log(`[ChannelWatchdog] ✅ WeLink 频道自动自愈成功！`);
                    return {
                        id: 'welink',
                        name: 'WeLink',
                        tenantId,
                        enabled: true,
                        configured: true,
                        status: 'connected',
                        state: 'operational',
                        stateLabel: '网关已连接（自愈恢复）',
                        gatewayState: 'ready',
                        channel: config.channel,
                        environment: config.environment || 'prod',
                        heartbeat: {
                            healthy: true,
                            type: 'WebSocket Keepalive',
                            lastHeartbeatAt: new Date().toISOString(),
                            lastReadyAt: new Date().toISOString()
                        },
                        lastCheckAt: new Date().toISOString(),
                        autoHeal: {
                            justRecovered: true,
                            recoveredCount: tracker.totalRecoveries,
                            lastRecoveredAt: tracker.lastRecoveredAt
                        },
                        lastError: null
                    };
                }
            } catch (healError) {
                autoHealMsg = healError.message;
                console.warn(`[ChannelWatchdog] WeLink 自动重连重试中: ${healError.message}`);
            }
        }

        return {
            id: 'welink',
            name: 'WeLink',
            tenantId,
            enabled: true,
            configured: true,
            status: runtime.state === 'connecting' ? 'reconnecting' : 'failed',
            state: runtime.state === 'connecting' ? 'degraded' : 'incident',
            stateLabel: isDuplicateConnection ? '连接冲突（等待释放）' : (runtime.state === 'connecting' ? '正在连接' : '连接失败'),
            gatewayState: runtime.state || 'failed',
            channel: config.channel,
            environment: config.environment || 'prod',
            heartbeat: {
                healthy: false,
                type: 'WebSocket Keepalive',
                lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt).toISOString() : null
            },
            lastCheckAt: new Date().toISOString(),
            autoHeal: {
                inProgress: canAttemptRecovery,
                cooldownRemainingSec: Math.max(0, Math.round((RECONNECT_COOLDOWN_MS - timeSinceFirstFailed) / 1000)),
                attempts: tracker.recoveryAttempts,
                recoveredCount: tracker.totalRecoveries,
                lastRecoveredAt: tracker.lastRecoveredAt
            },
            lastError: autoHealMsg ? `重连中: ${autoHealMsg}` : errMsg
        };
    });
}

/**
 * 抽查微信 (iLink) 频道的长轮询与心跳状态
 */
async function inspectWeixin(tenantId) {
    return runWithTenant(tenantId, async () => {
        const tracker = getTracker(tenantId, 'weixin');
        let config = null;
        try {
            config = await weixinConfigRepo.getConfig();
        } catch (err) {
            return {
                id: 'weixin',
                name: '微信',
                tenantId,
                enabled: false,
                configured: false,
                status: 'error',
                state: 'incident',
                stateLabel: '配置读取失败',
                heartbeat: { healthy: false, type: 'iLink Long-Polling', lastHeartbeatAt: null },
                lastError: err.message
            };
        }

        if (!config.enabled) {
            tracker.consecutiveFailures = 0;
            tracker.firstFailedAt = null;
            return {
                id: 'weixin',
                name: '微信',
                tenantId,
                enabled: false,
                configured: Boolean(config.token),
                status: 'disabled',
                state: 'disabled',
                stateLabel: '未启用',
                heartbeat: { healthy: false, type: 'iLink Long-Polling', lastHeartbeatAt: null },
                lastCheckAt: new Date().toISOString()
            };
        }

        if (!config.token) {
            return {
                id: 'weixin',
                name: '微信',
                tenantId,
                enabled: true,
                configured: false,
                status: 'unconfigured',
                state: 'degraded',
                stateLabel: '缺少 Token',
                heartbeat: { healthy: false, type: 'iLink Long-Polling', lastHeartbeatAt: null },
                lastCheckAt: new Date().toISOString(),
                lastError: '未配置或扫码登录微信 Bot Token'
            };
        }

        const status = await weixin.getStatus(tenantId);
        let diag = null;
        try {
            diag = await weixin.getDiagnostics(tenantId);
        } catch (_) {}

        const runtimeStateStr = String(status.runtime?.state || status.runtime || 'idle');
        const isPolling = runtimeStateStr === 'polling';
        const lastPollAt = diag?.runtime?.lastPollAt || (isPolling ? new Date().toISOString() : null);

        if (isPolling) {
            tracker.consecutiveFailures = 0;
            tracker.firstFailedAt = null;
            tracker.lastError = null;
            return {
                id: 'weixin',
                name: '微信',
                tenantId,
                enabled: true,
                configured: true,
                status: 'connected',
                state: 'operational',
                stateLabel: '长轮询中',
                heartbeat: {
                    healthy: true,
                    type: 'iLink Long-Polling',
                    lastHeartbeatAt: lastPollAt ? new Date(lastPollAt).toISOString() : new Date().toISOString()
                },
                lastCheckAt: new Date().toISOString(),
                autoHeal: {
                    recoveredCount: tracker.totalRecoveries,
                    lastRecoveredAt: tracker.lastRecoveredAt
                },
                lastError: null
            };
        }

        const errMsg = status.runtime?.failureReason || status.lastError?.message || '长轮询已中断';
        tracker.lastError = errMsg;
        return {
            id: 'weixin',
            name: '微信',
            tenantId,
            enabled: true,
            configured: true,
            status: runtimeStateStr === 'reconnecting' ? 'reconnecting' : 'failed',
            state: runtimeStateStr === 'reconnecting' ? 'degraded' : 'incident',
            stateLabel: runtimeStateStr === 'reconnecting' ? '正在重连' : '轮询中断',
            heartbeat: {
                healthy: false,
                type: 'iLink Long-Polling',
                lastHeartbeatAt: lastPollAt ? new Date(lastPollAt).toISOString() : null
            },
            lastCheckAt: new Date().toISOString(),
            autoHeal: {
                recoveredCount: tracker.totalRecoveries,
                lastRecoveredAt: tracker.lastRecoveredAt
            },
            lastError: errMsg
        };
    });
}

/**
 * 执行一次全量频道心跳与连接状态抽查
 */
async function inspectNow() {
    if (isInspecting) return watchdogState.latestSummary || buildEmptySummary();
    isInspecting = true;
    try {
        const tenantIds = new Set([DEFAULT_TENANT_ID]);
        if (typeof listTenantIdsFn === 'function') {
            try {
                const ids = await listTenantIdsFn();
                (ids || []).forEach(id => id && tenantIds.add(id));
            } catch (err) {
                console.warn('[ChannelWatchdog] 读取租户列表失败，默认检查 default 租户：', err.message);
            }
        }

        const channelResults = [];
        for (const tenantId of tenantIds) {
            try {
                const welinkResult = await inspectWeLink(tenantId);
                channelResults.push(welinkResult);
            } catch (err) {
                channelResults.push({
                    id: 'welink',
                    name: 'WeLink',
                    tenantId,
                    enabled: false,
                    configured: false,
                    status: 'error',
                    state: 'incident',
                    stateLabel: '抽查异常',
                    heartbeat: { healthy: false, type: 'WebSocket Keepalive', lastHeartbeatAt: null },
                    lastError: err.message
                });
            }

            try {
                const weixinResult = await inspectWeixin(tenantId);
                channelResults.push(weixinResult);
            } catch (err) {
                channelResults.push({
                    id: 'weixin',
                    name: '微信',
                    tenantId,
                    enabled: false,
                    configured: false,
                    status: 'error',
                    state: 'incident',
                    stateLabel: '抽查异常',
                    heartbeat: { healthy: false, type: 'iLink Long-Polling', lastHeartbeatAt: null },
                    lastError: err.message
                });
            }
        }

        watchdogState.lastCheckAt = new Date().toISOString();
        watchdogState.checkCount += 1;

        const enabledChannels = channelResults.filter(c => c.enabled);
        const operationalCount = enabledChannels.filter(c => c.state === 'operational').length;
        const incidentCount = enabledChannels.filter(c => c.state === 'incident').length;

        let overallHealth = 'operational';
        if (incidentCount > 0 && incidentCount === enabledChannels.length) {
            overallHealth = 'incident';
        } else if (incidentCount > 0) {
            overallHealth = 'degraded';
        } else if (enabledChannels.length === 0) {
            overallHealth = 'no-channels';
        }

        const summary = {
            enabled: true,
            intervalMs: watchdogState.intervalMs,
            lastCheckAt: watchdogState.lastCheckAt,
            checkCount: watchdogState.checkCount,
            autoRecoveryCount: watchdogState.autoRecoveryCount,
            lastRecoveryAt: watchdogState.lastRecoveryAt,
            overallHealth,
            channels: channelResults
        };

        watchdogState.latestSummary = summary;
        return summary;
    } finally {
        isInspecting = false;
    }
}

function buildEmptySummary() {
    return {
        enabled: Boolean(watchdogTimer),
        intervalMs: watchdogState.intervalMs,
        lastCheckAt: watchdogState.lastCheckAt,
        checkCount: watchdogState.checkCount,
        autoRecoveryCount: watchdogState.autoRecoveryCount,
        lastRecoveryAt: watchdogState.lastRecoveryAt,
        overallHealth: 'operational',
        channels: []
    };
}

/**
 * 获取看门狗抽查摘要（如尚未运行过则立即触发一次）
 */
async function getWatchdogSummary() {
    if (!watchdogState.latestSummary) {
        return inspectNow();
    }
    return watchdogState.latestSummary;
}

/**
 * 启动定时抽查与自愈服务
 */
function start(listTenants, intervalMs = DEFAULT_INTERVAL_MS) {
    listTenantIdsFn = listTenants;
    watchdogState.intervalMs = intervalMs;
    watchdogState.startedAt = new Date().toISOString();

    if (watchdogTimer) clearInterval(watchdogTimer);

    // 延时 3 秒首次执行，避免与应用启动时的 autoStartAll 冲突
    setTimeout(() => {
        inspectNow().catch(err => console.error('[ChannelWatchdog] 首次抽查失败：', err.message));
    }, 3000);

    watchdogTimer = setInterval(() => {
        inspectNow().catch(err => console.error('[ChannelWatchdog] 定时抽查失败：', err.message));
    }, intervalMs);

    console.log(`[ChannelWatchdog] 频道心跳定时抽查与健康自愈已启动（周期 ${Math.round(intervalMs / 1000)}s）`);
}

/**
 * 停止定时抽查
 */
function stop() {
    if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
    }
    isInspecting = false;
}

function resetForTests() {
    stop();
    channelTrackers.clear();
    watchdogState.startedAt = null;
    watchdogState.lastCheckAt = null;
    watchdogState.checkCount = 0;
    watchdogState.autoRecoveryCount = 0;
    watchdogState.lastRecoveryAt = null;
    watchdogState.latestSummary = null;
}

module.exports = {
    start,
    stop,
    inspectNow,
    getWatchdogSummary,
    resetForTests
};
