/* BFTIMER — a big blocky pixel countdown. No sound, ever. */
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

  // Accepts "50" (minutes), "50:00", "1:30:00". Returns whole seconds, or null.
  const parseLength = (input) => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(':');
    if (parts.length > 3 || !parts.every((p) => /^\d*$/.test(p))) return null;
    const n = parts.map((p) => Number(p || 0));
    const total =
      n.length === 1 ? n[0] * 60 :
      n.length === 2 ? n[0] * 60 + n[1] :
                       n[0] * 3600 + n[1] * 60 + n[2];
    return total > 0 ? total : null;
  };

  // ---------------------------------------------------------------- presets

  const STORAGE_KEY = 'bftimer.presets.v1';

  const DEFAULT_PRESETS = [
    { id: 'p1', name: 'art pass', seconds: 50 * 60 },
    { id: 'p2', name: 'break', seconds: 15 * 60 },
    { id: 'p3', name: 'sprint', seconds: 25 * 60 },
    { id: 'p4', name: 'deep work', seconds: 90 * 60 },
    { id: 'p5', name: 'quick check', seconds: 5 * 60 },
  ];

  let presets = loadPresets();

  function loadPresets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_PRESETS.slice();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_PRESETS.slice();
      return parsed.filter((p) => p && typeof p.name === 'string' && Number.isFinite(p.seconds));
    } catch {
      return DEFAULT_PRESETS.slice();
    }
  }

  function savePresets() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch {
      /* private mode / quota — presets just won't persist */
    }
  }

  const newId = () =>
    (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}${Math.random()}`);

  // ---------------------------------------------------------------- timer

  const timer = {
    state: 'ready', // ready | running | paused | finished
    total: 50 * 60,
    remaining: 50 * 60,
    deadline: null,
    activeId: null,
  };

  let ticker = null;

  const isWarning = () =>
    timer.state === 'finished' || (timer.total > 0 && timer.remaining <= timer.total * 0.1);

  const displaySeconds = () => Math.max(0, Math.ceil(timer.remaining - 0.0001));

  function setLength(seconds, presetId = null) {
    stopTicker();
    timer.total = Math.max(1, seconds);
    timer.remaining = timer.total;
    timer.state = 'ready';
    timer.activeId = presetId;
    renderPresets();
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
    stopTicker();
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
    stopTicker();
    timer.remaining = timer.total;
    timer.state = 'ready';
    releaseWakeLock();
    render();
  }

  function adjust(delta) {
    const updated = Math.max(0, timer.remaining + delta);
    timer.remaining = updated;
    timer.total = Math.max(timer.total, updated);
    if (timer.state === 'running') {
      timer.deadline = Date.now() + updated * 1000;
    } else if (timer.state === 'finished' && updated > 0) {
      timer.state = 'paused';
    }
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

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
    timer.deadline = null;
  }

  function tick() {
    if (timer.state !== 'running') return;
    syncRemaining();
    if (timer.remaining <= 0) {
      timer.remaining = 0;
      stopTicker();
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
      danger: read('--danger'),
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
    const block = cell * 0.9; // hairline seam keeps the pixel grid legible
    const inset = (cell - block) / 2;
    const originX = (canvasWidth - cell * columns) / 2;
    const originY = (canvasHeight - cell * ROWS) / 2;

    const onColor = warning ? palette.danger : palette.lit;
    const offColor = warning ? palette.ghostDanger : palette.ghost;

    let column = 0;
    for (const char of text) {
      const glyph = GLYPHS[char];
      const width = glyphWidth(char);

      for (const pass of [0, 1]) {
        ctx.fillStyle = pass === 0 ? offColor : onColor;
        ctx.beginPath();
        for (let y = 0; y < ROWS; y++) {
          const line = glyph ? glyph[y] : '';
          for (let x = 0; x < width; x++) {
            const lit = line[x] === '1';
            if (lit !== (pass === 1)) continue;
            ctx.rect(
              originX + (column + x) * cell + inset,
              originY + y * cell + inset,
              block,
              block
            );
          }
        }
        ctx.fill();
      }
      column += width + GAP;
    }
  }

  // ---------------------------------------------------------------- flash

  const flashEl = document.getElementById('flash');

  function flash() {
    const frames = [];
    for (let i = 0; i < 3; i++) {
      const base = i / 3;
      frames.push(
        { opacity: 0, offset: base },
        { opacity: 0.9, offset: base + 0.05 },
        { opacity: 0, offset: base + 0.2 }
      );
    }
    frames.push({ opacity: 0, offset: 1 });

    if (flashEl.animate) {
      flashEl.animate(frames, { duration: 1500, easing: 'linear' });
    }
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

  // ---------------------------------------------------------------- sidebar UI

  const app = document.getElementById('app');
  const presetList = document.getElementById('presets');
  const toggleBtn = document.getElementById('toggle');
  const nameInput = document.getElementById('preset-name');
  const lengthInput = document.getElementById('preset-length');
  const saveBtn = document.getElementById('preset-save');
  const readout = document.getElementById('readout');

  function renderPresets() {
    presetList.replaceChildren();

    if (!presets.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'nothing saved yet';
      presetList.append(empty);
      return;
    }

    for (const preset of presets) {
      const item = document.createElement('li');

      const button = document.createElement('button');
      button.className = 'preset' + (preset.id === timer.activeId ? ' active' : '');
      button.type = 'button';
      button.addEventListener('click', () => setLength(preset.seconds, preset.id));

      const name = document.createElement('span');
      name.className = 'preset-name';
      name.textContent = preset.name;

      const length = document.createElement('span');
      length.className = 'preset-length';
      length.textContent = clock(preset.seconds);

      const remove = document.createElement('span');
      remove.className = 'preset-delete';
      remove.setAttribute('role', 'button');
      remove.setAttribute('title', `Delete ${preset.name}`);
      remove.textContent = '✕';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        presets = presets.filter((p) => p.id !== preset.id);
        savePresets();
        renderPresets();
      });

      button.append(name, length, remove);
      item.append(button);
      presetList.append(item);
    }
  }

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
    toggleBtn.classList.toggle('running', timer.state === 'running');
    toggleBtn.classList.toggle('warning', isWarning());
  }

  // ---------------------------------------------------------------- wiring

  toggleBtn.addEventListener('click', toggle);
  document.getElementById('reset').addEventListener('click', reset);

  for (const button of document.querySelectorAll('[data-adjust]')) {
    button.addEventListener('click', () => adjust(Number(button.dataset.adjust)));
  }

  document.getElementById('hide-sidebar').addEventListener('click', () => setSidebar(false));
  document.getElementById('show-sidebar').addEventListener('click', () => setSidebar(true));

  function setSidebar(visible) {
    app.classList.toggle('sidebar-hidden', !visible);
    requestAnimationFrame(resizeCanvas);
  }

  lengthInput.addEventListener('input', () => {
    saveBtn.disabled = parseLength(lengthInput.value) === null;
  });

  document.getElementById('preset-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const seconds = parseLength(lengthInput.value);
    if (seconds === null) return;
    const name = nameInput.value.trim() || clock(seconds);
    presets.push({ id: newId(), name, seconds });
    savePresets();
    renderPresets();
    render();
    nameInput.value = '';
    lengthInput.value = '';
    saveBtn.disabled = true;
  });

  // Fullscreen hides the sidebar so the clock owns the whole screen.
  const fullscreenBtn = document.getElementById('fullscreen');

  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });

  let sidebarBeforeFullscreen = true;

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      sidebarBeforeFullscreen = !app.classList.contains('sidebar-hidden');
      setSidebar(false);
    } else {
      setSidebar(sidebarBeforeFullscreen);
    }
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

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
        fullscreenBtn.click();
        break;
      case '\\':
        setSidebar(app.classList.contains('sidebar-hidden'));
        break;
    }
  });

  new ResizeObserver(resizeCanvas).observe(stage);
  window.addEventListener('resize', resizeCanvas);

  // ---------------------------------------------------------------- boot

  renderPresets();
  if (presets.length) setLength(presets[0].seconds, presets[0].id);
  resizeCanvas();
  render();
})();
