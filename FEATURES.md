# Particle Playground: features and engineering notes

Three real-time particle simulations running on one shared canvas engine I
wrote from scratch. Plain JavaScript and HTML5 Canvas. No framework, no build
step, no libraries, no image or audio files. Every pixel and every sound is
generated in the browser.

The point of this project isn't "look, particles". It's one small, clean
system that three very different simulations plug into, with each of those
simulations pushed until it's fast, correct and actually interesting to play
with.

---

## At a glance

- **3 simulations, 1 engine.** Flocking, slime mold and audio-reactive all
  plug into the same five-function interface. The shell never knows what a
  mode is simulating.
- **250,000 agents** in the slime mold sim, in plain JS on the CPU.
- **~15x less work** for flocking neighbor search, thanks to a spatial hash
  (the HUD shows the live numbers side by side).
- **A drum machine written in code.** The audio mode can synthesize its own
  124 BPM beat from oscillators and filtered noise, so it works for anyone,
  with no mic and no music file needed.
- **Beat detection and tempo estimation** from raw FFT data. On the demo beat
  it reads 124 to 125 BPM against a true 124.
- **Every setup is a link.** Slider values live in the URL, so any
  configuration can be shared or bookmarked.
- **Mouse, pen and touch** all interact with every mode through one input path.
- **Measured, not guessed.** A live readout shows FPS, frame cost and each
  mode's own internals (pair checks, sim vs render time, FFT resolution).

---

## Slime mold (Physarum)

Based on Jeff Jones' 2010 model of *Physarum polycephalum*, the slime mold
that famously recreated the Tokyo rail network.

Each agent does one thing: sniff the scent trail at three points ahead of it
(left, center, right), turn toward the strongest, step forward, and leave
scent behind. Nobody draws the network. It emerges from that one rule
feeding back on itself.

**What makes it work (and fast):**

- **Trail map as a Float32Array, not canvas pixels.** Agents read and write
  plain memory. The only canvas call per frame is one `putImageData` and one
  scaled `drawImage`.
- **Zero trig in the hot loop.** Headings are stored as unit vectors and
  turned with precomputed sine and cosine. The first version called
  `Math.cos`/`Math.sin` 8 times per agent per step. Removing that took a step
  from **~30 ms to ~6.5 ms at 80,000 agents**, about 4.5x faster.
- **Separable blur.** Diffusion is a 3x3 box blur split into a horizontal
  and a vertical pass (6 reads per pixel instead of 9), with decay folded into
  the same pass and wrap-around edges so the world is a torus.
- **Denormal protection.** Values that decay toward zero get flushed to
  exactly 0. Otherwise they slide into denormal floats, which x86 CPUs handle
  10 to 100 times slower, and the frame rate quietly falls apart after a
  minute.
- **Trail saturation.** My first version collapsed the whole colony into one
  thick tube: the busiest strand kept getting stronger until it swallowed
  every other one. Capping each cell's scent keeps weaker branches in the
  game, and that's what turns a tube into a network. I found this by running
  the sim headless for 900 steps per config and comparing screenshots.
- **Fixed 60 Hz timestep** with an accumulator, so the pattern evolves the
  same on a 60, 120 or 144 Hz screen.
- **Resolution budget.** The trail map is capped at about 480k cells and
  upscaled, so a 4K monitor doesn't quadruple the cost.

**Multi-species (the fun part):** up to three species, each with its own
scent channel and color. An agent is pulled toward its own species' trail and
pushed away from (or pulled toward) the others by a single slider. Rival
species form braided, interleaving highways that never share a lane.

**Interaction:** click and drag to paint scent, and the colony reroutes to
reach it. There are four presets (Network, Big cells, Rivals, Colony), each
tuned from headless test runs, plus four starting shapes and full control over
sensor angle, sensor distance, turn speed, deposit, decay and diffusion.

**Measured** (dev laptop, CPU only, 917x523 trail map):

| Setup | Sim step |
| --- | --- |
| 80,000 agents, 1 species | ~6.5 ms |
| 250,000 agents, 1 species | ~15 ms |
| 80,000 agents, 3 species | ~20 ms (three blur passes) |

---

## Boids (flocking)

Craig Reynolds' three rules: don't crowd your neighbors, match their heading,
stay close to them. There's no leader and no global plan. Flocks form, split
and merge on their own.

**Engineering:**

- **Spatial hash for neighbor search.** The screen is split into cells the
  size of the perception radius, rebuilt every frame with a counting sort.
  Each boid only checks the 3x3 block of cells around it. At 600 boids that's
  **~24,000 pair checks instead of 359,400**. At 3,000 boids it's ~390,000
  instead of 9 million, and the whole frame still costs ~4.4 ms.
- **The world is a torus, including the math.** Boids wrap around the edges,
  and neighbor distances wrap too (shortest way around), so a flock crossing
  an edge stays one flock instead of snapping apart. Cohesion averages
  relative offsets, not absolute positions, which is the detail that makes
  wrapping correct.
- **Double-buffered velocities.** Every boid steers from the same snapshot,
  so update order can't bias the flock.
- **Struct-of-arrays in typed arrays**, preallocated once. No objects are
  created per frame, so there are no garbage-collection hitches.
- **One draw call for the whole flock.** Every triangle goes into one path,
  rotated with the velocity vector directly, with no per-boid
  save/rotate/restore.
- **Changing the count grows or shrinks the flock in place**, so the boids
  already flying aren't reset.
- **Predator interaction:** hover (or drag a finger) and the flock scatters
  around you.

---

## Audio reactive

Live frequency analysis driving three rings of particles, each ring a
different band with a different behavior:

| Band | Range | Behavior |
| --- | --- | --- |
| Bass | 20 to 160 Hz | Inner ring snaps outward on every kick |
| Mid | 160 Hz to 2 kHz | Middle ring spins faster and glows brighter |
| Treble | 2 to 12 kHz | Outer ring jitters |

**Three sources:** mic, a local audio file (button or drag-and-drop), or
**Demo beat**: a 4-bar groove (kick, snare, hats, filtered sawtooth bass,
chord stabs) synthesized live in Web Audio. It's scheduled against the audio
clock with a look-ahead timer (the "tale of two clocks" pattern), so the
timing stays tight even though JavaScript timers are sloppy.

**Beat detection:** energy based. Current bass energy is compared against
the average of the last second, and a beat fires when it spikes past
`average x threshold`, with a noise floor and a refractory window so one kick
counts as one beat. The threshold is drawn live on the bass meter, so you can
see the detector work. Each beat launches a shockwave that kicks particles
outward as its wavefront passes them.

**Tempo estimate:** median of recent beat gaps (robust to missed or extra
beats), then averaged with every gap near the median to cancel out
frame-timing jitter. Reads 124 to 125 BPM on the 124 BPM demo.

**Why the bass ring pumps on the jump, not the level:** kick-heavy music
keeps bass high the whole time, so pumping on raw level just makes the ring
look big. Pumping on "how far above its recent average" makes every kick land
as a snap.

**Browser rules handled properly:**

- Audio only starts from a click (browsers block autoplay), and the panel
  says so in plain English.
- The mic is never played back through the speakers, which would cause
  feedback.
- Mic permission failures get specific messages: blocked, no mic found, mic
  busy in another app, or page not secure.
- Switching modes stops mic tracks, the file, the synth scheduler, and closes
  the AudioContext, so the browser's recording indicator turns off right away.
- A mic prompt that resolves after you've already moved on is caught and
  cleaned up rather than silently leaking a live mic.
- Audio is analyzed locally in the page. Nothing is recorded or sent anywhere.

Visual extras: a log-scaled circular spectrum, an oscilloscope trace of the
raw waveform, and phosphor-style persistence that fades toward transparent
(not toward black), so the graticule behind the canvas stays visible.

---

## The shell

- **Plug-in architecture.** Each mode implements
  `init / resize / update / draw / destroy`, plus a label, a short
  "How this works" explainer, and optional `stats()` and `pointer()` hooks. The shell builds
  the mode buttons, keyboard shortcuts, HUD rows and URL parameters from that.
  Adding a mode is one file, one script tag and one entry in `MODE_ORDER`.
- **Shared UI kit** (`js/ui.js`): sliders, selects, buttons, level meters and
  a palette. Every mode's controls look and behave the same.
- **Colors come from CSS.** The canvas can't see CSS variables, so the palette
  reads them at runtime. Retheming the page recolors the simulations too.
- **Shareable state.** Controls are tagged with a key, and the shell reads and
  writes them generically, so it never touches a mode's internals. Links only
  include values that differ from the defaults.
- **Live readout (HUD):** FPS, frame cost of update and draw, and whatever
  each mode reports. It's throttled to 4 updates a second so the readout
  itself costs nothing.
- **Keyboard:** `1` `2` `3` modes, `Space` pause, `R` reset, `H` readout,
  `C` controls.
- **HiDPI aware:** the canvas is sized by `devicePixelRatio`, so it's sharp
  on retina screens.
- **Frame-rate independent:** delta time is clamped, so switching tabs
  doesn't make things jump, and smoothing uses `1 - (1 - k)^(dt * 60)`, not a
  per-frame constant.

---

## Design

A lab instrument, not a retro filter. A dark scope-face graticule, corner
brackets, hairline borders, a monospace readout type (IBM Plex Mono), three
restrained signal colors (teal, amber, rose), and small technical readouts
everywhere. It's meant to read as "someone built a real instrument". It's
also going to sit inside a CRT prop on my portfolio, so faking a CRT here
would double up on the framing.

CSS handles what CSS can (layout, glow, transitions, the grid). JS only does
what needs JS (the canvas).

## Accessibility and mobile

- All controls are real `<label>`ed inputs and buttons, keyboard operable,
  with visible focus styles.
- Mode buttons expose `aria-pressed` and their keyboard shortcuts. The level
  meters are exposed as `role="meter"`.
- Spacebar on a focused control does what that control does. It only pauses
  the sim when nothing's focused.
- `prefers-reduced-motion` turns off UI animation.
- Pointer Events give one input path for mouse, pen and touch. The canvas
  opts out of touch scrolling so dragging works on phones.
- On phones the panel starts collapsed, the layout stacks, and boid density
  scales to the screen size.

---

## How it was tested

There's no framework, so I built my own harness: a scratch page that runs any
mode for hundreds of fixed timesteps and then screenshots it in headless
Edge. That's how the slime presets got tuned, how the tube collapse and the
trig bottleneck got found, and where the timing numbers above come from. The
audio mode was tested in real time by letting headless Edge play the demo
beat and checking the detected beats and tempo against the known 124 BPM.
