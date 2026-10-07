import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { EstadoInicial } from "./bindings";
import { App } from "./App";
import { ACCEPTED_AT, createFakeNucleo } from "./test/fakeNucleo";

function renderApp(initial: Partial<EstadoInicial> = {}) {
  const fake = createFakeNucleo(initial);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, user: userEvent.setup() };
}

test("o Aviso bloqueia até marcar Li e concordo, e o aceite libera", async () => {
  const { user } = renderApp();

  await screen.findByRole("heading", { name: "Aviso de uso" });
  const continuar = screen.getByRole("button", { name: "Continuar" });
  expect(continuar).toBeDisabled();
  expect(screen.queryByRole("heading", { name: "Conta" })).toBeNull();

  await user.click(screen.getByRole("checkbox", { name: "Li e concordo" }));
  await user.click(continuar);

  await screen.findByRole("heading", { name: "Conta" });
  expect(screen.queryByRole("heading", { name: "Aviso de uso" })).toBeNull();
});

test("o Aviso se aceita só pelo teclado", async () => {
  const { user } = renderApp();

  // O foco começa no título; depois vêm "Li e concordo", "Sair" e "Continuar".
  expect(
    await screen.findByRole("heading", { name: "Aviso de uso" }),
  ).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("checkbox", { name: "Li e concordo" })).toHaveFocus();
  await user.keyboard(" ");
  await user.tab();
  await user.tab();
  expect(screen.getByRole("button", { name: "Continuar" })).toHaveFocus();
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("heading", { name: "Conta" })).toHaveFocus();
});

test("Sair, no Aviso, fecha o app", async () => {
  const { user, calls } = renderApp();

  await user.click(await screen.findByRole("button", { name: "Sair" }));

  expect(calls.sair).toBe(1);
});

test("com o aceite gravado, o app abre direto no passo Conta", async () => {
  renderApp({ aceite: { data: ACCEPTED_AT } });

  await screen.findByRole("heading", { name: "Conta" });
  expect(screen.queryByRole("heading", { name: "Aviso de uso" })).toBeNull();
});

test("o Aviso diz o que sai do computador", async () => {
  renderApp();

  await screen.findByRole("heading", { name: "O que sai do seu computador" });
  screen.getByText(
    "O vídeo e o áudio ficam no seu computador; vão para o Claude o texto da transcrição, o roteiro e imagens de alguns quadros dos reels, usadas na revisão.",
  );
  screen.getByText("Processe só vídeos que você tem direito de usar.");
});

test("os textos aparecem em inglês quando o idioma da interface é en", async () => {
  const { user } = renderApp({ idiomaDaInterface: "en" });

  await screen.findByRole("heading", { name: "Terms of use" });
  screen.getByText(
    "The video and audio stay on your computer; Claude receives the transcript text, the script and images of a few frames of the reels, used in the review.",
  );
  screen.getByRole("button", { name: "Quit" });
  await user.click(
    screen.getByRole("checkbox", { name: "I have read and agree" }),
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Account" });
  expect(document.documentElement.lang).toBe("en");
});

test("Sobre mostra a versão, o aviso e as licenças, e a data depois do aceite", async () => {
  const { user } = renderApp({ versao: "1.2.3" });

  await user.click(await screen.findByRole("button", { name: "Sobre" }));
  await screen.findByRole("heading", { name: "Sobre o Shorts AI" });
  screen.getByText("Versão 1.2.3");
  screen.getByText("Você ainda não aceitou o Aviso de uso.");
  screen.getByText("Processe só vídeos que você tem direito de usar.");
  screen.getByText(/^Remotion:/);
  screen.getByText(/SIL Open Font License/);

  await user.click(screen.getByRole("button", { name: "Voltar" }));
  await user.click(screen.getByRole("checkbox", { name: "Li e concordo" }));
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(await screen.findByRole("button", { name: "Sobre" }));

  screen.getByText(
    "Você aceitou o Aviso de uso em 7 de outubro de 2026 às 18:30.",
  );
});

test("um aceite que não grava mostra o erro e fica no Aviso", async () => {
  const { user, failAcceptance } = renderApp();
  failAcceptance({
    codigo: "preferenciasNaoGravadas",
    caminho: "/dados/preferencias.json",
    detalhe: "Permission denied (os error 13)",
  });

  await user.click(
    await screen.findByRole("checkbox", { name: "Li e concordo" }),
  );
  await user.click(screen.getByRole("button", { name: "Continuar" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Não foi possível gravar as preferências em /dados/preferencias.json.",
  );
  expect(alert).toHaveTextContent("Permission denied (os error 13)");
  screen.getByRole("heading", { name: "Aviso de uso" });
});

test("com as preferências ilegíveis, o app mostra o erro e não passa dele", async () => {
  renderApp({
    erro: {
      codigo: "preferenciasIlegiveis",
      caminho: "/dados/preferencias.json",
      detalhe: "expected value at line 1 column 3",
    },
  });

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Não foi possível ler as preferências em /dados/preferencias.json.",
  );
  expect(screen.queryByRole("heading", { name: "Aviso de uso" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Conta" })).toBeNull();
});
