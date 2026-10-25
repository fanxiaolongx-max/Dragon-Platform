(function () {
    'use strict';

    class CinemaAmbientLight {
        constructor(video, canvas, button) {
            this.video = video;
            this.canvas = canvas;
            this.button = button;
            this.context = canvas.getContext('2d', { alpha: false });
            this.enabled = true;
            this.timer = null;
            try { this.enabled = localStorage.getItem('cinema_ambient_light_v1') !== 'off'; } catch (_) {}
            this.renderState();
            for (const name of ['play', 'loadeddata', 'seeked']) video.addEventListener(name, () => this.refresh());
            for (const name of ['pause', 'ended']) video.addEventListener(name, () => { this.stop(); this.draw(); });
            video.addEventListener('emptied', () => this.reset());
            document.addEventListener('visibilitychange', () => this.refresh());
            window.addEventListener('pagehide', () => this.stop());
            window.addEventListener('pageshow', () => this.refresh());
            window.addEventListener('tools:languagechange', () => this.renderState());
        }

        renderState() {
            let language = document.documentElement.lang;
            try { language = localStorage.getItem('tools_lang') || localStorage.getItem('tools_language') || language; } catch (_) {}
            const english = String(language).startsWith('en');
            this.canvas.classList.toggle('hidden', !this.enabled);
            this.button.classList.toggle('active', this.enabled);
            this.button.setAttribute('aria-pressed', String(this.enabled));
            this.button.setAttribute('aria-label', english ? 'Toggle ambient light' : '切换画面背光');
            this.button.title = english
                ? (this.enabled ? 'Turn off ambient light' : 'Turn on ambient light')
                : (this.enabled ? '关闭画面背光' : '开启画面背光');
            const label = this.button.querySelector('.ctrl-label');
            if (label) label.textContent = english ? 'Ambient light' : (this.enabled ? '背光开' : '背光关');
        }

        toggle() {
            this.enabled = !this.enabled;
            try { localStorage.setItem('cinema_ambient_light_v1', this.enabled ? 'on' : 'off'); } catch (_) {}
            this.renderState();
            this.refresh();
        }

        draw() {
            if (!this.enabled || document.hidden || !this.context || this.video.readyState < 2 || !this.video.videoWidth) return;
            try {
                // Render a tiny copy of the current frame, without reading pixels or
                // involving the audio pipeline. CSS spreads its edge colors behind the player.
                this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            } catch (_) { /* Unavailable frame: retain the previous light until the next frame. */ }
        }

        refresh() {
            this.stop();
            if (!this.enabled || document.hidden || !this.context) return;
            this.draw();
            if (!this.video.paused && !this.video.ended) {
                // Five tiny frames per second are enough for a soft backlight.
                // Reduce updates further when the viewer requests reduced motion.
                const interval = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1000 : 200;
                this.timer = setTimeout(() => this.refresh(), interval);
            }
        }

        stop() {
            if (this.timer !== null) clearTimeout(this.timer);
            this.timer = null;
        }

        reset() {
            this.stop();
            if (this.context) {
                this.context.fillStyle = '#000';
                this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }
    }

    window.CinemaAmbientLight = CinemaAmbientLight;
})();
