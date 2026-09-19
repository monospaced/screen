// The aspect-ratio presets. Shared by the markup (ui.mjs, radio options) and
// the runtime behaviour (main.js, crop targets) so the list has one source.
//
// "default" keeps the intrinsic aspect, with the Resolution control setting the
// longest edge. Every other preset cover-crops to `ar` at the Resolution's
// width (1280 by default: 640 grid x2) — except OG, which is the fixed
// 1200x630 social-card size (600x315 grid x2).
export const RATIOS = [
  { key: "default", label: "Auto" },
  { key: "4x5", label: "4:5", ar: 4 / 5 },
  { key: "1x1", label: "1:1", ar: 1 },
  { key: "3x2", label: "3:2", ar: 3 / 2 },
  { key: "16x9", label: "16:9", ar: 16 / 9 },
  { key: "21x9", label: "21:9", ar: 21 / 9 },
  { key: "3x1", label: "3:1", ar: 3 },
  { key: "og", label: "OG", ar: 1200 / 630 },
];
