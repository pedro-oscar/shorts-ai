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

test("Gerar fica desligado sem vídeos e mostra a Biblioteca", async () => {
  await renderVideos();

  expect(screen.getByRole("button", { name: "Gerar" })).toBeDisabled();
  screen.getByText(/Biblioteca: \/home\/ana\/Vídeos\/Shorts AI/);
});

test("Gerar cria o lote e Gerando mostra o projeto etapa a etapa", async () => {
  const { user, pick, calls, etapa } = await renderVideos();
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });

  await user.click(screen.getByRole("button", { name: "Gerar" }));

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

test("a falha da Importação mostra o motivo", async () => {
  const { user, pick, etapa } = await renderVideos();
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  await user.click(screen.getByRole("button", { name: "Gerar" }));
  await screen.findByRole("heading", { name: "Gerando" });

  etapa("aula (2026-10-09)", "importacao", "falhou", "No such file");

  await screen.findByText("Falhou");
  expect(screen.getByRole("alert")).toHaveTextContent("No such file");
});

test("um lote recusado pelo núcleo mostra o erro e fica em Vídeos", async () => {
  const { user, pick, failBatch } = await renderVideos();
  failBatch({ codigo: "arquivoInvalido", caminho: "/v/aula.mp4" });
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });

  await user.click(screen.getByRole("button", { name: "Gerar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "/v/aula.mp4 não é um vídeo aceito",
  );
  screen.getByRole("heading", { name: "Vídeos" });
});
