# Portfolio v2: "A living network"

Date: 2026-09-05. Status: approved direction (the owner reviewed v1 and gave a written list of changes; this document is the contract for v2). Supersedes `2026-09-04-portfolio-redesign-design.md` where the two differ.

## Design read

Personal portfolio of a Ph.D. researcher (computer science, bioinformatics, bioengineering) for peers, principal investigators and technical recruiters, in English and Italian. Language: a living laboratory notebook, premium and scientific, with one signature device: a slowly living neuron network behind the whole site where action potentials occasionally travel between cells. Stack unchanged: Jekyll on GitHub Pages (no plugins), native CSS, vanilla JavaScript, HTML5 canvas, zero runtime dependencies, self-hosted fonts.

Dials: DESIGN_VARIANCE 8, MOTION_INTENSITY 7, VISUAL_DENSITY 3.

## What the owner asked for (v1 review) and how v2 answers

| Request | Answer |
| --- | --- |
| Update information from the two CVs, highlight programming skills | New `experience.yml`, `skills.yml`, `teaching.yml`, `presentations.yml`; a "Toolbox" section on the home page; the biography page rebuilt from the CVs |
| Do not open with the EEG head; open with the name and the fields | New hero: name, three fields, one sentence, two CTAs; the stage follows on scroll |
| Backgrounds not flat black or white; living neurons with occasional action potentials, theme-aware | `neurons.js`: a fixed full-viewport canvas behind the page; tinted deep backgrounds, glass panels |
| Italian version with a language switch | Full duplication of the three pages under `/it/`, UI strings in `_data/i18n.yml`, bilingual fields in the data files, `EN | IT` switch in the header |
| Fonts and interfaces less "default" | Clash Display (display), Satoshi (body), JetBrains Mono (data); glass panels; asymmetric compositions |
| Metabolic figure too angular; organic like the thesis figure, with visible flow and drug blocks that reroute the flux | New `metabolism.js`, its own section, smooth curves, flow particles, perturbations from the thesis (3-NP on ICL, PCL, SDH, CS, ICD) |
| Remove the adjacency matrix | Stage keeps only the EEG states |
| Neurosignals cell unreadable on phones | Bench relayouts under 700 px: stacked trace and spectrum, larger type |
| Connectivity on a 3D brain prototype instead of a 2D scalp | `brain.js`: procedural 3D brain, rotating, electrodes on the surface, candidate zone as a glowing patch |
| Microstate maps in the classic blue-to-red voltage colours | Diverging blue, neutral, red colormap |
| No paper count; add the ccPAS Stage 2 paper | Headline without numbers; `publications.yml` gains the 2026 Stage 2 Registered Report |
| Remove "What is real on this page" | Removed; each figure keeps a one-line "simulated" caption |
| Add hobbies with pictures | `beyond.yml` filled from the CV plus the two examples the owner gave (skiing at Obereggen, piano); Wikimedia Commons photos with licences recorded, replaceable |
| Mobile must look good | Every figure and section is checked at 360, 390 and 768 px in both themes and both languages before delivery |

## Locks

- One accent: teal. Light `--accent: #0a7f70`, dark `--accent: #3ddcc0`. Scientific colormaps inside figures (the blue-to-red voltage map) are data colours, not UI colours, and do not count against the lock.
- Backgrounds are never pure: light `--bg: #eef1f6`, dark `--bg: #070b12`, each with two faint radial tints and the neuron canvas behind. Panels are glass (`--glass`, translucent with `backdrop-filter`) with a solid fallback under `prefers-reduced-transparency`. Canvas figures keep drawing on the opaque `--surface`.
- Theme: auto with a manual toggle, applied before first paint. No section inverts.
- Shape rule: containers 24 px, nested figures 14 px, interactive elements pill.
- Typography: Clash Display 500 to 700 for headings and the wordmark; Satoshi 300 to 900 (variable) for body; JetBrains Mono for data labels and readouts only. No uppercase tracked eyebrows anywhere. No serif.
- Zero em-dashes and en-dashes anywhere, in both languages. Hyphen for ranges (2017-2020).
- CTA labels equal nav labels in each language: EN "Publications", "Biography"; IT "Pubblicazioni", "Biografia". One label per intent.
- No invented facts. Everything about the owner comes from the two CVs in `other/`, the thesis, the Zenodo record of the Stage 2 paper, and the two hobby examples he wrote (skiing at Obereggen, piano). The email is never published.
- Motion: no scroll listeners. IntersectionObserver, CSS scroll-driven animation with IO fallback, requestAnimationFrame gated by visibility. Every loop pauses off-screen and when the tab is hidden. DPR capped at 2 (1.5 for the background). `prefers-reduced-motion` gives static frames where clicks still update the frame instantly. Every animation has a one-sentence reason recorded in this document.
- Accessibility: real DOM buttons over canvases, `aria-live` only for user-triggered events, visually hidden descriptions for every canvas, `role="switch"` theme toggle, radio fieldset filters, `hreflang` alternates, `lang` attribute per page.
- Files in `other/` are reference material: excluded from the Jekyll build and from git (`.gitignore`).

## Information architecture and internationalisation

Routes (English is the default, Italian mirrors it under `/it/`):

| English | Italian |
| --- | --- |
| `/` | `/it/` |
| `/bio/` | `/it/bio/` |
| `/publications/` | `/it/publications/` |

Nav labels: EN Home, Biography, Publications; IT Home, Biografia, Pubblicazioni. The language switch is a two-segment pill (`EN` `IT`) in the header linking to `page.alt` (the counterpart URL). Each page declares `lang` and `alt` in its front matter. `<html lang>` follows `page.lang`; the head carries `<link rel="alternate" hreflang="en|it|x-default">`.

Strings live in `_data/i18n.yml` under `en:` and `it:` with identical key trees. Layouts and includes start with `{% assign lang = page.lang | default: 'en' %}{% assign t = site.data.i18n[lang] %}` (includes need their own assigns because page content renders before the layout). Data files carry bilingual fields as maps `{en: ..., it: ...}` and templates read `field[lang]`. Paper titles, thesis titles, venues and institution names stay in their original language. Meta descriptions live once in `t.meta` and pages pick theirs with a `meta:` key. The canvas modules' strings live in `_data/js/<module>.yml` (one file per module, `en:` and `it:` trees) and are serialised into `window.I18N.<module>` in the head of every page; the modules read them through `Lab.strings` and never hard-code English.

## Home page, section by section

The page has nine sections. Layout families are not repeated: full-bleed hero, sticky stepper, kinetic sentence, bento, full-width figure, type-led groups on hairlines, horizontal strip, featured plus index, collage.

1. **Hero** (`#hero`, full-bleed, `min-height: 100dvh` minus header, content top-aligned so the lower half belongs to the neuron background). Left-aligned, asymmetric: the name spans the row, the three fields sit bottom-left, the lede and CTAs bottom-right. Four text elements: the name as H1 in Clash Display (two lines on phones, one on desktop), the three fields on one line (`Computer science`, `Bioinformatics`, `Bioengineering`; each word lights up in turn every 2.4 s, reason: the three fields are the claim of the site and the sequence reads them one at a time), a 20-word lede, and two CTAs (Publications primary, Biography ghost). On load the name rises in with a 140 ms stagger per line (reason: entry hierarchy). No scroll cue.
2. **The stage** (`#stage-section`, sticky stepper, 5/12 copy, 7/12 figure; on phones the figure sticks under the header and the beats scroll beneath it). Three beats: `t.stage.b0` "Start with the signal." (10-20 montage and traces), `t.stage.b1` "Correlate the channels." (edges appear, computed live), `t.stage.b2` "Stimulate and listen." (press an electrode: TMS pulse, evoked potentials). Caption `t.stage.caption` "Simulated figures. No patient data.". States 2 and 3 of v1 (metabolism, matrix) are removed from `stage.js`.
3. **The sentence** (`#sentence`, kinetic manifesto): the doctoral aim, word by word (`animation-timeline: view()` with IO fallback). Reason: pace the most important sentence.
4. **What I work on** (`#interests`, 2+1 bento). Tall cell `#bench` (Neurosignals: bench with filters and spectrum). Right top `#mini-brain` (Brain connectivity: 3D brain). Right bottom `#mini-topo` (Microstates: blue-to-red topographies). Backgrounds differ per cell (glass, dotted grid, accent wash).
5. **The cell** (`#cell`, full-width figure with copy above and controls below). H2 `t.cell.title` "Before the brain, a bacterium.". Copy: the master's thesis modelled the central carbon metabolism of *Mycobacterium tuberculosis*; here the network runs live and perturbations from the thesis reroute the flux. Figure `metabolism.js` (contract below). Caption "Toy flux model, not the thesis results.".
6. **Toolbox** (`#toolbox`, type-led groups separated by hairlines, no cards: Programming spans the full row, the other three groups share a second row; one column on phones). H2 `t.toolbox.title` "What I build with.". Four groups from `skills.yml`: Programming (Python and MATLAB daily; R, SQL, Bash; C and Java basic), Machine learning, Brain signals, Data and tools. Primary items are set large in Clash Display (largest for Programming, the thing the owner asked to highlight), the rest as pills. One sentence from the CV about clinical data since 2019, Boston Children's Hospital and a medtech start-up.
7. **The route** (`#route`, horizontal scroll-snap strip on every width, one station per place from `route.yml`, in time order so the strip reads left to right). H2 `t.route.title` "Verona, Trento, Rovereto, Boston, Lyngby.". Each station: years (mono), place, role, institution. Link: Biography.
8. **Publications** (`#publications`, featured plus index). H2 `t.pubs.title` "Papers, all about connections." with no count. Featured: the 2026 IEEE TAI article. Index: the others in a two-column grid. Link: Publications.
9. **Outside the lab** (`#beyond`, collage: four columns, the first and fourth photos span two columns, the piano spans two rows, the last text tile spans two columns so the grid has no hole; two columns under 900 px, one under 520 px). H2 `t.beyond.title`. Items from `beyond.yml`: photo tiles (skiing at Obereggen, piano, football, running, reading, music) and text tiles (volleyball, good company). Notes exist only where a source supports them. A `<details>` "Photo credits" lists the Wikimedia Commons authors and licences, each linked to the file page (CC BY-SA 4.0 requires attribution and a licence link).
10. Footer (shared): name, role, profile pills, copyright, language switch repeated.

## Biography page (`/bio/`, `/it/bio/`)

Header H1 and the profile paragraphs from the industry CV. Sections: Experience (7 entries from `experience.yml`, rail layout with month-level dates), Education (3 entries, month-level dates; the doctorate is always "Ph.D. student"), Teaching (4 courses and the co-supervision line from `teaching.yml`), Grants and languages (one small two-column block), Conference presentations (5 entries from `presentations.yml`), Research interests, Outside the lab (shared include). Supervisor labels are number- and gender-neutral ("Supervision", "Co-supervision"; IT "Supervisione", "Co-supervisione"). English titles carry `lang="en"` on the Italian pages. Optional portrait at `assets/img/portrait.jpg`.

## Publications page

Filter (All, Journal, Conference, Registered report, First author; a capsule on desktop, loose pills under 520 px), grouped by year, seven entries. Below: "Conference presentations" from `presentations.yml`. Profile links under the title.

## Module contracts

All modules: read colours from `Lab.tokens()` at draw time and on `themechange`; run only while visible (`Lab.whenVisible`); expose `window.__<module>` for scripted checks and a pure model on `window.__<module>Model` that loads in a bare engine (jsc) without a DOM; honour `Lab.reduceMotion`; labels from `window.I18N.<module>`; no console output; no allocation in the frame loop after warm-up.

### neurons.js (all pages)

- DOM: `<canvas id="neurons" class="neurons" aria-hidden="true">` as the first child of `<body>`. CSS: `position: fixed; inset: 0; z-index: 0; pointer-events: none`. Header, main and footer sit at `z-index: 1`.
- Tokens: `--neuron-fibre` (structure stroke, includes alpha), `--neuron-soma` (cell body fill, includes alpha), `--accent` (spikes), `--bg`.
- Model: a seeded set of neurons (count from viewport area: about one per 90 000 px2, clamped 8 to 26). Each neuron: a soma (radius 4 to 8 px) with 3 to 5 dendrites (two-level branching, curved with quadratic segments) and one axon that reaches the soma of one to three neighbours (curved, may have a terminal branch). No two somas closer than 110 px. Neurons drift by at most 3 px on a slow noise so the structure breathes (reason: it is alive, not wallpaper).
- Spikes: every 1.2 to 3.5 s a random neuron fires: the soma flashes (accent halo, 400 ms), a bright pulse travels along each outgoing axon at about 320 px/s with a 40 px glowing tail, and each reached target fires with probability 0.55 after a 60 ms synaptic delay, at most 3 hops per cascade, at most 4 concurrent cascades. Pointer proximity (window `pointermove`, throttled) raises the fire probability of the nearest neuron; no pointer events on the canvas itself.
- Rendering: the static structure is cached on an offscreen canvas and redrawn only on resize or theme change; per frame: clear, `drawImage(static)`, then active pulses and flashes. DPR capped at 1.5. Pauses when the tab is hidden. Reduced motion: structure only, no spikes, no drift. `?neurons=off` disables the module; `?spike=1` fires immediately for screenshots.
- Visual weight: the structure must stay behind text at low contrast (light theme fibres at about 10 percent ink alpha, dark theme at about 13 percent accent alpha); glass panels sit on top. Measured body-text contrast against the busiest patch must stay above 4.5:1.

### stage.js (home)

- Trim to EEG states 0, 1, 2: montage and traces; correlation edges; stimulation emphasis (state 2 keeps the graph and highlights that electrodes are pressable, with the readout prompting a press). Remove metabolism, matrix, their layouts, particles, knockout buttons, `?knockout`. `?stage=0..2`, `?stim=C3` stay. Readouts and announcements from `window.I18N.stage` (keys listed in `_data/i18n.yml`). Tests in `tests/stage.test.js` updated accordingly.

### bench.js (home)

- Under 700 px of figure width the bench stacks: trace on top, spectrum below, labels at 12 px minimum, 8 spectrum bars instead of 12, switch labels unchanged. The module measures its container and picks the layout in `fit()`. In the two-column bento the tall cell is about 600 px wide, so the stacked layout is also the desktop layout, by choice: the tall trace fills the cell. The visible readout is not a live region (it updates on a timer); the switches announce their own state. Readout strings from `window.I18N.bench`.

### brain.js (home, replaces the 2D graph in minis.js)

- DOM: cell `#mini-brain` with `.mini-figure` containing `<canvas>` and `<div class="mini-buttons">` (one button per electrode, positioned from the projected coordinates each frame or on layout; buttons of electrodes on the far side are disabled and hidden), plus a hidden description and a `p.mini-readout` (not live) and a hidden live region.
- Geometry: a procedural brain, two hemispheres from a superellipsoid split by a medial fissure, cerebellum and stem omitted (a stylised prototype, as requested). Surface points (about 1 400) sampled with a seeded RNG, displaced by a low-frequency noise to suggest gyri. Rendered as a depth-shaded point cloud with a thin silhouette, back points dimmer and smaller. The 19 electrodes of the 10-20 montage are placed on the surface from their spherical coordinates (Lab.MONTAGE gives azimuth and radius; elevation from the radius). Edges: the seeded toy graph of v1 (Gaussian kernel of scalp distance, boosted left temporo-parietal cluster) drawn as 3D arcs lifted above the surface. Candidate zone: a glowing accent patch over the left temporo-parietal cluster (T3, T5, C3, P3 neighbourhood) drawn as a soft radial gradient projected onto the surface points that fall inside the cluster hull.
- Motion: slow yaw rotation (one turn per 40 s), pointer drag or arrow keys rotate, hover or focus on an electrode highlights its edges, click pins. Reduced motion: no auto-rotation, everything else works. `?highlight=C3`, `?yaw=deg` for screenshots.
- Model exported for tests: projection, montage placement (all 19 on the surface within tolerance), cluster hull membership, edge weights.

### topo (in minis.js)

- Colormap: diverging, blue `#2456c7` through the neutral `--surface-2` to red `#c8323a` (dark theme: blue `#4f7ee8`, red `#e05a5a`), applied to the signed value at each grid point. Everything else as v1 (classes A to D, sequence bar, reduced-motion side-by-side).

### metabolism.js (home, new section)

- DOM (inside `#cell`): `.met-frame` containing `<canvas id="met-canvas">`, `<div id="met-buttons" class="met-buttons" role="group">` (one real button per perturbation, absolutely positioned over its enzyme label so the figure itself is pressable), a hidden description `#met-desc`; below the frame `.met-bar` with `<p id="met-readout" class="mono">` and `<div id="met-controls">` (a pill per perturbation plus Restore, same actions as the overlay buttons, `aria-pressed`), a hidden live region `#met-live`, caption `p.met-caption`.
- Model (pure, exported as `window.__metabolismModel`): metabolites and reactions of the extended model of the thesis, drawn from its Figure 3.2 and the owner's summary figure: inputs glucose (glycolysis to pyruvate), fatty acids (beta-oxidation to acetyl-CoA and propionyl-CoA), cholesterol (to propionyl-CoA, acetyl-CoA, pyruvate); pyruvate to acetyl-CoA (PYD/DLA); TCA cycle CS, ACN, ICD1/2, KGD, SSADH, ScAS, SDH, FUM, MDH with the KGD/SSADH bypass in place of KDH; glyoxylate shunt ICL1/2 and MS; methylcitrate cycle MCS, MCD, MICD, MCL; methylmalonyl pathway PCL, MCE, MCM to succinyl-CoA and to the virulence lipids PDIM and SL-1; drains: CO2 at the decarboxylations, biomass from acetyl-CoA and alpha-ketoglutarate, succinate release, virulence lipids. Flux is a proportional push-flow with back-pressure (capacities per reaction, sweeps until the change is below 1e-4), so blocking a reaction reroutes what can be rerouted and accumulates what cannot. Each metabolite exposes `pool` (accumulation above baseline, 0 at wild type) and each reaction `flux` in carbon units.
- Perturbations (from the thesis, chapter 5): `icl` "3-nitropropionate on ICL and MCL" (glyoxylate shunt and methylisocitrate lyase blocked; flux returns to the decarboxylating branch, CO2 up, less carbon saved); `pcl` "inhibit PCL" (methylmalonyl pathway off; propionyl-CoA accumulates, PDIM and SL-1 production stops, more propionyl-CoA into the methylcitrate cycle); `sdh` "inhibit SDH" (succinate accumulates, the lower TCA starves; the methylmalonyl route becomes the only supply of succinyl-CoA); `cs` "downregulate CS" (TCA flux falls, acetyl-CoA and propionyl-CoA route into the methylcitrate cycle); `icd` "phosphorylate ICD" (stress: isocitrate takes the glyoxylate shunt, CO2 down). Only one perturbation at a time plus Restore. Each writes a two-sentence readout from `window.I18N.met.readouts.<key>` with the measured numbers filled in (percent change of shunt flux, CO2, pool accumulation).
- Rendering: organic layout that mirrors the thesis figure: inputs at the top, glycolysis falling to pyruvate, the TCA cycle as a large rounded loop at centre-right, the glyoxylate shunt as an inner chord, the methylcitrate cycle as an outer loop to the left sharing the succinate node, the methylmalonyl pathway as a right-hand column into succinyl-CoA and out to PDIM/SL-1, drains as short curved exits. Every edge is a cubic Bezier; edge width and particle density follow flux; particles (accent) move along the curve at a speed proportional to flux; a blocked reaction shows a short perpendicular bar in the ink colour and its label in the muted colour; an accumulating pool swells (radius up to 1.8x) with an accent halo. Metabolite labels in ink (Satoshi), enzyme labels in mono muted, no label overlaps at 1200, 900, 600 and 360 px widths (labels may shorten to abbreviations under 600 px; the readout spells them out).
- Motion: particles flow continuously while visible (reason: the flux is the subject). Reduced motion: static frame with edge widths encoding flux, a click still updates the frame. `?block=icl|pcl|sdh|cs|icd` for screenshots.
- Tests `tests/metabolism.test.js`: wild type conserves carbon within 1 percent; every reaction has positive flux at wild type; `icl` raises ICD flux and CO2 and zeroes MS; `pcl` zeroes MCE/MCM flux and accumulates propionyl-CoA and PDIM output falls to zero; `sdh` accumulates succinate and cuts FUM flux; `cs` raises MCS flux; `icd` raises ICL flux and lowers CO2; restore returns to wild type.

## Data model

- `_data/i18n.yml`: `en` and `it` trees (nav, hero, sections, captions, footer, publication kinds, filter labels, months, the author-list conjunction). `_data/js/{stage,bench,brain,topo,met}.yml`: the strings of the canvas modules (the background draws no text and has no file).
- `_data/publications.yml`: seven papers, newest first; new entry: Bertacco et al. 2026, Stage 2 Registered Report, `type: report`, `kind: {en: "Stage 2 Registered Report", it: "Registered Report, Stage 2"}`, URL `https://doi.org/10.5281/zenodo.19925506`, source "Zenodo".
- `_data/experience.yml`: seven positions from the CV (role, institution, place, start, end, summary as `{en, it}`), newest first.
- `_data/route.yml`: the six stations of the home route (years, place, what, where), in time order.
- `_data/education.yml`: three degrees (bilingual degree names, supervisors, theses in the original language).
- `_data/skills.yml`: four groups with `name {en, it}`, `primary` (list, set large) and `items` (list of pills).
- `_data/teaching.yml`: four courses with hours and the co-supervision line.
- `_data/presentations.yml`: five conference presentations.
- `_data/interests.yml`: three interests, bilingual.
- `_data/beyond.yml`: eight items from the CV and the owner's examples, six with photos in `assets/img/beyond/` and credits.
- `_data/profiles.yml`: unchanged.

## Verification before delivery

- `tests/run.sh` green (stage, bench, brain, topo, metabolism models).
- Console clean on all six pages, both themes, every debug state.
- Screenshots at 360, 390, 768, 1024, 1366, 1440 in both themes and both languages; full pages with `?shot=1`.
- Zero `—` and `–` in the built HTML. Hero fits 1366x768 with the name on one line. Nav on one line at 1024.
- Contrast of body text over the neuron background measured on the busiest area in both themes.
- Total weight under 700 KB including fonts and photos; photos lazy-loaded.
