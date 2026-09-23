/* ---------------------------------------------------------------
   Particle Playground — shared UI + palette
   Loaded before the mode files. Everything a mode needs to build
   its control panel lives here, so every mode's controls look and
   behave the same (and main.js can find them generically for the
   URL hash, via each control's data-key).

   Palette: canvas drawing can't see CSS, so colors are read from
   the CSS custom properties at runtime instead of being hardcoded
   in each mode. Retheme by editing the tokens in css/style.css;
   the canvas follows.
------------------------------------------------------------------ */

(function () {

  // ---------------- Palette ----------------

  const PALETTE_TOKENS = ['bg', 'text', 'text-dim', 'accent', 'accent-2', 'accent-3', 'grid'];

  // Parses #rgb, #rrggbb, rgb() and rgba() into [r, g, b].
  function parseColor(str) {
    str = str.trim();
    if (str[0] === '#') {
      let hex = str.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      const n = parseInt(hex.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = str.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2]] : [255, 255, 255];
  }

  const palette = {
    colors: {},

    // Re-reads every token from :root. Called on every mode init, so a
    // theme change in CSS is picked up without a reload of the modes.
    refresh() {
      const style = getComputedStyle(document.documentElement);
      for (const token of PALETTE_TOKENS) {
        const raw = style.getPropertyValue('--' + token);
        if (raw) this.colors[token] = parseColor(raw);
      }
    },

    rgb(name) {
      return this.colors[name] || [255, 255, 255];
    },

    rgba(name, alpha) {
      const [r, g, b] = this.rgb(name);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    // The three signal colors, in order. Modes that need "one color
    // per thing" (species, frequency bands) index into this.
    signals() {
      return ['accent', 'accent-2', 'accent-3'];
    },
  };

  palette.refresh();

  // ---------------- Control builders ----------------

  let uid = 0;

  function decimalsFor(step) {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
  }

  // Labeled range input with a live value readout.
  //   key       used for the URL hash (#mode&key=value), so keep it short
  //   format    optional (value) => string for the readout
  //   onChange  called with the parsed number on every input
  function makeSlider({ key, label, min, max, step, value, format, onChange }) {
    const id = 'ctl-' + key + '-' + (++uid);
    const decimals = decimalsFor(step);
    const show = format || ((v) => v.toFixed(decimals));

    const row = document.createElement('div');
    row.className = 'control-row';

    const labelEl = document.createElement('label');
    labelEl.htmlFor = id;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'value';
    valueSpan.textContent = show(value);
    labelEl.append(nameSpan, valueSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.dataset.key = key;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valueSpan.textContent = show(v);
      onChange(v);
    });

    row.append(labelEl, input);
    return row;
  }

  // Labeled <select>. options: [{ value, label }]
  function makeSelect({ key, label, options, value, onChange }) {
    const id = 'ctl-' + key + '-' + (++uid);

    const row = document.createElement('div');
    row.className = 'control-row';

    const labelEl = document.createElement('label');
    labelEl.htmlFor = id;
    labelEl.textContent = label;

    const select = document.createElement('select');
    select.id = id;
    select.dataset.key = key;
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      select.appendChild(o);
    }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));

    row.append(labelEl, select);
    return row;
  }

  function makeButton(label, onClick, { title, className } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctl-btn' + (className ? ' ' + className : '');
    btn.textContent = label;
    if (title) btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // A horizontal row of buttons.
  function makeButtonRow(buttons) {
    const row = document.createElement('div');
    row.className = 'button-row';
    row.append(...buttons);
    return row;
  }

  // Small uppercase divider label inside the panel.
  function makeSection(title) {
    const el = document.createElement('div');
    el.className = 'control-section';
    el.textContent = title;
    return el;
  }

  function makeNote(text) {
    const el = document.createElement('div');
    el.className = 'control-note';
    el.textContent = text;
    return el;
  }

  // Horizontal level meter. Returns { el, set(value0to1), setMarker(value0to1) }.
  function makeMeter(label, colorName) {
    const row = document.createElement('div');
    row.className = 'meter-row';

    const name = document.createElement('span');
    name.className = 'meter-label';
    name.textContent = label;

    const track = document.createElement('div');
    track.className = 'meter-track';
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-label', label + ' level');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');

    const fill = document.createElement('div');
    fill.className = 'meter-fill';
    fill.style.background = `var(--${colorName})`;

    const marker = document.createElement('div');
    marker.className = 'meter-marker';
    marker.hidden = true;

    track.append(fill, marker);
    row.append(name, track);

    let lastPct = -1;
    return {
      el: row,
      set(v) {
        const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
        if (pct === lastPct) return; // skip DOM writes when nothing changed
        lastPct = pct;
        fill.style.transform = `scaleX(${pct / 100})`;
        track.setAttribute('aria-valuenow', pct);
      },
      setMarker(v) {
        marker.hidden = v == null;
        if (v != null) marker.style.left = Math.max(0, Math.min(1, v)) * 100 + '%';
      },
    };
  }

  // 12345 -> "12,345"
  function formatCount(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  window.PARTICLE_UI = {
    palette,
    makeSlider,
    makeSelect,
    makeButton,
    makeButtonRow,
    makeSection,
    makeNote,
    makeMeter,
    formatCount,
  };

})();
