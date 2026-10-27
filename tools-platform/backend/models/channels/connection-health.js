// Public connection indicators: derive health without reconnecting or exposing errors/credentials.
function connectionHealth(status, now = Date.now()) {
    if (!status.connected) return ['connecting', 'starting', 'reconnecting'].includes(status.runtime?.state)
        ? { level: 'warning', reason: 'connecting' } : { level: 'error', reason: 'offline' };
    if (status.stale) return { level: 'warning', reason: 'stale' };
    const poll = Date.parse(status.lastPollAt);
    if (Number.isFinite(poll) && now - poll > 180000) return { level: 'warning', reason: 'delayed' };
    const error = Date.parse(status.lastError?.at);
    if (status.runtime?.failureReason || (Number.isFinite(error) && now - error < 300000 && (!Number.isFinite(poll) || error > poll))) {
        return { level: 'warning', reason: 'degraded' };
    }
    return { level: 'ok', reason: 'connected' };
}
module.exports = { connectionHealth };
