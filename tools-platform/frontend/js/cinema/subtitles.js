(function () {
    'use strict';
    const LABELS = {
        zh: { auto: '自动', searching: '自动 · 搜索中', empty: '自动 · 暂无字幕', bilingual: '中英双语', zh: '中文', en: 'English', off: '关闭', title: '字幕', sizeTitle: '字幕字号', small: '小', medium: '中', large: '大' },
        en: { auto: 'Auto', searching: 'Auto · Searching', empty: 'Auto · Unavailable', bilingual: 'Chinese + English', zh: 'Chinese', en: 'English', off: 'Off', title: 'Subtitles', sizeTitle: 'Subtitle size', small: 'S', medium: 'M', large: 'L' }
    };

    class CinemaSubtitles {
        constructor(video, select, sizeSelect) {
            this.video = video;
            this.select = select;
            this.sizeSelect = sizeSelect;
            this.size = 'small';
            try { this.size = localStorage.getItem('cinema_subtitle_size_v1') || 'small'; } catch (_) {}
            if (!['small', 'medium', 'large'].includes(this.size)) this.size = 'small';
            video.dataset.subtitleSize = this.size;
            sizeSelect.value = this.size;
            sizeSelect.addEventListener('change', () => {
                this.size = sizeSelect.value;
                video.dataset.subtitleSize = this.size;
                try { localStorage.setItem('cinema_subtitle_size_v1', this.size); } catch (_) {}
                this.positionCues();
            });
            this.tracks = [];
            this.generation = 0;
            this.status = 'auto';
            this.preference = 'auto';
            try { this.preference = localStorage.getItem('cinema_subtitles_v1') || 'auto'; } catch (_) {}
            if (!['auto', 'bilingual', 'zh', 'en', 'off'].includes(this.preference)) this.preference = 'auto';
            select.addEventListener('change', () => {
                this.preference = select.value;
                try { localStorage.setItem('cinema_subtitles_v1', this.preference); } catch (_) {}
                this.apply();
            });
            window.addEventListener('tools:languagechange', () => this.render());
            window.addEventListener('pagehide', () => this.clear());
            // A source change can reset TextTrack modes; restore once metadata is available.
            video.addEventListener('loadedmetadata', () => this.apply());
            const box = video.parentElement;
            this.layoutObserver = new MutationObserver(() => this.positionCues());
            this.layoutObserver.observe(box, { attributes: true, attributeFilter: ['class'] });
            this.resizeObserver = new ResizeObserver(() => this.positionCues());
            this.resizeObserver.observe(video);
            box.addEventListener('focusin', () => this.positionCues());
            box.addEventListener('focusout', () => requestAnimationFrame(() => this.positionCues()));
            this.render();
        }

        positionCues() {
            const box = this.video.parentElement;
            const controls = box.querySelector('.player-controls');
            const visible = ['user-active', 'paused', 'episode-picker-open'].some(name => box.classList.contains(name)) || controls?.contains(document.activeElement);
            const height = this.video.clientHeight;
            for (const item of this.tracks) {
                for (const cue of Array.from(item.element.track?.cues || [])) {
                    cue.snapToLines = !visible;
                    cue.lineAlign = visible ? 'end' : 'start';
                    cue.line = visible && height > 0 ? Math.max(15, 100 - ((controls?.offsetHeight || 60) + 12) / height * 100) : 'auto';
                }
            }
        }

        render() {
            let language = document.documentElement.lang;
            try { language = localStorage.getItem('tools_lang') || localStorage.getItem('tools_language') || language; } catch (_) {}
            const labels = LABELS[String(language).startsWith('en') ? 'en' : 'zh'];
            this.select.title = labels.title;
            this.select.setAttribute('aria-label', labels.title);
            this.sizeSelect.title = labels.sizeTitle;
            this.sizeSelect.setAttribute('aria-label', labels.sizeTitle);
            for (const option of this.sizeSelect.options) option.textContent = labels[option.value];
            for (const option of this.select.options) {
                option.textContent = labels[option.value === 'auto' ? this.status : option.value];
                option.disabled = !['auto', 'off'].includes(option.value) && !this.tracks.some(item => item.language === option.value);
            }
            for (const item of this.tracks) item.element.label = labels[item.language];
            this.select.value = this.preference;
        }

        apply() {
            const selected = this.preference === 'off' ? null :
                this.tracks.find(item => item.language === this.preference) || this.tracks[0];
            for (const item of this.tracks) {
                if (item.element.track) item.element.track.mode = item === selected ? 'showing' : 'disabled';
            }
            this.positionCues();
            this.render();
        }

        clear() {
            this.generation += 1;
            this.controller?.abort();
            for (const item of this.tracks) {
                item.element.remove();
                URL.revokeObjectURL(item.url);
            }
            this.tracks = [];
        }

        async load(item, access) {
            this.clear();
            const generation = this.generation;
            const controller = new AbortController();
            this.controller = controller;
            this.status = 'searching';
            this.render();
            const timer = setTimeout(() => controller.abort(), 90000);
            try {
                const params = new URLSearchParams();
                if (access) params.set('access', access);
                const response = await fetch(`/api/media/public/subtitles/${encodeURIComponent(item.id)}?${params}`, { signal: controller.signal });
                if (!response.ok) throw new Error('Subtitles unavailable');
                const result = await response.json();
                if (generation !== this.generation || controller.signal.aborted) return;
                const seen = new Set();
                for (const track of (Array.isArray(result.tracks) ? result.tracks : []).slice(0, 3)) {
                    if (!['bilingual', 'zh', 'en'].includes(track.language) || seen.has(track.language) ||
                        typeof track.vtt !== 'string' || !track.vtt.startsWith('WEBVTT\n') || track.vtt.length > 8 * 1024 * 1024) continue;
                    seen.add(track.language);
                    const url = URL.createObjectURL(new Blob([track.vtt], { type: 'text/vtt;charset=utf-8' }));
                    const element = document.createElement('track');
                    element.kind = 'subtitles';
                    element.srclang = track.language === 'en' ? 'en' : 'zh';
                    element.src = url;
                    element.addEventListener('load', () => { if (generation === this.generation) this.apply(); });
                    element.addEventListener('error', () => {
                        if (generation !== this.generation) return;
                        element.remove();
                        URL.revokeObjectURL(url);
                        this.tracks = this.tracks.filter(item => item.element !== element);
                        this.status = this.tracks.length ? 'auto' : 'empty';
                        this.apply();
                    });
                    this.tracks.push({ language: track.language, element, url });
                    this.video.appendChild(element);
                    // Hidden loads VTT without showing multiple languages at once.
                    element.track.mode = 'hidden';
                }
                this.tracks.sort((a, b) => ['bilingual', 'zh', 'en'].indexOf(a.language) - ['bilingual', 'zh', 'en'].indexOf(b.language));
            } catch (_) { /* Optional: playback continues with no popup or retry loop. */ }
            finally {
                clearTimeout(timer);
                if (generation === this.generation) {
                    this.status = this.tracks.length ? 'auto' : 'empty';
                    this.apply();
                }
            }
        }
    }
    window.CinemaSubtitles = CinemaSubtitles;
})();
