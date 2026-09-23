/* ---------------------------------------------------------------
   Mode: Audio Reactive  —  STUB

   TODO (next session):
   Web Audio API AnalyserNode on either mic input (getUserMedia) or
   a loaded audio file. Use getByteFrequencyData() each frame to
   drive particle behavior — e.g. bass energy controls an outward
   pulse/explosion force, treble controls color or jitter.

   Needs a play/upload control and a mic-permission prompt; both
   should be built into this file's buildControls() when it's for
   real, not left to main.js.

   This stub only proves the mode-switcher plumbing works end to
   end. It implements the same five-hook interface as boids.js so
   swapping in the real simulation later is a drop-in replacement.
------------------------------------------------------------------ */

(function () {

  let width = 0;
  let height = 0;
  let t = 0;

  function buildControls(controlsEl) {
    const note = document.createElement('div');
    note.className = 'control-note';
    note.textContent = 'Not built yet — will react to mic or a loaded track via Web Audio\'s AnalyserNode. Placeholder pulse shown.';
    controlsEl.appendChild(note);
  }

  window.PARTICLE_MODES = window.PARTICLE_MODES || {};
  window.PARTICLE_MODES.audio = {
    init(ctx, w, h, controlsEl) {
      width = w;
      height = h;
      t = 0;
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
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const pulse = (Math.sin(t * 2) + 1) / 2; // fake "bass" pulse until real audio is wired in

      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const r = 60 + pulse * 80;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(94, 234, 212, ${0.4 + pulse * 0.5})`;
        ctx.fill();
      }
    },

    destroy() {},
  };

})();
