// Runs inside the browser. Measures rendered text and placeholder contrast,
// including transparent ancestor backgrounds and disabled-control opacity.
module.exports = function auditContrast(scopeSelector = 'body') {
    const scope = document.querySelector(scopeSelector);
    if (!scope) throw Error('Missing audit scope: ' + scopeSelector);
    const failures = [], measurements = [];
    const rgba = value => {
        const values = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
        return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const blend = (front, back) => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])).concat(1);
    const background = el => {
        const ancestors = [];
        for (let current = el; current; current = current.parentElement) ancestors.unshift(current);
        let color = [255, 255, 255, 1];
        for (const current of ancestors) color = blend(rgba(getComputedStyle(current).backgroundColor), color);
        return color;
    };
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const describe = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    function measure(el, text, rect, pseudo = null) {
        if (!text.trim() || el.closest('script,style,noscript,[aria-hidden=true],#__tools_html_meta_watermark__')) return;
        const style = getComputedStyle(el, pseudo);
        if (style.visibility !== 'visible' || style.display === 'none') return;
        let opacity = 1;
        for (let current = el; current; current = current.parentElement) opacity *= Number(getComputedStyle(current).opacity);
        if (opacity === 0 || !rect.width || !rect.height) return;
        const bounds = el.getBoundingClientRect();
        const left = Math.max(0, rect.left, bounds.left), right = Math.min(innerWidth, rect.right, bounds.right);
        const top = Math.max(0, rect.top, bounds.top), bottom = Math.min(innerHeight, rect.bottom, bounds.bottom);
        if (right <= left || bottom <= top) return;
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) return;
        let fg = rgba(style.color);
        if (pseudo) fg[3] *= Number(style.opacity);
        fg[3] *= opacity;
        const bg = background(el), painted = blend(fg, bg);
        const l1 = luminance(painted), l2 = luminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const size = parseFloat(style.fontSize), weight = parseInt(style.fontWeight, 10) || 400;
        const threshold = size >= 24 || size >= 18.66 && weight >= 700 ? 3 : 4.5;
        const result = { element: describe(el), text: text.trim().slice(0, 80), ratio: +ratio.toFixed(2), threshold, foreground: style.color, background: bg.slice(0, 3).map(Math.round), disabled: el.matches(':disabled') };
        measurements.push(result);
        if (ratio + 0.01 < threshold) failures.push(result);
    }
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const text = walker.currentNode, el = text.parentElement;
        if (!el || el.closest('option')) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        measure(el, text.nodeValue, range.getBoundingClientRect());
    }
    for (const el of scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]),textarea,select')) {
        const text = el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent || '' : el.value;
        if (text) measure(el, text, el.getBoundingClientRect());
        else if (el.placeholder) measure(el, el.placeholder, el.getBoundingClientRect(), '::placeholder');
    }
    return { measured: measurements.length, failures, minimum: Math.min(...measurements.map(row => row.ratio)) };
};
