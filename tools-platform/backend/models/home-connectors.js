// Safe readiness summaries for the two existing Skill-backed home connectors.
// Configuration, login output and credentials never leave this module.
const runner = require('./channels/welink-cli-runner');
const digitalHuman = require('./digital-human/config-repository');
const SKILLS = Object.freeze({ 'welink-cli': 'welink-office', netcare: 'netcare-data' });

function createStatusReader({ cli = runner, digital = digitalHuman, now = Date.now } = {}) {
    let cliCache = null;
    async function cliStatus() {
        if (!cli.tenantAllowed()) return { ready: false, reason: 'tenant' };
        const config = cli.readConfig();
        if (!config.enabled) return { ready: false, reason: 'disabled' };
        const key = JSON.stringify([config.updatedAt, config.cliPath, config.env]);
        if (!cliCache || cliCache.key !== key || cliCache.until <= now()) {
            const entry = { key, until: Infinity };
            entry.promise = (async () => {
                try {
                    if (!(await cli.detect()).available) return { ready: false, reason: 'not-installed' };
                    const auth = await cli.authStatus();
                    return auth.loggedIn === true ? { ready: true, reason: '' } : { ready: false, reason: 'login' };
                } catch { return { ready: false, reason: 'offline' }; }
                finally { entry.until = now() + 30000; }
            })();
            cliCache = entry;
        }
        return cliCache.promise;
    }
    async function netcareStatus() {
        try {
            const config = await digital.getConfig();
            if (!config.enabled) return { ready: false, reason: 'disabled' };
            if (!config.baseQueryUrl || !config.appUuid || !config.businessDatasourceName || !config.businessSchema) return { ready: false, reason: 'unconfigured' };
            if (config.lastTest?.ok !== true) return { ready: false, reason: 'untested' };
            return { ready: true, reason: '' };
        } catch { return { ready: false, reason: 'error' }; }
    }
    return async (user, only) => {
        const ids = Object.hasOwn(SKILLS, only) ? [only] : Object.keys(SKILLS);
        if (user?.role !== 'admin') return ids.map(id => ({ id, ready: false, reason: 'forbidden' }));
        return Promise.all(ids.map(async id => ({ id, ...await (id === 'welink-cli' ? cliStatus() : netcareStatus()) })));
    };
}
module.exports = { SKILLS, createStatusReader, status: createStatusReader() };
