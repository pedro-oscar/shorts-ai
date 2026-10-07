// Plugins do ESLint que não trazem tipos. Os @types deles puxam o @types/eslint antigo,
// que briga com os tipos do próprio ESLint.

declare module "eslint-plugin-security" {
  import type { ESLint, Linter } from "eslint";

  const plugin: ESLint.Plugin & { configs: { recommended: Linter.Config } };
  export default plugin;
}

declare module "eslint-plugin-no-unsanitized" {
  import type { ESLint, Linter } from "eslint";

  const plugin: ESLint.Plugin & { configs: { recommended: Linter.Config } };
  export default plugin;
}
