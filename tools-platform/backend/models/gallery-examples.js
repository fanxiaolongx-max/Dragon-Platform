const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const catalog = require('./gallery-example-catalog');
const { getDataDir } = require('./tenant-context');
const pending = new Map();
const derivatives = new Map();
const derivativeKinds = ['preview','balanced','precise'];
const cacheDirectory = () => path.join(getDataDir(),'runtime','gallery-examples');
async function writeCache(filename, bytes) {
    await fs.mkdir(path.dirname(filename),{recursive:true});
    const temporary = filename+'.'+crypto.randomUUID()+'.tmp';
    try { await fs.writeFile(temporary,bytes); await fs.rename(temporary,filename); }
    finally { await fs.rm(temporary,{force:true}); }
}
async function readOriginal(filename, meta) {
    try {
        const bytes=await fs.readFile(filename);
        if(bytes.length===meta.size && catalog.digest(bytes)===meta.sha256)return bytes;
    } catch(error) { if(error.code!=='ENOENT')throw error; }
}

// Installation receipts survive trash/edits and prevent examples reappearing on startup.
async function seed(db, { adoptExisting = false } = {}) {
    await db.execute('CREATE TABLE IF NOT EXISTS gallery_example_versions (example_key TEXT PRIMARY KEY, version_id TEXT NOT NULL)');
    const source = catalog.read(), albums = new Map();
    for (const album of source.albums) {
        await db.execute('INSERT OR IGNORE INTO gallery_albums(id,name,created_at) VALUES(?,?,?)',[album.id,album.name,new Date().toISOString()]);
        albums.set(album.id,(await db.get('SELECT id FROM gallery_albums WHERE name=? COLLATE NOCASE',[album.name])).id);
    }
    for (const item of source.items) {
        for (const [index,v] of item.versions.entries()) {
            const meta = catalog.asset(v.file);
            const receipt = await db.get('SELECT version_id FROM gallery_example_versions WHERE example_key=?',[v.file]);
            const existing = receipt ? await db.get('SELECT id FROM gallery_versions WHERE id=?',[receipt.version_id])
                : await db.get('SELECT id FROM gallery_versions WHERE sha256=? ORDER BY created_at LIMIT 1',[meta.sha256]);
            if (existing) {
                if (adoptExisting) await db.execute('UPDATE gallery_versions SET example_key=? WHERE id=?',[v.file,existing.id]);
                await db.execute('INSERT OR IGNORE INTO gallery_example_versions VALUES(?,?)',[v.file,existing.id]);
                continue;
            }
            if (receipt) continue;
            await db.execute(`INSERT OR IGNORE INTO gallery_items(id,title,scope,category_id,album_id,tags_json,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
                [item.id,item.title,item.scope,item.categoryId,albums.get(item.albumId)||'',JSON.stringify(item.tags),item.note,item.createdAt,item.createdAt]);
            await db.execute(`INSERT INTO gallery_versions(id,item_id,version_no,label,filename,mime,original,thumbnail,preview,ai_balanced,ai_precise,width,height,sha256,ai_status,ai_mode,ai_json,created_at,example_key)
                VALUES(?,?,?,?,?,?,X'',X'',X'',X'',X'',?,?,?,?,?,?,?,?)`,
                [v.id,item.id,index+1,v.label,v.filename,meta.mime,meta.width,meta.height,meta.sha256,'ready',v.aiMode||'balanced',JSON.stringify(v.analysis),item.createdAt,v.file]);
            await db.execute('INSERT INTO gallery_example_versions VALUES(?,?)',[v.file,v.id]);
        }
    }
}

async function fetchOriginal(key, fetcher = fetch) {
    const meta = catalog.asset(key);
    let url = meta.url;
    for (let redirects = 0; redirects < 6; redirects++) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname)) throw Error('Invalid media redirect');
        const response = await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});
        if ([301,302,303,307,308].includes(response.status)) { await response.body?.cancel(); url = new URL(response.headers.get('location'),url).href; continue; }
        if (!response.ok) { await response.body?.cancel(); throw Error('Media unavailable'); }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > meta.size) throw Error('Media too large'); chunks.push(Buffer.from(chunk)); }
        const bytes = Buffer.concat(chunks);
        if (size !== meta.size || catalog.digest(bytes) !== meta.sha256) throw Error('Media checksum mismatch');
        return bytes;
    }
    throw Error('Too many media redirects');
}
async function original(key, {fetcher, cacheDir = cacheDirectory()} = {}) {
    const meta = catalog.asset(key), filename = path.join(cacheDir,meta.sha256);
    if (pending.has(filename)) return pending.get(filename);
    const job = (async () => {
        const cached = await readOriginal(filename,meta);
        if (cached) return cached;
        // Keep already downloaded originals when moving out of the temporary directory.
        const legacy = cacheDir===cacheDirectory() && await readOriginal(path.join(getDataDir(),'tmp','gallery-examples',meta.sha256),meta);
        if (legacy) { await writeCache(filename,legacy); return legacy; }
        const bytes = await fetchOriginal(key,fetcher);
        await writeCache(filename,bytes);
        return bytes;
    })();
    pending.set(filename,job);
    try { return await job; } catch (_) { throw Object.assign(Error('示例原图暂不可用，请联网后重试；缩略图仍可查看'),{status:503}); }
    finally { pending.delete(filename); }
}
function derivativePath(key, kind, directory) {
    return path.join(directory,`${catalog.asset(key).sha256}.derivatives-v1.${kind}`);
}
async function readDerivative(filename) {
    try {
        const stored = await fs.readFile(filename), bytes = stored.subarray(32);
        if (bytes.length>3 && bytes[0]===255 && bytes[1]===216 && stored.subarray(0,32).toString('hex')===catalog.digest(bytes)) return bytes;
    } catch(error) { if(error.code!=='ENOENT')throw error; }
}
async function asset(key, kind, options = {}) {
    if (kind === 'thumbnail') return {bytes:catalog.thumbnail(key),mime:'image/jpeg'};
    if (kind === 'original') return {bytes:await original(key,options),mime:catalog.asset(key).mime};
    if (!derivativeKinds.includes(kind)) throw Object.assign(Error('图片类型不存在'),{status:404});
    const directory=options.cacheDir||cacheDirectory(), filename=derivativePath(key,kind,directory);
    const cached=await readDerivative(filename);
    if (cached) return {bytes:cached,mime:'image/jpeg'};
    const jobKey=derivativePath(key,'all',directory);
    if (!derivatives.has(jobKey)) {
        const job=(async()=> {
            const processed = await require('./gallery-service').compress(await original(key,options));
            for (const name of derivativeKinds) {
                const bytes=processed[name];
                await writeCache(derivativePath(key,name,directory),Buffer.concat([Buffer.from(catalog.digest(bytes),'hex'),bytes]));
            }
            return processed;
        })();
        derivatives.set(jobKey,job);
        job.finally(()=>{if(derivatives.get(jobKey)===job)derivatives.delete(jobKey);}).catch(()=>{});
    }
    const processed = await derivatives.get(jobKey);
    return {bytes:processed[kind],mime:'image/jpeg'};
}
module.exports = {seed,asset,original,fetchOriginal,cacheDirectory};
