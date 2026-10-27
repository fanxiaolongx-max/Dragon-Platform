// Chromium/AX may merge empty paragraphs. Keep every nonempty line (including
// indentation) and only normalize line endings and repeated paragraph breaks.
const composerText = text => String(text || '').replace(/\r\n?/g, '\n').trim().replace(/\n{2,}/g, '\n');
module.exports = { composerText };
