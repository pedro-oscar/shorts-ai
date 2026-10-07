import { createStore } from "zustand/vanilla";
import type { Aceite, Erro, Evento, IdiomaDaInterface } from "./bindings";
import type { Nucleo } from "./nucleo";

export interface AppState {
  /** `null` até o núcleo responder. */
  app: { versao: string; idiomaDaInterface: IdiomaDaInterface } | null;
  /** As preferências não puderam ser lidas: o app não passa da mensagem de erro. */
  erroAoAbrir: Erro | null;
  aceite: Aceite | null;
  erroAoAceitar: Erro | null;
}

export interface AppStore extends AppState {
  /** Começa a ouvir o núcleo e pede o estado inicial; devolve a função que para. */
  connect: () => () => void;
  aceitarAviso: () => Promise<void>;
  sair: () => Promise<void>;
}

/** O estado da interface, alimentado pelos eventos do núcleo. */
export function createAppStore(nucleo: Nucleo) {
  return createStore<AppStore>()((set) => {
    // O único evento, por ora; com o segundo, um switch em evento.tipo.
    function apply(evento: Evento) {
      set({ aceite: evento.aceite, erroAoAceitar: null });
    }

    return {
      app: null,
      erroAoAbrir: null,
      aceite: null,
      erroAoAceitar: null,

      connect: () => {
        let connected = true;
        const stopListening = nucleo.listen((evento) => {
          if (connected) apply(evento);
        });
        // Só pede o estado depois de ouvir, para nenhum evento cair entre os dois.
        void stopListening
          .then(() => nucleo.estadoInicial())
          .then((inicial) => {
            if (!connected) return;
            set((current) => ({
              app: {
                versao: inicial.versao,
                idiomaDaInterface: inicial.idiomaDaInterface,
              },
              erroAoAbrir: inicial.erro,
              // Um aceite que chegou por evento vale mais que o do estado inicial.
              aceite: current.aceite ?? inicial.aceite,
            }));
          });
        return () => {
          connected = false;
          void stopListening.then((stop) => {
            stop();
          });
        };
      },

      aceitarAviso: async () => {
        // O aceite em si chega pelo evento avisoAceito.
        const result = await nucleo.aceitarAviso();
        if (result.status === "error") set({ erroAoAceitar: result.error });
      },

      sair: () => nucleo.sair(),
    };
  });
}

export type AppStoreApi = ReturnType<typeof createAppStore>;
