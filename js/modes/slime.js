// Mode: Slime Mold

(function () {
  const UI = window.PARTICLE_UI;

  const DEFAULTS = {
    agents: 80000,
    species: 1,
    sensorAngle: 30,
    sensorDist: 10,
    turnSpeed: 25,
    speed: 1.1,
    deposit: 1.0,
    decay: 12,
    diffuse: 0.25,
    rivalry: 0.8,
    spawn: 'random',
  };

  const PRESETS = [
    { name: 'Network',   values: {} },
    { name: 'Big cells', values: { sensorAngle: 45, turnSpeed: 45, sensorDist: 18 } },
    { name: 'Rivals',    values: { species: 3 } },
    { name: 'Colony',    values: { spawn: 'disc', decay: 6, diffuse: 0.6 } },
  ];

  const CONTROL_KEYS = {
    agents: 'agents', species: 'species', rivalry: 'rival', spawn: 'spawn',
    sensorAngle: 'sa', sensorDist: 'sd', turnSpeed: 'turn', speed: 'speed',
    deposit: 'dep', decay: 'decay', diffuse: 'diff',
  };

  const MAX_AGENTS = 250000;
  const MAX_SPECIES = 3;
  const SIM_PIXEL_BUDGET = 480000;
  const STEP = 1 / 60;
  const MAX_STEPS_PER_FRAME = 2;
  const TRAIL_CAP = 5;
  const TONE_K = TRAIL_CAP * 0.3;
  const TURN_VARIANTS = 8;
  const BRUSH_RADIUS = 5;
  const BRUSH_AMOUNT = TRAIL_CAP;

  let params = { ...DEFAULTS };
  let width = 0, height = 0;
  let simW = 0, simH = 0;
  let count = 0;
  let accumulator = 0;
  let dirty = true;
  let simMs = 0, renderMs = 0;

  const agentX = new Float64Array(MAX_AGENTS);
  const agentY = new Float64Array(MAX_AGENTS);
  const agentDX = new Float64Array(MAX_AGENTS);
  const agentDY = new Float64Array(MAX_AGENTS);
  const agentS = new Uint8Array(MAX_AGENTS);
  const turnCos = new Float64Array(TURN_VARIANTS);
  const turnSin = new Float64Array(TURN_VARIANTS);

  let trails = [];
  let scratch = null;

  let off = null, offCtx = null, image = null, pixels = null;

  let lastBrush = null;

  // ---------------- Setup ----------------

  function allocate() {
    const scale = Math.min(1, Math.sqrt(SIM_PIXEL_BUDGET / Math.max(1, width * height)));
    simW = Math.max(16, Math.round(width * scale));
    simH = Math.max(16, Math.round(height * scale));
    const n = simW * simH;

    trails = [];
    for (let s = 0; s < MAX_SPECIES; s++) trails.push(new Float32Array(n));
    scratch = new Float32Array(n);

    off = document.createElement('canvas');
    off.width = simW;
    off.height = simH;
    offCtx = off.getContext('2d');
    image = offCtx.createImageData(simW, simH);
    pixels = new Uint32Array(image.data.buffer);
    dirty = true;
  }

  function spawnOne(i) {
    const cx = simW / 2, cy = simH / 2;
    const minDim = Math.min(simW, simH);
    let x, y, a;

    switch (params.spawn) {
      case 'disc': {
        const r = Math.sqrt(Math.random()) * minDim * 0.4;
        const t = Math.random() * Math.PI * 2;
        x = cx + Math.cos(t) * r;
        y = cy + Math.sin(t) * r;
        a = t + Math.PI;
        break;
      }
      case 'ring': {
        const t = Math.random() * Math.PI * 2;
        const r = minDim * 0.42;
        x = cx + Math.cos(t) * r;
        y = cy + Math.sin(t) * r;
        a = t + Math.PI + (Math.random() - 0.5) * 0.5;
        break;
      }
      case 'burst': {
        a = Math.random() * Math.PI * 2;
        x = cx + Math.cos(a) * 2;
        y = cy + Math.sin(a) * 2;
        break;
      }
      default: {
        x = Math.random() * simW;
        y = Math.random() * simH;
        a = Math.random() * Math.PI * 2;
      }
    }

    agentX[i] = ((x % simW) + simW) % simW;
    agentY[i] = ((y % simH) + simH) % simH;
    agentDX[i] = Math.cos(a);
    agentDY[i] = Math.sin(a);
    agentS[i] = i % params.species;
  }

  function reseed() {
    for (let i = 0; i < count; i++) spawnOne(i);
    clearTrails();
  }

  function clearTrails() {
    for (const t of trails) t.fill(0);
    dirty = true;
  }

  function setCount(n) {
    for (let i = count; i < n; i++) spawnOne(i);
    count = n;
  }

  function setSpecies(n) {
    params.species = n;
    for (let i = 0; i < count; i++) agentS[i] = i % n;
    for (let s = n; s < MAX_SPECIES; s++) trails[s].fill(0);
    dirty = true;
  }

  // ---------------- Simulation step ----------------

  function stepAgents() {
    const W = simW, H = simH;
    const S = params.species;
    const sa = (params.sensorAngle * Math.PI) / 180;
    const cosSA = Math.cos(sa), sinSA = Math.sin(sa);
    const sd = params.sensorDist;
    const sp = params.speed;
    const dep = params.deposit;
    const rival = params.rivalry;
    const t0 = trails[0], t1 = trails[1], t2 = trails[2];

    const ta = (params.turnSpeed * Math.PI) / 180;
    for (let k = 0; k < TURN_VARIANTS; k++) {
      const t = ta * (0.6 + (0.4 * k) / (TURN_VARIANTS - 1));
      turnCos[k] = Math.cos(t);
      turnSin[k] = Math.sin(t);
    }

    function smell(s, idx) {
      if (S === 1) return t0[idx];
      const own = s === 0 ? t0[idx] : s === 1 ? t1[idx] : t2[idx];
      const all = S === 2 ? t0[idx] + t1[idx] : t0[idx] + t1[idx] + t2[idx];
      return own - rival * (all - own);
    }

    function sense(s, x, y, dx, dy) {
      let sx = x + dx * sd;
      let sy = y + dy * sd;
      if (sx < 0) sx += W; else if (sx >= W) sx -= W;
      if (sy < 0) sy += H; else if (sy >= H) sy -= H;
      return smell(s, (sy | 0) * W + (sx | 0));
    }

    for (let i = 0; i < count; i++) {
      const s = agentS[i];
      const x = agentX[i], y = agentY[i];
      let dx = agentDX[i], dy = agentDY[i];

      const fl = sense(s, x, y, dx * cosSA + dy * sinSA, dy * cosSA - dx * sinSA);
      const fc = sense(s, x, y, dx, dy);
      const fr = sense(s, x, y, dx * cosSA - dy * sinSA, dy * cosSA + dx * sinSA);

      let dir = 0;
      if (fc > fl && fc > fr) dir = 0;
      else if (fc < fl && fc < fr) dir = Math.random() < 0.5 ? -1 : 1;
      else if (fl > fr) dir = -1;
      else if (fr > fl) dir = 1;

      if (dir !== 0) {
        const k = (Math.random() * TURN_VARIANTS) | 0;
        const c = turnCos[k], sn = turnSin[k] * dir;
        const ndx = dx * c - dy * sn;
        dy = dy * c + dx * sn;
        dx = ndx;
      }

      let nx = x + dx * sp;
      let ny = y + dy * sp;
      if (nx < 0) nx += W; else if (nx >= W) nx -= W;
      if (ny < 0) ny += H; else if (ny >= H) ny -= H;

      agentX[i] = nx;
      agentY[i] = ny;
      agentDX[i] = dx;
      agentDY[i] = dy;

      const map = s === 0 ? t0 : s === 1 ? t1 : t2;
      const idx = (ny | 0) * W + (nx | 0);
      const v = map[idx] + dep;
      map[idx] = v < TRAIL_CAP ? v : TRAIL_CAP;
    }
  }

  function diffuseAndDecay(map) {
    const W = simW, H = simH;
    const keep = 1 - params.decay / 100;
    const mix = params.diffuse;
    const tmp = scratch;

    for (let y = 0; y < H; y++) {
      const row = y * W;
      const last = row + W - 1;
      tmp[row] = map[last] + map[row] + map[row + 1];
      for (let i = row + 1; i < last; i++) {
        tmp[i] = map[i - 1] + map[i] + map[i + 1];
      }
      tmp[last] = map[last - 1] + map[last] + map[row];
    }

    const inv9 = 1 / 9;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const up = (y === 0 ? H - 1 : y - 1) * W;
      const down = (y === H - 1 ? 0 : y + 1) * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const v = map[i];
        const blurred = (tmp[up + x] + tmp[i] + tmp[down + x]) * inv9;
        const next = (v + (blurred - v) * mix) * keep;
        map[i] = next > 1e-4 ? next : 0;
      }
    }
  }

  function step() {
    stepAgents();
    for (let s = 0; s < params.species; s++) diffuseAndDecay(trails[s]);
    dirty = true;
  }

  // ---------------- Rendering ----------------

  function renderImage() {
    const n = simW * simH;
    const S = params.species;
    const names = UI.palette.signals();
    const cols = [];
    for (let s = 0; s < S; s++) cols.push(UI.palette.rgb(names[s]));
    const [r0, g0, b0] = cols[0];
    const t0 = trails[0], t1 = trails[1], t2 = trails[2];

    for (let i = 0; i < n; i++) {
      let r, g, b, a;
      const v0 = t0[i];
      const k0 = v0 / (v0 + TONE_K);

      if (S === 1) {
        r = r0 * k0; g = g0 * k0; b = b0 * k0; a = k0;
      } else {
        const v1 = t1[i];
        const k1 = v1 / (v1 + TONE_K);
        r = r0 * k0 + cols[1][0] * k1;
        g = g0 * k0 + cols[1][1] * k1;
        b = b0 * k0 + cols[1][2] * k1;
        a = k0 + k1;
        if (S === 3) {
          const v2 = t2[i];
          const k2 = v2 / (v2 + TONE_K);
          r += cols[2][0] * k2;
          g += cols[2][1] * k2;
          b += cols[2][2] * k2;
          a += k2;
        }
      }

      if (a < 0.004) {
        pixels[i] = 0;
        continue;
      }

      const inv = 1 / a;
      r *= inv; g *= inv; b *= inv;
      if (a > 1) a = 1;
      const hot = a * a * a * 0.55;
      r += (255 - r) * hot;
      g += (255 - g) * hot;
      b += (255 - b) * hot;

      pixels[i] = ((a * 255) << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
    }

    offCtx.putImageData(image, 0, 0);
  }

  // ---------------- Pointer ----------------

  function brush(sx, sy) {
    const W = simW, H = simH;
    const r = BRUSH_RADIUS;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        let x = (sx + dx) | 0, y = (sy + dy) | 0;
        if (x < 0) x += W; else if (x >= W) x -= W;
        if (y < 0) y += H; else if (y >= H) y -= H;
        const amount = BRUSH_AMOUNT * (1 - d2 / r2);
        const idx = y * W + x;
        for (let s = 0; s < params.species; s++) {
          trails[s][idx] = Math.min(TRAIL_CAP, trails[s][idx] + amount);
        }
      }
    }
  }

  function paint(x, y) {
    const sx = (x / width) * simW;
    const sy = (y / height) * simH;
    const from = lastBrush || { x: sx, y: sy };
    const dist = Math.hypot(sx - from.x, sy - from.y);
    const steps = Math.max(1, Math.ceil(dist / (BRUSH_RADIUS * 0.5)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      brush(from.x + (sx - from.x) * t, from.y + (sy - from.y) * t);
    }
    lastBrush = { x: sx, y: sy };
    dirty = true;
  }

  // ---------------- Controls ----------------

  let panelEl = null;

  function applyPreset(preset) {
    const target = { ...DEFAULTS, ...preset.values };
    target.agents = params.agents;
    for (const [name, key] of Object.entries(CONTROL_KEYS)) {
      const el = panelEl.querySelector(`[data-key="${key}"]`);
      if (!el || String(el.value) === String(target[name])) continue;
      el.value = target[name];
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    }
  }

  function buildControls(controlsEl) {
    const degrees = (v) => v + '°';
    panelEl = controlsEl;

    const presetRow = UI.makeButtonRow(
      PRESETS.map((p) => UI.makeButton(p.name, () => applyPreset(p))),
    );
    presetRow.classList.add('grid-2');

    controlsEl.append(
      UI.makeSection('Presets'),
      presetRow,

      UI.makeSection('Colony'),
      UI.makeSlider({
        key: 'agents', label: 'Agents', min: 5000, max: MAX_AGENTS, step: 5000, value: params.agents,
        format: UI.formatCount,
        onChange: (v) => { params.agents = v; setCount(v); },
      }),
      UI.makeSlider({
        key: 'species', label: 'Species', min: 1, max: MAX_SPECIES, step: 1, value: params.species,
        onChange: (v) => setSpecies(v),
      }),
      UI.makeSlider({
        key: 'rival', label: 'Cross-species (attract / repel)', min: -1, max: 1, step: 0.1, value: params.rivalry,
        format: (v) => (v > 0 ? '+' : '') + v.toFixed(1),
        onChange: (v) => { params.rivalry = v; },
      }),
      UI.makeSelect({
        key: 'spawn', label: 'Starting shape', value: params.spawn,
        options: [
          { value: 'disc', label: 'Disc, facing in' },
          { value: 'ring', label: 'Ring' },
          { value: 'burst', label: 'Burst from center' },
          { value: 'random', label: 'Random scatter' },
        ],
        onChange: (v) => { params.spawn = v; reseed(); },
      }),

      UI.makeSection('Agent'),
      UI.makeSlider({
        key: 'sa', label: 'Sensor angle', min: 5, max: 90, step: 1, value: params.sensorAngle,
        format: degrees,
        onChange: (v) => { params.sensorAngle = v; },
      }),
      UI.makeSlider({
        key: 'sd', label: 'Sensor distance', min: 2, max: 40, step: 1, value: params.sensorDist,
        format: (v) => v + ' px',
        onChange: (v) => { params.sensorDist = v; },
      }),
      UI.makeSlider({
        key: 'turn', label: 'Turn speed', min: 2, max: 90, step: 1, value: params.turnSpeed,
        format: (v) => v + '°/step',
        onChange: (v) => { params.turnSpeed = v; },
      }),
      UI.makeSlider({
        key: 'speed', label: 'Move speed', min: 0.3, max: 3, step: 0.1, value: params.speed,
        format: (v) => v.toFixed(1) + ' px/step',
        onChange: (v) => { params.speed = v; },
      }),

      UI.makeSection('Trail map'),
      UI.makeSlider({
        key: 'dep', label: 'Deposit amount', min: 0.1, max: 5, step: 0.1, value: params.deposit,
        onChange: (v) => { params.deposit = v; },
      }),
      UI.makeSlider({
        key: 'decay', label: 'Decay rate', min: 0.5, max: 25, step: 0.5, value: params.decay,
        format: (v) => v.toFixed(1) + '%/step',
        onChange: (v) => { params.decay = v; },
      }),
      UI.makeSlider({
        key: 'diff', label: 'Diffusion', min: 0, max: 1, step: 0.05, value: params.diffuse,
        onChange: (v) => { params.diffuse = v; },
      }),

      UI.makeButtonRow([
        UI.makeButton('Reseed', reseed, { title: 'Respawn agents in the starting shape' }),
        UI.makeButton('Clear trails', clearTrails),
      ]),
      UI.makeNote('Click and drag to paint scent. Agents will find it and build around it.'),
    );
  }

  // ---------------- Mode registration ----------------

  window.PARTICLE_MODES = window.PARTICLE_MODES || {};
  window.PARTICLE_MODES.slime = {
    label: 'Slime Mold',
    blurb: [
      'This one\'s modeled on an actual organism, Physarum polycephalum, which can solve maze and shortest-path problems using nothing but this same local scent-following behavior. No brain, no plan, just chemistry.',
      'Each agent senses a scent trail at three points just ahead of it, left, center, and right, turns toward whichever reading is strongest, moves forward, and leaves its own scent behind. Run that on thousands of agents at once and the trail-following behavior that lets one agent find a path turns into a whole branching network, without anything deciding to build one. Turn on more than one species and they\'ll compete for the same trails or avoid each other entirely, depending on how you set it.',
      'Click and drag anywhere to paint your own scent onto the map, the colony will reroute toward it.',
    ],

    init(ctx, w, h, controlsEl) {
      params = { ...DEFAULTS };
      width = w;
      height = h;
      accumulator = 0;
      allocate();
      count = 0;
      setCount(params.agents);
      buildControls(controlsEl);
    },

    resize(w, h) {
      width = w;
      height = h;
      allocate();
      for (let i = 0; i < count; i++) spawnOne(i);
    },

    update(dt) {
      accumulator += dt;
      let steps = 0;
      const t0 = performance.now();
      while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
        step();
        accumulator -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
      if (steps) simMs = simMs * 0.9 + ((performance.now() - t0) / steps) * 0.1;
    },

    draw(ctx) {
      if (!dirty) return;
      const t0 = performance.now();
      renderImage();
      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, width, height);
      renderMs = renderMs * 0.9 + (performance.now() - t0) * 0.1;
      dirty = false;
    },

    destroy() {
      trails = [];
      scratch = null;
      off = offCtx = image = pixels = null;
      panelEl = null;
      count = 0;
      lastBrush = null;
    },

    stats() {
      return [
        ['AGENTS', UI.formatCount(count)],
        ['TRAIL MAP', `${simW}×${simH}`],
        ['SIM STEP', simMs.toFixed(1) + ' ms'],
        ['RENDER', renderMs.toFixed(1) + ' ms'],
      ];
    },

    pointer(e) {
      if (e.type === 'down' || (e.type === 'move' && e.pressed)) {
        if (e.type === 'down') lastBrush = null;
        paint(e.x, e.y);
      } else if (e.type === 'up' || e.type === 'leave') {
        lastBrush = null;
      }
    },
  };

})();
