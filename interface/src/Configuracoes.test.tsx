import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { LoteResumo } from "./bindings";
import { App } from "./App";
import { PADROES_INICIAIS } from "./store";
import {
  ACCEPTED_AT,
  DIAGNOSTICO_PADRAO,
  createFakeNucleo,
} from "./test/fakeNucleo";

const INICIAL = {
  aceite: { data: ACCEPTED_AT },
  plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
} as const;

async function abrirConfiguracoes() {
  const fake = createFakeNucleo(INICIAL);
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Configurações" }),
  );
  return { ...fake, user };
}

const LOTE_COPIADO: LoteResumo = {
  id: "2026-09-01T10-00-00",
  nome: "Lote de 01/09 10:00",
  criadoEm: "2026-09-01T10:00:00Z",
  padroes: PADROES_INICIAIS,
  projetos: [
    {
      id: "Aula antiga (2026-09-01)",
      titulo: "Aula antiga",
      pasta: "/D/Aula antiga (2026-09-01)",
      lote: "2026-09-01T10-00-00",
      etapas: [],
      falha: null,
      parada: null,
      videoAusente: false,
      excecoes: {},
    },
  ],
  ausentes: [],
  aberto: false,
};

test("a engrenagem não aparece antes do aceite do Aviso de uso", async () => {
  const { nucleo } = createFakeNucleo();
  render(<App nucleo={{ ...nucleo }} />);

  await screen.findByRole("heading", { name: /Aviso de uso/ });
  expect(screen.queryByRole("button", { name: "Configurações" })).toBeNull();
});

test("trocar a Biblioteca mostra a pasta nova e os projetos copiados para lá", async () => {
  const { user, escolherPastaDaBiblioteca, copiarParaBiblioteca } =
    await abrirConfiguracoes();
  screen.getByText("Os projetos ficam em /home/ana/Vídeos/Shorts AI.");
  copiarParaBiblioteca("/D/Reels", [LOTE_COPIADO]);
  escolherPastaDaBiblioteca("/D/Reels");

  await user.click(
    screen.getByRole("button", { name: "Trocar a pasta da Biblioteca" }),
  );

  await screen.findByText("Os projetos ficam em /D/Reels.");
  await user.click(screen.getByRole("button", { name: "Lotes" }));
  const lote = await screen.findByRole("listitem", {
    name: "Lote de 01/09 10:00",
  });
  within(lote).getByText(/Aula antiga/);
});

test("cancelar o seletor de pastas deixa a Biblioteca como está", async () => {
  const { user, escolherPastaDaBiblioteca } = await abrirConfiguracoes();
  escolherPastaDaBiblioteca(null);

  await user.click(
    screen.getByRole("button", { name: "Trocar a pasta da Biblioteca" }),
  );

  screen.getByText("Os projetos ficam em /home/ana/Vídeos/Shorts AI.");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a Biblioteca que o núcleo recusa trocar mostra o motivo", async () => {
  const { user, escolherPastaDaBiblioteca, falharBiblioteca } =
    await abrirConfiguracoes();
  escolherPastaDaBiblioteca("/D/Reels");
  falharBiblioteca({ codigo: "bibliotecaOcupada" });

  await user.click(
    screen.getByRole("button", { name: "Trocar a pasta da Biblioteca" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não dá para trocar a Biblioteca com projetos rodando ou na fila",
  );
  screen.getByText("Os projetos ficam em /home/ana/Vídeos/Shorts AI.");
});

test("trocar o idioma passa a interface para o inglês", async () => {
  const { user, calls } = await abrirConfiguracoes();

  await user.selectOptions(screen.getByLabelText("Idioma"), "en");

  await screen.findByRole("heading", { name: "Settings" });
  expect(calls.idiomas).toEqual(["en"]);
});

test("o Diagnóstico mostra a GPU, o disco, as dependências e o Claude Code", async () => {
  const { user } = await abrirConfiguracoes();

  await user.click(screen.getByRole("button", { name: "Abrir o Diagnóstico" }));

  await screen.findByRole("heading", { name: "Diagnóstico" });
  await screen.findByText("GPU com Vulkan");
  screen.getByText("250.0 GB livres");
  const lista = screen.getByRole("list", { name: "Dependências" });
  within(lista).getByText(/ffmpeg.*encontrado, versão 7.1.1/);
  within(lista).getByText(/Chrome do Remotion.*encontrado/);
  screen.getByText("versão 2.1.300, logado (max)");
});

test("o Diagnóstico diz o que falta no ffmpeg e na máquina sem Vulkan", async () => {
  const fake = createFakeNucleo(INICIAL);
  fake.definirDiagnostico({
    ...DIAGNOSTICO_PADRAO,
    gpu: "soCpu",
    dependencias: [
      {
        nome: "ffmpeg",
        situacao: { tipo: "incompleta", faltam: ["zscale", "wrapped_avframe"] },
      },
      { nome: "node", situacao: { tipo: "ausente" } },
    ],
    conta: { tipo: "naoInstalado" },
  });
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Configurações" }),
  );

  await user.click(screen.getByRole("button", { name: "Abrir o Diagnóstico" }));

  await screen.findByText(/Só CPU/);
  screen.getByText(/ffmpeg.*faltam: zscale, wrapped_avframe/);
  screen.getByText(/Node.*não encontrado/);
  screen.getByText("não instalado");
});

test("o Diagnóstico roda o teste do Claude e mostra a falha", async () => {
  const { user, calls, failTest } = await abrirConfiguracoes();
  failTest({ codigo: "claudeNaoRespondeu", detalhe: "sem cota" });
  await user.click(screen.getByRole("button", { name: "Abrir o Diagnóstico" }));

  await user.click(
    await screen.findByRole("button", { name: "Testar o Claude" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "O Claude não respondeu ao teste",
  );
  expect(calls.testar).toBe(1);
});

test("Copiar relatório copia o resultado do Diagnóstico, sem caminhos nem e-mail", async () => {
  const { user } = await abrirConfiguracoes();
  await user.click(screen.getByRole("button", { name: "Abrir o Diagnóstico" }));

  await user.click(
    await screen.findByRole("button", { name: "Copiar relatório" }),
  );

  await screen.findByText("Relatório copiado.");
  const copiado = await navigator.clipboard.readText();
  expect(copiado).toContain("Relatório do Diagnóstico do Shorts AI 0.1.0");
  expect(copiado).toContain("Placa de vídeo: GPU com Vulkan");
  expect(copiado).toContain("ffmpeg: encontrado, versão 7.1.1");
  expect(copiado).toContain("Claude Code: versão 2.1.300, logado (max)");
  expect(copiado).not.toContain("ana@example.com");
  expect(copiado).not.toContain("/home/ana");
});

test("do Diagnóstico dá para voltar às Configurações e delas ao Sobre", async () => {
  const { user } = await abrirConfiguracoes();
  await user.click(screen.getByRole("button", { name: "Abrir o Diagnóstico" }));
  await user.click(await screen.findByRole("button", { name: "Voltar" }));

  await user.click(screen.getByRole("button", { name: "Sobre o Shorts AI" }));

  await screen.findByRole("heading", { name: "Sobre o Shorts AI" });
  await user.click(screen.getByRole("button", { name: "Voltar" }));
  await screen.findByRole("heading", { name: "Configurações" });
});
