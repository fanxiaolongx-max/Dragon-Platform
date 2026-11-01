(function () {
  'use strict';
  var ipc = require('electron').ipcRenderer;
  var visitor = document.querySelector('.visitor'), sprite = document.querySelector('.sprite');
  var speech = document.querySelector('.speech'), phase = 'loading', side = 'right', language = 'zh-CN', frame = 0;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var paths = ['wave-0', 'wave-1', 'wave-2', 'wave-3', 'run-right-0', 'run-right-1', 'peek-right'];
  function updateText() {
    document.documentElement.lang = language;
    document.querySelector('.peek-sprite').alt = language === 'en-US' ? 'Taotao peeks in from the right edge to say goodbye' : '桃桃从屏幕右侧探头告别';
    speech.textContent = phase === 'peek' || phase === 'bye' ? 'byebye 👋' :
      language === 'en-US' ? 'Hi, Dragon! And hello to you on the other side of the screen!' : '嗨，Dragon！也向屏幕前的你问好～';
  }
  function render() {
    var name = phase === 'leaving' ? 'run-' + side + '-' + (frame % 2) :
      'wave-' + (phase === 'peek' || phase === 'bye' ? 2 : reduced.matches ? 1 : frame % 4);
    sprite.src = './assets/taotao/' + name + '.png';
  }
  ipc.on('taotao-phase', function (_event, data) {
    phase = data.phase; side = data.side; language = data.language === 'en-US' ? 'en-US' : 'zh-CN';
    frame = 0; visitor.dataset.phase = phase; visitor.dataset.side = side;
    visitor.style.setProperty('--exit', '0');
    updateText(); render();
  });
  ipc.on('taotao-travel', function (_event, value) {
    if (phase === 'leaving') visitor.style.setProperty('--exit', String(Math.max(0, Math.min(1, Number(value) || 0))));
  });
  ipc.on('pet-language-change', function (_event, value) { language = value === 'en-US' ? 'en-US' : 'zh-CN'; updateText(); });
  var timer = setInterval(function () { if (!reduced.matches) { frame++; render(); } }, 180);
  window.addEventListener('unload', function () { clearInterval(timer); });
  Promise.all(paths.map(function (name) {
    return new Promise(function (resolve, reject) {
      var image = new Image(); image.onload = resolve; image.onerror = reject;
      image.src = './assets/taotao/' + name + '.png';
    });
  })).then(function () { ipc.send('pet-taotao-ready'); }).catch(function () { ipc.send('pet-taotao-failed'); });
})();
