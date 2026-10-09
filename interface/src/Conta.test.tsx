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

test("sem Claude Code, a Conta trava e oferece instalar", async () => {
  const { user, calls } = renderConta({ tipo: "naoInstalado" });

  await screen.findByText(/O Claude Code não está instalado/);
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Entrar no Claude Code" }),
  ).toBeNull();

  await user.click(
    screen.getByRole("button", { name: "Instalar Claude Code" }),
  );

  await screen.findByText("Claude Code 2.1.300");
  expect(calls.instalar).toBe(1);
  expect(screen.getByLabelText("Saída do comando")).toHaveTextContent(
    "instalando o Claude Code",
  );
  screen.getByRole("button", { name: "Entrar no Claude Code" });
});

test("a instalação que falha mostra o erro e deixa tentar de novo", async () => {
  const { user, failCommand } = renderConta({ tipo: "naoInstalado" });
  failCommand({ codigo: "instalacaoFalhou", detalhe: "curl: (22) 404" });

  await user.click(
    await screen.findByRole("button", { name: "Instalar Claude Code" }),
  );

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "A instalação do Claude Code não foi concluída",
  );
  expect(alert).toHaveTextContent("curl: (22) 404");
  expect(
    screen.getByRole("button", { name: "Instalar Claude Code" }),
  ).toBeEnabled();
});

test("com versão antiga, a Conta trava e explica", async () => {
  renderConta({ tipo: "versaoAntiga", versao: "2.1.100", minima: "2.1.292" });

  await screen.findByText(
    "O Claude Code 2.1.100 é antigo demais: o Shorts AI precisa da versão 2.1.292 ou mais nova. Atualize o Claude Code para continuar.",
  );
  screen.getByText("Claude Code 2.1.100");
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
});

test("com versão antiga, Atualizar roda o claude update e detecta de novo", async () => {
  const { user, calls } = renderConta({
    tipo: "versaoAntiga",
    versao: "2.1.100",
    minima: "2.1.292",
  });

  await user.click(
    await screen.findByRole("button", { name: "Atualizar Claude Code" }),
  );

  await screen.findByText("Claude Code 2.1.400");
  expect(calls.atualizar).toBe(1);
  expect(screen.getByLabelText("Saída do comando")).toHaveTextContent(
    "atualizando o Claude Code",
  );
});

test("a segunda opção do Entrar usa a conta do Console", async () => {
  const { user, calls } = renderConta({ tipo: "semLogin", versao: "2.1.300" });

  await user.click(
    await screen.findByRole("button", {
      name: "Usar conta do Console (cobrança por uso)",
    }),
  );

  await screen.findByText("O Claude respondeu ao teste.");
  expect(calls.logins).toEqual([{ modo: "console", porTerminal: false }]);
});

test("quando o navegador pede um código, o login abre no terminal do sistema", async () => {
  const { user, calls } = renderConta({ tipo: "semLogin", versao: "2.1.300" });

  await user.click(
    await screen.findByRole("checkbox", { name: /abrir o login no terminal/ }),
  );
  screen.getByText(/cole o código ali/);
  expect(screen.queryByRole("textbox")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Entrar no Claude Code" }),
  );

  await screen.findByText("O Claude respondeu ao teste.");
  expect(calls.logins).toEqual([{ modo: "assinatura", porTerminal: true }]);
});

test("a chave de API no ambiente aparece na Conta", async () => {
  const fake = createFakeNucleo(
    { aceite: { data: ACCEPTED_AT }, chaveDeApiNoAmbiente: true },
    { tipo: "semLogin", versao: "2.1.300" },
  );
  render(<App nucleo={fake.nucleo} />);

  await screen.findByText("Chave de API no ambiente");
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
  expect(continuar).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: "Max 5x" }));
  await user.click(screen.getByRole("button", { name: "Confirmar plano" }));
  await screen.findByText("Plano confirmado: Max 5x, cobrança mensal.");
  expect(continuar).toBeEnabled();
  await user.click(continuar);
  await screen.findByRole("heading", { name: "Vídeos" });
});

test("logado, o chip no topo mostra a conta e o plano", async () => {
  renderConta(LOGADO);

  await screen.findByText("ana@example.com · Max");
});

test("o Max pede o nível e a cobrança, e só segue depois de confirmar", async () => {
  const { user } = renderConta(LOGADO);
  const continuar = await screen.findByRole("button", { name: "Continuar" });
  expect(continuar).toBeDisabled();
  expect(screen.getAllByRole("radio", { name: /Max/ })).toHaveLength(2);

  await user.click(screen.getByRole("radio", { name: "Max 20x" }));
  await user.click(screen.getByRole("radio", { name: "Anual" }));
  await user.click(screen.getByRole("button", { name: "Confirmar plano" }));

  await screen.findByText("Plano confirmado: Max 20x, cobrança anual.");
  expect(continuar).toBeEnabled();
  await user.click(continuar);
  await screen.findByRole("heading", { name: "Vídeos" });
});

test("os níveis do Team e do Pro seguem o tipo da assinatura", async () => {
  renderConta({ ...LOGADO, plano: "team" });

  await screen.findByRole("radio", { name: "Team padrão" });
  screen.getByRole("radio", { name: "Team premium" });
  expect(screen.queryByRole("radio", { name: "Pro" })).toBeNull();
});

test("Enterprise e Console são preço de API, sem escolher a cobrança", async () => {
  const { user } = renderConta({ ...LOGADO, plano: "enterprise" });

  await user.click(await screen.findByRole("radio", { name: /Enterprise/ }));
  expect(screen.queryByRole("radio", { name: "Mensal" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Confirmar plano" }));

  await screen.findByText("Plano confirmado: Enterprise (preço de API).");
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
  screen.getByText("Console (preço de API)", { exact: false });
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
