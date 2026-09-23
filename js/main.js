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

   This file never knows the internals of a mode — it only calls
   these five hooks. Adding a new simulation means writing one file
   under js/modes/ and adding one line to MODE_ORDER below.
------------------------------------------------------------------ */

const MODE_ORDER = ['boids', 'slime', 'audio'];
const MODE_LABELS = {
  boids: 'Boids',
  slime: 'Slime Mold',
  audio: 'Audio Reactive',
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const controlsEl = document.getElementById('controls');
const modeTitleEl = document.getElementById('mode-title');
const uiToggleEl = document.getElementById('ui-toggle');

let activeMode = null;
let activeModeKey = null;
let lastFrameTime = performance.now();

// ---------------- Canvas sizing ----------------

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (activeMode && activeMode.resize) {
    activeMode.resize(width, height);
  }
}

window.addEventListener('resize', resizeCanvas);

// ---------------- Mode switching ----------------

function setMode(key) {
  if (key === activeModeKey) return;

  const mode = window.PARTICLE_MODES[key];
  if (!mode) {
    console.warn(`Unknown mode: ${key}`);
    return;
  }

  if (activeMode && activeMode.destroy) {
    activeMode.destroy();
  }

  controlsEl.innerHTML = '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  activeMode = mode;
  activeModeKey = key;
  modeTitleEl.textContent = MODE_LABELS[key];

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === key);
  });

  activeMode.init(ctx, window.innerWidth, window.innerHeight, controlsEl);
}

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

uiToggleEl.addEventListener('click', () => {
  controlsEl.classList.toggle('hidden');
  uiToggleEl.textContent = controlsEl.classList.contains('hidden') ? '+' : '–';
});

// ---------------- Animation loop ----------------

function frame(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 1 / 30); // clamp dt so tab-switches don't cause a huge jump
  lastFrameTime = now;

  if (activeMode) {
    activeMode.update(dt);
    activeMode.draw(ctx);
  }

  requestAnimationFrame(frame);
}

// ---------------- Boot ----------------

resizeCanvas();
setMode(MODE_ORDER[0]);
requestAnimationFrame(frame);
