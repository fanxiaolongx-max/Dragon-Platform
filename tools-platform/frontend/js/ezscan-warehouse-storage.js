(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.EzscanWarehouseStorage = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const API = '/api/custom-tools/tool-mv9strpn/warehouse';

    function create(options = {}) {
        const fetcher = options.fetch || globalThis.fetch.bind(globalThis);
        const validate = options.validate || (() => {});
        const onChange = options.onChange || (() => {});
        const delay = options.debounceMs ?? 450;
        let timer = null, active = null, snapshot = null, generation = 0;
        const state = {
            loaded: false, loading: false, canWrite: false, initialized: false,
            pending: false, saving: false, conflict: false, error: '',
            revision: 0, updatedAt: null, tenantId: null, username: '', databaseFile: 'ezscan-warehouse.db'
        };
        const status = () => ({ ...state });
        const emit = () => onChange(status());
        function headers(json = false) {
            const result = json ? { 'Content-Type': 'application/json' } : {};
            // Authentication is shared with the platform; never persist business data here.
            try {
                const token = globalThis.localStorage?.getItem('tools_token');
                if (token) result.Authorization = 'Bearer ' + token;
            } catch (_) {}
            return result;
        }
        async function request(url, init = {}, blob = false) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
            try {
                const response = await fetcher(url, { ...init, credentials: 'same-origin', cache: 'no-store', headers: headers(Boolean(init.body)), signal: controller.signal });
                if (response.ok && blob) return response.blob();
                const payload = await response.json().catch(() => null);
                if (!response.ok) {
                    const error = new Error(response.status === 401 ? '登录已失效，请重新登录后重试' : response.status === 403 ? '当前账号没有仓储写入权限' : response.status === 409 ? '服务器数据已被其他窗口更新，请先导出当前修改，再重新加载' : payload?.error || payload?.message || '服务器请求失败，请重试');
                    error.status = response.status;
                    error.code = payload?.code;
                    throw error;
                }
                if (!payload || typeof payload !== 'object') throw new Error('服务器返回无效数据');
                return payload;
            } catch (error) {
                if (error.name === 'AbortError') throw new Error('服务器响应超时，修改尚未保存，请重试或导出备份');
                throw error;
            } finally { clearTimeout(timeout); }
        }
        async function load() {
            if (active || state.pending) throw new Error('请先处理尚未保存的修改');
            state.loading = true;
            state.error = '';
            emit();
            try {
                const payload = await request(API);
                if (!Number.isSafeInteger(payload.revision) || payload.revision < 0 || typeof payload.canWrite !== 'boolean' || typeof payload.tenantId !== 'string' || !Object.hasOwn(payload, 'data')) throw new Error('服务器返回无效数据');
                if (payload.data !== null) validate(payload.data);
                Object.assign(state, { loaded: true, canWrite: payload.canWrite, initialized: payload.data !== null, revision: payload.revision, updatedAt: payload.updatedAt, tenantId: payload.tenantId, username: payload.username || '', conflict: false, error: '' });
                return payload.data;
            } catch (error) { state.error = error.message || '无法连接仓储服务器'; throw error; }
            finally { state.loading = false; emit(); }
        }
        function enqueue(data) {
            if (!state.loaded || state.loading || !state.canWrite || state.conflict) return false;
            snapshot = JSON.parse(JSON.stringify(data));
            generation++;
            state.pending = true;
            emit();
            clearTimeout(timer);
            if (!state.error && !active) timer = setTimeout(() => { timer = null; void flush(); }, delay);
            return true;
        }
        async function saveLoop() {
            while (state.pending && state.canWrite && !state.conflict) {
                const data = snapshot, sentGeneration = generation;
                state.saving = true;
                emit();
                try {
                    validate(data);
                    const payload = await request(API, { method: 'PUT', body: JSON.stringify({ data, revision: state.revision, tenantId: state.tenantId }) });
                    if (payload.success !== true || !Number.isSafeInteger(payload.revision) || payload.revision !== state.revision + 1) throw new Error('服务器未确认保存，请重试或导出备份');
                    Object.assign(state, { revision: payload.revision, updatedAt: payload.updatedAt, initialized: true, error: '' });
                    if (sentGeneration === generation) { state.pending = false; snapshot = null; }
                } catch (error) {
                    state.error = error.message || '服务器保存失败，请重试或导出备份';
                    if (error.status === 409 || error.code === 'WAREHOUSE_REVISION_CONFLICT') state.conflict = true;
                    if (error.status === 401 || error.status === 403) state.canWrite = false;
                    return false;
                } finally { state.saving = false; emit(); }
            }
            return !state.pending;
        }
        async function flush() {
            clearTimeout(timer); timer = null;
            if (active) return active;
            if (!state.pending) return state.loaded && !state.error;
            if (!state.canWrite || state.conflict || state.error) return false;
            active = saveLoop();
            try { return await active; }
            finally { active = null; }
        }
        async function retry() {
            if (state.conflict) return false;
            // Re-check access after an expired session without discarding pending edits.
            if (!state.canWrite && state.pending) {
                try {
                    const payload = await request(API);
                    if (payload.revision !== state.revision || payload.tenantId !== state.tenantId) { state.conflict = true; state.error = '服务器数据已被其他窗口更新，请先导出当前修改，再重新加载'; emit(); return false; }
                    state.canWrite = payload.canWrite === true;
                } catch (error) { state.error = error.message; emit(); return false; }
            }
            state.error = '';
            emit();
            return flush();
        }
        async function downloadDatabase() {
            try { return await request(API + '/database?tenantId=' + encodeURIComponent(state.tenantId), {}, true); }
            catch (error) {
                if (error.status === 409) { state.conflict = true; state.error = error.message; emit(); }
                throw error;
            }
        }
        async function modifySamples(action) {
            if (!state.loaded || state.loading || !state.canWrite || state.conflict || !await flush()) throw new Error('请先处理尚未保存的修改或权限问题');
            if (state.loading || state.pending || !state.canWrite || state.conflict) throw new Error('正在处理另一项操作，请稍后重试');
            state.loading = true;
            emit();
            try {
                const payload = await request(API + '/sample-data', { method: 'POST', body: JSON.stringify({ action, revision: state.revision, tenantId: state.tenantId }) });
                if (!payload.success || !Number.isSafeInteger(payload.revision) || !payload.data) throw new Error('服务器未确认测试数据操作');
                validate(payload.data);
                Object.assign(state, { revision: payload.revision, updatedAt: payload.updatedAt, initialized: true, error: '' });
                return payload.data;
            } catch (error) {
                state.error = error.message;
                if (error.status === 409) state.conflict = true;
                if (error.status === 401 || error.status === 403) state.canWrite = false;
                throw error;
            } finally { state.loading = false; emit(); }
        }
        return { load, enqueue, flush, retry, downloadDatabase, modifySamples, getStatus: status };
    }
    return { create };
}));
