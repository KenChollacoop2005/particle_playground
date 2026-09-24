// Mode: Boids

(function () {
  const UI = window.PARTICLE_UI;

  // ---- Defaults ----
  const DEFAULTS = {
    count: 600,
    maxSpeed: 220,
    perceptionRadius: 70,
    separationWeight: 1.6,
    alignmentWeight: 1.0,
    cohesionWeight: 1.0,
  };

  const MAX_COUNT = 3000;
  const PREDATOR_RADIUS = 150;
  const PREDATOR_FORCE = 14;
  const SIZE = 5;

  let params = { ...DEFAULTS };
  let count = 0;
  let width = 0;
  let height = 0;

  const px = new Float32Array(MAX_COUNT);
  const py = new Float32Array(MAX_COUNT);
  const vx = new Float32Array(MAX_COUNT);
  const vy = new Float32Array(MAX_COUNT);
  const nvx = new Float32Array(MAX_COUNT);
  const nvy = new Float32Array(MAX_COUNT);

  let cols = 1, rows = 1, cellW = 1, cellH = 1;
  let cellStart = new Int32Array(1);
  let cellCursor = new Int32Array(1);
  const cellOf = new Int32Array(MAX_COUNT);
  const sorted = new Int32Array(MAX_COUNT);
  const nearCols = new Int32Array(3);
  const nearRows = new Int32Array(3);

  let pairChecks = 0;
  const predator = { active: false, x: 0, y: 0 };

  // ---------------- Setup ----------------

  function spawn(from, to) {
    for (let i = from; i < to; i++) {
      px[i] = Math.random() * width;
      py[i] = Math.random() * height;
      const angle = Math.random() * Math.PI * 2;
      const speed = params.maxSpeed * 0.5;
      vx[i] = Math.cos(angle) * speed;
      vy[i] = Math.sin(angle) * speed;
    }
  }

  function setCount(n) {
    if (n > count) spawn(count, n);
    count = n;
  }

  // ---------------- Spatial hash ----------------

  function buildGrid() {
    const r = params.perceptionRadius;
    cols = Math.max(1, Math.floor(width / r));
    rows = Math.max(1, Math.floor(height / r));
    cellW = width / cols;
    cellH = height / rows;

    const cells = cols * rows;
    if (cellStart.length < cells + 1) {
      cellStart = new Int32Array(cells + 1);
      cellCursor = new Int32Array(cells);
    }
    cellStart.fill(0, 0, cells + 1);

    for (let i = 0; i < count; i++) {
      const cx = Math.min(cols - 1, (px[i] / cellW) | 0);
      const cy = Math.min(rows - 1, (py[i] / cellH) | 0);
      const c = cy * cols + cx;
      cellOf[i] = c;
      cellStart[c + 1]++;
    }
    for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
    cellCursor.set(cellStart.subarray(0, cells));
    for (let i = 0; i < count; i++) sorted[cellCursor[cellOf[i]]++] = i;
  }

  function neighborsOnAxis(c, n, out) {
    if (n < 3) {
      for (let k = 0; k < n; k++) out[k] = k;
      return n;
    }
    out[0] = c === 0 ? n - 1 : c - 1;
    out[1] = c;
    out[2] = c === n - 1 ? 0 : c + 1;
    return 3;
  }

  // ---------------- Simulation ----------------

  function steer(dt) {
    const r = params.perceptionRadius;
    const r2 = r * r;
    const halfW = width / 2;
    const halfH = height / 2;
    const { separationWeight, alignmentWeight, cohesionWeight, maxSpeed } = params;
    const step = dt * 60;
    let checks = 0;

    for (let i = 0; i < count; i++) {
      const xi = px[i], yi = py[i];
      let sepX = 0, sepY = 0;
      let alignX = 0, alignY = 0;
      let cohX = 0, cohY = 0;
      let neighbors = 0;

      const cell = cellOf[i];
      const nc = neighborsOnAxis(cell % cols, cols, nearCols);
      const nr = neighborsOnAxis((cell / cols) | 0, rows, nearRows);

      for (let a = 0; a < nr; a++) {
        const rowBase = nearRows[a] * cols;
        for (let b = 0; b < nc; b++) {
          const c = rowBase + nearCols[b];
          for (let k = cellStart[c], end = cellStart[c + 1]; k < end; k++) {
            const j = sorted[k];
            if (j === i) continue;
            checks++;

            let dx = xi - px[j];
            let dy = yi - py[j];
            if (dx > halfW) dx -= width; else if (dx < -halfW) dx += width;
            if (dy > halfH) dy -= height; else if (dy < -halfH) dy += height;

            const d2 = dx * dx + dy * dy;
            if (d2 === 0 || d2 > r2) continue;

            sepX += dx / d2;
            sepY += dy / d2;

            alignX += vx[j];
            alignY += vy[j];

            cohX -= dx;
            cohY -= dy;

            neighbors++;
          }
        }
      }

      let ax = 0, ay = 0;

      if (neighbors > 0) {
        const inv = 1 / neighbors;
        ax += sepX * inv * separationWeight;
        ay += sepY * inv * separationWeight;
        ax += (alignX * inv - vx[i]) * 0.02 * alignmentWeight;
        ay += (alignY * inv - vy[i]) * 0.02 * alignmentWeight;
        ax += cohX * inv * 0.001 * cohesionWeight;
        ay += cohY * inv * 0.001 * cohesionWeight;
      }

      if (predator.active) {
        let dx = xi - predator.x;
        let dy = yi - predator.y;
        if (dx > halfW) dx -= width; else if (dx < -halfW) dx += width;
        if (dy > halfH) dy -= height; else if (dy < -halfH) dy += height;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < PREDATOR_RADIUS) {
          const push = (1 - d / PREDATOR_RADIUS) * PREDATOR_FORCE;
          ax += (dx / d) * push;
          ay += (dy / d) * push;
        }
      }

      let nx = vx[i] + ax * step;
      let ny = vy[i] + ay * step;
      const speed = Math.hypot(nx, ny);
      if (speed > maxSpeed) {
        nx = (nx / speed) * maxSpeed;
        ny = (ny / speed) * maxSpeed;
      }
      nvx[i] = nx;
      nvy[i] = ny;
    }

    pairChecks = checks;
  }

  function move(dt) {
    for (let i = 0; i < count; i++) {
      vx[i] = nvx[i];
      vy[i] = nvy[i];
      let x = px[i] + vx[i] * dt;
      let y = py[i] + vy[i] * dt;
      if (x < 0) x += width; else if (x >= width) x -= width;
      if (y < 0) y += height; else if (y >= height) y -= height;
      px[i] = x;
      py[i] = y;
    }
  }

  // ---------------- Controls ----------------

  function buildControls(controlsEl) {
    controlsEl.append(
      UI.makeSection('Flock'),
      UI.makeSlider({
        key: 'count', label: 'Count', min: 20, max: MAX_COUNT, step: 10, value: params.count,
        onChange: (v) => { params.count = v; setCount(v); },
      }),
      UI.makeSlider({
        key: 'speed', label: 'Max speed', min: 50, max: 500, step: 10, value: params.maxSpeed,
        format: (v) => v + ' px/s',
        onChange: (v) => { params.maxSpeed = v; },
      }),
      UI.makeSlider({
        key: 'radius', label: 'Perception radius', min: 20, max: 200, step: 5, value: params.perceptionRadius,
        format: (v) => v + ' px',
        onChange: (v) => { params.perceptionRadius = v; },
      }),
      UI.makeSection('Rule weights'),
      UI.makeSlider({
        key: 'sep', label: 'Separation', min: 0, max: 3, step: 0.1, value: params.separationWeight,
        onChange: (v) => { params.separationWeight = v; },
      }),
      UI.makeSlider({
        key: 'align', label: 'Alignment', min: 0, max: 3, step: 0.1, value: params.alignmentWeight,
        onChange: (v) => { params.alignmentWeight = v; },
      }),
      UI.makeSlider({
        key: 'coh', label: 'Cohesion', min: 0, max: 3, step: 0.1, value: params.cohesionWeight,
        onChange: (v) => { params.cohesionWeight = v; },
      }),
      UI.makeNote('Move your cursor or drag a finger through the flock. They treat it like a predator.'),
    );
  }

  // ---------------- Mode registration ----------------

  window.PARTICLE_MODES = window.PARTICLE_MODES || {};
  window.PARTICLE_MODES.boids = {
    label: 'Boids',
    blurb: [
      'Flocking is the classic example of complex group behavior coming from simple local rules, no leader and no central control needed. It\'s the same idea Craig Reynolds used in 1986 to get realistic-looking flocks and schools in animation without hand-animating a single one of them.',
      'Each triangle only looks at its nearby neighbors and follows three rules: don\'t crowd them, match their heading, and drift toward their average position. That\'s it. No boid knows what the flock looks like, the shape is just what happens when every boid runs those three rules at once.',
      'Hover your mouse or drag a finger near the flock and it treats you like a predator, the boids nearest you scatter and the rest follow.',
    ],

    init(ctx, w, h, controlsEl) {
      params = { ...DEFAULTS };
      params.count = Math.max(150, Math.min(DEFAULTS.count, Math.round((w * h) / 2200 / 10) * 10));
      width = w;
      height = h;
      count = 0;
      setCount(params.count);
      predator.active = false;
      buildControls(controlsEl);
    },

    resize(w, h) {
      width = w;
      height = h;
      for (let i = 0; i < count; i++) {
        px[i] = ((px[i] % w) + w) % w;
        py[i] = ((py[i] % h) + h) % h;
      }
    },

    update(dt) {
      buildGrid();
      steer(dt);
      move(dt);
    },

    draw(ctx) {
      ctx.clearRect(0, 0, width, height);

      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const s = Math.hypot(vx[i], vy[i]) || 1;
        const c = vx[i] / s;
        const n = vy[i] / s;
        const x = px[i], y = py[i];
        const w = SIZE * 0.6;
        ctx.moveTo(x + c * SIZE, y + n * SIZE);
        ctx.lineTo(x - c * SIZE - n * w, y - n * SIZE + c * w);
        ctx.lineTo(x - c * SIZE + n * w, y - n * SIZE - c * w);
        ctx.closePath();
      }
      ctx.fillStyle = UI.palette.rgba('accent', 0.9);
      ctx.fill();

      if (predator.active) {
        ctx.beginPath();
        ctx.arc(predator.x, predator.y, PREDATOR_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = UI.palette.rgba('accent-2', 0.25);
        ctx.setLineDash([3, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },

    destroy() {
      count = 0;
      predator.active = false;
    },

    stats() {
      return [
        ['BOIDS', UI.formatCount(count)],
        ['GRID', `${cols}×${rows} cells`],
        ['PAIR CHECKS', UI.formatCount(pairChecks)],
        ['NAIVE WOULD BE', UI.formatCount(count * (count - 1))],
      ];
    },

    pointer(e) {
      if (e.type === 'leave' || (e.type === 'up' && e.pointerType !== 'mouse')) {
        predator.active = false;
        return;
      }
      predator.active = e.pointerType === 'mouse' || e.pressed;
      predator.x = e.x;
      predator.y = e.y;
    },
  };

})();
