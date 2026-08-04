import setConfig from "@monospaced/set-config/stylelint";

export default {
  ...setConfig,
  ignoreFiles: ["dist/**", ".vscode/**"],
};
