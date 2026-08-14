/* BFTIMER — a huge blocky neon countdown. No sound, ever.
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
  var PALETTE = {
    lit:         '#00e5ff',
    litSoft:     'rgba(0, 229, 255, 0.55)',
    ghost:       'rgba(0, 229, 255, 0.07)',
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

    // Unlit cells first (flat), then the lit ones twice: a wide soft bloom
    // underneath and a crisp pass on top, so the strokes read as neon tube.
    var layers = ['off', 'glow', 'on'];

    for (var l = 0; l < layers.length; l++) {
      var layer = layers[l];

      ctx.save();
      if (layer === 'glow') {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = cell * 2.2;
      }
      ctx.fillStyle = layer === 'off' ? offColor : onColor;

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
            if (lit === (layer === 'off')) continue;
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
    // A focused chip handles its own Space/Enter — don't double-fire.
    if (event.target && event.target.tagName === 'BUTTON') return;

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

  resizeCanvas();
  render();
  requestAnimationFrame(resizeCanvas);
})();
