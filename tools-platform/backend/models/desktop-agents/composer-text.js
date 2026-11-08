// Chromium/AX may merge empty paragraphs and place a paragraph's leading
// spaces before the preceding newline. Keep every nonempty line (including
// indentation) and only normalize line endings, paragraph-boundary spaces
// and repeated paragraph breaks.
const composerText = text => String(text || '').replace(/\r\n?/g, '\n').trim().replace(/\n{2,}/g, '\n').replace(/([ \t]+)\n/g, '\n$1');
module.exports = { composerText };
