import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { act } from "react";
import { expect, test, vi } from "vitest";
import type { EstadoInicial, LoteResumo, ProjetoResumo } from "./bindings";
import { App } from "./App";
import { PADROES_INICIAIS } from "./store";
import {
  ACCEPTED_AT,
  LOGADO,
  SEM_CUSTO,
  createFakeNucleo,
} from "./test/fakeNucleo";

const INICIAL = {
  aceite: { data: ACCEPTED_AT },
  plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
} as const;

const LOTE_ID = "2026-10-08T14-32-00";
const ETAPAS = [
  "importacao",
  "transcricao",
  "roteiro",
  "producao",
  "revisao",
] as const;

function projeto(
  titulo: string,
  concluidas: number,
  extra: Partial<ProjetoResumo> = {},
): ProjetoResumo {
  return {
    id: titulo,
    titulo,
    pasta: `/Biblioteca/${titulo}`,
    lote: LOTE_ID,
    etapas: ETAPAS.map((etapa, i) => ({
      etapa,
      estado: i < concluidas ? "concluida" : "pendente",
    })),
    falha: null,
    parada: null,
    videoAusente: false,
    excecoes: {},
    custo: SEM_CUSTO,
    ...extra,
  };
}

function renderApp(
  projetos: ProjetoResumo[],
  ausentes: string[] = [],
  inicial: Partial<EstadoInicial> = {},
) {
  const lote: LoteResumo = {
    id: LOTE_ID,
    nome: "Lote de 08/10 14:32",
    criadoEm: "2026-10-08T14:32:00Z",
    padroes: PADROES_INICIAIS,
    projetos,
    ausentes,
    aberto: true,
    custo: SEM_CUSTO,
  };
  const fake = createFakeNucleo({ ...INICIAL, ...inicial }, LOGADO, [lote]);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, user: userEvent.setup() };
}

/** Os títulos dos cartões da coluna, na ordem. */
function cartoes(coluna: string) {
  return Array.from(
    screen.getByRole("list", { name: coluna }).querySelectorAll(":scope > li"),
  ).map((item) => item.getAttribute("aria-label"));
}

/** Abre o menu ⋯ do cartão. */
async function abrirMenu(
  user: ReturnType<typeof userEvent.setup>,
  cartao: HTMLElement,
  nome: string,
) {
  await user.click(
    within(cartao).getByRole("button", { name: `Mais ações de ${nome}` }),
  );
  return within(cartao).getByRole("menu");
}

test("Subir, Descer e Passar na frente valem na Fila, e a ordem nova chega por evento", async () => {
  const app = renderApp([
    projeto("rodando", 1),
    projeto("a", 0),
    projeto("b", 0),
  ]);
  const a = await screen.findByRole("listitem", { name: "a" });
  const b = screen.getByRole("listitem", { name: "b" });
  expect(cartoes("Fila")).toEqual(["a", "b"]);
  expect(cartoes("Transcrição")).toEqual(["rodando"]);

  let menu = await abrirMenu(app.user, a, "a");
  expect(
    within(menu).getByRole("menuitem", { name: "Subir a" }),
  ).toBeDisabled();
  await app.user.keyboard("{Escape}");
  menu = await abrirMenu(app.user, b, "b");
  expect(
    within(menu).getByRole("menuitem", { name: "Descer b" }),
  ).toBeDisabled();

  await app.user.click(
    within(menu).getByRole("menuitem", { name: "Passar b na frente" }),
  );
  expect(app.calls.ciclo).toEqual(["mover:passarNaFrente:b"]);
  act(() => {
    app.emitir({
      tipo: "filaReordenada",
      lote: LOTE_ID,
      projetos: ["rodando", "b", "a"],
    });
  });

  expect(cartoes("Fila")).toEqual(["b", "a"]);
  menu = await abrirMenu(
    app.user,
    screen.getByRole("listitem", { name: "rodando" }),
    "rodando",
  );
  expect(within(menu).queryByRole("menuitem", { name: /Passar/ })).toBeNull();
});

test("arrastar um cartão da Fila para outra posição move o projeto passo a passo", async () => {
  const app = renderApp([projeto("a", 0), projeto("b", 0), projeto("c", 0)]);
  const a = await screen.findByRole("listitem", { name: "a" });
  const c = screen.getByRole("listitem", { name: "c" });
  expect(a).toHaveAttribute("draggable", "true");

  fireEvent.dragStart(a);
  fireEvent.dragOver(c);
  fireEvent.drop(c);

  // De 1º para 3º: dois passos para baixo.
  await vi.waitFor(() => {
    expect(app.calls.ciclo).toEqual(["mover:descer:a", "mover:descer:a"]);
  });
});

test("Remover só aparece para o projeto que nunca começou e o tira da lista", async () => {
  const app = renderApp([projeto("rodando", 1), projeto("novo", 0)]);
  const novo = await screen.findByRole("listitem", { name: "novo" });
  let menu = await abrirMenu(
    app.user,
    screen.getByRole("listitem", { name: "rodando" }),
    "rodando",
  );
  expect(
    within(menu).queryByRole("menuitem", { name: "Remover rodando" }),
  ).toBeNull();
  await app.user.keyboard("{Escape}");

  menu = await abrirMenu(app.user, novo, "novo");
  await app.user.click(
    within(menu).getByRole("menuitem", { name: "Remover novo" }),
  );
  expect(app.calls.ciclo).toEqual(["remover:novo"]);
  act(() => {
    app.emitir({ tipo: "projetoRemovido", projeto: "novo" });
  });

  expect(screen.queryByRole("listitem", { name: "novo" })).toBeNull();
});

test("Excluir projeto pede confirmação e mostra o espaço liberado", async () => {
  const app = renderApp([projeto("pronto", 5)]);
  const cartao = await screen.findByRole("listitem", { name: "pronto" });

  let menu = await abrirMenu(app.user, cartao, "pronto");
  await app.user.click(
    within(menu).getByRole("menuitem", { name: "Excluir pronto" }),
  );
  expect(app.calls.ciclo).toEqual([]);
  await app.user.click(within(cartao).getByRole("button", { name: "Manter" }));
  expect(within(cartao).queryByRole("alertdialog")).toBeNull();

  menu = await abrirMenu(app.user, cartao, "pronto");
  await app.user.click(
    within(menu).getByRole("menuitem", { name: "Excluir pronto" }),
  );
  await app.user.click(
    within(cartao).getByRole("button", {
      name: "Confirmar a exclusão de pronto",
    }),
  );
  expect(app.calls.ciclo).toEqual(["excluir:pronto"]);
  act(() => {
    app.emitir({ tipo: "projetoRemovido", projeto: "pronto" });
  });

  expect(
    await screen.findByText(/pronto excluído: 3 MB liberados/),
  ).toBeVisible();
});

test("o vídeo original que sumiu pode ser localizado de novo", async () => {
  const app = renderApp([projeto("aula", 1, { videoAusente: true })]);
  const cartao = await screen.findByRole("listitem", { name: "aula" });
  expect(cartao).toHaveTextContent("vídeo original não encontrado");
  app.pick(["/outro/aula.mp4"]);

  await app.user.click(
    within(cartao).getByRole("button", { name: "Localizar o vídeo de aula" }),
  );

  expect(app.calls.ciclo).toEqual(["localizar:/outro/aula.mp4:aula"]);
  expect(cartao).not.toHaveTextContent("vídeo original não encontrado");
});

test("no histórico, o projeto cuja pasta sumiu aparece como não encontrado e sai de lá", async () => {
  const app = renderApp([projeto("aula", 5)], ["live (2026-10-08)"]);
  await screen.findByRole("heading", { name: "Linha de produção" });
  await app.user.click(screen.getByRole("button", { name: "Lotes" }));

  const lista = await screen.findByRole("list", {
    name: "Vídeos de Lote de 08/10 14:32",
  });
  expect(lista).toHaveTextContent("live (2026-10-08) · não encontrado");
  await app.user.click(
    within(lista).getByRole("button", {
      name: "Tirar live (2026-10-08) do histórico",
    }),
  );

  expect(app.calls.ciclo).toEqual(["tirarDoHistorico:live (2026-10-08)"]);
});

test("as vagas dizem quem usa a GPU, o Claude e o render", async () => {
  const app = renderApp([projeto("aula", 2), projeto("live", 0)]);
  const vagas = await screen.findByRole("contentinfo", { name: "Vagas" });
  expect(vagas).toHaveTextContent("1 na fila");

  app.etapa("aula", "roteiro", "emAndamento");
  app.vaga("aula", "claude", "usando");

  await within(vagas).findByText("Roteiro de aula");
  expect(vagas).toHaveTextContent(/GPU\s*livre/);
  expect(vagas).toHaveTextContent(/Render\s*livre/);
});

test("com duas vagas do Claude, o rodapé mostra quem as usa e quantos esperam, e o cartão de quem espera diz o quê", async () => {
  const app = renderApp(
    [projeto("aula", 2), projeto("live", 2), projeto("podcast", 2)],
    [],
    {
      paralelismo: {
        videosAoMesmoTempo: null,
        automatico: 4,
        vagas: { gpu: 1, claude: 2, render: 1 },
      },
    },
  );
  const vagas = await screen.findByRole("contentinfo", { name: "Vagas" });

  for (const nome of ["aula", "live"]) {
    app.etapa(nome, "roteiro", "emAndamento");
    app.vaga(nome, "claude", "usando");
  }
  app.vaga("podcast", "claude", "esperando");

  await within(vagas).findByText(
    "Roteiro de aula · Roteiro de live (2/2) · 1 esperando",
  );
  expect(screen.getByRole("listitem", { name: "podcast" })).toHaveTextContent(
    "esperando vaga do Claude",
  );

  app.vaga("aula", "claude", "livre");
  app.etapa("aula", "roteiro", "concluida");
  app.vaga("podcast", "claude", "usando");
  app.etapa("podcast", "roteiro", "emAndamento");

  await within(vagas).findByText("Roteiro de live · Roteiro de podcast (2/2)");
  expect(
    screen.getByRole("listitem", { name: "podcast" }),
  ).not.toHaveTextContent("esperando vaga");
});

test("o render da versão final aparece na vaga do render", async () => {
  const app = renderApp([projeto("aula", 5)]);
  const vagas = await screen.findByRole("contentinfo", { name: "Vagas" });

  app.emitir({
    tipo: "versaoFinalMudou",
    projeto: "aula",
    estado: "emAndamento",
    falha: null,
  });
  app.vaga("aula", "render", "usando");

  await within(vagas).findByText("versão final de aula");
});
