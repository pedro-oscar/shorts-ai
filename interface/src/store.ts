import { createStore } from "zustand/vanilla";
import type {
  Aceite,
  AlvoParaAbrir,
  ArquivoDeVideo,
  Erro,
  EstadoDaConta,
  Evento,
  IdiomaDaInterface,
  ModoDeLogin,
  NivelDoPlano,
  PeriodoDeCobranca,
  PlanoConfirmado,
  ProjetoResumo,
} from "./bindings";
import type { Nucleo } from "./nucleo";

/** Quantas ações do Claude o Gerando mostra por projeto. */
const ULTIMAS_ACOES = 5;

/** Uma ação do Claude na sessão em andamento: a ferramenta, ou `texto`, e o que ela toca. */
export interface AcaoDoClaude {
  /** A posição da ação na etapa, a partir de 1. */
  numero: number;
  ferramenta: string;
  alvo: string | null;
}

/** Os reels e as reservas do projeto, ou o erro de quando o núcleo não os leu. */
export type LeituraDoProjeto = Awaited<ReturnType<Nucleo["dadosDoProjeto"]>>;

/** Um projeto na fila, com o que a etapa em andamento informa ao vivo. */
export interface ProjetoNaFila extends ProjetoResumo {
  /** O percentual da etapa em andamento, quando ela o mede. */
  percentual: number | null;
  /** As últimas ações do Claude na etapa, da mais antiga à mais nova. */
  acoes: AcaoDoClaude[];
  /** Os tokens de entrada e de cache que a sessão do Claude já usou. */
  tokens: { entrada: number; cache: number } | null;
}

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
  /** O instalador ou o `claude update` está rodando. */
  instalando: boolean;
  atualizando: boolean;
  /** A saída do instalador ou do `claude update`, linha a linha. */
  saidaDoComando: string[];
  /** O login abre num terminal do sistema, para colar o código que o navegador mostrar. */
  loginPorTerminal: boolean;
  /** O plano que a pessoa confirmou; `null` até ela confirmar. */
  plano: PlanoConfirmado | null;
  chaveDeApiNoAmbiente: boolean;
  /** A Biblioteca, onde ficam os projetos. */
  biblioteca: string;
  /** Os vídeos da lista do passo Vídeos, antes de Gerar. */
  arquivos: ArquivoDeVideo[];
  erroDeArquivos: Erro | null;
  /** Os projetos criados, com o estado de cada etapa, em ordem de criação. */
  projetos: ProjetoNaFila[];
  /** A leitura de cada projeto, feita pelo núcleo ao abrir o passo Reels. */
  galeria: Record<string, LeituraDoProjeto>;
  /** O que o sistema não abriu, por projeto; some quando ele abre. */
  errosAoAbrir: Record<string, Erro | null>;
}

export interface AppStore extends AppState {
  /** Começa a ouvir o núcleo e pede o estado inicial; devolve a função que para. */
  connect: () => () => void;
  aceitarAviso: () => Promise<void>;
  verificarConta: () => Promise<void>;
  entrarNoClaudeCode: (modo: ModoDeLogin) => Promise<void>;
  instalarClaudeCode: () => Promise<void>;
  atualizarClaudeCode: () => Promise<void>;
  confirmarPlano: (
    nivel: NivelDoPlano,
    periodo: PeriodoDeCobranca,
  ) => Promise<void>;
  setLoginPorTerminal: (porTerminal: boolean) => void;
  testarClaude: () => Promise<void>;
  sair: () => Promise<void>;
  adicionarArquivos: (caminhos: string[]) => Promise<void>;
  escolherArquivos: () => Promise<void>;
  removerArquivo: (caminho: string) => void;
  carregarGaleria: (id: string) => Promise<void>;
  abrirNoSistema: (id: string, alvo: AlvoParaAbrir) => Promise<void>;
  /** O endereço pelo qual o player toca o reel. */
  urlDoArquivo: (caminho: string) => string;
  /** Cria o lote com os vídeos da lista; devolve se criou. */
  gerar: () => Promise<boolean>;
}

/** O estado da interface, alimentado pelos eventos do núcleo. */
export function createAppStore(nucleo: Nucleo) {
  return createStore<AppStore>()((set, get) => {
    /** Muda só o projeto `id`. */
    function mudarProjeto(
      id: string,
      mudar: (projeto: ProjetoNaFila) => ProjetoNaFila,
    ) {
      set((current) => ({
        projetos: current.projetos.map((projeto) =>
          projeto.id === id ? mudar(projeto) : projeto,
        ),
      }));
    }

    function apply(evento: Evento) {
      switch (evento.tipo) {
        case "avisoAceito":
          set({ aceite: evento.aceite, erroAoAceitar: null });
          break;
        case "planoConfirmado":
          set({ plano: evento.plano });
          break;
        case "saidaDoComando":
          set((current) => ({
            saidaDoComando: [...current.saidaDoComando, evento.linha],
          }));
          break;
        case "projetoCriado":
          set((current) => ({
            projetos: [
              ...current.projetos.filter((p) => p.id !== evento.projeto.id),
              { ...evento.projeto, percentual: null, acoes: [], tokens: null },
            ],
          }));
          break;
        case "etapaMudou":
          // Uma etapa que começa limpa o que a anterior mostrava; uma que falha deixa as
          // ações do Claude à vista, junto com o motivo.
          mudarProjeto(evento.projeto, (projeto) => ({
            ...projeto,
            etapas: projeto.etapas.map((item) =>
              item.etapa === evento.etapa
                ? { ...item, estado: evento.estado }
                : item,
            ),
            falha: evento.falha,
            percentual: null,
            ...(evento.estado === "emAndamento" && { acoes: [], tokens: null }),
          }));
          break;
        case "progressoDaEtapa":
          mudarProjeto(evento.projeto, (projeto) => ({
            ...projeto,
            percentual: evento.percentual,
          }));
          break;
        case "acaoDoClaude":
          mudarProjeto(evento.projeto, (projeto) => {
            const numero = (projeto.acoes.at(-1)?.numero ?? 0) + 1;
            const acao = {
              numero,
              ferramenta: evento.ferramenta,
              alvo: evento.alvo,
            };
            return {
              ...projeto,
              acoes: [...projeto.acoes, acao].slice(-ULTIMAS_ACOES),
            };
          });
          break;
        case "tokensDoClaude":
          mudarProjeto(evento.projeto, (projeto) => ({
            ...projeto,
            tokens: { entrada: evento.entrada, cache: evento.cache },
          }));
          break;
      }
    }

    /** Roda um comando de longa duração da Conta (instalar, atualizar) e guarda o resultado. */
    async function rodar(
      flag: "instalando" | "atualizando",
      comando: () => ReturnType<Nucleo["instalarClaudeCode"]>,
    ) {
      set({ [flag]: true, erroDaConta: null, saidaDoComando: [] });
      const result = await comando();
      if (result.status === "error")
        set({ [flag]: false, erroDaConta: result.error });
      else set({ [flag]: false, conta: result.data });
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
      instalando: false,
      atualizando: false,
      saidaDoComando: [],
      loginPorTerminal: false,
      plano: null,
      chaveDeApiNoAmbiente: false,
      biblioteca: "",
      arquivos: [],
      erroDeArquivos: null,
      projetos: [],
      galeria: {},
      errosAoAbrir: {},

      connect: () => {
        let connected = true;
        const stopListening = nucleo.listen((evento) => {
          if (connected) apply(evento);
        });
        const stopDropping = nucleo.aoSoltarArquivos((caminhos) => {
          if (connected) void get().adicionarArquivos(caminhos);
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
              plano: current.plano ?? inicial.plano,
              chaveDeApiNoAmbiente: inicial.chaveDeApiNoAmbiente,
              biblioteca: inicial.biblioteca,
            }));
          });
        return () => {
          connected = false;
          for (const stopping of [stopListening, stopDropping])
            void stopping.then((stop) => {
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

      entrarNoClaudeCode: async (modo) => {
        set({ entrando: true, erroDaConta: null });
        const result = await nucleo.entrarNoClaudeCode(
          modo,
          get().loginPorTerminal,
        );
        if (result.status === "error") {
          set({ entrando: false, erroDaConta: result.error });
          return;
        }
        set({ entrando: false, conta: result.data });
        if (result.data.tipo === "logado") await get().testarClaude();
      },

      instalarClaudeCode: () =>
        rodar("instalando", () => nucleo.instalarClaudeCode()),

      atualizarClaudeCode: () =>
        rodar("atualizando", () => nucleo.atualizarClaudeCode()),

      confirmarPlano: async (nivel, periodo) => {
        // O plano em si chega pelo evento planoConfirmado.
        const result = await nucleo.confirmarPlano(nivel, periodo);
        if (result.status === "error") set({ erroDaConta: result.error });
      },

      setLoginPorTerminal: (loginPorTerminal) => {
        set({ loginPorTerminal });
      },

      testarClaude: async () => {
        set({ testeDoClaude: "testando", erroDaConta: null });
        const result = await nucleo.testarClaude();
        if (result.status === "error")
          set({ testeDoClaude: "falhou", erroDaConta: result.error });
        else set({ testeDoClaude: "ok" });
      },

      sair: () => nucleo.sair(),

      adicionarArquivos: async (caminhos) => {
        const novos = caminhos.filter(
          (caminho) => !get().arquivos.some((a) => a.caminho === caminho),
        );
        if (novos.length === 0) return;
        const result = await nucleo.inspecionarArquivos(novos);
        if (result.status === "error") {
          set({ erroDeArquivos: result.error });
          return;
        }
        set((current) => ({
          erroDeArquivos: null,
          arquivos: [
            ...current.arquivos,
            ...result.data.filter(
              (novo) =>
                !current.arquivos.some((a) => a.caminho === novo.caminho),
            ),
          ],
        }));
      },

      escolherArquivos: async () => {
        await get().adicionarArquivos(await nucleo.escolherArquivos());
      },

      removerArquivo: (caminho) => {
        set((current) => ({
          arquivos: current.arquivos.filter((a) => a.caminho !== caminho),
        }));
      },

      carregarGaleria: async (id) => {
        const leitura = await nucleo.dadosDoProjeto(id);
        set((current) => ({ galeria: { ...current.galeria, [id]: leitura } }));
      },

      abrirNoSistema: async (id, alvo) => {
        const result = await nucleo.abrirNoSistema(id, alvo);
        set((current) => ({
          errosAoAbrir: {
            ...current.errosAoAbrir,
            [id]: result.status === "error" ? result.error : null,
          },
        }));
      },

      urlDoArquivo: nucleo.urlDoArquivo,

      gerar: async () => {
        const result = await nucleo.criarLote(
          get().arquivos.map((a) => a.caminho),
        );
        if (result.status === "error") {
          set({ erroDeArquivos: result.error });
          return false;
        }
        set({ arquivos: [], erroDeArquivos: null });
        return true;
      },
    };
  });
}

export type AppStoreApi = ReturnType<typeof createAppStore>;
