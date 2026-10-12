import type {
  Aceite,
  AlvoParaAbrir,
  ArquivoDeVideo,
  DadosDoProjeto,
  Erro,
  EstadoDaConta,
  EstadoDaPreparacao,
  EstadoInicial,
  Evento,
  Faixa,
  LinkDoLote,
  ModoDeLogin,
  Pacote,
  Padroes,
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

const PACOTES: Pacote[] = [
  "nodePortatil",
  "dependenciasDoRemotion",
  "modeloDeTranscricao",
];

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
  const faltando = new Set<Pacote>();
  const falhas = new Map<Pacote, string>();
  let espacoLivre: number | null = 500_000;
  const preparacao = (): EstadoDaPreparacao => ({
    pacotes: PACOTES.map((pacote) => ({
      pacote,
      presente: !faltando.has(pacote),
      tamanhoEmMb: {
        nodePortatil: 200,
        dependenciasDoRemotion: 700,
        modeloDeTranscricao: 1100,
      }[pacote],
    })),
    espacoLivreEmMb: espacoLivre,
    poucoEspaco: espacoLivre !== null && espacoLivre < 20_000,
  });
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
    preparar: 0,
    atualizar: 0,
    /** Os caminhos de cada `criarLote`. */
    lotes: [] as string[][],
    /** A faixa de cada arquivo de cada `criarLote`. */
    faixasDosArquivos: [] as (Faixa | null)[][],
    /** Os links de cada `criarLote`. */
    links: [] as LinkDoLote[][],
    /** Os endereços de cada `consultarLink`. */
    consultas: [] as string[],
    /** Os padrões de cada `criarLote`. */
    padroes: [] as Padroes[],
    /** Os argumentos de cada `entrarNoClaudeCode`. */
    logins: [] as { modo: ModoDeLogin; porTerminal: boolean }[],
    /** Os projetos de cada `gerarVersaoFinal`. */
    versoesFinais: [] as string[][],
    /** O que cada `abrirNoSistema` pediu. */
    abertos: [] as { id: string; alvo: AlvoParaAbrir }[],
  };
  let commandError: Erro | null = null;
  let loginError: Erro | null = null;
  let testError: Erro | null = null;
  let acceptanceError: Erro | null = null;
  let batchError: Erro | null = null;
  const linksQueFalham = new Map<string, Erro>();
  const readErrors = new Map<string, Erro>();
  let openError: Erro | null = null;

  const emit = (evento: Evento) => {
    for (const listener of listeners) listener(evento);
  };

  const nucleo: Nucleo = {
    estadoInicial: () => Promise.resolve(state),
    verificarPreparacao: () => Promise.resolve(preparacao()),
    preparar: () => {
      calls.preparar++;
      for (const pacote of [...faltando]) {
        emit({
          tipo: "preparacaoMudou",
          pacote,
          estado: "emAndamento",
          falha: null,
        });
        emit({ tipo: "progressoDaPreparacao", pacote, percentual: 40 });
        const falha = falhas.get(pacote) ?? null;
        if (!falha) faltando.delete(pacote);
        emit({
          tipo: "preparacaoMudou",
          pacote,
          estado: falha ? "falhou" : "concluida",
          falha,
        });
      }
      return Promise.resolve({ status: "ok", data: preparacao() });
    },
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
    consultarLink: (url) => {
      calls.consultas.push(url);
      const falha = linksQueFalham.get(url);
      if (falha) return Promise.resolve({ status: "error", error: falha });
      const id = /(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/.exec(url)?.[1];
      if (!id)
        return Promise.resolve({
          status: "error",
          error: { codigo: "linkInvalido", url },
        });
      return Promise.resolve({
        status: "ok",
        data: {
          url: `https://www.youtube.com/watch?v=${id}`,
          titulo: `Vídeo ${id}`,
          canal: "Canal da Ana",
          duracaoEmSegundos: 3725,
        },
      });
    },
    criarLote: (arquivos, links, padroes) => {
      const caminhos = arquivos.map((arquivo) => arquivo.caminho);
      calls.lotes.push(caminhos);
      calls.faixasDosArquivos.push(arquivos.map((arquivo) => arquivo.faixa));
      calls.links.push(links);
      calls.padroes.push(padroes);
      if (batchError)
        return Promise.resolve({ status: "error", error: batchError });
      const nomes = [
        ...caminhos.map((caminho) =>
          (caminho.split("/").pop() ?? caminho).replace(/\.\w+$/, ""),
        ),
        ...links.map((link) => link.titulo),
      ];
      projetos = nomes.map((nome) => {
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
      const readError = readErrors.get(id);
      if (readError)
        return Promise.resolve({ status: "error", error: readError });
      return Promise.resolve({
        status: "ok",
        data: dados.get(id) ?? { reels: [], reservas: [] },
      });
    },
    abrirNoSistema: (id, alvo) => {
      calls.abertos.push({ id, alvo });
      if (openError)
        return Promise.resolve({ status: "error", error: openError });
      return Promise.resolve({ status: "ok", data: null });
    },
    gerarVersaoFinal: (ids) => {
      calls.versoesFinais.push(ids);
      for (const projeto of ids)
        emit({
          tipo: "versaoFinalMudou",
          projeto,
          estado: "pendente",
          falha: null,
        });
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
    /** Estes pacotes da preparação ainda não estão no computador. */
    faltam: (pacotes: Pacote[], livre: number | null = 500_000) => {
      for (const pacote of pacotes) faltando.add(pacote);
      espacoLivre = livre;
    },
    /** Baixar este pacote falha com este motivo. */
    falharPacote: (pacote: Pacote, motivo: string) => {
      falhas.set(pacote, motivo);
    },
    /** O pacote deixa de falhar. */
    consertarPacote: (pacote: Pacote) => {
      falhas.delete(pacote);
    },
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
    /** Consultar este endereço falha com este erro. */
    falharConsulta: (url: string, erro: Erro) => {
      linksQueFalham.set(url, erro);
    },
    /** Os reels e as reservas que o núcleo lê do projeto `id`. */
    definirDados: (id: string, projeto: DadosDoProjeto) => {
      dados.set(id, projeto);
    },
    /** A leitura dos dados do projeto `id` falha com este erro. */
    falharLeitura: (id: string, erro: Erro) => {
      readErrors.set(id, erro);
    },
    /** Abrir qualquer coisa no sistema falha com este erro. */
    falharAbertura: (erro: Erro) => {
      openError = erro;
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
