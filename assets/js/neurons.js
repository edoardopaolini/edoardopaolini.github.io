/* Neurons: the living background behind every page. A seeded field of neurons (somas, two-level dendrites,
   one axon per cell reaching one to three neighbours) is cached on an offscreen layer; action potentials
   travel the axons as bright pulses and may cascade a few hops.
   Part 1 is the pure model (field generation, neighbour selection, cascade scheduling), exported on
   window.__neuronsModel for tests/neurons.test.js, which runs it in a bare engine after assets/js/lab.js.
   Part 2 attaches to #neurons and exits silently when the canvas is absent or ?neurons=off. ES5, no
   dependencies beyond window.Lab (assets/js/lab.js). */
(function () {
  'use strict';

  var Lab = window.Lab;

  /* ======================================================================
     Tunables
     ====================================================================== */

  /* field */
  var AREA_PER_NEURON = 76000;          /* CSS px2 per neuron */
  var MIN_COUNT = 9, MAX_COUNT = 30;
  var PHONE_WIDTH = 640, PHONE_MIN_COUNT = 6;
  var MIN_SOMA_DISTANCE = 100;
  var MARGIN = 28, PHONE_MARGIN = 20;   /* somas stay this far from the viewport edge */
  var PLACE_CANDIDATES = 14;            /* best-candidate sampling: candidates tried per placed soma */
  var PLACE_TRIES = 40;                 /* attempts per neuron before giving up on a crowded viewport */
  var SOMA_R_MIN = 5.2, SOMA_R_MAX = 9.6;
  var SOMA_ATTACH = 0.9;                /* fibres start at this fraction of the radius so they merge into the disc */
  var DENDRITES_MIN = 3, DENDRITES_MAX = 5;
  var DENDRITE_SPREAD = 1.55 * Math.PI; /* the dendrites fan over this arc, centred opposite the axon */
  var DENDRITE_LEN_MIN = 38, DENDRITE_LEN_MAX = 70;
  var BRANCH_LEN_MIN = 18, BRANCH_LEN_MAX = 38;
  var BRANCH_SECOND_P = 0.6;            /* probability of a second branch at a dendrite tip */
  var BRANCH_ANGLE_MIN = 0.35, BRANCH_ANGLE_MAX = 0.8;
  var CURVE_BEND_MIN = 0.1, CURVE_BEND_MAX = 0.3;   /* sideways control offset, fraction of the length */
  var END_JITTER = 0.5;                 /* random turn of a dendrite between its root and its tip, radians */
  var AXON_REACH = 540;                 /* extra targets must lie within this distance */
  var AXON_CONE = 2.7;                  /* and within this angle of the primary target, so the axon reads as one bundle */
  var AXON_EXTRA_P1 = 0.8, AXON_EXTRA_P2 = 0.5, AXON_EXTRA_P3 = 0.25;
  var AXON_BEND_MIN = 0.08, AXON_BEND_MAX = 0.22;
  var AXON_LEAVE = 0.35, AXON_ARRIVE = 0.3;         /* control handle lengths, fraction of the chord */
  var HILLOCK_JITTER = 0.5;
  var TERMINAL_P = 0.5;
  var TERMINAL_BACK = 26;               /* the terminal branch leaves the axon this far before the target */
  var TERMINAL_MIN_AXON = 70;
  var TERMINAL_LEN_MIN = 14, TERMINAL_LEN_MAX = 22;
  var TERMINAL_ANGLE_MIN = 0.6, TERMINAL_ANGLE_MAX = 1.0;
  var NP_DENDRITE = 12, NP_BRANCH = 8, NP_AXON = 24, NP_TERMINAL = 8;   /* polyline samples per curve */

  /* spikes */
  var FIRE_INTERVAL_MIN = 1200, FIRE_INTERVAL_MAX = 3500;   /* ms between spontaneous fires */
  var FLASH_MS = 400;
  var PULSE_SPEED = 0.32;               /* px per ms */
  var TAIL_PX = 40;
  var FIRE_PROBABILITY = 0.55;
  var SYNAPTIC_DELAY = 60;
  var MAX_HOPS = 3, MAX_CASCADES = 4;
  var MAX_PULSES = 64, MAX_EVENTS = 64; /* preallocated slots */
  var HOT_PICK = 0.7;                   /* chance that the next spontaneous fire is the neuron under the pointer, times proximity */
  var HOT_SPEEDUP = 0.6;                /* the wait shrinks by this fraction times proximity */
  var HOT_HOLD = 1500;                  /* ms the pointer bias survives after the last move */

  /* rendering */
  var SEED = 20260905;
  var DPR_CAP = 1.5;
  var MAX_BACKING_PIXELS = 5e6;         /* three full-viewport layers: keep each under 20 MB */
  var RESIZE_DEBOUNCE = 150;
  var REBUILD_AREA_RATIO = 0.15;        /* regenerate the field only past this change of viewport area */
  var NEURONS_PER_FRAME = 3;            /* drift redraws the structure in slices of this many neurons */
  var MAX_STEP_MS = 100;
  var DRIFT_PX = 3;                     /* largest displacement of a soma */
  var DRIFT_AXIS = DRIFT_PX / Math.SQRT2;   /* per-axis amplitude that keeps the diagonal within DRIFT_PX */
  var DRIFT_W1 = 2 * Math.PI / 18000, DRIFT_W2 = 2 * Math.PI / 31000;
  var POINTER_MS = 100, POINTER_RADIUS = 160;
  var SPIKE_INTERVAL = 600;             /* ?spike=1 cadence */
  var DENDRITE_W0 = 1.9, DENDRITE_W1 = 1.0, BRANCH_W0 = 1.1, BRANCH_W1 = 0.75;
  var AXON_W0 = 1.7, AXON_W1 = 0.95, TERMINAL_W0 = 0.95, TERMINAL_W1 = 0.75;
  var BOUTON_R = 1.5;
  var SOMA_SPRITE_PX = 20, SOMA_SPRITE_SCALE = 2.3;   /* the sprite is drawn at radius times this */
  var GLOW_SPRITE_PX = 64;
  var PULSE_GLOW_PX = 26, PULSE_GLOW_ALPHA = 0.95;
  var HEAD_R = 1.7;
  var TAIL_SEGS = 8, TAIL_DECAY = 3.2, TAIL_W0 = 1.6, TAIL_W1 = 0.6;
  var HALO_SCALE = 7, HALO_ALPHA = 0.85;
  var FLASH_RISE = 0.12, FLASH_DECAY = 4.5;

  /* ======================================================================
     Part 1: model
     ====================================================================== */

  /* Shared scratch for arc-length lookups: point and unit tangent. */
  var P = { x: 0, y: 0, tx: 0, ty: 0 };

  function sampleQuad(x0, y0, x1, y1, x2, y2, pts, cum, np) {
    var len = 0;
    for (var i = 0; i < np; i++) {
      var t = i / (np - 1), mt = 1 - t;
      var x = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
      var y = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
      pts[2 * i] = x; pts[2 * i + 1] = y;
      if (i) { var dx = x - pts[2 * i - 2], dy = y - pts[2 * i - 1]; len += Math.sqrt(dx * dx + dy * dy); }
      cum[i] = len;
    }
    return len;
  }
  function sampleCubic(x0, y0, x1, y1, x2, y2, x3, y3, pts, cum, np) {
    var len = 0;
    for (var i = 0; i < np; i++) {
      var t = i / (np - 1), mt = 1 - t;
      var a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
      var x = a * x0 + b * x1 + c * x2 + d * x3;
      var y = a * y0 + b * y1 + c * y2 + d * y3;
      pts[2 * i] = x; pts[2 * i + 1] = y;
      if (i) { var dx = x - pts[2 * i - 2], dy = y - pts[2 * i - 1]; len += Math.sqrt(dx * dx + dy * dy); }
      cum[i] = len;
    }
    return len;
  }
  /* Point and unit tangent at arc length s along a sampled polyline, written into out. */
  function pointAt(pts, cum, np, s, out) {
    var i = 1;
    if (s >= cum[np - 1]) i = np - 1;
    else if (s > 0) while (cum[i] < s) i++;
    var s0 = cum[i - 1], s1 = cum[i];
    var f = s1 > s0 ? Lab.clamp((s - s0) / (s1 - s0), 0, 1) : 0;
    var x0 = pts[2 * i - 2], y0 = pts[2 * i - 1], dx = pts[2 * i] - x0, dy = pts[2 * i + 1] - y0;
    var inv = 1 / (Math.sqrt(dx * dx + dy * dy) || 1);
    out.x = x0 + dx * f; out.y = y0 + dy * f;
    out.tx = dx * inv; out.ty = dy * inv;
    return out;
  }

  function countFor(w, h) {
    var min = w < PHONE_WIDTH ? PHONE_MIN_COUNT : MIN_COUNT;
    return Lab.clamp(Math.round(w * h / AREA_PER_NEURON), min, MAX_COUNT);
  }

  /* Best-candidate sampling: of several random candidates keep the one farthest from every placed soma,
     which spreads the cells evenly without a lattice look. Stops early on a viewport too small to hold them. */
  function place(rng, w, h, count, margin) {
    var xs = [], ys = [], tries = 0;
    var spanX = Math.max(1, w - 2 * margin), spanY = Math.max(1, h - 2 * margin);
    var minD2 = MIN_SOMA_DISTANCE * MIN_SOMA_DISTANCE;
    while (xs.length < count && tries < PLACE_TRIES * count) {
      tries++;
      var bx = 0, by = 0, best = -1;
      for (var c = 0; c < PLACE_CANDIDATES; c++) {
        var cx = margin + rng() * spanX, cy = margin + rng() * spanY, dmin = Infinity;
        for (var j = 0; j < xs.length; j++) {
          var dx = cx - xs[j], dy = cy - ys[j], d2 = dx * dx + dy * dy;
          if (d2 < dmin) dmin = d2;
        }
        if (dmin > best) { best = dmin; bx = cx; by = cy; }
      }
      if (best >= minD2) { xs.push(bx); ys.push(by); }
    }
    return { xs: xs, ys: ys };
  }

  /* A gently bent quadratic leaving (x, y) at angle a, in the coordinates of the caller. */
  function curveFrom(x, y, a, len, rng, np) {
    var a2 = a + (rng() - 0.5) * END_JITTER;
    var ex = x + Math.cos(a2) * len, ey = y + Math.sin(a2) * len;
    var bend = (rng() < 0.5 ? -1 : 1) * (CURVE_BEND_MIN + rng() * (CURVE_BEND_MAX - CURVE_BEND_MIN));
    var mx = (x + ex) / 2 - Math.sin(a2) * bend * len, my = (y + ey) / 2 + Math.cos(a2) * bend * len;
    var pts = new Float32Array(2 * np), cum = new Float32Array(np);
    sampleQuad(x, y, mx, my, ex, ey, pts, cum, np);
    return { pts: pts, cum: cum, np: np, ex: ex, ey: ey, endAngle: Math.atan2(ey - my, ex - mx), children: [] };
  }

  /* Dendrites live in soma-local coordinates (they translate rigidly with the drift). */
  function buildDendrites(me, rng) {
    var k = DENDRITES_MIN + Math.floor(rng() * (DENDRITES_MAX - DENDRITES_MIN + 1));
    var centre = me.hillock + Math.PI;
    for (var i = 0; i < k; i++) {
      var a = centre + (i / (k - 1) - 0.5) * DENDRITE_SPREAD + (rng() - 0.5) * 0.3;
      var len = DENDRITE_LEN_MIN + rng() * (DENDRITE_LEN_MAX - DENDRITE_LEN_MIN);
      var root = me.r * SOMA_ATTACH;
      var d = curveFrom(root * Math.cos(a), root * Math.sin(a), a, len, rng, NP_DENDRITE);
      var nb = 1 + (rng() < BRANCH_SECOND_P ? 1 : 0);
      var side = rng() < 0.5 ? -1 : 1;
      for (var j = 0; j < nb; j++) {
        var ang = d.endAngle + side * (BRANCH_ANGLE_MIN + rng() * (BRANCH_ANGLE_MAX - BRANCH_ANGLE_MIN));
        side = -side;
        d.children.push(curveFrom(d.ex, d.ey, ang, BRANCH_LEN_MIN + rng() * (BRANCH_LEN_MAX - BRANCH_LEN_MIN), rng, NP_BRANCH));
      }
      me.dendrites.push(d);
    }
  }

  /* The nearest neighbour is always reached; up to three more may follow when they sit close and roughly in
     the same direction. The axon hillock points at the mean direction of the targets. */
  function chooseTargets(neurons, i, rng) {
    var me = neurons[i], order = [], j;
    for (j = 0; j < neurons.length; j++) if (j !== i) order.push(j);
    order.sort(function (a, b) { return dist2(me, neurons[a]) - dist2(me, neurons[b]); });
    var want = 1 + (rng() < AXON_EXTRA_P1 ? 1 : 0) + (rng() < AXON_EXTRA_P2 ? 1 : 0) + (rng() < AXON_EXTRA_P3 ? 1 : 0);
    var targets = [order[0]];
    var a0 = Math.atan2(neurons[order[0]].y - me.y, neurons[order[0]].x - me.x);
    for (var k = 1; k < order.length && targets.length < want; k++) {
      var o = neurons[order[k]];
      if (Math.sqrt(dist2(me, o)) > AXON_REACH) break;
      var da = Math.atan2(o.y - me.y, o.x - me.x) - a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) <= AXON_CONE / 2) targets.push(order[k]);
    }
    var sx = 0, sy = 0, bends = [], pts = [], cum = [], lengths = [];
    for (k = 0; k < targets.length; k++) {
      var t = neurons[targets[k]], dx = t.x - me.x, dy = t.y - me.y, l = Math.sqrt(dx * dx + dy * dy) || 1;
      sx += dx / l; sy += dy / l;
      bends.push((rng() < 0.5 ? -1 : 1) * (AXON_BEND_MIN + rng() * (AXON_BEND_MAX - AXON_BEND_MIN)));
      pts.push(new Float32Array(2 * NP_AXON));
      cum.push(new Float32Array(NP_AXON));
      lengths.push(0);
    }
    me.hillock = Math.atan2(sy, sx) + (rng() - 0.5) * HILLOCK_JITTER;
    var terminal = null;
    if (rng() < TERMINAL_P) {
      terminal = {
        k: Math.floor(rng() * targets.length), side: rng() < 0.5 ? -1 : 1,
        angle: TERMINAL_ANGLE_MIN + rng() * (TERMINAL_ANGLE_MAX - TERMINAL_ANGLE_MIN),
        len: TERMINAL_LEN_MIN + rng() * (TERMINAL_LEN_MAX - TERMINAL_LEN_MIN),
        bend: (rng() - 0.5) * 0.5, on: false,
        pts: new Float32Array(2 * NP_TERMINAL), cum: new Float32Array(NP_TERMINAL)
      };
    }
    me.axon = { targets: targets, bends: bends, pts: pts, cum: cum, lengths: lengths, terminal: terminal };
  }
  function dist2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  /* Recomputes the axon curves of neuron i from the current world positions (px, py) of both ends, in place. */
  function layoutAxon(field, i) {
    var ns = field.neurons, me = ns[i], ax = me.axon;
    var ch = Math.cos(me.hillock), sh = Math.sin(me.hillock);
    var x0 = me.px + ch * me.r * SOMA_ATTACH, y0 = me.py + sh * me.r * SOMA_ATTACH;
    for (var k = 0; k < ax.targets.length; k++) {
      var t = ns[ax.targets[k]];
      var cx = t.px - me.px, cy = t.py - me.py, L = Math.sqrt(cx * cx + cy * cy) || 1;
      var dx = cx / L, dy = cy / L, b = ax.bends[k];
      var x1 = x0 + ch * L * AXON_LEAVE, y1 = y0 + sh * L * AXON_LEAVE;
      var x2 = t.px - dx * L * AXON_ARRIVE - dy * b * L, y2 = t.py - dy * L * AXON_ARRIVE + dx * b * L;
      var ex = x2 - t.px, ey = y2 - t.py, el = Math.sqrt(ex * ex + ey * ey) || 1;
      var x3 = t.px + ex / el * t.r * SOMA_ATTACH, y3 = t.py + ey / el * t.r * SOMA_ATTACH;
      ax.lengths[k] = sampleCubic(x0, y0, x1, y1, x2, y2, x3, y3, ax.pts[k], ax.cum[k], NP_AXON);
    }
    var term = ax.terminal;
    if (!term) return;
    var len = ax.lengths[term.k];
    term.on = len >= TERMINAL_MIN_AXON;
    if (!term.on) return;
    pointAt(ax.pts[term.k], ax.cum[term.k], NP_AXON, len - TERMINAL_BACK, P);
    var a = Math.atan2(P.ty, P.tx) + term.side * term.angle;
    var ux = Math.cos(a), uy = Math.sin(a);
    var qx = P.x + ux * term.len, qy = P.y + uy * term.len;
    var mx = P.x + ux * term.len * 0.5 - uy * term.bend * term.len, my = P.y + uy * term.len * 0.5 + ux * term.bend * term.len;
    sampleQuad(P.x, P.y, mx, my, qx, qy, term.pts, term.cum, NP_TERMINAL);
  }

  function generate(seed, w, h) {
    var rng = Lab.rng(seed);
    var spots = place(rng, w, h, countFor(w, h), w < PHONE_WIDTH ? PHONE_MARGIN : MARGIN);
    var neurons = [], i;
    for (i = 0; i < spots.xs.length; i++) {
      neurons.push({
        index: i, x: spots.xs[i], y: spots.ys[i], px: spots.xs[i], py: spots.ys[i],
        r: SOMA_R_MIN + rng() * (SOMA_R_MAX - SOMA_R_MIN),
        phase: [rng() * 2 * Math.PI, rng() * 2 * Math.PI, rng() * 2 * Math.PI, rng() * 2 * Math.PI],
        hillock: 0, dendrites: [], axon: null
      });
    }
    var field = { seed: seed, w: w, h: h, neurons: neurons };
    if (neurons.length < 2) return field;
    for (i = 0; i < neurons.length; i++) chooseTargets(neurons, i, rng);
    for (i = 0; i < neurons.length; i++) buildDendrites(neurons[i], rng);
    for (i = 0; i < neurons.length; i++) layoutAxon(field, i);
    return field;
  }

  /* Cascades. A fire flashes the soma and, below MAX_HOPS, launches one pulse per axon target; an arriving
     pulse makes its target fire with FIRE_PROBABILITY after SYNAPTIC_DELAY. Every pulse and pending fire
     counts toward the load of its cascade slot, so a slot frees itself when the last one ends. Time in ms;
     everything is preallocated so advance() allocates nothing. */
  function Scheduler(field, random) {
    this.field = field;
    this.random = random || Math.random;
    this.time = 0;
    this.pulses = [];
    this.events = [];
    var i;
    for (i = 0; i < MAX_PULSES; i++) this.pulses.push({ active: false, source: 0, axon: 0, target: 0, s: 0, cascade: 0, hop: 0 });
    for (i = 0; i < MAX_EVENTS; i++) this.events.push({ active: false, at: 0, neuron: 0, cascade: 0, hop: 0 });
    this.load = new Int32Array(MAX_CASCADES);
    this.flashAt = new Float64Array(field.neurons.length);
    for (i = 0; i < this.flashAt.length; i++) this.flashAt[i] = -1e9;
    this.intervalMin = FIRE_INTERVAL_MIN;
    this.intervalMax = FIRE_INTERVAL_MAX;
    this.nextSpontaneous = this.interval();
    this.hot = -1; this.hotWeight = 0; this.hotUntil = 0;
    this.onFire = null;
    this.fires = 0;
  }
  Scheduler.prototype.interval = function () {
    return this.intervalMin + (this.intervalMax - this.intervalMin) * this.random();
  };
  Scheduler.prototype.freeCascade = function () {
    for (var c = 0; c < MAX_CASCADES; c++) if (this.load[c] === 0) return c;
    return -1;
  };
  Scheduler.prototype.liveCascades = function () {
    var n = 0;
    for (var c = 0; c < MAX_CASCADES; c++) if (this.load[c] > 0) n++;
    return n;
  };
  /* Starts a new cascade at neuron index; false when all cascade slots are busy. */
  Scheduler.prototype.start = function (index) {
    var c = this.freeCascade();
    if (c < 0 || index < 0 || index >= this.field.neurons.length) return false;
    this.fire(index, 0, c);
    return true;
  };
  Scheduler.prototype.fire = function (index, hop, cascade) {
    this.flashAt[index] = this.time;
    this.fires++;
    if (this.onFire) this.onFire(index, hop, cascade);
    if (hop >= MAX_HOPS) return;
    var ax = this.field.neurons[index].axon;
    if (!ax) return;
    for (var k = 0; k < ax.targets.length; k++) {
      var p = null;
      for (var i = 0; i < MAX_PULSES; i++) if (!this.pulses[i].active) { p = this.pulses[i]; break; }
      if (!p) return;
      p.active = true; p.source = index; p.axon = k; p.target = ax.targets[k]; p.s = 0; p.cascade = cascade; p.hop = hop;
      this.load[cascade]++;
    }
  };
  Scheduler.prototype.setHot = function (index, weight) {
    this.hot = index; this.hotWeight = weight; this.hotUntil = this.time + HOT_HOLD;
  };
  Scheduler.prototype.advance = function (dt) {
    this.time += dt;
    var ns = this.field.neurons, i, p, e;
    for (i = 0; i < MAX_PULSES; i++) {
      p = this.pulses[i];
      if (!p.active) continue;
      p.s += PULSE_SPEED * dt;
      if (p.s < ns[p.source].axon.lengths[p.axon]) continue;
      p.active = false;
      var fires = this.random() < FIRE_PROBABILITY, slot = null;
      if (fires) for (var j = 0; j < MAX_EVENTS; j++) if (!this.events[j].active) { slot = this.events[j]; break; }
      if (slot) {
        slot.active = true; slot.at = this.time + SYNAPTIC_DELAY; slot.neuron = p.target; slot.cascade = p.cascade; slot.hop = p.hop + 1;
      } else {
        this.load[p.cascade]--;
      }
    }
    for (i = 0; i < MAX_EVENTS; i++) {
      e = this.events[i];
      if (!e.active || e.at > this.time) continue;
      e.active = false;
      this.load[e.cascade]--;
      this.fire(e.neuron, e.hop, e.cascade);
    }
    var hotW = this.hot >= 0 && this.time < this.hotUntil ? this.hotWeight : 0;
    this.nextSpontaneous -= dt * (1 + HOT_SPEEDUP * hotW);
    if (this.nextSpontaneous <= 0) {
      this.nextSpontaneous = this.interval();
      var pickHot = hotW > 0 && this.random() < HOT_PICK * hotW;
      this.start(pickHot ? this.hot : Math.floor(this.random() * ns.length));
    }
  };

  window.__neuronsModel = {
    AREA_PER_NEURON: AREA_PER_NEURON, MIN_COUNT: MIN_COUNT, MAX_COUNT: MAX_COUNT,
    PHONE_WIDTH: PHONE_WIDTH, PHONE_MIN_COUNT: PHONE_MIN_COUNT, MIN_SOMA_DISTANCE: MIN_SOMA_DISTANCE,
    SOMA_R_MIN: SOMA_R_MIN, SOMA_R_MAX: SOMA_R_MAX, DENDRITES_MIN: DENDRITES_MIN, DENDRITES_MAX: DENDRITES_MAX,
    MAX_HOPS: MAX_HOPS, MAX_CASCADES: MAX_CASCADES, MAX_PULSES: MAX_PULSES,
    FIRE_PROBABILITY: FIRE_PROBABILITY, SYNAPTIC_DELAY: SYNAPTIC_DELAY, PULSE_SPEED: PULSE_SPEED,
    FIRE_INTERVAL_MIN: FIRE_INTERVAL_MIN, FIRE_INTERVAL_MAX: FIRE_INTERVAL_MAX,
    countFor: countFor, generate: generate, layoutAxon: layoutAxon, pointAt: pointAt, Scheduler: Scheduler
  };

  /* ======================================================================
     Part 2: DOM
     ====================================================================== */

  if (typeof document === 'undefined') return;
  var canvas = document.getElementById('neurons');
  if (!canvas) return;
  if (Lab.param('neurons') === 'off') { canvas.hidden = true; return; }

  var M = window.__neuronsModel;
  var reduce = Lab.reduceMotion;
  var spike = Lab.param('spike') === '1';

  var staticC = document.createElement('canvas');   /* the structure at token alphas, redrawn per drift cycle */
  var scratchC = document.createElement('canvas');  /* opaque accumulation of the cycle in progress */
  var glowC = document.createElement('canvas');     /* accent radial glow shared by pulse heads and flashes */
  var somaC = document.createElement('canvas');     /* soft opaque disc, scaled per soma */
  var ctx = null, sctx = null, xctx = null;
  var W = 0, H = 0, DPR = 1;
  var field = null, sched = null;
  var tok = { fibre: '', fibreA: 0, soma: '', somaA: 0, accent: '' };
  var tailStyle = [];
  var running = false, paused = false, rafId = 0, lastTs = -1;
  var buildIndex = -1;                              /* next neuron to draw in the current cycle, -1 when idle */
  var costSum = 0, costMax = 0, frames = 0;
  var hooks = { count: 0 };

  /* ---- tokens ---- */
  /* The fibre and soma tokens (--neuron-fibre, --neuron-soma) carry their alpha; the structure is drawn opaque
     in the colour and composited at the alpha, so the two are split here once per theme. */
  function readTokens() {
    var t = Lab.tokens();
    tok.fibre = Lab.rgba(t.neuronFibre, 1);
    tok.fibreA = Lab.alpha(t.neuronFibre);
    tok.soma = Lab.rgba(t.neuronSoma, 1);
    tok.somaA = Lab.alpha(t.neuronSoma);
    tok.accent = t.accent;
    tailStyle.length = 0;
    for (var k = 0; k <= TAIL_SEGS; k++) tailStyle.push(Lab.rgba(t.accent, Math.exp(-TAIL_DECAY * k / TAIL_SEGS)));
  }

  /* ---- sprites ---- */
  function spriteContext(c, size) {
    var px = Math.ceil(size * DPR);
    c.width = px; c.height = px;
    var g = c.getContext('2d');
    g.setTransform(px / size, 0, 0, px / size, 0, 0);
    return g;
  }
  function makeSprites() {
    var S = GLOW_SPRITE_PX, g = spriteContext(glowC, S);
    var grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, Lab.rgba(tok.accent, 0.8));
    grad.addColorStop(0.3, Lab.rgba(tok.accent, 0.3));
    grad.addColorStop(1, Lab.rgba(tok.accent, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    S = SOMA_SPRITE_PX; g = spriteContext(somaC, S);
    grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, tok.soma);
    grad.addColorStop(0.5, Lab.rgba(tok.soma, 0.92));
    grad.addColorStop(0.84, Lab.rgba(tok.soma, 0.66));
    grad.addColorStop(1, Lab.rgba(tok.soma, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }

  /* ---- layout ---- */
  /* World positions: base position rescaled to the current viewport plus the slow drift (two incommensurate
     sines per axis, the sum within DRIFT_PX), then the axon curves that depend on them. */
  function layout() {
    var ns = field.neurons, sx = W / field.w, sy = H / field.h, t = sched.time, i;
    for (i = 0; i < ns.length; i++) {
      var n = ns[i], dx = 0, dy = 0;
      if (!reduce) {
        dx = DRIFT_AXIS * (0.6 * Math.sin(t * DRIFT_W1 + n.phase[0]) + 0.4 * Math.sin(t * DRIFT_W2 + n.phase[1]));
        dy = DRIFT_AXIS * (0.6 * Math.sin(t * DRIFT_W1 + n.phase[2]) + 0.4 * Math.sin(t * DRIFT_W2 + n.phase[3]));
      }
      n.px = n.x * sx + dx; n.py = n.y * sy + dy;
    }
    for (i = 0; i < ns.length; i++) M.layoutAxon(field, i);
  }

  /* ---- structure drawing (opaque, into the scratch layer) ---- */
  /* A tapered fibre: the polyline offset by half the width on each side and filled as one polygon. */
  function ribbon(g, pts, np, w0, w1) {
    var i, x, y, tx, ty, inv, hw, prev, next, last = np - 1;
    g.beginPath();
    for (i = 0; i < np; i++) {
      prev = i > 0 ? i - 1 : 0; next = i < last ? i + 1 : last;
      x = pts[2 * i]; y = pts[2 * i + 1];
      tx = pts[2 * next] - pts[2 * prev]; ty = pts[2 * next + 1] - pts[2 * prev + 1];
      inv = 1 / (Math.sqrt(tx * tx + ty * ty) || 1);
      hw = 0.5 * (w0 + (w1 - w0) * i / last);
      if (i === 0) g.moveTo(x - ty * inv * hw, y + tx * inv * hw); else g.lineTo(x - ty * inv * hw, y + tx * inv * hw);
    }
    for (i = last; i >= 0; i--) {
      prev = i > 0 ? i - 1 : 0; next = i < last ? i + 1 : last;
      x = pts[2 * i]; y = pts[2 * i + 1];
      tx = pts[2 * next] - pts[2 * prev]; ty = pts[2 * next + 1] - pts[2 * prev + 1];
      inv = 1 / (Math.sqrt(tx * tx + ty * ty) || 1);
      hw = 0.5 * (w0 + (w1 - w0) * i / last);
      g.lineTo(x + ty * inv * hw, y - tx * inv * hw);
    }
    g.closePath();
    g.fill();
  }
  function drawFibres(g, n) {
    g.setTransform(DPR, 0, 0, DPR, n.px * DPR, n.py * DPR);
    for (var i = 0; i < n.dendrites.length; i++) {
      var d = n.dendrites[i];
      ribbon(g, d.pts, d.np, DENDRITE_W0, DENDRITE_W1);
      for (var j = 0; j < d.children.length; j++) ribbon(g, d.children[j].pts, d.children[j].np, BRANCH_W0, BRANCH_W1);
    }
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    var ax = n.axon;
    if (!ax) return;
    for (var k = 0; k < ax.targets.length; k++) ribbon(g, ax.pts[k], NP_AXON, AXON_W0, AXON_W1);
    var term = ax.terminal;
    if (term && term.on) {
      ribbon(g, term.pts, NP_TERMINAL, TERMINAL_W0, TERMINAL_W1);
      g.beginPath();
      g.arc(term.pts[2 * NP_TERMINAL - 2], term.pts[2 * NP_TERMINAL - 1], BOUTON_R, 0, Math.PI * 2);
      g.fill();
    }
  }
  function drawSomas(g) {
    var ns = field.neurons;
    for (var i = 0; i < ns.length; i++) {
      var s = ns[i].r * SOMA_SPRITE_SCALE;
      g.drawImage(somaC, ns[i].px - s / 2, ns[i].py - s / 2, s, s);
    }
  }

  /* The structure is drawn opaque on the scratch layer and composited once at the token alpha, so crossing
     fibres never add up beyond it. The somas then punch their own footprint out before landing at their alpha. */
  function beginCycle() {
    layout();
    xctx.clearRect(0, 0, W, H);
    xctx.fillStyle = tok.fibre;
    buildIndex = 0;
  }
  function compositeCycle() {
    sctx.clearRect(0, 0, W, H);
    sctx.globalAlpha = tok.fibreA;
    sctx.drawImage(scratchC, 0, 0, W, H);
    xctx.clearRect(0, 0, W, H);
    drawSomas(xctx);
    sctx.globalCompositeOperation = 'destination-out';
    sctx.globalAlpha = 1;
    sctx.drawImage(scratchC, 0, 0, W, H);
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = tok.somaA;
    sctx.drawImage(scratchC, 0, 0, W, H);
    sctx.globalAlpha = 1;
    buildIndex = -1;
  }
  function stepBuild() {
    var ns = field.neurons;
    if (buildIndex < 0) beginCycle();
    var end = Math.min(buildIndex + NEURONS_PER_FRAME, ns.length);
    for (; buildIndex < end; buildIndex++) drawFibres(xctx, ns[buildIndex]);
    if (buildIndex >= ns.length) compositeCycle();
  }
  function rebuildAll() {
    beginCycle();
    var ns = field.neurons;
    for (; buildIndex < ns.length; buildIndex++) drawFibres(xctx, ns[buildIndex]);
    compositeCycle();
  }

  /* ---- frame ---- */
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(staticC, 0, 0, W, H);
    if (reduce) return;
    var ns = field.neurons, now = sched.time, i;
    ctx.fillStyle = tok.accent;
    for (i = 0; i < ns.length; i++) {
      var age = now - sched.flashAt[i];
      if (age < 0 || age >= FLASH_MS) continue;
      var u = age / FLASH_MS;
      var env = u < FLASH_RISE ? u / FLASH_RISE : Math.exp(-(u - FLASH_RISE) * FLASH_DECAY);
      var n = ns[i], halo = n.r * HALO_SCALE;
      ctx.globalAlpha = env * HALO_ALPHA;
      ctx.drawImage(glowC, n.px - halo / 2, n.py - halo / 2, halo, halo);
      ctx.globalAlpha = env;
      ctx.beginPath();
      ctx.arc(n.px, n.py, n.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    var pulses = sched.pulses;
    for (i = 0; i < pulses.length; i++) {
      var p = pulses[i];
      if (!p.active) continue;
      var ax = ns[p.source].axon, pts = ax.pts[p.axon], cum = ax.cum[p.axon];
      var len = ax.lengths[p.axon], s = p.s < len ? p.s : len;
      M.pointAt(pts, cum, NP_AXON, s, P);
      var hx = P.x, hy = P.y, px = hx, py = hy;
      for (var k = 1; k <= TAIL_SEGS; k++) {
        var sk = s - TAIL_PX * k / TAIL_SEGS;
        if (sk < 0) break;
        M.pointAt(pts, cum, NP_AXON, sk, P);
        ctx.strokeStyle = tailStyle[k];
        ctx.lineWidth = TAIL_W0 + (TAIL_W1 - TAIL_W0) * k / TAIL_SEGS;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(P.x, P.y);
        ctx.stroke();
        px = P.x; py = P.y;
      }
      ctx.globalAlpha = PULSE_GLOW_ALPHA;
      ctx.drawImage(glowC, hx - PULSE_GLOW_PX / 2, hy - PULSE_GLOW_PX / 2, PULSE_GLOW_PX, PULSE_GLOW_PX);
      ctx.globalAlpha = 1;
      ctx.fillStyle = tok.accent;
      ctx.beginPath();
      ctx.arc(hx, hy, HEAD_R, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---- loop ---- */
  function tick(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    var t0 = Lab.now();
    if (lastTs < 0) lastTs = ts;
    var dt = Lab.clamp(ts - lastTs, 0, MAX_STEP_MS);
    lastTs = ts;
    sched.advance(dt);
    stepBuild();
    draw();
    var cost = Lab.now() - t0;
    costSum += cost; frames++;
    if (cost > costMax) costMax = cost;
  }
  function start() {
    if (running || paused) return;
    running = true; lastTs = -1;
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ---- sizing ---- */
  function layer(c) {
    var bw = Math.round(W * DPR), bh = Math.round(H * DPR);
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    var g = c.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    return g;
  }
  function regenerate() {
    field = M.generate(SEED, W, H);
    sched = new M.Scheduler(field);
    if (spike) { sched.intervalMin = SPIKE_INTERVAL; sched.intervalMax = SPIKE_INTERVAL; sched.nextSpontaneous = 0; }
    hooks.count = field.neurons.length;
  }
  /* A small change of size (the address bar of a phone) only rescales the field; a large one regenerates it. */
  function fit() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width || window.innerWidth));
    H = Math.max(1, Math.round(rect.height || window.innerHeight));
    DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP, Math.sqrt(MAX_BACKING_PIXELS / (W * H)));
    ctx = layer(canvas); sctx = layer(staticC); xctx = layer(scratchC);
    if (!field || Math.abs(W * H - field.w * field.h) > REBUILD_AREA_RATIO * field.w * field.h) regenerate();
    makeSprites();
    rebuildAll();
    if (!running) draw();
  }
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fit, RESIZE_DEBOUNCE);
  });
  Lab.onTheme(function () {
    readTokens();
    makeSprites();
    rebuildAll();
    if (!running) draw();
  });

  /* ---- pointer: the nearest neuron becomes the likely next to fire, never a listener on the canvas ---- */
  var lastPointer = 0;
  function onPointer(e) {
    var now = Lab.now();
    if (now - lastPointer < POINTER_MS) return;
    lastPointer = now;
    var ns = field.neurons, best = -1, bd = Infinity;
    for (var i = 0; i < ns.length; i++) {
      var dx = ns[i].px - e.clientX, dy = ns[i].py - e.clientY, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    var weight = 1 - Math.sqrt(bd) / POINTER_RADIUS;
    if (weight <= 0) sched.setHot(-1, 0); else sched.setHot(best, weight);
  }

  /* ---- init ---- */
  readTokens();
  fit();
  if (!reduce) {
    Lab.whenVisible(canvas, start, stop);
    window.addEventListener('pointermove', onPointer, { passive: true });
  }

  /* Scripted checks (see README). */
  hooks.fire = function (index) {
    sched.start(Lab.clamp(index | 0, 0, field.neurons.length - 1));
    if (!running) draw();
  };
  hooks.pause = function () { paused = true; stop(); };
  hooks.resume = function () { paused = false; start(); };
  hooks.isRunning = function () { return running; };
  hooks.frameMs = function () {
    var out = { frames: frames, avg: frames ? costSum / frames : 0, max: costMax };
    frames = 0; costSum = 0; costMax = 0;
    return out;
  };
  window.__neurons = hooks;
})();
