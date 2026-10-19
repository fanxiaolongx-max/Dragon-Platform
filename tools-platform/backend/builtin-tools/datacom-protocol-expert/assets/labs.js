// 2D 交互实验室：适合用“动手算一算”理解的知识点。每个实验室 mount(container) 返回 { dispose }。
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const hex4 = value => value.toString(16).toUpperCase().padStart(4, '0');
const hex2 = value => value.toString(16).toUpperCase().padStart(2, '0');

function shell(container, lab, body) {
    container.innerHTML = `<div class="dk-lab"><header class="dk-lab-head"><div class="dk-hud-kicker">交互实验室</div><h3>${esc(lab.title)}</h3><p>${esc(lab.subtitle)}</p></header><div class="dk-lab-body">${body}</div></div>`;
    return container.querySelector('.dk-lab-body');
}

// ---------------- 校验和实验室 ----------------
function rfc1071Steps(words) {
    const steps = [];
    let sum = 0;
    words.forEach((word, index) => {
        const before = sum;
        sum += word;
        steps.push({ kind: 'add', index, word, before, sum, carry: sum > 0xFFFF && before <= 0xFFFF });
    });
    while (sum >> 16) {
        const high = sum >> 16;
        const low = sum & 0xFFFF;
        const next = low + high;
        steps.push({ kind: 'fold', high, low, sum: next });
        sum = next;
    }
    steps.push({ kind: 'invert', sum, result: (~sum) & 0xFFFF });
    return steps;
}

function parseHexWords(text) {
    const clean = String(text).replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    const padded = clean.length % 4 ? clean + '0'.repeat(4 - clean.length % 4) : clean;
    const words = [];
    for (let i = 0; i < padded.length; i += 4) words.push(parseInt(padded.slice(i, i + 4), 16));
    return words.slice(0, 64);
}

function parseHexBytes(text) {
    const clean = String(text).replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    const bytes = [];
    for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
    return bytes.slice(0, 256);
}

function fletcherCompute(bytes, checksumOffset = 16) {
    const data = bytes.slice();
    data[0] = 0; data[1] = 0;
    data[checksumOffset] = 0; data[checksumOffset + 1] = 0;
    let c0 = 0;
    let c1 = 0;
    const rows = data.map((byte, index) => { c0 = (c0 + byte) % 255; c1 = (c1 + c0) % 255; return { index, byte, c0, c1 }; });
    const n = data.length;
    const k = checksumOffset + 1;
    let x = ((n - k) * c0 - c1) % 255;
    if (x <= 0) x += 255;
    let y = (510 - c0 - x) % 255;
    if (y <= 0) y += 255;
    const verify = data.slice();
    verify[checksumOffset] = x; verify[checksumOffset + 1] = y;
    let v0 = 0;
    let v1 = 0;
    verify.forEach(byte => { v0 = (v0 + byte) % 255; v1 = (v1 + v0) % 255; });
    return { rows, x, y, checksum: (x << 8) | y, v0, v1 };
}

const checksumLab = {
    id: 'checksum-lab',
    title: '校验和实验室',
    subtitle: '亲手算一遍 RFC 1071 一的补码和与 Fletcher-16，并看清 CRC 与端到端校验和各自守护的范围。',
    mount(container) {
        const body = shell(container, this, `
            <div class="dk-tabs" role="tablist"><button class="is-active" data-tab="rfc">RFC 1071</button><button data-tab="fletcher">Fletcher-16 (LSA)</button><button data-tab="crc">CRC vs Checksum</button></div>
            <section data-panel="rfc">
                <div class="dk-form-row"><label>16 位字（十六进制）<input class="dk-input" data-rfc-input value="4500 003C 0000 F820 4000"></label>
                <label class="dk-check"><input type="checkbox" data-rfc-verify> 接收方核验（把算出的校验和填回第 3 个字）</label>
                <button class="dk-btn" data-rfc-step>单步 ▶</button><button class="dk-btn" data-rfc-play>自动演示</button><button class="dk-btn ghost" data-rfc-reset>重置</button></div>
                <div class="dk-calc" data-rfc-out></div>
            </section>
            <section data-panel="fletcher" hidden>
                <div class="dk-form-row"><label>LSA 字节（十六进制，含 20 字节头）<textarea class="dk-input" rows="3" data-fl-input>0000 0201 0101 0101 0101 0101 8000 0001 0000 0024 0000 0001 0A00 0000 FFFF FF00 0300 000A</textarea></label></div>
                <p class="dk-mini-note">计算前把 LS age（前 2 字节）与 Checksum（第 17、18 字节）置 0；接收方对整条 LSA 运算得到 C0 = C1 = 0 即通过。</p>
                <div class="dk-calc" data-fl-out></div>
            </section>
            <section data-panel="crc" hidden>
                <label class="dk-check"><input type="checkbox" data-crc-flip checked> 模拟中继路由器内存发生 1 位翻转</label>
                <div class="dk-crc-flow" data-crc-out></div>
                <button class="dk-btn" data-crc-play>播放传输过程</button>
            </section>`);
        let stepIndex = -1;
        let timer = null;
        const out = body.querySelector('[data-rfc-out]');
        const input = body.querySelector('[data-rfc-input]');
        const verify = body.querySelector('[data-rfc-verify]');
        const words = () => {
            const list = parseHexWords(input.value);
            if (verify.checked && list.length >= 3) {
                const sender = list.slice();
                sender[2] = 0;
                const result = rfc1071Steps(sender).at(-1).result;
                list[2] = result;
            }
            return list;
        };
        const renderRfc = () => {
            const list = words();
            const steps = rfc1071Steps(list);
            const shown = steps.slice(0, stepIndex + 1);
            const rows = shown.map((step, index) => {
                const active = index === stepIndex ? ' is-active' : '';
                if (step.kind === 'add') return `<tr class="${active}${step.carry ? ' has-carry' : ''}"><td>+ 字 ${step.index + 1}</td><td><code>0x${hex4(step.word)}</code></td><td><code>0x${step.sum.toString(16).toUpperCase().padStart(5, '0')}</code>${step.carry ? ' <em>产生第 17 位进位</em>' : ''}</td></tr>`;
                if (step.kind === 'fold') return `<tr class="${active} is-fold"><td>进位回卷</td><td><code>0x${hex4(step.low)} + 0x${hex4(step.high)}</code></td><td><code>0x${step.sum.toString(16).toUpperCase().padStart(4, '0')}</code></td></tr>`;
                const bits = (value, cls) => value.toString(2).padStart(16, '0').split('').map(bit => `<i class="${cls}">${bit}</i>`).join('');
                return `<tr class="${active} is-invert"><td>按位取反</td><td colspan="2"><div class="dk-bits">${bits(step.sum, 'a')}</div><div class="dk-bits">${bits(step.result, 'b')}</div></td></tr>`;
            }).join('');
            const final = steps.at(-1);
            const done = stepIndex >= steps.length - 1;
            const verdict = verify.checked
                ? `<div class="dk-result ${final.sum === 0xFFFF ? 'is-ok' : 'is-bad'}">累加结果 0x${hex4(final.sum)} ${final.sum === 0xFFFF ? '= 0xFFFF → 校验通过（取反为 0）' : '≠ 0xFFFF → 数据损坏'}</div>`
                : `<div class="dk-result is-ok">校验和 = <b>0x${hex4(final.result)}</b>，写入 Checksum 字段</div>`;
            out.innerHTML = `<table class="dk-calc-table"><thead><tr><th>步骤</th><th>操作数</th><th>累加器</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="dk-mini-note">点击“单步”开始</td></tr>'}</tbody></table>${done ? verdict : ''}`;
            return steps.length;
        };
        body.querySelector('[data-rfc-step]').addEventListener('click', () => { const total = renderRfc(); stepIndex = Math.min(total - 1, stepIndex + 1); renderRfc(); });
        body.querySelector('[data-rfc-reset]').addEventListener('click', () => { clearInterval(timer); stepIndex = -1; renderRfc(); });
        body.querySelector('[data-rfc-play]').addEventListener('click', () => {
            clearInterval(timer);
            stepIndex = -1;
            timer = setInterval(() => {
                const total = renderRfc();
                if (stepIndex >= total - 1) return clearInterval(timer);
                stepIndex += 1;
                renderRfc();
            }, 650);
        });
        [input, verify].forEach(element => element.addEventListener('input', () => { stepIndex = -1; renderRfc(); }));
        const flInput = body.querySelector('[data-fl-input]');
        const flOut = body.querySelector('[data-fl-out]');
        const renderFletcher = () => {
            const bytes = parseHexBytes(flInput.value);
            if (bytes.length < 20) { flOut.innerHTML = '<div class="dk-result is-bad">至少需要 20 字节 LSA 头部</div>'; return; }
            const result = fletcherCompute(bytes);
            const cells = result.rows.map(row => `<div class="dk-fl-cell${row.index < 2 || row.index === 16 || row.index === 17 ? ' is-zero' : ''}" title="字节 ${row.index + 1}"><b>${hex2(row.byte)}</b><span>C0 ${row.c0}</span><span>C1 ${row.c1}</span></div>`).join('');
            flOut.innerHTML = `<div class="dk-fl-grid">${cells}</div>
                <div class="dk-result is-ok">X = ((N−K)·C0 − C1) mod 255 = <b>0x${hex2(result.x)}</b>　Y = (510 − C0 − X) mod 255 = <b>0x${hex2(result.y)}</b>　→ LS checksum = <b>0x${hex4(result.checksum)}</b></div>
                <div class="dk-result ${result.v0 === 0 && result.v1 === 0 ? 'is-ok' : 'is-bad'}">接收方核验：C0 = ${result.v0}，C1 = ${result.v1} ${result.v0 === 0 && result.v1 === 0 ? '✓ 通过' : '✗'}</div>
                <p class="dk-mini-note">C1 是 C0 的累加，相当于给每个字节乘上位置权重：两个字节互换位置时 C1 一定变化，这正是普通累加和做不到的。</p>`;
        };
        flInput.addEventListener('input', renderFletcher);
        const crcOut = body.querySelector('[data-crc-out]');
        const flip = body.querySelector('[data-crc-flip]');
        let crcStage = 5;
        const crcStages = ['发送主机计算 IP/TCP 校验和', '网卡附加 CRC-32，线路 1 传输', '路由器核验并剥离 CRC，数据进入内存', '出接口为数据重新计算 CRC-32，线路 2 传输', '接收主机：CRC 通过，再核验端到端校验和'];
        const renderCrc = () => {
            const bad = flip.checked;
            const node = (title, index, extra = '') => `<div class="dk-crc-node${crcStage >= index ? ' is-on' : ''}"><strong>${title}</strong>${extra}</div>`;
            crcOut.innerHTML = `<div class="dk-crc-row">${node('发送主机', 0, '<span class="tag ok">Checksum ✓</span>')}<div class="dk-crc-wire${crcStage >= 1 ? ' is-on' : ''}"><span>CRC-32 #1 ✓</span></div>
                ${node('中继路由器', 2, bad && crcStage >= 2 ? '<span class="tag bad">内存位翻转 💥</span>' : '<span class="tag">转发</span>')}<div class="dk-crc-wire${crcStage >= 3 ? ' is-on' : ''}"><span>CRC-32 #2 ✓${bad ? '（为脏数据重算）' : ''}</span></div>
                ${node('接收主机', 4, crcStage >= 4 ? `<span class="tag ${bad ? 'bad' : 'ok'}">端到端 Checksum ${bad ? '✗ 拦截' : '✓'}</span>` : '')}</div>
                <div class="dk-crc-span"><i style="width:${crcStage >= 4 ? 100 : crcStage * 22}%"></i><span>端到端 Checksum 覆盖全路径</span></div>
                <div class="dk-mini-note">${crcStages[Math.min(crcStage, 4)]}</div>`;
        };
        let crcTimer = null;
        body.querySelector('[data-crc-play]').addEventListener('click', () => {
            clearInterval(crcTimer);
            crcStage = 0;
            renderCrc();
            crcTimer = setInterval(() => { crcStage += 1; renderCrc(); if (crcStage >= 4) clearInterval(crcTimer); }, 900);
        });
        flip.addEventListener('change', renderCrc);
        body.querySelector('.dk-tabs').addEventListener('click', event => {
            const tab = event.target.closest('[data-tab]');
            if (!tab) return;
            body.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('is-active', button === tab));
            body.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab.dataset.tab; });
        });
        renderRfc();
        renderFletcher();
        renderCrc();
        return { dispose() { clearInterval(timer); clearInterval(crcTimer); } };
    }
};

// ---------------- 智能定时器 ----------------
export function timerIntervals({ max, start, hold, count, mode }) {
    const list = [];
    let n = 1;
    let atMax = 0;
    for (let i = 0; i < count; i += 1) {
        let value = n === 1 ? start : Math.min(max, hold * Math.pow(2, n - 2));
        if (mode === 'lsa' && value >= max) {
            atMax += 1;
            if (atMax > 3) { n = 1; atMax = 0; value = start; }
        }
        list.push(value);
        n += 1;
    }
    return list;
}

const timerLab = {
    id: 'timer-lab',
    title: '智能定时器 · 指数退避',
    subtitle: '第 1 次用 start，第 n 次用 hold×2^(n−2)，封顶 max。SPF 一直保持最大值直到网络安静；LSA 产生/接收在最大值连续 3 次后复位。',
    mount(container) {
        const presets = {
            spf: { max: 5000, start: 50, hold: 200, mode: 'spf', label: 'SPF 缺省 5000/50/200' },
            orig: { max: 5000, start: 500, hold: 1000, mode: 'lsa', label: 'LSA 产生 5000/500/1000' },
            arr: { max: 1000, start: 500, hold: 500, mode: 'lsa', label: 'LSA 接收 1000/500/500' },
            fast: { max: 2000, start: 10, hold: 50, mode: 'spf', label: '激进模板 2000/10/50' }
        };
        const body = shell(container, this, `
            <div class="dk-chip-row">${Object.entries(presets).map(([id, preset]) => `<button class="dk-chip" data-preset="${id}">${preset.label}</button>`).join('')}</div>
            <div class="dk-form-row">
                <label>max-interval (ms)<input class="dk-input" type="number" data-k="max" min="1"></label>
                <label>start-interval (ms)<input class="dk-input" type="number" data-k="start" min="0"></label>
                <label>hold-interval (ms)<input class="dk-input" type="number" data-k="hold" min="1"></label>
                <label>连续触发次数<input class="dk-input" type="number" data-k="count" min="1" max="16"></label>
                <label>复位规则<select class="dk-input" data-k="mode"><option value="spf">SPF：保持最大直到安静</option><option value="lsa">LSA：最大值 3 次后复位</option></select></label>
            </div>
            <div class="dk-bars" data-out></div>
            <p class="dk-mini-note" data-note></p>`);
        const state = { ...presets.spf, count: 10 };
        const render = () => {
            body.querySelectorAll('[data-k]').forEach(input => { input.value = state[input.dataset.k]; });
            const list = timerIntervals(state);
            const peak = Math.max(...list, 1);
            let total = 0;
            body.querySelector('[data-out]').innerHTML = list.map((value, index) => {
                total += value;
                return `<div class="dk-bar${value >= state.max ? ' is-max' : ''}${index && value === state.start && list[index - 1] >= state.max ? ' is-reset' : ''}"><i style="height:${Math.max(3, value / peak * 100)}%"></i><b>${value}</b><span>#${index + 1}</span></div>`;
            }).join('');
            body.querySelector('[data-note]').textContent = `${state.count} 次连续变化累计等待 ${total} ms。${state.mode === 'spf' ? '超过 max-interval 且无新震荡后，才退出退避重新从 start 开始。' : '红色复位柱表示连续 3 次最大间隔后回到 start-interval。'}`;
        };
        body.addEventListener('input', event => {
            const key = event.target.dataset.k;
            if (!key) return;
            state[key] = key === 'mode' ? event.target.value : Math.max(0, Number(event.target.value) || 0);
            render();
        });
        body.addEventListener('click', event => {
            const id = event.target.closest('[data-preset]')?.dataset.preset;
            if (!id) return;
            Object.assign(state, presets[id]);
            render();
        });
        render();
        return { dispose() {} };
    }
};

// ---------------- LSA 新旧仲裁 ----------------
const toSigned = value => {
    const n = parseInt(String(value).replace(/^0x/i, ''), 16) >>> 0;
    return n > 0x7FFFFFFF ? n - 0x100000000 : n;
};

export function arbitrate(a, b) {
    const steps = [];
    const sa = toSigned(a.seq);
    const sb = toSigned(b.seq);
    if (sa !== sb) { steps.push({ rule: '① 序列号', result: sa > sb ? 'A 更新' : 'B 更新', decided: true }); return { steps, winner: sa > sb ? 'A' : 'B' }; }
    steps.push({ rule: '① 序列号', result: '相同', decided: false });
    const ca = parseInt(String(a.checksum).replace(/^0x/i, ''), 16) || 0;
    const cb = parseInt(String(b.checksum).replace(/^0x/i, ''), 16) || 0;
    if (ca !== cb) { steps.push({ rule: '② 校验和', result: ca > cb ? 'A 更大 → A 更新' : 'B 更大 → B 更新', decided: true }); return { steps, winner: ca > cb ? 'A' : 'B' }; }
    steps.push({ rule: '② 校验和', result: '相同', decided: false });
    const aa = Number(a.age);
    const ab = Number(b.age);
    if ((aa === 3600) !== (ab === 3600)) { steps.push({ rule: '③ MaxAge', result: aa === 3600 ? 'A 为 3600s → A 视为最新（毒化撤销）' : 'B 为 3600s → B 视为最新（毒化撤销）', decided: true }); return { steps, winner: aa === 3600 ? 'A' : 'B' }; }
    steps.push({ rule: '③ MaxAge', result: '均非 3600s（或均为 3600s）', decided: false });
    if (Math.abs(aa - ab) > 900) { steps.push({ rule: '④ Age 差值', result: `|${aa}−${ab}| > 900s → Age 小者更新`, decided: true }); return { steps, winner: aa < ab ? 'A' : 'B' }; }
    steps.push({ rule: '④ Age 差值', result: `|${aa}−${ab}| ≤ 900s → 视为同一实例`, decided: true });
    return { steps, winner: 'same' };
}

const lsaArbiter = {
    id: 'lsa-arbiter',
    title: 'LSA 新旧仲裁器',
    subtitle: '三元组相同的两条 LSA 谁更新？依次比较：序列号 → 校验和 → MaxAge → Age 差值是否超过 15 分钟。',
    mount(container) {
        const presets = [
            ['序列号更大', { seq: '80000005', checksum: '1A2B', age: 300 }, { seq: '80000006', checksum: '0F00', age: 10 }],
            ['校验和决胜', { seq: '80000006', checksum: '3C4D', age: 20 }, { seq: '80000006', checksum: '2B11', age: 20 }],
            ['MaxAge 毒化', { seq: '80000006', checksum: '3C4D', age: 120 }, { seq: '80000006', checksum: '3C4D', age: 3600 }],
            ['Age 差 > 900', { seq: '80000006', checksum: '3C4D', age: 1500 }, { seq: '80000006', checksum: '3C4D', age: 200 }],
            ['视为相同实例', { seq: '80000006', checksum: '3C4D', age: 700 }, { seq: '80000006', checksum: '3C4D', age: 200 }],
            ['负数序列号', { seq: '7FFFFFF0', checksum: '0001', age: 5 }, { seq: '80000001', checksum: '0001', age: 5 }]
        ];
        const card = (id, label) => `<div class="dk-lsa-card" data-card="${id}"><h4>${label}</h4>
            <label>LS sequence (hex)<input class="dk-input" data-f="seq"></label>
            <label>LS checksum (hex)<input class="dk-input" data-f="checksum"></label>
            <label>LS age (s)<input class="dk-input" type="number" min="0" max="3600" data-f="age"></label></div>`;
        const body = shell(container, this, `<div class="dk-chip-row">${presets.map(([name], index) => `<button class="dk-chip" data-p="${index}">${name}</button>`).join('')}</div>
            <div class="dk-lsa-pair">${card('A', 'LSDB 中已有的 A')}${card('B', '新收到的 B')}</div><div class="dk-arbiter" data-out></div>`);
        const values = { A: { ...presets[0][1] }, B: { ...presets[0][2] } };
        const render = () => {
            ['A', 'B'].forEach(id => body.querySelectorAll(`[data-card="${id}"] [data-f]`).forEach(input => { input.value = values[id][input.dataset.f]; }));
            const { steps, winner } = arbitrate(values.A, values.B);
            const verdict = winner === 'same' ? '两者视为同一实例：丢弃新收到的副本，不触发 SPF' : `${winner} 更新${winner === 'B' ? '：写入 LSDB 并继续泛洪' : '：本地更新，向对方回送自己的版本'}`;
            body.querySelector('[data-out]').innerHTML = `<ol class="dk-arbiter-steps">${steps.map(step => `<li class="${step.decided ? 'is-decided' : ''}"><strong>${step.rule}</strong><span>${esc(step.result)}</span></li>`).join('')}</ol><div class="dk-result ${winner === 'same' ? 'is-warn' : 'is-ok'}">${verdict}</div><p class="dk-mini-note">序列号是有符号 32 位：0x80000001 是最小可用值，0x7FFFFFFF 最大。</p>`;
        };
        body.addEventListener('input', event => {
            const field = event.target.dataset.f;
            if (!field) return;
            const id = event.target.closest('[data-card]').dataset.card;
            values[id][field] = field === 'age' ? Math.min(3600, Math.max(0, Number(event.target.value) || 0)) : event.target.value.trim();
            const { steps, winner } = arbitrate(values.A, values.B);
            body.querySelector('[data-out]').innerHTML = `<ol class="dk-arbiter-steps">${steps.map(step => `<li class="${step.decided ? 'is-decided' : ''}"><strong>${step.rule}</strong><span>${esc(step.result)}</span></li>`).join('')}</ol><div class="dk-result ${winner === 'same' ? 'is-warn' : 'is-ok'}">${winner === 'same' ? '视为同一实例' : `${winner} 更新`}</div>`;
        });
        body.addEventListener('click', event => {
            const index = event.target.closest('[data-p]')?.dataset.p;
            if (index === undefined) return;
            values.A = { ...presets[index][1] };
            values.B = { ...presets[index][2] };
            render();
        });
        render();
        return { dispose() {} };
    }
};

// ---------------- 前缀列表匹配 ----------------
const ipToInt = ip => String(ip).split('.').reduce((sum, part) => (sum << 8) + (Number(part) & 255), 0) >>> 0;

export function prefixMatch(rule, route) {
    const len = Number(rule.len);
    const hasGe = rule.ge !== '' && rule.ge !== undefined && rule.ge !== null;
    const hasLe = rule.le !== '' && rule.le !== undefined && rule.le !== null;
    const ge = hasGe ? Number(rule.ge) : len;
    const le = hasLe ? Number(rule.le) : (hasGe ? 32 : len);
    const mask = len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0;
    const bitsOk = ((ipToInt(rule.prefix) & mask) >>> 0) === ((ipToInt(route.prefix) & mask) >>> 0);
    const lenOk = Number(route.len) >= ge && Number(route.len) <= le;
    return { bitsOk, lenOk, ge, le, match: bitsOk && lenOk };
}

const prefixMatcher = {
    id: 'prefix-matcher',
    title: '前缀列表匹配器 (ip-prefix)',
    subtitle: '前 N 位必须相同，且路由掩码长度落在 [ge, le] 内；不写 ge/le 时是“精确匹配掩码长度”。',
    mount(container) {
        const presets = [
            ['1.1.0.0 16（精确）', { prefix: '1.1.0.0', len: 16, ge: '', le: '' }],
            ['1.1.0.0 16 le 24', { prefix: '1.1.0.0', len: 16, ge: '', le: 24 }],
            ['1.1.1.0 24', { prefix: '1.1.1.0', len: 24, ge: '', le: '' }],
            ['1.1.1.1 32', { prefix: '1.1.1.1', len: 32, ge: '', le: '' }],
            ['0.0.0.0 0 le 32（Any）', { prefix: '0.0.0.0', len: 0, ge: '', le: 32 }]
        ];
        const body = shell(container, this, `<div class="dk-chip-row">${presets.map(([name], index) => `<button class="dk-chip" data-p="${index}">${esc(name)}</button>`).join('')}</div>
            <div class="dk-form-row">
                <label>规则前缀<input class="dk-input" data-r="prefix"></label><label>前缀长度<input class="dk-input" type="number" min="0" max="32" data-r="len"></label>
                <label>greater-equal<input class="dk-input" type="number" min="0" max="32" data-r="ge" placeholder="不填"></label><label>less-equal<input class="dk-input" type="number" min="0" max="32" data-r="le" placeholder="不填"></label>
                <label>待匹配路由<input class="dk-input" data-x="prefix"></label><label>掩码长度<input class="dk-input" type="number" min="0" max="32" data-x="len"></label>
            </div><div data-out></div>`);
        const state = { rule: { ...presets[0][1] }, route: { prefix: '1.1.1.0', len: 24 } };
        const bits = (ip, len, compare) => ipToInt(ip).toString(2).padStart(32, '0').split('').map((bit, index) => {
            const other = compare ? ipToInt(compare).toString(2).padStart(32, '0')[index] : bit;
            const cls = index < len ? (bit === other ? 'fix ok' : 'fix bad') : 'free';
            return `<i class="${cls}${index % 8 === 7 ? ' gap' : ''}">${bit}</i>`;
        }).join('');
        const render = () => {
            body.querySelectorAll('[data-r]').forEach(input => { input.value = state.rule[input.dataset.r]; });
            body.querySelectorAll('[data-x]').forEach(input => { input.value = state.route[input.dataset.x]; });
            const result = prefixMatch(state.rule, state.route);
            const len = Number(state.rule.len);
            const marks = Array.from({ length: 33 }, (_, index) => `<i class="${index >= result.ge && index <= result.le ? 'in' : ''}${index === Number(state.route.len) ? ' here' : ''}" title="/${index}"></i>`).join('');
            body.querySelector('[data-out]').innerHTML = `
                <div class="dk-bitrow"><span>规则</span><div class="dk-bits wide">${bits(state.rule.prefix, len)}</div></div>
                <div class="dk-bitrow"><span>路由</span><div class="dk-bits wide">${bits(state.route.prefix, len, state.rule.prefix)}</div></div>
                <div class="dk-result ${result.bitsOk ? 'is-ok' : 'is-bad'}">前 ${len} 位 ${result.bitsOk ? '一致 ✓' : '不一致 ✗'}</div>
                <div class="dk-lenbar">${marks}</div><div class="dk-mini-note">允许的掩码长度：/${result.ge} ~ /${result.le}，路由为 /${state.route.len}</div>
                <div class="dk-result ${result.lenOk ? 'is-ok' : 'is-bad'}">掩码长度 ${result.lenOk ? '在范围内 ✓' : '超出范围 ✗'}</div>
                <div class="dk-result big ${result.match ? 'is-ok' : 'is-bad'}">${result.match ? '匹配 MATCH' : '不匹配 NO MATCH'}</div>`;
        };
        body.addEventListener('input', event => {
            const key = event.target.dataset.r || event.target.dataset.x;
            if (!key) return;
            const target = event.target.dataset.r ? state.rule : state.route;
            target[key] = key === 'prefix' ? event.target.value.trim() : (event.target.value === '' ? '' : Math.min(32, Math.max(0, Number(event.target.value))));
            const result = prefixMatch(state.rule, state.route);
            body.querySelector('[data-out] .dk-result.big').className = `dk-result big ${result.match ? 'is-ok' : 'is-bad'}`;
            body.querySelector('[data-out] .dk-result.big').textContent = result.match ? '匹配 MATCH' : '不匹配 NO MATCH';
        });
        body.addEventListener('change', render);
        body.addEventListener('click', event => {
            const index = event.target.closest('[data-p]')?.dataset.p;
            if (index === undefined) return;
            state.rule = { ...presets[index][1] };
            render();
        });
        render();
        return { dispose() {} };
    }
};

// ---------------- Router-ID 选举 ----------------
export function electRouterId({ processId, globalId, interfaces }) {
    if (processId) return { id: processId, reason: '进程下手工配置（最高优先级）' };
    if (globalId) return { id: globalId, reason: '全局 router id' };
    const up = interfaces.filter(item => item.up && item.ip);
    const best = list => list.sort((a, b) => ipToInt(b.ip) - ipToInt(a.ip))[0];
    const loop = best(up.filter(item => item.loopback));
    if (loop) return { id: loop.ip, reason: `Up 状态 Loopback 中 IP 最大：${loop.name}` };
    const other = best(up.filter(item => !item.loopback));
    if (other) return { id: other.ip, reason: `Up 状态普通接口中 IP 最大：${other.name}` };
    return { id: '0.0.0.0', reason: '没有任何活跃 IP，进程挂起无法建邻' };
}

const ridLab = {
    id: 'rid-lab',
    title: 'Router-ID 选举模拟',
    subtitle: '进程配置 > 全局配置 > 最大 Loopback > 最大接口 IP；选定后非抢占，必须 reset ospf process 才会重选。',
    mount(container) {
        const state = {
            processId: '', globalId: '', running: null,
            interfaces: [
                { name: 'LoopBack0', ip: '10.255.0.1', loopback: true, up: true },
                { name: 'LoopBack1', ip: '10.255.0.9', loopback: true, up: false },
                { name: 'GE0/0/1', ip: '192.168.1.1', loopback: false, up: true },
                { name: 'GE0/0/2', ip: '172.16.0.1', loopback: false, up: true }
            ]
        };
        const body = shell(container, this, `<div class="dk-form-row"><label>ospf 1 router-id<input class="dk-input" data-k="processId" placeholder="未配置"></label><label>全局 router id<input class="dk-input" data-k="globalId" placeholder="未配置"></label></div>
            <table class="dk-calc-table"><thead><tr><th>接口</th><th>IP</th><th>类型</th><th>状态</th></tr></thead><tbody data-ifs></tbody></table>
            <div class="dk-form-row"><button class="dk-btn" data-act="start">启动 OSPF 进程</button><button class="dk-btn ghost" data-act="reset">reset ospf 1 process</button></div><div data-out></div>`);
        const render = () => {
            body.querySelector('[data-ifs]').innerHTML = state.interfaces.map((item, index) => `<tr><td>${item.name}</td><td><input class="dk-input slim" data-ip="${index}" value="${esc(item.ip)}"></td><td>${item.loopback ? 'Loopback' : '物理'}</td><td><button class="dk-chip ${item.up ? 'is-on' : ''}" data-up="${index}">${item.up ? 'Up' : 'Down'}</button></td></tr>`).join('');
            const candidate = electRouterId(state);
            const pending = state.running && state.running.id !== candidate.id;
            body.querySelector('[data-out]').innerHTML = `<div class="dk-result is-ok">按当前配置应选：<b>${candidate.id}</b>（${candidate.reason}）</div>
                ${state.running ? `<div class="dk-result ${pending ? 'is-warn' : 'is-ok'}">运行中的 Router-ID：<b>${state.running.id}</b>${pending ? ' — 新值仅进入“待生效区”，需在维护窗口执行 reset ospf process' : ''}</div>` : '<div class="dk-mini-note">进程尚未启动。</div>'}`;
        };
        body.addEventListener('input', event => {
            if (event.target.dataset.k) state[event.target.dataset.k] = event.target.value.trim();
            if (event.target.dataset.ip) state.interfaces[event.target.dataset.ip].ip = event.target.value.trim();
            const candidate = electRouterId(state);
            const out = body.querySelector('[data-out] .dk-result b');
            if (out) out.textContent = candidate.id;
        });
        body.addEventListener('change', render);
        body.addEventListener('click', event => {
            const up = event.target.closest('[data-up]')?.dataset.up;
            if (up !== undefined) { state.interfaces[up].up = !state.interfaces[up].up; render(); }
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (act === 'start' && !state.running) { state.running = electRouterId(state); render(); }
            if (act === 'reset') { state.running = electRouterId(state); render(); }
        });
        render();
        return { dispose() {} };
    }
};

export const labs = [checksumLab, timerLab, lsaArbiter, prefixMatcher, ridLab];
