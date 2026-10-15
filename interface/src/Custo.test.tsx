import { act, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type {
  EstadoDaConta,
  EstadoInicial,
  LoteResumo,
  ProjetoResumo,
  ResumoDeCusto,
} from "./bindings";
import { App } from "./App";
import { PADROES_INICIAIS } from "./store";
import {
  ACCEPTED_AT,
  LOGADO,
  SEM_CUSTO,
  createFakeNucleo,
  planoCompleto,
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

function renderApp(
  custo: ResumoDeCusto,
  inicial: Partial<EstadoInicial> = INICIAL,
  conta: EstadoDaConta = LOGADO,
) {
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
  const fake = createFakeNucleo(inicial, conta, [lote]);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, lote };
}

test("a Linha de produção mostra o custo do lote e do projeto como estimado, com o rateio e o preço a conferir", async () => {
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

const API = { ...CUSTO, custoUsd: 3.6, porReelUsd: 1.2 };

test("quem tem assinatura vê o custo efetivo em destaque, com a faixa e o preço de API embaixo", async () => {
  renderApp(API, {
    ...INICIAL,
    plano: planoCompleto({
      nivel: "max5x",
      periodo: "mensal",
      precoDeApi: false,
    }),
  });
  await screen.findByRole("listitem", { name: "aula" });

  const lote = screen.getByRole("group", { name: "Custo estimado do lote" });
  const destaque = within(lote).getByText("≈ US$ 1,20 no seu plano");
  expect(destaque.getAttribute("title")?.replace(/\s/g, " ")).toBe(
    "Entre US$ 0,84 e US$ 1,56",
  );
  expect(lote).toHaveTextContent("(estimado)");
  expect(lote).toHaveTextContent("US$ 0,40 por reel");
  expect(lote).toHaveTextContent(
    "US$ 3,60 em preço de API · não é cobrado à parte, usa a cota do plano",
  );
});

test("a cobrança anual abate a mensalidade do custo efetivo", async () => {
  renderApp(
    API,
    {
      ...INICIAL,
      plano: planoCompleto({
        nivel: "pro",
        periodo: "anual",
        precoDeApi: false,
      }),
    },
    { ...LOGADO, plano: "pro" },
  );

  const lote = await screen.findByRole("group", {
    name: "Custo estimado do lote",
  });
  expect(lote).toHaveTextContent("≈ US$ 1,22 no seu plano");
});

test("no Console o preço de API aparece como cobrança", async () => {
  renderApp(
    API,
    {
      ...INICIAL,
      plano: planoCompleto({
        nivel: "console",
        periodo: null,
        precoDeApi: true,
      }),
    },
    { ...LOGADO, metodo: "console", plano: null, cobranca: "porUso" },
  );

  const lote = await screen.findByLabelText("Custo estimado do lote");
  expect(lote).toHaveTextContent("Cobrança estimada: US$ 3,60");
  expect(lote).not.toHaveTextContent("no seu plano");
});

test("com a cotação digitada os valores saem em reais", async () => {
  renderApp(API, {
    ...INICIAL,
    plano: planoCompleto({
      nivel: "max5x",
      periodo: "mensal",
      precoDeApi: false,
    }),
    cotacao: { valor: 5, data: "2026-10-12" },
  });

  const lote = await screen.findByRole("group", {
    name: "Custo estimado do lote",
  });
  expect(lote).toHaveTextContent("≈ R$ 6,00 no seu plano");
  expect(lote).toHaveTextContent("R$ 18 em preço de API");
});
