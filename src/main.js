// Set design system — fonts before core styles.
import "@monospaced/set-assets/fonts.css";
import "@monospaced/set-core/styles.css";
import "./style.css";
// Shared treatment core. Loaded for its side effect: it assigns
// globalThis.screenCore (see screen-core.js), which the Node CLI consumes too.
import "../shared/screen-core.js";

// Lossless WebP frame encoder (small WASM). We do our own animation muxing
// (see encodeScreenWebP) so we only need the single-frame encoder.
import { encode as encodeWebpFrame } from "@jsquash/webp";
import {
  defineSetLightswitch,
  defineSetMenu,
  defineSetSidebar,
  SET_MENU_EVENT_CHOOSE,
} from "@monospaced/set-core";

// Default demo image — a normal fingerprinted asset (served over http, so the
// canvas is never tainted).
import exampleUrl from "./example.jpg";
import { RATIOS } from "./ratios.mjs";

// The Set markup is prerendered into index.html at build time (see
// vite.config.mjs / ui.js). Here we just upgrade the interactive custom
// elements we use (sidebar, lightswitch, menu) and wire behaviour onto the
// DOM.
defineSetSidebar();
defineSetLightswitch();
defineSetMenu();

const { screenCore, screenToneField, SCREEN_PAIRS, SCREEN_BAYER } = globalThis;
// Output = grid (RES) × UPSCALE. UPSCALE stays 2 (the hard 2×2 "dot"); the
// Resolution control varies the grid, so 640/1280/2560 = grid 320/640/1280
// dots. Constant dot size, more dots = finer. RES fixes the output WIDTH for
// the aspect presets — a portrait ratio just runs taller (4:5 at res 1280 is
// 1280×1600) — and the longest edge for the free-form default. Grid is derived
// per render from `resolution`; the OG preset keeps its fixed 1200×630.
const UPSCALE = 2,
  OG_W = 1200,
  OG_H = 630;
let axis = "cyan",
  tone = "mid",
  ratio = "default",
  resolution = "1280", // output longest edge in px: "640" | "1280" | "2560"
  img = null,
  baseName = "image";
// Crop position for the aspect-ratio presets, as fractions of the crop slack
// on each axis (0 = top/left edge, 0.5 = centred, 1 = bottom/right edge).
// Only one axis ever has slack — whichever the source overflows the frame on.
let cropX = 0.5,
  cropY = 0.5,
  cropGeom = null, // {sw, sh, slackX, slackY} of the current crop, null when uncropped
  outCanvas = null,
  lastRender = null; // {rgb, Wc, Hc, up} of the current crop, for the SVG variants
// Motion state — declared with the top-level state because loadImage (called
// at module eval for the demo image) writes the pending-dissolve flag.
let scanOn = false, // ambient scan sweep loop
  dissolveOn = true, // dissolve-in entrance on image load (Load on by default)
  pendingDissolve = false; // set on image load, consumed by render()
const stage = document.getElementById("stage");
// True while a chosen download builds/saves. Serializes downloads: the choose
// handler bails while it's set, so a second click can't race a build over one
// already in flight.
let downloading = false;

const downloadMenu = document.getElementById("download");
// Show/clear the trigger's busy state via the menu's reactive triggerActivity
// prop (primed to "idle" in ui.mjs): "busy" swaps its icon for a spinner and
// sets aria-disabled. Cosmetic/a11y only — `downloading` is the real guard.
function setDownloading(on) {
  downloading = on;
  downloadMenu.triggerActivity = on ? "busy" : "idle";
}
// Build the picked variant on click and save it. Building is expensive (a motion
// WebP is dozens of frame encodes), so it's lazy and on demand — one variant,
// only when chosen.
downloadMenu.addEventListener(SET_MENU_EVENT_CHOOSE, async (e) => {
  const { id } = e.detail;
  if (downloading) return;
  setDownloading(true);
  try {
    // buildVariant blocks the thread with a synchronous encode before it yields,
    // and Set closes the menu only after this listener returns. Yield past a
    // paint first so the menu closes and the spinner shows before that block;
    // otherwise the popup lingers open long enough to click the other item.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
    const file = await buildVariant(id);
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    // Revoke once the click has kicked off the save; an immediate revoke can
    // cancel the download in some engines.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } finally {
    setDownloading(false);
  }
});

document.getElementById("axis").addEventListener("change", (e) => {
  axis = e.target.value;
  if (img) render();
});
document.getElementById("ratio").addEventListener("change", (e) => {
  ratio = e.target.value;
  if (img) render();
});
document.getElementById("tone").addEventListener("change", (e) => {
  tone = e.target.value;
  if (img) render();
});
document.getElementById("resolution").addEventListener("change", (e) => {
  resolution = e.target.value;
  if (img) render();
});
document.getElementById("scan").addEventListener("change", (e) => {
  scanOn = e.target.checked;
  if (!img) return;
  if (scanOn) startMotion();
  else {
    stopMotion();
    render(); // repaint the settled base frame
  }
});
document.getElementById("dissolve").addEventListener("change", (e) => {
  dissolveOn = e.target.checked;
  if (!img) return;
  if (dissolveOn)
    startDissolve(); // toggling on previews the entrance
  else render(); // abandon any running dissolve, settle to base
});

document.getElementById("choose").onclick = () =>
  document.getElementById("file").click();
document.getElementById("file").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  loadImage(URL.createObjectURL(f), f.name.replace(/\.[^.]+$/, ""));
};

function loadImage(src, name) {
  baseName = name;
  cropX = 0.5;
  cropY = 0.5;
  pendingDissolve = true; // entrance plays on the load's first render
  const im = new Image();
  im.onload = () => {
    img = im;
    render();
  };
  im.src = src;
}

// Keep the whole preview in the viewport: cap only the canvas's displayed
// height by however much the document overflows, so it shrinks (aspect ratio
// intact) instead of pushing the footer off-screen. Purely a display cap — the
// canvas pixel buffer, and so the downloaded PNG, is unaffected.
function fitCanvas() {
  const canvas = stage.querySelector("canvas");
  if (!canvas) return;
  canvas.style.maxBlockSize = "";
  const doc = document.documentElement;
  const overflow = doc.scrollHeight - doc.clientHeight;
  if (overflow > 0) {
    const shown = canvas.getBoundingClientRect().height;
    canvas.style.maxBlockSize = Math.max(0, shown - overflow) + "px";
  }
}

let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    fitCanvas();
  });
});

// Crop drag: while the crop has slack on an axis, drag the canvas to
// choose which part of the source the crop keeps. Handlers live on the stage
// (which persists) and the offset maps display px -> source px through the
// current crop geometry. Double-click re-centres. The download blob is only
// rebuilt when the drag ends — mid-drag renders skip it.
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
let dragging = false,
  lastX = 0,
  lastY = 0,
  dragRenderQueued = false;

stage.addEventListener("pointerdown", (e) => {
  if (e.target !== outCanvas) return;
  if (!cropGeom || (cropGeom.slackX < 1 && cropGeom.slackY < 1)) return;
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  stage.setPointerCapture(e.pointerId);
  outCanvas.classList.add("dragging");
  e.preventDefault();
});

stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const rect = outCanvas.getBoundingClientRect();
  const dx = e.clientX - lastX,
    dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  // The displayed canvas shows exactly the crop rect, so scale display px by
  // sw/rect.width. Dragging moves the image, so the crop moves the other way.
  if (cropGeom.slackX >= 1 && rect.width)
    cropX = clamp01(cropX - (dx * cropGeom.sw) / rect.width / cropGeom.slackX);
  if (cropGeom.slackY >= 1 && rect.height)
    cropY = clamp01(cropY - (dy * cropGeom.sh) / rect.height / cropGeom.slackY);
  if (!dragRenderQueued) {
    dragRenderQueued = true;
    requestAnimationFrame(() => {
      dragRenderQueued = false;
      render();
    });
  }
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  outCanvas.classList.remove("dragging");
}
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);

stage.addEventListener("dblclick", () => {
  if (!cropGeom) return;
  cropX = 0.5;
  cropY = 0.5;
  render();
});

// Default image — treated on load, no empty state.
loadImage(exampleUrl, "example");

function render() {
  const w = img.naturalWidth,
    h = img.naturalHeight;
  const RES = Number(resolution) / UPSCALE; // grid longest edge (dots)
  let Wc, Hc, up;
  const g = document.createElement("canvas");
  const gx = g.getContext("2d");
  gx.imageSmoothingEnabled = true;

  const preset = RATIOS.find((r) => r.key === ratio);
  if (preset.ar) {
    if (preset.key === "og") {
      Wc = OG_W / 2;
      Hc = OG_H / 2; // fixed OG size: 600x315 grid, x2 -> 1200x630
    } else {
      Wc = RES;
      Hc = Math.max(1, Math.round(RES / preset.ar)); // x2 -> 1280 wide
    }
    up = UPSCALE;
    g.width = Wc;
    g.height = Hc;
    const tAR = Wc / Hc,
      sAR = w / h;
    let sw, sh; // cover-crop to the preset aspect, positioned by the drag offset
    if (sAR > tAR) {
      sh = h;
      sw = h * tAR;
    } else {
      sw = w;
      sh = w / tAR;
    }
    cropGeom = { sw, sh, slackX: w - sw, slackY: h - sh };
    const sx = cropGeom.slackX * cropX,
      sy = cropGeom.slackY * cropY;
    gx.drawImage(img, sx, sy, sw, sh, 0, 0, Wc, Hc);
  } else {
    cropGeom = null;
    if (w >= h) {
      Wc = RES;
      Hc = Math.max(1, Math.round((RES * h) / w));
    } else {
      Hc = RES;
      Wc = Math.max(1, Math.round((RES * w) / h));
    }
    up = UPSCALE;
    g.width = Wc;
    g.height = Hc;
    gx.drawImage(img, 0, 0, Wc, Hc); // aspect preserved, no crop
  }

  const src = gx.getImageData(0, 0, Wc, Hc).data;
  const rgb = new Uint8Array(Wc * Hc * 3);
  for (let i = 0; i < Wc * Hc; i++) {
    rgb[i * 3] = src[i * 4];
    rgb[i * 3 + 1] = src[i * 4 + 1];
    rgb[i * 3 + 2] = src[i * 4 + 2];
  }
  // pair rides along for Motion, which repaints frames on the displayed
  // treatment's two endpoints. The tone field (axis/tone-independent) is
  // computed once per crop here and reused everywhere — the treatment below,
  // the motion frames, and the export variants.
  const t = screenToneField(rgb, Wc, Hc);
  lastRender = { rgb, Wc, Hc, up, t, pair: SCREEN_PAIRS[tone][axis] };

  const out = screenCore(rgb, Wc, Hc, axis, tone, t);

  const grid = gx.createImageData(Wc, Hc);
  for (let i = 0; i < Wc * Hc; i++) {
    grid.data[i * 4] = out[i * 3];
    grid.data[i * 4 + 1] = out[i * 3 + 1];
    grid.data[i * 4 + 2] = out[i * 3 + 2];
    grid.data[i * 4 + 3] = 255;
  }
  gx.putImageData(grid, 0, 0);

  // One persistent output canvas: re-renders during a crop drag must not
  // replace the element, or the pointer capture (and the drag) would die.
  if (!outCanvas) {
    outCanvas = document.createElement("canvas");
    stage.appendChild(outCanvas);
  }
  if (outCanvas.width !== Wc * up) outCanvas.width = Wc * up;
  if (outCanvas.height !== Hc * up) outCanvas.height = Hc * up;
  const ux = outCanvas.getContext("2d");
  ux.imageSmoothingEnabled = false;
  ux.drawImage(g, 0, 0, outCanvas.width, outCanvas.height);

  const draggable = cropGeom && (cropGeom.slackX >= 1 || cropGeom.slackY >= 1);
  if (draggable) outCanvas.setAttribute("data-draggable", "");
  else outCanvas.removeAttribute("data-draggable");

  fitCanvas();
  // The base frame changed, so any running motion is stale — restart it on the
  // new treatment. A fresh image load plays the dissolve entrance first (which
  // hands off to the scan loop itself when done).
  const entrance = pendingDissolve && dissolveOn;
  pendingDissolve = false;
  if (entrance) startDissolve();
  else if (scanOn) startMotion();
  else stopMotion();
}

// ---- Motion ----
// Two canvas animations, both driven off the cached tone field (the treatment
// pipeline minus the threshold, from screenToneField), so each frame is one
// cheap threshold pass — nothing re-runs the histogram. Both paint only the
// two palette endpoints, so the image stays a 2-level bitmap (and the WCAG
// guarantee holds) throughout. These are the live on-screen preview; the
// download re-bakes the same frames as an animated WebP (see motionWebP).
//
//   Scan — an ambient loop (a refresh sweep, à la an Amiga copper bar): a
//          soft Gaussian band drifts down the grid, lifting the dither
//          threshold as it passes so a thin rim of extra dots lights within
//          it. The motion follows the band, not the tone, so it is edge-
//          neutral and works on any subject.
//   Load — the dissolve entrance: on image load the picture materialises from
//          blank in dither-matrix order. One-shot; see startDissolve.

// Scan constants, anchored to the dither structure (copper bars have no
// canonical parameters of their own):
//   AMP   — peak threshold lift as k/64, so the band lights k of the matrix's
//           64 ranks at its centre. k = 4 (a Bayer-native step, 1/16 of the
//           range).
//   WIDTH — band sigma as a fraction of grid height, at the "knee": the
//           narrowest band with no perceptibly-frozen zone. The far point
//           (Hc/2, at 0.5/WIDTH sigma) gets boost AMP*exp(-(0.5/WIDTH)^2/2),
//           which lights ≈ that fraction of cells; pinning it to a negligible
//           ε ≈ 2.4e-4 gives WIDTH = 0.5/sqrt(2*ln(AMP/ε)) ≈ 0.15.
// A fixed point brightens and dims once per sweep (0.2Hz) — far under WCAG
// 2.3.1's 3-flash limit.
const SCAN_AMP = 4 / 64,
  SCAN_WIDTH = 0.15;

// The two motion clocks, both 5000ms so all motion shares one cadence:
// 5000ms = one resting human breath (~12/min, 0.2Hz), the slow-physiology
// tempo that reads as calm rather than busy. SCAN_SWEEP_MS is ms for the band
// to cross top to bottom; DISSOLVE_MS is ms for the entrance to fully resolve.
const SCAN_SWEEP_MS = 5000,
  DISSOLVE_MS = 5000;

const B8 = SCREEN_BAYER;

let anim = null; // {canvas, ctx, image, t, start, raf}

function stopMotion() {
  if (anim) cancelAnimationFrame(anim.raf);
  anim = null;
}

// Shared frame state for the scan loop and the dissolve entrance: an offscreen
// grid-size canvas and the tone field of the current crop.
function buildAnim() {
  const { Wc, Hc, t } = lastRender;
  const canvas = document.createElement("canvas");
  canvas.width = Wc;
  canvas.height = Hc;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(Wc, Hc);
  for (let i = 0; i < Wc * Hc; i++) image.data[i * 4 + 3] = 255;
  anim = {
    canvas,
    ctx,
    image,
    t,
    start: 0,
    raf: 0,
  };
}

function blitAnim() {
  anim.ctx.putImageData(anim.image, 0, 0);
  const ux = outCanvas.getContext("2d");
  ux.imageSmoothingEnabled = false;
  ux.drawImage(anim.canvas, 0, 0, outCanvas.width, outCanvas.height);
}

function startMotion() {
  // Keep the sweep phase across restarts (control changes, crop-drag
  // re-renders): carrying `start` over means elapsed — and so the band
  // position — continues instead of jumping back to the top.
  const start = anim ? anim.start : 0;
  stopMotion();
  buildAnim();
  anim.start = start;
  anim.raf = requestAnimationFrame(motionFrame);
}

function motionFrame(ts) {
  if (!anim) return;
  if (!anim.start) anim.start = ts;
  // Scan is the only ambient loop: the band position is a continuous
  // function of wall time, repainted every frame.
  scanFrame(ts - anim.start);
  blitAnim();
  anim.raf = requestAnimationFrame(motionFrame);
}

// A soft Gaussian band centred at row yc drifts down the grid over
// SCAN_SWEEP_MS, lowering the dither threshold within it (brighter). The
// distance to the band wraps top-to-bottom so the sweep is seamless. The
// per-row boost is constant across x, so it costs one exp() per row.
//
// `reveal` (0..1) is the dissolve-entrance gate: a cell only shows once its
// matrix rank is below reveal, so Load can dissolve in the already-scanning
// image. reveal = 1 (the steady-state default) opens the gate everywhere.
function scanFrame(elapsed, reveal = 1) {
  const { Wc, Hc } = lastRender;
  const [shadow, high] = lastRender.pair;
  const yc = ((elapsed % SCAN_SWEEP_MS) / SCAN_SWEEP_MS) * Hc;
  const sigma = Math.max(1, SCAN_WIDTH * Hc);
  const twoSigma2 = 2 * sigma * sigma;
  const t = anim.t,
    d = anim.image.data;
  for (let y = 0; y < Hc; y++) {
    let dy = Math.abs(y - yc);
    if (dy > Hc - dy) dy = Hc - dy; // seamless wrap
    const boost = SCAN_AMP * Math.exp(-(dy * dy) / twoSigma2);
    for (let x = 0; x < Wc; x++) {
      const i = y * Wc + x;
      const b = B8[(y & 7) * 8 + (x & 7)];
      const c = b < reveal && t[i] > b - boost ? high : shadow;
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
    }
  }
}

// Dissolve entrance (one-shot), the HyperCard / Game Boy fade lineage. The
// image materialises from blank in dither-matrix order over DISSOLVE_MS: a
// cell shows its treated value once progress passes its matrix rank, holding
// the shadow ink until then. On a 2-level image this reveal is identical to
// rendering min(tone, progress) — a fade from black through the image's own
// dither. dissolvePaint is the plain reveal (Scan off); when Scan is also on
// the reveal runs through scanFrame instead, so the picture arrives already
// sweeping. Either way, when complete it hands off to the scan loop if on.
function dissolvePaint(p) {
  const [shadow, high] = lastRender.pair;
  paintFrame(
    (x, y) => {
      const b = B8[(y & 7) * 8 + (x & 7)];
      return b < p ? b : Infinity;
    },
    high,
    shadow,
  );
  blitAnim();
}

function startDissolve() {
  stopMotion();
  buildAnim();
  dissolvePaint(0); // blank immediately — no flash of the full base frame
  anim.raf = requestAnimationFrame(dissolveFrame);
}

function dissolveFrame(ts) {
  if (!anim) return;
  if (!anim.start) anim.start = ts;
  const elapsed = ts - anim.start;
  const p = Math.min(1, elapsed / DISSOLVE_MS);
  // Quantise to the 64 matrix levels — the stepped cadence of a period
  // dissolve (one threshold level at a time), not a smooth ramp.
  const reveal = p === 1 ? 1 : Math.floor(p * 64) / 64;
  // With Scan also on, reveal the already-scanning image; otherwise a plain
  // reveal from black.
  if (scanOn) {
    scanFrame(elapsed, reveal);
    blitAnim();
  } else dissolvePaint(reveal);
  if (p < 1) anim.raf = requestAnimationFrame(dissolveFrame);
  // Hand off to the steady scan loop reusing the same anim, so elapsed (and
  // thus the band position) carries over with no jump.
  else if (scanOn) anim.raf = requestAnimationFrame(motionFrame);
  else anim = null; // the p=1 frame is exactly the base treatment
}

// Repaint every cell: tone above the cutoff gets onColor, else offColor.
function paintFrame(thresholdAt, onColor, offColor) {
  const { Wc, Hc } = lastRender;
  const t = anim.t,
    d = anim.image.data;
  for (let y = 0; y < Hc; y++)
    for (let x = 0; x < Wc; x++) {
      const i = y * Wc + x;
      const c = t[i] > thresholdAt(x, y) ? onColor : offColor;
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
    }
}

// ---- 1-bit indexed PNG encoder ----
// Canvas toDataURL always emits 32-bit RGBA; for a 2-colour image a 1-bit
// indexed PNG is ~4x smaller, and writing the PLTE ourselves keeps the
// exact endpoint colours (the WCAG guarantee) byte-provable. Deflate comes
// from the native CompressionStream; everything else is a 2-entry PLTE and
// filter-0 scanlines.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let c = -1;
  for (let i = 4; i < 8 + data.length; i++)
    c = CRC_TABLE[(c ^ out[i]) & 0xff] ^ (c >>> 8);
  view.setUint32(8 + data.length, (c ^ -1) >>> 0);
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// out: screenCore RGB buffer at grid size; the nearest-neighbour x`up`
// upscale as 1-bit filter-0 scanlines. Any pixel that isn't the shadow colour
// is the highlight (2-level guarantee).
function screenRaw(out, Wc, Hc, up, pair) {
  const W = Wc * up,
    H = Hc * up;
  const shadow = pair[0];
  const rowBytes = Math.ceil(W / 8);
  const raw = new Uint8Array(H * (1 + rowBytes));
  for (let y = 0; y < H; y++) {
    const sy = (y / up) | 0,
      o = y * (1 + rowBytes) + 1;
    for (let x = 0; x < W; x++) {
      const s = (sy * Wc + ((x / up) | 0)) * 3;
      if (
        out[s] !== shadow[0] ||
        out[s + 1] !== shadow[1] ||
        out[s + 2] !== shadow[2]
      )
        raw[o + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return raw;
}

function ihdrIndexed(W, H) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, W);
  view.setUint32(4, H);
  ihdr[8] = 1; // bit depth: 1-bit (2-colour indexed)
  ihdr[9] = 3; // colour type: indexed
  return ihdr;
}

// Encodes the treatment as a 1-bit indexed PNG.
async function encodeScreenPNG(out, Wc, Hc, up, pair) {
  const W = Wc * up,
    H = Hc * up;
  const shadow = pair[0],
    high = pair[1];
  const raw = screenRaw(out, Wc, Hc, up, pair);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdrIndexed(W, H)),
    pngChunk("PLTE", new Uint8Array([...shadow, ...high])),
    pngChunk("IDAT", await deflate(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return bytes;
}

function concatChunks(parts) {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return bytes;
}

// ---- animated lossless WebP encoder ----
// Each frame is a lossless WebP (VP8L, via jSquash); we hand-mux the RIFF
// animation container ourselves. Frame 0 is the full image; each later frame
// is the bounding box of the cells that changed, with unchanged pixels left
// transparent so it blends OVER the accumulated canvas. That transparency-
// delta keeps the file small while staying pixel-exact to the canvas frames.

const u24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

// A RIFF chunk: FourCC + uint32-LE size + payload + pad byte if size is odd.
function webpChunk(fourcc, payload) {
  const size = payload.length;
  const out = new Uint8Array(8 + size + (size & 1));
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i);
  view.setUint32(4, size, true);
  out.set(payload, 8);
  return out;
}

// Pull the VP8L (lossless image) sub-chunk out of a single-frame WebP so it can
// be embedded as an animation frame's image data.
function extractVP8L(webp) {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  let o = 12; // skip "RIFF" + size + "WEBP"
  while (o + 8 <= webp.length) {
    const id = String.fromCharCode(
      webp[o],
      webp[o + 1],
      webp[o + 2],
      webp[o + 3],
    );
    const size = view.getUint32(o + 4, true);
    const advance = 8 + size + (size & 1);
    if (id === "VP8L") return webp.subarray(o, o + advance);
    o += advance;
  }
  throw new Error("no VP8L chunk (encoder was not lossless?)");
}

// One animation frame chunk. x/y are stored halved (ANMF offsets must be even —
// `up` is 2 so grid-aligned boxes always are). noBlend true = overwrite the
// canvas (frame 0, for a clean loop reset); false = alpha-blend OVER it.
function anmf(x, y, w, h, ms, noBlend, vp8l) {
  const hdr = new Uint8Array([
    ...u24(x >> 1),
    ...u24(y >> 1),
    ...u24(w - 1),
    ...u24(h - 1),
    ...u24(ms),
    noBlend ? 0x02 : 0x00, // bit1: blending (1=no-blend); bit0: disposal (0=none)
  ]);
  return webpChunk("ANMF", concatChunks([hdr, vp8l]));
}

// The RGBA sub-image for one frame. litPrev null = the full opaque image;
// otherwise the bounding box of changed cells, with unchanged pixels left
// transparent (alpha 0) so the frame is a sparse delta. Returns null for an
// identical frame. Nearest-neighbour x`up`, grid-cell colours from `pair`.
function webpFrame(lit, litPrev, Wc, Hc, up, pair) {
  const [shadow, high] = pair;
  const W = Wc * up,
    H = Hc * up;
  if (!litPrev) {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const gy = (y / up) | 0;
      for (let x = 0; x < W; x++) {
        const c = lit[gy * Wc + ((x / up) | 0)] ? high : shadow;
        const o = (y * W + x) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    }
    return { x: 0, y: 0, w: W, h: H, data, full: true };
  }
  let minC = Wc,
    minR = Hc,
    maxC = -1,
    maxR = -1;
  for (let r = 0; r < Hc; r++)
    for (let c = 0; c < Wc; c++) {
      const i = r * Wc + c;
      if (lit[i] !== litPrev[i]) {
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
    }
  if (maxC < 0) return null; // identical frame
  const x = minC * up,
    y = minR * up,
    w = (maxC - minC + 1) * up,
    h = (maxR - minR + 1) * up;
  const data = new Uint8ClampedArray(w * h * 4); // zero => transparent
  for (let py = 0; py < h; py++) {
    const gr = ((y + py) / up) | 0;
    for (let px = 0; px < w; px++) {
      const gc = ((x + px) / up) | 0;
      const i = gr * Wc + gc;
      if (lit[i] !== litPrev[i]) {
        const c = lit[i] ? high : shadow;
        const o = (py * w + px) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    }
  }
  return { x, y, w, h, data, full: false };
}

// `lits` is an array of grid-resolution 0/1 bitmaps (one per step). loop 0
// loops forever; sweepMs is the total animation duration — per-frame durations
// are distributed so they sum to it *exactly* (round the cumulative time, not
// each frame), so the total is a clean contract value (Set times the Load→Scan
// swap off it, and animated WebP fires no end event to detect). `isStale`
// (optional) lets a newer rebuild abort this one mid-encode. Yields to the
// event loop between batches so the main-thread encode never blocks the UI.
async function encodeScreenWebP(
  lits,
  Wc,
  Hc,
  up,
  pair,
  loop,
  sweepMs,
  isStale,
) {
  const W = Wc * up,
    H = Hc * up;
  const N = lits.length;
  const enc = async (data, w, h) =>
    extractVP8L(
      new Uint8Array(
        await encodeWebpFrame({ data, width: w, height: h }, { lossless: 1 }),
      ),
    );
  const parts = [];
  for (let k = 0; k < N; k++) {
    if (isStale?.()) return null; // superseded — stop wasting main-thread time
    // Drift-free: frame k spans the gap between two rounded cumulative times,
    // so the durations sum to round(sweepMs) with no accumulated rounding error.
    const ms =
      Math.round(((k + 1) * sweepMs) / N) - Math.round((k * sweepMs) / N);
    const f = webpFrame(lits[k], k > 0 ? lits[k - 1] : null, Wc, Hc, up, pair);
    if (!f) {
      // Identical frame: a 2x2 fully-transparent blend frame carries duration.
      const vp8l = await enc(new Uint8ClampedArray(2 * 2 * 4), 2, 2);
      parts.push(anmf(0, 0, 2, 2, ms, false, vp8l));
    } else {
      const vp8l = await enc(f.data, f.w, f.h);
      parts.push(anmf(f.x, f.y, f.w, f.h, ms, f.full, vp8l));
    }
    // Every 8th frame, hand the main thread back so queued input and rAF paints
    // run between batches (setTimeout, not rAF — rAF is throttled under load).
    if ((k & 7) === 7) await new Promise((r) => setTimeout(r));
  }
  const vp8x = webpChunk(
    "VP8X",
    new Uint8Array([0x12, 0, 0, 0, ...u24(W - 1), ...u24(H - 1)]), // flags: animation + alpha
  );
  const anim = webpChunk(
    "ANIM",
    new Uint8Array([0, 0, 0, 0, loop & 255, (loop >> 8) & 255]),
  );
  const body = concatChunks([vp8x, anim, ...parts]);
  const riff = new Uint8Array(12 + body.length);
  const view = new DataView(riff.buffer);
  riff.set([82, 73, 70, 70], 0); // "RIFF"
  view.setUint32(4, 4 + body.length, true);
  riff.set([87, 69, 66, 80], 8); // "WEBP"
  riff.set(body, 12);
  return riff;
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// Re-treat the current crop for one tone, as 1-bit PNG bytes.
function variantPNG(variantTone, variantAxis) {
  const { rgb, Wc, Hc, up, t } = lastRender;
  const out = screenCore(rgb, Wc, Hc, variantAxis, variantTone, t);
  const pair = SCREEN_PAIRS[variantTone][variantAxis];
  return encodeScreenPNG(out, Wc, Hc, up, pair);
}

// Adaptive SVG: both endpoint variants embedded as data-URI PNGs, switched by
// the SVG's own stylesheet. With no fragment the system scheme decides
// (light base, prefers-dark flips — the dark-favicon technique, works via
// <img>). Referenced with a fragment (…svg#dark / …svg#light) the :target
// rules override the scheme and force that variant — Set's own theme cascade
// picks the fragment, so this file carries no Set-specific selectors.
const SCREEN_THEME_CSS =
  `.screen-dark{display:none}` +
  `@media (prefers-color-scheme:dark){.screen-dark{display:inline}.screen-light{display:none}}` +
  `:root:has(:target) .screen-light,:root:has(:target) .screen-dark{display:none}` +
  `:root:has(:target) :target{display:inline}`;

async function adaptiveSvg(variantAxis) {
  const { Wc, Hc, up } = lastRender;
  const W = Wc * up,
    H = Hc * up;
  const [dark, lightVar] = await Promise.all(
    [variantPNG("dark", variantAxis), variantPNG("light", variantAxis)].map(
      (p) =>
        p.then((bytes) =>
          blobToDataURL(new Blob([bytes], { type: "image/png" })),
        ),
    ),
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<style>${SCREEN_THEME_CSS}</style>` +
    `<image id="dark" class="screen-dark" width="${W}" height="${H}" href="${dark}"/>` +
    `<image id="light" class="screen-light" width="${W}" height="${H}" href="${lightVar}"/>` +
    `</svg>`
  );
}

// Animated WebP of the current tone's treatment with the active motion. Single
// tone (adaptive theming is composed outside Screen from separate exports), so
// no filter/scheme juggling — just faithful canvas frames. Scan → seamless
// loop; Load → dissolve entrance, played once, freezing on the full image;
// both → the concurrent entrance once.
//
// Frame count is per-mode, and only one mode is timing-critical:
//   Scan (96, ~20fps) — perpetual loop; its delta is just the thin moving band,
//     cheap to decode, and nothing waits on its exact duration.
//   Load (64) — plays once and freezes on the full image. Nothing waits on it
//     either: if a slow decoder stretches it, the entrance just resolves later,
//     then holds. So it keeps the smooth 1-Bayer-rank-per-frame reveal.
//   Load+Scan — the only timing-critical case: it's played once and then hidden
//     by a fixed JS timer (~5s from load) to reveal the Scan loop under it,
//     since there's no "animation ended" event. So it MUST play a predictable
//     5s on every engine. Its per-frame delta is full-frame (the dissolve
//     reveals cells scattered across the whole image in Bayer order), and at
//     full frame count Safari can't decode on schedule — at 1280 it stretches a
//     5s entrance to ~11s (Chrome plays it true). Decode cost scales with pixels
//     (∝ resolution²), so the safe frame count scales inversely: quartering the
//     pixels lets us quadruple the frames. Keyed off the Resolution control, all
//     three confirmed to play ~5s in Safari (2560 is a coarse 8-step dissolve).
const SCAN_FRAMES = 96,
  LOAD_FRAMES = 64;
const LOAD_SCAN_FRAMES = { 640: 64, 1280: 32, 2560: 8 };

async function motionWebP({ axis, tone, scanOn, dissolveOn, resolution }) {
  const { Wc, Hc, up, t } = lastRender;
  const pair = SCREEN_PAIRS[tone][axis];
  const sigma = SCAN_WIDTH * Hc;
  // One frame's grid-resolution 0/1 bitmap: scan band centred at row yc (or
  // none), gated by dissolve progress reveal (1 = fully revealed).
  const frameLit = (yc, reveal) => {
    const lit = new Uint8Array(Wc * Hc);
    for (let y = 0; y < Hc; y++) {
      let boost = 0;
      if (yc !== null) {
        let dy = Math.abs(y - yc);
        if (dy > Hc - dy) dy = Hc - dy;
        boost = SCAN_AMP * Math.exp(-(dy * dy) / (2 * sigma * sigma));
      }
      for (let x = 0; x < Wc; x++) {
        const i = y * Wc + x;
        const b = B8[(y & 7) * 8 + (x & 7)];
        lit[i] = b < reveal && t[i] > b - boost ? 1 : 0;
      }
    }
    return lit;
  };
  // Load+Scan is capped for Safari's decode budget (it's the timing-critical,
  // hidden-after-5s case) per the active resolution; Load-only stays smooth;
  // pure Scan uses its own count.
  const N = dissolveOn
    ? scanOn
      ? LOAD_SCAN_FRAMES[resolution]
      : LOAD_FRAMES
    : SCAN_FRAMES;
  const lits = [];
  for (let k = 0; k < N; k++) {
    const yc = scanOn ? (k / N) * Hc : null;
    // Dissolve ramps 0→1 across the frames; when Load is off, fully revealed.
    const reveal = dissolveOn ? (k + 1) / N : 1;
    lits.push(frameLit(yc, reveal));
  }
  const loop = dissolveOn ? 1 : 0; // Load plays once; Scan loops forever
  // Total duration is exactly SCAN_SWEEP_MS — the Load entrance runs 5000ms,
  // which Set relies on to time the swap to the Scan loop.
  return encodeScreenWebP(lits, Wc, Hc, up, pair, loop, SCAN_SWEEP_MS);
}

// Build one export variant ("png" = raster slot, "svg" = adaptive pair) from a
// snapshot of the current settings, returning its { blob, name } (null if nothing
// is rendered yet). The snapshot keeps the file's bytes matching its name even if
// a control changes mid-build.
async function buildVariant(id) {
  if (!lastRender) return null;
  const s = { axis, tone, ratio, resolution, scanOn, dissolveOn };
  const suffix = s.ratio === "default" ? "" : `--${s.ratio}`;
  // Resolution suffix (empty for the 1280 default, like Ratio) so exports at
  // different resolutions don't collide.
  const resSuffix = s.resolution === "1280" ? "" : `--${s.resolution}`;
  const stem = `${baseName}--${s.axis}${suffix}${resSuffix}`;

  // The SVG is always the static adaptive dark/light pair.
  if (id === "svg") {
    const svg = await adaptiveSvg(s.axis);
    return {
      blob: new Blob([svg], { type: "image/svg+xml" }),
      name: `${stem}--adaptive.svg`,
    };
  }

  // The raster slot is an animated lossless WebP (current tone) when a motion is
  // on, otherwise the static 1-bit PNG — WebP for the animated case, but PNG
  // kept for static so the still stays maximally portable (OG images etc.).
  const motion = s.scanOn || s.dissolveOn;
  const image = motion ? await motionWebP(s) : await variantPNG(s.tone, s.axis);
  // Name the motion so exports are distinguishable: --scan, --load, or
  // --load-scan (both). Static stills carry no motion suffix.
  const animSuffix =
    s.scanOn && s.dissolveOn
      ? "--load-scan"
      : s.dissolveOn
        ? "--load"
        : s.scanOn
          ? "--scan"
          : "";
  const toneSuffix = `--${s.tone}`; // tone (Set's light/dark scheme) goes last
  return {
    blob: new Blob([image], { type: motion ? "image/webp" : "image/png" }),
    name: `${stem}${animSuffix}${toneSuffix}.${motion ? "webp" : "png"}`,
  };
}
