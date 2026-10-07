# Portfolio v3, "Apple grammar"

Date: 2026-10-07. Supersedes the visual layer of `2026-09-05-portfolio-v2-design.md`; that document still
describes the content model, the figure modules and the i18n scheme, which this restyle does not touch.

## Why

The owner's words: "e' bellissimo, ma si vede lontano un miglio che l'hai fatto tu", with the instruction to
rethink it in Apple's language, type and colour included. The site did not read as machine-made because of the
teal or the display face on their own. It read that way because of a stack of tells: a glass panel on every
surface, a generative canvas running behind every paragraph, a monospace micro-label under every figure, an
eyebrow over every section, and one 24px radius on everything. This restyle removes the whole stack.

## Method

Four Apple-flavoured directions were built as working mockups (product page, keynote, newsroom, systems page)
and scored by three independent lenses: Apple fidelity, scientific credibility, anti-slop craft. The three
lenses picked three different winners, which is the useful result: each named the same grafts. The shipped
design is the product-page language with four transplants.

| Taken from | What |
| --- | --- |
| Product | The whole token system, the type scale, the component set, the alternating ground rhythm |
| Keynote | The hero: the cortical surface as the product shot, so the first screen contains science |
| Newsroom | The affiliation line above the name, and the publication ledger with the year in the gutter |
| Systems | The figure as an instrument: an attached control bar, and the honesty note under each figure |

## Dials

DESIGN_VARIANCE 7, MOTION_INTENSITY 5, VISUAL_DENSITY 3. The variance lives in scale contrast (an 88px name
against 17px body) and in the full-bleed rhythm, not in off-grid placement. The centred hero is the documented
override in Section 4.3 of the taste rulebook: a launch-announcement composition where the message is the
design. It is used in the hero only; every other section is left-aligned on the 980 grid or full-bleed centred
media.

## Type

No display face. Apple has none, and a "designer" display font doing section headings was the loudest tell.

    --font-text: -apple-system, BlinkMacSystemFont, 'Pretendard', 'Segoe UI', Roboto, sans-serif;
    --font-mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;

On Apple hardware `-apple-system` resolves to real SF Pro, which is what apple.com itself serves and what this
audience mostly sees. Everywhere else the fallback is Pretendard Std Variable (SIL OFL 1.1,
github.com/orioncactus/pretendard), a face built to carry the Apple system font's metrics and colour on other
platforms; a three-way specimen against SF Pro and Geist confirmed it by eye. Shipped as one subset variable
file, Latin plus Latin Extended for the Italian accents, 70 KB. Nothing self-hosted for the monospace: it
appears only inside the canvases and in two figure readouts, where the system mono is the honest choice.

Font payload: 70 KB in one file, down from 104 KB in four.

Scale, px, clamps at their desktop maximum, weights 400 / 500 / 600 only:

| Role | Size | Weight | Tracking | Leading |
| --- | --- | --- | --- | --- |
| Display, the name | clamp(44, 7.4vw, 88) | 600 | -0.022em | 1.05 |
| Moment title | clamp(34, 4.6vw, 56) | 600 | -0.018em | 1.07 |
| Statement sentence | clamp(28, 3.6vw, 44) | 600 | -0.016em | 1.16 |
| Featured paper title | clamp(26, 2.8vw, 34) | 600 | -0.016em | 1.14 |
| Hero intro | clamp(21, 2.2vw, 28) | 400 | -0.010em | 1.21 |
| Lede, section copy | clamp(19, 1.7vw, 21) | 400 | -0.010em | 1.43 |
| Body | 17 | 400 | -0.003em | 1.47 |
| Small: captions, authors | 14 | 400 | 0 | 1.43 |
| Fine print | 12 | 400 | 0 | 1.33 |

Tracking is negative and grows more negative with size, zero below 15px, positive only on the 12px segmented
label where it keeps small caps legible. Italian runs about 15 percent longer: every display size is a clamp
with a viewport term so a longer string shrinks before it wraps, and copy is capped at `--measure` 692px.

## Colour

One accent, Apple blue, on both themes. The light theme is white and `#f5f5f7`; the dark theme is true black,
which is a deliberate exception to the no-pure-black default because the brief names it and the figures gain
from it.

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#ffffff` | `#000000` |
| `--bg-alt` | `#f5f5f7` | `#101011` |
| `--surface` | `#ffffff` | `#1d1d1f` |
| `--surface-2` | `#f5f5f7` | `#161617` |
| `--ink` | `#1d1d1f` | `#f5f5f7` |
| `--ink-2` | `#424245` | `#d2d2d7` |
| `--muted` | `#6e6e73` | `#86868b` |
| `--line` | `#d2d2d7` | `#424245` |
| `--line-strong` | `#86868b` | `#6e6e73` |
| `--accent` | `#0071e3` | `#2997ff` |
| `--accent-text` | `#0063cc` | `#2997ff` |
| `--accent-fill` | `#0071e3` | `#0071e3` |

`--accent-text` is darkened in the light theme so a link still passes AA on `#f5f5f7` (5.27:1). `--accent-fill`
stays the darker blue in both themes so white on it holds 4.70:1, which is what Apple does.

The diverging voltage ramp of the microstate figure is **not** a token and is not the accent, because blue
cannot mean both "negative microvolts" and "selected and live" on one page: `#2f6fd0 / #f2f2f4 / #d9342b` in
light, `#4a86e8 / #2c2c2e / #ef4b3f` in dark. All three values live in `PALETTES` in `topo.js`, the neutral
included: read from a page token it drifted against the plate the map is drawn on, and a neutral darker than
the plate reads as a hole through the head. The accent is banned inside that figure, which is why the class
letter and the sequence strip use `--muted` and `--ink`.

The accent marks state, never decoration: a primary action, a link, a live element in a figure, a focus ring,
the marker of the current role on a rail. It does not bar the top of every card in a list, draw an axis down a
rail, ring all nine markers, or fill a bar chart: the spectrum of the signal bench is drawn in `--ink-2`, so
the only blue in the bento belongs to the voltage map, which has its own ramp.

A fill under white text must be `--accent-fill`, never `--accent`: in the dark theme `--accent` is `#2997ff`
and white on it is 3.02:1.

## Shape

Three steps, no exceptions. Interactive elements are full pills. Surfaces are 18px (`--radius`). Full-bleed
stage tiles are 28px (`--radius-lg`), dropping to 18px at 720px and below. Chips nested inside a figure are
12px (`--radius-sm`). The glass panel is gone: a figure is a plain `--surface` tile with a tinted shadow and no
border.

## Composition

The home page keeps its sections and its order. What changes is the ground rhythm and what the hero holds.

1. **Hero.** The name at the display size, then the claim ("Machine learning that reads EEG and TMS-EEG as
   brain networks.") at the 28px intro step, then the affiliation beneath it, one blue pill plus one blue
   chevron link, and the cortical surface sitting unframed on the ground with the connectivity caption as its
   12px fine print. The first screen contains the science. An earlier draft opened with a strip of the three
   fields above the name; that is the decorative triad the rulebook bans whatever the words are, so the
   fields now open the biography page instead, where they read as a statement rather than a device.
2. **Stage, statement, bento, metabolism, toolbox, route, publications, collage** alternate `--bg` and
   `--bg-alt` grounds with no borders between them. The metabolism figure is the one full-bleed moment: the
   copy above it is centred, the figure runs the media grid, and its control panel is centred under it to
   match. Every other figure wears the shared instrument bar instead, with the readout flush left and the
   controls flush right, except where the column is too narrow to hold both: in a bento cell about 390px wide
   three labelled filters and a readout cannot share a row, so that bar stacks them, readout first. An earlier
   draft of this contract called this moment a *dark* one, standing on a
   theme-independent black band. That cannot ship: the canvases read their colours from the root tokens at
   draw time, so a band that ignored the theme would draw its figure in the wrong palette.
3. **Publications** turn into a ledger: the year hangs in the gutter, the venue code is mono, one hairline per
   year group.
4. **Figures** are instruments: a `--surface` plate, a control bar with the mono readout flush left and the
   controls flush right, then the interaction hint, then the honesty note at 12px. The monospace appears in
   those readouts and in the venue codes of the publication ledger, and nowhere else: never as a label above
   a heading.

## The neuron background

The owner likes it ("i neuroni con le scosse in background spaccano di brutto"), so it stays, but it stops
being wallpaper, which was one of the six tells. Every section below the hero gets an opaque ground, so the
fixed canvas shows through in the hero only, fading out at its lower edge. No JavaScript change is needed:
this is the section backgrounds doing the masking. `?neurons=off` still disables it.

## What must not regress

WCAG AA contrast, visible focus rings, reduced-motion paths, the `prefers-reduced-transparency` fallback (it
covers the header and the footer now that the glass panels are gone), both themes, en/it key parity, the 334
model assertions in `tests/run.sh`, a silent console, zero em-dashes and en-dashes, and every debug hook
listed in the README.

"TMS-EEG" is written with U+2011 NON-BREAKING HYPHEN in every data file that feeds visible copy. It renders
identically to the ASCII hyphen and never offers a line break, which is what kept it splitting across lines
at phone widths.
