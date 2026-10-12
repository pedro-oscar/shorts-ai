import { createStore } from "zustand/vanilla";
import type {
  Aceite,
  AlvoParaAbrir,
  ArquivoDeVideo,
  Erro,
  EstadoDaConta,
  EstadoDaEtapa,
  EstadoDaPreparacao,
  Evento,
  IdiomaDaInterface,
  InfoDoLink,
  ModoDeLogin,
  NivelDoPlano,
  Pacote,
  Padroes,
  PeriodoDeCobranca,
  PlanoConfirmado,
  ProjetoResumo,
} from "./bindings";
import type { Nucleo } from "./nucleo";
import { lerFaixa } from "./screens/formatos";

/** Um link do YouTube da lista do passo Vídeos, desde que foi colado. */
export type LinkNaLista = {
  /** O texto colado, que identifica o link na lista. */
  url: string;
  /** Marcado em "Tenho direito de uso deste vídeo". */
  direitoDeUso: boolean;
} & (
  | { estado: "consultando" }
  | { estado: "pronto"; info: InfoDoLink }
  | { estado: "erro"; erro: Erro }
);

/** Os padrões que o passo Padrões mostra antes de a pessoa mexer em algo. */
export const PADROES_INICIAIS: Padroes = {
  quantidadeDeReels: 6,
  previa: true,
  pedido: "",
  revisoes: 1,
  modelo: "padrao",
  nomesProprios: [],
  idiomaDoVideo: "automatico",
};

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

/** O render da versão final de um projeto, da fila até o fim. */
export interface VersaoFinalDoProjeto {
  estado: EstadoDaEtapa;
  /** O percentual do render, quando ele já começou. */
  percentual: number | null;
  falha: string | null;
}

/** O que a preparação informa de um pacote enquanto baixa. */
export interface AndamentoDoPacote {
  estado: EstadoDaEtapa;
  /** O percentual do download, quando o pacote o mede. */
  percentual: number | null;
  falha: string | null;
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
  /** O que a preparação da primeira execução tem e o que falta; `null` até o núcleo dizer. */
  preparacao: EstadoDaPreparacao | null;
  /** O que cada pacote que a preparação baixa informa, desde que ela começou. */
  andamentoDaPreparacao: Partial<Record<Pacote, AndamentoDoPacote>>;
  preparando: boolean;
  /** Os vídeos da lista do passo Vídeos, antes de Gerar. */
  arquivos: ArquivoDeVideo[];
  erroDeArquivos: Erro | null;
  /** Os links do YouTube da lista do passo Vídeos, antes de Gerar. */
  links: LinkNaLista[];
  /** Os campos Início e Fim de cada vídeo da lista (por caminho ou endereço), como digitados. */
  faixas: Record<string, { inicio: string; fim: string }>;
  /** As opções que valem para todos os projetos do lote. */
  padroes: Padroes;
  /** Os projetos criados, com o estado de cada etapa, em ordem de criação. */
  projetos: ProjetoNaFila[];
  /** A leitura de cada projeto, feita pelo núcleo ao abrir o passo Reels. */
  galeria: Record<string, LeituraDoProjeto>;
  /** O que o sistema não abriu, por projeto; some quando ele abre. */
  errosAoAbrir: Record<string, Erro | null>;
  /** O render da versão final de cada projeto que a pessoa pediu. */
  versoesFinais: Record<string, VersaoFinalDoProjeto>;
  /** Por que o núcleo não aceitou o pedido de versão final. */
  erroDaVersaoFinal: Erro | null;
}

export interface AppStore extends AppState {
  /** Começa a ouvir o núcleo e pede o estado inicial; devolve a função que para. */
  connect: () => () => void;
  /** Baixa o que falta da primeira execução; cada pacote informa o seu andamento. */
  preparar: () => Promise<void>;
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
  /** Escreve o Início ou o Fim da faixa do vídeo (caminho ou endereço), como a pessoa digitou. */
  definirFaixa: (chave: string, campo: "inicio" | "fim", texto: string) => void;
  /** Consulta cada endereço de `texto` (um por linha) e põe na lista os que ainda não estão. */
  adicionarLinks: (texto: string) => Promise<void>;
  removerLink: (url: string) => void;
  /** Marca ou desmarca o direito de uso do link. */
  definirDireitoDeUso: (url: string, direitoDeUso: boolean) => void;
  /** Marca ou desmarca o direito de uso de todos os links da lista. */
  definirDireitoDeUsoDeTodos: (direitoDeUso: boolean) => void;
  /** Muda só as opções de `mudancas`; as outras ficam como estão. */
  definirPadroes: (mudancas: Partial<Padroes>) => void;
  carregarGaleria: (id: string) => Promise<void>;
  abrirNoSistema: (id: string, alvo: AlvoParaAbrir) => Promise<void>;
  /** Pede a versão final dos reels dos projetos `ids`: é só render, sem custo de tokens. */
  gerarVersaoFinal: (ids: string[]) => Promise<void>;
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
        case "preparacaoMudou":
          set((current) => ({
            andamentoDaPreparacao: {
              ...current.andamentoDaPreparacao,
              [evento.pacote]: {
                estado: evento.estado,
                percentual: null,
                falha: evento.falha,
              },
            },
          }));
          break;
        case "progressoDaPreparacao":
          set((current) => {
            const atual = current.andamentoDaPreparacao[evento.pacote];
            return atual
              ? {
                  andamentoDaPreparacao: {
                    ...current.andamentoDaPreparacao,
                    [evento.pacote]: {
                      ...atual,
                      percentual: evento.percentual,
                    },
                  },
                }
              : {};
          });
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
        case "versaoFinalMudou":
          set((current) => ({
            versoesFinais: {
              ...current.versoesFinais,
              [evento.projeto]: {
                estado: evento.estado,
                percentual:
                  evento.estado === "emAndamento"
                    ? (current.versoesFinais[evento.projeto]?.percentual ?? 0)
                    : null,
                falha: evento.falha,
              },
            },
          }));
          // A Galeria passa a mostrar os arquivos da versão final.
          if (evento.estado === "concluida")
            void get().carregarGaleria(evento.projeto);
          break;
        case "progressoDaVersaoFinal":
          set((current) => {
            const atual = current.versoesFinais[evento.projeto];
            return atual
              ? {
                  versoesFinais: {
                    ...current.versoesFinais,
                    [evento.projeto]: {
                      ...atual,
                      percentual: evento.percentual,
                    },
                  },
                }
              : {};
          });
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
      preparacao: null,
      andamentoDaPreparacao: {},
      preparando: false,
      arquivos: [],
      erroDeArquivos: null,
      links: [],
      faixas: {},
      padroes: PADROES_INICIAIS,
      projetos: [],
      galeria: {},
      errosAoAbrir: {},
      versoesFinais: {},
      erroDaVersaoFinal: null,

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
          .then(async (inicial) => {
            const preparacao = await nucleo.verificarPreparacao();
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
              preparacao: current.preparacao ?? preparacao,
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

      preparar: async () => {
        set({ preparando: true, andamentoDaPreparacao: {} });
        const preparacao = await nucleo.preparar();
        if (preparacao.status === "ok")
          set({ preparando: false, preparacao: preparacao.data });
        else set({ preparando: false });
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

      adicionarLinks: async (texto) => {
        const novos = [
          ...new Set(
            texto
              .split("\n")
              .map((linha) => linha.trim())
              .filter(Boolean),
          ),
        ].filter((url) => !get().links.some((link) => link.url === url));
        set((current) => ({
          links: [
            ...current.links,
            ...novos.map((url): LinkNaLista => ({
              url,
              direitoDeUso: false,
              estado: "consultando",
            })),
          ],
        }));
        await Promise.all(
          novos.map(async (url) => {
            const result = await nucleo.consultarLink(url);
            set((current) => ({
              links: current.links.map((link) =>
                link.url === url
                  ? {
                      url,
                      direitoDeUso: link.direitoDeUso,
                      ...(result.status === "ok"
                        ? { estado: "pronto" as const, info: result.data }
                        : { estado: "erro" as const, erro: result.error }),
                    }
                  : link,
              ),
            }));
          }),
        );
      },

      definirFaixa: (chave, campo, texto) => {
        set((current) => ({
          faixas: {
            ...current.faixas,
            [chave]: {
              inicio: "",
              fim: "",
              ...current.faixas[chave],
              [campo]: texto,
            },
          },
        }));
      },

      removerLink: (url) => {
        set((current) => ({
          links: current.links.filter((link) => link.url !== url),
        }));
      },

      definirDireitoDeUso: (url, direitoDeUso) => {
        set((current) => ({
          links: current.links.map((link) =>
            link.url === url ? { ...link, direitoDeUso } : link,
          ),
        }));
      },

      definirDireitoDeUsoDeTodos: (direitoDeUso) => {
        set((current) => ({
          links: current.links.map((link) => ({ ...link, direitoDeUso })),
        }));
      },

      definirPadroes: (mudancas) => {
        set((current) => ({ padroes: { ...current.padroes, ...mudancas } }));
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

      gerarVersaoFinal: async (ids) => {
        const result = await nucleo.gerarVersaoFinal(ids);
        set({
          erroDaVersaoFinal: result.status === "error" ? result.error : null,
        });
      },

      urlDoArquivo: nucleo.urlDoArquivo,

      gerar: async () => {
        const faixaDe = (chave: string) => {
          const campos = get().faixas[chave];
          const faixa = campos ? lerFaixa(campos.inicio, campos.fim) : null;
          return faixa === "invalida" ? null : faixa;
        };
        const result = await nucleo.criarLote(
          get().arquivos.map((a) => ({
            caminho: a.caminho,
            faixa: faixaDe(a.caminho),
          })),
          get().links.flatMap((link) =>
            link.estado === "pronto"
              ? [
                  {
                    url: link.info.url,
                    titulo: link.info.titulo,
                    canal: link.info.canal,
                    direitoDeUso: link.direitoDeUso,
                    faixa: faixaDe(link.url),
                  },
                ]
              : [],
          ),
          get().padroes,
        );
        if (result.status === "error") {
          set({ erroDeArquivos: result.error });
          return false;
        }
        set({ arquivos: [], links: [], faixas: {}, erroDeArquivos: null });
        return true;
      },
    };
  });
}

export type AppStoreApi = ReturnType<typeof createAppStore>;
