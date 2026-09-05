/* Minis: the two small bento figures. Loaded with defer after lab.js and site.js.
   (A) #mini-graph "Brain connectivity": a seeded toy connectivity graph over the 19 electrodes of the 10-20
       montage with one left temporo-parietal cluster outlined as the candidate zone. Static frame, redrawn on
       hover, focus, resize and theme change. No loop.
   (B) #mini-topo "Microstates": a scalp topography stepping through the four canonical classes A to D on a
       labelled duration bar. The loop runs only while the figure and the tab are visible.
   Part 1 is a pure model (no DOM access) exported on window.__minisModel for tests/minis.test.js, which runs
   it in a bare engine after lab.js. Part 2 attaches to the DOM and exits for each figure whose root is missing.
   Debug hooks: ?highlight=NAME pins that electrode in (A), ?topo=LETTER shows that class first in (B). */
(function () {
  'use strict';

  var Lab = window.Lab;
  var MONTAGE = Lab.MONTAGE;
  var N = MONTAGE.length;

  /* ======================================================================
     Part 1: model (pure functions, no DOM access)
     ====================================================================== */

  /* Left temporo-parietal cluster: the subnetwork with elevated coupling, outlined as the candidate zone. */
  var CLUSTER_NAMES = ['T3', 'T5', 'C3', 'P3', 'F7'];
  var CLASSES = ['A', 'B', 'C', 'D'];

  function normalise(arr) {
    var m = 0, i;
    for (i = 0; i < arr.length; i++) if (Math.abs(arr[i]) > m) m = Math.abs(arr[i]);
    if (m > 0) for (i = 0; i < arr.length; i++) arr[i] = arr[i] / m;
    return arr;
  }

  /* Four fixed sign templates, one 19-value array each, normalised to max |v| = 1.
     A: diagonal from left-posterior (negative) to right-frontal (positive).
     B: the mirror diagonal, right-posterior (negative) to left-frontal (positive).
     C: anterior (positive) versus posterior (negative).
     D: fronto-central maximum with a weaker occipital pole of opposite sign. */
  var TEMPLATES = (function () {
    var A = [], B = [], C = [], D = [];
    for (var i = 0; i < N; i++) {
      var x = MONTAGE[i].x, y = MONTAGE[i].y;
      A.push((x + y) / Math.SQRT2);
      B.push((y - x) / Math.SQRT2);
      C.push(y);
      var dFront = x * x + (y - 0.3) * (y - 0.3);
      var dOcc = x * x + (y + 0.95) * (y + 0.95);
      D.push(Math.exp(-dFront / 0.42) - 0.5 * Math.exp(-dOcc / 0.32));
    }
    return { A: normalise(A), B: normalise(B), C: normalise(C), D: normalise(D) };
  })();

  /* The displayed microstate sequence. A segment is a maximal run of samples assigned to one class, so no
     two adjacent segments may share a label, and the sequence loops, so the last and first differ too.
     Durations are realistic segment lengths (60-120 ms); on screen every segment stays SEG_MS so the eye can
     follow, and the bar keeps the true proportions through --dur. */
  var SEQUENCE = [
    { cls: 'A', dur: 80 }, { cls: 'B', dur: 60 }, { cls: 'D', dur: 110 }, { cls: 'C', dur: 95 },
    { cls: 'D', dur: 70 }, { cls: 'A', dur: 120 }, { cls: 'C', dur: 85 }, { cls: 'D', dur: 65 },
    { cls: 'B', dur: 100 }, { cls: 'C', dur: 90 }
  ];

  /* Convex hull, Andrew's monotone chain. Vertices come back in counter-clockwise order in the algebraic
     sense (positive cross products), which on a y-down canvas reads as clockwise. Collinear input gives the
     two end points, a single point gives itself, empty gives empty. */
  function hull(points) {
    var pts = points.slice().sort(function (a, b) { return a.x === b.x ? a.y - b.y : a.x - b.x; });
    if (pts.length < 3) return pts;
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lower = [], upper = [], i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  /* Padded outline of a convex hull with rounded joins: one arc per vertex, centred on the vertex with radius
     pad, sweeping from the outward normal of the incoming edge to the outward normal of the outgoing edge.
     Canvas arc() draws the straight segment between consecutive arcs for free. */
  function outline(h, pad) {
    var n = h.length, arcs = [];
    if (n === 0) return arcs;
    if (n === 1) return [{ x: h[0].x, y: h[0].y, a0: 0, a1: Math.PI * 2, pad: pad }];
    for (var i = 0; i < n; i++) {
      var prev = h[(i - 1 + n) % n], cur = h[i], next = h[(i + 1) % n];
      var a0 = Math.atan2(-(cur.x - prev.x), cur.y - prev.y);
      var a1 = Math.atan2(-(next.x - cur.x), next.y - cur.y);
      arcs.push({ x: cur.x, y: cur.y, a0: a0, a1: a1, pad: pad });
    }
    return arcs;
  }

  /* Seeded toy graph: edge weight decreasing with scalp distance (Gaussian kernel, sigma in unit-circle
     units), jittered and capped below the cluster floor, so every pair inside the cluster outweighs every
     other edge. Pairs below the weight floor get no edge, so the far pairs of the montage stay unconnected. */
  var GRAPH = (function () {
    var SIGMA = 0.42, MIN_WEIGHT = 0.16, BACKGROUND_MAX = 0.7, CLUSTER_MIN = 0.72;
    var rnd = Lab.rng(20260904);
    var inCluster = [], edges = [], degree = [], cluster = [], i, j;
    for (i = 0; i < N; i++) { inCluster.push(false); degree.push(0); }
    for (i = 0; i < CLUSTER_NAMES.length; i++) {
      var k = Lab.electrodeIndex(CLUSTER_NAMES[i]);
      inCluster[k] = true;
      cluster.push(k);
    }
    for (i = 0; i < N; i++) {
      for (j = i + 1; j < N; j++) {
        var dx = MONTAGE[i].x - MONTAGE[j].x, dy = MONTAGE[i].y - MONTAGE[j].y;
        var strong = inCluster[i] && inCluster[j];
        var w = strong ? CLUSTER_MIN + (1 - CLUSTER_MIN) * rnd()
          : Math.min(BACKGROUND_MAX, Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA)) * (0.6 + 0.8 * rnd()));
        if (w < MIN_WEIGHT) continue;
        edges.push({ a: i, b: j, w: w, strong: strong });
        degree[i]++; degree[j]++;
      }
    }
    return { edges: edges, degree: degree, cluster: cluster, inCluster: inCluster };
  })();

  /* Separable 5-tap binomial blur over a square grid of side g, in place, using a scratch buffer of the same
     length. Two passes take the electrode-centred bumps out of the interpolated topography. */
  function smoothGrid(field, g, scratch, passes) {
    var k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16], p, x, y, i, s, o;
    for (p = 0; p < passes; p++) {
      for (y = 0; y < g; y++) {
        for (x = 0; x < g; x++) {
          s = 0;
          for (i = -2; i <= 2; i++) { o = Lab.clamp(x + i, 0, g - 1); s += k[i + 2] * field[y * g + o]; }
          scratch[y * g + x] = s;
        }
      }
      for (y = 0; y < g; y++) {
        for (x = 0; x < g; x++) {
          s = 0;
          for (i = -2; i <= 2; i++) { o = Lab.clamp(y + i, 0, g - 1); s += k[i + 2] * scratch[o * g + x]; }
          field[y * g + x] = s;
        }
      }
    }
  }

  /* Interpolated topography of one template on a g x g grid spanning [-span, span]^2 (y up), blurred and
     renormalised so the extreme inside the head circle is exactly 1. The mask is the head circle with a
     small margin so the blurred edge of the map reaches under the head outline. Returns {field, mask}. */
  function topography(values, g, span) {
    var HEAD_MASK_R = 1.06, IDW_POWER = 3, BLUR_PASSES = 2;
    var gn = g * g, field = new Float32Array(gn), mask = new Uint8Array(gn), scratch = new Float32Array(gn);
    var gx, gy, gi, mx = 0;
    for (gy = 0; gy < g; gy++) {
      for (gx = 0; gx < g; gx++) {
        gi = gy * g + gx;
        var ux = ((gx + 0.5) / g) * 2 * span - span;
        var uy = span - ((gy + 0.5) / g) * 2 * span;
        mask[gi] = (ux * ux + uy * uy) <= HEAD_MASK_R * HEAD_MASK_R ? 1 : 0;
        field[gi] = Lab.idw(values, MONTAGE, ux, uy, IDW_POWER);
      }
    }
    smoothGrid(field, g, scratch, BLUR_PASSES);
    for (gi = 0; gi < gn; gi++) if (mask[gi] && Math.abs(field[gi]) > mx) mx = Math.abs(field[gi]);
    if (mx > 0) for (gi = 0; gi < gn; gi++) field[gi] /= mx;
    return { field: field, mask: mask };
  }

  window.__minisModel = {
    TEMPLATES: TEMPLATES,
    SEQUENCE: SEQUENCE,
    GRAPH: GRAPH,
    CLUSTER: CLUSTER_NAMES,
    CLASSES: CLASSES,
    hull: hull,
    outline: outline,
    topography: topography
  };

  /* ======================================================================
     Part 2: DOM
     ====================================================================== */
  if (typeof document === 'undefined') return;

  /* Scripted checks (see README) drive the figures through window.__minis. */
  var api = { graph: null, topo: null };
  window.__minis = api;

  /* ---------------------------------------------------------------------
     (A) Brain connectivity
     --------------------------------------------------------------------- */
  (function initGraph() {
    var root = document.getElementById('mini-graph');
    if (!root) return;
    var fig = root.querySelector('.mini-figure');
    var canvas = fig.querySelector('canvas');

    /* Geometry, in CSS px. Ring labels sit outside the candidate zone outline, which also clears the ears
       (0.75 of the nose height beyond the ring) and the nose (0.11 R) for any head this cell can hold. */
    var ZONE_PAD = 14;                         /* outline distance from the cluster nodes */
    var LABEL_GAP = 6;                         /* label distance from a node or from the outline */
    var RING_LABEL_GAP = ZONE_PAD + LABEL_GAP; /* ring labels: distance beyond the head ring */
    var LABEL_HALF_H = 7;                      /* half height of a label plus its halo */
    var SIDE_ROOM = RING_LABEL_GAP + 30;       /* room beside the ring for the widest label */
    var COS_FP = Math.cos(18 * Math.PI / 180); /* Fp1/Fp2 and O1/O2 are 18 deg off the midline: the topmost and lowest labels */
    var HI_RING = 5;                           /* gap between a highlighted node and its ring */
    var NODE_R_MIN = 3, NODE_R_PER_DEGREE = 0.6;

    var t = Lab.tokens();
    var g = GRAPH;
    var cw = 0, ch = 0, ctx = null, cx = 0, cy = 0, R = 0;
    var px = new Float32Array(N), py = new Float32Array(N), nr = new Float32Array(N);
    var arcs = [];
    /* Three sources of highlight: mouse hover, keyboard focus (both transient) and a pinned node set by
       click, Enter or Space. The drawn highlight is hover, else focus, else pinned; aria-pressed tracks only
       the pinned node so a plain hover never reports a state change. */
    var hi = -1, hoverIdx = -1, focusIdx = -1, pinned = -1;
    var buttons = [];
    var neighbour = new Uint8Array(N);

    /* One real button per electrode, laid over the canvas; the stylesheet sizes them, layout() places them. */
    var layer = document.createElement('div');
    layer.className = 'mini-buttons';
    layer.setAttribute('role', 'group');
    layer.setAttribute('aria-label', 'Electrodes. Press one to highlight it');
    for (var i = 0; i < N; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Highlight ' + MONTAGE[i].name);
      b.setAttribute('aria-pressed', 'false');
      b.dataset.index = String(i);
      b.addEventListener('mouseenter', onEnter);
      b.addEventListener('focus', onEnter);
      b.addEventListener('mouseleave', onLeave);
      b.addEventListener('blur', onLeave);
      b.addEventListener('click', onClick);
      layer.appendChild(b);
      buttons.push(b);
    }
    fig.appendChild(layer);

    /* Readout for assistive technology: the canvas is aria-hidden, so every highlight is described here. */
    var readout = document.createElement('p');
    readout.className = 'visually-hidden';
    readout.setAttribute('aria-live', 'polite');
    fig.appendChild(readout);

    function onEnter(e) {
      var idx = +e.currentTarget.dataset.index;
      if (e.type === 'focus') focusIdx = idx; else hoverIdx = idx;
      resolveHighlight();
    }
    function onLeave(e) {
      var idx = +e.currentTarget.dataset.index;
      if (e.type === 'blur') { if (focusIdx === idx) focusIdx = -1; }
      else if (hoverIdx === idx) hoverIdx = -1;
      resolveHighlight();
    }
    /* Click, Enter or Space pins the node; activating the pinned node again unpins it. */
    function onClick(e) {
      var idx = +e.currentTarget.dataset.index;
      setPinned(pinned === idx ? -1 : idx);
    }
    function setPinned(idx) {
      if (idx === pinned) return;
      pinned = idx;
      for (var k = 0; k < N; k++) buttons[k].setAttribute('aria-pressed', k === pinned ? 'true' : 'false');
      resolveHighlight();
    }
    function resolveHighlight() {
      setHighlight(hoverIdx >= 0 ? hoverIdx : focusIdx >= 0 ? focusIdx : pinned);
    }
    function setHighlight(idx) {
      if (idx === hi) return;
      hi = idx;
      var k, e;
      for (k = 0; k < N; k++) neighbour[k] = 0;
      if (hi >= 0) {
        for (k = 0; k < g.edges.length; k++) {
          e = g.edges[k];
          if (e.a === hi) neighbour[e.b] = 1; else if (e.b === hi) neighbour[e.a] = 1;
        }
      }
      readout.textContent = describe(hi);
      draw();
    }
    function describe(k) {
      if (k < 0) return 'No electrode highlighted';
      var d = g.degree[k];
      return MONTAGE[k].name + ': ' + d + (d === 1 ? ' connection' : ' connections') +
        (g.inCluster[k] ? ', in the candidate zone' : '');
    }

    function layout() {
      var f = Lab.fitCanvas(canvas);
      cw = f.w; ch = f.h; ctx = f.ctx;
      cx = cw / 2; cy = ch / 2;
      R = Math.max(30, Math.min(cw / 2 - SIDE_ROOM, (ch / 2 - LABEL_HALF_H) / COS_FP - RING_LABEL_GAP));
      var pts = [];
      for (var k = 0; k < N; k++) {
        var p = Lab.toScreen(MONTAGE[k], cx, cy, R);
        px[k] = p.x; py[k] = p.y;
        nr[k] = NODE_R_MIN + g.degree[k] * NODE_R_PER_DEGREE;
        buttons[k].style.left = p.x.toFixed(1) + 'px';
        buttons[k].style.top = p.y.toFixed(1) + 'px';
        if (g.inCluster[k]) pts.push({ x: p.x, y: p.y });
      }
      arcs = outline(hull(pts), ZONE_PAD);
      draw();
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, cw, ch);
      Lab.drawHead(ctx, cx, cy, R, t);

      /* Candidate zone: padded convex hull of the cluster, dashed accent with a faint accent fill. */
      ctx.save();
      ctx.beginPath();
      for (var a = 0; a < arcs.length; a++) ctx.arc(arcs[a].x, arcs[a].y, arcs[a].pad, arcs[a].a0, arcs[a].a1, false);
      ctx.closePath();
      ctx.fillStyle = Lab.rgba(t.accent, 0.06);
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = Lab.rgba(t.accent, 0.9);
      ctx.stroke();
      ctx.restore();

      /* Edges: alpha and width follow weight; a highlight isolates one node's edges at full alpha. */
      var edges = g.edges, e, k;
      ctx.lineCap = 'round';
      for (k = 0; k < edges.length; k++) {
        e = edges[k];
        var touches = hi >= 0 && (e.a === hi || e.b === hi);
        var alpha, color;
        if (e.strong) { color = t.accent; alpha = 0.45 + 0.5 * e.w; } else { color = t.trace; alpha = 0.12 + 0.4 * e.w; }
        if (hi >= 0) alpha = touches ? 1 : alpha * 0.18;
        ctx.strokeStyle = Lab.rgba(touches ? t.accent : color, alpha);
        ctx.lineWidth = (0.75 + 1.5 * e.w) + (touches ? 0.5 : 0);
        ctx.beginPath();
        ctx.moveTo(px[e.a], py[e.a]);
        ctx.lineTo(px[e.b], py[e.b]);
        ctx.stroke();
      }

      /* Nodes: radius grows with degree, cluster nodes in the accent, the highlighted node gets a ring. */
      for (k = 0; k < N; k++) {
        var isHi = k === hi;
        var dim = hi >= 0 && !isHi && !neighbour[k];
        ctx.beginPath();
        ctx.arc(px[k], py[k], nr[k] + (isHi ? 1.5 : 0), 0, Math.PI * 2);
        ctx.fillStyle = Lab.rgba(g.inCluster[k] || isHi ? t.accent : t.ink, dim ? 0.3 : 0.92);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = t.surface;
        ctx.stroke();
        if (isHi) {
          ctx.beginPath();
          ctx.arc(px[k], py[k], nr[k] + HI_RING, 0, Math.PI * 2);
          ctx.lineWidth = 1.25;
          ctx.strokeStyle = Lab.rgba(t.accent, 0.8);
          ctx.stroke();
        }
      }

      /* Labels, drawn last with a halo in the cell background so they stay legible over edges. Ring
         electrodes: pushed radially outward past the zone outline and the ears. Inner electrodes: above
         the node. */
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = t.surface2;
      for (k = 0; k < N; k++) {
        var isH = k === hi;
        var ux = MONTAGE[k].x, uy = -MONTAGE[k].y;
        var onRing = ux * ux + uy * uy > 0.9;
        var lx, ly;
        if (onRing) {
          lx = cx + ux * (R + RING_LABEL_GAP);
          ly = cy + uy * (R + RING_LABEL_GAP);
          ctx.textAlign = Math.abs(ux) < 0.3 ? 'center' : (ux < 0 ? 'right' : 'left');
        } else {
          lx = px[k];
          ly = py[k] - nr[k] - LABEL_GAP - (isH ? HI_RING : 0);
          ctx.textAlign = 'center';
        }
        ctx.font = isH ? Lab.font(12, t, 600) : Lab.font(9.5, t);
        ctx.strokeText(MONTAGE[k].name, lx, ly);
        var dimL = hi >= 0 && !isH && !neighbour[k];
        ctx.fillStyle = isH ? t.ink : Lab.rgba(t.muted, dimL ? 0.45 : 1);
        ctx.fillText(MONTAGE[k].name, lx, ly);
      }
    }

    new ResizeObserver(layout).observe(fig);
    Lab.onTheme(function () { t = Lab.tokens(); draw(); });
    Lab.fontsReady(draw);
    layout();

    var forcedHi = Lab.param('highlight');
    if (forcedHi) setPinned(Lab.electrodeIndex(forcedHi));

    api.graph = {
      highlight: function (name) { setPinned(Lab.electrodeIndex(name)); return hi; },
      current: function () { return hi; },
      pinned: function () { return pinned; },
      readout: function () { return readout.textContent; }
    };
  })();

  /* ---------------------------------------------------------------------
     (B) Microstates
     --------------------------------------------------------------------- */
  (function initTopo() {
    var root = document.getElementById('mini-topo');
    if (!root) return;
    var fig = root.querySelector('.topo-figure');
    var canvas = fig.querySelector('canvas');
    var label = document.getElementById('mini-topo-label');
    var bar = document.getElementById('mini-topo-bar');

    var t = Lab.tokens();
    var seqLen = SEQUENCE.length;
    var SEG_MS = 700, FADE_MS = 200;
    var reduce = Lab.reduceMotion;

    /* Offscreen grid: G x G samples over [-SPAN, SPAN]^2, masked to the head circle at draw time. The four
       fields are interpolated once at init; each frame only blends two of them into the image. */
    var G = 72, GN = G * G, SPAN = 1.05;
    var off = document.createElement('canvas');
    off.width = G; off.height = G;
    var octx = off.getContext('2d');
    var img = octx.createImageData(G, G);
    var pix = img.data;
    var fields = new Float32Array(CLASSES.length * GN);
    var mask = null;
    for (var c = 0; c < CLASSES.length; c++) {
      var topo = topography(TEMPLATES[CLASSES[c]], G, SPAN);
      fields.set(topo.field, c * GN);
      mask = topo.mask;
    }

    /* Colour endpoints, refreshed on theme change. Positive blends the accent over the surface, negative
       blends the ink over the surface; only alpha changes, never a second hue. */
    var sr = 0, sg = 0, sb = 0, ar = 0, ag = 0, ab = 0, ir = 0, ig = 0, ib = 0;
    function readColors() {
      var s = Lab.rgb(t.surface), a = Lab.rgb(t.accent), n = Lab.rgb(t.ink);
      sr = s[0]; sg = s[1]; sb = s[2]; ar = a[0]; ag = a[1]; ab = a[2]; ir = n[0]; ig = n[1]; ib = n[2];
    }
    readColors();

    /* Write the blend of two signed templates at progress p into the offscreen image. No allocation.
       The tone curve lifts the mid range so the map does not read as one faint blob; the negative pole is
       painted weaker because the ink is much darker than the accent. */
    function compose(c0, s0, c1, s1, p) {
      var q = 1 - p, o0 = c0 * GN, o1 = c1 * GN;
      for (var gi = 0; gi < GN; gi++) {
        var o = gi * 4;
        if (!mask[gi]) { pix[o + 3] = 0; continue; }
        var v = q * s0 * fields[o0 + gi] + p * s1 * fields[o1 + gi];
        var a = Math.min(Math.abs(v), 1);
        a = Math.sqrt(a) * a * 0.35 + a * 0.65;
        if (v >= 0) {
          a *= 0.9;
          pix[o] = sr + (ar - sr) * a; pix[o + 1] = sg + (ag - sg) * a; pix[o + 2] = sb + (ab - sb) * a;
        } else {
          a *= 0.64;
          pix[o] = sr + (ir - sr) * a; pix[o + 1] = sg + (ig - sg) * a; pix[o + 2] = sb + (ib - sb) * a;
        }
        pix[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
    }

    var cw = 0, ch = 0, ctx = null;

    /* Draw the offscreen map scaled into a head of radius r, then the outline and the electrodes on top. */
    function drawHeadMap(cx, cy, r, dotR) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      var half = r * SPAN;
      ctx.drawImage(off, cx - half, cy - half, 2 * half, 2 * half);
      ctx.restore();
      Lab.drawHead(ctx, cx, cy, r, t);
      ctx.fillStyle = Lab.rgba(t.ink, 0.55);
      ctx.strokeStyle = Lab.rgba(t.surface, 0.9);
      ctx.lineWidth = 1;
      for (var k = 0; k < N; k++) {
        ctx.beginPath();
        ctx.arc(cx + MONTAGE[k].x * r, cy - MONTAGE[k].y * r, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    /* ---- Animated path ---- */
    var cur = -1, fromC = 0, fromS = 1, toC = 0, toS = 1, lastP = 1;
    var t0 = 0, phase = 0, running = false, raf = 0;
    var spans = [];
    for (var i = 0; i < seqLen; i++) {
      var sp = document.createElement('span');
      sp.style.setProperty('--dur', String(SEQUENCE[i].dur));
      sp.title = SEQUENCE[i].cls + ' ' + SEQUENCE[i].dur + ' ms';
      bar.appendChild(sp);
      spans.push(sp);
    }
    function markSegment(idx) {
      for (var i = 0; i < spans.length; i++) spans[i].classList.toggle('on', i === idx);
      label.textContent = idx >= 0 ? SEQUENCE[idx].cls : '';
    }
    /* Microstate classes are polarity-invariant: a map and its sign flip belong to the same class. To make
       that visible, every second pass through the sequence shows every template with inverted polarity. */
    function signFor(cycle) {
      return cycle % 2 === 0 ? 1 : -1;
    }
    function enter(idx, cycle) {
      fromC = toC; fromS = toS;
      toC = CLASSES.indexOf(SEQUENCE[idx].cls); toS = signFor(cycle);
      if (cur < 0) { fromC = toC; fromS = toS; }
      cur = idx;
      markSegment(idx);
    }
    function renderAnimated(p) {
      if (!ctx) return;
      lastP = p;
      compose(fromC, fromS, toC, toS, p);
      ctx.clearRect(0, 0, cw, ch);
      var r = Math.max(30, Math.min(cw / 2 - 24, (ch - 32) / 2.22));
      drawHeadMap(cw / 2, ch / 2 + r * 0.05, r, 2.2);
    }
    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var el = now - t0;
      var total = SEG_MS * seqLen;
      var cycle = Math.floor(el / total);
      var idx = Math.floor((el - cycle * total) / SEG_MS);
      if (idx !== cur) enter(idx, cycle);
      var p = (el - cycle * total - idx * SEG_MS) / FADE_MS;
      if (p < 1) renderAnimated(p < 0 ? 0 : p);
      else if (lastP < 1) renderAnimated(1);
    }
    function start() {
      if (running) return;
      running = true;
      t0 = performance.now() - phase;
      lastP = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (!running) return;
      running = false;
      phase = performance.now() - t0;
      cancelAnimationFrame(raf);
    }

    /* ---- Reduced-motion path: the four maps side by side, lettered, no loop ---- */
    function renderStatic() {
      if (!ctx) return;
      ctx.clearRect(0, 0, cw, ch);
      var cols = cw >= 4 * 84 ? 4 : 2, rows = cols === 4 ? 1 : 2;
      var cellW = cw / cols, cellH = ch / rows;
      var r = Math.max(18, Math.min(cellW / 2 - 7, (cellH - 30) / 2.3));
      for (var c = 0; c < CLASSES.length; c++) {
        var col = c % cols, row = Math.floor(c / cols);
        var cx = cellW * (col + 0.5), cy = cellH * (row + 0.5) + r * 0.08 + 6;
        compose(c, 1, c, 1, 1);
        drawHeadMap(cx, cy, r, 1.4);
        ctx.font = Lab.font(12, t, 600);
        ctx.fillStyle = t.accent;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(CLASSES[c], cx, cy - r * 1.11 - 8);
      }
    }

    function layout() {
      var f = Lab.fitCanvas(canvas);
      cw = f.w; ch = f.h; ctx = f.ctx;
      redraw();
    }
    function redraw() {
      if (reduce) renderStatic();
      else if (cur >= 0) renderAnimated(lastP < 1 ? lastP : 1);
      else { enter(0, 0); renderAnimated(1); }
    }

    new ResizeObserver(layout).observe(fig);
    Lab.onTheme(function () { t = Lab.tokens(); readColors(); redraw(); });
    Lab.fontsReady(function () { if (reduce) renderStatic(); });
    layout();

    if (reduce) markSegment(-1);
    else Lab.whenVisible(fig, start, stop);

    api.topo = {
      show: function (letter) {
        var L = String(letter || '').toUpperCase();
        var idx = -1;
        for (var i = 0; i < seqLen; i++) if (SEQUENCE[i].cls === L) { idx = i; break; }
        if (idx < 0) return cur;
        if (reduce) { markSegment(idx); return idx; }
        phase = idx * SEG_MS;
        if (running) t0 = performance.now() - phase;
        enter(idx, 0);
        renderAnimated(1);
        return idx;
      },
      current: function () { return cur >= 0 ? SEQUENCE[cur].cls : ''; },
      running: function () { return running; }
    };
    var forcedCls = Lab.param('topo');
    if (forcedCls) api.topo.show(forcedCls);
  })();
})();
