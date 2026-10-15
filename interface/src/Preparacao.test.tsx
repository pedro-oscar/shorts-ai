import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "./App";
import { ACCEPTED_AT, createFakeNucleo } from "./test/fakeNucleo";

async function renderPreparacao(
  falta: Parameters<ReturnType<typeof createFakeNucleo>["faltam"]>,
) {
  const fake = createFakeNucleo({
    aceite: { data: ACCEPTED_AT },
    plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
  });
  fake.faltam(...falta);
  render(<App nucleo={fake.nucleo} />);
  await screen.findByRole("heading", { name: "Preparação" });
  return { ...fake, user: userEvent.setup() };
}

test("a tela lista cada pacote com o tamanho e o que já está instalado", async () => {
  await renderPreparacao([["dependenciasDoRemotion", "modeloDeTranscricao"]]);

  const itens = screen.getAllByRole("listitem");
  expect(itens[0]).toHaveTextContent("Node portátil");
  expect(itens[0]).toHaveTextContent("Já instalado");
  expect(itens[1]).toHaveTextContent("Dependências do render");
  expect(itens[1]).toHaveTextContent("A baixar");
  expect(itens[1]).toHaveTextContent("cerca de 700 MB");
  expect(itens[2]).toHaveTextContent("cerca de 1,1 GB");
  screen.getByText(/Vai ocupar cerca de 1,8 GB. Espaço livre: 500 GB./);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("avisa quando há menos de 20 GB livres", async () => {
  await renderPreparacao([["modeloDeTranscricao"], 15_000]);

  expect((await screen.findByRole("alert")).textContent).toContain("20 GB");
});

test("baixar mostra o andamento de cada pacote e segue adiante quando nada falta", async () => {
  const { user, calls } = await renderPreparacao([
    ["nodePortatil", "modeloDeTranscricao"],
  ]);

  await user.click(screen.getByRole("button", { name: "Baixar o que falta" }));

  expect(calls.preparar).toBe(1);
  // Com a conta pronta e sem lote, o app segue direto para os Vídeos.
  await screen.findByRole("heading", { name: "Vídeos" });
});

test("a falha de um pacote aparece e os outros ficam prontos; tentar de novo baixa só o que falta", async () => {
  const { user, calls, falharPacote, consertarPacote } = await renderPreparacao(
    [["nodePortatil", "modeloDeTranscricao"]],
  );
  falharPacote("modeloDeTranscricao", "sem rede");

  await user.click(screen.getByRole("button", { name: "Baixar o que falta" }));

  const itens = await screen.findAllByRole("listitem");
  expect(itens[0]).toHaveTextContent("Pronto");
  expect(itens[2]).toHaveTextContent("Falhou: sem rede");

  consertarPacote("modeloDeTranscricao");
  await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
  await screen.findByRole("heading", { name: "Vídeos" });
  expect(calls.preparar).toBe(2);
});
