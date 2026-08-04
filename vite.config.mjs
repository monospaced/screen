import { defineConfig } from "vite";

import { renderApp } from "./src/ui.mjs";

// All web source lives under src/ (index.html included), so that's the Vite
// root. Build output goes to dist/ at the repo root for Netlify to publish.
//
// The Set markup is prerendered from the SSR renderers (src/ui.js) and injected
// into index.html at build/dev time, so the renderer code never ships to the
// browser and updating @monospaced/set-core flows straight through on rebuild.
export default defineConfig({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  plugins: [
    {
      name: "prerender-set-markup",
      transformIndexHtml(html) {
        return html.replace("</body>", `${renderApp()}</body>`);
      },
    },
  ],
});
