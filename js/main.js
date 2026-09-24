// Shell

const MODE_ORDER = ['boids', 'slime', 'audio'];

const UI = window.PARTICLE_UI;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const switcherEl = document.getElementById('mode-switcher');
const controlsEl = document.getElementById('controls');
const modeTitleEl = document.getElementById('mode-title');
const modeIndexEl = document.getElementById('mode-index');
const pausedEl = document.getElementById('paused-badge');
const uiToggleEl = document.getElementById('ui-toggle');
const hudEl = document.getElementById('hud');
const hudBodyEl = document.getElementById('hud-body');
const hudCloseEl = document.getElementById('hud-close');

let activeMode = null;
let activeModeKey = null;
let modeControlsEl = null;
let controlDefaults = {};
let paused = false;
let viewWidth = window.innerWidth;
let viewHeight = window.innerHeight;
let lastFrameTime = performance.now();

// ---------------- Canvas sizing ----------------

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;

  canvas.width = Math.round(viewWidth * dpr);
  canvas.height = Math.round(viewHeight * dpr);
  canvas.style.width = viewWidth + 'px';
  canvas.style.height = viewHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (activeMode) {
    activeMode.resize(viewWidth, viewHeight);
    if (paused) activeMode.draw(ctx);
  }
}

window.addEventListener('resize', resizeCanvas);

// ---------------- Mode buttons ----------------

const modeButtons = {};

MODE_ORDER.forEach((key, i) => {
  const mode = window.PARTICLE_MODES[key];
  if (!mode) {
    console.warn(`MODE_ORDER lists "${key}" but no mode registered it. Missing <script> tag?`);
    return;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mode-btn';
  btn.dataset.mode = key;
  btn.title = `${mode.label} (${i + 1})`;
  btn.setAttribute('aria-keyshortcuts', String(i + 1));
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = `<span class="mode-num">0${i + 1}</span>`;
  btn.append(document.createTextNode(mode.label));
  btn.addEventListener('click', (e) => {
    setMode(key);
    if (e.detail > 0) btn.blur();
  });
  switcherEl.appendChild(btn);
  modeButtons[key] = btn;
});

// ---------------- Mode switching ----------------

function setMode(key, { params = null, force = false } = {}) {
  if (key === activeModeKey && !force) return;

  const mode = window.PARTICLE_MODES[key];
  if (!mode || !modeButtons[key]) {
    console.warn(`Unknown mode: ${key}`);
    return;
  }

  if (activeMode) activeMode.destroy();

  controlsEl.innerHTML = '';
  ctx.clearRect(0, 0, viewWidth, viewHeight);
  UI.palette.refresh();

  activeMode = mode;
  activeModeKey = key;

  const index = MODE_ORDER.indexOf(key);
  modeTitleEl.textContent = mode.label;
  modeIndexEl.textContent = `MODE 0${index + 1} / 0${MODE_ORDER.length}`;
  document.title = `${mode.label} · Particle Playground`;

  for (const [k, btn] of Object.entries(modeButtons)) {
    const on = k === key;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }

  buildPanel(mode);
  mode.init(ctx, viewWidth, viewHeight, modeControlsEl);

  controlDefaults = {};
  for (const el of modeControlsEl.querySelectorAll('[data-key]')) {
    controlDefaults[el.dataset.key] = el.value;
  }
  if (params) applyParams(params);

  writeHash();
  if (paused) activeMode.draw(ctx);
  renderHud(true);
}

function buildPanel(mode) {
  if (mode.blurb) {
    const details = document.createElement('details');
    details.className = 'blurb';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'How this works';
    details.appendChild(summary);
    for (const line of [].concat(mode.blurb)) {
      const p = document.createElement('p');
      p.textContent = line;
      details.appendChild(p);
    }
    controlsEl.appendChild(details);
  }

  modeControlsEl = document.createElement('div');
  modeControlsEl.className = 'mode-controls';
  controlsEl.appendChild(modeControlsEl);

  const copyBtn = UI.makeButton('Copy link', () => copyLink(copyBtn), {
    title: 'Copy a link to this mode with the current settings',
  });
  const resetBtn = UI.makeButton('Reset', resetMode, { title: 'Back to default settings (R)' });
  const footer = UI.makeButtonRow([resetBtn, copyBtn]);
  footer.classList.add('panel-footer');
  controlsEl.appendChild(footer);
}

function resetMode() {
  setMode(activeModeKey, { force: true });
}

// ---------------- URL hash ----------------

function parseHash() {
  const raw = decodeURIComponent(location.hash.slice(1));
  if (!raw) return { mode: null, params: {} };
  const [mode, ...pairs] = raw.split('&');
  const params = {};
  for (const pair of pairs) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) params[k] = v;
  }
  return { mode, params };
}

function writeHash() {
  if (!modeControlsEl) return;
  const parts = [activeModeKey];
  for (const el of modeControlsEl.querySelectorAll('[data-key]')) {
    const k = el.dataset.key;
    if (el.value !== controlDefaults[k]) parts.push(`${k}=${el.value}`);
  }
  history.replaceState(null, '', '#' + parts.join('&'));
}

function applyParams(params) {
  for (const [k, v] of Object.entries(params)) {
    const el = modeControlsEl.querySelector(`[data-key="${CSS.escape(k)}"]`);
    if (!el) continue;
    el.value = v;
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
  }
}

controlsEl.addEventListener('input', writeHash);
controlsEl.addEventListener('change', writeHash);

window.addEventListener('hashchange', () => {
  const { mode, params } = parseHash();
  if (mode && mode !== activeModeKey && modeButtons[mode]) {
    setMode(mode, { params });
  } else if (mode === activeModeKey) {
    applyParams(params);
  }
});

async function copyLink(btn) {
  writeHash();
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'Copied';
  } catch (err) {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
}

// ---------------- Panel + HUD toggles ----------------

function setControlsVisible(visible) {
  controlsEl.classList.toggle('hidden', !visible);
  uiToggleEl.textContent = visible ? '–' : '+';
  uiToggleEl.setAttribute('aria-expanded', String(visible));
}

uiToggleEl.addEventListener('click', () => {
  setControlsVisible(controlsEl.classList.contains('hidden'));
});

if (window.matchMedia('(max-width: 640px)').matches) setControlsVisible(false);

function setHudVisible(visible) {
  hudEl.hidden = !visible;
}

hudCloseEl.addEventListener('click', () => setHudVisible(false));

// ---------------- Info panel ----------------

const infoToggleEl = document.getElementById('info-toggle');
const infoPanelEl = document.getElementById('info-panel');
const infoCloseEl = document.getElementById('info-close');

function setInfoOpen(open) {
  infoPanelEl.hidden = !open;
  infoToggleEl.setAttribute('aria-expanded', String(open));
  infoToggleEl.classList.toggle('active', open);
}

infoToggleEl.addEventListener('click', () => setInfoOpen(infoPanelEl.hidden));
infoCloseEl.addEventListener('click', () => {
  setInfoOpen(false);
  infoToggleEl.focus();
});

document.addEventListener('pointerdown', (e) => {
  if (infoPanelEl.hidden) return;
  if (infoPanelEl.contains(e.target) || infoToggleEl.contains(e.target)) return;
  setInfoOpen(false);
  if (e.target === canvas) e.stopPropagation();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !infoPanelEl.hidden) {
    setInfoOpen(false);
    infoToggleEl.focus();
  }
});

function setPaused(p) {
  paused = p;
  pausedEl.hidden = !paused;
  document.body.classList.toggle('is-paused', paused);
}

// ---------------- Keyboard ----------------

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'range')) return;

  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= MODE_ORDER.length) {
    setMode(MODE_ORDER[n - 1]);
    return;
  }

  switch (e.key) {
    case ' ':
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SUMMARY') return;
      e.preventDefault();
      setPaused(!paused);
      break;
    case 'h':
    case 'H':
      setHudVisible(hudEl.hidden);
      break;
    case 'c':
    case 'C':
      setControlsVisible(controlsEl.classList.contains('hidden'));
      break;
    case 'r':
    case 'R':
      resetMode();
      break;
  }
});

// ---------------- Pointer ----------------

function forwardPointer(type, e) {
  if (!activeMode || !activeMode.pointer) return;
  activeMode.pointer({
    type,
    x: e.clientX,
    y: e.clientY,
    pressed: e.buttons > 0 || type === 'down',
    pointerType: e.pointerType,
  });
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  forwardPointer('down', e);
});
canvas.addEventListener('pointermove', (e) => forwardPointer('move', e));
canvas.addEventListener('pointerup', (e) => forwardPointer('up', e));
canvas.addEventListener('pointercancel', (e) => forwardPointer('up', e));
canvas.addEventListener('pointerleave', (e) => forwardPointer('leave', e));

// ---------------- HUD ----------------

let fpsFrames = 0;
let fpsWindowStart = performance.now();
let fps = 0;
let frameMs = 0;
let lastHudRender = 0;

function renderHud(force) {
  const now = performance.now();
  if (!force && now - lastHudRender < 250) return;
  lastHudRender = now;
  if (hudEl.hidden) return;

  const rows = [
    ['FPS', paused ? 'paused' : fps.toFixed(0)],
    ['FRAME', frameMs.toFixed(1) + ' ms'],
  ];
  if (activeMode && activeMode.stats) rows.push(...activeMode.stats());

  hudBodyEl.innerHTML = '';
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'hud-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'hud-value';
    v.textContent = value;
    row.append(l, v);
    hudBodyEl.appendChild(row);
  }
}

// ---------------- Animation loop ----------------

function frame(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 1 / 30);
  lastFrameTime = now;

  if (activeMode && !paused) {
    const t0 = performance.now();
    activeMode.update(dt);
    activeMode.draw(ctx);
    const cost = performance.now() - t0;
    frameMs = frameMs * 0.9 + cost * 0.1;

    fpsFrames++;
    if (now - fpsWindowStart >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsWindowStart);
      fpsFrames = 0;
      fpsWindowStart = now;
    }
  } else {
    fpsFrames = 0;
    fpsWindowStart = now;
  }

  renderHud(false);
  requestAnimationFrame(frame);
}

// ---------------- Boot ----------------

resizeCanvas();
const initial = parseHash();
setMode(modeButtons[initial.mode] ? initial.mode : MODE_ORDER[0], { params: initial.params });
requestAnimationFrame(frame);
