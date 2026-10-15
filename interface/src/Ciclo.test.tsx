import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { act } from "react";
import { expect, test } from "vitest";
import type { LoteResumo, ProjetoResumo } from "./bindings";
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
  falhouEm?: (typeof ETAPAS)[number],
): ProjetoResumo {
  return {
    id: titulo,
    titulo,
    pasta: `/Biblioteca/${titulo}`,
    lote: LOTE_ID,
    etapas: ETAPAS.map((etapa, i) => ({
      etapa,
      estado:
        etapa === falhouEm
          ? "falhou"
          : i < concluidas
            ? "concluida"
            : "pendente",
    })),
    falha: falhouEm ? "boom" : null,
    parada: null,
    videoAusente: false,
    excecoes: {},
    custo: SEM_CUSTO,
    ...extra,
  };
}

function renderApp(projetos: ProjetoResumo[]) {
  const lote: LoteResumo = {
    id: LOTE_ID,
    nome: "Lote de 08/10 14:32",
    criadoEm: "2026-10-08T14:32:00Z",
    padroes: PADROES_INICIAIS,
    projetos,
    ausentes: [],
    aberto: true,
    custo: SEM_CUSTO,
  };
  const fake = createFakeNucleo(INICIAL, LOGADO, [lote]);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, user: userEvent.setup() };
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

test("Pausar e Cancelar valem para o projeto que anda; o estado muda pelos eventos", async () => {
  const app = renderApp([projeto("aula", 1)]);
  const cartao = await screen.findByRole("listitem", { name: "aula" });

  await app.user.click(
    within(cartao).getByRole("button", { name: "Pausar aula" }),
  );
  expect(app.calls.ciclo).toEqual(["pausar:aula"]);
  act(() => {
    app.emitir({ tipo: "paradaMudou", projeto: "aula", parada: "pausado" });
  });

  expect(cartao).toHaveTextContent("Pausado");
  expect(
    within(cartao).queryByRole("button", { name: "Pausar aula" }),
  ).toBeNull();
  let menu = await abrirMenu(app.user, cartao, "aula");
  await app.user.click(
    within(menu).getByRole("menuitem", { name: "Cancelar aula" }),
  );
  expect(app.calls.ciclo).toEqual(["pausar:aula", "cancelar:aula"]);
  act(() => {
    app.emitir({ tipo: "paradaMudou", projeto: "aula", parada: "cancelado" });
  });
  expect(cartao).toHaveTextContent("Cancelado");
  menu = await abrirMenu(app.user, cartao, "aula");
  expect(
    within(menu).queryByRole("menuitem", { name: "Cancelar aula" }),
  ).toBeNull();
  await app.user.keyboard("{Escape}");

  await app.user.click(
    within(cartao).getByRole("button", { name: "Retomar aula" }),
  );
  expect(app.calls.ciclo.at(-1)).toBe("retomar:aula");
  act(() => {
    app.emitir({ tipo: "paradaMudou", projeto: "aula", parada: null });
  });
  expect(cartao).toHaveTextContent("Em andamento");
});

test("a cota que acaba deixa o projeto Aguardando cota, com Retomar agora e Cancelar", async () => {
  const app = renderApp([projeto("aula", 2)]);
  const cartao = await screen.findByRole("listitem", { name: "aula" });

  act(() => {
    app.emitir({
      tipo: "paradaMudou",
      projeto: "aula",
      parada: "aguardandoCota",
    });
  });

  expect(cartao).toHaveTextContent("Aguardando cota");
  expect(
    within(cartao).queryByRole("button", { name: "Pausar aula" }),
  ).toBeNull();
  let menu = await abrirMenu(app.user, cartao, "aula");
  expect(
    within(menu).queryByRole("menuitem", { name: "Excluir aula" }),
  ).toBeNull();
  await app.user.keyboard("{Escape}");
  await app.user.click(
    within(cartao).getByRole("button", { name: "Retomar aula agora" }),
  );
  expect(app.calls.ciclo).toEqual(["retomar:aula"]);
  act(() => {
    app.emitir({ tipo: "paradaMudou", projeto: "aula", parada: null });
  });
  expect(cartao).toHaveTextContent("Em andamento");
  menu = await abrirMenu(app.user, cartao, "aula");
  await app.user.click(
    within(menu).getByRole("menuitem", { name: "Cancelar aula" }),
  );
  expect(app.calls.ciclo.at(-1)).toBe("cancelar:aula");
});

test("o projeto que falhou fica na coluna da etapa e oferece Tentar de novo a partir dela", async () => {
  const app = renderApp([projeto("aula", 2, {}, "roteiro")]);
  const cartao = await screen.findByRole("listitem", { name: "aula" });
  expect(
    within(screen.getByRole("list", { name: "Roteiro" })).getByRole(
      "listitem",
      { name: "aula" },
    ),
  ).toBe(cartao);

  expect(
    within(cartao).queryByRole("button", { name: "Pausar aula" }),
  ).toBeNull();
  await app.user.click(
    within(cartao).getByRole("button", {
      name: "Tentar de novo aula",
    }),
  );

  expect(app.calls.ciclo).toEqual(["tentarDeNovo:aula"]);
  expect(
    within(cartao).getByRole("button", { name: "Tentar de novo aula" }),
  ).toHaveTextContent("Tentar de novo a partir de Roteiro");
});

test("ao reabrir com projetos pausados, a faixa Retomar lote os retoma", async () => {
  const app = renderApp([
    projeto("aula", 1, { parada: "pausado" }),
    projeto("live", 0, { parada: "pausado" }),
  ]);
  await screen.findByRole("heading", { name: "Linha de produção" });
  expect(screen.getByRole("listitem", { name: "aula" })).toHaveTextContent(
    "Pausado",
  );

  await app.user.click(screen.getByRole("button", { name: "Retomar lote" }));

  expect(app.calls.ciclo).toEqual([`retomarLote:${LOTE_ID}`]);
});

test("sem projeto pausado, não há faixa Retomar lote", async () => {
  renderApp([projeto("aula", 1)]);
  await screen.findByRole("heading", { name: "Linha de produção" });

  expect(screen.queryByRole("button", { name: "Retomar lote" })).toBeNull();
});
