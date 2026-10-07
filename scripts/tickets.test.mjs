// Testes do scripts/tickets.mjs pela linha de comando, com um .scratch montado numa pasta
// temporária.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("tickets.mjs", import.meta.url));
const NONE = "None (can start immediately)";

/**
 * Monta .scratch numa pasta temporária, apagada no fim do teste.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} files caminho dentro de .scratch → conteúdo
 */
function scratch(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "tickets-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  for (const [path, content] of Object.entries(files)) {
    const file = join(dir, ".scratch", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

/**
 * Um ticket no formato do /to-tickets.
 * @param {string} status
 * @param {string} [blockedBy]
 * @param {string} [title]
 */
const ticket = (status, blockedBy = NONE, title = "Título") =>
  `# 00: ${title}\n\n**What to build:** algo.\n\n**Blocked by:** ${blockedBy}\n\n**Status:** ${status}\n\n- [ ] Critério\n`;

/**
 * @param {string} cwd
 * @param {...string} args
 */
function tickets(cwd, ...args) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [SCRIPT, ...args],
    {
      cwd,
      encoding: "utf8",
    },
  );
  return { status, stdout, stderr };
}

/**
 * @typedef {{ id: string, title: string, status: string, blockedBy: string[], path: string, body: string }} Listed
 * @param {string} cwd
 */
function list(cwd) {
  const { status, stdout, stderr } = tickets(cwd, "list");
  assert.equal(status, 0, stderr);
  // Via unknown: o JSON.parse devolve any, e o lint barra any escapando do teste.
  /** @type {unknown} */
  const listed = JSON.parse(stdout);
  return /** @type {Listed[]} */ (listed);
}

/** @param {string} cwd */
const listIds = (cwd) => list(cwd).map((t) => t.id);

test("list traz só os ready-for-agent cujos bloqueadores estão todos done", (t) => {
  const dir = scratch(t, {
    "f/issues/01-feito.md": ticket("done"),
    "f/issues/02-bloqueado-por-feito.md": ticket(
      "ready-for-agent",
      "01 (Feito)",
    ),
    "f/issues/03-um-bloqueador-aberto.md": ticket(
      "ready-for-agent",
      "01 (Feito), 04 (Livre)",
    ),
    "f/issues/04-livre.md": ticket("ready-for-agent"),
    "f/issues/05-humano.md": ticket("ready-for-human"),
    "f/issues/06-triagem.md": ticket("needs-triage"),
    "f/issues/07-bloqueador-inexistente.md": ticket(
      "ready-for-agent",
      "99 (Sumiu)",
    ),
  });
  assert.deepEqual(listIds(dir), ["f/02", "f/04"]);
});

test("títulos citados no Blocked by, com vírgulas e números, não viram bloqueadores", (t) => {
  const dir = scratch(t, {
    "f/issues/01-conta.md": ticket("done"),
    "f/issues/02-depois.md": ticket(
      "ready-for-agent",
      "01 (Conta: instalar, atualizar, código, Console e plano 3)",
    ),
  });
  const [listed] = list(dir);
  assert.ok(listed);
  assert.equal(listed.id, "f/02");
  assert.deepEqual(listed.blockedBy, ["f/01"]);
});

test("o Blocked by cita tickets da mesma feature", (t) => {
  const dir = scratch(t, {
    "a/issues/01-aberto.md": ticket("ready-for-agent"),
    "a/issues/02-espera-a01.md": ticket("ready-for-agent", "01 (Aberto)"),
    "b/issues/01-feito.md": ticket("done"),
    "b/issues/02-espera-b01.md": ticket("ready-for-agent", "01 (Feito)"),
  });
  assert.deepEqual(listIds(dir), ["a/01", "b/02"]);
});

test("close libera quem estava bloqueado pelo ticket", (t) => {
  const dir = scratch(t, {
    "f/issues/01-primeiro.md": ticket("ready-for-agent"),
    "f/issues/02-segundo.md": ticket("ready-for-agent", "01 (Primeiro)"),
  });
  assert.deepEqual(listIds(dir), ["f/01"]);
  assert.equal(tickets(dir, "close", "f/01", "feito").status, 0);
  assert.deepEqual(listIds(dir), ["f/02"]);
});

test("list devolve id, título, status, bloqueadores, caminho e corpo", (t) => {
  const body = ticket("ready-for-agent", NONE, "Spike de transcrição");
  const dir = scratch(t, { "mvp/issues/01-spike.md": body });
  assert.deepEqual(list(dir), [
    {
      id: "mvp/01",
      title: "Spike de transcrição",
      status: "ready-for-agent",
      blockedBy: [],
      path: ".scratch/mvp/issues/01-spike.md",
      body,
    },
  ]);
});

test("o id é <feature>/<NN>, com ou sem o zero à esquerda", (t) => {
  const body = ticket("ready-for-agent");
  const dir = scratch(t, {
    "mvp/issues/04-conta.md": body,
    "mvp/spec.md": "# Spec\n",
  });
  const all = tickets(dir, "all");
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /^mvp\/04 {2}ready-for-agent {2}Título$/m);
  assert.equal(tickets(dir, "view", "mvp/04").stdout, body);
  assert.equal(tickets(dir, "view", "mvp/4").stdout, body);
});

test("id inválido, inexistente ou repetido falha sem mexer em nada", (t) => {
  const dir = scratch(t, {
    "mvp/issues/01-a.md": ticket("ready-for-agent"),
    "mvp/issues/01-b.md": ticket("ready-for-agent"),
    "mvp/issues/02-c.md": ticket("ready-for-agent"),
  });
  /** @type {[string, RegExp][]} */
  const cases = [
    ["mvp", /id inválido/],
    ["mvp/02-c", /id inválido/],
    ["../mvp/02", /id inválido/],
    ["mvp/09", /não encontrado/],
    ["outra/02", /não encontrado/],
    ["mvp/01", /mais de um ticket/],
  ];
  for (const [id, error] of cases) {
    const result = tickets(dir, "close", id, "resumo");
    assert.equal(result.status, 1, id);
    assert.match(result.stderr, error, id);
  }
  assert.deepEqual(listIds(dir), ["mvp/01", "mvp/01", "mvp/02"]);
});

test("close muda o Status para done e registra o resumo em ## Comments", (t) => {
  const dir = scratch(t, { "f/issues/01-x.md": ticket("ready-for-agent") });
  const result = tickets(dir, "close", "f/01", "Feito no commit abc.");
  assert.equal(result.status, 0, result.stderr);
  const body = readFileSync(join(dir, ".scratch/f/issues/01-x.md"), "utf8");
  assert.match(body, /^\*\*Status:\*\* done$/m);
  assert.match(body, /^\*\*Blocked by:\*\* None \(can start immediately\)$/m);
  assert.match(
    body,
    /\n\n## Comments\n\n\*\*\d{4}-\d{2}-\d{2}, concluído\.\*\* Feito no commit abc\.\n$/,
  );
});

test("comment só acrescenta, embaixo dos comentários que já existem", (t) => {
  const path = "f/issues/01-x.md";
  const before = `${ticket("ready-for-agent")}\n## Comments\n\nPrimeiro.\n`;
  const dir = scratch(t, { [path]: before });
  assert.equal(tickets(dir, "comment", "f/01", "Segundo.").status, 0);
  const body = readFileSync(join(dir, ".scratch", path), "utf8");
  assert.match(body, /^\*\*Status:\*\* ready-for-agent$/m);
  assert.equal(body.match(/^## Comments$/gm)?.length, 1);
  assert.ok(body.startsWith(before.trimEnd()));
  assert.match(body, /Primeiro\.\n\n\*\*\d{4}-\d{2}-\d{2}\.\*\* Segundo\.\n$/);
});

test("close e comment sem texto falham", (t) => {
  const body = ticket("ready-for-agent");
  const dir = scratch(t, { "f/issues/01-x.md": body });
  for (const command of ["close", "comment"]) {
    const result = tickets(dir, command, "f/01", " ");
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /^Uso:/, command);
  }
  assert.equal(
    readFileSync(join(dir, ".scratch/f/issues/01-x.md"), "utf8"),
    body,
  );
});

test("sem .scratch, list devolve [] e all avisa", (t) => {
  const dir = scratch(t, {});
  assert.deepEqual(list(dir), []);
  assert.match(tickets(dir, "all").stdout, /^Nenhum ticket/);
});
