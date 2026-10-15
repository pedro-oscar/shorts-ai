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

async function abrirVideos(fake = createFakeNucleo(INICIAL)) {
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Vídeos" });
  fake.pick(["/v/aula.mp4", "/v/live.mkv"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  const lista = await screen.findByRole("list", { name: "Vídeos escolhidos" });
  const [aula, live] = within(lista).getAllByRole("listitem") as [
    HTMLElement,
    HTMLElement,
  ];
  return { ...fake, user, aula, live };
}

test("os vídeos usam os padrões do lote até a pessoa abrir os Ajustes", async () => {
  const { user, calls, aula, live } = await abrirVideos();
  expect(aula).toHaveTextContent("usa os padrões do lote");

  await user.click(
    within(aula).getByRole("button", { name: "Ajustar aula.mp4" }),
  );
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
  await user.click(within(aula).getByRole("button", { name: "Pronto" }));

  const chips = within(aula).getByRole("list", { name: "Exceções definidas" });
  expect(
    within(chips)
      .getAllByRole("listitem")
      .map((c) => c.textContent),
  ).toEqual(["até 2 reels", "pedido próprio", "idioma: Inglês"]);
  expect(live).toHaveTextContent("usa os padrões do lote");

  await user.click(screen.getByRole("button", { name: /^Gerar/ }));

  await screen.findByRole("heading", { name: "Linha de produção" });
  expect(calls.excecoesDosArquivos).toEqual([
    [
      {
        quantidadeDeReels: 2,
        pedido: "só humor",
        faixa: null,
        nomesProprios: null,
        idiomaDoVideo: "en",
        kit: null,
        semLogo: false,
      },
      {
        quantidadeDeReels: null,
        pedido: null,
        faixa: null,
        nomesProprios: null,
        idiomaDoVideo: null,
        kit: null,
        semLogo: false,
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

function loteCom(projetos: ProjetoResumo[]): LoteResumo {
  return {
    id: "lote",
    nome: "Lote",
    criadoEm: "2026-10-08T14:32:00Z",
    padroes: PADROES_INICIAIS,
    projetos,
    ausentes: [],
    aberto: true,
    custo: SEM_CUSTO,
  };
}

test("o projeto na fila muda as Exceções; o que já começou só mostra o resumo", async () => {
  const lote = loteCom([
    projeto("rodando", 1, { excecoes: { pedido: "x" } }),
    projeto("novo", 0),
  ]);
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
        kit: null,
        semLogo: false,
      },
    },
  ]);
  const chips = await within(novo).findByRole("list", {
    name: "Exceções definidas",
  });
  expect(chips).toHaveTextContent("até 3 reels");
  expect(chips).toHaveTextContent("faixa 1:00–—");
  expect(within(novo).queryByRole("dialog")).toBeNull();
});

const CANAL = {
  nome: "Canal",
  corDeDestaque: "#00AAFF",
  corDaPalavra: "#FFFFFF",
  fonteDaLegenda: "Inter",
  fonteDosTitulos: "Anton",
  logo: null,
} as const;

test('a pessoa escolhe outro kit ou liga "Sem logo" só num vídeo do lote', async () => {
  const fake = createFakeNucleo(INICIAL);
  await fake.nucleo.salvarKit(CANAL);
  const { user, aula, live } = await abrirVideos(fake);

  await user.click(
    within(aula).getByRole("button", { name: "Ajustar aula.mp4" }),
  );
  await user.selectOptions(
    within(aula).getByLabelText("Kit de aula.mp4"),
    "Canal",
  );
  await user.click(within(aula).getByRole("button", { name: "Pronto" }));
  await user.click(
    within(live).getByRole("button", { name: "Ajustar live.mkv" }),
  );
  await user.click(within(live).getByLabelText("Sem logo em live.mkv"));
  await user.click(within(live).getByRole("button", { name: "Pronto" }));

  expect(aula).toHaveTextContent("kit: Canal");
  expect(live).toHaveTextContent("sem logo");

  await user.click(screen.getByRole("button", { name: /^Gerar/ }));

  await screen.findByRole("heading", { name: "Linha de produção" });
  const [excecoes] = fake.calls.excecoesDosArquivos;
  expect(excecoes?.map((e) => [e.kit, e.semLogo])).toEqual([
    ["Canal", false],
    [null, true],
  ]);
});

test('o projeto na fila grava o kit e o "Sem logo" escolhidos nas Exceções', async () => {
  const fake = createFakeNucleo(INICIAL, LOGADO, [
    loteCom([projeto("novo", 0)]),
  ]);
  await fake.nucleo.salvarKit(CANAL);
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  const novo = await screen.findByRole("listitem", { name: "novo" });

  await user.click(
    within(novo).getByRole("button", { name: "Exceções de novo" }),
  );
  await user.selectOptions(within(novo).getByLabelText("Kit de novo"), "Canal");
  await user.click(within(novo).getByLabelText("Sem logo em novo"));
  await user.click(
    within(novo).getByRole("button", { name: "Salvar exceções de novo" }),
  );

  expect(fake.calls.excecoes).toHaveLength(1);
  expect(fake.calls.excecoes[0]?.excecoes).toMatchObject({
    kit: "Canal",
    semLogo: true,
  });
});
