/* Brain: the "Brain connectivity" cell (#mini-brain). The cortical surface of the ICBM152 template
   (BrainMesh_ICBM152 of BrainNet Viewer, surface by Prof. Alan C. Evans, MNI; packed in
   assets/js/cortex-data.js) is drawn as a flat-shaded mesh of 2560 triangles that turns slowly. A candidate
   epileptogenic zone sits on the left temporo-parietal cortex, painted on the surface itself, and 24 cortical
   sources carry a seeded toy network of arcs lifted above the surface, with the zone as its hub.
   Part 1 is a pure model (decoding, the MNI transform, the zone, the sources, the graph, the projection and
   the shading) exported on window.__brainModel for tests/brain.test.js, which runs it in a bare engine after
   lab.js and cortex-data.js. Part 2 attaches to the DOM and exits when the cell is missing. Debug hooks:
   ?highlight=7 pins a source, ?yaw=DEG sets the initial rotation. */
(function () {
  'use strict';

  var Lab = window.Lab;
  var DATA = window.CORTEX_DATA;
  if (!Lab || !DATA) return;

  /* ======================================================================
     Part 1: model (no DOM access)
     ====================================================================== */

  /* The candidate zone was computed offline from the anatomical vertex positions (a unilateral focus in the
     left supramarginal region) and arrives as a per-vertex weight; these two numbers only record where it
     came from, so the figure and its tests can be read without opening the data file. */
  var ZONE_MNI = [-52, -48, 26];
  var ZONE_MM = 32;
  var ZONE_ON = 0.35;                         /* above this weight a vertex counts as inside the zone */

  var EDGE_COUNT = 52, EDGE_SIGMA = 0.55, EDGE_FLOOR = 0.55, EDGE_JITTER = 0.45, EDGE_ZONE_GAIN = 2.5;
  var GRAPH_SEED = 20260906;

  var YAW_DEFAULT = 92, PITCH_DEFAULT = 10;   /* left lateral view, the zone facing the viewer */
  /* Light in VIEW space: upper left and slightly in front of the camera. */
  var LIGHT = (function () {
    var x = -0.42, y = -0.66, z = 0.62, l = Math.sqrt(x * x + y * y + z * z);
    return [x / l, y / l, z / l];
  })();
  var AMBIENT = 0.16;                         /* tone of a face the light does not reach */
  var SUL_MIN = 0.62, SUL_SPAN = 0.38;        /* a sulcus keeps 62 percent of the tone of a gyral crown */
  var SUL_LO = -0.10, SUL_HI = 0.10;          /* curvature band over which the two are interpolated */
  var DEPTH_FLOOR = 0.55;                     /* tone of the farthest face relative to the nearest */

  /* ---- decoding ---------------------------------------------------------
     One big-endian blob (see the header of cortex-data.js): three uint16 counts, then the vertices, the
     per-vertex normals, curvature and zone weight, the triangles and the source indices. Decoded once into
     preallocated arrays. The normals are sampled from the full-resolution surface and are what carries the
     shape: recomputing them from this coarse mesh shades visibly flatter. */
  var POS_UNIT = 30000, NRM_UNIT = 127;
  function u16at(bin, o) { return (bin.charCodeAt(o) << 8) | bin.charCodeAt(o + 1); }
  function i16at(bin, o) { var v = u16at(bin, o); return v > 32767 ? v - 65536 : v; }
  function i8at(bin, o) { var v = bin.charCodeAt(o); return v > 127 ? v - 256 : v; }

  function decodeCortex(d) {
    var bin = atob(d.mesh);
    var n = u16at(bin, 0), f = u16at(bin, 2), s = u16at(bin, 4);
    var pos = 6, nrm = pos + n * 6, cur = nrm + n * 3, zon = cur + n, tri = zon + n, src = tri + f * 6;
    var x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
    var nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n);
    var curv = new Float32Array(n), zone = new Float32Array(n);
    var faces = new Uint16Array(f * 3), sources = new Uint16Array(s), i, o;
    for (i = 0; i < n; i++) {
      o = pos + i * 6;
      x[i] = i16at(bin, o) / POS_UNIT;
      y[i] = i16at(bin, o + 2) / POS_UNIT;
      z[i] = i16at(bin, o + 4) / POS_UNIT;
      o = nrm + i * 3;
      nx[i] = i8at(bin, o) / NRM_UNIT;
      ny[i] = i8at(bin, o + 1) / NRM_UNIT;
      nz[i] = i8at(bin, o + 2) / NRM_UNIT;
      curv[i] = bin.charCodeAt(cur + i) / 255 * 2 - 1;
      zone[i] = bin.charCodeAt(zon + i) / 255;
    }
    for (i = 0; i < f * 3; i++) faces[i] = u16at(bin, tri + i * 2);
    for (i = 0; i < s; i++) sources[i] = u16at(bin, src + i * 2);
    /* One hemisphere of the template is the mirror of the other, so half the triangles arrive wound the other
       way round. Orienting every one of them outwards (against its own vertex normals) once, here, is what
       lets the renderer cull back faces from the sign of the screen area of a triangle. */
    for (i = 0; i < f; i++) {
      o = i * 3;
      var a = faces[o], b = faces[o + 1], c = faces[o + 2];
      var ux = x[b] - x[a], uy = y[b] - y[a], uz = z[b] - z[a];
      var wx = x[c] - x[a], wy = y[c] - y[a], wz = z[c] - z[a];
      if ((uy * wz - uz * wy) * (nx[a] + nx[b] + nx[c]) +
        (uz * wx - ux * wz) * (ny[a] + ny[b] + ny[c]) +
        (ux * wy - uy * wx) * (nz[a] + nz[b] + nz[c]) < 0) { faces[o + 1] = c; faces[o + 2] = b; }
    }
    return {
      n: n, faceCount: f, x: x, y: y, z: z, nx: nx, ny: ny, nz: nz,
      curv: curv, zone: zone, faces: faces, sources: sources
    };
  }
  var CORTEX = decodeCortex(DATA);

  /* MNI millimetres to model units and back. */
  function mniToModel(mx, my, mz, out) {
    out[0] = (mx - DATA.centre[0]) / DATA.scale;
    out[1] = (my - DATA.centre[1]) / DATA.scale;
    out[2] = (mz - DATA.centre[2]) / DATA.scale;
    return out;
  }
  function modelToMni(ux, uy, uz, out) {
    out[0] = ux * DATA.scale + DATA.centre[0];
    out[1] = uy * DATA.scale + DATA.centre[1];
    out[2] = uz * DATA.scale + DATA.centre[2];
    return out;
  }

  /* ---- candidate zone ---------------------------------------------------
     The weights come from the data; the figure needs the weighted centroid (where the glow sits) and the
     radius in model units (how wide it spreads). */
  var ZONE = (function () {
    var n = CORTEX.n, count = 0, sx = 0, sy = 0, sz = 0, sw = 0, i;
    for (i = 0; i < n; i++) {
      var w = CORTEX.zone[i];
      if (w <= 0) continue;
      count++;
      sx += CORTEX.x[i] * w; sy += CORTEX.y[i] * w; sz += CORTEX.z[i] * w; sw += w;
    }
    return { count: count, radius: ZONE_MM / DATA.scale, centre: [sx / sw, sy / sw, sz / sw] };
  })();

  /* ---- sources ----------------------------------------------------------
     The 24 network nodes are mesh vertices chosen offline (six of them inside the zone). `inv` is 1 / |p|:
     the radial direction says which side of the cortex a source is on, which is all the visibility test
     needs, and it does not flinch on a vertex whose true normal points into a fold. */
  var SOURCES = (function () {
    var idx = CORTEX.sources, count = idx.length, i;
    var x = new Float32Array(count), y = new Float32Array(count), z = new Float32Array(count);
    var inv = new Float32Array(count), zone = new Float32Array(count), inside = new Uint8Array(count);
    for (i = 0; i < count; i++) {
      var s = idx[i];
      x[i] = CORTEX.x[s]; y[i] = CORTEX.y[s]; z[i] = CORTEX.z[s];
      inv[i] = 1 / (Math.sqrt(x[i] * x[i] + y[i] * y[i] + z[i] * z[i]) || 1);
      zone[i] = CORTEX.zone[s];
      inside[i] = zone[i] > ZONE_ON ? 1 : 0;
    }
    return { count: count, point: idx, x: x, y: y, z: z, inv: inv, zone: zone, inZone: inside };
  })();
  var S = SOURCES.count;

  /* ---- graph ------------------------------------------------------------
     Gaussian kernel of the distance between sources, jittered by a seeded draw per pair (so the matrix is
     symmetric by construction) and multiplied inside the zone, then the strongest EDGE_COUNT pairs are kept. */
  var GRAPH = (function () {
    var rnd = Lab.rng(GRAPH_SEED);
    var W = new Float64Array(S * S), pairs = [], i, j;
    for (i = 0; i < S; i++) {
      for (j = i + 1; j < S; j++) {
        var dx = SOURCES.x[i] - SOURCES.x[j], dy = SOURCES.y[i] - SOURCES.y[j], dz = SOURCES.z[i] - SOURCES.z[j];
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz) / EDGE_SIGMA;
        var w = Math.exp(-d * d) * (EDGE_FLOOR + EDGE_JITTER * rnd());
        if (SOURCES.inZone[i] && SOURCES.inZone[j]) w *= EDGE_ZONE_GAIN;
        W[i * S + j] = w; W[j * S + i] = w;
        pairs.push({ a: i, b: j, w: w });
      }
    }
    pairs.sort(function (p, q) { return q.w - p.w || (p.a - q.a) || (p.b - q.b); });
    var edges = pairs.slice(0, EDGE_COUNT);
    var maxW = edges.length ? edges[0].w : 1;
    var degree = new Int32Array(S);
    for (i = 0; i < edges.length; i++) {
      edges[i].n = edges[i].w / maxW;
      edges[i].zone = SOURCES.inZone[edges[i].a] && SOURCES.inZone[edges[i].b] ? 1 : 0;
      degree[edges[i].a]++; degree[edges[i].b]++;
    }
    return {
      matrix: W, edges: edges, degree: degree, maxWeight: maxW,
      weight: function (a, b) { return a === b ? 0 : W[a * S + b]; }
    };
  })();
  var E = GRAPH.edges.length;

  /* ---- projection -------------------------------------------------------
     R = Rpitch @ Ryaw: yaw about the vertical axis, then the camera elevation. Writes screen x, screen y and
     depth per point, in model units; SMALLER depth is nearer the camera. It is a pure rotation, so the same
     call transforms the normals. Deterministic, no allocation. */
  function project(x, y, z, count, yawDeg, pitchDeg, out) {
    var yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (var i = 0; i < count; i++) {
      var px = x[i], py = y[i], pz = z[i];
      var rx = cy * px - sy * py, ry = sy * px + cy * py;
      var o = i * 3;
      out[o] = rx;
      out[o + 1] = -(sp * ry + cp * pz);
      out[o + 2] = cp * ry - sp * pz;
    }
    return out;
  }

  /* Tone of one face: ambient plus lambert, dimmed inside the sulci and with distance. */
  function shade(lam, curv, zn) {
    var sul = SUL_MIN + SUL_SPAN * Lab.clamp((curv - SUL_LO) / (SUL_HI - SUL_LO), 0, 1);
    return (AMBIENT + (1 - AMBIENT) * Lab.clamp(lam, 0, 1)) * sul *
      (DEPTH_FLOOR + (1 - DEPTH_FLOOR) * Lab.clamp(zn, 0, 1));
  }

  window.__brainModel = {
    DATA: DATA,
    CORTEX: CORTEX,
    ZONE: ZONE,
    ZONE_MNI: ZONE_MNI,
    ZONE_MM: ZONE_MM,
    ZONE_ON: ZONE_ON,
    SOURCES: SOURCES,
    GRAPH: GRAPH,
    EDGE_COUNT: EDGE_COUNT,
    YAW_DEFAULT: YAW_DEFAULT,
    PITCH_DEFAULT: PITCH_DEFAULT,
    LIGHT: LIGHT,
    decodeCortex: decodeCortex,
    mniToModel: mniToModel,
    modelToMni: modelToMni,
    project: project,
    shade: shade
  };

  /* ======================================================================
     Part 2: DOM
     ====================================================================== */
  if (typeof document === 'undefined') return;
  var root = document.getElementById('mini-brain');
  if (!root) return;
  var fig = root.querySelector('.mini-figure');
  var canvas = fig.querySelector('canvas');
  var layer = fig.querySelector('.mini-buttons');
  var readout = document.getElementById('mini-brain-readout');
  var live = document.getElementById('mini-brain-live');
  var str = Lab.strings('brain');

  var DEG_PER_SEC = 9;                 /* idle rotation */
  var DEG_PER_MS = DEG_PER_SEC / 1000;
  var MAX_STEP_MS = 100;
  var KEY_YAW = 10, KEY_PITCH = 6;
  var DRAG_DEG_PER_PX = 0.5;
  var DRAG_THRESHOLD = 3;
  var PITCH_MIN = -25, PITCH_MAX = 55;
  var FIT_X = 0.41, FIT_Y = 0.44;      /* fraction of each half side the cortex may occupy */
  var SCALE_MIN = 10;
  var CACHE_YAW_STEP = 0.5;            /* the cached cortex is redrawn only past this yaw change */

  var TONE_BUCKETS = 24, ZONE_LEVELS = 5;      /* one path per (tone, zone weight) bucket */
  var GROUPS = TONE_BUCKETS * ZONE_LEVELS, CULLED = GROUPS;
  var FACE_SEAM = 0.4;                         /* screen pixels each triangle grows by, to close the seams */
  var WIDTH_REF = 320;                         /* figure width the line and node sizes are quoted at */
  var ZONE_MIN = 0.02;                         /* face zone weight under which the face is plain cortex */
  var ZONE_MIX = 0.9;                         /* how far a full-weight face travels towards the accent */
  /* How far the tone travels from the surface token towards the ink one. The floor keeps the unlit side of
     the cortex visible instead of dissolving into the page, the ceiling keeps the lit side off pure ink. */
  var INK_FLOOR = 0.16, INK_CEIL = 0.88;
  var ZONE_U_FLOOR = 0.5;                      /* the accent never washes out where the zone is in shadow */

  var GLOW_SPRITE = 128, GLOW_A = 0.4, GLOW_SPREAD = 1.55, GLOW_GAIN = 1.6;

  var EDGE_BACK_A = 0.2, EDGE_FRONT_A = 0.75, EDGE_A_FLOOR = 0.45;
  var EDGE_W0 = 0.55, EDGE_W1 = 1.05, EDGE_HI_W = 0.7;
  var EDGE_LIFT = 1.16;                        /* the control point is pushed out from the figure centre */
  var DIM = 0.16;                              /* alpha factor of what the highlight does not touch */

  var NODE_R = 2.9, NODE_R_PER_DEGREE = 0.12, NODE_HI_GROW = 1.6, NODE_STROKE = 1.4;
  var NODE_A = 0.96, NODE_A_DIM = 0.4;
  var SOURCE_FACING = 0.05;                    /* below this the source is on the far side */
  var LABEL_PX = 10.5, LABEL_GAP = 5, LABEL_HALO_W = 3, LABEL_HALO_A = 0.9, LABEL_FLIP = 78;
  var BUTTON_MOVE_PX = 0.75;

  var t = Lab.tokens();
  var reduce = Lab.reduceMotion;
  var P = CORTEX.n, F = CORTEX.faceCount;
  var FACES = CORTEX.faces, CURV = CORTEX.curv, ZW = CORTEX.zone;

  /* Per-frame and per-cache buffers, allocated once. */
  var vPos = new Float32Array(P * 3), vNrm = new Float32Array(P * 3);
  var vLam = new Float32Array(P), vsx = new Float32Array(P), vsy = new Float32Array(P);
  var faceOf = new Uint8Array(F), order = new Int32Array(F);
  var counts = new Int32Array(GROUPS + 2), starts = new Int32Array(GROUPS + 2);
  var groupDepth = new Float64Array(GROUPS), groupOrder = new Int32Array(GROUPS);
  var groupFill = new Array(GROUPS);
  var vSrc = new Float32Array(S * 3), srcFacing = new Float32Array(S);
  var srcX = new Float32Array(S), srcY = new Float32Array(S);
  var srcShown = new Uint8Array(S), btnShown = new Uint8Array(S);
  var btnX = new Float32Array(S), btnY = new Float32Array(S);
  var neighbour = new Uint8Array(S);
  var edgeBack = new Uint8Array(E);
  var zoneCx = new Float32Array([ZONE.centre[0]]), zoneCy = new Float32Array([ZONE.centre[1]]);
  var zoneCz = new Float32Array([ZONE.centre[2]]), zoneProj = new Float32Array(3);
  var zoneInv = 1 / (Math.sqrt(ZONE.centre[0] * ZONE.centre[0] + ZONE.centre[1] * ZONE.centre[1] +
    ZONE.centre[2] * ZONE.centre[2]) || 1);
  var glow = document.createElement('canvas');
  glow.width = GLOW_SPRITE; glow.height = GLOW_SPRITE;
  var cortexLayer = document.createElement('canvas');

  var cw = 0, ch = 0, dpr = 1, ctx = null, lctx = null, cx = 0, cy = 0, scale = 1;
  var yaw = YAW_DEFAULT, pitch = PITCH_DEFAULT;
  var cacheYaw = NaN, cachePitch = NaN, cacheDirty = true;
  var hi = -1, activeHi = -1, hoverIdx = -1, focusIdx = -1, pinned = -1;
  var buttons = [];
  var frames = 0, costSum = 0, costMax = 0, cortexMs = 0;

  /* ---- colours ---- */
  function mix(a, b, u) {
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }
  function css(c) {
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }
  /* The tone v says how far a face travels from the surface towards the ink, which reads as a light cortex on
     a dark ground in the dark theme and as a dark one on a light ground in the light theme from the same
     formula. A face inside the zone is mixed towards the accent in proportion to its zone weight. */
  function buildFills() {
    var surface = Lab.rgb(t.surface), ink = Lab.rgb(t.ink), accent = Lab.rgb(t.accent);
    for (var lvl = 0; lvl < ZONE_LEVELS; lvl++) {
      var z = lvl === 0 ? 0 : (lvl - 0.5) / (ZONE_LEVELS - 1);
      for (var b = 0; b < TONE_BUCKETS; b++) {
        var v = (b + 0.5) / TONE_BUCKETS;
        var u = INK_FLOOR + (INK_CEIL - INK_FLOOR) * v;
        var base = mix(surface, ink, u);
        var tint = mix(surface, accent, Math.max(u, ZONE_U_FLOOR));
        groupFill[lvl * TONE_BUCKETS + b] = css(z > 0 ? mix(base, tint, ZONE_MIX * z) : base);
      }
    }
    var g = glow.getContext('2d'), h = GLOW_SPRITE / 2;
    g.clearRect(0, 0, GLOW_SPRITE, GLOW_SPRITE);
    var grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, Lab.rgba(t.accent, GLOW_A));
    grad.addColorStop(0.5, Lab.rgba(t.accent, GLOW_A * 0.4));
    grad.addColorStop(1, Lab.rgba(t.accent, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_SPRITE, GLOW_SPRITE);
  }
  buildFills();

  /* ---- source names and buttons ---- */
  var NAMES = [];
  for (var i = 0; i < S; i++) NAMES.push(Lab.format(str('source', 'Source {n}'), { n: i + 1 }));
  function sourceIndex(name) {
    var s = String(name == null ? '' : name).trim();
    var m = s.match(/(\d+)\s*$/);
    if (m) {
      var k = parseInt(m[1], 10) - 1;
      return k >= 0 && k < S ? k : -1;
    }
    for (var j = 0; j < S; j++) if (NAMES[j].toLowerCase() === s.toLowerCase()) return j;
    return -1;
  }
  var selectLabel = str('select');
  for (i = 0; i < S; i++) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', Lab.format(selectLabel, { name: NAMES[i] }));
    b.setAttribute('aria-pressed', 'false');
    b.hidden = true;
    b.disabled = true;
    b.dataset.index = String(i);
    b.addEventListener('pointerenter', onEnter);
    b.addEventListener('focus', onEnter);
    b.addEventListener('pointerleave', onLeave);
    b.addEventListener('blur', onLeave);
    b.addEventListener('click', onClick);
    layer.appendChild(b);
    buttons.push(b);
  }
  layer.addEventListener('keydown', onKey);

  /* Three sources of highlight, as in the stage: hover and focus are transient, a click pins. The drawn
     highlight is hover, else focus, else pinned; aria-pressed follows the pinned one only. Keyboard focus
     also holds the idle rotation, so the source stays where the reader found it. */
  var keyboardFocus = false;
  function onEnter(e) {
    var idx = +e.currentTarget.dataset.index;
    if (e.type === 'focus') {
      focusIdx = idx;
      keyboardFocus = focusVisible(e.currentTarget);
    } else hoverIdx = idx;
    resolveHighlight();
  }
  function onLeave(e) {
    var idx = +e.currentTarget.dataset.index;
    if (e.type === 'blur') { if (focusIdx === idx) { focusIdx = -1; keyboardFocus = false; } }
    else if (hoverIdx === idx) hoverIdx = -1;
    resolveHighlight();
  }
  function focusVisible(el) {
    try { return el.matches(':focus-visible'); } catch (err) { return true; }
  }
  function onClick(e) {
    if (suppressClick) return;
    var idx = +e.currentTarget.dataset.index;
    var next = pinned === idx ? -1 : idx;
    setPinned(next);
    if (live) {
      live.textContent = next >= 0
        ? Lab.format(str('pinned'), { name: NAMES[idx] }) + ' ' + describe(idx)
        : Lab.format(str('released'), { name: NAMES[idx] });
    }
  }
  function onKey(e) {
    var k = e.key;
    if (k === 'ArrowLeft') yaw -= KEY_YAW;
    else if (k === 'ArrowRight') yaw += KEY_YAW;
    else if (k === 'ArrowUp') pitch = Lab.clamp(pitch + KEY_PITCH, PITCH_MIN, PITCH_MAX);
    else if (k === 'ArrowDown') pitch = Lab.clamp(pitch - KEY_PITCH, PITCH_MIN, PITCH_MAX);
    else return;
    e.preventDefault();
    requestDraw();
  }
  function setPinned(idx) {
    if (idx === pinned) return;
    pinned = idx;
    for (var k = 0; k < S; k++) buttons[k].setAttribute('aria-pressed', k === pinned ? 'true' : 'false');
    resolveHighlight();
  }
  function resolveHighlight() {
    setHighlight(hoverIdx >= 0 ? hoverIdx : focusIdx >= 0 ? focusIdx : pinned);
  }
  function setHighlight(idx) {
    if (idx === hi) return;
    hi = idx;
    var k;
    for (k = 0; k < S; k++) neighbour[k] = 0;
    if (hi >= 0) {
      for (k = 0; k < E; k++) {
        var e = GRAPH.edges[k];
        if (e.a === hi) neighbour[e.b] = 1; else if (e.b === hi) neighbour[e.a] = 1;
      }
    }
    if (readout) readout.textContent = hi >= 0 ? describe(hi) : str('idle', '');
    requestDraw();
  }
  function describe(k) {
    var n = GRAPH.degree[k];
    return Lab.format(str(SOURCES.inZone[k] ? 'node_zone' : 'node'), {
      name: NAMES[k], n: n, links: str(n === 1 ? 'link_one' : 'link_many', '')
    });
  }

  /* Pointer drag rotates; a press that moves less than the threshold falls through to the button click.
     The click that follows a drag is swallowed: the flag lives until the event queue has drained. */
  var dragging = false, dragged = false, suppressClick = false, dragX = 0, dragY = 0, dragYaw = 0, dragPitch = 0;
  fig.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    dragging = true; dragged = false;
    dragX = e.clientX; dragY = e.clientY; dragYaw = yaw; dragPitch = pitch;
    fig.classList.add('is-dragging');
  });
  fig.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - dragX, dy = e.clientY - dragY;
    if (!dragged && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    if (!dragged) { dragged = true; if (fig.setPointerCapture) fig.setPointerCapture(e.pointerId); }
    yaw = dragYaw + dx * DRAG_DEG_PER_PX;
    pitch = Lab.clamp(dragPitch - dy * DRAG_DEG_PER_PX, PITCH_MIN, PITCH_MAX);
    requestDraw();
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    fig.classList.remove('is-dragging');
    if (dragged && fig.releasePointerCapture && fig.hasPointerCapture && fig.hasPointerCapture(e.pointerId)) fig.releasePointerCapture(e.pointerId);
    if (dragged && e.type === 'pointerup') {
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
    }
    dragged = false;
    requestDraw();
  }
  fig.addEventListener('pointerup', endDrag);
  fig.addEventListener('pointercancel', endDrag);

  /* ---- layout ----
     Half-extent of the projection over EVERY yaw, so the figure keeps one size while it turns instead of
     breathing: the screen abscissa of a vertex sweeps its distance from the vertical axis, and its ordinate
     sweeps sin(pitch) times that distance plus cos(pitch) times its height. The two axes are fitted
     separately because the cell is about twice as wide as it is tall and a square fit wastes half of it. */
  var rho = (function () {
    var r = new Float32Array(P), m = 0;
    for (var i = 0; i < P; i++) {
      r[i] = Math.sqrt(CORTEX.x[i] * CORTEX.x[i] + CORTEX.y[i] * CORTEX.y[i]);
      if (r[i] > m) m = r[i];
    }
    return { r: r, max: m };
  })();
  function reachY() {
    var sp = Math.abs(Math.sin(pitch * Math.PI / 180)), cp = Math.abs(Math.cos(pitch * Math.PI / 180));
    var m = 0;
    for (var i = 0; i < P; i++) {
      var v = sp * rho.r[i] + cp * Math.abs(CORTEX.z[i]);
      if (v > m) m = v;
    }
    return m || 1;
  }
  var fitPitch = NaN, fitReach = 1;
  function fit() {
    if (pitch !== fitPitch) { fitReach = reachY(); fitPitch = pitch; }
    scale = Math.max(SCALE_MIN, Math.min(cw * FIT_X / rho.max, ch * FIT_Y / fitReach));
  }

  function layout() {
    var f = Lab.fitCanvas(canvas);
    cw = f.w; ch = f.h; dpr = f.dpr; ctx = f.ctx;
    cx = cw / 2; cy = ch / 2;
    var bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
    if (cortexLayer.width !== bw || cortexLayer.height !== bh) {
      cortexLayer.width = bw; cortexLayer.height = bh;
    }
    lctx = cortexLayer.getContext('2d');
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fit();
    cacheDirty = true;
    draw();
  }

  /* ---- the cached cortex ------------------------------------------------
     One offscreen render per half degree of yaw. Each triangle takes the mean of its three vertices for the
     light, the curvature, the zone weight and the depth, so the surface reads as facets rather than as a
     gradient; the faces are then bucketed by tone and each bucket is filled as one path, which is what keeps
     2560 triangles cheap. */
  function renderCortex() {
    var t0 = Lab.now(), i, o, g;
    fit();
    project(CORTEX.x, CORTEX.y, CORTEX.z, P, yaw, pitch, vPos);
    project(CORTEX.nx, CORTEX.ny, CORTEX.nz, P, yaw, pitch, vNrm);
    var lx = LIGHT[0], ly = LIGHT[1], lz = LIGHT[2];
    var dmin = Infinity, dmax = -Infinity;
    for (i = 0; i < P; i++) {
      o = i * 3;
      var d = vPos[o + 2];
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
      vsx[i] = cx + vPos[o] * scale;
      vsy[i] = cy + vPos[o + 1] * scale;
      /* vNrm holds (right, -up, depth): -depth is the component facing the camera. */
      vLam[i] = Lab.clamp(vNrm[o] * lx + vNrm[o + 2] * ly - vNrm[o + 1] * lz, 0, 1);
    }
    var dspan = (dmax - dmin) || 1;
    for (i = 0; i <= GROUPS + 1; i++) counts[i] = 0;
    for (i = 0; i < GROUPS; i++) groupDepth[i] = 0;
    for (i = 0; i < F; i++) {
      var k = i * 3, a = FACES[k], b = FACES[k + 1], c = FACES[k + 2];
      /* Back faces go by the sign of the screen area of the triangle, not by its vertex normals: those come
         from the folded full-resolution surface and differ from the plane of a coarse triangle by some 30
         degrees, which culls one visible face in six and opens holes right through the cortex. */
      var ax = vsx[a], ay = vsy[a];
      if ((vsx[b] - ax) * (vsy[c] - ay) - (vsy[b] - ay) * (vsx[c] - ax) >= 0) {
        faceOf[i] = CULLED; counts[CULLED + 1]++; continue;
      }
      var depth = (vPos[a * 3 + 2] + vPos[b * 3 + 2] + vPos[c * 3 + 2]) / 3;
      var v = shade((vLam[a] + vLam[b] + vLam[c]) / 3, (CURV[a] + CURV[b] + CURV[c]) / 3,
        (dmax - depth) / dspan);
      var bkt = Math.floor(v * TONE_BUCKETS);
      if (bkt >= TONE_BUCKETS) bkt = TONE_BUCKETS - 1;
      if (bkt < 0) bkt = 0;
      var zw = (ZW[a] + ZW[b] + ZW[c]) / 3;
      var lvl = zw > ZONE_MIN ? 1 + Math.floor(zw * (ZONE_LEVELS - 1) * 0.999) : 0;
      g = lvl * TONE_BUCKETS + bkt;
      faceOf[i] = g;
      counts[g + 1]++;
      groupDepth[g] += depth;
    }
    starts[0] = 0;
    for (i = 1; i <= GROUPS + 1; i++) starts[i] = starts[i - 1] + counts[i];
    for (i = 0; i <= GROUPS + 1; i++) counts[i] = starts[i];
    for (i = 0; i < F; i++) order[counts[faceOf[i]]++] = i;
    /* Back to front by the mean depth of each bucket: the faces are opaque, so this is the painter order.
       Insertion sort over some 100 buckets that are almost sorted from one render to the next. */
    var used = 0;
    for (i = 0; i < GROUPS; i++) {
      var cnt = starts[i + 1] - starts[i];
      if (!cnt) continue;
      groupDepth[i] /= cnt;
      groupOrder[used++] = i;
    }
    for (i = 1; i < used; i++) {
      var key = groupOrder[i], j = i - 1;
      while (j >= 0 && groupDepth[groupOrder[j]] < groupDepth[key]) { groupOrder[j + 1] = groupOrder[j]; j--; }
      groupOrder[j + 1] = key;
    }
    lctx.clearRect(0, 0, cw, ch);
    for (i = 0; i < used; i++) fillGroup(groupOrder[i]);
    /* The tinted faces go back on top of the glow so the zone keeps its facets. That second pass ignores the
       painter order, so it runs only while the patch faces the camera: from behind it would paint the far
       side of the zone over the near cortex. */
    if (drawGlow()) {
      for (i = 0; i < used; i++) if (groupOrder[i] >= TONE_BUCKETS) fillGroup(groupOrder[i]);
    }
    cacheYaw = yaw; cachePitch = pitch; cacheDirty = false;
    cortexMs = Lab.now() - t0;
  }

  /* Adjacent triangles of two different buckets are two different fills, so the shared edge is antialiased
     twice and the ground shows through as a hairline. Each triangle is therefore grown by FACE_SEAM pixels
     away from its own centroid, which overlaps its neighbours and closes the seam. Stroking the path in its
     own fill colour reads the same, but the canvas then builds a stroke outline for every triangle, which
     measured three times the cost of the whole render. */
  function fillGroup(g) {
    var from = starts[g], to = starts[g + 1], p, k, v, x, y, mx, my, dx, dy, s;
    lctx.fillStyle = groupFill[g];
    lctx.beginPath();
    for (p = from; p < to; p++) {
      k = order[p] * 3;
      mx = (vsx[FACES[k]] + vsx[FACES[k + 1]] + vsx[FACES[k + 2]]) / 3;
      my = (vsy[FACES[k]] + vsy[FACES[k + 1]] + vsy[FACES[k + 2]]) / 3;
      for (v = 0; v < 3; v++) {
        x = vsx[FACES[k + v]]; y = vsy[FACES[k + v]];
        dx = x - mx; dy = y - my;
        s = Math.sqrt(dx * dx + dy * dy);
        s = s > 0.01 ? (s + FACE_SEAM) / s : 1;
        if (v === 0) lctx.moveTo(mx + dx * s, my + dy * s);
        else lctx.lineTo(mx + dx * s, my + dy * s);
      }
      lctx.closePath();
    }
    lctx.fill();
  }

  /* The patch fades out as the zone turns away, so it reads as a piece of cortex and not as a sticker.
     Returns whether the zone is on the near side at all. */
  function drawGlow() {
    project(zoneCx, zoneCy, zoneCz, 1, yaw, pitch, zoneProj);
    var facing = -zoneProj[2] * zoneInv;
    if (facing <= 0) return false;
    var a = Lab.clamp(facing * GLOW_GAIN, 0, 1);
    var r = ZONE.radius * scale * GLOW_SPREAD;
    var gx = cx + zoneProj[0] * scale, gy = cy + zoneProj[1] * scale;
    lctx.globalAlpha = a;
    lctx.drawImage(glow, gx - r, gy - r, 2 * r, 2 * r);
    lctx.globalAlpha = 1;
    return true;
  }

  /* ---- the network ---- */
  function drawEdges(back) {
    var k, e, ax, ay, bx, by, mx, my;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (k = 0; k < E; k++) {
      if (!!edgeBack[k] !== back) continue;
      e = GRAPH.edges[k];
      var touches = activeHi >= 0 && (e.a === activeHi || e.b === activeHi);
      var alpha = (back ? EDGE_BACK_A : EDGE_FRONT_A) * (EDGE_A_FLOOR + (1 - EDGE_A_FLOOR) * e.n);
      if (activeHi >= 0) alpha = touches ? (back ? EDGE_BACK_A * 2 : 1) : alpha * DIM;
      ax = srcX[e.a]; ay = srcY[e.a]; bx = srcX[e.b]; by = srcY[e.b];
      mx = cx + ((ax + bx) / 2 - cx) * EDGE_LIFT;
      my = cy + ((ay + by) / 2 - cy) * EDGE_LIFT;
      ctx.strokeStyle = Lab.rgba(t.accent, alpha);
      ctx.lineWidth = (EDGE_W0 + EDGE_W1 * e.n) * widthScale() + (touches ? EDGE_HI_W : 0);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.stroke();
    }
  }
  function widthScale() { return Lab.clamp(cw / WIDTH_REF, 0.85, 1.5); }

  function drawSources() {
    var k, ws = widthScale();
    for (k = 0; k < S; k++) {
      if (!srcShown[k]) continue;
      var isHi = k === activeHi;
      var dim = activeHi >= 0 && !isHi && !neighbour[k];
      var r = (NODE_R + GRAPH.degree[k] * NODE_R_PER_DEGREE) * ws + (isHi ? NODE_HI_GROW : 0);
      ctx.beginPath();
      ctx.arc(srcX[k], srcY[k], r, 0, Math.PI * 2);
      ctx.fillStyle = Lab.rgba(SOURCES.inZone[k] || isHi ? t.accent : t.ink, dim ? NODE_A_DIM : NODE_A);
      ctx.fill();
      ctx.lineWidth = NODE_STROKE;
      ctx.strokeStyle = Lab.rgba(t.surface, dim ? 0.5 : 1);
      ctx.stroke();
    }
    /* Only the highlighted source is named: at this size any second label would collide with the network. */
    if (activeHi < 0) return;
    var rr = (NODE_R + GRAPH.degree[activeHi] * NODE_R_PER_DEGREE) * ws + NODE_HI_GROW;
    ctx.font = Lab.font(LABEL_PX, t, 500);
    ctx.textBaseline = 'middle';
    ctx.textAlign = srcX[activeHi] > cw - LABEL_FLIP ? 'right' : 'left';
    var lx = srcX[activeHi] + (ctx.textAlign === 'right' ? -(rr + LABEL_GAP) : rr + LABEL_GAP);
    var ly = srcY[activeHi] - rr * 0.4;
    ctx.lineJoin = 'round';
    ctx.lineWidth = LABEL_HALO_W;
    ctx.strokeStyle = Lab.rgba(t.surface, LABEL_HALO_A);
    ctx.strokeText(NAMES[activeHi], lx, ly);
    ctx.fillStyle = t.ink;
    ctx.fillText(NAMES[activeHi], lx, ly);
  }

  /* A focused button stays even when its source turns away, so keyboard rotation never drops the focus. */
  function placeButtons() {
    for (var k = 0; k < S; k++) {
      var show = srcShown[k] || k === focusIdx ? 1 : 0;
      var bt = buttons[k];
      if (show !== btnShown[k]) {
        btnShown[k] = show;
        bt.hidden = !show;
        bt.disabled = !show;
      }
      if (!show) continue;
      if (Math.abs(srcX[k] - btnX[k]) >= BUTTON_MOVE_PX || Math.abs(srcY[k] - btnY[k]) >= BUTTON_MOVE_PX) {
        btnX[k] = srcX[k]; btnY[k] = srcY[k];
        bt.style.transform = 'translate(' + srcX[k].toFixed(1) + 'px,' + srcY[k].toFixed(1) + 'px)';
      }
    }
  }

  function draw() {
    if (!ctx) return;
    var t0 = Lab.now(), k, o;
    if (cacheDirty || pitch !== cachePitch || Math.abs(yaw - cacheYaw) > CACHE_YAW_STEP) renderCortex();
    project(SOURCES.x, SOURCES.y, SOURCES.z, S, yaw, pitch, vSrc);
    for (k = 0; k < S; k++) {
      o = k * 3;
      srcX[k] = cx + vSrc[o] * scale; srcY[k] = cy + vSrc[o + 1] * scale;
      srcFacing[k] = -vSrc[o + 2] * SOURCES.inv[k];
      srcShown[k] = srcFacing[k] >= SOURCE_FACING ? 1 : 0;
    }
    /* A highlight whose source has turned to the far side stops dimming the rest: otherwise pinning a source
       and letting the cortex turn would leave the whole network faded with nothing to look at. */
    activeHi = hi >= 0 && srcShown[hi] ? hi : -1;
    for (k = 0; k < E; k++) {
      var e = GRAPH.edges[k];
      edgeBack[k] = (vSrc[e.a * 3 + 2] + vSrc[e.b * 3 + 2]) > 0 ? 1 : 0;
    }
    ctx.clearRect(0, 0, cw, ch);
    drawEdges(true);
    ctx.drawImage(cortexLayer, 0, 0, cw, ch);
    drawEdges(false);
    drawSources();
    placeButtons();
    var cost = Lab.now() - t0;
    frames++; costSum += cost;
    if (cost > costMax) costMax = cost;
  }

  /* ---- loop: the idle rotation runs while the figure is visible; hovering, focusing or dragging holds it.
     Reduced motion has no loop, every interaction redraws once. ---- */
  var running = false, raf = 0, lastTs = -1, pendingDraw = 0;
  function autoRotating() {
    return !reduce && hoverIdx < 0 && !keyboardFocus && !dragging;
  }
  function frame(ts) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (lastTs < 0) lastTs = ts;
    var dt = Math.min(MAX_STEP_MS, ts - lastTs);
    lastTs = ts;
    if (autoRotating()) yaw = (yaw + dt * DEG_PER_MS) % 360;
    draw();
  }
  function start() {
    if (running) return;
    running = true; lastTs = -1;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }
  function requestDraw() {
    if (running || pendingDraw) return;
    pendingDraw = requestAnimationFrame(function () { pendingDraw = 0; draw(); });
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(fig);
  else window.addEventListener('resize', layout);
  Lab.onTheme(function () { t = Lab.tokens(); buildFills(); cacheDirty = true; requestDraw(); });
  Lab.fontsReady(requestDraw);

  var forcedYaw = parseFloat(Lab.param('yaw'));
  if (isFinite(forcedYaw)) yaw = ((forcedYaw % 360) + 360) % 360;
  if (readout) readout.textContent = str('idle', '');
  layout();
  var forcedHi = Lab.param('highlight');
  if (forcedHi) setPinned(sourceIndex(forcedHi));
  if (!reduce) Lab.whenVisible(fig, start, stop);

  /* Scripted checks (see README). */
  window.__brain = {
    yaw: function () { return yaw; },
    pitch: function () { return pitch; },
    setYaw: function (deg) { yaw = ((deg % 360) + 360) % 360; draw(); return yaw; },
    setPitch: function (deg) { pitch = Lab.clamp(deg, PITCH_MIN, PITCH_MAX); draw(); return pitch; },
    highlight: function (name) { setPinned(sourceIndex(name)); return hi; },
    names: function () { return NAMES.slice(); },
    current: function () { return hi; },
    pinned: function () { return pinned; },
    readout: function () { return readout ? readout.textContent : ''; },
    visible: function () { var out = [], k; for (k = 0; k < S; k++) if (srcShown[k]) out.push(NAMES[k]); return out; },
    running: function () { return running; },
    autoRotating: autoRotating,
    cortexMs: function () { cacheDirty = true; draw(); return cortexMs; },
    frameMs: function () {
      var out = { frames: frames, avg: frames ? costSum / frames : 0, max: costMax };
      frames = 0; costSum = 0; costMax = 0;
      return out;
    }
  };
})();
