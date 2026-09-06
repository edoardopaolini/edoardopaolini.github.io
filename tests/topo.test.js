/* Model tests for assets/js/topo.js (the microstate topography). Run from the repository root:
     jsc tests/topo.test.js
   (JavaScriptCore's jsc, or any engine with load() and print()). */
var window = this;  /* bare engine: the modules attach to window */
load('tests/harness.js');
load('assets/js/lab.js'); load('assets/js/topo.js');

var Lab = window.Lab, MONTAGE = Lab.MONTAGE, ix = Lab.electrodeIndex;
var M = window.__topoModel;
assert(!!M, 'model exported on window.__topoModel');
assert(typeof window.__topo === 'undefined', 'DOM part skipped without a document');
assert(M.CLASSES.join('') === 'ABCD', 'four classes A to D');

/* Templates: 19 values each, normalised to max |v| = 1. */
var T = M.TEMPLATES;
M.CLASSES.forEach(function (k) {
  var mx = 0;
  T[k].forEach(function (v) { mx = Math.max(mx, Math.abs(v)); });
  assert(T[k].length === MONTAGE.length && near(mx, 1, 1e-9), 'template ' + k + ' has 19 values with max |v| = 1');
});

/* A and B are mirror images: A at (x, y) equals B at (-x, y). Every electrode has a mirror partner in the
   montage (the midline ones are their own). */
function mirrorIndex(i) {
  for (var j = 0; j < MONTAGE.length; j++) {
    if (near(MONTAGE[j].x, -MONTAGE[i].x, 1e-3) && near(MONTAGE[j].y, MONTAGE[i].y, 1e-3)) return j;
  }
  return -1;
}
var mirrorOk = true;
for (var i = 0; i < MONTAGE.length; i++) {
  var j = mirrorIndex(i);
  if (j < 0 || !near(T.A[i], T.B[j], 1e-3)) mirrorOk = false;
}
assert(mirrorOk, 'A(x, y) equals B(-x, y) for every electrode');
assert(T.A[ix('T5')] < 0 && T.A[ix('F8')] > 0, 'A runs from left-posterior negative to right-frontal positive');

/* C: anterior-posterior gradient, zero on the central line. */
assert(T.C[ix('Fz')] > 0 && T.C[ix('Fp1')] > 0, 'C positive at Fz and Fp1');
assert(T.C[ix('O1')] < 0 && T.C[ix('O2')] < 0 && T.C[ix('Pz')] < 0, 'C negative over the occipital region');
assert(near(T.C[ix('Cz')], 0, 1e-9) && near(T.C[ix('T3')], 0, 1e-9), 'C zero on the central line');

/* D: fronto-central maximum with a weaker occipital pole of opposite sign. */
var dMax = 0;
T.D.forEach(function (v, k) { if (v > T.D[dMax]) dMax = k; });
assert(['Fz', 'Cz', 'F3', 'F4'].indexOf(MONTAGE[dMax].name) >= 0, 'D maximum is fronto-central (' + MONTAGE[dMax].name + ')');
assert(T.D[ix('O1')] < 0 && Math.abs(T.D[ix('O1')]) < T.D[dMax], 'D occipital pole is negative and weaker');

/* Sequence: every class appears, no adjacent repeats (including the wrap), realistic durations. */
var S = M.SEQUENCE;
var seen = {}, adjacentOk = true, durOk = true;
S.forEach(function (seg, k) {
  seen[seg.cls] = true;
  if (seg.cls === S[(k + 1) % S.length].cls) adjacentOk = false;
  if (seg.dur < 60 || seg.dur > 120) durOk = false;
});
assert(M.CLASSES.every(function (c) { return seen[c]; }), 'sequence contains all four classes');
assert(adjacentOk, 'no two adjacent segments share a class, wrap included');
assert(durOk, 'every segment lasts 60-120 ms');

/* Colormap: the classic diverging voltage map, blue through the neutral to red. */
var P = M.PALETTES;
assert(P.light.blue === '#2456c7' && P.light.red === '#c8323a', 'light palette is #2456c7 to #c8323a');
assert(P.dark.blue === '#4f7ee8' && P.dark.red === '#e05a5a', 'dark palette is #4f7ee8 to #e05a5a');
/* The neutral is the --surface-2 token, which only a browser can resolve: these two stand in for its light
   and dark values, since colormap() takes the three endpoints as arguments. */
var neutral = [240, 242, 245], blue = Lab.rgb(P.light.blue), red = Lab.rgb(P.light.red);
function same(a, b) { return near(a[0], b[0], 1e-9) && near(a[1], b[1], 1e-9) && near(a[2], b[2], 1e-9); }
assert(same(M.colormap(-1, neutral, blue, red), blue), 'value -1 gives the blue endpoint');
assert(same(M.colormap(0, neutral, blue, red), neutral), 'value 0 gives the neutral');
assert(same(M.colormap(1, neutral, blue, red), red), 'value +1 gives the red endpoint');
assert(same(M.colormap(-1.7, neutral, blue, red), blue) && same(M.colormap(2, neutral, blue, red), red), 'values beyond 1 clip to the endpoints');
var half = M.colormap(0.5, neutral, blue, red);
assert(same(half, [(neutral[0] + red[0]) / 2, (neutral[1] + red[1]) / 2, (neutral[2] + red[2]) / 2]), 'the ramp is linear: +0.5 is halfway to red');
var out = [0, 0, 0];
assert(M.colormap(-0.3, neutral, blue, red, out) === out, 'colormap writes into the array it is given');
var darkBlue = Lab.rgb(P.dark.blue), darkRed = Lab.rgb(P.dark.red), darkNeutral = [27, 31, 39];
assert(same(M.colormap(-1, darkNeutral, darkBlue, darkRed), darkBlue) && same(M.colormap(1, darkNeutral, darkBlue, darkRed), darkRed),
  'dark endpoints resolve the same way');
assert(!/[\u2013\u2014]/.test(JSON.stringify(P)), 'no en- or em-dashes in the palette');

/* Topography: renormalised inside the head, mask covers the head circle only, sign preserved. */
var tp = M.topography(T.A, 24, 1.05);
var mx = 0, inside = 0;
for (var gi = 0; gi < tp.field.length; gi++) if (tp.mask[gi]) { inside++; mx = Math.max(mx, Math.abs(tp.field[gi])); }
assert(tp.field.length === 576 && near(mx, 1, 1e-6), 'topography renormalised to max |v| = 1 inside the head');
assert(inside > 300 && inside < 576, 'mask covers the head circle only (' + inside + ' of 576 cells)');
/* Grid cell nearest to F8 (x 0.809, y 0.588) is positive in A, nearest to T5 negative. */
function cellAt(x, y, g, span) {
  var gx = Math.floor((x + span) / (2 * span) * g), gy = Math.floor((span - y) / (2 * span) * g);
  return gy * g + gx;
}
assert(tp.field[cellAt(0.809, 0.588, 24, 1.05)] > 0.3 && tp.field[cellAt(-0.809, -0.588, 24, 1.05)] < -0.3,
  'topography keeps the sign of the template (F8 positive, T5 negative in A)');
var tpC = M.topography(T.C, 24, 1.05);
assert(tpC.field[cellAt(0, 0.9, 24, 1.05)] > 0.5 && tpC.field[cellAt(0, -0.9, 24, 1.05)] < -0.5, 'C reads positive anterior and negative posterior on the grid');

summary('topo');
