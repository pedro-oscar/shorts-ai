import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "./App";
import {
  ACCEPTED_AT,
  createFakeNucleo,
  planoCompleto,
} from "./test/fakeNucleo";

async function abrirPadroes(videos = ["/v/aula.mp4"]) {
  const { fake, user } = await abrirPadroesComFake(videos);
  return { ...fake, user };
}

async function abrirPadroesComFake(videos = ["/v/aula.mp4"]) {
  const fake = createFakeNucleo({
    aceite: { data: ACCEPTED_AT },
    plano: planoCompleto({
      nivel: "max5x",
      periodo: "mensal",
      precoDeApi: false,
    }),
  });
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continuar" }));
  fake.pick(videos);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Padrões" });
  return { fake, user };
}

test("os padrões abrem com até 6 reels, prévia ligada e o botão conta os vídeos", async () => {
  await abrirPadroes(["/v/aula.mp4", "/v/live.mkv"]);

  expect(screen.getByLabelText("Até quantos reels")).toHaveValue("6");
  expect(screen.getByLabelText(/prévia/i)).toBeChecked();
  screen.getByRole("button", { name: "Gerar até 6 reels de 2 vídeos" });
});

test("o botão acompanha o número de reels e o singular de um vídeo", async () => {
  const { user } = await abrirPadroes();

  await user.selectOptions(screen.getByLabelText("Até quantos reels"), "1");

  screen.getByRole("button", { name: "Gerar até 1 reel de 1 vídeo" });
});

test("as opções escolhidas seguem para o núcleo ao gerar", async () => {
  const { user, calls } = await abrirPadroes();
  await user.selectOptions(screen.getByLabelText("Até quantos reels"), "3");
  await user.click(screen.getByLabelText(/prévia/i));
  await user.type(screen.getByLabelText("Pedido"), "só humor");
  await user.click(screen.getByText("Mais opções"));
  await user.selectOptions(screen.getByLabelText("Revisões do Claude"), "2");
  await user.selectOptions(screen.getByLabelText("Modelo"), "Sonnet");
  await user.type(
    screen.getByLabelText("Nomes próprios"),
    "Ana Souza{Enter}Remotion",
  );
  await user.selectOptions(screen.getByLabelText("Idioma do vídeo"), "Inglês");

  await user.click(
    screen.getByRole("button", { name: "Gerar até 3 reels de 1 vídeo" }),
  );

  await screen.findByRole("heading", { name: "Gerando" });
  expect(calls.padroes).toEqual([
    {
      quantidadeDeReels: 3,
      previa: false,
      pedido: "só humor",
      revisoes: 2,
      modelo: "sonnet",
      nomesProprios: ["Ana Souza", "Remotion"],
      idiomaDoVideo: "en",
      kit: "Padrão",
    },
  ]);
});

test("Voltar leva a Vídeos sem perder a lista nem as escolhas", async () => {
  const { user } = await abrirPadroes();
  await user.selectOptions(screen.getByLabelText("Até quantos reels"), "4");

  await user.click(screen.getByRole("button", { name: "Voltar" }));
  await screen.findByRole("heading", { name: "Vídeos" });
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Continuar" }));

  expect(await screen.findByLabelText("Até quantos reels")).toHaveValue("4");
});

test("a estimativa mostra o custo no plano por vídeo e do lote, as sessões e o tempo", async () => {
  await abrirPadroes(["/v/aula.mp4", "/v/live.mkv"]);

  const estimativa = await screen.findByRole("region", { name: "Estimativa" });
  expect(estimativa).toHaveTextContent("Estimativa inicial");
  // Max 5x mensal: o custo efetivo é 1/3 do preço de API (US$ 0,70 a US$ 1,80).
  expect(estimativa).toHaveTextContent(
    /Custo por vídeo: US\$\s0,23 a US\$\s0,60/,
  );
  expect(estimativa).toHaveTextContent(
    /Custo do lote: US\$\s0,23 a US\$\s0,60/,
  );
  expect(estimativa).toHaveTextContent("2 sessões do Claude");
  expect(estimativa).toHaveTextContent(
    "Tempo neste computador: 10 min a 25 min",
  );
});

test("a estimativa pede ao núcleo os padrões e as durações, e refaz ao mudar uma opção", async () => {
  const { user, calls } = await abrirPadroes(["/v/aula.mp4", "/v/live.mkv"]);
  await screen.findByRole("region", { name: "Estimativa" });

  await user.selectOptions(screen.getByLabelText("Até quantos reels"), "3");

  await waitFor(() => {
    expect(calls.estimativas.at(-1)?.padroes.quantidadeDeReels).toBe(3);
  });
  // O aula.mp4 tem 125 s; a duração do live.mkv não se conhece.
  expect(calls.estimativas.at(-1)?.duracoes).toEqual([125, null]);
});

test("a estimativa calibrada diz de quantas execuções vem", async () => {
  const { fake, user } = await abrirPadroesComFake();
  fake.definirEstimativa({
    porVideo: { deUsd: 1.5, ateUsd: 2.4 },
    lote: { deUsd: 1.5, ateUsd: 2.4 },
    sessoes: 2,
    tempo: { deS: 4800, ateS: 5400 },
    inicial: false,
    execucoes: 4,
    semPreco: false,
  });

  await user.selectOptions(screen.getByLabelText("Até quantos reels"), "2");

  const estimativa = await screen.findByText(/Calculada com as suas 4 últimas/);
  expect(estimativa).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Estimativa" })).toHaveTextContent(
    "1 h 20 min a 1 h 30 min",
  );
  expect(screen.queryByText(/Estimativa inicial/)).toBeNull();
});

test("o kit de marca mostra as cores e as fontes do Padrão e a Amostra", async () => {
  await abrirPadroes();

  expect(await screen.findByLabelText("Fonte da legenda")).toHaveValue(
    "Montserrat",
  );
  expect(screen.getByLabelText("Cor de destaque")).toHaveValue("#ff2d2d");
  expect(screen.getByLabelText("Cor da palavra falada")).toHaveValue("#ffe600");
  expect(screen.getByLabelText("Fonte dos títulos").children).toHaveLength(8);
  expect(screen.getByTestId("amostra-do-kit")).toBeInTheDocument();
});

test("a Amostra acompanha as fontes escolhidas", async () => {
  const { user } = await abrirPadroes();

  await user.selectOptions(
    await screen.findByLabelText("Fonte dos títulos"),
    "Anton",
  );

  expect(screen.getByText("O erro que quebra empresas")).toHaveStyle({
    fontFamily: '"Anton", sans-serif',
  });
  expect(screen.getByText(/Ninguém te/)).toHaveStyle({
    fontFamily: '"Montserrat", sans-serif',
  });
});

test("o kit só vale depois de salvo com nome, e o lote o usa", async () => {
  const { user, calls } = await abrirPadroes();
  await user.selectOptions(
    await screen.findByLabelText("Fonte da legenda"),
    "Bebas Neue",
  );
  const salvar = screen.getByRole("button", { name: "Salvar como kit" });
  expect(salvar).toBeDisabled();

  await user.type(screen.getByLabelText("Nome do kit"), "Canal");
  await user.click(salvar);

  expect(calls.kitsSalvos).toEqual([
    {
      nome: "Canal",
      corDeDestaque: "#FF2D2D",
      corDaPalavra: "#FFE600",
      fonteDaLegenda: "Bebas Neue",
      fonteDosTitulos: "Montserrat",
    },
  ]);
  await waitFor(() => {
    expect(screen.getByLabelText("Kit")).toHaveValue("Canal");
  });
  await user.click(
    screen.getByRole("button", { name: "Gerar até 6 reels de 1 vídeo" }),
  );
  await screen.findByRole("heading", { name: "Gerando" });
  expect(calls.padroes[0]?.kit).toBe("Canal");
});

test("o kit Padrão não tem como apagar, e apagar outro volta ao Padrão", async () => {
  const { user, calls } = await abrirPadroes();
  await screen.findByLabelText("Fonte da legenda");
  expect(
    screen.queryByRole("button", { name: /Apagar o kit/ }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Nome do kit"), "Canal");
  await user.click(screen.getByRole("button", { name: "Salvar como kit" }));

  await user.click(
    await screen.findByRole("button", { name: "Apagar o kit Canal" }),
  );

  expect(calls.kitsApagados).toEqual(["Canal"]);
  await waitFor(() => {
    expect(screen.getByLabelText("Kit")).toHaveValue("Padrão");
  });
});
