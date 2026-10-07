// SAST com o Semgrep: regras do OWASP Top 10, das linguagens do projeto e de segredos.
// Roda na imagem oficial se houver Docker ou Podman; senão, instala com `uv tool install`.
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { join } from "node:path";

const VERSION = "1.178.0";
const RULESETS = [
  "p/owasp-top-ten",
  "p/typescript",
  "p/javascript",
  "p/react",
  "p/rust",
  "p/secrets",
];
const SEMGREP = [
  "scan",
  ...RULESETS.flatMap((ruleset) => ["--config", ruleset]),
  "--error",
  "--metrics=off",
  "--disable-version-check",
];

/**
 * @param {string} command
 * @param {string[]} args
 */
function run(command, args) {
  const { status, error } = spawnSync(command, args, { stdio: "inherit" });
  if (error) console.error(`${command}: ${error.message}`);
  return status === 0;
}

/** @param {string} engine */
const works = (engine) =>
  spawnSync(engine, ["info"], { stdio: "ignore" }).status === 0;
const engine = ["docker", "podman"].find(works);

let ok;
if (engine) {
  // Dentro do container, o mesmo dono do repositório: o git aceita a pasta e o que o
  // Semgrep criar não fica como root. No Windows não há uid e o Docker Desktop resolve.
  const { uid, gid } = userInfo();
  const user =
    engine === "podman"
      ? ["--userns=keep-id"]
      : uid >= 0
        ? ["--user", [uid, gid].join(":")]
        : [];
  ok = run(engine, [
    "run",
    "--rm",
    ...user,
    "--env",
    "HOME=/tmp",
    "--volume",
    `${process.cwd()}:/src${engine === "podman" ? ":Z" : ""}`,
    "--workdir",
    "/src",
    `docker.io/semgrep/semgrep:${VERSION}`,
    "semgrep",
    ...SEMGREP,
  ]);
} else {
  console.log("Sem Docker nem Podman: Semgrep pelo uv.");
  ok = run("uv", ["tool", "install", `semgrep==${VERSION}`]);
  if (ok) {
    const bin = spawnSync("uv", ["tool", "dir", "--bin"], {
      encoding: "utf8",
    }).stdout.trim();
    ok = run(join(bin, "semgrep"), SEMGREP);
  }
}
process.exitCode = ok ? 0 : 1;
