/* Tests for the shared helpers of assets/js/lab.js. Run from the repository root:
     jsc tests/lab.test.js
   (JavaScriptCore's jsc, or any engine with load() and print()). */
var window = this;  /* bare engine: the modules attach to window */
load('tests/harness.js');
load('assets/js/lab.js');

var Lab = window.Lab;
assert(!!Lab, 'Lab exported on window.Lab');

/* ---- Seeded random numbers ---- */
(function () {
  var a = Lab.rng(7), b = Lab.rng(7), c = Lab.rng(8), same = true, inRange = true, i;
  for (i = 0; i < 1000; i++) {
    var x = a(), y = b();
    if (x !== y) same = false;
    if (x < 0 || x >= 1) inRange = false;
  }
  assert(same && inRange, 'the same seed gives the same sequence, values in [0, 1)');
  assert(a() !== c(), 'a different seed gives a different sequence');
})();

/* ---- Placeholder formatting ---- */
assert(Lab.format('Stimulate {name}', { name: 'C3' }) === 'Stimulate C3', 'format fills a placeholder');
assert(Lab.format('{a}-{b}, r = {r}.', { a: 'O1', b: 'O2', r: (0.4).toFixed(2) }) === 'O1-O2, r = 0.40.', 'format fills several placeholders, numbers as given');
assert(Lab.format('{reached} of {total}', { reached: 0, total: 19 }) === '0 of 19', 'format keeps a zero value');
assert(Lab.format('Hello {who}', {}) === 'Hello {who}' && Lab.format('plain', null) === 'plain',
  'a missing value leaves the placeholder visible; no values is fine');
assert(Lab.format('{x} and {x}', { x: 1 }) === '1 and 1', 'a repeated placeholder is filled every time');

/* ---- Strings: a getter over window.I18N[module], safe without the table ---- */
(function () {
  var str = Lab.strings('nothing');
  assert(str('select') === 'select' && str('readouts.wild') === 'wild', 'without a table the last path segment stands in');
  assert(str('select', 'Select {name}') === 'Select {name}' && str('idle', '') === '', 'an explicit fallback wins, an empty one included');
  window.I18N = { demo: { select: 'Seleziona {name}', readouts: { wild: 'Normale', nopool: 'niente' }, buttons: { icl: 'A' } } };
  str = Lab.strings('demo');
  assert(str('select') === 'Seleziona {name}', 'a flat key is read from the table');
  assert(str('readouts.wild') === 'Normale' && str('buttons.icl') === 'A', 'a dotted path walks the tree');
  assert(str('readouts.missing') === 'missing' && str('readouts.missing', 'x') === 'x', 'a missing entry degrades like a missing table');
  assert(str('readouts') === 'readouts' && str('select.deeper') === 'deeper', 'a subtree or a path through a string is not a string');
  var threw = false;
  try { Lab.strings('demo')('a.b.c.d'); } catch (e) { threw = true; }
  assert(!threw, 'the getter never throws');
  delete window.I18N;
})();

/* ---- Colours ---- */
assert(Lab.rgb('#0a7f70').join(',') === '10,127,112' && Lab.rgb('#fff').join(',') === '255,255,255', 'rgb parses 6- and 3-digit hex');
assert(Lab.rgb('rgba(15, 20, 32, 0.11)').join(',') === '15,20,32' && Lab.rgb('rgb(1 2 3 / 50%)').join(',') === '1,2,3', 'rgb parses rgba() with commas or slashes');
assert(near(Lab.alpha('rgba(15, 20, 32, 0.11)'), 0.11, 1e-12), 'alpha reads the comma form');
assert(near(Lab.alpha('rgb(15 20 32 / 11%)'), 0.11, 1e-12), 'alpha reads the slash and percent form');
assert(Lab.alpha('rgb(15, 20, 32)') === 1 && Lab.alpha('#0a7f70') === 1 && Lab.alpha('') === 1, 'alpha is 1 for rgb(), hex and an empty token');
assert(Lab.rgba('#0a7f70', 0.5) === 'rgba(10,127,112,0.5)' && Lab.rgba('#0a7f70', 2) === 'rgba(10,127,112,1)', 'rgba builds the string and clamps the alpha');
assert(Lab.rgba('#0a7f70', 0.5) === Lab.rgba('#0a7f70', 0.5), 'rgba is memoised (same string back)');

/* ---- Montage ---- */
(function () {
  var M = Lab.MONTAGE, onCircle = true, i;
  assert(M.length === 19, '19 electrodes');
  for (i = 0; i < M.length; i++) if (Math.hypot(M[i].x, M[i].y) > 1 + 1e-3) onCircle = false;
  assert(onCircle, 'every electrode is inside the unit circle (coordinates rounded to 4 decimals)');
  assert(Object.keys(M[0]).join(',') === 'name,x,y', 'an entry is name, x, y and nothing else');
  assert(Lab.electrodeIndex('Cz') === 9 && Lab.electrodeIndex('cz') === 9 && Lab.electrodeIndex('Xx') === -1, 'electrodeIndex is case-insensitive, -1 when unknown');
  assert(near(M[Lab.electrodeIndex('Cz')].x, 0, 1e-9) && M[Lab.electrodeIndex('Fp1')].y > 0.9 && M[Lab.electrodeIndex('O2')].y < -0.9,
    'Cz at the vertex, Fp1 anterior, O2 posterior');
  assert(M[Lab.electrodeIndex('T3')].x < 0 && M[Lab.electrodeIndex('T4')].x > 0, 'odd numbers on the left, even on the right');
})();

/* ---- Small numeric helpers ---- */
assert(Lab.clamp(5, 0, 1) === 1 && Lab.clamp(-1, 0, 1) === 0 && Lab.clamp(0.5, 0, 1) === 0.5, 'clamp');
assert(Lab.easeOut(0) === 0 && Lab.easeOut(1) === 1 && Lab.easeOut(0.5) > 0.9, 'easeOut starts fast and settles');
assert(near(Lab.idw([1, 3], [{ x: 0, y: 0 }, { x: 2, y: 0 }], 1, 0), 2, 1e-12) && Lab.idw([1, 3], [{ x: 0, y: 0 }, { x: 2, y: 0 }], 0, 0) === 1,
  'idw interpolates, exact at a sample');
assert(typeof Lab.now() === 'number' && Lab.now() >= 0, 'now returns milliseconds');

summary('lab');
