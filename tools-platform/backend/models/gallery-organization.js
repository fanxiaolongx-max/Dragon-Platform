const crypto = require('node:crypto');
const transaction = require('./gallery-transaction');

// Metadata and version moves commit together; deleted/changed images are never resurrected by AI.
async function apply(versionId, analysis, { versionLabelLocked = false } = {}) {
    const repo = require('./gallery-repository');
    await repo.init();
    const result = await transaction(async db => {
        const version = await db.get('SELECT id,item_id,label,sha256 FROM gallery_versions WHERE id=?',[versionId]);
        if (!version) throw repo.fail('图片版本不存在',404);
        const source = await db.get('SELECT * FROM gallery_items WHERE id=?',[version.item_id]);
        if (!source || source.deleted_at || source.archived) throw repo.fail('图片已归档或删除，未应用 AI 修改',409);
        const sourceLocks = new Set(repo.manualFields(source.manual_fields_json));
        let target = source, storage = 'separate', warning = '';
        if (!sourceLocks.has('storage') && analysis.storageMode === 'version' && analysis.versionOf && analysis.confidence >= .9) {
            const candidate = await db.get("SELECT * FROM gallery_items WHERE id=? AND archived=0 AND deleted_at=''",[analysis.versionOf]);
            const { count } = await db.get('SELECT COUNT(*) AS count FROM gallery_versions WHERE item_id=?',[source.id]);
            const conflicts = candidate && ['title','scope','category_id','album_id','tags','note'].some(field => sourceLocks.has(field)
                && (field === 'tags' ? source.tags_json !== candidate.tags_json : source[field] !== candidate[field]));
            if (candidate && candidate.id !== source.id && count === 1 && !conflicts) {
                const duplicate = await db.get('SELECT id FROM gallery_versions WHERE item_id=? AND sha256=?',[candidate.id,version.sha256]);
                if (duplicate) {
                    // Keep the exact duplicate in the recoverable trash, including its metadata.
                    await db.execute('UPDATE gallery_items SET deleted_at=?,revision=revision+1 WHERE id=?',[new Date().toISOString(),source.id]);
                    return { itemId:candidate.id,versionId:duplicate.id,storageMode:'version',duplicate:true };
                }
                const { number } = await db.get('SELECT COALESCE(MAX(version_no),0)+1 AS number FROM gallery_versions WHERE item_id=?',[candidate.id]);
                await db.execute('UPDATE gallery_versions SET item_id=?,version_no=? WHERE id=?',[candidate.id,number,version.id]);
                await db.execute('DELETE FROM gallery_items WHERE id=?',[source.id]); // Its image bytes now belong to the target version history.
                target = candidate; storage = 'version';
            } else warning = '无法确认版本关系，已保留为独立图片';
        }
        const locks = new Set(repo.manualFields(target.manual_fields_json));
        let category = target.category_id, album = target.album_id;
        if (!locks.has('category_id')) {
            const existing = analysis.categoryId && await db.get('SELECT id FROM gallery_categories WHERE id=?',[analysis.categoryId]);
            if (existing) category = existing.id;
            else if (analysis.suggestedCategory) {
                await db.execute('INSERT OR IGNORE INTO gallery_categories(id,name) VALUES(?,?)',[crypto.randomUUID(),analysis.suggestedCategory]);
                category = (await db.get('SELECT id FROM gallery_categories WHERE name=? COLLATE NOCASE',[analysis.suggestedCategory])).id;
            }
        }
        if (storage !== 'version' && !locks.has('storage') && !locks.has('album_id') && (analysis.storageMode === 'album' || analysis.albumName || analysis.albumId)) {
            const existing = analysis.albumId && await db.get('SELECT id FROM gallery_albums WHERE id=?',[analysis.albumId]);
            if (existing) album = existing.id;
            else if (analysis.albumName) {
                await db.execute('INSERT OR IGNORE INTO gallery_albums(id,name,created_at) VALUES(?,?,?)',[crypto.randomUUID(),analysis.albumName,new Date().toISOString()]);
                album = (await db.get('SELECT id FROM gallery_albums WHERE name=? COLLATE NOCASE',[analysis.albumName])).id;
            }
        }
        if (album && storage !== 'version') storage = 'album';
        const value = (field,suggested) => locks.has(field) || !suggested ? target[field] : suggested;
        await db.execute(`UPDATE gallery_items SET title=?,scope=?,category_id=?,album_id=?,tags_json=?,note=?,revision=revision+1,updated_at=? WHERE id=?`,[
            value('title',analysis.title),value('scope',analysis.scope),category,album,
            locks.has('tags') ? target.tags_json : JSON.stringify(analysis.tags || []),value('note',analysis.note || analysis.summary),new Date().toISOString(),target.id
        ]);
        if (!versionLabelLocked && !version.label && analysis.versionLabel) await db.execute('UPDATE gallery_versions SET label=? WHERE id=?',[analysis.versionLabel,version.id]);
        return {itemId:target.id,versionId:version.id,storageMode:storage,warning};
    });
    return { ...result,item:await repo.read(result.itemId),version:await repo.readVersion(result.versionId) };
}
module.exports = { apply };
