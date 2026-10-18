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

test("Li e concordo continua marcado depois de ver o Sobre", async () => {
  const { user } = renderApp();

  await user.click(
    await screen.findByRole("checkbox", { name: "Li e concordo" }),
  );
  await user.click(screen.getByRole("button", { name: "Sobre" }));
  await user.click(await screen.findByRole("button", { name: "Voltar" }));

  expect(
    await screen.findByRole("checkbox", { name: "Li e concordo" }),
  ).toBeChecked();
  expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
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
    "O vídeo e o áudio ficam no seu computador; vão para o Claude o texto da transcrição, o roteiro e imagens de alguns quadros dos reels, usadas na revisão. Ao abrir, o app consulta as Releases do Shorts AI no GitHub para baixar versões novas e a tabela de preços; nada sobre você ou sobre os vídeos vai junto.",
  );
  screen.getByText(
    "As sessões do Claude usam a cota do seu plano, junto com o resto do seu uso; com uma conta do Console, são cobradas pelos preços da API da Anthropic.",
  );
  screen.getByText("Processe só vídeos que você tem direito de usar.");
  screen.getByText(
    "Os reels são renderizados com o Remotion, gratuito para pessoas físicas, organizações sem fins lucrativos e empresas de até 3 funcionários. Empresas maiores precisam de uma licença própria do Remotion.",
  );
});

test("os textos aparecem em inglês quando o idioma da interface é en", async () => {
  const { user } = renderApp({ idiomaDaInterface: "en" });

  await screen.findByRole("heading", { name: "Terms of use" });
  screen.getByText(
    "The video and audio stay on your computer; Claude receives the transcript text, the script and images of a few frames of the reels, used in the review. When it opens, the app checks the Shorts AI Releases on GitHub to download new versions and the price table; nothing about you or your videos is sent.",
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
  screen.getByText(/^Remotion:.*organizações sem fins lucrativos/);
  screen.getByText(/^Fontes Montserrat, Anton.*SIL Open Font License 1.1/);
  screen.getByText(/^yt-dlp: The Unlicense/);
  screen.getByText(/^whisper.cpp: licença MIT/);
  screen.getByText(/^YuNet.*licença MIT/);

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
  expect(alert).toHaveTextContent(
    "Detalhe técnico (do sistema): Permission denied (os error 13)",
  );
  screen.getByRole("heading", { name: "Aviso de uso" });
});

test("com as preferências ilegíveis, o app mostra o erro e não passa dele", async () => {
  renderApp({
    erro: {
      codigo: "preferenciasIlegiveis",
      caminho: "/dados/preferencias.json",
      detalhe: "Is a directory (os error 21)",
    },
  });

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Não foi possível ler as preferências em /dados/preferencias.json.",
  );
  expect(screen.queryByRole("heading", { name: "Aviso de uso" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Conta" })).toBeNull();
});

test("com as preferências corrompidas, o app diz onde ficou o backup e o Aviso segue", async () => {
  const { user } = renderApp({
    backupDasPreferencias:
      "/dados/preferencias.corrompido-2026-10-08T14-30-05.json",
  });

  await screen.findByRole("heading", { name: "Aviso de uso" });
  expect(screen.getByRole("status")).toHaveTextContent(
    "O arquivo de preferências estava corrompido e foi guardado em /dados/preferencias.corrompido-2026-10-08T14-30-05.json. As preferências voltaram ao padrão, por isso o Aviso de uso aparece de novo.",
  );
  await user.click(screen.getByRole("checkbox", { name: "Li e concordo" }));
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Conta" });
});

test("Sobre traz a GPL do ffmpeg com a página do código-fonte desta versão, que abre no navegador", async () => {
  const { user, calls } = renderApp({
    versao: "1.2.3",
    codigoFonte: "https://github.com/pedro-oscar/shorts-ai/releases/tag/v1.2.3",
  });

  await user.click(await screen.findByRole("button", { name: "Sobre" }));
  const ffmpeg = screen.getByText(/^ffmpeg: GNU GPL versão 3/).closest("li");
  expect(ffmpeg).toHaveTextContent(
    "https://github.com/pedro-oscar/shorts-ai/releases/tag/v1.2.3",
  );
  await user.click(screen.getByRole("button", { name: "Abrir no navegador" }));

  expect(calls.codigoFonte).toBe(1);
});
