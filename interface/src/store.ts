import { createStore } from "zustand/vanilla";
import type {
  Aceite,
  Erro,
  EstadoDaConta,
  Evento,
  IdiomaDaInterface,
} from "./bindings";
import type { Nucleo } from "./nucleo";

export interface AppState {
  /** `null` até o núcleo responder. */
  app: { versao: string; idiomaDaInterface: IdiomaDaInterface } | null;
  /** As preferências não puderam ser lidas: o app não passa da mensagem de erro. */
  erroAoAbrir: Erro | null;
  /** Onde o núcleo guardou, ao abrir, o arquivo de preferências que estava corrompido. */
  backupDasPreferencias: string | null;
  aceite: Aceite | null;
  erroAoAceitar: Erro | null;
  /** `null` até o núcleo verificar o Claude Code. */
  conta: EstadoDaConta | null;
  /** O login está aberto no navegador e o app espera o status mudar. */
  entrando: boolean;
  /** O teste de resposta que roda depois do login. */
  testeDoClaude: "pendente" | "testando" | "ok" | "falhou";
  erroDaConta: Erro | null;
}

export interface AppStore extends AppState {
  /** Começa a ouvir o núcleo e pede o estado inicial; devolve a função que para. */
  connect: () => () => void;
  aceitarAviso: () => Promise<void>;
  verificarConta: () => Promise<void>;
  entrarNoClaudeCode: () => Promise<void>;
  testarClaude: () => Promise<void>;
  sair: () => Promise<void>;
}

/** O estado da interface, alimentado pelos eventos do núcleo. */
export function createAppStore(nucleo: Nucleo) {
  return createStore<AppStore>()((set, get) => {
    // O único evento, por ora; com o segundo, um switch em evento.tipo.
    function apply(evento: Evento) {
      set({ aceite: evento.aceite, erroAoAceitar: null });
    }

    return {
      app: null,
      erroAoAbrir: null,
      backupDasPreferencias: null,
      aceite: null,
      erroAoAceitar: null,
      conta: null,
      entrando: false,
      testeDoClaude: "pendente",
      erroDaConta: null,

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
              backupDasPreferencias: inicial.backupDasPreferencias,
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

      verificarConta: async () => {
        set({ conta: await nucleo.verificarConta(), erroDaConta: null });
      },

      entrarNoClaudeCode: async () => {
        set({ entrando: true, erroDaConta: null });
        const result = await nucleo.entrarNoClaudeCode();
        if (result.status === "error") {
          set({ entrando: false, erroDaConta: result.error });
          return;
        }
        set({ entrando: false, conta: result.data });
        if (result.data.tipo === "logado") await get().testarClaude();
      },

      testarClaude: async () => {
        set({ testeDoClaude: "testando", erroDaConta: null });
        const result = await nucleo.testarClaude();
        if (result.status === "error")
          set({ testeDoClaude: "falhou", erroDaConta: result.error });
        else set({ testeDoClaude: "ok" });
      },

      sair: () => nucleo.sair(),
    };
  });
}

export type AppStoreApi = ReturnType<typeof createAppStore>;
