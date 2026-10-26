/* Random idle gestures and stories using the supplied transparent artwork. */
(function () {
  window.DragonLife = { create: function (ui) {
    var options = { randomMotionOn: true, proactiveStoriesOn: true, storyIntervalMinutes: 3 };
    var frames = [], catalog = [], deck = [], language = '', motionTimer = null, motionSource = '', chatBusy = false;
    var nextMotion = Date.now() + 12000, nextStory = Date.now() + 90000, loading = false;
    var artwork = {}, lastChoice = -1;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (window.DragonArtwork) window.DragonArtwork.load(function (src, profile) {
      if (window.DragonPresence) window.DragonPresence.registerProfile(src, profile);
    }).then(function (loaded) {
      artwork = loaded; frames = loaded.blink || [];
      if (ui.onFrontReady) ui.onFrontReady(loaded);
    });
    function stop(restore) {
      if (motionTimer) clearTimeout(motionTimer);
      motionTimer = null;
      if (ui.img.dataset) ui.img.dataset.motion = 'idle';
      ui.img.classList.remove('dragon-observe', 'dragon-dream', 'dragon-greet');
      if (motionSource && restore !== false) ui.setSprite(motionSource);
      motionSource = '';
    }
    function busy() { return document.hidden || chatBusy || ui.busy(); }
    function play(sequence, timings) {
      var index = 0;
      function tick() {
        if (busy() || reducedMotion.matches) { stop(); return; }
        ui.setSprite(sequence[index]);
        var delay = timings[index++] || 150;
        if (index < sequence.length) motionTimer = setTimeout(tick, delay);
        else motionTimer = setTimeout(stop, delay);
      }
      tick();
    }
    function motion(forced, kind) {
      if (busy() || reducedMotion.matches || (!options.randomMotionOn && !forced)) return;
      stop(); motionSource = ui.img.getAttribute('src');
      var choices = ['blink','double-blink','left','right','up','down','think','wave','walk','sleep'];
      var choice = kind ? choices.indexOf(kind) : Math.floor(Math.random() * choices.length);
      if (!kind && choice === lastChoice) choice = (choice + 1) % choices.length;
      lastChoice = choice;
      kind = choices[choice] || 'blink';
      if (ui.img.dataset) ui.img.dataset.motion = kind;
      if ((kind === 'blink' || kind === 'double-blink') && frames.length === 6) {
        var order = kind === 'blink' ? [0,1,2,3,4,5] : [0,2,3,2,4,0,2,3,2,4,5];
        play(order.map(function (i) { return frames[i]; }), order.map(function(i) { return i === 3 ? 150 : 85; }));
      } else if ((kind === 'left' || kind === 'right') && artwork[kind]) {
        var path = window.DragonArtwork.order(kind);
        play(path.map(function(i) { return artwork[kind][i]; }), path.map(function(_i,index) {
          return index === Math.floor(path.length/2)-1 ? 850 : 145;
        }));
      } else if (kind === 'wave' && artwork.wave || kind === 'walk' && artwork.walk) {
        var sequence = artwork[kind];
        play(sequence, sequence.map(function(){return kind === 'walk' ? 180 : 150;}));
      } else if (kind === 'sleep' && artwork.states) {
        play([4,5,6,6,5,4].map(function(i){return artwork.states[i];}), [500,350,1400,900,350,400]);
      } else if (kind === 'think' && artwork.states) {
        play([0,1,0].map(function(i){return artwork.states[i];}), [500,1000,500]);
      } else {
        var src = kind === 'think' ? ui.images.think : kind === 'wave' ? ui.images.wave :
          artwork.directions && artwork.directions[{up:0,right:1,down:2,left:3}[kind] || 0];
        if (!src) { stop(); return; }
        ui.setSprite(src);
        ui.img.classList.add(kind === 'wave' ? 'dragon-greet' : 'dragon-dream');
        motionTimer = setTimeout(stop, 1600 + Math.random() * 1400);
      }
    }
    async function load() {
      var lang = window.PetI18n.getLanguage();
      if (!ui.ipc || loading || (catalog.length && language === lang)) return;
      loading = true;
      try {
        var result = await ui.ipc.invoke('pet-get-stories', lang);
        if (Array.isArray(result) && window.PetI18n.getLanguage() === lang) {
          catalog = result; language = lang; deck = [];
        }
      } catch (_) { /* Retry later if the local service is still starting. */ }
      finally { loading = false; }
    }
    function takeStory(id) {
      if (id) return catalog.find(function (s) { return s.id === id; });
      if (!deck.length) {
        deck = catalog.slice();
        for (var i = deck.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1)); var item = deck[i]; deck[i] = deck[j]; deck[j] = item;
        }
      }
      return deck.pop();
    }
    async function story(id, manual) {
      if (busy() || (!manual && (!options.proactiveStoriesOn || !ui.bubblesOn()))) return false;
      await load();
      if (busy() || language !== window.PetI18n.getLanguage()) return false;
      var item = takeStory(id);
      if (!item) return false;
      ui.showStory(item); return true;
    }
    function delayStory() { nextStory = Date.now() + options.storyIntervalMinutes * 60000 * (0.8 + Math.random() * 0.4); }
    function apply(config) {
      if (!config) return;
      if (typeof config.randomMotionOn === 'boolean') options.randomMotionOn = config.randomMotionOn;
      if (typeof config.proactiveStoriesOn === 'boolean') options.proactiveStoriesOn = config.proactiveStoriesOn;
      if (config.storyIntervalMinutes !== undefined) {
        options.storyIntervalMinutes = Math.max(1, Math.min(30, Number(config.storyIntervalMinutes) || 3)); delayStory();
      }
      if (!options.randomMotionOn) stop();
      if (!options.proactiveStoriesOn) ui.clearStory();
    }
    if (ui.ipc) ui.ipc.on('pet-chat-generating', function (_event, active) { chatBusy = !!active; if (active) stop(); });
    reducedMotion.addEventListener('change', function () { if (reducedMotion.matches) stop(); });
    var interruptionTimer = setInterval(function () { if (motionSource && busy()) stop(); }, 100);
    // Interaction poses have priority over idle stories and random gestures. One
    // clock prevents old frames from overwriting a drag, typing or working pose.
    var controlled = '', controlIndex = 0, controlAt = 0;
    var activityTimer = setInterval(function () {
      if (!ui.activity || !artwork.states) return;
      var kind = ui.activity(), now = Date.now();
      if (document.hidden) { controlled = ''; return; }
      if (kind === 'idle') {
        if (controlled) { controlled = ''; ui.setSprite(artwork.front[0]); if(ui.img.dataset)ui.img.dataset.motion='idle'; }
        return;
      }
      if (kind !== controlled) { stop(false); controlled = kind; controlIndex = 0; controlAt = 0; }
      if (now < controlAt) return;
      var sequence = kind === 'wave' ? artwork.wave : kind === 'dragged' || kind === 'fall' ? [artwork.states[2],artwork.states[3]] : kind === 'pat' ? [artwork.states[7]] : [artwork.states[0],artwork.states[1]];
      if (!sequence || !sequence.length) return;
      ui.setSprite(sequence[reducedMotion.matches ? 0 : controlIndex++ % sequence.length]);
      if(ui.img.dataset)ui.img.dataset.motion=kind;
      controlAt = now + (reducedMotion.matches ? 60000 : kind === 'wave' ? 150 : 550);
    }, 100);
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
    window.addEventListener('pet:languagechange', function () { catalog = []; deck = []; ui.clearStory(); load(); });
    var lifeTimer = setInterval(function () {
      var now = Date.now();
      if (now >= nextMotion) { nextMotion = now + 10000 + Math.random() * 22000; motion(); }
      if (now >= nextStory && !busy()) {
        story(null, false).then(function (shown) { if (shown) delayStory(); else nextStory = Date.now() + 30000; });
      }
    }, 1000);
    window.addEventListener('pagehide', function () { stop(false); clearInterval(lifeTimer); clearInterval(interruptionTimer); clearInterval(activityTimer); });
    load();
    return { frontSprite: function () { return artwork.front && artwork.front[0] || frames[0]; }, stop: stop, apply: apply, motion: motion, story: story, options: options };
  } };
})();
