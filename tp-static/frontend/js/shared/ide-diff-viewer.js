// Read-only unified Git diff viewer. Build source rows with text nodes; never execute file content.
(function (global) {
    function decodePath(value) {
        value = value.trim().replace(/\t.*$/, '');
        if (value.startsWith('"') && value.endsWith('"')) {
            const bytes = []; const text = value.slice(1, -1);
            for (let i = 0; i < text.length;) {
                const oct = /^\\([0-7]{3})/.exec(text.slice(i));
                if (oct) { bytes.push(parseInt(oct[1], 8)); i += 4; }
                else if (text[i] === '\\' && i + 1 < text.length) {
                    const ch = { t: '\t', n: '\n', r: '\r' }[text[i + 1]] || text[i + 1];
                    bytes.push(...new TextEncoder().encode(ch)); i += 2;
                } else { const ch = String.fromCodePoint(text.codePointAt(i)); bytes.push(...new TextEncoder().encode(ch)); i += ch.length; }
            }
            value = new TextDecoder().decode(new Uint8Array(bytes));
        }
        return value.replace(/^[ab]\//, '');
    }
    function parse(diff) {
        const files = []; let file = null, hunk = null, old = 0, next = 0, oldLeft = 0, newLeft = 0;
        for (const line of String(diff || '').split(/\r?\n/)) {
            if (line.startsWith('diff --git ')) {
                const paths = /^diff --git (.+) ("?b\/.*)$/.exec(line);
                file = { path: paths ? decodePath(paths[2]) : line.slice(11), status: 'modified', added: 0, removed: 0, hunks: [], meta: [] };
                files.push(file); hunk = null; oldLeft = newLeft = 0; continue;
            }
            if (!file) continue;
            const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/.exec(line);
            if (match) {
                old = Number(match[1]); next = Number(match[3]);
                oldLeft = match[2] === undefined ? 1 : Number(match[2]); newLeft = match[4] === undefined ? 1 : Number(match[4]);
                hunk = { header: line, rows: [] }; file.hunks.push(hunk); continue;
            }
            if (hunk && (oldLeft > 0 || newLeft > 0)) {
                const type = line[0]; const text = line.slice(1);
                if (type === '-' && oldLeft > 0) { hunk.rows.push({ type: 'removed', old: old++, next: '', text }); oldLeft--; file.removed++; }
                else if (type === '+' && newLeft > 0) { hunk.rows.push({ type: 'added', old: '', next: next++, text }); newLeft--; file.added++; }
                else if (type === ' ' && oldLeft > 0 && newLeft > 0) { hunk.rows.push({ type: 'context', old: old++, next: next++, text }); oldLeft--; newLeft--; }
                else if (line.startsWith('\\')) hunk.rows.push({ type: 'note', old: '', next: '', text: line });
                continue;
            }
            if (line.startsWith('\\ No newline')) { hunk?.rows.push({ type: 'note', old: '', next: '', text: line }); continue; }
            if (line.startsWith('+++ ') && line.slice(4) !== '/dev/null') file.path = decodePath(line.slice(4));
            else if (line.startsWith('--- ') && !file.path && line.slice(4) !== '/dev/null') file.path = decodePath(line.slice(4));
            else if (line.startsWith('new file mode')) file.status = 'added';
            else if (line.startsWith('deleted file mode')) file.status = 'removed';
            else if (line.startsWith('rename to ')) { file.path = decodePath(line.slice(10)); file.status = 'renamed'; }
            if (!line.startsWith('index ') && !line.startsWith('--- ') && !line.startsWith('+++ ') && line) file.meta.push(line);
        }
        return files;
    }
    function changedRange(before, after) {
        let start = 0, tail = 0;
        while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
        while (tail < Math.min(before.length, after.length) - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
        return { before: [start, before.length - tail], after: [start, after.length - tail] };
    }
    function render(host, diff) {
        let english = false;
        try { english = (global.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || document.documentElement.lang).startsWith('en'); } catch (_) {}
        const L = (zh, en) => english ? en : zh;
        const files = parse(diff);
        const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
        const button = (text, action) => { const node = el('button', 'ha-ide-btn sm', text); node.type = 'button'; node.onclick = action; return node; };
        host.replaceChildren(); host.classList.add('ide-diff-view');
        const toolbar = el('div', 'ide-diff-toolbar');
        const count = el('strong', '', `${files.length} ${L('个文件', 'files')}`);
        const plus = el('span', 'ide-diff-plus', `+${files.reduce((n, f) => n + f.added, 0)}`);
        const minus = el('span', 'ide-diff-minus', `−${files.reduce((n, f) => n + f.removed, 0)}`);
        const body = el('div', 'ide-diff-body'), nav = el('nav', 'ide-diff-nav'), content = el('div', 'ide-diff-files');
        nav.setAttribute('aria-label', L('改动文件', 'Changed files'));
        const raw = el('pre', 'ide-diff-raw', diff || L('无文件内容改动', 'No content changes')); raw.hidden = true;
        const sections = [];
        toolbar.append(count, plus, minus,
            button(L('展开全部', 'Expand all'), () => sections.forEach(section => { section.open = true; })),
            button(L('折叠全部', 'Collapse all'), () => sections.forEach(section => { section.open = false; })));
        const label = el('label', 'ide-diff-only'); const checkbox = el('input'); checkbox.type = 'checkbox';
        checkbox.onchange = () => content.classList.toggle('changes-only', checkbox.checked);
        label.append(checkbox, document.createTextNode(L('只看改动', 'Changes only'))); toolbar.append(label);
        const toggle = button(L('原始 Diff', 'Raw diff'), () => { raw.hidden = !raw.hidden; body.hidden = !raw.hidden; toggle.textContent = raw.hidden ? L('原始 Diff', 'Raw diff') : L('结构化视图', 'Structured view'); }); toolbar.append(toggle);
        const filter = el('input', 'ide-diff-filter'); filter.type = 'search'; filter.placeholder = L('筛选文件…', 'Filter files…'); filter.setAttribute('aria-label', filter.placeholder); nav.append(filter);
        const entries = [];
        filter.oninput = () => entries.forEach(({ file, link, section }) => { const hidden = !file.path.toLowerCase().includes(filter.value.toLowerCase()); link.hidden = hidden; section.hidden = hidden; });
        function sourceText(node, text, lang) {
            // HTML is tokenized with text nodes so tags and event handlers remain inert source.
            if (lang === 'html') {
                const pattern = /<!--.*?(?:-->|$)|<\/?[\w:-]+|"[^"]*"|'[^']*'|[\w:-]+(?=\s*=)/g;
                let offset = 0;
                for (const match of text.matchAll(pattern)) {
                    node.append(document.createTextNode(text.slice(offset, match.index)));
                    const token = match[0];
                    const kind = token.startsWith('<!--') ? 'comment' : token.startsWith('<') ? 'tag' : /^["']/.test(token) ? 'string' : 'attr';
                    node.append(el('span', 'tok-' + kind, token)); offset = match.index + token.length;
                }
                node.append(document.createTextNode(text.slice(offset)));
            } else if (global.IdeHighlighter && ['python', 'javascript', 'sql', 'css', 'json'].includes(lang) && text.length < 20000) node.innerHTML = global.IdeHighlighter.highlight(text, lang);
            else node.textContent = text;
        }
        for (const [index, file] of files.entries()) {
            const section = el('details', 'ide-diff-file'); const summary = el('summary');
            const status = { added: L('新增', 'Added'), removed: L('删除', 'Deleted'), renamed: L('重命名', 'Renamed'), modified: L('修改', 'Modified') }[file.status];
            summary.append(el('span', 'ide-diff-status', status), el('strong', 'ide-diff-path', file.path), el('span', 'ide-diff-plus', `+${file.added}`), el('span', 'ide-diff-minus', `−${file.removed}`));
            section.append(summary); sections.push(section); content.append(section);
            const link = button(file.path, () => {
                section.open = true; section.scrollIntoView({ block: 'start', behavior: 'instant' });
                entries.forEach(entry => entry.link.setAttribute('aria-current', String(entry.section === section)));
            }); link.title = file.path; nav.append(link); entries.push({ file, link, section });
            let built = false;
            function build() {
                if (built) return; built = true;
                if (file.meta.length) section.append(el('div', 'ide-diff-meta', file.meta.join('\n')));
                if (!file.hunks.length) section.append(el('p', 'ide-diff-meta', L('没有文本差异（可能为重命名、权限或二进制文件变动）', 'No text diff: rename, mode change or binary file.')));
                const lang = global.IdeHighlighter?.detectLanguage(file.path) || 'text';
                for (const hunk of file.hunks) {
                    const group = el('details', 'ide-diff-hunk'); group.open = true; group.append(el('summary', '', hunk.header));
                    const lines = el('div', 'ide-diff-lines');
                    // Pair adjacent removed/added lines to emphasize the changed characters.
                    for (let i = 0; i < hunk.rows.length; i++) {
                        if (hunk.rows[i].type !== 'removed') continue;
                        let j = i; while (hunk.rows[j]?.type === 'removed') j++;
                        let k = j; while (hunk.rows[k]?.type === 'added') k++;
                        for (let n = 0; n < Math.min(j - i, k - j); n++) {
                            const range = changedRange(hunk.rows[i + n].text, hunk.rows[j + n].text);
                            hunk.rows[i + n].range = range.before; hunk.rows[j + n].range = range.after;
                        }
                        i = Math.max(i, k - 1);
                    }
                    for (const row of hunk.rows) {
                        const line = el('div', 'ide-diff-line ' + row.type);
                        const sign = row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' ';
                        line.append(el('span', 'ide-diff-number', row.old), el('span', 'ide-diff-number', row.next), el('span', 'ide-diff-sign', sign));
                        const code = el('code');
                        if (row.range && row.range[0] < row.range[1]) {
                            const [start, end] = row.range; const left = el('span'), right = el('span');
                            sourceText(left, row.text.slice(0, start), lang); sourceText(right, row.text.slice(end), lang);
                            code.append(left, el('mark', '', row.text.slice(start, end)), right);
                        } else sourceText(code, row.text, lang);
                        line.append(code); lines.append(line);
                    }
                    group.append(lines); section.append(group);
                }
            }
            section.addEventListener('toggle', () => { if (section.open) build(); });
            if (files.length <= 4 || index === 0) { build(); section.open = true; }
        }
        if (!files.length) content.append(el('p', 'ide-diff-meta', diff?.trim() ? L('此差异格式无法结构化显示，请切换「原始 Diff」。', 'This diff format is available in Raw diff.') : L('无文件内容改动', 'No content changes')));
        body.append(nav, content); host.append(toolbar, body, raw);
        return { files };
    }
    const api = { parse, changedRange, render };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.IdeDiffViewer = api;
})(typeof window !== 'undefined' ? window : globalThis);
