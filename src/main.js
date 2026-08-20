// Set design system — fonts before core styles.
import "@monospaced/set-assets/fonts.css";
import "@monospaced/set-core/styles.css";
import "./style.css";
// Shared treatment core. Loaded for its side effect: it assigns
// globalThis.screenCore (see screen-core.js), which the Node CLI consumes too.
import "../shared/screen-core.js";

import { defineSetLightswitch, defineSetSidebar } from "@monospaced/set-core";

// Default demo image — a normal fingerprinted asset (served over http, so the
// canvas is never tainted).
import exampleUrl from "./example.jpg";
import { RATIOS } from "./ratios.mjs";

// The Set markup is prerendered into index.html at build time (see
// vite.config.mjs / ui.js). Here we just upgrade the interactive custom
// elements we use (sidebar, lightswitch) and wire behaviour onto the DOM.
defineSetSidebar();
defineSetLightswitch();

const { screenCore } = globalThis;
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
  outCanvas = null;
const stage = document.getElementById("stage");
const dl = document.getElementById("dl");

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

// Initial state: the axis and ratio radios ship checked from the prerendered
// markup; just start the download link disabled until the first treatment
// exists.
dl.setAttribute("aria-disabled", "true");

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

function updateDownload() {
  outCanvas.toBlob((b) => {
    if (dl.dataset.url) URL.revokeObjectURL(dl.dataset.url);
    const u = URL.createObjectURL(b);
    dl.href = u;
    dl.dataset.url = u;
    dl.download = `${baseName}--${axis}${light ? "--light" : ""}${ratio === "default" ? "" : `--${ratio}`}.png`;
    dl.setAttribute("aria-disabled", "false");
  }, "image/png");
}
