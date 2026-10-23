import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: ["**/src-tauri/target", "**/src-tauri/gen", "src-tauri/server/**", ".next-desktop/**", ".agents/**", ".codex/**", "graphify-out/**"],
  },
  {
    files: ["bin/momp.js", "bin/momp-web.js", "next.config.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
