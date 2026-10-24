const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const CFB = require('cfb');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use('/api/report-msg', require('../backend/routes/report-msg'));

test('both monthly reports offer the MSG export action', () => {
    const topic = fs.readFileSync(path.join(__dirname, '../frontend/pages/topic-analysis.html'), 'utf8');
    const license = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/esn-check/index.html'), 'utf8');
    assert.match(topic, /id="eosDownloadMsg"/);
    assert.match(license, /id="report-msg"/);
    assert.match(license, /report-msg-export\.js/);
    for (const page of [topic, license]) {
        assert.match(page, /若您对此报告数据有疑问，请联系范晓龙wx154337，于祥00877023，谢谢！/);
        assert.match(page, /原始数据见附件/);
    }
    const server = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    assert.ok(server.indexOf("app.use('/api', checkAuth)") < server.indexOf("app.use('/api/report-msg'"));
    assert.match(server, /req\.method === 'POST' && req\.path === '\/report-msg\/export'/);
});

test('report MSG export creates a real Outlook file with editable HTML body', async () => {
    const html = '<html><body><table><tr><td style="color:#1d4ed8">可编辑月报</td></tr></table></body></html>';
    const response = await request(app).post('/api/report-msg/export')
        .send({ subject: '临时 License 月报', html, text: '可编辑月报',
            attachment: { filename: '原始数据.xlsx', data: Buffer.from('xlsx-fixture').toString('base64') } })
        .buffer(true).parse((res, callback) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/vnd.ms-outlook');
    assert.ok(response.headers['x-report-msg-html-size']);
    assert.ok(response.headers['x-report-msg-rtf-size']);
    assert.equal(response.headers['x-report-msg-attachment-count'], '1');
    assert.equal(response.body.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
    const compound = CFB.read(response.body, { type: 'buffer' });
    const rtfStream = CFB.find(compound, '/__substg1.0_10090102');
    assert.ok(rtfStream, 'MSG should contain PR_RTF_COMPRESSED for Outlook WordMail');
    const htmlStream = CFB.find(compound, '/__substg1.0_10130102');
    assert.ok(htmlStream, 'MSG should contain PR_HTML');
    assert.match(Buffer.from(htmlStream.content).toString('utf8'), /可编辑月报/);
    const fallbackBody = CFB.find(compound, '/__substg1.0_1000001F');
    assert.ok(fallbackBody, 'MSG should contain a plain text fallback body');
    assert.match(Buffer.from(fallbackBody.content).toString('utf16le'), /可编辑月报/);
    assert.ok(CFB.find(compound, '/__substg1.0_0037001F'), 'MSG should contain subject');
    const properties = CFB.find(compound, '/__properties_version1.0').content;
    let flags = 0;
    let nativeBody = 0;
    let editorFormat = 0;
    let hasPlainBodyProperty = false;
    for (let offset = 32; offset + 16 <= properties.length; offset += 16) {
        if (properties.readUInt32LE(offset) === 0x0e070003) flags = properties.readUInt32LE(offset + 8);
        if (properties.readUInt32LE(offset) === 0x10160003) nativeBody = properties.readUInt32LE(offset + 8);
        if (properties.readUInt32LE(offset) === 0x59090003) editorFormat = properties.readUInt32LE(offset + 8);
        if (properties.readUInt32LE(offset) === 0x1000001F) hasPlainBodyProperty = true;
    }
    assert.ok(flags & 0x8, 'MSG should be an unsent draft');
    assert.equal(nativeBody, 3, 'HTML must be the native body format');
    assert.equal(editorFormat, 2, 'Outlook editor must use HTML');
    assert.equal(hasPlainBodyProperty, true, 'MSG should declare its fallback body');
    const attachmentData = compound.FullPaths.find(value => /__attach_version1\.0_#00000000\/__substg1\.0_37010102$/.test(value));
    assert.ok(attachmentData, 'MSG should include the source workbook attachment');
    assert.equal(Buffer.from(CFB.find(compound, attachmentData).content).toString(), 'xlsx-fixture');
});

test('encapsulateHtmlToRtf converts Unicode codepoints > 32767 to signed 16-bit negative integers', () => {
    const { encapsulateHtmlToRtf } = require('../backend/routes/report-msg');
    // '部' is 0x90E8 = 37096 > 32767 -> signed is 37096 - 65536 = -28440
    const rtf = encapsulateHtmlToRtf('<table><tr><td>部门</td></tr></table>');
    assert.ok(rtf.includes('\\fromhtml1'), 'Must have fromhtml1 marker');
    assert.ok(rtf.includes('\\u-28440?'), 'Must convert 37096 to signed negative -28440');
});

test('report MSG export rejects empty content', async () => {
    const response = await request(app).post('/api/report-msg/export').send({ subject: '月报', html: '' });
    assert.equal(response.status, 400);
});

test('report MSG export accepts a full bilingual report larger than the old HTML limit', async () => {
    const html = `<html><body><p>${'Monthly report content '.repeat(100_000)}</p></body></html>`;
    const response = await request(app).post('/api/report-msg/export')
        .send({ subject:'完整中英文月报', html, text:'Monthly report' });
    assert.ok(html.length > 2_000_000);
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers['x-report-msg-html-size']), Buffer.byteLength(html, 'utf8'));
});

test('report MSG export supports envelope base64 wrapped requests', async () => {
    const html = '<html><body><table><tr><td style="color:#1d4ed8">信封封装月报</td></tr></table></body></html>';
    const payload = {
        subject: '临时 License 月报(Envelope)',
        html,
        text: '信封封装月报',
        attachment: { filename: '数据.xlsx', data: Buffer.from('xlsx-envelope').toString('base64') }
    };
    const envelope = Buffer.from(encodeURIComponent(JSON.stringify(payload))).toString('base64');
    const response = await request(app).post('/api/report-msg/export')
        .send({ envelope })
        .buffer(true).parse((res, callback) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/vnd.ms-outlook');
    const compound = CFB.read(response.body, { type: 'buffer' });
    const htmlStream = CFB.find(compound, '/__substg1.0_10130102');
    assert.ok(htmlStream);
    assert.match(Buffer.from(htmlStream.content).toString('utf8'), /信封封装月报/);
});

test('report-msg-export.js defines buildLocalOutlookEml with X-Unsent draft support', () => {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/report-msg-export.js'), 'utf8');
    assert.match(source, /function buildLocalOutlookEml\(/);
    assert.match(source, /X-Unsent:\s*1/);
    assert.match(source, /multipart\/mixed/);
    assert.match(source, /isProxyBlock/);
});

test('report-msg-export.js preserves img tags, attributes, and styles for email rendering', () => {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/report-msg-export.js'), 'utf8');
    assert.match(source, /'IMG'/);
    assert.match(source, /if\s*\(tag === 'img'\)/);
    assert.match(source, /target\.setAttribute\('src', src\)/);
});


test('MSG embeds images with matching Content-ID and MIME type', async () => {
    const cid='report-image-0@tools-platform';
    const response=await request(app).post('/api/report-msg/export').send({subject:'内嵌 Logo',html:`<html><body><img src="cid:${cid}"></body></html>`,inlineImages:[{cid,filename:'report-image-0.png',data:Buffer.from('png-fixture').toString('base64')}]}).buffer(true).parse((res,callback)=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>callback(null,Buffer.concat(chunks)));});
    assert.equal(response.status,200);
    const compound=CFB.read(response.body,{type:'buffer'}),prefix='/__attach_version1.0_#00000000/';
    assert.equal(Buffer.from(CFB.find(compound,prefix+'__substg1.0_3712001F').content).toString('utf16le').replace(/\0+$/,''),cid);
    assert.equal(Buffer.from(CFB.find(compound,prefix+'__substg1.0_370E001F').content).toString('utf16le').replace(/\0+$/,''),'image/png');
    assert.equal(Buffer.from(CFB.find(compound,prefix+'__substg1.0_37010102').content).toString(),'png-fixture');
});

test('MSG rejects malformed or duplicate inline image declarations', async () => {
    const image={cid:'report-image-0@tools-platform',filename:'report-image-0.png',data:'cG5n'};
    for(const inlineImages of [{},[null],[{...image,data:{}}],[{...image,filename:'script.html'}],[image,image]]){
        const response=await request(app).post('/api/report-msg/export').send({subject:'图片校验',html:'<p>test</p>',inlineImages});
        assert.equal(response.status,400);assert.equal(response.body.error,'INVALID_INLINE_IMAGE');
    }
});
