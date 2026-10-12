import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
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

async function abrirVideos() {
  const fake = createFakeNucleo(INICIAL);
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continuar" }));
  fake.pick(["/v/aula.mp4", "/v/live.mkv"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  return { ...fake, user };
}

test("os vídeos usam os padrões do lote até a pessoa abrir as Exceções", async () => {
  const { user, calls } = await abrirVideos();
  const aula = screen.getAllByRole("listitem")[0] as HTMLElement;
  const live = screen.getAllByRole("listitem")[1] as HTMLElement;
  expect(aula).toHaveTextContent("usa os padrões do lote");

  await user.click(within(aula).getByText("Exceções"));
  await user.selectOptions(
    within(aula).getByLabelText("Até quantos reels em aula.mp4"),
    "2",
  );
  await user.type(
    within(aula).getByLabelText("Pedido de aula.mp4"),
    "só humor",
  );
  await user.selectOptions(
    within(aula).getByLabelText("Idioma de aula.mp4"),
    "Inglês",
  );

  const chips = within(aula).getByRole("list", { name: "Exceções definidas" });
  expect(
    within(chips)
      .getAllByRole("listitem")
      .map((c) => c.textContent),
  ).toEqual(["até 2 reels", "pedido próprio", "idioma: Inglês"]);
  expect(live).toHaveTextContent("usa os padrões do lote");

  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(screen.getByRole("button", { name: /^Gerar/ }));

  await screen.findByRole("heading", { name: "Gerando" });
  expect(calls.excecoesDosArquivos).toEqual([
    [
      {
        quantidadeDeReels: 2,
        pedido: "só humor",
        faixa: null,
        nomesProprios: null,
        idiomaDoVideo: "en",
      },
      {
        quantidadeDeReels: null,
        pedido: null,
        faixa: null,
        nomesProprios: null,
        idiomaDoVideo: null,
      },
    ],
  ]);
});

function projeto(
  titulo: string,
  concluidas: number,
  extra: Partial<ProjetoResumo> = {},
): ProjetoResumo {
  return {
    id: titulo,
    titulo,
    pasta: `/Biblioteca/${titulo}`,
    lote: "lote",
    etapas: (
      ["importacao", "transcricao", "roteiro", "producao", "revisao"] as const
    ).map((etapa, i) => ({
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

test("o projeto na fila muda as Exceções; o que já começou só mostra o resumo", async () => {
  const lote: LoteResumo = {
    id: "lote",
    nome: "Lote",
    criadoEm: "2026-10-08T14:32:00Z",
    padroes: PADROES_INICIAIS,
    projetos: [
      projeto("rodando", 1, { excecoes: { pedido: "x" } }),
      projeto("novo", 0),
    ],
    ausentes: [],
    aberto: true,
    custo: SEM_CUSTO,
  };
  const fake = createFakeNucleo(INICIAL, LOGADO, [lote]);
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  const rodando = await screen.findByRole("listitem", { name: "rodando" });
  const novo = screen.getByRole("listitem", { name: "novo" });
  expect(
    within(rodando).queryByRole("button", { name: "Exceções de rodando" }),
  ).toBeNull();
  expect(rodando).toHaveTextContent("pedido próprio");

  await user.click(
    within(novo).getByRole("button", { name: "Exceções de novo" }),
  );
  await user.selectOptions(
    within(novo).getByLabelText("Até quantos reels em novo"),
    "3",
  );
  await user.type(within(novo).getByLabelText("Início de novo (m:ss)"), "1:00");
  await user.click(
    within(novo).getByRole("button", { name: "Salvar exceções de novo" }),
  );

  expect(fake.calls.excecoes).toEqual([
    {
      projeto: "novo",
      excecoes: {
        quantidadeDeReels: 3,
        pedido: null,
        faixa: { inicio: 60, fim: null },
        nomesProprios: null,
        idiomaDoVideo: null,
      },
    },
  ]);
  const chips = await within(novo).findByRole("list", {
    name: "Exceções definidas",
  });
  expect(chips).toHaveTextContent("até 3 reels");
  expect(chips).toHaveTextContent("faixa 1:00–—");
});
