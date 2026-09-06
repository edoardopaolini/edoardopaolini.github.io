/* Metabolism: the central carbon metabolism of Mycobacterium tuberculosis as a live flux network (home page,
   section #cell). A toy push-flow model on the reaction graph of the master's thesis (Singh et al. TCA cycle and
   glyoxylate shunt, extended with the methylcitrate cycle, the methylmalonyl pathway and the nutrient inputs), not
   the kinetic model itself. The pure model (window.__metabolismModel) loads in a bare engine; the DOM part below
   draws it on #met-canvas and wires the perturbation buttons. */
(function () {
  'use strict';

  var Lab = window.Lab;

  /* Solver: proportional push-flow with back-pressure, swept until the largest change is below TOL. */
  var TOL = 1e-4;              /* convergence: largest change of a flux or an acceptance within one sweep */
  var MAX_SWEEPS = 400;        /* sweeps before giving up (the tests check the solver stops well before) */
  var RELAX = 0.6;             /* damping of a flux update in the split of a pool */
  var BP_GAIN = 0.35;          /* damping of the acceptance (back-pressure) update per sweep */
  var WARM_START = 0.05;       /* every reaction starts at this fraction of its capacity (see solve) */
  var PRESSURE_MAX = 2;        /* cap of the mass-action factor of a second substrate */
  var PRESSURE_GAIN = 0.15;    /* damping of the pressure factors per sweep */
  var EPS = 1e-9;              /* guard against a vanishing flux in a division */
  /* Below this the flux is the tail of a branch that is dying, not a branch that runs: two orders of magnitude
     under the smallest wild-type flux. It is dropped so a blocked route reads as stopped, not as almost stopped. */
  var FLOOR = 1e-3;
  /* Rendering. Text sizes and node radii per breakpoint (canvas width): wide, medium, compact (thesis
     abbreviations for the metabolites) and phone (compact, no label under 11 px, only the pressable enzyme
     labels are drawn). */
  var WIDE_W = 900, COMPACT_W = 600, PHONE_W = 420;
  var NODE_PX = [5.5, 4.75, 4, 4], LABEL_PX = [13, 12, 11, 11], ENZ_PX = [11, 10, 11, 11];
  var CHAR_W_MONO = 0.6, CHAR_W_BODY = 0.52;   /* advance widths used when no canvas can measure text */
  var RESAMPLE = 32, FINE = 96;                 /* points per curve at equal arc length, and the fine table behind them */
  var MAX_PARTICLES = 14, PARTICLE_R = 1.9;
  var SPEED_MIN = 10, SPEED_K = 42;             /* px per second at zero flux and per unit of the reference flux */
  var SPACING_MIN = 22, SPACING_MAX = 120;      /* px between particles at reference flux and at almost none */
  var WIDTH_MIN = 1, WIDTH_MAX = 4;
  var FAINT_FLUX = 0.004;                       /* fraction of the reference flux under which an edge is a hairline without particles */
  var SWELL_MAX = 1.8;
  /* A pool counts as accumulating once it holds this fraction of the carbon coming in (the disc and the label
     turn accent, the readout lists it), and is drawn at full swell at POOL_FULL: below the first the network is
     only rebalancing, not backing up. */
  var POOL_LABEL = 0.02, POOL_FULL = 0.09;
  var SMOOTH_MS = 320;                          /* time constant of the width and swell transitions */
  var MAX_FRAME_MS = 100, FIRST_FRAME_MS = 16;  /* frame time clamp (a hidden tab must not jump) and the first frame */
  var PHASE_SEED = 20260905;                    /* particle phases along the curves */
  var ARROW = 6;
  var LABEL_WEIGHT = 500;

  /* ---------------------------------------------------------------------
     Network. Positions are relative (0 to 1) inside a small inset of the frame and mirror the owner's summary
     figure of the pathway: inputs at the top, pyruvate and the two CoA pools in the middle, the TCA cycle as a large
     loop at centre-right with the glyoxylate shunt as an inner chord, the methylcitrate cycle as an outer loop on the
     left sharing succinate and pyruvate, the methylmalonyl pathway as a right-hand column into succinyl-CoA.
     Abbreviations are the ones of the thesis tables.
     --------------------------------------------------------------------- */
  var RING = { cx: 0.505, cy: 0.655, rx: 0.2, ry: 0.235 };
  function onRing(deg) {
    var a = deg * Math.PI / 180;
    return [RING.cx + RING.rx * Math.cos(a), RING.cy + RING.ry * Math.sin(a), deg];
  }
  /* name: wide frames (a newline breaks the three longest); mid: 600 to 900 px (thesis abbreviations for names
     longer than 13 characters, the same in every language); abbr: below 600 px. lp: label position, align: text
     alignment at lp. The names are the English of the model; the page passes its own language to layout(). */
  var METABOLITES = [
    { id: 'PYR', name: 'Pyruvate', mid: 'Pyruvate', abbr: 'PYR', p: [0.40, 0.19], lp: [0.414, 0.19], align: 'left' },
    { id: 'ACA', name: 'Acetyl-CoA', mid: 'Acetyl-CoA', abbr: 'ACA', p: [0.40, 0.345], lp: [0.414, 0.345], align: 'left' },
    { id: 'PPC', name: 'Propionyl-CoA', mid: 'Propionyl-CoA', abbr: 'PPC', p: [0.66, 0.345], lp: [0.674, 0.345], align: 'left' },
    { id: 'CIT', name: 'Citrate', mid: 'Citrate', abbr: 'CIT', p: onRing(-62), lp: [0.613, 0.437], align: 'left' },
    { id: 'ICIT', name: 'Isocitrate', mid: 'Isocitrate', abbr: 'ICIT', p: onRing(-5), lp: [0.718, 0.63], align: 'left' },
    { id: 'AKG', name: 'alpha-\nketoglutarate', mid: 'AKG', abbr: 'AKG', p: onRing(48), lp: [0.668, 0.822], align: 'left' },
    { id: 'SSA', name: 'Succinic\nsemialdehyde', mid: 'SSA', abbr: 'SSA', p: onRing(90), lp: [0.552, 0.949], align: 'center' },
    { id: 'SCA', name: 'Succinyl-CoA', mid: 'Succinyl-CoA', abbr: 'SCA', p: [0.555, 0.775], lp: [0.548, 0.745], align: 'center' },
    { id: 'SUC', name: 'Succinate', mid: 'Succinate', abbr: 'SUC', p: onRing(128), lp: [0.368, 0.845], align: 'right' },
    { id: 'FA', name: 'Fumarate', mid: 'Fumarate', abbr: 'FA', p: onRing(160), lp: [0.303, 0.735], align: 'right' },
    { id: 'MAL', name: 'Malate', mid: 'Malate', abbr: 'MAL', p: onRing(197), lp: [0.305, 0.548], align: 'center' },
    { id: 'OAA', name: 'Oxaloacetate', mid: 'Oxaloacetate', abbr: 'OAA', p: onRing(238), lp: [0.413, 0.462], align: 'left' },
    { id: 'GLY', name: 'Glyoxylate', mid: 'Glyoxylate', abbr: 'GLY', p: [0.455, 0.655], lp: [0.455, 0.622], align: 'center' },
    { id: 'MCT', name: 'Methylcitrate', mid: 'Methylcitrate', abbr: 'MCT', p: [0.185, 0.445], lp: [0.185, 0.41], align: 'center' },
    { id: 'MCA', name: 'Methyl-cis-\naconitate', mid: 'MCA', abbr: 'MCA', p: [0.10, 0.63], lp: [0.115, 0.63], align: 'left' },
    { id: 'MIC', name: 'Methylisocitrate', mid: 'MIC', abbr: 'MIC', p: [0.25, 0.955], lp: [0.235, 0.982], align: 'center' },
    { id: 'SMC', name: '(S)-methylmalonyl-CoA', mid: 'SMC', abbr: 'SMC', p: [0.86, 0.50], lp: [0.86, 0.545], align: 'center' },
    { id: 'RMC', name: '(R)-methylmalonyl-CoA', mid: 'RMC', abbr: 'RMC', p: [0.86, 0.70], lp: [0.86, 0.662], align: 'center' }
  ];
  var M = METABOLITES.length, INDEX = {};
  METABOLITES.forEach(function (m, i) { INDEX[m.id] = i; });

  /* Nutrient inputs as fixed carbon supplies (Table 3.9 of the thesis, rebalanced so all three read on screen):
     glycolysis ends in pyruvate; beta-oxidation gives acetyl-CoA and, from odd chains, propionyl-CoA; cholesterol
     mostly propionyl-CoA with some acetyl-CoA and pyruvate. Each target gets its own curve; the source label
     carries the name and, on wide frames, the pathway. */
  var INPUTS = [
    { id: 'glucose', name: 'Glucose', pathway: 'glycolysis', p: [0.40, 0.09], outs: [{ to: 'PYR', c: 6.0, c1: [0.40, 0.12], c2: [0.40, 0.16] }] },
    { id: 'fatty', name: 'Fatty acids', pathway: 'beta-oxidation', p: [0.60, 0.09], outs: [
      { to: 'ACA', c: 2.4, c1: [0.60, 0.20], c2: [0.44, 0.25] },
      { to: 'PPC', c: 0.6, c1: [0.615, 0.20], c2: [0.64, 0.29] }
    ] },
    { id: 'chol', name: 'Cholesterol', pathway: 'cholesterol catabolism', p: [0.815, 0.09], outs: [
      { to: 'PPC', c: 3.0, c1: [0.815, 0.20], c2: [0.71, 0.29] },
      { to: 'ACA', c: 1.2, c1: [0.72, 0.19], c2: [0.47, 0.25] },
      { to: 'PYR', c: 0.8, c1: [0.68, 0.09], c2: [0.43, 0.10] }
    ] }
  ];

  /* Reactions. w: split weight (kinetic preference where a pool has several outlets), cap: maximum carbon flux
     (the role Vmax plays in the thesis). outs: the products with the fraction of the substrate carbon each
     receives; the remainder leaves as CO2 (pyruvate dehydrogenase C3 to C2, ICD C6 to C5, KGD C5 to C4).
     co: the second substrate of a two-substrate reaction, with the carbon ratio and its own weight in that pool
     (citrate is 2 carbons of acetyl-CoA plus 4 of oxaloacetate, methylcitrate 3 of propionyl-CoA plus 4 of
     oxaloacetate, malate 2 of glyoxylate plus 2 of acetyl-CoA), drawn as a second edge into the product. The
     co-substrate rations the reaction, which is what makes the thesis result reappear: when CS is downregulated
     it stops competing for oxaloacetate and the methylcitrate cycle picks it up.
     KDH is absent in M. tuberculosis: alpha-ketoglutarate reaches succinate through KGD and SSADH, and
     succinyl-CoA is fed only by the methylmalonyl pathway (thesis Table 4.4). Geometry: c1, c2 control points,
     ring: true for elliptical arcs of the TCA cycle, lp: label position, via: draw from another node; lpp and
     alignp: label position and alignment on phones, where the frame is too small for the label to clear its
     own curve at lp. */
  var REACTIONS = [
    { id: 'PYD', label: 'PYD/DLA', from: 'PYR', w: 12, cap: 16, key: null,
      outs: [{ to: 'ACA', f: 2 / 3, c1: [0.40, 0.24], c2: [0.40, 0.29] }], lp: [0.386, 0.275], align: 'right' },
    { id: 'CS', label: 'CS', from: 'ACA', w: 5, cap: 4.5, key: 'cs',
      co: { from: 'OAA', ratio: 2, w: 9, c1: [0.465, 0.505], c2: [0.565, 0.492] },
      outs: [{ to: 'CIT', f: 1, c1: [0.48, 0.345], c2: [0.545, 0.39] }], lp: [0.556, 0.365], align: 'left' },
    { id: 'ACN', label: 'ACN', from: 'CIT', w: 12, cap: 16, key: null,
      outs: [{ to: 'ICIT', f: 1, ring: true }], lp: [0.70, 0.515], align: 'left' },
    { id: 'ICD', label: 'ICD1/2', from: 'ICIT', w: 9, cap: 14, key: 'icd',
      outs: [{ to: 'AKG', f: 5 / 6, ring: true }], lp: [0.665, 0.705], align: 'right' },
    { id: 'KGD', label: 'KGD', from: 'AKG', w: 8, cap: 14, key: null,
      outs: [{ to: 'SSA', f: 4 / 5, ring: true }], lp: [0.61, 0.905], align: 'center' },
    { id: 'SSADH', label: 'SSADH', from: 'SSA', w: 10, cap: 16, key: null,
      outs: [{ to: 'SUC', f: 1, ring: true }], lp: [0.415, 0.905], align: 'center' },
    { id: 'ScAS', label: 'ScAS', from: 'SCA', w: 4, cap: 6, key: null,
      outs: [{ to: 'SUC', f: 1, c1: [0.52, 0.83], c2: [0.45, 0.855] }], lp: [0.50, 0.85], align: 'center' },
    { id: 'SDH', label: 'SDH', from: 'SUC', w: 10, cap: 16, key: 'sdh',
      outs: [{ to: 'FA', f: 1, ring: true }], lp: [0.32, 0.80], align: 'right' },
    { id: 'FUM', label: 'FUM', from: 'FA', w: 10, cap: 16, key: null,
      outs: [{ to: 'MAL', f: 1, ring: true }], lp: [0.29, 0.665], align: 'right' },
    { id: 'MDH', label: 'MDH', from: 'MAL', w: 10, cap: 20, key: null,
      outs: [{ to: 'OAA', f: 1, ring: true }], lp: [0.372, 0.528], align: 'left' },
    { id: 'ICL', label: 'ICL1/2', from: 'ICIT', w: 6, cap: 12, key: 'icl',
      outs: [
        { to: 'GLY', f: 1 / 3, c1: [0.63, 0.66], c2: [0.55, 0.66] },
        { to: 'SUC', f: 2 / 3, via: 'GLY', c1: [0.44, 0.73], c2: [0.42, 0.80] }
      ], lp: [0.575, 0.635], align: 'center' },
    { id: 'MS', label: 'MS', from: 'GLY', w: 6, cap: 12, key: null,
      co: { from: 'ACA', ratio: 1, w: 3, c1: [0.395, 0.44], c2: [0.35, 0.55] },
      outs: [{ to: 'MAL', f: 1, c1: [0.40, 0.655], c2: [0.35, 0.615] }], lp: [0.375, 0.665], align: 'center' },
    { id: 'MCS', label: 'MCS', from: 'PPC', w: 0.8, cap: 4, key: null,
      co: { from: 'OAA', ratio: 4 / 3, w: 1.6, c1: [0.36, 0.45], c2: [0.25, 0.47] },
      outs: [{ to: 'MCT', f: 1, c1: [0.56, 0.42], c2: [0.30, 0.395] }], lp: [0.27, 0.375], align: 'center' },
    { id: 'MCD', label: 'MCD', from: 'MCT', w: 8, cap: 10, key: null,
      outs: [{ to: 'MCA', f: 1, c1: [0.125, 0.47], c2: [0.10, 0.55] }], lp: [0.13, 0.535], align: 'left' },
    { id: 'MICD', label: 'MICD', from: 'MCA', w: 8, cap: 10, key: null,
      outs: [{ to: 'MIC', f: 1, c1: [0.10, 0.75], c2: [0.22, 0.86] }], lp: [0.13, 0.775], align: 'left' },
    { id: 'MCL', label: 'MCL', from: 'MIC', w: 8, cap: 10, key: 'icl',
      outs: [
        { to: 'SUC', f: 4 / 7, c1: [0.30, 0.95], c2: [0.35, 0.87] },
        { to: 'PYR', f: 3 / 7, c1: [-0.12, 0.90], c2: [-0.01, 0.12] }
      ], lp: [0.30, 0.90], align: 'right' },
    { id: 'PCL', label: 'PCL', from: 'PPC', w: 3.8, cap: 4, key: 'pcl',
      outs: [{ to: 'SMC', f: 1, c1: [0.74, 0.38], c2: [0.86, 0.41] }], lp: [0.775, 0.42], align: 'left',
      lpp: [0.80, 0.36], alignp: 'left' },
    { id: 'MCE', label: 'MCE', from: 'SMC', w: 6, cap: 8, key: null,
      outs: [{ to: 'RMC', f: 1, c1: [0.86, 0.57], c2: [0.86, 0.63] }], lp: [0.872, 0.60], align: 'left' },
    { id: 'MCM', label: 'MCM', from: 'RMC', w: 1.5, cap: 2.5, key: null,
      outs: [{ to: 'SCA', f: 1, c1: [0.83, 0.78], c2: [0.68, 0.80] }], lp: [0.75, 0.745], align: 'center' },
    /* The oxaloacetate to pyruvate term of the thesis (Table 3.9). Small on purpose: it is what lets the carbon
       the glyoxylate shunt adds to the loop leave it, so the cycle turns without filling up. Unlabelled, because
       the thesis models it as a term and not as a named enzyme. */
    { id: 'OAAPYR', label: '', from: 'OAA', w: 0.9, cap: 1, key: null,
      outs: [{ to: 'PYR', f: 3 / 4, c1: [0.435, 0.40], c2: [0.425, 0.27] }] }
  ];
  var R = REACTIONS.length;
  REACTIONS.forEach(function (r) {
    r.fromIdx = INDEX[r.from];
    r.keep = 0;
    r.outs.forEach(function (o) { o.toIdx = INDEX[o.to]; r.keep += o.f; });
    r.coIdx = r.co ? INDEX[r.co.from] : -1;
    /* Carbon balance of a two-substrate reaction: the co-substrate carbon is kept in full, so only the substrate
       fractions can leave as CO2 (none of the three two-substrate reactions here decarboxylates). */
    if (r.coIdx >= 0) r.keep = 1;
  });
  var RIDX = {};
  REACTIONS.forEach(function (r, i) { RIDX[r.id] = i; });

  /* Drains: where carbon leaves. CO2 is the carbon the decarboxylations do not keep (drawn at the reaction);
     biomass from acetyl-CoA (fatty acid and mycolic acid synthesis, the large sink of the thesis), from
     oxaloacetate (the aspartate family) and from alpha-ketoglutarate (precursor); succinate release (hypoxia);
     virulence lipids PDIM and SL-1 from the methylmalonyl-CoA pool.
     The oxaloacetate exit is an overflow: it takes only what the pool cannot push forward, which is how the
     carbon the glyoxylate shunt adds to the loop leaves without passing through the decarboxylations the shunt
     exists to avoid. A drain with a fixed share would tax the loop even when it is starving and no perturbation
     could ever be survived. tip: where the short curved arrow ends; lpp: label position on phones. */
  var DRAINS = [
    { id: 'bioA', label: 'Biomass', from: 'ACA', w: 9, cap: 12,
      c1: [0.36, 0.345], c2: [0.32, 0.325], tip: [0.30, 0.31], lp: [0.29, 0.31], align: 'right' },
    { id: 'bioO', label: 'Biomass', from: 'OAA', w: 0, cap: 5, overflow: true,
      c1: [0.383, 0.475], c2: [0.36, 0.495], tip: [0.335, 0.505], lp: [0.325, 0.507], align: 'right' },
    { id: 'bioK', label: 'Biomass', from: 'AKG', w: 1.2, cap: 2,
      c1: [0.655, 0.87], c2: [0.675, 0.895], tip: [0.69, 0.915], lp: [0.70, 0.92], align: 'left' },
    { id: 'sucOut', label: 'Succinate out', short: 'SUC out', from: 'SUC', w: 0.8, cap: 1.2,
      c1: [0.395, 0.881], c2: [0.408, 0.906], tip: [0.418, 0.932], lp: [0.428, 0.958], lpp: [0.40, 0.958], align: 'center' },
    { id: 'lipids', label: 'PDIM and SL-1', short: 'PDIM, SL-1', from: 'RMC', w: 1, cap: 2,
      c1: [0.90, 0.72], c2: [0.93, 0.745], tip: [0.955, 0.765], lp: [0.985, 0.80], align: 'right' }
  ];
  var D = DRAINS.length, DIDX = {};
  DRAINS.forEach(function (d, i) { d.fromIdx = INDEX[d.from]; DIDX[d.id] = i; });
  /* CO2 exits, drawn from the middle of the decarboxylating reaction to a tip, with the label beside the tip. */
  var CO2 = [
    { reaction: 'PYD', tip: [0.357, 0.232], lp: [0.348, 0.222], align: 'right' },
    { reaction: 'ICD', tip: [0.745, 0.705], lp: [0.755, 0.70], align: 'left' },
    { reaction: 'KGD', tip: [0.575, 0.835], lp: [0.578, 0.815], align: 'center' }
  ];

  /* Perturbations of chapter 5 of the thesis. scale multiplies the weight and the capacity of the enzymes. */
  var PERTURBATIONS = {
    icl: { enzymes: ['ICL', 'MCL'], scale: 0 },      /* 3-nitropropionate: isocitrate lyase and methylisocitrate lyase */
    pcl: { enzymes: ['PCL'], scale: 0 },             /* propionyl-CoA carboxylase, entry of the methylmalonyl pathway */
    sdh: { enzymes: ['SDH'], scale: 0 },             /* succinate dehydrogenase, lethal in the thesis */
    cs: { enzymes: ['CS'], scale: 0.25 },            /* citrate synthase downregulated */
    icd: { enzymes: ['ICD'], scale: 0.15 }           /* ICD1 and ICD2 phosphorylated under stress */
  };
  /* Insertion order, which is the order of the control pills and of the tests. */
  var KEYS = Object.keys(PERTURBATIONS);

  /* ---------------------------------------------------------------------
     Solver. Every pool splits its inflow across its outlets (reactions leaving it, drains, and the co-substrate
     claims of two-substrate reactions elsewhere) in proportion to weight; no outlet takes more than its capacity,
     the excess is re-split among the others and what has nowhere to go is stranded, which is the pool
     accumulating. A co-substrate claim is a ration, not a consumption: it caps the reaction, and the reaction
     consumes only what it carries. Acceptance is the fraction of its inflow a pool disposes of, damped by BP_GAIN
     per sweep; a reaction is weighted and capped by the acceptance of its products, so a full pool slows what
     feeds it and the pressure walks upstream to the nearest branch with a free outlet (product inhibition).
     Gauss-Seidel sweeps in the order of METABOLITES with RELAX damping until the largest change is below TOL.
     --------------------------------------------------------------------- */
  function solve(key) {
    var pert = key ? PERTURBATIONS[key] : null;
    var wgt = new Float64Array(R), cap = new Float64Array(R), i, k, m;
    for (k = 0; k < R; k++) {
      var sc = pert && pert.enzymes.indexOf(REACTIONS[k].id) >= 0 ? pert.scale : 1;
      wgt[k] = REACTIONS[k].w * sc; cap[k] = REACTIONS[k].cap * sc;
    }
    /* State: f reaction flux, coFlux second-substrate consumption, ration the co-substrate a reaction may claim,
       cow the weight of that claim, dr drain flux, pSub and pCo the two mass-action factors of a two-substrate
       reaction; per pool the fixed supply, the inflow, the stranded carbon and the acceptance. */
    var f = new Float64Array(R), coFlux = new Float64Array(R), ration = new Float64Array(R), cow = new Float64Array(R), dr = new Float64Array(D);
    var pSub = new Float64Array(R), pCo = new Float64Array(R);
    var supply = new Float64Array(M), inflow = new Float64Array(M), stranded = new Float64Array(M), accept = new Float64Array(M);
    /* Topology per pool: reactions leaving it, plain drains, overflow drains, co-substrate claims on it and the
       reaction products feeding it. */
    var outR = [], outD = [], outO = [], outC = [], inR = [];
    for (m = 0; m < M; m++) { outR.push([]); outD.push([]); outO.push([]); outC.push([]); inR.push([]); accept[m] = 1; }
    INPUTS.forEach(function (inp) { inp.outs.forEach(function (o) { supply[INDEX[o.to]] += o.c; }); });
    for (k = 0; k < R; k++) {
      if (wgt[k] > 0) outR[REACTIONS[k].fromIdx].push(k);
      for (i = 0; i < REACTIONS[k].outs.length; i++) inR[REACTIONS[k].outs[i].toIdx].push([k, i]);
      pSub[k] = 1; pCo[k] = 1;
      if (REACTIONS[k].coIdx >= 0 && wgt[k] > 0) {
        outC[REACTIONS[k].coIdx].push(k);
        cow[k] = REACTIONS[k].co.w * (wgt[k] / REACTIONS[k].w);
        ration[k] = cap[k] * REACTIONS[k].co.ratio;
      }
    }
    for (k = 0; k < D; k++) (DRAINS[k].overflow ? outO : outD)[DRAINS[k].fromIdx].push(k);
    /* Warm start. The TCA cycle is a closed loop whose entry reaction needs oxaloacetate, which only the loop
       itself regenerates, so an all-zero start is a fixed point of the iteration. A small seed lets the loop spin
       up; where a perturbation really does stop a branch the sweeps drive it back to zero. */
    for (k = 0; k < R; k++) {
      f[k] = WARM_START * cap[k];
      if (REACTIONS[k].coIdx >= 0) coFlux[k] = f[k] * REACTIONS[k].co.ratio;
    }
    /* Acceptance of a reaction: the weighted acceptance of the pools it feeds. */
    function acc(r) {
      var outs = REACTIONS[r].outs, a = 0;
      for (var q = 0; q < outs.length; q++) a += outs[q].f * accept[outs[q].toIdx];
      return a / REACTIONS[r].keep;
    }
    /* Weight of a reaction in the split of its substrate pool: its own weight, damped by how well its products
       drain and lifted by how concentrated its second substrate is. */
    function ew(r) { return wgt[r] * acc(r) * pCo[r]; }
    /* Mass action on the second substrate. A pool that cannot dispose of its inflow is a concentrated pool, and
       a concentrated substrate drives the reaction that consumes it: this is what lets propionyl-CoA claim more
       oxaloacetate when PCL is blocked, and the methylcitrate cycle take the oxaloacetate and the propionyl-CoA
       that citrate synthase and PCL stop using. Smoothed across sweeps, or the claim and the acceptance it
       depends on chase each other and never settle. */
    function pressureOf(pool) {
      var a = accept[pool];
      if (a >= 1) return 1;
      var v = Math.sqrt(1 / a);
      return v < PRESSURE_MAX ? v : PRESSURE_MAX;
    }
    function relaxPressure() {
      for (var q = 0; q < R; q++) {
        if (REACTIONS[q].coIdx < 0) continue;
        pSub[q] += PRESSURE_GAIN * (pressureOf(REACTIONS[q].fromIdx) - pSub[q]);
        /* The second substrate lifts the reaction when more of it is on offer than the reaction consumes: the
           share of oxaloacetate citrate synthase stops claiming is what the methylcitrate cycle then runs on. */
        var slack = coFlux[q] > EPS ? ration[q] / coFlux[q] : PRESSURE_MAX;
        if (slack < 1) slack = 1; else if (slack > PRESSURE_MAX) slack = PRESSURE_MAX;
        pCo[q] += PRESSURE_GAIN * (slack - pCo[q]);
      }
    }
    var satR = new Uint8Array(R), satD = new Uint8Array(D), residual = 0, sweep;
    function noteChange(d) { if (d > residual) residual = d; }

    /* Inflow of a pool: its fixed supply plus the product fractions of the reactions feeding it. */
    function inflowOf(m) {
      var inn = supply[m];
      for (var j = 0; j < inR[m].length; j++) {
        var rk = inR[m][j][0], oi = inR[m][j][1];
        /* The co-substrate carbon joins the first product: citrate carries both acetyl-CoA and oxaloacetate. */
        inn += f[rk] * REACTIONS[rk].outs[oi].f + (oi === 0 ? coFlux[rk] : 0);
      }
      return inn;
    }
    /* Rationing: what share of this pool each two-substrate reaction may claim, from the weights of every
       outlet. It caps the reaction; the carbon itself is only spent when the reaction runs. */
    function rationPool(m, inn) {
      var claim = 0, r, j;
      for (j = 0; j < outR[m].length; j++) { r = outR[m][j]; claim += ew(r); }
      for (j = 0; j < outD[m].length; j++) claim += DRAINS[outD[m][j]].w;
      for (j = 0; j < outC[m].length; j++) { r = outC[m][j]; claim += cow[r] * acc(r) * pSub[r]; }
      for (j = 0; j < outC[m].length; j++) {
        r = outC[m][j];
        var want = claim > EPS ? inn * cow[r] * acc(r) * pSub[r] / claim : 0, ceil = cap[r] * acc(r) * REACTIONS[r].co.ratio;
        ration[r] = want < ceil ? want : ceil;
      }
    }
    /* Disposal: the co-substrate consumption is taken off the top (it was decided at the reaction), the rest is
       split among the reactions leaving this pool and its drains in proportion to weight; an outlet that would
       exceed its capacity is saturated and the remainder re-split among the others. Then the overflow exits take
       what is left, and only what remains after them is the pool accumulating. Returns that remainder. */
    function disposePool(m, inn) {
      var rest = inn, r, j, pass;
      for (j = 0; j < outC[m].length; j++) { r = outC[m][j]; rest -= coFlux[r] < rest ? coFlux[r] : rest; }
      for (j = 0; j < outR[m].length; j++) satR[outR[m][j]] = 0;
      for (j = 0; j < outD[m].length; j++) satD[outD[m][j]] = 0;
      for (pass = 0; pass < 16; pass++) {
        var sumW = 0, again = false, lim, share;
        for (j = 0; j < outR[m].length; j++) { r = outR[m][j]; if (!satR[r]) sumW += ew(r); }
        for (j = 0; j < outD[m].length; j++) { r = outD[m][j]; if (!satD[r]) sumW += DRAINS[r].w; }
        if (sumW <= EPS) break;
        for (j = 0; j < outD[m].length; j++) {
          r = outD[m][j];
          if (satD[r]) continue;
          share = rest * DRAINS[r].w / sumW;
          if (share > DRAINS[r].cap) { dr[r] = DRAINS[r].cap; satD[r] = 1; rest -= DRAINS[r].cap; again = true; }
          else dr[r] = share;
        }
        if (again) continue;
        for (j = 0; j < outR[m].length; j++) {
          r = outR[m][j];
          if (satR[r]) continue;
          lim = cap[r] * acc(r);
          if (REACTIONS[r].coIdx >= 0 && ration[r] / REACTIONS[r].co.ratio < lim) lim = ration[r] / REACTIONS[r].co.ratio;
          if (rest * ew(r) / sumW > lim + EPS) { satR[r] = 1; f[r] = lim; rest -= lim; again = true; }
        }
        if (again) continue;
        for (j = 0; j < outR[m].length; j++) {
          r = outR[m][j];
          if (satR[r]) continue;
          var target = rest * ew(r) / sumW, nv = f[r] + RELAX * (target - f[r]);
          noteChange(Math.abs(nv - f[r]));
          f[r] = nv;
        }
        /* The split allocated all of it: what the damping has not caught up with yet is not surplus. */
        rest = 0;
        break;
      }
      for (j = 0; j < outO[m].length; j++) {
        r = outO[m][j];
        dr[r] = rest > DRAINS[r].cap ? DRAINS[r].cap : rest > 0 ? rest : 0;
        rest -= dr[r];
      }
      return rest;
    }
    /* Acceptance: the fraction of its inflow the pool disposed of, damped. A pool that receives nothing gives no
       evidence and keeps its acceptance; resetting it would let the flux into a dead end resume, strand and be
       throttled again without ever converging. */
    function updateAcceptance(m, inn) {
      if (inn <= 1e-6) return;
      var na = accept[m] + BP_GAIN * (Math.max(1e-6, 1 - stranded[m] / inn) - accept[m]);
      noteChange(Math.abs(na - accept[m]));
      accept[m] = na;
    }
    /* The second-substrate consumption of the reactions leaving this pool follows their new flux. */
    function refreshCoFlux(m) {
      for (var j = 0; j < outR[m].length; j++) {
        var r = outR[m][j];
        if (REACTIONS[r].coIdx >= 0) coFlux[r] = f[r] * REACTIONS[r].co.ratio;
      }
    }
    /* Finalize: dying branches are dropped (their tail stays in the pool that fed them), the CO2 of the
       decarboxylations is counted and the carbon balance is drawn up. */
    function finalize() {
      var co2 = 0, co2At = new Float64Array(R), input = 0, output = 0, strandedTotal = 0, k, m;
      for (k = 0; k < R; k++) {
        if (wgt[k] <= 0 || f[k] < FLOOR) {
          stranded[REACTIONS[k].fromIdx] += f[k];
          if (REACTIONS[k].coIdx >= 0) stranded[REACTIONS[k].coIdx] += coFlux[k];
          f[k] = 0; coFlux[k] = 0;
        }
        co2At[k] = f[k] * (1 - REACTIONS[k].keep);
        co2 += co2At[k];
      }
      for (m = 0; m < M; m++) input += supply[m];
      for (k = 0; k < D; k++) {
        if (dr[k] < FLOOR) { stranded[DRAINS[k].fromIdx] += dr[k]; dr[k] = 0; }
        output += dr[k];
      }
      for (m = 0; m < M; m++) strandedTotal += stranded[m];
      return {
        key: key || null, flux: f, coFlux: coFlux, drains: dr, co2: co2, co2At: co2At, pool: stranded, inflow: inflow,
        input: input, output: output + co2, stranded: strandedTotal, sweeps: sweep + 1, residual: residual,
        conservation: (output + co2 + strandedTotal) / input
      };
    }

    for (sweep = 0; sweep < MAX_SWEEPS; sweep++) {
      residual = 0;
      for (m = 0; m < M; m++) {
        var inn = inflowOf(m);
        inflow[m] = inn;
        rationPool(m, inn);
        var rest = disposePool(m, inn);
        stranded[m] = rest > EPS ? rest : 0;
        updateAcceptance(m, inn);
        refreshCoFlux(m);
      }
      relaxPressure();
      if (residual < TOL) break;
    }
    return finalize();
  }
  var WT = solve(null);

  /* Percent change of a quantity against wild type, rounded to whole percent; 0 when the reference is 0. */
  function pct(v, ref) {
    if (ref < EPS) return 0;
    return Math.round((v - ref) / ref * 100);
  }
  /* The measured quantities the readouts need, from a solve() result. pools: metabolites accumulating more than
     POOL_LABEL of the total input (the same threshold that turns them accent on the canvas), largest first, at
     most three. */
  function summary(s) {
    var pools = [], m;
    var thr = POOL_LABEL * s.input;
    for (m = 0; m < M; m++) if (s.pool[m] > thr) pools.push(m);
    pools.sort(function (a, b) { return s.pool[b] - s.pool[a]; });
    return {
      key: s.key,
      shunt: pct(s.flux[RIDX.ICL], WT.flux[RIDX.ICL]),
      co2: pct(s.co2, WT.co2),
      lipids: pct(s.drains[DIDX.lipids], WT.drains[DIDX.lipids]),
      icd: pct(s.flux[RIDX.ICD], WT.flux[RIDX.ICD]),
      mcs: pct(s.flux[RIDX.MCS], WT.flux[RIDX.MCS]),
      pools: pools.slice(0, 3).map(function (i) { return METABOLITES[i].id; }),
      result: s
    };
  }

  /* ---------------------------------------------------------------------
     Geometry. Cubic Bezier curves resampled at equal arc length, so particles move at a uniform speed.
     --------------------------------------------------------------------- */
  function bez(p0, c1, c2, p3, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
  }
  /* Elliptical arc of the TCA ring between two angles (degrees, clockwise on screen) as one cubic. */
  function ringArc(a0, a1, sx, sy, ox, oy) {
    var t0 = a0 * Math.PI / 180, t1 = a1 * Math.PI / 180;
    var k = 4 / 3 * Math.tan((t1 - t0) / 4);
    var rx = RING.rx * sx, ry = RING.ry * sy, cx = ox + RING.cx * sx, cy = oy + RING.cy * sy;
    return {
      c1: [cx + rx * (Math.cos(t0) - k * Math.sin(t0)), cy + ry * (Math.sin(t0) + k * Math.cos(t0))],
      c2: [cx + rx * (Math.cos(t1) + k * Math.sin(t1)), cy + ry * (Math.sin(t1) - k * Math.cos(t1))]
    };
  }
  /* Trim a curve so it starts and ends outside the node discs: walk the fine table from both ends. */
  function resample(p0, c1, c2, p3, trimStart, trimEnd) {
    var fx = new Float64Array(FINE + 1), fy = new Float64Array(FINE + 1), cum = new Float64Array(FINE + 1), i;
    for (i = 0; i <= FINE; i++) { var q = bez(p0, c1, c2, p3, i / FINE); fx[i] = q[0]; fy[i] = q[1]; }
    for (i = 1; i <= FINE; i++) cum[i] = cum[i - 1] + Math.hypot(fx[i] - fx[i - 1], fy[i] - fy[i - 1]);
    var total = cum[FINE], s0 = Math.min(trimStart, total * 0.4), s1 = Math.max(total - trimEnd, total * 0.6);
    var xs = new Float32Array(RESAMPLE), ys = new Float32Array(RESAMPLE), j = 1;
    for (i = 0; i < RESAMPLE; i++) {
      var s = s0 + (s1 - s0) * i / (RESAMPLE - 1);
      while (j < FINE && cum[j] < s) j++;
      var seg = cum[j] - cum[j - 1], u = seg > 0 ? (s - cum[j - 1]) / seg : 0;
      xs[i] = fx[j - 1] + (fx[j] - fx[j - 1]) * u; ys[i] = fy[j - 1] + (fy[j] - fy[j - 1]) * u;
    }
    var mid = bez(p0, c1, c2, p3, 0.5), d1 = bez(p0, c1, c2, p3, 0.52), d0 = bez(p0, c1, c2, p3, 0.48);
    var tl = Math.hypot(d1[0] - d0[0], d1[1] - d0[1]) || 1;
    return { xs: xs, ys: ys, length: s1 - s0, mid: mid, tangent: [(d1[0] - d0[0]) / tl, (d1[1] - d0[1]) / tl] };
  }

  /* Default text measure when no canvas is available (tests, layout before fonts): mono and body advance widths. */
  function estimate(text, px, mono) {
    return text.length * px * (mono ? CHAR_W_MONO : CHAR_W_BODY);
  }
  function tier(w) { return w >= WIDE_W ? 0 : w >= COMPACT_W ? 1 : w >= PHONE_W ? 2 : 3; }

  /* Layout for a w x h canvas. Returns node positions, curves (with equal-arc-length tables), label boxes and the
     boxes of the pressable enzyme labels. measure(text, px, mono) -> width in px. Labels may hold two lines.
     say(path, fallback): label of the page language for a dotted path under canvas ("names.PYR",
     "inputs.glucose"), with the English of the model as the fallback; absent in the tests. */
  function layout(w, h, measure, say) {
    measure = measure || estimate;
    say = say || function (path, fallback) { return fallback; };
    var tr = tier(w), compact = tr >= 2, phone = tr === 3, labelPx = LABEL_PX[tr], enzPx = ENZ_PX[tr], nodeR = NODE_PX[tr];
    /* Label reserve at the edges: the curves and the far labels stay inside it. */
    var padX = compact ? 10 : 20, padTop = 6, padBottom = compact ? 8 : 12;
    var sx = w - 2 * padX, sy = h - padTop - padBottom, ox = padX, oy = padTop;
    function P(rel) { return [ox + rel[0] * sx, oy + rel[1] * sy]; }
    var nodes = METABOLITES.map(function (mt) {
      var p = P(mt.p), full = say('names.' + mt.id, mt.name);
      /* The middle tier keeps the name only where the model keeps it: elsewhere it is already an abbreviation. */
      var mid = mt.mid === mt.name ? full : mt.mid;
      return { id: mt.id, x: p[0], y: p[1], r: nodeR, text: tr === 0 ? full : tr === 1 ? mid : mt.abbr };
    });
    var labels = [], curves = [], hits = {};
    function box(text, rel, px, mono, align, kind, ref) {
      var lines = text.split('\n'), tw = 0, i, at = P(rel);
      for (i = 0; i < lines.length; i++) tw = Math.max(tw, measure(lines[i], px, mono));
      var lh = px * 1.15, th = lh * lines.length;
      var x0 = align === 'left' ? at[0] : align === 'right' ? at[0] - tw : at[0] - tw / 2;
      var b = {
        lines: lines, text: text, x: x0, y: at[1] - th / 2, w: tw, h: th, lh: lh, px: px, mono: mono, align: align,
        ax: at[0], ay: at[1], kind: kind, ref: ref
      };
      labels.push(b);
      return b;
    }
    function addCurve(kind, ref, out, p0, p3, c1, c2, trim0, trim3) {
      var cv = resample(p0, c1, c2, p3, trim0, trim3);
      cv.kind = kind; cv.ref = ref; cv.out = out;
      curves.push(cv);
      return cv;
    }
    /* Reactions: one curve per product; ring arcs from the ellipse, the rest from the hand-placed controls. The
       enzyme labels sit at lp (lpp on phones, where a label would otherwise cross its own edge); phones draw
       only the pressable ones. */
    function placeReactions() {
      REACTIONS.forEach(function (r, ri) {
        var from = nodes[r.fromIdx];
        r.outs.forEach(function (o, oi) {
          var start = o.via ? nodes[INDEX[o.via]] : from, to = nodes[o.toIdx], c;
          if (o.ring) c = ringArc(METABOLITES[r.fromIdx].p[2], METABOLITES[o.toIdx].p[2], sx, sy, ox, oy);
          else c = { c1: P(o.c1), c2: P(o.c2) };
          var cv = addCurve('reaction', ri, oi, [start.x, start.y], [to.x, to.y], c.c1, c.c2, start.r + 3, to.r + 3);
          cv.via = !!o.via;
        });
        /* The second substrate joins the first product on its own edge: oxaloacetate into citrate closes the TCA
           cycle, oxaloacetate into methylcitrate opens the methylcitrate one, acetyl-CoA into malate is the second
           half of the glyoxylate shunt. */
        if (r.co) {
          var src = nodes[r.coIdx], dst = nodes[r.outs[0].toIdx];
          addCurve('reaction', ri, 0, [src.x, src.y], [dst.x, dst.y], P(r.co.c1), P(r.co.c2), src.r + 3, dst.r + 3).co = true;
        }
        if (r.label && (!phone || r.key)) {
          var b = box(r.label, phone && r.lpp ? r.lpp : r.lp, enzPx, true, phone && r.alignp ? r.alignp : r.align, 'enzyme', ri);
          if (r.key && !hits[r.key]) hits[r.key] = b;
        }
      });
    }
    /* Inputs: one curve per target; the name above the pathway, compact frames keep the name only. */
    function placeInputs() {
      INPUTS.forEach(function (inp, ii) {
        var p0 = P(inp.p);
        inp.outs.forEach(function (o, oi) {
          var to = nodes[INDEX[o.to]];
          addCurve('input', ii, oi, p0, [to.x, to.y], P(o.c1), P(o.c2), 0, to.r + 3);
        });
        box(say('inputs.' + inp.id, inp.name), [inp.p[0], inp.p[1] - (compact ? 0.035 : 0.06)], labelPx, false, 'center', 'input', ii);
        if (!compact) box(say('pathways.' + inp.id, inp.pathway), [inp.p[0], inp.p[1] - 0.028], enzPx, true, 'center', 'pathway', ii);
      });
    }
    /* Drains: a short curved arrow to a tip, labelled beside it (the short label on compact frames). */
    function placeDrains() {
      DRAINS.forEach(function (d, di) {
        var from = nodes[d.fromIdx];
        addCurve('drain', di, 0, [from.x, from.y], P(d.tip), P(d.c1), P(d.c2), from.r + 3, 0);
        var text = compact && d.short ? say('drainsShort.' + d.id, d.short) : say('drains.' + d.id, d.label);
        box(text, phone && d.lpp ? d.lpp : d.lp, enzPx, true, d.align, 'drain', di);
      });
    }
    /* CO2 puffs leave the middle of the decarboxylating curve towards their tip, bending with the flow. */
    function placeCo2() {
      CO2.forEach(function (c, ci) {
        var cv = curves[curveIndex(curves, 'reaction', RIDX[c.reaction], 0)], tip = P(c.tip);
        var dx = tip[0] - cv.mid[0], dy = tip[1] - cv.mid[1], len = Math.hypot(dx, dy) || 1;
        var p0 = [cv.mid[0] + dx / len * 3, cv.mid[1] + dy / len * 3];
        var c1 = [p0[0] + dx * 0.25 + cv.tangent[0] * len * 0.3, p0[1] + dy * 0.25 + cv.tangent[1] * len * 0.3];
        var c2 = [tip[0] - dx * 0.3, tip[1] - dy * 0.3];
        addCurve('co2', ci, 0, p0, tip, c1, c2, 0, 0);
        box(say('co2', 'CO2'), c.lp, enzPx, true, c.align, 'co2', ci);
      });
    }
    METABOLITES.forEach(function (mt, i) { box(nodes[i].text, mt.lp, labelPx, false, mt.align, 'node', i); });
    placeReactions();
    placeInputs();
    placeDrains();
    placeCo2();
    return {
      w: w, h: h, tier: tr, compact: compact, phone: phone, nodeR: nodeR, labelPx: labelPx, enzPx: enzPx,
      nodes: nodes, curves: curves, labels: labels, hits: hits
    };
  }
  function curveIndex(curves, kind, ref, out) {
    for (var i = 0; i < curves.length; i++) if (curves[i].kind === kind && curves[i].ref === ref && curves[i].out === out) return i;
    return -1;
  }
  /* Pairs of label boxes that overlap (pure geometry, for the tests and the layout work). */
  function overlaps(lay, margin) {
    var out = [], L = lay.labels, mg = margin || 0;
    for (var i = 0; i < L.length; i++) for (var j = i + 1; j < L.length; j++) {
      var a = L[i], b = L[j];
      if (a.x < b.x + b.w + mg && b.x < a.x + a.w + mg && a.y < b.y + b.h + mg && b.y < a.y + a.h + mg) out.push([a.text, b.text]);
    }
    return out;
  }
  /* Labels that leave the canvas. */
  function outside(lay) {
    return lay.labels.filter(function (b) { return b.x < 0 || b.y < 0 || b.x + b.w > lay.w || b.y + b.h > lay.h; }).map(function (b) { return b.text; });
  }

  /* Signed whole percent for the readouts. */
  function signed(v) { return (v > 0 ? '+' : '') + v + '%'; }
  /* The {pool} placeholder of a readout lists the accumulating metabolites; when nothing accumulates the whole
     sentence that holds it is replaced by the nopool sentence rather than left with an empty value. A sentence
     runs from the previous full stop (or the start) to the next. */
  function poolSentence(template, names, nopool) {
    if (names.length) return Lab.format(template, { pool: names.join(', ') });
    return String(template).replace(/(^|\.\s+)[^.]*\{pool\}[^.]*\.(?=\s|$)/, function (all, before) { return before + nopool; });
  }

  var model = {
    METABOLITES: METABOLITES, REACTIONS: REACTIONS, INPUTS: INPUTS, DRAINS: DRAINS, CO2: CO2, PERTURBATIONS: PERTURBATIONS, KEYS: KEYS,
    INDEX: INDEX, RIDX: RIDX, DIDX: DIDX, RING: RING, WT: WT, solve: solve, summary: summary, layout: layout, overlaps: overlaps, outside: outside,
    estimate: estimate, poolSentence: poolSentence, signed: signed, pct: pct, tier: tier, POOL_LABEL: POOL_LABEL, PHONE_W: PHONE_W,
    TOL: TOL, MAX_SWEEPS: MAX_SWEEPS
  };
  window.__metabolismModel = model;

  if (typeof document === 'undefined') return;

  /* ---------------------------------------------------------------------
     Figure. Canvas, overlay buttons on the enzyme labels, pill controls, readouts.
     --------------------------------------------------------------------- */
  var TAU = Math.PI * 2;
  var root = document.getElementById('met');
  if (!root) return;
  var canvas = document.getElementById('met-canvas');
  var frame = root.querySelector('.met-frame');
  var buttonLayer = document.getElementById('met-buttons');
  var controls = document.getElementById('met-controls');
  var readout = document.getElementById('met-readout');
  var live = document.getElementById('met-live');
  if (!canvas || !frame || !buttonLayer || !controls || !readout) return;

  var str = Lab.strings('met');
  function sayCanvas(path, fallback) { return str('canvas.' + path, fallback); }
  var reduce = Lab.reduceMotion;
  var ctx = null, t = Lab.tokens(), lay = null, W = 0, H = 0;
  var current = null, running = false, rafId = 0, lastNow = 0;
  /* Colour ramps built once per theme: the draw loop indexes them instead of composing rgba() strings. */
  var RAMP = 16, inkRamp = [], mutedRamp = [];
  var res = WT;
  /* Smoothed per-curve flux and per-pool accumulation, so a click eases into the new steady state. */
  var curveFlux = null, curveTarget = null, poolNow = new Float64Array(M), poolTarget = new Float64Array(M);
  var phases = null, counts = null, refFlux = 1;

  function buildRamps() {
    var i;
    inkRamp.length = 0; mutedRamp.length = 0;
    for (i = 0; i < RAMP; i++) {
      inkRamp.push(Lab.rgba(t.ink, 0.22 + 0.5 * i / (RAMP - 1)));
      mutedRamp.push(Lab.rgba(t.muted, 0.35 + 0.55 * i / (RAMP - 1)));
    }
  }
  function ramp(list, u) {
    var i = (u * (RAMP - 1) + 0.5) | 0;
    return list[i < 0 ? 0 : i > RAMP - 1 ? RAMP - 1 : i];
  }
  function measureWith(context) {
    return function (text, px, mono) {
      context.font = Lab.font(px, t, LABEL_WEIGHT, mono ? t.fontMono : t.fontBody);
      return context.measureText(text).width;
    };
  }
  /* Flux carried by a curve: reactions carry their own flux, the co-substrate edge carries the second substrate,
     inputs their fixed supply, drains and CO2 exits their outflow. */
  function fluxOf(cv, r) {
    if (cv.kind === 'reaction') return cv.co ? r.coFlux[cv.ref] : r.flux[cv.ref];
    if (cv.kind === 'input') return INPUTS[cv.ref].outs[cv.out].c;
    if (cv.kind === 'drain') return r.drains[cv.ref];
    return r.co2At[RIDX[CO2[cv.ref].reaction]];
  }
  function blocked(cv) {
    return cv.kind === 'reaction' && current && PERTURBATIONS[current].scale === 0 &&
      PERTURBATIONS[current].enzymes.indexOf(REACTIONS[cv.ref].id) >= 0;
  }

  function relayout() {
    var fit = Lab.fitCanvas(canvas);
    ctx = fit.ctx; W = fit.w; H = fit.h;
    lay = layout(W, H, measureWith(ctx), sayCanvas);
    buildRamps();
    var n = lay.curves.length, i;
    if (!curveFlux || curveFlux.length !== n) {
      curveFlux = new Float64Array(n); curveTarget = new Float64Array(n);
      counts = new Int32Array(n);
      phases = new Float32Array(n * MAX_PARTICLES);
      var rng = Lab.rng(PHASE_SEED);
      for (i = 0; i < phases.length; i++) phases[i] = rng();
    }
    placeButtons();
  }

  /* One hit area per perturbation over its enzyme label, so the figure itself is pressable with a pointer. The
     hits are kept out of the accessibility tree and the tab order: the pills under the figure are the
     accessible controls, and a second set would double every action. */
  var overlay = {}, pills = {};
  buttonLayer.setAttribute('aria-hidden', 'true');
  function placeButtons() {
    if (!lay) return;
    for (var k in overlay) {
      var b = lay.hits[k], el = overlay[k];
      if (!b) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = Math.round(b.x - 8) + 'px';
      el.style.top = Math.round(b.y - 8) + 'px';
      el.style.width = Math.round(b.w + 16) + 'px';
      el.style.height = Math.round(b.h + 16) + 'px';
    }
  }
  KEYS.forEach(function (key) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'met-hit';
    b.tabIndex = -1;
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', str('aria.' + key));
    b.addEventListener('click', function () { toggle(key); });
    buttonLayer.appendChild(b);
    overlay[key] = b;

    var p = document.createElement('button');
    p.type = 'button';
    p.className = 'met-pill';
    p.setAttribute('aria-pressed', 'false');
    p.textContent = str('buttons.' + key);
    p.addEventListener('click', function () { toggle(key); });
    controls.appendChild(p);
    pills[key] = p;
  });
  var restoreBtn = document.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.className = 'met-pill met-restore';
  restoreBtn.textContent = str('buttons.restore');
  restoreBtn.addEventListener('click', function () { apply(null, true); });
  controls.appendChild(restoreBtn);

  /* Readout: the sentences of the perturbation with the measured numbers (signed percents in parentheses,
     the accumulating metabolites by name), or the wild-type sentence. */
  function readoutFor(r) {
    if (!r.key) return str('readouts.wild', '');
    var s = summary(r), text = Lab.format(str('readouts.' + r.key, ''), {
      shunt: signed(s.shunt), co2: signed(s.co2), lipids: signed(s.lipids), icd: signed(s.icd), mcs: signed(s.mcs)
    });
    return poolSentence(text, s.pools.map(metName), str('readouts.nopool', ''));
  }
  function metName(id) {
    return str('metabolites.' + id, METABOLITES[INDEX[id]].name.split('\n').join(' '));
  }
  function apply(key, announce) {
    current = key;
    res = key ? solve(key) : WT;
    KEYS.forEach(function (k) {
      var on = k === key ? 'true' : 'false';
      overlay[k].setAttribute('aria-pressed', on);
      pills[k].setAttribute('aria-pressed', on);
    });
    restoreBtn.setAttribute('aria-pressed', key ? 'false' : 'true');
    var text = readoutFor(res);
    readout.textContent = text;
    if (announce && live) live.textContent = text;
    refreshTargets();
    if (!running) render(Lab.now());
  }
  function toggle(key) { apply(current === key ? null : key, true); }

  function refreshTargets() {
    if (!lay) return;
    var i;
    for (i = 0; i < lay.curves.length; i++) curveTarget[i] = fluxOf(lay.curves[i], res);
    /* Widths and speeds are read against the busiest edge of the wild type, so a perturbation that halves the
       network visibly slows down instead of renormalising itself back to full width. The reference is well
       above 1 (the glucose input alone carries 6), so the initial 1 doubles as a "not measured yet" flag. */
    for (i = 0; i < M; i++) poolTarget[i] = res.pool[i];
    if (refFlux <= 1) {
      var wtMax = 0;
      for (i = 0; i < lay.curves.length; i++) wtMax = Math.max(wtMax, fluxOf(lay.curves[i], WT));
      refFlux = wtMax || 1;
    }
    /* Without a frame loop there is nothing to ease with: the new steady state is the frame. */
    if (reduce) snap();
  }
  function snap() {
    var i;
    for (i = 0; i < lay.curves.length; i++) curveFlux[i] = curveTarget[i];
    for (i = 0; i < M; i++) poolNow[i] = poolTarget[i];
  }

  /* ---------------------------------------------------------------------
     Drawing
     --------------------------------------------------------------------- */
  function widthFor(fx) {
    var u = Math.min(1, fx / refFlux);
    return WIDTH_MIN + (WIDTH_MAX - WIDTH_MIN) * Math.sqrt(u);
  }
  function strokeCurve(cv, width, color) {
    var xs = cv.xs, ys = cv.ys, i;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (i = 1; i < RESAMPLE; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.stroke();
    /* Arrow head at the end, along the last segment. */
    var n = RESAMPLE - 1, dx = xs[n] - xs[n - 1], dy = ys[n] - ys[n - 1], len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len, hl = ARROW + width, hw = hl * 0.42;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(xs[n], ys[n]);
    ctx.lineTo(xs[n] - ux * hl - uy * hw, ys[n] - uy * hl + ux * hw);
    ctx.lineTo(xs[n] - ux * hl + uy * hw, ys[n] - uy * hl - ux * hw);
    ctx.closePath();
    ctx.fill();
  }
  /* Blocked reaction: a short bar across the middle of the curve, in the ink colour. */
  function blockBar(cv) {
    var mid = Math.floor(RESAMPLE / 2), x = cv.xs[mid], y = cv.ys[mid];
    var dx = cv.xs[mid + 1] - cv.xs[mid - 1], dy = cv.ys[mid + 1] - cv.ys[mid - 1], len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len, h = lay.compact ? 6 : 8;
    ctx.strokeStyle = t.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + nx * h, y + ny * h);
    ctx.lineTo(x - nx * h, y - ny * h);
    ctx.stroke();
  }
  function drawLabel(b, color) {
    ctx.font = Lab.font(b.px, t, LABEL_WEIGHT, b.mono ? t.fontMono : t.fontBody);
    ctx.fillStyle = color;
    ctx.textAlign = b.align;
    ctx.textBaseline = 'middle';
    var y = b.y + b.lh / 2, i;
    for (i = 0; i < b.lines.length; i++) ctx.fillText(b.lines[i], b.ax, y + i * b.lh);
  }

  function render(now) {
    if (!ctx || !lay) return;
    var i, cv, fx, w;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    /* Edges. Width follows flux; a blocked reaction keeps a hairline and gets its bar. */
    for (i = 0; i < lay.curves.length; i++) {
      cv = lay.curves[i];
      fx = curveFlux[i];
      var off = blocked(cv), faint = fx < refFlux * FAINT_FLUX;
      w = off || faint ? 1 : widthFor(fx);
      var u = off ? 0.3 : Math.min(1, fx / refFlux);
      strokeCurve(cv, w, cv.kind === 'co2' || cv.kind === 'drain' ? ramp(mutedRamp, u) : ramp(inkRamp, u));
      if (off) blockBar(cv);
    }
    /* Particles: the flux itself, in the accent colour. */
    if (!reduce) {
      ctx.fillStyle = t.accent;
      for (i = 0; i < lay.curves.length; i++) {
        var n = counts[i];
        if (!n) continue;
        cv = lay.curves[i];
        for (var k = 0; k < n; k++) {
          var ph = phases[i * MAX_PARTICLES + k] * (RESAMPLE - 1);
          var i0 = ph | 0, u = ph - i0, i1 = i0 + 1 < RESAMPLE ? i0 + 1 : i0;
          ctx.beginPath();
          ctx.arc(cv.xs[i0] + (cv.xs[i1] - cv.xs[i0]) * u, cv.ys[i0] + (cv.ys[i1] - cv.ys[i0]) * u, PARTICLE_R, 0, TAU);
          ctx.fill();
        }
      }
    }
    /* Metabolite discs. A pool that accumulates swells and takes an accent halo. */
    for (i = 0; i < M; i++) {
      var nd = lay.nodes[i], swell = Math.min(1, poolNow[i] / (WT.input * POOL_FULL));
      var r0 = nd.r * (1 + (SWELL_MAX - 1) * swell);
      if (swell > 0.01) {
        ctx.fillStyle = Lab.rgba(t.accent, 0.16 * swell);
        ctx.beginPath(); ctx.arc(nd.x, nd.y, r0 + 7 + 5 * swell, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = poolNow[i] > WT.input * POOL_LABEL ? t.accent : t.ink2;
      ctx.beginPath(); ctx.arc(nd.x, nd.y, r0, 0, TAU); ctx.fill();
    }
    /* Labels. Metabolites in the body font, enzymes and exits in mono; a blocked enzyme goes muted. */
    for (i = 0; i < lay.labels.length; i++) {
      var b = lay.labels[i], col;
      if (b.kind === 'node') col = poolNow[b.ref] > WT.input * POOL_LABEL ? t.accent : t.ink;
      else if (b.kind === 'enzyme') {
        var re = REACTIONS[b.ref];
        col = current && PERTURBATIONS[current].enzymes.indexOf(re.id) >= 0 ? t.muted : t.ink2;
      } else if (b.kind === 'input') col = t.ink2;
      else col = t.muted;
      drawLabel(b, col);
    }
    /* A render outside the loop (a click, a resize, the first frame) also moves the clock, so the next tick
       measures its step from here and does not ease through the gap in one jump. */
    lastNow = now;
  }

  /* Frame: ease the widths and the swelling towards the new steady state, advance the particles. Runs only
     while the figure and the tab are visible, never in reduced motion. */
  function tick(now) {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    var dt = lastNow ? Math.min(now - lastNow, MAX_FRAME_MS) : FIRST_FRAME_MS;
    lastNow = now;
    var i, ease = 1 - Math.exp(-dt / SMOOTH_MS);
    for (i = 0; i < lay.curves.length; i++) {
      var d = curveTarget[i] - curveFlux[i];
      if (Math.abs(d) > 1e-4) curveFlux[i] += d * ease;
      else curveFlux[i] = curveTarget[i];
    }
    for (i = 0; i < M; i++) {
      var dp = poolTarget[i] - poolNow[i];
      if (Math.abs(dp) > 1e-4) poolNow[i] += dp * ease;
      else poolNow[i] = poolTarget[i];
    }
    /* Particle count from the spacing the flux earns, speed proportional to it; the tables are equal arc length,
       so a phase step is a constant distance and the dots keep a steady pace along the curve. */
    var sec = dt / 1000;
    for (i = 0; i < lay.curves.length; i++) {
      var fx = curveFlux[i], cv = lay.curves[i];
      if (fx < refFlux * FAINT_FLUX || blocked(cv)) { counts[i] = 0; continue; }
      var u = Math.min(1, fx / refFlux);
      var spacing = SPACING_MAX - (SPACING_MAX - SPACING_MIN) * Math.sqrt(u);
      var n = Math.max(1, Math.min(MAX_PARTICLES, Math.round(cv.length / spacing)));
      counts[i] = n;
      var step = (SPEED_MIN + SPEED_K * u) * sec / cv.length;
      for (var k = 0; k < n; k++) {
        var idx = i * MAX_PARTICLES + k, ph = phases[idx] + step;
        phases[idx] = ph >= 1 ? ph - 1 : ph;
      }
    }
    render(now);
  }
  function start() {
    if (running) return;
    running = true; lastNow = 0;
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ---------------------------------------------------------------------
     Wiring
     --------------------------------------------------------------------- */
  /* The window resize event, not a ResizeObserver: relayout() resizes the canvas bitmap, which an observer on
     the canvas would see as another resize. The debounce also keeps the solver-free but label-heavy relayout
     off every intermediate width while a window is dragged. */
  var resizeTimer = 0;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = 0;
      relayout();
      refreshTargets();
      /* A resize is not a transition: the new geometry starts at its steady state. */
      snap();
      render(Lab.now());
    }, 120);
  }
  window.addEventListener('resize', onResize);
  Lab.onTheme(function () { t = Lab.tokens(); relayout(); render(Lab.now()); });
  Lab.fontsReady(function () { relayout(); refreshTargets(); render(Lab.now()); });

  relayout();
  var forced = Lab.param('block');
  apply(forced && PERTURBATIONS[forced] ? forced : null, false);
  snap();
  render(Lab.now());

  if (!reduce) Lab.whenVisible(frame, start, stop);

  window.__metabolism = {
    block: function (key) { if (PERTURBATIONS[key]) apply(key, false); },
    restore: function () { apply(null, false); },
    state: function () {
      return {
        key: current, readout: readout.textContent, summary: summary(res),
        width: W, height: H, tier: lay.tier, labels: lay.labels.length,
        overlaps: overlaps(lay).length, outside: outside(lay).length, running: running, reduce: reduce
      };
    }
  };
})();
