import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { EstadoDaConta } from "./bindings";
import { App } from "./App";
import { ACCEPTED_AT, LOGADO, createFakeNucleo } from "./test/fakeNucleo";

function renderConta(conta: EstadoDaConta) {
  const fake = createFakeNucleo({ aceite: { data: ACCEPTED_AT } }, conta);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, user: userEvent.setup() };
}

test("sem Claude Code, a Conta trava", async () => {
  renderConta({ tipo: "naoInstalado" });

  await screen.findByText(/O Claude Code não está instalado/);
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Entrar no Claude Code" }),
  ).toBeNull();
});

test("com versão antiga, a Conta trava e explica", async () => {
  renderConta({ tipo: "versaoAntiga", versao: "2.1.100", minima: "2.1.292" });

  await screen.findByText(
    "O Claude Code 2.1.100 é antigo demais: o Shorts AI precisa da versão 2.1.292 ou mais nova. Atualize o Claude Code para continuar.",
  );
  screen.getByText("Claude Code 2.1.100");
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
});

test("sem login, entrar leva ao teste e o Continuar segue para Vídeos", async () => {
  const { user, calls } = renderConta({ tipo: "semLogin", versao: "2.1.300" });

  await screen.findByText("Claude Code 2.1.300");
  screen.getByText(/login é separado do Claude Code do terminal/);
  const continuar = screen.getByRole("button", { name: "Continuar" });
  expect(continuar).toBeDisabled();

  await user.click(
    screen.getByRole("button", { name: "Entrar no Claude Code" }),
  );

  await screen.findByText("O Claude respondeu ao teste.");
  expect(calls.entrar).toBe(1);
  expect(calls.testar).toBe(1);
  expect(continuar).toBeEnabled();
  await user.click(continuar);
  await screen.findByRole("heading", { name: "Vídeos" });
});

test("logado, o chip no topo mostra a conta e o plano", async () => {
  const { user } = renderConta(LOGADO);

  await screen.findByText("ana@example.com · Max");
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Vídeos" });
});

test("conta do Console aparece no chip como Console", async () => {
  renderConta({
    tipo: "logado",
    versao: "2.1.300",
    metodo: "console",
    plano: null,
    email: "ana@example.com",
    cobranca: "porUso",
  });

  await screen.findByText("ana@example.com · Console");
});

test("o teste que falha mostra o erro e trava até passar", async () => {
  const { user, failTest } = renderConta({
    tipo: "semLogin",
    versao: "2.1.300",
  });
  failTest({
    codigo: "claudeNaoRespondeu",
    detalhe: "credit balance is too low",
  });

  await user.click(
    await screen.findByRole("button", { name: "Entrar no Claude Code" }),
  );

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("O Claude não respondeu ao teste.");
  expect(alert).toHaveTextContent("credit balance is too low");
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  screen.getByRole("button", { name: "Testar de novo" });
});

test("um login que não conclui mostra o erro e deixa tentar de novo", async () => {
  const { user, failLogin } = renderConta({
    tipo: "semLogin",
    versao: "2.1.300",
  });
  failLogin({
    codigo: "loginNaoConcluido",
    detalhe: "o login terminou com exit status: 1",
  });

  await user.click(
    await screen.findByRole("button", { name: "Entrar no Claude Code" }),
  );

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("O login no Claude Code não foi concluído.");
  expect(
    screen.getByRole("button", { name: "Entrar no Claude Code" }),
  ).toBeEnabled();
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
});
