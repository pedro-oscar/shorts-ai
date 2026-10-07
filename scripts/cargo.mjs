// Roda `cargo <args>` no workspace da raiz. Enquanto ele não existe (fatia 02), avisa e
// sai com sucesso, para as etapas de Rust do `npm run check` já estarem no lugar.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);

if (!existsSync("Cargo.toml")) {
  console.log(`cargo ${args.join(" ")}: sem Cargo.toml na raiz, etapa pulada.`);
} else {
  const { status, error } = spawnSync("cargo", args, { stdio: "inherit" });
  if (error) console.error(`cargo: ${error.message}`);
  process.exitCode = status ?? 1;
}
