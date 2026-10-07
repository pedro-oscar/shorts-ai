// Testes e2e: ainda não há suíte. Quando houver, ela mora em e2e/ e o script `e2e` do
// package.json passa a chamar o runner dela. A pasta existir antes disso é erro, para a
// suíte não ficar de fora do `npm run check:full` sem ninguém perceber.
import { existsSync } from "node:fs";

if (existsSync("e2e")) {
  console.error(
    "e2e/ existe, mas o script `e2e` do package.json ainda não roda a suíte.",
  );
  process.exitCode = 1;
} else {
  console.log("e2e: nenhuma suíte ainda, etapa pulada.");
}
