/* Model tests for assets/js/brain.js. Run from the repository root:
     jsc tests/brain.test.js
   (JavaScriptCore's jsc, or any engine with load() and print()). */
var window = this;  /* bare engine: the modules attach to window */
load('tests/harness.js');
load('assets/js/lab.js'); load('assets/js/cortex-data.js'); load('assets/js/brain.js');

var Lab = window.Lab, DATA = window.CORTEX_DATA;
var M = window.__brainModel;
assert(!!M, 'model exported on window.__brainModel');
assert(typeof window.__brain === 'undefined', 'DOM part skipped without a document');

/* ---- the packed ICBM152 surface decodes to the right count and range ---- */
var C = M.CORTEX;
assert(C.n === DATA.n && C.n === 9531, '9 531 surface points decoded (' + C.n + ')');
assert(C.x.length === C.n && C.y.length === C.n && C.z.length === C.n && C.curv.length === C.n, 'one entry per point in every array');
var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
var cMin = Infinity, cMax = -Infinity, radMin = Infinity, radMax = -Infinity, unit = true, i, k;
var axes = [C.x, C.y, C.z];
for (i = 0; i < C.n; i++) {
  for (k = 0; k < 3; k++) {
    if (axes[k][i] < lo[k]) lo[k] = axes[k][i];
    if (axes[k][i] > hi[k]) hi[k] = axes[k][i];
  }
  if (C.curv[i] < cMin) cMin = C.curv[i];
  if (C.curv[i] > cMax) cMax = C.curv[i];
  var r = Math.sqrt(C.x[i] * C.x[i] + C.y[i] * C.y[i] + C.z[i] * C.z[i]);
  if (r < radMin) radMin = r;
  if (r > radMax) radMax = r;
  if (!near(r * C.inv[i], 1, 1e-4)) unit = false;
}
var span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
assert(near(span, 2, 0.03), 'the template is normalised: the largest extent is 2 model units (' + span.toFixed(3) + ')');
assert(Math.max(Math.abs(lo[0]), Math.abs(hi[0]), Math.abs(lo[1]), Math.abs(hi[1]), Math.abs(lo[2]), Math.abs(hi[2])) <= 1.0001,
  'no coordinate leaves the unit box');
assert(near(cMin, -1, 1e-6) && near(cMax, 1, 1e-6), 'curvature covers the full -1 to +1 range');
var deep = 0;
for (i = 0; i < C.n; i++) {
  var rr = Math.sqrt(C.x[i] * C.x[i] + C.y[i] * C.y[i] + C.z[i] * C.z[i]);
  if (rr < 0.2) deep++;
}
assert(radMin > 0 && radMax < 1.3, 'no point sits exactly at the origin, none further than the diagonal of the unit box (' + radMax.toFixed(3) + ')');
assert(deep < 0.02 * C.n, 'the cloud is a shell, not a solid: under 2 percent of it lies near the centre of the template (' + deep + ' points, the medial wall and the brain stem cut)');
assert(unit, 'the stored inverse radius normalises every point to a unit radial normal');
assert(hi[0] > 0.7 && lo[0] < -0.7 && hi[1] > 0.9 && lo[1] < -0.9, 'both hemispheres and both poles are present');

/* ---- decoding is deterministic ---- */
var again = M.decodeCortex(DATA);
var same = again.n === C.n;
for (i = 0; i < C.n && same; i++) {
  if (again.x[i] !== C.x[i] || again.y[i] !== C.y[i] || again.z[i] !== C.z[i] || again.curv[i] !== C.curv[i]) same = false;
}
assert(same, 'decoding the same packed string twice gives the same cloud');

/* ---- the MNI transform round-trips ---- */
var u = [0, 0, 0], m = [0, 0, 0], trip = true;
var probes = [[0, 0, 0], [-52, -48, 26], [60, -20, 10], [-4, 70, -30], [12, -100, 40]];
for (i = 0; i < probes.length; i++) {
  M.mniToModel(probes[i][0], probes[i][1], probes[i][2], u);
  M.modelToMni(u[0], u[1], u[2], m);
  for (k = 0; k < 3; k++) if (!near(m[k], probes[i][k], 1e-4)) trip = false;
}
assert(trip, 'MNI millimetres survive the round trip through model units');
M.mniToModel(DATA.centre[0], DATA.centre[1], DATA.centre[2], u);
assert(near(u[0], 0, 1e-9) && near(u[1], 0, 1e-9) && near(u[2], 0, 1e-9), 'the template centre maps to the origin');
M.mniToModel(-52, -48, 26, u);
M.mniToModel(-52 + DATA.scale, -48, 26, m);
assert(near(m[0] - u[0], 1, 1e-9), 'one model unit is exactly `scale` millimetres');

/* ---- the candidate zone ---- */
var Z = M.ZONE;
assert(Z.count > 500 && Z.count < 620, 'the zone covers about 555 points of the cortex (' + Z.count + ')');
var zoneLeft = true, zoneInside = true, zoneOutside = true, maxW = 0;
var seedMni = [0, 0, 0];
M.modelToMni(Z.seed[0], Z.seed[1], Z.seed[2], seedMni);
assert(near(seedMni[0], M.ZONE_MNI[0], 1e-3) && near(seedMni[1], M.ZONE_MNI[1], 1e-3) && near(seedMni[2], M.ZONE_MNI[2], 1e-3),
  'the seed sits at MNI (-52, -48, 26)');
assert(near(Z.radius * DATA.scale, M.ZONE_MM, 1e-6), 'the zone radius is 32 mm in model units');
for (i = 0; i < C.n; i++) {
  var w = Z.weight[i];
  if (w > maxW) maxW = w;
  if (w <= 0) continue;
  M.modelToMni(C.x[i], C.y[i], C.z[i], m);
  if (m[0] >= -4) zoneLeft = false;
  var dx = C.x[i] - Z.seed[0], dy = C.y[i] - Z.seed[1], dz = C.z[i] - Z.seed[2];
  var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > Z.radius + 1e-6) zoneOutside = false;
  if (d <= 0.55 * Z.radius && !near(w, 1, 1e-6)) zoneInside = false;
}
assert(zoneLeft, 'every zone point is on the left of the midline (MNI x below -4)');
assert(zoneOutside, 'no zone point lies further than 32 mm from the seed');
assert(zoneInside && near(maxW, 1, 1e-6), 'the inner 55 percent of the zone has full weight, the rim fades');
var cen = [0, 0, 0];
M.modelToMni(Z.centre[0], Z.centre[1], Z.centre[2], cen);
assert(cen[0] < -40 && cen[1] < -30 && cen[1] > -70 && cen[2] > 5 && cen[2] < 50,
  'the zone centroid sits in the left temporo-parietal cortex, MNI (' + cen.map(function (v) { return v.toFixed(0); }).join(', ') + ')');

/* ---- sources ---- */
var Sr = M.SOURCES, S = Sr.count;
assert(S === M.SOURCE_COUNT && S === 24, 'exactly 24 cortical sources (' + S + ')');
var inZone = 0, onSurface = true;
for (i = 0; i < S; i++) {
  if (Sr.zone[i] > 0) inZone++;
  var p = Sr.point[i];
  if (Sr.x[i] !== C.x[p] || Sr.y[i] !== C.y[p] || Sr.z[i] !== C.z[p]) onSurface = false;
}
assert(inZone === M.ZONE_SOURCES && inZone === 6, 'six of them sit inside the candidate zone (' + inZone + ')');
assert(onSurface, 'every source is one of the cortical surface points');
var minGap = Infinity, j;
for (i = 0; i < S; i++) {
  for (j = i + 1; j < S; j++) {
    var ax = Sr.x[i] - Sr.x[j], ay = Sr.y[i] - Sr.y[j], az = Sr.z[i] - Sr.z[j];
    var g = Math.sqrt(ax * ax + ay * ay + az * az);
    if (g < minGap) minGap = g;
  }
}
assert(minGap >= M.SOURCE_MIN_GAP, 'no two sources are closer than 0.22 model units (' + minGap.toFixed(3) + ')');
var nearestSeed = 0, bestD = Infinity;
for (i = 0; i < S; i++) {
  var sx = Sr.x[i] - Z.seed[0], sy = Sr.y[i] - Z.seed[1], sz = Sr.z[i] - Z.seed[2];
  var dd = sx * sx + sy * sy + sz * sz;
  if (dd < bestD) { bestD = dd; nearestSeed = i; }
}
assert(nearestSeed === 0, 'the first source is the point closest to the seed of the zone');
var mostAnterior = 0;
for (i = 1; i < S; i++) if (Sr.y[i] > Sr.y[mostAnterior]) mostAnterior = i;
assert(mostAnterior === M.ZONE_SOURCES, 'the first source outside the zone is the most anterior point of the cortex');
var right = 0;
for (i = 0; i < S; i++) if (Sr.x[i] > 0) right++;
assert(right > 5, 'the network is not confined to one hemisphere (' + right + ' sources on the right)');

/* ---- weights and edges ---- */
var G = M.GRAPH;
var symmetric = true, selfZero = true, positive = true;
for (i = 0; i < S; i++) {
  if (G.weight(i, i) !== 0) selfZero = false;
  for (j = 0; j < S; j++) {
    if (G.weight(i, j) !== G.weight(j, i)) symmetric = false;
    if (i !== j && !(G.weight(i, j) > 0)) positive = false;
  }
}
assert(symmetric, 'the weight matrix is symmetric');
assert(selfZero, 'the diagonal of the weight matrix is zero');
assert(positive, 'every off-diagonal weight is strictly positive');
assert(G.edges.length === M.EDGE_COUNT && G.edges.length === 52, 'the 52 strongest pairs are kept (' + G.edges.length + ')');
var sorted = true, keptMin = Infinity, dropMax = 0, seen = {};
for (i = 0; i < G.edges.length; i++) {
  var e = G.edges[i];
  if (i && G.edges[i - 1].w < e.w) sorted = false;
  if (e.w < keptMin) keptMin = e.w;
  if (!near(G.weight(e.a, e.b), e.w, 1e-12)) sorted = false;
  seen[e.a + ':' + e.b] = 1;
}
for (i = 0; i < S; i++) for (j = i + 1; j < S; j++) if (!seen[i + ':' + j] && G.weight(i, j) > dropMax) dropMax = G.weight(i, j);
assert(sorted, 'the kept edges are the strongest ones, in order, and match the matrix');
assert(keptMin >= dropMax, 'the weakest kept edge (' + keptMin.toFixed(3) + ') is at least the strongest dropped one (' + dropMax.toFixed(3) + ')');
var degSum = 0, isolated = 0;
for (i = 0; i < S; i++) { degSum += G.degree[i]; if (!G.degree[i]) isolated++; }
assert(degSum === 2 * G.edges.length && isolated === 0, 'degrees match the edge list and no source is isolated');
var zoneEdges = 0;
for (i = 0; i < G.edges.length; i++) if (G.edges[i].zone) zoneEdges++;
assert(zoneEdges === 15, 'all fifteen pairs inside the zone survive the cut (' + zoneEdges + ')');

/* ---- projection ---- */
var outA = new Float32Array(S * 3), outB = new Float32Array(S * 3);
M.project(Sr.x, Sr.y, Sr.z, S, 37, 12, outA);
M.project(Sr.x, Sr.y, Sr.z, S, 37, 12, outB);
var sameProj = true;
for (i = 0; i < outA.length; i++) if (outA[i] !== outB[i]) sameProj = false;
assert(sameProj, 'projection is deterministic');
var one = new Float32Array(3);
M.project([0, 0, 0], [1, 0, 0], [0, 0, 1], 1, 0, 0, one);
assert(near(one[0], 0, 1e-6) && near(one[1], 0, 1e-6) && near(one[2], 1, 1e-6), 'at yaw 0 the anterior axis points into the screen');
M.project([0], [0], [1], 1, M.YAW_DEFAULT, 0, one);
assert(near(one[1], -1, 1e-6), 'the superior axis projects upwards (negative screen ordinate)');
M.project([0], [1], [0], 1, M.YAW_DEFAULT, M.PITCH_DEFAULT, one);
assert(one[0] < -0.99, 'at the default yaw the frontal pole is on the left of the screen');
var pair = new Float32Array(6), half = new Float32Array(6);
M.project([-1, 1], [0, 0], [0, 0], 2, M.YAW_DEFAULT, M.PITCH_DEFAULT, pair);
assert(pair[2] < 0 && pair[5] > 0 && near(pair[2], -pair[5], 1e-6), 'the left hemisphere is nearer the camera than the right one');
M.project([-1, 1], [0, 0], [0, 0], 2, M.YAW_DEFAULT + 180, M.PITCH_DEFAULT, half);
assert(near(half[2], pair[5], 1e-5) && near(half[5], pair[2], 1e-5), 'half a turn later the two swap depth');
var cloudA = new Float32Array(C.n * 3);
M.project(C.x, C.y, C.z, C.n, M.YAW_DEFAULT, M.PITCH_DEFAULT, cloudA);
var lateral = 0, medial = 0;
for (i = 0; i < C.n; i++) {
  if (C.x[i] < -0.55) lateral += cloudA[i * 3 + 2];
  if (C.x[i] > 0.55) medial += cloudA[i * 3 + 2];
}
assert(lateral < 0 && medial > 0, 'the mean depth of the two lateral surfaces has the sign the camera implies');
var rise = new Float32Array(3), flat = new Float32Array(3);
M.project([0], [0], [1], 1, M.YAW_DEFAULT, 0, flat);
M.project([0], [0], [1], 1, M.YAW_DEFAULT, 30, rise);
assert(rise[2] < flat[2], 'raising the camera brings the vertex nearer');

/* ---- shading ---- */
var monotone = true, prev = -1;
for (i = 0; i <= 40; i++) {
  var curv = -1 + i * 0.05;
  var v = M.shade(0.7, curv, 0.8);
  if (v < prev - 1e-12) monotone = false;
  prev = v;
}
assert(monotone, 'the tone never falls as the curvature rises from a sulcus to a gyral crown');
assert(M.shade(0.7, -0.5, 0.8) < M.shade(0.7, 0.5, 0.8), 'a gyral crown is brighter than a sulcus');
assert(near(M.shade(0.7, -0.2, 0.8), M.shade(0.7, -0.9, 0.8), 1e-9), 'the curvature term saturates below -0.10');
assert(near(M.shade(0.7, 0.2, 0.8), M.shade(0.7, 0.9, 0.8), 1e-9), 'and above +0.10');
assert(M.shade(0, 1, 1) > 0 && M.shade(1, 1, 1) <= 1, 'an unlit point keeps some ambient tone, a fully lit one stays in range');
assert(M.shade(1, 1, 0) < M.shade(1, 1, 1), 'the far side of the cortex is dimmer than the near side');
assert(M.shade(0.2, 0, 0.5) < M.shade(0.9, 0, 0.5), 'more light gives more tone');
var lit = 0, unlitPoint = 0;
for (i = 0; i < C.n; i++) if (C.curv[i] > 0) lit++; else unlitPoint++;
assert(lit > 0.3 * C.n && unlitPoint > 0.3 * C.n, 'the surface carries both crowns and sulci in quantity');

summary('brain');
