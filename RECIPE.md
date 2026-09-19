# Set — Brand Image Treatment

The signature treatment that turns a photograph into a **brand image**: a duotone,
ordered-dither bitmap on the cyan (or neutral) axis. It reads as an early computer
display — terminals, IDEs, 1-bit screens — which is the point.

## When to use it

- **Brand / decorative / statement imagery only** — OG images, hero art, decorative
  website fills, social cards.
- **Not for real photos.** Actual photography, screenshots, client work, and product
  shots are shown **unfiltered**. The treatment is a brand device, not a photo filter.
- **Art direction:** it rewards simple, bold, high-contrast subjects. Busy/detailed
  source images turn muddy. Choose the photo as if choosing a poster subject.

## The recipe

Applied in order:

1. **Grid** — resample the source so its **longest edge = 640 cells** (square cells),
   keeping aspect ratio. This is a fixed bitmap resolution (à la Macintosh 512, VGA 640):
   every brand image is "rendered on the same display," so graphic density is constant
   regardless of final output size. 640 is the reference resolution — legible even on dense
   content, still unmistakably a bitmap. (Responsive delivery re-runs the recipe at coarser
   or finer grids, 240–1280 cells, so the _rendered_ dot stays constant across viewports —
   see Delivery.)
2. **Greyscale** — luminance `0.2126 R + 0.7152 G + 0.0722 B` (sRGB).
3. **Auto-levels** — stretch each image's own range: black point = 2nd percentile,
   white point = 98th percentile of luminance. (Per-image, so exposure varies gracefully.)
4. **Gamma** — `0.7`.
5. **Ordered dither → 2-level** — 8×8 Bayer matrix; each cell is either the shadow or the
   highlight endpoint (`t > threshold`). Two colours only — a true 1-bit image. The binary
   on/off echoes the blinking terminal cursor and the stepped loading spinner.
6. **Upscale** — nearest-neighbour to the export size (dots stay crisp). Pre-baked exports
   only (OG cards and any fixed-size render) — nearest-neighbour is only clean when the scale
   factor is fixed at export time; browser-side scaling is smooth (see Delivery).

### Endpoints (from the palette)

The four CMYK inks — cyan, magenta, yellow, and neutral (K) — in three tones:
**dark** (the default), **light** (for light-mode contexts) and **mid** (the ramp
segment between the two, for imagery with no text over it, sitting acceptably on both
light and dark surroundings).

**Dark** (default):

| Axis    | Shadow (0)               | Highlight (1)            |
| ------- | ------------------------ | ------------------------ |
| Cyan    | `cyan.1200` `#001919`    | `cyan.1000` `#004848`    |
| Magenta | `magenta.1200` `#230d23` | `magenta.1000` `#5f2e5f` |
| Yellow  | `yellow.1200` `#171700`  | `yellow.1000` `#424202`  |
| Neutral | `neutral.1200` `#0b0c0c` | `neutral.800` `#424444`  |

**Mid:**

| Axis    | Shadow (0)              | Highlight (1)           |
| ------- | ----------------------- | ----------------------- |
| Cyan    | `cyan.900` `#006464`    | `cyan.600` `#3ba9a9`    |
| Magenta | `magenta.900` `#814181` | `magenta.600` `#d27ad2` |
| Yellow  | `yellow.900` `#5c5d01`  | `yellow.600` `#9e9e37`  |
| Neutral | `neutral.700` `#646766` | `neutral.500` `#a5a8a7` |

**Light:**

| Axis    | Shadow (0)              | Highlight (1)           |
| ------- | ----------------------- | ----------------------- |
| Cyan    | `cyan.500` `#5ec2c2`    | `cyan.100` `#f4fbfb`    |
| Magenta | `magenta.500` `#e797e7` | `magenta.100` `#fdf8fd` |
| Yellow  | `yellow.500` `#b7b754`  | `yellow.100` `#fafaf4`  |
| Neutral | `neutral.500` `#a5a8a7` | `neutral.100` `#f8fbfb` |

### Why those endpoint caps (WCAG)

**Dark:** the highlight endpoint is the **brightest pixel the image can ever contain**
(2-level → every pixel is one of the two endpoints; the ordered pattern can't exceed the
highlight). The caps are chosen so that brightest pixel keeps both dark-mode foregrounds at
**≥ 4.5:1 (WCAG AA)** anywhere on the image, with no legibility shims:

- `#c8c9c9` (neutral hover, default theme) — cyan 6.3 · magenta 6.2 · yellow 6.3 · neutral 5.9
- `rgba(255,255,255,.8)` (brand theme) — cyan 7.3 · magenta 6.9 · yellow 7.4 · neutral 7.0

So OG/hero text can sit anywhere over the image and pass.

**Light:** reversed — the shadow endpoint is the **darkest pixel the image can ever
contain**, floored so the light-mode prose text `#0e0f0f` keeps **≥ 4.5:1 (WCAG AA)**
anywhere on the image (8.0–9.1:1, default and brand themes) — and with it the darker
default text `#0b0c0c`. The neutral hover `#007c7c` carries no such guarantee: it only
reaches 4.76:1 on pure white, so no visible light image can pass it — the light variant
guarantees body text, not interactive states.

**Mid:** no text guarantee — mid is for imagery with no text over it. The endpoints
take the ramp segment between the dark and light ranges (900 → 600 on the inks; the
neutral ramp is spread too evenly for its between-segment to match the ink separations,
so neutral mid shares a boundary step with light at 700 → 500). One non-text guarantee
holds by construction: **black keeps ≥ 3:1 against both endpoints** (3.0 inks · 3.7
neutral — the 900 primitives are floored for exactly this), meeting WCAG 1.4.11
non-text contrast — so the black logo mark can sit on mid imagery.

## Fixed decisions (settled, do not re-litigate without reason)

- **2-level only.** No 3-level variant — protects the pure binary/cursor story.
- **Square cells (1:1).** A 1:2 "mono-cell" dither was explored; it costs vertical detail and
  adds a scanline, and the 1:2 tie isn't perceptible at texture scale. Square is just as
  on-grid. (See alternate below.)
- **One dot size, several grids.** The dot is always the hard 2×2; resolution varies the grid
  (240–1280 dots), never the dot, and an export is never resized to make another. 640 dots
  (the 1280 export) is the reference grid. (See Delivery for which grid serves which viewport.)

## Alternate (back pocket, not default)

**CRT homage** — 1:2 _tall_ cells (halve the vertical cell count). Produces faint horizontal
scan-lines, a genuine cathode-ray quality. Use deliberately for the _look_, never justified by
"purity." Not the default treatment.

## Delivery — pre-bake, then serve from Cloudinary as a static asset

This is the chosen path.

- **Process at asset-prep time** with the web tool (the exact recipe via
  `shared/screen-core.js`), then **upload the treated PNG to Cloudinary** and serve it.
  Cloudinary stays the CDN — it just serves a pre-baked asset instead of generating the effect.
- **Serve as PNG with no lossy re-encode** — do _not_ apply `q_auto` / `f_auto`; JPEG/WebP would
  smear the dot edges and break the exact 2-colour WCAG guarantee. Let the browser scale the
  export smoothly. Reflow (WCAG 1.4.10, 320px) means render sizes are always fluid, and
  continuous scaling of the dither under nearest-neighbour produces moiré in the 1–3×
  device-scale range — `image-rendering: pixelated` must _not_ be applied on the web. Smooth
  resampling at the mild scales an export actually renders at keeps the screen texture legible
  and degrades gracefully at every size and DPR — and it only ever interpolates _between_ the
  two endpoint colours, so the WCAG caps still hold. (Why: nearest-neighbour is only clean at
  integer device-pixel multiples; tone in this treatment lives in a 1-dot-period dither, so
  non-integer factors beat against it — and fluid layouts make non-integer factors the norm.)
- **Responsive variants re-render the grid — never resample an export.** Screen offers six
  export widths — 480 / 640 / 960 / 1280 / 1920 / 2560 — each a fresh run of the recipe at its
  own grid (240–1280 dots; the dot is always the hard 2×2). A resized export would smear the
  grid, so a different size is always a different export. What a variant changes is the
  **rendered dot size in CSS px** = rendered width ÷ grid dots (grid = export width ÷ 2). DPR
  drops out: it's the same on 1× and 2× screens. An export shown at its own pixel width is a
  **2.0** dot — crisp, clearly a bitmap, motion easy to read (and drawn 1:1, pixel-exact, on a
  1× screen); shown at half that width it's **1.0** — fine, the image leads and the texture and
  motion recede; past ~2.5 it turns blocky.
- **Which end to favour is the consumer's call, per use.** Where the image matters most, the
  doubling sizes (640 / 1280 / 2560) each spanning a 1.0→2.0 band is a good ramp. Where the
  texture and motion matter most, the in-between sizes (480 / 960 / 1920) let each band sit
  closer to 2.0 — the 1.33–1.5× steps are what make that possible. Either way, switch exports
  with `<picture media>`, which keys off CSS width and ignores DPR; `srcset`/`sizes` would hand
  2× screens the finer file. Judge by the image's rendered width, not the viewport.
- **Motion:** Load+Scan is frame-capped per export size so Safari holds the 5s hand-off to the
  Scan loop (64 frames ≤ 640, 48 at 960, 32 at 1280, 16 at 1920, 8 at 2560); Load-only and
  Scan-only are uncapped.
- **OG / social cards are exported at the exact 1200×630.** Scrapers consume the raw asset and
  resample it themselves, so hand them exact pixels — the nearest-neighbour ×2 is baked in at
  export time.

### Why not the live routes (tested, rejected)

- **Live Cloudinary URL transforms** can't reproduce it faithfully: `e_ordered_dither` offers
  only a fixed set of threshold maps (no custom Bayer, no scale control), and `e_tint` +
  `e_auto_contrast` don't match our 2/98 auto-levels + gamma 0.7. In testing the dither pattern
  and colour did not match the reference.
- **Pure CSS/SVG filter** can't do the per-image auto-levels (needs a histogram) and the dither
  scale would key off render size, not the fixed 640 grid.
- The `set-image-filters.svg` duotone filter remains only as a _non-dithered_ live fallback if
  ever needed.

## Reference implementation

`shared/screen-core.js` — the exact recipe as a single pure function (dependency-free
UMD, so a Node consumer could require it again if batch processing is ever needed).

The front end is the **web tool** (`src/`, `pnpm dev`): treat an image in the browser —
pick the colour axis, an aspect-ratio preset (auto, 4:5 … 3:1, or the fixed 1200×630 OG
card), a resolution (480–2560 px wide; 1280 is the default) and a tone (dark, mid or light), drag the canvas to choose the
crop, then download.

Two export formats, both encoded as 1-bit indexed PNGs (exact 2-entry palette, so the
WCAG guarantees are byte-provable):

- **PNG** — the current tone.
- **Adaptive SVG** — the dark and light tones embedded, one file (mid is PNG-only).
  Unreferenced, it follows the system scheme (`prefers-color-scheme`); referenced with
  a fragment (`…svg#dark` / `…svg#light`) that tone is forced via `:target`, which is
  how a Set page selects the tone its theme cascade resolves to.
