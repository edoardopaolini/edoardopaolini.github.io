/* Signal bench: a synthetic single-channel EEG trace, three real biquad filters and a small spectrum.
   Part 1 is the pure model (no DOM), exported on window.__benchModel for tests/bench.test.js, which runs
   it in a bare engine after assets/js/lab.js.
   Part 2 attaches to #bench and exits silently when the element is absent. It measures its container in
   fit() and stacks the trace over the spectrum when the figure is narrower than STACK_BELOW px.
   Plain ES5, no dependencies beyond window.Lab (assets/js/lab.js). Labels come from window.I18N.bench
   (_data/js/bench.yml) through Lab.strings; without the table the stage keys stand in for the labels. */
(function () {
  'use strict';

  var Lab = window.Lab;

  /* ======================================================================
     Part 1: model
     ====================================================================== */

  var FS = 250; /* simulated sample rate, Hz */

  /* Two layouts, chosen from the width of the figure container. The stacked one is for phones: the spectrum
     moves under the trace, gets fewer and wider bars and larger labels. Only what the canvases draw lives here;
     the grid that puts the spectrum under the trace is the .is-stacked rule of assets/css/modules/cells.css. */
  var STACK_BELOW = 700;
  var LAYOUTS = {
    wide: { stacked: false, bars: 12, labelPx: 11, lineWidth: 1.25 },
    stacked: { stacked: true, bars: 8, labelPx: 12, lineWidth: 1.4 }
  };
  function layoutFor(width) {
    return width < STACK_BELOW ? LAYOUTS.stacked : LAYOUTS.wide;
  }
  /* Seconds of trace on screen for a trace canvas of the given CSS width: at least PX_PER_SECOND per second,
     so a 10 Hz rhythm keeps a legible period on a phone, never more than WINDOW_MAX_S. */
  var PX_PER_SECOND = 150, WINDOW_MIN_S = 2, WINDOW_MAX_S = 4;
  function windowFor(width) {
    return Math.max(WINDOW_MIN_S, Math.min(WINDOW_MAX_S, Math.round(width / PX_PER_SECOND)));
  }

  /* RBJ Audio EQ Cookbook biquads. Returns coefficients normalised by a0. */
  function design(type, f0, fs, Q) {
    var w0 = 2 * Math.PI * f0 / fs;
    var cw = Math.cos(w0), sw = Math.sin(w0);
    var alpha = sw / (2 * Q);
    var a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
    var b0, b1, b2;
    if (type === 'notch') {
      b0 = 1; b1 = -2 * cw; b2 = 1;
    } else if (type === 'hp') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    } else if (type === 'lp') {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
    } else {
      throw new Error('bench: unknown filter type ' + type);
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  /* Stateful biquad, transposed direct form II, one sample at a time. */
  function Biquad(c) {
    this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2;
    this.z1 = 0; this.z2 = 0;
  }
  Biquad.prototype.reset = function () { this.z1 = 0; this.z2 = 0; return this; };
  Biquad.prototype.process = function (x) {
    var y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  };
  Biquad.prototype.copyStateFrom = function (o) { this.z1 = o.z1; this.z2 = o.z2; return this; };

  /* The three bench stages, in processing order. Q = 1/sqrt(2) makes the high- and low-pass Butterworth.
     The keys are also the keys of the labels in _data/js/bench.yml, which the page passes to Chain.label(). */
  var STAGES = [
    { key: 'notch', type: 'notch', f0: 50, q: 30 },
    { key: 'hp', type: 'hp', f0: 1, q: Math.SQRT1_2 },
    { key: 'lp', type: 'lp', f0: 40, q: Math.SQRT1_2 }
  ];

  /* The filter chain at FS: every stage always exists, only the enabled ones process the sample. */
  function Chain() {
    this.stages = [];
    this.on = [];
    for (var i = 0; i < STAGES.length; i++) {
      this.stages.push(new Biquad(design(STAGES[i].type, STAGES[i].f0, FS, STAGES[i].q)));
      this.on.push(false);
    }
  }
  Chain.prototype.process = function (x) {
    for (var i = 0; i < this.stages.length; i++) if (this.on[i]) x = this.stages[i].process(x);
    return x;
  };
  Chain.prototype.reset = function () {
    for (var i = 0; i < this.stages.length; i++) this.stages[i].reset();
    return this;
  };
  /* flags: { notch?: bool, hp?: bool, lp?: bool }; keys that are absent keep their state. */
  Chain.prototype.setEnabled = function (flags) {
    for (var i = 0; i < STAGES.length; i++) {
      var k = STAGES[i].key;
      if (Object.prototype.hasOwnProperty.call(flags, k)) this.on[i] = !!flags[k];
    }
    return this;
  };
  Chain.prototype.getEnabled = function () {
    var out = {};
    for (var i = 0; i < STAGES.length; i++) out[STAGES[i].key] = this.on[i];
    return out;
  };
  Chain.prototype.anyOn = function () {
    for (var i = 0; i < this.on.length; i++) if (this.on[i]) return true;
    return false;
  };
  /* names: optional { notch, hp, lp, none } in the page language; without them the keys themselves are listed. */
  Chain.prototype.label = function (names) {
    var parts = [];
    for (var i = 0; i < STAGES.length; i++) {
      var k = STAGES[i].key;
      if (this.on[i]) parts.push(names && names[k] ? names[k] : k);
    }
    return parts.length ? parts.join(', ') : (names && names.none ? names.none : 'none');
  };
  Chain.prototype.clone = function () {
    var c = new Chain();
    for (var i = 0; i < this.stages.length; i++) {
      c.stages[i].copyStateFrom(this.stages[i]);
      c.on[i] = this.on[i];
    }
    return c;
  };

  /* Synthetic EEG at FS, in arbitrary units: a slowly modulated 10 Hz alpha rhythm, a 0.25 Hz drift,
     50 Hz mains, a little 20 Hz beta, white noise and an eye blink every 4 to 6 s. Returns sample(n),
     a pure function of the sample index, so the signal is reproducible and nothing accumulates. */
  var NOISE_N = 8192;           /* length of the seeded white-noise table */
  var NOISE_SD = 0.3;
  var BLINK_T0 = 2.2;           /* first blink slot starts here, seconds */
  var BLINK_PERIOD = 5;         /* one blink per slot; a jitter of up to 1 s inside the slot gives 4 to 6 s gaps */
  var BLINK_DUR = 0.3;
  var BLINK_AMP = 3;
  var BLINK_SEED_OFFSET = 101;  /* keeps the blink jitter stream apart from the noise stream */

  function createSignal(seed) {
    var noise = new Float32Array(NOISE_N);
    var r = Lab.rng(seed);
    for (var i = 0; i < NOISE_N; i++) {
      /* sum of three uniforms, centred and scaled to unit variance */
      noise[i] = (r() + r() + r() - 1.5) * 2;
    }
    /* Blink k starts at BLINK_T0 + k * BLINK_PERIOD + jitter(k), jitter in [0, 1) hashed from the seed.
       A blink ends within its own slot, so only slot k can be active at time tSec. */
    function blinkAt(tSec) {
      var k = Math.floor((tSec - BLINK_T0) / BLINK_PERIOD);
      if (k < 0) return 0;
      var dt = tSec - (BLINK_T0 + k * BLINK_PERIOD + Lab.rng(seed + BLINK_SEED_OFFSET + k)());
      if (dt < 0 || dt >= BLINK_DUR) return 0;
      return BLINK_AMP * 0.5 * (1 - Math.cos(2 * Math.PI * dt / BLINK_DUR)); /* Hann bump */
    }
    return function sample(n) {
      var tSec = n / FS;
      var alphaEnv = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.09 * tSec + 0.8);
      var alpha = alphaEnv * Math.sin(2 * Math.PI * 10 * tSec);
      var drift = 2.5 * Math.sin(2 * Math.PI * 0.25 * tSec + 1.1);
      var mains = 0.6 * Math.sin(2 * Math.PI * 50 * tSec);
      var beta = 0.2 * Math.sin(2 * Math.PI * 20 * tSec + 2.3);
      var white = NOISE_SD * noise[n % NOISE_N];
      return alpha + drift + mains + beta + white + blinkAt(tSec);
    };
  }

  /* Hann-windowed radix-2 FFT magnitude spectrum of a power-of-two length buffer, normalised so a sine of
     amplitude A reads about A at its bin. Returns N/2+1 values. Plans (twiddles, bit reversal, window and
     work buffers) are cached per length so the hot loops allocate nothing. */
  var fftCache = {};
  function fftPlan(N) {
    var p = fftCache[N];
    if (p) return p;
    var bits = 0; while ((1 << bits) < N) bits++;
    var rev = new Uint32Array(N);
    for (var i = 0; i < N; i++) {
      var x = i, y = 0;
      for (var b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
      rev[i] = y;
    }
    var cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
    for (var k = 0; k < N / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / N); sin[k] = -Math.sin(2 * Math.PI * k / N); }
    var win = new Float64Array(N), wsum = 0;
    for (var j = 0; j < N; j++) { win[j] = 0.5 * (1 - Math.cos(2 * Math.PI * j / (N - 1))); wsum += win[j]; }
    p = { rev: rev, cos: cos, sin: sin, win: win, norm: 2 / wsum, re: new Float64Array(N), im: new Float64Array(N) };
    fftCache[N] = p;
    return p;
  }
  function spectrum(samples, out) {
    var N = samples.length;
    var p = fftPlan(N);
    var re = p.re, im = p.im, rev = p.rev, win = p.win;
    var i;
    for (i = 0; i < N; i++) { re[rev[i]] = samples[i] * win[i]; im[rev[i]] = 0; }
    for (var size = 2; size <= N; size <<= 1) {
      var half = size >> 1, step = N / size;
      for (var start = 0; start < N; start += size) {
        for (var k = 0; k < half; k++) {
          var wr = p.cos[k * step], wi = p.sin[k * step];
          var a = start + k, b = a + half;
          var tr = re[b] * wr - im[b] * wi;
          var ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    var M = N / 2 + 1;
    if (!out) out = new Float32Array(M);
    for (i = 0; i < M; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * p.norm;
    /* The one-sided factor 2 does not apply to DC and Nyquist, which have no mirror bin. */
    out[0] *= 0.5; out[M - 1] *= 0.5;
    return out;
  }
  /* Fold a magnitude spectrum (N-point, fs Hz) into nBars bands between 0 and fMax Hz: peak per band, in dB. */
  function bars(mags, N, fs, nBars, fMax, out) {
    if (!out) out = new Float32Array(nBars);
    var bw = fMax / nBars;
    var M = N / 2 + 1;
    for (var j = 0; j < nBars; j++) {
      var kLo = Math.ceil(j * bw * N / fs), kHi = Math.ceil((j + 1) * bw * N / fs) - 1;
      if (kHi < kLo) kHi = kLo;
      var peak = 0;
      for (var k = kLo; k <= kHi && k < M; k++) if (mags[k] > peak) peak = mags[k];
      out[j] = 20 * Math.log10(peak + 1e-9);
    }
    return out;
  }
  /* Bin-level magnitude ratio, in dB, at f0: the peak over the nearest bin plus or minus one bin (which
     absorbs the Hann main lobe) in A versus the same bins in B. This is what the readout uses for
     "50 Hz vs raw": a notch with Q = 30 is about 1.3 Hz wide at -3 dB, so integrating a wider band would
     be capped by the noise floor of bins the notch is designed not to touch. */
  function binDb(magsA, magsB, N, fs, f0) {
    var k0 = Math.round(f0 * N / fs);
    var kLo = Math.max(0, k0 - 1), kHi = Math.min(N / 2, k0 + 1);
    var pa = 0, pb = 0;
    for (var k = kLo; k <= kHi; k++) {
      if (magsA[k] > pa) pa = magsA[k];
      if (magsB[k] > pb) pb = magsB[k];
    }
    return 20 * Math.log10((pa + 1e-9) / (pb + 1e-9));
  }

  window.__benchModel = {
    FS: FS,
    STAGES: STAGES,
    STACK_BELOW: STACK_BELOW,
    LAYOUTS: LAYOUTS,
    layoutFor: layoutFor,
    windowFor: windowFor,
    WINDOW_MAX_S: WINDOW_MAX_S,
    design: design,
    Biquad: Biquad,
    Chain: Chain,
    createSignal: createSignal,
    spectrum: spectrum,
    bars: bars,
    binDb: binDb
  };

  /* ======================================================================
     Part 2: DOM
     ====================================================================== */

  if (typeof document === 'undefined') return;
  var root = document.getElementById('bench');
  if (!root) return;
  var figure = root.querySelector('.bench-figure');
  var traceCanvas = document.getElementById('bench-canvas');
  var specCanvas = document.getElementById('bench-spectrum');
  var readout = document.getElementById('bench-readout');
  if (!figure || !traceCanvas || !specCanvas) return;

  var reduce = Lab.reduceMotion;
  var inputs = Array.prototype.slice.call(root.querySelectorAll('input[type=checkbox][data-filter]'));
  var str = Lab.strings('bench');
  /* Stage names for Chain.label(), in the language of the page. */
  var stageNames = { none: str('none') };
  STAGES.forEach(function (s) { stageNames[s.key] = str(s.key); });

  var SIGNAL_SEED = 7;
  var RING = 1536;              /* about 6 s kept, so a refilter has time to settle before the window */
  var SPEC_N = 256;             /* bars: spectrum of the last 256 filtered samples */
  var MEAS_N = 1024;            /* readout: 50 Hz measurement over the whole 4 s window (bin width 0.24 Hz) */
  var MEAS_F0 = 50;
  var NBARS_MAX = LAYOUTS.wide.bars, FMAX = 60;
  var DB_FLOOR = -36, DB_TOP = 12;      /* bar height range */
  var BAR_SMOOTH = 0.5;                 /* fraction of the new value taken per bar update */
  var BARS_EVERY = 8;                   /* frames between bar updates */
  var READOUT_EVERY = 64;               /* frames between readout updates */
  var READOUT_SMOOTH = 0.15;            /* a single 50 Hz bin sits at the noise floor once notched, so average over updates */
  var READOUT_HYSTERESIS_DB = 2;        /* the shown value only moves when the average has moved this much */
  var FADE_MS = 300;                    /* crossfade after a toggle */
  var MAX_STEP_S = 0.1;                 /* longest simulated advance per frame */
  var AMP_RANGE = 7.5;                  /* signal units mapped to the half height, fixed so the drift stays visible */
  var TRACE_FOOTER = 22, TRACE_PAD_Y = 6;
  var SPEC_PAD_X = 12, SPEC_PAD_TOP = 10, SPEC_FOOTER = 20, BAR_GAP = 2;

  var signal = createSignal(SIGNAL_SEED);
  var raw = new Float32Array(RING);
  var filt = new Float32Array(RING);
  var filtPrev = new Float32Array(RING);
  var head = 0;                 /* next write index; the newest sample sits at head - 1 */
  var n = 0;                    /* absolute sample counter */
  var chain = new Chain();
  var prevChain = null;         /* old chain kept alive during the crossfade */
  var fadeStart = -1;           /* ms timestamp of the last toggle, -1 when idle */
  var rawTarget = 0;            /* raw trace opacity: 1 while any filter is on */
  var rawFadeStart = -1, rawFadeFrom = 0;

  var specScratch = new Float32Array(SPEC_N);
  var measScratch = new Float32Array(MEAS_N);
  var specMags = new Float32Array(SPEC_N / 2 + 1);
  var measF = new Float32Array(MEAS_N / 2 + 1);
  var measR = new Float32Array(MEAS_N / 2 + 1);
  var barDb = new Float32Array(NBARS_MAX);
  var barTarget = new Float32Array(NBARS_MAX);

  var tv = { w: 0, h: 0, ctx: null };
  var sv = { w: 0, h: 0, ctx: null };
  var layout = LAYOUTS.wide;
  var nbars = layout.bars;
  var winS = WINDOW_MAX_S, winN = winS * FS;   /* seconds and samples on screen, set in fit() */
  var windowLabel = '';

  var shownDb = null;           /* dB value currently in the readout */
  var smoothDb = null;          /* running average of the bin-level measurement between toggles */

  /* ---- tokens ---- */
  var t, traceAlpha, trace2Alpha;
  /* The alpha of the two trace tokens is read once per theme so the frame loop only multiplies. */
  function readTokens() {
    t = Lab.tokens();
    traceAlpha = Lab.alpha(t.trace);
    trace2Alpha = Lab.alpha(t.trace2);
  }
  readTokens();

  /* ---- ring buffer ---- */
  function ringIndex(back) { return (head - back + RING) % RING; }

  function push(x) {
    raw[head] = x;
    filt[head] = chain.process(x);
    if (prevChain) filtPrev[head] = prevChain.process(x);
    head = (head + 1) % RING;
    n++;
  }
  /* Re-run the whole ring through the (reset) chain, oldest to newest, so the display is consistent. */
  function refilter() {
    chain.reset();
    for (var i = RING; i >= 1; i--) {
      var idx = ringIndex(i);
      filt[idx] = chain.process(raw[idx]);
    }
  }
  function fillRing() {
    for (n = 0; n < RING; n++) raw[n] = signal(n);
    head = 0;
  }
  function copyLast(buf, src, count) {
    for (var i = 0; i < count; i++) buf[i] = src[ringIndex(count - i)];
    return buf;
  }

  /* ---- measurements ---- */
  function measureDb() {
    spectrum(copyLast(measScratch, filt, MEAS_N), measF);
    spectrum(copyLast(measScratch, raw, MEAS_N), measR);
    return binDb(measF, measR, MEAS_N, FS, MEAS_F0);
  }
  function updateBars(instant) {
    spectrum(copyLast(specScratch, filt, SPEC_N), specMags);
    bars(specMags, SPEC_N, FS, nbars, FMAX, barTarget);
    for (var j = 0; j < nbars; j++) {
      barDb[j] = instant ? barTarget[j] : barDb[j] + (barTarget[j] - barDb[j]) * BAR_SMOOTH;
    }
  }

  function formatDb(db) {
    var r = Math.round(db);
    if (r === 0) return '0 dB';
    return (r > 0 ? '+' : '-') + Math.abs(r) + ' dB';
  }
  /* force: a toggle just happened, so restart the average and show the new value at once. */
  function writeReadout(force) {
    if (!readout) return;
    var text = Lab.format(str('filters'), { list: chain.label(stageNames) });
    if (chain.anyOn()) {
      var db = measureDb();
      if (force || smoothDb === null) smoothDb = db; else smoothDb += (db - smoothDb) * READOUT_SMOOTH;
      if (force || shownDb === null || Math.abs(smoothDb - shownDb) >= READOUT_HYSTERESIS_DB) shownDb = smoothDb;
      text += ' ' + Lab.format(str('vs_raw'), { f: MEAS_F0, db: formatDb(shownDb) });
    } else {
      shownDb = null;
      smoothDb = null;
    }
    if (readout.textContent !== text) readout.textContent = text;
  }

  /* ---- drawing ---- */
  function rawOpacity(now) {
    if (reduce || rawFadeStart < 0) return rawTarget;
    var k = Lab.clamp((now - rawFadeStart) / FADE_MS, 0, 1);
    return rawFadeFrom + (rawTarget - rawFadeFrom) * k;
  }

  function drawPolyline(ctx, buf, w, mid, scale) {
    var x0 = -1, dx = (w + 2) / (winN - 1);
    ctx.beginPath();
    for (var i = 0; i < winN; i++) {
      var y = mid - buf[ringIndex(winN - i)] * scale;
      if (i === 0) ctx.moveTo(x0, y); else ctx.lineTo(x0 + i * dx, y);
    }
    ctx.stroke();
  }

  var tickLabel = str('tick');

  function drawTrace(now) {
    var ctx = tv.ctx; if (!ctx) return;
    var w = tv.w, h = tv.h;
    ctx.clearRect(0, 0, w, h);
    var plotH = h - TRACE_FOOTER;
    var mid = plotH / 2;
    var scale = (mid - TRACE_PAD_Y) / AMP_RANGE;

    /* baseline and one tick per second */
    ctx.save();
    ctx.strokeStyle = t.lineStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var s = 1; s < winS; s++) {
      var x = Math.round(w * s / winS) + 0.5;
      ctx.moveTo(x, plotH + 4); ctx.lineTo(x, plotH + 10);
    }
    ctx.moveTo(0, plotH + 0.5); ctx.lineTo(w, plotH + 0.5);
    ctx.stroke();
    ctx.fillStyle = t.muted;
    ctx.font = Lab.font(layout.labelPx, t);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillText(tickLabel, Math.round(w / (2 * winS)), h - 5);
    ctx.textAlign = 'right';
    ctx.fillText(windowLabel, w - 12, h - 5);
    ctx.restore();

    /* clip the traces to the plot area so a blink never runs into the ticks */
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, plotH); ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    var kFade = 1;
    if (!reduce && fadeStart >= 0) kFade = Lab.clamp((now - fadeStart) / FADE_MS, 0, 1);
    var kRaw = rawOpacity(now);

    if (kRaw > 0.01) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = Lab.rgba(t.trace2, trace2Alpha * kRaw);
      drawPolyline(ctx, raw, w, mid, scale);
    }
    if (prevChain && kFade < 1) {
      ctx.lineWidth = layout.lineWidth;
      ctx.strokeStyle = Lab.rgba(t.trace, traceAlpha * (1 - kFade));
      drawPolyline(ctx, filtPrev, w, mid, scale);
    }
    ctx.lineWidth = layout.lineWidth;
    ctx.strokeStyle = kFade < 1 ? Lab.rgba(t.trace, traceAlpha * kFade) : t.trace;
    drawPolyline(ctx, filt, w, mid, scale);
    ctx.restore();
  }

  function drawSpectrum() {
    var ctx = sv.ctx; if (!ctx) return;
    var w = sv.w, h = sv.h;
    ctx.clearRect(0, 0, w, h);
    var plotW = w - SPEC_PAD_X * 2, plotH = h - SPEC_PAD_TOP - SPEC_FOOTER;
    var base = SPEC_PAD_TOP + plotH;
    var bw = (plotW - BAR_GAP * (nbars - 1)) / nbars;

    ctx.save();
    ctx.strokeStyle = t.lineStrong;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(SPEC_PAD_X, base + 0.5); ctx.lineTo(w - SPEC_PAD_X, base + 0.5); ctx.stroke();

    ctx.fillStyle = t.accent;
    for (var j = 0; j < nbars; j++) {
      var k = Lab.clamp((barDb[j] - DB_FLOOR) / (DB_TOP - DB_FLOOR), 0, 1);
      var bh = Math.max(k > 0 ? 1 : 0, Math.round(k * plotH));
      if (bh > 0) ctx.fillRect(SPEC_PAD_X + j * (bw + BAR_GAP), base - bh, bw, bh);
    }

    ctx.fillStyle = t.muted;
    ctx.font = Lab.font(layout.labelPx, t);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText('0', SPEC_PAD_X, h - 5);
    ctx.textAlign = 'center'; ctx.fillText(String(FMAX / 2), SPEC_PAD_X + plotW / 2, h - 5);
    ctx.textAlign = 'right'; ctx.fillText(FMAX + ' Hz', w - SPEC_PAD_X, h - 5);
    ctx.restore();
  }

  function drawAll(now) {
    drawTrace(now === undefined ? Lab.now() : now);
    drawSpectrum();
  }

  /* ---- filters ---- */
  function syncInputs() {
    var on = chain.getEnabled();
    for (var j = 0; j < inputs.length; j++) {
      var want = on[inputs[j].getAttribute('data-filter')];
      if (inputs[j].checked !== want) inputs[j].checked = want;
    }
  }
  function flagsFromInputs() {
    var f = {};
    for (var j = 0; j < inputs.length; j++) f[inputs[j].getAttribute('data-filter')] = inputs[j].checked;
    return f;
  }
  function applyFilters(flags, animate) {
    var before = chain.getEnabled();
    var changed = false;
    for (var i = 0; i < STAGES.length; i++) {
      var k = STAGES[i].key;
      if (Object.prototype.hasOwnProperty.call(flags, k) && !!flags[k] !== before[k]) changed = true;
    }
    if (!changed) return;
    var now = Lab.now();
    var fade = animate && !reduce;
    if (fade) {
      prevChain = chain.clone();
      filtPrev.set(filt);
      fadeStart = now;
    } else {
      prevChain = null;
      fadeStart = -1;
    }
    chain.setEnabled(flags);
    refilter();
    var target = chain.anyOn() ? 1 : 0;
    if (target !== rawTarget) {
      if (fade) { rawFadeFrom = rawOpacity(now); rawFadeStart = now; } else rawFadeStart = -1;
      rawTarget = target;
    }
    syncInputs();
    updateBars(true);
    writeReadout(true);
    if (!running || reduce) drawAll(now);
  }
  for (var ii = 0; ii < inputs.length; ii++) {
    inputs[ii].addEventListener('change', function () { applyFilters(flagsFromInputs(), true); });
  }

  /* ---- loop ---- */
  var running = false, rafId = 0, lastTs = -1, acc = 0, frameCount = 0;
  function tick(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (lastTs < 0) lastTs = ts;
    var dt = Lab.clamp((ts - lastTs) / 1000, 0, MAX_STEP_S);
    lastTs = ts;
    acc += dt * FS;
    var k = acc | 0;
    acc -= k;
    for (var i = 0; i < k; i++) push(signal(n));
    if (fadeStart >= 0 && ts - fadeStart >= FADE_MS) { fadeStart = -1; prevChain = null; }
    if (rawFadeStart >= 0 && ts - rawFadeStart >= FADE_MS) rawFadeStart = -1;
    frameCount++;
    if (frameCount % BARS_EVERY === 0) updateBars(false);
    if (frameCount % READOUT_EVERY === 0 && chain.anyOn()) writeReadout(false);
    drawTrace(ts);
    drawSpectrum();
  }
  function start() {
    if (running) return;
    running = true; lastTs = -1; acc = 0;
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ---- sizing, theme, fonts ---- */
  /* The layout follows the width of the figure container: the class switches the CSS grid, and the canvases
     are measured after it so both passes of the resize observer converge on the same frame. */
  function fit() {
    var next = layoutFor(figure.getBoundingClientRect().width);
    if (next !== layout) {
      layout = next;
      nbars = layout.bars;
      figure.classList.toggle('is-stacked', layout.stacked);
      updateBars(true);
    }
    var a = Lab.fitCanvas(traceCanvas);
    tv.w = a.w; tv.h = a.h; tv.ctx = a.ctx;
    var b = Lab.fitCanvas(specCanvas);
    sv.w = b.w; sv.h = b.h; sv.ctx = b.ctx;
    var seconds = windowFor(tv.w);
    if (seconds !== winS || !windowLabel) {
      winS = seconds; winN = winS * FS;
      windowLabel = Lab.format(str('window'), { s: winS });
    }
  }
  function refit() { fit(); drawAll(); }
  if (typeof ResizeObserver !== 'undefined') {
    /* Both canvases are observed as well as the figure: the layout class changes their boxes without the
       figure itself changing size. */
    var ro = new ResizeObserver(refit);
    ro.observe(figure);
    ro.observe(traceCanvas);
    ro.observe(specCanvas);
  } else {
    window.addEventListener('resize', refit);
  }
  Lab.onTheme(function () { readTokens(); drawAll(); });
  Lab.fontsReady(drawAll);

  /* ---- init: ?bench=notch,hp,lp turns filters on for screenshots; a restored checkbox state also counts ---- */
  var initial = flagsFromInputs();
  var dbg = Lab.param('bench');
  if (dbg) {
    dbg.split(',').forEach(function (s) {
      s = s.trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(initial, s)) initial[s] = true;
    });
  }
  fillRing();
  chain.setEnabled(initial);
  refilter();
  rawTarget = chain.anyOn() ? 1 : 0;
  syncInputs();
  fit();
  updateBars(true);
  writeReadout(true);
  drawAll();
  if (!reduce) Lab.whenVisible(root, start, stop);

  /* Scripted checks (see README). */
  window.__bench = {
    setFilters: function (flags) { applyFilters(flags, false); },
    getFilters: function () { return chain.getEnabled(); },
    readout: function () { return readout ? readout.textContent : ''; },
    layout: function () { return layout; },
    windowSeconds: function () { return winS; },
    isRunning: function () { return running; }
  };
})();
