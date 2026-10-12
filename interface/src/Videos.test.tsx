import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "./App";
import { ACCEPTED_AT, createFakeNucleo } from "./test/fakeNucleo";

async function renderVideos() {
  const fake = createFakeNucleo({
    aceite: { data: ACCEPTED_AT },
    plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
  });
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Vídeos" });
  return { ...fake, user };
}

test("escolher arquivos monta a lista com nome e duração, e Remover tira da lista", async () => {
  const { user, pick } = await renderVideos();
  pick(["/v/aula.mp4", "/v/live.mkv"]);

  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));

  const lista = await screen.findByRole("list", { name: "Vídeos escolhidos" });
  const itens = within(lista).getAllByRole("listitem");
  expect(itens[0]).toHaveTextContent("aula.mp4");
  expect(itens[0]).toHaveTextContent("2:05");
  expect(itens[1]).toHaveTextContent("live.mkv");
  expect(itens[1]).toHaveTextContent("—");

  await user.click(screen.getByRole("button", { name: "Remover aula.mp4" }));
  expect(within(lista).getAllByRole("listitem")).toHaveLength(1);
});

test("soltar arquivos na janela os põe na lista, sem repetir", async () => {
  const { drop } = await renderVideos();

  drop(["/v/aula.mp4"]);
  drop(["/v/aula.mp4"]);

  const lista = await screen.findByRole("list", { name: "Vídeos escolhidos" });
  expect(within(lista).getAllByRole("listitem")).toHaveLength(1);
});

test("Continuar fica desligado sem vídeos e a tela mostra a Biblioteca", async () => {
  await renderVideos();

  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  screen.getByText(/Biblioteca: \/home\/ana\/Vídeos\/Shorts AI/);
});

test("Gerar cria o lote e Gerando mostra o projeto etapa a etapa", async () => {
  const { user, pick, calls, etapa } = await renderVideos();
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });

  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(await screen.findByRole("button", { name: /^Gerar até/ }));

  await screen.findByRole("heading", { name: "Gerando" });
  expect(calls.lotes).toEqual([["/v/aula.mp4"]]);
  const projeto = screen.getByRole("listitem", { name: "aula" });
  expect(projeto).toHaveTextContent("Na fila");

  etapa("aula (2026-10-09)", "importacao", "emAndamento");
  await within(projeto).findByText("Em andamento · etapa 1/5");

  etapa("aula (2026-10-09)", "importacao", "concluida");
  await within(projeto).findByText("Importação: concluída");
  expect(projeto).toHaveTextContent("Transcrição: pendente");
  expect(projeto).toHaveTextContent("etapa 2/5");
});

async function gerarAula() {
  const fake = await renderVideos();
  fake.pick(["/v/aula.mp4"]);
  await fake.user.click(
    screen.getByRole("button", { name: "Escolher arquivos" }),
  );
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await fake.user.click(screen.getByRole("button", { name: "Continuar" }));
  await fake.user.click(
    await screen.findByRole("button", { name: /^Gerar até/ }),
  );
  await screen.findByRole("heading", { name: "Gerando" });
  return { ...fake, projeto: screen.getByRole("listitem", { name: "aula" }) };
}

const AULA = "aula (2026-10-09)";

test("a Transcrição mostra a porcentagem, e a barra anda junto", async () => {
  const { etapa, emitir, projeto } = await gerarAula();
  etapa(AULA, "importacao", "concluida");
  etapa(AULA, "transcricao", "emAndamento");

  emitir({
    tipo: "progressoDaEtapa",
    projeto: AULA,
    etapa: "transcricao",
    percentual: 42,
  });

  await within(projeto).findByText("Em andamento · etapa 2/5 · 42%");
  expect(
    within(projeto).getByRole("progressbar", { name: "Progresso de aula" }),
  ).toHaveAttribute("value", "1.42");

  etapa(AULA, "transcricao", "concluida");
  await within(projeto).findByText("Em andamento · etapa 3/5");
});

test("o Roteiro mostra ao vivo as últimas ações do Claude e os tokens", async () => {
  const { etapa, emitir, projeto } = await gerarAula();
  etapa(AULA, "importacao", "concluida");
  etapa(AULA, "transcricao", "concluida");
  etapa(AULA, "roteiro", "emAndamento");
  const acao = (ferramenta: string, alvo: string | null) => {
    emitir({
      tipo: "acaoDoClaude",
      projeto: AULA,
      etapa: "roteiro",
      ferramenta,
      alvo,
    });
  };

  acao("Read", "/dados/skill/corte-viral/SKILL.md");
  acao("texto", "Lendo a transcrição.");
  acao("Grep", "^## ");
  acao("Bash", "shorts-cli validar edit/roteiro.json");
  acao("TodoWrite", null);
  acao("Write", "/projeto/edit/roteiro.json");
  emitir({
    tipo: "tokensDoClaude",
    projeto: AULA,
    etapa: "roteiro",
    entrada: 12345,
    cache: 1234567,
  });

  const acoes = await within(projeto).findByRole("list", {
    name: "Ações do Claude",
  });
  expect(
    within(acoes)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "“Lendo a transcrição.”",
    "→ Grep ^## ",
    "→ Bash shorts-cli validar edit/roteiro.json",
    "→ TodoWrite",
    "→ Write /projeto/edit/roteiro.json",
  ]);
  within(projeto).getByText(
    "Tokens da sessão: 12.345 de entrada e 1.234.567 de cache",
  );

  // A falha deixa as ações à vista; a etapa seguinte começa do zero.
  etapa(AULA, "roteiro", "falhou", "roteiro inválido");
  await within(projeto).findByText("Falhou");
  within(projeto).getByRole("list", { name: "Ações do Claude" });
  etapa(AULA, "roteiro", "emAndamento");
  await within(projeto).findByText("Em andamento · etapa 3/5");
  expect(
    within(projeto).queryByRole("list", { name: "Ações do Claude" }),
  ).toBeNull();
  expect(within(projeto).queryByText(/Tokens da sessão/)).toBeNull();
});

test("a falha da Importação mostra o motivo", async () => {
  const { user, pick, etapa } = await renderVideos();
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(await screen.findByRole("button", { name: /^Gerar até/ }));
  await screen.findByRole("heading", { name: "Gerando" });

  etapa("aula (2026-10-09)", "importacao", "falhou", "No such file");

  await screen.findByText("Falhou");
  expect(screen.getByRole("alert")).toHaveTextContent("No such file");
});

test("um lote recusado pelo núcleo mostra o erro e fica em Padrões", async () => {
  const { user, pick, failBatch } = await renderVideos();
  failBatch({ codigo: "arquivoInvalido", caminho: "/v/aula.mp4" });
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });

  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(await screen.findByRole("button", { name: /^Gerar até/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "/v/aula.mp4 não é um vídeo aceito",
  );
  screen.getByRole("heading", { name: "Padrões" });
});
