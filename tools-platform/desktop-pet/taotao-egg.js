/* Shared timing and geometry for the hidden visitor; no persistent pet setting. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  // Electron renderers expose both window and CommonJS.
  if (typeof window === 'object') root.TaotaoEgg = api;
})(typeof window === 'object' ? window : this, function () {
  var GREET_MS = 10000, LEAVE_MS = 1500, HIDE_MS = 300, PEEK_MS = 2500, BYE_MS = 500;
  var COOLDOWN_MS = 30000;
  function createClicks(now) {
    now = now || Date.now;
    var clicks = [], last = -Infinity, blockedUntil = -Infinity;
    return {
      click: function () {
        var time = now();
        if (time < blockedUntil) return false;
        if (time - last > 1000 || time < last) clicks = [];
        last = time;
        clicks = clicks.filter(function (value) { return time - value <= 6000; });
        clicks.push(time);
        if (clicks.length <= 10) return false;
        clicks = []; blockedUntil = time + COOLDOWN_MS;
        return true;
      },
      reset: function () { clicks = []; last = -Infinity; }
    };
  }
  function phaseAt(elapsed) {
    if (elapsed < GREET_MS) return { name: 'greeting', progress: 0 };
    elapsed -= GREET_MS;
    if (elapsed < LEAVE_MS) return { name: 'leaving', progress: elapsed / LEAVE_MS };
    elapsed -= LEAVE_MS;
    if (elapsed < HIDE_MS) return { name: 'hidden', progress: 0 };
    elapsed -= HIDE_MS;
    if (elapsed < PEEK_MS) return { name: 'peek', progress: 0 };
    elapsed -= PEEK_MS;
    if (elapsed < BYE_MS) return { name: 'bye', progress: elapsed / BYE_MS };
    return { name: 'done', progress: 1 };
  }
  // Finish moving the native window before artwork crosses its clipping edge.
  function departureAt(progress) {
    progress = Math.max(0, Math.min(1, progress));
    return {
      windowProgress: 1 - Math.pow(1 - Math.min(1, progress / .7), 2),
      exitProgress: Math.pow(Math.min(1, Math.max(0, (progress - .7) / .3)), 1.3)
    };
  }
  function layout(pet, area, displayBounds) {
    displayBounds = displayBounds || area;
    var width = Math.min(240, area.width), height = Math.min(280, area.height);
    var clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };
    var right = pet.x + pet.width / 2 >= area.x + area.width / 2;
    var x = right ? pet.x - width + 34 : pet.x + pet.width - 34;
    var y = pet.y + pet.height - height;
    return {
      width: width, height: height, side: 'right',
      x: Math.round(clamp(x, area.x, area.x + area.width - width)),
      y: Math.round(clamp(y, area.y, area.y + area.height - height)),
      // Electron screen bounds are already DIP coordinates, including Retina
      // and negative-origin displays. Work area can end at a side Dock/taskbar.
      edgeX: Math.round(displayBounds.x + displayBounds.width - width)
    };
  }
  return { createClicks: createClicks, phaseAt: phaseAt, departureAt: departureAt, layout: layout, COOLDOWN_MS: COOLDOWN_MS };
});
