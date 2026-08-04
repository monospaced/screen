/*
 * Screen — Set brand image treatment (shared core).
 * Pure JS, no dependencies. Used by the web tool (browser + Canvas); UMD so Node can require it too.
 *
 * screenCore(rgb, W, H, axis)
 *   rgb  : Uint8 RGB buffer, length W*H*3, already resized to the 640 grid
 *   axis : "cyan" | "neutral"
 *   ->   : Uint8ClampedArray RGB, length W*H*3, treated (2 palette colours only)
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

  function screenCore(rgb, W, H, axis) {
    var pair = AXES[axis];
    if (!pair) throw new Error("axis must be 'cyan' or 'neutral'");
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
  if (typeof module !== "undefined" && module.exports)
    module.exports = { screenCore: screenCore, AXES: AXES };
})(typeof globalThis !== "undefined" ? globalThis : this);
