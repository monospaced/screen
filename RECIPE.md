# Set — Brand Image Treatment

The signature treatment that turns a photograph into a **brand image**: a dark
(or light), duotone, ordered-dither bitmap on the cyan (or neutral) axis. It reads as
an early computer display — terminals, IDEs, 1-bit screens — which is the point.

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
   regardless of final output size. 640 is the chosen resolution — legible even on dense
   content, still unmistakably a bitmap.
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

The four CMYK inks — cyan, magenta, yellow, and neutral (K). The dark endpoints are
the default; the light endpoints are the **light variant** (the "Light" toggle), for
light-mode contexts:

| Axis    | Dark shadow (0)          | Dark highlight (1)       | Light shadow (0)        | Light highlight (1)     |
| ------- | ------------------------ | ------------------------ | ----------------------- | ----------------------- |
| Cyan    | `cyan.1200` `#001919`    | `cyan.1000` `#004848`    | `cyan.500` `#5ec2c2`    | `cyan.100` `#f4fbfb`    |
| Magenta | `magenta.1200` `#2e002e` | `magenta.1000` `#770077` | `magenta.500` `#e797e7` | `magenta.100` `#fdf8fd` |
| Yellow  | `yellow.1200` `#171700`  | `yellow.1000` `#424202`  | `yellow.500` `#b7b754`  | `yellow.100` `#fafaf4`  |
| Neutral | `neutral.1200` `#0b0c0c` | `neutral.800` `#424444`  | `neutral.500` `#a5a8a7` | `neutral.100` `#f8fbfb` |

### Why those endpoint caps (WCAG)

**Dark:** the highlight endpoint is the **brightest pixel the image can ever contain**
(2-level → every pixel is one of the two endpoints; the ordered pattern can't exceed the
highlight). The caps are chosen so that brightest pixel keeps both dark-mode foregrounds at
**≥ 4.5:1 (WCAG AA)** anywhere on the image, with no legibility shims:

- `#c8c9c9` (neutral hover, default theme) — cyan 6.3 · magenta 6.2 · yellow 6.3 · neutral 5.9
- `rgba(255,255,255,.8)` (brand theme) — cyan 7.3 · magenta 6.9 · yellow 7.4 · neutral 7.0

So OG/hero text can sit anywhere over the image and pass.

**Light:** reversed — the shadow endpoint is the **darkest pixel the image can ever
contain**, floored so the light-mode default text `#0b0c0c` keeps **≥ 4.5:1 (WCAG AA)**
anywhere on the image (8.2–9.3:1, default and brand themes). The neutral hover `#007c7c`
carries no such guarantee: it only reaches 4.76:1 on pure white, so no visible light image
can pass it — the light variant guarantees default text only.

## Fixed decisions (settled, do not re-litigate without reason)

- **2-level only.** No 3-level variant — protects the pure binary/cursor story.
- **Square cells (1:1).** A 1:2 "mono-cell" dither was explored; it costs vertical detail and
  adds a scanline, and the 1:2 tie isn't perceptible at texture scale. Square is just as
  on-grid. (See alternate below.)
- **Single resolution: 640.** No multi-resolution scaling.

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
  smear the dot edges and break the exact 2-colour WCAG guarantee. Serve the 1280px export and
  let the browser scale it smoothly. Reflow (WCAG 1.4.10, 320px) means render sizes are always
  fluid, and continuous scaling of the 640-grid dither under nearest-neighbour produces moiré in
  the 1–3× device-scale range — `image-rendering: pixelated` must _not_ be applied on the web.
  Smooth resampling at the mild scales the master actually renders at (~0.5–1.5×) keeps the
  screen texture legible and degrades gracefully at every size and DPR — and it only ever
  interpolates _between_ the two endpoint colours, so the WCAG caps still hold. (Why:
  nearest-neighbour is only clean at integer device-pixel multiples; tone in this treatment
  lives in a 1-pixel-period dither, so non-integer factors beat against it — and fluid layouts
  make non-integer factors the norm.)
- **One asset per image — no responsive variants.** Skip `srcset`/`sizes`: resampled variants
  would re-sample the dither at non-integer factors and smear the grid, the 1280px asset keeps
  browser scaling at or below ~1.5× across real render sizes (where smoothing barely softens
  the pattern), and the 2-colour PNGs are tiny anyway.
  (Art-direction with `<picture media>` across the ratio presets is fine — that switches crops,
  not resolutions.)
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
pick the colour axis, toggle the light variant, pick an aspect-ratio preset (auto,
4:5 … 21:9 at 1280 wide, or the fixed 1200×630 OG card), drag the canvas to choose the
crop, then download.

Two export formats, both encoded as 1-bit indexed PNGs (exact 2-entry palette, so the
WCAG guarantees are byte-provable):

- **PNG** — the current variant.
- **Adaptive SVG** — both variants embedded, one file. Unreferenced, it follows the
  system scheme (`prefers-color-scheme`); referenced with a fragment
  (`…svg#dark` / `…svg#light`) that variant is forced via `:target`, which is how a
  Set page selects the variant its theme cascade resolves to.
