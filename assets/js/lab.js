/* Lab: shared helpers for the canvas figures (seeded random numbers, theme tokens, the 10-20 montage, canvas
   sizing, interpolation, colour parsing, easing, label formatting and strings). Loaded after site.js, before the
   figure modules; the model tests load it first in a bare engine, so nothing here touches the DOM at load time. */
(function () {
  'use strict';
  var Lab = {};

  /* Seeded PRNG (mulberry32) so every simulation is reproducible. */
  Lab.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* Design tokens read from CSS so canvases follow the theme. Only the tokens a figure reads are listed. */
  var TOKEN_MAP = {
    surface: '--surface', surface2: '--surface-2',
    ink: '--ink', ink2: '--ink-2', muted: '--muted', line: '--line', lineStrong: '--line-strong',
    accent: '--accent', trace: '--trace', trace2: '--trace-2',
    neuronFibre: '--neuron-fibre', neuronSoma: '--neuron-soma',
    fontMono: '--font-mono', fontBody: '--font-body'
  };
  Lab.tokens = function () {
    var cs = getComputedStyle(document.documentElement);
    var out = {};
    for (var k in TOKEN_MAP) out[k] = cs.getPropertyValue(TOKEN_MAP[k]).trim();
    out.dark = window.siteTheme ? window.siteTheme.isDark() : false;
    return out;
  };
  Lab.onTheme = function (fn) {
    document.addEventListener('themechange', function (e) { fn(e && e.detail); });
  };
  /* Run fn once the web fonts are in, so a figure can re-measure its labels. fn is called with no argument (the
     promise resolves with the FontFaceSet), which lets a caller pass a redraw that takes a timestamp. */
  Lab.fontsReady = function (fn) {
    function done() { fn(); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(done, done); else done();
  };

  /* Standard 10-20 montage, 19 electrodes, unit circle, nose up (y > 0 is anterior). An entry is
     [name, radius (0 at the vertex, 1 at the rim), azimuth in degrees clockwise from the nose]. */
  Lab.MONTAGE = (function () {
    var defs = [
      ['Fp1', 1, -18], ['Fp2', 1, 18], ['F7', 1, -54], ['F3', 0.55, -39], ['Fz', 0.5, 0], ['F4', 0.55, 39], ['F8', 1, 54],
      ['T3', 1, -90], ['C3', 0.5, -90], ['Cz', 0, 0], ['C4', 0.5, 90], ['T4', 1, 90],
      ['T5', 1, -126], ['P3', 0.55, -141], ['Pz', 0.5, 180], ['P4', 0.55, 141], ['T6', 1, 126], ['O1', 1, -162], ['O2', 1, 162]
    ];
    return defs.map(function (d) {
      var th = d[2] * Math.PI / 180;
      return { name: d[0], x: +(d[1] * Math.sin(th)).toFixed(4), y: +(d[1] * Math.cos(th)).toFixed(4) };
    });
  })();
  Lab.electrodeIndex = function (name) {
    for (var i = 0; i < Lab.MONTAGE.length; i++) if (Lab.MONTAGE[i].name.toLowerCase() === String(name).toLowerCase()) return i;
    return -1;
  };
  /* Canvas sizing with a DPR cap of 2. Returns CSS-pixel size and a context whose transform is set. */
  Lab.fitCanvas = function (canvas) {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    var bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h, dpr: dpr, ctx: ctx };
  };

  /* Top-view head outline: circle, nose, ears. Hairline strokes in the line-strong token. */
  Lab.drawHead = function (ctx, cx, cy, r, t) {
    var n = r * 0.11;
    ctx.save();
    ctx.strokeStyle = t.lineStrong;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - n * 0.95, cy - r + n * 0.25);
    ctx.lineTo(cx, cy - r - n);
    ctx.lineTo(cx + n * 0.95, cy - r + n * 0.25);
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx - r - n * 0.3, cy, n * 0.45, n * 1.15, 0, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx + r + n * 0.3, cy, n * 0.45, n * 1.15, 0, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    ctx.restore();
  };

  /* Inverse-distance-weighted interpolation (scalp topographies). positions: [{x,y}], values: [number]. */
  Lab.idw = function (values, positions, px, py, power) {
    var num = 0, den = 0, p = power || 2;
    for (var i = 0; i < positions.length; i++) {
      var dx = px - positions[i].x, dy = py - positions[i].y;
      var d2 = dx * dx + dy * dy;
      if (d2 < 1e-9) return values[i];
      var w = 1 / Math.pow(d2, p / 2);
      num += w * values[i]; den += w;
    }
    return den ? num / den : 0;
  };

  /* Parse "rgb(...)"/hex token into [r,g,b] so canvases can build rgba() with alpha. */
  Lab.rgb = function (color) {
    var c = String(color).trim();
    var m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var parts = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    }
    return [128, 128, 128];
  };
  /* Alpha of a colour token: the fourth component of rgba(), written as "0.11" or "11%" (comma or slash
     separated); 1 for rgb() and hex. Read once per theme so the frame loops only multiply. */
  Lab.alpha = function (color) {
    var m = String(color).match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    var parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    var a = parts[3].slice(-1) === '%' ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
  };
  /* Memoised: the figures call this inside draw loops with a handful of colours and quantised alphas,
     so the cache stays small and no strings are built per frame after warm-up. */
  var rgbaCache = {}, rgbaCount = 0;
  Lab.rgba = function (color, alpha) {
    var a = Math.round(Math.max(0, Math.min(1, alpha)) * 100) / 100;
    var key = color + '|' + a;
    var hit = rgbaCache[key];
    if (hit) return hit;
    var c = Lab.rgb(color);
    var out = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    if (rgbaCount > 2000) { rgbaCache = {}; rgbaCount = 0; }
    rgbaCache[key] = out; rgbaCount++;
    return out;
  };

  Lab.param = function (name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  };

  /* "{name}" placeholders filled from a map; a placeholder without a value stays visible so a wrong template
     shows. Numbers are written as given (callers round or sign them first). */
  Lab.format = function (template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (all, key) {
      return values && values[key] !== undefined ? String(values[key]) : all;
    });
  };
  /* Labels of a figure: str(path, fallback) over window.I18N[moduleKey], which _layouts/default.html inlines
     from _data/js/*.yml in the language of the page. path may be dotted ("readouts.wild"). English lives only
     in the yml: when the tree or the entry is missing the getter returns fallback if one is given, else the
     last segment of the path, and never throws (the tests load the modules without I18N). */
  Lab.strings = function (moduleKey) {
    var tree = (typeof window !== 'undefined' && window.I18N && window.I18N[moduleKey]) || null;
    return function str(path, fallback) {
      var parts = String(path).split('.'), node = tree, i;
      for (i = 0; i < parts.length && node !== null && typeof node === 'object'; i++) node = node[parts[i]];
      if (i === parts.length && typeof node === 'string') return node;
      return fallback !== undefined ? fallback : parts[parts.length - 1];
    };
  };
  /* Monotonic milliseconds for the frame loops and the readout timers. */
  Lab.now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };
  /* site.js computes the flag (system preference or ?motion=reduce); fall back to the media query if it is absent. */
  Lab.reduceMotion = window.siteMotion ? window.siteMotion.reduce :
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /* Forwarder to the site-wide helper, so a figure module only ever has to know about Lab. */
  Lab.whenVisible = function (el, onVisible, onHidden) { window.whenVisible(el, onVisible, onHidden); };

  Lab.easeOut = function (t) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 5); };
  Lab.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  /* Memoised like rgba: the draw loops ask for the same few fonts every frame. */
  var fontCache = {};
  Lab.font = function (px, t, weight, family) {
    var fam = family || t.fontMono;
    var key = (weight || 400) + '|' + px + '|' + fam;
    return fontCache[key] || (fontCache[key] = (weight || 400) + ' ' + px + 'px ' + fam);
  };

  window.Lab = Lab;
})();
