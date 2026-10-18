'use strict';
const { cachedReader } = require('./quota-common');
const { readCodexQuota } = require('./codex-quota');
const { readClaudeQuota } = require('./claude-quota');
const { createAntigravityReader } = require('./antigravity-quota');

const fetchAntigravityQuota = cachedReader('antigravity',createAntigravityReader());
const fetchCodexQuota = cachedReader('codex',readCodexQuota);
const fetchClaudeQuota = cachedReader('claudecode',readClaudeQuota,120000);
async function checkAntigravityAlive() {
    return (await fetchAntigravityQuota()).status === 'live';
}
async function detectAllQuotas(force = false) {
    const [antigravity,codex,claudecode] = await Promise.all([
        fetchAntigravityQuota(force),fetchCodexQuota(force),fetchClaudeQuota(force)
    ]);
    return { antigravity,codex,claudecode,hasAny:[antigravity,codex,claudecode].some(q=>q.active),timestamp:Date.now() };
}
module.exports = { checkAntigravityAlive,fetchAntigravityQuota,fetchCodexQuota,fetchClaudeQuota,detectAllQuotas };
