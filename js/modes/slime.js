/* ---------------------------------------------------------------
   Mode: Slime Mold  —  STUB

   TODO (next session):
   Physarum-style agent simulation. Each agent moves forward, senses
   a "trail map" at three points ahead (left/center/right), and
   steers toward whichever reads strongest. Agents deposit onto the
   trail map as they move; the map fades/diffuses each frame.

   Performance note from planning: don't touch canvas pixels
   directly per-agent. Keep the trail map as an off-screen buffer
   (a second canvas or a Float32Array), draw agents as single
   pixels/dots onto it, and fade it each frame with a low-alpha
   fillRect instead of per-pixel decay — that's what keeps this
   readable at a large agent count instead of chugging.

   This stub only proves the mode-switcher plumbing works end to
   end. It implements the same five-hook interface as boids.js so
   swapping in the real simulation later is a drop-in replacement.
------------------------------------------------------------------ */

(function () {

  let width = 0;
  let height = 0;
  let t = 0;
  let dots = [];

  function buildControls(controlsEl) {
    const note = document.createElement('div');
    note.className = 'control-note';
    note.textContent = 'Not built yet — Physarum-style agents with a fading trail map. Placeholder animation shown.';
    controlsEl.appendChild(note);
  }

  window.PARTICLE_MODES = window.PARTICLE_MODES || {};
  window.PARTICLE_MODES.slime = {
    init(ctx, w, h, controlsEl) {
      width = w;
      height = h;
      t = 0;
      dots = Array.from({ length: 40 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        phase: Math.random() * Math.PI * 2,
      }));
      buildControls(controlsEl);
    },

    resize(w, h) {
      width = w;
      height = h;
    },

    update(dt) {
      t += dt;
    },

    draw(ctx) {
      ctx.fillStyle = 'rgba(10, 10, 13, 0.15)';
      ctx.fillRect(0, 0, width, height);

      for (const d of dots) {
        const x = d.x + Math.sin(t * 0.4 + d.phase) * 30;
        const y = d.y + Math.cos(t * 0.3 + d.phase) * 30;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(94, 234, 212, 0.5)';
        ctx.fill();
      }
    },

    destroy() {
      dots = [];
    },
  };

})();
