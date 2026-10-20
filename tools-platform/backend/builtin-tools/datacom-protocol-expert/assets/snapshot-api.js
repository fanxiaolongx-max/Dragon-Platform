// 发布快照的数据适配器：只读数据与平台 API 保持同样的目录、文章和搜索响应。
export function createSnapshotApi(snapshot, fetchData = globalThis.fetch) {
    let pending;
    const fail = (message, status, code) => Object.assign(new Error(message), { status, code });
    function load() {
        if (!pending) {
            pending = (async () => {
                if (snapshot.data) return snapshot.data;
                const response = await fetchData(snapshot.url, { cache: 'no-store' });
                if (!response.ok) throw new Error(`快照数据读取失败 (${response.status})`);
                return response.json();
            })().catch(error => { pending = null; throw error; });
        }
        return pending;
    }
    return async (path = '', { method = 'GET', body } = {}) => {
        const url = new URL(path || '/', 'https://snapshot.invalid');
        if (url.pathname === '/preference') {
            return {
                preference: {
                    navWidth: Number(body?.navWidth) || 290,
                    navCollapsed: Boolean(body?.navCollapsed),
                    payload: {},
                    updatedAt: null
                }
            };
        }
        if (method.toUpperCase() !== 'GET') throw fail('只读快照，请返回平台修改知识库', 403, 'READ_ONLY_SNAPSHOT');
        const data = await load();
        if (url.pathname === '/') {
            return {
                ...data,
                articles: data.articles.map(({ bodyMd, ...article }) => article),
                canWrite: false, username: '', databaseFile: 'datacom-knowledge.db'
            };
        }
        if (url.pathname === '/search') {
            const keyword = (url.searchParams.get('q') || '').trim().slice(0, 80).toLowerCase();
            if (!keyword) return { results: [] };
            const contains = value => String(value || '').toLowerCase().includes(keyword);
            const results = data.articles.map(article => {
                const title = contains(article.title);
                const summary = [article.summary, JSON.stringify(article.tags), JSON.stringify(article.keyPoints)].some(contains);
                const body = contains(article.bodyMd);
                if (!title && !summary && !body) return null;
                const text = article.bodyMd.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`|]/g, ' ').replace(/\s+/g, ' ');
                const index = text.toLowerCase().indexOf(keyword);
                return {
                    id: article.id, title: article.title, categoryId: article.categoryId, summary: article.summary,
                    score: (title ? 3 : 0) + (summary ? 2 : 0) + (body ? 1 : 0), sort: article.sort,
                    snippet: index < 0 ? text.slice(0, 120) : `${index > 40 ? '…' : ''}${text.slice(Math.max(0, index - 40), index + keyword.length + 80)}…`
                };
            }).filter(Boolean).sort((a, b) => b.score - a.score || a.sort - b.sort).slice(0, 40);
            return { results };
        }
        const match = /^\/articles\/([^/]+)$/.exec(url.pathname);
        const article = match && data.articles.find(item => item.id === decodeURIComponent(match[1]));
        if (article) return { article };
        throw fail('文章不存在或该操作不支持只读快照', 404, 'DATACOM_NOT_FOUND');
    };
}
