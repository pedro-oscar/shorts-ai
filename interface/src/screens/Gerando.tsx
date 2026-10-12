import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LoteResumo, Movimento } from "../bindings";
import { useAppStore } from "../context";
import type { AcaoDoClaude, ProjetoNaFila } from "../store";
import { ErrorMessage, Screen, Topo } from "./common";
import {
  emAberto,
  formatarDuracao,
  formatarTamanho,
  producaoConcluida,
  resumir,
} from "./formatos";

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

/** O nome do lote, que a pessoa pode editar. */
function NomeDoLote({ lote }: { lote: LoteResumo }) {
  const { t } = useTranslation();
  const renomear = useAppStore((store) => store.renomearLote);
  const erro = useAppStore((store) => store.erroDoLote);
  const [nome, setNome] = useState(lote.nome);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void renomear(lote.id, nome);
      }}
    >
      <label>
        {t("gerando.nomeDoLote")}
        <input
          type="text"
          value={nome}
          onChange={(event) => {
            setNome(event.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={nome.trim() === lote.nome}>
        {t("gerando.salvarNome")}
      </button>
      {erro && <ErrorMessage erro={erro} />}
    </form>
  );
}

/** Uma ação como o Claude a fez: "→ Read …", ou o texto que ele escreveu, entre aspas. */
function Acao({ acao }: { acao: AcaoDoClaude }) {
  const { t } = useTranslation();
  if (acao.ferramenta === "texto")
    return <li>{t("gerando.textoDoClaude", { texto: acao.alvo ?? "" })}</li>;
  return (
    <li>
      {acao.alvo === null
        ? t("gerando.acaoSemAlvo", { ferramenta: acao.ferramenta })
        : t("gerando.acao", { ferramenta: acao.ferramenta, alvo: acao.alvo })}
    </li>
  );
}

/** As ações que a tabela do ciclo de vida permite ao projeto no estado em que ele está. */
function Controles({
  projeto,
  estado,
  fila,
}: {
  projeto: ProjetoNaFila;
  estado: ReturnType<typeof resumir>["estado"];
  /** Os ids dos projetos que esperam a vez, na ordem da fila. */
  fila: string[];
}) {
  const { t } = useTranslation();
  const pausar = useAppStore((store) => store.pausarProjeto);
  const cancelar = useAppStore((store) => store.cancelarProjeto);
  const retomar = useAppStore((store) => store.retomarProjeto);
  const tentarDeNovo = useAppStore((store) => store.tentarDeNovo);
  const mover = useAppStore((store) => store.moverNaFila);
  const remover = useAppStore((store) => store.removerProjeto);
  const excluir = useAppStore((store) => store.excluirProjeto);
  const [confirmando, setConfirmando] = useState(false);
  const nome = projeto.titulo;
  const botao = (
    rotulo: string,
    aria: string,
    acao: (id: string) => Promise<void>,
  ) => (
    <button
      type="button"
      aria-label={aria}
      onClick={() => {
        void acao(projeto.id);
      }}
    >
      {rotulo}
    </button>
  );
  const falhou = projeto.etapas.find((item) => item.estado === "falhou");
  const posicao = fila.indexOf(projeto.id);
  const nuncaComecou = projeto.etapas.every(
    (item) => item.estado === "pendente",
  );
  const movimento = (
    rotulo: string,
    aria: string,
    movimento: Movimento,
    habilitado: boolean,
  ) => (
    <button
      type="button"
      aria-label={aria}
      disabled={!habilitado}
      onClick={() => {
        void mover(projeto.id, movimento);
      }}
    >
      {rotulo}
    </button>
  );
  return (
    <div className="actions">
      {estado === "naFila" && (
        <>
          {movimento(
            t("gerando.subir"),
            t("gerando.subirProjeto", { nome }),
            "subir",
            posicao > 0,
          )}
          {movimento(
            t("gerando.descer"),
            t("gerando.descerProjeto", { nome }),
            "descer",
            posicao < fila.length - 1,
          )}
          {movimento(
            t("gerando.passarNaFrente"),
            t("gerando.passarNaFrenteProjeto", { nome }),
            "passarNaFrente",
            posicao > 0,
          )}
        </>
      )}
      {(estado === "naFila" ||
        estado === "pausado" ||
        estado === "cancelado") &&
        nuncaComecou &&
        botao(
          t("gerando.remover"),
          t("gerando.removerProjeto", { nome }),
          remover,
        )}
      {(estado === "naFila" || estado === "emAndamento") &&
        botao(
          t("gerando.pausar"),
          t("gerando.pausarProjeto", { nome }),
          pausar,
        )}
      {(estado === "pausado" || estado === "cancelado") &&
        botao(
          t("gerando.retomar"),
          t("gerando.retomarProjeto", { nome }),
          retomar,
        )}
      {estado !== "falhou" &&
        estado !== "pronto" &&
        estado !== "cancelado" &&
        botao(
          t("gerando.cancelar"),
          t("gerando.cancelarProjeto", { nome }),
          cancelar,
        )}
      {falhou && (
        <button
          type="button"
          aria-label={t("gerando.tentarDeNovoProjeto", { nome })}
          onClick={() => {
            void tentarDeNovo(projeto.id);
          }}
        >
          {t("gerando.tentarDeNovo", {
            etapa: t(`gerando.etapas.${falhou.etapa}`),
          })}
        </button>
      )}
      {(estado === "falhou" ||
        estado === "pronto" ||
        estado === "cancelado" ||
        estado === "pausado") &&
        !confirmando && (
          <button
            type="button"
            aria-label={t("gerando.excluirProjeto", { nome })}
            onClick={() => {
              setConfirmando(true);
            }}
          >
            {t("gerando.excluir")}
          </button>
        )}
      {confirmando && (
        <div
          role="alertdialog"
          aria-label={t("gerando.excluirProjeto", { nome })}
        >
          <p>{t("gerando.confirmarExclusao", { nome })}</p>
          {botao(
            t("gerando.confirmarExcluir"),
            t("gerando.confirmarExcluirProjeto", { nome }),
            excluir,
          )}
          <button
            type="button"
            onClick={() => {
              setConfirmando(false);
            }}
          >
            {t("gerando.manter")}
          </button>
        </div>
      )}
    </div>
  );
}

/** A faixa de um vídeo original que sumiu, com a ação de localizá-lo. */
export function VideoAusente({ projeto }: { projeto: ProjetoNaFila }) {
  const { t } = useTranslation();
  const localizar = useAppStore((store) => store.localizarVideo);
  return (
    <p role="status" className="detail">
      {t("gerando.videoAusente")}
      {" · "}
      <button
        type="button"
        aria-label={t("gerando.localizarProjeto", { nome: projeto.titulo })}
        onClick={() => {
          void localizar(projeto.id);
        }}
      >
        {t("gerando.localizar")}
      </button>
    </p>
  );
}

/** Uma linha do lote: o estado, a etapa N/5, o progresso e o tempo, com o detalhe ao lado. */
function Linha({
  projeto,
  agora,
  fila,
}: {
  projeto: ProjetoNaFila;
  agora: number;
  fila: string[];
}) {
  const { t } = useTranslation();
  const abrirNoSistema = useAppStore((store) => store.abrirNoSistema);
  const resumo = resumir(projeto);
  const tempo =
    projeto.iniciadoEm === null
      ? null
      : formatarDuracao(
          Math.max(0, (projeto.terminadoEm ?? agora) - projeto.iniciadoEm) /
            1000,
        );
  return (
    <li aria-label={projeto.titulo}>
      <strong>{projeto.titulo}</strong>
      <span>
        {t(`gerando.estados.${resumo.estado}`)}
        {resumo.estado === "emAndamento" &&
          ` · ${t("gerando.etapaNdeM", {
            n: resumo.etapa,
            m: projeto.etapas.length,
          })}`}
        {projeto.percentual !== null &&
          ` · ${t("gerando.percentual", { percentual: projeto.percentual })}`}
      </span>
      {tempo !== null && (
        <span className="detail">{t("gerando.tempo", { tempo })}</span>
      )}
      <progress
        value={resumo.concluidas + (projeto.percentual ?? 0) / 100}
        max={projeto.etapas.length}
        aria-label={t("gerando.progresso", { nome: projeto.titulo })}
      />
      <Controles projeto={projeto} estado={resumo.estado} fila={fila} />
      {projeto.videoAusente && <VideoAusente projeto={projeto} />}
      {projeto.falha && (
        <p role="alert" className="error detail">
          {t("erros.detalhe", { detalhe: projeto.falha })}
        </p>
      )}
      <details>
        <summary aria-label={t("gerando.detalhes", { nome: projeto.titulo })}>
          {t("gerando.verDetalhes")}
        </summary>
        <ol className="stages">
          {projeto.etapas.map((item) => (
            <li key={item.etapa}>
              {t(`gerando.etapas.${item.etapa}`)}:{" "}
              {t(`gerando.estadosDaEtapa.${item.estado}`)}
            </li>
          ))}
        </ol>
        {projeto.acoes.length > 0 && (
          <ol
            className="claude-actions"
            aria-label={t("gerando.acoesDoClaude")}
          >
            {projeto.acoes.map((acao) => (
              <Acao key={acao.numero} acao={acao} />
            ))}
          </ol>
        )}
        {projeto.tokens && (
          <p className="detail">
            {t("gerando.tokens", {
              entrada: projeto.tokens.entrada,
              cache: projeto.tokens.cache,
            })}
          </p>
        )}
        <button
          type="button"
          aria-label={t("gerando.abrirLogsDe", { nome: projeto.titulo })}
          onClick={() => {
            void abrirNoSistema(projeto.id, "logs");
          }}
        >
          {t("gerando.abrirLogs")}
        </button>
      </details>
    </li>
  );
}

/** O passo Gerando: cada projeto do lote com o estado e as etapas, ao vivo. */
export function Gerando({
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
  const erroDoCiclo = useAppStore((store) => store.erroDoCiclo);
  const excluido = useAppStore((store) => store.excluido);
  const fila = projetos
    .filter((projeto) => resumir(projeto).estado === "naFila")
    .map((projeto) => projeto.id);
  const pausados = projetos.some((projeto) => projeto.parada === "pausado");
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("gerando.titulo")}>
        {lote && <NomeDoLote key={lote.id} lote={lote} />}
        {projetos.length === 0 && <p>{t("gerando.semLote")}</p>}
        {pausados && loteAtual && (
          <div role="status">
            <p>{t("gerando.loteInterrompido")}</p>
            <button
              type="button"
              onClick={() => {
                void retomarLote(loteAtual);
              }}
            >
              {t("gerando.retomarLote")}
            </button>
          </div>
        )}
        {excluido && (
          <p role="status">
            {t("gerando.excluido", {
              nome: excluido.titulo,
              espaco: formatarTamanho(
                excluido.bytes / 1_000_000,
                i18n.language,
              ),
            })}
          </p>
        )}
        {erroDoCiclo && <ErrorMessage erro={erroDoCiclo} />}
        <div className="actions">
          {rodando && (
            <button type="button" onClick={onAdicionar}>
              {t("gerando.adicionarVideo")}
            </button>
          )}
          <button type="button" onClick={onNovoLote}>
            {t("gerando.novoLote")}
          </button>
          {projetos.some(producaoConcluida) && (
            <button type="button" onClick={onVerReels}>
              {t("gerando.verReels")}
            </button>
          )}
        </div>
        <ul className="project-list">
          {projetos.map((projeto) => (
            <Linha
              key={projeto.id}
              projeto={projeto}
              agora={agora}
              fila={fila}
            />
          ))}
        </ul>
      </Screen>
    </>
  );
}
