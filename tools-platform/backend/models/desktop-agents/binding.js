// Device-to-account authorization is control-plane state. Conversation content
// never enters the platform database or another tenant's business database.
const platform = require('../platform-db');
const { getTenantId } = require('../tenant-context');
const os = require('node:os'), crypto = require('node:crypto');
const device = () => crypto.createHash('sha256').update(process.env.TOOLS_DESKTOP_AGENT_HOME || os.homedir()).digest('hex');
let ready;
async function ensure() { if (!ready)
    ready = platform.run('CREATE TABLE IF NOT EXISTS desktop_agent_host_bindings (device TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner TEXT NOT NULL)').catch(e => { ready = null; throw e; }); return ready; }
async function available(owner) { await ensure(); const row = await platform.get('SELECT tenant_id,owner FROM desktop_agent_host_bindings WHERE device=?', [device()]); return !row || row.tenant_id === getTenantId() && row.owner === owner; }
async function matches(owner) { await ensure(); return !!await platform.get('SELECT device FROM desktop_agent_host_bindings WHERE device=? AND tenant_id=? AND owner=?', [device(), getTenantId(), owner]); }
async function claim(owner) { await ensure(); await platform.run('INSERT OR IGNORE INTO desktop_agent_host_bindings(device,tenant_id,owner) VALUES(?,?,?)', [device(), getTenantId(), owner]); return matches(owner); }
async function release(owner) { await ensure(); await platform.run('DELETE FROM desktop_agent_host_bindings WHERE device=? AND tenant_id=? AND owner=?', [device(), getTenantId(), owner]); }
module.exports = { available, matches, claim, release };
