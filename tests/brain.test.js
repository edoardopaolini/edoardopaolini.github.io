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

/* ---- the packed ICBM152 mesh decodes to the counts its header declares ---- */
var C = M.CORTEX, i, j, k;
assert(C.n === DATA.vertices && C.n === 1284, '1 284 vertices decoded (' + C.n + ')');
assert(C.faceCount === DATA.faces && C.faceCount === 2560, '2 560 triangles decoded (' + C.faceCount + ')');
assert(C.sources.length === DATA.sources && C.sources.length === 24, '24 source indices decoded (' + C.sources.length + ')');
assert(C.x.length === C.n && C.y.length === C.n && C.z.length === C.n &&
  C.nx.length === C.n && C.ny.length === C.n && C.nz.length === C.n &&
  C.curv.length === C.n && C.zone.length === C.n, 'one entry per vertex in every array');
assert(C.faces.length === 3 * C.faceCount, 'three vertex indices per triangle');

/* ---- decoded ranges ---- */
var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
var cMin = Infinity, cMax = -Infinity, zMin = Infinity, zMax = -Infinity;
var nMin = Infinity, nMax = -Infinity, radMax = -Infinity;
var axes = [C.x, C.y, C.z], crowns = 0, sulci = 0;
for (i = 0; i < C.n; i++) {
  for (k = 0; k < 3; k++) {
    if (axes[k][i] < lo[k]) lo[k] = axes[k][i];
    if (axes[k][i] > hi[k]) hi[k] = axes[k][i];
  }
  if (C.curv[i] < cMin) cMin = C.curv[i];
  if (C.curv[i] > cMax) cMax = C.curv[i];
  if (C.curv[i] > 0) crowns++; else sulci++;
  if (C.zone[i] < zMin) zMin = C.zone[i];
  if (C.zone[i] > zMax) zMax = C.zone[i];
  var nl = Math.sqrt(C.nx[i] * C.nx[i] + C.ny[i] * C.ny[i] + C.nz[i] * C.nz[i]);
  if (nl < nMin) nMin = nl;
  if (nl > nMax) nMax = nl;
  var r = Math.sqrt(C.x[i] * C.x[i] + C.y[i] * C.y[i] + C.z[i] * C.z[i]);
  if (r > radMax) radMax = r;
}
var span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
/* The smoothed template is a little smaller than the folded one, and `scale` stays the anatomical scale so
   that MNI conversion is exact, which is why the extent is under 2 rather than exactly 2. */
assert(span > 1.7 && span < 2.0, 'the template is normalised close to the unit box (largest extent ' + span.toFixed(3) + ')');
assert(Math.max(Math.abs(lo[0]), Math.abs(hi[0]), Math.abs(lo[1]), Math.abs(hi[1]), Math.abs(lo[2]), Math.abs(hi[2])) <= 1.0001,
  'no coordinate leaves the unit box');
assert(radMax < 1.3, 'no vertex sits further than the diagonal of the unit box (' + radMax.toFixed(3) + ')');
assert(hi[0] > 0.6 && lo[0] < -0.6 && hi[1] > 0.8 && lo[1] < -0.9, 'both hemispheres and both poles are present');
assert(near(nMin, 1, 0.01) && near(nMax, 1, 0.01),
  'every stored normal is a unit vector within the byte quantisation (' + nMin.toFixed(4) + ' to ' + nMax.toFixed(4) + ')');
assert(cMin >= -1 && cMax <= 1 && cMin < -0.4 && cMax > 0.4,
  'curvature stays inside -1 to +1 and uses the band (' + cMin.toFixed(3) + ' to ' + cMax.toFixed(3) + ')');
assert(crowns > 0.3 * C.n && sulci > 0.3 * C.n, 'the surface carries both crowns and sulci in quantity');
assert(zMin === 0 && near(zMax, 1, 1e-6), 'the zone weight covers 0 to 1');

/* ---- decoding is deterministic ---- */
var again = M.decodeCortex(DATA);
var same = again.n === C.n && again.faceCount === C.faceCount;
for (i = 0; i < C.n && same; i++) {
  if (again.x[i] !== C.x[i] || again.y[i] !== C.y[i] || again.z[i] !== C.z[i] ||
    again.nx[i] !== C.nx[i] || again.curv[i] !== C.curv[i] || again.zone[i] !== C.zone[i]) same = false;
}
for (i = 0; i < C.faces.length && same; i++) if (again.faces[i] !== C.faces[i]) same = false;
assert(same, 'decoding the same packed string twice gives the same mesh');

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

/* ---- the candidate zone, packed with the mesh ---- */
var Z = M.ZONE;
var above0 = 0, aboveOn = 0, zoneLeft = true;
for (i = 0; i < C.n; i++) {
  if (C.zone[i] <= 0) continue;
  above0++;
  if (C.zone[i] > M.ZONE_ON) aboveOn++;
  M.modelToMni(C.x[i], C.y[i], C.z[i], m);
  if (m[0] >= -4) zoneLeft = false;
}
assert(above0 === 77 && Z.count === 77, '77 vertices carry the candidate zone (' + above0 + ')');
assert(aboveOn === 57, '57 of them are above the ' + M.ZONE_ON + ' weight that counts as inside (' + aboveOn + ')');
assert(zoneLeft, 'every zone vertex is on the left of the midline (MNI x below -4)');
assert(near(Z.radius * DATA.scale, M.ZONE_MM, 1e-6), 'the zone radius is 32 mm in model units');
var cen = [0, 0, 0];
M.modelToMni(Z.centre[0], Z.centre[1], Z.centre[2], cen);
assert(cen[0] < -40 && cen[1] < -30 && cen[1] > -70 && cen[2] > 5 && cen[2] < 50,
  'the zone centroid sits in the left temporo-parietal cortex, MNI (' + cen.map(function (v) { return v.toFixed(0); }).join(', ') + ')');
M.mniToModel(M.ZONE_MNI[0], M.ZONE_MNI[1], M.ZONE_MNI[2], u);
var seedGap = Math.sqrt(Math.pow(Z.centre[0] - u[0], 2) + Math.pow(Z.centre[1] - u[1], 2) +
  Math.pow(Z.centre[2] - u[2], 2)) * DATA.scale;
assert(seedGap < 10, 'the centroid stays within 10 mm of the MNI seed the patch was grown from (' + seedGap.toFixed(1) + ' mm)');

/* ---- sources ---- */
var Sr = M.SOURCES, S = Sr.count;
assert(S === 24, 'exactly 24 cortical sources (' + S + ')');
var inZone = 0, onSurface = true, indexOk = true;
for (i = 0; i < S; i++) {
  if (Sr.inZone[i]) inZone++;
  var p = Sr.point[i];
  if (!(p >= 0 && p < C.n)) indexOk = false;
  else if (Sr.x[i] !== C.x[p] || Sr.y[i] !== C.y[p] || Sr.z[i] !== C.z[p] || Sr.zone[i] !== C.zone[p]) onSurface = false;
}
assert(indexOk, 'every source index addresses a vertex of the mesh');
assert(inZone === 6, 'six of them sit inside the candidate zone (' + inZone + ')');
assert(onSurface, 'a source carries the position and the zone weight of its vertex');
var minGap = Infinity;
for (i = 0; i < S; i++) {
  for (j = i + 1; j < S; j++) {
    var ax = Sr.x[i] - Sr.x[j], ay = Sr.y[i] - Sr.y[j], az = Sr.z[i] - Sr.z[j];
    var g = Math.sqrt(ax * ax + ay * ay + az * az);
    if (g < minGap) minGap = g;
  }
}
assert(minGap >= 0.25, 'no two sources are closer than 0.25 model units (' + minGap.toFixed(3) + ')');
var right = 0;
for (i = 0; i < S; i++) if (Sr.x[i] > 0) right++;
assert(right > 5, 'the network is not confined to one hemisphere (' + right + ' sources on the right)');

/* ---- the mesh is a pair of closed surfaces ---- */
var faceOk = true, degenerate = 0;
for (i = 0; i < C.faceCount; i++) {
  var a = C.faces[i * 3], b = C.faces[i * 3 + 1], c = C.faces[i * 3 + 2];
  if (!(a >= 0 && a < C.n && b >= 0 && b < C.n && c >= 0 && c < C.n)) faceOk = false;
  if (a === b || b === c || a === c) degenerate++;
}
assert(faceOk, 'every face index addresses a vertex of the mesh');
assert(degenerate === 0, 'no triangle repeats a vertex');
var edgeUse = {}, edgeCount = 0, shared = 0, dangling = 0;
for (i = 0; i < C.faceCount; i++) {
  var t3 = i * 3, v = [C.faces[t3], C.faces[t3 + 1], C.faces[t3 + 2]];
  for (k = 0; k < 3; k++) {
    var p1 = v[k], p2 = v[(k + 1) % 3];
    var key = (p1 < p2 ? p1 : p2) * C.n + (p1 < p2 ? p2 : p1);
    if (edgeUse[key] === undefined) { edgeUse[key] = 1; edgeCount++; } else edgeUse[key]++;
  }
}
for (var key in edgeUse) { if (edgeUse[key] === 2) shared++; else dangling++; }
assert(dangling === 0 && shared === edgeCount, 'the mesh is closed: every one of the ' + edgeCount + ' edges is shared by exactly two faces');
assert(C.n - edgeCount + C.faceCount === 4,
  'Euler holds for two closed surfaces: V - E + F = ' + (C.n - edgeCount + C.faceCount));

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
var norm = new Float32Array(3);
M.project([0.6], [0], [0.8], 1, 143, 27, norm);
assert(near(Math.sqrt(norm[0] * norm[0] + norm[1] * norm[1] + norm[2] * norm[2]), 1, 1e-6),
  'the projection is a rotation, so it carries the normals without changing their length');
var pair = new Float32Array(6), half = new Float32Array(6);
M.project([-1, 1], [0, 0], [0, 0], 2, M.YAW_DEFAULT, M.PITCH_DEFAULT, pair);
assert(pair[2] < 0 && pair[5] > 0 && near(pair[2], -pair[5], 1e-6), 'the left hemisphere is nearer the camera than the right one');
M.project([-1, 1], [0, 0], [0, 0], 2, M.YAW_DEFAULT + 180, M.PITCH_DEFAULT, half);
assert(near(half[2], pair[5], 1e-5) && near(half[5], pair[2], 1e-5), 'half a turn later the two swap depth');
var mesh = new Float32Array(C.n * 3);
M.project(C.x, C.y, C.z, C.n, M.YAW_DEFAULT, M.PITCH_DEFAULT, mesh);
var lateral = 0, medial = 0;
for (i = 0; i < C.n; i++) {
  if (C.x[i] < -0.55) lateral += mesh[i * 3 + 2];
  if (C.x[i] > 0.55) medial += mesh[i * 3 + 2];
}
assert(lateral < 0 && medial > 0, 'the mean depth of the two lateral surfaces has the sign the camera implies');
/* Culling reads the sign of the screen area of a triangle, which is only a backface test if every face is
   wound outwards; the decoder turns the mirrored hemisphere round for that. */
var outward = 0;
for (i = 0; i < C.faceCount; i++) {
  var f3 = i * 3, fa = C.faces[f3], fb = C.faces[f3 + 1], fc = C.faces[f3 + 2];
  var ux = C.x[fb] - C.x[fa], uy = C.y[fb] - C.y[fa], uz = C.z[fb] - C.z[fa];
  var wx = C.x[fc] - C.x[fa], wy = C.y[fc] - C.y[fa], wz = C.z[fc] - C.z[fa];
  if ((uy * wz - uz * wy) * (C.nx[fa] + C.nx[fb] + C.nx[fc]) +
    (uz * wx - ux * wz) * (C.ny[fa] + C.ny[fb] + C.ny[fc]) +
    (ux * wy - uy * wx) * (C.nz[fa] + C.nz[fb] + C.nz[fc]) > 0) outward++;
}
assert(outward === C.faceCount, 'every triangle is wound outwards (' + outward + ' of ' + C.faceCount + ')');
var facing = 0;
for (i = 0; i < C.faceCount; i++) {
  var g3 = i * 3, ga = C.faces[g3] * 3, gb = C.faces[g3 + 1] * 3, gc = C.faces[g3 + 2] * 3;
  if ((mesh[gb] - mesh[ga]) * (mesh[gc + 1] - mesh[ga + 1]) -
    (mesh[gb + 1] - mesh[ga + 1]) * (mesh[gc] - mesh[ga]) < 0) facing++;
}
assert(facing > 0.4 * C.faceCount && facing < 0.6 * C.faceCount,
  'about half the triangles face the camera at the default view (' + facing + ' of ' + C.faceCount + ')');
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
assert(near(M.shade(0.7, -0.2, 0.8), M.shade(0.7, -0.9, 0.8), 1e-9), 'the curvature term saturates below the sulcal end of its band');
assert(near(M.shade(0.7, 0.2, 0.8), M.shade(0.7, 0.9, 0.8), 1e-9), 'and above the gyral end of it');
assert(near(M.shade(1, 1, 1), 1, 1e-9), 'a lit crown at the front of the mesh reaches the top of the range');
assert(near(M.shade(0, -1, 0), M.AMBIENT * M.SUL_MIN * M.DEPTH_FLOOR, 1e-9), 'an unlit sulcus at the back keeps the ambient floor');
assert(M.shade(1, 1, 0) < M.shade(1, 1, 1), 'the far side of the cortex is dimmer than the near side');
assert(M.shade(0.2, 0, 0.5) < M.shade(0.9, 0, 0.5), 'more light gives more tone');
/* Clamping matters: the lambert term of a face can go negative near the silhouette. */
assert(M.shade(-0.5, 0, 0.5) === M.shade(0, 0, 0.5), 'a face turned away from the light gets no negative tone');

summary('brain');
