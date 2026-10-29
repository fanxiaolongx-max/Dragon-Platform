/**
 * shared/ide-highlighter.js - 高性能轻量级前端代码高亮引擎
 * 支持 Python, JavaScript, HTML, CSS, SQL, JSON, YAML, Markdown, Bash 等常见格式
 */
(function (global) {
    'use strict';

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const LANGUAGES = {
        python: {
            keywords: new Set([
                'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
                'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
                'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
                'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
                'match', 'case'
            ]),
            builtins: new Set([
                'True', 'False', 'None', 'self', 'cls', '__init__', '__name__', '__doc__',
                'abs', 'all', 'any', 'bin', 'bool', 'bytearray', 'bytes', 'callable',
                'chr', 'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir',
                'divmod', 'enumerate', 'eval', 'exec', 'filter', 'float', 'format',
                'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex',
                'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len',
                'list', 'locals', 'map', 'max', 'min', 'next', 'object', 'oct',
                'open', 'ord', 'pow', 'print', 'property', 'range', 'repr',
                'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod',
                'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip'
            ]),
            patterns: [
                // Triple-quoted multiline strings
                { type: 'string', regex: /^(?:[furbFURB]{0,2})("""[\s\S]*?"""|'''[\s\S]*?''')/ },
                // Single/double quoted strings
                { type: 'string', regex: /^(?:[furbFURB]{0,2})("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/ },
                // Comments
                { type: 'comment', regex: /^#.*/ },
                // Decorators
                { type: 'decorator', regex: /^@\s*[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/ },
                // Numbers
                { type: 'number', regex: /^0[xX][0-9a-fA-F]+|^0[bB][01]+|^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
                // Operators & punctuation
                { type: 'operator', regex: /^(?:[+\-*/%=!<>]=?|&{1,2}|\|{1,2}|\^|~|:=)/ }
            ]
        },
        javascript: {
            keywords: new Set([
                'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
                'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
                'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
                'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try',
                'typeof', 'var', 'void', 'while', 'with', 'yield', 'of'
            ]),
            builtins: new Set([
                'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
                'console', 'window', 'document', 'Promise', 'Array', 'Object',
                'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp',
                'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Error'
            ]),
            patterns: [
                { type: 'comment', regex: /^\/\*[\s\S]*?\*\/|^\/\/.*/ },
                { type: 'string', regex: /^`(?:\\.|[^`\\])*`|^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'/ },
                { type: 'number', regex: /^0[xX][0-9a-fA-F]+|^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
                { type: 'operator', regex: /^(?:=>|===|!==|==|!=|<=|>=|[+\-*/%]=?|\+\+|--|&&|\|\||[?!:])/ }
            ]
        },
        sql: {
            keywords: new Set([
                'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set',
                'delete', 'create', 'table', 'drop', 'alter', 'add', 'column', 'index',
                'view', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross',
                'on', 'group', 'by', 'order', 'having', 'limit', 'offset', 'and', 'or',
                'not', 'in', 'is', 'null', 'as', 'distinct', 'count', 'sum', 'avg',
                'min', 'max', 'case', 'when', 'then', 'else', 'end', 'primary', 'key',
                'foreign', 'references', 'default', 'autoincrement', 'auto_increment',
                'text', 'integer', 'real', 'blob', 'varchar', 'char', 'int', 'bigint',
                'boolean', 'datetime', 'date', 'time', 'timestamp', 'unique', 'check',
                'asc', 'desc', 'union', 'all', 'exists', 'between', 'like', 'ilike'
            ]),
            builtins: new Set(['sqlite_master', 'information_schema', 'tables', 'columns']),
            patterns: [
                { type: 'comment', regex: /^--.*|^\/\*[\s\S]*?\*\// },
                { type: 'string', regex: /^'(?:''|\\.|[^'\\])*'|^"(?:""|\\.|[^"\\])*"/ },
                { type: 'number', regex: /^\d+(?:\.\d+)?/ },
                { type: 'operator', regex: /^(?:[=<>!]=?|[+\-*/%])/ }
            ]
        },
        html: {
            custom: function (text) {
                // Highlighting for HTML tags, attributes, strings, comments
                const parts = [];
                let i = 0;
                while (i < text.length) {
                    if (text.startsWith('<!--', i)) {
                        const end = text.indexOf('-->', i + 4);
                        const c = end === -1 ? text.slice(i) : text.slice(i, end + 3);
                        parts.push(`<span class="tok-comment">${escapeHtml(c)}</span>`);
                        i += c.length;
                    } else if (text[i] === '<') {
                        const close = text.indexOf('>', i);
                        if (close !== -1) {
                            const tagContent = text.slice(i, close + 1);
                            const highlighted = tagContent.replace(/^(<\/?)([a-zA-Z0-9_\-:]+)/, '$1<span class="tok-tag">$2</span>')
                                .replace(/\s+([a-zA-Z0-9_\-:]+)(?:=("[^"]*"|'[^']*'|[^\s>]+))?/g, (_m, attr, val) => {
                                    let res = ` <span class="tok-attr">${escapeHtml(attr)}</span>`;
                                    if (val) {
                                        res += `=${val.startsWith('"') || val.startsWith('\'') ? `<span class="tok-string">${escapeHtml(val)}</span>` : escapeHtml(val)}`;
                                    }
                                    return res;
                                });
                            parts.push(highlighted);
                            i += tagContent.length;
                        } else {
                            parts.push('&lt;');
                            i++;
                        }
                    } else {
                        const next = text.indexOf('<', i);
                        const chunk = next === -1 ? text.slice(i) : text.slice(i, next);
                        parts.push(escapeHtml(chunk));
                        i += chunk.length;
                    }
                }
                return parts.join('');
            }
        },
        json: {
            custom: function (text) {
                return escapeHtml(text)
                    .replace(/(&quot;(?:\\.|[^&"\\])*&quot;)(\s*:)/g, '<span class="tok-key">$1</span>$2')
                    .replace(/(: \s*)(&quot;(?:\\.|[^&"\\])*&quot;)/g, '$1<span class="tok-string">$2</span>')
                    .replace(/\b(true|false|null)\b/g, '<span class="tok-builtin">$1</span>')
                    .replace(/\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, '<span class="tok-number">$1</span>');
            }
        },
        css: {
            keywords: new Set(['important', 'px', 'em', 'rem', '%', 'vh', 'vw', 'auto', 'inherit']),
            patterns: [
                { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
                { type: 'string', regex: /^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'/ },
                { type: 'attr', regex: /^[a-zA-Z\-]+(?=\s*:)/ },
                { type: 'number', regex: /^[#0-9a-fA-F]+|\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?/ },
                { type: 'operator', regex: /^[{}:;,]/ }
            ]
        }
    };

    function highlight(code, lang) {
        if (!code) return '';
        const langConfig = LANGUAGES[lang];
        if (!langConfig) return escapeHtml(code);
        if (langConfig.custom) {
            return langConfig.custom(code);
        }

        const { keywords, builtins, patterns } = langConfig;
        const out = [];
        let i = 0;
        const len = code.length;

        while (i < len) {
            const sub = code.slice(i);
            let matched = false;

            // Test custom regex patterns
            for (const p of patterns) {
                const m = p.regex.exec(sub);
                if (m && m[0].length > 0) {
                    const token = m[0];
                    out.push(`<span class="tok-${p.type}">${escapeHtml(token)}</span>`);
                    i += token.length;
                    matched = true;
                    break;
                }
            }
            if (matched) continue;

            // Word tokens (identifiers, keywords)
            const wordMatch = /^[a-zA-Z_]\w*/.exec(sub);
            if (wordMatch) {
                const word = wordMatch[0];
                const lower = word.toLowerCase();
                if (keywords && (keywords.has(word) || keywords.has(lower))) {
                    out.push(`<span class="tok-keyword">${escapeHtml(word)}</span>`);
                } else if (builtins && (builtins.has(word) || builtins.has(lower))) {
                    out.push(`<span class="tok-builtin">${escapeHtml(word)}</span>`);
                } else {
                    out.push(escapeHtml(word));
                }
                i += word.length;
                continue;
            }

            // Whitespace or single char
            const wsMatch = /^\s+/.exec(sub);
            if (wsMatch) {
                out.push(wsMatch[0]);
                i += wsMatch[0].length;
                continue;
            }

            out.push(escapeHtml(code[i]));
            i++;
        }

        return out.join('');
    }

    function detectLanguage(filePath) {
        const ext = String(filePath || '').split('.').pop().toLowerCase();
        switch (ext) {
            case 'py': return 'python';
            case 'js':
            case 'mjs':
            case 'ts': return 'javascript';
            case 'html':
            case 'htm':
            case 'xml':
            case 'svg': return 'html';
            case 'css':
            case 'scss':
            case 'less': return 'css';
            case 'sql': return 'sql';
            case 'json': return 'json';
            case 'md':
            case 'markdown': return 'markdown';
            case 'yml':
            case 'yaml': return 'yaml';
            case 'sh':
            case 'bash': return 'bash';
            default: return 'text';
        }
    }

    const IdeHighlighter = {
        highlight,
        detectLanguage,
        escapeHtml
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = IdeHighlighter;
    } else {
        global.IdeHighlighter = IdeHighlighter;
    }
})(typeof window !== 'undefined' ? window : globalThis);
