import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReelDoProjeto } from "../bindings";
import { useAppStore } from "../context";
import type {
  LeituraDoProjeto,
  ProjetoNaFila,
  VersaoFinalDoProjeto,
} from "../store";
import { ErrorMessage, Screen, Topo } from "./common";
import { ResumoDoCusto } from "./Custo";
import { formatarDuracao, producaoConcluida } from "./formatos";

/**
 * O player 9:16. Onde o sistema não toca o reel no app (o WebKitGTK do Linux, ADR 0008), o
 * botão o abre no player do sistema.
 */
function Player({
  projeto,
  corte,
  arquivo,
  titulo,
}: {
  projeto: string;
  corte: string;
  arquivo: string;
  titulo: string;
}) {
  const { t } = useTranslation();
  const urlDoArquivo = useAppStore((store) => store.urlDoArquivo);
  const abrirNoSistema = useAppStore((store) => store.abrirNoSistema);
  const [tocaNoApp, setTocaNoApp] = useState(true);
  if (tocaNoApp)
    return (
      <video
        className="player"
        controls
        preload="metadata"
        src={urlDoArquivo(arquivo)}
        onError={() => {
          setTocaNoApp(false);
        }}
      />
    );
  return (
    <div className="player player-parado">
      <p>{t("reels.naoTocaNoApp")}</p>
      <button
        type="button"
        aria-label={t("reels.assistirNoSistemaDe", { titulo })}
        onClick={() => {
          void abrirNoSistema(projeto, { reel: corte });
        }}
      >
        {t("reels.assistirNoSistema")}
      </button>
    </div>
  );
}

/** Um reel: o player 9:16, o que o Claude disse dele e a descrição do post. */
function Reel({ projeto, reel }: { projeto: string; reel: ReelDoProjeto }) {
  const { t } = useTranslation();
  const [copiada, setCopiada] = useState(false);
  const titulo = reel.titulo ?? t("reels.semTitulo");
  const descricao = reel.descricao;
  const informacoes = [
    ["gancho", reel.gancho],
    ["payoff", reel.payoff],
    ["porque", reel.porque],
  ] as const;
  return (
    <article className="reel" aria-label={titulo}>
      {reel.arquivo === null ? (
        <p className="detail">{t("reels.semArquivo")}</p>
      ) : (
        <Player
          projeto={projeto}
          corte={reel.id}
          arquivo={reel.arquivo}
          titulo={titulo}
        />
      )}
      <h3>{titulo}</h3>
      <p className="detail">
        {[
          formatarDuracao(reel.duracaoEmSegundos),
          reel.nota !== null && t("reels.nota", { nota: reel.nota }),
          reel.categoria,
        ]
          .filter(Boolean)
          .join(" · ")}
        {reel.previa && <span className="chip">{t("reels.previa")}</span>}
      </p>
      <dl>
        {informacoes.map(
          ([chave, valor]) =>
            valor !== null && (
              <div key={chave}>
                <dt>{t(`reels.${chave}`)}</dt>
                <dd>{valor}</dd>
              </div>
            ),
        )}
      </dl>
      {descricao !== null && (
        <>
          <button
            type="button"
            aria-label={t("reels.copiarDescricaoDe", { titulo })}
            onClick={() => {
              void navigator.clipboard.writeText(descricao).then(() => {
                setCopiada(true);
              });
            }}
          >
            {t("reels.copiarDescricao")}
          </button>
          <span role="status">{copiada && t("reels.copiada")}</span>
        </>
      )}
    </article>
  );
}

/** Um projeto em que ainda há prévia no lugar da versão final. */
function temPrevia(leitura: LeituraDoProjeto | undefined) {
  return (
    leitura?.status === "ok" && leitura.data.reels.some((reel) => reel.previa)
  );
}

/** O render da versão final está na fila ou em andamento. */
function renderizando(
  versao: VersaoFinalDoProjeto | undefined,
): versao is VersaoFinalDoProjeto {
  return versao?.estado === "pendente" || versao?.estado === "emAndamento";
}

/** O render da versão final do projeto: o botão que o pede, ou o andamento dele. */
function VersaoFinal({ projeto, titulo }: { projeto: string; titulo: string }) {
  const { t } = useTranslation();
  const gerarVersaoFinal = useAppStore((store) => store.gerarVersaoFinal);
  const versao = useAppStore((store) => store.versoesFinais[projeto]);
  return (
    <>
      {renderizando(versao) ? (
        <p role="status">
          {versao.percentual === null
            ? t("reels.versaoFinal")
            : t("reels.versaoFinalComProgresso", {
                percentual: versao.percentual,
              })}
        </p>
      ) : (
        <button
          type="button"
          aria-label={t("reels.gerarVersaoFinalDe", { titulo })}
          onClick={() => {
            void gerarVersaoFinal([projeto]);
          }}
        >
          {t("reels.gerarVersaoFinal")}
        </button>
      )}
      {versao?.estado === "falhou" && (
        <p role="alert">
          {t("reels.versaoFinalFalhou", { titulo, falha: versao.falha })}
        </p>
      )}
    </>
  );
}

/** Os reels e as reservas de um projeto, com o que abrir no sistema. */
function Projeto({ projeto }: { projeto: ProjetoNaFila }) {
  const { t } = useTranslation();
  const carregarGaleria = useAppStore((store) => store.carregarGaleria);
  const abrirNoSistema = useAppStore((store) => store.abrirNoSistema);
  const leitura = useAppStore((store) => store.galeria[projeto.id]);
  const erroAoAbrir = useAppStore((store) => store.errosAoAbrir[projeto.id]);
  useEffect(() => {
    void carregarGaleria(projeto.id);
  }, [carregarGaleria, projeto.id]);
  const dados = leitura?.status === "ok" ? leitura.data : undefined;
  const erro = leitura?.status === "error" ? leitura.error : undefined;
  // Sem a pasta, não há o que abrir.
  const naoEncontrado = erro?.codigo === "projetoNaoEncontrado";
  return (
    <section aria-label={projeto.titulo}>
      <h2>{projeto.titulo}</h2>
      {!naoEncontrado && (
        <div className="actions">
          {(
            [
              ["pasta", "abrirPasta"],
              ["roteiro", "abrirRoteiro"],
              ["logs", "abrirLogs"],
            ] as const
          ).map(([alvo, texto]) => (
            <button
              key={alvo}
              type="button"
              onClick={() => {
                void abrirNoSistema(projeto.id, alvo);
              }}
            >
              {t(`reels.${texto}`)}
            </button>
          ))}
        </div>
      )}
      {dados && (
        <ResumoDoCusto custo={dados.custo} rotulo={t("custo.projeto")} />
      )}
      {temPrevia(leitura) && (
        <VersaoFinal projeto={projeto.id} titulo={projeto.titulo} />
      )}
      {erroAoAbrir && <ErrorMessage erro={erroAoAbrir} />}
      {erro && <ErrorMessage erro={erro} />}
      {dados && dados.reels.length === 0 && (
        <p className="detail">{t("reels.semReels")}</p>
      )}
      <div className="reels">
        {dados?.reels.map((reel) => (
          <Reel key={reel.id} projeto={projeto.id} reel={reel} />
        ))}
      </div>
      {dados && dados.reservas.length > 0 && (
        <>
          <h3>{t("reels.reservas")}</h3>
          <ul className="reservas" aria-label={t("reels.reservas")}>
            {dados.reservas.map((reserva) => (
              <li key={reserva.id}>
                <strong>{reserva.titulo ?? t("reels.semTitulo")}</strong>
                <span>
                  {reserva.nota !== null &&
                    t("reels.nota", { nota: reserva.nota })}
                </span>
                {reserva.porque !== null && <span>{reserva.porque}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** O passo Reels: os reels agrupados por projeto. */
export function Reels({
  onOpenSobre,
  onVoltar,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
}) {
  const { t } = useTranslation();
  const loteAtual = useAppStore((store) => store.loteAtual);
  const lote = useAppStore((store) =>
    store.lotes.find((item) => item.id === store.loteAtual),
  );
  const projetos = useAppStore((store) => store.projetos);
  const comReels = projetos
    .filter((projeto) => projeto.lote === loteAtual)
    .filter(producaoConcluida);
  const gerarVersaoFinal = useAppStore((store) => store.gerarVersaoFinal);
  const erroDaVersaoFinal = useAppStore((store) => store.erroDaVersaoFinal);
  const galeria = useAppStore((store) => store.galeria);
  const versoesFinais = useAppStore((store) => store.versoesFinais);
  const paraRenderizar = comReels.filter(
    (projeto) =>
      temPrevia(galeria[projeto.id]) &&
      !renderizando(versoesFinais[projeto.id]),
  );
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("reels.titulo")}>
        <button type="button" onClick={onVoltar}>
          {t("reels.voltar")}
        </button>
        {lote && <p>{t("reels.doLote", { nome: lote.nome })}</p>}
        {paraRenderizar.length > 0 && (
          <button
            type="button"
            onClick={() => {
              void gerarVersaoFinal(
                paraRenderizar.map((projeto) => projeto.id),
              );
            }}
          >
            {t("reels.gerarVersaoFinalDoLote")}
          </button>
        )}
        {erroDaVersaoFinal && <ErrorMessage erro={erroDaVersaoFinal} />}
        {comReels.length === 0 && <p>{t("reels.vazio")}</p>}
        {comReels.map((projeto) => (
          <Projeto key={projeto.id} projeto={projeto} />
        ))}
      </Screen>
    </>
  );
}
