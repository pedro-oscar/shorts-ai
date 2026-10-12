import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { DadosDoProjeto, ReelDoProjeto } from "./bindings";
import { App } from "./App";
import { ACCEPTED_AT, SEM_CUSTO, createFakeNucleo } from "./test/fakeNucleo";

const AULA = "aula (2026-10-09)";

const COM_PLANO = {
  aceite: { data: ACCEPTED_AT },
  plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
} as const;

const DADOS: DadosDoProjeto = {
  custo: SEM_CUSTO,
  reels: [
    {
      id: "c01",
      titulo: "Negociar salário tem regra",
      duracaoEmSegundos: 45.5,
      nota: 8.5,
      categoria: "dica",
      gancho: "Você aceita a primeira oferta?",
      payoff: "A regra dos três números",
      porque: "Fala de dinheiro e tem tese clara",
      descricao: "Descrição do post #salário",
      arquivo: `/Biblioteca/${AULA}/publicar/prévias/c01 - Negociar salário tem regra.mp4`,
      previa: true,
    },
    {
      id: "c02",
      titulo: "Final pronta",
      duracaoEmSegundos: 30,
      nota: 7,
      categoria: null,
      gancho: null,
      payoff: null,
      porque: null,
      descricao: null,
      arquivo: `/Biblioteca/${AULA}/publicar/c02 - Final pronta.mp4`,
      previa: false,
    },
  ],
  reservas: [
    {
      id: "c03",
      titulo: "Quase lá",
      nota: 6.5,
      porque: "Nota abaixo do corte",
    },
  ],
};

const LIVE = "live (2026-10-09)";

type Fake = ReturnType<typeof createFakeNucleo>;

/** Gera um lote com os vídeos, conclui a Produção de cada projeto e abre o passo Reels. */
async function abrirReels(
  preparar: (fake: Fake) => void = () => undefined,
  videos = ["/v/aula.mp4"],
) {
  const fake = createFakeNucleo(COM_PLANO);
  fake.definirDados(AULA, DADOS);
  preparar(fake);
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continuar" }));
  fake.pick(videos);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(await screen.findByRole("button", { name: /^Gerar até/ }));
  await screen.findByRole("heading", { name: "Gerando" });
  expect(screen.queryByRole("button", { name: "Ver reels" })).toBeNull();
  for (const id of [AULA, LIVE].slice(0, videos.length))
    fake.etapa(id, "producao", "concluida");
  await user.click(await screen.findByRole("button", { name: "Ver reels" }));
  await screen.findByRole("heading", { name: "Reels" });
  return { ...fake, user };
}

test("cada reel mostra as informações do roteiro, o selo de prévia e o player", async () => {
  await abrirReels();

  const primeiro = await screen.findByRole("article", {
    name: "Negociar salário tem regra",
  });
  expect(primeiro).toHaveTextContent("0:46");
  expect(primeiro).toHaveTextContent("Nota 8,5");
  expect(primeiro).toHaveTextContent("dica");
  expect(primeiro).toHaveTextContent("Você aceita a primeira oferta?");
  expect(primeiro).toHaveTextContent("A regra dos três números");
  expect(primeiro).toHaveTextContent("Fala de dinheiro e tem tese clara");
  expect(within(primeiro).getByText("Prévia")).toBeVisible();
  expect(primeiro.querySelector("video")?.getAttribute("src")).toBe(
    `asset:///Biblioteca/${AULA}/publicar/prévias/c01 - Negociar salário tem regra.mp4`,
  );

  const segundo = screen.getByRole("article", { name: "Final pronta" });
  expect(within(segundo).queryByText("Prévia")).toBeNull();
});

test("as reservas aparecem esmaecidas, com título, nota e motivo, sem player", async () => {
  await abrirReels();

  const reservas = await screen.findByRole("list", { name: "Reservas" });
  const reserva = within(reservas).getByRole("listitem");
  expect(reserva).toHaveTextContent("Quase lá");
  expect(reserva).toHaveTextContent("Nota 6,5");
  expect(reserva).toHaveTextContent("Nota abaixo do corte");
  expect(reserva.querySelector("video")).toBeNull();
});

test("Copiar descrição põe o texto do post na área de transferência", async () => {
  const { user } = await abrirReels();
  await screen.findByRole("article", { name: "Negociar salário tem regra" });

  await user.click(
    screen.getByRole("button", {
      name: "Copiar descrição de Negociar salário tem regra",
    }),
  );

  expect(await navigator.clipboard.readText()).toBe(
    "Descrição do post #salário",
  );
  expect(
    screen.queryByRole("button", {
      name: "Copiar descrição de Final pronta",
    }),
  ).toBeNull();
});

test("Abrir pasta, roteiro e logs pedem ao núcleo para abrir o projeto", async () => {
  const { user, calls } = await abrirReels();
  await screen.findByRole("article", { name: "Final pronta" });

  await user.click(screen.getByRole("button", { name: "Abrir pasta" }));
  await user.click(screen.getByRole("button", { name: "Abrir roteiro" }));
  await user.click(screen.getByRole("button", { name: "Abrir logs" }));

  expect(calls.abertos).toEqual([
    { id: AULA, alvo: "pasta" },
    { id: AULA, alvo: "roteiro" },
    { id: AULA, alvo: "logs" },
  ]);
});

test("o erro de leitura aparece no projeto que falhou, e os outros seguem com os reels", async () => {
  await abrirReels(
    (fake) => {
      fake.falharLeitura(LIVE, {
        codigo: "projetoNaoLido",
        id: LIVE,
        detalhe: "roteiro ilegível",
      });
    },
    ["/v/aula.mp4", "/v/live.mp4"],
  );

  const live = screen.getByRole("region", { name: "live" });
  expect(await within(live).findByRole("alert")).toHaveTextContent(
    `Não foi possível ler o projeto ${LIVE}`,
  );
  const aula = screen.getByRole("region", { name: "aula" });
  expect(
    await within(aula).findByRole("article", { name: "Final pronta" }),
  ).toBeVisible();
  expect(within(aula).queryByRole("alert")).toBeNull();
});

test("projeto cuja pasta sumiu aparece como não encontrado, sem nada para abrir", async () => {
  await abrirReels((fake) => {
    fake.falharLeitura(AULA, { codigo: "projetoNaoEncontrado", id: AULA });
  });

  const aula = screen.getByRole("region", { name: "aula" });
  expect(await within(aula).findByRole("alert")).toHaveTextContent(
    `O projeto ${AULA} não foi encontrado na Biblioteca`,
  );
  expect(
    within(aula).queryByRole("button", { name: "Abrir pasta" }),
  ).toBeNull();
  expect(
    within(aula).queryByRole("button", { name: "Abrir roteiro" }),
  ).toBeNull();
  expect(within(aula).queryByRole("button", { name: "Abrir logs" })).toBeNull();
});

test("se o sistema não abre, o erro aparece no projeto", async () => {
  const roteiro = `/Biblioteca/${AULA}/edit/roteiro.json`;
  const { user } = await abrirReels((fake) => {
    fake.falharAbertura({
      codigo: "naoAbriu",
      caminho: roteiro,
      detalhe: "No such file or directory (os error 2)",
    });
  });
  const aula = screen.getByRole("region", { name: "aula" });
  await within(aula).findByRole("article", { name: "Final pronta" });

  await user.click(within(aula).getByRole("button", { name: "Abrir roteiro" }));

  expect(await within(aula).findByRole("alert")).toHaveTextContent(
    `Não foi possível abrir ${roteiro}`,
  );
});

/** O sistema recusa tocar o arquivo direto, como o WebKitGTK faz com o protocolo de arquivos. */
async function recusarDireto(titulo: string) {
  const reel = await screen.findByRole("article", { name: titulo });
  const video = reel.querySelector("video");
  if (!video) throw new Error(`${titulo} sem player`);
  fireEvent.error(video);
  return reel;
}

test("onde o app não toca o reel, Assistir o abre no player do sistema", async () => {
  const { user, calls } = await abrirReels();
  const reel = await recusarDireto("Negociar salário tem regra");
  expect(reel.querySelector("video")).toBeNull();
  expect(reel).toHaveTextContent("Este sistema não toca o reel aqui.");

  await user.click(
    within(reel).getByRole("button", {
      name: "Assistir Negociar salário tem regra no player do sistema",
    }),
  );

  expect(calls.abertos).toEqual([{ id: AULA, alvo: { reel: "c01" } }]);
  const outro = screen.getByRole("article", { name: "Final pronta" });
  expect(outro.querySelector("video")).not.toBeNull();
});

const [PREVIA, PRONTA] = DADOS.reels as [ReelDoProjeto, ReelDoProjeto];
const FINAL = `/Biblioteca/${AULA}/publicar/c01 - Negociar salário tem regra.mp4`;

test("Gerar versão final pede o render do projeto, mostra o andamento e depois a versão final", async () => {
  const { user, calls, emitir, definirDados } = await abrirReels();
  const aula = screen.getByRole("region", { name: "aula" });
  await within(aula).findByRole("article", {
    name: "Negociar salário tem regra",
  });

  await user.click(
    within(aula).getByRole("button", {
      name: "Gerar versão final de aula",
    }),
  );

  expect(calls.versoesFinais).toEqual([[AULA]]);
  expect(await within(aula).findByText("Versão final…")).toBeVisible();
  expect(
    within(aula).queryByRole("button", { name: /Gerar versão final de/ }),
  ).toBeNull();

  emitir({
    tipo: "versaoFinalMudou",
    projeto: AULA,
    estado: "emAndamento",
    falha: null,
  });
  emitir({ tipo: "progressoDaVersaoFinal", projeto: AULA, percentual: 40 });
  expect(await within(aula).findByText("Versão final… 40%")).toBeVisible();

  definirDados(AULA, {
    ...DADOS,
    reels: [{ ...PREVIA, arquivo: FINAL, previa: false }, PRONTA],
  });
  emitir({
    tipo: "versaoFinalMudou",
    projeto: AULA,
    estado: "concluida",
    falha: null,
  });

  const primeiro = await within(aula).findByRole("article", {
    name: "Negociar salário tem regra",
  });
  await vi.waitFor(() => {
    expect(primeiro.querySelector("video")?.getAttribute("src")).toBe(
      `asset://${FINAL}`,
    );
  });
  expect(within(primeiro).queryByText("Prévia")).toBeNull();
  expect(
    within(aula).queryByRole("button", { name: /Gerar versão final de/ }),
  ).toBeNull();
});

test("Gerar versão final do lote pede todos os projetos que ainda têm prévia", async () => {
  const { user, calls } = await abrirReels(
    (fake) => {
      fake.definirDados(LIVE, { ...DADOS, reels: [PRONTA] });
    },
    ["/v/aula.mp4", "/v/live.mp4"],
  );
  await screen.findByRole("article", { name: "Negociar salário tem regra" });

  await user.click(
    screen.getByRole("button", { name: "Gerar versão final do lote" }),
  );

  expect(calls.versoesFinais).toEqual([[AULA]]);
  expect(
    screen.queryByRole("button", { name: "Gerar versão final do lote" }),
  ).toBeNull();
});

test("a falha do render aparece no projeto e deixa pedir de novo", async () => {
  const { emitir } = await abrirReels();
  const aula = screen.getByRole("region", { name: "aula" });
  await within(aula).findByRole("article", {
    name: "Negociar salário tem regra",
  });

  emitir({
    tipo: "versaoFinalMudou",
    projeto: AULA,
    estado: "falhou",
    falha: "chrome não abriu",
  });

  expect(await within(aula).findByRole("alert")).toHaveTextContent(
    "A versão final de aula falhou: chrome não abriu",
  );
  expect(
    within(aula).getByRole("button", { name: "Gerar versão final de aula" }),
  ).toBeVisible();
});
