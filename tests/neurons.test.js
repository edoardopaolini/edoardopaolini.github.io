/* Model tests for assets/js/neurons.js. Run from the repository root:
     jsc tests/neurons.test.js
   (JavaScriptCore's jsc, or any engine with load() and print()). */
var window = this;  /* bare engine: the modules attach to window */
load('tests/harness.js');
load('assets/js/lab.js'); load('assets/js/neurons.js');

var M = window.__neuronsModel;

/* ---- module shape ---- */
assert(!!M && typeof window.__neurons === 'undefined', 'model exported, DOM part skipped without document');
assert(M.MIN_SOMA_DISTANCE === 110 && M.MAX_HOPS === 3 && M.MAX_CASCADES === 4 && M.FIRE_PROBABILITY === 0.55 && M.SYNAPTIC_DELAY === 60,
  'contract constants: 110 px spacing, 3 hops, 4 cascades, p = 0.55, 60 ms delay');

/* ---- count rule: one neuron per 90 000 px2, clamped 8 to 26, 6 on phones ---- */
assert(M.countFor(1440, 900) === 14, '1440x900 gives 14 neurons');
assert(M.countFor(1920, 1080) === 23, '1920x1080 gives 23 neurons');
assert(M.countFor(1024, 768) === 9, '1024x768 gives 9 neurons');
assert(M.countFor(2560, 1440) === 26, '2560x1440 clamps to 26');
assert(M.countFor(800, 600) === 8, '800x600 clamps up to 8');
assert(M.countFor(390, 844) === 6 && M.countFor(360, 640) === 6, 'phones get 6');

/* ---- determinism ---- */
function snapshot(f) {
  return JSON.stringify(f.neurons.map(function (n) {
    return [n.x, n.y, n.r, n.hillock, n.axon.targets, n.axon.bends, n.dendrites.length, Array.prototype.slice.call(n.dendrites[0].pts)];
  }));
}
var a = M.generate(7, 1440, 900), b = M.generate(7, 1440, 900), c = M.generate(8, 1440, 900);
assert(snapshot(a) === snapshot(b), 'the same seed and size give the same field');
assert(snapshot(a) !== snapshot(c), 'a different seed gives a different field');
assert(snapshot(a) !== snapshot(M.generate(7, 1366, 768)), 'a different size gives a different field');

/* ---- geometry of the generated field at several viewports ---- */
[[1440, 900], [1366, 768], [1024, 768], [390, 844], [360, 640], [1920, 1080], [2560, 1440]].forEach(function (sz) {
  var w = sz[0], h = sz[1], f = M.generate(2026, w, h), ns = f.neurons, label = w + 'x' + h + ': ';
  assert(ns.length === M.countFor(w, h), label + ns.length + ' neurons, as the area rule says');
  var minD = Infinity, i, j;
  for (i = 0; i < ns.length; i++) for (j = i + 1; j < ns.length; j++) {
    var d = Math.sqrt((ns[i].x - ns[j].x) * (ns[i].x - ns[j].x) + (ns[i].y - ns[j].y) * (ns[i].y - ns[j].y));
    if (d < minD) minD = d;
  }
  assert(minD >= M.MIN_SOMA_DISTANCE, label + 'closest somas ' + minD.toFixed(1) + ' px apart (need >= 110)');
  var inside = true, radii = true, dendrites = true, targets = true, lengths = true, counts = { 1: 0, 2: 0, 3: 0 };
  for (i = 0; i < ns.length; i++) {
    var n = ns[i];
    if (n.x < 0 || n.x > w || n.y < 0 || n.y > h) inside = false;
    if (n.r < M.SOMA_R_MIN || n.r > M.SOMA_R_MAX) radii = false;
    if (n.dendrites.length < M.DENDRITES_MIN || n.dendrites.length > M.DENDRITES_MAX) dendrites = false;
    for (j = 0; j < n.dendrites.length; j++) if (n.dendrites[j].children.length < 1 || n.dendrites[j].children.length > 2) dendrites = false;
    var t = n.axon.targets;
    if (t.length < 1 || t.length > 3) targets = false; else counts[t.length]++;
    for (j = 0; j < t.length; j++) {
      if (t[j] !== Math.floor(t[j]) || t[j] < 0 || t[j] >= ns.length || t[j] === i) targets = false;
      if (t.indexOf(t[j]) !== j) targets = false;
      if (!(n.axon.lengths[j] > M.MIN_SOMA_DISTANCE - 2 * M.SOMA_R_MAX)) lengths = false;
    }
  }
  assert(inside, label + 'every soma lies inside the viewport');
  assert(radii, label + 'soma radii within 4 to 8 px');
  assert(dendrites, label + '3 to 5 dendrites per neuron, each with 1 or 2 branches');
  assert(targets, label + 'every axon reaches 1 to 3 distinct existing neurons, never itself (' + counts[1] + '/' + counts[2] + '/' + counts[3] + ' with 1/2/3 targets)');
  assert(lengths, label + 'every axon is at least as long as the gap between two somas');
});

/* ---- pointAt walks the sampled curve ---- */
var f0 = M.generate(3, 1440, 900), n0 = f0.neurons[0], out = { x: 0, y: 0, tx: 0, ty: 0 };
M.pointAt(n0.axon.pts[0], n0.axon.cum[0], 24, 0, out);
var near0 = Math.abs(out.x - n0.axon.pts[0][0]) < 1e-6 && Math.abs(out.y - n0.axon.pts[0][1]) < 1e-6;
M.pointAt(n0.axon.pts[0], n0.axon.cum[0], 24, n0.axon.lengths[0] * 10, out);
var nearEnd = Math.abs(out.x - n0.axon.pts[0][46]) < 1e-6 && Math.abs(out.y - n0.axon.pts[0][47]) < 1e-6;
assert(near0 && nearEnd && Math.abs(out.tx * out.tx + out.ty * out.ty - 1) < 1e-6, 'pointAt clamps to both ends and returns a unit tangent');

/* ---- cascades: always fire, so the hop cap is what stops them ---- */
var field = M.generate(11, 1440, 900);
var always = function () { return 0; };   /* every draw below 0.55: every reached target fires */
var S = new M.Scheduler(field, always);
S.intervalMin = S.intervalMax = 1e9;      /* no spontaneous fires in this test */
var log = [];
S.onFire = function (index, hop, cascade) { log.push({ index: index, hop: hop, cascade: cascade, time: S.time }); };
assert(S.start(0), 'a cascade starts on an idle scheduler');
var maxHop = -1, pulseFromCap = false, step;
for (step = 0; step < 20000; step++) {
  S.advance(1);
  for (var q = 0; q < S.pulses.length; q++) if (S.pulses[q].active && S.pulses[q].hop >= M.MAX_HOPS) pulseFromCap = true;
}
for (step = 0; step < log.length; step++) if (log[step].hop > maxHop) maxHop = log[step].hop;
assert(maxHop === M.MAX_HOPS, 'an always-firing cascade reaches hop 3 and stops there (max hop ' + maxHop + ', ' + log.length + ' fires)');
assert(!pulseFromCap, 'no pulse ever leaves a neuron that fired at hop 3');
assert(S.liveCascades() === 0 && S.fires === log.length, 'the cascade releases its slot once the last pulse has landed');
var shortest = Math.min.apply(null, field.neurons[0].axon.lengths);
var expected = shortest / M.PULSE_SPEED + M.SYNAPTIC_DELAY;
assert(log.length > 1 && log[1].hop === 1 && Math.abs(log[1].time - expected) <= 2,
  'the nearest target fires 60 ms after the pulse lands (' + log[1].time.toFixed(0) + ' ms, expected ' + expected.toFixed(0) + ')');

/* ---- never more than 4 concurrent cascades ---- */
var S4 = new M.Scheduler(field, always);
S4.intervalMin = S4.intervalMax = 1e9;
var okStarts = 0;
for (step = 0; step < 4; step++) if (S4.start(step)) okStarts++;
assert(okStarts === 4 && S4.liveCascades() === 4, 'four cascades run at once');
assert(!S4.start(5), 'the fifth cascade is refused while four are alive');
var maxLive = 0;
for (step = 0; step < 20000; step++) { S4.advance(1); if (S4.liveCascades() > maxLive) maxLive = S4.liveCascades(); }
assert(maxLive <= M.MAX_CASCADES && S4.liveCascades() === 0, 'concurrent cascades stay at most 4 and all end (peak ' + maxLive + ')');

/* ---- spontaneous fires follow the interval and respect the slot cap ---- */
var S5 = new M.Scheduler(field, always);
var starts = 0;
S5.onFire = function (index, hop) { if (hop === 0) starts++; };
for (step = 0; step < 12000; step++) S5.advance(1);
assert(starts === 10, 'with the minimum interval a neuron fires every 1.2 s (' + starts + ' spontaneous fires in 12 s)');
var never = function () { return 0.99; };  /* above 0.55: no target ever fires; long intervals */
var S6 = new M.Scheduler(field, never);
S6.start(2);
for (step = 0; step < 3000; step++) S6.advance(1);
assert(S6.fires === 1 && S6.liveCascades() === 0, 'when no target fires the cascade is one flash and its pulses');

/* ---- no en- or em-dashes in the model surface ---- */
assert(!/[\u2013\u2014]/.test(Object.keys(M).join(' ')), 'no dashes in the exported names');

summary('neurons');
