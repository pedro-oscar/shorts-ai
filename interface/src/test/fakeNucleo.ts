import type {
  ArquivoDoLote,
  Aceite,
  AlvoParaAbrir,
  ArquivoDeVideo,
  DadosDoProjeto,
  Diagnostico,
  Erro,
  EstadoDaConta,
  EstadoDaPreparacao,
  EstadoInicial,
  Evento,
  Excecoes,
  Faixa,
  LinkDoLote,
  LoteResumo,
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

/** O que o Diagnóstico do núcleo falso acha por padrão: tudo no lugar. */
export const DIAGNOSTICO_PADRAO: Diagnostico = {
  gpu: "vulkan",
  espacoLivreEmMb: 250_000,
  dependencias: [
    { nome: "ffmpeg", situacao: { tipo: "presente", versao: "7.1.1" } },
    { nome: "ytDlp", situacao: { tipo: "presente", versao: "2026.10.01" } },
    { nome: "whisper", situacao: { tipo: "presente", versao: null } },
    {
      nome: "modeloDeTranscricao",
      situacao: { tipo: "presente", versao: null },
    },
    { nome: "node", situacao: { tipo: "presente", versao: "v22.22.1" } },
    {
      nome: "dependenciasDoRemotion",
      situacao: { tipo: "presente", versao: null },
    },
    { nome: "chrome", situacao: { tipo: "presente", versao: null } },
  ],
  conta: LOGADO,
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
  lotesIniciais: LoteResumo[] = [],
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
  const lotes: LoteResumo[] = [...lotesIniciais];
  let pastaEscolhida: string | null = null;
  let diagnostico: Diagnostico = DIAGNOSTICO_PADRAO;
  let bibliotecaError: Erro | null = null;
  /** Os lotes que cada pasta de Biblioteca tem, além dos da pasta de agora. */
  const bibliotecas = new Map<string, LoteResumo[]>();
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
    /** O lote e os caminhos de cada `adicionarAoLote`. */
    adicoes: [] as { lote: string; caminhos: string[] }[],
    /** O lote e o nome de cada `renomearLote`. */
    renomeacoes: [] as { lote: string; nome: string }[],
    /** Os argumentos de cada `entrarNoClaudeCode`. */
    logins: [] as { modo: ModoDeLogin; porTerminal: boolean }[],
    /** Os projetos de cada `gerarVersaoFinal`. */
    versoesFinais: [] as string[][],
    /** Cada ação do ciclo de vida pedida, como `pausar:<id>` ou `retomarLote:<lote>`. */
    ciclo: [] as string[],
    /** O projeto e as exceções de cada `definirExcecoes`. */
    excecoes: [] as { projeto: string; excecoes: Excecoes }[],
    /** As exceções de cada arquivo de cada `criarLote`. */
    excecoesDosArquivos: [] as Excecoes[][],
    /** O idioma de cada `definirIdioma`. */
    idiomas: [] as string[],
    /** Quantas vezes o Diagnóstico conferiu o computador. */
    diagnosticos: 0,
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

  /** Cria um projeto por vídeo no fim do lote; o mesmo vídeo de novo ganha outro id. */
  const criarProjetos = (
    lote: LoteResumo,
    caminhos: string[],
    links: LinkDoLote[],
    excecoes: Excecoes[] = [],
  ): ProjetoResumo[] => {
    const nomes = [
      ...caminhos.map((caminho) =>
        (caminho.split("/").pop() ?? caminho).replace(/\.\w+$/, ""),
      ),
      ...links.map((link) => link.titulo),
    ];
    const novos = nomes.map((nome, indice): ProjetoResumo => {
      const existentes = lotes
        .flatMap((item) => item.projetos)
        .filter((projeto) => projeto.titulo === nome).length;
      const id = `${nome} (2026-10-09)${existentes > 0 ? ` (${String(existentes + 1)})` : ""}`;
      const projeto: ProjetoResumo = {
        id,
        titulo: nome,
        pasta: `/Biblioteca/${id}`,
        lote: lote.id,
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
        parada: null,
        videoAusente: false,
        excecoes: excecoes[indice] ?? {},
      };
      lote.projetos.push(projeto);
      return projeto;
    });
    for (const projeto of novos) emit({ tipo: "projetoCriado", projeto });
    return novos;
  };

  /** As exceções de cada vídeo do lote, na ordem dos projetos: os arquivos e, depois, os links. */
  const excecoesDe = (arquivos: ArquivoDoLote[], links: LinkDoLote[]) => [
    ...arquivos.map((arquivo) => arquivo.excecoes ?? {}),
    ...links.map((link) => link.excecoes ?? {}),
  ];

  const cicloOk = (acao: string, id: string) => {
    calls.ciclo.push(`${acao}:${id}`);
    return Promise.resolve({ status: "ok" as const, data: null });
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
    escolherPasta: () => Promise.resolve(pastaEscolhida),
    definirBiblioteca: (caminho) => {
      if (bibliotecaError)
        return Promise.resolve({ status: "error", error: bibliotecaError });
      bibliotecas.set(state.biblioteca, [...lotes]);
      lotes.splice(0, lotes.length, ...(bibliotecas.get(caminho) ?? []));
      state = { ...state, biblioteca: caminho };
      return Promise.resolve({ status: "ok", data: caminho });
    },
    definirIdioma: (idioma) => {
      calls.idiomas.push(idioma);
      state = { ...state, idiomaDaInterface: idioma };
      return Promise.resolve({ status: "ok", data: null });
    },
    diagnosticar: () => {
      calls.diagnosticos++;
      return Promise.resolve({ status: "ok", data: diagnostico });
    },
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
      calls.excecoesDosArquivos.push(
        arquivos.map((arquivo) => arquivo.excecoes ?? {}),
      );
      calls.links.push(links);
      calls.padroes.push(padroes);
      if (batchError)
        return Promise.resolve({ status: "error", error: batchError });
      const numero = lotes.length + 1;
      const lote: LoteResumo = {
        id: `2026-10-09T10-0${String(numero)}-00`,
        nome: `Lote de 09/10 10:0${String(numero)}`,
        criadoEm: "2026-10-09T10:00:00Z",
        padroes,
        projetos: [],
        ausentes: [],
        aberto: true,
      };
      lotes.unshift(lote);
      return Promise.resolve({
        status: "ok",
        data: criarProjetos(lote, caminhos, links, excecoesDe(arquivos, links)),
      });
    },
    adicionarAoLote: (id, arquivos, links) => {
      const caminhos = arquivos.map((arquivo) => arquivo.caminho);
      calls.adicoes.push({ lote: id, caminhos });
      calls.links.push(links);
      const lote = lotes.find((item) => item.id === id);
      if (!lote)
        return Promise.resolve({
          status: "error",
          error: { codigo: "loteNaoEncontrado", id },
        });
      return Promise.resolve({
        status: "ok",
        data: criarProjetos(lote, caminhos, links, excecoesDe(arquivos, links)),
      });
    },
    renomearLote: (id, nome) => {
      calls.renomeacoes.push({ lote: id, nome });
      const lote = lotes.find((item) => item.id === id);
      if (!lote)
        return Promise.resolve({
          status: "error",
          error: { codigo: "loteNaoEncontrado", id },
        });
      lote.nome = nome.trim();
      return Promise.resolve({ status: "ok", data: null });
    },
    lotes: () => Promise.resolve(structuredClone(lotes)),
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
    definirExcecoes: (projeto, excecoes) => {
      calls.excecoes.push({ projeto, excecoes });
      const resumo = lotes
        .flatMap((lote) => lote.projetos)
        .find((item) => item.id === projeto);
      if (!resumo)
        return Promise.resolve({
          status: "error",
          error: { codigo: "projetoNaoEncontrado", id: projeto },
        });
      resumo.excecoes = excecoes;
      return Promise.resolve({ status: "ok", data: structuredClone(resumo) });
    },
    pausarProjeto: (id) => cicloOk("pausar", id),
    cancelarProjeto: (id) => cicloOk("cancelar", id),
    retomarProjeto: (id) => cicloOk("retomar", id),
    retomarLote: (id) => cicloOk("retomarLote", id),
    tentarDeNovo: (id) => cicloOk("tentarDeNovo", id),
    moverNaFila: (id, movimento) => cicloOk(`mover:${movimento}`, id),
    removerProjeto: (id) => cicloOk("remover", id),
    excluirProjeto: (id) => {
      calls.ciclo.push(`excluir:${id}`);
      return Promise.resolve({ status: "ok" as const, data: 2_500_000 });
    },
    tirarDoHistorico: (id) => cicloOk("tirarDoHistorico", id),
    localizarVideo: (id, caminho) => cicloOk(`localizar:${caminho}`, id),
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
    /** O que o seletor de pastas devolve na próxima vez; `null` é a pessoa cancelar. */
    escolherPastaDaBiblioteca: (caminho: string | null) => {
      pastaEscolhida = caminho;
    },
    /** Estes lotes já estão na pasta `caminho`, como se a pessoa os tivesse copiado para lá. */
    copiarParaBiblioteca: (caminho: string, lotesCopiados: LoteResumo[]) => {
      bibliotecas.set(caminho, lotesCopiados);
    },
    /** Trocar a Biblioteca falha com este erro. */
    falharBiblioteca: (erro: Erro) => {
      bibliotecaError = erro;
    },
    /** O que o Diagnóstico acha da máquina. */
    definirDiagnostico: (retrato: Diagnostico) => {
      diagnostico = retrato;
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
