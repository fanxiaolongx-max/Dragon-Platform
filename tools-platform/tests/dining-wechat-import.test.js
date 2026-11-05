const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/tool-dining-card-wechat/index.html'), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const parserSource = script.match(/  function parseWeChatFileRows\([\s\S]*?\n  }/)[0];
const parse = new Function(`${parserSource}\nreturn parseWeChatFileRows;`)();

function parseBill(rows) {
    const group = { details: [], warning: '' };
    const daily = {};
    const transfers = [];
    const records = parse(rows, '微信账单.csv', group, daily, transfers);
    return { records, details: group.details, warning: group.warning, daily, transfers };
}

test('only confirmed QR receipts reach meal classification, daily totals and export details', () => {
    const morning = '2026-11-05 13:00:00'; // 07:00 in Cairo
    const noon = '2026-11-05 18:00:00'; // 12:00 in Cairo
    const evening = '2026-11-05 23:00:00'; // 17:00 in Cairo
    const { records, details, daily } = parseBill([
        ['微信支付账单明细'],
        ['交易时间', '交易类型', '交易对方', '收/支', '金额(元)'],
        [morning, '转账', '补款', '收入', '¥14.00'],
        ['2026-10-29 15:59:08', '转账', '补款', '收入', '¥35.00'],
        [noon, '转账', '补款', '收入', '¥28.00'],
        [noon, '二维码退款', '退款', '收入', '¥28.00'],
        [noon, '二维码收款', '支出', '支出', '¥28.00'],
        [noon, '二维码收付款', '支出', '支出', '¥28.00'],
        [noon, '', '未知类型', '收入', '¥28.00'],
        [noon, '二维码收款', '其他金额', '收入', '¥20.00'],
        [morning, '二维码收款', '早餐', '收入', '¥14.00'],
        [noon, '二维码', '中餐', '收入', '¥28.00'],
        [evening, '二维码收付款', '晚餐', '收入', '¥70.00']
    ]);

    assert.deepEqual(records.map(row => [row.meal, row.category]), [
        ['早餐', '自有-微信'], ['中餐', '自有-微信'], ['晚餐', '非自有-微信']
    ]);
    assert.deepEqual(details.map(row => row['交易类型']), ['二维码收款', '二维码', '二维码收付款']);
    assert.deepEqual(details.map(row => row['交易对方']), ['早餐', '中餐', '晚餐']);
    assert.equal(daily['2026-11-05'].total, 3);
});

test('a missing transaction type never falls back to income and amount', () => {
    const { records, details, warning, daily } = parseBill([
        ['交易时间', '收/支', '金额(元)'],
        ['2026-11-05 18:00:00', '收入', '28']
    ]);

    assert.match(warning, /缺少「交易类型」列/);
    assert.deepEqual(records, []);
    assert.deepEqual(details, []);
    assert.deepEqual(daily, {});
});

test('without a direction column only the explicit QR receipt type can count', () => {
    const { records } = parseBill([
        ['交易时间', '交易类型', '金额(元)'],
        ['2026-11-05 18:00:00', '二维码收款', '28'],
        ['2026-11-05 18:00:00', '二维码', '28'],
        ['2026-11-05 18:00:00', '二维码收付款', '28']
    ]);

    assert.deepEqual(records.map(row => row.transactionType), ['二维码收款']);
});

test('transfers of any amount are kept separately with Cairo date and original direction', () => {
    const { records, details, daily, transfers } = parseBill([
        ['交易时间', '交易类型', '交易对方', '收/支', '金额(元)'],
        ['2026-11-05 02:00:00', '转账', '补款', '收入', '¥35.00'],
        ['2026-11-05 18:00:00', '微信转账', '付款', '支出', '-¥123.45'],
        ['2026-11-05 18:01:00', '转账', '未知方向', '', '¥0.10'],
        ['2026-11-05 18:02:00', '转账退款', '退款', '收入', '¥35.00']
    ]);

    assert.deepEqual(records, []);
    assert.deepEqual(details, []);
    assert.deepEqual(daily, {});
    assert.deepEqual(transfers.map(row => [row.cairoDate, row.direction, row.amountCents]), [
        ['2026-11-04', '收入', 3500], ['2026-11-05', '支出', 12345], ['2026-11-05', '未标明', 10]
    ]);
});
