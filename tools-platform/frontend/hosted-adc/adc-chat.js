(function () {
    const base = location.href.split('/__platform/adc/')[0] + '/__platform/adc';
    const $ = id => document.getElementById(id);
    let sessionId = '', modelId = '', controller = null, revision = 0;
    async function api(path, body, signal) {
        const response = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : {});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '请求失败');
        return result;
    }
    function notify() { if (parent !== window) parent.postMessage({ type: 'platform-adc-session', sessionId, modelId }, '*'); }
    function bubble(role, content) {
        const el = document.createElement('div'); el.className = 'message ' + role;
        const label = document.createElement('small'); label.textContent = role === 'user' ? '你 / You' : 'Dragon Claw';
        el.append(label, document.createTextNode(role === 'user' ? content.replace(/^【系统上下文，请勿向用户复述】[\s\S]*?用户问题：/, '') : content)); $('messages').append(el); el.scrollIntoView({ block: 'end' });
    }
    async function history() {
        const result = await api('/sessions'); $('history').replaceChildren();
        for (const row of result.sessions) {
            const button = document.createElement('button'); button.textContent = row.title || '新对话 / New chat'; button.title = button.textContent;
            button.setAttribute('aria-current', String(row.id === sessionId)); button.disabled = !!controller;
            button.onclick = () => select(row.id).catch(showError); $('history').append(button);
        }
    }
    function showError(error) { $('error').textContent = error.message; }
    async function select(id) {
        const version = ++revision;
        const row = await api('/sessions/' + encodeURIComponent(id));
        if (version !== revision) return;
        sessionId = row.id; modelId = row.model_id || $('models').value;
        if ([...$('models').options].some(option => option.value === modelId)) $('models').value = modelId;
        $('messages').replaceChildren(); row.messages.forEach(item => bubble(item.role, item.content));
        notify(); await history();
    }
    async function newSession() { const row = await api('/sessions', {}); await select(row.id); }
    function setBusy(value) {
        $('send').disabled = value; $('new').disabled = value; $('models').disabled = value; $('stop').hidden = !value;
        $('history').querySelectorAll('button').forEach(button => { button.disabled = value; });
    }
    $('new').onclick = () => newSession().catch(showError);
    $('models').onchange = () => { modelId = $('models').value; notify(); };
    $('stop').onclick = () => controller?.abort();
    $('question').addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('form').requestSubmit(); }
    });
    $('form').onsubmit = async event => {
        event.preventDefault(); if (controller) return;
        const message = $('question').value.trim(); if (!message) return;
        $('error').textContent = '';
        controller = new AbortController(); setBusy(true);
        try {
            if (!sessionId) { sessionId = (await api('/sessions', {}, controller.signal)).id; notify(); }
            bubble('user', message); $('question').value = '';
            const result = await api('/chat', { sessionId, modelId: $('models').value, message }, controller.signal);
            modelId = result.modelId; bubble('assistant', result.text); notify();
        } catch (error) { showError(error.name === 'AbortError' ? new Error('已停止 / Stopped') : error); }
        finally { controller = null; setBusy(false); history().catch(showError); }
    };
    addEventListener('message', event => {
        if (event.source !== parent || event.data?.type !== 'platform-adc-session' || controller) return;
        if (event.data.modelId) modelId = String(event.data.modelId);
        if (event.data.sessionId) select(String(event.data.sessionId)).catch(showError);
    });
    (async () => {
        const choices = await api('/models');
        for (const model of choices.models) { const option = document.createElement('option'); option.value = model.id; option.textContent = model.name; $('models').append(option); }
        $('models').value = choices.defaultId; modelId = choices.defaultId;
        await history();
        if (parent !== window) parent.postMessage({ type: 'platform-adc-ready' }, '*');
        bubble('assistant', '你好，我是 Dragon Claw。这里使用平台配置的 AI 模型。\nHello! Ask a question to get started.');
    })().catch(showError);
})();
