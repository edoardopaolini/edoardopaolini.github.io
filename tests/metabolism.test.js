/* Model tests for assets/js/metabolism.js. Run from the repository root:
     jsc tests/metabolism.test.js
   (JavaScriptCore's jsc, or any engine with load() and print()). */
var window = this;  /* bare engine: the modules attach to window */
load('tests/harness.js');
load('assets/js/lab.js'); load('assets/js/metabolism.js');

var M = window.__metabolismModel;
function flux(res, id) { return res.flux[M.RIDX[id]]; }
function pool(res, id) { return res.pool[M.INDEX[id]]; }
function drain(res, id) { return res.drains[M.DIDX[id]]; }
function n(v) { return Math.round(v * 1000) / 1000; }

var WT = M.WT;

/* ---- module shape ---- */
assert(!!M && typeof window.__metabolism === 'undefined', 'model exported, DOM part skipped without document');
assert(M.METABOLITES.length === 18 && M.REACTIONS.length === 20 && M.DRAINS.length === 5 && M.INPUTS.length === 3,
  '18 metabolites, 20 reactions, 5 drains, 3 nutrient inputs');
assert(M.KEYS.length === 5 && M.KEYS.join(',') === 'icl,pcl,sdh,cs,icd', 'five perturbations, in the order of the controls (the order of PERTURBATIONS)');
(function () {
  var ok = true;
  M.KEYS.forEach(function (k) {
    var p = M.PERTURBATIONS[k];
    if (!p || !p.enzymes.length || p.scale < 0 || p.scale >= 1) ok = false;
    p.enzymes.forEach(function (id) { if (M.RIDX[id] === undefined) ok = false; });
  });
  assert(ok, 'every perturbation names reactions of the model and scales them below wild type');
})();
assert(M.PERTURBATIONS.icl.enzymes.join(',') === 'ICL,MCL' && M.PERTURBATIONS.icl.scale === 0,
  '3-nitropropionate blocks the two lyases, ICL1/2 and MCL');

/* ---- wild type ---- */
assert(Math.abs(WT.conservation - 1) < 0.01,
  'wild type conserves carbon within 1 percent (in ' + n(WT.input) + ', out ' + n(WT.output) + ', conservation ' + n(WT.conservation) + ')');
assert(WT.stranded < 1e-3, 'nothing accumulates at wild type (stranded ' + n(WT.stranded) + ')');
(function () {
  var dead = [];
  M.REACTIONS.forEach(function (r, i) { if (WT.flux[i] <= 1e-6) dead.push(r.id); });
  assert(dead.length === 0, 'every reaction carries flux at wild type' + (dead.length ? ' (' + dead.join(', ') + ' do not)' : ''));
})();
(function () {
  var dry = [];
  M.DRAINS.forEach(function (d, i) { if (WT.drains[i] <= 1e-6) dry.push(d.id); });
  assert(dry.length === 0, 'every exit carries carbon at wild type' + (dry.length ? ' (' + dry.join(', ') + ' do not)' : ''));
})();
assert(WT.residual < M.TOL && WT.sweeps < M.MAX_SWEEPS, 'the sweeps converge below the tolerance (' + WT.sweeps + ' sweeps, residual ' + WT.residual.toExponential(1) + ')');
(function () {
  /* Every pool balances: what comes in leaves as flux, co-substrate use, drains or accumulation. */
  var worst = 0;
  for (var m = 0; m < M.METABOLITES.length; m++) {
    var out = WT.pool[m], k;
    for (k = 0; k < M.REACTIONS.length; k++) {
      if (M.REACTIONS[k].fromIdx === m) out += WT.flux[k];
      if (M.REACTIONS[k].coIdx === m) out += WT.coFlux[k];
    }
    for (k = 0; k < M.DRAINS.length; k++) if (M.DRAINS[k].fromIdx === m) out += WT.drains[k];
    worst = Math.max(worst, Math.abs(out - WT.inflow[m]) / Math.max(1, WT.inflow[m]));
  }
  assert(worst < 0.01, 'every metabolite balances its inflow within 1 percent (worst ' + n(worst * 100) + ' percent)');
})();

/* ---- perturbations ---- */
var icl = M.solve('icl');
assert(flux(icl, 'ICD') > flux(WT, 'ICD') && icl.co2 > WT.co2,
  'icl sends the carbon back to the decarboxylating branch: ICD ' + n(flux(WT, 'ICD')) + ' to ' + n(flux(icl, 'ICD')) + ', CO2 ' + n(WT.co2) + ' to ' + n(icl.co2));
assert(flux(icl, 'MS') === 0 && flux(icl, 'ICL') === 0 && flux(icl, 'MCL') === 0,
  'icl zeroes the glyoxylate shunt (ICL1/2 and MS) and methylisocitrate lyase');
assert(M.summary(icl).shunt === -100, 'the icl readout reports the shunt at -100 percent');

var pcl = M.solve('pcl');
assert(flux(pcl, 'MCE') === 0 && flux(pcl, 'MCM') === 0, 'pcl zeroes MCE and MCM flux');
assert(pool(pcl, 'PPC') > 0.1 * pcl.input, 'pcl accumulates propionyl-CoA (' + n(pool(pcl, 'PPC')) + ' of ' + n(pcl.input) + ' carbon in)');
assert(drain(pcl, 'lipids') === 0 && M.summary(pcl).lipids === -100, 'pcl stops the PDIM and SL-1 output');
assert(flux(pcl, 'MCS') > flux(WT, 'MCS'), 'pcl pushes propionyl-CoA into the methylcitrate cycle: MCS ' + n(flux(WT, 'MCS')) + ' to ' + n(flux(pcl, 'MCS')));

var sdh = M.solve('sdh');
assert(M.summary(sdh).key === 'sdh' && M.summary(WT).key === null, 'a summary carries the key of its result');
assert(pool(sdh, 'SUC') > 0.05 * sdh.input, 'sdh accumulates succinate (' + n(pool(sdh, 'SUC')) + ')');
assert(flux(sdh, 'FUM') < 0.1 * flux(WT, 'FUM'), 'sdh cuts the flux through fumarase: ' + n(flux(WT, 'FUM')) + ' to ' + n(flux(sdh, 'FUM')));
assert(flux(sdh, 'ScAS') > 0 && flux(sdh, 'MCM') > 0, 'sdh leaves the methylmalonyl route feeding succinyl-CoA');
assert(M.summary(pcl).pools.join(',') === 'PPC' && M.summary(sdh).pools.join(',') === 'SUC', 'the readout lists the pools above ' + M.POOL_LABEL * 100 + ' percent of the input: PPC for pcl, SUC for sdh');

var cs = M.solve('cs');
assert(flux(cs, 'MCS') > flux(WT, 'MCS'), 'cs moves oxaloacetate into the methylcitrate cycle: MCS ' + n(flux(WT, 'MCS')) + ' to ' + n(flux(cs, 'MCS')));
assert(flux(cs, 'CS') < flux(WT, 'CS') && cs.co2 < WT.co2, 'cs slows the cycle and lowers CO2 (' + n(WT.co2) + ' to ' + n(cs.co2) + ')');

var icd = M.solve('icd');
assert(flux(icd, 'ICL') > flux(WT, 'ICL') && icd.co2 < WT.co2,
  'icd sends isocitrate through the shunt and lowers CO2: ICL ' + n(flux(WT, 'ICL')) + ' to ' + n(flux(icd, 'ICL')) + ', CO2 ' + n(WT.co2) + ' to ' + n(icd.co2));
assert(flux(icd, 'ICD') < flux(WT, 'ICD'), 'icd throttles isocitrate dehydrogenase itself');

(function () {
  var ok = true;
  M.KEYS.forEach(function (k) {
    var s = M.solve(k);
    if (Math.abs(s.input - (s.output + s.stranded)) > 0.01 * s.input) ok = false;
    if (s.sweeps >= M.MAX_SWEEPS) ok = false;
  });
  assert(ok, 'every perturbation conserves carbon within 1 percent and converges');
})();

/* ---- restore ---- */
(function () {
  var again = M.solve(null), same = true, i;
  for (i = 0; i < M.REACTIONS.length; i++) if (again.flux[i] !== WT.flux[i]) same = false;
  for (i = 0; i < M.DRAINS.length; i++) if (again.drains[i] !== WT.drains[i]) same = false;
  assert(same && again.co2 === WT.co2, 'restore returns to the wild type exactly');
  var s = M.summary(WT);
  assert(s.shunt === 0 && s.co2 === 0 && s.lipids === 0 && s.pools.length === 0, 'the wild-type summary reports no change and no accumulation');
})();

/* ---- readout templates ---- */
assert(M.signed(12) === '+12%' && M.signed(-25) === '-25%' && M.signed(0) === '0%', 'percentages carry their sign');
assert(M.poolSentence('Falls ({co2}). What piles up: {pool}.', ['succinate', 'malate'], 'Nothing piles up.') === 'Falls ({co2}). What piles up: succinate, malate.',
  'poolSentence lists the pools in place of {pool}');
assert(M.poolSentence('Falls ({co2}). What piles up: {pool}.', [], 'Nothing piles up.') === 'Falls ({co2}). Nothing piles up.',
  'with no pool the sentence holding {pool} becomes the nopool sentence');
assert(M.poolSentence('A. B: {pool}. C.', [], 'N.') === 'A. N. C.' && M.poolSentence('Si accumula: {pool}.', [], 'Niente.') === 'Niente.',
  'the replacement keeps the sentences around it, at the start too');

/* ---- layout ---- */
assert(M.tier(1200) === 0 && M.tier(900) === 0 && M.tier(899) === 1 && M.tier(600) === 1 && M.tier(599) === 2 && M.tier(420) === 2 && M.tier(419) === 3,
  'four tiers: wide from 900, medium from 600, compact from ' + M.PHONE_W + ', phone below');
[[1200, 750], [900, 563], [600, 450], [390, 470], [360, 450]].forEach(function (size) {
  var lay = M.layout(size[0], size[1]);
  var over = M.overlaps(lay), out = M.outside(lay);
  assert(over.length === 0 && out.length === 0,
    'no label overlaps or leaves the frame at ' + size[0] + 'x' + size[1] +
    (over.length ? ' (' + over[0].join(' over ') + ')' : '') + (out.length ? ' (outside: ' + out[0] + ')' : ''));
});
(function () {
  var wide = M.layout(1200, 750), narrow = M.layout(360, 450), i, shorter = true;
  for (i = 0; i < M.METABOLITES.length; i++) {
    if (narrow.nodes[i].text !== M.METABOLITES[i].abbr) shorter = false;
  }
  assert(shorter && wide.nodes[M.INDEX.OAA].text === 'Oxaloacetate', 'narrow frames use the thesis abbreviations, wide frames the names');
  var hits = 0, phoneHits = 0;
  M.KEYS.forEach(function (k) { if (wide.hits[k] && wide.hits[k].w > 0) hits++; if (narrow.hits[k] && narrow.hits[k].w > 0) phoneHits++; });
  assert(hits === 5 && phoneHits === 5, 'every perturbation has a pressable enzyme label in the figure, on phones too');
  var enzymes = narrow.labels.filter(function (b) { return b.kind === 'enzyme'; });
  assert(narrow.phone && enzymes.length > 0 && enzymes.every(function (b) { return !!M.REACTIONS[b.ref].key; }),
    'phones draw only the pressable enzyme labels (' + enzymes.length + ' of ' + M.REACTIONS.length + ')');
  assert(narrow.labels.every(function (b) { return b.px >= 11; }) && M.layout(599, 450).labels.every(function (b) { return b.px >= 11; }),
    'no label under 11 px on compact frames');
  var it = M.layout(1200, 750, null, function (path, fallback) { return path === 'names.OAA' ? 'Ossalacetato' : path === 'co2' ? 'CO2' : fallback; });
  assert(it.nodes[M.INDEX.OAA].text === 'Ossalacetato' && it.nodes[M.INDEX.PYR].text === 'Pyruvate', 'the page language overrides a label, the model name is the fallback');
})();
(function () {
  var lay = M.layout(1200, 750), ok = true, i;
  for (i = 0; i < lay.curves.length; i++) {
    var cv = lay.curves[i], j, worst = 0, best = Infinity;
    for (j = 1; j < cv.xs.length; j++) {
      var d = Math.hypot(cv.xs[j] - cv.xs[j - 1], cv.ys[j] - cv.ys[j - 1]);
      if (d > worst) worst = d;
      if (d < best) best = d;
    }
    if (cv.length > 1 && (worst - best) / worst > 0.25) ok = false;
  }
  assert(ok, 'the curve tables are sampled at equal arc length, so the particles keep a steady pace');
})();

summary('metabolism');
