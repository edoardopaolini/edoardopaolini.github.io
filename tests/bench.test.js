/* Model tests for assets/js/bench.js. Run from the repository root:
     jsc tests/bench.test.js
   (JavaScriptCore's jsc, or any engine with load() and print()). */
var window = this;  /* bare engine: the modules attach to window */
load('tests/harness.js');
load('assets/js/lab.js'); load('assets/js/bench.js');

var M = window.__benchModel;
var FS = M.FS;
function dB(ratio) { return 20 * Math.log10(ratio); }

/* ---- module shape ---- */
assert(!!M && typeof window.__bench === 'undefined', 'model exported, DOM part skipped without document');
assert(FS === 250, 'sample rate 250 Hz');

/* ---- RBJ Audio EQ Cookbook coefficients, computed independently ---- */
function cookbook(type, f0, Q) {
  var w0 = 2 * Math.PI * f0 / FS, cw = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
  var a0 = 1 + al, b;
  if (type === 'notch') b = [1, -2 * cw, 1];
  else if (type === 'hp') b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  else b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
}
M.STAGES.forEach(function (s) {
  var got = M.design(s.type, s.f0, FS, s.q), want = cookbook(s.type, s.f0, s.q);
  var ok = ['b0', 'b1', 'b2', 'a1', 'a2'].every(function (k) { return near(got[k], want[k], 1e-12); });
  assert(ok, 'design(' + s.type + ', ' + s.f0 + ' Hz, Q ' + s.q.toFixed(4) + ') matches the cookbook');
});
assert(near(M.design('hp', 1, FS, Math.SQRT1_2).b0, 0.9823, 5e-4), 'high-pass 1 Hz b0 about 0.9823');
var threw = false;
try { M.design('bandpass', 1, FS, 1); } catch (e) { threw = true; }
assert(threw, 'design throws on an unknown type');

/* Frequency response of a coefficient set, |H(e^jw)|. */
function gain(c, f) {
  var w = 2 * Math.PI * f / FS;
  var nr = c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2 * w), ni = -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2 * w));
  var dr = 1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w), di = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w));
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}
var notch = M.design('notch', 50, FS, 30), hp = M.design('hp', 1, FS, Math.SQRT1_2), lp = M.design('lp', 40, FS, Math.SQRT1_2);
assert(dB(gain(notch, 50)) < -60, 'analytic notch is deeper than -60 dB at 50 Hz');
assert(near(dB(gain(hp, 1)), -3.01, 0.1) && near(dB(gain(lp, 40)), -3.01, 0.1), 'Butterworth stages are -3 dB at their cutoff');
assert(near(gain(lp, 0), 1, 1e-9) && near(gain(hp, FS / 2), 1, 1e-9), 'low-pass passes DC, high-pass passes Nyquist');

/* ---- sines through the chain: steady-state RMS gain of one enabled stage ---- */
function chainGain(flags, f, seconds) {
  var ch = new M.Chain().setEnabled(flags);
  var N = Math.round(seconds * FS), settle = N >> 1, pin = 0, pout = 0;
  for (var i = 0; i < N; i++) {
    var x = Math.sin(2 * Math.PI * f * i / FS), y = ch.process(x);
    if (i >= settle) { pin += x * x; pout += y * y; }
  }
  return 10 * Math.log10(pout / pin);
}
var g;
g = chainGain({ notch: true }, 50, 20); assert(g <= -20, 'notch: 50 Hz sine ' + g.toFixed(1) + ' dB (need <= -20)');
g = chainGain({ notch: true }, 10, 20); assert(Math.abs(g) < 1, 'notch: 10 Hz sine ' + g.toFixed(2) + ' dB (need within 1)');
g = chainGain({ hp: true }, 0.25, 40); assert(g <= -15, 'high-pass: 0.25 Hz sine ' + g.toFixed(1) + ' dB (need <= -15)');
g = chainGain({ hp: true }, 10, 20); assert(Math.abs(g) < 1, 'high-pass: 10 Hz sine ' + g.toFixed(2) + ' dB (need within 1)');
g = chainGain({ lp: true }, 100, 20); assert(g <= -15, 'low-pass: 100 Hz sine ' + g.toFixed(1) + ' dB (need <= -15)');
g = chainGain({ lp: true }, 10, 20); assert(Math.abs(g) < 1, 'low-pass: 10 Hz sine ' + g.toFixed(2) + ' dB (need within 1)');
var bq = new M.Biquad(notch), y = bq.process(1);
for (var i = 0; i < 5000; i++) y = bq.process(0);
assert(Math.abs(y) < 1e-6, 'notch impulse response decays (stable)');

/* ---- chain bookkeeping ---- */
var ch = new M.Chain();
assert(ch.label() === 'none' && !ch.anyOn(), 'empty chain: label "none", nothing on');
ch.setEnabled({ notch: true, hp: true, lp: true });
assert(ch.label() === 'notch, hp, lp', 'without names the label lists the stage keys: ' + ch.label());
ch.setEnabled({ hp: false });
assert(ch.label() === 'notch, lp' && ch.getEnabled().hp === false, 'partial setEnabled keeps the other stages');
for (i = 0; i < 100; i++) ch.process(Math.sin(i));
var clone = ch.clone();
assert(clone.process(0.5) === ch.process(0.5), 'clone carries the filter state');
ch.reset();
assert(ch.process(0) === 0, 'reset clears the filter state');
assert(M.STAGES.every(function (st) { return st.label === undefined; }), 'the stages carry no English labels (they live in _data/js/bench.yml)');
var names = { notch: 'notch 50 Hz', hp: 'passa-alto 1 Hz', lp: 'passa-basso 40 Hz', none: 'nessuno' };
assert(ch.label(names) === 'notch 50 Hz, passa-basso 40 Hz', 'label takes the names of the page language: ' + ch.label(names));
assert(new M.Chain().label(names) === 'nessuno', 'empty chain uses the translated "none"');

/* ---- layout: a pure function of the container width ---- */
assert(M.STACK_BELOW === 700, 'the bench stacks under 700 px');
var narrow = M.layoutFor(699), wide = M.layoutFor(700);
assert(narrow.stacked === true && wide.stacked === false, '699 px stacks, 700 px stays side by side');
assert(M.layoutFor(360).stacked && M.layoutFor(390).stacked && !M.layoutFor(1200).stacked, 'phones stack, wide figures do not');
assert(narrow.bars === 8 && wide.bars === 12, 'stacked layout has 8 bars, wide layout 12');
assert(narrow.labelPx >= 12 && wide.labelPx >= 11, 'stacked labels are at least 12 px');
assert(narrow.traceMin >= 180 && narrow.specHeight === 110, 'stacked trace at least 180 px tall, spectrum 110 px');
assert(M.layoutFor(360) === M.layoutFor(500), 'the layout objects are shared, so identity tells a change');
assert(M.windowFor(278) === 2 && M.windowFor(308) === 2, 'a phone-wide trace shows 2 s');
assert(M.windowFor(432) === 3 && M.windowFor(594) === 4 && M.windowFor(1400) === 4, 'wider traces show 3 s, then the 4 s maximum');
assert(M.windowFor(50) === 2 && M.WINDOW_MAX_S === 4, 'the window never drops under 2 s or over 4 s');

/* ---- spectrum: bin mapping, normalisation, DC factor ---- */
var N = 256, buf = new Float32Array(N);
for (i = 0; i < N; i++) buf[i] = Math.sin(2 * Math.PI * 10 * i / FS);
var sp = M.spectrum(buf);
var peakBin = 0;
for (i = 1; i < sp.length; i++) if (sp[i] > sp[peakBin]) peakBin = i;
assert(sp.length === N / 2 + 1, 'spectrum returns N/2+1 bins');
assert(peakBin === 10, '10 Hz sine peaks at bin 10 of a 256-point spectrum (got ' + peakBin + ')');
assert(sp[10] > 0.85 && sp[10] < 1.1, 'unit sine reads about 1 at its bin (' + sp[10].toFixed(3) + ')');
for (i = 0; i < N; i++) buf[i] = 2;
sp = M.spectrum(buf);
assert(near(sp[0], 2, 1e-3), 'constant 2.0 gives bin 0 = 2.0 (' + sp[0].toFixed(4) + ')');
var out = new Float32Array(N / 2 + 1);
assert(M.spectrum(buf, out) === out, 'spectrum writes into the buffer it is given');
for (i = 0; i < N; i++) buf[i] = Math.sin(2 * Math.PI * 30 * i / FS);
var b = M.bars(M.spectrum(buf), N, FS, 30, 60), top = 0;
for (i = 1; i < 30; i++) if (b[i] > b[top]) top = i;
assert(b.length === 30 && top === 15, '30 Hz sine lands in bar 15 of 30 up to 60 Hz (got ' + top + ')');

/* ---- synthetic signal ---- */
var sig = M.createSignal(7), sig2 = M.createSignal(7);
var SEC = 60, samples = new Float32Array(SEC * FS), mx = -Infinity, mn = Infinity, same = true;
for (i = 0; i < samples.length; i++) {
  var v = sig(i);
  samples[i] = v;
  if (sig2(i) !== v) same = false;
  if (samples[i] > mx) mx = samples[i];
  if (samples[i] < mn) mn = samples[i];
}
assert(same, 'same seed gives the same signal');
assert(isFinite(mx) && mx < 7.5 && mn > -7.5, 'amplitude stays within the 7.5-unit half range (' + mn.toFixed(2) + ' to ' + mx.toFixed(2) + ')');
assert(mx > 3 && mn < -2, 'amplitude is not trivially small (' + mn.toFixed(2) + ' to ' + mx.toFixed(2) + ')');
/* Residual after removing the deterministic rhythms leaves noise plus blinks: 300 ms bumps of amplitude 3. */
var starts = [], inBlink = false;
for (i = 0; i < samples.length; i++) {
  var tSec = i / FS;
  var det = (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.09 * tSec + 0.8)) * Math.sin(2 * Math.PI * 10 * tSec) +
    2.5 * Math.sin(2 * Math.PI * 0.25 * tSec + 1.1) + 0.6 * Math.sin(2 * Math.PI * 50 * tSec) + 0.2 * Math.sin(2 * Math.PI * 20 * tSec + 2.3);
  var resid = samples[i] - det;
  if (!inBlink && resid > 1.6) { inBlink = true; starts.push(tSec); }
  if (inBlink && resid < 0.8 && tSec - starts[starts.length - 1] > 0.2) inBlink = false;
}
var gaps = [];
for (i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
assert(starts.length >= 10 && starts.length <= 15 && gaps.every(function (d) { return d > 3.8 && d < 6.2; }),
  'blinks every 4 to 6 s (' + starts.length + ' in ' + SEC + ' s, gaps ' + gaps.map(function (d) { return d.toFixed(1); }).join(' ') + ')');
var sp1k = M.spectrum(samples.subarray(0, 1024));
function peakNear(mags, f, n) { var k = Math.round(f * n / FS), p = 0; for (var j = k - 1; j <= k + 1; j++) if (mags[j] > p) p = mags[j]; return p; }
assert(peakNear(sp1k, 10, 1024) > 0.5 && peakNear(sp1k, 10, 1024) < 1.3, 'alpha peak near 10 Hz (' + peakNear(sp1k, 10, 1024).toFixed(2) + ')');
assert(near(peakNear(sp1k, 50, 1024), 0.6, 0.2), 'mains peak near 50 Hz about 0.6 (' + peakNear(sp1k, 50, 1024).toFixed(2) + ')');
assert(peakNear(sp1k, 0.25, 1024) > 1.5, 'drift present at 0.25 Hz (' + peakNear(sp1k, 0.25, 1024).toFixed(2) + ')');

/* ---- readout measurement: binDb of the notched signal against the raw one ---- */
var MEAS = 1024, rawB = new Float32Array(MEAS), filB = new Float32Array(MEAS);
ch = new M.Chain().setEnabled({ notch: true });
for (i = 0; i < 8 * FS; i++) {
  var x = sig(i), yf = ch.process(x);
  if (i >= 8 * FS - MEAS) { rawB[i - (8 * FS - MEAS)] = x; filB[i - (8 * FS - MEAS)] = yf; }
}
var spR = M.spectrum(rawB), spF = M.spectrum(filB);
g = M.binDb(spF, spR, MEAS, FS, 50); assert(g < -20, 'binDb at 50 Hz with the notch on: ' + g.toFixed(1) + ' dB');
g = M.binDb(spF, spR, MEAS, FS, 10); assert(Math.abs(g) < 1, 'binDb at 10 Hz with the notch on: ' + g.toFixed(2) + ' dB');

summary('bench');
