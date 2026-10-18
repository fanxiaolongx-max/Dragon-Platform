/**
 * AI Circuit Breaker & Timeout Protection
 * 专门保护后台分析与主动预警等非交互型 AI 任务，防止网络不可达时出现超长阻塞（11~71s）。
 * 并在触发熔断时向告警台发送告警，同时进行频率抑制（防止持续不通时刷屏）。
 */

function isNetworkOrTimeoutError(err) {
    if (!err) return false;
    const msg = String(err.message || err || '');
    const code = String(err.code || '');
    const name = String(err.name || '');
    return name === 'AbortError' || name === 'TimeoutError'
        || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNRESET'
        || /fetch failed|timeout|aborted|network|socket hang up|connect/i.test(msg);
}

function getAlertCenterRepo() {
    try {
        return require('./alert-center-repository');
    } catch (_err) {
        return null;
    }
}

async function emitCircuitAlert({ name, displayName, reason, failures, intervalMinutes = 15 }) {
    const repo = getAlertCenterRepo();
    if (!repo || typeof repo.addEvent !== 'function') return;
    try {
        await repo.addEvent({
            eventType: 'system',
            severity: 'warn',
            title: `大模型 AI 接口连接异常已触发熔断 (${displayName || name})`,
            message: `检测到 ${displayName || name} 接口连接失败（${reason}）。系统已自动开启熔断保护并降级为离线规则模式，页面将秒级响应。当前已连续失败 ${failures} 次；持续断网期间已启用频率抑制（每 ${intervalMinutes} 分钟至多提醒一次）。`,
            actor: 'system',
            source: 'ai_circuit_breaker',
            objectType: 'ai_service',
            objectId: name,
            detail: {
                module: name,
                displayName: displayName || name,
                consecutiveFailures: failures,
                error: reason,
                throttleMinutes: intervalMinutes,
                timestamp: new Date().toISOString()
            },
            aiStatus: 'not_applicable',
            aiSummary: '大模型网络不可达，系统已自动熔断降级为本地规则模式。'
        });
    } catch (err) {
        console.warn(`[AI] Failed to record circuit breaker alert:`, err.message || err);
    }
}

async function emitRecoveryAlert({ name, displayName }) {
    const repo = getAlertCenterRepo();
    if (!repo || typeof repo.addEvent !== 'function') return;
    try {
        await repo.addEvent({
            eventType: 'system',
            severity: 'info',
            title: `大模型 AI 接口连接已恢复正常 (${displayName || name})`,
            message: `检测到 ${displayName || name} 接口已重新建立连接并成功响应，系统已自动解除熔断保护，恢复 AI 智能分析功能。`,
            actor: 'system',
            source: 'ai_circuit_breaker',
            objectType: 'ai_service',
            objectId: name,
            detail: {
                module: name,
                displayName: displayName || name,
                recoveredAt: new Date().toISOString()
            },
            aiStatus: 'not_applicable',
            aiSummary: '大模型连接恢复，系统已自动切回 AI 模式。'
        });
    } catch (err) {
        console.warn(`[AI] Failed to record circuit recovery alert:`, err.message || err);
    }
}

class AiCircuitBreaker {
    constructor({
        name = 'AI',
        displayName = '大模型服务',
        threshold = 2,
        coolDownMs = 120_000,
        timeoutMs = 3500,
        alertIntervalMs = 15 * 60 * 1000 // 默认持续异常时 15 分钟最多告警一次
    } = {}) {
        this.name = name;
        this.displayName = displayName;
        this.threshold = threshold;
        this.coolDownMs = coolDownMs;
        this.timeoutMs = timeoutMs;
        this.alertIntervalMs = alertIntervalMs;
        this.consecutiveFailures = 0;
        this.trippedUntil = 0;
        this.lastError = null;
        this.lastAlertAt = 0;
        this.hasActiveOutage = false;
    }

    isOpen() {
        if (!this.trippedUntil) return false;
        if (Date.now() < this.trippedUntil) return true;
        // 冷却期过后，自动恢复 Half-Open 状态，允许尝试一次探测
        this.trippedUntil = 0;
        return false;
    }

    recordSuccess() {
        if (this.consecutiveFailures > 0) {
            console.log(`[AI] ${this.name} connection recovered.`);
        }
        if (this.hasActiveOutage) {
            emitRecoveryAlert({ name: this.name, displayName: this.displayName }).catch(() => {});
            this.hasActiveOutage = false;
        }
        this.consecutiveFailures = 0;
        this.trippedUntil = 0;
        this.lastError = null;
        this.lastAlertAt = 0;
    }

    recordFailure(err) {
        this.consecutiveFailures += 1;
        this.lastError = err;
        if (this.consecutiveFailures >= this.threshold) {
            this.trippedUntil = Date.now() + this.coolDownMs;
            console.warn(`[AI] ${this.name} circuit tripped for ${Math.round(this.coolDownMs / 1000)}s after ${this.consecutiveFailures} consecutive errors (${err?.message || err})`);
            this.maybeEmitAlert(err);
        }
    }

    maybeEmitAlert(err) {
        const now = Date.now();
        // 频率控制：若持续不通，在 alertIntervalMs 内只报警一次，防止淹没告警台
        if (this.lastAlertAt && (now - this.lastAlertAt < this.alertIntervalMs)) {
            return;
        }
        this.lastAlertAt = now;
        this.hasActiveOutage = true;
        const reason = err?.message || String(err || '网络连接超时或不可达');
        emitCircuitAlert({
            name: this.name,
            displayName: this.displayName,
            reason,
            failures: this.consecutiveFailures,
            intervalMinutes: Math.round(this.alertIntervalMs / 60000)
        }).catch(() => {});
    }

    createTimeoutSignal(customTimeoutMs) {
        const ms = customTimeoutMs || this.timeoutMs;
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            return AbortSignal.timeout(ms);
        }
        if (typeof AbortController !== 'undefined') {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                const err = new Error(`Timeout after ${ms}ms`);
                err.name = 'TimeoutError';
                controller.abort(err);
            }, ms);
            if (timer && typeof timer.unref === 'function') timer.unref();
            return controller.signal;
        }
        return undefined;
    }
}

const proactiveAlertCircuit = new AiCircuitBreaker({
    name: 'ProactiveAlert',
    displayName: '主动预警分析',
    threshold: 2,
    coolDownMs: 120_000,          // 2分钟冷却
    timeoutMs: 3500,               // 3.5秒超时
    alertIntervalMs: 15 * 60 * 1000 // 持续故障时 15 分钟告警一次
});

const alertAiCircuit = new AiCircuitBreaker({
    name: 'AlertCenterAi',
    displayName: '告警值班分析',
    threshold: 2,
    coolDownMs: 120_000,          // 2分钟冷却
    timeoutMs: 3500,               // 3.5秒超时
    alertIntervalMs: 15 * 60 * 1000 // 持续故障时 15 分钟告警一次
});

module.exports = {
    AiCircuitBreaker,
    isNetworkOrTimeoutError,
    proactiveAlertCircuit,
    alertAiCircuit,
    emitCircuitAlert,
    emitRecoveryAlert
};
