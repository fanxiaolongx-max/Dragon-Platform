const express = require('express');
const router = express.Router();

function encapsulateHtmlToRtf(html) {
    const rtfEscaped = [];
    const escapedChars = new Set(['{', '}', '\\']);
    for (let i = 0; i < html.length; i++) {
        const code = html.charCodeAt(i);
        const char = html[i];
        if (code <= 31) {
            if (code === 10 || code === 13 || code === 9) {
                rtfEscaped.push(char);
            }
            continue;
        }
        if (code <= 127) {
            if (escapedChars.has(char)) {
                rtfEscaped.push('\\');
            }
            rtfEscaped.push(char);
        } else if (code <= 255) {
            rtfEscaped.push(`\\'${code.toString(16).padStart(2, '0')}`);
        } else {
            // Signed 16-bit integer for RTF 1.5+ (MS-OXRTFEX)
            const signedCode = code > 32767 ? code - 65536 : code;
            rtfEscaped.push(`\\u${signedCode}?`);
        }
    }
    return `{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 {\\*\\htmltag1 ${rtfEscaped.join('')} }}`;
}

router.post('/export', async (req, res) => {
    const startTime = Date.now();
    let body = req.body;
    if (body && typeof body.envelope === 'string') {
        try {
            const decoded = Buffer.from(body.envelope, 'base64').toString('utf8');
            body = JSON.parse(decodeURIComponent(decoded));
        } catch (_) {
            try {
                const decoded = Buffer.from(body.envelope, 'base64').toString('utf8');
                body = JSON.parse(decoded);
            } catch (_) {}
        }
    }
    const subject = String(body?.subject || '').trim();
    const html = String(body?.html || '');
    const text = String(body?.text || '').trim();
    const attachment = body?.attachment;
    const inlineImages = body?.inlineImages ?? [];
    const htmlBytes = Buffer.byteLength(html, 'utf8');
    const textBytes = Buffer.byteLength(text, 'utf8');
    const attachmentData = String(attachment?.data || '');
    if (!subject || subject.length > 200) {
        return res.status(400).json({ error: 'INVALID_SUBJECT', message: '月报邮件主题无效' });
    }
    if (!html) {
        return res.status(400).json({ error: 'INVALID_REPORT', message: '月报正文为空' });
    }
    if (htmlBytes > 20_000_000) {
        return res.status(400).json({ error: 'HTML_TOO_LARGE', message: '月报 HTML 正文超过 20 MB', htmlBytes, limitBytes: 20_000_000 });
    }
    if (!Array.isArray(inlineImages) || inlineImages.length > 100 || inlineImages.some(image =>
        !image || typeof image.cid !== 'string' || typeof image.filename !== 'string' || typeof image.data !== 'string' || !/^report-image-\d+@tools-platform$/.test(image.cid || '') ||
        !/^report-image-\d+\.(png|jpg|gif|webp)$/.test(image.filename || '') ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data || '') || image.data.length > 10_000_000) ||
        new Set(inlineImages.map(image => image.cid)).size !== inlineImages.length) {
        return res.status(400).json({ error: 'INVALID_INLINE_IMAGE', message: '邮件内嵌图片无效或过大' });
    }
    const requestDataBytes = htmlBytes + textBytes + attachmentData.length + inlineImages.reduce((size,image)=>size+image.data.length,0);
    if (requestDataBytes > 46_000_000) {
        return res.status(400).json({ error: 'REPORT_TOO_LARGE', message: '月报正文、纯文本和附件合计超过 46 MB', requestDataBytes, limitBytes: 46_000_000 });
    }
    if (attachment && (!/^.{1,160}\.xlsx$/i.test(String(attachment.filename || '')) ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(attachmentData) ||
        attachmentData.length > 40_000_000)) {
        return res.status(400).json({ error: 'INVALID_ATTACHMENT', message: '月报附件无效或过大' });
    }
    try {
        const { Email, Attachment, MessageEditorFormat, CFB } = await import('@tutao/oxmsg');
        // Use draft mode so MSGFLAG_UNSENT (0x08) and PR_RTF_IN_SYNC (true) are naturally established
        const message = new Email(true);
        message.subject(subject);
        // Fallback plain text body (PR_BODY, 0x1000)
        const fallbackText = (text || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 500_000);
        message.bodyText(fallbackText);

        // Standard MS-OXRTFEX encapsulated RTF (PR_RTF_COMPRESSED, 0x1009)
        const rtf = encapsulateHtmlToRtf(html);
        message._bodyRtf = rtf;
        message.bodyRtfCompressed = true;

        // Raw HTML body stream (PR_HTML, 0x1013)
        message._topLevelProperties.addProperty({ id: 0x1013, type: 0x0102 }, Buffer.from(html, 'utf8'));

        // Native body indicator (PidTagNativeBody 0x1016 = 3 for HTML)
        message._topLevelProperties.addProperty({ id: 0x1016, type: 0x0003 }, 3);

        // Editor format indicator (PR_MSG_EDITOR_FORMAT 0x5909 = 2 for EDITOR_FORMAT_HTML)
        message.bodyFormat(MessageEditorFormat.EDITOR_FORMAT_HTML);

        if (attachment) {
            message.attach(new Attachment(Buffer.from(attachment.data, 'base64'), attachment.filename));
        }

        for (const image of inlineImages) {
            message.attach(new Attachment(Buffer.from(image.data, 'base64'), image.filename, image.cid));
        }

        const compound = CFB.read(Buffer.from(message.msg()), { type: 'buffer' });
        if (!CFB.find(compound, '/__substg1.0_10090102')) throw new Error('MSG RTF compressed body missing');
        if (!CFB.find(compound, '/__substg1.0_10130102')) throw new Error('MSG HTML body missing');
        if (!CFB.find(compound, '/__substg1.0_1000001F')) throw new Error('MSG fallback text body missing');

        const buffer = Buffer.from(CFB.write(compound, { type: 'buffer' }));
        const durationMs = Date.now() - startTime;

        res.setHeader('Content-Type', 'application/vnd.ms-outlook');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('X-Report-Msg-Html-Size', String(Buffer.byteLength(html, 'utf8')));
        res.setHeader('X-Report-Msg-Rtf-Size', String(Buffer.byteLength(rtf, 'utf8')));
        res.setHeader('X-Report-Msg-Attachment-Count', attachment ? '1' : '0');
        res.setHeader('X-Report-Msg-Total-Size', String(buffer.length));
        res.setHeader('X-Report-Msg-Duration-Ms', String(durationMs));
        res.setHeader('Access-Control-Expose-Headers', 'X-Report-Msg-Html-Size, X-Report-Msg-Rtf-Size, X-Report-Msg-Attachment-Count, X-Report-Msg-Total-Size, X-Report-Msg-Duration-Ms');
        res.send(buffer);
    } catch (error) {
        console.error('[report-msg] export failed:', error);
        res.status(500).json({ error: 'REPORT_MSG_EXPORT_FAILED', message: '邮件文件生成失败: ' + error.message });
    }
});

module.exports = router;
module.exports.encapsulateHtmlToRtf = encapsulateHtmlToRtf;
