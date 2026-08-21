/*
 * Screen — Set brand image treatment (shared core).
 * Pure JS, no dependencies. Used by the web tool (browser + Canvas); UMD so Node can require it too.
 *
 * screenCore(rgb, W, H, axis, tone)
 *   rgb   : Uint8 RGB buffer, length W*H*3, already resized to the 640 grid
 *   axis  : "cyan" | "magenta" | "yellow" | "neutral"
 *   tone  : "dark" (default) | "mid" | "light" — the endpoint pair set
 *   ->    : Uint8ClampedArray RGB, length W*H*3, treated (2 palette colours only)
 *
 * Pipeline: luminance -> auto-levels (2/98 pct) -> gamma 0.7 -> 8x8 Bayer, 2-level -> map.
 */
(function (global) {
  // Palette endpoints. Highlight caps keep #c8c9c9 and rgba(255,255,255,.8) >= 4.5:1 (WCAG AA).
  var AXES = {
    cyan: [
      [0, 25, 25],
      [0, 72, 72],
    ], // cyan.1200 #001919 -> cyan.1000 #004848
    magenta: [
      [46, 0, 46],
      [119, 0, 119],
    ], // magenta.1200 #2e002e -> magenta.1000 #770077
    yellow: [
      [23, 23, 0],
      [66, 66, 2],
    ], // yellow.1200 #171700 -> yellow.1000 #424202
    neutral: [
      [11, 12, 12],
      [66, 68, 68],
    ], // neutral.1200 #0b0c0c -> neutral.800 #424444  (K)
  };
  // Light variant: reversed logic — the shadow endpoint is the *darkest*
  // pixel the image can contain. The 500 shadows keep the light-mode prose
  // text #0e0f0f (and with it the darker default text #0b0c0c) >= 4.5:1
  // (WCAG AA) anywhere on the image (8.0-9.1:1) in the mnsp light default +
  // brand themes, and match the dark treatment's ~2:1 endpoint separation.
  // Unlike the dark treatment, the neutral hover #007c7c is not guaranteed —
  // it only reaches 4.76:1 on pure white, so no visible light image can pass
  // it.
  var AXES_LIGHT = {
    cyan: [
      [94, 194, 194],
      [244, 251, 251],
    ], // cyan.500 #5ec2c2 -> cyan.100 #f4fbfb (9.30 vs #0b0c0c, sep 2.01)
    magenta: [
      [231, 151, 231],
      [253, 248, 253],
    ], // magenta.500 #e797e7 -> magenta.100 #fdf8fd (9.31, sep 2.01)
    yellow: [
      [183, 183, 84],
      [250, 250, 244],
    ], // yellow.500 #b7b754 -> yellow.100 #fafaf4 (9.25, sep 2.02)
    neutral: [
      [165, 168, 167],
      [248, 251, 251],
    ], // neutral.500 #a5a8a7 -> neutral.100 #f8fbfb (8.17, sep 2.30)
  };
  // Mid variant: the ramp segment between the dark and light ranges (inks:
  // dark takes 1200-1000 and light 500-100, so mid is 900-600) — for imagery
  // with no text over it, sitting acceptably on both light and dark
  // surroundings. No text guarantee, but black keeps >= 3:1 against both
  // endpoints (the 900 primitives are floored for exactly this) — WCAG
  // 1.4.11, so the black logo mark can sit on mid imagery. PNG export only
  // (the adaptive SVG embeds dark + light). The neutral ramp is spread too
  // evenly for its strict between-segment (700-600, 1.66) to match the ink
  // separations, so neutral mid shares its highlight step with the light
  // shadow: 700-500 at 2.38.
  var AXES_MID = {
    cyan: [
      [0, 100, 100],
      [59, 169, 169],
    ], // cyan.900 #006464 -> cyan.600 #3ba9a9 (sep 2.47)
    magenta: [
      [149, 39, 149],
      [212, 120, 212],
    ], // magenta.900 #952795 -> magenta.600 #d478d4 (sep 2.48)
    yellow: [
      [92, 93, 1],
      [158, 158, 55],
    ], // yellow.900 #5c5d01 -> yellow.600 #9e9e37 (sep 2.45)
    neutral: [
      [100, 103, 102],
      [165, 168, 167],
    ], // neutral.700 #646766 -> neutral.500 #a5a8a7 (sep 2.38)
  };
  var PAIRS = { dark: AXES, mid: AXES_MID, light: AXES_LIGHT };
  var GAMMA = 0.7,
    BLACK_PCT = 0.02,
    WHITE_PCT = 0.98;

  function bayer8() {
    var m = [[0]];
    while (m.length < 8) {
      var s = m.length,
        ns = s * 2,
        nm = [];
      for (var y = 0; y < ns; y++) nm.push(new Array(ns));
      for (y = 0; y < s; y++)
        for (var x = 0; x < s; x++) {
          var v = m[y][x];
          nm[y][x] = 4 * v;
          nm[y][x + s] = 4 * v + 2;
          nm[y + s][x] = 4 * v + 3;
          nm[y + s][x + s] = 4 * v + 1;
        }
      m = nm;
    }
    var flat = new Float64Array(64);
    for (y = 0; y < 8; y++)
      for (x = 0; x < 8; x++) flat[y * 8 + x] = m[y][x] / 64;
    return flat;
  }

  // percentile with linear interpolation (matches numpy default)
  function pct(sorted, p) {
    var rank = p * (sorted.length - 1),
      lo = Math.floor(rank),
      frac = rank - lo;
    return lo + 1 < sorted.length
      ? sorted[lo] + frac * (sorted[lo + 1] - sorted[lo])
      : sorted[lo];
  }

  function screenCore(rgb, W, H, axis, tone) {
    var axes = PAIRS[tone || "dark"];
    if (!axes) throw new Error("tone must be 'dark', 'mid' or 'light'");
    var pair = axes[axis];
    if (!pair)
      throw new Error("axis must be 'cyan', 'magenta', 'yellow' or 'neutral'");
    var shadow = pair[0],
      high = pair[1],
      N = W * H;

    var lum = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      lum[i] =
        (0.2126 * rgb[i * 3] +
          0.7152 * rgb[i * 3 + 1] +
          0.0722 * rgb[i * 3 + 2]) /
        255;
    }
    var sorted = Float32Array.from(lum).sort();
    var blk = pct(sorted, BLACK_PCT),
      wht = pct(sorted, WHITE_PCT);
    var denom = Math.max(wht - blk, 1e-6);

    var B = bayer8(),
      out = new Uint8ClampedArray(N * 3);
    for (var y = 0; y < H; y++)
      for (var x = 0; x < W; x++) {
        i = y * W + x;
        var t = (lum[i] - blk) / denom;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        t = Math.pow(t, GAMMA);
        var c = t > B[(y % 8) * 8 + (x % 8)] ? high : shadow;
        out[i * 3] = c[0];
        out[i * 3 + 1] = c[1];
        out[i * 3 + 2] = c[2];
      }
    return out;
  }

  global.screenCore = screenCore;
  global.SCREEN_AXES = AXES;
  global.SCREEN_PAIRS = PAIRS;
  if (typeof module !== "undefined" && module.exports)
    module.exports = {
      screenCore: screenCore,
      AXES: AXES,
      PAIRS: PAIRS,
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
