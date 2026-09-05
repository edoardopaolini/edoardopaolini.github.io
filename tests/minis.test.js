/* Model tests for assets/js/minis.js. Run from the repository root with jsc (any engine with load() works):
   jsc tests/minis.test.js */
var window = this;  // bare engine: the modules attach to window
load('assets/js/lab.js'); load('assets/js/minis.js');

var passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; print('PASS ' + msg); } else { failed++; print('FAIL ' + msg); }
}
function near(a, b, eps) { return Math.abs(a - b) <= eps; }

var Lab = window.Lab, MONTAGE = Lab.MONTAGE, ix = Lab.electrodeIndex;
var M = window.__minisModel;
assert(!!M, 'model exported on window.__minisModel');
assert(typeof window.__minis === 'undefined', 'DOM part skipped without a document');

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

/* Hull on known point sets. */
var square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.7 }];
var h = M.hull(square);
var corners = h.every(function (p) { return (p.x === 0 || p.x === 1) && (p.y === 0 || p.y === 1); });
assert(h.length === 4 && corners, 'hull of a square with interior points is its four corners');
var signedArea = 0;
h.forEach(function (p, k) { var q = h[(k + 1) % h.length]; signedArea += p.x * q.y - q.x * p.y; });
assert(signedArea > 0, 'hull vertices are in counter-clockwise order');
assert(M.hull([]).length === 0 && M.hull([{ x: 1, y: 2 }]).length === 1, 'hull of empty is empty, of one point is itself');
assert(M.hull([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]).length === 2, 'collinear hull is the two end points');
assert(square[0].x === 0 && square[1].x === 1, 'hull leaves its input untouched');

/* Outline: one arc per vertex, each sweeping less than a half turn (convex corners). */
var arcs = M.outline(h, 14);
var sweepsOk = arcs.every(function (a) {
  var d = a.a1 - a.a0;
  while (d < 0) d += 2 * Math.PI;
  return a.pad === 14 && d < Math.PI;
});
assert(arcs.length === 4 && sweepsOk, 'outline has one arc per vertex, padded, sweeping less than a half turn');

/* Graph: the cluster T3, T5, C3, P3, F7 is fully connected and carries the highest weights. */
var G = M.GRAPH;
assert(M.CLUSTER.join(',') === 'T3,T5,C3,P3,F7', 'cluster is T3, T5, C3, P3, F7');
var strong = G.edges.filter(function (e) { return e.strong; });
var weak = G.edges.filter(function (e) { return !e.strong; });
assert(strong.length === 10, 'all ten cluster pairs are edges');
var strongInCluster = strong.every(function (e) { return G.inCluster[e.a] && G.inCluster[e.b]; });
assert(strongInCluster, 'strong edges join cluster electrodes only');
var minStrong = Math.min.apply(null, strong.map(function (e) { return e.w; }));
var maxWeak = Math.max.apply(null, weak.map(function (e) { return e.w; }));
assert(minStrong > maxWeak, 'weakest cluster edge (' + minStrong.toFixed(2) + ') beats the strongest other edge (' + maxWeak.toFixed(2) + ')');
assert(G.edges.every(function (e) { return e.w > 0 && e.w <= 1; }), 'edge weights lie in (0, 1]');
var farEdge = G.edges.some(function (e) { return e.a === ix('Fp1') && e.b === ix('O2'); });
assert(!farEdge, 'no edge between Fp1 and O2');

/* Degrees are consistent with the edge list, no isolated node. */
var degree = MONTAGE.map(function () { return 0; });
G.edges.forEach(function (e) { degree[e.a]++; degree[e.b]++; });
assert(degree.join(',') === G.degree.join(','), 'degrees match the edge list');
assert(G.degree.every(function (d) { return d > 0; }), 'no isolated electrode');

/* Topography: renormalised inside the head, mask covers the head circle only. */
var tp = M.topography(T.A, 24, 1.05);
var mx = 0, inside = 0;
for (var gi = 0; gi < tp.field.length; gi++) if (tp.mask[gi]) { inside++; mx = Math.max(mx, Math.abs(tp.field[gi])); }
assert(tp.field.length === 576 && near(mx, 1, 1e-6), 'topography renormalised to max |v| = 1 inside the head');
assert(inside > 300 && inside < 576, 'mask covers the head circle only (' + inside + ' of 576 cells)');

print(passed + ' passed, ' + failed + ' failed');
if (failed) throw new Error('minis model tests failed');
