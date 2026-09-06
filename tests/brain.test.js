/* Model tests for assets/js/brain.js. Run from the repository root:
     jsc tests/brain.test.js
   (JavaScriptCore's jsc, or any engine with load() and print()). */
var window = this;  /* bare engine: the modules attach to window */
load('tests/harness.js');
load('assets/js/lab.js'); load('assets/js/brain.js');

var Lab = window.Lab, MONTAGE = Lab.MONTAGE, N = MONTAGE.length, ix = Lab.electrodeIndex;
var M = window.__brainModel;
assert(!!M, 'model exported on window.__brainModel');
assert(typeof window.__brain === 'undefined', 'DOM part skipped without a document');

/* ---- surface: star-shaped body, every direction meets it once, gyri displacement is small ---- */
var dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 0], [0, -1, 0], [0.6, 0.6, 0.529]];
var starOk = true, gyriOk = true;
dirs.forEach(function (d) {
  var r0 = M.shapeRadius(d[0], d[1], d[2]), r = M.surfaceRadius(d[0], d[1], d[2]);
  if (!(r0 > 0.3 && r0 < 1)) starOk = false;
  if (Math.abs(r / r0 - 1) > 0.05) gyriOk = false;
});
assert(starOk, 'smooth radius stays between 0.3 and 1 body units in every direction');
assert(gyriOk, 'gyri displace the surface by less than 5 percent');
assert(M.shapeRadius(0, 1, 0) > M.shapeRadius(1, 0, 0) && M.shapeRadius(1, 0, 0) > M.shapeRadius(0, 0, 1), 'the body is longer than wide and wider than tall');
assert(M.shapeRadius(0, 0, -1) < M.shapeRadius(0, 0, 1), 'the lower half is flatter than the upper half');
assert(M.shapeRadius(0.707, 0.707, 0) < M.shapeRadius(0.707, -0.707, 0), 'the frontal region is narrower than the parietal one');

/* ---- sampling: deterministic, the requested count, no point inside the medial fissure ---- */
var cloud = M.samplePoints(M.POINT_COUNT, M.POINT_SEED);
var cloud2 = M.samplePoints(M.POINT_COUNT, M.POINT_SEED);
assert(cloud.count === M.POINT_COUNT && cloud.pos.length === M.POINT_COUNT * 3, 'about 1 400 surface points sampled (' + cloud.count + ')');
var sameCloud = true;
for (var i = 0; i < cloud.pos.length; i++) if (cloud.pos[i] !== cloud2.pos[i]) sameCloud = false;
assert(sameCloud, 'sampling is deterministic for a given seed');
var onSurface = true, inFissure = 0, left = 0, right = 0, unitNormals = true, outward = true;
for (i = 0; i < cloud.count; i++) {
  var o = i * 3, x = cloud.pos[o], y = cloud.pos[o + 1], z = cloud.pos[o + 2];
  var l = Math.sqrt(x * x + y * y + z * z);
  if (!near(l, M.surfaceRadius(x / l, y / l, z / l), 1e-5)) onSurface = false;
  if (Math.abs(x) < 0.035 && z > -0.15) inFissure++;
  if (x < 0) left++; else right++;
  var nx = cloud.nor[o], ny = cloud.nor[o + 1], nz = cloud.nor[o + 2];
  if (!near(nx * nx + ny * ny + nz * nz, 1, 1e-4)) unitNormals = false;
  if (nx * x + ny * y + nz * z <= 0) outward = false;
}
assert(onSurface, 'every sampled point lies on the displaced surface');
assert(inFissure === 0, 'no sampled point inside the medial fissure');
assert(left > 0.4 * cloud.count && right > 0.4 * cloud.count, 'both hemispheres are populated (' + left + ' left, ' + right + ' right)');
assert(unitNormals && outward, 'normals are unit length and point outward');

/* ---- montage placement: all 19 electrodes on the surface, azimuth kept, elevation from the radius ---- */
var E = M.ELECTRODES.pos, allOn = true, roundTrip = true, dir = new Float64Array(3), mt = [0, 0];
for (var k = 0; k < N; k++) {
  var px = E[k * 3], py = E[k * 3 + 1], pz = E[k * 3 + 2];
  var pl = Math.sqrt(px * px + py * py + pz * pz);
  if (!near(pl, M.surfaceRadius(px / pl, py / pl, pz / pl), 1e-5)) allOn = false;
  M.directionToMontage(px / pl, py / pl, pz / pl, mt);
  if (!near(mt[0], MONTAGE[k].x, 1e-3) || !near(mt[1], MONTAGE[k].y, 1e-3)) roundTrip = false;
}
assert(allOn, 'all 19 electrodes lie on the surface within 1e-5');
assert(roundTrip, 'electrode directions map back to their montage coordinates');
M.montageToDirection(0, 0, dir, 0);
assert(near(dir[2], 1, 1e-9), 'montage radius 0 is the vertex');
M.montageToDirection(0, 1, dir, 0);
assert(near(Math.asin(dir[2]) * 180 / Math.PI, M.ELEVATION_RING, 1e-9) && dir[1] > 0.98, 'montage radius 1 sits 10 degrees above the widest part, azimuth kept');
assert(E[ix('Cz') * 3 + 2] > E[ix('T3') * 3 + 2] && E[ix('C3') * 3 + 2] > E[ix('T3') * 3 + 2], 'Cz and C3 sit higher than T3');
assert(E[ix('T3') * 3] < 0 && E[ix('T4') * 3] > 0 && near(E[ix('Fz') * 3], 0, 1e-6), 'T3 is left, T4 right, Fz on the midline');
assert(E[ix('Fp1') * 3 + 1] > 0 && E[ix('O1') * 3 + 1] < 0, 'Fp1 is anterior, O1 posterior');

/* ---- cluster hull membership ---- */
assert(M.CLUSTER_NAMES.join(',') === 'T3,T5,C3,P3,F7', 'cluster is T3, T5, C3, P3, F7');
var H = M.CLUSTER_HULL;
assert(H.length === 5, 'all five cluster electrodes are hull vertices');
var insideOk = M.CLUSTER_NAMES.every(function (n) { return M.hullDistance(H, MONTAGE[ix(n)].x, MONTAGE[ix(n)].y) === 0; });
assert(insideOk, 'every cluster electrode is inside the hull (distance 0)');
var zoneOk = M.CLUSTER_NAMES.every(function (n) { return M.zoneWeight(MONTAGE[ix(n)].x, MONTAGE[ix(n)].y) > 0; });
assert(zoneOk, 'every cluster electrode has a positive zone weight');
var outsideOk = ['Fp2', 'F8', 'C4', 'T4', 'T6', 'O2', 'P4', 'F4', 'Fz'].every(function (n) {
  return M.hullDistance(H, MONTAGE[ix(n)].x, MONTAGE[ix(n)].y) > M.ZONE_PAD && M.zoneWeight(MONTAGE[ix(n)].x, MONTAGE[ix(n)].y) === 0;
});
assert(outsideOk, 'right-side and midline electrodes are outside the zone');
assert(M.hullDistance(H, -0.6, 0) === 0 && M.hullDistance(H, 0.6, 0) > 0.5, 'a point between T3 and C3 is inside, its mirror is far outside');
var centreW = M.zoneWeight(-0.7, 0), edgeW = M.zoneWeight(-0.35, -0.42);
assert(centreW > edgeW && edgeW > 0, 'zone weight falls off from the centre of the cluster to its rim');
var zoneCount = 0;
for (i = 0; i < cloud.count; i++) if (cloud.zone[i] > 0) zoneCount++;
assert(zoneCount > 60 && zoneCount < 400, 'the zone covers a patch of the point cloud (' + zoneCount + ' points)');
var zoneLeft = true;
for (i = 0; i < cloud.count; i++) if (cloud.zone[i] > 0 && cloud.pos[i * 3] > 0.05) zoneLeft = false;
assert(zoneLeft, 'zone points are all on the left hemisphere');
var sq = M.hull([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.5, y: 0.5 }]);
assert(sq.length === 4 && M.hullDistance(sq, 0.5, 0.5) === 0 && near(M.hullDistance(sq, 1.5, 0.5), 0.5, 1e-9), 'hull and hull distance on a square');

/* ---- graph: unchanged toy graph, symmetric weights ---- */
var G = M.GRAPH;
var strong = G.edges.filter(function (e) { return e.strong; });
var weak = G.edges.filter(function (e) { return !e.strong; });
assert(strong.length === 10, 'all ten cluster pairs are edges');
var minStrong = Math.min.apply(null, strong.map(function (e) { return e.w; }));
var maxWeak = Math.max.apply(null, weak.map(function (e) { return e.w; }));
assert(minStrong > maxWeak, 'weakest cluster edge (' + minStrong.toFixed(2) + ') beats the strongest other edge (' + maxWeak.toFixed(2) + ')');
var symmetric = true, consistent = true, selfZero = true;
for (i = 0; i < N; i++) {
  if (G.weight(i, i) !== 0) selfZero = false;
  for (var j = 0; j < N; j++) if (G.weight(i, j) !== G.weight(j, i)) symmetric = false;
}
G.edges.forEach(function (e) { if (!near(G.weight(e.a, e.b), e.w, 1e-6) || e.w <= 0 || e.w > 1) consistent = false; });
assert(symmetric, 'weights are symmetric');
assert(selfZero && consistent, 'no self weights, the matrix matches the edge list, weights in (0, 1]');
assert(G.weight(ix('Fp1'), ix('O2')) === 0, 'no edge between Fp1 and O2');
var degree = MONTAGE.map(function () { return 0; });
G.edges.forEach(function (e) { degree[e.a]++; degree[e.b]++; });
assert(degree.join(',') === G.degree.join(',') && G.degree.every(function (d) { return d > 0; }), 'degrees match the edge list, no isolated electrode');

/* ---- edge arcs: start and end on the electrodes, midpoint lifted above the surface ---- */
var K = M.EDGE_SEGMENTS, arcsOk = true, liftedOk = true;
G.edges.forEach(function (e, idx) {
  var o0 = idx * (K + 1) * 3, o1 = (idx * (K + 1) + K) * 3, om = (idx * (K + 1) + K / 2) * 3;
  if (!near(M.EDGE_POINTS[o0], E[e.a * 3], 1e-5) || !near(M.EDGE_POINTS[o1 + 1], E[e.b * 3 + 1], 1e-5)) arcsOk = false;
  var mx = M.EDGE_POINTS[om], my = M.EDGE_POINTS[om + 1], mz = M.EDGE_POINTS[om + 2];
  var ml = Math.sqrt(mx * mx + my * my + mz * mz);
  if (ml <= M.surfaceRadius(mx / ml, my / ml, mz / ml) * 1.04) liftedOk = false;
});
assert(arcsOk, 'every arc starts and ends on its electrodes');
assert(liftedOk, 'every arc midpoint is lifted above the surface');

/* ---- projection: deterministic, depth ordering consistent with the view ---- */
var outA = new Float32Array(N * 3), outB = new Float32Array(N * 3);
M.project(E, N, 37, M.PITCH, outA);
M.project(E, N, 37, M.PITCH, outB);
var sameProj = true;
for (i = 0; i < outA.length; i++) if (outA[i] !== outB[i]) sameProj = false;
assert(sameProj, 'projection is deterministic');
M.project(E, N, 0, M.PITCH, outA);
assert(outA[ix('T3') * 3 + 2] > outA[ix('T4') * 3 + 2], 'at yaw 0 the left hemisphere faces the viewer (T3 closer than T4)');
assert(outA[ix('Fp1') * 3] < outA[ix('O1') * 3], 'at yaw 0 the frontal pole is on the left of the screen');
assert(outA[ix('Cz') * 3 + 1] > outA[ix('T3') * 3 + 1], 'Cz projects above T3');
M.project(E, N, 180, M.PITCH, outB);
assert(outB[ix('T4') * 3 + 2] > outB[ix('T3') * 3 + 2], 'half a turn later T4 is the closer one');
assert(near(outA[ix('T3') * 3 + 2], outB[ix('T4') * 3 + 2], 0.02), 'mirror electrodes swap depth across a half turn');
M.project(E, N, 90, M.PITCH, outB);
assert(outB[ix('Fp1') * 3 + 2] > outB[ix('O1') * 3 + 2], 'at yaw 90 the face is towards the viewer');
var rot = new Float32Array(N * 3);
M.rotate(M.ELECTRODES.nor, N, 0, M.PITCH, rot);
assert(rot[ix('T3') * 3 + 2] > 0.8 && rot[ix('T4') * 3 + 2] < -0.5, 'at yaw 0 the T3 normal faces the viewer and the T4 normal faces away');
var dz = 0;
M.project(E, N, 0, 0, outA); M.project(E, N, 0, 30, outB);
dz = outB[ix('Cz') * 3 + 2] - outA[ix('Cz') * 3 + 2];
assert(dz > 0, 'raising the camera brings the vertex closer');
assert(!/[\u2013\u2014]/.test(JSON.stringify(M.CLUSTER_NAMES)), 'no en- or em-dashes in the model strings');

summary('brain');
