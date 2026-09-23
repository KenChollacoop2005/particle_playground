/* ---------------------------------------------------------------
   Mode: Boids
   Classic Craig Reynolds flocking — each boid only looks at its
   local neighborhood and follows three rules:

     separation  — steer away from boids that are too close
     alignment   — steer toward the average heading of neighbors
     cohesion    — steer toward the average position of neighbors

   No boid knows about the flock as a whole. The flock shape is
   entirely emergent from these three local rules.
------------------------------------------------------------------ */

(function () {

  // ---- Tunable defaults (exposed as sliders in init()) ----
  const DEFAULTS = {
    count: 150,           // number of boids
    maxSpeed: 220,        // px/sec, top speed a boid can travel
    perceptionRadius: 70, // px, how far a boid can "see" neighbors
    separationWeight: 1.6,
    alignmentWeight: 1.0,
    cohesionWeight: 1.0,
  };

  let params = { ...DEFAULTS };
  let boids = [];
  let width = 0;
  let height = 0;

  class Boid {
    constructor(w, h) {
      this.x = Math.random() * w;
      this.y = Math.random() * h;
      const angle = Math.random() * Math.PI * 2;
      const speed = params.maxSpeed * 0.5;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
    }

    // Compute steering acceleration from the three flocking rules,
    // looking only at boids within perceptionRadius.
    flock(all) {
      let sepX = 0, sepY = 0, sepCount = 0;
      let alignX = 0, alignY = 0, alignCount = 0;
      let cohX = 0, cohY = 0, cohCount = 0;

      for (const other of all) {
        if (other === this) continue;
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > params.perceptionRadius) continue;

        // Separation: push away from close neighbors, weighted by proximity
        sepX += (dx / dist) / dist;
        sepY += (dy / dist) / dist;
        sepCount++;

        // Alignment: average neighbor velocity
        alignX += other.vx;
        alignY += other.vy;
        alignCount++;

        // Cohesion: average neighbor position
        cohX += other.x;
        cohY += other.y;
        cohCount++;
      }

      let ax = 0, ay = 0;

      if (sepCount > 0) {
        ax += (sepX / sepCount) * params.separationWeight;
        ay += (sepY / sepCount) * params.separationWeight;
      }
      if (alignCount > 0) {
        const avgVx = alignX / alignCount;
        const avgVy = alignY / alignCount;
        ax += (avgVx - this.vx) * 0.02 * params.alignmentWeight;
        ay += (avgVy - this.vy) * 0.02 * params.alignmentWeight;
      }
      if (cohCount > 0) {
        const avgX = cohX / cohCount;
        const avgY = cohY / cohCount;
        ax += (avgX - this.x) * 0.001 * params.cohesionWeight;
        ay += (avgY - this.y) * 0.001 * params.cohesionWeight;
      }

      return { ax, ay };
    }

    update(dt, all) {
      const { ax, ay } = this.flock(all);
      this.vx += ax * dt * 60; // scaled so behavior feels consistent across frame rates
      this.vy += ay * dt * 60;

      const speed = Math.hypot(this.vx, this.vy);
      if (speed > params.maxSpeed) {
        this.vx = (this.vx / speed) * params.maxSpeed;
        this.vy = (this.vy / speed) * params.maxSpeed;
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Wrap around edges rather than bouncing — keeps the flock
      // reading as one continuous space instead of a bounded box.
      if (this.x < -10) this.x = width + 10;
      if (this.x > width + 10) this.x = -10;
      if (this.y < -10) this.y = height + 10;
      if (this.y > height + 10) this.y = -10;
    }

    draw(ctx) {
      const angle = Math.atan2(this.vy, this.vx);
      const size = 6;

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size, size * 0.6);
      ctx.lineTo(-size, -size * 0.6);
      ctx.closePath();
      ctx.fillStyle = '#5eead4';
      ctx.fill();
      ctx.restore();
    }
  }

  function spawnBoids() {
    boids = Array.from({ length: params.count }, () => new Boid(width, height));
  }

  function buildControls(controlsEl) {
    controlsEl.appendChild(makeSlider('Count', 20, 400, params.count, 10, (v) => {
      params.count = v;
      spawnBoids();
    }));
    controlsEl.appendChild(makeSlider('Max speed', 50, 500, params.maxSpeed, 10, (v) => {
      params.maxSpeed = v;
    }));
    controlsEl.appendChild(makeSlider('Perception radius', 20, 200, params.perceptionRadius, 5, (v) => {
      params.perceptionRadius = v;
    }));
    controlsEl.appendChild(makeSlider('Separation', 0, 3, params.separationWeight, 0.1, (v) => {
      params.separationWeight = v;
    }));
    controlsEl.appendChild(makeSlider('Alignment', 0, 3, params.alignmentWeight, 0.1, (v) => {
      params.alignmentWeight = v;
    }));
    controlsEl.appendChild(makeSlider('Cohesion', 0, 3, params.cohesionWeight, 0.1, (v) => {
      params.cohesionWeight = v;
    }));
  }

  // Small shared helper: builds a labeled range input with a live value readout.
  function makeSlider(label, min, max, value, step, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const labelEl = document.createElement('label');
    const valueSpan = document.createElement('span');
    valueSpan.className = 'value';
    valueSpan.textContent = value;
    labelEl.textContent = label + ' ';
    labelEl.appendChild(valueSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valueSpan.textContent = v;
      onChange(v);
    });

    row.appendChild(labelEl);
    row.appendChild(input);
    return row;
  }

  window.PARTICLE_MODES = window.PARTICLE_MODES || {};
  window.PARTICLE_MODES.boids = {
    init(ctx, w, h, controlsEl) {
      params = { ...DEFAULTS };
      width = w;
      height = h;
      spawnBoids();
      buildControls(controlsEl);
    },

    resize(w, h) {
      width = w;
      height = h;
    },

    update(dt) {
      for (const boid of boids) {
        boid.update(dt, boids);
      }
    },

    draw(ctx) {
      ctx.clearRect(0, 0, width, height);
      for (const boid of boids) {
        boid.draw(ctx);
      }
    },

    destroy() {
      boids = [];
    },
  };

})();
