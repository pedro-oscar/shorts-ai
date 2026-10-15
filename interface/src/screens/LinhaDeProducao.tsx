import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { Etapa, LoteResumo, ProjetoResumo } from "../bindings";
import { useAppStore } from "../context";
import type { AcaoDoClaude, ProjetoNaFila } from "../store";
import {
  Dialogo,
  ErrorMessage,
  ItemDoMenu,
  Menu,
  SeparadorDoMenu,
  Topo,
} from "./common";
import { DetalheDoCusto, ResumoDoCusto } from "./Custo";
import { ExcecoesDoProjeto, ResumoDasExcecoes } from "./Excecoes";
import {
  emAberto,
  formatarDuracao,
  formatarTamanho,
  producaoConcluida,
  resumir,
} from "./formatos";

/** As colunas do quadro: a Fila, as cinco etapas e Pronto. */
const COLUNAS = [
  "fila",
  "importacao",
  "transcricao",
  "roteiro",
  "producao",
  "revisao",
  "pronto",
] as const;
type Coluna = (typeof COLUNAS)[number];

/**
 * A coluna em que o projeto está: Fila enquanto não começou, a etapa em andamento ou a que
 * falhou, a próxima a rodar se ele parou no meio, e Pronto no fim.
 */
function colunaDe(projeto: ProjetoResumo): Coluna {
  const { estado } = resumir(projeto);
  if (estado === "pronto") return "pronto";
  const iniciado = projeto.etapas.some((item) => item.estado !== "pendente");
  if (!iniciado) return "fila";
  const atual =
    projeto.etapas.find((item) => item.estado === "falhou") ??
    projeto.etapas.find((item) => item.estado === "emAndamento") ??
    projeto.etapas.find((item) => item.estado !== "concluida");
  return atual?.etapa ?? "pronto";
}

/** O relógio, a cada segundo enquanto `ativo`, para o tempo dos projetos andar. */
function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const intervalo = setInterval(() => {
      setAgora(Date.now());
    }, 1000);
    return () => {
      clearInterval(intervalo);
    };
  }, [ativo]);
  return agora;
}

/** O nome do lote, que a pessoa pode editar no topo do quadro. */
function NomeDoLote({ lote }: { lote: LoteResumo }) {
  const { t } = useTranslation();
  const renomear = useAppStore((store) => store.renomearLote);
  const erro = useAppStore((store) => store.erroDoLote);
  const [nome, setNome] = useState(lote.nome);
  return (
    <form
      className="nome-do-lote"
      onSubmit={(event) => {
        event.preventDefault();
        void renomear(lote.id, nome);
      }}
    >
      <input
        type="text"
        aria-label={t("linha.nomeDoLote")}
        value={nome}
        onChange={(event) => {
          setNome(event.target.value);
        }}
      />
      {nome.trim() !== lote.nome && (
        <button type="submit" className="discreto">
          {t("linha.salvarNome")}
        </button>
      )}
      {erro && <ErrorMessage erro={erro} />}
    </form>
  );
}

/** Uma ação como o Claude a fez: "→ Read …", ou o texto que ele escreveu, entre aspas. */
function Acao({ acao }: { acao: AcaoDoClaude }) {
  const { t } = useTranslation();
  if (acao.ferramenta === "texto")
    return (
      <li className="fala">
        {t("linha.textoDoClaude", { texto: acao.alvo ?? "" })}
      </li>
    );
  return (
    <li>
      {acao.alvo === null
        ? t("linha.acaoSemAlvo", { ferramenta: acao.ferramenta })
        : t("linha.acao", { ferramenta: acao.ferramenta, alvo: acao.alvo })}
    </li>
  );
}

/** A faixa de um vídeo original que sumiu, com a ação de localizá-lo. */
export function VideoAusente({ projeto }: { projeto: ProjetoResumo }) {
  const { t } = useTranslation();
  const localizar = useAppStore((store) => store.localizarVideo);
  return (
    <p role="status" className="detail">
      {t("linha.videoAusente")}
      {" · "}
      <button
        type="button"
        className="discreto"
        aria-label={t("linha.localizarProjeto", { nome: projeto.titulo })}
        onClick={() => {
          void localizar(projeto.id);
        }}
      >
        {t("linha.localizar")}
      </button>
    </p>
  );
}

function IconePausa() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <rect x="3" y="2" width="4" height="12" rx="1" />
      <rect x="9" y="2" width="4" height="12" rx="1" />
    </svg>
  );
}

function Alca() {
  return (
    <span className="alca" aria-hidden="true">
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
        <circle cx="2.5" cy="3" r="1.5" />
        <circle cx="7.5" cy="3" r="1.5" />
        <circle cx="2.5" cy="8" r="1.5" />
        <circle cx="7.5" cy="8" r="1.5" />
        <circle cx="2.5" cy="13" r="1.5" />
        <circle cx="7.5" cy="13" r="1.5" />
      </svg>
    </span>
  );
}

/** Os reels que a Produção já rendeu, para o cartão Pronto dizer quantos são. */
function ReelsDoCartao({ projeto }: { projeto: ProjetoNaFila }) {
  const { t } = useTranslation();
  const leitura = useAppStore((store) => store.galeria[projeto.id]);
  const carregar = useAppStore((store) => store.carregarGaleria);
  useEffect(() => {
    void carregar(projeto.id);
  }, [carregar, projeto.id]);
  if (leitura?.status !== "ok") return null;
  const reels = leitura.data.reels;
  if (reels.length === 0) return null;
  const previas = reels.filter((reel) => reel.previa).length;
  return (
    <>
      <div className="miniaturas" aria-hidden="true">
        {reels.slice(0, 4).map((reel) => (
          <span key={reel.id} />
        ))}
      </div>
      <span className="cartao-estado">
        {previas > 0
          ? t("linha.reelsEmPrevia", { count: reels.length })
          : t("linha.reelsProntos", { count: reels.length })}
      </span>
    </>
  );
}

/** O pedido de confirmação antes de apagar a pasta do projeto. */
function ConfirmacaoDeExclusao({
  projeto,
  onFechar,
}: {
  projeto: ProjetoNaFila;
  onFechar: () => void;
}) {
  const { t } = useTranslation();
  const excluir = useAppStore((store) => store.excluirProjeto);
  const nome = projeto.titulo;
  return (
    <Dialogo
      alerta
      titulo={t("linha.excluirProjeto", { nome })}
      onFechar={onFechar}
    >
      <p>{t("linha.confirmarExclusao", { nome })}</p>
      <div className="actions fim">
        <button type="button" onClick={onFechar}>
          {t("linha.manter")}
        </button>
        <button
          type="button"
          className="perigo"
          aria-label={t("linha.confirmarExcluirProjeto", { nome })}
          onClick={() => {
            void excluir(projeto.id);
          }}
        >
          {t("linha.confirmarExcluir")}
        </button>
      </div>
    </Dialogo>
  );
}

/**
 * Um cartão do quadro: o projeto com o estado, o progresso, o que o Claude faz, a ação
 * principal do estado em que ele está e o resto no menu ⋯.
 */
function Cartao({
  projeto,
  agora,
  fila,
  onVerReels,
  arrasto,
}: {
  projeto: ProjetoNaFila;
  agora: number;
  /** Os ids dos projetos que esperam a vez, na ordem da fila. */
  fila: string[];
  onVerReels: () => void;
  /** Como o cartão se arrasta na Fila; `null` fora dela. */
  arrasto: {
    arrastando: boolean;
    onInicio: () => void;
    onFim: () => void;
    onSoltar: () => void;
  } | null;
}) {
  const { t } = useTranslation();
  const abrirNoSistema = useAppStore((store) => store.abrirNoSistema);
  const pausar = useAppStore((store) => store.pausarProjeto);
  const cancelar = useAppStore((store) => store.cancelarProjeto);
  const retomar = useAppStore((store) => store.retomarProjeto);
  const tentarDeNovo = useAppStore((store) => store.tentarDeNovo);
  const mover = useAppStore((store) => store.moverNaFila);
  const remover = useAppStore((store) => store.removerProjeto);
  const [confirmando, setConfirmando] = useState(false);
  const resumo = resumir(projeto);
  const { estado } = resumo;
  const nome = projeto.titulo;
  const tempo =
    projeto.iniciadoEm === null
      ? null
      : formatarDuracao(
          Math.max(0, (projeto.terminadoEm ?? agora) - projeto.iniciadoEm) /
            1000,
        );
  const falhou = projeto.etapas.find((item) => item.estado === "falhou");
  const posicao = fila.indexOf(projeto.id);
  const nuncaComecou = projeto.etapas.every(
    (item) => item.estado === "pendente",
  );
  const parado =
    estado === "pausado" ||
    estado === "cancelado" ||
    estado === "aguardandoCota";
  const classe = [
    "cartao-projeto",
    estado === "emAndamento" && "rodando",
    estado === "falhou" && "falhou",
    estado === "pronto" && "pronto",
    parado && "parado",
    arrasto?.arrastando === true && "arrastando",
  ]
    .filter(Boolean)
    .join(" ");

  const acao = (rotulo: string, aria: string, executar: () => void) => (
    <button type="button" aria-label={aria} onClick={executar}>
      {rotulo}
    </button>
  );
  let principal: ReactNode = null;
  if (estado === "emAndamento")
    principal = (
      <button
        type="button"
        className="discreto"
        aria-label={t("linha.pausarProjeto", { nome })}
        onClick={() => {
          void pausar(projeto.id);
        }}
      >
        <IconePausa />
        {t("linha.pausar")}
      </button>
    );
  else if (estado === "pausado" || estado === "cancelado")
    principal = acao(
      t("linha.retomar"),
      t("linha.retomarProjeto", { nome }),
      () => {
        void retomar(projeto.id);
      },
    );
  else if (estado === "aguardandoCota")
    principal = acao(
      t("linha.retomarAgora"),
      t("linha.retomarAgoraProjeto", { nome }),
      () => {
        void retomar(projeto.id);
      },
    );
  else if (falhou)
    principal = (
      <button
        type="button"
        className="perigo"
        aria-label={t("linha.tentarDeNovoProjeto", { nome })}
        onClick={() => {
          void tentarDeNovo(projeto.id);
        }}
      >
        {t("linha.tentarDeNovo", {
          etapa: t(`linha.etapas.${falhou.etapa}`),
        })}
      </button>
    );
  else if (estado === "pronto")
    principal = (
      <button
        type="button"
        className="sucesso"
        aria-label={t("linha.abrirNaSalaProjeto", { nome })}
        onClick={onVerReels}
      >
        {t("linha.abrirNaSala")}
      </button>
    );

  const podeRemover = parado || estado === "naFila";
  const podeExcluir =
    estado === "falhou" ||
    estado === "pronto" ||
    estado === "cancelado" ||
    estado === "pausado";
  const menu = (
    <Menu rotulo={t("comum.maisAcoes", { nome })}>
      {estado === "naFila" && (
        <>
          <ItemDoMenu
            rotulo={t("linha.passarNaFrenteProjeto", { nome })}
            disabled={posicao <= 0}
            onClick={() => {
              void mover(projeto.id, "passarNaFrente");
            }}
          >
            {t("linha.passarNaFrente")}
          </ItemDoMenu>
          <ItemDoMenu
            rotulo={t("linha.subirProjeto", { nome })}
            disabled={posicao <= 0}
            onClick={() => {
              void mover(projeto.id, "subir");
            }}
          >
            {t("linha.subir")}
          </ItemDoMenu>
          <ItemDoMenu
            rotulo={t("linha.descerProjeto", { nome })}
            disabled={posicao < 0 || posicao >= fila.length - 1}
            onClick={() => {
              void mover(projeto.id, "descer");
            }}
          >
            {t("linha.descer")}
          </ItemDoMenu>
          <SeparadorDoMenu />
          <ItemDoMenu
            rotulo={t("linha.pausarProjeto", { nome })}
            onClick={() => {
              void pausar(projeto.id);
            }}
          >
            {t("linha.pausar")}
          </ItemDoMenu>
        </>
      )}
      {estado !== "falhou" && estado !== "pronto" && estado !== "cancelado" && (
        <ItemDoMenu
          rotulo={t("linha.cancelarProjeto", { nome })}
          onClick={() => {
            void cancelar(projeto.id);
          }}
        >
          {t("linha.cancelar")}
        </ItemDoMenu>
      )}
      {podeRemover && nuncaComecou && (
        <ItemDoMenu
          rotulo={t("linha.removerProjeto", { nome })}
          onClick={() => {
            void remover(projeto.id);
          }}
        >
          {t("linha.remover")}
        </ItemDoMenu>
      )}
      <SeparadorDoMenu />
      <ItemDoMenu
        rotulo={t("linha.abrirLogsDe", { nome })}
        onClick={() => {
          void abrirNoSistema(projeto.id, "logs");
        }}
      >
        {t("linha.abrirLogs")}
      </ItemDoMenu>
      {podeExcluir && (
        <ItemDoMenu
          rotulo={t("linha.excluirProjeto", { nome })}
          perigo
          onClick={() => {
            setConfirmando(true);
          }}
        >
          {t("linha.excluir")}
        </ItemDoMenu>
      )}
    </Menu>
  );

  const soltar = (event: DragEvent) => {
    event.preventDefault();
    arrasto?.onSoltar();
  };
  return (
    <li
      aria-label={nome}
      className={classe}
      draggable={arrasto !== null}
      onDragStart={arrasto?.onInicio}
      onDragEnd={arrasto?.onFim}
      onDragOver={
        arrasto
          ? (event) => {
              event.preventDefault();
            }
          : undefined
      }
      onDrop={arrasto ? soltar : undefined}
    >
      <div className="cartao-cabeca">
        {arrasto && <Alca />}
        <strong>{nome}</strong>
        {menu}
      </div>
      <span className="cartao-estado">
        {t(`linha.estados.${estado}`)}
        {estado === "emAndamento" &&
          ` · ${t("linha.etapaNdeM", {
            n: resumo.etapa,
            m: projeto.etapas.length,
          })}`}
        {projeto.percentual !== null &&
          ` · ${t("linha.percentual", { percentual: projeto.percentual })}`}
      </span>
      {estado !== "naFila" && estado !== "pronto" && (
        <progress
          value={resumo.concluidas + (projeto.percentual ?? 0) / 100}
          max={projeto.etapas.length}
          aria-label={t("linha.progresso", { nome })}
        />
      )}
      {tempo !== null && (
        <span className="detail">{t("linha.tempo", { tempo })}</span>
      )}
      {projeto.acoes.length > 0 && (
        <ol className="claude-actions" aria-label={t("linha.acoesDoClaude")}>
          {projeto.acoes.map((acaoDoClaude) => (
            <Acao key={acaoDoClaude.numero} acao={acaoDoClaude} />
          ))}
        </ol>
      )}
      {estado === "pronto" && <ReelsDoCartao projeto={projeto} />}
      {estado === "naFila" ? (
        <ExcecoesDoProjeto projeto={projeto} />
      ) : (
        <ResumoDasExcecoes excecoes={projeto.excecoes} />
      )}
      <ResumoDoCusto custo={projeto.custo} rotulo={t("custo.projeto")} />
      {projeto.videoAusente && <VideoAusente projeto={projeto} />}
      {projeto.falha !== null && (
        <p role="alert" className="error">
          {t("erros.detalhe", { detalhe: projeto.falha })}
        </p>
      )}
      {principal !== null && <div className="actions">{principal}</div>}
      <details>
        <summary aria-label={t("linha.detalhes", { nome })}>
          {t("linha.verDetalhes")}
        </summary>
        <ol className="stages">
          {projeto.etapas.map((item) => (
            <li key={item.etapa}>
              {t(`linha.etapas.${item.etapa}`)}:{" "}
              {t(`linha.estadosDaEtapa.${item.estado}`)}
            </li>
          ))}
        </ol>
        {projeto.tokens && (
          <p className="detail">
            {t("linha.tokens", {
              entrada: projeto.tokens.entrada,
              cache: projeto.tokens.cache,
            })}
          </p>
        )}
        <DetalheDoCusto custo={projeto.custo} />
      </details>
      {confirmando && (
        <ConfirmacaoDeExclusao
          projeto={projeto}
          onFechar={() => {
            setConfirmando(false);
          }}
        />
      )}
    </li>
  );
}

/** As vagas da linha: a GPU, o Claude e o render, e quem está usando cada uma. */
function Vagas({ projetos }: { projetos: ProjetoNaFila[] }) {
  const { t } = useTranslation();
  const versoesFinais = useAppStore((store) => store.versoesFinais);
  const rodando = projetos.flatMap((projeto) =>
    projeto.etapas
      .filter((item) => item.estado === "emAndamento")
      .map((item) => ({ projeto, etapa: item.etapa })),
  );
  const usando = (etapas: Etapa[]) =>
    rodando.find((item) => etapas.includes(item.etapa));
  const render =
    usando(["producao"]) ??
    (Object.entries(versoesFinais).some(
      ([, versao]) => versao.estado === "emAndamento",
    )
      ? "versaoFinal"
      : undefined);
  const vaga = (
    chave: "gpu" | "claude" | "render",
    uso: { projeto: ProjetoNaFila; etapa: Etapa } | "versaoFinal" | undefined,
  ) => (
    <span className="vaga">
      <span className="vaga-nome">{t(`vagas.${chave}`)}</span>
      <span
        className={`vaga-luz ${chave}${uso ? " ocupada" : ""}`}
        aria-hidden="true"
      />
      <span>
        {uso === undefined
          ? t("vagas.livre")
          : uso === "versaoFinal"
            ? t("vagas.versaoFinal")
            : t("vagas.emUso", {
                etapa: t(`linha.etapas.${uso.etapa}`),
                nome: uso.projeto.titulo,
              })}
      </span>
    </span>
  );
  const naFila = projetos.filter(
    (projeto) => resumir(projeto).estado === "naFila",
  ).length;
  return (
    <footer className="vagas" aria-label={t("vagas.titulo")}>
      <span className="rotulo">{t("vagas.titulo")}</span>
      {vaga("gpu", usando(["transcricao"]))}
      {vaga("claude", usando(["roteiro", "revisao"]))}
      {vaga("render", render)}
      <span className="espaco" />
      <span className="muted">{t("vagas.naFila", { count: naFila })}</span>
    </footer>
  );
}

/** As colunas do quadro só com o nome e a conta, por trás da folha de Vídeos. */
export function FundoDoQuadro() {
  const { t } = useTranslation();
  const loteAtual = useAppStore((store) => store.loteAtual);
  const projetos = useAppStore((store) => store.projetos);
  const doLote = projetos.filter((projeto) => projeto.lote === loteAtual);
  return (
    <div className="fundo-quadro" aria-hidden="true">
      {COLUNAS.map((coluna) => (
        <div key={coluna}>
          {t(`linha.colunas.${coluna}`)} ·{" "}
          {doLote.filter((projeto) => colunaDe(projeto) === coluna).length}
        </div>
      ))}
    </div>
  );
}

/** A Linha de produção: o lote atual num quadro, uma coluna por etapa, ao vivo. */
export function LinhaDeProducao({
  onOpenSobre,
  onVerReels,
  onAdicionar,
  onNovoLote,
}: {
  onOpenSobre: () => void;
  onVerReels: () => void;
  onAdicionar: () => void;
  onNovoLote: () => void;
}) {
  const { t, i18n } = useTranslation();
  const loteAtual = useAppStore((store) => store.loteAtual);
  const lote = useAppStore((store) =>
    store.lotes.find((item) => item.id === store.loteAtual),
  );
  const todos = useAppStore((store) => store.projetos);
  const projetos = todos.filter((projeto) => projeto.lote === loteAtual);
  const rodando = projetos.some(emAberto);
  const agora = useAgora(rodando);
  const retomarLote = useAppStore((store) => store.retomarLote);
  const reordenarFila = useAppStore((store) => store.reordenarFila);
  const erroDoCiclo = useAppStore((store) => store.erroDoCiclo);
  const excluido = useAppStore((store) => store.excluido);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const fila = projetos
    .filter((projeto) => resumir(projeto).estado === "naFila")
    .map((projeto) => projeto.id);
  const pausados = projetos.some((projeto) => projeto.parada === "pausado");
  const prontos = projetos.filter(
    (projeto) => resumir(projeto).estado === "pronto",
  ).length;
  const comReels = projetos.some(producaoConcluida);

  const soltarEm = (alvo: string) => {
    if (arrastando === null || arrastando === alvo) return;
    const posicao = fila.indexOf(alvo);
    if (posicao >= 0) void reordenarFila(arrastando, posicao);
    setArrastando(null);
  };

  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <main className="linha">
        <div className="linha-topo">
          <div className="linha-barra">
            <h1 ref={heading} tabIndex={-1}>
              {t("linha.titulo")}
            </h1>
            {lote && <NomeDoLote key={lote.id} lote={lote} />}
            <span className="espaco" />
            {rodando && (
              <button type="button" className="primary" onClick={onAdicionar}>
                {t("linha.adicionarVideo")}
              </button>
            )}
            <button
              type="button"
              className={rodando ? undefined : "primary"}
              onClick={onNovoLote}
            >
              {t("linha.novoLote")}
            </button>
            {comReels && (
              <button type="button" onClick={onVerReels}>
                {t("linha.verReels")}
                {prontos > 0 && (
                  <span className="chip ok" aria-hidden="true">
                    {prontos}
                  </span>
                )}
              </button>
            )}
          </div>
          {lote && (
            <div className="linha-resumo">
              <span>
                {t("linha.resumo", {
                  videos: t("padroes.videos", { count: projetos.length }),
                  prontos,
                })}
              </span>
              <ResumoDoCusto custo={lote.custo} rotulo={t("custo.lote")} />
            </div>
          )}
        </div>
        {(pausados || excluido !== null || erroDoCiclo !== null) && (
          <div className="linha-avisos">
            {pausados && loteAtual !== null && (
              <div role="status" className="faixa-status">
                <span>{t("linha.loteInterrompido")}</span>
                <button
                  type="button"
                  onClick={() => {
                    void retomarLote(loteAtual);
                  }}
                >
                  {t("linha.retomarLote")}
                </button>
              </div>
            )}
            {excluido && (
              <p role="status" className="faixa-status">
                {t("linha.excluido", {
                  nome: excluido.titulo,
                  espaco: formatarTamanho(
                    excluido.bytes / 1_000_000,
                    i18n.language,
                  ),
                })}
              </p>
            )}
            {erroDoCiclo && <ErrorMessage erro={erroDoCiclo} />}
          </div>
        )}
        {projetos.length === 0 ? (
          <div className="linha-vazia">
            <p>{t("linha.semLote")}</p>
            <button type="button" className="primary" onClick={onNovoLote}>
              {t("linha.adicionarVideo")}
            </button>
          </div>
        ) : (
          <div className="quadro">
            {COLUNAS.map((coluna) => {
              const cartoes = projetos.filter(
                (projeto) => colunaDe(projeto) === coluna,
              );
              const vazia = cartoes.length === 0;
              const recebendo =
                coluna === "fila" && arrastando !== null && !vazia;
              return (
                <section
                  key={coluna}
                  className={[
                    "coluna",
                    vazia && "vazia",
                    recebendo && "recebendo",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-labelledby={`coluna-${coluna}`}
                >
                  <h2 id={`coluna-${coluna}`} className="coluna-titulo">
                    {t(`linha.colunas.${coluna}`)}
                    <span>{cartoes.length}</span>
                  </h2>
                  <ul
                    className="cartoes"
                    aria-label={t(`linha.colunas.${coluna}`)}
                  >
                    {cartoes.map((projeto) => (
                      <Cartao
                        key={projeto.id}
                        projeto={projeto}
                        agora={agora}
                        fila={fila}
                        onVerReels={onVerReels}
                        arrasto={
                          coluna === "fila" && fila.includes(projeto.id)
                            ? {
                                arrastando: arrastando === projeto.id,
                                onInicio: () => {
                                  setArrastando(projeto.id);
                                },
                                onFim: () => {
                                  setArrastando(null);
                                },
                                onSoltar: () => {
                                  soltarEm(projeto.id);
                                },
                              }
                            : null
                        }
                      />
                    ))}
                  </ul>
                  {coluna === "fila" && fila.length > 1 && (
                    <span className="coluna-dica">
                      {t("linha.arrasteParaReordenar")}
                    </span>
                  )}
                </section>
              );
            })}
          </div>
        )}
        <Vagas projetos={todos} />
      </main>
    </>
  );
}
