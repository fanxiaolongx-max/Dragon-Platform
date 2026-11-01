const path = require('node:path');
const egg = require('./taotao-egg');

// The native window only exists for a visit. It never takes focus or mouse input.
function createVisitor({ BrowserWindow, screen, getPet, getLanguage, now = Date.now,
    schedule = setInterval, cancel = clearInterval, defer = setTimeout, clearDeferred = clearTimeout }) {
    let win = null, timer = null, watchdog = null, started = 0, phase = '', placement = null;
    let blockedUntil = -Infinity, lastPosition = null;
    function close() {
        if (timer !== null) cancel(timer);
        if (watchdog !== null) clearDeferred(watchdog);
        timer = watchdog = null;
        const previous = win;
        win = null; phase = ''; lastPosition = null;
        if (previous && !previous.isDestroyed()) previous.destroy();
    }
    function tick() {
        const pet = getPet();
        if (!win || win.isDestroyed() || !pet || pet.isDestroyed() || !pet.isVisible()) return close();
        const next = egg.phaseAt(Math.max(0, now() - started));
        if (next.name === 'done') return close();
        const display = screen.getDisplayMatching(pet.getBounds()) || screen.getPrimaryDisplay();
        const edge = display.bounds || display.workArea;
        placement.edgeX = Math.round(edge.x + edge.width - placement.width);
        const isMoving = next.name === 'leaving';
        const travel = egg.departureAt(isMoving ? next.progress : 0);
        const x = Math.round(isMoving ? placement.x + (placement.edgeX - placement.x) * travel.windowProgress :
            ['peek', 'bye', 'hidden'].includes(next.name) ? placement.edgeX : placement.x);
        if (!lastPosition || lastPosition.x !== x || lastPosition.y !== placement.y) {
            win.setPosition(x, placement.y); lastPosition = {x, y:placement.y};
        }
        if (phase !== next.name) {
            phase = next.name;
            win.webContents.send('taotao-phase', { phase, side: placement.side, language: getLanguage() });
        }
        if (isMoving) win.webContents.send('taotao-travel', travel.exitProgress);
    }
    function start(rect) {
        const pet = getPet();
        if (win || now() < blockedUntil || !pet || pet.isDestroyed() || !pet.isVisible()) return false;
        const bounds = pet.getBounds();
        const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
        let anchor = bounds;
        if (rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) &&
            rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 &&
            rect.x + rect.width <= bounds.width + 1 && rect.y + rect.height <= bounds.height + 1) {
            anchor = { x: bounds.x + rect.x, y: bounds.y + rect.y, width: rect.width, height: rect.height };
        }
        placement = egg.layout(anchor, display.workArea, display.bounds);
        const candidate = new BrowserWindow({ x: placement.x, y: placement.y,
            width: placement.width, height: placement.height,
            frame: false, transparent: true, alwaysOnTop: true, resizable: false,
            skipTaskbar: true, hasShadow: false, show: false, focusable: false,
            backgroundColor: '#00000000',
            webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
        });
        win = candidate;
        candidate.setIgnoreMouseEvents(true);
        candidate.on('closed', () => { if (win === candidate) close(); });
        candidate.webContents.on('render-process-gone', () => { if (win === candidate) close(); });
        // Also clear failed/abandoned loads; no permanently invisible visitor window.
        watchdog = defer(close, 20000);
        candidate.loadFile(path.join(__dirname, 'taotao.html')).catch(() => {
            if (win === candidate) close();
        });
        return true;
    }
    function ready(sender) {
        if (!win || win.isDestroyed() || sender !== win.webContents || timer !== null) return false;
        const pet = getPet();
        if (!pet || pet.isDestroyed() || !pet.isVisible()) { close(); return false; }
        clearDeferred(watchdog); watchdog = null;
        started = now(); blockedUntil = started + egg.COOLDOWN_MS;
        win.showInactive();
        tick();
        pet.webContents.send('pet-taotao-greeting');
        timer = schedule(tick, 33);
        return true;
    }
    function languageChanged() {
        if (win && !win.isDestroyed()) win.webContents.send('pet-language-change', getLanguage());
    }
    function failed(sender) { if (win && sender === win.webContents) close(); }
    return { start, ready, close, languageChanged, failed };
}
module.exports = { createVisitor };
