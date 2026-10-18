import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { LoteResumo, ProjetoResumo } from "./bindings";
import { App } from "./App";
import { PADROES_INICIAIS } from "./store";
import {
  ACCEPTED_AT,
  LOGADO,
  SEM_CUSTO,
  createFakeNucleo,
} from "./test/fakeNucleo";

const INICIAL = {
  aceite: { data: ACCEPTED_AT },
  plano: { nivel: "max5x", periodo: "mensal", precoDeApi: false },
} as const;

/** Um projeto com a Importação concluída e o resto por fazer: anda no lote. */
const EM_ANDAMENTO: ProjetoResumo = {
  id: "aula",
  titulo: "aula",
  pasta: "/Biblioteca/aula",
  lote: "2026-10-08T14-32-00",
  etapas: (
    ["importacao", "transcricao", "roteiro", "producao", "revisao"] as const
  ).map((etapa, i) => ({
    etapa,
    estado: i === 0 ? "concluida" : "pendente",
  })),
  falha: null,
  parada: null,
  videoAusente: false,
  excecoes: {},
  custo: SEM_CUSTO,
};

/** Sem lote, o app abre a folha de Vídeos depois de conferir a Conta: o topo é outro. */
async function esperarVideos() {
  await screen.findByRole("heading", { name: "Vídeos" });
}

function renderApp(
  projetos: ProjetoResumo[] = [],
  antes: (fake: ReturnType<typeof createFakeNucleo>) => void = () => {},
) {
  const lote: LoteResumo = {
    id: "2026-10-08T14-32-00",
    nome: "Lote de 08/10 14:32",
    criadoEm: "2026-10-08T14:32:00Z",
    padroes: PADROES_INICIAIS,
    projetos,
    ausentes: [],
    aberto: true,
    custo: SEM_CUSTO,
  };
  const fake = createFakeNucleo(INICIAL, LOGADO, projetos.length ? [lote] : []);
  antes(fake);
  render(<App nucleo={fake.nucleo} />);
  return { ...fake, user: userEvent.setup() };
}

test("a versão nova aparece no topo quando termina de baixar, e o botão a instala", async () => {
  const app = renderApp();
  await esperarVideos();
  expect(screen.queryByText(/pronta$/)).toBeNull();

  act(() => {
    app.baixarAtualizacao("0.2.0");
  });
  await screen.findByText("Versão 0.2.0 pronta");
  await app.user.click(
    screen.getByRole("button", { name: "Reiniciar e atualizar" }),
  );

  expect(app.calls.atualizacoes).toBe(1);
});

test("a versão que já tinha baixado antes de a interface abrir aparece no topo", async () => {
  renderApp([], (fake) => {
    fake.atualizacaoJaBaixada("0.2.0");
  });

  await screen.findByText("Versão 0.2.0 pronta");
});

test("com o lote andando, a pessoa confirma antes; Agora não deixa o lote seguir", async () => {
  const app = renderApp([EM_ANDAMENTO], (fake) => {
    fake.atualizacaoJaBaixada("0.2.0");
  });
  await screen.findByRole("listitem", { name: "aula" });

  await app.user.click(
    await screen.findByRole("button", { name: "Reiniciar e atualizar" }),
  );
  const confirmacao = screen.getByRole("alertdialog", {
    name: "Reiniciar e atualizar",
  });
  expect(confirmacao).toHaveTextContent(
    "O lote em curso para agora e volta Pausado quando o app reabrir.",
  );
  await app.user.click(screen.getByRole("button", { name: "Agora não" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(app.calls.atualizacoes).toBe(0);

  await app.user.click(
    screen.getByRole("button", { name: "Reiniciar e atualizar" }),
  );
  await app.user.click(screen.getByRole("button", { name: "Reiniciar agora" }));

  expect(app.calls.atualizacoes).toBe(1);
});

test("a atualização que não instala mostra o erro", async () => {
  const app = renderApp([], (fake) => {
    fake.atualizacaoJaBaixada("0.2.0");
    fake.falharInstalacaoDaAtualizacao({
      codigo: "appNaoAtualizado",
      detalhe: "assinatura inválida",
    });
  });
  await esperarVideos();

  await app.user.click(
    screen.getByRole("button", { name: "Reiniciar e atualizar" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A versão nova do app não foi instalada.",
  );
});
