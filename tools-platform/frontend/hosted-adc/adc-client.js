(function () {
    const base = document.currentScript.src.replace(/\/client\.js$/, '');
    const style = document.createElement('style');
    style.textContent = 'body.aibar-open #aiBarFab{display:none}';
    document.head.append(style);
    let sessionId = '', modelId = '', controller = null;
    async function api(path, body, signal) {
        let response;try{response = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : { signal });}catch(error){if(error.name==='AbortError')throw error;throw new Error('平台 AI 通道连接中断：'+path+'。未收到 HTTP 响应，请检查网络、代理超时或重新打开应用。');}
        let result;try{result=await response.json();}catch(_){throw new Error('平台 AI 通道返回非 JSON（HTTP '+response.status+'，'+path+'），请检查代理或平台日志');}
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
