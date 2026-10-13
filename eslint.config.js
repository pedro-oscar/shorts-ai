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
  // As worktrees do sandcastle são cópias do repositório, ignoradas pelo .gitignore dele.
  globalIgnores([
    ".claude/",
    ".sandcastle/worktrees/",
    ".sandcastle/logs/",
    "**/target/",
    "**/dist/",
    // Gerados: os bindings pelo tauri-specta, os esquemas pelo Tauri.
    "interface/src/bindings.ts",
    // Cópia do CLI (assets/ORIGEM.md): tem o próprio tsconfig e não segue estes padrões.
    "assets/",
    "src-tauri/gen/",
  ]),
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
    // Testes dos scripts, com node:test: o runner acompanha a promessa que o test() devolve,
    // e os arquivos lidos e gravados ficam numa pasta temporária do próprio teste.
    files: ["scripts/**/*.test.mjs"],
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: ["test", "describe", "it"],
            },
          ],
        },
      ],
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  {
    // O script dos sidecars só abre caminhos do repositório, do cache em target/ e das opções
    // de quem o roda.
    files: ["scripts/sidecars.mjs"],
    rules: { "security/detect-non-literal-fs-filename": "off" },
  },
  {
    // TypeScript de Node, fora da interface: vite.config.ts e a fábrica (.sandcastle/).
    files: ["**/*.{ts,mts,cts}"],
    ignores: ["interface/**"],
    languageOptions: { globals: globals.node },
  },
  {
    // A interface roda no webview, com o tsconfig dela (interface/tsconfig.json).
    files: ["interface/**/*.{ts,tsx}"],
    extends: [
      reactX.configs["strict-type-checked"],
      reactDom.configs.strict,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
]);
