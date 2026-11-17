// 桌面批处理兜底：运行标签里真正下载完成的 CSV，补传给这次批处理的自动导入会话。
// 页面内的拦截（脚本里注入的上传）会因为站点刷新、登录跳转或站点安全策略而失效，
// 那时文件照样下载了，导入页却收不到。服务端按文件名去重：页面内已上传的不会重复。
'use strict';

const fs = require('fs');

const MAX_CSV_BYTES = 40 * 1024 * 1024;

// 与 UIVF12 下载拦截脚本里的解析保持一致，导入页拿到的行结构才相同
function parseCsvTable(text) {
    const normalized = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (inQuotes) {
            if (ch === '"' && normalized[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') inQuotes = false;
            else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch !== '\r') field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return {
        headers: (rows.shift() || []).map(header => String(header || '').trim()),
        values: rows.filter(values => values.some(value => String(value || '').trim() !== ''))
    };
}

function tableToRows({ headers, values }) {
    return values.map(row => {
        const record = {};
        headers.forEach((header, index) => { record[header || ('列' + (index + 1))] = row[index] !== undefined ? row[index] : ''; });
        return record;
    });
}

function pageOrigin(webContents) {
    try { return new URL(webContents.getURL()).origin; } catch { return ''; }
}

/** 监听运行标签的下载；返回停止函数，stop.settled() 等待已开始的补传结束 */
function forwardRunDownloads({ webContents, autoImport, baseUrl, post = (url, init) => fetch(url, init), onError = () => {} }) {
    const pending = new Set();
    const session = webContents && webContents.session;
    const stop = () => { if (session) session.removeListener('will-download', onDownload); };
    stop.settled = () => Promise.allSettled([...pending]);
    if (!session || !autoImport || !baseUrl) return stop;
    const url = new URL(`/api/uiv-auto-import/${autoImport.sessionId}/datasets`, baseUrl);
    url.searchParams.set('token', autoImport.token);

    async function forward(file, name, origin) {
        const { size } = await fs.promises.stat(file);
        if (!size || size > MAX_CSV_BYTES) return;
        const table = parseCsvTable(await fs.promises.readFile(file, 'utf8'));
        if (!table.values.length) return;
        const response = await post(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, rows: tableToRows(table), origin, fallback: true })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
    }
    function onDownload(_event, item, source) {
        if (source !== webContents) return;
        const name = item.getFilename();
        if (!/\.csv$/i.test(name)) return;
        const origin = pageOrigin(webContents);
        item.once('done', (_doneEvent, state) => {
            if (state !== 'completed') return;
            const job = forward(item.getSavePath(), name, origin)
                .catch(error => onError(name, error))
                .finally(() => pending.delete(job));
            pending.add(job);
        });
    }
    session.on('will-download', onDownload);
    return stop;
}

module.exports = { forwardRunDownloads, parseCsvTable, tableToRows };
