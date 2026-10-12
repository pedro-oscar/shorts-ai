import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "./App";
import { ACCEPTED_AT, createFakeNucleo } from "./test/fakeNucleo";

async function abrirPadroes(videos = ["/v/aula.mp4"]) {
  const fake = createFakeNucleo({
    aceite: { data: ACCEPTED_AT },
    plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
  });
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continuar" }));
  fake.pick(videos);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Padrões" });
  return { ...fake, user };
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
