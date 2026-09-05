# Portfolio redesign: "One graph, three sciences"

Date: 2026-09-04. Status: approved direction (user delegated design decisions; concept chosen by a 4-concept, 3-judge panel).

## Design read

Redesign-overhaul of a PhD researcher's personal portfolio (computer science, bioinformatics, bioengineering) for peers, collaborators, hiring PIs and technical recruiters. Apple-keynote scrolltelling language: one idea per screen, a sticky figure that transforms as the visitor scrolls, plain first-person copy. Stack: Jekyll on GitHub Pages, native CSS, vanilla JavaScript, HTML5 canvas, zero runtime dependencies, self-hosted fonts.

Dials: DESIGN_VARIANCE 7, MOTION_INTENSITY 7, VISUAL_DENSITY 3.

## Locks

- One accent: phosphor teal (`--accent`, light `#0f7a6a`, dark `#2dd4bf`). Never a second accent. Canvases read tokens with `getComputedStyle` at draw time and on the `themechange` event.
- Theme: auto (`prefers-color-scheme`) with a manual toggle, applied before first paint. No section inverts.
- Shape rule: containers and figure frames 20px radius, interactive elements pill, nothing else rounded.
- Typography: Bricolage Grotesque (display, weight only for emphasis, no italic exists), Geist (body), Geist Mono (data labels and readouts only, never as an uppercase eyebrow above a headline). Zero eyebrows on the whole site.
- Zero em-dashes and en-dashes anywhere. Hyphen for ranges (2017-2020).
- CTA labels equal nav labels: "Publications", "Biography". One label per intent.
- No invented facts. Every simulated visual carries a caption saying it is simulated. No hobbies, no city, no photo unless he supplies one, no metrics, no email (config value is a placeholder).
- Motion: no scroll listeners. IntersectionObserver, CSS scroll-driven animation with IO fallback, requestAnimationFrame gated by visibility. Every loop pauses off-screen and when the tab is hidden. DPR capped at 2. `prefers-reduced-motion` gives static frames where clicks still update the frame instantly.

## Information architecture (unchanged routes)

- `/` home: the scrolltelling page.
- `/bio/` Biography: calm reading page with the full academic path.
- `/publications/` Publications: complete list with filter and profile links.
- Nav labels unchanged: Home, Biography, Publications.
- Content source of truth: `_data/publications.yml`, `_data/education.yml`, `_data/interests.yml`, `_data/profiles.yml`, `_data/beyond.yml` (optional, empty by default).

## Home page, section by section

1. **Hero + The Stage** (layout family: sticky stepper, asymmetric split 5/12 copy, 7/12 sticky figure). Hero beat has three text elements: H1 "Reading the brain as a network.", 19-word subtext, CTAs Publications (primary) and Biography (ghost). Then three beats scroll past the same sticky canvas. State 0 (hero): top-view head, 19 electrodes of the 10-20 montage, an 8-channel EEG page sweeping left to right with an erase gap. State 1 "Start with the signal.": functional connectivity edges fade in, computed live as Pearson correlation of the traces on screen. Click or tap an electrode (real DOM buttons) to deliver a pulse: breadth-first wave over the graph, TMS-evoked potential written into the traces with real component latencies, attenuated and delayed per hop. State 2 "A cell is a graph too.": the same 19 nodes glide to a central carbon metabolism layout, edges become reactions, flux flows as particles, hover or tap a reaction to knock it out and watch the flux reroute (glyoxylate shunt). State 3 "Underneath, it is a matrix.": nodes become the row and column labels of a 19x19 adjacency matrix, cells fill row-major, hover prints the cell. Caption under the figure: "Simulated figures. No patient data." The visible readout is not a live region; a hidden live region announces only user-triggered events. Reason for the motion: the transformation is the claim of the site (three disciplines, one object).
2. **The one sentence** (manifesto). "My doctoral work aims to develop EEG and TMS-EEG systems, built on brain connectomics, for the personalized treatment of epilepsy." Each word lights up as it crosses the viewport centre (CSS `animation-timeline: view()` per word with an IntersectionObserver fallback). Reason: pace the most important sentence one clause at a time.
3. **Research interests** (2+1 bento with real background diversity). Tall cell: the Signal Bench, a live synthetic EEG trace with real biquad filters (Notch 50 Hz, High-pass 1 Hz, Low-pass 40 Hz) and a small spectrum; caption "Simulated signal, real filters." Right top: Brain connectivity, a 19-node graph with one outlined candidate zone, hover highlights a node's edges. Right bottom: Microstates, a scalp topography stepping through the four canonical classes A to D on a labelled duration bar.
4. **The path** (two-column ledger). H2 "Verona, then Trento, then Verona again." Mono year rail on the left, degrees on the right, one hairline above the group. Staggered reveal. Link: Biography.
5. **Publications** (featured plus index). H2 "Six papers, all about connections." with the count computed by Liquid. The 2026 IEEE TAI article at display size, the other five in a compact two-column grid (mono venue and year above each title), a different layout family from the ledger. Link: Publications.
6. **Outside the lab** (conditional collage from `_data/beyond.yml`, omitted at build time while the file is empty).
7. **What is real on this page** (single-column statement): the simulations are toy models written for this page; the degrees and papers are real; the site runs on Jekyll and vanilla JavaScript, source on GitHub.
8. Footer (shared): name, role, profile links with vendored Simple Icons marks, copyright.

## Subpages

- `/bio/`: H1 Biography, first-person summary, optional portrait slot (renders only if `assets/img/portrait.jpg` exists), education rail with the axis line drawing itself on scroll, full theses, honours and supervisor, definition grid of interests, the same conditional "Outside the lab" include.
- `/publications/`: H1 Publications, one-line intro, inline profile row, native radio segmented filter (All, Journal, Conference, First author) with an empty-state line and a live result count, year-grouped ledger with the year as an h2, first-author entries carry a 2px accent rule, link labels name the destination, an optional `kind` field overrides the default label (used for the PCI Registered Report).

## Module contract (for the JavaScript builders)

All modules are plain ES2017+ scripts (no modules, no bundler), loaded with `defer` after `assets/js/lab.js` and `assets/js/site.js`. Each module is an IIFE that finds its root element by id and exits silently when the element is absent.

Shared library `window.Lab` (in `assets/js/lab.js`):
- `Lab.rng(seed)` seeded PRNG returning a function in [0,1).
- `Lab.tokens()` returns `{bg, surface, surface2, ink, ink2, muted, line, lineStrong, accent, accentSoft, accentGlow, trace, trace2, fontMono, fontDisplay}` read from computed style of `document.documentElement`.
- `Lab.onTheme(fn)` calls fn on the `themechange` event.
- `Lab.MONTAGE` array of 19 `{name, x, y}` with unit-circle coordinates, nose up (y positive is anterior), in this order: Fp1 Fp2 F7 F3 Fz F4 F8 T3 C3 Cz C4 T4 T5 P3 Pz P4 T6 O1 O2.
- `Lab.fitCanvas(canvas)` sizes the backing store to the CSS box times min(devicePixelRatio, 2), sets the transform, returns `{w, h, dpr}` in CSS pixels. Call on ResizeObserver.
- `Lab.drawHead(ctx, cx, cy, r, tokens)` draws the head circle, nose and ears with hairline strokes.
- `Lab.idw(values, positions, px, py, power)` inverse-distance-weighted interpolation for topographies.
- `Lab.reduceMotion` boolean.
- `Lab.whenVisible(el, onVisible, onHidden)` from site.js.
- `Lab.param(name)` reads a URL query parameter (debug hooks).

Debug hooks (documented in the README): `?stage=N` forces stage state N on load; `?stim=C3` fires a stimulation at that electrode 600 ms after load; `?knockout=idx` knocks out reaction idx in state 2; `?bench=notch,hp,lp` enables those filters on load; `?highlight=NAME` and `?topo=LETTER` drive the small figures; `?motion=reduce` forces the reduced-motion path; `?theme=light|dark` forces a theme; `?shot=1` is the full-page screenshot mode. Model tests live in `tests/` and run with `tests/run.sh`.

Stage DOM (in `_layouts/home.html`): root `#stage`; `canvas#stage-canvas`; `div#stage-buttons` (module fills it with 19 `<button class="electrode" aria-label="Stimulate C3">`, positioned over the electrodes); `p#stage-readout` (visible, not live) and `p#stage-live[aria-live=polite]` (hidden, user-triggered messages only); `div#stage-controls` (module fills state-specific controls: state 0-1 a Coupling range input and a Reset button; state 2 a Restore button; state 3 nothing). Beats: elements `[data-stage-step="0|1|2|3"]` observed at 50% visibility; the module sets `data-state` on `#stage` and tweens node positions over 700 ms with `cubic-bezier(0.16,1,0.3,1)` (position and alpha only).

Bench DOM: root `#bench`; `canvas#bench-canvas` (trace); `canvas#bench-spectrum`; switches `input[type=checkbox][data-filter="notch|hp|lp"]`; readout `#bench-readout`.

Minis DOM: `#mini-graph` with `canvas`; `#mini-topo` with `canvas` and `#mini-topo-label` and `#mini-topo-bar`.

Performance: loop only while visible (Lab.whenVisible) and `document.visibilityState === 'visible'`; correlations recomputed every 4th frame; EEG page repaints only the write-head region; stop the loop 1.5 s after the last transient settles in reduced-motion mode (static frames only).

Accessibility: canvases `aria-hidden="true"` with a visually hidden text description next to them; all interaction reachable through real buttons and inputs; readouts in `aria-live="polite"` regions; Space or Enter on a focused electrode fires it.
