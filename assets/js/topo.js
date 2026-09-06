/* Topo: the microstate topography of the bento (#mini-topo). Loaded with defer after lab.js and site.js.
   A scalp voltage map steps through the four canonical classes A to D on a labelled duration bar, in the
   classic diverging voltage colours: blue for negative, the neutral surface tone for zero, red for positive.
   The loop runs only while the figure and the tab are visible.
   Part 1 is a pure model (no DOM access) exported on window.__topoModel for tests/topo.test.js, which runs
   it in a bare engine after lab.js. Part 2 attaches to the DOM and exits when the cell is missing. Labels
   come from window.I18N.topo (_data/js/topo.yml) through Lab.strings.
   Debug hook: ?topo=LETTER shows that class first. The brain cell is drawn by brain.js. */
(function () {
  'use strict';

  var Lab = window.Lab;
  var MONTAGE = Lab.MONTAGE;
  var N = MONTAGE.length;

  /* ======================================================================
     Part 1: model (pure functions, no DOM access)
     ====================================================================== */

  var CLASSES = ['A', 'B', 'C', 'D'];

  /* Data colours of the voltage map (a scientific colormap, outside the accent lock): one pair per theme,
     the neutral is the --surface-2 token read at draw time. */
  var PALETTES = {
    light: { blue: '#2456c7', red: '#c8323a' },
    dark: { blue: '#4f7ee8', red: '#e05a5a' }
  };

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
     follow, and the bar keeps the true proportions through --seg. */
  var SEQUENCE = [
    { cls: 'A', dur: 80 }, { cls: 'B', dur: 60 }, { cls: 'D', dur: 110 }, { cls: 'C', dur: 95 },
    { cls: 'D', dur: 70 }, { cls: 'A', dur: 120 }, { cls: 'C', dur: 85 }, { cls: 'D', dur: 65 },
    { cls: 'B', dur: 100 }, { cls: 'C', dur: 90 }
  ];

  /* Diverging colormap: a signed value in [-1, 1] blends linearly from the neutral towards blue (negative)
     or red (positive); |v| above 1 clips to the endpoint. Colours are [r, g, b] arrays; the result is written
     into out (or a fresh array) so the per-pixel loop allocates nothing. */
  function colormap(v, neutral, blue, red, out) {
    var a = v < 0 ? -v : v;
    if (a > 1) a = 1;
    var end = v < 0 ? blue : red;
    out = out || [0, 0, 0];
    out[0] = neutral[0] + (end[0] - neutral[0]) * a;
    out[1] = neutral[1] + (end[1] - neutral[1]) * a;
    out[2] = neutral[2] + (end[2] - neutral[2]) * a;
    return out;
  }

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

  /* The mask is the head circle with a small margin, so the blurred edge of the map reaches under the head
     outline instead of stopping short of it. A power of 3 keeps the interpolation local enough to read as a
     scalp map; two blur passes take the electrode-centred bumps of the interpolation back out. */
  var HEAD_MASK_R = 1.06, IDW_POWER = 3, BLUR_PASSES = 2;

  /* Interpolated topography of one template on a g x g grid spanning [-span, span]^2 (y up), blurred and
     renormalised so the extreme inside the head circle is exactly 1. Returns {field, mask}. */
  function topography(values, g, span) {
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

  window.__topoModel = {
    TEMPLATES: TEMPLATES,
    SEQUENCE: SEQUENCE,
    CLASSES: CLASSES,
    PALETTES: PALETTES,
    colormap: colormap,
    topography: topography
  };

  /* ======================================================================
     Part 2: DOM
     ====================================================================== */
  if (typeof document === 'undefined') return;
  var root = document.getElementById('mini-topo');
  if (!root) return;
  var fig = root.querySelector('.topo-figure');
  var canvas = fig.querySelector('canvas');
  var label = document.getElementById('mini-topo-label');
  var bar = document.getElementById('mini-topo-bar');
  var str = Lab.strings('topo');

  var t = Lab.tokens();
  var seqLen = SEQUENCE.length;
  var SEG_MS = 700, FADE_MS = 200;
  var LEGEND_W = 44, LEGEND_H = 5, LEGEND_PAD = 10;
  /* Head geometry of the animated map. The outline is 2.11 radii tall (the circle plus the nose, which sticks
     out by 0.11 r), so the radius is what the frame leaves after the legend row (HEAD_PAD_Y) and the side
     margin (HEAD_PAD_X), divided by HEAD_SPAN, which keeps a little air above the nose. The head sits a touch
     below the centre for the same reason. */
  var HEAD_R_MIN = 30, HEAD_PAD_X = 24, HEAD_PAD_Y = 32, HEAD_SPAN = 2.22, HEAD_DROP = 0.05, DOT_R = 2.2;
  /* Reduced-motion grid: four heads in a row when each column gets STATIC_COL_MIN px, else two by two; the
     class letter sits above the nose (the nose tip is at NOSE_R radii). */
  var STATIC_COL_MIN = 84, STATIC_R_MIN = 18, STATIC_PAD_X = 7, STATIC_PAD_Y = 30, STATIC_SPAN = 2.3;
  var STATIC_DROP = 0.08, STATIC_SHIFT = 6, STATIC_DOT_R = 1.4, STATIC_LETTER_GAP = 8, NOSE_R = 1.11;
  var reduce = Lab.reduceMotion;

  /* Offscreen grid: G x G samples over [-SPAN, SPAN]^2, masked to the head circle at draw time. The four
     fields are interpolated once at init; each frame only blends two of them into the image. The mask is the
     same circle for every class, so keeping the one the last call returned is enough. */
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

  /* Colour endpoints, refreshed on theme change: the neutral is the surface-2 token, blue and red come from
     the palette of the current theme. The legend gradient is rebuilt here too, never inside the loop. */
  var neutral = [0, 0, 0], blue = [0, 0, 0], red = [0, 0, 0];
  var rgb = [0, 0, 0];               /* scratch the per-pixel colormap writes into */
  var legendGradient = null;
  function readColors() {
    var pal = t.dark ? PALETTES.dark : PALETTES.light;
    neutral = Lab.rgb(t.surface2); blue = Lab.rgb(pal.blue); red = Lab.rgb(pal.red);
    legendGradient = null;
  }
  readColors();

  /* Write the blend of two signed templates at progress p into the offscreen image. No allocation. */
  function compose(c0, s0, c1, s1, p) {
    var q = 1 - p, o0 = c0 * GN, o1 = c1 * GN;
    for (var gi = 0; gi < GN; gi++) {
      var o = gi * 4;
      if (!mask[gi]) { pix[o + 3] = 0; continue; }
      colormap(q * s0 * fields[o0 + gi] + p * s1 * fields[o1 + gi], neutral, blue, red, rgb);
      pix[o] = rgb[0]; pix[o + 1] = rgb[1]; pix[o + 2] = rgb[2];
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

  /* Colour legend in the bottom-right corner: the blue-to-red ramp with its two signs. */
  function drawLegend() {
    var x0 = cw - LEGEND_PAD - LEGEND_W, y0 = ch - LEGEND_PAD - LEGEND_H;
    if (!legendGradient) {
      legendGradient = ctx.createLinearGradient(x0, 0, x0 + LEGEND_W, 0);
      legendGradient.addColorStop(0, 'rgb(' + blue[0] + ',' + blue[1] + ',' + blue[2] + ')');
      legendGradient.addColorStop(0.5, 'rgb(' + neutral[0] + ',' + neutral[1] + ',' + neutral[2] + ')');
      legendGradient.addColorStop(1, 'rgb(' + red[0] + ',' + red[1] + ',' + red[2] + ')');
    }
    ctx.fillStyle = legendGradient;
    ctx.fillRect(x0, y0, LEGEND_W, LEGEND_H);
    ctx.fillStyle = t.muted;
    ctx.font = Lab.font(10, t);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('-', x0 - 4, y0 + LEGEND_H / 2);
    ctx.textAlign = 'left';
    ctx.fillText('+', x0 + LEGEND_W + 4, y0 + LEGEND_H / 2);
  }

  /* ---- Animated path ---- */
  var cur = -1, fromC = 0, fromS = 1, toC = 0, toS = 1, lastP = 1;
  var t0 = 0, phase = 0, running = false, raf = 0;
  var spans = [];
  var segmentTitle = str('segment');
  for (var i = 0; i < seqLen; i++) {
    var sp = document.createElement('span');
    sp.style.setProperty('--seg', String(SEQUENCE[i].dur));
    sp.title = Lab.format(segmentTitle, { cls: SEQUENCE[i].cls, ms: SEQUENCE[i].dur });
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
    var r = Math.max(HEAD_R_MIN, Math.min(cw / 2 - HEAD_PAD_X, (ch - HEAD_PAD_Y) / HEAD_SPAN));
    drawHeadMap(cw / 2, ch / 2 + r * HEAD_DROP, r, DOT_R);
    drawLegend();
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
    t0 = Lab.now() - phase;
    lastP = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (!running) return;
    running = false;
    phase = Lab.now() - t0;
    cancelAnimationFrame(raf);
  }

  /* ---- Reduced-motion path: the four maps side by side, lettered, no loop ---- */
  function renderStatic() {
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    var cols = cw >= 4 * STATIC_COL_MIN ? 4 : 2, rows = cols === 4 ? 1 : 2;
    var cellW = cw / cols, cellH = ch / rows;
    var r = Math.max(STATIC_R_MIN, Math.min(cellW / 2 - STATIC_PAD_X, (cellH - STATIC_PAD_Y) / STATIC_SPAN));
    for (var c = 0; c < CLASSES.length; c++) {
      var col = c % cols, row = Math.floor(c / cols);
      var cx = cellW * (col + 0.5), cy = cellH * (row + 0.5) + r * STATIC_DROP + STATIC_SHIFT;
      compose(c, 1, c, 1, 1);
      drawHeadMap(cx, cy, r, STATIC_DOT_R);
      ctx.font = Lab.font(12, t, 600);
      ctx.fillStyle = t.accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(CLASSES[c], cx, cy - r * NOSE_R - STATIC_LETTER_GAP);
    }
  }

  function layout() {
    var f = Lab.fitCanvas(canvas);
    cw = f.w; ch = f.h; ctx = f.ctx;
    legendGradient = null;
    redraw();
  }
  function redraw() {
    if (reduce) renderStatic();
    else if (cur >= 0) renderAnimated(lastP < 1 ? lastP : 1);
    else { enter(0, 0); renderAnimated(1); }
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(fig);
  else window.addEventListener('resize', layout);
  Lab.onTheme(function () { t = Lab.tokens(); readColors(); redraw(); });
  Lab.fontsReady(redraw);
  layout();

  if (reduce) markSegment(-1);
  else Lab.whenVisible(fig, start, stop);

  /* Scripted checks (see README) drive the figure through window.__topo. */
  var api = {
    show: function (letter) {
      var L = String(letter || '').toUpperCase();
      var idx = -1;
      for (var i = 0; i < seqLen; i++) if (SEQUENCE[i].cls === L) { idx = i; break; }
      if (idx < 0) return cur;
      if (reduce) { markSegment(idx); return idx; }
      phase = idx * SEG_MS;
      if (running) t0 = Lab.now() - phase;
      enter(idx, 0);
      renderAnimated(1);
      return idx;
    },
    current: function () { return cur >= 0 ? SEQUENCE[cur].cls : ''; },
    running: function () { return running; }
  };
  window.__topo = api;
  var forcedCls = Lab.param('topo');
  if (forcedCls) api.show(forcedCls);
})();
