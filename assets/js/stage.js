/* The Stage: the signature figure of the home page. One head, three beats.
   State 0: top-view head with the 19 electrodes of the 10-20 montage and an 8-channel EEG page sweeping like an
     oscilloscope. State 1: live functional connectivity, the Pearson r of the traces drawn as edges. State 2:
     the same graph with the electrodes offered for stimulation. A press delivers a TMS pulse that spreads
     breadth-first over the graph and writes an evoked potential into the traces; it works in every state.
   Part 1 is the pure model (no DOM, no strings) on window.__stageModel for tests/stage.test.js (bare engine, after
     assets/js/lab.js). Part 2 attaches to #stage and exits when the element is absent. Labels come from
     window.I18N.stage (_data/js/stage.yml) through Lab.strings; a missing table degrades to the key names.
   Plain ES5, dependencies: window.Lab (assets/js/lab.js) and window.whenVisible (assets/js/site.js).
   Plotting convention: clinical EEG, NEGATIVE UP (a positive potential deflects the trace downwards). */
(function () {
  'use strict';

  var Lab = window.Lab;

  /* ==================== Part 1: model (no DOM, no strings) ==================== */

  var FS = 250;              /* simulated sample rate, Hz */
  var PAGE_S = 10;           /* seconds per EEG page */
  var BUF = FS * PAGE_S;     /* ring buffer length per channel, one page */
  var CORR_N = 256;          /* correlation window, samples */
  var HOP_MS = 40;           /* propagation delay per hop */
  var TEP_MS = 300;          /* length of the evoked window */
  var ARTIFACT_MS = 10;      /* pulse artifact bridged by a straight interpolated segment (about -2 to +10 ms in
                                practice; 20 ms would swallow the N15 on the stimulated channel) */
  var MAX_PULSES = 8;        /* pulse markers remembered for the page */
  var COUPLING_DECAY = 1.6;  /* coupling weight decay with scalp distance */
  var CORR_HP_HZ = 2.5;      /* high-pass corner of the copy of the traces used for correlations */
  var REWIRE_P = 0.15;       /* Watts-Strogatz rewiring probability */
  /* The hidden coupling graph and the traces are seeded apart. The graph is rebuilt from TOPOLOGY_SEED at every
     coupling change, so the slider rescales the weights without rewiring anything; the traces start from
     TRACE_SEED (Part 2) plus a reset counter, so Reset gives new traces on the same graph. */
  var TOPOLOGY_SEED = 20260905;
  var TAU = 2 * Math.PI;
  var MONTAGE = Lab.MONTAGE;
  var N = MONTAGE.length;    /* 19 electrodes */
  var P = N * (N - 1) / 2;   /* 171 pairs */

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
  function scalpDist(i, j) { return Math.hypot(MONTAGE[i].x - MONTAGE[j].x, MONTAGE[i].y - MONTAGE[j].y); }

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
        if (rng() >= REWIRE_P) continue;
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
        var w = Math.exp(-COUPLING_DECAY * scalpDist(i, j)) * (0.7 + 0.6 * rng()) * coupling;
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
    var w = new Float32Array(N); w.fill(outValue);
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
      hpA: Math.exp(-TAU * CORR_HP_HZ / FS),
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
      var cg = buildCoupling(Lab.rng(TOPOLOGY_SEED), c);
      g.W = cg.W; g.adj = cg.adj; g.coupling = c;
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
    function rememberPulse(s0) { g.pulses.push(s0); if (g.pulses.length > MAX_PULSES) g.pulses.shift(); }

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

  /* Layout in CSS pixels for a w x h frame: the head in the upper HEAD_SHARE of it, the EEG page below.
     Vertically the radius has to fit the circle plus the nose, which sticks out by 0.11 r (NOSE_FACTOR keeps a
     little more than that) and NOSE_ROOM px of air; horizontally it has to leave LABEL_ROOM px on each side for
     the ring electrode labels. The head centre drops by HEAD_DROP for the same reason as the nose room. */
  var HEAD_SHARE = 0.6, PAGE_GAP = 6, HEAD_DROP = 4;
  var NOSE_FACTOR = 1.13, NOSE_ROOM = 16, LABEL_ROOM = 34, HEAD_R_MIN = 20;
  function headLayout(w, h, pad) {
    var iw = w - 2 * pad, ih = h - 2 * pad;
    var headH = ih * HEAD_SHARE, pageTop = pad + headH + PAGE_GAP, pageH = ih - headH - PAGE_GAP;
    var cx = w / 2, cy = pad + headH / 2 + HEAD_DROP;
    var R0 = Math.min((headH / 2 - NOSE_ROOM) / NOSE_FACTOR, iw / 2 - LABEL_ROOM);
    var x = new Float32Array(N), y = new Float32Array(N);
    for (var i = 0; i < N; i++) { x[i] = cx + MONTAGE[i].x * R0; y[i] = cy - MONTAGE[i].y * R0; }
    return {
      x: x, y: y, cx: cx, cy: cy, r: Math.max(HEAD_R_MIN, R0),
      pageX: pad, pageY: pageTop, pageW: iw, pageH: pageH
    };
  }

  var model = {
    FS: FS, BUF: BUF, CORR_N: CORR_N, HOP_MS: HOP_MS, TEP_MS: TEP_MS, N: N, P: P, MONTAGE: MONTAGE, TOPOLOGY_SEED: TOPOLOGY_SEED,
    PA: PA, PB: PB, pairIndex: function (i, j) { return i === j ? -1 : PAIR_INDEX[i * N + j]; },
    buildCoupling: buildCoupling, pearson: pearson, bfsTree: bfsTree, tepSample: tepSample,
    createGenerator: createGenerator, headLayout: headLayout
  };
  window.__stageModel = model;

  /* ==================== Part 2: DOM ==================== */
  if (typeof document === 'undefined') return;
  var root = document.getElementById('stage');
  var canvas = document.getElementById('stage-canvas');
  var buttonsEl = document.getElementById('stage-buttons');
  var readoutEl = document.getElementById('stage-readout');
  var liveEl = document.getElementById('stage-live');
  var controlsEl = document.getElementById('stage-controls');
  if (!root || !canvas || !buttonsEl || !readoutEl || !liveEl || !controlsEl) return;
  var section = document.getElementById('stage-section');
  var frame = canvas.parentNode, figureEl = root.parentNode || root;
  var reduce = Lab.reduceMotion;
  var t = Lab.tokens();

  var PAD = 16, TRACE_SEED = 20260904, DEFAULT_COUPLING = 0.8, BASE_THR = 0.35;
  var COUPLING_MIN = 0.2, COUPLING_MAX = 1.6, COUPLING_STEP = 0.05;
  var EDGE_FADE_MS = 700, STIM_GAP_MS = 400, STIM_MSG_MS = 4000;
  var WAVE_FADE_MS = 600, WAVE_EDGE_MS = 300, RING_MS = 200, RING_PX = 40, GLOW_PX = 7.5, NODE_R = 5;
  /* CORR_EVERY: the 171 correlations are refreshed every fourth frame, which is far faster than the eye and a
     quarter of the cost. MAX_FRAME_MS caps how much simulated time one frame may advance, so a tab that was
     hidden or a long stall resumes instead of fast-forwarding through a page of traces. */
  var READOUT_MS = 1000, CORR_EVERY = 4, MAX_FRAME_MS = 67, FORCED_HOLD_MS = 2000, STIM_PARAM_DELAY_MS = 600;
  var LABEL_PX = 10;         /* floor for every canvas label */
  var LABELS_MIN_W = 420;    /* below this frame width the electrode labels are dropped */
  var CHAR_W = 0.62;         /* advance width of the mono font as a fraction of its size */
  var GAP_PX = 8;            /* columns erased ahead of the write head */
  var TAG_GAP = 4;           /* distance between a pulse marker and its TMS tag */
  var STATES = 3;
  var HEADER_PX = 68;        /* sticky header height (--header-h in style.css): the reading area starts below it */
  var PHONE_QUERY = '(max-width: 900px)'; /* the CSS breakpoint (stage.css) where the figure moves above the beats */
  var BEAT_SHARE = 0.5, BEAT_SHARE_PHONE = 0.35; /* share of a beat that has to be in view before it takes over */
  var BEAT_MARGIN = 0.1;     /* a beat takes over only when it shows this much more than the current one */
  var BEAT_THRESHOLDS = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1]; /* observer steps: the per-beat ratios stay fresh */
  /* Reduced motion writes the pulse at 4.2 s of the frozen page: left of centre, so the response and its
     spread over the hops sit in the middle of the page. */
  var STATIC_STIM_AT = Math.floor(BUF * 0.42);

  /* Labels: window.I18N.stage in the language of the page (_data/js/stage.yml). */
  var str = Lab.strings('stage');
  function tr(key, values) { return Lab.format(str(key), values); }
  var SCALE_LABEL = tr('scale'), TMS_LABEL = tr('tms');
  var SCALE_W = 3 + Math.ceil(SCALE_LABEL.length * LABEL_PX * CHAR_W); /* extent of the scale label from the page origin */
  var TAG_W = 3 + Math.ceil(TMS_LABEL.length * LABEL_PX * CHAR_W);     /* width of the TMS tag */

  var ctx = null, Wc = 0, Hc = 0, head = null, state = 0, resetCount = 0;
  var gen = createGenerator(TRACE_SEED, DEFAULT_COUPLING);
  var edgeFade = 0, edgeFadeTarget = 0, edgeFadeFrom = 0, edgeFadeStart = -1;
  var thr = BASE_THR, showLabels = true, hover = -1, hoverFocus = -1;
  var frameCount = 0, lastNow = 0, acc = 0, running = false, rafId = 0;
  var lastReadout = 0, readoutText = '', messageUntil = 0, forcedUntil = 0, stimulated = false;

  /* Stimulation (one visible wave at a time; the generator queues the evoked potentials itself). */
  var stim = { active: false, start: 0, node: -1, maxHop: 0, dist: new Int32Array(N), parent: new Int32Array(N) };
  var lastStim = -1e9;

  function setReadout(text) { if (text !== readoutText) { readoutText = text; readoutEl.textContent = text; } }
  /* User-triggered messages also reach the live region; the periodic summaries never do. */
  function announce(text) { setReadout(text); liveEl.textContent = text; }
  /* Reduced motion has no loop, so a change is drawn at once; the loop redraws every frame anyway. */
  function requestRender() { if (reduce) render(Lab.now()); }

  /* ---- Offscreen EEG page (8 channels, 10 s, oscilloscope write head) ---- */
  var PAGE_CH = ['Fp1', 'F3', 'C3', 'P3', 'O1', 'Fz', 'Cz', 'Pz'].map(Lab.electrodeIndex);
  var page = document.createElement('canvas'), pctx = page.getContext('2d');
  var pg = { x: 0, y: 0, w: 0, h: 0, gutter: 32, axisH: 14, tx: 0, ty: 0, tw: 0, th: 0, rowH: 0, spp: 1, gain: 1, clampY: 1 };
  var painted = 0, paintedLap = 0, prevY = new Float32Array(PAGE_CH.length), prevValid = new Uint8Array(PAGE_CH.length);

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
    return (gen.n - ps > BUF || Math.floor(ps / BUF) * BUF !== lapBase) ? -1 : Math.floor((ps % BUF) / pg.spp);
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
    pctx.fillText(SCALE_LABEL, pg.tx + 3, pg.axisH - 6);
    pctx.font = Lab.font(LABEL_PX, t, 500); pctx.fillStyle = t.accent; pctx.strokeStyle = t.surface; pctx.lineWidth = 2;
    for (k = 0; k < gen.pulses.length; k++) {
      var pc = pulseColumn(gen.pulses[k], lapBase);
      if (pc < 0) continue;
      var sp = tagSpan(pc), x = pg.tx + (sp.align === 'left' ? sp.x0 : sp.x1);
      pctx.textAlign = sp.align;
      pctx.strokeText(TMS_LABEL, x, pg.axisH - 6); pctx.fillText(TMS_LABEL, x, pg.axisH - 6);
    }
    pctx.restore();
  }
  /* A fresh pulse gets its tag at once: the write head only repaints columns ahead of the marker. */
  function paintTag(ps) {
    var lapBase = Math.floor(ps / BUF) * BUF, sp = tagSpan(pulseColumn(ps, lapBase)); drawAxis(pg.tx + sp.x0, pg.tx + sp.x1, lapBase);
  }
  function clearTraces(x0, x1) { pctx.clearRect(x0, pg.axisH + 1, x1 - x0, pg.h - pg.axisH - 1); }
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

  /* ---- Electrode buttons, layout, controls ---- */
  var electrodeButtons = MONTAGE.map(function (m, i) {
    var eb = document.createElement('button');
    eb.type = 'button'; eb.dataset.index = String(i);
    eb.setAttribute('aria-label', tr('stimulate', { name: m.name }));
    buttonsEl.appendChild(eb);
    return eb;
  });
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
  }
  function layout() {
    var f = Lab.fitCanvas(canvas);
    ctx = f.ctx; Wc = f.w; Hc = f.h;
    head = headLayout(Wc, Hc, PAD); showLabels = Wc >= LABELS_MIN_W;
    pageLayout(f.dpr); repaintPage(); positionButtons(); requestRender();
    observeBeats();
  }

  /* Coupling range and Reset, present in every state (the graph is the same throughout). */
  var couplingLabel = document.createElement('label'), couplingInput = document.createElement('input');
  couplingInput.type = 'range'; couplingInput.id = 'stage-coupling';
  /* min, max and step before value: a range sanitises its value against the bounds it has at that moment. */
  couplingInput.min = String(COUPLING_MIN); couplingInput.max = String(COUPLING_MAX); couplingInput.step = String(COUPLING_STEP);
  couplingInput.value = String(DEFAULT_COUPLING);
  couplingLabel.appendChild(document.createTextNode(tr('coupling'))); couplingLabel.appendChild(couplingInput);
  var resetBtn = document.createElement('button');
  resetBtn.type = 'button'; resetBtn.className = 'btn btn-ghost btn-small'; resetBtn.textContent = tr('reset');
  resetBtn.setAttribute('aria-label', tr('reset_label'));
  controlsEl.appendChild(couplingLabel); controlsEl.appendChild(resetBtn);

  /* ---- Readout texts ---- */
  function summaryText() {
    var s = gen.summary();
    return tr('strongest', { a: MONTAGE[s.a].name, b: MONTAGE[s.b].name, r: s.r.toFixed(2) });
  }
  /* State 0 describes the page, state 2 asks for a press until the first pulse (in the readout and with the ring
     on the buttons), otherwise the strongest pair. The periodic readout waits while a user message is on show. */
  function idleText() {
    if (state === 0) return tr('traces', { shown: PAGE_CH.length, total: N, fs: FS });
    return state === 2 && !stimulated ? tr('prompt') : summaryText();
  }
  function updateReadout(now) { if (now >= messageUntil) setReadout(idleText()); }
  function updatePrompt() { root.classList.toggle('is-prompting', state === 2 && !stimulated); }

  /* ---- State machine: 0 traces, 1 edges, 2 edges and the stimulation invitation ---- */
  var beats = section ? Array.prototype.slice.call(section.querySelectorAll('[data-stage-step]')) : [];
  function markBeat(s) { for (var i = 0; i < beats.length; i++) beats[i].classList.toggle('is-active', +beats[i].dataset.stageStep === s); }
  /* The edges fade in from state 1 (snapped under reduced motion). The state is scroll-driven, so it is never
     announced: the live region is kept for what the user does (stimulation, reset, coupling). */
  function setState(n) {
    n = Lab.clamp(Math.round(+n) || 0, 0, STATES - 1);
    if (n === state) return;
    var now = Lab.now();
    state = n;
    root.dataset.state = String(n);
    markBeat(n);
    edgeFadeFrom = edgeFade; edgeFadeTarget = n >= 1 ? 1 : 0; edgeFadeStart = reduce ? -1 : now;
    if (reduce) edgeFade = edgeFadeTarget;
    updatePrompt();
    messageUntil = 0; lastReadout = now;
    setReadout(idleText());
    requestRender();
  }

  /* ---- Stimulation, reset, coupling ---- */
  function refreshCorrelation() { gen.correlate(); thr = gen.threshold(BASE_THR); }
  function stimulate(which) {
    var idx = typeof which === 'number' ? which : Lab.electrodeIndex(which);
    if (idx < 0 || idx >= N) return;
    var now = Lab.now();
    if (now - lastStim < STIM_GAP_MS) return;
    lastStim = now;
    refreshCorrelation();
    /* The wave travels over the correlation graph (drawn or not); an isolated electrode falls back to the
       hidden coupling graph so a press always answers. */
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
    stimulated = true;
    updatePrompt();
    messageUntil = now + STIM_MSG_MS;
    announce(tr('stimulated', { name: MONTAGE[idx].name, reached: reached, total: N, ms: tree.maxHop * HOP_MS }));
    requestRender();
  }
  function resetSimulation() {
    resetCount++;
    gen.reseed(TRACE_SEED + resetCount * 7919); gen.advance(BUF);
    stim.active = false; acc = 0;
    refreshCorrelation(); repaintPage();
    messageUntil = 0; lastReadout = Lab.now();
    announce(tr('reset_done', { summary: summaryText() }));
    requestRender();
  }
  function setCoupling(v) {
    v = Lab.clamp(+v || DEFAULT_COUPLING, COUPLING_MIN, COUPLING_MAX);
    gen.setCoupling(v);
    if (couplingInput.value !== String(v)) couplingInput.value = String(v);
    if (reduce) {
      /* The frozen page is regenerated with the new coupling; a static evoked response is written again.
         stim carries the same dist array a BFS tree does, which is all injectStatic reads. */
      gen.reseed(gen.seed); gen.advance(BUF);
      if (stim.active) gen.injectStatic(stim, STATIC_STIM_AT);
      refreshCorrelation();
      repaintPage();
    }
    announce(tr('coupling_set', { value: v.toFixed(2) }) + (reduce ? ' ' + summaryText() : ''));
    requestRender();
  }

  /* ---- Rendering ---- */
  /* Ring electrodes: label pushed radially outward. Inner electrodes: label above and to the right.
     One shared result object, rewritten per call, so labelling 19 electrodes every frame allocates nothing. */
  var lo = { dx: 0, dy: 0, align: 'left' };
  function labelOffset(i) {
    var dx = MONTAGE[i].x, dy = -MONTAGE[i].y, len = Math.hypot(dx, dy);
    if (len < 0.9) { lo.dx = 0.55; lo.dy = -0.85; lo.align = 'left'; }
    else { lo.dx = dx / len; lo.dy = dy / len; lo.align = Math.abs(lo.dx) < 0.3 ? 'center' : (lo.dx < 0 ? 'right' : 'left'); }
  }
  /* Functional connectivity edges under the nodes; a hovered electrode keeps its own edges at full strength. */
  function drawEdges() {
    var x = head.x, y = head.y, p, a, b, r;
    ctx.lineCap = 'round';
    for (p = 0; p < P; p++) {
      r = gen.absr[p];
      if (r <= thr) continue;
      a = PA[p]; b = PB[p];
      var ea = Math.min(1, r) * edgeFade;
      if (hover >= 0) ea = (a === hover || b === hover) ? 1 : ea * 0.15;
      ctx.strokeStyle = Lab.rgba(t.accent, ea);
      ctx.lineWidth = 0.5 + 2 * r;
      ctx.beginPath(); ctx.moveTo(x[a], y[a]); ctx.lineTo(x[b], y[b]); ctx.stroke();
    }
  }
  /* Stimulation wave: expanding ring, traversed edges, nodes lighting per hop. The reduced-motion picture is
     the whole tree at once, dimmer with the hop count. */
  function drawStim(now) {
    /* The rAF timestamp can trail performance.now() by a frame, so elapsed time is clamped at zero. */
    var e = reduce ? 1e9 : Math.max(0, now - stim.start), x = head.x, y = head.y, i, d, a;
    if (!reduce && e > stim.maxHop * HOP_MS + WAVE_FADE_MS) { stim.active = false; return; }
    if (reduce || e < RING_MS) {
      var u = reduce ? 1 : e / RING_MS;
      ctx.strokeStyle = Lab.rgba(t.accent, reduce ? 0.5 : 1 - u); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x[stim.node], y[stim.node], RING_PX * u, 0, TAU); ctx.stroke();
    }
    ctx.lineCap = 'round';
    for (i = 0; i < N; i++) {
      d = stim.dist[i];
      if (d <= 0) continue;
      a = reduce ? 0.8 : 1 - (e - (d - 1) * HOP_MS) / WAVE_EDGE_MS;
      if (a <= 0 || a > 1) continue;
      ctx.strokeStyle = Lab.rgba(t.accent, a); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x[stim.parent[i]], y[stim.parent[i]]); ctx.lineTo(x[i], y[i]); ctx.stroke();
    }
    for (i = 0; i < N; i++) {
      d = stim.dist[i];
      if (d < 0) continue;
      a = reduce ? 1 - 0.6 * d / Math.max(1, stim.maxHop) : 1 - (e - d * HOP_MS) / WAVE_FADE_MS;
      if (a <= 0 || a > 1) continue;
      ctx.fillStyle = Lab.rgba(t.accent, a);
      ctx.beginPath(); ctx.arc(x[i], y[i], GLOW_PX, 0, TAU); ctx.fill();
    }
  }
  function drawLabels() {
    ctx.textBaseline = 'middle';
    for (var i = 0; i < N; i++) {
      labelOffset(i);
      var isH = i === hover, off = NODE_R + (isH ? 9 : 6);
      ctx.font = isH ? Lab.font(12.5, t, 600) : Lab.font(Wc < 560 ? 10 : 11, t);
      ctx.textAlign = lo.align;
      ctx.fillStyle = isH ? t.ink : t.muted;
      ctx.fillText(MONTAGE[i].name, head.x[i] + lo.dx * off, head.y[i] + lo.dy * off);
    }
  }
  function drawNodes() {
    ctx.lineWidth = 1.5; ctx.strokeStyle = t.surface;
    for (var i = 0; i < N; i++) {
      var isH = i === hover;
      ctx.beginPath(); ctx.arc(head.x[i], head.y[i], NODE_R + (isH ? 1.5 : 0), 0, TAU);
      ctx.fillStyle = isH ? t.accent : t.ink;
      ctx.fill(); ctx.stroke();
    }
  }
  function render(now) {
    if (!ctx) return;
    ctx.clearRect(0, 0, Wc, Hc);
    Lab.drawHead(ctx, head.cx, head.cy, head.r, t);
    if (edgeFade > 0.002) drawEdges();
    if (stim.active) drawStim(now);
    if (showLabels) drawLabels();
    ctx.drawImage(page, 0, 0, page.width, page.height, pg.x, pg.y, pg.w, pg.h);
    drawNodes();
  }

  /* ---- Loop: runs only while the figure and the tab are visible, never in reduced motion ---- */
  function tick() {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    var now = Lab.now();
    var dt = lastNow ? Math.min(now - lastNow, MAX_FRAME_MS) : 16;
    lastNow = now;
    frameCount++;
    acc += dt;
    var k = Math.floor(acc * FS / 1000);
    if (k > 0) { acc -= k * 1000 / FS; gen.advance(k); advancePage(); }
    if (frameCount % CORR_EVERY === 0) refreshCorrelation();
    if (edgeFadeStart >= 0) {
      var u = Lab.clamp((now - edgeFadeStart) / EDGE_FADE_MS, 0, 1);
      edgeFade = edgeFadeFrom + (edgeFadeTarget - edgeFadeFrom) * Lab.easeOut(u);
      if (u >= 1) edgeFadeStart = -1;
    }
    if (now - lastReadout > READOUT_MS) { lastReadout = now; updateReadout(now); }
    render(now);
  }
  function start() { if (running) return; running = true; lastNow = 0; acc = 0; rafId = requestAnimationFrame(tick); }
  function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  /* ---- Events ---- */
  /* A focused electrode stays highlighted while the pointer roams. */
  function resolveHover() { if (hoverFocus >= 0) hover = hoverFocus; requestRender(); }
  electrodeButtons.forEach(function (b) {
    var idx = +b.dataset.index;
    b.addEventListener('pointerenter', function () { hover = idx; resolveHover(); });
    b.addEventListener('pointerleave', function () { if (hover === idx) hover = -1; resolveHover(); });
    b.addEventListener('focus', function () { hoverFocus = idx; resolveHover(); });
    b.addEventListener('blur', function () { if (hoverFocus === idx) hoverFocus = -1; if (hover === idx) hover = -1; resolveHover(); });
    b.addEventListener('click', function () { stimulate(idx); });
  });
  couplingInput.addEventListener('input', function () { setCoupling(+couplingInput.value); });
  resetBtn.addEventListener('click', resetSimulation);

  /* Beats: the beat that shows the most of itself in the reading area drives the state. The reading area is the
     viewport below the header and, on phones, below the sticky figure (a beat hidden under the figure must not
     count), hence the root margin; phones also show less of a beat at a time, so a smaller share has to be in
     view. A callback only carries the beats that crossed a threshold, so the ratios are kept per beat and the
     choice is made over all of them; a beat takes over once it shows at least its share and BEAT_MARGIN more
     than the current one, so a small nudge does not flip the state. Rebuilt from layout() because the margin
     follows the figure height. */
  var beatIO = null, beatRatio = [];
  function observeBeats() {
    if (!beats.length || !('IntersectionObserver' in window)) return;
    if (beatIO) beatIO.disconnect();
    var phone = !!(window.matchMedia && window.matchMedia(PHONE_QUERY).matches), share = phone ? BEAT_SHARE_PHONE : BEAT_SHARE;
    var covered = Math.round(phone ? HEADER_PX + figureEl.getBoundingClientRect().height : HEADER_PX);
    beatRatio.length = 0;
    beatIO = new IntersectionObserver(function (entries) {
      var i, next = -1, best = 0;
      for (i = 0; i < entries.length; i++) beatRatio[+entries[i].target.dataset.stageStep] = entries[i].intersectionRatio;
      for (i = 0; i < beatRatio.length; i++) if (beatRatio[i] > best) { best = beatRatio[i]; next = i; }
      if (next < 0 || best < share - 0.01 || Lab.now() < forcedUntil) return;
      if (next !== state && best < (beatRatio[state] || 0) + BEAT_MARGIN) return;
      setState(next);
    }, { threshold: BEAT_THRESHOLDS, rootMargin: '-' + covered + 'px 0px 0px 0px' });
    beats.forEach(function (b) { beatIO.observe(b); });
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(frame);
  else window.addEventListener('resize', layout);
  Lab.onTheme(function () { t = Lab.tokens(); repaintPage(); requestRender(); });
  Lab.fontsReady(function () { repaintPage(); requestRender(); });

  /* ---- Init and debug hooks (?stage=0..2, ?stim=C3) ---- */
  if (section) section.classList.add('stage-ready');
  if (reduce) root.classList.add('stage-reduce');
  var forcedState = Lab.param('stage'), stimParam = Lab.param('stim');
  /* One full page is generated up front so the oscilloscope starts with a page to overwrite and the graph
     has data from the first frame; from here on the generator advances in real time. */
  gen.advance(BUF);
  refreshCorrelation();
  layout();
  markBeat(state);
  setReadout(idleText());
  if (forcedState !== null && forcedState !== '') {
    /* Forced initial state: nothing was on screen before, so the edge fade is snapped. Scroll-driven
       transitions keep their motion. The beat observer is held off for 2 s. */
    forcedUntil = Lab.now() + FORCED_HOLD_MS;
    setState(+forcedState);
    edgeFade = edgeFadeTarget; edgeFadeStart = -1;
  }
  render(Lab.now());
  if (stimParam) setTimeout(function () { stimulate(stimParam); }, STIM_PARAM_DELAY_MS);
  if (!reduce) Lab.whenVisible(root, start, stop);

  /* Scripted checks drive the figure through window.__stage. */
  var api = {
    setState: setState, stimulate: stimulate, reset: resetSimulation, setCoupling: setCoupling,
    model: model, reduceMotion: reduce, generator: gen,
    threshold: function () { return thr; }, frames: function () { return frameCount; },
    positions: function () { return { x: head.x, y: head.y }; }
  };
  Object.defineProperty(api, 'state', { get: function () { return state; }, enumerable: true });
  Object.defineProperty(api, 'stimulated', { get: function () { return stimulated; }, enumerable: true });
  window.__stage = api;
})();
