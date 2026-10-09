import type {
  Aceite,
  AlvoParaAbrir,
  ArquivoDeVideo,
  DadosDoProjeto,
  Erro,
  EstadoDaConta,
  EstadoInicial,
  Evento,
  ModoDeLogin,
  PlanoConfirmado,
  ProjetoResumo,
} from "../bindings";
import type { Nucleo } from "../nucleo";

/** A data que o núcleo falso grava no aceite: 7 de outubro de 2026, 18:30 em UTC. */
export const ACCEPTED_AT = "2026-10-07T18:30:00Z";

/** A conta que o núcleo falso tem por padrão: assinatura Max, com o Claude Code em dia. */
export const LOGADO: Extract<EstadoDaConta, { tipo: "logado" }> = {
  tipo: "logado",
  versao: "2.1.300",
  metodo: "claude.ai",
  plano: "max",
  email: "ana@example.com",
  cobranca: "assinatura",
};

/**
 * Um núcleo falso, sem Tauri: responde aos comandos como o do Rust e emite os mesmos
 * eventos. `calls` conta os comandos sem resposta visível, como "Sair".
 */
export function createFakeNucleo(
  initial: Partial<EstadoInicial> = {},
  conta: EstadoDaConta = LOGADO,
) {
  let state: EstadoInicial = {
    versao: "0.1.0",
    idiomaDaInterface: "pt-BR",
    aceite: null,
    erro: null,
    backupDasPreferencias: null,
    plano: null,
    chaveDeApiNoAmbiente: false,
    biblioteca: "/home/ana/Vídeos/Shorts AI",
    ...initial,
  };
  const listeners = new Set<(evento: Evento) => void>();
  const droppers = new Set<(caminhos: string[]) => void>();
  let picked: string[] = [];
  let projetos: ProjetoResumo[] = [];
  const dados = new Map<string, DadosDoProjeto>();
  const calls = {
    sair: 0,
    entrar: 0,
    testar: 0,
    instalar: 0,
    atualizar: 0,
    /** Os caminhos de cada `criarLote`. */
    lotes: [] as string[][],
    /** Os argumentos de cada `entrarNoClaudeCode`. */
    logins: [] as { modo: ModoDeLogin; porTerminal: boolean }[],
    /** O que cada `abrirNoSistema` pediu. */
    abertos: [] as { id: string; alvo: AlvoParaAbrir }[],
  };
  let commandError: Erro | null = null;
  let loginError: Erro | null = null;
  let testError: Erro | null = null;
  let acceptanceError: Erro | null = null;
  let batchError: Erro | null = null;
  let readError: Erro | null = null;

  const emit = (evento: Evento) => {
    for (const listener of listeners) listener(evento);
  };

  const nucleo: Nucleo = {
    estadoInicial: () => Promise.resolve(state),
    aceitarAviso: () => {
      if (acceptanceError)
        return Promise.resolve({ status: "error", error: acceptanceError });
      const aceite: Aceite = { data: ACCEPTED_AT };
      state = { ...state, aceite };
      emit({ tipo: "avisoAceito", aceite });
      return Promise.resolve({ status: "ok", data: aceite });
    },
    verificarConta: () => Promise.resolve(conta),
    instalarClaudeCode: () => {
      calls.instalar++;
      if (commandError)
        return Promise.resolve({ status: "error", error: commandError });
      emit({ tipo: "saidaDoComando", linha: "instalando o Claude Code" });
      conta = { tipo: "semLogin", versao: "2.1.300" };
      return Promise.resolve({ status: "ok", data: conta });
    },
    atualizarClaudeCode: () => {
      calls.atualizar++;
      if (commandError)
        return Promise.resolve({ status: "error", error: commandError });
      emit({ tipo: "saidaDoComando", linha: "atualizando o Claude Code" });
      conta = { tipo: "semLogin", versao: "2.1.400" };
      return Promise.resolve({ status: "ok", data: conta });
    },
    confirmarPlano: (nivel, periodo) => {
      const preco = nivel === "console" || nivel === "enterprise";
      const plano: PlanoConfirmado = {
        nivel,
        periodo: preco ? null : periodo,
        precoDeApi: preco,
      };
      state = { ...state, plano };
      emit({ tipo: "planoConfirmado", plano });
      return Promise.resolve({ status: "ok", data: plano });
    },
    entrarNoClaudeCode: (modo, porTerminal) => {
      calls.entrar++;
      calls.logins.push({ modo, porTerminal });
      if (loginError)
        return Promise.resolve({ status: "error", error: loginError });
      conta = LOGADO;
      return Promise.resolve({ status: "ok", data: conta });
    },
    testarClaude: () => {
      calls.testar++;
      if (testError)
        return Promise.resolve({ status: "error", error: testError });
      return Promise.resolve({ status: "ok", data: null });
    },
    escolherArquivos: () => Promise.resolve(picked),
    inspecionarArquivos: (caminhos) =>
      Promise.resolve({
        status: "ok",
        data: caminhos.map((caminho): ArquivoDeVideo => ({
          caminho,
          nome: caminho.split("/").pop() ?? caminho,
          tamanho: 1000,
          duracaoEmSegundos: caminho.endsWith("aula.mp4") ? 125 : null,
        })),
      }),
    criarLote: (caminhos) => {
      calls.lotes.push(caminhos);
      if (batchError)
        return Promise.resolve({ status: "error", error: batchError });
      projetos = caminhos.map((caminho) => {
        const nome = (caminho.split("/").pop() ?? caminho).replace(
          /\.\w+$/,
          "",
        );
        return {
          id: `${nome} (2026-10-09)`,
          titulo: nome,
          pasta: `/Biblioteca/${nome} (2026-10-09)`,
          etapas: (
            [
              "importacao",
              "transcricao",
              "roteiro",
              "producao",
              "revisao",
            ] as const
          ).map((etapa) => ({ etapa, estado: "pendente" as const })),
          falha: null,
        };
      });
      for (const projeto of projetos) emit({ tipo: "projetoCriado", projeto });
      return Promise.resolve({ status: "ok", data: projetos });
    },
    dadosDoProjeto: (id) => {
      if (readError)
        return Promise.resolve({ status: "error", error: readError });
      return Promise.resolve({
        status: "ok",
        data: dados.get(id) ?? { reels: [], reservas: [] },
      });
    },
    abrirNoSistema: (id, alvo) => {
      calls.abertos.push({ id, alvo });
      return Promise.resolve({ status: "ok", data: null });
    },
    urlDoArquivo: (caminho) => `asset://${caminho}`,
    sair: () => {
      calls.sair++;
      return Promise.resolve();
    },
    aoSoltarArquivos: (listener) => {
      droppers.add(listener);
      return Promise.resolve(() => {
        droppers.delete(listener);
      });
    },
    listen: (listener) => {
      listeners.add(listener);
      return Promise.resolve(() => {
        listeners.delete(listener);
      });
    },
  };

  return {
    nucleo,
    calls,
    /** O instalador e o `claude update` falham com este erro. */
    failCommand: (erro: Erro) => {
      commandError = erro;
    },
    failLogin: (erro: Erro) => {
      loginError = erro;
    },
    failTest: (erro: Erro) => {
      testError = erro;
    },
    /** Os próximos aceites falham com este erro, como num disco sem permissão. */
    failAcceptance: (erro: Erro) => {
      acceptanceError = erro;
    },
    failBatch: (erro: Erro) => {
      batchError = erro;
    },
    /** Os reels e as reservas que o núcleo lê do projeto `id`. */
    definirDados: (id: string, projeto: DadosDoProjeto) => {
      dados.set(id, projeto);
    },
    /** A leitura dos dados de qualquer projeto falha com este erro. */
    falharLeitura: (erro: Erro) => {
      readError = erro;
    },
    /** O que o seletor de arquivos devolve na próxima vez. */
    pick: (caminhos: string[]) => {
      picked = caminhos;
    },
    /** A pessoa solta estes arquivos na janela. */
    drop: (caminhos: string[]) => {
      for (const dropper of droppers) dropper(caminhos);
    },
    /** O núcleo emite este evento, como o progresso da etapa ou uma ação do Claude. */
    emitir: emit,
    /** O núcleo avisa que a etapa do projeto mudou de estado. */
    etapa: (
      projeto: string,
      etapa: ProjetoResumo["etapas"][number]["etapa"],
      estado: ProjetoResumo["etapas"][number]["estado"],
      falha: string | null = null,
    ) => {
      emit({ tipo: "etapaMudou", projeto, etapa, estado, falha });
    },
  };
}
