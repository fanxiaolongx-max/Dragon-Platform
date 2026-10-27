// @Skill 选择器只插入引用，实际加载与权限校验由后端完成。
(function () {
    'use strict';
    const en = () => window.ToolsI18n?.getLanguage?.() === 'en-US';
    const words = (zh, english) => en() ? english : zh;
    let input, menu, items = [], matches = [], active = 0, loading = false, loaded = false, failed = false, composing = false;
    // 会话内保持的 Skill：发送过的 @id 之后的消息继续生效，显示为输入框上方的标签，可移除
    let kept = [], chips = null, discover = null, restoreEpoch = 0;
    const pendingDecorate = new Set();
    // 与后端 agent-skills.js 的 mentions() 一致：中文可紧贴，邮箱、路径、扩展名不算
    const MENTION_RE = /(?<![A-Za-z0-9_.\\/@-])@([A-Za-z][A-Za-z0-9-]*)(?![A-Za-z0-9_\\/-]|\.[A-Za-z0-9])/g;
    const metaOf = id => items.find(item => item.id === id);
    const skillLabel = id => { const item = metaOf(id); return item ? `@${id} · ${en() ? item.nameEn : item.name}` : `@${id}`; };

    function mentionIds(text) {
        return [...new Set(Array.from(String(text || '').matchAll(MENTION_RE), match => match[1].toLowerCase()))];
    }

    function token() {
        if (!input || input.selectionStart !== input.selectionEnd) return null;
        const before = input.value.slice(0, input.selectionStart);
        const match = before.match(/(?:^|\s)@([^\s@]*)$/);
        return match ? { start: before.length - match[1].length - 1, end: input.selectionStart, query: match[1].toLowerCase() } : null;
    }
    function close() {
        if (!menu) return;
        menu.hidden = true;
        matches = [];
        if (input.getAttribute('aria-controls') !== menu.id) return;
        const slash = document.getElementById('dcSlashMenu');
        const slashActive = slash && !slash.hidden ? slash.querySelector('.is-active') : null;
        input.removeAttribute('aria-activedescendant');
        if (slashActive?.id) input.setAttribute('aria-activedescendant', slashActive.id);
        input.setAttribute('aria-expanded', String(Boolean(slash && !slash.hidden)));
        input.setAttribute('aria-controls', 'dcSlashMenu');
    }
    function highlight(index) {
        if (!matches.length) return;
        active = (index + matches.length) % matches.length;
        menu.querySelectorAll('[data-skill-index]').forEach(node => {
            const selected = Number(node.dataset.skillIndex) === active;
            node.classList.toggle('is-active', selected);
            node.setAttribute('aria-selected', String(selected));
            if (selected) node.scrollIntoView({ block: 'nearest' });
        });
        input.setAttribute('aria-activedescendant', `dcSkillOption${active}`);
    }
    function render() {
        const current = token();
        if (composing || input.disabled || !current) return close();
        const previous = matches[active]?.id;
        matches = items.filter(item => [item.id, item.name, item.nameEn, item.description, item.descriptionEn].some(text => String(text).toLowerCase().includes(current.query)));
        menu.replaceChildren();
        const title = document.createElement('div');
        title.className = 'dc-skill-caption';
        title.textContent = words('Skills · 仅用于本条消息（全部工具 → 技能 可管理）', 'Skills · This message only (manage in All tools → Skills)');
        menu.appendChild(title);
        matches.forEach((item, index) => {
            const option = document.createElement('button');
            option.type = 'button'; option.className = 'dc-skill-option'; option.id = `dcSkillOption${index}`;
            option.dataset.skillIndex = String(index); option.tabIndex = -1; option.setAttribute('role', 'option');
            const label = document.createElement('b'), description = document.createElement('span');
            label.textContent = `${item.icon ? `${item.icon} ` : ''}@${item.id} · ${en() ? item.nameEn : item.name}`;
            description.textContent = en() ? item.descriptionEn : item.description;
            option.append(label, description);
            if (item.workspace && !window.DragonClawWorkspace?.getWorkspacePayload?.()) {
                const hint = document.createElement('small');
                hint.textContent = words('需选择工作目录', 'Choose a workspace folder'); option.appendChild(hint);
            }
            menu.appendChild(option);
        });
        const hint = document.createElement('div'); hint.className = 'dc-skill-caption';
        hint.textContent = loading ? words('正在加载…', 'Loading…') : failed ? words('加载失败，点击重试', 'Could not load. Click to retry')
            : !matches.length ? words('没有匹配的 Skill', 'No matching Skills') : words('↑↓ 选择 · Enter / Tab 插入 · Esc 关闭', '↑↓ to choose · Enter / Tab to insert · Esc to close');
        if (failed) { hint.tabIndex = 0; hint.setAttribute('role', 'button'); hint.onclick = load; hint.onkeydown = event => { if (event.key === 'Enter') load(); }; }
        menu.appendChild(hint); menu.hidden = false;
        const formTop = input.closest('form').getBoundingClientRect().top;
        const rootTop = document.getElementById('dragonClaw').getBoundingClientRect().top;
        menu.style.maxHeight = `${Math.max(100, Math.min(420, window.innerHeight * .55, formTop - Math.max(0, rootTop) - 14))}px`;
        input.setAttribute('aria-controls', menu.id); input.setAttribute('aria-expanded', 'true'); input.removeAttribute('aria-activedescendant');
        highlight(Math.max(0, matches.findIndex(item => item.id === previous)));
    }
    async function load() {
        if (loading || loaded) return;
        loading = true; failed = false; render();
        try {
            const auth = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
            const response = await fetch('/api/ai/skills', { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
            if (!response.ok) throw new Error('Skills unavailable');
            const data = await response.json();
            if (!Array.isArray(data.items)) throw new Error('Invalid skill catalog');
            items = data.items; loaded = true;
        } catch { failed = true; } finally { loading = false; render(); }
        if (loaded) {
            pendingDecorate.forEach(message => decorateUser(message));
            pendingDecorate.clear();
            renderChips();
            updateDiscover();
        }
    }

    function renderChips() {
        if (!chips) return;
        chips.replaceChildren();
        chips.hidden = !kept.length;
        if (!kept.length) return;
        const lead = document.createElement('span');
        lead.className = 'dc-skill-chips-lead';
        lead.textContent = words('本对话持续使用', 'Active in this chat');
        chips.appendChild(lead);
        kept.forEach(id => {
            const chip = document.createElement('span');
            chip.className = 'dc-skill-chip';
            chip.title = words('后续消息都会加载该 Skill，点 × 停用', 'Loaded for every following message. Click × to stop');
            const text = document.createElement('span');
            text.textContent = skillLabel(id);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.dataset.skillRemove = id;
            remove.setAttribute('aria-label', words(`停用 @${id}`, `Stop using @${id}`));
            remove.textContent = '×';
            chip.append(text, remove);
            chips.appendChild(chip);
        });
    }

    function keep(ids) {
        let changed = false;
        ids.forEach(id => { if (id && !kept.includes(id)) { kept.push(id); changed = true; } });
        if (changed) renderChips();
    }

    // 恢复历史对话：重新保持其中用过的 Skill；需要工作目录的不自动恢复（目录可能已不在），避免下一条直接报错
    async function restore(ids) {
        const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id))];
        if (!wanted.length) return;
        const epoch = ++restoreEpoch;
        await load();
        for (let waited = 0; loading && waited < 100; waited += 1) await new Promise(resolve => setTimeout(resolve, 100)); // 目录正由别处加载
        if (epoch !== restoreEpoch || !loaded) return;
        keep(wanted.filter(id => items.some(item => item.id === id && !item.workspace)));
    }

    function reset() {
        restoreEpoch += 1;
        kept = [];
        renderChips();
        updateDiscover();
    }

    // 输入框下方提示：平时提示「输入 @ 使用 Skill」，写错名字时提示未识别（目录加载后才判断）
    function updateDiscover() {
        if (!discover || !input) return;
        const ids = mentionIds(input.value);
        if (ids.length && !loaded && !loading && !failed) load();
        const unknown = loaded ? ids.filter(id => !metaOf(id) && !window.HomeAgentDiscussion?.isAgentMention?.(id,input.value)) : [];
        discover.classList.toggle('is-warn', unknown.length > 0);
        discover.textContent = unknown.length
            ? words(`未识别的 Skill：${unknown.map(id => `@${id}`).join('、')}，发送后不会加载（输入 @ 查看可用列表）`, `Unknown Skill: ${unknown.map(id => `@${id}`).join(', ')} will not be loaded (type @ to see the list)`)
            : words('输入 @ 使用 Skill', 'Type @ to use a Skill');
    }

    // 用户消息里的已知 @id 显示为高亮标签（只拆分文本节点，不注入 HTML）
    function decorateUser(message) {
        const body = message?.querySelector?.('.dc-msg-body');
        if (!body || body.dataset.skillDecorated) return;
        const text = body.textContent;
        if (!mentionIds(text).length) return;
        if (!loaded) { pendingDecorate.add(message); load(); return; }
        const fragment = document.createDocumentFragment();
        let last = 0;
        for (const match of text.matchAll(MENTION_RE)) {
            if (!metaOf(match[1].toLowerCase())) continue;
            fragment.append(text.slice(last, match.index));
            const mark = document.createElement('span');
            mark.className = 'dc-skill-mention';
            mark.title = skillLabel(match[1].toLowerCase());
            mark.textContent = match[0];
            fragment.append(mark);
            last = match.index + match[0].length;
        }
        if (!last) return;
        fragment.append(text.slice(last));
        body.replaceChildren(fragment);
        body.dataset.skillDecorated = '1';
    }

    function badge(message, ids = [], unknown = []) {
        if (!message || (!ids.length && !unknown.length) || message.querySelector('.dc-skill-used')) return;
        const node = document.createElement('div');
        node.className = 'dc-skill-used';
        const parts = [];
        if (ids.length) parts.push(`${words('已加载 Skill', 'Skill loaded')}: ${ids.map(id => `@${id}`).join(' · ')}`);
        if (unknown.length) parts.push(`${words('未识别', 'Unknown')}: ${unknown.map(id => `@${id}`).join(' · ')}`);
        node.textContent = parts.join('　');
        if (unknown.length) node.classList.add('has-unknown');
        message.querySelector('.dc-msg-main')?.prepend(node);
    }
    function choose(index) {
        const item = matches[index], current = token();
        if (!item || !current) return;
        const tail = input.value.slice(current.end).match(/^[a-z0-9-]*/i)[0];
        input.setRangeText(`@${item.id} `, current.start, current.end + tail.length, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true })); close(); input.focus({ preventScroll: true });
    }
    function handleEvent(message, event) {
        if (event.type !== 'start') return;
        const ids = (event.skills || []).map(item => item.id);
        badge(message, ids, event.unknownSkills || []);
        keep(ids); // 加载过的 Skill 在本对话后续消息里继续生效
    }
    function init() {
        input = document.getElementById('dcInput');
        const form = document.getElementById('dcComposer'); if (!input || !form) return;
        menu = document.createElement('div'); menu.id = 'dcSkillMenu'; menu.className = 'dc-skill-menu';
        menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', 'Skills'); menu.hidden = true; form.appendChild(menu);
        input.addEventListener('input', event => {
            updateDiscover();
            if (event.isComposing || composing) return;
            if (token() && !loaded && !loading && !failed) load(); else render();
        });
        input.addEventListener('click', render);
        input.addEventListener('compositionstart', () => { composing = true; close(); });
        input.addEventListener('compositionend', () => { composing = false; if (!loaded && !loading && token()) load(); else render(); });
        input.addEventListener('keydown', event => {
            // 输入框为空时按退格：停用最后一个保持的 Skill（与常见标签输入一致）
            if (event.key === 'Backspace' && menu.hidden && !input.value && kept.length && !event.isComposing) {
                event.preventDefault();
                kept.pop();
                renderChips();
                return;
            }
            if (menu.hidden || event.isComposing || composing) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
            else if (matches.length && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key) && !event.shiftKey) {
                event.preventDefault(); event.stopImmediatePropagation();
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') highlight(active + (event.key === 'ArrowDown' ? 1 : -1)); else choose(active);
            }
        }, true);
        menu.addEventListener('mousedown', event => event.preventDefault());
        menu.addEventListener('pointermove', event => { const option = event.target.closest('[data-skill-index]'); if (option && Number(option.dataset.skillIndex) !== active) highlight(Number(option.dataset.skillIndex)); });
        menu.addEventListener('click', event => { const option = event.target.closest('[data-skill-index]'); if (option) choose(Number(option.dataset.skillIndex)); });
        document.addEventListener('click', event => { if (event.target !== input && !menu.contains(event.target)) close(); });
        form.addEventListener('submit', close);
        document.getElementById('dcNewChat')?.addEventListener('click', close);
        window.addEventListener('tools:languagechange', () => { if (!menu.hidden) render(); });
        window.addEventListener('resize', () => { if (!menu.hidden) render(); });
        discover = document.createElement('span'); discover.className = 'dc-skill-discover'; discover.setAttribute('aria-live', 'polite');
        form.appendChild(discover); updateDiscover();
        chips = document.createElement('div'); chips.className = 'dc-skill-chips'; chips.hidden = true;
        chips.setAttribute('aria-label', 'Skills');
        input.insertAdjacentElement('beforebegin', chips);
        chips.addEventListener('click', event => {
            const remove = event.target.closest('[data-skill-remove]');
            if (!remove) return;
            kept = kept.filter(id => id !== remove.dataset.skillRemove);
            renderChips();
            input.focus({ preventScroll: true });
        });
        form.addEventListener('submit', () => setTimeout(updateDiscover));
        window.addEventListener('tools:languagechange', () => { updateDiscover(); renderChips(); });
    }
    // 新建、导入、改名或删除 Skill 后重新读取目录（js/home/skills-tools.js 等派发 skills:changed）
    function refresh() {
        loaded = false; failed = false;
        load();
    }

    // ── @create-skill 生成的草稿：识别回复里的 ```skill 代码块，在回复下方提供「保存为技能」 ──
    const DRAFT_RE = /```skill[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/g;

    function draftFrom(text) {
        const blocks = Array.from(String(text || '').matchAll(DRAFT_RE), match => match[1].trim()).filter(Boolean);
        const markdown = blocks.pop();
        if (!markdown) return null;
        const head = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const fields = {};
        (head ? head[1] : '').split(/\r?\n/).forEach(line => {
            const pair = line.match(/^([a-z_]+):\s*(.*)$/i);
            if (pair) fields[pair[1].toLowerCase()] = pair[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        });
        const id = String(fields.id || '').toLowerCase();
        return { markdown, id: /^[a-z][a-z0-9-]{0,40}$/.test(id) ? id : '', name: fields.name || fields.name_en || id, nameEn: fields.name_en || fields.name || id,
            description: fields.description || '', descriptionEn: fields.description_en || fields.description || '', icon: fields.icon || '✨' };
    }

    function downloadDraft(draft) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([`${draft.markdown}\n`], { type: 'text/markdown;charset=utf-8' }));
        link.download = `${draft.id || 'skill'}-SKILL.md`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    }

    function useSkillNow(id) {
        if (!input) return;
        const mention = `@${id} `;
        if (!input.value.includes(`@${id}`)) input.value = `${mention}${input.value.replace(/^\s+/, '')}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
    }

    async function saveDraft(card, draft, overwrite = false) {
        const save = card.querySelector('[data-draft-save]');
        const status = card.querySelector('.dc-skill-draft-status');
        save.disabled = true;
        status.textContent = words('正在保存…', 'Saving…');
        try {
            const result = await window.API.post('/api/agent-skills', { skillMd: draft.markdown, overwrite });
            const id = result.skill.id;
            card.classList.add('is-saved');
            status.textContent = words(`已保存为 @${id}，已出现在「全部工具 → 技能」`, `Saved as @${id}. It now appears in All tools → Skills`);
            save.textContent = words(`立即使用 @${id}`, `Use @${id} now`);
            save.dataset.draftUse = id;
            delete save.dataset.draftSave;
            window.dispatchEvent(new CustomEvent('skills:changed', { detail: { id } }));
        } catch (error) {
            const code = error.body?.code;
            if (code === 'SKILL_EXISTS' && await window.AppDialog?.confirm?.(words(`已有技能 @${draft.id}，要用这份草稿覆盖吗？`, `@${draft.id} already exists. Replace it with this draft?`), { title: words('覆盖技能', 'Replace Skill'), confirmText: words('覆盖', 'Replace') })) {
                return saveDraft(card, draft, true);
            }
            status.textContent = code === 'SKILL_ID_RESERVED'
                ? words('这个标识被内置技能占用了，请让我换一个 id 后重新生成', 'This id belongs to a built-in Skill. Ask me to regenerate with another id')
                : `${words('保存失败', 'Save failed')}：${error.message}`;
        } finally {
            save.disabled = false;
        }
    }

    function offerSave(message, text) {
        const draft = draftFrom(text);
        const main = message?.querySelector?.('.dc-msg-main');
        if (!draft || !main) return;
        main.querySelector('.dc-skill-draft')?.remove();
        const admin = localStorage.getItem('tools_role') === 'admin';
        const card = document.createElement('div');
        card.className = 'dc-skill-draft';
        const icon = document.createElement('span'); icon.className = 'dc-skill-draft-icon'; icon.textContent = draft.icon;
        const body = document.createElement('div'); body.className = 'dc-skill-draft-body';
        const title = document.createElement('b'); title.textContent = `${en() ? draft.nameEn : draft.name}${draft.id ? ` · @${draft.id}` : ''}`;
        const desc = document.createElement('span'); desc.textContent = en() ? draft.descriptionEn : draft.description;
        const status = document.createElement('small'); status.className = 'dc-skill-draft-status';
        status.textContent = admin ? words('确认无误后保存，即可在对话里 @ 使用', 'Save it to @ this Skill in chat')
            : words('仅管理员可保存；可下载 SKILL.md 交给管理员导入', 'Only admins can save. Download SKILL.md for an admin to import');
        body.append(title, desc, status);
        const actions = document.createElement('div'); actions.className = 'dc-skill-draft-actions';
        if (admin) {
            const save = document.createElement('button'); save.type = 'button'; save.className = 'dc-action dc-action--primary';
            save.dataset.draftSave = '1'; save.textContent = words('保存为技能', 'Save as Skill');
            actions.appendChild(save);
        }
        const download = document.createElement('button'); download.type = 'button'; download.className = 'dc-action';
        download.dataset.draftDownload = '1'; download.textContent = words('下载 SKILL.md', 'Download SKILL.md');
        actions.appendChild(download);
        card.append(icon, body, actions);
        card.addEventListener('click', event => {
            if (event.target.closest('[data-draft-download]')) return downloadDraft(draft);
            const use = event.target.closest('[data-draft-use]');
            if (use) return useSkillNow(use.dataset.draftUse);
            if (event.target.closest('[data-draft-save]')) saveDraft(card, draft);
        });
        main.appendChild(card);
    }

    window.addEventListener('skills:changed', refresh);
    window.DragonClawSkills = { handleEvent, activeIds: () => kept.slice(), restore, reset, badge, decorateUser, refresh, offerSave, use: useSkillNow };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
