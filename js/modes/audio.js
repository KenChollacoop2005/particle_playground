// Mode: Audio Reactive

(function () {
  const UI = window.PARTICLE_UI;

  const DEFAULTS = {
    particles: 2400,
    sensitivity: 1.0,
    threshold: 1.35,
    trails: 0.7,
  };

  const MAX_PARTICLES = 6000;

  const BANDS = [
    { key: 'bass',   label: 'BASS', lo: 20,   hi: 160,   gain: 1.0, color: 'accent-2', share: 0.3, rMin: 0.10, rMax: 0.28 },
    { key: 'mid',    label: 'MID',  lo: 160,  hi: 2000,  gain: 1.5, color: 'accent',   share: 0.4, rMin: 0.33, rMax: 0.56 },
    { key: 'treble', label: 'TREB', lo: 2000, hi: 12000, gain: 2.6, color: 'accent-3', share: 0.3, rMin: 0.62, rMax: 0.86 },
  ];

  const SPRING = 40;
  const DAMPING = 7;
  const JITTER = 9000;
  const BEAT_WINDOW = 1.0;
  const BEAT_FLOOR = 0.12;
  const BEAT_REFRACTORY = 0.24;
  const SPECTRUM_BARS = 96;

  let params = { ...DEFAULTS };
  let width = 0, height = 0;
  let time = 0;
  let lastDt = 1 / 60;
  let alive = false;

  // ---- Particles ----
  let count = 0;
  const ring = new Uint8Array(MAX_PARTICLES);
  const homeR = new Float32Array(MAX_PARTICLES);
  const homeA = new Float32Array(MAX_PARTICLES);
  const px = new Float32Array(MAX_PARTICLES);
  const py = new Float32Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES);
  const vy = new Float32Array(MAX_PARTICLES);
  const ringRot = [0, 0, 0];

  let shockwaves = [];

  // ---- Audio graph ----
  let audioCtx = null;
  let analyser = null;
  let monitor = null;
  let source = null;
  let sourceKind = 'none';
  let micStream = null;
  let mediaEl = null;
  let objectUrl = null;
  let demo = null;
  let freq = null;
  let wave = null;
  let requestToken = 0;

  // ---- Analysis state ----
  const levels = [0, 0, 0];
  const rawLevels = [0, 0, 0];
  const bassHistory = [];
  let bassMean = 0;
  let punch = 0;
  let beatThresholdLevel = 0;
  let lastBeat = -1;
  let beatCount = 0;
  const beatTimes = [];
  let bpm = 0;

  // ---- UI refs ----
  let statusEl = null;
  let meters = [];
  let beatLed = null;
  let bpmEl = null;
  let sourceButtons = {};
  let fileInput = null;

  // ---------------- Particles ----------------

  function layoutParticles(n) {
    count = n;
    const R = radiusScale();
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const b = u < BANDS[0].share ? 0 : u < BANDS[0].share + BANDS[1].share ? 1 : 2;
      const band = BANDS[b];
      ring[i] = b;
      homeR[i] = band.rMin + Math.random() * (band.rMax - band.rMin);
      homeA[i] = Math.random() * Math.PI * 2;
      px[i] = width / 2 + Math.cos(homeA[i]) * homeR[i] * R;
      py[i] = height / 2 + Math.sin(homeA[i]) * homeR[i] * R;
      vx[i] = 0;
      vy[i] = 0;
    }
  }

  function radiusScale() {
    return Math.min(width, height) * 0.44;
  }

  function fireShockwave(x, y, strength) {
    shockwaves.push({ x, y, r: 0, prevR: 0, strength, life: 1 });
    if (shockwaves.length > 8) shockwaves.shift();
  }

  function stepParticles(dt) {
    const cx = width / 2, cy = height / 2;
    const R = radiusScale();
    const [bass, mid, treble] = levels;

    ringRot[0] += (0.05 + bass * 0.15) * dt;
    ringRot[1] -= (0.08 + mid * 1.4) * dt;
    ringRot[2] += (0.12 + treble * 0.3) * dt;

    const pump = [1 + bass * 0.15 + punch * 0.6, 1 + mid * 0.18, 1 + treble * 0.1];
    const jitter = [treble * JITTER * 0.1, treble * JITTER * 0.2, treble * JITTER];

    const maxR = Math.hypot(width, height) * 0.55;
    for (const w of shockwaves) {
      w.prevR = w.r;
      w.r += 1100 * dt;
      w.life = 1 - w.r / maxR;
    }
    shockwaves = shockwaves.filter((w) => w.life > 0);

    for (let i = 0; i < count; i++) {
      const b = ring[i];
      const a = homeA[i] + ringRot[b];
      const r = homeR[i] * R * pump[b];
      const tx = cx + Math.cos(a) * r;
      const ty = cy + Math.sin(a) * r;

      let ax = (tx - px[i]) * SPRING - vx[i] * DAMPING;
      let ay = (ty - py[i]) * SPRING - vy[i] * DAMPING;

      const j = jitter[b];
      if (j > 0) {
        ax += (Math.random() - 0.5) * j;
        ay += (Math.random() - 0.5) * j;
      }

      vx[i] += ax * dt;
      vy[i] += ay * dt;

      for (const w of shockwaves) {
        const dx = px[i] - w.x;
        const dy = py[i] - w.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d >= w.prevR && d < w.r) {
          const kick = w.strength * w.life;
          vx[i] += (dx / d) * kick;
          vy[i] += (dy / d) * kick;
        }
      }

      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
    }
  }

  // ---------------- Analysis ----------------

  function analyse(dt) {
    const smoothing = (k) => 1 - Math.pow(1 - k, dt * 60);

    if (sourceKind === 'none' || !analyser) {
      const idle = [0.12 + 0.08 * Math.sin(time * 1.1), 0.1 + 0.05 * Math.sin(time * 0.7 + 1), 0.04];
      for (let b = 0; b < 3; b++) {
        rawLevels[b] = 0;
        levels[b] += (idle[b] - levels[b]) * smoothing(0.05);
      }
      beatThresholdLevel = 0;
      punch *= Math.pow(0.85, dt * 60);
      return;
    }

    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    const binHz = audioCtx.sampleRate / analyser.fftSize;

    for (let b = 0; b < 3; b++) {
      const band = BANDS[b];
      const lo = Math.max(1, Math.round(band.lo / binHz));
      const hi = Math.min(freq.length - 1, Math.round(band.hi / binHz));
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += freq[k];
      const avg = sum / ((hi - lo + 1) * 255);
      const v = Math.min(1, avg * band.gain * params.sensitivity);
      rawLevels[b] = v;
      levels[b] += (v - levels[b]) * smoothing(v > levels[b] ? 0.6 : 0.12);
    }

    detectBeat(rawLevels[0]);

    const jump = Math.min(1, Math.max(0, (rawLevels[0] - bassMean) * 4));
    punch = Math.max(jump, punch * Math.pow(0.85, dt * 60));
  }

  function detectBeat(bass) {
    bassHistory.push({ t: time, v: bass });
    while (bassHistory.length && bassHistory[0].t < time - BEAT_WINDOW) bassHistory.shift();

    let mean = 0;
    for (const h of bassHistory) mean += h.v;
    mean /= bassHistory.length;
    bassMean = mean;

    beatThresholdLevel = Math.min(1, mean * params.threshold);

    const isBeat =
      bass > beatThresholdLevel &&
      bass > BEAT_FLOOR &&
      time - lastBeat > BEAT_REFRACTORY;

    if (!isBeat) return;

    lastBeat = time;
    beatCount++;
    fireShockwave(width / 2, height / 2, 200 + 300 * Math.min(1, (bass - mean) * 4));
    if (beatLed) {
      beatLed.classList.add('on');
      setTimeout(() => beatLed && beatLed.classList.remove('on'), 90);
    }

    beatTimes.push(time);
    if (beatTimes.length > 16) beatTimes.shift();
    if (beatTimes.length >= 5) {
      const gaps = [];
      for (let k = 1; k < beatTimes.length; k++) gaps.push(beatTimes[k] - beatTimes[k - 1]);
      gaps.sort((a, b) => a - b);
      const median = gaps[gaps.length >> 1];
      let sum = 0, n = 0;
      for (const g of gaps) {
        if (Math.abs(g - median) < median * 0.15) { sum += g; n++; }
      }
      let estimate = 60 / (sum / n);
      while (estimate < 80) estimate *= 2;
      while (estimate > 180) estimate /= 2;
      bpm = estimate;
    }
  }

  function resetAnalysis() {
    bassHistory.length = 0;
    bassMean = 0;
    punch = 0;
    beatTimes.length = 0;
    bpm = 0;
    beatCount = 0;
    lastBeat = -1;
  }

  // ---------------- Audio sources ----------------

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('This browser does not support Web Audio.');
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.5;
      monitor = audioCtx.createGain();
      analyser.connect(monitor);
      monitor.connect(audioCtx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function stopSource() {
    requestToken++;
    if (source) {
      source.disconnect();
      source = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (mediaEl) {
      mediaEl.pause();
      mediaEl.removeAttribute('src');
      mediaEl.load();
      mediaEl = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    if (demo) {
      demo.stop();
      demo = null;
    }
    sourceKind = 'none';
    resetAnalysis();
    markSource('none');
  }

  async function startMic() {
    try { ensureAudio(); } catch (err) { setStatus(err.message, true); return; }
    stopSource();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('The mic only works on a secure page (https or localhost).', true);
      return;
    }

    setStatus('Waiting for mic permission...');
    const token = requestToken;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (!alive || token !== requestToken) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      micStream = stream;
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      monitor.gain.value = 0;
      sourceKind = 'mic';
      markSource('mic');
      setStatus('Listening. Audio is analyzed in the page and never leaves it.');
    } catch (err) {
      if (token !== requestToken) return;
      const messages = {
        NotAllowedError: 'Mic permission was blocked. You can allow it from the address bar and try again.',
        SecurityError: 'Mic permission was blocked by the page\'s security settings.',
        NotFoundError: 'No microphone found.',
        NotReadableError: 'The mic is busy in another app.',
      };
      setStatus(messages[err.name] || 'Could not open the mic: ' + err.message, true);
    }
  }

  function startFile(file) {
    if (!file) return;
    try { ensureAudio(); } catch (err) { setStatus(err.message, true); return; }
    stopSource();

    objectUrl = URL.createObjectURL(file);
    const el = new Audio();
    mediaEl = el;
    el.src = objectUrl;
    el.loop = true;
    el.addEventListener('error', () => {
      if (el === mediaEl) setStatus('Could not play that file. Try an mp3, wav, ogg or m4a.', true);
    });

    source = audioCtx.createMediaElementSource(el);
    source.connect(analyser);
    monitor.gain.value = 1;
    sourceKind = 'file';
    markSource('file');
    setStatus('Loading ' + file.name + '...');

    el.play()
      .then(() => { if (el === mediaEl) setStatus('Playing ' + file.name + ' (looped).'); })
      .catch(() => { if (el === mediaEl) setStatus('Could not play that file. Try an mp3, wav, ogg or m4a.', true); });
  }

  function startDemo() {
    try { ensureAudio(); } catch (err) { setStatus(err.message, true); return; }
    stopSource();
    demo = createDemoBeat(audioCtx, analyser);
    monitor.gain.value = 1;
    sourceKind = 'demo';
    markSource('demo');
    setStatus('Demo beat, synthesized live in Web Audio. No audio files involved.');
  }

  function createDemoBeat(ac, destination) {
    const TEMPO = 124;
    const SIXTEENTH = 60 / TEMPO / 4;
    const LOOKAHEAD = 0.12;

    const out = ac.createGain();
    out.gain.value = 0.55;
    out.connect(destination);

    const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const ROOTS = [33, 29, 36, 31];
    const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1];
    const BASS = [1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0];

    function env(gainNode, t, peak, decay) {
      gainNode.gain.setValueAtTime(peak, t);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    }

    function kick(t) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      env(g, t, 1, 0.38);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.4);
    }

    function noiseHit(t, type, freqHz, peak, decay) {
      const s = ac.createBufferSource();
      s.buffer = noise;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freqHz;
      const g = ac.createGain();
      env(g, t, peak, decay);
      s.connect(f).connect(g).connect(out);
      s.start(t);
      s.stop(t + decay + 0.02);
    }

    function bass(t, midi) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiHz(midi);
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 6;
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(160, t + 0.16);
      const g = ac.createGain();
      env(g, t, 0.32, 0.2);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.22);
    }

    function stab(t, notes) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2200;
      const g = ac.createGain();
      env(g, t, 0.09, 0.28);
      f.connect(g).connect(out);
      for (const m of notes) {
        for (const detune of [-8, 8]) {
          const o = ac.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = midiHz(m);
          o.detune.value = detune;
          o.connect(f);
          o.start(t);
          o.stop(t + 0.3);
        }
      }
    }

    let step = 0;
    let nextTime = ac.currentTime + 0.06;

    function schedule(i, t) {
      const s = i % 16;
      const bar = Math.floor(i / 16) % 4;
      if (KICK[s]) kick(t);
      if (s === 4 || s === 12) {
        noiseHit(t, 'bandpass', 1800, 0.5, 0.18);
      }
      if (s % 2 === 0) noiseHit(t, 'highpass', 7500, s % 4 === 2 ? 0.22 : 0.1, s % 4 === 2 ? 0.12 : 0.04);
      else if (bar === 3 && s > 11) noiseHit(t, 'highpass', 9000, 0.12, 0.03);
      if (BASS[s]) bass(t, ROOTS[bar] + (s === 10 ? 12 : 0));
      if (s === 2 || s === 10) stab(t, CHORDS[bar]);
    }

    const timer = setInterval(() => {
      while (nextTime < ac.currentTime + LOOKAHEAD) {
        schedule(step, nextTime);
        nextTime += SIXTEENTH;
        step = (step + 1) % 64;
      }
    }, 25);

    return {
      stop() {
        clearInterval(timer);
        const t = ac.currentTime;
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + 0.08);
        setTimeout(() => out.disconnect(), 150);
      },
    };
  }

  // ---------------- Drag and drop ----------------

  function onDragOver(e) {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
  }

  function onDrop(e) {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    if (file.type && !file.type.startsWith('audio/')) {
      setStatus('That doesn\'t look like an audio file.', true);
      return;
    }
    startFile(file);
  }

  // ---------------- Controls ----------------

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
  }

  function markSource(kind) {
    for (const [k, btn] of Object.entries(sourceButtons)) {
      btn.classList.toggle('active', k === kind);
      btn.setAttribute('aria-pressed', String(k === kind));
    }
  }

  function buildControls(controlsEl) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      startFile(fileInput.files[0]);
      fileInput.value = '';
    });

    sourceButtons = {
      mic: UI.makeButton('Mic', startMic, { title: 'Use your microphone' }),
      file: UI.makeButton('File', () => fileInput.click(), { title: 'Load a local audio file' }),
      demo: UI.makeButton('Demo beat', startDemo, { title: 'Play a beat synthesized in the browser' }),
    };
    for (const btn of Object.values(sourceButtons)) btn.setAttribute('aria-pressed', 'false');

    statusEl = UI.makeNote('No input yet. Pick a source to start. Every option needs one click first, browsers don\'t allow sound to start on its own.');
    statusEl.classList.add('status');
    statusEl.setAttribute('role', 'status');

    meters = BANDS.map((b) => UI.makeMeter(b.label, b.color));

    const beatLine = document.createElement('div');
    beatLine.className = 'beat-line';
    beatLed = document.createElement('span');
    beatLed.className = 'beat-led';
    const beatLabel = document.createElement('span');
    beatLabel.textContent = 'BEAT';
    bpmEl = document.createElement('span');
    bpmEl.className = 'beat-bpm';
    bpmEl.textContent = '-- BPM';
    beatLine.append(beatLed, beatLabel, bpmEl);

    controlsEl.append(
      UI.makeSection('Source'),
      UI.makeButtonRow(Object.values(sourceButtons)),
      UI.makeButtonRow([UI.makeButton('Stop', () => { stopSource(); setStatus('Stopped.'); })]),
      statusEl,
      fileInput,

      UI.makeSection('Analysis'),
      ...meters.map((m) => m.el),
      beatLine,
      UI.makeSlider({
        key: 'sens', label: 'Input sensitivity', min: 0.3, max: 3, step: 0.1, value: params.sensitivity,
        format: (v) => '×' + v.toFixed(1),
        onChange: (v) => { params.sensitivity = v; },
      }),
      UI.makeSlider({
        key: 'thresh', label: 'Beat threshold', min: 1.05, max: 2, step: 0.05, value: params.threshold,
        format: (v) => '×' + v.toFixed(2) + ' avg',
        onChange: (v) => { params.threshold = v; },
      }),

      UI.makeSection('Display'),
      UI.makeSlider({
        key: 'n', label: 'Particles', min: 300, max: MAX_PARTICLES, step: 100, value: params.particles,
        format: UI.formatCount,
        onChange: (v) => { params.particles = v; layoutParticles(v); },
      }),
      UI.makeSlider({
        key: 'trail', label: 'Persistence', min: 0, max: 0.95, step: 0.05, value: params.trails,
        onChange: (v) => { params.trails = v; },
      }),
      UI.makeNote('The white tick on the bass meter is the live beat threshold. Click anywhere to fire your own shockwave, or drop an audio file onto the page.'),
    );
  }

  function updateMeters() {
    for (let b = 0; b < 3; b++) meters[b].set(levels[b]);
    meters[0].setMarker(sourceKind === 'none' ? null : beatThresholdLevel);
    const fresh = time - lastBeat < 3;
    const text = bpm && fresh ? Math.round(bpm) + ' BPM' : '-- BPM';
    if (bpmEl.textContent !== text) bpmEl.textContent = text;
  }

  // ---------------- Drawing ----------------

  function drawSpectrum(ctx, cx, cy, R) {
    const binHz = audioCtx.sampleRate / analyser.fftSize;
    const base = R * 0.95;
    const logLo = Math.log(40), logHi = Math.log(14000);

    ctx.beginPath();
    for (let k = 0; k < SPECTRUM_BARS; k++) {
      const hz = Math.exp(logLo + (logHi - logLo) * (k / SPECTRUM_BARS));
      const bin = Math.min(freq.length - 1, Math.round(hz / binHz));
      const mag = (freq[bin] / 255) * params.sensitivity;
      const len = 2 + Math.min(1, mag) * R * 0.12;
      const a = (k / SPECTRUM_BARS) * Math.PI * 2 - Math.PI / 2;
      const c = Math.cos(a), s = Math.sin(a);
      ctx.moveTo(cx + c * base, cy + s * base);
      ctx.lineTo(cx + c * (base + len), cy + s * (base + len));
    }
    ctx.strokeStyle = UI.palette.rgba('text', 0.22);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawScope(ctx, cy) {
    const n = wave.length;
    const amp = Math.min(90, height * 0.12);
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) {
      const x = (i / (n - 1)) * width;
      const y = cy + ((wave[i] - 128) / 128) * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = UI.palette.rgba('accent', 0.28);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---------------- Mode registration ----------------

  window.PARTICLE_MODES = window.PARTICLE_MODES || {};
  window.PARTICLE_MODES.audio = {
    label: 'Audio Reactive',
    blurb: [
      'The other two modes are about simple rules producing complex behavior. This one\'s a different kind of problem: taking a real, messy audio signal and turning it into motion in real time, which is closer to signal processing than simulation.',
      'The incoming audio gets split into three frequency bands, bass, mid, and treble, and each one drives its own ring of particles. A simple beat detector watches the bass band for spikes above its own recent average and fires a shockwave in time with the beat.',
      'Use your mic, drop in an audio file, or just hit play on the built-in demo beat, no setup needed either way. Click anywhere on the canvas to fire off your own shockwave.',
    ],

    init(ctx, w, h, controlsEl) {
      params = { ...DEFAULTS };
      width = w;
      height = h;
      time = 0;
      alive = true;
      shockwaves = [];
      levels.fill(0);
      resetAnalysis();
      layoutParticles(params.particles);
      buildControls(controlsEl);
      window.addEventListener('dragover', onDragOver);
      window.addEventListener('drop', onDrop);
    },

    resize(w, h) {
      width = w;
      height = h;
    },

    update(dt) {
      time += dt;
      lastDt = dt;
      analyse(dt);
      stepParticles(dt);
      updateMeters();
    },

    draw(ctx) {
      const cx = width / 2, cy = height / 2;
      const R = radiusScale();
      const pal = UI.palette;

      const fade = 1 - Math.pow(params.trails, lastDt * 60);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${fade})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      if (sourceKind !== 'none') {
        drawScope(ctx, cy);
        drawSpectrum(ctx, cx, cy, R);
      }

      ctx.lineWidth = 1.5;
      for (const w of shockwaves) {
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
        ctx.strokeStyle = pal.rgba('accent-2', 0.5 * w.life);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'lighter';
      for (let b = 0; b < 3; b++) {
        const size = b === 0 ? 2.2 : 1.6;
        const half = size / 2;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          if (ring[i] === b) ctx.rect(px[i] - half, py[i] - half, size, size);
        }
        ctx.fillStyle = pal.rgba(BANDS[b].color, 0.3 + 0.7 * levels[b]);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      ctx.beginPath();
      ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
      ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
      ctx.strokeStyle = pal.rgba('text-dim', 0.6);
      ctx.lineWidth = 1;
      ctx.stroke();
    },

    destroy() {
      alive = false;
      stopSource();
      if (audioCtx) {
        audioCtx.close();
        audioCtx = analyser = monitor = null;
      }
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      statusEl = beatLed = bpmEl = fileInput = null;
      meters = [];
      sourceButtons = {};
      shockwaves = [];
      count = 0;
    },

    stats() {
      const names = { none: 'none', mic: 'mic', file: 'file', demo: 'demo beat' };
      const rows = [
        ['PARTICLES', UI.formatCount(count)],
        ['SOURCE', names[sourceKind]],
      ];
      if (analyser) {
        rows.push(['FFT', `${analyser.fftSize} pt, ${(audioCtx.sampleRate / analyser.fftSize).toFixed(1)} Hz/bin`]);
      }
      rows.push(['BEATS', UI.formatCount(beatCount)]);
      return rows;
    },

    pointer(e) {
      if (e.type === 'down') fireShockwave(e.x, e.y, 520);
    },
  };

})();
