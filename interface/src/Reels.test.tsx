import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { DadosDoProjeto } from "./bindings";
import { App } from "./App";
import { ACCEPTED_AT, createFakeNucleo } from "./test/fakeNucleo";

const AULA = "aula (2026-10-09)";

const COM_PLANO = {
  aceite: { data: ACCEPTED_AT },
  plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
} as const;

const DADOS: DadosDoProjeto = {
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

async function abrirReels() {
  const fake = createFakeNucleo(COM_PLANO);
  fake.definirDados(AULA, DADOS);
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continuar" }));
  fake.pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Gerar" }));
  await screen.findByRole("heading", { name: "Gerando" });
  expect(screen.queryByRole("button", { name: "Ver reels" })).toBeNull();
  fake.etapa(AULA, "producao", "concluida");
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

test("se o núcleo não lê o projeto, a tela mostra o erro", async () => {
  const fake = createFakeNucleo(COM_PLANO);
  fake.falharLeitura({ codigo: "projetoNaoLido", id: AULA, detalhe: "sumiu" });
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continuar" }));
  fake.pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Gerar" }));
  fake.etapa(AULA, "producao", "concluida");
  await user.click(await screen.findByRole("button", { name: "Ver reels" }));

  const alerta = await screen.findByRole("alert");
  expect(alerta).toHaveTextContent("Não foi possível ler o projeto");
});
