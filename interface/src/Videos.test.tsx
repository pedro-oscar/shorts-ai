import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "./App";
import { ACCEPTED_AT, createFakeNucleo } from "./test/fakeNucleo";

/** Sem lote nenhum, o app abre na folha de Vídeos. */
async function renderVideos() {
  const fake = createFakeNucleo({
    aceite: { data: ACCEPTED_AT },
    plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
  });
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
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

test("Gerar fica desligado sem vídeos e a folha mostra a Biblioteca", async () => {
  await renderVideos();

  expect(screen.getByRole("button", { name: "Gerar" })).toBeDisabled();
  screen.getByText(/Biblioteca: \/home\/ana\/Vídeos\/Shorts AI/);
});

test("Gerar cria o lote e a Linha de produção mostra o projeto etapa a etapa", async () => {
  const { user, pick, calls, etapa } = await renderVideos();
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });

  await user.click(await screen.findByRole("button", { name: /^Gerar até/ }));

  await screen.findByRole("heading", { name: "Linha de produção" });
  expect(calls.lotes).toEqual([["/v/aula.mp4"]]);
  expect(cartao()).toHaveTextContent("Na fila");

  etapa("aula (2026-10-09)", "importacao", "emAndamento");
  await screen.findByText("Em andamento · etapa 1/5");

  etapa("aula (2026-10-09)", "importacao", "concluida");
  await screen.findByText("Importação: concluída");
  expect(cartao()).toHaveTextContent("Transcrição: pendente");
  expect(cartao()).toHaveTextContent("etapa 2/5");
});

async function gerarAula() {
  const fake = await renderVideos();
  fake.pick(["/v/aula.mp4"]);
  await fake.user.click(
    screen.getByRole("button", { name: "Escolher arquivos" }),
  );
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await fake.user.click(
    await screen.findByRole("button", { name: /^Gerar até/ }),
  );
  await screen.findByRole("heading", { name: "Linha de produção" });
  return fake;
}

const AULA = "aula (2026-10-09)";

/** O cartão do projeto: muda de coluna a cada etapa, então é outro elemento a cada vez. */
function cartao() {
  return screen.getByRole("listitem", { name: "aula" });
}

test("a Transcrição mostra a porcentagem, e a barra anda junto", async () => {
  const { etapa, emitir } = await gerarAula();
  etapa(AULA, "importacao", "concluida");
  etapa(AULA, "transcricao", "emAndamento");

  emitir({
    tipo: "progressoDaEtapa",
    projeto: AULA,
    etapa: "transcricao",
    percentual: 42,
  });

  await screen.findByText("Em andamento · etapa 2/5 · 42%");
  expect(
    within(cartao()).getByRole("progressbar", { name: "Progresso de aula" }),
  ).toHaveAttribute("value", "1.42");

  etapa(AULA, "transcricao", "concluida");
  await screen.findByText("Em andamento · etapa 3/5");
});

test("o Roteiro mostra ao vivo as últimas ações do Claude e os tokens", async () => {
  const { etapa, emitir } = await gerarAula();
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

  const acoes = await screen.findByRole("list", { name: "Ações do Claude" });
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
  within(cartao()).getByText(
    "Tokens da sessão: 12.345 de entrada e 1.234.567 de cache",
  );

  // A falha deixa as ações à vista; a etapa seguinte começa do zero.
  etapa(AULA, "roteiro", "falhou", "roteiro inválido");
  await screen.findByText("Falhou");
  within(cartao()).getByRole("list", { name: "Ações do Claude" });
  etapa(AULA, "roteiro", "emAndamento");
  await screen.findByText("Em andamento · etapa 3/5");
  expect(
    within(cartao()).queryByRole("list", { name: "Ações do Claude" }),
  ).toBeNull();
  expect(within(cartao()).queryByText(/Tokens da sessão/)).toBeNull();
});

test("a falha da Importação mostra o motivo", async () => {
  const { etapa } = await gerarAula();

  etapa(AULA, "importacao", "falhou", "No such file");

  await screen.findByText("Falhou");
  expect(screen.getByRole("alert")).toHaveTextContent("No such file");
});

test("um lote recusado pelo núcleo mostra o erro e fica em Vídeos", async () => {
  const { user, pick, failBatch } = await renderVideos();
  failBatch({ codigo: "arquivoInvalido", caminho: "/v/aula.mp4" });
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });

  await user.click(await screen.findByRole("button", { name: /^Gerar até/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "/v/aula.mp4 não é um vídeo aceito",
  );
  screen.getByRole("heading", { name: "Vídeos" });
});

async function colarLinks(
  fake: Awaited<ReturnType<typeof renderVideos>>,
  linhas: string[],
) {
  await fake.user.type(
    screen.getByRole("textbox", { name: /Links do YouTube/ }),
    linhas.join("\n"),
  );
  await fake.user.click(
    screen.getByRole("button", { name: "Adicionar links" }),
  );
  return screen.findByRole("list", { name: "Links escolhidos" });
}

test("colar um link mostra título, canal e duração antes de baixar", async () => {
  const fake = await renderVideos();

  const lista = await colarLinks(fake, ["https://youtu.be/KGfmaHnBQx4"]);

  const item = await within(lista).findByRole("listitem");
  await within(item).findByText(/Vídeo KGfmaHnBQx4/);
  expect(item).toHaveTextContent("Canal da Ana");
  expect(item).toHaveTextContent("1:02:05");
  expect(fake.calls.consultas).toEqual(["https://youtu.be/KGfmaHnBQx4"]);
});

test("um endereço que não é do YouTube recebe uma mensagem clara e trava o Gerar", async () => {
  const fake = await renderVideos();

  await colarLinks(fake, ["https://vimeo.com/123"]);

  const alerta = await screen.findByRole("alert");
  expect(alerta).toHaveTextContent(
    "https://vimeo.com/123 não é um link de vídeo do YouTube",
  );
  expect(screen.getByRole("button", { name: /^Gerar/ })).toBeDisabled();

  await fake.user.click(
    screen.getByRole("button", { name: "Remover https://vimeo.com/123" }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

test("Gerar espera o direito de uso de cada link e envia a confirmação", async () => {
  const fake = await renderVideos();
  await colarLinks(fake, ["https://youtu.be/KGfmaHnBQx4"]);
  await screen.findByText(/Vídeo KGfmaHnBQx4/);
  const gerar = screen.getByRole("button", { name: /^Gerar até/ });
  expect(gerar).toBeDisabled();

  await fake.user.click(
    screen.getByRole("checkbox", {
      name: "Tenho direito de uso de Vídeo KGfmaHnBQx4",
    }),
  );
  expect(gerar).toBeEnabled();
  await fake.user.click(gerar);

  await screen.findByRole("heading", { name: "Linha de produção" });
  expect(fake.calls.links).toEqual([
    [
      {
        url: "https://www.youtube.com/watch?v=KGfmaHnBQx4",
        titulo: "Vídeo KGfmaHnBQx4",
        canal: "Canal da Ana",
        direitoDeUso: true,
        faixa: null,
        excecoes: {
          quantidadeDeReels: null,
          pedido: null,
          faixa: null,
          nomesProprios: null,
          idiomaDoVideo: null,
          kit: null,
          semLogo: false,
        },
      },
    ],
  ]);
  screen.getByRole("listitem", { name: "Vídeo KGfmaHnBQx4" });
});

test("com vários links, 'Confirmo para todos' marca o direito de uso de cada um", async () => {
  const fake = await renderVideos();
  await colarLinks(fake, [
    "https://youtu.be/KGfmaHnBQx4",
    "https://www.youtube.com/shorts/abcdefghijk",
  ]);
  await screen.findByText(/Vídeo abcdefghijk/);

  await fake.user.click(
    screen.getByRole("checkbox", { name: "Confirmo para todos" }),
  );

  for (const checkbox of screen.getAllByRole("checkbox", {
    name: /^Tenho direito de uso de/,
  }))
    expect(checkbox).toBeChecked();
  expect(screen.getByRole("button", { name: /^Gerar até/ })).toBeEnabled();
});

/** Abre os Ajustes do vídeo, preenche a Faixa e fecha. */
async function ajustarFaixa(
  user: ReturnType<typeof userEvent.setup>,
  nome: string,
  inicio: string,
  fim?: string,
) {
  await user.click(screen.getByRole("button", { name: `Ajustar ${nome}` }));
  await user.type(screen.getByLabelText(`Início de ${nome} (m:ss)`), inicio);
  if (fim !== undefined)
    await user.type(screen.getByLabelText(`Fim de ${nome} (m:ss)`), fim);
  await user.click(screen.getByRole("button", { name: "Pronto" }));
}

test("Início e Fim de um arquivo vão ao núcleo como faixa em segundos", async () => {
  const { user, pick, calls } = await renderVideos();
  pick(["/v/aula.mp4", "/v/live.mkv"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });

  await ajustarFaixa(user, "aula.mp4", "10:00", "1:02:03");
  await ajustarFaixa(user, "live.mkv", "90");
  await user.click(await screen.findByRole("button", { name: /^Gerar até/ }));

  await screen.findByRole("heading", { name: "Linha de produção" });
  expect(calls.faixasDosArquivos).toEqual([
    [
      { inicio: 600, fim: 3723 },
      { inicio: 90, fim: null },
    ],
  ]);
});

test("a faixa de um link vai junto com ele", async () => {
  const fake = await renderVideos();
  await colarLinks(fake, ["https://youtu.be/KGfmaHnBQx4"]);
  await screen.findByText(/Vídeo KGfmaHnBQx4/);

  await ajustarFaixa(fake.user, "Vídeo KGfmaHnBQx4", "5:00", "20:00");
  await fake.user.click(
    screen.getByRole("checkbox", {
      name: "Tenho direito de uso de Vídeo KGfmaHnBQx4",
    }),
  );
  await fake.user.click(
    await screen.findByRole("button", { name: /^Gerar até/ }),
  );

  await screen.findByRole("heading", { name: "Linha de produção" });
  expect(fake.calls.links[0]?.[0]?.faixa).toEqual({ inicio: 300, fim: 1200 });
});

test("uma faixa com o fim antes do início avisa e trava o Gerar", async () => {
  const { user, pick } = await renderVideos();
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });

  await user.click(screen.getByRole("button", { name: "Ajustar aula.mp4" }));
  await user.type(screen.getByLabelText("Início de aula.mp4 (m:ss)"), "5:00");
  await user.type(screen.getByLabelText("Fim de aula.mp4 (m:ss)"), "1:00");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A faixa de aula.mp4 não vale",
  );
  expect(screen.getByRole("button", { name: /^Gerar até/ })).toBeDisabled();

  await user.clear(screen.getByLabelText("Fim de aula.mp4 (m:ss)"));
  expect(screen.getByRole("button", { name: /^Gerar até/ })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Pronto" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
