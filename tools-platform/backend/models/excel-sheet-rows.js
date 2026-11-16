/** O(N) 读取单个 ExcelJS 工作表行数据，避免在循环中触发 actualColumnCount/columnCount 全表重扫 getter，并按批让出事件循环。 */
const YIELD_INTERVAL = 2000;
const yieldEventLoop = () => new Promise(resolve => setImmediate(resolve));

async function readWorksheetRows(sheet, { includeEmptyRows = false, readCell = cell => String(cell?.value ?? ''), minColumns = 0, yieldEvery = YIELD_INTERVAL } = {}) {
    if (!sheet) return [];
    let maxCol = Math.max(0, Number(minColumns) || 0);
    let maxRow = 0;
    const populated = [];

    sheet.eachRow({ includeEmpty: false }, (row, number) => {
        const entries = [];
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            if (colNumber > maxCol) maxCol = colNumber;
            entries.push([colNumber, readCell(cell)]);
        });
        if (!entries.length) return;
        if (number > maxRow) maxRow = number;
        populated.push([number, entries]);
    });

    const rows = includeEmptyRows ? Array.from({ length: maxRow }, () => []) : new Array(populated.length);
    for (let index = 0; index < populated.length; index += 1) {
        const [number, entries] = populated[index];
        const values = Array(maxCol).fill('');
        for (const [colNumber, text] of entries) {
            if (colNumber >= 1 && colNumber <= maxCol) values[colNumber - 1] = text;
        }
        if (includeEmptyRows) {
            if (number >= 1) rows[number - 1] = values;
        } else {
            rows[index] = values;
        }
        if (yieldEvery > 0 && (index + 1) % yieldEvery === 0) await yieldEventLoop();
    }
    return rows;
}

module.exports = { readWorksheetRows };
