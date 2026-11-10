const { isSuperAdmin } = require('../middleware/auth');

const MAX_BYTES = 8 * 1024 * 1024;
const categories = { skill: '技能发布申请', tool: '工具更新申请', cap: '插件与脚本更新申请' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: 'CATALOG_UPDATE_INVALID' });

function readAttachment(file, formats) {
    const name = typeof file?.name === 'string' ? file.name.trim() : '';
    const extension = name.toLowerCase().split('.').pop();
    if (!name.includes('.') || name.length > 160 || /[\\/\x00-\x1f\x7f]/.test(name) || !formats.includes(extension)) {
        throw fail('请选择支持的更新文件');
    }
    if (typeof file.data !== 'string' || file.data.length > 4 * Math.ceil(MAX_BYTES / 3)) throw fail('更新文件不能超过 8 MB', 413);
    const bytes = Buffer.from(file.data, 'base64');
    if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== file.data) throw fail('更新文件内容无效');
    if (extension === 'zip' && !bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) throw fail('请选择有效的 ZIP 文件');
    return { name, extension, bytes };
}

async function prepare(body, user) {
    const { kind, id, file } = body || {};
    if (typeof kind !== 'string' || !Object.hasOwn(categories, kind) || typeof id !== 'string' || !id || id.length > 350) throw fail('更新条目无效');

    if (kind === 'skill') {
        const store = require('./agent-skills-store');
        if (!file) {
            const snapshot = await store.publicationSnapshot(id, user);
            if (!snapshot) throw fail('请先保存你的技能版本，或上传技能文件', 404);
            return { kind, snapshot };
        }
        const skill = (await store.listForUser(user)).find(item => item.id === id);
        if (!skill) throw fail('技能不存在或未开放', 404);
        const attachment = readAttachment(file, ['md', 'zip']);
        try {
            const parsed = attachment.extension === 'zip'
                ? await store.parseSkillArchive(attachment.bytes, { archiveName: attachment.name })
                : { markdown: attachment.bytes.toString('utf8'), files: (await store.withSkillForUser(id, user, () => store.getSkill(id)))?.files };
            const candidate = store.normalizeSkillMarkdown(parsed.markdown, { fallbackId: id });
            if (candidate.id !== id) throw fail('技能文件标识与所选技能不一致');
            // Use the same canonical Markdown representation as the existing publication flow.
            return { kind, snapshot: store.toPublicationSnapshot(candidate, parsed.files), attachment };
        } catch (error) {
            throw fail(error.message, error.status || error.statusCode || 400);
        }
    }

    let name;
    let formats;
    if (kind === 'cap') {
        const { groups } = await require('./home-capabilities').listCapabilities({ user });
        const item = groups.flatMap(group => group.items).find(entry => entry.id === id);
        if (!item) throw fail('插件或脚本不存在或未开放', 404);
        name = item.name;
        formats = item.badge === 'extension' ? ['zip'] : item.kind === 'python' ? ['py', 'zip'] : ['js', 'json', 'zip'];
    } else if (id.startsWith('custom:')) {
        const tool = (await require('./tool-distribution').listAvailable(user)).find(item => item.slug === id.slice(7));
        if (!tool) throw fail('工具不存在或未开放', 404);
        name = tool.name;
        formats = tool.hostedApp ? ['zip'] : ['html', 'htm', 'zip'];
    } else {
        const { PAGE_FILES } = require('./page-update-times');
        if (!Object.hasOwn(PAGE_FILES, id) || (!isSuperAdmin(user) && ['/storage', '/db-explorer', '/netcare-explorer'].includes(id))) {
            throw fail('工具不存在或未开放', 404);
        }
        name = id;
        formats = ['html', 'htm', 'zip', 'patch', 'diff'];
    }
    return { kind, snapshot: { id, name }, attachment: readAttachment(file, formats) };
}

module.exports = { categories, prepare };
