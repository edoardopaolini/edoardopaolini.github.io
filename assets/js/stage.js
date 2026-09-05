/* The Stage: the signature figure of the home page. One set of 19 nodes, three sciences.
   State 0 (hero) and 1: top-view head with the 19 electrodes of the 10-20 montage, an 8-channel EEG page
     sweeping like an oscilloscope, live functional connectivity (Pearson r of the traces) and TMS pulses
     that spread breadth-first over the graph and write an evoked potential into the traces.
   State 2: the same nodes glide to a central carbon metabolism layout, edges become reactions, flux flows as
     particles, click or tap a reaction to knock it out and watch the flux reroute.
   State 3: the nodes become the row and column labels of the 19x19 adjacency matrix.
   Part 1 is the pure model (no DOM), exported on window.__stageModel for tests/stage.test.js, which runs in a
   bare engine after assets/js/lab.js. Part 2 attaches to #stage and exits when the element is absent.
   Plain ES2017, no dependencies beyond window.Lab (assets/js/lab.js) and window.whenVisible (assets/js/site.js).
   Plotting convention: clinical EEG, NEGATIVE UP (a positive potential deflects the trace downwards). */
(function () {
  'use strict';

  var Lab = window.Lab;

  /* ======================================================================
     Part 1: model
     ====================================================================== */

  var FS = 250;              /* simulated sample rate, Hz */
  var PAGE_S = 10;           /* seconds per EEG page */
  var BUF = FS * PAGE_S;     /* ring buffer length per channel, one page */
  var CORR_N = 256;          /* correlation window, samples */
  var HOP_MS = 40;           /* propagation delay per hop */
  var TEP_MS = 300;          /* length of the evoked window */
  var ARTIFACT_MS = 10;      /* pulse artifact bridged by a straight interpolated segment (about -2 to +10 ms in
                                practice; 20 ms would swallow the N15 on the stimulated channel) */
  var MAX_PULSES = 8;        /* pulse markers remembered for the page */
  var COMPACT_W = 420;       /* below this frame width the layouts trim their labels */
  var TAU = 2 * Math.PI;
  var MONTAGE = Lab.MONTAGE;
  var N = MONTAGE.length;    /* 19 electrodes */
  var P = N * (N - 1) / 2;   /* 171 pairs */

  /* Tunables in one place. decay: coupling weight decay with scalp distance. corrHpHz: high-pass corner of the
     copy of the traces used for correlations. Flux solver: hard ceiling on a reaction as a multiple of its
     nominal capacity, back-pressure gain per sweep, Gauss-Seidel damping and number of sweeps. */
  var PARAMS = { decay: 1.6, corrHpHz: 2.5, ceiling: 3, bpGain: 0.35, relax: 0.7, sweeps: 240 };

  /* Pair tables: pair p connects PA[p] < PB[p]; PAIR_INDEX[i * N + j] is its position. */
  var PA = new Uint8Array(P), PB = new Uint8Array(P), PAIR_INDEX = new Int16Array(N * N);
  (function () {
    var p = 0;
    for (var i = 0; i < N; i++) for (var j = i + 1; j < N; j++) { PA[p] = i; PB[p] = j; PAIR_INDEX[i * N + j] = p; PAIR_INDEX[j * N + i] = p; p++; }
  })();

  /* Scalp order: electrodes sorted by polar angle around the vertex, so ring neighbours are scalp neighbours. */
  function ringOrder() {
    var idx = [];
    for (var i = 0; i < N; i++) idx.push(i);
    idx.sort(function (a, b) {
      var aa = Math.atan2(MONTAGE[a].x, MONTAGE[a].y), ab = Math.atan2(MONTAGE[b].x, MONTAGE[b].y);
      if (Math.abs(aa - ab) > 1e-6) return aa - ab;
      return Math.hypot(MONTAGE[a].x, MONTAGE[a].y) - Math.hypot(MONTAGE[b].x, MONTAGE[b].y);
    });
    return idx;
  }
  function scalpDist(i, j) {
    return Math.hypot(MONTAGE[i].x - MONTAGE[j].x, MONTAGE[i].y - MONTAGE[j].y);
  }

  /* Hidden coupling graph: Watts-Strogatz small world (ring by scalp order, k = 4, rewiring p = 0.15), weights
     decreasing with scalp distance and scaled by the global coupling. Returns the symmetric weight matrix
     W (N x N, zero diagonal), the 0/1 adjacency and the edge list. The same rng seed gives the same topology. */
  function buildCoupling(rng, coupling) {
    var order = ringOrder();
    var adj = new Uint8Array(N * N), i, j, a, b;
    for (i = 0; i < N; i++) {
      for (j = 1; j <= 2; j++) {
        a = order[i]; b = order[(i + j) % N];
        adj[a * N + b] = 1; adj[b * N + a] = 1;
      }
    }
    for (i = 0; i < N; i++) {
      for (j = 1; j <= 2; j++) {
        a = order[i]; b = order[(i + j) % N];
        if (rng() >= 0.15) continue;
        var tries = 0, nb;
        do { nb = Math.floor(rng() * N); tries++; } while ((nb === a || adj[a * N + nb]) && tries < 40);
        if (nb === a || adj[a * N + nb]) continue;
        adj[a * N + b] = 0; adj[b * N + a] = 0;
        adj[a * N + nb] = 1; adj[nb * N + a] = 1;
      }
    }
    var Wm = new Float32Array(N * N), edges = [];
    for (i = 0; i < N; i++) {
      for (j = i + 1; j < N; j++) {
        if (!adj[i * N + j]) continue;
        var w = Math.exp(-PARAMS.decay * scalpDist(i, j)) * (0.7 + 0.6 * rng()) * coupling;
        Wm[i * N + j] = w; Wm[j * N + i] = w;
        edges.push({ a: i, b: j, w: w });
      }
    }
    return { W: Wm, adj: adj, edges: edges, order: order };
  }

  /* Pearson correlation of two equal-length arrays. 0 when either variance is zero. */
  function pearson(a, b) {
    var n = Math.min(a.length, b.length), i, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) { sx += a[i]; sy += b[i]; sxx += a[i] * a[i]; syy += b[i] * b[i]; sxy += a[i] * b[i]; }
    var vx = n * sxx - sx * sx, vy = n * syy - sy * sy;
    if (vx <= 1e-12 || vy <= 1e-12) return 0;
    return (n * sxy - sx * sy) / Math.sqrt(vx * vy);
  }

  /* Breadth-first search over an adjacency list (array of arrays). dist[i] is the hop count, -1 unreachable,
     parent[i] the node the wave came from, maxHop the farthest hop count. */
  function bfsTree(adjacency, start) {
    var n = adjacency.length, dist = new Int32Array(n), parent = new Int32Array(n), i;
    dist.fill(-1); parent.fill(-1);
    if (start < 0 || start >= n) return { dist: dist, parent: parent, maxHop: 0 };
    var queue = [start], head = 0, maxHop = 0;
    dist[start] = 0;
    while (head < queue.length) {
      var u = queue[head++], nb = adjacency[u];
      for (i = 0; i < nb.length; i++) {
        var v = nb[i];
        if (dist[v] >= 0) continue;
        dist[v] = dist[u] + 1; parent[v] = u;
        if (dist[v] > maxHop) maxHop = dist[v];
        queue.push(v);
      }
    }
    return { dist: dist, parent: parent, maxHop: maxHop };
  }

  /* TMS-evoked potential: Gaussian-windowed components at the classic latencies N15 P30 N45 P60 N100 P180
     (N = negative), decreasing amplitude and widening in time. tMs is measured from the pulse. */
  var TEP_LAT = [15, 30, 45, 60, 100, 180];
  var TEP_SIGN = [-1, 1, -1, 1, -1, 1];
  var TEP_AMP = [3.2, 2.5, 1.9, 1.5, 1.1, 0.8];
  var TEP_SIG = [3.5, 4.5, 6, 8, 14, 24];
  function tepSample(tMs) {
    if (tMs < 0 || tMs > TEP_MS) return 0;
    var v = 0;
    for (var k = 0; k < TEP_LAT.length; k++) {
      var z = (tMs - TEP_LAT[k]) / TEP_SIG[k];
      v += TEP_SIGN[k] * TEP_AMP[k] * Math.exp(-0.5 * z * z);
    }
    return v;
  }

  /* Per-channel source weights: posterior alpha, frontal theta, central beta, frontopolar blinks. */
  var POSTERIOR = ['O1', 'O2', 'P3', 'P4', 'T5', 'T6', 'Pz'];
  var CENTRAL = ['C3', 'Cz', 'C4', 'T3', 'T4'];
  var FRONTAL = ['Fz', 'F3', 'F4', 'Fp1', 'Fp2'];
  function weightTable(list, inValue, outValue) {
    var w = new Float32Array(N);
    w.fill(outValue);
    for (var i = 0; i < list.length; i++) w[Lab.electrodeIndex(list[i])] = inValue;
    return w;
  }

  /* Real-time signal generator with the coupling mix, ring buffers, running correlation sums and the
     stimulation queue. Every array is allocated once; step() creates no garbage. */
  function createGenerator(seed, coupling) {
    var g = {
      seed: seed, n: 0, coupling: coupling,
      buf: new Float32Array(N * BUF), mark: new Uint8Array(N * BUF),
      out: new Float32Array(N), src: new Float32Array(N), bg: new Float32Array(N),
      alphaW: weightTable(POSTERIOR, 0.45, 0.05), thetaW: weightTable(FRONTAL, 0.32, 0.18), betaW: weightTable(CENTRAL, 0.16, 0.09),
      blinkW: new Float32Array(N), alphaPh: new Float32Array(N), thetaPh: new Float32Array(N), thetaPh2: new Float32Array(N), betaPh: new Float32Array(N),
      envPhase: 0, nextBlink: 0, blinkStart: -1, blinkAmp: 1,
      leak: 0.90, bgAmp: 0.8, whiteAmp: 0.4,
      /* One-pole high-pass for the correlation copy of the traces. The displayed traces stay raw; without the
         high-pass the slow drift makes any two channels look correlated over a one second window. */
      hpA: Math.exp(-TAU * PARAMS.corrHpHz / FS),
      W: null, norm: new Float32Array(N), adj: null,
      hp: new Float32Array(N), prev: new Float32Array(N), hpbuf: new Float32Array(N * CORR_N),
      sx: new Float64Array(N), sxx: new Float64Array(N), sxy: new Float64Array(P), r: new Float32Array(P), absr: new Float32Array(P),
      stims: [], pulses: [], rnd: null
    };
    var k;
    for (k = 0; k < CENTRAL.length; k++) g.alphaW[Lab.electrodeIndex(CENTRAL[k])] = 0.16;
    g.blinkW[Lab.electrodeIndex('Fp1')] = 2.6; g.blinkW[Lab.electrodeIndex('Fp2')] = 2.5;
    g.blinkW[Lab.electrodeIndex('F3')] = 0.9; g.blinkW[Lab.electrodeIndex('F4')] = 0.9;
    g.blinkW[Lab.electrodeIndex('F7')] = 0.6; g.blinkW[Lab.electrodeIndex('F8')] = 0.6;
    for (k = 0; k < 4; k++) g.stims.push({ active: false, s0: 0, hold: new Float32Array(N), maxHop: 0, dist: new Int32Array(N) });

    g.setCoupling = function (c) {
      var cg = buildCoupling(Lab.rng(20260905), c);
      g.W = cg.W; g.adj = cg.adj;
      for (var i = 0; i < N; i++) {
        var s = 1;
        for (var j = 0; j < N; j++) s += g.W[i * N + j] * g.W[i * N + j];
        g.norm[i] = 1 / Math.sqrt(s);
      }
    };
    g.reseed = function (seed) {
      g.seed = seed; g.rnd = Lab.rng(seed); g.n = 0;
      var i;
      for (i = 0; i < N; i++) {
        g.alphaPh[i] = (g.rnd() - 0.5) * 0.5; g.thetaPh[i] = g.rnd() * TAU; g.thetaPh2[i] = g.rnd() * TAU; g.betaPh[i] = g.rnd() * TAU;
      }
      g.bg.fill(0); g.out.fill(0); g.src.fill(0); g.sx.fill(0); g.sxx.fill(0); g.hp.fill(0); g.prev.fill(0);
      g.envPhase = g.rnd() * TAU; g.nextBlink = 2.5 + 2 * g.rnd(); g.blinkStart = -1;
      g.buf.fill(0); g.mark.fill(0); g.hpbuf.fill(0); g.sxy.fill(0); g.r.fill(0); g.absr.fill(0);
      for (i = 0; i < g.stims.length; i++) g.stims[i].active = false;
      g.pulses.length = 0;
    };
    function rememberPulse(s0) {
      g.pulses.push(s0);
      if (g.pulses.length > MAX_PULSES) g.pulses.shift();
    }

    /* One sample: sources, blink, coupling mix, evoked potentials, ring buffer and running sums. */
    g.step = function () {
      var n = g.n, t = n / FS, i, j, rnd = g.rnd;
      var envA = 0.55 + 0.45 * Math.sin(TAU * 0.08 * t + g.envPhase);
      var wa = TAU * 10 * t, wt = TAU * 6 * t, wb = TAU * 20 * t;
      if (g.blinkStart < 0 && t >= g.nextBlink) { g.blinkStart = t; g.blinkAmp = 0.8 + 0.4 * rnd(); }
      var blink = 0;
      if (g.blinkStart >= 0) {
        var u = (t - g.blinkStart) / 0.3;
        if (u >= 1) { g.blinkStart = -1; g.nextBlink = t + 4 + 4 * rnd(); }
        else { var su = Math.sin(Math.PI * u); blink = g.blinkAmp * su * su; }
      }
      for (i = 0; i < N; i++) {
        g.bg[i] = g.bg[i] * g.leak + (rnd() - 0.5) * g.bgAmp;
        g.src[i] = g.alphaW[i] * envA * Math.sin(wa + g.alphaPh[i])
          + g.thetaW[i] * (0.6 + 0.4 * Math.sin(TAU * 0.13 * t + g.thetaPh2[i])) * Math.sin(wt + g.thetaPh[i])
          + g.betaW[i] * Math.sin(wb + g.betaPh[i])
          + g.bg[i] + g.whiteAmp * (rnd() - 0.5)
          + g.blinkW[i] * blink;
      }
      var Wm = g.W;
      for (i = 0; i < N; i++) {
        var acc = g.src[i], row = i * N;
        for (j = 0; j < N; j++) acc += Wm[row + j] * g.src[j];
        g.out[i] = acc * g.norm[i];
      }
      /* Evoked potentials. The pulse artifact is electromagnetic and sits on every channel at the pulse time:
         the first ARTIFACT_MS of each reached channel are replaced by a straight segment from the pre-pulse
         value to the value the trace resumes at (signal plus, on the stimulated channel, the TEP at the end of
         the window), so there is no step and the N15 survives. Then the stimulated channel gets the TEP, every
         other reached channel the TEP attenuated by 1/(1+d) and delayed by d hops. */
      var idx = n % BUF, anyActive = false;
      for (i = 0; i < N; i++) g.mark[i * BUF + idx] = 0;
      for (var q = 0; q < g.stims.length; q++) {
        var st = g.stims[q];
        if (!st.active) continue;
        var ms = (n - st.s0) * 1000 / FS;
        if (ms > st.maxHop * HOP_MS + TEP_MS) { st.active = false; continue; }
        anyActive = true;
        for (i = 0; i < N; i++) {
          var d = st.dist[i];
          if (d < 0) continue;
          if (ms < ARTIFACT_MS) {
            var ua = ms / ARTIFACT_MS, resume = g.out[i] + (d === 0 ? tepSample(ARTIFACT_MS) : 0);
            g.out[i] = st.hold[i] + (resume - st.hold[i]) * ua;
            g.mark[i * BUF + idx] = 1;
            continue;
          }
          var dm = ms - d * HOP_MS;
          if (dm < 0 || dm > TEP_MS) continue;
          g.out[i] += tepSample(dm) / (1 + d);
          g.mark[i * BUF + idx] = 1;
        }
      }
      /* Running sums of the high-passed copy over the last CORR_N samples: add the new sample, drop the one
         CORR_N back. */
      var hidx = n % CORR_N, hasOld = n >= CORR_N, xi, xj, oi, oj, p = 0;
      for (i = 0; i < N; i++) {
        g.hp[i] = g.hpA * (g.hp[i] + g.out[i] - g.prev[i]);
        g.prev[i] = g.out[i];
      }
      for (i = 0; i < N; i++) {
        xi = g.hp[i]; oi = hasOld ? g.hpbuf[i * CORR_N + hidx] : 0;
        g.sx[i] += xi - oi; g.sxx[i] += xi * xi - oi * oi;
      }
      for (i = 0; i < N; i++) {
        xi = g.hp[i]; oi = hasOld ? g.hpbuf[i * CORR_N + hidx] : 0;
        for (j = i + 1; j < N; j++) {
          xj = g.hp[j]; oj = hasOld ? g.hpbuf[j * CORR_N + hidx] : 0;
          g.sxy[p++] += xi * xj - oi * oj;
        }
      }
      for (i = 0; i < N; i++) { g.buf[i * BUF + idx] = g.out[i]; g.hpbuf[i * CORR_N + hidx] = g.hp[i]; }
      g.n = n + 1;
      return anyActive;
    };
    g.advance = function (count) { for (var k = 0; k < count; k++) g.step(); };

    /* Pearson r for all pairs from the running sums. */
    g.correlate = function () {
      var n = Math.min(g.n, CORR_N), i, j, p = 0;
      if (n < 8) { g.r.fill(0); g.absr.fill(0); return; }
      for (i = 0; i < N; i++) {
        var vx = n * g.sxx[i] - g.sx[i] * g.sx[i];
        for (j = i + 1; j < N; j++) {
          var vy = n * g.sxx[j] - g.sx[j] * g.sx[j];
          var r = (vx > 1e-9 && vy > 1e-9) ? (n * g.sxy[p] - g.sx[i] * g.sx[j]) / Math.sqrt(vx * vy) : 0;
          g.r[p] = Lab.clamp(r, -1, 1); g.absr[p] = Math.abs(g.r[p]); p++;
        }
      }
    };
    /* Threshold |r| > base; when no pair passes, lower it to the 20th strongest pair so the graph is never
       empty. Returns the threshold in use. */
    var sortScratch = new Float32Array(P);
    g.threshold = function (base) {
      for (var p = 0; p < P; p++) if (g.absr[p] > base) return base;
      sortScratch.set(g.absr);
      sortScratch.sort();
      return Math.max(0, sortScratch[P - 20] - 1e-6);
    };
    /* Adjacency lists of the thresholded graph (built only on demand, at stimulation time). */
    g.adjacency = function (thr) {
      var lists = [], p, count = 0;
      for (var i = 0; i < N; i++) lists.push([]);
      for (p = 0; p < P; p++) if (g.absr[p] > thr) { lists[PA[p]].push(PB[p]); lists[PB[p]].push(PA[p]); count++; }
      lists.edgeCount = count;
      return lists;
    };
    g.hiddenAdjacency = function () {
      var lists = [];
      for (var i = 0; i < N; i++) { lists.push([]); for (var j = 0; j < N; j++) if (g.adj[i * N + j]) lists[i].push(j); }
      return lists;
    };
    /* Strongest pair for the readout. */
    g.summary = function () {
      var best = 0;
      for (var p = 1; p < P; p++) if (g.absr[p] > g.absr[best]) best = p;
      return { a: PA[best], b: PB[best], r: g.r[best] };
    };
    /* Queue a stimulation at the next sample. tree comes from bfsTree over the chosen adjacency. */
    g.stimulate = function (node, tree) {
      var slot = g.stims[0], q;
      for (q = 0; q < g.stims.length; q++) if (!g.stims[q].active) { slot = g.stims[q]; break; }
      slot.active = true; slot.s0 = g.n; slot.maxHop = tree.maxHop;
      var prevIdx = (g.n - 1 + BUF) % BUF;
      for (var i = 0; i < N; i++) slot.hold[i] = g.n > 0 ? g.buf[i * BUF + prevIdx] : 0;
      slot.dist.set(tree.dist);
      rememberPulse(g.n);
    };
    /* Reduced motion: write the whole evoked response into the frozen page at sample s0. */
    g.injectStatic = function (tree, s0) {
      var i, k, s, artN = Math.ceil(ARTIFACT_MS * FS / 1000), len = Math.round(TEP_MS * FS / 1000);
      for (i = 0; i < N; i++) {
        var d = tree.dist[i];
        if (d < 0) continue;
        var start = s0 + Math.round(d * HOP_MS * FS / 1000);
        for (k = 0; k <= len; k++) {
          s = start + k;
          if (s < 0 || s >= BUF) continue;
          g.buf[i * BUF + s] += tepSample(k * 1000 / FS) / (1 + d);
          g.mark[i * BUF + s] = 1;
        }
        /* Pulse artifact at the pulse time on every reached channel: straight segment from the pre-pulse
           value to the value the trace has once the window ends. */
        var hold = g.buf[i * BUF + ((s0 - 1 + BUF) % BUF)], resume = g.buf[i * BUF + Math.min(BUF - 1, s0 + artN)];
        for (k = 0; k < artN; k++) {
          s = s0 + k;
          if (s < 0 || s >= BUF) continue;
          g.buf[i * BUF + s] = hold + (resume - hold) * (k / artN);
          g.mark[i * BUF + s] = 1;
        }
      }
      rememberPulse(s0);
    };

    g.setCoupling(coupling);
    g.reseed(seed);
    return g;
  }

  /* ---------------------------------------------------------------------
     Central carbon metabolism: 19 metabolites (index = montage index), 23 directed reactions, 7 biomass drains.
     A toy network, not the M. tuberculosis model.
     --------------------------------------------------------------------- */
  var METABOLITES = ['glucose', 'G6P', 'F6P', 'FBP', 'GAP', '1,3-BPG', '3PG', '2PG', 'PEP', 'pyruvate',
    'acetyl-CoA', 'citrate', 'isocitrate', '2-OG', 'succinyl-CoA', 'succinate', 'fumarate', 'malate', 'OAA'];
  var M = METABOLITES.length;
  function metIndex(name) { return METABOLITES.indexOf(name); }
  /* [from, to, capacity, carbon kept]. Flux is in carbon units: capacities are split proportions for the
     reactions, the fourth entry is the fraction of carbon that reaches the product (the rest leaves as CO2 at
     pyruvate dehydrogenase, C3 to C2, and the two TCA decarboxylations, C6 to C5 to C4). Those exits are what
     let the cycle converge. The glyoxylate shunt (21, 22) carries less than the TCA route (13) when intact. */
  var REACTIONS = [
    ['glucose', 'G6P', 10], ['G6P', 'F6P', 10], ['F6P', 'FBP', 10], ['FBP', 'GAP', 10], ['GAP', '1,3-BPG', 10],
    ['1,3-BPG', '3PG', 10], ['3PG', '2PG', 10], ['2PG', 'PEP', 10], ['PEP', 'pyruvate', 10],
    ['pyruvate', 'acetyl-CoA', 8, 2 / 3], ['acetyl-CoA', 'citrate', 10], ['OAA', 'citrate', 10],
    ['citrate', 'isocitrate', 8], ['isocitrate', '2-OG', 6, 5 / 6], ['2-OG', 'succinyl-CoA', 8, 4 / 5], ['succinyl-CoA', 'succinate', 8],
    ['succinate', 'fumarate', 8], ['fumarate', 'malate', 8], ['malate', 'OAA', 8],
    ['PEP', 'OAA', 1.5], ['pyruvate', 'OAA', 1.5],
    ['isocitrate', 'succinate', 1.5], ['isocitrate', 'malate', 1.5]
  ].map(function (r, i) { return { index: i, from: metIndex(r[0]), to: metIndex(r[1]), cap: r[2], keep: r.length > 3 ? r[3] : 1, label: r[0] + ' to ' + r[1] }; });
  var R = REACTIONS.length;
  /* Biomass drains: proportional shares that saturate at their capacity. */
  var DRAINS = [['G6P', 0.8], ['3PG', 0.6], ['PEP', 0.5], ['pyruvate', 0.8], ['acetyl-CoA', 1.0], ['2-OG', 1.2], ['OAA', 1.2]]
    .map(function (d) { return { node: metIndex(d[0]), cap: d[1] }; });
  var UPTAKE = 10;
  /* Directed adjacency of the reaction graph, row = from, col = to. */
  var ADJ = new Uint8Array(M * M);
  REACTIONS.forEach(function (r) { ADJ[r.from * M + r.to] = 1; });
  var ADJ_ONES = ADJ.reduce(function (s, v) { return s + v; }, 0);

  /* Proportional push-flow with back-pressure. Each metabolite splits its inflow across enabled outgoing
     reactions and drains in proportion to capacity; a drain never takes more than its capacity, the excess is
     re-split among the other outputs, and what has nowhere to go is stranded. Back-pressure: every pool
     carries an acceptance factor accept[m] = 1 - stranded[m] / inflow[m] (the fraction of its inflow it can
     dispose of, damped by bpGain per sweep), and every reaction into m sees its split capacity and its ceiling
     scaled by accept[m]. A pool that fills up therefore slows the reactions producing it (product inhibition),
     the pressure walks upstream to the nearest branch point and the flux there re-splits toward the outlets
     that still drain: blocking 2-OG dehydrogenase sends isocitrate through the glyoxylate shunt instead of
     piling up at 2-OG. Gauss-Seidel sweeps in flow order with damping so the TCA cycle and the acceptance
     feedback converge. enabledMask: array of R truthy values (missing = all enabled). Returns per-reaction
     fluxes (carbon units leaving the substrate), per-drain fluxes, biomass, biomass as a fraction of wild
     type, CO2, stranded flux, conservation ((biomass + CO2 + stranded) / uptake), the acceptance factors and
     the number of reactions that carry flux. */
  function flux(enabledMask) {
    var f = new Float64Array(R), d = new Float64Array(DRAINS.length), inflow = new Float64Array(M), strandedAt = new Float64Array(M);
    var accept = new Float64Array(M), outR = [], outD = [], m, k, it, sat = new Uint8Array(DRAINS.length), satR = new Uint8Array(R);
    for (m = 0; m < M; m++) { outR.push([]); outD.push([]); accept[m] = 1; }
    for (k = 0; k < R; k++) if (!enabledMask || enabledMask[k]) outR[REACTIONS[k].from].push(k);
    for (k = 0; k < DRAINS.length; k++) outD[DRAINS[k].node].push(k);
    var residual = 0, co2 = 0;
    for (it = 0; it < PARAMS.sweeps; it++) {
      residual = 0; co2 = 0;
      for (m = 0; m < M; m++) {
        var inn = m === 0 ? UPTAKE : 0;
        for (k = 0; k < R; k++) if (REACTIONS[k].to === m) inn += f[k] * REACTIONS[k].keep;
        inflow[m] = inn;
        var rest = inn, pass;
        for (k = 0; k < outD[m].length; k++) sat[outD[m][k]] = 0;
        for (k = 0; k < outR[m].length; k++) satR[outR[m][k]] = 0;
        for (pass = 0; pass < 8; pass++) {
          var cap = 0, again = false, r, ecap;
          for (k = 0; k < outR[m].length; k++) { r = outR[m][k]; if (!satR[r]) cap += REACTIONS[r].cap * accept[REACTIONS[r].to]; }
          for (k = 0; k < outD[m].length; k++) if (!sat[outD[m][k]]) cap += DRAINS[outD[m][k]].cap;
          if (cap <= 1e-12) break;
          for (k = 0; k < outD[m].length; k++) {
            var dr = outD[m][k];
            if (sat[dr]) continue;
            var share = rest * DRAINS[dr].cap / cap;
            if (share > DRAINS[dr].cap) { d[dr] = DRAINS[dr].cap; sat[dr] = 1; rest -= DRAINS[dr].cap; again = true; }
            else d[dr] = share;
          }
          if (again) continue;
          /* Reactions: proportional share of the acceptance-scaled capacities, capped at ceiling x capacity x
             acceptance; a capped reaction is treated like a saturated drain and the remainder is re-split. */
          for (k = 0; k < outR[m].length; k++) {
            r = outR[m][k];
            if (satR[r]) continue;
            ecap = REACTIONS[r].cap * accept[REACTIONS[r].to];
            var lim = ecap * PARAMS.ceiling;
            if (rest * ecap / cap > lim + 1e-9) { satR[r] = 1; f[r] = lim; rest -= lim; again = true; }
          }
          if (again) continue;
          for (k = 0; k < outR[m].length; k++) {
            r = outR[m][k];
            if (satR[r]) continue;
            ecap = REACTIONS[r].cap * accept[REACTIONS[r].to];
            var target = rest * ecap / cap, nv = f[r] + PARAMS.relax * (target - f[r]);
            if (Math.abs(nv - f[r]) > residual) residual = Math.abs(nv - f[r]);
            f[r] = nv;
          }
          rest = 0;
          break;
        }
        for (k = 0; k < outR[m].length; k++) co2 += f[outR[m][k]] * (1 - REACTIONS[outR[m][k]].keep);
        strandedAt[m] = rest > 1e-9 ? rest : 0;
        /* Back-pressure: the fraction of the inflow this pool disposed of, damped. A pool that receives
           nothing gives no evidence and keeps its factor (resetting it to 1 would let the flux into a dead
           end resume, strand and be throttled again: a relaxation oscillation that never converges). */
        if (inn > 1e-6) {
          var accTarget = Math.max(1e-6, 1 - strandedAt[m] / inn);
          var na = accept[m] + PARAMS.bpGain * (accTarget - accept[m]);
          if (Math.abs(na - accept[m]) > residual) residual = Math.abs(na - accept[m]);
          accept[m] = na;
        }
      }
    }
    var biomass = 0, stranded = 0, carrying = 0;
    for (k = 0; k < R; k++) {
      if (enabledMask && !enabledMask[k]) f[k] = 0;
      if (f[k] > 1e-9) carrying++;
    }
    for (k = 0; k < d.length; k++) biomass += d[k];
    for (m = 0; m < M; m++) stranded += strandedAt[m];
    return {
      fluxes: f, drains: d, biomass: biomass, biomassFraction: WT_BIOMASS > 0 ? biomass / WT_BIOMASS : 1,
      co2: co2, stranded: stranded, conservation: (biomass + co2 + stranded) / UPTAKE, residual: residual, carrying: carrying
    };
  }
  /* Wild-type biomass, the reference for biomassFraction (still undefined during this call, which reports 1). */
  var WT_BIOMASS = flux(null).biomass;

  /* ---------------------------------------------------------------------
     Layouts. All return positions in CSS pixels for a w x h canvas.
     --------------------------------------------------------------------- */
  /* Head figure in the upper part of the frame, EEG page below. */
  function headLayout(w, h, pad) {
    var iw = w - 2 * pad, ih = h - 2 * pad;
    var headH = ih * 0.6, pageTop = pad + headH + 6, pageH = ih - headH - 6;
    var cx = w / 2, cy = pad + headH / 2 + 4;
    var R0 = Math.min((headH / 2 - 16) / 1.13, iw / 2 - 34);
    var x = new Float32Array(N), y = new Float32Array(N);
    for (var i = 0; i < N; i++) { x[i] = cx + MONTAGE[i].x * R0; y[i] = cy - MONTAGE[i].y * R0; }
    return { x: x, y: y, cx: cx, cy: cy, r: Math.max(20, R0), pageX: pad, pageY: pageTop, pageW: iw, pageH: pageH };
  }

  /* Central carbon metabolism: glycolysis as a chain down the left, the TCA cycle as a ring on the right.
     Each node carries a label anchor (dx, dy offsets and alignment) and the drains a stub direction. The OAA
     label sits left of its node, slightly above: between the malate edge above and the PEP and pyruvate edges
     below, the one sector no edge crosses on a compact ring. */
  var RING = ['citrate', 'isocitrate', '2-OG', 'succinyl-CoA', 'succinate', 'fumarate', 'malate', 'OAA'];
  var RING_ANGLE = [90, 45, 0, -45, -90, -135, 180, 135];
  var LABEL_ANCHOR = {
    'citrate': [1, 0.55, 'left'], 'isocitrate': [1, 0.35, 'left'], '2-OG': [1, 0, 'left'], 'succinyl-CoA': [1, -0.35, 'left'],
    'succinate': [0, -1, 'center'], 'fumarate': [-1, -0.35, 'right'], 'malate': [-1, 0, 'right'], 'OAA': [-1, -0.5, 'right'],
    'acetyl-CoA': [1, 0.3, 'left']
  };
  var STUB_DIR = { 'G6P': [1, 0], '3PG': [1, 0], 'PEP': [0.45, -0.9], 'pyruvate': [0, 1], 'acetyl-CoA': [-0.55, 0.85], '2-OG': [0.75, 0.75], 'OAA': [0, 1] };
  var CHAR_W = 0.62;         /* advance width of the mono font as a fraction of its size */
  function metabolicLayout(w, h, pad) {
    var iw = w - 2 * pad, ih = h - 2 * pad, compact = w < COMPACT_W;
    var x = new Float32Array(N), y = new Float32Array(N), i;
    var chainX = pad + iw * (compact ? 0.25 : 0.27);
    var chainY0 = pad + ih * 0.06, chainY1 = pad + ih * 0.86;
    for (i = 0; i <= 9; i++) { x[i] = chainX; y[i] = chainY0 + (chainY1 - chainY0) * i / 9; }
    var cx = pad + iw * (compact ? 0.63 : 0.70), cy = pad + ih * 0.56;
    var r = Math.min(iw * (compact ? 0.19 : 0.215), ih * (compact ? 0.26 : 0.27));
    /* Ring labels sit outside the ring, so reserve room for the longest one ("succinyl-CoA", 12 characters)
       on the right and keep the ring clear of the chain and its biomass stubs on the left. Between roughly
       420 and 560 px the default proportions would push the right-hand labels past the frame. */
    var labelPx = w < 560 ? 10 : 11;
    var labelReserve = Math.ceil(labelPx * CHAR_W * 12) + 10;
    var leftLimit = chainX + labelReserve * 1.05, rightLimit = w - pad - labelReserve;
    if (cx + r > rightLimit || cx - r < leftLimit) {
      r = Math.max(24, Math.min(r, (rightLimit - leftLimit) / 2));
      cx = (leftLimit + rightLimit) / 2;
    }
    for (i = 0; i < RING.length; i++) {
      var k = metIndex(RING[i]), a = RING_ANGLE[i] * Math.PI / 180;
      x[k] = cx + r * Math.cos(a); y[k] = cy + r * Math.sin(a);
    }
    var ac = metIndex('acetyl-CoA');
    x[ac] = pad + iw * 0.50; y[ac] = pad + ih * 0.93;
    var anchors = [], stubs = [];
    for (i = 0; i < M; i++) {
      var an = LABEL_ANCHOR[METABOLITES[i]];
      anchors.push(an ? { dx: an[0], dy: an[1], align: an[2] } : { dx: -1, dy: 0, align: 'right' });
    }
    for (i = 0; i < DRAINS.length; i++) {
      var sd = STUB_DIR[METABOLITES[DRAINS[i].node]], len = Math.hypot(sd[0], sd[1]);
      stubs.push({ node: DRAINS[i].node, dx: sd[0] / len, dy: sd[1] / len });
    }
    return { x: x, y: y, anchors: anchors, stubs: stubs, compact: compact, labelPx: labelPx, stubLen: Lab.clamp(ih * 0.045, 14, 22) };
  }

  /* Adjacency matrix: cell size min(w, h) * 0.8 / 19, the block of labels plus grid centred. Nodes land on the
     row labels; columns get their own small marks. Frames too short for the rotated column labels (the rows
     would be tighter than the label size) drop them and keep the row labels and the column marks. */
  var COL_MARK_H = 14;
  function matrixLayout(w, h, pad, labelPx) {
    var maxChars = 0, i;
    for (i = 0; i < M; i++) maxChars = Math.max(maxChars, METABOLITES[i].length);
    var labelLen = maxChars * labelPx * CHAR_W + 18;
    function cellSize(topLen) {
      return Math.max(6, Math.min(Math.min(w, h) * 0.8 / N, (w - 2 * pad - labelLen) / N, (h - 2 * pad - topLen) / N));
    }
    var cs = cellSize(labelLen), colLabels = cs >= labelPx;
    if (!colLabels) cs = cellSize(COL_MARK_H);
    var topLen = colLabels ? labelLen : COL_MARK_H, gw = cs * N;
    var gx = (w - (labelLen + gw)) / 2 + labelLen, gy = (h - (topLen + gw)) / 2 + topLen;
    var x = new Float32Array(N), y = new Float32Array(N);
    for (i = 0; i < N; i++) { x[i] = gx - 7; y[i] = gy + cs * (i + 0.5); }
    return { x: x, y: y, cs: cs, gx: gx, gy: gy, gw: gw, labelPx: labelPx, colLabels: colLabels };
  }

  var model = {
    FS: FS, BUF: BUF, CORR_N: CORR_N, HOP_MS: HOP_MS, N: N, P: P, UPTAKE: UPTAKE,
    MONTAGE: MONTAGE, METABOLITES: METABOLITES, REACTIONS: REACTIONS, ADJ: ADJ, ADJ_ONES: ADJ_ONES,
    PA: PA, PB: PB, pairIndex: function (i, j) { return i === j ? -1 : PAIR_INDEX[i * N + j]; },
    buildCoupling: buildCoupling, pearson: pearson, bfsTree: bfsTree, tepSample: tepSample,
    createGenerator: createGenerator, flux: flux, metabolicLayout: metabolicLayout, matrixLayout: matrixLayout
  };
  window.__stageModel = model;

  /* ======================================================================
     Part 2: DOM
     ====================================================================== */
  if (typeof document === 'undefined') return;
  var root = document.getElementById('stage');
  var canvas = document.getElementById('stage-canvas');
  var buttonsEl = document.getElementById('stage-buttons');
  var readoutEl = document.getElementById('stage-readout');
  var liveEl = document.getElementById('stage-live');
  var controlsEl = document.getElementById('stage-controls');
  if (!root || !canvas || !buttonsEl || !readoutEl || !liveEl || !controlsEl) return;
  var section = document.getElementById('stage-section');
  var frame = canvas.parentNode;
  var reduce = Lab.reduceMotion;
  var t = Lab.tokens();

  var PAD = 16, SEED = 20260904, DEFAULT_COUPLING = 0.8, BASE_THR = 0.35;
  var MORPH_MS = 700, EDGE_FADE_MS = 700, KO_MS = 3000, STIM_GAP_MS = 400, STIM_MSG_MS = 4000;
  var WAVE_FADE_MS = 600, WAVE_EDGE_MS = 300, RING_MS = 200, RING_PX = 40, GLOW_PX = 7.5;
  var CELL_STAGGER_MS = 10, CELL_FADE_MS = 150;
  var READOUT_MS = 1000, CORR_EVERY = 4, MAX_FRAME_MS = 67, FORCED_HOLD_MS = 2000, STIM_PARAM_DELAY_MS = 600;
  var LABEL_PX = 10;         /* floor for every canvas label */
  var STRANDED_MIN = 0.005;  /* stranded carbon below this fraction of the uptake is not worth a sentence */
  /* Reduced motion writes the pulse at 4.2 s of the frozen page: left of centre, so the response and its
     spread over the hops sit in the middle of the page. */
  var STATIC_STIM_AT = Math.floor(BUF * 0.42);
  var STATE_DESC = ['EEG montage', 'Connectivity graph', 'Metabolic network', 'Adjacency matrix'];

  var ctx = null, Wc = 0, Hc = 0;
  var gen = createGenerator(SEED, DEFAULT_COUPLING);
  var resetCount = 0;
  var state = 0, prevState = 0, morphing = false, morphStart = 0;
  var nodeX = new Float32Array(N), nodeY = new Float32Array(N), nodeR = new Float32Array(N);
  var fromX = new Float32Array(N), fromY = new Float32Array(N), fromR = new Float32Array(N);
  var toX = new Float32Array(N), toY = new Float32Array(N), toR = new Float32Array(N);
  var head = null, meta = null, mat = null;
  var edgeFade = 0, edgeFadeTarget = 0, edgeFadeFrom = 0, edgeFadeStart = -1;
  var thr = BASE_THR, showLabels = true;
  var hover = -1, hoverFocus = -1, hoverReaction = -1, hoverCell = -1;
  var frameCount = 0, lastNow = 0, acc = 0, running = false, rafId = 0, dirty = true;
  var lastReadout = 0, readoutText = '', messageUntil = 0;
  var forcedUntil = 0;

  /* Stimulation (one visible wave at a time; the generator queues the evoked potentials itself). */
  var stim = { active: false, start: 0, node: -1, maxHop: 0, dist: new Int32Array(N), parent: new Int32Array(N) };
  var lastStim = -1e9;

  /* Metabolism state. */
  var koUntil = new Float64Array(R), enabled = new Uint8Array(R), fluxRes = null;
  var PARTICLES = 8, phases = new Float32Array(R * PARTICLES), pcount = new Uint8Array(R);
  var forcedKnockout = -1, restored = false;
  (function () { var pr = Lab.rng(11); for (var i = 0; i < phases.length; i++) phases[i] = pr(); })();

  /* Matrix state. */
  var fillStart = -1;

  function nowMs() { return performance.now(); }
  function setReadout(text) {
    if (text === readoutText) return;
    readoutText = text;
    readoutEl.textContent = text;
  }
  /* User-triggered messages also reach the live region; the periodic summaries never do. */
  function announce(text) {
    setReadout(text);
    liveEl.textContent = text;
  }
  function requestRender() {
    dirty = true;
    if (reduce) render(nowMs());
  }

  /* ---------------------------------------------------------------------
     Offscreen EEG page (8 channels, 10 s, oscilloscope write head)
     --------------------------------------------------------------------- */
  var PAGE_CH = ['Fp1', 'F3', 'C3', 'P3', 'O1', 'Fz', 'Cz', 'Pz'].map(Lab.electrodeIndex);
  var page = document.createElement('canvas'), pctx = page.getContext('2d');
  var pg = { x: 0, y: 0, w: 0, h: 0, gutter: 32, axisH: 14, tx: 0, ty: 0, tw: 0, th: 0, rowH: 0, spp: 1, gain: 1, clampY: 1 };
  var painted = 0, paintedLap = 0, prevY = new Float32Array(PAGE_CH.length), prevValid = new Uint8Array(PAGE_CH.length);
  var GAP_PX = 8;            /* columns erased ahead of the write head */
  var TAG_W = 22, TAG_GAP = 4; /* "TMS" tag width and its distance from the pulse marker */
  var SCALE_W = 3 + Math.ceil(3 * LABEL_PX * CHAR_W); /* extent of the "1 s" scale label from the page origin */

  function pageLayout(dpr) {
    pg.x = head.pageX; pg.y = head.pageY; pg.w = Math.max(40, Math.round(head.pageW)); pg.h = Math.max(40, Math.round(head.pageH));
    pg.gutter = pg.w < 300 ? 26 : 32;
    pg.tx = pg.gutter; pg.ty = pg.axisH + 3; pg.tw = Math.max(10, pg.w - pg.gutter - 6); pg.th = Math.max(10, pg.h - pg.ty - 4);
    pg.rowH = pg.th / PAGE_CH.length; pg.spp = BUF / pg.tw; pg.gain = pg.rowH * 0.2; pg.clampY = pg.rowH * 0.62;
    var bw = Math.round(pg.w * dpr), bh = Math.round(pg.h * dpr);
    if (page.width !== bw || page.height !== bh) { page.width = bw; page.height = bh; }
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /* Page column of a pulse marker, -1 when the pulse is off the page or belongs to another lap. */
  function pulseColumn(ps, lapBase) {
    if (gen.n - ps > BUF || Math.floor(ps / BUF) * BUF !== lapBase) return -1;
    return Math.floor((ps % BUF) / pg.spp);
  }
  /* The TMS tag sits right of its marker (past the scale label when the marker is at the page start), left
     of it when it would run past the page edge. */
  function tagSpan(pc) {
    var x0 = Math.max(pc, SCALE_W) + TAG_GAP;
    if (x0 + TAG_W <= pg.tw) return { x0: x0, x1: x0 + TAG_W, align: 'left' };
    return { x0: pc - TAG_GAP - TAG_W, x1: pc - TAG_GAP, align: 'right' };
  }
  /* Axis row above the traces for page columns [x0, x1): baseline, second ticks, the scale label and the TMS
     tags of the pulses of lap lapBase. The tags get a halo in the surface colour so they never blend with
     the ticks or the scale label. */
  function drawAxis(x0, x1, lapBase) {
    pctx.save();
    pctx.beginPath(); pctx.rect(x0, 0, x1 - x0, pg.axisH + 1); pctx.clip();
    pctx.clearRect(x0, 0, x1 - x0, pg.axisH + 1);
    pctx.strokeStyle = t.line; pctx.lineWidth = 1;
    pctx.beginPath(); pctx.moveTo(pg.tx, pg.axisH - 0.5); pctx.lineTo(pg.tx + pg.tw, pg.axisH - 0.5); pctx.stroke();
    pctx.fillStyle = t.muted;
    for (var k = 0; k <= PAGE_S; k++) pctx.fillRect(Math.round(pg.tx + k * pg.tw / PAGE_S), pg.axisH - 5, 1, 5);
    pctx.font = Lab.font(LABEL_PX, t); pctx.textBaseline = 'alphabetic'; pctx.textAlign = 'left';
    pctx.fillText('1 s', pg.tx + 3, pg.axisH - 6);
    pctx.font = Lab.font(LABEL_PX, t, 500); pctx.fillStyle = t.accent; pctx.strokeStyle = t.surface; pctx.lineWidth = 2;
    for (k = 0; k < gen.pulses.length; k++) {
      var pc = pulseColumn(gen.pulses[k], lapBase);
      if (pc < 0) continue;
      var sp = tagSpan(pc), x = pg.tx + (sp.align === 'left' ? sp.x0 : sp.x1);
      pctx.textAlign = sp.align;
      pctx.strokeText('TMS', x, pg.axisH - 6); pctx.fillText('TMS', x, pg.axisH - 6);
    }
    pctx.restore();
  }
  /* A fresh pulse gets its tag at once: the write head only repaints columns ahead of the marker. */
  function paintTag(ps) {
    var lapBase = Math.floor(ps / BUF) * BUF, sp = tagSpan(pulseColumn(ps, lapBase));
    drawAxis(pg.tx + sp.x0, pg.tx + sp.x1, lapBase);
  }
  function clearTraces(x0, x1) {
    pctx.clearRect(x0, pg.axisH + 1, x1 - x0, pg.h - pg.axisH - 1);
  }
  /* Channel labels; rows tighter than the label size (short frames) label every other channel. */
  function drawGutter() {
    pctx.clearRect(0, 0, pg.gutter, pg.h);
    pctx.font = Lab.font(LABEL_PX, t);
    pctx.fillStyle = t.muted; pctx.textAlign = 'right'; pctx.textBaseline = 'middle';
    var every = pg.rowH >= LABEL_PX + 1 ? 1 : 2;
    for (var c = 0; c < PAGE_CH.length; c += every) pctx.fillText(MONTAGE[PAGE_CH[c]].name, pg.gutter - 6, pg.ty + pg.rowH * (c + 0.5));
  }
  /* Paint columns [c0, c1) of the current lap from the ring buffer. Column c holds samples [c*spp, (c+1)*spp).
     NEGATIVE UP: y = centre + value * gain, so a positive potential deflects the trace downwards. */
  function paintColumns(c0, c1, lapBase) {
    if (c1 <= c0) return;
    clearTraces(pg.tx + c0, pg.tx + c1);
    pctx.lineWidth = 1; pctx.lineCap = 'butt'; pctx.lineJoin = 'miter';
    var ch, c, k, s0, s1, v, mn, mx, last, anyMark, y, x, yMin, yMax;
    for (ch = 0; ch < PAGE_CH.length; ch++) {
      var base = PAGE_CH[ch] * BUF, cy = pg.ty + pg.rowH * (ch + 0.5);
      var colorNow = '', started = false;
      pctx.beginPath();
      for (c = c0; c < c1; c++) {
        s0 = Math.floor(c * pg.spp); s1 = Math.max(s0 + 1, Math.floor((c + 1) * pg.spp));
        if (lapBase + s0 < 0 || lapBase + s1 > gen.n) { prevValid[ch] = 0; continue; }
        mn = 1e9; mx = -1e9; anyMark = 0;
        for (k = s0; k < s1 && k < BUF; k++) {
          v = gen.buf[base + k];
          if (v < mn) mn = v; if (v > mx) mx = v;
          last = v;
          anyMark |= gen.mark[base + k];
        }
        var col = anyMark ? t.accent : t.trace;
        if (col !== colorNow) {
          if (started) pctx.stroke();
          pctx.beginPath(); pctx.strokeStyle = col; colorNow = col; started = true;
        }
        x = pg.tx + c + 0.5;
        yMin = cy + Lab.clamp(mn * pg.gain, -pg.clampY, pg.clampY);
        yMax = cy + Lab.clamp(mx * pg.gain, -pg.clampY, pg.clampY);
        y = cy + Lab.clamp(last * pg.gain, -pg.clampY, pg.clampY);
        if (prevValid[ch]) { pctx.moveTo(x - 1, prevY[ch]); pctx.lineTo(x, yMin); } else pctx.moveTo(x, yMin);
        pctx.lineTo(x, yMax);
        prevY[ch] = y; prevValid[ch] = 1;
      }
      if (started) pctx.stroke();
    }
    /* Pulse markers: a vertical accent line through the traces (the TMS tag lives in the axis row). */
    pctx.strokeStyle = Lab.rgba(t.accent, 0.85); pctx.lineWidth = 1;
    for (k = 0; k < gen.pulses.length; k++) {
      var pc = pulseColumn(gen.pulses[k], lapBase);
      if (pc < c0 || pc >= c1) continue;
      x = pg.tx + pc + 0.5;
      pctx.beginPath(); pctx.moveTo(x, pg.ty); pctx.lineTo(x, pg.ty + pg.th); pctx.stroke();
    }
  }
  /* Full repaint. The generator always holds at least one page (n >= BUF), so the columns ahead of the write
     head show the previous lap. */
  function repaintPage() {
    if (!pg.w) return;
    pctx.clearRect(0, 0, pg.w, pg.h);
    drawGutter();
    prevValid.fill(0);
    var n = gen.n, curCol = Math.floor((n % BUF) / pg.spp), lap = Math.floor(n / BUF) * BUF;
    if (curCol === 0) {
      paintColumns(0, pg.tw, lap - BUF); drawAxis(pg.tx - 1, pg.tx + pg.tw + 1, lap - BUF);
    } else {
      paintColumns(0, curCol, lap); drawAxis(pg.tx - 1, pg.tx + curCol, lap);
      var gapEnd = Math.min(pg.tw, curCol + GAP_PX);
      prevValid.fill(0);
      paintColumns(gapEnd, pg.tw, lap - BUF); drawAxis(pg.tx + gapEnd, pg.tx + pg.tw + 1, lap - BUF);
    }
    painted = curCol;
    paintedLap = Math.floor(n / BUF);
  }
  /* Live update: paint the columns completed since the last frame, erase the gap ahead of the write head
     (wrapping at the page end, where the columns belong to the next lap) and redraw its axis row. */
  function advancePage() {
    var n = gen.n, lap = Math.floor(n / BUF), complete = Math.floor((n % BUF) / pg.spp);
    if (lap > paintedLap) {
      paintColumns(painted, pg.tw, (lap - 1) * BUF);
      painted = 0; paintedLap = lap; prevValid.fill(0);
    }
    if (complete > painted) {
      paintColumns(painted, complete, lap * BUF);
      painted = complete;
    }
    var gx0 = pg.tx + painted, gx1 = Math.min(pg.tx + pg.tw, gx0 + GAP_PX);
    clearTraces(gx0, gx1); drawAxis(gx0, gx1, lap * BUF);
    var wrap = GAP_PX - (gx1 - gx0);
    if (wrap > 0) { clearTraces(pg.tx, pg.tx + wrap); drawAxis(pg.tx, pg.tx + wrap, (lap + 1) * BUF); }
  }

  /* ---------------------------------------------------------------------
     Layout, buttons and the text equivalent of the matrix
     --------------------------------------------------------------------- */
  var electrodeButtons = [], reactionButtons = [];
  for (var bi = 0; bi < N; bi++) {
    var eb = document.createElement('button');
    eb.type = 'button'; eb.className = 'electrode';
    eb.setAttribute('aria-label', 'Stimulate ' + MONTAGE[bi].name);
    eb.dataset.index = String(bi);
    buttonsEl.appendChild(eb);
    electrodeButtons.push(eb);
  }
  for (var rbI = 0; rbI < R; rbI++) {
    var rb = document.createElement('button');
    rb.type = 'button'; rb.className = 'reaction'; rb.hidden = true;
    rb.setAttribute('aria-label', 'Knock out ' + REACTIONS[rbI].label);
    rb.setAttribute('aria-pressed', 'false');
    rb.dataset.index = String(rbI);
    buttonsEl.appendChild(rb);
    reactionButtons.push(rb);
  }
  var matrixDesc = document.createElement('p');
  matrixDesc.className = 'visually-hidden'; matrixDesc.id = 'stage-matrix-desc'; matrixDesc.hidden = true;
  matrixDesc.textContent = 'Adjacency matrix, ' + M + ' by ' + M + ': a cell is 1 where a reaction runs from the row metabolite to the column metabolite. Reactions: ' +
    REACTIONS.map(function (r) { return r.label; }).join(', ') + '.';
  frame.appendChild(matrixDesc);

  function targetFor(s, x, y, r) {
    var src = s <= 1 ? head : s === 2 ? meta : mat, i;
    for (i = 0; i < N; i++) { x[i] = src.x[i]; y[i] = src.y[i]; r[i] = s === 3 ? 3 : 5; }
  }
  /* Electrode targets are sized from the head: 85% of the closest electrode spacing, between 28 and 44 px, so
     neighbours do not overlap on a small head while desktop keeps the full 44 px. */
  function positionButtons() {
    var minDist = Infinity, i, j;
    for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) minDist = Math.min(minDist, Math.hypot(head.x[i] - head.x[j], head.y[i] - head.y[j]));
    var size = Lab.clamp(Math.round(0.85 * minDist), 28, 44), half = -size / 2 + 'px';
    for (i = 0; i < N; i++) {
      var es = electrodeButtons[i].style;
      es.left = head.x[i].toFixed(1) + 'px'; es.top = head.y[i].toFixed(1) + 'px';
      es.width = size + 'px'; es.height = size + 'px'; es.margin = half + ' 0 0 ' + half;
    }
    for (i = 0; i < R; i++) {
      var re = REACTIONS[i], rs = reactionButtons[i].style;
      rs.left = ((meta.x[re.from] + meta.x[re.to]) / 2).toFixed(1) + 'px'; rs.top = ((meta.y[re.from] + meta.y[re.to]) / 2).toFixed(1) + 'px';
    }
  }
  function layout() {
    var f = Lab.fitCanvas(canvas);
    ctx = f.ctx; Wc = f.w; Hc = f.h;
    head = headLayout(Wc, Hc, PAD);
    meta = metabolicLayout(Wc, Hc, PAD);
    mat = matrixLayout(Wc, Hc, PAD, LABEL_PX);
    showLabels = Wc >= COMPACT_W;
    targetFor(state, toX, toY, toR);
    if (morphing) targetFor(prevState, fromX, fromY, fromR);
    else { nodeX.set(toX); nodeY.set(toY); nodeR.set(toR); }
    pageLayout(f.dpr);
    repaintPage();
    positionButtons();
    requestRender();
  }

  /* ---------------------------------------------------------------------
     Controls (state 0-1: Coupling range and Reset; state 2: Restore; state 3: nothing)
     --------------------------------------------------------------------- */
  var couplingLabel = document.createElement('label');
  var couplingInput = document.createElement('input');
  couplingInput.type = 'range'; couplingInput.min = '0.2'; couplingInput.max = '1.6'; couplingInput.step = '0.05'; couplingInput.value = String(DEFAULT_COUPLING);
  couplingInput.id = 'stage-coupling';
  couplingLabel.appendChild(document.createTextNode('Coupling'));
  couplingLabel.appendChild(couplingInput);
  var resetBtn = document.createElement('button');
  resetBtn.type = 'button'; resetBtn.className = 'btn btn-ghost btn-small'; resetBtn.textContent = 'Reset';
  resetBtn.setAttribute('aria-label', 'Reset the simulation');
  var restoreBtn = document.createElement('button');
  restoreBtn.type = 'button'; restoreBtn.className = 'btn btn-ghost btn-small'; restoreBtn.textContent = 'Restore';
  restoreBtn.setAttribute('aria-label', 'Restore all reactions');
  function setControls(s) {
    while (controlsEl.firstChild) controlsEl.removeChild(controlsEl.firstChild);
    if (s <= 1) { controlsEl.appendChild(couplingLabel); controlsEl.appendChild(resetBtn); }
    else if (s === 2) controlsEl.appendChild(restoreBtn);
  }

  /* ---------------------------------------------------------------------
     Readout texts
     --------------------------------------------------------------------- */
  function summaryText() {
    var s = gen.summary();
    return 'Strongest pair ' + MONTAGE[s.a].name + '-' + MONTAGE[s.b].name + ', r = ' + s.r.toFixed(2) + '.';
  }
  function fluxText() {
    var txt = 'Biomass ' + Math.round(fluxRes.biomassFraction * 100) + '% of wild type. ' + fluxRes.carrying + ' of ' + R + ' reactions carry flux.';
    if (fluxRes.stranded > STRANDED_MIN * UPTAKE) txt += ' ' + Math.round(fluxRes.stranded / UPTAKE * 100) + '% stranded.';
    return txt + ' Toy network.';
  }
  function matrixText() {
    var count = ADJ_ONES + ' of ' + (M * M) + ' cells are 1.';
    if (hoverCell < 0) return count;
    var row = Math.floor(hoverCell / M), col = hoverCell % M;
    return METABOLITES[row] + ' to ' + METABOLITES[col] + ': ' + (ADJ[hoverCell] ? 'edge' : 'no edge') + '. ' + count;
  }
  /* Periodic summary of states 0 and 1, held back while a stimulation message is on show. */
  function updateCorrelationReadout(now) {
    if (now >= messageUntil) setReadout(summaryText());
  }

  /* ---------------------------------------------------------------------
     State machine
     --------------------------------------------------------------------- */
  var beats = section ? Array.prototype.slice.call(section.querySelectorAll('[data-stage-step]')) : [];
  function markBeat(s) {
    for (var i = 0; i < beats.length; i++) beats[i].classList.toggle('is-active', +beats[i].dataset.stageStep === s);
  }
  function setState(n) {
    n = Lab.clamp(Math.round(+n) || 0, 0, 3);
    if (n === state) return;
    var now = nowMs(), i;
    prevState = state; state = n;
    root.dataset.state = String(n);
    markBeat(n);
    setControls(n);
    matrixDesc.hidden = n !== 3;
    for (i = 0; i < N; i++) electrodeButtons[i].hidden = n > 1;
    for (i = 0; i < R; i++) reactionButtons[i].hidden = n !== 2;
    hover = -1; hoverFocus = -1; hoverReaction = -1; hoverCell = -1;
    messageUntil = 0;
    if (prevState <= 1 && n <= 1) {
      startEdgeFade(n, now);
    } else {
      fromX.set(nodeX); fromY.set(nodeY); fromR.set(nodeR);
      targetFor(n, toX, toY, toR);
      if (reduce) { nodeX.set(toX); nodeY.set(toY); nodeR.set(toR); morphing = false; }
      else { morphing = true; morphStart = now; }
      edgeFade = n === 1 ? 1 : 0; edgeFadeTarget = edgeFade; edgeFadeStart = -1;
      if (n <= 1) { acc = 0; stim.active = false; }
    }
    announce(STATE_DESC[n]);
    if (n <= 1) { lastReadout = now; setReadout(summaryText()); }
    if (n === 2) {
      if (forcedKnockout >= 0 && !restored && !koUntil[forcedKnockout]) koUntil[forcedKnockout] = Infinity;
      recomputeFlux();
      setReadout(fluxText());
    }
    if (n === 3) {
      fillStart = reduce ? -1e9 : now + (morphing ? MORPH_MS : 0);
      setReadout(matrixText());
    }
    requestRender();
  }
  function startEdgeFade(target, now) {
    if (reduce) { edgeFade = target; edgeFadeTarget = target; edgeFadeStart = -1; return; }
    edgeFadeFrom = edgeFade; edgeFadeTarget = target; edgeFadeStart = now;
  }

  /* ---------------------------------------------------------------------
     Stimulation, reset, coupling
     --------------------------------------------------------------------- */
  function refreshCorrelation() {
    gen.correlate();
    thr = gen.threshold(BASE_THR);
  }
  function stimulate(which) {
    var idx = typeof which === 'number' ? which : Lab.electrodeIndex(which);
    if (idx < 0 || idx >= N || state > 1) return;
    var now = nowMs();
    if (now - lastStim < STIM_GAP_MS) return;
    lastStim = now;
    refreshCorrelation();
    var adj = gen.adjacency(thr);
    if (!adj.edgeCount || adj[idx].length === 0) adj = gen.hiddenAdjacency();
    var tree = bfsTree(adj, idx), reached = 0, i;
    for (i = 0; i < N; i++) if (tree.dist[i] > 0) reached++;
    stim.active = true; stim.start = now; stim.node = idx; stim.maxHop = tree.maxHop;
    stim.dist.set(tree.dist); stim.parent.set(tree.parent);
    if (reduce) {
      /* The frozen page is regenerated from its seed first, so repeated stimulations replace the previous
         evoked response instead of stacking on top of it. */
      gen.reseed(gen.seed); gen.advance(BUF);
      gen.injectStatic(tree, STATIC_STIM_AT);
      refreshCorrelation();
      repaintPage();
    } else {
      gen.stimulate(idx, tree);
      paintTag(gen.n);
    }
    messageUntil = now + STIM_MSG_MS;
    announce('Stimulated ' + MONTAGE[idx].name + '. The wave reached ' + reached + ' of ' + N + ' electrodes; the farthest at ' + (tree.maxHop * HOP_MS) + ' ms.');
    requestRender();
  }
  function resetSimulation() {
    resetCount++;
    gen.reseed(SEED + resetCount * 7919);
    stim.active = false; acc = 0;
    gen.advance(BUF);
    refreshCorrelation();
    repaintPage();
    messageUntil = 0; lastReadout = nowMs();
    announce('Simulation reset. ' + summaryText());
    requestRender();
  }
  function setCoupling(v) {
    v = Lab.clamp(+v || DEFAULT_COUPLING, 0.2, 1.6);
    gen.setCoupling(v);
    if (couplingInput.value !== String(v)) couplingInput.value = String(v);
    if (reduce) {
      /* The frozen page is regenerated with the new coupling; a static evoked response is written again. */
      gen.reseed(gen.seed); gen.advance(BUF);
      if (stim.active) gen.injectStatic(stim, STATIC_STIM_AT);
      refreshCorrelation();
      repaintPage();
    }
    announce('Coupling ' + v.toFixed(2) + '.' + (reduce ? ' ' + summaryText() : ''));
    requestRender();
  }

  /* ---------------------------------------------------------------------
     Flux and knockouts
     --------------------------------------------------------------------- */
  function recomputeFlux() {
    var now = nowMs(), i;
    for (i = 0; i < R; i++) {
      enabled[i] = koUntil[i] > now ? 0 : 1;
      reactionButtons[i].setAttribute('aria-pressed', enabled[i] ? 'false' : 'true');
    }
    fluxRes = flux(enabled);
    for (i = 0; i < R; i++) pcount[i] = enabled[i] ? Math.min(PARTICLES, Math.ceil(fluxRes.fluxes[i] * 0.6)) : 0;
    dirty = true;
  }
  /* Reduced motion has no frame loop, so a timer restores a temporary knockout. */
  var koTimers = [];
  function knockout(idx, persistent) {
    if (idx < 0 || idx >= R) return;
    koUntil[idx] = persistent ? Infinity : nowMs() + KO_MS;
    recomputeFlux();
    announce(fluxText());
    if (reduce) {
      if (koTimers[idx]) clearTimeout(koTimers[idx]);
      if (!persistent) koTimers[idx] = setTimeout(function () { koTimers[idx] = 0; expireKnockouts(nowMs()); }, KO_MS + 20);
      render(nowMs());
    }
  }
  function restore() {
    for (var i = 0; i < R; i++) { koUntil[i] = 0; if (koTimers[i]) { clearTimeout(koTimers[i]); koTimers[i] = 0; } }
    restored = true;
    recomputeFlux();
    announce(fluxText());
    if (reduce) render(nowMs());
  }
  function expireKnockouts(now) {
    var changed = false;
    for (var i = 0; i < R; i++) if (koUntil[i] && now >= koUntil[i]) { koUntil[i] = 0; changed = true; }
    if (!changed) return;
    recomputeFlux();
    setReadout(fluxText());
    if (reduce) render(now);
  }

  /* ---------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------- */
  /* Ring electrodes: label pushed radially outward. Inner electrodes: label above and to the right. */
  var lo = { dx: 0, dy: 0, align: 'left' };
  function labelOffset(i) {
    var dx = MONTAGE[i].x, dy = -MONTAGE[i].y, len = Math.hypot(dx, dy);
    if (len < 0.9) { lo.dx = 0.55; lo.dy = -0.85; lo.align = 'left'; }
    else { lo.dx = dx / len; lo.dy = dy / len; lo.align = Math.abs(lo.dx) < 0.3 ? 'center' : (lo.dx < 0 ? 'right' : 'left'); }
  }

  function drawHeadLayer(alpha, now) {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    Lab.drawHead(ctx, head.cx, head.cy, head.r, t);
    /* Functional connectivity edges under the nodes; a hovered electrode keeps its own edges at full strength. */
    if (edgeFade > 0.002) {
      var p, a, b, r;
      ctx.lineCap = 'round';
      for (p = 0; p < P; p++) {
        r = gen.absr[p];
        if (r <= thr) continue;
        a = PA[p]; b = PB[p];
        var ea = Math.min(1, r) * edgeFade;
        if (hover >= 0) ea = (a === hover || b === hover) ? 1 : ea * 0.15;
        ctx.strokeStyle = Lab.rgba(t.accent, ea);
        ctx.lineWidth = 0.5 + 2 * r;
        ctx.beginPath(); ctx.moveTo(nodeX[a], nodeY[a]); ctx.lineTo(nodeX[b], nodeY[b]); ctx.stroke();
      }
    }
    if (stim.active) drawStim(now);
    if (showLabels) {
      ctx.textBaseline = 'middle';
      for (var i = 0; i < N; i++) {
        labelOffset(i);
        var isH = i === hover;
        var off = nodeR[i] + (isH ? 9 : 6);
        ctx.font = isH ? Lab.font(12.5, t, 600) : Lab.font(Wc < 560 ? 10 : 11, t);
        ctx.textAlign = lo.align;
        ctx.fillStyle = isH ? t.ink : t.muted;
        ctx.fillText(MONTAGE[i].name, nodeX[i] + lo.dx * off, nodeY[i] + lo.dy * off);
      }
    }
    ctx.drawImage(page, 0, 0, page.width, page.height, pg.x, pg.y, pg.w, pg.h);
    ctx.restore();
  }
  /* Stimulation wave: expanding ring, traversed edges, nodes lighting per hop. The reduced-motion picture is
     the whole tree at once, dimmer with the hop count. */
  function drawStim(now) {
    /* The rAF timestamp can trail performance.now() by a frame, so elapsed time is clamped at zero. */
    var e = reduce ? 1e9 : Math.max(0, now - stim.start), i, d, a;
    if (!reduce && e > stim.maxHop * HOP_MS + WAVE_FADE_MS) { stim.active = false; return; }
    var sx = nodeX[stim.node], sy = nodeY[stim.node];
    if (reduce || e < RING_MS) {
      var u = reduce ? 1 : e / RING_MS;
      ctx.strokeStyle = Lab.rgba(t.accent, reduce ? 0.5 : 1 - u); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, RING_PX * u, 0, TAU); ctx.stroke();
    }
    ctx.lineCap = 'round';
    for (i = 0; i < N; i++) {
      d = stim.dist[i];
      if (d <= 0) continue;
      a = reduce ? 0.8 : 1 - (e - (d - 1) * HOP_MS) / WAVE_EDGE_MS;
      if (a <= 0 || a > 1) continue;
      ctx.strokeStyle = Lab.rgba(t.accent, a); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(nodeX[stim.parent[i]], nodeY[stim.parent[i]]); ctx.lineTo(nodeX[i], nodeY[i]); ctx.stroke();
    }
    for (i = 0; i < N; i++) {
      d = stim.dist[i];
      if (d < 0) continue;
      a = reduce ? 1 - 0.6 * d / Math.max(1, stim.maxHop) : 1 - (e - d * HOP_MS) / WAVE_FADE_MS;
      if (a <= 0 || a > 1) continue;
      ctx.fillStyle = Lab.rgba(t.accent, a);
      ctx.beginPath(); ctx.arc(nodeX[i], nodeY[i], GLOW_PX, 0, TAU); ctx.fill();
    }
  }

  function arrow(x0, y0, x1, y1, r0, r1, width, color, dashed, headLen) {
    var dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < r0 + r1 + 2) return;
    var ux = dx / len, uy = dy / len;
    var ax = x0 + ux * r0, ay = y0 + uy * r0, bx = x1 - ux * r1, by = y1 - uy * r1;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx - ux * headLen * 0.6, by - uy * headLen * 0.6); ctx.stroke();
    if (dashed) ctx.setLineDash([]);
    var hw = headLen * 0.55;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - ux * headLen - uy * hw, by - uy * headLen + ux * hw);
    ctx.lineTo(bx - ux * headLen + uy * hw, by - uy * headLen - ux * hw);
    ctx.closePath(); ctx.fill();
  }
  function drawMetaLayer(alpha) {
    if (alpha <= 0.002 || !fluxRes) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    var i, re, fx, wdt;
    /* Reactions: width 1 to 6 px with flux, dashed muted when knocked out, accent and thicker when hovered. */
    for (i = 0; i < R; i++) {
      re = REACTIONS[i]; fx = fluxRes.fluxes[i];
      var ko = !enabled[i], hi = i === hoverReaction;
      wdt = (ko ? 1 : 1 + 5 * Math.min(1, fx / 12)) + (hi ? 1 : 0);
      var col = hi ? t.accent : ko ? t.muted : Lab.rgba(t.ink, 0.4 + 0.35 * Math.min(1, fx / 12));
      arrow(nodeX[re.from], nodeY[re.from], nodeX[re.to], nodeY[re.to], nodeR[re.from] + 2, nodeR[re.to] + 2, wdt, col, ko, 4 + wdt * 0.6);
    }
    /* Biomass drains as short stubs; compact frames leave them unlabelled and let the readout carry the numbers. */
    ctx.font = Lab.font(LABEL_PX, t); ctx.textBaseline = 'middle';
    for (i = 0; i < meta.stubs.length; i++) {
      var st = meta.stubs[i], n0 = st.node, dv = fluxRes.drains[i];
      var x0 = nodeX[n0] + st.dx * (nodeR[n0] + 2), y0 = nodeY[n0] + st.dy * (nodeR[n0] + 2);
      var x1 = nodeX[n0] + st.dx * (nodeR[n0] + 2 + meta.stubLen), y1 = nodeY[n0] + st.dy * (nodeR[n0] + 2 + meta.stubLen);
      arrow(x0, y0, x1, y1, 0, 0, 1 + 1.5 * Math.min(1, dv / 1.2), Lab.rgba(t.muted, dv > 0.01 ? 0.9 : 0.35), false, 3.5);
      if (meta.compact) continue;
      ctx.fillStyle = Lab.rgba(t.muted, 0.9);
      ctx.textAlign = Math.abs(st.dx) < 0.3 ? 'center' : st.dx > 0 ? 'left' : 'right';
      ctx.fillText('biomass', x1 + st.dx * 4, y1 + st.dy * 8);
    }
    /* Particles: accent dots travelling along each reaction, count and speed with flux. */
    ctx.fillStyle = t.accent;
    for (i = 0; i < R; i++) {
      var pc = pcount[i];
      if (!pc) continue;
      re = REACTIONS[i];
      var ax = nodeX[re.from], ay = nodeY[re.from], bx = nodeX[re.to], by = nodeY[re.to];
      for (var k = 0; k < pc; k++) {
        var ph = phases[i * PARTICLES + k];
        ctx.beginPath(); ctx.arc(ax + (bx - ax) * ph, ay + (by - ay) * ph, 1.9, 0, TAU); ctx.fill();
      }
    }
    ctx.font = Lab.font(meta.labelPx, t); ctx.textBaseline = 'middle'; ctx.fillStyle = t.muted;
    for (i = 0; i < M; i++) {
      var an = meta.anchors[i], off = nodeR[i] + 7;
      ctx.textAlign = an.align;
      ctx.fillText(METABOLITES[i], nodeX[i] + an.dx * off, nodeY[i] + an.dy * off + (an.dy > 0.5 ? 4 : an.dy < -0.5 ? -4 : 0));
    }
    ctx.restore();
  }

  function drawMatrixLayer(alpha, now) {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    var cs = mat.cs, gx = mat.gx, gy = mat.gy, i, j, k;
    var hr = hoverCell >= 0 ? Math.floor(hoverCell / M) : -1, hc = hoverCell >= 0 ? hoverCell % M : -1;
    if (hr >= 0) {
      ctx.fillStyle = t.accentSoft;
      ctx.fillRect(gx, gy + hr * cs, cs * M, cs);
      ctx.fillRect(gx + hc * cs, gy, cs, cs * M);
    }
    ctx.strokeStyle = t.line; ctx.lineWidth = 1;
    for (k = 0; k <= M; k++) {
      ctx.beginPath(); ctx.moveTo(gx + k * cs + 0.5, gy); ctx.lineTo(gx + k * cs + 0.5, gy + cs * M); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx, gy + k * cs + 0.5); ctx.lineTo(gx + cs * M, gy + k * cs + 0.5); ctx.stroke();
    }
    /* Cells fill in row order, staggered, once the morph has landed. */
    var elapsed = now - fillStart, inset = Math.max(1, cs * 0.12);
    for (i = 0; i < M; i++) {
      for (j = 0; j < M; j++) {
        k = i * M + j;
        if (!ADJ[k]) continue;
        var a = Lab.clamp((elapsed - k * CELL_STAGGER_MS) / CELL_FADE_MS, 0, 1);
        if (a <= 0) continue;
        ctx.fillStyle = Lab.rgba(k === hoverCell ? t.accent : t.ink, a);
        ctx.fillRect(gx + j * cs + inset, gy + i * cs + inset, cs - 2 * inset, cs - 2 * inset);
      }
    }
    if (hoverCell >= 0 && !ADJ[hoverCell]) {
      ctx.strokeStyle = t.accent; ctx.lineWidth = 1.5;
      ctx.strokeRect(gx + hc * cs + 1, gy + hr * cs + 1, cs - 2, cs - 2);
    }
    /* Labels: rows right-aligned left of the grid (the nodes sit on them), columns rotated above their marks. */
    ctx.font = Lab.font(mat.labelPx, t);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (i = 0; i < M; i++) {
      ctx.fillStyle = i === hr ? t.accent : t.muted;
      ctx.fillText(METABOLITES[i], gx - 14, gy + cs * (i + 0.5));
    }
    for (j = 0; j < M; j++) {
      if (mat.colLabels) {
        ctx.save();
        ctx.translate(gx + cs * (j + 0.5), gy - 12);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'left';
        ctx.fillStyle = j === hc ? t.accent : t.muted;
        ctx.fillText(METABOLITES[j], 0, 0);
        ctx.restore();
      }
      ctx.fillStyle = j === hc ? t.accent : t.ink;
      ctx.beginPath(); ctx.arc(gx + cs * (j + 0.5), gy - 6, 3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawNodes() {
    for (var i = 0; i < N; i++) {
      var isH = state <= 1 && i === hover;
      ctx.beginPath(); ctx.arc(nodeX[i], nodeY[i], nodeR[i] + (isH ? 1.5 : 0), 0, TAU);
      ctx.fillStyle = isH ? t.accent : t.ink;
      ctx.fill();
      if (state === 3 && !morphing) continue;
      ctx.lineWidth = 1.5; ctx.strokeStyle = t.surface; ctx.stroke();
    }
  }

  function drawLayer(s, alpha, now) {
    if (s <= 1) drawHeadLayer(alpha, now);
    else if (s === 2) drawMetaLayer(alpha);
    else drawMatrixLayer(alpha, now);
  }
  function render(now) {
    if (!ctx) return;
    ctx.clearRect(0, 0, Wc, Hc);
    var p = 1, i;
    if (morphing) {
      p = Lab.easeOut((now - morphStart) / MORPH_MS);
      if (now - morphStart >= MORPH_MS) { p = 1; morphing = false; }
      for (i = 0; i < N; i++) {
        nodeX[i] = fromX[i] + (toX[i] - fromX[i]) * p; nodeY[i] = fromY[i] + (toY[i] - fromY[i]) * p; nodeR[i] = fromR[i] + (toR[i] - fromR[i]) * p;
      }
    }
    /* The old layer is gone by mid-morph, the new one fades in over the second half. */
    if (morphing) drawLayer(prevState, Lab.clamp(1 - p * 2.2, 0, 1), now);
    drawLayer(state, morphing ? Lab.clamp((p - 0.45) / 0.55, 0, 1) : 1, now);
    drawNodes();
    dirty = false;
  }

  /* ---------------------------------------------------------------------
     Loop: runs only while the figure and the tab are visible, never in reduced motion
     --------------------------------------------------------------------- */
  function tick() {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    var now = nowMs();
    var dt = lastNow ? Math.min(now - lastNow, MAX_FRAME_MS) : 16;
    lastNow = now;
    frameCount++;
    var live = state <= 1 || (morphing && prevState <= 1);
    if (live) {
      acc += dt;
      var k = Math.floor(acc * FS / 1000);
      if (k > 0) { acc -= k * 1000 / FS; gen.advance(k); advancePage(); }
      if (frameCount % CORR_EVERY === 0) refreshCorrelation();
      if (edgeFadeStart >= 0) {
        var u = Lab.clamp((now - edgeFadeStart) / EDGE_FADE_MS, 0, 1);
        edgeFade = edgeFadeFrom + (edgeFadeTarget - edgeFadeFrom) * Lab.easeOut(u);
        if (u >= 1) edgeFadeStart = -1;
      }
      if (state <= 1 && now - lastReadout > READOUT_MS) { lastReadout = now; updateCorrelationReadout(now); }
    }
    var animate2 = state === 2 || (morphing && prevState === 2);
    if (animate2 && fluxRes) {
      if (state === 2) expireKnockouts(now);
      for (var i = 0; i < R; i++) {
        var pc = pcount[i];
        if (!pc) continue;
        var re = REACTIONS[i], len = Math.hypot(nodeX[re.to] - nodeX[re.from], nodeY[re.to] - nodeY[re.from]) || 1;
        var step = (dt / 1000) * (14 + 6 * fluxRes.fluxes[i]) / len;
        for (var q = 0; q < pc; q++) {
          var ph = phases[i * PARTICLES + q] + step;
          phases[i * PARTICLES + q] = ph >= 1 ? ph - 1 : ph;
        }
      }
    }
    var filling = state === 3 && now - fillStart < M * M * CELL_STAGGER_MS + CELL_FADE_MS;
    if (live || animate2 || morphing || filling || dirty) render(now);
  }
  /* Watchdog: a throttled frame rate (background iframe, low power mode) must not freeze a morph half way.
     When no frame has run for a while, one frame is produced from a timer; the rAF loop stays in charge. */
  var watchdogId = 0;
  function watchdog() {
    if (!running) return;
    watchdogId = setTimeout(watchdog, 400);
    if (nowMs() - lastNow > 350) { var keep = rafId; tick(); cancelAnimationFrame(rafId); rafId = keep; }
  }
  function start() {
    if (running) return;
    running = true; lastNow = 0; acc = 0; dirty = true;
    rafId = requestAnimationFrame(tick);
    watchdogId = setTimeout(watchdog, 400);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (watchdogId) clearTimeout(watchdogId);
    rafId = 0; watchdogId = 0;
  }

  /* ---------------------------------------------------------------------
     Events
     --------------------------------------------------------------------- */
  /* A focused electrode stays highlighted while the pointer roams. */
  function resolveHover() {
    if (hoverFocus >= 0) hover = hoverFocus;
    requestRender();
  }
  electrodeButtons.forEach(function (b) {
    var idx = +b.dataset.index;
    b.addEventListener('pointerenter', function () { hover = idx; resolveHover(); });
    b.addEventListener('pointerleave', function () { if (hover === idx) hover = -1; resolveHover(); });
    b.addEventListener('focus', function () { hoverFocus = idx; resolveHover(); });
    b.addEventListener('blur', function () { if (hoverFocus === idx) hoverFocus = -1; if (hover === idx) hover = -1; resolveHover(); });
    b.addEventListener('click', function () { stimulate(idx); });
  });
  /* Hover and focus only highlight a reaction; click, Enter or Space knock it out. */
  reactionButtons.forEach(function (b) {
    var idx = +b.dataset.index;
    function highlight() { hoverReaction = idx; requestRender(); }
    function unhighlight() { if (hoverReaction === idx) hoverReaction = -1; requestRender(); }
    b.addEventListener('pointerenter', highlight);
    b.addEventListener('focus', highlight);
    b.addEventListener('pointerleave', unhighlight);
    b.addEventListener('blur', unhighlight);
    b.addEventListener('click', function () { knockout(idx, false); });
  });
  couplingInput.addEventListener('input', function () { setCoupling(+couplingInput.value); });
  resetBtn.addEventListener('click', resetSimulation);
  restoreBtn.addEventListener('click', restore);

  /* Matrix hover (mouse only): the cell under the pointer, its row and column. */
  function cellAt(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var c = Math.floor((clientX - rect.left - mat.gx) / mat.cs), r = Math.floor((clientY - rect.top - mat.gy) / mat.cs);
    if (c < 0 || r < 0 || c >= M || r >= M) return -1;
    return r * M + c;
  }
  function setHoverCell(cell) {
    if (cell === hoverCell) return;
    hoverCell = cell;
    setReadout(matrixText());
    requestRender();
  }
  frame.addEventListener('pointermove', function (e) {
    if (state === 3 && e.pointerType !== 'touch' && mat) setHoverCell(cellAt(e.clientX, e.clientY));
  });
  frame.addEventListener('pointerleave', function () {
    if (state === 3) setHoverCell(-1);
  });

  /* Beats: the most recently intersecting step drives the state. Phones show less of a beat at a time, so a
     smaller share of it has to be in view before it takes over. */
  if (beats.length && 'IntersectionObserver' in window) {
    var bio = new IntersectionObserver(function (entries) {
      var next = -1;
      for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) next = +entries[i].target.dataset.stageStep;
      if (next < 0 || nowMs() < forcedUntil) return;
      setState(next);
    }, { threshold: window.innerWidth < 900 ? 0.35 : 0.5 });
    beats.forEach(function (b) { bio.observe(b); });
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(frame);
  else window.addEventListener('resize', layout);
  Lab.onTheme(function () { t = Lab.tokens(); repaintPage(); requestRender(); });
  Lab.fontsReady(function () { repaintPage(); requestRender(); });

  /* ---------------------------------------------------------------------
     Init and debug hooks
     --------------------------------------------------------------------- */
  if (section) section.classList.add('stage-ready');
  var forcedState = Lab.param('stage'), stimParam = Lab.param('stim'), koParam = Lab.param('knockout');
  if (koParam !== null && koParam !== '' && !isNaN(+koParam)) forcedKnockout = Lab.clamp(Math.round(+koParam), 0, R - 1);
  /* One full page is generated up front so the oscilloscope starts with a page to overwrite and the graph
     has data from the first frame; from here on the generator advances in real time. */
  gen.advance(BUF);
  refreshCorrelation();
  layout();
  setControls(state);
  markBeat(state);
  setReadout(summaryText());
  if (forcedState !== null && forcedState !== '') {
    /* Forced initial state: nothing was on screen before, so the morph, the edge fade and the matrix fill
       are snapped. Scroll-driven transitions keep their motion. The beat observer is held off for 2 s. */
    forcedUntil = nowMs() + FORCED_HOLD_MS;
    setState(+forcedState);
    if (morphing) { nodeX.set(toX); nodeY.set(toY); nodeR.set(toR); morphing = false; }
    if (state === 1) { edgeFade = 1; edgeFadeTarget = 1; edgeFadeStart = -1; }
    if (state === 3) fillStart = -1e9;
  }
  render(nowMs());
  if (stimParam) setTimeout(function () { if (state > 1) setState(1); stimulate(stimParam); }, STIM_PARAM_DELAY_MS);
  if (!reduce) Lab.whenVisible(root, start, stop);

  /* Scripted checks (see README) drive the figure through window.__stage. */
  var api = {
    setState: setState, stimulate: stimulate, knockout: function (idx) { knockout(idx, true); }, restore: restore,
    reset: resetSimulation, setCoupling: setCoupling, model: model, reduceMotion: reduce,
    threshold: function () { return thr; }, flux: function () { return fluxRes; }, generator: gen,
    positions: function () { return { x: nodeX, y: nodeY }; },
    frames: function () { return frameCount; }, fillElapsed: function () { return state === 3 ? nowMs() - fillStart : 0; }
  };
  Object.defineProperty(api, 'state', { get: function () { return state; }, enumerable: true });
  Object.defineProperty(api, 'morphing', { get: function () { return morphing; }, enumerable: true });
  window.__stage = api;
})();
