// Busca segredos no repositório inteiro com o gitleaks (regras em .gitleaks.toml): todo o
// histórico, o índice e o que ainda não foi para ele, inclusive arquivos novos. O que o
// .gitignore exclui (o .env local, target/) fica de fora, como ficaria de um commit.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function run(command, args, env = process.env) {
  const { status, error } = spawnSync(command, args, { env, stdio: "inherit" });
  if (error) console.error(`${command}: ${error.message}`);
  return status === 0;
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
const gitleaks = (args, env) =>
  run(
    "gitleaks",
    [...args, "--redact", "--no-banner", "--verbose", "--log-level=warn"],
    env,
  );

function scan() {
  // Histórico de todos os branches: o `gitleaks git` já roda `git log --all`.
  if (!gitleaks(["git"]) || !gitleaks(["git", "--pre-commit", "--staged"]))
    return false;

  // O resto da pasta contra o HEAD, num índice temporário: `git add -N` marca os arquivos
  // novos sem gravar o conteúdo no .git (um vídeo solto na pasta, por exemplo), e o
  // `git diff` que o gitleaks roda passa a mostrá-los inteiros.
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, "index") };
    return (
      run("git", ["read-tree", "HEAD"], env) &&
      run("git", ["add", "--all", "--intent-to-add"], env) &&
      gitleaks(["git", "--pre-commit"], env)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (scan()) {
  console.log("Nenhum segredo no histórico, no índice nem nas alterações.");
} else {
  process.exitCode = 1;
}
