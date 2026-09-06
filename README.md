# edoardopaolini.github.io

Personal site of Edoardo Paolini. Jekyll on GitHub Pages, native CSS, vanilla JavaScript, no build step beyond Jekyll. English at `/`, Italian at `/it/`.

## Editing content

All content lives in `_data/`. Fields that differ between languages are maps with `en` and `it` keys; titles of papers, theses, venues and institutions stay in their original language.

- `publications.yml`: papers, newest first. The first entry with `featured: true` is shown large on the home page; `type` (journal, conference, report) drives the filter on `/publications/` and the default label; `kind` overrides the label.
- `presentations.yml`: conference presentations, shown on `/bio/` and `/publications/`.
- `experience.yml`: positions, newest first (biography page).
- `education.yml`: degrees, newest first (biography page).
- `route.yml`: the stations of the home route, in time order.
- `skills.yml`: the four groups of the toolbox on the home page (`primary` items are set large, `items` become pills).
- `teaching.yml`: courses, co-supervision, grants and languages (biography page).
- `interests.yml`: the three research interests, in the order of the three cells on the home page.
- `profiles.yml`: external profiles shown in the footer and on `/publications/`.
- `beyond.yml`: the "Outside the lab" collage (home and biography). Items with `image` become photo tiles, the others text tiles. Photos live in `assets/img/beyond/`; the current ones come from Wikimedia Commons and carry a `credit` line that the page prints under "Photo credits". Replace them with your own photos and drop the credit.
- `i18n.yml`: every interface string, once per language. `js/*.yml`: the strings of the canvas figures, one file per module, exposed to the scripts as `window.I18N`.

Optional portrait: add `assets/img/portrait.jpg` (square, at least 440 x 440) and `/bio/` shows it. Nothing renders while the file is absent.

Adding a language means adding a tree to `i18n.yml` and `js/*.yml`, a new key in every `{en: ..., it: ...}` map of the data files, and a copy of `it/` with the new `lang`, `alt` and `permalink` front matter.

## Figures

The interactive figures are toy simulations written for this site, in `assets/js/`. Every figure reads its colours from the CSS tokens, runs only while visible, has a static version for `prefers-reduced-motion`, and takes its labels from `window.I18N`. Nothing on the page is patient data or a published result.

- `neurons.js`: the living background on every page (a neuron field on a fixed canvas, with action potentials travelling between cells).
- `stage.js`: the home page stage. 10-20 EEG montage with simulated traces, live Pearson correlation edges and click-to-stimulate (TMS-evoked potentials spreading over the graph).
- `bench.js`: the signal bench (synthetic EEG with real RBJ biquad filters and a spectrum).
- `brain.js`: the connectivity graph on the rotating cortical surface of the ICBM152 template, with the candidate epileptogenic zone drawn on the cortex and the sources of the network placed on it.
- `cortex-data.js`: the prepared surface `brain.js` draws, 9 531 points with their curvature packed into a base64 string. It comes from BrainMesh_ICBM152 of [BrainNet Viewer](https://www.nitrc.org/projects/bnv/), the ICBM152 surface provided by Prof. Alan C. Evans, Montreal Neurological Institute.
- `topo.js`: the microstate topography (blue to red voltage map).
- `metabolism.js`: the central carbon metabolism of *Mycobacterium tuberculosis* as a live flux network with perturbations taken from the master's thesis.
- `lab.js`: shared helpers (seeded random numbers, tokens, montage coordinates, canvas sizing, interpolation, `Lab.format` for `{name}` placeholders, `Lab.strings` for the labels of a module).
- `site.js`: theme toggle, scroll reveals, publications filter.

Module stylesheets live in `assets/css/modules/` (`neurons.css`, `stage.css`, `cells.css` for the three bento cells, `metabolism.css`); `assets/css/style.css` holds the tokens and the page layout.

## Tests

The model part of each figure runs without a browser. From the repository root:

```sh
tests/run.sh
```

It uses JavaScriptCore's `jsc` (present on macOS); any engine with `load()` and `print()` works. `tests/harness.js` holds the shared `assert`, `near` and `summary`; each `tests/*.test.js` loads it first and ends with `summary(name)`, which fails the run when an assertion failed.

## Debug query parameters

Handy when checking the page or taking screenshots:

| Parameter | Effect |
| --- | --- |
| `?theme=light` or `?theme=dark` | Force a theme without saving it |
| `?motion=reduce` | Force the reduced-motion path |
| `?shot=1` | Screenshot mode: no viewport-relative heights, no sticky figure, reveals shown |
| `?neurons=off` | Disable the background |
| `?spike=1` | Fire the background neurons at once and then every 600 ms |
| `?stage=0..2` | Force a stage state |
| `?stim=C3` | Stimulate an electrode shortly after load |
| `?bench=notch,hp,lp` | Enable those filters on the signal bench |
| `?highlight=7`, `?yaw=deg` | Pin a cortical source (its number or its name), set the rotation of the cortex |
| `?topo=A` | Show one microstate class in the topography figure |
| `?block=icl` (or pcl, sdh, cs, icd) | Apply one perturbation to the metabolic network |

The figures also expose `window.__stage`, `window.__bench`, `window.__brain`, `window.__topo`, `window.__metabolism` and `window.__neurons` for scripted checks; `window.__neurons.frameMs()` returns the frame cost of the background since the last call (`{frames, avg, max}` in ms) for a quick performance check; `window.__brain.frameMs()` reports the same for the overlay of the cortical figure and `window.__brain.cortexMs()` forces one re-render of the cached point cloud and returns its cost.

## Local preview

```sh
bundle install
bundle exec jekyll serve
```

The `other/` folder holds reference material (CVs, thesis) and is excluded from the build and from git.
