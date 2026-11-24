// Presenter controls for the summit viewer. The first selected language is the primary line.
window.createSummitCaptions = function ({ dialog, button, store, speechLanguage, currentLine, publish, enableSync, label, notify }) {
    const names = { zh: '中文', en: 'English', ar: 'العربية' };
    const defaultLanguages = ['ar', 'en'];
    const saved = store.get('captionLanguages', defaultLanguages);
    let languages = (Array.isArray(saved) ? [...new Set(saved)] : []).filter(key => names[key]).slice(0, 2);
    if (!languages.length) languages = defaultLanguages;
    const sizes = ['small', 'medium', 'large'];
    const sizeControls = ['ccMainSize', 'ccSecondSize'];
    const savedSizes = store.get('captionSizes', []);
    const captionSizes = sizeControls.map((_, i) => sizes.includes(savedSizes?.[i]) ? savedSizes[i] : 'medium');
    let source = store.get('captionSource', 'script') === 'mic' ? 'mic' : 'script';
    let active = source === 'script' && store.get('scriptCaptionsEnabled', true);
    let session = null, transcript = {}, idleTimer, languageAtStart;
    const get = id => dialog.querySelector('#' + id);
    const status = message => { get('ccStatus').textContent = message; };
    function refresh() {
        if (session && languageAtStart !== speechLanguage()) { stop(); return; }
        const values = !active ? {} : source === 'mic' ? transcript : currentLine();
        publish(active ? languages.map((lang, i) => ({ lang, text: values[lang] || '', size: captionSizes[i] })) : []);
    }
    function render() {
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
        get('ccTitle').textContent=label('展示字幕','Presentation captions');
        get('ccFromLabel').textContent=label('字幕来源','Source');
        get('ccLanguagesLabel').textContent=label('显示语言 · 最多两种','Languages · choose up to two');
        get('ccPrimaryLabel').textContent=label('主字幕','Primary language');
        get('ccSizeTitle').textContent = label('字幕字号', 'Caption size');
        get('ccMainSizeLabel').textContent = label('主字幕', 'Primary');
        get('ccSecondSizeLabel').textContent = label('副字幕', 'Secondary');
        const sizeNames = [label('小', 'Small'), label('中', 'Medium'), label('大', 'Large')];
        sizeControls.forEach((id, i) => {
            const select = get(id);
            select.replaceChildren(...sizes.map((size, j) => new Option(sizeNames[j], size)));
            select.value = captionSizes[i];
            select.disabled = languages.length <= i;
        });
        get('ccSource').options[0].textContent=label('跟随讲稿与配音','Script and narration');
        get('ccSource').options[1].textContent=label('现场麦克风翻译','Live microphone translation');
        get('ccSource').value = source;
        get('ccHint').textContent = source === 'mic' ? label('请将提词器语言设为发言语言。允许麦克风后，现场发言会分句识别并翻译。','Set the prompter to the spoken language. Allow microphone access for live transcription and translation.') : '';
        for (const box of dialog.querySelectorAll('input[type=checkbox]')) {
            box.checked = languages.includes(box.value);
            box.disabled = !box.checked && languages.length === 2;
        }
        get('ccPrimary').replaceChildren(...languages.map(lang => new Option(names[lang], lang)));
        get('ccPrimaryRow').hidden = languages.length !== 2;
        get('ccAction').textContent = active ? label('关闭字幕','Turn captions off') : label('开启字幕','Turn captions on');
        get('ccAction').disabled = !languages.length;
    }
    function stop() {
        active = false;
        const old = session;
        session = null;
        if (old) {
            old.controller.abort();
            clearInterval(old.timer);
            old.recognition?.abort();
            if (old.recorder?.state === 'recording') old.recorder.stop();
            old.stream?.getTracks().forEach(track => track.stop());
            old.context?.close().catch(() => {});
        }
        clearTimeout(idleTimer);
        transcript = {};
        status(''); render(); refresh();
    }
    function fail(s, message) {
        if (session !== s) return;
        stop(); status(message); notify(message);
    }
    async function translate(s, text) {
        if (!text || session !== s) return;
        text = text.trim().slice(0, 650);
        if (!text) return;
        const sequence = ++s.sequence, from = languageAtStart;
        s.lastText = text;
        const targets = languages.filter(lang => lang !== from);
        const values = { [from]: text };
        // The original can appear before its translation finishes.
        if (languages.includes(from)) { transcript = values; s.displayed=sequence; refresh(); }
        const signal = s.controller.signal;
        if (targets.length) {
            try {
                const response = await fetch('/api/summit-slide-sync/translate', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, from, targets }), signal
                });
                if (!response.ok) throw Error(response.status === 401 ? label('请登录提词器以使用现场翻译','Sign in to use live translation') : label('现场翻译不可用，请检查平台 AI 设置','Live translation unavailable. Check the platform AI settings.'));
                Object.assign(values, (await response.json()).translations);
            } catch (e) { if (!signal.aborted && sequence === s.sequence) fail(s, e.message); return; }
        }
        if (session !== s || sequence < s.displayed) return;
        s.displayed = sequence;
        transcript = values; refresh();
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { transcript = {}; refresh(); }, 9000);
    }
    function browserMic(s, offlineOnly) {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition || (offlineOnly && !('processLocally' in Recognition.prototype))) throw Error(label('此浏览器没有可用的语音识别服务','Speech recognition is unavailable in this browser.'));
        const rec = s.recognition = new Recognition();
        rec.lang = { en: 'en-US', ar: 'ar-EG', zh: 'zh-CN' }[languageAtStart];
        if (offlineOnly) rec.processLocally = true;
        rec.continuous = true; rec.interimResults = true;
        rec.onresult = event => {
            if (session !== s) return;
            const final = [], interim = [];
            for (let i = event.resultIndex; i < event.results.length; i++) {
                (event.results[i].isFinal ? final : interim).push(event.results[i][0].transcript);
            }
            if (final.length) translate(s, final.join(' '));
            else if (languages.includes(languageAtStart)) {
                transcript = { [languageAtStart]: interim.join(' ').slice(-650) }; refresh();
            }
        };
        rec.onerror = event => { if (event.error !== 'no-speech') fail(s, label('麦克风识别失败，请检查权限或语音服务','Microphone recognition failed. Check permission or the speech service.')); };
        rec.onend = () => { if (session === s) { try { rec.start(); } catch { fail(s, label('麦克风已停止','Microphone stopped')); } } };
        rec.start();
    }
    async function serverMic(s) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (session !== s) { stream.getTracks().forEach(track => track.stop()); return; }
        s.stream = stream;
        const ctx = s.context = new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume();
        if (session !== s) return;
        const analyser = ctx.createAnalyser();
        ctx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const queue = [];
        let busy = false;
        async function drain() {
            if (busy) return;
            busy = true;
            try {
                while (session === s && queue.length) {
                    const blob = queue.shift(), form = new FormData();
                    form.append('audio', blob, blob.type.includes('mp4') ? 'speech.mp4' : 'speech.webm');
                    const response = await fetch('/api/ai/speech', { method: 'POST', body: form, signal: s.controller.signal });
                    if (!response.ok) throw Error(label('语音识别服务暂不可用','Speech transcription service unavailable.'));
                    translate(s, (await response.json()).text);
                }
            } catch (e) { fail(s, e.message); } finally { busy = false; }
        }
        let started, lastVoice, heard;
        function chunk() {
            if (session !== s) return;
            const recorder = s.recorder = new MediaRecorder(stream);
            const parts = [];
            started = performance.now(); lastVoice = started; heard = false;
            recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
            recorder.onerror = () => fail(s, label('麦克风录音中断','Microphone recording interrupted.'));
            recorder.onstop = () => {
                if (session !== s) return;
                if (heard && parts.length) {
                    if (queue.length >= 3) queue.shift();
                    queue.push(new Blob(parts, { type: recorder.mimeType })); drain();
                }
                chunk();
            };
            recorder.start();
        }
        chunk();
        s.timer = setInterval(() => {
            if (s.recorder.state !== 'recording') return;
            analyser.getFloatTimeDomainData(samples);
            let power = 0;
            for (const v of samples) power += v*v;
            const now = performance.now();
            if (power/samples.length > .000025) { heard = true; lastVoice = now; }
            if (now-started > 4800 || (heard && now-started > 600 && now-lastVoice > 330)) s.recorder.stop();
        }, 100);
    }
    async function start() {
        enableSync();
        active = true; render();
        if (source === 'script') { refresh(); dialog.close(); return; }
        const s = session = { controller: new AbortController(), sequence: 0, displayed: 0 };
        languageAtStart = speechLanguage();
        try {
            status(label('正在准备麦克风…','Preparing microphone…'));
            const response = await fetch('/api/ai/speech', { signal: s.controller.signal });
            if (response.status === 401 && languages.some(lang => lang !== languageAtStart)) {
                throw Error(label('请先登录提词器，再开启现场翻译','Sign in to the teleprompter to use live translation.'));
            }
            const caps = response.ok ? await response.json() : {};
            if (session !== s) return;
            if (caps.enabled && window.MediaRecorder && navigator.mediaDevices) await serverMic(s);
            else browserMic(s, caps.offlineOnly);
            if (session !== s) return;
            status(label('正在听取现场发言','Listening to the speaker')); dialog.close();
        } catch (e) {
            fail(s, e.name === 'NotAllowedError' ? label('请允许使用麦克风','Allow microphone access to start captions.') : e.message);
        }
    }
    button.onclick = () => { render(); dialog.showModal(); };
    get('ccClose').onclick = () => dialog.close();
    get('ccAction').onclick = () => {
        if (source === 'script') store.set('scriptCaptionsEnabled', !active);
        if (active) { stop(); dialog.close(); } else start();
    };
    // Save the new selection before stop() re-renders the controls.
    get('ccSource').onchange = e => { const value=e.target.value; stop(); source=value; store.set('captionSource',source); render(); };
    dialog.onchange = e => {
        const role = sizeControls.indexOf(e.target.id);
        if (role >= 0 && sizes.includes(e.target.value)) {
            captionSizes[role] = e.target.value;
            store.set('captionSizes', captionSizes);
            refresh();
            return;
        }
        if (e.target.type === 'checkbox') languages = e.target.checked ? [...languages, e.target.value].slice(0,2) : languages.filter(lang=>lang!==e.target.value);
        else if (e.target.id === 'ccPrimary') languages = [e.target.value,...languages.filter(lang=>lang!==e.target.value)];
        else return;
        store.set('captionLanguages',languages);
        if (!languages.length) stop();
        else if (session?.lastText && e.target.type === 'checkbox') translate(session, session.lastText);
        render(); refresh();
    };
    window.addEventListener('pagehide',stop);
    render();
    return { refresh, stop };
};
