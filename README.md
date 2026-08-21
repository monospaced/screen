# Screen

![Example image processed by Screen](https://res.cloudinary.com/monospaced/image/upload/v1785950420/2018-04-20_15.28.26--cyan--3x2_imnudx.png)

Screen is Monospaced's brand image tool.

Turns a photograph into a 2-level ordered-dither bitmap on the cyan, magenta, yellow
or neutral palette axis — it reads as an early computer display.

Pick a colour axis, an aspect ratio and a tone (dark, mid or light), drag to place the
crop, then download the PNG — or an adaptive SVG that carries both the dark and light
tones. Everything runs in the browser on a `<canvas>`; nothing is uploaded.

See [`RECIPE.md`](./RECIPE.md) for the full spec. The
treatment itself is implemented in `shared/screen-core.js`.

## Develop

```bash
pnpm install
pnpm dev             # local dev server with HMR
pnpm build           # production build -> dist/
pnpm preview         # serve the production build locally
pnpm lint            # eslint + stylelint
pnpm format          # prettier --write .
```

Built with [Set Design System](https://set.monospaced.com).
