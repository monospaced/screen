// Set design system — fonts before core styles.
import "@monospaced/set-assets/fonts.css";
import "@monospaced/set-core/styles.css";
import "./style.css";
// Shared treatment core. Loaded for its side effect: it assigns
// globalThis.screenCore (see screen-core.js), which the Node CLI consumes too.
import "../shared/screen-core.js";

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

const { screenCore, SCREEN_AXES, SCREEN_AXES_LIGHT } = globalThis;
const RES = 640,
  UPSCALE = 2,
  OG_W = 1200,
  OG_H = 630;
let axis = "cyan",
  light = false,
  ratio = "default",
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
const stage = document.getElementById("stage");
// Current export blobs, keyed by menu item id; null until the first
// treatment exists.
const downloads = { png: null, svg: null };

document
  .getElementById("download")
  .addEventListener(SET_MENU_EVENT_CHOOSE, (e) => {
    const file = downloads[e.detail.id];
    if (!file) return;
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name;
    a.click();
  });

document.getElementById("axis").addEventListener("change", (e) => {
  axis = e.target.value;
  if (img) render();
});
document.getElementById("ratio").addEventListener("change", (e) => {
  ratio = e.target.value;
  if (img) render();
});
document.getElementById("light").addEventListener("change", (e) => {
  light = e.target.checked;
  if (img) render();
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
      render(false);
    });
  }
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  outCanvas.classList.remove("dragging");
  updateDownload();
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

function render(updateDl = true) {
  const w = img.naturalWidth,
    h = img.naturalHeight;
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
  lastRender = { rgb, Wc, Hc, up };

  const out = screenCore(rgb, Wc, Hc, axis, light);

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
  if (updateDl) updateDownload();
}

// ---- 1-bit indexed PNG encoder ----
// Canvas toDataURL always emits 32-bit RGBA; for a 2-colour image a 1-bit
// indexed PNG is ~4x smaller (and being our own encoder, the exact palette
// is byte-provable — UPNG.js was evaluated and its quantiser does not
// preserve the exact endpoint colours, which would void the WCAG guarantee).
// Deflate comes from the native CompressionStream; everything else is a
// 2-entry PLTE and filter-0 scanlines.
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

// out: screenCore RGB buffer at grid size; encodes the nearest-neighbour
// x`up` upscale as a 1-bit indexed PNG. Any pixel that isn't the shadow
// colour is the highlight (2-level guarantee).
async function encodeScreenPNG(out, Wc, Hc, up, pair) {
  const W = Wc * up,
    H = Hc * up;
  const shadow = pair[0],
    high = pair[1];
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
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, W);
  view.setUint32(4, H);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 3; // colour type: indexed
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
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

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// Re-treat the current crop for one endpoint variant, as 1-bit PNG bytes.
function variantPNG(lightVariant) {
  const { rgb, Wc, Hc, up } = lastRender;
  const out = screenCore(rgb, Wc, Hc, axis, lightVariant);
  const pair = (lightVariant ? SCREEN_AXES_LIGHT : SCREEN_AXES)[axis];
  return encodeScreenPNG(out, Wc, Hc, up, pair);
}

// Adaptive SVG: both endpoint variants embedded as data-URI PNGs, switched by
// the SVG's own stylesheet. With no fragment the system scheme decides
// (light base, prefers-dark flips — the dark-favicon technique, works via
// <img>). Referenced with a fragment (…svg#dark / …svg#light) the :target
// rules override the scheme and force that variant — Set's own theme cascade
// picks the fragment, so all Set awareness lives in Set, not here.
const SCREEN_THEME_CSS =
  `.screen-dark{display:none}` +
  `@media (prefers-color-scheme:dark){.screen-dark{display:inline}.screen-light{display:none}}` +
  `:root:has(:target) .screen-light,:root:has(:target) .screen-dark{display:none}` +
  `:root:has(:target) :target{display:inline}`;

async function adaptiveSvg() {
  const { Wc, Hc, up } = lastRender;
  const W = Wc * up,
    H = Hc * up;
  const [dark, lightVar] = await Promise.all(
    [variantPNG(false), variantPNG(true)].map((p) =>
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

// Successive calls can interleave (crop drag end vs radio change); the token
// makes stale results drop out instead of clobbering newer ones.
let dlToken = 0;

async function updateDownload() {
  const token = ++dlToken;
  const suffix = ratio === "default" ? "" : `--${ratio}`;
  const [png, svg] = await Promise.all([variantPNG(light), adaptiveSvg()]);
  if (token !== dlToken) return;
  for (const [id, blob, name] of [
    [
      "png",
      new Blob([png], { type: "image/png" }),
      `${baseName}--${axis}${light ? "--light" : ""}${suffix}.png`,
    ],
    [
      "svg",
      new Blob([svg], { type: "image/svg+xml" }),
      `${baseName}--${axis}--adaptive${suffix}.svg`,
    ],
  ]) {
    if (downloads[id]) URL.revokeObjectURL(downloads[id].url);
    downloads[id] = { url: URL.createObjectURL(blob), name };
  }
}
