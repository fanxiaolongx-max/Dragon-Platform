// Images used by AI reports (logos now, cell pictures later): uploaded files and AI-drawn SVGs, kept per tenant so a
// report can switch back to any earlier one. Older monthly-template logos are listed too, read-only.
const crypto = require('node:crypto');
const { run, get, all } = require('./app-db');
const { getTenantId } = require('./tenant-context');

const MAX_BYTES = 5 * 1024 * 1024;
const readyByTenant = new Map();

function ready() {
    const tenant = getTenantId();
    if (!readyByTenant.has(tenant)) {
        readyByTenant.set(tenant, run(`CREATE TABLE IF NOT EXISTS ai_report_images (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, source TEXT NOT NULL,
            prompt TEXT, created_at TEXT NOT NULL, created_by TEXT)`)
            .then(async () => {
                await run(`CREATE TABLE IF NOT EXISTS ai_report_image_deletions (
                    id TEXT PRIMARY KEY, images_json TEXT NOT NULL, requested_by TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
                await run(`CREATE TABLE IF NOT EXISTS ai_report_image_hidden (
                    image_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, deleted_at TEXT NOT NULL, deleted_by TEXT NOT NULL)`);
                // One state update atomically applies the exact reviewed set. Existing report URLs keep working.
                await run(`CREATE TRIGGER IF NOT EXISTS ai_report_image_confirm_delete AFTER UPDATE OF state ON ai_report_image_deletions
                    WHEN OLD.state='pending' AND NEW.state='confirmed' BEGIN
                    INSERT OR REPLACE INTO ai_report_image_hidden(image_id,proposal_id,deleted_at,deleted_by)
                    SELECT json_extract(value,'$.id'),NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.requested_by
                    FROM json_each(NEW.images_json); END`);
                await run(`CREATE TRIGGER IF NOT EXISTS ai_report_image_restore_delete AFTER UPDATE OF state ON ai_report_image_deletions
                    WHEN OLD.state='confirmed' AND NEW.state='restored' BEGIN
                    DELETE FROM ai_report_image_hidden WHERE proposal_id=NEW.id; END`);
            }).catch(error => { readyByTenant.delete(tenant); throw error; }));
    }
    return readyByTenant.get(tenant);
}

const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };

// SVG is accepted only as plain vector drawing: no scripts, event handlers, external links, embedded documents or images.
const UNSAFE_SVG = /<script|<foreignObject|<iframe|<object|<embed|<image\b|\bon[a-z]+\s*=|javascript:|data:text\/html|(?:xlink:)?href\s*=\s*["'](?!#)/i;
function checkSvg(text) {
    const svg = String(text || '').trim().replace(/^<\?xml[^>]*>\s*/i, '');
    if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) fail('SVG 图片格式不正确');
    if (UNSAFE_SVG.test(svg)) fail('SVG 里有脚本、外部链接或嵌入内容，出于安全考虑不能使用');
    if (Buffer.byteLength(svg) > 400 * 1024) fail('SVG 图片太大');
    return svg;
}
function sniff(bytes, name = '') {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString('latin1'))) return 'image/gif';
    if (/\.svg$/i.test(name) || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0, 512).toString('utf8'))) return 'image/svg+xml';
    return '';
}

async function save({ bytes, name = '图片', source = 'upload', prompt = '', user = '' }) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) fail('没有收到图片');
    if (bytes.length > MAX_BYTES) fail('图片不能超过 5MB');
    const mime = sniff(bytes, name);
    if (!mime) fail('只支持 PNG、JPEG、WebP、GIF 或 SVG 图片');
    const body = mime === 'image/svg+xml' ? Buffer.from(checkSvg(bytes.toString('utf8'))) : bytes;
    await ready();
    const id = crypto.randomUUID(), time = new Date().toISOString();
    await run('INSERT INTO ai_report_images (id, name, mime, bytes, source, prompt, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, String(name).slice(0, 200) || '图片', mime, body, source === 'ai' ? 'ai' : 'upload', String(prompt || '').slice(0, 4000), time, String(user || '').slice(0, 120)]);
    return { id, name: String(name).slice(0, 200), mime, source, url: `/api/ai-report/images/${id}`, createdAt: time };
}

async function list(legacyLogos = []) {
    await ready();
    const rows = await all('SELECT id, name, mime, source, prompt, created_at FROM ai_report_images ORDER BY created_at DESC,id DESC');
    const own = rows.map(row => ({ id: row.id, name: row.name, mime: row.mime, source: row.source, prompt: row.prompt || '', url: `/api/ai-report/images/${row.id}`, createdAt: row.created_at }));
    const legacy = legacyLogos.map(logo => ({ id: `logo-${logo.id}`, name: logo.name, mime: 'image/png', source: 'monthly-logo', prompt: '', url: `/api/upload/monthly-logos/${encodeURIComponent(logo.id)}/image`, createdAt: logo.created_at }));
    return [...own, ...legacy];
}

async function read(id) {
    if (typeof id !== 'string' || !/^[-\w]{1,80}$/.test(id)) fail('Invalid image ID');
    await ready();
    const row = await get('SELECT mime, bytes FROM ai_report_images WHERE id = ?', [id]);
    if (!row) fail('Image not found', 404);
    return row;
}

async function visible(items) {
    await ready();
    const hidden = new Set((await all('SELECT image_id FROM ai_report_image_hidden')).map(row=>row.image_id));
    return items.filter(item=>!hidden.has(item.id));
}
async function deletion(id, owner) {
    await ready();
    const row = await get('SELECT * FROM ai_report_image_deletions WHERE id=? AND requested_by=?',[String(id||''),String(owner)]);
    if(!row) fail('删除确认记录不存在',404);
    return { id:row.id, images:JSON.parse(row.images_json), status:row.state, expiresAt:row.expires_at };
}
async function proposeDeletion(items, owner) {
    await ready();
    const unique=[...new Map(items.map(item=>[item.id,item])).values()];
    if(!unique.length) fail('请先选择要删除的图片');
    if(unique.length>500) fail('一次最多确认500张图片，请按页或进一步限定范围');
    const id=crypto.randomUUID(),time=new Date(),expiresAt=new Date(time.getTime()+15*60*1000).toISOString();
    const snapshots=unique.map(({id,url,name,source})=>({id,url,name,source}));
    await run("UPDATE ai_report_image_deletions SET state='cancelled' WHERE requested_by=? AND state='pending'",[String(owner)]);
    await run('INSERT INTO ai_report_image_deletions(id,images_json,requested_by,created_at,expires_at) VALUES(?,?,?,?,?)',
        [id,JSON.stringify(snapshots),String(owner),time.toISOString(),expiresAt]);
    return {id,images:snapshots,status:'pending',expiresAt};
}
async function changeDeletion(id,owner,operation) {
    const before=await deletion(id,owner);
    const states={confirm:['pending','confirmed'],cancel:['pending','cancelled'],restore:['confirmed','restored']};
    const pair=states[operation];if(!pair) fail('未知删除操作');
    if(before.status===pair[1])return before;
    if(before.status!==pair[0])fail('这份删除确认已失效，请重新选择图片',409);
    if(operation==='confirm' && before.expiresAt<=new Date().toISOString())fail('删除确认已过期，请重新选择图片',410);
    await run('UPDATE ai_report_image_deletions SET state=? WHERE id=? AND requested_by=? AND state=?'+
        (operation==='confirm'?' AND expires_at>?':''),[pair[1],id,String(owner),pair[0],...(operation==='confirm'?[new Date().toISOString()]:[])]);
    const result=await deletion(id,owner);
    if(result.status!==pair[1])fail('删除状态已改变，请重新确认',409);
    return result;
}
module.exports = { save, list, read, checkSvg, visible, deletion, proposeDeletion, changeDeletion };
