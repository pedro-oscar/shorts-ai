import type {
  Aceite,
  Erro,
  EstadoDaConta,
  EstadoInicial,
  Evento,
  ModoDeLogin,
  PlanoConfirmado,
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
    ...initial,
  };
  const listeners = new Set<(evento: Evento) => void>();
  const calls = {
    sair: 0,
    entrar: 0,
    testar: 0,
    instalar: 0,
    atualizar: 0,
    /** Os argumentos de cada `entrarNoClaudeCode`. */
    logins: [] as { modo: ModoDeLogin; porTerminal: boolean }[],
  };
  let commandError: Erro | null = null;
  let loginError: Erro | null = null;
  let testError: Erro | null = null;
  let acceptanceError: Erro | null = null;

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
    sair: () => {
      calls.sair++;
      return Promise.resolve();
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
  };
}
