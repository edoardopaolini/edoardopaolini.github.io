# edoardopaolini.github.io

Personal site of Edoardo Paolini. Jekyll on GitHub Pages, native CSS, vanilla JavaScript, no build step beyond Jekyll.

## Editing content

All content lives in `_data/`:

- `publications.yml`: papers, newest first. The first entry with `featured: true` is shown large on the home page; `type` (journal, conference, report) drives the filter on `/publications/` and the default label, `kind` overrides the label.
- `education.yml`: degrees, newest first. Drives the ledger on the home page and the timeline on `/bio/`.
- `interests.yml`: the three research interests, in the order of the three cells on the home page.
- `profiles.yml`: external profiles shown in the footer and on `/publications/`.
- `beyond.yml`: the "Outside the lab" section. It is invisible until this file has at least one item; the file explains the fields.

Optional portrait: add `assets/img/portrait.jpg` (square, at least 440 x 440) and `/bio/` shows it. Nothing renders while the file is absent.

The home headline "Six papers, all about connections." counts the entries of `publications.yml`; edit `_layouts/home.html` if a paper that is not about connectivity is added.

## Figures

The interactive figures are toy simulations written for this site, in `assets/js/`:

- `stage.js`: the home page stage. States 0 and 1: 10-20 EEG montage with simulated traces, live Pearson correlation edges and click-to-stimulate (TMS-evoked potentials spreading over the graph). State 2: the same nodes as a central carbon metabolism network with a push-flow solver and knockouts. State 3: the 19 x 19 adjacency matrix.
- `bench.js`: the Signal Bench (synthetic EEG with real RBJ biquad filters and a spectrum).
- `minis.js`: the connectivity graph and the microstate topography.
- `lab.js`: shared helpers (seeded random numbers, tokens, montage coordinates, canvas sizing, interpolation).
- `site.js`: theme toggle, scroll reveals, publications filter.

Every figure reads its colours from the CSS tokens, runs only while visible, and has a static version for `prefers-reduced-motion`. Nothing on the page is patient data or a published result.

## Tests

The model part of each figure runs without a browser. From the repository root:

```
tests/run.sh
```

It uses JavaScriptCore's `jsc` (present on macOS); any engine with `load()` works.

## Debug query parameters

Handy when checking the page or taking screenshots:

| Parameter | Effect |
| --- | --- |
| `?theme=light` or `?theme=dark` | Force a theme without saving it |
| `?motion=reduce` | Force the reduced-motion path |
| `?shot=1` | Screenshot mode: no viewport-relative heights, no sticky figure, reveals shown |
| `?stage=0..3` | Force a stage state |
| `?stim=C3` | Stimulate an electrode shortly after load (stage states 0-1) |
| `?knockout=N` | Knock out reaction N in stage state 2 |
| `?bench=notch,hp,lp` | Enable those filters on the Signal Bench |
| `?highlight=C3` | Highlight an electrode in the connectivity figure |
| `?topo=A` | Show one microstate class in the topography figure |

The figures also expose `window.__stage`, `window.__bench` and `window.__minis` for scripted checks.

## Local preview

```
bundle install
bundle exec jekyll serve
```
