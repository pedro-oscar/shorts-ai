// Monta os executáveis que vão com o app (os sidecars do Tauri, em `bundle.externalBin`) para
// o alvo do Rust desta máquina: src-tauri/binaries/<nome>-<alvo>[.exe]. O manifesto
// (scripts/sidecars.json) fixa a versão e o SHA-256 de tudo o que é baixado; os downloads e os
// builds ficam em target/sidecars/, que pode ser apagado. O src-tauri/tauri.sidecars.conf.json
// lista os mesmos nomes; ele só entra no build do instalador, para o `cargo build` de todo dia
// não exigir os executáveis.
//
// Uso: npm run sidecars [-- --alvo <alvo>] [--manifesto <arquivo>] [--saida <pasta>] [--cache <pasta>]
// Por enquanto o manifesto só tem o Windows x64; o Linux entra com o build distribuível.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * @typedef {{ url: string, sha256: string }} Download
 * @typedef {Download & { sidecar?: string, arquivos?: Record<string, string> }} Baixar
 *   `sidecar`: o próprio arquivo baixado é o executável; `arquivos`: caminho dentro do pacote
 *   → nome do sidecar.
 * @typedef {{ codigo: Download & { pasta: string }, micromamba: Download, vulkan: string[] }} Whisper
 * @typedef {{ baixar?: Baixar[], whisper?: Whisper, cargo?: string[] }} Receita
 */

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Os dois whisper-cli ficam na mesma pasta, então são estáticos: sem DLLs de mesmo nome e
// versões diferentes. O runtime do MSVC vai dentro (/MT) e o OpenMP fica de fora (viria como
// vcomp140.dll), para não depender do Visual C++ Redistributable. Sem GGML_NATIVE, o binário
// roda em qualquer x64 com AVX2, e não só na CPU de quem compilou.
const CMAKE_DO_WHISPER = [
  "-G",
  "Ninja",
  "-DCMAKE_BUILD_TYPE=Release",
  "-DBUILD_SHARED_LIBS=OFF",
  "-DCMAKE_POLICY_DEFAULT_CMP0091=NEW",
  "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
  "-DGGML_NATIVE=OFF",
  "-DGGML_AVX2=ON",
  "-DGGML_FMA=ON",
  "-DGGML_F16C=ON",
  "-DGGML_OPENMP=OFF",
  "-DWHISPER_BUILD_TESTS=OFF",
];

/**
 * @param {string} command
 * @param {string[]} args
 */
function run(command, args) {
  const { status, error } = spawnSync(command, args, { stdio: "inherit" });
  if (status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")}: ${error?.message ?? `saiu com ${String(status)}`}`,
    );
  }
}

/** @param {string} arquivo */
async function sha256(arquivo) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(arquivo), hash);
  return hash.digest("hex");
}

/**
 * Baixa para o cache, se ainda não estiver lá com o SHA-256 do manifesto.
 * @param {Download} download
 * @param {string} cache
 */
async function baixar({ url, sha256: esperado }, cache) {
  const nome = basename(new URL(url).pathname);
  const arquivo = join(cache, "downloads", nome);
  if (existsSync(arquivo) && (await sha256(arquivo)) === esperado) {
    return arquivo;
  }
  console.log(`Baixando ${url}`);
  const resposta = await fetch(url);
  if (!resposta.ok || !resposta.body) {
    throw new Error(`${url}: HTTP ${String(resposta.status)}`);
  }
  mkdirSync(dirname(arquivo), { recursive: true });
  const parcial = `${arquivo}.parcial`;
  const corpo = /** @type {import("node:stream/web").ReadableStream} */ (
    resposta.body
  );
  await pipeline(Readable.fromWeb(corpo), createWriteStream(parcial));
  const obtido = await sha256(parcial);
  if (obtido !== esperado) {
    throw new Error(
      `${nome}: o download tem SHA-256 ${obtido}, mas o manifesto espera ${esperado}`,
    );
  }
  renameSync(parcial, arquivo);
  return arquivo;
}

/**
 * Extrai com o tar do sistema; o do Windows (bsdtar) também abre .zip.
 * @param {string} pacote
 * @param {string} destino
 */
function extrair(pacote, destino) {
  mkdirSync(destino, { recursive: true });
  const tar =
    process.platform === "win32"
      ? join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  run(tar, ["-xf", pacote, "-C", destino]);
}

/**
 * Copia o executável para a saída com o nome que o `externalBin` do Tauri espera.
 * @param {string} origem
 * @param {string} nome
 * @param {{ alvo: string, saida: string }} destino
 */
function instalar(origem, nome, { alvo, saida }) {
  const extensao = alvo.includes("windows") ? ".exe" : "";
  const arquivo = join(saida, `${nome}-${alvo}${extensao}`);
  mkdirSync(saida, { recursive: true });
  copyFileSync(origem, arquivo);
  if (process.platform !== "win32") chmodSync(arquivo, 0o755);
  console.log(`  ${arquivo}`);
}

/** O `vcvars64.bat` do Visual Studio mais novo com as ferramentas de C++ para x64. */
function vcvars() {
  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  const { stdout, status } = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8" },
  );
  const instalacao = stdout.trim();
  if (status !== 0 || !instalacao) {
    throw new Error(
      "Visual Studio com as ferramentas de C++ não encontrado (vswhere)",
    );
  }
  return join(instalacao, "VC", "Auxiliary", "Build", "vcvars64.bat");
}

/**
 * Compila o whisper-cli duas vezes: com Vulkan e, como reserva, só para a CPU. O glslc e os
 * headers do Vulkan vêm do conda-forge num ambiente do micromamba, sem o Vulkan SDK e sem
 * administrador; em execução, o whisper-cli usa o vulkan-1.dll do driver.
 * @param {Whisper} whisper
 * @param {string} cache
 * @param {{ alvo: string, saida: string }} destino
 */
async function compilarWhisper(whisper, cache, destino) {
  if (process.platform !== "win32") {
    throw new Error(
      "a receita do whisper.cpp deste manifesto é a do Windows (MSVC)",
    );
  }
  const vulkan = join(cache, "vulkan", "Library");
  if (!existsSync(join(vulkan, "bin", "glslc.exe"))) {
    const micromamba = await baixar(whisper.micromamba, cache);
    run(micromamba, [
      "create",
      "--yes",
      "--root-prefix",
      join(cache, "mamba"),
      "--prefix",
      join(cache, "vulkan"),
      "--channel",
      "conda-forge",
      ...whisper.vulkan,
    ]);
  }
  const fonte = join(cache, whisper.codigo.pasta);
  if (!existsSync(join(fonte, "CMakeLists.txt"))) {
    extrair(await baixar(whisper.codigo, cache), cache);
  }
  const variantes = {
    "whisper-cli": [
      "-DGGML_VULKAN=ON",
      `-DCMAKE_PREFIX_PATH=${vulkan}`,
      `-DVulkan_INCLUDE_DIR=${join(vulkan, "include")}`,
      `-DVulkan_LIBRARY=${join(vulkan, "lib", "vulkan-1.lib")}`,
      `-DVulkan_GLSLC_EXECUTABLE=${join(vulkan, "bin", "glslc.exe")}`,
    ],
    "whisper-cli-cpu": [],
  };
  for (const [nome, opcoes] of Object.entries(variantes)) {
    const build = join(cache, `build-${nome}`);
    const configurar = [...CMAKE_DO_WHISPER, ...opcoes]
      .map((opcao) => `"${opcao}"`)
      .join(" ");
    // O ambiente do MSVC só existe dentro do cmd que chamou o vcvars, então o build é um .bat.
    const bat = join(cache, `${nome}.bat`);
    writeFileSync(
      bat,
      [
        "@echo off",
        `call "${vcvars()}" >nul || exit /b 1`,
        `set "PATH=${join(vulkan, "bin")};%PATH%"`,
        `cmake -S "${fonte}" -B "${build}" ${configurar} || exit /b 1`,
        `cmake --build "${build}" --target whisper-cli || exit /b 1`,
        "",
      ].join("\r\n"),
    );
    run("cmd.exe", ["/d", "/c", bat]);
    instalar(join(build, "bin", "whisper-cli.exe"), nome, destino);
  }
}

/**
 * @param {Receita} receita
 * @param {{ alvo: string, saida: string, cache: string }} opcoes
 */
async function montar(receita, { alvo, saida, cache }) {
  const destino = { alvo, saida };
  for (const download of receita.baixar ?? []) {
    const arquivo = await baixar(download, cache);
    if (download.sidecar) instalar(arquivo, download.sidecar, destino);
    const arquivos = Object.entries(download.arquivos ?? {});
    if (arquivos.length > 0) {
      const pasta = join(cache, "extraido", basename(arquivo));
      if (!arquivos.every(([caminho]) => existsSync(join(pasta, caminho)))) {
        extrair(arquivo, pasta);
      }
      for (const [caminho, nome] of arquivos) {
        instalar(join(pasta, caminho), nome, destino);
      }
    }
  }
  if (receita.whisper) await compilarWhisper(receita.whisper, cache, destino);
  for (const pacote of receita.cargo ?? []) {
    run("cargo", ["build", "--release", "--locked", "--package", pacote]);
    const extensao = process.platform === "win32" ? ".exe" : "";
    instalar(
      join(RAIZ, "target", "release", `${pacote}${extensao}`),
      pacote,
      destino,
    );
  }
}

/** O alvo do `rustc` desta máquina, o mesmo que o Tauri usa no nome dos sidecars. */
function alvoDoRustc() {
  const { stdout, status } = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  const alvo = /^host: (.+)$/m.exec(stdout)?.[1];
  if (status !== 0 || !alvo) throw new Error("rustc -vV não disse o alvo");
  return alvo;
}

async function main() {
  const { values } = parseArgs({
    options: {
      alvo: { type: "string" },
      manifesto: {
        type: "string",
        default: join(RAIZ, "scripts", "sidecars.json"),
      },
      saida: { type: "string", default: join(RAIZ, "src-tauri", "binaries") },
      cache: { type: "string", default: join(RAIZ, "target", "sidecars") },
    },
  });
  const alvo = values.alvo ?? alvoDoRustc();
  /** @type {unknown} */
  const json = JSON.parse(readFileSync(values.manifesto, "utf8"));
  const manifesto = /** @type {Record<string, Receita>} */ (json);
  const receita = manifesto[alvo];
  if (!receita) {
    throw new Error(
      `o manifesto não tem o alvo ${alvo}; tem ${Object.keys(manifesto).join(", ")}`,
    );
  }
  console.log(`Sidecars de ${alvo}:`);
  await montar(receita, {
    alvo,
    saida: values.saida,
    cache: values.cache,
  });
}

main().catch((/** @type {unknown} */ error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
