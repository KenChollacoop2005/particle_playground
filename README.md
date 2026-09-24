# Particle Playground

A small collection of particle-based simulations sharing one canvas shell and
control panel.

Vanilla JS + HTML5 Canvas

See [FEATURES.md](FEATURES.md) for what's in here and the engineering behind it.

See [Live Site](https://kenchollacoop2005.github.io/particle_playground/#boids) to play around with it

## Modes

- **Boids**: Craig Reynolds flocking (separation / alignment / cohesion) with
  a spatial hash for neighbor lookup, toroidal wrapping, and a pointer
  "predator" the flock scatters from. Up to 3,000 boids.
- **Slime Mold**: Physarum transport-network simulation. Up to 250,000 agents
  sensing and depositing into a Float32Array trail map, up to 3 species that
  attract or repel each other, presets, and click-drag to paint scent.
- **Audio Reactive**: Web Audio analysis of mic, a local file (button or
  drag-and-drop), or a demo beat synthesized live in the browser. Bass, mid
  and treble drive three rings of particles, and energy-based beat detection
  fires shockwaves and estimates tempo.

## Controls

| Input | Action |
| --- | --- |
| `1` `2` `3` | Switch mode |
| `Space` | Pause / resume |
| `R` | Reset the current mode to defaults |
| `H` | Show / hide the performance readout |
| `C` | Show / hide the control panel |
| Mouse / touch | Boids: scare the flock. Slime: paint scent. Audio: fire a shockwave. |

Every slider change is written to the URL hash (`#slime&species=3&sa=45`), so
**Copy link** in the panel shares the exact setup you're looking at. Only
values that differ from the defaults go into the link.

## Architecture

`js/main.js` owns the canvas, resize handling, the animation loop, the HUD,
keyboard shortcuts, pointer input and the URL hash. It knows nothing about what
a mode actually simulates. It only calls five hooks that every mode in
`js/modes/` implements:

```
init(ctx, width, height, controlsEl)   // setup + build this mode's own controls
resize(width, height)                  // react to a window resize
update(dt)                             // advance the simulation by dt seconds
draw(ctx)                              // render one frame
destroy()                              // teardown when switching away
```

plus a `label`, a `blurb` (the "How this works" copy: why this technique, how
it works, how to interact), and two optional extras: `stats()` (rows
for the HUD) and `pointer(e)` (mouse, pen and touch in one event shape).

`js/ui.js` holds the shared control builders (sliders, selects, buttons,
meters) and the palette, which reads the CSS custom properties at runtime so
canvas drawing follows the same color tokens as the page.

Adding a new simulation means writing one file under `js/modes/`, adding its
`<script>` tag to `index.html`, and adding its key to `MODE_ORDER` in
`js/main.js`. The mode button, keyboard shortcut and URL hash all come from
that.

## Running locally

No build step, just serve the directory statically:

```
python -m http.server 8000
```

Then open `http://localhost:8000`. The mic needs `localhost` or https; file
and demo sources work anywhere.

## Embedding

If embedding into a site is required via `<iframe>` for example, the iframe needs
`allow="microphone"` for the mic source to work. Everything else works without
it.


