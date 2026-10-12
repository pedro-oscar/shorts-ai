import { act, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { LoteResumo, ProjetoResumo, ResumoDeCusto } from "./bindings";
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

const LOTE_ID = "2026-10-12T10-00-00";

const CUSTO: ResumoDeCusto = {
  sessoes: [
    {
      etapa: "roteiro",
      ordem: 1,
      tokens: {
        entrada: 64,
        saida: 54169,
        cacheLeitura: 2283532,
        cacheCriacao: 115691,
      },
      custoUsd: 2.47,
      duracaoS: 592,
      modelos: ["claude-opus-5-5"],
      parcial: false,
      precoAConferir: false,
    },
    {
      etapa: "revisao",
      ordem: 1,
      tokens: {
        entrada: 5,
        saida: 425,
        cacheLeitura: 84500,
        cacheCriacao: 44200,
      },
      custoUsd: 0.38,
      duracaoS: 61,
      modelos: ["claude-opus-5-5"],
      parcial: false,
      precoAConferir: true,
    },
  ],
  tokens: {
    entrada: 69,
    saida: 54594,
    cacheLeitura: 2368032,
    cacheCriacao: 159891,
  },
  custoUsd: 2.85,
  duracaoS: 653,
  parcial: false,
  precoAConferir: true,
  reels: 3,
  porReelUsd: 0.95,
};

function projeto(custo: ResumoDeCusto): ProjetoResumo {
  return {
    id: "aula",
    titulo: "aula",
    pasta: "/Biblioteca/aula",
    lote: LOTE_ID,
    etapas: (
      ["importacao", "transcricao", "roteiro", "producao", "revisao"] as const
    ).map((etapa) => ({ etapa, estado: "concluida" as const })),
    falha: null,
    parada: null,
    videoAusente: false,
    excecoes: {},
    custo,
  };
}

function renderApp(custo: ResumoDeCusto) {
  const item = projeto(custo);
  const lote: LoteResumo = {
    id: LOTE_ID,
    nome: "Lote de 12/10 10:00",
    criadoEm: "2026-10-12T10:00:00Z",
    padroes: PADROES_INICIAIS,
    projetos: [item],
    ausentes: [],
    aberto: true,
    custo,
  };
  const fake = createFakeNucleo(INICIAL, LOGADO, [lote]);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, lote };
}

test("o Gerando mostra o custo do lote e do projeto como estimado, com o rateio e o preço a conferir", async () => {
  renderApp(CUSTO);
  const linha = await screen.findByRole("listitem", { name: "aula" });

  const lote = screen.getByLabelText("Custo estimado do lote");
  expect(lote).toHaveTextContent("Custo estimado: US$ 2,85");
  expect(lote).toHaveTextContent("US$ 0,95 por reel");
  expect(lote).toHaveTextContent("preço a conferir");
  expect(
    within(linha).getByLabelText("Custo estimado do projeto"),
  ).toHaveTextContent("Custo estimado: US$ 2,85");
});

test("o detalhe do projeto traz o custo por etapa com tokens, % de cache, tempo e modelo", async () => {
  renderApp(CUSTO);
  const linha = await screen.findByRole("listitem", { name: "aula" });

  const detalhe = within(linha).getByRole("list", { name: "Custo por etapa" });
  const [roteiro, revisao] = within(detalhe).getAllByRole("listitem");
  expect(roteiro).toHaveTextContent("Roteiro");
  expect(roteiro).toHaveTextContent("entrada 64");
  expect(roteiro).toHaveTextContent("saída 54.169");
  expect(roteiro).toHaveTextContent("cache lido 2.283.532");
  expect(roteiro).toHaveTextContent("cache escrito 115.691 (95% de cache)");
  expect(roteiro).toHaveTextContent("9:52");
  expect(roteiro).toHaveTextContent("claude-opus-5-5");
  expect(roteiro).not.toHaveTextContent("preço a conferir");
  expect(revisao).toHaveTextContent("Revisão 1");
  expect(revisao).toHaveTextContent("preço a conferir");
});

test("sem sessão do Claude não aparece custo", async () => {
  renderApp(SEM_CUSTO);
  await screen.findByRole("listitem", { name: "aula" });

  expect(screen.queryByLabelText("Custo estimado do projeto")).toBeNull();
  expect(screen.queryByLabelText("Custo estimado do lote")).toBeNull();
});

test("o custo fecha quando a etapa do Claude termina", async () => {
  const app = renderApp(SEM_CUSTO);
  await screen.findByRole("listitem", { name: "aula" });

  for (const item of app.lote.projetos) item.custo = CUSTO;
  app.lote.custo = CUSTO;
  act(() => {
    app.emitir({
      tipo: "etapaMudou",
      projeto: "aula",
      etapa: "roteiro",
      estado: "concluida",
      falha: null,
    });
  });

  expect(
    await screen.findByLabelText("Custo estimado do lote"),
  ).toHaveTextContent("US$ 2,85");
});
