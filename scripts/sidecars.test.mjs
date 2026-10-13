// Testes do scripts/sidecars.mjs pela linha de comando, com um manifesto de teste e um
// servidor local no lugar das Releases do GitHub. O build do whisper.cpp e o do cargo ficam
// de fora: eles só entram quando o manifesto os pede.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("sidecars.mjs", import.meta.url));
const ALVO = "x86_64-unknown-linux-gnu";

/** @param {string | Buffer} conteudo */
const sha256 = (conteudo) =>
  createHash("sha256").update(conteudo).digest("hex");

/**
 * Uma pasta temporária, apagada no fim do teste.
 * @param {import("node:test").TestContext} t
 */
function pasta(t) {
  const dir = mkdtempSync(join(tmpdir(), "sidecars-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/**
 * Serve os arquivos dados e conta os pedidos de cada caminho.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, Buffer>} arquivos caminho da URL → conteúdo
 */
async function servidor(t, arquivos) {
  /** @type {Record<string, number>} */
  const pedidos = {};
  const server = createServer((req, res) => {
    const caminho = req.url ?? "";
    pedidos[caminho] = (pedidos[caminho] ?? 0) + 1;
    const conteudo = arquivos[caminho];
    if (conteudo === undefined) {
      res.writeHead(404).end();
    } else {
      res.writeHead(200).end(conteudo);
    }
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(undefined);
    });
  });
  t.after(() => {
    server.close();
  });
  const endereco = server.address();
  assert.ok(endereco !== null && typeof endereco === "object");
  return { base: `http://127.0.0.1:${String(endereco.port)}`, pedidos };
}

/**
 * Roda o script sem travar o processo, para o servidor do teste responder.
 * @param {string[]} args
 * @returns {Promise<{ status: number | null, saida: string }>}
 */
function sidecars(args) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [SCRIPT, ...args]);
    let saida = "";
    filho.stdout.on("data", (/** @type {Buffer} */ parte) => {
      saida += parte.toString();
    });
    filho.stderr.on("data", (/** @type {Buffer} */ parte) => {
      saida += parte.toString();
    });
    filho.on("close", (status) => {
      resolve({ status, saida });
    });
  });
}

/**
 * Grava o manifesto e devolve os argumentos para usá-lo.
 * @param {string} dir
 * @param {unknown} baixar
 */
function manifesto(dir, baixar) {
  const arquivo = join(dir, "manifesto.json");
  writeFileSync(arquivo, JSON.stringify({ [ALVO]: { baixar } }));
  return [
    "--manifesto",
    arquivo,
    "--alvo",
    ALVO,
    "--saida",
    join(dir, "binaries"),
    "--cache",
    join(dir, "cache"),
  ];
}

/**
 * Um .tar.gz com os arquivos dados dentro de uma pasta única, como os zips do ffmpeg.
 * @param {string} dir
 * @param {Record<string, string>} arquivos
 */
function tarGz(dir, arquivos) {
  const origem = join(dir, "origem");
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    mkdirSync(join(origem, "pacote", "bin"), { recursive: true });
    writeFileSync(join(origem, "pacote", "bin", nome), conteudo);
  }
  const arquivo = join(dir, "pacote.tar.gz");
  const tar = spawnSync("tar", ["-czf", arquivo, "-C", origem, "pacote"]);
  assert.equal(tar.status, 0, tar.stderr.toString());
  return readFileSync(arquivo);
}

test("o executável baixado vai para a saída com o nome do alvo, pronto para rodar", async (t) => {
  const dir = pasta(t);
  const binario = Buffer.from("#!/bin/sh\necho yt-dlp\n");
  const { base } = await servidor(t, { "/yt-dlp": binario });

  const { status, saida } = await sidecars(
    manifesto(dir, [
      { url: `${base}/yt-dlp`, sha256: sha256(binario), sidecar: "yt-dlp" },
    ]),
  );

  assert.equal(status, 0, saida);
  const destino = join(dir, "binaries", `yt-dlp-${ALVO}`);
  assert.deepEqual(readFileSync(destino), binario);
  if (process.platform !== "win32") {
    assert.equal(statSync(destino).mode & 0o111, 0o111);
  }
});

test("de um pacote, cada arquivo listado vira o sidecar com o nome dado", async (t) => {
  const dir = pasta(t);
  const pacote = tarGz(dir, {
    "ffmpeg.exe": "ffmpeg",
    "ffprobe.exe": "ffprobe",
    "ffplay.exe": "ffplay",
  });
  const { base } = await servidor(t, { "/ffmpeg.tar.gz": pacote });

  const { status, saida } = await sidecars(
    manifesto(dir, [
      {
        url: `${base}/ffmpeg.tar.gz`,
        sha256: sha256(pacote),
        arquivos: {
          "pacote/bin/ffmpeg.exe": "ffmpeg",
          "pacote/bin/ffprobe.exe": "ffprobe",
        },
      },
    ]),
  );

  assert.equal(status, 0, saida);
  const binaries = join(dir, "binaries");
  assert.deepEqual(readdirSync(binaries).sort(), [
    `ffmpeg-${ALVO}`,
    `ffprobe-${ALVO}`,
  ]);
  assert.equal(
    readFileSync(join(binaries, `ffprobe-${ALVO}`), "utf8"),
    "ffprobe",
  );
});

test("um download com outro SHA-256 é recusado e não chega à saída", async (t) => {
  const dir = pasta(t);
  const { base } = await servidor(t, { "/yt-dlp": Buffer.from("trocado") });

  const { status, saida } = await sidecars(
    manifesto(dir, [
      {
        url: `${base}/yt-dlp`,
        sha256: sha256("o original"),
        sidecar: "yt-dlp",
      },
    ]),
  );

  assert.notEqual(status, 0);
  assert.match(saida, /yt-dlp/);
  assert.ok(saida.includes(sha256("o original")), saida);
  assert.ok(saida.includes(sha256("trocado")), saida);
  assert.equal(existsSync(join(dir, "binaries", `yt-dlp-${ALVO}`)), false);
});

test("o que já está no cache com o SHA-256 certo não é baixado de novo", async (t) => {
  const dir = pasta(t);
  const binario = Buffer.from("yt-dlp");
  const { base, pedidos } = await servidor(t, { "/yt-dlp": binario });
  const args = manifesto(dir, [
    { url: `${base}/yt-dlp`, sha256: sha256(binario), sidecar: "yt-dlp" },
  ]);

  assert.equal((await sidecars(args)).status, 0);
  const segunda = await sidecars(args);

  assert.equal(segunda.status, 0, segunda.saida);
  assert.equal(pedidos["/yt-dlp"], 1);
});

test("um alvo fora do manifesto é erro com os alvos que existem", async (t) => {
  const dir = pasta(t);
  const args = manifesto(dir, []);
  args[args.indexOf("--alvo") + 1] = "riscv64-unknown-linux-gnu";

  const { status, saida } = await sidecars(args);

  assert.notEqual(status, 0);
  assert.match(saida, /riscv64-unknown-linux-gnu/);
  assert.ok(saida.includes(ALVO), saida);
});
