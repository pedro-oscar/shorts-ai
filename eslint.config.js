import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import reactDom from "eslint-plugin-react-dom";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import reactX from "eslint-plugin-react-x";
import security from "eslint-plugin-security";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([".claude/", "**/target/", "**/dist/"]),
  js.configs.recommended,
  // Com tipos: barra `any` vazando (no-unsafe-*), promessas soltas e eval implícito.
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  security.configs.recommended,
  noUnsanitized.configs.recommended,
  {
    rules: {
      // Acusa todo `obj[chave]` e `lista[i]`, quase sempre falso positivo; o risco real
      // (protótipo poluído por chave vinda de fora) fica com o Semgrep do check:full.
      "security/detect-object-injection": "off",
    },
  },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: globals.node } },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      reactX.configs["strict-type-checked"],
      reactDom.configs.strict,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
]);
