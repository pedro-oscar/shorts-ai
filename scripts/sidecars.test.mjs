// Testes do scripts/sidecars.mjs pela linha de comando, com um manifesto de teste e um
// servidor local no lugar das Releases do GitHub. O build do whisper.cpp e o do cargo ficam
// de fora: eles só entram quando o manifesto os pede. O ffmpeg montado para o alvo desta
// máquina é conferido, então os pacotes de teste trazem um ffmpeg falso (um script de shell).
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
// A conferência roda o ffmpeg montado, o que só acontece com o alvo desta máquina.
const SEM_CONFERENCIA =
  process.platform !== "linux" || process.arch !== "x64"
    ? "a conferência só roda o ffmpeg do alvo desta máquina"
    : false;
const RECURSOS = [
  "libx264",
  "wrapped_avframe",
  "zscale",
  "loudnorm",
  "signalstats",
];

/**
 * Um ffmpeg falso que lista os encoders e filtros dados no `-encoders` e no `-filters`.
 * @param {string[]} recursos
 */
const ffmpegFalso = (recursos) =>
  `#!/bin/sh\necho " V....D ${recursos.join(" ")}"\n`;

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
    "ffmpeg.exe": ffmpegFalso(RECURSOS),
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

/**
 * Monta um pacote com o ffmpeg falso dado e devolve o resultado do script.
 * @param {import("node:test").TestContext} t
 * @param {string[]} recursos
 */
async function montarFfmpeg(t, recursos) {
  const dir = pasta(t);
  const pacote = tarGz(dir, { ffmpeg: ffmpegFalso(recursos) });
  const { base } = await servidor(t, { "/ffmpeg.tar.gz": pacote });
  return sidecars(
    manifesto(dir, [
      {
        url: `${base}/ffmpeg.tar.gz`,
        sha256: sha256(pacote),
        arquivos: { "pacote/bin/ffmpeg": "ffmpeg" },
      },
    ]),
  );
}

test(
  "um ffmpeg sem o libx264 é recusado nomeando o que falta",
  { skip: SEM_CONFERENCIA },
  async (t) => {
    const { status, saida } = await montarFfmpeg(
      t,
      RECURSOS.filter((recurso) => recurso !== "libx264"),
    );

    assert.notEqual(status, 0);
    assert.match(saida, /não tem libx264/);
  },
);

test(
  "um ffmpeg com tudo o que o app usa passa na conferência",
  { skip: SEM_CONFERENCIA },
  async (t) => {
    const { status, saida } = await montarFfmpeg(t, RECURSOS);

    assert.equal(status, 0, saida);
    assert.match(saida, /ffmpeg conferido/);
  },
);

test("--fontes baixa o código-fonte de cada ffmpeg com o nome da Release", async (t) => {
  const dir = pasta(t);
  const windows = Buffer.from("código do ffmpeg 9.0.2");
  const linux = Buffer.from("código do commit 2a571b6068");
  const { base } = await servidor(t, {
    "/ffmpeg-9.0.2.tar.xz": windows,
    "/2a571b6068.tar.gz": linux,
  });
  const arquivo = join(dir, "manifesto.json");
  /** @param {string} caminho @param {Buffer} conteudo @param {string} nome */
  const ffmpeg = (caminho, conteudo, nome) => ({
    url: `${base}/nao-baixa.zip`,
    sha256: sha256("o binário fica de fora"),
    arquivos: { "bin/ffmpeg": "ffmpeg" },
    fonte: { url: `${base}${caminho}`, sha256: sha256(conteudo), nome },
  });
  writeFileSync(
    arquivo,
    JSON.stringify({
      "x86_64-pc-windows-msvc": {
        baixar: [
          ffmpeg("/ffmpeg-9.0.2.tar.xz", windows, "ffmpeg-9.0.2-fonte.tar.xz"),
        ],
      },
      [ALVO]: {
        baixar: [
          ffmpeg("/2a571b6068.tar.gz", linux, "ffmpeg-g2a571b6068.tar.gz"),
        ],
      },
    }),
  );
  const fontes = join(dir, "fontes");

  const { status, saida } = await sidecars([
    "--manifesto",
    arquivo,
    "--cache",
    join(dir, "cache"),
    "--fontes",
    fontes,
  ]);

  assert.equal(status, 0, saida);
  assert.deepEqual(readdirSync(fontes).sort(), [
    "ffmpeg-9.0.2-fonte.tar.xz",
    "ffmpeg-g2a571b6068.tar.gz",
  ]);
  assert.deepEqual(
    readFileSync(join(fontes, "ffmpeg-9.0.2-fonte.tar.xz")),
    windows,
  );
});

test("--fontes recusa um código-fonte com outro SHA-256", async (t) => {
  const dir = pasta(t);
  const { base } = await servidor(t, {
    "/fonte.tar.xz": Buffer.from("trocado"),
  });
  const arquivo = join(dir, "manifesto.json");
  writeFileSync(
    arquivo,
    JSON.stringify({
      [ALVO]: {
        baixar: [
          {
            url: `${base}/nao-baixa.zip`,
            sha256: sha256("o binário fica de fora"),
            fonte: {
              url: `${base}/fonte.tar.xz`,
              sha256: sha256("o original"),
              nome: "ffmpeg-fonte.tar.xz",
            },
          },
        ],
      },
    }),
  );

  const { status, saida } = await sidecars([
    "--manifesto",
    arquivo,
    "--cache",
    join(dir, "cache"),
    "--fontes",
    join(dir, "fontes"),
  ]);

  assert.notEqual(status, 0);
  assert.ok(saida.includes(sha256("trocado")), saida);
  assert.equal(existsSync(join(dir, "fontes", "ffmpeg-fonte.tar.xz")), false);
});
