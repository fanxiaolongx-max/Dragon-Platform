const GATEKEEPER_STYLE = `
html.tp-locked, body.tp-locked {
  overflow: hidden !important;
  height: 100% !important;
  user-select: auto !important;
  -webkit-user-select: auto !important;
}
html.tp-locked body > *:not(.tp-gatekeeper-keep),
body.tp-locked > *:not(.tp-gatekeeper-keep) {
  display: none !important;
}
html.tp-locked dialog, body.tp-locked dialog {
  display: none !important;
  pointer-events: none !important;
}
.tp-gatekeeper-root {
  position: fixed !important;
  inset: 0 !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  width: 100vw !important;
  height: 100% !important;
  height: 100vh !important;
  z-index: 2147483647 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 20px !important;
  box-sizing: border-box !important;
  pointer-events: auto !important;
  user-select: auto !important;
  -webkit-user-select: auto !important;
  font-family: system-ui, -apple-system, sans-serif !important;
  isolation: isolate !important;
}
.tp-gatekeeper-backdrop {
  position: absolute !important;
  inset: 0 !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100% !important;
  background: rgba(15, 23, 42, 0.88) !important;
  backdrop-filter: blur(14px) !important;
  -webkit-backdrop-filter: blur(14px) !important;
  pointer-events: none !important;
  z-index: 1 !important;
}
.tp-gatekeeper-dialog {
  position: relative !important;
  z-index: 2 !important;
  width: min(420px, 92vw) !important;
  box-sizing: border-box !important;
  background: #ffffff !important;
  border-radius: 20px !important;
  padding: 32px 28px !important;
  box-shadow: 0 25px 60px rgba(0,0,0,0.45) !important;
  text-align: center !important;
  border: 1px solid rgba(255,255,255,0.2) !important;
  pointer-events: auto !important;
  user-select: auto !important;
  -webkit-user-select: auto !important;
  isolation: isolate !important;
  transform: translateZ(0) !important;
  -webkit-transform: translateZ(0) !important;
}
.tp-gatekeeper-icon {
  font-size: 40px !important;
  margin-bottom: 12px !important;
  line-height: 1 !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  pointer-events: none !important;
}
.tp-gatekeeper-dialog h3 {
  margin: 0 0 8px !important;
  font-size: 20px !important;
  font-weight: 750 !important;
  color: #0f172a !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
.tp-gatekeeper-dialog p {
  margin: 0 0 20px !important;
  font-size: 13px !important;
  color: #64748b !important;
  line-height: 1.5 !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
.tp-gatekeeper-form {
  position: relative !important;
  z-index: 2 !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 12px !important;
  pointer-events: auto !important;
  user-select: auto !important;
  -webkit-user-select: auto !important;
}
.tp-gatekeeper-input {
  position: relative !important;
  z-index: 2 !important;
  width: 100% !important;
  box-sizing: border-box !important;
  padding: 12px 14px !important;
  font-size: 15px !important;
  line-height: 1.4 !important;
  border: 1.5px solid #cbd5e1 !important;
  border-radius: 10px !important;
  outline: none !important;
  background: #ffffff !important;
  color: #0f172a !important;
  cursor: text !important;
  pointer-events: auto !important;
  user-select: text !important;
  -webkit-user-select: text !important;
  -webkit-appearance: none !important;
  appearance: none !important;
  touch-action: manipulation !important;
  transition: border-color .2s, box-shadow .2s !important;
}
.tp-gatekeeper-input:focus {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2) !important;
}
.tp-gatekeeper-btn {
  position: relative !important;
  z-index: 2 !important;
  width: 100% !important;
  box-sizing: border-box !important;
  padding: 12px !important;
  font-size: 15px !important;
  font-weight: 700 !important;
  color: #fff !important;
  background: linear-gradient(135deg, #2563eb, #1d4ed8) !important;
  border: none !important;
  border-radius: 10px !important;
  cursor: pointer !important;
  pointer-events: auto !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  touch-action: manipulation !important;
  transition: opacity .2s, transform .1s !important;
}
.tp-gatekeeper-btn:hover {
  opacity: 0.94 !important;
}
.tp-gatekeeper-btn:active {
  transform: scale(0.98) !important;
}
.tp-gatekeeper-btn:disabled {
  opacity: 0.6 !important;
  cursor: not-allowed !important;
}
.tp-gatekeeper-error {
  margin-top: 6px !important;
  font-size: 12px !important;
  color: #ef4444 !important;
  font-weight: 600 !important;
  min-height: 18px !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
@media (prefers-color-scheme: dark) {
  .tp-gatekeeper-dialog {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #f8fafc !important;
  }
  .tp-gatekeeper-dialog h3 { color: #f8fafc !important; }
  .tp-gatekeeper-dialog p { color: #94a3b8 !important; }
  .tp-gatekeeper-input {
    background: #0f172a !important;
    border-color: #334155 !important;
    color: #f8fafc !important;
  }
}
`;

function injectGatekeeper(html, encryption, toolSlug = 'department-reward-penalty') {
    if (!encryption || !encryption.enabled) return html;
    const hash = String(encryption.passwordHash || encryption.hash || '');
    const salt = String(encryption.passwordSalt || encryption.salt || '');
    if (!hash) return html;

    const modalHtml = `<style id="tpGatekeeperStyle" class="tp-gatekeeper-keep">${GATEKEEPER_STYLE}</style>
<div id="tpGatekeeperModal" class="tp-gatekeeper-root tp-gatekeeper-keep" role="dialog" aria-modal="true" aria-labelledby="tpGatekeeperTitle">
  <div class="tp-gatekeeper-backdrop" aria-hidden="true"></div>
  <div class="tp-gatekeeper-dialog">
    <div class="tp-gatekeeper-icon" aria-hidden="true">🔒</div>
    <h3 id="tpGatekeeperTitle">访问受限 · 密码保护</h3>
    <p>该静态页面已启用访问保护，请输入访问密码以继续浏览。</p>
    <form class="tp-gatekeeper-form" onsubmit="tpUnlockSnapshot(event); return false;" action="#">
      <input type="password" id="tpGatekeeperInput" class="tp-gatekeeper-input" placeholder="请输入访问密码" autocomplete="current-password" autofocus tabindex="1" />
      <button type="submit" id="tpGatekeeperSubmit" class="tp-gatekeeper-btn" tabindex="2">解锁页面</button>
    </form>
    <div id="tpGatekeeperError" class="tp-gatekeeper-error" hidden></div>
  </div>
</div>`;

    const bootScript = `<script id="tpGatekeeperBootScript" class="tp-gatekeeper-keep">
(function() {
    var KEY = 'tp_unlocked_' + ${JSON.stringify(toolSlug)};
    window.tpIsUnlocked = function() {
        try { return sessionStorage.getItem(KEY) === '1'; } catch (_) { return false; }
    };
    if (!window.tpIsUnlocked()) {
        document.documentElement.classList.add('tp-locked');
        if (document.body) document.body.classList.add('tp-locked');

        if (typeof window.HTMLDialogElement !== 'undefined' && HTMLDialogElement.prototype && HTMLDialogElement.prototype.showModal) {
            var _origShowModal = HTMLDialogElement.prototype.showModal;
            window.__tpOrigShowModal = _origShowModal;
            HTMLDialogElement.prototype.showModal = function() {
                if (!window.tpIsUnlocked()) {
                    console.warn('[门禁锁定] 解锁前阻止模态对话框打开并抢占顶层:', this.id || this.className);
                    return;
                }
                return _origShowModal.apply(this, arguments);
            };
        }
    }
})();
</script>`;

    const script = `<script id="tpGatekeeperScript" class="tp-gatekeeper-keep">
(function() {
    var HASH = ${JSON.stringify(hash)};
    var SALT = ${JSON.stringify(salt)};
    var KEY = 'tp_unlocked_' + ${JSON.stringify(toolSlug)};

    function sha256Fallback(ascii) {
        function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
        var mathPow = Math.pow;
        var maxWord = mathPow(2, 32);
        var result = '';
        var words = [];
        var asciiBitLength = ascii.length * 8;
        var hash = [];
        var k = [];
        var primeCounter = 0;
        var isComposite = {};
        for (var candidate = 2; primeCounter < 64; candidate++) {
            if (!isComposite[candidate]) {
                for (var i = 0; i < 313; i += candidate) isComposite[i] = true;
                hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
                k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
            }
        }
        words[asciiBitLength >> 5] |= 0x80 << (24 - asciiBitLength % 32);
        words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;
        for (var i = 0; i < ascii.length; i++) {
            words[i >> 2] |= ascii.charCodeAt(i) << ((3 - i % 4) * 8);
        }
        var w = new Array(64);
        for (var j = 0; j < words.length; j += 16) {
            var a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
            for (var i = 0; i < 64; i++) {
                if (i < 16) {
                    w[i] = words[j + i] | 0;
                } else {
                    var gamma0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                    var gamma1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                    w[i] = (w[i - 16] + gamma0 + w[i - 7] + gamma1) | 0;
                }
                var ch = (e & f) ^ (~e & g);
                var maj = (a & b) ^ (a & c) ^ (b & c);
                var sigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
                var sigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
                var temp1 = (h + sigma1 + ch + k[i] + w[i]) | 0;
                var temp2 = (sigma0 + maj) | 0;
                h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
            }
            hash[0] = (hash[0] + a) | 0; hash[1] = (hash[1] + b) | 0; hash[2] = (hash[2] + c) | 0; hash[3] = (hash[3] + d) | 0;
            hash[4] = (hash[4] + e) | 0; hash[5] = (hash[5] + f) | 0; hash[6] = (hash[6] + g) | 0; hash[7] = (hash[7] + h) | 0;
        }
        for (var i = 0; i < 8; i++) {
            for (var j = 3; j >= 0; j--) {
                var byteVal = (hash[i] >> (j * 8)) & 255;
                result += (byteVal < 16 ? '0' : '') + byteVal.toString(16);
            }
        }
        return result;
    }

    async function computeHash(pwd) {
        var full = pwd + ':' + SALT;
        try {
            if (window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
                var text = new TextEncoder().encode(full);
                var buffer = await window.crypto.subtle.digest('SHA-256', text);
                return Array.from(new Uint8Array(buffer)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
            }
        } catch (_) {}
        var utf8 = unescape(encodeURIComponent(full));
        return sha256Fallback(utf8);
    }

    window.tpIsUnlocked = function() {
        try { return sessionStorage.getItem(KEY) === '1'; } catch (_) { return false; }
    };

    function doUnlock() {
        try { sessionStorage.setItem(KEY, '1'); } catch (_) {}
        document.documentElement.classList.remove('tp-locked');
        if (document.body) document.body.classList.remove('tp-locked');
        if (window.__tpOrigShowModal && window.HTMLDialogElement && HTMLDialogElement.prototype) {
            HTMLDialogElement.prototype.showModal = window.__tpOrigShowModal;
            delete window.__tpOrigShowModal;
        }
        var modal = document.getElementById('tpGatekeeperModal');
        if (modal) modal.remove();
        var style = document.getElementById('tpGatekeeperStyle');
        if (style) style.remove();
        var boot = document.getElementById('tpGatekeeperBootScript');
        if (boot) boot.remove();
        var scriptEl = document.getElementById('tpGatekeeperScript');
        if (scriptEl) scriptEl.remove();
        if (typeof window.refresh === 'function') window.refresh();
        else if (typeof window.renderAll === 'function') window.renderAll();
        else if (typeof window.load === 'function') window.load();
    }

    window.tpUnlockSnapshot = async function(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        var input = document.getElementById('tpGatekeeperInput');
        var btn = document.getElementById('tpGatekeeperSubmit');
        var err = document.getElementById('tpGatekeeperError');
        if (!input) return;
        var val = input.value.trim();
        if (!val) {
            if (err) { err.textContent = '请输入访问密码'; err.hidden = false; }
            input.focus();
            return;
        }
        if (btn) btn.disabled = true;
        try {
            var h = await computeHash(val);
            if (h === HASH) {
                doUnlock();
            } else {
                if (err) { err.textContent = '密码错误，请重新输入'; err.hidden = false; }
                input.value = '';
                input.focus();
            }
        } catch (error) {
            if (err) { err.textContent = '校验失败：' + error.message; err.hidden = false; }
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    function tryFocusInput() {
        if (window.tpIsUnlocked()) return;
        try {
            var openDialogs = document.querySelectorAll('dialog[open]');
            for (var i = 0; i < openDialogs.length; i++) {
                try { openDialogs[i].close(); } catch (_) {}
            }
        } catch (_) {}
        var inp = document.getElementById('tpGatekeeperInput');
        if (inp && document.activeElement !== inp) {
            try { inp.focus(); } catch (_) {}
        }
    }

    if (window.tpIsUnlocked()) {
        document.documentElement.classList.remove('tp-locked');
        if (document.body) document.body.classList.remove('tp-locked');
        var modal = document.getElementById('tpGatekeeperModal');
        if (modal) modal.remove();
        var style = document.getElementById('tpGatekeeperStyle');
        if (style) style.remove();
        var boot = document.getElementById('tpGatekeeperBootScript');
        if (boot) boot.remove();
        var scriptEl = document.getElementById('tpGatekeeperScript');
        if (scriptEl) scriptEl.remove();
    } else {
        document.documentElement.classList.add('tp-locked');
        if (document.body) document.body.classList.add('tp-locked');
        tryFocusInput();
        setTimeout(tryFocusInput, 50);
        setTimeout(tryFocusInput, 200);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', tryFocusInput);
        }
        window.addEventListener('load', tryFocusInput);
    }
})();
</script>`;

    let res = html;
    if (/<head\b[^>]*>/i.test(res)) {
        res = res.replace(/<head\b[^>]*>/i, match => `${match}\n${bootScript}`);
    } else {
        res = `${bootScript}\n${res}`;
    }

    if (/<body\b[^>]*>/i.test(res)) {
        res = res.replace(/<body\b([^>]*)>/i, (match, attrs) => {
            let nextAttrs = attrs || '';
            if (/class\s*=\s*["']/i.test(nextAttrs)) {
                nextAttrs = nextAttrs.replace(/class\s*=\s*(["'])(.*?)\1/i, 'class=$1$2 tp-locked$1');
            } else {
                nextAttrs = ` class="tp-locked"${nextAttrs}`;
            }
            return `<body${nextAttrs}>`;
        });
    }

    const bodyMatches = [...res.matchAll(/<\/body\s*>/gi)];
    if (bodyMatches.length > 0) {
        const lastMatch = bodyMatches[bodyMatches.length - 1];
        const idx = lastMatch.index;
        res = res.slice(0, idx) + `${modalHtml}\n${script}\n` + res.slice(idx);
    } else {
        res = `${res}\n${modalHtml}\n${script}`;
    }

    return res;
}

// Remove only the publisher's legacy plaintext password overlay. Unified portal
// encryption remains responsible for private page access.
function stripLegacyGatekeeper(html) {
    let source = String(html);
    const modal = /<div\b[^>]*\bid=["']tpGatekeeperModal["'][^>]*>/i.exec(source);
    if (modal) {
        const tags = /<\/?div\b[^>]*>/gi;
        tags.lastIndex = modal.index;
        let depth = 0, match;
        while ((match = tags.exec(source))) {
            depth += /^<\//.test(match[0]) ? -1 : 1;
            if (!depth) { source = source.slice(0, modal.index) + source.slice(tags.lastIndex); break; }
        }
    }
    source = source.replace(/<(script|style)\b[^>]*\bid=["']tpGatekeeper(?:Style|BootScript|Script)["'][^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    return source.replace(/<(html|body)\b[^>]*>/gi, tag => tag.replace(/class=(["'])(.*?)\1/gi, (_, quote, classes) => 'class=' + quote + classes.split(/\s+/).filter(name => name !== 'tp-locked').join(' ') + quote));
}
module.exports = { injectGatekeeper, stripLegacyGatekeeper, GATEKEEPER_STYLE };

