import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { act } from "react";
import { expect, test } from "vitest";
import type { LoteResumo, ProjetoResumo } from "./bindings";
import { App } from "./App";
import { PADROES_INICIAIS } from "./store";
import { ACCEPTED_AT, LOGADO, createFakeNucleo } from "./test/fakeNucleo";

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
    ...extra,
  };
}

function renderApp(projetos: ProjetoResumo[], ausentes: string[] = []) {
  const lote: LoteResumo = {
    id: LOTE_ID,
    nome: "Lote de 08/10 14:32",
    criadoEm: "2026-10-08T14:32:00Z",
    padroes: PADROES_INICIAIS,
    projetos,
    ausentes,
    aberto: true,
  };
  const fake = createFakeNucleo(INICIAL, LOGADO, [lote]);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, user: userEvent.setup() };
}

function titulos() {
  return screen
    .getAllByRole("listitem")
    .filter((item) => item.getAttribute("aria-label"))
    .map((item) => item.getAttribute("aria-label"));
}

test("Subir, Descer e Passar na frente valem na fila, e a ordem nova chega por evento", async () => {
  const app = renderApp([
    projeto("rodando", 1),
    projeto("a", 0),
    projeto("b", 0),
  ]);
  const a = await screen.findByRole("listitem", { name: "a" });
  const b = screen.getByRole("listitem", { name: "b" });

  expect(within(a).getByRole("button", { name: "Subir a" })).toBeDisabled();
  expect(within(b).getByRole("button", { name: "Descer b" })).toBeDisabled();
  expect(
    screen.getByRole("listitem", { name: "rodando" }),
  ).not.toHaveTextContent("Passar");

  await app.user.click(
    within(b).getByRole("button", { name: "Passar b na frente" }),
  );
  expect(app.calls.ciclo).toEqual(["mover:passarNaFrente:b"]);
  act(() => {
    app.emitir({
      tipo: "filaReordenada",
      lote: LOTE_ID,
      projetos: ["rodando", "b", "a"],
    });
  });

  expect(titulos()).toEqual(["rodando", "b", "a"]);
});

test("Remover só aparece para o projeto que nunca começou e o tira da lista", async () => {
  const app = renderApp([projeto("rodando", 1), projeto("novo", 0)]);
  const novo = await screen.findByRole("listitem", { name: "novo" });
  expect(
    within(screen.getByRole("listitem", { name: "rodando" })).queryByRole(
      "button",
      { name: "Remover rodando" },
    ),
  ).toBeNull();

  await app.user.click(
    within(novo).getByRole("button", { name: "Remover novo" }),
  );
  expect(app.calls.ciclo).toEqual(["remover:novo"]);
  act(() => {
    app.emitir({ tipo: "projetoRemovido", projeto: "novo" });
  });

  expect(screen.queryByRole("listitem", { name: "novo" })).toBeNull();
});

test("Excluir projeto pede confirmação e mostra o espaço liberado", async () => {
  const app = renderApp([projeto("pronto", 5)]);
  const linha = await screen.findByRole("listitem", { name: "pronto" });

  await app.user.click(
    within(linha).getByRole("button", { name: "Excluir pronto" }),
  );
  expect(app.calls.ciclo).toEqual([]);
  await app.user.click(within(linha).getByRole("button", { name: "Manter" }));
  expect(
    within(linha).getByRole("button", { name: "Excluir pronto" }),
  ).toBeVisible();

  await app.user.click(
    within(linha).getByRole("button", { name: "Excluir pronto" }),
  );
  await app.user.click(
    within(linha).getByRole("button", {
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
  const linha = await screen.findByRole("listitem", { name: "aula" });
  expect(linha).toHaveTextContent("vídeo original não encontrado");
  app.pick(["/outro/aula.mp4"]);

  await app.user.click(
    within(linha).getByRole("button", { name: "Localizar o vídeo de aula" }),
  );

  expect(app.calls.ciclo).toEqual(["localizar:/outro/aula.mp4:aula"]);
  expect(linha).not.toHaveTextContent("vídeo original não encontrado");
});

test("no histórico, o projeto cuja pasta sumiu aparece como não encontrado e sai de lá", async () => {
  const app = renderApp([projeto("aula", 5)], ["live (2026-10-08)"]);
  await screen.findByRole("heading", { name: "Gerando" });
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
