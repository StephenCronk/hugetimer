/* BFTIMER — a huge blocky neon countdown. No sound, ever. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- font
  //
  // 11x16 cells per digit, every stroke 4 cells thick. Fine grid, fat strokes:
  // the glyphs read as solid slabs while the pixel seams stay visible.

  const ROWS = 16;
  const GAP = 3; // blank columns between glyphs

  const rep = (row, count) => Array(count).fill(row);

  const GLYPHS = {
    '0': [...rep('11111111111', 4), ...rep('11110001111', 8), ...rep('11111111111', 4)],
    '1': [...rep('00011110000', 2), ...rep('01111110000', 2), ...rep('00011110000', 8), ...rep('11111111111', 4)],
    '2': [...rep('11111111111', 4), ...rep('00000001111', 2), ...rep('11111111111', 4), ...rep('11110000000', 2), ...rep('11111111111', 4)],
    '3': [...rep('11111111111', 4), ...rep('00000001111', 2), ...rep('00011111111', 4), ...rep('00000001111', 2), ...rep('11111111111', 4)],
    '4': [...rep('11110001111', 6), ...rep('11111111111', 4), ...rep('00000001111', 6)],
    '5': [...rep('11111111111', 4), ...rep('11110000000', 2), ...rep('11111111111', 4), ...rep('00000001111', 2), ...rep('11111111111', 4)],
    '6': [...rep('11111111111', 4), ...rep('11110000000', 2), ...rep('11111111111', 4), ...rep('11110001111', 2), ...rep('11111111111', 4)],
    '7': [...rep('11111111111', 4), ...rep('00000001111', 12)],
    '8': [...rep('11111111111', 4), ...rep('11110001111', 2), ...rep('11111111111', 4), ...rep('11110001111', 2), ...rep('11111111111', 4)],
    '9': [...rep('11111111111', 4), ...rep('11110001111', 2), ...rep('11111111111', 4), ...rep('00000001111', 2), ...rep('11111111111', 4)],
    ':': [...rep('0000', 3), ...rep('1111', 4), ...rep('0000', 2), ...rep('1111', 4), ...rep('0000', 3)],
  };

  const glyphWidth = (char) => (GLYPHS[char] ? GLYPHS[char][0].length : 11);

  const textWidth = (text) =>
    [...text].reduce((sum, char) => sum + glyphWidth(char), 0) + GAP * (text.length - 1);

  // ---------------------------------------------------------------- format

  const clock = (totalSeconds) => {
    const t = Math.max(0, totalSeconds);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  // ---------------------------------------------------------------- timer

  const DEFAULT_LENGTH = 50 * 60;

  const timer = {
    state: 'ready', // ready | running | paused | finished
    total: DEFAULT_LENGTH,
    remaining: DEFAULT_LENGTH,
    deadline: null,
  };

  let ticker = null;

  const isWarning = () =>
    timer.state === 'finished' || (timer.total > 0 && timer.remaining <= timer.total * 0.1);

  const displaySeconds = () => Math.max(0, Math.ceil(timer.remaining - 0.0001));

  function setLength(seconds) {
    halt();
    timer.total = Math.max(1, seconds);
    timer.remaining = timer.total;
    timer.state = 'ready';
    releaseWakeLock();
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

  const canvas = document.getElementById('clock');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');

  let canvasWidth = 0;
  let canvasHeight = 0;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvasWidth = rect.width;
    canvasHeight = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawClock();
  }

  // Palette is static, so read it from CSS once rather than every frame.
  const palette = (() => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name) => styles.getPropertyValue(name).trim();
    return {
      lit: read('--lit'),
      litSoft: read('--lit-soft'),
      danger: read('--danger'),
      dangerSoft: read('--danger-soft'),
      ghost: read('--ghost'),
      ghostDanger: read('--ghost-danger'),
    };
  })();

  function drawClock() {
    const text = clock(displaySeconds());
    const warning = isWarning();

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const columns = textWidth(text);
    if (!columns || canvasWidth <= 0 || canvasHeight <= 0) return;

    const cell = Math.min(canvasWidth / columns, canvasHeight / ROWS);
    const block = cell * 0.88; // hairline seam keeps the pixel grid legible
    const inset = (cell - block) / 2;
    const originX = (canvasWidth - cell * columns) / 2;
    const originY = (canvasHeight - cell * ROWS) / 2;

    const onColor = warning ? palette.danger : palette.lit;
    const offColor = warning ? palette.ghostDanger : palette.ghost;
    const glowColor = warning ? palette.dangerSoft : palette.litSoft;

    // Unlit cells first (flat), then the lit ones twice: a wide soft bloom
    // underneath and a crisp pass on top, so the strokes read as neon tube.
    for (const layer of ['off', 'glow', 'on']) {
      ctx.save();
      if (layer === 'glow') {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = cell * 2.2;
      }
      ctx.fillStyle = layer === 'off' ? offColor : onColor;

      let column = 0;
      for (const char of text) {
        const glyph = GLYPHS[char];
        const width = glyphWidth(char);

        ctx.beginPath();
        for (let y = 0; y < ROWS; y++) {
          const line = glyph ? glyph[y] : '';
          for (let x = 0; x < width; x++) {
            const lit = line[x] === '1';
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
  const flashEl = document.getElementById('flash');
  const FLASH_STEP = 130; // ms per on or off beat
  const FLASH_BEATS = 10; // 5 blinks

  let flashTimer = null;

  function flash() {
    stopFlash();
    let beat = 0;
    const step = () => {
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

  let wakeLock = null;

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && timer.state === 'running') requestWakeLock();
  });

  // ---------------------------------------------------------------- UI

  const toggleBtn = document.getElementById('toggle');
  const readout = document.getElementById('readout');
  const lengthBtns = [...document.querySelectorAll('[data-length]')];

  let lastAnnounced = null;

  function render() {
    drawClock();

    const text = clock(displaySeconds());
    const announcement = `${text} ${timer.state}`;
    if (announcement !== lastAnnounced) {
      readout.textContent = announcement;
      document.title = timer.state === 'ready' ? 'BFTIMER' : `${text} · BFTIMER`;
      lastAnnounced = announcement;
    }

    toggleBtn.textContent =
      timer.state === 'running' ? 'PAUSE' :
      timer.state === 'paused' ? 'RESUME' :
      timer.state === 'finished' ? 'RESET' : 'START';
    toggleBtn.classList.toggle('warning', isWarning());

    for (const button of lengthBtns) {
      button.classList.toggle('active', Number(button.dataset.length) === timer.total);
    }
  }

  // ---------------------------------------------------------------- wiring

  toggleBtn.addEventListener('click', toggle);
  document.getElementById('reset').addEventListener('click', reset);

  for (const button of lengthBtns) {
    button.addEventListener('click', () => setLength(Number(button.dataset.length)));
  }

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A focused chip handles its own Space/Enter — don't double-fire.
    if (event.target instanceof HTMLButtonElement) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        toggle();
        break;
      case 'r':
      case 'R':
        reset();
        break;
      case 'f':
      case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => {});
        break;
    }
  });

  new ResizeObserver(resizeCanvas).observe(stage);
  window.addEventListener('resize', resizeCanvas);

  // ---------------------------------------------------------------- boot

  resizeCanvas();
  render();
})();
