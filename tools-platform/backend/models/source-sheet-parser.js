// Server-side parsing for archived originals whose browser-side parsing never finished (e.g. the import page was
// closed after upload). Mirrors the import page (SheetJS sheet_to_json, raw:false, defval:''), then stores the
// sheets through the normal saveSheets path so table rules and quick metrics still apply.
const repo = require('./import-source-repository');

const pending = new Map();

function decode(buffer) {
    const bytes = Buffer.from(buffer);
    const utf8 = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
    const broken = (utf8.match(/�/g) || []).length;
    if (broken > Math.max(2, utf8.length / 200)) {
        try { return new TextDecoder('gb18030').decode(bytes).replace(/^﻿/, ''); } catch (_) { /* no GB support in this runtime */ }
    }
    return utf8;
}

// RFC 4180 CSV with quoted fields, doubled quotes and CRLF/LF; the delimiter is detected from the first line.
function parseCsv(text) {
    const firstLine = text.slice(0, text.search(/\r?\n|$/));
    const delimiter = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
            else if (char === '"') quoted = false;
            else field += char;
        } else if (char === '"' && field === '') quoted = true;
        else if (char === delimiter) { row.push(field); field = ''; }
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[index + 1] === '\n') index++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += char;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

// Header names follow SheetJS: blanks become __EMPTY, __EMPTY_1…; repeats get _1, _2….
function toSheet(name, matrix) {
    const blank = cells => cells.every(cell => String(cell ?? '').trim() === '');
    const lines = matrix.filter(cells => !blank(cells));
    if (!lines.length) return { name, headers: [], rows: [] };
    const seen = new Map();
    const headers = lines[0].map(cell => {
        const base = String(cell ?? '').trim() || '__EMPTY';
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        return count ? `${base}_${count}` : base;
    });
    const rows = lines.slice(1).map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] === undefined ? '' : String(cells[index])])));
    return { name, headers, rows };
}

async function parseWorkbook(file, buffer) {
    if (/\.(csv|txt)$/i.test(file.name)) return [toSheet('Sheet1', parseCsv(decode(buffer)))];
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer));
    return workbook.worksheets.map(sheet => {
        const matrix = [];
        sheet.eachRow({ includeEmpty: false }, row => {
            const cells = [];
            for (let column = 1; column <= sheet.columnCount; column++) cells.push(row.getCell(column).text ?? '');
            matrix.push(cells);
        });
        return toSheet(sheet.name, matrix);
    });
}

// Parses one pending file once (concurrent callers share the same work). Returns true when sheets were stored.
function parsePending(fileId) {
    if (!pending.has(fileId)) {
        pending.set(fileId, (async () => {
            const file = await repo.getFile(fileId, true);
            if (!file || file.parse_status === 'ready' || !file.original_blob) return false;
            try {
                await repo.saveSheets(fileId, await parseWorkbook(file, file.original_blob));
                console.log('[Source parser] parsed archived original', JSON.stringify({ fileId, name: file.name }));
                return true;
            } catch (error) {
                console.warn('[Source parser] could not parse archived original', JSON.stringify({ fileId, name: file.name, error: error.message }));
                await repo.saveSheets(fileId, [], error.message).catch(() => {});
                return false;
            }
        })().finally(() => pending.delete(fileId)));
    }
    return pending.get(fileId);
}

module.exports = { parsePending, parseWorkbook, parseCsv, toSheet };
