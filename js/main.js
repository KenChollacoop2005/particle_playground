/* ---------------------------------------------------------------
   Particle Playground — shell
   Owns the canvas, the animation loop, and mode switching.
   Each mode is a self-contained object registered on
   window.PARTICLE_MODES (see js/modes/*.js) that implements:

     init(ctx, width, height, controlsEl)  — setup + build its own
                                              control-row UI
     resize(width, height)                 — react to canvas resize
     update(dt)                            — advance simulation
     draw(ctx)                             — render one frame
     destroy()                             — teardown (stop audio
                                              streams, clear
                                              listeners, etc.)

   plus some plain data and optional extras the shell uses if present:

     label         — name shown on its button and in the title block
     blurb         — one-line "how this works" for the control panel
     stats()       — [[label, value], ...] rows for the HUD
     pointer(e)    — { type: 'down'|'move'|'up'|'leave', x, y,
                       pressed, pointerType } from mouse, pen or touch

   This file never knows the internals of a mode. Adding a new
   simulation means writing one file under js/modes/, adding its
   <script> tag to index.html, and adding its key to MODE_ORDER below.
   Buttons, keyboard shortcuts and the URL hash all derive from that.
------------------------------------------------------------------ */

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
let modeControlsEl = null;   // the container the active mode builds into
let controlDefaults = {};    // key -> value as built, so the hash only stores changes
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
    // Resizing wipes the canvas; repaint once so a paused frame doesn't go blank.
    if (paused) activeMode.draw(ctx);
  }
}

window.addEventListener('resize', resizeCanvas);

// ---------------- Mode buttons (generated from MODE_ORDER) ----------------

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
    // After a mouse click, drop focus so spacebar goes back to pause/resume.
    // Keyboard activations (detail === 0) keep focus where the user put it.
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

  // Remember what every keyed control was built with, then apply any
  // values from the URL on top of that.
  controlDefaults = {};
  for (const el of modeControlsEl.querySelectorAll('[data-key]')) {
    controlDefaults[el.dataset.key] = el.value;
  }
  if (params) applyParams(params);

  writeHash();
  if (paused) activeMode.draw(ctx);
  renderHud(true);
}

// Panel = blurb, then the mode's own controls, then a shared footer.
function buildPanel(mode) {
  if (mode.blurb) {
    const details = document.createElement('details');
    details.className = 'blurb';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'How this works';
    const p = document.createElement('p');
    p.textContent = mode.blurb;
    details.append(summary, p);
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

// ---------------- URL hash: #mode&key=value&key=value ----------------
// Only values that differ from the mode's defaults are written, so a
// link stays short and a default setup is just "#slime".

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

// Sets controls by key and fires their normal events, so the mode reacts
// exactly as if the user had moved the slider. The shell never touches
// mode state directly.
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

// Start collapsed on phones so the simulation is visible first.
if (window.matchMedia('(max-width: 640px)').matches) setControlsVisible(false);

function setHudVisible(visible) {
  hudEl.hidden = !visible;
}

hudCloseEl.addEventListener('click', () => setHudVisible(false));

function setPaused(p) {
  paused = p;
  pausedEl.hidden = !paused;
  document.body.classList.toggle('is-paused', paused);
}

// ---------------- Keyboard ----------------
//   1..n   switch mode        space  pause / resume
//   h      toggle HUD          c      toggle controls
//   r      reset mode

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
      // A focused button/slider keeps its native spacebar behavior.
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

// ---------------- Pointer (mouse, pen and touch in one path) ----------------

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
// FPS is counted over a half-second window; frame time is the cost of
// update + draw only (the part this code controls), smoothed. The DOM
// is only rewritten a few times a second so the HUD itself stays cheap.

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
  const dt = Math.min((now - lastFrameTime) / 1000, 1 / 30); // clamp dt so tab-switches don't cause a huge jump
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
