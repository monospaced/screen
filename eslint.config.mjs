import js from "@eslint/js";
import setConfig from "@monospaced/set-config/eslint";
import globals from "globals";

export default [
  { ignores: ["dist/**"] },

  // Base recommended rules for all source.
  js.configs.recommended,

  // Browser app (ESM).
  {
    files: ["src/main.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
  },

  // Shared UMD core — browser today, requireable from Node if ever needed.
  {
    files: ["shared/screen-core.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // Config / tooling files (Node ESM).
  {
    files: ["*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },

  // Set preset (import/export sorting) layered on top.
  ...setConfig,
];
