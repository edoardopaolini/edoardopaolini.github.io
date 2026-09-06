/* Brain: the "Brain connectivity" cell (#mini-brain). A procedural three-dimensional brain prototype, drawn as
   a depth-shaded point cloud, carries the 19 electrodes of the 10-20 montage on its surface and the seeded
   toy connectivity graph as arcs lifted above it; the left temporo-parietal cluster glows as the candidate
   zone. The brain turns slowly by itself, the pointer or the arrow keys turn it by hand, and one real button
   per visible electrode sits over the canvas so the figure is keyboard and screen-reader operable.
   Part 1 is a pure model (geometry, montage placement, graph, projection) exported on window.__brainModel for
   tests/brain.test.js, which runs it in a bare engine after lab.js. Part 2 attaches to the DOM and exits when
   the cell is missing. Debug hooks: ?highlight=NAME pins an electrode, ?yaw=DEG sets the initial rotation. */
(function () {
  'use strict';

  var Lab = window.Lab;
  var MONTAGE = Lab.MONTAGE;
  var N = MONTAGE.length;

  /* ======================================================================
     Part 1: model (no DOM access)
     ====================================================================== */

  /* Body frame: x towards the right hemisphere, y anterior, z up. Unit: about the half-length of the brain.
     Superellipsoid semi-axes and exponent: a brain is about 1.2 times longer than wide and flatter underneath;
     an exponent above 2 squares off the flanks the way real hemispheres do. */
  var HALF_WIDTH = 0.72, HALF_LENGTH = 0.9, HALF_HEIGHT_UP = 0.6, HALF_HEIGHT_DOWN = 0.42, EXPONENT = 2.4;
  var FRONTAL_TAPER = 0.16;    /* the frontal pole is narrower than the parietal region */
  var POLE_SLOPE = 0.1;        /* the top falls away towards the frontal and occipital poles */
  var TEMPORAL_BULGE = 0.6;    /* lateral lobes hanging below the widest part, front half */
  var TEMPORAL_Y = 0.1, TEMPORAL_SPREAD = 0.5;
  var GROOVE_DEPTH = 0.07, GROOVE_SIGMA = 0.14;   /* the medial fissure dips the top of each hemisphere */
  var FISSURE_HALF = 0.035;    /* half width of the medial gap between the hemispheres */
  var FISSURE_FLOOR = -0.15;   /* the gap only opens above this height: the base stays whole */
  var POINT_COUNT = 1400, POINT_SEED = 20260905;
  var GYRI_AMP = 0.045, GYRI_WAVES = 7, GYRI_FREQ_MIN = 7, GYRI_FREQ_MAX = 13;
  var FOLD_AMP = 0.012, FOLD_WAVES = 5, FOLD_FREQ_MIN = 16, FOLD_FREQ_MAX = 26;
  var NORMAL_EPS = 1e-3;
  var ELEVATION_RING = 10;     /* degrees above the widest part for the electrodes at montage radius 1 */
  var CLUSTER_NAMES = ['T3', 'T5', 'C3', 'P3', 'F7'];
  var ZONE_PAD = 0.16;         /* montage units beyond the cluster hull that still belong to the candidate zone */
  var YAW_FRONT = 90;          /* body yaw at which the left hemisphere faces the viewer (yaw 0 of the figure) */
  var PITCH = 22;              /* default camera elevation, degrees */
  var CAMERA_DISTANCE = 5;     /* body units, for the weak perspective */
  var EDGE_SEGMENTS = 12;
  var LIFT_BASE = 0.03, LIFT_PER_LENGTH = 0.09;
  var GRAPH_SEED = 20260904;   /* kept from the earlier 2D scalp figure, so the toy graph is unchanged */

  /* Two fixed sums of plane waves with seeded directions and phases, in [-1, 1]: a low-frequency one that
     displaces the surface (the broad relief of the gyri) and a finer one that shades the point cloud and
     ripples the silhouette (the folds). */
  function makeWaves(seed, count, fMin, fMax) {
    var r = Lab.rng(seed), waves = [];
    for (var k = 0; k < count; k++) {
      var z = 2 * r() - 1, ph = 2 * Math.PI * r(), rr = Math.sqrt(1 - z * z);
      var f = fMin + (fMax - fMin) * r();
      waves.push({ kx: rr * Math.cos(ph) * f, ky: rr * Math.sin(ph) * f, kz: z * f, phase: 2 * Math.PI * r() });
    }
    return waves;
  }
  var gyriWaves = makeWaves(POINT_SEED + 1, GYRI_WAVES, GYRI_FREQ_MIN, GYRI_FREQ_MAX);
  var foldWaves = makeWaves(POINT_SEED + 2, FOLD_WAVES, FOLD_FREQ_MIN, FOLD_FREQ_MAX);
  function waveSum(waves, x, y, z) {
    var s = 0;
    for (var k = 0; k < waves.length; k++) {
      var w = waves[k];
      s += Math.sin(w.kx * x + w.ky * y + w.kz * z + w.phase);
    }
    return s / waves.length;
  }

  /* Radius of the smooth body along a unit direction: a superellipsoid with a flatter lower half, a frontal
     taper, a top that slopes towards both poles, temporal lobes hanging below the flanks of the front half
     and a groove along the midline. Star-shaped about the origin, so every direction meets it exactly once. */
  function shapeRadius(dx, dy, dz) {
    var a = HALF_WIDTH * (1 - FRONTAL_TAPER * (dy > 0 ? dy : 0));
    var c;
    if (dz >= 0) {
      c = HALF_HEIGHT_UP * (1 - POLE_SLOPE * dy * dy);
    } else {
      var t = (dy - TEMPORAL_Y) / TEMPORAL_SPREAD;
      c = HALF_HEIGHT_DOWN * (1 + TEMPORAL_BULGE * dx * dx * Math.exp(-t * t));
    }
    var s = Math.pow(Math.abs(dx) / a, EXPONENT) + Math.pow(Math.abs(dy) / HALF_LENGTH, EXPONENT) +
      Math.pow(Math.abs(dz) / c, EXPONENT);
    var r = Math.pow(s, -1 / EXPONENT);
    if (dz > 0) {
      var g = dx / GROOVE_SIGMA;
      r *= 1 - GROOVE_DEPTH * dz * Math.exp(-g * g);
    }
    return r;
  }
  /* Radius of the displaced surface: both noises are sampled at the smooth surface point. */
  function surfaceRadius(dx, dy, dz) {
    var r0 = shapeRadius(dx, dy, dz);
    var x = r0 * dx, y = r0 * dy, z = r0 * dz;
    return r0 * (1 + GYRI_AMP * waveSum(gyriWaves, x, y, z) + FOLD_AMP * waveSum(foldWaves, x, y, z));
  }
  /* Shade of the surface along a direction, 0 in the folds to 1 on the crests. */
  function surfaceShade(dx, dy, dz) {
    var r0 = shapeRadius(dx, dy, dz);
    return 0.5 + 0.5 * waveSum(foldWaves, r0 * dx, r0 * dy, r0 * dz);
  }
  function surfacePoint(dx, dy, dz, out, o) {
    var r = surfaceRadius(dx, dy, dz);
    out[o] = r * dx; out[o + 1] = r * dy; out[o + 2] = r * dz;
    return out;
  }

  /* Outward unit normal by central differences along two tangents of the direction sphere. */
  var nScratch = new Float64Array(12);
  function surfaceNormal(dx, dy, dz, out, o) {
    var ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    var ex = ax <= ay && ax <= az ? 1 : 0, ey = !ex && ay <= az ? 1 : 0, ez = !ex && !ey ? 1 : 0;
    var ux = dy * ez - dz * ey, uy = dz * ex - dx * ez, uz = dx * ey - dy * ex;
    var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= ul; uy /= ul; uz /= ul;
    var vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    var s = nScratch;
    surfaceDir(dx + NORMAL_EPS * ux, dy + NORMAL_EPS * uy, dz + NORMAL_EPS * uz, s, 0);
    surfaceDir(dx - NORMAL_EPS * ux, dy - NORMAL_EPS * uy, dz - NORMAL_EPS * uz, s, 3);
    surfaceDir(dx + NORMAL_EPS * vx, dy + NORMAL_EPS * vy, dz + NORMAL_EPS * vz, s, 6);
    surfaceDir(dx - NORMAL_EPS * vx, dy - NORMAL_EPS * vy, dz - NORMAL_EPS * vz, s, 9);
    var tux = s[0] - s[3], tuy = s[1] - s[4], tuz = s[2] - s[5];
    var tvx = s[6] - s[9], tvy = s[7] - s[10], tvz = s[8] - s[11];
    var nx = tuy * tvz - tuz * tvy, ny = tuz * tvx - tux * tvz, nz = tux * tvy - tuy * tvx;
    var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    out[o] = nx; out[o + 1] = ny; out[o + 2] = nz;
    return out;
  }
  /* Surface point along a direction that is not yet normalised. */
  function surfaceDir(x, y, z, out, o) {
    var l = Math.sqrt(x * x + y * y + z * z);
    return surfacePoint(x / l, y / l, z / l, out, o);
  }

  /* Montage (unit circle, nose up) to a direction on the body: azimuth from the montage angle, elevation
     linear in the montage radius, from the vertex (radius 0) down to ELEVATION_RING degrees above the
     widest part (radius 1). The inverse is used to find which surface points lie under the cluster. */
  function montageToDirection(mx, my, out, o) {
    var rho = Math.sqrt(mx * mx + my * my);
    if (rho > 1) rho = 1;
    var el = (90 - (90 - ELEVATION_RING) * rho) * Math.PI / 180;
    var az = Math.atan2(mx, my);
    var ce = Math.cos(el);
    out[o] = ce * Math.sin(az); out[o + 1] = ce * Math.cos(az); out[o + 2] = Math.sin(el);
    return out;
  }
  function directionToMontage(dx, dy, dz, out) {
    var el = Math.asin(Lab.clamp(dz, -1, 1)) * 180 / Math.PI;
    var rho = (90 - el) / (90 - ELEVATION_RING);
    var az = Math.atan2(dx, dy);
    out[0] = rho * Math.sin(az); out[1] = rho * Math.cos(az);
    return out;
  }

  /* Convex hull, Andrew's monotone chain, counter-clockwise in the algebraic sense. */
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
  /* Distance from a point to a convex hull: 0 inside or on the boundary, else the distance to the nearest edge. */
  function hullDistance(h, x, y) {
    var n = h.length, inside = true, best = Infinity;
    for (var i = 0; i < n; i++) {
      var a = h[i], b = h[(i + 1) % n];
      var ex = b.x - a.x, ey = b.y - a.y;
      if (ex * (y - a.y) - ey * (x - a.x) < -1e-12) inside = false;
      var l2 = ex * ex + ey * ey;
      var u = l2 > 0 ? Lab.clamp(((x - a.x) * ex + (y - a.y) * ey) / l2, 0, 1) : 0;
      var qx = a.x + u * ex - x, qy = a.y + u * ey - y;
      var d = Math.sqrt(qx * qx + qy * qy);
      if (d < best) best = d;
    }
    return inside ? 0 : best;
  }

  /* The cluster hull in montage coordinates, its centroid and reach. */
  var CLUSTER = CLUSTER_NAMES.map(Lab.electrodeIndex);
  var CLUSTER_HULL = hull(CLUSTER.map(function (k) { return { x: MONTAGE[k].x, y: MONTAGE[k].y }; }));
  var ZONE_CENTRE = (function () {
    var sx = 0, sy = 0;
    for (var i = 0; i < CLUSTER_HULL.length; i++) { sx += CLUSTER_HULL[i].x; sy += CLUSTER_HULL[i].y; }
    return { x: sx / CLUSTER_HULL.length, y: sy / CLUSTER_HULL.length };
  })();
  var ZONE_REACH = (function () {
    var m = 0;
    for (var i = 0; i < CLUSTER_HULL.length; i++) {
      var dx = CLUSTER_HULL[i].x - ZONE_CENTRE.x, dy = CLUSTER_HULL[i].y - ZONE_CENTRE.y;
      m = Math.max(m, Math.sqrt(dx * dx + dy * dy));
    }
    return m + ZONE_PAD;
  })();
  /* Membership weight of a montage position in the candidate zone: 1 at the centre of the cluster, fading
     radially, cut off ZONE_PAD beyond the hull. Zero outside. */
  function zoneWeight(mx, my) {
    var d = hullDistance(CLUSTER_HULL, mx, my);
    if (d >= ZONE_PAD) return 0;
    var cx = mx - ZONE_CENTRE.x, cy = my - ZONE_CENTRE.y;
    var radial = 1 - Math.sqrt(cx * cx + cy * cy) / ZONE_REACH;
    return Lab.clamp(radial, 0, 1) * (1 - d / ZONE_PAD);
  }

  /* Surface sampling: uniform directions on the sphere, mapped to the displaced surface; directions that
     land in the medial fissure are rejected, so the two hemispheres read as separate bodies. */
  var mScratch = [0, 0];
  function samplePoints(count, seed) {
    var r = Lab.rng(seed);
    var pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    var zone = new Float32Array(count), shade = new Float32Array(count);
    var i = 0;
    while (i < count) {
      var z = 2 * r() - 1, ph = 2 * Math.PI * r(), rr = Math.sqrt(Math.max(0, 1 - z * z));
      var dx = rr * Math.sin(ph), dy = rr * Math.cos(ph), dz = z;
      surfacePoint(dx, dy, dz, pos, i * 3);
      if (Math.abs(pos[i * 3]) < FISSURE_HALF && pos[i * 3 + 2] > FISSURE_FLOOR) continue;
      surfaceNormal(dx, dy, dz, nor, i * 3);
      directionToMontage(dx, dy, dz, mScratch);
      zone[i] = zoneWeight(mScratch[0], mScratch[1]);
      shade[i] = surfaceShade(dx, dy, dz);
      i++;
    }
    return { pos: pos, nor: nor, zone: zone, shade: shade, count: count };
  }

  /* Electrodes on the surface. */
  var ELECTRODES = (function () {
    var pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), dir = new Float64Array(3);
    for (var k = 0; k < N; k++) {
      montageToDirection(MONTAGE[k].x, MONTAGE[k].y, dir, 0);
      surfacePoint(dir[0], dir[1], dir[2], pos, k * 3);
      surfaceNormal(dir[0], dir[1], dir[2], nor, k * 3);
    }
    return { pos: pos, nor: nor };
  })();

  /* Seeded toy graph (kept from the earlier 2D scalp figure): edge weight decreasing with scalp distance (Gaussian kernel, sigma
     in unit-circle units), jittered and capped below the cluster floor, so every pair inside the cluster
     outweighs every other edge. Pairs below the weight floor get no edge. */
  var GRAPH = (function () {
    var SIGMA = 0.42, MIN_WEIGHT = 0.16, BACKGROUND_MAX = 0.7, CLUSTER_MIN = 0.72;
    var rnd = Lab.rng(GRAPH_SEED);
    var inCluster = [], edges = [], degree = [], i, j;
    var weights = new Float32Array(N * N);
    for (i = 0; i < N; i++) { inCluster.push(false); degree.push(0); }
    for (i = 0; i < CLUSTER.length; i++) inCluster[CLUSTER[i]] = true;
    for (i = 0; i < N; i++) {
      for (j = i + 1; j < N; j++) {
        var dx = MONTAGE[i].x - MONTAGE[j].x, dy = MONTAGE[i].y - MONTAGE[j].y;
        var strong = inCluster[i] && inCluster[j];
        var w = strong ? CLUSTER_MIN + (1 - CLUSTER_MIN) * rnd()
          : Math.min(BACKGROUND_MAX, Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA)) * (0.6 + 0.8 * rnd()));
        if (w < MIN_WEIGHT) continue;
        edges.push({ a: i, b: j, w: w, strong: strong });
        weights[i * N + j] = w; weights[j * N + i] = w;
        degree[i]++; degree[j]++;
      }
    }
    return {
      edges: edges, degree: degree, cluster: CLUSTER, inCluster: inCluster,
      weight: function (a, b) { return weights[a * N + b]; }
    };
  })();

  /* Edge arcs in body space: quadratic Bezier from electrode to electrode whose midpoint is pushed out to
     LIFT above the surface, longer chords lifted more so they clear the curvature. EDGE_SEGMENTS + 1 points
     per edge, packed in one array. */
  var EDGE_POINTS = (function () {
    var E = GRAPH.edges.length, K = EDGE_SEGMENTS;
    var out = new Float32Array(E * (K + 1) * 3);
    var P = ELECTRODES.pos, c = new Float64Array(3);
    for (var e = 0; e < E; e++) {
      var a = GRAPH.edges[e].a * 3, b = GRAPH.edges[e].b * 3;
      var mx = (P[a] + P[b]) / 2, my = (P[a + 1] + P[b + 1]) / 2, mz = (P[a + 2] + P[b + 2]) / 2;
      var ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
      var chord = Math.sqrt((P[a] - P[b]) * (P[a] - P[b]) + (P[a + 1] - P[b + 1]) * (P[a + 1] - P[b + 1]) + (P[a + 2] - P[b + 2]) * (P[a + 2] - P[b + 2]));
      var lift = surfaceRadius(mx / ml, my / ml, mz / ml) * (1 + LIFT_BASE + LIFT_PER_LENGTH * chord);
      /* control point so that the curve passes through the lifted midpoint at t = 0.5 */
      c[0] = 2 * (mx / ml * lift) - mx; c[1] = 2 * (my / ml * lift) - my; c[2] = 2 * (mz / ml * lift) - mz;
      for (var s = 0; s <= K; s++) {
        var t = s / K, u = 1 - t, o = (e * (K + 1) + s) * 3;
        out[o] = u * u * P[a] + 2 * u * t * c[0] + t * t * P[b];
        out[o + 1] = u * u * P[a + 1] + 2 * u * t * c[1] + t * t * P[b + 1];
        out[o + 2] = u * u * P[a + 2] + 2 * u * t * c[2] + t * t * P[b + 2];
      }
    }
    return out;
  })();

  /* View transform: yaw about the vertical axis (degrees, 0 shows the left hemisphere, increasing turns the
     face towards the viewer), then the camera elevation. Writes (screen right, screen up, depth) per point,
     depth positive towards the viewer; project() adds the weak perspective. Deterministic, no allocation. */
  function rotate(src, count, yawDeg, pitchDeg, out) {
    var yaw = (yawDeg + YAW_FRONT) * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (var i = 0; i < count; i++) {
      var o = i * 3, x = src[o], y = src[o + 1], z = src[o + 2];
      var x1 = x * cy - y * sy, y1 = x * sy + y * cy;
      out[o] = x1;
      out[o + 1] = y1 * sp + z * cp;
      out[o + 2] = z * sp - y1 * cp;
    }
    return out;
  }
  function project(src, count, yawDeg, pitchDeg, out) {
    rotate(src, count, yawDeg, pitchDeg, out);
    for (var i = 0; i < count; i++) {
      var o = i * 3, f = CAMERA_DISTANCE / (CAMERA_DISTANCE - out[o + 2]);
      out[o] *= f; out[o + 1] *= f;
    }
    return out;
  }

  window.__brainModel = {
    POINT_COUNT: POINT_COUNT,
    POINT_SEED: POINT_SEED,
    PITCH: PITCH,
    ELEVATION_RING: ELEVATION_RING,
    ZONE_PAD: ZONE_PAD,
    CLUSTER_NAMES: CLUSTER_NAMES,
    CLUSTER_HULL: CLUSTER_HULL,
    ELECTRODES: ELECTRODES,
    GRAPH: GRAPH,
    EDGE_SEGMENTS: EDGE_SEGMENTS,
    EDGE_POINTS: EDGE_POINTS,
    shapeRadius: shapeRadius,
    surfaceRadius: surfaceRadius,
    surfacePoint: surfacePoint,
    surfaceNormal: surfaceNormal,
    surfaceShade: surfaceShade,
    montageToDirection: montageToDirection,
    directionToMontage: directionToMontage,
    hull: hull,
    hullDistance: hullDistance,
    zoneWeight: zoneWeight,
    samplePoints: samplePoints,
    rotate: rotate,
    project: project
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

  var TURN_MS = 40000;             /* one full turn of the idle rotation */
  var DEG_PER_MS = 360 / TURN_MS;
  var MAX_STEP_MS = 100;
  var KEY_YAW = 10, KEY_PITCH = 6; /* degrees per arrow press */
  var DRAG_DEG_PER_PX = 0.5;
  var DRAG_THRESHOLD = 3;          /* px before a press counts as a drag and not a click */
  var PITCH_MIN = -5, PITCH_MAX = 60;
  var PAD_X = 10, PAD_Y = 8;       /* canvas margin around the projected body */
  var SHADE_BUCKETS = 10, FOLD_LEVELS = 3, GROUPS = SHADE_BUCKETS * FOLD_LEVELS;
  var POINT_R_FRONT = 1.7, POINT_R_BACK = 0.8;
  var POINT_A_FRONT = 0.85, POINT_A_BACK = 0.07;
  var FOLD_DIM = 0.55;             /* alpha of a point in the deepest fold relative to a crest */
  var ZONE_A = 0.95;
  var GLOW_SPRITE = 96, GLOW_A = 0.5, GLOW_SPREAD = 1.35;
  var SILHOUETTE_DIRS = 72;
  var VISIBLE_FACING = 0.06;       /* below this the electrode is on the far side: button hidden */
  var LABEL_FACING = 0.4;          /* labels only for electrodes turned well towards the viewer */
  var NODE_R = 3, NODE_R_PER_DEGREE = 0.28, HI_RING = 5;
  var HI_GROW = 1.5;               /* radius added to the highlighted electrode */
  var NODE_A = 0.95, NODE_A_DIM = 0.35, NODE_A_BACK = 0.22, NODE_BACK_SCALE = 0.7;
  var EDGE_STRONG_A0 = 0.4, EDGE_STRONG_A1 = 0.5;   /* cluster edges: alpha = A0 + A1 * weight */
  var EDGE_WEAK_A0 = 0.08, EDGE_WEAK_A1 = 0.3;      /* the other edges */
  var EDGE_W0 = 0.6, EDGE_W1 = 1.4, EDGE_HI_W = 0.6;  /* line width = W0 + W1 * weight, plus EDGE_HI_W when touched */
  var DIM = 0.15;                  /* alpha factor of the edges and electrodes not touching the highlighted one */
  var BACK_EDGE_A = 0.3;           /* alpha factor of the arcs on the far side of the body */
  var HI_RING_A = 0.85;
  var LABEL_PX = 9.5, LABEL_HI_PX = 12, LABEL_GAP = 3, LABEL_RISE = 0.4, LABEL_HALO_W = 3, LABEL_HALO_A = 0.85, LABEL_A = 0.9;
  var SILHOUETTE_A = 0.28;
  var ZONE_DOT_GROW = 0.3, ZONE_BASE_A = 0.6;      /* accent dots of the zone: a little larger, base alpha scaled */
  var GLOW_FACING_GAIN = 1.4;      /* the patch is fully opaque once the zone centre faces the viewer this well */
  var FIT_YAW_STEP = 15;           /* layout() fits the body at yaws this many degrees apart */
  var SCALE_MIN = 10;              /* px per body unit, floor for a degenerate canvas */
  var BUTTON_MOVE_PX = 0.75;       /* smallest electrode movement that repositions its button */

  var t = Lab.tokens();
  var reduce = Lab.reduceMotion;
  var cloud = samplePoints(POINT_COUNT, POINT_SEED);
  var P = cloud.count, E = GRAPH.edges.length, K = EDGE_SEGMENTS;

  /* Per-frame buffers, allocated once. */
  var vPos = new Float32Array(P * 3), vNor = new Float32Array(P * 3);
  var vEl = new Float32Array(N * 3), vElNor = new Float32Array(N * 3);
  var vEdge = new Float32Array(E * (K + 1) * 3);
  var order = new Int32Array(P), counts = new Int32Array(GROUPS + 1), starts = new Int32Array(GROUPS + 1);
  var groupOf = new Uint8Array(P);
  var supportX = new Float32Array(SILHOUETTE_DIRS), supportY = new Float32Array(SILHOUETTE_DIRS);
  var dirCos = new Float32Array(SILHOUETTE_DIRS), dirSin = new Float32Array(SILHOUETTE_DIRS);
  for (var d = 0; d < SILHOUETTE_DIRS; d++) {
    dirCos[d] = Math.cos(2 * Math.PI * d / SILHOUETTE_DIRS);
    dirSin[d] = Math.sin(2 * Math.PI * d / SILHOUETTE_DIRS);
  }
  var btnX = new Float32Array(N), btnY = new Float32Array(N), btnShown = new Uint8Array(N);
  var neighbour = new Uint8Array(N);
  var elFacing = new Float32Array(N), elX = new Float32Array(N), elY = new Float32Array(N);
  var glow = document.createElement('canvas');
  glow.width = GLOW_SPRITE; glow.height = GLOW_SPRITE;

  var cw = 0, ch = 0, ctx = null, cx = 0, cy = 0, scale = 1;
  var yaw = 0, pitch = PITCH;
  var hi = -1, hoverIdx = -1, focusIdx = -1, pinned = -1;
  var buttons = [];

  /* Glow sprite: a radial accent gradient, rebuilt on theme change only. */
  function buildGlow() {
    var g = glow.getContext('2d'), h = GLOW_SPRITE / 2;
    g.clearRect(0, 0, GLOW_SPRITE, GLOW_SPRITE);
    var grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, Lab.rgba(t.accent, GLOW_A));
    grad.addColorStop(0.45, Lab.rgba(t.accent, GLOW_A * 0.45));
    grad.addColorStop(1, Lab.rgba(t.accent, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_SPRITE, GLOW_SPRITE);
  }
  buildGlow();

  /* One real button per electrode over the canvas; draw() positions them from the projection. */
  var selectLabel = str('select');
  for (var i = 0; i < N; i++) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', Lab.format(selectLabel, { name: MONTAGE[i].name }));
    b.setAttribute('aria-pressed', 'false');
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
     (focus-visible) also holds the idle rotation, so the electrode stays where the reader found it; a mouse
     click focuses too, but the pointer already holds the rotation while it hovers. */
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
        ? Lab.format(str('pinned'), { name: MONTAGE[idx].name }) + ' ' + describe(idx)
        : Lab.format(str('released'), { name: MONTAGE[idx].name });
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
      for (k = 0; k < E; k++) {
        e = GRAPH.edges[k];
        if (e.a === hi) neighbour[e.b] = 1; else if (e.b === hi) neighbour[e.a] = 1;
      }
    }
    if (readout) readout.textContent = hi >= 0 ? describe(hi) : str('idle', '');
    requestDraw();
  }
  function describe(k) {
    var n = GRAPH.degree[k];
    var tpl = str(GRAPH.inCluster[k] ? 'node_zone' : 'node');
    return Lab.format(tpl, { name: MONTAGE[k].name, n: n, links: str(n === 1 ? 'link_one' : 'link_many', '') });
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

  /* ---- layout: fit the projected body into the canvas at every yaw ---- */
  function layout() {
    var f = Lab.fitCanvas(canvas);
    cw = f.w; ch = f.h; ctx = f.ctx;
    cx = cw / 2; cy = ch / 2;
    var maxX = 0, maxY = 0, i, o;
    for (var y = 0; y < 360; y += FIT_YAW_STEP) {
      project(EDGE_POINTS, E * (K + 1), y, PITCH, vEdge);
      for (i = 0; i < E * (K + 1); i++) {
        o = i * 3;
        if (Math.abs(vEdge[o]) > maxX) maxX = Math.abs(vEdge[o]);
        if (Math.abs(vEdge[o + 1]) > maxY) maxY = Math.abs(vEdge[o + 1]);
      }
      project(cloud.pos, P, y, PITCH, vPos);
      for (i = 0; i < P; i++) {
        o = i * 3;
        if (Math.abs(vPos[o]) > maxX) maxX = Math.abs(vPos[o]);
        if (Math.abs(vPos[o + 1]) > maxY) maxY = Math.abs(vPos[o + 1]);
      }
    }
    scale = Math.max(SCALE_MIN, Math.min((cw / 2 - PAD_X) / maxX, (ch / 2 - PAD_Y) / maxY));
    draw();
  }

  /* ---- drawing ---- */
  /* One fill per group: the groups are facing buckets (far to near) split by fold level, so depth shading
     and the fold shading both come out of a single batched path per group. */
  function drawPoints(group, zonePass) {
    var bucket = Math.floor(group / FOLD_LEVELS), level = group % FOLD_LEVELS;
    var facing = (bucket + 0.5) / SHADE_BUCKETS;
    var r = POINT_R_BACK + (POINT_R_FRONT - POINT_R_BACK) * facing;
    var a = (POINT_A_BACK + (POINT_A_FRONT - POINT_A_BACK) * facing * facing) * (FOLD_DIM + (1 - FOLD_DIM) * (level + 0.5) / FOLD_LEVELS);
    var from = starts[group], to = starts[group + 1];
    if (zonePass) {
      /* accent dots, each with its own alpha from the zone weight: a few dozen per bucket */
      for (var q = from; q < to; q++) {
        var i = order[q];
        if (cloud.zone[i] <= 0) continue;
        var o = i * 3, x = cx + vPos[o] * scale, y = cy - vPos[o + 1] * scale;
        ctx.fillStyle = Lab.rgba(t.accent, Math.min(1, a * ZONE_BASE_A + ZONE_A * cloud.zone[i] * facing));
        ctx.beginPath();
        ctx.arc(x, y, r + ZONE_DOT_GROW, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    ctx.fillStyle = Lab.rgba(t.ink, a);
    ctx.beginPath();
    for (var p = from; p < to; p++) {
      var j = order[p];
      if (cloud.zone[j] > 0) continue;
      var oj = j * 3, xj = cx + vPos[oj] * scale, yj = cy - vPos[oj + 1] * scale;
      ctx.moveTo(xj + r, yj);
      ctx.arc(xj, yj, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function drawEdges(back) {
    var e, k, o, s, x, y;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (k = 0; k < E; k++) {
      e = GRAPH.edges[k];
      o = (k * (K + 1) + (K >> 1)) * 3;
      if ((vEdge[o + 2] < 0) !== back) continue;
      var touches = hi >= 0 && (e.a === hi || e.b === hi);
      var alpha, color;
      if (e.strong) { color = t.accent; alpha = EDGE_STRONG_A0 + EDGE_STRONG_A1 * e.w; }
      else { color = t.ink; alpha = EDGE_WEAK_A0 + EDGE_WEAK_A1 * e.w; }
      if (hi >= 0) alpha = touches ? 1 : alpha * DIM;
      if (back) alpha *= BACK_EDGE_A;
      ctx.strokeStyle = Lab.rgba(touches ? t.accent : color, alpha);
      ctx.lineWidth = (EDGE_W0 + EDGE_W1 * e.w) + (touches ? EDGE_HI_W : 0);
      ctx.beginPath();
      for (s = 0; s <= K; s++) {
        o = (k * (K + 1) + s) * 3;
        x = cx + vEdge[o] * scale; y = cy - vEdge[o + 1] * scale;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawElectrodes(back) {
    var k;
    for (k = 0; k < N; k++) {
      var f = elFacing[k];
      if ((f < VISIBLE_FACING) !== back) continue;
      var isHi = k === hi;
      var dim = hi >= 0 && !isHi && !neighbour[k];
      var r = NODE_R + GRAPH.degree[k] * NODE_R_PER_DEGREE + (isHi ? HI_GROW : 0);
      var alpha = back ? NODE_A_BACK : (dim ? NODE_A_DIM : NODE_A);
      ctx.beginPath();
      ctx.arc(elX[k], elY[k], back ? r * NODE_BACK_SCALE : r, 0, Math.PI * 2);
      ctx.fillStyle = Lab.rgba(GRAPH.inCluster[k] || isHi ? t.accent : t.ink, alpha);
      ctx.fill();
      if (!back) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = t.surface;
        ctx.stroke();
      }
      if (isHi && !back) {
        ctx.beginPath();
        ctx.arc(elX[k], elY[k], r + HI_RING, 0, Math.PI * 2);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = Lab.rgba(t.accent, HI_RING_A);
        ctx.stroke();
      }
    }
    if (back) return;
    /* Labels for the electrodes turned towards the viewer, the highlighted one and its neighbours always. */
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = LABEL_HALO_W;
    ctx.strokeStyle = Lab.rgba(t.surface, LABEL_HALO_A);
    for (k = 0; k < N; k++) {
      var isH = k === hi;
      var show = isH || (hi >= 0 && neighbour[k]) || (hi < 0 && elFacing[k] > LABEL_FACING);
      if (!show || elFacing[k] < VISIBLE_FACING) continue;
      var rr = NODE_R + GRAPH.degree[k] * NODE_R_PER_DEGREE + (isH ? HI_GROW + HI_RING : 0);
      ctx.font = isH ? Lab.font(LABEL_HI_PX, t, 600) : Lab.font(LABEL_PX, t);
      var lx = elX[k] + rr + LABEL_GAP, ly = elY[k] - rr * LABEL_RISE;
      ctx.strokeText(MONTAGE[k].name, lx, ly);
      ctx.fillStyle = isH ? t.ink : Lab.rgba(t.muted, hi >= 0 ? 1 : LABEL_A);
      ctx.fillText(MONTAGE[k].name, lx, ly);
    }
  }

  function drawSilhouette() {
    var d, i, o;
    for (d = 0; d < SILHOUETTE_DIRS; d++) {
      var m = -Infinity, mi = 0;
      for (i = 0; i < P; i++) {
        o = i * 3;
        var v = vPos[o] * dirCos[d] - vPos[o + 1] * dirSin[d];
        if (v > m) { m = v; mi = o; }
      }
      supportX[d] = cx + vPos[mi] * scale; supportY[d] = cy - vPos[mi + 1] * scale;
    }
    ctx.beginPath();
    ctx.moveTo((supportX[SILHOUETTE_DIRS - 1] + supportX[0]) / 2, (supportY[SILHOUETTE_DIRS - 1] + supportY[0]) / 2);
    for (d = 0; d < SILHOUETTE_DIRS; d++) {
      var n = (d + 1) % SILHOUETTE_DIRS;
      ctx.quadraticCurveTo(supportX[d], supportY[d], (supportX[d] + supportX[n]) / 2, (supportY[d] + supportY[n]) / 2);
    }
    ctx.closePath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = Lab.rgba(t.ink, SILHOUETTE_A);
    ctx.stroke();
  }

  function drawGlow() {
    /* The patch follows the zone points: bounding box of the visible ones, alpha from how much the zone
       centre faces the viewer, so it fades out as the cluster turns away. */
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, facing = 0, wsum = 0;
    for (var i = 0; i < P; i++) {
      var w = cloud.zone[i];
      if (w <= 0) continue;
      var o = i * 3, x = cx + vPos[o] * scale, y = cy - vPos[o + 1] * scale;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      facing += vNor[o + 2] * w; wsum += w;
    }
    if (wsum <= 0) return;
    facing /= wsum;
    if (facing <= 0) return;
    var rx = (maxX - minX) / 2 * GLOW_SPREAD, ry = (maxY - minY) / 2 * GLOW_SPREAD;
    var gx = (minX + maxX) / 2, gy = (minY + maxY) / 2;
    ctx.globalAlpha = Math.min(1, facing * GLOW_FACING_GAIN);
    ctx.drawImage(glow, gx - rx, gy - ry, 2 * rx, 2 * ry);
    ctx.globalAlpha = 1;
  }

  /* A focused button stays even when its electrode turns away, so keyboard rotation never drops the focus. */
  function placeButtons() {
    for (var k = 0; k < N; k++) {
      var show = elFacing[k] >= VISIBLE_FACING || k === focusIdx;
      var bt = buttons[k];
      if (show !== !!btnShown[k]) {
        btnShown[k] = show ? 1 : 0;
        bt.hidden = !show;
        bt.disabled = !show;
      }
      if (!show) continue;
      if (Math.abs(elX[k] - btnX[k]) >= BUTTON_MOVE_PX || Math.abs(elY[k] - btnY[k]) >= BUTTON_MOVE_PX) {
        btnX[k] = elX[k]; btnY[k] = elY[k];
        bt.style.transform = 'translate(' + elX[k].toFixed(1) + 'px,' + elY[k].toFixed(1) + 'px)';
      }
    }
  }

  function draw() {
    if (!ctx) return;
    var i, o, bkt;
    project(cloud.pos, P, yaw, pitch, vPos);
    rotate(cloud.nor, P, yaw, pitch, vNor);
    project(ELECTRODES.pos, N, yaw, pitch, vEl);
    rotate(ELECTRODES.nor, N, yaw, pitch, vElNor);
    project(EDGE_POINTS, E * (K + 1), yaw, pitch, vEdge);
    for (i = 0; i < N; i++) {
      o = i * 3;
      elFacing[i] = vElNor[o + 2];
      elX[i] = cx + vEl[o] * scale; elY[i] = cy - vEl[o + 1] * scale;
    }
    /* counting sort of the cloud by facing bucket and fold level, far to near */
    for (i = 0; i <= GROUPS; i++) counts[i] = 0;
    for (i = 0; i < P; i++) {
      bkt = Math.floor((vNor[i * 3 + 2] + 1) / 2 * SHADE_BUCKETS);
      if (bkt >= SHADE_BUCKETS) bkt = SHADE_BUCKETS - 1;
      if (bkt < 0) bkt = 0;
      var lvl = Math.floor(cloud.shade[i] * FOLD_LEVELS);
      if (lvl >= FOLD_LEVELS) lvl = FOLD_LEVELS - 1;
      groupOf[i] = bkt * FOLD_LEVELS + lvl;
      counts[groupOf[i] + 1]++;
    }
    starts[0] = 0;
    for (i = 1; i <= GROUPS; i++) starts[i] = starts[i - 1] + counts[i];
    for (i = 0; i <= GROUPS; i++) counts[i] = starts[i];
    for (i = 0; i < P; i++) order[counts[groupOf[i]]++] = i;

    ctx.clearRect(0, 0, cw, ch);
    drawSilhouette();
    drawEdges(true);
    drawElectrodes(true);
    for (bkt = 0; bkt < GROUPS; bkt++) drawPoints(bkt, false);
    drawGlow();
    for (bkt = 0; bkt < GROUPS; bkt++) drawPoints(bkt, true);
    drawEdges(false);
    drawElectrodes(false);
    placeButtons();
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
  Lab.onTheme(function () { t = Lab.tokens(); buildGlow(); requestDraw(); });
  Lab.fontsReady(requestDraw);

  var forcedYaw = parseFloat(Lab.param('yaw'));
  if (isFinite(forcedYaw)) yaw = ((forcedYaw % 360) + 360) % 360;
  if (readout) readout.textContent = str('idle', '');
  layout();
  var forcedHi = Lab.param('highlight');
  if (forcedHi) setPinned(Lab.electrodeIndex(forcedHi));
  if (!reduce) Lab.whenVisible(fig, start, stop);

  /* Scripted checks (see README). */
  window.__brain = {
    yaw: function () { return yaw; },
    pitch: function () { return pitch; },
    setYaw: function (deg) { yaw = ((deg % 360) + 360) % 360; draw(); return yaw; },
    highlight: function (name) { setPinned(Lab.electrodeIndex(name)); return hi; },
    current: function () { return hi; },
    pinned: function () { return pinned; },
    readout: function () { return readout ? readout.textContent : ''; },
    visible: function () { var out = []; for (var k = 0; k < N; k++) if (btnShown[k]) out.push(MONTAGE[k].name); return out; },
    running: function () { return running; },
    autoRotating: autoRotating
  };
})();
