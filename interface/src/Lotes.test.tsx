import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { LoteResumo, ProjetoResumo } from "./bindings";
import { App } from "./App";
import { PADROES_INICIAIS } from "./store";
import { ACCEPTED_AT, LOGADO, createFakeNucleo } from "./test/fakeNucleo";

const INICIAL = {
  aceite: { data: ACCEPTED_AT },
  plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
} as const;

const ETAPAS = [
  "importacao",
  "transcricao",
  "roteiro",
  "producao",
  "revisao",
] as const;

/** Um projeto do disco com as `concluidas` primeiras etapas prontas. */
function projeto(
  titulo: string,
  lote: string,
  concluidas: number,
): ProjetoResumo {
  return {
    id: `${titulo} (2026-10-08)`,
    titulo,
    pasta: `/Biblioteca/${titulo} (2026-10-08)`,
    lote,
    etapas: ETAPAS.map((etapa, i) => ({
      etapa,
      estado: i < concluidas ? "concluida" : "pendente",
    })),
    falha: null,
  };
}

function lote(
  id: string,
  nome: string,
  projetos: ProjetoResumo[],
  aberto: boolean,
): LoteResumo {
  return {
    id,
    nome,
    criadoEm: "2026-10-08T14:32:00Z",
    padroes: PADROES_INICIAIS,
    projetos,
    aberto,
  };
}

const ANTIGO = lote(
  "2026-10-07T10-00-00",
  "Lote de 07/10 10:00",
  [projeto("pregacao", "2026-10-07T10-00-00", 5)],
  false,
);
const ABERTO = lote(
  "2026-10-08T14-32-00",
  "Lote de 08/10 14:32",
  [
    projeto("aula", "2026-10-08T14-32-00", 2),
    projeto("live", "2026-10-08T14-32-00", 0),
  ],
  true,
);

function renderApp(lotes: LoteResumo[] = []) {
  const fake = createFakeNucleo(INICIAL, LOGADO, lotes);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, user: userEvent.setup() };
}

async function gerar(
  app: ReturnType<typeof renderApp>,
  caminhos: string[],
): Promise<void> {
  const { user, pick } = app;
  await user.click(await screen.findByRole("button", { name: "Continuar" }));
  pick(caminhos);
  await user.click(
    await screen.findByRole("button", { name: "Escolher arquivos" }),
  );
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(await screen.findByRole("button", { name: /^Gerar até/ }));
  await screen.findByRole("heading", { name: "Gerando" });
}

test("com um lote aberto, o app abre direto em Gerando", async () => {
  renderApp([ABERTO, ANTIGO]);

  await screen.findByRole("heading", { name: "Gerando" });
  screen.getByRole("listitem", { name: "aula" });
  screen.getByRole("listitem", { name: "live" });
  // Só os projetos do lote aberto.
  expect(screen.queryByRole("listitem", { name: "pregacao" })).toBeNull();
});

test("sem lote aberto, o app abre em Conta", async () => {
  renderApp([ANTIGO]);

  await screen.findByRole("heading", { name: "Conta" });
});

test("o lote vira uma linha por projeto, na ordem, com estado e etapa N/5", async () => {
  const app = renderApp();
  await gerar(app, ["/v/um.mp4", "/v/dois.mp4", "/v/tres.mp4"]);

  const linhas = screen
    .getAllByRole("listitem")
    .filter((item) => item.matches("ul.project-list > li"));
  expect(linhas.map((linha) => linha.getAttribute("aria-label"))).toEqual([
    "um",
    "dois",
    "tres",
  ]);
  const um = screen.getByRole("listitem", { name: "um" });
  expect(um).toHaveTextContent("Na fila");

  app.etapa("um (2026-10-09)", "importacao", "emAndamento");
  await within(um).findByText("Em andamento · etapa 1/5");
  expect(um).toHaveTextContent("Tempo 0:00");
  expect(screen.getByRole("listitem", { name: "dois" })).toHaveTextContent(
    "Na fila",
  );
});

test("um projeto que falha não impede os outros de andar", async () => {
  const app = renderApp();
  await gerar(app, ["/v/um.mp4", "/v/dois.mp4"]);

  app.etapa("um (2026-10-09)", "importacao", "emAndamento");
  app.etapa("um (2026-10-09)", "importacao", "falhou", "No such file");
  app.etapa("dois (2026-10-09)", "importacao", "emAndamento");

  const dois = screen.getByRole("listitem", { name: "dois" });
  await within(dois).findByText("Em andamento · etapa 1/5");
  expect(screen.getByRole("listitem", { name: "um" })).toHaveTextContent(
    "Falhou",
  );
});

test("+ Adicionar vídeo, com o lote rodando, põe o projeto no fim da fila", async () => {
  const app = renderApp();
  await gerar(app, ["/v/um.mp4"]);
  app.etapa("um (2026-10-09)", "importacao", "emAndamento");
  const { user, pick, calls } = app;

  await user.click(screen.getByRole("button", { name: "+ Adicionar vídeo" }));
  pick(["/v/dois.mp4", "/v/um.mp4"]);
  await user.click(
    await screen.findByRole("button", { name: "Escolher arquivos" }),
  );
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Continuar" }));

  await screen.findByRole("heading", { name: "Gerando" });
  // Vai direto para a fila do lote, sem passar pelos Padrões.
  expect(calls.adicoes).toEqual([
    { lote: "2026-10-09T10-01-00", caminhos: ["/v/dois.mp4", "/v/um.mp4"] },
  ]);
  expect(calls.lotes).toHaveLength(1);
  const linhas = screen
    .getAllByRole("listitem")
    .filter((item) => item.matches("ul.project-list > li"));
  // O mesmo vídeo de novo é outro projeto.
  expect(linhas.map((linha) => linha.getAttribute("aria-label"))).toEqual([
    "um",
    "dois",
    "um",
  ]);
});

test("Voltar, ao adicionar vídeo, deixa o lote como estava", async () => {
  const app = renderApp([ABERTO]);
  const { user } = app;
  await screen.findByRole("heading", { name: "Gerando" });

  await user.click(screen.getByRole("button", { name: "+ Adicionar vídeo" }));
  await user.click(
    await screen.findByRole("button", { name: "Voltar para Gerando" }),
  );

  await screen.findByRole("heading", { name: "Gerando" });
  expect(app.calls.adicoes).toEqual([]);
});

test("o nome automático do lote pode ser editado", async () => {
  const app = renderApp([ABERTO]);
  const { user } = app;
  await screen.findByRole("heading", { name: "Gerando" });
  const campo = screen.getByRole("textbox", { name: "Nome do lote" });
  expect(campo).toHaveValue("Lote de 08/10 14:32");

  await user.clear(campo);
  await user.type(campo, "Pregações de outubro");
  await user.click(screen.getByRole("button", { name: "Salvar nome" }));

  expect(app.calls.renomeacoes).toEqual([
    { lote: ABERTO.id, nome: "Pregações de outubro" },
  ]);
  await user.click(screen.getByRole("button", { name: "Lotes" }));
  await screen.findByRole("listitem", { name: "Pregações de outubro" });
});

test("o histórico lista os lotes e abre os projetos de cada um", async () => {
  const { user } = renderApp([ABERTO, ANTIGO]);
  await screen.findByRole("heading", { name: "Gerando" });

  await user.click(screen.getByRole("button", { name: "Lotes" }));

  await screen.findByRole("heading", { name: "Lotes" });
  const aberto = screen.getByRole("listitem", { name: ABERTO.nome });
  expect(aberto).toHaveTextContent("2 vídeos");
  const antigo = screen.getByRole("listitem", { name: ANTIGO.nome });
  expect(within(antigo).getByText(/pregacao/)).toHaveTextContent("Pronto");

  await user.click(
    screen.getByRole("button", { name: `Abrir ${ANTIGO.nome}` }),
  );

  await screen.findByRole("heading", { name: "Gerando" });
  screen.getByRole("listitem", { name: "pregacao" });
  expect(screen.queryByRole("listitem", { name: "aula" })).toBeNull();
});

test("a galeria mostra só os reels dos projetos do lote aberto, agrupados por projeto", async () => {
  const concluido = lote(
    ABERTO.id,
    ABERTO.nome,
    [projeto("aula", ABERTO.id, 5), projeto("live", ABERTO.id, 5)],
    true,
  );
  const { user } = renderApp([concluido, ANTIGO]);
  await screen.findByRole("heading", { name: "Gerando" });

  await user.click(screen.getByRole("button", { name: "Ver reels" }));

  await screen.findByRole("heading", { name: "Reels" });
  screen.getByText(`Lote: ${ABERTO.nome}`);
  screen.getByRole("region", { name: "aula" });
  screen.getByRole("region", { name: "live" });
  expect(screen.queryByRole("region", { name: "pregacao" })).toBeNull();
});
