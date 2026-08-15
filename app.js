/* BFTIMER — a huge blocky neon countdown.
   Deliberately conservative syntax (no optional chaining / optional catch) so
   older Safari parses the whole file — a parse error here leaves a blank page. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- font
  //
  // 11x16 cells per digit, every stroke 4 cells thick. Fine grid, fat strokes:
  // the glyphs read as solid slabs while the pixel seams stay visible.

  var ROWS = 16;
  var GAP = 3; // blank columns between glyphs

  var rep = function (row, count) { return Array(count).fill(row); };

  var GLYPHS = {
    '0': [].concat(rep('11111111111', 4), rep('11110001111', 8), rep('11111111111', 4)),
    '1': [].concat(rep('00011110000', 2), rep('01111110000', 2), rep('00011110000', 8), rep('11111111111', 4)),
    '2': [].concat(rep('11111111111', 4), rep('00000001111', 2), rep('11111111111', 4), rep('11110000000', 2), rep('11111111111', 4)),
    '3': [].concat(rep('11111111111', 4), rep('00000001111', 2), rep('00011111111', 4), rep('00000001111', 2), rep('11111111111', 4)),
    '4': [].concat(rep('11110001111', 6), rep('11111111111', 4), rep('00000001111', 6)),
    '5': [].concat(rep('11111111111', 4), rep('11110000000', 2), rep('11111111111', 4), rep('00000001111', 2), rep('11111111111', 4)),
    '6': [].concat(rep('11111111111', 4), rep('11110000000', 2), rep('11111111111', 4), rep('11110001111', 2), rep('11111111111', 4)),
    '7': [].concat(rep('11111111111', 4), rep('00000001111', 12)),
    '8': [].concat(rep('11111111111', 4), rep('11110001111', 2), rep('11111111111', 4), rep('11110001111', 2), rep('11111111111', 4)),
    '9': [].concat(rep('11111111111', 4), rep('11110001111', 2), rep('11111111111', 4), rep('00000001111', 2), rep('11111111111', 4)),
    ':': [].concat(rep('0000', 3), rep('1111', 4), rep('0000', 2), rep('1111', 4), rep('0000', 3))
  };

  function glyphWidth(char) {
    return GLYPHS[char] ? GLYPHS[char][0].length : 11;
  }

  function textWidth(text) {
    var total = 0;
    for (var i = 0; i < text.length; i++) total += glyphWidth(text.charAt(i));
    return total + GAP * (text.length - 1);
  }

  // Literal colours, not CSS custom properties. Reading vars back out of the
  // cascade can hand back "" before styles settle, and an empty fillStyle is
  // ignored by canvas — which paints the clock in the default black, i.e.
  // invisible. styles.css mirrors these values.
  //
  // lit/litSoft/ghost are rewritten by applyTheme() whenever the wheel moves;
  // the danger trio is fixed, because "nearly out of time" shouldn't change
  // meaning just because the theme did.
  var PALETTE = {
    lit:         '#ff6600',
    litSoft:     'rgba(255, 102, 0, 0.85)',
    ghost:       'rgba(255, 102, 0, 0.09)',
    danger:      '#ff2d78',
    dangerSoft:  'rgba(255, 45, 120, 0.55)',
    ghostDanger: 'rgba(255, 45, 120, 0.08)'
  };

  // ---------------------------------------------------------------- format

  function clock(totalSeconds) {
    var t = Math.max(0, totalSeconds);
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  // ---------------------------------------------------------------- timer

  var DEFAULT_LENGTH = 50 * 60;

  var timer = {
    state: 'ready', // ready | running | paused | finished
    total: DEFAULT_LENGTH,
    remaining: DEFAULT_LENGTH,
    deadline: null
  };

  var ticker = null;

  function isWarning() {
    return timer.state === 'finished' || (timer.total > 0 && timer.remaining <= timer.total * 0.1);
  }

  function displaySeconds() {
    return Math.max(0, Math.ceil(timer.remaining - 0.0001));
  }

  function setLength(seconds) {
    halt();
    timer.total = Math.max(1, seconds);
    timer.remaining = timer.total;
    timer.state = 'ready';
    releaseWakeLock();
    stopFlash();
    render();
  }

  function start() {
    if (timer.state === 'running') return;
    if (timer.remaining <= 0) timer.remaining = timer.total;
    timer.deadline = Date.now() + timer.remaining * 1000;
    timer.state = 'running';
    startTicker();
    requestWakeLock();
    play(startSound);
    render();
  }

  function pause() {
    if (timer.state !== 'running') return;
    syncRemaining();
    halt();
    timer.state = 'paused';
    releaseWakeLock();
    render();
  }

  function toggle() {
    if (timer.state === 'running') pause();
    else if (timer.state === 'finished') reset();
    else start();
  }

  function reset() {
    halt();
    timer.remaining = timer.total;
    timer.state = 'ready';
    releaseWakeLock();
    stopFlash();
    render();
  }

  function syncRemaining() {
    if (timer.deadline == null) return;
    timer.remaining = Math.max(0, (timer.deadline - Date.now()) / 1000);
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(tick, 100);
  }

  // Stops the interval only. The deadline is cleared by whoever actually halts
  // the run — start() sets it before ticking begins, so clearing it here would
  // wipe the deadline out from under the very tick loop it just started.
  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  function halt() {
    stopTicker();
    timer.deadline = null;
  }

  function tick() {
    if (timer.state !== 'running') return;
    syncRemaining();
    if (timer.remaining <= 0) {
      timer.remaining = 0;
      halt();
      timer.state = 'finished';
      releaseWakeLock();
      play(endSound);
      flash();
    }
    render();
  }

  // ---------------------------------------------------------------- canvas

  var canvas = document.getElementById('clock');
  var ctx = canvas.getContext('2d');
  var stage = document.getElementById('stage');

  var canvasWidth = 0;
  var canvasHeight = 0;
  var lastDrawn = null; // cache key of the face currently on the canvas

  // iOS Safari refuses to paint a canvas whose backing store is too large and
  // silently leaves it blank, so cap the pixel ratio rather than trusting it.
  var MAX_EDGE = 4096;

  function measureStage() {
    var styles = window.getComputedStyle(stage);
    var px = function (value) {
      var n = parseFloat(value);
      return isFinite(n) ? n : 0;
    };

    var w = stage.clientWidth - px(styles.paddingLeft) - px(styles.paddingRight);
    var h = stage.clientHeight - px(styles.paddingTop) - px(styles.paddingBottom);

    // If layout hasn't produced a usable box (Safari can hand back 0 for a flex
    // item mid-layout), fall back to the viewport less room for the controls.
    var root = document.documentElement;
    if (!(w > 0)) w = (window.innerWidth || root.clientWidth) - 56;
    if (!(h > 0)) h = (window.innerHeight || root.clientHeight) - 110;

    return { w: Math.max(80, w), h: Math.max(40, h) };
  }

  function resizeCanvas() {
    var box = measureStage();
    canvasWidth = box.w;
    canvasHeight = box.h;

    var dpr = window.devicePixelRatio || 1;
    dpr = Math.min(dpr, 3, MAX_EDGE / Math.max(canvasWidth, canvasHeight));
    if (!(dpr > 0)) dpr = 1;

    // Explicit px, never a percentage: percentage heights inside a flex column
    // resolve to zero in Safari, which is a blank clock.
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    canvas.width = Math.max(1, Math.round(canvasWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvasHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Touching canvas.width wipes the bitmap even when the size is unchanged,
    // so the redraw cache has to be dropped or we'd keep a blank canvas.
    lastDrawn = null;
    drawClock();
  }

  function drawClock() {
    var text = clock(displaySeconds());
    var warning = isWarning();

    // The ticker runs at 10Hz but the face only changes once a second.
    var key = text + '|' + warning + '|' + canvasWidth + 'x' + canvasHeight;
    if (key === lastDrawn) return;
    lastDrawn = key;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    var columns = textWidth(text);
    if (!columns || canvasWidth <= 0 || canvasHeight <= 0) return;

    var cell = Math.min(canvasWidth / columns, canvasHeight / ROWS);
    var block = cell * 0.88; // hairline seam keeps the pixel grid legible
    var inset = (cell - block) / 2;
    var originX = (canvasWidth - cell * columns) / 2;
    var originY = (canvasHeight - cell * ROWS) / 2;

    var onColor = warning ? PALETTE.danger : PALETTE.lit;
    var offColor = warning ? PALETTE.ghostDanger : PALETTE.ghost;
    var glowColor = warning ? PALETTE.dangerSoft : PALETTE.litSoft;

    // Unlit cells first (flat), then the lit ones four times: a wide halo, a
    // tighter hotter one, a bright core and a crisp pass on top. Stacking the
    // shadows is what makes the strokes read as burning rather than painted.
    var layers = [
      { fill: offColor, on: false, blur: 0 },
      { fill: onColor, on: true, blur: cell * 3.4, glow: glowColor },
      { fill: onColor, on: true, blur: cell * 1.6, glow: glowColor },
      { fill: onColor, on: true, blur: cell * 0.6, glow: onColor },
      { fill: onColor, on: true, blur: 0 }
    ];

    for (var l = 0; l < layers.length; l++) {
      var layer = layers[l];

      ctx.save();
      if (layer.blur > 0) {
        ctx.shadowColor = layer.glow;
        ctx.shadowBlur = layer.blur;
      }
      ctx.fillStyle = layer.fill;

      var column = 0;
      for (var i = 0; i < text.length; i++) {
        var char = text.charAt(i);
        var glyph = GLYPHS[char];
        var width = glyphWidth(char);

        ctx.beginPath();
        for (var y = 0; y < ROWS; y++) {
          var line = glyph ? glyph[y] : '';
          for (var x = 0; x < width; x++) {
            var lit = line.charAt(x) === '1';
            if (lit !== layer.on) continue;
            ctx.rect(
              originX + (column + x) * cell + inset,
              originY + y * cell + inset,
              block,
              block
            );
          }
        }
        ctx.fill();
        column += width + GAP;
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- flash

  // Hard on/off strobe at the finish — no fading, no easing.
  var flashEl = document.getElementById('flash');
  var FLASH_STEP = 130; // ms per on or off beat
  var FLASH_BEATS = 10; // 5 blinks

  var flashTimer = null;

  function flash() {
    stopFlash();
    var beat = 0;
    var step = function () {
      flashEl.classList.toggle('on', beat % 2 === 0);
      beat++;
      if (beat >= FLASH_BEATS) {
        stopFlash();
        return;
      }
      flashTimer = setTimeout(step, FLASH_STEP);
    };
    step();
  }

  function stopFlash() {
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = null;
    flashEl.classList.remove('on');
  }

  // ---------------------------------------------------------------- theme

  // The whole UI is tinted from one colour. CSS reads it as --lit-rgb, the
  // canvas reads it from PALETTE, and both are rewritten together here.

  var STORE_THEME = 'bftimer.theme';
  var DEFAULT_HSV = { h: 24, s: 1, v: 1 }; // #ff6600

  var theme = loadTheme();

  function loadTheme() {
    try {
      var raw = localStorage.getItem(STORE_THEME);
      if (!raw) return { h: DEFAULT_HSV.h, s: DEFAULT_HSV.s, v: DEFAULT_HSV.v };
      var saved = JSON.parse(raw);
      if (!saved || !isFinite(saved.h) || !isFinite(saved.s) || !isFinite(saved.v)) throw 0;
      return { h: saved.h, s: saved.s, v: saved.v };
    } catch (err) {
      return { h: DEFAULT_HSV.h, s: DEFAULT_HSV.s, v: DEFAULT_HSV.v };
    }
  }

  function saveTheme() {
    try {
      localStorage.setItem(STORE_THEME, JSON.stringify(theme));
    } catch (err) {
      /* private mode — the theme just won't survive a reload */
    }
  }

  // h 0-360, s/v 0-1 → {r,g,b} 0-255.
  function hsvToRgb(h, s, v) {
    var i = Math.floor((h % 360) / 60);
    var f = (h % 360) / 60 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    var r, g, b;

    switch (i) {
      case 0:  r = v; g = t; b = p; break;
      case 1:  r = q; g = v; b = p; break;
      case 2:  r = p; g = v; b = t; break;
      case 3:  r = p; g = q; b = v; break;
      case 4:  r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }

  function hex2(n) {
    var s = n.toString(16).toUpperCase();
    return s.length < 2 ? '0' + s : s;
  }

  function applyTheme() {
    var rgb = hsvToRgb(theme.h, theme.s, theme.v);
    var triplet = rgb.r + ', ' + rgb.g + ', ' + rgb.b;

    document.documentElement.style.setProperty('--lit-rgb', triplet);

    PALETTE.lit = 'rgb(' + triplet + ')';
    PALETTE.litSoft = 'rgba(' + triplet + ', 0.85)';
    PALETTE.ghost = 'rgba(' + triplet + ', 0.09)';

    if (hexOut) hexOut.textContent = '#' + hex2(rgb.r) + hex2(rgb.g) + hex2(rgb.b);

    lastDrawn = null; // the face is the old colour until it's repainted
    drawClock();
  }

  // ---------------------------------------------------------------- sound

  var STORE_MUTED = 'bftimer.muted';

  var startSound = new Audio('lockon.wav');
  var endSound = new Audio('bus.wav');
  startSound.preload = 'auto';
  endSound.preload = 'auto';

  var muted = false;
  try {
    muted = localStorage.getItem(STORE_MUTED) === '1';
  } catch (err) {
    /* private mode — just start unmuted */
  }

  // Safari only lets an element play from a timer if it has already played
  // during a user gesture, so the finish sound — which fires from setInterval —
  // gets a silent play/pause on the first gesture the page sees.
  //
  // Only endSound is primed. startSound always plays from a real click or
  // keypress, and priming it would race: the silent pass sets muted and pauses
  // asynchronously, which would cut off the very sound the gesture triggered.
  var primed = false;

  function primeAudio() {
    if (primed) return;
    primed = true;

    endSound.muted = true;
    var settle = function () {
      try { endSound.pause(); } catch (err) { /* never started */ }
      try { endSound.currentTime = 0; } catch (err) { /* not seekable yet */ }
      endSound.muted = false;
    };

    var played;
    try {
      played = endSound.play();
    } catch (err) {
      settle();
      return;
    }

    if (played && played.then) played.then(settle, settle);
    else settle();
  }

  function play(el) {
    if (muted) return;
    try {
      el.currentTime = 0;
      var played = el.play();
      if (played && played['catch']) played['catch'](function () {});
    } catch (err) {
      /* blocked or still loading — the timer doesn't depend on audio */
    }
  }

  function setMuted(next) {
    muted = next;
    if (muted) {
      try { endSound.pause(); } catch (err) { /* not playing */ }
      try { startSound.pause(); } catch (err) { /* not playing */ }
    }
    soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    soundBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    try {
      localStorage.setItem(STORE_MUTED, muted ? '1' : '0');
    } catch (err) {
      /* preference just won't persist */
    }
  }

  // ---------------------------------------------------------------- wake lock

  var wakeLock = null;

  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      navigator.wakeLock.request('screen').then(
        function (lock) { wakeLock = lock; },
        function () { wakeLock = null; }
      );
    } catch (err) {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      try {
        wakeLock.release();
      } catch (err) {
        /* already gone */
      }
    }
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (timer.state === 'running') {
      // Background tabs get throttled; the deadline is the source of truth.
      syncRemaining();
      requestWakeLock();
    }
    render();
  });

  // ---------------------------------------------------------------- UI

  var toggleBtn = document.getElementById('toggle');
  var readout = document.getElementById('readout');
  var lengthBtns = document.querySelectorAll('[data-length]');
  var themeBtn = document.getElementById('theme');
  var soundBtn = document.getElementById('sound');
  var picker = document.getElementById('picker');
  var wheel = document.getElementById('wheel');
  var wheelCtx = wheel.getContext('2d');
  var brightness = document.getElementById('brightness');
  var hexOut = document.getElementById('hex');

  var lastAnnounced = null;

  function render() {
    drawClock();

    var text = clock(displaySeconds());
    var announcement = text + ' ' + timer.state;
    if (announcement !== lastAnnounced) {
      readout.textContent = announcement;
      document.title = timer.state === 'ready' ? 'BFTIMER' : text + ' · BFTIMER';
      lastAnnounced = announcement;
    }

    toggleBtn.textContent =
      timer.state === 'running' ? 'PAUSE' :
      timer.state === 'paused' ? 'RESUME' :
      timer.state === 'finished' ? 'RESET' : 'START';
    toggleBtn.classList.toggle('warning', isWarning());

    for (var i = 0; i < lengthBtns.length; i++) {
      lengthBtns[i].classList.toggle(
        'active',
        Number(lengthBtns[i].getAttribute('data-length')) === timer.total
      );
    }
  }

  // ---------------------------------------------------------------- colour wheel

  // Hue around the rim, saturation out from the middle, value on the slider.

  var WHEEL_CSS = 196;

  function sizeWheel() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    wheel.style.width = WHEEL_CSS + 'px';
    wheel.style.height = WHEEL_CSS + 'px';
    wheel.width = Math.round(WHEEL_CSS * dpr);
    wheel.height = Math.round(WHEEL_CSS * dpr);
  }

  function drawWheel() {
    var size = wheel.width;
    if (!size) return;

    var radius = size / 2;
    var image = wheelCtx.createImageData(size, size);
    var data = image.data;

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var dx = x - radius + 0.5;
        var dy = y - radius + 0.5;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var i = (y * size + x) * 4;

        if (dist > radius) {
          data[i + 3] = 0;
          continue;
        }

        var hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        var rgb = hsvToRgb(hue, Math.min(1, dist / (radius - 1)), theme.v);

        data[i] = rgb.r;
        data[i + 1] = rgb.g;
        data[i + 2] = rgb.b;
        // Feather the last pixel of the rim, or the circle reads as a sawtooth.
        data[i + 3] = dist > radius - 1 ? Math.round(255 * (radius - dist)) : 255;
      }
    }

    wheelCtx.putImageData(image, 0, 0);

    var angle = theme.h * Math.PI / 180;
    var reach = theme.s * (radius - 1);
    wheelCtx.beginPath();
    wheelCtx.arc(radius + Math.cos(angle) * reach, radius + Math.sin(angle) * reach, radius * 0.05, 0, Math.PI * 2);
    wheelCtx.strokeStyle = theme.v > 0.55 ? '#04070d' : '#ffffff';
    wheelCtx.lineWidth = Math.max(2, radius * 0.02);
    wheelCtx.stroke();
  }

  function pickFromPoint(clientX, clientY) {
    var rect = wheel.getBoundingClientRect();
    if (!rect.width) return;

    var radius = rect.width / 2;
    var dx = clientX - rect.left - radius;
    var dy = clientY - rect.top - radius;

    theme.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    theme.s = Math.min(1, Math.sqrt(dx * dx + dy * dy) / radius);

    applyTheme();
    drawWheel();
  }

  var dragging = false;

  wheel.addEventListener('mousedown', function (event) {
    dragging = true;
    pickFromPoint(event.clientX, event.clientY);
    event.preventDefault();
  });

  document.addEventListener('mousemove', function (event) {
    if (dragging) pickFromPoint(event.clientX, event.clientY);
  });

  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    saveTheme(); // once per drag, not once per pixel
  });

  wheel.addEventListener('touchstart', function (event) {
    var touch = event.touches[0];
    if (!touch) return;
    pickFromPoint(touch.clientX, touch.clientY);
    event.preventDefault();
  });

  wheel.addEventListener('touchmove', function (event) {
    var touch = event.touches[0];
    if (!touch) return;
    pickFromPoint(touch.clientX, touch.clientY);
    event.preventDefault();
  });

  wheel.addEventListener('touchend', saveTheme);

  brightness.addEventListener('input', function () {
    theme.v = Number(brightness.value) / 100;
    applyTheme();
    drawWheel();
  });
  brightness.addEventListener('change', saveTheme);

  function setPicker(open) {
    picker.hidden = !open;
    themeBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      sizeWheel();
      drawWheel();
    }
  }

  themeBtn.addEventListener('click', function () {
    setPicker(picker.hidden);
  });

  soundBtn.addEventListener('click', function () {
    setMuted(!muted);
  });

  // Unlock audio on the first gesture. mousedown/touchstart/keydown rather than
  // click, so priming has always finished before any handler plays a sound.
  document.addEventListener('mousedown', primeAudio);
  document.addEventListener('touchstart', primeAudio);
  document.addEventListener('keydown', primeAudio);

  // Dismiss the picker on a click outside it.
  document.addEventListener('click', function (event) {
    if (picker.hidden) return;
    if (picker.contains(event.target) || themeBtn.contains(event.target)) return;
    setPicker(false);
  });

  // ---------------------------------------------------------------- wiring

  toggleBtn.addEventListener('click', toggle);
  document.getElementById('reset').addEventListener('click', reset);

  for (var b = 0; b < lengthBtns.length; b++) {
    (function (button) {
      button.addEventListener('click', function () {
        setLength(Number(button.getAttribute('data-length')));
      });
    })(lengthBtns[b]);
  }

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Escape' || event.key === 'Esc') {
      setPicker(false);
      return;
    }

    // A focused chip handles its own Space/Enter, and the brightness slider
    // owns its arrow keys — don't double-fire either.
    var tag = event.target ? event.target.tagName : '';
    if (tag === 'BUTTON' || tag === 'INPUT') return;

    switch (event.key) {
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        toggle();
        break;
      case 'r':
      case 'R':
        reset();
        break;
      case 'f':
      case 'F':
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
          var root = document.documentElement;
          if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
          else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
        }
        break;
    }
  });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () { resizeCanvas(); }).observe(stage);
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);
  // Fonts, the stylesheet and Safari's own layout can all settle after the
  // script runs; re-measure once everything is up rather than trusting boot.
  window.addEventListener('load', resizeCanvas);

  // ---------------------------------------------------------------- boot

  brightness.value = String(Math.round(theme.v * 100));
  applyTheme();
  setMuted(muted);
  sizeWheel();
  resizeCanvas();
  render();
  requestAnimationFrame(resizeCanvas);
})();
