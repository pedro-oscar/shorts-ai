// Portões do pre-commit, sobre o conteúdo staged (o hook esconde as mudanças não staged).
// `npm run check` roda os mesmos portões no repositório inteiro, exceto Rust por enquanto.
// Com --concurrent false, as entradas rodam na ordem abaixo e param no primeiro erro.

const code = "*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

/** @type {import("lint-staged").Configuration} */
export default {
  // Segredos primeiro. --no-gitignore: sem ele, um `git add -f .env` passaria sem
  // checagem. --maskSecrets tira o valor encontrado do log.
  "*": [
    "secretlint --maskSecrets --no-gitignore",
    "prettier --check --ignore-unknown",
  ],
  [code]: "eslint --max-warnings=0 --no-warn-ignored",
  // Tipos e testes valem para o projeto todo, então rodam uma vez, sem a lista de arquivos.
  [`{${code},package.json,package-lock.json,tsconfig*.json}`]: () => [
    "npm run typecheck",
    "npm test",
  ],
  "{*.rs,Cargo.toml,Cargo.lock}": () => [
    "cargo fmt --all --check",
    "cargo clippy --workspace --all-targets -- -D warnings",
    "cargo test --workspace",
  ],
};
