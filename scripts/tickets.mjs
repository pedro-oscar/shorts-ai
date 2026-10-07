// Tickets locais do issue tracker (docs/agents/issue-tracker.md): um arquivo por ticket em
// .scratch/<feature>/issues/NN-<slug>.md, com as linhas **Status:** e **Blocked by:** no
// topo e os comentários no fim, sob ## Comments. O id de um ticket é <feature>/<NN>, e o
// "Blocked by" cita números da mesma feature.
//
//   tickets all                          todos, com id e status
//   tickets list                         em JSON, os ready-for-agent sem bloqueador aberto
//   tickets view <feature/NN>            o conteúdo do ticket
//   tickets close <feature/NN> "resumo"  Status: done e o resumo em ## Comments
//   tickets comment <feature/NN> "texto" só o comentário
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = ".scratch";
const FILE = /^([^/\\]+)[/\\]issues[/\\]((\d+)-[^/\\]+\.md)$/;
const TITLE = /^# (.+)$/m;
const STATUS = /^((?:\*\*)?Status:(?:\*\*)?[ \t]*)(.*)$/m;
const BLOCKED_BY = /^(?:\*\*)?Blocked by:(?:\*\*)?(.*)$/m;
const COMMENTS = /^## Comments[ \t]*$/m;

const USAGE = `Uso: tickets <comando>
  all                          todos os tickets, com id e status
  list                         em JSON, os ready-for-agent cujos bloqueadores estão done
  view <feature/NN>            o conteúdo do ticket
  close <feature/NN> "resumo"  muda o Status para done e registra o resumo
  comment <feature/NN> "texto" acrescenta um comentário`;

/**
 * @typedef {object} Ticket
 * @property {string} id
 * @property {string} feature
 * @property {number} number
 * @property {string} title
 * @property {string} status
 * @property {string[]} blockedBy ids dos bloqueadores
 * @property {string} path
 * @property {string} body o arquivo inteiro
 */

/** @param {string} body */
function parseBlockers(body) {
  const line = BLOCKED_BY.exec(body)?.[1] ?? "";
  // Os títulos citados entre parênteses podem ter vírgulas e números; só contam os de fora.
  return (line.replace(/\([^)]*\)/g, "").match(/\d+/g) ?? []).map(Number);
}

/**
 * O título do cabeçalho, sem o "NN: " da frente.
 * @param {string} body
 */
const titleOf = (body) =>
  TITLE.exec(body)?.[1]
    ?.replace(/^\d+: */, "")
    .trim();

/** @returns {Ticket[]} */
function loadTickets() {
  if (!existsSync(ROOT)) return [];
  /** @type {(Omit<Ticket, "blockedBy"> & { blockers: number[] })[]} */
  const tickets = [];
  for (const entry of readdirSync(ROOT, {
    encoding: "utf8",
    recursive: true,
  })) {
    const [, feature, file, digits] = FILE.exec(entry) ?? [];
    if (feature === undefined || file === undefined || digits === undefined)
      continue;
    const path = `${ROOT}/${feature}/issues/${file}`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vindo do readdir de .scratch
    const body = readFileSync(path, "utf8");
    tickets.push({
      id: `${feature}/${digits}`,
      feature,
      number: Number(digits),
      title: titleOf(body) ?? file,
      status: STATUS.exec(body)?.[2]?.trim() ?? "",
      blockers: parseBlockers(body),
      path,
      body,
    });
  }
  tickets.sort(
    (a, b) =>
      a.feature.localeCompare(b.feature) ||
      a.number - b.number ||
      a.path.localeCompare(b.path),
  );
  return tickets.map(({ blockers, ...ticket }) => ({
    ...ticket,
    blockedBy: blockers.map(
      (number) =>
        tickets.find((t) => t.feature === ticket.feature && t.number === number)
          ?.id ?? `${ticket.feature}/${String(number).padStart(2, "0")}`,
    ),
  }));
}

/**
 * @param {Ticket[]} tickets
 * @param {string | undefined} id
 */
function findTicket(tickets, id = "") {
  const [, feature, digits] = /^([^/\\]+)\/(\d+)$/.exec(id) ?? [];
  if (feature === undefined || digits === undefined)
    throw new Error(
      `id inválido: "${id}" (use <feature>/<NN>, como shorts-ai-mvp/04)`,
    );
  const [ticket, ...others] = tickets.filter(
    (t) => t.feature === feature && t.number === Number(digits),
  );
  if (!ticket) throw new Error(`ticket não encontrado: ${id}`);
  if (others.length > 0)
    throw new Error(
      `mais de um ticket com o id ${id}: ${[ticket, ...others].map((t) => t.path).join(", ")}`,
    );
  return ticket;
}

/** @param {Ticket[]} tickets */
function readyForAgent(tickets) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return tickets.filter(
    (t) =>
      t.status === "ready-for-agent" &&
      t.blockedBy.every((id) => byId.get(id)?.status === "done"),
  );
}

/** @param {string[]} words */
function text(words) {
  const joined = words.join(" ").trim();
  if (!joined) throw new Error(USAGE);
  return joined;
}

function today() {
  const now = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Acrescenta um comentário no fim do arquivo, sob ## Comments (criado se faltar).
 * @param {string} body
 * @param {string} comment
 */
function withComment(body, comment) {
  const heading = COMMENTS.test(body) ? "" : "## Comments\n\n";
  return `${body.trimEnd()}\n\n${heading}${comment}\n`;
}

/** @param {Ticket} ticket */
function withStatusDone(ticket) {
  const match = STATUS.exec(ticket.body);
  if (!match) throw new Error(`${ticket.path}: sem a linha **Status:**`);
  const start = match.index + (match[1] ?? "").length;
  return `${ticket.body.slice(0, start)}done${ticket.body.slice(match.index + match[0].length)}`;
}

/**
 * @param {Ticket} ticket
 * @param {string} body
 */
function save(ticket, body) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vindo do readdir de .scratch, nunca do id
  writeFileSync(ticket.path, body);
}

/** @param {string[]} args */
function main([command, id, ...words]) {
  const tickets = loadTickets();
  switch (command) {
    case "all": {
      if (tickets.length === 0) {
        console.log(`Nenhum ticket em ${ROOT}/<feature>/issues/.`);
        return;
      }
      const idWidth = Math.max(...tickets.map((t) => t.id.length));
      const statusWidth = Math.max(...tickets.map((t) => t.status.length));
      for (const t of tickets)
        console.log(
          `${t.id.padEnd(idWidth)}  ${t.status.padEnd(statusWidth)}  ${t.title}`,
        );
      return;
    }
    case "list": {
      const ready = readyForAgent(tickets).map(
        ({ id, title, status, blockedBy, path, body }) => ({
          id,
          title,
          status,
          blockedBy,
          path,
          body,
        }),
      );
      console.log(JSON.stringify(ready, null, 2));
      return;
    }
    case "view":
      process.stdout.write(findTicket(tickets, id).body);
      return;
    case "close": {
      const ticket = findTicket(tickets, id);
      const summary = text(words);
      save(
        ticket,
        withComment(
          withStatusDone(ticket),
          `**${today()}, concluído.** ${summary}`,
        ),
      );
      console.log(`${ticket.id}: Status done, resumo em ## Comments.`);
      return;
    }
    case "comment": {
      const ticket = findTicket(tickets, id);
      const comment = text(words);
      save(ticket, withComment(ticket.body, `**${today()}.** ${comment}`));
      console.log(`${ticket.id}: comentário em ## Comments.`);
      return;
    }
    default:
      throw new Error(USAGE);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
