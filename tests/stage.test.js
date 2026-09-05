/* Model tests for assets/js/stage.js. Run from the repository root:
     jsc tests/stage.test.js
   (JavaScriptCore's jsc, or any engine with load() and print()). */
var window = this;  // bare engine: the modules attach to window
load('assets/js/lab.js'); load('assets/js/stage.js');

var M = window.__stageModel, Lab = window.Lab;
var N = M.N, BUF = M.BUF, CORR_N = M.CORR_N;
var failed = 0;
function assert(cond, msg) {
  print((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function reactionIndex(from, to) {
  for (var i = 0; i < M.REACTIONS.length; i++) if (M.REACTIONS[i].label === from + ' to ' + to) return i;
  return -1;
}
function mask(knocked) {
  var m = [];
  for (var i = 0; i < M.REACTIONS.length; i++) m.push(knocked.indexOf(i) < 0 ? 1 : 0);
  return m;
}

/* ---- module shape ---- */
assert(!!M && typeof window.__stage === 'undefined', 'model exported, DOM part skipped without document');
assert(N === 19 && M.P === 171 && M.METABOLITES.length === 19 && M.REACTIONS.length === 23, '19 electrodes, 171 pairs, 19 metabolites, 23 reactions');
assert(M.METABOLITES[0] === 'glucose' && M.METABOLITES[18] === 'OAA', 'metabolite order starts at glucose and ends at OAA');

/* ---- Pearson correlation against the textbook formula ---- */
(function () {
  var a = [1, 0, 1, 0, 1, 0, 2, 1], b = [0, 1, 0, 1, 0, 1, 1, 2], n = a.length, ma = 0, mb = 0, i;
  for (i = 0; i < n; i++) { ma += a[i] / n; mb += b[i] / n; }
  var num = 0, da = 0, db = 0;
  for (i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) * (a[i] - ma); db += (b[i] - mb) * (b[i] - mb); }
  assert(near(M.pearson(a, b), num / Math.sqrt(da * db), 1e-12), 'pearson matches the covariance formula');
})();
assert(near(M.pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1, 1e-12) && near(M.pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1, 1e-12), 'pearson is 1 for a scaled copy and -1 for a reversed one');
assert(M.pearson([1, 2, 3], [7, 7, 7]) === 0, 'pearson is 0 when a series has no variance');

/* ---- Small-world coupling graph ---- */
(function () {
  var cg = M.buildCoupling(Lab.rng(20260905), 0.8), edges = 0, symmetric = true, i, j;
  for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
    if (cg.W[i * N + j] !== cg.W[j * N + i] || (i === j && cg.W[i * N + j] !== 0)) symmetric = false;
    if (j > i && cg.adj[i * N + j]) edges++;
  }
  assert(edges === 38 && cg.edges.length === 38, 'Watts-Strogatz ring with k = 4 keeps N k / 2 = 38 edges after rewiring (' + edges + ')');
  assert(symmetric, 'weight matrix symmetric with a zero diagonal');
  var rewired = 0;
  for (i = 0; i < N; i++) for (j = 1; j <= 2; j++) if (!cg.adj[cg.order[i] * N + cg.order[(i + j) % N]]) rewired++;
  assert(rewired > 0 && rewired < 20, 'some lattice edges were rewired (' + rewired + ')');
  var cg2 = M.buildCoupling(Lab.rng(20260905), 1.6), doubled = true;
  for (i = 0; i < cg.edges.length; i++) if (!near(cg2.edges[i].w / cg.edges[i].w, 2, 1e-4) || cg2.edges[i].a !== cg.edges[i].a || cg2.edges[i].b !== cg.edges[i].b) doubled = false;
  assert(doubled, 'the same seed gives the same topology and weights scale linearly with the coupling');
  var wNear = 0, wFar = 0;
  cg.edges.forEach(function (e) {
    var d = Math.hypot(M.MONTAGE[e.a].x - M.MONTAGE[e.b].x, M.MONTAGE[e.a].y - M.MONTAGE[e.b].y);
    if (d < 0.6) wNear += e.w; else wFar += e.w;
  });
  assert(wNear > wFar, 'edges between scalp neighbours carry more weight than long ones');
})();

/* ---- Breadth-first tree ---- */
(function () {
  var chain = [[1], [0, 2], [1, 3], [2], []];
  var tree = M.bfsTree(chain, 0);
  assert(Array.prototype.join.call(tree.dist, ',') === '0,1,2,3,-1', 'bfsTree distances along a chain, unreachable node -1');
  assert(tree.maxHop === 3 && tree.parent[3] === 2 && tree.parent[0] === -1, 'bfsTree maxHop and parents');
  var mid = M.bfsTree(chain, 2);
  assert(mid.maxHop === 2 && mid.parent[0] === 1 && mid.dist[4] === -1, 'bfsTree from the middle of the chain');
  assert(M.bfsTree(chain, 7).maxHop === 0 && M.bfsTree(chain, 7).dist[0] === -1, 'bfsTree with an out-of-range start reaches nothing');
})();

/* ---- TMS-evoked potential ---- */
(function () {
  var lat = [15, 30, 45, 60, 100, 180], sign = [-1, 1, -1, 1, -1, 1], signsOk = true, peaksOk = true, decreasing = true, k;
  for (k = 0; k < lat.length; k++) {
    var v = M.tepSample(lat[k]);
    if (v * sign[k] <= 0) signsOk = false;
    if (Math.abs(v) <= Math.abs(M.tepSample(lat[k] - 6)) || Math.abs(v) <= Math.abs(M.tepSample(lat[k] + 6))) peaksOk = false;
    if (k > 0 && Math.abs(v) >= Math.abs(M.tepSample(lat[k - 1]))) decreasing = false;
  }
  assert(signsOk, 'TEP components N15 P30 N45 P60 N100 P180 have the right signs');
  assert(peaksOk, 'each component is a local extremum at its latency');
  assert(decreasing, 'component amplitudes decrease with latency');
  assert(M.tepSample(-1) === 0 && M.tepSample(301) === 0, 'TEP is zero outside the 300 ms window');
})();

/* ---- Generator: running-sum correlations, determinism, threshold ---- */
(function () {
  var g = M.createGenerator(7, 0.8);
  g.advance(2000); g.correlate();
  var maxDiff = 0, p, k;
  for (p = 0; p < M.P; p++) {
    var xa = [], xb = [];
    for (k = 0; k < CORR_N; k++) { xa.push(g.hpbuf[M.PA[p] * CORR_N + k]); xb.push(g.hpbuf[M.PB[p] * CORR_N + k]); }
    maxDiff = Math.max(maxDiff, Math.abs(M.pearson(xa, xb) - g.r[p]));
  }
  assert(maxDiff < 1e-3, 'running-sum r matches a direct Pearson over the high-passed window for all pairs (max diff ' + maxDiff.toExponential(1) + ')');
  assert(M.pairIndex(3, 8) === M.pairIndex(8, 3) && M.PA[M.pairIndex(3, 8)] === 3 && M.PB[M.pairIndex(3, 8)] === 8 && M.pairIndex(4, 4) === -1, 'pairIndex is symmetric and maps back to PA and PB');
  var g2 = M.createGenerator(7, 0.8);
  g2.advance(2000); g2.correlate();
  assert(g2.r[0] === g.r[0] && g2.buf[100] === g.buf[100], 'the same seed reproduces the same traces and correlations');
  var lo = 1e9, hi = -1e9, finite = true;
  for (k = 0; k < g.buf.length; k++) { if (!isFinite(g.buf[k])) finite = false; lo = Math.min(lo, g.buf[k]); hi = Math.max(hi, g.buf[k]); }
  assert(finite && lo > -8 && hi < 8, 'traces finite and bounded (' + lo.toFixed(2) + ' .. ' + hi.toFixed(2) + ')');
  var weak = M.createGenerator(7, 0.2), strong = M.createGenerator(7, 1.6), meanWeak = 0, meanStrong = 0;
  weak.advance(2000); weak.correlate(); strong.advance(2000); strong.correlate();
  for (p = 0; p < M.P; p++) { meanWeak += weak.absr[p] / M.P; meanStrong += strong.absr[p] / M.P; }
  assert(meanStrong > meanWeak, 'stronger coupling raises the mean |r| (' + meanWeak.toFixed(3) + ' -> ' + meanStrong.toFixed(3) + ')');
  var thr = weak.threshold(0.35), above = 0;
  for (p = 0; p < M.P; p++) if (weak.absr[p] > thr) above++;
  assert(above >= 1, 'the adaptive threshold never leaves the graph empty (' + above + ' edges at ' + thr.toFixed(2) + ')');
})();

/* ---- Stimulation written into the traces ---- */
(function () {
  var g = M.createGenerator(3, 0.8), C3 = Lab.electrodeIndex('C3');
  g.advance(500);
  var tree = M.bfsTree(g.hiddenAdjacency(), C3), s0 = g.n, pre = g.buf[C3 * BUF + s0 - 1];
  g.stimulate(C3, tree);
  g.advance(400);
  var k, jump = 0, marks = 0;
  for (k = 1; k < 10; k++) jump = Math.max(jump, Math.abs(g.buf[C3 * BUF + s0 + k] - g.buf[C3 * BUF + s0 + k - 1]));
  for (k = 0; k < 100; k++) marks += g.mark[C3 * BUF + s0 + k];
  assert(near(g.buf[C3 * BUF + s0], pre, 1e-4) && jump < 4, 'the stimulated trace starts at its pre-pulse value with no step at the artifact edge');
  assert(marks >= 75, 'the evoked window is marked on the stimulated channel (' + marks + ' of the first 100 samples)');
  var far = -1, farMarks = 0;
  for (k = 0; k < N; k++) if (tree.dist[k] === tree.maxHop) far = k;
  for (k = 0; k < 400; k++) farMarks += g.mark[far * BUF + s0 + k];
  assert(tree.maxHop >= 2 && farMarks > 0, 'the farthest electrode (' + M.MONTAGE[far].name + ', ' + tree.maxHop + ' hops) is reached too');
  assert(g.pulses.length === 1 && g.pulses[0] === s0, 'the pulse sample is remembered for the page marker');
})();

/* ---- Reduced motion: the static response honours the hop delay ---- */
(function () {
  var g = M.createGenerator(3, 0.8), Cz = Lab.electrodeIndex('Cz'), s0 = 1050;
  g.advance(BUF);
  var tree = M.bfsTree(g.hiddenAdjacency(), Cz), hopSamples = M.HOP_MS * M.FS / 1000, one = -1, k;
  for (k = 0; k < N; k++) if (tree.dist[k] === 1) one = k;
  g.injectStatic(tree, s0);
  var gapClear = true;
  for (k = 3; k < hopSamples; k++) if (g.mark[one * BUF + s0 + k]) gapClear = false;
  assert(g.mark[Cz * BUF + s0] === 1 && g.mark[Cz * BUF + s0 + 20] === 1, 'static response marks the stimulated channel from the pulse on');
  assert(g.mark[one * BUF + s0] === 1 && gapClear && g.mark[one * BUF + s0 + hopSamples] === 1, 'a one-hop neighbour shows the artifact at the pulse and its response one hop (' + hopSamples + ' samples) later');
  assert(g.pulses[0] === s0, 'the static pulse is remembered for the page marker');
})();

/* ---- Flux: conservation, rerouting, dead ends ---- */
(function () {
  var wt = M.flux(null), tca = reactionIndex('isocitrate', '2-OG'), shunt = reactionIndex('isocitrate', 'succinate'), shunt2 = reactionIndex('isocitrate', 'malate');
  assert(near(wt.biomassFraction, 1, 1e-9) && wt.carrying === 23, 'wild type: fraction 1, all 23 reactions carry flux');
  assert(near(wt.conservation, 1, 1e-6) && wt.stranded < 1e-6, 'wild type conserves carbon (biomass + CO2 = uptake) with nothing stranded');
  assert(near(wt.fluxes[0], M.UPTAKE, 1e-9), 'the whole uptake enters glycolysis');
  assert(wt.fluxes[tca] > wt.fluxes[shunt] + wt.fluxes[shunt2], 'the TCA route carries more than the glyoxylate shunt when intact');
  var ogdh = reactionIndex('2-OG', 'succinyl-CoA'), ko = M.flux(mask([ogdh]));
  var starved = reactionIndex('succinyl-CoA', 'succinate');
  assert(ko.fluxes[ogdh] === 0 && ko.fluxes[starved] === 0 && ko.carrying === 21, 'knocked-out 2-OG to succinyl-CoA carries nothing and starves succinyl-CoA to succinate: 21 of 23 carry flux');
  assert(ko.fluxes[shunt] > 1.3 * wt.fluxes[shunt] && ko.fluxes[shunt2] > 1.3 * wt.fluxes[shunt2], 'the flux reroutes through the glyoxylate shunt (' + wt.fluxes[shunt].toFixed(2) + ' -> ' + ko.fluxes[shunt].toFixed(2) + ')');
  assert(ko.biomassFraction > 0.3 && ko.biomassFraction < 1 && near(ko.conservation, 1, 1e-4), 'the knockout keeps part of the biomass (' + Math.round(ko.biomassFraction * 100) + '%) and conserves carbon');
  var uptake = M.flux(mask([0]));
  assert(uptake.biomassFraction === 0 && near(uptake.stranded, M.UPTAKE, 1e-9) && uptake.carrying === 0, 'knocking out glucose uptake strands all the carbon');
  var worstResidual = 0, worstConservation = 0, sane = true, k, q;
  for (k = 0; k < M.REACTIONS.length; k++) {
    var r = M.flux(mask([k]));
    worstResidual = Math.max(worstResidual, r.residual);
    worstConservation = Math.max(worstConservation, Math.abs(r.conservation - 1));
    if (r.fluxes[k] !== 0) sane = false;
    for (q = 0; q < M.REACTIONS.length; q++) if (!(r.fluxes[q] >= 0)) sane = false;
  }
  assert(worstResidual < 1e-4 && worstConservation < 1e-4 && sane, 'every single knockout converges, conserves carbon and keeps fluxes non-negative');
})();

/* ---- Adjacency matrix ---- */
(function () {
  var Mn = M.METABOLITES.length, complete = true;
  M.REACTIONS.forEach(function (r) { if (M.ADJ[r.from * Mn + r.to] !== 1) complete = false; });
  assert(M.ADJ_ONES === 23 && complete, 'the 19 by 19 adjacency has one 1 per directed reaction, 23 in all');
  var iso = M.METABOLITES.indexOf('isocitrate'), og = M.METABOLITES.indexOf('2-OG');
  assert(M.ADJ[iso * Mn + og] === 1 && M.ADJ[og * Mn + iso] === 0, 'the matrix is directed: isocitrate to 2-OG only');
})();

/* ---- Layouts fit their frames, labels included ---- */
function labelsFit(w, h) {
  var L = M.metabolicLayout(w, h, 16), pad = 16, ok = true, i, minDist = 1e9, j;
  for (i = 0; i < N; i++) {
    if (L.x[i] < pad || L.x[i] > w - pad || L.y[i] < pad || L.y[i] > h - pad) ok = false;
    var an = L.anchors[i], off = 5 + 7, width = M.METABOLITES[i].length * L.labelPx * 0.62;
    var ax = L.x[i] + an.dx * off, ay = L.y[i] + an.dy * off;
    var x0 = an.align === 'left' ? ax : an.align === 'right' ? ax - width : ax - width / 2;
    if (x0 < 0 || x0 + width > w || ay - L.labelPx / 2 < 0 || ay + L.labelPx / 2 > h) ok = false;
    for (j = i + 1; j < N; j++) minDist = Math.min(minDist, Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]));
  }
  return { ok: ok, minDist: minDist, labelPx: L.labelPx, compact: L.compact };
}
var fitMobile = labelsFit(350, 337), fitDesktop = labelsFit(595, 640);
assert(fitMobile.ok && fitMobile.compact && fitMobile.labelPx === 10 && fitMobile.minDist > 18, 'metabolic layout with labels fits a 350 x 337 frame (compact, nodes ' + fitMobile.minDist.toFixed(1) + ' px apart)');
assert(fitDesktop.ok && !fitDesktop.compact && fitDesktop.labelPx === 11 && fitDesktop.minDist > 30, 'metabolic layout with labels fits a 595 x 640 frame (nodes ' + fitDesktop.minDist.toFixed(1) + ' px apart)');
(function () {
  var full = M.matrixLayout(350, 337, 16, 10), short = M.matrixLayout(350, 270, 16, 10), desk = M.matrixLayout(595, 640, 16, 10);
  assert(full.colLabels && full.cs >= 10 && full.gx + full.gw <= 334 && full.gy + full.gw <= 321, 'matrix layout at 350 x 337 keeps the column labels (cells ' + full.cs.toFixed(1) + ' px)');
  assert(!short.colLabels && short.cs >= 10 && short.gy + short.gw <= 254, 'a 350 x 270 frame drops the column labels so the rows stay as tall as their labels (cells ' + short.cs.toFixed(1) + ' px)');
  assert(desk.colLabels && desk.cs > 20 && desk.gx + desk.gw <= 579 && desk.gy + desk.gw <= 624, 'matrix layout fits a 595 x 640 frame (cells ' + desk.cs.toFixed(1) + ' px)');
})();

print(failed ? failed + ' FAILED' : 'ALL PASS');
if (failed) throw new Error(failed + ' stage model test(s) failed');
