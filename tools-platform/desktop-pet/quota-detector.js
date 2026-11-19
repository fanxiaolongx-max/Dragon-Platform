'use strict';
const { cachedReader } = require('./quota-common');
const { readCodexQuota } = require('./codex-quota');
const { readClaudeQuota } = require('./claude-quota');
const { createAntigravityReader } = require('./antigravity-quota');

const fetchAntigravityQuota = cachedReader('antigravity',createAntigravityReader());
const fetchCodexQuota = cachedReader('codex',readCodexQuota);
const claudeRetry = {};
const fetchClaudeQuota = cachedReader('claudecode', () => readClaudeQuota({ retry: claudeRetry }), 120000);
const readers = { antigravity: fetchAntigravityQuota, codex: fetchCodexQuota, claudecode: fetchClaudeQuota };
async function checkAntigravityAlive() {
    return (await fetchAntigravityQuota()).status === 'live';
}
async function detectAllQuotas(force = false, providers = Object.keys(readers)) {
    const entries = await Promise.all(providers.map(async id => [id, await readers[id](force)]));
    return { ...Object.fromEntries(entries), hasAny: entries.some(([, quota]) => quota.active), timestamp: Date.now() };
}
module.exports = { checkAntigravityAlive,fetchAntigravityQuota,fetchCodexQuota,fetchClaudeQuota,detectAllQuotas };
