import type { Aceite, Erro, EstadoInicial, Evento } from "../bindings";
import type { Nucleo } from "../nucleo";

/** A data que o núcleo falso grava no aceite: 7 de outubro de 2026, 18:30 em UTC. */
export const ACCEPTED_AT = "2026-10-07T18:30:00Z";

/**
 * Um núcleo falso, sem Tauri: responde aos comandos como o do Rust e emite os mesmos
 * eventos. `calls` conta os comandos sem resposta visível, como "Sair".
 */
export function createFakeNucleo(initial: Partial<EstadoInicial> = {}) {
  let state: EstadoInicial = {
    versao: "0.1.0",
    idiomaDaInterface: "pt-BR",
    aceite: null,
    erro: null,
    backupDasPreferencias: null,
    ...initial,
  };
  const listeners = new Set<(evento: Evento) => void>();
  const calls = { sair: 0 };
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
    /** Os próximos aceites falham com este erro, como num disco sem permissão. */
    failAcceptance: (erro: Erro) => {
      acceptanceError = erro;
    },
  };
}
