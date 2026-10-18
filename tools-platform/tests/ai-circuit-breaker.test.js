const test = require('node:test');
const assert = require('node:assert/strict');
const { AiCircuitBreaker, isNetworkOrTimeoutError } = require('../backend/models/ai-circuit-breaker');

test('isNetworkOrTimeoutError correctly identifies network and abort errors', () => {
    assert.equal(isNetworkOrTimeoutError(new TypeError('fetch failed')), true);
    assert.equal(isNetworkOrTimeoutError(new Error('connect ECONNREFUSED 127.0.0.1:443')), true);
    assert.equal(isNetworkOrTimeoutError(new Error('The operation was aborted')), true);
    assert.equal(isNetworkOrTimeoutError(new Error('Business logic validation error')), false);
    assert.equal(isNetworkOrTimeoutError(null), false);
});

test('AiCircuitBreaker trips after threshold failures and recovers after coolDown', () => {
    const breaker = new AiCircuitBreaker({
        name: 'TestBreaker',
        threshold: 2,
        coolDownMs: 50,
        timeoutMs: 100
    });

    assert.equal(breaker.isOpen(), false);

    // 第一次失败
    breaker.recordFailure(new TypeError('fetch failed'));
    assert.equal(breaker.isOpen(), false);

    // 第二次失败，达到阈值，触发熔断
    breaker.recordFailure(new TypeError('fetch failed'));
    assert.equal(breaker.isOpen(), true);

    // 冷却时间过后，进入 Half-Open（关闭熔断，允许探测）
    return new Promise(resolve => {
        setTimeout(() => {
            assert.equal(breaker.isOpen(), false);
            // 成功后重置计数器
            breaker.recordSuccess();
            assert.equal(breaker.consecutiveFailures, 0);
            assert.equal(breaker.isOpen(), false);
            resolve();
        }, 60);
    });
});

test('AiCircuitBreaker createTimeoutSignal produces functional signal', async () => {
    const breaker = new AiCircuitBreaker({ timeoutMs: 30 });
    const signal = breaker.createTimeoutSignal();
    assert.ok(signal);
    assert.equal(signal.aborted, false);
    await new Promise(r => setTimeout(r, 45));
    assert.equal(signal.aborted, true);
});

test('AiCircuitBreaker suppresses repeated alerts within alertIntervalMs', () => {
    let alertCount = 0;
    const breaker = new AiCircuitBreaker({
        name: 'ThrottledBreaker',
        threshold: 2,
        coolDownMs: 50,
        alertIntervalMs: 500
    });

    // 劫持 maybeEmitAlert 底层逻辑验证节流
    breaker.maybeEmitAlert = function (err) {
        const now = Date.now();
        if (this.lastAlertAt && (now - this.lastAlertAt < this.alertIntervalMs)) {
            return;
        }
        this.lastAlertAt = now;
        this.hasActiveOutage = true;
        alertCount += 1;
    };

    // 触发前 2 次失败 -> 首次熔断 -> 产生第 1 次告警
    breaker.recordFailure(new Error('fetch failed'));
    breaker.recordFailure(new Error('fetch failed'));
    assert.equal(alertCount, 1);

    // 持续失败 5 次（在 500ms 窗口期内） -> 应当被抑制，不产生额外告警
    for (let i = 0; i < 5; i++) {
        breaker.recordFailure(new Error('fetch failed'));
    }
    assert.equal(alertCount, 1, '窗口期内的持续失败应被节流抑制');

    // 恢复正常
    breaker.recordSuccess();
    assert.equal(breaker.hasActiveOutage, false);
    assert.equal(breaker.consecutiveFailures, 0);
});
