import { esc } from './diagram-kit.js';

// 全部状态由 options + t 推导；暂停、拖动与笔记回跳呈现同一帧。
export function createTeachingStage(container, definition) {
    const root = document.createElement('section');
    root.className = 'dk-teaching';
    root.tabIndex = 0;
    container.replaceChildren(root);
    const options = Object.fromEntries((definition.options || []).map((o) => [o.id, o.value]));
    let lesson,
        t = 0,
        playing = false,
        speed = 1,
        frame = 0,
        last = 0,
        disposed = false,
        visible = true,
        stepIndex = -1,
        selected = null;
    root.innerHTML = `<header class="dk-teaching-head"><div><span class="dk-eyebrow">PROTOCOL LAB / 协议推演</span><h3>${esc(definition.title)}</h3><p>${esc(definition.subtitle)}</p></div><span class="dk-teaching-tag">分步教学</span></header><div class="dk-lesson-options"></div><div class="dk-lesson-steps" aria-label="教学步骤"></div><div class="dk-lesson-layout"><div class="dk-lesson-canvas"><div class="dk-diagram-scroll" tabindex="0" aria-label="教学图，可横向滚动"></div><div class="dk-legend"><span class="active">● 当前步骤</span><span class="done">✓ 已经过</span><span class="blocked">× 不满足条件</span><span>箭头表示图中标明的信息或流量方向</span></div></div><aside class="dk-lesson-reading"><div class="dk-step-copy" aria-live="polite"></div><div class="dk-part-copy"></div></aside></div><div class="dk-lesson-controls"><button type="button" data-act="prev" aria-label="上一步">← 上一步</button><button type="button" data-act="play">播放演示</button><button type="button" data-act="next" aria-label="下一步">下一步 →</button><input type="range" min="0" max="1000" value="0" aria-label="演示进度" data-timeline><output data-progress></output><button type="button" data-act="speed">1×</button><button type="button" data-act="reset">重播</button><button type="button" data-act="fullscreen">放大</button></div><footer class="dk-lesson-footer"></footer>`;
    const q = (s) => root.querySelector(s);
    root.insertBefore(q('.dk-lesson-controls'), q('.dk-lesson-layout'));
    if (['packet-explode', 'rfc-diagram'].includes(definition.id))
        q('.dk-legend').innerHTML =
            '<span>顶部：行内 bit 编号</span><span>左侧：bit 偏移</span><span>字段宽度 = 位数 · 点击查看详情</span>';
    q('.dk-lesson-canvas').insertAdjacentHTML(
        'afterbegin',
        '<div class="dk-mobile-diagram-hint">图较宽，可左右滑动查看</div>',
    );
    const validate = (key, value) => {
        const o = (definition.options || []).find((x) => x.id === key);
        if (!o) return;
        if (o.type === 'range') {
            const n = Number(value);
            if (Number.isFinite(n)) {
                const step = o.step || 1;
                options[key] = Math.min(o.max, Math.max(o.min, o.min + Math.round((n - o.min) / step) * step));
            }
        } else {
            const choice = o.choices.find((c) => String(c.value) === String(value));
            if (choice) options[key] = choice.value;
        }
    };
    function renderOptions() {
        q('.dk-lesson-options').innerHTML = (definition.options || [])
            .map((o) =>
                o.type === 'range'
                    ? `<label>${esc(o.label)}<input data-option="${o.id}" type="range" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${options[o.id]}"><output>${esc(o.format ? o.format(options[o.id]) : options[o.id])}</output></label>`
                    : `<fieldset><legend>${esc(o.label)}</legend>${o.choices.map((c) => `<button type="button" data-option="${o.id}" data-value="${esc(c.value)}" aria-pressed="${String(options[o.id]) === String(c.value)}">${esc(c.label)}</button>`).join('')}</fieldset>`,
            )
            .join('');
    }
    function rebuild() {
        lesson = definition.build(options);
        t = 0;
        stepIndex = -1;
        selected = null;
        playing = false;
        renderOptions();
        q('.dk-lesson-steps').innerHTML = lesson.steps
            .map(
                (s, i) =>
                    `<button type="button" data-step="${i}"><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(s.title)}</span></button>`,
            )
            .join('');
        q('.dk-lesson-footer').innerHTML =
            `<div><b>记住这一点</b><p>${esc(lesson.takeaway)}</p></div><div><b>适用边界</b><p>${esc(lesson.caution)}</p></div><div class="dk-lesson-sources">${(definition.sources || []).map(([name, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a>`).join('')}</div>`;
        render();
    }
    function select(id) {
        const visible = [...root.querySelectorAll('[data-part]')].some((el) => el.dataset.part === id);
        selected = visible ? (lesson.parts || []).find((p) => p.id === id) || null : null;
        q('.dk-part-copy').innerHTML = selected
            ? `<span class="dk-eyebrow">图中对象</span><h4>${esc(selected.name)}</h4><p>${esc(selected.desc)}</p>${selected.rows ? `<dl>${selected.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}`
            : '<p class="dk-mini-note">点击图中节点或字段，查看它在协议中的作用。</p>';
        root.querySelectorAll('[data-part]').forEach((el) => el.classList.toggle('selected', el.dataset.part === id));
    }
    function render() {
        const scaled = t * lesson.steps.length,
            index = Math.min(lesson.steps.length - 1, Math.floor(scaled));
        if (index !== stepIndex) {
            stepIndex = index;
            const s = lesson.steps[index];
            q('.dk-diagram-scroll').innerHTML = lesson.diagram(index);
            q('.dk-step-copy').innerHTML =
                `<span class="dk-eyebrow">步骤 ${index + 1} / ${lesson.steps.length}</span><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p><div class="dk-step-result"><b>观察结果</b><p>${esc(s.result)}</p></div>`;
            root.querySelectorAll('[data-step]').forEach((b) => {
                b.setAttribute('aria-current', Number(b.dataset.step) === index ? 'step' : 'false');
                b.classList.toggle('is-done', Number(b.dataset.step) < index);
            });
            select(selected?.id);
        }
        const progress = t === 1 ? 1 : scaled - index;
        root.querySelectorAll('.dk-dedge.active').forEach((g) => {
            const p = g.querySelector('path'),
                dot = g.querySelector('.dk-traveler');
            if (!dot) return;
            const point = p.getPointAtLength(p.getTotalLength() * progress);
            dot.setAttribute('cx', point.x);
            dot.setAttribute('cy', point.y);
        });
        q('[data-timeline]').value = String(Math.round(t * 1000));
        q('[data-progress]').textContent = `${index + 1} / ${lesson.steps.length}`;
        q('[data-act="play"]').textContent = playing ? '暂停' : '播放演示';
        q('[data-act="prev"]').disabled = index === 0;
        q('[data-act="next"]').disabled = index === lesson.steps.length - 1;
    }
    const seek = (index) => {
        playing = false;
        t = Math.max(0, Math.min(lesson.steps.length - 1, index)) / lesson.steps.length;
        render();
    };
    root.addEventListener('click', (event) => {
        const option = event.target.closest('button[data-option]');
        if (option) {
            validate(option.dataset.option, option.dataset.value);
            rebuild();
            return;
        }
        const step = event.target.closest('[data-step]');
        if (step) {
            seek(Number(step.dataset.step));
            return;
        }
        const part = event.target.closest('[data-part]');
        if (part) {
            select(part.dataset.part);
            return;
        }
        const act = event.target.closest('[data-act]')?.dataset.act;
        if (act === 'prev') seek(stepIndex - 1);
        if (act === 'next') seek(stepIndex + 1);
        if (act === 'play') {
            if (t >= 1) t = 0;
            playing = !playing;
            last = 0;
            render();
        }
        if (act === 'reset') seek(0);
        if (act === 'speed') {
            speed = speed === 2 ? 0.5 : speed * 2;
            q('[data-act="speed"]').textContent = `${speed}×`;
        }
        if (act === 'fullscreen') {
            if (document.fullscreenElement === root) document.exitFullscreen?.();
            else root.requestFullscreen?.().catch(() => root.classList.toggle('is-expanded'));
        }
    });
    root.addEventListener('input', (event) => {
        if (event.target.matches('[data-timeline]')) {
            playing = false;
            t = Number(event.target.value) / 1000;
            render();
        }
        if (event.target.matches('input[data-option]')) {
            const key = event.target.dataset.option;
            validate(key, event.target.value);
            lesson = definition.build(options);
            stepIndex = -1;
            playing = false;
            event.target.nextElementSibling.textContent =
                definition.options.find((o) => o.id === key).format?.(options[key]) || options[key];
            render();
            q('.dk-lesson-footer p').textContent = lesson.takeaway;
        }
    });
    root.addEventListener('keydown', (event) => {
        if (event.target.closest('[data-part]') && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            select(event.target.closest('[data-part]').dataset.part);
            return;
        }
        if (event.target !== root) return;
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            seek(stepIndex + 1);
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            seek(stepIndex - 1);
        }
        if (event.key === ' ') {
            event.preventDefault();
            if (t >= 1) t = 0;
            playing = !playing;
            render();
        }
    });
    const observer = new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        last = 0;
    });
    observer.observe(root);
    function tick(now) {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        if (playing && visible && !document.hidden) {
            if (last) t = Math.min(1, t + (Math.min((now - last) / 1000, 0.1) * speed) / (lesson.steps.length * 5));
            if (t === 1) playing = false;
            render();
        }
        last = now;
    }
    rebuild();
    frame = requestAnimationFrame(tick);
    return {
        root,
        select,
        setOptions(values) {
            Object.entries(values || {}).forEach(([k, v]) => validate(k, v));
            rebuild();
        },
        getContext() {
            const s = lesson.steps[stepIndex];
            return {
                sceneId: definition.id,
                title: definition.title,
                subtitle: definition.subtitle,
                t,
                options: { ...options },
                step: { title: s.title, text: s.text },
                part: selected ? { ...selected, rows: (selected.rows || []).map(([k, v]) => `${k}：${v}`) } : null,
            };
        },
        restore(value = {}) {
            Object.entries(value.options || {}).forEach(([k, v]) => validate(k, v));
            rebuild();
            if (Number.isFinite(Number(value.t))) t = Math.max(0, Math.min(1, Number(value.t)));
            render();
            if (value.partId) select(value.partId);
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(frame);
            observer.disconnect();
            root.remove();
        },
    };
}
