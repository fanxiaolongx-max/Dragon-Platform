(function () {
    const base = document.currentScript.src.replace(/\/client\.js$/, '');
    const style = document.createElement('style');
    style.textContent = 'body.aibar-open #aiBarFab{display:none}';
    document.head.append(style);
    let sessionId = '', modelId = '', controller = null;
    async function api(path, body, signal) {
        const response = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : { signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '请求失败');
        return result;
    }
    function notify() {
        const frame = document.getElementById('aiBarFrame');
        frame?.contentWindow?.postMessage({ type: 'platform-adc-session', sessionId, modelId }, '*');
    }
    addEventListener('message', event => {
        if (event.source !== document.getElementById('aiBarFrame')?.contentWindow) return;
        if (event.data?.type === 'platform-adc-ready') { notify(); return; }
        if (event.data?.type !== 'platform-adc-session' || controller) return;
        sessionId = String(event.data.sessionId || ''); modelId = String(event.data.modelId || '');
    });
    window.ADCChat = Object.freeze({
        environment: '平台 AI', configured: true, chatUrl: base + '/chat',
        get busy() { return !!controller; },
        stop() { controller?.abort(); },
        async newSession() {
            if (controller) throw new Error('请等待当前响应结束');
            sessionId = (await api('/sessions', {})).id; notify(); return sessionId;
        },
        async ask(question, options = {}) {
            if (controller) throw new Error('请等待当前响应结束');
            controller = new AbortController();
            try {
                if (!sessionId) sessionId = (await api('/sessions', {}, controller.signal)).id;
                const result = await api('/chat', { sessionId, modelId, message: question }, controller.signal);
                modelId = result.modelId; options.onUpdate?.(result.text); notify(); return result.text;
            } finally { controller = null; }
        }
    });
    window.ask = (question, options) => window.ADCChat.ask(question, options);
})();
