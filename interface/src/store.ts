import { createStore } from "zustand/vanilla";
import type {
  Aceite,
  AlvoParaAbrir,
  ArquivoDeVideo,
  Cotacao,
  Diagnostico,
  Erro,
  EstadoDaConta,
  EstadoDaEtapa,
  EstadoDaPreparacao,
  Estimativa,
  Evento,
  Excecoes,
  IdiomaDaInterface,
  InfoDoLink,
  Kit,
  LoteResumo,
  ModoDeLogin,
  Movimento,
  NivelDoPlano,
  Pacote,
  Padroes,
  PeriodoDeCobranca,
  PlanoConfirmado,
  ProjetoResumo,
  Regra,
  VerificacaoDaLogo,
} from "./bindings";
import type { Nucleo } from "./nucleo";
import { contaPronta } from "./screens/contaPronta";
import {
  type CamposDasExcecoes,
  SEM_CAMPOS,
  lerExcecoes,
  lerFaixa,
} from "./screens/formatos";

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
  kit: "Padrão",
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
  /** Quando a primeira etapa começou, em ms; `null` se não foi nesta execução do app. */
  iniciadoEm: number | null;
  /** Quando o projeto terminou ou falhou, em ms. */
  terminadoEm: number | null;
}

/** Um projeto que chegou do disco ou de um evento, ainda sem nada ao vivo. */
function naFila(projeto: ProjetoResumo): ProjetoNaFila {
  return {
    ...projeto,
    percentual: null,
    acoes: [],
    tokens: null,
    iniciadoEm: null,
    terminadoEm: null,
  };
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
  /**
   * A Conta já foi conferida nesta execução: estava pronta quando o núcleo a verificou, ou a
   * pessoa seguiu dela. Até lá, a Conta abre sozinha.
   */
  contaConferida: boolean;
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
  /** A cotação do R$ digitada; `null` mostra os valores em US$. */
  cotacao: Cotacao | null;
  chaveDeApiNoAmbiente: boolean;
  /** A Biblioteca, onde ficam os projetos. */
  biblioteca: string;
  /** Por que a última troca da Biblioteca ou do idioma não foi feita. */
  erroDasConfiguracoes: Erro | null;
  /** O que o Diagnóstico achou; `null` até ele terminar de conferir. */
  diagnostico: Diagnostico | null;
  /** As regras que o Claude anotou; `null` até o núcleo entregá-las. */
  regrasAprendidas: Regra[] | null;
  /** Os kits de marca, com o Padrão primeiro; vazio até o núcleo entregá-los. */
  kits: Kit[];
  /** As fontes embutidas que o kit pode usar. */
  fontesEmbutidas: string[];
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
  /** As Exceções de cada vídeo do passo Vídeos (caminho ou endereço), como digitadas. */
  excecoes: Record<string, CamposDasExcecoes>;
  /** As opções que valem para todos os projetos do lote. */
  padroes: Padroes;
  /** Os projetos de todos os lotes, com o estado de cada etapa, na ordem da fila. */
  projetos: ProjetoNaFila[];
  /** Os lotes da Biblioteca, do mais novo para o mais antigo. */
  lotes: LoteResumo[];
  /** O lote que o Gerando e os Reels mostram; `null` enquanto não há nenhum. */
  loteAtual: string | null;
  /** O passo Vídeos acrescenta ao lote atual em vez de começar outro. */
  adicionandoAoLote: boolean;
  /** A leitura de cada projeto, feita pelo núcleo ao abrir o passo Reels. */
  galeria: Record<string, LeituraDoProjeto>;
  /** O que o sistema não abriu, por projeto; some quando ele abre. */
  errosAoAbrir: Record<string, Erro | null>;
  /** O render da versão final de cada projeto que a pessoa pediu. */
  versoesFinais: Record<string, VersaoFinalDoProjeto>;
  /** Por que o núcleo não aceitou o pedido de versão final. */
  erroDaVersaoFinal: Erro | null;
  /** Por que o núcleo não renomeou o lote. */
  erroDoLote: Erro | null;
  /** O erro da última ação de Pausar, Cancelar, Retomar ou Tentar de novo. */
  erroDoCiclo: Erro | null;
  /** O último projeto excluído e o espaço que a exclusão liberou, em bytes. */
  excluido: { titulo: string; bytes: number } | null;
}

export interface AppStore extends AppState {
  /** Começa a ouvir o núcleo e pede o estado inicial; devolve a função que para. */
  connect: () => () => void;
  /** Pede a pasta da nova Biblioteca e passa a usá-la; a lista de lotes é relida de lá. */
  trocarBiblioteca: () => Promise<void>;
  definirIdioma: (idioma: IdiomaDaInterface) => Promise<void>;
  carregarRegrasAprendidas: () => Promise<void>;
  carregarKits: () => Promise<void>;
  /** Abre o seletor da logo; o caminho escolhido, ou `null` se a pessoa cancelou. */
  escolherLogo: () => Promise<string | null>;
  /** Confere o arquivo da logo (transparência, proporção, prévia); `null` se o núcleo o recusou. */
  verificarLogo: (caminho: string) => Promise<VerificacaoDaLogo | null>;
  /** Salva o kit e o escolhe para o lote; devolve se salvou. */
  salvarKit: (kit: Kit) => Promise<boolean>;
  /** Apaga um kit salvo; se era o do lote, volta ao Padrão. */
  apagarKit: (nome: string) => Promise<void>;
  /** Troca o texto de uma regra aprendida; texto vazio a apaga. */
  editarRegraAprendida: (indice: number, texto: string) => Promise<void>;
  apagarRegraAprendida: (indice: number) => Promise<void>;
  /** Confere de novo o computador para o Diagnóstico. */
  carregarDiagnostico: () => Promise<void>;
  /** Baixa o que falta da primeira execução; cada pacote informa o seu andamento. */
  preparar: () => Promise<void>;
  aceitarAviso: () => Promise<void>;
  verificarConta: () => Promise<void>;
  /** A pessoa seguiu da Conta: ela não abre mais sozinha nesta execução. */
  conferirConta: () => void;
  entrarNoClaudeCode: (modo: ModoDeLogin) => Promise<void>;
  instalarClaudeCode: () => Promise<void>;
  atualizarClaudeCode: () => Promise<void>;
  confirmarPlano: (
    nivel: NivelDoPlano,
    periodo: PeriodoDeCobranca,
  ) => Promise<void>;
  definirMultiplicador: (multiplicador: number | null) => Promise<void>;
  definirCotacao: (cotacao: number | null) => Promise<void>;
  setLoginPorTerminal: (porTerminal: boolean) => void;
  testarClaude: () => Promise<void>;
  sair: () => Promise<void>;
  adicionarArquivos: (caminhos: string[]) => Promise<void>;
  escolherArquivos: () => Promise<void>;
  removerArquivo: (caminho: string) => void;
  /** Escreve o Início ou o Fim da faixa do vídeo (caminho ou endereço), como a pessoa digitou. */
  definirFaixa: (chave: string, campo: "inicio" | "fim", texto: string) => void;
  /** Muda campos das Exceções do vídeo (caminho ou endereço). */
  definirExcecoesDoVideo: (
    chave: string,
    mudancas: Partial<CamposDasExcecoes>,
  ) => void;
  /** Grava as Exceções de um projeto que ainda espera a vez. */
  definirExcecoes: (id: string, excecoes: Excecoes) => Promise<void>;
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
  /** Pausa ao fim da etapa (ou tira da fila). */
  pausarProjeto: (id: string) => Promise<void>;
  /** Cancela na hora, descartando a etapa em curso. */
  cancelarProjeto: (id: string) => Promise<void>;
  /** Põe o projeto pausado ou cancelado no fim da fila. */
  retomarProjeto: (id: string) => Promise<void>;
  /** Retoma os projetos pausados do lote. */
  retomarLote: (id: string) => Promise<void>;
  /** Recomeça o projeto que falhou, da etapa que falhou. */
  tentarDeNovo: (id: string) => Promise<void>;
  /** Anda com o projeto que espera a vez na fila. */
  moverNaFila: (id: string, movimento: Movimento) => Promise<void>;
  /** Leva o projeto à posição `posicao` da fila do lote dele, um passo de cada vez. */
  reordenarFila: (id: string, posicao: number) => Promise<void>;
  /** Tira da lista o projeto que nunca começou. */
  removerProjeto: (id: string) => Promise<void>;
  /** Exclui o projeto, já confirmado pela pessoa, e guarda o espaço liberado. */
  excluirProjeto: (id: string) => Promise<void>;
  /** Tira do histórico o projeto cuja pasta sumiu. */
  tirarDoHistorico: (id: string) => Promise<void>;
  /** Pede à pessoa o arquivo que substitui o vídeo original que sumiu. */
  localizarVideo: (id: string) => Promise<void>;
  /** Pede a versão final dos reels dos projetos `ids`: é só render, sem custo de tokens. */
  gerarVersaoFinal: (ids: string[]) => Promise<void>;
  /** O endereço pelo qual o player toca o reel. */
  urlDoArquivo: (caminho: string) => string;
  /** A estimativa do lote para os Padrões e a lista de vídeos; `null` até a primeira. */
  estimativa: Estimativa | null;
  /** Pede ao núcleo a estimativa do lote que está sendo montado. */
  estimar: () => Promise<void>;
  /** Cria o lote com os vídeos da lista, ou os põe no fim do lote atual; devolve se criou. */
  gerar: () => Promise<boolean>;
  /** Relê os lotes da Biblioteca. */
  carregarLotes: () => Promise<void>;
  /** Passa a mostrar os projetos do lote `id`. */
  abrirLote: (id: string) => void;
  renomearLote: (id: string, nome: string) => Promise<void>;
  /** Liga ou desliga o modo de acrescentar vídeos ao lote atual. */
  adicionarAoLoteAtual: (adicionando: boolean) => void;
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

    /** Relê o custo do disco: a sessão que terminou fechou o valor dela. */
    async function atualizarCustos() {
      const lotes = await nucleo.lotes();
      const custos = new Map(
        lotes.flatMap((lote) => lote.projetos).map((p) => [p.id, p.custo]),
      );
      set((current) => ({
        lotes,
        projetos: current.projetos.map((projeto) => ({
          ...projeto,
          custo: custos.get(projeto.id) ?? projeto.custo,
        })),
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
              naFila(evento.projeto),
            ],
            loteAtual: evento.projeto.lote,
          }));
          break;
        case "etapaMudou":
          // Uma etapa que começa limpa o que a anterior mostrava; uma que falha deixa as
          // ações do Claude à vista, junto com o motivo.
          mudarProjeto(evento.projeto, (projeto) => {
            const etapas = projeto.etapas.map((item) =>
              item.etapa === evento.etapa
                ? { ...item, estado: evento.estado }
                : item,
            );
            const terminou =
              etapas.some((item) => item.estado === "falhou") ||
              etapas.every((item) => item.estado === "concluida");
            return {
              ...projeto,
              etapas,
              falha: evento.falha,
              percentual: null,
              iniciadoEm:
                projeto.iniciadoEm ??
                (evento.estado === "emAndamento" ? Date.now() : null),
              terminadoEm: terminou
                ? (projeto.terminadoEm ?? Date.now())
                : null,
              ...(evento.estado === "emAndamento" && {
                acoes: [],
                tokens: null,
              }),
            };
          });
          if (evento.estado !== "emAndamento") void atualizarCustos();
          break;
        case "paradaMudou":
          mudarProjeto(evento.projeto, (projeto) => ({
            ...projeto,
            parada: evento.parada,
            percentual: null,
            acoes: evento.parada ? [] : projeto.acoes,
          }));
          break;
        case "filaReordenada":
          set((current) => {
            const ordem = new Map(
              evento.projetos.map((id, posicao) => [id, posicao]),
            );
            const doLote = current.projetos
              .filter((projeto) => projeto.lote === evento.lote)
              .sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0));
            // Os projetos do lote ocupam os mesmos lugares da lista, na ordem nova.
            return {
              projetos: current.projetos.map((projeto) =>
                projeto.lote === evento.lote
                  ? (doLote.shift() ?? projeto)
                  : projeto,
              ),
            };
          });
          break;
        case "projetoRemovido":
          set((current) => ({
            projetos: current.projetos.filter((p) => p.id !== evento.projeto),
            lotes: current.lotes.map((lote) => ({
              ...lote,
              projetos: lote.projetos.filter((p) => p.id !== evento.projeto),
            })),
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

    async function executarCiclo(
      pedido: Promise<{ status: "ok" } | { status: "error"; error: Erro }>,
    ) {
      const result = await pedido;
      set({ erroDoCiclo: result.status === "error" ? result.error : null });
    }

    return {
      app: null,
      erroAoAbrir: null,
      backupDasPreferencias: null,
      aceite: null,
      erroAoAceitar: null,
      conta: null,
      contaConferida: false,
      entrando: false,
      testeDoClaude: "pendente",
      erroDaConta: null,
      instalando: false,
      atualizando: false,
      saidaDoComando: [],
      loginPorTerminal: false,
      plano: null,
      cotacao: null,
      chaveDeApiNoAmbiente: false,
      biblioteca: "",
      erroDasConfiguracoes: null,
      diagnostico: null,
      regrasAprendidas: null,
      kits: [],
      fontesEmbutidas: [],
      preparacao: null,
      andamentoDaPreparacao: {},
      preparando: false,
      arquivos: [],
      erroDeArquivos: null,
      links: [],
      faixas: {},
      excecoes: {},
      padroes: PADROES_INICIAIS,
      projetos: [],
      lotes: [],
      loteAtual: null,
      adicionandoAoLote: false,
      galeria: {},
      errosAoAbrir: {},
      versoesFinais: {},
      erroDaVersaoFinal: null,
      erroDoLote: null,
      erroDoCiclo: null,
      excluido: null,

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
            const lotes = await nucleo.lotes();
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
              cotacao: inicial.cotacao,
              chaveDeApiNoAmbiente: inicial.chaveDeApiNoAmbiente,
              biblioteca: inicial.biblioteca,
              preparacao: current.preparacao ?? preparacao,
              lotes,
              // Um projeto que chegou por evento vale mais que o do disco.
              projetos: [
                ...lotes
                  .toReversed()
                  .flatMap((lote) => lote.projetos)
                  .filter((p) => !current.projetos.some((c) => c.id === p.id))
                  .map(naFila),
                ...current.projetos,
              ],
              loteAtual:
                current.loteAtual ??
                (lotes.find((lote) => lote.aberto) ?? lotes[0])?.id ??
                null,
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

      trocarBiblioteca: async () => {
        const caminho = await nucleo.escolherPasta();
        if (caminho === null) return;
        const result = await nucleo.definirBiblioteca(caminho);
        if (result.status === "error") {
          set({ erroDasConfiguracoes: result.error });
          return;
        }
        const lotes = await nucleo.lotes();
        set({
          erroDasConfiguracoes: null,
          biblioteca: result.data,
          lotes,
          projetos: lotes
            .toReversed()
            .flatMap((lote) => lote.projetos)
            .map(naFila),
          loteAtual:
            (lotes.find((lote) => lote.aberto) ?? lotes[0])?.id ?? null,
          galeria: {},
        });
      },

      definirIdioma: async (idioma) => {
        const result = await nucleo.definirIdioma(idioma);
        if (result.status === "error") {
          set({ erroDasConfiguracoes: result.error });
          return;
        }
        set((current) => ({
          erroDasConfiguracoes: null,
          app: current.app && { ...current.app, idiomaDaInterface: idioma },
        }));
      },

      carregarRegrasAprendidas: async () => {
        const result = await nucleo.regrasAprendidas();
        if (result.status === "ok") set({ regrasAprendidas: result.data });
        else set({ erroDasConfiguracoes: result.error });
      },

      editarRegraAprendida: async (indice, texto) => {
        const result = await nucleo.editarRegraAprendida(indice, texto);
        if (result.status === "ok")
          set({ regrasAprendidas: result.data, erroDasConfiguracoes: null });
        else set({ erroDasConfiguracoes: result.error });
      },

      apagarRegraAprendida: async (indice) => {
        const result = await nucleo.apagarRegraAprendida(indice);
        if (result.status === "ok")
          set({ regrasAprendidas: result.data, erroDasConfiguracoes: null });
        else set({ erroDasConfiguracoes: result.error });
      },

      carregarKits: async () => {
        const [kits, fontes] = await Promise.all([
          nucleo.kits(),
          nucleo.fontesEmbutidas(),
        ]);
        if (kits.status === "ok")
          set({ kits: kits.data, fontesEmbutidas: fontes });
        else set({ erroDeArquivos: kits.error });
      },

      escolherLogo: () => nucleo.escolherLogo(),

      verificarLogo: async (caminho) => {
        const result = await nucleo.verificarLogo(caminho);
        if (result.status === "ok") return result.data;
        set({ erroDeArquivos: result.error });
        return null;
      },

      salvarKit: async (kit) => {
        const result = await nucleo.salvarKit(kit);
        if (result.status !== "ok") {
          set({ erroDeArquivos: result.error });
          return false;
        }
        set((current) => ({
          kits: result.data,
          erroDeArquivos: null,
          padroes: { ...current.padroes, kit: kit.nome.trim() },
        }));
        return true;
      },

      apagarKit: async (nome) => {
        const result = await nucleo.apagarKit(nome);
        if (result.status !== "ok") {
          set({ erroDeArquivos: result.error });
          return;
        }
        set((current) => ({
          kits: result.data,
          erroDeArquivos: null,
          padroes:
            current.padroes.kit === nome
              ? { ...current.padroes, kit: PADROES_INICIAIS.kit }
              : current.padroes,
        }));
      },

      carregarDiagnostico: async () => {
        set({ diagnostico: null });
        const result = await nucleo.diagnosticar();
        if (result.status === "ok") set({ diagnostico: result.data });
        else set({ erroDasConfiguracoes: result.error });
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
        const conta = await nucleo.verificarConta();
        set((current) => {
          const proximo = { ...current, conta, erroDaConta: null };
          return {
            ...proximo,
            contaConferida: current.contaConferida || contaPronta(proximo),
          };
        });
      },

      conferirConta: () => {
        set({ contaConferida: true });
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

      definirMultiplicador: async (multiplicador) => {
        // O plano com o multiplicador novo chega pelo evento planoConfirmado.
        const result = await nucleo.definirMultiplicador(multiplicador);
        set({
          erroDasConfiguracoes: result.status === "error" ? result.error : null,
        });
      },

      definirCotacao: async (valor) => {
        const result = await nucleo.definirCotacao(valor);
        if (result.status === "error") {
          set({ erroDasConfiguracoes: result.error });
          return;
        }
        set({ erroDasConfiguracoes: null, cotacao: result.data });
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

      definirExcecoesDoVideo: (chave, mudancas) => {
        set((current) => ({
          excecoes: {
            ...current.excecoes,
            [chave]: {
              ...(current.excecoes[chave] ?? SEM_CAMPOS),
              ...mudancas,
            },
          },
        }));
      },

      definirExcecoes: async (id, excecoes) => {
        const result = await nucleo.definirExcecoes(id, excecoes);
        if (result.status === "error") {
          set({ erroDoCiclo: result.error });
          return;
        }
        set({ erroDoCiclo: null });
        mudarProjeto(id, (projeto) => ({
          ...projeto,
          excecoes: result.data.excecoes,
        }));
        await get().carregarLotes();
      },

      pausarProjeto: (id) => executarCiclo(nucleo.pausarProjeto(id)),
      cancelarProjeto: (id) => executarCiclo(nucleo.cancelarProjeto(id)),
      retomarProjeto: (id) => executarCiclo(nucleo.retomarProjeto(id)),
      retomarLote: (id) => executarCiclo(nucleo.retomarLote(id)),
      tentarDeNovo: (id) => executarCiclo(nucleo.tentarDeNovo(id)),

      moverNaFila: (id, movimento) =>
        executarCiclo(nucleo.moverNaFila(id, movimento)),
      reordenarFila: async (id, posicao) => {
        // O núcleo só move um passo por vez; a ordem nova chega por evento a cada passo.
        const filaDe = () => {
          const lote = get().projetos.find((p) => p.id === id)?.lote;
          return get()
            .projetos.filter(
              (projeto) =>
                projeto.lote === lote &&
                projeto.parada === null &&
                projeto.etapas.every((item) => item.estado === "pendente"),
            )
            .map((projeto) => projeto.id);
        };
        const de = filaDe().indexOf(id);
        if (de < 0 || de === posicao) return;
        const movimento: Movimento = posicao < de ? "subir" : "descer";
        for (let passo = 0; passo < Math.abs(posicao - de); passo++) {
          const result = await nucleo.moverNaFila(id, movimento);
          if (result.status === "error") {
            set({ erroDoCiclo: result.error });
            return;
          }
        }
        set({ erroDoCiclo: null });
      },
      removerProjeto: (id) => executarCiclo(nucleo.removerProjeto(id)),
      excluirProjeto: async (id) => {
        const titulo = get().projetos.find((p) => p.id === id)?.titulo ?? id;
        const result = await nucleo.excluirProjeto(id);
        if (result.status === "error") {
          set({ erroDoCiclo: result.error });
          return;
        }
        set({
          erroDoCiclo: null,
          excluido: { titulo, bytes: result.data ?? 0 },
        });
      },
      tirarDoHistorico: async (id) => {
        await executarCiclo(nucleo.tirarDoHistorico(id));
        await get().carregarLotes();
      },
      localizarVideo: async (id) => {
        const [caminho] = await nucleo.escolherArquivos();
        if (caminho === undefined) return;
        await executarCiclo(nucleo.localizarVideo(id, caminho));
        if (get().erroDoCiclo === null)
          mudarProjeto(id, (projeto) => ({ ...projeto, videoAusente: false }));
      },

      gerarVersaoFinal: async (ids) => {
        const result = await nucleo.gerarVersaoFinal(ids);
        set({
          erroDaVersaoFinal: result.status === "error" ? result.error : null,
        });
      },

      urlDoArquivo: nucleo.urlDoArquivo,

      estimativa: null,

      estimar: async () => {
        const { arquivos, links, faixas, padroes } = get();
        const duracao = (chave: string, total: number | null) => {
          const campos = faixas[chave];
          const faixa = campos ? lerFaixa(campos.inicio, campos.fim) : null;
          if (faixa === null || faixa === "invalida") return total;
          const fim = faixa.fim ?? total;
          return fim === null ? null : Math.max(fim - faixa.inicio, 0);
        };
        const duracoes = [
          ...arquivos.map((a) => duracao(a.caminho, a.duracaoEmSegundos)),
          ...links.flatMap((link) =>
            link.estado === "pronto"
              ? [duracao(link.url, link.info.duracaoEmSegundos)]
              : [],
          ),
        ];
        const result = await nucleo.estimarLote(padroes, duracoes);
        set({ estimativa: result.status === "ok" ? result.data : null });
      },

      gerar: async () => {
        const faixaDe = (chave: string) => {
          const campos = get().faixas[chave];
          const faixa = campos ? lerFaixa(campos.inicio, campos.fim) : null;
          return faixa === "invalida" ? null : faixa;
        };
        const excecoesDe = (chave: string) =>
          lerExcecoes(get().excecoes[chave] ?? SEM_CAMPOS, null);
        const arquivos = get().arquivos.map((a) => ({
          caminho: a.caminho,
          faixa: faixaDe(a.caminho),
          excecoes: excecoesDe(a.caminho),
        }));
        const links = get().links.flatMap((link) =>
          link.estado === "pronto"
            ? [
                {
                  url: link.info.url,
                  titulo: link.info.titulo,
                  canal: link.info.canal,
                  direitoDeUso: link.direitoDeUso,
                  faixa: faixaDe(link.url),
                  excecoes: excecoesDe(link.url),
                },
              ]
            : [],
        );
        const { adicionandoAoLote, loteAtual } = get();
        const result =
          adicionandoAoLote && loteAtual
            ? await nucleo.adicionarAoLote(loteAtual, arquivos, links)
            : await nucleo.criarLote(arquivos, links, get().padroes);
        if (result.status === "error") {
          set({ erroDeArquivos: result.error });
          return false;
        }
        set({
          arquivos: [],
          links: [],
          faixas: {},
          excecoes: {},
          erroDeArquivos: null,
          adicionandoAoLote: false,
        });
        await get().carregarLotes();
        return true;
      },

      carregarLotes: async () => {
        set({ lotes: await nucleo.lotes() });
      },

      abrirLote: (id) => {
        set({ loteAtual: id });
      },

      renomearLote: async (id, nome) => {
        const result = await nucleo.renomearLote(id, nome);
        if (result.status === "error") {
          set({ erroDoLote: result.error });
          return;
        }
        set({ erroDoLote: null });
        await get().carregarLotes();
      },

      adicionarAoLoteAtual: (adicionandoAoLote) => {
        set({ adicionandoAoLote, erroDeArquivos: null });
      },
    };
  });
}

export type AppStoreApi = ReturnType<typeof createAppStore>;
