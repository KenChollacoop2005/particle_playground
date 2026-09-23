# Particle Playground

A small collection of particle-based simulations sharing one canvas shell and
control panel. 

Vanilla JS + HTML5 Canvas, no build step, no framework — deploys as a static
site (GitHub Pages).

## Modes

- **Boids** — Craig Reynolds flocking (separation / alignment / cohesion).
  Fully implemented.
- **Slime Mold** — Physarum-style agent simulation with a fading trail map.
  Stubbed; see `js/modes/slime.js` for the implementation plan.
- **Audio Reactive** — particles driven by mic or track input via the Web
  Audio API. Stubbed; see `js/modes/audio.js` for the implementation plan.

## Architecture

`js/main.js` owns the canvas, resize handling, and the animation loop. It
knows nothing about what a mode actually simulates — it only calls five
hooks that every mode in `js/modes/` implements:

```
init(ctx, width, height, controlsEl)   // setup + build this mode's own slider UI
resize(width, height)                  // react to a window resize
update(dt)                             // advance the simulation by dt seconds
draw(ctx)                              // render one frame
destroy()                              // teardown when switching away
```

Adding a new simulation means writing one file under `js/modes/`, registering
it on `window.PARTICLE_MODES`, and adding its key to `MODE_ORDER` in
`js/main.js`. Nothing else in the shell needs to change.

## Running locally

No build step — just serve the directory statically:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Status

- [x] Shell: canvas, resize, animation loop, mode switcher, control panel
- [x] Boids — implemented and tuned
- [ ] Slime mold — real Physarum simulation (stubbed)
- [ ] Audio reactive — real Web Audio analysis (stubbed)
- [ ] Visual pass to match K.C. Bulletin's design language before embedding
- [ ] Deploy to GitHub Pages
